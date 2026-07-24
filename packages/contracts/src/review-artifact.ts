import { z } from "zod";

import { enforcementSchema } from "./config.js";
import { findingSchema } from "./finding.js";
import { degradationSchema } from "./partial-result.js";
import { runManifestSchema } from "./run-manifest.js";

/**
 * The persisted review artifact envelope — the single file a `guardrails
 * review` run writes. Embeds the findings, the typed degradations, and the
 * RunManifest under one `schemaVersion` (one atomic write, no torn pairs).
 *
 * `deletedFiles` carries changed-but-deleted paths separately: a deletion is
 * excluded from analysis but is NOT coverage loss, so it is never a
 * degradation. Strict object: unknown keys fail parse.
 */
export const reviewArtifactSchema = z.strictObject({
  schemaVersion: z.int().min(1),
  runId: z.string().regex(/^[0-9a-f]{16}$/),
  scope: z.string().regex(/^[a-z][a-z-]*$/),
  changedFiles: z.array(z.string().min(1)),
  deletedFiles: z.array(z.string().min(1)),
  findings: z.array(findingSchema),
  degraded: z.array(degradationSchema),
  manifest: runManifestSchema,
  /** The gate verdict this run's exit code was derived from — one entry per
   * axiom that ran or was configured (off axioms live in manifest.axiomsOff).
   * Optional so pre-1.6 artifacts still parse. */
  gate: z
    .strictObject({
      pass: z.boolean(),
      perAxiom: z.array(
        z.strictObject({
          axiom: z.string().min(1),
          enforcement: enforcementSchema,
          errorFindings: z.int().min(0),
          maxFindings: z.int().min(0),
          pass: z.boolean(),
        }),
      ),
    })
    .optional(),
});

export type ReviewArtifact = z.infer<typeof reviewArtifactSchema>;
