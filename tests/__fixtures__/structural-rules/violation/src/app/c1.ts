// Cycle member (anchor): imports c2, which imports back.
import { c2 } from "./c2.js";
export const c1 = c2 + 1;
