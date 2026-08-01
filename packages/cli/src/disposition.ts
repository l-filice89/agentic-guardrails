/**
 * Artifact disposition (Story 1.15) — commit or drop, and NEVER an ambient
 * mutation: no prompt means no commit.
 *
 * The contradiction this resolves: `reviews/` is seeded into
 * `_agentic-guardrails/.gitignore` by design (1.8), so "commit" means
 * `git add -f` on that ONE file followed by a PATHSPEC-LIMITED commit. It
 * never edits `.gitignore`, never `git add -A`, and leaves the rest of the
 * user's index and working tree exactly as it found them.
 *
 * "Drop" leaves the artifact on disk, untracked and ignored (it already is),
 * and prints its path — it deletes nothing and makes no git call. EOF, a
 * non-TTY, and `--no-input` all default to DROP, the safe answer, reusing
 * `eofSafeIo`'s precedent from `init-command.ts` (a closed stdin settles as
 * the default instead of hanging).
 *
 * Disposition never changes the exit code: the gate verdict is decided by
 * findings, full stop.
 */
import { copyFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import { commitPath } from "@agentic-guardrails/core";

import { eofSafeIo, type QuestionSource } from "./init-command.js";

export type DispositionAction = "commit" | "drop" | "commit-failed";

export interface DispositionResult {
  action: DispositionAction;
  /** Lines to report, in order — the caller owns the stream. */
  lines: string[];
}

export interface DispositionOptions {
  repoRoot: string;
  /** Absolute path of the artifact just written. */
  artifactPath: string;
  runId: string;
  scope: string;
  /** false → drop without prompting (`--no-input`, a pipe, or CI). */
  interactive: boolean;
  /** Test seam: the prompt source, so the EOF path needs no real TTY. */
  io?: QuestionSource;
  /** Test seam: the commit, so a test can inject a failure without a hook. */
  commit?: typeof commitPath;
}

export async function disposeArtifact(options: DispositionOptions): Promise<DispositionResult> {
  const relative = path.relative(options.repoRoot, options.artifactPath).replaceAll("\\", "/");
  // No prompt, no extra output: the summary already printed the artifact path,
  // and bare `guardrails review` must keep the output it has always had.
  if (!options.interactive) return { action: "drop", lines: [] };

  const rl = options.io ?? createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    // `eofSafeIo`'s note is emitted once and its own wording is about a
    // questionnaire; this surface has one question, so the note says what
    // actually happens here — the mechanism is reused, not re-implemented.
    const io = eofSafeIo(rl, () =>
      process.stderr.write("guardrails review: input closed — dropping the artifact\n"),
    );
    // Ctrl-C at the prompt: readline's default SIGINT handling ends the
    // process with 130, escaping the documented 0/1/2 exit contract and
    // throwing away a gate verdict that is already decided. Closing the
    // interface settles the pending question through the EOF path instead —
    // the safe default (drop) — and the run reports its real exit code.
    rl.once("SIGINT", () => (rl as { close?: () => void }).close?.());
    answer = (
      await io.question("commit the review artifact, or drop it? [c/y = commit, D = drop] ")
    ).trim();
  } finally {
    // Only a readline WE created is ours to close — an injected seam is the
    // caller's.
    if (options.io === undefined) (rl as { close?: () => void }).close?.();
  }
  // Anything that is not an explicit commit — including "" from EOF — drops.
  // `y`/`yes` counts: it is the near-universal affirmative, and silently
  // treating it as "drop" makes the tool do the opposite of what was typed.
  if (!/^(c(ommit)?|y(es)?)$/i.test(answer)) {
    return { action: "drop", lines: [`artifact left untracked at: ${relative}`] };
  }

  const commit = options.commit ?? commitPath;
  const result = commit(
    options.repoRoot,
    relative,
    `chore(guardrails): review ${options.scope} ${options.runId} [skip ci]`,
  );
  if (result.ok) {
    // Deterministic re-run: the artifact bytes are already in HEAD, so there
    // was nothing to commit. A no-op, not a failure — reporting it as one
    // would send an unchanged artifact to a temp directory every time.
    return result.value.state === "unchanged"
      ? { action: "commit", lines: [`already committed (unchanged): ${relative}`] }
      : { action: "commit", lines: [`committed: ${relative}`] };
  }

  // A commit that cannot happen (detached HEAD, unborn branch, a hook
  // rejecting, a locked index) must not lose the artifact and must not crash:
  // it is copied somewhere durable and the path is REPORTED.
  let saved: string;
  try {
    const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-artifact-"));
    saved = path.join(dir, path.basename(options.artifactPath));
    copyFileSync(options.artifactPath, saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      action: "commit-failed",
      lines: [
        `degraded: commit failed: ${result.reason}`,
        `degraded: could not copy the artifact to a temp directory either: ${message} — it remains at ${relative}`,
      ],
    };
  }
  return {
    action: "commit-failed",
    lines: [`degraded: commit failed: ${result.reason}`, `artifact saved to: ${saved}`],
  };
}
