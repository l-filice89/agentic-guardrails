/** Case-insensitive filesystems (win32/darwin): git paths, graph paths and
 * configured path prefixes may disagree in case for the same file — fold
 * before membership compares. ONE implementation for every path compare in
 * core (analyzers, scope exclusions). Moved here in 1.18 from
 * `analyzers/axiom1-structural.ts` — it is a generic path-case utility, not
 * analyzer logic. */
const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";
export function foldCase(p: string): string {
  return CASE_INSENSITIVE ? p.toLowerCase() : p;
}
