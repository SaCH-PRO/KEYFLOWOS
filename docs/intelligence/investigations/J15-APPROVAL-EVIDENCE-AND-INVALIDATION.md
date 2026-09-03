# J15 Investigation — Approval Evidence, Binding, and Invalidation

Status: ACTIVE FORENSICS / CURRENT IMPLEMENTATION REVALIDATED

Implementation baseline: `main` at `e1203b34d0b3091a73657dc358508d7a14109575`.

Purpose: determine whether current approval/confirmation artifacts prove that an authorized principal approved the exact action later executed, and what invalidates that proof.

No production-code changes are authorized by this document.

---

## 1. Current approval regimes examined

This pass examined:

- `AiApprovalItem`
- `AiOversightService.resolveApproval()`
- `AiOversightService.resolveApprovalByAssignment()`
- timeout escalation/auto-approval
- `AiController` canonical/legacy approval migration
- plan-level approval through `PlannerService.approvePlan()`
- Flow quick-confirm endpoints and client payloads

---

## 2. Human resolution of AiApprovalItem

### Current path

```text
authenticated user
  -> business Membership check
  -> derive Membership approval tier
  -> compare item.riskTier <= memberTier
  -> finalizeResolution()
  -> AiApprovalItem.status = approved/rejected/deferred
```

Positive property:

- normal logged-in approval now consumes Membership `maxApprovalTier`/role defaults.

Limitation:

- normal logged-in approval does not require the resolving user to match `approverAssignmentId` selected by `ApprovalRoutingService`.

Therefore current semantics are approximately:

```text
routing says "this is the preferred/resolved approver"
BUT
any business member with sufficient tier can resolve through the normal user path
```

This may be intentional shared-queue override behavior, but it is not equivalent to strict routed-approver authority.

Target architecture must choose explicitly between:

1. resolved approver is exclusive;
2. resolved approver is preferred but any independently authorized principal may resolve;
3. override requires a stronger explicit control.

Do not accidentally infer exclusivity from routing data.

---

## 3. Reply-based staff-position approval

`resolveApprovalByAssignment()` is materially different.

It requires:

- item is pending;
- `item.approverAssignmentId === assignmentId`;
- assignment is active and belongs to business;
- `autoApprovalViaReply` is enabled;
- JobRole `defaultApprovalTier >= item.riskTier`.

This permits contact-only OrgAssignments with no Membership/User to approve by reply.

Interpretation:

- KeyFlowOS already supports non-login organizational approvers.
- Human authority therefore cannot be defined only as authenticated User + Membership.
- J25 should distinguish **interactive authenticated authority** from **position-bound external approval authority**.
- Principal lineage for such approval must preserve assignment/contact identity rather than fabricating a User.

Current `finalizeResolution()` falls back to `resolvedBy = 'key_delegate'` when no user exists, which is too lossy for target provenance even though the approval row + execution log retain some evidence.

---

## 4. Approval finalization is not an atomic expected-state transition

Both normal and assignment-based resolution follow:

```text
read item
assert status == pending
... checks/logging ...
update by id
```

No compare-and-swap/updateMany condition on `status='pending'` was observed in this path.

Concurrent resolvers can therefore both pass the initial pending check before one update wins/overwrites the row.

Target invariant:

```text
PENDING --atomic expected-state transition--> SATISFIED | REJECTED | DEFERRED
```

Only one resolver may own the state transition.

Any secondary effects (plan-step reactivation, events, audit) must be downstream of the successful transition rather than independently triggered by multiple contenders.

---

## 5. Approval and plan-step reactivation are separate writes

`finalizeResolution()` performs:

```text
AiApprovalItem update -> approved
then
AiPlanStep update -> pending
```

They are not shown in one database transaction.

Failure between them creates a split state:

```text
approval = approved
plan step = awaiting_approval
```

or retry behavior that must infer repair.

Target options must explicitly choose:

- transactionally couple control evidence + dependent state transition; or
- emit a durable post-commit event/outbox and make plan-step release idempotent/recoverable.

Do not rely on best-effort adjacent writes for a control boundary.

---

## 6. Timeout semantics include autonomous approval

`escalateStaleApprovals()` currently:

- loads business approval timeout;
- for pending Tier 1–2 items with autonomy level >=3, directly writes status `approved` after timeout;
- reactivates linked plan step;
- otherwise marks item `escalated`.

Interpretation:

This is not merely escalation. It is a distinct control-evidence type:

```text
TIMEOUT_AUTONOMY_APPROVAL
```

It should not masquerade as human approval.

Target `ControlEvidence` should preserve evidence type such as:

- HUMAN_CONFIRMATION
- HUMAN_FORMAL_APPROVAL
- HUMAN_ADMIN_APPROVAL
- POSITION_REPLY_APPROVAL
- POLICY_AUTO_APPROVAL
- TIMEOUT_AUTO_APPROVAL
- AUTHORITY_GRANT_AUTO_APPROVAL

This matters for audit, explainability, revocation rules and later policy analysis.

---

## 7. Canonical approval migration is incomplete convergence

`AiController.getPendingApprovals()` now serves pending items from `KeyActionProposal`, and the legacy resolution route attempts to migrate `AiApprovalItem` into a `KeyActionProposal` on resolution.

This is favorable evidence that the codebase is already trying to converge approval models.

However:

- `AiApprovalsController`/`AiApprovalsService` still directly exposes and resolves `AiApprovalItem`;
- `AiOversightService.evaluateAutoApproval()` still directly checks approved `AiApprovalItem` by `planStepId`;
- message/drive intake paths still call `AiOversightService.resolveApproval()` directly;
- plan-step workflows still depend on AiApprovalItem status.

Interpretation:

`AiApprovalItem` is not dead legacy. It is an active compatibility/control artifact with live consumers.

Consumer proof is required before retirement.

---

## 8. Legacy-to-proposal migration preserves generic EXECUTE_TOOL wrapping

When migrating an AiApprovalItem, the controller proposes:

```text
actionType: EXECUTE_TOOL
toolName: item.toolName
parameters: item.inputPayload
```

This is better than losing `toolName`, but still preserves the architecture problem that proposal action type can be generic while real capability identity/risk belongs to the underlying tool.

Target clearance must bind to resolved `CapabilityContract(name, version, permission, risk/control metadata)` rather than generic proposal action type alone.

---

## 9. Plan-level approval semantics are weaker than per-step authority semantics

`PlannerService.approvePlan()` currently:

- requires plan status `draft`;
- if `plan.maxRiskTier >= 4`, requires SUPER_ADMIN or Membership role OWNER/ADMIN;
- otherwise performs no equivalent Membership `maxApprovalTier` check in the inspected method;
- marks the entire plan `approved`;
- controller emits `plan.approved`, triggering immediate PlanExecutor processing.

Important contradictions:

1. Tier 4 plan approval uses coarse role, not the same effective approval-tier logic used by AiApprovalItem.
2. Tier <=3 plan approval does not appear to require equivalent approval-tier authority.
3. Plan approval does not itself establish immutable child-action clearance.
4. PlanExecutor later re-evaluates individual steps, so plan approval semantics are partly advisory/parent-level rather than portable child authorization.

This supports the hierarchical-clearance requirement:

> Parent approval may cover a child only when the exact child capability and materially relevant parameters are inside immutable approved bounds.

---

## 10. Flow quick-confirm is client-reconstructable rather than server-bound

Current Flow confirmation shape:

```text
client receives PendingConfirmation {
  toolCallId
  name
  arguments
  description
  riskLevel
}

client sends back {
  toolCallId
  confirmed
  toolName
  toolArgs
}
```

`AiFlowController /flow/confirm` accepts `toolName` and `toolArgs` from the request body and passes them into `FlowOrchestrator.chat()`.

The orchestrator re-runs governance on the supplied `toolName`, which is useful, but no durable server-side pending-action lookup/binding was observed in this path during this pass.

Therefore the confirmation artifact appears reconstructable by the client rather than consumed from an immutable server-side action envelope.

Target quick-confirm invariant:

```text
server stores/binds pending ActionEnvelope + fingerprint
client returns only confirmation reference + decision
server loads exact immutable action
server verifies fingerprint/state/authority validity
```

The user should confirm the action the server originally proposed, not a client-supplied re-description of it.

---

## 11. Missing exact-action fingerprint / version binding

Across the inspected approval paths, durable artifacts contain useful fields such as:

- toolName
- riskTier
- inputPayload
- affectedEntities
- planId / planStepId
- approver assignment/method
- resolved principal/time

But no canonical action fingerprint binding:

```text
businessId
+ capability name/version
+ normalized material parameters
+ affected entities/resources
+ control-relevant risk/policy context
```

was observed as the approval identity.

This means target invalidation semantics are not yet first-class.

Material changes requiring invalidation should include at least candidate classes:

- capability name/version changes;
- material parameter changes;
- target resource/entity changes;
- amount/value boundary changes;
- authority version/revocation changes;
- delegation expiry;
- policy/control requirement becoming stricter;
- readiness/compliance changes where they are execution prerequisites;
- parent-plan mutation outside approved child bounds.

---

## 12. Candidate ControlEvidence shape

Working shape only:

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

Approval objects may remain domain-specific UI/workflow records, but clearance should consume normalized ControlEvidence semantics.

---

## 13. New current findings

### F060 — logged-in AiApprovalItem resolution does not require routed approver identity

**Status:** CURRENTLY REVALIDATED / ACTIVE

A sufficiently tiered business member can resolve through the normal user path even when `approverAssignmentId` names a different routed approver.

Architectural implication: routing preference and exclusive approval authority are not the same current concept and must be explicitly resolved.

### F061 — contact-only OrgAssignments can approve without Membership/User

**Status:** CURRENTLY REVALIDATED / ACTIVE

Reply-based resolution can authorize an active contact-only position using JobRole tier and `autoApprovalViaReply`.

Architectural implication: J25 principal/authority model must represent position-bound external human authority, not only authenticated Membership principals.

### F062 — AiApprovalItem resolution uses read-then-update instead of atomic pending-state CAS

**Status:** CURRENTLY REVALIDATED / ACTIVE

Architectural implication: duplicate concurrent resolution is possible at the state-transition boundary unless database behavior/other unseen constraints prevent it.

### F063 — approval resolution and dependent plan-step release are separate non-transactional writes

**Status:** CURRENTLY REVALIDATED / ACTIVE

Architectural implication: governance state and execution eligibility can diverge under failure.

### F064 — stale low-tier approvals can become autonomous timeout approvals

**Status:** CURRENTLY REVALIDATED / ACTIVE

Architectural implication: approval evidence requires typed provenance; `approved` is insufficient to describe how control was satisfied.

### F065 — AiApprovalItem remains live despite canonical KeyActionProposal migration direction

**Status:** CURRENTLY REVALIDATED / ACTIVE COMPATIBILITY FINDING

Architectural implication: retire only after consumer migration/proof.

### F066 — plan-level approval uses different human authority semantics from item approval

**Status:** CURRENTLY REVALIDATED / ACTIVE

Tier-4 uses OWNER/ADMIN role; lower tiers do not show equivalent approval-tier validation in the inspected planner path.

### F067 — Flow quick-confirm trusts client-returned toolName/toolArgs rather than a durable server-side pending action

**Status:** CURRENTLY REVALIDATED / HIGH-IMPORTANCE ACTIVE

Architectural implication: confirmation must be rebound to immutable server-side ActionEnvelope/fingerprint before it can become control evidence.

### F068 — current approval artifacts lack canonical exact-action fingerprint binding

**Status:** CURRENTLY REVALIDATED / ACTIVE

Architectural implication: material mutation invalidation cannot be universal until approval/clearance identifies the exact invocation canonically.

---

## 14. New contradiction candidates

### C029 — routed approver vs tier-qualified resolver

Routing selects a specific OrgAssignment, while normal user resolution accepts any sufficiently tiered Membership.

### C030 — authenticated Membership authority vs contact-only position authority

J25's Membership-first human-authority model is insufficient by itself for reply-based organizational approvers.

### C031 — approval resolution vs dependent plan state atomicity

Approval becomes approved and plan step becomes executable through separate writes.

### C032 — human approval label vs autonomous timeout approval

The same `approved` status can represent human control or policy-driven timeout automation.

### C033 — canonical proposal migration vs live AiApprovalItem consumers

The controller describes KeyActionProposal as canonical while other mounted/current paths still directly use AiApprovalItem.

### C034 — plan approval authority vs item approval authority

Plan approval and approval-item resolution enforce materially different human authority rules.

### C035 — confirmation UI intent vs client-reconstructed execution parameters

User confirmation is presented as approval of a pending action, while current server path accepts action identity/arguments back from the client rather than loading an immutable pending server artifact.

---

## 15. Feed-back into J25

Refine human principal classes:

```text
AuthenticatedHumanPrincipal
  -> User + Membership

PositionBoundHumanPrincipal
  -> active OrgAssignment
  -> contact identity / verified channel
  -> JobRole authority
  -> no fake User required
```

Both can satisfy controls, but with different authentication/evidence requirements.

EffectiveAuthorityResult should therefore support principal type and authentication/evidence strength.

---

## 16. Feed-forward into J2 / clearance

Clearance should consume typed ControlEvidence, not raw status flags.

Candidate rule:

```text
ControlEvidence.actionFingerprint == ActionEnvelope.fingerprint
AND ControlEvidence not expired/revoked/invalidated
AND authority/policy versions acceptable
AND all required controls satisfied
  -> eligible for clearance evaluation
```

The clearance issuer should not infer evidence quality from `status='approved'` alone.

---

## 17. Next J15 forensic slice

Next investigate:

1. `KeyCortexApprovalOrchestratorService` and canonical KeyActionProposal approval mechanics;
2. exact proposal risk-tier/capability derivation;
3. `ApprovalRequest` domain and whether it is a separate legitimate business approval primitive;
4. message/WhatsApp reply identity proof for contact-only approval;
5. mutation paths for AiPlan/AiPlanStep after plan approval;
6. expiry/revocation consumers;
7. control-plane mutation authority;
8. frontend visibility of exact parameters/affected entities.
