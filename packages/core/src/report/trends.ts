/**
 * Trend aggregation (Story 1.16, FR-15): given the committed trend store and
 * the run that just finished, find the previous run to compare against and
 * produce the per-axiom delta.
 *
 * THE DELTA IS REPORT-ONLY. FR-15's PRD wording says the delta is reported
 * "in the review artifact", but the artifact is asserted byte-identical for
 * identical inputs at three test sites and a delta depends on prior history —
 * the same inputs would produce different bytes on a second run. So the delta
 * is rendered in the REPORT and never written to the artifact; the raw counts
 * and the score, being pure functions of the run's own inputs, do go in it.
 *
 * ORDERING IS ANCESTRY, NOT A BRANCH NAME. The AC's primary rule is "the
 * previous run of the same scope type on the same branch", with nearest
 * ancestor as the fallback. Branch names are renamed, deleted and reused, and
 * the record deliberately carries no branch field, so the two rules are
 * collapsed into the one that is actually sound: **the previous record of the
 * same `scopeKind` whose `commitSha` is the nearest ancestor of HEAD**.
 *
 * THE ORDER IS PARTIAL, AND SAYS SO. Two `uncommitted`-scope runs share one
 * `commitSha` (both are `headSha()`), and two ancestors of a merge commit can
 * be ancestors of HEAD without being ancestors of EACH OTHER. Neither case
 * gets a silent arbitrary pick: `recordId` is the declared tiebreak and the
 * limitation is stated in the declarations.
 *
 * THE TIEBREAK IS NOT FORGEABLE. `trends.jsonl` is committed and
 * `merge=union`'d in from other clones, so "highest `recordId` wins" would
 * otherwise hand the delta baseline to whoever hand-writes a line with an id
 * of `ffff…`. `trendRecordSchema` verifies that `recordId` IS the content
 * address of the record, so the id is a fact about the content rather than a
 * claim: a tampered record is skipped and declared like any other invalid
 * line, and choosing a winning id means finding a sha256 preimage.
 */
import {
  trendRecordSchema,
  type ScopeKind,
  type SeverityCounts,
  type TrendRecord,
} from "@agentic-guardrails/contracts";

import { commitExists, isAncestor } from "../git/git.js";
import { readJsonl } from "../persistence/history.js";

/** One axiom's movement since the previous comparable run. */
export interface AxiomDelta {
  axiom: string;
  error: number;
  warning: number;
  info: number;
}

export interface TrendAggregation {
  /** The record the delta is measured against; absent on a cold start. */
  previous?: TrendRecord;
  /** Per-axiom movement (current − previous), axiom-sorted. Empty when there
   * is no previous record. */
  deltas: AxiomDelta[];
  /** true → no delta was produced. A first run is a cold start too; check
   * `declarations` for whether it was for a REASON worth telling the user. */
  coldStart: boolean;
  /** Everything skipped, repaired, missing or ambiguous — printed by the
   * caller. Empty on a clean first run: a missing history file is a normal
   * first run, not a degradation. */
  declarations: string[];
}

/**
 * How many of the newest records the ancestry scan considers.
 *
 * ponytail: history is unbounded by design (that growth IS the longitudinal
 * feature) and each candidate costs a `merge-base --is-ancestor` spawn, so
 * the scan is capped at the newest slice of the file. Raise it, or replace
 * the pairwise scan with one `rev-list` walk, if a repo ever accumulates
 * enough same-scope records for the cap to hide the true nearest ancestor —
 * the cap is declared when it bites so that is visible rather than guessed.
 */
export const ANCESTRY_SCAN_LIMIT = 200;

/**
 * Cold-start threshold: when MORE than this fraction of the store's lines are
 * unusable, the store as a whole is not trustworthy and the aggregator reports
 * NO delta rather than one computed from whatever happened to survive — a
 * wrong delta is worse than none. A single corrupt line among healthy ones is
 * skipped and declared, not treated as a corrupt store.
 */
const UNTRUSTWORTHY_SKIP_RATIO = 0.5;

export interface AggregateTrendsOptions {
  /** The invoking repository — where the refs the ancestry query walks live. */
  repoRoot: string;
  /** Absolute path of `history/trends.jsonl`. */
  storePath: string;
  /** The commit the CURRENT run reviewed; ancestry is measured against it. */
  headSha: string;
  /** Only records of this kind are comparable. */
  scopeKind: ScopeKind;
  /** This run's counts — the left-hand side of the delta. */
  current: Readonly<Record<string, SeverityCounts>>;
  /** This run's own `recordId`, excluded from the candidates so a re-run
   * never compares against itself. */
  currentRecordId: string;
  /** Test seam for the ancestry query. */
  ancestry?: typeof isAncestor;
  /** Test seam for the commit-presence probe. */
  exists?: typeof commitExists;
}

export function aggregateTrends(options: AggregateTrendsOptions): TrendAggregation {
  const declarations: string[] = [];
  const cold = (): TrendAggregation => ({ deltas: [], coldStart: true, declarations });

  const read = readJsonl(options.storePath, trendRecordSchema);
  if (!read.ok) {
    // An unreadable store is not an empty one — say so and cold-start.
    declarations.push(`trend history unreadable: ${read.reason} — no delta this run`);
    return cold();
  }
  declarations.push(...read.value.declarations);
  const { records, lines, skipped } = read.value;
  if (lines === 0) return { deltas: [], coldStart: true, declarations }; // first run

  // `skipped`, not `lines - records.length`: a `merge=union`'d duplicate is
  // deduped out of `records` while being a perfectly healthy line, and
  // counting it as unusable would cold-start a healthy store.
  if (skipped > lines * UNTRUSTWORTHY_SKIP_RATIO) {
    declarations.push(
      `trend history is not trustworthy (${skipped}/${lines} lines unusable) — cold start, no delta`,
    );
    return cold();
  }

  const comparable = records.filter(
    (record) =>
      record.scopeKind === options.scopeKind && record.recordId !== options.currentRecordId,
  );
  const candidates = comparable.slice(-ANCESTRY_SCAN_LIMIT);
  if (candidates.length === 0) return { deltas: [], coldStart: true, declarations };
  // Compared POST-filter: comparing against the raw same-scope count includes
  // this run's own record, so `N > N-1` declared the cap on an ordinary
  // two-record re-run. A cap that cries wolf is a cap nobody reads.
  if (comparable.length > candidates.length) {
    declarations.push(
      `trend history scan capped at the newest ${ANCESTRY_SCAN_LIMIT} ${options.scopeKind} records`,
    );
  }

  const exists = options.exists ?? commitExists;
  const isAncestorOf = options.ancestry ?? isAncestor;

  // Only records whose commit is still IN the repo AND is an ancestor of what
  // this run reviewed can be compared: a rebased-away or gc'd sha is skipped
  // and declared, never fatal and never silently dropped.
  const ancestors: TrendRecord[] = [];
  const missing: string[] = [];
  for (const record of candidates) {
    if (!exists(options.repoRoot, record.commitSha)) {
      missing.push(record.commitSha);
      continue;
    }
    // Same sha as HEAD (two `uncommitted` runs at one commit) counts: a commit
    // is its own ancestor, which is exactly the comparison we want there.
    const answer = isAncestorOf(options.repoRoot, record.commitSha, options.headSha);
    if (!answer.ok) {
      declarations.push(
        `trend record for ${short(record.commitSha)}: ancestry query failed (${answer.reason}) — skipped`,
      );
      continue;
    }
    if (answer.value) ancestors.push(record);
  }
  if (missing.length > 0) {
    declarations.push(
      `${missing.length} trend record(s) name a commit no longer in this repository ` +
        `(${[...new Set(missing)].slice(0, 3).map(short).join(", ")}${missing.length > 3 ? ", …" : ""}) — skipped`,
    );
  }
  if (ancestors.length === 0) return { deltas: [], coldStart: true, declarations };

  const previous = nearestAncestor(options, ancestors, declarations);
  return {
    previous,
    deltas: computeDeltas(options.current, previous.axiomSeverityCounts),
    coldStart: false,
    declarations,
  };
}

/**
 * The NEAREST ancestor: the candidate no other candidate descends from.
 * Reduces pairwise — a later commit replaces an earlier one — and falls back
 * to the DECLARED `recordId` tiebreak in the two cases ancestry cannot decide:
 * an identical `commitSha` (two working-tree states at one commit) and two
 * genuinely incomparable ancestors (both parents of a merge).
 */
function nearestAncestor(
  options: AggregateTrendsOptions,
  ancestors: readonly TrendRecord[],
  declarations: string[],
): TrendRecord {
  const isAncestorOf = options.ancestry ?? isAncestor;
  let best = ancestors[0] as TrendRecord;
  let ambiguous = false;
  for (const candidate of ancestors.slice(1)) {
    if (candidate.commitSha === best.commitSha) {
      // Ancestry cannot separate them; the content-addressed id can, stably.
      ambiguous = true;
      if (candidate.recordId > best.recordId) best = candidate;
      continue;
    }
    const bestBeforeCandidate = isAncestorOf(
      options.repoRoot,
      best.commitSha,
      candidate.commitSha,
    );
    if (bestBeforeCandidate.ok && bestBeforeCandidate.value) {
      best = candidate; // candidate is strictly later on the same line
      continue;
    }
    const candidateBeforeBest = isAncestorOf(
      options.repoRoot,
      candidate.commitSha,
      best.commitSha,
    );
    if (candidateBeforeBest.ok && candidateBeforeBest.value) continue; // best wins
    // Incomparable (two branches merged into HEAD) or the query failed: pick
    // deterministically and SAY the order was not total.
    ambiguous = true;
    if (candidate.recordId > best.recordId) best = candidate;
  }
  if (ambiguous) {
    declarations.push(
      `two or more trend records were not ordered by ancestry (same commit, or both merged into HEAD) — ` +
        `compared against recordId ${short(best.recordId)} by the declared recordId tiebreak`,
    );
  }
  return best;
}

/** Current − previous, per axiom, over the UNION of both sides' axioms: an
 * axiom that stopped producing findings has a delta too, and it is the
 * interesting one. */
function computeDeltas(
  current: Readonly<Record<string, SeverityCounts>>,
  previous: Readonly<Record<string, SeverityCounts>>,
): AxiomDelta[] {
  const zero: SeverityCounts = { error: 0, warning: 0, info: 0 };
  return [...new Set([...Object.keys(current), ...Object.keys(previous)])]
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((axiom) => {
      const now = current[axiom] ?? zero;
      const then = previous[axiom] ?? zero;
      return {
        axiom,
        error: now.error - then.error,
        warning: now.warning - then.warning,
        info: now.info - then.info,
      };
    })
    .filter((delta) => delta.error !== 0 || delta.warning !== 0 || delta.info !== 0);
}

function short(sha: string): string {
  return sha.slice(0, 12);
}
