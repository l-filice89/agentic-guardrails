/**
 * RunManifest construction — the zero-silent-degradation carrier. When the
 * committed knowledge files exist (`conventions.yaml` / `corpus-map.yaml`,
 * seeded by `guardrails init`), `ledgerHash`/`corpusHash` are the sha256 of
 * their bytes; an absent file is recorded with the SENTINEL hash of the
 * empty string plus an explicit degraded entry naming the absence. Never a
 * fake value presented as real.
 */
import { createHash } from "node:crypto";

import type { Degradation, RunManifest } from "@agentic-guardrails/contracts";

// ponytail: single source of the engine version — mirrors packages/core and
// packages/cli package.json "version" (the CLI's `program.version` imports
// this constant); switch to `import pkg from "../../package.json" with
// { type: "json" }` when releases start bumping versions and drift becomes
// possible.
// 0.0.2: the cached-graph payload schema changed in 1.9 (edge `line`,
// `unresolvedImports`) — the bump gives pre-upgrade cache entries new keys,
// so a warm repo takes the clean-miss path instead of strict-revalidation
// failure (which would read as corruption and degrade the run).
// 0.0.3: the cached-graph payload schema changed again in 1.10 (edge
// `names` — the unused-export usage substrate); same clean-miss rationale.
export const ENGINE_VERSION = "0.0.3";

/** Version of the deterministic ruleset ("6": Story 1.13 adds the three-rule
 * axiom-6 conformance set — prevalence-gated over the 1.8 structural corpus
 * seed — alongside the 1.9 axiom-1, 1.10 axiom-3, 1.11 axiom-4, and 1.12
 * axiom-5 sets). ENGINE_VERSION stays at 0.0.3 on purpose: 1.13 changes no
 * cached payload schema — RULESET_VERSION alone invalidates the findings
 * cache. */
export const RULESET_VERSION = "6";

/** sha256 of the empty string — the sentinel for "this input does not exist yet". */
export const ABSENT_SHA256 = createHash("sha256").update("").digest("hex");

/** Numeric-aware string compare ("2" < "10") for axiom-id ordering. */
export function numericCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

export interface BuiltManifest {
  manifest: RunManifest;
  /** The typed declarations of what the sentinel hashes stand for. */
  degraded: Degradation[];
}

export interface BuildRunManifestOptions {
  axiomsOff?: readonly string[];
  /** sha256 hex of config.yaml bytes; literal "absent" when no file. */
  configHash?: string;
  configPresent?: boolean;
  /** Effective post-default enforcement config, keyed by axiom id. */
  enforcement?: RunManifest["enforcement"];
  configGitStatus?: RunManifest["configGitStatus"];
  /** Declared six-phase assembly (1.7). */
  phases?: RunManifest["phases"];
  /** Content-addressed-cache lookup counters (1.7). */
  cache?: RunManifest["cache"];
  /** sha256 hex of committed conventions.yaml bytes (1.8); omitted → the
   * absent-file sentinel plus its degraded entry. */
  ledgerHash?: string;
  /** sha256 hex of committed corpus-map.yaml bytes (1.8); omitted → the
   * absent-file sentinel plus its degraded entry. NOT the structural corpus
   * seed — see `corpusSeedHash`. */
  corpusHash?: string;
  /** sha256 hex of the DERIVED structural corpus seed bytes (1.8's
   * `.cache/corpus/structural-seed.json`) — the corpus axiom 6 judged
   * against, recorded so its findings are reproducible from the manifest.
   * Omitted when no seed was read (no sentinel: absence is already declared
   * by axiom 6's own degradation). */
  corpusSeedHash?: string;
}

export function buildRunManifest(options: BuildRunManifestOptions = {}): BuiltManifest {
  const axiomsOff = options.axiomsOff ?? [];
  // Keys in fixed order — the manifest is embedded in the byte-stable artifact.
  const manifest: RunManifest = {
    schemaVersion: 1,
    ledgerHash: options.ledgerHash ?? ABSENT_SHA256,
    corpusHash: options.corpusHash ?? ABSENT_SHA256,
    ...(options.corpusSeedHash === undefined ? {} : { corpusSeedHash: options.corpusSeedHash }),
    rulesetVersion: RULESET_VERSION,
    tierEnablement: { deterministic: true, llm: false },
    engineVersion: ENGINE_VERSION,
    ...(options.configHash === undefined ? {} : { configHash: options.configHash }),
    ...(options.configPresent === undefined ? {} : { configPresent: options.configPresent }),
    ...(options.enforcement === undefined ? {} : { enforcement: options.enforcement }),
    ...(options.configGitStatus === undefined
      ? {}
      : { configGitStatus: options.configGitStatus }),
    // Off-by-config axioms are declared (not degradation — the user chose it);
    // omitted entirely when none, keeping pre-1.6 artifact bytes unchanged.
    ...(axiomsOff.length > 0 ? { axiomsOff: [...axiomsOff].sort(numericCompare) } : {}),
    ...(options.phases === undefined ? {} : { phases: options.phases }),
    ...(options.cache === undefined ? {} : { cache: options.cache }),
  };
  // A real hash drops the matching degradation; an absent file keeps the
  // sentinel + declaration exactly as before init existed.
  const degraded: Degradation[] = [];
  if (options.ledgerHash === undefined) {
    degraded.push({
      reason: "disposition ledger absent until init (story 1.8); sentinel hash recorded",
      subject: "ledger",
    });
  }
  if (options.corpusHash === undefined) {
    degraded.push({
      reason: "corpus baseline absent until init (story 1.8); sentinel hash recorded",
      subject: "corpus",
    });
  }
  return { manifest, degraded };
}
