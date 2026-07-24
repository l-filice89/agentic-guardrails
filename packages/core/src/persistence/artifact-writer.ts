/**
 * Visibility-atomic artifact persistence: write to a unique temp file in the
 * TARGET directory, fsync, then rename onto the final path — a reader can
 * never observe a torn artifact. (Durability of the rename itself is
 * best-effort: the directory fsync below is unsupported on some platforms.)
 * The minimal `_agentic-guardrails/reviews/<scope>/` tree — plus a
 * `.gitignore` keeping generated output out of the analyzed repo's history —
 * is created on demand (full bootstrap is Story 1.8).
 */
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";

/** Only lowercase-kebab scope segments may become directory names — anything
 * else (path separators, dots, uppercase) is rejected before any I/O. */
const SCOPE_PATTERN = /^[a-z][a-z-]*$/;

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
  mkdirSync(dir, { recursive: true });
  ensureOutputGitignore(outRoot);
  const finalPath = path.join(dir, `${options.runId}.json`);
  // Unique temp name (pid + random suffix) so two concurrent runs can never
  // interleave writes into the same temp file. Randomness lives in the TEMP
  // name only — the final path and artifact bytes stay deterministic.
  const tmpPath = `${finalPath}.${process.pid}.${randomBytes(2).toString("hex")}.tmp`;
  const fd = openSync(tmpPath, "w");
  try {
    writeSync(fd, options.json);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, finalPath); // same-directory rename: atomic, overwrites
  // Best-effort directory fsync so the rename itself reaches disk. Windows
  // cannot open directories for fsync — visibility-atomicity holds anyway.
  try {
    const dirFd = openSync(dir, "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    // Unsupported platform (e.g. Windows EISDIR/EPERM): durability is
    // best-effort by design; ignore.
  }
  return finalPath;
}

/**
 * Ensures `_agentic-guardrails/.gitignore` exists, ignoring the generated
 * layers (`reviews/`, `.cache/`) while leaving the committed layer (Story
 * 1.8 config/ledger files) committable. An existing file is left untouched —
 * it is user-editable territory.
 */
function ensureOutputGitignore(outRoot: string): void {
  const gitignorePath = path.join(outRoot, ".gitignore");
  if (existsSync(gitignorePath)) return;
  writeFileSync(gitignorePath, "reviews/\n.cache/\n");
}
