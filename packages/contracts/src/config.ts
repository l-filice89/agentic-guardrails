import { z } from "zod";

/** Per-axiom enforcement level. */
export const enforcementSchema = z.enum(["blocking", "advisory", "off"]);

/**
 * Engine configuration (feeds the Story 1.6 config plane). Keyed by axiom
 * id; axiom #5 (type-system integrity) defaults to `blocking`, everything
 * else defaults to nothing until the consumer's config file sets it.
 */
export const configSchema = z.strictObject({
  axioms: z
    .record(z.string(), z.strictObject({ enforcement: enforcementSchema }))
    .default({})
    // Axiom #5 defaults to blocking; an explicit entry for "5" wins.
    .transform((axioms) => ({ "5": { enforcement: "blocking" as const }, ...axioms }))
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
