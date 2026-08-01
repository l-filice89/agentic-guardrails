/**
 * FR-21 reduce/merge (story 1.7). Pure and deterministic — same input,
 * same output, no I/O. The rules, stated ONCE, here:
 *
 * - Findings merge only within the same (file, axiom, tier, ruleId).
 *   Different axioms — or files, tiers, or rules — NEVER merge: two DIFFERENT
 *   rules colliding at one line are two distinct issues (each keeps its own
 *   ruleId, message, and disposition); FR-21's target is the SAME rule
 *   firing across sources/ranges.
 * - Overlap rule: two ranges merge when the overlapping line count is
 *   STRICTLY greater than 50% of the SMALLER range's line count. A
 *   contained range therefore always merges (overlap = 100% of itself);
 *   adjacent non-overlapping ranges never do (overlap = 0).
 * - Transitive chains: each group is sorted by (startLine, endLine,
 *   findingId) and scanned greedily left-to-right; a candidate is absorbed
 *   when it clears the overlap rule against the accumulated cluster's
 *   COMBINED range (so A~B, B~C can collapse to one finding even when A
 *   and C do not overlap directly).
 * - Merged finding: `findingId` = lexicographically smallest constituent
 *   id — reusing an existing id keeps disposition continuity for at least
 *   one constituent, where a hash of all ids would orphan every existing
 *   disposition; `location` = combined range; `severity` = strongest
 *   (error > warning > info); `source` = sorted union as an ARRAY; messages
 *   joined with " | " in range order (both descriptions preserved, exact
 *   duplicates collapsed); `degraded` = the owner's marker, else the first
 *   marked constituent's (range order); all remaining fields come from the
 *   id-owning constituent.
 */
import type { Finding, FindingSource } from "@agentic-guardrails/contracts";

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

/** Separator between preserved constituent messages of a merged finding. */
export const MERGED_MESSAGE_SEPARATOR = " | ";

export function mergeFindings(findings: readonly Finding[]): Finding[] {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = JSON.stringify([finding.location.file, finding.axiom, finding.tier, finding.ruleId]);
    const group = groups.get(key);
    if (group) group.push(finding);
    else groups.set(key, [finding]);
  }

  const out: Finding[] = [];
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key)!;
    group.sort(
      (a, b) =>
        a.location.startLine - b.location.startLine ||
        a.location.endLine - b.location.endLine ||
        compare(a.findingId, b.findingId) ||
        // Full tie-break: two distinct findings can share range AND id (e.g.
        // the same rule firing twice on one symbol) — the message keeps the
        // merged-message order, and thus the artifact bytes, stable (ruleId
        // is constant within a group — it is part of the group key).
        compare(a.message, b.message),
    );
    let cluster: Finding[] = [group[0]!];
    let start = group[0]!.location.startLine;
    let end = group[0]!.location.endLine;
    for (const finding of group.slice(1)) {
      if (
        contributesNewSource(cluster, finding) &&
        majorityOverlap(start, end, finding.location.startLine, finding.location.endLine)
      ) {
        cluster.push(finding);
        end = Math.max(end, finding.location.endLine); // start is already minimal (sorted)
      } else {
        out.push(materialize(cluster, start, end));
        cluster = [finding];
        start = finding.location.startLine;
        end = finding.location.endLine;
      }
    }
    out.push(materialize(cluster, start, end));
  }
  return out; // the pipeline re-sorts into artifact order afterwards
}

/** FR-21 merges corroborating sources. Two distinct findings emitted by the
 * same source remain distinct even when they share an anchor (for example,
 * two duplicate-code pairs ending at the same function). */
function contributesNewSource(cluster: readonly Finding[], candidate: Finding): boolean {
  if (candidate.ruleId !== "cleanliness/duplicate-code") return true;
  const existing = new Set(
    cluster.flatMap((finding) => (Array.isArray(finding.source) ? finding.source : [finding.source])),
  );
  const incoming = Array.isArray(candidate.source) ? candidate.source : [candidate.source];
  return incoming.some((source) => !existing.has(source));
}

/** >50% of the SMALLER range's line count overlaps the other (strict). */
function majorityOverlap(s1: number, e1: number, s2: number, e2: number): boolean {
  const overlap = Math.min(e1, e2) - Math.max(s1, s2) + 1;
  if (overlap <= 0) return false;
  const smaller = Math.min(e1 - s1 + 1, e2 - s2 + 1);
  return overlap * 2 > smaller;
}

function materialize(cluster: readonly Finding[], startLine: number, endLine: number): Finding {
  if (cluster.length === 1) return cluster[0]!;
  const owner = [...cluster].sort((a, b) => compare(a.findingId, b.findingId))[0]!;
  const sources = [
    ...new Set(cluster.flatMap((f) => (Array.isArray(f.source) ? f.source : [f.source]))),
  ].sort() as FindingSource[];
  const severity = cluster.reduce(
    (strongest, f) => (SEVERITY_RANK[f.severity] < SEVERITY_RANK[strongest] ? f.severity : strongest),
    cluster[0]!.severity,
  );
  const messages = [...new Set(cluster.map((f) => f.message))];
  // A constituent's degraded marker must survive the merge: the owner wins
  // when it has one; otherwise the first (range-order) marked constituent's
  // marker is preserved — degradation never silently disappears.
  const degraded = owner.degraded ?? cluster.find((f) => f.degraded !== undefined)?.degraded;
  return {
    ...owner,
    location: { file: owner.location.file, startLine, endLine },
    message: messages.join(MERGED_MESSAGE_SEPARATOR),
    source: sources,
    severity,
    ...(degraded === undefined ? {} : { degraded }),
  };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0; // code-point order, locale-independent
}
