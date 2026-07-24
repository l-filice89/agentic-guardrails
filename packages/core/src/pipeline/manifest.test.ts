import { runManifestSchema } from "@agentic-guardrails/contracts";
import { describe, expect, it } from "vitest";

import { ABSENT_SHA256, buildRunManifest } from "./manifest.js";

describe("buildRunManifest", () => {
  it("produces a schema-valid manifest with deterministic tier only", () => {
    const { manifest } = buildRunManifest();
    const parsed = runManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
    expect(manifest.tierEnablement).toEqual({ deterministic: true, llm: false });
    expect(manifest.modelIdentity).toBeUndefined();
  });

  it("uses the empty-string sha256 sentinel for absent ledger and corpus", () => {
    const { manifest } = buildRunManifest();
    // The literal sha256 of "" — a recognizable sentinel, never a faked hash.
    expect(ABSENT_SHA256).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(manifest.ledgerHash).toBe(ABSENT_SHA256);
    expect(manifest.corpusHash).toBe(ABSENT_SHA256);
  });

  it("declares off-by-config axioms sorted numeric-aware, and omits the key entirely when none", () => {
    expect(buildRunManifest().manifest).not.toHaveProperty("axiomsOff");
    const { manifest } = buildRunManifest({ axiomsOff: ["10", "5", "1"] });
    expect(manifest.axiomsOff).toEqual(["1", "5", "10"]);
    expect(runManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("carries the governing config: hash, presence, effective enforcement, git status", () => {
    const { manifest } = buildRunManifest({
      configHash: "absent",
      configPresent: false,
      enforcement: { "5": { enforcement: "blocking" } },
      configGitStatus: "absent",
    });
    expect(manifest.configHash).toBe("absent");
    expect(manifest.configPresent).toBe(false);
    expect(manifest.enforcement).toEqual({ "5": { enforcement: "blocking" } });
    expect(manifest.configGitStatus).toBe("absent");
    expect(runManifestSchema.safeParse(manifest).success).toBe(true);
    // Omitted inputs stay omitted — pre-1.6 manifest bytes unchanged.
    expect(buildRunManifest().manifest).not.toHaveProperty("configHash");
    expect(buildRunManifest().manifest).not.toHaveProperty("configGitStatus");
  });

  it("declares each sentinel with a typed degraded entry (zero silent degradation)", () => {
    const { degraded } = buildRunManifest();
    expect(degraded.map((d) => d.subject).sort()).toEqual(["corpus", "ledger"]);
    for (const entry of degraded) {
      expect(entry.reason).toContain("absent until init (story 1.8)");
    }
  });
});
