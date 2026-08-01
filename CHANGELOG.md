# Changelog

All notable changes to this project will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Fixed
- Isolated-ref reviews now resolve bare package imports against the invoking
  checkout's installed dependency plane. Resolved dependencies remain verified
  external nodes: they are neither traversed nor exposed as absolute paths in
  review artifacts.

### Added
- Epic 1 deferred-work sweep: all 11 ledger entries now have a terminal
  disposition. Per-axiom `RULESET_VERSIONS` replaces the global ruleset cache
  invalidator; manifests retain schema compatibility by recording the
  canonical serialized map. Three knowledge/evidence concerns are assigned
  as acceptance criteria to Stories 4.1, 4.2, and 4.5; Windows automation is
  assigned to Story 5.4. Three obsolete or unsupported proposals are
  discarded with evidence and reopen triggers in the ledger.
- SPIKE-1 — structured-output prototype, the M1 signal (Story 1.19,
  `docs/spikes/SPIKE-1-structured-output.md` + raw results
  `docs/spikes/SPIKE-1-results.json`): **PASS** — 50 genuine headless
  `claude -p` invocations of a throwaway handshake skill over the ADR-001
  `<axiom>.in`/`.out` envelope (built via the shipped `axiomEnvelope`
  factory, carrying the shipped `findingSchema` verbatim) produced 50/50
  raw-valid outputs on the first attempt (0% raw failure, 100% post-repair
  vs the ≥98% bar; the ADR-001 repair ladder never fired on a real
  invocation — its wiring is proven by the stub self-test, all five outcome
  classes classified correctly before any paid run). File-handshake
  fidelity throughout: atomic temp→rename as the only completion signal, a
  torn temp never read. No envelope or ADR-001 change was demanded by the
  data; `contracts` shipped untouched. Per the story contract no harness or
  skill code survives — the instrument was committed intact at
  `9aaf9cd` (the resurrection point — tag `spike-1-harness`, recorded in
  the spike doc) and deleted.
  The open RULESET_VERSION ledger entry carries its decision: per-axiom
  ruleset versioning (per-axiom version map in each axiom's findings-cache
  key, manifest-declared), implementation owned by the Epic-1 epic-end
  sweep, pre-Epic-3.
- Dogfood CI workflow and review exclusions (Story 1.18). The M1 gate gets
  its mechanism: a PR-only CI step runs `guardrails review` on the PR diff
  via direct CLI invocation (`--no-input`, deterministic-only), failing the
  check on blocking findings, asserting the <60s NFR-1 envelope in-step
  (measured wall-clock printed every run), and uploading
  `_agentic-guardrails/reviews/` as a workflow artifact on `always()` —
  upload-without-committing is the configured policy (`--no-input`
  disposition is `drop`). New optional `exclude: string[]` config key
  (posix repo-relative path prefixes, no globs — ADR-006): applied where
  the change set is built for ALL four scopes and to the changed-KLOC
  denominator; excluded files are counted and declared per run (manifest
  `scope-exclusions` degradation + `excluded:` report line + FR-31
  deviation line), never silent; invalid entries (absolute, backslash,
  glob, blank, non-array) are typed config errors naming the index. The
  repo's own committed `_agentic-guardrails/` layer is bootstrapped via
  `guardrails init` with the dirty fixture trees excluded plus three
  narrow exact-path excludes for inline fake-credential test fixtures
  (Block-If human ruling — no allowlist mechanism, new fakes re-trip the
  gate). `tests/tsconfig.json` closes the 1.4-era coverage gap
  (integration tests, `vitest.config.ts`, `tsup.config.ts` now belong to a
  tsconfig project; `normalizeCacheTruth` joined the core package surface),
  so dogfood runs exit 0 with zero degradations. Five deferred-work
  entries naming 1.18 carry recorded dispositions (`docs/dogfood-ci.md` +
  the ledger); the determinism required check remains the existing
  byte-identity integration suites — no second harness. Root
  devDependencies gain `@agentic-guardrails/core` (the tests project now
  imports the core package surface) and `@types/node@^26` — pinned to what
  the contracts package already resolves, since the new tests project's
  `types: ["node"]` resolves the root install (typecheck verified green on
  26).
- SPIKE-4 — noise metric and labeled fixtures gate (Story 1.17). The "<30%
  noise" product claim gets its metric and its CI enforcement
  (`docs/spikes/SPIKE-4-noise-metric.md`): denominator = error/warning
  findings (info excluded from both sides); live numerator = DR-1
  `not-actionable` dispositions (definition only — computation lands with
  dogfood data, 1.18+); CI proxy = fixture placement over the five analyzers'
  existing labeled fixture sets (`expected-findings.json` entries are true
  positives, `clean/` trees the zero-noise oracle, an optional `noise/` tree
  for known-FP exemplars). The disposition-scope question 1.16 deferred is
  ruled **carried**: the latest disposition for a `findingId` labels every
  reappearance, so recurring false positives keep counting. The gate
  (`tests/integration/noise-metric.e2e.test.ts`, riding the existing
  integration CI step) prints the per-analyzer FP/denominator/rate table
  every run and fails at ≥30% overall (strictly — exactly 30% fails), at any
  analyzer rising above its committed baseline
  (`tests/__fixtures__/noise-baseline.json`, retroactively measured
  2026-07-31: 0 FP / 23 error-warning findings across structural,
  cleanliness, nfr, security, conformance), or at an analyzer with no
  baseline entry. All gate decisions are integer/rational arithmetic — no
  float, and the baseline stores counts, never a rate.
- Scores, trends and dispositions (Story 1.16, FR-14/15, DR-1). Two contracts
  that shipped in 1.2 and had never been written by anything now have a
  producer, a store and a reader.
  - **FR-14 — raw counts stored, score derived.** Every artifact gains an
    optional `scores` block: raw per-axiom severity counts, the measured
    change size, and the OD-1 v1 score
    (`100 − (10·E + 3·W + 1·I)/changed-KLOC`, floored at 0) stamped with its
    `formulaVersion` everywhere it is rendered or persisted, so a formula
    change re-derives history instead of poisoning it. **Determinism is
    structural, not hoped for:** the whole path is integer arithmetic and no
    raw IEEE double reaches `JSON.stringify` — `changedKlocMilli` (thousandths
    of a KLOC, which are exactly lines of change) and `scoreTenths` are the
    persisted fields, and the decimal point is put back by string construction
    at render time. Tests pin EXACT expected values, never approximate ones.
    Changed-KLOC floors at 0.1 so a one-line or deletion-only diff stays
    finite — **that edge rule is proposed, not ratified** (epics.md:705 says
    "confirm with the OD-1 owner at story time"); the version stamp is the
    mechanism by which it can change. `--project` is not a diff and has no
    denominator by construction, so it records counts and OMITS the score with
    a declared reason — never a fabricated 0 or 100 meaning "undefined".
  - **Change-size measurement**, the primitive that did not exist: a
    `git diff --numstat -z` helper with its OWN parser (`parseNumstatZ`) — the
    `-z` numstat format is `<add>\t<del>\t<path>\0` with renames emitting two
    extra path tokens, which `parseNameStatusZ` cannot read. Binary files
    (`-`/`-`) contribute 0 lines and are counted and DECLARED, never silently
    read as no change; a count git did not write as an integer is treated the
    same way rather than shrinking the denominator (which would inflate the
    score). Ref scopes measure `mergeBase..ref`; the uncommitted scope measures
    `diff --numstat HEAD` plus untracked files counted as all-added, matching
    how its change SET is built.
  - **The committed history plane.** `_agentic-guardrails/history/trends.jsonl`
    and `history/dispositions.jsonl`, seeded empty by `init` (git tracks files,
    not directories) and covered by the `history/*.jsonl merge=union` attribute
    wired forward in 1.8. New `persistence/history.ts`: a REAL `appendJsonl`
    (single `write()` on an `"a"` handle + fsync, LF regardless of platform)
    that is idempotent on `recordId` and REPAIRS a torn trailing record before
    appending — `ensureLines` was deliberately not reused, because it dedupes
    by line CONTENT and would silently drop a legitimately repeated record.
    Reads are validate-before-trust: every line goes through its Zod schema and
    an invalid or torn one is skipped and declared, never fatal. A missing file
    is a normal first run, not a degradation.
  - **FR-15 — the delta, report-only.** `report/trends.ts` dedupes on
    `recordId`, orders by GIT ANCESTRY, and cold-starts rather than reporting a
    delta it cannot trust. The delta is rendered in the REPORT and never
    written to the artifact: it depends on prior history, and three tests
    assert the artifact is byte-identical for identical inputs. Those three
    assertions still pass unmodified.
  - **Ancestry primitives.** `isAncestor` reads the EXIT STATUS of
    `merge-base --is-ancestor`, because exit 1 there is a negative ANSWER, not
    an error — routed through the existing `git()` wrapper it would have been
    indistinguishable from "git is missing", and the aggregator would have
    cold-started on a perfectly healthy repo. `commitExists` separates a
    rebased-away or gc'd sha (skipped and declared) from a real failure.
  - **The ordering is a PARTIAL order and says so.** Two `uncommitted`-scope
    runs share one `commitSha`, and two ancestors of a merge commit need not be
    ancestors of each other; `recordId` is the declared tiebreak and the
    ambiguity is printed rather than silently resolved.
  - **DR-1 finding dispositions** (`packages/cli/src/finding-disposition.ts`),
    following `disposition.ts`'s shape verbatim — non-interactive
    short-circuit BEFORE readline is constructed, `eofSafeIo`, SIGINT closing
    the interface so Ctrl-C settles through the EOF default instead of
    exit(130), `lines: string[]` back to the caller, and NO effect on the exit
    code. INDEPENDENT of 1.15's artifact disposition: findings are labelled
    whether the artifact was committed or dropped. The record id hashes the
    ANSWER, so an identical re-answer appends nothing while a CORRECTION is
    kept instead of silently colliding with the original. The default
    non-interactive policy records NOTHING; `dispositionPolicy: deferred` is
    available for teams that want CI findings in history as explicitly
    un-triaged.
  - **`guardrails trends [--open]`** — a fully self-contained HTML view at the
    gitignored `.cache/trends.html`: inlined data, vanilla JS, inline CSS,
    hand-drawn SVG, no CDN, no network, no charting dependency. Scores are
    derived in the page from the stored raw counts. Inlined data is escaped for
    SCRIPT context by a function distinct from the report's `sanitizeMessage`
    (a C0 control-character filter that passes `<` and `>` straight through) —
    a ref name or sha containing `</script>` cannot break out, and the page
    builds every node with `textContent`, never `innerHTML`. An honest empty
    state on a first run; `--open` prints the path first and is never fatal.
  - **Retention.** `reviews/<scope>/` is pruned to the newest
    `artifactRetention` (default 100, config-overridable) using
    `deterministic-cache.ts`'s prune shape — newest-first by mtime with the
    filename as tiebreak. **Committed history is never pruned.** DEVIATION,
    declared: the AC and architecture.md say `manifests/` is pruned, but no
    `manifests/` directory exists (1.4 embedded the manifest in the artifact);
    the retention applies to the per-run store that actually exists, and
    whether a committed `manifests/` store should exist is Epic 4's question.
  - **Config plane** gains two optional strict-schema keys —
    `artifactRetention` and `dispositionPolicy` — with entries in
    `EFFECTIVE_DEFAULTS` and in `computeDeviations`, so neither becomes a
    silent policy change (FR-31).
  - **Adversarial-review fixes, same story.** The OD-1 denominator is now
    summed PER PATH and filtered, so `_agentic-guardrails/**` — including the
    history line every run appends — cannot inflate it (`parseNumstatZ` returns
    per-file counts and there is no unfiltered total to reach for). The FR-15
    ancestry query asks about the commit the run REVIEWED rather than the
    invoking HEAD, so a `--branch`/`--pr` delta works before the branch is
    merged. `appendJsonl` validates every record against its schema before
    writing, repairs a torn tail only when the tail genuinely fails to parse
    (a record that lost only its newline gets the newline back rather than
    being deleted from committed history), loops on short writes, truncates in
    place instead of through a temp-file rename, and dedupes within a batch;
    its docstring now states what idempotency does and does not promise under
    concurrency. Disposition answers are looked up in a `Map`, so `__proto__`
    is an unrecognised answer rather than a schema-invalid record; disposition
    records carry a per-key `revision` so REVERTING to a previous answer is
    recorded and "latest wins" is true of the file. Both record schemas
    recompute `recordId` and reject a record whose id is not its content
    address — the aggregator's declared tiebreak was otherwise attacker-chosen
    text in a `merge=union`'d store. `od1ScoreTenths` applies the 0.1-KLOC
    floor itself, so a record-supplied denominator of 0 can no longer produce
    `Infinity` (rendered `0.0`) or `NaN` (rendered as the "no score" dash).
    `--project` omits `changedLines`/`changedKlocMilli` entirely instead of
    persisting a floored one, and the scores block enforces its
    score/reason exclusivity in the schema rather than in a comment. An unborn
    repository records no trend record and says so. `guardrails trends`
    sanitizes every untrusted line it prints, and `--open` uses a plain
    executable (`explorer.exe` on Windows) rather than `cmd /c start`, which
    re-parses its command line and would have executed a repository path
    containing `&`. The cold-start ratio and the ancestry-scan cap declaration
    both count the right sets, so neither fires on an ordinary re-run, and the
    artifact prune survives an entry vanishing mid-prune.

- Review scopes — branch, PR and project (Story 1.15, FR-25): `guardrails
  review` gains `--branch [ref]`, `--pr <id>`, `--project` (mutually
  exclusive), `--base <ref>` and `--no-input`. Bare `guardrails review` is
  unchanged, down to the artifact bytes (the manifest's new `scope` block is
  omitted for the uncommitted scope). The structural change is the
  **analyze/write split**: `analyzeRoot` (a detached `git worktree` when the
  reviewed ref is not HEAD) supplies the change set, file reads, content
  hashes and tsconfig discovery, while `outputRoot` — ALWAYS the invoking
  repository — owns config, both cache tiers, the corpus seed, git-wiring
  preflight and the artifact write, so a deleted worktree can never take the
  output with it. No absolute analyze-root path may enter a cache key, a
  runId, an artifact field or a finding location; the same ref reviewed from
  two different worktree paths produces a byte-identical artifact, an identical
  runId, and a WARM cache on the second run (directly tested, through the real
  analyzers). Every `fs` call on an analyze-root path goes through `fsPath`
  (`\?\` prefixing), including the artifact write and the cache-key reads,
  where a long path would otherwise read as "not found" or disable the cache
  for the whole run. A worktree is created ONLY when the ref
  is not the current HEAD — reviewing HEAD inside a worktree would silently
  drop uncommitted state — and goes through 1.14's `withWorktree()`
  unchanged, with removal degradations reaching the manifest via
  `toManifestDegradation()` and a removal that failed on the throwing path
  read back with `worktreeDegradationsOf()`. New scope plane
  (`pipeline/scope.ts`): one resolver, four change-set producers, and the
  `_agentic-guardrails/` exclusion in ONE place downstream of all four.
  Directory slugs are lossy by construction, so a lossy derivation carries an
  8-hex `sha256(ref)` suffix (`feat/Foo` and `feat-foo` can never share a
  directory) and the exact ref is recorded verbatim on the manifest instead;
  the slug BODY is capped (48 chars) so an unbounded ref name cannot blow past
  `MAX_PATH`/`ENAMETOOLONG` at persistence, after the whole analysis has been
  paid for. `SCOPE_PATTERN` widened to admit digits (`pr-42`) and
  de-duplicated: it now lives once, in contracts, with a repository-wide scan
  that fails if a second definition appears — including the pre-1.15 spelling
  (`/^[a-z][a-z-]*$/`), the copy a careless revert would bring back. New typed
  git primitives (`mergeBase`, `diffRefs`, `lsFiles`, `revParse` (peeling
  `^{commit}`, so an annotated tag at HEAD compares equal to HEAD instead of
  building a pointless worktree), `refExists`, `currentBranch`,
  `resolveDefaultBase`, `commitPath`) — ref-guarded by `refProblem` (moved
  beside the spawn it protects), terminated with `--` / `--end-of-options`,
  and keeping the 120 s timeout, 64 MiB `maxBuffer` and `GIT_TERMINAL_PROMPT=0`.
  `gitCommand` remains an internal seam.
- **No network, anywhere in this story**: a `--pr` ref must already be present
  locally (`refs/pull/<id>/head`, then `refs/remotes/origin/pull/<id>/head`);
  an absent one is a typed preflight failure carrying the exact `git fetch`
  command. Optional PR metadata comes from the user's own `gh` client
  (`gh pr view --json`, 10 s budget) parsed through a contracts schema and
  mapped field by field onto the manifest — absent, unauthenticated,
  erroring, timing-out or unparseable `gh` is a DECLARED, exit-neutral
  degradation and never a gate — and one that PARTICIPATES in the runId, so
  the same PR ref with and without `gh` (or after a title edit on GitHub)
  cannot overwrite one artifact with different bytes. `GUARDRAILS_NO_GH=1`
  keeps `gh` out of the loop entirely. A PR id with leading zeros (`007`) is
  rejected: it would probe the wrong ref, file under the wrong directory and
  ask `gh` about a different PR. A guessed diff base is declared the same way
  (the default-base search order is `refs/remotes/origin/HEAD` → `origin/main`
  → `main` → `master`; no candidate is a typed failure naming `--base`, never
  a silent full-history diff).
- Artifact disposition — commit or drop (Story 1.15, `packages/cli/src/
  disposition.ts`): on an interactive TTY the run offers to commit the
  artifact. Because `reviews/` is gitignored by design (1.8), "commit" is
  `git add -f` on that ONE file plus a PATHSPEC-LIMITED `[skip ci]` commit —
  it never edits `.gitignore`, never `git add -A`, and leaves the rest of the
  index and working tree byte-identical (asserted). EOF, a non-TTY, and
  `--no-input` all DROP (the safe default, reusing `eofSafeIo`'s
  note-emitted-once behaviour from `init`), as does **Ctrl-C** at the prompt —
  readline's SIGINT is caught and settled through the EOF path instead of
  exiting 130 and discarding the computed gate verdict; drop deletes nothing
  and makes no git call. `y`/`yes` counts as commit alongside `c`/`commit`.
  The commit passes `--no-verify`: the artifact is machine-written generated
  output, and a lint-staged style `pre-commit` hook would otherwise run
  against the user's MAIN index during our partial commit (everything the
  user commits is still hooked). A detached `HEAD` is refused rather than
  committed — git would succeed there and leave an orphan no branch points
  at — and a deterministic RE-RUN, whose identical bytes are already in
  `HEAD`, is reported as `already committed (unchanged)` instead of the
  "nothing to commit" exit status masquerading as a failure. A commit that
  genuinely cannot happen unstages the artifact, copies it to an OS temp
  directory and reports that path as a declared degradation. Disposition
  never changes the exit code.
- Cross-process worktree liveness (`.agtwt-live`): every worktree created by
  `withWorktree()` carries a file holding its creator's pid, and reclamation
  skips a worktree whose marker names a LIVE process. Before this, the live
  set was in-process only, so a second `guardrails` run on the SAME
  repository saw the first one's registered, correctly-owned, unlocked
  worktree as residue and removed it mid-analysis — the first run's files
  then landed in `deletedFiles` and it reported a clean review. (1.14 closed
  this across repositories via the namespaced base; 1.15 is the first
  consumer that makes the same-repo axis reachable.) A concurrent run is
  skipped SILENTLY — a reclaim degradation is a real one, and one run must
  not drive another's exit code — while a registered, on-disk worktree whose
  liveness cannot be established is DECLARED under the new `in-use`
  degradation kind and never deleted.
- Two new DECLARED, exit-neutral degradations on the scope plane:
  `scope-in-place` (a ref scope analyzed in place — `--branch <current>`,
  `--project` — while the working tree is dirty, so the analyzed bytes are
  not the ref the manifest records) and `scope-change-set` (an EMPTY ref
  diff: `--branch main --base main`, or an already-merged branch, which
  otherwise produced a clean exit-0 artifact indistinguishable from a real
  review). Ref-scope change sets now come from `diff --name-status -z`, so a
  DELETED path is the one git named and any other unreadable file is a real
  degradation rather than a silent "deleted" entry.
- Worktree isolation lifecycle (Story 1.14 / SPIKE-5,
  `packages/core/src/git/worktree.ts`): `withWorktree()` creates a detached
  worktree at a target ref, runs the caller's callback inside it, and always
  removes it — on return, on throw, on rejection — with bounded retry/backoff
  and a TYPED `removal-failed` degradation instead of a silent leak (on the
  throwing path the degradation rides on the propagating error, readable via
  `worktreeDegradationsOf()`). `reclaimWorktrees()` sweeps residue before
  every create — the only recovery path after a `SIGKILL`, which runs no
  cleanup — under an explicit ownership discipline: tool prefix, inside THIS
  repository's namespaced base (`<root>/<sha256(repoRoot)[:12]>/`, so one
  repo's sweep can never see another's directories in the shared OS temp
  root), not live in this process, not the invoking worktree, not
  `git worktree lock`-ed, and with its `.git` pointing back at this repo —
  anything else is DECLARED (`locked` / `unowned`), never deleted. Base
  directory is OS temp, with a DECLARED degrade (`base-dir-degraded`) when it
  is unwritable or too long for git; the previously-preferred base is swept
  too, so a degrade cannot orphan residue. Windows handling encoded from
  measurement: `-c core.longpaths=true` per invocation, `\?\` prefixing for
  `fs` (UNC-aware), hash-based worktree directories (`agtwt-<sha256(ref)>-
  <random>`) so `foo`/`FOO` cannot collide on a case-insensitive filesystem,
  and removal that verifies BOTH the registry and the directory — treating a
  registry read that FAILED as unknown rather than as "gone". Refs beginning
  with `-` are rejected and every ref is passed after `--` (argument
  injection). Git subprocesses now carry a 120 s timeout, a 64 MiB
  `maxBuffer`, and `GIT_TERMINAL_PROMPT=0` so a credential prompt can never
  hang a run. `toManifestDegradation()`/`fromManifestDegradation()` adapt the
  typed degradations to the canonical `contracts` `Degradation` shape.
  `gitCommand` is an INTERNAL seam and is deliberately not re-exported from
  core's public barrel.
- SPIKE-5 gate harness + write-up (`scripts/spike-5-worktree-lifecycle.mjs`,
  `docs/spikes/SPIKE-5-windows-worktree-lifecycle.md`, raw run output
  committed at `docs/spikes/SPIKE-5-run-output.txt`): **GATE PASS** on
  Windows 11 / git 2.39.1.windows.1 — 100 consecutive create → run → cleanup
  cycles with zero leaked worktrees, zero orphaned locks and an unchanged
  invoking repository (per-cycle median 458 ms, descriptive only), plus ten
  injected-failure and measurement scenarios (mid-run `SIGKILL`, held
  directory handle transient and persistent, >260-char checkout, >260-char
  base, long base AND deep checkout together, a binary-searched measurement of
  the real base-length cliff — 213 chars working / 216 failing, vs the
  conservative 160-char constant — case-collision refs, unusable base,
  foreign worktree including another repository's live worktree) all ending
  with zero residue, none skipped. Five negative controls prove the harness
  bites: dropping the reclamation prefix bound, a no-op removal, a stray
  prefixed file, a hidden retry count, and deleting the ref hash each turn the
  gate red.
- Axiom #6 conformance analyzer (Story 1.13, `rulesetVersion: 6`, documented
  in `docs/rules/axiom-6-conformance.md`): the fifth registered deterministic
  analyzer and the first consumer of the Story-1.8 structural corpus seed.
  Three prevalence-gated rules, all `severity: "warning"` —
  `conformance/naming-convention`, `conformance/file-placement` and
  `conformance/module-shape` — each judged against the nearest directory
  scope that holds ≥ `MIN_SAMPLE` (10) classifiable corpus files with a ≥
  `DOMINANCE` (0.8) majority; below either bar the analyzer says nothing, and
  every message cites the measured counts and the scope. A file is judged on
  naming/placement only where its path is NEW to the corpus (its presence
  there means the decision pre-dates the diff), and module-shape ignores
  import edges originating in the change set: a diff can never confirm the
  convention it is judged by. An ABSENT seed is inconclusive — zero findings
  plus one declared, exit-neutral degradation, now printed as a
  `guardrails review: inconclusive: …` line; a present-but-corrupt seed is a
  real degradation and exits 2 like any other lost coverage.
- `AnalyzerResult.declaredOnly`: analyzers DECLARE which of their
  degradations are exit-neutral instead of the pipeline string-matching
  reasons. Sorted like every sibling list before it reaches the artifact.
- `manifest.corpusSeedHash`: the structural corpus seed axiom-6 findings were
  measured against, so they are reproducible from the manifest. Distinct from
  `corpusHash` (the committed `corpus-map.yaml`). The seed is read once per
  run and the same bytes feed the cache key and the analyzer.
- `structuralSeedSchema` now enforces the producer's partial-result invariant
  (`coverage < 1` requires a degraded entry) and rejects duplicate or
  backslash entity paths.

- Axiom #5 security analyzer (Story 1.12, `rulesetVersion: 5`, documented in
  `docs/rules/axiom-5-security.md`): the fourth registered deterministic
  analyzer — the one FR-32 names as gate-critical (every axiom defaults to
  blocking; axiom 5's rule set is error-dense) — with four rules across two
  source tiers. `security/hardcoded-secret` (`source: "regex"`) scans the RAW
  TEXT of EVERY changed file — not just the analyzable-TypeScript subset the
  AST rules see, so a secret in a changed `.env`, `.json`, `.yaml`, `.md`,
  Dockerfile, or `.d.ts` is caught, as are secrets in comments and
  unparseable files: ERROR for pinned near-certain token formats (AWS
  `AKIA…`/`ASIA…` ids, GitHub `gh[pousr]_` tokens and `github_pat_`
  fine-grained PATs, Slack `xox[baprse]…` tokens incl. `xoxe` refresh
  tokens, OpenAI `sk-`/`sk-proj-` keys, Anthropic `sk-ant-` keys,
  private-key PEM headers — these fire even in `.test.`/`__fixtures__`
  paths), WARNING for the heuristic ≥16-char literal assigned OR compared
  (`===`/`!==` — the hardcoded-credential backdoor spelling) to a
  secret-named identifier (name must END in a secret word-part, so
  `tokenizerConfig`/`passwordHintText` never match; whole-text scan catches
  prettier-wrapped assignments; exempt: `process.env`/`import.meta.env`
  references, placeholders anchored at the value start, basename-anchored
  test paths). Vendor-PUBLISHED sample credentials (AWS's
  `AKIAIOSFODNN7EXAMPLE`, GitHub's documented sample PAT) are allowlisted —
  they are published non-secrets. Files over 1 MiB are skipped with a typed
  degradation, the scan honors the phase-1 budget signal between files, and
  matched values are never echoed into messages. `security/injection-sink`
  (warning — the tier cannot prove taint): interpolated/concatenated strings
  into `query`/`execute` member calls or imported `child_process`
  `exec`/`execSync`; static strings never flag, including constant-foldable
  literal+literal concatenation. `security/dangerous-api` (error — the eval
  family has no legitimate application-code idiom): `eval` incl. indirect
  `(0, eval)(…)`/`(eval)(…)` forms, the `Function` constructor in every form
  (`new`, bare call, `globalThis.`/`window.`/`self.`) when its BODY — the
  LAST argument — is a string, so `new Function("x", bodyVar)` never flags;
  string or concatenated `setTimeout`/`setInterval` arguments; `vm`
  `runIn*`/`compileFunction` and `new vm.Script`.
  `security/unsafe-deserialization`: `unserialize` from a
  `node-serialize`-family import errors (known RCE vector); `v8.deserialize`
  warns (legitimate for trusted IPC). AST rules ride the shared
  changed-files parse with the 1.11 shadowing-immune symbol-resolved
  bindings (a local `eval` wrapper or shadowed import never flags); analyzed
  code is parsed as data, never executed (sentinel-tested). `AnalyzerContext`
  gains `allChangedFiles` (the raw pre-filter change list) for the secret
  scan, and axiom 5's findings cache key covers every changed file's content
  hash. Axiom 5 leaves `ANALYZERLESS_KNOWN_AXIOMS` (now empty); the violation
  fixture's oracle run exits 1 under default config (blocking, FR-32).
  ENGINE_VERSION stays 0.0.3 (no cached-payload schema change) —
  RULESET_VERSION alone invalidates the findings cache.

- Axiom #4 NFR analyzer (Story 1.11, `rulesetVersion: 4`, documented in
  `docs/rules/axiom-4-nfr.md`): a third registered deterministic analyzer
  with three structural-tier rules over changed files (no import graph) —
  `nfr/unbounded-promise-all` (`Promise.all`/`allSettled`/`any`/`race` over
  a dynamically sized array: `.map` results, bare identifiers/calls, spreads
  of non-literals; only RECURSIVELY fixed-arity array literals are exempt),
  `nfr/sync-io-in-async` (a `*Sync` member of an imported `fs`,
  `child_process`, `zlib`, or `crypto` binding — bare or `node:`-prefixed;
  named/renamed/namespace/default/`{ default as x }` forms — called where
  the NEAREST enclosing function-like is `async`; module-top-level
  config-load reads, class field initializers, and static blocks stay
  exempt), and `nfr/missing-abort-signal` (a global `fetch` call whose
  options provably lack a signal: absent, `undefined`, `null`, or an options
  literal without `signal` — incl. a literal `signal: undefined`;
  non-literal and spread-carrying options are a stated ceiling, never
  flagged). Zero-false-positive binding checks: `fetch`/`Promise` flag only
  when they resolve to the ambient global (DI parameters, local wrappers,
  and wrapper-module imports are skipped), sync-IO calls only when they
  resolve to the tracked import binding's symbol; `globalThis`/`window`/
  `self` property access and string-literal bracket access are covered. ALL
  severities are `warning` by design — the structural tier flags hazard
  patterns without runtime context, so it never blocks on its own (axiom 4
  cannot gate in Epic 1; Epic 3's LLM tier is where severity can rise); the
  violation fixture's oracle run exits 0 with findings persisted.
  ENGINE_VERSION stays 0.0.3 (no cached-payload schema change) —
  RULESET_VERSION alone invalidates the findings cache.
- Shared changed-files parse pass (`packages/core/src/analyzers/changed-files.ts`):
  axiom 3 and axiom 4 consume ONE parse-only ts-morph pass per run through a
  run-local `changedFilesCache.acquire` seam on the analyzer context (same
  synchronous-memo discipline as the graph cache), with the phase-1 budget
  signal checked between files and per-file read failures declared as typed
  degradations ("changed file could not be read" — ts-morph parses any text;
  only the read can fail).

- Axiom #3 cleanliness analyzer (Story 1.10, `rulesetVersion: 3`,
  `engineVersion: 0.0.3`, documented in `docs/rules/axiom-3-cleanliness.md`):
  a second registered deterministic analyzer with four AST-tier rules over
  changed files — `cleanliness/unreachable-code` (error — statements after a
  terminal `return`/`throw`/`break`/`continue` in the same block),
  `cleanliness/unused-export` (warning — an exported symbol in a changed
  file that no project file imports by name; namespace/`export *`/dynamic
  importers count as using all exports, `export default` tracked as
  "default", type-only usage counts, and zero-importer files are exempt
  entirely as indistinguishable from entry points),
  `cleanliness/duplicate-code` (warning — two ≥5-statement function-like
  bodies among the changed files with identical normalized structure,
  identifiers/literals folded; one finding per pair at the later occurrence
  naming the original), and `cleanliness/excessive-complexity` (warning —
  cyclomatic complexity > 15 per function-like, threshold hardcoded with
  rationale). Import-graph edges now carry the per-edge imported binding
  `names` (`*` for whole-namespace usage, `default` for default imports;
  unioned across deduped same-identity edges) — the usage substrate that
  makes unused-export graph-cheap. The cached-graph payload schema change
  is paired with the ENGINE_VERSION bump so pre-1.10 cache entries become
  clean key misses, never corruption-flavored degradations. Within one run
  the graph build is shared between the two analyzers via a run-local memo
  (one parse per tsconfig; intra-run reuse never inflates the persistent
  hit/miss counters), and identical graph-build degradations declared by
  both analyzers are deduplicated at aggregation.
- Axiom #1 full structural rule set (Story 1.9, `rulesetVersion: 2`,
  documented in `docs/rules/axiom-1-structural.md`): import-graph edges now
  carry the 1-based import-statement `line` (dynamic imports: the call
  site), so every axiom-1 finding anchors at the real import line instead
  of line 1. New rules alongside the absorbed `structural/circular-import`:
  `structural/unresolved-import` (error — a changed file's relative/alias
  specifier that fails resolution, specifier in the message; bare externals
  and node builtins stay verified externals, the paired graph degradation
  remains the coverage truth), and — with the new optional `boundaries`
  config key (path-prefix `layers` + fail-closed `allowed` dependency map,
  cross-references schema-refined, longest-prefix layer assignment,
  same-layer imports always allowed) — `structural/dependency-direction`
  (error — from→to layer pair not in the allowed map; type-only edges
  exempt, dynamic imports and re-exports checked) and
  `structural/unassigned-file` (warning — changed file matching no declared
  layer prefix). Absent `boundaries` → those two rules emit nothing (not a
  degradation) and existing configs/artifacts are unchanged. An internal
  import target assigned to NO declared layer also fires the direction rule
  (the `(unassigned)` pseudo-layer — no evasion by routing through an
  unassigned file), and layer path prefixes are schema-validated (no globs/
  backslashes/`./`/absolute/trailing-`/`; a path belongs to one layer). The
  `boundaries` declaration participates in the findings cache key, and
  `ENGINE_VERSION` is bumped to `0.0.2` because the cached-graph payload
  shape changed (edge `line`, `unresolvedImports`) — pre-upgrade cache
  entries live under old keys and become clean misses (a designed miss,
  never a revalidation failure masquerading as corruption). FR-21 merge
  granularity now includes `ruleId`: different rules colliding at one line
  stay distinct findings. Import-graph edge identity stays line-free
  (duplicate imports of one target are one edge carrying the smallest
  observed line), keeping fanIn/fanOut and the 1.8 structural seed stable.
  Machine oracle fixtures under `tests/__fixtures__/structural-rules/`
  (violation findings byte-compared twice + clean fixture asserting zero
  findings) via `tests/integration/structural-rules.e2e.test.ts`.
- `guardrails init` + structural corpus seed (Story 1.8): bootstraps
  `_agentic-guardrails/` — `config.yaml` from the 1.6 default constants or a
  per-axiom TTY questionnaire (option values sourced from the contracts
  schema; `--no-input`/non-TTY stdin writes defaults, no prompt ever
  blocks), empty-but-valid `conventions.yaml` + `corpus-map.yaml` (new
  contracts `ledger.ts` schemas, registered in the migration ladder with
  golden fixtures), `.gitattributes` with `history/*.jsonl merge=union`
  (inside `_agentic-guardrails/` — user root git files untouched), and the
  seeded `.gitignore`. Builds a regenerable file-level structural seed
  (sorted `{file, fanIn}` per merged-import-graph node, partial-result
  envelope carried) as a plain atomic file at
  `.cache/corpus/structural-seed.json`; no tsconfig → skipped with a
  declared reason. Init writes only MISSING files (never clobbers; per-file
  created-vs-kept summary; wiring lines appended, user content verbatim);
  exit 0 success / 2 typed failure (not a git repo, write error). Review's
  phase-0 preflight now verifies the git wiring when `_agentic-guardrails/`
  exists (missing line → stderr warning naming the consequence, never exit
  2), and the manifest's `ledgerHash`/`corpusHash` become the sha256 of the
  committed `conventions.yaml`/`corpus-map.yaml` bytes with their "absent
  until init" degradations dropped (absent files keep sentinel +
  degradation exactly as before).
- Pipeline hardening + deterministic cache (Story 1.7): phase 4 now merges
  overlapping findings per FR-21 (same file + axiom, >50% of the smaller
  range overlapping — transitive chains merge greedily left-to-right against
  the accumulated cluster; merged findings keep the lexicographically
  smallest constituent `findingId` for disposition continuity, take the
  strongest severity, union `source` into an array — the contracts finding
  schema now accepts a source enum OR a non-empty array — and preserve both
  messages joined with `" | "`). A content-addressed cache under
  `_agentic-guardrails/.cache/{graph,findings}/` (gitignored; atomic writes;
  pruned to the newest 100 entries per kind by mtime) serves import graphs
  and per-axiom findings for unchanged inputs — keys hash change content,
  tsconfig + participating-file content, scope, ruleset/engine versions, and
  tier enablement (deliberately excluding HEAD, so unrelated commits still
  hit). Hits skip analyzer execution and the graph build; every lookup is
  declared in the manifest's new optional `cache` counters (hits/misses/
  invalid), and cached entries revalidate through the contracts schema on
  read — torn or stale entries recompute with a typed degradation, never a
  crash or wrong data. Cold and warm artifacts are byte-identical except the
  `cache` counters themselves (documented carve-out). Phase 1 runs under a
  30s wall-clock budget (SPIKE-3-derived, AbortSignal + p-map) that degrades
  cut-off analyzers to typed partials. The manifest's new optional `phases`
  field declares the fixed six-phase assembly with per-phase membership
  (phases 2/3 empty with the reason), and the CLI report header now lists
  degraded work (subject + reason) above the findings block.
- Config plane (Story 1.6): `guardrails review` loads
  `_agentic-guardrails/config.yaml` through the contracts `configSchema`
  (single source of truth; core parses YAML via the `yaml` package and
  `safeParse`s — no component reads config outside the validated object).
  Per-axiom enforcement (`blocking | advisory | off`, axiom #5 defaulting to
  `blocking`) plus an optional `maxFindings` threshold now drive exit-code
  gating: a blocking axiom fails the gate only when its error-severity
  findings exceed `maxFindings` (default 0); advisory findings never affect
  the exit code (still reported + persisted); `off` axioms are excluded from
  the run at analyzer-membership level and declared in the manifest's new
  optional `axiomsOff` field. Invalid configs are typed errors naming the
  offending path (Zod) or line/column (YAML) — exit 2, never a stack trace,
  never a silent fallback. Every deviation from defaults is logged at run
  start (one stderr line per value: path, configured, default); a missing
  config file is declared as "using defaults (no config file)". The
  generated JSON Schema is kept current at
  `_agentic-guardrails/config.schema.json` (atomic write; write failure
  degrades, never aborts) for `# yaml-language-server` editor autocomplete,
  and the config content hash joins the runId inputs (config changes
  identity).
- SPIKE-3 — import-graph cost at scale (Story 1.5): committed benchmark
  harness (`scripts/spike-3-benchmark.mjs` + seeded synthetic-repo generator
  `scripts/spike-3-generate-repo.mjs`, run manually, repos generated to OS
  temp, never committed) measuring 10k-file cold/warm graph builds with peak
  RSS, a concurrency sweep {2,4,8} through a hand-rolled bounded async pool,
  the real `runReview` on a 1k-file repo (<60s NFR-1 gate), and a full
  bidirectional set-equality correctness check against the seeded
  ground-truth edge set (missing + spurious both asserted zero). Results,
  derived warm-rebuild budget, chosen p-map bound, and gate verdict recorded
  in `docs/spikes/SPIKE-3-import-graph-cost.md`.
- Walking skeleton — first end-to-end review (Story 1.4):
  `@agentic-guardrails/cli` ships the `guardrails review` command
  (uncommitted scope) driving the real static pipeline in core — phase 0
  preflight (typed git wrapper, spawn-only, no shell interpolation) → phase 1
  deterministic tier (p-map with per-axiom crash isolation) → phase 4
  aggregation (findings sorted file → line → axiom) → phase 5 composition.
  First real Axiom #1 rule, `structural/circular-import`, detects import
  cycles over the Story-1.3 graph (type-only edges ignored), emitting
  contracts-valid Findings. The review artifact (with the RunManifest
  embedded under its `manifest` key — one visibility-atomic temp-file →
  fsync → rename
  write) lands in `_agentic-guardrails/reviews/uncommitted/<run-id>.json`,
  created on demand; the layout adopts the `reviews/<scope>/` addendum
  default. Run identity is a hash of inputs (no wall clock): identical input
  produces byte-identical artifact JSON at the same path. Absent ledger and
  corpus (both 1.8) are declared with empty-string sha256 sentinels plus
  typed degraded entries — never faked. Exit codes: 0 clean, 1
  error-severity findings, 2 degraded run or preflight failure. First real
  e2e test (`tests/integration/walking-skeleton.e2e.test.ts`) spawns the
  built CLI against temp git repos.
- TypeScript LanguageAdapter + import graph (Story 1.3):
  `@agentic-guardrails/core` ships the `LanguageAdapter` seam and its
  ts-morph-backed `TypeScriptAdapter`, building a deterministic import graph
  (tsconfig `paths` aliases, barrels/re-exports, type-only imports —
  declaration-level and inline modifiers — external packages, plus
  AST-discovered dynamic imports, `import x = require(...)`, and `require`
  calls: literal specifiers resolve via the compiler, non-literal ones
  degrade) returned through the contracts partial-result shape —
  unresolvable imports, unresolved bare specifiers (kept as external nodes
  but flagged unverified), and tsconfig load failures degrade, never throw. `ImportGraph` offers
  byte-stable `serialize()` plus `fanIn`/`fanOut` queries, golden-tested
  against a committed fixture project. `docs/adr/ADR-004-ast-tooling.md`
  accepted.
- Canonical contracts (Story 1.2): `@agentic-guardrails/contracts` now ships
  the full pure-Zod schema surface — `Finding` + line-drift-stable
  `computeFindingId`, `RunManifest`, ADR-001 `axiomEnvelope` factory, config
  schema + generated JSON Schema, generic partial-result/degradation
  contract, OD-1 trend records, DR-1 disposition records, and the
  `migrateArtifact` versioned-artifact migration ladder (with committed v1
  golden fixtures). `zod` ^4 is the package's only runtime dependency
  (test-asserted). `docs/adr/ADR-001-llm-envelope.md` accepted.
- pnpm-workspaces monorepo scaffold for the v2 runtime: `packages/contracts`
  (`@agentic-guardrails/contracts`) and `packages/core`
  (`@agentic-guardrails/core`), ESM-only, built with tsup, typechecked via
  `tsc -b` project references.
- Forbidden-import lint wall keeping `core` LLM-free (ADR-005): ESLint
  `no-restricted-imports` scoped to `packages/core/**/src`, plus
  `scripts/check-boundaries.mjs` for a structural dependency check across
  package manifests. Both are covered by self-guarding unit tests.
- `.github/workflows/ci.yml` — lint, typecheck, boundary check, build, and
  test gate every PR and push to `main`.
- Changesets configured (`.changeset/config.json`, `baseBranch: "main"`,
  `access: "public"`) for future multi-package SemVer releases; no publish
  workflow yet (nothing is published before M4).
- `docs/adr/ADR-002-repo-layout.md` and `docs/adr/ADR-005-contracts-package.md`.

### Changed
- **This repository's root `.gitignore` no longer swallows the committed
  layer** (Story 1.16). It ignored `_agentic-guardrails/` wholesale, which made
  the committed history plane unreachable — nothing under an ignored directory
  can be committed, so the M1 gate would have had no data source in the one
  repo that dogfoods the tool. Narrowed to exactly the generated layers
  (`reviews/`, `.cache/`, `config.schema.json`) — the same three entries `init`
  seeds into a consuming repo. Verified with `git check-ignore`: the generated
  layers stay ignored and nothing beyond the intended committed layer is
  exposed.
- `trendRecord` (never written by anything before now, so this is free) gains
  `runId` and `scopeKind`, and `changedKloc` becomes the integer
  `changedKlocMilli`. `recordId` is restated as a content hash of the record's
  own identifying inputs (`computeTrendRecordId`) — the architecture's
  `{run-id, axiom, scoreKind}` definition describes one record per AXIOM per
  run, which the shipped one-record-per-run shape cannot express; the shipped
  shape is kept (one append per run keeps `merge=union` cheap) and `scoreKind`
  is dropped, since the score is a derived view and there is no score *kind* to
  record. `scopeKind` is single-sourced from `scopeKindSchema` in contracts, so
  the manifest's scope block, the trend record and core's `ScopeKind` cannot
  drift apart. No branch field: branch names are renamed, deleted and reused,
  so ancestry is the honest ordering.
- `formatSummary` gains the score line, the per-axiom delta, and an explicit
  "this run is the baseline" line on a cold start — a first run genuinely has
  nothing to compare against, and saying so is the difference between "no
  change" and "no baseline".
- The CLI's `exitOverride` is now installed BEFORE the subcommands are
  created, so they inherit it: a usage error raised by a subcommand (a
  `--pr 1 --project` conflict, a bad option) exits 2 as the documented exit
  contract says, instead of falling through to commander's default 1.
- Config plane: `configSchema` no longer injects a synthetic
  `axioms: {"5": {enforcement: "blocking"}}` entry into every parsed config.
  The gate's `EFFECTIVE_DEFAULTS` already blanket every unconfigured axiom
  with `blocking`/`maxFindings: 0`, so the injection changed no gating —
  its only observable effect was a spurious "axioms.5 matches no known
  axiom" warning and a phantom entry in `manifest.enforcement`. A parsed
  config now carries exactly what the consumer wrote
  (`config.schema.json` regenerates accordingly).
- The CLI's axiom-4 report label was `nfr` all along but is now pinned by a
  coupling test: every axiom in `DEFAULT_ANALYZERS` must have an explicit
  `AXIOM_CATEGORY` label — registering an analyzer without one would print
  "uncategorized".

### Fixed
- Epic 1 follow-up review remediation: fixed all 29 retained findings across
  boundaries/contracts, adapter/analyzer precision, timeout and cache
  degradation, run identity/config/init truth, worktree/scope isolation,
  concurrent disposition resolution, and CI least privilege/immutable action
  references. Added focused regression tests and revalidated all 17 story
  records.
- Docs/README/rule-doc wording: "the ONE axiom that defaults to blocking"
  was false — `EFFECTIVE_DEFAULTS` makes EVERY axiom blocking by default;
  axiom 5's distinction is FR-32 naming it plus its error-dense rule set.

## [1.0.0] - 2026-04-16

### Added
- `/cleanup` — targeted cleanup pass on branch-changed files before a PR
- `/sweep` — full directory technical debt audit
- `/security-scan` — security and vulnerability scan with severity levels
- `/review` — uncommitted change review covering staged, unstaged, and untracked files
- `engineering-standards` skill — universal type safety, logging, tenant isolation, and testing standards
- Test fixtures in `tests/fixtures/` with known violations for each command
