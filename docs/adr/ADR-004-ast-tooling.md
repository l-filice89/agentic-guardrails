# ADR-004: AST Tooling — ts-morph LanguageAdapter

## Status

Accepted — 2026-07-24 (Story 1.3)

## Context

Analyzers need module resolution that matches what the TypeScript compiler
actually does — tsconfig `paths` aliases, barrels, re-export chains, dynamic
imports. Naive path joining would make every downstream axiom wrong on real
repos. The candidates were the raw TypeScript compiler API, tree-sitter, and
ts-morph.

## Decision

Use **ts-morph 28.x** behind a `LanguageAdapter` seam in `packages/core`
(`buildImportGraph(options) => PartialResult<ImportGraph>`):

- **ts-morph over the raw compiler API**: same compiler underneath (so
  resolution is semantic and type-aware — `paths`, barrels, re-exports come
  from the compiler, not hand-rolled logic), with a dramatically smaller and
  safer surface for AST walking.
- **ts-morph over tree-sitter**: tree-sitter is syntax-only; it cannot
  resolve a module specifier to a file, which is the entire job here.
- **The seam, not multi-language machinery**: `LanguageAdapter` is an
  interface with exactly one implementation (`TypeScriptAdapter`). Analyzers
  depend on the interface, never on ts-morph — that is the decoupling point,
  not speculative multi-language support.

Analyzed code is always parsed as data — never executed or imported. Static
imports/re-exports resolve through the compiler; dynamic `import(...)`,
`import x = require(...)`, and `require(...)` are DISCOVERED by AST walking,
with literal specifiers handed to the compiler for resolution and
non-literal specifiers degrading (no edge). Graph reads return the contracts
partial-result shape: an unresolvable import yields a typed `degraded` entry
and `coverage < 1`, never a throw; an unresolved bare specifier is still
recorded as an external node/edge (external means "bare specifier, not
traversed; resolution verified only when found in node_modules") plus a
degraded entry; a tsconfig that fails to load returns an empty graph with
`coverage: 0` and a degraded entry instead of throwing.

## Consequences

- `core` gains its first heavyweight runtime dependency (ts-morph bundles
  its own TypeScript compiler). The cost gate is re-examined at SPIKE-3 /
  Story 1.5 — if parse cost on large repos is prohibitive, the adapter seam
  is exactly where a cheaper backend swaps in.
- Determinism is owned by the graph container, not the parser: stable-sorted
  nodes/edges, `/`-separated repo-relative paths, byte-identical
  `serialize()` for identical input (golden-tested).
- ts-morph is not an LLM SDK; the ADR-005 boundary walls stay green
  unchanged.
