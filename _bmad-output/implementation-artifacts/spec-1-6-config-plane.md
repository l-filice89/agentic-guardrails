---
title: 'Story 1.6: Config Plane'
type: 'feature'
created: '2026-07-24'
status: 'done'
baseline_revision: 4191932fbb81e7c867f0901adc7fd10f64f0aa49
final_revision: 39f0ef26189021d11c24a3f18c4e97ca0922bb8f
review_loop_iteration: 0
followup_review_recommended: true # AUTO-FORCED: two HIGH inline findings (silent config fallback; unauditable gating)
context: []
warnings: []
---

<intent-contract>

## Intent

**Problem:** The pipeline runs on hardcoded defaults; users cannot tune per-axiom enforcement, and no mechanism makes deviations from defaults explicit rather than silent.

**Approach:** Load `_agentic-guardrails/config.yaml` through the contracts config schema (extended with per-axiom thresholds), emit the generated JSON Schema for editor autocomplete, honor enforcement levels in exit-code gating, and log every deviation from defaults at run start.

## Boundaries & Constraints

**Always:**
- The contracts `configSchema` is the single source of truth; core loads YAML → `safeParse` → typed `Config`; NO component reads config outside the validated object (sole exception: LLM API key from env, unused until Epic 2 — do not implement env reading now, YAGNI).
- Invalid config → typed error naming the offending path (Zod issue paths formatted human-readably), CLI exit 2 with that message — never a stack trace, never a silent fallback to defaults.
- Missing `config.yaml` → defaults apply (axiom 5 blocking), declared in the manifest/log as "defaults (no config file)" — not a deviation log.
- Axiom #5 defaults to `blocking` (already in contracts schema). Enforcement semantics for exit-code gating: `blocking` axiom with error-severity findings → exit 1; `advisory` axiom findings never affect exit code (still reported + persisted); `off` axiom does not run (manifest declares it off by config).
- Every value deviating from schema defaults is logged explicitly at run start (stderr, one line per deviation, exact path + configured vs default).
- The generated JSON Schema is written by `guardrails` into `_agentic-guardrails/config.schema.json` whenever config loading finds it missing/stale, and `config.yaml` written by the tool references it via a `# yaml-language-server: $schema=./config.schema.json` header line (FR-31 editor support). Contracts still does no I/O — core writes the file.
- YAML parsing via the `yaml` package (dep of core; not an LLM SDK). Parse errors are typed errors naming line/column, not stack traces.
- Config participates in the runId hash (config content changes identity — determinism).

**Block If:**
- Threshold semantics cannot be pinned: the epic says "enforcement levels with numeric thresholds". Interpret as: optional per-axiom `maxFindings` thresholds (blocking axiom tolerates up to N error findings before exit 1; default 0). Verified against FR-32 ('numeric thresholds and regression tolerance'): maxFindings covers thresholds; regression tolerance is trend-relative and lands with story 1.16 (scores/trends), noted in Never. If implementation reveals a contradiction, HALT.

**Never:**
- No env-var config reading (Epic 2). No config hot-reload/watch. No CLI flags mirroring config values (later scope). No merging of multiple config files. No regression-tolerance config (1.16 scope, needs trend data). No config migration ladder yet (config is committed user-owned YAML, not an engine-written artifact; schemaVersion not required by AC — skip, YAGNI).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No config file | `_agentic-guardrails/config.yaml` absent | defaults apply; log "using defaults"; axiom 5 blocking | No error expected |
| Valid config | axioms {"1": advisory} | axiom 1 findings never gate exit; deviation logged | No error expected |
| Axiom off | axioms {"1": off} | axiom 1 not run; manifest declares off-by-config | No error expected |
| Invalid enum | enforcement: "warn" | typed error naming `axioms.1.enforcement`, exit 2 | no stack trace |
| Malformed YAML | tab-indent / broken syntax | typed parse error with line/column, exit 2 | no stack trace |
| Unknown key | `axiom:` (typo for `axioms:`) | typed error naming the unknown key (strict schema), exit 2 | no stack trace |
| Threshold | axioms {"1": {enforcement: blocking, maxFindings: 5}} | exit 1 only when error findings for axiom 1 exceed 5 | No error expected |
| Schema file | config loading finds no config.schema.json | JSON Schema written; YAML header references it | write failure degrades, run continues |

</intent-contract>

## Code Map

- `packages/contracts/src/config.ts` -- existing configSchema (enforcement enum, axiom-5 default transform, configJsonSchema) — extend with `maxFindings`
- `packages/core/src/pipeline/pipeline.ts` -- runReview: analyzer membership (off), exit-severity input, runId hash inputs
- `packages/cli/src/review-command.ts` -- exit-code logic (0/1/2), stderr surfaces
- `packages/core/src/persistence/artifact-writer.ts` -- `_agentic-guardrails/` dir handling pattern to follow for schema file
- `packages/core/src/pipeline/manifest.ts` -- manifest declarations (off-by-config axioms)
- `tests/integration/walking-skeleton.e2e.test.ts` -- e2e harness patterns for config-driven cases

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/config.ts` -- extend axiom entry: `{ enforcement, maxFindings?: int >= 0 }` (maxFindings meaningful only for blocking — document; advisory/off ignore it); keep strictness + axiom-5 default; regenerate-by-construction `configJsonSchema` -- schema source of truth
- [x] `packages/core/src/config/config-loader.ts` -- `loadConfig(repoRoot)`: read `_agentic-guardrails/config.yaml` (absent → defaults + flag), YAML parse (typed line/col errors), `safeParse` (typed path errors), compute deviations vs defaults (path + configured + default), ensure `config.schema.json` current (write via atomic writer; failure → degradation not abort) -- the loader
- [x] `packages/core/src/pipeline/pipeline.ts` -- consume `Config`: `off` axioms excluded from phase 1 + declared in manifest; per-axiom enforcement + maxFindings evaluated into `ReviewRunResult.gate` (blocking axioms' error findings > threshold → gate fail); config content hash joins runId inputs; deviations passed through for CLI logging -- honor the plane
- [x] `packages/cli/src/review-command.ts` -- print deviation lines at run start (stderr); config errors → message + exit 2; exit 1 driven by the pipeline gate result (replaces the raw any-error-finding rule) -- surface
- [x] `packages/core/src/config/config-loader.test.ts` + pipeline/cli unit tests -- every I/O-matrix row incl. hazard tests: typo key rejected (strict), advisory never gates (bypass test: advisory axiom WITH error findings exits 0), off axiom absent from run + manifest declares it, threshold boundary (exactly N vs N+1), config hash changes runId -- coverage
- [x] `tests/integration/config-plane.e2e.test.ts` -- e2e: write config.yaml variants into temp repos, spawn built CLI: invalid enum → exit 2 + path in stderr; advisory → exit 0 with findings printed; off → manifest declares; schema file generated + YAML header present when tool writes config; deviation lines printed -- AC oracle
- [x] `tests/e2e-coverage.md` + `README.md` + `CHANGELOG.md` -- 1.6 rows; document config.yaml surface + example -- DoD

**Acceptance Criteria:**
- Given `_agentic-guardrails/config.yaml`, when loaded, then it validates through the contracts schema and an invalid value produces a typed error naming the offending path (never a stack trace), exit 2.
- Given the generated JSON Schema, when the tool writes/refreshes it, then `config.schema.json` sits beside the YAML and the tool-written YAML references it via the yaml-language-server header (editor autocomplete, FR-31).
- Given per-axiom enforcement with thresholds, when a review runs, then exit gating honors blocking/advisory/off + maxFindings and axiom 5 defaults to blocking (FR-32) — including the bypass hazard: advisory findings never flip the exit code.
- Given any deviation from defaults, when a run starts, then each deviation is logged explicitly, and no component reads config outside the validated object.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test`, when run, then all green.

## Spec Change Log

## Review Triage Log

### 2026-07-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 13: (high 2, medium 6, low 5)
- defer: 1: (high 0, medium 1, low 0)
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[high]` `[patch]` Present-but-unreadable config.yaml (EACCES/EISDIR/EIO) silently fell back to defaults with a false "no config file" message — non-ENOENT read errors are now typed config errors (exit 2, file + code named); unit + e2e (config-as-directory).
  - `[high]` `[patch]` The governing config left zero durable trace: no configHash/enforcement/gate in the persisted artifact, so an advisory bypass was undetectable post-hoc — manifest now carries configHash/configPresent/effective enforcement map; artifact embeds the full gate verdict (per-axiom, incl. zero-error blocking axioms); e2e proves an advisory-bypass run is durably declared.
  - `[medium]` `[patch]` Uncommitted-config bypass vector made visible: manifest records configGitStatus (committed/modified/untracked/absent) via the git wrapper; CLI warns on stderr when an uncommitted config governs gating. Policy beyond visibility deferred.
  - `[medium]` `[patch]` A failed config.schema.json write escalated clean runs to exit 2 — now a warning line (no coverage was lost), never a degradation; asserted degradedRun stays false.
  - `[medium]` `[patch]` Schema file was written unsolicited into un-opted-in repos and left untracked — written only when config.yaml exists; seeded .gitignore covers it.
  - `[medium]` `[patch]` maxFindings on advisory/off was accepted and silently dead — schema refine rejects it with a typed path error.
  - `[medium]` `[patch]` Unknown axiom ids in config were silently inert — stderr warning names the unbound id.
  - `[medium]` `[patch]` The degradation-dominates-gate-fail exit cell had no e2e — added (cycle + uncovered file → exit 2).
  - `[low]` `[patch]` Deviation logger contradicted the documented defaults (explicit maxFindings: 0 reported as deviation vs "unset") — deviations now diff against effective defaults.
  - `[low]` `[patch]` Lexicographic axiom sort would misorder "10" vs "2" inside byte-stable artifacts — numeric-aware compare everywhere, fixed before it becomes a byte-breaking migration.
  - `[low]` `[patch]` configHash sentinel was sha256("") — forgeable by an empty file; literal "absent" now, empty-present file hashes real bytes (test distinguishes).
  - `[low]` `[patch]` parse({}) inside the loader could throw past the typed-error path; issue-path join assumed string segments — defaults hoisted via safeParse invariant; String()-mapped paths.
  - `[low]` `[patch]` Tautological CONFIG_YAML_HEADER test — now asserts the header line exists in DEFAULT_CONFIG_YAML and the template round-trips through the schema. Null `axioms:` (commented-out config) treated as {}.
  - `[medium]` `[defer]` Uncommitted-config POLICY (should an untracked config govern a gating run at all, or only committed config?) — needs a product ruling; visibility shipped this story, decision deferred.

Rejected: finding.axiom vs analyzer.axiom mismatch (reachable only via custom analyzer injection in tests); __proto__ axiom-key hardening (Zod 4 record semantics + no external attack surface — config is repo-local YAML); duplicate axiomsOff entries (same custom-analyzer-only path); untyped reach into Zod unrecognized_keys internals (works on pinned Zod 4; message degrades gracefully); DEFAULT_CONFIG_YAML export "speculative" (1.8 init consumes it next; test un-tautologized instead of deleting).

### 2026-07-31 — Independent follow-up review pass (stamp consumed)
- reviewed_range: 4191932f..39f0ef26, verified against HEAD
- revalidated: 2026-08-01 — ignored-file behavior reproduced with git; the optional-status omission remains visible in the current manifest path
- findings_fixed_and_verified_at_HEAD:
  - audit_note: The bullets below preserve each original defect statement for audit continuity; they are fixed, not current findings. The adjacent remediation evidence names the HEAD verification surface.
  - remediation_evidence: `packages/core/src/git/git.test.ts` and `packages/core/src/pipeline/pipeline.test.ts`; focused regression suite passed 2026-08-01.
  - [medium] packages/core/src/git/git.ts:633-645 — `fileGitStatus` classifies a git-IGNORED config.yaml as "committed": `git status --porcelain=v1 --untracked-files=all` emits nothing for an ignored path (needs `--ignored`), so `parsePorcelainZ(...).length === 0` → "committed". The manifest then durably records `configGitStatus: "committed"` for a file git has never tracked and the CLI's uncommitted-config warning stays silent — a gap in the prior medium "uncommitted-config visibility" patch (empirically confirmed: ignored file → empty porcelain output). Fix path: distinguish "no status entries" via `git check-ignore`/`ls-files --error-unmatch` before concluding "committed".
  - [low] packages/core/src/pipeline/pipeline.ts:557-562 — on a `fileGitStatus` git failure, `configGitStatus` is silently omitted from the manifest with no warning line; because the field is optional-for-pre-1.6-artifacts, a consumer cannot distinguish "old artifact" from "status probe failed". Acknowledged in-code as a ponytail ceiling; noting it as the residual auditability soft spot.
- notes: the two forced HIGH areas verified healed at HEAD — non-ENOENT read errors are typed exit-2 failures (config-loader.ts:91-110, never a silent default fallback), and gating is durably auditable (manifest configHash/configPresent/enforcement + full per-axiom gate verdict embedded in the artifact, pipeline.ts:584/628-665). Loader edge walk (malformed YAML, null `axioms:`, unknown keys, scalar/array roots, empty file, duplicate keys, threshold boundary N vs N+1, advisory-bypass, off-membership) found no further unhandled branches at HEAD.

## Design Notes

- Deviation computation: parse the same YAML twice — once through the schema (validated), once raw — and diff configured paths against schema defaults; simpler: compute defaults object (`configSchema.parse({})`) and deep-diff validated vs defaults, reporting only paths present in the raw input (a default explicitly restated is not a deviation... it IS a stated value equal to default — report nothing; only values differing from defaults are deviations).
- `off` exclusion happens at analyzer-registry filter time (membership, not result suppression) so the manifest can honestly say "did not run".
- Gate evaluation is pure and unit-testable: `(findings, config) => { exitRelevant: boolean, perAxiom: [...] }` in core, consumed by CLI.

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test` -- expected: green with new config e2e collected


## Auto Run Result

- **Summary:** Config plane live: `_agentic-guardrails/config.yaml` validates through the contracts schema (typed path/line errors, exit 2, never a stack trace), per-axiom enforcement blocking/advisory/off + maxFindings drives exit gating (axiom 5 blocking by default), every deviation from defaults is logged, and `config.schema.json` gives editors autocomplete. Review pass applied 13 patches (2 high: unreadable-config silent fallback; gating decisions now durably recorded — manifest carries configHash/configPresent/effective enforcement/configGitStatus and the artifact embeds the full per-axiom gate verdict, so an advisory bypass is visible post-hoc).
- **Files changed:** `packages/contracts/src/config.ts` (maxFindings + refine), `run-manifest.ts` (configHash/configPresent/enforcement/configGitStatus/axiomsOff), `review-artifact.ts` (gate); `packages/core/src/config/config-loader.ts` (new), `pipeline.ts`, `manifest.ts`, `git/git.ts` (fileGitStatus), `persistence/artifact-writer.ts` (writeFileAtomic seam, gitignore lines); `packages/cli/src/review-command.ts`; unit suites + `tests/integration/config-plane.e2e.test.ts` (new); `tests/e2e-coverage.md`, `README.md`, `CHANGELOG.md`.
- **Review findings breakdown:** 13 patched (2 high, 6 medium, 5 low), 1 deferred (uncommitted-config policy), 5 rejected, 0 intent_gap, 0 bad_spec.
- **Follow-up review recommendation:** true — auto-forced by two HIGH inline findings (FOLLOW-UP-REVIEW AUTO-FORCE ON HIGH; no decline branch).
- **Verification:** `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:boundaries`, `pnpm -r build`, `pnpm -r test` (42 contracts + 90 core + 4 cli), `pnpm test` (16 files / 195 tests) — all green after patches.
- **Residual risks:** Uncommitted-config policy is only visibility, not enforcement (deferred). The tool-written config.yaml header half of FR-31 ships as constants consumed by 1.8 init. Regression tolerance (FR-32 second half) lands with 1.16 trends.
