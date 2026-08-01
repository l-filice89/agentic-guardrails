/**
 * Story 1.15 e2e: spawns the BUILT CLI against a real fixture repo and proves
 * the scope surface end to end — a branch reviewed through a REAL git worktree
 * while the artifact lands in the invoking repo, `--project`, the PR-ref-absent
 * failure, self-exclusion per scope, and the usage errors.
 *
 * Requires `pnpm -r build` first (CI builds before tests). Temp repos live
 * under the OS temp dir and never touch this repository.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Spawn-heavy e2e: git init + worktree lifecycle + ts-morph parses per test.
vi.setConfig({ testTimeout: 120_000 });

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = path.join(repoRoot, "packages", "cli", "dist", "index.js");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-scopes-e2e-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, shell: false, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

/**
 * `GUARDRAILS_NO_GH=1`: this suite spawns the BUILT CLI, and the `--pr` scope
 * asks the user's own `gh` for optional metadata. Without the guard, a suite
 * whose sibling case is titled "never reaches the network" would shell out to
 * whatever `gh` the developer's PATH happens to hold — and behave differently
 * on a machine that has one. The switch degrades exactly as an absent `gh`.
 */
function runCli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    shell: false,
    encoding: "utf8",
    env: { ...process.env, GUARDRAILS_NO_GH: "1" },
  });
}

const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true },
  include: ["src"],
});

/**
 * `main` with a commit the branch never saw, a `feature` branch adding one
 * file, and a PR ref at the branch tip — plus a committed artifact under
 * `_agentic-guardrails/` on every branch, so self-exclusion is testable per
 * scope.
 */
function fixtureRepo(): string {
  const dir = tempDir();
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
  writeFileSync(path.join(dir, ".gitignore"), "\n");
  writeFile(dir, "src/root.ts", "export const root = 1;\n");
  writeFile(dir, "_agentic-guardrails/reviews/legacy-fixture/0000000000000000.json", "{}\n");
  git(dir, ["add", "-f", "."]);
  git(dir, ["commit", "-m", "root"]);
  git(dir, ["branch", "-M", "main"]);
  git(dir, ["checkout", "-q", "-b", "feature"]);
  writeFile(dir, "src/feature.ts", "export const feature = 1;\n");
  writeFile(dir, "_agentic-guardrails/reviews/legacy-fixture/1111111111111111.json", "{}\n");
  git(dir, ["add", "-f", "."]);
  git(dir, ["commit", "-m", "feature"]);
  git(dir, ["update-ref", "refs/pull/42/head", "feature"]);
  git(dir, ["checkout", "-q", "main"]);
  writeFile(dir, "src/on-main.ts", "export const onMain = 1;\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "main moved on"]);
  return dir;
}

function writeFile(dir: string, relPath: string, content: string): void {
  const target = path.join(dir, relPath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function readArtifact(repo: string, scope: string): Record<string, unknown> {
  const dir = path.join(repo, "_agentic-guardrails", "reviews", scope);
  const entries = readdirSync(dir).filter((file) => file.endsWith(".json"));
  expect(entries).toHaveLength(1);
  return JSON.parse(readFileSync(path.join(dir, entries[0]!), "utf8")) as Record<string, unknown>;
}

beforeAll(() => {
  if (!existsSync(cliPath)) {
    throw new Error(`built CLI missing at ${cliPath} — run \`pnpm -r build\` first`);
  }
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("guardrails review — scopes e2e (1.15)", () => {
  it("reviews a branch through a real worktree, writing into the INVOKING repo and leaving it untouched", () => {
    const repo = fixtureRepo();
    const headBefore = git(repo, ["rev-parse", "HEAD"]);

    const result = runCli(repo, ["review", "--branch", "feature"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("guardrails review (branch-feature)");
    const artifact = readArtifact(repo, "branch-feature");
    // Merge-base diff: what the branch added, not what main moved on to.
    expect(artifact["changedFiles"]).toEqual(["src/feature.ts"]);
    expect(artifact["scope"]).toBe("branch-feature");
    const manifest = artifact["manifest"] as Record<string, unknown>;
    expect(manifest["scope"]).toEqual({
      kind: "branch",
      ref: "feature",
      base: "main",
      baseGuessed: true,
    });
    // The guessed base is declared on stderr, never silent.
    expect(result.stderr).toContain("scope-base");

    // NFR-9: the invoking repo is not mutated — same HEAD, same working tree
    // apart from the artifact it just wrote, and no worktree left registered.
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(headBefore);
    // Nothing TRACKED moved: the only writes are the run's own output tree
    // (the artifact plus the seeded `_agentic-guardrails/.gitignore`), which
    // is untracked and ignored by design.
    expect(git(repo, ["diff", "--name-only", "HEAD"])).toBe("");
    expect(git(repo, ["diff", "--cached", "--name-only"])).toBe("");
    expect(git(repo, ["worktree", "list", "--porcelain"]).match(/^worktree /gm)).toHaveLength(1);
  });

  it("reviews every tracked file for --project, into reviews/project/", () => {
    const repo = fixtureRepo();
    const result = runCli(repo, ["review", "--project"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("guardrails review (project)");
    const artifact = readArtifact(repo, "project");
    expect(artifact["changedFiles"]).toEqual([
      ".gitignore",
      "src/on-main.ts",
      "src/root.ts",
      "tsconfig.json",
    ]);
  });

  it("excludes _agentic-guardrails/ from the change set of EVERY scope", () => {
    const repo = fixtureRepo();
    for (const [args, scope] of [
      [["review"], "uncommitted"],
      [["review", "--project"], "project"],
      [["review", "--branch", "feature"], "branch-feature"],
      [["review", "--pr", "42"], "pr-42"],
    ] as const) {
      const result = runCli(repo, [...args]);
      expect(result.status).toBe(0);
      const artifact = readArtifact(repo, scope);
      const changed = artifact["changedFiles"] as string[];
      // The committed artifacts (and the one each run just wrote) are never in
      // any change set — an artifact must never review itself.
      expect(changed.filter((file) => file.startsWith("_agentic-guardrails/"))).toEqual([]);
    }
  });

  it("fails a PR ref that is not present locally with the exact fetch command, and never reaches the network", () => {
    const repo = fixtureRepo();
    const result = runCli(repo, ["review", "--pr", "99"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("git fetch origin pull/99/head:refs/pull/99/head");
    expect(existsSync(path.join(repo, "_agentic-guardrails", "reviews", "pr-99"))).toBe(false);
  });

  it("rejects a hostile ref before any git call, and two scope flags as a usage error", () => {
    const repo = fixtureRepo();
    const hostile = runCli(repo, ["review", "--branch=--upload-pack=touch-me"]);
    expect(hostile.status).toBe(2);
    const conflicting = runCli(repo, ["review", "--pr", "1", "--project"]);
    expect(conflicting.status).toBe(2);
    expect(`${conflicting.stdout}${conflicting.stderr}`).toMatch(/cannot be used with/i);
  });

  it("leaves the artifact untracked on a non-TTY run — no ambient commit", () => {
    const repo = fixtureRepo();
    const headBefore = git(repo, ["rev-parse", "HEAD"]);
    expect(runCli(repo, ["review", "--branch", "feature"]).status).toBe(0);
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(headBefore);
    // The artifact is on disk and NOT staged.
    expect(git(repo, ["diff", "--cached", "--name-only"]).trim()).toBe("");
    expect(readArtifact(repo, "branch-feature")["scope"]).toBe("branch-feature");
  });

  it("never spawns `gh` when GUARDRAILS_NO_GH=1 — the PR scope still completes", () => {
    const repo = fixtureRepo();
    // A `gh` on PATH that would fail loudly if it were ever invoked: the
    // guard must keep it out of the loop entirely, and the review must run to
    // completion with a DECLARED reason for the missing metadata.
    const fakeBin = tempDir();
    const isWindows = process.platform === "win32";
    writeFileSync(
      path.join(fakeBin, isWindows ? "gh.cmd" : "gh"),
      isWindows ? "@echo off\r\nexit /b 42\r\n" : "#!/bin/sh\nexit 42\n",
      { mode: 0o755 },
    );
    const result = spawnSync(process.execPath, [cliPath, "review", "--pr", "42"], {
      cwd: repo,
      shell: false,
      encoding: "utf8",
      env: { ...process.env, GUARDRAILS_NO_GH: "1", PATH: `${fakeBin}${path.delimiter}${process.env["PATH"] ?? ""}` },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("GUARDRAILS_NO_GH");
    expect(readArtifact(repo, "pr-42")["manifest"]).not.toHaveProperty("pr");
  });

  it("keeps bare `guardrails review` on the uncommitted scope, unchanged", () => {
    const repo = fixtureRepo();
    writeFile(repo, "src/loose.ts", "export const loose = 1;\n");
    const result = runCli(repo, ["review"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("guardrails review (uncommitted)");
    const artifact = readArtifact(repo, "uncommitted");
    expect(artifact["changedFiles"]).toEqual(["src/loose.ts"]);
    // No scope block on the manifest: pre-1.15 artifact bytes are unchanged
    // for the default scope.
    expect((artifact["manifest"] as Record<string, unknown>)["scope"]).toBeUndefined();
  });
});
