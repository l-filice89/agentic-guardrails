# Scores, trends and dispositions (Story 1.16)

What every review run records, how the OD-1 score is derived from it, how the
per-axiom delta is found, and how findings are labelled for DR-1's trust
metrics.

## The committed history plane

```
_agentic-guardrails/
├── history/                     # COMMITTED — never pruned, ever
│   ├── trends.jsonl             #   one record per run
│   └── dispositions.jsonl       #   one record per {runId, findingId} judgement
└── .cache/trends.html           # gitignored — a regenerable VIEW
```

Both stores are append-only JSONL and carry `history/*.jsonl merge=union` (via
`_agentic-guardrails/.gitattributes`, written by `guardrails init`), so
concurrent branches union their records instead of conflicting. `init` seeds
both files empty — git tracks files, not directories, and an empty file is a
valid store with zero records.

Because union merge is line-based, every record carries a **content-addressed
`recordId`**. The writer skips an id already present and the aggregator dedupes
on it — both halves, so neither a duplicated append nor a unioned duplicate can
double-count a run. Reading is validate-before-trust: every line goes through
its Zod schema, and an invalid or torn line is **skipped and declared**, never
trusted and never fatal. A missing file is a normal first run, not a
degradation.

The schema **recomputes the id and rejects a record whose `recordId` is not its
own content address.** These files are committed, hand-editable and merged in
from other clones, and the aggregator's declared tiebreak is "highest
`recordId` wins" — so an unverified id would be attacker-chosen text, and one
hand-written line claiming `ffff…` would become the delta baseline. The writer
validates too: a record that fails its schema is refused rather than written,
because we are the last place that can still say no to a line every clone will
carry forever.

"Torn" means **unparseable**, not merely unterminated. A complete record that
lost only its trailing newline is a good record — the reader returns it — so
the repair gives it its newline back instead of truncating it away.

**What "atomic append" does and does not promise.** The payload is one
`open("a")` + looped `write()` + `fsync`, so a concurrent process cannot
interleave into the middle of a line and a short write cannot leave a torn one.
Idempotency, however, is a read-then-append: two processes appending the same
record at the same instant both write it. That is a duplicate *line* with an
identical `recordId`, which every reader dedupes on — a wasted line, never a
wrong answer.

## OD-1 v1: raw counts stored, score derived

The artifact records **raw** per-axiom severity counts plus the measured change
size. The score is a *derived view* stamped with the formula version that
produced it, so changing the formula re-derives history rather than poisoning
it.

```
score = 100 − (10·E + 3·W + 1·I) / changedKloc          floored at 0
changedKloc = (added + deleted lines) / 1000            floored at 0.1
```

> **The 0.1-KLOC floor is UNCONFIRMED.** `epics.md` marks it "confirm with the
> OD-1 owner at story time"; it shipped as proposed and has not been ratified.
> The `formulaVersion` stamp (`od-1-v1`) is precisely the mechanism by which it
> can change without invalidating anything already recorded. Do not read it as
> settled.

**Determinism.** The score has to serialize identically on every platform, so
the whole path is integer arithmetic and no raw IEEE double is ever handed to
`JSON.stringify`. The persisted fields are `changedKlocMilli` (thousandths of a
KLOC — which are exactly lines of change) and `scoreTenths` (the score × 10);
the decimal point is put back by string construction at render time.

**Change-size measurement** comes from `git diff --numstat -z` over the same
range the change set came from: `mergeBase..ref` for `--branch`/`--pr`, and
`diff --numstat HEAD` plus untracked-files-as-all-added for the uncommitted
scope. Binary files report `-`/`-` and contribute 0 lines — they are counted
and **declared**, never silently read as "no change".

`_agentic-guardrails/**` is excluded from the summed denominator, not just from
the change *set*: every run appends a line to the committed
`history/trends.jsonl`, so counting it would grow the denominator by one line
per run forever and quietly raise every later score.

**`--project` has no score, and no denominator either.** It is not a diff, so
it has no changed-KLOC by construction. The counts are recorded;
`changedLines`, `changedKlocMilli` and `scoreTenths` are all **absent** and
`scoreOmittedReason` says why. Omitting the score while still writing a floored
`changedKlocMilli` would claim "0.1 KLOC of change" for a scope that has none —
a fabricated denominator with extra steps. The schema enforces the pairing:
exactly one of `scoreTenths` / `scoreOmittedReason`, and a score only ever
beside the denominator it came from.

A repository with **no commits yet** records no trend record at all, and says
so. `HEAD` there resolves to the empty-*tree* sentinel, which is not a commit:
every such record would be permanently declared "names a commit no longer in
this repository".

## FR-15: the per-axiom delta

The delta is rendered in the **report only** and is never written to the
artifact.

> **Deviation from the PRD wording, declared.** FR-15 says the delta is
> reported "in the review artifact". The artifact is asserted byte-identical
> for identical inputs at three test sites, and a delta depends on prior
> history — the same inputs would produce different bytes on a second run.
> Writing it would break that invariant, so the delta lives in the report and
> the artifact keeps only what is a pure function of the run's own inputs.

**Ordering is git ancestry, not a branch name.** The AC's primary rule is "the
previous run of the same scope type on the same branch", with nearest ancestor
as a fallback. Branch names are renamed, deleted and reused, and the trend
record deliberately carries no branch field, so the two rules collapse into the
one that is sound: *the previous record of the same `scopeKind` whose
`commitSha` is the nearest ancestor of the commit this run **reviewed***.

The reviewed commit, not the invoking `HEAD`: `--branch`/`--pr` normally review
a ref you are not standing on, and asking about your own `HEAD` answers "not an
ancestor" for every record on that branch — the delta would only start working
after the branch was merged, i.e. once it had stopped being useful.

The resulting order is **partial, and says so**:

- Two `uncommitted`-scope runs share one `commitSha` (both are `HEAD`), so
  ancestry cannot separate them.
- Two ancestors of a merge commit can both be ancestors of HEAD without being
  ancestors of each other.

In both cases `recordId` is the declared tiebreak and the ambiguity is printed,
never silently resolved.

Records whose commit is no longer in the repository (rebased away, gc'd, or
written by another clone) are **skipped and declared**. If more than half the
store's lines are unusable, the aggregator **cold-starts** — no delta — rather
than reporting one computed from whatever survived. "Unusable" counts *declared*
skips only: a union-merged duplicate is deduped out of the results while being a
perfectly healthy line, and counting it would cold-start a healthy store.

The ancestry scan is capped at the newest 200 same-scope records and the cap is
declared **when it bites** — measured against the candidate set, so an ordinary
idempotent re-run does not announce a cap that did not apply.

## DR-1 finding dispositions

After a run, each finding can be labelled `actionable`, `not-actionable` or
`deferred` (the enum is pinned; nothing else parses). Records are keyed
`{runId, findingId}`, and `findingId` is
`sha256([axiom, ruleId, file, enclosingSymbol])` with **no line numbers** —
which is what lets a disposition survive unrelated lines being added above the
finding it labels.

This is **independent** of the artifact-commit disposition (Story 1.15):
findings are labelled whether the artifact ends up committed or dropped.
Neither prompt affects the exit code.

`--no-input`, a pipe, or a non-TTY never blocks: the non-interactive path
short-circuits before readline is even constructed and follows
`dispositionPolicy`. The default, `skip`, records **nothing** — a disposition
nobody made is fabricated data, and the trust metrics are only worth having if
every label came from a human. `deferred` is available for teams that want CI
findings to land in history as explicitly un-triaged.

A re-answer that matches appends nothing; a *changed* answer appends a second
record and the reader takes the last one for a key. The id hashes the answer
**and a per-key `revision`**: hashing the answer alone made a *revert* recompute
an id already in the store, so the idempotent writer skipped it and "latest
wins" reported the answer the user had moved away from. Two findings that share
one `findingId` in a single batch are deduped too, rather than writing the same
line twice.
Whether a disposition carries forward when the same `findingId` reappears in a
later run is explicitly Story 1.17's decision.

## `guardrails trends [--open]`

Renders `_agentic-guardrails/.cache/trends.html`: a fully self-contained page —
data inlined, vanilla JS, inline CSS, hand-drawn SVG, **no CDN, no network, no
charting dependency**. Scores are computed in the page from the stored raw
counts, so the view never disagrees with the formula.

The inlined data becomes `<script>` content, so it is escaped for *script*
context (a different function from the report's terminal control-character
filter): no record value — a ref name, a path, a sha merged in from another
clone — can close the tag.

`--open` hands the file to the platform opener and is **never fatal**: the path
is printed first, so a machine with no opener loses a convenience, not the
command. The opener is always a plain executable (`explorer.exe`, `open`,
`xdg-open`) and never `cmd /c start`: `shell: false` stops *Node* from invoking
a shell, but cmd.exe re-parses its own command line and Node leaves a bare `&`
unquoted — so a repository cloned under a path containing `&` would have run
whatever followed it.

Every line `guardrails trends` writes to the terminal — a read failure, a
history declaration — goes through the same control-character sanitizer the
review report uses. A Zod declaration quotes the offending key verbatim, and
this store is merged in from other clones.

Records are charted in **append order**, not git-ancestry order, and the page
says so.

## Retention

`reviews/<scope>/` is pruned to the newest `artifactRetention` artifacts
(default 100, config-overridable), newest-first by mtime with the filename as a
deterministic tiebreak. **Committed history is never pruned** — that unbounded
growth is the longitudinal feature, priced in.

> **Deviation from architecture.md, declared.** The AC and the architecture say
> `manifests/` is pruned to the newest 100. There is no `manifests/` directory:
> Story 1.4 embedded the RunManifest *inside* the review artifact, and neither
> 1.4 nor 1.15 built a committed per-run store. Rather than invent one that
> nothing consumes, the retention applies to the per-run store that actually
> exists. Whether a committed `manifests/` store should exist at all is a
> question for Epic 4, which owns institutional memory.

## Config keys

```yaml
artifactRetention: 100     # newest per-run artifacts kept per reviews/<scope>/
dispositionPolicy: skip    # skip | deferred — non-interactive DR-1 handling
```

Both are optional and both are reported at run start when they deviate from the
effective defaults (FR-31).
