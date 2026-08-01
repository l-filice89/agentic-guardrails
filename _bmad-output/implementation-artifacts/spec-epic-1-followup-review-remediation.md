---
title: 'Epic 1 Follow-up Review Remediation'
type: 'bugfix'
created: '2026-08-01'
status: 'done'
baseline_commit: 'b66aad7902b8c5d667c87e0d20117a9af93ee607'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad/custom/standing-rules-core.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Independent follow-up review of the 17 Epic 1 stories found 29 retained defects: two high, fifteen medium, and twelve low. They include false blocking findings, silent degradation, non-reproducible metadata, concurrency ambiguity, incomplete guardrails, and CI hardening gaps.

**Approach:** Fix every recorded finding at its owning seam, add a hazard test for each behavior, and update each story’s follow-up record from “still present” to an explicit fixed-and-verified disposition.

## Boundaries & Constraints

**Always:** Preserve deterministic artifact identity, zero-silent-degradation, analyzer isolation, current public APIs where practical, Windows/macOS/Linux behavior, and exact scope/config semantics. Treat malformed repositories, cache/history files, callback throws, concurrent writers, and analyzed source as untrusted input. Every fix gets a focused regression test.

**Ask First:** Any fix requiring a persisted-schema version bump, changing a documented analyzer rule/severity, adding a runtime dependency, weakening a default gate, or dropping a supported review scope.

**Never:** Hide defects by exclusions, suppressions, broader try/catch, relaxed validation, or documentation-only acceptance. Do not edit dirty fixtures to make analyzers pass. Do not alter `.vs/` further; it was explicitly deleted.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Boundary/schema evasions | Anthropic sibling package, template import, unknown degradation key, inferred confidence zero | boundary violation or schema rejection | deterministic validation error |
| Analyzer edge syntax | asset import, static template import, shadowed require, repeated duplicates, spread/getter signal, all-caps secret | precise finding/no-finding per documented rule | no false blocking or silent omission |
| Degraded runtime inputs | synchronous over-budget analyzer, cache EACCES/write failure, full-coverage degraded corpus | degradation is surfaced; unsafe result not cached/trusted | typed degradation, correct exit behavior |
| Scope/worktree faults | primitive callback throw plus cleanup failure, dirty ref at HEAD, case-varied engine path | cleanup/scope truth remains recoverable and explicit | no leaked degradation or false ref claim |
| Concurrent history | equal-revision conflicting dispositions | conflict resolved deterministically and declared | no file-order-dependent answer |
| CI execution | default token permissions and action versions | least privilege and immutable action references | workflow remains functional |

</frozen-after-approval>

## Code Map

- `scripts/check-boundaries.mjs`, `eslint.config.js`, `packages/contracts/src/{partial-result,finding}.ts` -- boundary and canonical schema fixes.
- `packages/core/src/adapter/typescript-adapter.ts`, `packages/core/src/analyzers/axiom{1,3,4,5,6}-*.ts` -- analyzer precision and corpus trust.
- `packages/core/src/cache/deterministic-cache.ts`, `packages/core/src/pipeline/{pipeline,scope}.ts` -- timeout, cache observability, run identity, and scope truth.
- `packages/core/src/git/{git,worktree}.ts`, `packages/core/src/init/{init,wiring}.ts` -- git/config/init/worktree findings.
- `packages/core/src/persistence/history.ts`, contracts record schemas -- concurrent disposition semantics.
- `.github/workflows/ci.yml`, story files, `CHANGELOG.md` -- CI hardening and audit trail.

## Tasks & Acceptance

**Execution:**
- [x] Fix contract/boundary findings and add self-guard tests.
- [x] Fix adapter/analyzer findings with focused valid-syntax and false-positive tests.
- [x] Make budgets/cache/corpus degradation truthful under synchronous and I/O failure paths.
- [x] Fix run identity, config/init wiring, scope, worktree, and history concurrency findings.
- [x] Harden CI permissions/action pinning and correct Story 1.16 revision metadata.
- [x] Update all 17 follow-up records and changelog with fixed evidence.

**Acceptance Criteria:**
- Given every retained follow-up finding, when its regression test runs, then the pre-fix behavior is impossible and the recorded expected behavior passes.
- Given the full repository gate, when lint, typecheck, boundaries, builds, package tests, and root tests run, then all pass without retry-only failures.
- Given the updated story records, when audited, then all 29 findings have a file/test reference and no `findings_still_present_at_HEAD` entry remains unresolved.

## Spec Change Log

- 2026-08-01: Implemented all 29 retained findings; static gates, builds, package suites, and full root suite pass.
- 2026-08-01: Independent blind/edge review patched 10 additional hazards: escaped-template lint bypass, ambient `require`, asset/query resolution, Git status failure classification, deterministic three-way dispositions, unreadable-input identities, config-status identity, cache-hit deadlines, exact CI action allowlisting, and ambiguous follow-up-record wording.
- 2026-08-01: Full verification after review patches: 62 contracts, 559 core, 48 CLI, and 826 root tests pass; root-suite Git timing guards now tolerate parallel process contention without changing production limits.

## Design Notes

Prefer the smallest fix at the owning invariant. When a prior record is correct but its proposed remedy would change public semantics, preserve semantics and fix observability/identity instead. For the synchronous budget, elapsed-time detection alone is insufficient if over-budget work can be cached; the result must be declared and excluded from cache even when preemption is unavailable.

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build` -- static and build gates pass.
- `pnpm --filter @agentic-guardrails/contracts test && pnpm --filter @agentic-guardrails/core test && pnpm --filter @agentic-guardrails/cli test` -- package suites pass.
- `pnpm test` -- all unit/tooling/integration tests pass in one run.
- `git diff --check` -- no whitespace errors.

## Suggested Review Order

**Deterministic pipeline truth**

- Start here: composition-only config state now participates in artifact identity.
  [`pipeline.ts:658`](../../packages/core/src/pipeline/pipeline.ts#L658)

- Seed states and cache-hit deadlines can no longer silently alias clean runs.
  [`pipeline.ts:1005`](../../packages/core/src/pipeline/pipeline.ts#L1005)

- Unreadable knowledge inputs use stable, error-specific hashes and messages.
  [`pipeline.ts:1334`](../../packages/core/src/pipeline/pipeline.ts#L1334)

**Static-analysis precision**

- Asset aliases remain external while missing queried code stays unresolved.
  [`typescript-adapter.ts:84`](../../packages/core/src/adapter/typescript-adapter.ts#L84)

- Ambient Node `require` declarations remain eligible; project shadowing stays excluded.
  [`typescript-adapter.ts:374`](../../packages/core/src/adapter/typescript-adapter.ts#L374)

- Duplicate occurrences retain deterministic identity across repeated same-file pairs.
  [`axiom3-cleanliness.ts:401`](../../packages/core/src/analyzers/axiom3-cleanliness.ts#L401)

**Contracts and fault handling**

- Canonical degradation objects reject unknown keys instead of laundering malformed data.
  [`partial-result.ts:7`](../../packages/contracts/src/partial-result.ts#L7)

- Inferred findings require positive confidence and LLM provenance.
  [`finding.ts:92`](../../packages/contracts/src/finding.ts#L92)

- Callback and cleanup failures survive together, including primitive thrown values.
  [`worktree.ts:851`](../../packages/core/src/git/worktree.ts#L851)

**History, boundaries, and delivery**

- Three-way disposition conflicts select one order-independent winner and declaration.
  [`history.ts:339`](../../packages/core/src/persistence/history.ts#L339)

- Escaped static templates are checked using cooked module names.
  [`eslint.config.js:54`](../../eslint.config.js#L54)

- CI permissions and action identities are immutable and self-tested exactly.
  [`ci.yml:13`](../../.github/workflows/ci.yml#L13)

**Audit trail and verification**

- Follow-up records explicitly distinguish preserved defect text from current findings.
  [`spec-1-3:114`](spec-1-3-typescript-languageadapter-and-import-graph.md#L114)

- Exact action allowlist prevents pinned-but-untrusted substitutions.
  [`ci-workflow.test.mjs:14`](../../scripts/ci-workflow.test.mjs#L14)
