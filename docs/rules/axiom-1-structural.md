# Axiom #1 — Structural Rules

The deterministic structural rule set (`rulesetVersion: 2`, Story 1.9). All
four rules run inside the single registered axiom-1 analyzer over the merged
import graph; findings carry `axiom: "1"`, `tier: "deterministic"`,
`source: "ast"`, `confidence: 1`, and anchor at the real import-statement
line (dynamic imports: the call site). The one exception is
`structural/unassigned-file`: a whole-file condition has no import line, so
it anchors at the synthetic line 1.

| ruleId | Severity | Rationale | Fixture case |
|---|---|---|---|
| `structural/circular-import` | error | Import cycles create initialization-order hazards and unshippable modules; type-only cycles are erased at runtime and exempt. Anchored at the import line of the cycle edge leaving the lexicographically-smallest member file. | `tests/__fixtures__/structural-rules/violation/src/app/c1.ts` ↔ `c2.ts` |
| `structural/unresolved-import` | error | A relative, absolute, or `paths`-alias import that fails resolution means a deleted, moved, or misspelled target — broken at runtime. A type-only failing import gets a message saying the TYPE import cannot resolve (erased at runtime — no runtime-breakage implication), severity unchanged. Bare external specifiers and node builtins are verified externals, never findings (the paired graph degradation remains the coverage truth); a bare `"*"` catch-all `paths` pattern is not an alias signal. | `tests/__fixtures__/structural-rules/violation/src/app/broken.ts` |
| `structural/dependency-direction` | error | With `boundaries` declared in `config.yaml`, an import edge whose from-layer → to-layer pair is not in the `allowed` map is a disallowed cross-boundary dependency (fail-closed allowlist). An internal target assigned to NO declared layer also fires (the `(unassigned)` pseudo-layer — routing an import through an unassigned file is not an evasion path); external targets are never checked. Type-only edges are exempt; dynamic imports and re-exports are checked. Same-layer imports are always allowed. The rule fires PER TARGET: one importing file breaching toward several targets yields one finding per target (discriminator `fromLayer->toLayer:target`, smallest offending line each). | `tests/__fixtures__/structural-rules/violation/src/lib/bad.ts` |
| `structural/unassigned-file` | warning | With `boundaries` declared, a changed file matching no layer prefix is invisible to the declared layout — misplaced or unaccounted for (fail-closed complement of the direction rule). | `tests/__fixtures__/structural-rules/violation/src/stray.ts` |

## Scope and boundaries declaration

Rules fire only for **changed files** (the reviewed change set). The
`boundaries` key is optional:

```yaml
boundaries:
  layers:
    - name: app
      paths: [src/app]      # repo-relative path prefixes, no globs
    - name: lib
      paths: [src/lib]
  allowed:
    app: [lib]              # app may import lib; undeclared pairs are violations
```

- Absent `boundaries` → the two declaration-dependent rules emit nothing
  (nothing declared = nothing to check — not a degradation).
- A file under multiple layer prefixes belongs to the **longest** matching
  prefix (at equal length, the first-declared layer wins).
- `allowed` keys and values must reference declared layer names (typed
  config error, exit 2, path named).
- Layer path prefixes are literal repo-relative directory prefixes: globs,
  backslashes, leading `./` or `/`, trailing `/`, blank entries, and the same
  path declared in two different layers are all rejected with the exact path
  named.

## Merge granularity

The FR-21 merge (phase 4) collapses overlapping findings only within the
same `(file, axiom, tier, ruleId)`: two DIFFERENT structural rules colliding
at one import line (e.g. `circular-import` + `dependency-direction`) stay
two distinct findings with their own ruleIds and dispositions.

Machine oracle: `tests/__fixtures__/structural-rules/violation/expected-findings.json`
(byte-compared in `tests/integration/structural-rules.e2e.test.ts`), plus a
clean fixture asserting zero findings.
