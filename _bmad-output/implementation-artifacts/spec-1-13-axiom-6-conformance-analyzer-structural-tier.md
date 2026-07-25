---
title: 'Story 1.13: Axiom #6 — Conformance Analyzer (structural tier)'
type: 'feature'
created: '2026-07-25'
status: 'done'
baseline_revision: 195a8e58ea2fea1a31b8135d04327d70970b9aea
final_revision: 8071274924055186c19112689d8fb5ebaf840475
review_loop_iteration: 0
followup_review_recommended: true # AUTO-FORCED: three HIGH inline findings (inverted judged/voter split; forgeable exit carve-out; invisible inconclusive state) + oversized acceptance
context: []
warnings: [oversized] # accepted, not split: prevalence engine + three rules + no_corpus contract are one analyzer; elevated review posture per OVERSIZED-STORY
---

<intent-contract>

## Intent

**Problem:** Nothing consumes the 1.8 structural corpus seed: AI-written code that fights the codebase's actual shape (misplaced files, off-convention names, alien module shape) passes every axiom while the seed sits unread in `.cache/`.

**Approach:** Add `axiom6Conformance` (fifth registered analyzer) reading the persisted seed as its corpus of record, with three prevalence-gated rules. The load-bearing invariant is FR-5: a convention fires ONLY when the corpus confirms it (minimum sample + dominance threshold); below either bar the analyzer says nothing. `RULESET_VERSION` → "6".

## Boundaries & Constraints

**Always:**
- Corpus source of record = the persisted seed at `_agentic-guardrails/.cache/corpus/structural-seed.json` (1.8 delegation — this story is the seed's first consumer). Read → Zod-validated (add `structuralSeedSchema` to contracts, mirroring the existing interface). Missing / unreadable / schema-invalid / `entities` empty → **inconclusive**: zero findings + ONE typed degradation whose reason begins `no_corpus` and names which case — never a false pass, never a crash.
- The `no_corpus` degradation is DECLARED in the manifest/artifact but carved out of exit-code dominance, exactly like 1.8's "absent until init" ledger sentinels (an un-inited repo must not have every review flipped to exit 2 by an advisory axiom). Reuse that carve-out mechanism; assert both halves (declared AND exit unaffected).
- Prevalence gate (FR-5, applies to EVERY rule): a pattern is CONFIRMED only when its scope has ≥ `MIN_SAMPLE` (10) corpus files AND the dominant variant holds ≥ `DOMINANCE` (0.8). Otherwise → no finding, ever. Thresholds are named constants with rationale; every finding message cites the evidence as measured counts (`kebab-case in 34/39 files under src/core`).
- Rule set (ONE registered axiom-6 analyzer; findings `axiom: "6"`, `tier: "deterministic"`, `source: "ast"`, `confidence: 1`, ALL severity **warning** — conformance is advisory by nature; a false positive here is style-policing that would gate a build, the 1.10/1.12 lesson):
  - `conformance/naming-convention` — the changed file's basename (extension and kind-suffix stripped) uses a casing style (kebab / camel / Pascal / snake) that deviates from the confirmed dominant style. Scope: nearest directory with enough samples, walking up to repo root; the message names the scope actually used. Discriminator: rule + basename.
  - `conformance/file-placement` — the changed file's KIND (derived from basename suffix: `.test.` / `.spec.` / `.d.ts` / `.config.` / plain source) predominantly lives under one directory prefix in the corpus, and this file sits elsewhere. Message cites the prevailing location and its share. Discriminator: rule + kind.
  - `conformance/module-shape` — export shape inferred from how the corpus imports files: using the graph's per-edge imported `names` (1.10), compute the confirmed repo-wide convention (default-binding vs named-binding modules) among files that HAVE importers; flag a changed file whose importers bind the minority form. Files with no importers yield no evidence → no finding. Message cites both counts. Discriminator: rule + file.
- Corpus entities used for prevalence exclude `external: true` (npm specifiers are not repo files) and exclude the changed files themselves (a diff must not vote on the convention it is being judged against — HAZARD: self-confirmation).
- Registration: `DEFAULT_ANALYZERS` += axiom6Conformance; `RULESET_VERSION` → "6"; ENGINE_VERSION unchanged (no cached-payload schema change); init questionnaire/knownAxiomIds derive automatically (add the axiom-6 prompt line + `AXIOM_CATEGORY["6"]`, covered by 1.12's coupling test).
- Determinism: byte-identical on identical input (oracle twice); prevalence computation is pure over the sorted seed.
- Fixture oracle: `tests/__fixtures__/conformance-rules/{violation,clean,no-corpus}` + `expected-findings.json` + `tests/integration/conformance-rules.e2e.test.ts`. Violation fixture ships a seeded corpus with ≥10 same-convention files plus a deviating diff; clean fixture's diff matches; no-corpus fixture has no seed file → inconclusive, findings empty, degradation declared, exit NOT 2 from that cause. Fixtures run `guardrails init` (or ship a committed seed under the gitignored path — whichever the harness can do honestly) so the corpus is real, not synthetic.
- Docs: `docs/rules/axiom-6-conformance.md` (rule table + thresholds + evidence format + Ceilings: file-level substrate only, no zone roles/purpose — Epic 4; module-shape inferred from import bindings, not from parsing the corpus). README; CHANGELOG; e2e-coverage row.

**Block If:**
- The `no_corpus` carve-out cannot reuse 1.8's sentinel mechanism without weakening degradation-dominance for real degradations (would need an exit-code policy decision).

**Never:** No convention MINING or ledger writes (Epic 4 — this analyzer only READS the derived seed). No LLM. No corpus parsing (O(project) — the SPIKE-3 anti-pattern). No new dependencies. No configurable thresholds this story. No findings from unconfirmed patterns, ever — that is FR-5, not a preference.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Confirmed convention + deviation | 34/39 kebab corpus, changed `MyNewFile.ts` | one naming finding citing 34/39 and the scope | No error expected |
| Matching diff | changed file follows every confirmed convention | zero findings | No error expected |
| Below sample floor | corpus scope has 6 files | no finding regardless of dominance (FR-5) | No error expected |
| Below dominance floor | 5 kebab / 5 camel | no finding (no confirmed convention) | No error expected |
| No seed file | `.cache/corpus/` absent | zero findings + `no_corpus: seed file absent` degradation; exit unaffected by it | never a crash |
| Corrupt seed | truncated JSON / schema-invalid | zero findings + `no_corpus: seed unreadable/invalid` degradation | never a crash |
| Empty corpus | seed with `entities: []` | `no_corpus: corpus empty` degradation | never a crash |
| Externals only | corpus of npm specifiers | treated as empty corpus (externals excluded) | No error expected |
| Self-confirmation hazard | 12 changed files all camel, corpus kebab | changed files excluded from prevalence → deviation still flagged | No error expected |
| Placement deviation | corpus tests all under `tests/`, changed `src/foo.test.ts` | placement finding citing the prevailing location | No error expected |
| Module shape | corpus 20/22 named-binding, changed file imported as default | module-shape finding citing both counts | No error expected |
| No importers | changed file nothing imports | no module-shape finding (no evidence) | No error expected |
| Axiom 6 off / advisory | config rows | skipped-and-declared / non-gating | No error expected |

</intent-contract>

## Code Map

- `packages/core/src/knowledge/structural-seed.ts` -- seed shape + `STRUCTURAL_SEED_PATH` (1.8 producer; this story is the consumer)
- `packages/core/src/analyzers/axiom5-security.ts` -- newest analyzer pattern (raw file read + shared parse + ordinals + degradations)
- `packages/core/src/analyzers/ast-helpers.ts` -- internal shared helpers
- `packages/core/src/pipeline/pipeline.ts` -- DEFAULT_ANALYZERS, graph acquire (module-shape needs edge `names`), the 1.8 sentinel-degradation carve-out to reuse
- `packages/core/src/pipeline/manifest.ts` -- RULESET_VERSION "5" → "6"
- `packages/contracts/src/` -- add `structuralSeedSchema` (validation on read)
- `tests/integration/security-rules.e2e.test.ts` + fixtures -- oracle/e2e template

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/structural-seed.ts` (+ index) -- Zod schema for the seed (schemaVersion literal 1, entities, coverage, degraded) -- validated corpus reads
- [x] `packages/core/src/analyzers/axiom6-conformance.ts` -- seed read + Zod validation + `no_corpus` inconclusive path; prevalence engine (MIN_SAMPLE/DOMINANCE, changed-file and external exclusion); three rules with evidence-citing messages -- the analyzer
- [x] `packages/core/src/pipeline/pipeline.ts` + `manifest.ts` + `init/init.ts` + `cli/src/review-command.ts` -- register; RULESET "6"; `no_corpus` carve-out from exit dominance; axiom-6 prompt line + category; honest updates to membership/count expectations -- wiring
- [x] `docs/rules/axiom-6-conformance.md` + `README.md` + `CHANGELOG.md` -- rule table, thresholds + rationale, evidence format, Ceilings -- documented rule set
- [x] unit tests -- every I/O matrix row + HAZARD probes (self-confirmation exclusion; below-sample and below-dominance silence both directions; externals excluded; no_corpus for each of absent/unreadable/invalid/empty; scope walk-up picks the nearest qualifying directory) -- coverage
- [x] `tests/__fixtures__/conformance-rules/{violation,clean,no-corpus}` + `expected-findings.json` + `tests/integration/conformance-rules.e2e.test.ts` -- oracle twice, clean zero, no-corpus inconclusive + exit unaffected, off/advisory rows, cache-hit byte identity -- AC oracle
- [x] `tests/e2e-coverage.md` -- 1.13 row -- DoD

**Acceptance Criteria:**
- Given a seeded corpus with a dominant structural pattern and a deviating diff, when the analyzer runs, then it flags the deviation with `axiom: "6"`, `tier: "deterministic"`, and a message citing measured prevalence evidence.
- Given no corpus seed, or an unreadable/invalid/empty one, when the analyzer runs, then it is inconclusive — zero findings, one typed `no_corpus` degradation declared in the manifest, no crash, and the run's exit code is not driven to 2 by that degradation.
- Given a diff matching the prevailing patterns, when the analyzer runs, then zero findings; and given any pattern below the sample or dominance threshold, then zero findings (FR-5: unconfirmed conventions never produce findings).
- Given axiom 6 `off` / `advisory`, when a review runs, then skipped-and-declared / non-gating, byte-identical on identical input.
- Given `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test`, when run, then all green.

## Spec Change Log

## Review Triage Log

### 2026-07-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 24: (high 3, medium 6, low 15)
- defer: 2: (high 0, medium 2, low 0)
- reject: 1: (high 0, medium 0, low 1)
- addressed_findings:
  - `[high]` `[patch]` The judged/voter split was backwards. The seed is a snapshot taken BEFORE the diff, so excluding changed files from the corpus vote was a no-op exactly where the self-confirmation hazard was claimed (added files are never in the seed) and actively harmful where it applied (modified files keep their path, which is the only evidence naming/placement use) — the sample shrank in proportion to diff size, so the analyzer went silent precisely on large changes, and legacy off-convention files were re-flagged on every unrelated edit. Mechanism inverted to the same intent: judge changed paths ABSENT from the corpus (genuinely new decisions), let existing corpus paths vote and go unjudged. NOTE: this supersedes the mechanism stated in the intent-contract's Boundaries ("exclude the changed files themselves") while preserving its stated intent; the residual path (re-running init mid-diff) is documented as a ceiling. Four replacement tests incl. the 8-of-12-modified regression that was previously silent, plus the modal all-pre-existing-paths case that had no coverage at all.
  - `[high]` `[patch]` The exit-code carve-out was too broad and forgeable: `reason.startsWith("no_corpus")` exempted ANY analyzer's degradation with that prefix, and exempted every failure mode — so a corrupt/unreadable/schema-invalid seed silently disabled axiom 6 with no exit signal. Now only the legitimately-absent case is exit-neutral; every other case counts toward exit 2. String matching replaced by an analyzer-declared `declaredOnly` list (the pipeline no longer imports an analyzer constant or inspects reason text), and the list is sorted before splicing so artifact byte-identity no longer depends on analyzer map insertion order.
  - `[high]` `[patch]` The inconclusive state was invisible: an un-inited repo printed "0 findings … 0 degraded", byte-identical in the terminal to a clean run, while an entire axiom declined to run — and the e2e asserted that silence as the contract. The CLI now prints a declared inconclusive line per declared-only degradation (exit unaffected); e2e assertions flipped to require it.
  - `[medium]` `[patch]` The seed's partial-result envelope was parsed and discarded — conventions could be "confirmed" from an admittedly partial census (if the unparsed half held the majority style, the true majority gets flagged as the deviation). Coverage < 1 now emits a real degradation naming the percentage; the contracts schema enforces the producer's own invariant (partial coverage requires a typed degradation) plus no duplicate entity paths and no backslash paths.
  - `[medium]` `[patch]` module-shape evidence could be manufactured by the diff itself (in the violation fixture the judged file's only importer was another new file) — importer edges originating in changed files no longer count as evidence; the rule also gained the nearest-qualifying-scope walk naming already had, so a components/ tree that genuinely uses default exports can establish a local convention instead of being outvoted repo-wide; an empty tsconfig set now declares that the rule did not run.
  - `[medium]` `[patch]` file-placement was vacuous in monorepos (top path segment is "packages" for every source file, so it could never fire — this repo could not dogfood it) and over-eager in single-package repos — replaced with the scope-relative bucket from the same qualifying-scope walk.
  - `[medium]` `[patch]` namingStyle counted README/LICENSE/HTTP and single letters as PascalCase, inflating the Pascal tally with names carrying no casing intent — all-caps and single letters are now evidence-free (neither vote nor judged), mirroring the deliberate single-lowercase-word exclusion.
  - `[medium]` `[patch]` The manifest did not record which corpus produced the findings (seedHash fed only the cache key), while the pre-existing `corpusHash` field means corpus-map.yaml — a name collision that would mislead any reader. Added optional `corpusSeedHash` with both field comments spelling out the distinction; the pipeline now reads the seed once and hashes that same buffer (also closing the TOCTOU where a concurrent init rewrote the seed between key computation and analyzer read).
  - `[medium]` `[patch]` Prevalence was gated in two places despite the "one gate" claim; dominance compared floats against 0.8. Single gate, integer arithmetic (best*10 >= total*8) with the constant derived from the same numerator/denominator so they cannot drift.
  - `[low]` `[patch]` MIN_SAMPLE rationale was arithmetically wrong in both code and doc (at n=10 an 80% majority leaves two dissenters, not three).
  - `[low]` `[patch]` `expect(DOMINANCE).toBe(0.8)` was tautological — replaced with a behavioural boundary test (7/10 silent, 8/10 fires).
  - `[low]` `[patch]` confidence: 1 on statistical inferences now states plainly what it means for this axiom (the rule fired deterministically, not that the convention is certainly right).
  - `[low]` `[patch]` The O(changed x depth x corpus) scan never checked the abort signal — now checked between files in all three rules.
  - `[low]` `[patch]` CorpusRead was a non-discriminated union guarded by non-null assertions — now a discriminated union.
  - `[low]` `[patch]` The `declaration` kind can never be judged (isAnalyzableTs excludes .d.ts from the change set) — documented as corpus-only voting and removed from the doc's judged-kinds table.
  - `[low]` `[patch]` "reads no corpus at all when there is nothing under review" asserted the return value, not that no read occurred — now poisons the seed accessor so a regression fails.
  - `[low]` `[patch]` The e2e's isolation rested on init not touching a pre-committed config.yaml — now asserted.
  - `[low]` `[patch]` Untested branches covered: module-shape both-ways ambiguity, file-placement spec and config kinds, naming where the nearest scope qualifies but is not dominant while an ancestor is.
  - `[low]` `[patch]` Docs: no_corpus table rendered escaped backticks literally and its schema-drift row did not match the emitted message; the Ceilings claim that the analyzer never parses the corpus was false (module-shape builds a full project import graph — shared with axioms 1/3, but triggered alone if those are off); CHANGELOG trimmed to house style; README parenthetical restructured so the phase arrow reads off its subject.
  - `[medium]` `[defer]` The corpus seed is an unauthenticated input that now decides what findings exist, while the findings cache refuses unauthenticated reads (1.7 HMAC) — trust asymmetry ledgered for Epic 4's corpus lifecycle.
  - `[medium]` `[defer]` Findings can differ by platform (case-folding is a no-op on Linux, lowercases on win32/darwin) while the project leans on byte-compared oracles — cross-platform artifact parity ledgered for 1.14/1.18.

Rejected: excluding renamed-from paths from the corpus vote — a single stale path cannot move a 10-sample 80% threshold, and removing it would weaken the evidence against the rename it is meant to judge. (The enclosingSymbol-carries-a-taxonomy-label finding duplicates an existing ledger entry from 1.11 and was not re-filed.)

## Design Notes

- The seed (not the live graph) is the corpus of record even though the analyzer could re-derive it: the seed is the declared corpus artifact, re-deriving it would make the AC-mandated `no_corpus` path dead code, and reading a whole-repo snapshot costs one file read instead of an O(project) parse.
- Excluding changed files from prevalence is the difference between a conformance check and a tautology: a 12-file camelCase diff must not become its own confirmed convention.
- Module shape is inferred from what importers BIND (graph edge names, 1.10) rather than from parsing corpus files — an approximation stated in the doc; Epic 4's corpus map is where richer shape lands.

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run check:boundaries && pnpm -r build && pnpm -r test && pnpm test` -- expected: green with conformance e2e collected


## Auto Run Result

- **Summary:** Axiom #6 (conformance) is live as the fifth registered analyzer and the first consumer of the 1.8 structural corpus seed. Three all-warning rules — `naming-convention`, `file-placement`, `module-shape` — fire only when the corpus CONFIRMS a convention (>=10 samples, >=80% dominance, integer-compared), which is how FR-5 is enforced rather than asserted. The judged/voter split is the load-bearing correction from review: changed paths absent from the corpus are judged (new decisions), existing corpus paths vote and are left alone, so a diff can neither confirm its own convention nor shrink the evidence against itself. A missing seed is inconclusive-and-declared (printed, exit-neutral); an unreadable, unparseable, schema-invalid or empty one is a real degradation. Review pass applied 24 patches (3 high).
- **Files changed:** `packages/contracts/src/structural-seed.ts` (new schema + invariants) and `run-manifest.ts` (`corpusSeedHash`); `packages/core/src/analyzers/axiom6-conformance.ts` (new) + test, `knowledge/structural-seed.ts` (shared types + single read), `pipeline/pipeline.ts` (registration, declaredOnly partitioning, seed read/hash/plumbing), `pipeline/manifest.ts` (RULESET 6, corpusSeedHash), `init/init.ts` + `cli/src/review-command.ts` (axiom-6 prompt/category, inconclusive line); `docs/rules/axiom-6-conformance.md` (new), `README.md`, `CHANGELOG.md`; `tests/__fixtures__/conformance-rules/` (new, corpus derived by a real `guardrails init`), `tests/integration/conformance-rules.e2e.test.ts` (new); `tests/e2e-coverage.md`.
- **Review findings breakdown:** 24 patched (3 high, 6 medium, 15 low), 2 deferred (seed trust model → Epic 4; cross-platform artifact parity → 1.14/1.18), 1 rejected, 0 intent_gap, 0 bad_spec.
- **Follow-up review recommendation:** true — auto-forced by three HIGH inline findings (FOLLOW-UP-REVIEW AUTO-FORCE ON HIGH) and the accepted oversized flag.
- **Verification:** `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:boundaries`, `pnpm -r build`, `pnpm -r test` (52 contracts + 370 core + 8 cli), `pnpm test` (33 files / 526 tests) — all green after patches.
- **Residual risks:** The prevalence gate measures repetition, not consensus — ten files can be one scaffold generator; SPIKE-4 (1.17) is where the noise profile gets measured. Re-running `init` mid-diff folds new files into the corpus (documented ceiling). The seed is unauthenticated and findings can vary by platform — both ledgered. `confidence: 1` means the rule fired deterministically, not that the convention is certainly right — stated in the doc.
