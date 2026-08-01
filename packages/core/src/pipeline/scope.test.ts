import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { SCOPE_PATTERN } from "@agentic-guardrails/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

// Every case spawns real git against a real temp repo; under full-suite
// parallel load a single case legitimately exceeds the 5s default.
vi.setConfig({ testTimeout: 60_000 });

import {
  changeSetFor,
  changeSizeFor,
  excludedBy,
  MAX_SLUG_BODY,
  resolveScope,
  slugForRef,
  type ResolvedScope,
} from "./scope.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-scope-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, shell: false, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function write(dir: string, relPath: string, content: string): void {
  const target = path.join(dir, relPath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/**
 * `main` (with a commit the feature branch never saw) + `feature` + a PR ref,
 * and — in every one of them — a committed artifact under
 * `_agentic-guardrails/`, which no scope may ever put in its own change set.
 */
function scopeRepo(): string {
  const dir = tempDir();
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  write(dir, "root.ts", "export const root = 1;\n");
  write(dir, "_agentic-guardrails/reviews/uncommitted/deadbeefdeadbeef.json", "{}\n");
  git(dir, ["add", "-f", "."]);
  git(dir, ["commit", "-m", "root"]);
  git(dir, ["branch", "-M", "main"]);
  git(dir, ["checkout", "-q", "-b", "feature"]);
  write(dir, "feature.ts", "export const feature = 1;\n");
  write(dir, "_agentic-guardrails/reviews/uncommitted/cafecafecafecafe.json", "{}\n");
  git(dir, ["add", "-f", "."]);
  git(dir, ["commit", "-m", "feature"]);
  git(dir, ["update-ref", "refs/pull/42/head", "feature"]);
  git(dir, ["checkout", "-q", "main"]);
  write(dir, "on-main.ts", "export const onMain = 1;\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "main moved on"]);
  return dir;
}

function scopeOf(dir: string, request: Parameters<typeof resolveScope>[1]): ResolvedScope {
  const resolved = resolveScope(dir, request);
  if (!resolved.ok) throw new Error(`unexpected resolution failure: ${resolved.reason}`);
  return resolved.scope;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("slugForRef", () => {
  it("passes an already-safe ref through unchanged", () => {
    expect(slugForRef("feature")).toBe("feature");
    expect(slugForRef("feat-foo")).toBe("feat-foo");
  });

  it("hash-suffixes every LOSSY derivation so two refs cannot share a directory", () => {
    const slashed = slugForRef("feat/Foo");
    const plain = slugForRef("feat-foo");
    expect(slashed).toMatch(/^feat-foo-[0-9a-f]{8}$/);
    expect(plain).toBe("feat-foo");
    expect(slashed).not.toBe(plain);
    // Case is lossy too: `foo` and `FOO` are one directory on a
    // case-insensitive filesystem unless the hash separates them.
    expect(slugForRef("FOO")).not.toBe(slugForRef("foo"));
  });

  it("CAPS the slug body, so a very long ref cannot blow past MAX_PATH at persistence", () => {
    // A ref name is unbounded; the slug becomes a directory, and the write
    // happens AFTER the whole analysis has been paid for.
    const long = `feat/${"a".repeat(200)}`;
    const slug = slugForRef(long);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_BODY + 9);
    expect(SCOPE_PATTERN.test(`branch-${slug}`)).toBe(true);
    // Truncation is lossy, so the hash suffix still separates two refs that
    // share the first MAX_SLUG_BODY characters.
    expect(slugForRef(`${long}-one`)).not.toBe(slugForRef(`${long}-two`));
  });

  it("is stable and produces SCOPE_PATTERN-safe segments for hostile ref text", () => {
    for (const ref of ["refs/pull/42/head", "..", "release/1.2.3", "WIP  spaces"]) {
      expect(slugForRef(ref)).toBe(slugForRef(ref));
      expect(SCOPE_PATTERN.test(`branch-${slugForRef(ref)}`)).toBe(true);
    }
  });
});

describe("resolveScope", () => {
  it("resolves the default uncommitted scope with no ref and no git work", () => {
    expect(resolveScope(tempDir(), { kind: "uncommitted" })).toEqual({
      ok: true,
      scope: { kind: "uncommitted", slug: "uncommitted", degradations: [] },
    });
  });

  it("resolves a branch against a guessed base and DECLARES the guess", () => {
    const dir = scopeRepo();
    const scope = scopeOf(dir, { kind: "branch", ref: "feature" });
    expect(scope.slug).toBe("branch-feature");
    expect(scope.ref).toBe("feature");
    expect(scope.base).toBe("main");
    expect(scope.baseGuessed).toBe(true);
    expect(scope.degradations).toHaveLength(1);
    expect(scope.degradations[0]?.reason).toContain("guessed main");
  });

  it("never guesses when --base is supplied", () => {
    const dir = scopeRepo();
    const scope = scopeOf(dir, { kind: "branch", ref: "feature", base: "main" });
    expect(scope.baseGuessed).toBe(false);
    expect(scope.degradations).toEqual([]);
  });

  it("defaults --branch with no value to the checked-out branch", () => {
    const dir = scopeRepo();
    git(dir, ["checkout", "-q", "feature"]);
    expect(scopeOf(dir, { kind: "branch" }).ref).toBe("feature");
  });

  it("rejects a hostile ref before any git call, and an absent one by name", () => {
    const dir = scopeRepo();
    for (const ref of ["--upload-pack=x", "-x"]) {
      const result = resolveScope(dir, { kind: "branch", ref });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('begins with "-"');
    }
    for (const ref of ["..", "no-such-branch"]) {
      const result = resolveScope(dir, { kind: "branch", ref });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("ref not found");
    }
  });

  it("fails naming --base when no default branch candidate exists", () => {
    const dir = tempDir();
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test"]);
    write(dir, "a.ts", "export const a = 1;\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "a"]);
    git(dir, ["branch", "-M", "trunk"]);
    const result = resolveScope(dir, { kind: "branch", ref: "trunk" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("--base");
  });

  it("resolves a LOCALLY PRESENT pr ref into pr-<id>", () => {
    const dir = scopeRepo();
    const scope = scopeOf(dir, { kind: "pr", ref: "42" });
    expect(scope.slug).toBe("pr-42");
    expect(scope.ref).toBe("refs/pull/42/head");
    expect(scope.prId).toBe("42");
  });

  it("fails an absent pr ref with the exact git fetch command, and never fetches", () => {
    const dir = scopeRepo();
    const result = resolveScope(dir, { kind: "pr", ref: "99" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("git fetch origin pull/99/head:refs/pull/99/head");
    }
    // No remote is configured, so a fetch attempt would have failed loudly —
    // and the ref is still absent afterwards.
    expect(resolveScope(dir, { kind: "pr", ref: "99" }).ok).toBe(false);
  });

  it("rejects a non-numeric pr id (the id is a directory segment)", () => {
    const dir = scopeRepo();
    for (const id of ["../../etc", "4 2", "-1", ""]) {
      const result = resolveScope(dir, { kind: "pr", ref: id });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("invalid PR id");
    }
  });

  it("rejects a LEADING-ZERO pr id: `007` is three different PRs at once", () => {
    const dir = scopeRepo();
    // `refs/pull/007/head` (GitHub's is `refs/pull/7/head`), `reviews/pr-007/`
    // and `gh pr view 007` (PR 7) would otherwise disagree about one id.
    for (const id of ["007", "0", "042"]) {
      const result = resolveScope(dir, { kind: "pr", ref: id });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("leading zeros");
    }
  });

  it("falls back to the SECOND pr-ref candidate when only the remote-tracking one exists", () => {
    const dir = scopeRepo();
    git(dir, ["update-ref", "-d", "refs/pull/42/head"]);
    git(dir, ["update-ref", "refs/remotes/origin/pull/42/head", "feature"]);
    expect(scopeOf(dir, { kind: "pr", ref: "42" }).ref).toBe("refs/remotes/origin/pull/42/head");
  });

  it("honours --base for a pr scope, and never calls it a guess", () => {
    const dir = scopeRepo();
    const scope = scopeOf(dir, { kind: "pr", ref: "42", base: "main" });
    expect(scope.base).toBe("main");
    expect(scope.baseGuessed).toBe(false);
    expect(scope.degradations).toEqual([]);
  });

  it("falls through a DANGLING refs/remotes/origin/HEAD to main, declared as a guess", () => {
    const dir = scopeRepo();
    // A clone whose origin/HEAD points at a branch that no longer exists —
    // the ref is "present" as a symbolic ref but resolves to nothing.
    git(dir, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/gone"]);
    const scope = scopeOf(dir, { kind: "branch", ref: "feature" });
    expect(scope.base).toBe("main");
    expect(scope.baseGuessed).toBe(true);
  });

  it("resolves project with no ref — no checkout, no worktree", () => {
    expect(resolveScope(tempDir(), { kind: "project" })).toEqual({
      ok: true,
      scope: { kind: "project", slug: "project", degradations: [] },
    });
  });
});

/** The change set's file list, for the cases that only care about that. */
function filesOf(result: ReturnType<typeof changeSetFor>): string[] {
  if (!result.ok) throw new Error(`unexpected change-set failure: ${result.reason}`);
  return result.value.files;
}

describe("changeSetFor", () => {
  it("branch: diffs against the merge-base, not the base tip", () => {
    const dir = scopeRepo();
    const changed = changeSetFor(scopeOf(dir, { kind: "branch", ref: "feature" }), dir);
    // `on-main.ts` moved on the BASE after the fork — the branch never
    // touched it.
    expect(changed).toEqual({
      ok: true,
      value: { files: ["feature.ts"], deleted: [], fromRefs: true, degradations: [] },
    });
  });

  it("branch: a DELETED path is named by git, never inferred from a failed read", () => {
    const dir = scopeRepo();
    git(dir, ["checkout", "-q", "feature"]);
    git(dir, ["rm", "-q", "root.ts"]);
    git(dir, ["commit", "-m", "drop root"]);
    git(dir, ["checkout", "-q", "main"]);
    const changed = changeSetFor(scopeOf(dir, { kind: "branch", ref: "feature" }), dir);
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value.deleted).toEqual(["root.ts"]);
    expect(changed.value.files).toEqual(["feature.ts"]);
    expect(changed.value.fromRefs).toBe(true);
  });

  it("branch: an EMPTY ref diff is DECLARED — 'nothing reviewed' is not 'nothing wrong'", () => {
    const dir = scopeRepo();
    // A branch already merged into its base (here: the base against itself)
    // yields zero files and exit 0 — indistinguishable from a real clean run.
    const changed = changeSetFor(scopeOf(dir, { kind: "branch", ref: "main", base: "main" }), dir);
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value.files).toEqual([]);
    expect(changed.value.degradations.map((d) => d.subject)).toEqual(["scope-change-set"]);
    expect(changed.value.degradations[0]?.reason).toContain("empty");
  });

  it("pr: identical computation to branch", () => {
    const dir = scopeRepo();
    expect(filesOf(changeSetFor(scopeOf(dir, { kind: "pr", ref: "42" }), dir))).toEqual([
      "feature.ts",
    ]);
  });

  it("project: every tracked file at the reviewed tree", () => {
    const dir = scopeRepo();
    const changed = changeSetFor(scopeOf(dir, { kind: "project" }), dir);
    expect(changed).toEqual({
      ok: true,
      // Not a ref diff: an absent file here is still a working-tree deletion.
      value: { files: ["on-main.ts", "root.ts"], deleted: [], fromRefs: false, degradations: [] },
    });
  });

  it("uncommitted: staged, unstaged and untracked, as before", () => {
    const dir = scopeRepo();
    write(dir, "loose.ts", "export const loose = 1;\n");
    expect(filesOf(changeSetFor(scopeOf(dir, { kind: "uncommitted" }), dir))).toEqual(["loose.ts"]);
  });

  it("excludes _agentic-guardrails/ from EVERY scope — an artifact never reviews itself", () => {
    const dir = scopeRepo();
    // Present in the committed tree, in the branch diff, and uncommitted.
    write(dir, "_agentic-guardrails/reviews/project/0000000000000000.json", "{}\n");
    write(dir, "_AGENTIC-GUARDRAILS/reviews/project/case.json", "{}\n");
    const scopes: ResolvedScope[] = [
      scopeOf(dir, { kind: "uncommitted" }),
      scopeOf(dir, { kind: "project" }),
      scopeOf(dir, { kind: "branch", ref: "feature" }),
      scopeOf(dir, { kind: "pr", ref: "42" }),
    ];
    for (const [index, scope] of scopes.entries()) {
      const changed = changeSetFor(scope, dir);
      expect(changed.ok).toBe(true);
      if (!changed.ok) continue;
      const own = (file: string): boolean => file.startsWith("_agentic-guardrails/");
      expect(changed.value.files.filter(own)).toEqual([]);
      expect(changed.value.deleted.filter(own)).toEqual([]);
      const caseVariant = changed.value.files.includes(
        "_AGENTIC-GUARDRAILS/reviews/project/case.json",
      );
      const caseInsensitive = process.platform === "win32" || process.platform === "darwin";
      // The case-variant file is untracked, so only the uncommitted scope can
      // contain it; case-insensitive platforms exclude it as engine output.
      expect(caseVariant).toBe(index === 0 && !caseInsensitive);
    }
  });

  it("returns a typed failure — never throws — when git cannot answer", () => {
    const notARepo = tempDir();
    const result = changeSetFor(
      { kind: "project", slug: "project", degradations: [] },
      notARepo,
    );
    expect(result.ok).toBe(false);
  });
});

describe("config exclude prefixes (1.18)", () => {
  it("matches whole segments only, tolerates a trailing slash, folds case per platform", () => {
    const matches = excludedBy(["tests/fixtures/"]);
    expect(matches("tests/fixtures/dirty.ts")).toBe(true);
    expect(matches("tests/fixtures")).toBe(true); // the prefix itself
    expect(matches("tests/fixtures2.ts")).toBe(false); // never a substring match
    expect(matches("src/tests/fixtures/x.ts")).toBe(false); // anchored at the root
    // Same case-folding rule as every other path compare (foldCase).
    const caseInsensitive = process.platform === "win32" || process.platform === "darwin";
    expect(excludedBy(["Tests/"])("tests/a.ts")).toBe(caseInsensitive);
  });

  it("applies to EVERY scope's change set, counted and DECLARED — never silent", () => {
    const dir = scopeRepo();
    write(dir, "fixtures/dirty.ts", "export const dirty = 1;\n");
    const exclude = ["fixtures/", "root.ts", "on-main.ts", "feature.ts"];
    const scopes: ResolvedScope[] = [
      scopeOf(dir, { kind: "uncommitted" }),
      scopeOf(dir, { kind: "project" }),
      scopeOf(dir, { kind: "branch", ref: "feature" }),
      scopeOf(dir, { kind: "pr", ref: "42" }),
    ];
    for (const scope of scopes) {
      const changed = changeSetFor(scope, dir, exclude);
      expect(changed.ok).toBe(true);
      if (!changed.ok) continue;
      expect(changed.value.files).toEqual([]);
      const declared = changed.value.degradations.filter((d) => d.subject === "scope-exclusions");
      expect(declared).toHaveLength(1);
      expect(declared[0]?.reason).toContain("excluded from review by config exclude prefixes");
      // The declaration names only prefixes that MATCHED this scope's set —
      // every named prefix must come from the configured list.
      const named = /prefixes \((.+)\) —/.exec(declared[0]?.reason ?? "")?.[1]?.split(", ") ?? [];
      expect(named.length).toBeGreaterThan(0);
      for (const prefix of named) expect(exclude).toContain(prefix);
    }
  });

  it("declares only the prefixes that MATCHED files, capped at 3 (+N more)", () => {
    const dir = scopeRepo();
    for (const f of ["a/x.ts", "b/x.ts", "c/x.ts", "d/x.ts"]) {
      write(dir, f, "export const x = 1;\n");
    }
    const scope = scopeOf(dir, { kind: "uncommitted" });
    // `nothing-here/` matches no file — it must NOT be named in the
    // declaration (it is still visible as an FR-31 deviation at run start).
    const changed = changeSetFor(scope, dir, ["nothing-here/", "a/", "b/", "c/", "d/"]);
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    const declared = changed.value.degradations.find((d) => d.subject === "scope-exclusions");
    expect(declared?.reason).toContain("4 file(s) excluded");
    expect(declared?.reason).toContain("a/, b/, c/, +1 more");
    expect(declared?.reason).not.toContain("nothing-here");
  });

  it("a prefix matching NOTHING produces no declaration at all — same change set as without it", () => {
    const dir = scopeRepo();
    write(dir, "loose.ts", "export const loose = 1;\n");
    const scope = scopeOf(dir, { kind: "uncommitted" });
    const withEntry = changeSetFor(scope, dir, ["nothing-here/"]);
    const without = changeSetFor(scope, dir);
    expect(withEntry).toEqual(without);
  });

  it("HAZARD (causality): the SAME change set without the entry contains the file", () => {
    const dir = scopeRepo();
    write(dir, "fixtures/dirty.ts", "export const dirty = 1;\n");
    const scope = scopeOf(dir, { kind: "uncommitted" });
    expect(filesOf(changeSetFor(scope, dir))).toEqual(["fixtures/dirty.ts"]);
    const excluded = changeSetFor(scope, dir, ["fixtures/"]);
    expect(filesOf(excluded)).toEqual([]);
    if (excluded.ok) {
      expect(excluded.value.degradations.map((d) => d.subject)).toContain("scope-exclusions");
    }
  });

  it("excludes the same prefixes from the changed-KLOC denominator (uncommitted)", () => {
    const dir = scopeRepo();
    write(dir, "keep.ts", "export const keep = 1;\nexport const also = 2;\n"); // 2 lines
    write(dir, "fixtures/dirty.ts", "a\nb\nc\nd\ne\n"); // 5 lines
    const scope = scopeOf(dir, { kind: "uncommitted" });
    const all = changeSizeFor(scope, dir);
    expect(all.ok && all.value.changedLines).toBe(7);
    const sized = changeSizeFor(scope, dir, ["fixtures/"]);
    expect(sized.ok && sized.value.changedLines).toBe(2);
  });

  it("excludes the denominator on the ref-diffing side too (branch)", () => {
    const dir = scopeRepo();
    const scope = scopeOf(dir, { kind: "branch", ref: "feature" });
    const all = changeSizeFor(scope, dir);
    expect(all.ok && all.value.changedLines).toBeGreaterThan(0);
    const sized = changeSizeFor(scope, dir, ["feature.ts"]);
    expect(sized.ok && sized.value.changedLines).toBe(0);
  });

  it("exclude-everything on a ref diff lands on the normal empty-change-set path, declared", () => {
    const dir = scopeRepo();
    const changed = changeSetFor(scopeOf(dir, { kind: "branch", ref: "feature" }), dir, [
      "feature.ts",
    ]);
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value.files).toEqual([]);
    const subjects = changed.value.degradations.map((d) => d.subject);
    expect(subjects).toContain("scope-exclusions");
    expect(subjects).toContain("scope-change-set"); // the empty-diff declaration
  });
});
