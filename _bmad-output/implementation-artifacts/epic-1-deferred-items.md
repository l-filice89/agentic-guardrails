# Epic 1 — Deferred / Triaged Review Items

Running log of review findings that were NOT fixed immediately (severity below high, or deliberately deferred).
Each item must end in one of four terminal states before the epic-1 PR leaves draft:
`executed` | `discarded (false positive, with proof)` | `pushed to story X.Y` | `listed for future work`.

| # | Origin | Severity | Item | Status |
|---|--------|----------|------|--------|
| D1 | Story 1.1 story-review r2 | low | "CI gates the PR" also requires GitHub branch-protection settings (repo-admin config, not code). Workflow existence + failing checks is the code deliverable; protection rules must be enabled manually. | open |
| D2 | Story 1.1 story-review r2 | low | Solution-style tsconfig (`files: []`) and `target` ES2023-vs-ES2024 left to dev-agent discretion. | open |
