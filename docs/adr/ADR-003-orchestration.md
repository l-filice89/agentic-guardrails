# ADR-003: Orchestration — Static Six-Phase Pipeline + p-map

## Status

Accepted — 2026-07-24 (Story 1.7)

## Context

The review engine needs an execution model that (a) keeps output byte-deterministic,
(b) isolates analyzer failures so one crash never sinks a run, (c) leaves declared
room for the SDD gate (Epic 2) and LLM enrichment (Epic 3) without reshaping the
runtime, and (d) bounds wall-clock on pathological repos. Alternatives considered:
a dynamic DAG scheduler (phases derived from artifact dependencies at runtime) and
worker-thread parallelism (rejected by SPIKE-3's memory-ceiling measurement).

## Decision

A **static six-phase pipeline** with **dynamic membership**:

- The phase *shape* is fixed and totally ordered: 0 preflight → 1 deterministic
  analysis → 2 SDD gate → 3 LLM enrichment → 4 aggregation → 5 composition.
  Membership within each phase varies by scope/mode/config; phases 2 and 3 are
  declared empty-membership until their epics land. The manifest records all six
  phases every run — `{ phase, members, ran, reason? }` — so an absent phase is
  declared, never silent.
- Within phase 1, analyzers run through **p-map with concurrency 4** (bound
  measured in SPIKE-3), each isolated: a throwing analyzer becomes a typed
  degradation in the manifest and report header while siblings complete.
- **Per-phase wall-clock budgets** (phase 1: 30s, ~30× SPIKE-3's 1k-file
  measurement) abort remaining work via an AbortSignal threaded through p-map
  and `AnalyzerContext.signal`, degrading to declared partials — never an
  uncaught failure. Budget constants are hardcoded with the spike cited; config
  exposure is deferred scope.
- Aggregation (phase 4) is a pure reduce: FR-21 finding merge, then a total
  deterministic sort — the only place cross-analyzer output meets, keeping
  byte-identity independent of phase-1 completion order.

## Consequences

- Determinism survives concurrency: unordered phase-1 completion is laundered
  through the phase-4 total sort; cold and warm (cache-hit) runs are
  byte-identical apart from the normalized `manifest.cache` counters.
- Epics 2/3 slot into pre-declared phases without runtime redesign; until then
  every manifest documents *why* those phases did not run.
- A dynamic scheduler's flexibility is traded away deliberately: the fixed shape
  is auditable and testable, and no current requirement needs runtime-derived
  ordering. Revisit only if a phase ever needs data from a later phase.
- Process-lifetime is per-run; cross-run reuse is the content-addressed cache
  (Story 1.7), not a daemon.
