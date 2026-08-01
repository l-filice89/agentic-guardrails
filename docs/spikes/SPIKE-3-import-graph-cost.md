# SPIKE-3 — Import-Graph Cost at Scale (Story 1.5)

Measures the real cost of the ts-morph import-graph build (ADR-004) at 10k
files and the full deterministic pipeline at ~1k files, deciding the NFR-1
gate (<60s on ~1k files) and the concurrency bound consumed by 1.7/1.9.

**Verdict: GATE PASS.** 1k-file full `runReview` worst run 0.98s, median
0.97s (gate: max-of-3 < 60s). ts-morph stays; no hybrid ADR needed.

## Hardware context

| | |
|---|---|
| CPU | 12th Gen Intel(R) Core(TM) i7-12700H, 20 logical cores |
| RAM | 15.6 GB |
| OS | Windows 11 (win32) |
| Node | v24.6.0 |
| Date | 2026-07-24 |

## Methodology

- Harness: `scripts/spike-3-benchmark.mjs` (re-runnable: `node scripts/spike-3-benchmark.mjs`), generator: `scripts/spike-3-generate-repo.mjs`. Seeds: **20260724** (10k repo), **20260725** (SEED+1, 1k repo); repos generated to OS temp, deleted after the run.
- Repo shape (per spec design notes): ~30 files/dir, 2–4 imports/file biased ~70% same-dir, ~5% barrel re-export files, ~2% alias imports via tsconfig `paths` (`@lib/* → d000/*`), acyclic by construction (imports only target lower file indices). The 1k repo adds one seeded 2-file cycle (`d033/f998.ts ↔ d033/f999.ts`).
- 10k repo: 10,000 files, 334 dirs, 28,025 ground-truth edges. 1k repo: 1,000 files, git-initialized, everything committed, then one cycle-member file touched so `runReview` has exactly one uncommitted changed file — the reviewed change set is that **single changed file**.
- 3 runs per measurement. Each run is a **fresh child process**; warm rebuild = second `buildImportGraph` call in the same process. **Cold-start caveat:** the OS file cache is warm even for "cold" runs — the repo is written moments before — so cold here means cold JIT + module state, not a cold fs cache. Peak RSS via `process.resourceUsage().maxRSS` (OS-reported per-process peak working set — valid even though the build is synchronous and blocks interval sampling). **RSS attribution caveat:** the graph child holds the cold and warm results simultaneously when RSS is read, so the number bounds the two-builds-resident case; the peak of a single build was not isolated.
- Concurrency sweep: the 10k repo partitioned into 8 shard tsconfigs (contiguous dir blocks), built through a hand-rolled bounded async pool at bounds {2, 4, 8}. Note: TypeScript program semantics pull each shard's transitive dependency closure into its program, so shards overlap and summed shard edges (101,262) exceed the full-graph edge count — the workload is identical across bounds, which is what the sweep compares.
- Gate methodology: **max of 3 runs vs 60s** (worst case, not median). Timing wraps `runReview` in-process — CLI startup and artifact write are excluded. A degraded run or a missing cycle finding fails the gate, not just the harness.
- Correctness: **full bidirectional set equality** between the seeded ground-truth edge set and the built 10k graph, keyed on the exact tuple (from, to, dynamic, typeOnly, reExport) — missing and spurious edges reported separately. The harness also asserts coverage = 1, 0 degradations, node count = 10,000, and warm edge count = cold edge count on every run.

## Results

All numbers as printed by the run of 2026-07-24T16:05Z (exit 0).

### 10k-file graph build (cold + warm, fresh process per run)

| Run | Cold (ms) | Warm rebuild (ms) | Peak RSS (MB) | Degraded |
|---|---|---|---|---|
| 1 | 6,976 | 9,960 | 1,082 | 0 |
| 2 | 7,241 | 9,832 | 1,084 | 0 |
| 3 | 7,051 | 10,045 | 1,083 | 0 |
| **Median** | **7,051** | **9,960** | **1,083** | |

Graph: 10,000 nodes, 28,025 edges, coverage 1, degraded count 0 — printed
per run, every run. Warm edge count equalled cold edge count on every run
(determinism check).

Note the warm rebuild was *slower* than the cold build this run (median
10.0s vs 7.1s): during the warm build the cold build's full result is still
live in the same process (see the RSS attribution caveat), so GC pressure
works against the JIT win. With fs cache warm in both cases, "cold vs warm"
here measures JIT + module state + heap residency, nothing else.

### Concurrency sweep (8-shard 10k workload, 3 runs per bound)

| Bound | Runs (ms) | Median (ms) | Peak RSS (MB, per run) |
|---|---|---|---|
| 2 | 34,160 / 34,411 / 34,136 | 34,160 | 887 / 887 / 1,038 |
| 4 | 33,846 / 33,838 / 34,244 | 33,846 | 1,039 / 1,034 / 1,075 |
| 8 | 34,181 / 34,026 / 34,152 | 34,152 | 1,034 / 1,041 / 1,040 |

Flat across bounds (spread within run-to-run noise), as expected:
`buildImportGraph` is synchronous CPU-bound work on one thread, so a
concurrency bound cannot create parallelism — it only limits interleaving
that never happens. The sweep could not have differed a priori (synchronous
mappers serialize regardless of bound); the numbers are recorded for
completeness, honestly flat and provisional.

### 1k-file full pipeline (`runReview`, real git repo) — the gate

| Run | Total (ms) | Peak RSS (MB) | Findings | Degraded run |
|---|---|---|---|---|
| 1 | 981 | 292 | 1 | false |
| 2 | 973 | 293 | 1 | false |
| 3 | 962 | 292 | 1 | false |
| **Median** | **973** | **292** | | |

The single finding is the seeded `structural/circular-import` cycle,
anchored at a cycle member — findings correct on every run.

**Gate (<60s, max of 3 runs): PASS** — max 981 ms (0.98s), ~61× headroom.
Reminder: the change set is one changed file, and timing wraps `runReview`
in-process (CLI startup + artifact write excluded).

### Correctness at scale

Full bidirectional set equality against the built 10k graph:
**28,025 ground-truth vs 28,025 built edges, 0 missing, 0 spurious**
(exact from/to + dynamic/typeOnly/reExport tuple match). Resolution
correctness holds at scale in both directions — nothing dropped, nothing
invented.

## Derived warm-rebuild regression budget

Formula: `ceil(median warm rebuild × 1.5)` = ceil(9,960 ms × 1.5) = **14,940 ms → 15s**
for a 10k-file warm graph rebuild on this class of hardware. A future change
pushing the 10k warm rebuild past 15s is a regression worth arguing about.

## Chosen p-map bound: 4 (unchanged)

- The sweep measured **no effect** from the bound (34.2s / 33.8s / 34.2s medians): the only analyzer work today is synchronous, single-threaded ts-morph parsing, which a concurrency bound cannot parallelize — and could not have, a priori.
- With a single registered analyzer (axiom-1), the pipeline-level bound is degenerate — any bound ≥1 behaves identically. The choice is therefore **provisional by construction**, not measured-optimal.
- 4 is kept because it is a sane cap once 1.9 registers multiple analyzers with genuinely async work, and no measurement argues for moving it. `packages/core/src/pipeline/pipeline.ts` cites this doc.

## Observed bottlenecks (input to Story 1.7)

- **Parsing dominates.** A warm "rebuild" re-parses all 10k files (each `buildImportGraph` builds a fresh ts-morph `Project`): 10.0s warm vs 7.1s cold — warm is *slower* under the heap residency of the retained cold result. An incremental/warm-project reuse path (retain the `Project`, re-parse only changed files) is where 1.7 should look for order-of-magnitude wins, not concurrency.
- **A concurrency bound cannot help CPU-bound sync analyzers.** Real parallelism at the graph-build level needs worker threads (one project per worker); the shard experiment shows the workload partitions cleanly, but shard programs pull in their transitive closure, so naive sharding does ~3.6× duplicate parsing (101k summed edges vs 28k real).
- **Memory is fine but not free:** ~1.1 GB peak RSS for 10k files with two build results resident (single-build peak not isolated). Multiple concurrent worker projects would multiply this; on a 16 GB box, 4 workers ≈ 4 GB is the practical ceiling.
- 1k-repo scale is a non-issue end to end (0.97s median, 292 MB).
