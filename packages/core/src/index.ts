/**
 * @agentic-guardrails/core — the deterministic, LLM-free engine (ADR-005).
 *
 * Story 1.3 surface: the LanguageAdapter seam (ADR-004), its ts-morph
 * TypeScript implementation, and the deterministic import-graph API.
 */
import { CONTRACTS_PACKAGE } from "@agentic-guardrails/contracts";

export const CORE_PACKAGE = "@agentic-guardrails/core" as const;

/** Re-exposes the contracts sentinel to prove the topological build. */
export const CORE_CONTRACTS_LINK = CONTRACTS_PACKAGE;

export * from "./adapter/language-adapter.js";
export * from "./adapter/typescript-adapter.js";
export * from "./graph/import-graph.js";
