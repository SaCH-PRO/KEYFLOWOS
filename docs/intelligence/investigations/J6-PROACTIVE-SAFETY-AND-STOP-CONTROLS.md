# J6 — Proactive Safety, Pause, Kill & Spend-Control Forensics

Status: ACTIVE FORENSICS / J6 STRESS TEST

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Affected journeys:
- J6 Proactive KEY / Autonomy
- J2 Governed Action
- J15 Approval / Governance
- J18 Failure → Recovery
- J23 Temporal Flow

Affected kernels:
- K3 KEY Authority & Governance
- K5 Capability Fabric
- K7 Temporal / Event / Workflow
- K8 Evidence & Outcome
- K11 Recovery & Reliability

---

# 1. Proactive fabric classification

Current proactive behavior is not one control plane.

At least these fabrics exist:

```text
A. DelegationLoop
   scheduled recurring business operations
   some direct domain/external effects

B. KeyProactiveEngine + watchers
   observation/signal generation
   Genome/FlowSignal feeds
   scheduled owner digests

C. Cortex tool execution
   canonical tool registry / tool loop
   uses KeyAutonomySafetyService

D. Momentum / other specialist auto-execution paths
   separate consumers of legacy Autopilot settings
```

A “global” stop or budget is only global if all material proactive business-effect paths consume it.

---

# 2. `autopilotEnabled` and `pausedUntil`

Current readers are non-universal.

## DelegationLoop

The scheduler queries due `DelegationLoop` rows by:

```text
enabled = true
nextRunAt <= now
```

It does not gate the loop as a whole on `Business.autopilotEnabled` or `metaData.autopilot.pausedUntil` before scanning/mutating business data.

Payment Recovery performs a **send-time** `contactWindow()` check before direct email when the child does not require approval.

That helper checks:

- `Business.autopilotEnabled !== false`;
- `pausedUntil`;
- local quiet hours.

This is favorable for the direct customer-email side effect.

But the helper is not a loop-level stop.

Before/without that send, the loop may already:

- mark Invoice `SENT -> OVERDUE`;
- create/update AutopilotTask;
- change Contact lifecycle stage to `STALE` in Lead Reactivation;
- emit task/domain events;
- write loop-run/statistics/memory records.

Thus pause/disable does not currently mean “no proactive business mutation.”

## KeyProactiveEngine/watchers

Bulk watcher/proactive scans generally select active businesses with `autopilotEnabled: true` plus subscription/recent-activity conditions.

This is a favorable explicit gate for the observation plane.

## Circadian digests

`KeyCortexCircadianService.businessesAtLocalHour()` selects every non-deleted business by local time; it does not filter `autopilotEnabled`.

Morning/weekly/EOD digest delivery can therefore occur independently of Autopilot enablement.

**Classification:** PRODUCT-SEMANTIC OPEN QUESTION, not yet a defect.

Proactive owner intelligence/notifications may intentionally be distinct from autonomous business agency.

Target architecture should define the distinction explicitly rather than assume one toggle controls everything.

---

## F095 — Autopilot pause/disable does not stop DelegationLoop business mutations/task generation

**Status:** VERIFIED CODE-LEVEL / CONTROL-SEMANTIC FINDING

`autopilotEnabled` and `pausedUntil` are enforced by the Payment Recovery `contactWindow()` at direct email send time, but not as a universal gate over due DelegationLoop execution.

Therefore an enabled DelegationLoop can continue to scan, mutate local lifecycle state and create business work while the business-level Autopilot setting is disabled/paused.

### Architectural implication

KeyFlow needs explicit semantics for:

```text
PAUSE_PROACTIVE_EXECUTION
PAUSE_EXTERNAL_CONTACT
PAUSE_NEW_ACTION_CREATION
DISABLE_SPECIFIC_DELEGATION
GLOBAL_AUTONOMOUS_EFFECT_KILL
```

These may intentionally be different controls, but they cannot share ambiguous “Autopilot off” language while governing different subsets.

A stop transition should have an explicit reachability graph of which standing authorities, queued actions and future triggers it invalidates.

---

# 3. BusinessAutonomyProfile `globalKillSwitch`

`KeyAutonomySafetyService` enforces:

- global kill switch;
- max daily autonomous action count;
- daily spend cap;
- max tier without approval.

This service is used in inspected Cortex tool execution paths.

Current repository search does not place it in the DelegationLoop execution chain, which uses `AiOversightService.evaluate()` at aggregate loop level.

Therefore the `globalKillSwitch` is not universal across current proactive business agency.

**Finding handling:** strengthens existing F043 rather than assigning a duplicate finding ID.

F043 should now be read more broadly as:

> KeyAutonomySafetyService is not a universal safety boundary across all current execution/proactive fabrics.

Target should not simply add calls everywhere ad hoc; the shared exact-action Clearance boundary should become the complete-mediation point.

---

# 4. Daily spend ceiling

`KeyAutonomySafetyService.check()` enforces spend only when:

```text
mode == auto
AND maxDailySpendTtd > 0
AND estimatedCostTtd > 0
```

It then checks:

```text
currentSpend + estimatedCostTtd <= maxDailySpendTtd
```

After execution, `recordExecution()` may record `result.costTtd` as actual spend.

## F096 — Cortex autonomous spend cap is bypassed by zero cost estimates

**Status:** VERIFIED CODE-LEVEL POLICY-ENFORCEMENT FINDING

Both inspected production Cortex execution callers pass:

```text
estimatedCostTtd: 0
```

including:

- `KeyCortexToolRegistryService.execute()`;
- `KeyCortexToolLoopService` safety checks.

Because zero causes the spend-check block to be skipped, `maxDailySpendTtd` cannot prevent an action from crossing the cap on those paths.

Even if actual cost is recorded afterward, a subsequent execution with `estimatedCostTtd: 0` again skips the spend-limit comparison entirely.

Thus the profile field is not currently a preventive daily-spend ceiling for those paths.

### Architectural implication

A financial/spend control must receive a capability-normalized cost/value exposure before side effects.

Possible target semantics:

```text
estimatedExposure
+ reservedExposure from live claims
+ settledActualSpend
<= policy limit
```

Unknown/unbounded cost should not silently become zero for a policy whose purpose is to cap spend.

Depending on capability, target choices include:

- deterministic exact amount;
- conservative upper bound;
- reservation/hold;
- force approval when exposure cannot be bounded;
- explicit “no monetary exposure” classification.

This belongs in CapabilityContract / ActionEnvelope, not route-local guesses.

---

# 5. Daily action count

`KeyAutonomySafetyService` checks daily action count only for the Cortex execution paths that call it.

DelegationLoop direct effects are not observed to increment/check this same safety counter.

Therefore `maxDailyAutoActions` is not yet a platform-wide proactive-effect budget.

**Current classification:** strengthens F043 / cross-fabric inconsistency; no new finding ID yet until all proactive execution consumers are mapped.

---

# 6. Observation plane — favorable separation

`InvoiceOverdueWatcherService` is observation-only in the inspected path:

```text
scan business state
→ publish proactive.invoice_overdue Cortex event
→ FlowSignalBridge
→ normalized FlowSignal
```

It does not directly send reminders or mutate invoices.

`FlowSignalService.emit()` deduplicates unresolved signals by:

```text
business + type + entityType + entityId
```

and updates the existing signal for repeated watcher observations.

This is a strong pattern to preserve:

```text
OBSERVE / SIGNAL
!=
ACT
```

Raw BusinessEvent/CognitiveEvent still receives repeated observations from repeated scans; whether that is temporal evidence or learning distortion remains a downstream-consumer question.

---

# 7. New target control taxonomy

J6 suggests that “autonomy setting” is too broad a concept.

Candidate control dimensions:

```text
PROACTIVE_OBSERVATION_ENABLED
PROACTIVE_NOTIFICATION_ENABLED
NEW_AUTONOMOUS_ACTIONS_ENABLED
EXTERNAL_CUSTOMER_CONTACT_ENABLED
STANDING_DELEGATION_ENABLED(loop/capability)
GLOBAL_AUTONOMOUS_EFFECT_KILL
ACTION_BUDGET
SPEND/EXPOSURE_BUDGET
QUIET_HOURS / CONTACT_WINDOW
```

These may be presented simply in UX, but their internal semantics must be explicit.

---

# 8. Stop/revocation target semantics

Candidate target:

```text
STOP / POLICY CHANGE
→ increment policy/authority version
→ prevent new candidate clearances
→ invalidate unconsumed dependent clearances
→ prevent new ExecutionClaims
→ optionally cancel/revoke queued not-started claims
→ define behavior for RUNNING actions
→ reconcile any OUTCOME_UNKNOWN external side effect
```

A kill switch cannot undo an external email already sent. It must define what it can prevent from the moment it becomes effective.

---

# 9. Open product question

Should `autopilotEnabled=false` mean:

A. disable only autonomous business effects, while KEY may still observe and send owner intelligence digests;

B. disable all proactive KEY activity including owner digests;

C. be replaced by clearer independent controls in product UX?

Code cannot determine the intended product philosophy reliably because current paths implement different meanings.

Do not force this decision during architecture forensics. Surface it when target UX/control design reaches L5/L6.

---

# 10. Next J6 slices

1. exact business-effect vs task/recommendation classification for all five DelegationLoops;
2. event-triggered proactive action consumers beyond observation-only watchers;
3. Cortex direct tool proactive origin and principal lineage;
4. concurrency: two scheduler instances / same due loop / same child action;
5. communication consent and recipient policy;
6. outcome evidence and learning integrity;
7. pool F090–F096 into canonical supplement after cross-check;
8. update K3/K8/K11 dossiers with proactive laws.

Production implementation remains unauthorized.
