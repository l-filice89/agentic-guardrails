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

import { SCOPE_PATTERN, type Degradation } from "@agentic-guardrails/contracts";

import {
  currentBranch,
  diffRefs,
  lsFiles,
  mergeBase,
  refExists,
  refProblem,
  resolveDefaultBase,
  uncommittedFiles,
  type GitResult,
} from "../git/git.js";

export type ScopeKind = "uncommitted" | "branch" | "pr" | "project";

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
 * The change set for a resolved scope. `analyzeRoot` is where the files are —
 * the worktree for a ref that is not HEAD, the invoking repo otherwise.
 *
 * The `_agentic-guardrails/` exclusion lives HERE, once, downstream of all
 * four producers: every scope gets it, and no producer can forget it.
 */
export function changeSetFor(scope: ResolvedScope, analyzeRoot: string): GitResult<ChangeSet> {
  const produced = produce(scope, analyzeRoot);
  if (!produced.ok) return produced;
  const mine = (file: string): boolean => !file.startsWith(EXCLUDED_PREFIX);
  const files = produced.value.files.filter(mine);
  const deleted = produced.value.deleted.filter(mine);
  const degradations: Degradation[] = [];
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
