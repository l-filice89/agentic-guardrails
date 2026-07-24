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

  it("declares each sentinel with a typed degraded entry (zero silent degradation)", () => {
    const { degraded } = buildRunManifest();
    expect(degraded.map((d) => d.subject).sort()).toEqual(["corpus", "ledger"]);
    for (const entry of degraded) {
      expect(entry.reason).toContain("absent until init (story 1.8)");
    }
  });
});
