import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2023",
  // composite/incremental off for the dts pass: tsup builds a synthetic
  // single-entry program, and composite mode rejects its unlisted imports.
  // ignoreDeprecations: tsup injects a deprecated `baseUrl` into its
  // synthetic dts config, which TypeScript 6 otherwise rejects (TS5101).
  dts: {
    compilerOptions: {
      composite: false,
      incremental: false,
      ignoreDeprecations: "6.0",
    },
  },
  clean: true,
  sourcemap: true,
});
