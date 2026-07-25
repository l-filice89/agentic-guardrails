import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalyzerContext } from "../pipeline/pipeline.js";
import { axiom3Cleanliness } from "./axiom3-cleanliness.js";
import { axiom4Nfr } from "./axiom4-nfr.js";
import {
  firstLine,
  parseChangedFiles,
  type ChangedFilesCache,
  type ChangedFilesParse,
} from "./changed-files.js";

// ts-morph project builds legitimately exceed the 5s default under
// full-suite parallel load.
vi.setConfig({ testTimeout: 60_000 });

const tempDirs: string[] = [];

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2023",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
  },
  include: ["src"],
});

function fixtureProject(files: Record<string, string>): AnalyzerContext & { root: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "guardrails-changed-files-"));
  tempDirs.push(root);
  writeFileSync(path.join(root, "tsconfig.json"), TSCONFIG);
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
    tsconfigPaths: [path.join(root, "tsconfig.json")],
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("shared changed-files parse (1.11 P4)", () => {
  it("PIN: axiom 3 + axiom 4 together consume ONE parse per run through the acquire seam", async () => {
    const base = fixtureProject({
      "src/a.ts": [
        "export async function go(url: string): Promise<void> {",
        "  await fetch(url);",
        "}",
        "",
      ].join("\n"),
    });
    // The pipeline's memo, reproduced: parse-on-first-acquire, then reuse.
    let parses = 0;
    let memo: ChangedFilesParse | undefined;
    const changedFilesCache: ChangedFilesCache = {
      acquire(build) {
        if (memo === undefined) {
          parses += 1;
          memo = build();
        }
        return memo;
      },
    };
    const ctx: AnalyzerContext = { ...base, changedFilesCache };
    const cleanliness = await axiom3Cleanliness.run(ctx);
    const nfr = await axiom4Nfr.run(ctx);
    expect(parses).toBe(1); // both analyzers routed through the seam
    expect(cleanliness.findings).toEqual([]);
    expect(nfr.findings).toHaveLength(1); // the shared parse still feeds real findings
  });

  it("dedupes and sorts the changed list; an unreadable file is a typed degradation", () => {
    const base = fixtureProject({
      "src/b.ts": "export const b = 1;\n",
      "src/a.ts": "export const a = 1;\n",
    });
    const parse = parseChangedFiles({
      repoRoot: base.repoRoot,
      changedFiles: ["src/b.ts", "src/a.ts", "src/b.ts", "src/missing.ts"],
    });
    expect(parse.parsed.map(([file]) => file)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(parse.degraded).toHaveLength(1);
    expect(parse.degraded[0]!.subject).toBe("src/missing.ts");
    expect(parse.degraded[0]!.reason).toContain("could not be read");
  });

  it("an already-aborted signal declares the skipped files instead of parsing them", () => {
    const base = fixtureProject({ "src/a.ts": "export const a = 1;\n" });
    const controller = new AbortController();
    controller.abort();
    const parse = parseChangedFiles({
      repoRoot: base.repoRoot,
      changedFiles: ["src/a.ts"],
      signal: controller.signal,
    });
    expect(parse.parsed).toEqual([]);
    expect(parse.degraded).toHaveLength(1);
    expect(parse.degraded[0]!.reason).toContain("aborted");
  });

  it("firstLine never leaks a Windows \\r into a degradation reason", () => {
    expect(firstLine("boom\r\nrest")).toBe("boom");
    expect(firstLine("boom\nrest")).toBe("boom");
    expect(firstLine("boom")).toBe("boom");
  });
});
