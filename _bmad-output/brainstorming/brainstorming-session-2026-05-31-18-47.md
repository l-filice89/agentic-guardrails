---
stepsCompleted: [1, 2, 3, 4]
session_active: false
workflow_completed: true
ideas_generated: [55]
inputDocuments: ['brainstorming-start.md']
session_topic: 'Agentic-guardrails runtime evolution: micro-agent orchestration engine with deterministic static analysis'
session_goals: 'Design micro-agent topology, deterministic state handoffs, shift-left hybrid verification layer, and OSS extensibility matrix'
selected_approach: 'ai-recommended'
techniques_used: ['First Principles Thinking', 'Morphological Analysis', 'Solution Matrix']
context_file: 'brainstorming-start.md'
---

# Brainstorming Session Results

**Facilitator:** Luca
**Date:** 2026-05-31

## Session Overview

**Topic:** Evolving agentic-guardrails from a prompt-only configuration layer into a programmatic, pluggable Node.js/TypeScript runtime engine — specifically designing the orchestration engine in `core/agents/` coordinating task-specific micro-agents backed by deterministic static analysis from `core/ast/`

**Goals:**
1. Define specialized micro-agent roles and topology for `/review` and `/cleanup` pipelines
2. Design type-safe state machine contracts for deterministic agent-to-agent handoffs
3. Establish the shift-left hybrid verification layer (AST-first, LLM-second)
4. Structure the framework for OSS extensibility via npm-pluggable custom agents

### Context Guidance

_Loaded from `brainstorming-start.md`: Core philosophy is "Shifting Left" engineering verification — deterministic architectural control over prompt-heavy velocity. Baseline directory structure established: `bin/cli.js`, `core/ast/`, `core/agents/`, `plugins/`, `skills/`. LLM vendor decoupling is a hard requirement._

### Session Setup

_Selected approach: AI-Recommended Techniques. Three-phase sequence: First Principles Thinking → Morphological Analysis → Solution Matrix._

## Technique Selection

**Approach:** AI-Recommended Techniques
**Analysis Context:** Multi-agent orchestration runtime design with focus on SDD output alignment to modern engineering standards

**Recommended Techniques:**

- **First Principles Thinking:** Strip away prompt-centric assumptions to establish foundational axioms — what does a review agent *need* independent of any LLM? What are the irreducible truths of modern engineering standards?
- **Morphological Analysis:** Systematically enumerate every design dimension (agent roles, input/output contracts, AST rule types, LLM injection points, plugin interfaces) — prevents tunnel vision and produces the skeleton of the architecture spec.
- **Solution Matrix:** Grid intersecting agent roles × engineering standard categories × detection methods — reveals coverage gaps, over-LLM-dependent areas, and optimal shift-left assignments.

**AI Rationale:** Complex, abstract architectural problem requiring structured depth over creative divergence. Formal technical language → analytical techniques. Multi-phase flow ensures foundational truth before decomposition before synthesis.

---

## Technique 2: Morphological Analysis — Results

### Dimension Map Summary

| # | Dimension | Key Decision |
|---|---|---|
| 1 | Agent Roles | 10 specialized agents |
| 2 | I/O Contracts | Typed + explicit, ValidatedSDD committed to disk, AC-to-symbol binding in SDD |
| 3 | AST Rule Categories | 10 categories, LanguageAdapter abstraction, isolation boundary split from architectural |
| 4 | LLM Injection Points | 6 agents use LLM; IDE-as-runtime interactive, API adapter CI; skills/ = prompt template layer |
| 5 | Orchestration Topology | Dynamic DAG, 5 phases, failure isolation, interactive-only gate for AC Elicitation Coach |
| 6 | State Handoff Format | Zod runtime validation, versioned schemas, dual-channel stream+persist, mode-aware retry |
| 7 | Execution Triggers | 9 triggers, auto-detected execution mode, trigger-to-scope defaults |
| 8 | Plugin Interface | 3 plugin types (surface/language/agent), replacement vs supplement, version-pinned registry |
| 9 | Scan Scope | 3 scopes, branch reconciliation via frontmatter, apples-to-apples trend comparison |

### Agent Roles (Dimension 1)

| Agent | Axiom | Mode | Type |
|---|---|---|---|
| Structural Analyser | #1 | Both | Deterministic |
| SDD Validator | #2 | Both | Regex + LLM guardrail |
| AC Elicitation Coach | #2 | Interactive only | LLM (IDE agent) |
| Logic Auditor | #2 | Both (degradation tiers) | LLM (IDE agent / API) |
| Test Suite Auditor | #2 + #4 | Both | Hybrid |
| Cleanliness Inspector | #3 | Both | Hybrid (AST + LLM independent) |
| NFR Analyser | #4 | Both | Deterministic |
| Security Scanner | #5 | Both | Hybrid (AST/regex + LLM independent) |
| Trend Aggregator | All | Both | Deterministic |
| Report Composer | All | Both | Deterministic (templated) |

### Axiom #2 Degradation Ladder

```
Tier 1 (Full):     ValidatedSDD + explicit AC-to-symbol bindings → full Logic Auditor run
Tier 2 (Inferred): ValidatedSDD + convention inference → partial run, findings advisory
Tier 3 (Partial):  ValidatedSDD exists, no bindings inferrable → AC existence verified only
Tier 4 (Skipped):  No ValidatedSDD → Axiom #2 skipped, gap reported in artifact
```

### Orchestration Topology (Dimension 5)

```
PHASE 0 — Pre-flight (sync)
  Scope resolution, ValidatedSDD lookup, config + agent toggles, DAG construction

PHASE 1 — Parallel deterministic
  Structural Analyser, NFR Analyser, Security Scanner [AST+regex], Cleanliness Inspector [AST], SDD Validator

PHASE 2 — SDD resolution gate (conditional)
  Interactive: AC Elicitation Coach if needed (pipeline pauses)
  CI: Resolves immediately via degradation tier

PHASE 3 — LLM enrichment (parallel, independent full-scope scans)
  Logic Auditor, Test Suite Auditor, Security Scanner [LLM], Cleanliness Inspector [LLM]

PHASE 4 — Aggregation
  Trend Aggregator

PHASE 5 — Composition
  Report Composer → ReviewArtifact written to scoped subfolder
```

### Artifact Folder Structure

```
_agentic-guardrails/
  sdds/                          ← ValidatedSDD artifacts (shared, reusable)
  reviews/
    branch-{name}/               ← pre-PR branch reviews
    pr-{id}/                     ← PR-scoped (reconciles from branch- on PR open)
    project/                     ← full-project snapshots
    uncommitted/                 ← pre-commit (ephemeral)
  config/
    thresholds.md                ← per-axiom thresholds + agent toggles
    llm.md                       ← provider, model, api_key_env
    plugins.md                   ← version-pinned plugin registry
```

### Quality Score Schema

```yaml
quality_scores:
  axiom_1_structural:    { violations: N, severity_breakdown: { error: N, warning: N } }
  axiom_2_logic:         { sdd_quality: 0-100, ac_coverage: 0-1, critical_path_coverage: 0-1, tier: 1-4 }
  axiom_3_cleanliness:   { dry_violations: N, srp_violations: N, complexity_hotspots: N }
  axiom_4_nfr:           { structural_issues: N, nfr_test_coverage: 0-1 }
  axiom_5_security:      { critical: N, high: N, medium: N, low: N, owasp_categories: [] }
  trend:                 improving | stable | regressing
  delta_from_last:       numeric composite delta
  axiom_2_tier:          1 | 2 | 3 | 4
  execution_plan:        [list of agents that ran, which were skipped and why]
```

### Command Surface (MVP)

```
/review-local                     → scope: uncommitted (pre-commit)
/review-branch [branch?]          → scope: branch-diff, defaults to current branch
/review-pr [pr-number?]           → alias for review-branch, resolves via PR API
/review-project                   → scope: full-project
/axiom <N> [--scope]              → single axiom in isolation

Post-MVP:
/fix-local | /fix-branch | /fix-pr | /fix-project  → same scopes + autofix flag
```

### External Review Lifecycle

```
/review-pr 142 (interactive, from any branch):
  1. git worktree add /tmp/agentic-{hash} feature/auth
  2. Full pipeline runs — findings streamed to IDE in real-time
  3. PAUSE → user reviews findings at their own pace
  4. Disposition prompt:
     [1] Commit + push to feature/auth → [skip ci] commit → remove worktree
     [2] Drop → log metadata to ~/.agentic-guardrails/runs.log → remove worktree
     [push fails] → save to /tmp, explain, suggest re-run by PR author
  5. Worktree always removed in finally block

CI (/review-pr or GitHub Actions):
  → Artifacts committed directly to PR branch
  → PR comment posted (replace-not-accumulate, quality dashboard)
  → Per-axiom GitHub status checks posted
  → [skip ci] tag on artifact commits prevents infinite loop
```

### Ideas #11–50 (Morphological Analysis)

**[Idea #11 — Scan Scope as First-Class Input]:** 3 scopes (uncommitted/branch-diff/full-project) as first-class runtime parameters. SDD expectations vary per scope. All three preserved and promoted from current commands.

**[Idea #12 — Scoped Artifact Subfolder Structure]:** Artifact folder organized by report context (branch/PR/project) ensuring apples-to-apples trend comparison. PR reconciles from branch folder via frontmatter pointer.

**[Idea #13 — ValidatedSDD as Committed Shared Artifact]:** Coaching loop runs once per feature. ValidatedSDD committed to sdds/ folder, reused on subsequent runs — a cached artifact, not recomputed.

**[Idea #14 — skills/ as Prompt Template Layer]:** Existing skills/ Markdown files become the systemPrompt source for every LLM call. Versioned in repo, swappable without touching agent code.

**[Idea #15 — Shift-Left Context Compression]:** (Superseded by Idea #29 — LLM runs independently, not restricted to AST candidates)

**[Idea #16 — AC-to-Symbol Binding in ValidatedSDD]:** Every AC carries explicit source_location (file + symbol) and test_refs. Populated during elicitation, validated against AST symbol table. Unbound ACs surfaced as gaps, never silently ignored.

**[Idea #17 — IDE-as-LLM-Runtime Pattern]:** core/ast/ produces structured JSON; IDE agent (Claude/Cursor) consumes it as pre-built context and runs LLM reasoning as skills. CI routes same payload to direct API client. Vendor decoupling at plugin surface.

**[Idea #18 — Regex-First with LLM Guardrail Pattern]:** Two-layer validation — regex handles high-confidence pattern-matchable cases; LLM reviews regex output for edge cases and false-positive reduction. Generalizable pattern across SDD Validator, secret detection, injection surfaces.

**[Idea #19 — Graceful Axiom #2 Degradation Ladder]:** Four operational tiers. No silent failures or skips. Every tier named, logged, and visible in artifact frontmatter.

**[Idea #20 — Interactive-Only Gate]:** AC Elicitation Coach marked interactive: true in agent registry. Orchestrator excludes it at startup in CI — no error, no warning. One flag per agent.

**[Idea #21 — Deterministic-Only Mode]:** First-class CI mode — zero LLM calls, zero API cost. Genuine value from AST layer alone. Starting point for teams not ready to invest in LLM agents.

**[Idea #22 — Per-Agent CI Toggle + Model Tier Selection]:** Each agent independently configured for CI enablement, model tier, and trigger events. Cost profile is a team config decision.

**[Idea #23 — Input Hash Caching]:** LLM agents skip if input hash matches previous run. Cost scales with actual code change, not CI trigger frequency.

**[Idea #24 — Local/Free Escape Hatch via Ollama]:** provider: ollama supported — zero per-call cost. Same agents, same contracts, local model. One config line to switch providers.

**[Idea #25 — Dynamic DAG Construction]:** Execution plan built at startup from scope/mode/artifacts/config. Serialized into artifact frontmatter as execution_plan for auditability.

**[Idea #26 — Internal Two-Phase Agent Pattern]:** Agents with both AST and LLM layers emit partial AST findings immediately, enriched findings when LLM completes. Progressive feedback in IDE.

**[Idea #27 — Failure Isolation]:** Agent failures isolated. failure_mode: skip|degrade|abort per agent. No Phase 1-3 agent has abort status. CVE API timeout doesn't kill the review.

**[Idea #28 — Full-Project LLM Priority Sampling]:** LLM scans top-N files ranked by complexity + change frequency + AC coverage. Configurable max_files threshold. Risk-weighted coverage.

**[Idea #29 — Report Composer Deduplication Strategy]:** AST and LLM run independently. Overlapping findings (same file + line range + axiom, >50% overlap) merged by Report Composer with source: [ast, llm], strongest severity, both descriptions preserved.

**[Idea #30 — Output Schema as Part of the Prompt Contract]:** Expected JSON Schema embedded inline in every IDE agent invocation prompt. LLM self-validates before responding. Orchestrator validates with Zod on receipt.

**[Idea #31 — Versioned Schema Registry]:** core/schemas/ contains Zod definitions versioned by semver. Agents declare schema version they produce. OSS contributors publish schemas to registry.

**[Idea #32 — Dual-Channel Output: Stream + Persist]:** Findings emitted on stream channel (real-time to IDE) and persist channel (complete document to artifact folder). Same schema, different delivery.

**[Idea #33 — Mode-Aware Retry Config]:** Interactive defaults to 1 retry with correction prompt. CI defaults to fail-fast. Both configurable per agent.

**[Idea #34 — Trigger-to-Scope Default Mapping]:** Each trigger carries a default scope declared in plugin config, not hardcoded in core. Adding new triggers requires no core changes.

**[Idea #35 — Execution Mode Auto-Detection]:** Mode inferred from environment signals (CI=true, GITHUB_ACTIONS, TTY absence). --mode flag overrides. Always logs detected mode at startup.

**[Idea #36 — Agent Replacement vs. Supplement]:** Custom agents can supplement (findings merged) or replace (replaces: 'agent_id' in plugin declaration) built-in agents. Replacement requires explicit declaration and logs a warning.

**[Idea #37 — Plugin Registry in Config]:** Active plugins declared in _agentic-guardrails/config/plugins.md as version-pinned npm packages. No magic auto-discovery. Plugin changes are reviewable PRs.

**[Idea #38 — Collapsed Command Surface]:** Three pre-scoped commands replace four. /review-local, /review-branch, /review-project + /axiom N. Config decides what "all axioms" means, not the command name.

**[Idea #39 — Skills as the Agent Layer]:** Every micro-agent is a skill. Commands are thin orchestrator entry points. Users interact only with commands; skills are orchestrator-internal. OSS agents published as skills.

**[Idea #40 — Final MVP Command Surface (revised)]:** /review-local, /review-branch, /review-pr (alias), /review-project, /axiom N. fix-* variants deferred post-MVP as autofix flag.

**[Idea #41 — Option B Fully Explicit Command Naming]:** Clarity over convention. /review-branch + /review-pr as aliases for same DAG, different resolution path (git vs PR API).

**[Idea #42 — git worktree Isolation for Remote Branch/PR Review]:** Worktree spun up at target ref, pipeline runs inside it, worktree always removed in finally block. Current working directory never touched.

**[Idea #43 — Auto-PR Detection]:** /review-pr with no args calls gh pr list --head {current-branch}. Single PR found → proceeds automatically. Multiple/none → prompts or fails with clear message.

**[Idea #44 — Split Read/Write Artifact Paths]:** read_path = worktree's _agentic-guardrails/ (existing state). write_path = invoking context's _agentic-guardrails/ (new artifacts). Paths diverge for external reviews.

**[Idea #45 — Artifact Convergence at Merge]:** Branch and reviewer artifacts converge in main's pr-{id}/ folder at merge. Trend Aggregator sorts by timestamp. Full timeline regardless of who ran the review.

**[Idea #46 — Interactive External Review Disposition Prompt]:** Post-pipeline pause for user choice — commit+push to target branch, or drop. Push failure degrades gracefully to /tmp save. Push uses [skip ci] tag to prevent CI loop.

**[Idea #47 — Disposition as Artifact Metadata]:** Committed reviews logged in artifact frontmatter. Dropped reviews logged to ~/.agentic-guardrails/runs.log — personal history outside the repo.

**[Idea #48 — CI-Only PR Comment with Replace Behaviour]:** One structured PR comment per CI run, replacing previous. Quality dashboard per axiom + critical findings + trend delta + link to full artifact.

**[Idea #49 — Per-Axiom GitHub Status Checks]:** One status check per axiom from CI plugin. blocking axioms = required checks (block merge). advisory axioms = informational checks. Synced with threshold config by design.

**[Idea #50 — Disposition Prompt as Natural Review Window]:** The pause before disposition is intentional review time. Pipeline ends when user is done reading, not when computation finishes. Never time-limited.

---

## Technique 1: First Principles Thinking — Results

### The 5 Axioms (Irreducible Review Requirements)

**[Idea #1 — Three-Tier Verification Hierarchy]**
*Concept:* Every review decomposes into three fundamentally different verification types — Structural (deterministic, AST/compiler), Intentional (requires SDD reference, LLM-powered), and Stylistic/Structural (hybrid: AST for patterns, LLM for intent). These require different agents, different confidence levels, and different execution strategies.
*Novelty:* Maps directly to the shift-left stack — Type 1 always runs first (cheapest, most reliable), Type 3 runs in parallel, Type 2 cannot run without a validated SDD.

---

**Axiom #1 — Structural Verification:** Type/syntax bugs, language-level errors. Fully deterministic — AST / compiler API. No LLM required. Always runs first.

**Axiom #2 — Logic Validity:** Correctness of implementation against a human-authored SDD with quantitative, machine-comparable acceptance criteria. LLM is essential but grounded in the SDD reference. Cannot run without a validated SDD.

**Axiom #3 — Code Cleanliness:** DRY, SRP, small functions, structural patterns. Hybrid — AST catches structural duplication, LLM evaluates semantic intent and SRP violations.

**Axiom #4 — NFR Verification:** Performance, reliability, scalability. Split into structural NFRs (AST-detectable: cyclomatic complexity, N+1 queries, blocking I/O) and runtime NFRs (load tests, SLA assertions — bridged by test suite evaluation).

**Axiom #5 — Security & Isolation:** Secrets detection (regex), injection patterns (AST), auth/tenant isolation (LLM contextual), dependency CVEs (external API). Configurable like all axioms — defaults to `blocking` but overridable.

---

### Key Architectural Decisions from First Principles

**[Idea #2 — SDD as First-Class Runtime Dependency]**
*Concept:* The SDD is not documentation — it is the ground truth reference that makes Axiom #2 possible. If the SDD is missing or qualitative, Axiom #2 collapses. The SDD must contain quantitative, machine-comparable ACs for every piece of logic.
*Novelty:* Reframes design documents from optional artefacts to required runtime inputs with a schema validation gate.

**[Idea #3 — SDD Quality Gate with Coaching Loop]**
*Concept:* When the SDD fails quality validation (qualitative ACs, missing coverage), the system enters a guided remediation loop — agents coach the user toward quantitative ACs through dialogue, not hard errors. Zero-document path: when no SDD exists in interactive mode, the system elicits ACs from user responses and constructs the SDD from scratch.
*Novelty:* Transforms the system from a pure evaluator into a collaborative design partner. The coaching agent is a new agent type — Socratic coach, not reviewer.

**[Idea #4 — Interactive vs. CI Execution Modes]**
*Concept:* Two distinct runtime contexts. Interactive mode (human-initiated): full coaching loop, SDD elicitation, zero-document path available. Automated mode (CI/headless): no interactive loop — SDD missing/invalid → report gap, skip Axiom #2, continue with Axioms 1+3+4+5.
*Novelty:* The same `core/agents/` engine runs in both modes; execution context is declared at startup. Plugin architecture reflects this split — Claude Code plugin = interactive surface, GitHub Actions plugin = CI surface.

**[Idea #5 — Artifact Persistence + Shared State Bridge]**
*Concept:* Every meaningful output (SDDs, review findings, coaching summaries, elicited ACs) is persisted as structured `.md` with YAML frontmatter to `_agentic-guardrails/` (user-configurable). The folder is the shared state bridge between interactive and automated modes — interactive sessions write artifacts that CI reads on the next run.
*Novelty:* Artifacts are not reports — they are runtime inputs for future sessions. The folder is the system's persistent memory, gittrackable and team-owned.

**[Idea #6 — Longitudinal Quality Ledger]**
*Concept:* Every review artifact carries a structured per-axiom `quality_scores` block in YAML frontmatter. The orchestrator reads, diffs, and trends these scores over time. CI evaluates trajectory, not just absolute state — a codebase improving from 60 is healthier than one sliding from 80.
*Novelty:* Transforms a linter-replacement into observability tooling for code quality. Teams see "DRY violations up 40% over three sprints while SDD coverage dropped" — not just "12 violations today."

**[Idea #7 — Per-Axiom Configurable Thresholds]**
*Concept:* Each axiom independently configured as `blocking | advisory | off` with numeric thresholds per metric and regression tolerance (`max_delta`). Config is a versioned artifact in `_agentic-guardrails/` — a team contract, not a tool setting. Overriding a default is always allowed but always explicit and logged.
*Novelty:* Config becomes an audit trail of conscious tradeoffs. The system ships opinionated defaults without locking teams out. Axiom #5 defaults to `blocking` but is fully overridable for projects where security is not yet a priority.

**[Idea #8 — Finding Provenance]**
*Concept:* Every finding carries a `source` field — `ast | regex | llm` — plus a confidence indicator. Developers calibrate trust accordingly. Teams can configure thresholds differently by source — e.g., `ast` findings always blocking, `llm` findings always advisory until manually promoted.
*Novelty:* Most review tools treat all findings as equally authoritative. Provenance metadata makes the confidence model explicit and configurable.

**[Idea #9 — Test Suite Evaluation Split]**
*Concept:* Test evaluation is split across axioms — FR tests belong to Axiom #2 (do they prove the ACs?), NFR tests belong to Axiom #4 (do they cover performance and reliability SLAs?). Significance = quantitative (coverage %) AND qualitative (meaningful assertions, no trivial `assert(true === true)`, critical paths tested for happy path + failure + edge cases).
*Novelty:* Rejects coverage % as the sole quality signal. Assertion density and specificity evaluated alongside execution coverage.

**[Idea #10 — Configuration Philosophy]**
*Concept:* Every axiom ships with a recommended default. Overriding is always allowed but always explicit — the config artifact logs the deviation and the system may emit a visible warning (never a gate). Maximum flexibility with opinionated defaults.
*Novelty:* The config is an expression of team maturity, not a tool constraint. Future team members can audit why thresholds were set, not just what they are.

---

### Project Scope Confirmation

The new architecture is a **complete rework**, not an extension:

| Layer | Current State | New State |
|---|---|---|
| `skills/` | Engineering guidelines | Preserved — becomes LLM context layer |
| `commands/*.md` | Primary execution layer | Demoted to plugin entry points |
| `core/agents/` | Doesn't exist | New: orchestration engine |
| `core/ast/` | Doesn't exist | New: deterministic analysis |
| `plugins/` | Doesn't exist | New: Claude Code, CI, Cursor surfaces |
| `_agentic-guardrails/` | Doesn't exist | New: artifact + ledger persistence |

Current `/review`, `/cleanup`, `/sweep`, `/security-scan` commands survive as thin plugin surfaces over the new runtime.

---

## Idea Organization and Prioritization

### Thematic Clusters

**Theme 1 — Core Verification Architecture** *(Axioms + shift-left detection)*
Ideas: #1 (Three-Tier Hierarchy), Axioms #1–5, #9 (Test Split), #18 (Regex+LLM Pattern), #51 (Observability), #53 (Naming Quality), #54 (A08 AST Signals)
Pattern: Every detectable concern has at least one deterministic signal. LLM is never the only line of defence.

**Theme 2 — SDD as Runtime Dependency** *(The SDD as machine-executable specification)*
Ideas: #2 (SDD as Runtime Dep), #3 (Quality Gate + Coaching), #13 (ValidatedSDD Cached), #16 (AC-to-Symbol Binding), #19 (Degradation Ladder)
Breakthrough: Missing or qualitative SDD is a detectable, reportable gap — not a silent skip.

**Theme 3 — Execution Modes & Pipeline Architecture** *(Dynamic DAG, two contexts)*
Ideas: #4 (Interactive vs CI), #17 (IDE-as-LLM-Runtime), #20 (Interactive-Only Gate), #25 (Dynamic DAG), #26 (Two-Phase Agent), #27 (Failure Isolation), #33 (Mode-Aware Retry), #35 (Auto-Detection)
Breakthrough: `core/ast/` is Node.js. LLM reasoning runs inside the IDE as skills. CI routes to direct API adapter. Same agents, different runtime.

**Theme 4 — Artifact & Quality Ledger System** *(The persistent memory of the system)*
Ideas: #5 (Artifact Persistence), #6 (Longitudinal Ledger), #7 (Per-Axiom Thresholds), #10 (Config Philosophy), #12 (Scoped Subfolders), #44 (Split Read/Write), #45 (Convergence at Merge), #47 (Disposition Metadata)
Breakthrough: The artifact folder is a versioned quality ledger — closer to observability tooling than a linter output.

**Theme 5 — CI/CD & Cost Management** *(Economically viable at scale)*
Ideas: #21 (Det-Only Mode), #22 (Per-Agent Toggle), #23 (Hash Caching), #24 (Ollama), #48 (CI PR Comment), #49 (Status Checks)
Pattern: Teams start free (deterministic-only), invest incrementally in LLM depth.

**Theme 6 — Agent & State Contract Design** *(Type-safe execution, no prompt drift)*
Ideas: #8 (Finding Provenance), #14 (skills/ as Templates), #28 (Priority Sampling), #29 (Deduplication), #30 (Output Schema in Prompt), #31 (Schema Registry), #32 (Dual-Channel Output)
Breakthrough: Every agent handoff is typed, validated, and versioned. Contract violations caught at the boundary, not downstream.

**Theme 7 — Command Surface & Developer UX** *(Three commands, ten-agent DAG)*
Ideas: #34 (Trigger-Scope Map), #38 (Collapsed Surface), #39 (Skills as Agent Layer), #41 (Option B Naming), #42 (Worktree Isolation), #43 (Auto-PR Detection), #46 (Disposition Prompt), #50 (Review Window)
Pattern: Commands are scope aliases. Users see `/review-local`, `/review-branch`, `/review-pr`, `/review-project`. Orchestrator sees the full DAG.

**Theme 8 — OSS Extensibility** *(Plugin surface for community and enterprise)*
Ideas: #36 (Replace vs Supplement), #37 (Plugin Registry), #55 (Threshold Presets), LanguageAdapter interface
Pattern: Core is scope-agnostic and language-agnostic. Everything domain-specific lives in plugins.

---

### Prioritization

**Tier 1 — MVP Core**
Themes 1, 2, 3, 4 — 5-axiom framework, SDD runtime dependency, dynamic DAG, artifact + ledger system

**Tier 2 — MVP Complete**
Themes 5, 6, 7 — CI cost management, state contracts, command surface

**Tier 3 — Post-MVP**
Theme 8 full extensibility, `/fix-*` commands, multi-language adapters, threshold presets

---

### Action Plans

**Tier 1 Actions:**
1. Run `bmad-create-prd` — formalize 5-axiom framework into PRD with acceptance criteria
2. Run `bmad-create-architecture` — design `core/ast/` LanguageAdapter + `core/agents/` DAG + artifact schema
3. Define `ValidatedSDD` schema — AC structure, source_location, test_refs, quality scoring

**Tier 2 Actions:**
1. Define Zod schemas for all 10 agent output types in `core/schemas/`
2. Design GitHub Actions plugin — trigger, API adapter, PR comment, status checks
3. Design Claude Code plugin — skill wiring, worktree lifecycle, disposition prompt
4. Implement 4 MVP commands as Claude Code slash commands
5. Write `_agentic-guardrails/config/` schema

**Tier 3 Actions:**
1. Publish `LanguageAdapter` interface as public API
2. Implement Python language adapter
3. Implement `/fix-*` command variants
4. Create starter threshold presets

**Recommended immediate next step:** `bmad-create-architecture` — session output is detailed enough to drive a full architecture document directly.

---

## Session Summary and Insights

**Starting point:** A collection of 4 Markdown-driven prompt-only slash commands for local CLI code review.

**Ending point:** A fully specified architecture for a programmatic, pluggable Node.js/TypeScript runtime with:
- 5-axiom verification framework with explicit shift-left detection strategies
- SDD as a machine-executable runtime dependency with coaching and elicitation
- 10 specialized micro-agents orchestrated by a dynamic DAG
- Longitudinal quality ledger with per-axiom configurable thresholds
- Dual execution mode (interactive IDE + headless CI) with cost-management controls
- Type-safe state contracts with versioned schemas and Zod validation
- 4 clearly named commands over a 10-agent pipeline
- OSS plugin surface for language adapters, custom agents, and threshold presets

**Key breakthroughs:**
1. The SDD is not documentation — it is a runtime input with a schema validation gate
2. LLM runs inside the IDE (interactive) or via direct API (CI) — `core/` is purely deterministic Node.js
3. The artifact folder is a quality ledger comparable to observability tooling, not a report archive
4. Trajectory matters more than absolute scores — a codebase improving from 60 is healthier than one sliding from 80
5. Every axiom is configurable including security — maximum flexibility with opinionated defaults
6. The disposition prompt is both a user choice gate and a natural review window

**Total ideas generated:** 55
**Techniques used:** First Principles Thinking, Morphological Analysis, Solution Matrix
**Session duration:** Extended multi-session deep dive
**Scope confirmed:** Complete architecture rework — current commands become thin plugin surfaces
