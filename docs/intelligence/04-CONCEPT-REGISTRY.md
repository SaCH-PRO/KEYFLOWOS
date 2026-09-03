# KeyFlowOS Concept Registry

Status: INITIAL CANONICAL REGISTRY

This registry gives important KeyFlowOS concepts stable identifiers and definitions. Definitions may evolve only through explicit review and should reference decisions when changed materially.

---

## KF-CONCEPT-001 — Business Genesis

**Status:** CANONICAL

The structured formation/discovery process that turns founder/operator intent, answers, context, and evidence into machine-usable business understanding.

**Not equivalent to:** Business Genome; Business Blueprint; generic onboarding UI.

**Open validation:** whether all onboarding paths semantically belong to Genesis and whether all Genesis write paths produce equivalent evidence/confidence semantics.

---

## KF-CONCEPT-002 — Business Blueprint

**Status:** CANONICAL WITH IMPLEMENTATION VALIDATION REQUIRED

A structured representation of business facts used as a major substrate for business understanding and AI grounding.

**Not equivalent to:** Business Genome.

Current implementation stores multiple structured sections and can be updated from onboarding inference and mirrored day-to-day Business profile changes.

---

## KF-CONCEPT-003 — Business Genome

**Status:** CANONICAL

The living, evidence-backed operating DNA of a business: a scored interpretation of structured facts and wider observed business evidence used to determine integrity, readiness, risks, opportunities, recommendations, and safe capability/autonomy boundaries.

**Not equivalent to:** a one-time profile or simple onboarding completeness score.

---

## KF-CONCEPT-004 — Genome Fact

**Status:** CURRENT IMPLEMENTATION CONCEPT

An atomic, business-scoped unit of business knowledge carrying section/domain/field identity, evidence/provenance relationships, and scoring dimensions used by the Genome layer.

---

## KF-CONCEPT-005 — Genome Evidence

**Status:** CURRENT IMPLEMENTATION CONCEPT

Evidence associated with a Genome fact, used to distinguish asserted or inferred knowledge from supported/verified knowledge and to reason about confidence/readiness.

---

## KF-CONCEPT-006 — Living Business Constitution

**Status:** CANONICAL

A versioned, governed expression of the business's evidence-backed operating understanding. It represents operational rules/structure derived from the Genome rather than an arbitrary standalone AI document.

---

## KF-CONCEPT-007 — Business Graph

**Status:** CANONICAL MACRO CONCEPT

The connected operational state of the business: entities, relationships, and business context across domains such as contacts, people, services, products, invoices, bookings, projects, communications, assets, and related records.

The exact implementation boundary of the Graph remains to be mapped.

---

## KF-CONCEPT-008 — Temporal Flow

**Status:** CANONICAL MACRO CONCEPT

The temporal representation of business activity: events, commitments, transitions, histories, urgencies, future obligations, and changing operational state.

---

## KF-CONCEPT-009 — KEY

**Status:** CANONICAL

KeyFlowOS's intelligence/orchestration agent layer. KEY observes business state, builds context, reasons, recommends, and may execute actions when allowed by permissions, evidence, readiness, governance, and risk controls.

**Governing principle:** create intelligence, not unchecked authority.

---

## KF-CONCEPT-010 — Capability / Readiness Gate

**Status:** CANONICAL DIRECTION + CURRENT IMPLEMENTATION

A mechanism that determines whether a business/module has sufficient verified context and readiness to generate, recommend, or autonomously execute a capability.

Current implementation includes Genome three-pillar gating, module readiness, and autonomy-gate behaviour. The full lifecycle consistency remains to be validated.

---

## KF-CONCEPT-011 — Business Birth

**Status:** ACTIVE DEFINITION — BOUNDARIES NOT YET FINAL

The first microscopic KeyFlowOS journey, concerned with the transition from a person/founder without an operational KeyFlowOS business context to a newly established business state that the platform can safely understand and begin operating upon.

**Known:** this is broader than merely inserting a `Business` database row.

**Unresolved:** exact semantic entry and exit conditions, including whether exit requires Blueprint initialization, Genome minimum readiness, Constitution creation, or some lesser safe-operating threshold.

See `journeys/KF-JOURNEY-001-BUSINESS-BIRTH.md` and `KF-Q-002`.

---

## KF-CONCEPT-012 — Implementation Reality

**Status:** METHODOLOGICAL CONCEPT

What the live repository/runtime currently does, regardless of whether that behaviour is intentional, ideal, documented, legacy, duplicated, or incomplete.

Implementation reality must be distinguished from intended architecture.

---

## KF-CONCEPT-013 — Canonical Architecture

**Status:** METHODOLOGICAL CONCEPT

The architecture accepted as the desired, coherent KeyFlowOS model after evidence, implementation reality, product intent, contradictions, and alternatives have been reconciled.

Canonical architecture may differ from current implementation and should only change through explicit decisions.
