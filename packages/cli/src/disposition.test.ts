import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { disposeArtifact } from "./disposition.js";
import type { QuestionSource } from "./init-command.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-disposition-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, shell: false, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

const ARTIFACT_REL = "_agentic-guardrails/reviews/branch-feature/0123456789abcdef.json";

/**
 * A repo whose `reviews/` tree is gitignored exactly as `init` seeds it (1.8),
 * with a written artifact inside it and a DIRTY working tree around it: one
 * staged edit, one unstaged edit, one untracked file. None of those may move.
 */
function repoWithArtifact(): { repo: string; artifactPath: string } {
  const repo = tempDir();
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  writeFileSync(path.join(repo, "tracked.txt"), "v1\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "base"]);
  writeFileSync(path.join(repo, "tracked.txt"), "v2\n");
  git(repo, ["add", "tracked.txt"]);
  writeFileSync(path.join(repo, "tracked.txt"), "v3\n");
  writeFileSync(path.join(repo, "loose.txt"), "loose\n");
  const artifactPath = path.join(repo, ARTIFACT_REL);
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, '{"runId":"0123456789abcdef"}\n');
  mkdirSync(path.join(repo, "_agentic-guardrails"), { recursive: true });
  writeFileSync(path.join(repo, "_agentic-guardrails", ".gitignore"), "reviews/\n.cache/\n");
  return { repo, artifactPath };
}

/** Working tree + index + ignored files — the yardstick for "nothing else moved". */
function statusOf(repo: string): string {
  return git(repo, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored"]);
}

function answering(answer: string): QuestionSource {
  return { question: async () => Promise.resolve(answer), once: () => undefined };
}

/** A closed stdin: the pending question never resolves, the close listener
 * fires — `eofSafeIo`'s EOF path, whose default here must be the SAFE one. */
function closedInput(): QuestionSource {
  return {
    question: () => new Promise<string>(() => undefined),
    once: (_event, listener) => {
      setImmediate(listener);
      return undefined;
    },
  };
}

/** A prompt interrupted by Ctrl-C: readline emits `SIGINT`, and the pending
 * question only ever settles if something closes the interface. */
function interrupted(): QuestionSource & { close: () => void } {
  const listeners = new Map<string, () => void>();
  return {
    question: () => new Promise<string>(() => undefined),
    once: (event, listener) => {
      listeners.set(event, listener);
      if (event === "SIGINT") setImmediate(listener);
      return undefined;
    },
    close: () => listeners.get("close")?.(),
  };
}

function optionsFor(repo: string, artifactPath: string) {
  return { repoRoot: repo, artifactPath, runId: "0123456789abcdef", scope: "branch-feature" };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("artifact disposition (1.15)", () => {
  it("drops silently and makes no git call when not interactive", async () => {
    const { repo, artifactPath } = repoWithArtifact();
    const before = statusOf(repo);
    const head = git(repo, ["rev-parse", "HEAD"]);

    const result = await disposeArtifact({ ...optionsFor(repo, artifactPath), interactive: false });

    expect(result).toEqual({ action: "drop", lines: [] });
    // Nothing committed, nothing staged, nothing deleted.
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(head);
    expect(statusOf(repo)).toBe(before);
    expect(existsSync(artifactPath)).toBe(true);
  });

  it("drops on EOF — the safe default — and reports where the artifact is", async () => {
    const { repo, artifactPath } = repoWithArtifact();
    const before = statusOf(repo);

    const result = await disposeArtifact({
      ...optionsFor(repo, artifactPath),
      interactive: true,
      io: closedInput(),
    });

    expect(result.action).toBe("drop");
    expect(result.lines).toEqual([`artifact left untracked at: ${ARTIFACT_REL}`]);
    expect(statusOf(repo)).toBe(before);
  });

  it("drops on any answer that is not an explicit commit", async () => {
    const { repo, artifactPath } = repoWithArtifact();
    for (const answer of ["", "d", "no", "n", "COMMITTED?"]) {
      const result = await disposeArtifact({
        ...optionsFor(repo, artifactPath),
        interactive: true,
        io: answering(answer),
      });
      expect(result.action).toBe("drop");
    }
  });

  it("accepts `y`/`yes` as commit — the near-universal affirmative must not mean 'drop'", async () => {
    for (const answer of ["y", "yes", "Y", "YES", "c", "commit"]) {
      const { repo, artifactPath } = repoWithArtifact();
      const result = await disposeArtifact({
        ...optionsFor(repo, artifactPath),
        interactive: true,
        io: answering(answer),
      });
      expect(result.action).toBe("commit");
      expect(git(repo, ["show", "--name-only", "--format=%s", "HEAD"])).toContain(ARTIFACT_REL);
    }
    // Six real repos in one case; the 5s default is too tight under load.
  }, 60_000);

  it("Ctrl-C at the prompt settles as DROP instead of escaping the exit contract with 130", async () => {
    const { repo, artifactPath } = repoWithArtifact();
    const before = statusOf(repo);

    // Without a SIGINT listener readline kills the process with 130 — the
    // documented 0/1/2 contract escaped and the computed gate verdict thrown
    // away. (Without the fix this case HANGS: nothing ever settles the
    // pending question, and the test times out.)
    const result = await disposeArtifact({
      ...optionsFor(repo, artifactPath),
      interactive: true,
      io: interrupted(),
    });

    expect(result.action).toBe("drop");
    expect(statusOf(repo)).toBe(before);
  });

  it("reports a deterministic RE-RUN as a no-op success, not a bogus temp copy", async () => {
    const { repo, artifactPath } = repoWithArtifact();
    const first = await disposeArtifact({
      ...optionsFor(repo, artifactPath),
      interactive: true,
      io: answering("c"),
    });
    expect(first.action).toBe("commit");
    const head = git(repo, ["rev-parse", "HEAD"]);

    // Same inputs → same runId → the identical bytes are already committed.
    const second = await disposeArtifact({
      ...optionsFor(repo, artifactPath),
      interactive: true,
      io: answering("c"),
    });
    expect(second).toEqual({
      action: "commit",
      lines: [`already committed (unchanged): ${ARTIFACT_REL}`],
    });
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("degrades a DETACHED HEAD to a temp copy with real git — never an orphaned commit", async () => {
    const { repo, artifactPath } = repoWithArtifact();
    git(repo, ["checkout", "-q", "--detach"]);
    const head = git(repo, ["rev-parse", "HEAD"]);

    const result = await disposeArtifact({
      ...optionsFor(repo, artifactPath),
      interactive: true,
      io: answering("c"),
    });

    expect(result.action).toBe("commit-failed");
    expect(result.lines[0]).toContain("detached");
    const saved = result.lines[1]?.replace("artifact saved to: ", "") ?? "";
    tempDirs.push(path.dirname(saved));
    expect(readFileSync(saved, "utf8")).toBe(readFileSync(artifactPath, "utf8"));
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("commits through a repo that HAS a pre-commit hook, without letting it touch the index", async () => {
    const { repo, artifactPath } = repoWithArtifact();
    // The lint-staged shape: a hook that rewrites/stages files of its own
    // choosing during OUR partial commit — and rejects.
    const hooks = path.join(repo, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(path.join(hooks, "pre-commit"), "#!/bin/sh\necho ran > hook-ran.txt\nexit 1\n", {
      mode: 0o755,
    });
    const before = statusOf(repo);

    const result = await disposeArtifact({
      ...optionsFor(repo, artifactPath),
      interactive: true,
      io: answering("c"),
    });

    expect(result).toEqual({ action: "commit", lines: [`committed: ${ARTIFACT_REL}`] });
    expect(existsSync(path.join(repo, "hook-ran.txt"))).toBe(false);
    // Byte-identical apart from the artifact leaving the ignored list — the
    // hook-free assertions above prove nothing about a repo that has one.
    expect(statusOf(repo)).toBe(before.replace(`!! ${ARTIFACT_REL}\n`, ""));
  });

  it("commits ONLY the artifact, force-added past the ignore, with [skip ci]", async () => {
    const { repo, artifactPath } = repoWithArtifact();
    const before = statusOf(repo);

    const result = await disposeArtifact({
      ...optionsFor(repo, artifactPath),
      interactive: true,
      io: answering("c"),
    });

    expect(result).toEqual({ action: "commit", lines: [`committed: ${ARTIFACT_REL}`] });
    const commit = git(repo, ["show", "--name-only", "--format=%s", "HEAD"]);
    expect(commit).toContain("[skip ci]");
    expect(commit).toContain(ARTIFACT_REL);
    expect(commit).not.toContain("tracked.txt");
    // The `.gitignore` is untouched — the commit force-ADDS past it.
    expect(readFileSync(path.join(repo, "_agentic-guardrails", ".gitignore"), "utf8")).toBe(
      "reviews/\n.cache/\n",
    );
    // Byte-identical working tree apart from the artifact leaving the ignored
    // list: the staged edit is still staged, the unstaged edit still unstaged,
    // the untracked file still untracked.
    expect(statusOf(repo)).toBe(before.replace(`!! ${ARTIFACT_REL}\n`, ""));
  });

  it("degrades a failed commit to a temp copy, reports the path, and keeps the artifact", async () => {
    const { repo, artifactPath } = repoWithArtifact();
    const before = statusOf(repo);

    const result = await disposeArtifact({
      ...optionsFor(repo, artifactPath),
      interactive: true,
      io: answering("commit"),
      commit: () => ({ ok: false, reason: "pre-commit hook rejected the commit" }),
    });

    expect(result.action).toBe("commit-failed");
    expect(result.lines[0]).toBe("degraded: commit failed: pre-commit hook rejected the commit");
    const saved = result.lines[1]?.replace("artifact saved to: ", "") ?? "";
    tempDirs.push(path.dirname(saved));
    expect(readFileSync(saved, "utf8")).toBe(readFileSync(artifactPath, "utf8"));
    // The invoking repo is untouched and the original artifact is still there.
    expect(statusOf(repo)).toBe(before);
    expect(existsSync(artifactPath)).toBe(true);
  });
});
