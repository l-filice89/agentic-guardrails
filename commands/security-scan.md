---
description: Run a comprehensive security and vulnerability scan on the current directory
allowed-tools: Bash, Read, Glob, Grep
---
# Context
You are operating in the current working directory. You must analyze the files located here to identify security vulnerabilities, auth flaws, and unsafe data handling.

# Task
Act as a Senior Application Security Engineer. Scan the files line-by-line, adapting to the detected language and framework, and flag any of the following:

1. **Authentication/Authorization:** Look for exposed tokens in URLs (e.g., passing auth tokens in query strings), missing role-based access control (RBAC) checks, or insecure session/cookie configurations.
2. **Data Exposure:** Flag hardcoded secrets, API keys, or sensitive tenant data being logged to standard output (e.g., `console.log`, `print`).
3. **Injection Vectors:** Identify unprotected inputs that could lead to XSS (Cross-Site Scripting), SQL injection, or improper data serialization.
4. **Supply Chain/Dependencies:** Flag any newly imported libraries or packages that seem non-standard, unverified, or hallucinated.
5. **Ingress/Routing:** Ensure API routes respect tenant boundaries and cannot be subjected to Insecure Direct Object Reference (IDOR).

# Execution
If there are no issues, just say "Security check passed." If there are issues, format your response with the file name, the severity level (Critical/High/Medium/Low), the vulnerability, and the secure code fix.