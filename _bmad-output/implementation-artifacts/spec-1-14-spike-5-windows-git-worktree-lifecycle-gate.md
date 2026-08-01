---
title: 'Story 1.14: SPIKE-5 — Windows Git-Worktree Lifecycle (gate)'
type: 'feature'
created: '2026-07-25'
status: 'done'
baseline_revision: a4d1cde44ac51dd3c02c1555aba1f3ca20b58af0
final_revision: b0e9c66d23658ddf770fb1efeaa03e8bce54c507
review_loop_iteration: 0
followup_review_recommended: true # AUTO-FORCED: five HIGH inline findings (CI-red tests; cross-repo worktree destruction; gate scenarios that could not fail; git-failure-reads-as-success; silent leaks)
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** Worktree isolation is the load-bearing mechanism for FR-25 remote/PR review and the NFR-9/12 platform claims, and it has no implementation and no gate — on Windows, the actual dev platform, where the known footguns (long paths, held handles, case-insensitivity, mid-run kills) live.

**Approach:** Ship the minimal REAL lifecycle (`withWorktree` + orphan reclamation) in `core/git`, then gate it with a re-runnable failure-injection harness: 100 consecutive create → run → cleanup cycles plus the named injected-failure scenarios, written up with the Windows-specific handling that story 1.15 consumes.

## Boundaries & Constraints

**Always:**
- The spike measures the REAL shipped code (the 1.5 precedent): `withWorktree()` lands in `packages/core/src/git/worktree.ts` as production code that 1.15 consumes; the harness exercises that function, never a parallel throwaway implementation.
- Lifecycle contract: create a worktree at a target ref → run the caller's callback inside it → **remove in `finally`, always**, including on throw, on rejection, and on abort. Removal = `git worktree remove --force` followed by `git worktree prune`; a failed removal is retried with bounded backoff (held handles are transient in the common case) and, if still failing, recorded as a typed degradation AND registered for reclamation — never a silent leak, never a partially-removed tree left registered.
- Orphan reclamation: `reclaimWorktrees(repoRoot)` runs before creating a new one — prunes stale git registrations and removes residue directories the registry no longer knows about (this is what makes the mid-run-kill scenario recoverable, since a killed process never runs its `finally`). Reclamation is bounded to worktrees this tool created (a name prefix + the tool's base directory) — it must never touch a worktree a human created.
- Invoking-tree safety is the hard invariant: every operation targets the worktree path only; the invoking working tree must be byte-identical before and after (verified by comparing `git status --porcelain=v1 -z` plus a content hash of tracked files, not by eyeballing).
- Windows handling required and documented: `node:path` throughout (no string concatenation), long-path tolerance (base path kept short; `\\?\` prefixing where Node needs it), case-collision-safe unique naming (a `foo`/`FOO` ref pair must not collide on a case-insensitive filesystem), and no assumption that removal succeeds first try.
- Base-directory degrade path: preferred base is the OS temp dir (short paths, outside the repo, never committed); if it is unusable (permission, missing, or the >260-char case), degrade to a declared alternative and record WHY — a degrade is declared, never silent. Map this to the addendum's "push-failure → temp-dir degrade" scenario and state the mapping explicitly in the write-up (the push half is Epic 5's remote flow; the degrade mechanism is what this spike proves).
- Gate (quantified, matching the architecture's exit criteria): **100 consecutive create → run → cleanup cycles** with zero leaked worktrees (`git worktree list` returns only the invoking tree), zero orphaned lock files, and a byte-identical invoking tree; **plus** every injected-failure scenario ending with zero residue and an intact invoking tree: process kill mid-run, a file handle held open by another process during removal, paths >260 chars, case-collision names, base-directory degrade. Any scenario failing = **GATE FAIL**, recorded as such with the consequence for 1.15 (worktree-isolated scopes need redesign before branch/PR scopes ship).
- Harness: `scripts/spike-5-worktree-lifecycle.mjs`, re-runnable by one documented command, self-cleaning (its fixture repos go to OS temp and are removed), printing a machine-readable summary plus a human verdict line. It must FAIL loudly (non-zero exit) when the gate fails — a spike harness that always passes proves nothing.
- Write-up `docs/spikes/SPIKE-5-windows-worktree-lifecycle.md` mirroring SPIKE-3's shape: hardware/OS/Node context, methodology (incl. how each failure is injected and what "zero residue" is measured as), results table per scenario, the explicit gate verdict, and a **"Windows-specific handling required" section addressed to 1.15** listing what `core/persistence` and the git wrapper must do.
- Honesty rules from the 1.5 pass apply: state what was NOT measured; never claim a scenario passed that was skipped; if a scenario cannot be injected reliably on this platform, say so and mark it explicitly (skipped ≠ passed) — a skipped scenario blocks the gate unless the write-up justifies why it is not reachable.

**Block If:**
- A scenario can only be made to pass by leaving residue behind and calling it acceptable — that is an NFR-9 exception and needs a human ruling, not an implementation choice.

**Never:** No branch/PR scope wiring (that is 1.15 — this story ships the lifecycle primitive and its gate). No network operations (no fetch/push against real remotes; local refs only). No new dependencies. No worktrees inside the repo's own working tree. No touching worktrees the tool did not create.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | valid ref, callback returns | callback ran inside the worktree; worktree removed; registry clean | No error expected |
| Callback throws | callback raises | error propagates to caller; worktree still removed (finally) | rethrow after cleanup |
| 100 cycles | repeated create/run/cleanup | zero leaks, zero orphaned locks, invoking tree byte-identical | No error expected |
| Process kill mid-run | child SIGKILLed holding a worktree | residue exists after kill; next `reclaimWorktrees` removes it; invoking tree intact | never a crash |
| Held handle | another process holds a file open during removal | retry/backoff; success once released, else typed degradation + registered for reclaim | never a silent leak |
| Long path | worktree path >260 chars | either succeeds via long-path handling or degrades with a declared reason | never a partial tree |
| Case collision | refs `foo` and `FOO` on a case-insensitive fs | distinct worktree paths, both lifecycles clean | never cross-contaminate |
| Base dir unusable | temp base not writable | declared degrade to the alternative base, reason recorded | never silent |
| Invalid ref | ref does not exist | typed failure, no worktree created, nothing to clean | no residue |
| Foreign worktree present | a human-created worktree exists | reclamation leaves it untouched | never destructive |

</intent-contract>

## Code Map

- `packages/core/src/git/git.ts` -- typed git wrapper (`GitResult`, `repoRoot`, `headSha`, porcelain parsing) — worktree commands join it here
- `packages/core/src/persistence/artifact-writer.ts` -- `writeFileAtomic` + the Windows fs lessons already learned (tmp cleanup on rename failure)
- `scripts/spike-3-benchmark.mjs` + `scripts/spike-3-generate-repo.mjs` -- harness shape to mirror (re-runnable, seeded, self-cleaning, machine-readable summary, honest caveats)
- `docs/spikes/SPIKE-3-import-graph-cost.md` -- write-up format and honesty bar
- `_bmad-output/planning-artifacts/architecture.md` (SPIKE-5 section) -- the exit criteria this gate must meet verbatim

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/git/worktree.ts` -- `withWorktree()` (create → run → always remove, retry/backoff, typed degradations) + `reclaimWorktrees()` (bounded to tool-created worktrees) + git-wrapper additions (`worktreeAdd`/`worktreeRemove`/`worktreeList`/`worktreePrune`) -- the lifecycle primitive 1.15 consumes
- [x] `packages/core/src/git/worktree.test.ts` -- unit coverage of the I/O matrix rows reachable in-process (happy path, callback throws, invalid ref, foreign-worktree safety, case collision, base-dir degrade, removal retry) -- coverage
- [x] `scripts/spike-5-worktree-lifecycle.mjs` -- 100-cycle loop + injected-failure suite (kill, held handle, long path, case collision, base degrade); per-scenario residue and invoking-tree verification; machine-readable summary; non-zero exit on gate fail -- the gate harness
- [x] `docs/spikes/SPIKE-5-windows-worktree-lifecycle.md` -- context, methodology per scenario, results table, explicit verdict, and the "Windows-specific handling required" section addressed to 1.15 -- the deliverable 1.15 consumes
- [x] `CHANGELOG.md` + `tests/e2e-coverage.md` -- 1.14 rows (spike + lifecycle primitive; no UI flow) -- DoD

**Acceptance Criteria:**
- Given 100 consecutive create → run → cleanup cycles on this Windows machine, when the harness completes, then zero leaked worktrees, zero orphaned locks, and a byte-identical invoking working tree — measured, with the numbers in the write-up.
- Given each injected-failure scenario (process kill mid-run, held file handle during removal, paths >260 chars, case-collision names, base-directory degrade), when it runs, then it ends with zero residue and an intact invoking tree — or, if a scenario is unreachable on this platform, the write-up says so explicitly and the verdict accounts for it (skipped is never reported as passed).
- Given the spike completes, when written up, then the Windows-specific handling required by `core/persistence` and the git wrapper is documented in a section addressed to story 1.15, and the gate verdict (PASS/FAIL) is stated unambiguously with its consequence.
- Given the harness is re-run from a clean checkout, when it executes, then it reproduces the verdict without manual setup and exits non-zero on failure.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test`, when run, then all green.

## Spec Change Log

## Review Triage Log

### 2026-07-26 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 33: (high 5, medium 12, low 16)
- defer: 1: (high 0, medium 1, low 0)
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` The story's only automated coverage was RED on CI: the case-collision test created branch `foo` then resolved ref `FOO`, which cannot resolve on a case-sensitive filesystem, and CI runs ubuntu-latest only (verified directly, not taken on trust). Whole suite rewritten platform-neutral — it now tries both refs and asserts the real property (two simultaneous worktrees at distinct paths, both cleaned) on either filesystem; every other test audited for the same assumption.
  - `[high]` `[patch]` Reclamation could destroy ANOTHER REPOSITORY's live worktree: the base directory was shared across every process and repo on the machine and ownership was decided purely by name prefix, so a second review against a different repo saw the first's live worktree as residue, called removeWorktree with the wrong repoRoot (git failure swallowed), and the rmSync fallback deleted it. Base is now namespaced per repository by canonical-path hash; unregistered residue is only deleted after its `.git` gitdir pointer is verified to resolve inside this repo (foreign or unreadable → declared `unowned`, never deleted); the invoking tree is skipped by identity.
  - `[high]` `[patch]` Two gate scenarios could not fail for the reasons they claimed, plus three measurement holes: the case-collision scenario passed on a random directory suffix (deleting the ref hashing entirely still passed) — now asserts the ref-derived component for both refs and reproduces it across a third same-ref scope; the held-handle scenario had no injection guard and was indistinguishable from a run where nothing blocked — removeWorktree now reports attempt count and the scenario FAILS as not-injected below two attempts; `skipped: 0` was tautological (no scenario could ever skip) — a real skip path exists and a skip is now a GATE FAIL; the residue scan reported "clean" on any I/O error — it now throws; and the harness exited 0 even when its own cleanup leaked — now blocks PASS. A sub-100-cycle run reports SMOKE-PASS, never PASS, and the raw run output is committed so the verdict is verifiable from artifacts instead of hand-transcribed.
  - `[high]` `[patch]` A git failure was indistinguishable from a successful removal — isRegistered returned false whenever `worktree list` failed for ANY reason and existsSync returns false on permission errors, so removeWorktree reported "fully removed" while both halves remained. This was the exact soundness hole the write-up presents as its headline Windows finding. Registration is now a three-state result (registered/absent/unknown) that keeps retrying on unknown, and presence uses lstat with non-ENOENT treated as present.
  - `[high]` `[patch]` Two silent-leak paths contradicting the module's own "never a silent leak" contract: the degradation from cleanup after a failed `worktree add` was discarded, and on the callback-throws path the removal-failed degradation was pushed into an array the caller could never receive. Degradations are now collected and attached to the propagating error; the failure result carries the worktree path so a caller can report where residue is; tests cover removal-fails-while-callback-throws.
  - `[medium]` `[patch]` A git worktree LOCK — the one mechanism a user has to say "do not remove this" — was parsed, unit-tested, and then silently overridden: `--force` refuses a locked tree, the failure was swallowed, and the rmSync fallback deleted it anyway. Locks are now honoured and declared during reclamation; only the lifecycle's own worktree may be force-removed.
  - `[medium]` `[patch]` A ref beginning with `-` was consumed by git as an option — argument injection on a tool designed to review PR refs. Refs are rejected or passed after `--`.
  - `[medium]` `[patch]` WorktreeDegradation forked the project's canonical Degradation contract by adding `kind`, so the write-up's own instruction to 1.15 ("surface them in the run manifest like any other declared degradation") could not be followed without dropping data at the schema boundary — explicit adapters with a round-trip test against degradationSchema.
  - `[medium]` `[patch]` Git subprocesses had no timeout and no maxBuffer, so a credential prompt on a remote-resolving ref (exactly 1.15's PR flow) would block forever — timeout, maxBuffer, and prompt-disabling env added; timeout path tested deterministically.
  - `[medium]` `[patch]` `gitCommand` ("run any git subcommand in any cwd", unguarded) had become public package API via the barrel — removed from the public surface, as the AST helpers were in 1.12.
  - `[medium]` `[patch]` After a base degrade, residue in the previously-used base was orphaned forever (reclaim scanned only the resolved base) — both bases swept, degrade-then-reclaim tested.
  - `[medium]` `[patch]` The live-worktree guard registered only AFTER `worktree add` succeeded, so a concurrent in-process sweep inside that window deleted the just-created worktree; and no test ran genuinely parallel lifecycles. Registration moved before the add; Promise.all concurrency test added.
  - `[medium]` `[patch]` Repo-wide `git worktree prune` fired on every removal attempt and every reclaim, able to drop registrations belonging to other scopes — now fired only when a registration lingers without its directory.
  - `[medium]` `[patch]` MAX_BASE_PATH_LENGTH was presented as measurement-derived but had never been measured — the harness now binary-searches the real cliff (largest working 213, smallest failing 216, `fatal: '$GIT_DIR' too big`) and the constant is restated honestly; the missing combined scenario (long base AND deep checkout together) was added.
  - `[medium]` `[patch]` `resolveWorktreeBase` created directories (including in the user's home) as a side effect of a query and ran twice per lifecycle — split into a pure resolver and an explicit preparer, resolved once.
  - `[medium]` `[patch]` Write-up honesty: the "byte-identical invoking tree" fingerprint covered the working tree only — blind to refs, .git/config, admin directories and mtime churn (which matters because 1.7 shipped a content-addressed cache), while scenario 7 mutates branches in the invoking repo. Fingerprint widened and its remaining blind spots stated; the orphaned-lock check is now declared unfalsifiable rather than presented as evidence.
  - `[medium]` `[patch]` Probe files were written into every candidate base twice per lifecycle without the tool prefix, so a kill mid-probe left residue reclamation never removed and the scan never reported — renamed and swept.
  - `[low]` `[patch]` UNC extended-path form was invalid (`\\?\UNC\...` required); the harness applied the prefix unconditionally where the library used a 240-char threshold; 240 itself was undocumented — all three fixed.
  - `[low]` `[patch]` `isInside` broke for a drive-root base and for trailing separators — now path.relative-based.
  - `[low]` `[patch]` The residue scan skipped junctions/symlinks and non-directory prefixed leftovers in a world-writable temp base — lstat-based and type-blind now.
  - `[low]` `[patch]` `attempts <= 0` meant removal was never attempted yet reported failed; a huge value meant unbounded backoff — clamped.
  - `[low]` `[patch]` Case-differing duplicate targets burned a retry budget on the same worktree — canonical-path dedupe.
  - `[low]` `[patch]` Dead `skipReclaim` option deleted; docstring and write-up reconciled on the naming scheme (the omitted random component was the one actually providing distinctness).
  - `[low]` `[patch]` Harness measurement hygiene: fingerprint no longer hashes unreadable files symmetrically (a run leaving files locked used to fingerprint as unchanged), the kill scenario now compares both residue halves it records, markers are written tmp+rename against torn reads, and a child failing before writing its marker reports instead of burning the full 60 s timeout.
  - `[low]` `[patch]` Untested branches given unit coverage so Linux CI guards them: both-bases-unusable, reclaim-failed degradation, removal-returning-degradation, failed-add cleanup.
  - `[low]` `[patch]` The per-cycle median is labelled descriptive (no threshold, small fixture) rather than implying a gate criterion; the spawnSync-behind-async event-loop stall and the SIGINT-leaves-residue behaviour are documented as ceilings for 1.15.
  - `[medium]` `[defer]` The gate is Windows-only and manual while CI is ubuntu-only, so no automated run guards the scenarios carrying the real risk — ledgered for 1.18 (dogfood CI) to decide: Windows runner, scheduled re-run, or accepted one-time-evidence posture.

Gate re-earned after patching (the pre-patch PASS was not trustworthy given the integrity holes): full 100-cycle re-run, all scenarios passing, zero skipped, plus five negative controls each proven to make the harness fail (prefix bound, no-op removal, stray-file residue, hidden retry count, deleted ref hashing).

### 2026-08-01 — Independent follow-up review pass (stamp consumed)
- reviewed_range: a4d1cde4..b0e9c66d, verified against HEAD
- forced_areas: repository namespacing, three-state registration checks, lock honoring, failed-add cleanup, and cross-process live markers remain present.
- findings_fixed_and_verified_at_HEAD:
  - audit_note: The bullets below preserve each original defect statement for audit continuity; they are fixed, not current findings. The adjacent remediation evidence names the HEAD verification surface.
  - remediation_evidence: `packages/core/src/git/worktree.test.ts`; focused regression suite passed 2026-08-01.
  - [medium] packages/core/src/git/worktree.ts:896-904 — cleanup degradations are attached only when the callback throws an object. JavaScript permits `throw "failed"`, `throw 42`, and `throw null`; on those paths a failed removal/leaked worktree is pushed into `degradations` and then lost when the primitive is rethrown. This is the residual form of the prior HIGH “callback throws + cleanup fails silently” defect. Wrap primitive throws in an `Error` with `cause`, or provide a result/error channel that can always carry cleanup degradations.
  - [low] packages/core/src/git/worktree.ts:400-403 — the 160-character base-path rejection is applied on Linux/macOS too, although its reason and measured failure are Windows-specific. A valid long POSIX temp root unnecessarily degrades to the user's home directory (or fails if that fallback is also long). Gate the conservative limit on `win32`; retain the actual create/write probe everywhere.

## Design Notes

- Shipping the real primitive rather than a throwaway is the 1.5 lesson applied: SPIKE-3 measured `runReview` itself, so its numbers meant something for the shipped tool. A spike that proves a parallel implementation proves nothing about what 1.15 will actually run.
- Mid-run kill cannot be survived by `finally` (there is no `finally` after SIGKILL) — which is exactly why reclamation-before-create exists. The scenario therefore asserts recovery, not prevention, and the write-up must say so plainly rather than implying the kill left no residue.
- Cross-platform ARTIFACT parity (case-folding making findings platform-dependent, ledgered during 1.13) is deliberately NOT this story's scope: it is about analyzer output, not worktree lifecycle. Owner recorded as story 1.18 (dogfood CI), where a second platform actually runs.

## Verification

**Commands:**
- `node scripts/spike-5-worktree-lifecycle.mjs` -- expected: prints per-scenario results and an explicit verdict; exit 0 only on gate pass
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test` -- expected: all green


## Auto Run Result

- **Summary:** SPIKE-5 gate **PASS**, re-earned after review. Ships the real lifecycle 1.15 consumes — `withWorktree` (create at ref → run → always remove, retry/backoff, typed degradations), `reclaimWorktrees` (bounded per-repository, `.git`-pointer verified, lock-honouring), `resolveWorktreeBase`/`prepareWorktreeBase` (declared degrade) and typed git worktree commands — gated by a failure-injection harness. Measured on Windows 11 / i7-12700H / node 24.6 / git 2.39.1: 100 consecutive cycles with zero leaks, zero orphaned locks and an unchanged invoking tree (median 458 ms/cycle, descriptive not a threshold); every injected-failure scenario passing with **zero skipped** — process kill (recovery via reclamation, both residue halves asserted), held handle released during backoff (3 attempts, fails if not injected), held handle throughout (typed degradation then reclaimed), deep checkout (334 chars), long base + deep checkout combined, base cliff measured by binary search (largest working 213, smallest failing 216), base >260 (declared degrade), case-collision refs (ref-hash component asserted), unusable base, and foreign worktrees (three survived, a foreign repo's declared `unowned`). Five negative controls prove the harness bites.
- **Files changed:** `packages/core/src/git/worktree.ts` (new) + `worktree.test.ts` (new), `git.ts` (worktree commands, timeout/maxBuffer/prompt-disabling, internal gitCommand seam), `packages/core/src/index.ts` (explicit re-export list); `scripts/spike-5-worktree-lifecycle.mjs` (new harness); `docs/spikes/SPIKE-5-windows-worktree-lifecycle.md` (new write-up incl. the 11-item "Windows-specific handling required" section addressed to 1.15) + `docs/spikes/SPIKE-5-run-output.txt` (raw run evidence); `CHANGELOG.md`, `tests/e2e-coverage.md`.
- **Review findings breakdown:** 33 patched (5 high, 12 medium, 16 low), 1 deferred (Windows-only manual gate vs ubuntu-only CI → 1.18), 0 rejected, 0 intent_gap, 0 bad_spec.
- **Follow-up review recommendation:** true — auto-forced by five HIGH inline findings (FOLLOW-UP-REVIEW AUTO-FORCE ON HIGH).
- **Verification:** `node scripts/spike-5-worktree-lifecycle.mjs` (exit 0, verdict PASS, raw output committed); `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:boundaries`, `pnpm -r build`, `pnpm -r test` (52 contracts + 400 core + 8 cli), `pnpm test` (34 files / 556 tests) — all green after patches.
- **Residual risks:** The gate is Windows-only and manual while CI is ubuntu-only (ledgered for 1.18). Cross-process concurrency beyond the per-repo base namespacing is an explicit ceiling — the live-worktree guard is in-process only. All git I/O is spawnSync behind an async façade, so a removal plus backoff stalls the event loop (documented for 1.15). SIGINT runs no finally; residue is recovered by the next run's reclamation, and installing a signal handler is left to the CLI boundary rather than a library.
