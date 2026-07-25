import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { computeFindingId, type Degradation, type Finding } from "@agentic-guardrails/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ImportGraphBuildResult } from "../adapter/language-adapter.js";
import { axiom6Conformance, NO_CORPUS_PREFIX } from "../analyzers/axiom6-conformance.js";
import { ImportGraph } from "../graph/import-graph.js";
import { STRUCTURAL_SEED_PATH } from "../knowledge/structural-seed.js";
import { ENGINE_VERSION } from "./manifest.js";
import { normalizeCacheTruth } from "./normalize-cache-truth.js";
import {
  computeGraphKey,
  DuplicateAnalyzerError,
  runReview,
  type Analyzer,
} from "./pipeline.js";

// git spawns + real graph builds legitimately exceed the 5s default under
// full-suite parallel load.
vi.setConfig({ testTimeout: 60_000 });

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-pipeline-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, shell: false, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function tempRepoWithChange(): string {
  const dir = tempDir();
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  writeFileSync(path.join(dir, "base.txt"), "base\n");
  writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ include: ["**/*.ts"] }));
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "base"]);
  writeFileSync(path.join(dir, "change.ts"), "export const change = 1;\n");
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeFinding(file: string): Finding {
  return {
    findingId: computeFindingId({ axiom: "1", ruleId: "fake/rule", file, enclosingSymbol: "x" }),
    axiom: "1",
    ruleId: "fake/rule",
    location: { file, startLine: 1, endLine: 1 },
    message: "fake",
    tier: "deterministic",
    source: "ast",
    confidence: 1,
    severity: "error",
  };
}

const okAnalyzer: Analyzer = {
  axiom: "1",
  run: async () => ({ findings: [fakeFinding("change.ts")], degraded: [] }),
};
const cleanAnalyzer: Analyzer = {
  axiom: "1",
  run: async () => ({ findings: [], degraded: [] }),
};
const cleanAnalyzer2: Analyzer = {
  axiom: "2",
  run: async () => ({ findings: [], degraded: [] }),
};
const crashingAnalyzer: Analyzer = {
  axiom: "99",
  run: async () => {
    throw new Error("boom");
  },
};

describe("runReview preflight (phase 0)", () => {
  it("fails with a typed preflight result outside a git repo", async () => {
    const result = await runReview({ cwd: tempDir(), analyzers: [okAnalyzer] });
    expect(result).toEqual({
      ok: false,
      code: "preflight",
      message: "not a git repository",
    });
  });
});

describe("runReview per-axiom isolation (phase 1)", () => {
  it("a throwing analyzer degrades the manifest, names the axiom, and the run continues", async () => {
    const cwd = tempRepoWithChange();
    const result = await runReview({ cwd, analyzers: [okAnalyzer, crashingAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The healthy analyzer's findings survived the crash next door.
    expect(result.artifact.findings).toHaveLength(1);
    expect(result.degradedRun).toBe(true);
    expect(result.runDegraded).toEqual([
      { reason: "analyzer crashed: boom", subject: "axiom-99" },
    ]);
    // Degradation is declared in the artifact, alongside the 1.8 sentinels.
    expect(result.artifact.degraded).toContainEqual({
      reason: "analyzer crashed: boom",
      subject: "axiom-99",
    });
  });

  it("an ABSENT corpus seed is DECLARED in the artifact but never drives exit 2 (the 1.13 carve-out)", async () => {
    const cwd = tempRepoWithChange();
    // The real analyzer against an un-inited repo: no seed file on disk.
    const result = await runReview({ cwd, analyzers: [axiom6Conformance] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.findings).toEqual([]);
    // Half 1: declared in the persisted artifact, reason + subject intact,
    // and surfaced on the result so the CLI can print it.
    const declared = result.artifact.degraded.filter((d) =>
      d.reason.startsWith(NO_CORPUS_PREFIX),
    );
    expect(declared).toHaveLength(1);
    expect(declared[0]!.subject).toBe("corpus-seed");
    expect(result.declaredOnly).toEqual(declared);
    // Half 2: it is NOT in runDegraded, so it cannot drive the CLI to exit 2.
    expect(result.runDegraded).toEqual([]);
    expect(result.degradedRun).toBe(false);
    // No seed read → no corpusSeedHash claimed in the manifest.
    expect(result.artifact.manifest.corpusSeedHash).toBeUndefined();
    // A REAL degradation next door is still counted — the carve-out is
    // narrow, not a hole in degradation dominance.
    const withCrash = await runReview({ cwd, analyzers: [axiom6Conformance, crashingAnalyzer] });
    expect(withCrash.ok).toBe(true);
    if (!withCrash.ok) return;
    expect(withCrash.degradedRun).toBe(true);
    expect(withCrash.runDegraded).toEqual([
      { reason: "analyzer crashed: boom", subject: "axiom-99" },
    ]);
  });

  it("a PRESENT-but-broken corpus seed is a real degradation: it counts and drives exit 2", async () => {
    // The carve-out is for absence only. A corrupt, unreadable, invalid or
    // empty seed silently disabling an entire axiom is exactly the kind of
    // thing degradation dominance exists to surface.
    const cases: [name: string, bytes: string][] = [
      ["unparseable", '{ "schemaVersion": 1, "entities": ['],
      ["schema-invalid", JSON.stringify({ schemaVersion: 2, entities: [], coverage: 1, degraded: [] })],
      ["empty", JSON.stringify({ schemaVersion: 1, entities: [], coverage: 1, degraded: [] })],
    ];
    for (const [, bytes] of cases) {
      const cwd = tempRepoWithChange();
      const seedPath = path.join(cwd, STRUCTURAL_SEED_PATH);
      mkdirSync(path.dirname(seedPath), { recursive: true });
      writeFileSync(seedPath, `${bytes}\n`);
      const result = await runReview({ cwd, analyzers: [axiom6Conformance] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.declaredOnly).toEqual([]);
      expect(result.runDegraded.filter((d) => d.subject === "corpus-seed")).toHaveLength(1);
      expect(result.degradedRun).toBe(true);
      // The seed WAS read, so the manifest records which corpus it was.
      expect(result.artifact.manifest.corpusSeedHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("the artifact's degraded array is deterministically ordered across sentinels, declarations and real degradations", async () => {
    const cwd = tempRepoWithChange();
    const noisy: Analyzer = {
      axiom: "2",
      run: async () => ({
        findings: [],
        degraded: [{ reason: "z-real", subject: "z-subject" }],
        declaredOnly: [
          { reason: "b-declared", subject: "b-subject" },
          { reason: "a-declared", subject: "a-subject" },
        ],
      }),
    };
    const result = await runReview({ cwd, analyzers: [axiom6Conformance, noisy] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Declarations sorted by (subject, reason) like every sibling list — an
    // analyzer's map insertion order must never reach the artifact bytes.
    expect(result.declaredOnly.map((d) => d.subject)).toEqual([
      "a-subject",
      "b-subject",
      "corpus-seed",
    ]);
    expect(result.artifact.degraded.map((d) => d.subject)).toEqual([
      "ledger",
      "corpus",
      "a-subject",
      "b-subject",
      "corpus-seed",
      "z-subject",
    ]);
  });

  it("a clean run is not degraded despite the ledger/corpus sentinels", async () => {
    const cwd = tempRepoWithChange();
    const result = await runReview({ cwd, analyzers: [okAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.degradedRun).toBe(false);
    // Sentinels stay declared — absence is explicit, never silent.
    expect(result.artifact.degraded.map((d) => d.subject)).toEqual(["ledger", "corpus"]);
  });

  it("a missing root tsconfig with TS changes present is a typed degradation, not a throw", async () => {
    const cwd = tempRepoWithChange();
    unlinkSync(path.join(cwd, "tsconfig.json"));
    const result = await runReview({ cwd, analyzers: [okAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.degradedRun).toBe(true);
    expect(result.runDegraded).toContainEqual({
      reason: "root tsconfig.json not found",
      subject: "tsconfig.json",
    });
  });
});

describe("runReview change-set handling (phase 0)", () => {
  it("excludes the engine's own output directory from the change set", async () => {
    const cwd = tempRepoWithChange();
    // A previously-written artifact must not change the next run's identity.
    const outDir = path.join(cwd, "_agentic-guardrails", "reviews", "uncommitted");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "old-run.json"), "{}\n");
    const result = await runReview({ cwd, analyzers: [okAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.changedFiles).toEqual(["change.ts"]);
  });

  it("carries deleted uncommitted files separately, without any degradation", async () => {
    const cwd = tempRepoWithChange();
    unlinkSync(path.join(cwd, "base.txt")); // deleted but uncommitted
    const result = await runReview({ cwd, analyzers: [okAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.deletedFiles).toEqual(["base.txt"]);
    expect(result.artifact.changedFiles).not.toContain("base.txt");
    expect(result.degradedRun).toBe(false); // deletion is not coverage loss
  });

  it("filters declaration files out of the analysis set but keeps .mts/.cts in", async () => {
    const cwd = tempRepoWithChange();
    writeFileSync(path.join(cwd, "types.d.ts"), "export declare const t: number;\n");
    writeFileSync(path.join(cwd, "mod.mts"), "export const m = 1;\n");
    const seen: string[][] = [];
    const spyAnalyzer: Analyzer = {
      axiom: "1",
      run: async (context) => {
        seen.push([...context.changedFiles]);
        return { findings: [], degraded: [] };
      },
    };
    const result = await runReview({ cwd, analyzers: [spyAnalyzer] });
    expect(result.ok).toBe(true);
    expect(seen[0]).toEqual(["change.ts", "mod.mts"]);
  });
});

function writeConfig(cwd: string, yamlText: string): void {
  mkdirSync(path.join(cwd, "_agentic-guardrails"), { recursive: true });
  writeFileSync(path.join(cwd, "_agentic-guardrails", "config.yaml"), yamlText);
}

describe("runReview config plane (1.6)", () => {
  it("excludes an off-by-config axiom from the run and declares it in the manifest", async () => {
    const cwd = tempRepoWithChange();
    writeConfig(cwd, "axioms:\n  '1':\n    enforcement: 'off'\n");
    let ran = false;
    const spy: Analyzer = {
      axiom: "1",
      run: async () => {
        ran = true;
        return { findings: [fakeFinding("change.ts")], degraded: [] };
      },
    };
    const result = await runReview({ cwd, analyzers: [spy] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ran).toBe(false); // membership exclusion, not result suppression
    expect(result.artifact.findings).toEqual([]);
    expect(result.artifact.manifest.axiomsOff).toEqual(["1"]);
    expect(result.degradedRun).toBe(false); // off-by-config is not degradation
  });

  it("HAZARD: an advisory axiom with error findings passes the gate", async () => {
    const cwd = tempRepoWithChange();
    writeConfig(cwd, "axioms:\n  '1':\n    enforcement: advisory\n");
    const result = await runReview({ cwd, analyzers: [okAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.findings).toHaveLength(1); // still reported + persisted
    expect(result.gate.pass).toBe(true);
    expect(result.deviations).toEqual(['axioms.1.enforcement = "advisory" (default: "blocking")']);
    // P2: the bypass is durably declared in the artifact — enforcement map +
    // gate verdict with the error count.
    expect(result.artifact.manifest.enforcement).toEqual({
      "1": { enforcement: "advisory" },
    });
    expect(result.artifact.gate).toEqual({
      pass: true,
      perAxiom: [
        { axiom: "1", enforcement: "advisory", errorFindings: 1, maxFindings: 0, pass: true },
      ],
    });
  });

  it("persists configHash/configPresent/configGitStatus in the manifest (untracked config)", async () => {
    const cwd = tempRepoWithChange();
    writeConfig(cwd, "axioms:\n  '1':\n    enforcement: advisory\n");
    const result = await runReview({ cwd, analyzers: [okAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.manifest.configPresent).toBe(true);
    expect(result.artifact.manifest.configHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.artifact.manifest.configGitStatus).toBe("untracked");
  });

  it("declares configGitStatus 'absent' and configHash 'absent' with no config file", async () => {
    const cwd = tempRepoWithChange();
    const result = await runReview({ cwd, analyzers: [okAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.manifest.configPresent).toBe(false);
    expect(result.artifact.manifest.configHash).toBe("absent");
    expect(result.artifact.manifest.configGitStatus).toBe("absent");
  });

  it("warns (never degrades) about config entries matching no known axiom", async () => {
    const cwd = tempRepoWithChange();
    writeConfig(cwd, "axioms:\n  '7':\n    enforcement: advisory\n");
    const result = await runReview({ cwd, analyzers: [okAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Pinned EXACTLY: config warnings carry only config-plane lines, and
    // the wiring warnings (this fixture IS initialized via config.yaml,
    // with no wiring files) ride their own channel — the full set, no
    // toContain blind spots.
    expect(result.configWarnings).toEqual(["axioms.7 matches no known axiom"]);
    expect(result.wiringWarnings).toEqual([
      '_agentic-guardrails/.gitattributes is missing "history/*.jsonl merge=union" — history JSONL will merge with conflicts (run `guardrails init`)',
      '_agentic-guardrails/.gitignore is missing "reviews/" — review artifacts may be committed (run `guardrails init`)',
      '_agentic-guardrails/.gitignore is missing ".cache/" — .cache/ may be committed (run `guardrails init`)',
      '_agentic-guardrails/.gitignore is missing "config.schema.json" — the generated schema file may be committed (run `guardrails init`)',
    ]);
    expect(result.degradedRun).toBe(false);
  });

  it("a schema-file write failure is a warning, NOT a degradation (run stays clean)", async () => {
    const cwd = tempRepoWithChange();
    writeConfig(cwd, "axioms: {}\n");
    // A DIRECTORY at the schema path forces the write to fail.
    mkdirSync(path.join(cwd, "_agentic-guardrails", "config.schema.json"), { recursive: true });
    const result = await runReview({ cwd, analyzers: [cleanAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.degradedRun).toBe(false); // no analysis coverage lost
    expect(result.configWarnings.some((w) => w.includes("config.schema.json write failed"))).toBe(
      true,
    );
    expect(result.gate.pass).toBe(true);
  });

  it("fails the gate by default when a blocking axiom has error findings", async () => {
    const cwd = tempRepoWithChange();
    const result = await runReview({ cwd, analyzers: [okAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.configPresent).toBe(false);
    expect(result.gate.pass).toBe(false);
    expect(result.artifact.manifest.axiomsOff).toBeUndefined();
  });

  it("returns a typed config failure (not a throw) for an invalid config", async () => {
    const cwd = tempRepoWithChange();
    writeConfig(cwd, "axioms:\n  '1':\n    enforcement: warn\n");
    const result = await runReview({ cwd, analyzers: [okAnalyzer] });
    expect(result).toMatchObject({ ok: false, code: "config" });
    if (result.ok) return;
    expect(result.message).toContain("axioms.1.enforcement");
  });

  it("HAZARD: config content participates in the runId", async () => {
    const cwd = tempRepoWithChange();
    const noConfig = await runReview({ cwd, analyzers: [okAnalyzer] });
    writeConfig(cwd, "axioms:\n  '1':\n    enforcement: advisory\n");
    const withConfig = await runReview({ cwd, analyzers: [okAnalyzer] });
    writeConfig(cwd, "axioms:\n  '1':\n    enforcement: blocking\n");
    const changedConfig = await runReview({ cwd, analyzers: [okAnalyzer] });
    expect(noConfig.ok && withConfig.ok && changedConfig.ok).toBe(true);
    if (!noConfig.ok || !withConfig.ok || !changedConfig.ok) return;
    const ids = [noConfig, withConfig, changedConfig].map((r) => r.artifact.runId);
    expect(new Set(ids).size).toBe(3); // all distinct
  });
});

describe("runReview determinism (phases 4–5)", () => {
  it("identical input produces byte-identical artifact JSON (modulo manifest.cache) and the same runId", async () => {
    const cwd = tempRepoWithChange();
    const first = await runReview({ cwd, analyzers: [okAnalyzer] });
    const second = await runReview({ cwd, analyzers: [okAnalyzer] });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(normalizeCacheTruth(second.artifactJson)).toBe(normalizeCacheTruth(first.artifactJson));
    expect(second.artifact.runId).toBe(first.artifact.runId);
    expect(first.artifact.runId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changed content changes the runId (identity is a hash of inputs)", async () => {
    const cwd = tempRepoWithChange();
    const first = await runReview({ cwd, analyzers: [okAnalyzer] });
    writeFileSync(path.join(cwd, "change.ts"), "export const change = 2;\n");
    const second = await runReview({ cwd, analyzers: [okAnalyzer] });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.artifact.runId).not.toBe(first.artifact.runId);
  });

  it("a new HEAD changes the runId even for an identical change set", async () => {
    const cwd = tempRepoWithChange();
    const first = await runReview({ cwd, analyzers: [okAnalyzer] });
    // Commit something unrelated: same uncommitted change set, new HEAD.
    writeFileSync(path.join(cwd, "other.txt"), "other\n");
    git(cwd, ["add", "other.txt"]);
    git(cwd, ["commit", "-m", "unrelated"]);
    const second = await runReview({ cwd, analyzers: [okAnalyzer] });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.artifact.runId).not.toBe(first.artifact.runId);
  });
});

function countingAnalyzer(axiom: string, findings: Finding[] = []): { analyzer: Analyzer; runs: () => number } {
  let runs = 0;
  return {
    analyzer: {
      axiom,
      run: async () => {
        runs += 1;
        return { findings, degraded: [] };
      },
    },
    runs: () => runs,
  };
}

function findingsCacheDir(cwd: string): string {
  return path.join(cwd, "_agentic-guardrails", ".cache", "findings");
}

describe("runReview deterministic cache (1.7)", () => {
  it("a warm run skips analyzer execution, records hits in the manifest, and is byte-identical modulo manifest.cache", async () => {
    const cwd = tempRepoWithChange();
    const spy = countingAnalyzer("1", [fakeFinding("change.ts")]);
    const cold = await runReview({ cwd, analyzers: [spy.analyzer] });
    const warm = await runReview({ cwd, analyzers: [spy.analyzer] });
    expect(cold.ok && warm.ok).toBe(true);
    if (!cold.ok || !warm.ok) return;
    expect(spy.runs()).toBe(1); // second run served entirely from cache
    expect(cold.artifact.manifest.cache).toMatchObject({ hits: 0, invalid: 0 });
    expect(cold.artifact.manifest.cache!.misses).toBeGreaterThan(0);
    expect(warm.artifact.manifest.cache!.hits).toBeGreaterThan(0);
    expect(warm.artifact.manifest.cache).toMatchObject({ misses: 0, invalid: 0 });
    // The cache serves the identical data a cold run computes.
    expect(warm.artifact.findings).toEqual(cold.artifact.findings);
    expect(normalizeCacheTruth(warm.artifactJson)).toBe(normalizeCacheTruth(cold.artifactJson));
  });

  it("an input change misses (key changed) and recomputes", async () => {
    const cwd = tempRepoWithChange();
    const spy = countingAnalyzer("1");
    await runReview({ cwd, analyzers: [spy.analyzer] });
    writeFileSync(path.join(cwd, "change.ts"), "export const change = 2;\n");
    const second = await runReview({ cwd, analyzers: [spy.analyzer] });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(spy.runs()).toBe(2);
    expect(second.artifact.manifest.cache!.hits).toBe(0);
  });

  it("HAZARD: a corrupt cache entry is a typed miss + degradation — recomputed and overwritten, never a crash", async () => {
    const cwd = tempRepoWithChange();
    const spy = countingAnalyzer("1", [fakeFinding("change.ts")]);
    await runReview({ cwd, analyzers: [spy.analyzer] });
    const entries = readdirSync(findingsCacheDir(cwd));
    expect(entries).toHaveLength(1);
    const entryPath = path.join(findingsCacheDir(cwd), entries[0]!);
    writeFileSync(entryPath, "{ torn garbage");
    const second = await runReview({ cwd, analyzers: [spy.analyzer] });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(spy.runs()).toBe(2); // recomputed
    expect(second.artifact.findings).toHaveLength(1); // still correct output
    expect(second.artifact.manifest.cache).toMatchObject({ hits: 0, misses: 0, invalid: 1 });
    expect(second.runDegraded).toContainEqual({
      reason: "invalid cache entry (recomputed and overwritten)",
      subject: "cache/findings/axiom-1",
    });
    // Entry overwritten with a valid one: a third run hits again.
    expect(JSON.parse(readFileSync(entryPath, "utf8"))).toBeTruthy();
    const third = await runReview({ cwd, analyzers: [spy.analyzer] });
    expect(third.ok && spy.runs() === 2).toBe(true);
  });

  it("cache schema drift (valid JSON, contract-invalid findings) is a miss + degradation, never wrong data", async () => {
    const cwd = tempRepoWithChange();
    const spy = countingAnalyzer("1");
    await runReview({ cwd, analyzers: [spy.analyzer] });
    const entries = readdirSync(findingsCacheDir(cwd));
    writeFileSync(
      path.join(findingsCacheDir(cwd), entries[0]!),
      '{"findings":[{"bogus":true}],"degraded":[]}\n',
    );
    const second = await runReview({ cwd, analyzers: [spy.analyzer] });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(spy.runs()).toBe(2);
    expect(second.artifact.manifest.cache!.invalid).toBe(1);
    expect(second.degradedRun).toBe(true);
  });

  it("a degraded partial is never cached — it must not become a future 'clean' hit", async () => {
    const cwd = tempRepoWithChange();
    let runs = 0;
    const degrading: Analyzer = {
      axiom: "1",
      run: async () => {
        runs += 1;
        return {
          findings: [],
          degraded: [{ reason: "coverage lost", subject: "axiom-1" }],
        };
      },
    };
    const first = await runReview({ cwd, analyzers: [degrading] });
    const second = await runReview({ cwd, analyzers: [degrading] });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(runs).toBe(2); // recomputed, not served from cache
    expect(second.artifact.manifest.cache!.hits).toBe(0);
    expect(second.degradedRun).toBe(true); // the degradation stayed visible
  });

  it("HAZARD: post-abort analyzer completions are never written to the cache", async () => {
    const cwd = tempRepoWithChange();
    const slow: Analyzer = {
      axiom: "1",
      run: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ findings: [], degraded: [] }), 200),
        ),
    };
    const result = await runReview({ cwd, analyzers: [slow], phase1BudgetMs: 50 });
    expect(result.ok).toBe(true);
    // Let the abandoned in-flight analyzer finish — its late completion must
    // not leak an aborted run's result into future runs.
    await new Promise((resolve) => setTimeout(resolve, 400));
    let entries: string[] = [];
    try {
      entries = readdirSync(findingsCacheDir(cwd));
    } catch {
      // cache dir never created for findings — equally clean
    }
    expect(entries).toEqual([]);
  });

  it("a crash is never cached — the analyzer re-runs until it succeeds", async () => {
    const cwd = tempRepoWithChange();
    let calls = 0;
    const flaky: Analyzer = {
      axiom: "1",
      run: async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return { findings: [], degraded: [] };
      },
    };
    const first = await runReview({ cwd, analyzers: [flaky] });
    const second = await runReview({ cwd, analyzers: [flaky] });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(calls).toBe(2);
    expect(first.degradedRun).toBe(true);
    expect(second.degradedRun).toBe(false);
  });
});

describe("runReview phase budget (1.7)", () => {
  it("a phase over budget degrades to partials with a typed reason — never an uncaught failure", async () => {
    const cwd = tempRepoWithChange();
    const slow: Analyzer = {
      axiom: "9",
      run: () =>
        new Promise((resolve) => setTimeout(() => resolve({ findings: [], degraded: [] }), 400)),
    };
    const result = await runReview({ cwd, analyzers: [okAnalyzer, slow], phase1BudgetMs: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The fast analyzer's work survived the abort.
    expect(result.artifact.findings).toHaveLength(1);
    expect(result.degradedRun).toBe(true);
    expect(result.runDegraded).toContainEqual({
      reason: "phase 1 exceeded its 100ms budget — analyzer aborted before completion",
      subject: "axiom-9",
    });
    // P6: the manifest tells the truth about the aborted phase.
    const phase1 = result.artifact.manifest.phases![1]!;
    expect(phase1.ran).toBe(true); // one analyzer DID complete
    expect(phase1.reason).toContain("aborted at the 100ms budget");
    expect(phase1.reason).toContain("1/2 analyzers completed");
  });

  it("passes the phase-1 abort signal to analyzers via the context", async () => {
    const cwd = tempRepoWithChange();
    let seen: AbortSignal | undefined;
    const spy: Analyzer = {
      axiom: "1",
      run: async (context) => {
        seen = context.signal;
        return { findings: [], degraded: [] };
      },
    };
    const result = await runReview({ cwd, analyzers: [spy] });
    expect(result.ok).toBe(true);
    expect(seen).toBeInstanceOf(AbortSignal);
  });
});

describe("runReview analyzer registration", () => {
  it("rejects two analyzers registered for the same axiom with a typed error", async () => {
    const cwd = tempRepoWithChange();
    await expect(runReview({ cwd, analyzers: [okAnalyzer, cleanAnalyzer] })).rejects.toThrow(
      DuplicateAnalyzerError,
    );
  });
});

describe("runReview declared cache-disable (P4: zero silent cache behavior)", () => {
  it("declares caching disabled when the secret cannot be read or created", async () => {
    const cwd = tempRepoWithChange();
    // The secret path IS a directory: unreadable and uncreatable as a file.
    const result = await runReview({ cwd, analyzers: [okAnalyzer], cacheSecretPath: cwd });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.manifest.cache).toEqual({
      hits: 0,
      misses: 0,
      invalid: 0,
      disabled:
        "cache secret unavailable (could not read or create ~/.agentic-guardrails/cache-secret)",
    });
    expect(result.degradedRun).toBe(false); // disabled cache is declared, not degraded
  });

  it("declares caching disabled when the cache directory is unwritable", async () => {
    const cwd = tempRepoWithChange();
    // A FILE at the .cache path makes mkdir fail.
    mkdirSync(path.join(cwd, "_agentic-guardrails"), { recursive: true });
    writeFileSync(path.join(cwd, "_agentic-guardrails", ".cache"), "not a directory");
    const result = await runReview({ cwd, analyzers: [okAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.manifest.cache!.disabled).toContain("cache directory not writable");
    expect(result.artifact.manifest.cache).toMatchObject({ hits: 0, misses: 0, invalid: 0 });
  });

  it("declares the empty-analyzable-set skip with a reason, never silently", async () => {
    const dir = tempDir();
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test"]);
    writeFileSync(path.join(dir, "base.txt"), "base\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "base"]);
    writeFileSync(path.join(dir, "notes.txt"), "no TS here\n"); // non-analyzable change
    const result = await runReview({ cwd: dir, analyzers: [cleanAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.manifest.cache!.disabled).toBe(
      "no analyzable TypeScript changes — nothing to cache",
    );
  });

  it("declares caching disabled (no fake key) when a participating file is unreadable", async () => {
    const cwd = tempRepoWithChange();
    // tsconfig `files` lists a file that does not exist on disk: the parsed
    // file list still contains it, so its content hash is uncomputable.
    writeFileSync(path.join(cwd, "tsconfig.json"), JSON.stringify({ files: ["ghost.ts"] }));
    const result = await runReview({ cwd, analyzers: [okAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.manifest.cache!.disabled).toContain(
      "cache key not computable for tsconfig.json",
    );
    expect(result.artifact.manifest.cache).toMatchObject({ hits: 0, misses: 0, invalid: 0 });
  });
});

describe("computeGraphKey toolchain invalidation (P5)", () => {
  it("a different TypeScript version component changes the graph cache key", () => {
    const cwd = tempRepoWithChange();
    const tsconfigPath = path.join(cwd, "tsconfig.json");
    const current = computeGraphKey(cwd, tsconfigPath);
    const upgraded = computeGraphKey(cwd, tsconfigPath, "99.0.0");
    expect(current).toBeDefined();
    expect(upgraded).toBeDefined();
    expect(upgraded).not.toBe(current);
    // Same version → same key (the key stays content-addressed).
    expect(computeGraphKey(cwd, tsconfigPath)).toBe(current);
  });
});

describe("engine-version upgrade path (1.9/1.10)", () => {
  it("pre-upgrade cache entries become clean key MISSES — never read, never invalid, no degradation", async () => {
    const cwd = tempRepoWithChange();
    const tsconfigPath = path.join(cwd, "tsconfig.json");
    // Every cached-graph payload-schema change (1.9: edge `line` +
    // `unresolvedImports`; 1.10: edge `names`) was paired with an
    // ENGINE_VERSION bump: old entries live under old keys.
    expect(ENGINE_VERSION).not.toBe("0.0.1");
    expect(ENGINE_VERSION).not.toBe("0.0.2");
    const newKey = computeGraphKey(cwd, tsconfigPath);
    expect(newKey).toBeDefined();
    const graphDir = path.join(cwd, "_agentic-guardrails", ".cache", "graph");
    mkdirSync(graphDir, { recursive: true });
    for (const oldVersion of ["0.0.1", "0.0.2"]) {
      const oldKey = computeGraphKey(cwd, tsconfigPath, undefined, oldVersion);
      expect(oldKey).toBeDefined();
      expect(newKey).not.toBe(oldKey);
      // Plant a stale pre-upgrade entry under the OLD key: the post-upgrade
      // run must never read it — a clean miss, not an "invalid entry"
      // degradation implying corruption.
      writeFileSync(path.join(graphDir, `${oldKey}.json`), "{ stale pre-upgrade shape");
    }
    const result = await runReview({ cwd }); // default analyzers — real graph build
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.manifest.cache).toMatchObject({ hits: 0, invalid: 0 });
    expect(result.artifact.manifest.cache!.misses).toBeGreaterThan(0);
    expect(result.degradedRun).toBe(false);
  });
});

describe("runReview assembly declaration (1.7)", () => {
  it("declares the fixed six-phase shape with membership varying by config", async () => {
    const cwd = tempRepoWithChange();
    const result = await runReview({ cwd, analyzers: [okAnalyzer, cleanAnalyzer2] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const phases = result.artifact.manifest.phases!;
    expect(phases.map((p) => p.phase)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(phases[1]).toEqual({ phase: 1, members: ["axiom-1", "axiom-2"], ran: true });
    // 2/3 are DECLARED with empty membership and a reason — never silent.
    expect(phases[2]!.ran).toBe(false);
    expect(phases[2]!.reason).toContain("Epic 2");
    expect(phases[3]!.reason).toContain("Epic 3");
    expect(phases[4]).toEqual({ phase: 4, members: ["merge", "sort"], ran: true });
  });

  it("an off-by-config axiom leaves phase-1 membership, keeping the six-phase shape fixed", async () => {
    const cwd = tempRepoWithChange();
    writeConfig(cwd, "axioms:\n  '1':\n    enforcement: 'off'\n");
    const result = await runReview({ cwd, analyzers: [okAnalyzer, cleanAnalyzer2] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const phases = result.artifact.manifest.phases!;
    expect(phases).toHaveLength(6);
    expect(phases[1]!.members).toEqual(["axiom-2"]);
  });
});

describe("runReview degradation aggregation (phase 4, 1.10)", () => {
  const shared: Degradation = { reason: "graph build degraded", subject: "tsconfig.json" };

  it("the SAME (reason, subject) pair from TWO analyzers collapses to one artifact entry", async () => {
    const cwd = tempRepoWithChange();
    const a: Analyzer = { axiom: "1", run: async () => ({ findings: [], degraded: [{ ...shared }] }) };
    const b: Analyzer = { axiom: "3", run: async () => ({ findings: [], degraded: [{ ...shared }] }) };
    const result = await runReview({ cwd, analyzers: [a, b] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.runDegraded.filter(
        (d) => d.reason === shared.reason && d.subject === shared.subject,
      ),
    ).toHaveLength(1);
  });

  it("HAZARD: the same pair emitted TWICE by ONE analyzer is two real events — both entries stay", async () => {
    const cwd = tempRepoWithChange();
    const repeat: Analyzer = {
      axiom: "1",
      run: async () => ({ findings: [], degraded: [{ ...shared }, { ...shared }] }),
    };
    const result = await runReview({ cwd, analyzers: [repeat] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.runDegraded.filter(
        (d) => d.reason === shared.reason && d.subject === shared.subject,
      ),
    ).toHaveLength(2);
  });
});

describe("runReview run-local graph memo (1.10)", () => {
  it("two graph-consuming analyzers acquire ONE build per tsconfig, even across await points", async () => {
    const cwd = tempRepoWithChange();
    let builds = 0;
    const emptyGraph = (): ImportGraphBuildResult => ({
      data: new ImportGraph([], []),
      coverage: 1,
      attempted: 0,
      unresolved: 0,
      unresolvedImports: [],
      degraded: [],
    });
    const acquiringAnalyzer = (axiom: string): Analyzer => ({
      axiom,
      run: async (context) => {
        // Deliberate yield BEFORE acquiring: a memo that only stored results
        // after an awaited build would let both analyzers race past the miss.
        await new Promise((resolve) => setImmediate(resolve));
        for (const tsconfigPath of context.tsconfigPaths) {
          context.graphCache?.acquire(tsconfigPath, () => {
            builds += 1;
            return emptyGraph();
          });
        }
        return { findings: [], degraded: [] };
      },
    });
    const result = await runReview({
      cwd,
      analyzers: [acquiringAnalyzer("1"), acquiringAnalyzer("3")],
    });
    expect(result.ok).toBe(true);
    expect(builds).toBe(1); // one tsconfig, one parse — the memo covers the second analyzer
  });
});

describe("runReview merge step (phase 4, FR-21)", () => {
  it("reduces overlapping same-file+axiom findings into one merged finding in the artifact", async () => {
    const cwd = tempRepoWithChange();
    const a: Finding = {
      ...fakeFinding("change.ts"),
      findingId: "aaaaaaaaaaaaaaaa",
      location: { file: "change.ts", startLine: 10, endLine: 20 },
      message: "first",
      severity: "warning",
    };
    const b: Finding = {
      ...fakeFinding("change.ts"),
      findingId: "bbbbbbbbbbbbbbbb",
      location: { file: "change.ts", startLine: 15, endLine: 25 },
      message: "second",
      severity: "error",
      source: "regex",
    };
    const analyzer: Analyzer = { axiom: "1", run: async () => ({ findings: [b, a], degraded: [] }) };
    const result = await runReview({ cwd, analyzers: [analyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.findings).toHaveLength(1);
    expect(result.artifact.findings[0]).toMatchObject({
      findingId: "aaaaaaaaaaaaaaaa",
      severity: "error",
      source: ["ast", "regex"],
      message: "first | second",
      location: { file: "change.ts", startLine: 10, endLine: 25 },
    });
  });
});

describe("runReview manifest truth + wiring preflight (1.8)", () => {
  it("hashes committed conventions/corpus-map bytes and drops the sentinel degradations", async () => {
    const cwd = tempRepoWithChange();
    const outRoot = path.join(cwd, "_agentic-guardrails");
    mkdirSync(outRoot, { recursive: true });
    const conventions = "schemaVersion: 1\nconventions: []\n";
    const corpusMap = "schemaVersion: 1\nhumanConfirmed: []\n";
    writeFileSync(path.join(outRoot, "conventions.yaml"), conventions);
    writeFileSync(path.join(outRoot, "corpus-map.yaml"), corpusMap);
    const result = await runReview({ cwd, analyzers: [cleanAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.manifest.ledgerHash).toBe(
      createHash("sha256").update(conventions).digest("hex"),
    );
    expect(result.artifact.manifest.corpusHash).toBe(
      createHash("sha256").update(corpusMap).digest("hex"),
    );
    const subjects = result.artifact.degraded.map((d) => d.subject);
    expect(subjects).not.toContain("ledger");
    expect(subjects).not.toContain("corpus");
  });

  it("keeps the other file's sentinel when only one knowledge file exists", async () => {
    const cwd = tempRepoWithChange();
    const outRoot = path.join(cwd, "_agentic-guardrails");
    mkdirSync(outRoot, { recursive: true });
    writeFileSync(path.join(outRoot, "conventions.yaml"), "schemaVersion: 1\nconventions: []\n");
    const result = await runReview({ cwd, analyzers: [cleanAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.manifest.ledgerHash).not.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(result.artifact.manifest.corpusHash).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(result.artifact.degraded.map((d) => d.subject)).toContain("corpus");
    expect(result.artifact.degraded.map((d) => d.subject)).not.toContain("ledger");
  });

  it("warns (wiringWarnings channel, never a failure) when wiring lines are missing from an INITIALIZED folder", async () => {
    const cwd = tempRepoWithChange();
    // An init marker exists but neither wiring file does — all warnings fire.
    mkdirSync(path.join(cwd, "_agentic-guardrails"), { recursive: true });
    writeFileSync(
      path.join(cwd, "_agentic-guardrails", "conventions.yaml"),
      "schemaVersion: 1\nconventions: []\n",
    );
    const result = await runReview({ cwd, analyzers: [cleanAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wiringWarnings.join("\n")).toContain("history JSONL will merge with conflicts");
    expect(result.wiringWarnings.join("\n")).toContain(".cache/ may be committed");
    expect(result.wiringWarnings.join("\n")).toContain("review artifacts may be committed");
    expect(result.wiringWarnings.join("\n")).toContain("the generated schema file may be committed");
    // Wiring is not the config plane: no config warnings here.
    expect(result.configWarnings).toEqual([]);
    expect(result.degradedRun).toBe(false); // a warning is never a degradation
  });

  it("stays silent for an uninitialized repo (no _agentic-guardrails/ folder)", async () => {
    const cwd = tempRepoWithChange();
    const result = await runReview({ cwd, analyzers: [cleanAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Actually silent: no config warnings and no wiring lines for an
    // uninitialized repo.
    expect(result.configWarnings).toEqual([]);
    expect(result.wiringWarnings).toEqual([]);
    // Uninitialized: sentinels + degradations exactly as before 1.8.
    expect(result.artifact.degraded.map((d) => d.subject)).toEqual(["ledger", "corpus"]);
  });

  it("stays silent for a marker-less folder the artifact writer auto-created (no init ran)", async () => {
    const cwd = tempRepoWithChange();
    // What a first review leaves behind on a never-initialized repo.
    mkdirSync(path.join(cwd, "_agentic-guardrails"), { recursive: true });
    writeFileSync(
      path.join(cwd, "_agentic-guardrails", ".gitignore"),
      "reviews/\n.cache/\nconfig.schema.json\n",
    );
    const result = await runReview({ cwd, analyzers: [cleanAnalyzer] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wiringWarnings).toEqual([]);
  });

  const KNOWLEDGE_FILES = [
    ["conventions.yaml", "ledger", "schemaVersion: 7\nconventions: []\n"],
    ["corpus-map.yaml", "corpus", "schemaVersion: 7\nhumanConfirmed: []\n"],
  ] as const;

  for (const [file, subject, schemaInvalid] of KNOWLEDGE_FILES) {
    it(`${file}: garbage bytes get a REAL sha256 plus an invalidity degradation (exit-2 class)`, async () => {
      const cwd = tempRepoWithChange();
      const outRoot = path.join(cwd, "_agentic-guardrails");
      mkdirSync(outRoot, { recursive: true });
      writeFileSync(path.join(outRoot, file), "hello");
      const result = await runReview({ cwd, analyzers: [cleanAnalyzer] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const hashKey = subject === "ledger" ? "ledgerHash" : "corpusHash";
      expect(result.artifact.manifest[hashKey]).toBe(
        createHash("sha256").update("hello").digest("hex"),
      );
      const degradation = result.runDegraded.find((d) => d.subject === subject);
      expect(degradation?.reason).toContain(`${file} present but invalid`);
      expect(result.degradedRun).toBe(true); // counts toward exit 2
    });

    it(`${file}: schema-invalid YAML keeps the real hash + a degradation naming the path`, async () => {
      const cwd = tempRepoWithChange();
      const outRoot = path.join(cwd, "_agentic-guardrails");
      mkdirSync(outRoot, { recursive: true });
      writeFileSync(path.join(outRoot, file), schemaInvalid);
      const result = await runReview({ cwd, analyzers: [cleanAnalyzer] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const degradation = result.runDegraded.find((d) => d.subject === subject);
      expect(degradation?.reason).toContain(`${file} present but invalid`);
      expect(degradation?.reason).toContain("schemaVersion");
      expect(result.degradedRun).toBe(true);
    });

    it(`${file}: a directory at the path is a READ error (sentinel hash), never "absent until init"`, async () => {
      const cwd = tempRepoWithChange();
      mkdirSync(path.join(cwd, "_agentic-guardrails", file), { recursive: true });
      const result = await runReview({ cwd, analyzers: [cleanAnalyzer] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const hashKey = subject === "ledger" ? "ledgerHash" : "corpusHash";
      expect(result.artifact.manifest[hashKey]).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
      const degradation = result.runDegraded.find((d) => d.subject === subject);
      expect(degradation?.reason).toContain(`${file} unreadable`);
      expect(degradation?.reason).not.toContain("absent until init");
      expect(result.degradedRun).toBe(true);
    });

    it(`${file}: a valid file hashes clean — no degradation, run not degraded`, async () => {
      const cwd = tempRepoWithChange();
      const outRoot = path.join(cwd, "_agentic-guardrails");
      mkdirSync(outRoot, { recursive: true });
      const valid =
        subject === "ledger"
          ? "schemaVersion: 1\nconventions: []\n"
          : "schemaVersion: 1\nhumanConfirmed: []\n";
      writeFileSync(path.join(outRoot, file), valid);
      const result = await runReview({ cwd, analyzers: [cleanAnalyzer] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.runDegraded.find((d) => d.subject === subject)).toBeUndefined();
      expect(result.degradedRun).toBe(false);
    });
  }
});
