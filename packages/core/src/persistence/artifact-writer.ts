/**
 * Visibility-atomic artifact persistence: write to a unique temp file in the
 * TARGET directory, fsync, then rename onto the final path — a reader can
 * never observe a torn artifact. (Durability of the rename itself is
 * best-effort: the directory fsync below is unsupported on some platforms.)
 * The minimal `_agentic-guardrails/reviews/<scope>/` tree — plus a
 * `.gitignore` keeping generated output out of the analyzed repo's history —
 * is created on demand (`guardrails init` bootstraps the full layout).
 */
import { randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import path from "node:path";

// The scope segment pattern is the traversal guard on a directory name derived
// from untrusted ref text, so it has exactly ONE definition (contracts) — the
// artifact schema and this writer cannot disagree about what is safe.
import { SCOPE_PATTERN } from "@agentic-guardrails/contracts";

// `\\?\` prefixing for `fs` past Win32's MAX_PATH (SPIKE-5 item 11). Lives in
// `git/worktree.ts` beside the lifecycle that first needed it; imported rather
// than re-implemented so there is one answer to "how long is too long".
import { fsPath } from "../git/worktree.js";

export class InvalidScopeError extends Error {
  constructor(scope: string) {
    super(`invalid scope segment: ${JSON.stringify(scope)} (expected ${SCOPE_PATTERN.source})`);
    this.name = "InvalidScopeError";
  }
}

export interface WriteReviewArtifactOptions {
  repoRoot: string;
  scope: string;
  runId: string;
  /** Canonical artifact bytes (already serialized — written verbatim). */
  json: string;
}

/** Writes atomically; returns the absolute final artifact path.
 * @throws {InvalidScopeError} when `scope` is not a safe directory segment. */
export function writeReviewArtifact(options: WriteReviewArtifactOptions): string {
  if (!SCOPE_PATTERN.test(options.scope)) throw new InvalidScopeError(options.scope);
  const outRoot = path.join(options.repoRoot, "_agentic-guardrails");
  const dir = path.join(outRoot, "reviews", options.scope);
  mkdirSync(fsPath(dir), { recursive: true });
  ensureOutputGitignore(outRoot);
  const finalPath = path.join(dir, `${options.runId}.json`);
  writeFileAtomic(finalPath, options.json);
  return finalPath;
}

/**
 * Visibility-atomic file write (temp file in the target directory → fsync →
 * rename). The parent directory must exist. Shared by the review-artifact
 * writer and the config-plane schema writer.
 */
export function writeFileAtomic(finalPath: string, content: string): void {
  // Unique temp name (pid + random suffix) so two concurrent runs can never
  // interleave writes into the same temp file. Randomness lives in the TEMP
  // name only — the final path and file bytes stay deterministic.
  const tmpPath = `${finalPath}.${process.pid}.${randomBytes(2).toString("hex")}.tmp`;
  // `fsPath` on every `fs` call: a deep `reviews/branch-<slug>/` path can
  // cross Win32's 260-char limit, where the write would fail AFTER the whole
  // analysis has been paid for (SPIKE-5 item 11).
  try {
    const fd = openSync(fsPath(tmpPath), "w");
    try {
      writeSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(fsPath(tmpPath), fsPath(finalPath)); // same-directory: atomic, overwrites
  } catch (error) {
    // A failed write/rename must not leave its temp file behind.
    rmSync(fsPath(tmpPath), { force: true });
    throw error;
  }
  // Best-effort directory fsync so the rename itself reaches disk. Windows
  // cannot open directories for fsync — visibility-atomicity holds anyway.
  try {
    const dirFd = openSync(fsPath(path.dirname(finalPath)), "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    // Unsupported platform (e.g. Windows EISDIR/EPERM): durability is
    // best-effort by design; ignore.
  }
}

/** The generated layers the seeded output .gitignore must cover. */
export const SEEDED_IGNORE_LINES = ["reviews/", ".cache/", "config.schema.json"];

/**
 * Ensures `_agentic-guardrails/.gitignore` covers the generated layers
 * (`reviews/`, `.cache/`, schema file) while leaving the committed layer
 * (Story 1.8 config/ledger files) committable.
 */
function ensureOutputGitignore(outRoot: string): void {
  ensureLines(path.join(outRoot, ".gitignore"), SEEDED_IGNORE_LINES);
}

/**
 * Append-missing-lines primitive shared by the on-demand `.gitignore`
 * seeding and the `init` git wiring (Story 1.8). A missing file is created
 * with exactly the seeded lines; an existing file is user-editable
 * territory — user content is preserved verbatim and only missing lines are
 * APPENDED, matching the file's existing EOL style (a CRLF file stays
 * CRLF). The whole content is rewritten atomically — a reader can never
 * observe a torn file. Returns what happened so `init` can report
 * created-vs-updated-vs-kept.
 */
export function ensureLines(
  filePath: string,
  lines: readonly string[],
): "created" | "appended" | "unchanged" {
  let existing: string;
  try {
    existing = readFileSync(fsPath(filePath), "utf8");
  } catch {
    writeFileAtomic(filePath, `${lines.join("\n")}\n`);
    return "created";
  }
  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = lines.filter((line) => !present.has(line));
  if (missing.length === 0) return "unchanged";
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const separator = existing === "" || existing.endsWith("\n") ? "" : eol;
  writeFileAtomic(filePath, `${existing}${separator}${missing.join(eol)}${eol}`);
  return "appended";
}
