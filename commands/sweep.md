---
description: Run a deep-dive code cleanup and refactoring pass on the entire current directory
allowed-tools: Bash, Read, Glob, Grep, Edit
---
# Context
You are operating in the current working directory. You must analyze all files located here, regardless of their git commit history.

# Task
Act as an expert senior software engineer auditing a folder for technical debt. Scan the files in this directory line-by-line.

Apply these specific rules:
1. **Dead Code:** Identify unused variables, functions, imports, and orphaned comments (unless the comment explicitly justifies keeping the code).
2. **DRY Principle:** Flag duplicated logic that should be extracted into shared utilities, modules, or classes.
3. **Language-Specific Safety:** Look for anti-patterns native to the detected language (e.g., missing type safety, dangerous casting, unhandled exceptions, or improper memory management).
4. **Framework Health:** Check state management, resource allocation, and lifecycle methods for inefficiencies, stale dependencies, or potential memory leaks.
5. **Test Coverage:** Flag complex business logic or standalone utilities that lack corresponding unit tests.
6. **Observability & Logging:** In server/backend files, flag raw standard output statements (e.g., `console.log`, `print`) or unlogged critical operations. Suggest replacing them with a structured, JSON-based logging library, ensuring logs are grouped by a single request/roundtrip context (e.g., using a child logger or correlation ID). In client/UI files, ensure all stray debug logs are removed.
7. **Agent & Workflow Artifacts:** Identify and flag any leftover AI-generated plans, specification documents, temporary memory files (e.g., `superpowers` files, `plan.md`), or intermediate prompt artifacts. **Crucial:** Only flag these artifacts if their last-modified date is older than 7 days or if they clearly belong to a previously completed sprint. Do not touch active context files.

# Execution
DO NOT make stylistic or formatting changes. If there are no issues, just say so. Format your response with the file name, the problem, and the fix. Ask for confirmation before executing file modifications.