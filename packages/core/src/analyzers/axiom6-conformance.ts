/**
 * Axiom #6 (conformance) — the structural-tier rule set (Story 1.13), all
 * inside the ONE registered axiom-6 analyzer. This is the first consumer of
 * the Story-1.8 structural corpus seed: the persisted, Zod-validated
 * `_agentic-guardrails/.cache/corpus/structural-seed.json` is the CORPUS OF
 * RECORD — the analyzer never re-derives it.
 *
 * - `conformance/naming-convention` warning  a NEW path's basename stem uses
 *                                            a casing style that deviates
 *                                            from the confirmed dominant
 *                                            style of the nearest qualifying
 *                                            directory scope
 * - `conformance/file-placement`    warning  a NEW path's KIND (test / spec /
 *                                            declaration / config / source)
 *                                            predominantly lives in one
 *                                            sibling directory of the nearest
 *                                            qualifying scope, and this file
 *                                            sits elsewhere
 * - `conformance/module-shape`      warning  the corpus confirms a binding
 *                                            form (default vs named) among
 *                                            imported modules in the nearest
 *                                            qualifying scope, and this
 *                                            file's importers bind the
 *                                            minority form
 *
 * FR-5 IS THE LOAD-BEARING INVARIANT: a convention fires ONLY when the
 * corpus confirms it — its scope must hold at least `MIN_SAMPLE` classifiable
 * corpus files AND the dominant variant must hold at least `DOMINANCE` of
 * them. Below either bar the analyzer says NOTHING. Every message cites the
 * evidence as measured counts.
 *
 * SELF-CONFIRMATION is closed by WHAT IS JUDGED, not by shrinking the corpus.
 * The seed is a snapshot taken BEFORE the diff (written by `guardrails
 * init`), so:
 * - a changed file whose path is ABSENT from the corpus is a genuinely new
 *   naming/placement decision: it is JUDGED, and it cannot vote (it is not in
 *   the corpus to begin with);
 * - a changed file whose path IS in the corpus had its name and location
 *   decided before this diff: it VOTES (its path is prior evidence) and is
 *   NOT judged by naming/placement.
 * Excluding changed files from the corpus instead — as the first cut did —
 * shrank the sample in proportion to diff size (four files touched in a
 * twelve-file directory silenced the whole scope) and re-flagged legacy
 * off-convention files on every unrelated edit.
 *
 * Externals (`external: true` seed entities) are npm specifiers, not repo
 * files: they never vote (a corpus of externals only is an empty corpus).
 *
 * ALL findings are `warning`: conformance is advisory by nature (the
 * 1.10/1.12 lesson — a false positive in a blocking rule gates legitimate
 * code, and "your file is named wrong" must never be that).
 *
 * INCONCLUSIVE, NEVER A FALSE PASS: an absent / unreadable / invalid / empty
 * seed yields zero findings plus ONE typed degradation whose reason begins
 * `no_corpus`. Only the ABSENT case (an un-inited repo) is returned in
 * `declaredOnly` — declared in the artifact, exit-neutral, exactly like 1.8's
 * "absent until init" ledger sentinels. Unreadable / unparseable /
 * schema-invalid / empty seeds are REAL degradations and drive exit 2 like
 * any other.
 */
import {
  computeFindingId,
  structuralSeedSchema,
  type Degradation,
  type Finding,
} from "@agentic-guardrails/contracts";

import { TypeScriptAdapter } from "../adapter/typescript-adapter.js";
import { readStructuralSeedFile } from "../knowledge/structural-seed.js";
import type { Analyzer, AnalyzerContext, AnalyzerResult } from "../pipeline/pipeline.js";
import { mergeGraphResults } from "./axiom1-structural.js";
import { foldCase } from "../util/fold-case.js";
import { compare } from "./changed-files.js";

const AXIOM = "6";
const RULE_NAMING = "conformance/naming-convention";
const RULE_PLACEMENT = "conformance/file-placement";
const RULE_SHAPE = "conformance/module-shape";

/**
 * FR-5 sample floor: a scope must hold at least this many CLASSIFIABLE corpus
 * files before its dominant variant counts as a convention at all. Ten is the
 * smallest sample where an 80% majority still leaves room for two dissenters
 * — below it, "the convention" is indistinguishable from whatever the first
 * few files happened to do. Not configurable this story (FR-5 is a contract,
 * not a preference).
 */
export const MIN_SAMPLE = 10;

/** FR-5 dominance floor as an exact integer ratio: the leading variant must
 * hold at least `DOMINANCE_NUM/DOMINANCE_DEN` of the sample. Compared with
 * integer multiplication (`best * DEN >= total * NUM`) so the contract
 * boundary never rests on an IEEE-754 rounding coincidence. */
const DOMINANCE_NUM = 8;
const DOMINANCE_DEN = 10;

/**
 * FR-5 dominance floor, as a ratio for documentation and messages. 0.8
 * tolerates a fifth of the corpus being legacy or deliberate exceptions while
 * still meaning "this repo has clearly decided" — at 0.5 a coin-flip split
 * would produce findings, which is style-policing, not conformance.
 */
export const DOMINANCE = DOMINANCE_NUM / DOMINANCE_DEN;

/** Every inconclusive-corpus degradation reason starts with this token. The
 * pipeline does NOT key on it (exit-neutrality is declared per-degradation
 * through `AnalyzerResult.declaredOnly`) — it is a message convention. */
export const NO_CORPUS_PREFIX = "no_corpus";

/** Subject of the corpus-seed degradations. */
const CORPUS_SUBJECT = "corpus-seed";

export const axiom6Conformance: Analyzer = {
  axiom: AXIOM,
  // Async by contract (Analyzer.run); the body is CPU-bound today.
  async run(context: AnalyzerContext): Promise<AnalyzerResult> {
    const changedList = [...new Set(context.changedFiles)].sort();
    // Nothing under review → nothing to judge, and no reason to read the
    // corpus at all (an absent seed is only interesting when there IS a diff).
    if (changedList.length === 0) return { findings: [], degraded: [] };

    const read = readCorpus(context);
    if (!read.ok) {
      return read.declaredOnly
        ? { findings: [], degraded: [], declaredOnly: [read.degradation] }
        : { findings: [], degraded: [read.degradation] };
    }

    const degraded: Degradation[] = [...read.degraded];
    // The seed carries the producer's partial-result envelope. A convention
    // "confirmed" from an admittedly partial census may be measuring the half
    // that parsed — say so, out loud, and continue.
    if (read.coverage < 1) {
      degraded.push({
        reason: `corpus partial: the structural seed covered ${(read.coverage * 100).toFixed(1)}% of its import attempts — conventions were measured on a partial census`,
        subject: CORPUS_SUBJECT,
      });
    }
    const corpus = read.entities.filter((e) => !e.external).map((e) => e.file);
    if (corpus.length === 0) {
      degraded.push({
        reason: `${NO_CORPUS_PREFIX}: corpus empty — no repo files remain after excluding externals`,
        subject: CORPUS_SUBJECT,
      });
      return { findings: [], degraded };
    }

    // Judged by naming/placement: only paths the corpus has never seen — a
    // genuinely new naming/placement decision (see the module header).
    const inCorpus = new Set(corpus.map(foldCase));
    const newPaths = changedList.filter((file) => !inCorpus.has(foldCase(file)));

    const findings: Finding[] = [];
    findings.push(...namingFindings(newPaths, corpus, context.signal));
    findings.push(...placementFindings(newPaths, corpus, context.signal));
    findings.push(...shapeFindings(context, changedList, corpus, degraded));

    findings.sort(
      (a, b) => compare(a.location.file, b.location.file) || compare(a.ruleId, b.ruleId),
    );
    return { findings, degraded };
  },
};

// ---- corpus of record ------------------------------------------------------

type CorpusRead =
  | {
      ok: true;
      entities: readonly { file: string; external: boolean }[];
      coverage: number;
      degraded: readonly Degradation[];
    }
  | { ok: false; degradation: Degradation; declaredOnly: boolean };

/**
 * Validates the seed the pipeline already read (`context.corpusSeed`),
 * falling back to reading it here for bare unit-test contexts. Every failure
 * mode is its OWN named `no_corpus` reason — inconclusive, never a crash and
 * never a false pass. Only ABSENCE is exit-neutral (`declaredOnly`).
 */
function readCorpus(context: AnalyzerContext): CorpusRead {
  const inconclusive = (reason: string, declaredOnly = false): CorpusRead => ({
    ok: false,
    degradation: { reason: `${NO_CORPUS_PREFIX}: ${reason}`, subject: CORPUS_SUBJECT },
    declaredOnly,
  });
  const seed = context.corpusSeed ?? readStructuralSeedFile(context.repoRoot);
  if (!seed.ok) return inconclusive(seed.message, seed.absent);

  let raw: unknown;
  try {
    raw = JSON.parse(seed.bytes.toString("utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return inconclusive(`seed invalid: not parseable JSON: ${firstLine(message)}`);
  }
  const parsed = structuralSeedSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined ? "(root)" : issue.path.map(String).join(".") || "(root)";
    return inconclusive(`seed invalid: ${where}: ${issue?.message ?? "unknown issue"}`);
  }
  if (parsed.data.entities.length === 0) {
    return inconclusive("corpus empty — the seed declares no entities");
  }
  return {
    ok: true,
    entities: parsed.data.entities,
    coverage: parsed.data.coverage,
    degraded: parsed.data.degraded,
  };
}

function firstLine(message: string): string {
  return message.split("\n")[0] ?? message;
}

// ---- the prevalence gate (FR-5) --------------------------------------------

export interface Prevalence<T extends string> {
  /** The dominant variant, or undefined when the gate did not confirm one. */
  variant?: T;
  /** How many sample members hold the dominant variant. */
  count: number;
  /** Total classifiable sample size. */
  total: number;
  /** `total >= MIN_SAMPLE` — the scope holds enough evidence to DECIDE at
   * all (confirmed or not). The scope walks route through this rather than
   * re-applying the floor themselves, so there is exactly ONE sample gate. */
  qualified: boolean;
}

/**
 * The ONE gate every rule routes through: `variant` is set only when the
 * sample reaches `MIN_SAMPLE` AND the leading variant reaches `DOMINANCE`.
 * `count`/`total` are always the measured truth so callers can cite evidence.
 * Ties break on code-point order — a tie can never reach 0.8 anyway, so this
 * only pins determinism.
 */
export function prevalence<T extends string>(votes: readonly T[]): Prevalence<T> {
  const tally = new Map<T, number>();
  for (const vote of votes) tally.set(vote, (tally.get(vote) ?? 0) + 1);
  let leader: T | undefined;
  let best = 0;
  for (const variant of [...tally.keys()].sort()) {
    const count = tally.get(variant)!;
    if (count > best) {
      best = count;
      leader = variant;
    }
  }
  const total = votes.length;
  const qualified = total >= MIN_SAMPLE;
  if (leader === undefined || !qualified || best * DOMINANCE_DEN < total * DOMINANCE_NUM) {
    return { count: best, total, qualified };
  }
  return { variant: leader, count: best, total, qualified };
}

// ---- shared path helpers ---------------------------------------------------

function basenameOf(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

function dirOf(file: string): string {
  const at = file.lastIndexOf("/");
  return at < 0 ? "" : file.slice(0, at);
}

/** `""` is the repo root and contains everything. */
function underScope(file: string, scope: string): boolean {
  return scope === "" || foldCase(file).startsWith(`${foldCase(scope)}/`);
}

function scopeLabel(scope: string): string {
  return scope === "" ? "the repo root" : scope;
}

/**
 * The nearest qualifying scope walk, shared by all three rules: from the
 * file's own directory up to the repo root, the FIRST scope whose sample
 * reaches `MIN_SAMPLE` decides — confirmed or not. A local convention is
 * never overruled by a repo-wide one, and a scope that qualifies but is not
 * dominant silences the rule rather than deferring to an ancestor.
 * `visit` returns a finding, or undefined for "this scope says nothing".
 */
function walkScopes<T extends string>(
  file: string,
  votesIn: (scope: string) => readonly T[],
  decide: (scope: string, gate: Prevalence<T>) => Finding | undefined,
): Finding | undefined {
  for (let scope = dirOf(file); ; scope = dirOf(scope)) {
    const gate = prevalence(votesIn(scope));
    if (gate.qualified) return decide(scope, gate);
    if (scope === "") return undefined; // walked past the repo root
  }
}

// ---- conformance/naming-convention -----------------------------------------

type NamingStyle = "kebab" | "snake" | "Pascal" | "camel";

const STYLE_LABEL: Record<NamingStyle, string> = {
  kebab: "kebab-case",
  snake: "snake_case",
  Pascal: "PascalCase",
  camel: "camelCase",
};

/** The name a casing style is read off: everything before the FIRST dot, so
 * kind suffixes and extensions (`.test.ts`, `.d.ts`, `.config.mts`) are
 * stripped in one step. A dotfile yields `""` → unclassifiable. */
function stemOf(file: string): string {
  const base = basenameOf(file);
  return base.slice(0, base.indexOf(".") < 0 ? base.length : base.indexOf("."));
}

/**
 * The casing style of a basename stem, or undefined when the stem carries NO
 * evidence: a single all-lowercase word (`index`, `utils`) is a valid spelling
 * in kebab, snake AND camel, so it neither votes nor gets judged. The mirror
 * image also carries no casing intent and is excluded for the same reason:
 * an all-caps stem with no lowercase at all (`README`, `LICENSE`, `HTTP`) and
 * a single letter are not "PascalCase decisions". Same for SCREAMING_CASE,
 * dotfiles, and anything mixed beyond these four shapes.
 */
export function namingStyle(stem: string): NamingStyle | undefined {
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(stem)) return "kebab";
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(stem)) return "snake";
  // Pascal requires a lowercase letter after the leading capital — that is
  // what distinguishes `MyThing` from `README`/`API`/`A`.
  if (/^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(stem)) return "Pascal";
  if (/^[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/.test(stem)) return "camel";
  return undefined;
}

function namingFindings(
  judged: readonly string[],
  corpus: readonly string[],
  signal: AbortSignal | undefined,
): Finding[] {
  const classified = corpus
    .map((file) => ({ file, style: namingStyle(stemOf(file)) }))
    .filter((entry): entry is { file: string; style: NamingStyle } => entry.style !== undefined);

  const findings: Finding[] = [];
  for (const file of judged) {
    if (signal?.aborted === true) break; // O(changed × depth × corpus): interruptible
    const stem = stemOf(file);
    const style = namingStyle(stem);
    if (style === undefined) continue;
    const found = walkScopes(
      file,
      (scope) => classified.filter((e) => underScope(e.file, scope)).map((e) => e.style),
      (scope, gate) =>
        gate.variant === undefined || gate.variant === style
          ? undefined
          : finding(
              RULE_NAMING,
              file,
              stem,
              `naming convention: basename "${stem}" is ${STYLE_LABEL[style]}, but the corpus confirms ${STYLE_LABEL[gate.variant]} in ${gate.count}/${gate.total} named files under ${scopeLabel(scope)} — rename to match`,
            ),
    );
    if (found !== undefined) findings.push(found);
  }
  return findings;
}

// ---- conformance/file-placement --------------------------------------------

/** `declaration` is CORPUS-ONLY: the pipeline's `isAnalyzableTs` excludes
 * `.d.ts` from the change set, so a declaration can vote but can never be
 * judged. Kept because it must not be miscounted as plain source. */
type FileKind = "declaration" | "test" | "spec" | "config" | "source";

const KIND_LABEL: Record<FileKind, string> = {
  declaration: "`.d.ts` declaration",
  test: "`.test.`",
  spec: "`.spec.`",
  config: "`.config.`",
  source: "plain source",
};

/** File KIND from the basename suffix. Declarations are tested first — a
 * `.d.ts` is a declaration even if something earlier in the name matches. */
export function fileKind(file: string): FileKind {
  const base = basenameOf(file);
  if (/\.d\.[cm]?ts$/.test(base)) return "declaration";
  if (/\.test\./.test(base)) return "test";
  if (/\.spec\./.test(base)) return "spec";
  if (/\.config\./.test(base)) return "config";
  return "source";
}

/** The bucket a file falls in RELATIVE to a scope: the first path segment
 * below the scope, or `""` when the file sits directly in it. Scope-relative
 * on purpose — the first segment of the whole path is `packages` for every
 * source file in a pnpm workspace, which makes the rule unable to fire. */
function bucketOf(file: string, scope: string): string {
  const rest = scope === "" ? file : file.slice(scope.length + 1);
  const at = rest.indexOf("/");
  return at < 0 ? "" : rest.slice(0, at);
}

/** Full path of a scope-relative bucket, for the message. */
function bucketLabel(scope: string, segment: string): string {
  const joined = segment === "" ? scope : scope === "" ? segment : `${scope}/${segment}`;
  return joined === "" ? "the repo root" : `${joined}/`;
}

function placementFindings(
  judged: readonly string[],
  corpus: readonly string[],
  signal: AbortSignal | undefined,
): Finding[] {
  const findings: Finding[] = [];
  for (const file of judged) {
    if (signal?.aborted === true) break;
    const kind = fileKind(file);
    const ofKind = corpus.filter((f) => fileKind(f) === kind);
    const found = walkScopes(
      file,
      (scope) => ofKind.filter((f) => underScope(f, scope)).map((f) => bucketOf(f, scope)),
      (scope, gate) => {
        const here = bucketOf(file, scope);
        return gate.variant === undefined || gate.variant === here
          ? undefined
          : finding(
              RULE_PLACEMENT,
              file,
              kind,
              `file placement: ${KIND_LABEL[kind]} files under ${scopeLabel(scope)} live in ${bucketLabel(scope, gate.variant)} in ${gate.count}/${gate.total} of the corpus, but this one sits in ${bucketLabel(scope, here)} — move it to match`,
            );
      },
    );
    if (found !== undefined) findings.push(found);
  }
  return findings;
}

// ---- conformance/module-shape ----------------------------------------------

type BindingForm = "default" | "named";

/**
 * Export shape inferred from what importers BIND (the 1.10 per-edge `names`),
 * not from parsing the target's exports — a stated approximation (Epic 4's
 * corpus map is where richer shape lands). Namespace (`*`) and bare
 * side-effect imports carry no shape evidence; a file bound BOTH ways, or not
 * imported at all, yields no evidence and is therefore neither judged nor
 * counted. Type-only edges DO count: `import type { X } from` is still a
 * named binding, and export shape is a compile-time property.
 *
 * Edges FROM a changed file are dropped: the diff must not manufacture the
 * evidence it is judged by (a new file importing a new file by default
 * binding would otherwise "prove" that new file is a default module).
 */
function shapeFindings(
  context: AnalyzerContext,
  changed: readonly string[],
  corpus: readonly string[],
  degraded: Degradation[],
): Finding[] {
  if (context.tsconfigPaths.length === 0) {
    // One of three advertised rules not running is never silent.
    degraded.push({
      reason: "module shape not evaluated — no tsconfig for the import graph",
      subject: RULE_SHAPE,
    });
    return [];
  }

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
  degraded.push(...graphResult.degraded);
  const graph = graphResult.data;

  const changedFolded = new Set(changed.map(foldCase));
  const internal = new Set(graph.nodes.filter((n) => !n.external).map((n) => foldCase(n.file)));
  const bound = new Map<string, { default: boolean; named: boolean }>();
  for (const edge of graph.edges) {
    if (changedFolded.has(foldCase(edge.from))) continue; // diff-manufactured evidence
    const to = foldCase(edge.to);
    if (!internal.has(to)) continue;
    const entry = bound.get(to) ?? { default: false, named: false };
    for (const name of edge.names) {
      if (name === "*") continue; // namespace import: no shape evidence
      if (name === "default") entry.default = true;
      else entry.named = true;
    }
    bound.set(to, entry);
  }
  const formOf = (file: string): BindingForm | undefined => {
    const entry = bound.get(foldCase(file));
    if (entry === undefined) return undefined;
    if (entry.default && !entry.named) return "default";
    if (entry.named && !entry.default) return "named";
    return undefined; // no unchanged importers, or bound both ways — ambiguous
  };

  const findings: Finding[] = [];
  for (const file of changed) {
    if (context.signal?.aborted === true) break;
    const form = formOf(file);
    if (form === undefined) continue;
    const found = walkScopes(
      file,
      (scope) =>
        corpus
          .filter((f) => underScope(f, scope))
          .map(formOf)
          .filter((f): f is BindingForm => f !== undefined),
      (scope, gate) =>
        gate.variant === undefined || gate.variant === form
          ? undefined
          : finding(
              RULE_SHAPE,
              file,
              undefined,
              `module shape: importers bind this module's ${form} export, but the corpus confirms ${gate.variant} bindings in ${gate.count}/${gate.total} imported modules under ${scopeLabel(scope)} (${gate.total - gate.count} of them use ${form}) — switch to a ${gate.variant} export to match`,
            ),
    );
    if (found !== undefined) findings.push(found);
  }
  return findings;
}

// ---- finding construction --------------------------------------------------

/** Whole-file conditions have no real import line: the SYNTHETIC line 1 is
 * the honest anchor (same convention as `structural/unassigned-file`). */
function finding(
  ruleId: string,
  file: string,
  discriminator: string | undefined,
  message: string,
): Finding {
  return {
    findingId: computeFindingId({
      axiom: AXIOM,
      ruleId,
      file,
      // File-level identity (module-shape) hashes the empty string — the
      // documented computeFindingId convention.
      enclosingSymbol: discriminator ?? "",
    }),
    axiom: AXIOM,
    ruleId,
    location: { file, startLine: 1, endLine: 1 },
    message,
    tier: "deterministic",
    source: "ast",
    // `confidence: 1` is the deterministic tier's contract value ("this rule
    // fired deterministically"), NOT a claim that the inferred convention is
    // certainly the right one. See docs/rules/axiom-6-conformance.md.
    confidence: 1,
    severity: "warning",
    ...(discriminator === undefined ? {} : { enclosingSymbol: discriminator }),
  };
}
