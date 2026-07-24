import { z } from "zod";

import { dispositionRecordSchema } from "./disposition-record.js";
import { runManifestSchema } from "./run-manifest.js";
import { trendRecordSchema } from "./trend-record.js";

/** Minimal shape every versioned artifact carries. */
export const versionedArtifactSchema = z.object({
  schemaVersion: z.int().min(1),
});

/** One forward step: upgrades an artifact from `fromVersion` to `fromVersion + 1`. */
export type MigrationStep = (old: Record<string, unknown>) => Record<string, unknown>;

export interface ArtifactLadder {
  currentVersion: number;
  schema: z.ZodType;
  /** fromVersion → step producing fromVersion + 1. Empty at v1 by design. */
  steps: Record<number, MigrationStep>;
}

/** Maps built-in artifact kinds to their migrated (current-version) types. */
export interface ArtifactTypeMap {
  "run-manifest": z.infer<typeof runManifestSchema>;
  "trend-record": z.infer<typeof trendRecordSchema>;
  "disposition-record": z.infer<typeof dispositionRecordSchema>;
}

/**
 * Registry of persisted-artifact kinds. v1 ladders are empty — there is no
 * v0 in the wild; real steps are registered when a schema first changes.
 * Null prototype: `kind` can come from persisted/external data, and
 * "toString"/"constructor" must be unknown kinds, not prototype junk.
 */
const registry: Record<string, ArtifactLadder> = Object.assign(Object.create(null), {
  "run-manifest": { currentVersion: 1, schema: runManifestSchema, steps: {} },
  "trend-record": { currentVersion: 1, schema: trendRecordSchema, steps: {} },
  "disposition-record": { currentVersion: 1, schema: dispositionRecordSchema, steps: {} },
});

export type MigrateResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code: MigrateErrorCode; message: string; issues?: z.ZodIssue[] } };

export type MigrateErrorCode =
  | "unknown-kind"
  | "invalid-artifact"
  | "future-version"
  | "missing-step"
  | "step-failed";

/**
 * Registers an additional artifact kind (test-only escape hatch to prove
 * multi-step chaining with a synthetic kind). Never throws: returns `false`
 * without touching the registry when the kind already exists (built-ins
 * cannot be clobbered) or the ladder is malformed; `true` on success.
 */
export function registerArtifactKind(kind: string, ladder: ArtifactLadder): boolean {
  if (Object.hasOwn(registry, kind)) return false;
  if (!Number.isInteger(ladder.currentVersion) || ladder.currentVersion < 1) return false;
  registry[kind] = ladder;
  return true;
}

/**
 * Stepwise forward migration: upgrades `raw` from its `schemaVersion` to the
 * kind's current version, one step at a time, then `safeParse`s with the
 * current schema. Never throws — every failure is a typed error result,
 * including unknown/future versions. The input object is never mutated.
 */
export function migrateArtifact<K extends keyof ArtifactTypeMap>(
  kind: K,
  raw: unknown,
): MigrateResult<ArtifactTypeMap[K]>;
export function migrateArtifact(kind: string, raw: unknown): MigrateResult;
export function migrateArtifact(kind: string, raw: unknown): MigrateResult {
  if (!Object.hasOwn(registry, kind)) {
    return { ok: false, error: { code: "unknown-kind", message: `unknown artifact kind: ${kind}` } };
  }
  const ladder = registry[kind];
  const envelope = versionedArtifactSchema.safeParse(raw);
  if (!envelope.success) {
    return {
      ok: false,
      error: {
        code: "invalid-artifact",
        message: "artifact has no valid integer schemaVersion >= 1",
        issues: envelope.error.issues,
      },
    };
  }
  let version = envelope.data.schemaVersion;
  if (version > ladder.currentVersion) {
    return {
      ok: false,
      error: {
        code: "future-version",
        message: `artifact ${kind} is at v${version}, engine only knows v${ladder.currentVersion}`,
      },
    };
  }
  // Shallow copy so a step that mutates its input can never leave the
  // caller's original half-migrated after a failure.
  let current: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  while (version < ladder.currentVersion) {
    const step = ladder.steps[version];
    if (!step) {
      return {
        ok: false,
        error: { code: "missing-step", message: `no migration step for ${kind} v${version}` },
      };
    }
    let next: unknown;
    try {
      next = step(current);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return {
        ok: false,
        error: { code: "step-failed", message: `migration step ${kind} v${version} failed: ${detail}` },
      };
    }
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      return {
        ok: false,
        error: {
          code: "step-failed",
          message: `migration step ${kind} v${version} returned a non-object`,
        },
      };
    }
    current = { ...(next as Record<string, unknown>), schemaVersion: version + 1 };
    version += 1;
  }
  const parsed = ladder.schema.safeParse(current);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "invalid-artifact",
        message: `migrated ${kind} artifact failed validation`,
        issues: parsed.error.issues,
      },
    };
  }
  return { ok: true, value: parsed.data };
}
