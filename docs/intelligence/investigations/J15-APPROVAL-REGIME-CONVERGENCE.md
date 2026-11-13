# J15 Investigation — Approval Regime Convergence

Status: ACTIVE FORENSICS / REGIME CLASSIFICATION

Implementation baseline: `main` at `e1203b34d0b3091a73657dc358508d7a14109575`.

Purpose: distinguish legitimate specialized approval workflow records from competing governance regimes, and identify the common control/evidence contract they should share.

No production-code changes are authorized by this document.

---

## 1. Regimes examined in this slice

- `KeyCortexApprovalOrchestratorService`
- `KeyActionProposalService`
- `ApprovalRequestService`
- ordered `ApprovalStep` workflows
- shadow migration from `ApprovalRequest` to `KeyActionProposal`

---

## 2. KeyCortexApprovalOrchestrator is a convergence seam, not yet a complete authority boundary

The orchestrator declares itself the single source of truth for KEY Cortex approvals and routes:

```text
propose
approve
reject
executeApproved
```

through `KeyActionProposalService`, adding audit events and preserving session/command/correlation identity.

Favorable properties:

- centralizes proposal lifecycle calls;
- preserves principal/event lineage better than ad-hoc status writes;
- provides a natural migration target for AI approval surfaces;
- does not itself duplicate execution implementation.

However:

- `approve()` delegates to `proposalService.approve()`; authority proof must occur before this call in callers or a future central resolver;
- proposal lifecycle still uses non-atomic read/check/update semantics in the inspected underlying service;
- `executeApproved()` passes `confirm=true` and `confirmGenomeRisk=true` to proposal execution, meaning the orchestrator treats prior approval as sufficient to satisfy those boolean confirmations rather than consuming typed immutable control evidence;
- exact CapabilityContract/fingerprint binding is still absent.

Interpretation:

> Keep the orchestrator as a strong convergence seam, but do not equate orchestration centrality with complete governance correctness.

---

## 3. ApprovalRequest is a distinct business workflow primitive

`ApprovalRequestService` represents:

```text
request
  -> ordered ApprovalStep 0
  -> ordered ApprovalStep 1
  -> ...
  -> approved / rejected / cancelled / escalated
```

It supports:

- arbitrary `requestType`;
- requester identity;
- payload;
- threshold-based automatic approval;
- multiple ordered approvers;
- per-step decisions/comments;
- delegation of the current step;
- requester cancellation;
- pending-work queries per approver;
- escalation.

This is semantically richer than a one-person quick confirmation or one KeyActionProposal status transition.

Therefore target architecture should not automatically delete `ApprovalRequest` merely because KeyActionProposal is called canonical.

Potential long-term role:

> `ApprovalRequest` = workflow/domain record for multi-step human approval choreography.

while:

> `ControlEvidence` = normalized evidence emitted by each satisfied step/request and consumed by clearance.

This permits domain-specific workflow without parallel authorization semantics.

---

## 4. ApprovalRequest decision path has stronger transactional grouping but still weak concurrent ownership

`decideStep()`:

1. reads request + steps;
2. verifies request pending;
3. finds current pending step;
4. verifies `approverId` or `delegatedTo` matches caller-provided approver ID;
5. runs a transaction that updates the step and request progression/final state.

Positive property:

- step decision + request progression/finalization are grouped transactionally.

Remaining concurrency issue:

- expected `request.status`, `currentStep`, and `step.status` are checked before the transaction;
- transaction updates are by IDs without an observed conditional expected-state update;
- two concurrent requests by the same valid approver may both enter the transaction after the pre-read.

Target invariant remains CAS/claim-oriented even for human workflow steps.

---

## 5. Delegation is identity substitution without effective-authority bound proof

`delegateStep()` permits the assigned approver to write `delegatedTo` on the current step.

The inspected service verifies:

- request is pending;
- current step exists;
- caller-supplied `approverId` equals assigned approver.

It does not in this service prove:

- `delegatedTo` belongs to the business;
- delegate has appropriate capability/control authority;
- delegator is permitted to delegate this approval;
- delegated authority is a subset of delegator's grantable authority;
- delegation expiry/scope.

This reinforces the J25 invariant:

```text
delegation <= delegator's delegable effective authority
```

A workflow `delegatedTo` pointer should be routing/choreography state, not sufficient proof of authority by itself.

---

## 6. Threshold auto-approval is another typed control-evidence source

`ApprovalRequestService.createRequest()` can automatically mark the full request and every step approved when an extracted amount is <= `threshold`.

This is a legitimate policy mechanism, but it must be represented as:

```text
POLICY_THRESHOLD_AUTO_APPROVAL
```

rather than indistinguishable human approval.

The threshold calculation currently heuristically extracts one of:

```text
payload.amount
payload.total
payload.value
payload.threshold
```

and parses strings as floats.

Target architecture should bind monetary/value thresholds to capability-specific normalized parameters rather than generic field-name heuristics when the control has financial consequence.

---

## 7. Shadow migration creates visibility, not state convergence

On request creation, `ApprovalRequestService.shadowMigrateToProposal()` creates a `KeyActionProposal`:

```text
sourceType: HUMAN_WORKFLOW
sourceId: ApprovalRequest.id
actionType: REQUEST_APPROVAL
parameters: request payload
affectedEntities: request type + approval steps
```

and stores `migratedToProposalId` on the ApprovalRequest.

Important interpretation:

This is a **shadow ledger** relationship, not a canonical transactional migration.

The real ApprovalRequest workflow continues to mutate its own status/steps independently after proposal creation.

No synchronization from later `decideStep()`, delegation, cancellation or escalation into the shadow proposal was observed in this service.

Therefore states can diverge:

```text
ApprovalRequest = approved
KeyActionProposal = PENDING
```

or equivalent variants.

This is worse than harmless duplication if consumers treat the proposal as authoritative governance state.

Target options:

A. ApprovalRequest remains canonical workflow state; KeyActionProposal stores only a reference/projection and does not pretend to be equivalent state.

B. KeyActionProposal becomes parent canonical control object and ApprovalRequest becomes a workflow child whose aggregate state drives the parent transactionally/event-durably.

C. Both emit normalized ControlEvidence and neither status is reused as universal clearance.

Option C is compatible with either A or B and is the current strongest architectural direction.

---

## 8. Generic proposal action types still collapse semantic identity

Shadow migration uses:

```text
actionType = REQUEST_APPROVAL
```

while migrated AI items use:

```text
actionType = EXECUTE_TOOL
```

These names describe workflow mechanics, not the actual business capability being governed.

Therefore canonical governance identity should not be derived from `KeyActionProposal.actionType` alone.

Strong direction:

```text
proposal/workflow type
  = how control is being coordinated

CapabilityContract
  = what exact business action is being governed
```

Both are needed.

---

## 9. Regime classification

Working classification:

### A. Control-requirement resolver

Current seam: `AiOversightService` / `AutonomyOrchestratorService`.

Question answered:

> What control is required for this exact action?

### B. Single-action proposal/control workflow

Current seam: `KeyActionProposal` + `KeyCortexApprovalOrchestratorService`.

Question answered:

> What is the lifecycle of this proposed governed action?

### C. Multi-step human approval workflow

Current seam: `ApprovalRequest` + `ApprovalStep`.

Question answered:

> Which ordered humans/steps must satisfy a business workflow approval?

### D. Approval routing

Current seam: `ApprovalRoutingService` + `DelegationRule` + JobRole.

Question answered:

> Who should receive an approval request?

### E. Control evidence

Target missing normalized primitive.

Question answered:

> What durable, exact-action-bound evidence proves the required control was satisfied, by whom/how, under which authority/policy version?

### F. Clearance

Target missing normalized primitive.

Question answered:

> Given all current authority, policy, readiness and control evidence, may this exact action execute now?

This classification permits specialized workflows without competing definitions of authorization.

---

## 10. New current findings

### F069 — KeyCortexApprovalOrchestrator is a strong convergence seam but not yet a complete governance boundary

**Status:** CURRENTLY REVALIDATED / FAVORABLE EXISTING SEAM

It centralizes proposal lifecycle/audit, but exact authority, immutable evidence binding and atomic lifecycle transitions remain outside/incomplete.

### F070 — ApprovalRequest is a legitimate multi-step workflow primitive, not merely redundant AI approval state

**Status:** CURRENTLY REVALIDATED / ARCHITECTURAL CLASSIFICATION

Its ordered steps, delegation, threshold, cancellation and per-user inbox semantics justify a domain/workflow role even if authorization semantics are unified elsewhere.

### F071 — ApprovalRequest transactional progression still lacks observed expected-state CAS

**Status:** CURRENTLY REVALIDATED / ACTIVE

Step + request mutations are transactionally grouped, but preconditions are read before the transaction and writes are not observed as conditional on pending/current expected state.

### F072 — ApprovalRequest delegation does not centrally prove delegate/grantability bounds

**Status:** CURRENTLY REVALIDATED / ACTIVE

A `delegatedTo` pointer can be written without observed EffectiveAuthority validation in the service.

### F073 — ApprovalRequest threshold auto-approval uses heuristic payload amount extraction

**Status:** CURRENTLY REVALIDATED / ACTIVE

Architectural implication: financial/value policy should consume capability-normalized parameters rather than generic field-name heuristics.

### F074 — ApprovalRequest shadow migration creates proposal visibility but not synchronized canonical state

**Status:** CURRENTLY REVALIDATED / HIGH-IMPORTANCE ACTIVE

Subsequent workflow transitions are not observed to update the shadow proposal, permitting status divergence.

### F075 — proposal actionType describes governance choreography more reliably than exact business capability

**Status:** CURRENTLY REVALIDATED / ACTIVE

Examples `EXECUTE_TOOL` and `REQUEST_APPROVAL` are generic workflow mechanics.

Architectural implication: keep workflow type separate from exact CapabilityContract identity.

---

## 11. New contradiction candidates

### C036 — canonical proposal claim vs shadow unsynchronized workflow state

KeyActionProposal is described as canonical while ApprovalRequest remains independently mutable after one-time shadow proposal creation.

### C037 — transactionally grouped workflow vs non-atomic expected-state ownership

ApprovalRequest groups writes in a transaction but does not observedly claim the current pending step with CAS semantics.

### C038 — delegated workflow assignee vs delegated authority

`delegatedTo` changes who may decide the step without proving the full J25 delegation invariant.

### C039 — workflow action type vs business capability identity

Generic governance action types coexist with the need to authorize exact business capabilities.

---

## 12. Target convergence direction

Do not collapse every approval record into one mega-table prematurely.

Instead converge semantics:

```text
CapabilityContract + ActionEnvelope
  -> ControlRequirement

Specialized workflow
  -> KeyActionProposal OR ApprovalRequest/Steps OR quick-confirm UI

Each satisfied control
  -> normalized ControlEvidence

ControlEvidence + current authority/policy/readiness
  -> Clearance

Clearance
  -> ExecutionClaim
```

Records can remain specialized when they model different workflow needs, provided they stop acting as competing standalone authorization truths.

---

## 13. Next work

Continue J15 into:

1. proposal risk/capability derivation and generic-wrapper behavior;
2. WhatsApp/message reply identity proof for position-bound approval;
3. mutation of plan/step payload after approval;
4. expiry/revocation and governance-policy mutation invalidation;
5. control-plane mutation authority;
6. frontend evidence — what approvers actually see before deciding.
