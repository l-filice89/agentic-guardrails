#!/usr/bin/env node
// CI-run CLI for the structural dependency-boundary check (Story 1.1, Task 4).
//
// Separated from check-boundaries.mjs so the check ALWAYS runs when this file
// executes — there is no "am I the main module" guard whose failure mode
// would be a silent pass. Discovers every packages/* workspace package so a
// new package is checked (and fails closed) without editing this file.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { checkBoundaries } from "./check-boundaries.mjs";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const packagesDir = path.join(repoRoot, "packages");

const packagesByDir = {};
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkgPath = path.join(packagesDir, entry.name, "package.json");
  packagesByDir[entry.name] = JSON.parse(readFileSync(pkgPath, "utf8"));
}

const violations = checkBoundaries(packagesByDir);

if (violations.length > 0) {
  console.error("Boundary check failed:");
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Boundary check passed (${Object.keys(packagesByDir).join(", ")}): workspace deps within declared boundaries, no LLM SDK dependencies.`,
  );
}
