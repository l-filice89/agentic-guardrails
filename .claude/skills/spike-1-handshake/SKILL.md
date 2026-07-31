---
name: spike-1-handshake
description: SPIKE-1 (story 1.19) throwaway file-handshake skill. Reads spike1.in.json from the run directory given as an argument, produces envelope-shaped findings JSON, and writes spike1.out.json via a temp file + atomic mv rename. Use when invoked as /spike-1-handshake <run-dir>.
---

# spike-1-handshake

You are one side of a file handshake. The argument is an absolute run
directory: `$ARGUMENTS`.

Steps — do exactly these, nothing else:

1. Read `<run-dir>/spike1.in.json`.
2. Follow its `task` field to produce ONE JSON object (the `content` field is
   the source to review; `file` is its path). If `priorIssues` is present,
   your previous attempt failed validation for those reasons — fix them. If
   `invalidOutput` is present, correct that exact output and respond only
   with the corrected JSON.
3. Write the JSON object (raw JSON, no markdown fences, no prose) with the
   Write tool to `<run-dir>/spike1.out.json.tmp`.
4. Atomically rename it: `mv <run-dir>/spike1.out.json.tmp <run-dir>/spike1.out.json`
   (Bash). NEVER write `spike1.out.json` directly — the rename is the
   completion signal.
5. Reply with the single word `done`.

Do not create, edit, or read any other file. Do not run any other command.
