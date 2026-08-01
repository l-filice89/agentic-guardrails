import { z } from "zod";

import { enforcementSchema } from "./config.js";
import { findingSchema } from "./finding.js";
import { degradationSchema } from "./partial-result.js";
import { runManifestSchema } from "./run-manifest.js";
import { severityCountsSchema } from "./trend-record.js";

/**
 * The persisted review artifact envelope — the single file a `guardrails
 * review` run writes. Embeds the findings, the typed degradations, and the
 * RunManifest under one `schemaVersion` (one atomic write, no torn pairs).
 *
 * `deletedFiles` carries changed-but-deleted paths separately: a deletion is
 * excluded from analysis but is NOT coverage loss, so it is never a
 * degradation. Strict object: unknown keys fail parse.
 */
/**
 * The ONLY definition of a safe scope segment (1.15). This value is the
 * traversal guard on a directory name derived from untrusted ref text, so it
 * lives here once and `core/persistence` imports it rather than keeping a
 * second copy that can drift out of step. Digits are admitted (`pr-42`);
 * separators, dots and uppercase stay rejected.
 */
export const SCOPE_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * FR-14's raw measurement block (1.16). Everything here is a pure function of
 * THIS run's own inputs, which is what makes it safe to persist: the artifact
 * stays byte-identical for identical inputs. The FR-15 *delta* is deliberately
 * NOT here — it depends on prior history, so writing it would break the
 * byte-identity invariant three tests assert; it is rendered in the report.
 *
 * Raw counts are the record; the OD-1 score is a DERIVED view. `scoreTenths`
 * is persisted only as a convenience over the same inputs, always beside its
 * `formulaVersion`, so a formula change re-derives rather than rewrites
 * history.
 *
 * Every number is an INTEGER: the score has to serialize identically on every
 * platform, so no raw IEEE double is ever handed to `JSON.stringify`.
 */
const reviewScoresShape = z.strictObject({
  /** OD-1 formula version stamp — present wherever a score is rendered or
   * persisted, so a v2 formula can never be mistaken for a v1 number. */
  formulaVersion: z.string().min(1),
  /** axiom id → raw counts by severity. */
  axiomSeverityCounts: z.record(z.string(), severityCountsSchema),
  /** Added + deleted lines as git's `--numstat` measured them, BEFORE the
   * floor — the honest measurement. ABSENT for a scope that is not a diff. */
  changedLines: z.int().min(0).optional(),
  /** The OD-1 denominator: `changedLines` after the 0.1-KLOC floor, in
   * thousandths of a KLOC (`changedKloc = changedKlocMilli / 1000`). ABSENT
   * for a scope with no denominator by construction (`--project`) — the
   * contract's "never fabricate a denominator" is enforced by there being no
   * field to fabricate one into, not by a comment. */
  changedKlocMilli: z.int().min(0).optional(),
  /** Score × 10 (one pinned decimal), floored at 0 and capped at 100.0.
   * ABSENT when the scope has no defined denominator — never a fabricated 0
   * or 100 standing in for "undefined". */
  scoreTenths: z.int().min(0).max(1000).optional(),
  /** Why `scoreTenths` is absent. Present exactly when it is. */
  scoreOmittedReason: z.string().min(1).optional(),
  /** Files git reported as binary (`-`/`-` in numstat): they contribute 0
   * lines to `changedLines` and are counted HERE so the denominator's
   * incompleteness is declared rather than silently read as zero change. */
  binaryFiles: z.int().min(0),
});

/**
 * The scores block with its two mutual-exclusivity rules ENFORCED rather than
 * asserted in prose: a comment saying "present exactly when it is" does not
 * stop an artifact carrying both a score and a reason (or neither), and either
 * of those is an artifact nobody can interpret.
 *
 *   - exactly one of `scoreTenths` / `scoreOmittedReason`;
 *   - a score requires the denominator it was computed from.
 */
export const reviewScoresSchema = reviewScoresShape
  .refine(
    (scores) => (scores.scoreTenths === undefined) !== (scores.scoreOmittedReason === undefined),
    { error: "exactly one of scoreTenths / scoreOmittedReason must be present" },
  )
  .refine((scores) => scores.scoreTenths === undefined || scores.changedKlocMilli !== undefined, {
    error: "scoreTenths requires the changedKlocMilli it was derived from",
  });

export type ReviewScores = z.infer<typeof reviewScoresShape>;

export const reviewArtifactSchema = z.strictObject({
  schemaVersion: z.int().min(1),
  runId: z.string().regex(/^[0-9a-f]{16}$/),
  scope: z.string().regex(SCOPE_PATTERN),
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
  /** FR-14 raw counts + change size + the derived OD-1 score (1.16).
   * Optional so pre-1.16 artifacts still parse — the `gate` precedent. */
  scores: reviewScoresSchema.optional(),
});

export type ReviewArtifact = z.infer<typeof reviewArtifactSchema>;
