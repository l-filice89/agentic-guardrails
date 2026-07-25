# Changelog

All notable changes to this project will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- Axiom #1 full structural rule set (Story 1.9, `rulesetVersion: 2`,
  documented in `docs/rules/axiom-1-structural.md`): import-graph edges now
  carry the 1-based import-statement `line` (dynamic imports: the call
  site), so every axiom-1 finding anchors at the real import line instead
  of line 1. New rules alongside the absorbed `structural/circular-import`:
  `structural/unresolved-import` (error — a changed file's relative/alias
  specifier that fails resolution, specifier in the message; bare externals
  and node builtins stay verified externals, the paired graph degradation
  remains the coverage truth), and — with the new optional `boundaries`
  config key (path-prefix `layers` + fail-closed `allowed` dependency map,
  cross-references schema-refined, longest-prefix layer assignment,
  same-layer imports always allowed) — `structural/dependency-direction`
  (error — from→to layer pair not in the allowed map; type-only edges
  exempt, dynamic imports and re-exports checked) and
  `structural/unassigned-file` (warning — changed file matching no declared
  layer prefix). Absent `boundaries` → those two rules emit nothing (not a
  degradation) and existing configs/artifacts are unchanged. An internal
  import target assigned to NO declared layer also fires the direction rule
  (the `(unassigned)` pseudo-layer — no evasion by routing through an
  unassigned file), and layer path prefixes are schema-validated (no globs/
  backslashes/`./`/absolute/trailing-`/`; a path belongs to one layer). The
  `boundaries` declaration participates in the findings cache key, and
  `ENGINE_VERSION` is bumped to `0.0.2` because the cached-graph payload
  shape changed (edge `line`, `unresolvedImports`) — pre-upgrade cache
  entries live under old keys and become clean misses (a designed miss,
  never a revalidation failure masquerading as corruption). FR-21 merge
  granularity now includes `ruleId`: different rules colliding at one line
  stay distinct findings. Import-graph edge identity stays line-free
  (duplicate imports of one target are one edge carrying the smallest
  observed line), keeping fanIn/fanOut and the 1.8 structural seed stable.
  Machine oracle fixtures under `tests/__fixtures__/structural-rules/`
  (violation findings byte-compared twice + clean fixture asserting zero
  findings) via `tests/integration/structural-rules.e2e.test.ts`.
- `guardrails init` + structural corpus seed (Story 1.8): bootstraps
  `_agentic-guardrails/` — `config.yaml` from the 1.6 default constants or a
  per-axiom TTY questionnaire (option values sourced from the contracts
  schema; `--no-input`/non-TTY stdin writes defaults, no prompt ever
  blocks), empty-but-valid `conventions.yaml` + `corpus-map.yaml` (new
  contracts `ledger.ts` schemas, registered in the migration ladder with
  golden fixtures), `.gitattributes` with `history/*.jsonl merge=union`
  (inside `_agentic-guardrails/` — user root git files untouched), and the
  seeded `.gitignore`. Builds a regenerable file-level structural seed
  (sorted `{file, fanIn}` per merged-import-graph node, partial-result
  envelope carried) as a plain atomic file at
  `.cache/corpus/structural-seed.json`; no tsconfig → skipped with a
  declared reason. Init writes only MISSING files (never clobbers; per-file
  created-vs-kept summary; wiring lines appended, user content verbatim);
  exit 0 success / 2 typed failure (not a git repo, write error). Review's
  phase-0 preflight now verifies the git wiring when `_agentic-guardrails/`
  exists (missing line → stderr warning naming the consequence, never exit
  2), and the manifest's `ledgerHash`/`corpusHash` become the sha256 of the
  committed `conventions.yaml`/`corpus-map.yaml` bytes with their "absent
  until init" degradations dropped (absent files keep sentinel +
  degradation exactly as before).
- Pipeline hardening + deterministic cache (Story 1.7): phase 4 now merges
  overlapping findings per FR-21 (same file + axiom, >50% of the smaller
  range overlapping — transitive chains merge greedily left-to-right against
  the accumulated cluster; merged findings keep the lexicographically
  smallest constituent `findingId` for disposition continuity, take the
  strongest severity, union `source` into an array — the contracts finding
  schema now accepts a source enum OR a non-empty array — and preserve both
  messages joined with `" | "`). A content-addressed cache under
  `_agentic-guardrails/.cache/{graph,findings}/` (gitignored; atomic writes;
  pruned to the newest 100 entries per kind by mtime) serves import graphs
  and per-axiom findings for unchanged inputs — keys hash change content,
  tsconfig + participating-file content, scope, ruleset/engine versions, and
  tier enablement (deliberately excluding HEAD, so unrelated commits still
  hit). Hits skip analyzer execution and the graph build; every lookup is
  declared in the manifest's new optional `cache` counters (hits/misses/
  invalid), and cached entries revalidate through the contracts schema on
  read — torn or stale entries recompute with a typed degradation, never a
  crash or wrong data. Cold and warm artifacts are byte-identical except the
  `cache` counters themselves (documented carve-out). Phase 1 runs under a
  30s wall-clock budget (SPIKE-3-derived, AbortSignal + p-map) that degrades
  cut-off analyzers to typed partials. The manifest's new optional `phases`
  field declares the fixed six-phase assembly with per-phase membership
  (phases 2/3 empty with the reason), and the CLI report header now lists
  degraded work (subject + reason) above the findings block.
- Config plane (Story 1.6): `guardrails review` loads
  `_agentic-guardrails/config.yaml` through the contracts `configSchema`
  (single source of truth; core parses YAML via the `yaml` package and
  `safeParse`s — no component reads config outside the validated object).
  Per-axiom enforcement (`blocking | advisory | off`, axiom #5 defaulting to
  `blocking`) plus an optional `maxFindings` threshold now drive exit-code
  gating: a blocking axiom fails the gate only when its error-severity
  findings exceed `maxFindings` (default 0); advisory findings never affect
  the exit code (still reported + persisted); `off` axioms are excluded from
  the run at analyzer-membership level and declared in the manifest's new
  optional `axiomsOff` field. Invalid configs are typed errors naming the
  offending path (Zod) or line/column (YAML) — exit 2, never a stack trace,
  never a silent fallback. Every deviation from defaults is logged at run
  start (one stderr line per value: path, configured, default); a missing
  config file is declared as "using defaults (no config file)". The
  generated JSON Schema is kept current at
  `_agentic-guardrails/config.schema.json` (atomic write; write failure
  degrades, never aborts) for `# yaml-language-server` editor autocomplete,
  and the config content hash joins the runId inputs (config changes
  identity).
- SPIKE-3 — import-graph cost at scale (Story 1.5): committed benchmark
  harness (`scripts/spike-3-benchmark.mjs` + seeded synthetic-repo generator
  `scripts/spike-3-generate-repo.mjs`, run manually, repos generated to OS
  temp, never committed) measuring 10k-file cold/warm graph builds with peak
  RSS, a concurrency sweep {2,4,8} through a hand-rolled bounded async pool,
  the real `runReview` on a 1k-file repo (<60s NFR-1 gate), and a full
  bidirectional set-equality correctness check against the seeded
  ground-truth edge set (missing + spurious both asserted zero). Results,
  derived warm-rebuild budget, chosen p-map bound, and gate verdict recorded
  in `docs/spikes/SPIKE-3-import-graph-cost.md`.
- Walking skeleton — first end-to-end review (Story 1.4):
  `@agentic-guardrails/cli` ships the `guardrails review` command
  (uncommitted scope) driving the real static pipeline in core — phase 0
  preflight (typed git wrapper, spawn-only, no shell interpolation) → phase 1
  deterministic tier (p-map with per-axiom crash isolation) → phase 4
  aggregation (findings sorted file → line → axiom) → phase 5 composition.
  First real Axiom #1 rule, `structural/circular-import`, detects import
  cycles over the Story-1.3 graph (type-only edges ignored), emitting
  contracts-valid Findings. The review artifact (with the RunManifest
  embedded under its `manifest` key — one visibility-atomic temp-file →
  fsync → rename
  write) lands in `_agentic-guardrails/reviews/uncommitted/<run-id>.json`,
  created on demand; the layout adopts the `reviews/<scope>/` addendum
  default. Run identity is a hash of inputs (no wall clock): identical input
  produces byte-identical artifact JSON at the same path. Absent ledger and
  corpus (both 1.8) are declared with empty-string sha256 sentinels plus
  typed degraded entries — never faked. Exit codes: 0 clean, 1
  error-severity findings, 2 degraded run or preflight failure. First real
  e2e test (`tests/integration/walking-skeleton.e2e.test.ts`) spawns the
  built CLI against temp git repos.
- TypeScript LanguageAdapter + import graph (Story 1.3):
  `@agentic-guardrails/core` ships the `LanguageAdapter` seam and its
  ts-morph-backed `TypeScriptAdapter`, building a deterministic import graph
  (tsconfig `paths` aliases, barrels/re-exports, type-only imports —
  declaration-level and inline modifiers — external packages, plus
  AST-discovered dynamic imports, `import x = require(...)`, and `require`
  calls: literal specifiers resolve via the compiler, non-literal ones
  degrade) returned through the contracts partial-result shape —
  unresolvable imports, unresolved bare specifiers (kept as external nodes
  but flagged unverified), and tsconfig load failures degrade, never throw. `ImportGraph` offers
  byte-stable `serialize()` plus `fanIn`/`fanOut` queries, golden-tested
  against a committed fixture project. `docs/adr/ADR-004-ast-tooling.md`
  accepted.
- Canonical contracts (Story 1.2): `@agentic-guardrails/contracts` now ships
  the full pure-Zod schema surface — `Finding` + line-drift-stable
  `computeFindingId`, `RunManifest`, ADR-001 `axiomEnvelope` factory, config
  schema + generated JSON Schema, generic partial-result/degradation
  contract, OD-1 trend records, DR-1 disposition records, and the
  `migrateArtifact` versioned-artifact migration ladder (with committed v1
  golden fixtures). `zod` ^4 is the package's only runtime dependency
  (test-asserted). `docs/adr/ADR-001-llm-envelope.md` accepted.
- pnpm-workspaces monorepo scaffold for the v2 runtime: `packages/contracts`
  (`@agentic-guardrails/contracts`) and `packages/core`
  (`@agentic-guardrails/core`), ESM-only, built with tsup, typechecked via
  `tsc -b` project references.
- Forbidden-import lint wall keeping `core` LLM-free (ADR-005): ESLint
  `no-restricted-imports` scoped to `packages/core/**/src`, plus
  `scripts/check-boundaries.mjs` for a structural dependency check across
  package manifests. Both are covered by self-guarding unit tests.
- `.github/workflows/ci.yml` — lint, typecheck, boundary check, build, and
  test gate every PR and push to `main`.
- Changesets configured (`.changeset/config.json`, `baseBranch: "main"`,
  `access: "public"`) for future multi-package SemVer releases; no publish
  workflow yet (nothing is published before M4).
- `docs/adr/ADR-002-repo-layout.md` and `docs/adr/ADR-005-contracts-package.md`.

## [1.0.0] - 2026-04-16

### Added
- `/cleanup` — targeted cleanup pass on branch-changed files before a PR
- `/sweep` — full directory technical debt audit
- `/security-scan` — security and vulnerability scan with severity levels
- `/review` — uncommitted change review covering staged, unstaged, and untracked files
- `engineering-standards` skill — universal type safety, logging, tenant isolation, and testing standards
- Test fixtures in `tests/fixtures/` with known violations for each command
