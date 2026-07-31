/**
 * Review scopes (Story 1.15, FR-25) — ONE resolver, four change-set
 * producers.
 *
 * A scope answers two questions that used to be hardcoded as the literal
 * `"uncommitted"`: WHICH files this run analyzes, and WHICH directory its
 * artifact is filed under. The resolver runs entirely against locally present
 * refs — no network operation of any kind (a PR ref that was never fetched is
 * a typed preflight failure carrying the exact `git fetch` command, never an
 * implicit fetch; remote flows are Epic 5).
 *
 * The artifact directory is a SLUG: lossy by construction, so it is never the
 * record of what was reviewed — `manifest.scope.ref` carries the ref verbatim.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { SCOPE_PATTERN, type Degradation, type ScopeKind } from "@agentic-guardrails/contracts";

import { foldCase } from "../util/fold-case.js";
import {
  currentBranch,
  changedLinesIn,
  diffNumstat,
  diffRefs,
  lsFiles,
  mergeBase,
  numstatAgainstHead,
  refExists,
  refProblem,
  resolveDefaultBase,
  uncommittedFiles,
  untrackedFiles,
  type GitResult,
} from "../git/git.js";
import { fsPath } from "../git/worktree.js";

// Single-sourced from contracts (see `scopeKindSchema`): the manifest's scope
// block, the trend record's `scopeKind` and this type cannot drift apart.
export type { ScopeKind };

/** What the CLI asked for, before any git resolution. */
export interface ScopeRequest {
  kind: ScopeKind;
  /** `branch`: the ref (absent → the checked-out branch). `pr`: the PR id. */
  ref?: string;
  /** `--base <ref>`: pins the diff base; never guessed when supplied. */
  base?: string;
}

export interface ResolvedScope {
  kind: ScopeKind;
  /** The artifact directory segment (`uncommitted`, `branch-{slug}`,
   * `pr-{id}`, `project`) — SCOPE_PATTERN-safe by construction. */
  slug: string;
  /** The reviewed ref, verbatim. Absent for `uncommitted` (the working tree
   * is not a ref). */
  ref?: string;
  /** Diff base, for the two diffing kinds. */
  base?: string;
  /** true → the base was resolved by the fallback order, not supplied. */
  baseGuessed?: boolean;
  /** PR id, for the `gh` metadata lookup. */
  prId?: string;
  /** Declared at resolution time (currently: a guessed base). */
  degradations: Degradation[];
}

export type ScopeResolution =
  | { ok: true; scope: ResolvedScope }
  | { ok: false; reason: string };

/** The engine's own output tree is never part of any reviewed change set — a
 * written artifact must not change the next run's identity. Applied ONCE,
 * downstream of every producer (see {@link changeSetFor}). */
export const EXCLUDED_PREFIX = "_agentic-guardrails/";

/**
 * Longest slug BODY (before the hash suffix). A ref name is unbounded — git
 * accepts hundreds of characters — and the slug becomes a directory under
 * `_agentic-guardrails/reviews/`, so an uncapped one blows past `MAX_PATH` /
 * `ENAMETOOLONG` and kills the run at persistence, AFTER the whole analysis
 * has been paid for. Truncation is lossy by definition, so a truncated slug
 * always carries the hash suffix and stays collision-free.
 */
export const MAX_SLUG_BODY = 48;

/**
 * Directory-safe rendering of a ref: lowercased, every unsafe run collapsed to
 * `-`, capped at {@link MAX_SLUG_BODY}. When the derivation is LOSSY (slug ≠
 * ref, truncation included) an 8-hex `sha256(ref)` suffix is appended, so
 * `feat/Foo` and `feat-foo` — or two 200-char refs sharing a prefix — can
 * never collide into one directory; a collision would file two different
 * reviews as each other's re-runs and silently overwrite them.
 */
export function slugForRef(ref: string): string {
  const body = ref
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_BODY)
    .replace(/-+$/g, "");
  if (body === ref && body.length > 0) return body;
  const suffix = createHash("sha256").update(ref).digest("hex").slice(0, 8);
  return body.length > 0 ? `${body}-${suffix}` : suffix;
}

/**
 * Resolves a CLI request into a concrete scope, against LOCAL refs only.
 * `repoRoot` is the invoking repository: refs, the default-base search and the
 * PR-ref probe all live there, never in a worktree.
 */
export function resolveScope(repoRoot: string, request: ScopeRequest): ScopeResolution {
  switch (request.kind) {
    case "uncommitted":
      return { ok: true, scope: { kind: "uncommitted", slug: "uncommitted", degradations: [] } };

    case "project": {
      // Not a diff: the whole tracked tree at HEAD. No ref means no worktree
      // and no checkout — `--project` reviews the tree the user is standing in.
      return { ok: true, scope: { kind: "project", slug: "project", degradations: [] } };
    }

    case "branch": {
      let ref = request.ref;
      if (ref === undefined) {
        const branch = currentBranch(repoRoot);
        if (!branch.ok) return { ok: false, reason: branch.reason };
        ref = branch.value;
      }
      const problem = refProblem(ref);
      if (problem !== undefined) return { ok: false, reason: problem };
      if (!refExists(repoRoot, ref)) return { ok: false, reason: `ref not found: ${ref}` };
      const base = resolveBase(repoRoot, request.base);
      if (!base.ok) return base;
      return {
        ok: true,
        scope: {
          kind: "branch",
          slug: scopeSegment(`branch-${slugForRef(ref)}`),
          ref,
          base: base.value.ref,
          baseGuessed: base.value.guessed,
          degradations: base.value.degradations,
        },
      };
    }

    case "pr": {
      const id = request.ref ?? "";
      // No leading zeros: `007` passes a bare digit test, probes
      // `refs/pull/007/head` (GitHub's real ref is `refs/pull/7/head`), files
      // into `reviews/pr-007/` — and `gh pr view 007` answers about PR 7. One
      // id, three different answers; rejected rather than silently rewritten.
      if (!/^[1-9][0-9]*$/.test(id)) {
        return {
          ok: false,
          reason: `invalid PR id: ${JSON.stringify(id)} (expected digits, no leading zeros)`,
        };
      }
      // LOCALLY PRESENT refs only, in declared order. Fetching would be a
      // network operation this story does not perform — the user is told the
      // exact command instead, so the failure is actionable without one.
      const candidates = [`refs/pull/${id}/head`, `refs/remotes/origin/pull/${id}/head`];
      const ref = candidates.find((candidate) => refExists(repoRoot, candidate));
      if (ref === undefined) {
        return {
          ok: false,
          reason:
            `PR ref for #${id} is not present locally (looked for ${candidates.join(", ")}) — ` +
            `fetch it first: git fetch origin pull/${id}/head:refs/pull/${id}/head`,
        };
      }
      const base = resolveBase(repoRoot, request.base);
      if (!base.ok) return base;
      return {
        ok: true,
        scope: {
          kind: "pr",
          slug: scopeSegment(`pr-${id}`),
          ref,
          base: base.value.ref,
          baseGuessed: base.value.guessed,
          prId: id,
          degradations: base.value.degradations,
        },
      };
    }
  }
}

/** An explicit `--base` is used verbatim (and guarded); otherwise the repo's
 * own default branch is resolved in the declared order, and anything below
 * the remote's own answer is DECLARED as a guess — a wrong base silently
 * changes what "this branch changed" means. */
function resolveBase(
  repoRoot: string,
  requested: string | undefined,
):
  | { ok: true; value: { ref: string; guessed: boolean; degradations: Degradation[] } }
  | { ok: false; reason: string } {
  if (requested !== undefined) {
    const problem = refProblem(requested);
    if (problem !== undefined) return { ok: false, reason: problem };
    if (!refExists(repoRoot, requested)) {
      return { ok: false, reason: `base ref not found: ${requested}` };
    }
    return { ok: true, value: { ref: requested, guessed: false, degradations: [] } };
  }
  const resolved = resolveDefaultBase(repoRoot);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  return {
    ok: true,
    value: {
      ref: resolved.value.ref,
      guessed: resolved.value.guessed,
      degradations: resolved.value.guessed
        ? [
            {
              reason: `diff base was not supplied and refs/remotes/origin/HEAD is absent — guessed ${resolved.value.ref}; pass --base <ref> to pin it`,
              subject: "scope-base",
            },
          ]
        : [],
    },
  };
}

/** The traversal guard on a directory name derived from untrusted ref text.
 * Slugging already produces a safe segment, so a failure here is an engine
 * bug, not user input — it must be loud rather than written to disk. */
function scopeSegment(segment: string): string {
  if (!SCOPE_PATTERN.test(segment)) {
    throw new Error(`computed scope segment is unsafe: ${JSON.stringify(segment)}`);
  }
  return segment;
}

/** One scope's change set, as repo-relative POSIX paths, sorted. */
export interface ChangeSet {
  /** Candidates to read and analyze. */
  files: string[];
  /** Paths git REPORTS as deleted at the reviewed ref. Only the ref-diffing
   * scopes can know this; empty for the others. */
  deleted: string[];
  /** true → the set came from COMMITS (`diff`), so every listed path exists at
   * the reviewed ref unless it is in `deleted`; a candidate that then cannot
   * be READ is lost coverage, not a deletion. */
  fromRefs: boolean;
  /** Exit-neutral declarations about the SET itself (currently: it is empty). */
  degradations: Degradation[];
}

/**
 * Membership test for the config `exclude` prefixes (Story 1.18): posix
 * repo-relative prefixes, whole-segment (an entry `tests/fixtures` never
 * matches `tests/fixtures2.ts`), trailing "/" tolerated, case folded with the
 * SAME rule every other path compare uses (git paths and configured prefixes
 * may disagree in case for one directory on win32/darwin).
 */
export function excludedBy(exclude: readonly string[]): (file: string) => boolean {
  const prefixes = exclude.map((p) => foldCase(p.replace(/\/+$/, "")));
  return (file: string): boolean => {
    const folded = foldCase(file);
    return prefixes.some((p) => folded === p || folded.startsWith(`${p}/`));
  };
}

/**
 * The change set for a resolved scope. `analyzeRoot` is where the files are —
 * the worktree for a ref that is not HEAD, the invoking repo otherwise.
 *
 * The `_agentic-guardrails/` exclusion lives HERE, once, downstream of all
 * four producers: every scope gets it, and no producer can forget it. The
 * config `exclude` prefixes apply at the same site for the same reason —
 * every scope, and NEVER silent: excluded files are counted and declared.
 */
export function changeSetFor(
  scope: ResolvedScope,
  analyzeRoot: string,
  exclude: readonly string[] = [],
): GitResult<ChangeSet> {
  const produced = produce(scope, analyzeRoot);
  if (!produced.ok) return produced;
  const mine = (file: string): boolean => !file.startsWith(EXCLUDED_PREFIX);
  // Per-prefix matchers so the declaration can name the prefixes that
  // ACTUALLY matched files this run — interpolating the whole configured
  // list would bloat the line and name prefixes that did nothing.
  const matchers = exclude.map((raw) => ({ raw, matches: excludedBy([raw]) }));
  const matched = new Set<string>();
  const isExcluded = (file: string): boolean => {
    let hit = false;
    for (const m of matchers) {
      if (m.matches(file)) {
        matched.add(m.raw);
        hit = true;
      }
    }
    return hit;
  };
  const candidateFiles = produced.value.files.filter(mine);
  const candidateDeleted = produced.value.deleted.filter(mine);
  const files = candidateFiles.filter((f) => !isExcluded(f));
  const deleted = candidateDeleted.filter((f) => !isExcluded(f));
  const degradations: Degradation[] = [];
  // Config-driven exclusion is DECLARED, never silent: the count and the
  // matching prefixes ride the exit-neutral channel (the run lost nothing —
  // the config says these files are not part of the reviewed change). The
  // count is taken HERE and covers the KLOC side too: `changeSizeFor`
  // measures the same diff range with the same predicate, so a file it
  // excludes is a file this change set excluded.
  const excludedCount =
    candidateFiles.length - files.length + (candidateDeleted.length - deleted.length);
  if (excludedCount > 0) {
    // Config order, so the same config always declares in the same shape.
    const names = exclude.filter((p) => matched.has(p));
    const shown = names.slice(0, 3).join(", ");
    const more = names.length > 3 ? `, +${names.length - 3} more` : "";
    degradations.push({
      reason:
        `${excludedCount} file(s) excluded from review by config exclude prefixes ` +
        `(${shown}${more}) — excluded files are not analyzed and not counted in changed-KLOC`,
      subject: "scope-exclusions",
    });
  }
  // An empty ref diff (`--branch main --base main`, an already-merged branch)
  // produces zero files and exit 0 — byte-indistinguishable from a real clean
  // review of real changes. Declared so "nothing was reviewed" cannot read as
  // "nothing was wrong".
  if (produced.value.fromRefs && files.length === 0 && deleted.length === 0) {
    degradations.push({
      reason: `the diff between ${scope.base ?? "?"} and ${scope.ref ?? "?"} is empty — nothing was reviewed`,
      subject: "scope-change-set",
    });
  }
  return { ok: true, value: { ...produced.value, files, deleted, degradations } };
}

/** How big this scope's change is — the OD-1 denominator (1.16). */
export interface ScopeChangeSize {
  /** Added + deleted lines, as git counted them. */
  changedLines: number;
  /** Files git could not count lines in (binary, or an unreadable untracked
   * file). They contribute 0 lines; carried so the caller DECLARES the
   * incompleteness instead of publishing a silently smaller denominator. */
  binaryFiles: string[];
  /** Exit-neutral declarations about the MEASUREMENT (not about coverage). */
  degradations: Degradation[];
}

/**
 * The change SIZE for a resolved scope, mirroring how {@link changeSetFor}
 * builds the change set so the numerator and the denominator describe the
 * same change:
 *
 *   `branch`/`pr`   `mergeBase..ref`, the same range the diff uses.
 *   `uncommitted`   `diff --numstat HEAD` for tracked edits PLUS every
 *                   untracked file counted as all-added — because that is
 *                   exactly what the uncommitted change set contains.
 *   `project`       nothing: `--project` is not a diff and has no denominator
 *                   by construction. Zero here is "not measured", and the
 *                   score is OMITTED for it rather than computed from a
 *                   fabricated one.
 *
 * `_agentic-guardrails/` is excluded here too — the engine's own output must
 * not inflate the denominator any more than it may enter the change set. The
 * config `exclude` prefixes apply identically (an excluded file is not part
 * of the reviewed change, either side of the ratio).
 */
export function changeSizeFor(
  scope: ResolvedScope,
  analyzeRoot: string,
  exclude: readonly string[] = [],
): GitResult<ScopeChangeSize> {
  if (scope.kind === "project") {
    return { ok: true, value: { changedLines: 0, binaryFiles: [], degradations: [] } };
  }
  const isExcluded = excludedBy(exclude);
  const mineForSize = (file: string): boolean =>
    !file.startsWith(EXCLUDED_PREFIX) && !isExcluded(file);
  const degradations: Degradation[] = [];
  const declareBinary = (files: readonly string[]): void => {
    if (files.length === 0) return;
    const shown = files.slice(0, 3).join(", ");
    degradations.push({
      reason:
        `${files.length} file(s) contribute 0 lines to changed-KLOC because git reports no line ` +
        `counts for them (${shown}${files.length > 3 ? ", …" : ""}) — the score's denominator is that much smaller`,
      subject: "score-change-size",
    });
  };

  if (scope.kind === "branch" || scope.kind === "pr") {
    const forkPoint = mergeBase(analyzeRoot, scope.base as string, scope.ref as string);
    if (!forkPoint.ok) return forkPoint;
    const measured = diffNumstat(analyzeRoot, forkPoint.value, scope.ref as string);
    if (!measured.ok) return measured;
    const binaryFiles = measured.value.binaryFiles.filter(mineForSize);
    declareBinary(binaryFiles);
    return {
      ok: true,
      value: {
        // PATH-FILTERED, not a whole-diff total: every run appends a line to
        // the committed `history/trends.jsonl`, so summing the diff wholesale
        // would grow the denominator by one line per run forever and quietly
        // raise every later score.
        changedLines: changedLinesIn(measured.value, mineForSize),
        binaryFiles,
        degradations,
      },
    };
  }

  // uncommitted: tracked edits from the diff, untracked files as all-added.
  const tracked = numstatAgainstHead(analyzeRoot);
  if (!tracked.ok) return tracked;
  const untracked = untrackedFiles(analyzeRoot);
  if (!untracked.ok) return untracked;
  const binaryFiles = new Set(tracked.value.binaryFiles.filter(mineForSize));
  let changedLines = changedLinesIn(tracked.value, mineForSize);
  for (const file of untracked.value.filter(mineForSize)) {
    const counted = countLines(path.join(analyzeRoot, file));
    if (counted === undefined) binaryFiles.add(file);
    else changedLines += counted;
  }
  const sortedBinary = [...binaryFiles].sort();
  declareBinary(sortedBinary);
  return { ok: true, value: { changedLines, binaryFiles: sortedBinary, degradations } };
}

/**
 * Lines in an untracked file, counted git's way: a trailing incomplete line
 * still counts. Returns undefined for a file that has no line count to give —
 * binary (a NUL byte, git's own heuristic) or unreadable — so the caller
 * declares it rather than adding a silent 0.
 */
function countLines(absPath: string): number | undefined {
  let bytes: Buffer;
  try {
    // `fsPath`: an untracked path under a deep worktree can cross Win32's
    // 260-char limit, where the read would fail and look like a binary file.
    bytes = readFileSync(fsPath(absPath));
  } catch {
    return undefined;
  }
  if (bytes.includes(0)) return undefined;
  let lines = 0;
  for (const byte of bytes) if (byte === 0x0a) lines += 1;
  if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) lines += 1;
  return lines;
}

function produce(scope: ResolvedScope, analyzeRoot: string): GitResult<ChangeSet> {
  const plain = (result: GitResult<string[]>): GitResult<ChangeSet> =>
    result.ok
      ? { ok: true, value: { files: result.value, deleted: [], fromRefs: false, degradations: [] } }
      : result;
  switch (scope.kind) {
    case "uncommitted":
      return plain(uncommittedFiles(analyzeRoot));
    case "project":
      return plain(lsFiles(analyzeRoot));
    case "branch":
    case "pr": {
      // `merge-base` first: a plain `diff base ref` would also report every
      // file the BASE moved on to since the branch forked, which the branch
      // did not change.
      const base = scope.base as string;
      const ref = scope.ref as string;
      const forkPoint = mergeBase(analyzeRoot, base, ref);
      if (!forkPoint.ok) return forkPoint;
      const diff = diffRefs(analyzeRoot, forkPoint.value, ref);
      if (!diff.ok) return diff;
      return {
        ok: true,
        value: { files: diff.value.changed, deleted: diff.value.deleted, fromRefs: true, degradations: [] },
      };
    }
  }
}
