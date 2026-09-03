# KF-JOURNEY-015 — Approval / Governance Lifecycle

Status: SCOPING / ACTIVE FORENSICS

Implementation evidence baseline: `main` at `e1203b34d0b3091a73657dc358508d7a14109575`.

This journey is now admitted for scoping because J1/J25/J2 have directionally converged around Membership-first tenancy, Effective Authority, exact-action clearance and atomic execution claim. Production implementation remains unauthorized.

## A. Definition

This journey models how KeyFlowOS determines what control an exact action requires, who may satisfy that control, what durable evidence proves it was satisfied, how approval/confirmation is bound to the exact action, what invalidates it, and how successful control satisfaction becomes execution clearance.

## B. Product Intent

Governance should be strong enough to prevent unauthorized or stale execution without forcing every low-risk action through heavyweight approval.

The user-facing outcome should feel simple:

```text
KEY proposes or prepares an action
  -> system knows whether it can act automatically
  -> if human control is needed, the right person sees the right request
  -> their response is bound to the exact action they saw
  -> materially changed actions require new control
  -> once control is satisfied, the action can execute once
```

## C. Actors

Working actor classes:

- requesting human principal
- proposing KEY/agent principal
- approver / confirmer
- business owner / admin
- delegated approver
- JobRole/OrgAssignment-based approver
- KEY autonomous executor
- queue worker / synchronous executor
- external provider
- platform/super-admin authority where applicable

Principal lineage must distinguish requestedBy, proposedBy, approvedBy, executedFor, claimantExecutor and executedBy.

## D. Entry Surfaces

Current materially distinct governance surfaces to trace:

1. `KeyActionProposal` approval/rejection/execution
2. AI plan approval
3. plan step approval / `AiApprovalItem`
4. `AiOversightService.evaluate()`
5. `AiOversightService.evaluateAutoApproval()`
6. `AutonomyOrchestratorService`
7. `ApprovalRoutingService`
8. `DelegationRule`
9. Membership `maxApprovalTier`
10. JobRole `defaultApprovalTier`
11. `AuthorityGrant`
12. quick-confirm / confirm booleans
13. admin / tier-4 approval
14. direct Flow execution surfaces
15. queued PlanExecutor/BullMQ execution
16. conversational confirmation paths

## E. State Machine

Candidate analytical state machine; not frozen:

```text
ACTION_IDENTIFIED
  -> CONTROL_EVALUATED

CONTROL_EVALUATED
  -> AUTO_ALLOWED
  -> QUICK_CONFIRM_REQUIRED
  -> FORMAL_APPROVAL_REQUIRED
  -> ADMIN_APPROVAL_REQUIRED
  -> STEP_UP_REQUIRED
  -> EXPLICIT_DELEGATION_REQUIRED
  -> BLOCKED

CONTROL_REQUIRED
  -> PENDING
  -> SATISFIED
  -> REJECTED
  -> EXPIRED
  -> REVOKED
  -> INVALIDATED

SATISFIED
  -> CLEARANCE_EVALUATING
  -> CLEARANCE_GRANTED
  -> CLEARANCE_DENIED

CLEARANCE_GRANTED
  -> CLAIMED
  -> RUNNING
  -> SUCCEEDED / FAILED / OUTCOME_UNKNOWN
```

Critical distinction:

`APPROVED != CLEARANCE_GRANTED`

Approval is evidence that one required control was satisfied. Clearance is the complete authorization result for the exact action.

## F. Frontend Path

To be traced. Required proof includes:

- where approval/confirmation requests render;
- whether the user sees the exact capability/parameters/affected entities;
- whether confirmation UI is bound to a durable server-side pending action;
- whether stale tabs can approve changed actions;
- whether role/tier visibility matches backend enforcement.

## G. API Path

To be mapped across proposal, AI approval, plan, Cortex, Flow and confirmation endpoints.

Key question:

> Does every approval endpoint identify and validate the exact business, principal, action fingerprint and expected pending state?

## H. Backend Chain

Initial revalidated governance chain from `AiOversightService`:

```text
toolName
  -> risk tier from Flow tool registry
  -> business autonomy settings
  -> optional KEY role/crew ceiling
  -> optional JobRole envelope
  -> blocked tool/module checks
  -> mode checks
  -> autonomy level / approved-tools / maxAutoTier
  -> Tier 4 AuthorityGrant condition
  -> decision:
       blocked
       auto
       quick confirm
       formal approval
       admin approval
```

`evaluateAutoApproval()` can then treat an approved `AiApprovalItem` for a plan step as pre-approved and can also auto-resolve some quick-confirm decisions based on autonomy level/confidence.

Interpretation: current governance already distinguishes several control outcomes, but they are produced from risk/autonomy state rather than from a canonical exact-action clearance object.

## I. Data Mutation Ledger

To be mapped for:

- KeyActionProposal status transitions
- AiApprovalItem status/evidence
- AiPlan / AiPlanStep state
- AuthorityGrant
- DelegationRule
- autonomy settings
- approval audit/events
- clearance/claim records (currently missing as first-class target primitives)

## J. Tenant / Identity

J15 consumes the J25 working invariant:

```text
Membership
  = canonical tenant relationship + baseline authority
```

Approval identity must be resolved through Effective Authority, not browser workspace selection or ownerId alone.

## K. Events / Coordination

Current events include proposal lifecycle events and `plan.approved` / execution events.

Need determine whether event payloads preserve:

- exact action identity/fingerprint
- approval evidence/version
- principal lineage
- authority version
- expiration/invalidation state

## L. KEY / AI

`AiOversightService` currently governs KEY tool execution using:

- business autonomy settings
- KEY role/crew ceilings
- JobRole envelope
- blocked tools/modules
- risk tier
- AuthorityGrant for Tier 4 autopilot

Important current implementation property:

Crew authority uses the minimum ceiling across roles that actually grant the tool; adding a permissive role cannot raise the auto-execute band of a stricter grantor.

This is a useful anti-escalation principle that should be preserved unless later evidence disproves the product semantics.

## M. Capability Mapping

J15 should treat `CapabilityContractService` identity as the target exact action contract.

Current risk/governance still primarily derives from Flow tool registry/toolName and some proposal paths wrap exact tools under generic `EXECUTE_TOOL`.

Target question:

```text
CapabilityContract(name, version, permission, risk/control metadata)
  -> one action fingerprint
  -> one control decision
```

## N. Authority / Governance

Consumes J25 candidate Effective Authority Resolver.

Approval must answer two separate questions:

1. Who should receive the request?
2. Is that exact principal authorized to satisfy the required control for this exact action?

`ApprovalRoutingService` currently answers primarily the first through:

```text
DelegationRule
  -> qualifying JobRole
  -> OWNER Membership fallback
```

It must not be treated as complete proof of the second.

## O. Blueprint / Graph / Genome

Genome/readiness may contribute policy constraints to clearance, but approval should not silently imply that knowledge/readiness requirements are satisfied.

J15 must preserve:

```text
approval evidence
!= readiness
!= policy satisfaction
!= clearance
```

## P. Invariants

Candidate J15 invariants:

1. Every governed mutation is evaluated as an exact capability invocation.
2. Approval/confirmation is bound to immutable materially relevant action identity.
3. A materially changed action cannot inherit prior approval.
4. Approval authority is checked against the exact action/control requirement.
5. Grant/delegation cannot exceed grantor/delegator grantable authority.
6. Approval expiry/revocation must invalidate dependent unconsumed clearance.
7. Authority changes that matter must invalidate or force re-evaluation of dependent approval/clearance.
8. One approval artifact cannot become an open-ended execution token.
9. Parent-plan approval only covers children inside immutable approved bounds.
10. Approval does not itself claim execution.
11. Execution claim must be atomic before side effects.
12. Principal lineage is preserved end to end.

## Q. Failure Matrix

To be expanded. Current priority failure classes:

- wrong approver selected
- approver lacks exact capability authority
- approval from stale action parameters
- approval after authority revocation
- approval after delegation expiry
- approval reused for changed plan step
- duplicate concurrent approval resolution
- duplicate concurrent execution following approval
- governance store read failure / fail-open behavior
- approval evidence exists but cannot be tied to exact invocation
- queue re-evaluation conflicts with prior approval
- provider timeout after side effect with ambiguous outcome

## R. Idempotency / Transactions / Concurrency

J15 inherits Axis C distinction:

```text
approval state
!= clearance
!= execution claim
!= idempotency
```

Expected-state/CAS semantics should be required for approval resolution and claim transitions where concurrency matters.

## S. Security / Privacy

Governance settings and authority/control-plane mutations deserve stronger authorization than ordinary business membership because they can expand future action capability.

Candidate principle:

> Authority to mutate governance/control-plane state must be at least as strong as the authority required for the behavior that mutation can enable.

## T. Observability

Governance trace should preserve:

- capability/action fingerprint
- control decision
- control evidence
- approver principal and authority trace
- authority version
- policy/readiness snapshot or version
- clearance issuance/invalidation
- execution claim
- outcome

## U. Proof / Test

No test is considered passing merely because a file exists.

J15 proof plan must eventually include concurrency and mutation cases, especially:

- two approvers resolving same pending item
- two executors claiming same clearance
- action parameters changed between approval and execution
- approval authority revoked before execution
- delegation expires before execution
- repeated provider request with stable idempotency key

## V. Reachability

Governance path reachability must distinguish:

- mounted endpoint
- current caller
- UI-linked path
- event/queue path
- externally callable path
- legacy/compatibility-only path

## W. Duplication

Known candidate duplication:

- KeyActionProposal approval model
- AiApprovalItem plan-step approval
- plan-level approval
- AiOversight decisions
- AutonomyOrchestrator decisions
- direct confirmation booleans
- AuthorityGrant / DelegationRule governance

Goal is not to delete duplicates reflexively but determine whether they are separate legitimate control artifacts or redundant competing governance regimes.

## X. Architecture Alignment

Current direction aligns with the macro thesis:

```text
capability
  -> authority/policy/readiness
  -> control requirement
  -> control evidence
  -> clearance
  -> execution claim
  -> execution
```

## Y. Contradictions

Initial J15 contradiction set inherited from convergence:

- C017 canonical approval claim vs multiple authority regimes
- C018 real capability risk vs generic wrapper risk
- C019 Capability Contract claims contract but execution does not consistently consume it
- C020 approval state != portable clearance
- C021 Membership has approval primitives but inconsistent consumers
- C022 coarse module scope vs fine capability permission
- C024 approver routing vs approver authority
- C025 approval state vs exact-action clearance
- C028 plan step approval vs generic EXECUTE_TOOL identity

## Z. Unknowns

1. Exact `AiApprovalItem` schema/evidence semantics.
2. Plan-level approval semantics and whether child actions are immutable at approval time.
3. Exact quick-confirm frontend/server binding.
4. Approval expiry handling across all regimes.
5. Whether approval mutation uses expected-state/CAS anywhere outside inspected proposal code.
6. Exact use of Membership `maxApprovalTier` in current approval endpoints.
7. Exact interaction between AutonomyOrchestrator and AiOversight for all surfaces.
8. Current fail-open/fail-closed behavior when all governance stores fail.
9. Which manual UI mutations bypass governance objects by design.
10. Which current control artifacts can be reconciled versus retired only after consumer proof.

## AA. Initial Findings

### F057 — AiOversight already distinguishes control requirement from simple allow/deny, but not from risk tier cleanly enough

**Status:** CURRENTLY REVALIDATED / ACTIVE

`GovernanceDecision` exposes quick-confirm, formal approval and admin approval flags, while tool risk tier drives much of that calculation.

Implication: preserve multiple control outcomes but separate `Impact/Risk Tier` from `Control Requirement` as first-class concepts.

### F058 — plan-step pre-approval can override fresh manual-control requirement through AiApprovalItem presence

**Status:** CURRENTLY REVALIDATED / ACTIVE

`evaluateAutoApproval()` treats an approved `AiApprovalItem` for the step as auto-approved after the base decision allows the tool.

Implication: J15 must prove that AiApprovalItem approval is bound to the exact immutable action and valid authority state; presence alone is insufficient target semantics.

### F059 — governance auto-execution uses minimum KEY role ceiling across grantors

**Status:** CURRENTLY REVALIDATED / FAVORABLE EXISTING RULE

Crew composition can add scope but cannot raise the auto-execution band for a tool granted by stricter roles.

Implication: retain this anti-escalation rule unless the later capability/authority model provides a stronger equivalent.

## AB. Canonical Journey Graph

Working graph:

```text
Action request/proposal
  -> CapabilityContract resolution
  -> ActionEnvelope + fingerprint
  -> EffectiveAuthority
  -> KEY autonomy / policy / readiness
  -> ControlRequirement
       -> AUTO
       -> QUICK_CONFIRM
       -> FORMAL_APPROVAL
       -> ADMIN_APPROVAL
       -> STEP_UP
       -> DELEGATION_REQUIRED
       -> BLOCK
  -> ControlEvidence
  -> invalidation checks
  -> Clearance
  -> atomic ExecutionClaim
  -> Dispatcher
  -> OutcomeEvidence
```

## AC. Machine-readable Record

```yaml
journey_id: KF-JOURNEY-015
name: Approval / Governance Lifecycle
status: SCOPING_ACTIVE
implementation_evidence:
  branch: main
  commit: e1203b34d0b3091a73657dc358508d7a14109575
inputs:
  - capability_contract
  - action_envelope
  - effective_authority
  - key_autonomy
  - readiness
  - policy
outputs:
  - control_requirement
  - control_evidence
  - clearance
  - clearance_invalidation
  - execution_claim_admission
core_distinctions:
  - risk_tier_not_equal_control_requirement
  - approval_not_equal_clearance
  - clearance_not_equal_execution_claim
  - routing_not_equal_authority
  - idempotency_not_equal_execution_claim
implementation_authorized: false
next_focus:
  - ai_approval_item
  - plan_level_approval
  - membership_approval_tier_consumption
  - confirmation_binding
  - approval_expiry_revocation
  - action_mutation_invalidation
```
