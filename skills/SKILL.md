---
name: engineering-standards
description: Activate when writing, reviewing, or refactoring any backend or frontend code. Enforces production-grade standards: type safety, structured logging, tenant isolation, mobile-first UI, and backend TDD.
---

## Client & UI Development
- **Mobile-First:** Always write styling mobile-first. Use standard CSS/framework breakpoints to scale up for desktop, never scale down. Guarantee zero horizontal scrolling on mobile viewports.
- **Accessibility (a11y):** Default to semantic HTML. All interactive elements must have proper `aria-labels`, visible focus states, and support full keyboard navigation (Tab/Enter/Space).
- **Performance:** Guard against unnecessary rendering cycles. Assume large data structures; proactively suggest virtualization or pagination if a list exceeds 50 items.

## Backend & Service Development
- **Structured Observability:** Never use raw standard output (e.g., `console.log`, `print`) for backend operations. Always use a structured, JSON-based logger. Group logs by request context using child loggers or correlation IDs to trace the full lifecycle of an operation.
- **Security & Tenant Isolation:** Always assume a multi-tenant environment. Ensure database queries, API responses, and edge functions strictly enforce tenant isolation. Never trust client-side IDs without backend authorization validation. Prevent IDOR (Insecure Direct Object Reference) by default.

## Testing Strategy
- **Backend — Strict TDD:** Write tests for API contracts, tenant data isolation, and AI model input/output boundaries *before* implementing business logic.
- **Client — Pragmatic Testing:** Focus tests on complex state transitions, data fetching, and critical business logic. Skip pixel-perfect UI snapshot tests.

## General Engineering Standards
- **Strict Type Safety:** Maximize the use of the language's type system (e.g., strict TypeScript, Python type hinting, Rust traits). No type-checker bypassing — no `any` types, blind casting, `interface{}` abuse, or ignore directives. Prefer safe type narrowing and explicit interfaces/structs for all component props, state, API contracts, and database schemas.
- **Trade-off Awareness:** If a solution introduces latency, state bloat, or caching complexity, flag the architectural trade-off in a single sentence before the code block.
- **Pragmatic DRY:** Extract shared functions, utilities, and components when logic is exactly duplicated. Avoid hasty abstractions — if a shared abstraction requires excessive conditional logic for minor variations, prefer duplication until a cleaner path emerges.
- **Architecture Decision Records (ADRs):** Document significant architectural choices (new core dependencies, global state management changes, database schema changes, cross-service API contracts) by generating an ADR in the project's docs folder. Format strictly with: Title, Date, Status, Context, Decision, and Consequences. Do not create ADRs for component-level logic or standard refactors.

## Definition of Done
Before declaring a task complete, verify:
- **Type Safety:** No compiler or static analyzer errors. Fix any automatically.
- **Lint & Format:** Code passes all configured linters and formatters.
- **Clean State:** No unused imports, stray debug statements, or commented-out dead code.
- **Build Check:** For structural changes or dependency updates, confirm the build completes successfully.
- **Manual Test Steps:** Provide a concise list of manual steps targeting interactive or visual elements not covered by automated tests.
