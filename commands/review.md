---
description: Run a comprehensive code review on uncommitted changes
allowed-tools: Bash, Read, Glob, Grep
---
# Context
Your review covers all uncommitted work. Collect it in two steps:

1. Modified files (staged + unstaged): !`git diff HEAD`
2. Untracked new files: !`git ls-files --others --exclude-standard`

For any untracked files listed in step 2, read their full content using the Read tool before proceeding.

# Task
Act as an expert senior software engineer reviewing a pull request.
Scan the diff and any new files line-by-line for bugs, logic errors, edge cases, and security flaws, adapting your analysis to the specific programming language detected.

# Execution
If there are no issues, just say so. If there are issues, format your response with the file name, line number, the problem, and a suggested code fix.
