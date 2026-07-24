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
  appendFileSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
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
  try {
    const fd = openSync(tmpPath, "w");
    try {
      writeSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, finalPath); // same-directory rename: atomic, overwrites
  } catch (error) {
    // A failed write/rename must not leave its temp file behind.
    rmSync(tmpPath, { force: true });
    throw error;
  }
  // Best-effort directory fsync so the rename itself reaches disk. Windows
  // cannot open directories for fsync — visibility-atomicity holds anyway.
  try {
    const dirFd = openSync(path.dirname(finalPath), "r");
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
const SEEDED_IGNORE_LINES = ["reviews/", ".cache/", "config.schema.json"];

/**
 * Ensures `_agentic-guardrails/.gitignore` covers the generated layers
 * (`reviews/`, `.cache/`, schema file) while leaving the committed layer
 * (Story 1.8 config/ledger files) committable. An existing file is
 * user-editable territory: any user content is preserved verbatim, but
 * missing seeded lines are APPENDED — a pre-1.7 file must not silently
 * leave `.cache/` committable.
 */
function ensureOutputGitignore(outRoot: string): void {
  const gitignorePath = path.join(outRoot, ".gitignore");
  let existing: string;
  try {
    existing = readFileSync(gitignorePath, "utf8");
  } catch {
    writeFileSync(gitignorePath, `${SEEDED_IGNORE_LINES.join("\n")}\n`);
    return;
  }
  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = SEEDED_IGNORE_LINES.filter((line) => !present.has(line));
  if (missing.length === 0) return;
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  appendFileSync(gitignorePath, `${separator}${missing.join("\n")}\n`);
}
