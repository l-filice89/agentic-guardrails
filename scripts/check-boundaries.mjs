// Structural dependency-boundary rules (Story 1.1, Task 4).
//
// The `no-restricted-imports` ESLint rule (eslint.config.js) guards source
// files; this module guards package.json manifests directly, enforcing:
//   1. Each workspace package may only depend on the `@agentic-guardrails/*`
//      packages listed for it in ALLOWED_WORKSPACE_DEPS (contracts: none,
//      core: contracts only).
//   2. A workspace package with no entry in ALLOWED_WORKSPACE_DEPS fails the
//      check (fail-closed: a new package must declare its boundary rules
//      here before it can pass CI).
//   3. No package may declare a known LLM SDK in dependencies,
//      devDependencies, peerDependencies, optionalDependencies, or
//      bundle(d)Dependencies — including via `npm:`/`workspace:` aliases
//      (defense-in-depth: a newly-named or renamed SDK shouldn't be able to
//      defeat the lint-only wall).
//
// `checkBoundaries` is a pure function over plain package.json objects so
// it is unit-testable without touching the filesystem (see
// scripts/check-boundaries.test.mjs). The CLI entry point lives in
// scripts/check-boundaries.cli.mjs and always runs the check — there is no
// "am I the main module" guard whose failure mode would be a silent pass.
//
// eslint.config.js imports LLM_SDK_DENYLIST and LLM_SDK_SCOPE_PREFIXES from
// here so the lint wall and the manifest wall cannot drift apart.

/**
 * Exact package names of known LLM SDKs / gateways (June 2026 baseline).
 * Subpaths are handled by the consumers (gitignore-style patterns in ESLint,
 * exact-name matching here — a manifest dependency is always the bare name).
 */
export const LLM_SDK_DENYLIST = [
  "@agentic-guardrails/llm",
  "@anthropic-ai/sdk",
  "openai",
  "ollama",
  "@google/generative-ai",
  "@google/genai",
  "ai",
  "langchain",
  "@aws-sdk/client-bedrock-runtime",
  "@mistralai/mistralai",
  "cohere-ai",
];

/** Whole npm scopes that are LLM SDK families. */
export const LLM_SDK_SCOPE_PREFIXES = ["@ai-sdk/", "@langchain/"];

/**
 * Permitted `@agentic-guardrails/*` dependencies per workspace package
 * directory name. A package directory missing from this map fails the check
 * until its boundary rules are declared (dependency direction per ADR-002:
 * contracts → core → {llm, cli} → {action, plugin}).
 */
export const ALLOWED_WORKSPACE_DEPS = {
  contracts: [],
  core: ["@agentic-guardrails/contracts"],
};

export function isDeniedLlmName(name) {
  return (
    LLM_SDK_DENYLIST.includes(name) ||
    LLM_SDK_SCOPE_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

/**
 * Extracts the real package a dependency entry resolves to. For plain
 * entries that is the key itself; for `npm:pkg@range` / `workspace:pkg@range`
 * aliases it is the aliased target (e.g. `"x": "npm:openai@^4"` → `openai`).
 * @returns {string[]} the names this entry can install under.
 */
export function resolveDependencyNames(name, spec) {
  const names = [name];
  if (typeof spec !== "string") return names;

  for (const protocol of ["npm:", "workspace:"]) {
    if (!spec.startsWith(protocol)) continue;
    let rest = spec.slice(protocol.length);
    // `workspace:*` / `workspace:^` / `workspace:~1.2.3` carry no alias.
    if (rest === "" || /^[*^~0-9]/.test(rest)) break;
    // Strip the trailing @range (the first `@` after the scope segment).
    const at = rest.indexOf("@", rest.startsWith("@") ? 1 : 0);
    if (at !== -1) rest = rest.slice(0, at);
    if (rest) names.push(rest);
  }
  return names;
}

function collectDeps(pkg) {
  const deps = {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
    ...(pkg?.peerDependencies ?? {}),
    ...(pkg?.optionalDependencies ?? {}),
  };
  // bundleDependencies / bundledDependencies are arrays of names.
  for (const field of ["bundleDependencies", "bundledDependencies"]) {
    const bundled = pkg?.[field];
    if (Array.isArray(bundled)) {
      for (const name of bundled) deps[name] ??= "*";
    }
  }
  return deps;
}

function isWorkspaceDep(name) {
  return name.startsWith("@agentic-guardrails/");
}

/**
 * @param {Record<string, Record<string, unknown>>} packagesByDir map of
 *   workspace package directory name → parsed package.json object.
 * @returns {string[]} violation messages; empty array means the boundary holds.
 */
export function checkBoundaries(packagesByDir) {
  const violations = [];

  for (const [dir, pkg] of Object.entries(packagesByDir)) {
    const allowed = ALLOWED_WORKSPACE_DEPS[dir];
    if (allowed === undefined) {
      violations.push(
        `no boundary rules declared for workspace package "${dir}" — add it to ALLOWED_WORKSPACE_DEPS in scripts/check-boundaries.mjs`,
      );
      continue;
    }

    const deps = collectDeps(pkg);
    for (const [declaredName, spec] of Object.entries(deps)) {
      for (const name of resolveDependencyNames(declaredName, spec)) {
        if (isWorkspaceDep(name) && !allowed.includes(name)) {
          violations.push(
            allowed.length === 0
              ? `${dir} must have no @agentic-guardrails/* dependency, found "${name}"`
              : `${dir}'s only permitted @agentic-guardrails/* dependencies are ${allowed.join(", ")}, found "${name}"`,
          );
        }
        if (isDeniedLlmName(name)) {
          violations.push(
            `${dir} must not depend on LLM SDK "${name}" (core is LLM-free, ADR-005)`,
          );
        }
      }
    }
  }

  return violations;
}
