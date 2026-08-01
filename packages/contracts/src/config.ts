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

/**
 * What to do with the DR-1 per-finding disposition prompt when the run is
 * NOT interactive (`--no-input`, a pipe, CI). `skip` — the default — records
 * NOTHING: a disposition nobody made is fabricated data, and DR-1's trust
 * metrics are only worth having if every label came from a human. `deferred`
 * is for teams that want every CI finding to land in history as explicitly
 * un-triaged rather than absent.
 */
export const dispositionPolicySchema = z.enum(["skip", "deferred"]);

export type DispositionPolicy = z.infer<typeof dispositionPolicySchema>;

/**
 * Review-scope exclusions (Story 1.18): posix repo-relative path PREFIXES
 * removed from every scope's change set AND the changed-KLOC denominator.
 * Prefixes, not globs — deliberately (ADR-006). Excluded files are counted
 * and declared per run, never silently dropped. A trailing "/" is allowed
 * (it reads naturally for a directory); matching is whole-segment either way.
 */
const excludeSchema = z
  .array(z.string())
  .describe(
    "Repo-relative posix path prefixes excluded from review (no globs); excluded files are counted and declared per run.",
  )
  .superRefine((entries, ctx) => {
    entries.forEach((p, index) => {
      const issue = (message: string): void => {
        ctx.addIssue({ code: "custom", path: [index], message });
      };
      if (p.trim() === "") issue("exclude prefix must not be blank");
      else if (p !== p.trim())
        issue("exclude prefixes must not have leading or trailing whitespace");
      // Control characters (a newline especially) would let a config entry
      // forge `guardrails review:` stderr/degradation lines when the prefix
      // is interpolated into declarations — the hostile-text class 1.16
      // sanitizes everywhere else.
      else if ([...p].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f))
        issue("exclude prefixes must not contain control characters");
      else if (/[*?[\]]/.test(p))
        issue("exclude prefixes are literal — glob characters (* ? [ ]) are not supported");
      else if (p.includes("\\"))
        issue('exclude prefixes use forward slashes ("/"), never backslashes');
      else if (p.startsWith("./"))
        issue('exclude prefixes are repo-relative — drop the leading "./"');
      // `[A-Za-z]:` alone would also reject legit posix names like
      // `a:notes/x.ts` — only a drive-letter FOLLOWED by a separator (or
      // nothing) is an absolute path.
      else if (p.startsWith("/") || /^[A-Za-z]:($|[\\/])/.test(p))
        issue("exclude prefixes are repo-relative — absolute paths are not allowed");
      else if (p.includes("//"))
        issue('exclude prefixes must not contain empty path segments ("//")');
      else if (p.split("/").some((segment) => segment === "." || segment === ".."))
        issue('exclude prefixes must not contain "." or ".." path segments');
    });
  });

export const configSchema = z.strictObject({
  boundaries: boundariesSchema.optional(),
  /** Repo-relative posix path prefixes excluded from every review scope
   * (change set and changed-KLOC denominator). Default: none. */
  exclude: excludeSchema.optional(),
  /** Newest per-run review artifacts kept in each `reviews/<scope>/`
   * directory (default 100). Committed history is NEVER pruned — this bounds
   * only the gitignored per-run artifact store. */
  artifactRetention: z.int().min(1).optional(),
  /** Non-interactive DR-1 disposition handling (default `skip`). */
  dispositionPolicy: dispositionPolicySchema.optional(),
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
