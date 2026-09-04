# KeyFlowOS Recommendation Register — Temporal Projection Continuation

Status: CANONICAL CONTINUATION OF `10E-RECOMMENDATION-REGISTER-WORKFLOW-VERSIONING-CONTINUATION.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical recommendation sequence continues after KF-REC-046.

---

## KF-REC-047 — Create a cross-domain Temporal Work Projection as a read model, not a new source of truth

**Status:** PROVISIONAL / STRONGLY SUPPORTED PRODUCT + OPERATIONS TARGET

**Primary kernels:** K7 Temporal/Event/Workflow, K8 Evidence/Outcome, K11 Recovery/Reliability

KeyFlowOS currently distributes long-lived work across FlowRun, AiPlan, ScheduledAgentJob, DelegationLoopRun, channel schedules, OutboundDelivery and other domain records.

Users and KEY should not need to understand those internal fabrics to answer:

```text
What is scheduled?
What is waiting?
Why is it waiting?
What is running/retrying?
What can still be cancelled?
What is too late to cancel?
What expired or was superseded?
What is waiting on an external provider?
What has an uncertain outcome?
What needs human attention?
```

Target: normalize existing domain truth into a cross-domain projection with simple product states such as:

```text
Scheduled
Waiting until <time>
Waiting for approval
Waiting for dependency
Queued
Running
Retrying
Cancelling
Cancelled
Superseded
Expired
Waiting on provider
Outcome uncertain
Completed
Failed / needs attention
```

The projection may be assembled on read initially or materialized incrementally if scale/query cost requires it.

It must remain derivative:

```text
DOMAIN / WORK SOURCE OF TRUTH
→ projection adapter
→ Temporal Work Projection
```

Never:

```text
projection
→ independent competing workflow truth
```

Useful fields/links can include:

```text
work/occurrence identity
source type/id
title/business consequence
scheduled/eligible/actual times
waiting reason
attempt/retry summary
control/approval reference
cancellation availability / point-of-no-return
causal parent/child links
provider/outcome state
last error / operator action
```

Primary consumers:

- J17 Command Center;
- J6 proactive KEY explanations;
- J18 failure/recovery operations;
- J15 approval/control visibility;
- calendar/automation/marketing surfaces where appropriate.

This is an accessibility and observability layer over the durable-work contract, not a universal workflow engine.

Affected journeys: J2, J6, J9, J10, J15, J17, J18, J23 and any journey with long-lived work.

---

# Promotion rule

Before implementation:

- define source adapters/mappings for each included work family;
- ensure projection states cannot overwrite domain truth;
- design freshness/rebuild semantics;
- expose causal lineage without leaking sensitive payloads;
- prove tenant isolation;
- define degraded behavior when one source is unavailable;
- keep normal UI language simple while operator drill-down remains rich.

No production implementation is authorized by this continuation.
