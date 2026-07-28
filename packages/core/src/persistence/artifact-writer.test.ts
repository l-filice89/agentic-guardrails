import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { fsPath } from "../git/worktree.js";
import {
  InvalidScopeError,
  pruneScopeDir,
  writeFileAtomic,
  writeReviewArtifact,
} from "./artifact-writer.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-writer-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("writeReviewArtifact", () => {
  it("creates the minimal reviews/<scope> tree on demand and writes verbatim", () => {
    const root = tempDir();
    const finalPath = writeReviewArtifact({
      repoRoot: root,
      scope: "uncommitted",
      runId: "abc123",
      json: '{"x":1}\n',
    });
    expect(finalPath).toBe(
      path.join(root, "_agentic-guardrails", "reviews", "uncommitted", "abc123.json"),
    );
    expect(readFileSync(finalPath, "utf8")).toBe('{"x":1}\n');
  });

  it("leaves no temp file behind (rename-only visibility)", () => {
    const root = tempDir();
    const finalPath = writeReviewArtifact({
      repoRoot: root,
      scope: "uncommitted",
      runId: "abc123",
      json: "{}\n",
    });
    const entries = readdirSync(path.dirname(finalPath));
    expect(entries).toEqual(["abc123.json"]);
  });

  it("overwrites an existing artifact even with a stale .tmp lying around", () => {
    const root = tempDir();
    const dir = path.join(root, "_agentic-guardrails", "reviews", "uncommitted");
    // First write, then simulate an interrupted run's stale temp file.
    writeReviewArtifact({ repoRoot: root, scope: "uncommitted", runId: "r1", json: "old\n" });
    writeFileSync(path.join(dir, "r1.json.999.dead.tmp"), "torn");
    const finalPath = writeReviewArtifact({
      repoRoot: root,
      scope: "uncommitted",
      runId: "r1",
      json: "new\n",
    });
    expect(readFileSync(finalPath, "utf8")).toBe("new\n");
    // The writer's own unique temp file is gone; the fabricated stale one is
    // inert (temp names are unique per write, never reused).
    const tmps = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(tmps).toEqual(["r1.json.999.dead.tmp"]);
  });

  it("rejects an unsafe scope segment with a typed error before any I/O", () => {
    const root = tempDir();
    expect(() =>
      writeReviewArtifact({ repoRoot: root, scope: "../evil", runId: "r1", json: "{}\n" }),
    ).toThrow(InvalidScopeError);
    expect(existsSync(path.join(root, "_agentic-guardrails"))).toBe(false);
  });

  it("ensures _agentic-guardrails/.gitignore covers generated layers, preserving an existing file", () => {
    const root = tempDir();
    writeReviewArtifact({ repoRoot: root, scope: "uncommitted", runId: "r1", json: "{}\n" });
    const gitignorePath = path.join(root, "_agentic-guardrails", ".gitignore");
    const content = readFileSync(gitignorePath, "utf8");
    expect(content).toContain("reviews/");
    expect(content).toContain(".cache/");
    expect(content).toContain("config.schema.json");

    // An existing .gitignore is user territory — user content is preserved,
    // but MISSING seeded lines are appended (a stale pre-1.7 file must not
    // leave .cache/ committable).
    writeFileSync(gitignorePath, "# custom\nreviews/\n");
    writeReviewArtifact({ repoRoot: root, scope: "uncommitted", runId: "r2", json: "{}\n" });
    expect(readFileSync(gitignorePath, "utf8")).toBe(
      "# custom\nreviews/\n.cache/\nconfig.schema.json\n",
    );

    // A complete file is left byte-identical.
    const complete = readFileSync(gitignorePath, "utf8");
    writeReviewArtifact({ repoRoot: root, scope: "uncommitted", runId: "r3", json: "{}\n" });
    expect(readFileSync(gitignorePath, "utf8")).toBe(complete);
  });
});

describe("long paths (SPIKE-5 item 11)", () => {
  it("writes an artifact whose final path crosses Win32's MAX_PATH", () => {
    // A deep repo plus `_agentic-guardrails/reviews/<slug>/<runId>.json` is
    // exactly how a review path crosses 260 chars — and the write happens
    // AFTER the whole analysis has been paid for. `fsPath` (`\\?\`) is what
    // makes it survive.
    //
    // HONEST SCOPE: this case is only DISCRIMINATING on a Windows machine
    // where MAX_PATH still applies — on POSIX (PATH_MAX 4096) and on Windows
    // with `LongPathsEnabled=1` it passes with or without the prefixing. It
    // is a regression guard for the environment SPIKE-5 measured, not a proof
    // that prefixing works; the measured cliff lives in
    // `scripts/spike-5-worktree-lifecycle.mjs`.
    const root = path.join(tempDir(), "d".repeat(120), "e".repeat(120));
    mkdirSync(fsPath(root), { recursive: true });
    const scope = `branch-${"s".repeat(48)}-0badc0de`;
    const finalPath = writeReviewArtifact({
      repoRoot: root,
      scope,
      runId: "0123456789abcdef",
      json: '{"x":1}\n',
    });
    expect(finalPath.length).toBeGreaterThan(260);
    expect(readFileSync(fsPath(finalPath), "utf8")).toBe('{"x":1}\n');
  });
});

describe("writeFileAtomic", () => {
  it("cleans up its temp file when the rename fails, and rethrows", () => {
    const root = tempDir();
    // The final path is an existing non-empty DIRECTORY: rename must fail.
    const finalPath = path.join(root, "target");
    mkdirSync(path.join(finalPath, "occupied"), { recursive: true });
    expect(() => writeFileAtomic(finalPath, "content\n")).toThrow();
    expect(readdirSync(root).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

/**
 * Any `/^[a-z][…]*$/` scope-segment regex literal. Deliberately loose in the
 * character class: the copy most likely to be reintroduced is the PRE-1.15
 * one (`/^[a-z][a-z-]*$/`, no digits), and a scan that only matched the
 * current spelling would miss exactly the drift it exists to catch.
 */
const SCOPE_REGEX_LITERAL = /\/\^\[a-z]\[[^\]]*]\*\$\//;

describe("SCOPE_PATTERN de-duplication (1.15)", () => {
  it("has exactly ONE definition across the repository, and the writer uses it", () => {
    // The pattern is the traversal guard on a directory name derived from
    // untrusted ref text. Two copies mean two answers to "is this safe" — so
    // the source itself is scanned: this test fails the moment a second
    // literal appears anywhere in the repo (not just under packages/).
    const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
    const definitions: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          if (entry.name.startsWith("dist")) continue;
          walk(target);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          if (SCOPE_REGEX_LITERAL.test(readFileSync(target, "utf8"))) definitions.push(target);
        }
      }
    };
    walk(repoRoot);
    expect(definitions.map((file) => path.basename(file))).toEqual(["review-artifact.ts"]);

    // The guard bites on the pre-1.15 spelling too — the one a careless
    // revert would bring back.
    expect(SCOPE_REGEX_LITERAL.test("export const X = /^[a-z][a-z-]*$/;")).toBe(true);
    expect(SCOPE_REGEX_LITERAL.test("export const X = /^[a-z][a-z0-9-]*$/;")).toBe(true);

    // …and the writer enforces exactly that pattern, digits included (pr-42).
    expect(() => writeReviewArtifact({ ...validOptions(), scope: "pr-42" })).not.toThrow();
    for (const scope of ["../escape", "Upper", "with.dot", "reviews/nested", "9lives"]) {
      expect(() => writeReviewArtifact({ ...validOptions(), scope })).toThrow(InvalidScopeError);
    }
  });
});

function validOptions(): { repoRoot: string; scope: string; runId: string; json: string } {
  return { repoRoot: tempDir(), scope: "uncommitted", runId: "0123456789abcdef", json: "{}\n" };
}

describe("per-run artifact retention (1.16)", () => {
  it("prunes a scope directory to the newest N and NEVER touches history", () => {
    const repoRoot = tempDir();
    const dir = path.join(repoRoot, "_agentic-guardrails", "reviews", "uncommitted");
    mkdirSync(dir, { recursive: true });
    // Distinct mtimes so "newest" is unambiguous; the filename tiebreak is
    // asserted separately below.
    for (let i = 0; i < 5; i++) {
      const file = path.join(dir, `run${i}.json`);
      writeFileSync(file, "{}\n");
      utimesSync(file, new Date(1_700_000_000_000 + i * 1000), new Date(1_700_000_000_000 + i * 1000));
    }
    // Committed history lives elsewhere and must survive untouched.
    const history = path.join(repoRoot, "_agentic-guardrails", "history");
    mkdirSync(history, { recursive: true });
    writeFileSync(path.join(history, "trends.jsonl"), '{"recordId":"a"}\n');

    writeReviewArtifact({ repoRoot, scope: "uncommitted", runId: "ffffffffffffffff", json: "{}\n", maxEntries: 3 });
    const kept = readdirSync(dir).sort();
    expect(kept).toHaveLength(3);
    // The just-written artifact is the newest and always survives.
    expect(kept).toContain("ffffffffffffffff.json");
    expect(kept).toContain("run4.json");
    expect(kept).not.toContain("run0.json");
    expect(existsSync(path.join(history, "trends.jsonl"))).toBe(true);
  });

  it("breaks an mtime TIE by filename so pruning stays deterministic", () => {
    const repoRoot = tempDir();
    const dir = path.join(repoRoot, "_agentic-guardrails", "reviews", "uncommitted");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date(1_700_000_000_000);
    for (const name of ["a.json", "b.json", "c.json"]) {
      const file = path.join(dir, name);
      writeFileSync(file, "{}\n");
      utimesSync(file, stamp, stamp);
    }
    pruneScopeDir(dir, 2);
    // Same mtime everywhere → the name decides, newest-first: a, b kept.
    expect(readdirSync(dir).sort()).toEqual(["a.json", "b.json"]);
  });

  it("omitting maxEntries prunes nothing — retention is opt-in from config", () => {
    const repoRoot = tempDir();
    const dir = path.join(repoRoot, "_agentic-guardrails", "reviews", "uncommitted");
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 4; i++) writeFileSync(path.join(dir, `run${i}.json`), "{}\n");
    writeReviewArtifact({ repoRoot, scope: "uncommitted", runId: "ffffffffffffffff", json: "{}\n" });
    expect(readdirSync(dir)).toHaveLength(5);
  });

  it("an unreadable directory never fails a review that already completed", () => {
    expect(() => pruneScopeDir(path.join(tempDir(), "nope"), 1)).not.toThrow();
  });

  it("still prunes when ONE entry vanishes between readdir and stat", () => {
    // A concurrent run or antivirus removing a file mid-prune used to throw
    // out of the whole loop — the prune was skipped SILENTLY while the store
    // kept growing.
    const dir = tempDir();
    for (const name of ["a.json", "b.json", "c.json", "d.json"]) {
      writeFileSync(path.join(dir, name), "{}\n");
    }
    pruneScopeDir(dir, 2, (file) => {
      if (file.endsWith("c.json")) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return 0; // same mtime everywhere → the filename decides
    });
    // The vanished entry is simply not a candidate, and the prune still ran:
    // a, b (newest by name) survive, d is pruned, c was never a candidate.
    expect(readdirSync(dir).sort()).toEqual(["a.json", "b.json", "c.json"]);
  });
});
