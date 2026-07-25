# Axiom #3 — Cleanliness Rules

The deterministic cleanliness rule set (`rulesetVersion: 3`, Story 1.10).
All four rules run inside the single registered axiom-3 analyzer; findings
carry `axiom: "3"`, `tier: "deterministic"`, `source: "ast"`,
`confidence: 1`. Three rules parse ONLY the changed files (a fresh
changed-set-sized ts-morph pass); `cleanliness/unused-export` additionally
consumes the shared import graph, whose edges carry the per-edge imported
binding `names` recorded by the adapter.

| ruleId | Severity | Rationale | Fixture case |
|---|---|---|---|
| `cleanliness/unreachable-code` | error | VALUE statements after a terminal statement (`return` / `throw` / `break` / `continue`) in the same block can never execute — dead weight that reads as intent. Exempt: hoisted `function` declarations (reachable — the idiomatic `return helper();` above `function helper() {}`) and type-only statements (type alias / interface — erased at runtime); the anchor skips exempt statements to the first real dead one. Discriminator: enclosing function/symbol name + `#block-N` ordinal (line-free). Honesty: the ordinal counts statement containers under the enclosing symbol in document order, so it churns when an unrelated block is inserted EARLIER in the same enclosing symbol, and anonymous arrows share a per-file kind-name counter — identity is stable under edits OUTSIDE the enclosing symbol, not under arbitrary line drift within it. | `tests/__fixtures__/cleanliness-rules/violation/src/unreachable.ts` |
| `cleanliness/unused-export` | warning | An exported symbol declared in a changed file that no file in the analyzed project imports by name is dead API surface. Namespace imports (`import * as`), `export * from`, dynamic `import()`, `require()`, and `import =` of a file count as using ALL its exports; `export * as ns from` additionally declares the named export `ns` on the barrel itself (inventoried like any other name); `export default` is tracked as the name `default`; type-only usage counts as usage. **Ceiling:** files with ZERO names-bearing importers are exempt entirely — they are indistinguishable from entry points, so no findings are emitted for any of their exports (missed orphan modules are traded for zero entry-point false positives; SPIKE-4 measures the trade). A side-effect-only import (`import "./setup.js"`) binds no names and does NOT lift the exemption. Discriminator: the exported symbol name (deduped per file — overloads, interface merging, and `export const x` + `export { x }` are one export, one finding). | `tests/__fixtures__/cleanliness-rules/violation/src/unused.ts` |
| `cleanliness/duplicate-code` | warning | Two function-like bodies (function/method/arrow with ≥5 statements) among the CHANGED files whose normalized structure (identifiers → `ID`, literals → `LIT`, whitespace/comments stripped) is identical — the copy-paste-then-rename pattern AI diffs produce. One finding per duplicate pair, anchored at the LATER occurrence (file-sort order), message naming the original location. Changed-files-only scope is deliberate: it catches duplication introduced by the diff without a project-wide index. Discriminator: structure hash + both file paths. | `tests/__fixtures__/cleanliness-rules/violation/src/dup-b.ts` (duplicate of `dup-a.ts`) |
| `cleanliness/excessive-complexity` | warning | Cyclomatic complexity > 15 per function-like (+1 base; +1 per `if`/`else if`, `for`/`for-in`/`for-of`, `while`, `do`, `case`, `catch`, `&&`, `\|\|`, `??`, `&&=`, `\|\|=`, `??=`, ternary; nested functions measured separately). The threshold is hardcoded with rationale — 15 sits above idiomatic switch-heavy code but below the unreviewable mega-function; config exposure is later scope. The message states the measured value and the threshold. Discriminator: the function/symbol name, with a `name#N` ordinal for repeated names in one file (two same-named violators never share a findingId). | `tests/__fixtures__/cleanliness-rules/violation/src/complex.ts` |

## Ceilings (`cleanliness/unused-export`)

Known, deliberate limits of the graph-based usage index — all trade missed
findings for zero false positives on entry points, and the rule's severity is
`warning` (it never gates); the 1.17 noise metric will measure the trade:

- **Zero names-bearing importers → exempt** (entry-point indistinguishability,
  see the table row).
- **Workspace consumers are invisible:** an export consumed ONLY by another
  workspace package via its bare specifier (`@scope/pkg`) reaches the graph as
  an external edge, not a named import of the source file — such exports WILL
  be flagged despite being used.
- **Destructured export patterns** (`export const { a, b } = obj`) are not
  inventoried — binding-name extraction is skipped for a pattern this rare in
  exports.
- **`export =` is tracked as `default`** — an approximation: under NodeNext
  there is no default binding for `export =`, so consumption via
  `import x = require(...)` is only matched through that module's `*` edge.

## Scope

Rules fire only for **changed files** (the reviewed change set). The
unused-export usage index rides the same import-graph build (and
content-addressed cache) the axiom-1 rules use — no per-symbol project
sweep, no `findReferences`.

Machine oracle: `tests/__fixtures__/cleanliness-rules/violation/expected-findings.json`
(byte-compared in `tests/integration/cleanliness-rules.e2e.test.ts`), plus a
clean fixture asserting zero findings.
