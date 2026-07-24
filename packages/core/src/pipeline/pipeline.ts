/**
 * The static review pipeline shell (walking skeleton, Story 1.4). Four
 * phases execute as distinct, individually-failable stages:
 *
 *   0 preflight     — git repo detection + change-set discovery + tsconfig
 *                     discovery (solution-style roots expand to their
 *                     referenced projects)
 *   1 deterministic — registered analyzers via p-map, per-axiom isolation
 *   4 aggregation   — deterministic sort (merge/dedupe is 1.9 scope)
 *   5 composition   — artifact + embedded RunManifest, byte-stable JSON,
 *                     schema-validated BEFORE any write
 *
 * Phases 2/3 (LLM tiers) exist in the pipeline SHAPE only — their membership
 * is empty until Epics 2/3. No DAG library: the phase order is a fixed
 * sequence, per-axiom isolation is a try/catch around each analyzer.
 *
 * The RunManifest is EMBEDDED in the artifact under the `manifest` key —
 * one atomic write covers both (no artifact/manifest torn-pair window).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  reviewArtifactSchema,
  type Degradation,
  type Finding,
  type ReviewArtifact,
} from "@agentic-guardrails/contracts";
import pMap from "p-map";
import { ts } from "ts-morph";

import { axiom1Structural } from "../analyzers/axiom1-structural.js";
import { headSha, repoRoot, uncommittedFiles } from "../git/git.js";
import { buildRunManifest, ENGINE_VERSION, RULESET_VERSION } from "./manifest.js";

export type { ReviewArtifact } from "@agentic-guardrails/contracts";

export interface AnalyzerContext {
  /** Absolute repo root (as git reports it). */
  repoRoot: string;
  /** Changed analyzable TS files (present on disk), repo-root-relative,
   * `/`-separated, sorted. */
  changedFiles: readonly string[];
  /** Leaf tsconfigs to analyze: the root tsconfig itself, or — for a
   * solution-style root — each referenced project's tsconfig. */
  tsconfigPaths: readonly string[];
}

export interface AnalyzerResult {
  findings: Finding[];
  degraded: Degradation[];
}

/** One registered deterministic analyzer. Plain array registry — no plugin
 * machinery; 1.9+ appends entries. `run` is async so the p-map concurrency
 * bound actually bounds concurrent work. */
export interface Analyzer {
  axiom: string;
  run(context: AnalyzerContext): Promise<AnalyzerResult>;
}

export const DEFAULT_ANALYZERS: readonly Analyzer[] = [axiom1Structural];

export type ReviewRunResult =
  | { ok: false; code: "preflight" | "invalid-artifact"; message: string }
  | {
      ok: true;
      repoRoot: string;
      artifact: ReviewArtifact;
      /** Canonical bytes: 2-space JSON, fixed key order, one trailing newline. */
      artifactJson: string;
      /** Degradations from THIS run's execution (analyzer crashes, coverage
       * gaps) — excludes the always-present ledger/corpus sentinels, so the
       * baseline pre-1.8 state does not flag every run as degraded. */
      runDegraded: Degradation[];
      degradedRun: boolean;
    };

export interface RunReviewOptions {
  cwd: string;
  /** Test seam; defaults to the registered deterministic analyzers. */
  analyzers?: readonly Analyzer[];
}

export async function runReview(options: RunReviewOptions): Promise<ReviewRunResult> {
  // ---- Phase 0: preflight -------------------------------------------------
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
  const changed = uncommittedFiles(options.cwd);
  if (!changed.ok) return { ok: false, code: "preflight", message: changed.reason };

  // The engine's own output directory is never part of the reviewed change
  // set (a written artifact must not change the next run's identity).
  const candidates = changed.value.filter((f) => !f.startsWith("_agentic-guardrails/"));

  // Content hashes are computed ONCE, here, before any analyzer runs — the
  // same snapshot feeds analysis and the runId (no analyze/hash race). A
  // candidate absent from disk is a deleted uncommitted file: excluded from
  // analysis, carried on the artifact, never a degradation (deletion is not
  // coverage loss).
  const changedFiles: string[] = [];
  const deletedFiles: string[] = [];
  const fileHashes: [string, string][] = [];
  for (const file of candidates) {
    let contentHash: string;
    try {
      contentHash = createHash("sha256")
        .update(readFileSync(path.join(root.value, file)))
        .digest("hex");
    } catch {
      deletedFiles.push(file);
      continue;
    }
    changedFiles.push(file);
    fileHashes.push([file, contentHash]);
  }

  const analyzableFiles = changedFiles.filter(isAnalyzableTs);
  const discovery =
    analyzableFiles.length > 0
      ? discoverTsconfigs(root.value)
      : { tsconfigPaths: [], degraded: [] };
  const context: AnalyzerContext = {
    repoRoot: root.value,
    changedFiles: analyzableFiles,
    tsconfigPaths: discovery.tsconfigPaths,
  };

  // ---- Phase 1: deterministic tier (per-axiom isolation) ------------------
  const analyzers = options.analyzers ?? DEFAULT_ANALYZERS;
  const results = await pMap(
    analyzers,
    async (analyzer): Promise<AnalyzerResult> => {
      try {
        return await analyzer.run(context);
      } catch (error) {
        // Isolation: one axiom crashing degrades the manifest, never the run.
        const message = error instanceof Error ? error.message : String(error);
        return {
          findings: [],
          degraded: [{ reason: `analyzer crashed: ${message}`, subject: `axiom-${analyzer.axiom}` }],
        };
      }
    },
    // SPIKE-3 (docs/spikes/SPIKE-3-import-graph-cost.md): sweep {2,4,8} was
    // flat — today's analyzers are synchronous CPU-bound, so the bound is
    // provisional by construction; 4 kept as the cap for when 1.9 registers
    // genuinely async analyzers. Revisit if analyzers move to workers.
    { concurrency: 4 },
  );

  const findings: Finding[] = [];
  const runDegraded: Degradation[] = [...discovery.degraded];
  for (const result of results) {
    findings.push(...result.findings);
    runDegraded.push(...result.degraded);
  }

  // ---- Phase 4: aggregation (sort only; merge/dedupe is 1.9) --------------
  findings.sort(byFileLineAxiom);
  runDegraded.sort((a, b) => compare(a.subject, b.subject) || compare(a.reason, b.reason));

  // ---- Phase 5: composition -----------------------------------------------
  const { manifest, degraded: sentinelDegraded } = buildRunManifest();
  const artifact: ReviewArtifact = {
    schemaVersion: 1,
    runId: computeRunId(root.value, fileHashes, deletedFiles),
    scope: "uncommitted",
    changedFiles,
    deletedFiles,
    findings,
    degraded: [...sentinelDegraded, ...runDegraded],
    manifest,
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
  return {
    ok: true,
    repoRoot: root.value,
    artifact,
    artifactJson: `${JSON.stringify(artifact, null, 2)}\n`,
    runDegraded,
    degradedRun: runDegraded.length > 0,
  };
}

/** Analyzable change-set membership: runtime TS sources only — `.d.ts`
 * (and `.d.mts`/`.d.cts`) declarations carry no runtime imports. */
function isAnalyzableTs(file: string): boolean {
  if (/\.d\.(ts|mts|cts)$/.test(file)) return false;
  return /\.(ts|tsx|mts|cts)$/.test(file);
}

interface TsconfigDiscovery {
  tsconfigPaths: string[];
  degraded: Degradation[];
}

/**
 * Root tsconfig discovery. A solution-style root (no/empty `files` and
 * `include`, non-empty `references`) contains no sources itself — each
 * referenced project's tsconfig is resolved and analyzed instead, and the
 * per-project graphs are merged downstream. A missing root tsconfig is a
 * typed degradation, never a throw.
 */
function discoverTsconfigs(root: string): TsconfigDiscovery {
  const rootTsconfig = path.join(root, "tsconfig.json");
  if (!existsSync(rootTsconfig)) {
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
    if (existsSync(refPath)) {
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
 * Run identity = sha256 over (scope, HEAD sha — empty-tree sentinel before
 * the first commit — sorted changed paths + their content hashes as snapped
 * before phase 1, deleted uncommitted paths, root tsconfig content hash,
 * ruleset version, engine version), truncated to 16 hex chars. No wall
 * clock — identical input re-runs overwrite the same artifact file.
 */
function computeRunId(
  root: string,
  fileHashes: readonly (readonly [string, string])[],
  deletedFiles: readonly string[],
): string {
  let tsconfigHash: string;
  try {
    tsconfigHash = createHash("sha256")
      .update(readFileSync(path.join(root, "tsconfig.json")))
      .digest("hex");
  } catch {
    tsconfigHash = "absent";
  }
  return createHash("sha256")
    .update(
      JSON.stringify([
        "uncommitted",
        headSha(root),
        fileHashes,
        deletedFiles,
        tsconfigHash,
        RULESET_VERSION,
        ENGINE_VERSION,
      ]),
    )
    .digest("hex")
    .slice(0, 16);
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
