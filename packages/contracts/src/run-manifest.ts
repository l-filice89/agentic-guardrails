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
    corpusHash: z.string().min(1),
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
