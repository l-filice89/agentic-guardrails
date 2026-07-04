---
stepsCompleted: [1, 2, 3, 4, 5, 6]
status: 'complete'
documentsIncluded:
  prd: '_bmad-output/planning-artifacts/prds/prd-agentic-guardrails-2026-06-10/prd.md'
  prdAddendum: '_bmad-output/planning-artifacts/prds/prd-agentic-guardrails-2026-06-10/addendum.md'
  architecture: '_bmad-output/planning-artifacts/architecture.md'
  epics: '_bmad-output/planning-artifacts/epics.md'
  ux: null
---

# Implementation Readiness Assessment Report

**Date:** 2026-07-04
**Project:** agentic-guardrails

## Document Inventory

**PRD:**

- `prds/prd-agentic-guardrails-2026-06-10/prd.md` (whole, with `addendum.md`)

**Architecture:**

- `architecture.md` (whole)

**Epics & Stories:**

- `epics.md` (whole)

**UX Design:**

- ⚠️ Not found — no UX design document exists. Assessment will evaluate impact.

**Duplicates:** None found.

## PRD Analysis

### Functional Requirements

**A. Knowledge substrate (pillar)**

- FR-1: The system builds and maintains a **Corpus Map**: an inventory of the codebase's entities (pages, components, hooks, services) with location, purpose, zone role, dependency fan-in, and links to the conventions each entity exemplifies. The Map is derived from the code and regenerable.
- FR-2: The system maintains a **Conventions Ledger**: curated convention entries, each with a detection method, prevalence evidence, intent evidence, lifecycle status, and a flag governing precedence over universal cleanliness rules. Ledger entries are human-owned and never silently regenerated.
- FR-3: An **`init` command** bootstraps the artifact folder and seeds Map + Ledger using a configurable build strategy (`eager | lazy | hot-seed`); default `hot-seed` mines highest-churn zones first.
- FR-4: A **Convention Miner** proposes candidate conventions from Map evidence, scoring on prevalence and intent; proposals enter the Ledger as `proposed`, only human confirmation promotes to `confirmed`.
- FR-5: Convention curation happens through a **batched digest on the user's schedule** — unconfirmed conventions never appear as review findings or per-review noise.
- FR-6: Convention trust is **asymmetric**: humans grant enforcement (confirm); the system automatically revokes it as evidence erodes (`waning`, superseded).
- FR-7: Map and Ledger carry a **freshness watermark**; staleness detected before every review, prompts in interactive mode (configurable in CI), hard staleness ceiling forces refresh.
- FR-8: Ledger entries can link to an **evidence trail** of human-authored sources (ADRs, human PR comments, elicitation answers); bot/agent-generated content excluded.

**B. Spec & AC runtime (pillar)**

- FR-9: The system validates a Specification & Design Document into a **ValidatedSDD** — schema-checked, acceptance criteria quantitative and machine-comparable.
- FR-10: A **standalone pre-implementation spec gate** runs before any code is written.
- FR-11: An **AC elicitation coach** guides the author from missing/qualitative spec to ValidatedSDD through dialogue (interactive only), including zero-document path.
- FR-12: **Axiom #2 verification** binds each AC to code symbols, audits implementation logic against ACs, audits whether tests cover the stated requirements.
- FR-13: With no usable SDD, Axiom #2 **degrades gracefully through declared tiers**; every run reports its tier — no silent skips.

**C. Longitudinal quality memory (pillar)**

- FR-14: Every review records **per-axiom quality scores**; stored as severity-graded finding counts normalized by change size; score is a **derived view computed by a versioned formula** (recomputable, never poisoned).
- FR-15: The system **trends scores across runs**, reporting delta vs previous run of same scope type on same branch (fallback: nearest ancestor commit).
- FR-16: The system produces **longitudinal reports** correlating quality movements over time.
- FR-17: A **ledger-health view** surfaces semantic staleness in human terms.
- FR-40: The system captures **human finding dispositions** (pinned enum, e.g. `actionable | not-actionable | deferred`), persisted as append-only records in committed history independent of artifact retention. Instrumentation behind trust metrics (M1 "≥70% dispositioned actionable"; noise counter-metric "<30% not-actionable").

**D. Six-axiom review pipeline**

- FR-18: A **deterministic phase** runs axioms #1, #3 (AST tier), #4 (structural), #5 (regex/AST), #6 (structural) in parallel at zero LLM cost.
- FR-19: An **LLM enrichment phase** deepens #2, #3, #5, #6; agents run independently and in parallel; the LLM is never the sole line of defense.
- FR-20: Every finding carries **provenance** (`ast | regex | llm`) and a confidence indicator.
- FR-21: Overlapping deterministic and LLM findings are **deduplicated** into a single finding preserving both descriptions and strongest severity.
- FR-22: Conformance findings **cite a living exemplar** from the team's own codebase.
- FR-23: Each run composes a **review artifact** persisted to the scope-appropriate location in the artifact folder.
- FR-24: The pipeline is **assembled dynamically** per scope/mode/artifacts/config, with per-axiom failure isolation.
- FR-25: Review **scopes**: uncommitted changes, branch diff, pull request, full project; remote branches/PRs reviewed in isolation without disturbing the working tree.

**E. Surfaces & modes**

- FR-26: An **interactive mode** (Claude Code plugin) with full coaching loops.
- FR-27: A **headless CI mode** (GitHub Action) running the same pipeline; pauses resolve by configured policy and are reported as gaps.
- FR-28: A **command surface**: `/review-local`, `/review-branch [branch?]`, `/review-pr [pr?]`, `/review-project`, `/axiom <N> [--scope]`.
- FR-29: CI publishes **per-axiom status checks** and maintains a **single structured PR comment** replacing its predecessor.
- FR-30: A **quality dashboard view** per axiom: violations, severity breakdown, trend delta, link to full artifact.

**F. Configuration & cost control**

- FR-31: A single **YAML configuration**, schema-validated, git-tracked, editor autocomplete; every deviation from defaults explicit and logged.
- FR-32: **Per-axiom enforcement levels** (`blocking | advisory | off`) with numeric thresholds and regression tolerance; security defaults `blocking`.
- FR-33: **Per-agent controls** in CI: enable/disable, model tier, trigger events.
- FR-34: A first-class **deterministic-only mode**: zero LLM calls, zero API cost.
- FR-35: **Input-hash caching**: LLM agents skip work when inputs haven't changed.
- FR-36: **Provider-agnostic LLM layer**: bring your own model, switch providers, Ollama local models.

**G. Write-time enforcement**

- FR-37: The v1 plugin ships a **write-time standards skill** injecting engineering standards into the agent's authoring context, scoped precisely.
- FR-38: The v1 skill **meaningfully improves on the legacy version**: rule set aligned with six-axiom vocabulary; remains a broad, project-generic baseline.
- FR-39: *(Post-v1, named for direction)* Confirmed Ledger conventions **augment the write-time skill** as a repo-specific layer.

**Total FRs: 40** (FR-1 … FR-40; FR-39 explicitly post-v1)

### Non-Functional Requirements

- NFR-1: Deterministic pipeline completes in **under 60 seconds on a ~1,000-file TypeScript repo**.
- NFR-2: Full review incl. LLM on PR-sized diff targets **under 5 minutes**, 10 minutes hard ceiling.
- NFR-3: `[ASSUMPTION]` Staleness detection and pre-flight add **negligible overhead** (seconds).
- NFR-4: Deterministic-only mode costs **exactly zero** LLM/API spend at any repo size.
- NFR-5: LLM spend **predictable and user-governed**; report surfaces actual run cost.
- NFR-6: Corpus/Ledger build cost **scales with activity, not repo size** (hot-seed).
- NFR-7: Per-axiom **failure isolation**; report states what ran, what didn't, why.
- NFR-8: **Zero silent degradation**: every run declares degradation tier and skipped agents.
- NFR-9: External review isolation **always cleans up** (worktrees removed even on failure), never corrupts invoking working tree.
- NFR-10: **Local-first**: nothing leaves the machine unless user configures external LLM provider.
- NFR-11: **No telemetry in v1** — not even opt-in.
- NFR-12: `[ASSUMPTION]` Runs on **Node.js LTS** across macOS/Linux/Windows; CI on standard GitHub-hosted runners.
- NFR-13: v1 targets **large brownfield repos**; corpus operations usable on `[ASSUMPTION]` 10,000+ files; review scopes diff-based.

**Total NFRs: 13**

### Additional Requirements

From the PRD addendum (strong priors for architecture): six-phase dynamic DAG orchestration; Zod state contracts (semver-versioned); dual-channel output; mode-aware retry; LLM execution split (IDE skills vs CI API adapter, `core/` purely deterministic); remote review isolation via `git worktree`; artifact folder layout `_agentic-guardrails/`; out-of-band knowledge maintenance (hash-gated warm refresh); dedup rule (same file + line range + axiom, >50% overlap); staleness ceiling default ~14 days.

Constraints: Apache-2.0 licensing (v2 runtime), MIT for legacy plugin; no commercial tier or cloud service; milestones M0–M5 are sequencing not releases (nothing published before M4); out of v1: Axioms #7/#8, `/fix-*`, languages beyond TypeScript, on-merge warm refresh, non-GitHub CI.

### PRD Completeness Assessment

The PRD is thorough: stable global FR IDs, quantified NFRs with explicit `[ASSUMPTION]` tags, measurable milestone gates with counter-metrics, explicit out-of-scope list, and risks with owners/revisit points. Status is `draft` but content maturity is high. Notable: FR-40 was backported from the epic breakdown (good traceability hygiene). No UX document exists — the PRD describes interaction surfaces (command surface, digest, coaching dialogues) whose UX lives implicitly in FRs and journeys.

## Epic Coverage Validation

### Coverage Matrix

| FR | Requirement (abbrev.) | Epic Coverage | Status |
| --- | --- | --- | --- |
| FR-1 | Corpus Map | Epic 4 (structural seed in Epic 1 via `init`) — Story 4.2 | ✓ Covered |
| FR-2 | Conventions Ledger | Epic 4 — Story 4.1 | ✓ Covered |
| FR-3 | `init` + build strategies | Split: Epic 1 (bootstrap + structural seed, Story 1.8) / Epic 4 (mining strategies, Story 4.4) | ✓ Covered |
| FR-4 | Convention Miner | Epic 4 — Story 4.3 | ✓ Covered |
| FR-5 | Batched curation digest | Epic 4 — Story 4.6 | ✓ Covered |
| FR-6 | Asymmetric trust decay | Epic 4 — Story 4.7 | ✓ Covered |
| FR-7 | Freshness watermark + ceiling | Epic 4 — Story 4.8 | ✓ Covered |
| FR-8 | Evidence trail | Epic 4 — Story 4.5 | ✓ Covered |
| FR-9 | ValidatedSDD | Epic 2 — Story 2.1 | ✓ Covered |
| FR-10 | Standalone spec gate | Epic 2 — Story 2.2 | ✓ Covered |
| FR-11 | AC elicitation coach | Epic 2 — Story 2.4 | ✓ Covered |
| FR-12 | Axiom #2 verification | Epic 2 — Stories 2.5 (binding) + 2.6 (LLM audit) | ✓ Covered |
| FR-13 | Declared degradation tiers | Epic 2 — Stories 2.5/2.6 | ✓ Covered |
| FR-14 | Per-axiom quality scores | Epic 1 — Story 1.16 (OD-1 resolved) | ✓ Covered |
| FR-15 | Trend deltas across runs | Epic 1 — Story 1.16 | ✓ Covered |
| FR-16 | Longitudinal reports | Epic 4 — Story 4.10 | ✓ Covered |
| FR-17 | Ledger-health view | Epic 4 — Story 4.10 | ✓ Covered |
| FR-18 | Deterministic phase | Epic 1 — Stories 1.4, 1.9–1.13 | ✓ Covered |
| FR-19 | LLM enrichment phase | Split, forward-only: Epic 2 (Axiom #2/IDE transport), Epic 3 (primary: #3/#5 + transports), Epic 4 (#6 activation, Story 4.9) | ✓ Covered |
| FR-20 | Finding provenance + confidence | Epic 1 — Story 1.2 (extended `llm` in Epic 3) | ✓ Covered |
| FR-21 | Dedup | Epic 1 — Story 1.7 (cross-tier exercised Epic 3, Story 3.4) | ✓ Covered |
| FR-22 | Living exemplar citations | Epic 4 — Story 4.9 | ✓ Covered |
| FR-23 | Review artifact persistence | Epic 1 — Stories 1.4/1.15 (layout conflict flagged + default resolution) | ✓ Covered |
| FR-24 | Dynamic pipeline assembly | Epic 1 — Story 1.7 | ✓ Covered |
| FR-25 | Review scopes + isolation | Epic 1 — Stories 1.14/1.15 (PR scope = locally-fetchable refs; GitHub API in Epic 5) | ✓ Covered |
| FR-26 | Interactive mode coaching | Split, forward-only: Epic 2 (elicitation/remediation), Epic 4 (digest/staleness), Epic 5 (primary: packaged plugin, Story 5.3) | ✓ Covered |
| FR-27 | Headless CI mode | Epic 5 — Story 5.4 | ✓ Covered |
| FR-28 | Command surface | Epic 5 — Story 5.2 | ✓ Covered |
| FR-29 | Status checks + single PR comment | Epic 5 — Story 5.5 | ✓ Covered |
| FR-30 | Quality dashboard view | Epic 5 — Story 5.6 | ✓ Covered |
| FR-31 | YAML config | Epic 1 — Story 1.6 | ✓ Covered |
| FR-32 | Per-axiom enforcement levels | Epic 1 — Stories 1.6/1.12 | ✓ Covered |
| FR-33 | Per-agent controls | Epic 3 — Story 3.3 (CI trigger dimension in Epic 5, Story 5.5) | ✓ Covered |
| FR-34 | Deterministic-only mode | Epic 1 (only mode until Epic 3; preserved in Story 3.3) | ✓ Covered |
| FR-35 | Input-hash caching (LLM) | Epic 3 — Story 3.3 | ✓ Covered |
| FR-36 | Provider-agnostic LLM layer | Epic 3 — Story 3.2 | ✓ Covered |
| FR-37 | Write-time standards skill | Epic 5 — Story 5.1 | ✓ Covered |
| FR-38 | Axiom-aligned rule set | Epic 5 — Story 5.1 | ✓ Covered |
| FR-39 | Ledger-augmented write-time skill | **Out of v1 scope by design** (post-v1, named for direction in both PRD and epics) | ✓ Consciously excluded |
| FR-40 | Finding dispositions (= DR-1) | Epic 1 — Stories 1.2 (schema) + 1.16 (capture); matures Epic 5 | ✓ Covered |

### Missing Requirements

None. Every v1-scoped FR (FR-1 … FR-38, FR-40) maps to at least one epic and named story. FR-39 is explicitly post-v1 in both the PRD and the epics document — a conscious, documented exclusion, not a gap. Split FRs (FR-3, FR-19, FR-26) declare their split explicitly in the coverage map with forward-only dependencies.

The epics document also carries an NFR coverage map (all 13 NFRs mapped, with SPIKE-1…5 as evidence-bearing gate stories) — stronger than the FR-only bar this step requires.

### Coverage Statistics

- Total PRD FRs: 40
- FRs covered in epics: 39 (+ FR-39 consciously excluded as post-v1)
- Coverage percentage: 100% of v1-scoped requirements

## UX Alignment Assessment

### UX Document Status

**Not found.** No `*ux*` document exists in the planning artifacts.

### Is UX Implied?

Partially — but not in the sense that demands a UX design document:

- The product has **no graphical frontend**: surfaces are a CLI, a Claude Code plugin (conversational/slash-command), and a GitHub Action (PR comment + status checks). The architecture explicitly declares "Frontend architecture: N/A", and the epics document records the same rationale in its UX Design Requirements section ("N/A — no UX Design document exists…").
- The interaction design that does exist (coaching dialogues, curation digest flow, disposition prompts, PR-comment structure, `trends.html` static view) is specified **inside the PRD user journeys (UJ-1…UJ-3) and story acceptance criteria** (e.g., 1.15 disposition prompt, 2.4 reviewable-diff apply flow, 4.6 digest presentation, 5.5 single replacing comment, 5.6 dashboard content).

### Alignment Issues

None found between PRD and Architecture on interaction surfaces: PRD FR-26–FR-30 (surfaces & modes) all trace to architecture decisions (dual-channel output, IDE file-handshake, CI adapter) and to Epic 5 stories.

### Warnings

- ⚠️ **Low:** The one genuinely visual artifact — the `trends.html` longitudinal view (Story 1.16) and the per-axiom dashboard rendering (Story 5.6) — has content requirements but no visual/layout specification. Acceptable for a developer-tool v1 built by its own user; flagged for awareness, not action.

## Epic Quality Review

Validated against create-epics-and-stories standards: user value, epic independence, dependency direction, story sizing, and AC quality.

### Epic Structure

**User value focus** — all five epic goals are phrased as user outcomes ("A developer runs `guardrails init` then `guardrails review` … and gets trustworthy deterministic findings"; "An author validates a story's acceptance criteria before implementation"; "Teams adopt the tool through its three surfaces"). No epic is a bare technical milestone. Epic 1 absorbs the M0 foundation deliberately and says so ("M0 alone has no user value, so foundation and first value ship together") — the right call versus a valueless "Engine Skeleton" epic.

**Epic independence** — passes. Epic 1 is fully standalone (deterministic-only, dogfooding starts there). Epic 2 depends only on Epic 1 (the ADR-001 envelope is *defined* in Epic 1 and *consumed* in Epic 2 — dependency points backward). Epic 3 generalizes Epic 2's transport; Epic 4 uses Epic 3's LLM layer with a standalone deterministic mining core; Epic 5 wraps 1–4 in distribution. No epic requires a later epic. The document states the no-forward-dependency rule as a hard constraint up front and honors it — including the subtle cases (Epic 2's `llm` package ownership split explicitly prevents double-booking with Epic 3; FR-19/FR-26 splits are declared "forward-only").

**Dependency direction within epics** — spot-checked every stated dependency; all point backward: 1.4 (skeleton) precedes 1.8 (`init`) and creates its folder on demand rather than assuming init ran; 1.7 consumes SPIKE-3's (1.5) measured concurrency bound; 1.15 consumes SPIKE-5's (1.14) documented Windows handling; 1.17 folds *earlier* analyzers' fixtures in retroactively ("satisfied backward, not waived"); 2.4/2.6 build on 2.3's transport; 3.4+ are gated by 3.1; 5.6 consumes 1.16's aggregator. No forward references found.

**Artifact/entity creation timing** — compliant with create-when-needed: the walking skeleton creates the minimal artifact folder on demand; full bootstrap arrives with `init` (1.8); the SDD layout addition lands at Story 2.1; the evidence layout at 4.5 — each schema/layout element is introduced by the story that first needs it, with backports to the architecture named at that story.

**Starter template check** — the architecture specifies no off-the-shelf template and names the hand-rolled scaffold as the first implementation story; Story 1.1 is exactly that. Compliant.

### Story Quality

ACs are consistently Given/When/Then, testable, and include failure paths (typed degradation, clean-fixture zero-finding guards, idempotency, `--no-input` non-blocking behavior). Gate stories (SPIKEs) carry quantified pass/fail bars and fail-closed clauses. Traceability is strong: stories cite FRs, NFRs, ODs, and user-journey steps inline.

### Findings

#### 🔴 Critical Violations

None.

#### 🟠 Major Issues

None.

#### 🟡 Minor Concerns

1. **Epic 1 size (19 stories).** Deliberately the largest epic and acknowledged in the document with a fixed internal gate order (scaffold → walking skeleton → scale-out; spikes gate dependents). Not a structural defect — the alternative (a separate M0 epic) would violate user-value rules — but it concentrates schedule risk; sprint planning should treat the internal gate order as hard sequencing.
2. **Story 1.16 is dense.** Scores + trends + dispositions + `trends.html` visualizer + manifest pruning + `--no-input` policy in one story (7 AC blocks). Candidate for a split at sprint planning (e.g., visualizer + pruning as a follow-on story); no dependency problem either way.
3. **Enabler stories 1.1–1.3 have infrastructure-shaped value statements** ("As a maintainer, I want a pnpm-workspaces monorepo…"). Justified: the architecture mandates scaffold-first, and the walking-skeleton pattern requires the contracts/adapter substrate. Flagged only for completeness.
4. **Deferred-at-story-time decisions embedded in ACs.** Two ACs carry explicit "confirm at story time" markers: the `reviews/<scope>/` layout default (1.4/1.15, from the flagged addendum-vs-architecture conflict) and the changed-KLOC floor edge rule (1.16, OD-1 owner). Both have named defaults and owners, so they are decisions-with-defaults, not gaps — but they must actually be confirmed when those stories are picked up.
5. **Story 1.9's "misplaced files per the declared layout"** presupposes a layout declaration for the consuming repo whose source (config? convention?) isn't named in the AC; the fixture oracle constrains it in practice. Clarify at story pickup.

### Remediation Guidance

No remediation required before implementation. Items 1–2 are sprint-planning considerations; items 4–5 are story-pickup confirmations already tagged in the document itself.

## Summary and Recommendations

### Overall Readiness Status

**READY** ✅

### Critical Issues Requiring Immediate Action

None. Zero critical and zero high/major findings across all assessment categories:

- **Document inventory:** complete (PRD + addendum, architecture, epics); no duplicates; UX absence is justified (no graphical frontend).
- **Requirements traceability:** 100% of v1-scoped FRs (39 of 40; FR-39 consciously post-v1) and all 13 NFRs map to epics and named stories, with evidence-bearing spike gates for every quantified NFR claim.
- **Cross-document consistency:** the previously flagged gaps are already closed and verified — FR-40/DR-1 backported to the PRD, OD-6's `severity` + `findingId` present in the architecture's `Finding` schema (verified in this assessment at architecture.md lines 123–124, 512–516, 841–843), all seven open decisions resolved or explicitly deferred (OD-5, post-v1).
- **Epic quality:** user-value framing, clean backward-only dependency graph, BDD acceptance criteria with failure paths, gate semantics (engineering-complete vs gate-validated) defined up front.

### Low-Severity Items (triaged, no pre-implementation action required)

| # | Item | Disposition |
| --- | --- | --- |
| L1 | No visual/layout spec for `trends.html` (1.16) and dashboard rendering (5.6) | Accept for v1 — developer tool, author is first user; revisit if design partners raise it at M3 |
| L2 | Epic 1 size (19 stories) concentrates schedule risk | Track at sprint planning — honor the internal gate order (scaffold → skeleton → scale-out) as hard sequencing |
| L3 | Story 1.16 density (7 AC blocks) | Consider splitting visualizer + manifest pruning into a follow-on story at sprint planning |
| L4 | "Confirm at story time" defaults: `reviews/<scope>/` layout (1.4/1.15), changed-KLOC floor (1.16) | Already tagged in the epics doc with named defaults and owner — confirm when stories are picked up |
| L5 | Story 1.9 "declared layout" source unnamed | Clarify (config vs convention) at story pickup; fixture oracle constrains it meanwhile |

### Recommended Next Steps

1. Proceed to sprint planning (`bmad-sprint-planning`) — Epic 1's internal gate order becomes the sprint sequence.
2. At story pickup for 1.4/1.15/1.16/1.9, confirm the tagged story-time decisions (L4, L5).
3. Optionally split Story 1.16 during sprint planning (L3).

### Final Note

This assessment identified **6 low-severity items across 3 categories** (UX documentation, epic sizing, story-time confirmations) and **no critical or high findings**. The planning artifacts — PRD (40 FRs, 13 NFRs), architecture, and epic breakdown (5 epics, 41 stories) — are aligned, mutually traceable, and implementation-ready.

**Assessed:** 2026-07-04 · **Assessor:** BMad implementation-readiness workflow (autonomous run, all six steps)
