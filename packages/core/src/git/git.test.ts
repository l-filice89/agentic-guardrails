import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  fileGitStatus,
  headSha,
  isRepo,
  parsePorcelainZ,
  repoRoot,
  uncommittedFiles,
  EMPTY_TREE_SHA,
} from "./git.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-git-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, shell: false, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function initRepo(dir: string): void {
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("git wrapper outside a repo", () => {
  it("isRepo is false and queries return typed errors, never throws", () => {
    const dir = tempDir();
    expect(isRepo(dir)).toBe(false);
    const root = repoRoot(dir);
    expect(root.ok).toBe(false);
    if (!root.ok) expect(root.kind).toBe("not-a-repo");
    const files = uncommittedFiles(dir);
    // `git status` in a non-repo exits non-zero → typed error result.
    expect(files.ok).toBe(false);
    if (!files.ok) expect(files.reason.length).toBeGreaterThan(0);
  });
});

describe("git wrapper inside a repo", () => {
  it("lists staged + unstaged + untracked files, sorted, /-separated", () => {
    const dir = tempDir();
    initRepo(dir);
    writeFileSync(path.join(dir, "committed.txt"), "v1\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "base"]);

    writeFileSync(path.join(dir, "committed.txt"), "v2\n"); // unstaged edit
    writeFileSync(path.join(dir, "staged.txt"), "s\n");
    git(dir, ["add", "staged.txt"]);
    writeFileSync(path.join(dir, "untracked.txt"), "u\n");

    expect(isRepo(dir)).toBe(true);
    const files = uncommittedFiles(dir);
    expect(files).toEqual({
      ok: true,
      value: ["committed.txt", "staged.txt", "untracked.txt"],
    });
  });

  it("clean tree yields an empty change set", () => {
    const dir = tempDir();
    initRepo(dir);
    writeFileSync(path.join(dir, "a.txt"), "a\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "base"]);
    expect(uncommittedFiles(dir)).toEqual({ ok: true, value: [] });
  });

  it("headSha returns the commit sha, or the empty-tree sentinel before any commit", () => {
    const dir = tempDir();
    initRepo(dir);
    expect(headSha(dir)).toBe(EMPTY_TREE_SHA);
    writeFileSync(path.join(dir, "a.txt"), "a\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "base"]);
    expect(headSha(dir)).toMatch(/^[0-9a-f]{40}$/);
    expect(headSha(dir)).not.toBe(EMPTY_TREE_SHA);
  });
});

describe("fileGitStatus", () => {
  it("classifies committed, modified (staged or unstaged), and untracked", () => {
    const dir = tempDir();
    initRepo(dir);
    writeFileSync(path.join(dir, "tracked.txt"), "v1\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "base"]);

    expect(fileGitStatus(dir, "tracked.txt")).toEqual({ ok: true, value: "committed" });

    writeFileSync(path.join(dir, "tracked.txt"), "v2\n"); // unstaged edit
    expect(fileGitStatus(dir, "tracked.txt")).toEqual({ ok: true, value: "modified" });
    git(dir, ["add", "tracked.txt"]); // staged edit is still "modified"
    expect(fileGitStatus(dir, "tracked.txt")).toEqual({ ok: true, value: "modified" });

    writeFileSync(path.join(dir, "new.txt"), "u\n");
    expect(fileGitStatus(dir, "new.txt")).toEqual({ ok: true, value: "untracked" });
  });

  it("returns a typed error outside a repo, never throws", () => {
    const result = fileGitStatus(tempDir(), "whatever.txt");
    expect(result.ok).toBe(false);
  });
});

describe("parsePorcelainZ", () => {
  it("skips the origin token of rename entries; subsequent entries still parse", () => {
    // `R  new.txt NUL old.txt NUL ?? other.txt NUL` — porcelain v1 -z puts the
    // rename ORIGIN as its own NUL token right after the destination.
    const buffer = "R  new.txt\0old.txt\0?? other.txt\0";
    expect(parsePorcelainZ(buffer)).toEqual(["new.txt", "other.txt"]);
  });

  it("handles copy entries and plain entries mixed together", () => {
    const buffer = "C  copy.txt\0source.txt\0 M plain.txt\0A  added.txt\0";
    expect(parsePorcelainZ(buffer)).toEqual(["added.txt", "copy.txt", "plain.txt"]);
  });

  it("returns sorted unique paths and tolerates a trailing empty token", () => {
    const buffer = "?? b.txt\0?? a.txt\0";
    expect(parsePorcelainZ(buffer)).toEqual(["a.txt", "b.txt"]);
    expect(parsePorcelainZ("")).toEqual([]);
  });
});
