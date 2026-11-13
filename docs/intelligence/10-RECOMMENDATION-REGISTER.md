# KeyFlowOS Recommendation Register

Status: PROVISIONAL ARCHITECTURAL RECOMMENDATIONS — NOT IMPLEMENTATION TICKETS

Recommendations are target-state directions supported by findings/contradictions. They remain subject to revalidation, standards research, cross-journey convergence, migration analysis and explicit acceptance.

Do not implement directly from this file.

---

# Recovered recommendations KF-REC-001–018

## KF-REC-001 — One canonical Tenant Genesis contract

**Status:** PROVISIONAL / REVISED BY J25

Establish one semantic Tenant Genesis contract for all business creation/bootstrap entry paths so they satisfy equivalent postconditions.

Required concerns include:

- Business creation;
- founding OWNER Membership;
- ownership semantics;
- onboarding initial state;
- lifecycle event;
- baseline AI/knowledge initialization;
- idempotency/repair.

---

## KF-REC-002 — Membership-first workspace resolution

**Status:** PROVISIONAL / ACTIVE CONVERGENCE

Resolve authorized business/workspace discovery through Membership-first semantics while preserving explicit distinguished ownership meaning and compatibility.

Do not treat browser workspace state as authorization.

---

## KF-REC-003 — Invitation as claim lifecycle

**Status:** PROVISIONAL / STRONGLY SUPPORTED

Replace placeholder-User provisioning with:

```text
Invitation
→ person authenticates
→ verified identity/email claims invitation
→ revalidate authority intent/grantability
→ atomic Membership + position/authority creation
```

An invitation is not a User. It is a claim waiting for an authenticated principal.

---

## KF-REC-004 — Capability-scoped Business self-model authority

**Status:** PROVISIONAL / REFINED BY J25/J2

Differentiate business-information contribution from authoritative mutation of canonical business knowledge, using shared platform capability/principal-authority semantics rather than onboarding-only permission names.

---

## KF-REC-005 — Onboarding completion as a single transition command

**Status:** PROVISIONAL / STRONGLY SUPPORTED

Lifecycle completion should occur through one explicit state transition owning gates, side effects, events and idempotency rather than generic property mutation.

---

## KF-REC-006 — Canonical FactDefinition / normalization boundary

**Status:** PROVISIONAL / KNOWLEDGE-KERNEL PRIORITY

Make one ontology/FactDefinition boundary load-bearing so heterogeneous sources normalize before entering canonical business knowledge.

---

## KF-REC-007 — Fact assertion precedence/conflict resolution

**Status:** PROVISIONAL / STRONGLY SUPPORTED

Separate source assertion from resolved fact and define precedence/conflict policy.

Invariant:

> A weaker assertion must never silently overwrite a stronger verified assertion.

---

## KF-REC-008 — One Genome section-resolution model

**Status:** PROVISIONAL

All Genome scoring/readiness consumers should consume one canonical resolved-fact/section projection so Blueprint fallback and fact-based scoring cannot independently disagree.

---

## KF-REC-009 — Canonical Genome Snapshot

**Status:** PROVISIONAL

Provide one explicit current Genome projection containing knowledge version, computed time, section state, confidence, integrity, stage, readiness, evidence health and gaps.

---

## KF-REC-010 — Trust-aware knowledge/module readiness

**Status:** PROVISIONAL

Readiness should consider trust properties such as confidence, verification, evidence, freshness, dispute/conflict state and risk rather than fact-address/presence alone.

---

## KF-REC-011 — Separate readiness from final action authority

**Status:** PROVISIONAL / STRONGLY SUPPORTED

Do not allow module/knowledge readiness to stand in for final action authorization.

---

## KF-REC-012 — BusinessGenome compatibility projection

**Status:** PROVISIONAL / LEGACY CONSUMER PROOF REQUIRED

If legacy `BusinessGenome` remains necessary, make it a compatibility projection from canonical knowledge rather than a competing mutable truth source; otherwise migrate consumers and retire only after proof.

---

## KF-REC-013 — BusinessGuidanceProfile consumer migration

**Status:** PROVISIONAL / LEGACY CONSUMER PROOF REQUIRED

Map and migrate active consumers toward canonical business knowledge before retiring/freezing `BusinessGuidanceProfile`.

---

## KF-REC-014 — Synthetic examples outside canonical operational truth

**Status:** PROVISIONAL / HIGH PRIORITY

Classify persisted demo/onboarding/synthetic records and exclude them by default from financial truth, analytics, Business Graph learning, Genome and readiness.

---

## KF-REC-015 — Live storefront/public asset as Business Birth activation proof

**Status:** PROVISIONAL PRODUCT RECOMMENDATION

Surface a real customer-visible activation asset earlier in Business Birth when safely configured.

---

## KF-REC-016 — Explicit committed lifecycle events

**Status:** PROVISIONAL

Consolidate explicit committed-state lifecycle events for material transitions with stable identity and provenance.

---

## KF-REC-017 — Architecture provenance/supersession metadata

**Status:** PROVISIONAL / PERSISTENCE-ARCHITECTURE SUPPORT

Track canonical, historical, compatibility-only, superseded and revalidation status so future agents cannot silently resurrect stale architecture.

---

## KF-REC-018 — Retire ineffective/legacy concepts only after consumer proof

**Status:** PROVISIONAL / METHODOLOGICAL

Do not delete weak/legacy lifecycle fields/models merely because they appear conceptually obsolete. Prove consumers, migration, data compatibility and tests first.

---

# Current pooled kernel recommendations KF-REC-019+

These IDs are newly assigned by the current Journey Mesh programme. They are not recovered historical IDs.

## KF-REC-019 — Make CapabilityContractService load-bearing

**Status:** PROVISIONAL / STRONGLY SUPPORTED

**Primary kernel:** K5 Capability Fabric

Strengthen the existing `CapabilityContractService` before creating a parallel registry.

Every material business action should resolve to one versioned capability definition containing, as appropriate:

- stable identity/version;
- normalized input/output schema;
- permission identity;
- inherent impact classification;
- readiness prerequisites;
- control-policy metadata;
- execution mode;
- idempotency/compensation characteristics;
- changed entities.

The same capability identity must survive proposal → governance → control evidence → clearance → execution → outcome.

**Do not:** build `ActionRegistry2` while a coherent existing seam can be evolved.

---

## KF-REC-020 — Canonical capability/permission vocabulary

**Status:** PROVISIONAL / STRONGLY SUPPORTED

**Primary kernels:** K2 Human Authority, K5 Capability Fabric

Converge coarse module-scope vocabularies and fine capability permissions onto one versioned machine-resolvable authorization vocabulary.

UX/module groupings may remain as adapters. They must not independently define authority semantics.

---

## KF-REC-021 — Effective Authority Resolver

**Status:** PROVISIONAL / HIGH-LEVERAGE TARGET

**Primary kernel:** K2 Human Authority & Organization

Create one explainable boundary that resolves effective authority for the exact principal/business/capability/resource context.

Candidate composition:

```text
Membership relationship/base role
+ active JobRole/OrgAssignment
+ explicit bounded grants/overrides
+ valid bounded delegation
- explicit denials
∩ business/resource/value/time/capability/policy constraints
→ EffectiveAuthorityResult
```

Result should distinguish at least:

- canRequest;
- canExecute;
- canApprove;
- canDelegate;
- effectiveApprovalTier;
- provenance;
- bounds;
- principal class/assurance;
- authorityVersion/fingerprint.

JobRole authority should be resolved rather than destructively copied into Membership as final truth.

---

## KF-REC-022 — Enforce grantability and delegation bounds

**Status:** PROVISIONAL / STRONGLY SUPPORTED

**Primary kernel:** K2 Human Authority

Universal law:

```text
granted/delegated authority <= grantor/delegator grantable authority
```

Grantor identity must be server-derived from the authenticated/effective principal where relevant, not trusted from caller payload.

Stored bounds such as value/resource/time must be enforced at the decision boundary or they are metadata, not policy.

---

## KF-REC-023 — Canonical ActionEnvelope + action fingerprint

**Status:** PROVISIONAL / HIGH-LEVERAGE TARGET

**Primary kernels:** K3 Governance, K5 Capability, K8 Evidence

Normalize every proposed material action into an immutable material identity containing:

- business;
- capability name/version;
- normalized parameters;
- affected entities/resources;
- principal lineage/context;
- material impact/policy identity;
- relevant state/version references.

Create a deterministic fingerprint over the material fields.

Material mutation must produce a different fingerprint and invalidate prior exact-action control evidence.

---

## KF-REC-024 — Separate Impact/Risk from Control Requirement

**Status:** PROVISIONAL / STRONGLY SUPPORTED

**Primary kernels:** K3 Governance, K5 Capability

Inherent capability/action impact answers “how consequential is this?”

Control Requirement answers “what control does this invocation require now?”

Candidate control outcomes:

```text
AUTO
DIRECT_HUMAN
QUICK_CONFIRM
FORMAL_APPROVAL
ADMIN_APPROVAL
STEP_UP_AUTH
EXPLICIT_DELEGATION
BLOCK
```

ControlRequirement should consider exact capability, origin, effective human authority, KEY autonomy, readiness, business policy and current context rather than simply map Tier N → fixed approval behavior.

---

## KF-REC-025 — Normalize specialized workflows into typed ControlEvidence

**Status:** PROVISIONAL / STRONGLY SUPPORTED

**Primary kernels:** K3 Governance, K8 Evidence

Do **not** collapse QuickConfirm, KeyActionProposal, ApprovalRequest/ApprovalStep and position-reply workflows into one mega-table.

Instead, let specialized workflow machinery produce normalized evidence such as:

```text
HUMAN_CONFIRMATION
HUMAN_FORMAL_APPROVAL
HUMAN_ADMIN_APPROVAL
POSITION_REPLY_APPROVAL
POLICY_AUTO_APPROVAL
TIMEOUT_AUTO_APPROVAL
AUTHORITY_GRANT_AUTO_APPROVAL
POLICY_THRESHOLD_AUTO_APPROVAL
```

ControlEvidence should bind exact action fingerprint, satisfying principal/provenance, authority/policy version, timestamps/expiry and invalidation state.

---

## KF-REC-026 — Exact-action Clearance with freshness/invalidation semantics

**Status:** PROVISIONAL / HIGH-LEVERAGE TARGET

**Primary kernel:** K3 KEY Authority & Governance

Clearance is the current decision that an exact action is authorized to execute.

Approval is an input/evidence source, not clearance itself.

At clearance issue/consumption, evaluate:

```text
exact action unchanged
+ required ControlEvidence valid
+ effective human authority acceptable
+ delegated/granted provenance still valid
+ KEY autonomy/delegation acceptable
+ readiness/policy acceptable
+ authority/policy versions acceptable
+ not expired/revoked/invalidated
→ CLEARANCE_GRANTED
```

Not every authority change must invalidate every clearance: invalidate only when the changed source was material to that authorization.

---

## KF-REC-027 — Atomic Execution Claim

**Status:** PROVISIONAL / HIGH-LEVERAGE TARGET

**Primary kernel:** K11 Recovery & Reliability

Separate permission to execute from ownership of the execution attempt.

```text
CLEARANCE_GRANTED
→ atomic CLAIMED
→ RUNNING
→ SUCCEEDED | FAILED_RETRYABLE | FAILED_FINAL | OUTCOME_UNKNOWN
```

One system-wide claim should cover proposal races, plan/direct races, queue retries, crash recovery and concurrent idempotency-key callers.

Provider-side idempotency complements but does not replace the internal claim.

---

## KF-REC-028 — Evolve ActionDispatcher into canonical post-clearance dispatcher

**Status:** PROVISIONAL / FAVORABLE EXISTING-SEAM TARGET

**Primary kernels:** K5 Capability, K11 Recovery

Strengthen `ActionDispatcherService` rather than creating a parallel executor.

Its target responsibility begins **after** exact-action clearance and atomic claim admission.

Preserve useful current mechanics such as retries, circuit breaking, logging/events, feedback and undo/compensation hooks while removing parallel raw execution routes as externally reusable governance assumptions.

Low-level domain methods may remain, but callers should not have to remember to reimplement governance.

---

## KF-REC-029 — Hierarchical plan clearance separate from mutable orchestration plan

**Status:** PROVISIONAL / STRONGLY SUPPORTED

**Primary kernels:** K3 Governance, K7 Temporal/Workflow

Do not equate `AiPlan.status = approved` with blanket authorization.

A parent clearance may cover child actions only when they remain inside immutable approved bounds:

- plan version/fingerprint;
- child capability set;
- material parameter/resource/value bounds;
- authority/policy validity.

New/materially changed child actions require independent clearance unless the parent explicitly authorizes that class/bound.

This preserves low-friction UX without allowing mutable plan content to inherit stale approval accidentally.

---

## KF-REC-030 — Exact conversational approval challenge + ingress idempotency

**Status:** PROVISIONAL / STRONGLY SUPPORTED

**Primary kernels:** K3 Governance, K8 Evidence, K11 Recovery

Keep conversational approval as a product advantage, but bind it cryptographically/semantically to one control request.

Candidate flow:

```text
server ControlRequest
→ exact action fingerprint + significant display data + approver + challenge + expiry
→ send message
→ verified provider event
→ atomic inbound event dedupe
→ principal resolution
→ exact challenge match
→ freshness/authority check
→ atomic one-time challenge consumption
→ ControlEvidence
→ Clearance
```

A bare YES/NO against queue position is insufficient.

Selected higher-impact actions may require step-up authentication instead of messaging possession alone.

---

## KF-REC-031 — Control-plane authority proportional to behavior enabled

**Status:** PROVISIONAL / HIGH-PRIORITY SECURITY TARGET

**Primary kernels:** K2 Human Authority, K3 KEY Governance

Treat autonomy ceilings, grants, role/permission design, delegation and similar policy mutations as explicit capabilities.

Invariant:

> Authority to mutate a control policy must be at least as strong as the authority that policy can enable or remove.

Increasing spend/tier/autonomy may require stronger control than narrowing it.

---

## KF-REC-032 — Learning may recommend authority changes, not silently self-grant them

**Status:** PROVISIONAL / STRONGLY SUPPORTED

**Primary kernel:** K3 KEY Governance

Preserve adaptive learning while separating preference evidence from authority.

Target ratchet:

```text
observed approval/outcome history
→ KEY recommendation to alter bounded autonomy policy
→ explain evidence/value/risk
→ authorized human acceptance
→ new policy/authority version
```

Learning may automatically tighten safety where designed; expansion of standing autonomous authority should require an independently authorized transition.

This is both a safety boundary and a product opportunity: KEY can explain why it recommends reducing friction rather than silently changing its own powers.

---

## KF-REC-033 — Explicit principal lineage

**Status:** PROVISIONAL / STRONGLY SUPPORTED

**Primary kernels:** K2 Authority, K8 Evidence

Durably distinguish lifecycle roles such as:

- requestedBy;
- proposedBy;
- approvedBy;
- executedFor;
- claimantExecutor;
- executedBy;
- delegated/grant source.

Do not overload one actor field across human, KEY and worker identities.

---

## KF-REC-034 — Position-bound external human principal with assurance levels

**Status:** PROVISIONAL / PRODUCT + SECURITY TARGET

**Primary kernel:** K2 Human Authority

Model legitimate contact-only organizational approvers without fabricating local Users.

Position-bound authority should require:

- active OrgAssignment;
- current JobRole authority;
- verified channel/contact binding;
- explicit allowed control mechanism;
- proportional assurance for impact.

Messaging-channel possession can support selected controls, but higher-impact controls may require stronger step-up.

---

# Recommendation promotion rule

A recommendation becomes execution-ready only after:

1. current implementation revalidation;
2. relevant journey/kernel evidence is sufficiently complete;
3. applicable standards/reference systems are researched;
4. contradictions are reconciled or explicitly accepted;
5. current/minimum/strong/advanced/innovation alternatives are compared;
6. migration and legacy consumers are understood;
7. the target survives backward replay through affected journeys;
8. the user explicitly accepts the direction where product philosophy is required;
9. a `KF-EXEC-*` packet identifies dependencies, migration, characterization tests, acceptance/adversarial proof, rollback and observability.

No recommendation is production authorization by itself.
