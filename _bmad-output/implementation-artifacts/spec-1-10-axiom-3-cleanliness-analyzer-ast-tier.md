---
title: 'Story 1.10: Axiom #3 — Cleanliness Analyzer (AST tier)'
type: 'feature'
created: '2026-07-25'
status: 'done'
baseline_revision: e617868bb6f65565a4083c637f9b5552af9f9488
final_revision: 0187a712d92e4eea76d81a5fecf58e0663373dce
review_loop_iteration: 0
followup_review_recommended: true # AUTO-FORCED: one HIGH inline finding (hoisted-declaration false positives in a blocking rule) + oversized acceptance
context: []
warnings: [oversized] # accepted, not split: adapter usage-index + four rules are one coherent analyzer; elevated review posture per OVERSIZED-STORY
---

<intent-contract>

## Intent

**Problem:** Axiom #3 (cleanliness) has no analyzer: dead/unreachable code, unused exports, copy-paste duplication, and excessive complexity in AI-written diffs surface only via LLM review or not at all.

**Approach:** Add `axiom3Cleanliness` — a second registered analyzer following the 1.9 pattern (fixture oracle, rules doc, off/advisory machinery all exist) — with four AST-tier rules over changed files, plus a symbol-usage index in the adapter (named-import bindings per edge) to make unused-export detection graph-cheap.

## Boundaries & Constraints

**Always:**
- Rule set (all inside ONE registered axiom-3 analyzer; all findings `axiom: "3"`, `tier: "deterministic"`, `source: "ast"`, `confidence: 1`):
  - `cleanliness/unreachable-code` — statements after a terminal statement (return/throw/break/continue) in the same block, per changed file. Severity error. Anchor: first unreachable statement's line. Discriminator: enclosing function/symbol name + block index (line-free).
  - `cleanliness/unused-export` — an exported symbol declared in a CHANGED file that no file in the analyzed project imports by name. Severity warning. Semantics: namespace imports (`import * as`) and `export * from` of that file count as using ALL its exports; `export default` tracked as the name "default"; type-only usage counts as usage. EXEMPT: files with ZERO importers entirely (indistinguishable from entry points — no findings for any of their exports; the rules doc states this ceiling). Discriminator: exported symbol name.
  - `cleanliness/duplicate-code` — two function-like bodies (function/method/arrow with ≥5 statements) among the CHANGED files whose normalized structure (identifiers→ID, literals→LIT, whitespace/comments stripped) is identical. Severity warning. One finding per duplicate pair anchored at the LATER occurrence (file-sort order), message names the original location. Discriminator: structure hash + both file paths. Changed-files-only scope is deliberate: catches copy-paste introduced by the diff (the AI-code case) without a project-wide index.
  - `cleanliness/excessive-complexity` — cyclomatic complexity > 15 per function-like in a changed file (count: if/else-if/for/while/do/case/catch/&&/||/??/ternary, +1 base). Severity warning. Message states the measured value and threshold. Discriminator: function/symbol name. Threshold hardcoded with rationale (config exposure later — ponytail ceiling).
- Symbol-usage index: the adapter's graph build ALREADY walks every import/export declaration — extend the SAME pass to record per-edge imported names (`names: string[]`, with `*` for namespace/`export *`, "default" for default). Carried in the cached graph payload → cached-graph schema changes → **ENGINE_VERSION bumps to "0.0.3"** (the 1.9 lesson: schema change without engine bump = corruption-flavored degradations on warm repos; old entries must become clean key misses). `RULESET_VERSION` → "3".
- Analyzer acquires the graph exactly like axiom1 (graphCache get/put + mergeGraphResults); unused-export consumes the edge name data; the other three rules parse ONLY the changed files via a fresh ts-morph pass (cheap: changed-set-sized, not project-sized).
- Registration: append to `DEFAULT_ANALYZERS` (axiom "3" — one analyzer per axiom holds). `knownAxiomIds`/init questionnaire pick it up automatically (verify — the 1.8 machinery derives from the registry); axiom 3 defaults to `advisory`? NO — default enforcement for unconfigured axioms is the existing 1.6 EFFECTIVE_DEFAULTS rule (blocking, maxFindings 0); do not special-case.
- Determinism: byte-identical on identical input (oracle asserted twice); findings ride the existing sort/merge (ruleId in merge key from 1.9 keeps distinct rules distinct).
- Fixture oracle: `tests/__fixtures__/cleanliness-rules/{violation,clean}` + `expected-findings.json`, e2e `tests/integration/cleanliness-rules.e2e.test.ts` mirroring structural-rules (oracle byte-stable twice, clean zero findings, off/advisory rows, cache-hit byte identity on the clean fixture).
- Docs: `docs/rules/axiom-3-cleanliness.md` (ruleId/severity/rationale/fixture case table); README pointer; CHANGELOG; e2e-coverage row.
- Per-axiom isolation, off/advisory, degradation surfaces: existing machinery — do not rebuild; verify via oracle e2e rows.

**Block If:**
- Recording per-edge imported names measurably breaks the SPIKE-3 budget (graph build > 2x the recorded 0.95s/1k files) — would need a redesign decision.

**Never:** No project-wide duplication index (changed-files scope only). No cross-file rename/reference analysis beyond import bindings (no ts-morph findReferences — O(project) per symbol). No configurable thresholds this story. No new dependencies. No LLM tier (Axiom #3 enrichment is Epic 3). No fixing the findings (report only).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Violation fixture | one instance of each of the 4 violations | exactly the oracle findings (ruleIds, lines, severities) | No error expected |
| Clean fixture | idiomatic code, used exports, unique functions | zero findings | No error expected |
| Namespace import | `import * as m` of a changed file with exports | no unused-export findings for that file | No error expected |
| Zero-importer file | changed file no one imports | NO unused-export findings (entry-point exemption) | No error expected |
| Re-export propagation | barrel re-exports symbol, consumer imports from barrel | symbol counts as used | No error expected |
| Duplicate across changed files | same normalized body in two changed files | one finding at later occurrence naming the original | No error expected |
| Small duplicate | identical 3-statement bodies | no finding (≥5 statement floor) | No error expected |
| Complexity boundary | function at exactly 15 / at 16 | no finding / finding stating 16 > 15 | No error expected |
| Unreachable after throw in nested block | code after throw inside if-block | finding anchored at first dead statement | No error expected |
| Axiom 3 off / advisory | config rows | skipped-and-declared / non-gating | No error expected |
| Warm cache upgrade | pre-1.10 cached graph present | clean key miss (ENGINE bump), no degradation | never a corruption message |

</intent-contract>

## Code Map

- `packages/core/src/analyzers/axiom1-structural.ts` -- the pattern to mirror (graph acquisition, foldCase, fixtureProject tests, discriminators)
- `packages/core/src/adapter/{language-adapter,typescript-adapter}.ts` -- edge schema + build pass (gains per-edge imported `names`)
- `packages/core/src/graph/import-graph.ts` -- edge identity/serialize (names join the payload, NOT the dedup key — same-identity edges union their names)
- `packages/core/src/pipeline/pipeline.ts` -- DEFAULT_ANALYZERS registration; cached-graph schema; manifest.ts ENGINE_VERSION/RULESET_VERSION
- `tests/__fixtures__/structural-rules/` + `tests/integration/structural-rules.e2e.test.ts` -- oracle/e2e pattern to copy
- `tests/__fixtures__/import-graph/expected-graph.json` -- regenerate (names field)
- `docs/rules/axiom-1-structural.md` -- doc format to mirror

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/adapter/*` + `graph/import-graph.ts` -- per-edge imported `names` (namespace `*`, default, type-only included), unioned on dedup; regenerate golden graph fixture -- usage substrate
- [x] `packages/core/src/pipeline/manifest.ts` + `pipeline.ts` -- ENGINE_VERSION "0.0.3" (+ package.json sync), RULESET_VERSION "3"; register axiom3 in DEFAULT_ANALYZERS; upgrade-path test (old-key entry never read, clean miss) -- invalidation + registration
- [x] `packages/core/src/analyzers/axiom3-cleanliness.ts` -- four rules per the Always list; changed-file ts-morph pass for unreachable/duplicate/complexity; graph names for unused-export -- the analyzer
- [x] `docs/rules/axiom-3-cleanliness.md` + `README.md` + `CHANGELOG.md` -- rule table incl. the zero-importer exemption ceiling and thresholds rationale -- documented rule set
- [x] unit tests -- every I/O matrix row + bypass probes (HAZARD: namespace-import exempts all symbols; re-export chains count as usage; duplicate-pair findingId stable regardless of changed-file discovery order; complexity boundary exact at 15/16; unreachable nested-block anchor) -- coverage
- [x] `tests/__fixtures__/cleanliness-rules/{violation,clean}` + `expected-findings.json` + `tests/integration/cleanliness-rules.e2e.test.ts` -- oracle byte-stable twice, clean zero, off/advisory, cache-hit byte identity -- AC oracle
- [x] `tests/e2e-coverage.md` -- 1.10 row -- DoD

**Acceptance Criteria:**
- Given the violation fixture, when review runs, then findings match `expected-findings.json` exactly — axiom "3", tier deterministic, source ast, correct lines and severities.
- Given the clean fixture, when review runs, then zero findings.
- Given axiom 3 `off` / `advisory` in config, when review runs, then skipped-and-declared / present-but-non-gating, byte-identical output on identical input.
- Given a pre-1.10 warm cache, when the first post-upgrade review runs, then old entries are clean key misses — no invalid-entry degradation, exit unaffected.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test`, when run, then all green.

## Spec Change Log

## Review Triage Log

### 2026-07-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 17: (high 1, medium 6, low 10)
- defer: 0
- reject: 1: (high 0, medium 0, low 1)
- addressed_findings:
  - `[high]` `[patch]` unreachable-code flagged hoisted `function` declarations and type-only statements after a terminal statement — reachable/erased idiomatic code gated as blocking errors. Exempt (FunctionDeclaration/TypeAlias/Interface); anchor skips exempt statements; three tests incl. hoisted-then-real-dead anchoring.
  - `[medium]` `[patch]` Duplicate findingIds two ways: same export name declared multiple times (overloads, interface merging, const+export{}) emitted N findings with one id; complexity had no ordinal for same-named function-likes. Name dedupe first-occurrence-wins + `name#N` ordinals; distinct-id tests.
  - `[medium]` `[patch]` `export * as ns from` was never inventoried — unused `ns` re-exports silently unflaggable and the doc's "nameless pass-through" claim wrong for that form. Inventoried; doc corrected.
  - `[medium]` `[patch]` Side-effect-only importers (`import "./m"`, names []) made every export of the target checkable — exemption defeated. Only names-bearing importers make exports checkable; side-effect-only targets exempt like zero-importer; both directions tested.
  - `[medium]` `[patch]` Degradation dedupe was run-wide (any same reason+subject collapsed, hiding legitimate repeats) — narrowed to pairs contributed by MULTIPLE analyzers (the actual double-declaration case); both tests added.
  - `[medium]` `[patch]` The warm-run "graph payload roundtrip" e2e was vacuous — findings-cache hits skip the graph build, so the names-carrying payload never deserialized. New e2e deletes findings entries, keeps graph: warm run asserts exactly {hits:1, misses:2, invalid:0} + byte identity.
  - `[medium]` `[patch]` The run-local graph memo's one-parse guarantee was accidental (result-store races the moment any await lands before put) — GraphCache reshaped to a single synchronous `acquire(tsconfig, build)` making the race structurally impossible; pin test with two awaiting analyzers asserts one build.
  - `[low]` `[patch]` Complexity missed `&&=`/`||=`/`??=` — added + threshold-crossing test.
  - `[low]` `[patch]` JSDoc AST children broke the comments-stripped duplicate contract — filtered + test.
  - `[low]` `[patch]` normalizeStructure recursion could crash the whole analyzer on pathological depth — per-body try/catch → typed per-file degradation.
  - `[low]` `[patch]` Discriminator honesty: `#block-N` churns on earlier same-symbol edits and anonymous arrows share a counter — doc claim softened to the true scope.
  - `[low]` `[patch]` Workspace-consumer ceiling documented: exports consumed only cross-package via bare specifier are graph-invisible and will warn (1.17 measures).
  - `[low]` `[patch]` Nested-closure duplicate double-count (outer pair + inner pair for one paste) — pairs whose enclosing function-likes share a hash are skipped; test.
  - `[low]` `[patch]` Unused-export scan was O(changed × edges) and double-counted type+value importers — one pre-pass Map, distinct-name union.
  - `[low]` `[patch]` Cross-story fixture coupling: structural fixtures got axiom-3 `off` in config (source edits reverted, oracles untouched); config-less scenarios keep helper edits with why-comments.
  - `[low]` `[patch]` Doc ceiling sweep: destructured exports skipped, `export =`-as-default approximation — both now in the Ceilings section.
  - `[low]` `[patch]` fixtureProject wires a counting in-memory acquire cache — unit tests exercise the cached path and stop full-parsing per test.

Rejected: "orphaned `entryPath` local in pipeline-hardening e2e" — the local is read at line 159 (recomputed-entry assertion); deleting it would break the test.

### 2026-08-01 — Independent follow-up review pass (stamp consumed)
- reviewed_range: e617868b..0187a712, verified against HEAD
- forced_areas: the blocking hoisted-declaration false positive remains fixed; graph-name payload invalidation and the shared acquire seam still hold.
- findings_fixed_and_verified_at_HEAD:
  - audit_note: The bullets below preserve each original defect statement for audit continuity; they are fixed, not current findings. The adjacent remediation evidence names the HEAD verification surface.
  - remediation_evidence: `packages/core/src/analyzers/axiom3-cleanliness.test.ts` and `packages/core/src/pipeline/merge.test.ts`; focused regression suite passed 2026-08-01.
  - [medium] packages/core/src/analyzers/axiom3-cleanliness.ts:431-433 — duplicate findings are keyed by `structureHash + original FILE + duplicate FILE`, not occurrence identities. When one file contains three or more structurally identical functions, every same-file pair has the same discriminator and all but the first are dropped; with repeated copies across files, different pairs anchored at the same later occurrence are subsequently merged by the pipeline. The rule and docs promise “one finding per duplicate pair,” but the implementation reports at most one same-file pair per structure and can omit which occurrences duplicate which originals. Add occurrence ordinals/lines to the pair key while keeping the persisted findingId line-free, or document the intentional collapse.

## Design Notes

- Unused-export rides the graph pass because the adapter already visits every import declaration — recording bound names is marginal cost; a per-symbol findReferences sweep would be O(project) per export (the SPIKE-3 anti-pattern). The zero-importer exemption trades missed orphan modules for zero entry-point false positives — SPIKE-4 (1.17) will measure whether the trade holds.
- Duplication normalizes identifiers/literals so `const a = getFoo()` matches `const b = getBar()` structurally — that is the copy-paste-then-rename pattern AI diffs produce; the ≥5-statement floor keeps idiom-level similarity (guard clauses, small mappers) out of the findings.

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test` -- expected: green with cleanliness e2e collected


## Auto Run Result

- **Summary:** Axiom #3 (cleanliness) is live as the second registered analyzer: `unreachable-code` (error; hoisted/type-only exempt), `unused-export` (warning; per-edge imported-names usage substrate in the graph, namespace/`export *`/re-export/side-effect semantics ruled and tested, zero-importer + side-effect-only exemptions), `duplicate-code` (warning; normalized-structure hash over ≥5-statement bodies among changed files, nested-containment filtered), `excessive-complexity` (warning; cyclomatic > 15 incl. logical-assignment operators). ENGINE 0.0.3 + RULESET 3, GraphCache reshaped to race-proof `acquire`, analyzer-level degradation dedupe, oracle fixtures + docs/rules table. Review pass applied 17 patches (1 high: hoisted-declaration false positives in a blocking rule).
- **Files changed:** `packages/core/src/analyzers/axiom3-cleanliness.ts` (new) + test, `axiom1-structural.ts` (foldCase export, acquire), `adapter/{language-adapter,typescript-adapter}.ts` (edge names), `graph/import-graph.ts` (names union), `pipeline/{pipeline.ts,manifest.ts}` (registration, memo/acquire, versions, dedupe); `docs/rules/axiom-3-cleanliness.md` (new incl. Ceilings), `README.md`, `CHANGELOG.md`; `tests/__fixtures__/cleanliness-rules/` (new), `tests/integration/cleanliness-rules.e2e.test.ts` (new incl. graph-roundtrip row), structural fixtures isolated via axiom-3 off, golden graph fixture regenerated; `tests/e2e-coverage.md`.
- **Review findings breakdown:** 17 patched (1 high, 6 medium, 10 low), 0 deferred, 1 rejected, 0 intent_gap, 0 bad_spec.
- **Follow-up review recommendation:** true — auto-forced by one HIGH inline finding (FOLLOW-UP-REVIEW AUTO-FORCE ON HIGH) and the accepted oversized flag.
- **Verification:** `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:boundaries`, `pnpm -r build`, `pnpm -r test` (52 contracts + 238 core + 7 cli), `pnpm test` (26 files / 380 tests) — all green after patches.
- **Residual risks:** unused-export ceilings documented (workspace consumers, destructured exports, export=) — noise profile measured at 1.17. Thresholds hardcoded (config exposure later). Recursion-depth duplicate hash guard untested (platform-dependent, degrades typed).
