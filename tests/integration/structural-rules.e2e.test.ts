/**
 * Story 1.9 structural-rules e2e: copies the on-disk
 * `tests/__fixtures__/structural-rules/` fixtures (tsconfig + src +
 * boundaries config) into temp git repos, spawns the BUILT CLI, and
 * machine-compares the persisted findings against `expected-findings.json`
 * (the `expected-graph.json` pattern applied to findings): the violation
 * fixture yields exactly the oracle findings byte-stably (asserted twice,
 * normalizing only cache truth), the clean fixture yields ZERO findings
 * (false-positive guard feeding SPIKE-4), and the 1.6 off/advisory
 * machinery is verified against the grown rule set.
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
const fixturesDir = path.join(repoRoot, "tests", "__fixtures__", "structural-rules");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-structural-e2e-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, shell: false, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

/**
 * Temp git repo from a fixture: tsconfig + boundaries config committed as
 * the base, the entire `src/` tree left UNTRACKED — every fixture source is
 * a changed file, which is exactly the scope the rules review.
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

beforeAll(() => {
  if (!existsSync(cliPath)) {
    throw new Error(`built CLI missing at ${cliPath} — run \`pnpm -r build\` first`);
  }
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("guardrails review — axiom-1 structural rule set e2e (Story 1.9)", () => {
  it("violation fixture matches expected-findings.json exactly — all four rules, real lines, byte-stable twice", () => {
    const repo = makeRepo("violation");
    const golden = readFileSync(path.join(fixturesDir, "violation", "expected-findings.json"), "utf8");

    // The unresolved import is ALSO a declared coverage degradation
    // (coverage truth stays) — degradation dominance makes this exit 2.
    const first = runCli(repo);
    expect(first.status).toBe(2);
    const firstArtifact = readSingleArtifact(repo);
    expect(reviewArtifactSchema.safeParse(firstArtifact.artifact).success).toBe(true);
    for (const finding of firstArtifact.artifact["findings"] as unknown[]) {
      expect(findingSchema.safeParse(finding).success).toBe(true);
    }
    // ORACLE: machine-compared, byte-for-byte.
    expect(findingsBytes(firstArtifact.artifact)).toBe(golden);
    // The paired graph degradation for the unresolved import is still there.
    expect(
      (firstArtifact.artifact["degraded"] as { reason: string }[]).some(
        (d) => d.reason === "unresolvable import specifier",
      ),
    ).toBe(true);

    // Determinism: identical input ⇒ byte-identical artifact (modulo the
    // documented manifest.cache carve-out).
    expect(runCli(repo).status).toBe(2);
    const secondArtifact = readSingleArtifact(repo);
    expect(findingsBytes(secondArtifact.artifact)).toBe(golden);
    expect(normalizeCacheTruth(secondArtifact.raw)).toBe(normalizeCacheTruth(firstArtifact.raw));
  });

  it("clean fixture yields ZERO findings (boundaries declared, all imports legal), exit 0 — and a warm run cache-HITS byte-identically", () => {
    const repo = makeRepo("clean");
    const result = runCli(repo);
    expect(result.stderr).not.toContain("degraded");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0 findings (0 errors, 0 warnings, 0 info)");
    const first = readSingleArtifact(repo);
    expect(reviewArtifactSchema.safeParse(first.artifact).success).toBe(true);
    expect(first.artifact["findings"]).toEqual([]);

    // Cache-HIT byte identity over the NEW 1.9 payload fields (edge `line`,
    // `unresolvedImports`): only the clean fixture can carry this — the
    // violation fixture degrades, and degraded results are never cached.
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

  it("axiom 1 off: analyzer skipped and declared in manifest.axiomsOff, no structural findings", () => {
    const repo = makeRepo("clean");
    // Direction breach in an uncommitted file — would fire if axiom 1 ran.
    writeFileSync(
      path.join(repo, "src", "lib", "sneaky.ts"),
      'import { main } from "../app/main.js";\nexport const sneaky = main;\n',
    );
    const config = readFileSync(path.join(repo, "_agentic-guardrails", "config.yaml"), "utf8");
    writeFileSync(
      path.join(repo, "_agentic-guardrails", "config.yaml"),
      config.replace("axioms: {}", "axioms:\n  '1':\n    enforcement: 'off'"),
    );
    const result = runCli(repo);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("structural/");
    const { artifact } = readSingleArtifact(repo);
    expect(artifact["findings"]).toEqual([]);
    expect((artifact["manifest"] as Record<string, unknown>)["axiomsOff"]).toEqual(["1"]);
  });

  it("axiom 1 advisory: findings present and persisted, gate passes (exit 0)", () => {
    const repo = makeRepo("clean");
    writeFileSync(
      path.join(repo, "src", "lib", "sneaky.ts"),
      'import { main } from "../app/main.js";\nexport const sneaky = main;\n',
    );
    const config = readFileSync(path.join(repo, "_agentic-guardrails", "config.yaml"), "utf8");
    writeFileSync(
      path.join(repo, "_agentic-guardrails", "config.yaml"),
      config.replace("axioms: {}", "axioms:\n  '1':\n    enforcement: advisory"),
    );
    const result = runCli(repo);
    expect(result.status).toBe(0); // advisory error finding never gates
    expect(result.stdout).toContain("structural/dependency-direction");
    const { artifact } = readSingleArtifact(repo);
    const findings = artifact["findings"] as Record<string, unknown>[];
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "structural/dependency-direction",
      severity: "error",
    });
    expect((artifact["gate"] as Record<string, unknown>)["pass"]).toBe(true);
  });
});
