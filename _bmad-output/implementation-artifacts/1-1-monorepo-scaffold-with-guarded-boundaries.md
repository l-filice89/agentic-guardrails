---
baseline_commit: 301a201b6e7dfaefd35f77abc560f858e34910eb
---

# Story 1.1: Monorepo Scaffold with Guarded Boundaries

Status: review

## Story

As a maintainer,
I want a pnpm-workspaces monorepo whose package boundaries are lint-enforced from the first commit,
so that the vendor-decoupling wall (`core` is LLM-free) is a build failure, not an intention.

## Acceptance Criteria

1. **Given** a fresh clone on Node.js 24 LTS (Windows, macOS, or Linux),
   **When** `pnpm install && pnpm -r build && pnpm -r test` runs,
   **Then** all workspace packages (`contracts`, `core` at minimum) build in topological order via TS project references,
   **And** `packageManager` and `engines` pin pnpm 11.x / Node 24, all packages are ESM-only (`"type": "module"`), and builds use tsup.

2. **Given** any source file in `packages/core` that imports from an LLM package or SDK,
   **When** lint runs (locally or in CI),
   **Then** the forbidden-import rule fails the build with a message naming the violated boundary.

3. **Given** a pull request to this repo,
   **When** the CI workflow runs,
   **Then** lint, typecheck, and test execute and gate the PR,
   **And** Changesets is configured for SemVer release management.

## Tasks / Subtasks

- [x] Task 1: Workspace root scaffold (AC: #1)
  - [x] Create root `package.json`: `"private": true`, `"type": "module"`, `packageManager: "pnpm@11.x.y"` (exact version required by the field spec — pick current pnpm 11 stable), `engines: { "node": ">=24 <25", "pnpm": ">=11 <12" }` (AC-1 requires *both* `packageManager` and `engines` to pin pnpm 11.x / Node 24), scripts `build`/`test`/`lint`/`typecheck` delegating to `pnpm -r` / eslint / `tsc -b`
  - [x] Create `pnpm-workspace.yaml` with `packages: ["packages/*"]`
  - [x] Add `.npmrc` with `engine-strict=true` so the Node/pnpm pins actually enforce
  - [x] Extend existing `.gitignore` (do not replace it) with `node_modules/`, `dist/`, `dist-types/`, `*.tsbuildinfo`, `*.stackdump` (a stray `bash.exe.stackdump` sits in the root — never commit it)
  - [x] Create `tsconfig.base.json` (shared compiler options: `strict`, `module`/`moduleResolution` `NodeNext`, `target ES2023`, `composite: true`, `declaration: true`) and solution-style root `tsconfig.json` with `references` to both packages
  - [x] **Build/typecheck split (read before wiring):** `pnpm -r build` gets its topological order from pnpm's *workspace dependency graph* (core depends on contracts), while TS project references serve `tsc -b` incremental typecheck — both AC-1 clauses are satisfied, by different mechanisms. To avoid emit collisions: **tsup owns `dist/`** (JS + `.d.ts` via `dts: true`); **`tsc -b` is typecheck-only** — set `emitDeclarationOnly: true` in the base config with `declarationDir` pointing at a gitignored `dist-types/` (composite mode must emit *something*; `--noEmit` is not valid with `tsc -b`). Nothing consumes `dist-types/`; package `exports`/`types` fields point at tsup's `dist/`
- [x] Task 2: `contracts` and `core` package shells (AC: #1)
  - [x] `packages/contracts`: `package.json` name `@agentic-guardrails/contracts`, ESM-only, tsup build, minimal `src/index.ts` (placeholder export — real schemas are Story 1.2; do NOT add zod yet) + one trivial colocated `*.test.ts`
  - [x] `packages/core`: `package.json` name `@agentic-guardrails/core`, depends on `@agentic-guardrails/contracts` via `workspace:*`, minimal `src/index.ts` importing something from contracts (proves topological build) + one trivial colocated `*.test.ts`
  - [x] Per-package `tsconfig.json` extending the base; `core` declares a project `reference` to `contracts`
  - [x] Per-package `tsup.config.ts`: ESM format only, `dts: true`, entry `src/index.ts`
  - [x] Verify build order: `pnpm -r build` must build `contracts` before `core`
- [x] Task 3: Vitest wiring (AC: #1, #3)
  - [x] Root `vitest.config.ts` using `projects`: `unit` (colocated `packages/**/src/**/*.test.ts`) and `integration` (`tests/integration/**/*.test.ts` — glob may match nothing yet; set `passWithNoTests: true` so the empty integration project does not fail the run)
  - [x] **AC-1's oracle is `pnpm -r test`, which runs each package's own `test` script — every package MUST have one.** Give `contracts` and `core` a `"test": "vitest run"` script (Vitest resolves the root config from the workspace root; verify colocated tests are found when invoked from the package dir — if not, pass an explicit `--config` path with a relative root)
  - [x] Root `"test"` script runs Vitest across all projects; both `pnpm test` (root) and `pnpm -r test` (AC oracle) must pass with the two trivial package tests actually executing (not zero tests collected)
- [x] Task 4: Forbidden-import lint wall (AC: #2)
  - [x] Root `eslint.config.js` (flat config, ESM) with typescript-eslint; scope: `packages/**/src/**/*.ts` only — MUST NOT lint the legacy `commands/`, `skills/`, `tests/fixtures/` content
  - [x] Add `no-restricted-imports` override scoped to `packages/core/**`: use **`patterns`** entries (not just `paths` — subpaths like `@anthropic-ai/sdk/messages` must also be caught): `@agentic-guardrails/llm`, `@agentic-guardrails/llm/*`, plus known LLM SDK roots and their subpaths (`@anthropic-ai/sdk`, `openai`, `ollama`, `@google/generative-ai`, each with `/*` variant) with a message naming the violated boundary, e.g. "core is LLM-free (ADR-005): move LLM calls behind the envelope in @agentic-guardrails/llm"
  - [x] Add a CI-run dependency check script (`scripts/check-boundaries.mjs`; the `scripts/` dir is a deliberate, allowed addition beside the architecture tree): enforce the **structural** rule — `core`'s only permitted `@agentic-guardrails/*` dependency is `contracts`, and `contracts` may depend on no workspace package — plus the LLM SDK denylist across dependencies/devDependencies/peerDependencies of both packages (defense-in-depth: a newly-named SDK shouldn't defeat the wall). Wire it into the root `lint` or a `check` script that CI runs
  - [x] **The wall must be self-guarding, not manually verified:** add a unit test that loads `eslint.config.js` via the ESLint Node API (`new ESLint(...)` + `lintText`) with a synthetic `filePath` under `packages/core/src/`, lints `import '@anthropic-ai/sdk'` and `import '@agentic-guardrails/llm'`, and asserts the boundary error fires — this catches a silently-dead override glob forever. Also unit-test `check-boundaries.mjs` (pure function over package.json objects). Additionally do one manual verify (forbidden import in a real core file → lint fails → revert) and record it in the Dev Agent Record
- [x] Task 5: CI workflow (AC: #3)
  - [x] `.github/workflows/ci.yml`: trigger on `pull_request` + `push` to `main`; job matrix or single job on `ubuntu-latest` (Windows runner validation is SPIKE-5/Story 1.14 scope — do not add a Windows leg yet); steps: checkout → `pnpm/action-setup` (version from `packageManager`) → `actions/setup-node` with `node-version: 24` + pnpm cache → `pnpm install --frozen-lockfile` → lint → typecheck (`tsc -b`) → boundary check → `pnpm -r build` → test
  - [x] Commit `pnpm-lock.yaml`
- [x] Task 6: Changesets (AC: #3)
  - [x] `pnpm add -Dw @changesets/cli` then `pnpm changeset init`; set `.changeset/config.json` `baseBranch: "main"`, access `public` (packages publish publicly at M4; harmless now)
  - [x] Do NOT add a release/publish workflow — nothing is published before M4 (PRD constraint); Changesets is configured, not activated
- [x] Task 7: ADRs + docs (Definition of Done — project-context rule: docs + ADR land in the same PR)
  - [x] `docs/adr/ADR-002-repo-layout.md`: hand-rolled pnpm-workspaces monorepo, TS project references, build order `contracts → core → {llm, cli} → {action, plugin}`, Turborepo deferred (Rule of Three), Bun declined (dev-tool-only; parity + Windows risk)
  - [x] `docs/adr/ADR-005-contracts-package.md`: standalone pure-Zod `contracts` package as single source of truth; `core` LLM-free enforced by forbidden-import lint + dependency check + pnpm `workspace:*` strict isolation
  - [x] Use a consistent ADR format (Status/Context/Decision/Consequences); these are the first files in `docs/adr/` — the format you set becomes the template. Note in each ADR's header block (or a `docs/adr/README.md` index) that ADR-001 (LLM envelope), ADR-003 (orchestration), and ADR-004 (AST tooling) land with the stories that realize them (1.2, 1.7, 1.3 respectively) — the numbering gap is intentional
  - [x] Update `README.md`: add a "v2 runtime (work in progress)" section describing the monorepo layout and dev commands (`pnpm install`, `pnpm -r build`, `pnpm test`), explicitly noting the legacy plugin remains functional and installable as documented; keep all existing legacy install docs intact
  - [x] Update `CHANGELOG.md` (Keep a Changelog format) under a new Unreleased/Added entry

## Dev Notes

### Critical constraints (violating any of these fails review)

- **Legacy coexistence — do not touch:** `commands/`, `skills/engineering-standards/`, `tests/fixtures/dirty-*.ts(x)`, `tests/EXPECTED.md`, `tests/setup.sh` are the live legacy plugin and its test oracle. Decommission is M4. Never "clean up" the dirty fixtures. The new `eslint`/`tsc`/`vitest` configs must be scoped so they never process those files.
- **The old "no build step" rule is dead for the new code:** project-context.md forbids adding `package.json`/`tsconfig.json` — that constraint is explicitly reversed for the rework ("Applies only to the legacy code"). This story introduces the build system deliberately.
- **ESM-only everywhere:** `"type": "module"` in every package.json; tsup emits ESM only; use `import.meta.url`, never `__dirname`. TS `module`/`moduleResolution`: `NodeNext`.
- **All paths via `node:path`** in any script you write (Windows is a first-class target; dev machine is Windows).
- **Package naming:** scoped `@agentic-guardrails/{contracts,core}`; files kebab-case; types PascalCase.
- **Licensing (PRD constraint):** the v2 runtime is **Apache-2.0**; the legacy plugin stays MIT (the root `LICENSE` file is the legacy one — leave it). Every new `packages/*/package.json` declares `"license": "Apache-2.0"`; per-package LICENSE files are an M4 packaging concern.
- **Scope discipline:** contracts gets NO zod and NO real schemas (Story 1.2); no `llm`/`cli`/`action`/`plugin` packages yet (created by the stories that need them); no ts-morph (1.3); no pipeline code (1.4). The lint rule references `@agentic-guardrails/llm` before that package exists — that is correct and intentional (the wall predates the tenant).

### Environment facts (verified on this machine, 2026-07-04)

- Node v24.6.0 is installed; **pnpm is NOT installed.** Bootstrap via `npm i -g pnpm@11` (unambiguous path; corepack ships with Node 24 but is deprecated and warns — don't rely on it). CI uses `pnpm/action-setup` reading the `packageManager` field.
- Repo root already contains `.gitignore`, `README.md`, `CHANGELOG.md`, `LICENSE`, legacy dirs, `_bmad*/` planning dirs, and a stray `bash.exe.stackdump` (never commit it; `*.stackdump` goes in `.gitignore` per Task 1).
- Current branch: `feat/epic-1/deterministic-review`. Work happens here.

### Architecture compliance checklist

- Root files exactly per the architecture tree: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.changeset/`, `.github/workflows/ci.yml`, `docs/adr/`. [Source: architecture.md#Complete Project Directory Structure]
- Dependency direction `contracts → core → {llm, cli} → {action, plugin}` is one-way and lint-enforced from this commit. [Source: architecture.md#Architectural Boundaries]
- `pnpm -r` topological build + TS project references; **no Turborepo** (deferred, Rule of Three). [Source: architecture.md#Verified Toolchain Baseline]
- Hybrid test layout: colocated `*.test.ts` unit tests; top-level `tests/` reserved for integration/parity (legacy fixtures already live under `tests/fixtures/` — architecture explicitly plans for them there). [Source: architecture.md#Structure & Module Conventions]
- Toolchain versions (June 2026 baseline): pnpm 11.x, tsup latest, Vitest latest, typescript-eslint flat config, Changesets. Resolve exact current versions at implementation time; do not downgrade majors. [Source: architecture.md#Verified Toolchain Baseline]

### Testing requirements

- `pnpm install && pnpm -r build && pnpm -r test` green from a fresh clone is the AC-1 oracle — run it after `git clean`-style verification if possible (at minimum: delete `node_modules`, reinstall, full build+test).
- Trivial tests are placeholders proving the harness, e.g. contracts exports a `CONTRACTS_PACKAGE` sentinel string and core re-exposes it; both asserted.
- The forbidden-import wall carries three layers of proof: (a) the automated ESLint-API unit test (lintText with a `packages/core/src/` filePath — the regression guard), (b) the `check-boundaries.mjs` unit test (pure function over package.json objects), (c) one recorded manual verify (forbidden import in a real core file → lint fails → revert).
- `pnpm -r test` (the AC oracle) must collect and run ≥1 test per package — a zero-tests-collected pass is a fail.

### Project Structure Notes

- New code lives only under `packages/`, `scripts/`, `docs/adr/`, `.github/`, `.changeset/` + root config files. No conflicts with legacy paths.
- `docs/` exists and is empty — `docs/adr/` is new.
- `tests/integration/` may be created empty (or left uncreated) — first real integration test arrives with Story 1.4.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1] — story + ACs
- [Source: _bmad-output/planning-artifacts/architecture.md#Starter Template Evaluation] — no starter, Node 24 LTS, Bun declined, toolchain baseline
- [Source: _bmad-output/planning-artifacts/architecture.md#Core Architectural Decisions] — ADR-002/ADR-005 content to be recorded
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries] — directory tree, dependency direction, build & distribution
- [Source: _bmad-output/project-context.md] — DoD includes docs+ADR same PR; legacy rules scope
- [Source: _bmad-output/planning-artifacts/implementation-readiness-report-2026-07-04.md#Findings] — enabler-story framing accepted; no blockers

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Fable 5) — implementation started in a prior session and was interrupted mid-verification; resumed and completed 2026-07-04.

### Debug Log References

- Manual verify of the forbidden-import wall (Task 4, recorded as required): with `import "@anthropic-ai/sdk";` planted in `packages/core/src/index.ts`, `pnpm run lint` failed with exit code 1: `error '@anthropic-ai/sdk' import is restricted from being used by a pattern. core is LLM-free (ADR-005): move LLM calls behind the envelope in @agentic-guardrails/llm  no-restricted-imports`. The import was then reverted and lint passed clean.
- Clean-state AC-1 oracle: deleted all `node_modules`, `pnpm install` (lockfile reuse, 252 packages), `pnpm -r build` (contracts built before core — topological order confirmed), `pnpm -r test` (13 tests per package invocation, 0 failures), `pnpm test` (4 files / 13 tests, 0 failures).
- Full gate suite green: `pnpm run lint`, `pnpm run typecheck` (`tsc -b`), `pnpm run check:boundaries`, `pnpm -r build`, `pnpm -r test`, `pnpm test`.

### Completion Notes List

- Toolchain resolved at implementation time: pnpm 11.9.0 (pinned via `packageManager` + `engines` + `.npmrc` `engine-strict=true`), TypeScript 6.0.3, tsup 8.5.1, Vitest 4.1.9, ESLint 10.6.0 + typescript-eslint 8.62.1, @changesets/cli 2.31.0. Node >=24 <25.
- Build/typecheck split implemented per Dev Notes: tsup owns `dist/` (ESM + `.d.ts` via `dts: true`); `tsc -b` is typecheck-only with `emitDeclarationOnly: true` emitting into gitignored `dist-types/` (nothing consumes it); package `exports`/`types` point at tsup's `dist/`.
- `vitest.config.ts` pins `root` to the repo root via `import.meta.url` so `pnpm -r test` (which runs from each package dir) resolves the same project globs as the root run — this is how the AC-1 oracle collects tests from package cwd without per-package configs. A third `tooling` Vitest project was added for `scripts/**/*.test.mjs` (the two self-guard test suites); the `integration` project has `passWithNoTests: true` as specified.
- The wall is three-layered as specified: (a) ESLint `no-restricted-imports` with `patterns` (subpaths caught), scoped to `packages/core/**/src/**/*.ts`, self-guarded by `scripts/eslint-core-boundary.test.mjs` via the ESLint Node API (4 tests incl. the allowed-contracts negative case); (b) `scripts/check-boundaries.mjs` structural manifest check (pure `checkBoundaries` function, 6 unit tests) wired as root `check:boundaries` and run in CI; (c) the recorded manual verify above.
- Legacy coexistence honored: `eslint.config.js` globally ignores `commands/`, `skills/`, `tests/`, `_bmad*/`; vitest projects only include `packages/**/src`, `scripts/`, and (empty) `tests/integration/`; no legacy file was modified.
- Changesets configured (`baseBranch: "main"`, `access: "public"`), deliberately no release/publish workflow (pre-M4 constraint).
- Deviation from literal subtask text: story said scope the lint override to `packages/core/**` — implemented as `packages/core/**/src/**/*.ts`, tighter and matching the "wall protects core's src tree" intent; the self-guard test proves it fires.
- Deferred items D1 (branch-protection is repo-admin config, not code) and D2 (solution tsconfig `files: []`, target ES2023 chosen) logged in `epic-1-deferred-items.md`; D2 is now resolved by the implementation as recorded here.
- `pnpm-workspace.yaml` carries `allowBuilds: { esbuild: true }` so pnpm 11 permits esbuild's postinstall (required for tsup) without interactive approval.

### File List

New (root):
- package.json
- pnpm-workspace.yaml
- pnpm-lock.yaml
- .npmrc
- tsconfig.base.json
- tsconfig.json
- vitest.config.ts
- eslint.config.js

New (packages):
- packages/contracts/package.json
- packages/contracts/tsconfig.json
- packages/contracts/tsup.config.ts
- packages/contracts/src/index.ts
- packages/contracts/src/index.test.ts
- packages/core/package.json
- packages/core/tsconfig.json
- packages/core/tsup.config.ts
- packages/core/src/index.ts
- packages/core/src/index.test.ts

New (tooling / CI / docs):
- scripts/check-boundaries.mjs
- scripts/check-boundaries.test.mjs
- scripts/eslint-core-boundary.test.mjs
- .github/workflows/ci.yml
- .changeset/config.json
- docs/adr/README.md
- docs/adr/ADR-002-repo-layout.md
- docs/adr/ADR-005-contracts-package.md
- _bmad-output/implementation-artifacts/epic-1-deferred-items.md

Modified:
- .gitignore
- README.md
- CHANGELOG.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/1-1-monorepo-scaffold-with-guarded-boundaries.md

## Change Log

- 2026-07-04 — Story 1.1 implemented: pnpm-workspaces monorepo scaffold (`contracts`, `core`), forbidden-import lint wall + structural boundary check with self-guarding tests, Vitest wiring, CI workflow, Changesets config, ADR-002/ADR-005 + README/CHANGELOG updates. All gates green from a clean install. Status → review.
