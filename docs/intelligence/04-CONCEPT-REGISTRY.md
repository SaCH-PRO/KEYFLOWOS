# KeyFlowOS Concept Registry

Status: CANONICAL + WORKING CONCEPT REGISTRY

This registry gives important KeyFlowOS concepts stable identifiers and definitions. Definitions may evolve only through explicit review and should reference decisions when changed materially.

---

## KF-CONCEPT-001 — Business Genesis

**Status:** CANONICAL

The structured formation/discovery process that turns founder/operator intent, answers, context and evidence into machine-usable business understanding.

**Not equivalent to:** Business Genome, Business Blueprint, generic onboarding UI.

---

## KF-CONCEPT-002 — Business Blueprint

**Status:** CANONICAL WITH IMPLEMENTATION VALIDATION REQUIRED

A structured representation of founder/operator declaration and business configuration: what the operator says or configures about the business.

**Not equivalent to:** resolved operational truth or Business Genome.

---

## KF-CONCEPT-003 — Business Genome

**Status:** CANONICAL

What KEY should currently believe about the business: living evidence-aware interpretation of business knowledge, confidence, readiness, gaps, stage, risk and actionability.

**Not equivalent to:** raw Business Graph, Blueprint declarations, generic database state, one-time onboarding completeness.

---

## KF-CONCEPT-004 — Genome Fact

**Status:** CURRENT IMPLEMENTATION CONCEPT

An atomic business-scoped unit of knowledge currently used by Genome infrastructure. The target ontology/refinement may distinguish observations, assertions, evidence and resolved facts more explicitly.

---

## KF-CONCEPT-005 — Genome Evidence

**Status:** CURRENT IMPLEMENTATION CONCEPT

Evidence/provenance associated with business knowledge, used to reason about support, verification, confidence, freshness and readiness.

---

## KF-CONCEPT-006 — Living Business Constitution

**Status:** CANONICAL

A versioned, governed expression of accepted evidence-backed business understanding and operating rules, downstream of the Business Genome rather than an unrelated generated document.

---

## KF-CONCEPT-007 — Business Graph

**Status:** WORKING CANONICAL MACRO CONCEPT

The complete factual business state KeyFlowOS can legitimately treat as business reality.

Candidate decomposition:

```text
Business Graph
  = Operational Graph
  + Knowledge Graph
  + Evidence Graph
  + Authority Graph
  + Temporal history
```

**Not equivalent to:** Genome, Blueprint, or the Prisma/database schema alone.

---

## KF-CONCEPT-008 — Temporal Flow

**Status:** CANONICAL MACRO CONCEPT

The temporal representation of business activity: events, commitments, transitions, histories, urgencies, long-running processes, future obligations and changing operational state.

---

## KF-CONCEPT-009 — KEY

**Status:** CANONICAL

KeyFlowOS's intelligence/orchestration layer. KEY observes business state, builds context, reasons, proposes/recommends, may plan and may act when appropriately bounded by evidence, readiness, human authority, KEY autonomy/delegation, governance, policy and risk.

**Governing principle:** create intelligence, not unchecked authority.

---

## KF-CONCEPT-010 — Capability / Readiness Gate

**Status:** REFINED DIRECTION

A gate that determines whether sufficient prerequisites exist for a capability to be considered or exercised. Readiness must not be collapsed into one boolean or treated as final authorization.

See `KF-CONCEPT-019 — Readiness Lattice` and `KF-CONCEPT-026 — Clearance`.

---

## KF-CONCEPT-011 — Business Birth

**Status:** ACTIVE CANONICAL JOURNEY CONCEPT — EXIT BOUNDARY NOT YET FROZEN

The transition from prospective/unknown founder state into an operating KeyFlowOS business context.

Recovered refinement identifies interlocking dimensions:

- human identity/authentication birth;
- tenant birth: Business + Membership + founding authority;
- knowledge birth: Blueprint -> observations/assertions/evidence -> Genome;
- operating birth: products/services/hours/public assets/connectors and activation proof.

Then readiness -> Command Center -> operating business.

---

## KF-CONCEPT-012 — Implementation Reality

**Status:** METHODOLOGICAL CONCEPT

What the live repository/runtime currently does, regardless of whether that behavior is intentional, ideal, documented, legacy, duplicated or incomplete.

---

## KF-CONCEPT-013 — Canonical Architecture

**Status:** METHODOLOGICAL CONCEPT

The architecture accepted as the coherent desired KeyFlowOS model after implementation evidence, product intent, contradictions, alternatives and cross-journey effects have been reconciled.

---

## KF-CONCEPT-014 — Observation

**Status:** WORKING KNOWLEDGE-KERNEL CONCEPT

Something seen, stated, imported or inferred about the business before canonical truth resolution.

---

## KF-CONCEPT-015 — Assertion

**Status:** WORKING KNOWLEDGE-KERNEL CONCEPT

A source claims a value or proposition about the business. Multiple assertions may conflict and require resolution.

---

## KF-CONCEPT-016 — Evidence

**Status:** WORKING CANONICAL CONCEPT

Why an assertion/fact should be believed. Evidence supports provenance, verification, confidence, freshness, supersession and risk reasoning.

---

## KF-CONCEPT-017 — Resolved Fact / Canonical Fact

**Status:** WORKING CANONICAL CONCEPT

The ontology-defined business truth KeyFlowOS currently treats as canonical after assertions/evidence are resolved according to policy.

Working invariant: **a weaker assertion must never silently overwrite a stronger verified assertion.**

---

## KF-CONCEPT-018 — Contextual Fact / Signal

**Status:** WORKING CONCEPT

Open-world information useful to KEY reasoning but not sufficiently canonical/trusted to unlock readiness, governance or autonomous action by itself.

---

## KF-CONCEPT-019 — Readiness Lattice

**Status:** WORKING CANONICAL CONCEPT

Separate readiness dimensions:

1. Knowledge Readiness
2. Operational Readiness
3. Connectivity Readiness
4. Compliance Readiness
5. Authority Readiness
6. Action Readiness

Working synthesis:

```text
Knowledge
+ Operational
+ Connectivity
+ Capability
+ Authority
+ Risk Policy
-> Action Readiness
```

Invariant: `onboardingComplete != Genome healthy != module ready != action authorized != automation safe`.

---

## KF-CONCEPT-020 — Genome Snapshot

**Status:** WORKING CONCEPT

A potential canonical projection of current Genome understanding/readiness, including knowledge version, computed time, section state, confidence, integrity, stage, executive/module readiness, evidence health and gaps.

---

## KF-CONCEPT-021 — Membership

**Status:** REFINED WORKING CONCEPT

The canonical tenant relationship between an authenticated human and a business, plus a base human-authority envelope.

Current implementation also uses Membership as a materialized projection/cache of permissions and approval tier. Final source-of-truth vs derived-field semantics remain unresolved.

---

## KF-CONCEPT-022 — Human Authority Envelope

**Status:** WORKING CONCEPT

The effective bounded authority a human possesses in a business context. Inputs may include Membership/base role, JobRole/position, explicit grants/overrides, explicit denials, delegations, approval tier, capability and resource context.

---

## KF-CONCEPT-023 — Effective Authority Resolver

**Status:** WORKING CONCEPT / MISSING CANONICAL IMPLEMENTATION PRIMITIVE

A resolver that produces explainable effective human authority from identity, tenant relationship, role/position, grants/denials/delegations, approval tier, capability, resource/context, validity and revocation.

---

## KF-CONCEPT-024 — Capability

**Status:** WORKING CANONICAL CONCEPT

A stable business-action contract whose identity, version, schemas, impact/risk, permission, approval/control semantics, execution mode, idempotency and changed entities remain recognizable from proposal through execution/outcome.

Current seam to evaluate: `CapabilityContractService`.

---

## KF-CONCEPT-025 — Governed Action Envelope

**Status:** WORKING CONCEPT — NAME NOT FROZEN

A normalized representation of one proposed business action containing exact capability identity, principal/human authority, parameters, knowledge/operating context, policy and clearance metadata.

---

## KF-CONCEPT-026 — Clearance

**Status:** WORKING CANONICAL CONCEPT

The current decision that an exact material action is authorized to execute under current capability, human authority, KEY autonomy/delegation, readiness, policy, approval/confirmation and context.

Approval state alone is not automatically portable clearance.

---

## KF-CONCEPT-027 — Action Fingerprint

**Status:** WORKING CONCEPT

A stable digest binding approval/clearance to the material action, approximately including business ID, capability name/version, normalized parameters, affected entities and risk/impact classification.

Material mutation should invalidate prior clearance.

---

## KF-CONCEPT-028 — Execution Claim

**Status:** WORKING CANONICAL CONCEPT

The concurrency/exclusivity primitive stating which execution process is permitted to consume a granted clearance.

Distinct from clearance:

- Clearance: the action may execute.
- Execution Claim: this execution process is the permitted consumer.

Target lifecycle: `CLEARANCE_GRANTED -> CLAIMED -> RUNNING -> SUCCEEDED|FAILED`.

---

## KF-CONCEPT-029 — Hierarchical Clearance

**Status:** WORKING CONCEPT

A parent plan approval/clearance may authorize child actions without repeated approvals only if the child capability identities and material parameters remain within the exact approved parent bounds.

Material change requires new clearance.

---

## KF-CONCEPT-030 — Principal Lineage

**Status:** WORKING CONCEPT

Explicit provenance across an action lifecycle rather than a single overloaded actor field.

Working fields: `requestedBy`, `proposedBy`, `approvedBy`, `executedBy`, `executedFor`, `delegatedBy`.

---

## KF-CONCEPT-031 — Human Authority vs KEY Autonomy

**Status:** ACCEPTED DISTINCTION

Human permission and KEY autonomy/delegation are separate authority axes. Neither substitutes for the other.

---

## KF-CONCEPT-032 — AuthorityGrant

**Status:** WORKING CONCEPT / EXISTING IMPLEMENTATION SEAM

A bounded authority transfer/delegation concept covering grantor, grantee, capability/scope, resource/value bounds, validity, revocation and provenance.

Working invariant: `grant <= grantor's grantable authority`.

---

## KF-CONCEPT-033 — Synthetic Data Classification

**Status:** WORKING CONCEPT

A universal classification ensuring demo/onboarding/synthetic persisted records do not silently enter financial truth, Business Graph learning, Genome, analytics or readiness as if real.

Candidate classes include `REAL`, `SYNTHETIC`, and potentially additional provenance categories.

---

## KF-CONCEPT-034 — Activation Proof / First Live Asset

**Status:** WORKING PRODUCT CONCEPT

A tangible customer-visible proof that Business Birth has produced real value. Existing storefront/public-booking capability is a candidate: configured asset -> preview -> share/publish -> first live value.

---

## KF-CONCEPT-035 — Impact Tier

**Status:** WORKING CANONICAL DISTINCTION

How consequential/impactful a capability or action is.

**Not equivalent to:** the control requirement for a particular invocation.

---

## KF-CONCEPT-036 — Control Requirement

**Status:** WORKING CANONICAL DISTINCTION

What governance/control an exact invocation requires after considering capability impact, authority, context, readiness, policy and risk.

Candidate outcomes include AUTO, DIRECT_HUMAN, QUICK_CONFIRM, FORMAL_APPROVAL, ADMIN_APPROVAL, STEP_UP_AUTH, EXPLICIT_DELEGATION and BLOCK.

---

## KF-CONCEPT-037 — Business Knowledge Kernel

**Status:** WORKING CROSS-CUTTING KERNEL

The architecture that converts heterogeneous observations/signals into ontology-normalized assertions, evidence and resolved business facts through precedence/conflict-resolution policy.

---

## KF-CONCEPT-038 — Tenant / Identity Kernel

**Status:** WORKING CROSS-CUTTING KERNEL

The architecture covering external auth identity, local User, Business, Membership, ownership, invitation claims, active workspace selection and principal provenance.

---

## KF-CONCEPT-039 — Authority Kernel

**Status:** WORKING CROSS-CUTTING KERNEL

The architecture that resolves effective human authority from tenant relationship, roles/positions, grants, denials, delegations, tiers, capability and resource context.

---

## KF-CONCEPT-040 — Governance / Clearance Kernel

**Status:** WORKING CROSS-CUTTING KERNEL

The architecture that combines exact capability identity, human authority, KEY autonomy/delegation, readiness, policy, approval/confirmation and current context into portable/explainable clearance semantics.

---

## KF-CONCEPT-041 — Execution Claim / Idempotency Kernel

**Status:** WORKING CROSS-CUTTING KERNEL

The architecture providing atomic single-executor claims, retries, provider idempotency, concurrency safety and crash recovery after clearance.

---

## KF-CONCEPT-042 — Evidence / Outcome Kernel

**Status:** WORKING CROSS-CUTTING KERNEL

The architecture ensuring actions and external events produce traceable evidence/outcomes that update Business Graph truth and feed later Genome evolution.
