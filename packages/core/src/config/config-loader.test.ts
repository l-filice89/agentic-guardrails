import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  computeFindingId,
  configJsonSchema,
  configSchema,
  type Config,
  type Finding,
} from "@agentic-guardrails/contracts";
import { parse as parseYaml } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import { ABSENT_SHA256 } from "../pipeline/manifest.js";
import {
  CONFIG_ABSENT_HASH,
  CONFIG_YAML_HEADER,
  DEFAULT_CONFIG_YAML,
  evaluateGate,
  loadConfig,
} from "./config-loader.js";

const tempDirs: string[] = [];

function tempRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-config-"));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(repo: string, yamlText: string): void {
  mkdirSync(path.join(repo, "_agentic-guardrails"), { recursive: true });
  writeFileSync(path.join(repo, "_agentic-guardrails", "config.yaml"), yamlText);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("applies defaults when config.yaml is absent (axiom 5 blocking, 'absent' sentinel, no deviations)", () => {
    const repo = tempRepo();
    const result = loadConfig(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.configPresent).toBe(false);
    expect(result.config.axioms["5"]?.enforcement).toBe("blocking");
    expect(result.deviations).toEqual([]);
    expect(result.configHash).toBe(CONFIG_ABSENT_HASH); // literal sentinel, not sha256("")
    expect(result.warnings).toEqual([]);
  });

  it("writes NO config.schema.json when config.yaml is absent (no unsolicited files)", () => {
    const repo = tempRepo();
    expect(loadConfig(repo).ok).toBe(true);
    expect(existsSync(path.join(repo, "_agentic-guardrails", "config.schema.json"))).toBe(false);
  });

  it("HAZARD: a non-ENOENT read failure is a typed error naming the file and code, never defaults", () => {
    const repo = tempRepo();
    // config.yaml as a DIRECTORY — cross-platform non-ENOENT read failure (EISDIR).
    mkdirSync(path.join(repo, "_agentic-guardrails", "config.yaml"), { recursive: true });
    const result = loadConfig(repo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("config.yaml: read error (EISDIR)");
    expect(result.message).not.toContain("\n    at ");
  });

  it("writes config.schema.json (missing) and refreshes it when stale — config present", () => {
    const repo = tempRepo();
    writeConfig(repo, "axioms: {}\n");
    expect(loadConfig(repo).ok).toBe(true);
    const schemaPath = path.join(repo, "_agentic-guardrails", "config.schema.json");
    expect(existsSync(schemaPath)).toBe(true);
    expect(JSON.parse(readFileSync(schemaPath, "utf8"))).toEqual(configJsonSchema);

    writeFileSync(schemaPath, "{ stale }\n");
    expect(loadConfig(repo).ok).toBe(true);
    expect(JSON.parse(readFileSync(schemaPath, "utf8"))).toEqual(configJsonSchema);
  });

  it("emits a warning (NOT a degradation, NOT an abort) when the schema file cannot be written", () => {
    const repo = tempRepo();
    writeConfig(repo, "axioms: {}\n");
    // A DIRECTORY at the schema path makes the atomic rename fail.
    mkdirSync(path.join(repo, "_agentic-guardrails", "config.schema.json"), { recursive: true });
    const result = loadConfig(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("config.schema.json write failed");
  });

  it("reports deviations from EFFECTIVE defaults (enforcement blocking, maxFindings 0)", () => {
    const repo = tempRepo();
    writeConfig(
      repo,
      "axioms:\n  '1':\n    enforcement: advisory\n  '2':\n    enforcement: blocking\n    maxFindings: 3\n",
    );
    const result = loadConfig(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.configPresent).toBe(true);
    // enforcement: blocking restates the effective default → not a deviation.
    expect(result.deviations).toEqual([
      'axioms.1.enforcement = "advisory" (default: "blocking")',
      'axioms.2.maxFindings = 3 (default: 0)',
    ]);
  });

  it("does not report a restated effective default as a deviation (incl. explicit maxFindings: 0)", () => {
    const repo = tempRepo();
    writeConfig(repo, "axioms:\n  '5':\n    enforcement: blocking\n  '1':\n    enforcement: blocking\n    maxFindings: 0\n");
    const result = loadConfig(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deviations).toEqual([]);
  });

  it("sorts deviations numeric-aware (axioms.2 before axioms.10)", () => {
    const repo = tempRepo();
    writeConfig(
      repo,
      "axioms:\n  '10':\n    enforcement: advisory\n  '2':\n    enforcement: advisory\n",
    );
    const result = loadConfig(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deviations).toEqual([
      'axioms.2.enforcement = "advisory" (default: "blocking")',
      'axioms.10.enforcement = "advisory" (default: "blocking")',
    ]);
  });

  it("reports a declared boundaries key as ONE deviation line (default: none declared)", () => {
    const repo = tempRepo();
    writeConfig(
      repo,
      "axioms: {}\nboundaries:\n  layers:\n    - name: app\n      paths: [src/app]\n    - name: lib\n      paths: [src/lib]\n  allowed:\n    app: [lib]\n",
    );
    const result = loadConfig(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Zero-silent-config: enabling the two boundaries-dependent structural
    // rules must be visible at run start.
    expect(result.deviations).toEqual(["boundaries: 2 layers declared (default: none)"]);
  });

  it("reports axiom 5 overridden away from its blocking default", () => {
    const repo = tempRepo();
    writeConfig(repo, "axioms:\n  '5':\n    enforcement: advisory\n");
    const result = loadConfig(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deviations).toEqual([
      'axioms.5.enforcement = "advisory" (default: "blocking")',
    ]);
  });

  it("rejects an invalid enum value with the offending path, no stack trace", () => {
    const repo = tempRepo();
    writeConfig(repo, "axioms:\n  '1':\n    enforcement: warn\n");
    const result = loadConfig(repo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("axioms.1.enforcement");
    expect(result.message).not.toContain("\n    at ");
  });

  it("rejects maxFindings on a non-blocking axiom, naming the path", () => {
    const repo = tempRepo();
    writeConfig(repo, "axioms:\n  '1':\n    enforcement: advisory\n    maxFindings: 2\n");
    const result = loadConfig(repo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("axioms.1.maxFindings");
  });

  it("rejects a typo top-level key via the strict schema, naming the key", () => {
    const repo = tempRepo();
    writeConfig(repo, "axiom:\n  '1':\n    enforcement: 'off'\n");
    const result = loadConfig(repo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("axiom");
  });

  it("reports malformed YAML as a typed parse error with line/column", () => {
    const repo = tempRepo();
    writeConfig(repo, "axioms:\n\t'1':\n"); // tab indentation is invalid YAML
    const result = loadConfig(repo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/line \d+, column \d+/);
    expect(result.message).not.toContain("\n    at ");
  });

  it("treats an empty config.yaml as pure defaults, hashing its real (empty) bytes", () => {
    const repo = tempRepo();
    writeConfig(repo, "");
    const result = loadConfig(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.configPresent).toBe(true);
    expect(result.config.axioms["5"]?.enforcement).toBe("blocking");
    expect(result.deviations).toEqual([]);
    // Empty-but-PRESENT hashes its bytes (sha256("")), distinguishable from "absent".
    expect(result.configHash).toBe(ABSENT_SHA256);
    expect(result.configHash).not.toBe(CONFIG_ABSENT_HASH);
  });

  it("treats `axioms:` with a null value (all entries commented out) as {}", () => {
    const repo = tempRepo();
    writeConfig(repo, "axioms:\n# '1':\n#   enforcement: advisory\n");
    const result = loadConfig(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.axioms["5"]?.enforcement).toBe("blocking");
    expect(result.deviations).toEqual([]);
  });

  it("hashes the config content (content change changes the hash)", () => {
    const repo = tempRepo();
    const text = "axioms:\n  '1':\n    enforcement: advisory\n";
    writeConfig(repo, text);
    const first = loadConfig(repo);
    expect(first.ok && first.configHash).toBe(
      createHash("sha256").update(text).digest("hex"),
    );
    writeConfig(repo, "axioms:\n  '1':\n    enforcement: blocking\n");
    const second = loadConfig(repo);
    expect(first.ok && second.ok && second.configHash !== first.configHash).toBe(true);
  });

  it("ships the yaml-language-server header in tool-written config, and it parses green (FR-31)", () => {
    expect(DEFAULT_CONFIG_YAML).toContain(
      "# yaml-language-server: $schema=./config.schema.json",
    );
    expect(DEFAULT_CONFIG_YAML.startsWith(`${CONFIG_YAML_HEADER}\n`)).toBe(true);
    expect(configSchema.safeParse(parseYaml(DEFAULT_CONFIG_YAML)).success).toBe(true);
  });
});

function errorFinding(axiom: string, file: string): Finding {
  return {
    findingId: computeFindingId({ axiom, ruleId: "fake/rule", file, enclosingSymbol: "x" }),
    axiom,
    ruleId: "fake/rule",
    location: { file, startLine: 1, endLine: 1 },
    message: "fake",
    tier: "deterministic",
    source: "ast",
    confidence: 1,
    severity: "error",
  };
}

function config(axioms: Config["axioms"]): Config {
  return { axioms: { "5": { enforcement: "blocking" }, ...axioms } };
}

/** perAxiom entry for the ever-present configured axiom 5 with no findings. */
const AXIOM5_CLEAN = {
  axiom: "5",
  enforcement: "blocking",
  errorFindings: 0,
  maxFindings: 0,
  pass: true,
} as const;

describe("evaluateGate", () => {
  it("fails on an unconfigured axiom's error findings (blocking is the default posture)", () => {
    const gate = evaluateGate([errorFinding("1", "a.ts")], config({}));
    expect(gate.pass).toBe(false);
    expect(gate.perAxiom).toEqual([
      { axiom: "1", enforcement: "blocking", errorFindings: 1, maxFindings: 0, pass: false },
      AXIOM5_CLEAN,
    ]);
  });

  it("HAZARD: advisory axiom WITH error findings never gates", () => {
    const gate = evaluateGate(
      [errorFinding("1", "a.ts"), errorFinding("1", "b.ts")],
      config({ "1": { enforcement: "advisory" } }),
    );
    expect(gate.pass).toBe(true);
    expect(gate.perAxiom[0]).toEqual({
      axiom: "1",
      enforcement: "advisory",
      errorFindings: 2,
      maxFindings: 0,
      pass: true,
    });
  });

  it("HAZARD: threshold boundary — exactly maxFindings passes, one more fails", () => {
    const two = [errorFinding("1", "a.ts"), errorFinding("1", "b.ts")];
    const three = [...two, errorFinding("1", "c.ts")];
    const cfg = config({ "1": { enforcement: "blocking", maxFindings: 2 } });
    expect(evaluateGate(two, cfg).pass).toBe(true); // exactly N tolerated
    expect(evaluateGate(three, cfg).pass).toBe(false); // N+1 gates
  });

  it("ignores non-error severities; ran/configured axioms still get entries on no findings", () => {
    const warning = { ...errorFinding("1", "a.ts"), severity: "warning" as const };
    expect(evaluateGate([warning], config({})).pass).toBe(true);
    // Configured axiom 5 always present; a ran axiom with zero errors is a
    // durable pass entry, not an omission.
    expect(evaluateGate([], config({}), ["1"]).perAxiom).toEqual([
      { axiom: "1", enforcement: "blocking", errorFindings: 0, maxFindings: 0, pass: true },
      AXIOM5_CLEAN,
    ]);
  });

  it("excludes off axioms from perAxiom (they are declared in axiomsOff)", () => {
    const gate = evaluateGate([], config({ "1": { enforcement: "off" } }));
    expect(gate.perAxiom.map((a) => a.axiom)).toEqual(["5"]);
    expect(gate.pass).toBe(true);
  });

  it("gates per axiom independently and sorts perAxiom numeric-aware", () => {
    const gate = evaluateGate(
      [errorFinding("5", "a.ts"), errorFinding("10", "b.ts"), errorFinding("2", "c.ts")],
      config({ "2": { enforcement: "advisory" }, "10": { enforcement: "advisory" } }),
    );
    expect(gate.pass).toBe(false); // axiom 5 blocking default
    expect(gate.perAxiom.map((a) => a.axiom)).toEqual(["2", "5", "10"]); // numeric-aware
    expect(gate.perAxiom.map((a) => a.pass)).toEqual([true, false, true]);
  });
});
