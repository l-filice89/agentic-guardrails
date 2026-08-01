// Idiomatic: the only export of ./util.ts is imported by name and used.
import { helper } from "./util.js";
export function run(): number {
  return helper + 1;
}
