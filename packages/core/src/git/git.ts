/**
 * Thin typed wrapper over the system `git` binary. Always spawned with an
 * argument array and `shell: false` — user input is never interpolated into
 * a shell string. Every failure (no git, not a repo, non-zero exit) is a
 * typed result, never a throw.
 */
import { spawnSync } from "node:child_process";

export type GitResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Ceiling on ONE git invocation. Without it a git that waits — most
 * realistically on a credential prompt while resolving a remote ref — blocks
 * the process forever. */
export const GIT_TIMEOUT_MS = 120_000;
/** Ceiling on captured stdout. The default 1 MiB truncates a large
 * `worktree list`/`ls-files` into a silently wrong parse. */
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
/** Belt and braces with the timeout: git must never WAIT on a human. */
const NON_INTERACTIVE_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "echo",
  GCM_INTERACTIVE: "never",
} as const;

/** sha of git's canonical empty tree — the HEAD sentinel before any commit. */
export const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

interface RawGitFailure {
  ok: false;
  reason: string;
  /** `spawnSync().error.code` when the process never started (e.g. ENOENT). */
  spawnCode?: string;
}

export interface GitRunOptions {
  /** Override the per-invocation timeout (tests, and callers that know a
   * command is cheap). */
  timeoutMs?: number;
}

function git(
  cwd: string,
  args: readonly string[],
  options: GitRunOptions = {},
): { ok: true; value: string } | RawGitFailure {
  const timeout = options.timeoutMs ?? GIT_TIMEOUT_MS;
  const result = spawnSync("git", args as string[], {
    cwd,
    shell: false,
    encoding: "utf8",
    windowsHide: true,
    timeout,
    maxBuffer: GIT_MAX_BUFFER,
    env: { ...process.env, ...NON_INTERACTIVE_ENV },
  });
  if (result.error) {
    const spawnCode = (result.error as NodeJS.ErrnoException).code;
    const reason =
      spawnCode === "ETIMEDOUT"
        ? `git timed out after ${timeout}ms: git ${args.join(" ")}`
        : `git spawn failed: ${result.error.message}`;
    return {
      ok: false,
      reason,
      ...(spawnCode === undefined ? {} : { spawnCode }),
    };
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    return { ok: false, reason: stderr || `git exited with status ${result.status}` };
  }
  return { ok: true, value: result.stdout ?? "" };
}

/**
 * Runs one git command in `cwd` and returns its stdout, or a typed failure.
 * The generic seam for commands whose output needs no shared parsing (the
 * worktree lifecycle, Story 1.14) — same argument-array, never-throws
 * discipline as every helper below.
 *
 * INTERNAL SEAM: deliberately NOT re-exported from `@agentic-guardrails/core`'s
 * public barrel. "Run any git subcommand in any cwd" is an unguarded
 * capability; consumers get the named, bounded helpers instead.
 */
export function gitCommand(
  cwd: string,
  args: readonly string[],
  options: GitRunOptions = {},
): GitResult<string> {
  const result = git(cwd, args, options);
  return result.ok ? result : { ok: false, reason: result.reason };
}

/** True only when `cwd` is inside a git work tree. */
export function isRepo(cwd: string): boolean {
  const result = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return result.ok && result.value.trim() === "true";
}

export type RepoRootFailureKind = "git-not-found" | "not-a-repo" | "git-error";

export type RepoRootResult =
  | { ok: true; value: string }
  | { ok: false; kind: RepoRootFailureKind; reason: string };

/**
 * Absolute path of the repository root (`/`-separated, as git reports it).
 * Failures are classified so the CLI can print an accurate message:
 * `git-not-found` (the binary is missing), `not-a-repo`, or `git-error`.
 */
export function repoRoot(cwd: string): RepoRootResult {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.ok) return { ok: true, value: result.value.trim() };
  if (result.spawnCode === "ENOENT") {
    return { ok: false, kind: "git-not-found", reason: result.reason };
  }
  if (result.reason.includes("not a git repository")) {
    return { ok: false, kind: "not-a-repo", reason: result.reason };
  }
  return { ok: false, kind: "git-error", reason: result.reason };
}

/**
 * The commit sha of HEAD; the empty-tree sentinel when the repo has no
 * commits yet (identity input for the runId — never a throw).
 */
export function headSha(cwd: string): string {
  const result = git(cwd, ["rev-parse", "HEAD"]);
  return result.ok ? result.value.trim() : EMPTY_TREE_SHA;
}

/**
 * Parses `git status --porcelain=v1 -z` output into working-tree paths.
 * Rename/copy entries (`R`/`C` in the two-char status) carry the ORIGIN path
 * as the next NUL token; the origin no longer exists in the working tree, so
 * it is skipped. Exported as the unit-test seam for the porcelain format.
 */
export function parsePorcelainZ(output: string): string[] {
  const files = new Set<string>();
  const tokens = output.split("\0");
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined || token.length < 4) continue;
    const status = token.slice(0, 2);
    files.add(token.slice(3));
    if (status.includes("R") || status.includes("C")) i += 1;
  }
  return [...files].sort();
}

/**
 * Every path with uncommitted state — staged, unstaged, and untracked —
 * repo-root-relative, `/`-separated (git's own output format), sorted.
 * Language filtering (.ts/.tsx/.mts/.cts) is the pipeline's concern, not git's.
 */
export function uncommittedFiles(cwd: string): GitResult<string[]> {
  const result = git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, value: parsePorcelainZ(result.value) };
}

export type FileGitStatus = "committed" | "modified" | "untracked";

/**
 * Git status of ONE existing file: `committed` (clean), `modified` (any
 * staged/unstaged change to a tracked file), or `untracked`. The caller
 * handles absence — a file that does not exist has no git status.
 */
export function fileGitStatus(cwd: string, relPath: string): GitResult<FileGitStatus> {
  const result = git(cwd, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    relPath,
  ]);
  if (!result.ok) return { ok: false, reason: result.reason };
  if (parsePorcelainZ(result.value).length === 0) return { ok: true, value: "committed" };
  return { ok: true, value: result.value.startsWith("??") ? "untracked" : "modified" };
}
