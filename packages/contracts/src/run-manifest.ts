import { z } from "zod";

import { enforcementSchema } from "./config.js";

/**
 * RunManifest — the zero-silent-degradation carrier. Every run records
 * exactly what analyzed what: content hashes, versions, which tiers were
 * enabled, and (when the LLM tier ran) which model — including where that
 * model identity came from (`modelIdentity.source`), so an assumed identity
 * can never masquerade as a reported one.
 *
 * Persisted artifact: carries `schemaVersion` (integer, starts at 1) and
 * evolves via the migration ladder in `migration.ts`.
 */
export const runManifestSchema = z
  .strictObject({
    schemaVersion: z.int().min(1),
    ledgerHash: z.string().min(1),
    /** sha256 of the COMMITTED `_agentic-guardrails/corpus-map.yaml` bytes
     * (1.8) — the human-curated corpus baseline. NOT the structural corpus
     * seed axiom 6 judges against: see `corpusSeedHash`. */
    corpusHash: z.string().min(1),
    /** sha256 of the derived structural corpus seed
     * (`_agentic-guardrails/.cache/corpus/structural-seed.json`, 1.8) — the
     * corpus axiom-6 conformance findings were actually measured against, so
     * they are reproducible from the manifest. Distinct from `corpusHash`
     * (the committed corpus-map.yaml). Present only when the seed was read;
     * absent means no seed existed for this run. */
    corpusSeedHash: z.string().min(1).optional(),
    rulesetVersion: z.string().min(1),
    tierEnablement: z.strictObject({
      deterministic: z.boolean(),
      llm: z.boolean(),
    }),
    engineVersion: z.string().min(1),
    /** sha256 hex of config.yaml bytes; literal "absent" when no config file.
     * Optional so pre-1.6 artifacts still parse. */
    configHash: z.string().min(1).optional(),
    /** false → no config.yaml, defaults governed the run. */
    configPresent: z.boolean().optional(),
    /** The EFFECTIVE post-default enforcement config the gate actually used,
     * keyed by axiom id — the governing policy is persisted, not inferred. */
    enforcement: z
      .record(
        z.string(),
        z.strictObject({
          enforcement: enforcementSchema,
          maxFindings: z.int().min(0).optional(),
        }),
      )
      .optional(),
    /** Git status of the governing config.yaml — an uncommitted config
     * gating a run is visible, never silent. "absent" = no config file. */
    configGitStatus: z.enum(["committed", "modified", "untracked", "absent"]).optional(),
    /** Axiom ids configured `off` — declared, not silent (config plane, 1.6).
     * Optional + omitted when empty so pre-1.6 artifacts still parse. */
    axiomsOff: z.array(z.string().min(1)).optional(),
    /** Declared six-phase assembly (story 1.7): the shape is FIXED (0
     * preflight → 1 deterministic → 2 SDD gate → 3 LLM enrichment → 4
     * aggregation → 5 composition) while membership varies by
     * scope/mode/config; an empty-membership phase carries the reason it
     * did not run. Optional so pre-1.7 artifacts still parse. */
    phases: z
      .array(
        z.strictObject({
          phase: z.int().min(0).max(5),
          members: z.array(z.string().min(1)),
          ran: z.boolean(),
          reason: z.string().min(1).optional(),
        }),
      )
      .length(6)
      // The FIXED shape is schema-enforced, not just documented: exactly six
      // entries, ordered phase 0..5.
      .refine((entries) => entries.every((entry, i) => entry.phase === i), {
        message: "phases must be exactly the six phases 0..5 in order",
      })
      .optional(),
    /** Cache truth (story 1.7): per-unit content-addressed-cache lookup
     * counters — hits, clean misses, and invalid entries (torn/stale, each
     * treated as a miss + typed degradation). Runtime facts by design: a
     * warm run differs from its cold twin HERE and nowhere else, so
     * byte-identity comparisons normalize this one field out. */
    cache: z
      .strictObject({
        hits: z.int().min(0),
        misses: z.int().min(0),
        invalid: z.int().min(0),
        /** Present ONLY when caching was disabled for the run — the declared
         * reason (secret unavailable, cache dir unwritable, uncomputable
         * key, ...). Zero silent cache behavior: a disabled cache says why. */
        disabled: z.string().min(1).optional(),
      })
      .optional(),
    modelIdentity: z
      .strictObject({
        model: z.string().min(1),
        source: z.enum(["reported", "configured", "assumed"]),
      })
      .optional(),
  })
  // An LLM run without a recorded model identity would defeat the
  // anti-masquerade purpose of this manifest.
  .refine((m) => !m.tierEnablement.llm || m.modelIdentity !== undefined, {
    message: "modelIdentity is required when the llm tier is enabled",
    path: ["modelIdentity"],
  });

export type RunManifest = z.infer<typeof runManifestSchema>;
