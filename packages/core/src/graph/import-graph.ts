/**
 * Deterministic import-graph container: stable-sorted, deduplicated,
 * `/`-separated repo-relative paths, byte-identical `serialize()` for
 * identical input.
 */
import path from "node:path";

import type { Degradation } from "@agentic-guardrails/contracts";

import type {
  ImportGraphData,
  ImportGraphEdge,
  ImportGraphNode,
  PartialResultOf,
} from "../adapter/language-adapter.js";

/**
 * Normalize a path for graph output: `\` → `/`, then `path.posix.normalize`
 * (collapses `//`, strips `./`, resolves `a/../b`). Case is preserved —
 * normalization must never invent identity the filesystem does not
 * guarantee.
 */
export function normalizePath(p: string): string {
  return path.posix.normalize(p.replaceAll("\\", "/"));
}

// Keys are JSON tuples, not space-joined strings — paths containing spaces
// must never collide. Sort order is by code point of the JSON tuple string.
function nodeKey(n: ImportGraphNode): string {
  return JSON.stringify([n.file]);
}

function edgeKey(e: ImportGraphEdge): string {
  return JSON.stringify([e.from, e.to, e.dynamic, e.typeOnly, e.reExport]);
}

export interface FanResult {
  count: number;
  edges: readonly ImportGraphEdge[];
}

const EMPTY_EDGES: readonly ImportGraphEdge[] = Object.freeze([]);

export class ImportGraph {
  readonly nodes: readonly ImportGraphNode[];
  readonly edges: readonly ImportGraphEdge[];

  private readonly nodeSet: ReadonlySet<string>;
  private readonly edgesByFrom: ReadonlyMap<string, readonly ImportGraphEdge[]>;
  private readonly edgesByTo: ReadonlyMap<string, readonly ImportGraphEdge[]>;

  constructor(nodes: Iterable<ImportGraphNode>, edges: Iterable<ImportGraphEdge>) {
    // Dedupe nodes by file (external flag from first occurrence wins — the
    // adapter never emits the same file with both flags), then stable-sort.
    const nodeByFile = new Map<string, ImportGraphNode>();
    for (const n of nodes) {
      const file = normalizePath(n.file);
      if (!nodeByFile.has(file)) nodeByFile.set(file, { file, external: n.external });
    }
    const edgeByKey = new Map<string, ImportGraphEdge>();
    for (const e of edges) {
      const edge: ImportGraphEdge = {
        from: normalizePath(e.from),
        to: normalizePath(e.to),
        dynamic: e.dynamic,
        typeOnly: e.typeOnly,
        reExport: e.reExport,
      };
      edgeByKey.set(edgeKey(edge), edge);
    }
    // Endpoint-closure invariant: every edge endpoint is a node. Synthesize
    // missing ones — bare (separator-free) endpoints are external packages,
    // anything path-shaped is internal.
    for (const e of edgeByKey.values()) {
      for (const endpoint of [e.from, e.to]) {
        if (!nodeByFile.has(endpoint)) {
          nodeByFile.set(endpoint, { file: endpoint, external: !endpoint.includes("/") });
        }
      }
    }
    this.nodes = Object.freeze(
      [...nodeByFile.values()]
        .sort((a, b) => (nodeKey(a) < nodeKey(b) ? -1 : nodeKey(a) > nodeKey(b) ? 1 : 0))
        .map((n) => Object.freeze(n)),
    );
    this.edges = Object.freeze(
      [...edgeByKey.values()]
        .sort((a, b) => (edgeKey(a) < edgeKey(b) ? -1 : edgeKey(a) > edgeKey(b) ? 1 : 0))
        .map((e) => Object.freeze(e)),
    );

    // Index once; fan queries are O(result), not O(E).
    const nodeSet = new Set<string>();
    for (const n of this.nodes) nodeSet.add(n.file);
    const byFrom = new Map<string, ImportGraphEdge[]>();
    const byTo = new Map<string, ImportGraphEdge[]>();
    for (const e of this.edges) {
      const from = byFrom.get(e.from);
      if (from) from.push(e);
      else byFrom.set(e.from, [e]);
      const to = byTo.get(e.to);
      if (to) to.push(e);
      else byTo.set(e.to, [e]);
    }
    for (const list of byFrom.values()) Object.freeze(list);
    for (const list of byTo.values()) Object.freeze(list);
    this.nodeSet = nodeSet;
    this.edgesByFrom = byFrom;
    this.edgesByTo = byTo;
  }

  /** Plain-data view matching `importGraphDataSchema` (stable key order). */
  toJSON(): ImportGraphData {
    return {
      nodes: this.nodes.map((n) => ({ file: n.file, external: n.external })),
      edges: this.edges.map((e) => ({
        from: e.from,
        to: e.to,
        dynamic: e.dynamic,
        typeOnly: e.typeOnly,
        reExport: e.reExport,
      })),
    };
  }

  /**
   * Canonical serialization: 2-space JSON, stable key and array order,
   * exactly one trailing newline. Identical input ⇒ identical bytes.
   */
  serialize(): string {
    return `${JSON.stringify(this.toJSON(), null, 2)}\n`;
  }

  private hasNode(file: string): boolean {
    return this.nodeSet.has(file);
  }

  /** Edges pointing at `file`. Unknown file ⇒ empty result + degraded entry. */
  fanIn(file: string): PartialResultOf<FanResult> {
    return this.fan(file, this.edgesByTo);
  }

  /** Edges leaving `file`. Unknown file ⇒ empty result + degraded entry. */
  fanOut(file: string): PartialResultOf<FanResult> {
    return this.fan(file, this.edgesByFrom);
  }

  private fan(
    file: string,
    index: ReadonlyMap<string, readonly ImportGraphEdge[]>,
  ): PartialResultOf<FanResult> {
    const normalized = normalizePath(file);
    if (!this.hasNode(normalized)) {
      const degraded: Degradation[] = [
        { reason: "file is not a node in the import graph", subject: normalized },
      ];
      return { data: { count: 0, edges: [] }, coverage: 0, degraded };
    }
    const edges = index.get(normalized) ?? EMPTY_EDGES;
    return { data: { count: edges.length, edges }, coverage: 1, degraded: [] };
  }
}
