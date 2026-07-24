---
title: 'Story 1.3: TypeScript LanguageAdapter and Import Graph'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: bae980873d6ee79214d7a30321c7e3346e17d2e1
review_loop_iteration: 0
followup_review_recommended: true # AUTO-FORCED: high-severity inline finding (silent-omission contract violation)
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** Analyzers need module resolution that matches what the TypeScript compiler actually does (path aliases, barrels, re-exports, dynamic imports) — naive path joining would make every downstream axiom wrong on real repos.

**Approach:** Add a `LanguageAdapter` seam in `core` with a ts-morph-backed TypeScript implementation that builds a deterministic import/dependency graph, returned through the contracts partial-result shape, with fan-in/fan-out queries. Ship ADR-004 (AST tooling) in the same change.

## Boundaries & Constraints

**Always:**
- Lives in `packages/core`; runtime deps allowed: `ts-morph` 28.x + `@agentic-guardrails/contracts`. Boundary walls stay green (ts-morph is not an LLM SDK).
- Analyzed code is parsed as **data**, never executed/imported.
- All graph reads return the contracts `partialResult` shape; an unresolvable import yields a typed `degraded` entry and `coverage < 1` — never a throw, never silent omission.
- Determinism: identical input ⇒ byte-identical serialized graph (stable sort of nodes/edges, no wall-clock, no randomness; paths normalized to `/` separators, repo-relative).
- Golden fixtures are committed under a top-level `tests/__fixtures__/` tree (hybrid test layout) and exercised by integration tests in `tests/integration/`.
- ADR-004 (AST tooling: ts-morph LanguageAdapter) + docs land in this same change (DoD rule; ADR README row flips Planned → Accepted).

**Block If:**
- ts-morph 28.x cannot load under the pinned TS 6 toolchain (peer conflict or runtime failure) — that is a toolchain decision for a human.

**Never:**
- No LLM anything. No analyzer rules (1.9+ scope). No caching layer (1.7 scope). No support for languages other than TypeScript/TSX (adapter interface exists, one implementation — that is the point of the seam, not speculative multi-language machinery). No file watching.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Path alias | fixture importing via `@alias/*` from tsconfig `paths` | edge resolves to the aliased file | No error expected |
| Barrel + re-export | `import { x } from "./barrel"` where barrel re-exports from `./impl` | edge to the barrel file; re-export chain queryable to `./impl` | No error expected |
| Dynamic import | `await import("./lazy")` | edge present, flagged `dynamic: true` | No error expected |
| Unresolvable import | `import "./does-not-exist"` | graph still built; `degraded` entry naming file + specifier; `coverage < 1` | typed degradation, no throw |
| External package import | `import { z } from "zod"` | recorded as external node/edge (not followed into node_modules) | No error expected |
| Type-only import | `import type { T } from "./types"` | edge present, flagged `typeOnly: true` | No error expected |
| Determinism | same fixture built twice | identical serialized bytes | n/a |
| Fan-in/fan-out | any file node in the graph | `fanIn(file)` / `fanOut(file)` counts + edge lists | unknown file → empty result, degraded entry |

</intent-contract>

## Code Map

- `packages/core/src/index.ts` -- placeholder; becomes barrel exporting adapter + graph API
- `packages/core/package.json` -- add `ts-morph` runtime dep
- `packages/contracts/src/partial-result.ts` -- `partialResult(schema)` shape to return (coverage < 1 requires degraded entries — refine added in 1.2)
- `packages/core/tsconfig.json` -- references contracts; NodeNext ESM
- `tests/e2e-coverage.md` -- add story 1.3 row
- `docs/adr/README.md` -- ADR-004 row flips Planned → Accepted
- `vitest.config.ts` -- `integration` project already globs `tests/integration/**/*.test.ts`

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/package.json` -- add `ts-morph@^28` to dependencies -- adapter backend
- [x] `packages/core/src/adapter/language-adapter.ts` -- `LanguageAdapter` interface: `buildImportGraph(options) => PartialResult<ImportGraph>`; graph types (`ImportGraphNode {file, external}`, `ImportGraphEdge {from, to, dynamic, typeOnly, reExport}`) as Zod schemas via contracts `partialResult` -- the seam analyzers depend on
- [x] `packages/core/src/adapter/typescript-adapter.ts` -- ts-morph implementation: load tsconfig (respecting `paths`), walk source files, resolve static/dynamic/type-only imports + re-exports; unresolvable specifier → degraded entry + coverage accounting; external packages recorded but not traversed; never executes analyzed code -- the one real adapter
- [x] `packages/core/src/graph/import-graph.ts` -- graph container: stable-sorted serialization (`serialize()` → canonical JSON string), `fanIn(file)`/`fanOut(file)` queries returning counts + edges, path normalization (`/`, repo-relative) -- determinism + 1.8/1.9 consumers
- [x] `packages/core/src/index.ts` -- export adapter interface, TypeScript adapter, graph API (keep existing exports compiling) -- surface
- [x] `tests/__fixtures__/import-graph/` -- committed golden fixture project: tsconfig with `paths` alias, barrel re-export chain, dynamic import, type-only import, external import, one unresolvable import; plus `expected-graph.json` golden serialization -- AC oracle
- [x] `tests/integration/import-graph.test.ts` -- integration tests: every I/O-matrix row against the fixture project; golden comparison of `serialize()` output to `expected-graph.json` (byte-identical, run twice); fan-in/fan-out assertions (hazard: unresolvable-import row asserts degraded + coverage < 1, not a throw) -- AC coverage
- [x] `packages/core/src/adapter/*.test.ts` -- colocated unit tests for path normalization + stable sorting edge cases (mixed separators, case, duplicate edges) -- determinism hazards
- [x] `docs/adr/ADR-004-ast-tooling.md` -- write ADR (ts-morph over raw compiler API / tree-sitter: semantic type-aware resolution, cost gate re-examined at SPIKE-3/1.5); flip README row -- DoD
- [x] `tests/e2e-coverage.md` -- add story 1.3 row: no UI-facing ACs (library layer; CLI arrives 1.4) -- E2E-COVERAGE RULE
- [x] `README.md` + `CHANGELOG.md` -- brief adapter/graph mention + changelog entry -- DoD

**Acceptance Criteria:**
- Given the golden fixture project, when the import graph is built, then every edge resolves exactly as `expected-graph.json` specifies (aliases, barrels, re-exports, dynamic imports).
- Given a file with an unresolvable import, when the graph is read, then the partial-result contract returns `{ data, coverage < 1, degraded[] }` with a typed entry — never a throw, never silent omission.
- Given identical input, when the graph is built twice, then the serialized output is byte-identical.
- Given any file in the graph, when queried, then dependency fan-in and fan-out (counts + edges) are available.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test`, when run, then all green.

## Spec Change Log

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 1, medium 7, low 4)
- defer: 0
- reject: 2: (high 0, medium 0, low 2)
- addressed_findings:
  - `[high]` `[patch]` Non-literal dynamic `import(expr)`, `require()`, and `import x = require()` were silently omitted (no edge, no degradation, coverage stayed 1) — literal require/import-equals now produce edges; non-literal specifiers produce typed degraded entries counted in coverage. The exact zero-silent-degradation violation the contract forbids.
  - `[medium]` `[patch]` tsconfig load could throw raw ts-morph errors — wrapped; returns empty graph, coverage 0, typed degradation. Zero-own-files rootDir mismatch also degrades instead of returning a clean empty graph.
  - `[medium]` `[patch]` Unresolvable bare specifiers were laundered as healthy external edges — now external edge + paired degraded entry + coverage hit; `external` semantics documented on the node schema.
  - `[medium]` `[patch]` Golden fixture's `zod` import was not resolvable from the fixture location, so the resolved-external branch was untested and the test proved the wrong branch — external import switched to `typescript` (resolvable), plus a deliberately unresolvable package and assertions distinguishing the two branches.
  - `[medium]` `[patch]` Inline type-only imports (`import { type X }`) were mislabeled `typeOnly: false` — flag now covers inline modifiers for imports and export-from; fixture + golden extended.
  - `[medium]` `[patch]` `edgeKey` space-joined fields let space-containing paths collide (silent edge loss) — JSON-tuple keys with collision test.
  - `[medium]` `[patch]` Edges could reference files that were not nodes (dangling endpoints; fanIn reported "not a node" while edges referenced it) — constructor synthesizes endpoint nodes, invariant closed.
  - `[medium]` `[patch]` Adapter had zero unit tests (root cause of the untested branches) — new adapter unit suite + `import-graph-units` fixture covering ImportEquals, require, non-literal require, inline type-only, outside-root guard.
  - `[low]` `[patch]` Cross-drive/absolute `path.relative` results defeated containment — absolute or `..`-prefixed results treated external with degradation.
  - `[low]` `[patch]` Coverage double-counted duplicate imports and degraded entries — deduped by (reason, subject) and unique (from, specifier).
  - `[low]` `[patch]` Integration suite built the graph at collection time; fan queries returned mutable internal state and were O(E) — beforeAll, frozen graph, prebuilt index maps.
  - `[low]` `[patch]` Docs overclaimed ("never throw", compiler-backed dynamic discovery) — README/CHANGELOG/ADR-004 aligned with actual semantics.

Rejected: duplicated `PartialResultOf<T>` structural type in core vs contracts schema (canonical schema stays in contracts; core's direct zod dep is version-aligned via pnpm — re-exporting `z` from contracts would be worse coupling); stringly `degraded.subject` ("file -> specifier") convention (contracts schema is reason+subject by design; revisit only if a consumer needs structured fields). Golden-file audit trail: edge list hand-audited twice (implementation report + orchestrator check against fixture source) this pass.

## Design Notes

- The fixture project gets its own `tsconfig.json` but is **excluded** from the workspace typecheck (`tsc -b` references) — it is data, not source. Ensure eslint ignores `tests/__fixtures__/**` (config currently ignores `tests/**` globally — keep it that way).
- ts-morph `Project` should load with `skipAddingFilesFromTsConfig: false` against the fixture tsconfig; resolution comes from the TS compiler, not hand-rolled logic — that is the entire reason for ts-morph (ADR-004).
- `expected-graph.json` is generated once by the implementation, then **hand-audited against the fixture source** before committing (a golden file nobody read proves nothing), and asserted byte-identical thereafter.

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries` -- expected: green
- `pnpm -r build && pnpm -r test && pnpm test` -- expected: green; integration project now collects tests (no longer passWithNoTests-empty)


## Auto Run Result

- **Summary:** `LanguageAdapter` seam + ts-morph TypeScript adapter + deterministic import graph landed in `packages/core`, returning contracts partial-results with typed degradations; golden fixture project + integration suite + adapter unit suite; ADR-004 shipped. Review pass applied 12 patches (1 high: silent omission of non-literal dynamic/require/import-equals imports; 7 medium incl. laundered unresolvable bare specifiers, dangling graph edges, wrong-branch golden fixture, inline type-only mislabeling, throwing tsconfig load).
- **Files changed:** `packages/core/src/adapter/{language-adapter,typescript-adapter}.ts` (+unit tests), `packages/core/src/graph/import-graph.ts` (+unit tests), `packages/core/src/index.ts`, `packages/core/package.json` (+ts-morph, zod, @types/node), `tests/__fixtures__/import-graph{,-units}/`, `tests/integration/import-graph.test.ts`, `.gitattributes` (golden byte-stability under autocrlf), `docs/adr/ADR-004-ast-tooling.md` (+README row), `tests/e2e-coverage.md` (1.3 row), `README.md`, `CHANGELOG.md`.
- **Review findings breakdown:** 12 patched (1 high, 7 medium, 4 low), 0 deferred, 2 rejected, 0 intent_gap, 0 bad_spec.
- **Follow-up review recommendation:** true — auto-forced by the HIGH inline finding (FOLLOW-UP-REVIEW AUTO-FORCE ON HIGH; no decline branch), and the patch set materially reworked the adapter.
- **Verification:** `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:boundaries`, `pnpm -r build`, `pnpm -r test` (31 contracts + 21 core), `pnpm test` (7 files / 92 tests) — all green after patches; golden asserted byte-identical across two builds.
- **Residual risks:** ts-morph memory/cost at scale is explicitly unmeasured until SPIKE-3 (story 1.5 gate). Cross-drive Windows behavior is guarded but only the `..`-arm is unit-testable in-repo. `external: true` bare-specifier semantics rely on the documented convention.
