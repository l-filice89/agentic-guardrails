/**
 * Story 1.17 SPIKE-4 hazard tests for the pure noise-gate logic
 * (`noise-rate.ts`): every gate behavior from the spec's I/O matrix gets an
 * explicit test — ≥30% overall fails, exactly-30% fails (the bar is strictly
 * <30%), above-baseline fails naming the analyzer, a missing baseline entry
 * fails loudly (never silently skipped), a zero denominator passes declared
 * (never 0/0 NaN), and info-severity findings are excluded from both sides.
 *
 * All gate decisions are integer/rational arithmetic — these tests would
 * catch a float sneaking into a pass/fail comparison at the 30% boundary.
 */
import { describe, expect, it } from "vitest";

import { checkGates, classifyFindings, formatTable, goldenFindingIds } from "./noise-rate.js";

describe("classifyFindings — placement-based CI proxy labeling", () => {
  it("violation tree: golden-matched findings are TPs, unmatched error/warning findings are FPs", () => {
    const counts = classifyFindings(
      [
        { findingId: "aaa", severity: "error" },
        { findingId: "bbb", severity: "warning" },
        { findingId: "not-in-golden", severity: "error" },
      ],
      ["aaa", "bbb"],
    );
    expect(counts).toEqual({ falsePositives: 1, denominator: 3 });
  });

  it("clean tree (no golden entries): every error/warning finding is a FP", () => {
    const counts = classifyFindings(
      [
        { findingId: "x", severity: "error" },
        { findingId: "y", severity: "warning" },
      ],
      [],
    );
    expect(counts).toEqual({ falsePositives: 2, denominator: 2 });
  });

  it("info-severity findings are excluded from numerator AND denominator", () => {
    const counts = classifyFindings(
      [
        { findingId: "info-noise", severity: "info" },
        { findingId: "aaa", severity: "error" },
      ],
      ["aaa"],
    );
    expect(counts).toEqual({ falsePositives: 0, denominator: 1 });
  });

  it("a golden id is consumed once — a duplicated finding id is not double-credited as TP", () => {
    const counts = classifyFindings(
      [
        { findingId: "aaa", severity: "error" },
        { findingId: "aaa", severity: "error" },
      ],
      ["aaa"],
    );
    expect(counts).toEqual({ falsePositives: 1, denominator: 2 });
  });

  it("throws on a severity outside error/warning/info — never silently out of both sides", () => {
    expect(() =>
      classifyFindings(
        [{ findingId: "x", severity: "critical" as never }],
        [],
      ),
    ).toThrow(/unknown finding severity/);
  });
});

describe("goldenFindingIds — validated golden-file parse", () => {
  it("extracts findingIds from a well-formed golden array", () => {
    expect(goldenFindingIds([{ findingId: "a" }, { findingId: "b" }], "g.json")).toEqual([
      "a",
      "b",
    ]);
  });

  it("throws a clear error on a non-array golden file", () => {
    expect(() => goldenFindingIds({ findings: [] }, "g.json")).toThrow(/expected an array/);
  });

  it("throws a clear error on an entry without a string findingId — never mass misclassification", () => {
    expect(() => goldenFindingIds([{ findingId: "a" }, { ruleId: "x" }], "g.json")).toThrow(
      /entry 1 has no string findingId/,
    );
  });
});

describe("checkGates — the arithmetic-on-integers gate", () => {
  const base = (falsePositives: number, denominator: number) => ({
    falsePositives,
    denominator,
  });

  it("passes when below 30% overall and at baseline", () => {
    const result = checkGates({ a: base(2, 10) }, { a: base(2, 10) });
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails at ≥30% overall, rate printed in the failure", () => {
    const result = checkGates({ a: base(4, 10) }, { a: base(4, 10) });
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes("overall") && f.includes("40"))).toBe(true);
  });

  it("fails at EXACTLY 30% — the bar is strictly <30% (numerator·10 == denominator·3)", () => {
    const result = checkGates({ a: base(3, 10) }, { a: base(3, 10) });
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes("overall"))).toBe(true);
  });

  it("fails an analyzer whose rate rises above its committed baseline, NAMING the analyzer", () => {
    const result = checkGates(
      { quiet: base(0, 10), rising: base(1, 10) },
      { quiet: base(0, 10), rising: base(0, 10) },
    );
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes('"rising"') && f.includes("baseline"))).toBe(
      true,
    );
    expect(result.failures.some((f) => f.includes('"quiet"'))).toBe(false);
  });

  it("passes an analyzer whose rate FELL below baseline (no baseline mutation implied)", () => {
    const result = checkGates({ a: base(0, 10) }, { a: base(1, 10) });
    expect(result.pass).toBe(true);
  });

  it("fails when an analyzer has NO baseline entry — 'record a baseline entry', never silently skipped", () => {
    const result = checkGates({ newcomer: base(0, 5) }, {});
    expect(result.pass).toBe(false);
    expect(
      result.failures.some(
        (f) => f.includes('"newcomer"') && f.includes("record a baseline entry"),
      ),
    ).toBe(true);
  });

  it("fails on a MALFORMED baseline entry (string counts / stored rate) — NaN must never silently pass a rise", () => {
    for (const bad of [
      { rate: 0 },
      { falsePositives: "0", denominator: "10" },
      { falsePositives: 0.5, denominator: 10 },
      { falsePositives: -1, denominator: 10 },
      null,
    ]) {
      const result = checkGates({ a: base(0, 10) }, { a: bad });
      expect(result.pass).toBe(false);
      expect(result.failures.some((f) => f.includes('"a"') && f.includes("malformed"))).toBe(true);
    }
  });

  it("fails a baseline entry with falsePositives > denominator as malformed", () => {
    const result = checkGates({ a: base(0, 10) }, { a: base(5, 4) });
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes("malformed"))).toBe(true);
  });

  it("fails a STALE baseline key with no sweep result — a renamed analyzer cannot linger", () => {
    const result = checkGates({ a: base(0, 10) }, { a: base(0, 10), renamed: base(0, 5) });
    expect(result.pass).toBe(false);
    expect(
      result.failures.some((f) => f.includes('"renamed"') && f.includes("no sweep result")),
    ).toBe(true);
  });

  it("zero denominator: rate 0, passes — never a 0/0 NaN decision", () => {
    const result = checkGates({ silent: base(0, 0) }, { silent: base(0, 0) });
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("a FP against a zero-denominator baseline is a rise above baseline (0-rate baseline)", () => {
    const result = checkGates({ a: base(1, 10) }, { a: base(0, 0) });
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes('"a"'))).toBe(true);
  });

  it("rational comparison survives counts a float would mangle at the 30% bar", () => {
    // 3/10 exactly: any float epsilon slop in either direction flips this.
    expect(checkGates({ a: base(2_999_999, 10_000_000) }, { a: base(2_999_999, 10_000_000) }).pass).toBe(
      true,
    );
    expect(checkGates({ a: base(3_000_000, 10_000_000) }, { a: base(3_000_000, 10_000_000) }).pass).toBe(
      false,
    );
  });
});

describe("formatTable — reporting on every run, pass or fail", () => {
  it("renders per-analyzer FP / denominator / rate rows plus an overall row, declaring zero denominators", () => {
    const table = formatTable({
      a: { falsePositives: 1, denominator: 4 },
      silent: { falsePositives: 0, denominator: 0 },
    });
    expect(table).toContain("a");
    expect(table).toContain("1");
    expect(table).toContain("4");
    expect(table).toContain("25.0%");
    expect(table).toContain("no error/warning emissions");
    expect(table).toContain("overall");
  });
});
