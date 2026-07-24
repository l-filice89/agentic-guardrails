import { z } from "zod";

/** Per-axiom enforcement level. */
export const enforcementSchema = z.enum(["blocking", "advisory", "off"]);

/**
 * Engine configuration (feeds the Story 1.6 config plane). Keyed by axiom
 * id; axiom #5 (type-system integrity) defaults to `blocking`, everything
 * else defaults to nothing until the consumer's config file sets it.
 */
const axiomEntrySchema = z
  .strictObject({
    enforcement: enforcementSchema,
    maxFindings: z
      .int()
      .min(0)
      .optional()
      .describe(
        "Error-finding tolerance for a blocking axiom: exit gating fails only when error findings exceed this count (default 0). Ignored for advisory/off.",
      ),
  })
  // maxFindings only means something for a blocking axiom — a threshold on an
  // advisory/off axiom is a config mistake, rejected with the path named.
  .refine((entry) => entry.enforcement === "blocking" || entry.maxFindings === undefined, {
    message: 'maxFindings is only valid with enforcement "blocking"',
    path: ["maxFindings"],
  });

export type AxiomEntry = z.infer<typeof axiomEntrySchema>;

export const configSchema = z.strictObject({
  axioms: z
    .record(z.string(), axiomEntrySchema)
    .default({})
    // Axiom #5 defaults to blocking; an explicit entry for "5" wins. The
    // return type is annotated so the inferred Config keeps its index
    // signature (the literal spread would otherwise narrow it to `{"5":...}`).
    .transform(
      (axioms): Record<string, AxiomEntry> => ({
        "5": { enforcement: "blocking" as const },
        ...axioms,
      }),
    )
    // Surfaced via .describe so the generated JSON Schema (io: "input")
    // carries the default that the transform makes invisible to it.
    .describe(
      'Per-axiom enforcement, keyed by axiom id. Axiom "5" (security) defaults to "blocking" when omitted; an explicit entry wins.',
    ),
});

export type Config = z.infer<typeof configSchema>;

/**
 * JSON Schema for `configSchema` (Zod 4 native generation) — consumers write
 * it to disk for editor autocomplete; contracts itself does no I/O.
 */
export const configJsonSchema = z.toJSONSchema(configSchema, { io: "input" });
