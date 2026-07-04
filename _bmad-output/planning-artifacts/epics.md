---
stepsCompleted: [1, 2, 3, 4]
status: 'complete'
completedAt: '2026-07-03'
inputDocuments:
  - '_bmad-output/planning-artifacts/prds/prd-agentic-guardrails-2026-06-10/prd.md'
  - '_bmad-output/planning-artifacts/prds/prd-agentic-guardrails-2026-06-10/addendum.md'
  - '_bmad-output/planning-artifacts/architecture.md'
---

# agentic-guardrails - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for agentic-guardrails, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

**Story ordering constraint (user-confirmed, hard rule):** epics and stories are numbered strictly by dependency — no story may depend on a story or epic that comes after it. Where an epic needs machinery first named elsewhere, the dependency must point backward (see Epic 2's transport note).

**Exit-criteria semantics:** each epic's exit criteria come in two tiers — **engineering-complete** (all stories done and verified; closable at sprint level) and **gate-validated** (the PRD milestone gate: dogfooding/beta evidence that accrues over calendar time, sometimes via external parties). An epic is *closed* when engineering-complete; its gate is tracked as a trailing validation milestone and must pass before the next milestone's claims are asserted. Gate criteria never block story completion — they block *claims*.

## Requirements Inventory

### Functional Requirements

**A. Knowledge substrate (pillar)**

- FR-1: The system builds and maintains a Corpus Map: an inventory of the codebase's entities (pages, components, hooks, services) with location, purpose, zone role, dependency fan-in, and links to the conventions each entity exemplifies. The Map is derived from the code and regenerable.
- FR-2: The system maintains a Conventions Ledger: curated convention entries, each with a detection method, prevalence evidence, intent evidence, lifecycle status, and a flag governing precedence over universal cleanliness rules. Ledger entries are human-owned and never silently regenerated.
- FR-3: An `init` command bootstraps the artifact folder and seeds Map + Ledger using a configurable build strategy (`eager | lazy | hot-seed`); the default (`hot-seed`) mines the highest-churn zones first so large brownfield repos get day-one value at bounded cost.
- FR-4: A Convention Miner proposes candidate conventions from Map evidence, scoring each on prevalence and intent; proposals enter the Ledger as `proposed` and only human confirmation promotes them to `confirmed`.
- FR-5: Convention curation happens through a batched digest on the user's schedule — unconfirmed conventions never appear as review findings or per-review noise.
- FR-6: Convention trust is asymmetric: humans grant enforcement (confirm); the system automatically revokes it as evidence erodes (`waning`, superseded), keeping migrations visible and dead patterns un-enforced.
- FR-7: Map and Ledger carry a freshness watermark; the system detects staleness before every review, prompts in interactive mode (configurable in CI), and enforces a hard staleness ceiling beyond which refresh is forced.
- FR-8: Ledger entries can link to an evidence trail of human-authored sources (ADRs, human PR comments, elicitation answers); bot/agent-generated content is excluded as evidence.

**B. Spec & AC runtime (pillar)**

- FR-9: The system validates a Specification & Design Document into a ValidatedSDD — a schema-checked artifact whose acceptance criteria are quantitative and machine-comparable.
- FR-10: A standalone pre-implementation spec gate runs before any code is written, catching spec defects at the cost of minutes instead of a rework cycle.
- FR-11: An AC elicitation coach guides the author from a missing or qualitative spec to a ValidatedSDD through dialogue (interactive mode only), including a zero-document path that builds the spec from scratch.
- FR-12: Axiom #2 verification binds each acceptance criterion to code symbols, audits the implementation's logic against the ACs, and audits whether tests actually cover the stated requirements.
- FR-13: When no usable SDD exists, Axiom #2 degrades gracefully through declared tiers; every run reports which tier it ran at — no silent skips, ever.

**C. Longitudinal quality memory (pillar)**

- FR-14: Every review records per-axiom quality scores in the review artifact.
- FR-15: The system trends scores across runs and reports the delta alongside current findings.
- FR-16: The system produces longitudinal reports correlating quality movements over time (e.g., "DRY violations up 40% over three sprints while SDD coverage dropped").
- FR-17: A ledger-health view surfaces semantic staleness in human terms ("3 conventions waning, incidence −40%"), not just commit counts.

**D. Six-axiom review pipeline**

- FR-18: A deterministic phase runs axioms #1 (structural), #3 (cleanliness, AST tier), #4 (NFR, structural tier), #5 (security, regex/AST tier), and #6 (conformance, structural tier) in parallel at zero LLM cost.
- FR-19: An LLM enrichment phase deepens #2, #3, #5, and #6 with contextual reasoning; LLM agents run independently and in parallel, and the LLM is never the sole line of defense — every detectable concern has at least one deterministic signal.
- FR-20: Every finding carries provenance (`ast | regex | llm`) and a confidence indicator.
- FR-21: Overlapping deterministic and LLM findings are deduplicated into a single finding preserving both descriptions and the strongest severity.
- FR-22: Conformance findings cite a living exemplar from the team's own codebase (e.g., `corpus://AccountPreferencesPage`) — mentorship, not scolding.
- FR-23: Each run composes a review artifact persisted to the scope-appropriate location in the artifact folder.
- FR-24: The pipeline is assembled dynamically per scope, mode, available artifacts, and configuration, with per-axiom failure isolation — one axiom failing never takes down the run.
- FR-25: Review scopes: uncommitted changes, branch diff, pull request, and full project; remote branches and PRs are reviewed in isolation without disturbing the working tree, with the user choosing the artifact's disposition afterward.

**E. Surfaces & modes**

- FR-26: An interactive mode (Claude Code plugin) with the full coaching loops — SDD elicitation, AC remediation, curation digest, staleness prompts.
- FR-27: A headless CI mode (GitHub Action) running the same pipeline with no interactive pauses; anything that would pause resolves by configured policy and is reported as a gap.
- FR-28: A command surface: `/review-local`, `/review-branch [branch?]`, `/review-pr [pr?]`, `/review-project`, `/axiom <N> [--scope]`.
- FR-29: CI publishes per-axiom status checks (blocking axioms = required checks; advisory = informational) and maintains a single structured PR comment that replaces its predecessor rather than accumulating.
- FR-30: A quality dashboard view per axiom: violations, severity breakdown, trend delta, link to the full artifact.

**F. Configuration & cost control**

- FR-31: A single YAML configuration, schema-validated, git-tracked, with editor autocomplete support; every deviation from defaults is explicit and logged, never silently applied.
- FR-32: Per-axiom enforcement levels (`blocking | advisory | off`) with numeric thresholds and regression tolerance; security (#5) defaults to `blocking`.
- FR-33: Per-agent controls in CI: enable/disable, model tier, trigger events.
- FR-34: A first-class deterministic-only mode: zero LLM calls, zero API cost, genuine standalone value.
- FR-35: Input-hash caching: LLM agents skip work when inputs haven't changed.
- FR-36: Provider-agnostic LLM layer: bring your own model, switch providers without touching agent behavior, local models via Ollama.

**G. Write-time enforcement**

- FR-37: The v1 plugin ships a write-time standards skill that injects engineering standards into the agent's authoring context, scoped precisely to code-writing tasks (description precision is a security boundary).
- FR-38: The v1 skill meaningfully improves on the legacy version along one axis: its rule set is aligned with the six axioms' vocabulary, so write-time guidance and review findings speak the same language. The skill remains a broad, project-generic standards baseline — deliberately not derived from any one repo's artifacts.
- FR-39: *(Post-v1, named for direction — not in v1 scope)* Confirmed Ledger conventions augment the write-time skill as a repo-specific layer on top of the generic baseline.

### NonFunctional Requirements

**Performance**

- NFR-1: The deterministic pipeline completes in under 60 seconds on a ~1,000-file TypeScript repo.
- NFR-2: A full review including LLM enrichment on a typical PR-sized diff targets under 5 minutes, with 10 minutes as the hard ceiling. Feasibility of the 5-minute target is validated during dogfooding; the ceiling is non-negotiable.
- NFR-3: Staleness detection and pre-flight checks add negligible overhead (seconds) to review start.

**Cost**

- NFR-4: Deterministic-only mode costs exactly zero in LLM/API spend — at any repo size.
- NFR-5: LLM spend is predictable and user-governed: per-agent toggles, model-tier selection, input-hash caching; a re-run on unchanged inputs approaches zero marginal cost. The report surfaces what a run actually cost.
- NFR-6: Corpus/Ledger build cost scales with activity, not repo size (hot-seed strategy).

**Reliability**

- NFR-7: Per-axiom failure isolation: one axiom failing never takes down the run; the report states what ran, what didn't, and why.
- NFR-8: Zero silent degradation: every run declares its degradation tier and any skipped agents. Reported absence is a feature; silent absence is a defect.
- NFR-9: External review isolation always cleans up (worktrees removed even on failure) and never corrupts the invoking working tree.

**Privacy & data posture**

- NFR-10: Local-first: no code, artifacts, or telemetry leave the machine unless the user explicitly configures an external LLM provider; Ollama keeps even LLM reasoning local.
- NFR-11: No telemetry in v1 — not even opt-in usage analytics.

**Compatibility & scale**

- NFR-12: Runs on Node.js LTS across macOS, Linux, and Windows; CI mode runs on standard GitHub-hosted runners with no extra infrastructure.
- NFR-13: v1 explicitly targets large brownfield repos; corpus operations remain usable on repos of 10,000+ files (init/mining cost scales with activity and selected zones, not raw size); review scopes are diff-based so day-to-day review cost is independent of repo size.

### Additional Requirements

**From Architecture — foundation & scaffold (impacts Epic 1 Story 1)**

- No off-the-shelf starter template: hand-rolled minimal pnpm-workspaces monorepo. The first implementation story is the repo scaffold — pnpm-workspaces + `contracts`/`core` package boundary + forbidden-import lint + CI skeleton (concrete output of ADR-002/ADR-005).
- Verified toolchain baseline: Node.js 24 Active LTS, pnpm 11.x (`workspace:*` strict isolation), Zod 4.x, ts-morph 28.x, p-map 7.x, Commander, tsup, Vitest, Changesets; ESM-only (`"type": "module"`).
- Package layout & one-way dependency direction (lint-enforced): `contracts → core → {llm, cli} → {action, plugin}`; `core/` carries zero LLM dependencies — enforced by forbidden-import lint + dependency check in CI from M1.
- Build orchestration: `pnpm -r` topological + TS project references; Turborepo deferred (Rule of Three).

**From Architecture — contracts & data shapes (M0/M1 foundational)**

- One canonical `Finding` Zod schema defined once in `contracts`: `{ axiom, location, message, tier: 'deterministic'|'inferred', source: 'ast'|'regex'|'llm', confidence, exemplar?, degraded? }`. Provenance is mandatory at creation, never inferred late.
- **Schema gap inherited from the architecture, flagged for the contracts story (OD-6):** the canonical `Finding` shape above omits **`severity`** — yet FR-21 merges on "strongest severity," FR-30 promises a severity breakdown, the CI gating model needs blocking-vs-advisory findings, and the M1 gate counts error-severity findings. It also omits a **stable finding identity**, which DR-1 dispositions and dedup both require. **Resolved (OD-6, 2026-07-03):** add `severity: 'error' | 'warning' | 'info'` and a symbol-anchored `findingId` (hash of `{axiom, ruleId, file, enclosing symbol / normalized context}`) to the schema at the contracts story; backport to the architecture document. OD-1's severity weights (10/3/1) consume this enum.
- Partial-result contract on all shared upstream reads (import graph, ledger, corpus, history): `{ data, coverage|provenance, degraded[] }`; a consumer below threshold returns `inconclusive`, never a false `pass`.
- ADR-001 LLM envelope (`<axiom>.in` / `<axiom>.out`, one Zod envelope, two transports) is defined in M1; first consumed by Epic 2's interactive transport, generalized to two transports in Epic 3 (the architecture's "M3" refers to the full LLM tier).
- Run manifest (ledger hash, corpus hash, ruleset version, tier-enablement, engine version, LLM model identity) emitted by both runtimes; cross-runtime parity test fixture as an acceptance gate (deterministic tier: byte-identical; LLM tier: verdict-class equivalence via recorded golden envelopes; live LLM comparison advisory only).
- Zod schemas are semver-versioned; every persisted artifact carries `schemaVersion`; forward migration ladder (`v_n → v_n+1` pure functions) with golden round-trip fixtures; cold-start is last resort.

**From Architecture — orchestration & runtime behavior**

- Static six-phase pipeline (Phase 0 pre-flight → 1 parallel deterministic → 2 SDD resolution gate → 3 parallel LLM enrichment → 4 aggregation → 5 composition) with dynamic per-phase node membership; `p-map` bounded concurrency (bound set from SPIKE-3 measured ts-morph memory numbers); no DAG library.
- Analyzer vs agent boundary: `analyzer` = pure `(change, context) → findings`, no LLM, no side effects; `agent` = a unit that invokes an LLM; promotion to independently-orchestrated unit requires explicit justification.
- IDE transport = file-handshake with two-invocation lifecycle (dispatch → collect): run-scoped `.cache/handshake/<run-id>/` dirs, atomic-rename completion signal, deadline checked at collect, orphaned-dir GC. CI transport = direct API/Ollama adapter validated against the same envelope.
- Mode-aware retry: interactive = 1 correction retry + 1 repair; CI = fail-fast; hard cap 2 retries + 1 repair in any mode; all paths terminate in a typed `degraded` result.
- Typed results across boundaries, not thrown exceptions; `safeParse` everywhere data crosses a boundary; a phase failure degrades to partials, never an uncaught throw.
- Deterministic output (tier-scoped): findings sorted by stable key (`file → line → axiom`); no wall-clock/randomness in finding ordering; deterministic tier guarantees byte-identical output on same input.
- Knowledge maintenance (Cartographer, Convention Miner, warm refresh) is out-of-band — never on the deterministic critical path; runs use last-known-good and report Map version/age used. Beyond the staleness ceiling, corpus-dependent axioms degrade to `inconclusive` (`reason: stale_corpus`); corpus-independent axioms run normally. Hard staleness ceiling default: **~14 days, config-overridable** (addendum); CI staleness policy `defer | update | update_after:X`.
- IDE handshake skills embed the expected JSON Schema **inline in the skill prompt** for LLM self-validation before writing `<axiom>.out.json` (addendum) — an Epic 2 story detail for the handshake skills.
- Cartographer split pattern: deterministic half in `core/knowledge` derives the structural map; LLM inference half in `llm/agents` enriches via the envelope, one-way only.
- Dedup rule (FR-21 mechanics): same file + line range + axiom, >50% overlap → merge with `source: [ast, llm]`, strongest severity, both descriptions preserved; dedup lives in the pipeline reduce step.

**From Architecture — persistence & artifact folder**

- Runtime artifact folder `_agentic-guardrails/` in the consuming repo: committed `config.yaml`, `conventions.yaml`, `corpus-map.yaml` (human-confirmed layer only), `history/trends.jsonl` and `history/dispositions.jsonl` (append-only, `.gitattributes merge=union` covering `history/*.jsonl`), `manifests/`; gitignored `.cache/` (graph, findings, proposed lane, handshake, trends.html).
- Committed vs gitignored split: version decisions, not derivations. Corpus Map splits along that line — regenerable structural inventory in cache; committed file holds only human-confirmed layer.
- Rejected conventions are written to the committed ledger as `status: rejected` (with damping metadata) — mining never re-proposes them; only undecided proposals are cache-local.
- Atomic, validated, provenance-stamped writes everywhere (temp → fsync → atomic rename); append-only JSONL; read-repair discards torn trailing records; Trend Aggregator validates-before-trust and cold-starts on invalid history.
- Trend records carry stable `recordId` (content hash of `{run-id, axiom, scoreKind}`) and `commitSha`; aggregator dedupes on `recordId` and orders by git commit ancestry.
- Write-back discipline: self-exclusion (`_agentic-guardrails/` always excluded from the diff under review); disposition, not side effect (interactive run ends by asking commit `[skip ci]` or drop; CI follows configured policy); manifests pruned to newest 100 runs (config-overridable).
- `init` writes the `merge=union` gitattribute (covering `history/*.jsonl` — trend *and* disposition records) and the `.cache/` ignore entry; Phase-0 preflight verifies both on every run with loud warnings naming consequences.
- Trend visualizer: `guardrails trends [--open]` renders committed `trends.jsonl` to a self-contained static HTML file (vanilla JS + inline CSS, no CDN, no network) at `.cache/trends.html`.
- **Inconsistency inherited from inputs, flagged for the FR-23 story:** the addendum's artifact layout includes `reviews/branch-{name}/`, `reviews/pr-{id}/`, `reviews/project/`, `reviews/uncommitted/`; the architecture's final Runtime Artifact Layout omits `reviews/` entirely. **Default resolution (confirm at story time):** adopt the addendum's `reviews/<scope>/` structure under `_agentic-guardrails/`, with committed-status governed by the disposition prompt (commit `[skip ci]` or drop) — metric-bearing disposition records survive independently in committed history per DR-1.

**From Architecture — config, caching & CI gating**

- Config plane: YAML → Zod runtime validation → generated JSON Schema (editor autocomplete) → `init` questionnaire, all sourced from `contracts`. Config only through the validated config object; the one exception is the LLM API key from env (never persisted/logged, redacted in manifests).
- Content-addressed cache keyed by composite hash of {change, context, ruleset version, engine version, tier-enablement}; LLM-tier key additionally includes model identity (provider · model-id · model-version) + prompt/template version; IDE transport self-reports model identity as a required envelope field (`modelIdentity.source: api-verified | self-reported`).
- CI gating model: deterministic tier gates (nonzero exit); inferred tier advises (annotations, non-blocking by default); configurable promotion of inferred findings to gating.

**From Architecture — security & trust boundaries**

- Analyzed code is parsed as data, never executed — AST/static analysis only.
- Isolated git worktree for all remote/PR review operations — never the user's live working tree; lifecycle validated on Windows; push failure degrades to temp-dir save.
- Secrets: LLM API keys from environment only.
- Three-tier egress posture, documented honestly: (a) deterministic-only = zero egress; (b) Ollama = zero external egress; (c) cloud LLM = opt-in egress of the analyzed diff to the one configured endpoint, nothing else, no telemetry.
- Human-confirm invariant: enforcement is human-granted, machine-revoked; agents never self-confirm.
- Git access: shell out to system git via a thin typed wrapper.

**From Architecture — enabler stories (spikes & walking skeleton; must appear in the backlog as gate stories)**

- Walking Skeleton (M1, blocks scaling the analyzer taxonomy): one deterministic axiom over a real branch diff emitting a Zod-valid `Finding`, persisted to `_agentic-guardrails/`, via the actual pipeline. Depends on the repo scaffold story.
- SPIKE-1 — Structured-output reliability (M1 prototype signal + M3-entry confirmation gate): throwaway handshake harness, ~50 invocations, post-repair envelope-valid rate ≥98% or the envelope is simplified before the LLM tier scales. Blocks ADR-001 finalization, FR-19, M3 scaling.
- SPIKE-2 — Cost & latency per phase (dogfooding): wall-clock + token spend per phase on a worst-case PR diff; pass/fail against NFR-2. Blocks the 5-min claim; depends on walking skeleton + LLM tier.
- SPIKE-3 — Import-graph build cost at scale (M1): cold vs warm rebuild time + peak memory on a 10,000-file repo; golden fixtures for path aliases/barrels/re-exports/dynamic imports; deterministic pipeline <60s on ~1,000 files (NFR-1 hard pass/fail). Named fallback: hybrid Tree-sitter + targeted ts-morph. Blocks NFR-1/6/13 claims and Phase-0 readiness.
- SPIKE-4 — Noise metric + labeled fixtures (foundational): defined noise denominator + labeling method + labeled fixture corpus, wired as a CI counter-metric carrying the <30% bar. Until the metric exists, no noise claim can be made.
- SPIKE-5 — Windows git-worktree isolation lifecycle (M1): 100 consecutive create→run→cleanup cycles with zero residue and byte-identical invoking tree; injected-failure suite (process kill, held handles, >260-char paths, case collisions, push-failure degrade). Blocks FR-25 and NFR-9/12 claims.
- Import-graph golden-fixture tests are an M1 deliverable (highest-correctness-risk shared component).
- Tracked risk (not a spike): solo-dev dogfooding blind spot — merge conflicts, confirmation friction, cross-runtime divergence surface only at M4.

**From Architecture / project-context — process constraints**

- Milestone sequencing M0–M5 is a design constraint: each milestone self-standing and dogfooded; M1 (deterministic-only) must ship valuable with no LLM/knowledge layer present.
- Documentation & ADRs are part of the Definition of Done: docs + ADR for significant decisions land in the same PR (ADR-001..005 under `docs/adr/`).
- Distribution: npm packages (`@agentic-guardrails/{contracts,core,llm,cli}`) + Claude Code plugin + GitHub Action; SemVer via Changesets; the project dogfoods itself in its own GitHub Actions CI.
- Hybrid test layout: colocated `*.test.ts` unit tests; top-level `tests/` for integration/e2e/parity; package-local `__fixtures__/` for small golden fixtures; `tests/fixtures/` for large shared fixtures.
- All paths via `node:path`; Windows is a first-class target; bounded concurrency via `p-map`, never unbounded `Promise.all`.

**Derived requirements (gaps surfaced during epic breakdown, 2026-07-03 — backported to the PRD as FR-40 on 2026-07-03)**

- DR-1 *(= PRD FR-40)*: Review artifacts support **human finding dispositions**, persisted in the review artifact. The disposition enum is **pinned in the `contracts` schema at the Epic 1 contracts story** (candidate set: `actionable | not-actionable | deferred`; final set is a story-level decision, then frozen). Dispositions are the data source for the PRD's trust/success metrics (UJ-2 step 5, M1 gate "≥70% dispositioned actionable") and SPIKE-4's noise counter-metric (<30% dispositioned not-actionable) — without them those metrics are unmeasurable. The artifact schema carries dispositions from Epic 1 so history never needs backfilling; the interactive capture loop matures with the surfaces in Epic 5. **Survival rule:** dispositions are *decisions*, so per the "version decisions, not derivations" rule they are recorded as **append-only disposition records in committed history — default home `history/dispositions.jsonl`** (same JSONL discipline as trend records: stable `recordId` keyed on `{run-id, findingId}` (needs OD-6's `findingId`), `commitSha`, idempotent under `merge=union`) — written post-run when the human dispositions, independent of whether the review artifact itself is committed or dropped, and immune to manifest pruning. The review artifact carries them redundantly for human reading. **Disposition scope** — whether a disposition on a `findingId` carries across its reappearances in later runs or is per-run — is defined together with SPIKE-4's noise metric, whose denominator depends on the answer.

**Open decisions — RESOLVED with the owner (Luca) on 2026-07-03, except OD-5 (deferred)**

- OD-1 ✅ *(was blocking Epic 1 score/trend stories)*: **Raw counts + derived score.** Trend records store per-axiom finding counts by severity, normalized by changed-KLOC; the score is a *derived view* computed by a **versioned formula** (v1: `100 − (10·errors + 3·warnings + 1·info) per changed-KLOC`, floored at 0). A formula change recomputes all history — scores are never baked into committed records ("version decisions, not derivations"). **Comparability rule (FR-15):** the delta is computed vs the previous run of the same scope type on the same branch; fallback: same scope type at the nearest ancestor commit.
- OD-2 ✅ *(was blocking Epic 4 mining stories)*: **Threshold doubling.** Each prior rejection in a pattern family doubles the prevalence-evidence threshold a *similar* candidate must clear (`threshold × 2^rejections`, capped); identical rejected conventions remain never-re-proposed. Damping metadata on the rejected ledger entry = `rejectionCount` + timestamps.
- OD-3 ✅ *(was blocking Epic 4 curation stories)*: **Human resolves, recorded.** No automatic precedence between contradictory human evidence; the digest presents both sources side by side, the human's resolution is written to the ledger entry with a rationale field, and that recorded decision wins thereafter — an ordinary reviewable ledger edit.
- OD-4 ✅ *(was blocking Epic 4 digest stories)*: **Manual + quiet threshold nudge.** `guardrails curate` is the only entry point; when the proposed queue crosses a threshold (≥10 proposals or ≥30 days since last curation, config-overridable) the end of a review summary carries one quiet line noting it — never findings-level noise.
- OD-5 ⏸ *(deferred, likely post-v1)*: zone-adjacency lazy-refinement materialization and query complexity. Owner: Luca.
- OD-6 ✅ *(was blocking the Epic 1 contracts story)*: **Severity enum `error | warning | info`; symbol-anchored `findingId`** = hash of `{axiom, ruleId, file, enclosing symbol / normalized context}`, so dispositions survive line drift. Backport the schema addition to the architecture document.
- OD-7 ✅ *(was blocking the Epic 1 pipeline-composition story)*: **Streaming deferred.** CLI summary + persisted artifact are v1's two output channels; real-time IDE streaming is post-v1 (Rule of Three).

**Backport tasks — ✅ COMPLETED 2026-07-03:** DR-1 → PRD as **FR-40** (group C) and the OD-1 score definition folded into PRD FR-14/15; the OD-6 `Finding` schema additions (`severity`, symbol-anchored `findingId`) → architecture document (all four schema-stating sites updated and verified by search, plus the FR count, `trends.ts` mapping, and coverage table).

### UX Design Requirements

N/A — no UX Design document exists for this project. The only surfaces are the CLI, the Claude Code plugin, and the GitHub Action (per Architecture: "Frontend architecture: N/A").

### FR Coverage Map

- FR-1: Epic 4 — Corpus Map (Cartographer full lifecycle; structural seed delivered in Epic 1 via `init`)
- FR-2: Epic 4 — Conventions Ledger (human-owned entries, lifecycle status)
- FR-3: **Split.** Epic 1 — `init` bootstraps the artifact folder, git wiring (`merge=union` attribute, `.cache/` ignore), config questionnaire, and the **structural** corpus seed (no mining; ships an empty-but-valid Ledger). Epic 4 — the `eager | lazy | hot-seed` *mining* strategies (they require the Convention Miner). Epic 1 stories must not attempt mining.
- FR-4: Epic 4 — Convention Miner (proposed → confirmed lifecycle)
- FR-5: Epic 4 — Batched curation digest
- FR-6: Epic 4 — Asymmetric trust (human-granted, machine-revoked)
- FR-7: Epic 4 — Freshness watermark + staleness ceiling
- FR-8: Epic 4 — Evidence trail (human-authored sources only)
- FR-9: Epic 2 — ValidatedSDD schema-checked artifact
- FR-10: Epic 2 — Standalone pre-implementation spec gate
- FR-11: Epic 2 — AC elicitation coach (interactive)
- FR-12: Epic 2 — Axiom #2 verification (AC-to-symbol binding, logic + test coverage audit)
- FR-13: Epic 2 — Declared degradation tiers for Axiom #2
- FR-14: Epic 1 — Per-axiom quality scores recorded in review artifact *(OD-1 resolved: raw severity counts stored; score is a derived, versioned-formula view)*
- FR-15: Epic 1 — Trend store + aggregator + delta vs the previous comparable run, reported in the review artifact; raw per-axiom score series rendered by `guardrails trends`
- FR-16: Epic 4 — Longitudinal correlation reports
- FR-17: Epic 4 — Ledger-health view (semantic staleness)
- FR-18: Epic 1 — Deterministic phase (#1, #3, #4, #5, #6 structural) in parallel, zero LLM cost
- FR-19: **Split, forward-only.** Epic 2 — Axiom #2's LLM reasoning over the minimal IDE file-handshake transport (envelope from Epic 1, de-risked by SPIKE-1's M1 prototype). Epic 3 (primary) — the generalized enrichment phase: direct-API/Ollama transports, provider-agnostic layer, #3/#5 agents, cross-tier dedup. Epic 4 — #6's corpus-dependent activation and exemplar-grounded enrichment.
- FR-20: Epic 1 — Finding provenance + confidence (extended with `llm` source in Epic 3)
- FR-21: Epic 1 — Dedup reduce step (deterministic-tier mechanics; cross-tier dedup exercised in Epic 3)
- FR-22: Epic 4 — Conformance findings cite living exemplars (`corpus://…`)
- FR-23: Epic 1 — Review artifact persisted per scope *(layout conflict between addendum and architecture flagged in Additional Requirements; the default — addendum's `reviews/<scope>/` — is adopted by stories 1.4/1.15, subject to confirm-or-veto at story time)*
- FR-24: Epic 1 — Dynamic per-phase pipeline assembly + per-axiom failure isolation
- FR-25: Epic 1 — Review scopes (uncommitted, branch, PR, project) with worktree isolation. **PR scope in Epic 1 = locally-fetchable git refs** (worktree-isolated; `gh`-sourced metadata used when available, degrading gracefully); GitHub API integration (status checks, PR comment) is Epic 5.
- FR-26: **Split, forward-only.** Epic 2 — SDD-elicitation and AC-remediation coaching loops (as undistributed dogfooding skills). Epic 4 — curation digest and staleness prompts. Epic 5 (primary) — the packaged, distributed Claude Code plugin integrating all loops.
- FR-27: Epic 5 — Headless CI mode (GitHub Action)
- FR-28: Epic 5 — Command surface (`/review-local`, `/review-branch`, `/review-pr`, `/review-project`, `/axiom`)
- FR-29: Epic 5 — Per-axiom status checks + single replacing PR comment
- FR-30: Epic 5 — Per-axiom quality dashboard rendered in the review surfaces (CLI summary block + CI PR comment). **Distinct from Epic 1's `trends.html`**, which is the longitudinal score-series view; FR-30 is the per-run, per-axiom summary.
- FR-31: Epic 1 — Schema-validated YAML config, explicit deviations
- FR-32: Epic 1 — Per-axiom enforcement levels (`blocking | advisory | off`)
- FR-33: Epic 3 — Per-agent controls (enable/disable, model tier) in the config plane, honored by any direct-API invocation; the CI trigger-event dimension is wired when CI mode exists (Epic 5)
- FR-34: Epic 1 — First-class deterministic-only mode
- FR-35: Epic 3 — Input-hash caching for LLM agents
- FR-36: Epic 3 — Provider-agnostic LLM layer (Anthropic API, Ollama)
- FR-37: Epic 5 — Write-time standards skill (precisely scoped)
- FR-38: Epic 5 — Axiom-aligned rule set (generic baseline)
- FR-39: **Out of v1 scope** (post-v1, named for direction) — consciously excluded from all epics
- DR-1 (= PRD FR-40): Epic 1 — Disposition capture: artifact schema + CLI disposition recording (feeds SPIKE-4 and the M1 gate); interactive capture loop matures in Epic 5

### NFR Coverage Map

- NFR-1: Epic 1 — SPIKE-3 carries the hard pass/fail (<60s deterministic pipeline on ~1k files)
- NFR-2: Epic 3 — SPIKE-2 validates the 5-min target; the 10-min ceiling is enforced via the per-phase budgets built in Epic 1's pipeline
- NFR-3: Epic 1 (Phase-0 preflight overhead) + Epic 4 (staleness-check overhead)
- NFR-4: Epic 1 — deterministic-only is the *only* mode until Epic 3; preserved as a first-class mode thereafter (FR-34)
- NFR-5: Epic 3 — cost surfacing, per-agent toggles, input-hash caching
- NFR-6: Epic 1 (structural seed cost) + Epic 4 (mining scales with activity); SPIKE-3 supplies the evidence
- NFR-7: Epic 1 — per-axiom failure isolation in the pipeline; inherited by every later axiom/agent
- NFR-8: Epic 1 — run manifest + degradation reporting; extended per tier in Epics 2–4
- NFR-9: Epic 1 — SPIKE-5 quantified exit criteria (100 clean cycles + injected-failure suite)
- NFR-10 / NFR-11: Epic 1 — zero-egress by construction. The three-tier egress posture is documented at **Epic 2**, where egress first exists (the IDE file-handshake routes the diff through Claude Code — cloud egress by user opt-in); the Ollama zero-egress LLM tier arrives in Epic 3
- NFR-12: Epic 1 — Windows-first validation (SPIKE-5, `node:path` discipline); GitHub-hosted-runner claim completed by Epic 5
- NFR-13: Epic 1 (10k-file import-graph spike) + Epic 4 (activity-scaled mining)

## Epic List

### Epic 1: Zero-Cost Deterministic Review (M0 + M1)

A developer runs `guardrails init` then `guardrails review` on any scope (uncommitted, branch, PR, project) and gets trustworthy deterministic findings with provenance and per-axiom scores, persisted as artifacts — at exactly zero LLM cost, on Windows/macOS/Linux. Fully standalone; dogfooding begins here.

- **Size, acknowledged:** deliberately the largest epic — M0 alone has no user value, so foundation and first value ship together. Internal gate order is fixed: repo scaffold → walking skeleton (one axiom end-to-end; blocks all scale-out) → analyzer scale-out, scopes, persistence. SPIKE-3/4/5 sequence as gates before the stories that depend on them.
- **Dogfooding path:** the CLI exits nonzero on blocking findings, so this repo runs `guardrails review` directly in its own GitHub Actions workflow from M1 — no packaged Action required (that is Epic 5).
- **Boundaries:** PR scope = locally-fetchable git refs (see FR-25 map entry). Pillar C boundary: this epic records scores (per OD-1), appends trend records, reports deltas vs the previous comparable run, and renders the raw score series; correlation reports (FR-16) and ledger health (FR-17) are Epic 4.
- **Exit criteria (M1 gate):** deterministic pipeline <60s on ~1k files (SPIKE-3) *(engineering-tier)*; reviews 100% of this repo's PRs at zero LLM cost *(gate-tier)*; ≥70% of error-severity findings dispositioned actionable across the first 25 dogfooded runs (requires DR-1) *(gate-tier)*.

**FRs covered:** FR-3 (bootstrap + structural seed), FR-14, FR-15, FR-18, FR-20, FR-21, FR-23, FR-24, FR-25, FR-31, FR-32, FR-34, DR-1
**Enablers carried:** repo scaffold (architecture's named first story), walking skeleton, **SPIKE-1 (M1 prototype signal: throwaway handshake harness + envelope shaping — the gate Epic 2 builds on)**, SPIKE-3, SPIKE-4, SPIKE-5, ADR-001 envelope schema definition (defined here, first consumed by Epic 2's transport), deterministic-tier determinism/parity tests (byte-identical output on same input, in CI from M1 per the architecture's Enforcement section — the two-transport replay half arrives in Epic 3), schema-migration ladder + golden round-trip fixtures (contracts), deterministic content-addressed cache (`.cache/graph`, `.cache/findings` — distinct from FR-35's LLM-tier cache), non-interactive/CI flag for the dogfood workflow (policy-driven disposition handling, so the Actions run never waits on a prompt — FR-27's full policy machinery remains Epic 5), trend store + `guardrails trends` visualizer *(renders the OD-1 count series + derived scores)*.

### Epic 2: The Spec Gate — AC Validation & Verification (M2)

An author validates a story's acceptance criteria before implementation (standalone spec gate, coaching to machine-comparable ACs), and after implementation Axiom #2 verifies the code and tests against those ACs — with declared degradation tiers when no spec exists (UJ-1 end-to-end). Uses Epic 1's pipeline.

- **LLM transport (dependency made explicit, forward-only):** Axiom #2's judgment work and the coaching dialogue require LLM reasoning. This epic therefore includes the **minimal interactive file-handshake transport** — productionizing the ADR-001 envelope defined in Epic 1, de-risked by SPIKE-1's M1 prototype harness (an Epic 1 enabler). Until Epic 3, Axiom #2 in any headless context reports its degradation tier (FR-13) — never a silent skip. *Upstream tension, resolved deliberately:* the architecture labels ADR-001 "M1-defined, M3-used," while the PRD's M2 milestone includes Axiom #2, which needs the transport — **the PRD governs**; record the timing deviation in ADR-001 at story time.
- **`llm` package ownership split (prevents double-booking with Epic 3):** Epic 2 builds `llm/envelope-client` (safeParse + the *interactive* retry path: 1 correction + 1 repair) and `llm/file-handshake` (run-scoped dirs, atomic-rename completion, dispatch→collect, orphan GC). Epic 3 builds `llm/direct-api`, `llm/ollama`, the provider-agnostic abstraction, the CI fail-fast retry path, per-agent cost controls, and the LLM-tier cache.
- **De-facto plugin surface, declared:** the file-handshake only works if Claude Code skills exist to read `.in.json` and write `.out.json` — so this epic ships the minimal `plugin/skills/` files it needs (axiom-2 handshake skill + coaching skill) as **undistributed dogfooding surfaces**, loaded via local plugin install from the repo (the legacy git-clone convention). Epic 5 owns the command surface, remaining skills, packaging, and distribution — not the first skill files. These skills deliver the FR-26 elicitation/remediation loops (see FR-26 split in the coverage map).
- **Exit criteria (M2 gate):** 100% of runs report their Axiom #2 degradation tier *(engineering-tier)*; Axiom #2 surfaces ≥3 genuine AC gaps across the first 20 dogfooded stories — an "AC gap confirmed by the author" is recorded as a DR-1 disposition on the Axiom #2 finding, so the gate is measured from committed disposition data *(gate-tier)*; the spec gate runs on 100% of new dogfooded stories, and ≥1 in 5 catches a defect pre-implementation *(gate-tier)*.

**FRs covered:** FR-9, FR-10, FR-11, FR-12, FR-13, FR-19 (Axiom #2 reasoning over the IDE transport), FR-26 (elicitation/remediation coaching loops, undistributed)

### Epic 3: LLM-Deepened Review with Governed Cost (M3, part 1)

A developer opts into LLM enrichment and gets contextual findings beyond what AST/regex can see — with predictable, user-governed spend (per-agent toggles, model tiers, input-hash caching, Ollama/provider-agnostic; deterministic-only always available). Generalizes Epic 2's IDE-only transport into the full two-transport LLM layer (direct API + Ollama) and ships the corpus-independent enrichment agents (#3, #5); #6's corpus-dependent activation lands in Epic 4. Gated by SPIKE-1's M3-entry confirmation (≥98% envelope-valid bar on the real axiom skills) and measured by SPIKE-2.

- **Exit criteria:** SPIKE-1 M3-entry confirmation passes; SPIKE-2 delivers per-phase latency/token numbers against NFR-2 *(gate-tier: measured during dogfooding)*; cross-tier dedup (FR-21) validated against overlap-labeled fixtures, not chance encounters; a re-run on unchanged inputs approaches zero marginal cost (NFR-5).
- **Enablers carried:** the two-transport half of the parity fixture (recorded golden `.out` envelopes replayed through both transports' validation/aggregation/manifest paths — first possible here, where the second transport exists; the deterministic-tier byte-parity half runs in CI from Epic 1); overlap-labeled dedup fixtures (a new artifact — SPIKE-4's corpus is noise-labeled, not overlap-labeled); LLM-tier content-addressed cache with model-identity keying.

**FRs covered:** FR-19 (primary), FR-33, FR-35, FR-36

### Epic 4: Institutional Memory — Corpus, Conventions & Trends (M3, part 2)

The team's codebase knowledge becomes explicit and governed: the Cartographer maintains the Corpus Map, the Miner proposes conventions, curation happens as a batched digest, trust decays automatically, conformance findings cite living exemplars, and longitudinal reports tell the repo's quality story (UJ-3). Uses Epic 3's LLM layer for inference halves; its deterministic mining core stands alone. **Preconditions:** OD-2 (damping mechanics), OD-3 (evidence precedence), OD-4 (digest cadence) — all resolved 2026-07-03, see Open Decisions. **Interim staleness posture, made explicit:** freshness watermarking (FR-7) arrives here — through Epics 1–3 corpus staleness is unguarded *by design*, acceptable because until this epic the corpus is a structural seed with no confirmed conventions to mis-enforce.

- **Exit criteria (M3 gate, shared with Epic 3 — all gate-tier, design-partner dependent):** on at least one real brownfield repo, ≥10 conventions reach `confirmed` within 4 weeks of `init`; ≥60% of mined `proposed` conventions accepted by a human; Axiom #6 catches ≥70% of the consistency issues human reviewers historically raised (launch-headline benchmark).

**FRs covered:** FR-1, FR-2, FR-4, FR-5, FR-6, FR-7, FR-8, FR-16, FR-17, FR-19 (#6 corpus-dependent activation), FR-22, FR-26 (curation digest + staleness prompt loops)

### Epic 5: Ship It — Plugin, CI Gate & Write-Time Guardrails (M4 → v1)

Teams adopt the tool through its three surfaces: the Claude Code plugin with full coaching loops, the GitHub Action with per-axiom status checks and a single replacing PR comment, the complete command surface, and the axiom-aligned write-time standards skill (UJ-2 in full). Wraps prior epics in distribution; each already worked for the dogfooding user without it. FR-30's dashboard is the per-run, per-axiom summary rendered in these surfaces — distinct from Epic 1's longitudinal `trends.html`.

- **Exit criteria (M4 gate → v1 launch — all gate-tier except store listing):** listed in the Claude Code Plugin Store and awesome-claude-code; ≥200 GitHub stars; ≥3 external repos with a committed `_agentic-guardrails/` folder. Counter-metrics must hold: noise rate <30% and non-increasing; time-to-first-value ≤15 minutes on a fresh repo.

**FRs covered:** FR-26, FR-27, FR-28, FR-29, FR-30, FR-37, FR-38

## Epic 1: Zero-Cost Deterministic Review (M0 + M1)

A developer runs `guardrails init` then `guardrails review` on any scope and gets trustworthy deterministic findings with provenance and per-axiom scores, persisted as artifacts — at exactly zero LLM cost, on Windows/macOS/Linux. Internal gate order: scaffold (1.1) → walking skeleton (1.4) → scale-out; SPIKE-3 (1.5), SPIKE-5 (1.14), and SPIKE-4 (1.17) gate the stories that follow them.

### Story 1.1: Monorepo Scaffold with Guarded Boundaries

As a maintainer,
I want a pnpm-workspaces monorepo whose package boundaries are lint-enforced from the first commit,
So that the vendor-decoupling wall (`core` is LLM-free) is a build failure, not an intention.

**Acceptance Criteria:**

**Given** a fresh clone on Node.js 24 LTS (Windows, macOS, or Linux),
**When** `pnpm install && pnpm -r build && pnpm -r test` runs,
**Then** all workspace packages (`contracts`, `core` at minimum) build in topological order via TS project references,
**And** `packageManager` and `engines` pin pnpm 11.x / Node 24, all packages are ESM-only (`"type": "module"`), and builds use tsup.

**Given** any source file in `packages/core` that imports from an LLM package or SDK,
**When** lint runs (locally or in CI),
**Then** the forbidden-import rule fails the build with a message naming the violated boundary.

**Given** a pull request to this repo,
**When** the CI workflow runs,
**Then** lint, typecheck, and test execute and gate the PR,
**And** Changesets is configured for SemVer release management.

### Story 1.2: Canonical Contracts Package

As a dev agent implementing any analyzer or surface,
I want every canonical schema defined once in a pure-Zod `contracts` package,
So that all components emit identical, validated shapes and no one invents an ad-hoc interface.

**Acceptance Criteria:**

**Given** the `contracts` package,
**When** its dependencies are inspected,
**Then** `zod` is the only runtime dependency.

**Given** a candidate `Finding` object,
**When** validated with `safeParse`,
**Then** it requires `axiom`, `location`, `message`, `tier: 'deterministic'|'inferred'`, `source: 'ast'|'regex'|'llm'`, `confidence`, `severity: 'error'|'warning'|'info'`, and `findingId`, with optional `exemplar` and `degraded` (OD-6),
**And** an object missing `severity` or `findingId` fails validation,
**And** the schema documents `confidence` semantics per tier: deterministic-tier findings carry the fixed maximum value (calibrated confidence is an LLM-tier concern, first populated with real values in Epic 2).

**Given** the same finding recomputed after unrelated lines are added above it,
**When** `findingId` (hash of `{axiom, ruleId, file, enclosing symbol/normalized context}`) is regenerated,
**Then** the id is unchanged — dispositions survive line drift.

**Given** the package exports,
**When** enumerated,
**Then** they include the partial-result contract `{ data, coverage|provenance, degraded[] }`, `RunManifest` (ledger hash, corpus hash, ruleset version, tier-enablement, engine version, model identity + `modelIdentity.source`), the ADR-001 `<axiom>.in`/`.out` envelope, the config schema with generated JSON Schema, the OD-1 trend-record schema (`recordId`, `commitSha`, per-axiom severity counts, changed-KLOC), and the DR-1 disposition-record schema (`recordId` keyed on `{run-id, findingId}`, pinned disposition enum).

**Given** every persisted-artifact schema,
**When** an artifact of version `v_n` is read by an engine at `v_n+1`,
**Then** the forward-migration ladder upgrades it before `safeParse`, verified by a golden round-trip fixture test.

### Story 1.3: TypeScript LanguageAdapter and Import Graph

As a developer whose repo uses path aliases, barrels, and re-exports,
I want a semantic, type-aware LanguageAdapter and import/dependency graph,
So that every analyzer resolves modules the way the TypeScript compiler actually does.

**Acceptance Criteria:**

**Given** golden fixtures exercising path aliases, barrel files, re-exports, and dynamic imports,
**When** the import graph is built (ts-morph),
**Then** every edge resolves exactly as the fixture expectations specify.

**Given** a file with an unresolvable import,
**When** the graph is read,
**Then** the partial-result contract returns `{ data, coverage, degraded[] }` with a typed degradation entry — never a throw, never silent omission.

**Given** identical input,
**When** the graph is built twice,
**Then** the serialized output is byte-identical.

**Given** any entity in the graph,
**When** queried,
**Then** dependency fan-in and fan-out are available (feeds the structural corpus seed in 1.8).

### Story 1.4: Walking Skeleton — First End-to-End Review

As a solo maintainer,
I want one deterministic axiom running over a real diff through the real pipeline into a persisted artifact,
So that every load-bearing joint is proven before the taxonomy scales.

**Acceptance Criteria:**

**Given** a git repo with uncommitted changes,
**When** `guardrails review` runs,
**Then** Axiom #1 (structural, minimal rule set — the full rule set arrives in 1.9) emits Zod-valid `Finding`s with `tier: deterministic`, `source: ast`, populated `severity` and `findingId`,
**And** the review artifact is written to `_agentic-guardrails/reviews/uncommitted/` via atomic write (temp → fsync → rename), through the actual pipeline phases (0 → 1 → 4 → 5), not a harness stub.

**Given** `_agentic-guardrails/` does not yet exist (this story precedes `init`, 1.8),
**When** the artifact is written,
**Then** the skeleton creates the minimal folder on demand — full bootstrap and git wiring remain 1.8's scope.

**Given** the run completes,
**When** the run manifest is read,
**Then** it declares what ran, what didn't, and why (zero silent degradation, NFR-8).

**Given** the same input reviewed twice,
**When** outputs are compared,
**Then** findings are byte-identical and sorted by `file → line → axiom`.

**Given** changes under `_agentic-guardrails/`,
**When** the diff under review is computed,
**Then** they are excluded (self-exclusion rule).

**Given** findings at or above the blocking level exist (built-in defaults at this story — the config plane arrives in 1.6),
**When** the CLI exits,
**Then** the exit code is nonzero; otherwise zero.

### Story 1.5: SPIKE-3 — Import-Graph Cost at Scale (gate)

As a maintainer making scale claims,
I want measured import-graph build cost on a 10,000-file repo and pipeline wall-clock on ~1,000 files,
So that NFR-1/6/13 rest on evidence and the ts-morph-vs-hybrid decision is made by numbers.

**Acceptance Criteria:**

**Given** a 10,000-file fixture repo,
**When** cold and warm graph builds run under the intended `p-map` concurrency bound,
**Then** wall-clock and peak memory are recorded, and a warm-rebuild budget is derived from the measured numbers and recorded in the spike write-up — that budget becomes the regression bound consumed by later stories.

**Given** a ~1,000-file TypeScript repo,
**When** the full deterministic pipeline runs,
**Then** it completes in under 60 seconds (NFR-1 — hard pass/fail).

**Given** the spike misses either budget,
**When** results are written up,
**Then** the hybrid fallback (Tree-sitter structural pass + targeted ts-morph resolution) is decided and recorded as an ADR before analyzer scale-out continues.

**Given** the spike passes,
**Then** the measured memory numbers set the `p-map` concurrency bound consumed by story 1.7, and golden-fixture resolution correctness still passes at scale.

### Story 1.6: Config Plane

As a user tuning the tool to my team's maturity,
I want one schema-validated YAML config with editor autocomplete,
So that every deviation from defaults is explicit and visible, never silent.

**Acceptance Criteria:**

**Given** `_agentic-guardrails/config.yaml`,
**When** loaded,
**Then** it is validated by the `contracts` config schema; an invalid value produces a typed error naming the offending path — never a stack trace.

**Given** the generated JSON Schema,
**When** referenced from the YAML file,
**Then** editors provide autocomplete and inline validation (FR-31).

**Given** per-axiom enforcement levels (`blocking | advisory | off`) with numeric thresholds,
**When** a review runs,
**Then** exit-code gating honors them, and Axiom #5 defaults to `blocking` (FR-32).

**Given** any config value deviating from defaults,
**When** a run starts,
**Then** the deviation is logged explicitly,
**And** no component reads config outside the validated object (sole exception: LLM API key from env, unused until Epic 2).

### Story 1.7: Pipeline Hardening and Deterministic Cache

As a developer running reviews all day,
I want per-axiom failure isolation, dynamic pipeline assembly, and content-addressed caching,
So that one broken analyzer never kills a run and unchanged inputs are near-free.

**Acceptance Criteria:**

**Given** an analyzer that throws mid-run,
**When** the pipeline executes,
**Then** all other axioms complete, the failed axiom is reported as `degraded` with a typed reason in the manifest and report header, and the run's exit code follows gating config (NFR-7/8, FR-24).

**Given** scope, mode, available artifacts, and config,
**When** the pipeline assembles,
**Then** per-phase node membership varies accordingly while the six-phase shape stays fixed (FR-24).

**Given** two findings on the same file, axiom, and >50%-overlapping line range,
**When** the reduce step runs,
**Then** they merge into one finding with a source array, the strongest severity, and both descriptions preserved (FR-21).

**Given** unchanged inputs,
**When** a review re-runs,
**Then** graph and findings are served from the content-addressed cache (keyed on change + context + ruleset version + engine version + tier-enablement) and analyzer execution is skipped.

**Given** the `p-map` bound from SPIKE-3 and per-phase time budgets,
**When** a phase exceeds its budget,
**Then** the run degrades to partials with a typed reason — never an uncaught failure.

### Story 1.8: `init` and the Structural Corpus Seed

As a new user on a brownfield repo,
I want `guardrails init` to bootstrap the artifact folder, git wiring, and a structural corpus seed,
So that my first review has structure to lean on within minutes, at zero LLM cost.

**Acceptance Criteria:**

**Given** a repo without `_agentic-guardrails/`,
**When** `guardrails init` runs,
**Then** it creates committed `config.yaml` (via a questionnaire generated from the JSON Schema), an empty-but-valid `conventions.yaml`, and `corpus-map.yaml` (human-confirmed layer, empty at init),
**And** writes the `merge=union` gitattribute covering `history/*.jsonl` and the `.cache/` ignore entry.

**Given** the import graph from 1.3,
**When** the structural seed builds,
**Then** entities with locations and dependency fan-in are written to the gitignored `.cache/` (regenerable; no mining attempted — FR-3 split).

**Given** a subsequent review run,
**When** Phase-0 preflight executes,
**Then** it verifies the gitattribute and ignore entry, warning loudly with the named consequence if either is missing,
**And** preflight adds at most 5 seconds to review start (NFR-3).

**Given** `init` runs again on an initialized repo,
**When** it completes,
**Then** human-edited files are never clobbered (idempotent).

**Given** `--no-input` (non-interactive/CI context),
**When** `init` runs,
**Then** the questionnaire is skipped and documented defaults are written — no prompt ever blocks.

### Story 1.9: Axiom #1 — Structural Analyzer (full rule set)

As a developer reviewing AI-written code,
I want the full deterministic structural rule set for Axiom #1,
So that architectural violations beyond the walking skeleton's minimal rules are caught at zero LLM cost (FR-18).

**Acceptance Criteria:**

**Given** a fixture with known structural violations (dependency-direction breaches per the import graph, disallowed cross-boundary imports, cyclic dependencies, misplaced files per the declared layout),
**When** the analyzer runs,
**Then** it emits exactly the expected findings with `axiom: 1`, `tier: deterministic`, `source: ast`, correct locations and severities per the fixture oracle.

**Given** a clean fixture,
**When** the analyzer runs,
**Then** zero findings (false-positive guard, feeds the SPIKE-4 noise bar).

**Given** the walking skeleton's minimal rule set (1.4),
**When** this story lands,
**Then** those rules are absorbed into a documented full rule set where every rule has at least one fixture case and a documented rationale.

**Given** Axiom #1 set to `off` or `advisory` in config,
**When** a review runs,
**Then** the analyzer is skipped-and-declared or reported non-gating respectively,
**And** identical input always yields byte-identical output.

### Story 1.10: Axiom #3 — Cleanliness Analyzer (AST tier)

As a developer reviewing AI-written code,
I want deterministic AST-tier cleanliness findings,
So that dead code, duplication, and structural mess are caught at zero LLM cost.

**Acceptance Criteria:**

**Given** a dirty fixture with known cleanliness violations (dead/unreachable code, unused exports, copy-paste structural duplication, excessive complexity),
**When** the analyzer runs,
**Then** it emits exactly the expected findings with `axiom: 3`, `tier: deterministic`, `source: ast`, correct locations and severities per the fixture oracle.

**Given** a clean fixture,
**When** the analyzer runs,
**Then** zero findings (false-positive guard, feeds the SPIKE-4 noise bar).

**Given** Axiom #3 set to `off` or `advisory` in config,
**When** a review runs,
**Then** the analyzer is skipped-and-declared or reported non-gating respectively,
**And** identical input always yields byte-identical output.

### Story 1.11: Axiom #4 — NFR Analyzer (structural tier)

As a developer,
I want structural-tier findings for performance and reliability hazards,
So that unbounded concurrency, missing timeouts, and blocking-I/O-in-hot-path patterns surface deterministically.

**Acceptance Criteria:**

**Given** a fixture with known NFR hazards (unbounded `Promise.all` over I/O, sync filesystem calls in request paths, missing cancellation/timeout on external calls),
**When** the analyzer runs,
**Then** it emits exactly the expected findings with `axiom: 4`, `tier: deterministic`, correct provenance and severities per the fixture oracle.

**Given** a clean fixture,
**When** the analyzer runs,
**Then** zero findings.

**Given** the documented rule set,
**When** reviewed,
**Then** every rule has at least one fixture case and a documented rationale,
**And** enforcement-level config and byte-identical determinism hold as for 1.10.

### Story 1.12: Axiom #5 — Security Analyzer (regex/AST tier)

As a developer,
I want deterministic security findings that block by default,
So that secrets, injection sinks, and dangerous APIs never ride an AI-generated diff into main.

**Acceptance Criteria:**

**Given** a security fixture with known violations (hardcoded secrets/tokens, SQL/command-injection sinks, `eval`-family and other dangerous APIs, unsafe deserialization),
**When** the analyzer runs,
**Then** it emits exactly the expected findings with `axiom: 5`, `tier: deterministic`, `source: regex|ast`, severities per the fixture oracle.

**Given** default configuration,
**When** an error-severity Axiom #5 finding exists,
**Then** the review exits nonzero — security defaults to `blocking` (FR-32).

**Given** a clean fixture,
**When** the analyzer runs,
**Then** zero findings,
**And** analyzed code is parsed as data only — the analyzer never executes or dynamically requires target code.

### Story 1.13: Axiom #6 — Conformance Analyzer (structural tier)

As a developer on a brownfield codebase,
I want structural conformance findings against the corpus seed,
So that AI-written code that fights the codebase's actual shape is flagged from day one — before any convention is confirmed.

**Acceptance Criteria:**

**Given** a structural corpus seed (1.8) and a fixture repo with a dominant structural pattern plus a deviating diff (file placement, naming, module shape),
**When** the analyzer runs,
**Then** it flags the deviation with `axiom: 6`, `tier: deterministic`, and the finding message cites the prevailing pattern's prevalence evidence (full living-exemplar citations are FR-22, Epic 4).

**Given** no corpus seed exists or the seed is unreadable,
**When** the analyzer runs,
**Then** it returns `inconclusive` with a typed reason (`no_corpus`) — never a false pass, never a crash (partial-result contract).

**Given** a diff that matches the prevailing patterns,
**When** the analyzer runs,
**Then** zero findings,
**And** unconfirmed conventions never produce findings (FR-5 invariant holds even at the structural tier).

### Story 1.14: SPIKE-5 — Windows Git-Worktree Lifecycle (gate)

As a maintainer developing on Windows,
I want the worktree isolation lifecycle proven under failure injection,
So that remote-scope reviews can never leak worktrees or corrupt the invoking tree (NFR-9/12).

**Acceptance Criteria:**

**Given** 100 consecutive create → run → cleanup cycles on Windows,
**When** they complete,
**Then** zero leaked worktrees, zero orphaned locks, and a byte-identical invoking working tree.

**Given** the injected-failure suite — process kill mid-run, a file handle held open by another process during removal, paths >260 chars, case-collision names, push-failure → temp-dir degrade,
**When** each scenario runs,
**Then** every one ends with zero residue and an intact invoking tree.

**Given** the spike completes,
**When** written up,
**Then** the Windows-specific handling required by `core/persistence` and the git wrapper is documented and consumed by story 1.15.

### Story 1.15: Review Scopes — Branch, PR, and Project

As a developer finishing a branch,
I want `guardrails review` to cover branch diffs, PRs, and the full project with isolated execution,
So that I can gate any scope without disturbing my working tree.

**Acceptance Criteria:**

**Given** a branch, a locally-fetchable PR ref, or `--project`,
**When** the review runs,
**Then** remote refs execute inside an isolated `git worktree` (per SPIKE-5's documented handling), removed in `finally` even on failure,
**And** artifacts are written to the invoking context's `reviews/branch-{name}/`, `reviews/pr-{id}/`, or `reviews/project/` respectively.

**Given** a PR reviewed in Epic 1,
**When** metadata is needed,
**Then** `gh`-sourced metadata is used when available and degrades gracefully when absent — no GitHub API integration (Epic 5 boundary).

**Given** an interactive run completes,
**When** the artifact-disposition prompt appears (commit-or-drop for tracked-state writes — distinct from DR-1 *finding* dispositions, which are 1.16's concern),
**Then** the user chooses commit (`[skip ci]`) or drop — never an ambient mutation,
**And** a push/commit failure degrades to a temp-dir save with the path reported.

**Given** any scope,
**When** the diff is computed,
**Then** `_agentic-guardrails/` is always excluded (self-exclusion).

### Story 1.16: Scores, Trends, and Dispositions

As a maintainer watching my repo's quality story,
I want per-axiom scores recorded, trended with deltas, and findings dispositionable,
So that every run feeds the longitudinal memory and the trust metrics (FR-14/15, DR-1).

**Acceptance Criteria:**

**Given** a completed review,
**When** the artifact is composed,
**Then** per-axiom severity counts normalized by changed-KLOC are recorded, and the derived score (OD-1 formula v1: `100 − (10·E + 3·W + 1·I)/changed-KLOC`, floor 0, formula-version stamped) is rendered in the report,
**And** changed-KLOC counts added + deleted lines and floors at 0.1 so tiny or deletion-only diffs stay finite *(edge rule proposed here — confirm with the OD-1 owner at story time; the formula is versioned precisely so this can evolve)*.

**Given** a previous run of the same scope type on the same branch (fallback: nearest ancestor commit),
**When** the report renders,
**Then** the per-axiom delta appears alongside current findings (FR-15).

**Given** run completion,
**When** trend records append to `history/trends.jsonl`,
**Then** writes are atomic, records carry `recordId` + `commitSha`, and the aggregator dedupes on `recordId`, orders by commit ancestry, validates-before-trust, and cold-starts on invalid history.

**Given** the user dispositions findings post-run (CLI),
**When** dispositions are recorded,
**Then** they append to committed `history/dispositions.jsonl` keyed `{run-id, findingId}` using the pinned enum, independent of whether the review artifact was committed or dropped.

**Given** `--no-input` (non-interactive/CI flag),
**When** a review runs,
**Then** no prompt ever blocks; disposition handling follows configured policy.

**Given** `guardrails trends [--open]`,
**When** invoked,
**Then** a fully self-contained HTML view (inlined data, vanilla JS + inline CSS, no CDN, no network) renders the per-axiom count series and derived scores to `.cache/trends.html`.

**Given** more than 100 run manifests exist under `manifests/`,
**When** a run completes,
**Then** manifests are pruned to the newest 100 (config-overridable) — disposition and trend records in committed history are never pruned.

### Story 1.17: SPIKE-4 — Noise Metric and Labeled Fixtures (gate)

As a maintainer whose product claim is trust,
I want a defined noise metric with a labeled fixture corpus wired into CI,
So that the <30% noise bar is measurable before anyone asserts it.

**Acceptance Criteria:**

**Given** the metric definition,
**When** documented,
**Then** it specifies the denominator (error/warning-severity findings) and the labeling method (DR-1 dispositions; disposition scope — per-run vs carried across `findingId` reappearances — is decided here and recorded).

**Given** the analyzers that landed before this story (1.4, 1.9–1.13),
**When** the metric goes live,
**Then** their dirty/clean fixtures are folded into the labeled corpus and a retroactive noise baseline is computed per analyzer — the "foundational" inventory status is satisfied backward, not waived.

**Given** a labeled fixture corpus of true and false positives (the CI proxy for the live disposition-based metric — same denominator, fixture labels standing in for dispositions),
**When** the deterministic pipeline runs over it in CI,
**Then** the computed noise rate is reported and the check fails at ≥30%.

**Given** a new analyzer lands,
**When** the counter-metric runs,
**Then** the noise rate is compared against the prior baseline and flagged if increasing (the PRD's non-increasing requirement).

### Story 1.18: Dogfood CI Workflow

As the project itself,
I want every PR to this repo reviewed by the tool in GitHub Actions,
So that dogfooding starts at M1 and the M1 gate ("reviews 100% of its own PRs") is mechanically true.

**Acceptance Criteria:**

**Given** a PR to this repo,
**When** the Actions workflow runs,
**Then** `guardrails review` executes on the PR diff via direct CLI invocation (no packaged Action), deterministic-only, with `--no-input`,
**And** blocking findings fail the check via nonzero exit.

**Given** the CI suite,
**When** it runs,
**Then** the deterministic determinism test (same input → byte-identical findings) executes as a required check (the M1 half of the parity fixture),
**And** run artifacts are published as workflow artifacts without committing (configured policy).

**Given** this repo's size,
**When** the dogfood review runs,
**Then** wall-clock is under 60 seconds (the NFR-1 envelope; this repo is well under the ~1,000-file reference size).

### Story 1.19: SPIKE-1 — Structured-Output Prototype (M1 signal)

As a maintainer about to bet Epic 2 on the file-handshake,
I want a throwaway harness measuring raw envelope parse-failure rates,
So that the ADR-001 envelope is shaped while it is still cheap to change (named scaffold cost, accepted).

**Acceptance Criteria:**

**Given** a minimal throwaway handshake skill and the 1.2 envelope schema,
**When** ~50 real IDE invocations run,
**Then** the raw `safeParse` failure rate is measured and recorded.

**Given** the repair/retry contract (interactive: 1 correction retry + 1 repair),
**When** applied to the failures,
**Then** the post-repair envelope-valid rate is reported against the ≥98% bar (≤1 failure in 50).

**Given** the bar is missed,
**When** the spike concludes,
**Then** the envelope/prompt is simplified (or the schema split) and re-measured before Epic 2 story work begins — the spike fails closed,
**And** the harness is deleted after write-up; only the report and envelope adjustments survive.

## Epic 2: The Spec Gate — AC Validation & Verification (M2)

An author validates a story's acceptance criteria before implementation and Axiom #2 verifies the implementation and tests against them afterward, with declared degradation tiers (UJ-1). Includes the minimal interactive file-handshake transport (see Epic 2's transport note in the Epic List). Depends only on Epic 1.

### Story 2.1: SDD Contract and ValidatedSDD

As an author,
I want my Specification & Design Document validated into a schema-checked ValidatedSDD,
So that acceptance criteria become a machine-comparable verification contract (FR-9).

**Acceptance Criteria:**

**Given** an SDD with acceptance criteria,
**When** validation runs,
**Then** each criterion is checked against one bar — verifiable and quantitative, not qualitative — and the result is a Zod-valid ValidatedSDD artifact persisted to committed `_agentic-guardrails/sdds/` (a validated spec is a decision per the version-decisions rule; layout addition backported to the architecture's artifact layout at this story),
**And** each criterion carries a pass/fail verdict with a machine-readable reason for failures.

**Given** an SDD with qualitative criteria ("works well", "is fast"),
**When** validation runs,
**Then** each failing criterion is flagged with *why* it is not machine-comparable.

**Given** a document that is not an SDD at all,
**When** validation runs,
**Then** a typed schema error names what is missing — never a crash or a silent pass.

### Story 2.2: Standalone Spec Gate (deterministic)

As an author about to start implementation,
I want `guardrails gate <spec>` to validate my spec in minutes,
So that spec defects cost minutes instead of a rework cycle (FR-10, UJ-1 steps 1–3).

**Acceptance Criteria:**

**Given** a spec document and no code,
**When** `guardrails gate` runs,
**Then** the 2.1 validation executes standalone (no review pipeline) and reports which ACs fail and why, in under 60 seconds for a spec of up to 25 acceptance criteria.

**Given** a passing spec,
**When** the gate runs,
**Then** the ValidatedSDD is persisted and the exit code is zero; failing specs exit nonzero.

**Given** the gate runs in a context without LLM transport,
**When** it completes,
**Then** deterministic validation still works fully — proposed rewrites (2.4) are an additive layer, not a dependency.

### Story 2.3: Interactive File-Handshake Transport

As the runtime hosting LLM reasoning inside the IDE,
I want the ADR-001 dispatch → collect file-handshake implemented,
So that core stays LLM-free while Claude Code skills do the reasoning (FR-19 IDE transport).

**Acceptance Criteria:**

**Given** a run needing LLM reasoning,
**When** core dispatches,
**Then** it writes each `<axiom>.in.json` plus `run-state.json` (persisted phase outputs + deadline) under `.cache/handshake/<run-id>/`, prints the pending-file list, and exits.

**Given** the skill has written `<axiom>.out.json` via temp → fsync → atomic rename,
**When** `guardrails review --collect <run-id>` runs,
**Then** out-files are `safeParse`-validated (with the required self-reported `modelIdentity`), Phases 4–5 complete the run, and the envelope-valid path produces normal findings.

**Given** a missing/invalid out-file or a collect past the deadline,
**When** collect runs,
**Then** the axiom yields a typed `degraded` (`handshake_timeout | handshake_invalid`) with per-axiom isolation — the interactive retry budget (1 correction + 1 repair) applies before degrading.

**Given** concurrent runs or an orphaned handshake dir older than the ceiling,
**When** runs execute,
**Then** run-scoped dirs never collide and orphans are garbage-collected at next run start,
**And** the three-tier egress posture is documented in the README with this story (IDE transport = opt-in cloud egress).

### Story 2.4: AC Elicitation Coach

As an author with a missing or qualitative spec,
I want dialogue-driven coaching to a ValidatedSDD, including proposed rewrites I can apply,
So that I reach a verifiable spec without knowing the schema by heart (FR-11, UJ-1 steps 3–4).

**Acceptance Criteria:**

**Given** a spec with failing ACs,
**When** the coaching skill runs (interactive mode only, via 2.3's handshake; JSON Schema embedded inline in the skill prompt),
**Then** each failing criterion receives a concrete proposed rewrite into machine-comparable form.

**Given** the author requests the proposed solutions be applied,
**When** the coach applies them,
**Then** edits touch the spec document only (never code), are presented as a reviewable diff, and are written only on explicit author acceptance — a declined proposal leaves the document byte-identical.

**Given** no spec document exists at all,
**When** the zero-document path runs,
**Then** the dialogue builds a spec from scratch to a passing ValidatedSDD,
**And** in headless contexts the coach is skipped-and-declared (interactive-only, FR-11).

### Story 2.5: Axiom #2 — AC-to-Symbol Binding (deterministic)

As a reviewer,
I want each acceptance criterion bound to the code symbols implementing it,
So that Axiom #2's audit has a deterministic anchor and unbound ACs surface immediately (FR-12 part 1, FR-13).

**Acceptance Criteria:**

**Given** a ValidatedSDD and an implementation diff,
**When** binding runs,
**Then** each AC is bound to code symbols via the LanguageAdapter under a documented deterministic matching rule (identifier/reference resolution against the diff and its transitive references), and ACs matching no symbol under that rule are reported as unbound findings (`axiom: 2`, `tier: deterministic`).

**Given** no usable SDD exists,
**When** a review runs,
**Then** Axiom #2 declares its degradation tier in the manifest and report — full / partial / none — with no silent skip, ever (FR-13).

**Given** identical inputs,
**When** binding re-runs,
**Then** results are byte-identical.

### Story 2.6: Axiom #2 — Logic and Test-Coverage Audit (LLM)

As an author who validated a spec this morning,
I want the implementation's logic and its tests audited against my ACs,
So that "runs but doesn't do what I asked" is caught before the PR (FR-12 part 2, FR-19, UJ-1 step 5).

**Acceptance Criteria:**

**Given** bound ACs and the diff,
**When** the axiom-2 handshake skill runs (loaded via local plugin install),
**Then** it audits implementation logic against each AC and whether tests actually cover the stated requirements, emitting `tier: inferred` findings with `source: llm`, confidence, and the AC reference.

**Given** deterministic binding found unbound ACs,
**When** the LLM audit runs,
**Then** LLM findings never replace the deterministic signal — both survive to dedup (the LLM is never the sole line of defense, FR-19).

**Given** the transport degrades,
**When** the run completes,
**Then** the deterministic binding results still report, the manifest shows the audit's typed degradation, and headless contexts report the tier per FR-13.

## Epic 3: LLM-Deepened Review with Governed Cost (M3, part 1)

LLM enrichment beyond AST/regex with predictable, user-governed spend; generalizes Epic 2's IDE-only transport into the full two-transport layer. Gated by SPIKE-1's M3-entry confirmation. Depends on Epics 1–2.

### Story 3.1: SPIKE-1 — M3-Entry Confirmation (gate)

As a maintainer about to scale the LLM tier,
I want the structured-output measurement re-run against the real axiom skills,
So that the ≥98% bar is confirmed on production skills, not the throwaway harness.

**Acceptance Criteria:**

**Given** the production axiom skills existing at M3 entry (at minimum Epic 2's axiom-2 handshake skill) and the envelope as shipped,
**When** ~50 real invocations run with the repair/retry contract,
**Then** the post-repair envelope-valid rate is measured and reported against the ≥98% bar; skills added later in Epic 3 (3.4+) are measured against the same bar before they ship.

**Given** the bar is missed,
**When** the spike concludes,
**Then** the envelope/prompt is simplified before any enrichment agent (3.4+) is built — fails closed.

### Story 3.2: Provider-Agnostic Direct Transport

As a CI pipeline or Ollama user,
I want LLM reasoning through a direct adapter behind the same envelope,
So that provider choice never touches agent behavior (FR-36).

**Acceptance Criteria:**

**Given** a configured provider (Anthropic API or Ollama),
**When** an agent runs headlessly,
**Then** core calls the `llm` package's direct adapter, the response is validated against the identical envelope, and `modelIdentity.source: api-verified` is recorded in the manifest.

**Given** the provider is switched in config,
**When** the same review runs,
**Then** no agent code changes — only the adapter binding.

**Given** CI mode,
**When** an LLM response fails validation,
**Then** the retry policy is fail-fast (config-raisable to the hard cap of 2 retries + 1 repair), terminating in a typed `degraded`,
**And** the API key is read from env only, never persisted or logged, redacted in manifests.

### Story 3.3: LLM Cost Governance and Input-Hash Cache

As a team paying for tokens,
I want per-agent controls and hard caching,
So that spend is predictable, governed, and near-zero on unchanged inputs (FR-33, FR-35, NFR-5).

**Acceptance Criteria:**

**Given** per-agent config (enable/disable, model tier),
**When** a review runs,
**Then** disabled agents are skipped-and-declared, and each agent uses its configured tier.

**Given** unchanged inputs for an agent,
**When** a review re-runs,
**Then** the LLM-tier cache (key includes model identity + prompt/template version) serves the verdict with zero API calls; a model-identity mismatch is a miss that re-stores under the reported identity.

**Given** a completed run,
**When** the report renders,
**Then** it surfaces what the run actually cost (tokens/calls per agent) — spend is never a surprise,
**And** deterministic-only mode remains a first-class zero-cost path (FR-34 preserved).

### Story 3.4: Axiom #3 — Cleanliness Enrichment Agent

As a developer,
I want contextual cleanliness reasoning beyond what AST rules see,
So that semantic duplication and intent-level mess surface with provenance (FR-19).

**Acceptance Criteria:**

**Given** a diff with semantic issues invisible to the AST tier (logic duplication with different shapes, misleading naming vs behavior),
**When** the agent runs on either transport,
**Then** findings carry `axiom: 3`, `tier: inferred`, `source: llm`, confidence — advisory by default in CI.

**Given** the deterministic #3 analyzer found an overlapping issue,
**When** the reduce step runs,
**Then** cross-tier dedup merges per FR-21, validated against the overlap-labeled fixtures.

**Given** the agent fails or is disabled,
**When** the run completes,
**Then** deterministic #3 results are unaffected (per-axiom isolation; LLM never the sole line of defense).

### Story 3.5: Axiom #5 — Security Enrichment Agent

As a developer,
I want contextual security reasoning layered on the deterministic gate,
So that taint-flow and logic-level vulnerabilities surface without weakening the blocking baseline (FR-19).

**Acceptance Criteria:**

**Given** a diff with context-dependent vulnerabilities (tainted input reaching a sink across functions, authz bypass logic),
**When** the agent runs,
**Then** findings carry `axiom: 5`, `tier: inferred`, `source: llm`, confidence.

**Given** default CI gating,
**When** inferred #5 findings exist,
**Then** they advise (annotations) while deterministic #5 findings still block — the deterministic gate never depends on the LLM tier.

**Given** overlap with deterministic findings,
**When** dedup runs,
**Then** the merged finding keeps the strongest severity and both descriptions.

### Story 3.6: Two-Transport Parity Fixture

As a maintainer promising accountable verdicts,
I want recorded golden envelopes replayed through both transports in CI,
So that IDE and headless runtimes provably share validation, aggregation, and manifest paths.

**Acceptance Criteria:**

**Given** recorded golden `.out` envelopes,
**When** the CI parity fixture replays them through the file-handshake path and the direct-adapter path,
**Then** validation, aggregation, and manifest outputs are equivalent — deterministically, so the gate can neither flake nor be skipped.

**Given** the deterministic tier,
**When** parity is checked,
**Then** verdicts are byte-identical (extends the 1.18 determinism check across both runtimes).

**Given** live LLM verdict-class comparison,
**When** scheduled,
**Then** it runs as a periodic advisory probe, never a blocking check.

### Story 3.7: SPIKE-2 — Cost and Latency per Phase (gate-tier)

As a maintainer claiming a 5-minute full review,
I want measured wall-clock and token spend per phase on a worst-case PR,
So that NFR-2 is evidence, not hope.

**Acceptance Criteria:**

**Given** a realistic worst-case PR-sized diff,
**When** a full review (deterministic + enrichment) runs,
**Then** per-phase wall-clock and token spend are recorded and reported against the 5-minute target and 10-minute ceiling.

**Given** the ceiling is threatened,
**When** budgets are tuned,
**Then** per-phase budgets are set from the measured numbers, and the 10-minute ceiling degrades to partials — it is never the failure.

## Epic 4: Institutional Memory — Corpus, Conventions & Trends (M3, part 2)

The knowledge substrate goes fully live: Cartographer, Miner, curation, decay, freshness, exemplars, and the longitudinal story (UJ-3). ODs 2/3/4 resolved 2026-07-03. Depends on Epics 1–3.

### Story 4.1: Conventions Ledger — Schema and Lifecycle

As a team owning its conventions,
I want the full Ledger schema with lifecycle states and governance fields,
So that conventions are explicit, versioned artifacts humans control (FR-2).

**Acceptance Criteria:**

**Given** a ledger entry,
**When** validated,
**Then** it carries detection method, prevalence evidence, intent evidence, lifecycle status (`proposed | confirmed | waning | superseded | rejected`), the precedence-over-cleanliness flag, and (for rejected entries) damping metadata (`rejectionCount`, timestamps).

**Given** `conventions.yaml` is read,
**When** parsed,
**Then** Zod-on-read guards YAML coercion footguns per the documented quoting discipline, entries sort by stable id, and a torn or invalid file produces the documented degraded path (human-review prompt), never silent regeneration.

**Given** any write by the tool,
**When** it lands,
**Then** human-owned entries are never silently regenerated — tool writes touch only tool-owned fields.

### Story 4.2: Cartographer — Full Corpus Map Lifecycle

As a developer on a moving codebase,
I want the Corpus Map maintained incrementally with optional LLM enrichment,
So that "what exists, where, why" stays current at activity-scaled cost (FR-1).

**Acceptance Criteria:**

**Given** code changes since the last map build,
**When** the out-of-band warm refresh runs (review start or manual `guardrails map`),
**Then** only changed files re-map (hash-gated), affected Ledger entries re-evaluate only if their evidence set intersects changed entities, and the review itself never blocks — it uses last-known-good and reports the Map version/age used.

**Given** the deterministic structural map,
**When** the LLM inference half runs (via the envelope, one-way),
**Then** purpose/zone-role/exemplar-designation proposals are produced for human confirmation; confirmed annotations land in committed `corpus-map.yaml`, regenerable structure stays in `.cache/`.

**Given** the LLM half is disabled or degrades,
**When** the map is consumed,
**Then** the deterministic map remains complete and useful on its own.

### Story 4.3: Convention Miner

As a maintainer,
I want candidate conventions mined from Map evidence with prevalence and intent scoring,
So that the ledger fills itself with proposals I only have to judge (FR-4, OD-2).

**Acceptance Criteria:**

**Given** Map evidence,
**When** the Miner runs (out-of-band, never in the review path),
**Then** candidates enter the gitignored `.cache/proposed/` lane as `status: proposed`, each scored on prevalence and intent — never the committed ledger, never review findings.

**Given** a previously rejected identical convention,
**When** mining re-runs,
**Then** it is never re-proposed.

**Given** a *similar* candidate in a pattern family with prior rejections,
**When** scored,
**Then** its required prevalence threshold is `base × 2^rejectionCount` (capped) per OD-2.

### Story 4.4: Build Strategies — Hot-Seed Completion of `init`

As a user on a 10,000-file brownfield repo,
I want `init`'s `eager | lazy | hot-seed` mining strategies live,
So that day-one corpus value arrives at bounded cost that scales with activity, not size (FR-3 completion, NFR-6/13).

**Acceptance Criteria:**

**Given** `hot-seed` (the default),
**When** `init` seeding runs,
**Then** the highest-churn zones (from git history) are mined first within a config-declared cost bound (default: top 10 churn zones, config-overridable), the actual cost is reported against that bound, and the strategy choice appears in the questionnaire (the Epic 1 placeholder activates).

**Given** `eager` or `lazy`,
**When** selected,
**Then** eager mines all zones up front; lazy defers mining to first touch — each documented with its cost profile.

**Given** a 10k-file repo,
**When** hot-seed runs,
**Then** init-time cost scales with selected zones/activity, not raw file count (NFR-6 evidence recorded).

### Story 4.5: Evidence Trail

As a curator judging a proposal,
I want ledger entries linked to human-authored evidence,
So that confirmation decisions rest on recorded intent, not vibes (FR-8).

**Acceptance Criteria:**

**Given** a ledger entry,
**When** evidence is attached,
**Then** it links human-authored sources (ADRs, human PR comments, elicitation answers) stored under committed `_agentic-guardrails/evidence/` (evidence backs human decisions per the version-decisions rule; layout addition backported to the architecture's artifact layout at this story),
**And** bot/agent-generated content is excluded as evidence by rule.

**Given** an entry with evidence,
**When** displayed in the digest,
**Then** each source is shown with provenance (what, where, when).

### Story 4.6: Curation Digest

As a maintainer on my own schedule,
I want a batched digest to accept or reject proposals,
So that curation is one decision on something already surfaced — never per-review noise (FR-5, FR-26 partial, OD-3/OD-4, UJ-3).

**Acceptance Criteria:**

**Given** proposals in the `.cache/proposed/` lane,
**When** `guardrails curate` runs,
**Then** each is presented with its evidence; **accept** moves it to committed `conventions.yaml` as `confirmed` (the act that grants enforcement); **reject** writes it to the committed ledger as `rejected` with damping metadata — both as ordinary reviewable file edits.

**Given** contradictory human evidence on an entry,
**When** presented,
**Then** both sources appear side by side, the human's resolution is recorded on the entry with a rationale field, and that decision wins thereafter (OD-3).

**Given** ≥10 pending proposals or ≥30 days since last curation (config-overridable),
**When** a review summary renders,
**Then** exactly one quiet line notes the queue — never findings-level noise (OD-4),
**And** unconfirmed proposals never appear in review findings.

### Story 4.7: Asymmetric Trust Decay

As a team mid-migration,
I want enforcement revoked automatically as evidence erodes,
So that dead patterns stop being enforced without anyone having to notice first (FR-6).

**Acceptance Criteria:**

**Given** a confirmed convention whose incidence in the codebase declines past the config-defined decay threshold (default: incidence below 50% of the incidence recorded at confirmation, config-overridable),
**When** re-evaluation runs (out-of-band),
**Then** the entry transitions to `waning` and stops carrying enforcement, with the transition surfaced (not silent).

**Given** a convention superseded by a newer confirmed one,
**When** detected,
**Then** it is marked `superseded` and un-enforced,
**And** promotion back to `confirmed` requires human action — trust is human-granted, machine-revoked, never machine-granted.

### Story 4.8: Freshness Watermark and Staleness Ceiling

As a reviewer trusting corpus-dependent findings,
I want staleness detected before every review with a hard ceiling,
So that conformance never silently judges against a stale world (FR-7).

**Acceptance Criteria:**

**Given** Map and Ledger watermarks,
**When** a review starts,
**Then** staleness detection adds at most 5 seconds to review start (NFR-3, same bound as 1.8's preflight); interactive mode prompts to refresh, CI follows `defer | update | update_after:X`.

**Given** staleness beyond the hard ceiling (default ~14 days, config-overridable),
**When** the review runs,
**Then** corpus-dependent signals (#6 conformance, and any finding's `corpus://` exemplar citation) degrade to `inconclusive` (`reason: stale_corpus`) while corpus-independent axioms run normally — the ceiling forces a surfaced choice, never a blocking refresh, never silent staleness.

### Story 4.9: Axiom #6 — Conformance Enrichment and Living Exemplars

As a developer receiving a conformance finding,
I want the finding to cite a living exemplar from my own codebase,
So that the fix is a pointer, not a lecture (FR-19 #6 activation, FR-22, UJ-2 step 2).

**Acceptance Criteria:**

**Given** confirmed conventions and the Corpus Map,
**When** the #6 enrichment agent runs,
**Then** judgment-tier conformance findings carry `tier: inferred`, cite the violated convention, and include a `corpus://<entity>` exemplar resolving to a real, current entity.

**Given** only unconfirmed (`proposed`) conventions exist,
**When** the agent runs,
**Then** zero conformance findings from them — enforcement requires `confirmed` (human-confirm invariant).

**Given** the corpus is stale past the ceiling or the exemplar entity no longer exists,
**When** findings compose,
**Then** the axiom degrades to `inconclusive` / the citation is dropped with a typed reason — never a dangling pointer.

### Story 4.10: Longitudinal Reports and Ledger Health

As a maintainer telling the repo's quality story,
I want cross-signal reports over time and a semantic ledger-health view,
So that trajectory is visible and stale governance is loud (FR-16, FR-17).

**Acceptance Criteria:**

**Given** accumulated trend history,
**When** a longitudinal report is requested,
**Then** it correlates quality movements across axioms and time (e.g., "DRY violations up 40% over three sprints while SDD coverage dropped"), computed from committed `trends.jsonl` — validated-before-trust,
**And** a golden-fixture history with known movements reproduces the expected correlation statements exactly (the report's oracle).

**Given** the ledger,
**When** the health view renders,
**Then** staleness is expressed in human terms ("3 conventions waning, incidence −40%"), not commit counts,
**And** the trends HTML view gains the report's series without violating the no-CDN/no-network constraint.

## Epic 5: Ship It — Plugin, CI Gate & Write-Time Guardrails (M4 → v1)

The three distribution surfaces plus write-time enforcement (UJ-2 in full). Depends on Epics 1–4.

### Story 5.1: Write-Time Standards Skill

As an agent author writing code in a consuming repo,
I want axiom-aligned engineering standards injected at write time,
So that code is steered toward what the reviewer will check — same vocabulary, fewer findings (FR-37, FR-38).

**Acceptance Criteria:**

**Given** the skill's rule set,
**When** compared against the six axioms,
**Then** every rule maps to an axiom's vocabulary (structural, AC-fidelity, cleanliness, NFR, security, conformance), and remains a project-generic baseline — derived from no single repo's artifacts.

**Given** the skill description,
**When** matched against tasks,
**Then** it activates on backend/frontend code-writing tasks only — precision as a security boundary; it does not trigger on docs or unrelated work.

**Given** the legacy `engineering-standards` skill,
**When** diffed,
**Then** a rule-to-axiom mapping table exists in the skill's docs in which every legacy rule is mapped to an axiom, replaced, or explicitly dropped with rationale — no legacy rule left unaccounted (the FR-38 named axis, verifiable by inspection).

### Story 5.2: Command Surface

As a plugin user,
I want the full slash-command surface,
So that every scope and single-axiom run is one command away (FR-28).

**Acceptance Criteria:**

**Given** the plugin,
**When** installed,
**Then** `/review-local`, `/review-branch [branch?]`, `/review-pr [pr?]`, `/review-project`, and `/axiom <N> [--scope]` exist as thin wrappers over the CLI/engine — no analysis logic in the surface.

**Given** `/axiom <N>`,
**When** invoked,
**Then** a single-axiom run executes (the CLI gains its single-axiom counterpart in this story),
**And** each command's frontmatter declares only the tools it needs.

### Story 5.3: Plugin Packaging and Coaching Integration

As a Claude Code user,
I want one installable plugin with all coaching loops integrated,
So that interactive mode is a product, not a pile of dogfooding files (FR-26 primary).

**Acceptance Criteria:**

**Given** the plugin package,
**When** installed via the plugin store or git,
**Then** SDD elicitation, AC remediation, the curation digest entry point, and staleness prompts all work through it — the Epics 2/4 skills packaged, versioned, and described precisely.

**Given** a fresh user,
**When** they run `/review-local` for the first time,
**Then** missing setup (`init` not run) is detected and guided, not crashed on.

**Given** the plugin's skills,
**When** reviewed,
**Then** each skill's description is scoped to its exact trigger (description precision as a security boundary).

### Story 5.4: GitHub Action — Headless CI Mode

As a team gating merges,
I want the same pipeline as a GitHub Action with zero interactive pauses,
So that CI enforcement is the identical engine, accountably (FR-27).

**Acceptance Criteria:**

**Given** the Action on a PR,
**When** it runs on a standard GitHub-hosted runner,
**Then** the same pipeline executes with no extra infrastructure; anything that would pause resolves by configured policy and is reported as a gap.

**Given** artifacts and tracked-state writes,
**When** the run ends,
**Then** the Action follows configured policy — commit with `[skip ci]` or publish as workflow artifact without committing.

**Given** the run manifest,
**When** compared with an interactive run's manifest on the same input,
**Then** both carry the same envelope schema version and the comparison passes 3.6's equivalence rules (deterministic tier byte-identical; LLM tier verdict-class equivalent).

### Story 5.5: Per-Axiom Status Checks and the Single PR Comment

As a reviewer scanning a PR,
I want one structured comment and per-axiom checks,
So that CI review output is glanceable and never accumulates (FR-29, FR-33 completion).

**Acceptance Criteria:**

**Given** a completed CI run,
**When** results publish,
**Then** each axiom gets a status check — blocking axioms as required checks, advisory as informational — and one structured PR comment is created or **replaces its predecessor**, never stacking.

**Given** per-agent trigger events in config,
**When** CI events fire,
**Then** agents run only on their configured triggers (the FR-33 CI dimension, wired now that CI exists).

**Given** a degraded axiom,
**When** checks publish,
**Then** its check shows the tier and skip reason — absence-as-reported (NFR-8) extends to the checks surface.

### Story 5.6: Quality Dashboard View

As a developer reading any surface,
I want a per-axiom, per-run quality summary,
So that violations, severity, and trajectory are visible without opening the full artifact (FR-30).

**Acceptance Criteria:**

**Given** a completed run,
**When** the CLI summary and PR comment render,
**Then** each axiom shows violations, severity breakdown, trend delta (from 1.16's aggregator), and a link/path to the full artifact — per-run and distinct from the longitudinal `trends.html`.

**Given** a deterministic-only run,
**When** the dashboard renders,
**Then** LLM-tier rows show as declared-absent, not missing.

### Story 5.7: Distribution and Launch Readiness

As the maintainer launching v1,
I want packages published, surfaces listed, and first-run value verified,
So that adoption is durable and the M4 gate is measurable (go-to-market G2).

**Acceptance Criteria:**

**Given** the release,
**When** published,
**Then** `@agentic-guardrails/{contracts,core,llm,cli}` are on npm via Changesets, the Action is on the GitHub Marketplace, and the plugin is submitted to the Claude Code Plugin Store and awesome-claude-code,
**And** README, per-feature docs, and ADRs are current in the same release (Definition of Done).

**Given** a fresh external repo,
**When** `init` + first review run,
**Then** at least one finding the author judges worth acting on appears within 15 minutes of installation *(gate-tier: human judgment on a real external repo before launch — the counter-metric's mechanical half, wall-clock ≤15 min from install to first rendered finding, is engineering-verifiable)*.

**Given** launch claims,
**When** asserted,
**Then** every claim traces to a passed gate or spike (no unvalidated noise/performance claims — SPIKE-4 discipline).
