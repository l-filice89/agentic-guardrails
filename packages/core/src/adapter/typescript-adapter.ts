/**
 * ts-morph-backed LanguageAdapter (ADR-004). Module resolution comes from
 * the TypeScript compiler itself (tsconfig `paths`, barrels, re-exports),
 * never from hand-rolled path joining. Analyzed code is parsed as data —
 * nothing here executes or imports it.
 */
import { builtinModules } from "node:module";
import path from "node:path";

import type { Degradation } from "@agentic-guardrails/contracts";
import {
  Node,
  Project,
  SyntaxKind,
  ts,
  type ExportDeclaration,
  type ImportDeclaration,
  type SourceFile,
} from "ts-morph";

import { ImportGraph, normalizePath } from "../graph/import-graph.js";
import type {
  BuildImportGraphOptions,
  ImportGraphBuildResult,
  ImportGraphEdge,
  ImportGraphNode,
  LanguageAdapter,
  UnresolvedImport,
} from "./language-adapter.js";

interface EdgeFlags {
  dynamic: boolean;
  typeOnly: boolean;
  reExport: boolean;
}

const STATIC: EdgeFlags = { dynamic: false, typeOnly: false, reExport: false };

/** Test against the tsconfig `paths` patterns: an unresolved specifier
 * matching one is a broken ALIAS (actionable finding material), not a bare
 * external package. Prefix AND suffix around the `*` must match (with a
 * length guard so overlapping pre/suf never match a short specifier). A bare
 * `"*"` catch-all matches EVERY bare specifier and is therefore no alias
 * signal at all — skipped, or every typo'd package would fire the
 * unresolved-import rule. */
function matchesPathsAlias(specifier: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const star = pattern.indexOf("*");
    if (star === -1) return specifier === pattern;
    const pre = pattern.slice(0, star);
    const suf = pattern.slice(star + 1);
    if (pre === "" && suf === "") return false; // bare "*" catch-all
    return (
      specifier.length >= pre.length + suf.length &&
      specifier.startsWith(pre) &&
      specifier.endsWith(suf)
    );
  });
}

/** Node builtins never resolve to a source file — they are verified
 * externals, not unresolved imports (a `node:fs` import is not coverage loss). */
const NODE_BUILTINS = new Set(builtinModules);
function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:") || NODE_BUILTINS.has(specifier);
}

const CODE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".mts",
  ".node",
  ".ts",
  ".tsx",
]);

/** Relative imports handled by a bundler/plugin rather than TypeScript
 * (styles, images, `?raw`, and similar) are valid external edges. They must
 * not become blocking unresolved-code findings. */
function isBundlerAssetSpecifier(specifier: string, queryTargetResolved: boolean): boolean {
  const marker = specifier.search(/[?#]/);
  const pathname = marker === -1 ? specifier : specifier.slice(0, marker);
  const extension = path.extname(pathname).toLowerCase();
  // Asset extensions may be relative, absolute, bare package subpaths, or
  // tsconfig aliases. Query/hash imports are external only when the target
  // beneath the suffix resolves; `./missing.ts?x` remains an unresolved edge.
  return (extension !== "" && !CODE_EXTENSIONS.has(extension)) ||
    (marker !== -1 && queryTargetResolved);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0; // code-point order, locale-independent
}

export class TypeScriptAdapter implements LanguageAdapter {
  buildImportGraph(options: BuildImportGraphOptions): ImportGraphBuildResult {
    const tsConfigFilePath = path.resolve(options.tsconfigPath);
    const rootDir = path.resolve(options.rootDir ?? path.dirname(tsConfigFilePath));

    const toRel = (absolute: string): string =>
      normalizePath(path.relative(rootDir, absolute));

    let project: Project;
    let ownFiles: SourceFile[];
    try {
      project = new Project({
        tsConfigFilePath,
        skipAddingFilesFromTsConfig: false,
      });
      // Only the analyzed project's own files are walked; resolved
      // node_modules files are recorded as external nodes, never traversed.
      ownFiles = project
        .getSourceFiles()
        .filter((sf) => {
          const p = normalizePath(sf.getFilePath());
          return !p.includes("/node_modules/") && !toRel(p).startsWith("..");
        })
        // Deterministic file order ⇒ deterministic degraded-entry order.
        .sort((a, b) => (a.getFilePath() < b.getFilePath() ? -1 : 1));
    } catch (error) {
      // A broken/missing tsconfig is a degradation, never a throw.
      const message = error instanceof Error ? error.message : String(error);
      return {
        data: new ImportGraph([], []),
        coverage: 0,
        attempted: 0,
        unresolved: 0,
        unresolvedImports: [],
        degraded: [
          {
            reason: `tsconfig load failed: ${message}`,
            subject: normalizePath(tsConfigFilePath),
          },
        ],
      };
    }

    if (ownFiles.length === 0 && project.getSourceFiles().length > 0) {
      // The project loaded files, but none live under rootDir — a rootDir
      // mismatch would otherwise silently produce an empty graph.
      return {
        data: new ImportGraph([], []),
        coverage: 0,
        attempted: 0,
        unresolved: 0,
        unresolvedImports: [],
        degraded: [
          {
            reason: "no project source files under rootDir",
            subject: normalizePath(rootDir),
          },
        ],
      };
    }

    const nodes: ImportGraphNode[] = ownFiles.map((sf) => ({
      file: toRel(sf.getFilePath()),
      external: false,
    }));
    const edges: ImportGraphEdge[] = [];
    // Degradations deduped by reason+subject; coverage counted over UNIQUE
    // (from, specifier) attempts so duplicate identical imports don't
    // double-count.
    const degradedByKey = new Map<string, Degradation>();
    const attempts = new Set<string>();
    const unresolved = new Set<string>();
    // (from, specifier) → smallest failing import line, for the
    // structural/unresolved-import finding surface.
    const unresolvedByKey = new Map<string, UnresolvedImport>();
    const pathsPatterns = Object.keys(project.getCompilerOptions().paths ?? {});

    const degrade = (reason: string, subject: string): void => {
      degradedByKey.set(JSON.stringify([reason, subject]), { reason, subject });
    };
    const attempt = (from: string, specifier: string, resolved: boolean): void => {
      const key = JSON.stringify([from, specifier]);
      attempts.add(key);
      if (!resolved) unresolved.add(key);
    };
    const recordUnresolvedImport = (
      from: string,
      specifier: string,
      line: number,
      typeOnly: boolean,
    ): void => {
      const key = JSON.stringify([from, specifier]);
      const existing = unresolvedByKey.get(key);
      if (existing === undefined || line < existing.line) {
        unresolvedByKey.set(key, { from, specifier, line, typeOnly });
      }
    };

    const record = (
      from: string,
      specifier: string,
      resolvedAbsolutePath: string | undefined,
      flags: EdgeFlags,
      line: number,
      names: string[],
    ): void => {
      if (resolvedAbsolutePath === undefined && isNodeBuiltin(specifier)) {
        attempt(from, specifier, true);
        nodes.push({ file: specifier, external: true });
        edges.push({ from, to: specifier, ...flags, line, names });
        return;
      }
      const marker = specifier.search(/[?#]/);
      const sourceFile = project.getSourceFile(path.resolve(rootDir, from));
      const queryTargetResolved =
        marker !== -1 &&
        sourceFile !== undefined &&
        resolveWithCompiler(project, sourceFile, specifier.slice(0, marker)) !== undefined;
      if (isBundlerAssetSpecifier(specifier, queryTargetResolved)) {
        attempt(from, specifier, true);
        nodes.push({ file: specifier, external: true });
        edges.push({ from, to: specifier, ...flags, line, names });
        return;
      }
      if (resolvedAbsolutePath !== undefined) {
        const rel = toRel(resolvedAbsolutePath);
        if (rel.includes("node_modules/")) {
          // Resolved into node_modules: a verified external package.
          attempt(from, specifier, true);
          nodes.push({ file: specifier, external: true });
          edges.push({ from, to: specifier, ...flags, line, names });
          return;
        }
        if (path.isAbsolute(rel) || rel.startsWith("..")) {
          // Cross-drive (path.relative returns an absolute path) or above
          // the project root: external with the raw specifier + degraded.
          attempt(from, specifier, true);
          nodes.push({ file: specifier, external: true });
          edges.push({ from, to: specifier, ...flags, line, names });
          degrade("resolved outside project root", `${from} -> ${specifier}`);
          return;
        }
        attempt(from, specifier, true);
        edges.push({ from, to: rel, ...flags, line, names });
        return;
      }
      attempt(from, specifier, false);
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        // A relative path the compiler could not resolve: typed degradation,
        // no edge, no throw — plus the actionable unresolved-import record.
        degrade("unresolvable import specifier", `${from} -> ${specifier}`);
        recordUnresolvedImport(from, specifier, line, flags.typeOnly);
        return;
      }
      // Bare specifier with no resolution (typo/uninstalled): still recorded
      // as an external node/edge, but flagged degraded and unresolved. A
      // specifier matching a tsconfig `paths` pattern is a broken ALIAS —
      // that one also gets the unresolved-import record.
      nodes.push({ file: specifier, external: true });
      edges.push({ from, to: specifier, ...flags, line, names });
      degrade("unresolved bare specifier", `${from} -> ${specifier}`);
      if (matchesPathsAlias(specifier, pathsPatterns)) {
        recordUnresolvedImport(from, specifier, line, flags.typeOnly);
      }
    };

    for (const sf of ownFiles) {
      const from = toRel(sf.getFilePath());

      for (const decl of sf.getImportDeclarations()) {
        record(
          from,
          decl.getModuleSpecifierValue(),
          decl.getModuleSpecifierSourceFile()?.getFilePath(),
          { dynamic: false, typeOnly: isTypeOnlyImport(decl), reExport: false },
          decl.getStartLineNumber(),
          importedNames(decl),
        );
      }

      for (const decl of sf.getExportDeclarations()) {
        const specifier = decl.getModuleSpecifierValue();
        if (specifier === undefined) continue; // `export { x }` — no edge
        record(
          from,
          specifier,
          decl.getModuleSpecifierSourceFile()?.getFilePath(),
          { dynamic: false, typeOnly: isTypeOnlyExport(decl), reExport: true },
          decl.getStartLineNumber(),
          // `export * from` / `export * as ns from` re-export the WHOLE
          // target namespace; named re-exports carry the TARGET-module names.
          decl.getNamedExports().length === 0
            ? ["*"]
            : decl.getNamedExports().map((n) => n.getName()),
        );
      }

      // `import x = require("...")` resolves like a static import.
      for (const decl of sf.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)) {
        const ref = decl.getModuleReference();
        if (!ref.isKind(SyntaxKind.ExternalModuleReference)) continue;
        const expr = ref.getExpression();
        if (expr === undefined || !expr.isKind(SyntaxKind.StringLiteral)) continue;
        const specifier = expr.getLiteralValue();
        record(
          from,
          specifier,
          resolveWithCompiler(project, sf, specifier),
          STATIC,
          decl.getStartLineNumber(),
          ["*"], // `import x = require(...)` binds the whole namespace
        );
      }

      // `import(...)` and `require(...)` call expressions: literal argument
      // resolves via the compiler; non-literal degrades — never an edge.
      for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = call.getExpression();
        const isDynamicImport = callee.getKind() === SyntaxKind.ImportKeyword;
        const isRequire =
          Node.isIdentifier(callee) &&
          callee.getText() === "require" &&
          !isProjectBinding(callee, rootDir);
        if (!isDynamicImport && !isRequire) continue;
        const arg = call.getArguments()[0];
        const specifier = literalSpecifier(arg);
        if (specifier !== undefined) {
          record(
            from,
            specifier,
            resolveWithCompiler(project, sf, specifier),
            { dynamic: isDynamicImport, typeOnly: false, reExport: false },
            call.getStartLineNumber(),
            ["*"], // the whole module namespace is reachable from the call
          );
          continue;
        }
        // Non-literal specifier (variable/template/conditional): the target
        // is unknowable statically — degraded, counted unresolved, no edge.
        const reason = isDynamicImport
          ? "non-literal dynamic import specifier"
          : "non-literal require specifier";
        attempt(from, `<${reason}>`, false);
        degrade(reason, from);
      }
    }

    const graph = new ImportGraph(nodes, edges);
    const coverage =
      attempts.size === 0 ? 1 : (attempts.size - unresolved.size) / attempts.size;
    return {
      data: graph,
      coverage,
      attempted: attempts.size,
      unresolved: unresolved.size,
      unresolvedImports: [...unresolvedByKey.values()].sort(
        (a, b) => compareStrings(a.from, b.from) || compareStrings(a.specifier, b.specifier),
      ),
      degraded: [...degradedByKey.values()],
    };
  }
}

function literalSpecifier(node: Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }
  if (Node.isParenthesizedExpression(node)) return literalSpecifier(node.getExpression());
  return undefined;
}

/** A same-project declaration named `require` is application code, not the
 * CommonJS loader. Node's ambient declaration lives under node_modules and
 * remains eligible. */
function isProjectBinding(identifier: Node, rootDir: string): boolean {
  const declarations = identifier.getSymbol()?.getDeclarations() ?? [];
  return declarations.some((declaration) => {
    const relative = normalizePath(path.relative(rootDir, declaration.getSourceFile().getFilePath()));
    return (
      relative !== "" &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative) &&
      relative !== "node_modules" &&
      !relative.startsWith("node_modules/")
    );
  });
}

/**
 * `typeOnly` when the declaration itself is `import type`, or when every
 * binding is an inline `type` named import (and there is no default or
 * namespace binding that would still be a value edge).
 */
function isTypeOnlyImport(decl: ImportDeclaration): boolean {
  if (decl.isTypeOnly()) return true;
  const named = decl.getNamedImports();
  return (
    named.length > 0 &&
    named.every((n) => n.isTypeOnly()) &&
    decl.getDefaultImport() === undefined &&
    decl.getNamespaceImport() === undefined
  );
}

/** Binding names an import declaration takes from its target: `"default"`
 * for a default import, `"*"` for a namespace import, target-module names
 * for named bindings (`import { a as b }` records `a`; type-only included —
 * type usage counts as usage). A bare side-effect import records `[]`. */
function importedNames(decl: ImportDeclaration): string[] {
  const names: string[] = [];
  if (decl.getDefaultImport() !== undefined) names.push("default");
  if (decl.getNamespaceImport() !== undefined) names.push("*");
  for (const named of decl.getNamedImports()) names.push(named.getName());
  return names;
}

/** Same inline-modifier logic for `export { type X } from "..."`. */
function isTypeOnlyExport(decl: ExportDeclaration): boolean {
  if (decl.isTypeOnly()) return true;
  const named = decl.getNamedExports();
  return named.length > 0 && named.every((n) => n.isTypeOnly());
}

/** Compiler-backed resolution for dynamic imports (same `paths` handling
 * as static imports). */
function resolveWithCompiler(
  project: Project,
  sf: SourceFile,
  specifier: string,
): string | undefined {
  const result = ts.resolveModuleName(
    specifier,
    sf.getFilePath(),
    project.getCompilerOptions(),
    project.getModuleResolutionHost(),
  );
  return result.resolvedModule?.resolvedFileName;
}
