# KeyFlowOS Recommendation Register — Recovery Continuation

Status: CANONICAL CONTINUATION OF `10F-RECOMMENDATION-REGISTER-TEMPORAL-PROJECTION-CONTINUATION.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical recommendation sequence continues after KF-REC-047.

---

## KF-REC-048 — Establish a certainty-aware Recovery Contract across existing execution fabrics

**Status:** PROVISIONAL / STRONGLY SUPPORTED TARGET

**Primary kernels:** K11 Recovery/Reliability, K8 Evidence/Outcome, K9 Integration/External Reality
**Secondary kernels:** K7 Temporal/Event/Workflow, K10 Financial Truth, K3 Governance

KeyFlowOS currently has useful but fragmented recovery machinery:

- BullMQ attempts/backoff/stalled recovery;
- ActionDispatcher retries/idempotency logs;
- OutboundDelivery retry state + DeliveryEvent evidence + operator retry;
- ScheduledAgentJob terminal rows;
- WebhookEvent occurrence dedupe;
- SagaExecution/SagaStep compensation metadata;
- domain cancellation/void operations;
- provider refund/reversal APIs;
- process-local UndoService conveniences.

These must converge semantically without requiring one universal recovery engine or dead-letter table.

### A. Failure certainty must be typed

Minimum shared classes:

```text
RETRYABLE_ATTEMPT_FAILURE
FAILED_FINAL_CONFIRMED
AWAITING_EXTERNAL
OUTCOME_UNKNOWN
EXPIRED
CANCELLED
SUPERSEDED
SUCCEEDED
```

A timeout/network/process failure after a possible external point-of-no-return must not be converted directly into confirmed failure.

### B. Recovery action must be typed

```text
RETRY
  same WorkOccurrenceId + EffectId
  new AttemptId

RECONCILE
  observe authoritative external/domain state
  no fresh business effect

CANCEL
  prevent not-yet-effective work

VOID
  domain-native cancellation where legal

REVERSAL
  new inverse RecoveryEffectId

COMPENSATION
  new mitigating RecoveryEffectId

MITIGATION_ONLY
  follow-up/annotation where inverse effect is impossible
```

Do not collapse these into generic `retry`, `undo`, `rollback` or `compensated` labels.

### C. Original outcome and recovery outcome are separate durable dimensions

Minimum recovery outcome vocabulary:

```text
RECOVERY_AVAILABLE
RECOVERY_REQUESTED
RECOVERY_ATTEMPTED
RECOVERY_SUCCEEDED_CONFIRMED
RECOVERY_FAILED
RECOVERY_UNAVAILABLE
MITIGATION_ONLY
```

Target law:

```text
ORIGINAL EXECUTION OUTCOME
!=
RECOVERY OUTCOME
```

A failed original action can have a successful compensation; a successful original effect can later be reversed; an irreversible successful effect can only be mitigated. Preserve all three truths.

### D. Idempotency must be consequence-aware

Target distinction:

```text
EFFECT DEDUPE
!= CONSEQUENCE COMPLETENESS
```

For a known external effect identity such as a provider refund ID:

```text
external effect already exists
→ do NOT create another external effect
→ DO idempotently complete missing required local consequences
   - domain evidence
   - ledger/revenue posting
   - invoice/balance reconciliation
   - workflow descendants
   - OutcomeEvidence links
```

This resolves the F155 class without weakening provider/webhook dedupe.

### E. Bind provider-native idempotency to stable KeyFlow effect identity where supported

For providers that expose native request-id/idempotency semantics:

```text
KeyFlow EffectId / RecoveryEffectId
→ deterministic provider idempotency token
→ same token on safe retry
→ provider operation ID captured when known
→ webhook/status lookup reconciles final state
```

Adopted reference properties include Stripe `Idempotency-Key` and PayPal `PayPal-Request-Id` semantics. Provider retention windows do not replace KeyFlow's durable identity.

### F. Operator recovery must act on recovery truth, not raw status labels

Use KF-REC-047 Temporal Work Projection as the cross-domain operator/read-model surface.

Each recoverable item should expose enough information to decide safely:

```text
WorkOccurrenceId
EffectId
current logical state
failure certainty
last AttemptId / error
provider operation ID if known
external point-of-no-return: before | possible | confirmed
retry budget / next eligibility
cancellation / expiry / supersession state
available actions:
  retry
  reconcile
  cancel
  reverse
  compensate
  mark resolved with evidence
required authority / Clearance
original OutcomeEvidence
RecoveryOutcomeEvidence
```

A UI/API verb such as `retry` must correspond to executable recovery ownership; merely flipping a row to `PENDING` is not sufficient.

### G. Resume preserves confirmed child terminality

Target law:

```text
RE-EXECUTE PARENT
!=
RESUME UNRESOLVED CHILDREN
```

When a workflow/plan resumes after failure or control wait:

- confirmed-success steps stay terminal;
- the same logical occurrence resumes;
- only unresolved/retryable children become eligible;
- a previously successful child executes again only when explicit policy creates a new effect identity.

This addresses the F157 class.

### H. Recovery authority is explicit

```text
retry same still-valid EffectId
→ may continue bounded prior recovery authority only if policy explicitly permits

REVERSAL / COMPENSATION / materially changed action
→ new ActionEnvelope
→ current source state + authority/autonomy/policy
→ fresh Clearance where material
```

Failure, elapsed time or prior approval never grants new recovery authority.

### I. Do not create one universal dead-letter table yet

Current failure sinks differ materially:

- BullMQ failed jobs;
- OutboundDelivery `Failed`;
- ScheduledAgentJob `FAILED`;
- webhook occurrence processing gaps;
- SagaExecution/SagaStep recovery evidence;
- provider-specific pending/failed/unknown states.

Converge first on semantic mappings, safe operator actions, identity/evidence and projection adapters.

A shared physical recovery/DLQ persistence primitive is justified only if later migration analysis proves it removes enough duplication without weakening domain/provider semantics.

---

## Findings directly addressed

- F150 failed ActionDispatcher tombstone defeats BullMQ retry;
- F151 process-local undo eligibility;
- F152 false compensation success;
- F153 control wait compressed to failure;
- F154 recovery outcome overwritten;
- F155 external financial reversal not converged locally;
- F156 retry verb/status without recovery owner;
- F157 plan-level replay of confirmed-success steps;
- strengthened F127/F144/F149/F122/F123 recovery implications.

## Relationships to existing recommendations

```text
KF-REC-038
Durable WorkOccurrence semantic contract
        ↓
KF-REC-040
logical state != attempt/transport state
        ↓
KF-REC-048
certainty-aware recovery / retry / reversal / compensation contract
        ↓
KF-REC-037
provider lifecycle reconciliation
        ↓
KF-REC-047
Temporal Work Projection for user/operator visibility
```

KF-REC-048 does not replace these recommendations; it closes the recovery semantics between them.

---

# Promotion rule

Before implementation:

- map every included work family to failure-certainty classes;
- map effect/attempt/provider identities;
- classify external point-of-no-return;
- define retry budget/backoff ownership;
- define domain/provider reconciliation mechanism;
- classify cancel/void/reversal/compensation/mitigation semantics;
- define authority/Clearance for every material recovery action;
- characterize current operator surfaces and compatibility behavior;
- prove completed child work cannot be replayed accidentally;
- prove ambiguous external outcome cannot be blindly retried;
- prove dedupe cannot suppress missing local consequence repair;
- define migration for live failed/pending/compensated rows;
- design concurrency/crash/replay tests;
- keep KF-REC-047 derivative rather than a new workflow source of truth.

No production implementation is authorized by this continuation.
