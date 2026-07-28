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
export * from "./analyzers/axiom1-structural.js";
export * from "./analyzers/axiom3-cleanliness.js";
export * from "./analyzers/axiom4-nfr.js";
export * from "./analyzers/axiom5-security.js";
export * from "./analyzers/axiom6-conformance.js";
export * from "./cache/deterministic-cache.js";
export * from "./config/config-loader.js";
// Explicit, not `export *`: `gitCommand` ("run any git subcommand in any
// cwd") stays an internal seam and is deliberately absent from this surface.
export {
  changedLinesIn,
  commitExists,
  commitPath,
  DEFAULT_BASE_CANDIDATES,
  diffNumstat,
  diffRefs,
  EMPTY_TREE_SHA,
  fileGitStatus,
  GIT_TIMEOUT_MS,
  headSha,
  isAncestor,
  isRepo,
  lsFiles,
  mergeBase,
  numstatAgainstHead,
  parseNameStatusZ,
  parseNumstatZ,
  parsePorcelainZ,
  refExists,
  repoRoot,
  resolveDefaultBase,
  revParse,
  uncommittedFiles,
  untrackedFiles,
  type ChangeSize,
  type CommitPathOutcome,
  type FileChangeSize,
  type FileGitStatus,
  type GitResult,
  type RefDiff,
  type GitRunOptions,
  type RepoRootFailureKind,
  type RepoRootResult,
} from "./git/git.js";
export * from "./git/worktree.js";
export * from "./graph/import-graph.js";
export * from "./init/init.js";
export * from "./init/wiring.js";
export * from "./knowledge/structural-seed.js";
export * from "./persistence/artifact-writer.js";
export * from "./persistence/history.js";
export * from "./report/score.js";
export * from "./report/trends.js";
export * from "./pipeline/gh-metadata.js";
export * from "./pipeline/manifest.js";
export * from "./pipeline/merge.js";
export * from "./pipeline/pipeline.js";
export * from "./pipeline/scope.js";
