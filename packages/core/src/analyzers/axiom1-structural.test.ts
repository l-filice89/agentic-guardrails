import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { findingSchema } from "@agentic-guardrails/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalyzerContext } from "../pipeline/pipeline.js";
import { axiom1Structural } from "./axiom1-structural.js";

// ts-morph project builds (one per test) legitimately exceed the 5s default
// under full-suite parallel load.
vi.setConfig({ testTimeout: 60_000 });

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

function fixtureProject(
  files: Record<string, string>,
  tsconfig: string = TSCONFIG,
): AnalyzerContext & { root: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "guardrails-axiom1-"));
  tempDirs.push(root);
  writeFileSync(path.join(root, "tsconfig.json"), tsconfig);
  for (const rel of Object.keys(files)) {
    mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
  }
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(path.join(root, rel), content);
  }
  return {
    root,
    repoRoot: root,
    changedFiles: Object.keys(files).sort(),
    tsconfigPaths: [path.join(root, "tsconfig.json")],
  };
}

/** Two-layer boundaries: app may import lib, lib may import nothing. */
const BOUNDARIES = {
  layers: [
    { name: "app", paths: ["src/app"] },
    { name: "lib", paths: ["src/lib"] },
  ],
  allowed: { app: ["lib"] },
};

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

  it("anchors the finding at the real import line of the cycle edge leaving the anchor", async () => {
    const ctx = fixtureProject({
      "src/a.ts": '// leading comment\n\nimport { b } from "./b.js";\nexport const a = b + 1;\n',
      "src/b.ts": 'import { a } from "./a.js";\nexport const b = 1;\nexport const c = a;\n',
    });
    const result = await axiom1Structural.run(ctx);
    expect(result.findings).toHaveLength(1);
    // Anchor file src/a.ts imports ./b.js on line 3 — not line 1.
    expect(result.findings[0]!.location).toEqual({ file: "src/a.ts", startLine: 3, endLine: 3 });
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

describe("structural/unresolved-import", () => {
  it("reports a changed file's unresolvable relative import at its line, specifier in the message", async () => {
    const ctx = fixtureProject({
      "src/a.ts":
        'export const a = 1;\nimport { gone } from "./deleted.js";\nexport const use = gone;\n',
    });
    const result = await axiom1Structural.run(ctx);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(findingSchema.safeParse(finding).success).toBe(true);
    expect(finding).toMatchObject({
      axiom: "1",
      ruleId: "structural/unresolved-import",
      tier: "deterministic",
      source: "ast",
      confidence: 1,
      severity: "error",
      enclosingSymbol: "./deleted.js",
      location: { file: "src/a.ts", startLine: 2, endLine: 2 },
    });
    expect(finding.message).toContain("./deleted.js");
    // The coverage-truth degradation for the same event stays.
    expect(result.degraded).toContainEqual({
      reason: "unresolvable import specifier",
      subject: "src/a.ts -> ./deleted.js",
    });
  });

  it("HAZARD: two unresolved imports in one file get DISTINCT findingIds", async () => {
    const ctx = fixtureProject({
      "src/a.ts": 'import "./gone-one.js";\nimport "./gone-two.js";\nexport const a = 1;\n',
    });
    const result = await axiom1Structural.run(ctx);
    expect(result.findings).toHaveLength(2);
    const ids = result.findings.map((f) => f.findingId);
    expect(new Set(ids).size).toBe(2);
    expect(result.findings.map((f) => f.location.startLine).sort()).toEqual([1, 2]);
  });

  it("never fires for an unresolved BARE specifier (uninstalled/typo external package)", async () => {
    const ctx = fixtureProject({
      "src/a.ts": 'import "totally-not-installed-pkg";\nexport const a = 1;\n',
    });
    const result = await axiom1Structural.run(ctx);
    expect(result.findings).toEqual([]);
    // Coverage truth still declared, just not an actionable finding.
    expect(result.degraded).toContainEqual({
      reason: "unresolved bare specifier",
      subject: "src/a.ts -> totally-not-installed-pkg",
    });
  });

  it("never fires for node builtins (verified externals)", async () => {
    const ctx = fixtureProject({
      "src/a.ts": 'import path from "node:path";\nexport const a = path.sep;\n',
    });
    expect((await axiom1Structural.run(ctx)).findings).toEqual([]);
  });

  it("fires for a broken tsconfig `paths` ALIAS (not a bare external)", async () => {
    const tsconfig = JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        baseUrl: ".",
        paths: { "@app/*": ["src/*"] },
      },
      include: ["src"],
    });
    const ctx = fixtureProject(
      { "src/a.ts": 'import { gone } from "@app/missing.js";\nexport const a = gone;\n' },
      tsconfig,
    );
    const result = await axiom1Structural.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "structural/unresolved-import",
      enclosingSymbol: "@app/missing.js",
      severity: "error",
    });
  });

  it("never fires under a bare '*' catch-all `paths` pattern (a typo'd package is not a broken alias)", async () => {
    const tsconfig = JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        baseUrl: ".",
        paths: { "*": ["src/types/*"] },
      },
      include: ["src"],
    });
    const ctx = fixtureProject(
      { "src/a.ts": 'import "totally-not-installed-pkg";\nexport const a = 1;\n' },
      tsconfig,
    );
    const result = await axiom1Structural.run(ctx);
    expect(result.findings).toEqual([]);
    expect(result.degraded).toContainEqual({
      reason: "unresolved bare specifier",
      subject: "src/a.ts -> totally-not-installed-pkg",
    });
  });

  it("honors the SUFFIX of a `paths` pattern — a prefix-only match is not an alias", async () => {
    const tsconfig = JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        baseUrl: ".",
        paths: { "@gen/*.js": ["src/gen/*.js"] },
      },
      include: ["src"],
    });
    // Starts with "@gen/" but does not end with ".js" — not this alias.
    const ctx = fixtureProject(
      { "src/a.ts": 'import "@gen/styles.css";\nexport const a = 1;\n' },
      tsconfig,
    );
    expect((await axiom1Structural.run(ctx)).findings).toEqual([]);
  });

  it("a short specifier cannot satisfy an overlapping prefix+suffix pattern", async () => {
    const tsconfig = JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        baseUrl: ".",
        paths: { "ab*ba": ["src/*"] },
      },
      include: ["src"],
    });
    // "aba": startsWith("ab") AND endsWith("ba") — but only via the shared
    // "b"; the length guard must reject it.
    const ctx = fixtureProject(
      { "src/a.ts": 'import "aba";\nexport const a = 1;\n' },
      tsconfig,
    );
    expect((await axiom1Structural.run(ctx)).findings).toEqual([]);
  });

  it("a type-only unresolved import says the TYPE import cannot resolve (no runtime implication), still error", async () => {
    const ctx = fixtureProject({
      "src/a.ts": 'import type { Gone } from "./deleted.js";\nexport type A = Gone;\n',
    });
    const result = await axiom1Structural.run(ctx);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.severity).toBe("error");
    expect(finding.message).toBe(
      'unresolved type-only import "./deleted.js" — the type import cannot resolve; target missing, deleted, or misspelled',
    );
  });

  it("does not fire for an unresolved import in an UNCHANGED file", async () => {
    const ctx = fixtureProject({
      "src/a.ts": 'import "./gone.js";\nexport const a = 1;\n',
      "src/b.ts": "export const b = 1;\n",
    });
    const result = await axiom1Structural.run({ ...ctx, changedFiles: ["src/b.ts"] });
    expect(result.findings).toEqual([]);
  });
});

describe("structural/dependency-direction + structural/unassigned-file", () => {
  const LAYERED = {
    "src/app/a.ts": 'import { util } from "../lib/util.js";\nexport const a = util;\n',
    "src/lib/util.ts": "export const util = 1;\n",
  };

  it("emits NOTHING without a boundaries declaration — and no degradation", async () => {
    const ctx = fixtureProject({
      ...LAYERED,
      "src/lib/bad.ts": 'import { a } from "../app/a.js";\nexport const bad = a;\n',
      "src/stray.ts": "export const stray = 1;\n",
    });
    const result = await axiom1Structural.run(ctx); // no ctx.boundaries
    expect(result.findings).toEqual([]);
    expect(result.degraded).toEqual([]);
  });

  it("reports a disallowed cross-layer import at its line, both layers named (error)", async () => {
    const ctx = fixtureProject({
      ...LAYERED,
      "src/lib/bad.ts":
        '// lib must not depend on app\nimport { a } from "../app/a.js";\nexport const bad = a;\n',
    });
    const result = await axiom1Structural.run({ ...ctx, boundaries: BOUNDARIES });
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(findingSchema.safeParse(finding).success).toBe(true);
    expect(finding).toMatchObject({
      ruleId: "structural/dependency-direction",
      severity: "error",
      location: { file: "src/lib/bad.ts", startLine: 2, endLine: 2 },
      enclosingSymbol: "lib->app:src/app/a.ts",
    });
    expect(finding.message).toContain('"lib"');
    expect(finding.message).toContain('"app"');
  });

  it("allows declared directions and same-layer imports without declaring them", async () => {
    const ctx = fixtureProject({
      ...LAYERED, // app -> lib is declared allowed
      "src/app/b.ts": 'import { a } from "./a.js";\nexport const b = a;\n', // app -> app
    });
    expect((await axiom1Structural.run({ ...ctx, boundaries: BOUNDARIES })).findings).toEqual([]);
  });

  it("BYPASS GUARD: type-only imports crossing layers are exempt (erased at runtime)", async () => {
    const ctx = fixtureProject({
      ...LAYERED,
      "src/lib/types.ts": 'import type { a } from "../app/a.js";\nexport type T = typeof a;\n',
    });
    expect((await axiom1Structural.run({ ...ctx, boundaries: BOUNDARIES })).findings).toEqual([]);
  });

  it("BYPASS GUARD: dynamic imports crossing layers ARE violations", async () => {
    const ctx = fixtureProject({
      ...LAYERED,
      "src/lib/lazy.ts": 'export const load = async () => await import("../app/a.js");\n',
    });
    const result = await axiom1Structural.run({ ...ctx, boundaries: BOUNDARIES });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "structural/dependency-direction",
      location: { file: "src/lib/lazy.ts", startLine: 1, endLine: 1 },
    });
  });

  it("BYPASS GUARD: re-exports crossing layers ARE violations", async () => {
    const ctx = fixtureProject({
      ...LAYERED,
      "src/lib/reexport.ts": 'export { a } from "../app/a.js";\n',
    });
    const result = await axiom1Structural.run({ ...ctx, boundaries: BOUNDARIES });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ ruleId: "structural/dependency-direction" });
  });

  it("BYPASS GUARD: a file under two layer prefixes belongs to the LONGEST one", async () => {
    // src/lib/special nests inside src/lib — the more specific layer wins,
    // regardless of declaration order.
    const nested = {
      layers: [
        { name: "lib", paths: ["src/lib"] },
        { name: "special", paths: ["src/lib/special"] },
        { name: "app", paths: ["src/app"] },
      ],
      allowed: { special: ["app"] }, // lib -> app stays disallowed
    };
    const ctx = fixtureProject({
      "src/app/a.ts": "export const a = 1;\n",
      "src/lib/special/ok.ts": 'import { a } from "../../app/a.js";\nexport const ok = a;\n',
    });
    // Under longest-prefix the importer is `special` (allowed) — a shorter
    // `lib` match would flag it.
    expect((await axiom1Structural.run({ ...ctx, boundaries: nested })).findings).toEqual([]);
  });

  it("external bare imports are never direction-checked", async () => {
    const ctx = fixtureProject({
      "src/lib/uses.ts": 'import { z } from "zod";\nexport const s = z;\n',
    });
    const result = await axiom1Structural.run({ ...ctx, boundaries: BOUNDARIES });
    expect(result.findings.filter((f) => f.ruleId === "structural/dependency-direction")).toEqual(
      [],
    );
  });

  it("warns (not errors) on a changed file matching NO declared layer prefix", async () => {
    const ctx = fixtureProject({
      ...LAYERED,
      "src/stray.ts": "export const stray = 1;\n",
    });
    const result = await axiom1Structural.run({ ...ctx, boundaries: BOUNDARIES });
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(findingSchema.safeParse(finding).success).toBe(true);
    expect(finding).toMatchObject({
      ruleId: "structural/unassigned-file",
      severity: "warning",
      location: { file: "src/stray.ts", startLine: 1, endLine: 1 },
    });
    expect(finding.enclosingSymbol).toBeUndefined(); // one per file, line-free id
  });

  it("TEST-THE-BYPASS: an import into an internal file assigned to NO layer is a direction error", async () => {
    const ctx = fixtureProject({
      "src/app/a.ts": 'import { h } from "../shared/helper.js";\nexport const a = h;\n',
      "src/shared/helper.ts": "export const h = 1;\n", // no declared layer
    });
    const result = await axiom1Structural.run({
      ...ctx,
      changedFiles: ["src/app/a.ts"],
      boundaries: BOUNDARIES,
    });
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(findingSchema.safeParse(finding).success).toBe(true);
    expect(finding).toMatchObject({
      ruleId: "structural/dependency-direction",
      severity: "error",
      location: { file: "src/app/a.ts", startLine: 1, endLine: 1 },
      enclosingSymbol: "app->(unassigned):src/shared/helper.ts",
    });
    expect(finding.message).toContain("outside every declared boundary layer");
  });

  it("a layer literally named 'constructor' never crashes the allowed-map lookup (prototype chain)", async () => {
    const boundaries = {
      layers: [
        { name: "constructor", paths: ["src/app"] },
        { name: "lib", paths: ["src/lib"] },
      ],
      allowed: {},
    };
    const ctx = fixtureProject({
      "src/app/a.ts": 'import { util } from "../lib/util.js";\nexport const a = util;\n',
      "src/lib/util.ts": "export const util = 1;\n",
    });
    const result = await axiom1Structural.run({ ...ctx, boundaries });
    // No crash — and the undeclared constructor->lib pair still fires.
    expect(result.degraded).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "structural/dependency-direction",
      enclosingSymbol: "constructor->lib:src/lib/util.ts",
    });
  });

  it.runIf(process.platform === "win32" || process.platform === "darwin")(
    "a layer prefix differing only in case still assigns on a case-folding platform",
    async () => {
      const boundaries = {
        layers: [
          { name: "app", paths: ["SRC/app"] }, // case differs from disk
          { name: "lib", paths: ["src/lib"] },
        ],
        allowed: { app: ["lib"] },
      };
      const ctx = fixtureProject({
        ...LAYERED,
        "src/stray.ts": "export const stray = 1;\n",
      });
      const result = await axiom1Structural.run({ ...ctx, boundaries });
      // src/app/a.ts is assigned (folded prefix match) — its app->lib import
      // is legal, and only the genuinely stray file warns.
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({
        ruleId: "structural/unassigned-file",
        location: { file: "src/stray.ts", startLine: 1, endLine: 1 },
      });
    },
  );

  it("a DUPLICATE changedFiles entry never doubles per-file findings", async () => {
    const ctx = fixtureProject({
      ...LAYERED,
      "src/stray.ts": "export const stray = 1;\n",
    });
    const result = await axiom1Structural.run({
      ...ctx,
      changedFiles: [...ctx.changedFiles, "src/stray.ts"],
      boundaries: BOUNDARIES,
    });
    expect(result.findings.filter((f) => f.ruleId === "structural/unassigned-file")).toHaveLength(1);
  });

  it("skips the unassigned warning for a file already degraded as absent from every built graph", async () => {
    const ctx = fixtureProject(LAYERED);
    const result = await axiom1Structural.run({
      ...ctx,
      changedFiles: [...ctx.changedFiles, "elsewhere/orphan.ts"],
      boundaries: BOUNDARIES,
    });
    // The degradation IS the surface for that event — no double report.
    expect(result.degraded).toContainEqual({
      reason: "changed file absent from the built import graph",
      subject: "elsewhere/orphan.ts",
    });
    expect(
      result.findings.filter((f) => f.location.file === "elsewhere/orphan.ts"),
    ).toEqual([]);
  });

  it("only CHANGED files are checked for direction/unassignment", async () => {
    const ctx = fixtureProject({
      ...LAYERED,
      "src/lib/bad.ts": 'import { a } from "../app/a.js";\nexport const bad = a;\n',
      "src/stray.ts": "export const stray = 1;\n",
    });
    const result = await axiom1Structural.run({
      ...ctx,
      changedFiles: ["src/lib/util.ts"],
      boundaries: BOUNDARIES,
    });
    expect(result.findings).toEqual([]);
  });

  it("findingIds are distinct across rules firing in the same file", async () => {
    // One file: unresolved import AND a direction breach.
    const ctx = fixtureProject({
      "src/app/a.ts": "export const a = 1;\n",
      "src/lib/bad.ts":
        'import { a } from "../app/a.js";\nimport "./gone.js";\nexport const bad = a;\n',
    });
    const result = await axiom1Structural.run({ ...ctx, boundaries: BOUNDARIES });
    const ids = result.findings.map((f) => f.findingId);
    expect(result.findings).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
