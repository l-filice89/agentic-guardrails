/**
 * SPIKE-3 benchmark harness (Story 1.5): import-graph cost at scale.
 *
 *   node scripts/spike-3-benchmark.mjs
 *
 * Generates synthetic repos (10k + 1k files, seeded — see
 * spike-3-generate-repo.mjs) in OS temp, then measures:
 *   (a) 10k cold + warm graph builds ×RUNS, each cold run in a fresh child
 *       process (true cold), peak RSS via process.resourceUsage().maxRSS;
 *   (b) concurrency sweep: the 10k repo partitioned into 8 shard tsconfigs
 *       built through a bounded async pool at bounds {2,4,8} ×RUNS;
 *   (c) the REAL `runReview` on the 1k git repo (one uncommitted changed
 *       file that participates in the seeded cycle) ×RUNS — the <60s gate;
 *   (d) correctness: FULL bidirectional set equality between the seeded
 *       ground-truth edge set and the built 10k graph (missing + spurious
 *       reported separately).
 *
 * Prints per-run numbers + medians; exits non-zero if the 60s gate fails
 * (max of runs vs 60s), any edge asymmetry exists, coverage < 1, any
 * degradation occurs, or warm/cold edge counts diverge. Results are
 * transcribed into docs/spikes/SPIKE-3-import-graph-cost.md.
 *
 * Env overrides (probing only): SPIKE3_10K, SPIKE3_1K, SPIKE3_RUNS.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEED = 20260724;

/** Env overrides (probing only) — validated so a typo fails loudly. */
function envInt(name, fallback, min) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    console.error(`SPIKE-3: ${name}=${JSON.stringify(raw)} is invalid — must be an integer >= ${min}.`);
    process.exit(1);
  }
  return n;
}
const FILES_10K = envInt("SPIKE3_10K", 10000, 2);
const FILES_1K = envInt("SPIKE3_1K", 1000, 2);
const RUNS = envInt("SPIKE3_RUNS", 3, 1);
const SWEEP_BOUNDS = [2, 4, 8];
const GATE_MS = 60_000;
const SELF = fileURLToPath(import.meta.url);

const corePath = new URL("../packages/core/dist/index.js", import.meta.url).href;

/** Minimal bounded async pool (p-map lives in core's node_modules, not
 * resolvable from scripts/ under pnpm — 12 lines beats a dependency). */
async function boundedMap(items, mapper, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await mapper(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

/** Explicit tuple key — never JSON.stringify of edge objects (key-order fragile). */
const edgeKey = (e) => `${e.from}|${e.to}|${e.dynamic}|${e.typeOnly}|${e.reExport}`;

const maxRssMb = () => Math.round(process.resourceUsage().maxRSS / 1024);
const ms = (t) => Math.round(t);

// ---------------------------------------------------------------------------
// Child mode: one measurement per fresh process; prints one JSON line.
// ---------------------------------------------------------------------------
async function childMain(config) {
  const core = await import(corePath);
  const adapter = new core.TypeScriptAdapter();

  if (config.task === "graph") {
    const tsconfigPath = path.join(config.repo, "tsconfig.json");
    const t0 = performance.now();
    const cold = adapter.buildImportGraph({ tsconfigPath, rootDir: config.repo });
    const coldMs = performance.now() - t0;
    const t1 = performance.now();
    const warm = adapter.buildImportGraph({ tsconfigPath, rootDir: config.repo });
    const warmMs = performance.now() - t1;

    // Full bidirectional set equality vs seeded ground truth.
    let equality = null;
    if (config.equality) {
      const meta = JSON.parse(fs.readFileSync(path.join(config.repo, "spike-meta.json"), "utf8"));
      const truth = new Set(meta.edges.map(edgeKey));
      const built = new Set([...cold.data.edges].map(edgeKey));
      const missing = [...truth].filter((k) => !built.has(k));
      const spurious = [...built].filter((k) => !truth.has(k));
      equality = { truthCount: truth.size, builtCount: built.size, missing, spurious };
    }
    return {
      coldMs: ms(coldMs), warmMs: ms(warmMs), maxRssMb: maxRssMb(),
      nodes: [...cold.data.nodes].length, edges: [...cold.data.edges].length,
      coverage: cold.coverage, degraded: cold.degraded.length,
      warmEdges: [...warm.data.edges].length, equality,
    };
  }

  if (config.task === "sweep") {
    const t0 = performance.now();
    const results = await boundedMap(
      config.shards,
      async (shard) =>
        adapter.buildImportGraph({ tsconfigPath: path.join(config.repo, shard), rootDir: config.repo }),
      config.bound,
    );
    const totalMs = performance.now() - t0;
    const edges = results.reduce((n, r) => n + [...r.data.edges].length, 0);
    return { totalMs: ms(totalMs), maxRssMb: maxRssMb(), edges };
  }

  if (config.task === "pipeline") {
    const t0 = performance.now();
    const result = await core.runReview({ cwd: config.repo });
    const totalMs = performance.now() - t0;
    if (!result.ok) return { totalMs: ms(totalMs), maxRssMb: maxRssMb(), ok: false, message: result.message };
    return {
      totalMs: ms(totalMs), maxRssMb: maxRssMb(), ok: true,
      findings: result.artifact.findings.map((f) => ({ ruleId: f.ruleId, file: f.location.file })),
      degradedRun: result.degradedRun,
    };
  }

  throw new Error(`unknown task: ${config.task}`);
}

// ---------------------------------------------------------------------------
// Parent mode: orchestration.
// ---------------------------------------------------------------------------
function runChild(config) {
  const out = execFileSync(
    process.execPath,
    ["--max-old-space-size=8192", SELF, "--child", JSON.stringify(config)],
    { stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
  );
  const lines = out.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const spread = (xs) => `${Math.min(...xs)}..${Math.max(...xs)}`;
const sec = (m) => (m / 1000).toFixed(1);

function git(repo, ...args) {
  // stderr ignored: `git add` CRLF warnings on win32 are noise here.
  execFileSync("git", args, { cwd: repo, stdio: "ignore" });
}

async function main() {
  const { generateRepo } = await import(new URL("./spike-3-generate-repo.mjs", import.meta.url).href);
  console.log(`SPIKE-3 benchmark — ${new Date().toISOString()}`);
  console.log(
    `hardware: ${os.cpus()[0].model} | ${os.cpus().length} logical cores | ` +
      `${(os.totalmem() / 2 ** 30).toFixed(1)} GB RAM | node ${process.version} | ${process.platform}`,
  );
  console.log(`config: 10k=${FILES_10K} files, 1k=${FILES_1K} files, runs=${RUNS}, seed=${SEED}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spike3-"));
  let failed = false;
  try {
    console.log(`temp: ${tmp}`);
    const repo10k = path.join(tmp, "repo-10k");
    const repo1k = path.join(tmp, "repo-1k");
    const meta10k = generateRepo(repo10k, { fileCount: FILES_10K, seed: SEED, shards: 8 });
    const meta1k = generateRepo(repo1k, { fileCount: FILES_1K, seed: SEED + 1, cycle: true });
    console.log(`generated: 10k (${meta10k.edges.length} ground-truth edges), 1k (cycle: ${meta1k.cycle.join(" <-> ")})`);

    // 1k pipeline repo: committed baseline + ONE uncommitted changed file
    // that is a member of the seeded cycle (runReview reviews uncommitted).
    git(repo1k, "init", "-q");
    git(repo1k, "add", "-A");
    git(repo1k, "-c", "user.name=spike3", "-c", "user.email=spike3@local", "commit", "-q", "-m", "baseline");
    fs.appendFileSync(path.join(repo1k, meta1k.cycle[1]), "// spike-3 touched\n");

    // (a) 10k cold/warm ×RUNS + (d) full set-equality correctness on run 1
    const graphRuns = [];
    for (let i = 0; i < RUNS; i++) {
      console.log(`\n[10k graph] run ${i + 1}/${RUNS} ...`);
      const r = runChild({ task: "graph", repo: repo10k, equality: i === 0 });
      graphRuns.push(r);
      console.log(`  cold ${sec(r.coldMs)}s  warm ${sec(r.warmMs)}s  peakRSS ${r.maxRssMb} MB  nodes ${r.nodes}  edges ${r.edges}  coverage ${r.coverage}  degraded ${r.degraded}`);
      if (r.coverage !== 1 || r.degraded > 0 || r.nodes !== FILES_10K) {
        failed = true;
        console.error(`  FAIL (graph soundness): coverage ${r.coverage} (want 1), degraded ${r.degraded} (want 0), nodes ${r.nodes} (want ${FILES_10K})`);
      }
      if (r.warmEdges !== r.edges) {
        failed = true;
        console.error(`  FAIL (determinism): warm edges ${r.warmEdges} !== cold edges ${r.edges}`);
      }
      if (r.equality) {
        const q = r.equality;
        console.log(`  correctness: ${q.truthCount} ground-truth vs ${q.builtCount} built edges — ${q.missing.length} missing, ${q.spurious.length} spurious`);
        if (q.missing.length > 0 || q.spurious.length > 0) {
          failed = true;
          console.error(`  FAIL (correctness): missing ${JSON.stringify(q.missing.slice(0, 5))} spurious ${JSON.stringify(q.spurious.slice(0, 5))}`);
        }
      }
    }

    // (b) concurrency sweep {2,4,8} ×RUNS over the 8-shard build
    const sweepRuns = {};
    for (const bound of SWEEP_BOUNDS) {
      sweepRuns[bound] = [];
      for (let i = 0; i < RUNS; i++) {
        console.log(`\n[sweep bound=${bound}] run ${i + 1}/${RUNS} ...`);
        const r = runChild({ task: "sweep", repo: repo10k, shards: meta10k.shardTsconfigs, bound });
        sweepRuns[bound].push(r);
        console.log(`  total ${sec(r.totalMs)}s  peakRSS ${r.maxRssMb} MB  edges ${r.edges}`);
      }
    }

    // (c) 1k full pipeline ×RUNS — the hard gate
    const pipelineRuns = [];
    let gateFailed = false;
    for (let i = 0; i < RUNS; i++) {
      console.log(`\n[1k pipeline] run ${i + 1}/${RUNS} ...`);
      const r = runChild({ task: "pipeline", repo: repo1k });
      pipelineRuns.push(r);
      if (!r.ok) {
        gateFailed = true;
        console.error(`  GATE FAIL: runReview failed: ${r.message}`);
        continue;
      }
      console.log(`  total ${sec(r.totalMs)}s  peakRSS ${r.maxRssMb} MB  findings ${r.findings.length}  degradedRun ${r.degradedRun}`);
      if (r.degradedRun) {
        gateFailed = true;
        console.error(`  GATE FAIL: degraded run`);
      }
      const hasCycleFinding = r.findings.some(
        (f) => f.ruleId === "structural/circular-import" && meta1k.cycle.includes(f.file),
      );
      if (!hasCycleFinding) {
        gateFailed = true;
        console.error(`  GATE FAIL (findings): seeded cycle not reported; findings: ${JSON.stringify(r.findings)}`);
      }
    }

    // ---- summary ----
    const cold = graphRuns.map((r) => r.coldMs);
    const warm = graphRuns.map((r) => r.warmMs);
    const rss = graphRuns.map((r) => r.maxRssMb);
    const pipe = pipelineRuns.filter((r) => r.ok).map((r) => r.totalMs);
    console.log("\n================ RESULTS ================");
    console.log(`10k cold build   : median ${sec(median(cold))}s  (runs ms: ${cold.join(", ")})`);
    console.log(`10k warm rebuild : median ${sec(median(warm))}s  (runs ms: ${warm.join(", ")})`);
    console.log(`10k peak RSS     : median ${median(rss)} MB  (runs MB: ${rss.join(", ")})`);
    console.log(`warm budget      : ceil(median warm x 1.5) = ${Math.ceil((median(warm) * 1.5) / 1000)}s`);
    for (const bound of SWEEP_BOUNDS) {
      const t = sweepRuns[bound].map((r) => r.totalMs);
      console.log(`sweep bound=${bound}    : median ${sec(median(t))}s  (runs ms: ${t.join(", ")})`);
    }
    console.log(`1k pipeline      : median ${pipe.length > 0 ? sec(median(pipe)) : "n/a"}s  (runs ms: ${pipe.join(", ")})  spread ${pipe.length > 0 ? spread(pipe) : "n/a"}`);

    // Gate: MAX of runs vs 60s (worst case, not median); any degraded run or
    // missing cycle finding already flipped gateFailed above.
    if (pipe.length !== pipelineRuns.length || pipe.length === 0 || Math.max(...pipe, 0) >= GATE_MS) {
      gateFailed = true;
    }
    if (gateFailed) failed = true;
    // Never print "GATE: PASS" alongside an overall FAIL.
    const gatePass = !gateFailed && !failed;
    console.log(`\nGATE (<60s 1k pipeline, max of ${RUNS} runs${pipe.length > 0 ? ` = ${sec(Math.max(...pipe))}s` : ""}): ${gatePass ? "PASS" : "FAIL"}`);
    if (failed) console.error("SPIKE-3: FAILED — see above.");
  } finally {
    console.log("\ncleaning up temp ...");
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
    } catch (error) {
      // Cleanup failure leaks a temp dir but never changes the exit code.
      console.error(`cleanup failed, leaked temp path: ${tmp} (${error.message})`);
    }
  }
  process.exitCode = failed ? 1 : 0;
}

const childIndex = process.argv.indexOf("--child");
if (childIndex !== -1) {
  childMain(JSON.parse(process.argv[childIndex + 1])).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
} else {
  await main();
}
