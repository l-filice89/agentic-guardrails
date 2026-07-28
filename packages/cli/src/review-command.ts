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
  formatScoreTenths,
  runReview,
  writeReviewArtifact,
  type AxiomDelta,
  type ReviewArtifact,
  type ScopeRequest,
  type TrendAggregation,
} from "@agentic-guardrails/core";

import { disposeArtifact } from "./disposition.js";
import { disposeFindings } from "./finding-disposition.js";
import { sanitizeMessage } from "./sanitize.js";

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
      // Retention (1.16): bound the per-run artifact store. Committed history
      // is a different store and is never pruned.
      maxEntries: result.artifactRetention,
    });
    const relativePath = path
      .relative(result.repoRoot, artifactPath)
      .replaceAll("\\", "/");
    process.stdout.write(
      formatSummary(result.artifact, relativePath, result.runDegraded, result.trend),
    );

    // History-plane visibility (1.16). A trend append that failed must never
    // fail the run — the gate verdict is decided by findings — but a history
    // plane that silently stops recording is how a longitudinal feature dies
    // unnoticed, so it is always said out loud.
    if (result.trendWrite.state === "failed") {
      process.stderr.write(
        `guardrails review: degraded: trend record not appended: ${sanitizeMessage(result.trendWrite.reason)}\n`,
      );
    } else if (result.trendWrite.repaired) {
      process.stderr.write(
        "guardrails review: trend history had a torn final record (a writer was killed mid-append) — repaired\n",
      );
    }
    for (const declaration of result.trend.declarations) {
      process.stderr.write(`guardrails review: trends: ${sanitizeMessage(declaration)}\n`);
    }

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

    // The interactivity test is the SAME three-way guard both prompts use
    // (flag + both TTYs): a pipe, a redirect or `--no-input` must never let
    // either of them construct a readline interface, let alone block on one.
    const interactive =
      options.input !== false && process.stdin.isTTY === true && process.stdout.isTTY === true;

    // DR-1 finding dispositions (1.16) — INDEPENDENT of the artifact
    // disposition below: findings are labelled whether the artifact ends up
    // committed or dropped, and neither prompt touches the exit code.
    const findingDisposition = await disposeFindings({
      repoRoot: result.repoRoot,
      runId: result.artifact.runId,
      findings: result.artifact.findings,
      interactive,
      policy: result.dispositionPolicy,
    });
    writeDispositionLines(findingDisposition.lines);

    // Commit-or-drop (1.15), AFTER the report and never affecting the exit
    // code below: a non-TTY, `--no-input`, or EOF all drop, so no pipeline or
    // CI run can be surprised by a commit.
    const disposition = await disposeArtifact({
      repoRoot: result.repoRoot,
      artifactPath,
      runId: result.artifact.runId,
      scope: result.artifact.scope,
      interactive,
    });
    writeDispositionLines(disposition.lines);

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

/** Both disposition surfaces report through `lines: string[]` rather than
 * writing to a stream, so the routing rule (degradations to stderr, outcomes
 * to stdout) and the sanitizer live in ONE place — a commit failure carries
 * git's stderr verbatim, and a disposition path carries a repo path. */
function writeDispositionLines(lines: readonly string[]): void {
  for (const raw of lines) {
    const line = sanitizeMessage(raw);
    if (line.startsWith("degraded:")) process.stderr.write(`guardrails review: ${line}\n`);
    else process.stdout.write(`${line}\n`);
  }
}

/** Plain sequential text (UI-MOCK-GATE ruling: sketch lives in the spec). */
export function formatSummary(
  artifact: ReviewArtifact,
  artifactRelativePath: string,
  runDegraded: readonly Degradation[],
  trend?: TrendAggregation,
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
  // FR-15: the per-axiom delta against the previous comparable run, keyed by
  // axiom so it reads beside that axiom's current counts. REPORT-ONLY — it
  // depends on prior history, so it is never written to the artifact.
  const deltaByAxiom = new Map((trend?.deltas ?? []).map((d) => [d.axiom, d]));

  for (const axiom of [...byAxiom.keys()].sort()) {
    const group = byAxiom.get(axiom)!;
    const category = AXIOM_CATEGORY[axiom] ?? "uncategorized";
    const delta = deltaByAxiom.get(axiom);
    lines.push(
      `axiom ${axiom} · ${category}   ${severityCounts(group)}` +
        (delta === undefined ? "" : `   ${formatDelta(delta)}`),
    );
    for (const f of group) {
      lines.push(
        `  ${f.location.file}:${f.location.startLine}  ${f.severity}  ${sanitizeMessage(f.message)}  [${f.ruleId}]`,
      );
    }
  }

  // An axiom that STOPPED producing findings has a delta and no findings
  // block to hang it on — and it is the interesting one. Without this it
  // would silently vanish from the report.
  for (const delta of trend?.deltas ?? []) {
    if (byAxiom.has(delta.axiom)) continue;
    const category = AXIOM_CATEGORY[delta.axiom] ?? "uncategorized";
    lines.push(`axiom ${delta.axiom} · ${category}   no findings   ${formatDelta(delta)}`);
  }

  // FR-14: the derived OD-1 score, always beside its formula version so a
  // future v2 number can never be mistaken for a v1 one. An omitted score
  // says WHY rather than printing a 0 or 100 that means "undefined".
  const scores = artifact.scores;
  if (scores !== undefined) {
    // `changedLines` is absent exactly when the scope has no denominator, and
    // that branch prints the omission reason instead of this string.
    const lineCount = scores.changedLines ?? 0;
    const kloc = `${lineCount} changed line${lineCount === 1 ? "" : "s"}`;
    const binary =
      scores.binaryFiles > 0 ? `, ${scores.binaryFiles} binary file(s) uncounted` : "";
    lines.push(
      scores.scoreTenths === undefined
        ? `score: n/a (${sanitizeMessage(scores.scoreOmittedReason ?? "no denominator")}) · ${scores.formulaVersion}`
        : `score: ${formatScoreTenths(scores.scoreTenths)}/100 · ${scores.formulaVersion} · ${kloc}${binary}`,
    );
  }
  if (trend?.coldStart === true) {
    // A first run genuinely has nothing to compare against. Saying so is the
    // difference between "no change" and "no baseline".
    lines.push("trend: no comparable previous run — this run is the baseline");
  }

  lines.push(`artifact: ${artifactRelativePath}`);
  lines.push(
    `${artifact.findings.length} finding${artifact.findings.length === 1 ? "" : "s"} ` +
      `(${severityCounts(artifact.findings)}) · deterministic tier · ` +
      `${runDegraded.length} degraded`,
  );
  return `${lines.join("\n")}\n`;
}

/** One axiom's movement since the previous comparable run, signed so a
 * regression and an improvement never look the same at a glance. */
function formatDelta(delta: AxiomDelta): string {
  const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));
  return `Δ ${signed(delta.error)}E ${signed(delta.warning)}W ${signed(delta.info)}I`;
}

/** One degradation as a terminal line. Degradation reasons embed subprocess
 * stderr (`gh`, git) and analyzed-file paths, so a hostile `gh` on PATH — or
 * a repository with a crafted path — could otherwise write ANSI escapes
 * straight to the user's terminal. Same sanitizer as finding messages. */
export function degradationText(degradation: { reason: string; subject: string }): string {
  return `${sanitizeMessage(degradation.reason)} (${sanitizeMessage(degradation.subject)})`;
}

// `sanitizeMessage` moved to `./sanitize.js` — `trends-command.ts` and the
// disposition prompt print equally untrusted text and must use the same rule,
// and importing it from here would make a cycle with `finding-disposition.ts`.

function severityCounts(findings: readonly Finding[]): string {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const info = findings.filter((f) => f.severity === "info").length;
  return `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}, ${info} info`;
}
