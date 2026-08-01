/**
 * OD-1 v1 (1.16). Every expectation here is an EXACT value, never an
 * approximation: the whole point of the integer-arithmetic path is that the
 * score is bit-for-bit the same number on every platform, and a test written
 * with `toBeCloseTo` would not notice if it stopped being.
 */
import { describe, expect, it } from "vitest";

import {
  changedKlocMilliOf,
  formatScoreTenths,
  KLOC_FLOOR_MILLI,
  MAX_SCORE_TENTHS,
  od1ScoreTenths,
  OD1_FORMULA_VERSION,
  PROJECT_SCORE_OMITTED,
  scopeIsScorable,
} from "./score.js";

const counts = (error: number, warning = 0, info = 0): Record<string, {
  error: number;
  warning: number;
  info: number;
}> => ({ "1": { error, warning, info } });

describe("changed-KLOC denominator", () => {
  it("is exactly the changed line count above the floor", () => {
    expect(changedKlocMilliOf(2_500)).toBe(2_500); // 2.5 KLOC
    expect(changedKlocMilliOf(101)).toBe(101);
  });

  it("floors a tiny diff at 0.1 KLOC so a one-line change stays finite", () => {
    expect(changedKlocMilliOf(1)).toBe(KLOC_FLOOR_MILLI);
    expect(KLOC_FLOOR_MILLI).toBe(100);
  });

  it("floors a DELETION-ONLY diff too — the divide-by-zero case", () => {
    // Deletions are counted, so a deletion-only diff has a real numerator of
    // lines; a diff of exactly zero measurable lines still gets the floor.
    expect(changedKlocMilliOf(0)).toBe(KLOC_FLOOR_MILLI);
  });
});

describe("od1ScoreTenths — exact values", () => {
  it("rounds an EXACT half up, deterministically", () => {
    // A true tie: 1 info over 20.0 KLOC → penalty = 1·10000/20000 = 0.5
    // tenths exactly. `Math.round` is half-toward-+∞, which is the pinned
    // behaviour — "close enough" here is how two platforms disagree.
    expect(od1ScoreTenths(counts(0, 0, 1), 20_000)).toBe(999);
    // 2 info over 8.0 KLOC → 2.5 tenths exactly → 3.
    expect(od1ScoreTenths(counts(0, 0, 2), 8_000)).toBe(997);
  });

  it("NEVER divides by a zero denominator, whatever a record claims", () => {
    // `changedKlocMilli` is `z.int().min(0)` on a committed, hand-editable,
    // union-merged record: 0 used to give Infinity (rendered as a confident
    // `0.0`) or NaN (serialized as null, rendered as the "no score" dash).
    expect(od1ScoreTenths(counts(1), 0)).toBe(od1ScoreTenths(counts(1), KLOC_FLOOR_MILLI));
    expect(Number.isInteger(od1ScoreTenths({}, 0))).toBe(true);
    expect(od1ScoreTenths({}, 0)).toBe(MAX_SCORE_TENTHS);
  });

  it("scores a clean run 100.0", () => {
    expect(od1ScoreTenths({}, 1_000)).toBe(1000);
    expect(od1ScoreTenths(counts(0), 1_000)).toBe(MAX_SCORE_TENTHS);
  });

  it("applies the 10E + 3W + 1I weights over changedKloc", () => {
    // 1 KLOC, 1 error → 100 − 10/1 = 90.0
    expect(od1ScoreTenths(counts(1), 1_000)).toBe(900);
    // 2 KLOC, 1 error → 100 − 10/2 = 95.0
    expect(od1ScoreTenths(counts(1), 2_000)).toBe(950);
    // 1 KLOC, 1 warning → 100 − 3 = 97.0
    expect(od1ScoreTenths(counts(0, 1), 1_000)).toBe(970);
    // 1 KLOC, 1 info → 100 − 1 = 99.0
    expect(od1ScoreTenths(counts(0, 0, 1), 1_000)).toBe(990);
    // Mixed, summed across axioms.
    expect(
      od1ScoreTenths(
        { "1": { error: 1, warning: 2, info: 3 }, "5": { error: 1, warning: 0, info: 0 } },
        1_000,
      ),
    ).toBe(1000 - (10 + 6 + 3 + 10) * 10);
  });

  it("keeps a TINY diff finite through the floor", () => {
    // 1 changed line → floor 0.1 KLOC → 100 − 10/0.1 = 0 (floored), never Inf.
    const tenths = od1ScoreTenths(counts(1), changedKlocMilliOf(1));
    expect(Number.isFinite(tenths)).toBe(true);
    expect(tenths).toBe(0);
    // One INFO finding on a one-line diff: 100 − 1/0.1 = 90.0 exactly.
    expect(od1ScoreTenths(counts(0, 0, 1), changedKlocMilliOf(1))).toBe(900);
  });

  it("FLOORS at 0 for overwhelming findings — never negative", () => {
    expect(od1ScoreTenths(counts(1_000), 1_000)).toBe(0);
  });

  it("rounds to a pinned tenth, deterministically", () => {
    // 3 KLOC, 1 error → 100 − 10/3 = 96.666… → 96.7 exactly, every platform.
    expect(od1ScoreTenths(counts(1), 3_000)).toBe(967);
    // 7 KLOC, 1 warning → 100 − 3/7 = 99.571… → 99.6
    expect(od1ScoreTenths(counts(0, 1), 7_000)).toBe(996);
  });
});

describe("rendering and the un-scorable scope", () => {
  it("renders tenths without ever dividing by 10 in a float", () => {
    expect(formatScoreTenths(1000)).toBe("100.0");
    expect(formatScoreTenths(967)).toBe("96.7");
    expect(formatScoreTenths(0)).toBe("0.0");
    expect(formatScoreTenths(5)).toBe("0.5");
  });

  it("`--project` has no denominator by construction, so it has no score", () => {
    expect(scopeIsScorable("project")).toBe(false);
    for (const kind of ["uncommitted", "branch", "pr"] as const) {
      expect(scopeIsScorable(kind)).toBe(true);
    }
    expect(PROJECT_SCORE_OMITTED).toContain("no changed-KLOC denominator");
  });

  it("stamps a version, so a v2 number can never pass as a v1 one", () => {
    expect(OD1_FORMULA_VERSION).toBe("od-1-v1");
  });
});
