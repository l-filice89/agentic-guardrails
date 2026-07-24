import { z } from "zod";

/**
 * Story 1.8 bootstrap schemas for the two committed knowledge files `init`
 * seeds: `conventions.yaml` (the disposition/convention ledger) and
 * `corpus-map.yaml` (the human-confirmed corpus layer). Full ledger
 * semantics are Epic 4 — these schemas are deliberately just enough that
 * "empty-but-valid" is machine-checkable.
 */
// ponytail: z.never() elements — any premature content is rejected; Epic 4
// replaces them with real convention/corpus entry schemas.
export const conventionsFileSchema = z.strictObject({
  // literal(1): a future-versioned file must not parse green as v1.
  schemaVersion: z.literal(1),
  conventions: z.array(z.never()),
});
export type ConventionsFile = z.infer<typeof conventionsFileSchema>;

export const corpusMapFileSchema = z.strictObject({
  // literal(1): a future-versioned file must not parse green as v1.
  schemaVersion: z.literal(1),
  humanConfirmed: z.array(z.never()),
});
export type CorpusMapFile = z.infer<typeof corpusMapFileSchema>;
