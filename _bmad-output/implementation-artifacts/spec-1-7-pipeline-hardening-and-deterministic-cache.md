---
title: 'Story 1.7: Pipeline Hardening and Deterministic Cache'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: 63571cb020e509eb5434e2f9deda049c0300fe6f
final_revision: 67324540d858a6281b1b4f754946995bf8e0a5db
review_loop_iteration: 0
followup_review_recommended: true # AUTO-FORCED: five HIGH inline findings (cache poisoning; post-abort cache leak; nondeterministic merge order; silent cache-disable; unobservable budget signal)
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** The pipeline lacks the hardening the architecture promises: no finding merge (FR-21), no content-addressed cache (unchanged inputs pay full price — and SPIKE-3 measured full re-parse every run), no phase time budgets, and phase membership is static.

**Approach:** Add the reduce/merge step in aggregation, a content-addressed cache under `_agentic-guardrails/.cache/` (graph + findings, keyed on change + context + ruleset + engine + tier-enablement), per-phase time budgets that degrade to partials, and dynamic per-phase membership (scope/mode/config in, six-phase shape fixed).

## Boundaries & Constraints

**Always:**
- Six-phase shape stays FIXED (0 preflight → 1 deterministic → 2 SDD gate → 3 LLM enrichment → 4 aggregation → 5 composition); membership within phases varies by scope/mode/artifacts/config; phases 2/3 remain empty-membership (Epic 2/3) but the assembly declares them (manifest says empty-membership, why).
- Per-axiom isolation already exists — extend: failed axiom appears as degraded in the manifest AND the CLI report header; exit follows gating config (a degraded run stays exit 2 — unchanged rule).
- Merge rule exactly FR-21: same file + same axiom + >50% line overlap → one finding, `source` becomes a source array, strongest severity wins (error > warning > info), both descriptions preserved. Contracts finding schema must support the merged shape (source array or a merged-finding wrapper — pick the minimal schema change that stays contract-valid; document).
- Overlap math: >50% of the SMALLER range's lines overlap the other (state the rule in code + spec-level test both directions: contained ranges merge; adjacent non-overlapping don't).
- Cache: content-addressed under `_agentic-guardrails/.cache/{graph,findings}/`, key = sha256 of {change content hashes, context (tsconfig hash, scope), ruleset version, engine version, tier-enablement}; hit → skip analyzer execution AND graph build (serve both from cache); miss → compute + write-through (atomic writes). Manifest declares cache hits/misses per unit (zero silent behavior). Cached findings must revalidate through contracts schema on read (torn/stale cache → miss + degradation, never a crash or wrong data).
- Cache is gitignored (already: `.cache/` in seeded .gitignore); bounded: prune to newest 100 entries per kind (mirror the manifests-pruning convention).
- Phase time budgets: per-phase wall-clock ceilings (defaults derived from SPIKE-3 numbers: phase 1 budget = 30s default, config-overridable later — hardcode constants with the spike doc cited; a ponytail note marks config exposure as later scope); phase over budget → abort that phase's remaining work via AbortSignal-checked p-map, degrade to partials with typed reason; never an uncaught failure.
- Byte determinism preserved: cache hit and cache miss produce byte-identical artifacts (cache serves the same data it would compute); prove with a test.
- p-map bound: keep 4, cite SPIKE-3 (already done in 1.5).

**Block If:**
- FR-21 merged-source shape cannot be expressed without breaking the strict finding schema for existing consumers (would need a schemaVersion bump decision).

**Never:**
- No LLM-tier cache (Epic 3 has its own input-hash cache). No cross-repo/shared cache. No cache-invalidation config surface. No daemon/watch mode. No worker threads (SPIKE-3 recorded the memory ceiling; incremental reuse is the recorded win but process-lifetime is per-run — cache IS the reuse mechanism).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Merge overlap | two findings, same file+axiom, lines 10-20 and 15-25 | one finding, source array, strongest severity, both messages | No error expected |
| Contained range | lines 10-30 and 12-14 (same file+axiom) | merge (smaller fully inside) | No error expected |
| No overlap | lines 10-20 and 21-30 | two findings unchanged | No error expected |
| Different axiom | same lines, axioms 1 and 5 | never merged | No error expected |
| Cache cold | first run | miss recorded in manifest; artifacts written; cache populated | No error expected |
| Cache warm | identical repo state re-run | hit recorded; analyzers skipped; artifact byte-identical to cold run | No error expected |
| Input change | one changed file edited | miss (key changed); recompute | No error expected |
| Corrupt cache entry | truncated/garbage cache file | treated as miss + degradation note; recompute; entry overwritten | never crash |
| Cache schema drift | cached findings fail contracts safeParse | miss + degradation; recompute | never wrong data |
| Phase timeout | phase 1 exceeds budget (test with tiny budget + slow fake analyzer) | phase degrades to partials, typed reason, run completes | no uncaught failure |
| Analyzer throw | (existing) one analyzer throws | others complete; degraded in manifest AND report header | unchanged |


</intent-contract>

## Code Map

- `packages/core/src/pipeline/pipeline.ts` -- phase spine; p-map; per-axiom isolation; runId inputs (cache key overlaps but is per-unit, not per-run)
- `packages/core/src/analyzers/axiom1-structural.ts` -- findings producer (merge consumes)
- `packages/contracts/src/finding.ts` -- strict finding schema; source enum (merge needs source array support)
- `packages/core/src/persistence/artifact-writer.ts` -- `writeFileAtomic` seam for cache writes
- `packages/core/src/config/config-loader.ts` -- config in, gating (exit rules unchanged)
- `packages/cli/src/review-command.ts` -- report header (degraded axioms surface here)
- `docs/spikes/SPIKE-3-import-graph-cost.md` -- budget defaults + reuse rationale

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/finding.ts` -- support merged findings: `source` becomes `z.enum([...])` OR array of that enum (accept both single and array; normalize docs); superRefine adjusted (deterministic tier: no 'llm' in any source) -- FR-21 shape
- [x] `packages/core/src/pipeline/merge.ts` -- pure `mergeFindings(findings)`: group by file+axiom, >50%-of-smaller-range overlap rule, strongest severity, source union, messages joined (both preserved), deterministic output order + stable findingId choice (lexicographically smallest of the merged ids; document) -- FR-21
- [x] `packages/core/src/cache/deterministic-cache.ts` -- content-addressed store: `get(kind, key)` / `put(kind, key, value)` under `_agentic-guardrails/.cache/<kind>/<key>.json`, atomic writes, contracts revalidation on read (invalid → miss + degradation), prune to newest 100 per kind by mtime -- the cache
- [x] `packages/core/src/pipeline/pipeline.ts` -- assembly step: declare six phases with membership derived from scope/mode/config (2/3 empty-membership declared in manifest); cache wiring (graph + per-axiom findings; hit skips work; hits/misses into manifest); phase budgets via AbortSignal + typed degradation; merge step in phase 4 before sort -- the hardening
- [x] `packages/core/src/pipeline/manifest.ts` + contracts `run-manifest.ts` -- optional fields: `phases: [{ phase, members, ran, reason? }]`, `cache: { hits, misses, invalid }` -- declared assembly + cache truth
- [x] `packages/cli/src/review-command.ts` -- report header lists degraded axioms (name + reason) above the findings block -- NFR-8 surface
- [x] unit tests -- merge matrix rows (overlap both directions, contained, adjacent, cross-axiom, severity/source/message assertions, deterministic order); cache (cold/warm/key-change/corrupt/schema-drift rows incl. HAZARD: corrupt entry recomputes and overwrites, never crashes; warm-vs-cold byte-identity of artifact); phase budget (slow fake analyzer + tiny budget → typed degradation, run completes); assembly membership variants -- coverage
- [x] `tests/integration/pipeline-hardening.e2e.test.ts` -- e2e: run twice (second run cache-hit recorded in manifest, artifact byte-identical); corrupt a cache file between runs → still correct output + degradation note; report header shows degraded axiom when forced -- AC oracle
- [x] `tests/e2e-coverage.md` + `README.md` + `CHANGELOG.md` -- 1.7 rows; cache + merge documented -- DoD

**Acceptance Criteria:**
- Given an analyzer that throws mid-run, when the pipeline executes, then other axioms complete, the failed axiom is degraded with a typed reason in the manifest AND the report header, and exit follows gating config.
- Given scope/mode/artifacts/config, when the pipeline assembles, then per-phase membership varies while the six-phase shape stays fixed, declared in the manifest.
- Given two findings on the same file+axiom with >50% overlap, when reduce runs, then one finding with source array, strongest severity, both descriptions.
- Given unchanged inputs, when a review re-runs, then graph and findings serve from the content-addressed cache, analyzer execution is skipped, hits are declared in the manifest, and the artifact is byte-identical to the cold run.
- Given a phase exceeding its time budget, when the run executes, then it degrades to partials with a typed reason — never an uncaught failure.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test`, when run, then all green.

## Spec Change Log

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 16: (high 5, medium 6, low 5)
- defer: 1: (high 0, medium 1, low 0)
- reject: 4: (high 0, medium 1, low 3)
- addressed_findings:
  - `[high]` `[patch]` Cache poisoning: `.cache/` is attacker-writable in-repo, keys are computable, and Zod-only revalidation accepts any schema-valid planted entry — every cache entry is now HMAC-SHA256-authenticated with a per-user secret (`~/.agentic-guardrails/cache-secret`, 32 bytes, 0o600), MAC verified via timingSafeEqual BEFORE Zod; MAC failure = invalid miss + typed degradation; secret unavailable = caching disabled with a declared reason, never unauthenticated. Unit (planted/tampered/wrong-secret/roundtrip) + e2e (planted schema-valid "no findings" entry is rejected, cycle still reported, exit 2).
  - `[high]` `[patch]` Post-abort cache writes leaked aborted/partial results into future runs as clean hits — no `put` after `signal.aborted` and never for results carrying degradations; non-abort rejections rethrow even post-abort; tests for both.
  - `[high]` `[patch]` Merged-output sort tie-break omitted message/ruleId — equal-key findings ordered nondeterministically, breaking byte-identity; comparator extended, plus degraded-info preservation when the owner finding lacks a constituent's marker, plus duplicate-axiom analyzer registration now a typed error instead of a silent clobber.
  - `[high]` `[patch]` Silent cache-disable contradicted the manifest counters (zeros indistinguishable from "no cacheable work") — manifest `cache.disabled: <reason>` field added to contracts; declared for secret-unavailable, unwritable cache dir, uncomputable key (the "unreadable" sentinel hack removed), and empty analyzable set; CLI stderr line surfaces it.
  - `[high]` `[patch]` Phase budget AbortSignal was never observable by analyzers — `AnalyzerContext.signal` wired from the phase-1 controller with honest docs (current analyzers are synchronous; cancellation lands between units); `phases[1].ran`/reason now reflect aborted reality ("aborted at Nms — X/Y completed").
  - `[medium]` `[patch]` TypeScript upgrades did not invalidate cache entries — `ts.version` folded into both graph and findings keys; seam test proves version change → key change.
  - `[medium]` `[patch]` Manifest cache stats were a live object reference, mutable after snapshot — spread copy.
  - `[medium]` `[patch]` Contracts accepted any phases array — refined to exactly 6 entries ordered 0..5.
  - `[medium]` `[patch]` Pre-existing `_agentic-guardrails/.gitignore` was left stale — missing seeded lines appended, user content preserved.
  - `[medium]` `[patch]` `writeFileAtomic` leaked tmp files on rename failure — cleanup + rethrow; prune also sweeps orphaned `*.tmp` older than 1h.
  - `[medium]` `[patch]` Finding `source` array variant accepted unsorted/duplicated values — refined sorted + unique.
  - `[low]` `[patch]` CLI printed C0 control chars from finding messages verbatim — stripped (except \n/\t) via code-point filter.
  - `[low]` `[patch]` `normalizeCacheTruth` triplicated across test files — extracted to `packages/core/src/pipeline/normalize-cache-truth.ts` (in-src: core's rootDir forbids a tests/-located helper under `tsc -b`).
  - `[low]` `[patch]` Unused `DEFAULT_PHASE_BUDGET_MS` export — deleted.
  - `[low]` `[patch]` computeGraphKey performs O(project) file I/O per run — documented honestly at the seam rather than implying free key computation.
  - `[low]` `[patch]` Cache-poisoning e2e row added to `tests/e2e-coverage.md`.
  - `[medium]` `[defer]` Merged-finding disposition continuity policy (owner id keeps ONE constituent's disposition; the others orphan) — needs the dispositions design; deferred to story 1.16.

Rejected: LRU-vs-FIFO prune ordering (mtime prune is a ponytail ceiling — revisit if cache thrash is ever observed); merged-message separator collision (separator is display-only, findingId is the identity carrier); schemaVersion bump for the source-array shape (no deployed pre-v1 readers exist; migration ladder note suffices); dynamic phase-budget config surface (recorded later-scope in the spec, not a defect).

## Design Notes

- Cache key vs runId: runId identifies the WHOLE run (includes HEAD); cache keys identify per-unit work (graph: tsconfig hash + participating file content hashes; findings: graph key + axiom + ruleset + engine + tier-enablement) so an unrelated commit (HEAD change, same content) still cache-hits. State this asymmetry in code comments.
- Merged findingId: reusing the smallest constituent id keeps disposition continuity for at least one constituent; alternatives (hash of both) orphan all dispositions. Document the tradeoff inline.
- Budget defaults: phase 1 = 30s (SPIKE-3 measured 0.95s on 1k files — 30s is ~30x headroom while still bounding runaway repos); other phases 10s. Constants with spike citation, config exposure later (ponytail note).

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test` -- expected: green with new e2e collected


## Auto Run Result

- **Summary:** Pipeline hardened: FR-21 finding merge (>50%-of-smaller overlap, source array, strongest severity, smallest-id owner), HMAC-authenticated content-addressed cache under `_agentic-guardrails/.cache/{graph,findings}/` (hit skips graph build + analyzers; cold/warm byte-identical modulo normalized cache counters), per-phase wall-clock budgets degrading to typed partials via AbortSignal, and the declared six-phase assembly in the manifest (phases 2/3 empty-membership with reasons). ADR-003 (orchestration) written as planned. Review pass applied 16 patches (5 high — headline: cache entries are now HMAC-signed with a per-user secret so a repo-local attacker cannot plant schema-valid findings, and aborted/degraded results can never be cached as future clean hits).
- **Files changed:** `packages/contracts/src/finding.ts` (source array, sorted+unique), `run-manifest.ts` (phases refine, cache + disabled); `packages/core/src/pipeline/merge.ts` + `merge.test.ts` (new), `pipeline.ts` (assembly, budgets, cache wiring, DuplicateAnalyzerError), `manifest.ts`, `normalize-cache-truth.ts` (new); `packages/core/src/cache/deterministic-cache.ts` (new, HMAC + prune); `persistence/artifact-writer.ts` (gitignore append, tmp cleanup); `packages/cli/src/review-command.ts` (degraded header, cache-disabled stderr, control-char strip); `tests/integration/pipeline-hardening.e2e.test.ts` (new); `docs/adr/ADR-003-orchestration.md` (new) + ADR README; `tests/e2e-coverage.md`, `README.md`, `CHANGELOG.md`.
- **Review findings breakdown:** 16 patched (5 high, 6 medium, 5 low), 1 deferred (merged-finding disposition policy → 1.16), 4 rejected, 0 intent_gap, 0 bad_spec.
- **Follow-up review recommendation:** true — auto-forced by five HIGH inline findings (FOLLOW-UP-REVIEW AUTO-FORCE ON HIGH; no decline branch).
- **Verification:** `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:boundaries`, `pnpm -r build`, `pnpm -r test` (43 contracts + 134 core + 5 cli), `pnpm test` (19 files / 247 tests) — all green after patches.
- **Residual risks:** Cache secret is per-user, not per-repo — a same-user process can still sign entries (threat model: repo-local attacker, not same-user compromise). Budget constants hardcoded (config exposure later scope). Merged-finding disposition continuity deferred to 1.16.
