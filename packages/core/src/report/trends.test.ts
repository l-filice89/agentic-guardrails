/**
 * FR-15 aggregation (1.16): ancestry-ordered, `recordId`-deduped,
 * validate-before-trust, cold-starting on an untrustworthy store.
 *
 * The git queries are injected so the ORDERING logic is tested without
 * building a commit graph per case; the real `--is-ancestor` wrapper has its
 * own test beside git.ts (`numstat-ancestry.test.ts`), where exit 1 being an
 * answer is what matters.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  makeTrendRecord,
  trendRecordSchema,
  type SeverityCounts,
  type TrendRecord,
} from "@agentic-guardrails/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { appendJsonl } from "../persistence/history.js";
import { aggregateTrends, ANCESTRY_SCAN_LIMIT } from "./trends.js";

const tempDirs: string[] = [];

function store(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-trends-"));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, "history"), { recursive: true });
  return path.join(dir, "history", "trends.jsonl");
}

const counts = (error: number, warning = 0, info = 0): Record<string, SeverityCounts> => ({
  "1": { error, warning, info },
});

function rec(
  runId: string,
  commitSha: string,
  axiomSeverityCounts: Record<string, SeverityCounts>,
): TrendRecord {
  return makeTrendRecord({
    schemaVersion: 1,
    runId,
    commitSha,
    scopeKind: "branch",
    axiomSeverityCounts,
    changedKlocMilli: 1_000,
  });
}

/** A linear history: `c1` is an ancestor of `c2` is an ancestor of `head`. */
const LINEAR = ["c1", "c2", "head"];
const linearAncestry = (
  _root: string,
  ancestor: string,
  descendant: string,
): { ok: true; value: boolean } => ({
  ok: true,
  value: LINEAR.indexOf(ancestor) >= 0 && LINEAR.indexOf(ancestor) <= LINEAR.indexOf(descendant),
});
const allExist = (): boolean => true;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("aggregateTrends", () => {
  it("COLD-STARTS on a first run with no history file, and says nothing about it", () => {
    const result = aggregateTrends({
      repoRoot: "/repo",
      storePath: store(),
      headSha: "head",
      scopeKind: "branch",
      current: counts(2),
      currentRecordId: "self",
      ancestry: linearAncestry,
      exists: allExist,
    });
    expect(result).toEqual({ deltas: [], coldStart: true, declarations: [] });
  });

  it("compares against the NEAREST ancestor, not the oldest record", () => {
    const file = store();
    appendJsonl(file, trendRecordSchema, [rec("r1", "c1", counts(9)), rec("r2", "c2", counts(5))]);
    const result = aggregateTrends({
      repoRoot: "/repo",
      storePath: file,
      headSha: "head",
      scopeKind: "branch",
      current: counts(2),
      currentRecordId: "self",
      ancestry: linearAncestry,
      exists: allExist,
    });
    expect(result.coldStart).toBe(false);
    expect(result.previous?.runId).toBe("r2");
    expect(result.deltas).toEqual([{ axiom: "1", error: -3, warning: 0, info: 0 }]);
  });

  it("ignores records of a DIFFERENT scope kind — like is compared with like", () => {
    const file = store();
    const other = makeTrendRecord({
      schemaVersion: 1,
      runId: "r-other",
      commitSha: "c2",
      scopeKind: "uncommitted",
      axiomSeverityCounts: counts(0),
      changedKlocMilli: 1_000,
    });
    appendJsonl(file, trendRecordSchema, [rec("r1", "c1", counts(9)), other]);
    const result = aggregateTrends({
      repoRoot: "/repo",
      storePath: file,
      headSha: "head",
      scopeKind: "branch",
      current: counts(9),
      currentRecordId: "self",
      ancestry: linearAncestry,
      exists: allExist,
    });
    expect(result.previous?.runId).toBe("r1");
  });

  it("never compares a re-run against ITSELF", () => {
    const file = store();
    const mine = rec("r1", "c2", counts(4));
    appendJsonl(file, trendRecordSchema, [mine]);
    const result = aggregateTrends({
      repoRoot: "/repo",
      storePath: file,
      headSha: "head",
      scopeKind: "branch",
      current: counts(4),
      currentRecordId: mine.recordId,
      ancestry: linearAncestry,
      exists: allExist,
    });
    expect(result.coldStart).toBe(true);
  });

  it("SKIPS and DECLARES a record whose commit is no longer in the repo", () => {
    const file = store();
    appendJsonl(file, trendRecordSchema, [rec("gone", "rebased-away", counts(9)), rec("r2", "c2", counts(5))]);
    const result = aggregateTrends({
      repoRoot: "/repo",
      storePath: file,
      headSha: "head",
      scopeKind: "branch",
      current: counts(5),
      currentRecordId: "self",
      ancestry: linearAncestry,
      exists: (_root, sha) => sha !== "rebased-away",
    });
    expect(result.previous?.runId).toBe("r2");
    expect(result.declarations.join(" ")).toContain("no longer in this repository");
  });

  it("skips a NON-ancestor (another branch's record) without failing", () => {
    const file = store();
    appendJsonl(file, trendRecordSchema, [rec("elsewhere", "sidebranch", counts(9))]);
    const result = aggregateTrends({
      repoRoot: "/repo",
      storePath: file,
      headSha: "head",
      scopeKind: "branch",
      current: counts(1),
      currentRecordId: "self",
      ancestry: linearAncestry,
      exists: allExist,
    });
    expect(result.coldStart).toBe(true);
    expect(result.deltas).toEqual([]);
  });

  it("uses the recordId TIEBREAK for two records at the SAME commit, and says so", () => {
    const file = store();
    const a = rec("ra", "c2", counts(1));
    const b = rec("rb", "c2", counts(7));
    appendJsonl(file, trendRecordSchema, [a, b]);
    const result = aggregateTrends({
      repoRoot: "/repo",
      storePath: file,
      headSha: "head",
      scopeKind: "branch",
      current: counts(0),
      currentRecordId: "self",
      ancestry: linearAncestry,
      exists: allExist,
    });
    const expected = a.recordId > b.recordId ? a : b;
    expect(result.previous?.recordId).toBe(expected.recordId);
    expect(result.declarations.join(" ")).toContain("recordId tiebreak");
  });

  it("skips an invalid LINE but still produces a delta from the valid ones", () => {
    const file = store();
    const good = rec("r2", "c2", counts(5));
    writeFileSync(file, `{"recordId":"bad","schemaVersion":"x"}\n${JSON.stringify(good)}\n`);
    const result = aggregateTrends({
      repoRoot: "/repo",
      storePath: file,
      headSha: "head",
      scopeKind: "branch",
      current: counts(2),
      currentRecordId: "self",
      ancestry: linearAncestry,
      exists: allExist,
    });
    expect(result.declarations[0]).toContain("line 1");
    expect(result.previous?.runId).toBe("r2");
  });

  it("COLD-STARTS rather than reporting a delta from an untrustworthy store", () => {
    const file = store();
    const good = rec("r2", "c2", counts(5));
    writeFileSync(
      file,
      ["garbage", "more garbage", "{}", JSON.stringify(good)].join("\n") + "\n",
    );
    const result = aggregateTrends({
      repoRoot: "/repo",
      storePath: file,
      headSha: "head",
      scopeKind: "branch",
      current: counts(2),
      currentRecordId: "self",
      ancestry: linearAncestry,
      exists: allExist,
    });
    expect(result.coldStart).toBe(true);
    expect(result.previous).toBeUndefined();
    expect(result.declarations.join(" ")).toContain("not trustworthy");
  });

  it("does NOT declare the scan cap on an ordinary two-record store", () => {
    // The cap used to be compared against the PRE-filter same-scope count,
    // which still includes this run's own record: `N > N-1` fired the cap
    // declaration on every idempotent re-run, which is how the real one
    // becomes unreadable.
    const file = store();
    const mine = rec("r2", "c2", counts(5));
    appendJsonl(file, trendRecordSchema, [rec("r1", "c1", counts(9)), mine]);
    const result = aggregateTrends({
      repoRoot: "/repo",
      storePath: file,
      headSha: "head",
      scopeKind: "branch",
      current: counts(5),
      currentRecordId: mine.recordId,
      ancestry: linearAncestry,
      exists: allExist,
    });
    expect(result.declarations.join(" ")).not.toContain("capped");
  });

  it("declares the cap when it BITES, and the true nearest ancestor survives it", () => {
    const file = store();
    // Older-than-the-cap records first, then the genuine nearest ancestor
    // last: the scan keeps the NEWEST slice, so the answer must not change.
    const old = Array.from({ length: ANCESTRY_SCAN_LIMIT + 5 }, (_, i) =>
      rec(`old-${i}`, "c1", counts(9)),
    );
    appendJsonl(file, trendRecordSchema, [...old, rec("nearest", "c2", counts(5))]);
    const result = aggregateTrends({
      repoRoot: "/repo",
      storePath: file,
      headSha: "head",
      scopeKind: "branch",
      current: counts(2),
      currentRecordId: "self",
      ancestry: linearAncestry,
      exists: allExist,
    });
    expect(result.declarations.join(" ")).toContain(`capped at the newest ${ANCESTRY_SCAN_LIMIT}`);
    expect(result.previous?.runId).toBe("nearest");
  });

  it("a record whose recordId is not its content address cannot win the tiebreak", () => {
    // `trends.jsonl` is committed and `merge=union`'d in from other clones.
    // With an unverified id, one hand-written line claiming `ffff…` beat every
    // genuine record and became the delta baseline.
    const file = store();
    const genuine = rec("genuine", "c2", counts(5));
    const forged = { ...rec("forged", "c2", counts(99)), recordId: "f".repeat(64) };
    writeFileSync(file, `${JSON.stringify(forged)}\n${JSON.stringify(genuine)}\n`);
    const result = aggregateTrends({
      repoRoot: "/repo",
      storePath: file,
      headSha: "head",
      scopeKind: "branch",
      current: counts(2),
      currentRecordId: "self",
      ancestry: linearAncestry,
      exists: allExist,
    });
    expect(result.previous?.runId).toBe("genuine");
    expect(result.declarations.join(" ")).toContain("content address");
  });

  it("reports a delta for an axiom that STOPPED producing findings", () => {
    const file = store();
    appendJsonl(file, trendRecordSchema, [rec("r1", "c2", { "1": { error: 3, warning: 0, info: 0 } })]);
    const result = aggregateTrends({
      repoRoot: "/repo",
      storePath: file,
      headSha: "head",
      scopeKind: "branch",
      current: {},
      currentRecordId: "self",
      ancestry: linearAncestry,
      exists: allExist,
    });
    expect(result.deltas).toEqual([{ axiom: "1", error: -3, warning: 0, info: 0 }]);
  });

  it("declares an unreadable store instead of pretending it is empty", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-trends-"));
    tempDirs.push(dir);
    // A DIRECTORY where the store should be: readable-as-absent would be a lie.
    const asDir = path.join(dir, "trends.jsonl");
    mkdirSync(asDir);
    const result = aggregateTrends({
      repoRoot: "/repo",
      storePath: asDir,
      headSha: "head",
      scopeKind: "branch",
      current: counts(1),
      currentRecordId: "self",
      ancestry: linearAncestry,
      exists: allExist,
    });
    expect(result.coldStart).toBe(true);
    expect(result.declarations.join(" ")).toContain("unreadable");
  });
});
