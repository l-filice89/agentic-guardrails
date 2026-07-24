/**
 * RunManifest construction — the zero-silent-degradation carrier. Inputs
 * that do not exist yet (disposition ledger, corpus baseline — both Story
 * 1.8) are recorded with the SENTINEL hash of the empty string plus an
 * explicit degraded entry naming the absence. Never a fake value presented
 * as real.
 */
import { createHash } from "node:crypto";

import type { Degradation, RunManifest } from "@agentic-guardrails/contracts";

// ponytail: single source of the engine version — mirrors packages/core and
// packages/cli package.json "version" (the CLI's `program.version` imports
// this constant); switch to `import pkg from "../../package.json" with
// { type: "json" }` when releases start bumping versions and drift becomes
// possible.
export const ENGINE_VERSION = "0.0.1";

/** Version of the deterministic ruleset (one rule so far: 1.4 skeleton). */
export const RULESET_VERSION = "1";

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
}

export function buildRunManifest(options: BuildRunManifestOptions = {}): BuiltManifest {
  const axiomsOff = options.axiomsOff ?? [];
  // Keys in fixed order — the manifest is embedded in the byte-stable artifact.
  const manifest: RunManifest = {
    schemaVersion: 1,
    ledgerHash: ABSENT_SHA256,
    corpusHash: ABSENT_SHA256,
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
  };
  return {
    manifest,
    degraded: [
      {
        reason: "disposition ledger absent until init (story 1.8); sentinel hash recorded",
        subject: "ledger",
      },
      {
        reason: "corpus baseline absent until init (story 1.8); sentinel hash recorded",
        subject: "corpus",
      },
    ],
  };
}
