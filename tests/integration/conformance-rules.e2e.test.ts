/**
 * Story 1.13 conformance-rules e2e: builds temp git repos from
 * `tests/__fixtures__/conformance-rules/`, spawns the BUILT CLI, and
 * machine-compares the persisted findings against `expected-findings.json`.
 *
 * THE CORPUS IS REAL, NOT HAND-FAKED. The structural seed lives under the
 * GITIGNORED `_agentic-guardrails/.cache/` tree, so a committed fixture seed
 * could not survive a fixture copy honestly. Instead the harness commits the
 * shared 12-module corpus and then runs `guardrails init` inside the temp
 * repo — the seed the analyzer reads is derived by the 1.8 producer from the
 * fixture's own import graph. The no-corpus fixture is the same repo with
 * that step SKIPPED, so it genuinely lacks a seed.
 *
 * All axiom-6 findings are warnings by design (conformance is advisory), so
 * the oracle run EXITS 0 with the findings persisted — asserted explicitly.
 *
 * Requires `pnpm -r build` first (CI builds before tests).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

// Spawn-heavy e2e: each test spawns the built CLI several times (git init,
// `guardrails init`, then reviews), each with real ts-morph parses.
vi.setConfig({ testTimeout: 120_000 });

import { findingSchema, reviewArtifactSchema } from "@agentic-guardrails/contracts";

import { normalizeCacheTruth } from "../../packages/core/src/pipeline/normalize-cache-truth.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const fixturesDir = path.join(repoRoot, "tests", "__fixtures__", "conformance-rules");
const SEED_PATH = "_agentic-guardrails/.cache/corpus/structural-seed.json";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-conformance-e2e-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, shell: false, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function runGuardrails(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    shell: false,
    encoding: "utf8",
  });
}

function runCli(cwd: string) {
  return runGuardrails(cwd, ["review"]);
}

/**
 * Temp git repo from a fixture: tsconfig + config + the SHARED corpus tree
 * (`src/core/`) committed as the base; `guardrails init` then derives the
 * real structural seed from that committed corpus; only afterwards is the
 * fixture's `diff/` tree overlaid, UNTRACKED — so the diff is the change set
 * and provably never voted on the conventions it is judged against.
 */
function makeRepo(fixture: "violation" | "clean" | "no-corpus"): string {
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
  cpSync(path.join(fixturesDir, "corpus"), path.join(dir, "src", "core"), { recursive: true });
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "base"]);

  if (fixture !== "no-corpus") {
    const init = runGuardrails(dir, ["init", "--no-input"]);
    if (init.status !== 0) throw new Error(`guardrails init failed: ${init.stderr}`);
    if (!existsSync(path.join(dir, SEED_PATH))) {
      throw new Error("fixture drift: `guardrails init` produced no structural seed");
    }
    // The fixture's axiom-3 `off` exemption is what keeps unused-export from
    // flooding the oracle. If init ever normalizes config.yaml, that
    // exemption would vanish SILENTLY — assert it survived.
    const config = readFileSync(path.join(dir, "_agentic-guardrails", "config.yaml"), "utf8");
    if (!/'3':\s*\n\s*enforcement: 'off'/.test(config)) {
      throw new Error("fixture drift: `guardrails init` dropped the axiom-3 off setting");
    }
  }
  cpSync(path.join(fixtureDir, "diff"), dir, { recursive: true });
  return dir;
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

/** Rewrite the fixture config's `axioms:` block; a no-op replacement throws
 * so fixture drift can never make the off/advisory tests vacuous. */
function setAxioms(repo: string, axiomsYaml: string): void {
  const configPath = path.join(repo, "_agentic-guardrails", "config.yaml");
  const config = readFileSync(configPath, "utf8");
  const replaced = config.replace("axioms:\n", `axioms:\n${axiomsYaml}`);
  if (replaced === config) {
    throw new Error("fixture drift: `axioms:` anchor not found in config.yaml");
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

describe("guardrails review — axiom-6 conformance rule set e2e (Story 1.13)", () => {
  it("violation fixture matches expected-findings.json exactly — all three rules, measured evidence, EXIT 0 (all warnings), byte-stable twice", () => {
    const repo = makeRepo("violation");
    const golden = readFileSync(
      path.join(fixturesDir, "violation", "expected-findings.json"),
      "utf8",
    );

    const first = runCli(repo);
    expect(first.stderr).not.toContain("degraded");
    // Conformance is advisory by nature: every finding is a warning, so the
    // blocking default gate still PASSES. Asserted explicitly — an exit-1
    // conformance rule set would be the 1.10/1.12 mistake repeated.
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("3 findings (0 errors, 3 warnings, 0 info)");
    const firstArtifact = readSingleArtifact(repo);
    expect(reviewArtifactSchema.safeParse(firstArtifact.artifact).success).toBe(true);
    const findings = firstArtifact.artifact["findings"] as Record<string, unknown>[];
    expect(findings).toHaveLength(3);
    for (const finding of findings) {
      expect(findingSchema.safeParse(finding).success).toBe(true);
      expect(finding).toMatchObject({
        axiom: "6",
        tier: "deterministic",
        source: "ast",
        confidence: 1,
        severity: "warning",
      });
    }
    expect(new Set(findings.map((f) => f["ruleId"]))).toEqual(
      new Set([
        "conformance/naming-convention",
        "conformance/file-placement",
        "conformance/module-shape",
      ]),
    );
    // Evidence-citing messages: every finding names measured counts.
    for (const finding of findings) {
      expect(finding["message"]).toMatch(/\d+\/\d+/);
    }
    // A REAL corpus was consumed: no `no_corpus` declaration anywhere.
    for (const d of firstArtifact.artifact["degraded"] as { reason: string }[]) {
      expect(d.reason).not.toContain("no_corpus");
    }
    // ...and the manifest records WHICH corpus, so the findings are
    // reproducible from the artifact alone (distinct from `corpusHash`, which
    // is the committed corpus-map.yaml).
    const manifest = firstArtifact.artifact["manifest"] as Record<string, unknown>;
    const seedHash = createHash("sha256")
      .update(readFileSync(path.join(repo, SEED_PATH)))
      .digest("hex");
    expect(manifest["corpusSeedHash"]).toBe(seedHash);
    expect(manifest["corpusHash"]).not.toBe(seedHash);
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

    const warm = runCli(repo);
    expect(warm.status).toBe(0);
    const second = readSingleArtifact(repo);
    // EXACT counter shape: one findings hit per registered analyzer (axioms
    // 1, 4, 5, 6 — axiom 3 is off in this fixture), no graph acquisition
    // (every analyzer was served whole), no misses, no invalid entries. With
    // a real corpus, axiom 6 is cacheable like any other analyzer.
    expect((second.artifact["manifest"] as Record<string, unknown>)["cache"]).toEqual({
      hits: 4,
      misses: 0,
      invalid: 0,
    });
    expect(normalizeCacheTruth(second.raw)).toBe(normalizeCacheTruth(first.raw));
  });

  it("no-corpus fixture is INCONCLUSIVE: zero findings, DECLARED in the artifact, PRINTED to the user, and exit NOT driven to 2 by it", () => {
    const repo = makeRepo("no-corpus");
    expect(existsSync(path.join(repo, SEED_PATH))).toBe(false); // genuinely seedless
    const result = runCli(repo);
    // Half 1 of the carve-out: the declaration is in the persisted artifact.
    const { artifact } = readSingleArtifact(repo);
    expect(artifact["findings"]).toEqual([]);
    const declared = (artifact["degraded"] as { reason: string; subject: string }[]).filter((d) =>
      d.reason.startsWith("no_corpus"),
    );
    expect(declared).toHaveLength(1);
    expect(declared[0]!.subject).toBe("corpus-seed");
    expect(declared[0]!.reason).toContain("seed file absent");
    // Half 2: it did NOT drive the run to exit 2 — exit stays 0 and no
    // `degraded:` line is printed.
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("degraded:");
    expect(result.stdout).toContain("0 findings (0 errors, 0 warnings, 0 info)");
    // Half 3 (zero SILENT degradation): an entire axiom declined to run, so
    // the run says so. An inconclusive run must never be byte-identical to a
    // clean one in the terminal.
    expect(result.stderr).toContain("guardrails review: inconclusive: no_corpus: seed file absent");
    expect(result.stderr).toContain("guardrails init");
    expect(result.stderr).toContain("(corpus-seed)");
  });

  it("axiom 6 off: analyzer skipped and declared in manifest.axiomsOff, no conformance findings", () => {
    const repo = makeRepo("violation");
    setAxioms(repo, "  '6':\n    enforcement: 'off'\n");
    const result = runCli(repo);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("conformance/");
    const { artifact } = readSingleArtifact(repo);
    expect(artifact["findings"]).toEqual([]);
    // Axiom 3 is off in the fixture config for isolation; axiom 6 joins it.
    expect((artifact["manifest"] as Record<string, unknown>)["axiomsOff"]).toEqual(["3", "6"]);
  });

  it("axiom 6 advisory: the findings are persisted and non-gating (exit 0) — the bypass durably declared", () => {
    const repo = makeRepo("violation");
    setAxioms(repo, "  '6':\n    enforcement: advisory\n");
    const result = runCli(repo);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("conformance/naming-convention");
    const { artifact } = readSingleArtifact(repo);
    expect(artifact["findings"]).toHaveLength(3);
    const gate = artifact["gate"] as { pass: boolean; perAxiom: Record<string, unknown>[] };
    expect(gate.pass).toBe(true);
    expect(gate.perAxiom).toContainEqual({
      axiom: "6",
      enforcement: "advisory",
      errorFindings: 0,
      maxFindings: 0,
      pass: true,
    });
  });
});
