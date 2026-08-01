import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { findingSchema } from "@agentic-guardrails/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mergeFindings } from "../pipeline/merge.js";
import type { AnalyzerContext } from "../pipeline/pipeline.js";
import { axiom5Security, SECRET_SCAN_MAX_BYTES } from "./axiom5-security.js";

// ts-morph project builds (one per test) legitimately exceed the 5s default
// under full-suite parallel load.
vi.setConfig({ testTimeout: 60_000 });

// EVERY credential-shaped string below is an OBVIOUSLY FAKE tail on a
// documented vendor shape — never anything resembling a live secret, and
// never a vendor's PUBLISHED sample (those are allowlisted as non-secrets).
const FAKE_AWS_KEY = "AKIAFAKEFAKEFAKEFAKE";

const tempDirs: string[] = [];

/** 1.11 fixture-builder pattern. Deliberately NO tsconfig on disk: the
 * shared parse pass is parse-only and must not need one. `changedFiles`
 * carries the analyzable-TS subset (the pipeline's contract);
 * `allChangedFiles` the full list — the regex tier's input. */
function fixtureProject(files: Record<string, string>): AnalyzerContext & { root: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "guardrails-axiom5-"));
  tempDirs.push(root);
  for (const rel of Object.keys(files)) {
    mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
  }
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(path.join(root, rel), content);
  }
  const all = Object.keys(files).sort();
  return {
    root,
    repoRoot: root,
    changedFiles: all.filter((f) => /\.(ts|tsx|mts|cts)$/.test(f) && !/\.d\.(ts|mts|cts)$/.test(f)),
    allChangedFiles: all,
    tsconfigPaths: [],
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("security/hardcoded-secret (regex tier)", () => {
  it("catches a fake AWS key in a COMMENT as a schema-valid regex-source ERROR (raw text, not AST)", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [`// deploy key: ${FAKE_AWS_KEY}`, "export const ok = 1;", ""].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.degraded).toEqual([]);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(findingSchema.safeParse(finding).success).toBe(true);
    expect(finding).toMatchObject({
      axiom: "5",
      ruleId: "security/hardcoded-secret",
      tier: "deterministic",
      source: "regex",
      confidence: 1,
      severity: "error",
    });
    expect(finding.location).toEqual({ file: "src/a.ts", startLine: 1, endLine: 1 });
    expect(finding.enclosingSymbol).toBe("aws-access-key-id-0");
    // The secret value itself is NEVER echoed into the finding.
    expect(finding.message).not.toContain(FAKE_AWS_KEY);
  });

  it("HAZARD: each error-tier token format fires — GitHub, Slack, and PEM header", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        `const gh = "ghp_${"A1b2C3d4".repeat(5)}";`, // 40-char fake tail
        'const slack = "xoxb-0000000000-FAKEFAKEFAKE";',
        'const pem = "-----BEGIN RSA PRIVATE KEY-----";',
        "export const ok = [gh, slack, pem];",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    const errors = result.findings.filter((f) => f.severity === "error");
    expect(errors.map((f) => f.enclosingSymbol)).toEqual([
      "github-token-0",
      "slack-token-0",
      "private-key-pem-0",
    ]);
  });

  it("warns on a ≥16-char literal assigned to a secret-named identifier or property", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'const apiKey = "not-a-real-secret-0000";',
        'const options = { password: "also-not-a-real-value" };',
        "export const ok = [apiKey, options];",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(2);
    for (const finding of result.findings) {
      expect(finding).toMatchObject({
        ruleId: "security/hardcoded-secret",
        source: "regex",
        severity: "warning",
      });
    }
    expect(result.findings.map((f) => f.enclosingSymbol)).toEqual([
      "secret-assignment-0",
      "secret-assignment-1",
    ]);
  });

  it("exemptions: process.env reference, placeholder values, and short literals do NOT warn", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'const fromEnv = process.env["API_KEY"];',
        // A secret-named TEMPLATE value referencing process.env — the shape
        // matches, the process.env exemption applies.
        "const apiToken = `Bearer ${process.env.TOKEN}`;",
        'const apiKey = "changeme-changeme";',
        'const token = "<your-token-here>";',
        'const password = "example-placeholder";',
        'const secret = "short";',
        "export const ok = [fromEnv, apiToken, apiKey, token, password, secret];",
        "",
      ].join("\n"),
    });
    expect((await axiom5Security.run(ctx)).findings).toEqual([]);
  });

  it("TEST-THE-BYPASS: `.test.` path exempts the WARNING pattern only — a fake AWS key there still ERRORS", async () => {
    const ctx = fixtureProject({
      "src/x.test.ts": [
        'const password = "hunter2hunter2hunter2";', // warning shape — exempt by path
        `const key = "${FAKE_AWS_KEY}";`, // error tier — NEVER exempt
        "export const ok = [password, key];",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "error",
      enclosingSymbol: "aws-access-key-id-0",
    });
  });

  it("TEST-THE-BYPASS: the placeholder exemption does not over-exempt a real-shaped value", async () => {
    const ctx = fixtureProject({
      "src/a.ts": ['export const apiKey = "fake-fixture-value-123456";', ""].join("\n"),
    });
    expect((await axiom5Security.run(ctx)).findings).toHaveLength(1);
  });

  it("HAZARD: an UNPARSEABLE file still yields the regex finding (raw bytes bypass the AST) without a crash", async () => {
    const ctx = fixtureProject({
      "src/broken.ts": [
        "export function ((((", // parser-mangling garbage
        `// leaked: ${FAKE_AWS_KEY}`,
        "}}}}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    // ts-morph parses any text without throwing — no degradation, and the
    // regex tier still surfaces the secret.
    expect(result.degraded).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "security/hardcoded-secret",
      source: "regex",
      severity: "error",
    });
    expect(result.findings[0]!.location.startLine).toBe(2);
  });
});

describe("security/injection-sink", () => {
  it("flags a template-with-interpolation SQL argument to `.query` as a warning at the call line", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "interface Db { query(sql: string): Promise<unknown>; }",
        "export function findUser(db: Db, id: string): Promise<unknown> {",
        "  return db.query(`SELECT * FROM users WHERE id = ${id}`);",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding).toMatchObject({
      ruleId: "security/injection-sink",
      source: "ast",
      severity: "warning",
    });
    expect(finding.location.startLine).toBe(3);
    expect(finding.enclosingSymbol).toBe("findUser#query-0");
  });

  it("does NOT flag a parameterized query (static string argument)", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "interface Db { query(sql: string, params: readonly unknown[]): Promise<unknown>; }",
        "export function findUser(db: Db, id: string): Promise<unknown> {",
        '  return db.query("SELECT * FROM users WHERE id = $1", [id]);',
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom5Security.run(ctx)).findings).toEqual([]);
  });

  it("flags string CONCATENATION into `.execute`, but not a concat of non-strings", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "interface Db { execute(sql: string): Promise<unknown>; }",
        "export function run(db: Db, table: string, a: number, b: number): Promise<unknown> {",
        '  void db.execute("DELETE FROM " + table);',
        "  return db.execute(String(a + b));", // numeric + — not string building
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.location.startLine).toBe(3);
  });

  it("HAZARD: imported child_process `exec` with concatenation flags; static string and shadowed local do not", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import { exec, execSync } from "node:child_process";',
        "export function run(cmd: string): void {",
        '  exec("ls " + cmd);', // concatenated command — flags
        '  execSync("git status");', // fixed command — silent
        "}",
        "export function shadowed(cmd: string): void {",
        "  const exec = (c: string): string => c;",
        "  exec(`rm ${cmd}`);", // local shadow — symbol-resolved, silent
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "security/injection-sink",
      severity: "warning",
      enclosingSymbol: "run#exec-0",
    });
    expect(result.findings[0]!.message).toContain("exec");
  });
});

describe("security/dangerous-api", () => {
  it("flags a global eval call as an ERROR", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export function run(code: string): unknown {",
        "  return eval(code);",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "security/dangerous-api",
      source: "ast",
      severity: "error",
      enclosingSymbol: "run#eval-0",
    });
  });

  it("FALSE-POSITIVE GUARD: a locally declared `eval` never flags (binding check, not spelling)", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "const eval = (x: string): string => x;",
        "export function run(code: string): string {",
        "  return eval(code);",
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom5Security.run(ctx)).findings).toEqual([]);
  });

  it("flags `new Function` with a string body; `new Function(bodyVar)` stays out (stated ceiling)", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export function make(body: string): unknown {",
        '  const a = new Function("return 1");',
        "  const b = new Function(body);", // not provably a string — ceiling
        "  return [a, b];",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "error",
      enclosingSymbol: "make#new-Function-0",
    });
    expect(result.findings[0]!.location.startLine).toBe(2);
  });

  it("HAZARD: setTimeout/setInterval with a STRING first argument error; function arguments never flag", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export function schedule(): void {",
        '  setTimeout("doWork()", 100);',
        "  setInterval(`tick()`, 100);",
        "  setTimeout(() => undefined, 100);", // function — silent
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((f) => f.enclosingSymbol)).toEqual([
      "schedule#setTimeout-0",
      "schedule#setInterval-0",
    ]);
    for (const finding of result.findings) {
      expect(finding).toMatchObject({ ruleId: "security/dangerous-api", severity: "error" });
    }
  });

  it("HAZARD: vm module runIn*/compileFunction members flag via symbol-resolved bindings (namespace + named)", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import * as vm from "node:vm";',
        'import { compileFunction } from "vm";',
        "export function run(code: string): unknown {",
        "  vm.runInNewContext(code);",
        '  return compileFunction(code, ["x"]);',
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(2);
    for (const finding of result.findings) {
      expect(finding).toMatchObject({ ruleId: "security/dangerous-api", severity: "error" });
    }
  });

  it("HAZARD: two eval calls in one function get distinct findingIds via ordinals", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export function twice(a: string, b: string): unknown {",
        "  return [eval(a), eval(b)];",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]!.findingId).not.toBe(result.findings[1]!.findingId);
  });
});

describe("security/unsafe-deserialization", () => {
  it("node-serialize `unserialize` (incl. renamed import) is an ERROR; a local `unserialize` never flags", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import { unserialize as u } from "node-serialize";',
        "export function load(payload: string): unknown {",
        "  return u(payload);",
        "}",
        "export function local(payload: string): string {",
        "  const unserialize = (x: string): string => x;",
        "  return unserialize(payload);",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "security/unsafe-deserialization",
      severity: "error",
      enclosingSymbol: "load#unserialize-0",
    });
    expect(result.findings[0]!.message).toContain("node-serialize");
  });

  it("`v8.deserialize` is a WARNING (trusted-IPC idiom exists) — the severity split is the doctrine", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import v8 from "node:v8";',
        "export function load(buf: Buffer): unknown {",
        "  return v8.deserialize(buf);",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "security/unsafe-deserialization",
      severity: "warning",
      enclosingSymbol: "load#v8-deserialize-0",
    });
  });

  it("does NOT flag an `unserialize` imported from an unrelated module", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import { unserialize } from "./codec.js";',
        "export function load(payload: string): unknown {",
        "  return unserialize(payload);",
        "}",
        "",
      ].join("\n"),
    });
    expect((await axiom5Security.run(ctx)).findings).toEqual([]);
  });
});

describe("axiom5Security analyzer contract", () => {
  it("HAZARD (parsed as data): a module whose top-level code would write a sentinel file is analyzed, findings emitted, sentinel ABSENT", async () => {
    const cwdSentinel = path.resolve("EXECUTED.txt");
    const ctx = fixtureProject({
      "src/hazard.ts": [
        'import { writeFileSync } from "node:fs";',
        "// If the analyzer EXECUTED this module instead of parsing it, the",
        "// sentinel file would appear on disk.",
        'writeFileSync("EXECUTED.txt", "the analyzer executed target code");',
        "export function run(code: string): unknown {",
        "  return eval(code);",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1); // the eval — analysis happened
    expect(existsSync(path.join(ctx.root, "EXECUTED.txt"))).toBe(false);
    expect(existsSync(cwdSentinel)).toBe(false);
  });

  it("returns empty results for an empty change set", async () => {
    const ctx = fixtureProject({});
    expect(await axiom5Security.run({ ...ctx, changedFiles: [] })).toEqual({
      findings: [],
      degraded: [],
    });
  });

  it("declares an unreadable changed file ONCE (shared with the AST path), never doubled, never a throw", async () => {
    const ctx = fixtureProject({ "src/ok.ts": "export const ok = 1;\n" });
    const result = await axiom5Security.run({
      ...ctx,
      changedFiles: ["src/ok.ts", "src/missing.ts"],
      allChangedFiles: ["src/ok.ts", "src/missing.ts"],
    });
    expect(result.findings).toEqual([]);
    expect(result.degraded).toHaveLength(1);
    expect(result.degraded[0]!.subject).toBe("src/missing.ts");
    expect(result.degraded[0]!.reason).toContain("could not be read");
  });

  it("a duplicated changedFiles entry never doubles findings (regex tier included)", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [`// leaked: ${FAKE_AWS_KEY}`, "export const ok = 1;", ""].join("\n"),
    });
    const result = await axiom5Security.run({
      ...ctx,
      changedFiles: ["src/a.ts", "src/a.ts"],
      allChangedFiles: ["src/a.ts", "src/a.ts"],
    });
    expect(result.findings).toHaveLength(1);
  });

  it("findings are sorted file → line across regex and ast sources", async () => {
    const ctx = fixtureProject({
      "src/b.ts": [
        "export function run(code: string): unknown {",
        "  return eval(code);",
        "}",
        "",
      ].join("\n"),
      "src/a.ts": [`// leaked: ${FAKE_AWS_KEY}`, "export const ok = 1;", ""].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings.map((f) => [f.location.file, f.source])).toEqual([
      ["src/a.ts", "regex"],
      ["src/b.ts", "ast"],
    ]);
  });
});

describe("security/hardcoded-secret — all-changed-files scope (1.12 P1)", () => {
  it("catches an error-tier token in a changed .env file (regex tier sees NON-TS files)", async () => {
    const ctx = fixtureProject({
      ".env": `GITHUB_TOKEN=ghp_${"A1b2C3d4".repeat(5)}\n`,
    });
    expect(ctx.changedFiles).toEqual([]); // nothing analyzable — regex still runs
    const result = await axiom5Security.run(ctx);
    expect(result.degraded).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "security/hardcoded-secret",
      source: "regex",
      severity: "error",
      enclosingSymbol: "github-token-0",
    });
    expect(result.findings[0]!.location.file).toBe(".env");
  });

  it("catches a warning-tier secret assignment in a changed .json file", async () => {
    const ctx = fixtureProject({
      "config/settings.json": '{\n  "apiKey": "fake-fixture-value-123456"\n}\n',
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "warning",
      enclosingSymbol: "secret-assignment-0",
    });
    expect(result.findings[0]!.location).toMatchObject({
      file: "config/settings.json",
      startLine: 2,
    });
  });

  it("declares a typed skip for a file over the 1 MiB size cap — never a silent gap", async () => {
    const ctx = fixtureProject({
      "big.env": `AWS_KEY=${FAKE_AWS_KEY}\n${"x".repeat(SECRET_SCAN_MAX_BYTES)}\n`,
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toEqual([]); // the secret inside is NOT scanned…
    expect(result.degraded).toHaveLength(1); // …but the gap is declared
    expect(result.degraded[0]!.subject).toBe("big.env");
    expect(result.degraded[0]!.reason).toContain("size cap");
  });

  it("regex tier honors the budget signal between files: typed degradation, never a silent skip", async () => {
    const ctx = fixtureProject({ ".env": `AWS_KEY=${FAKE_AWS_KEY}\n` });
    const result = await axiom5Security.run({ ...ctx, signal: AbortSignal.abort() });
    expect(result.findings).toEqual([]);
    expect(result.degraded).toHaveLength(1);
    expect(result.degraded[0]!.reason).toContain("aborted the secret scan");
    expect(result.degraded[0]!.subject).toBe(".env");
  });
});

describe("security/hardcoded-secret — token-format catalogue (1.12 P4)", () => {
  it("HAZARD: each pinned format fires under its own pattern name (ASIA, github_pat_, xoxe, sk-, sk-proj-, sk-ant-)", async () => {
    const ctx = fixtureProject({
      "notes.md": [
        "// ASIAFAKEFAKEFAKEFAKE", // AWS temporary (STS) key id
        "// github_pat_FAKE0FAKE0FAKE0FAKE0FAKE0",
        "// xoxe-1-FAKEFAKEFAKEFAKE",
        "// sk-FAKEFAKEFAKEFAKEFAKE12",
        "// sk-proj-FAKEFAKEFAKEFAKEFAKE12",
        "// sk-ant-FAKEFAKEFAKEFAKEFAKE12",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    // ONE finding per line — the sk-ant- key fires ONLY the Anthropic
    // pattern (the OpenAI pattern excludes it), never a double.
    expect(result.findings.map((f) => f.enclosingSymbol)).toEqual([
      "aws-access-key-id-0",
      "github-fine-grained-pat-0",
      "slack-token-0",
      "openai-api-key-0",
      "openai-api-key-1",
      "anthropic-api-key-0",
    ]);
    for (const finding of result.findings) expect(finding.severity).toBe("error");
  });

  it("FALSE-POSITIVE GUARD: prose 'sk-' spellings and short tails never fire", async () => {
    const ctx = fixtureProject({
      "notes.md": [
        "See the sk- prefix docs and the risk-assessment-matrix-v2 notes.",
        "The sk-learn import is unrelated.", // <20-char tail
        "",
      ].join("\n"),
    });
    expect((await axiom5Security.run(ctx)).findings).toEqual([]);
  });
});

describe("security/hardcoded-secret — published-sample allowlist (1.12 P9)", () => {
  it("a vendor-PUBLISHED sample credential (AWS's AKIAIOSFODNN7EXAMPLE) never errors", async () => {
    const ctx = fixtureProject({
      "notes.md": "// AWS docs example: AKIAIOSFODNN7EXAMPLE\n",
    });
    expect((await axiom5Security.run(ctx)).findings).toEqual([]);
  });

  it("TEST-THE-BYPASS: a same-shape NON-sample key still fires", async () => {
    const ctx = fixtureProject({ "notes.md": `// deploy: ${FAKE_AWS_KEY}\n` });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "error",
      enclosingSymbol: "aws-access-key-id-0",
    });
  });
});

describe("security/hardcoded-secret — assignment-pattern precision (1.12 P5/P6/P10)", () => {
  it("placeholder exemption anchors to value START: leading 'example' exempts, interior does not", async () => {
    const exempt = fixtureProject({
      "src/a.ts": 'export const apiKey = "exampleXk9f2Xk9f2Xk9f2";\n',
    });
    expect((await axiom5Security.run(exempt)).findings).toEqual([]);
    const interiorTodo = fixtureProject({
      // "todo" appears INTERIOR ("mastodont") — not a placeholder.
      "src/a.ts": 'export const apiKey = "mastodont-prod-key-91";\n',
    });
    expect((await axiom5Security.run(interiorTodo)).findings).toHaveLength(1);
    const interiorExample = fixtureProject({
      "src/a.ts": 'export const apiKey = "my-example-key-12345";\n',
    });
    expect((await axiom5Security.run(interiorExample)).findings).toHaveLength(1);
  });

  it("FALSE-POSITIVE GUARD: secret keywords inside longer identifiers never match", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'export const tokenizerConfig = "not-a-secret-config-value";',
        'export const secretaryName = "alexandra-hamilton-iii";',
        'export const passwordHintText = "long-enough-hint-value-123";',
        'export const maxTokensLabel = "maximum-tokens-allowed-99";',
        "",
      ].join("\n"),
    });
    expect((await axiom5Security.run(ctx)).findings).toEqual([]);
  });

  it("hardcoded-credential COMPARISONS warn: === and !== against a long quoted literal", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'export const check = (password: string): boolean => password === "hunter2hunter2hunter2";',
        'export const deny = (token: string): boolean => token !== "hunter2hunter2hunter2";',
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(2);
    for (const finding of result.findings) {
      expect(finding).toMatchObject({ ruleId: "security/hardcoded-secret", severity: "warning" });
    }
  });

  it("keeps all-caps identifier segments whole", async () => {
    const ctx = fixtureProject({
      "src/a.ts": 'export const DB_PASSWORD = "hardcoded-database-value";\n',
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "security/hardcoded-secret",
      severity: "warning",
    });
  });

  it("a prettier-WRAPPED assignment still matches (whole-text scan), anchored at the identifier line", async () => {
    const ctx = fixtureProject({
      "src/a.ts": 'export const apiKey =\n  "fake-fixture-value-123456";\n',
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.location.startLine).toBe(1);
  });

  it("an apostrophe INSIDE a double-quoted value does not sever the ≥16-char floor", async () => {
    const ctx = fixtureProject({
      "src/a.ts": `export const apiKey = "it's-a-long-secret-123";\n`,
    });
    expect((await axiom5Security.run(ctx)).findings).toHaveLength(1);
  });

  it("import.meta.env joins process.env in the env-reference exemption", async () => {
    const ctx = fixtureProject({
      "src/a.ts": "export const apiToken = `Bearer ${import.meta.env.VITE_TOKEN}`;\n",
    });
    expect((await axiom5Security.run(ctx)).findings).toEqual([]);
  });

  it("test-path exemption is basename/segment-anchored: interior '.test.' in a production path still warns", async () => {
    const warningShape = 'export const apiKey = "fake-fixture-value-123456";\n';
    const interior = fixtureProject({ "src/x.test.helpers/prod.ts": warningShape });
    expect((await axiom5Security.run(interior)).findings).toHaveLength(1);
    const spec = fixtureProject({ "src/a.spec.ts": warningShape });
    expect((await axiom5Security.run(spec)).findings).toEqual([]);
    const tests = fixtureProject({ "src/__tests__/a.ts": warningShape });
    expect((await axiom5Security.run(tests)).findings).toEqual([]);
  });

  it("tolerates lone-\\r line termination when mapping match lines", async () => {
    const ctx = fixtureProject({
      "notes.md": `first line\r// leaked: ${FAKE_AWS_KEY}\r`,
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.location.startLine).toBe(2);
  });

  it("PIN: a token that is ALSO a secret-named assignment yields error + warning; the FR-21 merge keeps the error and both messages", async () => {
    const ctx = fixtureProject({
      "src/a.ts": `export const apiKey = "${FAKE_AWS_KEY}";\n`,
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(2);
    expect(new Set(result.findings.map((f) => f.severity))).toEqual(new Set(["error", "warning"]));
    expect(result.findings[0]!.findingId).not.toBe(result.findings[1]!.findingId);
    // Same ruleId + same line: the 1.7 merge collapses them into ONE finding
    // that keeps the STRONGEST severity and BOTH messages — the error can
    // never be swallowed by the heuristic warning.
    const merged = mergeFindings(result.findings);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.severity).toBe("error");
    expect(merged[0]!.message).toContain("AWS access key id");
    expect(merged[0]!.message).toContain("possible hardcoded secret");
  });
});

describe("security/dangerous-api — eval-family bypasses (1.12 P2/P3/P10)", () => {
  it('checks only the BODY (last argument): `new Function("x", bodyVar)` never flags; a literal body does', async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export function make(body: string): unknown {",
        '  const a = new Function("x", body);', // "x" is a PARAMETER NAME — silent
        '  const b = new Function("x", "return 1");', // literal body — flags
        "  return [a, b];",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.location.startLine).toBe(3);
    expect(result.findings[0]!.enclosingSymbol).toBe("make#new-Function-1");
  });

  it('bare `Function("code")` call flags (spec-identical to `new`); `Function(bodyVar)` stays out', async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export function make(body: string): unknown {",
        '  const a = Function("return 1");',
        "  const b = Function(body);", // not provably a string — ceiling
        "  return [a, b];",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      severity: "error",
      enclosingSymbol: "make#Function-0",
    });
  });

  it("HAZARD: indirect eval — `(0, eval)(code)` and `(eval)(code)` — still flags", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export function run(code: string): unknown {",
        "  return [(0, eval)(code), (eval)(code)];",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(2);
    for (const finding of result.findings) {
      expect(finding).toMatchObject({ ruleId: "security/dangerous-api", severity: "error" });
    }
  });

  it('`new globalThis.Function("...")` flags (global-object form)', async () => {
    const ctx = fixtureProject({
      "src/a.ts": 'export const f = new globalThis.Function("return 2");\n',
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "security/dangerous-api",
      severity: "error",
    });
  });

  it("`new vm.Script(code)` flags via namespace AND named-import bindings", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        'import * as vm from "node:vm";',
        'import { Script } from "vm";',
        "export function make(code: string): unknown {",
        "  const a = new vm.Script(code);",
        "  const b = new Script(code);",
        "  return [a, b];",
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings.map((f) => f.enclosingSymbol)).toEqual([
      "make#vm-Script-0",
      "make#vm-Script-1",
    ]);
    for (const finding of result.findings) {
      expect(finding).toMatchObject({ ruleId: "security/dangerous-api", severity: "error" });
    }
  });

  it("setTimeout with a CONCATENATED string first argument flags (same disjunction as the Function body)", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "export function schedule(action: string): void {",
        '  setTimeout("do" + action, 100);',
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.enclosingSymbol).toBe("schedule#setTimeout-0");
  });
});

describe("security/injection-sink — static constant folding (1.12 P7)", () => {
  it("literal + literal concatenation is STATIC and never flags; literal + variable flags", async () => {
    const ctx = fixtureProject({
      "src/a.ts": [
        "interface Db { query(sql: string): Promise<unknown>; }",
        "export function run(db: Db, table: string): Promise<unknown> {",
        '  void db.query("SELECT * " + "FROM users");', // constant-folds — silent
        '  return db.query("SELECT * FROM " + table);', // dynamic — flags
        "}",
        "",
      ].join("\n"),
    });
    const result = await axiom5Security.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.location.startLine).toBe(4);
    expect(result.findings[0]!.enclosingSymbol).toBe("run#query-1");
  });
});
