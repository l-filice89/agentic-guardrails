# ADR-002: Repo Layout — pnpm Workspaces + TS Project References

## Status

Accepted — 2026-07-04 (Story 1.1)

## Context

The v2 runtime is a multi-package Node/TypeScript engine (`contracts`, `core`, and
later `llm`, `cli`, `action`, `plugin`) that must enforce a one-way dependency
direction — `contracts → core → {llm, cli} → {action, plugin}` — as a build
failure, not a convention. The engine must build in topological order, install
reproducibly across Windows/macOS/Linux, and stay lightweight for a
single-maintainer project through M1.

Three shapes were considered:

1. **Hand-rolled pnpm-workspaces monorepo + TS project references** (chosen).
2. **Turborepo** on top of pnpm workspaces, for cached/parallel task execution.
3. **Bun workspaces**, replacing both the package manager and the runtime.

## Decision

Adopt a **hand-rolled pnpm-workspaces monorepo** (`pnpm-workspace.yaml`,
`packages/*`) with **TypeScript project references** (`tsconfig.json` solution
file + per-package `tsconfig.json` with `references`) for incremental
typechecking.

- **Build order**: `contracts → core → {llm, cli} → {action, plugin}`. `pnpm -r
  build` derives topological order from the pnpm workspace dependency graph
  (each package's `workspace:*` dependencies); `tsc -b` derives it independently
  from TS project references. Both mechanisms enforce the same order for
  different concerns (bundling vs. typechecking), and either one failing to
  build in order is itself a signal something is wrong with the declared
  dependency graph.
- **Build/typecheck split**: tsup owns `dist/` (bundled ESM + `.d.ts` via
  `dts: true`) — this is what packages publish and what other packages'
  `exports`/`types` fields point at. `tsc -b` is typecheck-only: composite mode
  requires *some* emit (`--noEmit` is invalid with `tsc -b`), so the base
  tsconfig sets `emitDeclarationOnly: true`, and each package's own tsconfig
  sends output to a package-local, gitignored `dist-types/` that nothing
  consumes. This avoids emit collisions between the two tools while satisfying
  both AC-1 clauses (topological build, and a working `tsc -b` typecheck).
- **Turborepo — deferred (Rule of Three).** `pnpm -r` topological build/test is
  sufficient at this scale (two packages, M1). Turborepo's value (task caching,
  parallel scheduling across a large graph) doesn't pay for its
  configuration/maintenance cost yet. Revisit once `pnpm -r build`/`test` time
  measurably hurts iteration speed, or the package count grows enough that
  build ordering by hand becomes fragile.
- **Bun — declined.** Bun's `bun install` may be used as an optional *local*
  install accelerator only. It is not adopted as the workspace runtime because
  (a) it is a dev-tool-only bet against a single-maintainer surface — Node
  parity risk is not worth taking on the hot path, and (b) the dev machine and
  CI target are both Windows-relevant, which is precisely where Bun's residual
  (~2-5%) compatibility gap concentrates (fs/path handling — exactly what the
  git worktree-isolation lifecycle leans on). CI, tests, and published
  artifacts all run on Node, so we test what we ship.

## Consequences

- Every new publishable package needs its own `package.json` (ESM-only,
  `"license": "Apache-2.0"`), `tsconfig.json` (extending
  `tsconfig.base.json`), and `tsup.config.ts`.
- The dependency direction is lint-enforced (forbidden-import rule,
  `scripts/check-boundaries.mjs`) from this commit, not left as a convention
  — see ADR-005.
- `pnpm-lock.yaml` is committed; `packageManager` + `engines` pin pnpm 11.x /
  Node 24 so `pnpm/action-setup` and local installs agree.
- Adding Turborepo later is additive (a `turbo.json` beside the existing
  `pnpm -r` scripts) and does not require re-architecting the workspace.
