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
import { readFileSync } from "node:fs";
import path from "node:path";

import type { StructuralSeed } from "@agentic-guardrails/contracts";

import type { ImportGraphBuildResult } from "../adapter/language-adapter.js";

// The shape lives in contracts (`structuralSeedSchema`, 1.13) so producer and
// consumer validate against ONE definition — re-exported here because the
// producer is this module.
export type { StructuralSeed, StructuralSeedEntity } from "@agentic-guardrails/contracts";

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

/**
 * One read of the persisted seed BYTES. The pipeline reads it exactly once
 * per run and hands the same buffer to both the cache key and the analyzer
 * (`AnalyzerContext.corpusSeed`), so a concurrent `guardrails init` can never
 * slip a new corpus between key computation and analysis. Absence is
 * distinguished from every other failure: it is the only case an un-inited
 * repo produces, and the only one the exit code is carved out for.
 */
export type StructuralSeedRead =
  | { ok: true; bytes: Buffer }
  | { ok: false; absent: boolean; message: string };

export function readStructuralSeedFile(root: string): StructuralSeedRead {
  try {
    return { ok: true, bytes: readFileSync(path.join(root, STRUCTURAL_SEED_PATH)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ok: false,
        absent: true,
        message: `seed file absent at ${STRUCTURAL_SEED_PATH} — run \`guardrails init\` to derive the structural corpus`,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, absent: false, message: `seed unreadable: ${message.split("\n")[0]}` };
  }
}

/** Canonical bytes: 2-space JSON, fixed key order, one trailing newline. */
export function serializeStructuralSeed(seed: StructuralSeed): string {
  return `${JSON.stringify(seed, null, 2)}\n`;
}
