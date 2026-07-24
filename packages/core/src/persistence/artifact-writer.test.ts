import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { InvalidScopeError, writeReviewArtifact } from "./artifact-writer.js";

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

    // An existing .gitignore is user territory — never clobbered.
    writeFileSync(gitignorePath, "# custom\n");
    writeReviewArtifact({ repoRoot: root, scope: "uncommitted", runId: "r2", json: "{}\n" });
    expect(readFileSync(gitignorePath, "utf8")).toBe("# custom\n");
  });
});
