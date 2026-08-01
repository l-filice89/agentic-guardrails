/**
 * Worktree isolation lifecycle (Story 1.14 / SPIKE-5) — the primitive Story
 * 1.15 consumes for branch/PR scopes.
 *
 * Contract: `withWorktree()` creates a detached worktree at a target ref,
 * runs the caller's callback inside it, and removes it — on return, on throw,
 * on rejection. Removal is `git worktree remove --force` + a filesystem
 * fallback, retried with bounded backoff (held handles are transient in the
 * common case); a removal that still fails is a TYPED degradation, never a
 * silent leak — and the residue stays discoverable by `reclaimWorktrees()` by
 * construction (tool name prefix inside the tool's repo-namespaced base
 * directory), which is what makes a SIGKILLed run recoverable: a killed
 * process never runs its cleanup.
 *
 * Windows behaviour this encodes (measured on git 2.39.1.windows.1, see
 * docs/spikes/SPIKE-5-windows-worktree-lifecycle.md):
 * - `-c core.longpaths=true` is REQUIRED on add/remove: without it a checkout
 *   containing a >260-char path fails with "Filename too long".
 * - A long BASE path is unfixable — git fails with "$GIT_DIR too big" even
 *   with `core.longpaths`. The base is therefore length-gated and degrades to
 *   a declared alternative rather than failing.
 * - A failed `worktree remove` can still UNREGISTER the worktree while
 *   leaving the directory behind, so removal falls back to a filesystem
 *   delete and re-checks both halves (registry AND directory) before
 *   declaring success. A registry read that FAILS is "unknown", never "gone".
 * - Worktree directory names are `agtwt-<sha256(ref)[:12]>-<random hex>` —
 *   never the ref text, which would make `foo` and `FOO` the same directory
 *   on a case-insensitive filesystem. The ref hash gives case separation; the
 *   random suffix keeps two concurrent scopes at the SAME ref apart.
 *
 * Ownership discipline (this module deletes things, so the bound is the
 * design): a directory is reclaimable only when it is (a) prefixed
 * `agtwt-`, (b) inside THIS repository's namespaced base directory, (c) not in
 * use by this process (`liveWorktrees`) NOR by another live process (the
 * `.agtwt-live` pid marker — registered-but-unidentifiable is declared
 * `in-use`, never removed), (d) not the invoking worktree, (e) not locked by a
 * human, and (f) either unregistered-with-no-`.git` or pointing its `.git`
 * back at this repository's common git dir. Anything else is DECLARED, not
 * deleted.
 *
 * Known ceiling: git is spawned with `spawnSync`, so removal + backoff blocks
 * the event loop for its whole duration. ponytail: acceptable while the
 * lifecycle wraps one scope at a time; move to `execFile` + promises before
 * running scopes concurrently in one process.
 */
import { createHash, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { gitCommand, refProblem, type GitResult } from "./git.js";

// The ref guard lives beside the spawn it protects (`git.ts`, 1.15) so the
// ref-diffing helpers cannot grow a second path to git that skips it; it is
// re-exported here for 1.14's callers.
export { refProblem };

/** Directory-name prefix that marks a worktree as created by this tool.
 * Reclamation is bounded to `prefix` + the tool's base dir — a human-created
 * worktree is never touched. */
export const WORKTREE_PREFIX = "agtwt-";

/** Prefix of the write-probe files `prepareWorktreeBase` drops in a candidate
 * base. Tool-prefixed so a process killed mid-probe leaves residue that
 * reclamation can recognise and sweep. */
export const PROBE_PREFIX = `.${WORKTREE_PREFIX}probe-`;

/**
 * Longest base directory accepted. Git on Windows cannot create a worktree
 * under a long base at all (`$GIT_DIR too big`), so a long base degrades to
 * the alternative base instead of producing a partial tree.
 *
 * This is a deliberately CONSERVATIVE bound, not the measured cliff: the real
 * failure point depends on the deepest tracked path in the repository being
 * checked out (base + longest repo-relative path is what overflows git's
 * buffer), so no single constant can be exact. SPIKE-5's harness binary
 * searches the actual threshold on the running machine and records it; on the
 * gate machine it sat far above this value, leaving headroom for a deep repo.
 */
export const MAX_BASE_PATH_LENGTH = 160;

/** `core.longpaths` is set per-invocation rather than mutating the user's
 * repo config — the tool never writes to the invoking repository. */
const LONGPATHS = ["-c", "core.longpaths=true"] as const;

const DEFAULT_REMOVE_ATTEMPTS = 4;
const DEFAULT_REMOVE_DELAY_MS = 150;
/** Clamp: 0 attempts would report a failure it never tried, and an unbounded
 * value would back off exponentially forever. */
const MIN_REMOVE_ATTEMPTS = 1;
const MAX_REMOVE_ATTEMPTS = 10;

export type WorktreeDegradationKind =
  | "base-dir-degraded"
  | "removal-failed"
  | "reclaim-failed"
  | "locked"
  | "unowned"
  /** A REGISTERED tool worktree whose liveness cannot be established (no
   * readable pid marker): possibly another process's live scope, so it is
   * declared rather than deleted. */
  | "in-use";

export interface WorktreeDegradation {
  kind: WorktreeDegradationKind;
  /** The path the degradation is about (base dir or worktree path). */
  subject: string;
  reason: string;
}

/**
 * Adapter to the project's canonical degradation contract
 * (`@agentic-guardrails/contracts` `Degradation` = `{ reason, subject }`),
 * which has no `kind` field. The kind is folded into `reason` as a stable
 * machine-greppable prefix so a run manifest can carry a worktree degradation
 * like any other declared one, without losing the classification.
 */
export function toManifestDegradation(degradation: WorktreeDegradation): {
  reason: string;
  subject: string;
} {
  return { subject: degradation.subject, reason: `${degradation.kind}: ${degradation.reason}` };
}

/** Inverse of {@link toManifestDegradation} — the round-trip the manifest
 * boundary needs to reclassify a degradation it read back. */
export function fromManifestDegradation(degradation: {
  reason: string;
  subject: string;
}): WorktreeDegradation {
  const match = /^([a-z-]+): ([\s\S]+)$/.exec(degradation.reason);
  const kind = match?.[1];
  if (match === null || !isDegradationKind(kind)) {
    return { kind: "reclaim-failed", subject: degradation.subject, reason: degradation.reason };
  }
  return { kind, subject: degradation.subject, reason: match[2] as string };
}

const DEGRADATION_KINDS: readonly WorktreeDegradationKind[] = [
  "base-dir-degraded",
  "removal-failed",
  "reclaim-failed",
  "locked",
  "unowned",
  "in-use",
];

function isDegradationKind(value: string | undefined): value is WorktreeDegradationKind {
  return value !== undefined && (DEGRADATION_KINDS as readonly string[]).includes(value);
}

export interface WorktreeEntry {
  /** Absolute path, platform-normalized (git reports `/`-separated). */
  path: string;
  locked: boolean;
}

// ---------------------------------------------------------------------------
// git wrapper additions
// ---------------------------------------------------------------------------

export function worktreeAdd(repoRoot: string, worktreePath: string, ref: string): GitResult<string> {
  const problem = refProblem(ref);
  if (problem !== undefined) return { ok: false, reason: problem };
  return gitCommand(repoRoot, [
    ...LONGPATHS,
    "worktree",
    "add",
    "--detach",
    "--",
    worktreePath,
    ref,
  ]);
}

/** `force` (the lifecycle removing its OWN worktree) passes `--force` twice,
 * which is what git requires to remove a LOCKED worktree. Reclamation never
 * passes it: a human's lock is honoured. */
export function worktreeRemove(
  repoRoot: string,
  worktreePath: string,
  force = false,
): GitResult<string> {
  return gitCommand(repoRoot, [
    ...LONGPATHS,
    "worktree",
    "remove",
    ...(force ? ["--force", "--force"] : ["--force"]),
    "--",
    worktreePath,
  ]);
}

export function worktreePrune(repoRoot: string): GitResult<string> {
  return gitCommand(repoRoot, ["worktree", "prune"]);
}

/** Every registered worktree INCLUDING the invoking tree (git lists it first). */
export function worktreeList(repoRoot: string): GitResult<WorktreeEntry[]> {
  const result = gitCommand(repoRoot, ["worktree", "list", "--porcelain"]);
  if (!result.ok) return result;
  return { ok: true, value: parseWorktreeList(result.value) };
}

/** Parses `git worktree list --porcelain`: NUL-free records separated by a
 * blank line, each starting with `worktree <path>`. Exported as the unit-test
 * seam for the porcelain format. */
export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const record of output.split(/\r?\n\r?\n/)) {
    const lines = record.split(/\r?\n/).filter((line) => line.length > 0);
    const worktreeLine = lines.find((line) => line.startsWith("worktree "));
    if (worktreeLine === undefined) continue;
    entries.push({
      path: path.resolve(worktreeLine.slice("worktree ".length)),
      locked: lines.some((line) => line === "locked" || line.startsWith("locked ")),
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

/** Case-insensitive on win32 — `C:\Temp\X` and `c:\temp\x` are one path. */
function canonical(target: string): string {
  const resolved = path.resolve(target);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** True when `child` is strictly under `parent`. `path.relative` rather than a
 * prefix comparison so a drive root (`C:\`) and a trailing separator both
 * behave. */
function isInside(child: string, parent: string): boolean {
  const relative = path.relative(canonical(parent), canonical(child));
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * `\\?\` prefix so `fs` can reach a path past the Win32 `MAX_PATH` limit of
 * 260. Exported since 1.15: the pipeline reads reviewed files out of a
 * worktree, where a deep repo-relative path plus the base can cross the limit
 * — and an `fs` failure there would be misread as "the file was deleted".
 * The threshold is 240, not 260: `MAX_PATH` counts the terminating NUL
 * and a directory being created must leave room for `\` plus an 8.3 name, so
 * the documented safe headroom for a DIRECTORY is `MAX_PATH - 12`. UNC paths
 * take the `\\?\UNC\server\share\…` spelling — `\\?\\\server\share` is not a
 * valid Win32 path.
 */
export function fsPath(target: string): string {
  const resolved = path.resolve(target);
  if (process.platform !== "win32" || resolved.length < 240 || resolved.startsWith("\\\\?\\")) {
    return resolved;
  }
  if (resolved.startsWith("\\\\")) return `\\\\?\\UNC\\${resolved.slice(2)}`;
  return `\\\\?\\${resolved}`;
}

/** Hashed, never the ref text: `foo` and `FOO` must not become one directory
 * on a case-insensitive filesystem. The ref component is hex only, so the
 * name itself is case-fold-stable while the hash stays case-SENSITIVE; the
 * random suffix keeps two concurrent scopes at the SAME ref apart. */
function worktreeName(ref: string): string {
  return `${WORKTREE_PREFIX}${refHash(ref)}-${randomBytes(3).toString("hex")}`;
}

/** The ref-derived component of a worktree directory name. Exported as the
 * seam SPIKE-5 asserts on: two refs that differ only in case MUST produce
 * different values here, and the same ref MUST produce the same value. */
export function refHash(ref: string): string {
  return createHash("sha256").update(ref).digest("hex").slice(0, 12);
}

const isToolWorktree = (target: string, baseDirs: readonly string[]): boolean =>
  path.basename(target).startsWith(WORKTREE_PREFIX) &&
  baseDirs.some((baseDir) => isInside(target, baseDir));

/** `lstat`, not `existsSync`: `existsSync` reports `false` for a permission
 * error, which would let removal declare success over a directory that is
 * still there. Anything other than ENOENT means PRESENT. */
function present(target: string): boolean {
  try {
    lstatSync(fsPath(target));
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

/**
 * Worktrees this process is using RIGHT NOW. Reclamation skips them, so the
 * reclaim-before-create step can never delete a live sibling scope — the
 * intended path is registered BEFORE `worktree add` so a concurrent in-process
 * sweep cannot catch the creation window.
 *
 * In-process only BY DESIGN; the cross-process half is {@link LIVE_MARKER_NAME}
 * below, which is what a sibling process can actually see.
 */
const liveWorktrees = new Set<string>();

/**
 * Cross-process liveness marker: a file inside each created worktree holding
 * the creating process's pid.
 *
 * Without it, `liveWorktrees` is the ONLY liveness signal and it is
 * in-process — so a second `guardrails` run on the SAME repository sees the
 * first run's registered, correctly-owned, unlocked worktree as residue and
 * removes it mid-analysis. (The repo-namespaced base already stops that
 * happening ACROSS repositories; 1.15 is the first consumer that makes the
 * same-repo axis reachable.)
 *
 * ponytail: pid liveness, not a lease — a pid recycled by an unrelated
 * process keeps its worktree un-reclaimable until a human removes it. A
 * timestamped lease is the upgrade if that ever bites.
 */
export const LIVE_MARKER_NAME = ".agtwt-live";

type Liveness = "live" | "dead" | "unknown";

/** Reads the pid marker and asks the OS whether that process still exists.
 * `unknown` (no marker, unreadable, or unparseable) is deliberately NOT
 * "dead": on a REGISTERED worktree the caller treats it as possibly-live. */
function livenessOf(worktreePath: string): Liveness {
  let raw: string;
  try {
    raw = readFileSync(fsPath(path.join(worktreePath, LIVE_MARKER_NAME)), "utf8");
  } catch {
    return "unknown";
  }
  const pid = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) return "unknown";
  try {
    // Signal 0 tests existence without delivering anything (Windows included).
    process.kill(pid, 0);
    return "live";
  } catch (error) {
    // EPERM = the process exists but belongs to another user: still LIVE.
    return (error as NodeJS.ErrnoException).code === "EPERM" ? "live" : "dead";
  }
}

/** Drops the marker into a freshly created worktree. A failure is not fatal:
 * this process still holds the path in `liveWorktrees`, and a sibling seeing
 * a registered worktree with no readable marker declares it rather than
 * removing it. */
function writeLiveMarker(worktreePath: string): void {
  try {
    writeFileSync(fsPath(path.join(worktreePath, LIVE_MARKER_NAME)), `${process.pid}\n`);
  } catch {
    // Declared by the reader, not here — see livenessOf.
  }
}

// ---------------------------------------------------------------------------
// base directory
// ---------------------------------------------------------------------------

export interface WorktreeBaseOptions {
  /** Preferred base ROOT. Default: OS temp — short, outside the repo,
   * uncommitted. The effective base is always `<root>/<repo hash>`. */
  baseDir?: string;
  /** Declared alternative root when the preferred one is unusable. */
  fallbackBaseDir?: string;
}

export type BaseDirResult =
  | {
      ok: true;
      /** The base actually used (already repo-namespaced, created, probed). */
      baseDir: string;
      /** The namespaced preferred base, whether or not it was usable — the
       * previously-used base still has to be swept after a degrade. */
      preferredBaseDir: string;
      degradation?: WorktreeDegradation;
    }
  | { ok: false; reason: string };

const defaultBaseRoot = (): string => path.join(os.tmpdir(), "agentic-guardrails-worktrees");
const defaultFallbackBaseRoot = (): string =>
  path.join(os.homedir(), ".agentic-guardrails", "worktrees");

/**
 * PURE: the effective base directory for one repository under a base root.
 *
 * The root (OS temp by default) is shared by every process AND every
 * repository on the machine, so ownership by prefix alone is not enough — a
 * second guardrails process reviewing a DIFFERENT repo would see the first
 * one's live worktree as residue. Namespacing by a hash of the canonical repo
 * root means one repository's sweep can never even SEE another's directories.
 */
export function worktreeBaseDir(repoRoot: string, baseRoot: string): string {
  const namespaceHash = createHash("sha256").update(canonical(repoRoot)).digest("hex").slice(0, 12);
  return path.join(path.resolve(baseRoot), namespaceHash);
}

/** Usable = short enough for git on Windows, creatable, and writable —
 * proven by an actual probe write, not by a permission bit. */
export function baseDirLengthProblem(
  candidate: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform === "win32" && candidate.length > MAX_BASE_PATH_LENGTH) {
    return `base path is ${candidate.length} chars (max ${MAX_BASE_PATH_LENGTH}); git cannot create a worktree under a long base on Windows`;
  }
  return undefined;
}

function baseDirProblem(candidate: string): string | undefined {
  const lengthProblem = baseDirLengthProblem(candidate);
  if (lengthProblem !== undefined) return lengthProblem;
  const probe = path.join(candidate, `${PROBE_PREFIX}${process.pid}-${randomBytes(2).toString("hex")}`);
  try {
    mkdirSync(fsPath(candidate), { recursive: true });
    writeFileSync(fsPath(probe), "");
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    try {
      rmSync(fsPath(probe), { force: true });
    } catch {
      // Swept by reclamation: the probe carries the tool prefix by design.
    }
  }
}

/**
 * Resolves AND PREPARES (creates + probe-writes) the base directory,
 * degrading to the declared alternative when the preferred one is unusable
 * (permission, missing, or too long). A degrade is always declared with its
 * reason — never silent. Named `prepare…` because it has side effects; use
 * {@link worktreeBaseDir} when only the path is wanted.
 */
export function prepareWorktreeBase(
  repoRoot: string,
  options: WorktreeBaseOptions = {},
): BaseDirResult {
  const preferred = worktreeBaseDir(repoRoot, options.baseDir ?? defaultBaseRoot());
  const preferredProblem = baseDirProblem(preferred);
  if (preferredProblem === undefined) {
    return { ok: true, baseDir: preferred, preferredBaseDir: preferred };
  }

  const fallback = worktreeBaseDir(repoRoot, options.fallbackBaseDir ?? defaultFallbackBaseRoot());
  const fallbackProblem = baseDirProblem(fallback);
  if (fallbackProblem !== undefined) {
    return {
      ok: false,
      reason: `no usable worktree base: ${preferred} (${preferredProblem}); ${fallback} (${fallbackProblem})`,
    };
  }
  return {
    ok: true,
    baseDir: fallback,
    preferredBaseDir: preferred,
    degradation: {
      kind: "base-dir-degraded",
      subject: preferred,
      reason: `${preferredProblem} — degraded to ${fallback}`,
    },
  };
}

// ---------------------------------------------------------------------------
// removal
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface RemoveOptions {
  attempts?: number;
  delayMs?: number;
  /** The caller OWNS this worktree (the lifecycle removing its own scope) and
   * may force through a lock. Reclamation never sets it. */
  force?: boolean;
}

export interface RemoveResult {
  /** How many attempts were consumed. `> 1` proves a removal was genuinely
   * blocked and recovered — the assertion SPIKE-5's transient-hold scenario
   * needs to know it was injected at all. */
  attempts: number;
  /** Absent when the worktree is fully gone (unregistered AND no directory). */
  degradation?: WorktreeDegradation;
}

type Registration =
  | { state: "registered"; locked: boolean }
  | { state: "absent" }
  | { state: "unknown"; reason: string };

/**
 * Registry state of one path. A `git worktree list` FAILURE (git missing,
 * transient spawn failure, repo locked) is `unknown` — explicitly NOT
 * "absent", because treating a failed read as "gone" is exactly how a removal
 * reports success over a worktree that still exists.
 */
function registrationOf(repoRoot: string, worktreePath: string): Registration {
  const list = worktreeList(repoRoot);
  if (!list.ok) return { state: "unknown", reason: list.reason };
  const entry = list.value.find((item) => canonical(item.path) === canonical(worktreePath));
  return entry === undefined ? { state: "absent" } : { state: "registered", locked: entry.locked };
}

/**
 * Removes ONE worktree, reporting how many attempts it cost and a typed
 * degradation when it is not fully gone. Both halves (registry AND directory)
 * are checked because a failed `git worktree remove` on Windows can
 * unregister the worktree while leaving its directory behind — so git's exit
 * status alone is not evidence of a clean removal, and neither is a registry
 * read that failed.
 */
export async function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  options: RemoveOptions = {},
): Promise<RemoveResult> {
  const attempts = Math.min(
    MAX_REMOVE_ATTEMPTS,
    Math.max(MIN_REMOVE_ATTEMPTS, options.attempts ?? DEFAULT_REMOVE_ATTEMPTS),
  );
  const delayMs = options.delayMs ?? DEFAULT_REMOVE_DELAY_MS;
  const force = options.force === true;
  let lastReason = "unknown";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(delayMs * 2 ** (attempt - 2));

    const registration = registrationOf(repoRoot, worktreePath);
    if (registration.state === "registered" && registration.locked && !force) {
      // An explicit `git worktree lock` is a human saying "do not remove
      // this". Reclamation honours it and declares it; only the lifecycle's
      // OWN worktree is ever forced through a lock.
      return {
        attempts: attempt,
        degradation: {
          kind: "locked",
          subject: worktreePath,
          reason: "worktree is locked (git worktree lock) — skipped, not removed",
        },
      };
    }
    if (registration.state !== "absent") {
      const removed = worktreeRemove(repoRoot, worktreePath, force);
      if (!removed.ok) lastReason = removed.reason;
      if (registration.state === "unknown") {
        lastReason = `worktree registry unreadable: ${registration.reason}`;
      }
    }
    if (present(worktreePath)) {
      // Registry says gone (or git refused) but the tree is still on disk:
      // delete it directly, tolerating the transient Windows EPERM/EBUSY.
      try {
        rmSync(fsPath(worktreePath), { recursive: true, force: true, maxRetries: 3 });
      } catch (error) {
        lastReason = error instanceof Error ? error.message : String(error);
      }
    }
    if (present(worktreePath)) continue;

    let after = registrationOf(repoRoot, worktreePath);
    if (after.state === "registered") {
      // Scoped by NEED: prune is repo-wide, so it only runs when this
      // directory is gone while its registration lingers — the one case it
      // fixes. Registrations for other scopes whose directories still exist
      // are untouched by prune.
      worktreePrune(repoRoot);
      after = registrationOf(repoRoot, worktreePath);
    }
    if (after.state === "absent") return { attempts: attempt };
    if (after.state === "unknown") lastReason = `worktree registry unreadable: ${after.reason}`;
  }

  return {
    attempts,
    degradation: {
      kind: "removal-failed",
      subject: worktreePath,
      reason: `worktree not removed after ${attempts} attempts: ${lastReason} (left for reclamation)`,
    },
  };
}

// ---------------------------------------------------------------------------
// reclamation
// ---------------------------------------------------------------------------

export interface ReclaimOptions extends WorktreeBaseOptions, RemoveOptions {
  repoRoot: string;
}

export interface ReclaimResult {
  /** Base dir actually scanned (may be the declared alternative). */
  baseDir: string;
  /** Paths removed, sorted. */
  reclaimed: string[];
  degradations: WorktreeDegradation[];
}

/** `<repo>/.git` for a normal checkout, the MAIN repo's `.git` when the
 * invoking root is itself a linked worktree — the directory every worktree of
 * this repository points its `.git` file at. */
function gitCommonDir(repoRoot: string): string | undefined {
  const result = gitCommand(repoRoot, ["rev-parse", "--git-common-dir"]);
  if (!result.ok) return undefined;
  return path.resolve(repoRoot, result.value.trim());
}

/**
 * Belt and braces on top of the namespaced base: a worktree's `.git` is a
 * `gitdir:` pointer back at the repository that owns it. If it points
 * somewhere else — or cannot be read, or is a real `.git` DIRECTORY (a nested
 * clone) — the directory is NOT ours and is declared rather than deleted.
 * An ABSENT `.git` is ours: the namespaced base plus the tool prefix already
 * prove provenance, and a partial `worktree add` leaves exactly that.
 */
function ownedByRepo(target: string, commonDir: string | undefined): boolean {
  let raw: string;
  try {
    raw = readFileSync(fsPath(path.join(target, ".git")), "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
  const match = /^gitdir:\s*(.+)$/m.exec(raw);
  if (match === null || commonDir === undefined) return false;
  const gitdir = path.resolve(target, (match[1] as string).trim());
  return canonical(gitdir) === canonical(commonDir) || isInside(gitdir, commonDir);
}

/** Removes the probe files `prepareWorktreeBase` drops. A process killed
 * mid-probe leaves one behind, and nothing else would ever collect it. */
function sweepProbes(baseDir: string, degradations: WorktreeDegradation[]): void {
  for (const entry of readdirIn(baseDir, degradations)) {
    if (!entry.name.startsWith(PROBE_PREFIX)) continue;
    try {
      rmSync(fsPath(path.join(baseDir, entry.name)), { force: true, recursive: true });
    } catch (error) {
      degradations.push({
        kind: "reclaim-failed",
        subject: path.join(baseDir, entry.name),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** A readdir failure is DECLARED, never swallowed: "I could not look" and
 * "there is nothing there" are different answers. A base that does not exist
 * yet is genuinely empty. */
function readdirIn(
  baseDir: string,
  degradations: WorktreeDegradation[],
): { name: string; directory: boolean }[] {
  try {
    return readdirSync(fsPath(baseDir), { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      // lstat-based: a junction/symlink is NOT isDirectory(), and prefixed
      // leftovers of any type must still be swept.
      directory: entry.isDirectory(),
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      degradations.push({
        kind: "reclaim-failed",
        subject: baseDir,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    return [];
  }
}

/**
 * Removes the residue of runs that never reached their cleanup (a SIGKILL
 * leaves both a registration and a directory) plus registrations git still
 * knows about whose directory is gone, plus directories the registry no
 * longer knows about. STRICTLY bounded by the ownership discipline documented
 * at the top of this file.
 */
export async function reclaimWorktrees(options: ReclaimOptions): Promise<ReclaimResult> {
  const base = prepareWorktreeBase(options.repoRoot, options);
  if (!base.ok) {
    return {
      baseDir: worktreeBaseDir(options.repoRoot, options.baseDir ?? defaultBaseRoot()),
      reclaimed: [],
      degradations: [{ kind: "reclaim-failed", subject: "base-dir", reason: base.reason }],
    };
  }
  const swept = await reclaimIn(options.repoRoot, baseSweepList(base), options);
  return {
    baseDir: base.baseDir,
    reclaimed: swept.reclaimed,
    degradations: [...(base.degradation ? [base.degradation] : []), ...swept.degradations],
  };
}

/** After a base degrade, residue in the previously-used base would otherwise
 * be orphaned forever — both bases are swept. */
function baseSweepList(base: { baseDir: string; preferredBaseDir: string }): string[] {
  return canonical(base.baseDir) === canonical(base.preferredBaseDir)
    ? [base.baseDir]
    : [base.baseDir, base.preferredBaseDir];
}

async function reclaimIn(
  repoRoot: string,
  baseDirs: readonly string[],
  options: RemoveOptions,
): Promise<{ reclaimed: string[]; degradations: WorktreeDegradation[] }> {
  const degradations: WorktreeDegradation[] = [];
  const reclaimed: string[] = [];
  const commonDir = gitCommonDir(repoRoot);

  const list = worktreeList(repoRoot);
  if (!list.ok) {
    degradations.push({ kind: "reclaim-failed", subject: repoRoot, reason: list.reason });
    return { reclaimed, degradations };
  }

  // Deduped by CANONICAL path: git's reported spelling and readdir's can
  // differ in case on Windows, and the same worktree twice burns the retry
  // budget twice.
  interface Target {
    path: string;
    registered: boolean;
    directory: boolean;
    /** `git worktree lock` — a human saying "do not remove this". */
    locked: boolean;
  }
  const targets = new Map<string, Target>();
  const add = (target: string, registered: boolean, directory: boolean, locked = false): void => {
    const key = canonical(target);
    const existing = targets.get(key);
    if (existing === undefined) targets.set(key, { path: target, registered, directory, locked });
    else {
      existing.registered ||= registered;
      existing.locked ||= locked;
    }
  };

  for (const entry of list.value) {
    if (isToolWorktree(entry.path, baseDirs)) add(entry.path, true, true, entry.locked);
  }
  for (const baseDir of baseDirs) {
    sweepProbes(baseDir, degradations);
    for (const entry of readdirIn(baseDir, degradations)) {
      if (!entry.name.startsWith(WORKTREE_PREFIX)) continue;
      add(path.resolve(baseDir, entry.name), false, entry.directory);
    }
  }

  for (const key of [...targets.keys()].sort()) {
    const target = targets.get(key) as Target;
    if (liveWorktrees.has(key)) continue;
    // Never reclaim the invoking worktree, whatever it is called or where it
    // sits: deleting it out from under the run is the worst outcome here.
    if (key === canonical(repoRoot)) continue;
    const liveness = livenessOf(target.path);
    // Another PROCESS's live scope. Silent, not declared: a concurrent run is
    // normal operation, and a reclaim degradation is a REAL degradation (exit
    // 2), so declaring it would let one run fail another's exit code.
    if (liveness === "live") continue;
    // Registered, on disk, and unidentifiable — the creation window between
    // `worktree add` and the marker write, an older residue, or a marker we
    // cannot read. Removing it could destroy a live sibling's analysis, so it
    // is declared and left for a human (`git worktree remove`). A
    // registration whose DIRECTORY is gone is nobody's live scope, and a
    // human-LOCKED one gets the more specific `locked` declaration below.
    if (liveness === "unknown" && target.registered && !target.locked && present(target.path)) {
      degradations.push({
        kind: "in-use",
        subject: target.path,
        reason: `registered worktree with no readable ${LIVE_MARKER_NAME} marker — liveness unknown, declared rather than removed`,
      });
      continue;
    }
    if (!target.directory && !target.registered) {
      // A prefixed FILE or symlink: never a worktree, still residue.
      try {
        rmSync(fsPath(target.path), { force: true, recursive: true });
        reclaimed.push(target.path);
      } catch (error) {
        degradations.push({
          kind: "reclaim-failed",
          subject: target.path,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }
    if (!target.registered && !ownedByRepo(target.path, commonDir)) {
      degradations.push({
        kind: "unowned",
        subject: target.path,
        reason: "prefixed directory whose .git does not point at this repository — declared, not removed",
      });
      continue;
    }
    const removal = await removeWorktree(repoRoot, target.path, { ...options, force: false });
    if (removal.degradation) degradations.push(removal.degradation);
    else reclaimed.push(target.path);
  }
  return { reclaimed, degradations };
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

export interface WithWorktreeOptions extends WorktreeBaseOptions, RemoveOptions {
  repoRoot: string;
  /** Any commit-ish; checked out DETACHED so a branch checked out elsewhere
   * (including in the invoking tree) never blocks the scope. */
  ref: string;
}

export type WithWorktreeResult<T> =
  | {
      ok: true;
      value: T;
      worktreePath: string;
      /** Attempts the removal consumed (1 = removed first try). */
      removalAttempts: number;
      degradations: WorktreeDegradation[];
    }
  | {
      ok: false;
      reason: string;
      /** Where residue would be, if any — a caller cannot report a leak it
       * cannot name. Absent only when no path was ever chosen. */
      worktreePath?: string;
      degradations: WorktreeDegradation[];
    };

/** Degradations attached to an error thrown OUT of `withWorktree`. The
 * callback's error propagates, so a removal that failed on that path has no
 * result object to live in — it rides on the error instead of vanishing. */
const DEGRADATIONS_ON_ERROR = Symbol.for("agentic-guardrails.worktreeDegradations");

/** Reads back the degradations {@link withWorktree} attached to a propagating
 * callback error. Empty when the removal succeeded (or the error came from
 * elsewhere). */
export function worktreeDegradationsOf(error: unknown): WorktreeDegradation[] {
  if (typeof error !== "object" || error === null) return [];
  const attached = (error as Record<symbol, unknown>)[DEGRADATIONS_ON_ERROR];
  return Array.isArray(attached) ? (attached as WorktreeDegradation[]) : [];
}

/**
 * Create → run → ALWAYS remove. The callback's own error propagates to the
 * caller (after removal, with any removal degradation attached to it); every
 * git/filesystem failure is a typed result.
 */
export async function withWorktree<T>(
  options: WithWorktreeOptions,
  run: (worktreePath: string) => T | Promise<T>,
): Promise<WithWorktreeResult<T>> {
  const refIssue = refProblem(options.ref);
  if (refIssue !== undefined) return { ok: false, reason: refIssue, degradations: [] };

  // Resolved ONCE per lifecycle: probing is I/O, and it used to run twice
  // (here and again inside reclaimWorktrees).
  const base = prepareWorktreeBase(options.repoRoot, options);
  if (!base.ok) return { ok: false, reason: base.reason, degradations: [] };
  const degradations: WorktreeDegradation[] = base.degradation ? [base.degradation] : [];

  const sweepBases = baseSweepList(base);
  const reclaim = await reclaimIn(options.repoRoot, sweepBases, options);
  degradations.push(...reclaim.degradations);

  const worktreePath = path.join(base.baseDir, worktreeName(options.ref));
  // Registered BEFORE the add: a concurrent in-process sweep must not be able
  // to delete a worktree inside its creation window.
  const key = canonical(worktreePath);
  liveWorktrees.add(key);

  const added = worktreeAdd(options.repoRoot, worktreePath, options.ref);
  if (!added.ok) {
    // A failed add can still leave a partial directory behind — and if THAT
    // cannot be removed either, the leak is declared, not dropped.
    const cleanup = await removeWorktree(options.repoRoot, worktreePath, {
      ...options,
      force: true,
    });
    liveWorktrees.delete(key);
    if (cleanup.degradation) degradations.push(cleanup.degradation);
    return { ok: false, reason: added.reason, worktreePath, degradations };
  }

  // Cross-process liveness, written as early as possible after the add: a
  // sibling process's sweep must see "in use", not "residue".
  writeLiveMarker(worktreePath);

  let value: T | undefined;
  let thrown: unknown;
  let threw = false;
  try {
    value = await run(worktreePath);
  } catch (error) {
    threw = true;
    thrown = error;
  }

  liveWorktrees.delete(key);
  const removal = await removeWorktree(options.repoRoot, worktreePath, { ...options, force: true });
  if (removal.degradation) degradations.push(removal.degradation);

  if (threw) {
    if (degradations.length > 0) {
      const throwable =
        typeof thrown === "object" && thrown !== null
          ? thrown
          : new Error(`worktree callback threw a non-Error value: ${String(thrown)}`, {
              cause: thrown,
            });
      (throwable as Record<symbol, unknown>)[DEGRADATIONS_ON_ERROR] = degradations;
      throw throwable;
    }
    throw thrown;
  }
  return {
    ok: true,
    value: value as T,
    worktreePath,
    removalAttempts: removal.attempts,
    degradations,
  };
}
