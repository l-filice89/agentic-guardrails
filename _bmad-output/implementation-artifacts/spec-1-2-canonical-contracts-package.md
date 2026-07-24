---
title: 'Story 1.2: Canonical Contracts Package'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: 20460ade5621625ff09fa73e4a2a5f9802e4358c
review_loop_iteration: 0
followup_review_recommended: true # OVERSIZED-STORY RULE: oversized accepted (epic-defined story boundary; splitting schema families would create artificial half-contracts), elevated review posture from the start
context: []
warnings: [oversized]
---

<intent-contract>

## Intent

**Problem:** Nothing downstream (analyzers, pipeline, CLI, persistence) can be built safely until every canonical shape is defined once, validated at boundaries, and versioned — otherwise each story invents ad-hoc interfaces that drift.

**Approach:** Fill `@agentic-guardrails/contracts` with pure-Zod schemas for every canonical shape named below, plus the `findingId` hash function, the generic partial-result contract, the ADR-001 envelope factory, and a forward-migration ladder for persisted artifacts. Ship ADR-001 in the same change.

## Boundaries & Constraints

**Always:**
- `zod` (4.x) is the **only** runtime dependency of `contracts`; everything else stays dev-only. Boundary walls from 1.1 stay green.
- Every boundary validation uses `safeParse`; the package never throws on bad input in exported helpers.
- Every persisted-artifact schema carries `schemaVersion` (integer, starts at 1).
- `findingId` = stable hash over `{axiom, ruleId, file, enclosingSymbol | normalizedContext}` — **no line/column numbers in the hash input**, so ids survive line drift.
- Disposition enum pinned exactly as DR-1: `actionable | not-actionable | deferred`.
- Deterministic-tier findings carry the fixed maximum `confidence` (1); document this on the schema (calibrated confidence is LLM-tier, Epic 2+).
- Docs + ADR-001 land in this same change (project Definition-of-Done rule).

**Block If:**
- Any listed schema's fields cannot be pinned from the epics/architecture context without inventing semantics (do not fantasize field meanings).

**Never:**
- No LLM SDK anywhere (wall). No I/O in `contracts` (no fs/network — pure data + functions; JSON-Schema *generation* is an exported function, writing files is the consumer's job). No convention mining, no analyzer logic, no CLI. Do not build real migrations beyond the v1 no-op ladder — there is no v0 in the wild.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid Finding | object with all required fields | `safeParse` success | No error expected |
| Missing `severity` or `findingId` | Finding without either field | `safeParse` failure naming the field | typed ZodError, no throw |
| Line drift | same logical finding, lines added above (different line numbers) | identical `findingId` | n/a |
| Unknown enum value | `tier: 'llm'`, `source: 'guess'`, disposition `'wontfix'` | `safeParse` failure | typed ZodError |
| Old artifact version | artifact JSON at `schemaVersion: n` read by engine expecting `n+1` | migration ladder upgrades stepwise, then `safeParse` | unknown/future version → typed error result, never throw |
| Degraded partial result | `{ data, coverage, degraded: [entry] }` | validates; `degraded` entries are typed (reason, subject) | n/a |

</intent-contract>

## Code Map

- `packages/contracts/src/index.ts` -- placeholder export; becomes the barrel re-exporting all schema modules
- `packages/contracts/package.json` -- add `zod` runtime dep (only one)
- `packages/contracts/src/*.test.ts` -- colocated tests (Vitest `unit` project picks up `packages/**/src/**/*.test.ts`)
- `scripts/check-boundaries.mjs` -- wall stays untouched; `zod` is neither a workspace dep nor denylisted
- `docs/adr/README.md` -- ADR-001 row flips Planned → Accepted with link
- `tests/e2e-coverage.md` -- new committed e2e coverage map (E2E-COVERAGE RULE)

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/package.json` -- add `zod` ^4 as sole runtime dependency -- AC-1
- [x] `packages/contracts/src/finding.ts` -- `findingSchema`: `axiom`, `location {file, startLine, endLine}`, `message`, `tier: 'deterministic'|'inferred'`, `source: 'ast'|'regex'|'llm'`, `confidence (0..1)`, `severity: 'error'|'warning'|'info'`, `findingId`, optional `exemplar`, optional `degraded`; JSDoc documents per-tier confidence semantics -- core canonical shape
- [x] `packages/contracts/src/finding-id.ts` -- `computeFindingId({axiom, ruleId, file, enclosingSymbol})` → sha256-hex (node:crypto is not a runtime *dependency*) -- line-drift-stable identity
- [x] `packages/contracts/src/partial-result.ts` -- generic `partialResult(dataSchema)` → `{ data, coverage, degraded: Degradation[] }`; `degradationSchema` with typed `reason`/`subject` -- shared read contract
- [x] `packages/contracts/src/envelope.ts` -- ADR-001 `axiomEnvelope(inSchema, outSchema)` factory returning `<axiom>.in`/`.out` pair -- defined here, first consumed Epic 2
- [x] `packages/contracts/src/run-manifest.ts` -- `runManifestSchema`: ledger hash, corpus hash, ruleset version, tier-enablement, engine version, model identity + `modelIdentity.source` -- zero-silent-degradation carrier
- [x] `packages/contracts/src/config.ts` -- `configSchema` (per-axiom enforcement `blocking|advisory|off`, axiom #5 defaults to `blocking`) + exported `configJsonSchema` via zod's JSON-Schema generation -- feeds 1.6 config plane and editor autocomplete
- [x] `packages/contracts/src/trend-record.ts` -- OD-1 `trendRecordSchema`: `recordId`, `commitSha`, per-axiom severity counts, `changedKloc` -- raw counts only, score is a derived view
- [x] `packages/contracts/src/disposition-record.ts` -- DR-1 `dispositionRecordSchema`: `recordId`, keyed `{runId, findingId}`, pinned enum -- append-only history shape
- [x] `packages/contracts/src/migration.ts` -- versioned-artifact wrapper + `migrateArtifact(kind, raw)` stepwise ladder (registry keyed `kind → fromVersion → step`); v1 ladders are empty; unknown/future version → typed error result -- schema evolution spine
- [x] `packages/contracts/src/index.ts` -- barrel exporting all of the above -- single import surface
- [x] `packages/contracts/src/*.test.ts` -- colocated tests covering the full I/O matrix incl. hazard tests: missing `severity`/`findingId` fail; line-drift id stability; `zod` is the only key in `dependencies` (reads package.json via import attribute or fs in test only); multi-step ladder chaining proven with a synthetic test-only kind; golden round-trip fixture: committed v1 artifact JSON fixtures (`__fixtures__/`) migrate + `safeParse` green -- AC coverage
- [x] `docs/adr/ADR-001-llm-envelope.md` -- write ADR (envelope decision: every LLM interaction crosses a Zod-validated `<axiom>.in`/`.out` envelope; defined now, consumed Epic 2); link it in `docs/adr/README.md` -- DoD rule
- [x] `tests/e2e-coverage.md` -- create map with summary line for story 1.2: no UI-facing ACs (library package; first UI surface is the CLI in 1.4) -- E2E-COVERAGE RULE
- [x] `README.md` + `CHANGELOG.md` -- document the contracts surface briefly; changelog entry -- DoD rule

**Acceptance Criteria:**
- Given the contracts package, when dependencies are inspected, then `zod` is the only runtime dependency (asserted by a test).
- Given a candidate Finding, when validated with `safeParse`, then required/optional fields behave exactly per the I/O matrix, and missing `severity` or `findingId` fails.
- Given the same logical finding recomputed after unrelated lines are added above it, when `findingId` is regenerated, then it is unchanged.
- Given the package exports, when enumerated, then partial-result contract, `RunManifest`, ADR-001 envelope factory, config schema + generated JSON Schema, OD-1 trend-record schema, and DR-1 disposition-record schema are all present and Zod-validated.
- Given a persisted-artifact fixture at `v_n`, when read through `migrateArtifact` by an engine at `v_n+1`, then it upgrades before `safeParse` — proven by a golden round-trip fixture test plus a synthetic multi-step ladder test.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm test`, when run, then all green.

## Spec Change Log

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 16: (high 1, medium 9, low 6)
- defer: 0
- reject: 4: (high 0, medium 0, low 4)
- addressed_findings:
  - `[high]` `[patch]` `migrateArtifact` threw on prototype-chain kind names ("toString"/"constructor"), violating the never-throws contract (verified against the built package) — registry moved to a null-prototype object with `Object.hasOwn` guard; tested for four prototype names.
  - `[medium]` `[patch]` `registerArtifactKind` could silently clobber built-in ladders (incl. `__proto__` prototype assignment) — now refuses duplicates and malformed ladders, returning `false` (never throws), tested.
  - `[medium]` `[patch]` Finding invariants were prose, not schema: deterministic⇒confidence 1 ∧ source ast|regex, inferred⇒source llm now `superRefine`-enforced; inverted line ranges rejected; tested.
  - `[medium]` `[patch]` `findingSchema` lacked `ruleId`/`enclosingSymbol`, making `findingId` unauditable from the Finding itself — both added (ruleId required, enclosingSymbol optional anchor).
  - `[medium]` `[patch]` Line-drift AC test was tautological (hashed identical input twice) — rewritten: two schema-valid Findings at different lines share one id, tying `findingSchema` to `computeFindingId`.
  - `[medium]` `[patch]` Partial-result contract permitted silent degradation (`coverage 0.4, degraded: []` parsed) — refine: coverage < 1 requires ≥1 typed degradation entry; tested both directions.
  - `[medium]` `[patch]` RunManifest allowed llm-tier-enabled with no `modelIdentity` — refine added, tested; golden fixture's contradictory `model: "none"` entry removed.
  - `[medium]` `[patch]` All artifact schemas silently stripped unknown keys — persisted-artifact schemas, Finding, and config are now `strictObject` (documented: shape drift must fail parse + bump schemaVersion, never strip silently); tested.
  - `[medium]` `[patch]` `computeFindingId` forked ids across platforms on path separators — backslashes normalized to `/` before hashing, tested.
  - `[medium]` `[patch]` Migration steps returning non-objects spread to `{}` silently; input object could be left half-migrated — non-object step results are `step-failed`, input is shallow-copied, `Error` causes report `.message`; tested.
  - `[low]` `[patch]` `migrateArtifact` returned `value: unknown` — typed overload via `ArtifactTypeMap` for built-in kinds.
  - `[low]` `[patch]` Dependency-boundary test hardened: also asserts no peer/optional deps and survives a missing `dependencies` key.
  - `[low]` `[patch]` Config: axiom-5 blocking default was invisible in the generated JSON Schema (`io: "input"` + transform) — `.describe()` now carries it into editor tooltips; config objects are strict (typo keys fail instead of silently ignored).
  - `[low]` `[patch]` ADR-001 no longer overstates the shipped surface: envelope *shape* ships now, validating transport is Epic 2 scope bound by the rule.
  - `[low]` `[patch]` Ladder registration validates `currentVersion` (integer ≥ 1).
  - `[low]` `[patch]` Golden run-manifest fixture no longer models the `model: "none"` anti-pattern.

Rejected: envelope factory arity drift vs spec task text (harmless, shape is per-ADR); empty-string identity fields in `computeFindingId` (typed-string inputs, internal callers from 1.4+; a throw would violate the never-throw boundary); duplicated tsup dts workaround across two packages (Rule of Three — extract when a third package appears); ADR-005 phrasing nit. Process note (fixed in the harness, not the artifact): the review diff omitted untracked files — future review diffs include them.

## Design Notes

- `computeFindingId` deliberately excludes location line numbers; `enclosingSymbol` (or a normalized context string when no symbol exists) is the drift-stable anchor. Callers in 1.4+ supply it from the AST.
- Zod 4 ships native JSON-Schema generation — use it; do not add `zod-to-json-schema`.
- Migration ladder shape: `{ kind, versions: Map<number, (old) => new> }`; `migrateArtifact` loops `fromVersion` until current, then `safeParse`s with the current schema. Registering is cheap; v1 registries are empty by design.

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries` -- expected: green (wall untouched)
- `pnpm -r build && pnpm -r test && pnpm test` -- expected: green; contracts tests actually collected (not 0)


## Auto Run Result

- **Summary:** `@agentic-guardrails/contracts` filled with all canonical Zod 4 schemas (Finding + location, findingId hash, partial-result contract, ADR-001 envelope factory, RunManifest, config + JSON Schema, OD-1 trend record, DR-1 disposition record, forward-migration ladder), colocated tests, golden v1 fixtures, ADR-001, e2e coverage map seed, docs. Review pass applied 16 patches (1 high, 9 medium): the high was a verified never-throws violation on prototype-chain artifact kinds; the mediums hardened schema invariants from prose into enforced refinements (strict objects, tier coherence, silent-degradation coherence, llm⇒modelIdentity, path-separator-stable ids, auditable Finding identity).
- **Files changed:** `packages/contracts/src/*` (9 schema modules + barrel + 31-test suite + 3 golden fixtures), `packages/contracts/package.json` (zod sole runtime dep), `packages/contracts/tsconfig.json` + both `tsup.config.ts` (TS 6 dts workaround), `docs/adr/ADR-001-llm-envelope.md` (+README row), `tests/e2e-coverage.md` (new map; story 1.2 row: no UI-facing ACs), `README.md`, `CHANGELOG.md`.
- **Review findings breakdown:** 16 patched (1 high, 9 medium, 6 low), 0 deferred, 4 rejected, 0 intent_gap, 0 bad_spec.
- **Follow-up review recommendation:** true — pre-committed via OVERSIZED-STORY RULE, and independently forced by the HIGH inline finding (FOLLOW-UP-REVIEW AUTO-FORCE ON HIGH: no decline branch).
- **Verification:** `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:boundaries`, `pnpm -r build`, `pnpm -r test` (31 contracts + 2 core), `pnpm test` (4 files / 59 tests) — all green after patches.
- **Residual risks:** `registerArtifactKind` remains in the public barrel (refusal-hardened, documented test-only); the "normalized context string" fallback for `enclosingSymbol` is deliberately unpinned until 1.4+ supplies real AST anchors; tsup dts workaround duplicated in two packages pending a third.
