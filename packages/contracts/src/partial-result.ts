import { z } from "zod";

/**
 * One degraded unit of work inside an otherwise-successful result:
 * what was skipped/partial (`subject`) and why (`reason`).
 */
export const degradationSchema = z.object({
  reason: z.string().min(1),
  subject: z.string().min(1),
});

export type Degradation = z.infer<typeof degradationSchema>;

/**
 * Generic partial-result contract (zero-silent-degradation): every read
 * surface returns its data plus explicit coverage and the typed list of
 * degradations, instead of silently dropping work.
 *
 * `coverage` is the fraction of the requested scope actually covered (0..1).
 */
export function partialResult<T extends z.ZodType>(dataSchema: T) {
  return z
    .strictObject({
      data: dataSchema,
      coverage: z.number().min(0).max(1),
      degraded: z.array(degradationSchema),
    })
    // Zero-SILENT-degradation, enforced: partial coverage with an empty
    // degraded list is exactly the contradiction this contract exists to
    // forbid. (Full coverage with degraded entries is legal — e.g. a
    // fallback that still covered everything.)
    .refine((r) => r.coverage === 1 || r.degraded.length > 0, {
      message: "coverage < 1 requires at least one typed degradation entry",
      path: ["degraded"],
    });
}
