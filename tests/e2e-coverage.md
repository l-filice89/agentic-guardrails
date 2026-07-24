# E2E Coverage Map

Per-story map of UI-facing acceptance criteria to end-to-end coverage.

| Story | UI-facing ACs | E2E coverage |
|---|---|---|
| 1.2 Canonical contracts package | None — library package only; first UI surface is the CLI in Story 1.4 | n/a |
| 1.3 TypeScript LanguageAdapter and import graph | None — library layer only; first UI surface is the CLI in Story 1.4 | n/a |
| 1.4 Walking skeleton — first end-to-end review | `guardrails review` CLI flow: circular-import findings in the stdout summary + exit 1; clean tree / no-violation change exit 0; non-repo preflight failure exit 2 (stderr, no artifact); artifact + embedded manifest persisted and schema-valid; byte-identical artifact across identical runs | `tests/integration/walking-skeleton.e2e.test.ts` (spawns the built `packages/cli/dist/index.js` against temp git repos) |
