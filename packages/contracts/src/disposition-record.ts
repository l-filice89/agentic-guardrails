// node:crypto is a Node builtin, not a runtime *dependency* — zod stays the
// only entry in `dependencies` (ADR-005 / Story 1.2 boundary).
import { createHash } from "node:crypto";
import { z } from "zod";

/** DR-1 disposition enum — pinned exactly; anything else is a parse failure. */
export const dispositionSchema = z.enum(["actionable", "not-actionable", "deferred"]);

/**
 * DR-1 disposition record: one append-only history entry recording how a
 * finding was dispositioned in a given run, keyed by `{runId, findingId}`.
 *
 * Persisted artifact: carries `schemaVersion` (integer, starts at 1).
 */
const dispositionRecordShape = z.strictObject({
  schemaVersion: z.int().min(1),
  recordId: z.string().min(1),
  key: z.strictObject({
    runId: z.string().min(1),
    findingId: z.string().min(1),
  }),
  disposition: dispositionSchema,
  /** How many times this `{runId, findingId}` was answered BEFORE this record
   * (0 = the first answer). "Latest wins" needs a total order over a key's
   * records, and hashing the answer alone does not give one: answering `a`,
   * then `n`, then `a` again recomputes the FIRST record's id, the idempotent
   * writer skips it, and the store is left claiming `not-actionable` while
   * the user's latest answer is `actionable`. The revision makes every
   * re-answer a genuinely new record, and an UNCHANGED re-answer is still
   * idempotent because the writer does not bump the revision for one. */
  revision: z.int().min(0),
});

/** As every reader must see it — id verified as the content address, for the
 * same reason as {@link import('./trend-record.js').trendRecordSchema}: this
 * store is committed and merged in from other clones. */
export const dispositionRecordSchema = dispositionRecordShape.refine(
  (record) => record.recordId === computeDispositionRecordId(record),
  { error: "recordId is not the content address of this record" },
);

export type Disposition = z.infer<typeof dispositionSchema>;
export type DispositionRecord = z.infer<typeof dispositionRecordShape>;

/** The identifying inputs of a disposition record — everything but the id. */
export type DispositionRecordIdentity = Omit<DispositionRecord, "recordId">;

/**
 * Stable identity for a disposition record: sha256-hex over `{schemaVersion,
 * runId, findingId, disposition}`. Same idempotency contract as the trend
 * record — `merge=union` is line-based, so a re-run that answers identically
 * recomputes the identical id and appends nothing.
 *
 * The ANSWER is part of the hash on purpose. Keying on `{runId, findingId}`
 * alone would make a corrected answer collide with the original and be
 * SKIPPED by the idempotent writer — the correction silently lost. The
 * `revision` is in the hash for the mirror-image reason: without it, REVERTING
 * to a previous answer recomputes an id that is already in the store and is
 * skipped too, so "latest wins" would report the answer the user moved away
 * from. With both, an unchanged re-answer appends nothing and every genuine
 * change appends exactly one record.
 */
export function computeDispositionRecordId(identity: DispositionRecordIdentity): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        identity.schemaVersion,
        identity.key.runId,
        identity.key.findingId,
        identity.disposition,
        identity.revision,
      ]),
    )
    .digest("hex");
}

/** Builds a disposition record with its content-addressed id stamped. */
export function makeDispositionRecord(
  identity: DispositionRecordIdentity,
): DispositionRecord {
  return { ...identity, recordId: computeDispositionRecordId(identity) };
}
