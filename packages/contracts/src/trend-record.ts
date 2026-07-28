// node:crypto is a Node builtin, not a runtime *dependency* — zod stays the
// only entry in `dependencies` (ADR-005 / Story 1.2 boundary).
import { createHash } from "node:crypto";
import { z } from "zod";

import { scopeKindSchema } from "./run-manifest.js";

/** Raw per-severity finding counts for one axiom. Counts only — the OD-1
 * score is a DERIVED view (FR-14), so a formula change never poisons
 * history and every historical score stays recomputable. */
export const severityCountsSchema = z.strictObject({
  error: z.int().min(0),
  warning: z.int().min(0),
  info: z.int().min(0),
});

export type SeverityCounts = z.infer<typeof severityCountsSchema>;

/**
 * OD-1 trend record: ONE record per run, carrying every axiom's raw severity
 * counts for the commit that run reviewed.
 *
 * SHAPE DEVIATION FROM architecture.md (1.16, deliberate): the architecture
 * describes `recordId` as a content hash of `{run-id, axiom, scoreKind}` —
 * one record per axiom per run — which this one-record-per-run shape cannot
 * express. Zero records existed anywhere when 1.16 landed, so the conflict is
 * resolved in favour of the shipped shape (one append per run keeps
 * `merge=union` cheap) and `recordId` is restated as a content hash of the
 * record's own identifying inputs (see {@link computeTrendRecordId}).
 * `scoreKind` is dropped: it appears nowhere in the code, and since the score
 * is a derived view there is no score *kind* to record.
 *
 * `changedKlocMilli` rather than a fractional `changedKloc`: the OD-1 score
 * must serialize identically on every platform, so every persisted number in
 * the scoring path is an INTEGER and no raw IEEE double is ever handed to
 * `JSON.stringify`. Thousandths of a KLOC are exactly lines-of-change, so the
 * unit costs nothing: `changedKloc = changedKlocMilli / 1000`.
 *
 * Persisted artifact: carries `schemaVersion` (integer, starts at 1).
 */
const trendRecordShape = z.strictObject({
  schemaVersion: z.int().min(1),
  recordId: z.string().min(1),
  /** The run this record came from — the join key to `dispositionRecord`,
   * whose key is `{runId, findingId}`. */
  runId: z.string().min(1),
  /** The commit the run REVIEWED. For the `uncommitted` scope this is
   * `headSha()`, so two different working-tree states share one sha: git
   * ancestry cannot separate them and `recordId` is the tiebreak. The
   * ordering over this store is a PARTIAL order, never a total one. */
  commitSha: z.string().min(1),
  /** FR-15's delta rule needs to compare like with like. Deliberately NOT
   * accompanied by a branch field: branch names are renamed, deleted and
   * reused, so ancestry — not a name — is the honest ordering. */
  scopeKind: scopeKindSchema,
  /** axiom id → counts by severity (raw counts only). */
  axiomSeverityCounts: z.record(z.string(), severityCountsSchema),
  /** Changed lines (added + deleted) after the 0.1-KLOC floor — the OD-1
   * denominator, in thousandths of a KLOC. Integer by design (see above).
   * ABSENT for a scope with no denominator by construction (`project`): a
   * fabricated denominator is exactly what FR-14 forbids. */
  changedKlocMilli: z.int().min(0).optional(),
});

/**
 * The record as every reader must see it: the shape ABOVE plus a verification
 * that `recordId` really is the content address of the rest of the record.
 *
 * Without this the id is attacker-chosen text. `trends.jsonl` is committed and
 * `merge=union`'d in from other clones, and the aggregator's declared tiebreak
 * is "highest `recordId` wins" — so one hand-written line carrying
 * `"ffff…"` would beat every genuine record and become the delta baseline.
 * Recomputing the hash makes the id a fact about the content instead of a
 * claim about it, so the tiebreak cannot be gamed and a tampered record is
 * skipped-and-declared like any other invalid line.
 */
export const trendRecordSchema = trendRecordShape.refine(
  (record) => record.recordId === computeTrendRecordId(record),
  { error: "recordId is not the content address of this record" },
);

export type TrendRecord = z.infer<typeof trendRecordShape>;

/** The identifying inputs of a trend record — everything but the id itself. */
export type TrendRecordIdentity = Omit<TrendRecord, "recordId">;

/**
 * Stable identity for a trend record: sha256-hex over its identifying inputs
 * in fixed order. Two properties depend on this being a pure content hash:
 *
 * 1. **Idempotency.** `.gitattributes merge=union` is line-based, so it
 *    collapses byte-identical lines and interleaves the rest. A re-run of an
 *    identical review recomputes the identical id, the writer skips it, and
 *    the aggregator dedupes on it — both halves, so neither a duplicate
 *    append nor a unioned duplicate can double-count a run.
 * 2. **Tiebreak.** Two `uncommitted`-scope runs share one `commitSha`, so
 *    ancestry cannot order them; the id is the stable, declared tiebreak.
 *
 * NOTHING derived from `manifest.cache` may reach this hash — cache hit/miss
 * counters are runtime truth, not run identity, and are the one field
 * normalized out of every byte-identity comparison.
 */
export function computeTrendRecordId(identity: TrendRecordIdentity): string {
  return createHash("sha256")
    .update(
      // Fixed-order JSON with axiom keys SORTED: a record must hash the same
      // however the analyzer map happened to be built this run.
      JSON.stringify([
        identity.schemaVersion,
        identity.runId,
        identity.commitSha,
        identity.scopeKind,
        Object.keys(identity.axiomSeverityCounts)
          .sort()
          .map((axiom) => [axiom, identity.axiomSeverityCounts[axiom]]),
        // `undefined` serializes as `null` inside an array — stable across
        // platforms, and distinct from any integer denominator.
        identity.changedKlocMilli,
      ]),
    )
    .digest("hex");
}

/** Builds a trend record with its content-addressed id already stamped. */
export function makeTrendRecord(identity: TrendRecordIdentity): TrendRecord {
  return { ...identity, recordId: computeTrendRecordId(identity) };
}
