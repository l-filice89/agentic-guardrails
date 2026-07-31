/**
 * Story 1.17 SPIKE-4 noise-metric sweep: runs the BUILT CLI over the five
 * analyzers' labeled fixture sets (`tests/__fixtures__/<set>-rules/` —
 * `violation/` + `expected-findings.json` as true-positive labels, `clean/`
 * as the zero-noise oracle, plus an optional `noise/` tree of known-FP
 * exemplars, none today), classifies every error/warning finding by fixture
 * placement (the CI proxy for DR-1 dispositions), prints the per-analyzer
 * FP/denominator/rate table on EVERY run, and asserts the gates against the
 * committed baseline `tests/__fixtures__/noise-baseline.json`:
 * overall <30% strictly, and per-analyzer non-increasing vs baseline.
 *
 * This is the CI counter-metric: a fixture commit that makes an analyzer
 * noisier fails here, naming the analyzer. The gate logic itself is pure
 * (`noise-rate.ts`) and hazard-tested without spawning in
 * `noise-rate.test.ts`.
 *
 * Requires `pnpm -r build` first (CI builds before tests).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Spawn-heavy sweep: one test spawns the built CLI across ten fixture repos
// (plus `guardrails init` for the conformance corpus derivation).
vi.setConfig({ testTimeout: 600_000 });

import { reviewArtifactSchema } from "@agentic-guardrails/contracts";

import {
  addCounts,
  checkGates,
  classifyFindings,
  formatTable,
  goldenFindingIds,
  type ClassifiableFinding,
  type NoiseCounts,
} from "./noise-rate.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const fixturesRoot = path.join(repoRoot, "tests", "__fixtures__");
const baselinePath = path.join(fixturesRoot, "noise-baseline.json");
const SEED_PATH = "_agentic-guardrails/.cache/corpus/structural-seed.json";

/** The five analyzer rule sets (1.4's minimal rules were absorbed into 1.9's). */
const ANALYZERS = ["structural", "cleanliness", "nfr", "security", "conformance"] as const;
type Analyzer = (typeof ANALYZERS)[number];

/** The labeled trees. `no-corpus` (conformance) is an inconclusiveness
 * fixture, not a labeled tree, and stays out of the noise denominator. */
const LABELED_TREES = ["violation", "clean", "noise"] as const;

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-noise-e2e-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, shell: false, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function runGuardrails(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd, shell: false, encoding: "utf8" });
}

/**
 * Temp git repo from one labeled tree, pattern-matched from the sibling
 * `*-rules.e2e.test.ts` suites: tsconfig + config (+ `deps/` as
 * `node_modules/` where present) committed as the base, the source tree
 * overlaid UNTRACKED as the reviewed change set. The conformance set commits
 * the shared corpus and runs `guardrails init` so the structural seed is
 * real, then overlays the fixture's `diff/`.
 */
function makeRepo(analyzer: Analyzer, tree: string): string {
  const setDir = path.join(fixturesRoot, `${analyzer}-rules`);
  const fixtureDir = path.join(setDir, tree);
  const dir = tempDir();
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  cpSync(path.join(fixtureDir, "tsconfig.json"), path.join(dir, "tsconfig.json"));
  mkdirSync(path.join(dir, "_agentic-guardrails"), { recursive: true });
  cpSync(path.join(fixtureDir, "config.yaml"), path.join(dir, "_agentic-guardrails", "config.yaml"));
  const deps = path.join(fixtureDir, "deps");
  if (existsSync(deps)) cpSync(deps, path.join(dir, "node_modules"), { recursive: true });
  if (analyzer === "conformance") {
    cpSync(path.join(setDir, "corpus"), path.join(dir, "src", "core"), { recursive: true });
  }
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "base"]);
  if (analyzer === "conformance") {
    const init = runGuardrails(dir, ["init", "--no-input"]);
    if (init.status !== 0) throw new Error(`guardrails init failed: ${init.stderr}`);
    if (!existsSync(path.join(dir, SEED_PATH))) {
      throw new Error("fixture drift: `guardrails init` produced no structural seed");
    }
    cpSync(path.join(fixtureDir, "diff"), dir, { recursive: true });
  } else {
    cpSync(path.join(fixtureDir, "src"), path.join(dir, "src"), { recursive: true });
  }
  return dir;
}

function reviewFindings(repo: string, label: string): ClassifiableFinding[] {
  // Exit code deliberately unasserted: blocking violation fixtures exit 1/2
  // by design; the noise metric reads the persisted findings either way.
  const review = runGuardrails(repo, ["review"]);
  const cliOutput = () =>
    `exit ${String(review.status)}\nstdout: ${review.stdout}\nstderr: ${review.stderr}`;
  const artifactDir = path.join(repo, "_agentic-guardrails", "reviews", "uncommitted");
  if (!existsSync(artifactDir)) {
    throw new Error(`${label}: review wrote no artifact directory — ${cliOutput()}`);
  }
  const entries = readdirSync(artifactDir);
  if (entries.length !== 1) {
    throw new Error(
      `${label}: expected exactly one artifact, found [${entries.join(", ")}] — ${cliOutput()}`,
    );
  }
  const artifact: unknown = JSON.parse(readFileSync(path.join(artifactDir, entries[0]!), "utf8"));
  const parsed = reviewArtifactSchema.safeParse(artifact);
  if (!parsed.success) {
    throw new Error(`${label}: artifact failed schema validation: ${parsed.error.message}`);
  }
  return (artifact as { findings: ClassifiableFinding[] }).findings;
}

beforeAll(() => {
  if (!existsSync(cliPath)) {
    throw new Error(`built CLI missing at ${cliPath} — run \`pnpm -r build\` first`);
  }
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("noise metric — labeled-fixture sweep and gate (Story 1.17, SPIKE-4)", () => {
  it("sweeps all five rule sets, prints the per-analyzer table, and holds the <30% + non-increasing gates", () => {
    const results: Record<string, NoiseCounts> = {};
    for (const analyzer of ANALYZERS) {
      const setDir = path.join(fixturesRoot, `${analyzer}-rules`);
      let counts: NoiseCounts = { falsePositives: 0, denominator: 0 };
      for (const tree of LABELED_TREES) {
        if (!existsSync(path.join(setDir, tree))) {
          // Only `noise/` is optional — a missing required tree would
          // silently shrink the labeled set.
          if (tree === "noise") continue;
          throw new Error(`labeled fixture tree missing: ${analyzer}-rules/${tree}/`);
        }
        // TP labels exist only on `violation/`; everything error/warning
        // emitted on `clean/` or `noise/` is a false positive by placement.
        const goldenPath = path.join(setDir, "violation", "expected-findings.json");
        const goldenIds =
          tree === "violation"
            ? goldenFindingIds(
                JSON.parse(readFileSync(goldenPath, "utf8")),
                path.relative(repoRoot, goldenPath),
              )
            : [];
        counts = addCounts(
          counts,
          classifyFindings(reviewFindings(makeRepo(analyzer, tree), `${analyzer}/${tree}`), goldenIds),
        );
      }
      results[analyzer] = counts;
    }

    // Reporting: the table prints on EVERY run, pass or fail.
    // eslint-disable-next-line no-console
    console.log(`\nnoise metric (fixture-placement proxy):\n${formatTable(results)}\n`);

    // Shape validated inside checkGates (a malformed entry is a named gate
    // failure, never a silent pass).
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Record<string, unknown>;
    const gate = checkGates(results, baseline);
    expect(gate.failures).toEqual([]);
    expect(gate.pass).toBe(true);

    // The labeled set must actually label something — an accidentally empty
    // sweep (fixture path drift) must not pass as 0/0.
    for (const analyzer of ANALYZERS) {
      expect(results[analyzer]!.denominator).toBeGreaterThan(0);
    }
  });
});
