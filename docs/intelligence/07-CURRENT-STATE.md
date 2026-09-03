# KeyFlowOS Current State

Last updated: 2026-09-03

## Analytical phase

`COMPUTABLE_DIGITAL_TWIN / JOURNEY_KERNEL_CONVERGENCE`

## Status

`J15 ACTIVE FORENSICS — JOURNEY + KERNEL MESH CONVERGENCE`

Production implementation remains blocked.

Context integrity: `PASS`

## Implementation evidence baseline

Current revalidated `main` baseline:

`e1203b34d0b3091a73657dc358508d7a14109575`

Revalidate if `main` materially advances before relying on commit-sensitive implementation facts.

## Canonical operating model

The digital twin now has two primary dimensions:

```text
VERTICAL
= 25 end-to-end journey dossiers

HORIZONTAL
= 12 pooled architectural kernels
```

See:

- `03-ANALYSIS-MAP.md`
- `11-RECURSIVE-ASSURANCE-PROGRAMME.md`
- `12-KERNEL-PROGRAMME.md`
- `13-IMPLEMENTATION-HANDOFF-PROTOCOL.md`

Core thesis:

> KeyFlowOS is a governed business-state transition system.

Working causal model:

```text
External reality
-> observation/signal
-> Business Graph
-> Genome interpretation
-> KEY reasoning
-> Capability Contract
-> Effective Authority + KEY autonomy + readiness + policy
-> Control Requirement
-> Control Evidence when required
-> exact-action Clearance
-> atomic Execution Claim
-> canonical post-clearance dispatch
-> domain/provider execution
-> durable Evidence / Outcome
-> Business Graph
-> Genome evolution
```

## Active constellation

```text
KF-JOURNEY-001 — Business Birth
        ↕
KF-JOURNEY-025 — Human Authority Lifecycle
        ↕
KF-JOURNEY-002 — KEY Request → Governed Action
        ↕
KF-JOURNEY-015 — Approval / Governance Lifecycle
```

J15 has passed the original admission gate and is actively stress-testing the prior J1/J25/J2 convergence.

Likely next natural member after governance convergence: `J6 — Proactive KEY / Autonomy`.

## Active kernels most involved

- K1 Tenant Genesis & Identity
- K2 Human Authority & Organization
- K3 KEY Authority & Governance
- K5 Capability Fabric
- K6 State Transition
- K8 Evidence & Outcome
- K11 Recovery & Reliability

Other kernels remain cross-reference targets as J15 expands.

## J1/J25/J2 convergence retained

### Tenant relationship

Direction remains:

```text
Business.ownerId
= distinguished ownership identity

Membership
= canonical authenticated-human ↔ Business relationship
  + baseline authority envelope
```

Open migration work remains around ownerId discovery/access, founding Membership repair and invitation identity claim.

### Effective human authority

Working algebra:

```text
Membership baseline
+ active OrgAssignment/JobRole
+ explicit bounded grants/overrides
+ valid bounded delegation
- explicit denials
∩ capability/resource/value/time/business/policy constraints
-> EffectiveAuthorityResult
```

J15 has refined the principal model: not every legitimate human approver is necessarily a `User + Membership`. Position-bound external approvers may be represented by active OrgAssignment + verified contact/channel identity + JobRole authority.

Routing/delegation fields are not themselves authority proof.

### Capability / clearance / execution

Direction remains:

```text
CapabilityContract
-> ActionEnvelope
-> action fingerprint
-> EffectiveAuthority + KEY autonomy + readiness/policy
-> ControlRequirement
-> ControlEvidence
-> CLEARANCE_GRANTED
-> atomic CLAIMED
-> ActionDispatcher
-> domain/provider execution
-> durable outcome
```

`CapabilityContractService` and `ActionDispatcherService` remain preferred existing seams to strengthen before creating replacements.

## J15 current forensic conclusions

J15 has now established or strengthened the following working distinctions:

```text
Impact Tier != Control Requirement
Approval != Clearance
Control Evidence != workflow state
Routing != authority
Delegation pointer != delegated authority
Clearance != Execution Claim
Workflow action type != exact business Capability identity
```

### Specialized workflows vs unified semantics

Current strongest convergence model:

```text
A. Control-requirement resolver
   current seams: AiOversight / AutonomyOrchestrator

B. Single-action proposal/control workflow
   KeyActionProposal + KeyCortexApprovalOrchestrator

C. Multi-step human approval workflow
   ApprovalRequest + ApprovalStep

D. Approval routing
   ApprovalRouting + DelegationRule + JobRole

E. Normalized ControlEvidence
   target missing primitive

F. Clearance
   target missing primitive
```

Target shape:

```text
CapabilityContract + ActionEnvelope
-> ControlRequirement

specialized workflow:
  QuickConfirm
  OR KeyActionProposal
  OR ApprovalRequest/Steps
  OR position reply

-> normalized ControlEvidence
-> Clearance
-> ExecutionClaim
```

Do not collapse all approval/workflow records into one mega-table. Unify shared authorization/control/evidence semantics while retaining legitimate specialized workflow models.

## Current J15 findings

Historical findings remain recovered through F043.

Current convergence/J15 findings now extend through:

`F044–F075`

Important recent J15 additions include:

- F060: logged-in AiApprovalItem resolution does not require routed approver identity;
- F061: contact-only OrgAssignments can approve without Membership/User;
- F062: AiApprovalItem resolution is read-then-update, not pending-state CAS;
- F063: approval resolution and dependent plan-step release are non-transactional;
- F064: stale low-tier approvals can become autonomous timeout approvals;
- F065: AiApprovalItem remains live despite proposal migration direction;
- F066: plan-level approval uses different authority semantics from item approval;
- F067: Flow quick-confirm trusts client-returned toolName/toolArgs rather than server-side immutable pending action;
- F068: approval artifacts lack canonical exact-action fingerprint binding;
- F069: KeyCortexApprovalOrchestrator is a strong convergence seam but not a complete governance boundary;
- F070: ApprovalRequest is a legitimate multi-step human workflow primitive;
- F071: ApprovalRequest progression is transactionally grouped but lacks observed expected-state CAS;
- F072: ApprovalRequest delegation does not centrally prove delegate/grantability bounds;
- F073: threshold auto-approval uses heuristic payload amount extraction;
- F074: ApprovalRequest shadow proposal migration does not synchronize canonical state;
- F075: proposal actionType represents governance choreography more reliably than exact business capability.

These are not all yet pooled into the global finding register; register pooling is a priority next action.

## Contradictions

Historical contradictions recovered through C021.

Current candidate contradictions extend through:

`C022–C039`

J15 additions include routed approver vs tier-qualified resolver, authenticated-Membership vs position-bound principal, approval-vs-plan atomicity, human-approval label vs timeout auto-approval, proposal migration vs live legacy consumers, plan-vs-item authority semantics, confirmation intent vs client-reconstructed action, shadow proposal desynchronization, transaction grouping vs expected-state ownership, delegation assignment vs authority, and workflow action type vs Capability identity.

These candidates also require pooling into the canonical contradiction register.

## J15 candidate invariants

1. Governed mutation is evaluated as an exact capability invocation.
2. Approval/confirmation binds immutable materially relevant action identity.
3. Material mutation invalidates prior control evidence.
4. Approval authority is checked for the exact action/control.
5. Grant/delegation cannot exceed grantor/delegator grantable authority.
6. Expiry/revocation invalidates dependent unconsumed clearance.
7. Material authority changes invalidate or force re-evaluation.
8. Approval artifact is not an open-ended execution token.
9. Parent plan coverage is valid only inside immutable approved bounds.
10. Approval is not execution claim.
11. Execution claim is atomic.
12. Principal lineage is preserved.
13. Typed control evidence identifies how a control was satisfied.
14. Position-bound external approval requires verifiable principal/channel evidence.
15. Routing/delegation workflow fields are not sufficient authority proof.

## ControlEvidence working target

```text
ControlEvidence {
  id
  businessId
  actionFingerprint
  capabilityName
  capabilityVersion
  controlRequirement
  evidenceType
  decision

  requestedFromPrincipal?
  satisfiedByPrincipal?
  satisfiedByAssignment?
  authorityVersion
  authorityTraceRef

  policyVersion
  readinessVersion?

  createdAt
  satisfiedAt?
  expiresAt?
  revokedAt?
  invalidatedAt?
  invalidationReason?

  parentEvidenceId?
  approvedBounds?
}
```

Candidate evidence types include HUMAN_CONFIRMATION, HUMAN_FORMAL_APPROVAL, HUMAN_ADMIN_APPROVAL, POSITION_REPLY_APPROVAL, POLICY_AUTO_APPROVAL, TIMEOUT_AUTO_APPROVAL, AUTHORITY_GRANT_AUTO_APPROVAL and POLICY_THRESHOLD_AUTO_APPROVAL.

## Immediate next work

Remain read-only with respect to production code.

Priority forensic slices:

1. proposal capability/risk derivation and mutation/CAS semantics;
2. reply-channel identity proof for position-bound approvers;
3. post-approval AiPlan/AiPlanStep material mutation and version/fingerprint behavior;
4. approval/AuthorityGrant/Delegation expiry, revocation and invalidation;
5. control-plane authority for autonomy/governance/role/grant mutation;
6. frontend evidence: what exact action/parameters/affected entities approvers see and stale-tab behavior;
7. pool F044–F075 into `08-FINDING-REGISTER.md`;
8. pool C022–C039 into `09-CONTRADICTION-REGISTER.md`;
9. update mature recommendations in `10-RECOMMENDATION-REGISTER.md`;
10. begin dedicated active kernel dossiers under `docs/intelligence/kernels/`;
11. feed J15 changes back into J1/J25/J2 before freezing target architecture.

## Do not yet

- modify production code;
- issue implementation packets as if recommendations were accepted decisions;
- freeze target persistence schemas;
- create parallel v2 capability/authority/approval/dispatcher systems before existing seams are disproven;
- delete legacy systems without consumer proof;
- claim tests pass unless actually executed;
- infer dead code from UI non-navigation;
- treat current kernel names or persistence shapes as irreversible.
