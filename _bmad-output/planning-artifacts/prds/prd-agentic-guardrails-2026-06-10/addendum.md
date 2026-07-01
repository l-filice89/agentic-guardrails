# PRD Addendum — agentic-guardrails (2026-06-10)

_Depth that belongs downstream (architecture / solution design) or earned a place but doesn't fit the PRD body. Sourced from the brainstorming extractions and conversation._

## Candidate technical decisions (for architecture, not PRD)

These read as converged in the brainstorming sessions and should be treated as strong priors by the architecture workflow:

- **Six-phase dynamic DAG orchestration** (Phase 0 pre-flight → Phase 1 parallel deterministic → Phase 2 SDD resolution gate → Phase 3 parallel LLM enrichment → Phase 4 aggregation → Phase 5 composition), constructed at startup from scope/mode/artifacts/config.
- **Zod state contracts**, semver-versioned; agents declare the schema version they produce. Expected JSON Schema embedded inline in IDE agent prompts for LLM self-validation.
- **Dual-channel output**: stream channel (real-time to IDE) + persist channel (complete artifact document).
- **Mode-aware retry**: interactive defaults to 1 retry with correction prompt; CI defaults to fail-fast.
- **LLM execution split**: interactive mode runs LLM reasoning inside the IDE as skills (templated Markdown from `skills/`); CI uses a direct API adapter. `core/` stays purely deterministic Node.js — the hard vendor-decoupling requirement.
- **Remote review isolation via `git worktree`**: spin up at target ref, run pipeline inside, always remove in finally. Read artifacts from the worktree's folder; write new artifacts to the invoking context's folder. Push failure degrades to `/tmp` save. Disposition prompt offers commit+push with `[skip ci]` or drop.
- **Artifact folder layout**: `_agentic-guardrails/` (git-tracked, configurable) with `sdds/`, `reviews/branch-{name}/`, `reviews/pr-{id}/`, `reviews/project/`, `reviews/uncommitted/`, `corpus/<domain>.md`, `conventions/<area>.md`, `conventions/evidence/`, `config/`.
- **Knowledge maintenance is out-of-band**: Cartographer and Convention Miner run outside the review DAG. Warm refresh is hash-gated per file/entry, triggered at review start or by manual command. Cascade: code Δ → Cartographer re-maps changed files → affected Ledger entries re-evaluated only if their evidence set intersects changed entities.
- **Dedup rule**: same file + line range + axiom, >50% overlap → merge with `source: [ast, llm]`, strongest severity, both descriptions preserved.
- **Hard staleness ceiling default**: ~14 days (config-overridable); CI staleness policy `defer | update | update_after:X`.

## Open design questions parked by the brainstorming sessions

- Confirmation cold-start UX: how to nudge convention curation without nagging (digest cadence, surfacing).
- Evidence precedence conflicts: contradictory human evidence ("intentional" vs "debt") — human decides, but resolution UX undefined.
- Zone-adjacency lazy refinement: materialization and query complexity TBD.
- Sticky rejections damping curve (repeated mining rejections lower sensitivity): mechanics undefined.
- Axiom #7 tool integrations: Chromatic/Percy identified; Playwright snapshot specifics TBD.

## Competitive depth (beyond PRD differentiation section)

- **Earthly Lunar** — closest commercial comparable: write-time self-correction loop, 100+ pre-built guardrails, multi-agent support (Claude Code, Cursor, Codex, Gemini); enterprise platform posture. Differentiate: developer-local, plugin-native, open, zero-infra, free.
- **LaneKeep** — OSS governance sidecar, PreToolUse deny pipeline, security/PII focus. Adjacent, not conformance.
- **TDD Guard** — single-purpose write-time blocker; proof the block-and-explain hook pattern gets adopted.
- **Greptile / CodeRabbit / Qodo** — CI-time PR bots; implicit convention learning in vendor cloud; teams layer write-time + review-time rather than choosing.
- Research signal worth citing in launch material: arXiv 2605.08112 — retrieval of recorded decisions improved agent decision-compliance by 49 points.
- Ecosystem: ~101 plugins in official Claude Code marketplace (March 2026), no dominant guardrails/standards plugin in the top tier; hooks API mature (18+ lifecycle events); Copilot converging on the same hook model.
