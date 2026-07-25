/**
 * Story 1.11 nfr-rules e2e: copies the on-disk
 * `tests/__fixtures__/nfr-rules/` fixtures (tsconfig + src + config) into
 * temp git repos, spawns the BUILT CLI, and machine-compares the persisted
 * findings against `expected-findings.json`: the violation fixture yields
 * exactly the oracle findings byte-stably (asserted twice, normalizing only
 * cache truth) and — all axiom-4 findings being warnings by design — the
 * run EXITS 0 with the findings persisted (the honest structural-tier
 * posture, not a bug); the clean fixture yields ZERO findings and a warm
 * run cache-HITS byte-identically; the 1.6 off/advisory machinery is
 * verified against the axiom-4 rule set.
 *
 * Requires `pnpm -r build` first (CI builds before tests).
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Spawn-heavy e2e: each test spawns the built CLI (git init + ts-morph
// parses, often several times); under full-suite parallel load a single
// test legitimately exceeds the 5s default.
vi.setConfig({ testTimeout: 120_000 });

import { findingSchema, reviewArtifactSchema } from "@agentic-guardrails/contracts";

import { normalizeCacheTruth } from "../../packages/core/src/pipeline/normalize-cache-truth.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const fixturesDir = path.join(repoRoot, "tests", "__fixtures__", "nfr-rules");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-nfr-e2e-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, shell: false, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

/**
 * Temp git repo from a fixture: tsconfig + config committed as the base,
 * the entire `src/` tree left UNTRACKED — every fixture source is a changed
 * file, which is exactly the scope the rules review.
 */
function makeRepo(fixture: "violation" | "clean"): string {
  const fixtureDir = path.join(fixturesDir, fixture);
  const dir = tempDir();
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  cpSync(path.join(fixtureDir, "tsconfig.json"), path.join(dir, "tsconfig.json"));
  mkdirSync(path.join(dir, "_agentic-guardrails"), { recursive: true });
  cpSync(
    path.join(fixtureDir, "config.yaml"),
    path.join(dir, "_agentic-guardrails", "config.yaml"),
  );
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "base"]);
  cpSync(path.join(fixtureDir, "src"), path.join(dir, "src"), { recursive: true });
  return dir;
}

function runCli(cwd: string) {
  return spawnSync(process.execPath, [cliPath, "review"], { cwd, shell: false, encoding: "utf8" });
}

function readSingleArtifact(repo: string): { raw: string; artifact: Record<string, unknown> } {
  const dir = path.join(repo, "_agentic-guardrails", "reviews", "uncommitted");
  const entries = readdirSync(dir);
  expect(entries).toHaveLength(1);
  const raw = readFileSync(path.join(dir, entries[0]!), "utf8");
  return { raw, artifact: JSON.parse(raw) as Record<string, unknown> };
}

/** Canonical findings bytes, comparable against the oracle file. */
function findingsBytes(artifact: Record<string, unknown>): string {
  return `${JSON.stringify(artifact["findings"], null, 2)}\n`;
}

/** Uncommitted axiom-4-only violation for the off/advisory rows: a fetch
 * without a signal (invisible to axioms 1 and 3 — no imports, zero
 * importers, tiny body). */
function addFetchFile(repo: string): void {
  writeFileSync(
    path.join(repo, "src", "extra.ts"),
    "export async function extra(url: string): Promise<number> {\n  const res = await fetch(url);\n  return res.status;\n}\n",
  );
}

/** Rewrite the fixture config's `axioms: {}` anchor; a no-op replacement
 * throws so fixture drift can never make the off/advisory tests vacuous. */
function setAxioms(repo: string, axiomsYaml: string): void {
  const configPath = path.join(repo, "_agentic-guardrails", "config.yaml");
  const config = readFileSync(configPath, "utf8");
  const replaced = config.replace("axioms: {}", axiomsYaml);
  if (replaced === config) {
    throw new Error("fixture drift: `axioms: {}` anchor not found in config.yaml");
  }
  writeFileSync(configPath, replaced);
}

beforeAll(() => {
  if (!existsSync(cliPath)) {
    throw new Error(`built CLI missing at ${cliPath} — run \`pnpm -r build\` first`);
  }
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("guardrails review — axiom-4 NFR rule set e2e (Story 1.11)", () => {
  it("violation fixture matches expected-findings.json exactly — all three rules, real lines, all warnings, EXIT 0 with findings persisted, byte-stable twice", () => {
    const repo = makeRepo("violation");
    const golden = readFileSync(
      path.join(fixturesDir, "violation", "expected-findings.json"),
      "utf8",
    );

    // Every import resolves and no degradation fires. All axiom-4 findings
    // are WARNINGS by design (the structural tier flags hazard patterns, it
    // cannot prove runtime context), so the gate PASSES: exit 0 WITH the
    // findings persisted — the honest posture, asserted explicitly.
    const first = runCli(repo);
    expect(first.stderr).not.toContain("degraded");
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("5 findings (0 errors, 5 warnings, 0 info)");
    const firstArtifact = readSingleArtifact(repo);
    expect(reviewArtifactSchema.safeParse(firstArtifact.artifact).success).toBe(true);
    const findings = firstArtifact.artifact["findings"] as Record<string, unknown>[];
    expect(findings).toHaveLength(5);
    for (const finding of findings) {
      expect(findingSchema.safeParse(finding).success).toBe(true);
      expect(finding).toMatchObject({
        axiom: "4",
        tier: "deterministic",
        source: "ast",
        confidence: 1,
        severity: "warning",
      });
    }
    // ORACLE: machine-compared, byte-for-byte.
    expect(findingsBytes(firstArtifact.artifact)).toBe(golden);

    // Determinism: identical input ⇒ byte-identical artifact (modulo the
    // documented manifest.cache carve-out).
    expect(runCli(repo).status).toBe(0);
    const secondArtifact = readSingleArtifact(repo);
    expect(findingsBytes(secondArtifact.artifact)).toBe(golden);
    expect(normalizeCacheTruth(secondArtifact.raw)).toBe(normalizeCacheTruth(firstArtifact.raw));
  });

  it("clean fixture yields ZERO findings, exit 0 — and a warm run cache-HITS byte-identically", () => {
    const repo = makeRepo("clean");
    const result = runCli(repo);
    expect(result.stderr).not.toContain("degraded");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0 findings (0 errors, 0 warnings, 0 info)");
    const first = readSingleArtifact(repo);
    expect(reviewArtifactSchema.safeParse(first.artifact).success).toBe(true);
    expect(first.artifact["findings"]).toEqual([]);

    // Cache-HIT byte identity: the warm run serves the identical data.
    const warm = runCli(repo);
    expect(warm.status).toBe(0);
    const second = readSingleArtifact(repo);
    // EXACT counter shape: one findings hit per registered analyzer (axioms
    // 1, 3, 4), no graph acquisition (every analyzer was served whole), no
    // misses, no invalid entries.
    expect((second.artifact["manifest"] as Record<string, unknown>)["cache"]).toEqual({
      hits: 3,
      misses: 0,
      invalid: 0,
    });
    expect(normalizeCacheTruth(second.raw)).toBe(normalizeCacheTruth(first.raw));
  });

  it("axiom 4 off: analyzer skipped and declared in manifest.axiomsOff, no nfr findings", () => {
    const repo = makeRepo("clean");
    addFetchFile(repo); // would fire if axiom 4 ran
    setAxioms(repo, "axioms:\n  '4':\n    enforcement: 'off'");
    const result = runCli(repo);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("nfr/");
    const { artifact } = readSingleArtifact(repo);
    expect(artifact["findings"]).toEqual([]);
    expect((artifact["manifest"] as Record<string, unknown>)["axiomsOff"]).toEqual(["4"]);
  });

  it("axiom 4 advisory: findings present and persisted, gate passes (exit 0)", () => {
    const repo = makeRepo("clean");
    addFetchFile(repo);
    setAxioms(repo, "axioms:\n  '4':\n    enforcement: advisory");
    const result = runCli(repo);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("nfr/missing-abort-signal");
    const { artifact } = readSingleArtifact(repo);
    const findings = artifact["findings"] as Record<string, unknown>[];
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "nfr/missing-abort-signal",
      severity: "warning",
    });
    expect((artifact["gate"] as Record<string, unknown>)["pass"]).toBe(true);
  });
});
