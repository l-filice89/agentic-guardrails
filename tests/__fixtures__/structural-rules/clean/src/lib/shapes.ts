// Type-only import crossing layers AGAINST the allowed direction — legal:
// erased at runtime, exempt from the direction rule.
import type { main } from "../app/main.js";
export type MainShape = typeof main;
export const shapes = 1;
