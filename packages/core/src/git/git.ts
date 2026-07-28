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

/**
 * A ref beginning with `-` is consumed by git as an option. Refs come from
 * `--branch`/`--pr` input, so this is an argument-injection boundary: rejected
 * with a typed reason BEFORE any spawn, and every ref is additionally passed
 * after `--` (or `--end-of-options` for the plumbing that takes no pathspec).
 * Lives here, beside the spawn it guards, so no second path to git can skip
 * it; `worktree.ts` re-exports it for its 1.14 callers.
 */
export function refProblem(ref: string): string | undefined {
  if (ref.length === 0) return "ref is empty";
  if (ref.startsWith("-")) {
    return `ref ${JSON.stringify(ref)} begins with "-"; git would parse it as an option`;
  }
  return undefined;
}

/** Guards every ref in `refs` before a spawn; the first problem wins. */
function refsProblem(refs: readonly string[]): string | undefined {
  for (const ref of refs) {
    const problem = refProblem(ref);
    if (problem !== undefined) return problem;
  }
  return undefined;
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

// ---------------------------------------------------------------------------
// ref diffing (1.15) — named, bounded helpers, NOT a generic escape hatch
// ---------------------------------------------------------------------------

/** Passed per-invocation, never written into the user's repo config: a git
 * command that walks worktree files fails on Windows ("Filename too long")
 * once a path crosses 260 chars, and a worktree base plus a deep
 * repo-relative path is exactly how that happens (SPIKE-5 finding 1). */
const LONGPATHS = ["-c", "core.longpaths=true"] as const;

/**
 * Splits NUL-terminated git output (`-z`) into non-empty entries, sorted.
 * `-z` rather than newline parsing because a path may legally contain a
 * newline, and git quotes such paths in the newline format — a quoted path
 * would then be analyzed under a name no file has.
 */
function parseZ(output: string): string[] {
  return [...new Set(output.split("\0").filter((entry) => entry.length > 0))].sort();
}

/**
 * Resolves a commit-ish to its COMMIT sha. `--end-of-options` is the
 * terminator for plumbing that takes no pathspec (`--` there would mean
 * "paths follow").
 *
 * `^{commit}` peels: an ANNOTATED tag resolves to the tag OBJECT's sha, which
 * never equals `headSha()` even when the tag points exactly at HEAD — the
 * unpeeled answer would build a worktree for a ref that IS the current HEAD
 * and silently review a tree without the user's uncommitted state. Peeling
 * also makes a ref pointing at a tree/blob "not found", which is correct here:
 * every ref this tool accepts must be reviewable, i.e. a commit.
 */
export function revParse(cwd: string, ref: string): GitResult<string> {
  const problem = refProblem(ref);
  if (problem !== undefined) return { ok: false, reason: problem };
  const result = git(cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
  if (!result.ok) return { ok: false, reason: result.reason || `ref not found: ${ref}` };
  const sha = result.value.trim();
  // `--quiet` makes an unknown ref exit 1 with empty stdout on some git
  // versions and 0 on others: an empty answer is "not found", never a sha.
  if (sha.length === 0) return { ok: false, reason: `ref not found: ${ref}` };
  return { ok: true, value: sha };
}

/** The checked-out branch name. A detached HEAD has no branch, which is a
 * typed failure rather than the literal "HEAD" — `--branch` with no value
 * must not silently review a ref the user cannot name. */
export function currentBranch(cwd: string): GitResult<string> {
  const result = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!result.ok) return { ok: false, reason: result.reason };
  const branch = result.value.trim();
  if (branch === "HEAD" || branch.length === 0) {
    return { ok: false, reason: "HEAD is detached — pass --branch <ref> explicitly" };
  }
  return { ok: true, value: branch };
}

/** Whether a ref resolves locally. No network: a PR ref that was never
 * fetched is simply absent, and the caller reports the fetch command. */
export function refExists(cwd: string, ref: string): boolean {
  return revParse(cwd, ref).ok;
}

/** Best common ancestor of two commit-ishes — the diff base for the branch
 * and PR scopes, so a review shows what the branch ADDS rather than what the
 * base moved on to. */
export function mergeBase(cwd: string, a: string, b: string): GitResult<string> {
  const problem = refsProblem([a, b]);
  if (problem !== undefined) return { ok: false, reason: problem };
  const result = git(cwd, ["merge-base", "--end-of-options", a, b]);
  if (!result.ok) return { ok: false, reason: `no merge base between ${a} and ${b}: ${result.reason}` };
  return { ok: true, value: result.value.trim() };
}

/** A ref-to-ref diff, split by what the paths ARE at `to`. */
export interface RefDiff {
  /** Paths that exist at `to` (added, modified, renamed-to, …), sorted. */
  changed: string[];
  /** Paths git reports as DELETED at `to`, sorted. */
  deleted: string[];
}

/**
 * Paths differing between two commit-ishes — repo-relative, `/`-separated
 * (git's own output format), deduped and sorted, and split into present and
 * DELETED.
 *
 * `--name-status`, not `--name-only`: without the status a caller can only
 * discover a deletion by failing to read the file, which makes a
 * permission-denied or locked file indistinguishable from a deleted one —
 * silent coverage loss that reads as a clean review. Only `D` is a deletion
 * here; every other unreadable path is the caller's degradation to declare.
 */
export function diffRefs(cwd: string, from: string, to: string): GitResult<RefDiff> {
  const problem = refsProblem([from, to]);
  if (problem !== undefined) return { ok: false, reason: problem };
  const result = git(cwd, [...LONGPATHS, "diff", "--name-status", "-z", from, to, "--"]);
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, value: parseNameStatusZ(result.value) };
}

/**
 * Parses `git diff --name-status -z`: `<status>\0<path>\0` pairs, except
 * rename/copy entries (`R###`/`C###`), which carry TWO paths — origin then
 * destination. The destination is the path that exists at `to`; the origin is
 * gone, exactly like the porcelain rename handling above. Exported as the
 * unit-test seam for the format.
 */
export function parseNameStatusZ(output: string): RefDiff {
  const changed = new Set<string>();
  const deleted = new Set<string>();
  const tokens = output.split("\0");
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const status = tokens[i] as string;
    if (status.length === 0) continue;
    if (status.startsWith("R") || status.startsWith("C")) {
      // origin at i+1, destination at i+2 — consume the extra token.
      const destination = tokens[i + 2];
      if (destination !== undefined && destination.length > 0) changed.add(destination);
      i += 1;
      continue;
    }
    const file = tokens[i + 1] as string;
    if (file.length === 0) continue;
    if (status.startsWith("D")) deleted.add(file);
    else changed.add(file);
  }
  return { changed: [...changed].sort(), deleted: [...deleted].sort() };
}

/** Every tracked path in `cwd`'s work tree — the `project` scope's change
 * set (the whole project, not a diff). */
export function lsFiles(cwd: string): GitResult<string[]> {
  const result = git(cwd, [...LONGPATHS, "ls-files", "-z", "--"]);
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, value: parseZ(result.value) };
}

/**
 * The repository's own default branch, in DECLARED order:
 * `refs/remotes/origin/HEAD` (what the remote says), then `origin/main`,
 * `main`, `master`. Everything after the first is a GUESS — the caller
 * declares which one was picked as a degradation, because a wrong base
 * silently changes what "the branch changed" means. No network: only refs
 * already present locally are considered.
 */
export const DEFAULT_BASE_CANDIDATES = [
  "refs/remotes/origin/HEAD",
  "origin/main",
  "main",
  "master",
] as const;

export function resolveDefaultBase(cwd: string): GitResult<{ ref: string; guessed: boolean }> {
  for (const candidate of DEFAULT_BASE_CANDIDATES) {
    if (refExists(cwd, candidate)) {
      return { ok: true, value: { ref: candidate, guessed: candidate !== "refs/remotes/origin/HEAD" } };
    }
  }
  return {
    ok: false,
    reason: `no default base branch found (tried ${DEFAULT_BASE_CANDIDATES.join(", ")}) — pass --base <ref>`,
  };
}

/** What `commitPath` did. `unchanged` is the deterministic re-run: the exact
 * artifact bytes are already in HEAD, so there is nothing to commit — a
 * SUCCESS, not the failure a bare `git commit` exit status looks like. */
export interface CommitPathOutcome {
  state: "committed" | "unchanged";
  /** git's own stdout for the commit (empty for `unchanged`). */
  output: string;
}

/**
 * Commits exactly ONE path (1.15's commit disposition). Two bounded steps:
 * `add -f` (the artifact lives under a `reviews/` tree `init` gitignores by
 * design — force-adding that one file is what "commit" means here, and the
 * `.gitignore` is never edited), then a PATHSPEC-LIMITED commit, so whatever
 * else the user has staged stays staged and uncommitted. Never `add -A`.
 *
 * `--no-verify`: this is a MACHINE-written artifact, not user work, and the
 * contract says the disposition must not touch the user's index or any other
 * file. A lint-staged/prettier-style `pre-commit` hook does exactly that — it
 * runs against the user's main index during our partial commit and can stage
 * or rewrite files we never asked about. The hook still guards everything the
 * user commits; it is bypassed only for this one generated file.
 */
export function commitPath(
  repoRoot: string,
  relPath: string,
  message: string,
): GitResult<CommitPathOutcome> {
  // A detached HEAD commits SUCCESSFULLY and leaves an orphan no branch points
  // at — a "committed" report over a commit the user will never find again.
  // `symbolic-ref` is the exact test: it succeeds on an unborn branch (HEAD
  // points at a ref that has no commit yet) and fails only when detached.
  if (!git(repoRoot, ["symbolic-ref", "--quiet", "HEAD"]).ok) {
    return {
      ok: false,
      reason: "HEAD is detached — a commit here would be orphaned (no branch points at it)",
    };
  }
  const added = git(repoRoot, ["add", "-f", "--", relPath]);
  if (!added.ok) return { ok: false, reason: added.reason };
  // Deterministic re-run: identical inputs rewrite identical artifact bytes,
  // so on the second commit disposition `add` stages nothing and the
  // pathspec-limited commit exits 1 with "nothing to commit" — on STDOUT, so
  // the reason would degrade to a bare exit status and a bogus temp copy.
  // Exit 0 from `diff --cached --quiet` means "nothing staged for this path".
  if (git(repoRoot, ["diff", "--cached", "--quiet", "--", relPath]).ok) {
    return { ok: true, value: { state: "unchanged", output: "" } };
  }
  const committed = git(repoRoot, ["commit", "--no-verify", "-m", message, "--", relPath]);
  if (!committed.ok) {
    // A commit that failed (a hook `--no-verify` does not bypass, a partial
    // commit mid-merge, an index lock) must not leave the artifact STAGED
    // behind it — that is precisely the ambient mutation the disposition
    // contract forbids.
    // ponytail: modern git resets an unborn branch's index entry fine, so the
    // `rm --cached` fallback is belt-and-braces for older git; drop it if the
    // supported git floor ever rises past it.
    if (!git(repoRoot, ["reset", "-q", "--", relPath]).ok) {
      git(repoRoot, ["rm", "--cached", "-q", "--force", "--", relPath]);
    }
    return { ok: false, reason: committed.reason };
  }
  return { ok: true, value: { state: "committed", output: committed.value } };
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
