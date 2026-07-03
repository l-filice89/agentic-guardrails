---
stepsCompleted: [1]
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

**Derived requirements (gaps surfaced during epic breakdown, 2026-07-03 — recommend backporting to the PRD)**

- DR-1: Review artifacts support **human finding dispositions**, persisted in the review artifact. The disposition enum is **pinned in the `contracts` schema at the Epic 1 contracts story** (candidate set: `actionable | not-actionable | deferred`; final set is a story-level decision, then frozen). Dispositions are the data source for the PRD's trust/success metrics (UJ-2 step 5, M1 gate "≥70% dispositioned actionable") and SPIKE-4's noise counter-metric (<30% dispositioned not-actionable) — without them those metrics are unmeasurable. The artifact schema carries dispositions from Epic 1 so history never needs backfilling; the interactive capture loop matures with the surfaces in Epic 5. **Survival rule:** dispositions are *decisions*, so per the "version decisions, not derivations" rule they are recorded as **append-only disposition records in committed history — default home `history/dispositions.jsonl`** (same JSONL discipline as trend records: stable `recordId` keyed on `{run-id, findingId}` (needs OD-6's `findingId`), `commitSha`, idempotent under `merge=union`) — written post-run when the human dispositions, independent of whether the review artifact itself is committed or dropped, and immune to manifest pruning. The review artifact carries them redundantly for human reading. **Disposition scope** — whether a disposition on a `findingId` carries across its reappearances in later runs or is per-run — is defined together with SPIKE-4's noise metric, whose denominator depends on the answer.

**Open decisions — RESOLVED with the owner (Luca) on 2026-07-03, except OD-5 (deferred)**

- OD-1 ✅ *(was blocking Epic 1 score/trend stories)*: **Raw counts + derived score.** Trend records store per-axiom finding counts by severity, normalized by changed-KLOC; the score is a *derived view* computed by a **versioned formula** (v1: `100 − (10·errors + 3·warnings + 1·info) per changed-KLOC`, floored at 0). A formula change recomputes all history — scores are never baked into committed records ("version decisions, not derivations"). **Comparability rule (FR-15):** the delta is computed vs the previous run of the same scope type on the same branch; fallback: same scope type at the nearest ancestor commit.
- OD-2 ✅ *(was blocking Epic 4 mining stories)*: **Threshold doubling.** Each prior rejection in a pattern family doubles the prevalence-evidence threshold a *similar* candidate must clear (`threshold × 2^rejections`, capped); identical rejected conventions remain never-re-proposed. Damping metadata on the rejected ledger entry = `rejectionCount` + timestamps.
- OD-3 ✅ *(was blocking Epic 4 curation stories)*: **Human resolves, recorded.** No automatic precedence between contradictory human evidence; the digest presents both sources side by side, the human's resolution is written to the ledger entry with a rationale field, and that recorded decision wins thereafter — an ordinary reviewable ledger edit.
- OD-4 ✅ *(was blocking Epic 4 digest stories)*: **Manual + quiet threshold nudge.** `guardrails curate` is the only entry point; when the proposed queue crosses a threshold (≥10 proposals or ≥30 days since last curation, config-overridable) the end of a review summary carries one quiet line noting it — never findings-level noise.
- OD-5 ⏸ *(deferred, likely post-v1)*: zone-adjacency lazy-refinement materialization and query complexity. Owner: Luca.
- OD-6 ✅ *(was blocking the Epic 1 contracts story)*: **Severity enum `error | warning | info`; symbol-anchored `findingId`** = hash of `{axiom, ruleId, file, enclosing symbol / normalized context}`, so dispositions survive line drift. Backport the schema addition to the architecture document.
- OD-7 ✅ *(was blocking the Epic 1 pipeline-composition story)*: **Streaming deferred.** CLI summary + persisted artifact are v1's two output channels; real-time IDE streaming is post-v1 (Rule of Three).

**Backport tasks (owner: Luca, before any M1 gate claim is asserted):** DR-1 and the OD-1 score definition → PRD; the OD-6 `Finding` schema additions (`severity`, `findingId`) → architecture document. Otherwise the next document-driven workflow re-derives these gaps from sources that still have them.

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
- FR-23: Epic 1 — Review artifact persisted per scope *(layout conflict between addendum and architecture flagged in Additional Requirements — resolve at story time, default: addendum's `reviews/<scope>/`)*
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
- DR-1: Epic 1 — Disposition capture: artifact schema + CLI disposition recording (feeds SPIKE-4 and the M1 gate); interactive capture loop matures in Epic 5

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
