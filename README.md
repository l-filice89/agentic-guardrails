# agentic-guardrails

Production-ready governance commands and engineering quality guardrails.

Installs four slash commands and an `engineering-standards` skill that enforce consistent type safety, security, observability, and accessibility practices across any project.

---

## Commands

| Command | Scope | Purpose |
|---|---|---|
| `/cleanup` | Files changed in current branch vs `main` | Pre-PR hygiene pass |
| `/sweep` | Entire working directory | Full technical debt audit |
| `/security-scan` | Entire working directory | Security and vulnerability scan |
| `/review` | All uncommitted changes | Expert review before staging |

---

## Installation

### Prerequisites
- [Claude Code](https://claude.ai/code) installed

### Via the Claude Code Plugin Store *(coming soon)*

Once published, you'll be able to install directly from the official Claude Code plugin store — no manual steps required.

### Manual install

Clone the repo:

```bash
git clone https://github.com/l-filice89/agentic-guardrails.git ~/.claude/plugins/agentic-guardrails
```

Claude Code does not support permanently enabling local (non-marketplace) plugins via settings. Use one of the following approaches:

**Option A — Shell alias (recommended)**

Add to your `~/.zshrc` (or `~/.bashrc`):

```bash
alias claude='claude --plugin-dir ~/.claude/plugins/agentic-guardrails'
```

Reload your shell (`source ~/.zshrc`). Commands will be available in every Claude Code session, namespaced as `/agentic-guardrails:cleanup`, `/agentic-guardrails:sweep`, etc.

**Option B — Per-session flag**

```bash
claude --plugin-dir ~/.claude/plugins/agentic-guardrails
```

Use this for one-off sessions without modifying your shell config.

**Option C — Standalone commands (no namespace)**

Copy the command files into your user-level Claude commands directory:

```bash
cp ~/.claude/plugins/agentic-guardrails/commands/*.md ~/.claude/commands/
```

Commands will load automatically as `/cleanup`, `/sweep`, etc. — no flag or namespace needed. You lose the plugin packaging but gain the shorter names.

---

## Commands in Detail

### `/cleanup`
Targeted cleanup on files changed in the current branch relative to `main`. Run this before opening a PR.

Checks: dead code, DRY violations, type safety anti-patterns, framework health, test coverage gaps, logging hygiene, leftover AI artifacts.

### `/sweep`
Same checks as `/cleanup` but across the entire working directory. Use this for periodic debt audits or when onboarding to an unfamiliar codebase.

### `/security-scan`
Scans for:
- Hardcoded secrets and API keys
- Authentication/authorization flaws and missing RBAC
- Injection vectors (SQL, XSS, unsafe deserialization)
- Tenant boundary violations and IDOR risks
- Suspicious or unverified third-party dependencies

Outputs findings with severity: **Critical / High / Medium / Low**.

### `/review`
Reviews all uncommitted changes — staged edits, unstaged edits, and untracked new files — as an expert senior engineer. Outputs findings with file name, line number, problem, and suggested fix.

---

## Skill: `engineering-standards`

The `engineering-standards` skill is loaded automatically when you write or review backend or frontend code. It enforces:

- **Strict type safety** — no `any`, blind casting, or type-checker bypass directives
- **Structured logging** — JSON-based logger with correlation IDs; no raw `console.log`/`print` in backend code
- **Tenant isolation** — IDOR prevention; server-side validation of all IDs; never trust client-provided tenant context
- **Mobile-first UI** — semantic HTML, `aria-labels`, keyboard navigation, no hardcoded desktop widths
- **Testing discipline** — backend TDD before business logic; pragmatic client-side testing focused on state and data
- **ADRs** — for significant architectural decisions (new dependencies, schema changes, cross-service contracts)
- **Definition of Done** — type check, lint, clean state, build, and manual test steps before declaring work complete

### Injecting your own standards

The skill in `skills/SKILL.md` contains the universal engineering standards that apply to any project. If you maintain personal coding preferences in a `~/.claude/CLAUDE.md` file, the recommended split is:

- **CLAUDE.md** — personal workflow preferences (e.g., git habits, tone, explanation depth)
- **SKILL.md** — universal, shareable engineering standards (type safety, logging, security, testing)

To customize this plugin for your team, fork the repo and edit `skills/SKILL.md` directly.

---

## Testing

Fixtures with deliberate violations are provided in `tests/fixtures/`. Each file is annotated with the violations it contains.

To spin up an isolated test workspace:

```bash
bash tests/setup.sh
```

This creates a temporary git repo pre-loaded with the fixtures and prints the commands to run. Compare the output against `tests/EXPECTED.md`.

---

## License

MIT
