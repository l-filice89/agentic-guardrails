/**
 * Story 1.8 structural corpus seed: file-level entities machine-derived from
 * the merged import graph — the graph's unit IS the file, its repo-relative
 * path is the location, fan-in its structural weight. A regenerable
 * derivation written as a PLAIN atomic file at
 * `_agentic-guardrails/.cache/corpus/structural-seed.json` — deliberately
 * NOT a `DeterministicCache` kind (no HMAC, no 100-entry prune coupling):
 * the cache memoizes per-unit work, the seed is a whole-repo snapshot.
 * Carries the partial-result envelope (coverage + degraded) from the graph
 * build — never a silently partial seed.
 */
import type { Degradation } from "@agentic-guardrails/contracts";

import type { ImportGraphBuildResult } from "../adapter/language-adapter.js";

export interface StructuralSeedEntity {
  /** Repo-relative `/`-separated path (or bare specifier for externals). */
  file: string;
  /** Number of distinct import edges pointing at this file. */
  fanIn: number;
  /** true → an external package specifier (e.g. "zod"), not a repo file —
   * carried from the graph node so consumers can tell them apart. */
  external: boolean;
}

export interface StructuralSeed {
  schemaVersion: 1;
  /** Sorted by file (the graph's canonical node order). */
  entities: StructuralSeedEntity[];
  coverage: number;
  degraded: Degradation[];
}

/** Repo-relative path of the seed file. */
export const STRUCTURAL_SEED_PATH = "_agentic-guardrails/.cache/corpus/structural-seed.json";

/** One `{file, fanIn, external}` entry per merged-graph node, in the
 * graph's sorted node order, plus the build's partial-result envelope. Pure
 * derivation — identical graph in, identical seed out. */
export function buildStructuralSeed(graphResult: ImportGraphBuildResult): StructuralSeed {
  const graph = graphResult.data;
  return {
    schemaVersion: 1,
    // graph.nodes is already deduplicated and stable-sorted by file.
    entities: graph.nodes.map((node) => ({
      file: node.file,
      fanIn: graph.fanIn(node.file).data.count,
      external: node.external,
    })),
    coverage: graphResult.coverage,
    // Code-point sort (locale-independent) — same convention as the pipeline.
    degraded: [...graphResult.degraded].sort(
      (a, b) => compare(a.subject, b.subject) || compare(a.reason, b.reason),
    ),
  };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Canonical bytes: 2-space JSON, fixed key order, one trailing newline. */
export function serializeStructuralSeed(seed: StructuralSeed): string {
  return `${JSON.stringify(seed, null, 2)}\n`;
}
