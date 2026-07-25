import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import type { ImportGraph } from "../graph/import-graph.js";
import type { PartialResultOf } from "./language-adapter.js";
import { TypeScriptAdapter } from "./typescript-adapter.js";

// The adapter's only entry is a tsconfig path, so these cases live in a
// small on-disk fixture project instead of ts-morph's in-memory FS.
const tsconfigPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../tests/__fixtures__/import-graph-units/proj/tsconfig.json",
);

describe("TypeScriptAdapter unit fixture", () => {
  let result: PartialResultOf<ImportGraph>;
  let graph: ImportGraph;

  beforeAll(() => {
    result = new TypeScriptAdapter().buildImportGraph({ tsconfigPath });
    graph = result.data;
  });

  it("resolves `import x = require(...)` like a static import", () => {
    expect(graph.edges).toContainEqual({
      from: "src/main.ts",
      to: "src/dep.ts",
      dynamic: false,
      typeOnly: false,
      reExport: false,
      line: 2,
    });
  });

  it("resolves a literal `require(...)` call to a static edge", () => {
    expect(graph.edges).toContainEqual({
      from: "src/main.ts",
      to: "src/dep3.ts",
      dynamic: false,
      typeOnly: false,
      reExport: false,
      line: 7,
    });
  });

  it("degrades a non-literal `require(...)` argument with no extra edge", () => {
    expect(result.degraded).toContainEqual({
      reason: "non-literal require specifier",
      subject: "src/main.ts",
    });
    expect(result.coverage).toBeLessThan(1);
  });

  it("flags inline-modifier type-only imports", () => {
    expect(graph.edges).toContainEqual({
      from: "src/main.ts",
      to: "src/dep2.ts",
      dynamic: false,
      typeOnly: true,
      reExport: false,
      line: 3,
    });
  });

  it("treats a file resolving outside the project root as external + degraded", () => {
    expect(graph.nodes).toContainEqual({ file: "../../outside", external: true });
    expect(graph.edges).toContainEqual({
      from: "src/main.ts",
      to: "../../outside",
      dynamic: false,
      typeOnly: false,
      reExport: false,
      line: 4,
    });
    expect(result.degraded).toContainEqual({
      reason: "resolved outside project root",
      subject: "src/main.ts -> ../../outside",
    });
  });

  it("never walks files outside the project root", () => {
    expect(graph.nodes.some((n) => n.file === "outside.ts")).toBe(false);
    expect(graph.edges.some((e) => e.from.includes("outside"))).toBe(false);
  });
});
