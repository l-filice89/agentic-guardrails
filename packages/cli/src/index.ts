/**
 * @agentic-guardrails/cli — the `guardrails` command surface. Depends on
 * core + contracts only (boundary-checked); no LLM SDKs, no cache (1.7).
 * Config plane (1.6): the pipeline loads `_agentic-guardrails/config.yaml`;
 * this layer only surfaces deviations and honors the gate verdict.
 *
 * Exit-code contract: 0 clean (and `--version`/`--help`) · 1 error-severity
 * findings · 2 everything unexpected — usage errors, unknown subcommands, a
 * bare invocation, and crashes. Never a silent 0.
 */
import { Command, CommanderError, Option } from "commander";

import { ENGINE_VERSION } from "@agentic-guardrails/core";

import { initCommand } from "./init-command.js";
import { reviewCommand, type ReviewCommandOptions } from "./review-command.js";

const program = new Command();
program
  .name("guardrails")
  .description("Deterministic-first code review guardrails")
  // Single-sourced from core (see ENGINE_VERSION's provenance comment).
  .version(ENGINE_VERSION);

// exitOverride turns commander's process.exit into a typed throw so WE own
// the exit code: usage errors must exit 2, not commander's default 1. Set
// BEFORE the subcommands are created so they inherit it — a `--pr 1 --project`
// conflict is raised by the subcommand, not by the program.
program.exitOverride();

program
  .command("init")
  .description("Bootstrap _agentic-guardrails/ (config, ledger files, git wiring, seed)")
  .option("--no-input", "skip the questionnaire and write documented defaults")
  .action(async (options: { input?: boolean }) => {
    process.exitCode = await initCommand(process.cwd(), options);
  });

// Scope flags are mutually exclusive through commander's own `conflicts`, so
// `--pr 1 --project` is a usage error (exit 2 via exitOverride) rather than a
// silent precedence rule the user has to guess.
program
  .command("review")
  .description("Review uncommitted changes, a branch, a locally fetched PR ref, or the project")
  .addOption(
    new Option("--branch [ref]", "review a branch ref against its merge-base (default: HEAD's branch)")
      .conflicts(["pr", "project"]),
  )
  .addOption(
    new Option("--pr <id>", "review a LOCALLY FETCHED pull-request ref (no network)")
      .conflicts(["branch", "project"]),
  )
  .addOption(
    new Option("--project", "review every tracked file, not a diff").conflicts(["branch", "pr"]),
  )
  .option("--base <ref>", "diff base for --branch/--pr (default: the repo's default branch)")
  .option("--no-input", "skip the commit-or-drop prompt and leave the artifact untracked")
  .action(async (options: ReviewCommandOptions) => {
    process.exitCode = await reviewCommand(process.cwd(), options);
  });

try {
  if (process.argv.length <= 2) {
    // Bare `guardrails` is a usage error, not a clean run: help + exit 2.
    program.outputHelp({ error: true });
    process.exitCode = 2;
  } else {
    await program.parseAsync(process.argv);
  }
} catch (error) {
  if (error instanceof CommanderError) {
    // `--version` / `--help` are successful outcomes; everything else
    // (unknown command, bad option, missing argument) is a usage error.
    const clean = error.code === "commander.version" || error.code === "commander.helpDisplayed";
    process.exitCode = clean ? 0 : 2;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`guardrails: ${message}\n`);
    process.exitCode = 2;
  }
}
