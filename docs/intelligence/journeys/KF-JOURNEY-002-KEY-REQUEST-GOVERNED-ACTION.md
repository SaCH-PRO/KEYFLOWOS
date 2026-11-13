# KF-JOURNEY-002 — KEY Request → Governed Action

Status: PARTIALLY_MODELLED / CONVERGENCE REQUIRED

Source basis: recovered prior-thread analysis plus continuation-thread preservation. Commit-sensitive implementation claims must be revalidated before execution work.

## A. Definition

This journey models the path from a human or system request for KEY to perform or coordinate a business action through capability identification, authority evaluation, policy/governance, approval or confirmation, clearance, execution exclusivity, domain execution and outcome/evidence capture.

## B. Product intent

KEY should create intelligence and useful action without becoming unchecked authority.

The desired causal path is:

```text
request / intent
  -> KEY reasoning
  -> capability identity
  -> impact classification
  -> principal + human authority
  -> KEY autonomy/delegation
  -> readiness + policy
  -> control requirement
  -> approval/confirmation if needed
  -> exact-action clearance
  -> execution claim
  -> executor
  -> business state transition
  -> evidence/outcome
```

Critical invariant direction:

> THE THING APPROVED = THE THING EXECUTED.

## C. Actors

Candidate actors/principals:

- requesting human
- approving human
- KEY / KEY role or crew
- plan/proposal service
- policy/governance services
- execution dispatcher
- queue worker
- domain service / connector
- external provider

Principal lineage should not be collapsed into one actor field. Working lineage:

- requestedBy
- proposedBy
- approvedBy
- executedBy
- executedFor
- delegatedBy

## D. Entry surfaces

Recovered relevant surfaces include:

- KEY/Cortex action proposal flows
- Flow chat / tool invocation
- Graph action execution
- AI plan approval/execution
- queue-driven plan execution
- direct Flow plan execution

Exact current routes/components must be revalidated against the current branch.

## E. State-machine target

Working semantic state model:

```text
REQUESTED
  -> PROPOSED
  -> POLICY_EVALUATED
  -> CONTROL_REQUIRED
      -> AUTO_ALLOWED
      -> DIRECT_HUMAN_ALLOWED
      -> QUICK_CONFIRM_PENDING
      -> FORMAL_APPROVAL_PENDING
      -> ADMIN_APPROVAL_PENDING
      -> STEP_UP_PENDING
      -> DELEGATION_REQUIRED
      -> BLOCKED
  -> CLEARED
  -> CLAIMED
  -> RUNNING
  -> SUCCEEDED | FAILED | CANCELLED | EXPIRED
```

Current implementation does not yet appear to enforce this as one unified state machine.

## F. Capability mapping

Recovered implementation seam: `apps/server/src/modules/capabilities/capability-contract.service.ts`.

The existing contract reportedly projects stable capability information including:

- name
- version
- owner module
- schemas
- risk tier
- permission
- approval requirement
- execution mode
- idempotency
- family
- manual equivalent
- changed entities

Working direction: strengthen this seam before inventing a parallel action registry.

### Known capability-identity weakness

High-impact plan steps could be wrapped under generic `EXECUTE_TOOL`, with the underlying `toolName`/arguments inside payload. This can cause proposal-level governance to evaluate the wrapper rather than the true business capability.

Recovered concrete example: `payments_refund_charge` was a real Tier-3/high Flow tool while proposal wrapping could collapse it under generic EXECUTE_TOOL semantics.

## G. Impact tier vs control requirement

Do not conflate action impact with the control required for one invocation.

Possible control decisions:

- AUTO
- DIRECT_HUMAN
- QUICK_CONFIRM
- FORMAL_APPROVAL
- ADMIN_APPROVAL
- STEP_UP_AUTH
- EXPLICIT_DELEGATION
- BLOCK

Human authority and KEY autonomy are separate inputs.

## H. Human authority

Recovered problems:

- proposal controller routes could be guarded at business level without consistent approval-tier requirements;
- lower-risk plan approval did not appear to enforce equivalent Membership approval-tier semantics to higher tiers;
- different governance surfaces used different human-authority logic;
- Membership, JobRole, copied scopes/tier, grants and delegations lacked one central effective-authority resolver.

J2 therefore depends directly on J25.

## I. KEY autonomy / governance

Recovered current strengths included `AiOversightService` role ceilings and a non-escalation pattern where multi-role crew used the minimum relevant autonomy ceiling rather than the maximum.

Recovered weakness: KEY role/autonomy governance was not universally combined with human capability authorization across all execution paths.

Recovered `KeyAutonomySafetyService` controls included kill switch, daily autonomous-action limit, spend cap and max tier without approval, but these controls did not appear universally consumed by all Flow/direct execution paths.

## J. Governed Action Envelope

Working normalized action concept:

```text
GovernedAction {
  identity
  capability
  principal
  humanAuthority
  parameters
  knowledgeContext
  operatingContext
  policy
  clearance
}
```

Potential clearance metadata:

- decision
- requiredApproverTier
- confirmationRequirements
- ruleTrace
- policyVersion
- actionFingerprint
- expiry

Name is not frozen.

## K. Approval / confirmation binding

Working action fingerprint:

```text
hash(
  businessId
  + capabilityName
  + capabilityVersion
  + normalizedParameters
  + affectedEntities
  + riskTier
)
```

Material mutation should invalidate prior approval/clearance.

Recovered Flow-chat behavior narrowed an earlier concern: the server re-evaluated governance against the supplied real tool and routed formal/admin actions to approval, so the path was not simply “arbitrary ungoverned tool execution.” The remaining weakness was that client-supplied confirmation data was not proven to match an immutable server-stored pending action.

## L. Plan / hierarchical clearance

Recovered behavior:

- plan approval could act as broad child authorization;
- formal-approval-required child steps could still generate approval items;
- Tier-2 quick confirmations could be treated as implicitly satisfied by the approved plan.

Working target:

> An approved parent plan may authorize child actions only when the exact child capability identities and material parameters remain inside the approved snapshot/bounds.

Material change -> new clearance.

## M. Clearance

Clearance answers:

> Is this exact action presently authorized to execute?

It should incorporate at least:

- exact capability identity/version
- normalized material parameters
- principal/effective human authority
- KEY delegation/autonomy
- readiness
- policy
- approval/confirmation evidence
- current business/resource context
- expiry/revocation conditions

Approval state alone is not automatically portable clearance.

## N. Execution claim

Execution exclusivity is distinct from clearance.

Target:

```text
CLEARANCE_GRANTED
  -> atomic claim
  -> CLAIMED
  -> RUNNING
  -> SUCCEEDED / FAILED
```

Recovered problem classes:

- proposal execute races
- approve/reject/execute read-then-write races
- direct plan execution vs queue worker races
- pending idempotency keys treated as new work
- retries / provider idempotency
- crash recovery

## O. Execution seams

### ActionDispatcherService

Recovered strengths:

- retries
- circuit breaker
- idempotency key
- execution logging
- undo registration
- feedback integration

Recovered limitation: not itself a complete clearance boundary; governance decision flags could be consumed incompletely.

Working direction: potentially evolve into canonical post-clearance executor if revalidation supports it.

### SafetyShell

Recovered as process-local/in-memory idempotency plus limited rollback/compensation. Useful local safeguard, not a distributed execution guarantee.

### KeyIdempotencyService

Recovered durable idempotency existed, but pending/in-progress behavior and requestHash equality did not yet amount to a strong distributed single-executor claim.

## P. Recovered provisional findings

High-confidence historical IDs:

- F029 canonical proposal controller approval/execution under-authorized
- F030 approval confirmation booleans can be hard-coded instead of evidence-backed
- F031 proposal/execution actor provenance drift
- F032 parallel governance regimes
- F033 generic EXECUTE_TOOL loses underlying capability identity/risk
- F034 payments_refund_charge Tier 3 → generic wrapper risk collapse
- F035 CapabilityContract exists but is non-load-bearing
- F036 AI approval resolver and proposal controller use different human authority semantics
- F037 canonical proposal has riskLevel but no riskTier; resolver may default to Tier 2
- F038 plan approval only strongly enforces role for Tier 4
- F039 canonical AI_PLAN proposal approval can re-enter evaluation/re-proposal
- F040 ActionDispatcher ignores approval-required flags as standalone boundary
- F041 proposal transition concurrency weakness / no CAS
- F042 SafetyShell in-memory idempotency and weak compensation
- F043 ordinary Flow direct execution does not universally pass KeyAutonomySafety

Later findings without reliable historical F-numbers must remain unnumbered until source recovery.

## Q. Recovered contradictions

- C017 canonical approval claim vs multiple authority regimes
- C018 real capability risk vs generic proposal-wrapper risk
- C019 Capability Contract claims platform contract but execution does not consume it
- C020 approval state != portable clearance
- C021 Membership has approval primitives but many approval surfaces do not consistently consume them

## R. Dependencies on J25

J2 cannot be canonicalized until effective human authority is coherent.

Required answer shape:

```text
principal
  + business
  + Membership
  + base role
  + JobRole/position
  + explicit overrides
  + denials
  + delegations/grants
  + approval tier
  + capability
  + resource/context
  -> effective human authority
```

## S. Open questions

1. What is the canonical capability-permission vocabulary?
2. Which authority sources may expand vs only narrow authority?
3. What exact mutations invalidate clearance?
4. Should `ActionDispatcherService` become the canonical post-clearance executor?
5. Should direct synchronous Flow plan execution survive convergence with queue execution?
6. What is the atomic claim mechanism/state machine?
7. How should provider-side idempotency integrate with internal execution claims?
8. What is the canonical principal-lineage representation?
9. How are hierarchical approvals represented and invalidated?
10. Which controls are universal vs path-specific today?

## T. Current next step

Do not fully open J15 yet.

Converge J2 with J25 and J1 around:

- Membership-first tenant identity;
- effective authority algebra;
- stable capability identity;
- exact-action clearance;
- concurrency-safe execution claim;
- canonical post-clearance dispatcher semantics.
