/**
 * DR-1 per-finding disposition (Story 1.16) — the labelling loop the trust
 * metrics are computed from: the M1 gate's "≥70% dispositioned actionable"
 * and the "<30% not-actionable" noise counter-metric have no source without
 * it.
 *
 * INDEPENDENT of 1.15's artifact disposition. That prompt decides whether the
 * review ARTIFACT is committed or dropped; this one records how each FINDING
 * was judged. They are different questions and must not be coupled: findings
 * are dispositioned whether the artifact was committed or dropped.
 *
 * The structure is `disposition.ts`'s, deliberately verbatim, because every
 * part of it is load-bearing: the non-interactive case short-circuits BEFORE
 * readline is touched (so `--no-input`, a pipe and CI never construct an
 * interface, let alone block on one), `eofSafeIo` settles a closed stdin as
 * the default instead of hanging, SIGINT closes the interface so Ctrl-C
 * settles through that same EOF default rather than readline's exit(130), and
 * the result is `lines: string[]` for the caller to print. It NEVER affects
 * the exit code — the gate verdict is decided by findings, full stop.
 *
 * Records are append-only and carry no state machine. Whether a disposition
 * carries forward when the same `findingId` reappears in a later run is
 * explicitly 1.17's decision, not this story's.
 */
import path from "node:path";
import { createInterface } from "node:readline/promises";

import {
  type Disposition,
  type DispositionPolicy,
  type Finding,
} from "@agentic-guardrails/contracts";
import { appendDispositions, DISPOSITIONS_PATH } from "@agentic-guardrails/core";

import { eofSafeIo, type QuestionSource } from "./init-command.js";
import { sanitizeMessage } from "./sanitize.js";

export interface FindingDispositionOptions {
  repoRoot: string;
  runId: string;
  /** The findings to label — the run's own, in report order. */
  findings: readonly Finding[];
  /** false → `--no-input`, a pipe, or CI: `policy` decides, nothing blocks. */
  interactive: boolean;
  /** Non-interactive handling (config plane). */
  policy: DispositionPolicy;
  /** Test seam: the prompt source, so the EOF path needs no real TTY. */
  io?: QuestionSource;
  /** Test seam: the history append, so a write failure needs no read-only fs. */
  append?: typeof appendDispositions;
}

export interface FindingDispositionResult {
  /** Lines to report, in order — the caller owns the stream. */
  lines: string[];
  /** Records actually appended to committed history. */
  recorded: number;
}

/** Answer letters → the pinned DR-1 enum. Anything else — including "" from
 * EOF — is SKIP: a disposition nobody made is fabricated data, and DR-1's
 * metrics are only worth having if every label came from a human. */
// A `Map`, NOT an object literal: `ANSWERS["__proto__"]` on a literal resolves
// up the prototype chain and returns something that is not undefined, so the
// skip guard below would let `Object.prototype` through as a "disposition" and
// write a schema-invalid record into COMMITTED history while reporting success.
const ANSWERS = new Map<string, Disposition>([
  ["a", "actionable"],
  ["actionable", "actionable"],
  ["n", "not-actionable"],
  ["not-actionable", "not-actionable"],
  ["d", "deferred"],
  ["deferred", "deferred"],
]);

export async function disposeFindings(
  options: FindingDispositionOptions,
): Promise<FindingDispositionResult> {
  // Nothing to label, and nothing to say about it — a clean run's output must
  // not grow a line just because this feature exists.
  if (options.findings.length === 0) return { lines: [], recorded: 0 };

  // The non-interactive short-circuit comes BEFORE readline is constructed:
  // creating an interface over a pipe is what makes a CI run hang.
  if (!options.interactive) {
    if (options.policy === "skip") return { lines: [], recorded: 0 };
    // `deferred`: every finding lands in history as explicitly un-triaged.
    // Still not a fabricated judgement — "deferred" is the honest label for
    // "a machine ran this and nobody has looked yet".
    return write(
      options,
      options.findings.map((finding) => entry(options.runId, finding.findingId, "deferred")),
      `dispositioned ${options.findings.length} finding(s) as "deferred" (non-interactive policy)`,
    );
  }

  const rl = options.io ?? createInterface({ input: process.stdin, output: process.stdout });
  const entries: DispositionEntry[] = [];
  try {
    const io = eofSafeIo(rl, () =>
      process.stderr.write("guardrails review: input closed — remaining findings left unlabelled\n"),
    );
    // Ctrl-C at the prompt: readline's default SIGINT handling ends the
    // process with 130, escaping the documented 0/1/2 exit contract and
    // throwing away a gate verdict that is already decided. Closing the
    // interface settles the pending question through the EOF path instead.
    rl.once("SIGINT", () => (rl as { close?: () => void }).close?.());
    for (const finding of options.findings) {
      const answer = (
        await io.question(
          // A finding's path and ruleId come from the analyzed repository, so
          // they are exactly as untrusted as its message: same sanitizer.
          `${sanitizeMessage(finding.location.file)}:${finding.location.startLine} ` +
            `[${sanitizeMessage(finding.ruleId)}] ` +
            `disposition? [a = actionable, n = not-actionable, d = deferred, S = skip] `,
        )
      )
        .trim()
        .toLowerCase();
      const disposition = ANSWERS.get(answer);
      if (disposition === undefined) continue; // skip, including "" from EOF
      entries.push(entry(options.runId, finding.findingId, disposition));
    }
  } finally {
    // Only a readline WE created is ours to close — an injected seam is the
    // caller's.
    if (options.io === undefined) (rl as { close?: () => void }).close?.();
  }

  if (entries.length === 0) return { lines: [], recorded: 0 };
  return write(options, entries, `dispositioned ${entries.length} finding(s)`);
}

/** One answer, before the store decides what revision it is. */
type DispositionEntry = { runId: string; findingId: string; disposition: Disposition };

function entry(runId: string, findingId: string, disposition: Disposition): DispositionEntry {
  // `findingId` is `sha256([axiom, ruleId, file, enclosingSymbol])` with no
  // line numbers — which is exactly what lets a disposition survive unrelated
  // lines being added above the finding it labels.
  return { runId, findingId, disposition };
}

function write(
  options: FindingDispositionOptions,
  entries: readonly DispositionEntry[],
  summary: string,
): FindingDispositionResult {
  const store = path.join(options.repoRoot, DISPOSITIONS_PATH);
  // `appendDispositions`, not the raw JSONL append: it is the one place that
  // knows a key's current answer, which is what makes "latest wins" true of
  // the FILE (a reverted answer appends a new revision instead of colliding
  // with the record it is reverting to) and what dedupes two findings that
  // share one `findingId` within a single batch.
  const appended = (options.append ?? appendDispositions)(store, entries);
  if (!appended.ok) {
    // A history write that failed must be LOUD and must not fail the run: the
    // gate verdict is already decided, and a silently-not-recorded label is
    // how a trust metric quietly becomes fiction.
    return {
      lines: [`degraded: dispositions not recorded: ${appended.reason}`],
      recorded: 0,
    };
  }
  const skipped =
    appended.value.skipped > 0
      ? ` (${appended.value.skipped} already recorded)`
      : "";
  const declarations = (
    appended.value as typeof appended.value & { declarations?: string[] }
  ).declarations;
  return {
    lines: [
      `${summary}${skipped}: ${DISPOSITIONS_PATH}`,
      ...(declarations ?? []).map((declaration) => `declaration: ${declaration}`),
    ],
    recorded: appended.value.appended,
  };
}
