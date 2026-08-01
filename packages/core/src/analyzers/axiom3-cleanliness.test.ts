import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { findingSchema } from "@agentic-guardrails/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ImportGraphBuildResult } from "../adapter/language-adapter.js";
import type { AnalyzerContext, GraphCache } from "../pipeline/pipeline.js";
import { axiom3Cleanliness } from "./axiom3-cleanliness.js";

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

/** In-memory graph memo implementing the pipeline's GraphCache seam: unit
 * tests exercise the acquire branch, repeat runs on one context skip the
 * ts-morph re-parse, and `builds` counts real adapter builds. */
interface CountingGraphCache extends GraphCache {
  readonly builds: number;
}
function countingGraphCache(): CountingGraphCache {
  const memo = new Map<string, ImportGraphBuildResult>();
  let builds = 0;
  return {
    get builds() {
      return builds;
    },
    acquire(tsconfigPath, build) {
      const hit = memo.get(tsconfigPath);
      if (hit !== undefined) return hit;
      builds += 1;
      const built = build();
      memo.set(tsconfigPath, built);
      return built;
    },
  };
}

function fixtureProject(
  files: Record<string, string>,
  tsconfig: string = TSCONFIG,
): AnalyzerContext & { root: string; graphCache: CountingGraphCache } {
  const root = mkdtempSync(path.join(os.tmpdir(), "guardrails-axiom3-"));
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
    graphCache: countingGraphCache(),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Two 5-statement bodies with IDENTICAL structure after identifiers → ID and
// literals → LIT (the copy-paste-then-rename pattern), plus a structurally
// different third of the same length.
const DUP_A = `export function alpha(): number {
  const a = 1;
  const b = a + 2;
  const c = b + 3;
  const d = [a, b, c].map((x) => x + 1);
  return d.length + a;
}
`;
const DUP_B = `export function beta(): number {
  const z = 9;
  const y = z + 8;
  const w = y + 7;
  const v = [z, y, w].map((q) => q + 6);
  return v.length + z;
}
`;
const NOT_DUP = `export function gamma(): number {
  const a = 2;
  const b = a * 3;
  const c = b - 4;
  const d = [c, b, a].map((x) => x * 2).filter((x) => x > 1);
  return d.length - a;
}
`;

describe("cleanliness/unreachable-code", () => {
  it("reports statements after a return as a schema-valid error Finding anchored at the first dead statement", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export function compute(): number {",
        "  const x = 1;",
        "  return x;",
        "  const dead = 2;",
        "  void dead;",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom3Cleanliness.run(ctx);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(findingSchema.safeParse(finding).success).toBe(true);
    expect(finding).toMatchObject({
      axiom: "3",
      ruleId: "cleanliness/unreachable-code",
      tier: "deterministic",
      source: "ast",
      confidence: 1,
      severity: "error",
    });
    expect(finding.location).toEqual({ file: "src/a.ts", startLine: 4, endLine: 4 });
    expect(finding.enclosingSymbol).toContain("compute");
    expect(finding.enclosingSymbol).not.toMatch(/\b4\b/); // line-free discriminator
  });

  it("HAZARD: anchors at the first dead statement after a throw inside a NESTED if-block", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export function guard(flag: boolean): number {",
        "  if (flag) {",
        '    throw new Error("no");',
        "    console.log('dead');",
        "  }",
        "  return 1;",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom3Cleanliness.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.location.startLine).toBe(4);
    expect(result.findings[0]!.message).toContain("throw");
  });

  it("emits nothing when the terminal statement is last in its block", async () => {
    const ctx = fixtureProject({
      "src/a.ts": "export function ok(): number {\n  return 1;\n}\n",
    });
    expect((await axiom3Cleanliness.run(ctx)).findings).toEqual([]);
  });

  it("does NOT flag a hoisted `function` declaration after a return (idiomatic helper pattern)", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export function compute(): number {",
        "  return helper();",
        "  function helper(): number {",
        "    return 1;",
        "  }",
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom3Cleanliness.run(ctx)).findings).toEqual([]);
  });

  it("does NOT flag type-only statements (type alias / interface) after a return — erased at runtime", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export function compute(): number {",
        "  return 1;",
        "  type Local = { value: number };",
        "  interface Shape { value: Local }",
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom3Cleanliness.run(ctx)).findings).toEqual([]);
  });

  it("anchors at the first REAL dead statement when a hoisted function precedes it", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export function compute(): number {",
        "  return helper();",
        "  function helper(): number {",
        "    return 1;",
        "  }",
        "  const dead = 2;",
        "  void dead;",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom3Cleanliness.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.location.startLine).toBe(6); // the const, not the function
  });

  it("keeps the findingId stable when unrelated lines shift above", async () => {
    const body = "export function f(): number {\n  return 1;\n  const dead = 2;\n  void dead;\n}\n";
    const first = await axiom3Cleanliness.run(fixtureProject({ "src/a.ts": body }));
    const shifted = await axiom3Cleanliness.run(
      fixtureProject({ "src/a.ts": `// one\n// two\n// three\n${body}` }),
    );
    expect(first.findings).toHaveLength(1);
    expect(shifted.findings).toHaveLength(1);
    expect(shifted.findings[0]!.findingId).toBe(first.findings[0]!.findingId);
    expect(shifted.findings[0]!.location.startLine).toBe(6); // anchor still real
  });
});

describe("cleanliness/unused-export", () => {
  it("reports an exported symbol no file imports by name (warning, symbol discriminator)", async () => {
    const ctx = fixtureProject({
      "src/lib.ts": "export const used = 1;\nexport const orphan = 2;\n",
      "src/main.ts": 'import { used } from "./lib.js";\nexport const main = used;\n',
    });
    const result = await axiom3Cleanliness.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "cleanliness/unused-export",
      severity: "warning",
      enclosingSymbol: "orphan",
      location: { file: "src/lib.ts", startLine: 2, endLine: 2 },
    });
  });

  it("BYPASS PROBE: a namespace import exempts ALL of the target's exports", async () => {
    const ctx = fixtureProject({
      "src/lib.ts": "export const used = 1;\nexport const orphan = 2;\n",
      "src/main.ts": 'import * as lib from "./lib.js";\nexport const main = lib.used;\n',
    });
    expect((await axiom3Cleanliness.run(ctx)).findings).toEqual([]);
  });

  it("BYPASS PROBE (zero importers, exempting direction): a file NOBODY imports gets no findings for any export", async () => {
    const ctx = fixtureProject({
      "src/entry.ts": "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n",
    });
    expect((await axiom3Cleanliness.run(ctx)).findings).toEqual([]);
  });

  it("BYPASS PROBE (zero importers, firing direction): ONE importer makes the other exports checkable", async () => {
    const ctx = fixtureProject({
      "src/lib.ts": "export const a = 1;\nexport const b = 2;\n",
      "src/main.ts": 'import { a } from "./lib.js";\nexport const main = a;\n',
    });
    const result = await axiom3Cleanliness.run(ctx);
    expect(result.findings.map((f) => f.enclosingSymbol)).toEqual(["b"]);
  });

  it("BYPASS PROBE (re-export chain): a barrel named re-export + consumer counts as usage", async () => {
    const ctx = fixtureProject({
      "src/impl.ts": "export const fromImpl = 1;\n",
      "src/barrel.ts": 'export { fromImpl } from "./impl.js";\n',
      "src/main.ts": 'import { fromImpl } from "./barrel.js";\nexport const main = fromImpl;\n',
    });
    expect((await axiom3Cleanliness.run(ctx)).findings).toEqual([]);
  });

  it("`export * from` of a file counts as using ALL its exports", async () => {
    const ctx = fixtureProject({
      "src/impl.ts": "export const one = 1;\nexport const two = 2;\n",
      "src/barrel.ts": 'export * from "./impl.js";\n',
      "src/main.ts": 'import { one } from "./barrel.js";\nexport const main = one;\n',
    });
    expect((await axiom3Cleanliness.run(ctx)).findings).toEqual([]);
  });

  it("tracks `export default` as the name \"default\" — used by a default import, unused without one", async () => {
    const used = fixtureProject({
      "src/lib.ts": "const value = 1;\nexport default value;\nexport const named = 2;\n",
      "src/main.ts": 'import lib, { named } from "./lib.js";\nexport const main = lib + named;\n',
    });
    expect((await axiom3Cleanliness.run(used)).findings).toEqual([]);

    const unused = fixtureProject({
      "src/lib.ts": "const value = 1;\nexport default value;\nexport const named = 2;\n",
      "src/main.ts": 'import { named } from "./lib.js";\nexport const main = named;\n',
    });
    const result = await axiom3Cleanliness.run(unused);
    expect(result.findings.map((f) => f.enclosingSymbol)).toEqual(["default"]);
  });

  it("type-only usage counts as usage", async () => {
    const ctx = fixtureProject({
      "src/types.ts": "export interface Shape { value: number }\n",
      "src/main.ts":
        'import type { Shape } from "./types.js";\nexport const main: Shape = { value: 1 };\n',
    });
    expect((await axiom3Cleanliness.run(ctx)).findings).toEqual([]);
  });

  it("HAZARD (P2): multiple declarations of ONE export name yield ONE finding (overloads, merging, const+brace)", async () => {
    const ctx = fixtureProject({
      "src/lib.ts": [
        "export function over(a: number): number;",
        "export function over(a: string): string;",
        "export function over(a: unknown): unknown {",
        "  return a;",
        "}",
        "export interface Merged { a: number }",
        "export interface Merged { b: number }",
        "const twice = 1;",
        "export { twice };",
        "export const twice2 = twice;",
        "export { twice2 };",
        "export const used = 1;",
        "",
      ].join("\n"),
      "src/main.ts": 'import { used } from "./lib.js";\nexport const main = used;\n',
    });
    const result = await axiom3Cleanliness.run(ctx);
    const names = result.findings.map((f) => f.enclosingSymbol);
    // One finding per NAME — never two findings sharing a findingId.
    // (Sorted by line: over@1, Merged@6, twice@9, twice2@10.)
    expect(names).toEqual(["over", "Merged", "twice", "twice2"]);
    expect(new Set(result.findings.map((f) => f.findingId)).size).toBe(result.findings.length);
  });

  it("P3: `export * as ns from` declares the named export `ns` — flagged when unused, silent when imported", async () => {
    const files = {
      "src/impl.ts": "export const one = 1;\n",
      "src/barrel.ts": 'export * as ns from "./impl.js";\nexport const other = 1;\n',
    };
    const unused = fixtureProject({
      ...files,
      "src/main.ts": 'import { other } from "./barrel.js";\nexport const main = other;\n',
    });
    const result = await axiom3Cleanliness.run(unused);
    expect(result.findings.map((f) => f.enclosingSymbol)).toEqual(["ns"]);

    const used = fixtureProject({
      ...files,
      "src/main.ts":
        'import { ns, other } from "./barrel.js";\nexport const main = ns.one + other;\n',
    });
    expect((await axiom3Cleanliness.run(used)).findings).toEqual([]);
  });

  it("P4: a side-effect-only importer does NOT make the target's exports checkable", async () => {
    const ctx = fixtureProject({
      "src/lib.ts": "export const a = 1;\nexport const b = 2;\n",
      "src/main.ts": 'import "./lib.js";\nexport const main = 1;\n',
    });
    expect((await axiom3Cleanliness.run(ctx)).findings).toEqual([]);
  });

  it("P4 (firing direction): side-effect import PLUS one named importer makes the other exports checkable", async () => {
    const ctx = fixtureProject({
      "src/lib.ts": "export const a = 1;\nexport const b = 2;\n",
      "src/setup.ts": 'import "./lib.js";\nexport const setup = 1;\n',
      "src/main.ts": 'import { a } from "./lib.js";\nexport const main = a;\n',
    });
    const result = await axiom3Cleanliness.run(ctx);
    expect(result.findings.map((f) => f.enclosingSymbol)).toEqual(["b"]);
  });
});

describe("cleanliness/duplicate-code", () => {
  it("reports one finding per duplicate pair, anchored at the LATER file, naming the original", async () => {
    const ctx = fixtureProject({
      "src/first.ts": DUP_A,
      "src/second.ts": DUP_B,
    });
    const result = await axiom3Cleanliness.run(ctx);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding).toMatchObject({
      ruleId: "cleanliness/duplicate-code",
      severity: "warning",
    });
    expect(finding.location.file).toBe("src/second.ts"); // later in file-sort order
    expect(finding.message).toContain("src/first.ts:1"); // names the original
  });

  it("HAZARD: findingId is stable regardless of changed-file discovery order", async () => {
    const files = { "src/first.ts": DUP_A, "src/second.ts": DUP_B };
    const ctx = fixtureProject(files);
    const forward = await axiom3Cleanliness.run(ctx);
    const reversed = await axiom3Cleanliness.run({
      ...ctx,
      changedFiles: [...ctx.changedFiles].reverse(),
    });
    expect(forward.findings).toHaveLength(1);
    expect(reversed.findings).toHaveLength(1);
    expect(reversed.findings[0]!.findingId).toBe(forward.findings[0]!.findingId);
    expect(reversed.findings[0]!.location.file).toBe("src/second.ts");
  });

  it("reports every occurrence pair when one file contains three copies", async () => {
    const third = DUP_B.replace("beta", "gamma");
    const ctx = fixtureProject({ "src/repeated.ts": `${DUP_A}\n${DUP_B}\n${third}` });
    const duplicates = (await axiom3Cleanliness.run(ctx)).findings.filter(
      (finding) => finding.ruleId === "cleanliness/duplicate-code",
    );
    expect(duplicates).toHaveLength(3);
    expect(new Set(duplicates.map((finding) => finding.findingId)).size).toBe(3);
  });

  it("ignores identical SMALL bodies (below the 5-statement floor)", async () => {
    const small = "{\n  const a = 1;\n  const b = a + 1;\n  return b;\n}";
    const ctx = fixtureProject({
      "src/first.ts": `export function alpha(): number ${small}\n`,
      "src/second.ts": `export function beta(): number ${small}\n`,
    });
    expect((await axiom3Cleanliness.run(ctx)).findings).toEqual([]);
  });

  it("does not match structurally DIFFERENT bodies of the same length", async () => {
    const ctx = fixtureProject({
      "src/first.ts": DUP_A,
      "src/second.ts": NOT_DUP,
    });
    expect((await axiom3Cleanliness.run(ctx)).findings).toEqual([]);
  });

  it("JSDoc comments are structure-invisible: a doc'd copy still matches (comments-stripped contract)", async () => {
    const withDoc = DUP_B.replace("  const z = 9;", "  /** documented */\n  const z = 9;");
    const ctx = fixtureProject({
      "src/first.ts": DUP_A,
      "src/second.ts": withDoc,
    });
    const result = await axiom3Cleanliness.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.ruleId).toBe("cleanliness/duplicate-code");
  });

  it("HAZARD (nested closures): copying an outer function does not double-count its nested closure — one finding", async () => {
    const outer = (fn: string, ids: string[]): string =>
      [
        `export function ${fn}(): number {`,
        `  const ${ids[0]} = (): number => {`,
        `    const a = 1;`,
        `    const b = a + 1;`,
        `    const c = b + 1;`,
        `    const d = c + 1;`,
        `    return d;`,
        `  };`,
        `  const ${ids[1]} = 1;`,
        `  const ${ids[2]} = ${ids[1]} + 2;`,
        `  const ${ids[3]} = ${ids[0]}() + ${ids[2]};`,
        `  return ${ids[3]};`,
        `}`,
        ``,
      ].join("\n");
    const ctx = fixtureProject({
      "src/first.ts": outer("outerA", ["inner", "x", "y", "z"]),
      "src/second.ts": outer("outerB", ["calc", "p", "q", "r"]),
    });
    const result = await axiom3Cleanliness.run(ctx);
    expect(result.findings).toHaveLength(1); // the OUTER pair only
    expect(result.findings[0]!.location).toMatchObject({ file: "src/second.ts", startLine: 1 });
  });
});

describe("cleanliness/excessive-complexity", () => {
  /** `decisions` decision points via chained `&&` in one expression. */
  function fnWithComplexity(decisions: number): string {
    const clauses = Array.from({ length: decisions }, (_, i) => `flag${i}`).join(" && ");
    const params = Array.from({ length: decisions }, (_, i) => `flag${i}: boolean`).join(", ");
    return `export function decide(${params}): boolean {\n  return ${clauses};\n}\n`;
  }

  it("HAZARD (boundary): complexity exactly 15 is silent, 16 fires stating 16 > 15", async () => {
    // 14 && operators → 15 total; 15 → 16 total.
    const at15 = fixtureProject({ "src/a.ts": fnWithComplexity(15) });
    expect((await axiom3Cleanliness.run(at15)).findings).toEqual([]);

    const at16 = fixtureProject({ "src/a.ts": fnWithComplexity(16) });
    const result = await axiom3Cleanliness.run(at16);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "cleanliness/excessive-complexity",
      severity: "warning",
      enclosingSymbol: "decide",
    });
    expect(result.findings[0]!.message).toContain("16 > 15");
  });

  it("counts if/case/catch/ternary/&&/||/?? decision points", async () => {
    // 1 base + 4 if + 2 case + 1 catch + 2 ternary + 3 && + 3 || + 2 ?? = 18.
    const ctx = fixtureProject({
      "src/a.ts": [
        "export function busy(n: number, s?: string): number {",
        "  let total = 0;",
        "  if (n > 1) total += 1;",
        "  if (n > 2) total += 1;",
        "  if (n > 3) total += 1;",
        "  if (n > 4) total += 1;",
        "  switch (n) {",
        "    case 1:",
        "      total += 1;",
        "      break;",
        "    case 2:",
        "      total += 1;",
        "      break;",
        "    default:",
        "      total -= 1;",
        "  }",
        "  try {",
        "    total += n > 5 ? 1 : 0;",
        "  } catch {",
        "    total = 0;",
        "  }",
        "  const gated = n > 6 && n > 7 && n > 8 && total > 0;",
        "  const either = n > 9 || n > 10 || n > 11 || gated;",
        "  const fallback = (s ?? \"x\") ?? \"y\";",
        "  return total + (either ? 1 : 0) + fallback.length;",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom3Cleanliness.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.message).toMatch(/complexity: \d+ > 15/);
  });

  it("logical-assignment operators (&&= / ||= / ??=) are decision points — a function can cross the threshold on them alone", async () => {
    const lines = [
      ...Array.from({ length: 6 }, (_, i) => `  o.a${i} ??= 1;`),
      ...Array.from({ length: 5 }, (_, i) => `  o.b${i} &&= 2;`),
      ...Array.from({ length: 5 }, (_, i) => `  o.c${i} ||= 3;`),
    ];
    // 1 base + 16 logical assignments = 17 > 15.
    const ctx = fixtureProject({
      "src/a.ts": [
        "export function fill(o: Record<string, number | undefined>): void {",
        ...lines,
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom3Cleanliness.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.message).toContain("17 > 15");
  });

  it("HAZARD (P2): two same-named over-threshold function-likes get DISTINCT findingIds (name#N ordinal)", async () => {
    const clauses = Array.from({ length: 16 }, (_, i) => `flags[${i}]`).join(" && ");
    const wrap = (fn: string): string =>
      [
        `export function ${fn}(flags: boolean[]): () => boolean {`,
        `  const busy = (): boolean => ${clauses};`,
        `  return busy;`,
        `}`,
        ``,
      ].join("\n");
    const ctx = fixtureProject({ "src/a.ts": wrap("wrap1") + wrap("wrap2") });
    const result = await axiom3Cleanliness.run(ctx);
    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((f) => f.enclosingSymbol)).toEqual(["busy", "busy#1"]);
    expect(result.findings[0]!.findingId).not.toBe(result.findings[1]!.findingId);
  });

  it("measures nested functions separately — a busy nested fn never inflates its parent", async () => {
    const clauses = Array.from({ length: 16 }, (_, i) => `flags[${i}]`).join(" && ");
    const ctx = fixtureProject({
      "src/a.ts": [
        "export function outer(flags: boolean[]): () => boolean {",
        `  const inner = (): boolean => ${clauses};`,
        "  return inner;",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom3Cleanliness.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.enclosingSymbol).toBe("inner"); // the arrow's variable name
  });
});

describe("axiom3Cleanliness analyzer plumbing", () => {
  it("emits nothing for an empty change set", async () => {
    const ctx = fixtureProject({ "src/a.ts": "export const a = 1;\n" });
    const result = await axiom3Cleanliness.run({ ...ctx, changedFiles: [] });
    expect(result).toEqual({ findings: [], degraded: [] });
  });

  it("is byte-deterministic across runs on identical input", async () => {
    const ctx = fixtureProject({
      "src/lib.ts": "export const used = 1;\nexport const orphan = 2;\n",
      "src/main.ts":
        'import { used } from "./lib.js";\nexport function f(): number {\n  return used;\n  const dead = 1;\n  void dead;\n}\n',
    });
    const first = await axiom3Cleanliness.run(ctx);
    const second = await axiom3Cleanliness.run(ctx);
    expect(first.findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("degrades (never throws) on a missing tsconfig", async () => {
    const ctx = fixtureProject({ "src/a.ts": "export const a = 1;\n" });
    const result = await axiom3Cleanliness.run({
      ...ctx,
      tsconfigPaths: [path.join(ctx.root, "nope", "tsconfig.json")],
    });
    expect(result.degraded.some((d) => d.reason.startsWith("tsconfig load failed"))).toBe(true);
  });

  it("a second run on the same context consumes the cached graph — no re-parse", async () => {
    const ctx = fixtureProject({
      "src/lib.ts": "export const used = 1;\nexport const orphan = 2;\n",
      "src/main.ts": 'import { used } from "./lib.js";\nexport const main = used;\n',
    });
    const first = await axiom3Cleanliness.run(ctx);
    expect(first.findings).toHaveLength(1);
    expect(ctx.graphCache.builds).toBe(1);
    const second = await axiom3Cleanliness.run(ctx);
    expect(ctx.graphCache.builds).toBe(1); // served from the cache, not rebuilt
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("a duplicated changedFiles entry never doubles a finding", async () => {
    const ctx = fixtureProject({
      "src/a.ts": "export function f(): number {\n  return 1;\n  const dead = 2;\n  void dead;\n}\n",
    });
    const result = await axiom3Cleanliness.run({
      ...ctx,
      changedFiles: ["src/a.ts", "src/a.ts"],
    });
    expect(result.findings).toHaveLength(1);
  });
});
