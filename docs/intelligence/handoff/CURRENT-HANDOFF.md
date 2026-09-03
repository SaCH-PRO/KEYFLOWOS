# KeyFlowOS Current Handoff

Last updated: 2026-09-03

## Load first

Read `docs/intelligence/00-START-HERE.md`, then the canonical files it lists.

Especially load:

- `docs/intelligence/11-RECURSIVE-ASSURANCE-PROGRAMME.md`
- `docs/intelligence/12-KERNEL-PROGRAMME.md`
- `docs/intelligence/13-IMPLEMENTATION-HANDOFF-PROTOCOL.md`
- `docs/intelligence/investigations/J1-J25-J2-CONVERGENCE-TENANCY.md`
- `docs/intelligence/investigations/J1-J25-J2-CONVERGENCE-AUTHORITY.md`
- `docs/intelligence/investigations/J1-J25-J2-CONVERGENCE-EXECUTION.md`
- `docs/intelligence/journeys/KF-JOURNEY-015-APPROVAL-GOVERNANCE-LIFECYCLE.md`
- `docs/intelligence/investigations/J15-APPROVAL-EVIDENCE-AND-INVALIDATION.md`
- `docs/intelligence/investigations/J15-APPROVAL-REGIME-CONVERGENCE.md`

## Context integrity

`PASS`

## Implementation evidence baseline

`main` at `e1203b34d0b3091a73657dc358508d7a14109575`

Revalidate if `main` materially advances before using commit-sensitive implementation facts.

## Analytical state

```text
J1 Business Birth
  ↕
J25 Human Authority Lifecycle
  ↕
J2 KEY Request → Governed Action
  ↕
J15 Approval / Governance Lifecycle
```

J15 is **ACTIVE FORENSICS**, not merely ready for scoping.

Production implementation is **NOT AUTHORIZED**.

## Digital-twin structure

The programme now uses:

```text
25 vertical journey dossiers
+ 12 horizontal architectural kernels
+ recursive constellation re-audit
```

The kernel catalogue is defined in `12-KERNEL-PROGRAMME.md`.

Active/high-leverage kernels are currently K1 Tenant/Identity, K2 Human Authority, K3 KEY Governance, K5 Capability Fabric, K6 State Transition, K8 Evidence/Outcome and K11 Recovery/Reliability.

## Current architectural direction

```text
CapabilityContract
-> ActionEnvelope
-> action fingerprint
-> EffectiveAuthority + KEY autonomy + readiness/policy
-> ControlRequirement
-> specialized approval/confirmation workflow as needed
-> normalized ControlEvidence
-> exact-action Clearance
-> atomic ExecutionClaim
-> ActionDispatcher
-> domain/provider execution
-> durable Outcome/Evidence
-> Business Graph / Genome evolution
```

Important distinctions:

```text
Membership relationship != final effective authority
routing != authority
impact/risk != control requirement
approval != clearance
workflow state != normalized control evidence
clearance != execution claim
idempotency != atomic execution ownership
workflow actionType != exact Capability identity
```

## J15 regime convergence

Current classification:

1. **Control requirement resolver** — AiOversight / AutonomyOrchestrator.
2. **Single-action proposal/control workflow** — KeyActionProposal + KeyCortexApprovalOrchestrator.
3. **Multi-step human approval workflow** — ApprovalRequest + ApprovalStep.
4. **Approval routing** — ApprovalRouting + DelegationRule + JobRole.
5. **Normalized ControlEvidence** — missing target primitive.
6. **Clearance** — missing target primitive.

Do not collapse all specialized workflow records into one mega-table.

## Current findings / contradictions

Historical findings recovered through F043.

Current investigation findings now extend through `F075`.

Historical contradictions recovered through C021.

Current contradiction candidates extend through `C039`.

Important: F044–F075 and C022–C039 are not yet fully pooled into the canonical global registers. They live in the convergence/J15 investigation artifacts and require a formal pooling pass.

## J15 key recent conclusions

- normal logged-in AiApprovalItem resolution does not enforce routed approver identity;
- contact-only OrgAssignments can satisfy some approvals without User/Membership;
- AiApprovalItem pending resolution lacks atomic expected-state CAS;
- AiApprovalItem resolution and plan-step release are separate writes;
- low-tier stale approvals may be autonomously approved after timeout;
- AiApprovalItem remains live despite proposal migration direction;
- plan approval and approval-item authority semantics differ;
- Flow quick-confirm is not bound to a durable immutable server-side pending action;
- current approval artifacts lack a canonical exact-action fingerprint;
- KeyCortexApprovalOrchestrator is a useful convergence seam but not a complete governance boundary;
- ApprovalRequest is a legitimate multi-step workflow primitive;
- ApprovalRequest progression is transactionally grouped but still lacks observed expected-state ownership CAS;
- ApprovalRequest delegation does not centrally prove delegate authority/grantability;
- threshold approval derives amount heuristically from payload;
- ApprovalRequest shadow proposal state is not synchronized after creation;
- proposal actionType is governance choreography, not a reliable exact capability identity.

## Principal model refinement

Membership-first human authority remains appropriate for authenticated workspace humans, but J15 proves it is not sufficient for every approver.

Working distinction:

```text
AuthenticatedHumanPrincipal
  = User + Membership

PositionBoundHumanPrincipal
  = active OrgAssignment
  + verified contact/channel identity
  + JobRole authority
```

Position-bound external approval requires strong channel/principal verification and exact business binding.

## Exact next actions

Remain in read-only architecture/research mode.

1. Trace proposal capability/risk derivation, wrapper behavior, confirm booleans, action mutation and CAS semantics.
2. Trace reply-channel identity proof into `resolveApprovalByAssignment` including spoof/replay/business binding.
3. Trace all post-approval material writes to AiPlan/AiPlanStep.
4. Trace expiry/revocation/invalidation across approvals, AuthorityGrant and DelegationRule.
5. Trace control-plane authority for autonomy/governance/role/grant mutation.
6. Trace frontend approval/confirmation evidence and stale-tab/version behavior.
7. Pool F044–F075 into the finding register.
8. Pool C022–C039 into the contradiction register.
9. Update mature recommendation candidates.
10. Build dedicated dossiers for the active kernels and link their journey impact.
11. Re-run J1/J25/J2 implications after each material J15/kernel refinement.

## Implementation protocol

When a cluster becomes execution-ready, do not hand a coding agent a vague request.

Use `13-IMPLEMENTATION-HANDOFF-PROTOCOL.md` to issue bounded `KF-EXEC-*` packets including objective, evidence, accepted invariant, affected journeys/kernels, target contract, prohibited shortcuts, migration, proof ratchets and return evidence requirements.

Claude Code is the preferred primary implementer. Kimi/Gemini may act as independent adversarial reviewers. GitHub remains the implementation source of truth.

## Constraints

- no production code modification until explicitly authorized;
- no parallel v2 source of truth without disproving existing seams;
- no legacy deletion without consumer proof;
- no claim that tests passed unless executed;
- preserve current reality vs target architecture;
- preserve evidence → interpretation → decision;
- propagate important kernel findings through every affected journey;
- convergence, not file count or finding count, is progress.
