import { readFileSync } from "node:fs";

// Sync fs in a SYNC function (and the module-top-level config-load idiom)
// stays exempt: only async enclosure flags.
export function loadConfig(p: string): string {
  return readFileSync(p, "utf8");
}
