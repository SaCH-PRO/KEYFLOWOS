# KEYFLOWOS — Next Chat Rollover Packet

Status: LIVE CONTINUITY ARTIFACT — UPDATE THROUGHOUT ACTIVE CHAT
Last refreshed: 2026-09-04
Canonical intelligence branch: `docs/keyflow-intelligence-foundation`
Production implementation authorized: **NO**

> This packet is deliberately self-contained enough to recover the active analytical frontier after chat/context loss. It supplements — and does not replace — canonical intelligence artifacts.

---

## 1. New-chat instruction

In a fresh ChatGPT/Claude/Kimi/Codex session, use this instruction:

```text
Continue KEYFLOWOS from the canonical repository intelligence.

First load:
1. AGENTS.md
2. docs/intelligence/AGENT-CONTINUITY.md
3. docs/intelligence/00-START-HERE.md
4. docs/intelligence/handoff/CURRENT-HANDOFF.md
5. docs/intelligence/handoff/CURRENT-STATE.yaml
6. docs/intelligence/handoff/NEXT-CHAT-ROLLOVER.md
7. docs/intelligence/handoff/NEXT-CHAT-ROLLOVER.yaml
8. every active dossier/investigation/register referenced there.

Run the Context Integrity Check before substantive work.
Do not modify production code. Continue the exact next forensic/architecture action from the rollover packet. Preserve MAP BEFORE MODIFYING, stable IDs, evidence classification, finding/contradiction/recommendation sequencing, and repository-first continuity.
```

If any listed canonical file conflicts with this rollover packet, the newer repository artifact/commit wins after explicit reconciliation. Never invent missing continuity.

---

## 2. Context integrity snapshot

```text
Repository:             SaCH-PRO/KEYFLOWOS
Implementation branch:  main
Implementation head:    5ec358e9b792817eda1e37fd80a0574eb7905a8a
Code-bearing baseline:  d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
Head change class:       audit-only
Intelligence branch:     docs/keyflow-intelligence-foundation
Context integrity:       PASS
```

Revalidate `main` before relying on implementation evidence if it gains code-bearing changes.

---

## 3. Governing programme state

Prime thesis:

> **KeyFlowOS is a governed business-state transition system.**

Operating model:

```text
25 journeys
+ 12 kernels
+ journey constellations
+ kernel constellations
+ global invariants
+ findings / contradictions / open questions
+ standards / OSS / provider research
+ target state / migration / proof
+ dependency / impact graph
= computable KeyFlowOS digital twin
```

Current active mesh:

```text
J1 Business Birth
↕ J25 Human Authority
↕ J2 Governed Action
↕ J15 Approval / Governance
↕ J6 Proactive KEY / Autonomy
↕ J14 External Event Ingress
↕ J23 Temporal Flow / Long-Running Workflow
↕ J18 Failure / Recovery
```

Current maturity:

```text
J23 = L5 VALUE-ENGINEERED / ENTERING L6 TARGET-CONVERGENCE
J18 = ACTIVE FORENSICS / ENTERING TARGET POOLING
```

Production implementation remains blocked.

---

## 4. Canonical register frontier

```text
Findings:        F157
Contradictions:  C107
Recommendations: KF-REC-048
```

Do not reuse these IDs.

Latest recovery findings:

```text
F150 failed ActionDispatcher idempotency tombstone defeats BullMQ retry
F151 UndoService eligibility is process-local/non-replicated
F152 Saga compensation can falsely report compensated
F153 KeyCortex approval wait can become parent plan/saga failure
F154 planner overwrites Saga recovery outcome with generic failed
F155 provider refund can bypass ledger/invoice reconciliation and suppress webhook repair
F156 payment retry changes FAILED→PENDING without an observed executable provider recovery owner
F157 plan execute-again can replay already-completed steps
```

Latest contradictions:

```text
C100 retry policy vs idempotency terminality
C101 recovery promise vs recovery-state durability
C102 compensated claim vs confirmed inverse effect
C103 child control wait vs parent failure
C104 recovery outcome vs generic failure overwrite
C105 provider refund vs split Payment/ledger/invoice truth
C106 retry verb vs absence of executable recovery work
C107 parent re-execution vs confirmed child terminality
```

Latest recommendation:

```text
KF-REC-048 certainty-aware Recovery Contract across existing execution fabrics
```

---

## 5. J18 recovery target already accepted/provisionally accepted

Failure-certainty axis:

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

Recovery-outcome axis:

```text
RECOVERY_AVAILABLE
RECOVERY_REQUESTED
RECOVERY_ATTEMPTED
RECOVERY_SUCCEEDED_CONFIRMED
RECOVERY_FAILED
RECOVERY_UNAVAILABLE
MITIGATION_ONLY
```

Recovery action taxonomy:

```text
RETRY
  same intended EffectId, new AttemptId

RECONCILE
  observe authoritative external/domain state

CANCEL
  prevent not-yet-effective work

VOID
  domain-native cancellation where legal

REVERSAL
  new inverse RecoveryEffectId

COMPENSATION
  new mitigating/offsetting RecoveryEffectId

MITIGATION_ONLY
  follow-up/annotation when inverse effect is impossible
```

Core laws:

```text
ATTEMPT FAILURE != LOGICAL-WORK FAILURE
ORIGINAL OUTCOME != RECOVERY OUTCOME
EFFECT DEDUPE != CONSEQUENCE COMPLETENESS
PROVIDER TIMEOUT != CONFIRMED NON-EFFECT
CONTROL WAIT != FAILURE
PENDING STATUS != EXECUTABLE RECOVERY WORK
RE-EXECUTE PARENT != RESUME UNRESOLVED CHILDREN
FAILURE / ELAPSED TIME != RECOVERY AUTHORITY
```

---

## 6. Architecture decisions already in force

J23:

```text
ONE SHARED DURABLE-WORK SEMANTIC CONTRACT   = YES
ONE CROSS-DOMAIN TEMPORAL WORK PROJECTION   = YES
ONE UNIVERSAL WorkOccurrence TABLE          = NOT JUSTIFIED YET
ONE UNIVERSAL WORKFLOW RUNTIME               = NOT JUSTIFIED YET
```

J18/operator recovery:

```text
ONE RECOVERY SEMANTIC CONTRACT               = YES — KF-REC-048
ONE CROSS-DOMAIN OPERATOR PROJECTION         = YES — extend KF-REC-047
ONE UNIVERSAL DEAD-LETTER TABLE              = NOT JUSTIFIED YET
ONE UNIVERSAL RECOVERY WORKER                = NOT JUSTIFIED YET
```

Do not introduce `WorkflowEngine2`, a mega-table, or a universal DLQ just because heterogeneous recovery defects exist.

---

## 7. Strong existing seams to preserve

- BullMQ attempts/backoff/locks/stalled recovery;
- ActionDispatcher as the central effect boundary to strengthen;
- OutboundDelivery + DeliveryEvent stable durable delivery/attempt seam;
- SagaExecution + SagaStep durable recovery evidence where corrected;
- provider operation IDs + provider-native idempotency + reconciliation;
- `CommerceService.markPaymentRefunded()` with ledger reversal;
- provider refund `createRefundWithPosting()` + invoice reconciliation;
- quote-followup cancellation/current-source-state revalidation;
- KF-REC-047 Temporal Work Projection;
- domain-native state machines for booking cancellation and invoice voiding.

---

## 8. Important evidence already established

### ActionDispatcher/BullMQ

Inner dispatcher retry exhaustion writes a failed `AiExecutionLog` with idempotency key K. Later BullMQ attempts reuse K, hit that failed log, and return the stored failure without another effect attempt. This is F150.

### Saga/planner

The production planner does create a real durable saga and compensation metadata. Do not regress to the older claim that Saga is wholly unreachable.

But:

- no-op/mitigation handler can be recorded as `compensated` — F152;
- approval wait can become parent failure from stale `plan.steps` — F153;
- compensation outcome can be overwritten by `failSaga()` — F154;
- invoking `executePlan()` again iterates all stored steps and can replay completed effects — F157.

### Refunds

`PaymentsOpsService.refundCharge()` calls real Stripe/PayPal refund APIs and gets provider refund IDs, then best-effort creates a negative local `Payment` row but does not run ledger reversal/invoice reconciliation.

Stripe/PayPal refund webhooks contain the stronger financial path, but first return if the refund `providerPaymentId` already exists. Thus the manual row can suppress repair. This is F155.

### Payment "retry"

`CommerceService.retryPayment()` only changes local `Payment.status` from `FAILED` to `PENDING` and logs a CRM event. No generic provider worker consuming that state was found. This is F156.

### Operator/dead-letter fragmentation

- BullMQ failed set: real transport-native retry machinery;
- OutboundDelivery Failed: strongest current domain/operator retry seam;
- ScheduledAgentJob FAILED: terminal row, no generic retry owner observed;
- WebhookEvent: occurrence identity, no failed-processing lifecycle;
- Saga/AiExecutionLog: evidence sinks, not complete recovery queues;
- AI action queue: diagnostic visibility, not effect-aware recovery console;
- Payment FAILED→PENDING: state flip without provider retry ownership.

---

## 9. External/reference properties adopted

Adopt properties, not products.

- Stripe `Idempotency-Key` for safe POST retry after connection errors;
- PayPal `PayPal-Request-Id` for safe retry/idempotency including refunds;
- provider operation/refund IDs as reconciliation evidence;
- BullMQ job retry/ID as transport lifecycle, not business-effect finality.

Current inspected Stripe/PayPal refund connectors do not send those provider-native idempotency headers.

This strengthens F149/KF-REC-037 rather than creating another duplicate external-uncertainty finding.

---

## 10. Exact next substantive action

**Do this next; do not reopen already-converged work first.**

```text
Trace representative provider-effect-succeeded / local-persistence-failed crash windows beyond refunds.
```

Priority candidates:

1. PayPal capture succeeds → local Payment persistence fails;
2. Stripe/PayPal payment-link/order creation succeeds → local/domain state or returned lineage unavailable;
3. outbound communication provider send succeeds → local delivery/message persistence fails;
4. booking/calendar external/notification side effects where provider success precedes durable local consequence;
5. any external integration where a catch block records `FAILED` after a request may already have crossed point-of-no-return.

For each candidate classify:

```text
EffectId
AttemptId
provider idempotency token present?
provider operation ID obtainable after timeout?
external point of no return
local persistence boundary
callback/webhook/status reconciliation path
whether callback dedupe can suppress missing consequence repair
safe retry vs OUTCOME_UNKNOWN
operator repair surface
recovery authority requirement
```

Create a new finding only for a genuinely distinct root defect. Strengthen F149/F127/F136/etc. when appropriate.

---

## 11. Work immediately after the crash-window tranche

1. complete remaining material provider/domain cancellation/reversal matrix;
2. backward re-audit J15/J6 specifically for recovery authority + fresh Clearance;
3. reinject KF-REC-048 into K11/K9/K8/K10;
4. reinject J18 into J23 L6 field/status + live-row migration + proof mapping;
5. decide whether J18 is ready to promote from active forensics into L5 value-engineering/target convergence.

---

## 12. Canonical files to load for this frontier

Mandatory:

- `docs/intelligence/00-START-HERE.md`
- `docs/intelligence/07-CURRENT-STATE.md`
- `docs/intelligence/handoff/CURRENT-HANDOFF.md`
- `docs/intelligence/handoff/CURRENT-STATE.yaml`
- `docs/intelligence/journeys/KF-JOURNEY-018-FAILURE-RECOVERY.md`
- `docs/intelligence/investigations/J18-RECOVERY-CERTAINTY-REVERSAL-AND-IDEMPOTENCY-MATRIX.md`
- `docs/intelligence/investigations/J18-OPERATOR-RECOVERY-AND-DEAD-LETTER-MAP.md`
- `docs/intelligence/08K-FINDING-REGISTER-RECOVERY-SUPPLEMENT.md`
- `docs/intelligence/09K-CONTRADICTION-REGISTER-RECOVERY-SUPPLEMENT.md`
- `docs/intelligence/10G-RECOMMENDATION-REGISTER-RECOVERY-CONTINUATION.md`
- `docs/intelligence/journeys/KF-JOURNEY-023-TEMPORAL-FLOW-LONG-RUNNING-WORKFLOW.md`
- `docs/intelligence/kernels/KF-KERNEL-007-TEMPORAL-EVENT-WORKFLOW.md`
- `docs/intelligence/kernels/KF-KERNEL-008-EVIDENCE-OUTCOME.md`
- `docs/intelligence/kernels/KF-KERNEL-009-INTEGRATION-EXTERNAL-REALITY.md`
- `docs/intelligence/kernels/KF-KERNEL-010-FINANCIAL-TRUTH.md` if present/instantiated;
- `docs/intelligence/kernels/KF-KERNEL-011-RECOVERY-RELIABILITY.md`
- J15/J6 dossiers before authority reinjection.

Also load all current 08*, 09*, 10* continuations to preserve ID sequencing.

---

## 13. Do-not-do list

- do not modify production code;
- do not create parallel `*2`/`v2` sources of truth;
- do not install Temporal/Camunda from these findings alone;
- do not confuse transport state with logical work truth;
- do not blind-retry `OUTCOME_UNKNOWN`;
- do not treat compensation handler return as confirmed reversal;
- do not let effect dedupe suppress missing consequence repair;
- do not treat a status flip as real retry without an execution owner;
- do not replay completed children while resuming a parent;
- do not assign a new finding when an existing root already covers the evidence;
- do not claim runtime/test proof unless actually executed.

---

## 14. Rollover maintenance protocol

Update this packet and `NEXT-CHAT-ROLLOVER.yaml`:

- after every new canonical finding/contradiction/recommendation tranche;
- after every target-convergence decision;
- whenever the exact next action changes;
- before any broad research tranche likely to consume substantial context;
- immediately if conversation compaction/context loss is suspected;
- before ending a long session.

Because model/UI context limits are not a reliable architectural storage mechanism, do not depend on an exact visible token threshold. The repository packet must always remain usable if the chat ends on the next message.

Target invariant:

> **At every meaningful checkpoint, a new chat can recover the same analytical frontier solely from repository state.**
