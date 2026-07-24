# ADR-001: LLM Contract Envelope

## Status

Accepted — 2026-07-24 (Story 1.2; defined here, first consumed Epic 2)

## Context

The engine is deterministic-first and LLM-deepened: Epic 2 adds an LLM tier,
but `core` must stay LLM-free (ADR-005 wall). LLM output is untrusted input —
schemas drift, models hallucinate fields, prompts change shape over time. If
each axiom's LLM interaction invented its own request/response handling, bad
model output would leak into the deterministic engine as unvalidated data,
and the vendor boundary would erode one ad-hoc interface at a time.

## Decision

Every LLM interaction crosses a Zod-validated envelope: a per-axiom
`<axiom>.in` / `<axiom>.out` schema pair, produced by the
`axiomEnvelope(axiom, inSchema, outSchema)` factory in
`@agentic-guardrails/contracts` (`src/envelope.ts`). The `llm` package owns
SDK calls; everything it sends is validated against `<axiom>.in` and
everything it returns is `safeParse`d against `<axiom>.out` before any other
package sees it. Validation failure is a typed error result (`safeParse` on
the envelope schemas), never a throw and never a passthrough. What ships in
this story is the envelope *shape* — the factory and its schema pair; the
transport that performs the validation on live traffic is Epic 2 scope and
must follow this rule when it lands.

The factory lives in `contracts` — not `llm` — because the envelope is the
shared boundary shape both sides depend on: `core` consumes validated `.out`
data without ever importing an SDK, and the wall from ADR-005 stays intact.

The factory is defined in this story (1.2, with the rest of the canonical
contracts) and first consumed in Epic 2 when the LLM tier lands.

## Consequences

- Model/vendor swaps are contained: only the `llm` package changes; every
  consumer keeps validating against the same `<axiom>.in`/`.out` schemas.
- Malformed model output is caught at the boundary as a typed ZodError
  result, feeding the degraded/partial-result contract instead of crashing
  or silently corrupting findings.
- Every new axiom that uses the LLM tier must declare its envelope pair up
  front — a small tax that keeps the contract surface enumerable.
- Until Epic 2, the factory has no consumers; it exists now so downstream
  stories build against a pinned contract instead of retrofitting one.
