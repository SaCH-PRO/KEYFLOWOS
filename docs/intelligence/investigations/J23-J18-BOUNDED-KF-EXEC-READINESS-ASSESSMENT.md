# J23 + J18 — Bounded KF-EXEC Readiness Assessment

Status: EXECUTION-PACKET READINESS / **NO IMPLEMENTATION AUTHORIZATION**
Implementation evidence: `main@168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Code-bearing forensic baseline: `d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Assessment date: 2026-09-05

Prerequisites completed:

- semantic convergence;
- exact source/status mapping;
- live-row migration strategy;
- provider idempotency/reconciliation matrix;
- recovery authority representation;
- Temporal Work Projection strategy;
- 39-obligation proof inventory;
- active-constellation backward re-audit.

> Readiness to **write a bounded implementation packet** is not authorization to modify production code.

---

# 1. Decision

A bounded implementation packet is now architecturally justified for **one narrow vertical slice**.

Recommended first slice:

> **OutboundDelivery → Resend email only: effect identity, durable attempt ownership, provider idempotency, post-provider crash certainty, and consequence repair.**

Decision code:

```text
KF-EXEC PACKET DRAFTING                    = READY
PRODUCTION IMPLEMENTATION                  = NOT AUTHORIZED
PLATFORM-WIDE J23/J18 MIGRATION             = NOT READY / NOT REQUESTED
UNIVERSAL WORK/RECOVERY TABLE               = REJECTED FOR FIRST SLICE
WORKFLOW ENGINE                             = REJECTED FOR FIRST SLICE
RECOVERY CONTROL TWIN PRODUCTION ENABLEMENT = DEFER
K10 FINANCIAL SLICE                         = DEFER UNTIL EXTERNAL-EFFECT CORE PROVEN
```

The purpose of the first slice is **architectural falsification**, not feature breadth.

---

# 2. Candidate comparison

Scoring is directional, not a substitute for engineering judgment. `5` means favorable for a first bounded slice.

| Candidate | Existing seam reuse | Known defect pressure | Core falsification value | Deterministic proofability | Migration containment | Provider contract clarity | Authority coverage | Consequence coverage | Kill/rollback containment | First-slice verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| **A. OutboundDelivery + Resend only** | 5 | 5 | 5 | 5 | 4 | 5 | 2 | 4 | 5 | **SELECT** |
| B. AiPlanStep + ActionDispatcher + BullMQ | 5 | 5 | 4 | 5 | 4 | 1 | 5 | 2 | 4 | SECOND |
| C. WebhookEvent apply-state + one payment provider | 4 | 5 | 5 | 5 | 3 | 5 | 1 | 4 | 3 | THIRD / compose later |
| D. Payment/refund + full K10 convergence | 4 | 5 | 5 | 4 | 2 | 5 | 5 | 5 | 2 | HIGH VALUE, TOO BROAD/RISKY FIRST |

## Why A wins

It forces KeyFlow to prove several of the hardest architecture claims at once while staying bounded to a non-financial provider effect:

```text
stable effect identity
+ exclusive attempt ownership
+ provider-native idempotency
+ provider operation evidence
+ crash after provider point-of-no-return
+ local consequence repair
+ no duplicate irreversible external effect
+ tenant-scoped durable evidence
```

It also has unusually strong containment:

- existing `OutboundDelivery`/`DeliveryEvent` seams;
- existing adapter registry;
- existing Resend adapter;
- provider returns a stable email ID;
- provider supports client idempotency keys according to the already-canonical provider matrix;
- existing `MARKETING_ESP_FALLBACK` feature gate;
- no need to touch refunds/ledger/invoice truth in the first packet.

This is stronger than choosing an easy internal-only retry slice merely because it is familiar.

---

# 3. Why not start with the conventional “execution claim framework”

A normal infrastructure-first approach might begin by introducing a generic claim/attempt table or workflow-runtime primitive, then migrate callers into it.

Rejected for first wave.

Reason:

```text
abstract execution primitive first
→ high risk of designing around imagined commonality
→ weak proof that provider uncertainty/consequence repair semantics actually fit
→ creates pressure for a universal table/runtime before a real vertical slice proves value
```

The selected slice reverses the direction:

```text
real irreversible provider effect
→ strengthen existing domain seam
→ prove identity/attempt/uncertainty/recovery
→ extract only the properties that survive
→ then reuse in AiPlan/BullMQ and webhook/K10 slices
```

This is the anti-normalization method applied to implementation sequencing.

---

# 4. Current OutboundDelivery seam is strong enough to evolve

Current code already provides:

```text
OutboundDelivery
  tenant-bound via businessId
  scheduledAt / nextRetryAt
  status
  retryCount / maxRetries
  externalPostId / externalUrl
  resultSnapshot
  error fields

DeliveryEvent
  delivery relation
  event type
  status before/after
  attemptNumber
  error/result evidence

DeliveryQueueService
  CAS-like claim via updateMany(id + prior status) → Sending
  provider adapter abstraction
  retry/backoff
  event recording

ResendEmailAdapter
  provider result → externalPostId
  explicit fallback feature gate
```

`OutboundDelivery` is therefore a strong candidate to represent one logical outbound provider effect **for this slice**.

Do not introduce `OutboundDeliveryV2`.

---

# 5. Identity decision for first slice

## 5.1 WorkOccurrenceId

Candidate:

```text
WorkOccurrenceId = OutboundDelivery.id
```

Rationale: the delivery row is the durable occurrence of one scheduled/queued destination delivery.

## 5.2 EffectId

Candidate:

```text
EffectId = OutboundDelivery.id
```

for the **Resend outbound-email slice only**, because one delivery row is intended to produce one provider send effect to one destination.

This is valid only if the implementation packet guarantees:

1. material destination/content parameters are fingerprinted/bound before provider execution;
2. retry preserves the same material effect;
3. materially changed recipient/content/sender semantics do not reuse the same effect identity without explicit version/supersession policy.

If current mutable content relationships cannot prove this, the slice must add an immutable `effectFingerprint`/snapshot seam rather than invent a universal Effect table.

## 5.3 AttemptId — existing fields are **not yet sufficient by themselves**

Current code calculates:

```text
attemptNumber = delivery.retryCount + 1
```

**after** `adapter.publish()` returns.

That is too late to be the complete durable attempt identity for crash proof.

Crash class:

```text
status = Sending
provider call occurs
process dies before retryCount/event outcome write
```

A later recovery cannot safely assume that `retryCount + 1` represents a never-attempted generation.

Therefore first packet must establish a durable attempt generation **before provider PONR**.

Preferred seam reuse:

```text
EffectExecutionClaim = OutboundDelivery logical claim
AttemptOwnership     = durable attempt-start evidence tied to delivery before provider call
```

Physical options to evaluate in the packet:

### Option A — evolve DeliveryEvent as attempt-start ledger

Before provider call:

```text
create DeliveryEvent(eventType='attempt_started', attemptNumber=N, ...)
→ its durable identity/evidence establishes attempt generation
```

Outcome events reference the same stable attempt generation through an additive attempt reference or other deterministic binding.

### Option B — additive current-attempt identity/sequence on OutboundDelivery

Atomically claim + allocate attempt generation on the delivery row, then append DeliveryEvent evidence.

### Option C — new generic Attempt table

**Rejected for first slice unless A/B cannot satisfy proof.**

The packet must choose the smallest representation that survives FI-03/FI-04 and competing-worker proof.

---

# 6. The current crash defect this slice must destroy

Current `DeliveryQueueService.executeDelivery()` places:

```text
adapter.publish()
→ OutboundDelivery Published update
→ DeliveryEvent success
→ local events
→ campaign-contact update
→ content-status update
```

inside one broad `try` path.

A provider can succeed, then any local operation after `publish()` can fail.

Current catch/retry semantics can therefore reinterpret a **post-provider local error** as provider/transient execution failure and allow a later repeat provider call.

Canonical root: F159 / C109.

First packet succeeds only if this becomes:

```text
PRE-PONR execution phase
→ provider attempt
→ once provider success/idempotent acceptance is known:
   PROVIDER EFFECT CONFIRMED
   provider operation ID persisted/evidenced
   effect is no longer eligible for generic create/send retry
→ local consequence phase
→ missing local consequences repaired idempotently
```

---

# 7. Resend-specific target properties

From the canonical provider matrix, the slice may rely on the already-researched current provider properties:

```text
POST email supports provider idempotency key
same request + same key can be safely retried within provider retention
successful send returns provider email ID
lifecycle webhooks can later supply sent/delivered/failed/bounced evidence
```

Target binding:

```text
KeyFlow EffectId
→ stable Resend idempotency key
→ provider email ID
→ provider lifecycle evidence
```

Provider idempotency retention is a bounded provider feature, not KeyFlow's durable identity. KeyFlow retains its own EffectId beyond provider retention.

## Scope control

First packet does **not** need to implement the full Resend lifecycle webhook ingestion unless required for the chosen proof gate.

Minimum first-wave provider truth:

1. request idempotency;
2. provider success response/email ID;
3. ambiguous connection/error handling through deterministic simulator;
4. ability to classify provider-known success vs unknown.

Lifecycle webhook consumption can be a subsequent bounded slice if needed.

---

# 8. First-slice consequence contract

Do not let “consequence repair” become open-ended downstream orchestration.

For the Resend/OutboundDelivery slice, define an explicit owned consequence set such as:

```text
C1 OutboundDelivery provider-result state/evidence
C2 DeliveryEvent attempt/outcome evidence
C3 provider email ID retained
C4 delivery.completed/content.published durable or replay-safe handoff as applicable
C5 campaign-contact SENT state where this delivery owns it
C6 parent OutboundContent aggregate status update where this delivery owns it
```

The implementation packet must classify each consequence as:

```text
MUST COMPLETE BEFORE effect marked locally converged
OR
DURABLE IDEMPOTENT HANDOFF to another owner
OR
BEST-EFFORT OBSERVABILITY only
```

Without this contract, “consequence complete” becomes another vague status.

---

# 9. First-slice failure-certainty states

The packet need not add a universal enum/table, but its semantic adapter must be able to represent at least:

```text
PRE_PROVIDER_RETRYABLE_FAILURE
PROVIDER_SUCCESS_CONFIRMED
OUTCOME_UNKNOWN
CONSEQUENCE_INCOMPLETE
CONSEQUENCE_REPAIRING
CONVERGED_SUCCESS
FAILED_FINAL_CONFIRMED
CANCELLED / SUPERSEDED if applicable before PONR
```

A local `Failed` or `RetryPending` status may remain for compatibility during migration, but target logic cannot use it as the sole authority for re-send.

---

# 10. First-slice recovery authority boundary

Do not over-expand J15/J6 scope in the first packet.

### Same-effect automatic retry

Allowed only when:
- failure is known pre-provider or provider-native idempotency makes same EffectId replay safe;
- retry budget permits;
- delivery still current/not cancelled/superseded/expired;
- upstream standing policy/authority remains valid where required.

### OUTCOME_UNKNOWN

Must not blindly create a second email effect.

With Resend idempotency support, the preferred recovery is same EffectId + same provider idempotency key where contract guarantees safe replay; otherwise reconcile/escalate according to provider certainty.

### Reversal

A sent email has no normal recipient unsend. Do **not** add generic “undo email.”

Recovery after an irreversible send is generally mitigation/follow-up, which is outside first packet scope.

---

# 11. Exact proof obligations admitted into first packet

The first packet should implement/execute only the relevant subset of the 39 proof obligations.

Mandatory:

```text
PF-J2318-001 provider accepted, local persistence crashes
PF-J2318-002 provider accepted, response ambiguity
PF-J2318-003 provider ID known, outcome handling
PF-J2318-006 retry identity + provider idempotency binding
PF-J2318-007 final failure exactly once
PF-J2318-010 cancellation vs claim if cancellation is in slice
PF-J2318-011 competing replicas claim once
PF-J2318-012 terminal non-regression
PF-J2318-024 OUTCOME_UNKNOWN blocks unsafe duplicate
PF-J2318-033 tenant isolation
PF-J2318-034 recovery mutation tenant binding if recovery endpoint/operator action is exposed
```

Fault injection minimum:

```text
FI-01 after claim before provider
FI-03 after provider accepts before response
FI-04 after provider success response before local provider-result persistence
FI-05 after provider result persistence before consequence writes
FI-11 claim/cancel race if cancellation included
```

Optional/defer:
- K10 proofs;
- webhook apply-state proofs;
- parent-plan proofs;
- Recovery Control Twin innovation proofs.

---

# 12. Characterization gates before behavior change

Before changing execution semantics, the packet must pin current useful behavior:

1. queued/scheduled delivery becomes claimable only when due;
2. current CAS-like `updateMany(id + prior status)` prevents obvious duplicate claim in ordinary competition;
3. missing connection/adapter fails without provider call;
4. transient pre-provider failure schedules bounded retry;
5. nontransient failure becomes final;
6. successful send retains provider ID;
7. campaign/contact/content updates currently expected by product are documented;
8. tenant-bound delivery cannot be read/mutated from another business path.

Then target tests deliberately replace unsafe semantics around post-provider errors and retry certainty.

No current test execution is claimed by this readiness assessment.

---

# 13. Migration containment

The first packet should avoid a mass migration.

Recommended compatibility shape:

```text
new writes for Resend OutboundDelivery
→ produce strengthened effect/attempt/provider evidence

historical rows
→ retain raw statuses
→ semantic adapter classifies PROVEN / DERIVABLE / AMBIGUOUS / UNKNOWN
```

Do not rewrite all historical `Sending`, `Failed`, `RetryPending` rows into new certainty states.

Before enabling any recovery behavior for old rows, obtain read-only distributions for at least:

```text
Resend OutboundDelivery counts by status
age distribution of Sending/RetryPending/Failed
externalPostId coverage
resultSnapshot coverage
retryCount/maxRetries distribution
campaign-contact linkage coverage
```

Historical ambiguous `Sending` with no provider evidence should not be auto-re-sent merely because it is old.

---

# 14. Feature / rollback containment

Existing `MARKETING_ESP_FALLBACK` already provides one provider-level disable seam.

The packet should add or identify a **semantic rollout gate** distinct from provider availability, so KeyFlow can run:

```text
legacy Resend delivery semantics
vs
strengthened effect-certainty semantics
```

for controlled tenants/environment during proof.

Rollback must never mean deleting new evidence or reverting provider-known success to local failure. If the new execution path is disabled, canonical evidence already written remains valid/readable.

---

# 15. What the first packet explicitly excludes

To prevent scope creep:

```text
NO universal WorkOccurrence table
NO universal Attempt table unless slice-local seams fail proof
NO universal RecoveryOccurrence table
NO workflow-engine adoption
NO new generic DLQ
NO platform-wide ActionDispatcher convergence
NO payment/refund changes
NO ledger/K10 changes
NO Meta/Twilio/Gmail provider convergence
NO social provider delete/reversal
NO full Temporal Work Projection UI
NO Recovery Control Twin production enablement
NO adaptive recovery budget learning
NO Attention Gradient
NO Causal Recovery Horizon mutation controls
```

The architecture is innovative because of the semantics it proves, not because the first implementation packet touches everything.

---

# 16. Second and third slices if first falsification succeeds

## Second recommended slice — AiPlanStep + ActionDispatcher + BullMQ

Purpose:

```text
prove EffectExecutionClaim vs AttemptOwnership
prove F150 failed-attempt evidence does not tombstone retry
prove current Clearance / revoke during backoff
prove parent child-resume behavior in adjacent packet
```

This imports properties proven by OutboundDelivery rather than introducing a universal framework first.

## Third recommended slice — WebhookEvent apply completeness for one payment provider

Purpose:

```text
prove occurrence dedupe != application completeness
prove crash after occurrence insert
prove idempotent redelivery repair
prepare composition into K10
```

## Fourth — K10 payment/refund consequence convergence

Only after provider-effect and ingress-repair semantics have been proven separately should KeyFlow apply them to monetary consequence convergence.

---

# 17. Packet-readiness checklist

A bounded packet for OutboundDelivery + Resend may now be drafted if it contains all of:

```text
[x] exact production files/surfaces in scope
[x] exact source-of-truth owner
[x] EffectId / AttemptId semantics
[x] action/effect fingerprint requirement
[x] provider idempotency binding
[x] PONR / failure-certainty transitions
[x] consequence contract
[x] migration compatibility for historical rows
[x] tenant binding
[x] rollback/feature-gate behavior
[x] characterization tests
[x] deterministic crash/concurrency tests
[x] explicit exclusions
[x] no universal-table/runtime assumption
[x] no claim that proof already passed
```

The readiness assessment itself supplies the architecture boundaries; the actual `KF-EXEC-*` packet should translate them into file-level implementation and test instructions for Claude Code/Kimi Code/Codex without allowing those agents to redesign the architecture into a generic retry framework.

---

# 18. Final readiness verdict

```text
BOUNDED PACKET:
  OutboundDelivery + Resend external-effect certainty
  = READY TO DRAFT

IMPLEMENTATION:
  = NOT AUTHORIZED

WHY THIS SLICE:
  It can falsify KeyFlow's strongest recovery claims using a real irreversible
  provider effect while reusing existing domain seams and avoiding financial
  blast radius or premature platform-wide abstractions.
```

Next exact action:

> Draft the bounded `KF-EXEC` packet for **OutboundDelivery + Resend effect certainty**, including exact production files, allowed additive schema/evidence changes, deterministic proof requirements, migration characterization queries, rollout gates and stop conditions — but do not execute it.
