// Unit-fixture data for the TypeScriptAdapter — parsed, never executed.
import eq = require("./dep"); // ImportEqualsDeclaration → static edge
import { type Inline } from "./dep2"; // inline type-only modifiers
import { outside } from "../../outside"; // resolves above the project root
import "./styles.css"; // bundler-resolved asset → valid external edge

const viaRequire = require("./dep3"); // require literal → static edge
const viaTemplate = import(`./dep3`); // static template → dynamic edge
const viaParentheses = import(("./dep2")); // parenthesized literal → dynamic edge
const which = "./dep3";
const broken = require(which); // non-literal require → degraded, no edge
function userRequire(require: (specifier: string) => unknown) {
  return require("./shadowed"); // user binding → ignored
}
import "@/styles.css"; // aliased bundler asset → valid external edge
import "./missing.ts?x"; // unresolved code target with suffix → degradation

export { eq, viaRequire, viaTemplate, viaParentheses, broken, outside, userRequire };
export type { Inline };
