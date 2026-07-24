# Deferred Work

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-walking-skeleton-first-end-to-end-review.md`
  summary: Dogfood runs exit 2 because packages/cli/tsup.config.ts and tests/integration/*.ts belong to no tsconfig project; add a tests/tsconfig.json (or root-solution reference) so guardrails review of this repo can exit 0/1.
  evidence: Live dogfood run after story 1.4 patches - 3 honest "changed TS file covered by no tsconfig project" degradations; tsc -b never type-checks those files either.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-config-plane.md`
  summary: Decide the uncommitted-config policy - whether an untracked/modified _agentic-guardrails/config.yaml may govern a gating run (current behavior: allowed, but declared in configGitStatus + a stderr warning). Candidate owner: story 1.18 (dogfood CI) or epic-level ruling.
  evidence: Review finding - an agent under review can drop an uncommitted config turning axioms advisory/off; 1.6 shipped visibility (manifest configGitStatus, stderr warning) but not policy.
