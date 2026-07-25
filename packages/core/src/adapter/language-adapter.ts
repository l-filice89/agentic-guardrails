/**
 * The LanguageAdapter seam (ADR-004): analyzers depend on this interface,
 * never on a concrete AST toolkit. One implementation exists on purpose
 * (`TypeScriptAdapter`) — the seam is the point, not multi-language support.
 */
import { partialResult, type Degradation } from "@agentic-guardrails/contracts";
import { z } from "zod";

import type { ImportGraph } from "../graph/import-graph.js";

/** A file participating in the import graph. `external: true` means "bare
 * specifier, not traversed; resolution verified only when found in
 * node_modules" — an unresolvable bare specifier is still recorded as an
 * external node, with a paired degraded entry flagging it unverified. */
export const importGraphNodeSchema = z.strictObject({
  file: z.string().min(1),
  external: z.boolean(),
});
export type ImportGraphNode = z.infer<typeof importGraphNodeSchema>;

/** One resolved import/re-export relationship between two nodes. `line` is
 * the 1-based start line of the import/export declaration (dynamic imports:
 * the call site) — the anchor every axiom-1 rule reports at. `names` are the
 * binding names this edge imports/re-exports from the target (1.10 usage
 * substrate for `cleanliness/unused-export`): `"*"` for a namespace import,
 * `export *`, dynamic `import()`, `require()`, or `import =` (the whole
 * namespace), `"default"` for a default import, else the target-module
 * names of the named bindings (type-only included). Side-effect imports
 * carry `[]`. Sorted + unique; NOT part of edge identity — same-identity
 * edges union their names (1.9 dedup ruling). */
export const importGraphEdgeSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  dynamic: z.boolean(),
  typeOnly: z.boolean(),
  reExport: z.boolean(),
  line: z.int().positive(),
  names: z.array(z.string()),
});
export type ImportGraphEdge = z.infer<typeof importGraphEdgeSchema>;

/** One import specifier that failed resolution (relative or `paths`-alias —
 * bare external specifiers are verified externals, never unresolved). Feeds
 * the `structural/unresolved-import` rule; the paired graph-build
 * degradation stays as the coverage truth. */
export const unresolvedImportSchema = z.strictObject({
  from: z.string().min(1),
  specifier: z.string().min(1),
  line: z.int().positive(),
  /** true → the failing declaration is type-only (erased at runtime) — the
   * finding message must not imply runtime breakage. */
  typeOnly: z.boolean(),
});
export type UnresolvedImport = z.infer<typeof unresolvedImportSchema>;

/** The serialized graph shape — exactly what `ImportGraph.serialize()`
 * emits (modulo JSON formatting). */
export const importGraphDataSchema = z.strictObject({
  nodes: z.array(importGraphNodeSchema),
  edges: z.array(importGraphEdgeSchema),
});
export type ImportGraphData = z.infer<typeof importGraphDataSchema>;

/** Contracts partial-result envelope over the serialized graph shape. */
export const importGraphResultSchema = partialResult(importGraphDataSchema);
export type ImportGraphResult = z.infer<typeof importGraphResultSchema>;

/**
 * Partial-result envelope carrying a live value (e.g. an `ImportGraph`
 * instance) instead of the serialized data. Mirrors the contracts shape;
 * validate the serialized form with `importGraphResultSchema`.
 */
export interface PartialResultOf<T> {
  data: T;
  coverage: number;
  degraded: Degradation[];
}

/**
 * `buildImportGraph`'s concrete return: the partial-result envelope plus the
 * raw resolution counters, so multi-tsconfig callers (solution-style repos)
 * can recompute merged coverage as resolved/attempted across ALL graphs
 * instead of averaging per-graph ratios.
 */
export interface ImportGraphBuildResult extends PartialResultOf<ImportGraph> {
  /** Unique (from, specifier) resolution attempts in this graph. */
  attempted: number;
  /** How many of those attempts failed to resolve. */
  unresolved: number;
  /** Relative/alias specifiers that failed resolution, with their import
   * lines — deduped by (from, specifier) keeping the smallest line, sorted. */
  unresolvedImports: UnresolvedImport[];
}

export interface BuildImportGraphOptions {
  /** Path to the analyzed project's tsconfig.json (absolute or cwd-relative). */
  tsconfigPath: string;
  /**
   * Directory graph paths are made relative to. Defaults to the tsconfig's
   * directory.
   */
  rootDir?: string;
}

/** The seam analyzers depend on. Analyzed code is parsed as data, never
 * executed or imported. */
export interface LanguageAdapter {
  buildImportGraph(options: BuildImportGraphOptions): ImportGraphBuildResult;
}
