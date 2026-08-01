import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

describe("CI workflow supply-chain guard", () => {
  it("grants only read access to repository contents", () => {
    expect(workflow).toMatch(/^permissions:\r?\n\x20{2}contents: read$/m);
  });

  it("pins every third-party action to an immutable commit SHA", () => {
    const uses = [...workflow.matchAll(/^\s*uses:\s+([^@\s]+)@([^\s#]+)/gm)];
    expect(Object.fromEntries(uses.map(([, action, revision]) => [action, revision]))).toEqual({
      "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
      "pnpm/action-setup": "b906affcce14559ad1aafd4ab0e942779e9f58b1",
      "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
      "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",
    });
  });

  it("bounds dogfood artifact retention explicitly", () => {
    expect(workflow).toMatch(/name: dogfood-review[\s\S]*?retention-days: 7/);
  });
});
