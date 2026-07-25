# agentic-guardrails

Production-ready governance commands and engineering quality guardrails.

Installs four slash commands and an `engineering-standards` skill that enforce consistent type safety, security, observability, and accessibility practices across any project.

---

## Commands

| Command | Scope | Purpose |
|---|---|---|
| `/cleanup` | Files changed in current branch vs `main` | Pre-PR hygiene pass |
| `/sweep` | Entire working directory | Full technical debt audit |
| `/security-scan` | Entire working directory | Security and vulnerability scan |
| `/review` | All uncommitted changes | Expert review before staging |

---

## Installation

### Prerequisites
- [Claude Code](https://claude.ai/code) installed

### Via the Claude Code Plugin Store *(coming soon)*

Once published, you'll be able to install directly from the official Claude Code plugin store — no manual steps required.

### Manual install

Clone the repo:

```bash
git clone https://github.com/l-filice89/agentic-guardrails.git ~/.claude/plugins/agentic-guardrails
```

Claude Code does not support permanently enabling local (non-marketplace) plugins via settings. Use one of the following approaches:

**Option A — Shell alias (recommended)**

Add to your `~/.zshrc` (or `~/.bashrc`):

```bash
alias claude='claude --plugin-dir ~/.claude/plugins/agentic-guardrails'
```

Reload your shell (`source ~/.zshrc`). Commands will be available in every Claude Code session, namespaced as `/agentic-guardrails:cleanup`, `/agentic-guardrails:sweep`, etc.

**Option B — Per-session flag**

```bash
claude --plugin-dir ~/.claude/plugins/agentic-guardrails
```

Use this for one-off sessions without modifying your shell config.

**Option C — Standalone commands (no namespace)**

Copy the command files into your user-level Claude commands directory:

```bash
cp ~/.claude/plugins/agentic-guardrails/commands/*.md ~/.claude/commands/
```

Commands will load automatically as `/cleanup`, `/sweep`, etc. — no flag or namespace needed. You lose the plugin packaging but gain the shorter names.

---

## Commands in Detail

### `/cleanup`
Targeted cleanup on files changed in the current branch relative to `main`. Run this before opening a PR.

Checks: dead code, DRY violations, type safety anti-patterns, framework health, test coverage gaps, logging hygiene, leftover AI artifacts.

### `/sweep`
Same checks as `/cleanup` but across the entire working directory. Use this for periodic debt audits or when onboarding to an unfamiliar codebase.

### `/security-scan`
Scans for:
- Hardcoded secrets and API keys
- Authentication/authorization flaws and missing RBAC
- Injection vectors (SQL, XSS, unsafe deserialization)
- Tenant boundary violations and IDOR risks
- Suspicious or unverified third-party dependencies

Outputs findings with severity: **Critical / High / Medium / Low**.

### `/review`
Reviews all uncommitted changes — staged edits, unstaged edits, and untracked new files — as an expert senior engineer. Outputs findings with file name, line number, problem, and suggested fix.

---

## Skill: `engineering-standards`

The `engineering-standards` skill is loaded automatically when you write or review backend or frontend code. It enforces:

- **Strict type safety** — no `any`, blind casting, or type-checker bypass directives
- **Structured logging** — JSON-based logger with correlation IDs; no raw `console.log`/`print` in backend code
- **Tenant isolation** — IDOR prevention; server-side validation of all IDs; never trust client-provided tenant context
- **Mobile-first UI** — semantic HTML, `aria-labels`, keyboard navigation, no hardcoded desktop widths
- **Testing discipline** — backend TDD before business logic; pragmatic client-side testing focused on state and data
- **ADRs** — for significant architectural decisions (new dependencies, schema changes, cross-service contracts)
- **Definition of Done** — type check, lint, clean state, build, and manual test steps before declaring work complete

### Injecting your own standards

The skill in `skills/SKILL.md` contains the universal engineering standards that apply to any project. If you maintain personal coding preferences in a `~/.claude/CLAUDE.md` file, the recommended split is:

- **CLAUDE.md** — personal workflow preferences (e.g., git habits, tone, explanation depth)
- **SKILL.md** — universal, shareable engineering standards (type safety, logging, security, testing)

To customize this plugin for your team, fork the repo and edit `skills/SKILL.md` directly.

---

## Testing

Fixtures with deliberate violations are provided in `tests/fixtures/`. Each file is annotated with the violations it contains.

To spin up an isolated test workspace:

```bash
bash tests/setup.sh
```

This creates a temporary git repo pre-loaded with the fixtures and prints the commands to run. Compare the output against `tests/EXPECTED.md`.

---

## v2 runtime (work in progress)

This repo is being reworked into a programmatic Node/TypeScript runtime engine
(a deterministic-first, then LLM-deepened, code review engine). The legacy
plugin above (`commands/`, `skills/`, slash commands) **remains fully
functional and installable exactly as documented** throughout the rework;
nothing above changes until the legacy decommission milestone.

The v2 runtime lives in a pnpm-workspaces monorepo under `packages/`:

- `packages/contracts` (`@agentic-guardrails/contracts`) — the standalone
  Zod schema package (sole runtime dependency: `zod`); the single source of
  truth for data shapes crossing package boundaries: the canonical `Finding`
  (+ `computeFindingId`, a line-drift-stable sha256 identity), `RunManifest`,
  the ADR-001 LLM envelope factory, config (+ generated JSON Schema), the
  generic partial-result contract, OD-1 trend records, DR-1 disposition
  records, and a `migrateArtifact` forward-migration ladder for persisted
  artifacts. All boundary validation is `safeParse`-based; exported helpers
  never throw on bad input.
- `packages/core` (`@agentic-guardrails/core`) — the deterministic,
  **LLM-free** analysis engine. This boundary is lint-enforced, not just
  documented (see `docs/adr/ADR-005-contracts-package.md`). Ships the
  `LanguageAdapter` seam with a ts-morph-backed `TypeScriptAdapter`
  (`docs/adr/ADR-004-ast-tooling.md`) that builds a deterministic import
  graph — compiler-accurate resolution of `paths` aliases, barrels,
  re-exports, and type-only imports; dynamic imports and `require` calls
  are discovered by AST walking, with literal specifiers resolved via the
  compiler and non-literal ones surfacing as typed degradations — with
  byte-stable serialization and `fanIn`/`fanOut` queries. Unresolvable
  imports, unresolved bare specifiers (recorded as external but flagged
  unverified), and tsconfig load failures all surface as typed degradations
  via the partial-result contract, never throws.

- `packages/cli` (`@agentic-guardrails/cli`) — the `guardrails` command.
  `guardrails review` reviews all uncommitted changes (staged, unstaged,
  untracked) through the real pipeline: preflight → deterministic analyzers
  (the Axiom #1 structural rule set — circular imports, unresolved imports,
  dependency direction, unassigned files; see
  `docs/rules/axiom-1-structural.md` — and the Axiom #3 cleanliness rule
  set — unreachable code, unused exports, copy-paste duplication, excessive
  complexity; see `docs/rules/axiom-3-cleanliness.md`) → aggregation
  (overlapping same-file/same-axiom findings merged per FR-21: >50%-of-the-
  smaller-range overlap, strongest severity, source union, both messages
  preserved) → composition. Unchanged inputs are served from a
  content-addressed cache under `_agentic-guardrails/.cache/{graph,findings}/`
  (gitignored, pruned to the newest 100 entries per kind): a hit skips both
  the graph build and analyzer execution and is declared in the manifest's
  `cache` counters; a torn or stale entry is revalidated through the
  contracts schema and recomputed with a typed degradation — never wrong
  data. Phase 1 runs under a wall-clock budget (30s, SPIKE-3-derived) that
  degrades to partials via AbortSignal instead of failing the run. It prints
  a plain-text summary (degraded work listed in the header) and atomically
  writes a deterministic review artifact — RunManifest embedded (with the
  declared six-phase assembly), byte-identical for
  identical input — to `_agentic-guardrails/reviews/uncommitted/<run-id>.json`
  (the `reviews/<scope>/` layout; the folder is created on demand, or up
  front by `guardrails init`). Exit codes: `0` clean, `1` error-severity
  findings, `2` degraded run or preflight failure (e.g. not a git repo).
  When the committed knowledge files exist (`conventions.yaml` /
  `corpus-map.yaml`, seeded by `init`), the manifest carries the sha256 of
  their bytes; absent inputs are declared with sentinel hashes and typed
  degradation entries — never faked.

### Bootstrap (`guardrails init`)

`guardrails init` bootstraps `_agentic-guardrails/` in a git repo: a
committed `config.yaml` (via a small per-axiom questionnaire on a TTY, whose
options come from the contracts schema; `--no-input` or piped stdin writes
the documented defaults — no prompt ever blocks), empty-but-valid
`conventions.yaml` + `corpus-map.yaml` (contracts-validated; full ledger
semantics arrive in Epic 4), git wiring (`.gitattributes` with
`history/*.jsonl merge=union`, plus the seeded `.gitignore` covering
`reviews/`, `.cache/`, and the generated schema file), and a regenerable
file-level structural corpus seed (`{file, fanIn}` per import-graph node) at
`.cache/corpus/structural-seed.json`. Init only writes MISSING files — a
re-run never clobbers a human-edited file (each is reported `created:` or
`kept:`; wiring files get missing lines appended with user content
preserved). No tsconfig → the seed is skipped with a declared reason. Exit
codes: `0` success, `2` typed failure (not a git repo, write error).
Subsequent reviews verify the git wiring at preflight and warn loudly
(naming the consequence) when a wiring line has been removed.

### Configuration (`_agentic-guardrails/config.yaml`)

`guardrails review` reads an optional, git-trackable YAML config validated
through the contracts schema. Missing file → defaults (declared on stderr as
"using defaults"); every value deviating from defaults is logged explicitly
at run start; invalid values are typed errors naming the offending path,
exit 2. The tool keeps a generated `config.schema.json` beside the YAML —
reference it for editor autocomplete:

```yaml
# yaml-language-server: $schema=./config.schema.json
axioms:
  "1":
    enforcement: advisory   # blocking | advisory | off (axiom "5" defaults to blocking)
  "5":
    enforcement: blocking
    maxFindings: 2          # tolerate up to N error findings before exit 1 (default 0)
boundaries:                 # optional: powers the axiom-1 direction/unassigned rules
  layers:
    - name: app
      paths: [src/app]      # repo-relative path prefixes (longest match wins)
    - name: lib
      paths: [src/lib]
  allowed:
    app: [lib]              # app may import lib; undeclared pairs are violations
```

Enforcement semantics: `blocking` error findings above `maxFindings` exit 1;
`advisory` findings are reported and persisted but never affect the exit
code; `off` axioms do not run (declared in the run manifest's `axiomsOff`).
Config content participates in the run identity hash.

More packages (`llm`, `action`, `plugin`) land as later stories need
them. See `docs/adr/` for architecture decision records and `roadmap.md` for
the milestone sequencing.

**Licensing:** the legacy plugin (this file's License section, below) stays
MIT. The v2 runtime packages under `packages/` are licensed separately under
Apache-2.0 (declared per-package in each `package.json`); per-package
`LICENSE` files are added at the M4 packaging milestone.

### Prerequisites

- Node.js 24 LTS
- pnpm 11.x (`npm i -g pnpm@11` if you don't already have it; the
  `packageManager` field pins the exact version CI uses)

### Dev commands

```bash
pnpm install              # install workspace dependencies
pnpm -r build             # build all packages (tsup), in topological order — run before tests (core tests import contracts/dist)
pnpm -r test              # run each package's own tests
pnpm test                 # run the full Vitest workspace (unit + tooling + integration)
pnpm run lint              # ESLint, scoped to packages/**/src
pnpm run typecheck          # tsc -b (project references, typecheck-only)
pnpm run check:boundaries    # structural dependency-boundary check (core -> contracts only)
```

## License

MIT
