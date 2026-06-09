---
title: 'agentic-guardrails v2 — Product Brief'
status: final
created: '2026-06-01'
updated: '2026-06-10'
---

# Product Brief: agentic-guardrails v2

## Executive Summary

AI agents now write code faster than humans can responsibly review it. On a real team, that gap doesn't stay theoretical — it resolves into rubber-stamped PRs, reviewers who approve code they don't fully understand, and a slow erosion of the oversight that was supposed to keep AI-generated code safe to ship. agentic-guardrails is a review companion built for that gap: a fully open-source (Apache-2.0), local-first verification runtime that checks AI-written code along six axioms — from deterministic structural analysis at zero LLM cost, through spec-grounded Acceptance-Criteria compliance, to conformance against a learned, human-governed model of how *this* codebase already does things. And it engages earlier than review: a standalone shift-left gate validates the spec itself before the first line of code is generated.

**v1 is the complete six-axiom product.** The internal development milestones (M0–M4, per `roadmap.md`) that build toward it are self-standing but are not public releases — M1's deterministic foundation, in particular, exists to be on par with the market before surpassing it, and will be dogfooded privately rather than published. What ships publicly is the whole thesis.

The differentiator is not bug-catching; it is detecting the two failure modes that look fine on a skim: whether the code does what was asked, and whether it fits how this codebase works.

## The Problem

Moving to agentic development creates a review bottleneck that didn't exist before: AI can output code at a pace no human review process was designed to absorb. The lived consequence isn't hypothetical — it's a slow drift toward rubber-stamping. That's not a bug slipping through; that's a reviewer quietly losing the ability to own what they're approving.

The industry data backs the anxiety: AI-authored code carries **1.75× more logic/correctness errors** and **1.57× more security findings** than human-written code (Sonar, State of Code 2026); **96% of developers don't fully trust AI-generated code, yet only 48% always verify it before committing**; and **45% cite "almost right" AI solutions** — code that looks correct but subtly isn't — as their #1 frustration. (Full citations in the [market research](../../research/market-agentic-guardrails-oss-community-research-2026-06-01.md).)

Within that bottleneck, two specific failure modes matter most:

- **Acceptance-Criteria misses** — the code runs, the tests might even pass, but it doesn't do what was actually asked. An illustrative case from the field: a task specified that filter buttons needed a clear "selected" state; AI-generated code either implemented it incorrectly or omitted it outright, and it was only caught through a personal habit of demanding manual-verification steps. The anecdote is illustration, not proof — the proof is the "almost right" statistic above, which is precisely this failure mode at industry scale. Skip the verification step — as most reviewers under volume pressure will — and the gap rides through to QA, or a customer in production.
- **Convention drift** — code that works in isolation but fights how the rest of the codebase already does things: a duplicated pattern, a different idiom, a naming mismatch — the kind of thing a long-time maintainer winces at on sight, and a quick skim never catches. Field evidence from a mature brownfield repo running spec-driven agentic development: **~100% of human-reviewer feedback was consistency-category — not one logic bug** (see the [Axiom #6 session](../../../brainstorming/brainstorming-session-2026-06-06-axiom6.md)). Each instance compounds on the last, and the repo becomes steadily harder to understand — for humans **and** for the AI agents that will work in it next. A codebase that AI itself can no longer parse cleanly is a problem that feeds on itself.

Today, the only real defense against either is a human reading every line — which is exactly the thing agentic development has made impossible to sustain. A standing open question (tracked in Risks below) is quantifying the relative prevalence of these two failure modes beyond the current evidence base; the tool's own ledger will produce that data once dogfooding begins.

## Who This Serves

The primary user is an **individual contributor working on a brownfield codebase** — someone reviewing AI-generated changes against years of accumulated convention, where "does this fit how we do things" is a real, high-stakes question with a long paper trail behind it. This is where the corpus/ledger differentiator has the most to work with: the richer a codebase's history, the sharper the conformance signal becomes. Because v1 ships all six axioms, this user is served by the first public release — not deferred to a later milestone.

Smaller, greenfield teams are a credible secondary fit: the deterministic, zero-LLM-cost tier provides value from day one, even before there's much of a corpus to learn from.

## The Solution

agentic-guardrails is a review companion that meets the developer wherever they choose to engage with it — before a line of code is written (validating the spec itself), *while* the code is being written (the auto-activating standards skill, below), before every commit, once before opening a PR, or via CI once the PR is open. How proactively it's used is entirely up to the developer; the tool doesn't force a single workflow.

When invoked, it produces a **report**: a prioritized rundown of what might be wrong, pointing the reviewer's attention at the handful of things worth a closer look rather than forcing them to hunt through forty changed files. In interactive mode (inside the IDE agent), that report becomes the start of a session — a way to dig into a finding, ask why it was flagged, and refine the picture before deciding what to act on; in CI, the same pipeline runs headless. And because every run's findings are persisted, reports accumulate into a **longitudinal trend** — a picture of whether the codebase's quality (and its conformance to its own conventions) is improving, holding steady, or sliding. Trajectory matters more than absolute state: a codebase improving from 60 is healthier than one sliding from 80, and CI gates can block on regression trajectory, not just thresholds.

### The Six Axioms

The report draws on six verification axioms, woven into a single report rather than siloed:

1. **Structural Verification** — type/syntax/language-level errors. Fully deterministic (AST/compiler); always runs first, costs nothing.
2. **Logic Validity (AC-compliance)** — does the implementation do what the spec asked? LLM-powered but grounded in a validated spec; degrades gracefully (four named tiers) when the spec is absent or weak — a reportable gap, never a silent skip. Also owns **functional test evaluation**: do the tests *prove* the acceptance criteria — meaningful assertions covering happy path, failure, and edge cases — rather than a coverage percentage and `assert(true)`.
3. **Code Cleanliness** — DRY, SRP, structural patterns; hybrid AST + LLM. Also owns semantic-duplication discovery ("does equivalent functionality already exist?").
4. **NFR Verification** — structural performance/reliability signals (complexity, N+1 queries, blocking I/O) plus the non-functional half of test-suite evaluation (load tests, SLA assertions). Test evaluation is deliberately split: functional tests are judged by #2 against the ACs; non-functional tests are judged here.
5. **Security & Isolation** — secrets detection, injection patterns, auth/tenant isolation, dependency CVEs.
6. **Codebase Conformance** — does this change match how things are established to be done in *this* codebase? Powered by the Corpus Map and Conventions Ledger (below).

Two adjacent axioms were identified and deliberately deferred past v1: **#7 Visual Fidelity** (render-level divergence, FE-only, consumes existing visual-regression infra) and **#8 Atomicity** (change-shape/mergeability — deferred because it has no universal default).

All six matter, but two carry the real weight of *why this tool exists*: AC-compliance (#2) and conformance (#6) — the two failure modes that are invisible to a skim.

### SDD as a Runtime Dependency

"SDD" here means **spec-driven development**: the practice in which structured spec artifacts — acceptance criteria, design decisions — precede implementation. agentic-guardrails treats that spec not as documentation but as a **runtime verification contract**: it is schema-validated before use, its acceptance criteria are bound to actual code symbols, and an absent or merely qualitative spec is a detected, reported gap. An interactive coaching loop helps build the spec if one doesn't exist.

**Spec validation is also a standalone, shift-left workflow** — runnable *before implementation begins*, not only as a phase of review. Validating the ACs upfront (quantitative, machine-comparable, unambiguous) improves what the generating agent produces in the first place — prevention at the cost of minutes instead of detection at the cost of a rework cycle — and guarantees the verification contract exists by the time review needs it, dissolving Axiom #2's chicken-and-egg problem by construction. The same artifact is consumed twice: once as a pre-implementation quality gate, once as the review-time reference. The gate is framework-agnostic: any spec can flow through it, whatever methodology produced it.

### Write-Time Enforcement: the Standards Skill

A foundation carried forward from the current product: the **auto-activating `engineering-standards` skill**, which injects the project's standards directly into the AI agent's writing context — proactive enforcement during generation, not reactive review after it. The market research identified this as the single most original element in the Claude Code plugin ecosystem, and it stays foundational in v2. As the Conventions Ledger matures, it becomes this skill's data source: confirmed conventions flow into the writing context, so the loop closes fully — **standards guide generation, the spec gate validates intent, review verifies the result, and what review learns feeds back into generation.**

### Persistent, Team-Owned State

Everything the system learns and produces lives in a git-tracked `_agentic-guardrails/` folder inside the repo — not in a vendor's cloud:

```
_agentic-guardrails/
  sdds/          ← validated spec artifacts (shared, reusable)
  reviews/       ← findings, scoped per context (branch / PR / project / uncommitted)
  corpus/        ← the Corpus Map: what exists, where, how (descriptive)
  conventions/   ← the Conventions Ledger: the rulebook (normative, human-gated)
  config/        ← thresholds, toggles, build strategy (an audit trail of team decisions)
```

This folder is the system's memory: the bridge between interactive sessions and CI, the substrate of the longitudinal ledger, and — critically — a **portable, auditable, team-owned asset** that survives any vendor or tool change.

## What Makes This Different

### The Field, Named

The competitive landscape (full analysis in the market research and its 2026-06-09 addendum):

- **CI/PR-time AI reviewers** — CodeRabbit (2M+ connected repos), Greptile, PR-Agent/Qodo Merge, Kodus (the closest OSS architectural peer: AST + LLM hybrid). All fire at PR time; all paid or cloud-centric at the high end.
- **Longitudinal quality platforms** — SonarQube, CodeScene, Codacy. Track static metrics over time, not spec-grounded or convention-grounded scores.
- **Spec tooling** — GitHub Spec Kit, AWS Kiro. Use the spec to drive *generation*; nobody uses it as the *verification* contract.
- **Convention learning exists** — and the earlier version of this brief overclaimed here. Greptile learns coding standards from your team's PR comments; CodeRabbit learns from repository conventions and prior review conversations; the OSS tool *drift* detects patterns and conventions as AI context. The differentiation is **not** "nobody learns conventions."

### AC-Compliance: Centering the Painful Failure Mode

No competitor does meaningfully better here, and the SDD-as-verification-contract thesis was independently validated by 2026 academic work ("The Specification as Quality Gate," arxiv): without an external reference, the generating and reviewing agents share the same blind spots. The differentiation is placement and rigor: AC-compliance at the center of the report, the spec itself validated before being trusted, AC-to-symbol binding making criteria machine-addressable, and a coaching loop where no spec exists.

The standalone shift-left gate closes a loop nobody else owns end-to-end. Spec tooling (Spec Kit, Kiro) validates nothing — the spec drives generation, fire and forget. Reviewers verify against nothing external — the correlated-failure problem the arxiv paper describes. agentic-guardrails holds both ends: **validated intent in, verified compliance out.** Stated precisely: SDD frameworks do ship their own readiness checklists, so the unclaimed position is a *framework-agnostic, schema-gated, machine-comparable* AC gate as a standalone workflow — not "nobody validates specs."

### Conformance: the Explicit Ledger

What competitors do implicitly — convention learning buried in a vendor's model context — agentic-guardrails makes **explicit, governed, and portable**:

- Conventions are a **versioned artifact in your repo**, human-readable and reviewable, not vendor-side intuition
- Each convention has a **lifecycle with direction-of-travel** (`latent → proposed → confirmed → waning → superseded`) — the system can detect a PR pushing *against* a migration, not just against the current majority pattern
- **Two-axis confidence** (prevalence × intent) distinguishes established patterns from accreted tech debt — high-prevalence/low-intent is tech debt masquerading as convention, not a rule to enforce
- **Enforcement is human-granted and machine-revoked**: only human-confirmed conventions can block, and enforcement decays automatically when the evidence erodes
- **Findings cite a living exemplar** — a real file in the corpus that does it right ("match `corpus://AccountPreferencesPage`"), mirroring how a maintainer mentors rather than how a linter scolds. Only a tool that has mapped the codebase can do this
- **Anti-conventions quarantine one-person idiolects**: existing instances are left alone as known debt, but new code that would *spread* them gets flagged
- **Cost scales with review activity, not repo size**: the cheap structural map is built repo-wide on day one; the expensive learning grows lazily along the frontier of reviewed code (`hot-seed` default) — which is what makes the big-brownfield primary use case affordable

### What the Moat Actually Is

Honest assessment — the moat is *not* the corpus data (any competitor can point a corpus-builder at the same git history). The durable position is:

1. **The artifact posture** — explicit, git-versioned, team-owned conventions vs. implicit vendor-cloud learning. Cloud competitors are structurally disincentivized to copy this: portability undercuts their lock-in.
2. **Counter-positioning on cost** — local-first, free, with a genuinely useful zero-LLM deterministic tier. Per-seat SaaS reviewers ($19–30/dev/month) can't follow without cannibalizing their pricing.
3. **The synthesis** — write-time standards injection + SDD-grounded verification + explicit conformance ledger + finding provenance + trajectory-based trends in one coherent system. Each piece has a neighbor somewhere; the combination has none (market research verdict).
4. **For an OSS project, "moat" is partly the wrong frame** — the durable advantage is being the reference open implementation of an academically validated thesis, with the community that accrues to that position.

This is **not** trying to win on bug-catching or security-scanning — that field is crowded, and modern AI is already reasonably competent there.

## Success Criteria

The underlying goal is **trust in the report** — a reviewer letting it direct their attention and catching things they would have skimmed past. Trust itself isn't directly measurable, so every criterion below is instrumented through the tool's own artifacts (finding dispositions, the ledger, the runs log), each Specific, Measurable, time-bound to a milestone, and guarded against gaming. (Calendar targets are indicative only — the roadmap deliberately sequences by dependency, not dates.)

**M1 — Deterministic foundation (internal, indicative ~3 months out):**
- agentic-guardrails reviews 100% of its own PRs (full dogfooding), at zero LLM cost
- Deterministic pipeline completes in under 60 seconds on a ~1,000-file TypeScript repo
- ≥70% of error-severity findings dispositioned as *actionable* (fixed, or dismissed with a reason other than "false positive") across the first 25 dogfooded runs

**M2 — SDD infrastructure + Axiom #2 (internal, indicative ~6 months out):**
- Across the first 20 dogfooded stories, Axiom #2 surfaces ≥3 genuine AC gaps confirmed by the author — misses that would otherwise have shipped
- 100% of runs report their Axiom #2 degradation tier; zero silent skips
- The standalone spec gate runs on 100% of new dogfooded stories *before* implementation, and ≥1 in 5 runs catches a spec defect (ambiguous, qualitative, or untestable AC) pre-implementation

**M3 — private beta on design-partner repos (indicative ~9 months out):**
- On at least one real brownfield design-partner repo: ≥10 conventions reach `confirmed` within 4 weeks of `init` (defeating the cold-start spiral), and ≥60% of mined `proposed` conventions are accepted by a human (miner precision)
- **The launch-headline benchmark** (extending the existing `tests/EXPECTED.md` oracle): Axiom #6 catches ≥70% of the consistency issues human reviewers historically raised on the design-partner repo — the single number the launch story leads with

**M4 → v1 public launch:**
- Within 3 months of public launch: listed in the Claude Code Plugin Store and awesome-claude-code; ≥200 GitHub stars; ≥3 external repos with a committed `_agentic-guardrails/` folder (visible, durable adoption — not installs)

**The self-evidencing long game, gaming-guarded:** a repo whose Axiom #6 findings trend toward zero is a repo absorbing the tool's guidance — but a declining trend only *counts* when the config audit trail shows thresholds unchanged and the count of confirmed conventions is stable or growing. Findings driven to zero by suppression are visible as exactly that, because config changes and convention demotions are themselves logged artifacts.

## Scope

**v1 — the first public release — is the complete six-axiom product:** deterministic + LLM layers, SDD validation with coaching, the Corpus Map and Conventions Ledger, interactive and CI modes, and the longitudinal ledger. The two things that matter most (#2 and #6) are *in* the thing users first touch.

The milestones beneath it are **development sequencing, not releases** (numbering per `roadmap.md`, the design of record for the build order — deliberately sequenced by dependency, not dates):

| Milestone | Delivers | Published? |
|---|---|---|
| **M0** | Engine skeleton: `LanguageAdapter` (TypeScript) + import/dependency graph, dynamic DAG, Zod state contracts, artifact persistence + ledger substrate, YAML+Zod config | No |
| **M1** | Deterministic axioms: AST/regex layers of #1, #3, #4, #5 + Axiom #6 structural tier (placement/fan-in/zone checks) + `init`; zero LLM cost; dogfooding begins | No — personal dogfooding. Exists to reach parity with the market before surpassing it |
| **M2** | SDD runtime: validation gate, AC-to-symbol binding, coaching loop, Axiom #2 with degradation ladder + FR test audit; spec validation exposed as a standalone pre-implementation workflow | No — internal, self-standing |
| **M3** | Knowledge & LLM layer: Cartographer (Corpus Map), Convention Miner (Ledger) with full lifecycle, Convention Inspector, LLM enrichment of #3/#5/#6 | No — **private beta** on design-partner brownfield repos |
| **M4** | Surfaces & distribution: Claude Code plugin (carrying forward the auto-activating `engineering-standards` write-time skill), GitHub Action with per-axiom status checks, command surface, cost controls (per-agent toggles, input-hash caching, local models via Ollama) | **Yes — this is the v1 launch** |
| *(M5)* | *Post-v1: `LanguageAdapter` public API, Python/Go adapters, `/fix-*` autofix, Axioms #7/#8* | *Post-v1* |

**Language support:** TypeScript first, behind a `LanguageAdapter` abstraction designed for more; Python and Go are next in line (post-v1).

**Explicitly out of v1:** Axiom #7 (Visual Fidelity), Axiom #8 (Atomicity), `/fix-*` autofix commands, languages beyond TypeScript, on-merge warm CI corpus refresh — all sequenced to M5.

A note on Axiom #6's structural tier (in M1): it covers what a map alone can verify with zero learned conventions — **placement-leak** (app logic bleeding into high fan-in shared infrastructure, detected via import-graph fan-in + domain vocabulary) and **placement-layer** (logic-heavy code in zones established as thin, detected via complexity outliers against zone roles). The full detection taxonomy and mechanics belong to the architecture document, not this brief.

## Distribution, Licensing & Sustainability

- **Fully open source under Apache-2.0** (decided 2026-06-10). The explicit patent grant and defensive-termination clause matter in a space crowded with funded competitors, and the explicit contribution terms (§5) give the contributor story legal clarity without a CLA. The legacy prompt-only plugin remains MIT; the v2 runtime is a new work. No commercial tier, no cloud service. Local-first is the product posture, not a freemium hook.
- **Distribution via npm packages** that install AI IDE plugins — Claude Code first, additional surfaces (Cursor, etc.) through the plugin architecture; a GitHub Action for CI. Each surface ships to its native channel (npm, Claude Code plugin marketplace, GitHub Marketplace, docs site).
- **Provider-agnostic LLM layers** — bring your own model, including local models via Ollama at zero per-call cost; the deterministic tier needs none at all.
- **Private beta precedes launch** — design-partner brownfield repos at M3 produce the case-study data and the launch-headline benchmark before anything goes public.
- **Launch checklist** (from the market research and roadmap G2–G3): Claude Code Plugin Store listing, awesome-claude-code submission, and the origin-story launch post ("100% of our human review feedback was 'this doesn't fit the codebase' — not one logic bug") — in that order of leverage.
- **Sustainability is contributors, not revenue:** the `LanguageAdapter` interface and agent-plugin surface are published as public APIs early, deliberately, to invite the community that an OSS project lives on.

## Risks & Open Questions

| Risk | Severity | Mitigation |
|---|---|---|
| **Competitor velocity** — Greptile/CodeRabbit already learn conventions implicitly and could ship an explicit rules surface before v1 lands | High | Narrow, defensible position (explicit + portable + human-governed); publish PRD/architecture publicly to claim the thesis; dogfood M1 fast |
| **Execution complexity for a solo contributor** — 13 agents, dynamic DAG, dual-mode runtime | High | Strict milestone sequencing; deterministic-first; each milestone self-standing and dogfooded before the next |
| **Confirmation cold-start spiral** — nobody confirms conventions → #6 never blocks → "tool does nothing" | Medium | Designed in: day-one structural value with zero confirmations, hot-seed corpus build, curation as a batched digest (never per-review nagging) |
| **Ledger rot** — stale conventions enforce dead patterns and fight migrations | Medium | Designed in: automatic decay (`waning`), hard staleness ceiling with a sane default, loud semantic-staleness surfacing |
| **SDD adoption friction** — Axiom #2 needs a spec many teams don't have | Medium | Coaching loop + four-tier degradation; the tool is useful (5 axioms) with no spec at all |
| **Anthropic ships native equivalents** of the simple commands | Low for v1 | The six-axiom runtime is categorically beyond native slash-command scope |

**Open questions:** (1) Relative prevalence of AC-misses vs. convention drift — currently evidenced by industry statistics plus field observation; the dogfooding ledger will produce first-party data, and prevalence claims should be revisited at M2. (2) Whether `waning`/`superseded` direction-of-travel detection holds up on a real mid-migration repo — flagged for explicit validation during M3 dogfooding.

## Vision

If this works, agentic-guardrails becomes more than a review gate — it becomes a project's **institutional memory of its own code quality**, accumulated automatically over time rather than living in the heads of whoever's been there longest. Three concrete extensions sit on that foundation:

- **Onboarding and refresher mode — for humans and agents** — the same corpus that powers conformance checking doubles as a guided way for a new developer to learn how a project actually works, or for an existing developer to get a precise, granular refresher on a part of the codebase they haven't touched in months. And the same applies to AI agents: a curated, evidence-graded corpus is a higher-quality source for agent context files (CLAUDE.md / agents.md style) than anything generated ad hoc. The corpus becomes the project's knowledge substrate with three consumers — the reviewer, new humans, and new agents. Only an explicit, human-readable artifact model can serve this; implicit vendor-side learning can't be read, exported, or audited. (Flagged as a clearly-wanted future direction, not yet scoped — worth tracking explicitly as the corpus matures.)
- **Multi-language support** — Python and Go adapters following TypeScript, covering the range of stacks real teams actually run.
- **A living quality memory** — the longitudinal ledger isn't just a review byproduct; it's the connective tissue that makes the above possible. The system is already structured to become, over years, a record of how a codebase's quality and conventions evolved — outliving any single reviewer's tenure or memory.

The version of this worth being proud of in 2028 isn't a bigger linter — it's a tool that a long-tenured team member would point to and say "that's how we remember who we are, as the codebase keeps changing under us."
