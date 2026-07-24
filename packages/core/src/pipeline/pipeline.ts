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
  reviewArtifactSchema,
  type Degradation,
  type Finding,
  type ReviewArtifact,
  type RunManifest,
} from "@agentic-guardrails/contracts";
import pMap from "p-map";
import { ts } from "ts-morph";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { importGraphDataSchema, type ImportGraphBuildResult } from "../adapter/language-adapter.js";
import { axiom1Structural } from "../analyzers/axiom1-structural.js";
import { DeterministicCache, loadCacheSecret } from "../cache/deterministic-cache.js";
import { evaluateGate, loadConfig, type GateResult } from "../config/config-loader.js";
import { fileGitStatus, headSha, repoRoot, uncommittedFiles } from "../git/git.js";
import { ImportGraph } from "../graph/import-graph.js";
import { checkGitWiring } from "../init/wiring.js";
import {
  ABSENT_SHA256,
  buildRunManifest,
  ENGINE_VERSION,
  numericCompare,
  RULESET_VERSION,
} from "./manifest.js";
import { mergeFindings } from "./merge.js";

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
});

/** Cached serialized import-graph build result (per tsconfig). */
const cachedGraphSchema = z.strictObject({
  data: importGraphDataSchema,
  coverage: z.number().min(0).max(1),
  attempted: z.int().min(0),
  unresolved: z.int().min(0),
  degraded: z.array(degradationSchema),
});

/** Content-addressed graph cache seam (1.7): graph-building analyzers route
 * builds through this so unchanged inputs skip the parse entirely (SPIKE-3's
 * recorded reuse win). `get` returning undefined = miss → build + `put`. */
export interface GraphCache {
  get(tsconfigPath: string): ImportGraphBuildResult | undefined;
  put(tsconfigPath: string, result: ImportGraphBuildResult): void;
}

export interface AnalyzerContext {
  /** Absolute repo root (as git reports it). */
  repoRoot: string;
  /** Changed analyzable TS files (present on disk), repo-root-relative,
   * `/`-separated, sorted. */
  changedFiles: readonly string[];
  /** Leaf tsconfigs to analyze: the root tsconfig itself, or — for a
   * solution-style root — each referenced project's tsconfig. */
  tsconfigPaths: readonly string[];
  /** Optional (absent in bare unit-test contexts): the content-addressed
   * graph cache the pipeline wires in. */
  graphCache?: GraphCache;
  /** The phase-1 budget's abort signal, so analyzers CAN observe
   * cancellation. Honest caveat: current analyzers are synchronous and only
   * check between units — an in-flight unit runs to completion. */
  signal?: AbortSignal;
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

/** Axiom ids the pipeline treats as known BEYOND the registered analyzers:
 * axiom 5 (security) is configurable before its analyzer lands (Epic 3).
 * Single source for the unknown-axiom warning and the init questionnaire. */
export const ANALYZERLESS_KNOWN_AXIOMS: readonly string[] = ["5"];

/** Two analyzers registered for one axiom would silently clobber each other
 * in the per-axiom result map — a caller bug, rejected loudly and typed. */
export class DuplicateAnalyzerError extends Error {
  constructor(axiom: string) {
    super(`duplicate analyzer registration for axiom ${JSON.stringify(axiom)}`);
    this.name = "DuplicateAnalyzerError";
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
       * gaps) — excludes the always-present ledger/corpus sentinels, so the
       * baseline pre-1.8 state does not flag every run as degraded. */
      runDegraded: Degradation[];
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
    };

export interface RunReviewOptions {
  cwd: string;
  /** Test seam; defaults to the registered deterministic analyzers. */
  analyzers?: readonly Analyzer[];
  /** Test seam; defaults to PHASE1_BUDGET_MS. */
  phase1BudgetMs?: number;
  /** Test seam; defaults to `~/.agentic-guardrails/cache-secret`. */
  cacheSecretPath?: string;
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

  // Config plane (1.6): the ONLY config read in the pipeline. An invalid
  // config is a typed failure (exit 2 at the CLI) — never a silent fallback.
  const loaded = loadConfig(root.value);
  if (!loaded.ok) return { ok: false, code: "config", message: loaded.message };
  const config = loaded.config;

  // Preflight git-wiring check (1.8): warnings naming the consequence when
  // an initialized repo lost its `.gitattributes`/`.gitignore` lines —
  // never exit 2, and silent for an uninitialized repo (no folder).
  const wiringWarnings = checkGitWiring(root.value);

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
  const cacheRoot = path.join(root.value, "_agentic-guardrails", ".cache");
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
      const key = computeGraphKey(root.value, tsconfigPath);
      if (key === undefined) {
        cacheDisabled = `cache key not computable for ${path.relative(root.value, tsconfigPath).replaceAll("\\", "/")} (unresolvable or unreadable inputs)`;
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
  const graphCache: GraphCache = {
    get(tsconfigPath) {
      const key = graphKeys.get(tsconfigPath);
      if (key === undefined || cache === undefined) return undefined;
      const read = cache.get("graph", key, cachedGraphSchema);
      if (read.hit) {
        cacheStats.hits += 1;
        return {
          data: new ImportGraph(read.value.data.nodes, read.value.data.edges),
          coverage: read.value.coverage,
          attempted: read.value.attempted,
          unresolved: read.value.unresolved,
          degraded: read.value.degraded,
        };
      }
      if (read.invalid) {
        cacheStats.invalid += 1;
        cacheDegraded.push({
          reason: "invalid cache entry (recomputed and overwritten)",
          subject: `cache/graph/${path.relative(root.value, tsconfigPath).replaceAll("\\", "/")}`,
        });
      } else {
        cacheStats.misses += 1;
      }
      return undefined;
    },
    put(tsconfigPath, result) {
      const key = graphKeys.get(tsconfigPath);
      if (key === undefined || cache === undefined) return;
      // Cache hygiene (P2): never persist post-abort work, and never let a
      // degraded partial become a future "clean" hit.
      if (controller.signal.aborted || result.degraded.length > 0) return;
      cache.put("graph", key, {
        data: result.data.toJSON(),
        coverage: result.coverage,
        attempted: result.attempted,
        unresolved: result.unresolved,
        degraded: result.degraded,
      });
    },
  };
  // Findings key (per axiom): graph keys + analyzable change hashes + scope
  // + ruleset/engine/TypeScript versions + tier enablement. Config
  // enforcement is NOT in the key on purpose — it never changes what an
  // analyzer computes (off-axioms are excluded at membership level, gating
  // happens later). The TypeScript version is a toolchain input: an upgrade
  // can change parse output, so it must invalidate.
  const findingsKeyFor = (axiom: string): string | undefined => {
    if (cacheDisabled !== undefined) return undefined;
    return createHash("sha256")
      .update(
        JSON.stringify([
          "findings",
          axiom,
          analyzableHashes,
          [...graphKeys.values()].sort(),
          "uncommitted",
          RULESET_VERSION,
          ENGINE_VERSION,
          ts.version,
          { deterministic: true, llm: false },
        ]),
      )
      .digest("hex");
  };

  const context: AnalyzerContext = {
    repoRoot: root.value,
    changedFiles: analyzableFiles,
    tsconfigPaths: discovery.tsconfigPaths,
    graphCache,
    signal: controller.signal,
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
  const runDegraded: Degradation[] = [...discovery.degraded];
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
    runDegraded.push(...result.degraded);
  }
  runDegraded.push(...cacheDegraded);

  // Manifest truth (1.8): committed knowledge files hash their real bytes;
  // an absent file keeps the sentinel + its "absent until init" declaration
  // (excluded from runDegraded — see ReviewRunResult.runDegraded); a
  // present-but-unreadable or present-but-invalid file is a REAL
  // degradation counted toward the exit-2 logic.
  const ledger = hashKnowledgeFile(
    root.value,
    "_agentic-guardrails/conventions.yaml",
    conventionsFileSchema,
    "ledger",
  );
  const corpus = hashKnowledgeFile(
    root.value,
    "_agentic-guardrails/corpus-map.yaml",
    corpusMapFileSchema,
    "corpus",
  );
  if (ledger.degradation !== undefined) runDegraded.push(ledger.degradation);
  if (corpus.degradation !== undefined) runDegraded.push(corpus.degradation);

  // ---- Phase 4: aggregation (FR-21 merge, then deterministic sort) --------
  const merged = mergeFindings(findings);
  merged.sort(byFileLineAxiom);
  runDegraded.sort((a, b) => compare(a.subject, b.subject) || compare(a.reason, b.reason));

  // ---- Phase 5: composition -----------------------------------------------
  // Config-plane visibility: warnings (never degradations, never exit 2).
  const knownAxioms = new Set([...registered.map((a) => a.axiom), ...ANALYZERLESS_KNOWN_AXIOMS]);
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
    const status = fileGitStatus(root.value, "_agentic-guardrails/config.yaml");
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

  const gate = evaluateGate(
    merged,
    config,
    analyzers.map((a) => a.axiom),
  );

  // Declared assembly: six phases always, membership derived from
  // scope/mode/config (off-axioms shrink phase 1), empty phases say why.
  const phases: RunManifest["phases"] = [
    { phase: 0, members: ["preflight"], ran: true },
    {
      phase: 1,
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
    { phase: 2, members: [], ran: false, reason: "SDD gate — empty membership until Epic 2" },
    { phase: 3, members: [], ran: false, reason: "LLM enrichment — empty membership until Epic 3" },
    { phase: 4, members: ["merge", "sort"], ran: true },
    { phase: 5, members: ["compose"], ran: true },
  ];

  const { manifest, degraded: sentinelDegraded } = buildRunManifest({
    axiomsOff,
    ...(ledger.hash === undefined ? {} : { ledgerHash: ledger.hash }),
    ...(corpus.hash === undefined ? {} : { corpusHash: corpus.hash }),
    configHash: loaded.configHash,
    configPresent: loaded.configPresent,
    enforcement,
    configGitStatus,
    phases,
    // Snapshot COPY, never the live counter object — nothing may mutate the
    // manifest's cache truth after composition.
    cache: {
      ...cacheStats,
      ...(cacheDisabled === undefined ? {} : { disabled: cacheDisabled }),
    },
  });
  const artifact: ReviewArtifact = {
    schemaVersion: 1,
    runId: computeRunId(root.value, fileHashes, deletedFiles, loaded.configHash),
    scope: "uncommitted",
    changedFiles,
    deletedFiles,
    findings: merged,
    degraded: [...sentinelDegraded, ...runDegraded],
    manifest,
    gate,
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
    gate,
    configPresent: loaded.configPresent,
    deviations: loaded.deviations,
    configWarnings,
    wiringWarnings,
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
 * config.yaml content hash — literal "absent" sentinel when absent — ruleset
 * version, engine version), truncated to 16 hex chars. No wall clock —
 * identical input re-runs overwrite the same artifact file.
 */
function computeRunId(
  root: string,
  fileHashes: readonly (readonly [string, string])[],
  deletedFiles: readonly string[],
  configHash: string,
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
        configHash,
        RULESET_VERSION,
        ENGINE_VERSION,
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
 * Exported for the key-invalidation tests; `tsVersion` is their seam.
 */
export function computeGraphKey(
  root: string,
  tsconfigPath: string,
  tsVersion: string = ts.version,
): string | undefined {
  try {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      tsconfigPath,
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
    );
    if (parsed === undefined) return undefined;
    const tsconfigHash = createHash("sha256").update(readFileSync(tsconfigPath)).digest("hex");
    const files = [...parsed.fileNames].sort().map((file) => {
      // An unreadable participant makes the key undefined — a declared
      // disable, never an "unreadable" sentinel masquerading as content.
      const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
      return [path.relative(root, file).replaceAll("\\", "/"), hash];
    });
    return createHash("sha256")
      .update(JSON.stringify(["graph", tsconfigHash, files, ENGINE_VERSION, tsVersion]))
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
