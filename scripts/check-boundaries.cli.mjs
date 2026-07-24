#!/usr/bin/env node
// CI-run CLI for the structural dependency-boundary check (Story 1.1, Task 4).
//
// Separated from check-boundaries.mjs so the check ALWAYS runs when this file
// executes — there is no "am I the main module" guard whose failure mode
// would be a silent pass. Discovers every packages/* workspace package so a
// new package is checked (and fails closed) without editing this file.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { checkBoundaries } from "./check-boundaries.mjs";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const packagesDir = path.join(repoRoot, "packages");

function readManifest(dir, pkgPath) {
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch (error) {
    console.error(`Boundary check failed: cannot parse ${pkgPath}: ${error.message}`);
    process.exit(1);
  }
}

// The root manifest is scanned too (LLM SDK reachable from tooling otherwise).
const packagesByDir = { "(root)": readManifest("(root)", path.join(repoRoot, "package.json")) };
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  const entryPath = path.join(packagesDir, entry.name);
  // statSync (not the dirent) so symlinked package dirs are not fail-open skipped.
  if (!statSync(entryPath).isDirectory()) continue;
  const pkgPath = path.join(entryPath, "package.json");
  // A directory without a manifest is not a workspace package (pnpm skips it too).
  if (!existsSync(pkgPath)) continue;
  packagesByDir[entry.name] = readManifest(entry.name, pkgPath);
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
