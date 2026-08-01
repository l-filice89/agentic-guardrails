---
title: 'Story 1.12: Axiom #5 — Security Analyzer (regex/AST tier)'
type: 'feature'
created: '2026-07-25'
status: 'done'
baseline_revision: 17fd3aca2eca091918eac34ab15a2ec539de0752
final_revision: f286b54a503b238b0a9e7c56bb900ece6c526f0b
review_loop_iteration: 0
followup_review_recommended: true # AUTO-FORCED: two HIGH inline findings (regex tier blind to non-TS files; gating false positive on new Function parameter names) + oversized acceptance
context: []
warnings: [oversized] # accepted, not split: four rules across two source tiers for one axiom; elevated review posture per OVERSIZED-STORY
---

<intent-contract>

## Intent

**Problem:** Axiom #5 — the one axiom that defaults to blocking — has no analyzer: secrets, injection sinks, and dangerous APIs ride AI diffs unchecked while the config plane already gates on an axiom that can never fire.

**Approach:** Add `axiom5Security` (fourth registered analyzer; axiom 5 leaves `ANALYZERLESS_KNOWN_AXIOMS`) with four rules across two sources: regex over raw changed-file text for secrets, AST via the shared changed-files parse for sinks/APIs/deserialization. `RULESET_VERSION` → "5".

## Boundaries & Constraints

**Always:**
- Severity doctrine for a BLOCKING axiom (the 1.10 lesson: a false positive in a blocking rule gates legitimate code): **error only where the pattern is near-certain** (specific token formats, eval-family); **warning where heuristic** (generic secret-shaped assignments, dynamic sink arguments that MIGHT be attacker-influenced). Every rule row states which side it is on and why.
- Rule set (ONE registered axiom-5 analyzer; findings `axiom: "5"`, `tier: "deterministic"`, `confidence: 1`):
  - `security/hardcoded-secret` — `source: "regex"`, raw-text scan of changed files. ERROR patterns (documented, pinned): AWS access key id (`AKIA[0-9A-Z]{16}`), GitHub tokens (`gh[pousr]_[A-Za-z0-9]{36,}`), Slack tokens (`xox[baprs]-…`), private-key PEM headers (`-----BEGIN … PRIVATE KEY-----`). WARNING pattern: assignment of a ≥16-char literal to a secret-named identifier/property (`(?:api[_-]?key|secret|token|passw(?:or)?d|credential)` case-insensitive). Exemptions (no finding): values referencing `process.env`, obvious placeholders (`changeme`, `<…>`, `xxx…`, `your-…`, `example`, `dummy`, `TODO`), and `.test.`/`__fixtures__` paths for the WARNING pattern only (error-tier token formats always fire — a real AWS key in a test file is still a leak). Anchor: matching line. Discriminator: pattern name + ordinal.
  - `security/injection-sink` — `source: "ast"`. A call whose callee member name is `query`/`execute` with a template literal containing interpolation OR string concatenation as the SQL argument; `child_process` `exec`/`execSync` (symbol-resolved import binding, the 1.11 machinery) whose command argument is a template-with-interpolation or concatenation. Static-string arguments never flag. Severity warning (structural tier cannot prove taint — stated approximation). Anchor: call line. Discriminator: enclosing symbol + member + ordinal.
  - `security/dangerous-api` — `source: "ast"`. `eval(...)`, `new Function(...)` with any string body arg, `setTimeout`/`setInterval` with a STRING first argument, `vm` module `runIn*`/`compileFunction` members (symbol-resolved). Severity error (eval-family is near-certain: no legitimate idiom in application code; the doc states the ceiling). Shadowed identifiers never flag (1.11 binding checks). Discriminator: enclosing symbol + api name + ordinal.
  - `security/unsafe-deserialization` — `source: "ast"`. Calls to `unserialize` from a `node-serialize`-family import (known RCE vector — error) and `v8.deserialize` (warning: legitimate for trusted IPC, hazardous on untrusted input — stated approximation). Symbol-resolved bindings. Discriminator: enclosing symbol + api + ordinal.
- Regex rule reads raw text (not AST) — it must catch secrets in comments and malformed files; it runs even when parsing fails (read failure remains the only degradation). AST rules ride `changedFilesCache.acquire` (one parse per run, shared with axioms 3/4).
- PARSED-AS-DATA HAZARD: the analyzer never executes or dynamically requires target code — prove it: a fixture module whose top-level code would write a sentinel file if executed is analyzed; the test asserts findings exist AND the sentinel file does not.
- Blocking default: config-plane machinery already defaults axiom 5 to blocking — e2e asserts an error finding → exit 1 under default config (FR-32), and advisory-config → exit 0 with findings persisted.
- Registration: `DEFAULT_ANALYZERS` += axiom5Security; REMOVE "5" from `ANALYZERLESS_KNOWN_AXIOMS` (now registered — verify init questionnaire/knownAxiomIds still list it exactly once). `RULESET_VERSION` → "5"; ENGINE_VERSION unchanged.
- Determinism byte-identical (oracle twice). Docs: `docs/rules/axiom-5-security.md` (rule table with error-vs-warning rationale per row + Ceilings); README; CHANGELOG; e2e-coverage row.
- Fixture oracle: `tests/__fixtures__/security-rules/{violation,clean}` + `expected-findings.json` + `tests/integration/security-rules.e2e.test.ts` (oracle twice, clean zero, blocking-exit-1 default, advisory row, off row, cache-hit byte identity). Violation fixture secrets are OBVIOUSLY FAKE shapes matching the patterns (e.g. `AKIA` + `EXAMPLE`-style tail) — never real-looking live credentials in the repo.

**Block If:**
- Any rule requires shipping a third-party vulnerability/pattern database (licensing + update cadence = product decision).

**Never:** No entropy scanning (nondeterministic noise profile — pattern-based only, stated ceiling). No taint/data-flow analysis (Epic 3 tier). No network/dependency CVE lookups (zero egress). No auto-redaction or fixing. No new dependencies. No scanning of unchanged files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Violation fixture | one of each: fake AKIA key, template-SQL query, eval, node-serialize unserialize | exact oracle findings; exit 1 (blocking default, errors present) | No error expected |
| Clean fixture | env-var config, parameterized query, JSON.parse | zero findings, exit 0 | No error expected |
| Secret in comment | `// key: AKIAABCDEFGHIJKLMNOP` | regex finding (raw text, not AST) | No error expected |
| process.env reference | `const key = process.env.API_KEY` | no finding | No error expected |
| Placeholder | `const apiKey = "changeme-changeme"` | no finding (exemption) | No error expected |
| Generic secret in test file | `password = "hunter2hunter2hunter2"` in `x.test.ts` | no WARNING finding (path exemption); AKIA in same file still errors | No error expected |
| Parameterized query | `db.query("SELECT … WHERE id = $1", [id])` | no finding (static string) | No error expected |
| Shadowed eval | local `function eval(x)` called | no finding (binding check) | No error expected |
| setTimeout with function | `setTimeout(() => …, 100)` | no finding (string-arg only) | No error expected |
| Unparseable changed file | broken syntax + embedded fake AKIA key | regex finding still emitted; AST rules skip file silently (parse is error-tolerant; read failure is the degradation) | never a crash |
| Axiom 5 off / advisory | config rows | skipped-and-declared / findings persisted exit 0 | No error expected |

</intent-contract>

## Code Map

- `packages/core/src/analyzers/axiom4-nfr.ts` -- the pattern: shared parse via changedFilesCache, symbol-resolved bindings, ordinals, negative tests
- `packages/core/src/analyzers/changed-files.ts` -- shared parse helper (AST rules) + raw read for the regex rule
- `packages/core/src/pipeline/pipeline.ts` -- DEFAULT_ANALYZERS, ANALYZERLESS_KNOWN_AXIOMS ("5" leaves), membership expectations
- `packages/core/src/pipeline/manifest.ts` -- RULESET_VERSION "4" → "5"
- `packages/core/src/config/config-loader.ts` -- axiom-5 blocking default (existing; verify e2e)
- `tests/integration/nfr-rules.e2e.test.ts` + fixtures -- oracle/e2e template
- `docs/rules/axiom-4-nfr.md` -- doc format

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/analyzers/axiom5-security.ts` -- four rules per the Always list (regex over raw text; AST via shared parse; symbol-resolved bindings; error/warning doctrine) -- the analyzer
- [x] `packages/core/src/pipeline/pipeline.ts` + `manifest.ts` -- register; "5" leaves ANALYZERLESS_KNOWN_AXIOMS; RULESET "5"; update membership/count test expectations honestly -- wiring
- [x] `docs/rules/axiom-5-security.md` + `README.md` + `CHANGELOG.md` -- rule table with per-row error-vs-warning rationale + Ceilings (no entropy, no taint, pattern list pinned) -- documented rule set
- [x] unit tests -- every I/O matrix row + bypass probes (HAZARD: parsed-as-data sentinel test; secret in comment caught; each error-tier token format fires; placeholder/env/test-path exemptions each direction; shadowed eval negative; concatenated exec positive vs static-string negative; v8.deserialize warning vs node-serialize error) -- coverage
- [x] `tests/__fixtures__/security-rules/{violation,clean}` + `expected-findings.json` + `tests/integration/security-rules.e2e.test.ts` -- oracle twice, clean zero, blocking exit 1 under defaults, advisory/off rows, cache-hit byte identity -- AC oracle
- [x] `tests/e2e-coverage.md` -- 1.12 row -- DoD

**Acceptance Criteria:**
- Given the violation fixture, when review runs under default config, then findings match the oracle exactly (axiom "5", per-finding source regex|ast, severities per doctrine) and the run exits 1 (blocking default, FR-32).
- Given the clean fixture, when review runs, then zero findings, exit 0.
- Given the parsed-as-data hazard fixture, when analyzed, then findings are emitted and the would-be side-effect sentinel does not exist (code never executed).
- Given axiom 5 `off`/`advisory`, when review runs, then skipped-and-declared / persisted-but-exit-0 respectively, byte-identical on identical input.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test`, when run, then all green.

## Spec Change Log

## Review Triage Log

### 2026-07-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 22: (high 2, medium 7, low 13)
- defer: 1: (high 0, medium 1, low 0)
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` The raw-bytes secrets tier only saw analyzable TypeScript files — secrets in changed `.env`/`.json`/`.yaml`/`.md`/`.d.ts` were invisible while doc and CHANGELOG claimed "every changed file". AnalyzerContext gained `allChangedFiles` (raw pre-filter list) for the regex tier; 1 MiB cap with typed declared skip; binary-tolerant utf8 read. Additive fix found while patching: axiom 5's findings cache key now hashes ALL changed files, else a changed `.env` would not invalidate on warm runs and the fix would be silently defeated.
  - `[high]` `[patch]` `new Function("x", bodyVar)` ERRORED on the literal parameter NAME — a build-gating false positive the doc's own ceiling explicitly forbids. Only the last argument (the body) is inspected; three tests.
  - `[medium]` `[patch]` Eval-family bypass set, all four spellings: bare `Function("code")` without `new`, indirect `(0, eval)(code)`/`(eval)(code)` (callee unwrapping through parens and comma operands), `new globalThis.Function(...)` (shared isGlobalRef), and `new vm.Script(code)` (module-binding resolution in the NewExpression branch).
  - `[medium]` `[patch]` Token list was stale for 2026 leaks — added AWS temporary keys (ASIA), GitHub fine-grained PATs, Slack xoxe, and OpenAI/Anthropic key shapes with ordering and boundaries so `sk-ant-` wins its own pattern name and prose `sk-` never fires.
  - `[medium]` `[patch]` Placeholder exemption over-exempted via unanchored substrings ("mastodont…" contains "todo", "api.example-corp…" contains "example") — anchored to value start; three-direction tests.
  - `[medium]` `[patch]` Secret-name pattern matched mid-identifier (`tokenizerConfig`, `secretaryName`, `passwordHintText`) and missed hardcoded-credential COMPARISONS (`if (password === "literal")`, the classic backdoor spelling) — identifier is now split on separators/camel humps requiring the secret word to be final; operator alternation widened to ===/!==/==/!=.
  - `[medium]` `[patch]` `db.query("SELECT " + "FROM t")` flagged though the doc promises static strings never flag — all-literal `+` trees constant-fold to static.
  - `[medium]` `[patch]` The configSchema transform force-injecting `"5": blocking` into every parsed config became dead weight once axiom 5 registered (EFFECTIVE_DEFAULTS already blankets blocking); its only live effect was a spurious "axioms.5 matches no known axiom" seam warning that had been baked into test expectations. Transform deleted; expectations reverted to genuinely silent (the gate caught a config-plane e2e that had baked the phantom entry too).
  - `[medium]` `[patch]` Vendor-published sample credentials (AWS's AKIAIOSFODNN7EXAMPLE, GitHub's documented sample PAT) now never fire the error tier — they are published non-secrets that appear in every docs page; pinned list, both-direction tests.
  - `[low]` `[patch]` setTimeout/setInterval concatenated string arguments flag (parity with the Function-body check).
  - `[low]` `[patch]` Test-path exemption anchored to basename `.test.`/`.spec.` and `__fixtures__`/`__tests__` segments — interior `.test.` in production paths no longer exempts; `.spec.` convention now covered.
  - `[low]` `[patch]` `import.meta.env` joins `process.env` in the env exemption; the substring-keyed ceiling stated honestly.
  - `[low]` `[patch]` Prettier-wrapped assignments (`const apiKey =\n  "..."`) were severed by per-line scanning — whole-text scan with offset→line mapping.
  - `[low]` `[patch]` Per-delimiter value classes so an apostrophe inside a quoted value no longer truncates below the 16-char floor.
  - `[low]` `[patch]` Regex tier now honors the phase-budget AbortSignal between files (typed degradation), matching the parse pass.
  - `[low]` `[patch]` Lone-`\r` line endings no longer collapse a file to one line (wrong anchors).
  - `[low]` `[patch]` Same-line error+warning secret behavior pinned by test, including the honest post-1.7 merge outcome through mergeFindings.
  - `[low]` `[patch]` AXIOM_CATEGORY coupling test over DEFAULT_ANALYZERS (the axiom-4 "uncategorized" label bug that rode in from 1.11 is now regression-proofed and CHANGELOG'd).
  - `[low]` `[patch]` Docs wording corrected: "the one axiom that defaults to blocking" was false (EFFECTIVE_DEFAULTS blankets blocking; axiom 5's distinction is FR-32 naming it plus error-dense rules).
  - `[low]` `[patch]` Violation fixture gained a string-arg setTimeout and a github_pat_ comment; oracle regenerated from the built CLI (7 findings, 5 errors).
  - `[low]` `[patch]` Shared AST helpers moved to an internal `analyzers/ast-helpers.ts`, out of the public package barrel.
  - `[medium]` `[defer]` Dogfood self-gate: the repo's own security fixtures carry pattern-matching fake credentials that deliberately fire the error tier in test paths, so a dogfood review touching them exits 1 — ledgered for story 1.18 (dogfood CI) to choose the surface.

### 2026-07-31 — Independent follow-up review pass (stamp consumed)
- reviewed_range: 17fd3aca..f286b54a, verified against HEAD
- revalidated: 2026-08-01 — forced fixes still hold; the all-caps miss was re-derived from the exact tokenizer and remains uncovered
- forced_areas: both prior HIGHs confirmed fixed at HEAD — regex tier iterates `allChangedFiles` (pipeline.ts:1043 passes the raw pre-TS-filter list; findings key hashes ALL file hashes for axiom 5 at pipeline.ts:1010), and `stringyBodyArg` inspects only the last Function-constructor argument, so `new Function("x", bodyVar)` no longer errors on a parameter name.
- findings_fixed_and_verified_at_HEAD:
  - audit_note: The bullets below preserve each original defect statement for audit continuity; they are fixed, not current findings. The adjacent remediation evidence names the HEAD verification surface.
  - remediation_evidence: `packages/core/src/analyzers/axiom5-security.test.ts`; focused regression suite passed 2026-08-01.
  - [medium] packages/core/src/analyzers/axiom5-security.ts:245-255 — `isSecretName` is blind to SCREAMING_SNAKE_CASE, the most common constant spelling for secrets: the camel-hump split (`segment.split(/(?=[A-Z])/)`) shreds an ALL-CAPS segment into single letters, so `DB_PASSWORD`/`API_KEY`/`AUTH_TOKEN`/`SECRET` produce last-part "d"/"y"/"n"/"t" and never fire the warning tier — while the function's own doc comment (:231-234) claims `DB_PASSWORD` matches. Evidence: `isSecretName("DB_PASSWORD") === false`, `isSecretName("API_KEY") === false` (verified against HEAD source); no test covers an all-caps secret name (the only `.env` test at axiom5-security.test.ts:502 fires the error-tier `ghp_` token, masking the gap).

## Design Notes

- Error/warning doctrine is the load-bearing decision: axiom 5 blocks by default, so error is reserved for patterns with no legitimate spelling (specific token formats, eval-family, node-serialize). Everything judgment-shaped (generic secret names, dynamic SQL/exec arguments, v8.deserialize) warns — Epic 3's LLM tier upgrades confidence, not this tier.
- The regex rule deliberately bypasses the AST so secrets in comments, strings in broken files, and non-code lines are caught — and so a parse failure can never hide a leaked credential.
- Violation-fixture credentials use documented fake shapes (AWS's own `AKIAIOSFODNN7EXAMPLE` style) — the repo must never contain a string that scanners or humans could mistake for a live secret.

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test` -- expected: green with security e2e collected


## Auto Run Result

- **Summary:** Axiom #5 (security) is live as the fourth registered analyzer and the one FR-32 names as blocking: `security/hardcoded-secret` (regex over the raw bytes of EVERY changed file — not just TypeScript — with pinned 2026 token formats at error tier, generic secret-shaped assignments at warning tier, and anchored env/placeholder/test-path/published-sample exemptions), `security/injection-sink` (warning; template-interpolation and non-foldable concatenation into query/execute/exec), `security/dangerous-api` (error; eval, Function with or without `new`, indirect `(0, eval)`, string-arg timers, vm runIn*/Script — all shadowing-immune via symbol binding), `security/unsafe-deserialization` (node-serialize error / v8.deserialize warning). Analyzed code is parsed as data only, proven by a sentinel-file hazard test. RULESET 5; the violation oracle exits 1 under default config (FR-32). Review pass applied 22 patches (2 high: the regex tier was blind to non-TS files while the docs claimed otherwise; `new Function("x", bodyVar)` gated builds on a literal parameter name).
- **Files changed:** `packages/core/src/analyzers/axiom5-security.ts` (new) + test (49 tests), `ast-helpers.ts` (new, internal), `axiom4-nfr.ts` (helper extraction), `pipeline/pipeline.ts` (registration, allChangedFiles, cache key), `pipeline/manifest.ts` (RULESET 5); `packages/contracts/src/config.ts` (dead axiom-5 transform removed); `packages/cli/src/review-command.ts` (AXIOM_CATEGORY export + axiom-4 label fix); `docs/rules/axiom-5-security.md` (new), `README.md`, `CHANGELOG.md`; `tests/__fixtures__/security-rules/` (new, incl. a node-serialize stub so the fixture resolves), `tests/integration/security-rules.e2e.test.ts` (new); `tests/e2e-coverage.md`.
- **Review findings breakdown:** 22 patched (2 high, 7 medium, 13 low), 1 deferred (dogfood self-gate → 1.18), 0 rejected, 0 intent_gap, 0 bad_spec.
- **Follow-up review recommendation:** true — auto-forced by two HIGH inline findings (FOLLOW-UP-REVIEW AUTO-FORCE ON HIGH) and the accepted oversized flag.
- **Verification:** `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:boundaries`, `pnpm -r build`, `pnpm -r test` (52 contracts + 328 core + 8 cli), `pnpm test` (31 files / 479 tests) — all green after patches.
- **Residual risks:** Pattern-based only — no entropy scanning, no taint analysis (both stated ceilings; Epic 3 deepens). The env exemption keys on substring presence, so an env-prefix template with a hardcoded suffix stays exempt (documented). The repo self-gates on its own security fixtures (deferred to 1.18).
