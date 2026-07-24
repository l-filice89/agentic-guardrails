/**
 * Story 1.6 config-plane e2e: writes `_agentic-guardrails/config.yaml`
 * variants into temp git repos and spawns the BUILT CLI, asserting exit-code
 * gating (blocking/advisory/off + maxFindings), typed config errors (exit 2,
 * path in stderr, no stack trace), deviation logging, the generated
 * `config.schema.json`, and config participation in the runId.
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

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { configJsonSchema, reviewArtifactSchema } from "@agentic-guardrails/contracts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-config-e2e-"));
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

/** Uncommitted change introducing the cycle src/a.ts <-> src/b.ts — exactly
 * one error-severity axiom-1 finding. */
function introduceCycle(dir: string): void {
  writeFileSync(
    path.join(dir, "src", "b.ts"),
    'import { a } from "./a.js";\nexport const b = 1;\nexport const echo = a;\n',
  );
}

function writeConfig(dir: string, yamlText: string): void {
  mkdirSync(path.join(dir, "_agentic-guardrails"), { recursive: true });
  writeFileSync(path.join(dir, "_agentic-guardrails", "config.yaml"), yamlText);
}

function runCli(cwd: string) {
  return spawnSync(process.execPath, [cliPath, "review"], {
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

describe("guardrails review — config plane e2e", () => {
  it("declares 'using defaults (no config file)' and still gates blocking by default", () => {
    const repo = makeRepo();
    introduceCycle(repo);
    const result = runCli(repo);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("config: using defaults (no config file)");
    // No config file → no unsolicited config.schema.json in the repo.
    expect(existsSync(path.join(repo, "_agentic-guardrails", "config.schema.json"))).toBe(false);
  });

  it("HAZARD (bypass): advisory axiom WITH error findings exits 0, findings printed + the bypass durably declared", () => {
    const repo = makeRepo();
    introduceCycle(repo);
    writeConfig(repo, "axioms:\n  '1':\n    enforcement: advisory\n");
    const result = runCli(repo);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("structural/circular-import"); // reported
    expect(result.stderr).toContain(
      'config: axioms.1.enforcement = "advisory" (default: "blocking")',
    );
    // The governing config is untracked — one visible warning line + manifest field.
    expect(result.stderr).toContain("config.yaml is untracked");
    const artifact = readSingleArtifact(repo);
    expect(reviewArtifactSchema.safeParse(artifact).success).toBe(true);
    expect((artifact["findings"] as unknown[]).length).toBe(1); // persisted
    // Auditability: the enforcement map + gate verdict live in the artifact —
    // the advisory bypass (pass despite 1 error finding) is durably declared.
    const manifest = artifact["manifest"] as Record<string, unknown>;
    expect(manifest["enforcement"]).toEqual({
      "1": { enforcement: "advisory" },
      "5": { enforcement: "blocking" },
    });
    expect(manifest["configPresent"]).toBe(true);
    expect(manifest["configGitStatus"]).toBe("untracked");
    expect(artifact["gate"]).toEqual({
      pass: true,
      perAxiom: [
        { axiom: "1", enforcement: "advisory", errorFindings: 1, maxFindings: 0, pass: true },
        { axiom: "5", enforcement: "blocking", errorFindings: 0, maxFindings: 0, pass: true },
      ],
    });
  });

  it("HAZARD (read failure): config.yaml as a directory exits 2 naming the file and error code", () => {
    const repo = makeRepo();
    // A DIRECTORY at the config path — cross-platform non-ENOENT read failure.
    mkdirSync(path.join(repo, "_agentic-guardrails", "config.yaml"), { recursive: true });
    const result = runCli(repo);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("config.yaml: read error (EISDIR)");
    expect(result.stderr).not.toContain("    at ");
  });

  it("HAZARD (dominance): a run that both fails the gate AND is degraded exits 2", () => {
    const repo = makeRepo();
    introduceCycle(repo); // gate fail (blocking default, 1 error finding)
    // A changed TS file outside tsconfig's include → coverage-loss degradation.
    writeFileSync(path.join(repo, "extra.ts"), "export const extra = 1;\n");
    const result = runCli(repo);
    expect(result.status).toBe(2); // degradation dominates the gate verdict
    expect(result.stderr).toContain("degraded");
  });

  it("HAZARD (threshold boundary): maxFindings 1 tolerates the single finding; maxFindings 0 gates", () => {
    const repo = makeRepo();
    introduceCycle(repo); // exactly one error finding
    writeConfig(repo, "axioms:\n  '1':\n    enforcement: blocking\n    maxFindings: 1\n");
    expect(runCli(repo).status).toBe(0); // exactly N → tolerated
    writeConfig(repo, "axioms:\n  '1':\n    enforcement: blocking\n    maxFindings: 0\n");
    expect(runCli(repo).status).toBe(1); // N+1 over threshold → gate fails
  });

  it("off axiom does not run; the manifest declares it off by config", () => {
    const repo = makeRepo();
    introduceCycle(repo);
    writeConfig(repo, "axioms:\n  '1':\n    enforcement: 'off'\n");
    const result = runCli(repo);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("structural/circular-import");
    const artifact = readSingleArtifact(repo);
    expect(reviewArtifactSchema.safeParse(artifact).success).toBe(true);
    expect(artifact["findings"]).toEqual([]);
    expect((artifact["manifest"] as Record<string, unknown>)["axiomsOff"]).toEqual(["1"]);
  });

  it("invalid enum value exits 2 naming the offending path, no stack trace", () => {
    const repo = makeRepo();
    writeConfig(repo, "axioms:\n  '1':\n    enforcement: warn\n");
    const result = runCli(repo);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("axioms.1.enforcement");
    expect(result.stderr).not.toContain("    at ");
  });

  it("HAZARD (typo key): unknown top-level key rejected by the strict schema with the key in the message", () => {
    const repo = makeRepo();
    writeConfig(repo, "axiom:\n  '1':\n    enforcement: 'off'\n");
    const result = runCli(repo);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("axiom");
    expect(result.stderr).not.toContain("    at ");
  });

  it("malformed YAML exits 2 with a typed line/column parse error", () => {
    const repo = makeRepo();
    writeConfig(repo, "axioms:\n\t'1':\n");
    const result = runCli(repo);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/line \d+, column \d+/);
    expect(result.stderr).not.toContain("    at ");
  });

  it("generates config.schema.json beside the YAML (editor autocomplete, FR-31)", () => {
    const repo = makeRepo();
    writeConfig(repo, "axioms: {}\n");
    expect(runCli(repo).status).toBe(0);
    const schemaPath = path.join(repo, "_agentic-guardrails", "config.schema.json");
    expect(existsSync(schemaPath)).toBe(true);
    expect(JSON.parse(readFileSync(schemaPath, "utf8"))).toEqual(configJsonSchema);
  });

  it("HAZARD (identity): config content changes the runId", () => {
    const repo = makeRepo();
    introduceCycle(repo);
    const reviewsDir = path.join(repo, "_agentic-guardrails", "reviews", "uncommitted");
    expect(runCli(repo).status).toBe(1);
    const first = readdirSync(reviewsDir);
    writeConfig(repo, "axioms:\n  '1':\n    enforcement: advisory\n");
    expect(runCli(repo).status).toBe(0);
    const second = readdirSync(reviewsDir).filter((f) => !first.includes(f));
    expect(second).toHaveLength(1); // a NEW artifact file — different runId
  });
});
