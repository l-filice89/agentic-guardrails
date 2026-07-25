/**
 * Axiom #1 (structural) — the full deterministic rule set (Story 1.9), all
 * inside the ONE registered axiom-1 analyzer:
 *
 * - `structural/circular-import`   error    import cycle touching a changed
 *                                           file, anchored at the import line
 *                                           of the cycle edge leaving the
 *                                           lexicographically-smallest member
 * - `structural/unresolved-import` error    changed file whose relative/alias
 *                                           import specifier fails resolution
 *                                           (bare externals are verified
 *                                           externals, never findings)
 * - `structural/dependency-direction` error with `boundaries` declared: an
 *                                           import edge whose from→to layer
 *                                           pair is not in the allowed map,
 *                                           or whose internal target sits in
 *                                           NO declared layer (the
 *                                           `(unassigned)` pseudo-layer —
 *                                           closing the routing bypass)
 * - `structural/unassigned-file`   warning  with `boundaries` declared: a
 *                                           changed file matching no layer
 *                                           prefix (fail-closed)
 *
 * Builds the Story-1.3 import graph over the analyzed project (one graph per
 * discovered tsconfig — solution-style roots contribute several, merged).
 * Type-only edges are ignored by the cycle AND direction rules — they are
 * erased at runtime. Without a `boundaries` declaration the two
 * declaration-dependent rules emit nothing (nothing declared = nothing to
 * check — NOT a degradation). Same-layer imports are always allowed and need
 * no declaring; at equal prefix length the first-declared layer wins,
 * otherwise the longest matching prefix does.
 */
import {
  computeFindingId,
  type Boundaries,
  type Degradation,
  type Finding,
} from "@agentic-guardrails/contracts";

import type { ImportGraphBuildResult, UnresolvedImport } from "../adapter/language-adapter.js";
import { TypeScriptAdapter } from "../adapter/typescript-adapter.js";
import { ImportGraph } from "../graph/import-graph.js";
import type { Analyzer, AnalyzerContext, AnalyzerResult } from "../pipeline/pipeline.js";

const AXIOM = "1";
const RULE_CIRCULAR = "structural/circular-import";
const RULE_UNRESOLVED = "structural/unresolved-import";
const RULE_DIRECTION = "structural/dependency-direction";
const RULE_UNASSIGNED = "structural/unassigned-file";

/** Case-insensitive filesystems (win32/darwin): git paths and graph paths
 * may disagree in case for the same file — fold before membership compares. */
const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";
function foldCase(p: string): string {
  return CASE_INSENSITIVE ? p.toLowerCase() : p;
}

/**
 * Merges per-tsconfig graph results: union of nodes/edges (the ImportGraph
 * constructor dedupes), union of degradations (deduped by reason+subject)
 * and unresolved-import records (deduped by from+specifier, smallest line),
 * coverage recomputed as resolved/attempted across ALL graphs — never an
 * average of per-graph ratios.
 */
export function mergeGraphResults(
  results: readonly ImportGraphBuildResult[],
): ImportGraphBuildResult {
  const nodes = results.flatMap((r) => [...r.data.nodes]);
  const edges = results.flatMap((r) => [...r.data.edges]);
  const degradedByKey = new Map<string, Degradation>();
  const unresolvedByKey = new Map<string, UnresolvedImport>();
  for (const r of results) {
    for (const d of r.degraded) degradedByKey.set(JSON.stringify([d.reason, d.subject]), d);
    for (const u of r.unresolvedImports) {
      const key = JSON.stringify([u.from, u.specifier]);
      const existing = unresolvedByKey.get(key);
      if (existing === undefined || u.line < existing.line) unresolvedByKey.set(key, u);
    }
  }
  const attempted = results.reduce((sum, r) => sum + r.attempted, 0);
  const unresolved = results.reduce((sum, r) => sum + r.unresolved, 0);
  return {
    data: new ImportGraph(nodes, edges),
    coverage: attempted === 0 ? 1 : (attempted - unresolved) / attempted,
    attempted,
    unresolved,
    unresolvedImports: [...unresolvedByKey.values()].sort(
      (a, b) => compare(a.from, b.from) || compare(a.specifier, b.specifier),
    ),
    degraded: [...degradedByKey.values()],
  };
}

/**
 * The layer a file belongs to under the declared boundaries: the LONGEST
 * matching path prefix wins (a file under two layer prefixes belongs to the
 * more specific one); at equal length the first-declared layer wins.
 * Undefined → the file matches no declared layer. Prefix matching folds case
 * on case-insensitive platforms — the same convention as every other path
 * compare here (git paths and declared prefixes may disagree in case for
 * the same directory).
 */
export function layerOf(file: string, layers: Boundaries["layers"]): string | undefined {
  const fileFolded = foldCase(file);
  let bestName: string | undefined;
  let bestLength = -1;
  for (const layer of layers) {
    for (const declared of layer.paths) {
      const prefix = foldCase(declared.replace(/\/+$/, ""));
      if (fileFolded !== prefix && !fileFolded.startsWith(`${prefix}/`)) continue;
      if (prefix.length > bestLength) {
        bestLength = prefix.length;
        bestName = layer.name;
      }
    }
  }
  return bestName;
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
    // excluded (dynamic and re-export edges are still real cycles). Edge
    // lines indexed by (from, to), smallest line winning, so cycle findings
    // anchor at the real import statement.
    const internal = new Set(graph.nodes.filter((n) => !n.external).map((n) => n.file));
    const adjacency = new Map<string, string[]>();
    const edgeLine = new Map<string, number>();
    for (const file of internal) adjacency.set(file, []);
    for (const edge of graph.edges) {
      if (edge.typeOnly || !internal.has(edge.from) || !internal.has(edge.to)) continue;
      adjacency.get(edge.from)!.push(edge.to);
      const key = JSON.stringify([edge.from, edge.to]);
      const known = edgeLine.get(key);
      if (known === undefined || edge.line < known) edgeLine.set(key, edge.line);
    }
    for (const [file, neighbors] of adjacency) {
      adjacency.set(file, [...new Set(neighbors)].sort());
    }

    // Deduped change list: a duplicate changedFiles entry must never double
    // any per-file finding or degradation.
    const changedList = [...new Set(context.changedFiles)];

    // Silent-coverage-loss guard: a changed TS file that ended up in NO
    // built graph was not analyzed at all — declare it, per file.
    const internalFolded = new Set([...internal].map(foldCase));
    const absentFromGraph = new Set<string>();
    for (const file of changedList) {
      if (!internalFolded.has(foldCase(file))) {
        absentFromGraph.add(file);
        degraded.push({ reason: "changed file absent from the built import graph", subject: file });
      }
    }

    const changed = new Set(changedList.map(foldCase));
    const findings: Finding[] = [];

    // ---- structural/circular-import (error) --------------------------------
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
      // Real location: the import line of the cycle edge leaving the anchor.
      // A missing line for an adjacency-known edge is a graph inconsistency —
      // declared loudly, never silently anchored at line 1.
      const line = edgeLine.get(JSON.stringify([anchor, cycle[1]!]));
      if (line === undefined) {
        degraded.push({
          reason: "cycle edge has no known import line (import graph inconsistency)",
          subject: anchor,
        });
        continue;
      }
      findings.push({
        findingId: computeFindingId({
          axiom: AXIOM,
          ruleId: RULE_CIRCULAR,
          file: anchor,
          enclosingSymbol: cyclePath,
        }),
        axiom: AXIOM,
        ruleId: RULE_CIRCULAR,
        location: { file: anchor, startLine: line, endLine: line },
        message: `circular import: ${cyclePath}`,
        tier: "deterministic",
        source: "ast",
        confidence: 1,
        severity: "error",
        enclosingSymbol: cyclePath,
      });
    }

    // ---- structural/unresolved-import (error) ------------------------------
    // Honors the 1.4 delegation: a deleted or misspelled relative/alias
    // import target in a CHANGED file. The graph-build degradation for the
    // same event stays above (coverage truth) — this is the actionable
    // surface. Discriminator = the specifier (two unresolved imports in one
    // file get distinct findingIds).
    for (const u of graphResult.unresolvedImports) {
      if (!changed.has(foldCase(u.from))) continue;
      findings.push({
        findingId: computeFindingId({
          axiom: AXIOM,
          ruleId: RULE_UNRESOLVED,
          file: u.from,
          enclosingSymbol: u.specifier,
        }),
        axiom: AXIOM,
        ruleId: RULE_UNRESOLVED,
        location: { file: u.from, startLine: u.line, endLine: u.line },
        // Type-only imports are erased at runtime — the message must not
        // imply runtime breakage, but the type still fails to resolve
        // (severity stays error: the build is broken either way).
        message: u.typeOnly
          ? `unresolved type-only import "${u.specifier}" — the type import cannot resolve; target missing, deleted, or misspelled`
          : `unresolved import "${u.specifier}" — target missing, deleted, or misspelled`,
        tier: "deterministic",
        source: "ast",
        confidence: 1,
        severity: "error",
        enclosingSymbol: u.specifier,
      });
    }

    // ---- boundaries-dependent rules (only with a declaration) --------------
    // Absent `boundaries` → nothing declared = nothing to check; NOT a
    // degradation.
    const boundaries = context.boundaries;
    if (boundaries !== undefined) {
      // structural/dependency-direction (error): internal value edges leaving
      // a changed file whose from→to layer pair is not allowed. Type-only
      // edges are exempt (mirrors the cycle rule — compile-time only);
      // dynamic imports and re-exports are real runtime dependencies and ARE
      // checked. External targets (bare specifiers) are never layer-checked.
      // An internal target assigned to NO layer is NOT skipped: skipping it
      // would let any import routed through an unassigned internal file
      // evade both rules — it fires with the `(unassigned)` pseudo-layer.
      // Discriminator = `fromLayer->toLayer:target` (line-free), deduped per
      // importing file at the smallest offending line.
      const byDiscriminator = new Map<string, { from: string; to: string; line: number; fromLayer: string; toLayer: string | undefined }>();
      for (const edge of graph.edges) {
        if (edge.typeOnly || !internal.has(edge.from) || !internal.has(edge.to)) continue;
        if (!changed.has(foldCase(edge.from))) continue;
        const fromLayer = layerOf(edge.from, boundaries.layers);
        // An unassigned IMPORTER is the unassigned-file rule's business.
        if (fromLayer === undefined) continue;
        const toLayer = layerOf(edge.to, boundaries.layers);
        if (toLayer !== undefined) {
          if (fromLayer === toLayer) continue; // self-dependencies always allowed
          // Object.hasOwn guard: a layer literally named "constructor" or
          // "toString" must not resolve through Object.prototype (crash).
          const allowedTargets = Object.hasOwn(boundaries.allowed, fromLayer)
            ? boundaries.allowed[fromLayer]!
            : [];
          if (allowedTargets.includes(toLayer)) continue;
        }
        const key = JSON.stringify([edge.from, `${fromLayer}->${toLayer ?? "(unassigned)"}:${edge.to}`]);
        const known = byDiscriminator.get(key);
        if (known === undefined || edge.line < known.line) {
          byDiscriminator.set(key, { from: edge.from, to: edge.to, line: edge.line, fromLayer, toLayer });
        }
      }
      for (const v of [...byDiscriminator.values()].sort(
        (a, b) => compare(a.from, b.from) || a.line - b.line || compare(a.to, b.to),
      )) {
        const discriminator = `${v.fromLayer}->${v.toLayer ?? "(unassigned)"}:${v.to}`;
        const message =
          v.toLayer === undefined
            ? `disallowed dependency: layer "${v.fromLayer}" imports ${v.to}, which sits outside every declared boundary layer (${v.from} -> ${v.to})`
            : `disallowed dependency direction: layer "${v.fromLayer}" may not import layer "${v.toLayer}" (${v.from} -> ${v.to})`;
        findings.push({
          findingId: computeFindingId({
            axiom: AXIOM,
            ruleId: RULE_DIRECTION,
            file: v.from,
            enclosingSymbol: discriminator,
          }),
          axiom: AXIOM,
          ruleId: RULE_DIRECTION,
          location: { file: v.from, startLine: v.line, endLine: v.line },
          message,
          tier: "deterministic",
          source: "ast",
          confidence: 1,
          severity: "error",
          enclosingSymbol: discriminator,
        });
      }

      // structural/unassigned-file (warning): declaring a layout makes files
      // outside it visible (fail-closed, like ALLOWED_WORKSPACE_DEPS). One
      // per file, no enclosingSymbol (file-level identity); location is the
      // SYNTHETIC line 1 (a whole-file condition has no real import line).
      // A file already degraded as absent from every built graph is skipped
      // — the degradation is the surface for that event, not a double report.
      for (const file of changedList) {
        if (absentFromGraph.has(file)) continue;
        if (layerOf(file, boundaries.layers) !== undefined) continue;
        findings.push({
          findingId: computeFindingId({
            axiom: AXIOM,
            ruleId: RULE_UNASSIGNED,
            file,
            enclosingSymbol: "",
          }),
          axiom: AXIOM,
          ruleId: RULE_UNASSIGNED,
          location: { file, startLine: 1, endLine: 1 },
          message: `file matches no declared boundary layer — assign it a layer in boundaries.layers or move it`,
          tier: "deterministic",
          source: "ast",
          confidence: 1,
          severity: "warning",
        });
      }
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

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0; // code-point order, locale-independent
}
