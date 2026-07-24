import { computeFindingId, type Finding } from "@agentic-guardrails/contracts";
import type { ReviewArtifact } from "@agentic-guardrails/core";
import { describe, expect, it } from "vitest";

import { formatSummary } from "./review-command.js";

const MANIFEST = {
  schemaVersion: 1,
  ledgerHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  corpusHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  rulesetVersion: "1",
  tierEnablement: { deterministic: true, llm: false },
  engineVersion: "0.0.1",
};

function finding(): Finding {
  const cycle = "src/a.ts -> src/b.ts -> src/a.ts";
  return {
    findingId: computeFindingId({
      axiom: "1",
      ruleId: "structural/circular-import",
      file: "src/a.ts",
      enclosingSymbol: cycle,
    }),
    axiom: "1",
    ruleId: "structural/circular-import",
    location: { file: "src/a.ts", startLine: 1, endLine: 1 },
    message: `circular import: ${cycle}`,
    tier: "deterministic",
    source: "ast",
    confidence: 1,
    severity: "error",
    enclosingSymbol: cycle,
  };
}

function artifact(findings: Finding[]): ReviewArtifact {
  return {
    schemaVersion: 1,
    runId: "0123456789abcdef",
    scope: "uncommitted",
    changedFiles: ["src/a.ts"],
    deletedFiles: [],
    findings,
    degraded: [],
    manifest: MANIFEST,
  };
}

describe("formatSummary", () => {
  it("renders the Design-Notes summary shape for a finding run", () => {
    const out = formatSummary(
      artifact([finding()]),
      "_agentic-guardrails/reviews/uncommitted/0123456789abcdef.json",
      0,
    );
    expect(out).toBe(
      [
        "guardrails review (uncommitted)",
        "axiom 1 · structural   1 error, 0 warnings, 0 info",
        "  src/a.ts:1  error  circular import: src/a.ts -> src/b.ts -> src/a.ts  [structural/circular-import]",
        "artifact: _agentic-guardrails/reviews/uncommitted/0123456789abcdef.json",
        "1 finding (1 error, 0 warnings, 0 info) · deterministic tier · 0 degraded",
        "",
      ].join("\n"),
    );
  });

  it("renders a clean run with zero findings", () => {
    const out = formatSummary(artifact([]), "artifact.json", 0);
    expect(out).toContain("0 findings (0 errors, 0 warnings, 0 info) · deterministic tier · 0 degraded");
    expect(out).not.toContain("axiom ");
  });

  it("sorts axiom groups by axiom id and labels categories from the explicit map", () => {
    const first = finding();
    const second: Finding = {
      ...finding(),
      axiom: "7",
      ruleId: "whatever/rule",
      severity: "info",
      confidence: 1,
    };
    // Findings arrive with axiom 7 first — output must still sort 1 before 7.
    const out = formatSummary(artifact([second, first]), "artifact.json", 0);
    const axiom1At = out.indexOf("axiom 1 · structural");
    const axiom7At = out.indexOf("axiom 7 · uncategorized   0 errors, 0 warnings, 1 info");
    expect(axiom1At).toBeGreaterThanOrEqual(0);
    expect(axiom7At).toBeGreaterThan(axiom1At);
  });

  it("reports the degraded count", () => {
    const out = formatSummary(artifact([]), "artifact.json", 2);
    expect(out).toContain("· 2 degraded");
  });
});
