/**
 * Story 1.16 e2e: scores, the committed history plane, the FR-15 delta, DR-1
 * dispositions and the `guardrails trends` view — all through the BUILT CLI
 * against temp git repos. Requires `pnpm -r build` first.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Spawn-heavy e2e: each test spawns the built CLI (git init + ts-morph
// parses, often several times).
vi.setConfig({ testTimeout: 120_000 });

import {
  dispositionRecordSchema,
  reviewArtifactSchema,
  trendRecordSchema,
  type ReviewArtifact,
} from "@agentic-guardrails/contracts";

import { normalizeCacheTruth } from "../../packages/core/src/pipeline/normalize-cache-truth.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");

const TRENDS_REL = "_agentic-guardrails/history/trends.jsonl";
const DISPOSITIONS_REL = "_agentic-guardrails/history/dispositions.jsonl";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-e2e-116-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, shell: false, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true },
  include: ["src"],
});

/** A repo with a committed clean base and an uncommitted import cycle (two
 * axiom-1 error findings — the numerator the score is computed from). */
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

function introduceCycle(dir: string): void {
  writeFileSync(
    path.join(dir, "src", "b.ts"),
    'import { a } from "./a.js";\nexport const b = 1;\nconst echo = a;\n',
  );
}

function runCli(cwd: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd, shell: false, encoding: "utf8" });
}

function readArtifact(repo: string, scope = "uncommitted"): ReviewArtifact {
  const dir = path.join(repo, "_agentic-guardrails", "reviews", scope);
  const entries = readdirSync(dir).sort();
  const raw = readFileSync(path.join(dir, entries[entries.length - 1]!), "utf8");
  const parsed = reviewArtifactSchema.safeParse(JSON.parse(raw));
  expect(parsed.success).toBe(true);
  return parsed.data!;
}

function readArtifactBytes(repo: string, scope = "uncommitted"): string[] {
  const dir = path.join(repo, "_agentic-guardrails", "reviews", scope);
  return readdirSync(dir)
    .sort()
    .map((f) => readFileSync(path.join(dir, f), "utf8"));
}

function readTrends(repo: string): unknown[] {
  const text = readFileSync(path.join(repo, TRENDS_REL), "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

beforeAll(() => {
  if (!existsSync(cliPath)) throw new Error(`built CLI not found at ${cliPath} — run \`pnpm -r build\``);
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("FR-14 — raw counts and the derived score on the artifact", () => {
  it("records raw counts + changed lines and prints a version-stamped score", () => {
    const repo = makeRepo();
    introduceCycle(repo);
    const result = runCli(repo, ["review"]);
    const artifact = readArtifact(repo);

    expect(artifact.scores).toBeDefined();
    const scores = artifact.scores!;
    expect(scores.formulaVersion).toBe("od-1-v1");
    // Raw counts, not a score, are what history is built from.
    expect(scores.axiomSeverityCounts["1"]?.error).toBeGreaterThan(0);
    // The 1-line cycle edit is far under the floor, so the denominator IS the
    // floor: 0.1 KLOC.
    expect(scores.changedKlocMilli).toBe(100);
    expect(Number.isInteger(scores.scoreTenths)).toBe(true);
    expect(result.stdout).toMatch(/score: \d+\.\d\/100 · od-1-v1/);
  });

  it("OMITS the score for --project and says why — never a fabricated denominator", () => {
    const repo = makeRepo();
    introduceCycle(repo);
    runCli(repo, ["review", "--project"]);
    const artifact = readArtifact(repo, "project");
    expect(artifact.scores?.scoreTenths).toBeUndefined();
    expect(artifact.scores?.scoreOmittedReason).toContain("no changed-KLOC denominator");
  });

  it("scores a CLEAN run 100.0", () => {
    const repo = makeRepo();
    writeFileSync(path.join(repo, "src", "b.ts"), "export const b = 2;\n");
    const result = runCli(repo, ["review"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("score: 100.0/100");
  });
});

describe("the committed history plane", () => {
  it("appends one trend record per run, and an identical re-run appends NOTHING", () => {
    const repo = makeRepo();
    introduceCycle(repo);
    runCli(repo, ["review"]);
    const first = readTrends(repo);
    expect(first).toHaveLength(1);
    const parsed = trendRecordSchema.safeParse(first[0]);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.scopeKind).toBe("uncommitted");
    expect(parsed.data!.commitSha).toBe(git(repo, ["rev-parse", "HEAD"]).trim());

    // Idempotency: identical inputs → identical runId → identical recordId.
    runCli(repo, ["review"]);
    expect(readTrends(repo)).toHaveLength(1);
  });

  it("history is COMMITTABLE — it is not under any seeded ignore rule", () => {
    const repo = makeRepo();
    runCli(repo, ["init", "--no-input"]);
    runCli(repo, ["review"]);
    // The seeded `_agentic-guardrails/.gitignore` covers reviews/ and .cache/
    // only; if history/ were swallowed the M1 gate would have no data source.
    const ignored = spawnSync("git", ["check-ignore", "-q", TRENDS_REL], {
      cwd: repo,
      shell: false,
      encoding: "utf8",
    });
    expect(ignored.status).not.toBe(0);
    const artifactIgnored = spawnSync(
      "git",
      ["check-ignore", "-q", "_agentic-guardrails/reviews/uncommitted"],
      { cwd: repo, shell: false, encoding: "utf8" },
    );
    expect(artifactIgnored.status).toBe(0);
  });

  it("`init` seeds both stores plus the union-merge attribute", () => {
    const repo = makeRepo();
    const result = runCli(repo, ["init", "--no-input"]);
    expect(result.status).toBe(0);
    expect(readFileSync(path.join(repo, TRENDS_REL), "utf8")).toBe("");
    expect(readFileSync(path.join(repo, DISPOSITIONS_REL), "utf8")).toBe("");
    expect(
      readFileSync(path.join(repo, "_agentic-guardrails", ".gitattributes"), "utf8"),
    ).toContain("history/*.jsonl merge=union");
  });

  it("a TORN final record is repaired and declared, and the store stays usable", () => {
    const repo = makeRepo();
    introduceCycle(repo);
    runCli(repo, ["review"]);
    const good = readFileSync(path.join(repo, TRENDS_REL), "utf8");
    writeFileSync(path.join(repo, TRENDS_REL), `${good}{"recordId":"torn`);

    writeFileSync(path.join(repo, "src", "b.ts"), 'import { a } from "./a.js";\nexport const b = 2;\nconst echo = a;\n');
    const result = runCli(repo, ["review"]);
    expect(result.stderr).toContain("torn final record");
    const records = readTrends(repo);
    expect(records).toHaveLength(2); // the good one plus this run's
    for (const record of records) expect(trendRecordSchema.safeParse(record).success).toBe(true);
  });

  it("a first run is a cold start, not a degradation", () => {
    const repo = makeRepo();
    introduceCycle(repo);
    const result = runCli(repo, ["review"]);
    expect(result.stdout).toContain("trend: no comparable previous run");
    // Exit code is the gate's, unaffected by history being empty.
    expect(result.status).toBe(1);
  });
});

describe("FR-15 — the delta is REPORT-ONLY", () => {
  it("prints a per-axiom delta on the second run and keeps it OUT of the artifact", () => {
    const repo = makeRepo();
    introduceCycle(repo);
    runCli(repo, ["review"]);
    // Commit the cycle so the next run's record has the same commitSha lineage,
    // then fix it: the axiom's findings drop to zero.
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "cycle"]);
    writeFileSync(path.join(repo, "src", "b.ts"), "export const b = 3;\n");
    const second = runCli(repo, ["review"]);

    expect(second.stdout).toMatch(/Δ -\d+E/);
    const artifact = readArtifact(repo);
    // The invariant this whole design protects: nothing history-dependent may
    // reach the artifact, or identical inputs would stop producing identical
    // bytes. Asserting the absence of the WORD "delta" would pass if the delta
    // were written under any other key, so the key sets are pinned instead.
    expect(Object.keys(artifact).sort()).toEqual([
      "changedFiles",
      "degraded",
      "deletedFiles",
      "findings",
      "gate",
      "manifest",
      "runId",
      "schemaVersion",
      "scope",
      "scores",
    ]);
    expect(Object.keys(artifact.scores!).sort()).toEqual([
      "axiomSeverityCounts",
      "binaryFiles",
      "changedKlocMilli",
      "changedLines",
      "formulaVersion",
      "scoreTenths",
    ]);
  });

  it("compares a --branch run against the branch's OWN previous record", () => {
    // The query used to ask "is that record's commit an ancestor of the
    // INVOKING head?", which is false for every record on a branch the invoker
    // is not standing on — the normal case — so the delta only ever appeared
    // after the branch was merged, i.e. once it had stopped being useful.
    const repo = makeRepo();
    const main = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    git(repo, ["checkout", "-b", "feature"]);
    introduceCycle(repo);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "cycle"]);
    writeFileSync(path.join(repo, "src", "b.ts"), "export const b = 3;\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "fixed"]);
    // Back to main: the invoking HEAD is NOT on the branch being reviewed.
    git(repo, ["checkout", main]);

    const first = runCli(repo, ["review", "--branch", "feature~1", "--base", main]);
    expect(first.status).not.toBe(2);
    const second = runCli(repo, ["review", "--branch", "feature", "--base", main]);
    expect(second.status).not.toBe(2);
    expect(second.stdout).toMatch(/Δ -\d+E/);
    expect(second.stdout).not.toContain("no comparable previous run");
  });

  it("identical inputs still produce byte-identical artifacts ACROSS runs with history", () => {
    const repo = makeRepo();
    introduceCycle(repo);
    runCli(repo, ["review"]);
    const first = readArtifactBytes(repo);
    runCli(repo, ["review"]);
    const second = readArtifactBytes(repo);
    expect(second).toHaveLength(first.length);
    expect(normalizeCacheTruth(second[0]!)).toBe(normalizeCacheTruth(first[0]!));
  });
});

describe("DR-1 dispositions", () => {
  it("a non-TTY run records NOTHING by default — no fabricated labels", () => {
    const repo = makeRepo();
    introduceCycle(repo);
    runCli(repo, ["review"]);
    expect(existsSync(path.join(repo, DISPOSITIONS_REL))).toBe(false);
  });

  it('the configured "deferred" policy records every finding, independently of the artifact', () => {
    const repo = makeRepo();
    introduceCycle(repo);
    mkdirSync(path.join(repo, "_agentic-guardrails"), { recursive: true });
    writeFileSync(
      path.join(repo, "_agentic-guardrails", "config.yaml"),
      "axioms: {}\ndispositionPolicy: deferred\n",
    );
    const result = runCli(repo, ["review"]);
    // FR-31: a configured policy is a visible deviation, never silent.
    expect(result.stderr).toContain('dispositionPolicy = "deferred"');

    const records = readFileSync(path.join(repo, DISPOSITIONS_REL), "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      const parsed = dispositionRecordSchema.safeParse(record);
      expect(parsed.success).toBe(true);
      expect(parsed.data!.disposition).toBe("deferred");
      expect(parsed.data!.key.runId).toBe(readArtifact(repo).runId);
    }
    // The artifact was DROPPED (non-TTY) and the dispositions were recorded
    // anyway — the two are independent by contract.
    expect(spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).stdout)
      .not.toContain("reviews/");
  });
});

describe("guardrails trends", () => {
  it("renders a self-contained HTML view to the gitignored .cache/", () => {
    const repo = makeRepo();
    introduceCycle(repo);
    runCli(repo, ["review"]);
    const result = runCli(repo, ["trends"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("_agentic-guardrails/.cache/trends.html");

    const html = readFileSync(
      path.join(repo, "_agentic-guardrails", ".cache", "trends.html"),
      "utf8",
    );
    expect(html).toContain("guardrails trends");
    expect(html).toContain("od-1-v1");
    expect(html).not.toContain("<link");
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it("renders an honest empty state with no history, and never crashes", () => {
    const repo = makeRepo();
    const result = runCli(repo, ["trends"]);
    expect(result.status).toBe(0);
    const html = readFileSync(
      path.join(repo, "_agentic-guardrails", ".cache", "trends.html"),
      "utf8",
    );
    expect(html).toContain("No trend records yet");
  });

  it("declares an invalid history line instead of silently omitting it", () => {
    const repo = makeRepo();
    runCli(repo, ["review"]);
    const existing = readFileSync(path.join(repo, TRENDS_REL), "utf8");
    writeFileSync(path.join(repo, TRENDS_REL), `{"recordId":"bad"}\n${existing}`);
    const result = runCli(repo, ["trends"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("line 1");
  });
});

describe("retention", () => {
  it("prunes the per-run artifact store to the configured limit, never history", () => {
    const repo = makeRepo();
    mkdirSync(path.join(repo, "_agentic-guardrails"), { recursive: true });
    writeFileSync(
      path.join(repo, "_agentic-guardrails", "config.yaml"),
      "axioms: {}\nartifactRetention: 2\n",
    );
    const dir = path.join(repo, "_agentic-guardrails", "reviews", "uncommitted");
    mkdirSync(dir, { recursive: true });
    for (const name of ["0000000000000001.json", "0000000000000002.json", "0000000000000003.json"]) {
      writeFileSync(path.join(dir, name), "{}\n");
    }
    const result = runCli(repo, ["review"]);
    expect(result.stderr).toContain("artifactRetention = 2");
    const survivors = readdirSync(dir);
    expect(survivors).toHaveLength(2);
    // The artifact THIS run wrote must be one of them — a prune that kept two
    // stale files and deleted the fresh one would satisfy the count alone.
    const runId = readTrends(repo).map((r) => (r as { runId: string }).runId)[0]!;
    expect(survivors).toContain(`${runId}.json`);
  });

  it("prunes at 101 artifacts under the DEFAULT limit and keeps exactly 100", () => {
    const repo = makeRepo();
    const dir = path.join(repo, "_agentic-guardrails", "reviews", "uncommitted");
    mkdirSync(dir, { recursive: true });
    // 100 pre-existing + the one this run writes = 101 before the prune.
    for (let i = 0; i < 100; i++) {
      writeFileSync(path.join(dir, `${String(i).padStart(16, "0")}.json`), "{}\n");
    }
    // Non-`.json` and an in-flight `.tmp` are not artifacts and must survive.
    writeFileSync(path.join(dir, "notes.txt"), "keep me\n");
    writeFileSync(path.join(dir, "0000000000000999.json.tmp"), "{}\n");
    runCli(repo, ["review"]);
    const survivors = readdirSync(dir);
    expect(survivors.filter((n) => n.endsWith(".json"))).toHaveLength(100);
    expect(survivors).toContain("notes.txt");
    expect(survivors).toContain("0000000000000999.json.tmp");
  });

  it("rejects a non-integer or non-positive artifactRetention rather than guessing", () => {
    for (const value of ["0", "-1", "1.5"]) {
      const repo = makeRepo();
      mkdirSync(path.join(repo, "_agentic-guardrails"), { recursive: true });
      writeFileSync(
        path.join(repo, "_agentic-guardrails", "config.yaml"),
        `axioms: {}\nartifactRetention: ${value}\n`,
      );
      const result = runCli(repo, ["review"]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("artifactRetention");
    }
  });
});

describe("change-size edges", () => {
  it("a DELETION-ONLY diff scores finitely and never divides by zero", () => {
    const repo = makeRepo();
    rmSync(path.join(repo, "src", "b.ts"));
    writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "-A"]);
    const result = runCli(repo, ["review"]);
    expect(result.status).not.toBe(2);
    const scores = readArtifact(repo).scores!;
    expect(scores.changedLines).toBeGreaterThan(0);
    // Under the floor, so the denominator IS the floor — finite, never a
    // division by a hair or by zero.
    expect(scores.changedKlocMilli).toBe(100);
    expect(result.stdout).toMatch(/score: \d+\.\d\/100/);
  });

  it("--project records NO denominator at all, not a floored one", () => {
    // Omitting the score while still writing `changedKlocMilli: 100` claims
    // "0.1 KLOC of change" for a scope that is not a diff.
    const repo = makeRepo();
    introduceCycle(repo);
    runCli(repo, ["review", "--project"]);
    const scores = readArtifact(repo, "project").scores!;
    expect(scores.changedKlocMilli).toBeUndefined();
    expect(scores.changedLines).toBeUndefined();
    expect(scores.scoreOmittedReason).toBeDefined();
  });

  it("an UNBORN repository records no trend record and says so", () => {
    // `headSha()` answers with the empty-TREE sentinel, which passes the
    // schema but is not a commit: every such record would be permanently
    // declared "names a commit no longer in this repository".
    const repo = tempDir();
    git(repo, ["init"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "Test"]);
    writeFileSync(path.join(repo, "tsconfig.json"), TSCONFIG);
    mkdirSync(path.join(repo, "src"));
    writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    const result = runCli(repo, ["review"]);
    expect(result.status).not.toBe(2);
    expect(result.stderr).toContain("no commits yet");
    expect(existsSync(path.join(repo, TRENDS_REL))).toBe(false);
    // The same repo exercises the measurement-FAILURE degradation: there is no
    // HEAD to diff against, so the denominator falls back to its floor. That
    // is exit-neutral and declared, never a lost review.
    expect(result.stderr).toContain("changed-KLOC could not be measured");
    expect(result.stderr).toContain("score-change-size");
    const artifact = readArtifact(repo);
    expect(artifact.scores!.changedKlocMilli).toBe(100);
    expect(artifact.degraded.some((d) => d.subject === "score-change-size")).toBe(true);
  });
});
