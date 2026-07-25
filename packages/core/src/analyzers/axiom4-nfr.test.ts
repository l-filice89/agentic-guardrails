import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { findingSchema } from "@agentic-guardrails/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalyzerContext } from "../pipeline/pipeline.js";
import { axiom4Nfr } from "./axiom4-nfr.js";

// ts-morph project builds (one per test) legitimately exceed the 5s default
// under full-suite parallel load.
vi.setConfig({ testTimeout: 60_000 });

const tempDirs: string[] = [];

/** 1.10 fixture-builder pattern, minus the graph-cache wiring axiom3 needed
 * — this analyzer consumes no graph. Deliberately NO tsconfig on disk: the
 * shared parse pass is parse-only and must not need one. */
function fixtureProject(files: Record<string, string>): AnalyzerContext & { root: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "guardrails-axiom4-"));
  tempDirs.push(root);
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
    tsconfigPaths: [],
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("nfr/unbounded-promise-all", () => {
  it("flags Promise.all over a .map result as a schema-valid warning anchored at the call line", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export async function fanOut(xs: string[]): Promise<number[]> {",
        "  return Promise.all(xs.map(async (x) => x.length));",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom4Nfr.run(ctx);
    expect(result.degraded).toEqual([]);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(findingSchema.safeParse(finding).success).toBe(true);
    expect(finding).toMatchObject({
      axiom: "4",
      ruleId: "nfr/unbounded-promise-all",
      tier: "deterministic",
      source: "ast",
      confidence: 1,
      severity: "warning",
    });
    expect(finding.location).toEqual({ file: "src/a.ts", startLine: 2, endLine: 2 });
    // Exact line-free discriminator: symbol + method + ordinal, no line number.
    expect(finding.enclosingSymbol).toBe("fanOut#promise-all-0");
  });

  it("does NOT flag Promise.all over an array literal of fixed arity", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "async function a(): Promise<number> { return 1; }",
        "async function b(): Promise<number> { return 2; }",
        "export async function pair(): Promise<number[]> {",
        "  return Promise.all([a(), b()]);",
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toEqual([]);
  });

  it("flags a bare identifier argument and a spread of a non-literal", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export async function run(ps: Promise<number>[]): Promise<void> {",
        "  await Promise.all(ps);",
        "  await Promise.all([...ps]);",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom4Nfr.run(ctx);
    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((f) => f.location.startLine)).toEqual([2, 3]);
  });

  it("HAZARD (nested spread): a spread of a fixed-arity literal is exempt RECURSIVELY; a nested non-literal spread flags", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "async function a(): Promise<number> { return 1; }",
        "async function b(): Promise<number> { return 2; }",
        "export async function run(ps: Promise<number>[]): Promise<void> {",
        "  await Promise.all([...[a(), b()]]);", // fixed all the way down
        "  await Promise.all([...[...[a(), b()]]]);", // still fixed
        "  await Promise.all([...[...ps]]);", // dynamic at the inner spread
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom4Nfr.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.location.startLine).toBe(6);
  });

  it("HAZARD: Promise.allSettled, .any, and .race are covered like Promise.all", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export async function settle(ps: Promise<number>[]): Promise<void> {",
        "  await Promise.allSettled(ps);",
        "  await Promise.any(ps);",
        "  await Promise.race(ps);",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom4Nfr.run(ctx);
    expect(result.findings).toHaveLength(3);
    expect(result.findings.map((f) => f.message)).toEqual([
      expect.stringContaining("Promise.allSettled"),
      expect.stringContaining("Promise.any"),
      expect.stringContaining("Promise.race"),
    ]);
    // The method name joins the counter key: each combinator counts separately.
    expect(result.findings.map((f) => f.enclosingSymbol)).toEqual([
      "settle#promise-allSettled-0",
      "settle#promise-any-0",
      "settle#promise-race-0",
    ]);
  });

  it("HAZARD: globalThis.Promise.all and bracket access Promise[\"all\"] are covered", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export async function run(ps: Promise<number>[]): Promise<void> {",
        "  await globalThis.Promise.all(ps);",
        '  await Promise["all"](ps);',
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom4Nfr.run(ctx);
    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((f) => f.location.startLine)).toEqual([2, 3]);
  });

  it("HAZARD: two identical hazards in one file get distinct findingIds via ordinals", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export async function twice(xs: (() => Promise<number>)[]): Promise<void> {",
        "  await Promise.all(xs.map((f) => f()));",
        "  await Promise.all(xs.map((f) => f()));",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom4Nfr.run(ctx);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]!.findingId).not.toBe(result.findings[1]!.findingId);
    expect(result.findings[0]!.enclosingSymbol).not.toBe(result.findings[1]!.enclosingSymbol);
  });

  it("does not treat someOther.all(...) as a Promise fan-out", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "const q = { all: (xs: number[]) => xs };",
        "export function run(xs: number[]): number[] {",
        "  return q.all(xs);",
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toEqual([]);
  });

  it("FALSE-POSITIVE GUARD: a local `Promise` wrapper object does NOT flag (binding check, not spelling)", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "const Promise = { all: (xs: number[]) => xs };",
        "export function run(xs: number[]): number[] {",
        "  return Promise.all(xs);",
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toEqual([]);
  });
});

describe("nfr/sync-io-in-async", () => {
  it("flags a named fs import's *Sync call lexically inside an async arrow", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import { readFileSync } from "node:fs";',
        "export const load = async (p: string): Promise<string> => readFileSync(p, \"utf8\");",
        "",
      ].join("\n"),
    });
    const result = await axiom4Nfr.run(ctx);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding).toMatchObject({
      axiom: "4",
      ruleId: "nfr/sync-io-in-async",
      severity: "warning",
    });
    expect(finding.message).toContain("readFileSync");
    expect(finding.enclosingSymbol).toContain("readFileSync"); // fs member in the discriminator
  });

  it("does NOT flag sync fs at module top level (config-load idiom)", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import { readFileSync } from "node:fs";',
        'export const config = readFileSync("config.json", "utf8");',
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toEqual([]);
  });

  it("does NOT flag sync fs inside a plain sync function", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import { readFileSync } from "node:fs";',
        "export function load(p: string): string {",
        '  return readFileSync(p, "utf8");',
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toEqual([]);
  });

  it("HAZARD: a renamed import (`import { readFileSync as r }`) is still caught", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import { readFileSync as r } from "node:fs";',
        "export async function load(p: string): Promise<string> {",
        '  return r(p, "utf8");',
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom4Nfr.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.message).toContain("readFileSync"); // real member, not the alias
  });

  it("HAZARD: namespace member access (`fs.readFileSync`) is caught — bracket access too", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import * as fs from "node:fs";',
        "export async function load(p: string): Promise<string> {",
        '  return fs.readFileSync(p, "utf8") + fs["readFileSync"](p, "utf8");',
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toHaveLength(2);
  });

  it("HAZARD: default import member access (`fs.existsSync`) is caught, bare `fs` module too", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import fs from "fs";',
        "export async function check(p: string): Promise<boolean> {",
        "  return fs.existsSync(p);",
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toHaveLength(1);
  });

  it("HAZARD (P5): child_process/zlib/crypto *Sync calls block identically — all tracked, incl. `{ default as x }`", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import { execSync } from "node:child_process";',
        'import * as zlib from "zlib";',
        'import { default as crypto } from "node:crypto";',
        "export async function run(cmd: string, data: Uint8Array, pw: string): Promise<void> {",
        "  execSync(cmd);",
        "  zlib.gzipSync(data);",
        '  crypto.pbkdf2Sync(pw, "salt", 1000, 64, "sha512");',
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom4Nfr.run(ctx);
    expect(result.findings).toHaveLength(3);
    expect(result.findings.map((f) => f.message)).toEqual([
      expect.stringContaining("execSync"),
      expect.stringContaining("gzipSync"),
      expect.stringContaining("pbkdf2Sync"),
    ]);
  });

  it("HAZARD (bypass negative): a NON-tracked somethingSync() call is NOT caught", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "function somethingSync(): number { return 1; }",
        "const other = { doSync: () => 2 };",
        "export async function run(): Promise<number> {",
        "  return somethingSync() + other.doSync();",
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toEqual([]);
  });

  it("CEILING: destructuring from a namespace import (`const { readFileSync } = fs`) is NOT tracked", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import * as fs from "node:fs";',
        "const { readFileSync } = fs;",
        "export async function load(p: string): Promise<string> {",
        '  return readFileSync(p, "utf8");',
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toEqual([]);
  });

  it("FALSE-POSITIVE GUARD: an inner-scope local shadowing a renamed fs import does NOT flag", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import { readFileSync as r } from "node:fs";',
        'export const top = r("seed.json", "utf8");', // top-level use keeps the import live (and stays exempt)
        "export async function load(p: string): Promise<string> {",
        "  const r = (x: string): string => x;",
        "  return r(p);",
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toEqual([]);
  });

  it("FALSE-POSITIVE GUARD: a type-only fs import plus a same-named local value does NOT flag", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import type { readFileSync } from "node:fs";',
        "const readData: typeof readFileSync = (() => \"\") as typeof readFileSync;",
        "function readFileSyncLocal(p: string): string { return p; }",
        "export async function load(p: string): Promise<string> {",
        "  void readData;",
        "  return readFileSyncLocal(p);",
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toEqual([]);
  });

  it("class field initializers and static blocks stop the async-enclosure walk (they run at construction)", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import { readFileSync } from "node:fs";',
        "export async function make(p: string): Promise<unknown> {",
        "  class Holder {",
        '    data = readFileSync(p, "utf8");',
        "    static cfg: string;",
        "    static {",
        '      Holder.cfg = readFileSync("static.json", "utf8");',
        "    }",
        "  }",
        "  return new Holder();",
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toEqual([]);
  });

  it("HAZARD: async-in-sync — an async arrow nested in a sync function still flags its call", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import { readFileSync } from "node:fs";',
        "export function outer(p: string): () => Promise<string> {",
        '  return async () => readFileSync(p, "utf8");',
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toHaveLength(1);
  });

  it("HAZARD: sync-in-async — a sync arrow nested in an async function is NOT flagged (nearest enclosure decides)", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import { readFileSync } from "node:fs";',
        "export async function outer(p: string): Promise<() => string> {",
        '  return () => readFileSync(p, "utf8");',
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toEqual([]);
  });
});

describe("nfr/missing-abort-signal", () => {
  it("flags fetch with a literal options bag lacking signal, and fetch with no options at all", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export async function go(url: string): Promise<void> {",
        "  await fetch(url);",
        '  await fetch(url, { method: "POST" });',
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom4Nfr.run(ctx);
    expect(result.findings).toHaveLength(2);
    for (const finding of result.findings) {
      expect(finding).toMatchObject({
        ruleId: "nfr/missing-abort-signal",
        severity: "warning",
      });
    }
    expect(result.findings.map((f) => f.location.startLine)).toEqual([2, 3]);
    expect(result.findings[0]!.findingId).not.toBe(result.findings[1]!.findingId);
  });

  it("HAZARD (P3): `fetch(url, undefined)`, `fetch(url, null)`, and a literal `signal: undefined` all provably lack a signal", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export async function go(url: string): Promise<void> {",
        "  await fetch(url, undefined);",
        "  await fetch(url, null);", // fixture string — never type-checked, only parsed
        "  await fetch(url, { signal: undefined });",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom4Nfr.run(ctx);
    expect(result.findings).toHaveLength(3);
    expect(result.findings.map((f) => f.location.startLine)).toEqual([2, 3, 4]);
  });

  it("does NOT flag fetch with an explicit signal property (incl. shorthand and a computed literal name)", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export async function go(url: string, signal: AbortSignal): Promise<void> {",
        "  await fetch(url, { signal });",
        "  await fetch(url, { signal: AbortSignal.timeout(1000) });",
        '  await fetch(url, { ["signal"]: signal });',
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toEqual([]);
  });

  it("does NOT flag fetch with identifier options (ceiling: cannot see inside)", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export async function go(url: string, opts: RequestInit): Promise<void> {",
        "  await fetch(url, opts);",
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toEqual([]);
  });

  it("HAZARD: a spread-carrying literal without an explicit signal is NOT flagged", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export async function go(url: string, opts: RequestInit): Promise<void> {",
        '  await fetch(url, { ...opts, method: "POST" });',
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toEqual([]);
  });

  it("HAZARD: `globalThis.fetch(...)` without a signal is covered", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export async function go(url: string): Promise<void> {",
        "  await globalThis.fetch(url);",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom4Nfr.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.ruleId).toBe("nfr/missing-abort-signal");
  });

  it("FALSE-POSITIVE GUARD: a DI-injected `fetch` parameter does NOT flag", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export async function go(fetch: typeof globalThis.fetch, url: string): Promise<void> {",
        "  await fetch(url);",
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toEqual([]);
  });

  it("FALSE-POSITIVE GUARD: a local `fetch` wrapper const does NOT flag", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "const fetch = (url: string): Promise<string> => globalThis.Promise.resolve(url);",
        "export async function go(url: string): Promise<void> {",
        "  await fetch(url);",
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toEqual([]);
  });

  it("FALSE-POSITIVE GUARD: a `fetch` imported from a wrapper module does NOT flag", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import { fetch } from "./wrapper.js";',
        "export async function go(url: string): Promise<void> {",
        "  await fetch(url);",
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toEqual([]);
  });
});

describe("axiom4Nfr analyzer contract", () => {
  it("returns empty results for an empty change set", async () => {
    const ctx = fixtureProject({});
    expect(await axiom4Nfr.run({ ...ctx, changedFiles: [] })).toEqual({
      findings: [],
      degraded: [],
    });
  });

  it("works with NO tsconfig present anywhere (the parse-only pass needs none)", async () => {
    // fixtureProject writes no tsconfig — this pins that the analyzer's
    // whole rule set works from bare source files.
    const ctx = fixtureProject({
      "src/a.ts": [
        "export async function go(url: string): Promise<void> {",
        "  await fetch(url);",
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom4Nfr.run(ctx)).findings).toHaveLength(1);
  });

  it("declares an unreadable changed file as a typed degradation, never a throw", async () => {
    // ts-morph parses any text without throwing — only the READ can fail,
    // so the degradation names a missing file, not a syntax error.
    const ctx = fixtureProject({
      "src/ok.ts": "export const ok = 1;\n",
    });
    const result = await axiom4Nfr.run({
      ...ctx,
      changedFiles: ["src/ok.ts", "src/missing.ts"],
    });
    expect(result.findings).toEqual([]);
    expect(result.degraded).toHaveLength(1);
    expect(result.degraded[0]!.subject).toBe("src/missing.ts");
    expect(result.degraded[0]!.reason).toContain("could not be read");
  });

  it("a duplicated changedFiles entry never doubles findings", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export async function go(url: string): Promise<void> {",
        "  await fetch(url);",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom4Nfr.run({ ...ctx, changedFiles: ["src/a.ts", "src/a.ts"] });
    expect(result.findings).toHaveLength(1);
  });

  it("findings are sorted file → line → ruleId across files", async () => {
    const ctx = fixtureProject({
      "src/b.ts": [
        "export async function go(url: string): Promise<void> {",
        "  await fetch(url);",
        "}",
        "",
      ].join("\n"),
      "src/a.ts": [
        "export async function run(ps: Promise<number>[]): Promise<void> {",
        "  await Promise.all(ps);",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom4Nfr.run(ctx);
    expect(result.findings.map((f) => f.location.file)).toEqual(["src/a.ts", "src/b.ts"]);
  });
});
