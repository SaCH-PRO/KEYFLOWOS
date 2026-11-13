# KF-KERNEL-003 — KEY Authority & Governance

Status: ACTIVE / ACTIVE CONVERGENCE

## A. Definition / Scope

Owns how KEY is permitted to act: autonomy/delegation, hard safety policy, Control Requirement, approval/confirmation semantics, ControlEvidence, Clearance, invalidation and the relationship between human permission and KEY authority.

## B. Product Intent

KEY should create intelligence and useful action without silently acquiring authority. Low-risk explicit human actions should remain low-friction; high-impact autonomous actions should receive proportional controls.

## C. Truth Ownership

Working separation:

```text
human authority
!= KEY autonomy/delegation
!= business preference
!= learned success
!= routing
!= approval notification
```

Hard safety policy and explicit delegated authority are control inputs. Preferences and AI memory are advisory unless deliberately promoted through a governed policy transition.

## D. Current Implementation Sources

Primary seams include AiOversightService, AutonomyOrchestrator, BusinessAutonomyProfile, AutopilotSettings, AuthorityGrant, KeyActionProposal, AiApprovalItem, ApprovalRequest, KeyCortexApprovalOrchestrator and plan/Flow governance paths.

## E. Inputs

- exact capability invocation;
- human principal/effective authority;
- KEY delegated authority;
- readiness/context;
- hard policy;
- impact/risk;
- action origin;
- existing valid control evidence;
- current authority/policy versions.

## F. Outputs / Consumers

Primary outputs:

- ControlRequirement;
- normalized ControlEvidence;
- Clearance decision;
- invalidation reason;
- explainable governance trace.

## G. State / Transition Semantics

Working lifecycle:

```text
ACTION_IDENTIFIED
-> CONTROL_EVALUATED
-> AUTO_ALLOWED | CONTROL_REQUIRED | BLOCKED

CONTROL_REQUIRED
-> PENDING
-> SATISFIED | REJECTED | EXPIRED | REVOKED | INVALIDATED

SATISFIED
-> CLEARANCE_EVALUATING
-> CLEARANCE_GRANTED | CLEARANCE_DENIED
```

Clearance is still distinct from execution claim.

## H. Journey Impact Matrix

Primary:

- J2 Governed Action
- J6 Proactive KEY
- J15 Approval / Governance
- J16 Genome Evolution
- J17 Command Center
- J18 Failure / Recovery
- J23 Temporal Flow

## I. Canonical Vocabulary / Contracts

- Impact Tier
- Control Requirement
- Control Evidence
- Clearance
- Policy Version
- Authority Version
- KEY Delegation / Standing Authority
- Quick Confirm
- Formal Approval
- Admin Approval
- Step-up Auth
- Explicit Delegation
- Block

## J. Authority / Governance

Candidate ControlRequirement values:

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

Impact Tier is an input, not a synonym for these controls.

## K. Transactions / Concurrency / Idempotency

Control satisfaction must not be double-resolved through non-atomic pending-state transitions.

Approval/workflow state should not become portable execution authority without exact-action Clearance.

## L. Failure / Recovery

Current major failure classes:

- multiple approval regimes with inconsistent authority semantics;
- exact capability identity lost behind workflow wrappers;
- client-reconstructed quick-confirm parameters;
- stale approval state and non-CAS resolution;
- timeout auto-approval labelled like human approval;
- policy controls stored but not always causally enforced at decision boundary;
- policy mutation surfaces weaker than the behavior they can enable.

## M. Security / Privacy

Core control-plane law:

> A policy capable of enabling high-impact behavior must require authority at least as strong as the behavior it can enable.

KEY must never be able to increase its own authority through learned preferences, successful history or ungoverned policy mutation.

## N. Evidence / Observability

Target normalized ControlEvidence should identify:

- exact action fingerprint;
- capability/version;
- control requirement;
- evidence type;
- decision;
- satisfying principal/assignment;
- authority trace/version;
- policy version;
- timestamps/expiry/revocation/invalidation;
- approved bounds/parent evidence where applicable.

## O. Reachability / Consumers

J15 proves legacy and newer approval regimes remain live simultaneously. Consumer proof is mandatory before retirement.

## P. Duplication / Legacy / Compatibility

Important current regimes:

- AiApprovalItem;
- KeyActionProposal;
- ApprovalRequest/ApprovalStep;
- plan approval;
- Flow quick-confirm;
- position/channel reply approval.

Target is not one mega-table. Target is shared governance semantics across specialized workflows.

## Q. Invariants

1. Human authority and KEY autonomy are separate axes.
2. Impact/risk tier does not itself determine control type.
3. Approval/confirmation binds exact immutable material action identity.
4. Material mutation invalidates prior control evidence.
5. Expiry/revocation/authority-policy change can invalidate dependent unconsumed clearance.
6. Approval is not open-ended execution authority.
7. Typed evidence identifies how control was satisfied.
8. Control-plane changes require appropriately strong authority.
9. Learned success/preferences cannot self-grant standing authority.
10. Specialized workflow records may differ, but authorization semantics must converge.

## R. Findings

Relevant current findings include F057–F075 plus earlier authority/execution findings F029–F043 and F044–F056.

## S. Contradictions

Current candidates C025–C039 are heavily concentrated in this kernel.

## T. Open Questions

- canonical hard-policy hierarchy across AutopilotSettings, BusinessAutonomyProfile and AI memory;
- exact ControlEvidence persistence shape;
- authority/policy version invalidation rules;
- routed-approver exclusivity versus any independently authorized approver;
- parent-plan control evidence semantics;
- long-term relationship between ApprovalRequest and KeyActionProposal.

## U. Target-State Candidate

```text
CapabilityContract + ActionEnvelope
-> ControlRequirement
-> specialized workflow if needed
-> normalized ControlEvidence
-> exact-action Clearance
-> ExecutionClaim
```

Existing seams should be consolidated toward this model rather than replaced wholesale.

## V. Migration / Compatibility

AiApprovalItem and ApprovalRequest must be consumer-mapped before retirement. Shadow migration without synchronized semantic state is insufficient as a final target.

## W. Proof / Test Ratchets

Eventually prove:

- no ordinary member can weaken hard autonomy policy beyond grantable authority;
- approval for action A cannot execute mutated action B;
- expiry/revocation invalidates unconsumed authorization;
- position reply cannot be spoofed/replayed across businesses;
- plan child outside approved bounds requires new clearance;
- timeout auto-approval is typed and explainable;
- all live approval surfaces resolve authority consistently.

## X. Layered Improvement

L0: remove governance inconsistencies/bypasses.
L1: exact binding, server-side authority, transaction/CAS safety, audit.
L2: normalized ControlEvidence + portable explainable Clearance.
L3: continuous invalidation, step-up auth, bounded hierarchical clearance.
L4: adaptive proportional friction with natural-language explanation of why KEY can/cannot act.

## Y. Machine-readable Record

```yaml
id: KF-KERNEL-003
name: KEY Authority & Governance
status: active-convergence
primary_journeys: [J2, J6, J15, J16, J17, J18, J23]
implementation_authorized: false
```
