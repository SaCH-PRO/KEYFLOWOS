# J18 Kernel Reinjection — K11 / K9 / K8 / K10

Status: TARGET-SEMANTIC REINJECTION / HORIZONTAL CONVERGENCE
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Source journey: J18 Failure → Recovery
Affected kernels: K11 Recovery/Reliability, K9 Integration/External Reality, K8 Evidence/Outcome, K10 Financial Truth
Adjacent kernels: K3 Governance, K6 State Transition, K7 Temporal/Workflow

---

## 1. Purpose

J18 has produced enough microscopic evidence to stabilize the boundary among four horizontal truth owners.

```text
K11
= ownership of attempts/recovery execution

K9
= strongest truth about external provider effect

K8
= durable normalized evidence of original + recovery outcomes

K10
= convergence of monetary consequences where money is involved
```

No one kernel may silently absorb the others.

---

## 2. Shared recovery algebra

```text
WorkOccurrenceId
→ EffectId
→ AttemptId
→ ExecutionClaim / ownership
→ domain/provider attempt
→ strongest known outcome
→ local/domain consequences
→ recovery decision
→ if same effect retry: same EffectId + new AttemptId
→ if reversal/compensation: new RecoveryEffectId
→ RecoveryAttemptId
→ RecoveryOutcomeEvidence
```

Required orthogonal axes:

### Work state

```text
SCHEDULED
ELIGIBLE
RUNNING
RETRYING
AWAITING_EXTERNAL
OUTCOME_UNKNOWN
SUCCEEDED
FAILED_FINAL
CANCELLED
SUPERSEDED
EXPIRED
```

### Failure certainty

```text
RETRYABLE_ATTEMPT_FAILURE
FAILED_FINAL_CONFIRMED
AWAITING_EXTERNAL
OUTCOME_UNKNOWN
SUCCEEDED_CONFIRMED
```

### Recovery outcome

```text
RECOVERY_AVAILABLE
RECOVERY_REQUESTED
RECOVERY_ATTEMPTED
RECOVERY_SUCCEEDED_CONFIRMED
RECOVERY_FAILED
RECOVERY_UNAVAILABLE
MITIGATION_ONLY
```

---

## 3. K11 — Recovery/Reliability reinjection

K11 gains these target laws from F150-F160.

### K11-R1 — failed attempt is not effect terminality

Failed idempotency/evidence records cannot defeat a still-live retry policy.

F150 is the canonical counterexample.

### K11-R2 — post-provider failure is a distinct recovery phase

Once provider success is observed:

```text
provider execution phase = terminal success
local consequence phase = incomplete / repairing
```

A local DB/evidence error cannot return the effect to generic execution retry.

F159 is the canonical counterexample.

### K11-R3 — same-effect retry vs new recovery effect

```text
RETRY
  same EffectId

REVERSAL / COMPENSATION
  new RecoveryEffectId
```

### K11-R4 — parent resume preserves child terminality

A parent workflow cannot re-run confirmed-success children merely because another child failed/waited.

F157 is canonical.

### K11-R5 — recovery ownership must be executable

A status label such as `PENDING` is not recovery ownership.

F156 is canonical.

### K11-R6 — stop/revocation dominates not-yet-effective recovery

Recovery attempts wake into current eligibility/authority checks. Queue ownership never grants stale authority.

### K11-R7 — no universal DLQ yet

Different fabrics retain specialized failure storage/worker mechanisms while sharing the Recovery Contract.

---

## 4. K9 — Integration/External Reality reinjection

### K9-R1 — provider success + local failure is not provider failure

```text
PROVIDER_SUCCESS_CONFIRMED
+
LOCAL_CONSEQUENCE_FAILURE
→ CONSEQUENCE_INCOMPLETE / RECONCILING
```

F158/F159 establish this strongly.

### K9-R2 — provider lineage is part of crash recovery

Before or immediately after crossing provider PONR, preserve enough durable/provider-owned identity to later reconcile:

- EffectId/provider idempotency token;
- provider operation/order/capture/message/post ID;
- local business entity correlation;
- provider account/connector identity.

Stripe checkout metadata is a positive pattern.

### K9-R3 — provider-native idempotency is part of effect identity

Where supported:

```text
EffectId / RecoveryEffectId
→ deterministic provider idempotency token
→ same token across safe retry
```

### K9-R4 — local delete is not external reversal

F160 strengthens this:

```text
LOCAL DELETE
!= PROVIDER DELETE
```

### K9-R5 — destination-specific recovery

For multi-provider publication/delivery, external recovery outcome is per provider artifact, not one aggregate local flag.

### K9-R6 — reconciliation is first-class after uncertainty or consequence loss

Reconciliation may repair local consequences without repeating provider effect.

---

## 5. K8 — Evidence/Outcome reinjection

### K8-R1 — original outcome and recovery outcome are independent evidence dimensions

```text
Original OutcomeEvidence
!=
RecoveryOutcomeEvidence
```

F154 shows why one saga status field is insufficient.

### K8-R2 — compensation handler return is not recovery outcome proof

Typed evidence needs to distinguish:

```text
requested
attempted
confirmed inverse
failed
unavailable
mitigation-only
```

F152 is canonical.

### K8-R3 — effect evidence vs consequence completeness

```text
Effect already occurred
!=
all required local consequences converged
```

F155 is canonical.

### K8-R4 — evidence must preserve provider-known success during local failure

F158/F159 require explicit evidence such as:

```text
provider_outcome = succeeded
local_consequence_state = incomplete
```

rather than replacing provider truth with local error state.

### K8-R5 — per-destination recovery evidence

A multi-platform social publication may have:

```text
Facebook reversal confirmed
LinkedIn reversal unavailable
Instagram reversal failed
```

One `deleted`/`compensated` flag cannot faithfully represent that set.

---

## 6. K10 — Financial Truth reinjection

K10 is instantiated from this evidence pressure.

### K10-R1 — financial truth is a consequence set

```text
provider payment/refund outcome
+ Payment evidence
+ ledger posting/reversal
+ invoice/order reconciliation
= financial truth convergence
```

### K10-R2 — confirmed provider financial effect never regresses to failure because local persistence failed

F158 is canonical.

### K10-R3 — refund dedupe cannot suppress missing accounting consequences

F155 is canonical.

### K10-R4 — payment retry state requires actual financial recovery ownership

F156 is canonical.

### K10-R5 — financial reversal is a new governed effect

Refund/credit/reversal requires RecoveryEffectId + current proportional authority except where explicitly pre-authorized within bounded recovery scope.

---

## 7. Cross-kernel ownership table

| Question | Owner |
|---|---|
| Does logical work still exist / may it wake? | K7 |
| Who owns this attempt / retry / recovery execution? | K11 |
| Did provider accept/do the external effect? | K9 |
| What durable evidence proves original/recovery outcome? | K8 |
| Do payment + ledger + invoice/order consequences agree? | K10 |
| Is this recovery action authorized now? | K3 / J15/J6 |
| Is the resulting business-state transition legal? | K6 |

---

## 8. Cross-kernel invariants

1. `ATTEMPT_FAILED != EFFECT_FAILED_FINAL`.
2. `PROVIDER_SUCCESS + LOCAL_FAILURE != PROVIDER_FAILURE`.
3. `OUTCOME_UNKNOWN -> RECONCILE BEFORE UNSAFE RETRY`.
4. `RETRY -> same EffectId`; `REVERSAL/COMPENSATION -> new RecoveryEffectId`.
5. `ORIGINAL OUTCOME != RECOVERY OUTCOME`.
6. `EFFECT DEDUPE != CONSEQUENCE COMPLETENESS`.
7. `LOCAL DELETE != EXTERNAL REVERSAL`.
8. `PENDING STATUS != EXECUTABLE RECOVERY WORK`.
9. `PARENT RESUME != REPLAY CONFIRMED CHILD SUCCESS`.
10. financial effect truth is not converged until required accounting/domain consequences agree.
11. recovery authority is current and bounded; failure creates no authority.
12. external/provider lineage survives the crash windows it is needed to reconcile.

---

## 9. Target event/evidence edges for digital twin

Add/strengthen stable graph edges such as:

```text
ATTEMPT_OF
RETRY_OF_EFFECT
RECOVERY_OF
REVERSAL_OF
COMPENSATES
MITIGATES
PROVIDER_OPERATION_FOR
PROVIDER_ACCEPTED_AS
OUTCOME_EVIDENCE_FOR
RECOVERY_EVIDENCE_FOR
CONSEQUENCE_OF
RECONCILES
REPAIRS_CONSEQUENCE
AUTHORIZED_BY_CLEARANCE
RECOVERY_AUTHORIZED_BY
```

For financial truth:

```text
PAYMENT_EVIDENCE_FOR
LEDGER_POSTING_FOR
LEDGER_REVERSAL_OF
BALANCE_RECONCILED_BY
```

---

## 10. Migration implications

Near-term migration remains evolutionary:

```text
existing domain/queue/provider records
→ add/derive shared recovery semantics
→ preserve EffectId/provider identity
→ distinguish provider outcome from local consequence state
→ make repair idempotent/consequence-aware
→ project through KF-REC-047
```

Do not introduce a universal Recovery table/runtime solely to satisfy these semantics.

K10 likewise does not justify a new ledger/payment subsystem; it establishes convergence invariants over existing seams.

---

## 11. Proof obligations

Cross-kernel proof should include:

- provider success then DB failure → no provider retry; local repair only;
- provider timeout → unknown until reconciled;
- same-effect retry preserves EffectId/provider idempotency token;
- reversal uses distinct RecoveryEffectId and current Clearance;
- duplicate event/effect evidence can repair missing consequences without repeating external effect;
- parent resume preserves successful child state;
- social/provider delete reports per-destination reversal outcome;
- financial recovery converges provider + Payment + ledger + invoice/order truth;
- stop/revoke during retry backoff prevents next mutation;
- operator projection explains why a work item is safe/unsafe to retry.

No runtime tests were executed in this forensic reinjection pass.
