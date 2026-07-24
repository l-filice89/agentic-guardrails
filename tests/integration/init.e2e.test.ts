/**
 * Story 1.8 e2e: spawns the BUILT CLI (`pnpm -r build` first) against temp
 * git repos — fresh `init --no-input` bootstrap, re-init never-clobber,
 * review-after-init manifest truth (real ledger/corpus hashes, sentinel
 * degradations gone), removed-wiring warning naming the consequence, and
 * uninitialized-review behavior unchanged.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-init-e2e-"));
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
function makeRepo(withTsconfig = true): string {
  const dir = tempDir();
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  if (withTsconfig) writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src", "a.ts"), 'import { b } from "./b.js";\nexport const a = b;\n');
  writeFileSync(path.join(dir, "src", "b.ts"), "export const b = 1;\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "base"]);
  return dir;
}

function runCli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd, shell: false, encoding: "utf8" });
}

function outFile(repo: string, name: string): string {
  return path.join(repo, "_agentic-guardrails", name);
}

const SEED_REL = path.join("_agentic-guardrails", ".cache", "corpus", "structural-seed.json");

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

beforeAll(() => {
  if (!existsSync(cliPath)) {
    throw new Error(`built CLI missing at ${cliPath} — run \`pnpm -r build\` first`);
  }
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("guardrails init — e2e", () => {
  it("fresh init --no-input creates every file + the seed, reports them, exit 0", () => {
    const repo = makeRepo();
    const result = runCli(repo, ["init", "--no-input"]);
    expect(result.status).toBe(0);
    // Committed layer: config from the 1.6 constants, empty-but-valid ledger files.
    expect(readFileSync(outFile(repo, "config.yaml"), "utf8")).toBe(
      "# yaml-language-server: $schema=./config.schema.json\naxioms: {}\n",
    );
    expect(readFileSync(outFile(repo, "conventions.yaml"), "utf8")).toBe(
      "schemaVersion: 1\nconventions: []\n",
    );
    expect(readFileSync(outFile(repo, "corpus-map.yaml"), "utf8")).toBe(
      "schemaVersion: 1\nhumanConfirmed: []\n",
    );
    // Git wiring: union merge for history JSONL, .cache/ ignored.
    expect(readFileSync(outFile(repo, ".gitattributes"), "utf8")).toContain(
      "history/*.jsonl merge=union",
    );
    const gitignore = readFileSync(outFile(repo, ".gitignore"), "utf8");
    for (const line of ["reviews/", ".cache/", "config.schema.json"]) {
      expect(gitignore).toContain(line);
    }
    // Structural seed: sorted file-level {file, fanIn} entries.
    const seed = JSON.parse(readFileSync(path.join(repo, SEED_REL), "utf8")) as {
      entities: unknown;
      coverage: number;
    };
    expect(seed.entities).toEqual([
      { file: "src/a.ts", fanIn: 0, external: false },
      { file: "src/b.ts", fanIn: 1, external: false },
    ]);
    // Summary lists each created file.
    expect(result.stdout).toContain("created: _agentic-guardrails/config.yaml");
    expect(result.stdout).toContain("created: _agentic-guardrails/conventions.yaml");
    expect(result.stdout).toContain("seed: _agentic-guardrails/.cache/corpus/structural-seed.json");
  });

  it("non-TTY stdin without --no-input skips the questionnaire — no prompt ever blocks", () => {
    const repo = makeRepo();
    const result = runCli(repo, ["init"]); // stdin is a pipe, not a TTY
    expect(result.status).toBe(0);
    expect(readFileSync(outFile(repo, "config.yaml"), "utf8")).toBe(
      "# yaml-language-server: $schema=./config.schema.json\naxioms: {}\n",
    );
  });

  it("HAZARD: re-init keeps a human-edited config byte-identical and regenerates the seed deterministically", () => {
    const repo = makeRepo();
    expect(runCli(repo, ["init", "--no-input"]).status).toBe(0);
    const humanEdited = "# hand-tuned\naxioms:\n  '1':\n    enforcement: advisory\n";
    writeFileSync(outFile(repo, "config.yaml"), humanEdited);
    const firstSeed = readFileSync(path.join(repo, SEED_REL), "utf8");
    const rerun = runCli(repo, ["init", "--no-input"]);
    expect(rerun.status).toBe(0);
    expect(readFileSync(outFile(repo, "config.yaml"), "utf8")).toBe(humanEdited); // never clobber
    expect(rerun.stdout).toContain("kept: _agentic-guardrails/config.yaml");
    expect(rerun.stdout).not.toContain("created: _agentic-guardrails/config.yaml");
    // The regenerable seed is rewritten byte-identically (determinism).
    expect(readFileSync(path.join(repo, SEED_REL), "utf8")).toBe(firstSeed);
  });

  it("exits 2 with a typed error naming the git requirement outside a repo", () => {
    const dir = tempDir(); // plain directory, no git init
    const result = runCli(dir, ["init", "--no-input"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("not a git repository");
    expect(result.stderr).not.toContain("    at ");
    expect(existsSync(path.join(dir, "_agentic-guardrails"))).toBe(false);
  });

  it("succeeds without a tsconfig, declaring the skipped seed in the summary", () => {
    const repo = makeRepo(false);
    const result = runCli(repo, ["init", "--no-input"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("seed skipped: root tsconfig.json not found");
    expect(existsSync(path.join(repo, SEED_REL))).toBe(false);
    expect(existsSync(outFile(repo, "config.yaml"))).toBe(true);
  });
});

describe("guardrails review after init — manifest truth + wiring preflight (e2e)", () => {
  it("carries real sha256 ledger/corpus hashes, sentinel degradations gone, within the NFR-3 ceiling", () => {
    const repo = makeRepo();
    expect(runCli(repo, ["init", "--no-input"]).status).toBe(0);
    const started = performance.now();
    const result = runCli(repo, ["review"]);
    const elapsedMs = performance.now() - started;
    expect(result.status).toBe(0);
    // No wiring warnings on an intact init.
    expect(result.stderr).not.toContain("merge with conflicts");
    expect(result.stderr).not.toContain("may be committed");
    // NFR-3: preflight must fit the ≤5s budget — the WHOLE run (a strict
    // superset of the two-file-read preflight) fits the generous ceiling.
    expect(elapsedMs).toBeLessThan(5000);
    const reviews = path.join(repo, "_agentic-guardrails", "reviews", "uncommitted");
    const artifacts = readdirSync(reviews);
    expect(artifacts).toHaveLength(1);
    const artifact = JSON.parse(readFileSync(path.join(reviews, artifacts[0]!), "utf8")) as {
      manifest: { ledgerHash: string; corpusHash: string };
      degraded: { subject: string }[];
    };
    expect(artifact.manifest.ledgerHash).toBe(
      sha256(readFileSync(outFile(repo, "conventions.yaml"), "utf8")),
    );
    expect(artifact.manifest.corpusHash).toBe(
      sha256(readFileSync(outFile(repo, "corpus-map.yaml"), "utf8")),
    );
    const subjects = artifact.degraded.map((d) => d.subject);
    expect(subjects).not.toContain("ledger");
    expect(subjects).not.toContain("corpus");
  });

  it("HAZARD: a removed wiring line produces a loud stderr warning naming the consequence, exit unchanged", () => {
    const repo = makeRepo();
    expect(runCli(repo, ["init", "--no-input"]).status).toBe(0);
    const intact = runCli(repo, ["review"]);
    expect(intact.status).toBe(0);
    // The user deletes the union-merge line.
    writeFileSync(outFile(repo, ".gitattributes"), "# emptied by user\n");
    const result = runCli(repo, ["review"]);
    expect(result.status).toBe(intact.status); // a warning never changes the exit code
    expect(result.stderr).toContain("history JSONL will merge with conflicts");
  });

  it("uninitialized repo behaves exactly as before: sentinels declared, no wiring warning", () => {
    const repo = makeRepo();
    const result = runCli(repo, ["review"]);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("merge with conflicts");
    expect(result.stderr).not.toContain("may be committed");
    const reviews = path.join(repo, "_agentic-guardrails", "reviews", "uncommitted");
    const artifact = JSON.parse(
      readFileSync(path.join(reviews, readdirSync(reviews)[0]!), "utf8"),
    ) as { manifest: { ledgerHash: string }; degraded: { subject: string }[] };
    // The empty-string sha256 sentinel + its typed degradations, unchanged.
    expect(artifact.manifest.ledgerHash).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    const subjects = artifact.degraded.map((d) => d.subject);
    expect(subjects).toContain("ledger");
    expect(subjects).toContain("corpus");
  });

  it("HAZARD: the SECOND review of a never-initialized repo still emits zero wiring warnings", () => {
    // The artifact writer auto-creates `_agentic-guardrails/` (+ .gitignore,
    // no .gitattributes) during the first review — the wiring predicate must
    // not mistake that on-demand folder for an initialized repo forever after.
    const repo = makeRepo();
    expect(runCli(repo, ["review"]).status).toBe(0);
    const second = runCli(repo, ["review"]);
    expect(second.status).toBe(0);
    expect(second.stderr).not.toContain("merge with conflicts");
    expect(second.stderr).not.toContain("may be committed");
  });
});
