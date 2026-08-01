/**
 * Git wiring for `_agentic-guardrails/`: the `.gitattributes` union-merge
 * line for history JSONL and the seeded `.gitignore` lines. `init` seeds
 * them; phase-0 preflight verifies them (loud warning naming the
 * consequence, never exit 2). Lives apart from init.ts so pipeline.ts can
 * import the check without a pipeline ↔ init module cycle.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { SEEDED_IGNORE_LINES } from "../persistence/artifact-writer.js";

/** `.gitattributes` lives INSIDE `_agentic-guardrails/` (git honors
 * per-directory attribute files; the pattern is relative to that directory)
 * — init never edits the user's root git files. */
export const GITATTRIBUTES_UNION_LINE = "history/*.jsonl merge=union";

/** The `.cache/` entry of the seeded `_agentic-guardrails/.gitignore`. */
export const CACHE_IGNORE_LINE = ".cache/";

/** Committed marker files whose presence means "this repo ran `init`" —
 * the artifact writer auto-creates the folder (+ .gitignore) on demand
 * during any review, so the folder alone proves nothing. */
const INIT_MARKER_FILES = [
  "config.yaml",
  "conventions.yaml",
  "corpus-map.yaml",
  "history/trends.jsonl",
  "history/dispositions.jsonl",
];

/** Per-line consequence named in the missing-`.gitignore`-line warnings. */
const IGNORE_LINE_CONSEQUENCE: Record<string, string> = {
  "reviews/": "review artifacts may be committed",
  ".cache/": ".cache/ may be committed",
  "config.schema.json": "the generated schema file may be committed",
};

function fileHasLine(filePath: string, line: string): boolean {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return false;
  }
  return text.split(/\r?\n/).some((l) => l.trim() === line);
}

/**
 * Preflight wiring check: WHEN the repo is actually initialized (any of
 * init's committed marker files present inside the `_agentic-guardrails/`
 * DIRECTORY), every wiring line must be present; each missing line yields
 * one warning naming the concrete consequence. An uninitialized repo —
 * no folder, a plain file at the path, or a folder the artifact writer
 * auto-created without markers — yields none: 1.4's on-demand behavior
 * unchanged. A few small file reads, well inside the ≤5s NFR-3 preflight
 * budget.
 */
export function checkGitWiring(repoRoot: string): string[] {
  const outRoot = path.join(repoRoot, "_agentic-guardrails");
  try {
    if (!statSync(outRoot).isDirectory()) return [];
  } catch {
    return [];
  }
  if (!INIT_MARKER_FILES.some((f) => existsSync(path.join(outRoot, f)))) return [];
  const warnings: string[] = [];
  if (!fileHasLine(path.join(outRoot, ".gitattributes"), GITATTRIBUTES_UNION_LINE)) {
    warnings.push(
      `_agentic-guardrails/.gitattributes is missing "${GITATTRIBUTES_UNION_LINE}" — history JSONL will merge with conflicts (run \`guardrails init\`)`,
    );
  }
  for (const line of SEEDED_IGNORE_LINES) {
    if (!fileHasLine(path.join(outRoot, ".gitignore"), line)) {
      warnings.push(
        `_agentic-guardrails/.gitignore is missing "${line}" — ${IGNORE_LINE_CONSEQUENCE[line] ?? "generated output may be committed"} (run \`guardrails init\`)`,
      );
    }
  }
  return warnings;
}
