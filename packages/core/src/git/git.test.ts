import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  commitPath,
  currentBranch,
  diffRefs,
  fileGitStatus,
  gitCommand,
  headSha,
  isRepo,
  lsFiles,
  mergeBase,
  parseNameStatusZ,
  parsePorcelainZ,
  refExists,
  repoRoot,
  resolveDefaultBase,
  revParse,
  uncommittedFiles,
  EMPTY_TREE_SHA,
} from "./git.js";

// Real git process startup is heavily contended in the full parallel suite.
vi.setConfig({ testTimeout: 30_000 });

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

    writeFileSync(path.join(dir, ".gitignore"), "ignored.txt\n");
    writeFileSync(path.join(dir, "ignored.txt"), "ignored\n");
    expect(fileGitStatus(dir, "ignored.txt")).toEqual({ ok: true, value: "untracked" });
  });

  it("returns a typed error outside a repo, never throws", () => {
    const result = fileGitStatus(tempDir(), "whatever.txt");
    expect(result.ok).toBe(false);
  });
});

describe("gitCommand", () => {
  it("kills a git that WAITS, instead of blocking forever", () => {
    // A git that genuinely blocks on a child process — the shape a credential
    // prompt takes in 1.15's remote-ref flow, without needing a network. The
    // `ext::` transport makes git run the command and wait on it. Run from
    // the OS temp root, not a fixture: killing git leaves the `sleep` holding
    // its CWD for a moment, which would break the fixture teardown.
    const started = Date.now();
    const result = gitCommand(
      os.tmpdir(),
      ["-c", "protocol.ext.allow=always", "ls-remote", "ext::sleep 5"],
      { timeoutMs: 750 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/timed out after 750ms/);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 60_000);

  it("never waits on a human: interactive prompts are disabled", () => {
    const dir = tempDir();
    git(dir, ["init", "-q", "."]);
    // A remote that would prompt for credentials if git were interactive.
    const result = gitCommand(dir, ["ls-remote", "https://127.0.0.1:1/nope.git"], {
      timeoutMs: 20_000,
    });
    expect(result.ok).toBe(false);
  }, 30_000);
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

describe("ref diffing (1.15)", () => {
  /** `base` with two commits, `feature` branched off the FIRST — so a plain
   * `diff base feature` would also report `on-base.txt`, which the feature
   * branch never touched. */
  function forkedRepo(): string {
    const dir = tempDir();
    initRepo(dir);
    writeFileSync(path.join(dir, "root.txt"), "root\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "root"]);
    git(dir, ["branch", "-M", "main"]);
    git(dir, ["checkout", "-q", "-b", "feature"]);
    writeFileSync(path.join(dir, "feature.txt"), "feature\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "feature"]);
    git(dir, ["checkout", "-q", "main"]);
    writeFileSync(path.join(dir, "on-base.txt"), "moved on\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "base moved on"]);
    return dir;
  }

  it("diffs a branch against its merge-base, excluding what the base moved on to", () => {
    const dir = forkedRepo();
    const base = mergeBase(dir, "main", "feature");
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const changed = diffRefs(dir, base.value, "feature");
    expect(changed).toEqual({ ok: true, value: { changed: ["feature.txt"], deleted: [] } });
  }, 60_000);

  it("separates DELETED paths from changed ones, so an unreadable file is not a deletion", () => {
    const dir = forkedRepo();
    git(dir, ["checkout", "-q", "feature"]);
    git(dir, ["rm", "-q", "root.txt"]);
    writeFileSync(path.join(dir, "feature.txt"), "feature v2\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "drop root"]);
    const base = mergeBase(dir, "main", "feature");
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    // git NAMES the deletion; every other path is present at the ref, so a
    // read failure on one is lost coverage rather than a second deletion.
    expect(diffRefs(dir, base.value, "feature")).toEqual({
      ok: true,
      value: { changed: ["feature.txt"], deleted: ["root.txt"] },
    });
  }, 60_000);

  it("revParse PEELS an annotated tag to its commit, so a tag at HEAD compares equal to HEAD", () => {
    const dir = forkedRepo();
    git(dir, ["tag", "-a", "v1", "-m", "release"]);
    const tagObject = spawnSync("git", ["rev-parse", "v1"], { cwd: dir, encoding: "utf8" })
      .stdout.trim();
    const commit = headSha(dir);
    // The raw tag OBJECT sha is NOT the commit sha — comparing the unpeeled
    // answer against HEAD would build a worktree for a ref that IS HEAD.
    expect(tagObject).not.toBe(commit);
    expect(revParse(dir, "v1")).toEqual({ ok: true, value: commit });
  }, 60_000);

  it("lsFiles lists every tracked path, sorted and /-separated", () => {
    const dir = forkedRepo();
    expect(lsFiles(dir)).toEqual({ ok: true, value: ["on-base.txt", "root.txt"] });
  }, 60_000);

  it("rejects option-shaped refs BEFORE any git invocation", () => {
    const dir = forkedRepo();
    for (const hostile of ["--upload-pack=touch-me", "-x", ""]) {
      expect(revParse(dir, hostile).ok).toBe(false);
      expect(mergeBase(dir, hostile, "main").ok).toBe(false);
      expect(diffRefs(dir, "main", hostile).ok).toBe(false);
      expect(refExists(dir, hostile)).toBe(false);
    }
  }, 60_000);

  it("treats a ref containing traversal or shell metacharacters as simply absent", () => {
    const dir = forkedRepo();
    // Never interpolated into a shell, so these are only ever ref NAMES —
    // and no such ref exists.
    for (const ref of ["..", "../../etc/passwd", "main; rm -rf /", "main`whoami`"]) {
      expect(refExists(dir, ref)).toBe(false);
    }
  }, 60_000);

  it("resolveDefaultBase prefers origin/HEAD and declares anything below it a guess", () => {
    const dir = forkedRepo();
    const guessed = resolveDefaultBase(dir);
    expect(guessed).toEqual({ ok: true, value: { ref: "main", guessed: true } });

    // A repo with a real remote HEAD answers without guessing.
    git(dir, ["update-ref", "refs/remotes/origin/main", "main"]);
    git(dir, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
    expect(resolveDefaultBase(dir)).toEqual({
      ok: true,
      value: { ref: "refs/remotes/origin/HEAD", guessed: false },
    });
  }, 60_000);

  it("resolveDefaultBase fails naming --base when no candidate exists", () => {
    const dir = tempDir();
    initRepo(dir);
    writeFileSync(path.join(dir, "a.txt"), "a\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "a"]);
    git(dir, ["branch", "-M", "trunk"]);
    const result = resolveDefaultBase(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("--base");
  }, 60_000);

  it("currentBranch refuses to answer on a detached HEAD", () => {
    const dir = forkedRepo();
    expect(currentBranch(dir)).toEqual({ ok: true, value: "main" });
    git(dir, ["checkout", "-q", "--detach"]);
    const detached = currentBranch(dir);
    expect(detached.ok).toBe(false);
    if (!detached.ok) expect(detached.reason).toContain("--branch");
  }, 60_000);
});

describe("commitPath (1.15 disposition)", () => {
  it("force-adds past a .gitignore and commits ONLY that path, leaving the rest of the tree alone", () => {
    const dir = tempDir();
    initRepo(dir);
    writeFileSync(path.join(dir, ".gitignore"), "ignored/\n");
    writeFileSync(path.join(dir, "tracked.txt"), "v1\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "base"]);
    // A dirty tree around the artifact: one staged edit, one unstaged edit,
    // one untracked file — none of which may be swept into the commit.
    writeFileSync(path.join(dir, "tracked.txt"), "v2\n");
    git(dir, ["add", "tracked.txt"]);
    writeFileSync(path.join(dir, "tracked.txt"), "v3\n");
    writeFileSync(path.join(dir, "loose.txt"), "loose\n");
    mkdirSync(path.join(dir, "ignored"), { recursive: true });
    writeFileSync(path.join(dir, "ignored", "artifact.json"), "{}\n");

    const before = statusOf(dir);
    const result = commitPath(dir, "ignored/artifact.json", "chore: artifact [skip ci]");
    expect(result).toEqual({ ok: true, value: { state: "committed", output: expect.any(String) } });

    const committed = spawnSync("git", ["show", "--name-only", "--format=%s", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
    }).stdout;
    expect(committed).toContain("chore: artifact [skip ci]");
    expect(committed).toContain("ignored/artifact.json");
    expect(committed).not.toContain("tracked.txt");
    // The rest of the working tree and index are byte-identical apart from
    // the artifact leaving the untracked list.
    expect(statusOf(dir)).toBe(before.replace("!! ignored/artifact.json\n", ""));
  }, 60_000);

  it("is a no-op SUCCESS on a deterministic re-run — the same bytes are already in HEAD", () => {
    const dir = tempDir();
    initRepo(dir);
    writeFileSync(path.join(dir, ".gitignore"), "ignored/\n");
    writeFileSync(path.join(dir, "keep.txt"), "v1\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "base"]);
    mkdirSync(path.join(dir, "ignored"), { recursive: true });
    writeFileSync(path.join(dir, "ignored", "artifact.json"), "{}\n");

    expect(commitPath(dir, "ignored/artifact.json", "chore: a [skip ci]")).toEqual({
      ok: true,
      value: { state: "committed", output: expect.any(String) },
    });
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout;

    // Re-running a deterministic review rewrites identical bytes: `add` stages
    // nothing and a pathspec-limited `commit` exits 1 with its "nothing to
    // commit" on STDOUT — which must not be reported as a failure.
    const again = commitPath(dir, "ignored/artifact.json", "chore: a [skip ci]");
    expect(again).toEqual({ ok: true, value: { state: "unchanged", output: "" } });
    expect(spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout).toBe(
      head,
    );
  }, 60_000);

  it("refuses to commit on a DETACHED HEAD instead of creating an orphan", () => {
    const dir = tempDir();
    initRepo(dir);
    writeFileSync(path.join(dir, "a.txt"), "a\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "base"]);
    git(dir, ["checkout", "-q", "--detach"]);
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout;
    writeFileSync(path.join(dir, "artifact.json"), "{}\n");
    const before = statusOf(dir);

    const result = commitPath(dir, "artifact.json", "chore: artifact [skip ci]");

    // git would happily commit here and report success — onto a commit no
    // branch points at.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("detached");
    expect(spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout).toBe(
      head,
    );
    expect(statusOf(dir)).toBe(before);
  }, 60_000);

  it("bypasses a rejecting pre-commit hook: the artifact is machine-written, not user work", () => {
    const dir = tempDir();
    initRepo(dir);
    writeFileSync(path.join(dir, "tracked.txt"), "v1\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "base"]);
    // A lint-staged-style hook: it rejects, and (worse) it would run against
    // the user's main index during our partial commit.
    const hooks = path.join(dir, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(
      path.join(hooks, "pre-commit"),
      "#!/bin/sh\necho hook-ran > hook-marker.txt\nexit 1\n",
      { mode: 0o755 },
    );
    writeFileSync(path.join(dir, "artifact.json"), "{}\n");

    const result = commitPath(dir, "artifact.json", "chore: artifact [skip ci]");

    expect(result.ok).toBe(true);
    expect(existsSync(path.join(dir, "hook-marker.txt"))).toBe(false);
    const committed = spawnSync("git", ["show", "--name-only", "--format=%s", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
    }).stdout;
    expect(committed).toContain("artifact.json");
    expect(committed).not.toContain("tracked.txt");
  }, 60_000);

  it("leaves nothing staged when a commit fails MID-MERGE (the real `git reset` path)", () => {
    const dir = tempDir();
    initRepo(dir);
    writeFileSync(path.join(dir, "c.txt"), "base\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "base"]);
    git(dir, ["branch", "-M", "main"]);
    git(dir, ["checkout", "-q", "-b", "other"]);
    writeFileSync(path.join(dir, "c.txt"), "other\n");
    git(dir, ["commit", "-qam", "other"]);
    git(dir, ["checkout", "-q", "main"]);
    writeFileSync(path.join(dir, "c.txt"), "main\n");
    git(dir, ["commit", "-qam", "main"]);
    // A conflicted merge: git refuses a PARTIAL commit here, whatever
    // `--no-verify` says, so the un-stage path runs for real on a normal
    // branch with a resolvable HEAD.
    spawnSync("git", ["merge", "other"], { cwd: dir, encoding: "utf8" });
    writeFileSync(path.join(dir, "artifact.json"), "{}\n");

    const result = commitPath(dir, "artifact.json", "chore: artifact [skip ci]");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("partial commit");
    const staged = spawnSync("git", ["diff", "--cached", "--name-only"], {
      cwd: dir,
      encoding: "utf8",
    }).stdout;
    expect(staged).not.toContain("artifact.json");
    // The artifact is still on disk and merely untracked again.
    expect(existsSync(path.join(dir, "artifact.json"))).toBe(true);
  }, 60_000);

  it("leaves nothing staged when a hook `--no-verify` does NOT bypass rejects the commit", () => {
    const dir = tempDir();
    initRepo(dir);
    writeFileSync(path.join(dir, "a.txt"), "a\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "base"]);
    // `--no-verify` skips pre-commit/commit-msg but NOT prepare-commit-msg.
    const hooks = path.join(dir, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(path.join(hooks, "prepare-commit-msg"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    writeFileSync(path.join(dir, "artifact.json"), "{}\n");

    const result = commitPath(dir, "artifact.json", "chore: artifact [skip ci]");
    expect(result.ok).toBe(false);
    const staged = spawnSync("git", ["diff", "--cached", "--name-only"], {
      cwd: dir,
      encoding: "utf8",
    }).stdout.trim();
    expect(staged).toBe("");
  }, 60_000);
});

describe("parseNameStatusZ", () => {
  it("splits statuses from paths and takes the DESTINATION of a rename", () => {
    // `M\0a.ts\0D\0gone.ts\0R100\0old.ts\0new.ts\0A\0added.ts\0`
    expect(parseNameStatusZ("M\0a.ts\0D\0gone.ts\0R100\0old.ts\0new.ts\0A\0added.ts\0")).toEqual({
      changed: ["a.ts", "added.ts", "new.ts"],
      deleted: ["gone.ts"],
    });
    expect(parseNameStatusZ("")).toEqual({ changed: [], deleted: [] });
  });
});

/** Full working-tree status INCLUDING ignored files — the byte-identity
 * yardstick for "the commit touched nothing else". */
function statusOf(dir: string): string {
  return spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all", "--ignored"], {
    cwd: dir,
    encoding: "utf8",
  }).stdout;
}
