---
title: 'Story 1.11: Axiom #4 — NFR Analyzer (structural tier)'
type: 'feature'
created: '2026-07-25'
status: 'done'
baseline_revision: 2e04a6f8cb86f71e6a9736ee145bdf41227c1e19
final_revision: 371e4cbf05ded34765d1839e9a4c578d62ecef81
review_loop_iteration: 0
followup_review_recommended: true # judgment: 21 patches with behavior-changing breadth (binding resolution, detection envelope, shared-parse refactor touching axiom 3) — significant by volume and breadth
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** Axiom #4 (NFR) has no analyzer: unbounded concurrency, event-loop-blocking sync I/O, and uncancellable external calls in AI-written diffs surface nowhere.

**Approach:** Add `axiom4Nfr` — third registered analyzer, 1.10 pattern — with three structural (AST-pattern) rules over changed files only. No graph, no adapter changes, no ENGINE bump; `RULESET_VERSION` → "4".

## Boundaries & Constraints

**Always:**
- Rule set (ONE registered axiom-4 analyzer; findings `axiom: "4"`, `tier: "deterministic"`, `source: "ast"`, `confidence: 1`, all severity **warning** — structural tier flags hazard PATTERNS, it cannot prove runtime context, so it never blocks on its own [gate counts errors only]; the rules doc states this posture):
  - `nfr/unbounded-promise-all` — `Promise.all(...)` / `Promise.allSettled(...)` whose array argument is dynamically sized: a `.map(...)` call result, a spread of a non-literal, or a bare identifier/call — i.e. anything except an array literal of fixed arity. Anchor: the Promise.all call line. Discriminator: enclosing symbol + ordinal. Message points at p-map-style bounding.
  - `nfr/sync-io-in-async` — a synchronous `node:fs` API call (`*Sync` member of an fs/node:fs import, incl. namespace and default forms) lexically inside an `async` function-like. Anchor: the call line. Discriminator: enclosing symbol + fs member name + ordinal. Rationale: sync I/O inside async flow blocks the loop exactly where concurrency was requested.
  - `nfr/missing-abort-signal` — a `fetch(...)` call whose options argument is absent or is an object literal without a `signal` property. Non-literal options (identifier, spread-carrying literal with no explicit signal) are NOT flagged (cannot see inside — stated ceiling). Anchor: the fetch call line. Discriminator: enclosing symbol + ordinal.
- The three rules cover exactly the three AC-named hazards (unbounded `Promise.all` over I/O, sync filesystem in hot paths, missing cancellation/timeout on external calls) at the structural approximation the tier allows — each rule's doc row states its approximation honestly (e.g. "over I/O" and "request path" are not structurally decidable; the pattern is the proxy).
- Changed-files-only ts-morph pass (the 1.10 fresh-pass pattern); NO graph acquisition, NO graphCache. Ordinals: per-file per-rule counter in source order (the 1.10 `name#N` convention) so same-shaped calls get distinct findingIds.
- Registration: append to `DEFAULT_ANALYZERS` (axiom "4"); init questionnaire/knownAxiomIds derive automatically (verify; add the one-line axiom-4 prompt description). Default enforcement: existing EFFECTIVE_DEFAULTS — no special-casing.
- `RULESET_VERSION` → "4" (findings cache + runId invalidation). ENGINE_VERSION unchanged (no cached-payload schema change) — assert that in a test comment, not a bump.
- Determinism byte-identical (oracle twice); merge/sort machinery untouched.
- Fixture oracle: `tests/__fixtures__/nfr-rules/{violation,clean}` + `expected-findings.json` + `tests/integration/nfr-rules.e2e.test.ts` (oracle byte-stable twice, clean zero findings, off/advisory rows, warm-run cache-hit byte identity). Violation fixture: all imports resolve, zero degradations, and since all findings are warnings the gate PASSES — exit 0 with findings present, asserted explicitly (this is the honest posture, not a bug).
- Docs: `docs/rules/axiom-4-nfr.md` (ruleId/severity/rationale/approximation/fixture case); README pointer; CHANGELOG; e2e-coverage row.

**Block If:**
- The all-warnings posture contradicts a planning-artifact requirement that axiom 4 must be able to gate in Epic 1 (re-check FR-18/epics wording if in doubt — the epic AC says "correct provenance and severities per the fixture oracle", which this satisfies).

**Never:** No data-flow/type-inference analysis (structural tier). No http/https module timeout analysis beyond fetch (stated ceiling; Epic 3 LLM tier deepens). No configurable thresholds. No graph/adapter/cache schema changes. No new dependencies. No auto-fixing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Violation fixture | one instance of each of the 3 hazards | exactly the oracle findings; exit 0 (warnings never gate) | No error expected |
| Clean fixture | p-map-bounded map, sync fs in sync fn, fetch with signal | zero findings | No error expected |
| Promise.all over array literal | `Promise.all([a(), b()])` fixed arity | no finding | No error expected |
| Promise.all(list.map(f)) | dynamic size | finding | No error expected |
| Sync fs at module top level | `readFileSync` outside any async fn | no finding (config-load idiom) | No error expected |
| Sync fs in async arrow | `async () => readFileSync(p)` | finding | No error expected |
| fetch with identifier options | `fetch(url, opts)` | no finding (ceiling: cannot see inside) | No error expected |
| fetch with literal, no signal | `fetch(url, { method: "POST" })` | finding | No error expected |
| Two identical hazards in one file | two bare `Promise.all(xs.map(f))` | two findings, distinct findingIds (ordinals) | No error expected |
| Axiom 4 off / advisory | config rows | skipped-and-declared / non-gating | No error expected |

</intent-contract>

## Code Map

- `packages/core/src/analyzers/axiom3-cleanliness.ts` -- the pattern: changed-file ts-morph pass, ordinals, discriminators, fixtureProject tests
- `packages/core/src/pipeline/pipeline.ts` -- DEFAULT_ANALYZERS (append axiom4), phase-1 membership expectations in tests
- `packages/core/src/pipeline/manifest.ts` -- RULESET_VERSION "3" → "4"
- `packages/core/src/init/init.ts` -- axiom prompt descriptions (add "4")
- `tests/__fixtures__/cleanliness-rules/` + `tests/integration/cleanliness-rules.e2e.test.ts` -- oracle/e2e template
- `docs/rules/axiom-3-cleanliness.md` -- doc format (incl. Ceilings section convention)

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/analyzers/axiom4-nfr.ts` -- three rules per the Always list (fs import tracking incl. namespace/default/renamed forms; async-enclosure walk; fetch options-literal inspection) -- the analyzer
- [x] `packages/core/src/pipeline/pipeline.ts` + `manifest.ts` + `init/init.ts` -- register axiom4; RULESET_VERSION "4"; axiom-4 questionnaire line; update membership/count expectations across existing tests -- wiring
- [x] `docs/rules/axiom-4-nfr.md` + `README.md` + `CHANGELOG.md` -- rule table with per-rule approximation statements + Ceilings -- documented rule set
- [x] unit tests -- every I/O matrix row + bypass probes (HAZARD: renamed import `import {readFileSync as r}` still caught; namespace `fs.readFileSync` caught; non-fs `somethingSync()` NOT caught; nested async-in-sync and sync-in-async enclosure both directions; Promise.allSettled covered; fetch spread-options not flagged) -- coverage
- [x] `tests/__fixtures__/nfr-rules/{violation,clean}` + `expected-findings.json` + `tests/integration/nfr-rules.e2e.test.ts` -- oracle twice, clean zero, off/advisory, cache-hit byte identity, exit-0-with-warnings asserted -- AC oracle
- [x] `tests/e2e-coverage.md` -- 1.11 row -- DoD

**Acceptance Criteria:**
- Given the violation fixture, when review runs, then findings match `expected-findings.json` exactly — axiom "4", tier deterministic, source ast, correct lines, all warnings — and the run exits 0 with findings persisted.
- Given the clean fixture, when review runs, then zero findings.
- Given the documented rule set, when reviewed, then every rule has ≥1 fixture case, a rationale, AND an explicit approximation statement.
- Given axiom 4 `off` / `advisory`, when review runs, then skipped-and-declared / non-gating, byte-identical on identical input.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test`, when run, then all green.

## Spec Change Log

## Review Triage Log

### 2026-07-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 21: (high 0, medium 5, low 16)
- defer: 2: (high 0, medium 1, low 1)
- reject: 1: (high 0, medium 0, low 1)
- addressed_findings:
  - `[medium]` `[patch]` The rules doc sold a maxFindings gating knob that is a no-op for an all-warnings axiom (maxFindings is an error-finding ceiling; raising it only loosens) — passage rewritten: axiom 4 cannot gate in Epic 1 by design.
  - `[medium]` `[patch]` Shadowing false positives broke the zero-false-positive contract: any identifier spelled `fetch`/`Promise` flagged (DI params, local wrappers), and fs lookup was name-only (inner-scope shadows flagged) — ts-morph symbol binding checks added; five negative tests, globals stay positive.
  - `[medium]` `[patch]` Cancellation envelope: `fetch(url, undefined/null)` escaped (provably signal-less), literal `{signal: undefined}` suppressed the flag, computed `{["signal"]: s}` missed — all four ruled and tested; ceilings updated.
  - `[medium]` `[patch]` Axiom 4 copied axiom 3's scaffolding near-verbatim AND every review parsed the changed-file set twice — shared `changed-files.ts` helper + run-local `changedFilesCache.acquire` memo (GraphCache pattern, await-free): one parse per run, pinned by a counting test; axiom-3 oracles byte-green untouched.
  - `[medium]` `[patch]` sync-io ruleId promised more than fs: execSync/gzipSync/pbkdf2Sync block identically — tracked modules extended to child_process/zlib/crypto (all import forms incl. default-as-named), destructured-from-namespace ceiling stated, naming aligned across doc/CHANGELOG/init.
  - `[low]` `[patch]` Promise.any/race added (same fan-out hazard), method name in the ordinal key.
  - `[low]` `[patch]` globalThis/window/self property-access and string-literal bracket-access spellings of fetch/Promise.all/fs members resolved.
  - `[low]` `[patch]` Nested-spread fixed-arity recursion ([...[...xs]] no longer misclassified).
  - `[low]` `[patch]` Type-only fs imports no longer poison same-named locals.
  - `[low]` `[patch]` Class field initializers + static blocks stop the async-enclosure walk (construction-time, not async-frame).
  - `[low]` `[patch]` context.signal checked between files (typed degradations for skipped files).
  - `[low]` `[patch]` "Unparseable" degradation was a misnomer (ts-morph parses garbage; only reads fail) — renamed "could not be read", test scenario corrected, comment honesty (one place via shared helper; also fixes the Windows \r leak in firstLine).
  - `[low]` `[patch]` Ordinal-churn comment oversold stability — true churn scope stated in code + doc.
  - `[low]` `[patch]` Warm-run e2e asserts exact {hits:3, misses:0, invalid:0} instead of hits>0.
  - `[low]` `[patch]` axiom4 fixtureProject dropped its unused tsconfig scaffolding + explicit no-tsconfig unit added.
  - `[low]` `[patch]` Violation fixture gained a two-hazard file — ordinal discrimination now reaches the persisted oracle (5 findings).
  - `[low]` `[patch]` Brittle `not.toMatch(/\b2\b/)` replaced with exact discriminator equality.
  - `[low]` `[patch]` off/advisory e2e config.replace guarded against silent no-op (vacuous-test fixture drift).
  - `[low]` `[patch]` Dead `?? message` fallback dropped; init axiom-4 description restyled terse lowercase.
  - `[medium]` `[defer]` enclosingSymbol in persisted findings carries the synthetic discriminator, not the symbol (convention from 1.10, tripled here) — ledgered for 1.16 before dispositions accumulate.
  - `[low]` `[defer]` Global RULESET_VERSION cold-starts every axiom's cache on any single-axiom change — per-axiom versioning decision ledgered for pre-Epic-3.

Rejected: duplicated CLI summary-copy assertions across three e2e files — explicit per-suite assertions are acceptable test style, not a defect.

## Design Notes

- All-warnings is the honest severity for a tier that pattern-matches without runtime context: a false "error" from a heuristic would gate legitimate code (the 1.10 HIGH lesson). An operator who wants axiom 4 to gate can set maxFindings via config only when errors exist — the doc states that warnings are the tier ceiling and Epic 3's LLM tier is where confidence rises.
- `sync-io-in-async` scopes to async enclosure rather than "request paths" because request-path detection requires framework knowledge the structural tier lacks; module-top-level sync reads (config loading) are the dominant legitimate use and stay exempt.

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test` -- expected: green with nfr e2e collected


## Auto Run Result

- **Summary:** Axiom #4 (NFR, structural tier) is live as the third registered analyzer with three all-warning rules: `nfr/unbounded-promise-all` (all/allSettled/any/race over dynamically-sized arrays, globalThis/bracket spellings, recursive spread arity), `nfr/sync-io-in-async` (*Sync members of fs/child_process/zlib/crypto through symbol-resolved import bindings, all import forms, class-initializer exempt), `nfr/missing-abort-signal` (fetch incl. undefined/null options, signal:undefined, computed names, globalThis forms — non-literal options a stated ceiling). Shadowed identifiers never flag (symbol binding checks). Shared changed-files parse (one ts-morph pass per run across axioms 3+4 via the acquire memo). RULESET 4; the violation oracle exits 0 with 5 warnings persisted — the tier's honest non-gating posture, documented. Review pass applied 21 patches (0 high).
- **Files changed:** `packages/core/src/analyzers/axiom4-nfr.ts` (new) + test, `changed-files.ts` (new shared parse helper) + test, `axiom3-cleanliness.ts` (shared helper adoption), `pipeline/pipeline.ts` (registration, changedFilesCache), `pipeline/manifest.ts` (RULESET 4), `init/init.ts` (axiom-4 prompt); `docs/rules/axiom-4-nfr.md` (new), `README.md`, `CHANGELOG.md`; `tests/__fixtures__/nfr-rules/` (new, incl. two-hazard ordinal file), `tests/integration/nfr-rules.e2e.test.ts` (new); `tests/e2e-coverage.md`.
- **Review findings breakdown:** 21 patched (0 high, 5 medium, 16 low), 2 deferred (enclosingSymbol semantics → 1.16; per-axiom ruleset versioning → pre-Epic-3), 1 rejected, 0 intent_gap, 0 bad_spec.
- **Follow-up review recommendation:** true — judgment call: no HIGHs, but 21 patches spanning binding resolution, detection envelope, and a cross-analyzer parse refactor is significant by volume and breadth.
- **Verification:** `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:boundaries`, `pnpm -r build`, `pnpm -r test` (52 contracts + 279 core + 7 cli), `pnpm test` (29 files / 425 tests) — all green after patches.
- **Residual risks:** Non-literal fetch options and destructured-from-namespace sync members are stated detection ceilings (Epic 3 deepens). `{signal: null}` counts as a signal (spec letter; revisit if noise data says otherwise). All-warnings posture means axiom 4 never gates until Epic 3 raises confidence.
