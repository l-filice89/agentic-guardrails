/**
 * The COMMITTED history plane (Story 1.16): `_agentic-guardrails/history/
 * trends.jsonl` and `dispositions.jsonl`. Append-only JSONL, one record per
 * line, unioned across concurrent branches by the `history/*.jsonl
 * merge=union` attribute `init` wires in (1.8).
 *
 * Why not `ensureLines` (the existing append-missing-lines primitive)? It
 * dedupes by LINE CONTENT, so a legitimately repeated record — two runs that
 * genuinely produced the same bytes — would be silently dropped, and it
 * rewrites the whole file on every append. Records here are deduped by
 * `recordId` (their content ADDRESS), which is a different question with a
 * different answer, so this is a real append instead.
 *
 * Two failure modes are designed for rather than assumed away:
 *
 *   TORN TAIL. A process killed mid-append leaves a partial last line. The
 *   next append REPAIRS it before writing, and every read skips it — because
 *   appending onto a torn line would fuse two records into one unparseable
 *   one, and one bad byte at the end must never make the whole store
 *   unreadable. "Torn" means UNPARSEABLE, not merely unterminated: a complete
 *   record that lost only its `\n` is a good record, the reader returns it as
 *   one, and truncating it would DELETE it from committed history — from every
 *   clone — while reporting a successful repair. That one gets its newline
 *   back instead.
 *
 *   UNTRUSTED CONTENT. These files are committed, hand-editable, and merged
 *   from other clones. Every line is parsed through its Zod schema on read;
 *   an invalid line is SKIPPED and DECLARED, never trusted and never fatal.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  truncateSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import {
  dispositionRecordSchema,
  makeDispositionRecord,
  type Disposition,
  type DispositionRecord,
} from "@agentic-guardrails/contracts";
import type { z } from "zod";

import { fsPath } from "../git/worktree.js";

/** Repo-relative path of the committed history directory. */
export const HISTORY_DIR = "_agentic-guardrails/history";
/** Repo-relative path of the committed trend store. */
export const TRENDS_PATH = `${HISTORY_DIR}/trends.jsonl`;
/** Repo-relative path of the committed DR-1 disposition store. */
export const DISPOSITIONS_PATH = `${HISTORY_DIR}/dispositions.jsonl`;

/** Anything carrying the content-addressed id both stores dedupe on. */
interface HasRecordId {
  recordId: string;
}

export interface JsonlReadResult<T> {
  /** Schema-valid records, in file order, deduped on `recordId` (first wins
   * — `merge=union` can interleave a byte-identical line twice). */
  records: T[];
  /** One line per skipped record, naming WHY (1-based line number + reason).
   * The caller declares these; they are never silently dropped. */
  declarations: string[];
  /** How many lines were present in total (valid + skipped) — the input to
   * the caller's "is this store trustworthy at all?" decision. */
  lines: number;
  /** Lines that could not be used, i.e. `declarations.length`. Reported
   * explicitly because `lines - records.length` is NOT this number: a
   * `merge=union`'d duplicate is deduped out of `records` while being a
   * perfectly healthy line, and counting it as "unusable" is how a healthy
   * store with duplicates falsely trips the cold-start ratio. */
  skipped: number;
}

/**
 * Reads a JSONL store, validating every line before trusting it. A MISSING
 * file is a normal first run: an empty result with no declarations, never a
 * degradation. Any other read failure is a typed failure — an unreadable
 * store is not an empty one.
 */
export function readJsonl<T extends HasRecordId>(
  filePath: string,
  schema: z.ZodType<T>,
): { ok: true; value: JsonlReadResult<T> } | { ok: false; reason: string } {
  let text: string;
  try {
    text = readFileSync(fsPath(filePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, value: { records: [], declarations: [], lines: 0, skipped: 0 } };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `${path.basename(filePath)}: read error: ${message}` };
  }
  const records: T[] = [];
  const declarations: string[] = [];
  const seen = new Set<string>();
  // A file that does not end in a newline has a TORN final record (a killed
  // writer). Split on the separator and treat that tail as its own line so it
  // is reported by number, exactly like any other invalid line.
  const torn = text.length > 0 && !text.endsWith("\n");
  const rawLines = text.split("\n");
  if (!torn) rawLines.pop(); // the empty string after the final newline
  let lines = 0;
  rawLines.forEach((raw, index) => {
    const line = raw.replace(/\r$/, ""); // a CRLF checkout must still parse
    if (line.trim().length === 0) return; // blank padding is not a record
    lines += 1;
    const number = index + 1;
    const isTornTail = torn && index === rawLines.length - 1;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(line);
    } catch {
      declarations.push(
        isTornTail
          ? `line ${number}: torn final record (a writer was killed mid-append) — skipped`
          : `line ${number}: not valid JSON — skipped`,
      );
      return;
    }
    const parsed = schema.safeParse(parsedJson);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue === undefined ? "(root)" : issue.path.map(String).join(".") || "(root)";
      declarations.push(
        `line ${number}: ${where}: ${issue?.message ?? "unknown issue"} — skipped`,
      );
      return;
    }
    // `merge=union` collapses byte-identical lines but happily keeps two
    // records that differ only in whitespace: dedupe on the id, not the bytes.
    if (seen.has(parsed.data.recordId)) return;
    seen.add(parsed.data.recordId);
    records.push(parsed.data);
  });
  return { ok: true, value: { records, declarations, lines, skipped: declarations.length } };
}

export interface AppendResult {
  /** Records actually written (already-present `recordId`s are skipped). */
  appended: number;
  /** Records skipped because their `recordId` was already in the store —
   * the writer half of the idempotency contract. */
  skipped: number;
  /** true → a torn trailing record was repaired before this append. */
  repaired: boolean;
}

/**
 * Appends records to a JSONL store, idempotently on `recordId`.
 *
 * VALIDATE BEFORE WRITE. Every record is parsed through `schema` first, and a
 * failure aborts the whole append with a typed reason. This store is
 * COMMITTED, merged into other clones and read back by everything downstream:
 * a record that no later read can parse is not a warning, it is a line that
 * counts against the cold-start ratio forever. The reader validates because
 * the file is untrusted; the writer validates because WE are the last place
 * that can still refuse.
 *
 * WHAT "ATOMIC" ACTUALLY MEANS HERE, precisely, because the word is doing
 * less work than it looks like it is:
 *
 *   - The payload is written with ONE `open("a")` + looped `write()` + fsync.
 *     `writeSync` can short-write, so the loop is what makes "one record per
 *     line" true rather than hoped for; O_APPEND is what keeps a concurrent
 *     process from interleaving INTO our offset.
 *   - Idempotency is a read-then-append, so it is NOT concurrency-safe: two
 *     processes appending the same record at the same moment both scan, both
 *     miss, and both write. That is a duplicate LINE with an identical
 *     `recordId`, which every reader dedupes on — the cost is a wasted line,
 *     not a wrong answer. A lock is the upgrade if that ever matters.
 *   - The torn-tail repair truncates IN PLACE rather than going through
 *     `writeFileAtomic`: a temp-file rename would orphan the inode a
 *     concurrent `"a"` handle is writing into (POSIX) or fail outright while
 *     that handle is open (Windows).
 *
 * ponytail: the existing-id scan reads the whole file per append. These
 * stores are one compact line per run and this is one read on a path that
 * already does far more I/O; if history ever outgrows that, keep an index
 * beside the file rather than making the append non-idempotent.
 */
export function appendJsonl<T extends HasRecordId>(
  filePath: string,
  schema: z.ZodType<T>,
  records: readonly T[],
): { ok: true; value: AppendResult } | { ok: false; reason: string } {
  const name = path.basename(filePath);
  for (const record of records) {
    const parsed = schema.safeParse(record);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue === undefined ? "(root)" : issue.path.map(String).join(".") || "(root)";
      return {
        ok: false,
        reason: `${name}: refusing to write an invalid record: ${where}: ${issue?.message ?? "unknown issue"}`,
      };
    }
  }

  try {
    mkdirSync(fsPath(path.dirname(filePath)), { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `history directory not writable: ${message}` };
  }

  let existing = "";
  try {
    existing = readFileSync(fsPath(filePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `${name}: read error: ${message}` };
    }
  }

  let repaired = false;
  let prefix = "";
  if (existing.length > 0 && !existing.endsWith("\n")) {
    const start = existing.lastIndexOf("\n") + 1;
    const tail = existing.slice(start);
    if (parses(tail)) {
      // A COMPLETE record that lost only its terminator. `readJsonl` returns
      // it as a good record, so truncating here would delete a record the
      // reader was reporting — permanently, from every clone — while
      // announcing a successful repair. It costs one byte to keep it.
      prefix = "\n";
      existing += "\n";
    } else {
      const keep = existing.slice(0, start);
      try {
        truncateSync(fsPath(filePath), Buffer.byteLength(keep, "utf8"));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: `${name}: torn-tail repair failed: ${message}` };
      }
      existing = keep;
      repaired = true;
    }
  }

  // Only the ids matter here, so an invalid line is simply not a claimed id —
  // reading needs the schema, deduping does not.
  const present = new Set<string>();
  for (const line of existing.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const id = (JSON.parse(line) as { recordId?: unknown }).recordId;
      if (typeof id === "string") present.add(id);
    } catch {
      // Unparseable line: it claims no id, so it blocks nothing.
    }
  }

  // Deduped against the BATCH as well as the file: two findings can share one
  // `findingId` (the same rule firing twice on one symbol — see `merge.ts`),
  // which makes two byte-identical records in a single call, and a filter
  // that only looks at the file would write both.
  const fresh: T[] = [];
  for (const record of records) {
    if (present.has(record.recordId)) continue;
    present.add(record.recordId);
    fresh.push(record);
  }
  const skipped = records.length - fresh.length;
  if (fresh.length === 0 && prefix === "") {
    return { ok: true, value: { appended: 0, skipped, repaired } };
  }

  // `\n`, never the platform EOL: these lines are merged by git across
  // machines, and a CRLF/LF mix would make `merge=union` treat identical
  // records as different lines.
  const payload = prefix + fresh.map((record) => `${JSON.stringify(record)}\n`).join("");
  try {
    const fd = openSync(fsPath(filePath), "a");
    try {
      // `writeSync` may write FEWER bytes than it was given and Node does not
      // loop for us; without this a partial write leaves a torn record behind
      // and still reports success.
      const bytes = Buffer.from(payload, "utf8");
      let written = 0;
      while (written < bytes.length) {
        written += writeSync(fd, bytes, written, bytes.length - written);
      }
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `${name}: append failed: ${message}` };
  }
  return { ok: true, value: { appended: fresh.length, skipped, repaired } };
}

/** Is this line a complete JSON value? The reader's own criterion for "not
 * torn", so writer and reader can never disagree about which lines exist. */
function parses(line: string): boolean {
  if (line.trim().length === 0) return false;
  try {
    JSON.parse(line.replace(/\r$/, ""));
    return true;
  } catch {
    return false;
  }
}

/**
 * Appends DR-1 disposition records so that "latest wins" is a property of the
 * FILE, not a comment about it.
 *
 * The record id hashes the answer AND a per-key revision, so this is the one
 * place that knows what revision an answer is: the store's last record for
 * `{runId, findingId}` decides. An identical re-answer appends nothing (the
 * revision is not bumped, so the id is one already present); a changed answer
 * — including one that reverts to an earlier answer — appends the next
 * revision and therefore genuinely becomes the latest.
 */
export function appendDispositions(
  filePath: string,
  entries: readonly { runId: string; findingId: string; disposition: Disposition }[],
): { ok: true; value: AppendResult } | { ok: false; reason: string } {
  const read = readJsonl(filePath, dispositionRecordSchema);
  if (!read.ok) return read;
  const latest = new Map<string, DispositionRecord>();
  for (const record of read.value.records) {
    const key = `${record.key.runId} ${record.key.findingId}`;
    const current = latest.get(key);
    // File order is append order; a higher revision is later by construction,
    // and `merge=union` can interleave the two orders.
    if (current === undefined || record.revision >= current.revision) latest.set(key, record);
  }
  const records: DispositionRecord[] = [];
  for (const entry of entries) {
    const key = `${entry.runId} ${entry.findingId}`;
    const current = latest.get(key);
    if (current !== undefined && current.disposition === entry.disposition) continue;
    const record = makeDispositionRecord({
      schemaVersion: 1,
      key: { runId: entry.runId, findingId: entry.findingId },
      disposition: entry.disposition,
      revision: current === undefined ? 0 : current.revision + 1,
    });
    // In-batch too: two findings can share a `findingId`, and the second must
    // see the first's revision rather than recomputing the same id.
    latest.set(key, record);
    records.push(record);
  }
  const skipped = entries.length - records.length;
  if (records.length === 0) return { ok: true, value: { appended: 0, skipped, repaired: false } };
  const appended = appendJsonl(filePath, dispositionRecordSchema, records);
  if (!appended.ok) return appended;
  return {
    ok: true,
    value: { ...appended.value, skipped: appended.value.skipped + skipped },
  };
}
