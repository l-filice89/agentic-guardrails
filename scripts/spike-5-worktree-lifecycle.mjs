/**
 * SPIKE-5 gate harness (Story 1.14): Windows git-worktree lifecycle.
 *
 *   pnpm -r build && node scripts/spike-5-worktree-lifecycle.mjs
 *
 * Exercises the REAL shipped primitive (`withWorktree` / `reclaimWorktrees`
 * from packages/core/dist) — never a parallel implementation:
 *   (1) 100 consecutive create -> run -> cleanup cycles;
 *   (2) the injected-failure suite: process SIGKILLed mid-run, a directory
 *       handle held open by ANOTHER process during removal (transient and
 *       persistent), paths >260 chars (deep checkout, long base, and BOTH
 *       together), case-collision refs (foo/FOO), base-directory degrade, and
 *       foreign-worktree safety;
 *   (3) a measurement of the REAL base-path threshold on this machine
 *       (binary search), so `MAX_BASE_PATH_LENGTH` can be stated honestly.
 *
 * EVERY scenario ends by routing through `verifyClean()`, measured not
 * eyeballed:
 *   - zero residue: `git worktree list` shows only the invoking tree, no
 *     `agtwt-`/probe leftover anywhere under the base roots used, no `*.lock`
 *     in `.git`;
 *   - an intact invoking tree: see `treeFingerprint` for exactly what that
 *     covers (and the write-up for what it does NOT).
 *
 * A scenario whose failure mode CANNOT be injected on this platform reports
 * `skip`, and a skip is a GATE FAIL — never a quiet pass. Any I/O error while
 * measuring residue fails the scenario; it is never read as "clean".
 *
 * All fixtures are git repos this harness creates in OS temp and deletes; a
 * temp cleanup that leaks also fails the run. Nothing is ever created inside
 * the repo under review. Prints a per-scenario table, one machine-readable
 * `SPIKE5_JSON` line, and an explicit verdict; exits non-zero unless the
 * verdict is PASS.
 *
 * Env overrides (probing only): SPIKE5_CYCLES. A run with fewer than
 * GATE_CYCLES cycles is labelled SMOKE and can never print verdict PASS.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const corePath = new URL("../packages/core/dist/index.js", import.meta.url).href;

/** The cycle count this spike is a GATE at. Anything less is a smoke run. */
const GATE_CYCLES = 100;

function envInt(name, fallback, min) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    console.error(
      `SPIKE-5: ${name}=${JSON.stringify(raw)} is invalid — must be an integer >= ${min}.`,
    );
    process.exit(1);
  }
  return n;
}
const CYCLES = envInt("SPIKE5_CYCLES", GATE_CYCLES, 1);
const IS_GATE_RUN = CYCLES >= GATE_CYCLES;

// ---------------------------------------------------------------------------
// git + fixture helpers
// ---------------------------------------------------------------------------

/** stderr piped, not inherited: git's CRLF warnings are noise here. */
function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

/**
 * `\\?\` so fs can reach a path past Win32's MAX_PATH (260). Threshold 240,
 * matching `fsPath()` in worktree.ts: MAX_PATH counts the terminating NUL and
 * a directory must leave room for `\` + an 8.3 name, so MAX_PATH - 12 is the
 * documented safe headroom. UNC shares take the `\\?\UNC\server\share\…`
 * spelling — `\\?\\\server\share` is not a valid Win32 path.
 */
function long(p) {
  const resolved = path.resolve(p);
  if (process.platform !== "win32" || resolved.length < 240 || resolved.startsWith("\\\\?\\")) {
    return resolved;
  }
  return resolved.startsWith("\\\\") ? `\\\\?\\UNC\\${resolved.slice(2)}` : `\\\\?\\${resolved}`;
}

function makeRepo(root, files) {
  fs.mkdirSync(root, { recursive: true });
  git(root, ["init", "-q", "."]);
  git(root, ["config", "user.email", "spike5@local"]);
  git(root, ["config", "user.name", "spike5"]);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(long(path.dirname(abs)), { recursive: true });
    fs.writeFileSync(long(abs), content);
  }
  git(root, ["-c", "core.longpaths=true", "add", "-A"]);
  git(root, ["-c", "core.longpaths=true", "commit", "-q", "-m", "baseline"]);
  return root;
}

/**
 * Fingerprint of the invoking repository. Covers, exactly:
 *   - the porcelain status (staged + unstaged + untracked);
 *   - HEAD, and the CONTENT of every tracked file in `git ls-files -z` order;
 *   - every ref (`for-each-ref`), so a scenario that creates or deletes a
 *     branch and fails to clean it up is CAUGHT;
 *   - `.git/config`, and the names under `.git/worktrees` (leftover
 *     administrative directories).
 * It does NOT cover file mtimes, reflogs, or object-store growth — see the
 * write-up; those are stated as out of scope rather than implied clean.
 * A file that cannot be READ throws: an unreadable tree is a failed
 * measurement, never an "unchanged" one.
 */
function treeFingerprint(repo) {
  const status = git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const tracked = git(repo, ["ls-files", "-z"])
    .split("\0")
    .filter((f) => f.length > 0);
  const hash = createHash("sha256");
  hash.update(status);
  for (const rel of tracked) {
    hash.update(rel);
    hash.update("\0");
    hash.update(fs.readFileSync(long(path.join(repo, rel))));
  }
  const refs = git(repo, ["for-each-ref", "--format=%(refname) %(objectname)"]);
  hash.update(refs);
  const gitDir = path.join(repo, ".git");
  hash.update(readIfPresent(path.join(gitDir, "config")));
  const adminWorktrees = listIfPresent(path.join(gitDir, "worktrees")).sort().join("\n");
  hash.update(adminWorktrees);
  return {
    head: git(repo, ["rev-parse", "HEAD"]).trim(),
    files: tracked.length,
    refs: refs.split("\n").filter((l) => l.length > 0).length,
    adminWorktrees: adminWorktrees.length === 0 ? 0 : adminWorktrees.split("\n").length,
    digest: hash.digest("hex"),
  };
}

/** ENOENT is legitimately "nothing"; any other error is a failed measurement. */
function readIfPresent(file) {
  try {
    return fs.readFileSync(long(file), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

function listIfPresent(dir) {
  try {
    return fs.readdirSync(long(dir));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

const sameFingerprint = (a, b) =>
  a.head === b.head &&
  a.files === b.files &&
  a.refs === b.refs &&
  a.adminWorktrees === b.adminWorktrees &&
  a.digest === b.digest;

/** Registered worktrees other than the invoking tree. */
function registeredExtras(repo) {
  return git(repo, ["worktree", "list", "--porcelain"])
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.resolve(line.slice("worktree ".length)))
    .filter((p) => p !== path.resolve(repo));
}

/**
 * Tool leftovers anywhere under a base ROOT — recursive, because the base is
 * repo-namespaced (`<root>/<repo hash>/`), and type-blind, because a
 * prefixed FILE or junction is residue too. An I/O error THROWS: "I could not
 * look" must never be reported as "there is nothing there".
 */
function residueDirs(baseRoot) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(long(dir), { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.name.startsWith("agtwt-") || entry.name.startsWith(".agtwt-probe-")) {
        found.push(abs);
        continue;
      }
      if (entry.isDirectory()) walk(abs);
    }
  };
  walk(baseRoot);
  return found;
}

/**
 * Orphaned locks: any `*.lock` under `.git`, plus `locked` markers git keeps
 * in `.git/worktrees/<name>/`. NOTE: nothing in the lifecycle takes a git
 * lock, so this check cannot fail by construction — it is a regression tripwire
 * for a FUTURE change, not evidence about this one. Said plainly in the
 * write-up rather than counted as a proof.
 */
function lockFiles(repo) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(long(dir), { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith(".lock") || entry.name === "locked") found.push(abs);
    }
  };
  walk(path.join(repo, ".git"));
  return found;
}

/** The full zero-residue assertion for one scenario. Throws on I/O error. */
function residueReport(repo, baseRoots) {
  const extras = registeredExtras(repo);
  const dirs = baseRoots.flatMap((b) => residueDirs(b));
  const locks = lockFiles(repo);
  return {
    extras,
    dirs,
    locks,
    clean: extras.length === 0 && dirs.length === 0 && locks.length === 0,
  };
}

// ---------------------------------------------------------------------------
// child modes (a second process is the only honest way to inject these)
// ---------------------------------------------------------------------------

/** Atomic marker write: the parent polls for this file, and must never read a
 * partially-written one. */
function writeMarker(file, content) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(long(tmp), content);
  fs.renameSync(long(tmp), long(file));
}

/** Holds a worktree open inside `withWorktree` and never returns — the parent
 * SIGKILLs it, so its cleanup never runs. Any failure BEFORE the marker is
 * written is reported through the marker, so the parent fails fast instead of
 * waiting out its whole timeout on a child that already died. */
async function childHold(repoRoot, baseDir, markerPath) {
  try {
    const core = await import(corePath);
    const result = await core.withWorktree({ repoRoot, ref: "HEAD", baseDir }, async (wt) => {
      writeMarker(markerPath, wt);
      await sleep(600_000);
    });
    writeMarker(markerPath, `ERROR: lifecycle returned ${JSON.stringify(result)}`);
  } catch (error) {
    try {
      writeMarker(markerPath, `ERROR: ${error.stack ?? error.message}`);
    } catch {
      process.exit(3);
    }
  }
}

/** Keeps its CWD inside a directory, which is what actually blocks deletion on
 * Windows (a plain open file descriptor does NOT — measured, see the write-up).
 * Also holds an open fd, so the scenario covers both handle kinds. */
async function childCwd(dir, markerPath) {
  try {
    const fd = fs.openSync(path.join(dir, "README.md"), "r");
    writeMarker(markerPath, "held");
    await sleep(600_000);
    fs.closeSync(fd);
  } catch (error) {
    try {
      writeMarker(markerPath, `ERROR: ${error.stack ?? error.message}`);
    } catch {
      process.exit(3);
    }
  }
}

/** Resolves to the marker's contents, or `undefined` on timeout. Also returns
 * early — with the ERROR payload — when the child failed before holding. */
async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return fs.readFileSync(long(file), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await sleep(50);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------------

const results = [];

async function scenario(name, fn) {
  const started = performance.now();
  process.stdout.write(`\n[${name}] ...\n`);
  let outcome;
  try {
    outcome = await fn();
  } catch (error) {
    outcome = { status: "fail", detail: `threw: ${error.stack ?? error.message}` };
  }
  const ms = Math.round(performance.now() - started);
  results.push({ name, ms, ...outcome });
  console.log(`  ${outcome.status.toUpperCase()} (${(ms / 1000).toFixed(1)}s) — ${outcome.detail}`);
}

/** Fails the scenario unless the invoking tree is byte-identical AND there is
 * zero residue. */
function verifyClean(repo, before, baseRoots) {
  const after = treeFingerprint(repo);
  const residue = residueReport(repo, baseRoots);
  const problems = [];
  if (!sameFingerprint(before, after)) {
    problems.push(`invoking tree CHANGED (${JSON.stringify(before)} -> ${JSON.stringify(after)})`);
  }
  if (!residue.clean) problems.push(`residue: ${JSON.stringify(residue)}`);
  return { ok: problems.length === 0, problems, residue };
}

/**
 * The CWD-hold injection only blocks deletion on Windows: POSIX happily
 * unlinks a directory that is some process's CWD. On a platform where the
 * failure cannot be injected the scenario SKIPS — a skip fails the gate,
 * which is the honest outcome (this gate is a Windows gate).
 */
const HOLD_INJECTABLE = process.platform === "win32";

async function main() {
  const core = await import(corePath);
  console.log(`SPIKE-5 worktree lifecycle — ${new Date().toISOString()}`);
  console.log(
    `hardware: ${os.cpus()[0].model} | ${os.cpus().length} logical cores | ` +
      `${(os.totalmem() / 2 ** 30).toFixed(1)} GB RAM | node ${process.version} | ${process.platform} ${os.release()}`,
  );
  console.log(`git: ${git(process.cwd(), ["--version"]).trim()} | cycles: ${CYCLES}`);
  if (!IS_GATE_RUN) {
    console.log(
      `*** SMOKE RUN — ${CYCLES} < ${GATE_CYCLES} cycles. This run CANNOT produce a gate verdict. ***`,
    );
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spike5-"));
  console.log(`temp: ${tmp}`);

  // The repo under review must not be touched by any of this — checked coarsely
  // (status + index) at both ends. Its worktrees are never created here.
  const selfRepo = path.resolve(SELF, "..", "..");
  const selfBefore = git(selfRepo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  let cleanupLeak;

  try {
    const repo = makeRepo(path.join(tmp, "repo"), {
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "import { a } from './a.js';\nexport const b = a + 1;\n",
      "README.md": "# spike5 fixture\n",
    });
    const base = path.join(tmp, "base");
    fs.mkdirSync(base);

    // --- (1) consecutive create -> run -> cleanup cycles --------------------
    await scenario(`cycles x${CYCLES}`, async () => {
      const before = treeFingerprint(repo);
      const timings = [];
      const failures = [];
      for (let i = 0; i < CYCLES; i++) {
        const t0 = performance.now();
        const result = await core.withWorktree(
          { repoRoot: repo, ref: "HEAD", baseDir: base },
          (wt) => {
            // Prove the checkout is real and writable inside the scope.
            const content = fs.readFileSync(path.join(wt, "src", "b.ts"), "utf8");
            fs.writeFileSync(path.join(wt, "scratch.txt"), `cycle ${i}\n`);
            // Line-ending-agnostic (the fixture is checked out with the
            // platform's autocrlf), but still proof of a REAL checkout.
            return content.includes("export const b = a + 1;");
          },
        );
        timings.push(performance.now() - t0);
        if (!result.ok) failures.push(`cycle ${i}: ${result.reason}`);
        else if (result.degradations.length > 0) {
          failures.push(`cycle ${i}: degradations ${JSON.stringify(result.degradations)}`);
        } else if (result.value !== true) {
          failures.push(`cycle ${i}: the checked-out file did not contain the committed content`);
        }
        const residue = residueReport(repo, [base]);
        if (!residue.clean) failures.push(`cycle ${i}: ${JSON.stringify(residue)}`);
        if ((i + 1) % 20 === 0) process.stdout.write(`  ${i + 1}/${CYCLES} cycles\n`);
      }
      const check = verifyClean(repo, before, [base]);
      const sorted = [...timings].sort((x, y) => x - y);
      const stats = {
        cycles: CYCLES,
        medianMs: Math.round(sorted[Math.floor(sorted.length / 2)]),
        minMs: Math.round(sorted[0]),
        maxMs: Math.round(sorted[sorted.length - 1]),
      };
      const problems = [...failures, ...check.problems];
      return {
        status: problems.length === 0 ? "pass" : "fail",
        metrics: stats,
        detail:
          problems.length === 0
            ? `${CYCLES} cycles, 0 leaks, 0 locks, tree byte-identical; per-cycle median ${stats.medianMs}ms (min ${stats.minMs}, max ${stats.maxMs}) — DESCRIPTIVE, not a gate criterion`
            : problems.slice(0, 5).join(" | "),
      };
    });

    // --- (2) process kill mid-run: RECOVERY, not prevention -----------------
    await scenario("process kill mid-run", async () => {
      const killBase = path.join(tmp, "base-kill");
      fs.mkdirSync(killBase);
      const before = treeFingerprint(repo);
      const marker = path.join(tmp, "kill-marker.txt");
      fs.rmSync(marker, { force: true });

      const child = spawn(process.execPath, [SELF, "--child-hold", repo, killBase, marker], {
        stdio: "ignore",
        windowsHide: true,
      });
      const payload = await waitForFile(marker, 60_000);
      if (payload === undefined || payload.startsWith("ERROR:")) {
        child.kill("SIGKILL");
        return {
          status: "fail",
          detail: payload === undefined ? "child never reported a worktree path" : payload,
        };
      }
      const worktreePath = payload;
      child.kill("SIGKILL");
      await new Promise((resolve) => child.on("exit", resolve));
      await sleep(300);

      // A SIGKILLed process never runs its cleanup — residue MUST be here.
      const residueAfterKill = residueReport(repo, [killBase]);
      const leftBehind = fs.existsSync(long(worktreePath));
      // ... and the next run's reclaim sweep is what removes it.
      const reclaim = await core.reclaimWorktrees({ repoRoot: repo, baseDir: killBase });
      const check = verifyClean(repo, before, [killBase]);
      const problems = [...check.problems];
      if (!leftBehind) {
        problems.push("expected residue after SIGKILL, found none (scenario not injected)");
      }
      // The registration half is asserted too, not merely recorded.
      if (residueAfterKill.extras.length !== 1) {
        problems.push(
          `expected exactly 1 lingering registration after the kill, saw ${residueAfterKill.extras.length}`,
        );
      }
      if (residueAfterKill.dirs.length !== 1) {
        problems.push(
          `expected exactly 1 lingering directory after the kill, saw ${residueAfterKill.dirs.length}`,
        );
      }
      if (reclaim.reclaimed.length !== 1) {
        problems.push(`reclaim removed ${reclaim.reclaimed.length} worktrees, expected 1`);
      }
      return {
        status: problems.length === 0 ? "pass" : "fail",
        metrics: {
          residueAfterKill: {
            registered: residueAfterKill.extras.length,
            dirs: residueAfterKill.dirs.length,
          },
          reclaimed: reclaim.reclaimed.length,
        },
        detail:
          problems.length === 0
            ? `kill left ${residueAfterKill.extras.length} registration + ${residueAfterKill.dirs.length} directory (both asserted); reclaimWorktrees removed it; tree byte-identical`
            : problems.join(" | "),
      };
    });

    // --- (3) held handle released mid-backoff (the transient common case) ---
    await scenario("held handle (released during backoff)", async () => {
      if (!HOLD_INJECTABLE) {
        return {
          status: "skip",
          detail: `a CWD hold does not block deletion on ${process.platform}; the failure cannot be injected here`,
        };
      }
      const holdBase = path.join(tmp, "base-hold1");
      fs.mkdirSync(holdBase);
      const before = treeFingerprint(repo);
      const marker = path.join(tmp, "hold1-marker.txt");
      fs.rmSync(marker, { force: true });
      let holder;
      let holderStarted;

      const result = await core.withWorktree(
        { repoRoot: repo, ref: "HEAD", baseDir: holdBase, attempts: 6, delayMs: 250 },
        async (wt) => {
          holder = spawn(process.execPath, [SELF, "--child-cwd", wt, marker], {
            cwd: wt,
            stdio: "ignore",
            windowsHide: true,
          });
          holderStarted = await waitForFile(marker, 30_000);
          // Release it while removal is still retrying.
          void sleep(700).then(() => holder.kill("SIGKILL"));
          return wt;
        },
      );
      if (holder) holder.kill("SIGKILL");
      const check = verifyClean(repo, before, [holdBase]);
      const problems = [...check.problems];
      if (holderStarted !== "held") {
        problems.push(`holder never took the hold (${JSON.stringify(holderStarted)})`);
      }
      if (!result.ok) problems.push(`lifecycle failed: ${result.reason}`);
      else {
        if (result.degradations.length > 0) {
          problems.push(
            `expected removal to succeed after the hold released, got ${JSON.stringify(result.degradations)}`,
          );
        }
        // THE injection guard: without it this scenario's assertions are
        // identical to a run where nothing ever blocked.
        if (result.removalAttempts <= 1) {
          problems.push(
            `removal succeeded on attempt 1 — the hold never blocked it (scenario NOT injected)`,
          );
        }
      }
      return {
        status: problems.length === 0 ? "pass" : "fail",
        metrics: { removalAttempts: result.ok ? result.removalAttempts : null },
        detail:
          problems.length === 0
            ? `holder blocked removal for ${result.removalAttempts - 1} attempt(s); attempt ${result.removalAttempts} succeeded after release; zero residue`
            : problems.join(" | "),
      };
    });

    // --- (4) held handle throughout: typed degradation, then reclaimed ------
    await scenario("held handle (held through every attempt)", async () => {
      if (!HOLD_INJECTABLE) {
        return {
          status: "skip",
          detail: `a CWD hold does not block deletion on ${process.platform}; the failure cannot be injected here`,
        };
      }
      const holdBase = path.join(tmp, "base-hold2");
      fs.mkdirSync(holdBase);
      const before = treeFingerprint(repo);
      const marker = path.join(tmp, "hold2-marker.txt");
      fs.rmSync(marker, { force: true });
      let holder;
      let holderStarted;

      const result = await core.withWorktree(
        { repoRoot: repo, ref: "HEAD", baseDir: holdBase, attempts: 3, delayMs: 100 },
        async (wt) => {
          holder = spawn(process.execPath, [SELF, "--child-cwd", wt, marker], {
            cwd: wt,
            stdio: "ignore",
            windowsHide: true,
          });
          holderStarted = await waitForFile(marker, 30_000);
          return wt;
        },
      );

      const degraded = result.ok && result.degradations.some((d) => d.kind === "removal-failed");
      const residueWhileHeld = residueReport(repo, [holdBase]);
      // Release the handle; the next run's reclaim sweep must clear it.
      if (holder) {
        holder.kill("SIGKILL");
        await new Promise((resolve) => holder.on("exit", resolve));
      }
      await sleep(500);
      const reclaim = await core.reclaimWorktrees({ repoRoot: repo, baseDir: holdBase });
      const check = verifyClean(repo, before, [holdBase]);

      const problems = [...check.problems];
      if (holderStarted !== "held") {
        problems.push(`holder never took the hold (${JSON.stringify(holderStarted)})`);
      }
      if (!result.ok) problems.push(`lifecycle failed: ${result.reason}`);
      if (!degraded) {
        problems.push(
          "removal unexpectedly SUCCEEDED while the directory was held — scenario not injected",
        );
      }
      if (residueWhileHeld.dirs.length === 0) {
        problems.push("no residue while held — scenario not injected");
      }
      if (reclaim.reclaimed.length !== 1) {
        problems.push(`reclaim removed ${reclaim.reclaimed.length}, expected 1`);
      }
      return {
        status: problems.length === 0 ? "pass" : "fail",
        metrics: {
          residueWhileHeld: residueWhileHeld.dirs.length + residueWhileHeld.extras.length,
          removalAttempts: result.ok ? result.removalAttempts : null,
        },
        detail:
          problems.length === 0
            ? `removal failed loudly as a typed degradation after ${result.removalAttempts} attempts (never a silent leak); reclaim cleared it once released; tree byte-identical`
            : problems.join(" | "),
      };
    });

    // --- (5) long paths: deep checkout (>260 chars inside the worktree) -----
    const seg = "d".repeat(45);
    const deepRel = path.join(seg, seg, seg, seg, seg, "deep.ts");
    const deepRepo = makeRepo(path.join(tmp, "repo-deep"), {
      "src/a.ts": "export const a = 1;\n",
      [deepRel]: "export const deep = 1;\n",
    });

    await scenario("long path (checked-out file >260 chars)", async () => {
      const deepBase = path.join(tmp, "base-deep");
      fs.mkdirSync(deepBase);
      const before = treeFingerprint(deepRepo);
      let checkedOutLength = 0;

      const result = await core.withWorktree(
        { repoRoot: deepRepo, ref: "HEAD", baseDir: deepBase },
        (wt) => {
          const abs = path.join(wt, deepRel);
          checkedOutLength = abs.length;
          return fs.existsSync(long(abs));
        },
      );
      const check = verifyClean(deepRepo, before, [deepBase]);
      const problems = [...check.problems];
      if (!result.ok) problems.push(`lifecycle failed: ${result.reason}`);
      else if (result.value !== true) problems.push("deep file was not checked out into the worktree");
      if (checkedOutLength <= 260) problems.push(`path only ${checkedOutLength} chars — scenario not injected`);
      return {
        status: problems.length === 0 ? "pass" : "fail",
        metrics: { checkedOutLength },
        detail:
          problems.length === 0
            ? `checked out a ${checkedOutLength}-char path (core.longpaths=true) and removed it cleanly`
            : problems.join(" | "),
      };
    });

    // --- (5b) COMBINED: a long base AND a deep checkout ----------------------
    await scenario("long path (long base AND deep checkout together)", async () => {
      const before = treeFingerprint(deepRepo);
      // A base as long as the gate allows: the effective base is
      // `<root>/<12-hex repo hash>`, so pad the root to just under the limit
      // and let the deep checkout consume the rest of the budget.
      const root = path.join(tmp, "cb");
      const padTo = core.MAX_BASE_PATH_LENGTH - 13 - root.length;
      const combinedRoot = padTo > 0 ? path.join(root, "c".repeat(padTo - 1)) : root;
      fs.mkdirSync(long(combinedRoot), { recursive: true });
      let checkedOutLength = 0;
      let baseLength = 0;

      const result = await core.withWorktree(
        { repoRoot: deepRepo, ref: "HEAD", baseDir: combinedRoot },
        (wt) => {
          baseLength = path.dirname(wt).length;
          const abs = path.join(wt, deepRel);
          checkedOutLength = abs.length;
          return fs.existsSync(long(abs));
        },
      );
      const check = verifyClean(deepRepo, before, [combinedRoot]);
      const problems = [...check.problems];
      if (!result.ok) problems.push(`lifecycle failed: ${result.reason}`);
      else {
        if (result.value !== true) problems.push("deep file was not checked out under the long base");
        if (result.degradations.length > 0) {
          problems.push(`unexpected degradations: ${JSON.stringify(result.degradations)}`);
        }
      }
      if (baseLength <= core.MAX_BASE_PATH_LENGTH - 20) {
        problems.push(`base only ${baseLength} chars — scenario not injected`);
      }
      if (checkedOutLength <= 260) {
        problems.push(`checked-out path only ${checkedOutLength} chars — scenario not injected`);
      }
      return {
        status: problems.length === 0 ? "pass" : "fail",
        metrics: { baseLength, checkedOutLength },
        detail:
          problems.length === 0
            ? `a ${baseLength}-char base (at the gate limit) plus a ${checkedOutLength}-char checked-out path succeeded together and cleaned up`
            : problems.join(" | "),
      };
    });

    // --- (5c) MEASUREMENT: where does git actually break? -------------------
    await scenario("measure: real base-path threshold (binary search)", async () => {
      // MAX_BASE_PATH_LENGTH is a conservative constant. This measures the
      // ACTUAL cliff on this machine for this repo, with the deepest tracked
      // path included — the term that really decides whether git blows up.
      const before = treeFingerprint(deepRepo);
      const deepest = git(deepRepo, ["ls-files"])
        .split(/\r?\n/)
        .filter((l) => l.length > 0)
        .reduce((max, l) => Math.max(max, l.length), 0);
      const attempt = (baseLength) => {
        const root = path.join(tmp, "probe");
        const pad = baseLength - root.length - 1 - "wt".length - 1;
        if (pad < 1) return { ok: false, reason: "cannot construct a base this short" };
        const dir = path.join(root, "z".repeat(pad));
        const target = path.join(dir, "wt");
        try {
          fs.mkdirSync(long(dir), { recursive: true });
          git(deepRepo, ["-c", "core.longpaths=true", "worktree", "add", "--detach", target, "HEAD"]);
        } catch (error) {
          const text = (error.stderr ?? error.message ?? "").toString();
          const fatal = text
            .split(/\r?\n/)
            .filter((l) => l.startsWith("fatal") || l.startsWith("error"));
          return { ok: false, reason: (fatal[0] ?? text).trim() };
        } finally {
          try {
            git(deepRepo, ["-c", "core.longpaths=true", "worktree", "remove", "--force", target]);
          } catch {
            /* nothing registered — the add failed */
          }
          try {
            fs.rmSync(long(dir), { recursive: true, force: true, maxRetries: 5 });
          } catch {
            /* swept with tmp */
          }
          git(deepRepo, ["worktree", "prune"]);
        }
        return { ok: true };
      };

      let low = 60;
      let high = 400;
      let lastFailure;
      if (!attempt(low).ok) return { status: "fail", detail: `even a ${low}-char base failed` };
      const ceiling = attempt(high);
      if (ceiling.ok) {
        return {
          status: "pass",
          metrics: { largestWorkingBase: high, smallestFailingBase: null, deepestTrackedPath: deepest, gateConstant: core.MAX_BASE_PATH_LENGTH },
          detail: `no base-length cliff found up to ${high} chars on this machine; MAX_BASE_PATH_LENGTH=${core.MAX_BASE_PATH_LENGTH} is conservative by a wide margin`,
        };
      }
      lastFailure = (ceiling.reason.split(/\r?\n/)[0] ?? "");
      while (high - low > 4) {
        const mid = Math.floor((low + high) / 2);
        const outcome = attempt(mid);
        if (outcome.ok) low = mid;
        else {
          high = mid;
          lastFailure = outcome.reason.split(/\r?\n/)[0] ?? "";
        }
      }
      const check = verifyClean(deepRepo, before, [path.join(tmp, "probe")]);
      return {
        status: check.ok ? "pass" : "fail",
        metrics: {
          largestWorkingBase: low,
          smallestFailingBase: high,
          deepestTrackedPath: deepest,
          gateConstant: core.MAX_BASE_PATH_LENGTH,
          failureAt: lastFailure,
        },
        detail: check.ok
          ? `largest WORKING base ${low} chars, smallest FAILING ${high} ("${lastFailure.slice(0, 70)}"), deepest tracked path ${deepest} chars; MAX_BASE_PATH_LENGTH=${core.MAX_BASE_PATH_LENGTH} sits below it with headroom`
          : check.problems.join(" | "),
      };
    });

    // --- (6) long paths: base directory itself >260 chars -> declared degrade
    await scenario("long path (base dir >260 chars)", async () => {
      const segment = "b".repeat(60);
      const longBase = path.join(tmp, segment, segment, segment, segment);
      const fallback = path.join(tmp, "base-longfallback");
      const before = treeFingerprint(repo);

      const result = await core.withWorktree(
        { repoRoot: repo, ref: "HEAD", baseDir: longBase, fallbackBaseDir: fallback },
        (wt) => path.dirname(wt),
      );
      const check = verifyClean(repo, before, [longBase, fallback]);
      const problems = [...check.problems];
      const degrade = result.ok
        ? result.degradations.find((d) => d.kind === "base-dir-degraded")
        : undefined;
      if (!result.ok) problems.push(`lifecycle failed: ${result.reason}`);
      else if (degrade === undefined) problems.push("expected a declared base-dir degrade, got none");
      else if (path.resolve(result.value) !== core.worktreeBaseDir(repo, fallback)) {
        problems.push(`ran under ${result.value}, expected the declared alternative under ${fallback}`);
      }
      if (longBase.length <= 260) problems.push(`base only ${longBase.length} chars — scenario not injected`);
      if (fs.existsSync(long(longBase))) problems.push("the unusable base was created anyway");
      return {
        status: problems.length === 0 ? "pass" : "fail",
        metrics: { baseLength: longBase.length },
        detail:
          problems.length === 0
            ? `${longBase.length}-char base declared unusable ("${degrade.reason.slice(0, 80)}…"), ran under the alternative, zero residue`
            : problems.join(" | "),
      };
    });

    // --- (7) case-collision refs (foo vs FOO) ------------------------------
    await scenario("case-collision refs (foo / FOO)", async () => {
      const caseBase = path.join(tmp, "base-case");
      fs.mkdirSync(caseBase);
      const before = treeFingerprint(repo);
      let refsDistinct = true;
      try {
        git(repo, ["branch", "foo"]);
      } catch {
        /* already exists from a previous run */
      }
      try {
        git(repo, ["branch", "FOO"]);
      } catch {
        // Git on Windows refuses: refs/heads/foo and refs/heads/FOO are one
        // FILE. Both names therefore resolve to the same commit — the
        // collision hazard moves entirely to OUR directory naming.
        refsDistinct = false;
      }

      const paths = [];
      const outer = await core.withWorktree(
        { repoRoot: repo, ref: "foo", baseDir: caseBase },
        async (first) => {
          paths.push(first);
          const inner = await core.withWorktree(
            { repoRoot: repo, ref: "FOO", baseDir: caseBase },
            (second) => {
              paths.push(second);
              return { bothExist: fs.existsSync(first) && fs.existsSync(second) };
            },
          );
          return { inner, outerStillThere: fs.existsSync(first) };
        },
      );
      // A THIRD scope at the SAME ref: proves the ref component is derived
      // from the ref, not from the random suffix (see the assertions below).
      const sameRef = await core.withWorktree(
        { repoRoot: repo, ref: "foo", baseDir: caseBase },
        (third) => third,
      );

      for (const branch of ["foo", "FOO"]) {
        try {
          git(repo, ["branch", "-D", branch]);
        } catch {
          /* not created on this platform */
        }
      }

      const check = verifyClean(repo, before, [caseBase]);
      const problems = [...check.problems];
      if (!outer.ok) problems.push(`outer lifecycle failed: ${outer.reason}`);
      else {
        if (!outer.value.inner.ok) problems.push(`inner lifecycle failed: ${outer.value.inner.reason}`);
        else if (!outer.value.inner.value.bothExist) problems.push("the two worktrees did not coexist");
        if (!outer.value.outerStillThere) problems.push("the inner lifecycle destroyed the outer worktree");
      }
      if (!sameRef.ok) problems.push(`same-ref lifecycle failed: ${sameRef.reason}`);

      // The DESIGN assertion, not a tautology: the name is
      // `agtwt-<refHash>-<random>`. Deleting the ref hash breaks BOTH halves.
      const refComponent = (p) => path.basename(p).split("-")[1];
      const [p1, p2] = paths;
      if (paths.length !== 2) problems.push(`expected 2 worktree paths, got ${paths.length}`);
      else {
        if (refComponent(p1) !== core.refHash("foo")) {
          problems.push(`"foo" produced ref component ${refComponent(p1)}, expected ${core.refHash("foo")}`);
        }
        if (refComponent(p2) !== core.refHash("FOO")) {
          problems.push(`"FOO" produced ref component ${refComponent(p2)}, expected ${core.refHash("FOO")}`);
        }
        if (refComponent(p1) === refComponent(p2)) {
          problems.push(`foo and FOO folded to the SAME ref component ${refComponent(p1)}`);
        }
        if (p1.toLowerCase() === p2.toLowerCase()) {
          problems.push(`case-insensitive collision in worktree names: ${JSON.stringify(paths)}`);
        }
      }
      if (sameRef.ok) {
        const third = sameRef.value;
        if (refComponent(third) !== refComponent(p1)) {
          problems.push(
            `the SAME ref produced two different ref components (${refComponent(p1)} vs ${refComponent(third)}) — the name is not ref-derived`,
          );
        }
        if (path.resolve(third) === path.resolve(p1)) {
          problems.push("two scopes at the same ref got the SAME directory");
        }
      }
      return {
        status: problems.length === 0 ? "pass" : "fail",
        metrics: {
          gitAllowsCaseVariantRefs: refsDistinct,
          refComponents: paths.map((p) => path.basename(p).split("-")[1]),
        },
        detail:
          problems.length === 0
            ? `git ${refsDistinct ? "allowed" : "REFUSED"} a case-variant ref; foo/FOO produced DIFFERENT ref-derived components at distinct coexisting directories, the same ref reproduced its component at a distinct directory, all cleaned up`
            : problems.join(" | "),
      };
    });

    // --- (8) base directory unusable -> declared degrade -------------------
    await scenario("base dir unusable (degrade declared)", async () => {
      const blocker = path.join(tmp, "blocker-file");
      fs.writeFileSync(blocker, "not a directory\n");
      const unusable = path.join(blocker, "worktrees");
      const fallback = path.join(tmp, "base-degrade");
      const before = treeFingerprint(repo);

      const result = await core.withWorktree(
        { repoRoot: repo, ref: "HEAD", baseDir: unusable, fallbackBaseDir: fallback },
        (wt) => path.dirname(wt),
      );
      const check = verifyClean(repo, before, [fallback]);
      const problems = [...check.problems];
      const degrade = result.ok
        ? result.degradations.find((d) => d.kind === "base-dir-degraded")
        : undefined;
      if (!result.ok) problems.push(`lifecycle failed: ${result.reason}`);
      else if (degrade === undefined) problems.push("degrade was silent — no declaration");
      else if (path.resolve(result.value) !== core.worktreeBaseDir(repo, fallback)) {
        problems.push(`ran under ${result.value}, expected the namespaced base under ${fallback}`);
      }
      return {
        status: problems.length === 0 ? "pass" : "fail",
        detail:
          problems.length === 0
            ? `unwritable base declared ("${degrade.reason.slice(0, 60)}…") and the run continued on the alternative; zero residue`
            : problems.join(" | "),
      };
    });

    // --- (9) foreign worktree safety (the reclamation bypass check) --------
    await scenario("foreign worktree untouched by reclamation", async () => {
      const before = treeFingerprint(repo);
      const foreignRoot = path.join(tmp, "base-foreign");
      const foreignBase = core.worktreeBaseDir(repo, foreignRoot);
      fs.mkdirSync(foreignBase, { recursive: true });
      const human = path.join(foreignBase, "my-hotfix");
      const lookalike = path.join(tmp, "elsewhere-agtwt-looks-like-ours");
      git(repo, ["worktree", "add", "--detach", human, "HEAD"]);
      git(repo, ["worktree", "add", "--detach", lookalike, "HEAD"]);
      const precious = path.join(human, "precious.txt");
      fs.writeFileSync(precious, "human work in progress\n");

      // A LIVE worktree belonging to a DIFFERENT repository, dropped straight
      // into our namespaced base: it carries our prefix but its `.git` points
      // elsewhere, so it must be DECLARED, never deleted.
      const otherRepo = makeRepo(path.join(tmp, "repo-other"), { "README.md": "# other\n" });
      const otherWorktree = path.join(foreignBase, "agtwt-0badc0de-other1");
      git(otherRepo, ["worktree", "add", "--detach", otherWorktree, "HEAD"]);
      const otherPrecious = path.join(otherWorktree, "README.md");

      // Residue of ours sitting right beside them.
      const residue = path.join(foreignBase, "agtwt-deadbeefdead-abc123");
      fs.mkdirSync(residue, { recursive: true });
      fs.writeFileSync(path.join(residue, "leftover.txt"), "ours\n");

      const reclaim = await core.reclaimWorktrees({ repoRoot: repo, baseDir: foreignRoot });
      const lifecycle = await core.withWorktree(
        { repoRoot: repo, ref: "HEAD", baseDir: foreignRoot },
        () => "ok",
      );

      const problems = [];
      if (!fs.existsSync(precious)) problems.push("DESTRUCTIVE: the human worktree's file was deleted");
      if (!fs.existsSync(path.join(lookalike, "src", "a.ts"))) {
        problems.push("DESTRUCTIVE: a prefixed worktree outside the base dir was deleted");
      }
      if (!fs.existsSync(otherPrecious)) {
        problems.push("DESTRUCTIVE: another repository's live worktree was deleted");
      }
      if (!reclaim.degradations.some((d) => d.kind === "unowned")) {
        problems.push("the foreign-repo worktree was skipped SILENTLY — no `unowned` declaration");
      }
      if (reclaim.reclaimed.length !== 1 || path.resolve(reclaim.reclaimed[0]) !== path.resolve(residue)) {
        problems.push(`reclaimed ${JSON.stringify(reclaim.reclaimed)}, expected only ${residue}`);
      }
      if (!lifecycle.ok) problems.push(`lifecycle beside foreign worktrees failed: ${lifecycle.reason}`);

      // Tear the survivors down BEFORE the shared clean check, so the check
      // is the same `verifyClean` every other scenario uses — no hand-rolled
      // substitute that could drift from it.
      git(repo, ["worktree", "remove", "--force", human]);
      git(repo, ["worktree", "remove", "--force", lookalike]);
      git(otherRepo, ["worktree", "remove", "--force", otherWorktree]);
      fs.rmSync(long(otherWorktree), { recursive: true, force: true, maxRetries: 5 });
      const check = verifyClean(repo, before, [foreignRoot]);
      problems.push(...check.problems);

      return {
        status: problems.length === 0 ? "pass" : "fail",
        metrics: { reclaimed: reclaim.reclaimed.length, declared: reclaim.degradations.map((d) => d.kind) },
        detail:
          problems.length === 0
            ? "human worktree (in the base dir), a prefixed worktree outside the base dir, and ANOTHER repository's live worktree inside the base dir all survived; the foreign one was DECLARED `unowned`; only our residue was reclaimed"
            : problems.join(" | "),
      };
    });

    // ---- summary ----
    const failed = results.filter((r) => r.status === "fail");
    const skipped = results.filter((r) => r.status === "skip");
    console.log("\n================ RESULTS ================");
    for (const r of results) {
      console.log(`${r.status.toUpperCase().padEnd(4)} ${r.name.padEnd(48)} ${(r.ms / 1000).toFixed(1)}s`);
    }
    const selfAfter = git(selfRepo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const selfIntact = selfBefore === selfAfter;
    if (!selfIntact) console.error("WARNING: the repo under review changed during the run");

    // Cleanup runs BEFORE the verdict: a run whose failure mode prevents its
    // own cleanup must not be able to report PASS.
    cleanupLeak = removeTemp(tmp);

    const allGreen = failed.length === 0 && skipped.length === 0 && selfIntact && cleanupLeak === undefined;
    const verdict = !allGreen ? "FAIL" : IS_GATE_RUN ? "PASS" : "SMOKE-PASS";
    console.log(
      `\nSPIKE5_JSON ${JSON.stringify({
        verdict,
        gateRun: IS_GATE_RUN,
        platform: `${process.platform} ${os.release()}`,
        node: process.version,
        git: git(process.cwd(), ["--version"]).trim(),
        cycles: CYCLES,
        gateCycles: GATE_CYCLES,
        scenarios: results,
        skipped: skipped.map((r) => r.name),
        invokingRepoUnchanged: selfIntact,
        tempCleanupLeak: cleanupLeak ?? null,
      })}`,
    );
    if (IS_GATE_RUN) {
      console.log(`\nGATE (${CYCLES} clean cycles + injected-failure suite): ${verdict}`);
    } else {
      console.log(
        `\nNOT A GATE RUN — ${CYCLES} of ${GATE_CYCLES} cycles. Smoke result: ${verdict}. ` +
          `The gate verdict can only come from a full ${GATE_CYCLES}-cycle run.`,
      );
    }
    if (!allGreen) {
      console.error(
        `SPIKE-5: FAILED — ${failed.length} failed, ${skipped.length} skipped` +
          `${cleanupLeak === undefined ? "" : `, temp cleanup leaked: ${cleanupLeak}`}.`,
      );
    }
    process.exitCode = verdict === "FAIL" ? 1 : 0;
  } catch (error) {
    console.error(`SPIKE-5: harness aborted: ${error.stack ?? error.message}`);
    process.exitCode = 1;
    if (removeTemp(tmp) !== undefined) console.error(`leaked temp path: ${tmp}`);
  }
}

/** Returns a leak description, or `undefined` when temp is really gone. */
function removeTemp(tmp) {
  console.log("\ncleaning up temp ...");
  try {
    fs.rmSync(long(tmp), { recursive: true, force: true, maxRetries: 10 });
  } catch (error) {
    console.error(`cleanup failed, leaked temp path: ${tmp} (${error.message})`);
    return `${tmp}: ${error.message}`;
  }
  if (fs.existsSync(long(tmp))) {
    console.error(`cleanup reported success but ${tmp} is still there`);
    return `${tmp}: still present after rmSync`;
  }
  return undefined;
}

const holdIndex = process.argv.indexOf("--child-hold");
const cwdIndex = process.argv.indexOf("--child-cwd");
if (holdIndex !== -1) {
  await childHold(process.argv[holdIndex + 1], process.argv[holdIndex + 2], process.argv[holdIndex + 3]);
} else if (cwdIndex !== -1) {
  await childCwd(process.argv[cwdIndex + 1], process.argv[cwdIndex + 2]);
} else {
  await main();
}
