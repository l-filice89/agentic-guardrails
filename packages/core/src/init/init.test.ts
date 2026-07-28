import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { configSchema, conventionsFileSchema, corpusMapFileSchema } from "@agentic-guardrails/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";

import { DEFAULT_CONFIG_YAML } from "../config/config-loader.js";
import { CONVENTIONS_YAML, CORPUS_MAP_YAML, runInit, type InitIo } from "./init.js";
import { checkGitWiring, GITATTRIBUTES_UNION_LINE } from "./wiring.js";

// git spawns + ts-morph seed builds legitimately exceed the 5s default
// under full-suite parallel load.
vi.setConfig({ testTimeout: 60_000 });

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-init-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, shell: false, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

/** Git repo with a tiny committed TS project (src/a.ts → src/b.ts). */
function makeRepo(): string {
  const dir = tempDir();
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
      },
      include: ["src"],
    }),
  );
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src", "a.ts"), 'import { b } from "./b.js";\nexport const a = b;\n');
  writeFileSync(path.join(dir, "src", "b.ts"), "export const b = 1;\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "base"]);
  return dir;
}

function out(dir: string, name: string): string {
  return path.join(dir, "_agentic-guardrails", name);
}

/** Scripted questionnaire answers, consumed in order; "" past the end. */
function scriptedIo(answers: string[]): InitIo {
  return { question: async () => answers.shift() ?? "" };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("runInit — fresh bootstrap", () => {
  it("creates all files with defaults (--no-input), contracts-valid, seed built", async () => {
    const dir = makeRepo();
    const result = await runInit({ cwd: dir, noInput: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toEqual([
      "_agentic-guardrails/config.yaml",
      "_agentic-guardrails/conventions.yaml",
      "_agentic-guardrails/corpus-map.yaml",
      "_agentic-guardrails/history/trends.jsonl",
      "_agentic-guardrails/history/dispositions.jsonl",
      "_agentic-guardrails/.gitattributes",
      "_agentic-guardrails/.gitignore",
    ]);
    expect(result.updated).toEqual([]);
    expect(result.kept).toEqual([]);
    expect(result.warnings).toEqual([]);
    // config.yaml is the 1.6 constant (delegation honored).
    expect(readFileSync(out(dir, "config.yaml"), "utf8")).toBe(DEFAULT_CONFIG_YAML);
    // Empty-but-valid is machine-checkable through the contracts schemas.
    expect(
      conventionsFileSchema.safeParse(parseYaml(readFileSync(out(dir, "conventions.yaml"), "utf8")))
        .success,
    ).toBe(true);
    expect(
      corpusMapFileSchema.safeParse(parseYaml(readFileSync(out(dir, "corpus-map.yaml"), "utf8")))
        .success,
    ).toBe(true);
    // Git wiring seeded — the preflight check is green.
    expect(readFileSync(out(dir, ".gitattributes"), "utf8")).toContain(GITATTRIBUTES_UNION_LINE);
    expect(readFileSync(out(dir, ".gitignore"), "utf8")).toContain(".cache/");
    expect(checkGitWiring(dir)).toEqual([]);
    // Seed: sorted file-level {file, fanIn} entries from the import graph.
    expect(result.seed).toEqual({
      written: true,
      path: "_agentic-guardrails/.cache/corpus/structural-seed.json",
    });
    const seed = JSON.parse(
      readFileSync(path.join(dir, "_agentic-guardrails", ".cache", "corpus", "structural-seed.json"), "utf8"),
    ) as { entities: { file: string; fanIn: number; external: boolean }[]; coverage: number };
    expect(seed.entities).toEqual([
      { file: "src/a.ts", fanIn: 0, external: false },
      { file: "src/b.ts", fanIn: 1, external: false },
    ]);
    expect(seed.coverage).toBe(1);
  });

  it("fails typed outside a git repo, naming the requirement, with no partial writes", async () => {
    const dir = tempDir();
    const result = await runInit({ cwd: dir, noInput: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("not a git repository");
    expect(result.message).toContain("git init");
    expect(existsSync(path.join(dir, "_agentic-guardrails"))).toBe(false);
  });

  it("succeeds without a tsconfig; the seed is skipped with a declared reason", async () => {
    const dir = makeRepo();
    unlinkSync(path.join(dir, "tsconfig.json"));
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "drop tsconfig"]);
    const result = await runInit({ cwd: dir, noInput: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seed).toEqual({ written: false, reason: "root tsconfig.json not found" });
    expect(result.created).toContain("_agentic-guardrails/config.yaml");
  });
});

describe("runInit — never-clobber (idempotent re-run)", () => {
  it("HAZARD: a human-edited config.yaml survives re-init byte-identical, reported kept", async () => {
    const dir = makeRepo();
    expect((await runInit({ cwd: dir, noInput: true })).ok).toBe(true);
    const humanEdited =
      "# my hand-tuned config — do not touch\naxioms:\n  '1':\n    enforcement: advisory\n";
    writeFileSync(out(dir, "config.yaml"), humanEdited);
    const rerun = await runInit({ cwd: dir, noInput: true });
    expect(rerun.ok).toBe(true);
    if (!rerun.ok) return;
    expect(readFileSync(out(dir, "config.yaml"), "utf8")).toBe(humanEdited);
    expect(rerun.created).toEqual([]);
    expect(rerun.updated).toEqual([]);
    expect(rerun.kept).toEqual([
      "_agentic-guardrails/config.yaml",
      "_agentic-guardrails/conventions.yaml",
      "_agentic-guardrails/corpus-map.yaml",
      "_agentic-guardrails/history/trends.jsonl",
      "_agentic-guardrails/history/dispositions.jsonl",
      "_agentic-guardrails/.gitattributes",
      "_agentic-guardrails/.gitignore",
    ]);
    // The seed is a regenerable derivation — regenerated, byte-identical.
    const seedPath = path.join(dir, "_agentic-guardrails", ".cache", "corpus", "structural-seed.json");
    expect(existsSync(seedPath)).toBe(true);
  });

  it("BYPASS: a partial folder gets only its missing files created; existing ones kept", async () => {
    const dir = makeRepo();
    expect((await runInit({ cwd: dir, noInput: true })).ok).toBe(true);
    unlinkSync(out(dir, "conventions.yaml"));
    unlinkSync(out(dir, ".gitattributes"));
    const rerun = await runInit({ cwd: dir, noInput: true });
    expect(rerun.ok).toBe(true);
    if (!rerun.ok) return;
    expect(rerun.created).toEqual([
      "_agentic-guardrails/conventions.yaml",
      "_agentic-guardrails/.gitattributes",
    ]);
    expect(rerun.kept).toContain("_agentic-guardrails/config.yaml");
    expect(readFileSync(out(dir, "conventions.yaml"), "utf8")).toBe(CONVENTIONS_YAML);
    expect(readFileSync(out(dir, "corpus-map.yaml"), "utf8")).toBe(CORPUS_MAP_YAML);
  });

  it("BYPASS: an edited wiring file keeps user content verbatim, missing lines appended, reported updated", async () => {
    const dir = makeRepo();
    expect((await runInit({ cwd: dir, noInput: true })).ok).toBe(true);
    writeFileSync(out(dir, ".gitignore"), "# mine\nreviews/\n");
    const rerun = await runInit({ cwd: dir, noInput: true });
    expect(rerun.ok).toBe(true);
    if (!rerun.ok) return;
    expect(readFileSync(out(dir, ".gitignore"), "utf8")).toBe(
      "# mine\nreviews/\n.cache/\nconfig.schema.json\n",
    );
    // The appended file is "updated", not "kept" — the summary tells the truth.
    expect(rerun.updated).toEqual(["_agentic-guardrails/.gitignore"]);
    expect(rerun.kept).not.toContain("_agentic-guardrails/.gitignore");
  });

  it("a CRLF wiring file gets its appended lines in CRLF too (existing EOL style wins)", async () => {
    const dir = makeRepo();
    expect((await runInit({ cwd: dir, noInput: true })).ok).toBe(true);
    writeFileSync(out(dir, ".gitignore"), "# mine\r\nreviews/\r\n");
    const rerun = await runInit({ cwd: dir, noInput: true });
    expect(rerun.ok).toBe(true);
    expect(readFileSync(out(dir, ".gitignore"), "utf8")).toBe(
      "# mine\r\nreviews/\r\n.cache/\r\nconfig.schema.json\r\n",
    );
  });

  it("HAZARD: a seed WRITE failure is a typed failure (exit 2 path) that still reports created files", async () => {
    const dir = makeRepo();
    // A plain FILE at `.cache` makes mkdir/write under it fail.
    mkdirSync(path.join(dir, "_agentic-guardrails"));
    writeFileSync(out(dir, ".cache"), "not a directory\n");
    const result = await runInit({ cwd: dir, noInput: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("write failed for _agentic-guardrails/.cache/corpus/structural-seed.json");
    // Files written before the failure still reach the caller.
    expect(result.created).toContain("_agentic-guardrails/config.yaml");
    expect(result.created).toContain("_agentic-guardrails/conventions.yaml");
  });

  it("warns (still exit 0) when an existing config.yaml is contracts-invalid", async () => {
    const dir = makeRepo();
    mkdirSync(path.join(dir, "_agentic-guardrails"));
    writeFileSync(out(dir, "config.yaml"), "axioms:\n  '1':\n    enforcement: warn\n");
    const result = await runInit({ cwd: dir, noInput: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kept).toContain("_agentic-guardrails/config.yaml");
    expect(result.warnings.join("\n")).toContain(
      "existing config.yaml is invalid — review will exit 2",
    );
  });
});

describe("checkGitWiring (preflight predicate)", () => {
  it("stays silent for a folder WITHOUT init markers (the artifact writer auto-creates it)", () => {
    const dir = makeRepo();
    // Simulate 1.4's on-demand layout: folder + .gitignore, no markers.
    mkdirSync(path.join(dir, "_agentic-guardrails"));
    writeFileSync(out(dir, ".gitignore"), "reviews/\n");
    expect(checkGitWiring(dir)).toEqual([]);
  });

  it("stays silent when _agentic-guardrails exists as a plain FILE", () => {
    const dir = makeRepo();
    writeFileSync(path.join(dir, "_agentic-guardrails"), "not a directory\n");
    expect(checkGitWiring(dir)).toEqual([]);
  });

  it("each missing seeded .gitignore line gets its own warning naming its consequence", async () => {
    const dir = makeRepo();
    expect((await runInit({ cwd: dir, noInput: true })).ok).toBe(true);
    writeFileSync(out(dir, ".gitignore"), ".cache/\nconfig.schema.json\n");
    expect(checkGitWiring(dir)).toEqual([
      '_agentic-guardrails/.gitignore is missing "reviews/" — review artifacts may be committed (run `guardrails init`)',
    ]);
    writeFileSync(out(dir, ".gitignore"), "reviews/\n.cache/\n");
    expect(checkGitWiring(dir)).toEqual([
      '_agentic-guardrails/.gitignore is missing "config.schema.json" — the generated schema file may be committed (run `guardrails init`)',
    ]);
  });
});

describe("runInit — questionnaire (answer → yaml mapping)", () => {
  it("maps answers to config.yaml entries sourced from contracts enum values", async () => {
    const dir = makeRepo();
    // Axiom order is ["1", "3", "4", "5", "6"]: axiom 1 → advisory (no
    // maxFindings asked); axioms 3 and 4 → all-default (blocking + default
    // maxFindings, two prompts each); axiom 5 → blocking with maxFindings 2;
    // axiom 6 → unanswered, so all-default (the script runs dry and every
    // remaining prompt reads as empty).
    const io = scriptedIo(["advisory", "", "", "", "", "blocking", "2"]);
    const result = await runInit({ cwd: dir, noInput: false, io });
    expect(result.ok).toBe(true);
    const text = readFileSync(out(dir, "config.yaml"), "utf8");
    expect(text.startsWith("# yaml-language-server: $schema=./config.schema.json\n")).toBe(true);
    const parsed = configSchema.safeParse(parseYaml(text));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.axioms["1"]).toEqual({ enforcement: "advisory" });
    expect(parsed.data?.axioms["5"]).toEqual({ enforcement: "blocking", maxFindings: 2 });
  });

  it("all-default answers write exactly the documented default bytes", async () => {
    const dir = makeRepo();
    const result = await runInit({ cwd: dir, noInput: false, io: scriptedIo([]) });
    expect(result.ok).toBe(true);
    expect(readFileSync(out(dir, "config.yaml"), "utf8")).toBe(DEFAULT_CONFIG_YAML);
  });

  it("a digits-but-unsafe-integer maxFindings answer warns and defaults instead of failing", async () => {
    const dir = makeRepo();
    const huge = "9".repeat(30); // digits, but >= 2^53
    const result = await runInit({ cwd: dir, noInput: false, io: scriptedIo(["", huge]) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join("\n")).toContain(`unrecognized maxFindings "${huge}" for axiom 1`);
    expect(readFileSync(out(dir, "config.yaml"), "utf8")).toBe(DEFAULT_CONFIG_YAML);
  });

  it("an unrecognized answer falls back to the default with a warning — never blocks", async () => {
    const dir = makeRepo();
    const result = await runInit({ cwd: dir, noInput: false, io: scriptedIo(["warn"]) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join("\n")).toContain('unrecognized answer "warn" for axiom 1');
    expect(readFileSync(out(dir, "config.yaml"), "utf8")).toBe(DEFAULT_CONFIG_YAML);
  });

  it("an existing config.yaml skips the questionnaire entirely (kept, no prompts)", async () => {
    const dir = makeRepo();
    expect((await runInit({ cwd: dir, noInput: true })).ok).toBe(true);
    let asked = 0;
    const io: InitIo = {
      question: async () => {
        asked += 1;
        return "";
      },
    };
    const rerun = await runInit({ cwd: dir, noInput: false, io });
    expect(rerun.ok).toBe(true);
    expect(asked).toBe(0);
  });
});
