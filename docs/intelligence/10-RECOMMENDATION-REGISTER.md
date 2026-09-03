# KeyFlowOS Recommendation Register

Status: PROVISIONAL ARCHITECTURAL RECOMMENDATIONS — NOT IMPLEMENTATION TICKETS

These recommendations were recovered from prior journey work. They remain subject to revalidation, cross-journey convergence and explicit target-state acceptance.

Do not implement directly from this file.

---

## KF-REC-001 — One canonical Tenant Genesis entry point

**Status:** PROVISIONAL / REVISED BY J25

Establish one semantic Tenant Genesis contract for business creation/bootstrap so all entry paths satisfy equivalent postconditions.

Recovered later revision: Tenant Genesis must include the founding OWNER authority envelope, not merely Business-row creation.

Expected concerns:

- Business creation
- founding Membership
- ownership semantics
- onboarding initial state
- lifecycle event
- baseline initialization
- idempotency / repair

---

## KF-REC-002 — Membership-first workspace resolution

**Status:** PROVISIONAL / ACTIVE CONVERGENCE

Resolve authorized business/workspace discovery through Membership-first semantics while preserving explicit ownership meaning and compatibility.

Do not treat browser `kf_business_id` as authorization.

---

## KF-REC-003 — Repair invitation provisioning/landing

**Status:** PROVISIONAL / REFINED

Move from placeholder User creation toward a first-class invitation claim lifecycle:

`Invitation -> authenticated identity proves claim -> Membership`.

Preserve intended role/scopes/maxApprovalTier during claim and migrate existing placeholder identities safely.

---

## KF-REC-004 — Capability-scoped Business self-model authority

**Status:** PROVISIONAL / REFINED BY J25/J2

Differentiate business-information contribution from authoritative mutation of canonical business knowledge.

Recovered revision: converge this on platform capability/principal-authority semantics rather than inventing isolated onboarding-only permission names.

---

## KF-REC-005 — Onboarding completion as a single transition command

**Status:** PROVISIONAL / STRONGLY SUPPORTED

Lifecycle completion should occur through one explicit command/state transition that owns gates, side effects, events and idempotency rather than generic field patching.

---

## KF-REC-006 — Canonical FactDefinition / normalization boundary

**Status:** PROVISIONAL / KNOWLEDGE-KERNEL PRIORITY

Introduce or make load-bearing a central ontology/FactDefinition boundary that normalizes source-specific signals before they participate in canonical business knowledge.

Candidate definition concerns:

- key/section/domain/field
- value schema
- aliases/source mappings
- risk if wrong
- freshness
- module/readiness impact
- verification policy

---

## KF-REC-007 — Fact assertion precedence/conflict resolution

**Status:** PROVISIONAL / STRONGLY SUPPORTED

Separate assertion from resolved fact and define precedence/conflict rules.

Working invariant:

> A weaker assertion must never silently overwrite a stronger verified assertion.

---

## KF-REC-008 — Reconcile Genome scoring through one section-resolution model

**Status:** PROVISIONAL

All Genome scoring/readiness consumers should consume one canonical resolved-section/fact projection so Blueprint fallback and fact-based scoring do not disagree.

---

## KF-REC-009 — Canonical Genome Snapshot

**Status:** PROVISIONAL

Provide one explicit current Genome projection containing knowledge version, computed time, section scores/state, confidence, integrity, stage, readiness, evidence health and gaps.

---

## KF-REC-010 — Trust-aware knowledge/module readiness

**Status:** PROVISIONAL

Readiness should consider more than address/presence. Candidate trust dimensions include nonempty value, confidence, verification, evidence, freshness, dispute/conflict state and risk.

---

## KF-REC-011 — Separate knowledge readiness from final action authority

**Status:** PROVISIONAL / DEPENDS ON J2

Do not allow a module-readiness flag to stand in for safe execution authorization.

Recovered revision: this recommendation depends directly on the governed-action clearance architecture.

---

## KF-REC-012 — BusinessGenome compatibility projection

**Status:** PROVISIONAL / LEGACY CONSUMER PROOF REQUIRED

If legacy `BusinessGenome` remains necessary, make it a compatibility projection from canonical modern knowledge rather than a competing mutable truth source; otherwise migrate consumers and retire it only after proof.

---

## KF-REC-013 — BusinessGuidanceProfile consumer migration

**Status:** PROVISIONAL / LEGACY CONSUMER PROOF REQUIRED

Map and migrate active consumers toward canonical business knowledge before retiring or freezing `BusinessGuidanceProfile`.

---

## KF-REC-014 — Synthetic examples out of canonical operational truth

**Status:** PROVISIONAL / HIGH PRIORITY

Classify persisted demo/onboarding/synthetic data and exclude it by default from financial truth, analytics, Business Graph learning, Genome and readiness decisions.

---

## KF-REC-015 — Live storefront as Business Birth activation proof

**Status:** PROVISIONAL PRODUCT RECOMMENDATION

Surface the first customer-visible asset earlier in onboarding/Business Birth when safe, such as storefront/public booking preview/share/publish.

---

## KF-REC-016 — Explicit lifecycle events

**Status:** PROVISIONAL

Introduce or consolidate explicit committed lifecycle events for material state transitions such as tenant/business birth and onboarding completion, with stable identity and provenance.

---

## KF-REC-017 — Architecture provenance/supersession metadata

**Status:** PROVISIONAL / PERSISTENCE-ARCHITECTURE SUPPORT

Track when concepts/models/docs are canonical, historical, compatibility-only, superseded or pending revalidation so agents do not resurrect stale architecture.

---

## KF-REC-018 — Retire ineffective lifecycle concepts only after consumer proof

**Status:** PROVISIONAL / METHODOLOGICAL

Do not delete weak/legacy lifecycle fields/models merely because they appear conceptually obsolete. First prove active consumers, migrations, data compatibility and test impact.

---

## Recovered post-J1/J2/J25 directions not assigned historical recommendation IDs

These should not be assigned fabricated historical `KF-REC-019+` IDs until explicitly accepted as new recommendations.

### Strengthen CapabilityContractService

Working direction: evaluate making the existing capability contract seam load-bearing across proposal/governance/execution rather than building a replacement registry.

### Effective Authority Resolver

Working direction: centralize explainable human-authority algebra over Membership, base role, JobRole/position, grants/overrides, denials, delegations, approval tier and capability/resource context.

### Exact-action clearance

Working direction: bind approval/authorization to material capability identity/version and normalized parameters through an action fingerprint and explicit validity/invalidation rules.

### Atomic Execution Claim

Working direction: distinguish permission to execute from exclusivity to consume that permission, with a concurrency-safe claim lifecycle.

### Canonical post-clearance dispatcher

Working direction: evaluate strengthening `ActionDispatcherService` as the common post-clearance executor, while preserving useful retries/circuit-breaker/idempotency/logging/undo semantics.

### Hierarchical plan clearance

Working direction: allow parent-plan approval to cover child actions only within immutable approved capability/parameter bounds.

### Principal lineage

Working direction: durably preserve requestedBy/proposedBy/approvedBy/executedBy/executedFor/delegatedBy.

---

## Recommendation promotion rule

A recommendation becomes an execution-ready architectural decision only after:

1. current implementation revalidation;
2. relevant journey evidence is complete enough;
3. contradictions are reconciled;
4. interactions with other journeys/kernels are tested conceptually;
5. target-state alternative(s) are compared;
6. user explicitly accepts the direction;
7. an execution packet identifies migrations, compatibility, tests and proof criteria.
