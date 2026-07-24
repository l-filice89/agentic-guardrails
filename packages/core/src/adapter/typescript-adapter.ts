/**
 * ts-morph-backed LanguageAdapter (ADR-004). Module resolution comes from
 * the TypeScript compiler itself (tsconfig `paths`, barrels, re-exports),
 * never from hand-rolled path joining. Analyzed code is parsed as data —
 * nothing here executes or imports it.
 */
import path from "node:path";

import type { Degradation } from "@agentic-guardrails/contracts";
import {
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
  ImportGraphEdge,
  ImportGraphNode,
  LanguageAdapter,
  PartialResultOf,
} from "./language-adapter.js";

interface EdgeFlags {
  dynamic: boolean;
  typeOnly: boolean;
  reExport: boolean;
}

const STATIC: EdgeFlags = { dynamic: false, typeOnly: false, reExport: false };

export class TypeScriptAdapter implements LanguageAdapter {
  buildImportGraph(options: BuildImportGraphOptions): PartialResultOf<ImportGraph> {
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

    const degrade = (reason: string, subject: string): void => {
      degradedByKey.set(JSON.stringify([reason, subject]), { reason, subject });
    };
    const attempt = (from: string, specifier: string, resolved: boolean): void => {
      const key = JSON.stringify([from, specifier]);
      attempts.add(key);
      if (!resolved) unresolved.add(key);
    };

    const record = (
      from: string,
      specifier: string,
      resolvedAbsolutePath: string | undefined,
      flags: EdgeFlags,
    ): void => {
      if (resolvedAbsolutePath !== undefined) {
        const rel = toRel(resolvedAbsolutePath);
        if (rel.includes("node_modules/")) {
          // Resolved into node_modules: a verified external package.
          attempt(from, specifier, true);
          nodes.push({ file: specifier, external: true });
          edges.push({ from, to: specifier, ...flags });
          return;
        }
        if (path.isAbsolute(rel) || rel.startsWith("..")) {
          // Cross-drive (path.relative returns an absolute path) or above
          // the project root: external with the raw specifier + degraded.
          attempt(from, specifier, true);
          nodes.push({ file: specifier, external: true });
          edges.push({ from, to: specifier, ...flags });
          degrade("resolved outside project root", `${from} -> ${specifier}`);
          return;
        }
        attempt(from, specifier, true);
        edges.push({ from, to: rel, ...flags });
        return;
      }
      attempt(from, specifier, false);
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        // A relative path the compiler could not resolve: typed degradation,
        // no edge, no throw.
        degrade("unresolvable import specifier", `${from} -> ${specifier}`);
        return;
      }
      // Bare specifier with no resolution (typo/uninstalled): still recorded
      // as an external node/edge, but flagged degraded and unresolved.
      nodes.push({ file: specifier, external: true });
      edges.push({ from, to: specifier, ...flags });
      degrade("unresolved bare specifier", `${from} -> ${specifier}`);
    };

    for (const sf of ownFiles) {
      const from = toRel(sf.getFilePath());

      for (const decl of sf.getImportDeclarations()) {
        record(
          from,
          decl.getModuleSpecifierValue(),
          decl.getModuleSpecifierSourceFile()?.getFilePath(),
          { dynamic: false, typeOnly: isTypeOnlyImport(decl), reExport: false },
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
        );
      }

      // `import x = require("...")` resolves like a static import.
      for (const decl of sf.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)) {
        const ref = decl.getModuleReference();
        if (!ref.isKind(SyntaxKind.ExternalModuleReference)) continue;
        const expr = ref.getExpression();
        if (expr === undefined || !expr.isKind(SyntaxKind.StringLiteral)) continue;
        const specifier = expr.getLiteralValue();
        record(from, specifier, resolveWithCompiler(project, sf, specifier), STATIC);
      }

      // `import(...)` and `require(...)` call expressions: literal argument
      // resolves via the compiler; non-literal degrades — never an edge.
      for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = call.getExpression();
        const isDynamicImport = callee.getKind() === SyntaxKind.ImportKeyword;
        const isRequire =
          callee.getKind() === SyntaxKind.Identifier && callee.getText() === "require";
        if (!isDynamicImport && !isRequire) continue;
        const arg = call.getArguments()[0];
        if (arg !== undefined && arg.isKind(SyntaxKind.StringLiteral)) {
          const specifier = arg.getLiteralValue();
          record(from, specifier, resolveWithCompiler(project, sf, specifier), {
            dynamic: isDynamicImport,
            typeOnly: false,
            reExport: false,
          });
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
    return { data: graph, coverage, degraded: [...degradedByKey.values()] };
  }
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
