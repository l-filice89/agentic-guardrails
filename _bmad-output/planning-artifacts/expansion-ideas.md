# Expansion Ideas — agentic-guardrails

_Parked ideas captured for later consideration. **Not** part of the current PRD/architecture scope._
_Source: ideation session 2026-06-27 (Luca). Each entry is gut-checked against the v1 PRD + architecture draft._

> Status legend: `park` = sound, captured for a future cycle · `brainstorm` = worthy but under-defined; run a brainstorming session before committing.

---

## EI-1 — Usage / expense tracking + projections

**Status:** `park` (projection sub-part flagged)

Extend cost visibility from per-run (already promised by NFR-5: "the report surfaces what a run actually cost") into a **longitudinal cost view** — spend trended over time, living alongside the longitudinal quality pillar (FR-14–17). A natural fourth lens on the "quality story over time."

- **Fits:** NFR-5 (cost governance), FR-30 (dashboard), pillar C (longitudinal memory).
- **Open question:** *Projections* require a cost model (estimated tokens per axiom × diff size). Tracking historical spend is cheap; forecasting future spend is real work. Consider shipping tracking first, projection later.

## EI-2 — Compliance agent (HIPAA, GDPR, etc.)

**Status:** `brainstorm`

A genuinely new review responsibility — none of the six axioms cover regulatory/standards conformance (Axiom #5 security is vulnerabilities, not regulatory frameworks). Sibling in spirit to the named-but-unspecified Axiom #7/#8.

- **Why brainstorm first:** framework-specific rule sourcing; high false-positive risk that directly threatens the **<30% noise counter-metric**; detection-method choice (deterministic vs LLM); interaction with the local-first / no-telemetry posture (compliance scanning that never phones home is itself a selling point). Worth pursuing *only if* noise can be bounded.

## EI-3 — User-managed engineering-standards document (precedence over shipped baseline)

**Status:** `park`

A human-authored standards layer that overrides the shipped generic baseline. Clean extension of the existing write-time story:
- FR-38 ships a **generic** baseline (deliberately repo-agnostic).
- FR-39 (post-v1) adds a **Ledger-derived** repo-specific layer.
- This idea adds a **human-authored override** layer.

- **Fits:** FR-37–39, group G (write-time enforcement).
- **Open question:** precedence ordering across the three layers (shipped baseline → mined-Ledger layer → user-authored doc?) and merge/conflict semantics. Small, bounded design decision.

## EI-4 — Self-feeding loop (review → fix → review → … until criteria met)

**Status:** `brainstorm` (highest value, highest risk)

An autonomous convergence loop that fixes findings and re-reviews until a stopping criterion is met.

- **Why brainstorm first:** collides with the architecture's most sacred invariant — *"agents never self-confirm; enforcement is human-granted, machine-revoked."* Needs answers to: convergence/stop criteria; a hard cost ceiling (NFR-5); loop guards against thrash; and **where the human stays in the loop** so this doesn't become silent self-confirmation. Depends on autofix (post-v1).

## EI-5 — Post-implementation spec-drift check (retrofit spec from implementation)

**Status:** `park`

Run **after implementation completes**: derive the *effective* spec/ACs from the shipped code, then compare against the **declared** spec to surface where the implementation drifted from what was asked. The inverse of Axiom #2 — and a complement to it.

- **Why this avoids the tautology trap:** you compare a *derived* spec against a *declared* spec (drift detection), rather than checking code against a spec derived from itself. Two specs, not a circular one.
- **Fits:** pillar B (spec & AC runtime); a candidate new review scope/axiom or a post-run gate.
- **Distinct from:** FR-11's "zero-document path," which builds a spec via *author dialogue* before code exists — this one derives from *finished code* to catch drift.
- **Open question:** how to derive the effective spec reliably; what counts as "drift" vs intentional in-flight scope change; whether this is a new axiom, a new scope, or a post-review gate.

## EI-6 — Trends explorer / human-friendly dashboard (beyond the read-only v1 visualizer)

**Status:** `park`

The architecture ships a **v1 trend visualizer** (`core/report` → self-contained, read-only,
unfiltered static HTML over the committed `trends.jsonl`). This idea extends that into a **proper
explorer**: time-range and per-axiom filtering, regression/threshold alerting, and drill-down from a
trend point to the specific runs and findings behind it.

- **Fits:** pillar C (longitudinal memory, FR-14–17), FR-30 (dashboard); natural companion to
  EI-1 (longitudinal cost view) — both are "the quality/cost story over time."
- **Constraint to preserve:** must stay fully self-contained — no CDN, no network — to keep the
  zero-egress/local-first posture (NFR-10/11). Richer interactivity is fine; phoning home is not.
- **Open question:** once filtering/alerting arrive, does a static regenerated file still suffice, or
  does it justify a local-served interactive app? Decide only when the read-only v1 proves limiting.

---

## Not parked

- **"Does the project classify as a harness?"** — A conceptual question, not an expansion. Answer: partly, and only in CI/headless mode (where it drives its own LLM agents via a direct API adapter). In interactive mode it is a *guest* of the Claude Code harness (delegates LLM execution to the host IDE as skills). The deterministic `core/` is never a harness. So: a verification runtime that takes on a lightweight harness role only in headless mode — not a general-purpose harness.
