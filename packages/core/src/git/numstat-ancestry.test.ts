/**
 * Story 1.16's two new git primitives: the `--numstat -z` change-size parser
 * (the OD-1 denominator) and the `--is-ancestor` wrapper whose exit 1 is an
 * ANSWER rather than an error.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  changedLinesIn,
  commitExists,
  diffNumstat,
  isAncestor,
  numstatAgainstHead,
  parseNumstatZ,
  untrackedFiles,
} from "./git.js";

// Real git process startup is heavily contended in the full parallel suite.
vi.setConfig({ testTimeout: 30_000 });

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-numstat-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, shell: false, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

function initRepo(): string {
  const dir = tempDir();
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("parseNumstatZ — the format `parseNameStatusZ` cannot read", () => {
  it("counts a plain entry", () => {
    expect(parseNumstatZ("3\t2\tsrc/a.ts\0")).toEqual({
      files: [{ path: "src/a.ts", added: 3, deleted: 2 }],
      binaryFiles: [],
    });
  });

  it("attributes a RENAME's counts to the destination and consumes both path tokens", () => {
    // `<add>\t<del>\t\0<old>\0<new>\0` — the extra token is what makes a
    // name-status parser mis-read this format entirely.
    const parsed = parseNumstatZ("1\t0\t\0old.ts\0new.ts\0" + "4\t1\tafter.ts\0");
    expect(parsed).toEqual({
      files: [
        { path: "after.ts", added: 4, deleted: 1 },
        { path: "new.ts", added: 1, deleted: 0 },
      ],
      binaryFiles: [],
    });
  });

  it("declares a BINARY file instead of silently counting it as 0 lines", () => {
    const parsed = parseNumstatZ("-\t-\tlogo.png\0" + "2\t0\tsrc/a.ts\0");
    expect(parsed).toEqual({
      files: [{ path: "src/a.ts", added: 2, deleted: 0 }],
      binaryFiles: ["logo.png"],
    });
  });

  it("treats a non-integer count as uncountable, never as zero", () => {
    // A count nobody can parse must not shrink the denominator (which would
    // silently INFLATE the score).
    expect(parseNumstatZ("x\t1\tweird.ts\0").binaryFiles).toEqual(["weird.ts"]);
  });

  it("is empty for an empty diff", () => {
    expect(parseNumstatZ("")).toEqual({ files: [], binaryFiles: [] });
  });

  it("keeps paths with spaces, tabs, quotes and non-ASCII intact", () => {
    // The parser slices at the FIRST TWO tabs and takes the rest as the path.
    // A `split("\t")` rewrite would look equivalent and silently truncate
    // every path below, so this pins the property rather than the code.
    const paths = ["dir with spaces/a b.ts", "tabbed\tname.ts", 'quo"te.ts', "naïve/日本.ts"];
    const parsed = parseNumstatZ(paths.map((p) => `1\t1\t${p}\0`).join(""));
    expect(parsed.files.map((f) => f.path).sort()).toEqual([...paths].sort());
    expect(changedLinesIn(parsed, () => true)).toBe(paths.length * 2);
  });

  it("EXCLUDES the engine's own output from the summed denominator", () => {
    // Every run appends a line to the committed `history/trends.jsonl`. Summing
    // the whole diff grew the OD-1 denominator by one line per run forever,
    // silently raising every later score — worst exactly where the 0.1 floor
    // matters. The sum is path-filtered, and there is no unfiltered total to
    // reach for by accident.
    const parsed = parseNumstatZ(
      "5\t0\tsrc/a.ts\0" + "1\t0\t_agentic-guardrails/history/trends.jsonl\0",
    );
    expect(changedLinesIn(parsed, (f) => !f.startsWith("_agentic-guardrails/"))).toBe(5);
  });
});

describe("change-size measurement against a real repo", () => {
  it("measures a ref range, a rename and a binary file the way git reports them", () => {
    const repo = initRepo();
    writeFileSync(path.join(repo, "a.txt"), "1\n2\n3\n");
    writeFileSync(path.join(repo, "b.bin"), Buffer.from([0, 1, 2, 3]));
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "one"]);
    const base = git(repo, ["rev-parse", "HEAD"]).trim();

    git(repo, ["mv", "a.txt", "c.txt"]);
    writeFileSync(path.join(repo, "c.txt"), "1\n2\n3\n4\n");
    writeFileSync(path.join(repo, "b.bin"), Buffer.from([9, 9, 9, 9, 9]));
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "two"]);
    const head = git(repo, ["rev-parse", "HEAD"]).trim();

    const measured = diffNumstat(repo, base, head);
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    expect(changedLinesIn(measured.value, () => true)).toBe(1);
    expect(measured.value.files).toEqual([{ path: "c.txt", added: 1, deleted: 0 }]);
    expect(measured.value.binaryFiles).toEqual(["b.bin"]);
  });

  it("measures tracked working-tree edits and lists untracked files separately", () => {
    const repo = initRepo();
    writeFileSync(path.join(repo, "a.txt"), "1\n2\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "one"]);
    writeFileSync(path.join(repo, "a.txt"), "1\n2\n3\n");
    writeFileSync(path.join(repo, "fresh.txt"), "x\ny\n");

    const tracked = numstatAgainstHead(repo);
    expect(tracked.ok).toBe(true);
    if (tracked.ok) expect(changedLinesIn(tracked.value, () => true)).toBe(1);
    // The untracked half is invisible to any diff against HEAD, which is
    // exactly why the uncommitted scope counts it separately.
    const untracked = untrackedFiles(repo);
    expect(untracked.ok).toBe(true);
    if (untracked.ok) expect(untracked.value).toEqual(["fresh.txt"]);
  });
});

describe("isAncestor — exit 1 is an ANSWER, not an error", () => {
  it("answers true, false and errors only on a genuinely broken query", () => {
    const repo = initRepo();
    writeFileSync(path.join(repo, "a.txt"), "1\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "one"]);
    const first = git(repo, ["rev-parse", "HEAD"]).trim();
    writeFileSync(path.join(repo, "a.txt"), "2\n");
    git(repo, ["commit", "-am", "two"]);
    const second = git(repo, ["rev-parse", "HEAD"]).trim();

    const yes = isAncestor(repo, first, second);
    expect(yes).toEqual({ ok: true, value: true });
    // THE regression this helper exists for: git exits 1 here. Routed through
    // the ordinary `git()` wrapper it would read as a failure and the
    // aggregator would cold-start on a perfectly healthy repository.
    const no = isAncestor(repo, second, first);
    expect(no).toEqual({ ok: true, value: false });
    // A commit is its own ancestor — the comparison two uncommitted-scope
    // runs at one commit depend on.
    expect(isAncestor(repo, first, first)).toEqual({ ok: true, value: true });

    const missing = isAncestor(repo, "0".repeat(40), second);
    expect(missing.ok).toBe(false);
  });

  it("commitExists separates a sha that is gone from one that is present", () => {
    const repo = initRepo();
    writeFileSync(path.join(repo, "a.txt"), "1\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "one"]);
    const head = git(repo, ["rev-parse", "HEAD"]).trim();
    expect(commitExists(repo, head)).toBe(true);
    expect(commitExists(repo, "0".repeat(40))).toBe(false);
    // An option-shaped "sha" never reaches a spawn.
    expect(commitExists(repo, "--upload-pack=touch")).toBe(false);
  });
});
