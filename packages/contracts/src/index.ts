/**
 * @agentic-guardrails/contracts — the single source of truth for every
 * canonical shape crossing package boundaries (ADR-005). Pure Zod schemas
 * plus pure functions; no I/O, no LLM SDKs, `zod` is the only runtime
 * dependency.
 */
export const CONTRACTS_PACKAGE = "@agentic-guardrails/contracts" as const;

export * from "./config.js";
export * from "./disposition-record.js";
export * from "./envelope.js";
export * from "./finding.js";
export * from "./finding-id.js";
export * from "./ledger.js";
export * from "./migration.js";
export * from "./partial-result.js";
export * from "./review-artifact.js";
export * from "./run-manifest.js";
export * from "./trend-record.js";
