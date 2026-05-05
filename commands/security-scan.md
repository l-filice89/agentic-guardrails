---
description: Comprehensive OWASP 10:2025 agnostic security scan
allowed-tools: Bash, Read, Glob, Grep
---
# Context
You are acting as a Senior Application Security Engineer. You must analyze the current directory to identify risks aligned with the full OWASP Top 10:2025 framework. The goal is to enforce universal security governance that remains agnostic of specific frameworks or languages.

# Task
Scan the files and flag vulnerabilities in all 10 OWASP categories:

1. **A01:2025 - Broken Access Control:** Detect missing boundary checks, horizontal/vertical privilege escalation, or unauthorized access to sensitive internal logic.
2. **A02:2025 - Security Misconfiguration:** Identify insecure default values, verbose error messaging, or the presence of unnecessary debugging features in production paths.
3. **A03:2025 - Software Supply Chain Failures:** Flag unverified, non-standard, or potentially hallucinated third-party imports and dependencies.
4. **A04:2025 - Cryptographic Failures:** Identify hardcoded keys, use of weak/deprecated hashing algorithms, or sensitive data transmitted in cleartext.
5. **A05:2025 - Injection:** Detect unsanitized inputs that could lead to XSS, SQL/NoSQL injection, or unsafe command execution.
6. **A06:2025 - Insecure Design:** Flag patterns that lack "Security by Design" (e.g., storing sensitive state on the client-side or lacking fail-safe defaults).
7. **A07:2025 - Identification and Auth Failures:** Detect exposed tokens in URLs, cleartext credentials, or insecure session management logic.
8. **A08:2025 - Software and Data Integrity Failures:** Identify use of untrusted data without integrity checks (e.g., unsafe deserialization or unverified plugins).
9. **A09:2025 - Security Logging and Alerting Failures:** Flag the logging of PII, authentication headers, or system secrets to standard output.
10. **A10:2025 - Mishandling of Exceptional Conditions:** Detect error handling that leaks stack traces, architectural paths, or sensitive system state to the client.

# Execution
If no issues are found, say "Security check passed." 
If issues are detected, format your response as follows:
- **File:** [Path]
- **OWASP Category:** [AXX:2025]
- **Severity:** [Critical/High/Medium/Low]
- **Vulnerability:** [Brief description of the agnostic security flaw]
- **Secure Fix:** [Code snippet of the corrected implementation]