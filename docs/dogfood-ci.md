# Dogfood CI (Story 1.18)

This repo reviews its own PRs with its own tool — the M1 gate ("100% of PRs
reviewed at zero LLM cost"), mechanized.

## The CI step

`.github/workflows/ci.yml` runs, on `pull_request` only, after Build (deps
installed, CLI built):

```
git fetch origin "$GITHUB_BASE_REF"
node packages/cli/dist/index.js review --branch HEAD --base "origin/$GITHUB_BASE_REF" --no-input
```

- Direct CLI invocation — no packaged GitHub Action, no new workflow file.
- Deterministic-only (`--no-input`; the only mode that exists). Blocking
  findings fail the check via the CLI's own nonzero exit.
- **<60s (NFR-1):** the envelope is ENFORCED by the step, not assumed —
  wall-clock is measured in the step itself (bash `SECONDS`), printed on
  every run (success included), and the step fails naming the measured
  duration at ≥60s. Local datapoint (2026-07-31, Windows dev box): the
  branch-scope review of this repo's full epic diff vs `main` completes in
  ~10s; this repo is well under the ~1,000-file reference size.
- A fork PR whose base ref cannot be fetched fails loudly at the `git fetch`
  — never a silent skip. Pushes to `main` skip the step (no base ref).
- External surface: only GitHub Actions' default `GITHUB_TOKEN`; the tool
  itself has zero egress.

## Artifact: upload, never commit

`--no-input` makes the artifact disposition `drop`, which leaves the per-run
artifact untracked on disk under `_agentic-guardrails/reviews/`. The workflow
uploads that directory via `actions/upload-artifact@v4` with
`if: always()` — a failing review's artifact is the one you want to read —
and commits nothing from CI. Upload-without-committing IS the configured
policy, not a workaround.

## Determinism required check

The byte-identity parity assertions already run in CI's integration project:
the five `tests/integration/*-rules.e2e.test.ts` suites each run the review
twice and compare artifacts byte-for-byte (modulo the documented
`manifest.cache` carve-out). That existing required check IS the determinism
gate — no second determinism harness exists or is planned.

## Review exclusions (the self-gate fix)

The repo's own analyzer fixtures are deliberately dirty, so an unguarded
dogfood run gates on its own test data. `_agentic-guardrails/config.yaml`
declares config-driven posix path-prefix exclusions (see
[ADR-006](adr/ADR-006-review-exclusions.md)):

- `tests/__fixtures__/`, `tests/fixtures/` — the labeled fixture trees;
- `_bmad-output/` (a generated-artifacts tree — spec/planning documents
  that quote findings verbatim, fake credentials included) plus two exact
  test-file paths, `packages/core/src/analyzers/axiom5-security.test.ts`
  and `packages/core/src/pipeline/pipeline.test.ts`, carrying fake
  credentials as inline test fixtures (Block-If human ruling, 2026-07-31).
  Deliberately narrow: a new fake credential in a new file re-trips the
  gate and forces a fresh ruling — no allowlist mechanism, no relocation
  of the fakes.

Exclusions apply to every scope's change set AND the changed-KLOC
denominator, and are always counted and declared (manifest degradation with
subject `scope-exclusions` + a `guardrails review: excluded: …` report
line). Axiom enforcement stays at defaults — security remains blocking.

The companion fix: `tests/tsconfig.json` (referenced from the root
`tsconfig.json`, covering `tests/integration/`, `vitest.config.ts` and the
three `tsup.config.ts` files) closes the 1.4-era coverage gap where those
files belonged to no tsconfig project and every dogfood run exited 2 with
"changed file absent from the built import graph" degradations.

## Ledger rulings (DELEGATED-WORK-CARRIES-AN-AC)

The five deferred-work entries naming 1.18, each dispositioned in
`_bmad-output/implementation-artifacts/deferred-work.md`:

1. **Dogfood self-gate (from 1.12) — OWNED here.** Resolved by the `exclude`
   config surface above; the surface decision is config-driven path
   prefixes, declared never silent (ADR-006). Extended by the Block-If
   ruling with one generated-artifacts tree (`_bmad-output/`) and two exact
   test-file paths.
2. **Uncommitted-config policy (from 1.6) — RULED: current behavior
   stands.** An untracked/modified `config.yaml` may govern a run, declared
   in `manifest.configGitStatus` plus a stderr warning. The dogfood workflow
   runs from a clean CI checkout, so the governing config is committed by
   construction — no additional policy mechanism is warranted.
3. **Knowledge-file provenance asymmetry (from 1.8) — REASSIGNED to
   Epic 4.** No knowledge files participate in dogfood CI; the
   ledger/corpus lifecycle stories are where git-status provenance for
   `conventions.yaml`/`corpus-map.yaml` belongs.
4. **Cross-platform parity (from 1.13) — RULED: same-platform determinism is
   the asserted claim.** The determinism check runs on ubuntu CI with the
   byte-identity suite; cross-platform byte-parity is explicitly NOT
   claimed (foldCase is platform-dependent by design). The open product
   question stays ledgered for the epic-end operator sweep.
5. **SPIKE-5 Windows regression posture (from 1.14) — RULED: accepted
   one-time-evidence posture.** The maintainer's routine full-suite runs on
   Windows are the practical guard; a Windows CI runner stays ledgered as
   future work with this recorded reason.
