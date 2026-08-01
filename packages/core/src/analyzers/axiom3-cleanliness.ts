/**
 * Axiom #3 (cleanliness) — the deterministic AST-tier rule set (Story 1.10),
 * all inside the ONE registered axiom-3 analyzer:
 *
 * - `cleanliness/unreachable-code`     error    statements after a terminal
 *                                               statement (return/throw/
 *                                               break/continue) in the same
 *                                               block of a changed file
 * - `cleanliness/unused-export`        warning  an exported symbol declared
 *                                               in a CHANGED file that no
 *                                               file in the analyzed project
 *                                               imports by name
 * - `cleanliness/duplicate-code`       warning  two function-like bodies
 *                                               (≥5 statements) among the
 *                                               changed files with identical
 *                                               normalized structure
 * - `cleanliness/excessive-complexity` warning  cyclomatic complexity > 15
 *                                               per function-like in a
 *                                               changed file
 *
 * Unused-export rides the import graph (acquired exactly like axiom1:
 * graphCache.acquire + mergeGraphResults) and consumes the per-edge binding
 * `names` the 1.10 adapter records. Semantics: a namespace import
 * (`import * as`), `export * from`, dynamic `import()`, `require()`, or
 * `import =` of a file counts as using ALL its exports; `export default`
 * is tracked as the name "default"; type-only usage counts as usage. Files
 * with ZERO names-bearing importers are EXEMPT entirely — a side-effect-only
 * import (`import "./setup.js"`) binds nothing, so such a file stays
 * indistinguishable from an entry point (a deliberate ceiling; SPIKE-4
 * measures the trade).
 *
 * The other three rules parse ONLY the changed files via the shared
 * parse-only pass (`changed-files.ts`, one parse per run across axiom 3 +
 * axiom 4) — changed-set-sized, never project-sized (the SPIKE-3
 * anti-pattern stays out). Duplicate detection is changed-files-only on
 * purpose: it
 * catches copy-paste introduced by the diff (the AI-code case) without a
 * project-wide index.
 */
import { createHash } from "node:crypto";

import {
  computeFindingId,
  type Degradation,
  type Finding,
} from "@agentic-guardrails/contracts";
import { Node, SyntaxKind, type SourceFile, type Statement } from "ts-morph";

import { TypeScriptAdapter } from "../adapter/typescript-adapter.js";
import type { Analyzer, AnalyzerContext, AnalyzerResult } from "../pipeline/pipeline.js";
import { mergeGraphResults } from "./axiom1-structural.js";
import { foldCase } from "../util/fold-case.js";
import { compare, firstLine, parseChangedFiles } from "./changed-files.js";

const AXIOM = "3";
const RULE_UNREACHABLE = "cleanliness/unreachable-code";
const RULE_UNUSED = "cleanliness/unused-export";
const RULE_DUPLICATE = "cleanliness/duplicate-code";
const RULE_COMPLEXITY = "cleanliness/excessive-complexity";

/** Cyclomatic threshold. Hardcoded on purpose: 15 sits above idiomatic
 * switch-heavy code but below the unreviewable — the AI failure mode is a
 * single mega-function, not a 16th case. Config exposure is later scope
 * (ponytail ceiling). */
export const COMPLEXITY_THRESHOLD = 15;

/** Minimum statements for a body to enter duplicate detection: keeps
 * idiom-level similarity (guard clauses, small mappers) out of the findings. */
export const DUPLICATE_MIN_STATEMENTS = 5;

const TERMINAL_KINDS = new Map<SyntaxKind, string>([
  [SyntaxKind.ReturnStatement, "return"],
  [SyntaxKind.ThrowStatement, "throw"],
  [SyntaxKind.BreakStatement, "break"],
  [SyntaxKind.ContinueStatement, "continue"],
]);

/** Function-like node kinds — shared with the axiom-4 NFR analyzer (1.11),
 * which reuses the same enclosure semantics. */
export const FUNCTION_LIKE_KINDS = new Set<SyntaxKind>([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.ArrowFunction,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.Constructor,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
]);

const LITERAL_KINDS = new Set<SyntaxKind>([
  SyntaxKind.StringLiteral,
  SyntaxKind.NumericLiteral,
  SyntaxKind.BigIntLiteral,
  SyntaxKind.RegularExpressionLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateHead,
  SyntaxKind.TemplateMiddle,
  SyntaxKind.TemplateTail,
  SyntaxKind.TrueKeyword,
  SyntaxKind.FalseKeyword,
]);

interface DuplicateOccurrence {
  file: string;
  line: number;
  hash: string;
  /** Nearest enclosing function-like that ALSO produced an occurrence —
   * lets a nested closure's pair be filtered when its enclosing functions
   * are themselves the same duplicate pair (one finding, not two). */
  parent?: DuplicateOccurrence;
}

export const axiom3Cleanliness: Analyzer = {
  axiom: AXIOM,
  // Async by contract (Analyzer.run); the body is CPU-bound today.
  async run(context: AnalyzerContext): Promise<AnalyzerResult> {
    if (context.changedFiles.length === 0) {
      return { findings: [], degraded: [] };
    }

    // Graph acquisition — identical to axiom1 (content-addressed cache when
    // the pipeline wires one in; a hit skips the ts-morph parse entirely).
    const adapter = new TypeScriptAdapter();
    const build = (tsconfigPath: string) =>
      adapter.buildImportGraph({
        tsconfigPath,
        rootDir: context.repoRoot,
        dependencyRoot: context.dependencyRoot,
      });
    const graphResult = mergeGraphResults(
      context.tsconfigPaths.map(
        (tsconfigPath) =>
          context.graphCache?.acquire(tsconfigPath, () => build(tsconfigPath)) ??
          build(tsconfigPath),
      ),
    );
    const degraded: Degradation[] = [...graphResult.degraded];
    const findings: Finding[] = [];

    // ---- changed-file AST pass (shared parse-only project, 1.11 P4) -------
    // Acquired through the pipeline's run-local seam so axiom 3 + axiom 4
    // consume ONE parse per run; bare unit-test contexts parse directly.
    const parse =
      context.changedFilesCache?.acquire(() => parseChangedFiles(context)) ??
      parseChangedFiles(context);
    const parsed = parse.parsed;
    degraded.push(...parse.degraded);

    // ONE pre-pass over the merged edges builds the unused-export usage
    // index — no per-changed-file rescan of the full edge list.
    const usageIndex = buildUsageIndex(graphResult.data.edges);

    const duplicates: DuplicateOccurrence[] = [];
    for (const [file, sf] of parsed) {
      findings.push(...unreachableCodeFindings(file, sf));
      findings.push(...complexityFindings(file, sf));
      collectDuplicateBodies(file, sf, duplicates, degraded);
      findings.push(...unusedExportFindings(file, sf, usageIndex.get(foldCase(file))));
    }
    findings.push(...duplicateFindings(duplicates));

    findings.sort(
      (a, b) =>
        compare(a.location.file, b.location.file) ||
        a.location.startLine - b.location.startLine ||
        compare(a.ruleId, b.ruleId) ||
        compare(a.enclosingSymbol ?? "", b.enclosingSymbol ?? ""),
    );
    return { findings, degraded };
  },
};

// ---- cleanliness/unreachable-code (error) ----------------------------------

/** Statement-container nodes: their `statements` lists are where "after a
 * terminal statement in the same block" is decidable. */
function statementsOf(node: Node): Statement[] | undefined {
  if (
    Node.isSourceFile(node) ||
    Node.isBlock(node) ||
    Node.isModuleBlock(node) ||
    Node.isCaseClause(node) ||
    Node.isDefaultClause(node)
  ) {
    return node.getStatements();
  }
  return undefined;
}

/** Statements after a terminal that are NOT dead at runtime: a hoisted
 * `function` declaration is reachable (idiomatic `return helper();` above
 * `function helper() {}`), and type-only statements (type alias/interface)
 * are erased at runtime. Neither counts as unreachable, and the anchor
 * skips over them to the first real dead statement. */
function isReachabilityExempt(statement: Statement): boolean {
  const kind = statement.getKind();
  return (
    kind === SyntaxKind.FunctionDeclaration ||
    kind === SyntaxKind.TypeAliasDeclaration ||
    kind === SyntaxKind.InterfaceDeclaration
  );
}

function unreachableCodeFindings(file: string, sf: SourceFile): Finding[] {
  const findings: Finding[] = [];
  // Line-free discriminator: enclosing symbol name + the container's ordinal
  // among ALL statement containers under that symbol (document order) — a
  // violating block keeps its identity when unrelated lines shift.
  const ordinals = new Map<string, number>();
  const containers: Node[] = [sf];
  sf.forEachDescendant((node) => {
    if (statementsOf(node) !== undefined) containers.push(node);
  });
  for (const container of containers) {
    const enclosing = enclosingSymbolName(container);
    const ordinal = ordinals.get(enclosing) ?? 0;
    ordinals.set(enclosing, ordinal + 1);
    const statements = statementsOf(container)!;
    const terminalAt = statements.findIndex((s) => TERMINAL_KINDS.has(s.getKind()));
    if (terminalAt === -1 || terminalAt === statements.length - 1) continue;
    const terminal = TERMINAL_KINDS.get(statements[terminalAt]!.getKind())!;
    // Anchor at the first NON-EXEMPT statement after the terminal; a block
    // whose trailing statements are all hoisted/type-only has no dead code.
    const dead = statements.slice(terminalAt + 1).find((s) => !isReachabilityExempt(s));
    if (dead === undefined) continue;
    const discriminator = `${enclosing}#block-${ordinal}`;
    const line = dead.getStartLineNumber();
    findings.push({
      findingId: computeFindingId({
        axiom: AXIOM,
        ruleId: RULE_UNREACHABLE,
        file,
        enclosingSymbol: discriminator,
      }),
      axiom: AXIOM,
      ruleId: RULE_UNREACHABLE,
      location: { file, startLine: line, endLine: line },
      message: `unreachable code: statements after a \`${terminal}\` in the same block can never execute`,
      tier: "deterministic",
      source: "ast",
      confidence: 1,
      severity: "error",
      enclosingSymbol: discriminator,
    });
  }
  return findings;
}

// ---- cleanliness/excessive-complexity (warning) ----------------------------

const DECISION_KINDS = new Set<SyntaxKind>([
  SyntaxKind.IfStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CaseClause,
  SyntaxKind.CatchClause,
  SyntaxKind.ConditionalExpression,
]);

const DECISION_OPERATORS = new Set<SyntaxKind>([
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
  // Logical-assignment forms short-circuit exactly like their operators.
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
]);

/** Cyclomatic complexity of ONE function-like: +1 base, +1 per decision
 * point (if / else-if / for / while / do / case / catch / && / || / ?? /
 * &&= / ||= / ??= / ternary). Nested function-likes are their own units —
 * excluded here, measured separately. */
export function cyclomaticComplexity(fn: Node): number {
  let complexity = 1;
  fn.forEachDescendant((node, traversal) => {
    if (FUNCTION_LIKE_KINDS.has(node.getKind())) {
      traversal.skip();
      return;
    }
    if (DECISION_KINDS.has(node.getKind())) {
      complexity += 1;
    } else if (
      Node.isBinaryExpression(node) &&
      DECISION_OPERATORS.has(node.getOperatorToken().getKind())
    ) {
      complexity += 1;
    }
  });
  return complexity;
}

function functionLikes(sf: SourceFile): Node[] {
  const fns: Node[] = [];
  sf.forEachDescendant((node) => {
    if (FUNCTION_LIKE_KINDS.has(node.getKind())) fns.push(node);
  });
  return fns;
}

function complexityFindings(file: string, sf: SourceFile): Finding[] {
  const findings: Finding[] = [];
  let anonymous = 0;
  const nameCounts = new Map<string, number>();
  for (const fn of functionLikes(sf)) {
    const complexity = cyclomaticComplexity(fn);
    // Anonymous ordinal advances for EVERY nameless function-like (document
    // order), so a compliant anonymous function ahead of a violating one
    // still yields a stable discriminator for the violator. Same-named
    // function-likes (shadowed locals, same method name across scopes) get
    // the `name#N` ordinal the unreachable rule uses — two violators with
    // one name must never share a findingId. The counter advances for every
    // occurrence, violating or not, so ordinals stay stable.
    const base = functionSymbolName(fn) ?? `(anonymous)#${anonymous++}`;
    const ordinal = nameCounts.get(base) ?? 0;
    nameCounts.set(base, ordinal + 1);
    const name = ordinal === 0 ? base : `${base}#${ordinal}`;
    if (complexity <= COMPLEXITY_THRESHOLD) continue;
    const line = fn.getStartLineNumber();
    findings.push({
      findingId: computeFindingId({
        axiom: AXIOM,
        ruleId: RULE_COMPLEXITY,
        file,
        enclosingSymbol: name,
      }),
      axiom: AXIOM,
      ruleId: RULE_COMPLEXITY,
      location: { file, startLine: line, endLine: line },
      message: `excessive cyclomatic complexity: ${complexity} > ${COMPLEXITY_THRESHOLD} (threshold) — split \`${name}\` into smaller units`,
      tier: "deterministic",
      source: "ast",
      confidence: 1,
      severity: "warning",
      enclosingSymbol: name,
    });
  }
  return findings;
}

// ---- cleanliness/duplicate-code (warning) ----------------------------------

/**
 * Structural normalization: identifiers → `ID`, literals → `LIT`,
 * whitespace/comments gone (they are trivia — never in the child list).
 * `const a = getFoo()` therefore matches `const b = getBar()` — the
 * copy-paste-then-rename pattern AI diffs produce.
 */
export function normalizeStructure(node: Node): string {
  const kind = node.getKind();
  if (kind === SyntaxKind.Identifier || kind === SyntaxKind.PrivateIdentifier) return "ID";
  if (LITERAL_KINDS.has(kind)) return "LIT";
  // JSDoc nodes ARE in the child list (unlike `//` trivia) — skipped so the
  // comments-stripped contract holds for doc comments too.
  const children = node.getChildren().filter((c) => c.getKind() !== SyntaxKind.JSDoc);
  if (children.length === 0) return node.getKindName();
  return children.map((child) => normalizeStructure(child)).join(" ");
}

function collectDuplicateBodies(
  file: string,
  sf: SourceFile,
  out: DuplicateOccurrence[],
  degraded: Degradation[],
): void {
  const byNode = new Map<Node, DuplicateOccurrence>();
  for (const fn of functionLikes(sf)) {
    const body = Node.isBodyable(fn) || Node.isBodied(fn) ? fn.getBody() : undefined;
    if (body === undefined || !Node.isBlock(body)) continue; // expression-bodied arrows have no statement list
    if (body.getStatements().length < DUPLICATE_MIN_STATEMENTS) continue;
    let hash: string;
    try {
      hash = createHash("sha256").update(normalizeStructure(body)).digest("hex");
    } catch (error) {
      // normalizeStructure recurses per AST depth: a pathologically nested
      // body (thousands of chained operators) can blow the stack. Typed
      // degradation for THIS body; every other body and rule is unaffected.
      // (Not unit-tested: constructing a genuine overflow is platform- and
      // stack-size-dependent — flaky by nature.)
      const message = error instanceof Error ? error.message : String(error);
      degraded.push({
        reason: `duplicate-code normalization failed: ${firstLine(message)}`,
        subject: file,
      });
      continue;
    }
    const occurrence: DuplicateOccurrence = { file, line: fn.getStartLineNumber(), hash };
    // Nearest enclosing function-like that also produced an occurrence
    // (functionLikes yields outer before nested — document order).
    for (let cursor = fn.getParent(); cursor !== undefined; cursor = cursor.getParent()) {
      const parent = byNode.get(cursor);
      if (parent !== undefined) {
        occurrence.parent = parent;
        break;
      }
    }
    byNode.set(fn, occurrence);
    out.push(occurrence);
  }
}

function duplicateFindings(occurrences: DuplicateOccurrence[]): Finding[] {
  // Canonical order BEFORE pairing: the original is the first occurrence in
  // (file, line) order, never in changed-file discovery order — duplicate
  // findingIds stay stable however the change set was enumerated.
  const sorted = [...occurrences].sort((a, b) => compare(a.file, b.file) || a.line - b.line);
  const groups = new Map<string, DuplicateOccurrence[]>();
  for (const occurrence of sorted) {
    const group = groups.get(occurrence.hash);
    if (group === undefined) groups.set(occurrence.hash, [occurrence]);
    else group.push(occurrence);
  }
  const findings: Finding[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordinals = new Map<DuplicateOccurrence, number>();
    const perFile = new Map<string, number>();
    for (const occurrence of group) {
      const ordinal = perFile.get(occurrence.file) ?? 0;
      ordinals.set(occurrence, ordinal);
      perFile.set(occurrence.file, ordinal + 1);
    }
    for (let originalIndex = 0; originalIndex < group.length - 1; originalIndex += 1) {
      const original = group[originalIndex]!;
      for (const dup of group.slice(originalIndex + 1)) {
        // A nested pair whose ENCLOSING function-likes are themselves the same
        // duplicate pair is subsumed by the outer finding — copying an outer
        // function must not double-count its nested closures.
        if (
          original.parent !== undefined &&
          dup.parent !== undefined &&
          original.parent !== dup.parent &&
          original.parent.hash === dup.parent.hash
        ) {
          continue;
        }
        // One finding per occurrence pair, anchored at the later occurrence.
        // Per-file occurrence ordinals distinguish repeated pairs while
        // keeping persisted identity independent of line numbers.
        const discriminator = `${dup.hash}:${original.file}#${ordinals.get(original)}:${dup.file}#${ordinals.get(dup)}`;
        findings.push({
        findingId: computeFindingId({
          axiom: AXIOM,
          ruleId: RULE_DUPLICATE,
          file: dup.file,
          enclosingSymbol: discriminator,
        }),
        axiom: AXIOM,
        ruleId: RULE_DUPLICATE,
        location: { file: dup.file, startLine: dup.line, endLine: dup.line },
        message: `duplicate code: function body structurally identical to ${original.file}:${original.line} (identifiers/literals normalized) — extract the shared implementation`,
        tier: "deterministic",
        source: "ast",
        confidence: 1,
        severity: "warning",
        enclosingSymbol: discriminator,
        });
      }
    }
  }
  return findings;
}

// ---- cleanliness/unused-export (warning) -----------------------------------

interface ExportedSymbol {
  name: string;
  line: number;
}

/** Syntactic export inventory of one changed file. `export default` → the
 * name "default"; `export { a as b }` exports `b`; a named re-export
 * (`export { x } from "./m"`) is an export of THIS file too, and
 * `export * as ns from "./m"` declares the named export `ns` here. Bare
 * `export * from` re-exports are nameless pass-throughs — not inventoried.
 * Names are DEDUPED, first occurrence winning: overloads, interface merging,
 * or `export const x` + `export { x }` declare one export, never several
 * findings with one findingId. */
function exportedSymbols(sf: SourceFile): ExportedSymbol[] {
  const symbols: ExportedSymbol[] = [];
  for (const statement of sf.getStatements()) {
    if (Node.isExportAssignment(statement)) {
      // `export default expr` (isExportEquals `export =` also binds the
      // whole module — track both as "default").
      symbols.push({ name: "default", line: statement.getStartLineNumber() });
      continue;
    }
    if (Node.isExportDeclaration(statement)) {
      const namespaceExport = statement.getNamespaceExport();
      if (namespaceExport !== undefined) {
        symbols.push({
          name: namespaceExport.getName(),
          line: statement.getStartLineNumber(),
        });
      }
      for (const named of statement.getNamedExports()) {
        symbols.push({
          name: named.getAliasNode()?.getText() ?? named.getName(),
          line: named.getStartLineNumber(),
        });
      }
      continue;
    }
    if (!Node.isExportable(statement) || !statement.hasExportKeyword()) continue;
    const line = statement.getStartLineNumber();
    if (statement.hasDefaultKeyword()) {
      symbols.push({ name: "default", line });
      continue;
    }
    if (Node.isVariableStatement(statement)) {
      for (const decl of statement.getDeclarations()) {
        const nameNode = decl.getNameNode();
        // Destructured export patterns are skipped — binding-name extraction
        // is not worth the surface for a pattern this rare in exports.
        if (Node.isIdentifier(nameNode)) {
          symbols.push({ name: nameNode.getText(), line: decl.getStartLineNumber() });
        }
      }
      continue;
    }
    const name = (statement as unknown as { getName?: () => string | undefined }).getName?.();
    if (name !== undefined) symbols.push({ name, line });
  }
  const seen = new Set<string>();
  return symbols.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
}

/** One pre-pass over ALL merged edges: per case-folded target file, the
 * union of names its names-bearing importers bind. Side-effect-only edges
 * (`import "./setup.js"`, `names: []`) bind nothing and are recorded
 * nowhere — they never make a target's exports checkable. Self-edges are
 * skipped (a file's own re-export of itself is not an importer). */
function buildUsageIndex(
  edges: readonly { from: string; to: string; names: readonly string[] }[],
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.names.length === 0) continue;
    const to = foldCase(edge.to);
    if (foldCase(edge.from) === to) continue;
    let names = index.get(to);
    if (names === undefined) {
      names = new Set();
      index.set(to, names);
    }
    for (const name of edge.names) names.add(name);
  }
  return index;
}

function unusedExportFindings(
  file: string,
  sf: SourceFile,
  usedNames: ReadonlySet<string> | undefined,
): Finding[] {
  // ZERO names-bearing importers → the file is indistinguishable from an
  // entry point: EXEMPT entirely (the rules doc states this ceiling; a
  // side-effect-only `import "./x.js"` importer binds nothing and does not
  // lift it). A `*` importer (namespace import / export-star / dynamic
  // import) uses ALL exports.
  if (usedNames === undefined || usedNames.has("*")) return [];
  const findings: Finding[] = [];
  for (const symbol of exportedSymbols(sf)) {
    if (usedNames.has(symbol.name)) continue;
    findings.push({
      findingId: computeFindingId({
        axiom: AXIOM,
        ruleId: RULE_UNUSED,
        file,
        enclosingSymbol: symbol.name,
      }),
      axiom: AXIOM,
      ruleId: RULE_UNUSED,
      location: { file, startLine: symbol.line, endLine: symbol.line },
      message: `unused export: no file in the analyzed project imports \`${symbol.name}\` by name — remove the export or the symbol`,
      tier: "deterministic",
      source: "ast",
      confidence: 1,
      severity: "warning",
      enclosingSymbol: symbol.name,
    });
  }
  return findings;
}

// ---- shared naming ---------------------------------------------------------

/** Best-effort stable name for a function-like: declaration name, class
 * member name prefixed by its class, or the variable/property a function
 * expression or arrow is assigned to. Undefined → genuinely anonymous. */
function functionSymbolName(fn: Node): string | undefined {
  if (Node.isFunctionDeclaration(fn)) return fn.getName();
  if (
    Node.isMethodDeclaration(fn) ||
    Node.isGetAccessorDeclaration(fn) ||
    Node.isSetAccessorDeclaration(fn) ||
    Node.isConstructorDeclaration(fn)
  ) {
    const cls = fn.getFirstAncestor(
      (a) => Node.isClassDeclaration(a) || Node.isClassExpression(a),
    ) as { getName?: () => string | undefined } | undefined;
    const member = Node.isConstructorDeclaration(fn) ? "constructor" : fn.getName();
    const clsName = cls?.getName?.();
    return clsName === undefined ? member : `${clsName}.${member}`;
  }
  // Arrow / function expression: named by what it is assigned to.
  const parent = fn.getParent();
  if (parent !== undefined) {
    if (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent)) {
      return parent.getName();
    }
    if (Node.isPropertyDeclaration(parent)) {
      const cls = parent.getFirstAncestor(
        (a) => Node.isClassDeclaration(a) || Node.isClassExpression(a),
      ) as { getName?: () => string | undefined } | undefined;
      const clsName = cls?.getName?.();
      return clsName === undefined ? parent.getName() : `${clsName}.${parent.getName()}`;
    }
    if (Node.isFunctionExpression(fn) && fn.getName() !== undefined) return fn.getName();
  }
  return undefined;
}

/** Enclosing symbol for a statement container: the nearest function-like
 * ancestor's name (anonymous → its kind name — line-free), or "(top-level)".
 * Exported for the axiom-4 NFR analyzer (1.11) — one naming implementation. */
export function enclosingSymbolName(node: Node): string {
  let cursor: Node | undefined = Node.isSourceFile(node) ? undefined : node;
  while (cursor !== undefined) {
    if (FUNCTION_LIKE_KINDS.has(cursor.getKind())) {
      return functionSymbolName(cursor) ?? cursor.getKindName();
    }
    cursor = cursor.getParent();
  }
  return "(top-level)";
}
