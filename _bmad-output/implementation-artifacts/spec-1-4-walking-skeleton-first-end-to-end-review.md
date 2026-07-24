---
title: 'Story 1.4: Walking Skeleton — First End-to-End Review'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: 1d1b9d7389020033922e33cfb9097abf56c83f89
final_revision: 422768f7137c37b47a0bd2a2ca90917f93f774e9
review_loop_iteration: 0
followup_review_recommended: true # OVERSIZED-STORY RULE: oversized accepted (epic-mandated walking skeleton spans cli+pipeline+analyzer+persistence by design — that is its purpose); elevated review posture from the start
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Every load-bearing joint (CLI → pipeline → analyzer → artifact) is unproven; scaling analyzers before one axiom runs end-to-end through the real pipeline would build on sand.

**Approach:** New `cli` package with `guardrails review` (uncommitted scope only); `core` gains the static pipeline shell (phases 0 preflight → 1 deterministic → 4 aggregation → 5 composition), one real Axiom #1 rule (circular-import, over the 1.3 graph), a thin typed git wrapper, and an atomic artifact writer to `_agentic-guardrails/reviews/uncommitted/`.

## Boundaries & Constraints

**Always:**
- Package boundaries: `cli` depends on `core` + `contracts` only; `core` stays LLM-free; declare `cli` in `ALLOWED_WORKSPACE_DEPS` (fail-closed check will demand it).
- Real pipeline, not a harness stub: phases 0 → 1 → 4 → 5 execute as distinct, individually-failable stages; per-axiom failure isolation (analyzer failure → degraded manifest entry, run continues, exit code reflects it).
- Findings are contracts `Finding`s (`tier: 'deterministic'`, `source: 'ast'`, populated `severity`, `findingId` via `computeFindingId`), sorted `file → line → axiom`; byte-identical artifact JSON on identical input (no wall-clock/randomness in artifact content; run identity = hash of inputs).
- Artifact + RunManifest written via atomic write (temp file → fsync → rename) to `_agentic-guardrails/reviews/uncommitted/`; minimal folder created on demand (full bootstrap is 1.8); `reviews/<scope>/` layout adopted per addendum default (confirm-or-veto ruling: adopted, recorded here).
- Manifest declares what ran / didn't / why (zero silent degradation): corpus/ledger absent at this stage → explicit degraded entries + sentinel hashes, never fake values presented as real.
- Git access only through the thin typed wrapper over system `git` (spawn, never shell-string interpolation of user input); analyzed code parsed as data, never executed.
- All gates green incl. a CLI-level end-to-end test that spawns the BUILT cli against a temp git repo with uncommitted changes and asserts findings + artifact on disk (E2E-COVERAGE RULE: this story makes the CLI flow reachable, so it ships the first real e2e test; update the coverage map).
- Docs + CHANGELOG in same change. UI-MOCK-GATE ruling: CLI plain-text summary has no placement dimension — output format sketched below in Design Notes instead of a mock; recorded here.

**Block If:**
- The pipeline cannot express per-axiom isolation without a DAG library (would contradict the no-DAG architecture decision) — needs human input.

**Never:**
- No LLM phases (2/3 are Epic 2/3 — the pipeline SHAPE may name them, membership is empty). No branch/PR/project scopes (1.15). No config plane (1.6 — hardcoded defaults fine). No cache (1.7). No `init`/corpus (1.8). No full Axiom #1 rule set (1.9). No interactive disposition loop (recording schema exists; capture CLI is 1.16). No streaming output. No new runtime deps beyond `commander` (cli) and `p-map` (core) from the pinned architecture toolchain.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | repo with uncommitted change introducing a circular import | CLI prints summary; artifact + manifest persisted; exit code per severity (error findings → non-zero) | No error expected |
| No findings | uncommitted change with no violations | empty findings artifact still written; manifest declares axiom-1 ran; exit 0 | No error expected |
| No uncommitted changes | clean working tree | run completes: empty change set declared in manifest; no findings; exit 0 | No error expected |
| Not a git repo | cwd outside any repo | preflight fails the run with a typed, human-readable error; no artifact | exit non-zero, message names the failure |
| `_agentic-guardrails/` missing | first run in a repo | minimal folder created on demand; artifact written | No error expected |
| Analyzer crash | axiom-1 analyzer throws internally | run continues; manifest degraded entry names axiom + reason; exit code signals degraded run | typed degradation, no unhandled throw |
| Interrupted write | process killed mid-write | no torn artifact visible at final path (temp → fsync → rename) | stale temp file tolerated/overwritten next run |
| Determinism | same input twice | artifact JSON byte-identical | n/a |

</intent-contract>

## Code Map

- `packages/core/src/adapter/`, `src/graph/` -- 1.3 adapter + graph (circular-import rule consumes `fanOut`/edges)
- `packages/contracts/src/` -- `findingSchema`, `computeFindingId`, `runManifestSchema`, `partialResult` (llm⇒modelIdentity refine; coverage<1⇒degraded refine)
- `scripts/check-boundaries.mjs` -- `ALLOWED_WORKSPACE_DEPS` needs `cli` entry
- `eslint.config.js` -- lint scope covers `packages/**/src`; no changes expected beyond nothing
- `tsconfig.json` (root) -- add `packages/cli` reference; `vitest.config.ts` unit glob already covers new package
- `tests/e2e-coverage.md` -- 1.4 converts the CLI-flow rows to real e2e
- `.github/workflows/ci.yml` -- no change needed (pnpm -r picks up cli)

## Tasks & Acceptance

**Execution:**
- [x] `packages/cli/` -- package shell (`@agentic-guardrails/cli`, ESM, tsup, deps: contracts + core + commander; bin `guardrails`); tsconfig referencing core+contracts; mirror the tsup dts workaround -- new surface package
- [x] `scripts/check-boundaries.mjs` -- add `cli: ["@agentic-guardrails/contracts", "@agentic-guardrails/core"]` -- fail-closed wall
- [x] `packages/core/src/git/git.ts` -- thin typed wrapper: `isRepo(cwd)`, `repoRoot(cwd)`, `uncommittedFiles(cwd)` (staged+unstaged+untracked, .ts/.tsx filtered later) via spawned `git` with arg arrays; typed results, no throws on non-repo -- scope source
- [x] `packages/core/src/pipeline/pipeline.ts` -- static phase shell: `runReview(options)` executing preflight → deterministic (p-map over registered analyzers, bound 4 with `// ponytail:` note pointing at SPIKE-3) → aggregation (sort file→line→axiom; merge is 1.9 scope) → composition; per-analyzer try/catch → manifest degradation; returns typed `ReviewRunResult` -- the skeleton spine
- [x] `packages/core/src/analyzers/axiom1-structural.ts` -- one real rule `structural/circular-import`: build import graph over changed files' project, report cycles touching changed files as `Finding`s (severity `error`, `source: 'ast'`, `enclosingSymbol` = normalized cycle path) -- first real analyzer
- [x] `packages/core/src/persistence/artifact-writer.ts` -- atomic write (temp → fsync → rename, `node:fs`), on-demand `_agentic-guardrails/reviews/uncommitted/` creation, artifact filename from run-id (hash of scope+changed-file content hashes+ruleset+engine version) -- persistence joint
- [x] `packages/core/src/pipeline/manifest.ts` -- build contracts `RunManifest`: tierEnablement `{deterministic: true, llm: false}`, sentinel hashes for absent ledger/corpus + degraded entries declaring absence, engine/ruleset versions -- zero silent degradation
- [x] `packages/cli/src/index.ts` + `src/review-command.ts` -- commander wiring: `guardrails review` (uncommitted scope default), prints the Design-Notes summary, exit codes: 0 clean / 1 error-severity findings / 2 degraded or preflight failure -- user surface
- [x] `packages/core/src/**/*.test.ts` -- colocated unit tests: git wrapper (non-repo typed result), pipeline isolation (throwing analyzer → degraded manifest, run continues — hazard test), artifact writer atomicity contract (rename-only visibility; temp cleanup), manifest sentinel/degradation content, circular-import rule (cycle fixture, no-cycle fixture) -- hazard coverage
- [x] `tests/integration/walking-skeleton.e2e.test.ts` -- spawns built `packages/cli/dist` CLI in a temp git repo (init, commit base, add circular-import change): asserts findings in stdout summary, artifact + manifest files exist and `safeParse` green, exit codes for happy/clean/non-repo cases, byte-identical artifact across two runs -- AC oracle + e2e
- [x] `tests/e2e-coverage.md` -- 1.4 rows: CLI review flow → covered by `walking-skeleton.e2e.test.ts`; non-UI ACs mapped -- E2E-COVERAGE RULE
- [x] `README.md` + `CHANGELOG.md` + `docs/adr/README.md` note if needed -- document `guardrails review`, artifact layout ruling (addendum default adopted) -- DoD

**Acceptance Criteria:**
- Given a git repo with uncommitted changes containing a circular import, when `guardrails review` runs, then Axiom #1 emits Zod-valid Findings (`tier: deterministic`, `source: ast`, populated severity + findingId) and the artifact lands in `_agentic-guardrails/reviews/uncommitted/` via atomic write through real phases 0→1→4→5.
- Given `_agentic-guardrails/` does not exist, when the artifact is written, then the minimal folder is created on demand.
- Given the run completes, when the manifest is read, then it declares what ran, what didn't, and why (absent corpus/ledger explicitly degraded, never faked).
- Given an analyzer that throws, when the run executes, then the run completes with a degraded manifest naming the axiom (per-axiom isolation) — asserted by a test.
- Given identical input, when the review runs twice, then artifact JSON is byte-identical.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test`, when run, then all green.

## Spec Change Log

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 14: (high 3, medium 8, low 3)
- defer: 1: (high 0, medium 1, low 0)
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - `[high]` `[patch]` Solution-style root tsconfigs (incl. THIS repo's) made every run exit 2 — pipeline now discovers and merges referenced tsconfig projects; dogfood e2e case added (cycle in a referenced project → exit 1, not 2).
  - `[high]` `[patch]` Artifact-write failures and any unexpected throw exited 1 (colliding with the "error findings" code) — CLI wraps pipeline+write → stderr + exit 2; commander usage errors and bare invocation exit 2 via exitOverride; e2e asserts all three.
  - `[high]` `[patch]` runId omitted HEAD and tsconfig content, so the "byte-identical" artifact path could silently hold contradictory results across bases; hash race between analysis and id computation — identity now (scope, HEAD sha, changed paths+content snapped once pre-phase-1, deleted files, tsconfig hash, ruleset, engine); test proves an unrelated commit changes the runId.
  - `[medium]` `[patch]` Review artifact envelope had a schemaVersion but no schema/migration owner — `reviewArtifactSchema` added to contracts (strict), registered in the migration registry + type map + golden fixture; core safeParses before write (invalid → typed error, nothing written).
  - `[medium]` `[patch]` `.mts`/`.cts` silently excluded, `.d.ts` wrongly included; changed files absent from every graph produced no signal — filter fixed; absent-from-graph files degrade by name; deleted files carried as `deletedFiles` (no false degradation); case-folded path compare on win32/darwin.
  - `[medium]` `[patch]` p-map bound was decorative over sync analyzers — `Analyzer.run` is async; the bound is real.
  - `[medium]` `[patch]` `_agentic-guardrails/` polluted the reviewed repo's git status — writer seeds `_agentic-guardrails/.gitignore` (reviews/, .cache/); this repo's root .gitignore covers dogfood output.
  - `[medium]` `[patch]` git-not-installed was reported as "not a git repository" — `repoRoot` returns typed kinds (git-not-found / not-a-repo / git-error) with accurate CLI messages; duplicate isRepo spawn dropped.
  - `[medium]` `[patch]` Exit-2 runs printed no reason — degradation reasons go to stderr one-per-line; info counts included; axiom groups sorted by id; category from an explicit map.
  - `[medium]` `[patch]` Rename/copy porcelain branch was untested — parser exported as seam; fabricated R/C buffer tests added.
  - `[medium]` `[patch]` Concurrent same-runId writes shared one temp path — unique pid+random temp names (artifact bytes stay deterministic); scope segment validated against path traversal; dir-fsync best effort; "durable" claim softened to visibility-atomic.
  - `[low]` `[patch]` BFS fallback fabricated a self-loop finding — now a degradation entry.
  - `[low]` `[patch]` ENGINE_VERSION triplicated — single-sourced from core; CLI imports it.
  - `[low]` `[patch]` e2e reached into `packages/contracts/dist` by relative path — root devDep + package-name import; root's boundary allowlist updated with rationale.
  - `[medium]` `[defer]` Dogfood residual: `packages/cli/tsup.config.ts` and `tests/integration/*.ts` are covered by no tsconfig project, so a dogfood run exits 2 with 3 honest degradations (`tsc -b` never checked those files either). Fix is repo-scope (a tests/tsconfig.json or root-solution reference), not this story's pipeline.
  - Bonus (dogfood-discovered): Node builtins (`node:*`) were degraded as unresolved bare specifiers — adapter treats builtins as verified externals.

Rejected: exit-code "degradation dominates findings" design challenge (documented, intentional; revisit if 1.18 CI gating needs split codes); clean-tree runId being a global constant (harmless — scope identity lands with 1.15 scopes); deleted-file dangling-importer detection (an unresolvable-import finding is 1.9 rule scope, and the import graph already degrades the missing target).

## Design Notes

CLI summary sketch (UI-MOCK-GATE substitute — plain sequential text, no placement dimension):

```
guardrails review (uncommitted)
axiom 1 · structural   1 error, 0 warnings
  src/a.ts:3  error  circular import: src/a.ts → src/b.ts → src/a.ts  [structural/circular-import]
artifact: _agentic-guardrails/reviews/uncommitted/<run-id>.json
1 finding (1 error) · deterministic tier · 0 degraded
```

- Circular-import detection: SCC or DFS back-edge over the 1.3 graph edges (ignore `typeOnly` edges — type cycles are legal); report each cycle once, anchored at the lexicographically-smallest member file (determinism), findingId's `enclosingSymbol` = the normalized `a→b→a` cycle string.
- Analyzer registry is a plain array of `(change, context) => findings` entries — no plugin machinery; 1.9+ appends.
- Run-id hash excludes wall-clock so re-runs on identical input overwrite the same artifact file (idempotent, cache-friendly for 1.7).
- Temp git repos in tests: create under the OS temp dir, set `user.email/name` locally, never touch the host repo.

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries` -- expected: green (cli boundary entry present)
- `pnpm -r build && pnpm -r test && pnpm test` -- expected: green; e2e test actually spawns the built CLI


## Auto Run Result

- **Summary:** Walking skeleton complete: `guardrails review` (new `cli` package) runs uncommitted-scope reviews through real pipeline phases 0→1→4→5 with one real Axiom #1 rule (circular-import over the 1.3 graph), per-axiom crash isolation, typed git wrapper, and atomic deterministic artifacts (contracts-validated envelope, embedded manifest, zero-silent-degradation). Review pass applied 14 patches (3 high: solution-tsconfig support incl. dogfood case, exit-code contract hardening, complete runId identity), deferred 1 (repo-scope tests/tsconfig coverage gap), and dogfooding surfaced + fixed a Node-builtins false-degradation bug.
- **Files changed:** new `packages/cli/` (commander CLI, exit codes 0/1/2); `packages/core/src/{pipeline,analyzers,git,persistence}/` (+tests); `packages/contracts/src/review-artifact.ts` (+migration registration, fixture, tests); `scripts/check-boundaries.mjs` (cli + root entries); root `tsconfig.json`, `.gitignore`, `package.json` (contracts devDep); `tests/integration/walking-skeleton.e2e.test.ts`; `tests/e2e-coverage.md`; `README.md`; `CHANGELOG.md`.
- **Review findings breakdown:** 14 patched (3 high, 8 medium, 3 low), 1 deferred, 3 rejected, 0 intent_gap, 0 bad_spec.
- **Follow-up review recommendation:** true — pre-committed via OVERSIZED-STORY RULE and auto-forced by three HIGH inline findings (FOLLOW-UP-REVIEW AUTO-FORCE ON HIGH; no decline branch).
- **Verification:** `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:boundaries` (root, cli, contracts, core), `pnpm -r build`, `pnpm -r test` (32+54+4), `pnpm test` (14 files / 140 tests incl. e2e spawning the built CLI in temp git repos) — all green. Live dogfood run on this repo: solution tsconfig resolved through references, exits 2 only on the 3 honest deferred coverage degradations.
- **Residual risks:** Dogfood exits 2 until the deferred tests/tsconfig gap is closed (tracked in deferred-work). Exit-code semantics (degradation dominates findings) may need a revisit when 1.18 wires CI gating. p-map bound of 4 is a placeholder until SPIKE-3 (1.5).
