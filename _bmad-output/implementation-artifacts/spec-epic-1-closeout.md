---
title: 'Epic 1 Closeout'
type: 'chore'
created: '2026-08-01'
status: 'in-review'
baseline_commit: '5d30eaab341c2af1f9938b8b4ace2b7384eeec64'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad/custom/standing-rules-epic-process.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 1's nineteen story specs are done, but the tracking file still reports three unfinished stories and an in-progress epic. Two deferred items remain open, the mandated operator-perspective sweep is not recorded, branch protection is disabled, and the dogfood workflow has not run on a real GitHub PR.

**Approach:** Finish the existing epic-end runtime and ledger changes, close every Epic 1 deferred item with evidence, record the operator sweep, run the full local gate, then publish a PR to exercise CI, enable branch protection, synchronize sprint status, and write the retrospective.

## Boundaries & Constraints

**Always:** Preserve the user's existing working-tree changes. Keep every deferred item in a terminal state with evidence. Record temporal-path and combined resource-budget arithmetic even where the result is zero/N/A. Require the repository's `CI / ci` check on `main` without weakening the existing workflow. Keep Epic 1 open until local verification and the live PR check pass.

**Ask First:** Any failed live check whose resolution changes analyzer rules, enforcement severity, persisted schemas, supported scopes, or the approved Epic 1 product guarantees.

**Never:** Delete or overwrite unrelated work; hide a dogfood failure with new exclusions or relaxed gates; mark the epic or retrospective done before their gates complete; force-push or merge the PR.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Local closeout | Existing dirty sweep | Changes preserved, completed, and all gates green | Stop on product-semantic failures |
| Deferred items | D1/D2 open | Both gain evidence-backed terminal dispositions | No undocumented deletion |
| GitHub publication | No PR; unprotected `main` | Branch pushed, PR created, `CI / ci` passes, protection requires it | Surface permission/check failures |
| Tracking | Stories 1.17–1.19 actually done | Stories, epic, and retrospective become `done` in sequence | Do not advance early |

</frozen-after-approval>

## Code Map

- `packages/core/src/pipeline/manifest.ts` and `pipeline.ts` -- existing per-axiom ruleset-version sweep.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- main Epic 1 deferred-work ledger.
- `_bmad-output/implementation-artifacts/epic-1-deferred-items.md` -- D1/D2 terminal dispositions.
- `_bmad-output/implementation-artifacts/epic-1-operator-sweep.md` -- operator-perspective evidence.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- authoritative epic/story/retro tracking.
- `.github/workflows/ci.yml` -- live dogfood workflow and required `CI / ci` check.

## Tasks & Acceptance

**Execution:**
- [x] Complete and test the existing `RULESET_VERSIONS` implementation and downstream ledger/epic acceptance-criteria edits.
- [ ] Close D1/D2 and create the operator sweep covering deferred work, temporal behavior, recovery, and total resource budgets.
- [x] Run lint, typecheck, boundaries, builds, package tests, root tests, and whitespace validation.
- [ ] Commit and push the closeout, create a PR, wait for `CI / ci`, inspect dogfood evidence, and enable matching `main` branch protection.
- [ ] Mark Stories 1.17–1.19 and Epic 1 done, produce the Epic 1 retrospective, then mark its status done.

**Acceptance Criteria:**
- Given all Epic 1 ledgers, when audited, then every entry has an evidence-backed terminal disposition or a receiving story AC.
- Given the running system, when reviewed from the operator perspective, then recurring/scheduled behavior, unattended failure recovery, and combined resource budgets are explicitly accounted for.
- Given local and GitHub verification, when the closeout is published, then all checks pass and `main` requires `CI / ci` before merge.
- Given completed closeout evidence, when sprint status is read, then 1.17–1.19, Epic 1, and its retrospective are `done` with no false completion ordering.

## Spec Change Log

- 2026-08-01: Independent Blind/Edge review patched prototype-key lookup, custom-analyzer cache namespace collisions, historical per-axiom version provenance, incomplete ledger terminal wording, optimistic operator arithmetic, explicit GitHub artifact retention, and a parallel-load test timeout. Preserved deterministic shipped-analyzer caching and existing product semantics.

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build` -- static/build gates pass.
- `pnpm -r test && pnpm test && git diff --check` -- package/root suites and whitespace pass.
- `gh pr checks <PR> --watch` -- live `CI / ci`, including dogfood, passes.
- `gh api repos/l-filice89/agentic-guardrails/branches/main/protection` -- required status-check protection is enabled.

**Local results (2026-08-01):** lint, typecheck, boundaries, recursive builds, and whitespace passed; package suites passed 62 contracts + 561 core + 48 CLI tests; root suite passed 829 tests.
