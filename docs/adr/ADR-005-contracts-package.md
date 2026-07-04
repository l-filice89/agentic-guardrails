# ADR-005: Contracts Package — Standalone Pure-Zod Source of Truth

## Status

Accepted — 2026-07-04 (Story 1.1)

## Context

The engine's core promise is a vendor-decoupling wall: `core` (the
deterministic analysis engine) must never import an LLM SDK or the `llm`
package. Every axiom, analyzer, and future adapter needs a shared, versioned
definition of the data shapes crossing package boundaries (`Finding`,
`RunManifest`, the LLM envelope contract, config, the Conventions
Ledger/Corpus Map, spec/AC records, trend records) — duplicating or
loosely-typing these across packages would let the boundary erode silently.

## Decision

Introduce `packages/contracts` (`@agentic-guardrails/contracts`) as a
**standalone package with zero workspace dependencies**, published
independently, that will hold every cross-package Zod schema (real schemas
land in Story 1.2 — this story only establishes the package shell and build
harness). `core`, `llm`, `cli`, `action`, and `plugin` all depend on
`contracts` via `workspace:*`; `contracts` depends on none of them.

The `core` → LLM-free boundary (the wall this ADR and ADR-002 exist to
protect) is enforced by three independent, mutually-reinforcing layers, not
by convention or code review alone:

1. **ESLint `no-restricted-imports`** (`eslint.config.js`), scoped to
   `packages/core/**/src/**/*.ts`, using `patterns` (not just `paths`) so
   subpaths like `@anthropic-ai/sdk/messages` are caught too. Fires at
   lint time, locally and in CI, with a message naming the violated
   boundary.
2. **`scripts/check-boundaries.mjs`** — a structural, filesystem-independent
   check over `package.json` manifests: `core`'s only permitted
   `@agentic-guardrails/*` dependency is `contracts`; `contracts` may depend
   on no workspace package; and neither package may declare a known LLM SDK
   as a dependency/devDependency/peerDependency. This is defense-in-depth —
   it catches the case where an LLM SDK is added to a manifest without any
   source file importing it yet (e.g., a stray devDependency), which the
   ESLint rule alone would not see.
3. **pnpm `workspace:*` strict isolation** — pnpm workspaces do not hoist
   dependencies across package boundaries by default, so `core` cannot
   accidentally resolve an SDK that only `llm` declares.

Both automated layers (1) and (2) carry their own regression tests: an
ESLint Node API test (`lintText` with a synthetic `packages/core/src/`
`filePath`) proves the rule actually fires rather than silently no-op'ing on
a dead `files` glob, and a unit test exercises `checkBoundaries` as a pure
function over representative `package.json` shapes.

## Consequences

- `contracts` stays dependency-light by design (no Zod added yet — Story
  1.2). Any future dependency added to `contracts` is itself a signal to
  revisit this ADR.
- Every package that needs a shared data shape imports it from `contracts`
  rather than redefining it, keeping `Finding`/`RunManifest`/envelope/etc.
  single-sourced.
- The three-layer boundary means a single missed case (e.g., someone
  disabling ESLint inline, or hand-editing a lockfile) does not silently
  defeat the wall — the structural check and pnpm isolation remain.
- New LLM SDKs must be added to the denylist in both `eslint.config.js` and
  `scripts/check-boundaries.mjs` to stay covered; this is a known
  maintenance surface, documented here rather than hidden.
