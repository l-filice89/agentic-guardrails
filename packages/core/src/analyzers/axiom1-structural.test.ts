import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { findingSchema } from "@agentic-guardrails/contracts";
import { afterEach, describe, expect, it } from "vitest";

import type { AnalyzerContext } from "../pipeline/pipeline.js";
import { axiom1Structural } from "./axiom1-structural.js";

const tempDirs: string[] = [];

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2023",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
  },
  include: ["src"],
});

function fixtureProject(files: Record<string, string>): AnalyzerContext & { root: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "guardrails-axiom1-"));
  tempDirs.push(root);
  writeFileSync(path.join(root, "tsconfig.json"), TSCONFIG);
  mkdirSync(path.join(root, "src"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(path.join(root, rel), content);
  }
  return {
    root,
    repoRoot: root,
    changedFiles: Object.keys(files),
    tsconfigPaths: [path.join(root, "tsconfig.json")],
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("structural/circular-import", () => {
  it("reports a value-import cycle touching changed files as a schema-valid error Finding", async () => {
    const ctx = fixtureProject({
      "src/a.ts": 'import { b } from "./b.js";\nexport const a = b + 1;\n',
      "src/b.ts": 'import { a } from "./a.js";\nexport const b = 1;\nexport const c = a;\n',
    });
    const result = await axiom1Structural.run(ctx);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(findingSchema.safeParse(finding).success).toBe(true);
    expect(finding).toMatchObject({
      axiom: "1",
      ruleId: "structural/circular-import",
      tier: "deterministic",
      source: "ast",
      confidence: 1,
      severity: "error",
      enclosingSymbol: "src/a.ts -> src/b.ts -> src/a.ts",
    });
    expect(finding.location.file).toBe("src/a.ts"); // lexicographically-smallest anchor
  });

  it("reports each cycle once and deterministically", async () => {
    const ctx = fixtureProject({
      "src/a.ts": 'import "./b.js";\nexport const a = 1;\n',
      "src/b.ts": 'import "./a.js";\nexport const b = 1;\n',
    });
    const first = await axiom1Structural.run(ctx);
    const second = await axiom1Structural.run(ctx);
    expect(JSON.stringify(first.findings)).toBe(JSON.stringify(second.findings));
  });

  it("emits nothing for an acyclic project", async () => {
    const ctx = fixtureProject({
      "src/a.ts": 'import { b } from "./b.js";\nexport const a = b;\n',
      "src/b.ts": "export const b = 1;\n",
    });
    expect((await axiom1Structural.run(ctx)).findings).toEqual([]);
  });

  it("ignores type-only cycles (erased at runtime, legal)", async () => {
    const ctx = fixtureProject({
      "src/a.ts": 'import type { B } from "./b.js";\nexport interface A { b?: B }\n',
      "src/b.ts": 'import type { A } from "./a.js";\nexport interface B { a?: A }\n',
    });
    expect((await axiom1Structural.run(ctx)).findings).toEqual([]);
  });

  it("ignores cycles that do not touch a changed file", async () => {
    const ctx = fixtureProject({
      "src/a.ts": 'import "./b.js";\nexport const a = 1;\n',
      "src/b.ts": 'import "./a.js";\nexport const b = 1;\n',
      "src/other.ts": "export const other = 1;\n",
    });
    expect(
      (await axiom1Structural.run({ ...ctx, changedFiles: ["src/other.ts"] })).findings,
    ).toEqual([]);
  });

  it("degrades (never throws) on a missing tsconfig", async () => {
    const ctx = fixtureProject({ "src/a.ts": "export const a = 1;\n" });
    const result = await axiom1Structural.run({
      ...ctx,
      tsconfigPaths: [path.join(ctx.root, "nope", "tsconfig.json")],
    });
    expect(result.findings).toEqual([]);
    expect(result.degraded.length).toBeGreaterThan(0);
  });

  it("merges graphs across multiple tsconfigs and still finds the cycle", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "guardrails-axiom1-"));
    tempDirs.push(root);
    // Two projects: pkg-a is acyclic, pkg-b contains the cycle.
    for (const pkg of ["pkg-a", "pkg-b"]) {
      mkdirSync(path.join(root, pkg, "src"), { recursive: true });
      writeFileSync(
        path.join(root, pkg, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", strict: true },
          include: ["src"],
        }),
      );
    }
    writeFileSync(path.join(root, "pkg-a", "src", "x.ts"), "export const x = 1;\n");
    writeFileSync(
      path.join(root, "pkg-b", "src", "a.ts"),
      'import "./b.js";\nexport const a = 1;\n',
    );
    writeFileSync(
      path.join(root, "pkg-b", "src", "b.ts"),
      'import "./a.js";\nexport const b = 1;\n',
    );
    const result = await axiom1Structural.run({
      repoRoot: root,
      changedFiles: ["pkg-b/src/b.ts"],
      tsconfigPaths: [
        path.join(root, "pkg-a", "tsconfig.json"),
        path.join(root, "pkg-b", "tsconfig.json"),
      ],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.message).toContain("pkg-b/src/a.ts -> pkg-b/src/b.ts");
  });

  it("declares a changed file absent from every built graph as a degradation", async () => {
    const ctx = fixtureProject({ "src/a.ts": "export const a = 1;\n" });
    const result = await axiom1Structural.run({
      ...ctx,
      changedFiles: ["src/a.ts", "elsewhere/orphan.ts"],
    });
    expect(result.degraded).toContainEqual({
      reason: "changed file absent from the built import graph",
      subject: "elsewhere/orphan.ts",
    });
  });
});
