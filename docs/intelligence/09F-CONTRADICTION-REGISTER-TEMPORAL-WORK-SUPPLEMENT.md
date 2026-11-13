# KeyFlowOS Contradiction Register — Temporal Work Supplement

Status: CANONICAL CONTINUATION OF the KeyFlowOS contradiction register after `09E-CONTRADICTION-REGISTER-EXTERNAL-INGRESS-SUPPLEMENT.md`

Canonical sequence continues after C087.

---

## C088 — declared temporal wait vs completed workflow step

**Status:** VERIFIED ACTIVE CONTRADICTION

FlowRunner can represent a delay greater than 30 seconds as a completed step and immediately continue downstream traversal.

The declared workflow meaning is "do not continue until later", while persisted/executed semantics are "this step completed now".

Target resolution:

```text
DELAY DECLARED
→ WAITING_TIME
→ wake condition reached
→ resume same logical step/occurrence
```

Waiting must remain non-terminal.

Affected kernels: K7, K8, K11.
Affected journeys: J6, J18, J23.

---

## C089 — unresolved human control vs completed scheduled occurrence

**Status:** VERIFIED ACTIVE CONTRADICTION

DelegationLoop can create a human approval item for a due occurrence and nevertheless mark the corresponding DelegationLoopRun completed and advance recurrence.

The control plane says material work is still unresolved, while the temporal history says the occurrence finished.

Target resolution: approval/control waiting is a durable `AWAITING_CONTROL` state on the same logical occurrence; recurrence/history should not falsely terminalize unresolved work.

Affected kernels: K3, K7, K8, K11.
Affected journeys: J6, J15, J18, J23.

---

## C090 — retryable execution attempt vs terminal logical workflow failure

**Status:** VERIFIED ACTIVE CONTRADICTION

BullMQ can retain a failed plan-step job for automatic retry while QueueService has already persisted `AiPlanStep.status='failed'`.

Thus transport truth and workflow truth disagree:

```text
BullMQ: attempt failed, retry remains
AiPlan: step failed terminally
```

Target resolution: attempt lifecycle and logical step lifecycle are distinct. Only exhausted/non-retryable failure terminalizes the logical step.

Affected kernels: K7, K8, K11.
Affected journeys: J2, J6, J18, J23.

---

## C091 — queue transport state vs logical workflow state

**Status:** VERIFIED SYSTEMIC CONTRADICTION

AiPlanStep persistence compresses scheduled/queued/active/retrying/control-wait/terminal semantics into a small status vocabulary, while BullMQ maintains a richer transport lifecycle.

As a result, dependency progression and plan finalization can be based on transient transport-attempt state rather than durable logical workflow truth.

Target resolution:

```text
LOGICAL WORK STATE
separate from
WORKER / QUEUE ATTEMPT STATE
```

The queue may implement waiting/locking/retry mechanics, but it must not redefine whether the business workflow step is semantically complete or terminal.

Affected kernels: K7, K8, K11.
Affected journeys: J2, J6, J18, J23.

---

# Pool law

```text
WAIT STATE
!= TERMINAL STATE

ATTEMPT STATE
!= LOGICAL STEP STATE

TRANSPORT STATE
!= BUSINESS WORKFLOW TRUTH
```

No production implementation is authorized by this supplement.
