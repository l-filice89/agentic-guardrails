import { describe, expect, it } from "vitest";

import { checkBoundaries, resolveDependencyNames } from "./check-boundaries.mjs";

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

  it("fails closed for a workspace package with no declared boundary rules", () => {
    const violations = checkBoundaries({ contracts: {}, core: {}, llm: {} });

    expect(violations.some((v) => v.includes('no boundary rules declared for workspace package "llm"'))).toBe(true);
  });

  it("flags a denylisted SDK hidden behind an npm: alias", () => {
    const violations = checkBoundaries({
      contracts: {},
      core: { dependencies: { "totally-not-an-llm": "npm:openai@^4.0.0" } },
    });

    expect(violations.some((v) => v.includes('"openai"'))).toBe(true);
  });

  it("flags an SDK from a denylisted scope (e.g. @ai-sdk/*)", () => {
    const violations = checkBoundaries({
      contracts: {},
      core: { dependencies: { "@ai-sdk/openai": "^1.0.0" } },
    });

    expect(violations.some((v) => v.includes('"@ai-sdk/openai"'))).toBe(true);
  });

  it("flags a denylisted SDK smuggled in via pnpm.overrides", () => {
    const violations = checkBoundaries({
      contracts: {},
      core: { pnpm: { overrides: { zod: "npm:openai@^4.0.0" } } },
    });

    expect(violations.some((v) => v.includes('"openai"'))).toBe(true);
  });

  it("flags a package whose name does not match its directory", () => {
    const violations = checkBoundaries({
      contracts: { name: "@agentic-guardrails/core" },
      core: {},
    });

    expect(violations.some((v) => v.includes("name mismatch") || v.includes("is named"))).toBe(true);
  });

  it("flags denylisted SDKs in optionalDependencies and bundledDependencies", () => {
    const violations = checkBoundaries({
      contracts: {},
      core: {
        optionalDependencies: { ollama: "^0.5.0" },
        bundledDependencies: ["langchain"],
      },
    });

    expect(violations.some((v) => v.includes('"ollama"'))).toBe(true);
    expect(violations.some((v) => v.includes('"langchain"'))).toBe(true);
  });
});

describe("resolveDependencyNames", () => {
  it("returns the bare name for plain semver specs", () => {
    expect(resolveDependencyNames("zod", "^4.0.0")).toEqual(["zod"]);
  });

  it("extracts npm: alias targets even when the name starts with a digit", () => {
    expect(resolveDependencyNames("x", "npm:7zip-bin@^5.0.0")).toEqual(["x", "7zip-bin"]);
  });

  it("extracts scoped alias targets, stripping the range", () => {
    expect(resolveDependencyNames("x", "npm:@anthropic-ai/sdk@^1.0.0")).toEqual([
      "x",
      "@anthropic-ai/sdk",
    ]);
  });

  it("treats workspace:* / workspace:^ as carrying no alias", () => {
    expect(resolveDependencyNames("@agentic-guardrails/contracts", "workspace:*")).toEqual([
      "@agentic-guardrails/contracts",
    ]);
    expect(resolveDependencyNames("@agentic-guardrails/contracts", "workspace:^")).toEqual([
      "@agentic-guardrails/contracts",
    ]);
  });

  it("extracts workspace: alias targets", () => {
    expect(resolveDependencyNames("x", "workspace:@agentic-guardrails/llm@*")).toEqual([
      "x",
      "@agentic-guardrails/llm",
    ]);
  });
});
