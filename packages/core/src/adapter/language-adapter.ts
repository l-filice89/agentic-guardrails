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

/** One resolved import/re-export relationship between two nodes. */
export const importGraphEdgeSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  dynamic: z.boolean(),
  typeOnly: z.boolean(),
  reExport: z.boolean(),
});
export type ImportGraphEdge = z.infer<typeof importGraphEdgeSchema>;

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
  buildImportGraph(options: BuildImportGraphOptions): PartialResultOf<ImportGraph>;
}
