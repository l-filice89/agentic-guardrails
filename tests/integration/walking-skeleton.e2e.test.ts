/**
 * Story 1.4 walking-skeleton e2e: spawns the BUILT CLI (`packages/cli/dist`)
 * against temp git repos and asserts the full joint chain — CLI → pipeline →
 * analyzer → atomic artifact — plus exit codes and byte-level determinism.
 *
 * Requires `pnpm -r build` first (CI builds before tests). Temp repos live
 * under the OS temp dir and never touch this repository.
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

import {
  findingSchema,
  reviewArtifactSchema,
  runManifestSchema,
} from "@agentic-guardrails/contracts";

import { normalizeCacheTruth } from "../../packages/core/src/pipeline/normalize-cache-truth.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-e2e-"));
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

/** Temp repo with a committed acyclic base: src/a.ts → src/b.ts. */
function makeRepo(): string {
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
  return dir;
}

/** Uncommitted change introducing the cycle src/a.ts <-> src/b.ts. */
function introduceCycle(dir: string): void {
  writeFileSync(
    path.join(dir, "src", "b.ts"),
    'import { a } from "./a.js";\nexport const b = 1;\nexport const echo = a;\n',
  );
}

function runCli(cwd: string, args: string[] = ["review"]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    shell: false,
    encoding: "utf8",
  });
}

function artifactDir(repo: string): string {
  return path.join(repo, "_agentic-guardrails", "reviews", "uncommitted");
}

function readSingleArtifact(repo: string): { file: string; raw: string } {
  const entries = readdirSync(artifactDir(repo));
  expect(entries).toHaveLength(1);
  const file = path.join(artifactDir(repo), entries[0]!);
  expect(file).toMatch(/[0-9a-f]{16}\.json$/);
  return { file, raw: readFileSync(file, "utf8") };
}

beforeAll(() => {
  if (!existsSync(cliPath)) {
    throw new Error(`built CLI missing at ${cliPath} — run \`pnpm -r build\` first`);
  }
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("guardrails review — walking skeleton e2e", () => {
  it("finds an uncommitted circular import, persists a valid artifact, exits 1", () => {
    const repo = makeRepo();
    introduceCycle(repo);
    const result = runCli(repo);

    expect(result.status).toBe(1); // error-severity findings present
    expect(result.stdout).toContain("guardrails review (uncommitted)");
    expect(result.stdout).toContain("structural/circular-import");
    expect(result.stdout).toContain("circular import: src/a.ts -> src/b.ts -> src/a.ts");

    const { raw } = readSingleArtifact(repo);
    const artifact = JSON.parse(raw) as Record<string, unknown>;
    // The WHOLE persisted envelope validates against the contracts schema.
    expect(reviewArtifactSchema.safeParse(artifact).success).toBe(true);
    expect(artifact["schemaVersion"]).toBe(1);
    expect(artifact["scope"]).toBe("uncommitted");
    expect(artifact["changedFiles"]).toEqual(["src/b.ts"]);
    expect(artifact["deletedFiles"]).toEqual([]);

    const findings = artifact["findings"] as unknown[];
    expect(findings.length).toBe(1);
    for (const finding of findings) {
      const parsed = findingSchema.safeParse(finding);
      expect(parsed.success).toBe(true);
    }
    // The RunManifest is embedded in the artifact (single atomic write).
    expect(runManifestSchema.safeParse(artifact["manifest"]).success).toBe(true);

    // Zero silent degradation: pre-1.8 sentinels are declared.
    const degraded = artifact["degraded"] as { subject: string }[];
    expect(degraded.map((d) => d.subject)).toContain("corpus");
    expect(degraded.map((d) => d.subject)).toContain("ledger");

    // Atomic write hygiene: no temp files left behind.
    expect(readdirSync(artifactDir(repo)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("writes byte-identical artifact JSON across two runs on identical input (modulo manifest.cache)", () => {
    const repo = makeRepo();
    introduceCycle(repo);
    expect(runCli(repo).status).toBe(1);
    const first = readSingleArtifact(repo);
    expect(runCli(repo).status).toBe(1);
    const second = readSingleArtifact(repo);
    expect(second.file).toBe(first.file); // same run-id → same filename
    // BYTE-DETERMINISM CARVE-OUT (1.7): the second run serves identical data
    // from the deterministic cache, so `manifest.cache` hit/miss counters are
    // the ONLY permitted byte difference — everything else must be identical.
    expect(normalizeCacheTruth(second.raw)).toBe(normalizeCacheTruth(first.raw));
    expect(first.raw.endsWith("\n")).toBe(true);
    expect(first.raw.endsWith("\n\n")).toBe(false);
  });

  it("exits 0 on a clean working tree, still writing an artifact with an empty change set", () => {
    const repo = makeRepo();
    const result = runCli(repo);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0 findings (0 errors, 0 warnings, 0 info)");
    const { raw } = readSingleArtifact(repo);
    const artifact = JSON.parse(raw) as Record<string, unknown>;
    expect(artifact["changedFiles"]).toEqual([]);
    expect(artifact["findings"]).toEqual([]);
  });

  it("exits 0 for an uncommitted change with no violations", () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, "src", "c.ts"), "export const c = 2;\n");
    const result = runCli(repo);
    expect(result.status).toBe(0);
    const { raw } = readSingleArtifact(repo);
    const artifact = JSON.parse(raw) as Record<string, unknown>;
    expect(artifact["changedFiles"]).toEqual(["src/c.ts"]);
    expect(artifact["findings"]).toEqual([]);
  });

  it("exits 2 with a stderr message and no artifact outside a git repo", () => {
    const dir = tempDir();
    const result = runCli(dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("not a git repository");
    expect(existsSync(path.join(dir, "_agentic-guardrails"))).toBe(false);
  });

  it("resolves a solution-style root tsconfig through its references (THE DOGFOOD CASE) — findings, exit 1, NOT 2", () => {
    // Solution-style root: no files/include, references only — exactly the
    // shape of this repository's own root tsconfig.
    const dir = tempDir();
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test"]);
    writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ files: [], references: [{ path: "pkg" }] }),
    );
    mkdirSync(path.join(dir, "pkg", "src"), { recursive: true });
    writeFileSync(path.join(dir, "pkg", "tsconfig.json"), TSCONFIG);
    writeFileSync(
      path.join(dir, "pkg", "src", "a.ts"),
      'import { b } from "./b.js";\nexport const a = b;\n',
    );
    writeFileSync(path.join(dir, "pkg", "src", "b.ts"), "export const b = 1;\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "base"]);
    // Uncommitted cycle inside the REFERENCED project.
    writeFileSync(
      path.join(dir, "pkg", "src", "b.ts"),
      'import { a } from "./a.js";\nexport const b = 1;\nexport const echo = a;\n',
    );

    const result = runCli(dir);
    expect(result.stderr).not.toContain("degraded");
    expect(result.status).toBe(1); // findings found — never exit 2 for tsconfig shape
    expect(result.stdout).toContain("structural/circular-import");
    expect(result.stdout).toContain("pkg/src/a.ts -> pkg/src/b.ts -> pkg/src/a.ts");
  });

  it("carries a deleted uncommitted file in deletedFiles without degrading", () => {
    const repo = makeRepo();
    rmSync(path.join(repo, "src", "b.ts"));
    // src/a.ts still imports the deleted module — but deletion itself must
    // not be reported as coverage loss.
    const result = runCli(repo);
    const { raw } = readSingleArtifact(repo);
    const artifact = JSON.parse(raw) as { deletedFiles: string[]; changedFiles: string[] };
    expect(artifact.deletedFiles).toEqual(["src/b.ts"]);
    expect(artifact.changedFiles).not.toContain("src/b.ts");
    expect(result.status).toBe(0); // deletion is not coverage loss — no exit 2
  });

  it("exits 2 on an unknown subcommand", () => {
    const result = runCli(tempDir(), ["frobnicate"]);
    expect(result.status).toBe(2);
  });

  it("bare invocation prints help and exits 2, never a silent 0", () => {
    const result = runCli(tempDir(), []);
    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toContain("Usage: guardrails");
  });

  it("--version exits 0", () => {
    const result = runCli(tempDir(), ["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
