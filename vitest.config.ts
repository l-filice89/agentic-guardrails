import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Pin `root` to this file's directory (the repo root) so that running
// `vitest run` from a package directory (e.g. `pnpm -r test`, which runs
// each package's own `test` script from that package's cwd) still resolves
// the `include` globs below against the repo root, not the package dir.
const repoRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: repoRoot,
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/**/src/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/dist/**", "**/dist-types/**"],
        },
      },
      {
        test: {
          name: "tooling",
          include: ["scripts/**/*.test.mjs"],
          exclude: ["**/node_modules/**"],
        },
      },
      {
        test: {
          name: "integration",
          // ponytail: `passWithNoTests` removed — the project has tests, and
          // the key is not in vitest 4's typed ProjectConfig (now that this
          // file is tsc-checked via tests/tsconfig.json).
          include: ["tests/integration/**/*.test.ts"],
          // No project-wide timeout override: the spawn-heavy e2e suites set
          // their own per-file budgets via `vi.setConfig({ testTimeout })`,
          // so a hung non-spawning test still fails at the 5s default.
        },
      },
    ],
  },
});
