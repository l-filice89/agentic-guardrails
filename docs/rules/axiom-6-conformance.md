# Axiom #6 — Conformance Rules (structural tier)

The deterministic conformance rule set (`rulesetVersion: 6`, Story 1.13). All
three rules run inside the single registered axiom-6 analyzer; findings carry
`axiom: "6"`, `tier: "deterministic"`, `source: "ast"`, `confidence: 1`, and —
without exception — `severity: "warning"`.

**Every finding is a warning, on purpose.** Conformance is advisory by
nature: "this file is named wrong" is a judgement about house style, and the
1.10/1.12 lesson is that a false positive in a blocking rule gates legitimate
code. Only `error` findings count toward the gate, so a conformance rule set
can never fail a build on its own. Axiom 6 still defaults to `blocking`
enforcement like every other axiom (the config plane's `EFFECTIVE_DEFAULTS`)
— the severity, not the enforcement, is what keeps it non-gating.

## The corpus of record

The analyzer reads exactly one input beyond the diff: the persisted
**structural corpus seed** at
`_agentic-guardrails/.cache/corpus/structural-seed.json`, produced by
`guardrails init` (Story 1.8). The pipeline reads those bytes ONCE per run,
hashes that same buffer into axiom 6's cache key, records it in the manifest
as `corpusSeedHash`, and hands it to the analyzer — so the corpus that was
keyed, the corpus that was recorded, and the corpus that was judged against
are provably the same bytes even if a concurrent `guardrails init` rewrites
the file mid-run. It is JSON-parsed and validated through the contracts
`structuralSeedSchema` on every run. The analyzer never re-derives the corpus
and never parses corpus FILES for naming or placement — a whole-repo snapshot
costs one file read.

`manifest.corpusSeedHash` is **not** `manifest.corpusHash`: the latter is the
committed, human-curated `_agentic-guardrails/corpus-map.yaml` (1.8), the
former is the derived structural seed these rules actually measured.

### What votes, and what is judged

Externals first: seed entities with `external: true` are npm package
specifiers, not repo files. They never vote. A corpus of externals only is an
empty corpus.

The self-confirmation hazard — a diff confirming the convention it is judged
against — is closed by **what is judged**, not by shrinking the corpus. The
seed is a snapshot taken BEFORE the diff, so a changed file's presence in it
is itself evidence about when the decision was made:

| The changed file's path | naming / placement | votes? |
|---|---|---|
| **absent** from the corpus (a new file) | JUDGED — a genuinely new naming/placement decision | no: it is not in the corpus to vote with |
| **present** in the corpus (a modified file) | not judged — its name and location were decided before this diff, and modifying a file does not change its path | yes |

Module shape is scoped differently, because its evidence is import edges
rather than paths: every corpus file votes, but **edges whose `from` is a
changed file are dropped** — a new file importing another new file by default
binding must not "prove" that the imported file is a default module.

The earlier cut of this rule set excluded every changed file from the corpus
instead. That was strictly worse: added files were never in the seed anyway
(so the exclusion did nothing where the hazard was claimed), while modified
files shrank the sample in proportion to diff size — touching four files in a
twelve-file directory dropped the scope below `MIN_SAMPLE` and silenced the
analyzer exactly when the diff was biggest — and legacy off-convention files
were re-flagged on every unrelated edit, forever. Both directions are
regression-tested.

### `no_corpus` — inconclusive, never a false pass

An absent, unreadable, unparseable, schema-invalid, or empty seed produces
**zero findings plus exactly one typed degradation** whose reason begins
`no_corpus` and names the case. Subject is always `corpus-seed`; the analyzer
never throws.

| State | Degradation reason | Exit-neutral? |
|---|---|---|
| No seed file (ENOENT) | `no_corpus: seed file absent at <path> — run guardrails init to derive the structural corpus` | **yes** — declared only |
| Read error (EACCES/EISDIR/…) | `no_corpus: seed unreadable: <first line>` | no |
| Truncated / non-JSON | `no_corpus: seed invalid: not parseable JSON: <first line>` | no |
| Schema drift or a violated seed invariant | `no_corpus: seed invalid: <field path, or (root)>: <issue>` — e.g. `seed invalid: entities: duplicate entity file paths` | no |
| `entities: []` | `no_corpus: corpus empty — the seed declares no entities` | no |
| Externals only | `no_corpus: corpus empty — no repo files remain after excluding externals` | no |

Only the **absent** case is exit-neutral, and it is exit-neutral because the
analyzer DECLARES it so: it is returned in `AnalyzerResult.declaredOnly`,
which the pipeline splices into the artifact's `degraded` array (sorted, like
every sibling list) without counting it toward `runDegraded`. The pipeline
never inspects degradation reasons to decide this — a message that merely
starts with the right characters buys no exemption. An un-inited repo must not
have every review flipped to exit 2 by an advisory axiom; a **corrupt** seed
is a different thing entirely, and it counts, degrades the run, and exits 2
like any other lost coverage.

Exit-neutral is not silent. `guardrails review` prints every declared-only
degradation on its own stderr line:

```
guardrails review: inconclusive: no_corpus: seed file absent at … (corpus-seed)
```

An inconclusive run and a clean run must never look the same in the terminal.

### A partial census is declared

The seed carries the producer's partial-result envelope. When its `coverage`
is below 1, the conventions were measured on a corpus that admits it is
incomplete — if the half that failed to parse was the kebab half, kebab is
what gets flagged. That is a **real** degradation (`corpus partial: the
structural seed covered NN.N% of its import attempts …`, subject
`corpus-seed`), not a declaration, and the rules still run on what there is.
The contracts schema enforces the producer's own invariant on the way in:
`coverage < 1` requires at least one `degraded` entry, entity paths must be
unique (a duplicate double-votes) and `/`-separated (a backslash path has no
directory structure and collapses into the root bucket).

## The prevalence gate (FR-5)

Every rule routes through ONE gate. A pattern is **confirmed** only when:

| Threshold | Value | Rationale |
|---|---|---|
| `MIN_SAMPLE` | **10** classifiable corpus files in the scope | The smallest sample where an 80% majority still leaves room for two dissenters. Below it, "the convention" is indistinguishable from whatever the first few files happened to do. |
| `DOMINANCE` | **0.8** of the sample | Tolerates a fifth of the corpus being legacy or deliberate exceptions while still meaning "this repo has clearly decided". At 0.5 a coin-flip split would produce findings — style-policing, not conformance. Compared as integers (`best * 10 >= total * 8`), so the contract boundary does not rest on an IEEE-754 rounding coincidence. |

Below **either** bar the analyzer emits nothing — not a weaker finding, not
an info note. That is FR-5, not a preference, and it is tested behaviourally
from both directions of both thresholds (9 vs 10 samples, 7/10 vs 8/10
dominance). Thresholds are not configurable this story.

The gate is genuinely the only one: the `qualified` flag it returns
(`total >= MIN_SAMPLE`) is what the scope walks branch on, so no rule
re-implements the sample floor next to it.

**Evidence format.** Every message cites the measured counts as
`<dominant>/<sample>` plus the scope they were measured in — e.g. `kebab-case
in 12/12 named files under src/core`. A finding that cannot cite counts is a
finding that should not exist.

**`confidence: 1` means "this rule fired deterministically"**, which is the
contract value for the deterministic tier — it is NOT a claim that the
inferred convention is certainly the right one for your repo. These are
statistical inferences over a file-path census; the honest confidence signal
is the cited count, and the honest severity is `warning`.

### The scope walk

All three rules share one scope walk: from the changed file's own directory
up to the repo root, the **first scope whose sample reaches `MIN_SAMPLE`
decides** — confirmed or not. A local convention is never overruled by a
repo-wide one, and a scope that qualifies but has no dominant variant
silences the rule rather than deferring to an ancestor (a directory that has
genuinely not decided is not a directory that violates the repo's decision).
The scope actually used is named in every message.

## Rules

| ruleId | Severity | What it measures | Approximation | Fixture case |
|---|---|---|---|---|
| `conformance/naming-convention` | warning | A NEW path's basename **stem** (everything before the first dot, so `.test.ts`/`.d.ts`/`.config.mts` suffixes and the extension are stripped in one step) is classified as kebab / snake / Pascal / camel and compared with the nearest qualifying scope's confirmed style. Discriminator: rule + basename stem. | A single all-lowercase word (`index`, `utils`) is a valid spelling in kebab, snake AND camel — it carries no evidence, so it neither votes nor is judged. Its mirror image is excluded for the same reason: an all-caps stem with no lowercase at all (`README`, `LICENSE`, `HTTP`) and a single letter carry no casing intent and must not inflate the Pascal tally. Same for `SCREAMING_CASE`, dotfiles, and anything outside the four shapes. Directory scopes are matched by path prefix, case-folded on win32/darwin. | `tests/__fixtures__/conformance-rules/violation/diff/src/core/MyNewThing.ts` |
| `conformance/file-placement` | warning | A NEW path's **kind** — derived from the basename suffix: `.test.`, `.spec.`, `.config.`, or plain source — predominantly lives in one child directory of the nearest qualifying scope, and this file sits elsewhere. Buckets are **scope-relative**: within scope `packages/core`, `packages/core/src/a.ts` buckets as `src`, and a file sitting directly in the scope buckets as the scope itself. The message cites the prevailing location, its share, and the scope. Discriminator: rule + kind. | Granularity is one path segment below the scope: a `.test.` file moving between `tests/unit/` and `tests/e2e/` is invisible unless `tests/` is the qualifying scope. Scope-relative buckets are what make the rule work in a monorepo at all — the FIRST segment of every source file in a pnpm workspace is `packages`, which can only ever confirm "sources live under packages/". The `declaration` kind is corpus-only: the pipeline's `isAnalyzableTs` excludes `.d.ts` from the change set, so declarations vote but are never judged. | `tests/__fixtures__/conformance-rules/violation/diff/lib/stray-thing.ts` |
| `conformance/module-shape` | warning | Export shape inferred from what importers **bind**, using the import graph's per-edge `names` (Story 1.10): a file whose incoming edges bind only `default` is a default-binding module, only named bindings a named-binding module. The dominant form is computed over corpus files that HAVE importers within the nearest qualifying scope — so a `components/` tree that genuinely uses default exports establishes its own convention instead of being outvoted repo-wide. A changed file binding the minority form is flagged; the message cites both counts and the scope. Discriminator: rule + file (no `enclosingSymbol` — file-level identity). | **Inferred from import bindings, not from parsing the target's exports** — a stated approximation; Epic 4's corpus map is where richer shape lands. Edges FROM a changed file carry no evidence (the diff must not manufacture what it is judged by), so a file whose only importer is also new yields nothing. A file with no importers yields no evidence and no finding; so does one bound BOTH ways (ambiguous). Namespace (`import * as`) and bare side-effect imports carry no shape evidence. Type-only edges DO count — `import type { X }` is still a named binding, and export shape is a compile-time property. With no tsconfig there is no graph, and the rule DECLARES that it did not run rather than silently skipping. | `tests/__fixtures__/conformance-rules/violation/diff/src/core/odd-thing.ts` |

## Ceilings

Known, deliberate limits:

- **File-level substrate only.** The corpus seed's unit is the file: path,
  fan-in, external flag. No zone roles, no module purpose, no semantic
  clustering — that is Epic 4's corpus map.
- **No convention MINING and no ledger writes.** This analyzer only READS the
  derived seed. Deriving, confirming, and persisting conventions is Epic 4.
- **No LLM.** Naming and placement are pure over the sorted seed — one file
  read, no corpus parsing. Module shape is the exception and says so: it
  builds a full project import graph. That graph is shared with axioms 1 and
  3 through the run's graph cache, so it is usually free — but if those
  axioms are `off`, this advisory axiom triggers the parse on its own.
- **Module shape is inferred from bindings**, never from parsing the target's
  export statements (see the rule table).
- **Thresholds are fixed** at 10 / 0.8 this story — not configurable.
- **Changed files only**, and only the analyzable-TypeScript subset (the
  corpus itself is derived from the TypeScript import graph).
- **A stale seed is a stale corpus.** The seed is regenerated by
  `guardrails init`; between inits it is a snapshot. Its content hash IS part
  of axiom 6's findings-cache key and is recorded as `manifest.corpusSeedHash`,
  so a re-inited corpus never serves stale conformance findings.
- **The residual self-confirmation path is re-inventing mid-diff.** The
  judged/voter split rests entirely on the seed being a snapshot taken before
  the diff. Running `guardrails init` while a change is in flight folds the
  new files into the corpus, after which they vote on the conventions they
  are judged by. Nothing in the analyzer can detect that; the seed's snapshot
  timing is what closes the hazard.

## Finding identity

Discriminators are line-free and content-free: the basename stem
(naming), the kind (placement), or nothing at all (module shape — the file is
the identity). All findings anchor at the SYNTHETIC line 1: these are
whole-file conditions with no real import line, the same convention as
`structural/unassigned-file`. findingIds therefore survive every edit inside
the file; they change when the file is renamed or moved, which is exactly the
event the rules are about.

## Scope

Rules fire only for **changed files** (the reviewed change set), judged
against the persisted corpus. Machine oracle:
`tests/__fixtures__/conformance-rules/violation/expected-findings.json`
(byte-compared twice in `tests/integration/conformance-rules.e2e.test.ts`),
plus a clean fixture asserting zero findings and a warm cache-hit byte
identity, and a no-corpus fixture asserting the inconclusive contract (the
declaration in the artifact, the printed `inconclusive:` line, and exit 0). The
e2e fixtures run `guardrails init` inside the temp repo so the corpus is
REAL — derived by the 1.8 producer from the fixture's own import graph, never
a hand-written seed. All axiom-6 findings being warnings, the oracle run
**exits 0** with the findings persisted (asserted explicitly), with the
`advisory`/`off` rows verifying the 1.6 bypass machinery.
