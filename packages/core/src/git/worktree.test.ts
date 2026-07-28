/**
 * In-process coverage of the worktree lifecycle I/O matrix (Story 1.14).
 * The scenarios that need a second process (mid-run SIGKILL, a held handle,
 * the 100-cycle loop) live in `scripts/spike-5-worktree-lifecycle.mjs`.
 *
 * Every case here is PLATFORM-NEUTRAL by construction: CI runs Linux
 * (case-sensitive filesystem, no MAX_PATH), the gate runs Windows, and the
 * suite must be green on both without weakening what it proves. Nothing here
 * branches on `process.platform`; where the two platforms genuinely differ
 * (case-variant refs) the fixture accommodates BOTH and asserts the property
 * that holds either way.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { degradationSchema } from "@agentic-guardrails/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fromManifestDegradation,
  LIVE_MARKER_NAME,
  MAX_BASE_PATH_LENGTH,
  parseWorktreeList,
  prepareWorktreeBase,
  PROBE_PREFIX,
  reclaimWorktrees,
  refHash,
  removeWorktree,
  toManifestDegradation,
  withWorktree,
  worktreeBaseDir,
  worktreeDegradationsOf,
  worktreeList,
  WORKTREE_PREFIX,
} from "./worktree.js";

// Every case shells out to git several times; the 5s default is too tight.
vi.setConfig({ testTimeout: 120_000 });

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gr-wt-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, shell: false, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

function initRepo(repoRoot: string): string {
  mkdirSync(repoRoot, { recursive: true });
  git(repoRoot, ["init", "-q", "."]);
  git(repoRoot, ["config", "user.email", "test@example.com"]);
  git(repoRoot, ["config", "user.name", "Test"]);
  writeFileSync(path.join(repoRoot, "a.ts"), "export const a = 1;\n");
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "-q", "-m", "init"]);
  return repoRoot;
}

/**
 * A committed one-file repo plus its base ROOT, both under OS temp. `base` is
 * the effective, repo-NAMESPACED base — the directory worktrees actually land
 * in, and therefore the one the assertions have to look at.
 */
function fixture(): { repoRoot: string; baseRoot: string; base: string } {
  const root = tempDir();
  const repoRoot = initRepo(path.join(root, "repo"));
  const baseRoot = path.join(root, "base");
  const base = worktreeBaseDir(repoRoot, baseRoot);
  mkdirSync(base, { recursive: true });
  return { repoRoot, baseRoot, base };
}

/** Registered worktrees other than the invoking tree. */
function extraWorktrees(repoRoot: string): string[] {
  const list = worktreeList(repoRoot);
  if (!list.ok) throw new Error(list.reason);
  return list.value
    .map((entry) => entry.path)
    .filter((entry) => path.resolve(entry) !== path.resolve(repoRoot));
}

/** Tool-prefixed leftovers in an effective base (probe files excluded). */
function residue(base: string): string[] {
  return readdirSync(base).filter((name) => name.startsWith(WORKTREE_PREFIX));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe("withWorktree", () => {
  it("runs the callback inside a checked-out worktree and removes it", async () => {
    const { repoRoot, baseRoot, base } = fixture();
    const seen: string[] = [];
    const result = await withWorktree(
      { repoRoot, ref: "HEAD", baseDir: baseRoot },
      (worktreePath) => {
        seen.push(worktreePath);
        expect(existsSync(path.join(worktreePath, "a.ts"))).toBe(true);
        return "done";
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("done");
      expect(result.removalAttempts).toBe(1);
      expect(result.degradations).toEqual([]);
    }
    expect(seen).toHaveLength(1);
    expect(existsSync(seen[0] as string)).toBe(false);
    expect(extraWorktrees(repoRoot)).toEqual([]);
    expect(residue(base)).toEqual([]);
  });

  it("removes the worktree when the callback throws, and rethrows", async () => {
    const { repoRoot, baseRoot } = fixture();
    let worktreePath = "";
    await expect(
      withWorktree({ repoRoot, ref: "HEAD", baseDir: baseRoot }, (created) => {
        worktreePath = created;
        throw new Error("callback boom");
      }),
    ).rejects.toThrow("callback boom");

    expect(worktreePath).not.toBe("");
    expect(existsSync(worktreePath)).toBe(false);
    expect(extraWorktrees(repoRoot)).toEqual([]);
  });

  it("removes the worktree when an async callback rejects", async () => {
    const { repoRoot, baseRoot } = fixture();
    let worktreePath = "";
    await expect(
      withWorktree({ repoRoot, ref: "HEAD", baseDir: baseRoot }, async (created) => {
        worktreePath = created;
        await Promise.resolve();
        throw new Error("async boom");
      }),
    ).rejects.toThrow("async boom");
    expect(existsSync(worktreePath)).toBe(false);
    expect(extraWorktrees(repoRoot)).toEqual([]);
  });

  it("declares — never drops — a removal that fails while the callback is ALSO throwing", async () => {
    const { repoRoot, baseRoot } = fixture();
    // Injection (platform-neutral): the callback destroys the repository, so
    // the registry becomes UNREADABLE. Removal can no longer prove the
    // worktree is unregistered, so it must report `removal-failed` — and on
    // the throwing path there is no result object for that to live in, so it
    // has to ride on the propagating error or it is a SILENT LEAK.
    let thrown: unknown;
    try {
      await withWorktree(
        { repoRoot, ref: "HEAD", baseDir: baseRoot, attempts: 1, delayMs: 1 },
        (created) => {
          expect(existsSync(created)).toBe(true);
          rmSync(path.join(repoRoot, ".git"), { recursive: true, force: true, maxRetries: 5 });
          throw new Error("callback boom");
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error).message).toBe("callback boom");
    const degradations = worktreeDegradationsOf(thrown);
    const removal = degradations.find((d) => d.kind === "removal-failed");
    expect(removal).toBeDefined();
    // The caller can NAME the residue, which is the whole point.
    expect(removal?.subject).toMatch(new RegExp(WORKTREE_PREFIX));
    expect(removal?.reason).toMatch(/registry unreadable|not removed/);
  });

  it("reports no degradations on an error that carries none", () => {
    expect(worktreeDegradationsOf(new Error("plain"))).toEqual([]);
    expect(worktreeDegradationsOf(undefined)).toEqual([]);
    expect(worktreeDegradationsOf("string")).toEqual([]);
  });

  it("returns a typed failure for a ref that does not exist, naming where residue would be", async () => {
    const { repoRoot, baseRoot, base } = fixture();
    let ran = false;
    const result = await withWorktree({ repoRoot, ref: "no-such-ref", baseDir: baseRoot }, () => {
      ran = true;
    });

    expect(ran).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no-such-ref/);
      // A caller cannot report a leak it cannot name.
      expect(result.worktreePath).toBeDefined();
      expect(path.dirname(result.worktreePath as string)).toBe(base);
    }
    // The failed-add cleanup path ran: nothing partial left behind.
    expect(extraWorktrees(repoRoot)).toEqual([]);
    expect(residue(base)).toEqual([]);
  });

  it("rejects a ref git would parse as an option, before spawning git", async () => {
    const { repoRoot, baseRoot } = fixture();
    for (const ref of ["--upload-pack=echo pwned", "-q", ""]) {
      const result = await withWorktree({ repoRoot, ref, baseDir: baseRoot }, () => "ran");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/begins with "-"|ref is empty/);
    }
    expect(extraWorktrees(repoRoot)).toEqual([]);
  });

  it("gives refs differing only in case distinct, coexisting worktrees", async () => {
    const { repoRoot, baseRoot } = fixture();
    // Platform-neutral: on a case-SENSITIVE filesystem both branches exist;
    // on a case-INsensitive one git refuses the second (`refs/heads/foo` is
    // one FILE) and both spellings resolve to the same commit. Either way
    // both refs RESOLVE, and either way the DIRECTORIES must differ.
    git(repoRoot, ["branch", "foo"]);
    let bothBranchesExist = true;
    try {
      git(repoRoot, ["branch", "FOO"]);
    } catch {
      bothBranchesExist = false;
    }

    const paths: string[] = [];
    const outer = await withWorktree({ repoRoot, ref: "foo", baseDir: baseRoot }, async (first) => {
      paths.push(first);
      const inner = await withWorktree({ repoRoot, ref: "FOO", baseDir: baseRoot }, (second) => {
        paths.push(second);
        // Both must exist SIMULTANEOUSLY at distinct paths.
        expect(path.resolve(second)).not.toBe(path.resolve(first));
        expect(existsSync(first)).toBe(true);
        expect(existsSync(second)).toBe(true);
        return true;
      });
      expect(inner.ok).toBe(true);
      // The inner lifecycle must not have taken the outer one down with it.
      expect(existsSync(first)).toBe(true);
      return true;
    });

    expect(outer.ok).toBe(true);
    expect(typeof bothBranchesExist).toBe("boolean");
    expect(paths).toHaveLength(2);
    expect((paths[0] as string).toLowerCase()).not.toBe((paths[1] as string).toLowerCase());
    for (const created of paths) expect(existsSync(created)).toBe(false);
    expect(extraWorktrees(repoRoot)).toEqual([]);
  });

  it("derives the directory name from the REF, not from randomness alone", () => {
    // The property the case-collision design rests on. Deleting `sha256(ref)`
    // from the name breaks BOTH halves of this, which a distinctness-only
    // assertion (satisfied by the random suffix alone) would never notice.
    expect(refHash("foo")).toBe(refHash("foo"));
    expect(refHash("foo")).not.toBe(refHash("FOO"));
    expect(refHash("foo")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("runs genuinely parallel lifecycles without one sweep deleting another's worktree", async () => {
    const { repoRoot, baseRoot, base } = fixture();
    // Staggered starts so the `worktree add` calls do not contend on git's
    // index lock, but with holds long enough that every lifecycle's
    // reclaim-before-create sweep runs while its siblings are LIVE — the
    // exact window the pre-registration in `withWorktree` protects.
    const results = await Promise.all(
      [0, 1, 2].map(async (i) => {
        await new Promise((resolve) => setTimeout(resolve, i * 400));
        return withWorktree({ repoRoot, ref: "HEAD", baseDir: baseRoot }, async (worktreePath) => {
          await new Promise((resolve) => setTimeout(resolve, 1500 - i * 400));
          // Still ours after every sibling's reclaim sweep ran.
          return existsSync(path.join(worktreePath, "a.ts"));
        });
      }),
    );
    for (const result of results) {
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
        expect(result.degradations).toEqual([]);
      }
    }
    expect(new Set(results.map((r) => (r.ok ? r.worktreePath : ""))).size).toBe(3);
    expect(extraWorktrees(repoRoot)).toEqual([]);
    expect(residue(base)).toEqual([]);
  });

  it("declares the base-dir degrade instead of failing silently", async () => {
    const { repoRoot, baseRoot } = fixture();
    const root = tempDir();
    // Unusable preferred base: a path UNDER a regular file (ENOTDIR/EEXIST).
    const blocker = path.join(root, "blocker");
    writeFileSync(blocker, "not a directory\n");
    const unusable = path.join(blocker, "nested");

    const result = await withWorktree(
      { repoRoot, ref: "HEAD", baseDir: unusable, fallbackBaseDir: baseRoot },
      (worktreePath) => path.dirname(worktreePath),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(path.resolve(result.value)).toBe(worktreeBaseDir(repoRoot, baseRoot));
    const degrade = result.degradations.find((d) => d.kind === "base-dir-degraded");
    expect(degrade?.subject).toBe(worktreeBaseDir(repoRoot, unusable));
    expect(degrade?.reason).toContain(worktreeBaseDir(repoRoot, baseRoot));
    expect(extraWorktrees(repoRoot)).toEqual([]);
  });

  it("degrades a base path longer than git can handle on Windows", () => {
    const { repoRoot } = fixture();
    const root = tempDir();
    const tooLong = path.join(root, "x".repeat(MAX_BASE_PATH_LENGTH + 1));
    const fallback = path.join(root, "fb");
    const resolved = prepareWorktreeBase(repoRoot, { baseDir: tooLong, fallbackBaseDir: fallback });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(path.resolve(resolved.baseDir)).toBe(worktreeBaseDir(repoRoot, fallback));
      expect(resolved.degradation?.reason).toMatch(/max 160|long base/);
    }
    expect(existsSync(tooLong)).toBe(false);
  });

  it("reports a typed failure when NEITHER base is usable", async () => {
    const { repoRoot } = fixture();
    const root = tempDir();
    const blocker = path.join(root, "blocker");
    writeFileSync(blocker, "not a directory\n");
    const bases = { baseDir: path.join(blocker, "a"), fallbackBaseDir: path.join(blocker, "b") };

    const resolved = prepareWorktreeBase(repoRoot, bases);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.reason).toMatch(/no usable worktree base/);

    const result = await withWorktree({ repoRoot, ref: "HEAD", ...bases }, () => "ran");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no usable worktree base/);

    // Reclaim on an unusable base DECLARES it rather than reporting "clean".
    const reclaim = await reclaimWorktrees({ repoRoot, ...bases });
    expect(reclaim.reclaimed).toEqual([]);
    expect(reclaim.degradations.map((d) => d.kind)).toEqual(["reclaim-failed"]);
  });
});

describe("removeWorktree", () => {
  it("is idempotent: an already-gone worktree converges instead of erroring", async () => {
    const { repoRoot, base } = fixture();
    const worktreePath = path.join(base, `${WORKTREE_PREFIX}0badc0de-000003`);
    git(repoRoot, ["worktree", "add", "--detach", worktreePath, "HEAD"]);
    expect(await removeWorktree(repoRoot, worktreePath, { attempts: 2, delayMs: 1 })).toEqual({
      attempts: 1,
    });
    // Second call: nothing registered, nothing on disk — still a clean result,
    // never a throw (git itself errors with "is not a working tree" here).
    expect(
      (await removeWorktree(repoRoot, worktreePath, { attempts: 2, delayMs: 1 })).degradation,
    ).toBeUndefined();
    expect(extraWorktrees(repoRoot)).toEqual([]);
  });

  it("does NOT report success when the registry cannot be read", async () => {
    const { repoRoot, base } = fixture();
    const worktreePath = path.join(base, `${WORKTREE_PREFIX}0badc0de-000009`);
    git(repoRoot, ["worktree", "add", "--detach", worktreePath, "HEAD"]);
    // git can no longer answer "is this registered?". A failed read is
    // UNKNOWN, never "gone" — the exact soundness hole `existsSync` + a
    // swallowed `worktree list` failure used to open.
    rmSync(path.join(repoRoot, ".git"), { recursive: true, force: true, maxRetries: 5 });

    const result = await removeWorktree(repoRoot, worktreePath, { attempts: 2, delayMs: 1 });
    expect(result.attempts).toBe(2);
    expect(result.degradation?.kind).toBe("removal-failed");
    expect(result.degradation?.reason).toMatch(/registry unreadable|not removed/);
  });

  it("clamps a nonsensical attempt budget instead of never trying", async () => {
    const { repoRoot, base } = fixture();
    const worktreePath = path.join(base, `${WORKTREE_PREFIX}0badc0de-00000a`);
    git(repoRoot, ["worktree", "add", "--detach", worktreePath, "HEAD"]);
    const result = await removeWorktree(repoRoot, worktreePath, { attempts: 0, delayMs: 1 });
    expect(result.degradation).toBeUndefined();
    expect(result.attempts).toBe(1);
    expect(existsSync(worktreePath)).toBe(false);
  });

  it("honours a human's `git worktree lock` unless the caller OWNS the worktree", async () => {
    const { repoRoot, baseRoot, base } = fixture();
    const worktreePath = path.join(base, `${WORKTREE_PREFIX}0badc0de-00000b`);
    git(repoRoot, ["worktree", "add", "--detach", worktreePath, "HEAD"]);
    writeFileSync(path.join(worktreePath, "precious.txt"), "do not delete\n");
    git(repoRoot, ["worktree", "lock", worktreePath]);

    const skipped = await removeWorktree(repoRoot, worktreePath, { attempts: 2, delayMs: 1 });
    expect(skipped.degradation?.kind).toBe("locked");
    expect(existsSync(path.join(worktreePath, "precious.txt"))).toBe(true);

    // Reclamation honours the lock too — and DECLARES it rather than being
    // silent about a worktree it deliberately left behind.
    const reclaim = await reclaimWorktrees({ repoRoot, baseDir: baseRoot });
    expect(reclaim.reclaimed).toEqual([]);
    expect(reclaim.degradations.map((d) => d.kind)).toContain("locked");
    expect(existsSync(path.join(worktreePath, "precious.txt"))).toBe(true);

    // The OWNER (the lifecycle removing its own scope) may force through it.
    const forced = await removeWorktree(repoRoot, worktreePath, {
      attempts: 3,
      delayMs: 1,
      force: true,
    });
    expect(forced.degradation).toBeUndefined();
    expect(existsSync(worktreePath)).toBe(false);
  });
});

/** A pid that is guaranteed NOT to be running: a child process, read after it
 * has already exited. Nothing else can be asserted about an arbitrary number
 * — the OS may well have handed it to somebody. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
  const pid = child.pid;
  if (pid === undefined) throw new Error("could not spawn a probe process");
  return pid;
}

describe("cross-process liveness (1.15)", () => {
  it("does NOT reclaim another live PROCESS's worktree, marker pid alive", async () => {
    const { repoRoot, baseRoot, base } = fixture();
    // Exactly the shape a sibling `guardrails` run leaves while it works:
    // registered, correctly prefixed, owned by this repo, unlocked, and NOT
    // in this process's in-memory live set — which is all the pre-1.15 guard
    // had. `process.pid` is a pid that is unquestionably alive.
    const sibling = path.join(base, `${WORKTREE_PREFIX}0badc0de-live01`);
    git(repoRoot, ["worktree", "add", "--detach", sibling, "HEAD"]);
    writeFileSync(path.join(sibling, LIVE_MARKER_NAME), `${process.pid}\n`);
    const analyzed = path.join(sibling, "a.ts");

    const result = await reclaimWorktrees({ repoRoot, baseDir: baseRoot });

    expect(result.reclaimed).toEqual([]);
    // The files the sibling is analyzing are still there — removing them out
    // from under it would turn its whole change set into "deleted files" and
    // let it report a clean review.
    expect(existsSync(analyzed)).toBe(true);
    // A concurrent run is normal operation, not a degradation: declaring it
    // would let one run drive another's exit code to 2.
    expect(result.degradations).toEqual([]);

    // And a full lifecycle beside it leaves it alone too.
    const lifecycle = await withWorktree({ repoRoot, ref: "HEAD", baseDir: baseRoot }, () => "ok");
    expect(lifecycle.ok).toBe(true);
    expect(existsSync(analyzed)).toBe(true);
    git(repoRoot, ["worktree", "remove", "--force", sibling]);
  });

  it("DECLARES a registered worktree whose liveness cannot be established, never removes it", async () => {
    const { repoRoot, baseRoot, base } = fixture();
    const unknown = path.join(base, `${WORKTREE_PREFIX}0badc0de-unkn01`);
    git(repoRoot, ["worktree", "add", "--detach", unknown, "HEAD"]);
    // No marker at all: the window between `worktree add` and the marker
    // write. Conservative — it might be somebody's live scope.
    const result = await reclaimWorktrees({ repoRoot, baseDir: baseRoot });

    expect(result.reclaimed).toEqual([]);
    expect(result.degradations.map((d) => d.kind)).toEqual(["in-use"]);
    expect(existsSync(unknown)).toBe(true);
    git(repoRoot, ["worktree", "remove", "--force", unknown]);
  });

  it("withWorktree writes the marker with THIS process's pid", async () => {
    const { repoRoot, baseRoot } = fixture();
    const seen = await withWorktree({ repoRoot, ref: "HEAD", baseDir: baseRoot }, (worktreePath) =>
      readFileSync(path.join(worktreePath, LIVE_MARKER_NAME), "utf8").trim(),
    );
    expect(seen.ok).toBe(true);
    if (!seen.ok) return;
    expect(seen.value).toBe(String(process.pid));
  });
});

describe("reclaimWorktrees", () => {
  it("removes residue with no registration", async () => {
    const { repoRoot, baseRoot, base } = fixture();
    const leftover = path.join(base, `${WORKTREE_PREFIX}deadbeef-abc123`);
    mkdirSync(path.join(leftover, "nested"), { recursive: true });
    writeFileSync(path.join(leftover, "nested", "leftover.ts"), "export const x = 1;\n");

    const result = await reclaimWorktrees({ repoRoot, baseDir: baseRoot });
    expect(result.reclaimed.map((p) => path.resolve(p))).toEqual([path.resolve(leftover)]);
    expect(result.degradations).toEqual([]);
    expect(existsSync(leftover)).toBe(false);
  });

  it("removes a prefixed FILE and a stale probe file left in the base dir", async () => {
    const { repoRoot, baseRoot, base } = fixture();
    const strayFile = path.join(base, `${WORKTREE_PREFIX}0badc0de-file`);
    writeFileSync(strayFile, "not a directory\n");
    // What a process killed mid-probe leaves behind; nothing else collects it.
    const strayProbe = path.join(base, `${PROBE_PREFIX}99999-dead`);
    writeFileSync(strayProbe, "");

    const result = await reclaimWorktrees({ repoRoot, baseDir: baseRoot });
    expect(result.reclaimed.map((p) => path.resolve(p))).toEqual([path.resolve(strayFile)]);
    expect(existsSync(strayFile)).toBe(false);
    expect(existsSync(strayProbe)).toBe(false);
    expect(result.degradations).toEqual([]);
  });

  it("prunes a registration whose directory is gone", async () => {
    const { repoRoot, baseRoot, base } = fixture();
    const worktreePath = path.join(base, `${WORKTREE_PREFIX}0badc0de-000001`);
    git(repoRoot, ["worktree", "add", "--detach", worktreePath, "HEAD"]);
    // Delete the directory behind git's back: registration without directory.
    rmSync(worktreePath, { recursive: true, force: true, maxRetries: 5 });
    expect(extraWorktrees(repoRoot)).toHaveLength(1);

    const result = await reclaimWorktrees({ repoRoot, baseDir: baseRoot });
    expect(extraWorktrees(repoRoot)).toEqual([]);
    expect(result.degradations).toEqual([]);
  });

  it("removes a registered tool worktree whose directory still exists (the kill case)", async () => {
    const { repoRoot, baseRoot, base } = fixture();
    const worktreePath = path.join(base, `${WORKTREE_PREFIX}0badc0de-000002`);
    git(repoRoot, ["worktree", "add", "--detach", worktreePath, "HEAD"]);
    // What a SIGKILLed run leaves: its liveness marker, holding a pid that is
    // no longer alive. Reclamation is exactly the recovery path for it.
    writeFileSync(path.join(worktreePath, LIVE_MARKER_NAME), `${deadPid()}\n`);

    const result = await reclaimWorktrees({ repoRoot, baseDir: baseRoot });
    expect(result.reclaimed.map((p) => path.resolve(p))).toEqual([path.resolve(worktreePath)]);
    expect(existsSync(worktreePath)).toBe(false);
    expect(extraWorktrees(repoRoot)).toEqual([]);
  });

  it("never touches a human-created worktree — inside or outside the base dir", async () => {
    const { repoRoot, baseRoot, base } = fixture();
    // (a) a human worktree in the tool's own base dir (wrong prefix)
    const humanInBase = path.join(base, "my-hotfix");
    // (b) a human worktree elsewhere entirely, even with the tool prefix
    const elsewhere = path.join(tempDir(), `${WORKTREE_PREFIX}looks-like-ours`);
    git(repoRoot, ["worktree", "add", "--detach", humanInBase, "HEAD"]);
    git(repoRoot, ["worktree", "add", "--detach", elsewhere, "HEAD"]);
    const marker = path.join(humanInBase, "precious.txt");
    writeFileSync(marker, "human work\n");

    const result = await reclaimWorktrees({ repoRoot, baseDir: baseRoot });

    expect(result.reclaimed).toEqual([]);
    expect(existsSync(marker)).toBe(true);
    expect(existsSync(path.join(elsewhere, "a.ts"))).toBe(true);
    expect(
      extraWorktrees(repoRoot)
        .map((p) => path.resolve(p))
        .sort(),
    ).toEqual([path.resolve(humanInBase), path.resolve(elsewhere)].sort());

    // And a lifecycle running beside them still leaves them alone.
    const lifecycle = await withWorktree({ repoRoot, ref: "HEAD", baseDir: baseRoot }, () => "ok");
    expect(lifecycle.ok).toBe(true);
    expect(existsSync(marker)).toBe(true);
    expect(extraWorktrees(repoRoot)).toHaveLength(2);

    git(repoRoot, ["worktree", "remove", "--force", humanInBase]);
    git(repoRoot, ["worktree", "remove", "--force", elsewhere]);
  });

  it("cannot even SEE another repository's worktrees in a shared machine base", async () => {
    const shared = tempDir();
    const first = fixture();
    const second = fixture();
    // Both repos use the SAME base root — exactly the `os.tmpdir()` situation
    // that used to let one process delete another's LIVE worktree.
    const firstBase = worktreeBaseDir(first.repoRoot, shared);
    const secondBase = worktreeBaseDir(second.repoRoot, shared);
    expect(firstBase).not.toBe(secondBase);

    mkdirSync(firstBase, { recursive: true });
    const live = path.join(firstBase, `${WORKTREE_PREFIX}0badc0de-live01`);
    git(first.repoRoot, ["worktree", "add", "--detach", live, "HEAD"]);

    const reclaim = await reclaimWorktrees({ repoRoot: second.repoRoot, baseDir: shared });
    expect(reclaim.reclaimed).toEqual([]);
    expect(reclaim.degradations).toEqual([]);
    expect(existsSync(path.join(live, "a.ts"))).toBe(true);
    expect(extraWorktrees(first.repoRoot).map((p) => path.resolve(p))).toEqual([path.resolve(live)]);

    git(first.repoRoot, ["worktree", "remove", "--force", live]);
  });

  it("declares — never deletes — a prefixed directory whose .git points at another repo", async () => {
    const { repoRoot, baseRoot, base } = fixture();
    const foreign = fixture();
    const foreignWorktree = path.join(base, `${WORKTREE_PREFIX}0badc0de-foreign`);
    // A LIVE worktree of ANOTHER repository, sitting inside our namespaced
    // base (the belt-and-braces check behind the namespace).
    git(foreign.repoRoot, ["worktree", "add", "--detach", foreignWorktree, "HEAD"]);
    const precious = path.join(foreignWorktree, "precious.txt");
    writeFileSync(precious, "another repo's live work\n");

    const result = await reclaimWorktrees({ repoRoot, baseDir: baseRoot });
    expect(result.reclaimed).toEqual([]);
    expect(result.degradations.map((d) => d.kind)).toEqual(["unowned"]);
    expect(path.resolve(result.degradations[0]?.subject as string)).toBe(
      path.resolve(foreignWorktree),
    );
    expect(existsSync(precious)).toBe(true);

    git(foreign.repoRoot, ["worktree", "remove", "--force", foreignWorktree]);
  });

  it("never reclaims the worktree it is invoked FROM", async () => {
    const shared = tempDir();
    const seed = initRepo(path.join(tempDir(), "seed"));
    const seedBase = worktreeBaseDir(seed, shared);
    mkdirSync(seedBase, { recursive: true });
    // The invoking tree is itself a tool-PREFIXED linked worktree — the shape
    // a nested/self-referential run has. Reclaiming it would delete the run
    // out from under itself.
    const invoking = path.join(seedBase, `${WORKTREE_PREFIX}0badc0de-self01`);
    git(seed, ["worktree", "add", "--detach", invoking, "HEAD"]);
    const invokingBase = worktreeBaseDir(invoking, shared);
    mkdirSync(invokingBase, { recursive: true });
    const realResidue = path.join(invokingBase, `${WORKTREE_PREFIX}0badc0de-junk01`);
    mkdirSync(realResidue, { recursive: true });

    const reclaim = await reclaimWorktrees({ repoRoot: invoking, baseDir: shared });

    expect(reclaim.reclaimed.map((p) => path.resolve(p))).toEqual([path.resolve(realResidue)]);
    expect(existsSync(path.join(invoking, "a.ts"))).toBe(true);
    expect(
      extraWorktrees(seed)
        .map((p) => path.resolve(p))
        .includes(path.resolve(invoking)),
    ).toBe(true);

    git(seed, ["worktree", "remove", "--force", invoking]);
  });

  it("sweeps the previously-used base after a degrade, so residue is never orphaned", async () => {
    const { repoRoot } = fixture();
    const root = tempDir();
    // A base root that is perfectly READABLE but too long for git on Windows:
    // run N leaves residue there, run N+1 degrades away from it, and a sweep
    // that only visited the resolved base would orphan that residue forever.
    const padded = path.join(root, "p".repeat(Math.max(1, MAX_BASE_PATH_LENGTH - root.length)));
    const preferred = worktreeBaseDir(repoRoot, padded);
    expect(preferred.length).toBeGreaterThan(MAX_BASE_PATH_LENGTH);
    const orphan = path.join(preferred, `${WORKTREE_PREFIX}0badc0de-orphan`);
    mkdirSync(orphan, { recursive: true });
    writeFileSync(path.join(orphan, "left.txt"), "from the run before the degrade\n");

    const fallback = path.join(root, "fb");
    const result = await reclaimWorktrees({
      repoRoot,
      baseDir: padded,
      fallbackBaseDir: fallback,
    });

    expect(result.degradations.map((d) => d.kind)).toEqual(["base-dir-degraded"]);
    expect(result.reclaimed.map((p) => path.resolve(p))).toEqual([path.resolve(orphan)]);
    expect(existsSync(orphan)).toBe(false);
  });
});

describe("degradation contract adapter", () => {
  it("round-trips through the canonical manifest Degradation shape", () => {
    const kinds = [
      "base-dir-degraded",
      "removal-failed",
      "reclaim-failed",
      "locked",
      "unowned",
    ] as const;
    for (const kind of kinds) {
      const original = { kind, subject: "C:\\tmp\\agtwt-abc", reason: "because: reasons — here" };
      const manifest = toManifestDegradation(original);
      // The canonical contract has NO `kind` field; this must validate.
      expect(degradationSchema.parse(manifest)).toEqual(manifest);
      expect(Object.keys(manifest).sort()).toEqual(["reason", "subject"]);
      expect(fromManifestDegradation(manifest)).toEqual(original);
    }
    // A degradation that did not come from here is not misclassified silently.
    expect(fromManifestDegradation({ subject: "x", reason: "plain reason" }).kind).toBe(
      "reclaim-failed",
    );
  });
});

describe("parseWorktreeList", () => {
  it("parses records, resolves paths, and flags locked entries", () => {
    const entries = parseWorktreeList(
      "worktree /a/main\nHEAD abc\nbranch refs/heads/main\n\n" +
        "worktree /a/wt\nHEAD def\ndetached\nlocked reason here\n\n",
    );
    expect(entries).toHaveLength(2);
    expect(entries[1]?.locked).toBe(true);
    expect(entries[0]?.locked).toBe(false);
    expect(entries.map((e) => e.path)).toEqual([path.resolve("/a/main"), path.resolve("/a/wt")]);
  });
});
