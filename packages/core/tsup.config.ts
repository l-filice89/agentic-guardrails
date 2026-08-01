import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2023",
  // Mirror contracts: tsup's synthetic dts config injects a deprecated
  // `baseUrl` (TS5101 under TypeScript 6) and trips composite file listing.
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
