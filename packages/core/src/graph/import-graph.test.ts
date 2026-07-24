import { describe, expect, it } from "vitest";

import { ImportGraph, normalizePath } from "./import-graph.js";

const edge = (from: string, to: string, flags?: Partial<{ dynamic: boolean; typeOnly: boolean; reExport: boolean }>) => ({
  from,
  to,
  dynamic: false,
  typeOnly: false,
  reExport: false,
  ...flags,
});

describe("normalizePath", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizePath("src\\a\\b.ts")).toBe("src/a/b.ts");
  });

  it("handles mixed separators", () => {
    expect(normalizePath("src\\a/b\\c.ts")).toBe("src/a/b/c.ts");
  });

  it("strips a leading ./", () => {
    expect(normalizePath("./src/a.ts")).toBe("src/a.ts");
  });

  it("preserves case — it never invents identity", () => {
    expect(normalizePath("Src\\File.TS")).toBe("Src/File.TS");
  });
});

describe("ImportGraph determinism", () => {
  it("stable-sorts nodes and edges regardless of insertion order", () => {
    const a = new ImportGraph(
      [{ file: "b.ts", external: false }, { file: "a.ts", external: false }],
      [edge("b.ts", "a.ts"), edge("a.ts", "b.ts")],
    );
    const b = new ImportGraph(
      [{ file: "a.ts", external: false }, { file: "b.ts", external: false }],
      [edge("a.ts", "b.ts"), edge("b.ts", "a.ts")],
    );
    expect(a.serialize()).toBe(b.serialize());
    expect(a.nodes.map((n) => n.file)).toEqual(["a.ts", "b.ts"]);
  });

  it("sorts case-sensitively by code point (stable across platforms)", () => {
    const g = new ImportGraph(
      [{ file: "b.ts", external: false }, { file: "A.ts", external: false }],
      [],
    );
    expect(g.nodes.map((n) => n.file)).toEqual(["A.ts", "b.ts"]);
  });

  it("dedupes identical edges but keeps differently-flagged ones", () => {
    const g = new ImportGraph(
      [{ file: "a.ts", external: false }, { file: "b.ts", external: false }],
      [edge("a.ts", "b.ts"), edge("a.ts", "b.ts"), edge("a.ts", "b.ts", { typeOnly: true })],
    );
    expect(g.edges).toHaveLength(2);
  });

  it("dedupes nodes after separator normalization", () => {
    const g = new ImportGraph(
      [{ file: "src\\a.ts", external: false }, { file: "src/a.ts", external: false }],
      [],
    );
    expect(g.nodes).toEqual([{ file: "src/a.ts", external: false }]);
  });

  it("does not collide keys for paths containing spaces", () => {
    const g = new ImportGraph(
      [],
      [edge("a b", "c"), edge("a", "b c")],
    );
    expect(g.edges).toHaveLength(2);
  });

  it("collapses ./, // and a/../b via posix normalization", () => {
    expect(normalizePath("src//a/../b.ts")).toBe("src/b.ts");
  });

  it("synthesizes missing edge-endpoint nodes (bare ⇒ external)", () => {
    const g = new ImportGraph([{ file: "a.ts", external: false }], [edge("a.ts", "zod")]);
    expect(g.nodes).toContainEqual({ file: "zod", external: true });
    expect(g.fanIn("zod").coverage).toBe(1);
    const h = new ImportGraph([], [edge("src/a.ts", "src/b.ts")]);
    expect(h.nodes).toContainEqual({ file: "src/b.ts", external: false });
  });

  it("freezes nodes and edges — fan queries hand out immutable state", () => {
    const g = new ImportGraph(
      [{ file: "a.ts", external: false }, { file: "b.ts", external: false }],
      [edge("a.ts", "b.ts")],
    );
    expect(Object.isFrozen(g.nodes)).toBe(true);
    expect(Object.isFrozen(g.edges)).toBe(true);
    expect(Object.isFrozen(g.edges[0])).toBe(true);
    expect(Object.isFrozen(g.fanOut("a.ts").data.edges)).toBe(true);
  });

  it("serializes with exactly one trailing newline", () => {
    const g = new ImportGraph([], []);
    expect(g.serialize().endsWith("}\n")).toBe(true);
    expect(g.serialize().endsWith("\n\n")).toBe(false);
  });
});
