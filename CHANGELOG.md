# Changelog

All notable changes to this project will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
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
