# Axiom #4 — NFR Rules (structural tier)

The deterministic NFR rule set (`rulesetVersion: 4`, Story 1.11). All three
rules run inside the single registered axiom-4 analyzer over the shared
changed-files parse pass (parse-only ts-morph, one parse per run across
axiom 3 + axiom 4, no import graph); findings carry `axiom: "4"`,
`tier: "deterministic"`, `source: "ast"`, `confidence: 1`.

**All severities are `warning` by design.** The structural tier flags hazard
PATTERNS — it cannot prove runtime context, so it never blocks on its own
(the gate counts error-severity findings only). Axiom 4 therefore **cannot
gate in Epic 1 at all, by design**: `maxFindings` is a CEILING on
error-severity findings — raising it only loosens the gate, and no value of
it makes an axiom that emits only warnings block. Epic 3's LLM tier is where
severity and confidence can rise and axiom 4 can start gating.

**Binding checks, not spelling checks.** `fetch` and `Promise` callees flag
only when the identifier resolves to the AMBIENT global — an identifier with
ANY local declaration in the changed file (a DI parameter, a local wrapper
const, a function, an import from a wrapper module) is skipped. Sync-IO
calls must resolve to the tracked import binding's own symbol, so an
inner-scope local shadowing an import name never flags. `globalThis.X`,
`window.X`, and `self.X` property access (and bracket access with a string
literal, `Promise["all"]`, `fs["readFileSync"]`) reach the same checks.

| ruleId | Severity | Rationale | Approximation | Fixture case |
|---|---|---|---|---|
| `nfr/unbounded-promise-all` | warning | `Promise.all` / `Promise.allSettled` / `Promise.any` / `Promise.race` over a dynamically sized array starts every operation at once — the unbounded-fan-out hazard AI diffs produce when parallelizing I/O (`any`/`race` settle early but still START everything). Bound the fan-out p-map-style with a concurrency limit. Anchored at the call line. Discriminator: enclosing symbol + `#promise-<method>-N` ordinal (the method name joins the counter key — all/allSettled/any/race count separately; the counter advances for every combinator call in source order, violating or not). | "Over I/O" is not structurally decidable — the pattern proxy is the ARGUMENT SHAPE: a `.map(...)` result, a bare identifier/call, or a spread of a non-literal is treated as dynamically sized; only an array literal of RECURSIVELY fixed arity is exempt (`[...[a, b]]` is fixed; `[...[...xs]]` is not). A fixed-arity `Promise.all` over CPU-bound work is equally invisible to this rule. | `tests/__fixtures__/nfr-rules/violation/src/promise-all.ts` |
| `nfr/sync-io-in-async` | warning | A `*Sync` member of an imported blocking-IO module (`fs`, `child_process`, `zlib`, `crypto` — bare or `node:`-prefixed) called where the NEAREST enclosing function-like is `async` blocks the event loop exactly where concurrency was requested. Use the async equivalent (`node:fs/promises`; async `exec`/`execFile`/`spawn`; callback/promisified zlib and crypto forms). Tracks named (incl. renamed `import { readFileSync as r }`), namespace (`import * as fs`), default (`import fs from`), and `import { default as fs }` forms, matched by import-binding SYMBOL. Anchored at the call line. Discriminator: enclosing symbol + member name + ordinal (line-free). | "Hot path"/"request path" detection requires framework knowledge the structural tier lacks — async enclosure is the proxy, and the NEAREST function-like decides (a sync arrow nested in an async function is not flagged; class field initializers and static blocks run at construction, so they stop the enclosure walk). Module-top-level sync reads (the config-load idiom) stay exempt. `require()` bindings, re-assigned module objects, and destructuring from a namespace import (`const { readFileSync } = fs`) are not tracked; type-only imports are erased and skipped. | `tests/__fixtures__/nfr-rules/violation/src/sync-io.ts` |
| `nfr/missing-abort-signal` | warning | A global `fetch(...)` call whose options argument PROVABLY lacks cancellation — absent, the literal `undefined` or `null`, or an object literal without a `signal` property (a literal `signal: undefined` is syntactically visible absence and still flags) — cannot be cancelled or timed out; a hung upstream holds the caller forever. Pass `{ signal }` (e.g. `AbortSignal.timeout(ms)`). Anchored at the call line. Discriminator: enclosing symbol + `#fetch-N` ordinal (line-free). | "External call cancellation" is approximated as the ambient global `fetch` only — `http`/`https` module timeout analysis is out of scope (Epic 3's LLM tier deepens). Non-literal options (`fetch(url, opts)`) and spread-carrying literals (`{ ...opts }`) are NOT flagged: the tier cannot see inside them (stated ceiling — a missed hazard is traded for zero false positives on wrapped options). A computed literal name (`{ ["signal"]: s }`) resolves and counts as a signal. | `tests/__fixtures__/nfr-rules/violation/src/fetch.ts` |

## Ceilings

Known, deliberate limits of the structural tier — each trades missed findings
for zero false positives, and every rule's severity is `warning` (never
gates):

- **No data-flow or type inference.** An array KNOWN to be small (`const two
  = xs.slice(0, 2)`) still flags when passed to `Promise.all`; an options
  object KNOWN to carry a signal is not flagged only when the literal shows
  it.
- **`fetch` only.** `http.request`, `axios`, and friends carry no
  cancellation analysis here.
- **Nearest-enclosure semantics** for `sync-io-in-async`: a sync helper
  defined inside an async function is not flagged (its call site's context
  is unknowable statically).
- **Import bindings only** for `sync-io-in-async`: `require()`, re-assigned
  module objects, and `const { readFileSync } = fs` destructuring from a
  namespace import escape tracking.
- **No configurable thresholds.** The rules are pattern predicates, not
  tunables.

## Finding identity (ordinal churn scope)

Discriminators are line-free (`symbol#base-N` ordinals over candidate calls
in source order), so findingIds survive LINE shifts — comments, formatting,
unrelated edits above the call. They do NOT survive edits to the candidate
call list itself: inserting or removing a candidate call (violating or not)
EARLIER in the same (enclosing symbol, rule base) sequence shifts every
later ordinal, and those findingIds churn. That is the honest stability
contract.

## Scope

Rules fire only for **changed files** (the reviewed change set), via the
shared parse-only changed-files pass — no import graph, no cache coupling
beyond the per-axiom findings cache every analyzer gets.

Machine oracle: `tests/__fixtures__/nfr-rules/violation/expected-findings.json`
(byte-compared in `tests/integration/nfr-rules.e2e.test.ts`; the fixture
includes a two-hazard file so ordinal discrimination reaches the persisted
oracle), plus a clean fixture asserting zero findings. Because every finding
is a warning, the violation fixture's run **exits 0 with the findings
persisted** — the honest gate verdict, asserted explicitly.
