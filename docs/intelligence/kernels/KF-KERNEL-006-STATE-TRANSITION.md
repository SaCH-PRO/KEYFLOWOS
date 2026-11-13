# KF-KERNEL-006 — State Transition

Status: ACTIVE / WORKING CANONICAL KERNEL

## A. Definition / Scope

Owns the legitimacy of lifecycle changes across KeyFlowOS. Domain objects do not merely have mutable status fields; they pass through valid transitions with preconditions, authority, postconditions, evidence and audit.

## B. Product Intent

Users and KEY should see coherent lifecycle behavior regardless of which surface initiates a change.

## C. Truth Ownership

State truth remains domain-owned. This kernel owns the shared transition contract, not one global status table.

## D. Current Implementation Sources

Distributed across domain services, generic update endpoints, proposal/plan/approval services, onboarding completion, connector/payment/booking/workflow transitions and event handlers.

## E. Inputs

```text
current state
requested transition
principal
capability
preconditions
current authority/governance
resource version
```

## F. Outputs / Consumers

```text
accepted/rejected transition
post-state
state version
business event
evidence/audit
follow-on workflow
```

## G. State / Transition Semantics

Canonical form:

```text
current state
+ requested transition
+ principal
+ capability
+ preconditions
+ authority/governance
-> mutation
-> postconditions
-> evidence/event/audit
```

Examples:

- Business → ONBOARDING_COMPLETE
- Proposal → APPROVED / EXECUTING
- Plan → APPROVED / EXECUTING
- ApprovalRequest → APPROVED / REJECTED / CANCELLED
- Connector → CONNECTED
- Invoice → PAID

## H. Journey Impact Matrix

Touches all 25 journeys, with highest immediate impact on J1, J2, J15, J18, J23 and J25.

## I. Canonical Vocabulary / Contracts

- TransitionCommand
- ExpectedState / expected version
- Preconditions
- Postconditions
- TransitionEvidence
- TransitionEvent
- InvalidTransition

## J. Authority / Governance

Transition authority must be evaluated for the actual capability/state change, not inferred from ability to PATCH a generic object.

## K. Transactions / Concurrency / Idempotency

Expected-state CAS or equivalent atomic transition semantics are required where concurrent actors can race.

Current J15 examples show read-then-update approval resolution and proposal/request transitions that do not universally prove one-winner expected-state ownership.

## L. Failure / Recovery

Required explicit outcomes include:

- precondition failed;
- stale state/version;
- unauthorized transition;
- already transitioned/idempotent replay;
- partial follow-on failure;
- outcome unknown where external effect exists.

## M. Security / Privacy

Generic property mutation must not bypass lifecycle authority or evidence requirements.

## N. Evidence / Observability

Every important lifecycle transition should record:

```text
from
-> to
requestedBy
performedBy
capability
reason/evidence
resource version
correlation/causation
```

## O. Reachability / Consumers

Consumer mapping is journey-driven because transition logic is currently distributed and sometimes duplicated.

## P. Duplication / Legacy / Compatibility

Known pattern: both dedicated transition methods and generic update endpoints can mutate lifecycle-relevant fields.

Specialized workflows also maintain parallel state machines that require explicit synchronization semantics when linked.

## Q. Invariants

1. Lifecycle state is produced by a valid transition, not arbitrary property mutation.
2. Transition preconditions and authority are evaluated on the state/resource version being mutated.
3. Competing transition claimants cannot both win when the transition is exclusive.
4. Follow-on events represent committed state.
5. Cross-object dependent state changes have an explicit atomicity/compensation model.
6. Linked workflow states must not masquerade as synchronized unless synchronization is actually enforced.

## R. Findings

Relevant findings include F007, F029, F039–F043, F055, F062–F063, F066, F071 and F074.

## S. Contradictions

Relevant contradictions include lifecycle command vs generic patch, approval state vs plan-step state, and shadow proposal vs ApprovalRequest state.

## T. Open Questions

- which lifecycle fields currently have generic writers;
- canonical expected-version/CAS mechanism;
- transaction/event-outbox relationship;
- rules for cross-aggregate transitions.

## U. Target-State Candidate

Use domain-specific transition commands/services that conform to a shared transition contract and produce evidence/events. Do not create one giant transition service that owns all domain semantics.

## V. Migration / Compatibility

Characterize existing generic mutation behavior before tightening. Add transition commands/guards, migrate callers, then prohibit lifecycle-field generic patching.

## W. Proof / Test Ratchets

Eventually prove invalid transitions, concurrent transitions, stale-tab mutations, duplicate requests and event-after-commit behavior for critical lifecycles.

## X. Layered Improvement

L0: correct lifecycle behavior.
L1: validation, authorization, transactions, CAS, audit.
L2: shared transition contract across domains.
L3: causal/version-aware state graph and reversible/compensable transitions.
L4: KEY can explain and simulate legitimate next business-state transitions before acting.

## Y. Machine-readable Record

```yaml
id: KF-KERNEL-006
name: State Transition
status: working-canonical
implementation_authorized: false
```
