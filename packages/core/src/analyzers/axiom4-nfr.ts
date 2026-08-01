/**
 * Axiom #4 (NFR) — the deterministic structural-tier rule set (Story 1.11),
 * all inside the ONE registered axiom-4 analyzer:
 *
 * - `nfr/unbounded-promise-all`   warning  `Promise.all/allSettled/any/race`
 *                                          (incl. `globalThis.Promise` and
 *                                          `Promise["all"]` forms) whose
 *                                          array argument is dynamically
 *                                          sized (anything except an array
 *                                          literal of recursively fixed
 *                                          arity)
 * - `nfr/sync-io-in-async`        warning  a `*Sync` member of an imported
 *                                          `fs`/`child_process`/`zlib`/
 *                                          `crypto` binding (bare or
 *                                          `node:`-prefixed; named/renamed/
 *                                          namespace/default forms) called
 *                                          where the NEAREST enclosing
 *                                          function-like is `async`
 * - `nfr/missing-abort-signal`    warning  a global `fetch(...)` call whose
 *                                          options argument provably lacks a
 *                                          signal: absent, `undefined`,
 *                                          `null`, or an object literal
 *                                          without a `signal` property (and
 *                                          without a spread) — incl. a
 *                                          literal `signal: undefined`
 *
 * FALSE-POSITIVE GUARD: `fetch`/`Promise` callees are checked against their
 * BINDING, not their spelling — an identifier whose symbol has ANY
 * declaration in the changed file itself (parameter, local, function,
 * import — anything but the ambient global) is skipped; sync-IO calls must
 * resolve to the tracked import binding's symbol, so an inner-scope shadow
 * never flags.
 *
 * ALL severities are warning by design: the structural tier flags hazard
 * PATTERNS — it cannot prove runtime context ("over I/O", "request path"),
 * so it never blocks on its own (the gate counts errors only). Epic 3's LLM
 * tier is where confidence rises.
 *
 * Changed-files-only parse via the shared pass (`changed-files.ts`, one
 * parse per run across axiom 3 + axiom 4) — NO graph, NO graphCache: every
 * rule is decidable from one file's own syntax.
 */
import {
  computeFindingId,
  type Finding,
} from "@agentic-guardrails/contracts";
import {
  Node,
  SyntaxKind,
  type CallExpression,
  type SourceFile,
  type Symbol as MorphSymbol,
} from "ts-morph";

import type { Analyzer, AnalyzerContext, AnalyzerResult } from "../pipeline/pipeline.js";
import { isGlobalRef, memberAccess } from "./ast-helpers.js";
import { enclosingSymbolName, FUNCTION_LIKE_KINDS } from "./axiom3-cleanliness.js";
import { compare, parseChangedFiles } from "./changed-files.js";

const AXIOM = "4";
const RULE_PROMISE_ALL = "nfr/unbounded-promise-all";
const RULE_SYNC_IO = "nfr/sync-io-in-async";
const RULE_ABORT = "nfr/missing-abort-signal";

export const axiom4Nfr: Analyzer = {
  axiom: AXIOM,
  // Async by contract (Analyzer.run); the body is CPU-bound today.
  async run(context: AnalyzerContext): Promise<AnalyzerResult> {
    if (context.changedFiles.length === 0) {
      return { findings: [], degraded: [] };
    }
    // Shared parse-only pass — changed-set-sized, never project-sized;
    // acquired through the pipeline's run-local seam (one parse per run).
    const parse =
      context.changedFilesCache?.acquire(() => parseChangedFiles(context)) ??
      parseChangedFiles(context);

    const findings: Finding[] = [];
    for (const [file, sf] of parse.parsed) {
      findings.push(...fileFindings(file, sf));
    }

    findings.sort(
      (a, b) =>
        compare(a.location.file, b.location.file) ||
        a.location.startLine - b.location.startLine ||
        compare(a.ruleId, b.ruleId) ||
        compare(a.enclosingSymbol ?? "", b.enclosingSymbol ?? ""),
    );
    return { findings, degraded: [...parse.degraded] };
  },
};

// ---- sync-IO import tracking (nfr/sync-io-in-async substrate) --------------

/** Tracked blocking-IO modules (bare or `node:`-prefixed) → the async
 * alternative the finding message suggests. */
const SYNC_IO_MODULES = new Map<string, string>([
  ["fs", "the `node:fs/promises` equivalent"],
  ["child_process", "the async `exec`/`execFile`/`spawn` form"],
  ["zlib", "the callback or promisified async form"],
  ["crypto", "the callback or promisified async form"],
]);

interface SyncIoBinding {
  member: string;
  module: string;
}

interface SyncIoBindings {
  /** Local symbol of a NAMED `*Sync` import → the real member + module
   * (renamed imports: `import { readFileSync as r }` maps r's symbol). */
  named: Map<MorphSymbol, SyncIoBinding>;
  /** Local symbols bound to a whole tracked module: namespace
   * (`import * as fs`), default (`import fs from`), and
   * `import { default as fs }` forms — any `.xSync` member access on them
   * is a sync call. */
  objects: Map<MorphSymbol, string>;
}

/** Import inventory, SYMBOL-keyed: a call flags only when its callee/base
 * resolves to the tracked import binding itself — an inner-scope local
 * shadowing the import name never matches. Ceilings (structural tier):
 * `require()` bindings, re-assignments of the module object, and
 * destructuring from a namespace (`const { readFileSync } = fs`) are not
 * tracked; type-only imports are erased at runtime and skipped. */
function collectSyncIoBindings(sf: SourceFile): SyncIoBindings {
  const bindings: SyncIoBindings = { named: new Map(), objects: new Map() };
  const addObject = (id: Node | undefined, module: string): void => {
    const symbol = id?.getSymbol();
    if (symbol !== undefined) bindings.objects.set(symbol, module);
  };
  for (const decl of sf.getImportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    const module = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
    if (!SYNC_IO_MODULES.has(module) || decl.isTypeOnly()) continue;
    addObject(decl.getNamespaceImport(), module);
    addObject(decl.getDefaultImport(), module);
    for (const named of decl.getNamedImports()) {
      if (named.isTypeOnly()) continue;
      const member = named.getName();
      const local = named.getAliasNode() ?? named.getNameNode();
      if (member === "default") {
        addObject(local, module);
        continue;
      }
      if (!member.endsWith("Sync")) continue;
      const symbol = local.getSymbol();
      if (symbol !== undefined) bindings.named.set(symbol, { member, module });
    }
  }
  return bindings;
}

/** The `*Sync` binding a call invokes, or undefined when the call does not
 * resolve to a tracked import. Covers `r(...)` (named/renamed import) and
 * `fs.readFileSync(...)` / `fs["readFileSync"](...)` (module-object member
 * access). */
function syncIoMember(call: CallExpression, bindings: SyncIoBindings): SyncIoBinding | undefined {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) {
    const symbol = callee.getSymbol();
    return symbol === undefined ? undefined : bindings.named.get(symbol);
  }
  const access = memberAccess(callee);
  if (access !== undefined && Node.isIdentifier(access.target) && access.member.endsWith("Sync")) {
    const symbol = access.target.getSymbol();
    const module = symbol === undefined ? undefined : bindings.objects.get(symbol);
    if (module !== undefined) return { member: access.member, module };
  }
  return undefined;
}

// ---- enclosure -------------------------------------------------------------

/** Nearest function-like ancestor (excluding the node itself when it is
 * one), or undefined at module top level. Class field initializers and
 * static blocks STOP the walk: they run at construction/class-definition
 * time, not in any enclosing async frame. */
function nearestFunctionLike(node: Node): Node | undefined {
  for (let cursor = node.getParent(); cursor !== undefined; cursor = cursor.getParent()) {
    const kind = cursor.getKind();
    if (FUNCTION_LIKE_KINDS.has(kind)) return cursor;
    if (kind === SyntaxKind.PropertyDeclaration || kind === SyntaxKind.ClassStaticBlockDeclaration) {
      return undefined;
    }
  }
  return undefined;
}

/** Async-ness of the NEAREST enclosing function-like: a sync arrow nested
 * inside an async function runs synchronously when invoked, so only the
 * innermost enclosure decides (the require-await lint semantics). Module
 * top level is never async — the config-load idiom stays exempt. */
function inAsyncEnclosure(node: Node): boolean {
  const fn = nearestFunctionLike(node);
  return fn !== undefined && Node.isAsyncable(fn) && fn.isAsync();
}

// ---- rule predicates -------------------------------------------------------

/** Start-everything Promise combinators: each starts EVERY member of its
 * iterable at once. */
const PROMISE_FAN_OUT_METHODS = new Set(["all", "allSettled", "any", "race"]);

/** `Promise.all/allSettled/any/race` call (incl. `globalThis.Promise` and
 * bracket-access forms, binding-checked) → the method name, else undefined. */
function promiseFanOutMethod(call: CallExpression): string | undefined {
  const access = memberAccess(call.getExpression());
  if (access === undefined || !PROMISE_FAN_OUT_METHODS.has(access.member)) return undefined;
  return isGlobalRef(access.target, "Promise") ? access.member : undefined;
}

/** Fixed-arity array literal, recursively: every spread's operand must
 * itself be a fixed-arity array literal (`[...[a, b]]` and `[...[...[c]]]`
 * are fixed; a spread of an identifier or call is not). */
function isFixedArity(node: Node): boolean {
  if (!Node.isArrayLiteralExpression(node)) return false;
  return node
    .getElements()
    .every((el) => !Node.isSpreadElement(el) || isFixedArity(el.getExpression()));
}

/** Dynamically sized array argument: anything except a recursively
 * fixed-arity array literal. A missing argument is not a fan-out at all. */
function isDynamicallySized(arg: Node | undefined): boolean {
  return arg !== undefined && !isFixedArity(arg);
}

/** fetch options argument that PROVABLY lacks cancellation: absent, the
 * literal `undefined` or `null`, or an object literal with no `signal`
 * property and no spread — a literal `signal: undefined` is syntactically
 * visible absence and still flags. A computed literal name (`["signal"]: s`)
 * resolves as a signal. Non-literal options and spread-carrying literals
 * are NOT flagged — the structural tier cannot see inside them (stated
 * ceiling). */
function fetchLacksSignal(call: CallExpression): boolean {
  const options = call.getArguments()[1];
  if (options === undefined) return true;
  if (Node.isIdentifier(options) && options.getText() === "undefined") return true;
  if (options.getKind() === SyntaxKind.NullKeyword) return true;
  if (!Node.isObjectLiteralExpression(options)) return false;
  // Object properties apply left-to-right. Walk backwards so the first
  // signal/spread encountered is the value that can determine the final
  // `signal` property (`{ ...opts, signal: undefined }` provably lacks one;
  // `{ signal: undefined, ...opts }` remains unknown).
  for (const prop of [...options.getProperties()].reverse()) {
    if (Node.isSpreadAssignment(prop)) return false; // a later spread may supply/override it
    if (Node.isShorthandPropertyAssignment(prop) && prop.getName() === "signal") return false;
    if (Node.isGetAccessorDeclaration(prop) && prop.getName() === "signal") return false;
    if (Node.isPropertyAssignment(prop)) {
      const nameNode = prop.getNameNode();
      let name: string | undefined;
      if (Node.isComputedPropertyName(nameNode)) {
        const expr = nameNode.getExpression();
        name = Node.isStringLiteral(expr) ? expr.getLiteralValue() : undefined;
      } else {
        name = prop.getName();
      }
      if (name === "signal") {
        const init = prop.getInitializer();
        // `signal: undefined` is provable absence, not a signal.
        return init !== undefined && Node.isIdentifier(init) && init.getText() === "undefined";
      }
    }
  }
  return true;
}

// ---- per-file pass ---------------------------------------------------------

function fileFindings(file: string, sf: SourceFile): Finding[] {
  const findings: Finding[] = [];
  const bindings = collectSyncIoBindings(sf);
  // Per-file per-rule ordinal counters, keyed by (enclosing symbol, base):
  // the counter advances for EVERY candidate call in source order, violating
  // or not (the 1.10 `name#N` convention, line-free). Honest churn scope:
  // ids survive LINE shifts (comments, unrelated edits), but inserting or
  // removing a candidate call EARLIER in the same (symbol, base) sequence
  // shifts every later ordinal — those findingIds churn.
  const ordinals = new Map<string, number>();
  const nextOrdinal = (base: string): number => {
    const n = ordinals.get(base) ?? 0;
    ordinals.set(base, n + 1);
    return n;
  };
  const emit = (ruleId: string, node: Node, discriminator: string, message: string): void => {
    const line = node.getStartLineNumber();
    findings.push({
      findingId: computeFindingId({
        axiom: AXIOM,
        ruleId,
        file,
        enclosingSymbol: discriminator,
      }),
      axiom: AXIOM,
      ruleId,
      location: { file, startLine: line, endLine: line },
      message,
      tier: "deterministic",
      source: "ast",
      confidence: 1,
      severity: "warning",
      enclosingSymbol: discriminator,
    });
  };

  sf.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const enclosing = enclosingSymbolName(node);

    const method = promiseFanOutMethod(node);
    if (method !== undefined) {
      // The method name joins the counter key: all/allSettled/any/race
      // count separately.
      const ordinal = nextOrdinal(`${enclosing}#promise-${method}`);
      if (isDynamicallySized(node.getArguments()[0])) {
        emit(
          RULE_PROMISE_ALL,
          node,
          `${enclosing}#promise-${method}-${ordinal}`,
          `unbounded concurrency: \`Promise.${method}\` over a dynamically sized array starts every operation at once — bound the fan-out (p-map-style, with a concurrency limit)`,
        );
      }
      return;
    }

    const syncIo = syncIoMember(node, bindings);
    if (syncIo !== undefined) {
      const ordinal = nextOrdinal(`${enclosing}#${syncIo.member}`);
      if (inAsyncEnclosure(node)) {
        emit(
          RULE_SYNC_IO,
          node,
          `${enclosing}#${syncIo.member}-${ordinal}`,
          `sync I/O in async flow: \`${syncIo.member}\` blocks the event loop inside an async function — use ${SYNC_IO_MODULES.get(syncIo.module)!}`,
        );
      }
      return;
    }

    if (isGlobalRef(node.getExpression(), "fetch")) {
      const ordinal = nextOrdinal(`${enclosing}#fetch`);
      if (fetchLacksSignal(node)) {
        emit(
          RULE_ABORT,
          node,
          `${enclosing}#fetch-${ordinal}`,
          "missing cancellation: `fetch` call without an AbortSignal — pass `{ signal }` (e.g. `AbortSignal.timeout(ms)`) so the request can be cancelled",
        );
      }
    }
  });
  return findings;
}
