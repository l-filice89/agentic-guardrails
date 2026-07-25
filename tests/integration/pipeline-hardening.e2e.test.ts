/**
 * Story 1.7 e2e: pipeline hardening + deterministic cache through the BUILT
 * CLI against temp git repos (pattern of walking-skeleton.e2e.test.ts).
 * Requires `pnpm -r build` first.
 */
import { spawnSync } from "node:child_process";
import {
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

import { reviewArtifactSchema, type ReviewArtifact } from "@agentic-guardrails/contracts";

import { normalizeCacheTruth } from "../../packages/core/src/pipeline/normalize-cache-truth.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-e2e-17-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, shell: false, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2023",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
  },
  include: ["src"],
});

/** Temp repo with a committed acyclic base and an uncommitted cycle. */
function makeRepoWithCycle(): string {
  const dir = tempDir();
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src", "a.ts"), 'import { b } from "./b.js";\nexport const a = b;\n');
  writeFileSync(path.join(dir, "src", "b.ts"), "export const b = 1;\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "base"]);
  writeFileSync(
    path.join(dir, "src", "b.ts"),
    'import { a } from "./a.js";\nexport const b = 1;\nexport const echo = a;\n',
  );
  return dir;
}

function runCli(cwd: string) {
  return spawnSync(process.execPath, [cliPath, "review"], { cwd, shell: false, encoding: "utf8" });
}

function readSingleArtifact(repo: string): { raw: string; artifact: ReviewArtifact } {
  const dir = path.join(repo, "_agentic-guardrails", "reviews", "uncommitted");
  const entries = readdirSync(dir);
  expect(entries).toHaveLength(1);
  const raw = readFileSync(path.join(dir, entries[0]!), "utf8");
  const parsed = reviewArtifactSchema.safeParse(JSON.parse(raw));
  expect(parsed.success).toBe(true);
  return { raw, artifact: parsed.data! };
}

function findingsCacheDir(repo: string): string {
  return path.join(repo, "_agentic-guardrails", ".cache", "findings");
}

beforeAll(() => {
  if (!existsSync(cliPath)) {
    throw new Error(`built CLI missing at ${cliPath} — run \`pnpm -r build\` first`);
  }
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("guardrails review — pipeline hardening e2e (1.7)", () => {
  it("cold run records misses, warm run HITS (analyzers skipped) with a byte-identical artifact modulo manifest.cache", () => {
    const repo = makeRepoWithCycle();

    expect(runCli(repo).status).toBe(1);
    const cold = readSingleArtifact(repo);
    expect(cold.artifact.manifest.cache).toBeDefined();
    expect(cold.artifact.manifest.cache!.hits).toBe(0);
    expect(cold.artifact.manifest.cache!.misses).toBeGreaterThan(0);
    // Cache populated under the gitignored .cache tree.
    expect(readdirSync(findingsCacheDir(repo)).length).toBeGreaterThan(0);
    expect(readFileSync(path.join(repo, "_agentic-guardrails", ".gitignore"), "utf8")).toContain(
      ".cache/",
    );

    const warm = runCli(repo);
    expect(warm.status).toBe(1); // same gate verdict — cache serves identical data
    const second = readSingleArtifact(repo);
    // The second run actually HIT — declared in the manifest, zero silence.
    expect(second.artifact.manifest.cache!.hits).toBeGreaterThan(0);
    expect(second.artifact.manifest.cache!.misses).toBe(0);
    expect(second.artifact.runId).toBe(cold.artifact.runId);
    expect(normalizeCacheTruth(second.raw)).toBe(normalizeCacheTruth(cold.raw));

    // Declared six-phase assembly: fixed shape, 2/3 empty-membership with why.
    const phases = second.artifact.manifest.phases!;
    expect(phases.map((p) => p.phase)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(phases[1]!.members).toEqual(["axiom-1"]);
    expect(phases[2]!.members).toEqual([]);
    expect(phases[2]!.reason).toContain("Epic 2");
    expect(phases[3]!.reason).toContain("Epic 3");
  });

  it("HAZARD: a corrupted cache entry still yields correct output plus a degradation note, and is overwritten", () => {
    const repo = makeRepoWithCycle();
    expect(runCli(repo).status).toBe(1);
    const entries = readdirSync(findingsCacheDir(repo));
    expect(entries).toHaveLength(1);
    const entryPath = path.join(findingsCacheDir(repo), entries[0]!);
    writeFileSync(entryPath, "{ torn garbage");

    const result = runCli(repo);
    // Correct output survived: the cycle is still found and reported.
    expect(result.stdout).toContain("structural/circular-import");
    expect(result.stdout).toContain("circular import: src/a.ts -> src/b.ts -> src/a.ts");
    // Degradation note (never silent) — degradation dominates the exit code.
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("invalid cache entry (recomputed and overwritten)");
    expect(result.stdout).toContain("degraded: cache/findings/axiom-1");
    const { artifact } = readSingleArtifact(repo);
    expect(artifact.manifest.cache!.invalid).toBeGreaterThan(0);
    // The corrupt entry was recomputed and overwritten with a valid one.
    expect(() => JSON.parse(readFileSync(entryPath, "utf8"))).not.toThrow();
    expect(runCli(repo).status).toBe(1); // next run hits cleanly again
  });

  it("HAZARD: a planted schema-valid cache entry (cache poisoning) is never served", () => {
    const repo = makeRepoWithCycle();
    expect(runCli(repo).status).toBe(1);
    const entries = readdirSync(findingsCacheDir(repo));
    expect(entries).toHaveLength(1);
    const entryPath = path.join(findingsCacheDir(repo), entries[0]!);
    // The attacker copies the REAL entry's schema-valid shape but swaps the
    // payload (here: "no findings" — hiding the cycle). The MAC no longer
    // matches, so the warm run must not serve it.
    const envelope = JSON.parse(readFileSync(entryPath, "utf8")) as {
      mac: string;
      payload: { findings: unknown[]; degraded: unknown[] };
    };
    expect(envelope.mac).toMatch(/^[0-9a-f]{64}$/); // entries are MAC-authenticated
    envelope.payload = { findings: [], degraded: [] };
    writeFileSync(entryPath, `${JSON.stringify(envelope)}\n`);

    const result = runCli(repo);
    // The planted "clean" result was rejected: the cycle is still reported,
    // the gate still fails, and the invalid entry is declared.
    expect(result.stdout).toContain("circular import: src/a.ts -> src/b.ts -> src/a.ts");
    expect(result.status).toBe(2); // degradation (invalid cache entry) dominates
    expect(result.stderr).toContain("invalid cache entry (recomputed and overwritten)");
    const { artifact } = readSingleArtifact(repo);
    expect(artifact.manifest.cache!.invalid).toBeGreaterThan(0);
    expect(artifact.findings.length).toBeGreaterThan(0);
    // Recomputed + re-signed: the next run hits cleanly again.
    expect(runCli(repo).status).toBe(1);
  });

  it("the report header lists degraded work (name + reason) above the findings block", () => {
    const repo = makeRepoWithCycle();
    // Force a degradation visible through the CLI: delete the root tsconfig
    // so discovery degrades while TS changes are present.
    rmSync(path.join(repo, "tsconfig.json"));
    const result = runCli(repo);
    expect(result.status).toBe(2);
    const headerAt = result.stdout.indexOf("degraded: tsconfig.json — root tsconfig.json not found");
    const artifactLineAt = result.stdout.indexOf("artifact:");
    expect(headerAt).toBeGreaterThanOrEqual(0);
    expect(artifactLineAt).toBeGreaterThan(headerAt); // header sits above the block
  });
});
