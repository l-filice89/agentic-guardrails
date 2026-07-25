/**
 * Axiom #5 (security) — the deterministic rule set (Story 1.12), all inside
 * the ONE registered axiom-5 analyzer. Every axiom defaults to blocking
 * (EFFECTIVE_DEFAULTS); axiom 5's distinction is that FR-32 names it and
 * its rules are error-dense, so the severity doctrine is load-bearing (the
 * 1.10 lesson — a false positive in a blocking rule gates legitimate code):
 *
 * - `security/hardcoded-secret`       regex   ERROR for pinned near-certain
 *                                             token formats (AWS `AKIA`/`ASIA`
 *                                             ids, GitHub `gh?_` and
 *                                             `github_pat_` tokens, Slack
 *                                             `xox?-` tokens, OpenAI/Anthropic
 *                                             `sk-` keys, private-key PEM
 *                                             headers); WARNING for the
 *                                             heuristic secret-named-
 *                                             assignment shape
 * - `security/injection-sink`         ast     warning  `query`/`execute`
 *                                             member calls and imported
 *                                             `child_process` `exec`/
 *                                             `execSync` whose argument is a
 *                                             template WITH interpolation or
 *                                             non-constant string
 *                                             concatenation (static strings —
 *                                             including literal+literal
 *                                             concatenation — never flag)
 * - `security/dangerous-api`          ast     error  `eval` (incl. indirect
 *                                             `(0, eval)` forms), the
 *                                             `Function` constructor (bare or
 *                                             `new`, incl. `globalThis.`) with
 *                                             a string BODY (last argument),
 *                                             `setTimeout`/`setInterval` with
 *                                             a string/concatenated first
 *                                             argument, `vm` module
 *                                             `runIn*`/`compileFunction`/
 *                                             `new vm.Script`
 * - `security/unsafe-deserialization` ast     error  `unserialize` from a
 *                                             `node-serialize`-family import
 *                                             (known RCE vector); warning
 *                                             `v8.deserialize` (legitimate
 *                                             for trusted IPC)
 *
 * The REGEX rule reads raw file text directly — never through the AST — and
 * iterates ALL changed files (`allChangedFiles`: .env, .json, .yaml, .md,
 * Dockerfiles, declarations …), not just the analyzable-TS subset, so a
 * secret in any changed file is caught. Files over the 1 MiB size cap are
 * skipped with a typed declared degradation; non-UTF8 bytes are tolerated
 * (the regexes run over whatever utf8 decoding yields). The AST rules keep
 * the TS-filtered list and ride the shared changed-files parse
 * (`changed-files.ts`, one parse per run across axioms 3/4/5) with the 1.11
 * shadowing-immune machinery: import-binding SYMBOL resolution and
 * `hasLocalDeclaration` checks for globals — a local `eval` wrapper or
 * shadowed import never flags.
 *
 * PARSED AS DATA: target code is read and parsed, never executed or
 * dynamically required (the sentinel hazard test pins this).
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  computeFindingId,
  type Degradation,
  type Finding,
} from "@agentic-guardrails/contracts";
import {
  Node,
  SyntaxKind,
  type SourceFile,
  type Symbol as MorphSymbol,
} from "ts-morph";

import type { Analyzer, AnalyzerContext, AnalyzerResult } from "../pipeline/pipeline.js";
import { isGlobalRef, memberAccess } from "./ast-helpers.js";
import { enclosingSymbolName } from "./axiom3-cleanliness.js";
import { compare, firstLine, parseChangedFiles } from "./changed-files.js";

const AXIOM = "5";
const RULE_SECRET = "security/hardcoded-secret";
const RULE_INJECTION = "security/injection-sink";
const RULE_DANGEROUS = "security/dangerous-api";
const RULE_DESERIALIZE = "security/unsafe-deserialization";

/** Secret-scan file size cap (documented ceiling): a changed file larger
 * than this is skipped with a typed declared degradation — a multi-megabyte
 * artifact is not source code, and unbounded reads are their own hazard. */
export const SECRET_SCAN_MAX_BYTES = 1024 * 1024; // 1 MiB

export const axiom5Security: Analyzer = {
  axiom: AXIOM,
  // Async by contract (Analyzer.run); the body is CPU-bound today.
  async run(context: AnalyzerContext): Promise<AnalyzerResult> {
    // The regex tier scans ALL changed files; the AST tier the TS subset.
    const allFiles = [...new Set(context.allChangedFiles ?? context.changedFiles)].sort();
    if (allFiles.length === 0 && context.changedFiles.length === 0) {
      return { findings: [], degraded: [] };
    }
    // Shared parse-only pass for the AST rules (one parse per run across
    // axioms 3/4/5, via the pipeline's run-local seam).
    const parse =
      context.changedFilesCache?.acquire(() => parseChangedFiles(context)) ??
      parseChangedFiles(context);
    const degraded: Degradation[] = [...parse.degraded];
    const declaredSubjects = new Set(parse.degraded.map((d) => d.subject));

    const findings: Finding[] = [];
    // REGEX tier: raw text, deliberately NOT the AST — it runs for every
    // changed file the disk can serve, parseable or not, TS or not.
    for (const file of allFiles) {
      if (context.signal?.aborted) {
        // Budget cut the scan off: remaining files are declared coverage
        // loss, never silently unscanned (mirrors the parse pass).
        degraded.push({
          reason: "phase budget aborted the secret scan before this file was scanned",
          subject: file,
        });
        continue;
      }
      let text: string;
      try {
        if (statSync(path.join(context.repoRoot, file)).size > SECRET_SCAN_MAX_BYTES) {
          degraded.push({
            reason: "changed file exceeds the 1 MiB secret-scan size cap — skipped",
            subject: file,
          });
          continue;
        }
        // utf8 with replacement: binary/non-UTF8 garbage is tolerated — the
        // regexes run over whatever decodes.
        text = readFileSync(path.join(context.repoRoot, file), "utf8");
      } catch (error) {
        // The shared parse pass reads the same (TS) file and already declared
        // its read failure — one degradation per unreadable file, not one per
        // consuming tier.
        if (!declaredSubjects.has(file)) {
          const message = error instanceof Error ? error.message : String(error);
          degraded.push({
            reason: `changed file could not be read: ${firstLine(message)}`,
            subject: file,
          });
        }
        continue;
      }
      findings.push(...secretFindings(file, text));
    }

    for (const [file, sf] of parse.parsed) {
      findings.push(...astFindings(file, sf));
    }

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

// ---- security/hardcoded-secret (regex over raw text) -----------------------

/** ERROR-tier token formats — pinned, documented shapes with no legitimate
 * spelling in source. These fire EVERYWHERE, including `.test.`/`__fixtures__`
 * paths: a real AWS key in a test file is still a leak.
 * Order matters for `sk-` keys: `anthropic-api-key` is listed before
 * `openai-api-key`, and the OpenAI pattern excludes `sk-ant-` so an
 * Anthropic key fires exactly one pattern under its own name. */
const SECRET_TOKEN_PATTERNS: readonly { name: string; label: string; regex: RegExp }[] = [
  {
    // AKIA = long-lived access key id, ASIA = temporary (STS) access key id.
    name: "aws-access-key-id",
    label: "AWS access key id",
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  { name: "github-token", label: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  {
    name: "github-fine-grained-pat",
    label: "GitHub fine-grained PAT",
    regex: /\bgithub_pat_[A-Za-z0-9_]{22,}/g,
  },
  {
    // xoxb/xoxa/xoxp/xoxr/xoxs plus xoxe refresh tokens.
    name: "slack-token",
    label: "Slack token",
    regex: /\bxox[baprse]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    name: "anthropic-api-key",
    label: "Anthropic API key",
    regex: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,}/g,
  },
  {
    // Boundary + ≥20-char tail so prose "sk-" spellings never fire; the
    // `(?!ant-)` exclusion keeps Anthropic keys under their own name above.
    name: "openai-api-key",
    label: "OpenAI API key",
    regex: /(?<![A-Za-z0-9_-])sk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  },
  {
    name: "private-key-pem",
    label: "private key PEM header",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
];

/** Vendor-PUBLISHED sample credentials — fake by definition (they appear on
 * the vendors' own documentation pages) and exactly what shows up in docs
 * and tests, so they never fire the error tier. Pinned, documented list —
 * only values a vendor itself publishes belong here. */
const PUBLISHED_SAMPLE_CREDENTIALS = new Set([
  // AWS's documented sample access key ids (long-lived + temporary).
  "AKIAIOSFODNN7EXAMPLE",
  "ASIAIOSFODNN7EXAMPLE",
  // GitHub's documented sample classic PAT (docs.github.com).
  "ghp_16C7e42F292c6912E7710c838347Ae178B4a",
]);

/** WARNING-tier heuristic: a ≥16-char quoted literal assigned or compared
 * (`:`/`=`/`==`/`===`/`!=`/`!==` — the hardcoded-credential-comparison
 * backdoor spelling) to a secret-named identifier/property. Whole-text scan
 * (`\s*` spans newlines) so a prettier-wrapped `const apiKey =\n "…"` still
 * matches; per-delimiter value classes so an apostrophe or backtick INSIDE a
 * differently-quoted value never severs the ≥16 floor. The identifier is
 * captured whole and its word-parts tested (`isSecretName`) — `tokenizer`,
 * `secretary`, `passwordHintText` never match. Heuristic by nature (the
 * name is a proxy, not proof), hence warning — it must never gate alone. */
const SECRET_ASSIGNMENT =
  /(?<![A-Za-z0-9_$-])([A-Za-z_$][A-Za-z0-9_$-]*)["']?\s*(?:===|!==|==|!=|[:=])\s*(?:"([^"\r\n]{16,})"|'([^'\r\n]{16,})'|`([^`\r\n]{16,})`)/g;

/** Secret-meaning FINAL word-parts of an identifier. The keyword must be the
 * identifier's last part (`apiToken`, `DB_PASSWORD`) — an interior or
 * partial occurrence (`tokenizerConfig`, `passwordHintText`,
 * `maxTokensLabel`, `secretaryName`) is not a secret name. */
const SECRET_NAME_PARTS = new Set([
  "secret",
  "token",
  "password",
  "passwd",
  "credential",
  "credentials",
  "apikey",
]);

function isSecretName(identifier: string): boolean {
  const parts = identifier
    .split(/[_-]/)
    .flatMap((segment) => segment.split(/(?=[A-Z])/))
    .map((part) => part.toLowerCase())
    .filter((part) => part.length > 0);
  const last = parts.at(-1);
  if (last === undefined) return false;
  if (SECRET_NAME_PARTS.has(last)) return true;
  return last === "key" && parts.at(-2) === "api";
}

/** Obvious placeholders — exempt from the WARNING pattern only. Word
 * alternates are anchored to the value START ("exampleXk9…" is a
 * placeholder; "my-example-key-123" is not); `your[-_]` stays a substring
 * (the "<your-token-here>" idiom), `<…>` whole-value, `xxx…` leading. */
const PLACEHOLDER_VALUE = /^(?:changeme|example|dummy|todo|test)|your[-_]|^<.*>$|^x{3,}/i;

/** Test-path exemption — WARNING pattern only. Basename-anchored `.test.`/
 * `.spec.` plus `__fixtures__`/`__tests__` path SEGMENTS: an interior
 * `.test.` in a production path (`src/x.test.helpers/prod.ts`) does not
 * exempt. */
function isTestPath(file: string): boolean {
  return (
    /(^|\/)[^/]+\.(test|spec)\.[^/]+$/.test(file) ||
    /(^|\/)(__fixtures__|__tests__)(\/|$)/.test(file)
  );
}

/** Start offsets of each line; lone `\r`, `\n`, and `\r\n` all terminate. */
function lineStartOffsets(text: string): number[] {
  const starts = [0];
  const re = /\r\n|\r|\n/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    starts.push(m.index + m[0].length);
  }
  return starts;
}

/** 1-based line of a character offset (binary search over line starts). */
function lineOf(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

function secretFindings(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  // Per-file per-pattern ordinals (line-free discriminators, the 1.10
  // convention): the counter advances for every candidate match in source
  // order, exempt or not.
  const ordinals = new Map<string, number>();
  const nextOrdinal = (base: string): number => {
    const n = ordinals.get(base) ?? 0;
    ordinals.set(base, n + 1);
    return n;
  };
  const emit = (name: string, line: number, severity: "error" | "warning", message: string): void => {
    const discriminator = `${name}-${nextOrdinal(name)}`;
    findings.push({
      findingId: computeFindingId({
        axiom: AXIOM,
        ruleId: RULE_SECRET,
        file,
        enclosingSymbol: discriminator,
      }),
      axiom: AXIOM,
      ruleId: RULE_SECRET,
      location: { file, startLine: line, endLine: line },
      message,
      tier: "deterministic",
      source: "regex",
      confidence: 1,
      severity,
      enclosingSymbol: discriminator,
    });
  };

  const starts = lineStartOffsets(text);
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    for (const pattern of SECRET_TOKEN_PATTERNS) {
      for (const match of line.matchAll(pattern.regex)) {
        // Published vendor samples are non-secrets: the counter still
        // advances (candidate in source order), nothing is emitted.
        if (PUBLISHED_SAMPLE_CREDENTIALS.has(match[0])) {
          nextOrdinal(pattern.name);
          continue;
        }
        // The matched value is NEVER echoed into the finding message — the
        // review artifact must not become a second copy of the secret.
        emit(
          pattern.name,
          i + 1,
          "error",
          `hardcoded secret: ${pattern.label} in source — remove it, rotate the credential, and load it from the environment or a secret store`,
        );
      }
    }
  }

  if (isTestPath(file)) return findings; // path exemption: WARNING tier only
  // Whole-text scan (not per-line) so a wrapped assignment still matches;
  // the finding anchors at the line where the match STARTS.
  for (const match of text.matchAll(SECRET_ASSIGNMENT)) {
    if (!isSecretName(match[1]!)) continue;
    const value = (match[2] ?? match[3] ?? match[4])!;
    const ordinal = nextOrdinal("secret-assignment");
    // Env-reference templates (`${process.env.X}` / `${import.meta.env.X}`)
    // and obvious placeholders are the legitimate spellings of this shape —
    // exempt, counter still advanced. Stated ceiling: the exemption keys on
    // SUBSTRING presence, so an env-prefix + hardcoded-suffix template
    // (`${process.env.PREFIX}-hardcodedsecret`) stays exempt.
    if (
      value.includes("process.env") ||
      value.includes("import.meta.env") ||
      PLACEHOLDER_VALUE.test(value)
    ) {
      continue;
    }
    const discriminator = `secret-assignment-${ordinal}`;
    findings.push({
      findingId: computeFindingId({
        axiom: AXIOM,
        ruleId: RULE_SECRET,
        file,
        enclosingSymbol: discriminator,
      }),
      axiom: AXIOM,
      ruleId: RULE_SECRET,
      location: { file, startLine: lineOf(starts, match.index), endLine: lineOf(starts, match.index) },
      message:
        "possible hardcoded secret: a long string literal assigned to a secret-named identifier — load it from the environment or a secret store",
      tier: "deterministic",
      source: "regex",
      confidence: 1,
      severity: "warning",
      enclosingSymbol: discriminator,
    });
  }
  return findings;
}

// ---- AST substrate: symbol-resolved import bindings ------------------------

/** Modules whose unserialize is a known RCE vector on untrusted input —
 * pinned list, no external pattern database (stated ceiling). */
const NODE_SERIALIZE_MODULES = new Set(["node-serialize", "serialize-to-js"]);

/** Modules the AST rules track by import binding. */
const TRACKED_MODULES = new Set(["child_process", "vm", "v8", ...NODE_SERIALIZE_MODULES]);

interface ModuleBindings {
  /** Local symbol of a NAMED import → its real member + module (renamed
   * imports map the alias's symbol; `unserialize as u` still resolves). */
  named: Map<MorphSymbol, { module: string; member: string }>;
  /** Local symbols bound to a whole tracked module (namespace, default,
   * `{ default as x }` forms) — member access on them resolves the member. */
  objects: Map<MorphSymbol, string>;
}

/** Import inventory, SYMBOL-keyed (the 1.11 shadowing-immune machinery): a
 * call flags only when it resolves to the tracked import binding itself.
 * Ceilings: `require()` bindings, re-assigned module objects, and
 * destructuring from a namespace are not tracked; type-only imports are
 * erased at runtime and skipped. */
function collectModuleBindings(sf: SourceFile): ModuleBindings {
  const bindings: ModuleBindings = { named: new Map(), objects: new Map() };
  const addObject = (id: Node | undefined, module: string): void => {
    const symbol = id?.getSymbol();
    if (symbol !== undefined) bindings.objects.set(symbol, module);
  };
  for (const decl of sf.getImportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    const module = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
    if (!TRACKED_MODULES.has(module) || decl.isTypeOnly()) continue;
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
      const symbol = local.getSymbol();
      if (symbol !== undefined) bindings.named.set(symbol, { module, member });
    }
  }
  return bindings;
}

/** The tracked-module member a callee expression invokes (`u(...)` named
 * import, `cp.exec(...)` / `cp["exec"](...)` module-object access, and the
 * same forms behind `new`), or undefined. */
function resolveModuleMember(
  callee: Node,
  bindings: ModuleBindings,
): { module: string; member: string } | undefined {
  if (Node.isIdentifier(callee)) {
    const symbol = callee.getSymbol();
    return symbol === undefined ? undefined : bindings.named.get(symbol);
  }
  const access = memberAccess(callee);
  if (access !== undefined && Node.isIdentifier(access.target)) {
    const symbol = access.target.getSymbol();
    const module = symbol === undefined ? undefined : bindings.objects.get(symbol);
    if (module !== undefined) return { module, member: access.member };
  }
  return undefined;
}

// ---- AST rule predicates ---------------------------------------------------

/** Strip parentheses and comma-sequence wrappers from a callee: the classic
 * indirect-eval spellings `(eval)(code)` and `(0, eval)(code)` still resolve
 * to the ambient global. */
function unwrapCallee(node: Node): Node {
  if (Node.isParenthesizedExpression(node)) return unwrapCallee(node.getExpression());
  if (
    Node.isBinaryExpression(node) &&
    node.getOperatorToken().getKind() === SyntaxKind.CommaToken
  ) {
    return unwrapCallee(node.getRight());
  }
  return node;
}

/** Syntactic string: a string literal or (any) template literal. */
function isSyntacticString(node: Node | undefined): boolean {
  return (
    node !== undefined &&
    (Node.isStringLiteral(node) ||
      Node.isNoSubstitutionTemplateLiteral(node) ||
      Node.isTemplateExpression(node))
  );
}

/** STATIC string: constant-foldable to a fixed value — a plain/no-sub
 * literal, parens around one, or a `+` tree whose operands are ALL static
 * strings recursively (`"SELECT * " + "FROM users"`). */
function isStaticString(node: Node): boolean {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return true;
  if (Node.isParenthesizedExpression(node)) return isStaticString(node.getExpression());
  if (
    Node.isBinaryExpression(node) &&
    node.getOperatorToken().getKind() === SyntaxKind.PlusToken
  ) {
    return isStaticString(node.getLeft()) && isStaticString(node.getRight());
  }
  return false;
}

/** Does this expression tree contain a string-literal/template operand? */
function containsStringOperand(node: Node): boolean {
  if (isSyntacticString(node)) return true;
  if (Node.isParenthesizedExpression(node)) return containsStringOperand(node.getExpression());
  if (
    Node.isBinaryExpression(node) &&
    node.getOperatorToken().getKind() === SyntaxKind.PlusToken
  ) {
    return containsStringOperand(node.getLeft()) || containsStringOperand(node.getRight());
  }
  return false;
}

/** A DYNAMICALLY BUILT string: a template literal WITH interpolation, or a
 * `+` concatenation that contains a string operand AND is not constant-
 * foldable (all-literal concatenation is static). A static string (plain
 * literal, no-substitution template, literal+literal concat) is NEVER
 * dynamic — parameterized queries and fixed commands stay silent. */
function isDynamicString(node: Node | undefined): boolean {
  if (node === undefined) return false;
  if (Node.isTemplateExpression(node)) return true;
  if (Node.isParenthesizedExpression(node)) return isDynamicString(node.getExpression());
  if (
    Node.isBinaryExpression(node) &&
    node.getOperatorToken().getKind() === SyntaxKind.PlusToken
  ) {
    return containsStringOperand(node) && !isStaticString(node);
  }
  return false;
}

/** The Function-constructor body rule: only the LAST argument is the body
 * (`new Function("x", body)`'s literal "x" is a PARAMETER NAME, not code) —
 * it must be a syntactically visible or dynamically built string. */
function stringyBodyArg(args: readonly Node[]): boolean {
  const body = args.at(-1);
  return isSyntacticString(body) || isDynamicString(body);
}

/** SQL-ish sink member names for the heuristic (receiver unknowable) tier. */
const SINK_MEMBERS = new Set(["query", "execute"]);

/** `vm` members that execute strings as code. */
function isVmCodeMember(member: string): boolean {
  return member.startsWith("runIn") || member === "compileFunction";
}

// ---- per-file AST pass -----------------------------------------------------

function astFindings(file: string, sf: SourceFile): Finding[] {
  const findings: Finding[] = [];
  const bindings = collectModuleBindings(sf);
  // Per-file per-rule ordinal counters keyed (enclosing symbol, base) — the
  // counter advances for EVERY candidate in source order, violating or not
  // (line-free ids; same honest churn scope as axioms 3/4).
  const ordinals = new Map<string, number>();
  const nextOrdinal = (base: string): number => {
    const n = ordinals.get(base) ?? 0;
    ordinals.set(base, n + 1);
    return n;
  };
  const emit = (
    ruleId: string,
    node: Node,
    discriminator: string,
    severity: "error" | "warning",
    message: string,
  ): void => {
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
      severity,
      enclosingSymbol: discriminator,
    });
  };

  sf.forEachDescendant((node) => {
    // `new Function(...)` (incl. `new globalThis.Function`) with a string
    // BODY — the eval family — and `new vm.Script(code)`, which compiles
    // strings to code exactly like `runIn*`. `new Function(bodyVar)` is not
    // statically provable as a string and stays out (stated ceiling; error
    // tier must be near-certain).
    if (Node.isNewExpression(node)) {
      const callee = unwrapCallee(node.getExpression());
      if (isGlobalRef(callee, "Function")) {
        const enclosing = enclosingSymbolName(node);
        const ordinal = nextOrdinal(`${enclosing}#new-Function`);
        if (stringyBodyArg(node.getArguments())) {
          emit(
            RULE_DANGEROUS,
            node,
            `${enclosing}#new-Function-${ordinal}`,
            "error",
            "dangerous API: `new Function` compiles strings into code — no legitimate application-code idiom; restructure to avoid dynamic code generation",
          );
        }
        return;
      }
      const resolved = resolveModuleMember(callee, bindings);
      if (resolved !== undefined && resolved.module === "vm" && resolved.member === "Script") {
        const enclosing = enclosingSymbolName(node);
        const ordinal = nextOrdinal(`${enclosing}#vm-Script`);
        emit(
          RULE_DANGEROUS,
          node,
          `${enclosing}#vm-Script-${ordinal}`,
          "error",
          "dangerous API: `new vm.Script` compiles strings into code — no legitimate application-code idiom; restructure to avoid dynamic code execution",
        );
      }
      return;
    }
    if (!Node.isCallExpression(node)) return;
    const enclosing = enclosingSymbolName(node);
    const callee = unwrapCallee(node.getExpression());
    const firstArg = node.getArguments()[0];

    const resolved = resolveModuleMember(callee, bindings);
    if (resolved !== undefined) {
      const { module, member } = resolved;
      if (module === "child_process" && (member === "exec" || member === "execSync")) {
        const ordinal = nextOrdinal(`${enclosing}#${member}`);
        if (isDynamicString(firstArg)) {
          emit(
            RULE_INJECTION,
            node,
            `${enclosing}#${member}-${ordinal}`,
            "warning",
            `possible command injection: \`${member}\` receives a dynamically built command string — pass a fixed command with an argument array (execFile/spawn)`,
          );
        }
        return;
      }
      if (module === "vm" && isVmCodeMember(member)) {
        const ordinal = nextOrdinal(`${enclosing}#vm-${member}`);
        emit(
          RULE_DANGEROUS,
          node,
          `${enclosing}#vm-${member}-${ordinal}`,
          "error",
          `dangerous API: \`vm.${member}\` executes strings as code — no legitimate application-code idiom; restructure to avoid dynamic code execution`,
        );
        return;
      }
      if (NODE_SERIALIZE_MODULES.has(module) && member === "unserialize") {
        const ordinal = nextOrdinal(`${enclosing}#unserialize`);
        emit(
          RULE_DESERIALIZE,
          node,
          `${enclosing}#unserialize-${ordinal}`,
          "error",
          `unsafe deserialization: \`unserialize\` from \`${module}\` executes attacker-controlled payloads (known RCE vector) — use \`JSON.parse\``,
        );
        return;
      }
      if (module === "v8" && member === "deserialize") {
        const ordinal = nextOrdinal(`${enclosing}#v8-deserialize`);
        emit(
          RULE_DESERIALIZE,
          node,
          `${enclosing}#v8-deserialize-${ordinal}`,
          "warning",
          "hazardous deserialization: `v8.deserialize` is safe only for trusted IPC payloads — never feed it untrusted input",
        );
        return;
      }
    }

    // eval family — ambient-global checked (a local `eval` wrapper, a DI
    // parameter, or an import shadowing the name never flags). The callee is
    // unwrapped above, so indirect `(0, eval)(code)` / `(eval)(code)` flag.
    if (isGlobalRef(callee, "eval")) {
      const ordinal = nextOrdinal(`${enclosing}#eval`);
      emit(
        RULE_DANGEROUS,
        node,
        `${enclosing}#eval-${ordinal}`,
        "error",
        "dangerous API: `eval` executes strings as code — no legitimate application-code idiom; restructure to avoid dynamic code execution",
      );
      return;
    }
    // Bare `Function("code")` — spec-identical to `new Function("code")`.
    if (isGlobalRef(callee, "Function")) {
      const ordinal = nextOrdinal(`${enclosing}#Function`);
      if (stringyBodyArg(node.getArguments())) {
        emit(
          RULE_DANGEROUS,
          node,
          `${enclosing}#Function-${ordinal}`,
          "error",
          "dangerous API: `Function` compiles strings into code — no legitimate application-code idiom; restructure to avoid dynamic code generation",
        );
      }
      return;
    }
    for (const timer of ["setTimeout", "setInterval"] as const) {
      if (isGlobalRef(callee, timer)) {
        const ordinal = nextOrdinal(`${enclosing}#${timer}`);
        if (isSyntacticString(firstArg) || isDynamicString(firstArg)) {
          emit(
            RULE_DANGEROUS,
            node,
            `${enclosing}#${timer}-${ordinal}`,
            "error",
            `dangerous API: \`${timer}\` with a string argument is implied \`eval\` — pass a function instead`,
          );
        }
        return;
      }
    }

    // Heuristic sink tier: `anything.query(...)` / `.execute(...)` with a
    // dynamically built string. The receiver is unknowable statically, so
    // this is warning-tier by doctrine (it MIGHT be attacker-influenced).
    const access = memberAccess(callee);
    if (access !== undefined && SINK_MEMBERS.has(access.member)) {
      const ordinal = nextOrdinal(`${enclosing}#${access.member}`);
      if (isDynamicString(firstArg)) {
        emit(
          RULE_INJECTION,
          node,
          `${enclosing}#${access.member}-${ordinal}`,
          "warning",
          `possible injection: \`${access.member}\` receives a dynamically built string (interpolation/concatenation) — use a parameterized query with bound arguments`,
        );
      }
    }
  });
  return findings;
}
