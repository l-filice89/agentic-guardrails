# SPIKE-4 — Noise Metric and Labeled Fixtures (Story 1.17)

Defines the noise metric behind the "<30% noise" product claim — the
denominator, the labeling method, and the disposition-scope rule 1.16
explicitly deferred here — folds the five analyzers' existing fixtures into a
labeled set, and wires the CI gate that reports the rate and stops noise from
silently rising as analyzers land.

**Verdict: no noise claim without this metric.** Before this spike no
denominator, labeling method, or scope rule existed, so "<30% noise" was
unfalsifiable. From this story on, the claim means exactly the metric below,
and CI enforces it: overall rate strictly <30% over the labeled fixture set,
and per-analyzer rates non-increasing against the committed baseline.

## The metric

**Denominator: error/warning-severity findings.** Info-severity findings are
excluded from *both* sides — they neither count as noise nor dilute the rate.
A denominator of 0 is a rate of 0 (declared, never a 0/0 NaN).

**Numerator (live): findings dispositioned `not-actionable` under DR-1.**
Live labeling is human judgment captured by the 1.16 disposition prompt.
`deferred` and unlabeled findings stay in the denominator and never enter the
numerator. The definition also requires label coverage to be reported
alongside the rate — so an unlabeled store cannot fake a low number — with
that reporting landing together with the live-metric computation. This spike
defines the live metric only; computation lands once dogfood disposition data
exists (1.18+).

**Numerator (CI proxy): fixture placement.** The labeled set is the five
analyzers' existing e2e fixtures, read as labels:

- `violation/` + `expected-findings.json` — every golden entry is a true
  positive; an error/warning finding on `violation/` *absent* from the golden
  file is a false positive.
- `clean/` — the zero-noise oracle; every error/warning finding is a false
  positive.
- `noise/` (optional, none today) — known false-positive exemplars; every
  error/warning finding emitted there is a false positive. "Add a known FP"
  is a plain fixture commit, no new label format: the exemplar tree carries
  the same fixture-repo skeleton as its siblings (`tsconfig.json` +
  `config.yaml` + the source tree). Committing one *raises* that analyzer's
  measured FP count, so the same reviewed commit must also update the
  baseline counts — that is the deliberate, human-reviewed increase path the
  ratchet exists to force, and it is consistent with "no auto-ratcheting from
  CI", which only forbids CI itself mutating the baseline.

The conformance set's `no-corpus/` tree is an inconclusiveness fixture, not a
labeled tree, and stays out of the denominator. (The labeled set is
deliberately *not* called a corpus — that noun means the Axiom-6 conformance
corpus in this codebase.)

## Disposition scope — ruled: CARRIED

Whether a disposition labels only the run it was made in (per-run) or every
reappearance of the same `findingId` (carried) was deferred to this story by
1.16. **Ruling: carried.** The latest disposition for a `findingId`
(max `revision`, latest run — the `appendDispositions` latest-wins fold in
`packages/core/src/persistence/history.ts`) labels every reappearance in
later runs.

Rationale: a recurring false positive keeps annoying the user each run
whether or not they re-disposition it, so it must keep counting each run it
appears. Per-run scope would drop once-dispositioned reappearances from
measurement — undercounting exactly the recurring noise the metric exists to
catch — and would punish users for triaging. A carried disposition is not
forever-immutable: latest-wins with per-key `revision` means any later
re-disposition of the same `findingId` supersedes it — the remedy when
changed context makes an old label wrong. Carried scope is an aggregation
rule over the existing `{runId, findingId}` store; no schema change, no
re-disposition demanded.

## The gate

- Arithmetic on integers only: rates are compared as rationals
  (`num·denB` vs `numB·denA`); no float ever decides pass/fail. The committed
  baseline stores per-analyzer `{falsePositives, denominator}` counts, never
  a rate.
- Fails at ≥30% overall (the bar is strictly `<30%` — exactly 30% fails).
- Fails any analyzer whose rate rises above its committed baseline, naming
  the analyzer; a rate falling never mutates the baseline (no auto-ratchet
  from CI — tightening the baseline is a deliberate commit).
- Fails any analyzer with no baseline entry ("record a baseline entry") — a
  new analyzer is never silently unmeasured.
- Prints the per-analyzer FP/denominator/rate table on every run, pass or
  fail.

Implementation: pure gate logic in `tests/integration/noise-rate.ts`
(hazard-tested without spawning in `noise-rate.test.ts`); the sweep in
`tests/integration/noise-metric.e2e.test.ts` spawns the built CLI over temp
git repos built from each labeled tree — the same mechanics as the sibling
`*-rules.e2e.test.ts` suites — and rides the existing CI integration step (no
new workflow).

## Retroactive baseline

Measured by running the sweep over all five rule sets (structural,
cleanliness, nfr, security, conformance — 1.4's minimal rules were absorbed
into 1.9's set) on **2026-07-31** (Windows 11, Node 24, built CLI at
`eab0b96`+1.17 worktree); committed as
`tests/__fixtures__/noise-baseline.json`:

| Analyzer | FP | Denominator | Rate |
|---|---|---|---|
| structural | 0 | 4 | 0.0% |
| cleanliness | 0 | 4 | 0.0% |
| nfr | 0 | 5 | 0.0% |
| security | 0 | 7 | 0.0% |
| conformance | 0 | 3 | 0.0% |
| **overall** | **0** | **23** | **0.0%** |

Zero false positives everywhere is expected — the clean-tree e2e guards
already assert zero findings, and the violation trees are byte-compared
against their golden files — but the counts above are *measured from the
run*, not assumed. The value of the gate is what it does from here: any
future analyzer or rule change that emits on a clean tree, or beyond its
golden file, fails CI naming the analyzer.

## Re-running

```bash
pnpm -r build && pnpm test -- --project integration tests/integration/noise-metric.e2e.test.ts
```
