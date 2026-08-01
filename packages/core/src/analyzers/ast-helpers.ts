/**
 * Shared AST binding helpers for the changed-files analyzers (axioms 4 + 5)
 * — the 1.11 shadowing-immune machinery. INTERNAL module: deliberately not
 * re-exported from the core barrel (analyzer implementation detail, not
 * public API).
 */
import { Node, type Expression, type Identifier } from "ts-morph";

/** Objects whose property access reaches the global scope. */
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self"]);

/** True when the identifier's symbol has ANY declaration in the changed
 * file itself — a parameter, local variable, function, class, or import
 * (anything but the ambient global). An unresolvable symbol (no libs) is
 * treated as the global: the hazard forms must stay positive. */
export function hasLocalDeclaration(id: Identifier): boolean {
  const declarations = id.getSymbol()?.getDeclarations() ?? [];
  return declarations.some((d) => d.getSourceFile() === id.getSourceFile());
}

/** `expr.member` / `expr["member"]` → the target expression + member name.
 * Bracket access resolves only for a string LITERAL name — a computed name
 * is not statically decidable. */
export function memberAccess(node: Node): { target: Expression; member: string } | undefined {
  if (Node.isPropertyAccessExpression(node)) {
    return { target: node.getExpression(), member: node.getName() };
  }
  if (Node.isElementAccessExpression(node)) {
    const arg = node.getArgumentExpression();
    if (arg !== undefined && Node.isStringLiteral(arg)) {
      return { target: node.getExpression(), member: arg.getLiteralValue() };
    }
  }
  return undefined;
}

/** The AMBIENT global `name`: a bare identifier with no local declaration,
 * or `globalThis.name` / `window.name` / `self.name` where the base itself
 * is not locally shadowed. */
export function isGlobalRef(node: Node, name: string): boolean {
  if (Node.isIdentifier(node)) {
    return node.getText() === name && !hasLocalDeclaration(node);
  }
  const access = memberAccess(node);
  return (
    access !== undefined &&
    access.member === name &&
    Node.isIdentifier(access.target) &&
    GLOBAL_OBJECTS.has(access.target.getText()) &&
    !hasLocalDeclaration(access.target)
  );
}
