# Booking Completed + Shared Scheduled Job — Constellation Analysis

Status: ACTIVE CROSS-JOURNEY CONVERGENCE / SECOND REPRESENTATIVE EVENT TRACE

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Production implementation remains unauthorized.

Purpose:

1. test whether event/consequence fragmentation found for `invoice.overdue` generalizes to a second domain event;
2. inspect temporal follow-up machinery created from `booking.completed`;
3. analyze dynamic interactions among services sharing `ScheduledAgentJob`.

Affected journeys:

- J3 Lead → Customer → Cash
- J4 Booking → Service → Payment
- J6 Proactive KEY / Autonomy
- J7 Financial Truth
- J9 Marketing / Growth
- J13/J14 Integration & Events
- J15 Governance
- J18 Failure / Recovery
- J23 Temporal Workflow

Affected kernels:

- K3 Governance
- K5 Capability
- K6 State Transition
- K7 Temporal/Event/Workflow
- K8 Evidence/Outcome
- K9 Integration/External Reality
- K10 Financial Truth
- K11 Recovery/Reliability

---

# 1. Booking completion producer

`BookingsService.updateBookingStatus()`:

```text
load booking
validate requested status is in broad allowed enum list
update booking by id to requested status
if requested status == COMPLETED:
  emit booking.completed
  write CRM booking.completed timeline event
  raise REBOOK obligation
  auto-generate invoice
```

No transition graph, same-state short-circuit or expected-current-state compare-and-set was observed in this method.

Therefore repeated requests to set an already-completed booking to COMPLETED can repeat side effects even when the final row state remains the same.

---

# 2. Material `booking.completed` consumers

## FlowListener

Class: CUSTOMER COMMUNICATION.

Automatically sends a `booking_completed` customer email on event receipt.

## ReviewSolicitationService

Class: DELAYED CUSTOMER COMMUNICATION.

Schedules:

```text
ScheduledAgentJob
  jobType = review_solicitation
  entityId = booking.id
  checkpoint = review_booking_<bookingId>
  scheduledFor = now + 3 days
```

This is a strong semantic checkpoint concept.

Its own hourly worker filters specifically to `jobType='review_solicitation'`, sends review_request email, then marks job COMPLETED.

## CrossModuleAgentService — booking completed followup

Class: FOLLOW-UP WORK / OPERATOR TASK.

Workflow definition `booking_completed_followup` is defaultEnabled=true.

On `booking.completed`, it creates a CRM task:

```text
Request feedback/review for completed booking
```

with due date `followUpDelayDays` (default one day), may add rebooking suggestion context, writes notification/activity, and records workflow run.

This may be intentionally complementary to ReviewSolicitation's later external email, but there is no shared consequence/cadence graph proving that relationship.

## ReferralRewardService

Class: MONETARY / CREDIT CONSEQUENCE.

On booking completion it resolves service price and may award referral reward by:

```text
read referred contact.custom.referralRewardEarned
read referrer current reward balance
update referrer balance += configured reward
update referred contact referralRewardEarned = true
```

No transaction/atomic compare-and-set around the two-contact reward transition was observed.

## ProjectRevenueListener

Class: DOMAIN STATE PROJECTION / WORK DELIVERY.

Finds linked projects where status equals configured source status (default ACTIVE), then calls transition helper which updates project by ID to target status and emits `project.status_advanced`.

The comment calls the operation idempotent because only source-state rows are initially selected, but the final update is not conditioned on current source status.

## JourneyOrchestrator

Class: AI/WORKFLOW PLAN.

Hard-coded `booking.completed` template can create invoice, CRM lifecycle update, delayed follow-up and review-request actions. Existing F110-F113 apply: Planner steps are mixed with template steps, delay is not executable, template role is not an authority boundary, and canonical event mappings are inconsistent.

## AgentTrigger

Class: OPTIONAL STANDING AI PLAN.

Default trigger `Booking Completion → Invoice & Follow-up` overlaps the JourneyTemplate and can create a second independent Planner plan when enabled.

## WebhookDispatcher / calendar / activity / AI / growth intelligence

Primarily external event delivery or projections/observation. Multiple consumers are valid when their consequence semantics are independent and replay-safe.

---

# F121 — Booking status mutation can re-emit COMPLETED consequences on same-state/replayed requests

**Status:** VERIFIED CODE-LEVEL / STATE-TRANSITION FINDING

`updateBookingStatus()` validates only that requested target is a member of an allowed status vocabulary. It does not enforce an allowed transition graph, reject `COMPLETED -> COMPLETED`, or atomically require an expected source state before mutation.

Side effects are keyed to requested target `status === COMPLETED`, not to proof of a new transition occurrence.

A repeated completion request can therefore re-emit/re-run:

- `booking.completed` event;
- CRM completion event;
- rebook obligation emission;
- auto-invoice helper.

Target law:

```text
canonical lifecycle consequence
must derive from a newly committed valid transition occurrence
not merely a requested target value
```

This strengthens K6's state-transition ownership and K7's occurrence identity.

---

# F122 — shared ScheduledAgentJob table has competing consumers; CrossModuleAgent can falsely complete other subsystems' jobs

**Status:** VERIFIED CODE-LEVEL / CLOSED-SYSTEM INTERACTION FINDING

Current due-job processors found:

```text
ReviewSolicitationService
  filters jobType = review_solicitation

AbandonedCartRecoveryService
  filters jobType = abandoned_cart_recovery

CommerceIntegrationService.processPostPurchaseJobs()
  filters post_purchase_review_request / post_purchase_reorder_prompt

CrossModuleAgentService
  filters only status=PENDING + scheduledFor<=now
  DOES NOT FILTER jobType
```

CrossModuleAgent's `executeScheduledJob()` recognizes only:

- quote_followup;
- post_purchase_review_request;
- post_purchase_reorder_prompt.

For any other type it logs `Unknown job type` and returns without throwing.

Its poller then unconditionally updates the job to:

```text
status = COMPLETED
executedAt = now
```

### Verified collisions

#### review_solicitation

Has a real ReviewSolicitation worker that should send an email.

CrossModuleAgent can fetch the same due row first, treat type as unknown, perform no actuator, then mark it COMPLETED. ReviewSolicitation's later query no longer sees it.

Result:

```text
intended delayed review email
→ stolen by unrelated consumer
→ no send
→ false COMPLETED evidence
```

#### abandoned_cart_recovery

Has a real AbandonedCartRecovery worker that should send recovery email.

CrossModuleAgent can similarly falsely complete the row before the intended worker executes it.

#### lead_magnet_enroll

A producer creates `lead_magnet_enroll` ScheduledAgentJob. Current repository search found no matching consumer for this type. CrossModuleAgent therefore provides a path where the row can eventually be marked COMPLETED despite no implemented enrollment actuator.

#### post_purchase_* jobs

CrossModuleAgent recognizes them, while CommerceIntegration exposes another processor for the same job types through a mounted processing endpoint. If both processors are invoked concurrently, both can process the same PENDING row because neither acquires an atomic claim first.

### Architectural implication

`ScheduledAgentJob` is a shared namespace without explicit consumer ownership/routing.

Target:

```text
job type / capability
→ canonical owner
→ atomic claim
→ executable contract
→ unknown type FAILS CLOSED
```

An unknown job must never become COMPLETED solely because a generic poller did not throw.

This is a K7/K11 kernel-level defect, not a booking-specific bug.

---

# F123 — due ScheduledAgentJob execution lacks atomic ownership even in correctly filtered consumers

**Status:** VERIFIED CODE-PATTERN / DISTRIBUTED-RELIABILITY FINDING

ReviewSolicitation and AbandonedCartRecovery both:

```text
findMany PENDING due jobs
→ perform provider effect
→ update job COMPLETED
```

with no observed atomic `PENDING -> CLAIMED/SENDING` expected-state transition before side effects.

Even after F122's consumer-routing defect is fixed, multiple replicas of the **same intended worker** can still process the same row concurrently.

### Positive seam

The shared job model already has a semantic composite checkpoint API (`businessId_entityId_checkpoint`) used by repository `upsert` paths. This is valuable for schedule-definition uniqueness.

But:

```text
semantic scheduled-job uniqueness
!= execution ownership
```

K7 ScheduleOccurrence + K11 ExecutionClaim semantics should strengthen this existing table where appropriate.

---

# F124 — ReferralRewardService can double-credit under concurrent duplicate completion events

**Status:** VERIFIED CODE-LEVEL / MONETARY-CONSEQUENCE CONCURRENCY FINDING

Sequential replay is partially suppressed by `contact.custom.referralRewardEarned`.

But two concurrent `booking.completed` handlers can both:

1. read `referralRewardEarned` as false;
2. read the same current referrer reward balance;
3. update the reward balance / earned count;
4. mark referred contact rewarded.

No transaction, unique reward ledger row, or compare-and-set was observed around the reward award.

Depending on interleaving this can create lost-update or duplicate-credit semantics; in either case the operation is not a provably atomic one-time monetary consequence.

Target:

```text
RewardEntitlement(source occurrence / referred relationship)
→ unique/atomic claim
→ transactional ledger mutation
→ evidence
```

Do not use mutable Contact.custom flags as the sole one-time financial entitlement boundary.

Affected kernels: K6, K7, K8, K10, K11.

---

# F125 — ProjectRevenueListener's stated idempotency is non-atomic

**Status:** VERIFIED CODE-LEVEL / STATE-CONCURRENCY FINDING

ProjectRevenueListener selects projects where:

```text
status = configured fromStatus
```

and calls a transition helper that updates:

```text
where { id, businessId }
```

without requiring the row still has `fromStatus`.

Two concurrent event handlers can both select the same project in source state, both update it to the same target and both emit `project.status_advanced`.

The final project state may be correct, but transition occurrence/evidence can duplicate.

Target: expected-state CAS or canonical project transition owner producing exactly one transition occurrence.

Affected kernels: K6, K7, K8, K11.
Affected journeys: J4, J7, J8, J18.

---

# F126 — booking.completed confirms material consequence fragmentation is systemic, not invoice-specific

**Status:** VERIFIED CROSS-JOURNEY / SYSTEMIC FINDING

A second independent canonical event shows the same architecture shape:

```text
booking.completed
├─ immediate customer email
├─ delayed review email scheduler
├─ CRM follow-up task workflow
├─ referral credit
├─ project status progression
├─ rebook obligation
├─ auto-invoice
├─ hard-coded AI journey
├─ optional AgentTrigger plan
├─ outbound webhook
└─ projections/intelligence
```

Many consequences are useful and intentionally distinct. However there is no shared EventOccurrence/BusinessConsequence graph declaring one-time vs repeatable semantics, causal identities, cadence, authority and precedence across them.

Since the same pattern appeared for both `invoice.overdue` and `booking.completed`, elevate F120's target from an invoice-specific recommendation to a **whole-OS event-consequence invariant**.

---

# 3. Strong repository patterns worth reusing

## Semantic ScheduledAgentJob checkpoint

Some paths use:

```text
businessId + entityId + checkpoint
```

and `upsert` to represent one logical scheduled checkpoint.

This is a strong local pattern for K7 ScheduleOccurrence compilation.

## Single-source-of-truth comments in BookingsService

BookingsService already contains explicit architecture comments such as:

```text
booking.invoice_created event owns downstream timeline consequence
Do NOT also write it directly here
```

This is exactly the consequence-ownership discipline needed more broadly.

## Typed canonical BookingCompletedPayload

Canonical event type is already defined and widely consumed.

Target should add occurrence identity/version/correlation rather than replacing the typed event vocabulary.

---

# 4. New contradiction candidates

## C074 — target booking status value vs actual transition occurrence

Requesting `COMPLETED` again can recreate completion consequences even when no new lifecycle transition occurred.

## C075 — shared scheduled-job namespace vs consumer ownership

Multiple subsystems write to one job table while a generic poller consumes all job types and can complete jobs it cannot execute.

## C076 — scheduled checkpoint uniqueness vs due-job execution ownership

The model can uniquely represent a scheduled checkpoint, but due-job workers do not atomically claim execution before external effects.

## C077 — one-time referral entitlement vs mutable contact flags

Reward uniqueness is represented by mutable Contact.custom state rather than an atomic entitlement/ledger transition.

## C078 — source-state filtered project transition vs unconditional final update

Listener claims idempotency from the read predicate while the write does not enforce that predicate.

## C079 — rich booking event fan-out vs absent consequence ownership graph

Multiple useful booking-completion effects exist, but their one-time/repeatable/cadence relationships are implicit and spread across services.

---

# 5. Closed-system feedback model

The ScheduledAgentJob collision demonstrates:

```text
Producer A creates delayed intention
        ↓
Shared persistence table
        ↓
Consumer B with overly broad selector
        ↓
No matching actuator
        ↓
COMPLETED evidence written
        ↓
Intended Consumer A never sees pending job
```

This is a **false negative feedback loop**: the system believes outstanding work has been cleared, so the very state that should cause recovery is removed.

The target should make unexecutable work visible and recoverable:

```text
UNKNOWN_JOB_TYPE
!= COMPLETED
```

---

# 6. Next implications

The second representative event proves the shared laws are systemic enough to stop event-by-event exhaustive repetition once representative coverage is achieved.

Next work should:

1. pool F121-F126 / C074-C079;
2. feed shared queue laws into K7 and K11;
3. begin J14 external event ingress with EventOccurrence/ConsumptionClaim as the now-proven target hypothesis;
4. open J23's long-running-workflow slice around `ScheduledAgentJob`, FlowRunner delays, AiPlan and other durable work;
5. keep J6 open for authority/feedback convergence but avoid rereading every passive event listener individually.

No production implementation is authorized.
