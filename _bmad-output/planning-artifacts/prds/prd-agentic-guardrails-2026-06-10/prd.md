---
title: 'PRD — agentic-guardrails'
status: draft
created: '2026-06-10'
updated: '2026-06-10'
---

# PRD — agentic-guardrails

_Draft in progress — coaching path, Vision + Features entry._

## Vision

AI agents now write code faster than humans can responsibly review it. The result is a quiet drift toward rubber-stamping — and two failure modes that slip through every existing net: code that runs but doesn't do what was asked (acceptance-criteria misses), and code that works but fights how the codebase already does things (convention drift).

**agentic-guardrails is an open-source, local-first verification runtime that checks AI-written code along six axioms — and remembers what it learns.** Its long-term identity is a project's institutional memory of its own code quality: how a team remembers who it is as the codebase changes under it.

Three pillars carry that identity:

1. **The knowledge substrate** — a git-tracked Corpus Map (what exists, where, why) and Conventions Ledger (how we do things here), human-confirmed and team-owned. Conventions are explicit, versioned artifacts the team validates, updates, and confirms — never vendor-side intuition.
2. **AC coaching and refinement** — specs treated as a runtime verification contract. The tool validates intent *before* implementation and verifies the result against quantitative acceptance criteria after, coaching the author toward machine-comparable ACs when none exist.
3. **The longitudinal health view** — the repo's quality story over time. Every run records per-axiom quality scores; the system trends them across runs and surfaces trajectory, because a codebase improving from 60 is healthier than one sliding from 80.

The six-axiom review pipeline is the first application of those pillars, not the product's ceiling.

**What "working" feels like:** the author stops looping through review cycles, because the report tells them exactly what they need to know to improve the code — and nothing else. Trust in the report is the product's core asset, and it is earned through signal quality, provenance on every finding (`ast | regex | llm`), and findings that cite a living exemplar from the team's own codebase — mentorship, not scolding.

### Differentiation

The write-time enforcement argument ("prompts advise, hooks enforce") is already industry consensus; agentic-guardrails differentiates on what gets enforced and who owns the result:

- **Full transparency and control.** Open-source code (Apache-2.0); every output lives in the user's repo as readable, versioned artifacts they validate, update, and confirm. The nearest commercial comparable (Earthly Lunar) offers write-time enforcement as a platform; agentic-guardrails offers it as something you own. And it is free.
- **The two underserved axes.** Security gates and TDD hooks already exist (LaneKeep, TDD Guard); CI review bots already comment (Greptile, CodeRabbit). Nobody enforces *conformance to the codebase's actual conventions* or *acceptance-criteria fidelity* at write time with team-governed state.
- **A genuine zero-LLM tier.** The deterministic layer (AST/regex/graph) delivers value at zero marginal cost — usable from day one, before any corpus exists, before any LLM key is configured.
- **Local-first.** No data leaves the machine unless the user configures an LLM provider; an Ollama escape hatch keeps even that local.

## Who This Serves

**Primary: the individual contributor on a brownfield codebase** reviewing AI-generated changes against years of accumulated convention. The richer the codebase's history, the sharper the conformance signal — which is why v1 explicitly targets large brownfield repos (NFR-13). This person's pain is not "is the code broken" but "did it do what I asked, and does it fit how we do things here" — the two questions no existing tool answers at write time.

**Secondary: small greenfield teams** entering through the free deterministic tier, which delivers value from day one before any corpus exists. They grow into the knowledge substrate as their codebase accumulates history.

## User Journeys

Captured from the author's own narration; protagonists are real users of the dogfooding loop.

### UJ-1 — The spec gate: validating a story before any code exists

Luca, solo maintainer, dogfooding at M2. He has just finished drafting a story with its acceptance criteria.

1. Before any implementation starts, he invokes the standalone spec gate (FR-10).
2. The tool validates AC quality against one bar: every criterion must be **verifiable and quantitative, not qualitative** (FR-9).
3. He gets a report: which ACs fail, why, and **proposed solutions** — concrete rewrites of the failing criteria into machine-comparable form.
4. He can **request the proposed solutions be applied**: the tool rewrites the flagged ACs in the spec document, he reviews and accepts. "Applied" means edits to the spec document only — code autofix remains post-v1.
5. Implementation starts minutes later against a spec Axiom #2 can actually verify. The defect that would have cost a rework cycle cost a few minutes instead.

### UJ-2 — The review loop

Same story, hours later: Claude Code has implemented against the validated spec.

1. **Before every commit**, Luca runs `/review-local` on the uncommitted changes — tight scope, fast feedback, the deterministic tier always on.
2. The report lists findings with provenance (`ast | regex | llm`) and severity; a conformance finding cites a living exemplar from his own corpus — *match `corpus://…`* — so the fix is a pointer, not a lecture.
3. He fixes what's actionable and re-runs; input-hash caching keeps repeat runs near-free.
4. When the branch is done, **one final `/review-branch` (or `/review-pr`) before flipping the PR from draft to ready** — the full pipeline, LLM enrichment included, as the last gate before human eyes.
5. `[ASSUMPTION]` "Ship it" is a run that is either clean or whose remaining findings he has consciously dispositioned — and those dispositions persist in the artifact, feeding the trust metrics.

### UJ-3 — The curation digest

1. On his schedule — never as per-review noise — the digest surfaces conventions the Miner has marked `proposed`.
2. Luca works through the ledger `.md` file itself, marking each entry **accepted or rejected based on his knowledge of the codebase**. The artifact is the interface; nothing stands between him and the decision.
3. With colleagues, the same act becomes collaborative: the ledger is git-tracked, so curation is reviewable as an ordinary PR with team input.
4. Accepted entries become `confirmed` and start carrying enforcement; rejected ones are remembered so mining doesn't re-propose them.

## Features & Functional Requirements

Seven feature groups. A–C are the three pillars; D–G apply and operate them. FR IDs are global and stable.

### A. Knowledge substrate *(pillar)*

The git-tracked, human-governed model of how this codebase works: a descriptive Corpus Map ("what is") and a normative Conventions Ledger ("what should be").

- **FR-1** The system builds and maintains a **Corpus Map**: an inventory of the codebase's entities (pages, components, hooks, services) with location, purpose, zone role, dependency fan-in, and links to the conventions each entity exemplifies. The Map is derived from the code and regenerable.
- **FR-2** The system maintains a **Conventions Ledger**: curated convention entries, each with a detection method, prevalence evidence, intent evidence, lifecycle status, and a flag governing precedence over universal cleanliness rules. Ledger entries are human-owned and never silently regenerated.
- **FR-3** An **`init` command** bootstraps the artifact folder and seeds Map + Ledger using a configurable build strategy (`eager | lazy | hot-seed`); the default (`hot-seed`) mines the highest-churn zones first so large brownfield repos get day-one value at bounded cost.
- **FR-4** A **Convention Miner** proposes candidate conventions from Map evidence, scoring each on prevalence and intent; proposals enter the Ledger as `proposed` and only human confirmation promotes them to `confirmed`.
- **FR-5** Convention curation happens through a **batched digest on the user's schedule** — unconfirmed conventions never appear as review findings or per-review noise.
- **FR-6** Convention trust is **asymmetric**: humans grant enforcement (confirm); the system automatically revokes it as evidence erodes (`waning`, superseded), keeping migrations visible and dead patterns un-enforced.
- **FR-7** Map and Ledger carry a **freshness watermark**; the system detects staleness before every review, prompts in interactive mode (configurable in CI), and enforces a hard staleness ceiling beyond which refresh is forced.
- **FR-8** Ledger entries can link to an **evidence trail** of human-authored sources (ADRs, human PR comments, elicitation answers); bot/agent-generated content is excluded as evidence.

### B. Spec & AC runtime *(pillar)*

Specs as a runtime verification contract, with coaching to get authors there.

- **FR-9** The system validates a Specification & Design Document into a **ValidatedSDD** — a schema-checked artifact whose acceptance criteria are quantitative and machine-comparable.
- **FR-10** A **standalone pre-implementation spec gate** runs before any code is written, catching spec defects at the cost of minutes instead of a rework cycle.
- **FR-11** An **AC elicitation coach** guides the author from a missing or qualitative spec to a ValidatedSDD through dialogue (interactive mode only), including a zero-document path that builds the spec from scratch.
- **FR-12** **Axiom #2 verification** binds each acceptance criterion to code symbols, audits the implementation's logic against the ACs, and audits whether tests actually cover the stated requirements.
- **FR-13** When no usable SDD exists, Axiom #2 **degrades gracefully through declared tiers**; every run reports which tier it ran at — no silent skips, ever.

### C. Longitudinal quality memory *(pillar)*

The repo's quality story over time.

- **FR-14** Every review records **per-axiom quality scores** in the review artifact.
- **FR-15** The system **trends scores across runs** and reports the delta alongside current findings.
- **FR-16** The system produces **longitudinal reports** correlating quality movements over time (e.g., "DRY violations up 40% over three sprints while SDD coverage dropped").
- **FR-17** A **ledger-health view** surfaces semantic staleness in human terms ("3 conventions waning, incidence −40%"), not just commit counts.

### D. Six-axiom review pipeline

The verification engine that consumes the pillars.

- **FR-18** A **deterministic phase** runs axioms #1 (structural), #3 (cleanliness, AST tier), #4 (NFR, structural tier), #5 (security, regex/AST tier), and #6 (conformance, structural tier) in parallel at zero LLM cost.
- **FR-19** An **LLM enrichment phase** deepens #2, #3, #5, and #6 with contextual reasoning; LLM agents run independently and in parallel, and the LLM is never the sole line of defense — every detectable concern has at least one deterministic signal.
- **FR-20** Every finding carries **provenance** (`ast | regex | llm`) and a confidence indicator.
- **FR-21** Overlapping deterministic and LLM findings are **deduplicated** into a single finding preserving both descriptions and the strongest severity.
- **FR-22** Conformance findings **cite a living exemplar** from the team's own codebase (e.g., `corpus://AccountPreferencesPage`) — mentorship, not scolding.
- **FR-23** Each run composes a **review artifact** persisted to the scope-appropriate location in the artifact folder.
- **FR-24** The pipeline is **assembled dynamically** per scope, mode, available artifacts, and configuration, with per-axiom failure isolation — one axiom failing never takes down the run.
- **FR-25** Review **scopes**: uncommitted changes, branch diff, pull request, and full project; remote branches and PRs are reviewed in isolation without disturbing the working tree, with the user choosing the artifact's disposition afterward.

### E. Surfaces & modes

Same runtime, two contexts.

- **FR-26** An **interactive mode** (Claude Code plugin) with the full coaching loops — SDD elicitation, AC remediation, curation digest, staleness prompts.
- **FR-27** A **headless CI mode** (GitHub Action) running the same pipeline with no interactive pauses; anything that would pause resolves by configured policy and is reported as a gap.
- **FR-28** A **command surface**: `/review-local`, `/review-branch [branch?]`, `/review-pr [pr?]`, `/review-project`, `/axiom <N> [--scope]`.
- **FR-29** CI publishes **per-axiom status checks** (blocking axioms = required checks; advisory = informational) and maintains a **single structured PR comment** that replaces its predecessor rather than accumulating.
- **FR-30** A **quality dashboard view** per axiom: violations, severity breakdown, trend delta, link to the full artifact.

### F. Configuration & cost control

The config is an expression of team maturity — maximum flexibility, opinionated defaults.

- **FR-31** A single **YAML configuration**, schema-validated, git-tracked, with editor autocomplete support; every deviation from defaults is explicit and logged, never silently applied.
- **FR-32** **Per-axiom enforcement levels** (`blocking | advisory | off`) with numeric thresholds and regression tolerance; security (#5) defaults to `blocking`.
- **FR-33** **Per-agent controls** in CI: enable/disable, model tier, trigger events.
- **FR-34** A first-class **deterministic-only mode**: zero LLM calls, zero API cost, genuine standalone value.
- **FR-35** **Input-hash caching**: LLM agents skip work when inputs haven't changed.
- **FR-36** **Provider-agnostic LLM layer**: bring your own model, switch providers without touching agent behavior, local models via Ollama.

### G. Write-time enforcement

The existing `engineering-standards` skill carried forward as a foundation — and meaningfully improved, not just ported.

- **FR-37** The v1 plugin ships a **write-time standards skill** that injects engineering standards into the agent's authoring context, scoped precisely to code-writing tasks (description precision is a security boundary).
- **FR-38** The v1 skill **meaningfully improves on the legacy version** along one axis: its rule set is **aligned with the six axioms' vocabulary**, so write-time guidance and review findings speak the same language and an agent steered at write time produces code the reviewer recognizes. The skill remains a **broad, project-generic standards baseline** — deliberately not derived from any one repo's artifacts.
- **FR-39** *(Post-v1, named for direction)* Confirmed Ledger conventions **augment the write-time skill** as a repo-specific layer on top of the generic baseline — detection teaches prevention, without narrowing the baseline's generality.

### Post-v1 (named, not specified)

LanguageAdapter public API with Python/Go adapters; `/fix-*` autofix commands; Axiom #7 (Visual Fidelity) as an integrator of existing visual-regression tooling; Axiom #8 (Atomicity); on-merge warm corpus refresh; threshold presets; non-GitHub CI providers.

## Non-Functional Requirements

Cross-cutting. Performance and cost are not polish here — the zero-LLM tier and local-first posture are headline differentiation, so these NFRs are product claims.

### Performance

- **NFR-1** The deterministic pipeline completes in **under 60 seconds on a ~1,000-file TypeScript repo**.
- **NFR-2** A full review including LLM enrichment on a typical PR-sized diff targets **under 5 minutes**, with 10 minutes as the hard ceiling — fast enough to run per-PR in CI without becoming the long pole. Feasibility of the 5-minute target is validated during dogfooding; the ceiling is non-negotiable.
- **NFR-3** `[ASSUMPTION]` Staleness detection and pre-flight checks add **negligible overhead** (seconds) to review start — freshness checking must never make users disable freshness checking.

### Cost

- **NFR-4** Deterministic-only mode costs **exactly zero** in LLM/API spend — not "cheap," zero — and this remains true at any repo size.
- **NFR-5** LLM spend is **predictable and user-governed**: per-agent toggles, model-tier selection, and input-hash caching mean a re-run on unchanged inputs approaches zero marginal cost. The report surfaces what a run actually cost, so spend is never a surprise.
- **NFR-6** Corpus/Ledger build cost **scales with activity, not repo size** (hot-seed strategy): a large brownfield repo gets structural value on day one at bounded cost.

### Reliability

- **NFR-7** Per-axiom **failure isolation**: one axiom failing never takes down the run; the report states what ran, what didn't, and why.
- **NFR-8** **Zero silent degradation**: every run declares its degradation tier and any skipped agents. Reported absence is a feature; silent absence is a defect.
- **NFR-9** External review isolation **always cleans up** (worktrees removed even on failure) and never corrupts the invoking working tree.

### Privacy & data posture

- **NFR-10** **Local-first**: no code, artifacts, or telemetry leave the machine unless the user explicitly configures an external LLM provider; Ollama keeps even LLM reasoning local.
- **NFR-11** **No telemetry in v1** — not even opt-in usage analytics. Adoption is measured through public signals (stars, installs, committed `_agentic-guardrails/` folders), not phoning home. Post-v1, opt-in telemetry with a published open schema may be revisited if public signals prove insufficient for roadmap decisions.

### Compatibility & scale

- **NFR-12** `[ASSUMPTION]` Runs on **Node.js LTS** across macOS, Linux, and Windows; CI mode runs on standard GitHub-hosted runners with no extra infrastructure.
- **NFR-13** v1 explicitly targets **large brownfield repos** — that is where the corpus and ledger shine, and the hot-seed build strategy exists precisely so size never blocks adoption. Corpus operations remain usable on repos of `[ASSUMPTION]` **10,000+ files** (init time and mining cost scale with activity and selected zones, not raw size); the ~1,000-file figure is a performance benchmark, never a supported-size ceiling. Review scopes are diff-based, so day-to-day review cost is independent of repo size.

## Success Metrics

**The underlying goal is trust in the report** — a reviewer letting it direct their attention and catching things they would have skimmed past. Trust is instrumented through the tool's own artifacts: finding dispositions, the ledger, the runs log. Luca's own bar: *"I don't have to loop multiple times through review cycles, and I'm confident the tool is telling me exactly what I need to know."*

### Milestone gates

- **M1 (deterministic foundation, ~3 months):** agentic-guardrails reviews 100% of its own PRs at zero LLM cost; deterministic pipeline under 60s on a ~1,000-file TypeScript repo; ≥70% of error-severity findings dispositioned as actionable across the first 25 dogfooded runs.
- **M2 (SDD + Axiom #2, ~6 months):** across the first 20 dogfooded stories, Axiom #2 surfaces ≥3 genuine AC gaps confirmed by the author; 100% of runs report their Axiom #2 degradation tier with zero silent skips; the standalone spec gate runs on 100% of new dogfooded stories before implementation, and ≥1 in 5 catches a spec defect pre-implementation.
- **M3 (private beta, ~9 months):** on at least one real brownfield design-partner repo, ≥10 conventions reach `confirmed` within 4 weeks of `init`, and ≥60% of mined `proposed` conventions are accepted by a human. **Launch-headline benchmark:** Axiom #6 catches ≥70% of the consistency issues human reviewers historically raised on that repo.
- **M4 → v1 public launch (+3 months):** listed in the Claude Code Plugin Store and awesome-claude-code; ≥200 GitHub stars; ≥3 external repos with a committed `_agentic-guardrails/` folder — durable adoption, not installs.

### Counter-metrics

The numbers that keep the gates honest — a gate passed while a counter-metric degrades is not a pass:

- **Noise rate** (trust killer #1): the share of error/warning-severity findings dispositioned as *not actionable* must stay below `[ASSUMPTION]` **30%** across dogfooded and design-partner runs — and must not trend upward as axioms are added. A rising noise rate invalidates the actionability gates above it.
- **Time-to-first-value**: on a fresh repo, `init` plus a first review must yield at least one finding the author judges worth acting on within `[ASSUMPTION]` **15 minutes** of installation. If early adopters churn before the corpus earns its keep, the M4 adoption gate measures curiosity, not value.

## Scope & Phasing

**v1 — the first public release — is the complete six-axiom product**: deterministic and LLM layers, SDD validation with coaching, Corpus Map and Conventions Ledger, interactive and CI modes, and the longitudinal ledger. The two capabilities that matter most (#2 AC compliance and #6 conformance) are in the thing users first touch.

Milestones are **sequencing, not releases** — nothing is published before M4:

| Milestone | Delivers | Published? |
|---|---|---|
| **M0** | Engine skeleton: LanguageAdapter (TypeScript) + import graph, dynamic pipeline, state contracts, artifact persistence, config | No |
| **M1** | Deterministic axioms (#1, #3, #4, #5 + #6 structural tier) + `init`; zero LLM; dogfooding begins | No — personal dogfooding |
| **M2** | SDD runtime: validation gate, AC-to-symbol binding, coaching, Axiom #2, standalone pre-implementation spec gate | No — internal, self-standing |
| **M3** | Knowledge & LLM: Cartographer, Convention Miner full lifecycle, LLM enrichment of #3/#5/#6 | No — private beta with design partners |
| **M4** | Surfaces & distribution: Claude Code plugin, GitHub Action, command surface, cost controls | **Yes — v1 launch** |
| **M5** | Post-v1: LanguageAdapter public API, Python/Go, `/fix-*`, Axioms #7/#8, ledger-powered write-time guidance | Post-v1 |

Go-to-market runs as a coupled track: G0 (license, branding, hygiene — parallel with M0–M1), G1 (design partners — unblocked by M3), G2 (publication at M4), G3 (launch content at M4+), G4 (community & ecosystem at M5).

**Out of v1:** Axiom #7 (Visual Fidelity), Axiom #8 (Atomicity), `/fix-*` autofix, languages beyond TypeScript, on-merge warm corpus refresh, non-GitHub CI providers.

**Licensing & sustainability:** Apache-2.0 for the v2 runtime (explicit patent grant, defensive termination); the legacy prompt-only plugin remains MIT. No commercial tier, no cloud service.

## Risks & Open Questions

| Risk | Severity | Mitigation |
|---|---|---|
| **Competitor velocity** — Greptile/CodeRabbit/Earthly Lunar ship explicit, governed rules before v1 lands | High | Narrow, defensible position; publish PRD/architecture; dogfood M1 fast |
| **Execution complexity for a solo contributor** — many agents, dual-mode runtime | High | Strict milestone sequencing; deterministic-first; each milestone self-standing and dogfooded |
| **Confirmation cold-start spiral** — nobody confirms conventions → #6 never blocks → "tool does nothing" | Medium | Day-one structural value with zero confirmations; hot-seed corpus build; curation as batched digest; **counter-metric: time-to-first-value** |
| **Ledger rot** — stale conventions enforce dead patterns, fight migrations | Medium | Automatic decay (`waning`); hard staleness ceiling; loud semantic-staleness surfacing |
| **SDD adoption friction** — Axiom #2 needs a spec many teams lack | Medium | Coaching loop + declared degradation tiers; tool delivers value with no spec at all |
| **Anthropic ships native equivalents** of simple commands | Low | The six-axiom runtime is categorically beyond native slash-command scope |

**Open questions** (carried from the brief, with owners and revisit points):

1. Relative prevalence of AC misses vs. convention drift — currently industry stats + field observation; dogfooding ledger produces first-party data. *Revisit at M2.*
2. Whether `waning`/superseded direction-of-travel detection holds on a real mid-migration repo. *Validate explicitly during M3 design-partner beta.*
