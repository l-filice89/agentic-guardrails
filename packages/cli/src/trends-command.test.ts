/**
 * The `guardrails trends` view (1.16): self-contained by construction, and —
 * the thing that actually bites — hostile record content cannot break out of
 * the inlined `<script>` block.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { makeTrendRecord, type TrendRecord } from "@agentic-guardrails/contracts";
import { HISTORY_DIR, TRENDS_PATH } from "@agentic-guardrails/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  escapeForScript,
  escapeHtml,
  openerFor,
  renderTrendsHtml,
  trendsCommand,
  TRENDS_HTML_PATH,
} from "./trends-command.js";

function record(overrides: Partial<TrendRecord> = {}): TrendRecord {
  return makeTrendRecord({
    schemaVersion: 1,
    runId: "0123456789abcdef",
    commitSha: "20460ade5621625ff09fa73e4a2a5f9802e4358c",
    scopeKind: "branch",
    axiomSeverityCounts: { "1": { error: 1, warning: 2, info: 3 } },
    changedKlocMilli: 1_000,
    ...overrides,
  });
}

describe("escaping — three contexts, three rules", () => {
  it("escapeHtml neutralizes markup in a TEXT context", () => {
    expect(escapeHtml('<img src=x onerror="a">')).toBe(
      "&lt;img src=x onerror=&quot;a&quot;&gt;",
    );
  });

  it("escapeForScript makes a closing script tag impossible", () => {
    const hostile = JSON.stringify({ ref: "</script><script>alert(1)</script>" });
    const escaped = escapeForScript(hostile);
    expect(escaped.toLowerCase()).not.toContain("</script");
    expect(escaped).not.toContain("<");
    expect(escaped).not.toContain(">");
    // …while still parsing back to the identical value.
    expect(JSON.parse(escaped)).toEqual({ ref: "</script><script>alert(1)</script>" });
  });

  it("escapes the JS line terminators that are legal raw inside JSON", () => {
    const raw = JSON.stringify({ s: String.fromCharCode(0x2028, 0x2029) });
    const escaped = escapeForScript(raw);
    // Checked by code point, never by a regex literal — a raw line separator
    // in THIS file is exactly the landmine the escape exists to defuse.
    expect(escaped).not.toContain(String.fromCharCode(0x2028));
    expect(escaped).not.toContain(String.fromCharCode(0x2029));
    expect(JSON.parse(escaped)).toEqual({ s: String.fromCharCode(0x2028, 0x2029) });
  });
});

describe("renderTrendsHtml", () => {
  it("is fully self-contained: no network, no CDN, no external asset", () => {
    const html = renderTrendsHtml([record()]);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/); // the SVG namespace URI is not a fetch
    expect(html).not.toContain("<link");
    expect(html).not.toContain("src=");
    expect(html).not.toContain("fetch(");
    expect(html).not.toContain("XMLHttpRequest");
  });

  it("renders an honest EMPTY state rather than crashing on no history", () => {
    const html = renderTrendsHtml([]);
    expect(html).toContain("No trend records yet");
    expect(html).toContain("const POINTS = [];");
  });

  it("DERIVES the score from stored counts and stamps the formula version", () => {
    // 1 KLOC, 1E+2W+3I → 100 − (10+6+3)/1 = 81.0 → 810 tenths.
    const html = renderTrendsHtml([record()]);
    expect(html).toContain('"scoreTenths":810');
    expect(html).toContain("od-1-v1");
  });

  it("carries NO score for a project-scope record — never a fabricated 0 or 100", () => {
    const html = renderTrendsHtml([record({ scopeKind: "project" })]);
    expect(html).toContain('"scoreTenths":null');
  });

  it("shows no denominator for a record that legitimately carries none", () => {
    const html = renderTrendsHtml([record({ scopeKind: "project", changedKlocMilli: undefined })]);
    expect(html).toContain('"changedKlocMilli":null');
    expect(html).toContain('"scoreTenths":null');
  });

  it("a hostile commitSha cannot close the script tag", () => {
    // A record merged in from another clone is untrusted content, and the
    // store is hand-editable besides.
    const html = renderTrendsHtml([record({ commitSha: "</script><h1>pwned</h1>" })]);
    expect(html).not.toContain("<h1>pwned</h1>");
    // Exactly one script element: the escaping did not split it in two.
    expect(html.match(/<script/g) ?? []).toHaveLength(1);
    expect(html.match(/<\/script>/g) ?? []).toHaveLength(1);
  });
});

describe("--open hands the path to no command-line re-parser", () => {
  it("never uses cmd.exe on Windows, and passes the path as ONE argument", () => {
    // `spawnSync("cmd", ["/c","start","", target], { shell: false })` is not
    // safe: cmd.exe re-parses its command line and Node leaves a bare `&`
    // unquoted, so a repo cloned under `C:\a&calc\` executed `calc`.
    const hostile = String.raw`C:\a&calc\_agentic-guardrails\.cache\trends.html`;
    for (const platform of ["win32", "darwin", "linux"]) {
      const [command, args] = openerFor(platform, hostile);
      expect(command.toLowerCase()).not.toContain("cmd");
      expect(command.toLowerCase()).not.toContain("powershell");
      expect(command.toLowerCase()).not.toContain("sh");
      expect(args).toEqual([hostile]); // one argument, unsplit
    }
  });
});

describe("guardrails trends — exit codes", () => {
  const tempDirs: string[] = [];
  const capture = (): { out: string[]; err: string[]; restore: () => void } => {
    const out: string[] = [];
    const err: string[] = [];
    const stdout = process.stdout.write.bind(process.stdout);
    const stderr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string) => {
      err.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    return {
      out,
      err,
      restore: () => {
        process.stdout.write = stdout;
        process.stderr.write = stderr;
      },
    };
  };

  function repo(withHistory: boolean): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-trends-cmd-"));
    tempDirs.push(dir);
    spawnSync("git", ["init"], { cwd: dir, shell: false });
    if (withHistory) {
      mkdirSync(path.join(dir, HISTORY_DIR), { recursive: true });
      writeFileSync(path.join(dir, TRENDS_PATH), `${JSON.stringify(record())}\n`);
    }
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("exits 2 when the cwd is not a git repository", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "guardrails-notrepo-"));
    tempDirs.push(dir);
    const io = capture();
    try {
      expect(await trendsCommand(dir)).toBe(2);
    } finally {
      io.restore();
    }
    expect(io.err.join("")).toContain("not a git repository");
  });

  it("exits 2 on an UNREADABLE store rather than rendering an empty page over it", async () => {
    const dir = repo(false);
    // A directory where the store should be: "readable as absent" would be a
    // lie, and the empty state claims there is simply no history yet.
    mkdirSync(path.join(dir, TRENDS_PATH), { recursive: true });
    const io = capture();
    try {
      expect(await trendsCommand(dir)).toBe(2);
    } finally {
      io.restore();
    }
    expect(io.err.join("")).toContain("read error");
  });

  it("a failing --open prints the path and leaves the exit code alone", async () => {
    const dir = repo(true);
    const io = capture();
    try {
      expect(
        await trendsCommand(dir, {
          open: true,
          opener: () => ({ ok: false, reason: "no opener on PATH" }),
        }),
      ).toBe(0);
    } finally {
      io.restore();
    }
    expect(io.out.join("")).toContain(TRENDS_HTML_PATH);
    expect(io.err.join("")).toContain("could not open the file");
  });

  it("SANITIZES a history declaration before it reaches the terminal", async () => {
    const dir = repo(true);
    // A Zod `strictObject` violation names the offending key VERBATIM, and
    // this store is merged in from other clones.
    const esc = String.fromCharCode(0x1b);
    writeFileSync(
      path.join(dir, TRENDS_PATH),
      `${JSON.stringify({ ...record(), [`${esc}[31mevil`]: 1 })}\n`,
    );
    const io = capture();
    try {
      expect(await trendsCommand(dir)).toBe(0);
    } finally {
      io.restore();
    }
    expect(io.err.join("")).toContain("history:");
    expect(io.err.join("")).not.toContain(esc);
  });
});
