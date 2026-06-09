---
stepsCompleted: [1, 2, 3, 4]
session_active: false
workflow_completed: true
inputDocuments: ['brainstorming-session-2026-05-31-18-47.md']
session_topic: 'Axiom #6 — Codebase Consistency / Standards Adherence for brownfield projects'
session_goals: 'Define Axiom #6 as a distinct verification concern; design its detection strategy (AST vs LLM), agent role, fit within the existing DAG, and how it captures "would a long-time maintainer say this looks like our code?"'
selected_approach: 'ai-recommended'
techniques_used: ['Assumption Reversal', 'Role Playing', 'Morphological Analysis', 'Pre-mortem']
ideas_generated: [52]
context_file: 'brainstorming-session-2026-05-31-18-47.md (prior 5-axiom framework)'
---

# Brainstorming Session Results

**Facilitator:** Luca
**Date:** 2026-06-06

## Session Overview

**Topic:** Axiom #6 — Codebase Consistency / Standards Adherence for brownfield projects. A proposed sixth verification axiom for the agentic-guardrails runtime, targeting the question "would a long-time maintainer say this looks like our code?" — distinct from cleanliness (#3, universal good-code principles) because it concerns *local* established conventions of a specific mature codebase.

**Goals:**
1. Establish whether #6 is genuinely distinct from existing axioms (esp. #3 Cleanliness) and worth a dedicated agent
2. Design its detection strategy — what is AST-detectable vs. requires LLM corpus comparison
3. Define the agent role, mode, and placement within the existing dynamic DAG
4. Capture the concrete failure categories from field evidence (duplicate pages, naming drift, UI divergence, shared-infra leakage, non-atomic PRs)

### Context Guidance

_Builds directly on the prior session's 5-axiom framework (brainstorming-session-2026-05-31-18-47.md). Field evidence: on a mature brownfield repo running BMAD/SDD, ~100% of human-reviewer feedback was consistency-category — not one logic bug. The need is a review gate that runs BEFORE final human review and targets "fit with the codebase" specifically._

### Session Setup

_New session, prior 5-axiom session kept in context as the foundational frame._

## Technique Selection

**Approach:** AI-Recommended Techniques
**Analysis Context:** Validating and specifying a proposed sixth axiom; needs distinctness proof, tacit-knowledge extraction, then systematic design.

**Recommended Techniques:**

- **Assumption Reversal (Phase 1):** Stress-test the assumption that #6 is a genuinely new axiom by flipping core claims. Establishes the boundary between #3 (universal cleanliness) and #6 (local convention). → Goal 1
- **Role Playing (Phase 2):** Embody the "long-time maintainer" persona whose tacit eye defines the axiom, to surface observable signals behind each consistency failure. → Goal 4
- **Morphological Analysis (Phase 3):** Specify #6 in the same dimensional language used for axioms #1–#5 (failure category × detection method × signal source × DAG placement × mode). → Goals 2 & 3

**AI Rationale:** Three distinct cognitive modes required — challenge (is it real?), extraction (capture the human signal), synthesis (buildable agent spec). Morphological Analysis reused for architectural continuity with the prior 5-axiom session.

---

## Technique 1: Assumption Reversal — Results

**Core outcome:** Axiom #6 validated as distinct and **scoped to "Conformance only"** — *does this change match how things are established to be done in THIS codebase?* Duplication / reuse-awareness explicitly assigned to #3 (with a scope note), powered by shared infrastructure.

### Key reversals tested

1. **"#3 cleanliness already covers fit"** → FALSE. Clean code and consistent code can be in direct tension; the textbook-cleanest change can be the one a maintainer rejects. The real question is whether a pattern's "dirtiness" is *load-bearing* (deliberate design) or accreted (tech debt).
2. **"Consistency = match the dominant pattern"** → FALSE. On a mid-migration brownfield repo, matching the majority can push PRs *backward* into a dying pattern. Conventions have a *direction*, not just a current state.
3. **"#6 is about pattern-matching"** → PARTIALLY FALSE. "Duplicating an existing page" is a *discovery/awareness* problem, not a conformance problem — assigned to #3, not #6.

### Ideas Generated (Phase 1)

**[Distinctness #1 — The Intent-of-Dirtiness Problem]**
*Concept:* #6's central job is classifying *why* an existing pattern is the way it is — accreted tech debt vs. reasoned design — and only letting deliberate patterns constrain new code.
*Novelty:* Inverts the linter stance; the codebase's imperfection becomes a signal to interpret, not a defect to flag.

**[Signal Source #2 — Human-Authored Evidence Trail]**
*Concept:* Reconstruct intent from ADRs, targeted elicitation questions to the user, and archaeology of prior PRs (human-left comments only, filtering bot/agent noise).
*Novelty:* Treats the repo's social history as first-class input; PR comments are tacit-knowledge fossils.

**[Artifact #3 — The Living Conventions Ledger]**
*Concept:* Output discovered conventions to a maintained, human-validated `.md` file that improves across runs.
*Novelty:* Conventions become a versioned, team-owned, reviewable asset rather than hidden model intuition.

**[Breakthrough #4 — `override_cleanliness` Precedence Field]** ⭐
*Concept:* Each convention carries a flag declaring whether local convention or universal clean-code principle wins on collision.
*Novelty:* Explicit, per-convention, auditable conflict-resolution protocol between Axiom #3 and Axiom #6.

**[Scoring #5 — Recency-with-Lifespan Filter]**
*Concept:* Recent conventions take precedence, but only after surviving a minimum lifespan (x months), filtering short-lived experiments.
*Novelty:* Stability is the proof of intent; two-factor gate avoids both staleness and noise.

**[Scoring #6 — Convention Incidence + Trend Score]**
*Concept:* Score each convention's prevalence and trajectory over time; recent + long-lived + incidence-trending-up wins conflicts.
*Novelty:* A migration is literally a convention whose incidence derivative is positive — "which way is forward" becomes a measurable vector.

**[Artifact #7 — `Replaces #X` Supersession Pointer]**
*Concept:* A convention can declare `Replaces: #X`, telling agents to disregard the old one — auto-detected from trends and manually settable to enforce a migration top-down.
*Novelty:* Gives the ledger a temporal graph structure; conventions depose each other and teams can lead migrations by decree.

**[Architecture #8 — The Shared Codebase Corpus Model]** ⭐
*Concept:* Both semantic-duplication detection (#3) and conformance detection (#6) depend on one substrate — a semantic index of the codebase (what exists, where, how it's done). #3 asks "does equivalent functionality already exist?"; #6 asks "what's the established pattern?"
*Novelty:* Duplication and conformance aren't the same axiom — they're two axioms drinking from the same well. Build codebase awareness once, share it.

### Corpus Deep-Dive (extension of Phase 1)

**Two artifacts, not one — normative vs. descriptive:**
- **Conventions Ledger** = the rulebook (normative, "should"). Patterns + precedence. Small, curated, human-sacred, NOT regenerable.
- **Codebase Corpus Map** = the atlas (descriptive, "is"). Location/inventory facts. Large, regenerable, mostly derived.
- Linked by `exemplifies` edges: map entries exhibit ledger conventions; **incidence score = count of map entries exemplifying a convention.** The map is the ledger's evidence base.

**A/B atomic-unit split (confirmed):** patterns ("API routes use `withAuth()`") → **Ledger**; location facts ("user settings live in `features/account/`") → **Corpus Map**.

**Folder layout:**
```
_agentic-guardrails/
  corpus/        ← Corpus Map (atlas)    — Cartographer
    account.md, auth.md, index.md
  conventions/   ← Conventions Ledger    — Convention Miner
    ui-pages.md, api-routes.md, index.md
```

**[Format #9 — Markdown + Frontmatter, Sharded by Tree/Domain]** ⭐
*Concept:* Same `.md`+YAML-frontmatter contract the whole system already uses. Frontmatter = machine-queryable (scores, `override_cleanliness`, `Replaces`, provenance hash); body = human rationale + canonical example. Sharded per area + top-level `index.md`. Tree/diagram = generated *view*, never the editable source of truth.
*Novelty:* Resolves readability-vs-queryability instead of choosing; eats its own dog food (same contract as SDDs/reviews/config). Diagrams don't diff in git; frontmatter does.

**[Agent #10 — Cartographer + Convention Miner]** (superseded/refined by #12, #13)
*Concept:* Cartographer builds the map; Miner derives the ledger from the map; the #6 runtime Conformance Checker is a separate consumer.

**[Validation #11 — Per-Entry Trust State + Reviewable Diffs]**
*Concept:* Every entry has `status: proposed | confirmed | rejected` + provenance (source files + commit). Auto-derived = `proposed` (advisory). Updates arrive as reviewable PR/diffs — never silent auto-mutation.
*Novelty:* Echoes prior "advisory until promoted" (#8) and "changes are reviewable PRs" (#37). Ledger earns trust incrementally.

**[Pipeline #12 — Three Roles, Map ≠ Ledger Ownership]** ⭐
*Concept:* (1) **Cartographer** builds Corpus Map — mostly deterministic (AST entities/paths/symbols) + thin LLM for `purpose`. (2) **Reconciler** = its warm mode (see #13). (3) **Convention Miner** reads the map, clusters patterns, scores incidence/trend, judges deliberate-vs-debt, drafts Ledger — the expensive LLM reasoning.
*Novelty:* The map/ledger boundary IS the deterministic/expensive boundary. Deterministic-only teams get a full map + a manually-authored ledger, zero LLM spend.

**[Principle #13 — One Agent, Two Modes; Delta Source Differs by Layer]** ⭐
*Concept:* "Reconciler" is not a separate agent — it's the Cartographer's *warm mode*. Same for the Miner. Cascade of deltas: code Δ → map Δ → ledger Δ. Cartographer warm = re-map hash-changed files; Miner warm = re-evaluate conventions whose evidence set intersects changed map entries (+ detect new clusters / supersessions). Collapses to **2 maintenance agents** (Cartographer, Miner) + runtime Conformance Checker.
*Novelty:* Each layer's warm mode is triggered by the layer below it; Miner's warm mode is harder (one file can tip a score, birth a cluster, or depose a convention).

**[Confidence #14 — Two-Axis Confidence: Prevalence × Intent]** ⭐
*Concept:* Proposals carry two sub-scores: **Prevalence** (map stats: incidence × recency × trend, "how consistently done?") and **Intent** (human-evidence trail: ADRs, human PR comments, elicited answers, "how deliberate?"). Dangerous quadrant = high-prevalence + low-intent (tech debt masquerading as convention — operationalizes #1).
*Novelty:* Tells the human *what kind* of uncertainty they're resolving, not just "how unsure."

**[Elicitation #15 — Ask Only About the Ambiguous Quadrant]**
*Concept:* Targeted elicitation questions generated *only* for high-prevalence/low-intent conventions. Spends scarce human attention exactly where statistics can't resolve intent.
*Novelty:* Confirms or kills the riskiest proposals first; everything else rides on statistical signal until human review.

**Locked invariant:** Agents never self-confirm. `confirmed` = a human approved it. To be stated explicitly in user documentation (a trust feature for a guardrails product).

---

## Technique 2: Role Playing — Results (in progress)

**Persona "Dev":** 6-year maintainer who *scans* PRs and winces before reasons surface. Method: mine the gut reaction, reverse-engineer the observable signal. Each signal is what the runtime Conformance Checker actually runs on.

### #6 Conformance sub-category taxonomy

| Wince | Sub-category | Observable signal | Detection |
|---|---|---|---|
| Wrong API call pattern | Integration-point conformance | import source / call-site (`axios` vs `apiClient`) | AST/grep (det.) |
| Raw components, not our bricks | Design-system conformance | raw primitive where a project component exists (`<input>` vs `<Toggle>`) | AST + component registry |
| Off-list libs / paradigms | Dependency & paradigm conformance | import of off-list lib; paradigm rare in corpus | AST + corpus stats |
| Naming drift | Naming conformance | casing + structural `<Domain><Type>` | regex/AST (det.) |
| Bespoke logic in generic code | Placement conformance (leak) | high fan-in node + domain vocabulary | import graph (det.) |
| Logic in a thin layer | Placement conformance (layer role) | complexity outlier vs. zone peers | AST + zone roles |

### Ideas Generated (Phase 2)

**[Signal #16 — Author-Spread, not just File-Count]** ⭐
*Concept:* Prevalence must weight distinct human authors, not just file count. One author/one area = personal idiolect; many authors/many areas = team idiom (e.g., 30 FP-style files all by one teammate).
*Novelty:* A convention is social proof, not line count. Refines the Prevalence axis (#14).

**[Ledger #17 — Anti-Conventions / "Contained Idiolect" Entries]** ⭐
*Concept:* Ledger holds "this exists, don't propagate it" entries derived from low-author-spread clusters. New PRs matching one get flagged ("spreading a one-person style"); originals left alone, not fixed. Also tells the #6 agent to watch for fake/deprecated conventions.
*Novelty:* Captures the maintainer's instinct to *quarantine* idiosyncrasies; inverts "more occurrences = more canonical."

**[Map Extension #18 — Architectural Zones with Role Expectations]** ⭐
*Concept:* Map learns each zone's role (thin views, generic lib, domain features) and what's *allowed* there. Placement violation = wrong kind of code for the zone (logic in a thin layer, domain handling in generic code).
*Novelty:* Upgrades map from gazetteer ("what's here") to zoning map ("what's allowed here").

**[Signal #19 — Fan-In as the Shared-Infra Detector]** ⭐
*Concept:* High fan-in (many importers = foundational) + domain vocabulary (tenant names, feature flags, business conditionals) = an app-logic leak into shared infra. Pure import-graph + identifier scan.
*Novelty:* "The more a thing is depended on, the more generic it must stay" becomes a measurable invariant. Deterministic, shift-left.

**[Spin-off Axiom #20 — Axiom #7: Visual Fidelity (optional, FE-only)]** ⭐
*Concept:* The render-only residual of visual consistency becomes its own axiom — earns separation on the same *detection-medium* boundary that split #1–#5. Default-off, FE-only, advisory, post-MVP (humans catch it easily → lower automation ROI). **#6 keeps the source-detectable part** (design-system conformance: components, tokens, spacing props, shared layouts); #7 owns only "bricks correct in source but still looks different at render."
*Novelty:* Same split pattern as duplication — source-detectable stays in the existing axiom; the residual needing a new capability gets isolated.

**[Idea #21 — #7 Consumes Existing Visual-Regression Infra]** ⭐
*Concept:* #7 does NOT pump screenshots into an LLM. It reads diffs from tooling FE teams already run (Chromatic/Percy/Playwright snapshots, computed-style/DOM deltas) and reasons over the structured delta. No infra → axiom stays disabled.
*Novelty:* Dissolves the context/cost-explosion fear — #7 is an integrator of the team's existing visual pipeline, not a generator of vision-LLM calls.

**[Penciled Axiom #22 — Axiom #8: Atomicity / Change-Shape (DEFERRED)]**
*Concept:* "PRs that can't safely merge on their own" (atomicity, revertability, single-purpose). Penciled as a future evolution, **deferred from MVP.**
*Reasoning:* The only proposed axiom with **no universal core** — it evaluates *packaging of work* (process norm), not code content, and varies by team and product lifecycle → can't ship a defensible default → violates the "opinionated defaults" philosophy. Deferral is free: if built, it's a query over the zone model (#18) + fan-in graph (#19) + git diff — no new substrate.

### Axiom landscape after Phase 2

| Axiom | Scope | Status |
|---|---|---|
| #1–#5 | (prior session) structural, logic, cleanliness, NFR, security | Defined |
| **#6 Conformance** | Match established *local* conventions; source-based | **This session — sharply scoped** |
| **#7 Visual Fidelity** | Render-only visual divergence; FE-only, optional, advisory | Spin-off, post-MVP |
| **#8 Atomicity** | Change-shape / mergeability | Penciled, deferred (no universal core) |
| #3 scope note | semantic (functional) duplication added to #3, powered by shared Corpus Map | Carry-forward |

---

## Technique 3: Morphological Analysis — Results (the spec)

### D1 — Agent Roster ✅ LOCKED

**#6 introduces a NEW agent class** — knowledge agents that build persistent, cached, committed artifacts out-of-band, distinct from the prior 10 agents which all ran inside the review DAG.

**Class A — Knowledge agents (build-time, out-of-band):**
| Agent | Owns | Type | Modes |
|---|---|---|---|
| **Cartographer** | Corpus Map (the *is*) | Deterministic + thin LLM (`purpose`) | cold / warm |
| **Convention Miner** | Conventions Ledger (the *should*) | LLM | cold / warm / **interactive elicitation mode** |

**Class B — Review agents (review-time, in the DAG):**
| Agent | Role | Type | Status |
|---|---|---|---|
| **Convention Inspector** | The #6 checker — reads Map + Ledger, judges the change | Hybrid (AST/graph + LLM) | NEW |
| Cleanliness Inspector (#3) | Now also queries the Map for semantic-dup | Hybrid | Existing — extended |
| Trend Aggregator / Report Composer | Pick up #6 automatically | Deterministic | Existing — unchanged |

**Decisions:**
- Elicitation (#15) = a **mode of the Convention Miner**, not a separate agent.
- #6 runtime agent named **Convention Inspector** (pairs with Convention Miner).
- Net: **+3 agents**, +1 agent class, +1 extension (#3 gains Map access).
- **Corpus Map is shared infra** — consumed by both Convention Inspector (#6) and Cleanliness Inspector (#3 semantic-dup). Build once, two consumers.
- Convention Inspector mirrors Cleanliness Inspector's DAG shape (AST/graph in deterministic phase, LLM in enrichment) — no new review topology.

**Lifecycle (cold/warm):**
- **[Guardrail #23 — Never learn conventions from the code under review]** ⭐ Map/Ledger reflect **merged reality only**; warm mode excludes the unmerged diff being reviewed. Otherwise the Inspector learns the PR's deviations as conventions and can't flag them — self-contamination.
- **[Refinement #24 — Warm is hash-gated]** Warm *can* run at review time but only does work on baseline drift (commit/hash check, prior #23). "Runs every review" in principle, near-no-op in practice. Cost scales with codebase change, not review frequency.
- Warm discoveries enter as **`proposed`** (advisory, can be surfaced but cannot block until human-confirmed) — consistent with the locked human-confirm invariant.

### D4 — DAG Placement ✅ LOCKED

**Class A (Knowledge agents) run OUTSIDE the review DAG** — a separate knowledge-maintenance pipeline triggered by: cold at `init`; warm on baseline drift (manual command, review-start check, and/or on-merge CI job).

**Class B (Convention Inspector) slots into the existing 6-phase DAG**, mirroring the Cleanliness Inspector (two-phase hybrid, prior #26):
```
PHASE 0 — Pre-flight  [EXTENDED]
   + Map/Ledger lookup & freshness check (mirrors ValidatedSDD lookup)
   + staleness handling (see #27); records staleness in artifact
PHASE 1 — Parallel deterministic
   ...existing... + Convention Inspector[AST/graph]  (naming, import-source, fan-in leak, design-system registry)
   (Cleanliness Inspector[AST] also queries Map for semantic-dup)
PHASE 2 — SDD resolution gate (unchanged)
PHASE 3 — LLM enrichment
   ...existing... + Convention Inspector[LLM]  (ambiguous conformance, intent alignment vs Ledger)
PHASE 4 — Aggregation → Trend Aggregator (auto-includes #6)
PHASE 5 — Composition → Report Composer (auto-includes #6)
```
Cheap deterministic signals (most of the taxonomy) emit in Phase 1; only the ambiguous residue escalates to LLM in Phase 3. No new review topology.

**Freshness / warm-trigger model:**

**[Idea #25 — `last_included_commit` Watermark]** Both Corpus and Ledger store the commit they reflect. Before every review: compare to `main` HEAD; warm only if `main` moved past the watermark. Cheap gate on all refresh work.

**[Idea #26 — `init` Command]** One bootstrap command provisions folder structure, empty Corpus + Ledger scaffolds, default config/thresholds, and cold-builds corpus + ledger. The day-one entry point.

**[Idea #27 — Stale-Knowledge Prompt (interactive) / Flag (CI)]** ⭐ At review start if stale: *interactive* → prompt "update now (runs cascade) or acknowledge & defer to manual command?"; *CI* → proceed + flag staleness in artifact/PR comment. No config — behavior follows mode.

**Corpus→Ledger refresh cascade:** "update now" = refresh Cartographer (Corpus) first → Ledger now stale vs new Corpus → refresh Miner (Ledger). Not two independent updates; a derived cascade (#13).

**Resolved:**
- **Refresh is review-triggered only for MVP** — no on-merge-to-`main` warm CI job.
- **CI staleness handling is configurable:** `defer | update | update_after: X` (CI has no human for the #27 prompt). Interactive keeps the #27 prompt.

**[Idea #29 — Hard Staleness Limit (forced-refresh ceiling)]** ⭐
*Concept:* Config field = max commits past `last_included_commit` before refresh is **forced, overriding** both the interactive defer choice and the CI setting. Empty → ignored. Keeps Corpus (facts) current regardless; ledger refresh still only yields `proposed` entries (human-confirm gate intact).
*Novelty:* A user can defer convenience, but not correctness — the system refuses to review against knowledge it knows is too stale to trust.

### D2 — Detection Layering ✅ LOCKED

**Principle:** The Ledger is the shared specification *both* layers evaluate against, "compiled" into two execution forms — mechanical conventions → deterministic checks (Phase 1), semantic conventions → LLM evaluation (Phase 3). Both layers run independently, both anchored to the Ledger; Report Composer dedupes overlaps (prior #29).

**[Idea #28 — Ledger Entries Declare Their Own Detection Method]** ⭐
*Concept:* Every convention carries `detection: deterministic | llm | hybrid` + its concrete check. Convention Inspector routes accordingly. Detection layering is data-driven from the Ledger, not hardcoded.
*Novelty:* New convention types added by *declaring* how they're checked — zero agent code change. Same config-over-code ethos as the plugin registry; OSS-extensible.

**Deterministic primitives (Phase 1) — set confirmed complete:**
| Primitive | Catches | Source |
|---|---|---|
| Naming/regex + structural | naming drift, `<Domain><Type>` | AST |
| Import-source rule | `axios` vs `apiClient` | AST |
| Call-site pattern | wrong API usage shape | AST |
| Component-registry match | raw primitive vs project brick | AST + Map |
| Off-list dependency | libs we don't use | manifest + AST |
| Fan-in + domain-token scan | app logic leaking into shared infra | import graph |
| Complexity vs zone-role | logic in a thin layer | AST + Map zones |

**LLM-reserved jobs (Phase 3) — the irreducible residue:**
1. **Exception judgment** — det flags a candidate; LLM decides justified special-case vs. real violation (regex-first + LLM guardrail, prior #18).
2. **Paradigm/style recognition** — e.g. FP-combinator style; not a token match.
3. **Spirit-of conformance + intent** — "does this follow *how* we do X," deliberate-vs-debt read.

### D3 — Data Contracts ✅ LOCKED

**① Corpus Map entry** — `corpus/<domain>.md` frontmatter (descriptive *is*; Cartographer-owned)
```yaml
entity: AccountPreferencesPage
kind: page | component | hook | service | module
path: features/account/AccountPreferences.tsx
purpose: "User-facing account/notification/billing settings"   # thin LLM
public_surface: { route: /account/preferences }
zone: features            # role looked up in zone registry (#18)
fan_in: 3                 # importer count (#19)
authors: [marco, lia]     # author-spread (#16)
exemplifies: [conv-007, conv-012]   # edges INTO ledger; powers incidence
hash: a3f9c1              # per-entry, incremental warm (#13)
status: derived | confirmed | stale | excluded | orphaned   # (#30)
```
Plus **zone registry** + corpus-wide `last_included_commit` (#25) in `corpus/index.md`.

**Corpus Map `status` enum (#30):**
- `derived` — auto-generated, fresh, untouched *(default)*
- `confirmed` — human-validated; **human-edited fields (`purpose`,`zone`) protected from warm overwrite, mechanical facts still auto-update** (field-scoped protection)
- `stale` — code hash changed; re-derivation pending
- `excluded` — out of scope (generated/vendored/fixtures); never feeds conventions
- `orphaned` — entity deleted from code; tombstone awaiting cleanup

**② Conventions Ledger entry** — `conventions/<area>.md` frontmatter (normative *should*; Miner-owned)
```yaml
id: conv-012
kind: convention | anti-convention          # (#17)
sub_category: design-system
pattern: "Pages wrap content in <SettingsLayout>"
detection: { method: deterministic | llm | hybrid, check: "jsx-root == SettingsLayout" }  # (#28)
status: proposed | confirmed | rejected      # human-gated to confirmed (locked invariant)
prevalence: { incidence: 0.94, trend: rising, recency_months: 9, author_spread: 6 }  # (#14,#16)
intent: { score: low|med|high, basis: [...] }  # (#14)
override_cleanliness: true                   # (#4)
replaces: conv-004                           # (#7)
evidence: [adr-014, pr-882#c3, elicit-...]   # refs → evidence store
example: corpus://AccountPreferencesPage
first_seen: 2025-09-01                        # lifespan (#5)
```

**③ Evidence trail** — `conventions/evidence/` (separate referenced store, NOT inlined)
```yaml
id: pr-882#c3
type: pr-comment | adr | elicitation
author: dev-lia          # human-only; bot/agent filtered (#2)
when: 2025-10-12
ref: https://github.com/.../pull/882#discussion_r...
snippet: "Always go through apiClient so retries/auth are centralized."
```

**Linkages close:** `exemplifies` (Map→Ledger) powers `prevalence.incidence`; `authors`→`author_spread`; `fan_in`+`zone`→placement checks; `evidence`→`intent`; `detection`→D2 routing. Evidence separate so one piece can support multiple conventions and ledger stays human-readable.

### D6 — Degradation Ladder ✅ LOCKED

**[Idea #31 — Axiom #6 Degradation Ladder]** ⭐ Mirrors the Axiom #2 ladder — no silent skips, every tier named and visible in artifact frontmatter. The ladder encodes **artifact presence only**; enforcement is governed separately by per-entry status (see #33).

**[Decision #33 — Drop ledger maturity; per-entry `confirmed` is the ONLY gate]** ⭐
*Concept:* The earlier `confirmed_ratio` / `ledger_maturity_threshold` (proposed and then killed) was redundant with the per-entry confirmation gate and, worse, overrode an explicit human decision — refusing to block on a convention a human confirmed, just because its siblings weren't confirmed. Removed. Blocking is per-convention: `confirmed` → eligible to block, `proposed` → advisory. A zero-confirmed ledger blocks on nothing, naturally.
*Novelty:* Separation of concerns — ladder = *what exists*; per-entry status = *enforcement*. They stop overlapping.

| Tier | Condition | Behavior |
|---|---|---|
| **T1 — Full** | Map + Ledger present | All checks run; `confirmed` block, `proposed` advisory (zero-confirmed ⇒ nothing blocks, naturally); anti-conventions per status |
| **T2 — Structural-only** | Map present, **no Ledger** | Only map-derived checks needing no ledger: fan-in leak (#19) + zone-role placement (#18). Advisory. Gives prior "deterministic-only mode" (#21) a #6 story |
| **T3 — Skipped** | **No Map** (`init` never run) | #6 skipped; gap reported; remedy = `init` (#26) |

**Enforcement rule:** "Confirmed conventions always block" = whenever #6 is enabled as `blocking` (axiom-level master toggle `blocking | advisory | off` still governs, per prior config philosophy). Within blocking-enabled #6: `confirmed` block, `proposed` advisory.

**Orthogonal to tiers:** staleness (#27/#29) is a flag, not a tier — a stale-but-present artifact runs at its tier with a staleness flag unless #29 forces refresh. Tier = presence; status = enforcement; staleness = freshness — three independent dials.

### D5 — Execution Modes ✅ LOCKED

**[Idea #32 — #6 Across Interactive vs CI]** ⭐

| Behavior | Interactive | CI / headless |
|---|---|---|
| Staleness handling | Prompt: update now / defer (#27) | Config: `defer \| update \| update_after:X` (GAP-1) |
| Hard staleness limit (#29) | Forces refresh | Forces refresh (overrides config) |
| Miner elicitation (ambiguous-quadrant Qs, #15) | Active — asks the human | Skipped — conventions stay `proposed` |
| Confirmation (`proposed → confirmed`) | Happens here — human promotes | Never — CI cannot confirm |
| Convention Inspector | Runs | Runs (reads cached artifacts) |
| Cartographer `purpose` (thin LLM) | Generated | Generated; templated/skipped in deterministic-only |

**Key consequence (document explicitly):** Confirmation is inherently an *interactive* act. CI consumes confirmations but never creates them → a CI-only team stays at advisory (never reaches confirmed-blocking) until a human runs interactive to confirm conventions. Restates prior "interactive writes artifacts CI reads." Product story: a human confirms conventions occasionally; CI then enforces them.

### D7 — Conflict Resolution ✅ LOCKED

Three conflict types; two already solved earlier:
- **#6-internal** (migration: old vs new convention) → `replaces` supersession (#7) + recency/incidence/trend scoring (#5/#6).
- **det vs LLM, same finding** → Report Composer dedup (#29): merge, strongest severity, `source:[ast,llm]`.
- **#3 ↔ #6 contradiction** → `override_cleanliness` (#34, below).

**[Idea #34 — `override_cleanliness` as bidirectional arbiter, resolved at composition time]** ⭐
*Concept:* The flag cuts both ways:
- `true` (load-bearing convention) → #6 enforces deviations; **#3 findings on conforming code suppressed/downgraded** (e.g., "handlers are intentionally fat" silences #3's split/DRY).
- `false` (cleanliness wins) → #6 does **not** flag cleaner-than-convention deviations; #3 governs (e.g., messy legacy nobody defends — cleaner code is good).

*Resolution pipeline (ordered):* (1) within #6, pick applicable convention via supersession+scoring → (2) apply its `override_cleanliness` to arbitrate #6↔#3 → (3) Composer dedups leftover overlaps.
*Placement:* arbitration runs in the **Report Composer / aggregation stage (Phase 4–5)** — the only place holding all findings. Inspectors emit independently (preserves #29); reconciliation is composition-time. Agents stay decoupled.
*Novelty:* One per-convention boolean resolves the entire #3/#6 tension in both directions, deterministically, at one stage.

**Anti-convention (#17) interaction:** original instances = known/accepted debt → #3 findings on them **downgraded to "known debt"** (not actionable); *new* code matching an anti-convention → **#6 flags** it ("don't spread").

### D8 — Output & Config ✅ LOCKED

**Canonical `sub_category` enum (locked):**
| `sub_category` | Catches | Origin |
|---|---|---|
| `naming` | naming drift | ledger-learned |
| `integration` | API call patterns | ledger-learned |
| `design-system` | raw primitive vs project brick | ledger-learned |
| `dependency` | off-list libs / paradigms | ledger-learned |
| `placement-leak` | app logic in shared infra (#19) | map-derived built-in |
| `placement-layer` | logic in a thin layer (#18) | map-derived built-in |

Four `ledger-learned` (need a Ledger) + two `placement-*` built-in structural (the ones available in **T2 structural-only**). Extensible via plugins; these six are core.

**[Idea #35 — Findings cite a living canonical exemplar]** ⭐
*Concept:* Because #6 has the Corpus Map, every finding points at a real existing instance that does it right ("match `corpus://AccountPreferencesPage`"), not just a rule.
*Novelty:* Only #6 can do this — payoff of mapping the codebase. Conformance feedback becomes exemplar-driven, mirroring how a maintainer mentors.

**[Idea #37 — Exemplar = fix-time context anchor]** ⭐
*Concept:* For the future `/fix-*` agents, `exemplar` is a precise context pointer ("read this one file, mirror it here") instead of a blind codebase search.
*Novelty:* Slashes fix-time context size + LLM cost; turns "find a good example" into a lookup.

**① #6 Finding schema:**
```yaml
axiom: 6
sub_category: design-system        # from locked enum
convention_id: conv-012            # null for T2 structural findings
file: features/billing/BillingPage.tsx
symbol: BillingPage
message: "Page doesn't wrap content in <SettingsLayout>"
source: ast | graph | llm          # provenance (#8)
severity: error | warning | info
enforced_as: blocking | advisory   # derived: convention status × master toggle
exemplar: corpus://AccountPreferencesPage   # (#35/#37)
arbitration: { override_cleanliness: true, suppressed_axes: [3] }   # if applied (#34)
```

**② `quality_scores` block** (artifact frontmatter; Trend Aggregator picks up):
```yaml
axiom_6_conformance:
  tier: 1 | 2 | 3                    # (#31)
  conventions_checked: 41
  violations: { confirmed_blocking: 2, proposed_advisory: 7 }
  by_sub_category: { naming: 1, integration: 0, design-system: 5, dependency: 1, placement-leak: 1, placement-layer: 1 }
  anti_convention_spread: 1         # (#17)
  conformance_rate: 0.93
  ledger_freshness: { commits_behind: 0, stale: false }   # (#25/#27)
```

**③ Config — [Idea #36] YAML validated by one Zod schema (single source of truth)** ⭐
*Refines the prior ".md everything" convention:* narrative/knowledge artifacts (corpus, ledger, evidence, SDDs, reviews) stay `.md`+frontmatter; **machine config moves to schema-validated YAML.** One Zod schema (prior #30/#31) drives: (a) runtime validation, (b) generated JSON Schema (`zod-to-json-schema`) for editor autocomplete/correctness, (c) the interactive `init` questionnaire (walks the schema → config valid by construction). YAML for human-editability, Zod for rigor.

```yaml
# _agentic-guardrails/config/agentic-guardrails.yaml
axiom_6:
  mode: blocking | advisory | off          # master toggle (#10)
  sub_category_toggles: { naming: on, integration: on, design-system: on, dependency: on, placement-leak: on, placement-layer: on }
  staleness: { ci_behavior: defer|update|update_after:X, hard_limit: N }   # (#27/#29)
  scoring: { min_lifespan_months: 3, trend_window_months: 6 }              # (#5/#6)
  # ledger_maturity_threshold — REMOVED (#33)
corpus_build:                              # Cartographer/Miner params
  exclude: [generated/**, vendor/**, "**/*.fixture.*"]   # → status:excluded (#30)
  zones: { features: domain, lib: generic, views: thin }  # zone roles (#18)
  author_spread: { ignore_authors: [dependabot] }         # (#16)
```

---

## ✅ Morphological grid complete — all 8 dimensions locked (D1–D8)

The Axiom #6 spec is fully assembled: 3 new agents + 1 new agent class, 2 shared knowledge artifacts with full schemas, 6-category detection taxonomy (data-driven), DAG placement, freshness model, 3-tier degradation, mode behavior, bidirectional #3↔#6 conflict resolution, and output/config contracts.

---

## Technique 4: Pre-mortem — Results

**Scene:** Dec 2027, 18 months post-ship; #6 is dead/abandoned. Working backward to autopsy causes, then mining each for mitigations to bake in now.

**💀 Cause of death #1 — Confirmation gate became a cold-start death spiral.**
Confirming conventions was tedious, nobody did it, `confirmed_ratio` stayed ~0, #6 never blocked, teams saw a tool that "does nothing" and disabled it. The safety gate starved the system of value. *(Mitigations under exploration — note this is the flip side of the human-confirm invariant; #44/#45 lazy-start + good init UX help; an explicit confirmation workflow/nudges needed — OPEN.)*

**💀 Cause of death #2 — Silent ledger rot turned #6 into a liar.**
Always-defer + `hard_limit` unset → conventions described how code *used to* be written. Migration nightmare realized: ledger enforced the dead pattern, flagged correct new code as violations, fought the migration. Trust snapped. Mitigations:

**[Idea #39 — Asymmetric trust: human-gated promotion, automatic decay]** ⭐ A `confirmed` convention auto-demotes when evidence erodes (incidence/trend/author-spread fall). Doesn't break the human-confirm invariant — that guards *adding* enforcement; decay only *removes* it. **Enforcement revoked automatically, granted only by a human.** Rotting conventions disarm themselves.

**[Idea #40 — Ship `hard_limit` (#29) with a sane default, not empty]** Rot-prevention must be opt-out, not opt-in. **Default = time-based ~14 days** (a sprint), overridable in commits. Rationale: commit-count is velocity-dependent (5 commits = 1 hour on a busy repo); the per-review staleness *check* already fires at ≥1 commit, so `hard_limit` is the egregious-neglect ceiling, not routine cadence.

**[Idea #41 — Surface *semantic* staleness loudly]** Not just "N commits behind" (#25) but "⚠️ 3 conventions waning (incidence −40%)" in PR comment + a **ledger-health score** on the dashboard. Silent rot kills; visible rot gets fixed.

**[Idea #42 — Ledger status enum gains `waning`]** ⭐ `proposed` (consider adopting) | `confirmed` (can block) | `waning` (was confirmed, evidence eroding → auto-demoted, advisory, prompts human to reaffirm/retire) | `rejected` (declined/retired, may seed anti-convention). `confirmed→waning` automatic; escaping waning needs a human. Supersession (`replaces`) folds into `waning` with a `superseded_by` reason (avoid state bloat) — pending confirm.

**💀 Cause of death #3 — Built for big brownfield, too costly to run on big brownfield.**
Cold-start mapped the *entire* codebase + mined *all* conventions up front → hours of compute + heavy LLM cost before the first review. Teams quit at `init`; #6 survived only on greenfield. The motivating use case was the one it couldn't serve. Mitigations:

**[Idea #44 — Lazy / frontier corpus growth — never boil the ocean]** ⭐ Cold-start maps nothing wholesale; Map/Ledger grow along the frontier of *reviewed* code. First review to touch a zone maps it; dead code never gets mapped. Cost scales with what you review, not repo size. Seed hot/recent-churn areas first (prior #28). Converts #6 from greenfield-only to any-size.

**[Idea #45 — Cheap structural map repo-wide, scoped LLM enrichment]** ⭐ Split cost profiles: structural map (paths, fan-in, zones, authors) is cheap AST/graph → affordable repo-wide → **T2 placement checks everywhere on day one**; expensive LLM (`purpose` + convention mining) grows lazily along the frontier. Immediate repo-wide deterministic value, pay for LLM only where active.

**[Idea #46 — `superseded` as a distinct, human-triggered state + reciprocal edge]** ⭐ Status enum: `proposed | confirmed | waning(auto) | superseded(human) | rejected(human)`. Only automatic transition is `→waning`; all others human. `superseded` carries `superseded_by: conv-X` (empty default). Human confirms new conv with `replaces: conv-old` → system sets old conv `status: superseded` + `superseded_by`. `replaces` authored on the new; `superseded_by` derived on the old.

**[Idea #47 — Explicit zone-adjacency graph (aggregated from import graph)]** ⭐ Roll entity→entity edges up to zone level → which zones neighbour/depend on which. Raw data already in the Cartographer's import graph; just materialized. Enables "mine the touched zone **and its neighbours**" — pull exemplars from peer zones for enough signal to infer a convention.

**[Idea #48 — Corpus build strategy configurable]** ⭐ Structural map (#45) always built eagerly (cheap, T2 everywhere). Config governs only the expensive ledger/LLM layer:
```yaml
ledger_build: eager | lazy | hot-seed   # default: hot-seed
```
- `eager` — mine all at init; fast reviews, slow/expensive init. *Greenfield/small.*
- `lazy` — grow per-review along frontier (+ neighbours #47); cheap init, first-touch reviews slower, cost spread. *Huge brownfield.*
- `hot-seed` **(default)** — init mines top-N highest-churn zones, lazy thereafter. Fast init, value where PRs land, long tail spread.
Note: lazy slowdown is **first-touch-only, amortized** (mine on first touch/drift; cheap hash-check + read after).

**💀 Cause of death #4 — The Miner cried wolf until everyone muted it.**
Kept proposing non-conventions (coincidence, one-off copy-paste, abandoned experiments). Every review dumped "is this a convention?" noise; engineers reflex-declined then muted #6. The noise-reducer became the noise source. Two-axis confidence (#14) alone insufficient. Mitigations:

**[Idea #50 — `latent` tier + hard evidence bar before `proposed`]** ⭐ Patterns stay **latent** (internal, invisible) until clearing minimums: incidence ≥ X, **author_spread ≥ 2** (#16), lifespan ≥ min (#5). Noise killed at the source, not triaged after.

**[Idea #51 — Sticky rejections; the Miner learns from "no"]** ⭐ A `rejected` proposal is remembered and never re-proposed; repeated rejections in a sub-category dampen mining sensitivity there. The failure ("we *kept* declining") is a feedback-loop reset bug; fix = rejection is a permanent signal.

**[Idea #52 — Separate convention *curation* from review *feedback*]** ⭐⭐ *(design correction)* Reviews act **only** on `confirmed` (block/advisory) + `waning` (advisory). **`proposed` never appears as a review warning.** Proposal triage lives in a dedicated Miner **digest/elicitation flow** the human visits on their schedule. Earlier we let `proposed` be "surfaced" in reviews — that was the bug. A green, unconfirmed ledger now produces **zero review noise**; cost of a bad mine → ~0 (never reaches a reviewer uninvited).

---

## Pre-mortem — Mitigations Summary

| 💀 Cause of death | Mitigations baked in |
|---|---|
| **#1 Confirmation cold-start death spiral** (nobody confirms → never blocks → "does nothing" → off) | Day-one value **without** any confirmation via structural T2 (#45); `hot-seed` seeds initial conventions to confirm (#48); curation as a low-friction batched **digest** not per-review nagging (#52). #6 is useful before the first confirmation. |
| **#2 Silent ledger rot → tool lies** (stale conventions enforce dead patterns, fight migrations) | **Asymmetric decay** — confirmed auto-demotes as evidence erodes (#39); `waning` state (#42); `hard_limit` ships **default 14 days** (#40); **loud semantic-staleness** surfacing + ledger-health score (#41). Rotting rules disarm themselves and shout. |
| **#3 Too costly on big brownfield** (the motivating use case) | **Cheap structural map repo-wide + scoped LLM** (#45); **lazy frontier growth** (#44) + **zone-adjacency** (#47); **configurable build, `hot-seed` default** (#48). Cost scales with activity, not repo size. |
| **#4 Miner cries wolf → muted** (bad conventions, decline fatigue) | **`latent` tier + hard evidence bar** before `proposed` (#50); **sticky rejections** + sensitivity damping (#51); **curation separated from review** so `proposed` never makes review noise (#52). |

**Net result of the pre-mortem:** four plausible deaths, all with concrete design changes folded back into the spec. The biggest structural corrections were **asymmetric trust dynamics** (#39 — auto-decay, human-promote), **separating curation from review feedback** (#52 — zero noise from unconfirmed conventions), and **cost as a configurable build strategy** (#48 — `hot-seed` default rescues the big-brownfield use case).

---

## Idea Organization and Prioritization

### Thematic Clusters

**Theme 1 — Axiom Identity & Scope** *(what #6 is, and isn't)*
Ideas: #1 (intent-of-dirtiness), Conformance-only scoping, #8 (shared corpus drives the #3/#6 split), #3 scope note (semantic dup → #3), spin-offs #20/#7 (Visual Fidelity, opt-in FE) & #22/#8 (Atomicity, deferred).
*Insight:* #6 = "match established **local** conventions," provably distinct from universal cleanliness; adjacent concerns spun into their own (optional/deferred) axioms rather than bloating #6.

**Theme 2 — The Knowledge Substrate** *(Corpus Map + Ledger)*
Ideas: #3, #8, #9 (md+frontmatter sharded), A/B split (patterns→Ledger, locations→Map), #18 (zones), #19 (fan-in), #47 (zone-adjacency), D3 data contracts, #30 (Map status), #46 (Ledger status enum).
*Insight:* Two artifacts — normative Ledger (the *should*) + descriptive Map (the *is*) — linked by `exemplifies`; the Map's evidence makes the Ledger's scores computable.

**Theme 3 — Convention Intelligence** *(confidence, precedence, lifecycle)*
Ideas: #4 (override_cleanliness), #5 (recency/lifespan), #6 (incidence/trend), #7 (replaces), #14 (two-axis confidence), #16 (author-spread), #17 (anti-conventions), #34 (bidirectional arbitration), #39 (asymmetric decay), #42 (waning), #46 (superseded), #50 (latent tier), #51 (sticky rejections).
*Insight:* A convention is *social proof with a lifecycle* — promotion is human, decay is automatic; quality gated at the source so noise never reaches a human.

**Theme 4 — Detection & Feedback** *(the Convention Inspector)*
Ideas: D2 layering, #28 (ledger-declared detection), 6-category taxonomy, deterministic primitives, LLM-reserved jobs, #35 (exemplar citation), #37 (fix-anchor), finding schema.
*Insight:* The Ledger is "compiled" into deterministic checks + LLM evaluation; most signals are cheap/AST; findings cite a *living exemplar* (unique to #6).

**Theme 5 — Agents, Orchestration & Cost** *(how it runs)*
Ideas: #12 (3 roles), #13 (one-agent/two-modes), D1 (roster + new knowledge-agent class), D4 (DAG placement), #23 (no self-contamination), #24 (hash-gated warm), #25 (watermark), #26 (init), #44 (lazy frontier), #45 (cheap structural), #48 (build strategy).
*Insight:* A new *build-time agent class* (out-of-band knowledge maintenance) feeding a review-time Inspector; cost scales with activity, not repo size.

**Theme 6 — Trust, Modes & Config** *(human-in-the-loop)*
Ideas: #32 (interactive vs CI), human-confirm invariant, #52 (curation ≠ review), #15 (elicitation), #27/#29/#40/#41 (freshness + loud staleness), #31 (degradation ladder), #33 (drop maturity), #36 (YAML+Zod config), #2 (human evidence trail).
*Insight:* Confirmation is an interactive act CI consumes; unconfirmed conventions produce zero review noise; config is schema-validated, single-source-of-truth.

### Prioritization — MVP Tiers

**Tier 1 — MVP Core: the deterministic, LLM-free #6** *(shippable standalone, day-one value)*
- Cartographer **structural map** (import graph, zones, fan-in, authors) — deterministic
- **T2 structural-only checks**: `placement-leak` (#19) + `placement-layer` (#18) — need only the Map
- `init` (#26), Convention Inspector (deterministic primitives), finding schema + `quality_scores` + Report integration
- YAML+Zod config (#36), master toggle, degradation ladder (T1/T2/T3, #31)
- *Directly defuses pre-mortem deaths #1 (value without confirmation) and #3 (cheap on big repos).*

**Tier 2 — MVP Complete: the learned ledger + LLM**
- Convention Miner (cold/warm + elicitation), full Ledger lifecycle (proposed/confirmed/waning/superseded/rejected)
- Two-axis confidence (#14), author-spread (#16), latent tier (#50), human evidence trail (#2)
- Ledger-learned sub-categories (naming/integration/design-system/dependency), `override_cleanliness` arbitration (#34), exemplar citation (#35)
- Human-confirm + **curation digest** (#52), freshness model (#25/#27/#40), `hot-seed` build (#48), asymmetric decay (#39), sticky rejections (#51), anti-conventions (#17)

**Tier 3 — Post-MVP / Hardening**
- Axiom #7 Visual Fidelity (consume visual-regression infra, #21), Axiom #8 Atomicity (penciled)
- `/fix-6` with exemplar fix-anchor (#37), #3 semantic-dup extension (shared Map), zone-adjacency lazy refinements (#47), multi-language adapters, on-merge warm CI job

### Action Plan

1. **Fold Axiom #6 into the PRD** (`bmad-prd`) alongside the existing 5 axioms — acceptance criteria, the Tier-1/2/3 scope, and the #7/#8 spin-offs noted.
2. **Extend the architecture** (`bmad-create-architecture`) — the knowledge-agent class, Corpus Map + Ledger, Convention Inspector in the DAG, build-strategy config. The prior session already pointed here; #6 slots in.
3. **Define the Zod schemas** (single source of truth, #36): Map entry, Ledger entry, Evidence, #6 finding, config.
4. **Spike Tier 1** — deterministic Cartographer (import graph/zones/fan-in) + T2 placement checks — to validate the "day-one structural value" thesis at near-zero cost before investing in the LLM layer.

**Recommended immediate next step:** `bmad-create-architecture` (or fold into the PRD first) — the spec is detailed enough to drive the architecture document directly, exactly as the prior session's output did.

## Session Summary and Insights

**Starting point:** A Slack message — agents catch their own bugs but miss "this doesn't fit the codebase"; ~100% of human review feedback was consistency, not logic.

**Ending point:** A hardened, buildable specification for **Axiom #6 — Codebase Conformance**, plus two discovered adjacent axioms (#7 Visual Fidelity, #8 Atomicity).

**Key breakthroughs:**
1. #6 is distinct from cleanliness because it concerns *local* convention, not universal good code — resolved by the per-convention `override_cleanliness` arbiter (#4/#34).
2. The real question isn't "is this dirty?" but "is this dirtiness *load-bearing*?" — deliberate design vs. accreted debt (#1), made measurable via two-axis confidence (#14).
3. A two-artifact knowledge substrate — normative Ledger + descriptive Map — shared with #3 (#8), built once.
4. **Asymmetric trust dynamics** (#39): enforcement auto-revokes as evidence erodes, but only a human can grant it.
5. **Curation ≠ review** (#52): unconfirmed conventions never make review noise — the antidote to the cry-wolf death.
6. **Cost is a build-strategy choice** (#48, `hot-seed` default): cheap structural value repo-wide on day one; expensive learning grows with activity — rescuing the big-brownfield use case.

**Total ideas generated:** ~52 developed ideas
**Techniques used:** Assumption Reversal · Role Playing · Morphological Analysis · Pre-mortem
**Scope:** Extends the prior session's 5-axiom framework with a fully-specified, pre-mortem-hardened Axiom #6.
