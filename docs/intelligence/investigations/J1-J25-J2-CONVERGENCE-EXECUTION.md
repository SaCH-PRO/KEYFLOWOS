# J1 ↔ J25 ↔ J2 Convergence — Clearance, Execution Claim, Dispatcher

Status: ACTIVE CONVERGENCE / CANDIDATE TARGET

Implementation evidence baseline: `main` at `e1203b34d0b3091a73657dc358508d7a14109575`.

Scope: converge proposal execution, plan execution, BullMQ workers, direct Flow execution, retries and idempotency around one exact-action clearance + atomic execution claim + canonical post-clearance dispatcher.

No production-code changes are authorized by this document.

---

## 1. Question being solved

KeyFlowOS needs one answer to:

> Once this exact action has been authorized, which executor is allowed to consume that authorization, exactly once, under what immutable action identity, and how is the durable outcome recorded?

Approval, idempotency and queueing do not answer the same question.

---

## 2. Current implementation evidence revalidated

### 2.1 ActionDispatcherService is a strong execution seam, but not a clearance boundary

Current dispatcher provides:

- circuit breaker
- lookup-based idempotency using `AiExecutionLog`
- fresh `AiOversightService.evaluate()` governance check
- retries
- direct call to `FlowOrchestratorService.executeToolDirectly()`
- execution log
- action events
- optional undo registration
- feedback loop for plan steps

Interpretation: this is a promising post-governance execution seam.

But it does not consume a durable exact-action clearance artifact and does not atomically claim a clearance before executing.

Its governance call re-evaluates the tool name at dispatch time rather than consuming a prior immutable approved invocation.

### 2.2 Dispatcher idempotency is outcome lookup, not a single-executor claim

`ActionDispatcherService.findIdempotentExecution()` searches `AiExecutionLog` for a completed prior record by `businessId + idempotencyKey`.

Two concurrent dispatchers can both observe no execution log before either has written the final log and both proceed.

Interpretation: duplicate-after-completion protection is not equivalent to mutual exclusion before side effect.

### 2.3 KeyIdempotencyService also does not provide an atomic execution claim

`KeyIdempotencyService.check()` creates a pending key when absent.

If the key already exists in `pending`, current behavior explicitly returns `status: 'new'` so another caller may proceed (`last-writer-wins`).

Interpretation: despite its idempotency purpose, pending state is intentionally not an exclusive claim.

This is strong evidence for the architectural distinction:

```text
idempotency != execution claim
```

### 2.4 PlanExecutorService and BullMQ form a stronger execution path, but approval is re-evaluated multiple times

Plan execution currently:

1. scans approved/executing plans;
2. evaluates each step through autonomy/governance;
3. if formal/admin approval is required, creates a `KeyActionProposal` with generic `actionType: EXECUTE_TOOL` and embeds tool name/input in payload;
4. otherwise enqueues a BullMQ job with deterministic `jobId` / idempotency key `plan:<planId>:step:<stepId>`;
5. queue worker re-checks `governance.evaluateAutoApproval()`;
6. worker dispatches through `ActionDispatcherService`;
7. dispatcher performs another governance evaluation.

Interpretation: the path has useful layered safety but no single immutable clearance state consumed exactly once. Multiple governance evaluations can legitimately produce a different answer as state changes, but the architecture does not distinguish "approval invalidated" from "fresh governance check disagreed" through a durable clearance artifact.

### 2.5 BullMQ jobId deduplication is useful but not universal

Plan step jobs use a deterministic job ID derived from the plan and step.

This narrows duplicate enqueueing within this queue topology.

But not all execution paths use BullMQ, and job uniqueness does not prevent a different direct execution surface from executing the same underlying action.

Interpretation: queue-level dedupe is transport-local, not platform-level action claiming.

### 2.6 KeyActionProposal execution uses read-then-write transitions

Current proposal flow:

```text
get proposal
verify PENDING / APPROVED
update status
perform execution
update final status
```

For approval/rejection/execution, state predicates are checked before later updates rather than enforced as atomic expected-state transitions in the observed code.

Before execution, proposal status is changed to `EXECUTING`, but this follows a prior read of `APPROVED` and is not itself an atomic claim conditioned on `status=APPROVED`.

Interpretation: proposal `EXECUTING` approximates a claim state semantically, but current transition mechanics do not prove single-consumer ownership under concurrency.

### 2.7 Proposal execution uses a separate executor stack

`KeyActionProposalService.execute()` calls `KeyActionExecutorService` after autonomy and Genome checks.

`KeyActionExecutorService` uses:

- `SafetyShellService`
- action-type plugin registry / direct handlers
- audit
- rollback attempt

It does not route through `ActionDispatcherService` as the canonical post-clearance executor.

Interpretation: there are at least two substantial execution fabrics:

```text
proposal -> KeyActionExecutorService -> SafetyShell/plugins

plan queue -> ActionDispatcherService -> FlowOrchestrator.executeToolDirectly
```

### 2.8 Direct Flow execution remains callable outside ActionDispatcher

Current repository references to `FlowOrchestratorService.executeToolDirectly()` include:

- `ActionDispatcherService`
- `ConversationalAiService`
- Key Cortex action-executor plugin
- Key Cortex efferent bridge
- FlowOrchestrator itself

Interpretation: ActionDispatcher is not yet a universal post-governance choke point.

### 2.9 Exact capability identity is still lossy in generic proposal wrappers

PlanExecutor can create proposals with:

```text
actionType = EXECUTE_TOOL
payload.toolName = exact tool
```

The underlying capability is present in payload, but proposal policy/risk is initially driven through the generic action type path rather than necessarily through the exact Capability Contract as the primary governance identity.

Interpretation: J2 should bind clearance to the exact `CapabilityContract` name/version + canonical parameters, not a generic wrapper label.

---

## 3. Refined architecture concepts

### 3.1 Action Envelope

Working target object before governance:

```text
ActionEnvelope {
  businessId
  capabilityName
  capabilityVersion
  normalizedParameters
  affectedEntities
  requestedBy
  proposedBy
  executingFor
  sourceContext
}
```

### 3.2 Action Fingerprint

Candidate:

```text
fingerprint = hash(
  businessId
  + capabilityName
  + capabilityVersion
  + canonical(normalizedParameters)
  + canonical(affectedEntities)
  + material policy/risk identity as required
)
```

The fingerprint identifies the exact materially approved invocation.

If material parameters/entities/capability version change, previous approval/clearance does not transfer.

### 3.3 Clearance

Clearance answers:

> May this exact ActionEnvelope execute now?

Candidate clearance binds:

- action fingerprint
- capability contract
- human EffectiveAuthority result/version
- KEY autonomy/delegation result if applicable
- policy/readiness result
- required approval/confirmation evidence
- principal lineage
- bounds/constraints
- issuance/expiry
- invalidation/revocation state

Approval is an input to clearance, not the clearance itself.

### 3.4 Execution Claim

Execution Claim answers:

> Which executor may consume this clearance?

Target invariant:

```text
one clearance
  -> at most one active successful claim generation for the exact action
```

This must be a durable atomic state transition, not a read-then-write check.

### 3.5 Dispatcher

Candidate canonical role:

> ActionDispatcherService becomes the post-clearance execution fabric, after being adapted to consume a claimed clearance rather than independently rediscovering approval/governance state.

It may retain:

- circuit breaker
- retry policy
- execution logging
- feedback
- undo/compensation hooks
- domain/provider routing

But authorization must be upstream and bound to the exact invocation.

---

## 4. Candidate lifecycle/state machine

```text
DRAFT_ACTION
  -> GOVERNANCE_EVALUATING
  -> CONTROL_REQUIRED | CLEARANCE_DENIED | CLEARANCE_GRANTED

CONTROL_REQUIRED
  -> PENDING_CONFIRMATION / PENDING_APPROVAL
  -> CLEARANCE_DENIED | CLEARANCE_GRANTED

CLEARANCE_GRANTED
  -> CLAIMED              [atomic expected-state transition]
  -> RUNNING
  -> SUCCEEDED
  -> FAILED_RETRYABLE
  -> FAILED_FINAL
  -> OUTCOME_UNKNOWN

CLEARANCE_GRANTED
  -> EXPIRED / REVOKED / INVALIDATED
```

Important rule:

`CLAIMED` is not the same as `RUNNING`; claiming establishes consumption ownership before external side effects begin.

---

## 5. Atomic claim semantics

Candidate persistence invariant:

```text
UPDATE clearance_or_execution_record
SET state='CLAIMED', claimant=<executor>, claimedAt=now
WHERE id=<clearanceId>
  AND state='CLEARANCE_GRANTED'
  AND expiresAt > now
  AND invalidatedAt IS NULL
```

Proceed only if exactly one row was updated.

Equivalent compare-and-swap/transactional semantics are acceptable.

A queue job, API worker, direct synchronous request and recovery worker must all compete through this same claim boundary.

---

## 6. Retry semantics

A failed attempt should not create a fresh independent clearance by default.

Candidate distinction:

```text
logical execution claim
  -> one exact approved action

attempts
  -> retry generations within that claim
```

Retry requires preserving:

- same action fingerprint
- same clearance bounds
- same principal lineage
- same provider idempotency identity where available

If action semantics materially change, create a new action envelope and require new clearance.

For ambiguous provider outcomes (`timeout after request sent`), state should be `OUTCOME_UNKNOWN` rather than blindly retrying until provider reconciliation determines whether side effect occurred.

---

## 7. Provider-side idempotency

Platform claim prevents internal double execution attempts from independent workers.

Provider idempotency protects against duplicate side effects when the provider receives retries.

Both are required where supported:

```text
atomic internal execution claim
  + stable provider idempotency key derived from execution/action identity
```

Do not substitute one for the other.

---

## 8. Clearance invalidation

Candidate invalidators:

- action fingerprint changes
- capability version changes incompatibly
- approving/requesting authority revoked or materially reduced when policy requires live authority
- explicit denial introduced
- delegation/grant expires or is revoked
- required readiness/policy facts materially change
- approval expires
- Business suspended/deleted
- external credential/connector necessary for action revoked

Need J15 to define which changes require immediate invalidation versus re-evaluation at claim/execution.

---

## 9. Principal lineage

Execution record should preserve distinct principals:

```text
requestedBy
proposedBy
approvedBy[]
executedFor
claimantExecutor
executedBy
KEY delegation/grant source
```

Do not collapse these into one `userId` or `executedBy` field.

---

## 10. Hierarchical plan clearance

A parent plan approval may authorize child actions only when the parent approval contains immutable bounds covering the exact child action fingerprints/capabilities and allowed parameter ranges.

Candidate models:

A. enumerate exact child fingerprints at approval time; or
B. approve a signed/bounded plan envelope whose child derivation is deterministic and constrained.

A child materially outside approved bounds requires separate clearance.

This prevents "approve plan" from becoming an open-ended execution token.

---

## 11. Existing seam decision

### ActionDispatcherService

Status: FAVORABLE EXISTING SEAM / CANDIDATE CANONICAL POST-CLEARANCE DISPATCHER.

Do not build `ActionDispatcherV2` by default.

Required evolution before it can become canonical:

1. accept/validate claimed clearance identity;
2. stop treating fresh tool-name governance evaluation as the sole authorization boundary;
3. consume exact Capability Contract identity/version;
4. use durable claim/attempt state instead of completed-log lookup as concurrency boundary;
5. preserve principal lineage;
6. route all materially equivalent action execution surfaces through it or through a shared lower-level execution core with identical claim semantics.

### KeyIdempotencyService

Status: REUSABLE DATA/OUTCOME SEAM, NOT EXECUTION CLAIM.

Its pending behavior must not be mistaken for exclusive ownership.

### SafetyShellService

Status: LOCAL PROPOSAL-EXECUTION SAFETY SEAM, NOT UNIVERSAL GOVERNANCE/CLEARANCE.

Potential future role: downstream execution safety/compensation component consumed by canonical dispatcher for relevant capability families.

---

## 12. New current findings

### F050 — ActionDispatcher idempotency lookup is not concurrency-safe execution claiming

**Status:** CURRENTLY REVALIDATED / ACTIVE

It checks completed execution log before side effect but does not reserve the action atomically before execution.

### F051 — KeyIdempotencyService explicitly permits concurrent pending callers

**Status:** CURRENTLY REVALIDATED / ACTIVE

Pending keys return `new`, so the service cannot serve as a single-consumer claim primitive in current form.

### F052 — plan execution re-evaluates governance at multiple layers without one portable clearance artifact

**Status:** CURRENTLY REVALIDATED / ACTIVE

PlanExecutor, Queue worker and ActionDispatcher each perform governance/autonomy checks.

### F053 — proposal execution and plan/dispatcher execution remain separate execution fabrics

**Status:** CURRENTLY REVALIDATED / ACTIVE

Proposal uses KeyActionExecutor/SafetyShell/plugins; queued plan uses ActionDispatcher/FlowOrchestrator.

### F054 — FlowOrchestrator direct execution remains reachable outside dispatcher

**Status:** CURRENTLY REVALIDATED / ACTIVE

Multiple current callers directly invoke `executeToolDirectly()`.

### F055 — proposal EXECUTING state is not proven as atomic expected-state claim

**Status:** CURRENTLY REVALIDATED / ACTIVE

Current execution performs read status check then later update to EXECUTING.

### F056 — deterministic BullMQ job IDs provide transport-local dedupe, not platform-wide action ownership

**Status:** CURRENTLY REVALIDATED / ACTIVE

Useful existing mechanism, but bypassable by other execution surfaces.

---

## 13. New contradiction candidates

### C025 — approval state vs exact-action clearance

Current proposal/plan states carry approval, while execution paths separately re-evaluate governance. Neither model alone is a portable exact-action authorization artifact.

### C026 — idempotency semantics vs execution ownership

Existing services use idempotency to recover/avoid duplicate outcomes but permit race windows or concurrent pending execution; target architecture needs atomic ownership before side effect.

### C027 — canonical dispatcher aspiration vs direct executor reachability

ActionDispatcher has strong execution mechanics but FlowOrchestrator and proposal executor paths remain directly reachable.

### C028 — plan step approval vs generic EXECUTE_TOOL identity

Exact tool identity exists in payload but generic action type remains a materially separate governance identity.

---

## 14. Directional convergence result

Axis C is now:

`DIRECTIONALLY CONVERGED / NOT FROZEN`

High-confidence target direction:

```text
CapabilityContract
  -> canonical ActionEnvelope
  -> action fingerprint
  -> EffectiveAuthority + KEY autonomy + readiness/policy
  -> control requirement
  -> approval/confirmation evidence
  -> exact-action CLEARANCE
  -> atomic EXECUTION CLAIM
  -> canonical post-clearance dispatcher
  -> domain/provider execution
  -> durable outcome/evidence
```

Unresolved before freezing:

1. exact durable schema for clearance + claim + attempt records;
2. exact boundary between dispatcher and domain-specific execution adapters;
3. provider-specific idempotency/reconciliation rules;
4. which authority/policy changes invalidate already-issued clearance;
5. plan parent/child clearance representation;
6. migration path from generic KeyActionProposal action types to exact capabilities;
7. treatment of currently direct synchronous UI/Flow calls that legitimately need immediate response;
8. whether SafetyShell mechanics merge into dispatcher or remain a downstream adapter.

---

## 15. Cross-journey feed-back

### J25

Effective Authority result should expose an `authorityVersion` / fingerprint suitable for clearance binding and invalidation.

### J1

Founding owner authority must be resolvable before any post-birth KEY action can receive clearance.

### J2

J2 can now be reframed around one exact action rather than parallel proposal/plan/tool abstractions:

```text
request/proposal
  -> exact capability/action
  -> authority/policy/readiness
  -> control/approval
  -> clearance
  -> claim
  -> dispatch
  -> outcome
```

---

## 16. J15 admission impact

The three convergence axes now have a coherent directional model:

A. Membership-first tenancy
B. Effective human authority algebra
C. exact-action clearance + atomic execution claim + canonical dispatcher

However all three remain `NOT FROZEN`, especially around compatibility mapping, invalidation semantics and migration.

Recommended current J15 verdict:

`READY_FOR_SCOPING, NOT READY_FOR IMPLEMENTATION DESIGN`

Reason: J15 can now be opened to analyze approval/governance lifecycle using stable conceptual distinctions, while no production implementation should be authorized until J15 resolves clearance issuance/invalidation and control-evidence semantics.
