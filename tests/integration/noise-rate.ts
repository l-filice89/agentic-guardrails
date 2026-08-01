/**
 * Story 1.17 SPIKE-4 pure noise-gate logic. No I/O, no spawning — the e2e
 * sweep (`noise-metric.e2e.test.ts`) feeds it findings and the committed
 * baseline; the hazard tests (`noise-rate.test.ts`) exercise the gate edges
 * directly.
 *
 * CI-proxy labeling is placement-based: a finding matching an
 * `expected-findings.json` entry (by `findingId` — the golden files carry the
 * full deterministic findings, byte-compared by the sibling e2e suites) is a
 * true positive; any other error/warning finding is a false positive. The
 * denominator is error/warning findings only — info is excluded from BOTH
 * sides, matching the live DR-1 metric definition.
 *
 * THE GATE IS ARITHMETIC ON INTEGERS. Rates are compared as rationals
 * (`num·denB` vs `numB·denA`); no float ever decides pass/fail. Floats appear
 * only in `formatTable`, which renders display strings.
 */

import type { Finding } from "@agentic-guardrails/contracts";

export interface NoiseCounts {
  falsePositives: number;
  denominator: number;
}

export interface ClassifiableFinding {
  findingId: string;
  severity: Finding["severity"];
}

/**
 * Classify one tree's findings against its golden true-positive ids (empty
 * for `clean/` and `noise/` trees, where every emission is a false positive).
 * Each golden id is consumed at most once, so a duplicated emission cannot
 * double-credit itself as a true positive.
 */
export function classifyFindings(
  findings: ClassifiableFinding[],
  expectedFindingIds: string[],
): NoiseCounts {
  const unconsumed = new Map<string, number>();
  for (const id of expectedFindingIds) {
    unconsumed.set(id, (unconsumed.get(id) ?? 0) + 1);
  }
  let falsePositives = 0;
  let denominator = 0;
  for (const finding of findings) {
    // Exhaustive on severity: info is excluded from BOTH sides by definition;
    // anything else must never silently fall out of the metric.
    if (finding.severity === "info") continue;
    if (finding.severity !== "error" && finding.severity !== "warning") {
      throw new Error(
        `unknown finding severity ${JSON.stringify(finding.severity)} on ${finding.findingId} — the noise metric only defines error/warning/info`,
      );
    }
    denominator += 1;
    const remaining = unconsumed.get(finding.findingId) ?? 0;
    if (remaining > 0) {
      unconsumed.set(finding.findingId, remaining - 1);
    } else {
      falsePositives += 1;
    }
  }
  return { falsePositives, denominator };
}

/**
 * Extract the true-positive labels from a parsed `expected-findings.json`.
 * A malformed golden file must be a clear error, never mass misclassification
 * (every TP silently becoming a FP would fail the gate for the wrong reason —
 * or, worse, a golden file of garbage ids could mask real drift).
 */
export function goldenFindingIds(json: unknown, source: string): string[] {
  if (!Array.isArray(json)) {
    throw new Error(`${source}: expected an array of findings, got ${typeof json}`);
  }
  return json.map((entry, index) => {
    const findingId =
      typeof entry === "object" && entry !== null
        ? (entry as { findingId?: unknown }).findingId
        : undefined;
    if (typeof findingId !== "string" || findingId === "") {
      throw new Error(`${source}: entry ${index} has no string findingId — malformed golden file`);
    }
    return findingId;
  });
}

/** Merge two counts (violation + clean + optional noise trees of one analyzer). */
export function addCounts(a: NoiseCounts, b: NoiseCounts): NoiseCounts {
  return {
    falsePositives: a.falsePositives + b.falsePositives,
    denominator: a.denominator + b.denominator,
  };
}

/** Rational `fp/den > baseFp/baseDen`, with a 0 denominator meaning rate 0. */
function exceedsBaseline(current: NoiseCounts, baseline: NoiseCounts): boolean {
  if (current.denominator === 0) return false; // rate 0 never exceeds anything
  if (baseline.denominator === 0) return current.falsePositives > 0; // baseline rate is 0
  return (
    current.falsePositives * baseline.denominator >
    baseline.falsePositives * current.denominator
  );
}

export interface GateResult {
  pass: boolean;
  failures: string[];
}

/**
 * Validate-before-trust: a malformed baseline entry (string counts, missing
 * key, a stored rate) turns the rational comparisons into NaN arithmetic, and
 * `NaN > x === false` would silently pass any noise rise.
 */
function isValidCounts(value: unknown): value is NoiseCounts {
  if (typeof value !== "object" || value === null) return false;
  const { falsePositives, denominator } = value as Partial<NoiseCounts>;
  return (
    Number.isInteger(falsePositives) &&
    Number.isInteger(denominator) &&
    (falsePositives as number) >= 0 &&
    (denominator as number) >= 0 &&
    (falsePositives as number) <= (denominator as number)
  );
}

/**
 * The gate: fails at ≥30% overall (the product claim is strictly <30%), fails
 * any analyzer whose rate rises above its committed baseline (named), and
 * fails any analyzer with no baseline entry — never silently skipped.
 * A zero denominator is rate 0 and passes; no 0/0 division ever happens.
 */
export function checkGates(
  results: Record<string, NoiseCounts>,
  baseline: Record<string, unknown>,
): GateResult {
  const failures: string[] = [];

  let totalFp = 0;
  let totalDen = 0;
  for (const counts of Object.values(results)) {
    totalFp += counts.falsePositives;
    totalDen += counts.denominator;
  }
  // ≥30% ⇔ fp·10 ≥ den·3 — integers only, and 0/0 can never trip it.
  if (totalDen > 0 && totalFp * 10 >= totalDen * 3) {
    failures.push(
      `overall noise rate ${renderRate(totalFp, totalDen)} (${totalFp}/${totalDen}) is ≥30% — the product claim is strictly <30%`,
    );
  }

  for (const [analyzer, counts] of Object.entries(results)) {
    const committed = baseline[analyzer];
    if (committed === undefined) {
      failures.push(
        `analyzer "${analyzer}" has no baseline entry in tests/__fixtures__/noise-baseline.json — record a baseline entry {falsePositives, denominator} from a sweep run`,
      );
      continue;
    }
    if (!isValidCounts(committed)) {
      failures.push(
        `baseline entry for "${analyzer}" is malformed — expected integer {falsePositives, denominator} with falsePositives <= denominator, got ${JSON.stringify(committed)}`,
      );
      continue;
    }
    if (exceedsBaseline(counts, committed)) {
      failures.push(
        `analyzer "${analyzer}" noise rate ${renderRate(counts.falsePositives, counts.denominator)} (${counts.falsePositives}/${counts.denominator}) rose above its committed baseline (${committed.falsePositives}/${committed.denominator}) — noise must be non-increasing`,
      );
    }
  }

  // Symmetric with the missing-entry check: a stale baseline key (renamed or
  // removed analyzer) must not linger unmeasured.
  for (const key of Object.keys(baseline)) {
    if (!(key in results)) {
      failures.push(`baseline entry "${key}" has no sweep result — remove or fix the entry`);
    }
  }

  return { pass: failures.length === 0, failures };
}

/** Display only — never used in a gate decision. */
function renderRate(fp: number, den: number): string {
  if (den === 0) return "0% (no error/warning emissions)";
  return `${((fp * 100) / den).toFixed(1)}%`;
}

/** Per-analyzer FP / denominator / rate table, printed on every run, pass or fail. */
export function formatTable(results: Record<string, NoiseCounts>): string {
  const rows: string[][] = [["analyzer", "FP", "denominator", "rate"]];
  let totalFp = 0;
  let totalDen = 0;
  for (const [analyzer, { falsePositives, denominator }] of Object.entries(results)) {
    totalFp += falsePositives;
    totalDen += denominator;
    rows.push([
      analyzer,
      String(falsePositives),
      String(denominator),
      renderRate(falsePositives, denominator),
    ]);
  }
  rows.push(["overall", String(totalFp), String(totalDen), renderRate(totalFp, totalDen)]);
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)));
  return rows
    .map((row) => row.map((cell, col) => cell.padEnd(widths[col]!)).join("  ").trimEnd())
    .join("\n");
}
