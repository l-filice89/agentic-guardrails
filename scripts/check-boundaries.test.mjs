import { describe, expect, it } from "vitest";

import { checkBoundaries } from "./check-boundaries.mjs";

describe("checkBoundaries", () => {
  it("passes for the real contracts/core shape (contracts bare, core -> contracts only)", () => {
    const violations = checkBoundaries({
      contracts: { name: "@agentic-guardrails/contracts", dependencies: {} },
      core: {
        name: "@agentic-guardrails/core",
        dependencies: { "@agentic-guardrails/contracts": "workspace:*" },
      },
    });

    expect(violations).toEqual([]);
  });

  it("flags contracts depending on any @agentic-guardrails/* workspace package", () => {
    const violations = checkBoundaries({
      contracts: { dependencies: { "@agentic-guardrails/core": "workspace:*" } },
      core: { dependencies: { "@agentic-guardrails/contracts": "workspace:*" } },
    });

    expect(violations.some((v) => v.includes("contracts must have no"))).toBe(true);
  });

  it("flags core depending on a workspace package other than contracts", () => {
    const violations = checkBoundaries({
      contracts: {},
      core: {
        dependencies: {
          "@agentic-guardrails/contracts": "workspace:*",
          "@agentic-guardrails/llm": "workspace:*",
        },
      },
    });

    expect(
      violations.some((v) => v.includes("core's only permitted") && v.includes("@agentic-guardrails/llm")),
    ).toBe(true);
  });

  it("flags a known LLM SDK dependency anywhere (dependencies, devDependencies, or peerDependencies)", () => {
    const violations = checkBoundaries({
      contracts: {},
      core: {
        dependencies: { "@agentic-guardrails/contracts": "workspace:*" },
        devDependencies: { "@anthropic-ai/sdk": "^1.0.0" },
      },
    });

    expect(violations.some((v) => v.includes('"@anthropic-ai/sdk"'))).toBe(true);
  });

  it("flags a denylisted SDK declared on contracts too (defense-in-depth)", () => {
    const violations = checkBoundaries({
      contracts: { peerDependencies: { openai: "^4.0.0" } },
      core: { dependencies: { "@agentic-guardrails/contracts": "workspace:*" } },
    });

    expect(violations.some((v) => v.includes("contracts must not depend on LLM SDK"))).toBe(true);
  });

  it("returns no violations for empty package descriptors", () => {
    expect(checkBoundaries({ contracts: {}, core: {} })).toEqual([]);
  });
});
