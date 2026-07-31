/**
 * The static review pipeline (Story 1.4 skeleton, hardened in 1.7). The
 * six-phase shape is FIXED; membership within phases varies by
 * scope/mode/config and is declared in the manifest:
 *
 *   0 preflight     — git repo detection + change-set discovery + tsconfig
 *                     discovery (solution-style roots expand to their
 *                     referenced projects)
 *   1 deterministic — registered analyzers via p-map, per-axiom isolation,
 *                     content-addressed cache (graph + findings), wall-clock
 *                     budget degrading to partials via AbortSignal
 *   2 SDD gate      — declared, empty membership until Epic 2
 *   3 LLM enrich    — declared, empty membership until Epic 3
 *   4 aggregation   — FR-21 merge, then deterministic sort
 *   5 composition   — artifact + embedded RunManifest, byte-stable JSON,
 *                     schema-validated BEFORE any write
 *
 * No DAG library: the phase order is a fixed sequence, per-axiom isolation
 * is a try/catch around each analyzer.
 *
 * The RunManifest is EMBEDDED in the artifact under the `manifest` key —
 * one atomic write covers both (no artifact/manifest torn-pair window).
 *
 * BYTE-DETERMINISM CARVE-OUT: a cache hit serves the identical DATA a cold
 * run computes, so cold and warm artifacts are byte-identical EXCEPT for
 * `manifest.cache` — the hit/miss counters are runtime truth and differ by
 * design (zero silent cache behavior). Byte-identity tests therefore
 * normalize `manifest.cache` out before comparing; nothing else may differ.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  conventionsFileSchema,
  corpusMapFileSchema,
  degradationSchema,
  findingSchema,
  makeTrendRecord,
  reviewArtifactSchema,
  trendRecordSchema,
  type Boundaries,
  type Degradation,
  type DispositionPolicy,
  type Finding,
  type PrMetadata,
  type ReviewArtifact,
  type ReviewScores,
  type RunManifest,
  type SeverityCounts,
  type TrendRecord,
} from "@agentic-guardrails/contracts";
import pMap from "p-map";
import { ts } from "ts-morph";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import {
  importGraphDataSchema,
  unresolvedImportSchema,
  type ImportGraphBuildResult,
} from "../adapter/language-adapter.js";
import { axiom1Structural } from "../analyzers/axiom1-structural.js";
import { axiom3Cleanliness } from "../analyzers/axiom3-cleanliness.js";
import { axiom4Nfr } from "../analyzers/axiom4-nfr.js";
import { axiom5Security } from "../analyzers/axiom5-security.js";
import { axiom6Conformance } from "../analyzers/axiom6-conformance.js";
import type { ChangedFilesCache, ChangedFilesParse } from "../analyzers/changed-files.js";
import { DeterministicCache, loadCacheSecret } from "../cache/deterministic-cache.js";
import {
  EFFECTIVE_DEFAULTS,
  evaluateGate,
  loadConfig,
  type GateResult,
  type LoadConfigResult,
} from "../config/config-loader.js";
import { EMPTY_TREE_SHA, fileGitStatus, headSha, repoRoot, revParse } from "../git/git.js";
import {
  fsPath,
  toManifestDegradation,
  withWorktree,
  worktreeDegradationsOf,
} from "../git/worktree.js";
import { ImportGraph } from "../graph/import-graph.js";
import { checkGitWiring } from "../init/wiring.js";
import {
  readStructuralSeedFile,
  type StructuralSeedRead,
} from "../knowledge/structural-seed.js";
import { appendJsonl, TRENDS_PATH } from "../persistence/history.js";
import {
  changedKlocMilliOf,
  od1ScoreTenths,
  OD1_FORMULA_VERSION,
  PROJECT_SCORE_OMITTED,
  scopeIsScorable,
} from "../report/score.js";
import { aggregateTrends, type TrendAggregation } from "../report/trends.js";
import { ghPrMetadata, type GhRunner } from "./gh-metadata.js";
import {
  ABSENT_SHA256,
  buildRunManifest,
  ENGINE_VERSION,
  numericCompare,
  RULESET_VERSION,
} from "./manifest.js";
import { mergeFindings } from "./merge.js";
import {
  changeSetFor,
  changeSizeFor,
  resolveScope,
  type ResolvedScope,
  type ScopeChangeSize,
  type ScopeRequest,
} from "./scope.js";

export type { ReviewArtifact } from "@agentic-guardrails/contracts";

/**
 * Phase-1 wall-clock budget (ms). SPIKE-3
 * (docs/spikes/SPIKE-3-import-graph-cost.md) measured the 1k-file full
 * pipeline at ~0.95s median, so 30s gives ~30x headroom while still
 * bounding runaway repos. Phases other than 1 are synchronous single steps
 * today; per-phase budgets arrive when phases 2/3 gain async membership
 * (Epic 2/3).
 * ponytail: hardcoded constant — config exposure is later scope.
 */
export const PHASE1_BUDGET_MS = 30_000;

/** Cached per-axiom analyzer result — revalidated through the contracts
 * finding schema on every read (schema drift → typed miss). */
const cachedAnalyzerResultSchema = z.strictObject({
  findings: z.array(findingSchema),
  degraded: z.array(degradationSchema),
  declaredOnly: z.array(degradationSchema).optional(),
});

/** Cached serialized import-graph build result (per tsconfig). */
const cachedGraphSchema = z.strictObject({
  data: importGraphDataSchema,
  coverage: z.number().min(0).max(1),
  attempted: z.int().min(0),
  unresolved: z.int().min(0),
  unresolvedImports: z.array(unresolvedImportSchema),
  degraded: z.array(degradationSchema),
});

/** Content-addressed graph cache seam (1.7): graph-building analyzers route
 * builds through this so unchanged inputs skip the parse entirely (SPIKE-3's
 * recorded reuse win). `acquire` checks the run-local memo, then the
 * persistent cache, then calls `build` — check + build + store in ONE
 * synchronous frame (no await anywhere inside), which is what makes the
 * one-parse-per-tsconfig-per-run invariant robust: two analyzers can never
 * race past the same miss, even if their `run` bodies await between
 * acquisitions. */
export interface GraphCache {
  acquire(tsconfigPath: string, build: () => ImportGraphBuildResult): ImportGraphBuildResult;
}

export interface AnalyzerContext {
  /** Absolute repo root (as git reports it). */
  repoRoot: string;
  /** Changed analyzable TS files (present on disk), repo-root-relative,
   * `/`-separated, sorted. */
  changedFiles: readonly string[];
  /** ALL changed files present on disk (the raw pre-TS-filter list: .env,
   * .json, .yaml, .md, Dockerfiles, declarations …) — the axiom-5 secret
   * scan iterates this so a leaked credential in ANY changed file is seen.
   * Optional for bare unit-test contexts; absent → falls back to
   * `changedFiles`. */
  allChangedFiles?: readonly string[];
  /** Leaf tsconfigs to analyze: the root tsconfig itself, or — for a
   * solution-style root — each referenced project's tsconfig. */
  tsconfigPaths: readonly string[];
  /** The loaded `boundaries` declaration (config plane, 1.9) — absent when
   * the config declares none; the declaration-dependent structural rules
   * then emit nothing. Analyzers never read config files themselves. */
  boundaries?: Boundaries;
  /** Optional (absent in bare unit-test contexts): the content-addressed
   * graph cache the pipeline wires in. */
  graphCache?: GraphCache;
  /** Optional (absent in bare unit-test contexts): the run-local shared
   * changed-files parse seam — axiom 3 + axiom 4 consume ONE parse per run
   * (same synchronous-memo discipline as GraphCache.acquire). */
  changedFilesCache?: ChangedFilesCache;
  /** The phase-1 budget's abort signal, so analyzers CAN observe
   * cancellation. Honest caveat: current analyzers are synchronous and only
   * check between units — an in-flight unit runs to completion. */
  signal?: AbortSignal;
  /** Optional (absent in bare unit-test contexts): the ONE read of the
   * structural corpus seed's bytes (1.8/1.13). Read once in preflight and
   * hashed into axiom 6's cache key from the SAME buffer, so a concurrent
   * `guardrails init` cannot slip a new corpus between key computation and
   * analysis. Absent from the context → the analyzer reads the file itself. */
  corpusSeed?: StructuralSeedRead;
}

export interface AnalyzerResult {
  findings: Finding[];
  degraded: Degradation[];
  /** Degradations this analyzer DECLARES as exit-neutral: real information
   * for the artifact, but not evidence that this run lost coverage — the
   * "absent until init" class (1.8's ledger sentinels, 1.13's absent corpus
   * seed). The pipeline never inspects reasons to decide this; the analyzer
   * that produced the degradation says so. Everything in `degraded` counts
   * toward `runDegraded` and exit 2, without exception. */
  declaredOnly?: Degradation[];
}

/** One registered deterministic analyzer. Plain array registry — no plugin
 * machinery; 1.9+ appends entries. `run` is async so the p-map concurrency
 * bound actually bounds concurrent work. */
export interface Analyzer {
  axiom: string;
  run(context: AnalyzerContext): Promise<AnalyzerResult>;
}

export const DEFAULT_ANALYZERS: readonly Analyzer[] = [
  axiom1Structural,
  axiom3Cleanliness,
  axiom4Nfr,
  axiom5Security,
  axiom6Conformance,
];

/** Axiom ids the pipeline treats as known BEYOND the registered analyzers.
 * Empty since 1.12 (axiom 5's analyzer landed) — kept as the seam for any
 * future axiom that becomes configurable before its analyzer exists.
 * Single source for the unknown-axiom warning and the init questionnaire. */
export const ANALYZERLESS_KNOWN_AXIOMS: readonly string[] = [];

/** Two analyzers registered for one axiom would silently clobber each other
 * in the per-axiom result map — a caller bug, rejected loudly and typed. */
export class DuplicateAnalyzerError extends Error {
  constructor(axiom: string) {
    super(`duplicate analyzer registration for axiom ${JSON.stringify(axiom)}`);
    this.name = "DuplicateAnalyzerError";
  }
}

/** A change set git could not produce. Thrown rather than returned because the
 * change-set read happens inside the worktree callback (which has no result
 * channel); `runReview` converts it back into the typed preflight failure it
 * has always been, so the worktree still gets removed on the way out. */
class ChangeSetError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ChangeSetError";
  }
}

export type ReviewRunResult =
  | { ok: false; code: "preflight" | "config" | "invalid-artifact"; message: string }
  | {
      ok: true;
      repoRoot: string;
      artifact: ReviewArtifact;
      /** Canonical bytes: 2-space JSON, fixed key order, one trailing newline. */
      artifactJson: string;
      /** Degradations from THIS run's execution (analyzer crashes, coverage
       * gaps) — excludes the "absent until init" declarations (the 1.8
       * ledger/corpus sentinels and whatever an analyzer returns in
       * `AnalyzerResult.declaredOnly`), so an un-inited repo does not flag
       * every run as degraded. Those stay declared in `artifact.degraded`. */
      runDegraded: Degradation[];
      /** The exit-neutral declarations analyzers made this run (sorted). The
       * CLI PRINTS these: an axiom that declined to run is inconclusive, and
       * an inconclusive run must never look byte-identical to a clean one. */
      declaredOnly: Degradation[];
      degradedRun: boolean;
      /** Exit-code gate over findings + config (blocking/advisory/off + maxFindings). */
      gate: GateResult;
      /** false → no config.yaml, defaults applied. */
      configPresent: boolean;
      /** Formatted config deviations from defaults, for CLI run-start logging. */
      deviations: string[];
      /** Non-fatal config-plane warnings (schema-file write failure, config
       * entries matching no known axiom) — stderr lines, never exit-code 2. */
      configWarnings: string[];
      /** Preflight git-wiring warnings (1.8): missing `.gitattributes`/
       * `.gitignore` lines in an initialized repo — their own channel so
       * the CLI does not misattribute them to the config plane. */
      wiringWarnings: string[];
      /** FR-15's per-axiom delta against the previous comparable run (1.16).
       * REPORT-ONLY: it depends on prior history, so writing it into the
       * artifact would break the byte-identity invariant three tests assert. */
      trend: TrendAggregation;
      /** What happened to this run's trend append — never fatal, always
       * declared (a history plane that silently stops recording is worse
       * than one that says it could not). */
      trendWrite: TrendWriteOutcome;
      /** Config-plane retention limit for `reviews/<scope>/`, so the CLI's
       * artifact write can prune without re-reading config. */
      artifactRetention: number;
      /** Configured non-interactive DR-1 disposition policy. */
      dispositionPolicy: DispositionPolicy;
    };

/** What the trend append did. `skipped` is the idempotent re-run: this exact
 * record is already in history, which is a SUCCESS. */
export type TrendWriteOutcome =
  | { state: "appended" | "skipped"; repaired: boolean }
  | { state: "failed"; reason: string };

export interface RunReviewOptions {
  cwd: string;
  /** What to review (1.15). Absent → the uncommitted working tree: bare
   * `guardrails review` behaves exactly as it did before scopes existed. */
  scope?: ScopeRequest;
  /** Test seam; defaults to the registered deterministic analyzers. */
  analyzers?: readonly Analyzer[];
  /** Test seam; defaults to PHASE1_BUDGET_MS. */
  phase1BudgetMs?: number;
  /** Test seam; defaults to `~/.agentic-guardrails/cache-secret`. */
  cacheSecretPath?: string;
  /** Test seam; preferred worktree base ROOT (1.14 `WorktreeBaseOptions`). */
  worktreeBaseDir?: string;
  /** Test seam; the `gh` invocation. Defaults to spawning the real `gh` — a
   * test injects a stub so no test run can reach a network. */
  gh?: GhRunner;
}

type LoadedConfig = Extract<LoadConfigResult, { ok: true }>;

/**
 * The ANALYZE/WRITE split (1.15) — the structural centre of scoped review.
 * `analyzeRoot` is where the reviewed content lives (a temporary worktree for
 * a ref that is not HEAD); `outputRoot` is ALWAYS the invoking repository:
 * config, cache, corpus seed, git wiring and the artifact. A worktree is
 * deleted, so anything written inside it is gone — the split enforces that
 * structurally rather than by convention.
 *
 * Hard invariant: no absolute path from `analyzeRoot` may enter a cache key, a
 * runId, an artifact field or a finding location. A temp worktree path is
 * nondeterministic; a single leak would kill warm-cache reuse and artifact
 * byte-identity silently. Everything hashed or emitted is `analyzeRoot`-
 * relative and POSIX-normalized.
 */
interface AnalysisInputs {
  analyzeRoot: string;
  outputRoot: string;
  scope: ResolvedScope;
  loaded: LoadedConfig;
  options: RunReviewOptions;
  /** The `gh` metadata outcome (metadata or the reason it is missing) — an
   * artifact input that is not derived from the reviewed content, so it has to
   * reach the runId. Undefined for every non-PR scope. */
  ghIdentity?: unknown;
}

/**
 * Everything ONE analysis pass produces. Composition (artifact + manifest +
 * schema validation) happens OUTSIDE this and therefore outside any worktree,
 * because a worktree's removal degradation is only known after the callback
 * returns — composing inside would mean a leak that can never reach the
 * artifact it belongs in.
 */
interface AnalysisOutcome {
  changedFiles: string[];
  deletedFiles: string[];
  findings: Finding[];
  runDegraded: Degradation[];
  declaredOnly: Degradation[];
  cache: NonNullable<RunManifest["cache"]>;
  /** The OD-1 denominator's measurement (1.16) — from the SAME range the
   * change set came from, so numerator and denominator describe one change. */
  changeSize: ScopeChangeSize;
  corpusSeedHash?: string;
  ledgerHash?: string;
  corpusHash?: string;
  runId: string;
  /** Phase-1 membership truth for the declared assembly. */
  phase1: { members: string[]; ran: boolean; reason?: string };
  /** Axioms that actually ran (gate input) and those configured `off`. */
  enabledAxioms: string[];
  axiomsOff: string[];
  /** Every REGISTERED axiom, `off` included — the unknown-axiom warning
   * compares against registration, not enablement. */
  registeredAxioms: string[];
}

export async function runReview(options: RunReviewOptions): Promise<ReviewRunResult> {
  // ---- Phase 0: preflight -------------------------------------------------
  // The invoking repository is the OUTPUT root, always.
  const root = repoRoot(options.cwd);
  if (!root.ok) {
    const message =
      root.kind === "git-not-found"
        ? "git executable not found — install git or add it to PATH"
        : root.kind === "not-a-repo"
          ? "not a git repository"
          : root.reason;
    return { ok: false, code: "preflight", message };
  }
  const outputRoot = root.value;

  // Scope resolution (1.15) runs against the INVOKING repo's refs — local
  // only, no network. An unresolvable scope (missing PR ref, no default base,
  // hostile ref) is a typed preflight failure before any worktree is created.
  const resolved = resolveScope(outputRoot, options.scope ?? { kind: "uncommitted" });
  if (!resolved.ok) return { ok: false, code: "preflight", message: resolved.reason };
  const scope = resolved.scope;

  // Config plane (1.6): the ONLY config read in the pipeline. An invalid
  // config is a typed failure (exit 2 at the CLI) — never a silent fallback.
  const loaded = loadConfig(outputRoot);
  if (!loaded.ok) return { ok: false, code: "config", message: loaded.message };
  const config = loaded.config;

  // Preflight git-wiring check (1.8): warnings naming the consequence when
  // an initialized repo lost its `.gitattributes`/`.gitignore` lines —
  // never exit 2, and silent for an uninitialized repo (no folder).
  const wiringWarnings = checkGitWiring(outputRoot);

  // Exit-NEUTRAL declarations from the scope plane: a guessed diff base and
  // absent `gh` metadata describe this run's FRAMING, not lost analysis
  // coverage — "gh is never a gate", so neither may drive exit 2.
  const scopeDeclared: Degradation[] = [...scope.degradations];
  let prMetadata: PrMetadata | undefined;
  // The `gh` OUTCOME is part of this run's identity (see computeRunId): the
  // metadata lands in the artifact but is not derived from the reviewed
  // content, so without it the same PR ref with and without `gh` — or after a
  // PR title edit on GitHub — would produce the same runId and OVERWRITE the
  // artifact with different bytes. Undefined for every non-PR scope, which
  // keeps their runIds exactly as they were.
  let ghIdentity: unknown;
  if (scope.prId !== undefined) {
    const metadata = ghPrMetadata(outputRoot, scope.prId, options.gh);
    if (metadata.ok) prMetadata = metadata.metadata;
    else scopeDeclared.push(metadata.degradation);
    ghIdentity = metadata.ok ? metadata.metadata : { unavailable: metadata.degradation.reason };
  }

  // A worktree is created ONLY when the reviewed ref is not the current HEAD.
  // Checking out a ref that already IS HEAD would silently drop the user's
  // uncommitted state: "isolated execution" means isolated from a ref
  // checkout, not isolation for its own sake.
  const worktreeRef =
    scope.ref !== undefined && !isCurrentHead(outputRoot, scope.ref) ? scope.ref : undefined;

  // IN-PLACE DIVERGENCE (declared, never silent). A ref scope analyzed in
  // place — `--branch <current>`, `--project` — takes its CHANGE SET from
  // commits but reads CONTENT from the user's working tree, which is the
  // right call (reviewing HEAD inside a worktree would silently drop their
  // uncommitted state) but means the analyzed bytes are not the ref the
  // manifest records. An uncommitted edit can add a finding the ref does not
  // have, and a reverted one can move a file into `deletedFiles`. Both are
  // legitimate; being unable to tell from the artifact is not.
  if (scope.kind !== "uncommitted" && worktreeRef === undefined) {
    const dirty = changeSetFor(
      { kind: "uncommitted", slug: "uncommitted", degradations: [] },
      outputRoot,
      config.exclude ?? [],
    );
    if (dirty.ok && dirty.value.files.length > 0) {
      const shown = dirty.value.files.slice(0, 3).join(", ");
      const more = dirty.value.files.length > 3 ? ", …" : "";
      scopeDeclared.push({
        reason:
          `analyzed IN PLACE with ${dirty.value.files.length} uncommitted change(s) in the working tree ` +
          `(${shown}${more}) — the content analyzed is not exactly ${scope.ref ?? "HEAD"}`,
        subject: "scope-in-place",
      });
    }
  }

  const analyzeIn = (analyzeRoot: string): Promise<AnalysisOutcome> =>
    analyze({ analyzeRoot, outputRoot, scope, loaded, options, ghIdentity });

  let outcome: AnalysisOutcome;
  const worktreeDegraded: Degradation[] = [];
  try {
    if (worktreeRef === undefined) {
      outcome = await analyzeIn(outputRoot);
    } else {
      // 1.14's lifecycle, consumed as-is: reclaim-before-create, `--detach`,
      // `core.longpaths`, removal in `finally`. No second lifecycle here.
      const lifecycle = await withWorktree(
        {
          repoRoot: outputRoot,
          ref: worktreeRef,
          ...(options.worktreeBaseDir === undefined ? {} : { baseDir: options.worktreeBaseDir }),
        },
        analyzeIn,
      );
      if (!lifecycle.ok) {
        // Name the residue path: a user cannot clean up a leak they cannot name.
        const residue =
          lifecycle.worktreePath === undefined ? "" : ` (worktree ${lifecycle.worktreePath})`;
        // The lifecycle's OWN degradations (base degraded, reclaim failed,
        // unowned or in-use residue declared) are the only record of them on
        // this path: a typed preflight failure has no degradation channel, so
        // keeping just `.reason` would DROP declarations the throwing path
        // correctly harvests.
        const declared = lifecycle.degradations
          .map(toManifestDegradation)
          .map((d) => `${d.reason} (${d.subject})`)
          .join("; ");
        const suffix = declared === "" ? "" : ` — worktree degradations: ${declared}`;
        return {
          ok: false,
          code: "preflight",
          message: `worktree for ${worktreeRef}: ${lifecycle.reason}${residue}${suffix}`,
        };
      }
      outcome = lifecycle.value;
      // Worktree degradations reach the manifest through the 1.14 adapter —
      // never a hand-rolled shape at a schema boundary.
      worktreeDegraded.push(...lifecycle.degradations.map(toManifestDegradation));
    }
  } catch (error) {
    // On the THROWING path there is no lifecycle result: a removal that failed
    // while the callback was also failing rides on the propagating error, and
    // dropping it here would make the leak invisible (SPIKE-5 item 13).
    const residue = worktreeDegradationsOf(error)
      .map(toManifestDegradation)
      .map((d) => `${d.reason} (${d.subject})`)
      .join("; ");
    const suffix = residue === "" ? "" : ` — worktree residue: ${residue}`;
    // A change set git cannot produce stays a TYPED preflight failure, exactly
    // as it was before scopes existed; anything else is a real bug and keeps
    // propagating.
    if (error instanceof ChangeSetError) {
      return { ok: false, code: "preflight", message: `${error.message}${suffix}` };
    }
    if (suffix === "") throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}${suffix}`, { cause: error });
  }

  // ---- Phase 5: composition (INVOKING repo, outside any worktree) ---------
  const runDegraded = [...outcome.runDegraded, ...worktreeDegraded];
  // Change-size declarations are EXIT-NEUTRAL: a binary file or an
  // unmeasurable range makes the score's denominator smaller, which is a
  // statement about the score's precision, not about lost analysis coverage.
  const declaredOnly = [...outcome.declaredOnly, ...scopeDeclared, ...outcome.changeSize.degradations];
  const bySubjectReason = (a: Degradation, b: Degradation): number =>
    compare(a.subject, b.subject) || compare(a.reason, b.reason);
  runDegraded.sort(bySubjectReason);
  // Sorted like every sibling list: analyzer map insertion order must never
  // reach the artifact's bytes.
  declaredOnly.sort(bySubjectReason);

  // Config-plane visibility: warnings (never degradations, never exit 2).
  const knownAxioms = new Set([...outcome.registeredAxioms, ...ANALYZERLESS_KNOWN_AXIOMS]);
  const configWarnings = [
    ...loaded.warnings,
    ...Object.keys(config.axioms)
      .filter((id) => !knownAxioms.has(id))
      .sort(numericCompare)
      .map((id) => `axioms.${id} matches no known axiom`),
  ];

  // Governing-config git status: an uncommitted config gating the run is
  // declared in the manifest and warned about at the CLI (P3 — visibility
  // only, no policy). Absent = no file, so no git call needed.
  let configGitStatus: RunManifest["configGitStatus"];
  if (loaded.configPresent) {
    const status = fileGitStatus(outputRoot, "_agentic-guardrails/config.yaml");
    // ponytail: a git failure here is near-impossible (repoRoot + status just
    // succeeded); the field is optional, so it is simply omitted on failure.
    if (status.ok) configGitStatus = status.value;
  } else {
    configGitStatus = "absent";
  }

  // The effective post-default enforcement map the gate uses — persisted in
  // the manifest so the governing policy is durable, keys numeric-sorted.
  const enforcement = Object.fromEntries(
    Object.keys(config.axioms)
      .sort(numericCompare)
      .map((id) => {
        const entry = config.axioms[id]!;
        return [
          id,
          {
            enforcement: entry.enforcement,
            ...(entry.maxFindings === undefined ? {} : { maxFindings: entry.maxFindings }),
          },
        ];
      }),
  );

  const gate = evaluateGate(outcome.findings, config, outcome.enabledAxioms);

  // ---- FR-14: raw counts + change size + the DERIVED score ---------------
  // Every input here is this run's own, so the block is a pure function of
  // the run and the artifact stays byte-identical for identical inputs. The
  // FR-15 delta below is deliberately NOT part of it.
  const axiomSeverityCounts = countBySeverity(outcome.findings, outcome.enabledAxioms);
  // The denominator is computed ONLY for a scope that has one. `--project` is
  // not a diff, so `changedKlocMilliOf(0)` would write a 0.1-KLOC change size
  // into the artifact for a scope the contract says has no change size by
  // construction — a fabricated denominator, omitting the score notwithstanding.
  const scorable = scopeIsScorable(scope.kind);
  const changedKlocMilli = scorable
    ? changedKlocMilliOf(outcome.changeSize.changedLines)
    : undefined;
  const scores: ReviewScores = {
    formulaVersion: OD1_FORMULA_VERSION,
    axiomSeverityCounts,
    ...(changedKlocMilli === undefined
      ? { scoreOmittedReason: PROJECT_SCORE_OMITTED }
      : {
          changedLines: outcome.changeSize.changedLines,
          changedKlocMilli,
          scoreTenths: od1ScoreTenths(axiomSeverityCounts, changedKlocMilli),
        }),
    binaryFiles: outcome.changeSize.binaryFiles.length,
  };

  // Declared assembly: six phases always, membership derived from
  // scope/mode/config (off-axioms shrink phase 1), empty phases say why.
  const phases: RunManifest["phases"] = [
    { phase: 0, members: ["preflight"], ran: true },
    {
      phase: 1,
      members: outcome.phase1.members,
      ran: outcome.phase1.ran,
      ...(outcome.phase1.reason === undefined ? {} : { reason: outcome.phase1.reason }),
    },
    { phase: 2, members: [], ran: false, reason: "SDD gate — empty membership until Epic 2" },
    { phase: 3, members: [], ran: false, reason: "LLM enrichment — empty membership until Epic 3" },
    { phase: 4, members: ["merge", "sort"], ran: true },
    { phase: 5, members: ["compose"], ran: true },
  ];

  const { manifest, degraded: sentinelDegraded } = buildRunManifest({
    axiomsOff: outcome.axiomsOff,
    ...(outcome.ledgerHash === undefined ? {} : { ledgerHash: outcome.ledgerHash }),
    ...(outcome.corpusHash === undefined ? {} : { corpusHash: outcome.corpusHash }),
    // The corpus axiom 6 actually judged against — reproducibility, and the
    // explicit distinction from `corpusHash` (committed corpus-map.yaml).
    ...(outcome.corpusSeedHash === undefined ? {} : { corpusSeedHash: outcome.corpusSeedHash }),
    configHash: loaded.configHash,
    configPresent: loaded.configPresent,
    enforcement,
    configGitStatus,
    phases,
    cache: outcome.cache,
    // The slug is a directory name; the manifest carries what was ACTUALLY
    // reviewed. Omitted for the uncommitted scope, which keeps pre-1.15
    // artifact bytes byte-for-byte unchanged.
    ...(scope.kind === "uncommitted"
      ? {}
      : {
          scope: {
            kind: scope.kind,
            ...(scope.ref === undefined ? {} : { ref: scope.ref }),
            ...(scope.base === undefined ? {} : { base: scope.base }),
            ...(scope.baseGuessed === true ? { baseGuessed: true } : {}),
          },
        }),
    ...(prMetadata === undefined ? {} : { pr: prMetadata }),
  });
  const artifact: ReviewArtifact = {
    schemaVersion: 1,
    runId: outcome.runId,
    scope: scope.slug,
    changedFiles: outcome.changedFiles,
    deletedFiles: outcome.deletedFiles,
    findings: outcome.findings,
    degraded: [...sentinelDegraded, ...declaredOnly, ...runDegraded],
    manifest,
    gate,
    scores,
  };
  // Never persist an invalid envelope: validation failure is the exit-2 path.
  const parsed = reviewArtifactSchema.safeParse(artifact);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      code: "invalid-artifact",
      message: `composed review artifact failed schema validation: ${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "unknown issue"}`,
    };
  }
  // ---- The history plane (1.16) ------------------------------------------
  // Everything below runs AFTER the artifact is composed and validated, and
  // nothing it produces reaches the artifact: the trend record is derived
  // from the artifact, never the other way round.
  //
  // The recorded commit is what was REVIEWED — the ref's commit for a ref
  // scope (which lives in the invoking repo, so ancestry can walk it), and
  // the invoking HEAD otherwise. Two `uncommitted` runs therefore share one
  // sha; `recordId` is the declared tiebreak (see the contract).
  const reviewedRef = scope.ref === undefined ? undefined : revParse(outputRoot, scope.ref);
  const reviewedSha =
    reviewedRef !== undefined && reviewedRef.ok ? reviewedRef.value : headSha(outputRoot);
  const trendRecord: TrendRecord = makeTrendRecord({
    schemaVersion: 1,
    runId: artifact.runId,
    commitSha: reviewedSha,
    scopeKind: scope.kind,
    axiomSeverityCounts,
    ...(changedKlocMilli === undefined ? {} : { changedKlocMilli }),
  });
  const trendsStore = path.join(outputRoot, TRENDS_PATH);
  // Aggregate BEFORE appending, and exclude this run's own id: a re-run must
  // never end up comparing against itself.
  //
  // Ancestry is measured against the REVIEWED commit, not the invoking HEAD.
  // `--branch`/`--pr` normally review a ref the invoker is not standing on, so
  // asking "is the previous record's commit an ancestor of MY head?" answers
  // no for every record on that branch — the delta would only start working
  // once the branch was merged, i.e. after it stopped being useful. The
  // record stores `reviewedSha`; the query has to ask about the same commit.
  const trend = aggregateTrends({
    repoRoot: outputRoot,
    storePath: trendsStore,
    headSha: reviewedSha,
    scopeKind: scope.kind,
    current: axiomSeverityCounts,
    currentRecordId: trendRecord.recordId,
  });
  // An unborn repo has no commit to record against: `headSha` answers with the
  // empty-TREE sentinel, which passes the schema but is not a commit, so every
  // such record would be permanently declared "names a commit no longer in
  // this repository" and enough of them would cold-start the whole store.
  // Recording nothing is the honest answer, said out loud.
  const appended =
    reviewedSha === EMPTY_TREE_SHA
      ? ({
          ok: false,
          reason: "this repository has no commits yet — there is no commit to record a trend against",
        } as const)
      : appendJsonl(trendsStore, trendRecordSchema, [trendRecord]);
  const trendWrite: TrendWriteOutcome = appended.ok
    ? {
        state: appended.value.appended > 0 ? "appended" : "skipped",
        repaired: appended.value.repaired,
      }
    : { state: "failed", reason: appended.reason };

  return {
    ok: true,
    repoRoot: outputRoot,
    artifact,
    artifactJson: `${JSON.stringify(artifact, null, 2)}\n`,
    runDegraded,
    declaredOnly,
    degradedRun: runDegraded.length > 0,
    gate,
    configPresent: loaded.configPresent,
    deviations: loaded.deviations,
    configWarnings,
    wiringWarnings,
    trend,
    trendWrite,
    artifactRetention: config.artifactRetention ?? EFFECTIVE_DEFAULTS.artifactRetention,
    dispositionPolicy: config.dispositionPolicy ?? EFFECTIVE_DEFAULTS.dispositionPolicy,
  };
}

/**
 * FR-14's raw material: per-axiom severity counts. EVERY axiom that ran gets
 * an entry, zeros included — an axiom that found nothing this run is a real
 * data point, and without the entry the FR-15 delta could not tell "clean" from
 * "did not run". Axioms configured `off` are absent for exactly that reason.
 */
function countBySeverity(
  findings: readonly Finding[],
  ranAxioms: readonly string[],
): Record<string, SeverityCounts> {
  const counts: Record<string, SeverityCounts> = {};
  // Sorted keys: insertion order must never reach the artifact's bytes.
  for (const axiom of [...new Set([...ranAxioms, ...findings.map((f) => f.axiom)])].sort(
    numericCompare,
  )) {
    counts[axiom] = { error: 0, warning: 0, info: 0 };
  }
  for (const finding of findings) {
    const entry = counts[finding.axiom];
    if (entry !== undefined) entry[finding.severity] += 1;
  }
  return counts;
}

/** True when `ref` resolves to the commit HEAD is on — the test that decides
 * whether a worktree is needed at all. An unresolvable ref answers "not HEAD"
 * and is caught by the lifecycle's own ref handling. */
function isCurrentHead(repoRoot: string, ref: string): boolean {
  const target = revParse(repoRoot, ref);
  return target.ok && target.value === headSha(repoRoot);
}

/**
 * One analysis pass over `analyzeRoot` — phases 0 (change set) through 4
 * (aggregation). Runs INSIDE the worktree when there is one; every path it
 * emits is relative to `analyzeRoot`.
 */
async function analyze(inputs: AnalysisInputs): Promise<AnalysisOutcome> {
  const { analyzeRoot, outputRoot, scope, options } = inputs;
  const config = inputs.loaded.config;

  // The `_agentic-guardrails/` exclusion lives inside the resolver, once, for
  // all four producers (a written artifact must not change the next run's
  // identity). The config `exclude` prefixes (1.18) apply at the same site —
  // excluded files are counted and declared, never silently dropped.
  const changed = changeSetFor(scope, analyzeRoot, config.exclude ?? []);
  if (!changed.ok) throw new ChangeSetError(changed.reason);
  const candidates = changed.value;

  // The OD-1 denominator (1.16), measured over the same range as the change
  // set. A measurement failure is NOT a run failure: the counts are still
  // real, so the size degrades to "unmeasured" (which floors the denominator)
  // with the reason declared, rather than losing the whole review.
  const measured = changeSizeFor(scope, analyzeRoot, config.exclude ?? []);
  const changeSize: ScopeChangeSize = measured.ok
    ? measured.value
    : {
        changedLines: 0,
        binaryFiles: [],
        degradations: [
          {
            reason: `changed-KLOC could not be measured (${firstLine(measured.reason)}) — the score's denominator fell back to its 0.1 floor`,
            subject: "score-change-size",
          },
        ],
      };

  // Content hashes are computed ONCE, here, before any analyzer runs — the
  // same snapshot feeds analysis and the runId (no analyze/hash race).
  //
  // An unreadable candidate is NOT automatically a deletion. For a ref scope
  // git already told us which paths are deleted (`--name-status`), so a read
  // failure on any OTHER path is lost coverage and is DECLARED — silently
  // filing it as "deleted" is a permission-denied/locked file reading as a
  // clean review. For the working-tree scopes an absent path IS a deletion
  // (excluded from analysis, carried on the artifact, never a degradation —
  // deletion is not coverage loss).
  const changedFiles: string[] = [];
  const deletedFiles: string[] = [...candidates.deleted];
  const unreadable: Degradation[] = [];
  const fileHashes: [string, string][] = [];
  for (const file of candidates.files) {
    let contentHash: string;
    try {
      // `fsPath`: a worktree base plus a deep repo-relative path can cross
      // Win32's 260-char limit, and an fs failure here is indistinguishable
      // from a deleted file — the file would silently leave the analysis.
      contentHash = createHash("sha256")
        .update(readFileSync(fsPath(path.join(analyzeRoot, file))))
        .digest("hex");
    } catch (error) {
      if (candidates.fromRefs) {
        const message = error instanceof Error ? error.message : String(error);
        unreadable.push({
          reason: `changed at the reviewed ref but unreadable: ${firstLine(message)}`,
          subject: file,
        });
      } else {
        deletedFiles.push(file);
      }
      continue;
    }
    changedFiles.push(file);
    fileHashes.push([file, contentHash]);
  }
  deletedFiles.sort();

  const analyzableFiles = changedFiles.filter(isAnalyzableTs);
  const discovery =
    analyzableFiles.length > 0
      ? discoverTsconfigs(analyzeRoot)
      : { tsconfigPaths: [], degraded: [] };
  // ---- Cache plane (1.7) --------------------------------------------------
  // Cache keys are per-UNIT content addresses, deliberately narrower than
  // the runId: the runId includes HEAD (a new commit is a new run identity),
  // while cache keys hash only the content that determines the unit's output
  // — so an unrelated commit (new HEAD, identical content) still hits.
  //
  // ZERO SILENT CACHE BEHAVIOR: when caching cannot run (secret unavailable,
  // cache dir unwritable, uncomputable key, nothing to cache), it is DISABLED
  // for the whole run with a declared reason in `manifest.cache.disabled` —
  // never a quiet fallback, never an unauthenticated read.
  const cacheStats = { hits: 0, misses: 0, invalid: 0 };
  const cacheDegraded: Degradation[] = [];
  // outputRoot, not analyzeRoot: the cache belongs to the invoking repo and
  // must survive the worktree it was populated from (which is deleted).
  const cacheRoot = path.join(outputRoot, "_agentic-guardrails", ".cache");
  const secret = loadCacheSecret(options.cacheSecretPath);
  let cacheDisabled: string | undefined;
  if (secret === undefined) {
    cacheDisabled =
      "cache secret unavailable (could not read or create ~/.agentic-guardrails/cache-secret)";
  } else if (analyzableFiles.length === 0) {
    cacheDisabled = "no analyzable TypeScript changes — nothing to cache";
  } else {
    try {
      mkdirSync(cacheRoot, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cacheDisabled = `cache directory not writable: ${message}`;
    }
  }
  // Graph key per tsconfig: tsconfig bytes + every participating file's
  // content hash (the compiler's parsed file list — exactly the set the
  // graph build would parse). Any unresolvable file list or unreadable
  // participant → a declared disable, never a fake key.
  const graphKeys = new Map<string, string>();
  if (cacheDisabled === undefined) {
    for (const tsconfigPath of discovery.tsconfigPaths) {
      const key = computeGraphKey(analyzeRoot, tsconfigPath);
      if (key === undefined) {
        cacheDisabled = `cache key not computable for ${path.relative(analyzeRoot, tsconfigPath).replaceAll("\\", "/")} (unresolvable or unreadable inputs)`;
        graphKeys.clear();
        break;
      }
      graphKeys.set(tsconfigPath, key);
    }
  }
  const cache =
    secret === undefined ? undefined : new DeterministicCache(cacheRoot, secret);
  const analyzableHashes = fileHashes.filter(([file]) => isAnalyzableTs(file));
  const controller = new AbortController();
  // Run-local memo: with TWO graph-consuming analyzers (1.10), the second
  // reuses the first's build within the SAME run — one parse per tsconfig
  // even when persistent caching is disabled, and intra-run reuse never
  // inflates the hit/miss counters (those report the persistent cache only).
  // `acquire` is deliberately await-free end to end: the memo check, the
  // synchronous persistent read, the build, and the memo store all happen in
  // one frame, so concurrent analyzers cannot both observe a miss.
  const graphMemo = new Map<string, ImportGraphBuildResult>();
  const graphCache: GraphCache = {
    acquire(tsconfigPath, build) {
      const memoized = graphMemo.get(tsconfigPath);
      if (memoized !== undefined) return memoized;
      const key = graphKeys.get(tsconfigPath);
      if (key !== undefined && cache !== undefined) {
        const read = cache.get("graph", key, cachedGraphSchema);
        if (read.hit) {
          cacheStats.hits += 1;
          const result: ImportGraphBuildResult = {
            data: new ImportGraph(read.value.data.nodes, read.value.data.edges),
            coverage: read.value.coverage,
            attempted: read.value.attempted,
            unresolved: read.value.unresolved,
            unresolvedImports: read.value.unresolvedImports,
            degraded: read.value.degraded,
          };
          graphMemo.set(tsconfigPath, result);
          return result;
        }
        if (read.invalid) {
          cacheStats.invalid += 1;
          cacheDegraded.push({
            reason: "invalid cache entry (recomputed and overwritten)",
            subject: `cache/graph/${path.relative(analyzeRoot, tsconfigPath).replaceAll("\\", "/")}`,
          });
        } else {
          cacheStats.misses += 1;
        }
      }
      const result = build();
      // Memoized unconditionally: a degraded or post-abort build is still
      // THIS run's truth (only the persistent tier below refuses it).
      graphMemo.set(tsconfigPath, result);
      // Cache hygiene (P2): never persist post-abort work, and never let a
      // degraded partial become a future "clean" hit.
      if (
        key !== undefined &&
        cache !== undefined &&
        !controller.signal.aborted &&
        result.degraded.length === 0
      ) {
        cache.put("graph", key, {
          data: result.data.toJSON(),
          coverage: result.coverage,
          attempted: result.attempted,
          unresolved: result.unresolved,
          unresolvedImports: result.unresolvedImports,
          degraded: result.degraded,
        });
      }
      return result;
    },
  };
  // Findings key (per axiom): graph keys + analyzable change hashes + scope
  // + boundaries declaration + ruleset/engine/TypeScript versions + tier
  // enablement. Config ENFORCEMENT is NOT in the key on purpose — it never
  // changes what an analyzer computes (off-axioms are excluded at membership
  // level, gating happens later) — but the `boundaries` declaration IS an
  // analyzer input (1.9 direction/unassigned rules), so it must invalidate.
  // The TypeScript version is a toolchain input: an upgrade can change parse
  // output, so it must invalidate.
  // Axiom 6 (1.13) reads the persisted structural seed — an analyzer input
  // that lives OUTSIDE the change set (`_agentic-guardrails/` is excluded from
  // it), so its content must be in that axiom's key or a re-inited corpus
  // would serve stale conformance findings. "absent" is the honest sentinel:
  // the no-corpus state is itself an input worth keying on. The bytes are
  // read ONCE and handed to the analyzer through the context, so the hashed
  // corpus and the analyzed corpus are the same buffer.
  // The corpus seed is the invoking repo's knowledge, not the reviewed ref's
  // — a worktree at an old commit must still be judged against today's corpus.
  const corpusSeed = readStructuralSeedFile(outputRoot);
  const seedHash = corpusSeed.ok
    ? createHash("sha256").update(corpusSeed.bytes).digest("hex")
    : "absent";
  const findingsKeyFor = (axiom: string): string | undefined => {
    if (cacheDisabled !== undefined) return undefined;
    return createHash("sha256")
      .update(
        JSON.stringify([
          "findings",
          axiom,
          // Axiom 5's regex tier reads EVERY changed file, so its key must
          // cover them all — a changed .env must invalidate its entry. The
          // other axioms see only analyzable TS.
          axiom === "5" ? fileHashes : analyzableHashes,
          axiom === "6" ? seedHash : null,
          [...graphKeys.values()].sort(),
          // The scope, threaded from the resolver — no literal survives here.
          // A `project` run and an `uncommitted` run over the same file set
          // are different analyses and must not share cache entries.
          scope.slug,
          config.boundaries ?? null,
          RULESET_VERSION,
          ENGINE_VERSION,
          ts.version,
          { deterministic: true, llm: false },
        ]),
      )
      .digest("hex");
  };

  // Run-local shared changed-files parse (1.11 P4): two changed-files
  // analyzers (axiom 3 + axiom 4) consume ONE parse per run. Same
  // await-free acquire discipline as graphMemo above — the memo check, the
  // build, and the store happen in one frame, so concurrent analyzers
  // cannot both observe a miss.
  let changedFilesMemo: ChangedFilesParse | undefined;
  const changedFilesCache: ChangedFilesCache = {
    acquire(build) {
      changedFilesMemo ??= build();
      return changedFilesMemo;
    },
  };

  const context: AnalyzerContext = {
    repoRoot: analyzeRoot,
    changedFiles: analyzableFiles,
    allChangedFiles: changedFiles,
    tsconfigPaths: discovery.tsconfigPaths,
    ...(config.boundaries === undefined ? {} : { boundaries: config.boundaries }),
    graphCache,
    changedFilesCache,
    signal: controller.signal,
    corpusSeed,
  };

  // ---- Phase 1: deterministic tier (per-axiom isolation) ------------------
  // `off` exclusion is membership-level (the analyzer never runs), so the
  // manifest can honestly declare "did not run" — not result suppression.
  const registered = options.analyzers ?? DEFAULT_ANALYZERS;
  const seenAxioms = new Set<string>();
  for (const analyzer of registered) {
    if (seenAxioms.has(analyzer.axiom)) throw new DuplicateAnalyzerError(analyzer.axiom);
    seenAxioms.add(analyzer.axiom);
  }
  const analyzers = registered.filter((a) => config.axioms[a.axiom]?.enforcement !== "off");
  const axiomsOff = registered
    .filter((a) => config.axioms[a.axiom]?.enforcement === "off")
    .map((a) => a.axiom);
  const budgetMs = options.phase1BudgetMs ?? PHASE1_BUDGET_MS;
  const settled = new Map<string, AnalyzerResult>();
  const budgetTimer = setTimeout(() => controller.abort(), budgetMs);
  try {
    await pMap(
      analyzers,
      async (analyzer): Promise<void> => {
        const key = findingsKeyFor(analyzer.axiom);
        if (key !== undefined && cache !== undefined) {
          const read = cache.get("findings", key, cachedAnalyzerResultSchema);
          if (read.hit) {
            // Hit: skip analyzer execution AND graph build — the cached
            // entry is the identical data a cold run would compute.
            cacheStats.hits += 1;
            settled.set(analyzer.axiom, read.value);
            return;
          }
          if (read.invalid) {
            cacheStats.invalid += 1;
            cacheDegraded.push({
              reason: "invalid cache entry (recomputed and overwritten)",
              subject: `cache/findings/axiom-${analyzer.axiom}`,
            });
          } else {
            cacheStats.misses += 1;
          }
        }
        let result: AnalyzerResult;
        let crashed = false;
        try {
          result = await analyzer.run(context);
        } catch (error) {
          // Isolation: one axiom crashing degrades the manifest, never the run.
          crashed = true;
          const message = error instanceof Error ? error.message : String(error);
          result = {
            findings: [],
            degraded: [
              { reason: `analyzer crashed: ${message}`, subject: `axiom-${analyzer.axiom}` },
            ],
          };
        }
        settled.set(analyzer.axiom, result);
        // Write-through — but never cache a crash (a transient failure must
        // not become sticky until the next content change), never cache a
        // degraded partial (it must not become a future "clean" hit), and
        // never cache post-abort work (an aborted run must not leak results
        // into future runs).
        if (
          key !== undefined &&
          cache !== undefined &&
          !crashed &&
          result.degraded.length === 0 &&
          !controller.signal.aborted
        ) {
          cache.put("findings", key, result);
        }
      },
      // SPIKE-3 (docs/spikes/SPIKE-3-import-graph-cost.md): sweep {2,4,8} was
      // flat — today's analyzers are synchronous CPU-bound, so the bound is
      // provisional by construction; 4 kept as the cap for when 1.9 registers
      // genuinely async analyzers. Revisit if analyzers move to workers.
      { concurrency: 4, signal: controller.signal },
    );
  } catch (error) {
    // The mapper never throws (isolation above) — the only EXPECTED
    // rejection is the budget abort. Anything else is a real bug and must
    // surface even when it races the abort: rethrow every non-abort error.
    const name = (error as { name?: unknown } | null)?.name;
    if (!(controller.signal.aborted && name === "AbortError")) throw error;
  } finally {
    clearTimeout(budgetTimer);
  }
  const phase1Aborted = controller.signal.aborted;

  // Everything below runs synchronously to the return — an abandoned
  // in-flight analyzer cannot mutate `settled` mid-aggregation.
  const findings: Finding[] = [];
  // Unreadable-at-the-ref entries are REAL degradations: coverage this run
  // claimed and did not get.
  const runDegraded: Degradation[] = [...discovery.degraded, ...unreadable];
  const analyzerDegraded: [axiom: string, degradation: Degradation][] = [];
  // The "absent until init" carve-out (1.8, generalized in 1.13): an analyzer
  // DECLARES which of its degradations are exit-neutral. The pipeline never
  // string-matches reasons — a forged or drifting message can no longer buy
  // an exemption, and every real degradation (unreadable/invalid/empty inputs
  // included) drives exit 2 exactly as before.
  // Declarations ABOUT the change set (an empty ref diff) ride the same
  // exit-neutral channel: nothing was lost, but "nothing was reviewed" must
  // never look like "nothing was wrong".
  const declaredOnly: Degradation[] = [...candidates.degradations];
  for (const analyzer of analyzers) {
    const result = settled.get(analyzer.axiom);
    if (result === undefined) {
      // Budget cut this analyzer off before it completed: typed partial.
      runDegraded.push({
        reason: `phase 1 exceeded its ${budgetMs}ms budget — analyzer aborted before completion`,
        subject: `axiom-${analyzer.axiom}`,
      });
      continue;
    }
    findings.push(...result.findings);
    for (const d of result.degraded) analyzerDegraded.push([analyzer.axiom, d]);
    declaredOnly.push(...(result.declaredOnly ?? []));
  }
  // CROSS-ANALYZER dedupe only: two graph-consuming analyzers (1.10) declare
  // the SAME graph-build degradations — one event, one entry. A (reason,
  // subject) pair repeated WITHIN one analyzer is repeated real events and
  // every occurrence stays.
  const axiomsByDegradation = new Map<string, Set<string>>();
  for (const [axiom, d] of analyzerDegraded) {
    const key = JSON.stringify([d.reason, d.subject]);
    const axioms = axiomsByDegradation.get(key);
    if (axioms === undefined) axiomsByDegradation.set(key, new Set([axiom]));
    else axioms.add(axiom);
  }
  const crossEmitted = new Set<string>();
  for (const [, d] of analyzerDegraded) {
    const key = JSON.stringify([d.reason, d.subject]);
    if (axiomsByDegradation.get(key)!.size > 1) {
      if (crossEmitted.has(key)) continue;
      crossEmitted.add(key);
    }
    runDegraded.push(d);
  }
  runDegraded.push(...cacheDegraded);

  // Manifest truth (1.8): committed knowledge files hash their real bytes;
  // an absent file keeps the sentinel + its "absent until init" declaration
  // (excluded from runDegraded — see ReviewRunResult.runDegraded); a
  // present-but-unreadable or present-but-invalid file is a REAL
  // degradation counted toward the exit-2 logic.
  // outputRoot: the committed knowledge files are the invoking repo's, and a
  // reviewed ref predating `init` must not read as "ledger absent".
  const ledger = hashKnowledgeFile(
    outputRoot,
    "_agentic-guardrails/conventions.yaml",
    conventionsFileSchema,
    "ledger",
  );
  const corpus = hashKnowledgeFile(
    outputRoot,
    "_agentic-guardrails/corpus-map.yaml",
    corpusMapFileSchema,
    "corpus",
  );
  if (ledger.degradation !== undefined) runDegraded.push(ledger.degradation);
  if (corpus.degradation !== undefined) runDegraded.push(corpus.degradation);

  // ---- Phase 4: aggregation (FR-21 merge, then deterministic sort) --------
  const merged = mergeFindings(findings);
  merged.sort(byFileLineAxiom);

  // Composition deliberately does NOT happen here: it is the caller's job,
  // outside any worktree, so degradations only known after removal still land
  // in the artifact.
  return {
    changedFiles,
    deletedFiles,
    findings: merged,
    runDegraded,
    declaredOnly,
    // Snapshot COPY, never the live counter object — nothing may mutate the
    // manifest's cache truth after composition.
    cache: {
      ...cacheStats,
      ...(cacheDisabled === undefined ? {} : { disabled: cacheDisabled }),
    },
    changeSize,
    ...(corpusSeed.ok ? { corpusSeedHash: seedHash } : {}),
    ...(ledger.hash === undefined ? {} : { ledgerHash: ledger.hash }),
    ...(corpus.hash === undefined ? {} : { corpusHash: corpus.hash }),
    runId: computeRunId(
      analyzeRoot,
      scope.slug,
      fileHashes,
      deletedFiles,
      inputs.loaded.configHash,
      inputs.ghIdentity,
    ),
    phase1: {
      members: analyzers.map((a) => `axiom-${a.axiom}`).sort(numericCompare),
      // `ran` reflects reality: false when nothing was enabled OR the budget
      // abort cut the phase off before ANY analyzer completed; a mid-flight
      // abort with partial completions is `ran: true` plus the reason.
      ran: analyzers.length > 0 && settled.size > 0,
      ...(analyzers.length === 0
        ? { reason: "no deterministic analyzers enabled" }
        : phase1Aborted
          ? {
              reason: `aborted at the ${budgetMs}ms budget — ${settled.size}/${analyzers.length} analyzers completed`,
            }
          : {}),
    },
    enabledAxioms: analyzers.map((a) => a.axiom),
    axiomsOff,
    registeredAxioms: registered.map((a) => a.axiom),
  };
}

/**
 * Manifest hash for one committed knowledge file (1.8). Absent (ENOENT) →
 * no hash (the manifest builder records the sentinel + its "absent until
 * init" declaration). Any other read error → sentinel hash + a degradation
 * naming the read error (an EACCES/EISDIR is NOT absence). Present but
 * failing yaml-parse or the contracts schema → the REAL sha256 of the
 * bytes (truth about what's there) + a degradation naming the invalidity.
 * Valid → real hash, no degradation.
 */
function hashKnowledgeFile(
  root: string,
  relPath: string,
  schema: z.ZodType,
  subject: string,
): { hash?: string; degradation?: Degradation } {
  const name = path.basename(relPath);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path.join(root, relPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    const message = error instanceof Error ? error.message : String(error);
    return {
      hash: ABSENT_SHA256,
      degradation: { reason: `${name} unreadable: ${firstLine(message)}`, subject },
    };
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  let raw: unknown;
  try {
    raw = parseYaml(bytes.toString("utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      hash,
      degradation: { reason: `${name} present but invalid: ${firstLine(message)}`, subject },
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined ? "(root)" : issue.path.map(String).join(".") || "(root)";
    return {
      hash,
      degradation: {
        reason: `${name} present but invalid: ${where}: ${issue?.message ?? "unknown issue"}`,
        subject,
      },
    };
  }
  return { hash };
}

function firstLine(message: string): string {
  return message.split("\n")[0] ?? message;
}

/** Analyzable change-set membership: runtime TS sources only — `.d.ts`
 * (and `.d.mts`/`.d.cts`) declarations carry no runtime imports. */
function isAnalyzableTs(file: string): boolean {
  if (/\.d\.(ts|mts|cts)$/.test(file)) return false;
  return /\.(ts|tsx|mts|cts)$/.test(file);
}

export interface TsconfigDiscovery {
  tsconfigPaths: string[];
  degraded: Degradation[];
}

/**
 * Root tsconfig discovery. A solution-style root (no/empty `files` and
 * `include`, non-empty `references`) contains no sources itself — each
 * referenced project's tsconfig is resolved and analyzed instead, and the
 * per-project graphs are merged downstream. A missing root tsconfig is a
 * typed degradation, never a throw. Exported for the init seed build (1.8)
 * — one discovery implementation.
 */
export function discoverTsconfigs(root: string): TsconfigDiscovery {
  const rootTsconfig = path.join(root, "tsconfig.json");
  // `fsPath` everywhere `fs` is asked about an ANALYZE-root path: past
  // Win32's 260-char limit `existsSync` answers "false", so a long path would
  // silently read as "no tsconfig here" (SPIKE-5 item 11).
  if (!existsSync(fsPath(rootTsconfig))) {
    return {
      tsconfigPaths: [],
      degraded: [{ reason: "root tsconfig.json not found", subject: "tsconfig.json" }],
    };
  }
  // ts.readConfigFile handles JSONC (comments, trailing commas) — tsconfigs
  // are not plain JSON.
  const read = ts.readConfigFile(rootTsconfig, ts.sys.readFile);
  if (read.error !== undefined || read.config === undefined) {
    const detail =
      read.error === undefined
        ? "empty config"
        : ts.flattenDiagnosticMessageText(read.error.messageText, " ");
    return {
      tsconfigPaths: [],
      degraded: [{ reason: `root tsconfig.json unreadable: ${detail}`, subject: "tsconfig.json" }],
    };
  }
  const config = read.config as {
    files?: unknown;
    include?: unknown;
    references?: { path?: unknown }[];
  };
  const hasOwnSources =
    (Array.isArray(config.files) && config.files.length > 0) ||
    (Array.isArray(config.include) && config.include.length > 0);
  const references = Array.isArray(config.references) ? config.references : [];
  if (hasOwnSources || references.length === 0) {
    return { tsconfigPaths: [rootTsconfig], degraded: [] };
  }

  const tsconfigPaths: string[] = [];
  const degraded: Degradation[] = [];
  for (const reference of references) {
    if (typeof reference?.path !== "string") continue;
    let refPath = path.resolve(root, reference.path);
    // A reference may point at a directory (tsconfig.json implied) or a file.
    if (!refPath.endsWith(".json")) refPath = path.join(refPath, "tsconfig.json");
    if (existsSync(fsPath(refPath))) {
      tsconfigPaths.push(refPath);
    } else {
      degraded.push({
        reason: "referenced tsconfig not found",
        subject: path.relative(root, refPath).replaceAll("\\", "/"),
      });
    }
  }
  return { tsconfigPaths, degraded };
}

/**
 * Run identity = sha256 over (scope slug, HEAD sha of the ANALYZE root —
 * the reviewed ref's commit for a worktree scope, empty-tree sentinel before
 * the first commit — sorted changed paths + their content hashes as snapped
 * before phase 1, deleted uncommitted paths, root tsconfig content hash,
 * config.yaml content hash — literal "absent" sentinel when absent — ruleset
 * version, engine version, and — only when there is one — the `gh` metadata
 * outcome), truncated to 16 hex chars. No wall clock — identical input re-runs
 * overwrite the same artifact file.
 *
 * The `gh` term is APPENDED and omitted when absent, so every non-PR scope
 * hashes exactly the tuple it hashed before it existed (bare
 * `guardrails review` keeps its artifact bytes). Where it IS present it is
 * load-bearing: `manifest.pr` and the `gh-pr-metadata` degradation are
 * artifact content that no other identity input covers, so without it the same
 * PR ref would overwrite one runId's artifact with different bytes.
 */
function computeRunId(
  analyzeRoot: string,
  scopeSlug: string,
  fileHashes: readonly (readonly [string, string])[],
  deletedFiles: readonly string[],
  configHash: string,
  ghIdentity?: unknown,
): string {
  let tsconfigHash: string;
  try {
    tsconfigHash = createHash("sha256")
      .update(readFileSync(fsPath(path.join(analyzeRoot, "tsconfig.json"))))
      .digest("hex");
  } catch {
    tsconfigHash = "absent";
  }
  // Everything hashed is CONTENT or a ref-derived name — never an absolute
  // path. `analyzeRoot` is a temp worktree for a ref scope, so a path here
  // would make the same ref produce a different runId on every run.
  return createHash("sha256")
    .update(
      JSON.stringify([
        scopeSlug,
        headSha(analyzeRoot),
        fileHashes,
        deletedFiles,
        tsconfigHash,
        configHash,
        RULESET_VERSION,
        ENGINE_VERSION,
        ...(ghIdentity === undefined ? [] : [ghIdentity]),
      ]),
    )
    .digest("hex")
    .slice(0, 16);
}

/**
 * Content-addressed graph cache key for one tsconfig: sha256 over the
 * tsconfig bytes plus every participating file's path + content hash (the
 * compiler's parsed file list — the same set the graph build parses) plus
 * the engine and TypeScript versions (a TS upgrade can change parse output,
 * so it must invalidate). Returns undefined (→ caching disabled for the run
 * with a declared reason) when the file list cannot be resolved or any
 * participant is unreadable — a wrong or fake key would serve stale graphs,
 * no key just costs a recompute.
 *
 * Exported for the key-invalidation tests; `tsVersion` and `engineVersion`
 * are their seams (an engine upgrade that changes the cached payload shape
 * must land as a clean key miss, never a revalidation failure).
 */
export function computeGraphKey(
  root: string,
  tsconfigPath: string,
  tsVersion: string = ts.version,
  engineVersion: string = ENGINE_VERSION,
): string | undefined {
  try {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      tsconfigPath,
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
    );
    if (parsed === undefined) return undefined;
    // `fsPath`: these are ANALYZE-root paths, and a >260-char one on Windows
    // would throw here — disabling the cache for the WHOLE run under a
    // generic "unreadable inputs" reason (SPIKE-5 item 11).
    const tsconfigHash = createHash("sha256")
      .update(readFileSync(fsPath(tsconfigPath)))
      .digest("hex");
    const files = [...parsed.fileNames].sort().map((file) => {
      // An unreadable participant makes the key undefined — a declared
      // disable, never an "unreadable" sentinel masquerading as content.
      const hash = createHash("sha256").update(readFileSync(fsPath(file))).digest("hex");
      return [path.relative(root, file).replaceAll("\\", "/"), hash];
    });
    return createHash("sha256")
      .update(JSON.stringify(["graph", tsconfigHash, files, engineVersion, tsVersion]))
      .digest("hex");
  } catch {
    return undefined;
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0; // code-point order, locale-independent
}

function byFileLineAxiom(a: Finding, b: Finding): number {
  return (
    compare(a.location.file, b.location.file) ||
    a.location.startLine - b.location.startLine ||
    compare(a.axiom, b.axiom) ||
    compare(a.findingId, b.findingId)
  );
}
