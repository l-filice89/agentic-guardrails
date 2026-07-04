// Flat ESLint config (ESM). Scope is deliberately narrow: only
// `packages/**/src/**/*.ts` is linted. The legacy prompt-only plugin
// (`commands/`, `skills/`, `tests/fixtures/`, ...) is never touched by this
// config -- see _bmad-output/project-context.md and Story 1.1 Dev Notes.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Message naming the violated boundary (ADR-005). */
export const CORE_LLM_FREE_MESSAGE =
  "core is LLM-free (ADR-005): move LLM calls behind the envelope in @agentic-guardrails/llm";

/**
 * `no-restricted-imports` `patterns` entries (not just `paths`) so that
 * subpaths (e.g. `@anthropic-ai/sdk/messages`) are caught too.
 */
const FORBIDDEN_IMPORT_PATTERNS = [
  { group: ["@agentic-guardrails/llm", "@agentic-guardrails/llm/*"], message: CORE_LLM_FREE_MESSAGE },
  { group: ["@anthropic-ai/sdk", "@anthropic-ai/sdk/*"], message: CORE_LLM_FREE_MESSAGE },
  { group: ["openai", "openai/*"], message: CORE_LLM_FREE_MESSAGE },
  { group: ["ollama", "ollama/*"], message: CORE_LLM_FREE_MESSAGE },
  { group: ["@google/generative-ai", "@google/generative-ai/*"], message: CORE_LLM_FREE_MESSAGE },
];

export default tseslint.config(
  {
    // Global ignore list -- nothing outside packages/**/src is ever linted.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-types/**",
      "**/*.d.ts",
      "commands/**",
      "skills/**",
      "tests/**",
      "_bmad/**",
      "_bmad-output/**",
      ".claude/**",
      ".claude-plugin/**",
      ".agents/**",
      "scripts/**",
      "vitest.config.ts",
      "eslint.config.js",
    ],
  },
  {
    files: ["packages/**/src/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
  {
    // The forbidden-import wall: scoped to core's src tree only.
    files: ["packages/core/**/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: FORBIDDEN_IMPORT_PATTERNS }],
    },
  },
);
