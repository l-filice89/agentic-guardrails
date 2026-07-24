import { z } from "zod";

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
    corpusHash: z.string().min(1),
    rulesetVersion: z.string().min(1),
    tierEnablement: z.strictObject({
      deterministic: z.boolean(),
      llm: z.boolean(),
    }),
    engineVersion: z.string().min(1),
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
