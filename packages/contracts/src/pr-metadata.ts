import { z } from "zod";

/**
 * PR metadata as it is RECORDED on the run manifest (1.15). Optional
 * enrichment only: every field is sourced from `gh`, which is never required
 * and never a gate, so an absent block means "no metadata", never "no PR".
 */
export const prMetadataSchema = z.strictObject({
  /** The PR id as the user supplied it — digits only, so it is also the
   * `pr-<id>` artifact directory segment. */
  id: z.string().regex(/^[0-9]+$/),
  title: z.string().min(1),
  baseRef: z.string().min(1),
  headRef: z.string().min(1),
  author: z.string().min(1),
});

/**
 * `gh pr view <id> --json title,baseRefName,headRefName,author` output.
 * `gh` is an external process whose output is UNTRUSTED input: it is parsed
 * through this schema and mapped field by field onto {@link prMetadataSchema}
 * — never spread onto the manifest, so a future `gh` that grows fields (or a
 * hostile `gh` on PATH) cannot inject keys into a persisted artifact.
 */
export const ghPrViewSchema = z.object({
  title: z.string().min(1),
  baseRefName: z.string().min(1),
  headRefName: z.string().min(1),
  author: z.object({ login: z.string().min(1) }),
});

export type PrMetadata = z.infer<typeof prMetadataSchema>;
