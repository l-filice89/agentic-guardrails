/**
 * Content-addressed deterministic cache (story 1.7), stored under
 * `_agentic-guardrails/.cache/<kind>/<key>.json` (gitignored by the seeded
 * output .gitignore).
 *
 * Key vs runId asymmetry: the runId identifies the WHOLE run (it includes
 * HEAD), while cache keys identify per-unit work by CONTENT only (tsconfig
 * + participating-file hashes, changed-file hashes, versions, tier
 * enablement) — so an unrelated commit (new HEAD, identical content) still
 * cache-hits.
 *
 * AUTHENTICATION: `.cache/` lives inside the analyzed repo — attacker-
 * writable territory — and keys are computable from public inputs, so a
 * schema-valid entry can be planted. Every entry therefore carries
 * `mac = HMAC-SHA256(secret, key + payload JSON)` keyed by a per-user
 * secret outside the repo (`~/.agentic-guardrails/cache-secret`). The MAC
 * is verified BEFORE schema revalidation; a mismatch is a typed invalid
 * miss (recompute + overwrite), never served data.
 *
 * Every read then revalidates through a Zod schema: a torn, garbage, or
 * stale-shape entry is a typed miss (`invalid: true`) that the caller
 * recomputes and overwrites — never a crash, never wrong data. Writes are
 * atomic (temp file → fsync → rename) and each kind is pruned to the
 * newest CACHE_MAX_ENTRIES_PER_KIND entries by mtime, mirroring the
 * manifests-pruning convention.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import type { z } from "zod";

import { writeFileAtomic } from "../persistence/artifact-writer.js";

/** Newest entries kept per kind after each write. */
export const CACHE_MAX_ENTRIES_PER_KIND = 100;

/** Orphaned `*.tmp` files (crashed writer) older than this are junk. */
const TMP_ORPHAN_MAX_AGE_MS = 3_600_000;

/** Keys are internal sha256 hex — anything else is a caller bug, rejected
 * before it can become a path segment. */
const KEY_PATTERN = /^[0-9a-f]{16,64}$/;

/** Default location of the per-user cache-authentication secret. */
export function defaultCacheSecretPath(): string {
  return path.join(os.homedir(), ".agentic-guardrails", "cache-secret");
}

/**
 * Reads the per-user cache secret, creating it (32 random bytes, mode 0600 —
 * best-effort on Windows, which has no POSIX modes) on first use. Returns
 * undefined when the secret can neither be read nor created — the caller
 * must then DISABLE caching for the run with a declared reason; running
 * unauthenticated is never an option.
 */
export function loadCacheSecret(secretPath = defaultCacheSecretPath()): Buffer | undefined {
  try {
    const existing = readFileSync(secretPath);
    if (existing.length > 0) return existing;
  } catch {
    // Missing (or unreadable) — fall through to the create attempt.
  }
  try {
    mkdirSync(path.dirname(secretPath), { recursive: true });
    const secret = randomBytes(32);
    writeFileSync(secretPath, secret, { mode: 0o600 });
    return secret;
  } catch {
    // Creation failed — one last read in case a concurrent run won the race.
    try {
      const raced = readFileSync(secretPath);
      return raced.length > 0 ? raced : undefined;
    } catch {
      return undefined;
    }
  }
}

export type CacheReadResult<T> =
  | { hit: true; value: T }
  | { hit: false; /** true → entry existed but failed MAC, JSON.parse, or schema. */ invalid: boolean };

export class DeterministicCache {
  /**
   * @param root absolute path to `_agentic-guardrails/.cache`.
   * @param secret per-user HMAC key from {@link loadCacheSecret}.
   */
  constructor(
    private readonly root: string,
    private readonly secret: Buffer,
  ) {}

  get<T>(kind: string, key: string, schema: z.ZodType<T>): CacheReadResult<T> {
    const entryPath = this.entryPath(kind, key); // throws on a caller bug, outside the miss path
    let raw: string;
    try {
      raw = readFileSync(entryPath, "utf8");
    } catch {
      return { hit: false, invalid: false };
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return { hit: false, invalid: true };
    }
    // MAC verification comes BEFORE schema validation: an unauthenticated
    // entry gets no say, however plausible its shape.
    if (typeof data !== "object" || data === null) return { hit: false, invalid: true };
    const envelope = data as { mac?: unknown; payload?: unknown };
    if (typeof envelope.mac !== "string" || !("payload" in envelope)) {
      return { hit: false, invalid: true };
    }
    const expected = this.mac(key, JSON.stringify(envelope.payload));
    const actual = Buffer.from(envelope.mac, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return { hit: false, invalid: true };
    }
    const parsed = schema.safeParse(envelope.payload);
    return parsed.success ? { hit: true, value: parsed.data } : { hit: false, invalid: true };
  }

  /** Write-through, then prune the kind. A cache-write failure is silently
   * swallowed — the caller already holds the computed value, and a cache
   * that cannot write must never fail the run. */
  put(kind: string, key: string, value: unknown): void {
    const entryPath = this.entryPath(kind, key); // throws on a caller bug, never swallowed
    try {
      const dir = path.join(this.root, kind);
      mkdirSync(dir, { recursive: true });
      const payloadJson = JSON.stringify(value);
      const mac = this.mac(key, payloadJson).toString("hex");
      writeFileAtomic(entryPath, `{"mac":"${mac}","payload":${payloadJson}}\n`);
      prune(dir);
    } catch {
      // best-effort by design
    }
  }

  private mac(key: string, payloadJson: string): Buffer {
    return createHmac("sha256", this.secret).update(key).update(payloadJson).digest();
  }

  private entryPath(kind: string, key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error(`invalid cache key: ${JSON.stringify(key)}`);
    return path.join(this.root, kind, `${key}.json`);
  }
}

function prune(dir: string): void {
  const all = readdirSync(dir);
  // Sweep orphaned temp files a crashed writer left behind (age-gated so a
  // concurrent in-flight write is never swept).
  const cutoff = Date.now() - TMP_ORPHAN_MAX_AGE_MS;
  for (const f of all.filter((name) => name.endsWith(".tmp"))) {
    const tmpPath = path.join(dir, f);
    try {
      if (statSync(tmpPath).mtimeMs < cutoff) rmSync(tmpPath, { force: true });
    } catch {
      // already gone or unstattable — best-effort
    }
  }
  const entries = all.filter((f) => f.endsWith(".json"));
  if (entries.length <= CACHE_MAX_ENTRIES_PER_KIND) return;
  entries
    .map((f) => ({ f, mtime: statSync(path.join(dir, f)).mtimeMs }))
    // Newest first; name breaks mtime ties so pruning stays deterministic.
    .sort((a, b) => b.mtime - a.mtime || (a.f < b.f ? -1 : 1))
    .slice(CACHE_MAX_ENTRIES_PER_KIND)
    .forEach((e) => rmSync(path.join(dir, e.f), { force: true }));
}
