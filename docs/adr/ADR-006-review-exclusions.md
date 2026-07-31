# ADR-006: Review-Scope Exclusions — Config-Driven Path Prefixes, Declared Never Silent

## Status

Accepted — 2026-07-31 (Story 1.18)

## Context

The dogfood self-gate (deferred from Story 1.12): this repo's own analyzer
fixtures are deliberately dirty — non-allowlisted fake credentials, planted
cycles — so any review touching `tests/__fixtures__/` trips a blocking gate
in the very repo that ships the analyzers. The same problem generalizes to
any consumer with vendored or generated trees they do not want reviewed.
Candidate surfaces were a repo-level path-exclusion config, a `maxFindings`
allowance, or accepting the gate on fixture changes.

## Decision

A new optional `exclude: string[]` key in `_agentic-guardrails/config.yaml`
(contracts `configSchema`), applied where the change set is built
(`packages/core/src/pipeline/scope.ts` — the same single site that already
excludes `_agentic-guardrails/`), for all four scopes including `--project`,
and to the changed-KLOC denominator (an excluded file is not part of the
reviewed change, either side of the score's ratio).

- **Prefixes, not globs.** Entries are literal posix repo-relative path
  prefixes, whole-segment matched (`tests/fixtures` never matches
  `tests/fixtures2.ts`), trailing `/` tolerated, case folded by the same
  `foldCase` rule every other path compare uses. A glob engine is a later
  need with real cost (engine choice, escaping, platform semantics); every
  actual exclusion need so far is a directory or a file. The schema rejects
  glob characters, backslashes, and absolute paths with the offending index
  named.
- **Declared, never silent.** Excluded files are counted per run and
  declared: an exit-neutral degradation (subject `scope-exclusions`) naming
  the count and the governing prefixes lands in the persisted artifact, the
  CLI prints a `guardrails review: excluded: …` line, and a configured
  `exclude` is an FR-31 deviation line at run start. A silent exclusion is a
  coverage hole nobody can audit.
- **Narrow entries over an allowlist** (Block-If human ruling, 2026-07-31).
  Fake credentials living outside the fixture trees are handled by one
  generated-artifacts tree exclusion (`_bmad-output/`) plus two exact
  test-file paths — not a pattern allowlist mechanism and not relocation of
  the fakes. A new fake in a new file re-trips the gate deliberately,
  forcing a fresh human ruling instead of silently matching a pattern.

## Consequences

- `maxFindings` allowances stay what they are (error tolerance on a blocking
  axiom), not a fixture-management tool; analyzer defaults are not weakened
  to make dogfood pass.
- The exclusion list is part of the committed config, so it is hashed into
  the runId and visible in every run's deviation report — changing it is a
  visible, reviewable act.
- Two accepted limits, stated rather than hidden: a prefix that matches
  nothing this run is silent by design (per-run it is indistinguishable
  from a change that simply did not touch that tree — the FR-31 deviation
  line still declares the configured key at every run start); and
  exclusions are all-axiom — the two excluded test files are unreviewed by
  EVERY axiom in dogfood runs, an accepted cost of the ruling.
- Globs (or per-axiom exclusions) remain possible later behind the same key;
  the validation errors already steer users away from writing glob syntax
  that would silently match nothing. A filename that literally contains
  glob characters (`pages/[id].ts`) therefore cannot be excluded by exact
  path — exclude its parent directory instead.
