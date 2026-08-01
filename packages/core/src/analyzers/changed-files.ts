/**
 * Shared changed-files parse pass (Story 1.11 P4): ONE fresh parse-only
 * ts-morph project over the deduped, sorted changed-file set, consumed by
 * every changed-files analyzer (axiom 3 + axiom 4) — via the pipeline's
 * `changedFilesCache.acquire` seam the parse happens once per run.
 *
 * Parse-only: module specifiers are never resolved here — the import graph
 * owns cross-file truth; this pass owns the changed files' own syntax.
 */
import path from "node:path";

import type { Degradation } from "@agentic-guardrails/contracts";
import { Project, type SourceFile } from "ts-morph";

export interface ChangedFilesInput {
  /** Absolute repo root. */
  repoRoot: string;
  /** Changed analyzable TS files, repo-root-relative. */
  changedFiles: readonly string[];
  /** Phase-1 budget signal — checked between files. */
  signal?: AbortSignal;
}

export interface ChangedFilesParse {
  /** (file, parsed source) pairs in sorted-dedup order. */
  parsed: readonly (readonly [string, SourceFile])[];
  /** Per-file read failures and budget-abort gaps — declared coverage loss. */
  degraded: readonly Degradation[];
}

/** Acquire-style seam for the shared parse (mirrors GraphCache.acquire):
 * check + build + store in ONE synchronous frame — no await anywhere — so
 * two analyzers can never race past the same miss. */
export interface ChangedFilesCache {
  acquire(build: () => ChangedFilesParse): ChangedFilesParse;
}

/**
 * Parse the changed files. The change list is deduped and sorted: a
 * duplicate changedFiles entry must never double any per-file finding or
 * degradation (the 1.10 contract). ts-morph parses ANY text without
 * throwing — only the READ can fail (missing/unreadable file), which is
 * silent coverage loss: declared, never thrown, never skipped quietly.
 */
export function parseChangedFiles(input: ChangedFilesInput): ChangedFilesParse {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false },
  });
  const parsed: [string, SourceFile][] = [];
  const degraded: Degradation[] = [];
  for (const file of [...new Set(input.changedFiles)].sort()) {
    if (input.signal?.aborted) {
      // Budget cut the pass off: the remaining files are declared coverage
      // loss, never silently unparsed.
      degraded.push({
        reason: "phase budget aborted the changed-file pass before this file was parsed",
        subject: file,
      });
      continue;
    }
    try {
      parsed.push([file, project.addSourceFileAtPath(path.join(input.repoRoot, file))]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      degraded.push({
        reason: `changed file could not be read: ${firstLine(message)}`,
        subject: file,
      });
    }
  }
  return { parsed, degraded };
}

/** First line of a message — `\r?\n` so a Windows CRLF message never leaks
 * a trailing `\r` into a degradation reason. */
export function firstLine(message: string): string {
  return message.split(/\r?\n/, 1)[0]!;
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0; // code-point order, locale-independent
}
