import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { computeFindingId, type Finding } from "@agentic-guardrails/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { runReview, type Analyzer } from "./pipeline.js";

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
      "5": { enforcement: "blocking" },
    });
    expect(result.artifact.gate).toEqual({
      pass: true,
      perAxiom: [
        { axiom: "1", enforcement: "advisory", errorFindings: 1, maxFindings: 0, pass: true },
        { axiom: "5", enforcement: "blocking", errorFindings: 0, maxFindings: 0, pass: true },
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
    expect(result.configWarnings).toEqual(["axioms.7 matches no known axiom"]);
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
  it("identical input produces byte-identical artifact JSON and the same runId", async () => {
    const cwd = tempRepoWithChange();
    const first = await runReview({ cwd, analyzers: [okAnalyzer] });
    const second = await runReview({ cwd, analyzers: [okAnalyzer] });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.artifactJson).toBe(first.artifactJson);
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
