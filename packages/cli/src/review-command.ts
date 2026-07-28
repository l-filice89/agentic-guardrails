/**
 * `guardrails review` — four scopes since 1.15: the uncommitted working tree
 * (the default, unchanged), `--branch [ref]`, `--pr <id>`, and `--project`.
 * A reviewed ref that is not HEAD is analyzed inside a temporary worktree
 * while the artifact is always written to the INVOKING repository.
 * Exit codes: 0 clean · 1 pipeline gate failed (blocking axiom over its
 * error-finding threshold — config plane, 1.6) · 2 degraded run or
 * preflight/config/persistence failure (degradation dominates: a run that
 * silently lost coverage must never look merely "failed lint"). The artifact
 * disposition never touches the exit code.
 */
import path from "node:path";

import type { Degradation, Finding } from "@agentic-guardrails/contracts";
import {
  runReview,
  writeReviewArtifact,
  type ReviewArtifact,
  type ScopeRequest,
} from "@agentic-guardrails/core";

import { disposeArtifact } from "./disposition.js";

/** Explicit axiom → category labels (never inferred from a finding's ruleId
 * — an axiom with zero findings of its lead rule must still label correctly).
 * Exported for the coupling test against DEFAULT_ANALYZERS: registering an
 * analyzer without a label here would print "uncategorized". */
export const AXIOM_CATEGORY: Record<string, string> = {
  "1": "structural",
  "3": "cleanliness",
  "4": "nfr",
  "5": "security",
  "6": "conformance",
};

/** The scope flags as commander hands them over. `--branch` takes an OPTIONAL
 * value, so `true` means "the checked-out branch". */
export interface ReviewCommandOptions {
  branch?: string | boolean;
  pr?: string;
  project?: boolean;
  base?: string;
  /** commander's `--no-input`: false disables the disposition prompt. */
  input?: boolean;
}

/**
 * Maps the flag surface onto one scope request. Mutual exclusion of the three
 * scope flags is enforced by commander (`.conflicts`), so reaching here with
 * two of them set is impossible; `--base` without a diffing scope is a usage
 * error rather than a silently ignored flag.
 */
export function scopeFromOptions(
  options: ReviewCommandOptions,
): { ok: true; scope: ScopeRequest } | { ok: false; message: string } {
  const request: ScopeRequest =
    options.pr !== undefined
      ? { kind: "pr", ref: options.pr }
      : options.project === true
        ? { kind: "project" }
        : options.branch !== undefined
          ? { kind: "branch", ...(typeof options.branch === "string" ? { ref: options.branch } : {}) }
          : { kind: "uncommitted" };
  if (options.base === undefined) return { ok: true, scope: request };
  if (request.kind !== "branch" && request.kind !== "pr") {
    return { ok: false, message: "--base applies to --branch and --pr only" };
  }
  return { ok: true, scope: { ...request, base: options.base } };
}

export async function reviewCommand(
  cwd: string,
  options: ReviewCommandOptions = {},
): Promise<number> {
  try {
    const requested = scopeFromOptions(options);
    if (!requested.ok) {
      process.stderr.write(`guardrails review: ${requested.message}\n`);
      return 2;
    }
    const result = await runReview({ cwd, scope: requested.scope });
    if (!result.ok) {
      // A typed failure message embeds git's stderr and repository paths —
      // untrusted text on its way to a terminal, sanitized like the rest.
      process.stderr.write(`guardrails review: ${sanitizeMessage(result.message)}\n`);
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
    // Git-wiring preflight warnings (1.8) — their own channel, not the
    // config plane's.
    for (const warning of result.wiringWarnings) {
      process.stderr.write(`guardrails review: ${warning}\n`);
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

    // Zero SILENT degradation, second half: an axiom that declined to run is
    // inconclusive, not clean. These never touch the exit code (that is what
    // "declared only" means), but an inconclusive run must never print the
    // same thing a clean one prints.
    for (const d of result.declaredOnly) {
      process.stderr.write(`guardrails review: inconclusive: ${degradationText(d)}\n`);
    }

    if (result.degradedRun) {
      // Zero-SILENT-degradation: every reason is printed, one line each.
      for (const d of result.runDegraded) {
        process.stderr.write(`guardrails review: degraded: ${degradationText(d)}\n`);
      }
    }

    // Commit-or-drop (1.15), AFTER the report and never affecting the exit
    // code below: a non-TTY, `--no-input`, or EOF all drop, so no pipeline or
    // CI run can be surprised by a commit.
    const disposition = await disposeArtifact({
      repoRoot: result.repoRoot,
      artifactPath,
      runId: result.artifact.runId,
      scope: result.artifact.scope,
      interactive:
        options.input !== false && process.stdin.isTTY === true && process.stdout.isTTY === true,
    });
    for (const raw of disposition.lines) {
      // Commit failures carry git's stderr verbatim — sanitized like every
      // other untrusted string that reaches the terminal.
      const line = sanitizeMessage(raw);
      if (line.startsWith("degraded:")) process.stderr.write(`guardrails review: ${line}\n`);
      else process.stdout.write(`${line}\n`);
    }

    if (result.degradedRun) return 2;
    // Exit 1 is the pipeline's gate verdict (enforcement + maxFindings), not
    // a raw any-error-finding rule — advisory findings never flip the code.
    return result.gate.pass ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`guardrails review: ${sanitizeMessage(message)}\n`);
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
    lines.push(`degraded: ${sanitizeMessage(d.subject)} — ${sanitizeMessage(d.reason)}`);
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

/** One degradation as a terminal line. Degradation reasons embed subprocess
 * stderr (`gh`, git) and analyzed-file paths, so a hostile `gh` on PATH — or
 * a repository with a crafted path — could otherwise write ANSI escapes
 * straight to the user's terminal. Same sanitizer as finding messages. */
export function degradationText(degradation: { reason: string; subject: string }): string {
  return `${sanitizeMessage(degradation.reason)} (${sanitizeMessage(degradation.subject)})`;
}

/** Untrusted text can embed analyzed-file content and subprocess stderr — C0
 * control characters (except \n and \t) are stripped so nothing can smuggle
 * terminal escape sequences into the report. Code-point filter, not a regex
 * literal, so no control character ever appears in this source file. */
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
