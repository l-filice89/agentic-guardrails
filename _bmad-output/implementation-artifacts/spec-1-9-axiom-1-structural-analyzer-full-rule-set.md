---
title: 'Story 1.9: Axiom #1 — Structural Analyzer (full rule set)'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: aff0bdee0c51eccdad4d62d0c8e292644cd97b8c
final_revision: 001856772e64a8a82703b9c1a29316754f1cec44
review_loop_iteration: 0
followup_review_recommended: true # AUTO-FORCED: two HIGH inline findings (ENGINE_VERSION cache-upgrade trap; catch-all alias false errors) + oversized acceptance
context: []
warnings: [oversized] # accepted, not split: edge-line + boundaries substrate + rules are one coherent analyzer change; elevated review posture per OVERSIZED-STORY
---

<intent-contract>

## Intent

**Problem:** Axiom #1 has exactly one rule (`structural/circular-import`) anchored at line 1 (edges carry no positions), unresolved imports surface only as degradations (a 1.4 delegation owed a finding), and dependency-direction / cross-boundary / misplaced-file violations have no rules AND no declaration substrate.

**Approach:** Extend import-graph edges with the import-statement line, add a minimal optional `boundaries` config key (path-prefix layers + allowed-dependency map — the `check-boundaries.mjs` allowlist shape, productized), and grow `axiom1Structural` to a documented four-rule set with a machine-compared fixture oracle.

## Boundaries & Constraints

**Always:**
- Rule set (all inside the ONE registered axiom-1 analyzer — registry enforces one analyzer per axiom):
  - `structural/circular-import` — existing Tarjan rule absorbed unchanged in behavior, but anchored at the real import line of the cycle edge leaving the anchor file (severity error).
  - `structural/unresolved-import` — a changed file whose import specifier fails resolution (relative/alias, NOT bare external specifiers — those are legitimate externals) → error finding at the import line, specifier in the message. Honors the 1.4 delegation ("deleted-file dangling-importer detection"). The graph-build degradation for the same event stays (coverage truth) — the finding is the actionable surface.
  - `structural/dependency-direction` — with `boundaries` declared: an import edge whose from-layer → to-layer pair is NOT in the allowed map → error finding at the import line, both layers named. Covers "disallowed cross-boundary imports" (same allowlist semantics).
  - `structural/unassigned-file` — with `boundaries` declared: a changed analyzable file matching NO declared layer prefix → warning finding ("misplaced files per the declared layout" — fail-closed like `ALLOWED_WORKSPACE_DEPS`: declaring a layout makes unassigned files visible).
- Declaration: optional `boundaries: { layers: [{ name, paths: [repo-relative prefixes] }], allowed: Record<layerName, layerName[]> }` in config.yaml (contracts `configSchema`; refine: allowed keys/values reference declared layer names; first matching prefix wins, longest-prefix-first for determinism). Absent `boundaries` → the two declaration-dependent rules emit nothing (nothing declared = nothing to check — NOT a degradation); old configs keep parsing (optional key), `config.schema.json` regenerates.
- Edge line spans: `ImportGraphEdge` gains `line` (1-based start line of the import/export declaration; dynamic imports use the call site). Cached graphs from the old schema fail revalidation → designed miss + recompute. `tests/__fixtures__/import-graph/expected-graph.json` regenerated. `enclosingSymbol` discriminators stay line-free (findingId stability): circular keeps the cycle path, unresolved uses the specifier, direction uses `from-layer->to-layer:target`, unassigned uses none (one per file).
- `RULESET_VERSION` bumps to "2" (cache + runId invalidation — stale findings must not survive the new rules).
- AnalyzerContext gains the loaded `boundaries` (plumbed from loadConfig in the pipeline) — analyzers still never read files outside the typed context.
- Determinism: findings sorted by existing pipeline order; identical input byte-identical (oracle asserted twice). All findings `axiom: "1"`, `tier: "deterministic"`, `source: "ast"`, `confidence: 1`.
- Fixture oracle: on-disk `tests/__fixtures__/structural-rules/` (tsconfig + src + config.yaml with boundaries) with `expected-findings.json` machine-compared (the `expected-graph.json` pattern, applied to findings — normalize only cache truth); plus a clean fixture asserting ZERO findings (false-positive guard feeding SPIKE-4).
- Docs: `docs/rules/axiom-1-structural.md` — one table row per rule: ruleId, severity, rationale, fixture case (new precedent; smallest thing satisfying "documented full rule set").
- Off/advisory behavior is existing 1.6 machinery — verify for the grown rule set via oracle-level e2e (off → skipped-and-declared in manifest; advisory → findings present, gate passes).

**Block If:**
- Edge `line` cannot be captured for a construct ts-morph resolves (would force choosing between dropping the edge and lying about the line).

**Never:** No zone-role/purpose semantics (corpus-map is Epic 4; placement-by-zone is Axiom #6 scope). No glob engine for layer paths (prefix match only). No new dependencies. No per-rule config (enforcement stays per-axiom). No cross-package npm-manifest checking (that stays `scripts/check-boundaries.mjs` self-hosting). No new analyzer registrations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Violation fixture | cycle + unresolved + direction breach + unassigned file | exactly the oracle findings: ruleIds, real import lines, severities | No error expected |
| Clean fixture | boundaries declared, all imports legal | zero findings | No error expected |
| No boundaries key | config without `boundaries` | circular+unresolved still run; direction+unassigned emit nothing; no degradation | No error expected |
| Bare external | import "zod" (not in a layer) | never unresolved, never direction-checked | No error expected |
| Type-only edge | `import type` crossing layers | direction rule ignores it (mirrors cycle rule's exclusion; compile-time only) | No error expected |
| Invalid boundaries | `allowed` references undeclared layer | typed config error, exit 2, path named | schema refine |
| Unchanged file violation | breach in a file outside changedFiles | no finding (scope = changed files, unchanged rule) | No error expected |
| Axiom 1 off | config `axioms: {"1": off}` | analyzer skipped, declared in manifest axiomsOff | No error expected |

</intent-contract>

## Code Map

- `packages/core/src/analyzers/axiom1-structural.ts` -- the one axiom-1 analyzer; RULE_ID, Tarjan, fixtureProject test pattern
- `packages/core/src/adapter/{language-adapter,typescript-adapter}.ts` -- edge schema (`{from,to,dynamic,typeOnly,reExport}` — gains `line`), unresolved tracking
- `packages/core/src/graph/import-graph.ts` -- serialize/golden fixture; `importGraphDataSchema` (cache revalidation)
- `packages/contracts/src/config.ts` -- strictObject config schema (+ optional boundaries, refine, JSON schema regen via config-loader)
- `packages/core/src/pipeline/pipeline.ts` -- AnalyzerContext (add boundaries), findings cache key, RULESET_VERSION consumer
- `packages/core/src/pipeline/manifest.ts` -- `RULESET_VERSION = "1"` → "2"
- `tests/__fixtures__/import-graph/expected-graph.json` -- regenerate with line field
- `tests/integration/walking-skeleton.e2e.test.ts` -- existing findings assertions (line-1 anchor changes)
- `scripts/check-boundaries.mjs` -- allowlist prior art (shape reference only)

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/adapter/*` + `graph/import-graph.ts` -- edge `line` field end-to-end (schema, builder, serialize); regenerate golden graph fixture -- real locations
- [x] `packages/contracts/src/config.ts` -- optional `boundaries` schema + cross-reference refine; config-loader JSON-schema output picks it up -- the declaration substrate
- [x] `packages/core/src/pipeline/pipeline.ts` + `manifest.ts` -- plumb boundaries into AnalyzerContext; RULESET_VERSION "2" -- wiring + invalidation
- [x] `packages/core/src/analyzers/axiom1-structural.ts` -- four rules per the Always list; per-rule severity; line-anchored locations; line-free findingId discriminators -- the rule set
- [x] `docs/rules/axiom-1-structural.md` + `README.md` + `CHANGELOG.md` -- rule table (ruleId/severity/rationale/fixture case); README points at it -- documented rule set
- [x] unit tests -- I/O matrix rows (each rule fires + each rule's negative, bare-external exemption, type-only exemption, no-boundaries silence, invalid-boundaries typed error, findingId distinctness across same-file rules incl. HAZARD: two unresolved imports in one file get distinct ids) -- coverage
- [x] `tests/__fixtures__/structural-rules/` (violation + clean) + `tests/integration/structural-rules.e2e.test.ts` -- oracle comparison (byte-stable, asserted twice), clean-fixture zero findings, off/advisory oracle rows -- AC oracle
- [x] `tests/e2e-coverage.md` -- 1.9 row -- DoD

**Acceptance Criteria:**
- Given the violation fixture, when review runs, then findings match `expected-findings.json` exactly — ruleIds, axiom "1", tier deterministic, source ast, real import-statement lines, severities per the rule table.
- Given the clean fixture, when review runs, then zero findings (and the artifact says so).
- Given the 1.4 walking-skeleton rule, when this story lands, then it is absorbed into the documented rule table (every rule ≥1 fixture case + rationale) and its findings now carry real line anchors.
- Given a deleted or misspelled relative-import target in a changed file, when review runs, then a `structural/unresolved-import` error finding names the specifier at its line (1.4 delegation honored).
- Given axiom 1 `off` / `advisory`, when review runs, then skipped-and-declared / present-but-non-gating respectively, byte-identical on identical input.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test`, when run, then all green.

## Spec Change Log

## Review Triage Log

### 2026-07-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 16: (high 2, medium 7, low 7)
- defer: 1: (high 0, medium 1, low 0)
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` ENGINE_VERSION was not bumped despite the cached-graph payload schema changing (edge `line`, `unresolvedImports`) — post-upgrade warm repos would hit the SAME key, fail strict revalidation, and exit 2 with a corruption-flavored degradation once per cached tsconfig. Bumped to "0.0.2" (old entries become clean key misses), package.json versions kept in sync, upgrade-path test plants a stale old-key entry and asserts miss-not-degradation, CHANGELOG corrected.
  - `[high]` `[patch]` `matchesPathsAlias` treated the catch-all tsconfig `paths: {"*": ...}` as an alias signal — every typo'd/uninstalled bare package became a blocking unresolved-import error, contradicting the bare-external exemption; suffix after `*` was also ignored (over-matching). Bare `*` skipped, prefix+suffix honored with a length guard; three adversarial tests.
  - `[medium]` `[patch]` FR-21 merge collapsed DIFFERENT rules colliding at one line (circular + direction merged into one finding with one ruleId) — merge group key now includes ruleId (same-rule cross-source merging, the FR-21 use case, preserved); granularity documented; distinct-rules-same-line test.
  - `[medium]` `[patch]` A layer named `constructor`/`toString` resolved `boundaries.allowed[layer]` through Object.prototype and crashed the analyzer — Object.hasOwn guard + test with a layer literally named "constructor".
  - `[medium]` `[patch]` `layerOf` compared prefixes case-sensitively while the same file case-folds everything else on win32/darwin — fail-open direction rule + spurious unassigned warnings on the primary dev platform. foldCase applied; platform-gated test.
  - `[medium]` `[patch]` Layer path prefixes accepted globs, backslashes, `./`, `/`, trailing `/`, and the same path in two layers — all silently match-nothing failure modes. superRefine rejects each with the exact config path named; nine tests.
  - `[medium]` `[patch]` Adding `line` to edgeKey silently changed edge identity — duplicate imports became distinct edges, inflating fanIn and drifting the 1.8 structural seed across upgrade. Edge identity restored (line-free key, smallest observed line kept); golden fixture byte-stable.
  - `[medium]` `[patch]` Boundary BYPASS: the direction rule silently skipped edges to internal files in no layer — routing imports through an unassigned unchanged file evaded both rules. Now fires with the `(unassigned)` pseudo-layer discriminator; bypass test added.
  - `[medium]` `[patch]` No test exercised a cache HIT through the new payload fields — clean-fixture e2e now runs twice asserting hits > 0, invalid = 0, byte-identity.
  - `[low]` `[patch]` A declared boundaries block produced no 1.6 deviation line — "boundaries: N layers declared (default: none)" emitted + test.
  - `[low]` `[patch]` Files absent from every built graph were double-reported (degradation + unassigned warning) — warning skipped for degraded-absent files.
  - `[low]` `[patch]` findingId's "absent enclosingSymbol hashes as empty string" convention was undocumented — documented in finding-id.ts + finding.ts.
  - `[low]` `[patch]` Blanket 120s integration testTimeout — replaced with per-file timeouts where the load actually lands (spawn-heavy e2e 120s, ts-morph-heavy units 30-60s).
  - `[low]` `[patch]` Type-only unresolved imports claimed runtime breakage — adapter carries typeOnly, message corrected, severity stays error.
  - `[low]` `[patch]` Duplicate changedFiles entries doubled per-file findings — deduped iteration + test.
  - `[low]` `[patch]` Doc/accuracy sweep: unassigned synthetic-line-1 carve-out, absolute specifiers named, per-target direction multiplicity stated, fixture $schema headers dropped, silent `?? 1` cycle-anchor fallback replaced with an explicit loud degradation.
  - `[medium]` `[defer]` unassigned-file has no exemption mechanism (ignore list / unlayered declaration) — guaranteed noise in repos with undeclared tooling paths; ledgered for 1.17 (SPIKE-4 noise metric) to measure before adding config surface.

### 2026-07-31 — Independent follow-up review pass (stamp consumed)
- reviewed_range: aff0bdee..00185677, verified against HEAD
- revalidated: 2026-08-01 — forced fixes remain intact; the pathological case-duplicate note was removed, and the common asset-import issue was reclassified by gate impact
- forced-scrutiny areas confirmed fixed at HEAD: ENGINE_VERSION cache-upgrade trap (now "0.0.3", clean-miss path seam-tested via `computeGraphKey(engineVersion)`); catch-all `paths: {"*"}` alias false errors (`matchesPathsAlias` skips bare `*`, prefix+suffix with length guard) — both patches survived 1.10–1.19; boundaries still in the findings cache key (pipeline.ts:1017), merge key still includes ruleId, edge identity still line-free.
- findings_fixed_and_verified_at_HEAD:
  - audit_note: The bullets below preserve each original defect statement for audit continuity; they are fixed, not current findings. The adjacent remediation evidence names the HEAD verification surface.
  - remediation_evidence: `packages/core/src/adapter/typescript-adapter.test.ts`; focused regression suite passed 2026-08-01.
  - [medium] packages/core/src/adapter/typescript-adapter.ts:206-211 — any relative specifier the TypeScript compiler cannot resolve becomes a blocking `structural/unresolved-import` error with no carve-out for bundler/plugin-resolved asset imports (`import "./x.css"`, `?raw` suffixes): ordinary Vite-style source can therefore fail the default gate even though the bundler resolves it successfully. This is not just a stated coverage ceiling; it is a false blocking finding and belongs in the SPIKE-4 noise surface or needs an explicit supported-extension policy.

## Design Notes

- One `boundaries` key powers three AC clauses: direction breaches and disallowed cross-boundary imports are the same allowlist check; misplacement is its fail-closed complement (file in no layer). Zone-ROLE placement is deliberately left to Axiom #6/Epic 4 — this is layout-by-path, the only deterministic substrate available in Epic 1.
- Edge-schema change over per-finding re-parse: lines belong in the graph (single source, every current and future rule gets locations free); cached old-schema graphs fail Zod revalidation and recompute — the designed invalidation path, no migration needed for a gitignored cache.

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test` -- expected: green with structural-rules e2e collected


## Auto Run Result

- **Summary:** Axiom #1 grew from one rule to a documented four-rule set — `circular-import` (real import-line anchors via the new edge `line` field), `unresolved-import` (1.4 delegation honored: broken relative/alias/absolute specifiers become error findings; bare externals and node builtins exempt), `dependency-direction` (path-prefix layers + allowed map from the new optional `boundaries` config key, incl. the `(unassigned)` target bypass guard), and `unassigned-file` (fail-closed layout visibility, warning) — with a machine-compared fixture oracle (`expected-findings.json`, byte-stable twice), RULESET_VERSION "2" + ENGINE_VERSION "0.0.2" invalidation, and `docs/rules/axiom-1-structural.md`. Review pass applied 16 patches (2 high: the cache-upgrade path exited 2 with a corruption-flavored degradation on every warm repo; the catch-all `paths: {"*"}` pattern turned every typo'd npm package into a blocking error).
- **Files changed:** `packages/core/src/adapter/{language-adapter,typescript-adapter}.ts` (edge line, unresolved records + typeOnly), `graph/import-graph.ts` (line carried, identity preserved), `analyzers/axiom1-structural.ts` (four rules), `pipeline/{pipeline.ts,merge.ts,manifest.ts}` (boundaries plumbing + cache key, ruleId merge key, version bumps), `config/config-loader.ts` (boundaries deviation line); `packages/contracts/src/{config.ts,finding.ts,finding-id.ts}` (boundaries schema + path refines, docs); `docs/rules/axiom-1-structural.md` (new), `README.md`, `CHANGELOG.md`, `vitest.config.ts` (per-file timeouts); `tests/__fixtures__/structural-rules/` (new violation+clean oracle fixtures), `tests/integration/structural-rules.e2e.test.ts` (new), golden graph fixture regenerated; `tests/e2e-coverage.md`.
- **Review findings breakdown:** 16 patched (2 high, 7 medium, 7 low), 1 deferred (unassigned-file exemption surface → 1.17), 0 rejected, 0 intent_gap, 0 bad_spec.
- **Follow-up review recommendation:** true — auto-forced by two HIGH inline findings (FOLLOW-UP-REVIEW AUTO-FORCE ON HIGH) and the accepted oversized flag (OVERSIZED-STORY).
- **Verification:** `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:boundaries`, `pnpm -r build`, `pnpm -r test` (52 contracts + 199 core + 7 cli), `pnpm test` (24 files / 336 tests) — all green after patches.
- **Residual risks:** unassigned-file noise profile unmeasured until 1.17 (deferred exemption surface). The violation fixture's CLI run exits 2 via degradation dominance (unresolved import's paired degradation) — documented, honest. Boundaries is layout-by-path only; zone-role placement stays Axiom #6/Epic 4 scope.
