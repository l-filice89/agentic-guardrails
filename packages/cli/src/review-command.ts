/**
 * `guardrails review` — uncommitted scope (the only scope until 1.15).
 * Exit codes: 0 clean · 1 pipeline gate failed (blocking axiom over its
 * error-finding threshold — config plane, 1.6) · 2 degraded run or
 * preflight/config/persistence failure (degradation dominates: a run that
 * silently lost coverage must never look merely "failed lint").
 */
import path from "node:path";

import type { Degradation, Finding } from "@agentic-guardrails/contracts";
import {
  runReview,
  writeReviewArtifact,
  type ReviewArtifact,
} from "@agentic-guardrails/core";

/** Explicit axiom → category labels (never inferred from a finding's ruleId
 * — an axiom with zero findings of its lead rule must still label correctly). */
const AXIOM_CATEGORY: Record<string, string> = {
  "1": "structural",
};

export async function reviewCommand(cwd: string): Promise<number> {
  try {
    const result = await runReview({ cwd });
    if (!result.ok) {
      process.stderr.write(`guardrails review: ${result.message}\n`);
      return 2;
    }

    // Run-start config transparency (FR-31): every deviation from defaults
    // is one explicit stderr line; absence of a config file is declared too.
    if (!result.configPresent) {
      process.stderr.write("guardrails review: config: using defaults (no config file)\n");
    }
    for (const deviation of result.deviations) {
      process.stderr.write(`guardrails review: config: ${deviation}\n`);
    }
    // Non-fatal config-plane warnings (schema-file write failure, unknown
    // axiom ids) — visible, never a run degradation.
    for (const warning of result.configWarnings) {
      process.stderr.write(`guardrails review: config: ${warning}\n`);
    }
    // An uncommitted config governs gating — worth one visible line (policy
    // beyond visibility is deferred).
    const configGitStatus = result.artifact.manifest.configGitStatus;
    if (configGitStatus === "modified" || configGitStatus === "untracked") {
      process.stderr.write(
        `guardrails review: config: config.yaml is ${configGitStatus} — an uncommitted config governs gating\n`,
      );
    }
    // Zero silent cache behavior: a disabled cache is declared in the
    // manifest AND warned about here — never a quiet slow run.
    const cacheDisabled = result.artifact.manifest.cache?.disabled;
    if (cacheDisabled !== undefined) {
      process.stderr.write(`guardrails review: cache disabled: ${cacheDisabled}\n`);
    }

    const artifactPath = writeReviewArtifact({
      repoRoot: result.repoRoot,
      scope: result.artifact.scope,
      runId: result.artifact.runId,
      json: result.artifactJson,
    });
    const relativePath = path
      .relative(result.repoRoot, artifactPath)
      .replaceAll("\\", "/");
    process.stdout.write(formatSummary(result.artifact, relativePath, result.runDegraded));

    if (result.degradedRun) {
      // Zero-SILENT-degradation: every reason is printed, one line each.
      for (const d of result.runDegraded) {
        process.stderr.write(`guardrails review: degraded: ${d.reason} (${d.subject})\n`);
      }
      return 2;
    }
    // Exit 1 is the pipeline's gate verdict (enforcement + maxFindings), not
    // a raw any-error-finding rule — advisory findings never flip the code.
    return result.gate.pass ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`guardrails review: ${message}\n`);
    return 2;
  }
}

/** Plain sequential text (UI-MOCK-GATE ruling: sketch lives in the spec). */
export function formatSummary(
  artifact: ReviewArtifact,
  artifactRelativePath: string,
  runDegraded: readonly Degradation[],
): string {
  const lines = [`guardrails review (${artifact.scope})`];

  // NFR-8: degraded work is IN the report header, above the findings block
  // — a failed axiom (or any lost coverage) can never hide below the fold.
  for (const d of runDegraded) {
    lines.push(`degraded: ${d.subject} — ${d.reason}`);
  }

  const byAxiom = new Map<string, Finding[]>();
  for (const finding of artifact.findings) {
    const group = byAxiom.get(finding.axiom);
    if (group) group.push(finding);
    else byAxiom.set(finding.axiom, [finding]);
  }
  for (const axiom of [...byAxiom.keys()].sort()) {
    const group = byAxiom.get(axiom)!;
    const category = AXIOM_CATEGORY[axiom] ?? "uncategorized";
    lines.push(`axiom ${axiom} · ${category}   ${severityCounts(group)}`);
    for (const f of group) {
      lines.push(
        `  ${f.location.file}:${f.location.startLine}  ${f.severity}  ${sanitizeMessage(f.message)}  [${f.ruleId}]`,
      );
    }
  }

  lines.push(`artifact: ${artifactRelativePath}`);
  lines.push(
    `${artifact.findings.length} finding${artifact.findings.length === 1 ? "" : "s"} ` +
      `(${severityCounts(artifact.findings)}) · deterministic tier · ` +
      `${runDegraded.length} degraded`,
  );
  return `${lines.join("\n")}\n`;
}

/** Finding messages can embed analyzed-file content — C0 control characters
 * (except \n and \t) are stripped so a message can never smuggle terminal
 * escape sequences into the report. Code-point filter, not a regex literal,
 * so no control character ever appears in this source file. */
function sanitizeMessage(message: string): string {
  return [...message]
    .filter((c) => c === "\n" || c === "\t" || c.charCodeAt(0) >= 0x20)
    .join("");
}

function severityCounts(findings: readonly Finding[]): string {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const info = findings.filter((f) => f.severity === "info").length;
  return `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}, ${info} info`;
}
