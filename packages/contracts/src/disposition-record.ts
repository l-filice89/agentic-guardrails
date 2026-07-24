import { z } from "zod";

/** DR-1 disposition enum — pinned exactly; anything else is a parse failure. */
export const dispositionSchema = z.enum(["actionable", "not-actionable", "deferred"]);

/**
 * DR-1 disposition record: one append-only history entry recording how a
 * finding was dispositioned in a given run, keyed by `{runId, findingId}`.
 *
 * Persisted artifact: carries `schemaVersion` (integer, starts at 1).
 */
export const dispositionRecordSchema = z.strictObject({
  schemaVersion: z.int().min(1),
  recordId: z.string().min(1),
  key: z.strictObject({
    runId: z.string().min(1),
    findingId: z.string().min(1),
  }),
  disposition: dispositionSchema,
});

export type Disposition = z.infer<typeof dispositionSchema>;
export type DispositionRecord = z.infer<typeof dispositionRecordSchema>;
