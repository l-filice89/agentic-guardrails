# Epic 1 Operator-Perspective Sweep

Date: 2026-08-01  
Scope: Epic 1 — Zero-Cost Deterministic Review (M0 + M1)  
Status: pending live GitHub PR/protection evidence

## Deferred-work triage

- The main `deferred-work.md` ledger contains 11 Epic 1 entries. Every entry now has a terminal disposition: resolved, ruled/discarded with evidence, listed for future work with a reopen trigger, or reassigned to an explicit receiving-story acceptance criterion.
- Reassigned work is gated in the planning artifact: knowledge provenance in Story 4.1, corpus trust/provenance in Story 4.2, symbol identity/display separation in Story 4.5, and Windows lifecycle automation/posture in Story 5.4.
- The separate `epic-1-deferred-items.md` ledger has two entries. D2 is executed with the chosen TypeScript configuration recorded. D1 remains open only until this closeout enables and re-reads GitHub branch protection; the epic cannot be marked done before that evidence lands.

## Temporal behavior — “month three” audit

Epic 1 ships no cron, timer-triggered job, polling loop, quarantine window, rate-limit window, or autonomous retry queue. `.github/workflows/ci.yml` has two event triggers only: every pull request and pushes to `main`. The product runtime runs only when a human or CI invokes a CLI command.

Invocation-triggered recurring paths:

| Path | Recurrence and bound | Unattended failure/recovery | Month-three result |
|---|---|---|---|
| Review artifacts | One artifact per run; target retention is the newest 100 per scope directory | Pruning is best-effort; a held/unreadable old file does not invalidate the completed run. The next successful write retries pruning. | Healthy active scopes converge to 100 artifacts each; a prune failure can temporarily exceed the target. Distinct historical scope directories are not globally pruned; this is accepted generated, gitignored state and can be deleted safely. Global lifecycle policy belongs with Epic 4 institutional-memory work. |
| Deterministic cache | Write-through per graph/findings key; target retention is the newest 100 entries per cache kind | Invalid/MAC-failed entries become declared misses and are overwritten; write failure disables caching with a declaration. Pruning is retried on the next write. | Two shipped kinds normally converge to 200 JSON entries total; failed pruning can exceed the target until a later successful write. Orphaned temp files older than one hour are swept on the next cache write. |
| Worktree reclamation | Runs before each branch/PR worktree creation and after the owned callback | Normal cleanup makes up to four attempts with 150 + 300 + 600 ms = 1,050 ms programmed backoff. SIGKILL residue is discovered on the next scoped invocation; locked/unowned/failed targets are declared, never silently removed. | Repeated ordinary runs leave zero residue. A killed final run can leave one owned residue until the next invocation; no daemon is required. |
| Per-run artifact retention | Prune occurs after every successful artifact write | If pruning alone fails, the new artifact stays valid and later writes retry the bounded-store operation | No scheduled maintenance dependency. |
| Trend/disposition history | Append-only only when a review/disposition records data | Atomic union/idempotency and deterministic conflict selection; malformed inputs fail closed | Linear committed product history is intentional institutional memory, not generated leakage. Epic 4 owns longer-term ledger health/reporting. |
| GitHub dogfood | One run per PR event; none on a timer | Workflow/check failure blocks merge once branch protection is enabled; artifact upload uses `always()` and explicit seven-day retention | No dormant recurring job. Every changed PR re-earns the gate. GitHub stores at most the artifacts produced by this workflow during the rolling seven-day retention window; event rate and artifact bytes are external inputs, so no fixed byte ceiling is claimed. |

No zero-headroom scheduled path exists because Epic 1 ships no scheduled path.

## Combined resource budgets

### Product review invocation

- Phase 1 CPU/analyzer wall clock: one shared `PHASE1_BUDGET_MS = 30,000 ms` across all five enabled deterministic analyzers. The scheduler admits up to four analyzer promises, but current analyzers are synchronous CPU-bound and therefore execute effectively serially. The abort signal is checked between work units; an in-flight synchronous unit cannot be preempted, so 30 seconds is a cooperative target with typed post-return overrun detection, not a hard process ceiling.
- Optional PR metadata: at most one `gh pr view` subprocess, hard timeout 10 seconds, degrading and non-gating.
- Local Git commands: each spawn has a 120-second defensive timeout and no interactive prompt. Worktree removal makes at most four attempts and 1,050 ms programmed backoff. One pathological removal attempt can perform up to five Git operations (registry read, remove, post-read, conditional prune, re-read): 4 × 5 × 120 seconds + 1.05 seconds = 2,401.05 seconds per residue target at defensive ceilings. Reclamation target count is repository-state-dependent, so Epic 1 has no finite whole-invocation worst-case deadline. This is declared honestly; ordinary-path performance is governed empirically by SPIKE-3 and the CI `<60 s` dogfood gate.
- Network calls made directly by the engine: 0. LLM calls: 0. HTTP route/database/binding consumers: 0.
- Persistent generated-state targets: cache 100 graph + 100 findings JSON entries after healthy pruning; review artifacts `artifactRetention` (default 100) per scope directory after healthy pruning. Failed best-effort pruning can temporarily exceed either target and is retried by later writes.

### GitHub CI job

- Job ceiling: one `ci` job × 15 minutes = 15 job-minutes per event.
- Dogfood consumers inside the job: one base-ref fetch + one deterministic CLI review + one artifact upload retained for seven days. The review itself has a strict `<60 s` empirical assertion around the CLI invocation. It does not fan out into LLM/provider requests.
- Remaining consumers are one install, lint, typecheck, boundary check, recursive build, recursive package-test pass, and tooling/integration test pass. They share the job's 15-minute ceiling rather than each receiving a separate reservation.
- Concurrency: one job per workflow/ref; a newer event cancels the previous in-progress job. Therefore one active 15-minute budget exists per ref, with no same-ref backlog growth.

Result: no scheduled-job arithmetic or request fan-out exists. The product invocation has no hard combined worst-case wall-clock ceiling because synchronous units are cooperatively cancellable and Git recovery scales with residue count; no stronger bound is claimed. The live GitHub run remains the empirical gate for the 15-minute job and `<60 s` dogfood assertions.

## Merge-gate conclusion

Local verification after independent review patches: lint, typecheck, boundaries, and recursive builds passed; package suites passed 62 contracts + 561 core + 48 CLI tests; the root suite passed 829 tests; `git diff --check` passed. Verification ran against the closeout tree derived from baseline `5d30eaa`; the publication commit records the exact final identity. Merge remains blocked until:

1. the closeout branch is published in a PR;
2. the live `CI / ci` check, including dogfood, passes;
3. the dogfood artifact is present or the workflow explicitly reports why no artifact was produced; and
4. `main` branch protection is enabled and re-read with `CI / ci` required.
