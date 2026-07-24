/**
 * The Story 1.6 config plane. `loadConfig` is the ONLY reader of
 * `_agentic-guardrails/config.yaml`: YAML → contracts `configSchema`
 * safeParse → typed `Config`. Everything downstream consumes the validated
 * object — never the raw file (sole future exception: LLM API key from env,
 * Epic 2).
 *
 * Errors are typed messages naming the offending path (Zod) or line/column
 * (YAML) — never a stack trace, never a silent fallback to defaults.
 * `evaluateGate` is the pure exit-code gate over findings + config.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  configJsonSchema,
  configSchema,
  type Config,
  type Finding,
} from "@agentic-guardrails/contracts";
import { parse as parseYaml, YAMLParseError } from "yaml";

import { writeFileAtomic } from "../persistence/artifact-writer.js";
import { numericCompare } from "../pipeline/manifest.js";

/** Header line any tool-written config.yaml must start with (FR-31 editor
 * autocomplete): points editors at the generated JSON Schema beside it. */
export const CONFIG_YAML_HEADER = "# yaml-language-server: $schema=./config.schema.json";

/** Starter config the `init` bootstrap (Story 1.8) writes — header + empty
 * mapping, which parses to pure defaults. */
export const DEFAULT_CONFIG_YAML = `${CONFIG_YAML_HEADER}\naxioms: {}\n`;

/** Canonical bytes of the generated JSON Schema file. */
const CONFIG_JSON_SCHEMA_BYTES = `${JSON.stringify(configJsonSchema, null, 2)}\n`;

/** `configHash` sentinel when no config file exists — a literal, never a hash
 * (an empty-but-PRESENT file hashes its real bytes and stays distinguishable). */
export const CONFIG_ABSENT_HASH = "absent";

// INVARIANT: `configSchema.parse({})` must always succeed — the schema's own
// defaults define the no-config posture. safeParse + hard throw keeps a
// schema regression loud at module load instead of surfacing mid-run.
const DEFAULTS_PARSE = configSchema.safeParse({});
if (!DEFAULTS_PARSE.success) {
  throw new Error("configSchema invariant violated: parse({}) must yield the default config");
}
const DEFAULT_CONFIG: Config = DEFAULTS_PARSE.data;

/** Effective per-key defaults the gate applies to any unconfigured axiom. */
const EFFECTIVE_DEFAULTS = { enforcement: "blocking", maxFindings: 0 } as const;

export type LoadConfigResult =
  | {
      ok: true;
      config: Config;
      /** false → `config.yaml` absent, defaults apply. */
      configPresent: boolean;
      /** Formatted deviation lines (`axioms.1.enforcement = "advisory"
       * (default: "blocking")`), sorted by path; empty when nothing deviates. */
      deviations: string[];
      /** sha256 hex of the config.yaml bytes; literal "absent" when absent. */
      configHash: string;
      /** Non-fatal stderr-warning lines (schema-file write failure) — never a
       * run degradation: no analysis coverage is lost. */
      warnings: string[];
    }
  | { ok: false; message: string };

export function loadConfig(repoRoot: string): LoadConfigResult {
  const outRoot = path.join(repoRoot, "_agentic-guardrails");
  const configPath = path.join(outRoot, "config.yaml");

  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Missing config file is not an error: defaults apply, declared as
      // such. No schema file is written either — an un-opted-in repo gets
      // no unsolicited files.
      return {
        ok: true,
        config: DEFAULT_CONFIG,
        configPresent: false,
        deviations: [],
        configHash: CONFIG_ABSENT_HASH,
        warnings: [],
      };
    }
    // Any other failure (EACCES/EISDIR/EIO) is NOT absence — falling back to
    // defaults here would silently bypass the user's governing config.
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `config.yaml: read error (${code ?? "unknown"}): ${message}` };
  }

  // Editor support: the config file exists, so keep config.schema.json
  // current beside it. A write failure is a warning — it never degrades the
  // run (no analysis coverage is lost) and never aborts it.
  const warnings: string[] = [];
  try {
    let current: string | undefined;
    try {
      current = readFileSync(path.join(outRoot, "config.schema.json"), "utf8");
    } catch {
      current = undefined; // missing → write below
    }
    if (current !== CONFIG_JSON_SCHEMA_BYTES) {
      mkdirSync(outRoot, { recursive: true });
      writeFileAtomic(path.join(outRoot, "config.schema.json"), CONFIG_JSON_SCHEMA_BYTES);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`config.schema.json write failed: ${message}`);
  }

  let raw: unknown;
  try {
    raw = parseYaml(text) ?? {}; // empty file → defaults
  } catch (error) {
    if (error instanceof YAMLParseError) {
      const pos = error.linePos?.[0];
      const where = pos ? ` at line ${pos.line}, column ${pos.col}` : "";
      const firstLine = error.message.split("\n")[0] ?? error.message;
      return { ok: false, message: `config.yaml: parse error${where}: ${firstLine}` };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `config.yaml: parse error: ${message}` };
  }

  // `axioms:` with every entry commented out parses as null — treat as {}.
  if (typeof raw === "object" && raw !== null && (raw as Record<string, unknown>)["axioms"] === null) {
    raw = { ...(raw as Record<string, unknown>), axioms: {} };
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      // Strict-object unknown keys arrive with an empty-ish path plus a
      // `keys` list — surface the key names as the path.
      const keys = "keys" in issue && Array.isArray(issue.keys) ? issue.keys : [];
      const pathStr = [...issue.path, ...keys].map(String).join(".") || "(root)";
      return `${pathStr}: ${issue.message}`;
    });
    return { ok: false, message: `config.yaml: invalid config: ${problems.join("; ")}` };
  }

  return {
    ok: true,
    config: parsed.data,
    configPresent: true,
    deviations: computeDeviations(raw, parsed.data),
    configHash: createHash("sha256").update(text).digest("hex"),
    warnings,
  };
}

/**
 * One line per value deviating from the EFFECTIVE defaults the gate applies
 * (enforcement "blocking", maxFindings 0 — for every axiom), restricted to
 * paths the user actually wrote. Restating an effective default (e.g. an
 * explicit `maxFindings: 0` on a blocking axiom) is not a deviation.
 */
function computeDeviations(raw: unknown, config: Config): string[] {
  const rawAxioms =
    typeof raw === "object" && raw !== null
      ? ((raw as Record<string, unknown>)["axioms"] ?? {})
      : {};
  const lines: string[] = [];
  for (const [id, entry] of Object.entries(rawAxioms as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue;
    for (const key of ["enforcement", "maxFindings"] as const) {
      if (!(key in entry)) continue;
      const configured = config.axioms[id]?.[key];
      if (configured === EFFECTIVE_DEFAULTS[key]) continue;
      lines.push(
        `axioms.${id}.${key} = ${JSON.stringify(configured)} (default: ${JSON.stringify(
          EFFECTIVE_DEFAULTS[key],
        )})`,
      );
    }
  }
  return lines.sort(numericCompare);
}

export interface GateAxiomResult {
  axiom: string;
  enforcement: "blocking" | "advisory" | "off";
  errorFindings: number;
  /** Effective threshold (maxFindings, default 0). */
  maxFindings: number;
  /** false → this axiom pushes the run to exit 1. */
  pass: boolean;
}

export interface GateResult {
  /** false → exit 1 (some blocking axiom exceeded its threshold). */
  pass: boolean;
  /** One entry per axiom that ran or is configured (off axioms excluded —
   * they are declared in manifest.axiomsOff), sorted numeric-aware. */
  perAxiom: GateAxiomResult[];
}

/**
 * Pure exit-code gate: a `blocking` axiom (explicit or unconfigured — the
 * default posture) fails the gate when its error-severity findings exceed
 * `maxFindings` (default 0); `advisory`/`off` findings never gate.
 *
 * `ranAxioms` are the axiom ids whose analyzers executed — every one gets a
 * perAxiom entry (a blocking axiom with zero errors is a durable "pass",
 * not an omission), as does every configured non-off axiom.
 */
export function evaluateGate(
  findings: readonly Finding[],
  config: Config,
  ranAxioms: readonly string[] = [],
): GateResult {
  const errorsByAxiom = new Map<string, number>();
  for (const finding of findings) {
    if (finding.severity !== "error") continue;
    errorsByAxiom.set(finding.axiom, (errorsByAxiom.get(finding.axiom) ?? 0) + 1);
  }
  const axioms = new Set([...ranAxioms, ...Object.keys(config.axioms), ...errorsByAxiom.keys()]);
  const perAxiom = [...axioms]
    .filter((axiom) => config.axioms[axiom]?.enforcement !== "off")
    .sort(numericCompare)
    .map((axiom): GateAxiomResult => {
      const entry = config.axioms[axiom];
      const enforcement = entry?.enforcement ?? "blocking";
      const maxFindings = entry?.maxFindings ?? 0;
      const errorFindings = errorsByAxiom.get(axiom) ?? 0;
      return {
        axiom,
        enforcement,
        errorFindings,
        maxFindings,
        pass: !(enforcement === "blocking" && errorFindings > maxFindings),
      };
    });
  return { pass: perAxiom.every((a) => a.pass), perAxiom };
}
