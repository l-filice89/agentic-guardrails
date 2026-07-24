# Epic 1 Context: Zero-Cost Deterministic Review (M0 + M1)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer runs `guardrails init` then `guardrails review` on any scope (uncommitted, branch, PR, project) and gets trustworthy deterministic findings with provenance and per-axiom scores, persisted as artifacts — at exactly zero LLM cost, on Windows/macOS/Linux. This is deliberately the largest epic: foundation (M0) alone has no user value, so scaffold and first value ship together. It is fully standalone; dogfooding of the tool on its own repo begins here.

## Stories

- Story 1.1: Monorepo Scaffold with Guarded Boundaries
- Story 1.2: Canonical Contracts Package
- Story 1.3: TypeScript LanguageAdapter and Import Graph
- Story 1.4: Walking Skeleton — First End-to-End Review
- Story 1.5: SPIKE-3 — Import-Graph Cost at Scale (gate)
- Story 1.6: Config Plane
- Story 1.7: Pipeline Hardening and Deterministic Cache
- Story 1.8: `init` and the Structural Corpus Seed
- Story 1.9: Axiom #1 — Structural Analyzer (full rule set)
- Story 1.10: Axiom #3 — Cleanliness Analyzer (AST tier)
- Story 1.11: Axiom #4 — NFR Analyzer (structural tier)
- Story 1.12: Axiom #5 — Security Analyzer (regex/AST tier)
- Story 1.13: Axiom #6 — Conformance Analyzer (structural tier)
- Story 1.14: SPIKE-5 — Windows Git-Worktree Lifecycle (gate)
- Story 1.15: Review Scopes — Branch, PR, and Project
- Story 1.16: Scores, Trends, and Dispositions
- Story 1.17: SPIKE-4 — Noise Metric and Labeled Fixtures (gate)
- Story 1.18: Dogfood CI Workflow
- Story 1.19: SPIKE-1 — Structured-Output Prototype (M1 signal)

## Requirements & Constraints

- Deterministic phase runs axioms #1, #3 (AST tier), #4 (structural), #5 (regex/AST), #6 (structural) in parallel at zero LLM cost; deterministic-only is a first-class mode and the *only* mode in this epic.
- Every finding carries provenance (`ast | regex | llm`) and confidence; overlapping findings on the same file/axiom with >50% line overlap merge into one finding with a source array, strongest severity, both descriptions.
- Every run persists a review artifact to the scope-appropriate location and records per-axiom quality scores; trends are appended and deltas reported vs the previous comparable run (same scope type, same branch; fallback: nearest ancestor commit).
- Review scopes: uncommitted, branch, PR, full project. PR scope here means locally-fetchable git refs only (worktree-isolated; `gh` metadata when available, degrading gracefully) — GitHub API integration is Epic 5.
- Human finding dispositions are captured from this epic onward (artifact schema + CLI recording) so trust metrics never need backfilling; the interactive loop matures in Epic 5.
- Performance: deterministic pipeline <60s on a ~1,000-file repo (hard pass/fail via SPIKE-3); preflight adds ≤5s to review start; corpus operations must stay usable at 10,000+ files (cost scales with activity, not size).
- Reliability: per-axiom failure isolation (one axiom failing never kills a run); zero silent degradation — every run declares what ran, what didn't, why. Worktree isolation always cleans up and never corrupts the invoking tree.
- Privacy: local-first, zero egress by construction in this epic; no telemetry.
- Platform: Node.js LTS on Windows/macOS/Linux; Windows is first-class (SPIKE-5 validates worktree lifecycle there).
- Exit criteria: <60s pipeline (engineering); repo reviews 100% of its own PRs at zero LLM cost and ≥70% of error-severity findings dispositioned actionable across first 25 dogfooded runs (gate-tier, trailing — never blocks story completion).

## Technical Decisions

- **Toolchain:** hand-rolled pnpm-workspaces monorepo (no starter template); Node.js 24 LTS, pnpm 11.x (`workspace:*`), Zod 4.x, ts-morph 28.x, p-map 7.x, Commander, tsup, Vitest, Changesets; ESM-only. Build via `pnpm -r` topological + TS project references (no Turborepo).
- **Package boundaries (lint-enforced, one-way):** `contracts → core → {llm, cli} → {action, plugin}`; `core` carries zero LLM dependencies — a forbidden-import lint failure, not a convention.
- **Canonical `Finding` schema** defined once in `contracts`: `{ axiom, location, message, tier, source, confidence, severity: 'error'|'warning'|'info', findingId, exemplar?, degraded? }`. `findingId` = hash of `{axiom, ruleId, file, enclosing symbol/normalized context}` so dispositions survive line drift. Provenance mandatory at creation.
- **Partial-result contract** on all shared reads: `{ data, coverage|provenance, degraded[] }`; below-threshold consumers return `inconclusive`, never a false pass. Typed results across boundaries, `safeParse` at every boundary — never uncaught throws.
- **Pipeline:** static six-phase shape (0 preflight → 1 parallel deterministic → 2 SDD gate → 3 LLM enrichment → 4 aggregation → 5 composition) with dynamic per-phase membership; `p-map` bounded concurrency (bound set by SPIKE-3 measurements); no DAG library. Analyzers are pure `(change, context) → findings`, no LLM, no side effects.
- **Determinism:** findings sorted by `file → line → axiom`; no wall-clock/randomness in ordering; deterministic tier is byte-identical on same input, enforced by a CI parity test from M1.
- **Persistence:** runtime folder `_agentic-guardrails/` in the consuming repo — committed `config.yaml`, `conventions.yaml`, `corpus-map.yaml` (human-confirmed layer only), append-only `history/*.jsonl` (`merge=union` gitattribute), `manifests/` (pruned to newest 100); gitignored `.cache/`. Version decisions, not derivations. Atomic writes everywhere (temp → fsync → rename); read-repair discards torn trailing JSONL records. Review artifacts go under `reviews/<scope>/` (addendum layout adopted by default; confirm-or-veto at stories 1.4/1.15).
- **Scores/trends (OD-1):** trend records store raw per-axiom severity counts normalized by changed-KLOC plus stable `recordId` and `commitSha`; the score is a derived view via a versioned formula (v1: `100 − (10·errors + 3·warnings + 1·info)/changed-KLOC`, floored at 0) — never baked into records.
- **Dispositions (DR-1):** enum pinned in `contracts` at story 1.2 (candidate: `actionable | not-actionable | deferred`); recorded as append-only records in `history/dispositions.jsonl` keyed on `{run-id, findingId}`, written post-run, immune to pruning, independent of artifact disposition.
- **Config plane:** one YAML → Zod validation → generated JSON Schema (editor autocomplete) → `init` questionnaire, all sourced from `contracts`. Per-axiom enforcement `blocking | advisory | off`; #5 defaults to blocking. Deviations from defaults logged, never silent. No config reads outside the validated object.
- **Caching:** content-addressed deterministic cache (`.cache/graph`, `.cache/findings`) keyed on {change, context, ruleset version, engine version, tier-enablement} — distinct from Epic 3's LLM-tier cache.
- **Security:** analyzed code parsed as data, never executed (AST/static only); isolated git worktrees for all remote/PR review, never the live tree; git via a thin typed wrapper over system git; all paths via `node:path`.
- **Schema evolution:** Zod schemas semver-versioned; every persisted artifact carries `schemaVersion`; forward-migration ladder with golden round-trip fixtures.
- **ADR-001 envelope** (`<axiom>.in`/`.out` Zod envelope) is *defined* in this epic (contracts + SPIKE-1 throwaway prototype) but first *consumed* in Epic 2 — no production LLM transport here.
- **Process:** docs + ADR land in the same PR as significant decisions (`docs/adr/`); hybrid test layout (colocated `*.test.ts`, top-level `tests/` for integration/parity, `__fixtures__/` for golden fixtures); never unbounded `Promise.all`.

## Cross-Story Dependencies

- Hard internal gate order: 1.1 scaffold → 1.4 walking skeleton (one axiom end-to-end; blocks all analyzer scale-out) → scale-out.
- Spikes gate what follows: 1.5 (SPIKE-3) sets the `p-map` bound consumed by 1.7 and decides ts-morph vs hybrid before analyzer scale-out; 1.14 (SPIKE-5) gates 1.15's worktree-isolated scopes; 1.17 (SPIKE-4) defines the noise metric consuming 1.16's dispositions.
- 1.2 contracts is upstream of everything emitting findings; 1.3's import graph feeds 1.8's structural seed and 1.9's structural rules; 1.4 precedes 1.8 (creates minimal folder on demand; full bootstrap is 1.8).
- `init` (1.8) must not attempt convention mining — mining strategies are Epic 4; it ships an empty-but-valid Ledger.
- Forward hooks: ADR-001 envelope and SPIKE-1 (1.19) are the gate Epic 2's interactive transport builds on; streaming output is deferred post-v1 (CLI summary + persisted artifact are the only output channels).
