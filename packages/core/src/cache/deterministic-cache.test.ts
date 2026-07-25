import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  CACHE_MAX_ENTRIES_PER_KIND,
  DeterministicCache,
  loadCacheSecret,
} from "./deterministic-cache.js";

// Heavy filesystem churn (100+ entry prune) can exceed the 5s default
// under full-suite parallel load.
vi.setConfig({ testTimeout: 30_000 });

const schema = z.strictObject({ value: z.number() });
const KEY = "a".repeat(64);
const SECRET = Buffer.from("0123456789abcdef0123456789abcdef");

const tempDirs: string[] = [];
function cacheRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-cache-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeCache(root: string, secret: Buffer = SECRET): DeterministicCache {
  return new DeterministicCache(root, secret);
}

describe("DeterministicCache", () => {
  it("round-trips a value through put/get (atomic write, no temp files left)", () => {
    const root = cacheRoot();
    const cache = makeCache(root);
    cache.put("findings", KEY, { value: 42 });
    expect(cache.get("findings", KEY, schema)).toEqual({ hit: true, value: { value: 42 } });
    expect(readdirSync(path.join(root, "findings")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("a missing entry is a clean miss, not an invalid one", () => {
    expect(makeCache(cacheRoot()).get("findings", KEY, schema)).toEqual({
      hit: false,
      invalid: false,
    });
  });

  it("HAZARD: a torn/garbage entry is an invalid miss — never a crash — and put overwrites it", () => {
    const root = cacheRoot();
    const cache = makeCache(root);
    cache.put("findings", KEY, { value: 1 });
    writeFileSync(path.join(root, "findings", `${KEY}.json`), "{ torn garba");
    expect(cache.get("findings", KEY, schema)).toEqual({ hit: false, invalid: true });
    cache.put("findings", KEY, { value: 2 });
    expect(cache.get("findings", KEY, schema)).toEqual({ hit: true, value: { value: 2 } });
  });

  it("schema drift (valid JSON, wrong shape) is an invalid miss — never wrong data", () => {
    const root = cacheRoot();
    const cache = makeCache(root);
    // Written with the REAL secret so the MAC verifies — it is the SCHEMA
    // check (stale shape), not the MAC, rejecting this one.
    cache.put("findings", KEY, { other: true });
    expect(cache.get("findings", KEY, schema)).toEqual({ hit: false, invalid: true });
  });

  it("HAZARD: a planted schema-valid entry WITHOUT a valid MAC is never served", () => {
    const root = cacheRoot();
    const cache = makeCache(root);
    mkdirSync(path.join(root, "findings"), { recursive: true });
    const entryPath = path.join(root, "findings", `${KEY}.json`);
    // No mac at all (attacker doesn't know the envelope): invalid miss.
    writeFileSync(entryPath, '{"value":13}\n');
    expect(cache.get("findings", KEY, schema)).toEqual({ hit: false, invalid: true });
    // Schema-valid payload with a WRONG mac: still an invalid miss.
    writeFileSync(entryPath, `{"mac":"${"0".repeat(64)}","payload":{"value":13}}\n`);
    expect(cache.get("findings", KEY, schema)).toEqual({ hit: false, invalid: true });
  });

  it("HAZARD: tampering with a written entry's payload breaks the MAC", () => {
    const root = cacheRoot();
    const cache = makeCache(root);
    cache.put("findings", KEY, { value: 1 });
    const entryPath = path.join(root, "findings", `${KEY}.json`);
    const tampered = readFileSync(entryPath, "utf8").replace('"value":1', '"value":666');
    writeFileSync(entryPath, tampered);
    expect(cache.get("findings", KEY, schema)).toEqual({ hit: false, invalid: true });
  });

  it("an entry written under a different secret is not served", () => {
    const root = cacheRoot();
    makeCache(root, Buffer.from("attacker-controlled-secret-bytes")).put("findings", KEY, {
      value: 13,
    });
    expect(makeCache(root).get("findings", KEY, schema)).toEqual({ hit: false, invalid: true });
  });

  it("prunes each kind to the newest entries by mtime", () => {
    const root = cacheRoot();
    const cache = makeCache(root);
    const extra = 5;
    for (let i = 0; i < CACHE_MAX_ENTRIES_PER_KIND + extra; i++) {
      const key = i.toString(16).padStart(64, "0");
      cache.put("graph", key, { value: i });
      // Explicit mtimes — fast writes share the same wall-clock millisecond.
      utimesSync(path.join(root, "graph", `${key}.json`), new Date(1000 + i), new Date(1000 + i));
    }
    // One more write triggers the prune with deterministic mtimes in place.
    const lastKey = "f".repeat(64);
    cache.put("graph", lastKey, { value: -1 });
    const entries = readdirSync(path.join(root, "graph"));
    expect(entries.length).toBe(CACHE_MAX_ENTRIES_PER_KIND);
    // The oldest entries are the ones gone.
    expect(entries).not.toContain(`${"0".repeat(64)}.json`);
    expect(entries).toContain(`${lastKey}.json`);
  });

  it("sweeps orphaned .tmp files older than an hour during prune, sparing fresh ones", () => {
    const root = cacheRoot();
    const cache = makeCache(root);
    cache.put("graph", KEY, { value: 1 });
    const dir = path.join(root, "graph");
    const oldTmp = path.join(dir, "dead.1234.aa.tmp");
    const freshTmp = path.join(dir, "live.5678.bb.tmp");
    writeFileSync(oldTmp, "torn");
    writeFileSync(freshTmp, "in-flight");
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    utimesSync(oldTmp, twoHoursAgo, twoHoursAgo);
    cache.put("graph", "b".repeat(64), { value: 2 }); // triggers prune
    const tmps = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(tmps).toEqual(["live.5678.bb.tmp"]);
  });

  it("rejects a non-hex key before it can become a path segment", () => {
    const cache = makeCache(cacheRoot());
    expect(() => cache.get("findings", "../escape", schema)).toThrow(/invalid cache key/);
  });

  it("writes a MAC-authenticated envelope as compact JSON with one trailing newline", () => {
    const root = cacheRoot();
    makeCache(root).put("findings", KEY, { value: 7 });
    const raw = readFileSync(path.join(root, "findings", `${KEY}.json`), "utf8");
    expect(raw).toMatch(/^\{"mac":"[0-9a-f]{64}","payload":\{"value":7\}\}\n$/);
  });
});

describe("loadCacheSecret", () => {
  it("creates a 32-byte secret on first use and returns the same bytes afterwards", () => {
    const secretPath = path.join(cacheRoot(), "nested", "cache-secret");
    const first = loadCacheSecret(secretPath);
    expect(first).toBeDefined();
    expect(first!.length).toBe(32);
    expect(loadCacheSecret(secretPath)).toEqual(first);
  });

  it("returns undefined when the secret can neither be read nor created", () => {
    // The secret path IS a directory: unreadable as a file, unwritable as one.
    const dir = cacheRoot();
    expect(loadCacheSecret(dir)).toBeUndefined();
  });
});
