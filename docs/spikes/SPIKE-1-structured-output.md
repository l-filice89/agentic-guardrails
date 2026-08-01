# SPIKE-1 — Structured-Output Prototype (Story 1.19)

Measures the keystone risk Epic 2 bets its interactive transport on: the real
parse-failure rate of the ADR-001 `<axiom>.in`/`.out` envelope when an actual
LLM produces the `.out` side. Bar (confirmed 2026-07-01): post-repair
envelope-valid rate ≥98% over 50 invocations (≤1 failure). The numbers are a
signal, not the verdict — Story 3.1 re-confirms on the production transport.

**Verdict: PASS.** 50/50 samples were envelope-valid on the FIRST attempt —
raw failure rate 0%, post-repair valid rate 100% (bar: ≥49/50). Note what
that means: the bar was met entirely by the RAW rate; the repair ladder —
the mechanism ADR-001 actually bets on — was never exercised by a real
failure (its wiring is proven only by the stub self-test below). 0/50
failures bounds the true raw failure rate to ≲6% at 95% confidence (rule of
three): the data is consistent with the ≥98% bar, not proof of it. No
envelope or ADR-001 adjustment is demanded by the data: `axiomEnvelope` and
the contracts `findingSchema` shipped unchanged.

Every number here is transcribed from the committed raw results at
[`SPIKE-1-results.json`](./SPIKE-1-results.json) (per-sample attempt trail
included). One curation step applies and is documented under "Operational
faults" below: records from two infrastructure fault windows were discarded
and those sample indexes re-invoked fresh; the committed file contains only
harness-recorded invocations, never hand-written values.

## Hardware context

| | |
|---|---|
| CPU | 12th Gen Intel(R) Core(TM) i7-12700H, 20 logical cores |
| RAM | 15.6 GB |
| OS | Windows 11 (win32 10.0.26200) |
| Node | v24.6.0 |
| LLM runtime | Claude Code CLI 2.1.220, headless `claude -p`, model `sonnet` (Claude Sonnet 5) — the operator's user-settings default, resolved post-run from `~/.claude/settings.json`; the raw results JSON records node/platform but not model/CLI (known limitation — Story 3.1's harness should stamp both) |
| Date | 2026-07-31 (run timestamps in the raw results) |

## What was measured

The IDE is the LLM runtime (inversion of control): each sample is one genuine
headless `claude -p "/spike-1-handshake <run-dir>"` invocation of a throwaway
skill — no provider SDK exists or was added (boundary-checked), no mocked LLM
output feeds any measured number.

- Harness: `scripts/spike-1-structured-output.mjs` (throwaway, deleted after
  this write-up — see the resurrection point below). Skill:
  `.claude/skills/spike-1-handshake/SKILL.md` (same lifecycle).
- Re-run: resurrect the instrument first (it is deleted from the tree — see
  the resurrection point below), then run it:
  `git show spike-1-harness:scripts/spike-1-structured-output.mjs > scripts/spike-1-structured-output.mjs`
  and the same for the skill file, then `pnpm -r build && node
  scripts/spike-1-structured-output.mjs --self-test && node
  scripts/spike-1-structured-output.mjs --max 50` (resumable: results append
  idempotently per sample index; `--summary` prints the rates and verdict).
  Requires an authenticated Claude Code CLI on PATH.
- Envelope pair: built via the SHIPPED `axiomEnvelope` factory from
  `packages/contracts/dist`. The `.out` schema carries the SHIPPED
  `findingSchema` verbatim — `tier`/`source`/`severity`/`findingId`/
  `confidence`/`enclosingSymbol`/`exemplar` all cross the boundary and are
  all strict-validated — plus `coverage` and typed `degraded[]` under the
  partial-result invariant (`coverage < 1` requires a degradation). The
  concrete pair lives in the harness only, per the story contract.
- Sample: 50 distinct repo `.ts` files, evenly spaced over the sorted
  `git ls-files -- '*.ts'` list — deterministic, no randomness, no synthetic
  payloads. Content capped at 4000 chars per payload (truncation declared in
  the `.in` payload).
- Handshake fidelity: run dirs under gitignored
  `_agentic-guardrails/.cache/handshake/<run-id>/s<idx>-a<attempt>/`; the
  harness writes `spike1.in.json` (validated against the `.in` schema — our
  own side is not exempt), the skill writes `spike1.out.json` via temp file +
  atomic `mv` rename. The rename is the ONLY completion signal: the harness
  never reads a temp file. Missing out-file at the 180 s timeout, malformed
  JSON, and schema-fail all count as raw failures.
- Repair ladder (ADR-001 interactive, ≤3 invocations per sample): base →
  correction retry (fresh invocation, `safeParse` issues appended to the
  `.in` payload) → repair (final invocation presenting the invalid output +
  issues, asking only for corrected JSON).

## Results

| Metric | Value |
|---|---|
| Samples | 50/50 complete |
| Raw valid (first attempt) | **50/50 (100%)** — raw failure rate 0% |
| Post-repair valid (≤3 invocations) | **50/50 (100%)** vs the ≥98% bar (≥49/50) |
| Correction retries / repairs needed | 0 / 0 |
| Findings produced | 125 total (1–3 per sample, all strict-schema-valid) |
| Per-invocation wall clock | median 39.2 s (min 15.7 s, max 120.6 s) |

Every output passed the first `safeParse`, producing 125 accepted findings
with 1-based inclusive ranges. The successful raw payloads were not retained,
so the committed results corroborate validation outcomes and finding counts,
not direct inspection of per-finding confidence values or markdown-fence
absence. The prompt requested those shapes; treating that request as retained
measurement evidence would overstate the data. The failure modes the ladder
exists for (malformed JSON, hallucinated fields) did not occur in 50 recorded
invocations.

## Self-test (stub invoker, no LLM) — ran before any paid invocation

The signal is only as trustworthy as the counter. Transcribed verbatim:

```
PASS valid          → classified valid
PASS invalid-JSON   → classified invalid-json
PASS schema-fail    → classified schema-fail
PASS missing-file   → classified missing-file (tornTemp: false)
PASS torn-temp      → classified missing-file (tornTemp: true)
  [0] scripts/spike-1-structured-output.mjs attempt 1 (base): missing-file
  [0] scripts/spike-1-structured-output.mjs attempt 2 (correction-retry): invalid-json — Expected property name or '}' in JSON at position 1 (line 1 column 2)
  [0] scripts/spike-1-structured-output.mjs attempt 3 (repair): valid
PASS ladder         → raw-fail ×2 then repair-valid, 3 attempts recorded

SELF-TEST PASS — all five outcome classes + ladder classified correctly
```

The torn-temp case plants a temp file holding PERFECTLY VALID JSON that was
never renamed: it is classified `missing-file` (never read) with the torn
temp reported — proving the rename really is the only signal.

Coverage gap, disclosed: the stub invoker bypasses process spawning
entirely, so the self-test proves the CLASSIFIER, not the invoker — and the
one real defect encountered in the run (the `shell: true` argument-loss bug
below) lived precisely in the uncovered invoker. A future harness self-test
should include one end-to-end spawn against a no-op command.

## Operational faults encountered (disclosed, not counted)

Two infrastructure fault windows produced fast, uniform `missing-file`
failures that were measurements of the invoker, not of the envelope. Both
were diagnosed from captured transcripts. **Curation procedure, disclosed:**
the poisoned records (17 samples total) were deleted from the results file
by hand — the harness's idempotent resume then treated those indexes as
never-run and re-invoked each one fresh through the fixed harness. The
discarded records were not preserved; their failure shape (fast uniform
`missing-file` with the transcript evidence quoted below) is documented here
in prose only. This is the one manual step in the pipeline; no measured
value was ever hand-written:

1. **Argument loss under `shell: true`** (harness bug, 14 samples): Node's
   shell mode concatenates spawn args unquoted, so the skill prompt split and
   `claude` received `/spike-1-handshake` with an EMPTY run-dir (transcripts:
   "the run directory argument is empty"). Fixed by spawning `claude.exe`
   directly with a real argv — the correct spelling from the start.
2. **Session usage limit** (3 samples): `claude -p` returned "You've hit your
   session limit" without invoking the skill. Re-run after the stated reset.

Every sample in the committed results is a genuine harness-spawned headless
invocation of the skill over its own `.in` payload. Total paid invocations
including the two fault windows and diagnostics: ~70 — within the
planning-accepted ~50–150 named scaffold cost.

## What was NOT measured

- **The production transport.** No `packages/llm`, no SDK, no streaming; the
  file handshake is this spike's transport. Story 3.1 re-confirms the bar on
  the real one.
- **One model, one day.** The operator's default Claude Code model on
  2026-07-31; model drift over time is exactly why the repair ladder ships
  anyway despite never firing here.
- **Repair-ladder effectiveness on real failures.** 0 raw failures means the
  ladder's measured recovery rate is undefined — its wiring is proven only by
  the stub self-test.
- **Envelope size limits.** Inputs were capped at 4000 chars; whole-file and
  multi-file payload behaviour is unmeasured.
- **Concurrency.** Invocations were strictly sequential.
- **The empty-findings wrapper shape.** The spike's `.out` schema required
  `findings: min(1)` and the task ordered 1–3 findings, so the model was
  never allowed to return an empty findings array. Production must accept
  empty — and "model answers prose like 'no issues found' instead of an
  empty-array object" is a plausible real failure shape with ZERO samples
  here. Per-finding validation used the shipped `findingSchema` verbatim;
  the WRAPPER contract measured was stricter than the shipped one, in the
  direction that flatters the result.
- **Schema-blind production conditions.** Every `.in` payload embedded the
  complete output schema as prose, key by key — the file-handshake design
  does carry the contract in-band, but a fresh single-turn invocation
  transcribing a schema it was just handed is easier than production's
  longer contexts and prompt drift. 50/50 under these conditions is the
  designed M1 signal, not evidence about harder conditions.

## RULESET_VERSION ledger decision (DELEGATED-WORK-CARRIES-AN-AC)

Recorded in `_bmad-output/implementation-artifacts/deferred-work.md` (the
1.11 entry): adopt per-axiom ruleset versioning — a per-axiom version map
replacing the single `RULESET_VERSION` string in each axiom's findings-cache
key, manifest-declared; `ENGINE_VERSION` keeps the payload-shape role.
Implementation owner: the Epic-1 epic-end sweep, before any Epic-3 analyzer
lands (this story forbids core runtime changes).

## Harness deletion — the resurrection point

Per the story contract no harness or skill code survives. The complete
instrument (`scripts/spike-1-structured-output.mjs`,
`.claude/skills/spike-1-handshake/SKILL.md`) and the raw results were
committed intact at:

**`9aaf9cd985acaadadaf22f10989a6ddefe1370c9`** — `chore: SPIKE-1 throwaway
harness + raw results (story 1.19)`

and deleted from the tree immediately after. `git show <sha>` resurrects the
instrument exactly as it ran. The commit is additionally pinned by the local
tag `spike-1-harness` — if this branch ever merges via squash or rebase, the
raw sha becomes unreachable, so the tag (or a non-squash merge) is what
keeps the resurrection point alive; push the tag alongside the branch.
