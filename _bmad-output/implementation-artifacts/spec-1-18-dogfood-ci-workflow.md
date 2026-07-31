---
title: 'Story 1.18: Dogfood CI Workflow'
type: 'feature'
created: '2026-07-31'
status: 'done'
baseline_revision: a5bde87f25235f033cffc19211687391dd49c693
final_revision: 9004c3989480761500073eef27c8c4cf7fae8bfd
review_loop_iteration: 0
followup_review_recommended: true # AUTO-FORCED: one HIGH inline finding (shallow-checkout dogfood step) per FOLLOW-UP-REVIEW AUTO-FORCE ON HIGH + accepted OVERSIZED flag; plus a Block-If human-ruling cycle mid-story
context: []
warnings:
  - 'OVERSIZED (accepted): the story bundles a config-plane feature (exclusions), the repo dogfood bootstrap, the CI step, and five mandated ledger dispositions (DELEGATED-WORK-CARRIES-AN-AC) — splitting the rulings from the mechanism that implements them would orphan the delegations. Elevated review posture from the start per OVERSIZED-STORY: treat followup_review_recommended as true.'
---

<intent-contract>

## Intent

**Problem:** The M1 gate says "this repo reviews 100% of its own PRs at zero LLM cost", and nothing runs the tool on its own PRs. Worse, the dogfood is currently poisoned by design: the repo's own analyzer fixtures are deliberately dirty, so any PR touching `tests/__fixtures__/` (or legacy `tests/fixtures/`) trips a blocking gate — the deferred "dogfood self-gate" item 1.12 ledgered to this story.

**Approach:** Add a review-scope exclusion config (the ledgered surface decision — ruled: config-driven path prefixes, declared never silent), bootstrap the repo's own committed `_agentic-guardrails/` layer via `guardrails init` with the fixture trees excluded, and add a CI step that runs `guardrails review` on every PR diff via direct CLI invocation (`--no-input`, deterministic-only — the only mode that exists), failing the check on blocking findings, asserting the <60s NFR-1 envelope, and publishing the run artifact as a workflow artifact without committing. Rule the other three ledger items naming 1.18, in writing.

## Boundaries & Constraints

**Always:**

- *Exclusion config — the self-gate surface, ruled.* New optional `contracts` config key (e.g. `exclude: string[]`) of posix path prefixes, applied where the change set is built (`scope.ts` — same site that already excludes `_agentic-guardrails/`), for ALL scopes including `--project`. Matching uses the same case-folding rule as existing scope prefix matches. Exclusions also apply to the changed-KLOC denominator (an excluded file is not part of the reviewed change, either side). Excluded files are COUNTED AND DECLARED per run (manifest + report line) — config-driven, deviation-logged via `computeDeviations`/effective-defaults (the 1.16 pattern for new keys), never silent. JSON schema regenerated.
- *Dogfood bootstrap.* Run `guardrails init` on this repo and COMMIT the committed layer: `config.yaml` (axiom defaults untouched — security stays blocking) with `exclude: [tests/__fixtures__/, tests/fixtures/, _bmad-output/, packages/core/src/analyzers/axiom5-security.test.ts, packages/core/src/pipeline/pipeline.test.ts]` — the last three per the human ruling of 2026-07-31 (narrow exact-path excludes for deliberate fake credentials; a future fake in a new file re-trips the gate by design), seeded `history/*.jsonl`, `.gitattributes` wiring. The gitignored layers stay gitignored.
- *tsconfig coverage fix (human ruling 2026-07-31, owned here):* add `tests/tsconfig.json` (and cover root `tsup.config.ts`/`vitest.config.ts`) so every tracked TS file belongs to a tsconfig project and the import graph sees it — eliminating the 19 "changed file absent from the built import graph" degradations that force exit 2. The dogfood sanity run must exit 0 with zero degradations of that class.
- *The CI step (in the existing job, after Build — no packaged Action, no new workflow file):* on `pull_request` only, `git fetch` the base ref, then `node packages/cli/dist/index.js review --branch HEAD --base origin/<base> --no-input`; nonzero exit fails the check. Measure the review step's wall-clock in the step itself and fail if ≥60s (NFR-1; this repo is well under the ~1,000-file reference size). Upload `_agentic-guardrails/reviews/` via `actions/upload-artifact` (always, even on failure) — `--no-input` disposition is `drop`, which leaves the artifact untracked on disk, so upload-without-committing IS the configured policy.
- *Determinism required check:* the byte-identity parity tests already run in CI's integration project (five `*-rules.e2e.test.ts` determinism assertions). This AC is satisfied by those existing required-check tests — state it in the docs; do not build a second determinism harness.
- *Ledger rulings (DELEGATED-WORK-CARRIES-AN-AC — each recorded in `docs/` and the ledger entry updated with its disposition):*
  1. Dogfood self-gate → OWNED here (the exclusion config above).
  2. Uncommitted-config policy → RULED: current behavior stands (allowed + declared + stderr warning); the dogfood workflow runs from a clean checkout so the governing config is committed by construction.
  3. Knowledge-file provenance asymmetry → REASSIGNED to Epic 4 (no knowledge files participate in dogfood CI; ledger entry updated with owner + reason).
  4. Cross-platform parity → RULED: same-platform determinism is the asserted claim (ubuntu CI + the suite); cross-platform byte-parity is explicitly NOT claimed, documented; the open product question stays ledgered for the epic-end operator sweep.
  5. SPIKE-5 Windows regression posture → RULED: accepted one-time-evidence posture + the maintainer's routine full-suite runs on Windows as the practical guard; a Windows CI runner stays ledgered as future work with this recorded reason.
- *Hazard tests (red-then-green):* excluded-path violation produces zero findings with the exclusion DECLARED (and exit 0); the same fixture without the exclude entry produces the finding (proves the exclusion is doing the work); exclusion applies to the KLOC denominator; exclude-everything yields the normal empty-change-set path, declared, never a crash; config with a non-array/absolute/backslash `exclude` entry fails config validation with a clear message.
- External-surface statement: the workflow uses only GitHub Actions' default `GITHUB_TOKEN` on this repo; the tool itself has zero egress — no third-party service, no credential risk beyond what CI already carries.

**Block If:** The dogfood review of the bootstrap PR itself fails with findings that are NOT resolved by the fixture exclusions — real blocking findings on this repo's own code need a human ruling, not a widened exclusion list.

**Never:** No packaged GitHub Action (direct CLI invocation only). No LLM, no network egress from the tool. No committing review artifacts from CI. No new workflow file (extend `ci.yml`). No glob engine for exclusions — posix prefix match only (globs are a later need). No weakening of analyzer defaults (`maxFindings` stays 0, security stays blocking) to make dogfood pass. No second determinism harness.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| PR with clean diff | dogfood step on PR | review exits 0, artifact uploaded, wall-clock printed | — |
| PR touching dirty fixtures | change under `tests/__fixtures__/` | files excluded + declared; no fixture-driven findings; exit 0 | never silent exclusion |
| PR with a real blocking finding | error finding in product code | exit 1 → check fails; artifact still uploaded | — |
| Review ≥60s | slow run | step fails naming the measured duration | — |
| Excluded path, any scope | violation file under an `exclude` prefix | zero findings from it, exclusion declared, KLOC excludes it | — |
| Exclude entry invalid | absolute path, backslashes, non-array | config validation fails with clear message | never a silently ignored entry |
| Everything excluded | exclude covers whole diff | normal empty-change-set path, declared | never a crash |
| Push to main | non-PR trigger | dogfood review step skipped (no base ref) | — |
| Fork PR / detached base | base ref unfetchable | step fails loudly (fetch error), not a silent skip | — |

</intent-contract>

## Code Map

- `packages/contracts/src/config.ts` -- strict config schema; add optional `exclude`; refinements pattern at lines 15–27; JSON schema is generated from it
- `packages/core/src/config/config-loader.ts` -- `EFFECTIVE_DEFAULTS` + `computeDeviations` must learn the new key (1.16 precedent, FR-31)
- `packages/core/src/pipeline/scope.ts` -- change-set construction; existing `_agentic-guardrails/` exclusion + `changeSizeFor` (KLOC side) are the two application sites
- `packages/core/src/pipeline/pipeline.ts` -- manifest composition; where the exclusion declaration lands
- `packages/cli/src/review-command.ts` -- exit codes 0/1/2 header; report line for declared exclusions
- `packages/cli/src/disposition.ts` -- non-interactive → `drop` leaves artifact untracked (the upload-not-commit mechanism)
- `.github/workflows/ci.yml` -- single job; dogfood step goes after Build
- `_agentic-guardrails/` -- only `.gitignore` committed today; `init` output lands here
- `_bmad-output/implementation-artifacts/deferred-work.md` -- the five 1.18-naming entries to disposition
- `tests/integration/config-plane.e2e.test.ts` (or nearest sibling) -- pattern for config-key integration tests

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/config.ts` -- optional `exclude: string[]` (posix prefixes; reject absolute/backslash entries) + regenerate JSON schema + golden fixtures -- contract first
- [x] `packages/core/src/config/config-loader.ts` -- defaults + `computeDeviations` learn `exclude` -- FR-31 transparency
- [x] `packages/core/src/pipeline/scope.ts` + `pipeline.ts` -- apply exclusions to change set AND `changeSizeFor`; count + declare excluded files in manifest; report line in `review-command.ts` -- the self-gate fix
- [x] `_agentic-guardrails/config.yaml` -- extend `exclude` with the three ruled entries (`_bmad-output/`, the two exact test-file paths) -- Block-If resolution
- [x] `tests/tsconfig.json` (new) + root config-file coverage -- every tracked TS file in a tsconfig project; the 19 import-graph degradations gone -- ruled into this story
- [x] `.github/workflows/ci.yml` -- PR-only dogfood step: fetch base, direct CLI review `--no-input`, wall-clock assert <60s, `actions/upload-artifact` on `always()` -- the M1 gate mechanism
- [x] Unit + integration tests per the hazard list -- red-then-green
- [x] `docs/dogfood-ci.md` (new) + ledger-entry dispositions in `deferred-work.md` + `docs/adr/ADR-006-review-exclusions.md` (short: the surface decision + why prefix-not-glob) -- rulings recorded
- [x] `CHANGELOG.md`, `README.md`, `tests/e2e-coverage.md` -- DoD

**Acceptance Criteria:**
- Given a PR to this repo, when the Actions workflow runs, then `guardrails review` executes on the PR diff via direct CLI invocation with `--no-input`, deterministic-only, and blocking findings fail the check via nonzero exit.
- Given the CI suite, when it runs, then the existing deterministic byte-identity tests execute as part of the required check and the run artifact is published as a workflow artifact without being committed.
- Given this repo's size, when the dogfood review runs, then measured wall-clock is under 60 seconds and the step fails otherwise.
- Given a configured `exclude` prefix, when any scope reviews a change under it, then no findings arise from excluded files, the exclusion is counted and declared in manifest and report, and the changed-KLOC denominator excludes them — verified by tests either way (with and without the entry).
- Given the five deferred-work entries naming 1.18, when the story completes, then each carries a recorded disposition (owned / ruled / reassigned with reason) in the ledger and docs.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test`, when run, then all green.

## Spec Change Log

- **2026-07-31 — Block-If resolved by human ruling (Luca), intent amended:** (1) the 12 fake-credential findings outside the fixture trees are handled by NARROW EXACT-PATH excludes (`_bmad-output/`, the two named test files) — no allowlist mechanism, no relocation; new fakes in new files re-trip the gate deliberately. (2) The tsconfig coverage gap (19 degradations → exit 2, deferred since 1.4) is OWNED BY THIS STORY: `tests/tsconfig.json` + root config-file coverage. KEEP: the entire exclusion mechanism, hazard tests, and bootstrap as built pre-block — verified green, not re-derived.

## Review Triage Log

### 2026-07-31 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 14: (high 1, medium 3, low 10)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` The CI dogfood step ran against `actions/checkout`'s default depth-1 shallow clone, so the `merge-base`-driven branch diff — the centerpiece of the story — would fail or graft wrong on real PRs. `fetch-depth: 0` added to checkout.
  - `[medium]` `[patch]` `excludeSchema` admitted entries that could never match (untrimmed whitespace, `//`, `.`/`..` segments) or could forge output lines (control chars/newline in the interpolated prefix list) — the exact hostile-text class 1.16 sanitized; and the drive-letter guard false-rejected posix names like `a:notes/x.ts`. All rejected/fixed at the schema with per-case tests; literal-glob filename limitation documented.
  - `[medium]` `[patch]` The committed seed `history/trends.jsonl` carried six mixed pre/post-exclusion records at one sha (12-error beside 0-error), so the first real trend delta would report a fake improvement and the M1 evidence started untrustworthy. Both history stores reset to empty at story landing.
  - `[low]` `[patch]` Exclusion declaration/deviation lines named ALL configured prefixes unbounded, not the ones that matched, and the excluded-count's coverage of the size side was unverified — matched-only, capped at 3 + count, verified.
  - `[low]` `[patch]` "Narrow exact-path excludes" wording overstated: `_bmad-output/` is a whole generated-artifacts tree — reworded in config comment/ADR/docs; the all-axiom cost of excluding the two test files and the silent-no-match design limit acknowledged in ADR-006.
  - `[low]` `[patch]` CI step printed no wall-clock when the review failed (the runs most worth inspecting), and its fork-PR comment misdescribed base-ref fetching — duration now always printed, exit code preserved, loud named fetch failure.
  - `[low]` `[patch]` `foldCase` moved from an analyzer module to a shared core home (scope.ts had extended the analyzer into the pipeline's import graph for a generic utility).
  - `[low]` `[patch]` No e2e for a prefix matching nothing — added (run identical to no-entry: no declaration, same findings/exit).
  - `[low]` `[patch]` `docs/dogfood-ci.md` asserted <60s with no measured evidence, and the root `@types/node` pin silently downgraded repo-wide lockfile resolutions — doc reworded with a dated local measurement; the pin aligned/justified in the CHANGELOG.

## Verification

**Commands:**
- `pnpm -r build && pnpm test -- --project integration` -- expected: exclusion + dogfood tests green
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r test && pnpm test` -- expected: all green
- `node packages/cli/dist/index.js review --project --no-input` (in this repo) -- expected: exit 0, fixture trees declared excluded

**Manual checks (if no CLI):**
- `ci.yml` dogfood step is PR-only, uses `always()` for upload, and asserts the measured duration.

## Auto Run Result

- **Status:** blocked — the intent-contract's Block-If triggered during implementation.
- **Blocking condition:** the dogfood review of this repo fails with blocking findings NOT resolved by the fixture exclusions, plus an independent degradation-driven exit 2.
  1. **12 `security/hardcoded-secret` errors survive the exclusions** — deliberate fake credentials living OUTSIDE the excluded fixture trees: 8 in `packages/core/src/analyzers/axiom5-security.test.ts` (inline unit-test fixtures), 2 in `packages/core/src/pipeline/pipeline.test.ts`, 1 in `_bmad-output/implementation-artifacts/spec-1-12-…md` (spec doc quoting a finding), 1 more AWS-key pattern in the same test file. Resolving requires a human ruling the spec reserves: widen exclusions (e.g. `_bmad-output/` + inline-test allowance), an allowlist mechanism, or relocating the fakes into excluded trees.
  2. **19 coverage degradations force exit 2 even at zero findings**: `tsup.config.ts`/`vitest.config.ts`/`tests/integration/*.ts` are TS files in no tsconfig project, so they are absent from the built import graph ("changed file absent from the built import graph"). This is the 1.4-era deferred item (`tests/tsconfig.json`), not owned by 1.18 — but any CI dogfood step would fail on every PR touching integration tests until it is resolved.
- **Completed before the block (all verified green):** the exclusion config end to end — `contracts` `exclude` key (posix prefix validation, JSON schema regen), `computeDeviations` FR-31 entry, `excludedBy()` applied in `changeSetFor` + `changeSizeFor` for all scopes, exit-neutral `scope-exclusions` declaration + `excluded:` report line, 15 new hazard tests incl. `tests/integration/exclusions.e2e.test.ts` (with/without causality, KLOC 3→1, exclude-everything, invalid entries); dogfood bootstrap (`guardrails init` run, `config.yaml` excludes both fixture trees, committed layer verified surfacing correctly). Verification: lint/typecheck/boundaries/build clean; `pnpm -r test` green; root suite 47 files / 796 tests, twice.
- **Not done (deliberately, pending ruling):** `ci.yml` dogfood step (would ship a permanently-red required check), `docs/dogfood-ci.md`, ADR-006, the five ledger dispositions, CHANGELOG/README/e2e-coverage.
- **Decisions needed to resume:** (1) the surface for fake credentials outside fixture trees; (2) ownership/timing of `tests/tsconfig.json` coverage fix relative to this story.

## Auto Run Result

- **Summary:** The M1 dogfood gate is mechanically real: every PR to this repo now gets `guardrails review` on its diff in GitHub Actions — direct CLI invocation on a full-history checkout, `--no-input`, deterministic-only — with blocking findings failing the check, the NFR-1 <60s envelope asserted in-step (measured ~10s locally, dated), and the run artifact uploaded as a workflow artifact without committing. The enabling feature is the new `exclude` config key (posix prefixes, strictly validated, applied to change set AND changed-KLOC in all four scopes, declared matched-only and capped, FR-31 deviation-logged). The repo's own committed `_agentic-guardrails/` layer is bootstrapped with five exclude entries: the two dirty fixture trees, plus — per the mid-story Block-If human ruling — one generated-artifacts tree (`_bmad-output/`) and two exact test-file paths carrying deliberate fake credentials. The ruling's second half pulled the 1.4-era tsconfig coverage gap into this story: `tests/tsconfig.json` + root config-file coverage eliminated all 19 import-graph degradations. Both dogfood sanity runs exit 0 with 0 errors and 0 degradations. All five 1.18-naming deferred-work entries carry recorded dispositions; ADR-006 records the exclusion surface decision.
- **Files changed:** `packages/contracts/src/config.ts` (+tests) — `exclude` schema; `packages/core/src/pipeline/scope.ts` (+tests) — `excludedBy`, change-set + `changeSizeFor` application, matched-only capped declaration; `packages/core/src/config/config-loader.ts` (+tests) — FR-31 deviation; `packages/core/src/pipeline/pipeline.ts` — threading; `packages/core/src/util/fold-case.ts` (new) — shared home for `foldCase`; `packages/cli/src/review-command.ts` — `excluded:` report line; `.github/workflows/ci.yml` — dogfood step (fetch-depth 0, wall-clock assert, artifact upload); `_agentic-guardrails/` — committed layer (config.yaml with 5 excludes, empty history stores, conventions/corpus-map/.gitattributes); `tests/tsconfig.json` (new) + root `tsconfig.json`/`vitest.config.ts`/`package.json`/lockfile + 10 integration-test imports switched to package surface; `tests/integration/exclusions.e2e.test.ts` (new, 6 cases); `scripts/check-boundaries.mjs` — root allowlist; `docs/dogfood-ci.md` (new), `docs/adr/ADR-006-review-exclusions.md` (new) + ADR index; `deferred-work.md` — six dispositions; `CHANGELOG.md`, `README.md`, `tests/e2e-coverage.md`.
- **Review findings breakdown:** 14 patched (1 high, 3 medium, 10 low), 0 deferred, 0 rejected, 0 intent_gap, 0 bad_spec (see Review Triage Log).
- **Follow-up review recommendation:** true — auto-forced by the HIGH shallow-checkout finding (FOLLOW-UP-REVIEW AUTO-FORCE ON HIGH), reinforced by the accepted OVERSIZED warning and the breadth of the patch pass (workflow, schema, committed data hygiene, refactor).
- **Verification:** `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:boundaries`, `pnpm -r build`, `pnpm -r test` (contracts 61, core 538, cli 48), `pnpm test` (47 files / 800 tests) — all green after patches. Dogfood sanity: `review --project --no-input` exit 0 (215 findings, 0 errors, 0 degraded, 140 files excluded, matched-only declaration); `review --branch HEAD --base main --no-input` exit 0 (197 findings, 0 errors, 0 degraded, 122 excluded). Seed history stores re-truncated after the final runs so the committed layer lands empty.
- **Residual risks:** The CI step has never executed on a real GitHub runner — first PR is the live test (fetch-depth and merge-base reasoning verified locally only). A configured exclude prefix that matches nothing is silent by design (documented in ADR-006); combined with Linux-vs-Windows case-folding differences (ledgered, epic-end sweep) a Windows-authored prefix could no-op on CI without signal. Exclusions are all-axiom: the two excluded test files are unreviewed by every axiom in dogfood runs (accepted, documented). The <60s envelope rests on the in-step assert plus one dated local measurement (~10s); no runner-measured datapoint yet.
