# SPIKE-5 — Windows Git-Worktree Lifecycle (Story 1.14)

Gates the worktree-isolation lifecycle — the load-bearing mechanism for FR-25
(remote/PR review) and the NFR-9/12 platform claims — on Windows, the actual
dev platform, where the footguns live.

**Verdict: GATE PASS.** 100 consecutive create → run → cleanup cycles with
zero leaked worktrees, zero orphaned lock files and an unchanged invoking
repository, plus ten injected-failure and measurement scenarios all ending
clean. No scenario was skipped. Story 1.15 can build branch/PR scopes on
`withWorktree()` as shipped, provided it honours the handling listed at the
bottom.

Every number on this page is transcribed from one run, whose **raw output is
committed beside it** at [`SPIKE-5-run-output.txt`](./SPIKE-5-run-output.txt)
(including the machine-readable `SPIKE5_JSON` line). Nothing here is
hand-measured.

## Hardware context

| | |
|---|---|
| CPU | 12th Gen Intel(R) Core(TM) i7-12700H, 20 logical cores |
| RAM | 15.6 GB |
| OS | Windows 11 (win32 10.0.26200) |
| Node | v24.6.0 |
| Git | 2.39.1.windows.1 |
| Filesystem | NTFS, case-INsensitive (Windows default), `LongPathsEnabled` not required by this design |
| Date | 2026-07-25 (run timestamp in the raw output) |

## What was measured

The spike exercises the **real shipped primitive**, not a throwaway: the
harness imports `withWorktree()` / `reclaimWorktrees()` from
`packages/core/dist` (source: `packages/core/src/git/worktree.ts`) — the same
functions story 1.15 will call. A failure in the spike is a failure in the
product.

- Harness: `scripts/spike-5-worktree-lifecycle.mjs`.
- Re-run with: `pnpm -r build && node scripts/spike-5-worktree-lifecycle.mjs`
  (the build is required — the harness loads `core/dist`). `SPIKE5_CYCLES`
  exists for probing only: a run below 100 cycles is labelled `SMOKE` and
  **cannot** emit verdict `PASS`.
- All fixtures are git repos the harness creates under the OS temp dir and
  deletes at the end. A temp cleanup that leaks **fails the run** — a failure
  mode that prevents cleanup must not be able to report PASS. Nothing is ever
  created inside the repo under review; its `git status` is compared
  before/after the whole run as a backstop.
- Output: a per-scenario table, one machine-readable `SPIKE5_JSON` line, and
  an explicit verdict. Exit code is non-zero unless the verdict is `PASS`.

**"Zero residue" is measured, per scenario, as all three of:**

1. `git worktree list --porcelain` names only the invoking tree;
2. no `agtwt-`-prefixed **or** `.agtwt-probe-`-prefixed entry of **any type**
   (directory, file, junction) anywhere beneath any base root used — the scan
   is recursive because the base is repo-namespaced, and any I/O error while
   scanning **fails the scenario** rather than reading as "clean";
3. no `*.lock` file and no `locked` marker anywhere under the repo's `.git`.

**Honesty note on (3):** nothing in the lifecycle ever takes a git lock, so
this check *cannot fail by construction*. It is a regression tripwire for a
future change, not evidence about this one, and is not counted as a proof.

**"Intact invoking tree"** is measured, never eyeballed, as an identical
sha256 over: `git status --porcelain=v1 -z --untracked-files=all`, `HEAD`, the
tracked-file **contents** in `git ls-files -z` order, **every ref**
(`for-each-ref`, so a scenario that creates a branch and fails to delete it is
caught), `.git/config`, and the directory names under `.git/worktrees`.
**Scope it does NOT cover, stated rather than implied:** file mtimes (which
matter because 1.7 shipped a content-addressed cache), reflogs, object-store
growth, and index metadata. Those are unmeasured, not proven unchanged.

## The lifecycle under test

`withWorktree({ repoRoot, ref, baseDir? }, callback)`:

1. reject a ref git would parse as an option (`-…`) or an empty ref;
2. resolve **and prepare** the base directory ONCE per lifecycle
   (`prepareWorktreeBase`), degrading to a declared alternative if unusable;
3. `reclaimWorktrees` — sweep residue from runs that never reached their
   cleanup, in **both** the resolved and the previously-preferred base;
4. register the intended path as LIVE, **then**
   `git -c core.longpaths=true worktree add --detach -- <base>/agtwt-<hash> <ref>`;
5. run the callback with the worktree path;
6. **always**: `git worktree remove --force --force` → filesystem fallback →
   verify BOTH the registry and the directory are gone, retrying with
   exponential backoff; if it still fails, a typed `removal-failed`
   degradation is returned (or **attached to the propagating callback error**,
   so a leak is never invisible on the throwing path) and the residue is left
   where reclamation will find it.

`reclaimWorktrees({ repoRoot, baseDir })` is bounded by an explicit ownership
discipline. A target is reclaimable only when it is **all** of:

| # | Bound | Why |
|---|---|---|
| a | name starts with `agtwt-` | a human worktree is never touched |
| b | inside **this repository's** namespaced base `<root>/<sha256(canonical repoRoot)[:12]>/` | the OS temp root is shared by every process AND every repo on the machine; without the namespace, a second guardrails process reviewing a *different* repo would see the first one's LIVE worktree as residue |
| c | not registered as live by this process | a sibling scope is never swept; the path is registered **before** `worktree add`, closing the creation window |
| d | not the invoking worktree | never delete the run out from under itself |
| e | not `git worktree lock`-ed | an explicit human "do not remove this" is honoured and **declared** (`locked`), and only the lifecycle's OWN worktree is ever forced through a lock |
| f | either has no `.git`, or its `.git` `gitdir:` pointer resolves inside **this** repo's common git dir | another repository's worktree that happens to carry our prefix is declared `unowned`, never deleted |

Anything failing (e) or (f) is reported as a typed degradation. Nothing is
ever skipped silently.

## Methodology per scenario, and results

All figures from the committed run (`SPIKE5_JSON`, exit 0). Times are
wall-clock for the whole scenario including its fixture work.

| # | Scenario | How the failure is injected | Result | Time |
|---|---|---|---|---|
| 1 | **100 cycles** | 100 sequential `withWorktree` calls on a 3-file git repo; the callback reads a checked-out file (asserting its committed content) and writes one inside the scope. Full residue check after **every** cycle; fingerprint before/after the loop. | **PASS** — 0 leaks, 0 locks, 0 degradations, fingerprint identical. Per-cycle **median 458 ms** (min 399, max 585). | 53.7 s |
| 2 | **Process kill mid-run** | A real child process runs `withWorktree` and blocks inside the callback; the parent `SIGKILL`s it (`TerminateProcess`), so no cleanup ever runs. | **PASS** — the kill left **exactly 1 registration + 1 directory**, both asserted (the scenario is proven injected, not assumed), and `reclaimWorktrees` removed exactly it. Fingerprint identical. | 2.1 s |
| 3 | **Held handle, released during backoff** | A second process is spawned with its **CWD inside the worktree** plus an open fd; it is killed 700 ms later while removal is still retrying. | **PASS** — removal took **3 attempts** (asserted `> 1`: without that guard this scenario's assertions are identical to a run where nothing ever blocked). Zero residue, no degradation. | 2.2 s |
| 4 | **Held handle, held throughout** | Same holder, kept alive across all 3 removal attempts (100 ms base backoff). | **PASS** — removal failed **loudly** after 3 attempts: a typed `removal-failed` degradation naming the residue path. Residue while held asserted present. After the holder was killed, `reclaimWorktrees` cleared it. | 2.6 s |
| 5 | **Long path — checked-out file >260 chars** | Fixture repo with a committed file whose path inside the worktree is **334 chars**, written and read through the `\\?\` prefix. | **PASS** — checked out and removed cleanly (only because `-c core.longpaths=true` is passed). | 1.0 s |
| 5b | **Long base AND deep checkout TOGETHER** | The term that actually decides whether git blows up is *base + deepest repo-relative path*. Base padded to exactly the gate limit (**160 chars**) with the same deep repo: checked-out path **424 chars**. | **PASS** — succeeded and cleaned up, zero degradations. | 1.0 s |
| 5c | **MEASUREMENT: the real base-length cliff** | Binary search over base length with raw `git worktree add` against the deep repo (deepest tracked path **237 chars**). | **PASS** — largest **working** base **213** chars, smallest **failing** base **216**, failing with `fatal: '$GIT_DIR' too big`. `MAX_BASE_PATH_LENGTH = 160` therefore sits **53 chars below the measured cliff on this machine**, headroom for a deeper repo than the fixture. | 2.8 s |
| 6 | **Long path — base directory >260 chars** | Preferred base root is a real **291-char** path (**304** once namespaced). | **PASS** — declared unusable (`base path is 304 chars (max 160); git cannot create a worktree under a long base on Windows`), the run continued under the declared alternative, the unusable base was never created, zero residue. | 1.0 s |
| 7 | **Case-collision refs (`foo` / `FOO`)** | Both refs against a case-insensitive NTFS volume with the two worktrees **coexisting** (nested lifecycles), **plus a third scope at the same ref**. | **PASS** — `foo` → ref component `2c26b46b68ff`, `FOO` → `9520437ce890` (asserted equal to `refHash(ref)`, not merely "different"), distinct coexisting directories; the third scope reproduced `foo`'s component at a *different* directory. See the git finding below. | 2.3 s |
| 8 | **Base directory unusable** | Preferred base points *under a regular file* → `ENOTDIR` on `mkdir`, plus a probe write that must actually succeed. | **PASS** — degrade declared with its reason, run completed on the alternative, zero residue. | 1.0 s |
| 9 | **Foreign worktree present** | Three foreign things at once: a human worktree **inside** the tool's base dir (`my-hotfix`), a worktree carrying the tool prefix **outside** the base dir, and **another repository's LIVE worktree** dropped inside our namespaced base carrying our prefix — with our own residue beside them. | **PASS** — all three survived untouched (contents included) and stayed registered; the foreign-repo worktree was **declared `unowned`** rather than silently skipped; only our residue was reclaimed; a full lifecycle then ran beside them. Routed through the same shared `verifyClean` as every other scenario. | 2.5 s |

`skipped: []`. The skip path is real, not a tautological zero: scenarios 3 and
4 report `skip` when `process.platform !== "win32"`, because a CWD hold does
not block deletion on POSIX and the failure genuinely cannot be injected
there. **A skip is a GATE FAIL** — this gate is a Windows gate, and a run that
could not inject its own failure modes has not gated anything.

### The harness was proven to bite — five negative controls

A gate harness that always passes proves nothing. Each control was applied to
the shipped source, `core` rebuilt, the harness re-run, then reverted.

| # | Sabotage | Expected | Observed |
|---|---|---|---|
| NC-1 | Drop the prefix half of the reclamation bound (`isToolWorktree` → containment only) | Scenario 9 destroys the human's worktree | **Scenario 9 FAIL**, exit 1 — `my-hotfix` was deleted (`fatal: … is not a working tree` on teardown) |
| NC-2 | `removeWorktree` becomes a no-op that **reports success** | The **cycles loop** catches the leak on cycle 0 | **Every scenario FAIL** — cycle 0 reported 1 registration + 1 directory, and the fingerprint caught `adminWorktrees 0 → 2` |
| NC-3 | Every successful removal leaves an `agtwt-…-stray` **FILE** beside the worktree | The **residue scan** catches it | **Cycles FAIL** on cycle 0 naming the stray file. (The previous dir-only, error-swallowing scan would have reported "clean" — this is the control for that specific hole.) |
| NC-4 | `removalAttempts` always reported as 1 | Scenario 3's injection guard fires | **Scenario 3 FAIL** — "removal succeeded on attempt 1 — the hold never blocked it (scenario NOT injected)" |
| NC-5 | Delete `sha256(ref)` from the worktree name (random suffix only) | Scenario 7's design assertion fires | **Scenario 7 FAIL** on all three halves: wrong component for `foo`, wrong for `FOO`, and the same ref producing two different components |

NC-4 and NC-5 exist because the corresponding scenarios were previously
**tautologies** — scenario 7's old assertion (`p1 !== p2` case-insensitively)
was satisfied by the random suffix alone and would have passed with the hash
deleted; scenario 3 had no injection guard at all.

## Windows findings that shaped the implementation

Each of these was measured on this machine before being encoded in
`packages/core/src/git/worktree.ts`:

1. **`core.longpaths` is mandatory for the checkout.** `git worktree add`
   without it fails with `fatal: cannot create directory at '…': Filename too
   long` as soon as a checked-out path exceeds 260 chars. It is passed
   **per-invocation** (`git -c …`) so the tool never writes to the user's repo
   config.
2. **A long base path cannot be fixed by `core.longpaths`.** Measured
   (scenario 5c): the cliff on this machine is between **213 and 216** chars
   of base, failing with `fatal: '$GIT_DIR' too big` — git's own path buffer,
   not the Win32 limit. `MAX_BASE_PATH_LENGTH = 160` is a **conservative
   constant, not the cliff**: the real threshold moves with the deepest
   tracked path in the repo being checked out, so no single constant can be
   exact. 160 leaves ~53 chars of headroom against a repo whose deepest path
   is 237 chars. **Not measured:** whether a newer git or `LongPathsEnabled`
   lifts this; the design does not depend on either.
3. **An open file descriptor does NOT block deletion on Windows** — not even
   one held by another process. libuv opens files with `FILE_SHARE_DELETE`.
   What actually blocks removal is a process whose **current directory** is
   inside the tree (`Permission denied` from git, `EPERM` from `fs.rmSync`).
   The naive `fs.openSync` injection is a no-op and would have produced a fake
   pass; the harness injects a CWD holder.
4. **A failed `git worktree remove` can still unregister the worktree.** In
   the held-directory case git deleted the administrative registration, failed
   to delete the tree, and left a directory `git worktree list` no longer
   mentions — a leak invisible to the registry. Removal therefore checks
   **both** halves, falls back to a filesystem delete, and reclamation scans
   the base directory as well as the registry.
   **The corollary that matters more:** a registry read that *fails* is
   `unknown`, never "gone". `git worktree list` failing (git missing, spawn
   failure, repo locked) used to make removal report a clean result while both
   halves still existed — the same soundness hole one level up. `existsSync`
   has the same defect (it returns `false` on a permission error) and is
   replaced by an `lstat`-based check that treats any non-`ENOENT` error as
   PRESENT.
5. **Git itself refuses case-variant refs on Windows.** `git branch FOO` with
   `foo` present fails: `fatal: a branch named 'FOO' already exists`
   (`refs/heads/foo` is one file on a case-insensitive volume). So both
   spellings resolve to the same commit and the whole hazard lands on **our**
   naming: had the directory been named after the ref, `foo` and `FOO` would
   have been one directory. Names are `agtwt-<sha256(ref)[:12]>-<random hex>`
   — the hash is case-SENSITIVE and hex-only (so the name itself cannot
   case-fold into another), and the random suffix keeps two concurrent scopes
   at the *same* ref apart. Both components are load-bearing and both are
   asserted (scenario 7, NC-5).
6. **`fs` needs the `\\?\` prefix past ~260 chars**; git does not. Applied at
   240 chars, not 260: `MAX_PATH` counts the terminating NUL and a directory
   must leave room for `\` + an 8.3 name, so `MAX_PATH - 12` is the documented
   safe headroom for a directory. UNC paths take `\\?\UNC\server\share\…`.

## Base-directory degrade ↔ the addendum's "push-failure → temp-dir degrade"

The architecture's injected-failure list names *push-failure → temp-dir
degrade*. The push half is Epic 5's remote flow and is explicitly **out of
scope here** (this spike performs **no network operations at all**). What this
spike proves is the **degrade mechanism** that scenario depends on: when the
preferred base directory is unusable — unwritable, missing, or too long — the
lifecycle switches to a **declared** alternative, records WHY as a typed
`base-dir-degraded` degradation, and completes cleanly (scenarios 6 and 8).
Residue in the previously-preferred base is swept too, so a degrade cannot
orphan it. A degrade is never silent.

## What was NOT measured

- **No network.** No fetch/push against real remotes; every ref is local.
- **No second platform.** Linux/macOS behaviour is unmeasured here — this gate
  is Windows-only by design. The *unit* suite
  (`packages/core/src/git/worktree.test.ts`) is platform-neutral and runs on
  CI's Linux, so the platform-independent behaviour is guarded there.
- **No cross-process concurrency within one repo.** In-process parallel
  lifecycles ARE covered (unit test, `Promise.all`); two `guardrails`
  processes reclaiming the same repo simultaneously were not tested. The
  live-worktree exclusion is **in-process only** and is marked in the source
  as the known ceiling (a per-worktree pid lock file is the upgrade path). The
  cross-*repo* case is now structurally impossible — see the namespaced base.
- **Timings are descriptive, not a gate criterion.** The 458 ms median is
  measured against a **3-file** repo, so it excludes checkout cost, which is
  the dominant real-world term. No threshold is asserted on it and none should
  be inferred.
- **Fingerprint scope.** See "Intact invoking tree" above: mtimes, reflogs,
  object-store growth and index metadata are outside it.
- **The orphaned-lock check cannot fail** by construction (nothing here takes
  a git lock). Stated, not counted.
- **Antivirus interference was not controlled for.** Real-time scanning is a
  known source of transient Windows handle holds; the retry/backoff exists
  precisely for it, but no AV-induced failure was observed.
- **Disk-full / quota exhaustion** during checkout was not injected.
- **SIGINT/SIGTERM.** Ctrl-C runs no cleanup, exactly like the SIGKILL case;
  the residue is recovered by the next run's reclamation (scenario 2 is the
  proof). No signal handler is installed deliberately: a **library** must not
  hijack the host process's signal handling. If the CLI wants faster recovery
  it should install the handler at the process boundary in 1.15.

## Windows-specific handling required — for Story 1.15

Consume `withWorktree()` as-is; do not re-implement any of this.

**The git wrapper (`packages/core/src/git/`):**

1. Pass `-c core.longpaths=true` on **every** command that touches a
   worktree's files. Never `git config` the user's repo.
2. Use `--detach` for worktree checkouts. A branch checked out in the invoking
   tree cannot be checked out again; a PR scope must not depend on branch
   availability.
3. Never build a worktree path by string concatenation, and never name a
   worktree after a ref. `node:path` only; names stay `agtwt-<hash>-<rand>`.
4. Treat git's exit status as necessary but **not sufficient** evidence of
   removal — re-check `git worktree list` AND the directory, and treat a
   *failed* check as unknown rather than as success.
5. **Refs are untrusted input.** A PR ref beginning with `-` is an argument
   injection; `withWorktree` rejects it and passes every ref after `--`. Do
   not build a second path to git that skips this.
6. `gitCommand` ("run any git subcommand in any cwd") is an **internal seam**
   and is deliberately absent from core's public barrel. Add a named, bounded
   helper rather than re-exporting it.
7. Every git spawn now carries a **120 s timeout**, a 64 MiB `maxBuffer`, and
   `GIT_TERMINAL_PROMPT=0` / `GIT_ASKPASS` / `GCM_INTERACTIVE=never`. 1.15's
   remote-ref flow is exactly where a credential prompt would otherwise hang
   the process forever.
8. **Ceiling to design around:** git is spawned with `spawnSync`, so a removal
   plus its backoff **blocks the event loop** for its whole duration (up to
   ~1 s at the default 4 attempts / 150 ms base, longer if a handle is held).
   Do not schedule concurrent scopes in one process expecting overlap; move
   the wrapper to `execFile` + promises first.

**`core/persistence`:**

9. Artifacts must be written to the **invoking repo's** `_agentic-guardrails/`
   tree, not the worktree's — the worktree is deleted, so anything written
   inside it is gone. Pass the invoking `repoRoot` explicitly.
10. `writeFileAtomic`'s tmp+rename+cleanup discipline is what a worktree run
    needs; keep the temp file in the **target** directory (a cross-device
    rename from a temp base to the repo would not be atomic).
11. Any path handed to `fs` that may exceed 260 chars needs the `\\?\` prefix
    (`fsPath()` in `worktree.ts` is the pattern).

**Degradations and the manifest:**

12. Removal failures are **typed degradations**, not exceptions. Surface them
    in the run manifest like any other declared degradation — via
    `toManifestDegradation()`, which folds `kind` into `reason` as a prefix so
    the value satisfies the canonical `contracts` `Degradation`
    (`{ reason, subject }`) with no `kind` field. `fromManifestDegradation()`
    is the inverse; the round-trip is unit-tested against
    `degradationSchema`. Do **not** hand a raw `WorktreeDegradation` to a
    schema boundary.
13. On the **throwing** path there is no result object: a removal that fails
    while the callback is also throwing is attached to the propagating error.
    Read it with `worktreeDegradationsOf(error)` in the catch, or the leak is
    invisible.
14. An `ok: false` result carries `worktreePath` — report it, so a user can
    find residue by name.

**Operational:**

15. `reclaimWorktrees()` runs as the first step of `withWorktree`. This is the
    only recovery path after a crash, `SIGKILL` or Ctrl-C — a killed process
    runs no cleanup, so residue after a kill is expected and is **recovered**,
    not prevented.
16. If parallel scopes are ever run from separate processes **against the same
    repo**, add a per-worktree pid lock before cross-process reclamation can
    be trusted. Different repos are already safe: the base is namespaced by a
    hash of the canonical repo root.
