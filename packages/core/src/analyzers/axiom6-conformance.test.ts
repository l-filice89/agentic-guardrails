import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { findingSchema, type Degradation } from "@agentic-guardrails/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STRUCTURAL_SEED_PATH } from "../knowledge/structural-seed.js";
import type { AnalyzerContext } from "../pipeline/pipeline.js";
import {
  axiom6Conformance,
  fileKind,
  MIN_SAMPLE,
  namingStyle,
  NO_CORPUS_PREFIX,
  prevalence,
} from "./axiom6-conformance.js";

// ts-morph project builds (the module-shape rows) legitimately exceed the 5s
// default under full-suite parallel load.
vi.setConfig({ testTimeout: 60_000 });

const tempDirs: string[] = [];

interface SeedEntity {
  file: string;
  fanIn: number;
  external: boolean;
}

/** Seed bytes for a corpus of repo files (plus optional externals). */
function seedJson(files: readonly string[], externals: readonly string[] = []): string {
  const entities: SeedEntity[] = [
    ...files.map((file) => ({ file, fanIn: 1, external: false })),
    ...externals.map((file) => ({ file, fanIn: 1, external: true })),
  ].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return `${JSON.stringify({ schemaVersion: 1, entities, coverage: 1, degraded: [] }, null, 2)}\n`;
}

interface FixtureOptions {
  /** Raw seed bytes; omit for NO seed file at all. */
  seed?: string;
  /** Repo-relative changed analyzable-TS paths. */
  changed: readonly string[];
  /** Real files written to disk (module-shape rows need a real graph). */
  files?: Record<string, string>;
  /** true → write a tsconfig and hand its path to the analyzer. */
  tsconfig?: boolean;
}

function fixture(options: FixtureOptions): AnalyzerContext {
  const root = mkdtempSync(path.join(os.tmpdir(), "guardrails-axiom6-"));
  tempDirs.push(root);
  for (const [rel, content] of Object.entries(options.files ?? {})) {
    mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  if (options.seed !== undefined) {
    const seedPath = path.join(root, STRUCTURAL_SEED_PATH);
    mkdirSync(path.dirname(seedPath), { recursive: true });
    writeFileSync(seedPath, options.seed);
  }
  if (options.tsconfig === true) {
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext" },
        include: ["src/**/*.ts", "lib/**/*.ts"],
      }),
    );
  }
  return {
    repoRoot: root,
    changedFiles: options.changed,
    allChangedFiles: options.changed,
    tsconfigPaths: options.tsconfig === true ? [path.join(root, "tsconfig.json")] : [],
  };
}

/** Without a tsconfig there is no import graph, so module shape DECLARES that
 * it did not run rather than silently skipping one of three rules. */
const NO_GRAPH: Degradation = {
  reason: "module shape not evaluated — no tsconfig for the import graph",
  subject: "conformance/module-shape",
};

/** 12 kebab-case corpus files under src/core — comfortably over MIN_SAMPLE. */
const KEBAB_CORPUS = Array.from({ length: 12 }, (_, i) => `src/core/thing-${i + 1}.ts`);

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the FR-5 prevalence gate", () => {
  it("confirms nothing below the sample floor, however unanimous", () => {
    const unanimous = Array.from({ length: MIN_SAMPLE - 1 }, () => "kebab");
    expect(prevalence(unanimous)).toEqual({
      count: MIN_SAMPLE - 1,
      total: MIN_SAMPLE - 1,
      qualified: false,
    });
    // ...and confirms at exactly the floor (both directions of the threshold).
    expect(prevalence([...unanimous, "kebab"])).toEqual({
      variant: "kebab",
      count: 10,
      total: 10,
      qualified: true,
    });
  });

  it("confirms nothing below the dominance floor, and confirms at exactly it", () => {
    // 8/10 = 0.8 exactly → confirmed; 7/10 = 0.7 → not (qualified either way:
    // the sample is there, the majority is not).
    const at = [...Array.from({ length: 8 }, () => "kebab"), "camel", "camel"];
    expect(prevalence(at)).toEqual({ variant: "kebab", count: 8, total: 10, qualified: true });
    const below = [...Array.from({ length: 7 }, () => "kebab"), "camel", "camel", "camel"];
    expect(prevalence(below)).toEqual({ count: 7, total: 10, qualified: true });
  });

  it("BEHAVIOURAL dominance boundary: 7/10 says nothing, 8/10 fires", async () => {
    const corpusOf = (kebab: number) => [
      ...Array.from({ length: kebab }, (_, i) => `src/core/thing-${i + 1}.ts`),
      ...Array.from({ length: 10 - kebab }, (_, i) => `src/core/other${i + 1}Thing.ts`),
    ];
    const run = async (kebab: number) =>
      axiom6Conformance.run(
        fixture({ seed: seedJson(corpusOf(kebab)), changed: ["src/core/MyNewFile.ts"] }),
      );
    expect((await run(7)).findings).toEqual([]);
    const fires = (await run(8)).findings;
    expect(fires).toHaveLength(1);
    expect(fires[0]!.message).toContain("kebab-case in 8/10");
  });
});

describe("classifiers", () => {
  it("reads casing off the stem, and treats an evidence-free stem as unclassifiable", () => {
    expect(namingStyle("my-thing")).toBe("kebab");
    expect(namingStyle("my_thing")).toBe("snake");
    expect(namingStyle("MyThing")).toBe("Pascal");
    expect(namingStyle("myThing")).toBe("camel");
    // A single all-lowercase word is a valid spelling in kebab, snake AND
    // camel — it must neither vote nor be judged.
    expect(namingStyle("index")).toBeUndefined();
    expect(namingStyle("")).toBeUndefined();
    expect(namingStyle("SCREAMING_CASE")).toBeUndefined();
    // The mirror image: an all-caps stem carries no casing intent either, so
    // it must not inflate the Pascal tally (or be judged as Pascal).
    expect(namingStyle("README")).toBeUndefined();
    expect(namingStyle("LICENSE")).toBeUndefined();
    expect(namingStyle("HTTP")).toBeUndefined();
    expect(namingStyle("A")).toBeUndefined();
    // ...while genuinely Pascal names with an acronym prefix still classify.
    expect(namingStyle("HTTPServer")).toBe("Pascal");
    expect(namingStyle("Api")).toBe("Pascal");
  });

  it("derives KIND from the basename suffix, declarations first", () => {
    expect(fileKind("src/a.d.ts")).toBe("declaration");
    expect(fileKind("src/a.test.ts")).toBe("test");
    expect(fileKind("src/a.spec.ts")).toBe("spec");
    expect(fileKind("vite.config.ts")).toBe("config");
    expect(fileKind("src/a.ts")).toBe("source");
  });
});

describe("conformance/naming-convention", () => {
  it("flags a deviating basename citing the measured evidence and the scope actually used", async () => {
    const ctx = fixture({
      seed: seedJson(KEBAB_CORPUS),
      changed: ["src/core/MyNewFile.ts"],
    });
    const result = await axiom6Conformance.run(ctx);
    expect(result.degraded).toEqual([NO_GRAPH]);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(findingSchema.safeParse(finding).success).toBe(true);
    expect(finding).toMatchObject({
      axiom: "6",
      ruleId: "conformance/naming-convention",
      tier: "deterministic",
      source: "ast",
      confidence: 1,
      severity: "warning",
      enclosingSymbol: "MyNewFile",
      location: { file: "src/core/MyNewFile.ts", startLine: 1, endLine: 1 },
    });
    expect(finding.message).toContain("PascalCase");
    // 12/12, not 13/13 — a NEW path is not in the corpus, so it cannot vote.
    expect(finding.message).toContain("kebab-case in 12/12 named files under src/core");
  });

  it("says nothing when the diff matches the confirmed convention", async () => {
    const ctx = fixture({
      seed: seedJson(KEBAB_CORPUS),
      changed: ["src/core/my-new-file.ts"],
    });
    expect((await axiom6Conformance.run(ctx)).findings).toEqual([]);
  });

  it("says nothing below the sample floor, however unanimous the corpus (FR-5)", async () => {
    const ctx = fixture({
      seed: seedJson(KEBAB_CORPUS.slice(0, MIN_SAMPLE - 1)),
      changed: ["src/core/MyNewFile.ts"],
    });
    expect((await axiom6Conformance.run(ctx)).findings).toEqual([]);
  });

  it("says nothing below the dominance floor — a split corpus confirms no convention", async () => {
    const split = [
      ...Array.from({ length: 6 }, (_, i) => `src/core/thing-${i + 1}.ts`),
      ...Array.from({ length: 5 }, (_, i) => `src/core/thing${i + 1}Alt.ts`),
    ];
    const ctx = fixture({ seed: seedJson(split), changed: ["src/core/MyNewFile.ts"] });
    expect((await axiom6Conformance.run(ctx)).findings).toEqual([]);
  });

  it("uses the NEAREST qualifying directory — a local convention is not overruled by the repo-wide one", async () => {
    // src/legacy has its own 12-file snake_case convention; the repo root is
    // overwhelmingly kebab. A snake file under src/legacy must stay silent.
    const legacy = Array.from({ length: 12 }, (_, i) => `src/legacy/old_thing_${i + 1}.ts`);
    const seed = seedJson([...KEBAB_CORPUS, ...legacy]);
    expect((await axiom6Conformance.run(fixture({ seed, changed: ["src/legacy/new_thing.ts"] })))
      .findings).toEqual([]);
    // ...and a kebab file in that same directory IS flagged, naming src/legacy.
    const deviating = await axiom6Conformance.run(
      fixture({ seed, changed: ["src/legacy/new-thing.ts"] }),
    );
    expect(deviating.findings).toHaveLength(1);
    expect(deviating.findings[0]!.message).toContain("snake_case in 12/12 named files under src/legacy");
  });

  it("a nearest scope that QUALIFIES but is not dominant silences the rule — the ancestor never overrules it", async () => {
    // src/mixed holds 10 classifiable files split 6/4: enough sample, no
    // majority. The repo root IS dominant (kebab) but must not be consulted.
    const mixed = [
      ...Array.from({ length: 6 }, (_, i) => `src/mixed/mixed-${i + 1}.ts`),
      ...Array.from({ length: 4 }, (_, i) => `src/mixed/mixed${i + 1}Alt.ts`),
    ];
    const ctx = fixture({
      seed: seedJson([...KEBAB_CORPUS, ...mixed]),
      changed: ["src/mixed/NewThing.ts"],
    });
    expect((await axiom6Conformance.run(ctx)).findings).toEqual([]);
  });

  it("walks up to the repo root when no directory on the path qualifies", async () => {
    const ctx = fixture({ seed: seedJson(KEBAB_CORPUS), changed: ["lib/MyNewFile.ts"] });
    const result = await axiom6Conformance.run(ctx);
    const naming = result.findings.filter((f) => f.ruleId === "conformance/naming-convention");
    expect(naming).toHaveLength(1);
    expect(naming[0]!.message).toContain("named files under the repo root");
    // The same file is ALSO out of place (12/12 plain sources live under src/)
    // — two independent rules, two findings, distinct ids.
    expect(result.findings).toHaveLength(2);
    expect(new Set(result.findings.map((f) => f.findingId)).size).toBe(2);
  });
});

describe("the judged/voter split (self-confirmation)", () => {
  it("a NEW path is judged and cannot vote — it is not in the corpus to vote with", async () => {
    // 12 corpus files, 12 new camelCase files: the diff is the whole change
    // set and still cannot become its own convention.
    const changed = Array.from({ length: 12 }, (_, i) => `src/core/newThing${i + 1}.ts`);
    const result = await axiom6Conformance.run(
      fixture({ seed: seedJson(KEBAB_CORPUS), changed }),
    );
    expect(result.findings).toHaveLength(12);
    for (const finding of result.findings) {
      expect(finding.ruleId).toBe("conformance/naming-convention");
      expect(finding.message).toContain("kebab-case in 12/12");
    }
  });

  it("a MODIFIED corpus file votes and is NOT judged — its name was decided before this diff", async () => {
    // The legacy Pascal file is in the corpus (so it votes) and is touched by
    // the diff (so, under the old exclusion, it was re-flagged forever).
    const seed = seedJson([...KEBAB_CORPUS, "src/core/OldPascalThing.ts"]);
    const result = await axiom6Conformance.run(
      fixture({ seed, changed: ["src/core/OldPascalThing.ts", "src/core/AnotherNew.ts"] }),
    );
    // Not judged: no finding on the modified file at all.
    expect(result.findings.map((f) => f.location.file)).toEqual(["src/core/AnotherNew.ts"]);
    // ...but it DID vote: the sample is 13, one of which is Pascal.
    expect(result.findings[0]!.message).toContain("kebab-case in 12/13");
  });

  it("REGRESSION: a large diff of modified files does not shrink the sample below the floor", async () => {
    // Eight of twelve corpus files touched. Excluding them from the corpus
    // (the first cut) left 4 votes — below MIN_SAMPLE — and silenced the
    // analyzer exactly when the diff was biggest.
    const result = await axiom6Conformance.run(
      fixture({
        seed: seedJson(KEBAB_CORPUS),
        changed: [...KEBAB_CORPUS.slice(0, 8), "src/core/MyNewFile.ts"],
      }),
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.message).toContain("kebab-case in 12/12");
  });

  it("MODAL CASE: a diff of only pre-existing corpus paths is judged by neither naming nor placement", async () => {
    const seed = seedJson([...KEBAB_CORPUS, "src/core/OldPascalThing.ts", "tests/a-case.test.ts"]);
    const result = await axiom6Conformance.run(
      fixture({ seed, changed: ["src/core/OldPascalThing.ts", "tests/a-case.test.ts"] }),
    );
    expect(result.findings).toEqual([]);
  });
});

describe("conformance/file-placement", () => {
  it("flags a kind sitting outside its prevailing location, citing the share and the scope", async () => {
    const tests = Array.from({ length: 11 }, (_, i) => `tests/case-${i + 1}.test.ts`);
    const ctx = fixture({
      seed: seedJson([...KEBAB_CORPUS, ...tests]),
      changed: ["src/stray-case.test.ts"],
    });
    const result = await axiom6Conformance.run(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: "conformance/file-placement",
      severity: "warning",
      enclosingSymbol: "test",
    });
    expect(result.findings[0]!.message).toContain(
      "`.test.` files under the repo root live in tests/ in 11/11",
    );
    expect(result.findings[0]!.message).toContain("sits in src/");
  });

  it("says nothing when the kind has too few corpus samples (FR-5)", async () => {
    const tests = Array.from({ length: MIN_SAMPLE - 1 }, (_, i) => `tests/case-${i + 1}.test.ts`);
    const ctx = fixture({
      seed: seedJson([...KEBAB_CORPUS, ...tests]),
      changed: ["src/stray-case.test.ts"],
    });
    expect((await axiom6Conformance.run(ctx)).findings).toEqual([]);
  });

  it("MONOREPO: judges against the nearest qualifying scope, not the (useless) first path segment", async () => {
    // Every source file's FIRST segment is `packages` in a workspace, so a
    // repo-wide top-segment vote can only ever confirm "sources live under
    // packages/" and never fire. The scope walk finds packages/core instead.
    const corpus = Array.from({ length: 12 }, (_, i) => `packages/core/src/thing-${i + 1}.ts`);
    const result = await axiom6Conformance.run(
      fixture({ seed: seedJson(corpus), changed: ["packages/core/scripts/helper-thing.ts"] }),
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.ruleId).toBe("conformance/file-placement");
    expect(result.findings[0]!.message).toContain(
      "plain source files under packages/core live in packages/core/src/ in 12/12",
    );
    expect(result.findings[0]!.message).toContain("sits in packages/core/scripts/");
  });

  it("a genuinely new top-level directory stays silent when no scope confirms a location", async () => {
    // Sources are split across src/ and lib/: the root qualifies on sample
    // but confirms nothing, so `tools/` is not "wrong", just new.
    const corpus = [
      ...Array.from({ length: 6 }, (_, i) => `src/thing-${i + 1}.ts`),
      ...Array.from({ length: 5 }, (_, i) => `lib/other-${i + 1}.ts`),
    ];
    const result = await axiom6Conformance.run(
      fixture({ seed: seedJson(corpus), changed: ["tools/build-thing.ts"] }),
    );
    expect(result.findings).toEqual([]);
  });

  it("covers the `.spec.` and `.config.` kinds, including the repo-root bucket", async () => {
    const specs = Array.from({ length: 11 }, (_, i) => `tests/case-${i + 1}.spec.ts`);
    const configs = Array.from({ length: 10 }, (_, i) => `thing-${i + 1}.config.ts`);
    const result = await axiom6Conformance.run(
      fixture({
        seed: seedJson([...KEBAB_CORPUS, ...specs, ...configs]),
        changed: ["src/stray-case.spec.ts", "src/deep/vite.config.ts"],
      }),
    );
    const messages = result.findings.map((f) => f.message);
    expect(result.findings.map((f) => f.location.file)).toEqual([
      "src/deep/vite.config.ts",
      "src/stray-case.spec.ts",
    ]);
    expect(messages[0]).toContain(
      "`.config.` files under the repo root live in the repo root in 10/10",
    );
    expect(messages[0]).toContain("sits in src/");
    expect(messages[1]).toContain("`.spec.` files under the repo root live in tests/ in 11/11");
  });
});

describe("conformance/module-shape", () => {
  /** 11 named-binding modules + one default-binding deviation, all real files
   * so the rule reads the REAL graph's per-edge imported names (1.10). */
  function shapeFiles(): Record<string, string> {
    const files: Record<string, string> = {};
    const imports: string[] = [];
    for (let i = 1; i <= 11; i += 1) {
      files[`src/core/thing-${i}.ts`] = `export const thing${i} = ${i};\n`;
      imports.push(`import { thing${i} } from "./thing-${i}.js";`);
    }
    files["src/core/index.ts"] = `${imports.join("\n")}\nexport const all = [${Array.from(
      { length: 11 },
      (_, i) => `thing${i + 1}`,
    ).join(", ")}];\n`;
    return files;
  }

  it("flags a file whose importers bind the minority form, citing both counts", async () => {
    const files = shapeFiles();
    files["src/core/odd-one.ts"] = "const value = 1;\nexport default value;\n";
    files["src/core/consumer.ts"] = 'import oddOne from "./odd-one.js";\nexport const used = oddOne;\n';
    const ctx = fixture({
      seed: seedJson([...Object.keys(files).filter((f) => !f.includes("odd-one"))]),
      changed: ["src/core/odd-one.ts"],
      files,
      tsconfig: true,
    });
    const result = await axiom6Conformance.run(ctx);
    expect(result.degraded).toEqual([]);
    const shape = result.findings.filter((f) => f.ruleId === "conformance/module-shape");
    expect(shape).toHaveLength(1);
    expect(shape[0]).toMatchObject({
      location: { file: "src/core/odd-one.ts", startLine: 1 },
      severity: "warning",
    });
    // File-level identity: no enclosingSymbol (rule + file discriminates).
    expect(shape[0]!.enclosingSymbol).toBeUndefined();
    expect(shape[0]!.message).toContain(
      "named bindings in 11/11 imported modules under src/core (0 of them use default)",
    );
  });

  it("ignores importers that are THEMSELVES in the diff — the change set cannot manufacture its own evidence", async () => {
    const files = shapeFiles();
    files["src/core/odd-one.ts"] = "const value = 1;\nexport default value;\n";
    files["src/core/consumer.ts"] = 'import oddOne from "./odd-one.js";\nexport const used = oddOne;\n';
    const ctx = fixture({
      seed: seedJson([...Object.keys(files).filter((f) => !f.includes("odd-one"))]),
      // The only importer of odd-one.ts is now part of the change set.
      changed: ["src/core/odd-one.ts", "src/core/consumer.ts"],
      files,
      tsconfig: true,
    });
    const result = await axiom6Conformance.run(ctx);
    expect(result.findings.filter((f) => f.ruleId === "conformance/module-shape")).toEqual([]);
  });

  it("says nothing about a changed file nothing imports — no importers, no evidence", async () => {
    const files = shapeFiles();
    files["src/core/lonely-one.ts"] = "const value = 1;\nexport default value;\n";
    const ctx = fixture({
      seed: seedJson(Object.keys(files).filter((f) => !f.includes("lonely-one"))),
      changed: ["src/core/lonely-one.ts"],
      files,
      tsconfig: true,
    });
    const result = await axiom6Conformance.run(ctx);
    expect(result.findings.filter((f) => f.ruleId === "conformance/module-shape")).toEqual([]);
  });

  it("says nothing about a file bound BOTH ways — ambiguous shape is no evidence", async () => {
    const files = shapeFiles();
    files["src/core/both-ways.ts"] =
      "export const named = 1;\nconst value = 2;\nexport default value;\n";
    files["src/core/consumer-a.ts"] =
      'import bothWays from "./both-ways.js";\nexport const a = bothWays;\n';
    files["src/core/consumer-b.ts"] =
      'import { named } from "./both-ways.js";\nexport const b = named;\n';
    const ctx = fixture({
      seed: seedJson(Object.keys(files).filter((f) => !f.includes("both-ways"))),
      changed: ["src/core/both-ways.ts"],
      files,
      tsconfig: true,
    });
    const result = await axiom6Conformance.run(ctx);
    expect(result.findings.filter((f) => f.ruleId === "conformance/module-shape")).toEqual([]);
  });

  it("uses the NEAREST qualifying scope — a components/ tree that genuinely uses default exports decides locally", async () => {
    const files = shapeFiles(); // src/core: 11 named-binding modules
    const imports: string[] = [];
    for (let i = 1; i <= 10; i += 1) {
      files[`src/components/widget-${i}.ts`] = `const widget${i} = ${i};\nexport default widget${i};\n`;
      imports.push(`import widget${i} from "./widget-${i}.js";`);
    }
    files["src/components/index.ts"] = `${imports.join("\n")}\nexport const widgets = [${Array.from(
      { length: 10 },
      (_, i) => `widget${i + 1}`,
    ).join(", ")}];\n`;
    // The deviation: a NAMED-binding module inside the default-shaped tree.
    files["src/components/odd-widget.ts"] = "export const oddWidget = 99;\n";
    files["src/components/odd-consumer.ts"] =
      'import { oddWidget } from "./odd-widget.js";\nexport const used = oddWidget;\n';
    const ctx = fixture({
      seed: seedJson(Object.keys(files).filter((f) => !f.includes("odd-widget"))),
      changed: ["src/components/odd-widget.ts"],
      files,
      tsconfig: true,
    });
    const result = await axiom6Conformance.run(ctx);
    const shape = result.findings.filter((f) => f.ruleId === "conformance/module-shape");
    expect(shape).toHaveLength(1);
    // Repo-wide the corpus is majority NAMED — only the local scope can have
    // produced this finding.
    expect(shape[0]!.message).toContain(
      "the corpus confirms default bindings in 10/10 imported modules under src/components",
    );
  });

  it("DECLARES that module shape did not run when there is no tsconfig", async () => {
    const result = await axiom6Conformance.run(
      fixture({ seed: seedJson(KEBAB_CORPUS), changed: ["src/core/my-new-file.ts"] }),
    );
    expect(result.findings).toEqual([]);
    expect(result.degraded).toEqual([NO_GRAPH]);
    expect(result.declaredOnly).toBeUndefined(); // a real degradation, not a declaration
  });
});

describe("the no_corpus inconclusive contract", () => {
  const changed = ["src/core/MyNewFile.ts"];

  async function reasonFor(options: FixtureOptions): Promise<string> {
    const result = await axiom6Conformance.run(fixture(options));
    expect(result.findings).toEqual([]);
    const declared = [...(result.declaredOnly ?? []), ...result.degraded];
    expect(declared).toHaveLength(1);
    const degradation = declared[0]!;
    expect(degradation.reason.startsWith(NO_CORPUS_PREFIX)).toBe(true);
    expect(degradation.subject).toBe("corpus-seed");
    return degradation.reason;
  }

  it("declares an ABSENT seed file as EXIT-NEUTRAL (the only carved-out case)", async () => {
    const result = await axiom6Conformance.run(fixture({ changed }));
    expect(result.degraded).toEqual([]);
    expect(result.declaredOnly).toHaveLength(1);
    expect(result.declaredOnly![0]!.reason).toContain("seed file absent");
    expect(result.declaredOnly![0]!.reason).toContain("guardrails init");
  });

  it("counts an UNREADABLE seed as a REAL degradation (a directory at the seed path — non-ENOENT)", async () => {
    const ctx = fixture({ changed });
    mkdirSync(path.join(ctx.repoRoot, STRUCTURAL_SEED_PATH), { recursive: true });
    const result = await axiom6Conformance.run(ctx);
    expect(result.findings).toEqual([]);
    expect(result.declaredOnly).toBeUndefined();
    expect(result.degraded[0]!.reason).toContain(`${NO_CORPUS_PREFIX}: seed unreadable:`);
    // First line only — no stack trace, no embedded newline.
    expect(result.degraded[0]!.reason).not.toContain("\n");
  });

  it("counts a TRUNCATED seed (unparseable JSON) as a REAL degradation, never crashing", async () => {
    expect(await reasonFor({ seed: '{ "schemaVersion": 1, "entities": [', changed })).toContain(
      "seed invalid: not parseable JSON",
    );
  });

  it("counts a SCHEMA-INVALID seed, naming the offending path", async () => {
    const reason = await reasonFor({
      seed: `${JSON.stringify({ schemaVersion: 2, entities: [], coverage: 1, degraded: [] })}\n`,
      changed,
    });
    expect(reason).toContain("seed invalid: schemaVersion");
  });

  it("counts an EMPTY corpus", async () => {
    expect(await reasonFor({ seed: seedJson([]), changed })).toContain(
      "the seed declares no entities",
    );
  });

  it("treats an externals-only corpus as empty — npm specifiers never vote", async () => {
    const reason = await reasonFor({
      seed: seedJson([], ["zod", "ts-morph", "vitest"]),
      changed,
    });
    expect(reason).toContain("no repo files remain after excluding externals");
  });

  it("rejects a seed whose entities repeat a path (a double vote) or use backslashes", async () => {
    const seedWith = (entities: { file: string; fanIn: number; external: boolean }[]) =>
      `${JSON.stringify({ schemaVersion: 1, entities, coverage: 1, degraded: [] })}\n`;
    expect(
      await reasonFor({
        seed: seedWith([
          { file: "src/a.ts", fanIn: 1, external: false },
          { file: "src/a.ts", fanIn: 1, external: false },
        ]),
        changed,
      }),
    ).toContain("duplicate entity file paths");
    expect(
      await reasonFor({
        seed: seedWith([{ file: "src\\a.ts", fanIn: 1, external: false }]),
        changed,
      }),
    ).toContain("`/`-separated");
  });

  it("rejects a seed claiming partial coverage with nothing degraded (the producer's own invariant)", async () => {
    const reason = await reasonFor({
      seed: `${JSON.stringify({
        schemaVersion: 1,
        entities: KEBAB_CORPUS.map((file) => ({ file, fanIn: 1, external: false })),
        coverage: 0.5,
        degraded: [],
      })}\n`,
      changed,
    });
    expect(reason).toContain("partial coverage requires at least one degraded entry");
  });

  it("does not read the corpus at all when there is nothing under review", async () => {
    const ctx: AnalyzerContext = {
      ...fixture({ changed: [] }),
      // Any read of the seed is a test failure: an absent seed is only
      // interesting when there IS a diff.
      get corpusSeed(): never {
        throw new Error("corpus seed read attempted");
      },
    };
    expect(await axiom6Conformance.run(ctx)).toEqual({ findings: [], degraded: [] });
  });
});

describe("a partial corpus census", () => {
  it("declares the partial coverage as a REAL degradation and still measures what it has", async () => {
    const seed = `${JSON.stringify({
      schemaVersion: 1,
      entities: KEBAB_CORPUS.map((file) => ({ file, fanIn: 1, external: false })),
      coverage: 0.5,
      degraded: [{ reason: "unresolved import", subject: "src/core/thing-1.ts" }],
    })}\n`;
    const result = await axiom6Conformance.run(
      fixture({ seed, changed: ["src/core/MyNewFile.ts"] }),
    );
    expect(result.findings).toHaveLength(1);
    expect(result.declaredOnly).toBeUndefined();
    expect(result.degraded).toContainEqual({
      reason:
        "corpus partial: the structural seed covered 50.0% of its import attempts — conventions were measured on a partial census",
      subject: "corpus-seed",
    });
  });
});

describe("seed degradation propagation", () => {
  it("surfaces producer degradation even when coverage is full", async () => {
    const marker = { reason: "fallback parser used", subject: "src/core/thing-1.ts" };
    const seed = `${JSON.stringify({
      schemaVersion: 1,
      entities: KEBAB_CORPUS.map((file) => ({ file, fanIn: 1, external: false })),
      coverage: 1,
      degraded: [marker],
    })}\n`;
    const result = await axiom6Conformance.run(
      fixture({ seed, changed: ["src/core/MyNewFile.ts"] }),
    );
    expect(result.degraded).toContainEqual(marker);
  });
});

describe("determinism", () => {
  it("identical input yields byte-identical findings", async () => {
    const build = () =>
      fixture({
        seed: seedJson([...KEBAB_CORPUS, ...Array.from({ length: 11 }, (_, i) => `tests/case-${i + 1}.test.ts`)]),
        changed: ["src/core/MyNewFile.ts", "src/stray-case.test.ts"],
      });
    const first = await axiom6Conformance.run(build());
    const second = await axiom6Conformance.run(build());
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.findings.map((f) => `${f.location.file} ${f.ruleId}`)).toEqual([
      "src/core/MyNewFile.ts conformance/naming-convention",
      "src/stray-case.test.ts conformance/file-placement",
    ]);
  });
});
