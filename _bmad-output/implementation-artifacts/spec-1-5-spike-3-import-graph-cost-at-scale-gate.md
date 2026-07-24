---
title: 'Story 1.5: SPIKE-3 — Import-Graph Cost at Scale (gate)'
type: 'chore'
created: '2026-07-24'
status: 'done'
baseline_revision: 1ea366d50440c8bf41bc629c2141e520bbee950d
final_revision: 4c6019ba9ca41071e861fc494f4ab36f28bad24d
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** NFR scale claims (<60s pipeline on ~1,000 files; usable at 10,000+) and the ts-morph-vs-hybrid decision rest on zero measurements; analyzer scale-out (1.9+) is gated on these numbers.

**Approach:** A committed benchmark harness generates synthetic repos (10,000-file and ~1,000-file), measures cold/warm import-graph build wall-clock + peak RSS under candidate p-map bounds and full-pipeline wall-clock, and records the numbers, derived budgets, and the go/hybrid decision in a committed spike write-up.

## Boundaries & Constraints

**Always:**
- Measurements are REAL runs on this machine (recorded with hardware context: CPU model, RAM, Node version, date) — never estimated or extrapolated numbers presented as measured (SAMPLE-OF-ONE: record per-run numbers across ≥3 runs, report median + spread, not one sample).
- Synthetic repos are generated to OS temp by the harness (never committed; deterministic generator with fixed seed so runs are comparable).
- The 1,000-file pipeline measurement runs the REAL `runReview` (core), not a stripped harness.
- Resolution correctness at scale: golden-fixture expectations re-asserted on a sampled subset of the synthetic repo (generator knows ground truth edges).
- The write-up records: measured numbers, the derived warm-rebuild regression budget, the chosen p-map bound (consumed by 1.7), and the explicit gate verdict (pass → continue; fail → hybrid ADR required before 1.9+).
- Harness is committed (`scripts/spike-3-benchmark.mjs` or similar) and re-runnable; write-up committed at `docs/spikes/SPIKE-3-import-graph-cost.md`; CHANGELOG entry.

**Block If:**
- The 1,000-file pipeline exceeds 60s (NFR-1 hard fail) — the hybrid fallback is an architecture decision requiring an ADR and human awareness; HALT with the measured numbers rather than auto-deciding the ts-morph replacement.

**Never:**
- No production-code changes beyond what measurement strictly requires (this is a spike; if a bottleneck fix is tempting, record it in the write-up for 1.7). No committed 10k-file fixtures. No CI wiring of the benchmark (manual/dogfood tool; CI perf gating is later scope).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 10k cold build | fresh synthetic repo, no prior process state | wall-clock + peak RSS recorded per run (≥3 runs, median) | generator/build failure aborts with message |
| 10k warm rebuild | second build in same process | wall-clock recorded; warm budget derived | n/a |
| Concurrency sweep | p-map bounds {2, 4, 8} on the graph-build workload | per-bound numbers; chosen bound justified in write-up | n/a |
| 1k full pipeline | ~1,000-file repo, one changed file with a cycle | end-to-end `runReview` wall-clock < 60s (hard gate); findings correct | >60s → BLOCK per Block If |
| Correctness at scale | sampled ground-truth edges from generator | all sampled edges present exactly | mismatch → gate fail, recorded |

</intent-contract>

## Code Map

- `packages/core/src/adapter/typescript-adapter.ts` -- measured subject (buildImportGraph)
- `packages/core/src/pipeline/pipeline.ts` -- `runReview` for the 1k measurement; current p-map bound 4 (ponytail note → this spike)
- `scripts/` -- benchmark harness lands here (plain .mjs, imports built `packages/core/dist`)
- `docs/spikes/` -- new directory for the write-up
- `tests/e2e-coverage.md` -- 1.5 row (no UI-facing ACs)

## Tasks & Acceptance

**Execution:**
- [x] `scripts/spike-3-generate-repo.mjs` -- deterministic synthetic repo generator (seeded): N files across M dirs, realistic import shapes (relative imports, some barrels, a few aliases via generated tsconfig paths, known ground-truth edge list emitted beside the repo) -- measurement input
- [x] `scripts/spike-3-benchmark.mjs` -- harness: generates 10k + 1k repos in temp, runs (a) cold/warm graph builds ×3 with peak-RSS sampling and concurrency sweep {2,4,8}, (b) real `runReview` on the 1k repo ×3, (c) correctness sampling vs ground truth; prints a results table; exits non-zero if the 60s gate fails -- the spike instrument
- [x] `docs/spikes/SPIKE-3-import-graph-cost.md` -- write-up: hardware context, per-run numbers (median + spread), derived warm-rebuild regression budget, chosen p-map bound + rationale, gate verdict, observed bottlenecks for 1.7 -- the deliverable consumed by 1.7/1.9
- [x] `packages/core/src/pipeline/pipeline.ts` -- update the p-map bound to the measured choice; ponytail note now cites the spike doc -- close the loop
- [x] `tests/e2e-coverage.md` + `CHANGELOG.md` -- 1.5 row (spike, no UI flow); changelog entry -- DoD

**Acceptance Criteria:**
- Given the 10k synthetic repo, when cold and warm builds run under the swept bounds, then wall-clock and peak memory are recorded per run and a warm-rebuild budget is derived and written into the spike doc.
- Given the ~1k repo, when the full deterministic pipeline runs, then median wall-clock is under 60 seconds (hard gate; miss → BLOCK for hybrid ADR).
- Given the spike passes, then the measured numbers set the p-map bound in code (consumed by 1.7) and sampled resolution correctness holds at scale.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test`, when run, then all green (harness excluded from test globs; scripts lint applies).

## Spec Change Log

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 6, low 3)
- defer: 0
- reject: 7: (high 0, medium 0, low 7)
- addressed_findings:
  - `[medium]` `[patch]` Correctness "proof" was a 200-edge recall-only sample while the full edge sets were already in memory — replaced with full bidirectional set equality (28,025 vs 28,025; 0 missing, 0 spurious), tuple keys instead of JSON.stringify fragility.
  - `[medium]` `[patch]` False-PASS holes: coverage<1, degraded>0, wrong node count, degradedRun, or missing cycle finding could coexist with "GATE: PASS" — all now fail the gate; degraded counts printed per run (the doc's "0 degradations" claim is now backed by output).
  - `[medium]` `[patch]` Gate statistic was median-of-3 (a >60s outlier could pass) — now max-of-runs.
  - `[medium]` `[patch]` Warm/cold edge-count equality (free determinism check) asserted per run.
  - `[medium]` `[patch]` Doc methodology fixes: cold-start caveat (fs cache warm even for "cold" runs), RSS attribution caveat (both graphs resident at read), single-file change-set + in-process timing disclosure on the gate, both seeds stated, sweep annotated as a-priori-flat (synchronous mappers serialize regardless of bound).
  - `[medium]` `[patch]` CHANGELOG mislabeled the hand-rolled bounded pool as a "p-map sweep" — corrected.
  - `[low]` `[patch]` median() returned lower-middle for even run counts — averages the middle pair now.
  - `[low]` `[patch]` Env overrides unvalidated (NaN → empty loops with confusing output) — validated with clear errors.
  - `[low]` `[patch]` Windows rmSync cleanup could throw in finally and mask the exit path — try/catch + maxRetries, leaked path logged.

Re-run with corrected harness (2026-07-24T16:05Z): gate PASS at max 981 ms vs 60,000 ms (~61x headroom); 10k cold median 7,051 ms, warm 9,960 ms, peak RSS 1,083 MB; warm-rebuild budget recomputed to 15 s. Honest new finding recorded in the doc: warm rebuild is SLOWER than cold in-process (cold result stays resident, GC pressure) — the earlier "warm ~ cold" story was an artifact of the old harness.

Rejected (spike-tool noise, ponytail): child-crash retry logic; --child argv guard (internal invocation only); os.cpus() empty-array guard; generator import-count prose ("2-4" vs "up to 4" — shape confirmed empirically); same-200-sample repetition note (superseded by full equality); generator degenerate fileCount guards (harness validates env); duplicate-cycle-import possibility (did not occur; cycle finding asserted every run).

## Design Notes

- Peak RSS: sample `process.memoryUsage().rss` on an interval in-process (graph build is in-process); for the spawned pipeline run, prefer in-process `runReview` import over spawning the CLI so RSS is observable — the CLI adds nothing to the measured path.
- Warm budget derivation: median warm rebuild × 1.5 safety factor, rounded up — stated formula in the write-up so later regressions are arguable.
- Generator shape: ~30 files/dir, 2–4 imports/file biased to same-dir, 5% barrel re-exports, 2% alias imports, no cycles by construction except one seeded cycle in the 1k repo for the pipeline finding check.

## Verification

**Commands:**
- `node scripts/spike-3-benchmark.mjs` -- expected: results table, gate PASS, non-zero exit only on gate failure
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test` -- expected: green


## Auto Run Result

- **Summary:** SPIKE-3 complete and the gate PASSES with ~61x headroom: full deterministic pipeline on a ~1,000-file repo runs in max 981 ms (3 runs) vs the 60 s NFR-1 gate; 10k-file graph builds at ~7 s cold / ~1.1 GB peak RSS with full bidirectional edge-set correctness (0 missing, 0 spurious of 28,025). No hybrid ADR needed; ts-morph stands. p-map bound stays 4 (provisional by construction — single analyzer; sweep flat and documented as a priori flat). Warm-rebuild regression budget: 15 s. Review pass hardened the harness against false PASSes and made the write-up's methodology claims match what actually ran; the corrected harness surfaced an honest reversal (warm in-process rebuild slower than cold — GC pressure), now recorded for story 1.7.
- **Files changed:** `scripts/spike-3-generate-repo.mjs`, `scripts/spike-3-benchmark.mjs` (new); `docs/spikes/SPIKE-3-import-graph-cost.md` (new write-up, re-measured numbers); `packages/core/src/pipeline/pipeline.ts` (bound comment cites spike doc); `eslint.config.js` (performance global); `tests/e2e-coverage.md` (1.5 row); `CHANGELOG.md`.
- **Review findings breakdown:** 9 patched (6 medium, 3 low), 0 deferred, 7 rejected, 0 intent_gap, 0 bad_spec.
- **Follow-up review recommendation:** false — patches were harness-soundness and doc-honesty fixes on a spike tool; the gate verdict was never at risk and the deliverable was re-measured under the corrected logic.
- **Verification:** benchmark re-run end-to-end exit 0 (gate PASS, correctness equal both directions, 0 degradations printed per run); `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:boundaries`, `pnpm -r build`, `pnpm -r test`, `pnpm test` (140 tests) — all green.
- **Residual risks:** Budgets are N=3 on one machine (i7-12700H/15.6 GB, stated in the doc); the 15 s warm budget and bound 4 are provisional until 1.7 makes rebuilds incremental and 1.9+ adds analyzers worth parallelizing. ~1 GB RSS per 10k-file project caps future worker parallelism (~4 on 16 GB) — recorded for 1.7.
