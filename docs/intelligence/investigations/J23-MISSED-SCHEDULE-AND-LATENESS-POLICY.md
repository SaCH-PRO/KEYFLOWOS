# J23 — Missed Schedule / Lateness Policy

Status: VERIFIED FORENSIC PASS / TARGET CONVERGENCE INPUT
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Last evidence pass: 2026-09-03
Primary kernels: K7 Temporal/Event/Workflow, K11 Recovery/Reliability
Secondary kernels: K6 State Transition, K8 Evidence/Outcome, K9 External Reality
Primary journey: J23 Temporal Flow / Long-Running Workflow
Affected journeys include J6, J9, J10, J18.

> Read-only architecture/research artifact. No production implementation is authorized.

---

## 1. Question

When work was intended for time `T` but no worker executes it until `T + lateness`, should the work still execute?

This is not a generic retry question.

```text
WORK WAS VALID AT T
!=
WORK IS STILL VALID AT T + Δ
```

Correct behavior depends on business semantics.

---

## 2. Current Reality — Implicit Universal Catch-Up

Representative current schedulers use the same broad eligibility shape:

```text
status = pending/scheduled
scheduled_at <= now
→ execute when poller eventually sees it
```

No explicit maximum lateness or per-work misfire policy was observed on these baseline paths.

### ReviewSolicitationService

```text
jobType=review_solicitation
status=PENDING
scheduledFor <= now
→ send review request
```

Review requests are scheduled approximately three days after booking completion or invoice payment. A long outage/backlog still leaves old PENDING work eligible.

### AbandonedCartRecoveryService

Three recovery jobs are scheduled at approximately 24h, 48h and 72h.

Each due job uses:

```text
status=PENDING
scheduledFor <= now
→ send recovery email
```

No check was observed that the intended cadence window still has meaning or that a later recovery occurrence supersedes/coalesces earlier missed ones.

### SocialSchedulerService

```text
SocialPost.status=SCHEDULED
scheduledAt <= now
→ CAS SCHEDULED → PUBLISHING
→ publish
```

The claim is favorable for concurrency, but there is no observed maximum lateness or expiry policy before publication.

### CampaignSchedulerService

```text
EmailCampaign.status=SCHEDULED
scheduledAt <= now
→ sendCampaign()
```

`sendCampaign()` has a strong status claim, but no observed late-start policy.

### ScheduledAgentJob generic/typed consumers

Current due-job consumers generally select `PENDING` rows with `scheduledFor <= now` and no lateness bound.

---

## 3. Why This Is a Semantic Problem

A schedule is not always merely a minimum delay.

Different business actions have different late-execution meaning.

Examples:

```text
invoice reminder
  maybe useful several hours/days late if invoice still overdue

booking reminder
  useless or harmful after appointment start

social post for launch/event
  may be wrong after event window

abandoned cart sequence
  24h + 48h + 72h occurrences may need coalescing after outage

owner digest
  old digest may be superseded by a current digest

regulatory/financial obligation
  late execution may require explicit exception/manual review rather than silent catch-up
```

Current scheduler semantics do not encode these distinctions.

---

## 4. Canonical Misfire Policy Classes

Target WorkOccurrence / CapabilityContract should be able to express a lateness policy such as:

```text
CATCH_UP
  execute late if current eligibility still holds

CATCH_UP_UNTIL(deadline)
  execute only within bounded lateness

COALESCE
  collapse multiple missed occurrences into one current occurrence

LATEST_WINS
  supersede older waiting occurrences with the newest state/recommendation

SKIP
  missing the intended time means occurrence should not run

EXPIRE
  mark terminally expired after deadline, preserving evidence

MANUAL_REVIEW
  lateness changes risk/business meaning; require human decision
```

These are semantic policies, not necessarily database enum values.

---

## 5. Target State Transition

```text
SCHEDULED for T
→ clock/event reaches T
→ ELIGIBLE
→ compute lateness = now - T
→ evaluate misfire policy + current business eligibility
   ├─ execute
   ├─ coalesce/supersede
   ├─ expire
   ├─ skip
   └─ require manual/control review
```

Do not silently infer `CATCH_UP_FOREVER` from `scheduledAt <= now`.

---

## 6. Recurrence / Backlog Semantics

Recurring work introduces another dimension.

If a service is down for 10 recurrence windows, target policy must answer:

```text
10 separate occurrences?
1 coalesced current occurrence?
latest-only?
first missed + current?
manual exception?
```

This must be explicit per work type/definition.

A recurrence definition and an occurrence remain separate identities.

---

## 7. Reference Properties

### Kubernetes CronJob

Official CronJob semantics expose `startingDeadlineSeconds`, which defines how late a missed scheduled job is still eligible to start. After that deadline, the occurrence is skipped/treated as missed.

It also exposes concurrency policy and retains the original scheduled timestamp on created jobs.

Adopted properties:

- preserve original scheduled time;
- make maximum acceptable lateness explicit;
- treat missed occurrence policy independently from future recurrence;
- define concurrency/coalescing behavior deliberately.

Reference:
`https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/`

### BullMQ

BullMQ delayed jobs become eligible after their delay, but official docs state processing at the exact delayed time is not guaranteed and depends on worker availability/backlog.

Adopted property:

> transport delay defines earliest/target eligibility; business logic must decide whether late execution is still meaningful.

Reference:
`https://docs.bullmq.io/guide/jobs/delayed`

---

## 8. Finding / Contradiction

### F145

Representative KeyFlow schedulers implement implicit unbounded catch-up (`scheduled <= now`) without an observed semantic lateness/misfire policy.

### C096

The product meaning of time-sensitive work may expire, coalesce or change with lateness, while current scheduler eligibility treats all overdue pending work as still executable.

---

## 9. Target Recommendation

### KF-REC-045

Define per-work missed-schedule/lateness policy as part of durable WorkOccurrence/definition semantics, including:

```text
original scheduled time
maximum lateness / expiry
catch-up vs skip
coalescing/supersession policy
recurrence behavior
current-state revalidation
operator evidence when missed/expired
```

Do not hard-code one system-wide catch-up rule.

---

## 10. Proof Requirements

- a social post missed beyond its configured validity window does not publish silently;
- a booking reminder cannot execute after the appointment window;
- a review request can follow its explicitly accepted late policy;
- multiple missed abandoned-cart occurrences follow defined coalescing/cadence semantics rather than burst-delivering blindly;
- recurrence resumes future schedules after an expired/missed occurrence;
- original scheduled timestamp and actual execution timestamp are both retained;
- operator can distinguish late-executed, skipped, expired and coalesced occurrences;
- horizontal scaling does not change misfire semantics.

No tests were executed in this forensic pass.
