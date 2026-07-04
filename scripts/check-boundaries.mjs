#!/usr/bin/env node
// CI-run structural dependency-boundary check (Story 1.1, Task 4).
//
// The `no-restricted-imports` ESLint rule (eslint.config.js) guards source
// files; this script guards package.json manifests directly, enforcing:
//   1. `core`'s only permitted `@agentic-guardrails/*` dependency is
//      `contracts`.
//   2. `contracts` may depend on no `@agentic-guardrails/*` package at all.
//   3. Neither package may declare a known LLM SDK as a dependency,
//      devDependency, or peerDependency (defense-in-depth: a newly-named
//      SDK shouldn't be able to defeat the lint-only wall).
//
// `checkBoundaries` is a pure function over plain package.json objects so
// it is unit-testable without touching the filesystem (see
// scripts/check-boundaries.test.mjs). The CLI entry point below wires it to
// the real packages/{contracts,core}/package.json files when this module is
// run directly (`node scripts/check-boundaries.mjs`).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const LLM_SDK_DENYLIST = [
  "@agentic-guardrails/llm",
  "@anthropic-ai/sdk",
  "openai",
  "ollama",
  "@google/generative-ai",
];

export const ALLOWED_CORE_WORKSPACE_DEPS = new Set(["@agentic-guardrails/contracts"]);

function collectDeps(pkg) {
  return {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
    ...(pkg?.peerDependencies ?? {}),
  };
}

function isWorkspaceDep(name) {
  return name.startsWith("@agentic-guardrails/");
}

/**
 * @param {{ contracts: Record<string, unknown>, core: Record<string, unknown> }} packages
 * @returns {string[]} violation messages; empty array means the boundary holds.
 */
export function checkBoundaries({ contracts, core }) {
  const violations = [];

  const contractsDeps = collectDeps(contracts);
  for (const name of Object.keys(contractsDeps)) {
    if (isWorkspaceDep(name)) {
      violations.push(
        `contracts must have no @agentic-guardrails/* dependency, found "${name}"`,
      );
    }
  }

  const coreDeps = collectDeps(core);
  for (const name of Object.keys(coreDeps)) {
    if (isWorkspaceDep(name) && !ALLOWED_CORE_WORKSPACE_DEPS.has(name)) {
      violations.push(
        `core's only permitted @agentic-guardrails/* dependency is contracts, found "${name}"`,
      );
    }
  }

  for (const [pkgLabel, deps] of [
    ["contracts", contractsDeps],
    ["core", coreDeps],
  ]) {
    for (const denied of LLM_SDK_DENYLIST) {
      if (Object.prototype.hasOwnProperty.call(deps, denied)) {
        violations.push(
          `${pkgLabel} must not depend on LLM SDK "${denied}" (core is LLM-free, ADR-005)`,
        );
      }
    }
  }

  return violations;
}

function isRunAsScript() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isRunAsScript()) {
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
  const contractsPkgPath = path.join(repoRoot, "packages", "contracts", "package.json");
  const corePkgPath = path.join(repoRoot, "packages", "core", "package.json");

  const contracts = JSON.parse(readFileSync(contractsPkgPath, "utf8"));
  const core = JSON.parse(readFileSync(corePkgPath, "utf8"));

  const violations = checkBoundaries({ contracts, core });

  if (violations.length > 0) {
    console.error("Boundary check failed:");
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Boundary check passed: core -> contracts only, no LLM SDK dependencies.");
  }
}
