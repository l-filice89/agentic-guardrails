---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-06-28'
inputDocuments:
  - '_bmad-output/planning-artifacts/prds/prd-agentic-guardrails-2026-06-10/prd.md'
  - '_bmad-output/planning-artifacts/prds/prd-agentic-guardrails-2026-06-10/addendum.md'
  - '_bmad-output/planning-artifacts/briefs/brief-agentic-guardrails-2026-06-01/brief.md'
  - 'roadmap.md'
  - '_bmad-output/brainstorming/brainstorming-session-2026-05-31-18-47.md'
  - '_bmad-output/brainstorming/brainstorming-session-2026-06-06-axiom6.md'
  - '_bmad-output/project-context.md'
workflowType: 'architecture'
project_name: 'agentic-guardrails'
user_name: 'Luca'
date: '2026-06-18'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Irreducible Core

This tool exists to catch the two failures a human reviewer cannot see by skimming
AI-written code: (a) the diff does not actually satisfy its stated acceptance criteria
(AC-miss), and (b) the diff silently violates the conventions of the codebase it joins
(convention drift). **Every component must justify itself against that sentence or be cut.**
The deterministic tier (#1 structural, #3 cleanliness, #4 NFR, #5 security, and #6's
structural tier) is the table stakes that earns trust; #2 and #6's judgment tier are why
the tool exists.

### Requirements Overview

**Functional Requirements:** 40 FRs across 7 groups (FR-40 dispositions added 2026-07-03, backported from the epic breakdown's DR-1). Three are pillars —
(A) Knowledge substrate: git-tracked Corpus Map + Conventions Ledger, human-governed
(FR-1–8); (B) Spec & AC runtime: SDD-as-verification-contract with coaching and a
standalone pre-implementation gate (FR-9–13); (C) Longitudinal quality memory (FR-14–17, FR-40).
Four apply/operate them — (D) six-axiom review pipeline (FR-18–25); (E) surfaces & modes
(FR-26–30); (F) configuration & cost control (FR-31–36); (G) write-time
`engineering-standards` skill, carried forward and axiom-aligned (FR-37–39).

Architecturally the FRs collapse into four subsystems: a deterministic analysis core
(import graph + LanguageAdapter), a review-time orchestrator, an out-of-band
knowledge-maintenance pipeline, and a persistent artifact/ledger substrate.

**The unit of composition in the deterministic core is a pure analyzer —
`(change, context) → findings` — not an "agent." "Agent" is reserved strictly for units
that invoke an LLM.** The "13 agents" from the brainstorming sessions is a **logical
taxonomy of distinct review responsibilities, not a count of separately-deployed units**:
in the M1 deterministic tier most are pure functions in a shared analyzer library.
Promotion to an independently-orchestrated unit requires specific justification — real
concurrency need, an independent lifecycle, or an LLM-judgment boundary.

**Canonical taxonomy = six axioms, not thirteen agents.** The FR-backed unit of review
responsibility is the **axiom**: #1 structural, #2 AC-compliance, #3 cleanliness, #4 NFR,
#5 security, #6 conformance. Each axiom is realized across two phases per FR-18/19 — a
deterministic analyzer (#1/#3/#4/#5/#6) and, where applicable, an LLM enrichment agent
(#2/#3/#5/#6) — which is why one axiom can have both a `core/analyzers` analyzer and an
`llm/agents` agent. The "13 agents" is the earlier brainstorming framing; **where the two
differ, the six-axiom / FR-18–25 mapping governs.** Analyzer/agent unit counts are an
implementation detail beneath the axiom, never a competing taxonomy.

**Non-Functional Requirements:** 13 NFRs that function as product claims, not tuning
targets. Headline drivers: deterministic <60s on ~1,000 files and zero-LLM-cost at any
size (NFR-1, 4); full review <5min target / 10min hard ceiling (NFR-2); local-first,
zero telemetry (NFR-10, 11); corpus cost scales with activity not repo size on 10,000+-file
repos (NFR-6, 13); per-axiom failure isolation and zero silent degradation (NFR-7, 8);
Node.js LTS cross-platform incl. Windows (NFR-12).

### Scale & Complexity

- Primary domain: local-first developer-tooling runtime (static-analysis engine +
  LLM-agent orchestrator), shipped as npm packages + Claude Code plugin + GitHub Action.
- Complexity level: **High** — six-axiom pipeline, dual-mode (interactive/CI) runtime,
  two-artifact knowledge substrate, solo contributor. Self-identified as a top risk
  (PRD: "Execution complexity for a solo contributor", severity High); mitigated by
  dependency-sequenced milestones (M0–M5), each self-standing and dogfooded.
  **Stated honestly: milestone sequencing changes the *order* of the work, not its *total
  volume*** — five packages, dual transport, a governed knowledge substrate, longitudinal
  store, and three distribution surfaces remain one person's build. The architecture's defense
  is that **each milestone delivers standalone value** (M1 deterministic tier is shippable and
  useful with none of the LLM/knowledge layer), so the scope can be *halted* at any milestone
  boundary without stranding a half-built system — the volume risk is real and is managed by
  making early exit non-catastrophic, not by pretending the scope is small.
- Estimated architectural components: ~4 subsystems + 3 distribution surfaces (CLI, plugin,
  Action) + 1 config plane.

### Orchestration Shape (corrected altitude)

The review pipeline is a **static six-phase pipeline with dynamic per-phase node
membership** — NOT a general dynamic-DAG engine. Phases 0→5 are fixed; only the set of
analyzers/agents registered within Phases 1 and 3 varies by scope/mode/artifacts/config.
At M1 (deterministic-only) the shape reduces to: build shared structures (AST +
import/dependency graph) → parallel `map` of independent analyzers → reduce findings →
human gate. "DAG" terminology is reserved for the LLM tier (M3+), where data-dependent
ordering genuinely appears. This naming prevents reaching for a graph-orchestration library
the project does not need.

### Technical Constraints & Dependencies

- **Hard vendor-decoupling, made testable:** `core/` (and a shared `contracts` package) carry
  zero LLM dependencies — enforced by a forbidden-import lint rule + dependency check in CI,
  not just intent. LLM reasoning runs in the IDE (interactive) or a direct API adapter (CI).
- **Zod is the single source of truth:** state contracts (semver-versioned, agent-declared)
  AND config (YAML → runtime validation → generated JSON Schema → `init` questionnaire), living
  in a standalone pure-Zod `contracts` package imported by core/adapters/LLM layer alike.
- **LanguageAdapter abstraction**, TypeScript first (ts-morph leaning); the import/dependency
  graph is the most-leveraged shared component AND the highest correctness risk (path aliases,
  barrel files, re-exports, dynamic imports) — golden-fixture tests are an M1 deliverable.
- **Cross-platform incl. Windows** — git worktree isolation lifecycle and path handling must
  hold on Windows (the dev environment itself).
- **Milestone sequencing is a design constraint:** M1 (deterministic-only) must ship valuable
  with none of the LLM/knowledge layer present. Repo layout (monorepo/pnpm-workspaces) and the
  shared-contracts boundary must be decided in M1 — package boundaries are expensive to re-pour.

### Cross-Cutting Concerns Identified

- **Finding provenance + tier is first-class M0 data, not a feature:** every finding carries
  tier (`deterministic | inferred`), source (`ast|regex|llm`), severity (`error|warning|info`),
  a stable symbol-anchored `findingId`, confidence, and the exemplar it
  was judged against. CI gates on the deterministic tier by default; inferred findings advise.
- **Zero silent degradation as an operational contract, not a slogan:** a `pass` requires
  positive evidence, never mere absence of error. Every run declares its degradation tier.
  **Where it surfaces (a contract needs an output channel):** the machine-readable record is the
  **run manifest** (degradation tier + per-axiom `degraded[]`/`inconclusive` with typed reasons); the
  human-readable surfaces render the same data — the **review artifact** and **CLI summary** open with
  a "what ran / what didn't / why" block, and CI's **single structured PR comment** plus **per-axiom
  status checks** (FR-29) show each axiom's tier and any skip reason. An axiom that degraded is never
  merely absent from the output; absence-as-reported is the feature (NFR-8).
- **Substrate resilience beyond per-axiom isolation.** The real single points of failure live
  *upstream* of the axioms, in shared substrate: (1) the import/dependency graph (a Phase-0 join
  point feeding four axioms + the Cartographer), (2) the Corpus Map + Conventions Ledger,
  (3) the git-tracked artifact/longitudinal ledger. Required guarantees:
  - **Partial-result contracts** on all shared upstream reads: `{ data, coverage/provenance,
    degraded[] }`. A consumer below a coverage/validity threshold returns `inconclusive`.
  - **Atomic, validated, provenance-stamped writes** (temp → fsync → atomic rename; append-only
    where possible; read-repair discards a torn trailing record). The Trend Aggregator
    validate-before-trusts and cold-starts on invalid history rather than trusting a baseline —
    closing the silent longitudinal-poison class.
  - **Out-of-band means non-blocking, period:** freshness/warm-refresh and any LLM knowledge
    agent never sit on the deterministic critical path; the run uses last-known-good and reports
    the Map version/age it used. **The FR-7 hard staleness ceiling does not break this invariant:**
    beyond the ceiling the run neither blocks on an inline refresh nor silently uses stale data —
    corpus-dependent axioms (#6, and #2's exemplar citations) degrade to `inconclusive`
    (`reason: stale_corpus`) while corpus-independent axioms run normally; interactive mode prompts
    the human to refresh (FR-7), CI resolves by the configured staleness policy
    (`defer | update | update_after:X`, per addendum). The ceiling forces a *surfaced choice*,
    never a blocking refresh and never silent staleness.
  - **Bounded LLM retry + per-phase time budget:** `safeParse`; retry budgets are **mode-scoped —
    defaults per ADR-001: interactive = 1 correction retry + 1 repair, CI = fail-fast — with
    ≤2 retries + 1 repair as the hard cap in any mode**, then a typed `degraded` result; the
    10-min ceiling degrades to partials, it is never the failure.
- **Runtime parity is a named risk, not an assumption.** Invariant: the IDE and headless
  runtimes must produce equivalent axiom verdicts. Mechanism: a **run manifest** (ledger hash,
  corpus hash, ruleset version, tier-enablement, engine version, and LLM model identity) emitted by
  both and comparable;
  a parity test fixture as an acceptance gate. Promise *accountable*, not *identical*.
- **Cold-start / time-to-first-value is a first-class risk.** The human-confirm invariant
  (sacred — agents never self-confirm; enforcement is human-granted, machine-revoked) must not
  also silence the tool: a "proposed conventions" lane shows what the product saw without
  enforcing, so confirmation is one decision on something already surfaced, not a blank form.
  **Confirmation mechanism (per FR-4/5, UJ-3):** the Convention Miner writes candidates as
  `status: proposed` entries into the **gitignored `.cache/proposed/` lane**; a **batched curation
  digest** (`guardrails curate`, on the user's schedule — never per-review noise) presents them; a
  human **accept** promotes the entry — moving it into the **committed `conventions.yaml`** with
  `status: confirmed`, which is the act that grants enforcement — while **reject writes the entry to
  the committed ledger too, as `status: rejected`** (with damping metadata): a rejection is a
  governance *decision*, and by the "version decisions, not derivations" rule it must survive clones,
  cache clears, and reach teammates — mining never re-proposes a rejected convention (UJ-3: "rejected
  ones are remembered"). Only the not-yet-decided proposals are cache-local, which costs nothing
  durable: they are machine-derived and re-mineable from the same corpus on any clone. The artifact
  *is* the interface: both decisions are edits to the committed ledger, reviewable as an ordinary PR.
  Unconfirmed proposals never produce review findings.
- **Artifact-folder commit policy, declared now:** split human-meaningful low-churn state
  (the confirmed ledger → committed) from machine-derived high-churn regenerable state
  (→ gitignored cache + committed hash/manifest only). Version decisions, not derivations.
  Declare the merge strategy for tracked state.
- **The IDE-as-LLM-runtime structured-output contract is an unsolved keystone risk**, not a
  footnote. Non-conformant LLM output handling needs a defined contract (file-handshake leaning:
  `core/` writes `<axiom>.in.json`, skill writes `.out.json`, Zod-on-read, bounded retry then
  per-axiom isolation). Contract shape decided in M1 (the Phase-3↔core boundary types).
- **Dogfooding has a structural blind spot.** Solo-dev dogfooding (M0–M3) cannot surface merge
  conflicts (no concurrent branches), confirmation friction (you wrote the conventions), or
  cross-runtime divergence (one operator) — the very things M4 exposes to strangers. Tracked as
  a known validation gap.
- Per-axiom failure isolation; cost governance (per-agent toggles, input-hash caching,
  deterministic-only mode, Ollama).

### Decisions to Resolve Next (ADRs)

The architecture must resolve, in roughly this order: **ADR-001** core→IDE-LLM validated-return
contract; **ADR-002** repo layout (monorepo vs multi-package); **ADR-003** orchestration
engine (static pipeline + `p-map`, not a DAG library); **ADR-004** TS AST tooling for the
LanguageAdapter / import graph; **ADR-005** shared Zod `contracts` package without coupling
core to the LLM layer. ADR-002 and ADR-005 are M1-blocking.

### Early-Validation Spikes & Walking Skeleton

Before scaling the analyzer set, validate the load-bearing assumptions: (1) **structured-output
reliability** — raw Zod parse-failure rate over ~50 real IDE skill invocations + a defined
repair/retry contract; (2) **cost & latency per phase** on a realistic worst-case PR (wall-clock
AND token spend); (3) **import-graph build cost** on a 10,000-file repo — where incremental/cached
construction must be *proven achievable, not assumed* (SPIKE-3 carries the burden of proof and a
named fallback). Delivery starts with a **walking skeleton** — one axiom,
one runtime, real diff, real verdict, end-to-end — before the taxonomy scales. The <30% noise
target is **unvalidated until a noise metric (denominator + labeling method) and a labeled
fixture set exist.**

## Starter Template Evaluation

### Primary Technology Domain

**Local-first developer-tooling runtime** (static-analysis engine + LLM-agent orchestrator),
distributed as npm packages + Claude Code plugin + GitHub Action. This is a CLI/library/runtime
domain, **not** a web/full-stack app — so no application starter template applies. The relevant
decision is monorepo scaffold strategy, which feeds **ADR-002 (repo layout)**.

### Decision: No off-the-shelf starter — hand-rolled minimal pnpm-workspaces monorepo

**Rationale:** The project's load-bearing boundaries are bespoke and must be enforced from line
one: a pure-Zod `contracts` package, a forbidden-import wall keeping `core/` LLM-free, and a
committed-vs-gitignored artifact split. Every generic monorepo template bakes in layout and
dependency assumptions that contradict these, so stripping one down costs more than scaffolding
clean — and "package boundaries are expensive to re-pour" makes deliberate design the cheaper
path. Generic templates (`jkomyno/pnpm-monorepo-template`, `create-turbo`) were considered and
rejected on that basis.

### Runtime: Node.js 24 LTS (Bun considered and declined)

Target **Node.js 24 Active LTS** ("Krypton"), not Node 26 (Current; LTS only Oct 2026).
**Bun was evaluated and declined** for three project-specific reasons, not performance doubts:
(1) **Distribution** — the shipped artifacts run on the *consumer's* runtime (GitHub Actions
runners and Claude Code are both Node); Bun cannot be shipped to them, so it could only ever be
a dev-time tool. (2) **Parity** — running a Bun dev toolchain while shipping on Node manufactures
exactly the cross-runtime divergence already named as a top risk; one runtime everywhere keeps
verdicts comparable. (3) **Windows + filesystem** — the dev environment is Windows and the git
worktree-isolation lifecycle leans hard on fs/path handling, which is precisely where Bun's
remaining (~2–5%) compatibility gap concentrates. Bun's headline wins (HTTP throughput, install
speed) do not touch this tool's hot path (AST/import-graph build + LLM latency). `bun install`
may be used as an *optional local install accelerator only*; CI, tests, and published artifacts
run on Node so we test what we ship. This also keeps **pnpm** as the package manager — its
`workspace:*` strict isolation is the mechanism enforcing the vendor-decoupling boundary.

### Verified Toolchain Baseline (June 2026)

- **Runtime:** Node.js 24 Active LTS (24.16.x "Krypton"). Engines pinned via `packageManager` + `engines`.
- **Package manager / workspace:** pnpm 11.x with `pnpm-workspace.yaml`; `workspace:*` protocol enforces explicit cross-package references and strict dependency isolation — the mechanism behind vendor-decoupling.
- **Validation / contracts:** Zod 4.x — built-in JSON Schema conversion serves the config → runtime-validation → generated-JSON-Schema → `init` questionnaire pipeline. Lands in the standalone `contracts` package (ADR-005).
- **TS AST / LanguageAdapter:** ts-morph 28.x (TypeScript compiler API wrapper) for **semantic, type-aware** resolution — TypeScript first (ADR-004).
- **Orchestration:** p-map 7.x for bounded-concurrency parallel analyzer `map` — confirms ADR-003 (static pipeline + `p-map`, no DAG library).
- **CLI surface:** Commander (not oclif) — sub-1MB, negligible per-invocation startup; protects latency NFRs and keeps the plugin + Action surfaces light. The CLI is a thin surface over the engine, so framework weight is unjustified. Reassess only if a third-party plugin architecture materializes (Rule of Three).
- **Build:** tsup per publishable package. **Test:** Vitest. **Build orchestration:** `pnpm -r` topological + TS project references at M1; **Turborepo deferred** until the build/test graph causes measurable pain.

### Prior Art Reference (not a dependency)

`code-review-graph` (MIT, local-first, Tree-sitter → SQLite graph of functions/imports/
call-chains/**blast radius**, shipped as CLI + VS Code ext + MCP server) is **adjacent prior art**,
not an adoptable dependency. It operates one layer upstream — *context provisioning* (serve the AI
relevant slices), whereas this project produces *verdicts* (AC-miss, convention drift). It is **not**
adopted as the graph engine because (a) Tree-sitter is syntactic and cannot resolve the path
aliases / barrels / re-exports that demand the TS type checker (ts-morph), and (b) it would make a
single-maintainer external project a load-bearing Phase-0 substrate, against the substrate-resilience
posture. Its **blast-radius computation, risk scoring, and SQLite graph schema** are worth studying
as design prior art for the Corpus Map + import-graph, and its existence validates the
graph-as-shared-substrate bet. Flagged for the competitive/market-research artifact.

### Build Order Established by This Decision

TS project references enforce: `contracts` → `core` (+ LanguageAdapter) → adapters/LLM layer →
surfaces (CLI / plugin / Action). The forbidden-import lint rule lives in CI from M1, guarding the
`core` → LLM boundary.

**Note:** Repo initialization (pnpm-workspaces scaffold + `contracts`/`core` package boundary +
forbidden-import lint) should be the **first implementation story** — it is the concrete output of
ADR-002 and ADR-005.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical (block implementation):** ADR-001 LLM-contract envelope (M1-defined, M3-used); ADR-002
repo layout; ADR-005 contracts package; persistence format for governed vs cache state.
**Important (shape architecture):** ADR-003 orchestration; ADR-004 AST tooling; content-addressed
caching; CI gating model; security/trust boundaries.
**Deferred (Rule of Three):** SQLite for the trend store; oclif-style plugin CLI; Turborepo build
orchestration; additional LanguageAdapters beyond TypeScript.

### Confirmed from Starter Evaluation (Step 3)

- **ADR-002 — Repo layout:** hand-rolled pnpm-workspaces monorepo, TS project references; build
  order `contracts → core → adapters/LLM → surfaces`.
- **ADR-003 — Orchestration:** static six-phase pipeline + `p-map` bounded concurrency; no DAG library.
- **ADR-004 — AST tooling:** ts-morph 28.x (semantic, type-aware) for the LanguageAdapter/import
  graph; TypeScript first.
- **ADR-005 — Contracts:** standalone pure-Zod `contracts` package (Zod 4.x, built-in JSON-Schema
  generation), imported by core/adapters/LLM alike.

### Data & Persistence

Storage is split by governance and churn, matching the artifact-folder commit policy:

- **Human-governed, low-churn state** — Conventions Ledger and the confirmed Corpus Map — stored as
  **YAML, committed to git**. YAML over JSON because the format must support comments (governance
  rationale lives beside the rule) and clean human editing; over Markdown because the tool writes
  proposals/confirmations back and structured YAML round-trips far more cleanly than hand-formatted
  Markdown. **Zod-on-read** guards against YAML's type-coercion footguns (the "Norway problem"),
  backed by a documented quoting discipline in the ledger schema. Never SQLite: binary state would
  defeat human diffing, governance, and merge. **Merge strategy (declared):** these files take the
  **default 3-way git merge** and a genuine conflict is **resolved by a human in an ordinary PR** —
  appropriate because they are low-churn and human-governed (a conflict here is a real governance
  decision, not noise to auto-union). Stable key ordering (entries sorted by a stable id) keeps diffs
  minimal and conflicts localized. `manifests/` records are append-only, one file per run named by
  run-id, so they **never collide** — no merge strategy needed.
  **The Corpus Map splits along the decision/derivation line** (resolving FR-1's "derived from the
  code and regenerable" against "human-governed"): the regenerable structural inventory (entities,
  locations, fan-in — machine-derived from the import graph) lives in the **gitignored cache**; the
  **committed `corpus-map.yaml` holds only the human-confirmed layer** — zone-role confirmations,
  purpose annotations, exemplar designations. That layer is genuinely low-churn (regeneration touches
  the cache, never the committed file), which is what keeps 3-way human merge appropriate here rather
  than a conflict factory.
- **Narrative prose** (ADRs, brief, optional generated ledger *views*) stays in **Markdown** —
  read top-to-bottom by humans, never machine-read-back. Any rendered ledger view is a surface over
  the YAML source of truth, deferred until browsing the YAML proves clunky (Rule of Three).
- **Machine-derived state splits by whether it is a *decision* or a *derivation*** (resolving an
  apparent committed-vs-gitignored contradiction):
  - **Trend store (`history/trends.jsonl`) is committed** — it is the versioned longitudinal record,
    a headline feature, not a regenerable cache. Append-only JSONL; `.gitattributes merge=union` so
    concurrent branches union their records instead of conflicting.
  - **Content-addressed cache (`.cache/`) is gitignored** — purely regenerable; only a committed
    hash/manifest pins what it should contain.
  - Both: writes are atomic and provenance-stamped (temp → fsync → atomic rename); read-repair
    discards a torn trailing record; the Trend Aggregator validates-before-trust and cold-starts on
    invalid history.
  - **Idempotency is mandatory for trend records** because `merge=union` is line-based: it silently
    collapses byte-identical lines and interleaves records out of order. Every trend record therefore
    carries a **stable `recordId`** (content hash of `{run-id, axiom, scoreKind}`) and the
    **`commitSha` the run reviewed**; the Trend Aggregator **dedupes on `recordId` and orders by git
    commit ancestry** (topological order of the recorded SHAs in the repo's actual history, with
    `recordId` as a stable tiebreak for same-commit runs). **No cross-branch sequence counter exists
    or is needed** — concurrent branches cannot coordinate one, and wall-clock is banned from
    ordering — so unioned history is treated as what it truly is: a partial order keyed to git
    ancestry, immune to clock skew, branch concurrency, and union's line reshuffling. Records are
    individually meaningful so union-collapse of a true duplicate is a no-op, never data loss.
- **Write-back discipline — the tool must not dirty the repo it reviews.** Runs *do* produce
  committed-state writes (`trends.jsonl` appends, `manifests/<run-id>`), so three rules close the
  loop the commit policy previously left open:
  1. **Self-exclusion:** the `_agentic-guardrails/` folder is always excluded from the diff under
     review — the tool never reviews, or re-triggers on, its own artifacts.
  2. **Disposition, not side effect** (per the addendum's disposition prompt): in interactive mode
     the run ends by asking — commit the run's artifacts (`[skip ci]`) or drop them; in CI the Action
     follows configured policy (commit with `[skip ci]`, or publish as a workflow artifact without
     committing). Writing to tracked state is an explicit act, never an ambient mutation that leaves
     the working tree mysteriously dirty.
  3. **Manifest retention:** `manifests/` is pruned to the newest **100 runs** (config-overridable;
     confirmed 2026-07-01) so committed per-run state is bounded; trend records are compact by design
     and append forever — that unbounded growth *is* the longitudinal feature, priced in.
- **Schema migration for long-lived committed state.** Zod schemas are semver-versioned and *will*
  evolve, while `conventions.yaml`, `corpus-map.yaml`, and `trends.jsonl` live for the life of the
  consuming repo. Every persisted artifact carries its **`schemaVersion`**. On read, a **forward
  migration ladder** (`v_n → v_n+1` pure functions) upgrades an older artifact to the current schema
  *before* `safeParse`; only an artifact below the lowest supported version, or one that fails after
  migration, falls back to the documented degraded path (cold-start for trends; human-review prompt
  for the governed ledgers). Migrations ship with the engine version that introduces the schema bump
  and are covered by golden round-trip fixtures. **Cold-start is the last resort, not the upgrade
  path.**
- **SQLite deferred (Rule of Three):** revisited only when the trend store on 10,000-file repos with
  long history needs indexed queries. Avoided now because better-sqlite3 has Node 24 native-build
  failures and `node:sqlite` is still RC/experimental — both at odds with the zero-friction,
  Windows-first install posture.

### Core ↔ LLM Contract (ADR-001 — the keystone)

**One Zod envelope, two transports.** A single per-axiom `<axiom>.in` / `<axiom>.out` envelope
(carrying tier, source, severity, `findingId`, confidence, exemplar provenance, and `degraded[]`) is the canonical
Phase-3↔core boundary type:

- **Interactive / IDE transport — file-handshake.** The LLM is the host (inversion of control), so
  `core/` writes `<axiom>.in.json`, the Claude Code skill reads it, reasons, and writes
  `<axiom>.out.json`; core reads with `safeParse`, then returns a typed `degraded` result with
  per-axiom isolation. **Synchronization contract (the part that makes the handshake real):**
  - **Collision isolation.** Every run gets a unique run-id; handshake files live under a
    run-scoped directory `.cache/handshake/<run-id>/<axiom>.{in,out}.json`. Concurrent reviews in
    the same repo therefore never share filenames. The run-id is part of the run manifest.
  - **Completion signal = atomic rename, never a flag.** The skill writes `<axiom>.out.json` via the
    same temp → fsync → atomic rename discipline used for persistence. Core treats *appearance of the
    atomically-renamed `.out.json`* as the only completion signal, so it can never observe a
    half-written file. `safeParse` on read is the second guard.
  - **Two-invocation lifecycle (dispatch → collect) — no polling, because inversion of control
    forbids it.** Core is a subprocess the skill invokes; it cannot sit alive waiting while the LLM
    reasons (the skill cannot reason while blocked on its own child). So the handshake is two CLI
    invocations: **dispatch** — core runs Phases 0–2, writes every `<axiom>.in.json` plus a
    `run-state.json` (persisted phase outputs + a deadline stamp) under the run dir, prints the
    pending-file list, and **exits**; the skill reasons per axiom and writes each `.out.json`
    atomically; **collect** — the skill re-invokes `guardrails review --collect <run-id>`, which
    validates the out-files, runs Phases 4–5, and completes the run. A missing/invalid out-file at
    collect time — or a collect arriving past the `run-state.json` deadline — yields the typed
    `degraded` (`reason: handshake_timeout | handshake_invalid`) with per-axiom isolation. The
    10-min ceiling is enforced as a **deadline checked at collect**, not a live wait.
  - **Mode-aware retry (per the addendum; confirmed 2026-07-01).** Defaults: **interactive** =
    **1** correction retry + 1 repair (keep the
    human loop responsive); **headless/CI** = **fail-fast** — no retry, straight to the typed
    `degraded` (an unattended pipeline should report and move on, not burn budget arguing with a
    model). A repo that values verdict completeness over CI wall-clock may raise the CI budget via
    config, up to a **hard cap of 2 retries + 1 repair in any mode**. Both paths terminate in a
    typed `degraded` result — neither throws, neither blocks past the budget.
  - **Staleness.** Run-scoped handshake dirs are cleaned on run completion; an orphaned dir older
    than the ceiling is garbage-collected at the next run's start.
- **Headless / CI transport — direct adapter.** Core calls a direct API/Ollama adapter with standard
  request/response, validated against the same envelope.
- **Parity:** because both transports emit the identical envelope plus a run manifest (ledger hash,
  corpus hash, ruleset version, tier-enablement, engine version, and LLM model identity), the
  cross-runtime parity test can compare verdicts. Promise *accountable*, not *identical*.
  **Test mechanics — a nondeterministic tier cannot gate CI live:** the CI-blocking parity fixture
  replays **recorded golden `.out` envelopes through both transports' validation/aggregation/manifest
  paths** (proving the plumbing equivalent, deterministically); **deterministic-tier parity gates on
  byte-identical verdicts**; live LLM verdict-class comparison runs as a **periodic advisory probe**,
  never a blocking check. The gate can therefore neither flake nor be silently skipped.
- **MCP considered and rejected** as the core transport: it would couple LLM-free `core/` to a moving
  protocol and does not resolve the IDE inversion-of-control case.
- **Timing:** envelope schema is defined in **M1** even though the LLM tier ships at M3 — cheap to fix
  now, expensive to retrofit.

### Security & Trust Boundaries

- **Analyzed code is parsed as data, never executed** — AST/static analysis only, no `eval`/dynamic
  require of target code.
- **Isolated git worktree** for all operations — never the user's live working tree; lifecycle and
  path handling validated on Windows.
- **Secrets:** LLM API keys read from environment only — never persisted, never logged, redacted in
  run manifests.
- **Network egress, stated honestly.** The tool emits **zero telemetry** and makes **no network
  call except to the LLM endpoint the user explicitly configures**. But that exception is not
  cosmetic: when a *cloud* provider is configured (Anthropic API, or the IDE transport routing
  through Claude Code), **the analyzed source diff and surrounding context are sent to that
  provider** — this is real egress of potentially proprietary code, by the user's opt-in, and must
  be documented as such rather than implied away by "local-first." Three honest tiers: (a)
  **deterministic-only mode** — genuinely zero egress, the default day-one posture; (b) **Ollama /
  local model** — LLM reasoning stays on the machine, still zero external egress; (c) **cloud LLM** —
  opt-in egress to the one configured endpoint, nothing else, no telemetry. "Local-first" names the
  default and the always-available zero-egress path, **not** a claim that the cloud LLM tier keeps
  code on the machine. NFR-10/11.
- **Human-confirm invariant:** enforcement is human-granted, machine-revoked; agents never self-confirm.

### Config & Caching

- **Config plane:** YAML config → Zod runtime validation → generated JSON Schema → `init`
  questionnaire, all sourced from the `contracts` package (Zod 4).
- **Caching:** content-addressed cache keyed by a composite hash of {change, context, ruleset version,
  engine version, tier-enablement}. The **LLM-tier key additionally includes model identity**
  (`provider · model-id · model-version`) and the prompt/template version — otherwise a model upgrade
  would silently serve a verdict produced by an older model on a cache hit, which is exactly the
  silent degradation NFR-8 forbids. The deterministic-tier key omits model identity (no model
  involved). **Model identity is also recorded in the run manifest** so a verdict is always
  attributable to the model that produced it. **IDE-transport caveat (stated, not hidden):** on the
  file-handshake transport core does not choose the model — the skill **self-reports model identity
  as a required envelope field**, so the LLM-tier cache key is finalized **post-hoc at write time**;
  a cache *lookup* before dispatch keys on the last manifest's model identity, and a mismatch on
  return is simply a miss that re-stores under the reported identity. The manifest records
  `modelIdentity.source: api-verified` (direct transport) vs `self-reported` (IDE) so parity
  comparisons and consumers know the difference in trustworthiness. Deterministic tier cached for
  speed (zero-cost); LLM tier cached hard for cost control (NFR cost governance), with per-agent
  toggles and a deterministic-only mode.

### CI Gating Model

- **Deterministic tier gates** — findings produce a nonzero exit (fail).
- **Inferred tier advises** — annotations only, non-blocking by default.
- **Configurable promotion** — a repo may promote inferred findings to gating. Every run declares its
  degradation tier (zero silent degradation).

### Supporting Decisions

- **Git access:** shell out to system git via a thin typed wrapper (git is already a hard dependency;
  worktree fidelity on Windows outweighs isomorphic-git's pure-JS appeal).
- **Distribution:** published npm packages (`contracts`, `core`, adapters, CLI) + Claude Code plugin +
  GitHub Action, all consuming `core`; SemVer managed via Changesets; the project dogfoods itself in
  its own GitHub Actions CI (Axiom #6).
- **Frontend architecture:** N/A — the only surfaces are the CLI, the IDE plugin, and the GitHub Action.

### Decision Impact Analysis

**Implementation sequence:** `contracts` + repo scaffold + forbidden-import lint (story 1) →
import-graph/LanguageAdapter with golden fixtures → deterministic analyzers (walking skeleton: one
axiom end-to-end) → persistence (JSONL + atomic writes) → config/caching → LLM envelope + dual
transport (M3) → CI gating + Action.

**Cross-component dependencies:** the LLM envelope (ADR-001) and the run manifest share fields with
the cache key — one schema change ripples to caching and parity; the import graph is the Phase-0 join
point feeding four axioms + the Cartographer, so its partial-result contract gates everything
downstream.

## Implementation Patterns & Consistency Rules

These patterns prevent divergence between independent agents (and across solo-dev sessions). They are
also the baseline the project enforces on itself via the `engineering-standards` skill — the tool's
own conventions are the ones it would enforce on others (dogfooding, Axiom #6).

### Critical Conflict Points Identified

Twelve areas where independent agents could diverge. The highest-leverage three — the **Finding
shape**, the **partial-result contract**, and the **analyzer-vs-agent boundary** — are load-bearing:
divergence there corrupts every downstream phase.

### Canonical Data Contracts (highest priority)

- **One `Finding` schema, defined once in `contracts`.** Every analyzer and agent emits the same
  Zod-validated shape: `{ axiom, location, message, tier: 'deterministic'|'inferred',
  source: 'ast'|'regex'|'llm', severity: 'error'|'warning'|'info', findingId, confidence,
  exemplar?, degraded? }`. `findingId` is a **symbol-anchored content hash**
  (`{axiom, ruleId, file, enclosing symbol/normalized context}`) so identity — and any disposition
  attached to it — survives line drift. *(`severity` + `findingId` added 2026-07-03: FR-21's
  strongest-severity merge, FR-30's severity breakdown, CI blocking-vs-advisory gating, and
  disposition tracking all require them.)* No analyzer invents its own
  finding shape or an ad-hoc interface.
- **Partial-result contract on all shared reads.** Every upstream read (import graph, ledger, corpus,
  history) returns `{ data, coverage|provenance, degraded[] }`. A consumer below its coverage/validity
  threshold returns `inconclusive` — never a false `pass`.
- **Provenance is mandatory, never inferred late.** Findings and writes carry source, tier, severity,
  `findingId`, exemplar, and engine version at creation.

### Analyzer vs Agent Boundary

- **`analyzer` = pure `(change, context) → findings`, no LLM, no side effects.** **`agent` = a unit
  that invokes an LLM.** The name signals the boundary. The forbidden-import lint enforces it: `core/`
  may not import any adapter/LLM package.
- Promotion of an analyzer to an independently-orchestrated unit requires explicit justification (real
  concurrency, independent lifecycle, or an LLM boundary) — default is a pure function in the shared
  analyzer library.

### Error, Degradation & Determinism

- **Typed results across boundaries, not thrown exceptions.** `safeParse` everywhere data crosses a
  boundary (file, config, LLM output). Bounded LLM retry: **mode-scoped defaults (ADR-001:
  interactive = 1 retry + 1 repair; CI = fail-fast), ≤2 retries + 1 repair as the hard cap** →
  typed `degraded`, then per-axiom isolation. A phase failure degrades to partials; it is never an
  uncaught throw.
- **Zero silent degradation:** a `pass` requires positive evidence; every run declares its degradation
  tier.
- **Deterministic output (tier-scoped):** findings sorted by stable key (`file → line → axiom`); no
  wall-clock/randomness in finding ordering (timestamps live in the run manifest only). The
  **deterministic tier** guarantees *same input → byte-identical output* (parity/NFR). The **LLM tier
  is explicitly not bit-identical** across runs or runtimes — its guarantee is *accountable, not
  identical*: the run manifest makes any divergence explainable, and the parity fixture asserts
  **verdict-class equivalence** (the same findings surface with the same axiom/severity), never
  byte-equality of LLM prose. CI gates on the deterministic tier precisely because it is the
  reproducible one.

### Naming & Code Conventions

- **Types/Zod schemas:** PascalCase (`Finding`, `RunManifest`). **Functions/vars:** camelCase.
  **Files:** kebab-case (`import-graph.ts`) — matches the existing repo convention.
- **Packages:** scoped `@agentic-guardrails/{contracts,core,...}`.
- **Constants:** SCREAMING_SNAKE_CASE only for true module-level constants.

### Structure & Module Conventions

- **ESM-only** (`"type": "module"`), Node 24 native; tsup emits ESM. Use `import.meta.url` (no
  `__dirname`/`__filename`).
- **Hybrid test layout:** colocated `*.test.ts` for unit tests; a top-level `tests/` for
  integration / e2e / cross-runtime parity. Small per-analyzer golden fixtures live in package-local
  `__fixtures__/`; large shared fixtures (10k-file perf repo, parity repo) live in `tests/fixtures/`.
  Wired via Vitest `projects` with separate `unit`/`integration` include globs.
- **Imports through package entry points**, never deep relative paths across package boundaries;
  dependency direction `contracts → core → adapters → surfaces` is one-way (lint-enforced).

### I/O & Cross-Platform

- **All paths via `node:path`** (`join`/`resolve`) — never string concatenation or hardcoded
  separators; Windows is a first-class target (NFR-12).
- **Atomic writes** (temp → fsync → atomic rename); **append-only JSONL** for high-churn state;
  read-repair discards a torn trailing record.
- **Bounded concurrency** via `p-map` — never unbounded `Promise.all` over filesystem or heavy CPU
  work; respect the per-phase time budget. The concurrency bound is **set against the ts-morph memory
  footprint** (the type-checker program is held in memory; analyzers sharing it must not multiply
  peak memory) — the bound comes from SPIKE-3's measured numbers, not maxed blindly.

### Config, Secrets & Egress

- **Config only through the validated `contracts` config object** — no ad-hoc `process.env`/YAML
  reads, except the one documented path: LLM API key from env (never persisted/logged, redacted in
  manifests).
- **Network egress per the three-tier posture in Security & Trust Boundaries** (which is the single
  statement of the rule — this section defers to it, not restates a simplified version): zero
  telemetry; zero egress except the explicitly configured LLM endpoint; and when that endpoint is a
  cloud provider, the diff under review *is* sent to it. Deterministic-only and Ollama tiers remain
  genuinely zero-egress.

### Enforcement

**Every agent MUST:** emit the canonical `Finding`; validate on read at every boundary; return typed
`degraded`/`inconclusive` rather than throw or fake a pass; keep `core/` LLM-free; use `node:path` and
atomic writes. **Verified by:** the forbidden-import lint, Zod schema tests, golden-fixture determinism
tests, and a parity fixture — all in CI from M1.

## Project Structure & Boundaries

### Complete Project Directory Structure

```
agentic-guardrails/
├── package.json                 # workspace root; packageManager: pnpm; engines: node 24
├── pnpm-workspace.yaml
├── tsconfig.base.json           # shared compiler opts; project-references base
├── tsconfig.json                # solution-style references (build order)
├── vitest.config.ts             # projects: { unit (colocated), integration }
├── eslint.config.js             # incl. forbidden-import rule: core ✗→ llm/adapters
├── .changeset/                  # Changesets (SemVer, multi-package release)
├── .github/workflows/ci.yml     # lint · typecheck · test · dogfood guardrails on self
├── README.md  CHANGELOG.md
├── docs/
│   └── adr/                     # ADR-001..005 (dogfood Axiom #6)
├── packages/
│   ├── contracts/               # pure Zod, zero deps but zod — the single source of truth
│   │   └── src/
│   │       ├── finding.ts        # Finding schema            (FR-18–25 outputs)
│   │       ├── manifest.ts       # RunManifest (parity + cache key)
│   │       ├── envelope.ts       # <axiom>.in/.out LLM contract (ADR-001)
│   │       ├── config.ts         # config schema → JSON Schema (FR-31–36)
│   │       ├── ledger.ts         # Conventions Ledger + Corpus Map (FR-1–8)
│   │       ├── spec.ts           # Spec/AC verification contract (FR-9–13)
│   │       ├── trends.ts         # longitudinal + disposition records (FR-14–17, FR-40)
│   │       └── index.ts
│   ├── core/                     # LLM-FREE (lint-enforced) — deterministic engine
│   │   └── src/
│   │       ├── lang/typescript/  # LanguageAdapter via ts-morph  (ADR-004)
│   │       ├── graph/            # import/dependency graph (Phase-0 join point)
│   │       ├── analyzers/        # pure (change,context)→findings; deterministic axiom tier
│   │       ├── pipeline/         # static six-phase orchestrator + p-map (ADR-003)
│   │       ├── knowledge/        # Cartographer · Convention Miner · Trend Aggregator · freshness watermark (deterministic parts)
│   │       ├── spec/             # SDD AC-verification runtime    (FR-9–13)
│   │       ├── persistence/      # YAML ledger r/w · JSONL store · atomic writes · read-repair
│   │       ├── cache/            # content-addressed finding/graph cache
│   │       ├── report/           # pure transform: trends → self-contained HTML (no CDN)
│   │       └── index.ts
│   ├── llm/                      # the ONLY LLM-dependent package
│   │   └── src/
│   │       ├── envelope-client.ts # safeParse + mode-scoped retry (ADR-001) → typed degraded
│   │       ├── file-handshake.ts  # IDE transport (.in.json → .out.json)
│   │       ├── direct-api.ts      # CI transport (Anthropic API)
│   │       ├── ollama.ts          # local model option
│   │       └── agents/            # inferred-tier axiom agents + Cartographer inference
│   ├── cli/                      # Commander headless entry      (FR-26–30)
│   │   └── src/commands/         # review · scan · gate · init · map · trends · curate
│   ├── action/                   # GitHub Action wrapper         (FR-26–30, CI gating)
│   │   ├── action.yml
│   │   └── src/main.ts
│   └── plugin/                   # Claude Code plugin surface (markdown DSL, thin over core/cli)
│       ├── .claude-plugin/plugin.json
│       ├── commands/             # slash commands
│       └── skills/
│           ├── engineering-standards/   # write-time enforcement (FR-37–39, carried forward)
│           └── axiom-*/                 # file-handshake skills (read .in → reason → write .out)
└── tests/
    ├── integration/             # walking skeleton; dual-transport end-to-end
    ├── parity/                  # cross-runtime parity fixture (IDE vs CI verdict equivalence)
    └── fixtures/                # large shared fixtures (10k-file perf repo; legacy dirty-*.ts)
```

### Runtime Artifact Layout (written into a *consuming* repo)

```
_agentic-guardrails/             # visible folder (consistent with the _bmad-output convention)
├── config.yaml                  # committed — human-edited, Zod-validated on read
├── conventions.yaml             # committed — Conventions Ledger (human-governed)
├── corpus-map.yaml              # committed — confirmed Corpus Map (human-governed)
├── history/
│   └── trends.jsonl             # committed, append-only; .gitattributes merge=union
├── manifests/                   # committed — run manifests + cache-state hashes
└── .cache/                      # gitignored — regenerable
    ├── graph/                   #   import-graph cache (content-addressed)
    ├── findings/                #   content-addressed finding cache
    ├── proposed/                #   proposed-conventions lane (pre-confirmation)
    ├── handshake/               #   <axiom>.in.json / .out.json (IDE transport, ephemeral)
    └── trends.html              #   generated trend visualizer (regenerable view)
```

**Trends are versioned (a headline feature).** `trends.jsonl` is committed, append-only, with a
`.gitattributes merge=union` strategy so concurrent branches union their records rather than conflict.
**`init` owns the wiring, and preflight defends it:** `init` writes the `merge=union` attribute and
the `.cache/` ignore entry into the consuming repo, and the **Phase-0 preflight verifies both on
every run** — a missing attribute or ignore entry produces a loud warning naming the consequence
(trend merges degrade to 3-way conflicts; cache pollution), because a silently deleted attribute
line would otherwise corrupt the feature it enables.

**Trend visualizer.** Because JSONL is not human-readable, `core/report` renders a **self-contained
static HTML file** (`guardrails trends [--open]`, written to the gitignored `.cache/trends.html`).
Constraints: fully self-contained — trend data inlined, **vanilla JS + inline CSS, no CDN, no network**
— to preserve the zero-egress/local-first posture (NFR-10/11). The HTML is a *rendered view* over the
committed `trends.jsonl` source of truth (regenerable, gitignored), consistent with the
"version decisions, not derivations" rule. v1 is read-only and unfiltered; the richer explorer is
parked (see expansion-ideas EI-6).

### Architectural Boundaries

- **Dependency direction (one-way, lint-enforced):** `contracts → core → {llm, cli} → {action, plugin}`.
  `core` importing `llm` is a CI failure — this is the vendor-decoupling wall made testable.
- **The LLM boundary is a package boundary.** Every LLM call crosses `core → llm` via the `envelope`
  contract; `core` never imports an SDK.
- **Split components coordinate one-way through the envelope — the Cartographer is the worked
  example.** A single logical component may straddle the boundary, but only as two units with a
  one-way data flow: the **deterministic half in `core/knowledge`** derives the structural Corpus Map
  from the Phase-0 import graph (entities, locations, fan-in) and emits it as a partial-result
  contract; the **inference half in `llm/agents`** *consumes that map via the envelope* to propose
  purpose/zone-role/convention-exemplar enrichments. `core` never calls the inference half and never
  imports `llm`; the deterministic map is complete and useful on its own (M1), and LLM enrichment is
  an additive M3 layer that can degrade out entirely. The same one-way rule governs any future split
  component — deterministic produces, LLM enriches, never the reverse.
- **The Phase-0 join point** (`core/graph`) feeds four axioms + the Cartographer; it returns the
  partial-result contract `{ data, coverage, degraded[] }`, gating everything downstream.
- **Surfaces are thin.** `cli`, `action`, and `plugin` orchestrate and format; they hold no analysis
  logic. The plugin's axiom skills are pure file-handshake I/O.

### Requirements → Structure Mapping

| FR group | Lives in |
|---|---|
| A — Knowledge substrate (FR-1–8) | `contracts/ledger.ts`, `core/knowledge`, `core/persistence`, `_agentic-guardrails/{conventions,corpus-map}.yaml` |
| B — Spec & AC runtime (FR-9–13) | `contracts/spec.ts`, `core/spec` |
| C — Longitudinal memory (FR-14–17, FR-40) | `contracts/trends.ts`, `core/knowledge` (Trend Aggregator), `core/report`, `_agentic-guardrails/history/{trends,dispositions}.jsonl` |
| D — Six-axiom pipeline (FR-18–25) | `core/{analyzers,pipeline}` (deterministic), `llm/agents` (inferred) |
| E — Surfaces & modes (FR-26–30) | `cli`, `action`, `plugin` |
| F — Config & cost (FR-31–36) | `contracts/config.ts`, `core/cache`, `llm` (per-agent toggles, Ollama) |
| G — engineering-standards (FR-37–39) | `plugin/skills/engineering-standards` |

### Build & Distribution

- **Build:** tsup per package → ESM; TS project references enforce topological order.
- **Published:** `@agentic-guardrails/{contracts,core,llm,cli}` to npm; `action` consumed via GitHub
  Marketplace; `plugin` distributed as the Claude Code plugin (git clone today, per legacy install docs).
- **Turborepo:** not yet — a `turbo.json` is added only when `pnpm -r` build/test time hurts (Rule of Three).

## Architecture Validation Results

### Coherence Validation ✅

- **Decision compatibility:** The stack is internally consistent and version-verified (Node 24 LTS,
  pnpm 11, Zod 4, ts-morph 28, p-map 7, Commander, Vitest, tsup). No conflicts: the LLM-free `core`
  boundary (ADR-001/005) is enforced by the same pnpm `workspace:*` + forbidden-import lint that the
  layout (ADR-002) provides; the static pipeline + p-map (ADR-003) needs nothing the toolchain lacks.
- **Pattern consistency:** The canonical `Finding`, partial-result contract, and analyzer/agent
  boundary all live in `contracts` and are enforced by CI checks — patterns and structure reinforce
  rather than contradict. Determinism rules (stable sort, no wall-clock in ordering) directly serve
  the parity NFRs.
- **Structure alignment:** The one-way dependency direction (`contracts → core → {llm,cli} →
  {action,plugin}`) physically encodes the vendor-decoupling decision; the artifact layout encodes the
  committed-vs-gitignored policy.

### Requirements Coverage Validation ✅

| FR group | Architectural support |
|---|---|
| A — Knowledge substrate (1–8) | `core/knowledge` (Miner, freshness watermark), `core/persistence`, YAML ledgers; asymmetric trust = human-confirm invariant |
| B — Spec & AC runtime (9–13) | `core/spec` + `contracts/spec.ts`; graceful tier degradation = typed `degraded`/`inconclusive` |
| C — Longitudinal memory (14–17) | `core/knowledge` Trend Aggregator, `core/report`, committed `trends.jsonl` |
| D — Six-axiom pipeline (18–25) | `core/{analyzers,pipeline}` deterministic + `llm/agents` enrichment; **FR-21 dedup = the pipeline reduce step**; **FR-24 "assembled dynamically" = the static-pipeline / dynamic-per-phase-membership altitude** (reconciled, not contradicted) |
| E — Surfaces & modes (26–30) | `plugin` (interactive), `action` (headless, single replacing PR comment, per-axiom checks), `cli` (command surface) |
| F — Config & cost (31–36) | `contracts/config.ts`, `core/cache` (input-hash), `llm` (per-agent toggles, model tier, Ollama, deterministic-only mode) |
| G — engineering-standards (37–39) | `plugin/skills/engineering-standards`; FR-39 post-v1 augmentation has a home; EI-3 tracks the human-override layer |

**NFR coverage:** Performance (NFR-1/2/3) — deterministic parallel `p-map` + caching + per-phase
budgets; zero-cost (NFR-4/5) — deterministic-only mode + hard input-hash cache; scale (NFR-6/13) —
hot-seed + incremental/cached import-graph; resilience (NFR-7/8/9) — per-axiom isolation,
zero-silent-degradation contract, worktree cleanup-on-failure; privacy (NFR-10/11) — package-boundary
egress control, no telemetry, self-contained HTML viz (no CDN); platform (NFR-12) — Node 24 LTS,
`node:path` discipline, Windows-validated worktree. The PRD's NFR-11 already references committed
`_agentic-guardrails/` folders as an adoption signal — the chosen artifact-folder name matches.

### Implementation Readiness Validation ✅

- **Decisions:** complete and version-pinned; the keystone (ADR-001 envelope) has a defined shape and
  M1 timing.
- **Structure:** concrete tree, package boundaries, and artifact layout all specified; first story is
  unambiguous.
- **Patterns:** all twelve conflict points have enforceable rules with CI verification mechanisms named.

### Gap Analysis Results

- **Critical:** none open. (The structured-output reliability assumption is real but spike-gated
  *before* the LLM tier scales — not a blocking architectural gap for M1.)
- **Minor (resolved inline):** FR-21 dedup placement → pipeline reduce step; FR-24 wording →
  reconciled to the static-pipeline/dynamic-membership altitude.
- **Empirical (validation spikes the architecture itself prescribes, not missing decisions):**
  (1) IDE structured-output raw parse-failure rate + repair contract, with a ≥98% post-repair bar
  (SPIKE-1); (2) the `<30%` noise target — unvalidated until a noise metric + labeled fixtures exist
  (SPIKE-4); (3) import-graph build cost on a 10k-file repo **and the NFR-1 <60s deterministic-pipeline
  bar on ~1k files**, including the ts-morph-vs-hybrid fallback decision (SPIKE-3); (4) NFR-2 5-min
  full-review feasibility (SPIKE-2; PRD defers to dogfooding); (5) **Windows git-worktree lifecycle
  reliability incl. cleanup-on-failure (SPIKE-5)**; (6) solo-dev dogfooding blind spot (merge
  conflicts, confirmation friction, cross-runtime divergence) — surfaces only at M4.

### Validation Issues Addressed

The two minor placement issues are resolved in the coverage table above (dedup → reduce step; FR-24
altitude). No decisions were changed; these were clarifications of where existing decisions land.

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION (M1 specifically; LLM-tier scaling at M3+ is gated on the
structured-output and noise spikes resolving favorably — the architecture prescribes those spikes
rather than assuming them).

**Confidence Level:** High — coherent, fully covers requirements, and every consistency rule has a
named CI enforcement mechanism.

**Review provenance:** hardened by two adversarial review rounds (completed 2026-07-01) — 35 findings
raised and resolved, including the handshake synchronization/lifecycle contract, mode-aware retry,
write-back discipline, the corpus-map decision/derivation split, trend-record ancestry ordering, and
quantified pass/fail bars on every spike gate (SPIKE-1 ≥98% post-repair; SPIKE-5 100 clean cycles +
injected-failure suite; manifest retention 100 runs — all confirmed with the owner). Where a fix
changed a rule, every site stating that rule was updated and verified by search, per the round-2
propagation lesson. **Post-completion backport (2026-07-03):** `severity` and a symbol-anchored
`findingId` were added to the canonical `Finding` schema — a gap surfaced during the epic breakdown's
adversarial review (OD-6): FR-21's strongest-severity merge, FR-30's severity breakdown, the CI
blocking-vs-advisory gate, and disposition tracking all consume fields the schema previously lacked.
All four schema-stating sites in this document were updated and verified by search.

**Key Strengths:** Testable vendor-decoupling (lint-enforced, not aspirational); the
one-envelope/two-transport keystone solves the IDE inversion-of-control problem with built-in parity;
substrate-resilience (partial-result + atomic writes + validate-before-trust) treated as first-class;
honest about its own empirical unknowns via prescribed spikes; toolchain is boring and current.

**Areas for Future Enhancement:** Tracked in `expansion-ideas.md` (EI-1…EI-6) — notably the trends
explorer (EI-6) and longitudinal cost view (EI-1).

### Implementation Handoff

**AI Agent Guidelines:** Follow the architectural decisions and patterns exactly; respect the one-way
dependency direction (the forbidden-import lint will fail the build otherwise); validate on read at
every boundary; refer to this document and the ADRs for all architectural questions.

**First Implementation Priority:** Repo scaffold story — pnpm-workspaces monorepo + `contracts`/`core`
package boundary + forbidden-import lint + CI skeleton (the concrete output of ADR-002 and ADR-005),
followed by the walking skeleton (one axiom, one runtime, real diff, real verdict, end-to-end).

## Architecture Spikes & Validation Gates

These are **enabler stories**, not FRs — they de-risk load-bearing assumptions and must be carried
into the epics/stories backlog explicitly (an FR-driven breakdown will not generate them). Each must
appear as a spike story sequenced **as a gate before the stories that depend on it**, and verified
present at the implementation-readiness check. The architecture *prescribes* these; it does not assume
their outcomes.

### Walking Skeleton (foundational, M1)

**Goal:** one axiom, one runtime, real diff → real verdict, end-to-end.
**Exit criteria:** a single deterministic axiom runs over a real branch diff and emits a Zod-valid
`Finding`, persisted to `_agentic-guardrails/`, via the actual pipeline (not a harness stub).
**Milestone:** M1. **Blocks:** scaling the analyzer taxonomy; SPIKE-2 and SPIKE-3 attach to it.
**Depends on:** repo scaffold story.

### SPIKE-1 — Structured-output reliability

**De-risks:** the ADR-001 keystone — that IDE LLM output can be made reliably Zod-parseable.
**Method — two-stage, because the real axiom skills do not exist until M3 and the method must be
honest about that:** (a) **M1 signal:** build a **throwaway prototype harness** — one minimal
handshake skill + the envelope schema — and measure raw `safeParse` failure rate over ~50 invocations.
This is a *named scaffold cost* (days, not free), bought deliberately to shape the envelope while it
is still cheap to change; its numbers are a signal, not the verdict. (b) **M3-entry confirmation:**
re-run the measurement against the real axiom skills before the LLM tier scales — this is the
authoritative number the gate reads. Define and test the repair/retry contract (mode-scoped,
per ADR-001) at both stages.
**Exit criteria:** a measured failure-rate baseline **and a pass/fail bar, not just documentation** —
**post-repair envelope-valid rate ≥ 98%** over the sample (≤1 failure in 50, the finest bar the
sample size can resolve; the ≤2% that fall through become typed `degraded`, acceptable per per-axiom
isolation). Below the bar, the envelope/prompt must be simplified (or the schema split) **before**
the LLM tier scales — the spike fails closed. *Bar confirmed 2026-07-01; revisit only if spike data
argues otherwise.*
**Milestone:** M1 prototype signal (scaffold cost accepted); M3-entry confirmation gate.
**Blocks:** ADR-001 finalization, LLM enrichment phase (FR-19), M3 scaling.

### SPIKE-2 — Cost & latency per phase

**De-risks:** the performance/cost product claims.
**Method:** on a realistic worst-case PR-sized diff, measure wall-clock and token spend per phase.
**Exit criteria:** per-phase latency + token numbers; explicit pass/fail against NFR-2 (5-min target,
10-min hard ceiling) and the cost-governance posture (NFR-4/5).
**Milestone:** during dogfooding (per NFR-2). **Blocks:** claiming the 5-min target; per-phase budget
tuning. **Depends on:** walking skeleton + LLM tier.

### SPIKE-3 — Import-graph build cost at scale

**De-risks:** NFR-6/13 (scales with activity, not repo size), **NFR-1 (deterministic pipeline <60s on
~1,000 files)**, and the highest-correctness-risk shared component. Also tests the **ts-morph
scalability bet directly** — ts-morph wraps the full type checker and is memory/time-heavy, and its
incremental story is weak; this spike must *prove* incremental/cached build is achievable, not assume
it.
**Method:** (a) build the import/dependency graph on a 10,000-file repo with the chosen
incremental/cached approach and **measure cold vs warm rebuild time and peak memory** under the
intended `p-map` concurrency bound; (b) exercise path aliases, barrels, re-exports, dynamic imports
against golden fixtures; (c) **separately run the full deterministic pipeline on a ~1,000-file repo and
measure wall-clock against the NFR-1 <60s bar.**
**Exit criteria:** warm-rebuild cost within budget on 10k files at bounded peak memory; **deterministic
pipeline <60s on ~1,000 files (NFR-1, hard pass/fail)**; golden-fixture resolution correctness
validated. **Fallback if ts-morph misses the budget:** a hybrid where a cheap Tree-sitter/structural
pass handles the common cases and the ts-morph type checker is invoked only where alias/barrel/
re-export resolution actually requires it — decided by this spike's numbers, not deferred.
**Milestone:** M1. **Blocks:** NFR-1/6/13 scale claims; Phase-0 readiness for four axioms + Cartographer.

### SPIKE-4 — Noise metric + labeled fixtures

**De-risks:** the `<30%` noise counter-metric — currently unmeasurable.
**Method:** define the noise denominator and a labeling method; build a labeled fixture set of
true/false positives.
**Exit criteria:** a documented, reproducible noise metric (denominator + labeling method) + a labeled
fixture corpus, **wired as a CI counter-metric** carrying the PRD's bar — **noise rate < 30%** of
error/warning-severity findings dispositioned not-actionable, and **non-increasing as axioms are
added**. The bar is the gate: the pipeline must score under 30% on the labeled set before any noise
claim is asserted. **Until the metric exists, no noise claim can be made.**
**Milestone:** foundational — before any noise target is asserted. **Blocks:** the `<30%` noise claim;
tuning of finding precision.

### SPIKE-5 — Windows git-worktree isolation lifecycle

**De-risks:** the worktree-isolation lifecycle on Windows — repeatedly named a top risk ("leans hard on
fs/path handling"), the one load-bearing risk that previously had no gate, on the actual dev platform.
**Method:** exercise the full remote-review lifecycle on Windows — `git worktree add` at a target ref →
run the pipeline inside → **always remove in `finally`** — across the known footguns: long paths,
locked/held file handles preventing removal, path separators, case-insensitivity, the push-failure →
`/tmp`(temp-dir) degrade path (per addendum), and cleanup after a mid-run crash.
**Exit criteria — quantified, held to the same standard demanded of SPIKE-1/4 (confirmed 2026-07-01):**
**100 consecutive create → run → cleanup cycles with zero leaked worktrees, zero orphaned locks, and
a byte-identical invoking working tree**; plus an **injected-failure suite** — process kill mid-run,
a file handle held open by another process during removal, paths >260 chars, case-collision names,
push-failure → temp-dir degrade — where **every scenario ends with zero residue and an intact
invoking tree** (NFR-9); plus a documented list of Windows-specific handling required by
`core/persistence` and the git wrapper.
**Milestone:** M1 (the lifecycle is foundational and the dev environment is Windows). **Blocks:** FR-25
remote/PR isolation; NFR-9/NFR-12 platform claims.

### Tracked Risk (not a spike) — solo-dev dogfooding blind spot

Solo-dev dogfooding (M0–M3) structurally cannot surface merge conflicts (no concurrent branches),
confirmation friction (you authored the conventions), or cross-runtime divergence (one operator).
These only appear at **M4** with external users. Not closeable by a spike — tracked as a known
validation gap to be exercised during the M4 external-beta phase.
