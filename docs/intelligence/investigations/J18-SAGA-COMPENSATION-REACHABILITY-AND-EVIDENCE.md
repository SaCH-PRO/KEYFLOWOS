# J18 Saga Compensation — Reachability & Evidence Trace

Status: ACTIVE FORENSIC NOTE / UNNUMBERED PENDING REGISTER STABILIZATION
Implementation baseline: `main@5ec358e9b792817eda1e37fd80a0574eb7905a8a` (audit-only advance over code-bearing `d7c5b86c...`)
Primary journey: J18 Failure → Recovery
Affected kernels: K6 State Transition, K8 Evidence/Outcome, K11 Recovery/Reliability
Adjacent journeys: J2, J6, J15, J23

> This note intentionally has no new F/C/KF-REC IDs while the canonical branch is concurrently allocating them. Pool only after re-reading the latest register tail.

---

## 1. Existing seam is real but weakly reached

`KeyCortexSagaService` persists `SagaExecution` / `SagaStep`, step inputs/outputs, compensation actions/results and saga terminal status.

`KeyCortexCompensationService` contains concrete compensators for several domains, including CRM deletes, invoice voiding, booking cancellation, task cancellation, calendar cancellation and communication recall/marking semantics.

`KeyCortexSagaExecutorService.executeSagaBatch()` pre-registers steps with compensating actions and can invoke reverse-order compensation after batch failure.

However current repository search for `executeSagaBatch(` finds the method definition and spec usage only. No non-spec production caller was observed in this pass.

Therefore:

```text
DURABLE COMPENSATION MACHINERY EXISTS
!=
COMPENSATION IS A LOAD-BEARING PRODUCTION RECOVERY PATH
```

Target should strengthen/evaluate this seam rather than creating `Saga2` or another compensation engine.

---

## 2. Pre-registration + stop-on-failure creates unexecuted pending steps

`KeyCortexSagaExecutorService.executeSagaBatch()` pre-registers **every** command as a SagaStep before calling `KeyCortexExecutorService.executeBatch()`.

`executeBatch()` executes sequentially and stops on first failure by default (`BATCH_STOP_ON_FAILURE = true`).

Therefore a batch such as:

```text
step 0 succeeds
step 1 fails
step 2 never executes
step 3 never executes
```

still has persisted SagaStep rows for steps 2 and 3, normally with `status='pending'` and potentially with a `compensationAction`.

---

## 3. `compensate()` does not filter to successfully completed effects

`KeyCortexSagaService.compensate(sagaId)` loads **all** saga steps in reverse step order:

```text
findMany({ sagaId }, orderBy stepIndex desc)
```

and then invokes compensation for every step that has a `compensationAction`.

It does not require:

```text
step.status == completed
```

or other proof that the forward effect occurred.

Thus pre-registered-but-never-executed `pending` steps can enter the compensation path after an earlier batch failure.

Target recovery law:

> Compensation eligibility derives from confirmed forward-effect evidence, not merely from the existence of a pre-registered compensator.

Candidate state condition:

```text
forward effect SUCCEEDED / effect existence confirmed
+ compensation declared
+ compensation still valid/authorized
→ compensation eligible
```

Do not compensate `pending`, approval-waiting, blocked-before-effect or definitely-failed-before-effect work.

---

## 4. No-op compensation handlers can be reported as compensated

`KeyCortexCompensationService.compensate(actionRef, input)` does:

```text
handler = handlers.get(actionRef)
if no handler → compensated:false
await handler(input)
return { compensated: true, actionRef }
```

Several registered handlers return early when the required output/entity ID is missing, for example patterns such as:

```text
const entityId = input.output?.id ?? input.parameters?....
if (!entityId || !businessId) return
```

The wrapper interprets that successful return as `compensated:true` even when no reverse state transition occurred.

`KeyCortexSagaService.compensate()` then marks the SagaStep:

```text
status='compensated'
compensationResult=<wrapper result>
```

Therefore the evidence model can claim compensation for a no-op.

This is particularly relevant to unexecuted pre-registered steps, which naturally lack forward output IDs.

Target law:

```text
COMPENSATION REQUEST ACCEPTED
!= COMPENSATION EFFECT EXECUTED
!= COMPENSATION OUTCOME PROVEN
```

A compensation handler should return typed outcome evidence, including a distinct `NOT_APPLICABLE` / `NO_EFFECT_TO_REVERSE` / `FAILED` state where appropriate.

---

## 5. Compensation must preserve original-effect truth

Even valid compensation does not mean the original action never occurred.

Target evidence chain:

```text
Original Effect
  OutcomeEvidence = SUCCEEDED
        ↓
RecoveryDecision
  compensation selected
        ↓
Compensation ActionEnvelope / authority
        ↓
Compensation ExecutionClaim
        ↓
Compensation OutcomeEvidence
        ↓
Original effect remains historical truth
Current business state reflects compensating transition
```

Examples:

```text
invoice issued → invoice voided
booking created → booking cancelled
message sent → cannot truly be unsent; may only mark/review/follow-up
```

This aligns with the existing J18 distinction:

```text
RETRY != CANCEL != REVERSAL != COMPENSATION != UNDO UX
```

---

## 6. Strong existing properties to preserve

- durable SagaExecution / SagaStep records;
- reverse-order compensation sequencing;
- explicit `compensation_unavailable` / `compensation_failed` saga states added by current code;
- tenant scoping in several compensation handlers;
- explicit absence of compensation mappings where no real inverse is known;
- domain-aware distinction that sent communication cannot be magically unsent.

These are better starting points than a new generic rollback framework.

---

## 7. Proof requirements before this seam can become load-bearing

1. only confirmed forward effects are compensable;
2. pending/unexecuted steps never receive compensating side effects;
3. a no-op handler cannot produce `compensated` evidence;
4. compensation is tenant-bound and authority-checked;
5. compensation itself has idempotent/atomic effect identity;
6. crash during compensation can resume from durable compensation state;
7. partial compensation produces truthful mixed state rather than all-or-nothing fiction;
8. provider/non-reversible effects use reconciliation or mitigation, not false rollback semantics;
9. production reachability is explicit and bounded before enabling automatic compensation;
10. no tests are claimed executed by this forensic note.

---

## 8. Pooling guidance

Before assigning IDs:

- re-fetch the canonical findings/contradiction tails because another architecture process is actively adding J18 records;
- classify production non-reachability separately from compensation-evidence correctness;
- avoid duplicating the already-canonical UndoService durability finding;
- reuse existing J18/K11 recovery recommendations unless a new target primitive is genuinely required.

No production implementation is authorized by this note.
