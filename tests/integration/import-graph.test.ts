import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it, vi } from "vitest";

// ts-morph project parses (twice for the byte-identity assertion) can
// exceed the 5s default under full-suite parallel load.
vi.setConfig({ testTimeout: 30_000 });

import {
  TypeScriptAdapter,
  importGraphResultSchema,
  type ImportGraph,
  type PartialResultOf,
} from "../../packages/core/src/index.js";

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../__fixtures__/import-graph",
);
const tsconfigPath = path.join(fixtureDir, "tsconfig.json");

const build = () => new TypeScriptAdapter().buildImportGraph({ tsconfigPath });

describe("TypeScriptAdapter import graph (golden fixture)", () => {
  let result: PartialResultOf<ImportGraph>;
  let graph: ImportGraph;

  beforeAll(() => {
    result = build();
    graph = result.data;
  });

  it("matches expected-graph.json byte-identically, twice", () => {
    const golden = readFileSync(path.join(fixtureDir, "expected-graph.json"), "utf8");
    expect(graph.serialize()).toBe(golden);
    expect(build().data.serialize()).toBe(golden);
  });

  it("validates against the contracts partial-result schema", () => {
    // The serialized envelope carries data/coverage/degraded only — the raw
    // attempted/unresolved counters are merge inputs, not persisted shape.
    expect(() =>
      importGraphResultSchema.parse({
        data: graph.toJSON(),
        coverage: result.coverage,
        degraded: result.degraded,
      }),
    ).not.toThrow();
  });

  it("resolves a tsconfig `paths` alias to the aliased file", () => {
    expect(graph.edges).toContainEqual({
      from: "src/main.ts",
      to: "src/aliased/target.ts",
      dynamic: false,
      typeOnly: false,
      reExport: false,
      line: 3,
      names: ["aliased"],
    });
  });

  it("edges to the barrel, with the re-export chain queryable to ./impl", () => {
    expect(graph.edges).toContainEqual({
      from: "src/main.ts",
      to: "src/barrel.ts",
      dynamic: false,
      typeOnly: false,
      reExport: false,
      line: 4,
      names: ["fromBarrel"],
    });
    const chain = graph.fanOut("src/barrel.ts");
    expect(chain.coverage).toBe(1);
    expect(chain.data.edges).toEqual([
      {
        from: "src/barrel.ts",
        to: "src/impl.ts",
        dynamic: false,
        typeOnly: false,
        reExport: true,
        line: 2,
        names: ["fromBarrel"],
      },
    ]);
  });

  it("flags literal dynamic imports", () => {
    expect(graph.edges).toContainEqual({
      from: "src/main.ts",
      to: "src/lazy.ts",
      dynamic: true,
      typeOnly: false,
      reExport: false,
      line: 11,
      names: ["*"],
    });
  });

  it("flags declaration-level type-only imports", () => {
    expect(graph.edges).toContainEqual({
      from: "src/main.ts",
      to: "src/types.ts",
      dynamic: false,
      typeOnly: true,
      reExport: false,
      line: 7,
      names: ["SomeType"],
    });
  });

  it("flags inline-modifier type-only imports", () => {
    expect(graph.edges).toContainEqual({
      from: "src/main.ts",
      to: "src/types2.ts",
      dynamic: false,
      typeOnly: true,
      reExport: false,
      line: 8,
      names: ["OnlyInline"],
    });
  });

  it("records a RESOLVED external package as node + edge, never traversed", () => {
    expect(graph.nodes).toContainEqual({ file: "typescript", external: true });
    expect(graph.edges).toContainEqual({
      from: "src/main.ts",
      to: "typescript",
      dynamic: false,
      typeOnly: false,
      reExport: false,
      line: 2,
      names: ["*"],
    });
    expect(graph.fanOut("typescript").data.count).toBe(0);
    // Resolved externals are verified — no degraded entry for them.
    expect(result.degraded.some((d) => d.subject.includes("typescript"))).toBe(false);
  });

  it("records an UNRESOLVED bare specifier as external edge AND degraded", () => {
    expect(graph.nodes).toContainEqual({ file: "unresolvable-pkg-xyz", external: true });
    expect(graph.edges).toContainEqual({
      from: "src/main.ts",
      to: "unresolvable-pkg-xyz",
      dynamic: false,
      typeOnly: false,
      reExport: false,
      line: 6,
      names: [],
    });
    expect(result.degraded).toContainEqual({
      reason: "unresolved bare specifier",
      subject: "src/main.ts -> unresolvable-pkg-xyz",
    });
  });

  it("degrades a non-literal dynamic import with no edge", () => {
    expect(result.degraded).toContainEqual({
      reason: "non-literal dynamic import specifier",
      subject: "src/main.ts",
    });
    // Only the literal dynamic import produced an edge.
    expect(graph.edges.filter((e) => e.dynamic)).toHaveLength(1);
  });

  it("degrades on unresolvable imports instead of throwing", () => {
    // 10 unique attempts, 3 unresolved (./does-not-exist, unresolvable-pkg-xyz,
    // the non-literal dynamic import).
    expect(result.coverage).toBeCloseTo(7 / 10, 10);
    expect(result.degraded).toEqual([
      {
        reason: "unresolvable import specifier",
        subject: "src/main.ts -> ./does-not-exist",
      },
      {
        reason: "unresolved bare specifier",
        subject: "src/main.ts -> unresolvable-pkg-xyz",
      },
      {
        reason: "non-literal dynamic import specifier",
        subject: "src/main.ts",
      },
    ]);
    // No phantom node or edge for the unresolvable relative specifier.
    expect(graph.nodes.some((n) => n.file.includes("does-not-exist"))).toBe(false);
    expect(graph.edges.some((e) => e.to.includes("does-not-exist"))).toBe(false);
  });

  it("answers fan-in and fan-out with counts + edges", () => {
    const fanIn = graph.fanIn("src/impl.ts");
    expect(fanIn.data.count).toBe(1);
    expect(fanIn.data.edges[0]).toMatchObject({ from: "src/barrel.ts", reExport: true });

    const fanOut = graph.fanOut("src/main.ts");
    expect(fanOut.data.count).toBe(7);
    expect(fanOut.data.edges.map((e) => e.to)).toEqual([
      "src/aliased/target.ts",
      "src/barrel.ts",
      "src/lazy.ts",
      "src/types.ts",
      "src/types2.ts",
      "typescript",
      "unresolvable-pkg-xyz",
    ]);
  });

  it("returns an empty degraded result for an unknown file", () => {
    for (const fan of [graph.fanIn("src/nope.ts"), graph.fanOut("src/nope.ts")]) {
      expect(fan.data).toEqual({ count: 0, edges: [] });
      expect(fan.coverage).toBe(0);
      expect(fan.degraded).toEqual([
        { reason: "file is not a node in the import graph", subject: "src/nope.ts" },
      ]);
    }
  });

  it("degrades (never throws) when the tsconfig cannot be loaded", () => {
    const broken = new TypeScriptAdapter().buildImportGraph({
      tsconfigPath: path.join(fixtureDir, "missing-tsconfig.json"),
    });
    expect(broken.coverage).toBe(0);
    expect(broken.data.nodes).toEqual([]);
    expect(broken.data.edges).toEqual([]);
    expect(broken.degraded).toHaveLength(1);
    expect(broken.degraded[0]?.reason).toMatch(/^tsconfig load failed: /);
    expect(broken.degraded[0]?.subject).toContain("missing-tsconfig.json");
  });
});
