---
title: 'Story 1.15: Review Scopes — Branch, PR, and Project'
type: 'feature'
created: '2026-07-28'
status: 'done'
baseline_revision: f6f92e1116bc7c49798dfa3a4ff70836d193d36d
final_revision: 41ea7965b1c6e3dec4ac1147db6c3d7b5295dcdc
review_loop_iteration: 0
followup_review_recommended: true # AUTO-FORCED: three HIGH inline findings (concurrent reviews destroying each other's live worktree; a deterministic re-run reporting a bogus failure; in-place ref scopes analyzing a dirty tree while the manifest claimed the ref) + accepted OVERSIZED flag
context: []
warnings:
  - 'OVERSIZED: four scopes + a worktree-isolated execution path + an analyze/write root split through the whole pipeline + a CLI flag surface + an interactive disposition prompt. Elevated review posture from the start (OVERSIZED-STORY).'
---

<intent-contract>

## Intent

**Problem:** `guardrails review` only ever reviews uncommitted changes in the invoking working tree. The scope literal `"uncommitted"` is hardcoded in three places, `root.value` serves as both "where to analyze" and "where to write", and nothing in `core/git` diffs two refs. FR-25 (branch/PR/project scopes with isolated execution) has a lifecycle primitive from 1.14 and no consumer.

**Approach:** Split the pipeline's single root into `analyzeRoot` (where files and the change set come from — a `git worktree` when the reviewed ref is not HEAD) and `outputRoot` (always the invoking repo — config, cache, corpus seed, artifacts). Add ref-diffing to `core/git`, four change-set producers behind one scope resolver, a CLI flag surface, and an interactive commit-or-drop disposition for the written artifact.

## Boundaries & Constraints

**Always:**

*Scope model — one resolver, four producers.*
- A scope is `{ kind, slug, ref?, base? }`. Kinds and their artifact directories: `uncommitted` (default, unchanged behaviour), `branch-{slug}`, `pr-{id}`, `project`.
- Change-set producers, one per kind, all returning repo-relative POSIX paths:
  - `uncommitted` — `uncommittedFiles()` as today. No worktree, ever.
  - `branch` — `merge-base` of the base ref and the target ref, then `diff --name-only -z <mergeBase> <ref>`. Base defaults to the repo's own default branch, resolved in declared order (`refs/remotes/origin/HEAD` → `origin/main` → `main` → `master`); a guessed base is a **declared degradation** naming which one was picked; `--base <ref>` overrides and is never guessed.
  - `pr` — the **locally present** ref only (`refs/pull/<id>/head`, then `refs/remotes/origin/pull/<id>/head`). Absent → typed preflight failure whose message contains the exact `git fetch` command the user must run. **No network operation of any kind** — no fetch, no GitHub API (Epic 5 boundary). Diff computed exactly like `branch`.
  - `project` — every tracked file at the reviewed ref (`ls-files -z` in the analyze root). Not a diff: the whole project is the change set.
- `_agentic-guardrails/` exclusion applies to **all four** producers — it lives once, downstream of the resolver, and every scope has a test proving an artifact path never enters its own change set.
- Slugging: a slug is `[a-z][a-z0-9-]*`, derived from the ref by lowercasing and replacing every unsafe run with `-`. When the derivation is **lossy** (slug ≠ ref) the slug carries an 8-hex `sha256(ref)` suffix, so `feat/Foo` and `feat-foo` can never collide into one directory. The exact ref is carried verbatim on the manifest — the slug is a directory name, never the record of what was reviewed.
- `SCOPE_PATTERN` must widen to admit digits (`pr-42`). It is currently duplicated between `persistence/artifact-writer.ts` and `contracts/src/review-artifact.ts`; **de-duplicate rather than edit twice** — the pattern lives in contracts, core imports it, and a test asserts there is only one definition in play. It must still reject separators, dots, and uppercase: this regex is the traversal guard on a directory name derived from untrusted ref text.

*The analyze/write split — the actual structural change.*
- `RunReviewOptions` gains an explicit split: `analyzeRoot` (worktree or invoking repo) and `outputRoot` (**always** the invoking repo). Config, findings/graph cache, corpus seed, git-wiring preflight, and the artifact write are all `outputRoot`. Change set, file reads, content hashes, and tsconfig discovery are all `analyzeRoot`.
- **Hard invariant:** no absolute path from the analyze root may enter a cache key, a runId, an artifact field, or a finding location. Everything hashed or emitted is relative to `analyzeRoot` and POSIX-normalized. A temp worktree path is nondeterministic; if one leaks into a hash, warm-cache reuse and artifact byte-identity both die silently. This needs a **direct test**: the same ref reviewed twice, from two different worktree paths, produces a byte-identical artifact (`normalizeCacheTruth` applied) and the same runId.
- The scope literal is threaded from the resolver to all three current hardcode sites (findings cache key, runId hash input, artifact scope) — no site keeps a literal.
- Whether the cache key includes the scope: it already does. Keep it — a `project` run and an `uncommitted` run over the same file set are different analyses and must not share entries.

*Worktree isolation.*
- A worktree is created **only when the reviewed ref is not the current HEAD**. Reviewing the current working tree inside a worktree would silently drop the user's uncommitted state and is never right. `--project` with no ref, and `uncommitted`, both analyze in place. State this in the docs — "isolated execution" means isolated from ref checkout, not isolation for its own sake.
- Isolation goes through `withWorktree()` from 1.14 unchanged — no second lifecycle, no direct `worktreeAdd` in the pipeline. Removal in `finally` is the 1.14 contract; this story must not weaken it.
- `reclaimWorktrees()` runs before creating one, as 1.14 specifies.
- Worktree degradations reach the manifest through `toManifestDegradation()` — the adapter 1.14 built for exactly this, never a hand-rolled shape.

*SPIKE-5 handoff obligations (DELEGATED-WORK-CARRIES-AN-AC — every item below is a spec obligation, not a suggestion):*
- `node:path` for every path construction; no string concatenation of paths.
- Long-path handling per 1.14: the base stays short, `\\?\` prefixing where Node needs it, and `--detach` on worktree creation as SPIKE-5 requires.
- A git exit status of 0 is **not** sufficient evidence that an operation succeeded — verify state, per SPIKE-5's headline finding.
- Refs are untrusted input: `refProblem()` gates every ref before it reaches git, and refs pass after `--`.
- `gitCommand` stays internal (not in the public barrel); new ref-diffing helpers are typed functions in `core/git`, not a generic escape hatch.
- Git subprocesses keep the 120 s timeout, 64 MiB maxBuffer, and `GIT_TERMINAL_PROMPT=0` — a PR ref resolution is exactly the flow that would otherwise hang on a credential prompt.
- `spawnSync` behind the async façade blocks the event loop (documented ceiling, restated here, not fixed in this story).
- Artifacts are written to the **invoking** repo, never the worktree — which the analyze/write split now enforces structurally rather than by convention.
- `writeFileAtomic` keeps its temp file in the target directory.

*`gh` metadata — optional, degrading.*
- When `gh` is on PATH and authenticated, `gh pr view <id> --json <fields>` supplies PR metadata (title, base ref, head ref, author) recorded on the manifest. `gh` absent, unauthenticated, erroring, timing out, or returning unparseable JSON → a **declared degradation**, and the review runs to completion regardless. `gh` is never required, never installed, never a gate.
- `gh` output is untrusted input: parsed through a Zod schema in contracts, never spread onto the manifest.

*Artifact disposition — commit or drop.*
- After a run completes, on an interactive TTY without `--no-input`, prompt: commit the artifact, or drop it. **Never an ambient mutation** — no disposition prompt means no commit.
- **The `reviews/` contradiction, resolved explicitly:** `reviews/` is seeded into `_agentic-guardrails/.gitignore` by design (1.8). "Commit" therefore means `git add -f -- <artifact path>` followed by a **pathspec-limited** `git commit -m "… [skip ci]" -- <artifact path>`. It force-adds past the ignore for that one file. It must NOT edit `.gitignore`, must NOT `git add -A`, and must NOT touch the user's index or any other file. A test asserts a dirty working tree is byte-identical after a commit disposition apart from the artifact itself.
- "Drop" means the artifact stays on disk, untracked and ignored (it already is), and its path is printed. Drop never deletes anything and never touches git.
- EOF / non-TTY / `--no-input` → **drop**, the safe default, following `eofSafeIo`'s precedent from `init-command.ts` (whose note-emitted-once behaviour is reused, not re-implemented).
- A commit failure (detached HEAD, unborn branch, hooks rejecting, index lock) degrades to copying the artifact into an OS temp directory and **reporting that path**; it is a declared degradation, never a crash. No push — pushing is Epic 5.
- Disposition never changes the exit code. The gate verdict is decided by findings, full stop.

*Everything else.*
- Backwards compatibility: bare `guardrails review` behaves exactly as today, including artifact path and exit codes. The existing e2e suite must pass unmodified.
- `RULESET_VERSION` is not bumped (no rule changed). `ENGINE_VERSION` bumps only if a cached-payload shape changes.
- Determinism bar unchanged: byte-identical artifacts, no timestamps, canonical sorts.

**Block If:**
- Making a scope work requires reviewing inside the invoking working tree while a ref is checked out, i.e. mutating the user's HEAD. That is an NFR-9 violation and needs a human ruling, not an implementation choice.
- The analyze/write split cannot be made to preserve warm-cache hits or artifact byte-identity — that is a design problem to surface, not to paper over by disabling the cache for ref scopes.

**Never:** No network (no fetch, no push, no GitHub API — Epic 5 owns remote flows). No new dependencies. No LLM. No finding-disposition work (DR-1 dispositions are 1.16). No scores/trends (1.16). No parallel worktree lifecycle. No mutation of the invoking repo outside the single force-added artifact under an explicit commit disposition.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default | `guardrails review` | identical to today: uncommitted scope, `reviews/uncommitted/`, no worktree, no prompt change | unchanged |
| Branch, other ref | `--branch feat/x`, base guessable | worktree at the ref; diff vs merge-base; `reviews/branch-feat-x-<hash>/` in the INVOKING repo; worktree removed | worktree removal failure → declared degradation |
| Branch = HEAD | `--branch <current>` | analyzed in place, no worktree | — |
| Branch, no base found | no origin/HEAD, no main/master | typed preflight failure naming `--base` | never a silent full-history diff |
| Base guessed | `origin/HEAD` missing, `main` exists | runs; declared degradation naming the picked base | — |
| PR present locally | `--pr 42`, ref fetched | as branch, into `reviews/pr-42/` | — |
| PR absent locally | `--pr 42`, no ref | typed preflight failure containing the exact `git fetch` command | never attempts network |
| `gh` available | authed `gh` | PR metadata on the manifest | — |
| `gh` absent/erroring/garbage | no `gh`, or non-zero, or unparseable JSON | review completes; declared degradation | never a gate |
| Project | `--project` | every tracked file at HEAD; `reviews/project/` | — |
| Two scope flags | `--pr 1 --project` | usage error, exit 2 | commander/exitOverride path |
| Hostile ref | `--branch "--upload-pack=x"` / `..` / `;` | rejected by `refProblem` before any git call | typed failure, exit 2 |
| Lossy slug collision | refs `feat/Foo` and `feat-foo` | distinct directories (hash suffix) | never one shared directory |
| Same ref, two worktree paths | repeated run | byte-identical artifact + identical runId | cache still warm |
| Self-exclusion, every scope | artifact exists under `_agentic-guardrails/` | never in the change set for any of the four scopes | — |
| Disposition: commit | TTY, user picks commit | one commit, `[skip ci]`, only the artifact, force-added past the ignore | rest of the working tree untouched |
| Disposition: drop / EOF / `--no-input` / non-TTY | any | artifact left on disk untracked; path printed; no git call | default is drop |
| Commit fails | detached HEAD / hook rejects / index locked | artifact copied to a temp dir, path reported, declared degradation | exit code unchanged |
| Callback throws mid-scope | analyzer crash inside the worktree | error propagates; worktree still removed | 1.14 `finally` contract |

</intent-contract>

## Code Map

- `packages/core/src/pipeline/pipeline.ts` -- `RunReviewOptions`, the `root.value` dual role, the change-set read (:260), the `_agentic-guardrails/` filter (:276), and the three `"uncommitted"` literals (:447, :741-742, :931) — the structural centre of this story
- `packages/core/src/git/git.ts` -- typed git wrapper; gains merge-base / ref-diff / ls-files. `gitCommand` stays internal
- `packages/core/src/git/worktree.ts` -- 1.14's `withWorktree` / `reclaimWorktrees` / `toManifestDegradation`, consumed as-is
- `docs/spikes/SPIKE-5-windows-worktree-lifecycle.md` -- the "Windows-specific handling required — for Story 1.15" section this story must satisfy item by item
- `packages/core/src/persistence/artifact-writer.ts` -- `SCOPE_PATTERN` (widen + de-duplicate), `SEEDED_IGNORE_LINES` (`reviews/` is ignored by design — the commit disposition force-adds, it does not un-ignore)
- `packages/contracts/src/review-artifact.ts` -- the second copy of the scope regex; becomes the single source
- `packages/contracts/src/run-manifest.ts` -- where the scope record, exact ref, base ref, and PR metadata land
- `packages/cli/src/index.ts` -- `review` currently takes no options; `--no-input` precedent on `init` (:28); `exitOverride` (:42); exit contract 0/1/2
- `packages/cli/src/review-command.ts` -- output surface, degradation and inconclusive lines
- `packages/cli/src/init-command.ts` -- `eofSafeIo` (:30-53), reused for the disposition prompt (its EOF default must be the SAFE answer: drop)

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src` -- single `SCOPE_PATTERN` (`[a-z][a-z0-9-]*`) consumed by core; manifest fields for scope kind, exact ref, base ref, and optional `gh` PR metadata (Zod-validated) -- contract first
- [x] `packages/core/src/git/git.ts` -- `mergeBase`, `diffRefs(from, to)` (`--name-status`, so a DELETED path is the one git named), `lsFiles`, `refExists`, `resolveDefaultBase` — typed, ref-guarded, `--`-terminated, timeout/maxBuffer/non-interactive preserved -- the missing primitive
- [x] `packages/core/src/pipeline/scope.ts` (new) -- scope resolution, slugging (+ lossy-hash suffix), the four change-set producers, the single `_agentic-guardrails/` exclusion -- one place to test
- [x] `packages/core/src/pipeline/pipeline.ts` -- `analyzeRoot`/`outputRoot` split; scope threaded to all three literal sites; worktree wrapping only when ref ≠ HEAD; worktree degradations via `toManifestDegradation` -- the structural change
- [x] `packages/core/src/pipeline/gh-metadata.ts` (new) -- optional `gh pr view`, Zod-parsed, degrading on every failure mode -- never a gate
- [x] `packages/cli/src/index.ts` + `review-command.ts` + `disposition.ts` (new) -- `--branch [ref] | --pr <id> | --project` (mutually exclusive), `--base <ref>`, `--no-input`; commit-or-drop prompt reusing `eofSafeIo` with drop as the EOF default; force-add + pathspec-limited commit; temp-dir degrade on failure -- the user surface
- [x] Unit tests across `scope.test.ts`, `git.test.ts`, `pipeline.test.ts`, `disposition.test.ts` -- every I/O matrix row reachable in-process, including hostile refs, lossy-slug collision, and the two-worktree-paths byte-identity test -- coverage
- [x] `tests/integration/review-scopes.e2e.test.ts` (new) -- a real fixture repo: branch scope through a real worktree, project scope, PR-ref-absent failure message, self-exclusion per scope, artifact lands in the invoking repo -- the end-to-end proof
- [x] `docs/` + `README.md` + `CHANGELOG.md` + `tests/e2e-coverage.md` -- scope surface, the in-place-vs-worktree rule, the disposition contract and why `reviews/` stays gitignored, declared degradations -- DoD

**Acceptance Criteria:**
- Given a branch ref, a locally present PR ref, or `--project`, when the review runs, then a ref that is not HEAD executes inside an isolated `git worktree` removed in `finally` even on failure, and artifacts are written to the invoking context's `reviews/branch-{slug}/`, `reviews/pr-{id}/`, or `reviews/project/`.
- Given the same ref reviewed twice from different worktree paths, when the artifacts are compared (cache truth normalized), then they are byte-identical and the runIds match — no absolute analyze-root path reaches any hash or artifact field.
- Given a PR, when metadata is needed, then `gh`-sourced metadata is used when available and every failure mode degrades to a declared degradation with the review completing — and no network call is ever made by this story.
- Given an interactive run completes, when the disposition prompt appears, then the user chooses commit (`[skip ci]`, force-added artifact only, pathspec-limited, rest of the working tree byte-identical) or drop, never an ambient mutation; and EOF, non-TTY, or `--no-input` defaults to drop.
- Given a commit disposition that fails, when it is handled, then the artifact is saved to a temp directory, that path is reported, and the exit code is unchanged.
- Given any scope, when the diff is computed, then `_agentic-guardrails/` is excluded — proven per scope.
- Given a hostile ref (leading `-`, `..`, shell metacharacters), when it is supplied, then it is rejected before any git invocation.
- Given bare `guardrails review`, when run, then behaviour, artifact path, and exit codes are unchanged and the pre-existing e2e suite passes unmodified.
- Given the SPIKE-5 "Windows-specific handling required" list, when 1.15 ships, then each item is either implemented or explicitly restated as a carried ceiling in the docs — none silently dropped.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test`, when run, then all green.

## Spec Change Log

- **`gh` vs "no network".** The contract mandates `gh pr view` for optional PR
  metadata AND forbids network operations. Resolved as: *this tool* opens no
  socket — no fetch, no push, no GitHub API client, no HTTP anywhere in the
  code. `gh`, when the user already has it installed and authenticated, is
  invoked as their own client and may talk to GitHub on their behalf; it runs
  only for the `pr` scope, under a 10 s budget, and every failure mode is a
  declared, exit-neutral degradation. Stated here because the tension is real
  and should not be discovered later in a diff.
- **Where scope-plane declarations land.** A guessed diff base and absent `gh`
  metadata are recorded in the EXIT-NEUTRAL channel (`declaredOnly`), not in
  `runDegraded`: neither is lost analysis coverage, and the contract says `gh`
  is "never a gate". The CLI prints that channel with its existing
  `inconclusive:` prefix rather than growing a third output channel for two
  lines — the wording is about the run's framing, which is accurate for a
  guessed base. Worktree degradations stay REAL degradations (exit 2), as
  1.14 intends.
- **`manifest.scope` is omitted for the uncommitted scope.** Emitting it
  always would have changed the artifact bytes of every bare
  `guardrails review`, which the backwards-compatibility constraint forbids;
  `artifact.scope` already records `"uncommitted"`. Same rationale the
  manifest already uses for `axiomsOff`.
- **Composition moved out of the analyzed root.** `runReview` was split into
  `analyze()` (phases 0–4, inside the worktree) and composition (phase 5, in
  the invoking repo). A worktree's REMOVAL degradation is only known after the
  callback returns, so composing inside the callback would have made a leak
  structurally unable to reach the artifact it belongs in. The change-set
  failure path keeps its typed `preflight` result via an internal
  `ChangeSetError` that crosses the callback boundary.
- **`--base` without a diffing scope is a usage error** (exit 2) rather than a
  silently ignored flag. Not in the matrix; silence was the worse option.
- **CLI `exitOverride` moved above the subcommand definitions** so subcommands
  inherit it. Without this, commander raised the `--pr 1 --project` conflict
  inside the `review` subcommand and exited 1, contradicting the documented
  0/1/2 exit contract. No existing test changed.
- **The commit disposition passes `--no-verify`** (review fix P6). The
  contract requires the commit to touch nothing but the artifact; a
  lint-staged/prettier-style `pre-commit` hook does the opposite — it runs
  against the user's MAIN index during our partial commit and can stage or
  rewrite files nobody asked about. The artifact is machine-written generated
  output, not user work, so the hook is bypassed for that one file (and only
  that file); everything the user commits is still hooked. Covered by a test
  in a repo that HAS such a hook.
- **The `pr` scope rejects a leading-zero id** (review fix P19). `--pr 007`
  passed the digits-only test, probed `refs/pull/007/head` (GitHub's ref is
  `refs/pull/7/head`), filed into `reviews/pr-007/` and would have asked
  `gh pr view 007` about PR 7 — one id, three answers. Rejected as a usage
  error rather than silently normalized, so the id in the artifact path is
  always the id the user typed.
- **Two NEW declared, exit-neutral degradations on the scope plane** (review
  fixes P3 and P10), both in `declaredOnly`: `scope-in-place` when a ref
  scope analyzed IN PLACE has a dirty working tree (the change set comes from
  commits, the content from the user's tree — the in-place rule stands, the
  divergence is now stated), and `scope-change-set` when a ref diff is EMPTY
  (`--branch main --base main`, an already-merged branch), which otherwise
  produced a clean exit-0 artifact indistinguishable from a real review.
- **A worktree carries a `.agtwt-live` pid marker** (review fix P1). The
  in-process `liveWorktrees` set was the only liveness signal, so a second
  `guardrails` process on the SAME repository saw the first one's live
  worktree as residue and removed it mid-analysis (1.14 fixed this across
  repositories; 1.15 is the first consumer that makes the same-repo axis
  reachable). Reclamation now skips a worktree whose marker names a LIVE pid
  (silently — a concurrent run is normal operation and a reclaim degradation
  would drive the other run's exit code), and DECLARES a registered,
  on-disk worktree whose liveness cannot be established as the new
  `in-use` kind rather than deleting it.
- **The hostile-ref matrix row overstates `refProblem`.** The contract's
  matrix says `..` and `;` are "rejected by `refProblem` before any git call".
  In reality `refProblem` rejects only an EMPTY ref and one beginning with
  `-` (the argument-injection boundary it exists for); `..` and `;` are passed
  through to `git rev-parse --verify --end-of-options <ref>` and come back
  "ref not found". The end state is equivalent and safe — `shell: false`,
  argument arrays, and `--end-of-options`/`--` on every call, so these are
  only ever ref NAMES — and the tests encode the ACTUAL behaviour
  (`git.test.ts` "treats a ref containing traversal or shell metacharacters
  as simply absent"). Recorded rather than fixed: the intent-contract is
  read-only, and changing the code to pre-reject `..`/`;` would reject legal
  git ref syntax for no security gain.
- **The `gh` outcome is a runId input** (review fix P4). `manifest.pr` and the
  `gh-pr-metadata` degradation are artifact CONTENT not derived from the
  reviewed code, so with the runId blind to them the same PR ref with and
  without `gh` — or after a PR title edit on GitHub — produced the SAME runId
  and overwrote one artifact with different bytes. The gh outcome (metadata,
  or the reason it is absent) is now appended to the runId hash input, and
  APPENDED conditionally: every non-PR scope hashes exactly the tuple it
  hashed before, so bare `guardrails review` keeps its artifact bytes. The
  existing `gh` deviation above argues the no-socket axis only and never
  addressed determinism.
- **`refProblem` moved from `worktree.ts` to `git.ts`** (re-exported from
  `worktree.ts` for 1.14's callers), so the new ref-diffing helpers cannot
  grow a second path to git that skips the guard — SPIKE-5 item 5.

## Review Triage Log

### 2026-07-28 — Review pass

- intent_gap: 0
- bad_spec: 1: (high 0, medium 0, low 1)
- patch: 21: (high 3, medium 10, low 8)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` Two concurrent reviews of the same repository destroyed each other's live worktree. `liveWorktrees` was an in-process `Set` and the `.git`-pointer ownership check passes for a SIBLING PROCESS on the same repo, so B's reclaim-before-create saw A's registered, prefixed, correctly-owned, unlocked worktree as residue and removed it — A's files then landed in `deletedFiles` and it reported a clean review over an analysis that had been deleted underneath it. This is the same class as the cross-repo destruction 1.14 fixed; 1.15 is the first consumer that makes the same-repo axis reachable, and the README carried it as a ceiling rather than a fix. `withWorktree` now writes a `.agtwt-live` pid marker into each worktree; reclamation skips a live pid SILENTLY (a concurrent run is normal operation, and a reclaim degradation is a real one that would drive the sibling's exit code to 2), reclaims a dead pid (the unchanged SIGKILL recovery path), and declares a new `in-use` degradation — never removing — when a registered on-disk worktree has no readable marker. `unknown` is deliberately not `dead`; `EPERM` counts as live. Mutation-verified RED.
  - `[high]` `[patch]` A deterministic re-run reported a bogus failure on the ordinary happy path: the artifact bytes were already in HEAD, so `add -f` staged nothing and the pathspec-limited commit exited 1 with "nothing to commit" on STDOUT (empty stderr → the reason degraded to a bare exit status), and the disposition fell into the temp-dir degrade. `commitPath` now checks `diff --cached --quiet` after the add and returns a typed no-op success.
  - `[high]` `[patch]` In-place ref scopes analyzed the user's dirty working tree while the manifest asserted the ref had been reviewed. The change set comes from commits (`diffRefs`) but content is always read from `analyzeRoot`, which for `ref === HEAD` is the working tree by design — so an uncommitted `eval('danger')` produced a finding attributed to ref `main` with `declaredOnly` empty, and the inverse silently moved locally-reverted files into `deletedFiles`. The in-place rule stands; the divergence is now an exit-neutral `scope-in-place` declaration naming the count and first three paths. `--project` had the identical property and is covered.
  - `[medium]` `[patch]` `gh` PR metadata broke artifact byte-determinism at a stable runId: `manifest.pr` and the `gh-pr-metadata` degradation reached the artifact but were not inputs to `computeRunId`, so the same PR ref with and without `gh` — or after a PR title edit on GitHub — produced the same runId and overwrote the artifact with different bytes. The gh outcome is now a conditionally-appended runId term, so non-PR scopes hash exactly what they hashed before and bare-review bytes are unchanged. (The spec's earlier `gh` deviation argued the no-socket axis only and never addressed determinism, which is the axis that actually broke.)
  - `[medium]` `[patch]` The commit disposition SUCCEEDED on a detached HEAD and printed "committed", creating a commit reachable only from detached HEAD — lost on the user's next checkout — where the contract lists detached HEAD as a commit failure that must degrade to a temp copy. Now refused via `symbolic-ref --quiet HEAD` before the index is touched (which still succeeds on an unborn branch).
  - `[medium]` `[patch]` Pre-commit hooks ran unguarded against the user's main index during a partial commit, so a lint-staged/prettier-style hook could rewrite files — contradicting both the contract's "must not touch the user's index or any other file" and the AC's byte-identity claim, while both existing byte-identity assertions ran in hook-free repos. The artifact commit now passes `--no-verify` (machine-written artifact, not user work), covered by a hook that writes a marker and rejects.
  - `[medium]` `[patch]` SPIKE-5 item 11 (`\\?\` long paths) was only half applied, and the slug was unbounded: `mkdirSync`/`writeFileAtomic` in the artifact writer, both `computeGraphKey` reads (where a long path silently disabled the cache for the WHOLE run behind a generic reason), and both `discoverTsconfigs` `existsSync` calls (where a long path read as "not found") were unwrapped, while a ~200-char branch name produced an unbounded slug that killed the run at persistence AFTER the full analysis. All wrapped in `fsPath`; the slug body is capped at 48 chars with truncation forcing the hash suffix. The >260-char write test is labelled honestly as non-discriminating on POSIX and on Windows with `LongPathsEnabled=1`.
  - `[medium]` `[patch]` The `withWorktree` FAILURE path discarded the lifecycle's degradations (base-degraded, reclaim-failed, unowned) and kept only `.reason`, while the throw path correctly harvested `worktreeDegradationsOf(error)` — a zero-silent-degradation violation that also hid leaked residue. Now attached via `toManifestDegradation`.
  - `[medium]` `[patch]` An unreadable file was indistinguishable from a branch deletion under ref scopes: `diffNames` used `--name-only`, so a permission-denied/EBUSY file silently became "deleted" with no degradation — silent coverage loss reading as a clean pass. Replaced by `diffRefs` over `--name-status -z` (rename/copy destinations handled); only git-named `D` paths are deletions at a ref scope, anything else unreadable is a real degradation. Working-tree scopes keep the lenient rule (a deleted uncommitted file is genuinely absent).
  - `[medium]` `[patch]` An empty ref-scope change set (`--branch main --base main`, or an already-merged branch) exited 0 indistinguishably from a real clean review — now declared as `scope-change-set`.
  - `[medium]` `[patch]` A test that could not fail: "analyzes IN PLACE — no worktree" asserted only `ok === true` and zero residue, both equally true of a correctly created AND removed worktree, so deleting the in-place branch kept it green while the behaviour it guards (not silently dropping uncommitted state) was gone. Rewritten to observe an uncommitted edit producing a real axiom-5 finding only the in-place path can see; mutation-verified RED.
  - `[medium]` `[patch]` The two-worktree-paths byte-identity test did not prove the row it was cited for: it asserted `normalizeCacheTruth` equality, which normalizes away `manifest.cache` — the ONLY evidence that a worktree absolute path leaked into a cache key — so it passed identically with caching disabled, and its stub analyzer never produced a real finding `location.file`. Now runs the real analyzers with a shared cache secret and asserts cold `hits: 0` → warm `misses: 0, hits > 0`. (The behaviour was already correct — verified empirically, cold `{hits:0,misses:6}` → warm `{hits:5,misses:0}` — so this was the coverage gap the contract itself called out as needing a direct test.)
  - `[medium]` `[patch]` `commitPath`'s un-stage-on-failure path was untested where it mattered: the disposition test injected a fake failing commit (proving nothing about real git state) and the git test covered only the unborn-branch `git rm --cached` fallback, never the `git reset` path on a normal branch. Two real-git cases added: a conflicted mid-merge partial commit and a `prepare-commit-msg` hook (which `--no-verify` does not bypass).
  - `[low]` `[patch]` The "exactly one `SCOPE_PATTERN` definition" guard could not detect the duplicate it existed to prevent — its scan regex made the `9` optional, so it did NOT match `/^[a-z][a-z-]*$/`, the exact pre-1.15 copy most likely to be reintroduced — and it scanned `packages/**` only. Loosened, widened to the whole repo, given a self-check against the pre-1.15 spelling, and the CHANGELOG line that overstated it corrected.
  - `[low]` `[patch]` The e2e suite shelled out to the developer's REAL `gh` (no seam on the CLI path) in a suite whose sibling test is titled "never reaches the network" — `GUARDRAILS_NO_GH=1` guard added and set for the whole e2e suite, plus a case putting a failing `gh` first on `PATH`.
  - `[low]` `[patch]` Degradation reasons reached the terminal unsanitized while finding messages went through `sanitizeMessage`, so raw subprocess stderr from `gh` or git could emit ANSI escapes into the report — one `degradationText` path now covers inconclusive lines, degraded lines, the summary header, disposition lines, the preflight message and the catch-all.
  - `[low]` `[patch]` An annotated tag never compared equal to HEAD: `revParse` returned the tag OBJECT sha while `isCurrentHead` compared against `headSha`'s COMMIT sha, so `--branch <annotated-tag>` always built a worktree for a ref that IS HEAD — the contract's stated invariant was not the one enforced. `revParse` now peels `^{commit}`.
  - `[low]` `[patch]` Ctrl-C at the disposition prompt exited 130, escaping the documented 0/1/2 contract and discarding the already-computed gate verdict — a SIGINT listener now closes the readline so it settles through the EOF default (drop) and keeps the exit code.
  - `[low]` `[patch]` `--pr 007` passed the digit guard, probed `refs/pull/007/head` (GitHub's real ref is `refs/pull/7/head`) and wrote `reviews/pr-007/` while `gh pr view 007` returned PR 7 — two directories and two histories for one PR. Leading zeros rejected.
  - `[low]` `[patch]` `y`/`yes` at the commit prompt silently took the DROP branch (the regex was `/^c(ommit)?$/i`) and printed "artifact left untracked", so the near-universal affirmative meant the opposite of what the user intended. Accepted now, and the prompt reads `[c/y = commit, D = drop]`.
  - `[low]` `[patch]` Untested branches given coverage so a regression fails: the second PR-ref candidate `refs/remotes/origin/pull/<id>/head` (deleting it from the array previously failed no test), a dangling `refs/remotes/origin/HEAD` falling through to `main` with `guessed: true`, and `--base` combined with `--pr`.
  - `[low]` `[bad_spec]` The contract's hostile-ref matrix row claims `..` and `;` are "rejected by `refProblem` before any git call". In fact `refProblem` rejects only empty and leading-`-`; `..`/`;` reach `git rev-parse --verify --end-of-options <ref>` and come back "ref not found". The end state is safe (`shell:false`, argument arrays, `--end-of-options`/`--` on every call, traced through `revParse`/`mergeBase`/`diffRefs`/`lsFiles`/`worktreeAdd`) and the tests already encode the real behaviour. The intent-contract is read-only, so the discrepancy is reconciled in the Spec Change Log rather than by editing the claim.

No findings were deferred or rejected.


## Auto Run Result

- **Summary:** `guardrails review` now covers four scopes — `uncommitted` (unchanged default), `--branch [ref]`, `--pr <id>`, `--project` — behind one resolver with a change-set producer each. The load-bearing change is structural: the pipeline's single root is split into `analyzeRoot` (a `git worktree` via 1.14's `withWorktree`, but ONLY when the reviewed ref is not HEAD — reviewing in a worktree would silently drop the user's uncommitted state) and `outputRoot` (always the invoking repo: config, cache, corpus seed, artifacts), which makes "artifacts go to the invoking repo" a structural property rather than a convention. Ref-diffing joins `core/git` (`mergeBase`, `diffRefs` over `--name-status -z`, `lsFiles`, `resolveDefaultBase`, `commitPath`), `gh` supplies optional PR metadata that degrades on every failure mode, and an interactive commit-or-drop disposition force-adds the one artifact past the by-design `reviews/` gitignore with a pathspec-limited `--no-verify` commit — never an ambient mutation, drop on EOF/non-TTY/`--no-input`. Review pass applied 21 patches (3 high).
- **Files changed:** `packages/contracts/src/review-artifact.ts` (single widened `SCOPE_PATTERN`), `pr-metadata.ts` (new), `run-manifest.ts` (scope block + `pr`), `index.ts`; `packages/core/src/git/git.ts` (ref-diffing, `refProblem` moved beside the spawn, `commitPath`) and `worktree.ts` (`.agtwt-live` pid marker, `in-use` degradation), `pipeline/scope.ts` + `pipeline/gh-metadata.ts` (new), `pipeline/pipeline.ts` (the analyze/write split), `pipeline/manifest.ts`, `persistence/artifact-writer.ts`, `index.ts`; `packages/cli/src/disposition.ts` (new), `review-command.ts`, `index.ts`; tests `scope.test.ts`, `disposition.test.ts`, `tests/integration/review-scopes.e2e.test.ts` (new) plus additions to `git.test.ts`, `worktree.test.ts`, `pipeline.test.ts`, `artifact-writer.test.ts`, `review-command.test.ts`; `README.md`, `CHANGELOG.md`, `tests/e2e-coverage.md`.
- **Review findings breakdown:** 21 patched (3 high, 10 medium, 8 low), 1 bad_spec (logged, contract untouched), 0 deferred, 0 rejected, 0 intent_gap.
- **Follow-up review recommendation:** true — auto-forced by three HIGH inline findings (FOLLOW-UP-REVIEW AUTO-FORCE ON HIGH) and the accepted OVERSIZED flag.
- **Verification:** `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:boundaries`, `pnpm -r build`, `pnpm -r test` (52 contracts + 460 core + 22 cli), `pnpm test` (37 files / 638 tests) — all green after patches, re-run independently rather than taken on the implementer's word. The pre-existing e2e suites pass unmodified; no existing test was edited.
- **Residual risks:** Worktree liveness is a pid check, not a lease — a recycled pid keeps a worktree un-reclaimable, and a registered worktree with no readable marker is declared `in-use` and left for a human (reachable only in the window between `worktree add` and the marker write). A `gh` failure whose stderr varies between runs now varies the runId by design (different inputs, different identity), which is artifact churn. The long-path artifact test does not discriminate where `MAX_PATH` no longer applies; the measured cliff still lives in the SPIKE-5 harness. Carried unchanged from 1.14: all git I/O is `spawnSync` behind an async façade, so a removal plus backoff stalls the event loop.
