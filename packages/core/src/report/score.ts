/**
 * OD-1 scoring (Story 1.16, FR-14). The artifact records RAW per-axiom
 * severity counts and the measured change size; the score is a DERIVED view
 * over them, stamped with the formula version that produced it. That is the
 * whole point of FR-14: a formula change re-derives every historical score
 * instead of poisoning the record with numbers nobody can reproduce.
 *
 * DETERMINISM. The score has to serialize identically on every platform, so
 * the entire path is integer arithmetic: counts are integers, the denominator
 * is an integer (thousandths of a KLOC, which is exactly lines-of-change),
 * and the result is an integer number of TENTHS of a point. No raw IEEE
 * double is ever handed to `JSON.stringify`; the one division is followed
 * immediately by `Math.round`, and the decimal point is put back by string
 * construction at render time, not by float division.
 */
import type { ScopeKind, SeverityCounts } from "@agentic-guardrails/contracts";

/**
 * The formula version stamped wherever a score is rendered or persisted:
 * `100 − (10·E + 3·W + 1·I) / changedKloc`, floored at 0.
 *
 * The `changedKloc` FLOOR of 0.1 (so a one-line or deletion-only diff stays
 * finite instead of dividing by a hair) is the edge rule epics.md:705 marks
 * "confirm with the OD-1 owner at story time". It shipped as proposed and
 * UNCONFIRMED — this version stamp is the mechanism by which it can change
 * without invalidating anything already recorded.
 */
export const OD1_FORMULA_VERSION = "od-1-v1";

/** Per-severity weights of the OD-1 numerator. */
export const OD1_WEIGHTS = { error: 10, warning: 3, info: 1 } as const;

/** The 0.1-KLOC denominator floor, in the integer unit the whole path uses
 * (thousandths of a KLOC === lines). */
export const KLOC_FLOOR_MILLI = 100;

/** Highest score, in tenths — a clean run. */
export const MAX_SCORE_TENTHS = 1000;

/**
 * The OD-1 denominator: changed lines with the 0.1-KLOC floor applied.
 * Thousandths of a KLOC ARE lines, so the conversion is the floor and
 * nothing else — there is no arithmetic here to be non-deterministic about.
 */
export function changedKlocMilliOf(changedLines: number): number {
  return Math.max(KLOC_FLOOR_MILLI, changedLines);
}

/**
 * OD-1 v1, in tenths of a point.
 *
 * `score = 100 − N/kloc` where `N = 10E + 3W + I` and `kloc = milli/1000`, so
 * `scoreTenths = 1000 − round(N · 10000 / milli)`, clamped to `[0, 1000]`.
 * One division, one round, integers on both sides of it.
 *
 * The floor is applied HERE, not only at the call site. The denominator can
 * arrive from a committed, hand-editable, `merge=union`'d trend record whose
 * schema permits 0, and a 0 there yields `Infinity` (rendered as a confident
 * `0.0`) or `NaN` (serialized as `null`, rendered as the same `—` that means
 * "this scope has no score"). The matrix says "never divide by zero"; this is
 * the only place that can guarantee it for every caller.
 */
export function od1ScoreTenths(
  axiomSeverityCounts: Readonly<Record<string, SeverityCounts>>,
  changedKlocMilli: number,
): number {
  const denominator = changedKlocMilliOf(changedKlocMilli);
  let numerator = 0;
  for (const counts of Object.values(axiomSeverityCounts)) {
    numerator +=
      OD1_WEIGHTS.error * counts.error +
      OD1_WEIGHTS.warning * counts.warning +
      OD1_WEIGHTS.info * counts.info;
  }
  const penaltyTenths = Math.round((numerator * 10_000) / denominator);
  // Floor at 0: an overwhelming finding count is "as bad as it gets", never a
  // negative number nobody can interpret.
  return Math.min(MAX_SCORE_TENTHS, Math.max(0, MAX_SCORE_TENTHS - penaltyTenths));
}

/**
 * Why a scope has no score. `--project` is not a diff, so it has no
 * changed-KLOC by construction: there is no denominator to normalize by, and
 * inventing one (the whole tracked tree? one?) would make the number mean
 * something different from every other score in the store. Recorded as an
 * omission with its reason rather than a fabricated 0 or 100.
 */
export const PROJECT_SCORE_OMITTED =
  "--project is not a diff, so it has no changed-KLOC denominator — counts are recorded, the score is not";

/** True when this scope can be scored at all. */
export function scopeIsScorable(scopeKind: ScopeKind): boolean {
  return scopeKind !== "project";
}

/** Renders tenths as a fixed-one-decimal string by STRING construction —
 * `tenths / 10` would put a float back into a path that spent its whole life
 * avoiding one. */
export function formatScoreTenths(tenths: number): string {
  return `${Math.trunc(tenths / 10)}.${tenths % 10}`;
}
