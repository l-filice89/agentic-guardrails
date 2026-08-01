/**
 * Story 1.18 review-exclusion e2e: writes `exclude` config variants into temp
 * git repos and spawns the BUILT CLI, asserting the hazard list — an
 * excluded-path violation produces zero findings WITH the exclusion declared
 * (exit 0); the same fixture WITHOUT the entry produces the finding (the
 * exclusion is doing the work); the changed-KLOC denominator excludes
 * excluded files; exclude-everything lands on the normal empty-change-set
 * path; and invalid entries fail config validation with a clear message.
 *
 * Requires `pnpm -r build` first (CI builds before tests).
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
// parses); under full-suite parallel load a single test legitimately
// exceeds the 5s default.
vi.setConfig({ testTimeout: 120_000 });

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-exclude-e2e-"));
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

/** Temp repo with a committed acyclic base under src/vendor/. */
function makeRepo(): string {
  const dir = tempDir();
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
  mkdirSync(path.join(dir, "src", "vendor"), { recursive: true });
  writeFileSync(
    path.join(dir, "src", "vendor", "a.ts"),
    'import { b } from "./b.js";\nexport const a = b;\n',
  );
  writeFileSync(path.join(dir, "src", "vendor", "b.ts"), "export const b = 1;\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "base"]);
  return dir;
}

/** Uncommitted change introducing the cycle src/vendor/a.ts <-> b.ts —
 * exactly one error-severity axiom-1 finding when NOT excluded. */
function introduceCycle(dir: string): void {
  writeFileSync(
    path.join(dir, "src", "vendor", "b.ts"),
    'import { a } from "./a.js";\nexport const b = 1;\nconst echo = a;\n',
  );
}

function writeConfig(dir: string, yamlText: string): void {
  mkdirSync(path.join(dir, "_agentic-guardrails"), { recursive: true });
  writeFileSync(path.join(dir, "_agentic-guardrails", "config.yaml"), yamlText);
}

/** Each run starts from an empty reviews store, so `readSingleArtifact` is
 * unambiguous (a config change changes the runId and would add a file). */
function runCli(cwd: string) {
  rmSync(path.join(cwd, "_agentic-guardrails", "reviews"), { recursive: true, force: true });
  return spawnSync(process.execPath, [cliPath, "review", "--no-input"], {
    cwd,
    shell: false,
    encoding: "utf8",
  });
}

function readSingleArtifact(repo: string): Record<string, unknown> {
  const dir = path.join(repo, "_agentic-guardrails", "reviews", "uncommitted");
  const entries = readdirSync(dir);
  expect(entries).toHaveLength(1);
  return JSON.parse(readFileSync(path.join(dir, entries[0]!), "utf8")) as Record<string, unknown>;
}

beforeAll(() => {
  if (!existsSync(cliPath)) {
    throw new Error(`built CLI missing at ${cliPath} — run \`pnpm -r build\` first`);
  }
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("guardrails review — exclusion config e2e (1.18)", () => {
  it("HAZARD (causality): the violation gates WITHOUT the exclude entry, and is excluded+declared WITH it — exit 0, zero findings", () => {
    const repo = makeRepo();
    introduceCycle(repo);

    // Without the entry: the cycle is a blocking axiom-1 error — exit 1.
    writeConfig(repo, "axioms: {}\n");
    const gated = runCli(repo);
    expect(gated.status).toBe(1);
    expect(gated.stdout).toContain("structural/circular-import");

    // With the entry: the same tree exits 0 with the exclusion DECLARED.
    writeConfig(repo, "axioms: {}\nexclude:\n  - src/vendor/\n");
    const excluded = runCli(repo);
    expect(excluded.status).toBe(0);
    expect(excluded.stdout).not.toContain("structural/circular-import");
    // FR-31 deviation line at run start.
    expect(excluded.stderr).toContain("config: exclude: 1 path prefix declared (src/vendor/)");
    // The report line — a deliberate narrowing, never silent.
    expect(excluded.stderr).toMatch(/excluded: 1 file\(s\) excluded from review by config exclude prefixes \(src\/vendor\/\)/);
    // Durable: the declaration is in the persisted artifact.
    const artifact = readSingleArtifact(repo);
    expect(artifact["findings"]).toEqual([]);
    const degraded = artifact["degraded"] as { subject: string; reason: string }[];
    const declaration = degraded.filter((d) => d.subject === "scope-exclusions");
    expect(declaration).toHaveLength(1);
    expect(declaration[0]?.reason).toContain("not counted in changed-KLOC");
  });

  it("HAZARD (denominator): the changed-KLOC denominator excludes excluded files", () => {
    const repo = makeRepo();
    introduceCycle(repo); // 2 added lines in src/vendor/b.ts (one kept by the diff)
    // One kept changed line outside the excluded tree (comment-only — no
    // findings from it).
    writeFileSync(path.join(repo, "src", "note.ts"), "// one kept line\n");

    writeConfig(repo, "axioms: {}\n");
    const all = runCli(repo);
    expect(all.status).toBe(1); // the cycle still gates
    const allScores = readSingleArtifact(repo)["scores"] as Record<string, unknown>;
    expect(allScores["changedLines"]).toBe(3); // 2 (cycle) + 1 (note)

    writeConfig(repo, "axioms: {}\nexclude:\n  - src/vendor/\n");
    const excluded = runCli(repo);
    expect(excluded.status).toBe(0);
    const scores = readSingleArtifact(repo)["scores"] as Record<string, unknown>;
    expect(scores["changedLines"]).toBe(1); // the kept line only
  });

  it("HAZARD (exclude everything): the whole change excluded lands on the normal empty-change-set path — declared, exit 0, never a crash", () => {
    const repo = makeRepo();
    introduceCycle(repo);
    writeConfig(repo, "axioms: {}\nexclude:\n  - src/\n");
    const result = runCli(repo);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("excluded: 1 file(s) excluded");
    const artifact = readSingleArtifact(repo);
    expect(artifact["changedFiles"]).toEqual([]);
    expect(artifact["findings"]).toEqual([]);
  });

  it("a configured prefix matching NOTHING leaves the run exactly as without it — no declaration, same findings and exit", () => {
    const repo = makeRepo();
    introduceCycle(repo);
    writeConfig(repo, "axioms: {}\nexclude:\n  - nothing-here/\n");
    const result = runCli(repo);
    expect(result.status).toBe(1); // the cycle still gates
    expect(result.stdout).toContain("structural/circular-import");
    // The FR-31 deviation line still declares the configured key…
    expect(result.stderr).toContain("config: exclude: 1 path prefix declared");
    // …but there is no per-run exclusion declaration (nothing was excluded).
    expect(result.stderr).not.toContain("excluded:");
    const artifact = readSingleArtifact(repo);
    const degraded = artifact["degraded"] as { subject: string }[];
    expect(degraded.filter((d) => d.subject === "scope-exclusions")).toEqual([]);
  });

  it("HAZARD (invalid entries): absolute, backslash and non-array exclude values exit 2 with a clear message, no stack trace", () => {
    const repo = makeRepo();
    for (const [yaml, message] of [
      ["exclude:\n  - /abs/path\n", "absolute paths are not allowed"],
      ["exclude:\n  - C:/abs/path\n", "absolute paths are not allowed"],
      ['exclude:\n  - "tests\\\\fixtures"\n', "never backslashes"],
      ["exclude: src/vendor/\n", "exclude"],
    ] as const) {
      writeConfig(repo, yaml);
      const result = runCli(repo);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(message);
      expect(result.stderr).not.toContain("    at ");
    }
  });
});
