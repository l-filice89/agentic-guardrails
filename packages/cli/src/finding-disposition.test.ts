/**
 * DR-1 finding dispositions (1.16): the non-interactive short-circuit, the
 * configured policy, the interactive loop, EOF/Ctrl-C safety, and the fact
 * that none of it can touch the exit code or the artifact disposition.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  dispositionRecordSchema,
  type Finding,
} from "@agentic-guardrails/contracts";
import { DISPOSITIONS_PATH } from "@agentic-guardrails/core";
import { afterEach, describe, expect, it } from "vitest";

import { disposeFindings } from "./finding-disposition.js";
import type { QuestionSource } from "./init-command.js";

const tempDirs: string[] = [];

function tempRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-dr1-"));
  tempDirs.push(dir);
  return dir;
}

function finding(id: string, ruleId = "structural/cycle"): Finding {
  return {
    findingId: id,
    axiom: "1",
    ruleId,
    location: { file: "src/a.ts", startLine: 3, endLine: 3 },
    severity: "error",
    message: "m",
    source: "ast",
    confidence: "high",
    evidence: [],
    remediation: "fix it",
  } as unknown as Finding;
}

/** A prompt source that answers from a script and then behaves like EOF. */
function scripted(answers: string[]): QuestionSource & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    question: async (prompt: string) => {
      asked.push(prompt);
      return Promise.resolve(answers.shift() ?? "");
    },
    once: () => undefined,
  };
}

function storedRecords(repo: string): unknown[] {
  const text = readFileSync(path.join(repo, DISPOSITIONS_PATH), "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("non-interactive — nothing may ever block", () => {
  it("the default policy records NOTHING and never touches readline", async () => {
    const repo = tempRepo();
    // No `io` seam is supplied: if the loop reached readline it would try to
    // build one over a non-TTY stdin, which is exactly the hang under test.
    const result = await disposeFindings({
      repoRoot: repo,
      runId: "run-1",
      findings: [finding("f1"), finding("f2")],
      interactive: false,
      policy: "skip",
    });
    expect(result).toEqual({ lines: [], recorded: 0 });
    expect(() => storedRecords(repo)).toThrow(); // no file written at all
  });

  it('the "deferred" policy records every finding as explicitly un-triaged', async () => {
    const repo = tempRepo();
    const result = await disposeFindings({
      repoRoot: repo,
      runId: "run-1",
      findings: [finding("f1"), finding("f2")],
      interactive: false,
      policy: "deferred",
    });
    expect(result.recorded).toBe(2);
    const records = storedRecords(repo);
    expect(records).toHaveLength(2);
    for (const record of records) {
      const parsed = dispositionRecordSchema.safeParse(record);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.disposition).toBe("deferred");
        expect(parsed.data.key.runId).toBe("run-1");
      }
    }
  });

  it("a run with no findings says nothing at all", async () => {
    const result = await disposeFindings({
      repoRoot: tempRepo(),
      runId: "run-1",
      findings: [],
      interactive: false,
      policy: "deferred",
    });
    expect(result).toEqual({ lines: [], recorded: 0 });
  });
});

describe("interactive loop", () => {
  it("maps the pinned enum's answers and skips anything else", async () => {
    const repo = tempRepo();
    const io = scripted(["a", "n", "d", "wat"]);
    const result = await disposeFindings({
      repoRoot: repo,
      runId: "run-1",
      findings: [finding("f1"), finding("f2"), finding("f3"), finding("f4")],
      interactive: true,
      policy: "skip",
      io,
    });
    expect(io.asked).toHaveLength(4);
    expect(result.recorded).toBe(3);
    const dispositions = storedRecords(repo).map(
      (r) => (r as { disposition: string }).disposition,
    );
    expect(dispositions).toEqual(["actionable", "not-actionable", "deferred"]);
  });

  it("treats a PROTOTYPE key as an unrecognised answer, not a disposition", async () => {
    // `ANSWERS["__proto__"]` on an object literal resolves up the prototype
    // chain, so the `=== undefined` skip guard let it through: one record was
    // written with `disposition` DROPPED and one with `"disposition":{}`, both
    // schema-invalid in COMMITTED history, and the report claimed success.
    const repo = tempRepo();
    const result = await disposeFindings({
      repoRoot: repo,
      runId: "run-1",
      findings: [finding("f1"), finding("f2")],
      interactive: true,
      policy: "skip",
      io: scripted(["__proto__", "constructor"]),
    });
    expect(result).toEqual({ lines: [], recorded: 0 });
    expect(() => storedRecords(repo)).toThrow(); // nothing written at all
  });

  it("SANITIZES the path and ruleId it prints — both come from the analyzed repo", () => {
    // ESC as a code point, never a literal, so no control character lands in
    // this source file.
    const esc = String.fromCharCode(0x1b);
    const io = scripted(["s"]);
    const hostile = finding("f1", `rule${esc}[31m`);
    (hostile as { location: { file: string; startLine: number; endLine: number } }).location = {
      file: `src/${esc}[2Ja.ts`,
      startLine: 3,
      endLine: 3,
    };
    return disposeFindings({
      repoRoot: tempRepo(),
      runId: "run-1",
      findings: [hostile],
      interactive: true,
      policy: "skip",
      io,
    }).then(() => {
      expect(io.asked[0]).not.toContain(esc);
      expect(io.asked[0]).toContain("src/[2Ja.ts");
      expect(io.asked[0]).toContain("rule[31m");
    });
  });

  it("EOF mid-loop leaves the rest UNLABELLED instead of fabricating answers", async () => {
    const repo = tempRepo();
    // "" for everything after the first answer — what `eofSafeIo` returns
    // once stdin is closed.
    const result = await disposeFindings({
      repoRoot: repo,
      runId: "run-1",
      findings: [finding("f1"), finding("f2"), finding("f3")],
      interactive: true,
      policy: "skip",
      io: scripted(["a"]),
    });
    expect(result.recorded).toBe(1);
    expect(storedRecords(repo)).toHaveLength(1);
  });

  it("registers a SIGINT handler so Ctrl-C settles through the EOF default", async () => {
    const events: string[] = [];
    const io: QuestionSource = {
      question: async () => Promise.resolve(""),
      once: (event) => {
        events.push(event);
        return undefined;
      },
    };
    await disposeFindings({
      repoRoot: tempRepo(),
      runId: "run-1",
      findings: [finding("f1")],
      interactive: true,
      policy: "skip",
      io,
    });
    // `close` comes from eofSafeIo, `SIGINT` from this loop — without the
    // latter readline exits 130 and throws away a decided gate verdict.
    expect(events).toContain("SIGINT");
  });

  it("the SIGINT handler BODY closes the interface", async () => {
    // Asserting only that a listener was registered would stay green if the
    // handler were gutted — which is exactly the regression to readline's
    // exit(130) that the listener exists to prevent.
    const handlers = new Map<string, () => void>();
    let closed = 0;
    const io: QuestionSource & { close: () => void } = {
      question: async () => Promise.resolve(""),
      once: (event: string, handler: () => void) => {
        handlers.set(event, handler);
        return undefined;
      },
      close: () => {
        closed += 1;
      },
    } as unknown as QuestionSource & { close: () => void };
    await disposeFindings({
      repoRoot: tempRepo(),
      runId: "run-1",
      findings: [finding("f1")],
      interactive: true,
      policy: "skip",
      io,
    });
    const sigint = handlers.get("SIGINT");
    expect(sigint).toBeTypeOf("function");
    sigint?.();
    expect(closed).toBe(1);
  });

  it("records nothing when every finding is skipped, and stays silent", async () => {
    const repo = tempRepo();
    const result = await disposeFindings({
      repoRoot: repo,
      runId: "run-1",
      findings: [finding("f1")],
      interactive: true,
      policy: "skip",
      io: scripted([""]),
    });
    expect(result).toEqual({ lines: [], recorded: 0 });
  });
});

describe("idempotency and failure", () => {
  it("an identical re-answer appends nothing; a CHANGED answer is kept", async () => {
    const repo = tempRepo();
    const options = {
      repoRoot: repo,
      runId: "run-1",
      findings: [finding("f1")],
      interactive: true,
      policy: "skip" as const,
    };
    await disposeFindings({ ...options, io: scripted(["a"]) });
    const again = await disposeFindings({ ...options, io: scripted(["a"]) });
    expect(again.recorded).toBe(0);
    expect(again.lines[0]).toContain("already recorded");
    // A correction must NOT collide with the original and vanish.
    const corrected = await disposeFindings({ ...options, io: scripted(["n"]) });
    expect(corrected.recorded).toBe(1);
    expect(storedRecords(repo)).toHaveLength(2);
  });

  it("a history-write failure is LOUD and still never fails the run", async () => {
    const result = await disposeFindings({
      repoRoot: tempRepo(),
      runId: "run-1",
      findings: [finding("f1")],
      interactive: false,
      policy: "deferred",
      append: () => ({ ok: false, reason: "disk on fire" }),
    });
    expect(result.recorded).toBe(0);
    expect(result.lines[0]).toBe("degraded: dispositions not recorded: disk on fire");
  });
});
