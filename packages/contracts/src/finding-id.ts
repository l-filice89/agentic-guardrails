// node:crypto is a Node builtin, not a runtime *dependency* — zod stays the
// only entry in `dependencies` (ADR-005 / Story 1.2 boundary).
import { createHash } from "node:crypto";

export interface FindingIdInput {
  axiom: string;
  ruleId: string;
  file: string;
  /**
   * The line-drift-stable anchor: the enclosing symbol name from the AST, or
   * a normalized context string when no symbol exists. Deliberately NOT a
   * line/column number, so ids survive unrelated lines being added above.
   *
   * CONVENTION: a Finding with NO `enclosingSymbol` (file-level identity,
   * e.g. `structural/unassigned-file`) hashes the EMPTY STRING here — pass
   * `""`. Recomputing an id from a persisted Finding therefore maps an
   * absent `enclosingSymbol` field to `""`.
   */
  enclosingSymbol: string;
}

/**
 * Stable identity for a Finding: sha256-hex over
 * `{axiom, ruleId, file, enclosingSymbol}`. No line/column numbers in the
 * hash input, so the id is stable under line drift.
 */
export function computeFindingId(input: FindingIdInput): string {
  return createHash("sha256")
    .update(
      // ponytail: fixed-order JSON of the four fields; delimiter-safe and boring.
      // File separators normalized so the same logical finding hashes
      // identically on Windows and POSIX (dispositions must not fork per-OS).
      JSON.stringify([
        input.axiom,
        input.ruleId,
        input.file.replaceAll("\\", "/"),
        input.enclosingSymbol,
      ]),
    )
    .digest("hex");
}
