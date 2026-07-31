---
title: 'Story 1.19: SPIKE-1 — Structured-Output Prototype (M1 signal)'
type: 'feature'
created: '2026-07-31'
status: 'done'
baseline_revision: 3131914af729fdfa1165b9a6ea711b439023efc4
final_revision: c57d5846f94ca464d65450d5f85a01cb0ccf28c5
review_loop_iteration: 0
followup_review_recommended: true # OVERSIZED accepted (treat as true from the start) + the review pass materially reframed the M1 evidence doc's claims
context: []
warnings:
  - 'oversized (accepted): single cohesive spike — the instrument, the paid measurement, and the write-up cannot split without orphaning the M1 signal; the ledgered RULESET_VERSION decision is mandated here by DELEGATED-WORK-CARRIES-AN-AC. Elevated review posture per OVERSIZED-STORY: treat followup_review_recommended as true.'
---

<intent-contract>

## Intent

**Problem:** Epic 2 bets its interactive transport on the ADR-001 `<axiom>.in`/`.out` envelope, but the envelope has zero consumers and its real parse-failure rate is an unmeasured keystone risk. Bar: post-repair envelope-valid rate ≥98% over 50 invocations (≤1 failure), confirmed 2026-07-01.

**Approach:** Throwaway harness (spike house pattern) + minimal throwaway handshake skill; 50 real IDE invocations over the file handshake (harness writes `.in.json` → headless `claude -p` runs the skill → skill writes `.out.json` via atomic rename → harness `safeParse`s); measure raw failure rate, apply the interactive repair ladder, report vs the bar in `docs/spikes/`. Numbers are a signal, not the verdict (Story 3.1 re-confirms). Harness deleted after write-up.

## Boundaries & Constraints

**Always:**

- Use `axiomEnvelope` from `packages/contracts` as shipped. The concrete `.in`/`.out` pair lives in the harness only, mirroring ADR-001's carried fields (`tier`, `source`, `severity`, `findingId`, `confidence`, exemplar provenance, `degraded[]`) — realistic, not toy. Envelope *adjustments* the data demands land in `contracts` + ADR-001 amendment; those survive, the harness does not.
- Each of the 50 samples is a genuine headless `claude -p` invocation of the skill against a distinct repo source file (sorted `.ts` list — deterministic, no randomness, no synthetic payloads). No mocked LLM output feeds the measured numbers.
- Handshake fidelity: run dirs under gitignored `_agentic-guardrails/.cache/handshake/<run-id>/`; the completion signal is the atomic rename of `<axiom>.out.json` — never read a temp file. Missing out-file at timeout (harness constant), malformed JSON, and schema-fail all count as raw failures.
- Repair ladder (ADR-001 interactive): correction retry = fresh invocation with `safeParse` issues appended to the `.in` payload; repair = final invocation presenting the invalid output + issues, asking only for corrected JSON. Post-repair valid = valid within ≤3 invocations. Per-sample attempt trail recorded.
- Fail closed: post-repair <98% → simplify envelope/prompt (or split schema), re-measure the full 50 — one loop.
- Harness self-check: a stub-invoker mode (no LLM) feeds canned outcomes (valid / invalid-JSON / schema-fail / missing-file / torn-temp) and asserts each is classified correctly. Runs before the paid run — the signal is only as trustworthy as the counter.
- Report at `docs/spikes/SPIKE-1-structured-output.md` in house style (Verdict, hardware context, methodology + exact re-run command, results) + committed raw results JSON; doc records the harness-deletion sha.
- Ledger AC (DELEGATED-WORK-CARRIES-AN-AC): the open RULESET_VERSION entry (deferred-work.md:25, "1.19 or epic-end sweep") gets its decision made here: per-axiom ruleset versioning policy recorded in the ledger with rationale and, if implementation is deferred, a named owner/timing (pre-Epic-3).
- External-surface statement: the harness drives the operator's own already-authenticated Claude Code CLI in documented headless mode — official first-party client, no impersonation, no undocumented endpoints, no new credential on the wire. Cost (~50–150 LLM invocations, hours of wall-clock) is the planning-accepted "named scaffold cost" in epics.md.

**Block If:** `claude` cannot run headless here (nested-session/auth failure) after reasonable diagnosis. OR the post-simplification re-measure is still <98% (envelope strategy needs a human ruling). OR headless invocations fail in a way that burns budget without producing measurable samples.

**Never:** No `packages/llm`, no provider SDK anywhere, no production transport. No `core`/`cli` runtime changes. No relaxing the bar or sample size. No surviving harness/skill code. No randomness in sampling.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean sample | schema-valid out | raw-valid, no retries | — |
| Schema-fail out | `safeParse` fails | correction retry → repair, attempts recorded | counted per stage |
| No out-file | timeout expires | raw failure, ladder proceeds | never hangs |
| Torn write | temp present, no rename | not read; missing until rename | rename is the only signal |
| Bar met | post-repair ≥49/50 | Verdict: pass | — |
| Bar missed once | post-repair <98% | simplify + full re-measure | fails closed |
| Bar missed twice | re-measure <98% | HALT blocked | no third silent loop |
| Stub self-check | canned outcome set | every class counted correctly | runs before paid run |

</intent-contract>

## Code Map

- `packages/contracts/src/envelope.ts` -- `axiomEnvelope` factory under test; touched only if data demands adjustment
- `packages/contracts/src/finding.ts` / `index.ts` -- carried-field shapes to mirror in the harness out-schema
- `scripts/spike-3-benchmark.mjs`, `scripts/spike-5-worktree-lifecycle.mjs` -- harness house pattern (plain `.mjs`, imports built `dist`, not in CI)
- `docs/spikes/SPIKE-5-windows-worktree-lifecycle.md` -- report house style; raw-output-beside-doc precedent
- `docs/adr/ADR-001-llm-envelope.md` -- amendment target on envelope change
- `_bmad-output/implementation-artifacts/deferred-work.md:25` -- RULESET_VERSION entry to disposition
- `tests/e2e-coverage.md` -- summary line (no UI-facing ACs)

## Tasks & Acceptance

**Execution:**
- [x] `scripts/spike-1-structured-output.mjs` -- harness: envelope pair via `axiomEnvelope` (from contracts dist), deterministic 50-file sample, headless invoker, atomic-rename watcher + timeout, safeParse + repair ladder, per-sample trail → results JSON; `--self-test` stub mode -- the instrument
- [x] `.claude/skills/spike-1-handshake/SKILL.md` -- throwaway skill: read `<axiom>.in.json`, produce envelope-shaped findings, write `<axiom>.out.json` temp→rename -- the thing measured
- [x] Run self-test, then the paid 50-sample run (+ ladder); if <98%, one simplification loop + full re-measure -- the M1 signal (self-test all-green first; 50/50 raw-valid, 100% post-repair — no simplification loop needed)
- [x] `docs/spikes/SPIKE-1-structured-output.md` + raw results JSON -- house-style write-up, Verdict vs ≥98% (Verdict: PASS)
- [x] `packages/contracts` + `docs/adr/ADR-001-llm-envelope.md` -- only if adjustment demanded (semver'd, golden fixtures per contracts pattern) — NOT demanded: 0 raw failures; contracts + ADR-001 untouched
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- RULESET_VERSION decision recorded
- [x] Delete `scripts/spike-1-*.mjs` + `.claude/skills/spike-1-handshake/`; record deletion sha in spike doc (harness committed intact at 9aaf9cd985acaadadaf22f10989a6ddefe1370c9, then deleted; sha recorded in the spike doc)
- [x] `CHANGELOG.md`, `tests/e2e-coverage.md` -- DoD

**Acceptance Criteria:**
- Given the throwaway skill and the shipped envelope schema, when 50 real headless IDE invocations run, then the raw `safeParse` failure rate is measured and recorded per sample.
- Given the repair ladder (1 correction retry + 1 repair), when applied to failures, then the post-repair envelope-valid rate is reported against the ≥98% bar in the committed spike doc.
- Given the bar is missed, when the spike concludes, then envelope/prompt was simplified and fully re-measured before any pass verdict — a second miss blocks the story, never a soft pass.
- Given the stub self-check, when run, then all five outcome classes are classified correctly before any paid invocation.
- Given story completion, when the final tree is inspected, then no harness or spike-skill code survives and the RULESET_VERSION ledger entry carries a recorded decision.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test`, when run, then all green.

## Spec Change Log

## Review Triage Log

### 2026-07-31 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 4, low 7)
- defer: 0
- reject: 13
- addressed_findings:
  - `[medium]` `[patch]` The spike doc claimed the two fault windows were "visible in this page's history" (false — new file, one commit) and asserted "Nothing is hand-measured" while the dataset had an undocumented hand-curation step (17 poisoned records deleted by hand to trigger idempotent re-run). Curation procedure now documented explicitly; false history claim removed.
  - `[medium]` `[patch]` Model identity absent — "operator's default model" never resolved. Resolved post-run from user settings: `sonnet` (Claude Sonnet 5), recorded in the hardware table with the raw-JSON provenance gap named as a limitation for Story 3.1's harness.
  - `[medium]` `[patch]` Resurrection sha `9aaf9cd` would be garbage-collected after a squash/rebase merge. Pinned with local tag `spike-1-harness`; doc + CHANGELOG note the tag and the merge-strategy dependency.
  - `[medium]` `[patch]` The measured wrapper contract was stricter than the shipped one in the flattering direction (`findings: min(1)`, empty array forbidden — the "prose instead of empty-array" failure shape has zero samples) and every payload embedded the full schema in-band (easier than production drift conditions). Both added to "What was NOT measured" with the "verbatim" claim scoped to per-finding validation.
  - `[low]` `[patch]` Median wall-clock was 40.5 s (upper-middle element); true median of the committed data is 39.2 s. Fixed.
  - `[low]` `[patch]` 0/50 presented without uncertainty framing; added rule-of-three bound (≲6% at 95% confidence — consistent with the bar, not proof).
  - `[low]` `[patch]` Verdict paragraph now states the bar was met entirely by the raw rate and the repair ladder went unexercised on real traffic.
  - `[low]` `[patch]` Self-test coverage gap disclosed: the stub bypasses spawn, so the one real defect (shell:true arg loss) lived in the uncovered invoker; no-op-spawn self-test recommended for the 3.1 harness.
  - `[low]` `[patch]` Documented re-run command referenced the deleted script; now prefixed with the `git show spike-1-harness:…` resurrection step.
  - `[low]` `[patch]` Ledger disposition pinned symbol-level detail for a future sweep; marked symbols as orientation-only, decision binding.
  - `[low]` `[patch]` CHANGELOG resurrection line now names the tag.
  - Rejected (13): 9 Edge Case Hunter findings on internals of the net-deleted harness with no consequence for the committed evidence (missing spawn error-handler, taskkill tree-kill, stale-dir reuse, corrupt-results parse, bar float arithmetic, torn-temp name heuristic, EISDIR read, infra-fault conflation — data shows 50/50 valid, instrument gone); post-timeout late-write race (max observed 120.6 s < 180 s, no data impact); "tree not in final state" (the finalize commit this pass creates the claimed state); "CHANGELOG bloat" (entry matches the 1.18 house style); re-run-command duplicate counted once as patch.

## Design Notes

- The IDE is the LLM runtime (inversion of control): headless `claude -p "/spike-1-handshake <run-dir>"` is the honest realization of "real IDE invocation" — no provider SDK exists or is added (boundary-checked).
- SPIKE-4 shipped real code; SPIKE-1 must not — deletion is an AC ("only the report and envelope adjustments survive").

## Verification

**Commands:**
- `node scripts/spike-1-structured-output.mjs --self-test` -- expected: all outcome classes counted correctly (evidence transcribed into spike doc before deletion)
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test` -- expected: all green on the final (post-deletion) tree

**Manual checks (if no CLI):**
- Spike doc carries Verdict, per-sample summary, exact re-run command, deletion sha; `git ls-files` shows no `spike-1` code.


## Auto Run Result

- **Status:** blocked — Claude account session usage limit exhausted mid-measurement (resets 19:10 Europe/Rome, 2026-07-31). Not a spec Block-If: the envelope is performing, the budget ran out.
- **Blocking condition:** the paid 50-sample run stopped at 31/50; the implementation subagent was terminated by the session limit and further headless `claude -p` invocations fail until the limit resets.
- **Measurement state (docs/spikes/SPIKE-1-results.json, resumable):** 31/50 samples complete — 31/31 raw-valid on first attempt (zero retries, zero repairs used so far). Sample 23 had one transient infra failure window that re-ran valid (not an envelope failure). Base-attempt latency ~1–120s.
- **Completed before the block:** `scripts/spike-1-structured-output.mjs` (harness with `--self-test` stub mode — self-test passed all five outcome classes before the paid run; resumable chunked runs appending to the results JSON); `.claude/skills/spike-1-handshake/SKILL.md` (throwaway skill, atomic temp→rename out-file); RULESET_VERSION ledger decision recorded in `deferred-work.md`; `tests/e2e-coverage.md` story line. All uncommitted (plus this spec file, untracked); working tree intentionally left as-is for resumption.
- **Not done:** samples 32–50 (+ ladder if any fail); `docs/spikes/SPIKE-1-structured-output.md` write-up with Verdict vs the ≥98% bar; harness+results archaeology commit; harness/skill deletion + deletion sha in doc; CHANGELOG entry; final post-deletion verification chain; envelope/ADR-001 adjustment only if remaining data demands it.
- **To resume (after 19:10 Europe/Rome):** re-invoke `/bmad-dev-auto` pointing at this spec file — status `blocked` will need manual reset to `in-progress` first, or instruct the run to continue implementation. The harness resumes from the results JSON (idempotent per sample index); drive it in chunks, then complete the write-up → commit → delete → verify sequence per Tasks.

## Auto Run Result

- **Summary:** The M1 structured-output signal is measured and it PASSES: 50 genuine headless `claude -p` invocations of a throwaway handshake skill over the ADR-001 `<axiom>.in`/`.out` file handshake produced 50/50 envelope-valid outputs on the first `safeParse` — 0% raw failure, 100% post-repair vs the ≥98% bar (met entirely by the raw rate; the repair ladder never fired on real traffic, its wiring proven by the stub self-test). No envelope or ADR-001 adjustment was demanded; `contracts` shipped untouched. The instrument (harness + skill) was committed intact at `9aaf9cd` (tag `spike-1-harness`), then deleted — only the spike doc, the raw results JSON, and the ledger decision survive, per the story contract. The delegated RULESET_VERSION decision is recorded: per-axiom version map, manifest-declared, implementation owned by the Epic-1 epic-end sweep pre-Epic-3. The spike doc carries explicit honesty ceilings: one model (Claude Sonnet 5) one day, empty-findings wrapper shape unmeasured (spike schema was stricter in the flattering direction), schema handed in-band (easier than production drift), ladder recovery rate undefined at 0 raw failures, rule-of-three bound ≲6% — Story 3.1 re-confirms on the production transport.
- **Files changed:** `docs/spikes/SPIKE-1-structured-output.md` (new) — house-style report with verdict, curation disclosure, limitations; `docs/spikes/SPIKE-1-results.json` (new, committed at 9aaf9cd) — 50-sample raw attempt trails; `scripts/spike-1-structured-output.mjs` + `.claude/skills/spike-1-handshake/SKILL.md` — added at 9aaf9cd, deleted in the story commit (net absent); `_bmad-output/implementation-artifacts/deferred-work.md` — RULESET_VERSION disposition; `CHANGELOG.md` — 1.19 entry; `tests/e2e-coverage.md` — 1.19 row; this spec.
- **Review findings breakdown:** 11 patched (0 high, 4 medium, 7 low — all evidence-integrity/doc-level: curation disclosure, model provenance, resurrection durability, measurement-scope caveats, median fix, statistics framing), 0 deferred, 13 rejected (mostly internals of the deleted harness), 0 intent_gap, 0 bad_spec. See Review Triage Log.
- **Follow-up review recommendation:** true — standing OVERSIZED-acceptance posture (treat as true from the start), reinforced by a patch pass that materially reframed the evidence document's claims (curation disclosure, verdict framing, measurement-scope caveats) — the epic's M1 gate evidence deserves an independent read.
- **Verification:** implementation agent ran `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:boundaries`, `pnpm -r build`, `pnpm -r test` (647), `pnpm test` (800) — all green on the post-deletion working tree. Orchestrator independently verified: 9aaf9cd contains harness+skill+results, working tree has no spike-1 code, results JSON internally consistent (50/50/50), median recomputed from raw data, tag created, doc claims spot-checked against `git status`/history.
- **Residual risks:** The session usage limit interrupted the run once mid-measurement (disclosed; 17 poisoned records hand-discarded and re-run — the one manual curation step, now documented). The PASS is an M1 signal under deliberately favorable conditions (schema in-band, non-empty findings forced, one model/day, sequential); the production bar rests on Story 3.1's re-confirmation. The resurrection point survives squash-merges only via the local tag `spike-1-harness` — push the tag with the branch. Raw results JSON lacks model/CLI provenance fields (named limitation for the 3.1 harness).
