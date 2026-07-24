import { findingSchema, type Finding } from "@agentic-guardrails/contracts";
import { describe, expect, it } from "vitest";

import { mergeFindings } from "./merge.js";

function finding(overrides: Partial<Finding> & { findingId: string }): Finding {
  return {
    axiom: "1",
    ruleId: "structural/rule",
    location: { file: "src/a.ts", startLine: 10, endLine: 20 },
    message: `message ${overrides.findingId}`,
    tier: "deterministic",
    source: "ast",
    confidence: 1,
    severity: "warning",
    ...overrides,
  };
}

function at(findingId: string, startLine: number, endLine: number, rest: Partial<Finding> = {}) {
  return finding({ findingId, location: { file: "src/a.ts", startLine, endLine }, ...rest });
}

describe("mergeFindings (FR-21)", () => {
  it("merges >50% overlap on same file+axiom: source array, strongest severity, both messages", () => {
    const a = at("bbb", 10, 20, { severity: "warning", source: "ast" });
    const b = at("aaa", 15, 25, { severity: "error", source: "regex" });
    const out = mergeFindings([a, b]);
    expect(out).toHaveLength(1);
    const m = out[0]!;
    // Lexicographically smallest constituent id — disposition continuity.
    expect(m.findingId).toBe("aaa");
    expect(m.location).toEqual({ file: "src/a.ts", startLine: 10, endLine: 25 });
    expect(m.severity).toBe("error");
    expect(m.source).toEqual(["ast", "regex"]);
    // Both descriptions preserved, range order.
    expect(m.message).toBe("message bbb | message aaa");
    // The merged shape stays contract-valid.
    expect(findingSchema.safeParse(m).success).toBe(true);
  });

  it("merges a contained range (overlap = 100% of the smaller range) — both directions", () => {
    expect(mergeFindings([at("a", 10, 30), at("b", 12, 14)])).toHaveLength(1);
    expect(mergeFindings([at("b", 12, 14), at("a", 10, 30)])).toHaveLength(1);
  });

  it("never merges adjacent non-overlapping ranges", () => {
    const out = mergeFindings([at("a", 10, 20), at("b", 21, 30)]);
    expect(out).toHaveLength(2);
    expect(out.map((f) => f.source)).toEqual(["ast", "ast"]); // scalar untouched
  });

  it("does not merge at exactly 50% of the smaller range (strictly greater required)", () => {
    // Ranges 10-19 (10 lines) and 15-30: overlap 15-19 = 5 lines = 50%.
    expect(mergeFindings([at("a", 10, 19), at("b", 15, 30)])).toHaveLength(2);
  });

  it("never merges across axioms, files, or tiers", () => {
    expect(mergeFindings([at("a", 10, 20), at("b", 10, 20, { axiom: "5" })])).toHaveLength(2);
    expect(
      mergeFindings([
        at("a", 10, 20),
        finding({ findingId: "b", location: { file: "src/b.ts", startLine: 10, endLine: 20 } }),
      ]),
    ).toHaveLength(2);
  });

  it("merges a transitive chain greedily left-to-right against the accumulated cluster range", () => {
    // A 10-20, B 15-25, C 20-28: C overlaps the A+B cluster (10-25) by 6 of
    // its 9 lines (>50%) even though C barely overlaps A alone.
    const out = mergeFindings([at("c", 20, 28), at("a", 10, 20), at("b", 15, 25)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.location).toEqual({ file: "src/a.ts", startLine: 10, endLine: 28 });
    expect(out[0]!.findingId).toBe("a");
  });

  it("is deterministic: input order never changes the output", () => {
    const set = [at("c", 20, 28), at("a", 10, 20), at("b", 15, 25), at("d", 40, 50)];
    const forward = mergeFindings(set);
    const reversed = mergeFindings([...set].reverse());
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });

  it("collapses exact duplicate messages instead of repeating them", () => {
    const out = mergeFindings([at("a", 10, 20, { message: "same" }), at("b", 12, 22, { message: "same" })]);
    expect(out[0]!.message).toBe("same");
  });

  it("passes empty and single-finding inputs through unchanged", () => {
    expect(mergeFindings([])).toEqual([]);
    const single = at("a", 1, 1);
    expect(mergeFindings([single])).toEqual([single]);
  });

  it("orders equal-range, equal-id constituents deterministically by message then ruleId", () => {
    // Same range AND same findingId (the same rule firing twice on one
    // symbol) — without the message/ruleId tie-break the merged message
    // order would depend on input order.
    const x = at("same", 10, 20, { message: "alpha" });
    const y = at("same", 10, 20, { message: "beta" });
    const forward = mergeFindings([x, y]);
    const reversed = mergeFindings([y, x]);
    expect(forward).toHaveLength(1);
    expect(forward[0]!.message).toBe("alpha | beta");
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });

  it("preserves a constituent's degraded marker when the owner has none", () => {
    const marker = { reason: "parse-error", subject: "src/a.ts" };
    const owner = at("aaa", 10, 20); // owns the merged id, no marker
    const marked = at("bbb", 12, 22, { degraded: marker });
    const out = mergeFindings([owner, marked]);
    expect(out).toHaveLength(1);
    expect(out[0]!.findingId).toBe("aaa");
    expect(out[0]!.degraded).toEqual(marker);
  });

  it("the owner's own degraded marker wins over a constituent's", () => {
    const ownerMarker = { reason: "owner", subject: "src/a.ts" };
    const otherMarker = { reason: "other", subject: "src/a.ts" };
    const out = mergeFindings([
      at("aaa", 10, 20, { degraded: ownerMarker }),
      at("bbb", 12, 22, { degraded: otherMarker }),
    ]);
    expect(out[0]!.degraded).toEqual(ownerMarker);
  });
});
