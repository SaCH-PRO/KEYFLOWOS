# KeyFlowOS Open Questions

Status: ACTIVE REGISTER

Open questions remain explicit until resolved by evidence and/or an accepted decision. When resolved, record the resulting decision ID rather than deleting the question.

---

## KF-Q-001 — Recover or re-establish the full journey catalogue

**Status:** OPEN

The exact `KF-JOURNEY-002+` sequence proposed in the exhausted prior conversation was not reliably recovered.

**Rule:** do not present a newly generated sequence as though it were the original accepted list.

**Resolution paths:**
1. recover the exact prior list from Project/chat history; or
2. deliberately establish a new canonical catalogue with explicit user approval.

---

## KF-Q-002 — What exactly constitutes completion of Business Birth?

**Status:** OPEN — CENTRAL TO KF-JOURNEY-001

Potential semantic exit conditions include:

- a `Business` row exists;
- baseline business configuration/autopilot defaults exist;
- onboarding/Genesis has started or completed;
- a BusinessBlueprint exists;
- minimum Genome facts/evidence exist;
- Three-Pillar Minimum is satisfied;
- initial Living Business Constitution exists;
- KEY possesses a minimum safe operating context;
- some combination of these.

The answer must be derived from product intent + current implementation + downstream capability requirements, not guessed.

---

## KF-Q-003 — Where does Business Birth semantically begin?

**Status:** OPEN

Possible entry states include first anonymous idea entry, signup intent, authenticated user creation, first business-create action, or Genesis initiation. Journey analysis must separate product-semantic entry from implementation entrypoints.

---

## KF-Q-004 — Is generic onboarding a subset of Business Genesis?

**Status:** OPEN

The repository contains ordinary onboarding/concierge behaviour and Business Genesis behaviour. We must determine whether these are distinct stages, overlapping surfaces, legacy/new implementations, or multiple interfaces over the same semantic process.

---

## KF-Q-005 — Do all business-knowledge write paths preserve equivalent evidence semantics?

**Status:** OPEN

Business profile updates, onboarding inference, Genesis answer submission, Genome chat updates, event inference, and other pathways may update Blueprint/Genome state differently. We need to establish provenance, confidence, verification, and scoring consistency.

---

## KF-Q-006 — What current systems are canonical versus legacy or duplicated?

**Status:** OPEN

Known examples include newer Business Command Center behaviour alongside older OS/aggregator surfaces. Similar duplication may exist in onboarding, AI orchestration, events, and readiness logic.

---

## KF-Q-007 — Is KEY's capability/readiness model coherent from birth onward?

**Status:** OPEN

Current implementation includes Genome gates, module readiness, autonomy gating, default trigger settings, approvals, and other controls. The journey model must determine whether a newly created business can enter inconsistent states where technical capability exceeds legitimate knowledge/authority.

---

## KF-Q-008 — Should business creation emit a canonical `business.created` domain event?

**Status:** OPEN

Current implementation evidence indicates `createBusiness()` directly seeds default autopilot configuration because no `business.created` event hook is available. This may be intentional or may reveal a missing domain event. Do not resolve until the Business Birth event model is reconstructed.

---

## KF-Q-009 — What is the authoritative relationship among Business, BusinessBlueprint, GenomeFact, GenomeEvidence, GenomeModuleReadiness, and ConstitutionVersion during initialization?

**Status:** OPEN

This should become an explicit state/mutation graph within KF-JOURNEY-001 rather than remaining an inferred architectural relationship.
