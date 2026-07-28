/**
 * Optional PR metadata via the user's own `gh` CLI (Story 1.15).
 *
 * OPTIONAL AND DEGRADING, without exception: `gh` absent from PATH,
 * unauthenticated, non-zero, timing out, or returning unparseable/unexpected
 * JSON all produce a DECLARED degradation and the review runs to completion.
 * `gh` is never required, never installed, never a gate.
 *
 * The tool itself performs no network I/O — `gh` is the user's already
 * authenticated client, invoked only for the `pr` scope, and its output is
 * untrusted input parsed through the contracts schema and mapped field by
 * field (never spread) onto the manifest. Fetching PR refs, pushing, and any
 * direct GitHub API use stay out of scope (Epic 5 owns remote flows).
 */
import { spawnSync } from "node:child_process";

import { ghPrViewSchema, type Degradation, type PrMetadata } from "@agentic-guardrails/contracts";

/** Deliberately far below the 120 s git ceiling: this is OPTIONAL metadata,
 * so a `gh` that hangs on a slow network must cost seconds, not minutes. */
export const GH_TIMEOUT_MS = 10_000;

const GH_FIELDS = "title,baseRefName,headRefName,author";

/** The `gh` invocation seam — a unit test must never depend on a real `gh`
 * (or a real network) being present on the machine running it. */
export interface GhRunner {
  (cwd: string, args: readonly string[]): { status: number | null; stdout: string; stderr: string };
}

const spawnGh: GhRunner = (cwd, args) => {
  const result = spawnSync("gh", args as string[], {
    cwd,
    shell: false,
    encoding: "utf8",
    windowsHide: true,
    timeout: GH_TIMEOUT_MS,
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error) {
    return { status: null, stdout: "", stderr: result.error.message };
  }
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

export type GhMetadataResult =
  | { ok: true; metadata: PrMetadata }
  | { ok: false; degradation: Degradation };

/**
 * Opt-out switch for `gh`. `gh` is the ONE subprocess this tool spawns that
 * can talk to a network (the user's own client, on their behalf), so there is
 * an explicit way to keep it out of the loop: an end-to-end test that spawns
 * the built CLI would otherwise shell out to whatever `gh` the developer's
 * PATH happens to hold. Set `GUARDRAILS_NO_GH=1` and the metadata lookup
 * degrades exactly as an absent `gh` does.
 */
export const NO_GH_ENV = "GUARDRAILS_NO_GH";

/** Reads PR metadata for `id`, or explains in one degradation why it could
 * not — the caller records it and carries on. */
export function ghPrMetadata(cwd: string, id: string, run: GhRunner = spawnGh): GhMetadataResult {
  if (process.env[NO_GH_ENV] === "1") return degraded(`disabled by ${NO_GH_ENV}=1`);
  const result = run(cwd, ["pr", "view", id, "--json", GH_FIELDS]);
  if (result.status !== 0) {
    return degraded(
      `gh unavailable or failed (${firstLine(result.stderr) || `exit ${String(result.status)}`})`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch (error) {
    return degraded(`gh returned unparseable JSON: ${firstLine(String(error))}`);
  }
  const parsed = ghPrViewSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return degraded(
      `gh JSON did not match the expected shape: ${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "unknown issue"}`,
    );
  }
  return {
    ok: true,
    metadata: {
      id,
      title: parsed.data.title,
      baseRef: parsed.data.baseRefName,
      headRef: parsed.data.headRefName,
      author: parsed.data.author.login,
    },
  };
}

function degraded(reason: string): GhMetadataResult {
  return {
    ok: false,
    degradation: { reason: `PR metadata unavailable: ${reason}`, subject: "gh-pr-metadata" },
  };
}

function firstLine(message: string): string {
  return (message.split("\n")[0] ?? message).trim();
}
