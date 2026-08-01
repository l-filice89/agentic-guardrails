// Legal: same-layer import + declared app -> lib direction + dynamic import
// within the declared direction.
import { helper } from "./helper.js";
import { util } from "../lib/util.js";
export const main = helper + util;
export const lazy = async (): Promise<unknown> => await import("../lib/util.js");
