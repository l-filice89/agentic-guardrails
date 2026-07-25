/**
 * `guardrails init` (Story 1.8): bootstraps `_agentic-guardrails/` —
 * config.yaml (1.6's DEFAULT_CONFIG_YAML constants, or a small per-axiom
 * questionnaire), empty-but-valid conventions.yaml + corpus-map.yaml
 * (contracts-validated shapes), git wiring (`.gitattributes` union merge +
 * seeded `.gitignore`) — and builds the regenerable structural seed from
 * the import graph into `.cache/corpus/`.
 *
 * NEVER-CLOBBER: init writes only MISSING files; existing config/
 * conventions/corpus-map files are kept byte-identical and reported "kept".
 * Wiring files get missing lines appended (reported "updated"), user
 * content preserved verbatim. The seed is a regenerable derivation and is
 * rewritten every run. No `--force` mode exists on purpose.
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { configSchema, enforcementSchema } from "@agentic-guardrails/contracts";
import { parse as parseYaml } from "yaml";

import { TypeScriptAdapter } from "../adapter/typescript-adapter.js";
import { mergeGraphResults } from "../analyzers/axiom1-structural.js";
import {
  CONFIG_YAML_HEADER,
  DEFAULT_CONFIG_YAML,
  EFFECTIVE_DEFAULTS,
  loadConfig,
} from "../config/config-loader.js";
import { repoRoot } from "../git/git.js";
import {
  buildStructuralSeed,
  serializeStructuralSeed,
  STRUCTURAL_SEED_PATH,
} from "../knowledge/structural-seed.js";
import {
  ensureLines,
  SEEDED_IGNORE_LINES,
  writeFileAtomic,
} from "../persistence/artifact-writer.js";
import { numericCompare } from "../pipeline/manifest.js";
import {
  ANALYZERLESS_KNOWN_AXIOMS,
  DEFAULT_ANALYZERS,
  discoverTsconfigs,
} from "../pipeline/pipeline.js";
import { GITATTRIBUTES_UNION_LINE } from "./wiring.js";

/** Canonical bytes of the empty-but-valid committed knowledge files —
 * machine-checkable via the contracts ledger schemas. */
export const CONVENTIONS_YAML = "schemaVersion: 1\nconventions: []\n";
export const CORPUS_MAP_YAML = "schemaVersion: 1\nhumanConfirmed: []\n";

/** One-line questionnaire descriptions per known axiom. */
const AXIOM_DESCRIPTIONS: Record<string, string> = {
  "1": "structural/dependency direction",
  "3": "cleanliness",
  "4": "nfr: sync I/O, unbounded fan-out, cancellation",
  "5": "security",
};

/** Questionnaire seam: the CLI passes a `node:readline/promises`-backed
 * implementation; tests pass scripted answers. */
export interface InitIo {
  question(prompt: string): Promise<string>;
}

export interface RunInitOptions {
  cwd: string;
  /** true (or no `io`) → skip the questionnaire, write documented defaults. */
  noInput: boolean;
  io?: InitIo;
}

export type InitSeedResult =
  | { written: true; path: string }
  | { written: false; reason: string };

export type InitResult =
  | {
      ok: false;
      message: string;
      /** Files already written/updated before the failure — they must
       * still reach the user (empty when nothing was touched). */
      created: string[];
      updated: string[];
      kept: string[];
    }
  | {
      ok: true;
      /** Repo-relative paths written this run, in write order. */
      created: string[];
      /** Existing wiring files that had missing lines appended. */
      updated: string[];
      /** Repo-relative paths that already existed and were left alone. */
      kept: string[];
      seed: InitSeedResult;
      warnings: string[];
    };

/** Axiom ids the questionnaire iterates: the registered deterministic
 * analyzers plus the pipeline's analyzerless known axioms. */
export function knownAxiomIds(): string[] {
  return [
    ...new Set([...DEFAULT_ANALYZERS.map((a) => a.axiom), ...ANALYZERLESS_KNOWN_AXIOMS]),
  ].sort(numericCompare);
}

export async function runInit(options: RunInitOptions): Promise<InitResult> {
  const created: string[] = [];
  const updated: string[] = [];
  const kept: string[] = [];
  const fail = (message: string): InitResult => ({ ok: false, message, created, updated, kept });

  // Git check FIRST — a typed failure before any write (exit 2 at the CLI).
  const root = repoRoot(options.cwd);
  if (!root.ok) {
    return fail(
      root.kind === "git-not-found"
        ? "git executable not found — install git or add it to PATH"
        : root.kind === "not-a-repo"
          ? "not a git repository — `guardrails init` requires one (run `git init` first)"
          : root.reason,
    );
  }

  const warnings: string[] = [];
  const outRoot = path.join(root.value, "_agentic-guardrails");
  try {
    mkdirSync(outRoot, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`write failed under _agentic-guardrails/: ${message}`);
  }

  // config.yaml — only when missing; the questionnaire is skipped entirely
  // for an existing file (its answers could not be honored without clobber).
  const configPath = path.join(outRoot, "config.yaml");
  if (existsSync(configPath)) {
    kept.push("_agentic-guardrails/config.yaml");
    // Visibility only (still exit 0, never clobbered): a kept config the
    // 1.6 loader would reject means the next review will exit 2.
    const loaded = loadConfig(root.value);
    if (!loaded.ok) {
      warnings.push(`existing config.yaml is invalid — review will exit 2 (${loaded.message})`);
    }
  } else {
    const interactive = !options.noInput && options.io !== undefined;
    const configYaml = interactive
      ? await askConfigYaml(options.io!, warnings)
      : DEFAULT_CONFIG_YAML;
    // Construction guard: never write a config the 1.6 loader would reject.
    if (!configSchema.safeParse(parseYaml(configYaml)).success) {
      const detail = warnings.length > 0 ? ` (warnings: ${warnings.join("; ")})` : "";
      return fail(`internal error: questionnaire produced an invalid config${detail}`);
    }
    try {
      writeFileAtomic(configPath, configYaml);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail(`write failed for _agentic-guardrails/config.yaml: ${message}`);
    }
    created.push("_agentic-guardrails/config.yaml");
  }

  // Empty-but-valid committed knowledge files (full semantics are Epic 4).
  try {
    for (const [name, content] of [
      ["conventions.yaml", CONVENTIONS_YAML],
      ["corpus-map.yaml", CORPUS_MAP_YAML],
    ] as const) {
      const filePath = path.join(outRoot, name);
      if (existsSync(filePath)) {
        kept.push(`_agentic-guardrails/${name}`);
      } else {
        writeFileAtomic(filePath, content);
        created.push(`_agentic-guardrails/${name}`);
      }
    }

    // Git wiring: append-missing-lines, user content preserved verbatim.
    for (const [name, lines] of [
      [".gitattributes", [GITATTRIBUTES_UNION_LINE]],
      [".gitignore", SEEDED_IGNORE_LINES],
    ] as const) {
      const outcome = ensureLines(path.join(outRoot, name), lines);
      const bucket = outcome === "created" ? created : outcome === "appended" ? updated : kept;
      bucket.push(`_agentic-guardrails/${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`write failed under _agentic-guardrails/: ${message}`);
  }

  const seedOutcome = writeSeed(root.value);
  if (!seedOutcome.ok) return fail(seedOutcome.message);
  return { ok: true, created, updated, kept, seed: seedOutcome.seed, warnings };
}

/** Regenerates the structural seed (always — it is a derivation, not user
 * territory). No tsconfig (or a failing graph build) → a declared SKIP,
 * init still succeeds; an fs error WRITING the seed file → a typed failure
 * (exit 2 at the CLI — the documented write-error contract). */
function writeSeed(
  root: string,
): { ok: true; seed: InitSeedResult } | { ok: false; message: string } {
  const discovery = discoverTsconfigs(root);
  if (discovery.tsconfigPaths.length === 0) {
    return {
      ok: true,
      seed: { written: false, reason: discovery.degraded[0]?.reason ?? "no tsconfig.json found" },
    };
  }
  let json: string;
  try {
    const adapter = new TypeScriptAdapter();
    const graphResult = mergeGraphResults(
      discovery.tsconfigPaths.map((tsconfigPath) =>
        adapter.buildImportGraph({ tsconfigPath, rootDir: root }),
      ),
    );
    json = serializeStructuralSeed(buildStructuralSeed(graphResult));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: true, seed: { written: false, reason: `seed build failed: ${message}` } };
  }
  try {
    const seedPath = path.join(root, STRUCTURAL_SEED_PATH);
    mkdirSync(path.dirname(seedPath), { recursive: true });
    writeFileAtomic(seedPath, json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `write failed for ${STRUCTURAL_SEED_PATH}: ${message}` };
  }
  return { ok: true, seed: { written: true, path: STRUCTURAL_SEED_PATH } };
}

/**
 * Per-axiom questionnaire. Option VALUES come from contracts
 * (`enforcementSchema.options`; maxFindings' int-≥0 shape) and defaults
 * from the config plane's EFFECTIVE_DEFAULTS — never hardcoded prompt
 * literals drifting from the schema. Empty answer → default; unrecognized
 * (or unsafe-integer) answer → default with a warning (no reprompt loop —
 * no prompt may block). All-default answers collapse to the documented
 * DEFAULT_CONFIG_YAML bytes.
 */
async function askConfigYaml(io: InitIo, warnings: string[]): Promise<string> {
  const levels = enforcementSchema.options;
  const defaults = EFFECTIVE_DEFAULTS;
  const entries: string[] = [];
  for (const axiom of knownAxiomIds()) {
    const label = AXIOM_DESCRIPTIONS[axiom] === undefined ? axiom : `${axiom} (${AXIOM_DESCRIPTIONS[axiom]})`;
    const rawLevel = (
      await io.question(`axiom ${label} enforcement [${levels.join("/")}] (${defaults.enforcement}): `)
    ).trim();
    let enforcement: (typeof levels)[number] = defaults.enforcement;
    if ((levels as readonly string[]).includes(rawLevel)) {
      enforcement = rawLevel as (typeof levels)[number];
    } else if (rawLevel !== "") {
      warnings.push(
        `unrecognized answer "${rawLevel}" for axiom ${axiom} — using "${defaults.enforcement}"`,
      );
    }
    let maxFindings: number = defaults.maxFindings;
    if (enforcement === "blocking") {
      const rawMax = (
        await io.question(`axiom ${label} maxFindings (${defaults.maxFindings}): `)
      ).trim();
      if (/^\d+$/.test(rawMax) && Number.isSafeInteger(Number(rawMax))) {
        maxFindings = Number.parseInt(rawMax, 10);
      } else if (rawMax !== "") {
        warnings.push(
          `unrecognized maxFindings "${rawMax}" for axiom ${axiom} — using ${defaults.maxFindings}`,
        );
      }
    }
    // Only deviations from the effective defaults become entries — a
    // fully-default answer set writes the same bytes as --no-input.
    if (enforcement !== defaults.enforcement) {
      entries.push(`  "${axiom}":\n    enforcement: "${enforcement}"`);
    } else if (maxFindings !== defaults.maxFindings) {
      entries.push(
        `  "${axiom}":\n    enforcement: "blocking"\n    maxFindings: ${maxFindings}`,
      );
    }
  }
  if (entries.length === 0) return DEFAULT_CONFIG_YAML;
  return `${CONFIG_YAML_HEADER}\naxioms:\n${entries.join("\n")}\n`;
}
