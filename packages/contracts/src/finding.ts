import { z } from "zod";

import { degradationSchema } from "./partial-result.js";

/** Where a finding lives in the corpus. Lines are 1-based and inclusive. */
export const findingLocationSchema = z
  .strictObject({
    file: z.string().min(1),
    startLine: z.int().positive(),
    endLine: z.int().positive(),
  })
  .refine((l) => l.endLine >= l.startLine, {
    message: "endLine must be >= startLine (lines are 1-based and inclusive)",
    path: ["endLine"],
  });

/** A single origin of a finding's evidence. */
export const findingSourceSchema = z.enum(["ast", "regex", "llm"]);
export type FindingSource = z.infer<typeof findingSourceSchema>;

/**
 * The canonical Finding — the single shape every analyzer emits and every
 * consumer (pipeline, CLI, persistence, trend records) reads.
 *
 * Confidence semantics per tier (schema-enforced, not just documented):
 * - `tier: 'deterministic'` findings always carry the fixed maximum
 *   `confidence` of 1 — a deterministic rule either fired or it didn't —
 *   and come from `source: 'ast' | 'regex'`, never `'llm'`.
 * - `tier: 'inferred'` (LLM-tier, Epic 2+) findings come from
 *   `source: 'llm'` with a calibrated confidence in (0..1].
 *
 * `source` accepts a single source OR a non-empty array of sources: a
 * MERGED finding (FR-21, story 1.7) carries the sorted union of its
 * constituents' sources as an array; an unmerged finding stays scalar.
 * This is the minimal contract change that expresses the merged shape
 * without breaking existing single-source consumers (no schemaVersion
 * bump needed — the scalar form is unchanged).
 *
 * `findingId` is the line-drift-stable identity from `computeFindingId`;
 * `ruleId` and `enclosingSymbol` are carried on the Finding so the id is
 * auditable/recomputable from the Finding itself (no line numbers in the
 * hash input).
 *
 * Strict object: unknown keys fail parse — a shape drift must surface as a
 * validation error plus a schemaVersion bump, never as silent stripping.
 */
export const findingSchema = z
  .strictObject({
    findingId: z.string().min(1),
    axiom: z.string().min(1),
    ruleId: z.string().min(1),
    location: findingLocationSchema,
    message: z.string().min(1),
    tier: z.enum(["deterministic", "inferred"]),
    source: z.union([
      findingSourceSchema,
      // The array variant is a merged finding's sorted union — sorted +
      // unique is part of the contract (byte determinism), not a convention.
      z
        .array(findingSourceSchema)
        .min(1)
        .refine((arr) => arr.every((s, i) => i === 0 || arr[i - 1]! < s), {
          message: "merged source array must be sorted and unique",
        }),
    ]),
    confidence: z.number().min(0).max(1),
    severity: z.enum(["error", "warning", "info"]),
    /** Line-drift-stable anchor used in the findingId hash. */
    enclosingSymbol: z.string().min(1).optional(),
    exemplar: z.string().optional(),
    degraded: degradationSchema.optional(),
  })
  .superRefine((f, ctx) => {
    const sources = Array.isArray(f.source) ? f.source : [f.source];
    if (f.tier === "deterministic") {
      if (f.confidence !== 1) {
        ctx.addIssue({
          code: "custom",
          path: ["confidence"],
          message: "deterministic-tier findings carry the fixed maximum confidence of 1",
        });
      }
      if (sources.includes("llm")) {
        ctx.addIssue({
          code: "custom",
          path: ["source"],
          message: "deterministic-tier findings come from 'ast' or 'regex', never 'llm'",
        });
      }
    } else if (sources.some((s) => s !== "llm")) {
      ctx.addIssue({
        code: "custom",
        path: ["source"],
        message: "inferred-tier findings come from 'llm'",
      });
    }
  });

export type FindingLocation = z.infer<typeof findingLocationSchema>;
export type Finding = z.infer<typeof findingSchema>;
