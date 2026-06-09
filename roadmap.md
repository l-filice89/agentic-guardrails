# Agentic-Guardrails — Roadmap

_A single source of truth for both the engineering build (Track A) and go-to-market (Track B). The "calendar" is expressed as **dependencies, not dates** — estimates come after the architecture exists._

**Design of record:** the target architecture is specified in the brainstorming sessions under `_bmad-output/brainstorming/`:
- `brainstorming-session-2026-05-31-18-47.md` — the 5-axiom runtime engine (orchestration, SDD-as-runtime-dependency, dynamic DAG, artifact/quality ledger).
- `brainstorming-session-2026-06-06-axiom6.md` — **Axiom #6 (Codebase Conformance)** + the corpus subsystem, plus spin-off Axioms #7 (Visual Fidelity) and #8 (Atomicity, deferred).

> **Status:** the repo today is still the legacy **prompt-only** Claude Code plugin. This roadmap describes the rework into a programmatic Node/TS runtime. The prompt-only commands survive as thin plugin surfaces over the new engine.

---

## Cross-track coupling (the "calendar")

| GTM milestone | Unblocked by |
|---|---|
| G0 Pre-launch groundwork | — (start immediately, parallel to M0–M1) |
| G1 Private beta / design partners | M3 (learned ledger usable end-to-end) |
| G2 Publication | M4 (installable surfaces exist) |
| G3 Launch & marketing | M4 + Validation benchmark (M1+) |
| G4 Community & ecosystem | M5 (extensibility surface public) |

---

## Track A — Build

### M0 — Foundations _(the engine skeleton)_
- `core/ast/` — parser + **LanguageAdapter** (TypeScript first) + the **import/dependency graph** _(reused by Axioms #1/#3/#4/#5 and #6's Cartographer — the single most leveraged component)_
- `core/agents/` — dynamic DAG, 6 phases (0–5), failure isolation
- `core/schemas/` — **Zod** state contracts, versioned _(also the config validator)_
- `_agentic-guardrails/` — artifact persistence + `quality_scores` block + longitudinal quality ledger
- **Config: YAML validated by a single Zod schema** → runtime validation + generated JSON Schema for editors + drives the interactive `init` questionnaire. Per-axiom `blocking | advisory | off` + toggles.
- **Ships:** the substrate (no user-facing feature yet).

### M1 — Deterministic Axioms _(the free, zero-LLM MVP)_ ⭐
- **#1 Structural** (compiler/AST), **#3 Cleanliness [AST]** (structural dup, complexity), **#4 NFR [structural]** (N+1, blocking I/O), **#5 Security [AST/regex]** (secrets, injection)
- **Axiom #6 Tier-1** — Cartographer **structural Map** (paths, fan-in, zones, authors) + `placement-leak` + `placement-layer` checks + the **`init`** command
- Trend Aggregator + Report Composer (deterministic)
- **Ships:** "deterministic-only mode" — a useful, free-to-run reviewer covering 5 axioms' structural signals + #6 structural conformance. **First real, standalone MVP.** Defuses two pre-mortem risks (value-without-confirmation, cheap-on-big-repos).

### M2 — SDD Runtime & Axiom #2 _(the logic layer)_
- **ValidatedSDD** schema + quality gate + **coaching loop** + AC elicitation (interactive)
- **Axiom #2 Logic Auditor** + 4-tier degradation ladder; Test Suite Auditor (FR tests)
- **Standalone pre-implementation spec-validation workflow** — the shift-left entry point: validate the spec *before* any code is generated (prevention over detection; guarantees the verification contract exists by review time). _(Added 2026-06-10 per the product brief.)_
- **Ships:** SDD-grounded logic verification + the interactive coaching surface + the shift-left spec gate.

### M3 — LLM Enrichment & the Conventions Ledger _(Axiom #6 Tier-2)_
- LLM-enrichment layers: **#3** (semantic SRP/dup), **#5** (auth/tenant isolation), **#6** (semantic conformance)
- IDE-as-LLM-runtime pattern + CI API adapter
- **Convention Miner** + full **Ledger lifecycle** (`proposed → confirmed → waning → superseded → rejected`), **two-axis confidence** (prevalence × intent), **latent tier** + evidence bar, **curation digest** (curation separated from review), **asymmetric decay**, **sticky rejections**, **human evidence trail**, **`hot-seed`** build strategy
- `override_cleanliness` bidirectional arbitration, **exemplar citations**
- **Ships:** complete Axiom #6 + the full 6-axiom hybrid engine.

### M4 — Surfaces & Distribution _(MVP Complete)_
- **Claude Code plugin** (interactive): skill wiring, worktree lifecycle, disposition prompt, stale-knowledge prompt; **carries forward the auto-activating `engineering-standards` skill** as the write-time enforcement layer (a foundation, exempt from legacy decommission)
- **GitHub Actions plugin** (CI): API adapter, PR comment (replace-not-accumulate), per-axiom status checks, staleness config
- **Commands:** `/review-local`, `/review-branch`, `/review-pr`, `/review-project`, `/axiom N`
- **Cost controls:** per-agent toggle, input-hash caching, Ollama escape hatch
- **Legacy decommission:** once the new surfaces supersede them, remove the legacy prompt-only commands, fixtures (`tests/fixtures/dirty-*`, `tests/EXPECTED.md`), and now-unused dependencies; strip the corresponding `## Legacy` rules from `_bmad-output/project-context.md` and refresh its durable section from the shipped architecture.
- **Ships:** the installable product — interactive + CI.

### M5 — Post-MVP / Extensibility & Hardening
- Plugin surface: **LanguageAdapter** public API, agent replace/supplement, version-pinned plugin registry
- **Python** (+ more) language adapters
- **`/fix-*` commands** with exemplar **fix-anchor**
- **Axiom #7 Visual Fidelity** (consume existing visual-regression infra; FE-only, opt-in)
- **Axiom #8 Atomicity** (penciled), #3 semantic-dup via shared Map, zone-adjacency lazy-mining refinements, threshold presets, on-merge warm CI job
- **Ledger-powered write-time guidance** — confirmed conventions from the Ledger injected into the `engineering-standards` skill's context: detection feeds prevention, closing the generation→verification loop

---

## Track B — Go-to-Market

### G0 — Pre-launch groundwork _(parallel with M0–M1)_
- **License: Apache-2.0** _(decided 2026-06-10 — explicit patent grant + contribution terms; legacy plugin remains MIT)_, repo hygiene (issue templates, public roadmap, CODE_OF_CONDUCT)
- **Name / branding** (TBD), reserve **npm package name** + **GitHub org**
- Decide distribution channels (TBD — see G2)

### G1 — Private beta / design partners _(~M3)_
- Design-partner brownfield repo(s) — including the colleague who surfaced the original need
- Collect **case-study data**; iterate on noise/precision

### G2 — Publication _(at M4 — each surface to its native channel)_
| Surface | Channel |
|---|---|
| Runtime / CLI (Node/TS) | **npm** _(supersedes the legacy "git-clone only" distribution)_ |
| Claude Code plugin (interactive) | **Claude Code plugin marketplace** (git-based) |
| CI plugin (GitHub Action) | **GitHub Marketplace** |
| Docs | **GitHub Pages / docs site** |

### G3 — Launch & marketing _(at/after M4)_
- **Origin-story blog post:** "100% of our human review feedback was 'this doesn't fit the codebase' — not one logic bug. So we built a 6th axiom."
- Thesis post: **shift-left verification / the 6 axioms**; angle post: **"a free, deterministic code-fit checker"** (M1 framing)
- **Demo** (asciinema/GIF in README), Show HN, Reddit (r/programming, r/ExperiencedDevs), dev.to, Lobsters, X/LinkedIn
- **Positioning/comparison** (vs linters, vs AI reviewers); **design-partner case study**

### G4 — Community & ecosystem _(M5)_
- Plugin-ecosystem governance, community **language-adapter** contributions
- Per-axiom deep-dive posts, talks/CFPs, **opt-in** adoption telemetry

---

## Cross-cutting workstreams _(every milestone, not a phase)_

### Documentation & ADRs — part of every milestone's Definition of Done
- A milestone isn't "done" until its docs + an **ADR** for any significant decision land in the same PR.
- Covers: README (kept current), quickstart, per-axiom reference, **config reference auto-generated from the Zod schema**, the trust docs (human-confirm invariant, "CI never confirms," `override_cleanliness` semantics), `CONTRIBUTING.md` + plugin-authoring guide, `CHANGELOG` (Keep-a-Changelog / SemVer), `LICENSE`, `CODE_OF_CONDUCT`.
- _The project uses ADRs to record significant decisions — fitting, since ADRs are themselves a signal source for Axiom #6 (eat our own dog food)._

### Validation & dogfooding _(continuous from M1)_
- **Dogfood:** run agentic-guardrails on its own repo from M1 onward.
- **Design partner:** the colleague's brownfield repo from M3.
- **Benchmark:** "does Axiom #6 catch the consistency issues humans caught?" — extend the `tests/EXPECTED.md` oracle. This number is the G3 launch headline.

---

## Open decisions (TBD — to be made when the time is right)
- ~~**License**~~ — **decided 2026-06-10: Apache-2.0** (see G0)
- **Name / branding** (currently "agentic-guardrails")
- **Distribution channels** (proposed: npm + Claude Code plugin marketplace + GitHub Marketplace + docs site)

## Decided (log)
- **2026-06-10 — License: Apache-2.0** for the v2 runtime (patent grant + §5 contribution clarity); legacy plugin stays MIT.
- **2026-06-10 — The `engineering-standards` auto-activating skill is a foundation, not legacy.** It carries forward into the M4 Claude Code plugin as the write-time enforcement layer; post-MVP, the Conventions Ledger feeds it (confirmed conventions injected into the writing context). The M4 legacy decommission covers the prompt-only *commands and fixtures*, not this skill.
- **2026-06-10 — The legacy prompt-only plugin will not be promoted** (no Plugin Store / awesome-claude-code submission for it). The market research's Tier-1 "current version" recommendations are retired; its discovery-channel insights apply to the v1 launch (G2–G3) instead.
