/**
 * `guardrails trends [--open]` (Story 1.16) — the human-readable view over
 * the committed trend store, because JSONL is not something anyone reads.
 *
 * FULLY SELF-CONTAINED, by contract (NFR-10/11, zero egress): the data is
 * inlined, the script is vanilla JS, the CSS is inline, and there is no CDN,
 * no network request and no charting dependency. The chart is hand-drawn SVG
 * — a few lines of arithmetic is cheaper than a library that would also have
 * to be vendored to keep the file offline.
 *
 * The output is a REGENERABLE VIEW and lives in the gitignored `.cache/`; the
 * committed `trends.jsonl` stays the source of truth.
 *
 * ESCAPING. Inlined data becomes `<script>` CONTENT, and a trend record can
 * carry attacker-influenced text (a ref name, a path) merged in from another
 * clone. `sanitizeMessage` — the terminal control-character filter — does
 * NOT help here: it passes `<`, `>` and `/` through untouched, so a value
 * containing `</script>` would close the tag and turn the rest of the file
 * into markup. `escapeForScript` and `escapeHtml` below are the ones that do,
 * and both are needed: they solve different problems in different contexts.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { trendRecordSchema, type TrendRecord } from "@agentic-guardrails/contracts";
import {
  od1ScoreTenths,
  OD1_FORMULA_VERSION,
  readJsonl,
  repoRoot,
  TRENDS_PATH,
  writeFileAtomic,
} from "@agentic-guardrails/core";

import { sanitizeMessage } from "./sanitize.js";

/** Repo-relative path of the generated view. */
export const TRENDS_HTML_PATH = "_agentic-guardrails/.cache/trends.html";

export interface TrendsCommandOptions {
  /** `--open`: hand the rendered file to the platform opener. */
  open?: boolean;
  /** Test seam: the opener, so the "no opener on PATH" row of the matrix can
   * be asserted without spawning a browser on the machine running the tests. */
  opener?: typeof openPath;
}

export async function trendsCommand(
  cwd: string,
  options: TrendsCommandOptions = {},
): Promise<number> {
  try {
    const root = repoRoot(cwd);
    if (!root.ok) {
      const message =
        root.kind === "git-not-found"
          ? "git executable not found — install git or add it to PATH"
          : root.kind === "not-a-repo"
            ? "not a git repository"
            : root.reason;
      process.stderr.write(`guardrails trends: ${sanitizeMessage(message)}\n`);
      return 2;
    }

    const read = readJsonl(path.join(root.value, TRENDS_PATH), trendRecordSchema);
    if (!read.ok) {
      // An unreadable store is not an empty one: rendering an "no history
      // yet" page over it would be a lie.
      // Sanitized like every other untrusted line: the reason embeds the
      // store's own path and OS error text.
      process.stderr.write(`guardrails trends: ${sanitizeMessage(read.reason)}\n`);
      return 2;
    }
    // Validate-before-trust, same as the aggregator: a skipped line is
    // declared, never silently absent from the chart.
    for (const declaration of read.value.declarations) {
      // A Zod declaration quotes the offending key VERBATIM (a `strictObject`
      // violation names it; an axiom-map key lands in `issue.path`), and this
      // file is merged in from other clones — so a crafted axiom key would
      // otherwise write ANSI escapes straight to the terminal.
      process.stderr.write(`guardrails trends: history: ${sanitizeMessage(declaration)}\n`);
    }

    const outPath = path.join(root.value, TRENDS_HTML_PATH);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileAtomic(outPath, renderTrendsHtml(read.value.records));
    const relative = path.relative(root.value, outPath).replaceAll("\\", "/");
    process.stdout.write(`${relative}\n`);

    if (options.open === true) {
      const opened = (options.opener ?? openPath)(outPath);
      // NEVER fatal: the path is already printed above, so a machine with no
      // opener on PATH loses a convenience, not the command.
      if (!opened.ok) {
        process.stderr.write(`guardrails trends: could not open the file (${opened.reason})\n`);
      }
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`guardrails trends: ${sanitizeMessage(message)}\n`);
    return 2;
  }
}

/**
 * Escapes text for an HTML TEXT/ATTRIBUTE context. Distinct from
 * `escapeForScript` below (a script-content escape) and from the review
 * report's `sanitizeMessage` (a C0 control-character filter for terminals) —
 * three contexts, three rules, and using any one of them in another's place
 * is a hole.
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Escapes a JSON string for embedding as `<script>` CONTENT.
 *
 * Inside a script element the HTML parser does not decode entities, so
 * `escapeHtml` is both wrong and useless here — but the parser DOES still
 * look for the literal end-tag text and for a comment opener. Rewriting the
 * three characters that can form them as JS unicode escapes is valid inside a
 * JSON string literal and yields the identical value after `JSON.parse`, so
 * no record — a ref name, a path, a sha merged in from another clone — can
 * close the script tag. U+2028/U+2029 are escaped too: they are line
 * terminators to a JS parser but legal RAW characters inside a JSON string,
 * so an unescaped one would be a syntax error in the emitted script.
 */
export function escapeForScript(json: string): string {
  return json
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    // `String.fromCharCode`, not a literal: U+2028/U+2029 are invisible
    // line terminators, and one sitting raw in THIS file would be a landmine
    // for the next person to edit it (some tools treat it as a newline).
    .replaceAll(String.fromCharCode(0x2028), "\\u2028")
    .replaceAll(String.fromCharCode(0x2029), "\\u2029");
}

/** One record, as the page consumes it: raw counts plus the score DERIVED
 * from them here (FR-14 — the store holds counts, the view computes). */
interface ViewPoint {
  recordId: string;
  runId: string;
  commitSha: string;
  scopeKind: string;
  /** Absent for a record whose scope has no denominator by construction. */
  changedKlocMilli: number | null;
  axiomSeverityCounts: Record<string, { error: number; warning: number; info: number }>;
  /** Absent for a record whose scope has no denominator. */
  scoreTenths: number | null;
}

/**
 * Renders the whole page. Exported so a test can assert on the bytes without
 * a filesystem — including that hostile content cannot break out.
 *
 * ponytail: records are charted in APPEND order, not git-ancestry order. The
 * ancestry ordering the delta uses costs one `merge-base` spawn per record,
 * which is right for comparing two records and wrong for painting hundreds;
 * append order is honest for a single-branch history and is LABELLED on the
 * page so nobody reads it as a topological claim. Sort topologically here if
 * cross-branch history ever makes the difference visible.
 */
export function renderTrendsHtml(records: readonly TrendRecord[]): string {
  const points: ViewPoint[] = records.map((record) => ({
    recordId: record.recordId,
    runId: record.runId,
    commitSha: record.commitSha,
    scopeKind: record.scopeKind,
    changedKlocMilli: record.changedKlocMilli ?? null,
    axiomSeverityCounts: record.axiomSeverityCounts,
    scoreTenths:
      // `project`-scope records have no denominator, so they carry no score —
      // never a fabricated 0 or 100 standing in for "undefined".
      record.scopeKind === "project" || record.changedKlocMilli === undefined
        ? null
        : od1ScoreTenths(record.axiomSeverityCounts, record.changedKlocMilli),
  }));
  const data = escapeForScript(JSON.stringify(points));
  const formula = escapeHtml(OD1_FORMULA_VERSION);
  const empty = points.length === 0;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>guardrails trends</title>
<style>
:root { color-scheme: light dark; --fg: #1b1b1f; --muted: #5c5f6b; --line: #d3d5dd; --bg: #ffffff;
        --error: #b3261e; --warning: #a26400; --info: #2d5fa8; --score: #1f7a4d; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #e6e6ea; --muted: #a0a3b0; --line: #3a3d47; --bg: #141519;
          --error: #f2857c; --warning: #e0a33a; --info: #7aa6e8; --score: #57c48a; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 2rem 1.5rem; background: var(--bg); color: var(--fg);
       font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
p.sub { color: var(--muted); margin: 0 0 1.75rem; font-size: .875rem; }
section { margin-bottom: 2.5rem; }
h2 { font-size: .95rem; margin: 0 0 .75rem; font-weight: 600; }
svg { width: 100%; height: auto; display: block; overflow: visible; }
table { border-collapse: collapse; width: 100%; font-size: .8125rem; }
th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid var(--line);
         white-space: nowrap; }
th { color: var(--muted); font-weight: 600; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.wrap { overflow-x: auto; }
.legend { display: flex; gap: 1rem; font-size: .8125rem; color: var(--muted); margin-bottom: .5rem; }
.swatch { display: inline-block; width: .7rem; height: .7rem; border-radius: 2px; margin-right: .3rem; }
.empty { border: 1px dashed var(--line); border-radius: 6px; padding: 2rem; color: var(--muted);
         text-align: center; }
code { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; }
</style>
</head>
<body>
<h1>guardrails trends</h1>
<p class="sub">Derived from the committed <code>_agentic-guardrails/history/trends.jsonl</code>.
Scores are computed here from the stored raw counts using formula <code>${formula}</code> —
the store holds counts, never scores. Records are shown in <strong>append order</strong>,
not git-ancestry order. Self-contained: no network, no CDN.</p>
${
  empty
    ? `<div class="empty">No trend records yet. Run <code>guardrails review</code> — the first run
records history and has nothing to compare against, which is normal, not a problem.</div>`
    : `<section>
  <h2>OD-1 score (${formula})</h2>
  <div id="score-chart"></div>
</section>
<section>
  <h2>Findings by severity</h2>
  <div class="legend">
    <span><span class="swatch" style="background:var(--error)"></span>error</span>
    <span><span class="swatch" style="background:var(--warning)"></span>warning</span>
    <span><span class="swatch" style="background:var(--info)"></span>info</span>
  </div>
  <div id="counts-chart"></div>
</section>
<section>
  <h2>Runs</h2>
  <div class="wrap"><table id="runs"><thead><tr>
    <th>#</th><th>run</th><th>commit</th><th>scope</th>
    <th class="num">kloc</th><th class="num">E</th><th class="num">W</th><th class="num">I</th>
    <th class="num">score</th>
  </tr></thead><tbody></tbody></table></div>
</section>`
}
<script>
const POINTS = ${data};
// Everything below builds DOM nodes and sets textContent — never innerHTML —
// so no record value is ever parsed as markup, whatever it contains.
const SVG = "http://www.w3.org/2000/svg";
const el = (name, attrs) => {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
  return node;
};
const totals = (counts) => {
  let e = 0, w = 0, i = 0;
  for (const c of Object.values(counts || {})) { e += c.error; w += c.warning; i += c.info; }
  return { e, w, i };
};
const W = 900, H = 220, PAD_L = 44, PAD_B = 22, PAD_T = 10, PAD_R = 8;
const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
const axis = (svg, maxValue, ticks) => {
  for (let t = 0; t <= ticks; t++) {
    const y = PAD_T + plotH - (plotH * t) / ticks;
    svg.appendChild(el("line", { x1: PAD_L, y1: y, x2: W - PAD_R, y2: y,
      stroke: "var(--line)", "stroke-width": 1 }));
    const label = el("text", { x: PAD_L - 6, y: y + 4, "text-anchor": "end",
      fill: "var(--muted)", "font-size": 11 });
    label.textContent = String(Math.round((maxValue * t) / ticks));
    svg.appendChild(label);
  }
};
const mount = (id, svg) => {
  const host = document.getElementById(id);
  if (host) host.appendChild(svg);
};

if (POINTS.length > 0) {
  // ---- score line ---------------------------------------------------------
  const scoreSvg = el("svg", { viewBox: \`0 0 \${W} \${H}\`, role: "img",
    "aria-label": "OD-1 score per run, oldest first" });
  axis(scoreSvg, 100, 4);
  const step = POINTS.length > 1 ? plotW / (POINTS.length - 1) : 0;
  const xAt = (i) => PAD_L + (POINTS.length > 1 ? step * i : plotW / 2);
  const yAt = (tenths) => PAD_T + plotH - (plotH * tenths) / 1000;
  let path = "", started = false;
  POINTS.forEach((p, i) => {
    if (p.scoreTenths === null) { started = false; return; }
    path += (started ? " L " : " M ") + xAt(i) + " " + yAt(p.scoreTenths);
    started = true;
  });
  if (path) scoreSvg.appendChild(el("path", { d: path.trim(), fill: "none",
    stroke: "var(--score)", "stroke-width": 2 }));
  POINTS.forEach((p, i) => {
    if (p.scoreTenths === null) return;
    const dot = el("circle", { cx: xAt(i), cy: yAt(p.scoreTenths), r: 3, fill: "var(--score)" });
    const title = el("title", {});
    title.textContent = p.runId + " — " + (p.scoreTenths / 10).toFixed(1);
    dot.appendChild(title);
    scoreSvg.appendChild(dot);
  });
  mount("score-chart", scoreSvg);

  // ---- stacked severity bars ---------------------------------------------
  const sums = POINTS.map((p) => totals(p.axiomSeverityCounts));
  const peak = Math.max(1, ...sums.map((s) => s.e + s.w + s.i));
  const countsSvg = el("svg", { viewBox: \`0 0 \${W} \${H}\`, role: "img",
    "aria-label": "Findings by severity per run, oldest first" });
  axis(countsSvg, peak, 4);
  const barW = Math.max(2, Math.min(28, (plotW / POINTS.length) * 0.7));
  sums.forEach((s, i) => {
    const x = PAD_L + (plotW / POINTS.length) * (i + 0.5) - barW / 2;
    let y = PAD_T + plotH;
    for (const [value, colour] of [[s.i, "info"], [s.w, "warning"], [s.e, "error"]]) {
      if (value === 0) continue;
      const h = (plotH * value) / peak;
      y -= h;
      countsSvg.appendChild(el("rect", { x, y, width: barW, height: h,
        fill: "var(--" + colour + ")" }));
    }
  });
  mount("counts-chart", countsSvg);

  // ---- table --------------------------------------------------------------
  const body = document.querySelector("#runs tbody");
  if (body) {
    POINTS.forEach((p, i) => {
      const s = totals(p.axiomSeverityCounts);
      const row = document.createElement("tr");
      const cells = [
        [String(i + 1), false],
        [p.runId, false],
        [String(p.commitSha).slice(0, 12), false],
        [p.scopeKind, false],
        [p.changedKlocMilli === null ? "—" : (p.changedKlocMilli / 1000).toFixed(3), true],
        [String(s.e), true], [String(s.w), true], [String(s.i), true],
        [p.scoreTenths === null ? "—" : (p.scoreTenths / 10).toFixed(1), true],
      ];
      for (const [text, numeric] of cells) {
        const cell = document.createElement("td");
        if (numeric) cell.className = "num";
        cell.textContent = text;
        row.appendChild(cell);
      }
      body.appendChild(row);
    });
  }
}
</script>
</body>
</html>
`;
}

/**
 * Which executable opens a path on a given platform, and with what arguments.
 *
 * NO COMMAND-LINE RE-PARSER, on any platform. `shell: false` stops NODE from
 * invoking a shell, but `cmd /c start` makes the CHILD cmd.exe, which
 * re-parses its own command line — and Node only quotes arguments containing
 * spaces or quotes, so a bare `&` passes through unquoted and cmd splits the
 * command there. A repository cloned under a path containing `&` would run
 * whatever follows it on `guardrails trends --open`. Every entry below is a
 * plain executable that takes the path as one argument and parses no shell
 * metacharacters, so there is no second parser to escape for.
 *
 * Exported so that property can be asserted directly, without spawning a
 * browser on the machine running the tests.
 */
export function openerFor(platform: string, target: string): [string, string[]] {
  if (platform === "win32") return ["explorer.exe", [target]];
  if (platform === "darwin") return ["open", [target]];
  return ["xdg-open", [target]];
}

/**
 * Hands a path to the platform opener. Argument ARRAY, `shell: false`: the
 * path is ours, but a shell string here would be an injection surface for
 * free. Never throws — every failure is a typed reason the caller prints.
 */
export function openPath(target: string): { ok: true } | { ok: false; reason: string } {
  const [command, args] = openerFor(process.platform, target);
  const result = spawnSync(command, args, { shell: false, windowsHide: true, timeout: 10_000 });
  if (result.error) return { ok: false, reason: result.error.message };
  // `explorer.exe` exits 1 on SUCCESS (it hands off and returns), so its exit
  // status carries no information; only a spawn failure is a failure there.
  // Either way `--open` is never fatal, so the worst case is a missed hint.
  if (command !== "explorer.exe" && result.status !== 0) {
    return { ok: false, reason: `${command} exited with ${result.status}` };
  }
  return { ok: true };
}
