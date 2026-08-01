/**
 * SPIKE-3 deterministic synthetic repo generator (Story 1.5).
 *
 * Emits a TypeScript repo of `fileCount` files (~30 files/dir) with
 * realistic import shapes: 2-4 imports per file biased to same-dir
 * relative imports, ~5% barrel re-export files, ~2% alias imports via
 * generated tsconfig `paths` (`@lib/* -> d000/*`). Acyclic by
 * construction (imports only target lower global indices) except an
 * optional seeded 2-file cycle (`cycle: true`) for the pipeline finding
 * check. The ground-truth edge list (exact adapter edge shape:
 * from/to/dynamic/typeOnly/reExport, repo-root-relative posix paths) is
 * written beside the sources as `spike-meta.json`.
 *
 * Optionally emits `shards` extra tsconfigs (`tsconfig.shard-<k>.json`)
 * partitioning the dirs into contiguous blocks — the concurrency-sweep
 * workload for spike-3-benchmark.mjs.
 *
 * Never committed output: callers generate into OS temp.
 */
import fs from "node:fs";
import path from "node:path";

const FILES_PER_DIR = 30;

/** mulberry32 — tiny deterministic PRNG, good enough for repo shapes. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dirName = (d) => `d${String(d).padStart(3, "0")}`;
const dirOf = (g) => Math.floor(g / FILES_PER_DIR);
const relPathOf = (g) => `${dirName(dirOf(g))}/f${g}.ts`;

/**
 * Generates the repo at `outDir`. Returns the meta object (also written
 * to `<outDir>/spike-meta.json`): `{ seed, fileCount, dirCount, edges,
 * cycle, shardTsconfigs }`.
 */
export function generateRepo(outDir, { fileCount, seed, cycle = false, shards = 0 }) {
  const rand = mulberry32(seed);
  const pickInt = (maxExclusive) => Math.floor(rand() * maxExclusive);
  const dirCount = Math.ceil(fileCount / FILES_PER_DIR);
  const edges = [];
  const STATIC = { dynamic: false, typeOnly: false, reExport: false };

  fs.mkdirSync(outDir, { recursive: true });
  for (let d = 0; d < dirCount; d++) fs.mkdirSync(path.join(outDir, dirName(d)), { recursive: true });

  for (let g = 0; g < fileCount; g++) {
    const from = relPathOf(g);
    const myDir = dirOf(g);
    const dirStart = myDir * FILES_PER_DIR;
    const isBarrel = g > 0 && rand() < 0.05;
    const importCount = 2 + pickInt(3); // 2-4
    const targets = new Set();
    const lines = [];

    for (let i = 0; i < importCount && g > 0; i++) {
      let target;
      let alias = false;
      const roll = rand();
      if (roll < 0.02 && g >= FILES_PER_DIR) {
        // alias import into d000 via tsconfig paths
        target = pickInt(Math.min(FILES_PER_DIR, g));
        alias = true;
      } else if (roll < 0.72 && g > dirStart) {
        // same-dir bias
        target = dirStart + pickInt(g - dirStart);
      } else {
        target = pickInt(g); // any lower index — acyclic by construction
      }
      if (targets.has(target)) continue;
      targets.add(target);

      const specifier = alias
        ? `@lib/f${target}`
        : dirOf(target) === myDir
          ? `./f${target}`
          : `../${dirName(dirOf(target))}/f${target}`;
      if (isBarrel) {
        lines.push(`export * from "${specifier}";`);
        edges.push({ from, to: relPathOf(target), dynamic: false, typeOnly: false, reExport: true });
      } else {
        lines.push(`import { v${target} } from "${specifier}";`);
        edges.push({ from, to: relPathOf(target), ...STATIC });
      }
    }

    lines.push(`export const v${g} = ${g};`);
    if (!isBarrel) {
      const used = [...targets].map((t) => `v${t}`).join(" + ");
      lines.push(
        `export function compute${g}(x: number): number {`,
        `  return x + v${g}${used.length > 0 ? ` + ${used}` : ""};`,
        `}`,
      );
    }
    fs.writeFileSync(path.join(outDir, relPathOf(g)), `${lines.join("\n")}\n`);
  }

  // Seeded 2-file cycle (pipeline finding check): last two files of the
  // last dir import each other — the only back-edge in the repo.
  let cyclePair = null;
  if (cycle) {
    const a = fileCount - 2;
    const b = fileCount - 1;
    const fileA = path.join(outDir, relPathOf(a));
    const fileB = path.join(outDir, relPathOf(b));
    fs.appendFileSync(fileA, `import { v${b} } from "./f${b}";\nexport const cycleA = v${b};\n`);
    fs.appendFileSync(fileB, `import { v${a} } from "./f${a}";\nexport const cycleB = v${a};\n`);
    edges.push({ from: relPathOf(a), to: relPathOf(b), ...STATIC });
    edges.push({ from: relPathOf(b), to: relPathOf(a), ...STATIC });
    cyclePair = [relPathOf(a), relPathOf(b)];
  }

  const compilerOptions = {
    target: "es2022",
    module: "commonjs",
    moduleResolution: "node",
    baseUrl: ".",
    paths: { "@lib/*": ["d000/*"] },
    types: [],
  };
  fs.writeFileSync(
    path.join(outDir, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions, include: ["d*/**/*.ts"] }, null, 2)}\n`,
  );

  const shardTsconfigs = [];
  if (shards > 0) {
    const perShard = Math.ceil(dirCount / shards);
    for (let k = 0; k < shards; k++) {
      const dirs = [];
      for (let d = k * perShard; d < Math.min((k + 1) * perShard, dirCount); d++) {
        dirs.push(`${dirName(d)}/**/*.ts`);
      }
      if (dirs.length === 0) continue;
      const name = `tsconfig.shard-${k}.json`;
      fs.writeFileSync(
        path.join(outDir, name),
        `${JSON.stringify({ compilerOptions, include: dirs }, null, 2)}\n`,
      );
      shardTsconfigs.push(name);
    }
  }

  // Dedupe ground truth: identical import may be generated once only per
  // file (targets Set), but a barrel + cycle appendix can't collide; keep
  // a plain dedupe for safety so sampling compares set membership.
  const seen = new Set();
  const uniqueEdges = edges.filter((e) => {
    const key = JSON.stringify(e);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const meta = { seed, fileCount, dirCount, edges: uniqueEdges, cycle: cyclePair, shardTsconfigs };
  fs.writeFileSync(path.join(outDir, "spike-meta.json"), JSON.stringify(meta));
  return meta;
}
