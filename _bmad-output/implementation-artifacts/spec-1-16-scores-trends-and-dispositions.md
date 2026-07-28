---
title: 'Story 1.16: Scores, Trends, and Dispositions'
type: 'feature'
created: '2026-07-28'
status: 'done'
baseline_revision: d79c21d0f52dbcfa6ee5a5b0d5eb08f04a7b7a2f
final_revision: ''
review_loop_iteration: 0
followup_review_recommended: true # AUTO-FORCED: four HIGH inline findings (denominator counting the engine's own committed output; delta unreachable for ref scopes; torn-tail repair deleting a valid record; prototype-key answers writing schema-invalid committed records) + accepted OVERSIZED flag
context: []
warnings:
  - 'OVERSIZED: scoring + KLOC measurement + an append-only history plane + ancestry-ordered trend aggregation + a per-finding disposition loop + a self-contained HTML view + retention. Elevated review posture from the start (OVERSIZED-STORY).'
  - 'UNCONFIRMED DECISION: the changed-KLOC edge rule (added + deleted lines, floored at 0.1) is marked "confirm with the OD-1 owner at story time" in epics.md:705. No owner is reachable in an unattended run. Implemented as proposed under the AC''s own escape hatch — the formula is version-stamped so it can evolve — and called out in the Auto Run Result.'
---

<intent-contract>

## Intent

**Problem:** Every review produces severity counts and then forgets them. There is no score, no history plane, no delta, no disposition record — so FR-14/15 have no data and DR-1's trust metrics (the M1 gate's "≥70% dispositioned actionable" and the "<30% not-actionable" noise counter-metric) have no source. Two contracts (`trendRecord`, `dispositionRecord`) shipped in 1.2 and have never been written by anything.

**Approach:** Measure change size from git, derive a versioned score from the counts already computed, append one trend record per run to a committed `history/trends.jsonl`, aggregate it ordered by commit ancestry to produce the per-axiom delta, add a per-finding DR-1 disposition loop writing `history/dispositions.jsonl`, and render both through a self-contained `guardrails trends` HTML view.

## Boundaries & Constraints

**Always:**

*Scoring — raw counts stored, score derived (FR-14).*
- The artifact stores RAW per-axiom severity counts plus `changedKloc`. The score is a DERIVED view computed by a versioned formula, so a formula change never poisons history and historical scores stay recomputable. This is FR-14's whole point and is not negotiable.
- OD-1 formula v1: `100 − (10·E + 3·W + 1·I) / changedKloc`, floored at 0, stamped with its formula version everywhere it is rendered or persisted.
- `changedKloc` = (added + deleted lines) / 1000, floored at 0.1 so tiny and deletion-only diffs stay finite. **This edge rule is unconfirmed** (epics.md:705 says "confirm with the OD-1 owner at story time"); it is implemented as proposed, and the version stamp is the mechanism by which it can change. Say so in the docs — never present it as settled.
- **Determinism of the score:** the arithmetic must serialize identically on every platform. Compute and round through integer arithmetic to a pinned precision (one decimal); never let a raw IEEE double reach `JSON.stringify`. A test must pin exact expected values, not approximate ones.
- **`--project` has no changed-KLOC by construction** — it is not a diff. For that scope, record the counts, OMIT the score, and declare why. Never fabricate a denominator, never emit a score of 0 or 100 that means "undefined".

*Change-size measurement — the primitive that does not exist.*
- Add a `--numstat -z` helper to `core/git` alongside `diffRefs`. Its `-z` format differs from `--name-status` (`<add>\t<del>\t\0<path>\0`, with renames emitting an extra path token) — write a real parser, do not reuse `parseNameStatusZ`.
- Binary files report `-`/`-` in numstat: they contribute 0 lines and are declared, never counted as 0 silently when they were genuinely part of the change.
- Per scope: ref scopes measure `mergeBase..ref`; the `uncommitted` scope measures `diff --numstat HEAD` plus untracked files counted as all-added (matching how the change set itself is built).

*The history plane — committed, append-only.*
- `history/trends.jsonl` and `history/dispositions.jsonl` under `_agentic-guardrails/`, both COMMITTED. `init` seeds the directory; the existing `.gitattributes` `history/*.jsonl merge=union` line (wired forward in 1.8) is what makes concurrent branches merge without conflict.
- **The dogfood blocker, resolved:** this repo's ROOT `.gitignore` ignores `_agentic-guardrails/` wholesale, so nothing under it can ever be committed and the M1 gate would have no data source. Narrow that root ignore to exactly the generated layers (`_agentic-guardrails/reviews/`, `_agentic-guardrails/.cache/`, `_agentic-guardrails/config.schema.json`) so the committed layer is committable. Same class of conflict as 1.15's gitignored-`reviews/`-vs-commit-disposition, one level up.
- **No JSONL append primitive exists, and `ensureLines` is a trap** — it dedupes by line content and would silently drop a legitimately repeated record, and it rewrites the whole file per append. Write a real `appendJsonl`: atomic per the AC, and tolerant of a torn trailing record from a killed process (read-repair, declared — a corrupt tail must never make the whole store unreadable).
- Writes are idempotent: re-running an identical review must not append a second record. The writer skips an already-present `recordId`; the aggregator dedupes on it too. Both halves, not one.

*Trend record shape — two shipped-contract conflicts resolved here.*
- The architecture defines `recordId` as a content hash of `{run-id, axiom, scoreKind}` — one record per axiom per run — but the SHIPPED `trendRecordSchema` is one record per run carrying all axioms in a map, which cannot express that. Zero records exist anywhere, so fix it now: keep the one-record-per-run shape (one append per run, `merge=union`-friendly) and restate `recordId` as a content hash of the record's identifying inputs. `scoreKind` is dropped — it appears nowhere in the code and is undefined in every artifact, and since the score is a derived view (FR-14) there is no score *kind* to record.
- The shipped record stores neither scope kind nor branch, so FR-15's primary delta rule ("previous run of the same scope type on the same branch") is unimplementable from it. Add `scopeKind`. Do NOT add a branch field: branch names are not durable (renamed, deleted, reused), so ancestry is the honest ordering. The delta rule becomes: **the previous record of the same `scopeKind` whose `commitSha` is the nearest ancestor of HEAD** — the AC's primary and fallback rules collapsed into the one that is actually sound. State this deviation and its reason in the docs.
- `commitSha` for the `uncommitted` scope is `headSha()`, so two different working-tree states share one sha — ancestry cannot separate them, and `recordId` is the tiebreak. Say so rather than pretending the ordering is total.

*Ancestry ordering — also missing.*
- `core/git` has `mergeBase` and nothing else for ancestry. Add what the aggregator needs: an `--is-ancestor` wrapper (its exit-1 "not an ancestor" is a NEGATIVE ANSWER, not an error — `git()` turns non-zero into a failure today, so this needs a dedicated exit-status-reading helper) and whatever topological ordering the delta lookup requires.
- Records naming a sha that is no longer in the repo (rebased, gc'd, or from another clone) must be skipped and declared, never silently dropped and never fatal.

*Validate before trust, cold-start on invalid.*
- Every line read from history is untrusted input parsed through its Zod schema. An invalid line is skipped and declared. If the store as a whole cannot be trusted, the aggregator COLD-STARTS (no delta, declared) rather than reporting a wrong delta. A missing history file is a normal first run, not a degradation.

*The delta is report-only — determinism.*
- FR-15's PRD wording says the delta is reported "in the review artifact", but the artifact is asserted byte-identical for identical inputs at three test sites, and a delta depends on prior history — the same inputs would produce different bytes on a second run. **The delta is rendered in the REPORT and never written to the artifact.** The score and raw counts DO go in the artifact (pure functions of the run's own inputs). This is the surviving reading; record it as a deviation.
- Nothing derived from `manifest.cache` may enter a trend record — it is the one field normalized out of byte comparisons precisely because it is not run-identity.

*Dispositions — DR-1.*
- Pinned enum, exactly as shipped: `actionable | not-actionable | deferred`. No new values.
- Keyed `{runId, findingId}`. `findingId` is already stable across runs (`sha256([axiom, ruleId, file, enclosingSymbol])`, no line numbers), which is what makes dispositions survive line drift.
- Recorded **independently of whether the review artifact was committed or dropped** — the 1.15 artifact disposition and the DR-1 finding disposition are different things and must not be coupled.
- The prompt loop follows `disposition.ts`'s shape verbatim: non-interactive short-circuits BEFORE touching readline, `eofSafeIo` for EOF safety, SIGINT closes the interface so it settles through the EOF default, returns `lines: string[]` rather than writing to a stream, and NEVER affects the exit code.
- `--no-input`, a pipe, or a non-TTY must never block — interactivity is the existing three-way guard (flag + both TTYs). Non-interactive handling follows configured policy; the default policy must be the one that records nothing rather than one that fabricates a disposition nobody made.

*`guardrails trends [--open]`.*
- Fully self-contained HTML to `.cache/trends.html`: data inlined, vanilla JS, inline CSS, no CDN, no network, no dependency.
- Inlined data becomes `<script>` content, so it needs HTML/script-context escaping — which is a DIFFERENT function from `sanitizeMessage` (a control-character filter). Both are needed; do not conflate them. A finding message or a ref name must not be able to close a script tag.
- `--open` shells the platform opener and is NEVER fatal — a failure prints the path and exits normally.

*Retention.*
- The AC says "more than 100 run manifests under `manifests/` are pruned to the newest 100 (config-overridable)". **`manifests/` does not exist** — manifests are embedded in the review artifact under the gitignored `reviews/<scope>/`. Rather than invent a new committed per-run store that nothing consumes (and that 1.4 and 1.15 deliberately did not build), apply the retention to the per-run store that actually exists, `reviews/<scope>/`, and keep the AC's real guarantee intact: **committed history is never pruned.** Ledger the "architecture mandates a committed `manifests/` store" question for Epic 4, which owns institutional memory. Record this as a deviation from architecture.md:316-317/349/672.
- Ordering for the prune must not be mtime alone where a deterministic tiebreak is available; follow `deterministic-cache.ts`'s existing prune shape.

*Config plane.*
- `configSchema` is strict, so new keys must be added there or every config carrying them fails to parse. The retention limit and the disposition policy become optional keys with entries in the effective-defaults layer, and `computeDeviations` must learn them or FR-31 transparency silently regresses.

**Block If:**
- Making the delta work requires writing history-dependent data into the review artifact — that breaks the byte-identity invariant three tests assert, and needs a human ruling rather than a quietly relaxed test.
- Narrowing the root `.gitignore` turns out to expose something that genuinely must stay ignored — stop and report rather than committing repo state nobody asked for.

**Never:** No LLM. No network. No new dependencies (the HTML view is hand-written; no charting library). No new disposition enum values. No finding-disposition state machine beyond append-only records (carry-forward across `findingId` reappearances is 1.17's decision, explicitly). No pruning of committed history, ever. No score for a scope with no defined denominator.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal run | findings across axioms | raw counts + `changedKloc` + score (v1-stamped) on the artifact; score in the report | — |
| Deletion-only diff | only deletions | KLOC floor 0.1 applies; score finite | never divide by zero |
| Tiny diff | 1 changed line | floor 0.1 applies | score never exceeds its floor of 0 |
| Zero findings | clean run | score 100 | — |
| Overwhelming findings | counts exceed 100·KLOC | score floors at 0, never negative | — |
| `--project` scope | whole project | counts recorded, score OMITTED and declared | never a fabricated denominator |
| Binary file changed | numstat reports `-`/`-` | contributes 0 lines, declared | never silently 0 |
| First ever run | no history file | record appended; no delta; NOT a degradation | — |
| Second run, same scope kind | prior record is an ancestor | per-axiom delta in the REPORT only | — |
| Identical re-run | same runId | no duplicate record appended | idempotent |
| History has a torn last line | killed mid-append | tail repaired/skipped and declared; store still usable | never fatal |
| History line fails schema | hand-edited/corrupt | line skipped and declared | validate before trust |
| History wholly untrustworthy | many invalid lines | cold-start: no delta, declared | never a wrong delta |
| Record names a missing sha | rebased or gc'd | skipped and declared | never fatal |
| Two records, same commitSha | two uncommitted-scope runs | `recordId` tiebreak; ordering limits stated | never a silent arbitrary pick |
| Disposition, interactive | user answers per finding | records appended keyed `{runId, findingId}` | exit code unaffected |
| Disposition, `--no-input`/pipe/non-TTY | any | never blocks; configured policy | default records nothing |
| Disposition, EOF / Ctrl-C | stdin closed | settles through the EOF default | exit contract preserved |
| Artifact dropped, findings dispositioned | drop chosen in 1.15's prompt | dispositions still recorded | the two are independent |
| `guardrails trends` | history present | self-contained HTML at `.cache/trends.html` | no network, no CDN |
| `guardrails trends`, no history | first run | renders an honest empty state | never a crash |
| Hostile content in history | ref/message containing `</script>` | escaped for script context | cannot break out |
| `--open` fails | no opener on PATH | path printed, exit unchanged | never fatal |
| >100 artifacts in a scope dir | many runs | pruned to newest 100 (config-overridable) | committed history untouched |

</intent-contract>

## Code Map

- `packages/contracts/src/trend-record.ts` -- shipped, never written; gains `scopeKind`, loses the unimplementable `recordId` definition (zero records exist, so this is free)
- `packages/contracts/src/disposition-record.ts` -- shipped, never written; pinned DR-1 enum `actionable | not-actionable | deferred`
- `packages/contracts/src/finding-id.ts` -- `computeFindingId` = `sha256([axiom, ruleId, file, enclosingSymbol])`, no line numbers — the stable disposition key
- `packages/contracts/src/review-artifact.ts` -- new optional counts/score block, following the `gate` precedent (optional so pre-1.16 artifacts still parse)
- `packages/contracts/src/config.ts` + `packages/core/src/config/config-loader.ts` -- strict schema, `EFFECTIVE_DEFAULTS`, `computeDeviations` (must learn new keys or FR-31 regresses)
- `packages/core/src/git/git.ts` -- has `mergeBase`, `diffRefs`, `parseNameStatusZ`; MISSING `--numstat`, `--is-ancestor` (exit 1 is an answer, not an error), and any topological ordering
- `packages/core/src/persistence/artifact-writer.ts` -- `writeFileAtomic` (reuse), `ensureLines` (do NOT reuse for JSONL), `SEEDED_IGNORE_LINES`
- `packages/core/src/persistence/deterministic-cache.ts` -- `prune()` newest-first with filename tiebreak, `CACHE_MAX_ENTRIES_PER_KIND` — the retention shape to follow
- `packages/core/src/init/init.ts` + `init/wiring.ts` -- what init seeds; the `history/*.jsonl merge=union` line already wired forward in 1.8
- `packages/core/src/pipeline/pipeline.ts` -- `computeRunId` (no wall clock), the byte-identity invariant, artifact composition
- `packages/core/src/pipeline/normalize-cache-truth.ts` -- `manifest.cache` is the ONLY field allowed to differ between identical runs
- `packages/cli/src/review-command.ts` -- `formatSummary`, `severityCounts()` (already computes the E/W/I numerator), `degradationText` (exported), `sanitizeMessage` (NOT exported)
- `packages/cli/src/disposition.ts` -- the 1.15 artifact-disposition prompt: the structural template (non-interactive short-circuit, `eofSafeIo`, SIGINT, `lines[]` return, exit-code independence)
- `packages/cli/src/index.ts` -- two commands today; `trends` is a third
- ROOT `.gitignore` -- ignores `_agentic-guardrails/` wholesale; must be narrowed or the committed history plane is unreachable

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src` -- `trendRecord` gains `scopeKind` + a implementable `recordId`; artifact counts/score block; config keys for retention + disposition policy; golden fixtures updated -- contract first
- [x] `packages/core/src/git/git.ts` -- `--numstat -z` helper + its own parser (renames, binary `-`/`-`), an `--is-ancestor` wrapper reading exit status as an ANSWER, and the ordering primitive the aggregator needs -- the missing measurement and ancestry primitives
- [x] `packages/core/src/persistence/history.ts` (new) -- `appendJsonl` (atomic, idempotent on `recordId`, torn-tail read-repair) + validate-before-trust reader -- the history plane
- [x] `packages/core/src/report/score.ts` (new) -- OD-1 v1, integer-rounded, version-stamped, undefined for `--project` -- the derived view
- [x] `packages/core/src/report/trends.ts` (new) -- ancestry-ordered aggregation, `recordId` dedupe, cold-start on invalid, per-axiom delta -- FR-15
- [x] `packages/core/src/pipeline/pipeline.ts` + `init/init.ts` -- counts/score on the artifact, trend append, `history/` seeding, retention over `reviews/<scope>/` -- wiring
- [x] `packages/cli/src/finding-disposition.ts` (new) + `review-command.ts` -- the DR-1 loop reusing `disposition.ts`'s shape; score line and per-axiom delta in `formatSummary` -- DR-1 + the report
- [x] `packages/cli/src/trends-command.ts` (new) + `index.ts` -- `guardrails trends [--open]`, self-contained HTML with script-context escaping, non-fatal `--open` -- the view
- [x] ROOT `.gitignore` narrowed to the generated layers -- unblocks the committed history plane and the M1 gate
- [x] Unit + e2e tests across all of the above; `CHANGELOG.md`, `README.md`, `docs/`, `tests/e2e-coverage.md` -- DoD

**Acceptance Criteria:**
- Given a completed review, when the artifact is composed, then per-axiom severity counts and `changedKloc` are recorded raw and the derived OD-1 v1 score is rendered in the report with its formula version — floored at 0, finite for deletion-only and tiny diffs, and OMITTED with a declared reason for `--project`.
- Given a previous run of the same scope kind whose commit is the nearest ancestor of HEAD, when the report renders, then the per-axiom delta appears alongside current findings — in the report only, never in the artifact, so byte-identity for identical inputs still holds.
- Given run completion, when a trend record appends to `history/trends.jsonl`, then the write is atomic, the record carries `recordId` + `commitSha` + `scopeKind`, an identical re-run appends nothing, and the aggregator dedupes on `recordId`, orders by commit ancestry, validates before trust, and cold-starts on invalid history.
- Given the user dispositions findings post-run, when dispositions are recorded, then they append to the committed `history/dispositions.jsonl` keyed `{runId, findingId}` using the pinned enum, independently of whether the review artifact was committed or dropped.
- Given `--no-input`, a pipe, or a non-TTY, when a review runs, then no prompt ever blocks and non-interactive handling follows configured policy.
- Given `guardrails trends [--open]`, when invoked, then a fully self-contained HTML view (inlined data, vanilla JS, inline CSS, no CDN, no network) renders to `.cache/trends.html`, hostile content cannot break out of script context, and a failing `--open` is never fatal.
- Given more than 100 per-run artifacts in a scope directory, when a run completes, then they are pruned to the newest 100 (config-overridable) and committed history is never pruned.
- Given this repository, when the history plane is exercised, then `_agentic-guardrails/history/*.jsonl` is actually committable — the root `.gitignore` no longer swallows the committed layer.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test`, when run, then all green.

## Spec Change Log

- **`changedKloc` became the INTEGER `changedKlocMilli`** on both the trend
  record and the new artifact `scores` block, and the score is persisted as the
  integer `scoreTenths`. The contract's binding rule is "never let a raw IEEE
  double reach `JSON.stringify`"; the shipped `trendRecordSchema` had
  `changedKloc: z.number()`, which is exactly such a double. Thousandths of a
  KLOC are *exactly* lines of change, so the unit costs nothing and the whole
  scoring path — measurement, floor, weights, rounding, storage — is integer
  arithmetic end to end. The decimal point is put back by string construction
  at render time (`formatScoreTenths`), never by float division. Free to
  change: zero trend records existed anywhere.
- **The trend record also gained `runId`.** The spec mandated `scopeKind` and a
  restated `recordId`; `runId` was added beyond that because it is the join key
  to `dispositionRecord` (whose key is `{runId, findingId}`) — DR-1's trust
  metrics need to relate a run's dispositions to that run's counts — and
  because it is what distinguishes two `uncommitted`-scope runs that share one
  `commitSha` but reviewed different working-tree states. Without it, two such
  runs with coincidentally equal counts would collapse into one record.
- **`scopeKind` is single-sourced in contracts as `scopeKindSchema`**
  (`run-manifest.ts`), and `core`'s `ScopeKind` type is now re-exported from
  it rather than declared a second time in `pipeline/scope.ts`. The manifest's
  scope block already declared the same four-value enum inline; a fifth scope
  landing in one place and not the other would have been a silent parse
  failure.
- **The disposition record's `recordId` hashes the ANSWER, not just the key.**
  Keying only on `{runId, findingId}` would make a *corrected* disposition
  collide with the original and be SKIPPED by the idempotent writer — the
  correction silently lost. Hashing the answer means a re-answer that matches
  appends nothing, a changed one appends a second record, and the reader takes
  the last for a key. Append-only, no lost edits, no state machine (carry-
  forward remains 1.17's decision).
- **Cold-start threshold pinned at "more than half the lines unusable."** The
  contract says "if the store as a whole cannot be trusted"; that needed a
  number. One corrupt line among healthy ones is skipped and declared (the
  matrix's "History line fails schema" row); a majority of unusable lines is
  the "History wholly untrustworthy" row and cold-starts.
- **The ancestry scan is capped at the newest 200 same-scope records**
  (`ANCESTRY_SCAN_LIMIT`), and the cap is DECLARED when it bites. History grows
  without bound by design and every candidate costs a `merge-base` spawn;
  an unbounded scan would make a long-lived repo's every review pay for its
  whole history. Marked `ponytail:` with the upgrade path (one `rev-list` walk
  instead of a pairwise scan).
- **Two NEW exit-neutral declarations on the change-size plane**, both in
  `declaredOnly` (they describe the score's PRECISION, not lost analysis
  coverage): `score-change-size` when git reports no line counts for a file
  (binary, or a count it did not write as an integer), and the same subject
  when the range could not be measured at all — in which case the denominator
  falls back to its 0.1 floor rather than failing the review, since the
  numerator is still real.
- **The `trends` HTML charts records in APPEND order, not ancestry order**,
  and the page says so in its own subtitle. Ancestry ordering costs one
  `merge-base` spawn per record, which is right for comparing two records and
  wrong for painting hundreds. Marked `ponytail:` with the upgrade path.
- **`writeReviewArtifact` gained an optional `maxEntries`**; retention is
  therefore opt-in at the call site, with the CLI passing the config-plane
  value. Omitting it prunes nothing, so no existing caller changed behaviour.
- **`formatSummary` gained an optional fourth parameter** (the aggregation) and
  a `writeDispositionLines` helper was extracted in `review-command.ts` so the
  two disposition surfaces share one routing rule and one sanitizer. No
  existing test signature changed.
- **`git()` was refactored to share a `spawnGit` core with a new
  `gitExitStatus`.** The contract forbids papering over `--is-ancestor`'s
  exit 1; a second spawn site would have been free to forget the timeout, the
  buffer ceiling, `shell: false` or `GIT_TERMINAL_PROMPT=0`, so both paths now
  go through one spawn.
- **`init` seeds both history files EMPTY rather than only the directory.** Git
  tracks files, not directories: an empty `history/` would vanish from every
  clone and the `history/*.jsonl merge=union` attribute would have nothing to
  apply to. An empty file is a valid store with zero records. Two entries were
  added to `init`'s created/kept report, and its two list assertions updated.
- **Root `.gitignore` narrowing, verified.** `git status` and `git check-ignore`
  confirm the narrowing exposes exactly one previously-hidden path in this
  repository — `_agentic-guardrails/.gitignore`, which is part of the committed
  wiring layer `init` owns — while `reviews/`, `.cache/` and
  `config.schema.json` stay ignored. Nothing unexpected surfaced, so the
  Block-If did not trigger.

### Adversarial-review pass (all items triaged PATCH)

- **`ChangeSize` became per-path.** `parseNumstatZ` now returns
  `files: {path, added, deleted}[]` with no pre-summed total, and
  `changedLinesIn(size, include)` — whose predicate is REQUIRED — is the only
  summing path. The exclusion the contract mandates ("`_agentic-guardrails/`
  is excluded here too") was structurally impossible while the parser returned
  only totals: every run appends a line to the committed
  `history/trends.jsonl`, so the denominator grew monotonically and raised
  every later score.
- **The FR-15 ancestry query asks about the REVIEWED commit**, not the
  invoking HEAD. The contract's delta rule says "nearest ancestor of HEAD";
  the record stores `reviewedSha`, so the query has to name the same commit or
  a `--branch`/`--pr` review from another head can never match. Restated in
  the docs.
- **`appendJsonl` gained a schema parameter** and refuses to write a record
  that fails it. The contract says "validate before trust" of the READER; the
  writer is the last place that can refuse to put an unparseable line into a
  committed, merged, shared store, so it validates too.
- **"Torn" is redefined as UNPARSEABLE, not unterminated.** The reader already
  returned a newline-less final record as good; the repair truncated it.
  A parseable tail now gets its newline back.
- **`dispositionRecord` gained `revision`,** hashed into the id, and a
  `appendDispositions` helper in `core/persistence/history.ts` owns the
  "latest wins" rule. The Spec Change Log's earlier entry (hash the ANSWER)
  fixed corrections and broke REVERTS; both halves are needed.
- **Both record schemas verify `recordId` as a content address.** The store is
  committed and `merge=union`'d from other clones and the tiebreak is "highest
  id wins", so an unverified id was attacker-chosen text. The two golden
  fixtures now carry their real content addresses.
- **`reviewScores` made `changedLines`/`changedKlocMilli` optional** and moved
  the score/reason exclusivity from a comment into two schema refinements. The
  contract's "never fabricate a denominator" was being satisfied only for the
  score; `changedKlocMilliOf(0) === 100` was still persisted for `--project`.
  The trend record's `changedKlocMilli` is optional for the same reason.
- **`od1ScoreTenths` applies the KLOC floor itself.** The matrix's "never
  divide by zero" cannot be guaranteed at a call site that takes the
  denominator from a `z.int().min(0)` field on an untrusted record.
- **An unborn repository records NO trend record**, declared. `headSha()`'s
  empty-TREE sentinel is not a commit, so `commitExists` rejects it forever.
- **`sanitizeMessage` moved to `packages/cli/src/sanitize.ts`** so
  `trends-command.ts` and the disposition prompt use the same rule as the
  report without a `review-command` ⇄ `finding-disposition` import cycle.
- **`--open` uses `explorer.exe` on Windows,** never `cmd /c start`, and
  `openerFor(platform, target)` is exported so the "no command-line
  re-parser" property is asserted directly rather than by spawning a browser.
  `explorer.exe` exits 1 on success, so only a spawn failure counts there —
  `--open` is non-fatal either way.
- **`pruneScopeDir` gained a stat seam** (defaulted) so "an entry vanished
  between `readdir` and `stat`" is a test rather than a race.

## Review Triage Log

### 2026-07-28 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 20: (high 4, medium 11, low 5)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` The OD-1 denominator counted the engine's own output, including the history plane this very story commits. `changedLines` was the whole-diff total and the `_agentic-guardrails/` filter was applied only to the binary and untracked lists — never to the counted lines — because the numstat parser returned no per-path breakdown to filter on, so the exclusion its own doc comment promised was structurally impossible. Every run appends a line to the committed `history/trends.jsonl`, so run N+1 counted it: the denominator inflated monotonically, raising every later score, and worst exactly where the 0.1 floor matters. Root-caused rather than patched at the call sites — `parseNumstatZ` now returns per-path counts with NO pre-summed total, and `changedLinesIn(size, predicate)` with a REQUIRED predicate is the only summing path, so no caller can sum unfiltered by accident.
  - `[high]` `[patch]` The FR-15 delta could never fire for `--branch` or `--pr` unless the invoker happened to be standing on the reviewed branch: the record stored the ref's tip as `commitSha` while the aggregator was handed the INVOKING repo's HEAD, so the ancestry test was false in the normal case and only became true once the ref was merged — after the delta stops being useful. Two of four scopes could not produce the feature the story exists for. The query now names the same commit the record stores; the e2e reviews `feature~1` then `feature` while standing on `main` and was red before the fix.
  - `[high]` `[patch]` The torn-tail repair DELETED a valid record. It truncated whenever the file lacked a trailing newline without checking whether that last line parsed, while the reader parsed it fine and returned it — the two halves disagreed. Any tool, patch, or hand-edit that omits the final newline silently lost that record on the next append, while the CLI printed "torn final record … repaired", asserting the opposite of what happened. Because this is COMMITTED history, the loss propagated to every clone. Repair now triggers only on a genuine parse failure; a parseable tail gets its newline back.
  - `[high]` `[patch]` A prompt answer of `__proto__` or `constructor` wrote schema-invalid records into committed history while the CLI reported success — the answer table was a plain object literal, so prototype keys resolved and the `undefined` guard never fired, producing one record with the `disposition` key dropped entirely and one with `"disposition":{}`, both of which fail their schema on every later read and, two in a small store, trip the >50% untrustworthy ratio and cold-start the whole aggregation. Fixed on BOTH halves: the lookup is a `Map`, and `appendJsonl` now takes a required schema and `safeParse`-gates every record, so no unvalidated record can reach committed, merged, shared state.
  - `[medium]` `[patch]` `guardrails trends --open` was a command injection on Windows. `shell: false` stops Node invoking a shell, but the child WAS `cmd.exe`, which re-parses its own command line, and Node quotes only arguments containing spaces or quotes — so a bare `&` passed straight through. Verified directly on Node 24 rather than taken from either reviewer (they contradicted each other on this point, and the confident refutation was the wrong one): `spawnSync("cmd", ["/c","echo", String.raw`C:\a&calc\x.html`])` prints `C:\a` and exits 1. A repo cloned under a path containing `&` executed arbitrary commands on a benign flag. Now `explorer.exe` with the path as one argument — a plain executable, no command-line re-parser.
  - `[medium]` `[patch]` "Latest wins" was wrong in exactly the case answer-hashing was introduced to fix: because the id hashed the ANSWER, reverting to a previous answer recomputed an already-present id and was skipped, so `actionable → not-actionable → actionable` left the store reporting `not-actionable`. A `revision` field now participates in the id and `appendDispositions` owns the rule (unchanged answer skipped, changed answer increments).
  - `[medium]` `[patch]` The ancestry scan cap cried wolf on every idempotent re-run — the check compared a pre-filter count against a post-filter one, so it fired on a TWO-record store. The cap's entire justification is that it is declared when it bites; a declaration firing on ordinary re-runs makes the real one unreadable. Both sides now post-filter, with tests for both the false positive and a genuine 205-record bite.
  - `[medium]` `[patch]` `appendJsonl` was not the atomic, idempotent primitive the AC claimed: `writeSync`'s return value was ignored (Node does not loop on short writes, so a partial write left a torn record and still reported success), idempotency was a read-then-append TOCTOU while the docstring claimed a concurrent process "cannot interleave", and the repair went through a temp+rename that orphans the inode a concurrent append handle is writing into. Short writes are now looped, the repair truncates in place, and the docstring states exactly what holds rather than what was hoped.
  - `[medium]` `[patch]` One hostile but schema-VALID history line produced a WRONG delta rather than a cold start: `recordId` was trusted rather than verified, so a hand-written or merge-imported record with `commitSha == HEAD` and an all-`f` id won the tiebreak over every genuine record and became the delta baseline. Both schemas now refine that the id IS the content address, so every reader gets the check.
  - `[medium]` `[patch]` Duplicate records within a single batch — the id scan checked only what was already in the FILE, never within the batch, while two distinct findings can legitimately share a `findingId` (the same rule firing twice on one symbol). Deduped in-batch on both the generic and disposition paths.
  - `[medium]` `[patch]` Untrusted history text reached the terminal unsanitized in `guardrails trends` while the review command routes every equivalent through `sanitizeMessage` — Zod declarations embed attacker-controlled text (axiom-map keys appear in the issue path; a strict-object violation names the offending key verbatim), so a merged line with an ANSI payload as an axiom key wrote escapes straight to stderr. `sanitizeMessage` extracted to its own module (avoiding an import cycle) and applied to all four writes.
  - `[medium]` `[patch]` The score renderer divided by a record-supplied denominator the schema permits to be zero, yielding `Infinity` → `0.0`, or `NaN` → serialized `null` → rendered as an em-dash indistinguishable from the deliberate "project scope has no score". The floor is now applied inside the score function itself.
  - `[medium]` `[patch]` The disposition prompt interpolated a finding's path and rule id raw while the summary sanitizes finding text — now sanitized.
  - `[medium]` `[patch]` `--project` persisted a FABRICATED denominator: the KLOC value was computed unconditionally through the 0.1 floor and written into the artifact's scores block even though the score itself was correctly omitted, so the artifact claimed "0.1 KLOC of change" for a scope the contract says has no changed-KLOC by construction. The denominator is now computed only when the scope is scorable, and the schema made it optional.
  - `[medium]` `[patch]` An unborn/HEAD-less repository recorded the empty-tree sentinel as `commitSha`, which passes the schema but fails the commit-existence probe — so every such record was permanently declared "names a commit no longer in this repository", and enough of them trip the cold-start. The trend append is now skipped with a typed reason.
  - `[low]` `[patch]` The cold-start ratio counted legitimately-deduped duplicate lines as "unusable", so a healthy store with duplicates could falsely cold-start claiming N of M lines were unusable — `skipped` is now a first-class field counting only DECLARED lines.
  - `[low]` `[patch]` Retention was all-or-nothing: the stat calls sat inside one `try`, so a single entry vanishing between the directory read and its stat (a concurrent run, antivirus) threw and skipped the ENTIRE prune silently while the store kept growing. Per-entry now, with a seam so the vanishing-entry case is testable.
  - `[low]` `[patch]` The score/omitted-reason mutual exclusivity was asserted in a comment while both fields were plain optionals, so an artifact carrying both or neither parsed. Enforced in the schema, along with "a score requires its denominator".
  - `[low]` `[patch]` Untested paths given coverage so a regression fails: the change-size measurement-failure degradation (branch, reason text and exit-neutrality all previously unasserted), `--open` (which appeared in NO test at all), the `trends` command's exit-2 paths (only exit 0 was ever asserted for the new command), retention at exactly 100/101 and rejection of `0`/`-1`/`1.5`, the prune ignoring non-JSON and in-flight temp entries, numstat paths with spaces/tabs/quotes/non-ASCII, exact-half rounding ties, whitespace-only and wrong-record-type history lines, the scan cap genuinely biting with the true nearest ancestor surviving, the SIGINT handler BODY executing (only listener registration was asserted, so a regression to readline's exit 130 would have shipped green), and a real deletion-only diff end to end.
  - `[low]` `[patch]` Three tests that passed with the feature weakened: "keeps the delta OUT of the artifact" asserted only that the string "delta" was absent, so it passed if the delta were written under any other key — now pins the artifact's and scores block's key sets; the retention test asserted only a survivor COUNT and never that the artifact this run wrote was among them.

No findings were deferred or rejected; nothing was refuted.


## Auto Run Result

- **Summary:** Every review now feeds the longitudinal memory. Raw per-axiom severity counts and a change-size denominator land on the artifact; the OD-1 score is a DERIVED, version-stamped view (FR-14) held to integer arithmetic end to end so no IEEE double ever reaches the serialized bytes. One trend record per run appends to a COMMITTED `history/trends.jsonl`, aggregated in commit-ancestry order to produce the per-axiom delta — rendered in the report and deliberately never in the artifact, because a history-dependent field would break the byte-identity invariant three tests assert. A DR-1 per-finding disposition loop writes `history/dispositions.jsonl` keyed `{runId, findingId}`, independent of whether the review artifact was committed or dropped. `guardrails trends [--open]` renders a self-contained HTML view with no network, no CDN, and no `innerHTML`. Per-run artifacts prune to the newest 100; committed history never prunes. Review pass applied 20 patches (4 high).
- **Files changed:** `packages/contracts/src/trend-record.ts`, `disposition-record.ts`, `review-artifact.ts`, `run-manifest.ts`, `config.ts`, golden fixtures, `index.test.ts`; `packages/core/src/persistence/history.ts` (new), `report/score.ts` + `report/trends.ts` (new), `git/git.ts` (per-path numstat, `isAncestor`, `gitExitStatus`), `pipeline/pipeline.ts`, `pipeline/scope.ts`, `persistence/artifact-writer.ts`, `config/config-loader.ts`, `init/init.ts`, `index.ts`; `packages/cli/src/finding-disposition.ts` (new), `trends-command.ts` (new), `sanitize.ts` (new), `review-command.ts`, `index.ts`; `docs/scores-trends-and-dispositions.md` (new), `README.md`, `CHANGELOG.md`, `tests/e2e-coverage.md`; ROOT `.gitignore` narrowed; 8 new test files incl. `tests/integration/trends-and-dispositions.e2e.test.ts`.
- **Review findings breakdown:** 20 patched (4 high, 11 medium, 5 low), 0 deferred, 0 rejected, 0 intent_gap, 0 bad_spec. Nothing refuted.
- **Follow-up review recommendation:** true — auto-forced by four HIGH inline findings (FOLLOW-UP-REVIEW AUTO-FORCE ON HIGH) and the accepted OVERSIZED flag.
- **Verification:** `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:boundaries`, `pnpm -r build`, `pnpm -r test` (59 contracts + 526 core + 48 cli), `pnpm test` (44 files / 759 tests) — all green after patches, re-run independently rather than taken on the implementer's word. The three pre-existing artifact byte-identity assertions are unmodified and still pass.
- **Nine contract conflicts resolved in the spec and implemented:** the non-existent `manifests/` retention target (applied to the per-run store that exists; the architecture's committed-manifests question ledgered for Epic 4); the shipped trend schema vs the architecture's unimplementable `recordId` (per-run shape kept, `scoreKind` dropped as undefined everywhere); FR-15's primary delta rule being unimplementable (added `scopeKind`, deliberately no branch field since branch names are not durable); the delta-vs-byte-determinism conflict (report-only); the root `.gitignore` swallowing the committed layer (narrowed — verified to expose only `_agentic-guardrails/.gitignore`); `ensureLines` being a trap for JSONL (a real append primitive); `--is-ancestor`'s exit 1 being an ANSWER not an error; script-context vs HTML vs control-character escaping being three different functions; and `--project` having no denominator by construction (counts recorded, score omitted and declared).
- **Residual risks:** The 0.1-KLOC floor remains UNRATIFIED — epics.md marks it "confirm with the OD-1 owner at story time" and no owner is reachable in an unattended run; it ships as proposed, version-stamped, and is documented as unsettled rather than agreed. `appendJsonl` idempotency is still read-then-append, so concurrent identical appends cost a duplicate line that readers dedupe (upgrade path: a lock). The ancestry scan is a pairwise `merge-base` walk capped at 200 candidates, declared when it bites (upgrade path: one `rev-list`). Id verification stops a chosen id, not a hand-written record with a correctly computed one — such a record still participates in ordering on its content alone. `explorer.exe`'s exit status is ignored, so a genuine open failure is silent (the path is already printed). The trends HTML charts in append order, not ancestry order, and says so on the page.
