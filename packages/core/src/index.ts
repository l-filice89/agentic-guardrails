/**
 * Placeholder entry point for @agentic-guardrails/core.
 *
 * `core` is the deterministic, LLM-free engine (ADR-005). This file only
 * proves two things at scaffold time: (1) `core` depends on `contracts` via
 * `workspace:*` and builds after it in topological order, and (2) the
 * forbidden-import lint wall (Task 4) protects this package's `src/` tree
 * from ever importing an LLM package or SDK.
 */
import { CONTRACTS_PACKAGE } from "@agentic-guardrails/contracts";

export const CORE_PACKAGE = "@agentic-guardrails/core" as const;

/** Re-exposes the contracts sentinel to prove the topological build. */
export const CORE_CONTRACTS_LINK = CONTRACTS_PACKAGE;
