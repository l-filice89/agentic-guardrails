import { z } from "zod";

/** Per-axiom enforcement level. */
export const enforcementSchema = z.enum(["blocking", "advisory", "off"]);

/**
 * Engine configuration (feeds the Story 1.6 config plane). Keyed by axiom
 * id; the schema carries only what the consumer wrote — every unconfigured
 * axiom gets the gate's effective defaults (`blocking`, `maxFindings: 0`)
 * downstream (core's EFFECTIVE_DEFAULTS).
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

/** One declared layer: a name plus the repo-relative path prefixes it owns. */
const boundaryLayerSchema = z.strictObject({
  name: z.string().min(1),
  paths: z
    .array(z.string().min(1))
    .min(1)
    .describe("Repo-relative path prefixes (no globs); longest matching prefix wins."),
});

/**
 * Optional structural-boundary declaration (Story 1.9): path-prefix layers
 * plus an allowed-dependency map (the `check-boundaries.mjs` allowlist
 * shape, productized). Absent → the declaration-dependent axiom-1 rules
 * (`structural/dependency-direction`, `structural/unassigned-file`) emit
 * nothing. Same-layer imports are always allowed and need no declaring.
 */
export const boundariesSchema = z
  .strictObject({
    layers: z.array(boundaryLayerSchema).min(1),
    allowed: z
      .record(z.string(), z.array(z.string()))
      .default({})
      .describe(
        "Allowed dependency directions: fromLayer -> [toLayer, ...]. Undeclared pairs are violations (fail-closed). Same-layer imports are always allowed.",
      ),
  })
  .superRefine((b, ctx) => {
    const names = new Set(b.layers.map((l) => l.name));
    if (names.size !== b.layers.length) {
      ctx.addIssue({ code: "custom", path: ["layers"], message: "layer names must be unique" });
    }
    // Path prefixes are LITERAL repo-relative directory prefixes — a glob,
    // backslash, "./", absolute, trailing-"/" or blank entry would silently
    // match nothing (or the wrong thing) in the longest-prefix assignment,
    // so each is rejected with its exact path named.
    const pathOwner = new Map<string, string>(); // declared path -> layer name
    b.layers.forEach((layer, layerIndex) => {
      layer.paths.forEach((p, pathIndex) => {
        const issue = (message: string): void => {
          ctx.addIssue({
            code: "custom",
            path: ["layers", layerIndex, "paths", pathIndex],
            message,
          });
        };
        if (p.trim() === "") issue("path prefix must not be blank");
        else if (/[*?[\]]/.test(p)) issue("path prefixes are literal — glob characters (* ? [ ]) are not supported");
        else if (p.includes("\\")) issue('path prefixes use forward slashes ("/"), never backslashes');
        else if (p.startsWith("./")) issue('path prefixes are repo-relative — drop the leading "./"');
        else if (p.startsWith("/")) issue('path prefixes are repo-relative — drop the leading "/"');
        else if (p.endsWith("/")) issue('path prefixes must not end with "/"');
        else {
          const owner = pathOwner.get(p);
          if (owner !== undefined && owner !== layer.name) {
            issue(`path "${p}" is already declared by layer "${owner}" — a path may belong to only one layer`);
          } else {
            pathOwner.set(p, layer.name);
          }
        }
      });
    });
    for (const [key, targets] of Object.entries(b.allowed)) {
      if (!names.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["allowed", key],
          message: `references undeclared layer "${key}"`,
        });
      }
      targets.forEach((target, index) => {
        if (!names.has(target)) {
          ctx.addIssue({
            code: "custom",
            path: ["allowed", key, index],
            message: `references undeclared layer "${target}"`,
          });
        }
      });
    }
  });

export type Boundaries = z.infer<typeof boundariesSchema>;

export const configSchema = z.strictObject({
  boundaries: boundariesSchema.optional(),
  axioms: z
    .record(z.string(), axiomEntrySchema)
    .default({})
    .describe(
      'Per-axiom enforcement, keyed by axiom id. Every axiom defaults to "blocking" (maxFindings 0) when omitted; an explicit entry wins.',
    ),
});

export type Config = z.infer<typeof configSchema>;

/**
 * JSON Schema for `configSchema` (Zod 4 native generation) — consumers write
 * it to disk for editor autocomplete; contracts itself does no I/O.
 */
export const configJsonSchema = z.toJSONSchema(configSchema, { io: "input" });
