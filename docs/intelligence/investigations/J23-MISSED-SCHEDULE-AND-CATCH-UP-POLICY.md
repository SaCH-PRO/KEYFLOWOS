# J23 — Missed Schedule / Catch-up / Coalescing Policy

Status: VERIFIED FORENSIC PASS / TARGET-POLICY REFINEMENT
Implementation baseline: `main@5ec358e9b792817eda1e37fd80a0574eb7905a8a`
Code-bearing parent remains `d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`; inspected semantic paths are unchanged by the audit-only main advance.
Last evidence pass: 2026-09-03 local / 2026-09-04 UTC
Primary journey: J23 Temporal Flow / Long-Running Workflow
Primary kernels: K7 Temporal/Event/Workflow, K11 Recovery/Reliability
Secondary kernels: K8 Evidence/Outcome, K6 State Transition
Adjacent journeys: J6 Proactive KEY, J9 Marketing, J10 Commerce, J17 Command Center, J18 Failure/Recovery

> Read-only architecture/research artifact. No production implementation is authorized.

---

## 1. Question

When a scheduler, worker or whole service is unavailable past one or more intended execution times, what should KeyFlowOS do with the missed work?

Possible policies are not interchangeable:

```text
CATCH_UP_ALL
  execute every missed occurrence later

CATCH_UP_LATEST
  execute only the most recent missed occurrence

COALESCE
  combine multiple missed occurrences into one recovery occurrence

SKIP
  do not execute stale missed work

EXPIRE
  mark missed work terminally stale after a deadline

MANUAL_REVIEW
  require operator/human decision before late execution
```

The correct policy depends on business meaning, not scheduler technology.

---

## 2. Current Reality — DelegationLoop implicitly coalesces missed intervals and re-anchors cadence

`DelegationLoopService.processDueLoops()` selects loops where:

```text
enabled = true
nextRunAt <= now
```

It executes each selected loop once.

After execution it sets:

```text
nextRunAt = Date.now() + intervalMin
```

It does not reconstruct how many recurrence boundaries were missed since the prior `nextRunAt`.

Example:

```text
intended cadence: every 6h
nextRunAt: Monday 06:00
service unavailable until Tuesday 18:00

current behavior:
Tuesday 18:00 → one run
nextRunAt → Wednesday 00:00
```

The missed Monday 12:00/18:00, Tuesday 00:00/06:00/12:00 occurrences are not represented.

Thus current semantics are effectively:

```text
MISSED MANY
→ COALESCE TO ONE LATE RUN
→ RE-ANCHOR FUTURE CADENCE FROM ACTUAL EXECUTION TIME
```

This may be acceptable for some scanning loops, but it is not an explicit business policy.

The same code also marks approval-required runs completed before control resolution (F138), so recurrence advancement can occur even when the current due occurrence's governed effect is unresolved.

---

## 3. Current Reality — ScheduledAgentJob implicitly catches up every surviving pending occurrence

Current processors select rows using variants of:

```text
status = PENDING
scheduledFor <= now
```

They do not generally impose an age/expiry policy before work becomes executable.

Therefore a backlog of persisted PENDING jobs survives downtime and is processed later in batches.

This is effectively:

```text
MISSED OCCURRENCES
→ CATCH_UP_ALL
```

subject to batch size and existing cancellation/dedupe behavior.

Examples include post-purchase review/reorder jobs and quote follow-up checks.

The business risk is obvious for time-sensitive work: a reminder intended for a narrow window may be nonsensical or harmful when executed many hours/days late.

Execution-time eligibility revalidation (KF-REC-043) can reject stale work, but a first-class missed-schedule policy still determines whether the system should attempt the occurrence at all.

---

## 4. Current Reality — EmailCampaign implicitly sends every overdue scheduled campaign

`CampaignSchedulerService.tick()` selects:

```text
status = SCHEDULED
scheduledAt <= now
deletedAt = null
```

and calls `sendCampaign()`.

There is no observed late-send tolerance/deadline or operator review based on how stale the campaign schedule is.

Therefore service downtime turns scheduled campaigns into:

```text
MISSED SEND TIME
→ SEND LATE WHEN SCHEDULER RETURNS
```

This is effectively `CATCH_UP_ALL` for each surviving SCHEDULED campaign.

That may be appropriate for some evergreen campaigns, but not for time-sensitive offers, event announcements or compliance-sensitive communications.

---

## 5. Current Reality — Momentum daily sweep implicitly skips the day if the service misses the target hour

`DelegationLoopService.processMomentumSweeps()` calculates current local business hour/date and runs only when:

```text
localHour === 6
```

A process-local map attempts to run once per business/date within that hour.

If the service is unavailable for the entire local 06:00–06:59 window, there is no durable missed-occurrence record to catch up later.

Thus current semantics are effectively:

```text
MISSED DAILY WINDOW
→ SKIP OCCURRENCE ENTIRELY
```

This contrasts with ScheduledAgentJob and EmailCampaign catch-up behavior.

### Distributed ownership side note

`momentumSweepTracker` is process-local. Separate replicas maintain separate maps, so the mechanism does not provide distributed once-per-business/day ownership.

This is a distributed ownership concern conceptually aligned with F097/F123-class scheduler ownership findings. A separate finding should only be promoted if broader reachability/impact warrants it; this artifact does not assign one yet.

---

## 6. Current Reality — heterogeneous missed-schedule semantics are implementation accidents, not declared policy

Observed effective policies:

| Mechanism | Effective missed-schedule behavior | Explicit business policy? |
|---|---|---|
| DelegationLoop | coalesce missed intervals to one run + re-anchor cadence from actual completion | no |
| ScheduledAgentJob | catch up every still-pending persisted occurrence | no |
| EmailCampaign | send every overdue scheduled campaign late | no |
| Momentum sweep | skip occurrence if target local hour is fully missed | no |
| CustomerNotificationLog queue | retry queued notifications up to 48h then expire | partially explicit technical age rule |

The issue is not that all mechanisms differ. Some **should** differ.

The defect is that the difference is currently encoded by scheduler implementation rather than an explicit WorkDefinition/Capability policy.

This is F145.

---

## 7. Target — missed-schedule policy belongs to WorkDefinition / Capability semantics

Candidate internal policy:

```yaml
schedule_policy:
  recurrence: ...
  timezone: ...
  missed_occurrence_policy: CATCH_UP_ALL|CATCH_UP_LATEST|COALESCE|SKIP|EXPIRE|MANUAL_REVIEW
  lateness_tolerance: ...
  max_catch_up_occurrences: ...
  coalesce_key: ...
  expiry_after: ...
  phase_policy: PRESERVE_SCHEDULE_PHASE|REANCHOR_FROM_ACTUAL_EXECUTION
  overlap_policy: ALLOW|FORBID|COALESCE|QUEUE
```

Not every work type needs every field.

The policy should be declared by the work/capability definition, not inferred from the scheduler implementation.

---

## 8. Target examples by business meaning

### Payment recovery scan

Likely:

```text
COALESCE
+ current invoice-state revalidation
+ preserve milestone/cadence semantics per invoice
```

Running six missed scans back-to-back has little value; the current state matters more.

### Booking reminder

Likely:

```text
EXPIRE or SKIP
```

if the appointment window has already passed.

A late reminder after the appointment is incorrect even if the scheduler technically owes an occurrence.

### Customer campaign

Could be:

```text
CATCH_UP within lateness tolerance
else MANUAL_REVIEW / EXPIRE
```

depending on campaign purpose.

### Daily owner digest

Likely:

```text
CATCH_UP_LATEST or COALESCE
```

rather than sending several stale daily summaries after downtime.

### Payroll / compliance obligation

Potentially:

```text
CATCH_UP_ALL or MANUAL_REVIEW
```

because missed legal/financial obligations may not be safely skipped.

### Observation/intelligence scan

Often:

```text
COALESCE
```

because one fresh scan can replace multiple stale scans.

---

## 9. Schedule phase is separate from catch-up policy

Current DelegationLoop behavior re-anchors after actual execution:

```text
nextRunAt = now + interval
```

But some schedules are wall-clock commitments:

```text
09:00 every weekday
first business day of month
Friday 17:00
```

Their future phase should not drift because one run happened late.

Therefore distinguish:

```text
FIXED_RATE / WALL_CLOCK PHASE
→ next occurrence derived from schedule definition

FIXED_DELAY
→ next occurrence derived from actual completion time
```

This is a business/temporal semantic distinction, not a minor scheduler option.

---

## 10. Relationship to cancellation and eligibility

Missed-schedule policy answers:

> Should the late occurrence still exist/be attempted?

Execution-time eligibility answers:

> Given that we are considering it now, is the exact effect still valid?

Cancellation/supersession answers:

> Has a later intent/state change explicitly removed its future execution right?

These must remain separate:

```text
MISFIRE POLICY
→ whether occurrence becomes late-eligible

INVALIDATION
→ whether occurrence remains authorized/relevant

CURRENT ELIGIBILITY
→ whether exact material effect is still valid now

EXECUTION CLAIM
→ who owns the effect
```

---

## 11. External reference properties

### Quartz

Quartz explicitly models trigger misfires and lets CronTrigger choose behavior such as `DO_NOTHING` or `FIRE_NOW` rather than treating missed execution as an undocumented accident.

Adopted property:

> Missed schedule behavior is explicit policy.

### BullMQ

BullMQ Job Schedulers describe repeat jobs as produced according to scheduler state and note that production rate depends on workers/processing; legacy repeatables explicitly did not accumulate all missed jobs while workers were offline.

Adopted property:

> Recurrence production and backlog semantics are runtime properties that must be understood, but business correctness requires KeyFlowOS to declare its own work policy rather than inherit queue defaults blindly.

References:

- https://www.quartz-scheduler.org/documentation/quartz-1.8.6/tutorials/TutorialLesson06.html
- https://docs.bullmq.io/guide/job-schedulers/
- https://docs.bullmq.io/guide/jobs/repeatable

---

## 12. Findings / contradictions / recommendations

New finding:

- F145 heterogeneous missed-schedule/catch-up semantics are implicit implementation behavior rather than declared WorkDefinition policy.

New contradiction:

- C096 one OS-level concept of scheduled business work vs scheduler-specific accidental meanings of a missed occurrence.

New recommendation:

- KF-REC-045 explicit missed-schedule, lateness, overlap and schedule-phase policy on durable WorkDefinition/Capability semantics.

Potential additional distributed finding:

- momentum sweep process-local once-per-day tracking may duplicate under replicas and skip under full-hour downtime. Keep provisional/search-scoped until compared against existing scheduler ownership findings to avoid duplication.

---

## 13. Proof requirements

Before execution-readiness:

- simulate service downtime spanning one and many recurrence boundaries;
- prove each work class follows its declared misfire policy;
- prove stale customer communication expires/skips where policy requires;
- prove catch-up does not create an unbounded burst;
- prove coalescing preserves sufficient causal/evidence lineage;
- prove wall-clock schedules preserve phase after late execution when configured;
- prove fixed-delay schedules re-anchor intentionally when configured;
- prove current-state eligibility is still checked after late wake-up;
- prove cancellation/supersession dominates late catch-up where applicable;
- prove operator views explain why a work item was skipped, expired, coalesced or executed late.

No tests were executed in this forensic pass.
