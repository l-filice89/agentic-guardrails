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
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

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
      names: ["*"],
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
      names: ["*"],
    });
  });

  it("does not treat an ambient require declaration under root node_modules as project code", () => {
    const rootedAtRepo = new TypeScriptAdapter().buildImportGraph({ tsconfigPath, rootDir: repoRoot });
    expect(
      rootedAtRepo.data.edges.some(
        (edge) => edge.line === 7 && edge.to.endsWith("/src/dep3.ts"),
      ),
    ).toBe(true);
  });

  it("resolves static templates and parenthesized string arguments", () => {
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "src/main.ts", to: "src/dep3.ts", dynamic: true, line: 8 }),
        expect.objectContaining({ from: "src/main.ts", to: "src/dep2.ts", dynamic: true, line: 9 }),
      ]),
    );
  });

  it("ignores calls to a project-defined binding named require", () => {
    expect(graph.edges.some((edge) => edge.to === "./shadowed")).toBe(false);
    expect(result.degraded.some((entry) => entry.subject.includes("shadowed"))).toBe(false);
  });

  it("treats bundler-resolved asset imports as valid external edges", () => {
    expect(graph.edges).toContainEqual({
      from: "src/main.ts",
      to: "styles.css",
      dynamic: false,
      typeOnly: false,
      reExport: false,
      line: 5,
      names: [],
    });
    expect(result.degraded.some((entry) => entry.subject.includes("styles.css"))).toBe(false);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ from: "src/main.ts", to: "@/styles.css", line: 15 }),
    );
  });

  it("does not let a query suffix hide an unresolved code import", () => {
    expect(result.degraded).toContainEqual({
      reason: "unresolvable import specifier",
      subject: "src/main.ts -> ./missing.ts?x",
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
      names: ["Inline"],
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
      names: ["outside"],
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
