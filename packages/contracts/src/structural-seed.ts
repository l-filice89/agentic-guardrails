import { z } from "zod";

import { degradationSchema } from "./partial-result.js";

/**
 * One file-level entity of the Story-1.8 structural corpus seed: a merged
 * import-graph node plus its fan-in. `external: true` marks an npm package
 * specifier (e.g. "zod") rather than a repo file.
 */
export const structuralSeedEntitySchema = z.strictObject({
  /** Repo-relative `/`-separated path (or bare specifier for externals). */
  file: z.string().min(1),
  /** Number of distinct import edges pointing at this file. */
  fanIn: z.int().min(0),
  external: z.boolean(),
});

/**
 * The persisted structural corpus seed
 * (`_agentic-guardrails/.cache/corpus/structural-seed.json`). Produced by
 * `guardrails init` (1.8), validated on every read by its consumers (1.13's
 * axiom-6 conformance analyzer) — a truncated or shape-drifted seed must
 * surface as a typed `no_corpus` inconclusive result, never as a silently
 * wrong convention. Strict object: unknown keys fail parse.
 */
export const structuralSeedSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    /** Sorted by file (the graph's canonical node order). */
    entities: z.array(structuralSeedEntitySchema),
    coverage: z.number().min(0).max(1),
    degraded: z.array(degradationSchema),
  })
  // The producer's own partial-result invariant, enforced for the seed too:
  // lost coverage is ALWAYS accompanied by the reason it was lost. A seed
  // claiming `coverage: 0.4` with an empty `degraded` is a silently partial
  // census, which is exactly what the consumer must never confirm a
  // convention from.
  .refine((seed) => seed.coverage === 1 || seed.degraded.length > 0, {
    message: "partial coverage requires at least one degraded entry",
    path: ["degraded"],
  })
  // A duplicated entity double-votes in the consumer's prevalence gate.
  .refine((seed) => new Set(seed.entities.map((e) => e.file)).size === seed.entities.length, {
    message: "duplicate entity file paths",
    path: ["entities"],
  })
  // Paths are `/`-separated by contract; a win32 backslash path has no
  // directory structure to the consumer and collapses into the root bucket.
  .refine((seed) => seed.entities.every((e) => !e.file.includes("\\")), {
    message: "entity paths must be `/`-separated (no backslashes)",
    path: ["entities"],
  });

export type StructuralSeedEntity = z.infer<typeof structuralSeedEntitySchema>;
export type StructuralSeed = z.infer<typeof structuralSeedSchema>;
