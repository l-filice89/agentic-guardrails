# E2E Coverage Map

Per-story map of UI-facing acceptance criteria to end-to-end coverage.

| Story | UI-facing ACs | E2E coverage |
|---|---|---|
| 1.2 Canonical contracts package | None — library package only; first UI surface is the CLI in Story 1.4 | n/a |
| 1.3 TypeScript LanguageAdapter and import graph | None — library layer only; first UI surface is the CLI in Story 1.4 | n/a |
| 1.4 Walking skeleton — first end-to-end review | `guardrails review` CLI flow: circular-import findings in the stdout summary + exit 1; clean tree / no-violation change exit 0; non-repo preflight failure exit 2 (stderr, no artifact); artifact + embedded manifest persisted and schema-valid; byte-identical artifact across identical runs | `tests/integration/walking-skeleton.e2e.test.ts` (spawns the built `packages/cli/dist/index.js` against temp git repos) |
| 1.5 SPIKE-3 import-graph cost at scale | None — measurement spike, no UI flow; deliverable is `docs/spikes/SPIKE-3-import-graph-cost.md` plus the committed harness (`scripts/spike-3-benchmark.mjs`, run manually) | n/a |
| 1.6 Config plane | `_agentic-guardrails/config.yaml` drives `guardrails review`: invalid enum/typo key/malformed YAML → exit 2 with the offending path or line/column on stderr (no stack trace); advisory axiom with error findings exits 0 with findings still printed + persisted (bypass hazard); `maxFindings` threshold boundary (exactly N vs N+1); `off` axiom skipped and declared in the manifest's `axiomsOff`; deviation lines + "using defaults (no config file)" on stderr; `config.schema.json` generated beside the YAML; config content changes the runId | `tests/integration/config-plane.e2e.test.ts` |
