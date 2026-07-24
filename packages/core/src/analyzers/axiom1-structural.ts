/**
 * Axiom #1 (structural) — first real deterministic rule:
 * `structural/circular-import`. Builds the Story-1.3 import graph over the
 * analyzed project (one graph per discovered tsconfig — solution-style
 * roots contribute several, merged) and reports each import cycle that
 * touches a changed file, once, anchored at the lexicographically-smallest
 * member file (determinism). Type-only edges are ignored — type cycles are
 * legal and erased at runtime. The full Axiom #1 rule set is Story 1.9.
 */
import { computeFindingId, type Degradation, type Finding } from "@agentic-guardrails/contracts";

import type { ImportGraphBuildResult } from "../adapter/language-adapter.js";
import { TypeScriptAdapter } from "../adapter/typescript-adapter.js";
import { ImportGraph } from "../graph/import-graph.js";
import type { Analyzer, AnalyzerContext, AnalyzerResult } from "../pipeline/pipeline.js";

const RULE_ID = "structural/circular-import";
const AXIOM = "1";

/** Case-insensitive filesystems (win32/darwin): git paths and graph paths
 * may disagree in case for the same file — fold before membership compares. */
const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";
function foldCase(p: string): string {
  return CASE_INSENSITIVE ? p.toLowerCase() : p;
}

/**
 * Merges per-tsconfig graph results: union of nodes/edges (the ImportGraph
 * constructor dedupes), union of degradations (deduped by reason+subject),
 * coverage recomputed as resolved/attempted across ALL graphs — never an
 * average of per-graph ratios.
 */
export function mergeGraphResults(
  results: readonly ImportGraphBuildResult[],
): ImportGraphBuildResult {
  const nodes = results.flatMap((r) => [...r.data.nodes]);
  const edges = results.flatMap((r) => [...r.data.edges]);
  const degradedByKey = new Map<string, Degradation>();
  for (const r of results) {
    for (const d of r.degraded) degradedByKey.set(JSON.stringify([d.reason, d.subject]), d);
  }
  const attempted = results.reduce((sum, r) => sum + r.attempted, 0);
  const unresolved = results.reduce((sum, r) => sum + r.unresolved, 0);
  return {
    data: new ImportGraph(nodes, edges),
    coverage: attempted === 0 ? 1 : (attempted - unresolved) / attempted,
    attempted,
    unresolved,
    degraded: [...degradedByKey.values()],
  };
}

export const axiom1Structural: Analyzer = {
  axiom: AXIOM,
  // Async by contract (Analyzer.run — real p-map concurrency); the body is
  // CPU-bound today.
  async run(context: AnalyzerContext): Promise<AnalyzerResult> {
    if (context.changedFiles.length === 0) {
      return { findings: [], degraded: [] };
    }

    const adapter = new TypeScriptAdapter();
    // Graph builds route through the content-addressed cache when the
    // pipeline wires one in (1.7) — a hit skips the ts-morph parse entirely.
    const graphResult = mergeGraphResults(
      context.tsconfigPaths.map((tsconfigPath) => {
        const cached = context.graphCache?.get(tsconfigPath);
        if (cached !== undefined) return cached;
        const built = adapter.buildImportGraph({ tsconfigPath, rootDir: context.repoRoot });
        context.graphCache?.put(tsconfigPath, built);
        return built;
      }),
    );
    const graph = graphResult.data;
    const degraded: Degradation[] = [...graphResult.degraded];

    // Runtime-relevant adjacency: internal → internal, type-only edges
    // excluded (dynamic and re-export edges are still real cycles).
    const internal = new Set(graph.nodes.filter((n) => !n.external).map((n) => n.file));
    const adjacency = new Map<string, string[]>();
    for (const file of internal) adjacency.set(file, []);
    for (const edge of graph.edges) {
      if (edge.typeOnly || !internal.has(edge.from) || !internal.has(edge.to)) continue;
      adjacency.get(edge.from)!.push(edge.to);
    }
    for (const [file, neighbors] of adjacency) {
      adjacency.set(file, [...new Set(neighbors)].sort());
    }

    // Silent-coverage-loss guard: a changed TS file that ended up in NO
    // built graph was not analyzed at all — declare it, per file.
    const internalFolded = new Set([...internal].map(foldCase));
    for (const file of context.changedFiles) {
      if (!internalFolded.has(foldCase(file))) {
        degraded.push({ reason: "changed file absent from the built import graph", subject: file });
      }
    }

    const changed = new Set(context.changedFiles.map(foldCase));
    const findings: Finding[] = [];
    for (const scc of stronglyConnectedComponents(adjacency)) {
      const members = [...scc].sort();
      const anchor = members[0]!;
      const isCycle = members.length > 1 || (adjacency.get(anchor) ?? []).includes(anchor);
      if (!isCycle) continue;
      if (!members.some((m) => changed.has(foldCase(m)))) continue;

      const cycle = shortestCycleFrom(anchor, new Set(members), adjacency);
      if (cycle === null) {
        // Unreachable for a genuine SCC; if the graph is ever inconsistent,
        // declare it — never fabricate a self-loop finding.
        degraded.push({
          reason: "cycle anchor unreachable during BFS (import graph inconsistency)",
          subject: anchor,
        });
        continue;
      }
      const cyclePath = cycle.join(" -> ");
      findings.push({
        findingId: computeFindingId({
          axiom: AXIOM,
          ruleId: RULE_ID,
          file: anchor,
          enclosingSymbol: cyclePath,
        }),
        axiom: AXIOM,
        ruleId: RULE_ID,
        // ponytail: a cycle is a file-level property and graph edges carry no
        // positions yet — anchored at line 1 until 1.9 adds import-line spans.
        location: { file: anchor, startLine: 1, endLine: 1 },
        message: `circular import: ${cyclePath}`,
        tier: "deterministic",
        source: "ast",
        confidence: 1,
        severity: "error",
        enclosingSymbol: cyclePath,
      });
    }

    return { findings, degraded };
  },
};

/** Iterative Tarjan (no recursion — deep import chains must not blow the stack). */
function stronglyConnectedComponents(adjacency: ReadonlyMap<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  for (const start of [...adjacency.keys()].sort()) {
    if (index.has(start)) continue;
    const frames: [string, number][] = [[start, 0]];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const node = frame[0];
      if (frame[1] === 0) {
        index.set(node, counter);
        low.set(node, counter);
        counter += 1;
        stack.push(node);
        onStack.add(node);
      }
      const neighbors = adjacency.get(node) ?? [];
      let descended = false;
      for (let i = frame[1]; i < neighbors.length; i++) {
        const next = neighbors[i]!;
        if (!index.has(next)) {
          frame[1] = i + 1;
          frames.push([next, 0]);
          descended = true;
          break;
        }
        if (onStack.has(next)) low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
      if (descended) continue;
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent !== undefined) {
        low.set(parent[0], Math.min(low.get(parent[0])!, low.get(node)!));
      }
      if (low.get(node) === index.get(node)) {
        const scc: string[] = [];
        for (;;) {
          const member = stack.pop()!;
          onStack.delete(member);
          scc.push(member);
          if (member === node) break;
        }
        sccs.push(scc);
      }
    }
  }
  return sccs;
}

/**
 * Shortest cycle through `anchor` inside its SCC (BFS over sorted neighbor
 * lists — deterministic). Returns e.g. `[a, b, a]`; `[a, a]` for a self-loop;
 * `null` if no cycle is reachable (an inconsistency the caller declares).
 */
function shortestCycleFrom(
  anchor: string,
  members: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, string[]>,
): string[] | null {
  const previous = new Map<string, string>();
  const visited = new Set([anchor]);
  const queue = [anchor];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const next of adjacency.get(node) ?? []) {
      if (!members.has(next)) continue;
      if (next === anchor) {
        const tail: string[] = [];
        for (let cursor = node; cursor !== anchor; cursor = previous.get(cursor)!) {
          tail.push(cursor);
        }
        return [anchor, ...tail.reverse(), anchor];
      }
      if (!visited.has(next)) {
        visited.add(next);
        previous.set(next, node);
        queue.push(next);
      }
    }
  }
  return null;
}
