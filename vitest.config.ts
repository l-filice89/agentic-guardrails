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
          include: ["tests/integration/**/*.test.ts"],
          passWithNoTests: true,
        },
      },
    ],
  },
});
