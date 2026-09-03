# KF-KERNEL-011 — Recovery & Reliability

Status: ACTIVE / DIRECTIONALLY CONVERGED / NOT FROZEN

## A. Definition / Scope

Owns execution ownership, idempotency, retries, crash recovery, leases, compensation, partial failure, reconciliation and recovery behavior across side-effecting journeys.

## B. Product Intent

A business action should happen at most as intended, recover predictably from failure, and remain explainable even when networks, workers, providers or users retry concurrently.

## C. Truth Ownership

Working distinctions:

```text
Clearance
= action may execute

ExecutionClaim
= one execution process owns consumption of that clearance

Idempotency
= duplicate request/effect semantics and replay behavior

Queue dedupe
= transport-local duplicate suppression
```

These are not interchangeable.

## D. Current Implementation Sources

Primary seams include ActionDispatcherService, KeyIdempotencyService, PlanExecutor/BullMQ, proposal execution, SafetyShell, Flow direct execution and provider-specific idempotency/retry behavior.

## E. Inputs

- exact ActionEnvelope/fingerprint;
- Clearance;
- idempotency key/request hash;
- execution claimant;
- attempt number;
- provider idempotency capability;
- retry policy;
- previous outcome/evidence.

## F. Outputs / Consumers

- atomic ExecutionClaim;
- attempt ownership;
- replayed prior result;
- retry admission/denial;
- lease/crash recovery state;
- compensation/reconciliation work;
- final/unknown outcome.

## G. State / Transition Semantics

Working execution lifecycle:

```text
CLEARANCE_GRANTED
-> CLAIMED
-> RUNNING
-> SUCCEEDED
   | FAILED_RETRYABLE
   | FAILED_FINAL
   | OUTCOME_UNKNOWN
```

Claim may also expire/release under explicit lease/crash semantics.

## H. Journey Impact Matrix

J18 is the anchor journey, but this kernel affects every side-effecting journey, especially J2, J3, J4, J6, J10, J13, J14, J15 and J23.

## I. Canonical Vocabulary / Contracts

- ExecutionClaim
- Claimant
- Lease
- Attempt
- IdempotencyKey
- RequestHash
- ProviderIdempotencyKey
- RetryPolicy
- Compensation
- Reconciliation
- OutcomeUnknown

## J. Authority / Governance

Only a valid unconsumed Clearance may be claimed. Claim ownership must not expand the action/authority beyond the clearance fingerprint/bounds.

## K. Transactions / Concurrency / Idempotency

Candidate key semantics:

```text
KEY ABSENT
-> atomic claim

KEY PENDING/CLAIMED
-> IN_PROGRESS, do not execute concurrently

KEY COMPLETE
-> replay stored result

KEY FAILED
-> explicit retry policy

SAME KEY + DIFFERENT REQUEST HASH
-> reject
```

Current KeyIdempotencyService behavior that allows another caller to proceed while pending is not a sufficient execution claim.

## L. Failure / Recovery

Must handle:

- concurrent direct/queue/proposal execution;
- worker crash after claim;
- crash after provider effect but before local commit;
- provider timeout/unknown outcome;
- retries after partial local mutation;
- duplicate webhooks/events;
- stale claims/leases;
- compensation failures.

## M. Security / Privacy

Claims/idempotency keys must be tenant/action-bound and must not permit cross-business replay or action substitution.

## N. Evidence / Observability

Every attempt should preserve:

```text
claim ID
claimant
fingerprint
attempt
started/finished time
provider request/idempotency reference
result/outcome
retry/compensation/reconciliation state
```

## O. Reachability / Consumers

Current execution remains distributed across ActionDispatcher, proposal/plugin execution, PlanExecutor/BullMQ and reachable direct Flow execution.

## P. Duplication / Legacy / Compatibility

Current mechanisms include durable KeyIdempotencyService, BullMQ deterministic job IDs and SafetyShell process-local duplicate blocking. They solve different subsets and should not be mistaken for one canonical ownership model.

## Q. Invariants

1. Clearance is not execution ownership.
2. Exactly one claimant may consume a single-use clearance at a time.
3. Same idempotency key with a materially different request is rejected.
4. Transport dedupe is not platform-wide ownership.
5. Provider idempotency and internal claim are both required where applicable.
6. Ambiguous provider outcome triggers reconciliation before unsafe retry.
7. Direct execution paths must not bypass the canonical post-clearance ownership boundary.
8. Crash recovery has explicit lease/attempt semantics.

## R. Findings

Primary current findings include F041–F043 and F050–F056, with J15 state-transition findings F062, F071 also relevant.

## S. Contradictions

Primary candidates C025–C028 and C037 intersect this kernel.

## T. Open Questions

- exact storage/transaction mechanism for atomic claims;
- lease duration/recovery rules;
- which actions are single-consumption versus repeatable under same clearance;
- provider-specific reconciliation/idempotency contracts;
- how hierarchical plan clearance maps to child claims.

## U. Target-State Candidate

```text
exact ActionEnvelope + Clearance
-> atomic durable ExecutionClaim
-> ActionDispatcher as canonical post-clearance seam
-> domain/provider execution
-> Outcome/Evidence
```

The preferred direction is to strengthen ActionDispatcher rather than invent a parallel execution fabric.

## V. Migration / Compatibility

Inventory every current executor and direct Flow caller. Route consumers through canonical claim/dispatcher semantics incrementally while preserving provider and legacy behavior until proof exists.

## W. Proof / Test Ratchets

Eventually prove:

- concurrent callers yield one execution owner;
- direct+queue race yields one effect;
- same key/different hash rejects;
- completed response replays;
- worker crash recovers safely;
- provider timeout does not double-charge/double-send;
- stale claims can recover without concurrent execution;
- every high-impact executor passes through the ownership boundary.

## X. Layered Improvement

L0: prevent duplicate/contradictory side effects.
L1: durable idempotency, atomic claims, retries, transactions, reconciliation.
L2: one post-clearance execution ownership model.
L3: leases, provider-aware reconciliation, compensating workflows and causal attempt history.
L4: KEY can reliably recover long-running business operations and explain what is safe to retry, reconcile or escalate.

## Y. Machine-readable Record

```yaml
id: KF-KERNEL-011
name: Recovery & Reliability
status: directionally-converged-not-frozen
implementation_authorized: false
```
