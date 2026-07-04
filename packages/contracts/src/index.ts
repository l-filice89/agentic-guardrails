/**
 * Placeholder entry point for @agentic-guardrails/contracts.
 *
 * Real Zod schemas (Finding, RunManifest, envelope, config, ledger, spec,
 * trends) land in Story 1.2 (ADR-005). This sentinel only proves the
 * pnpm-workspaces + TS project references + tsup build harness works
 * end-to-end, and that `core` can depend on `contracts` topologically.
 */
export const CONTRACTS_PACKAGE = "@agentic-guardrails/contracts" as const;
