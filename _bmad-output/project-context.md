---
project_name: 'agentic-guardrails'
user_name: 'Luca'
date: '2026-06-06'
status: 'rework-in-progress'
note: 'Top = durable, architecture-independent rules. Legacy section describes the prompt-only tool being replaced; strip milestone-by-milestone as superseded (see roadmap.md M4 — Legacy decommission).'
---

# Project Context for AI Agents

_Critical rules and patterns AI agents must follow when working on agentic-guardrails._

---

## Durable Rules (architecture-independent)

### Documentation & ADRs are part of the Definition of Done

- No milestone or feature is "done" until its documentation **and** an ADR (Architecture Decision Record) for any significant decision land in the **same PR**.
- The project uses ADRs to record significant decisions — fitting, since ADRs are a signal source for the planned Axiom #6 (eat our own dog food).
- Keep README, CHANGELOG (Keep a Changelog / SemVer), and per-feature docs current as part of the same change, not as a follow-up.

### Project is mid-rework — the design of record lives outside the current code

- The repo currently contains the **legacy prompt-only** Claude Code plugin. It is being reworked into a programmatic Node/TS runtime engine.
- **Design of record:**
  - `_bmad-output/planning-artifacts/briefs/brief-agentic-guardrails-2026-06-01/brief.md` — the product brief: the most-updated statement of product intent (scope, positioning, success criteria). Where documents conflict, the brief wins.
  - `roadmap.md` (repo root) — the sequenced build (M0–M5) + go-to-market (G0–G4) roadmap.
  - `_bmad-output/brainstorming/brainstorming-session-2026-05-31-18-47.md` — the 5-axiom runtime engine.
  - `_bmad-output/brainstorming/brainstorming-session-2026-06-06-axiom6.md` — Axiom #6 (Conformance) + the corpus subsystem (+ spin-off Axioms #7 Visual Fidelity, #8 Atomicity).
- Do **not** treat the Legacy rules below as the target architecture. They describe the code that exists **today** and remain valid only until each part is superseded by the rework — at which point the corresponding Legacy rule should be removed.
- **Exception — the `engineering-standards` skill is a foundation, not legacy** (decided 2026-06-10): it carries forward into the v2 plugin surface as the write-time enforcement layer. Its Legacy rules below (skill frontmatter, description precision as a security boundary) remain durable and must survive the M4 legacy decommission.

---

## Legacy (prompt-only — being replaced)

_These rules accurately describe the current prompt-only tool and survive while the commands become thin plugin surfaces over the new engine. Remove milestone-by-milestone as superseded._

### Technology Stack & Versions

- **Plugin format:** Claude Code slash commands (Markdown + YAML frontmatter) and skills (Markdown + YAML frontmatter)
- **No build step:** The Markdown files are the deployed artifact — no compilation, bundling, or transpilation
- **Test fixtures:** TypeScript (`.ts`) and TypeScript React (`.tsx`) — used only as intentionally-dirty test targets, not the plugin itself
- **Test harness:** Bash (`tests/setup.sh`) creates an isolated git workspace for manual verification
- **Claude Code version:** Not pinned — commands rely on stable slash-command and skill APIs

### Critical Implementation Rules

#### Language-Specific Rules (Claude Code Markdown DSL)

- **Command frontmatter is required:** Every `commands/*.md` file must open with a YAML block containing `description` (plain text) and `allowed-tools` (comma-separated list). Missing or malformed frontmatter will silently break the command.
- **`allowed-tools` is a hard constraint:** Only list tools the command actually needs. Adding unnecessary tools (e.g., `Edit` or `Bash` to a read-only command) widens the blast radius. `security-scan` is read-only by design: `Bash, Read, Glob, Grep` only.
- **Inline bash syntax:** Use `` !`<command>` `` for shell execution within command prompts. This is not standard Markdown — it is Claude Code's dynamic injection syntax.
- **Skill frontmatter:** `skills/*/SKILL.md` must have `name` (unique identifier) and `description` (auto-activation trigger phrase). The description is matched against the task context, so precision matters — vague descriptions cause false activations.
- **No template variables in command/skill files:** These files are static prompts, not Jinja/Handlebars templates. Do not introduce `{{variable}}` syntax.
- **Section structure for commands:** Follow the established `# Context` → `# Task` → `# Execution` pattern. Deviating from this breaks the prompt's reasoning flow.

#### Testing Rules

- **Test oracle is `tests/EXPECTED.md`:** When verifying a command, compare its output against this file. It maps each fixture to expected findings by command, line number, violation type, and severity.
- **Fixtures are intentionally dirty — never clean them:** `tests/fixtures/dirty-*.ts/tsx` contain deliberate violations. Modifying them invalidates the test baseline. They are not production code.
- **Test harness is manual:** There is no automated test runner. Run `bash tests/setup.sh` to create an isolated workspace, then execute commands inside it.
- **Fixture-to-command mapping is strict:**
  - `dirty-frontend.tsx` → `/cleanup`, `/sweep`, `/review`
  - `dirty-backend.ts` → `/cleanup`, `/sweep`, `/review`, `/security-scan`
  - `dirty-security.ts` → `/security-scan` only
- **Adding a new command requires a new fixture:** Any new slash command must have a corresponding dirty fixture and entries in `EXPECTED.md`.
- **TypeScript in fixtures is not compiled:** The `.ts`/`.tsx` fixtures are prompt targets only — do not add `tsconfig.json` or attempt to build them.

#### Code Quality & Style Rules

- **Rule formatting in commands:** Use numbered lists (`1.`, `2.`, …) for the `# Task` section rules. Each rule item starts with a `**Bold Label:**` followed by description. Do not use bullet lists inside `# Task`.
- **Execution section brevity:** The `# Execution` section must be 1–3 sentences. It states what to do when nothing is found, how to format findings, and whether to ask for confirmation before edits.
- **Confirmation gate is mandatory for mutating commands:** `/cleanup`, `/sweep`, and `/review` must ask for user confirmation before applying any file modifications. `/security-scan` never modifies files.
- **CHANGELOG format:** Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) with SemVer. Group entries under `Added`, `Changed`, `Fixed`, `Removed`. Include date in `[version] - YYYY-MM-DD` format.
- **No prose comments in Markdown files:** Rule text is self-documenting. Do not add `<!-- comment -->` annotations or explanatory asides to command/skill files.
- **File naming:** Commands are `kebab-case.md`. Skills live in `skills/<kebab-case-name>/SKILL.md`. Do not flatten the skill directory structure.

#### Development Workflow Rules

- **Branch model:** Work off `main`. Feature branches are diffed against `main` — this is the scope `/cleanup` uses (`git diff --name-only main...HEAD`). Never rebase or squash in a way that breaks that diff.
- **No CI pipeline:** There is no automated CI. Verification is manual via `bash tests/setup.sh` followed by running each command in the generated workspace.
- **Versioning:** SemVer, tracked in `CHANGELOG.md` only. There is no `package.json` or other version file to keep in sync.
- **README must stay current:** When adding a new command or skill, update the README command table, the "Commands in Detail" section, and the installation instructions if the file layout changes.
- **Plugin distribution is by git clone:** No npm publish, no registry. Installation instructions in README are the release artifact — keep them accurate.
- **EXPECTED.md is a release gate:** Before tagging a release, manually verify all fixtures produce the expected findings listed in `tests/EXPECTED.md`.

#### Critical Don't-Miss Rules

- **Never add `Edit` or `Write` to `security-scan`'s `allowed-tools`:** It is intentionally read-only. Adding mutation tools breaks the security posture guarantee documented in the README.
- **Never remove the confirmation gate from mutating commands:** The phrase "Ask for my confirmation before executing any automated file modifications" (or equivalent) must remain in `/cleanup`, `/sweep`, and `/review`. Removing it makes the commands destructive without consent.
- **Do not treat fixtures as real code to improve:** `tests/fixtures/dirty-*.ts/tsx` exist to be caught, not fixed. Any agent that "helpfully" cleans them up destroys the test baseline.
- **`allowed-tools` omission ≠ all tools allowed:** If the frontmatter `allowed-tools` field is missing entirely, Claude Code falls back to defaults which may differ from intent. Always declare it explicitly.
- **Skill description precision is a security boundary:** The `engineering-standards` skill auto-activates based on its description match. An overly broad description will trigger it on unrelated tasks (e.g., writing Markdown docs). Keep it scoped to backend/frontend code writing and review.
- **Do not add a build step:** This project has no compilation. Introducing a `package.json`, `tsconfig.json`, or build script would signal to future agents that there is a compile step — causing confusion and broken CI assumptions. _(Note: this constraint is reversed by the planned rework — the target is a Node/TS runtime. Applies only to the legacy code.)_
- **README installation instructions are user-facing release notes:** Any structural change to the repo (new directory, renamed command file, new skill) must be reflected in README before merging, not after.

### Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code in this project
- Follow ALL Durable Rules; for Legacy rules, follow them when working on the existing prompt-only code, but defer to the design of record for rework tasks
- When in doubt, prefer the more restrictive option

**For Humans:**

- Keep this file lean and focused on agent needs
- Strip Legacy rules as the rework supersedes them; refresh the durable section from the architecture once it exists

_Last Updated: 2026-06-06_
