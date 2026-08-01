---
title: 'Story 1.17: SPIKE-4 — Noise Metric and Labeled Fixtures (gate)'
type: 'feature'
created: '2026-07-31'
status: 'done'
baseline_commit: eab0b96b75e572fc167338b8ad993769d9e88365
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The product claim is "<30% noise", but no noise metric exists — the denominator, the labeling method, and the disposition-scope question (per-run vs carried across `findingId` reappearances, explicitly deferred here by 1.16) are all undefined, so no noise claim can be made and nothing stops noise from silently rising as analyzers land.

**Approach:** Document the metric (denominator = error/warning-severity findings; labels = DR-1 dispositions live, fixture placement in CI), rule the disposition-scope question, fold the five analyzers' existing fixtures (`expected-findings.json` = true positives, clean trees = zero-noise oracle) into a labeled set, compute and commit a retroactive per-analyzer baseline, and wire a CI check that reports the rate, fails at ≥30% overall, and fails any analyzer whose rate rises above its baseline.

## Boundaries & Constraints

**Always:**

- *Metric definition (the deliverable of record):* denominator = **error/warning-severity findings** (info excluded from both sides). Live labeling = DR-1 dispositions; numerator = findings dispositioned `not-actionable`. CI proxy labeling = fixture placement, same denominator, labels standing in for dispositions.
- *Disposition scope — ruled here: CARRIED.* The latest disposition for a `findingId` (max `revision`, latest run — the `appendDispositions` fold) labels every reappearance in later runs, so a recurring false positive keeps counting each run it annoys the user without demanding re-disposition; per-run scope would drop once-dispositioned reappearances from measurement, undercounting exactly the recurring noise the metric exists to catch. `deferred` and unlabeled appearances stay in the denominator, never the numerator; label coverage is reported alongside so an unlabeled store can't fake a low rate. No schema change — carried scope is an aggregation rule over the existing `{runId, findingId}` store.
- *CI-proxy labeling — placement-based, no new label format:* a finding matching an `expected-findings.json` entry is a true positive; any error/warning finding on `clean/`, or on `violation/` but absent from the golden file, is a false positive; an optional `noise/` tree (none today) holds future known-FP exemplars — everything emitted there is a false positive. E2e byte-compare and clean-guard tests stay untouched; "add a known FP" becomes a plain fixture commit.
- *The gate is arithmetic on integers.* Rates compared as rationals (`num·denB` vs `numB·denA`), never floats; the committed baseline stores per-analyzer `{falsePositives, denominator}` counts, never a rate.
- *Retroactive baseline satisfied backward:* run the sweep over all five rulesets (structural, cleanliness, nfr, security, conformance — 1.4's minimal rules were absorbed into 1.9's set), commit the per-analyzer counts as the baseline, and reproduce the table in the spike doc, dated.
- *Sweep mechanics:* pattern-match the sibling `*-rules.e2e.test.ts` files — spawn the built CLI over a temp repo `cpSync`'d from each fixture tree, parse the artifact with `reviewArtifactSchema`. Gate/rate logic lives in a pure module so hazard cases are unit-testable without spawning.
- *Reporting:* every run of the check prints the per-analyzer table (FP / denominator / rate) — pass or fail.
- Update `docs/scores-trends-and-dispositions.md`: 1.16 deferred the carry-forward question here; point it at the ruling.

**Never:** No new contracts, schemas, or persistence. No live disposition-based metric *computation* (definition only — the live number becomes computable once dogfood runs exist; 1.18+). No new CI workflow step (the check rides the existing integration-project step). No float in any gate decision or committed number. Do not name the labeled set "corpus" in code or docs headings — that noun means the Axiom-6 conformance corpus here. Do not touch legacy `tests/fixtures/` + `tests/EXPECTED.md`. No auto-ratcheting the baseline downward from CI.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Today's sweep | current fixtures, e2e green | per-analyzer table; expected baseline ≈ 0 FP everywhere; check passes | — |
| Rate ≥30% overall | synthetic counts | check fails, rate printed | — |
| Exactly 30% | numerator·10 == denominator·3 | fails (bar is strictly `<30%`) | — |
| Analyzer above baseline | rate rises vs committed counts | fails naming the analyzer | — |
| Analyzer below baseline | rate falls | passes; no baseline mutation | — |
| New analyzer, no baseline entry | results key absent from baseline | fails: "record a baseline entry" | never silently skipped |
| Analyzer denominator 0 | no error/warning emissions | rate 0, passes, declared in table | never 0/0 NaN |
| Info-severity findings | any tree | excluded from numerator and denominator | — |

</frozen-after-approval>

## Code Map

- `tests/__fixtures__/{structural,cleanliness,nfr,security,conformance}-rules/` -- the five fixture trees: `violation/` + `expected-findings.json` (TP labels), `clean/` (zero-noise oracle)
- `tests/integration/structural-rules.e2e.test.ts` -- the sweep template: makeRepo/cpSync/spawn-built-CLI/parse-artifact helpers, 120s timeout
- `packages/contracts/src/review-artifact.ts` -- `reviewArtifactSchema`; findings carry `axiom`, `severity`, `ruleId`
- `packages/core/src/persistence/history.ts` -- `appendDispositions` latest-wins fold: the carried-scope aggregation the ruling references
- `docs/spikes/SPIKE-3-*.md`, `SPIKE-5-*.md` -- spike-doc naming precedent
- `docs/scores-trends-and-dispositions.md` -- currently defers carry-forward to 1.17; update
- `.github/workflows/ci.yml` -- already runs the integration project; no edit expected

## Tasks & Acceptance

**Execution:**
- [x] `tests/integration/noise-rate.ts` (new) -- pure functions: classify findings per placement rules → per-analyzer `{falsePositives, denominator}`; rational gate checks (<30% overall, per-analyzer vs baseline, missing-entry) -- unit-testable gate logic
- [x] `tests/integration/noise-rate.test.ts` (new) -- hazard tests from the matrix (≥30%, exactly-30%, above-baseline, missing-entry, zero-denominator, info exclusion) -- red-then-green per HAZARD-TEST RULE
- [x] `tests/integration/noise-metric.e2e.test.ts` (new) -- sweep all five rulesets (violation + clean + optional noise trees) via built CLI, print the table, assert the gates against the committed baseline -- the CI counter-metric
- [x] `tests/__fixtures__/noise-baseline.json` (new) -- committed per-analyzer counts from the retroactive sweep -- the ratchet
- [x] `docs/spikes/SPIKE-4-noise-metric.md` (new) -- metric definition (denominator, live + CI labeling), disposition-scope ruling + rationale, dated retroactive baseline table, "no noise claim without this metric" statement -- the spike deliverable
- [x] `docs/scores-trends-and-dispositions.md` -- replace the open carry-forward question with the ruling -- closes 1.16's deferral
- [x] `CHANGELOG.md`, `README.md`, `tests/e2e-coverage.md` -- changelog entry; README noise-gate mention; e2e-coverage `n/a` spike row (1.5/1.14 shape) -- DoD

**Acceptance Criteria:**
- Given the spike doc, when read, then it specifies the denominator (error/warning-severity findings), the labeling method (DR-1 dispositions live; fixture placement as the CI proxy), and records the disposition-scope ruling (carried) with rationale.
- Given the analyzers landed before this story, when the retroactive sweep runs, then a per-analyzer baseline is computed from their existing fixtures and committed — the "foundational" status satisfied backward.
- Given the labeled fixture set, when the deterministic pipeline runs over it in CI, then the noise rate is reported per analyzer and overall, and the check fails at ≥30%.
- Given an analyzer whose computed rate exceeds its committed baseline (or which has no baseline entry), when the check runs, then it fails naming the analyzer — the non-increasing requirement enforced, not advisory.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test`, when run, then all green.

## Spec Change Log

## Verification

**Commands:**
- `pnpm -r build && pnpm test -- --project integration` -- expected: noise-metric e2e green, table printed
- `pnpm test` -- expected: all projects green
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries` -- expected: clean

## Suggested Review Order

**The metric definition (the deliverable of record)**

- The whole spike in one doc: denominator, both labeling methods, gate semantics.
  [`SPIKE-4-noise-metric.md:15`](../../docs/spikes/SPIKE-4-noise-metric.md#L15)

- The CARRIED ruling 1.16 deferred here — rationale, staleness remedy via latest-wins revisions.
  [`SPIKE-4-noise-metric.md:53`](../../docs/spikes/SPIKE-4-noise-metric.md#L53)

- Measured (not assumed) retroactive baseline table, dated.
  [`SPIKE-4-noise-metric.md:95`](../../docs/spikes/SPIKE-4-noise-metric.md#L95)

**Gate logic (pure, unit-testable)**

- Placement-based TP/FP classification; exhaustive severity handling; info excluded both sides.
  [`noise-rate.ts:37`](../../tests/integration/noise-rate.ts#L37)

- The gates: rational arithmetic only, <30% strict, baseline validated before it decides anything.
  [`noise-rate.ts:135`](../../tests/integration/noise-rate.ts#L135)

- Validated golden-file parse — malformed labels error clearly, never mass-misclassify.
  [`noise-rate.ts:73`](../../tests/integration/noise-rate.ts#L73)

**The CI counter-metric**

- The sweep: five rulesets via built CLI, required trees enforced, table printed every run.
  [`noise-metric.e2e.test.ts:147`](../../tests/integration/noise-metric.e2e.test.ts#L147)

- The ratchet: committed integer counts, never a float rate.
  [`noise-baseline.json:1`](../../tests/__fixtures__/noise-baseline.json#L1)

**Peripherals**

- 21 hazard tests: ≥30%, exactly-30%, above-baseline, missing/stale/malformed baseline, severity traps.
  [`noise-rate.test.ts:1`](../../tests/integration/noise-rate.test.ts#L1)

- 1.16's open carry-forward question replaced by the ruling.
  [`scores-trends-and-dispositions.md:174`](../../docs/scores-trends-and-dispositions.md#L174)

- Changelog, README noise-gate mention, e2e-coverage spike row.
  [`CHANGELOG.md:13`](../../CHANGELOG.md#L13)
