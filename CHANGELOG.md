# Changelog

All notable changes to this project will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
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
