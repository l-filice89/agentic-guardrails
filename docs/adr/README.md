# Architecture Decision Records

This index and the ADR format below (Status / Context / Decision / Consequences) were
established by ADR-002 and ADR-005 (Story 1.1), the first ADRs in this project.

| ADR | Title | Status | Landed in |
|---|---|---|---|
| [ADR-001](./ADR-001-llm-envelope.md) | LLM contract envelope | Planned | Story 1.2 |
| [ADR-002](./ADR-002-repo-layout.md) | Repo layout (pnpm workspaces + TS project references) | Accepted | Story 1.1 |
| [ADR-003](./ADR-003-orchestration.md) | Orchestration (static six-phase pipeline + p-map) | Planned | Story 1.7 |
| [ADR-004](./ADR-004-ast-tooling.md) | AST tooling (ts-morph LanguageAdapter) | Planned | Story 1.3 |
| [ADR-005](./ADR-005-contracts-package.md) | Contracts package (standalone pure-Zod source of truth) | Accepted | Story 1.1 |

The numbering gap (001, 003, 004 missing here) is intentional: those ADRs are written
by the stories that realize the decisions they record, not up front. See
`_bmad-output/planning-artifacts/architecture.md#Core Architectural Decisions` for the
full decision inventory.
