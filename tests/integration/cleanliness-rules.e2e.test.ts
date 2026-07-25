/**
 * Story 1.10 cleanliness-rules e2e: copies the on-disk
 * `tests/__fixtures__/cleanliness-rules/` fixtures (tsconfig + src + config)
 * into temp git repos, spawns the BUILT CLI, and machine-compares the
 * persisted findings against `expected-findings.json`: the violation fixture
 * yields exactly the oracle findings byte-stably (asserted twice, normalizing
 * only cache truth), the clean fixture yields ZERO findings and a warm run
 * cache-HITS byte-identically, and the 1.6 off/advisory machinery is
 * verified against the axiom-3 rule set.
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
const fixturesDir = path.join(repoRoot, "tests", "__fixtures__", "cleanliness-rules");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-cleanliness-e2e-"));
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

/** Uncommitted axiom-3-only violation for the off/advisory rows: a
 * zero-importer file with unreachable code (exempt from unused-export,
 * invisible to axiom 1). */
function addUnreachableFile(repo: string): void {
  writeFileSync(
    path.join(repo, "src", "extra.ts"),
    "export function extra(): number {\n  return 1;\n  const dead = 2;\n  void dead;\n}\n",
  );
}

beforeAll(() => {
  if (!existsSync(cliPath)) {
    throw new Error(`built CLI missing at ${cliPath} — run \`pnpm -r build\` first`);
  }
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("guardrails review — axiom-3 cleanliness rule set e2e (Story 1.10)", () => {
  it("violation fixture matches expected-findings.json exactly — all four rules, real lines, byte-stable twice", () => {
    const repo = makeRepo("violation");
    const golden = readFileSync(
      path.join(fixturesDir, "violation", "expected-findings.json"),
      "utf8",
    );

    // Every import resolves and no degradation fires: the exit code is the
    // honest gate verdict (blocking findings → 1), never a degraded 2.
    const first = runCli(repo);
    expect(first.stderr).not.toContain("degraded");
    expect(first.status).toBe(1);
    const firstArtifact = readSingleArtifact(repo);
    expect(reviewArtifactSchema.safeParse(firstArtifact.artifact).success).toBe(true);
    for (const finding of firstArtifact.artifact["findings"] as unknown[]) {
      expect(findingSchema.safeParse(finding).success).toBe(true);
    }
    // ORACLE: machine-compared, byte-for-byte.
    expect(findingsBytes(firstArtifact.artifact)).toBe(golden);

    // Determinism: identical input ⇒ byte-identical artifact (modulo the
    // documented manifest.cache carve-out).
    expect(runCli(repo).status).toBe(1);
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

    // Cache-HIT byte identity over the 1.10 payload (edge `names` in the
    // cached graph): only the clean fixture can carry this — degraded
    // results are never cached.
    const warm = runCli(repo);
    expect(warm.status).toBe(0);
    const second = readSingleArtifact(repo);
    const cache = (second.artifact["manifest"] as Record<string, unknown>)["cache"] as {
      hits: number;
      invalid: number;
    };
    expect(cache.hits).toBeGreaterThan(0);
    expect(cache.invalid).toBe(0);
    expect(normalizeCacheTruth(second.raw)).toBe(normalizeCacheTruth(first.raw));
  });

  it("graph payload roundtrip: with findings entries deleted, the warm run rebuilds findings FROM the cached graph byte-identically", () => {
    const repo = makeRepo("clean");
    const cold = runCli(repo);
    expect(cold.status).toBe(0);
    const first = readSingleArtifact(repo);

    // A findings-cache hit would skip the graph build entirely — delete the
    // findings entries (keep the graph entries) so the second run MUST
    // deserialize the cached graph payload and recompute findings from it.
    rmSync(path.join(repo, "_agentic-guardrails", ".cache", "findings"), {
      recursive: true,
      force: true,
    });
    const warm = runCli(repo);
    expect(warm.status).toBe(0);
    const second = readSingleArtifact(repo);
    const cache = (second.artifact["manifest"] as Record<string, unknown>)["cache"];
    // Exactly ONE graph hit (one tsconfig; the run-local memo covers the
    // second graph consumer) and FOUR findings misses (axioms 1, 3, 4, 5 —
    // 1.12): the findings were recomputed from the deserialized graph, not
    // served whole.
    expect(cache).toMatchObject({ hits: 1, misses: 4, invalid: 0 });
    expect(normalizeCacheTruth(second.raw)).toBe(normalizeCacheTruth(first.raw));
  });

  it("axiom 3 off: analyzer skipped and declared in manifest.axiomsOff, no cleanliness findings", () => {
    const repo = makeRepo("clean");
    addUnreachableFile(repo); // would fire if axiom 3 ran
    const config = readFileSync(path.join(repo, "_agentic-guardrails", "config.yaml"), "utf8");
    writeFileSync(
      path.join(repo, "_agentic-guardrails", "config.yaml"),
      config.replace("axioms: {}", "axioms:\n  '3':\n    enforcement: 'off'"),
    );
    const result = runCli(repo);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("cleanliness/");
    const { artifact } = readSingleArtifact(repo);
    expect(artifact["findings"]).toEqual([]);
    expect((artifact["manifest"] as Record<string, unknown>)["axiomsOff"]).toEqual(["3"]);
  });

  it("axiom 3 advisory: findings present and persisted, gate passes (exit 0)", () => {
    const repo = makeRepo("clean");
    addUnreachableFile(repo);
    const config = readFileSync(path.join(repo, "_agentic-guardrails", "config.yaml"), "utf8");
    writeFileSync(
      path.join(repo, "_agentic-guardrails", "config.yaml"),
      config.replace("axioms: {}", "axioms:\n  '3':\n    enforcement: advisory"),
    );
    const result = runCli(repo);
    expect(result.status).toBe(0); // advisory error finding never gates
    expect(result.stdout).toContain("cleanliness/unreachable-code");
    const { artifact } = readSingleArtifact(repo);
    const findings = artifact["findings"] as Record<string, unknown>[];
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "cleanliness/unreachable-code",
      severity: "error",
    });
    expect((artifact["gate"] as Record<string, unknown>)["pass"]).toBe(true);
  });
});
