import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CONTRACTS_PACKAGE,
  axiomEnvelope,
  computeFindingId,
  configJsonSchema,
  configSchema,
  dispositionRecordSchema,
  findingSchema,
  migrateArtifact,
  partialResult,
  registerArtifactKind,
  runManifestSchema,
  trendRecordSchema,
} from "./index.js";

const readJson = (relative: string): unknown =>
  JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));

const validFinding = {
  findingId: computeFindingId({
    axiom: "5",
    ruleId: "no-any",
    file: "src/a.ts",
    enclosingSymbol: "doThing",
  }),
  axiom: "5",
  ruleId: "no-any",
  enclosingSymbol: "doThing",
  location: { file: "src/a.ts", startLine: 10, endLine: 12 },
  message: "explicit any",
  tier: "deterministic",
  source: "ast",
  confidence: 1,
  severity: "error",
};

describe("@agentic-guardrails/contracts", () => {
  it("exports the package sentinel", () => {
    expect(CONTRACTS_PACKAGE).toBe("@agentic-guardrails/contracts");
  });

  it("has zod as the only runtime dependency", () => {
    const pkg = readJson("../package.json") as Record<string, Record<string, string> | undefined>;
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["zod"]);
    expect(pkg.peerDependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toBeUndefined();
  });
});

describe("findingSchema", () => {
  it("accepts a valid finding", () => {
    expect(findingSchema.safeParse(validFinding).success).toBe(true);
  });

  it("accepts optional exemplar and degraded", () => {
    const result = findingSchema.safeParse({
      ...validFinding,
      exemplar: "use unknown + narrowing",
      degraded: { reason: "parse-error", subject: "src/a.ts" },
    });
    expect(result.success).toBe(true);
  });

  it.each(["severity", "findingId"] as const)("fails naming the field when %s is missing", (field) => {
    const rest: Record<string, unknown> = { ...validFinding };
    delete rest[field];
    const result = findingSchema.safeParse(rest);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.includes(field))).toBe(true);
  });

  it("rejects unknown enum values", () => {
    for (const bad of [
      { ...validFinding, tier: "llm" },
      { ...validFinding, source: "guess" },
      { ...validFinding, severity: "fatal" },
    ]) {
      expect(findingSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("rejects confidence outside 0..1", () => {
    expect(findingSchema.safeParse({ ...validFinding, confidence: 1.1 }).success).toBe(false);
  });

  it("enforces per-tier coherence: deterministic => confidence 1 and non-llm source", () => {
    expect(findingSchema.safeParse({ ...validFinding, confidence: 0.3 }).success).toBe(false);
    expect(findingSchema.safeParse({ ...validFinding, source: "llm" }).success).toBe(false);
    expect(
      findingSchema.safeParse({ ...validFinding, tier: "inferred", source: "ast" }).success,
    ).toBe(false);
    expect(
      findingSchema.safeParse({
        ...validFinding,
        tier: "inferred",
        source: "llm",
        confidence: 0.7,
      }).success,
    ).toBe(true);
  });

  it("rejects inverted line ranges and unknown keys (strict)", () => {
    expect(
      findingSchema.safeParse({
        ...validFinding,
        location: { file: "src/a.ts", startLine: 12, endLine: 10 },
      }).success,
    ).toBe(false);
    expect(findingSchema.safeParse({ ...validFinding, extra: "nope" }).success).toBe(false);
  });
});

describe("computeFindingId", () => {
  it("is stable under line drift: two schema-valid findings at different lines share one id", () => {
    // The same logical finding, re-emitted after 90 unrelated lines were
    // added above it. Only location moved; the identity fields did not.
    const before = validFinding;
    const after = {
      ...validFinding,
      location: { file: "src/a.ts", startLine: 100, endLine: 102 },
    };
    expect(findingSchema.safeParse(before).success).toBe(true);
    expect(findingSchema.safeParse(after).success).toBe(true);
    const idOf = (f: typeof validFinding) =>
      computeFindingId({
        axiom: f.axiom,
        ruleId: f.ruleId,
        file: f.location.file,
        enclosingSymbol: f.enclosingSymbol,
      });
    expect(idOf(after)).toBe(idOf(before));
    expect(idOf(before)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes path separators so ids do not fork across platforms", () => {
    const posix = { axiom: "5", ruleId: "no-any", file: "src/a.ts", enclosingSymbol: "f" };
    expect(computeFindingId({ ...posix, file: "src\\a.ts" })).toBe(computeFindingId(posix));
  });

  it("changes when any identity field changes", () => {
    const base = { axiom: "5", ruleId: "no-any", file: "src/a.ts", enclosingSymbol: "doThing" };
    for (const patch of [
      { axiom: "6" },
      { ruleId: "no-cast" },
      { file: "src/b.ts" },
      { enclosingSymbol: "other" },
    ]) {
      expect(computeFindingId({ ...base, ...patch })).not.toBe(computeFindingId(base));
    }
  });
});

describe("partialResult", () => {
  it("validates a degraded partial result with typed entries", () => {
    const schema = partialResult(z.array(findingSchema));
    const result = schema.safeParse({
      data: [validFinding],
      coverage: 0.8,
      degraded: [{ reason: "timeout", subject: "src/slow.ts" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects partial coverage with an empty degraded list (silent degradation)", () => {
    const schema = partialResult(z.unknown());
    expect(schema.safeParse({ data: null, coverage: 0.4, degraded: [] }).success).toBe(false);
    expect(schema.safeParse({ data: null, coverage: 1, degraded: [] }).success).toBe(true);
  });

  it("rejects untyped degraded entries", () => {
    const schema = partialResult(z.unknown());
    expect(
      schema.safeParse({ data: null, coverage: 1, degraded: [{ reason: "x" }] }).success,
    ).toBe(false);
  });
});

describe("axiomEnvelope", () => {
  it("returns a validated <axiom>.in/.out pair", () => {
    const env = axiomEnvelope("5", z.object({ code: z.string() }), z.object({ ok: z.boolean() }));
    expect(env.in.channel).toBe("5.in");
    expect(env.out.channel).toBe("5.out");
    expect(env.in.schema.safeParse({ code: "x" }).success).toBe(true);
    expect(env.out.schema.safeParse({ ok: "nope" }).success).toBe(false);
  });
});

describe("runManifestSchema", () => {
  it("requires modelIdentity.source when modelIdentity is present", () => {
    const manifest = readJson("./__fixtures__/run-manifest.v1.json") as Record<string, unknown>;
    expect(runManifestSchema.safeParse(manifest).success).toBe(true);
    expect(
      runManifestSchema.safeParse({ ...manifest, modelIdentity: { model: "m" } }).success,
    ).toBe(false);
  });

  it("requires modelIdentity when the llm tier is enabled", () => {
    const manifest = readJson("./__fixtures__/run-manifest.v1.json") as Record<string, unknown>;
    expect(
      runManifestSchema.safeParse({
        ...manifest,
        tierEnablement: { deterministic: true, llm: true },
      }).success,
    ).toBe(false);
    expect(
      runManifestSchema.safeParse({
        ...manifest,
        tierEnablement: { deterministic: true, llm: true },
        modelIdentity: { model: "claude-sonnet-5", source: "reported" },
      }).success,
    ).toBe(true);
  });
});

describe("configSchema", () => {
  it("defaults axiom 5 to blocking", () => {
    const parsed = configSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.data?.axioms["5"]?.enforcement).toBe("blocking");
  });

  it("rejects unknown enforcement values and exports a JSON Schema", () => {
    expect(
      configSchema.safeParse({ axioms: { "5": { enforcement: "warn" } } }).success,
    ).toBe(false);
    expect(configJsonSchema).toMatchObject({ type: "object" });
  });
});

describe("trend and disposition records", () => {
  it("validates the trend-record fixture and rejects negative counts", () => {
    const record = readJson("./__fixtures__/trend-record.v1.json") as Record<string, unknown>;
    expect(trendRecordSchema.safeParse(record).success).toBe(true);
    expect(
      trendRecordSchema.safeParse({
        ...record,
        axiomSeverityCounts: { "5": { error: -1, warning: 0, info: 0 } },
      }).success,
    ).toBe(false);
  });

  it("pins the DR-1 disposition enum exactly", () => {
    const record = readJson("./__fixtures__/disposition-record.v1.json") as Record<string, unknown>;
    expect(dispositionRecordSchema.safeParse(record).success).toBe(true);
    expect(
      dispositionRecordSchema.safeParse({ ...record, disposition: "wontfix" }).success,
    ).toBe(false);
  });
});

describe("migrateArtifact", () => {
  it.each([
    ["run-manifest", "./__fixtures__/run-manifest.v1.json"],
    ["trend-record", "./__fixtures__/trend-record.v1.json"],
    ["disposition-record", "./__fixtures__/disposition-record.v1.json"],
  ])("golden round-trip: committed v1 %s fixture migrates and parses green", (kind, path) => {
    const result = migrateArtifact(kind, readJson(path));
    expect(result.ok).toBe(true);
  });

  it("chains multiple steps for a synthetic test-only kind", () => {
    registerArtifactKind("synthetic-test-kind", {
      currentVersion: 3,
      schema: z.object({ schemaVersion: z.literal(3), a: z.string(), b: z.string() }),
      steps: {
        1: (old) => ({ ...old, a: "from-v1" }),
        2: (old) => ({ ...old, b: "from-v2" }),
      },
    });
    const result = migrateArtifact("synthetic-test-kind", { schemaVersion: 1 });
    expect(result).toEqual({
      ok: true,
      value: { schemaVersion: 3, a: "from-v1", b: "from-v2" },
    });
  });

  it("returns typed errors, never throws", () => {
    expect(migrateArtifact("no-such-kind", { schemaVersion: 1 })).toMatchObject({
      ok: false,
      error: { code: "unknown-kind" },
    });
    expect(migrateArtifact("run-manifest", { schemaVersion: 99 })).toMatchObject({
      ok: false,
      error: { code: "future-version" },
    });
    expect(migrateArtifact("run-manifest", {})).toMatchObject({
      ok: false,
      error: { code: "invalid-artifact" },
    });
    expect(migrateArtifact("run-manifest", { schemaVersion: 1 })).toMatchObject({
      ok: false,
      error: { code: "invalid-artifact" },
    });
  });

  it("treats prototype-chain names as unknown kinds instead of throwing", () => {
    for (const kind of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(migrateArtifact(kind, { schemaVersion: 1 })).toMatchObject({
        ok: false,
        error: { code: "unknown-kind" },
      });
    }
  });

  it("refuses to clobber built-in kinds and rejects malformed ladders", () => {
    const ladder = { currentVersion: 1, schema: z.object({}), steps: {} };
    expect(registerArtifactKind("run-manifest", ladder)).toBe(false);
    expect(registerArtifactKind("bad-version-kind", { ...ladder, currentVersion: 0 })).toBe(false);
    expect(migrateArtifact("run-manifest", readJson("./__fixtures__/run-manifest.v1.json")).ok).toBe(
      true,
    );
  });

  it("reports step-failed for a step returning a non-object and never mutates the input", () => {
    registerArtifactKind("non-object-step-kind", {
      currentVersion: 2,
      schema: z.object({ schemaVersion: z.literal(2) }),
      steps: { 1: () => null as unknown as Record<string, unknown> },
    });
    const original = { schemaVersion: 1 };
    expect(migrateArtifact("non-object-step-kind", original)).toMatchObject({
      ok: false,
      error: { code: "step-failed" },
    });
    expect(original).toEqual({ schemaVersion: 1 });
  });
});
