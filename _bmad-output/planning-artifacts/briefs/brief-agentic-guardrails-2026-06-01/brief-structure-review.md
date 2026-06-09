---
title: 'Structure Review — brief.md'
created: '2026-06-08'
reviewer: 'bmad-editorial-review-structure'
target: 'brief.md'
---

# Structure Review: agentic-guardrails v2 Product Brief

## Document Summary

- **Purpose:** Internal product brief — input material for PRD authoring; not an external pitch
- **Audience:** Internal stakeholders (PM, architect) who will use this to write a PRD
- **Reader type:** Humans
- **Structure model:** Strategic/Context (Pyramid) — conclusion first, supporting context below, MECE groupings
- **Current length:** ~1,545 words across 8 sections

---

## Recommendations

### 1. MOVE — "Who This Serves" from position 5 to position 3 (after The Problem)

**Rationale:** Audience definition is foundational context — a PRD author needs to know *who this is for* before they can evaluate whether the Problem and Solution framings are correctly scoped; placing it fifth means the first 660 words are absorbed without an anchored user model.

**Impact:** 0 words saved (pure reorder); significant comprehension gain for the downstream PRD author.

---

### 2. CONDENSE — Executive Summary paragraph 2 (competitive-positioning argument)

**Rationale:** The second paragraph of the Executive Summary re-states the full competitive-positioning argument (not bug/security; the hard problems are AC misses and convention drift; convention drift is the real differentiator) that is then developed in full in "What Makes This Different" — this is true redundancy, not reinforcing summary; a single orienting sentence is sufficient here.

**Impact:** ~120 words saved (~8% of total).

**Suggested replacement direction:** Reduce paragraph 2 to one sentence that signals the differentiation without arguing it — e.g., "The differentiator is not bug-catching; it is detecting the two failure modes that look fine on a skim: whether the code does what was asked, and whether it fits how this codebase works." Full argument lives in "What Makes This Different."

---

### 3. CONDENSE — "What Makes This Different" opening meta-commentary paragraph

**Rationale:** The section opens with ~35 words of scaffolding prose ("Two distinct claims are worth separating here, because they answer different questions") before delivering either claim; this framing adds latency without adding content, and can be replaced by two subheadings.

**Impact:** ~35 words saved.

**Suggested replacement direction:** Replace the opening paragraph with two explicit subheadings — e.g., `### AC-Compliance: Centering the painful failure mode` and `### Codebase-Conformance Corpus: The actual defensible differentiator` — and drop the preamble entirely.

---

### 4. CONDENSE — First-person author notes in "What Makes This Different"

**Rationale:** Phrases like "the author has personally experienced," "to the best of current market knowledge," and "Honest framing for the brief, and for whoever reads it next" read as thinking-aloud marginalia; for a document feeding a PRD, these should become declarative statements so the content is actionable rather than hedged.

**Impact:** ~40 words saved across the section.

**Examples:**
- "the author has personally experienced" → "the team has directly observed" (or just state the finding without attribution)
- "to the best of current market knowledge" → "market research surfaced no competitor..." (already stated one sentence later — the hedge is redundant)
- "Honest framing for the brief, and for whoever reads it next:" → delete; the content that follows stands on its own

---

### 5. QUESTION — Vision section scope and specificity

**Rationale:** The Vision section names specific future features (onboarding/refresher mode, multi-language support) at a level of detail that overlaps with roadmap artifacts; the brief's Scope section already draws the v1 boundary cleanly, and the Vision section's concrete extensions may belong in a separate roadmap note rather than the brief itself — author should decide whether this level of specificity adds value for the PRD author or risks scope confusion.

**Impact:** ~120 words if cut entirely; ~60 words if trimmed to the aspirational closing paragraph only.

**Options:**
- **Keep as-is** if the PRD author needs to see the 3-year direction to make v1 scoping decisions.
- **Trim to the final paragraph only** ("If this works, agentic-guardrails becomes more than a review gate...") if the concrete extensions belong in a roadmap doc.
- **Move to a linked roadmap note** and replace the section with a one-line pointer.

---

### 6. CONDENSE — "What Makes This Different" prose density

**Rationale:** Both differentiator claims are written as long prose paragraphs; the section is the densest read in the document and the most likely to be skimmed rather than read, which is the opposite of what the content warrants — bullet structure or bold leads for each claim would improve scanability.

**Impact:** 0 words saved (structural reformat only); substantial readability gain for the most critical section.

**Suggested replacement direction:** Each claim (AC-compliance positioning + corpus/ledger moat) gets a bolded lead sentence followed by 2–3 supporting bullets, matching the style already used effectively in "The Problem."

---

### 7. PRESERVE — "The Problem" two-bullet structure with named failure modes

**Rationale:** The named, bolded failure modes (Acceptance-Criteria misses / Convention drift) with concrete examples are high-value scaffolding for the PRD author — they ground abstract claims in tangible consequences and should not be cut for brevity.

**Impact:** 0 words; flagged to prevent over-editing.

---

### 8. PRESERVE — Success Criteria self-evidencing framing

**Rationale:** The "self-evidencing" success criterion (the ledger's own trend data as proof) is a genuine insight that differentiates this brief from generic "time saved" metrics — it should be kept even if the surrounding prose is tightened.

**Impact:** 0 words; flagged to prevent over-editing.

---

## Summary

- **Total recommendations:** 8 (4 CONDENSE, 1 MOVE, 1 QUESTION, 2 PRESERVE)
- **Estimated reduction:** ~315 words if all CONDENSE items accepted and Vision trimmed (~20% of original)
- **Meets length target:** No target specified
- **Comprehension trade-offs:** None of the CONDENSE or MOVE recommendations sacrifice comprehension aids — the two PRESERVE flags protect the most important human-reader elements. The QUESTION on Vision is the only recommendation with a meaningful content trade-off, and the decision is left to the author.
