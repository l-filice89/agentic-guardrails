import { readFileSync } from "node:fs";

// Sync fs call lexically inside an async function: blocks the event loop.
export async function load(p: string): Promise<string> {
  return readFileSync(p, "utf8");
}
