/**
 * The terminal sanitizer, in one place because three commands need it and a
 * second copy would drift.
 *
 * NOT an HTML or script-context escape — see `trends-command.ts` for those.
 * Three contexts, three rules, and using any one of them in another's place is
 * a hole.
 */

/** Untrusted text can embed analyzed-file content, subprocess stderr and
 * lines merged into committed history from another clone — C0 control
 * characters (except \n and \t) are stripped so nothing can smuggle terminal
 * escape sequences into the report. Code-point filter, not a regex literal,
 * so no control character ever appears in this source file. */
export function sanitizeMessage(message: string): string {
  return [...message]
    .filter((c) => c === "\n" || c === "\t" || c.charCodeAt(0) >= 0x20)
    .join("");
}
