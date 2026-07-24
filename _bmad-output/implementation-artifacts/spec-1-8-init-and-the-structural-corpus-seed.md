---
title: 'Story 1.8: `init` and the Structural Corpus Seed'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: 360801a46169520ecf2ba064e71c7d05537e0702
review_loop_iteration: 0
followup_review_recommended: true # AUTO-FORCED: two HIGH inline findings (forever-false wiring warning; unvalidated ledger hash) + oversized acceptance
context: []
warnings: [oversized] # accepted, not split: bootstrap + preflight/manifest halves ship no user value alone; elevated review posture per OVERSIZED-STORY (followup_review_recommended treated true from start)
---

<intent-contract>

## Intent

**Problem:** There is no `guardrails init`: repos get only an on-demand `reviews/` folder (1.4), no committed config/conventions/corpus-map, no git wiring (`merge=union` for history JSONL, cache ignore), and the manifest's `ledgerHash`/`corpusHash` are permanent "absent until init" sentinels.

**Approach:** Add an `init` command that bootstraps `_agentic-guardrails/` (config.yaml via a small questionnaire sourced from the contracts JSON Schema, empty-but-valid conventions.yaml + corpus-map.yaml, `.gitattributes` + `.gitignore` wiring), builds a regenerable file-level structural seed from the 1.3 import graph into `.cache/`, and teaches Phase-0 preflight to verify the git wiring (loud warning with named consequence) and hash the real committed files into the manifest.

## Boundaries & Constraints

**Always:**
- FR-3 split: NO mining, NO build strategies (`eager|lazy|hot-seed` are Epic 4). Ledger ships empty-but-valid.
- Init writes ONLY missing files — never clobber human-edited config.yaml/conventions.yaml/corpus-map.yaml (idempotent re-run = no-op on existing files, reported per file: created vs kept). Wiring files get missing lines APPENDED (reuse artifact-writer's append-missing-lines pattern), user content preserved verbatim.
- config.yaml written from 1.6's `DEFAULT_CONFIG_YAML`/`CONFIG_YAML_HEADER` constants (delegation from 1.6 — FR-31 tool-written header). Questionnaire options (per known axiom: blocking/advisory/off, maxFindings for blocking) are sourced from contracts (`configJsonSchema`/`enforcementSchema` values), not hardcoded string literals; implemented with `node:readline/promises` — NO new runtime dependency.
- `--no-input` (and non-TTY stdin) skips the questionnaire and writes documented defaults — no prompt ever blocks; exit 0.
- Git wiring: `_agentic-guardrails/.gitattributes` containing `history/*.jsonl merge=union`; `.cache/` ignore already in the seeded `_agentic-guardrails/.gitignore` — init seeds it up front (same lines as artifact-writer's `SEEDED_IGNORE_LINES`).
- Structural seed: file-level entities from the merged import graph — `{ file, fanIn }` per graph node (architecture: "entities, locations, fan-in — machine-derived from the import graph"; the graph's unit IS the file, its repo-relative path is the location). Deterministic (sorted, canonical JSON), written atomically to `_agentic-guardrails/.cache/corpus/structural-seed.json` as a PLAIN file (regenerable derivation — not a DeterministicCache kind: no HMAC, no 100-entry prune coupling). Carries the partial-result envelope (coverage + degraded from graph build). No tsconfig in repo → seed skipped with a declared reason, init still succeeds.
- Preflight (review, phase 0): verify the gitattributes line and the `.cache/` ignore line exist WHEN `_agentic-guardrails/` exists; missing → stderr warning naming the consequence ("history JSONL will merge with conflicts" / ".cache/ may be committed"), via the existing configWarnings-style channel — a warning, never exit 2. Uninitialized repo (no folder) → no warning (1.4's on-demand behavior unchanged). Preflight checks are two small file reads — the ≤5s NFR-3 budget is asserted in e2e with a generous ceiling.
- Manifest truth: when committed conventions.yaml / corpus-map.yaml exist, `ledgerHash`/`corpusHash` = sha256 of their bytes and the two "absent until init" sentinel degradations DROP; absent files keep sentinel + degradation exactly as today. Update the six existing assertions accordingly (uninitialized fixtures keep asserting sentinels).
- Contracts: minimal `conventions.yaml` / `corpus-map.yaml` Zod schemas (new `contracts/src/ledger.ts`): `schemaVersion: 1` + empty collections (`conventions: []`; corpus-map: empty human-confirmed layer). Full ledger semantics are Epic 4 — schema here is just enough that "empty-but-valid" is machine-checkable. Register both in the migration ladder + golden fixtures (repo convention for persisted artifacts).
- Exit codes: init 0 success, 2 typed failure (not a git repo, write error). Determinism: byte-identical outputs given same answers/inputs.

**Block If:**
- The `merge=union` attribute cannot live in `_agentic-guardrails/.gitattributes` (git ignores it there) — would need to edit the USER'S root .gitattributes, a policy call.

**Never:** No convention mining or LLM anything. No `--force`/overwrite mode. No root-.gitignore edits. No interactive disposition loop. No corpus staleness detection (Epic 4). No symbol-level entity extraction (new adapter machinery — file-level is the M1 corpus unit).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh init, non-interactive | no `_agentic-guardrails/`, `--no-input` | all files created with defaults, seed built, summary lists each file created, exit 0 | No error expected |
| Interactive | TTY, answers: axiom 1 advisory | config.yaml reflects answer + header line; deviation visible on next review | No error expected |
| Re-run on initialized repo | human-edited config.yaml present | file kept (reported "kept"), missing wiring lines appended, seed regenerated, exit 0 | never clobber |
| Not a git repo | plain dir | typed error naming the requirement, exit 2 | no partial writes before the check |
| No tsconfig | repo without tsconfig.json | init succeeds; seed skipped with declared reason in summary | No error expected |
| Review on initialized repo | conventions+corpus-map committed | manifest carries real sha256 hashes, sentinel degradations gone | No error expected |
| Review with wiring removed | user deleted .gitattributes line | stderr warning naming the consequence; exit unchanged by the warning | warning, never crash |
| Review on uninitialized repo | no `_agentic-guardrails/` | today's behavior byte-identical: sentinels, no wiring warning | unchanged |

</intent-contract>

## Code Map

- `packages/cli/src/index.ts` -- command registration pattern (`program.command("review")…`), exitOverride, exit-code owner
- `packages/cli/src/review-command.ts` -- warning-line printing pattern (configWarnings → stderr)
- `packages/core/src/config/config-loader.ts` -- `DEFAULT_CONFIG_YAML`, `CONFIG_YAML_HEADER` (1.6 delegation, currently unused)
- `packages/core/src/persistence/artifact-writer.ts` -- `writeFileAtomic`, `SEEDED_IGNORE_LINES` + private `ensureOutputGitignore` (export for reuse)
- `packages/core/src/pipeline/pipeline.ts` -- phase-0 preflight (lines ~170-187), phases manifest declaration, `knownAxioms`
- `packages/core/src/pipeline/manifest.ts` -- `ABSENT_SHA256` sentinels + "absent until init (story 1.8)" degradations to replace
- `packages/core/src/graph/import-graph.ts` + `analyzers/axiom1-structural.ts` (`mergeGraphResults`) -- nodes + `fanIn()` for the seed
- `packages/contracts/src/config.ts` -- `configJsonSchema`, `enforcementSchema` (questionnaire source); `migration.ts` -- ladder registry

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/ledger.ts` (+ index, migration ladder, `__fixtures__/`) -- minimal conventions + corpus-map schemas (`schemaVersion` + empty collections), golden fixtures -- empty-but-valid is checkable
- [x] `packages/core/src/knowledge/structural-seed.ts` -- `buildStructuralSeed(graphResult)`: sorted `{file, fanIn}` entries + partial-result envelope, canonical serialization -- the seed
- [x] `packages/core/src/init/init.ts` -- `runInit({cwd, noInput, io?})`: git check → write-missing files (config via constants/questionnaire, conventions, corpus-map, .gitattributes, .gitignore) → build+write seed → typed summary `{created[], kept[], seed, warnings[]}` -- the bootstrap
- [x] `packages/cli/src/init-command.ts` + `index.ts` -- register `init` with `--no-input`; questionnaire via `node:readline/promises` sourcing options from contracts; print summary; exit 0/2 -- the surface
- [x] `packages/core/src/pipeline/manifest.ts` + `pipeline.ts` -- real `ledgerHash`/`corpusHash` when files exist (sentinel+degradation when absent); preflight wiring check → warning channel -- manifest truth + NFR-3
- [x] `packages/core/src/persistence/artifact-writer.ts` -- export the append-missing-lines helper for init reuse -- one implementation
- [x] unit tests -- I/O matrix rows (idempotency/never-clobber, no-git typed error, seed determinism + no-tsconfig skip, questionnaire answer→yaml mapping, wiring-check warning present/absent, hash-vs-sentinel both directions incl. HAZARD: human-edited file survives re-init byte-identical) -- coverage
- [x] `tests/integration/init.e2e.test.ts` -- fresh init `--no-input` → files + seed on disk; re-init no-clobber; review after init → real hashes, no sentinels; wiring-line removed → named warning; uninitialized review unchanged -- AC oracle
- [x] `tests/e2e-coverage.md` + `README.md` + `CHANGELOG.md` -- 1.8 rows; init documented -- DoD

**Acceptance Criteria:**
- Given a repo without `_agentic-guardrails/`, when `guardrails init --no-input` runs, then committed config.yaml (from the 1.6 `DEFAULT_CONFIG_YAML` constants — delegation honored), empty-but-valid conventions.yaml + corpus-map.yaml (contracts-validated), `.gitattributes` (`history/*.jsonl merge=union`) and seeded `.gitignore` exist, and the structural seed file is in `.cache/corpus/`.
- Given a TTY without `--no-input`, when init runs, then the per-axiom questionnaire drives config.yaml and its options come from the contracts schema values.
- Given an initialized repo, when init re-runs, then human-edited files are byte-identical afterward and the summary reports kept-vs-created.
- Given a subsequent review, when phase-0 preflight executes, then missing wiring lines produce a loud stderr warning naming the consequence, preflight stays within the ≤5s NFR-3 budget (e2e-asserted ceiling), and an initialized repo's manifest carries real sha256 ledger/corpus hashes with the "absent until init" degradations gone.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test`, when run, then all green.

## Spec Change Log

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 18: (high 2, medium 5, low 11)
- defer: 1: (high 0, medium 1, low 0)
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - `[high]` `[patch]` The "uninitialized repo stays silent" guarantee survived exactly one review: the artifact writer auto-creates `_agentic-guardrails/` (+ .gitignore, no .gitattributes) on demand, so the SECOND review of a never-inited repo warned about missing wiring forever — warning predicate now requires an init marker (config.yaml/conventions.yaml/corpus-map.yaml) and a real directory; blind-spot e2e runs review TWICE and asserts second-run silence; the weakened toContain assertion re-pinned to exact toEqual.
  - `[high]` `[patch]` Manifest hashed unvalidated ledger bytes: a conventions.yaml containing `hello` got a real sha256 presented as a healthy ledger (degradation dropped), and EACCES/EISDIR was misreported as "absent until init" — files now parse through the contracts schemas: invalid → real hash + declared invalidity degradation (counts toward exit 2), non-ENOENT read error → sentinel + named read-error degradation, valid → clean real hash; 8 tests both files × 4 states.
  - `[medium]` `[patch]` Preflight verified only 1 of the 3 seeded .gitignore lines — all SEEDED_IGNORE_LINES checked, per-line named consequences.
  - `[medium]` `[patch]` Init summary reported "kept" for wiring files it had just appended lines to — three-way outcome surfaced (`updated:` line in summary and CLI).
  - `[medium]` `[patch]` A seed WRITE failure (EACCES/ENOSPC) exited 0 as if skipped — fs write errors are now typed failures (exit 2, created/updated files still reported); only no-tsconfig/graph-impossibility remains a declared skip.
  - `[medium]` `[patch]` External bare specifiers (`zod`) were indistinguishable from repo files in the seed — entities carry the graph's `external: boolean`.
  - `[medium]` `[patch]` Ctrl+D/closed stdin during a questionnaire prompt hung forever — EOF settles as accept-remaining-defaults with a stderr note; interactive mode also requires stdout TTY.
  - `[low]` `[patch]` maxFindings digits beyond 2^53 failed construction instead of warn-and-default.
  - `[low]` `[patch]` ensureLines appended non-atomically and injected LF into CRLF files — atomic rewrite matching existing EOL.
  - `[low]` `[patch]` Existing contracts-invalid config.yaml was silently "kept" — init now warns "review will exit 2", still exit 0.
  - `[low]` `[patch]` Questionnaire hardcoded the "blocking"/0 fallback and a magic axiom "5" — defaults sourced from exported EFFECTIVE_DEFAULTS, known axioms from the pipeline's exported ANALYZERLESS_KNOWN_AXIOMS, one-line axiom descriptions at the prompt.
  - `[low]` `[patch]` Questionnaire warnings were dropped when construction subsequently failed — included in the failure message (guard now unreachable from questionnaire input after the integer fix; no test possible).
  - `[low]` `[patch]` ledger schemas accepted any schemaVersion >= 1 (a v7 file parsed green as v1) — z.literal(1).
  - `[low]` `[patch]` Duplicate mkdirSync in runInit — collapsed.
  - `[low]` `[patch]` Wiring warnings printed under the CLI's `config:` prefix — moved to a dedicated wiringWarnings field, printed unprefixed; artifact bytes unchanged.
  - `[medium]` `[defer]` Knowledge-file provenance asymmetry: uncommitted conventions/corpus-map silently govern ledger/corpus hashes while config.yaml gets configGitStatus + a warning — ledgered for Epic 4 / 1.18.

Rejected: fanIn O(N·E) seed-build claim (fanIn is prebuilt-index O(result) — false premise); `history/*.jsonl` wiring "protects files that don't exist" (1.16 writes history/trends.jsonl this epic — deliberate prep, not dead wiring); NFR-3 e2e "measures the wrong thing" (full-CLI wall clock is a conservative superset of the preflight budget; a preflight-only timer would need production instrumentation the NFR doesn't justify).

## Design Notes

- Questionnaire-from-schema honesty: `configSchema`'s only user dimension is the per-axiom enforcement record (a `z.record` — nothing to enumerate generically). "Generated from the JSON Schema" is satisfied by sourcing the option VALUES from contracts and iterating the pipeline's known-axiom ids; a generic schema-walking form generator is machinery the data cannot justify (record it as the ponytail ceiling).
- Seed is a plain file, not a `DeterministicCache` kind: the cache is keyed/HMAC'd/pruned for per-unit memoization; the seed is a whole-repo regenerable derivation with different lifetime semantics.
- `.gitattributes` inside `_agentic-guardrails/` (git honors per-directory attribute files; pattern `history/*.jsonl` is relative to that directory) keeps init out of user root files.

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test` -- expected: green with init e2e collected


## Auto Run Result

- **Summary:** `guardrails init` bootstraps `_agentic-guardrails/` — config.yaml from the 1.6 constants or a TTY questionnaire (options + defaults sourced from contracts/config-loader, `node:readline/promises`, `--no-input`/non-TTY skips), empty-but-valid conventions.yaml + corpus-map.yaml (new contracts ledger schemas, migration ladder + golden fixtures), `.gitattributes` (`history/*.jsonl merge=union`) and the seeded `.gitignore` — plus a regenerable file-level structural seed (`{file, fanIn, external}` from the merged import graph) at `.cache/corpus/structural-seed.json`. Phase-0 preflight verifies all wiring lines on initialized repos (named consequences, warning channel), and the manifest carries real schema-validated sha256 ledger/corpus hashes with the "absent until init" sentinels dropping only for valid files. Review pass applied 18 patches (2 high: the wiring warning fired forever on never-inited repos after the artifact writer auto-created the folder; garbage ledger files got healthy-looking real hashes with the degradation dropped).
- **Files changed:** `packages/contracts/src/ledger.ts` (new) + `migration.ts`, `index.ts`, `__fixtures__/{conventions,corpus-map}.v1.json`; `packages/core/src/init/{init.ts,wiring.ts}` (new), `knowledge/structural-seed.ts` (new), `pipeline/pipeline.ts` (knowledge-file hashing, wiring check, ANALYZERLESS_KNOWN_AXIOMS), `pipeline/manifest.ts` (optional real hashes), `persistence/artifact-writer.ts` (exported ensureLines, atomic EOL-aware appends), `config/config-loader.ts` (EFFECTIVE_DEFAULTS export); `packages/cli/src/init-command.ts` (new incl. eofSafeIo) + `index.ts`, `review-command.ts` (wiringWarnings channel); unit suites + `tests/integration/init.e2e.test.ts` (new); `tests/e2e-coverage.md`, `README.md`, `CHANGELOG.md`.
- **Review findings breakdown:** 18 patched (2 high, 5 medium, 11 low), 1 deferred (knowledge-file git-status provenance), 3 rejected, 0 intent_gap, 0 bad_spec.
- **Follow-up review recommendation:** true — auto-forced by two HIGH inline findings (FOLLOW-UP-REVIEW AUTO-FORCE ON HIGH) and the accepted oversized flag (OVERSIZED-STORY elevated posture).
- **Verification:** `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:boundaries`, `pnpm -r build`, `pnpm -r test` (47 contracts + 168 core + 7 cli), `pnpm test` (23 files / 296 tests) — all green after patches.
- **Residual risks:** Knowledge-file provenance (committed vs working-tree) is visible only via hash, not git status (deferred). Questionnaire covers enforcement only — richer init flows (build strategies) are Epic 4 by design. NFR-3 asserted as full-CLI wall clock (conservative superset).
