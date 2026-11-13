# KeyFlowOS Recommendation Register — Cancellation / Supersession Continuation

Status: CANONICAL CONTINUATION OF `10B-RECOMMENDATION-REGISTER-TEMPORAL-WORK-CONTINUATION.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical recommendation sequence continues after KF-REC-041.

---

## KF-REC-042 — Make cancellation/supersession a first-class durable state transition with descendant invalidation

**Status:** PROVISIONAL / HIGH-CONFIDENCE TARGET

**Primary kernels:** K7 Temporal/Event/Workflow, K11 Recovery/Reliability

Cancellation is not row deletion and not merely a UI command. It is a durable transition that removes future execution eligibility while preserving evidence.

Target semantics:

```text
SCHEDULED / WAITING / ELIGIBLE
  ├─ expected-state claim → CLAIMED
  └─ expected-state cancel → CANCELLED / SUPERSEDED
```

Only one transition wins.

If execution ownership already won, cancellation becomes an in-flight request whose result depends on the effect's point of no return:

```text
CLAIMED but not effect-owned
→ revalidate cancellation before ExecutionClaim

ExecutionClaim/provider effect already underway
→ CANCEL_REQUESTED / TOO_LATE / OUTCOME_UNKNOWN
→ reconcile or compensate where safe
```

Causal descendants must inherit invalidation lineage so cancellation of an originating WorkOccurrence can prevent not-yet-effective downstream queued work.

Do not recursively delete historical evidence.

Affected journeys: J6, J9, J10, J14, J15, J18, J23.

---

## KF-REC-043 — Revalidate current business eligibility immediately before material delayed effects

**Status:** PROVISIONAL / HIGH-CONFIDENCE TARGET

**Primary kernels:** K3 Governance, K6 State Transition, K7 Temporal, K11 Recovery

Long delays make captured assumptions stale by definition. A future action must not rely only on the payload that was valid when scheduled.

Before a material effect, evaluate current authoritative state relevant to that capability, such as:

```text
source entity still qualifies
current human/standing authority
current KEY autonomy/delegation
current approval/clearance freshness
current customer/contact policy
current amount/exposure
current workflow definition/policy version where relevant
```

Examples:

- review request: order still qualifies + contact policy permits outreach;
- invoice reminder: invoice remains unpaid/overdue;
- booking reminder: booking remains active and time-relevant;
- proactive KEY action: exact action remains within current authority/autonomy/policy.

Do not force one universal field set onto every capability. The CapabilityContract/ActionEnvelope should specify which facts are execution-time preconditions.

Target outcome:

```text
ELIGIBLE
→ current-state precondition evaluation
→ still eligible: proceed to Clearance/ExecutionClaim
→ invalidated: CANCELLED/SUPERSEDED
→ materially changed: REQUIRES_RECONTROL / regenerate ActionEnvelope
```

Affected journeys: J2, J4, J6, J9, J10, J15, J18, J23.

---

## KF-REC-044 — Preserve durable causal/effect identity across queue-to-queue handoffs

**Status:** PROVISIONAL / HIGH-CONFIDENCE TARGET

**Primary kernels:** K7 Temporal, K8 Evidence/Outcome, K9 External Reality, K11 Recovery

A durable handoff from one work system to another is legitimate:

```text
ScheduledAgentJob
→ CustomerNotificationLog queue
→ provider send
```

But the handoff must preserve one causal chain and must not falsely convert pending external effect into completed business outcome.

Required properties:

```text
origin occurrence id / causal parent
exact action/effect fingerprint
invalidation/supersession reference
stable idempotency/effect identity
attempt identity
provider/reconciliation identity
outcome evidence
```

Upstream state should distinguish:

```text
HANDED_OFF / AWAITING_EXTERNAL / AWAITING_DESCENDANT
```

from:

```text
SUCCEEDED
```

Descendant queues must atomically claim work before effect and preserve the originating dedupe/effect identity across retry/restart.

This recommendation complements rather than replaces KF-REC-027 atomic ExecutionClaim and KF-REC-040 logical-vs-attempt separation.

Affected journeys: J5, J6, J9, J10, J14, J18, J23.

---

# Cancellation target schematic

```text
SOURCE / POLICY / HUMAN INTENT CHANGES
                ↓
        CancellationIntent
                ↓
       logical WorkOccurrence
        ┌───────┴────────┐
        ↓                ↓
 expected-state       execution claim
 cancel wins          wins first
        ↓                ↓
 CANCELLED          CLAIMED / RUNNING
        ↓                ↓
 invalidate          final pre-effect
 descendants         cancellation check
                         ↓
                 prevent if still safe
                    OR too-late / unknown
                         ↓
                  reconcile/compensate
```

# Promotion rule

Before any KF-EXEC packet:

- characterize every affected current status vocabulary;
- define expected-state CAS/lease semantics;
- define point-of-no-return by effect class;
- define cancellation propagation into descendant queues;
- define source-state preconditions by capability;
- define operator/UI states;
- design concurrency/crash tests;
- preserve history and compatibility.

No production implementation is authorized by this continuation.
