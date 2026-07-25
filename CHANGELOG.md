# Changelog

All notable changes to this project will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- Axiom #6 conformance analyzer (Story 1.13, `rulesetVersion: 6`, documented
  in `docs/rules/axiom-6-conformance.md`): the fifth registered deterministic
  analyzer and the first consumer of the Story-1.8 structural corpus seed.
  Three prevalence-gated rules, all `severity: "warning"` —
  `conformance/naming-convention`, `conformance/file-placement` and
  `conformance/module-shape` — each judged against the nearest directory
  scope that holds ≥ `MIN_SAMPLE` (10) classifiable corpus files with a ≥
  `DOMINANCE` (0.8) majority; below either bar the analyzer says nothing, and
  every message cites the measured counts and the scope. A file is judged on
  naming/placement only where its path is NEW to the corpus (its presence
  there means the decision pre-dates the diff), and module-shape ignores
  import edges originating in the change set: a diff can never confirm the
  convention it is judged by. An ABSENT seed is inconclusive — zero findings
  plus one declared, exit-neutral degradation, now printed as a
  `guardrails review: inconclusive: …` line; a present-but-corrupt seed is a
  real degradation and exits 2 like any other lost coverage.
- `AnalyzerResult.declaredOnly`: analyzers DECLARE which of their
  degradations are exit-neutral instead of the pipeline string-matching
  reasons. Sorted like every sibling list before it reaches the artifact.
- `manifest.corpusSeedHash`: the structural corpus seed axiom-6 findings were
  measured against, so they are reproducible from the manifest. Distinct from
  `corpusHash` (the committed `corpus-map.yaml`). The seed is read once per
  run and the same bytes feed the cache key and the analyzer.
- `structuralSeedSchema` now enforces the producer's partial-result invariant
  (`coverage < 1` requires a degraded entry) and rejects duplicate or
  backslash entity paths.

- Axiom #5 security analyzer (Story 1.12, `rulesetVersion: 5`, documented in
  `docs/rules/axiom-5-security.md`): the fourth registered deterministic
  analyzer — the one FR-32 names as gate-critical (every axiom defaults to
  blocking; axiom 5's rule set is error-dense) — with four rules across two
  source tiers. `security/hardcoded-secret` (`source: "regex"`) scans the RAW
  TEXT of EVERY changed file — not just the analyzable-TypeScript subset the
  AST rules see, so a secret in a changed `.env`, `.json`, `.yaml`, `.md`,
  Dockerfile, or `.d.ts` is caught, as are secrets in comments and
  unparseable files: ERROR for pinned near-certain token formats (AWS
  `AKIA…`/`ASIA…` ids, GitHub `gh[pousr]_` tokens and `github_pat_`
  fine-grained PATs, Slack `xox[baprse]…` tokens incl. `xoxe` refresh
  tokens, OpenAI `sk-`/`sk-proj-` keys, Anthropic `sk-ant-` keys,
  private-key PEM headers — these fire even in `.test.`/`__fixtures__`
  paths), WARNING for the heuristic ≥16-char literal assigned OR compared
  (`===`/`!==` — the hardcoded-credential backdoor spelling) to a
  secret-named identifier (name must END in a secret word-part, so
  `tokenizerConfig`/`passwordHintText` never match; whole-text scan catches
  prettier-wrapped assignments; exempt: `process.env`/`import.meta.env`
  references, placeholders anchored at the value start, basename-anchored
  test paths). Vendor-PUBLISHED sample credentials (AWS's
  `AKIAIOSFODNN7EXAMPLE`, GitHub's documented sample PAT) are allowlisted —
  they are published non-secrets. Files over 1 MiB are skipped with a typed
  degradation, the scan honors the phase-1 budget signal between files, and
  matched values are never echoed into messages. `security/injection-sink`
  (warning — the tier cannot prove taint): interpolated/concatenated strings
  into `query`/`execute` member calls or imported `child_process`
  `exec`/`execSync`; static strings never flag, including constant-foldable
  literal+literal concatenation. `security/dangerous-api` (error — the eval
  family has no legitimate application-code idiom): `eval` incl. indirect
  `(0, eval)(…)`/`(eval)(…)` forms, the `Function` constructor in every form
  (`new`, bare call, `globalThis.`/`window.`/`self.`) when its BODY — the
  LAST argument — is a string, so `new Function("x", bodyVar)` never flags;
  string or concatenated `setTimeout`/`setInterval` arguments; `vm`
  `runIn*`/`compileFunction` and `new vm.Script`.
  `security/unsafe-deserialization`: `unserialize` from a
  `node-serialize`-family import errors (known RCE vector); `v8.deserialize`
  warns (legitimate for trusted IPC). AST rules ride the shared
  changed-files parse with the 1.11 shadowing-immune symbol-resolved
  bindings (a local `eval` wrapper or shadowed import never flags); analyzed
  code is parsed as data, never executed (sentinel-tested). `AnalyzerContext`
  gains `allChangedFiles` (the raw pre-filter change list) for the secret
  scan, and axiom 5's findings cache key covers every changed file's content
  hash. Axiom 5 leaves `ANALYZERLESS_KNOWN_AXIOMS` (now empty); the violation
  fixture's oracle run exits 1 under default config (blocking, FR-32).
  ENGINE_VERSION stays 0.0.3 (no cached-payload schema change) —
  RULESET_VERSION alone invalidates the findings cache.

- Axiom #4 NFR analyzer (Story 1.11, `rulesetVersion: 4`, documented in
  `docs/rules/axiom-4-nfr.md`): a third registered deterministic analyzer
  with three structural-tier rules over changed files (no import graph) —
  `nfr/unbounded-promise-all` (`Promise.all`/`allSettled`/`any`/`race` over
  a dynamically sized array: `.map` results, bare identifiers/calls, spreads
  of non-literals; only RECURSIVELY fixed-arity array literals are exempt),
  `nfr/sync-io-in-async` (a `*Sync` member of an imported `fs`,
  `child_process`, `zlib`, or `crypto` binding — bare or `node:`-prefixed;
  named/renamed/namespace/default/`{ default as x }` forms — called where
  the NEAREST enclosing function-like is `async`; module-top-level
  config-load reads, class field initializers, and static blocks stay
  exempt), and `nfr/missing-abort-signal` (a global `fetch` call whose
  options provably lack a signal: absent, `undefined`, `null`, or an options
  literal without `signal` — incl. a literal `signal: undefined`;
  non-literal and spread-carrying options are a stated ceiling, never
  flagged). Zero-false-positive binding checks: `fetch`/`Promise` flag only
  when they resolve to the ambient global (DI parameters, local wrappers,
  and wrapper-module imports are skipped), sync-IO calls only when they
  resolve to the tracked import binding's symbol; `globalThis`/`window`/
  `self` property access and string-literal bracket access are covered. ALL
  severities are `warning` by design — the structural tier flags hazard
  patterns without runtime context, so it never blocks on its own (axiom 4
  cannot gate in Epic 1; Epic 3's LLM tier is where severity can rise); the
  violation fixture's oracle run exits 0 with findings persisted.
  ENGINE_VERSION stays 0.0.3 (no cached-payload schema change) —
  RULESET_VERSION alone invalidates the findings cache.
- Shared changed-files parse pass (`packages/core/src/analyzers/changed-files.ts`):
  axiom 3 and axiom 4 consume ONE parse-only ts-morph pass per run through a
  run-local `changedFilesCache.acquire` seam on the analyzer context (same
  synchronous-memo discipline as the graph cache), with the phase-1 budget
  signal checked between files and per-file read failures declared as typed
  degradations ("changed file could not be read" — ts-morph parses any text;
  only the read can fail).

- Axiom #3 cleanliness analyzer (Story 1.10, `rulesetVersion: 3`,
  `engineVersion: 0.0.3`, documented in `docs/rules/axiom-3-cleanliness.md`):
  a second registered deterministic analyzer with four AST-tier rules over
  changed files — `cleanliness/unreachable-code` (error — statements after a
  terminal `return`/`throw`/`break`/`continue` in the same block),
  `cleanliness/unused-export` (warning — an exported symbol in a changed
  file that no project file imports by name; namespace/`export *`/dynamic
  importers count as using all exports, `export default` tracked as
  "default", type-only usage counts, and zero-importer files are exempt
  entirely as indistinguishable from entry points),
  `cleanliness/duplicate-code` (warning — two ≥5-statement function-like
  bodies among the changed files with identical normalized structure,
  identifiers/literals folded; one finding per pair at the later occurrence
  naming the original), and `cleanliness/excessive-complexity` (warning —
  cyclomatic complexity > 15 per function-like, threshold hardcoded with
  rationale). Import-graph edges now carry the per-edge imported binding
  `names` (`*` for whole-namespace usage, `default` for default imports;
  unioned across deduped same-identity edges) — the usage substrate that
  makes unused-export graph-cheap. The cached-graph payload schema change
  is paired with the ENGINE_VERSION bump so pre-1.10 cache entries become
  clean key misses, never corruption-flavored degradations. Within one run
  the graph build is shared between the two analyzers via a run-local memo
  (one parse per tsconfig; intra-run reuse never inflates the persistent
  hit/miss counters), and identical graph-build degradations declared by
  both analyzers are deduplicated at aggregation.
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

### Changed
- Config plane: `configSchema` no longer injects a synthetic
  `axioms: {"5": {enforcement: "blocking"}}` entry into every parsed config.
  The gate's `EFFECTIVE_DEFAULTS` already blanket every unconfigured axiom
  with `blocking`/`maxFindings: 0`, so the injection changed no gating —
  its only observable effect was a spurious "axioms.5 matches no known
  axiom" warning and a phantom entry in `manifest.enforcement`. A parsed
  config now carries exactly what the consumer wrote
  (`config.schema.json` regenerates accordingly).
- The CLI's axiom-4 report label was `nfr` all along but is now pinned by a
  coupling test: every axiom in `DEFAULT_ANALYZERS` must have an explicit
  `AXIOM_CATEGORY` label — registering an analyzer without one would print
  "uncategorized".

### Fixed
- Docs/README/rule-doc wording: "the ONE axiom that defaults to blocking"
  was false — `EFFECTIVE_DEFAULTS` makes EVERY axiom blocking by default;
  axiom 5's distinction is FR-32 naming it plus its error-dense rule set.

## [1.0.0] - 2026-04-16

### Added
- `/cleanup` — targeted cleanup pass on branch-changed files before a PR
- `/sweep` — full directory technical debt audit
- `/security-scan` — security and vulnerability scan with severity levels
- `/review` — uncommitted change review covering staged, unstaged, and untracked files
- `engineering-standards` skill — universal type safety, logging, tenant isolation, and testing standards
- Test fixtures in `tests/fixtures/` with known violations for each command
