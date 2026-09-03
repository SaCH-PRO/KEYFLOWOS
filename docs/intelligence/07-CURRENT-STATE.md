# KeyFlowOS Current State

Last updated: 2026-09-03

## Analytical phase

`COMPUTABLE_DIGITAL_TWIN / JOURNEY_KERNEL_CONVERGENCE`

## Status

`J15 L4 SEMANTICALLY RECONCILED — J6 ADMITTED AS GOVERNANCE/AUTONOMY STRESS TEST`

Production implementation remains blocked.

Context integrity: `PASS`

## Implementation evidence baseline

Current revalidated `main` baseline:

`d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

The latest movement from the earlier code-bearing baseline was audit-only in the inspected range. Revalidate again if `main` materially advances.

## Canonical operating model

```text
25 JOURNEYS
  = vertical end-to-end business/system views

12 KERNELS
  = horizontal shared architecture

JOURNEY MESH + KERNEL MESH
  = computable digital twin
```

Core durable methods:

- `11-RECURSIVE-ASSURANCE-PROGRAMME.md`
- `12-KERNEL-PROGRAMME.md`
- `13-IMPLEMENTATION-HANDOFF-PROTOCOL.md`
- `14-STANDARDS-RESEARCH-INNOVATION-METHOD.md`
- `15-EXPORTABLE-DIGITAL-TWIN-SPEC.md`
- `16-KEYFLOWOS-ARCHITECT-AGENT-CONTRACT.md`

Prime thesis:

> KeyFlowOS is a governed business-state transition system.

Working causal model:

```text
External reality
→ observation/signal
→ Business Graph
→ Genome interpretation
→ KEY reasoning
→ CapabilityContract
→ ActionEnvelope
→ Effective Human Authority + KEY autonomy + readiness + policy
→ ControlRequirement
→ ControlPresentation
→ specialized control workflow/channel
→ typed ControlEvidence
→ exact-action Clearance
→ atomic ExecutionClaim
→ canonical post-clearance ActionDispatcher
→ domain/provider execution
→ durable OutcomeEvidence
→ Business Graph
→ Genome evolution
```

## Active constellation

```text
J1 Business Birth
  ↕
J25 Human Authority Lifecycle
  ↕
J2 KEY Request → Governed Action
  ↕
J15 Approval / Governance Lifecycle
  ↕
J6 Proactive KEY / Autonomy  ← admitted for stress-test scoping
```

J6 is not an independent expansion. It must stress the shared governance model and feed findings back into J15/J2/J25/J1.

## Active kernels

Highest current activity:

- K1 Tenant Genesis & Identity
- K2 Human Authority & Organization
- K3 KEY Authority & Governance
- K5 Capability Fabric
- K6 State Transition
- K7 Temporal / Event / Workflow
- K8 Evidence & Outcome
- K11 Recovery & Reliability

## J15 maturity

`L4 SEMANTICALLY RECONCILED / ENTERING L5 VALUE-ENGINEERED`

J15 is not closed and not target-converged. Its remaining major questions are target/migration questions rather than undefined foundation:

1. final migration relationship among AiApprovalItem, KeyActionProposal and ApprovalRequest after shared ControlEvidence exists;
2. persistence shape for ControlEvidence / Clearance / ExecutionClaim;
3. complete mapping of manual direct actions intentionally outside proposal workflows;
4. invalidation strategy: event-driven vs evaluation-time authority/policy fingerprints vs hybrid;
5. AutopilotSettings vs BusinessAutonomyProfile target convergence;
6. step-up-auth policy by capability/impact/origin;
7. ControlPresentation/channel rules;
8. migration sequencing preserving live approval UI and compatibility consumers.

J15 dossier:

`journeys/KF-JOURNEY-015-APPROVAL-GOVERNANCE-LIFECYCLE.md`

## Current finding state

Historical recovered findings: `F003–F043`.

Current revalidated findings now extend through `F089`.

Canonical storage:

- `08-FINDING-REGISTER.md` through F084;
- `08A-FINDING-REGISTER-CURRENT-SUPPLEMENT.md` for F085–F089 and lifecycle corrections.

Important newest findings:

- F076: real plan-step Tier 3/4 risk can collapse to MEDIUM under EXECUTE_TOOL proposal wrapper;
- F077: proposal execution re-evaluates wrapper identity before unwrapping exact tool;
- F078: executing plans can acquire new AI-generated child steps after approval;
- F079: bare YES/NO reply is not exact approval/action-bound;
- F080: staff approval reply is processed before inbound event dedupe;
- F081: approved proposal has no observed human-authority version/approval expiry binding;
- F082: delegation expiry does not invalidate already-routed AiApprovalItem;
- F083: BusinessAutonomyProfile hard-safety mutation uses only broad Business access;
- F084: approval-history learning can automatically raise standing KEY maxAutoTier up to tier 2;
- F085: `team:write` can construct authority stronger than the caller through multiple paths;
- F086: ending/deleting OrgAssignment leaves copied Membership authority behind;
- F087: KEY Action approval can occur without viewing significant structured action data;
- F088: ApprovalRequest payload is available to client but not rendered;
- F089: AI Plan approval omits exact tool/input payload already available to browser.

Finding lifecycle corrections:

- the old invitation “unavoidable email conflict” conclusion is `NARROWED / PARTIALLY SUPERSEDED` by current transactional `reconcileUserId()` behavior;
- F067 quick-confirm is `RE-ANALYZED / NARROWED`: shipped client displays/passes the same action object and Flow re-governs; remaining defect is durable server-side exact-action binding.

## Contradiction state

Historical contradictions: `C005–C021`.

Current contradictions now extend through `C051`.

Canonical storage:

- `09-CONTRADICTION-REGISTER.md` through C047;
- `09A-CONTRADICTION-REGISTER-CURRENT-SUPPLEMENT.md` for C048–C051.

Newest contradiction themes:

- authority editor vs alternate `team:write` authority constructors;
- backend-significant structured payload vs human-visible approval data;
- KeyActionProposal convergence direction vs live AiApprovalItem UI;
- optional detail availability vs actual authorization-moment acknowledgement.

## Current pooled recommendations

`10-RECOMMENDATION-REGISTER.md` now contains current provisional recommendations through `KF-REC-034`.

Highest-leverage current directions:

```text
KF-REC-019 load-bearing CapabilityContractService
KF-REC-020 canonical capability/permission vocabulary
KF-REC-021 Effective Authority Resolver
KF-REC-022 bounded grantability/delegation
KF-REC-023 ActionEnvelope + fingerprint
KF-REC-024 Impact/Risk != ControlRequirement
KF-REC-025 typed ControlEvidence from specialized workflows
KF-REC-026 exact-action Clearance + invalidation
KF-REC-027 atomic ExecutionClaim
KF-REC-028 ActionDispatcher as post-clearance seam
KF-REC-029 hierarchical plan clearance
KF-REC-030 exact conversational challenge + ingress idempotency
KF-REC-031 proportional control-plane authority
KF-REC-032 learning recommends authority changes; does not self-grant
KF-REC-033 explicit principal lineage
KF-REC-034 position-bound external human principal + assurance levels
```

All remain recommendations, not execution authorization.

## External standards / reference properties incorporated

Current research has cross-referenced:

- OWASP Authorization guidance;
- OWASP Transaction Authorization guidance;
- OWASP GenAI Excessive Agency / agent controls;
- NIST SP 800-63B-4 out-of-band/replay-resistance principles;
- Kubernetes RBAC anti-escalation `escalate`/`bind` semantics;
- provider retry/idempotency behavior such as Twilio webhook retries.

These are design properties to adapt, not systems to cargo-cult.

## J6 admission purpose

J6 must stress-test whether the J15/J2 governance model works when there is **no fresh human command initiating the action**.

Priority J6 questions:

```text
What causes KEY to act proactively?
What principal/origin does a proactive action run for?
Which standing authority actually permits it?
How is capability identity resolved?
Which readiness/business-state evidence is required?
How do autonomy settings/profile/grants interact?
Can learning expand authority?
How is spend/action budget enforced before side effects?
What control is required when origin is proactive rather than direct-human?
What stops/revokes in-flight or queued proactive work?
Does every proactive effect pass Clearance + ExecutionClaim + Dispatcher?
What OutcomeEvidence feeds future learning?
```

## Immediate next work

1. open/revalidate J6 dossier;
2. map every proactive trigger/scheduler/listener/watch mechanism;
3. trace Autopilot / DelegationLoop / KeyCortex proactive paths;
4. map AutopilotSettings vs BusinessAutonomyProfile vs AuthorityGrant hierarchy;
5. trace proactive principal lineage and capability identity;
6. test spend/action caps including estimated-cost plumbing;
7. map proactive governance/approval paths;
8. map execution gateway/claim/retry/recovery;
9. map outcome/learning feedback;
10. cross-reference findings back into J15/J2/J25 and relevant kernels;
11. apply L0→L5 standards/reference/innovation assessment;
12. keep all outputs exportable/machine-readable.

## Do not yet

- modify production code;
- freeze target persistence schemas;
- turn recommendations directly into implementation packets;
- create v2 capability/authority/approval/dispatcher systems before existing seams are disproven;
- remove legacy approval models without consumer proof;
- allow J6 to redefine settled distinctions silently—explicitly reopen prior journeys/kernels when evidence demands it;
- claim tests/runtime behavior unless actually executed.
