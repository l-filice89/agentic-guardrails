/**
 * SPIKE-1 harness (Story 1.19): structured-output prototype — the M1 signal.
 *
 *   pnpm -r build && node scripts/spike-1-structured-output.mjs --self-test
 *   node scripts/spike-1-structured-output.mjs --max 10   # resumable batches
 *   node scripts/spike-1-structured-output.mjs --summary
 *
 * Measures the real parse-failure rate of the ADR-001 `<axiom>.in`/`.out`
 * envelope over 50 genuine headless IDE invocations (`claude -p` driving the
 * throwaway `/spike-1-handshake` skill) against a deterministic sample of this
 * repo's own `.ts` files (sorted `git ls-files`, evenly spaced — no
 * randomness, no synthetic payloads).
 *
 * Handshake (file transport, ADR-001 interactive):
 *   harness writes `<dir>/spike1.in.json` → `claude -p "/spike-1-handshake
 *   <dir>"` → skill writes `spike1.out.json` via temp file + atomic rename.
 *   The rename IS the completion signal: the harness only ever reads
 *   `spike1.out.json`, never a temp file. Missing out-file at timeout,
 *   malformed JSON, and schema-fail all count as raw failures.
 *
 * Repair ladder (per sample, ≤3 invocations total):
 *   1 base → 2 correction retry (fresh invocation, safeParse issues appended
 *   to the `.in` payload) → 3 repair (final invocation presenting the invalid
 *   output + issues, asking only for corrected JSON).
 *
 * Results append idempotently (per sample index) to
 * docs/spikes/SPIKE-1-results.json so the run is resumable/chunked.
 *
 * `--self-test` is the stub-invoker mode: no LLM, canned outcomes for all
 * five classes (valid / invalid-JSON / schema-fail / missing-file /
 * torn-temp), asserting each is classified correctly — it runs BEFORE any
 * paid invocation, because the signal is only as trustworthy as the counter.
 *
 * Throwaway by contract: this file and the skill are deleted after the
 * write-up; only docs/spikes/ survives.
 */
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const contracts = await import(new URL("../packages/contracts/dist/index.js", import.meta.url).href);
// zod is contracts' dependency; resolve it from there (pnpm strict layout).
const require_ = createRequire(new URL("../packages/contracts/package.json", import.meta.url));
const { z } = require_("zod");

const AXIOM = "spike1";
const SAMPLES = 50;
const MAX_ATTEMPTS = 3; // base + correction retry + repair
const TIMEOUT_MS = 180_000; // per invocation — generous but finite
const CONTENT_CAP = 4000; // chars of file content shipped per .in payload
const RESULTS_PATH = path.join(ROOT, "docs", "spikes", "SPIKE-1-results.json");
const HANDSHAKE_ROOT = path.join(ROOT, "_agentic-guardrails", ".cache", "handshake");

// ---------------------------------------------------------------------------
// The envelope pair — via the shipped factory, mirroring ADR-001's carried
// fields (the concrete pair lives HERE, not in contracts).
// ---------------------------------------------------------------------------

const inSchema = z
  .strictObject({
    channel: z.literal(`${AXIOM}.in`),
    axiom: z.literal(AXIOM),
    attempt: z.enum(["base", "correction-retry", "repair"]),
    file: z.string().min(1),
    language: z.literal("typescript"),
    content: z.string(),
    contentTruncated: z.boolean(),
    task: z.string().min(1),
    priorIssues: z.array(z.string()).optional(),
    invalidOutput: z.string().optional(),
  })
  .refine((p) => p.attempt === "base" || (p.priorIssues?.length ?? 0) > 0, {
    message: "retry/repair payloads carry the prior issues",
  });

// The carried finding shape is the SHIPPED contracts findingSchema —
// realistic, not toy: tier/source/severity/findingId/confidence/exemplar/
// enclosingSymbol/degraded all cross the boundary and are all validated.
const outSchema = z
  .strictObject({
    channel: z.literal(`${AXIOM}.out`),
    axiom: z.literal(AXIOM),
    findings: z.array(contracts.findingSchema).min(1),
    coverage: z.number().min(0).max(1),
    degraded: z.array(contracts.degradationSchema),
  })
  .refine((r) => r.coverage === 1 || r.degraded.length > 0, {
    message: "coverage < 1 requires at least one typed degradation entry",
  });

const envelope = contracts.axiomEnvelope(AXIOM, inSchema, outSchema);

/** The output contract, stated to the model inside the .in payload. */
const TASK = [
  `Review the TypeScript source in "content" (path in "file") and produce 1-3`,
  `inferred-tier findings (observations about the code: design, clarity, risk).`,
  `Output EXACTLY one JSON object, no prose, matching:`,
  `{`,
  `  "channel": "${AXIOM}.out",`,
  `  "axiom": "${AXIOM}",`,
  `  "findings": [ 1 to 3 items, each EXACTLY these keys (no extras):`,
  `    {`,
  `      "findingId": non-empty string, unique per finding (e.g. "${AXIOM}:<file>:1"),`,
  `      "axiom": "${AXIOM}",`,
  `      "ruleId": non-empty string like "${AXIOM}/observation",`,
  `      "location": { "file": the input file path, "startLine": positive int, "endLine": int >= startLine },`,
  `      "message": non-empty string,`,
  `      "tier": "inferred",`,
  `      "source": "llm",`,
  `      "confidence": number > 0 and <= 1 (your calibrated confidence),`,
  `      "severity": "error" | "warning" | "info",`,
  `      "enclosingSymbol": OPTIONAL non-empty string (the enclosing function/class name),`,
  `      "exemplar": OPTIONAL string (a short verbatim excerpt evidencing the finding)`,
  `    } ],`,
  `  "coverage": 1 (or < 1 ONLY if you could not review everything, in which case`,
  `               "degraded" must be non-empty),`,
  `  "degraded": [] (or [{ "reason": non-empty, "subject": non-empty }, ...])`,
  `}`,
  `Unknown keys anywhere fail validation (strict schemas). No markdown fences in the file.`,
].join("\n");

// ---------------------------------------------------------------------------
// Deterministic sample: sorted repo .ts list, evenly spaced — no randomness.
// ---------------------------------------------------------------------------

function sampleFiles() {
  const all = execFileSync("git", ["ls-files", "-z", "--", "*.ts"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  })
    .split("\0")
    .filter((f) => f.length > 0)
    .sort();
  if (all.length < SAMPLES) throw new Error(`only ${all.length} .ts files in the repo`);
  return Array.from({ length: SAMPLES }, (_, i) => all[Math.floor((i * all.length) / SAMPLES)]);
}

// ---------------------------------------------------------------------------
// Outcome classification — the counter the self-test proves.
// ---------------------------------------------------------------------------

/**
 * Reads ONLY `spike1.out.json` — the atomic-rename completion signal. A temp
 * file (torn write) is never read; it is reported as `missing-file` with
 * `tornTemp: true`.
 */
function classify(dir) {
  const outPath = path.join(dir, `${AXIOM}.out.json`);
  if (!fs.existsSync(outPath)) {
    const tornTemp = fs
      .readdirSync(dir)
      .some((n) => n !== `${AXIOM}.out.json` && n.includes(`${AXIOM}.out.json`));
    return { outcome: "missing-file", tornTemp };
  }
  const raw = fs.readFileSync(outPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { outcome: "invalid-json", issues: [String(error.message)], raw };
  }
  const result = envelope.out.schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { outcome: "schema-fail", issues, raw };
  }
  return { outcome: "valid", findings: result.data.findings.length };
}

// ---------------------------------------------------------------------------
// The real invoker: one headless `claude -p` per attempt.
// ---------------------------------------------------------------------------

function cleanEnv() {
  const env = { ...process.env };
  // A nested headless session must not inherit the parent IDE session's state.
  for (const key of Object.keys(env)) {
    if (key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE_")) delete env[key];
  }
  return env;
}

async function invokeClaude(dir) {
  const outPath = path.join(dir, `${AXIOM}.out.json`);
  // NO shell: the prompt must reach claude as ONE argv entry. (shell: true
  // concatenates unquoted — the run-dir argument split off the skill prompt
  // and invocations failed with "argument is empty".)
  const child = spawn(
    process.platform === "win32" ? "claude.exe" : "claude",
    [
      "-p",
      `/spike-1-handshake ${dir}`,
      "--allowedTools",
      "Read,Write,Bash(mv:*)",
      "--strict-mcp-config",
    ],
    { cwd: ROOT, env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (d) => (stderr += d));
  child.stdout.on("data", (d) => (stdout += d));
  let exited = false;
  child.on("exit", () => (exited = true));

  const deadline = Date.now() + TIMEOUT_MS;
  // The rename is the ONLY completion signal; child exit just ends the wait.
  while (Date.now() < deadline) {
    if (fs.existsSync(outPath) || exited) break;
    await sleep(500);
  }
  if (!exited) {
    child.kill();
    // give the kill a moment so a torn temp is observable, not racing.
    await sleep(1000);
  }
  if (!fs.existsSync(outPath)) {
    // A missing out-file with no transcript is undiagnosable — keep the tail.
    console.error(`  claude stdout: ${stdout.trim().slice(-400)}`);
    if (stderr.trim().length > 0) console.error(`  claude stderr: ${stderr.trim().slice(-400)}`);
  }
}

// ---------------------------------------------------------------------------
// Per-sample ladder.
// ---------------------------------------------------------------------------

function writeIn(dir, payload) {
  const checked = envelope.in.schema.parse(payload); // our own side is validated too
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${AXIOM}.in.json.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(checked, null, 2));
  fs.renameSync(tmp, path.join(dir, `${AXIOM}.in.json`));
}

function basePayload(file) {
  const full = fs.readFileSync(path.join(ROOT, file), "utf8");
  return {
    channel: `${AXIOM}.in`,
    axiom: AXIOM,
    attempt: "base",
    file,
    language: "typescript",
    content: full.slice(0, CONTENT_CAP),
    contentTruncated: full.length > CONTENT_CAP,
    task: TASK,
  };
}

async function runSample(runId, index, file, invoke) {
  const attempts = [];
  const base = basePayload(file);
  let payload = base;
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    const stage = n === 1 ? "base" : n === 2 ? "correction-retry" : "repair";
    const dir = path.join(HANDSHAKE_ROOT, runId, `s${String(index).padStart(2, "0")}-a${n}`);
    writeIn(dir, payload);
    const t0 = performance.now();
    await invoke(dir, stage);
    const outcome = classify(dir);
    attempts.push({ n, stage, ms: Math.round(performance.now() - t0), ...outcome, raw: undefined,
      rawBytes: outcome.raw === undefined ? undefined : Buffer.byteLength(outcome.raw) });
    console.log(
      `  [${index}] ${file} attempt ${n} (${stage}): ${outcome.outcome}` +
        (outcome.issues ? ` — ${outcome.issues[0]}` : ""),
    );
    if (outcome.outcome === "valid") break;
    const issues = outcome.issues ?? ["no output file was produced before the timeout"];
    payload =
      n === 1
        ? { ...base, attempt: "correction-retry", priorIssues: issues }
        : {
            ...base,
            attempt: "repair",
            priorIssues: issues,
            invalidOutput: (outcome.raw ?? "").slice(0, CONTENT_CAP),
            task: `Your previous output was invalid (see priorIssues and invalidOutput). Respond ONLY with the corrected JSON object.\n\n${TASK}`,
          };
  }
  const last = attempts[attempts.length - 1];
  return {
    index,
    file,
    rawValid: attempts[0].outcome === "valid",
    postRepairValid: last.outcome === "valid",
    attempts,
  };
}

// ---------------------------------------------------------------------------
// Results store — idempotent per sample index, so batches resume.
// ---------------------------------------------------------------------------

function loadResults(files) {
  if (fs.existsSync(RESULTS_PATH)) {
    const r = JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8"));
    if (JSON.stringify(r.files) !== JSON.stringify(files)) {
      throw new Error("results file was recorded against a different sample list");
    }
    return r;
  }
  return {
    spike: "SPIKE-1",
    story: "1.19",
    runId: `spike1-${new Date().toISOString().slice(0, 10)}`,
    startedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${os.release()}`,
    sampleSize: SAMPLES,
    timeoutMs: TIMEOUT_MS,
    files,
    samples: [],
  };
}

function saveResults(results) {
  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  const tmp = `${RESULTS_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(results, null, 2) + "\n");
  fs.renameSync(tmp, RESULTS_PATH);
}

function summarize(results) {
  const done = results.samples;
  const raw = done.filter((s) => s.rawValid).length;
  const post = done.filter((s) => s.postRepairValid).length;
  const bar = Math.ceil(0.98 * SAMPLES);
  console.log(`\nsamples done: ${done.length}/${SAMPLES}`);
  if (done.length > 0) {
    console.log(`raw valid (first attempt): ${raw}/${done.length} (${((100 * raw) / done.length).toFixed(1)}%)`);
    console.log(`post-repair valid (≤3):    ${post}/${done.length} (${((100 * post) / done.length).toFixed(1)}%)`);
  }
  if (done.length === SAMPLES) {
    const verdict = post >= bar ? "PASS" : "FAIL";
    console.log(`bar: ≥${bar}/${SAMPLES} post-repair valid → verdict: ${verdict}`);
    return verdict;
  }
  console.log(`run not complete — no verdict yet (bar is ≥${bar}/${SAMPLES} post-repair).`);
  return undefined;
}

// ---------------------------------------------------------------------------
// Self-test: stub invoker, no LLM. Runs BEFORE any paid invocation.
// ---------------------------------------------------------------------------

function stubValidOut() {
  return {
    channel: `${AXIOM}.out`,
    axiom: AXIOM,
    findings: [
      {
        findingId: `${AXIOM}:stub:1`,
        axiom: AXIOM,
        ruleId: `${AXIOM}/observation`,
        location: { file: "stub.ts", startLine: 1, endLine: 2 },
        message: "stub finding",
        tier: "inferred",
        source: "llm",
        confidence: 0.7,
        severity: "info",
        exemplar: "const x = 1;",
      },
    ],
    coverage: 1,
    degraded: [],
  };
}

async function selfTest() {
  const dirRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spike1-selftest-"));
  const cases = [
    {
      name: "valid",
      write: (d) => {
        // temp → rename, exactly like the skill.
        const tmp = path.join(d, `${AXIOM}.out.json.tmp`);
        fs.writeFileSync(tmp, JSON.stringify(stubValidOut()));
        fs.renameSync(tmp, path.join(d, `${AXIOM}.out.json`));
      },
      expect: "valid",
    },
    {
      name: "invalid-JSON",
      write: (d) => fs.writeFileSync(path.join(d, `${AXIOM}.out.json`), "{not json"),
      expect: "invalid-json",
    },
    {
      name: "schema-fail",
      write: (d) =>
        fs.writeFileSync(
          path.join(d, `${AXIOM}.out.json`),
          JSON.stringify({ ...stubValidOut(), findings: [], extraKey: true }),
        ),
      expect: "schema-fail",
    },
    { name: "missing-file", write: () => {}, expect: "missing-file" },
    {
      name: "torn-temp",
      // a temp file holding PERFECTLY VALID JSON that was never renamed:
      // must be classified missing (never read), with the torn temp reported.
      write: (d) =>
        fs.writeFileSync(path.join(d, `${AXIOM}.out.json.tmp-torn`), JSON.stringify(stubValidOut())),
      expect: "missing-file",
      expectTornTemp: true,
    },
  ];
  let failed = 0;
  for (const c of cases) {
    const d = path.join(dirRoot, c.name);
    fs.mkdirSync(d, { recursive: true });
    c.write(d);
    const got = classify(d);
    const ok = got.outcome === c.expect && (!c.expectTornTemp || got.tornTemp === true);
    if (!ok) failed++;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.name.padEnd(14)} → classified ${got.outcome}` +
        (got.tornTemp !== undefined ? ` (tornTemp: ${got.tornTemp})` : ""),
    );
  }
  // Ladder wiring check (still no LLM): a stub that fails twice then succeeds
  // must land post-repair valid with 3 recorded attempts.
  let calls = 0;
  const flaky = async (dir) => {
    calls++;
    const outPath = path.join(dir, `${AXIOM}.out.json`);
    if (calls === 1) return; // missing-file
    if (calls === 2) return void fs.writeFileSync(outPath, "{not json"); // invalid-json
    const tmp = `${outPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(stubValidOut()));
    fs.renameSync(tmp, outPath);
  };
  const s = await runSample("selftest", 0, "scripts/spike-1-structured-output.mjs", flaky);
  const ladderOk =
    !s.rawValid && s.postRepairValid && s.attempts.length === 3 &&
    s.attempts[1].stage === "correction-retry" && s.attempts[2].stage === "repair";
  if (!ladderOk) failed++;
  console.log(`${ladderOk ? "PASS" : "FAIL"} ladder         → raw-fail ×2 then repair-valid, 3 attempts recorded`);
  fs.rmSync(path.join(HANDSHAKE_ROOT, "selftest"), { recursive: true, force: true });
  fs.rmSync(dirRoot, { recursive: true, force: true });
  console.log(failed === 0 ? "\nSELF-TEST PASS — all five outcome classes + ladder classified correctly" : `\nSELF-TEST FAIL (${failed})`);
  process.exitCode = failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();

  const files = sampleFiles();
  const results = loadResults(files);
  if (args.includes("--summary")) {
    summarize(results);
    return;
  }
  const maxIdx = args.indexOf("--max");
  const max = maxIdx === -1 ? SAMPLES : Number(args[maxIdx + 1]);
  if (!Number.isInteger(max) || max < 1) throw new Error("--max must be a positive integer");

  const doneIdx = new Set(results.samples.map((s) => s.index));
  let ran = 0;
  for (let i = 0; i < SAMPLES && ran < max; i++) {
    if (doneIdx.has(i)) continue;
    const sample = await runSample(results.runId, i, files[i], invokeClaude);
    results.samples.push(sample);
    results.samples.sort((a, b) => a.index - b.index);
    saveResults(results); // idempotent, resumable after every sample
    ran++;
  }
  summarize(results);
}

await main();
