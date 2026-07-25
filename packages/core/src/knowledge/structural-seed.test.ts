import { describe, expect, it } from "vitest";

import type { ImportGraphBuildResult } from "../adapter/language-adapter.js";
import { ImportGraph } from "../graph/import-graph.js";
import { buildStructuralSeed, serializeStructuralSeed } from "./structural-seed.js";

function buildResult(): ImportGraphBuildResult {
  // Constructed in scrambled order on purpose — the graph canonicalizes.
  const nodes = [
    { file: "src/b.ts", external: false },
    { file: "src/a.ts", external: false },
  ];
  const edges = [
    { from: "src/a.ts", to: "src/b.ts", dynamic: false, typeOnly: false, reExport: false, line: 1 },
    { from: "src/b.ts", to: "zod", dynamic: false, typeOnly: false, reExport: false, line: 2 },
    { from: "src/a.ts", to: "zod", dynamic: false, typeOnly: false, reExport: false, line: 2 },
  ];
  return {
    data: new ImportGraph(nodes, edges),
    coverage: 0.5,
    attempted: 4,
    unresolved: 2,
    unresolvedImports: [],
    degraded: [
      { reason: "z-later", subject: "src/z.ts" },
      { reason: "a-first", subject: "src/a.ts" },
    ],
  };
}

describe("buildStructuralSeed", () => {
  it("emits one sorted {file, fanIn, external} entry per graph node with the partial-result envelope", () => {
    const seed = buildStructuralSeed(buildResult());
    expect(seed.schemaVersion).toBe(1);
    // Externals are carried MARKED — "zod" must not read as a repo file.
    expect(seed.entities).toEqual([
      { file: "src/a.ts", fanIn: 0, external: false },
      { file: "src/b.ts", fanIn: 1, external: false },
      { file: "zod", fanIn: 2, external: true },
    ]);
    // Envelope carried through, degraded canonically sorted.
    expect(seed.coverage).toBe(0.5);
    expect(seed.degraded).toEqual([
      { reason: "a-first", subject: "src/a.ts" },
      { reason: "z-later", subject: "src/z.ts" },
    ]);
  });

  it("serializes byte-identically for identical input (determinism)", () => {
    const first = serializeStructuralSeed(buildStructuralSeed(buildResult()));
    const second = serializeStructuralSeed(buildStructuralSeed(buildResult()));
    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
    expect(JSON.parse(first)).toMatchObject({ schemaVersion: 1 });
  });
});
