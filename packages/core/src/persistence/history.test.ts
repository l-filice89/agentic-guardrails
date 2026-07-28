/**
 * The committed history plane (1.16): a real append, idempotent on
 * `recordId`, with torn-tail read-repair and validate-before-trust reads.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { dispositionRecordSchema } from "@agentic-guardrails/contracts";

import { appendDispositions, appendJsonl, readJsonl, TRENDS_PATH } from "./history.js";

const schema = z.strictObject({ recordId: z.string().min(1), n: z.int() });
type Record_ = z.infer<typeof schema>;

const tempDirs: string[] = [];

function store(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-history-"));
  tempDirs.push(dir);
  // The tests that seed a file directly need the directory; `appendJsonl`
  // creates it itself (asserted below).
  mkdirSync(path.join(dir, "history"), { recursive: true });
  return path.join(dir, "history", "trends.jsonl");
}

function record(id: string, n: number): Record_ {
  return { recordId: id, n };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readJsonl — validate before trust", () => {
  it("a MISSING file is a normal first run, not a degradation", () => {
    const read = readJsonl(store(), schema);
    expect(read).toEqual({
      ok: true,
      value: { records: [], declarations: [], lines: 0, skipped: 0 },
    });
  });

  it("skips and DECLARES a line that fails the schema, keeping the rest usable", () => {
    const file = store();
    appendJsonl(file, schema, [record("a", 1)]);
    writeFileSync(
      file,
      `${JSON.stringify(record("a", 1))}\n{"recordId":"b","n":"not an int"}\nnot json at all\n${JSON.stringify(record("c", 3))}\n`,
    );
    const read = readJsonl(file, schema);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.records.map((r) => r.recordId)).toEqual(["a", "c"]);
    expect(read.value.lines).toBe(4);
    expect(read.value.declarations).toHaveLength(2);
    expect(read.value.declarations[0]).toContain("line 2");
    expect(read.value.declarations[1]).toContain("line 3");
  });

  it("declares a TORN final record and still returns everything before it", () => {
    const file = store();
    appendJsonl(file, schema, [record("a", 1)]);
    // A writer killed mid-append: no trailing newline, half a record.
    writeFileSync(file, `${JSON.stringify(record("a", 1))}\n{"recordId":"b","n":`);
    const read = readJsonl(file, schema);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.records.map((r) => r.recordId)).toEqual(["a"]);
    expect(read.value.declarations[0]).toContain("torn final record");
  });

  it("dedupes on recordId — `merge=union` can interleave a record twice", () => {
    const file = store();
    const line = `${JSON.stringify(record("a", 1))}\n`;
    writeFileSync(file, line + line + `${JSON.stringify(record("b", 2))}\n`);
    const read = readJsonl(file, schema);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value.records.map((r) => r.recordId)).toEqual(["a", "b"]);
  });

  it("parses a CRLF checkout", () => {
    const file = store();
    appendJsonl(file, schema, [record("a", 1)]);
    writeFileSync(file, `${JSON.stringify(record("a", 1))}\r\n`);
    const read = readJsonl(file, schema);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value.records).toHaveLength(1);
  });
});

describe("appendJsonl — a real append, not `ensureLines`", () => {
  it("creates a missing history directory rather than failing the run", () => {
    const nested = path.join(path.dirname(store()), "deeper", "trends.jsonl");
    expect(appendJsonl(nested, schema, [record("a", 1)]).ok).toBe(true);
    expect(readFileSync(nested, "utf8")).toContain('"recordId":"a"');
  });

  it("appends and is IDEMPOTENT on recordId", () => {
    const file = store();
    expect(appendJsonl(file, schema, [record("a", 1)])).toEqual({
      ok: true,
      value: { appended: 1, skipped: 0, repaired: false },
    });
    // The re-run of an identical review: the id is already there.
    expect(appendJsonl(file, schema, [record("a", 1)])).toEqual({
      ok: true,
      value: { appended: 0, skipped: 1, repaired: false },
    });
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("keeps a legitimately REPEATED line that `ensureLines` would have dropped", () => {
    // Same payload, different id: two genuine runs. `ensureLines` dedupes by
    // line CONTENT and would still have collapsed near-identical records; the
    // id is the only thing allowed to decide.
    const file = store();
    appendJsonl(file, schema, [record("a", 7)]);
    appendJsonl(file, schema, [record("b", 7)]);
    const read = readJsonl(file, schema);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value.records).toHaveLength(2);
  });

  it("REPAIRS a torn tail before appending, so two records never fuse", () => {
    const file = store();
    appendJsonl(file, schema, [record("a", 1)]);
    writeFileSync(file, `${JSON.stringify(record("a", 1))}\n{"recordId":"torn"`);
    const appended = appendJsonl(file, schema, [record("b", 2)]);
    expect(appended).toEqual({ ok: true, value: { appended: 1, skipped: 0, repaired: true } });
    const read = readJsonl(file, schema);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.records.map((r) => r.recordId)).toEqual(["a", "b"]);
      expect(read.value.declarations).toEqual([]); // the torn line is gone, not skipped
    }
  });

  it("writes LF regardless of platform — union merges across machines", () => {
    const file = store();
    appendJsonl(file, schema, [record("a", 1), record("b", 2)]);
    expect(readFileSync(file, "utf8")).not.toContain("\r");
  });

  it("an unparseable existing line claims no id and blocks nothing", () => {
    const file = store();
    writeFileSync(file, "garbage\n");
    const appended = appendJsonl(file, schema, [record("a", 1)]);
    expect(appended.ok && appended.value.appended).toBe(1);
  });

  it("KEEPS a valid last record that merely lost its trailing newline", () => {
    // The repair used to truncate on "no trailing newline" without checking
    // whether the tail parsed — deleting a record `readJsonl` reports as good,
    // from committed history, while announcing a successful repair.
    const file = store();
    writeFileSync(file, `${JSON.stringify(record("a", 1))}\n${JSON.stringify(record("b", 2))}`);
    const appended = appendJsonl(file, schema, [record("c", 3)]);
    expect(appended).toEqual({ ok: true, value: { appended: 1, skipped: 0, repaired: false } });
    const read = readJsonl(file, schema);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.records.map((r) => r.recordId)).toEqual(["a", "b", "c"]);
      expect(read.value.declarations).toEqual([]);
    }
  });

  it("REFUSES to write a record that fails its own schema", () => {
    // A record that no later read can parse is not a warning: it is a line
    // that counts against the cold-start ratio in every clone, forever.
    const file = store();
    const bad = { recordId: "x", n: "not an int" } as unknown as Record_;
    const appended = appendJsonl(file, schema, [bad]);
    expect(appended.ok).toBe(false);
    if (!appended.ok) expect(appended.reason).toContain("refusing to write an invalid record");
    // Nothing reached the store at all — not even a file.
    expect(existsSync(file)).toBe(false);
  });

  it("dedupes byte-identical records WITHIN one batch", () => {
    const file = store();
    const appended = appendJsonl(file, schema, [record("a", 1), record("a", 1)]);
    expect(appended).toEqual({ ok: true, value: { appended: 1, skipped: 1, repaired: false } });
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("writes every byte of a multi-record payload", () => {
    // `writeSync` can short-write and Node does not loop; without the loop a
    // partial write leaves a torn record behind and still reports success.
    const file = store();
    const many = Array.from({ length: 500 }, (_, i) => record(`r${i}`, i));
    expect(appendJsonl(file, schema, many).ok).toBe(true);
    const read = readJsonl(file, schema);
    expect(read.ok && read.value.records).toHaveLength(500);
    expect(read.ok && read.value.declarations).toEqual([]);
  });
});

describe("readJsonl — hostile line shapes", () => {
  const cases: [string, string][] = [
    ["whitespace-only", "   \n"],
    ["valid JSON that is not an object", "42\n"],
    ["valid JSON for the OTHER record type", '{"key":{"runId":"r","findingId":"f"}}\n'],
  ];
  for (const [name, line] of cases) {
    it(`${name}: never a record, never a crash`, () => {
      const file = store();
      writeFileSync(file, `${JSON.stringify(record("a", 1))}\n${line}`);
      const read = readJsonl(file, schema);
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.value.records.map((r) => r.recordId)).toEqual(["a"]);
      // Blank padding is not a line at all; the others are declared.
      expect(read.value.skipped).toBe(name === "whitespace-only" ? 0 : 1);
    });
  }

  it("`skipped` counts DECLARED lines, not deduped duplicates", () => {
    // `lines - records.length` would call a healthy union-merged duplicate
    // "unusable" and cold-start a perfectly good store.
    const file = store();
    const line = `${JSON.stringify(record("a", 1))}\n`;
    writeFileSync(file, line + line + line);
    const read = readJsonl(file, schema);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.lines).toBe(3);
    expect(read.value.records).toHaveLength(1);
    expect(read.value.skipped).toBe(0);
  });
});

describe("appendDispositions — 'latest wins' is a property of the FILE", () => {
  const dispositions = (file: string): string[] => {
    const read = readJsonl(file, dispositionRecordSchema);
    return read.ok ? read.value.records.map((r) => r.disposition) : ["<unreadable>"];
  };
  const entry = (disposition: "actionable" | "not-actionable" | "deferred") => [
    { runId: "run-1", findingId: "finding-1", disposition },
  ];

  it("a REVERTED answer is recorded, not silently skipped", () => {
    const file = store();
    expect(appendDispositions(file, entry("actionable")).ok).toBe(true);
    expect(appendDispositions(file, entry("not-actionable")).ok).toBe(true);
    // Hashing the answer alone recomputes the FIRST record's id here, so the
    // idempotent writer dropped it and the store kept claiming the answer the
    // user had moved away from.
    expect(appendDispositions(file, entry("actionable")).ok).toBe(true);
    expect(dispositions(file)).toEqual(["actionable", "not-actionable", "actionable"]);
    const read = readJsonl(file, dispositionRecordSchema);
    expect(read.ok && read.value.records.map((r) => r.revision)).toEqual([0, 1, 2]);
  });

  it("an UNCHANGED re-answer still appends nothing", () => {
    const file = store();
    appendDispositions(file, entry("deferred"));
    expect(appendDispositions(file, entry("deferred"))).toEqual({
      ok: true,
      value: { appended: 0, skipped: 1, repaired: false },
    });
    expect(dispositions(file)).toEqual(["deferred"]);
  });

  it("dedupes two findings that share one findingId inside one batch", () => {
    // `merge.ts` documents that two distinct findings can share a `findingId`
    // (one rule firing twice on one symbol), which a non-interactive
    // `deferred` policy turns into two byte-identical lines.
    const file = store();
    const appended = appendDispositions(file, [...entry("deferred"), ...entry("deferred")]);
    expect(appended).toEqual({ ok: true, value: { appended: 1, skipped: 1, repaired: false } });
    expect(dispositions(file)).toEqual(["deferred"]);
  });
});

describe("store paths", () => {
  it("both stores live under the COMMITTED history directory", () => {
    expect(TRENDS_PATH).toBe("_agentic-guardrails/history/trends.jsonl");
  });
});
