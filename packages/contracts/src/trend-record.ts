import { z } from "zod";

/**
 * OD-1 trend record: raw severity counts per axiom for one commit — the
 * score is a derived *view* computed elsewhere, never stored here.
 *
 * Persisted artifact: carries `schemaVersion` (integer, starts at 1).
 */
export const trendRecordSchema = z.strictObject({
  schemaVersion: z.int().min(1),
  recordId: z.string().min(1),
  commitSha: z.string().min(1),
  /** axiom id → counts by severity (raw counts only). */
  axiomSeverityCounts: z.record(
    z.string(),
    z.strictObject({
      error: z.int().min(0),
      warning: z.int().min(0),
      info: z.int().min(0),
    }),
  ),
  /** Changed thousands-of-lines-of-code in the measured range. */
  changedKloc: z.number().min(0),
});

export type TrendRecord = z.infer<typeof trendRecordSchema>;
