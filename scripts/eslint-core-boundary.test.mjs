import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Regression guard for Story 1.1, Task 4: proves the `no-restricted-imports`
// override in eslint.config.js actually fires for a file living under
// packages/core/src/. This catches a silently-dead `files` glob forever --
// a config typo here would otherwise only surface the next time someone
// happens to write a forbidden import in core and notices lint didn't catch it.
//
// Paths are anchored to this file's location (via import.meta.url), not
// process.cwd() -- this test runs both from the repo root (`pnpm test`) and
// from packages/contracts (`pnpm -r test` runs each package's own `test`
// script from that package's directory), and process.cwd() differs between
// the two invocations.
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const CORE_SRC_FIXTURE_PATH = path.join(REPO_ROOT, "packages/core/src/__lint-fixture__.ts");

async function lintCoreSource(code) {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [result] = await eslint.lintText(code, { filePath: CORE_SRC_FIXTURE_PATH });
  return result.messages.filter((message) => message.ruleId === "no-restricted-imports");
}

describe("forbidden-import wall (packages/core/src)", () => {
  it("fails on a direct LLM SDK import", async () => {
    const messages = await lintCoreSource("import '@anthropic-ai/sdk';\n");

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].message).toMatch(/core is LLM-free \(ADR-005\)/);
  });

  it("fails on an @agentic-guardrails/llm import", async () => {
    const messages = await lintCoreSource("import '@agentic-guardrails/llm';\n");

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].message).toMatch(/core is LLM-free \(ADR-005\)/);
  });

  it("fails on a denylisted SDK subpath import", async () => {
    const messages = await lintCoreSource("import '@anthropic-ai/sdk/messages';\n");

    expect(messages.length).toBeGreaterThan(0);
  });

  it("does not flag the allowed contracts import", async () => {
    const messages = await lintCoreSource("import '@agentic-guardrails/contracts';\n");

    expect(messages.length).toBe(0);
  });
});
