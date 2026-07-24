/**
 * @agentic-guardrails/cli — the `guardrails` command surface. Depends on
 * core + contracts only (boundary-checked); no LLM SDKs, no config plane
 * (1.6), no cache (1.7).
 *
 * Exit-code contract: 0 clean (and `--version`/`--help`) · 1 error-severity
 * findings · 2 everything unexpected — usage errors, unknown subcommands, a
 * bare invocation, and crashes. Never a silent 0.
 */
import { Command, CommanderError } from "commander";

import { ENGINE_VERSION } from "@agentic-guardrails/core";

import { reviewCommand } from "./review-command.js";

const program = new Command();
program
  .name("guardrails")
  .description("Deterministic-first code review guardrails")
  // Single-sourced from core (see ENGINE_VERSION's provenance comment).
  .version(ENGINE_VERSION);

program
  .command("review")
  .description("Review uncommitted changes (staged, unstaged, untracked)")
  .action(async () => {
    process.exitCode = await reviewCommand(process.cwd());
  });

// exitOverride turns commander's process.exit into a typed throw so WE own
// the exit code: usage errors must exit 2, not commander's default 1.
program.exitOverride();

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
