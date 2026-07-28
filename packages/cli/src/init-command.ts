/**
 * `guardrails init` — bootstraps `_agentic-guardrails/` (config via the
 * per-axiom questionnaire or documented defaults, empty-but-valid
 * conventions/corpus-map, git wiring) and builds the structural seed.
 * Exit codes: 0 success (idempotent re-runs report kept-vs-created),
 * 2 typed failure (not a git repo, write error). Never clobbers.
 *
 * The questionnaire runs only on a real TTY (stdin AND stdout) without
 * `--no-input` — no prompt ever blocks a pipe or CI run. A closed stdin
 * (Ctrl+D) mid-questionnaire accepts defaults for the remaining questions
 * with a stderr note — it never hangs.
 */
import { createInterface } from "node:readline/promises";

import { runInit, type InitIo } from "@agentic-guardrails/core";

/** The readline surface `eofSafeIo` needs — a seam so the EOF path is
 * unit-testable without a real TTY. */
export interface QuestionSource {
  question(prompt: string): Promise<string>;
  /** `"SIGINT"` is used by the 1.15 disposition prompt: Ctrl-C there must
   * settle through the EOF default instead of readline's own exit(130). */
  once(event: "close" | "SIGINT", listener: () => void): unknown;
}

/**
 * Wraps readline so a close/EOF during a pending `question` settles as ""
 * (accept the default) instead of hanging forever, noting it once on
 * stderr; every later question short-circuits to "" without touching the
 * closed interface.
 */
export function eofSafeIo(rl: QuestionSource, note: (line: string) => void): InitIo {
  let closed = false;
  let noted = false;
  const onClose = new Promise<undefined>((resolve) => {
    rl.once("close", () => {
      closed = true;
      resolve(undefined);
    });
  });
  return {
    question: async (prompt) => {
      if (closed) return "";
      const answer = await Promise.race([rl.question(prompt), onClose]);
      if (answer === undefined) {
        if (!noted) {
          noted = true;
          note("input closed — accepting defaults for the remaining questions");
        }
        return "";
      }
      return answer;
    },
  };
}

export async function initCommand(cwd: string, options: { input?: boolean }): Promise<number> {
  const interactive =
    options.input !== false && process.stdin.isTTY === true && process.stdout.isTTY === true;
  const rl = interactive
    ? createInterface({ input: process.stdin, output: process.stdout })
    : undefined;
  const io: InitIo | undefined =
    rl && eofSafeIo(rl, (line) => process.stderr.write(`guardrails init: ${line}\n`));
  try {
    const result = await runInit({ cwd, noInput: !interactive, io });
    // Per-file summary: created vs updated vs kept (never-clobber made
    // visible) — reported on failure too, so files written before the
    // failure still reach the user.
    for (const file of result.created) process.stdout.write(`created: ${file}\n`);
    for (const file of result.updated) process.stdout.write(`updated: ${file}\n`);
    if (!result.ok) {
      process.stderr.write(`guardrails init: ${result.message}\n`);
      return 2;
    }
    for (const file of result.kept) process.stdout.write(`kept: ${file}\n`);
    process.stdout.write(
      result.seed.written
        ? `seed: ${result.seed.path}\n`
        : `seed skipped: ${result.seed.reason}\n`,
    );
    for (const warning of result.warnings) {
      process.stderr.write(`guardrails init: warning: ${warning}\n`);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`guardrails init: ${message}\n`);
    return 2;
  } finally {
    rl?.close();
  }
}
