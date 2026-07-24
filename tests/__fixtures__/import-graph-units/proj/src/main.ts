// Unit-fixture data for the TypeScriptAdapter — parsed, never executed.
import eq = require("./dep"); // ImportEqualsDeclaration → static edge
import { type Inline } from "./dep2"; // inline type-only modifiers
import { outside } from "../../outside"; // resolves above the project root

declare const require: (specifier: string) => unknown;
const viaRequire = require("./dep3"); // require literal → static edge
const which = "./dep3";
const broken = require(which); // non-literal require → degraded, no edge

export { eq, viaRequire, broken, outside };
export type { Inline };
