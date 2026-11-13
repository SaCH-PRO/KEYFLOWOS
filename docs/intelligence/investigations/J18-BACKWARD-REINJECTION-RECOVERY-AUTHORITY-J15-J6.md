# J18 Backward Reinjection — Recovery Authority into J15 / J6

Status: TARGET-SEMANTIC REINJECTION / NO PRODUCTION IMPLEMENTATION AUTHORIZED
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Current audit-only head: `168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Source journey: J18 Failure → Recovery
Affected journeys: J15 Approval/Governance, J6 Proactive KEY/Autonomy, J2 Governed Action, J23 Temporal Flow
Primary kernels: K3 Governance, K7 Temporal/Workflow, K8 Evidence, K9 External Reality, K11 Recovery

---

## 1. Why J18 reopens authority

J15 already establishes:

```text
APPROVAL != CLEARANCE
```

and exact-action Clearance is current authorization for one exact governed effect.

J6 already establishes:

```text
learning/history != standing authority grant
```

and proactive work must carry explicit standing-authority provenance.

J18 adds a missing dimension:

> Failure does not answer whether a future recovery action is the **same authorized effect**, a **new effect**, or merely **observation/reconciliation**.

Without that distinction a system can accidentally:

- demand fresh approval for every harmless retry attempt;
- reuse old approval for a materially new refund/reversal;
- let autonomous recovery exceed the standing delegation that allowed the original action;
- ignore stop/revocation while retries continue;
- treat compensation as automatically authorized merely because the original action was authorized.

---

## 2. Recovery authority classes

### A. RECONCILE

Purpose:

```text
observe provider/domain authoritative state
```

It should not create a new business effect merely to discover truth.

Authority model:

- still tenant-scoped and capability-controlled;
- normally governed as a read/reconciliation capability;
- does not inherit write authority simply because the original action existed;
- can often continue after write authority is revoked if policy permits safe read-only reconciliation needed to establish truth.

Target law:

```text
RECONCILIATION AUTHORITY
!=
MUTATION AUTHORITY
```

### B. RETRY — same EffectId

A true retry means:

```text
same WorkOccurrenceId
same EffectId
new AttemptId
same intended material effect
```

The original exact-action Clearance **may** cover later attempts only when the clearance/recovery policy explicitly defines bounded continuation semantics.

Candidate bounded retry scope:

```yaml
clearance_id: ...
effect_id: ...
retry_authority:
  allowed: true
  max_attempts: ...
  expires_at: ...
  max_elapsed_time: ...
  allowed_failure_classes: [retryable_transport, ...]
  requires_reconcile_before_retry: true|false
  stop_on_authority_change: true|false
  stop_on_source_state_change: true|false
```

Every attempt still re-checks material validity:

- cancellation/supersession/expiry/lateness;
- source/business state;
- policy/communication window;
- authority revocation where material;
- external uncertainty.

Target law:

> A retry does not need a new human approval merely because an attempt number changed, but it also does not have perpetual authority merely because attempt 1 was cleared.

### C. RESUME after durable wait

Resume continues the same logical WorkOccurrence.

Prior ControlEvidence can remain historically valid while current Clearance changes.

```text
approval evidence from time T1
→ wait
→ material policy/authority/action state changes at T2
→ re-evaluate Clearance
```

Therefore:

```text
CONTROL EVIDENCE MAY SURVIVE
but
CLEARANCE MUST BE CURRENT
```

This directly strengthens J15's approval/version invalidation rules.

### D. CANCEL / STOP / REVOKE

Stopping not-yet-effective work is not the same authority as executing the original action.

KeyFlow should model an explicit **stop right** / recovery-control capability.

A business owner/operator may be allowed to stop future work even when they do not possess the capability to perform the underlying external action themselves.

For J6:

```text
PAUSE / STOP / KILL / DELEGATION REVOKE
→ dominates not-yet-effective retries and descendants
```

except read-only reconciliation required to establish external truth may continue under separately valid reconciliation authority.

Target law:

```text
STOP AUTHORITY
can be broader than
EXECUTE AUTHORITY
```

because stopping future risk is not equivalent to creating that risk.

### E. VOID

Domain-native void/cancellation is a new state transition even if it prevents a future effect.

Examples:

- void unpaid invoice;
- cancel booking before service;
- revoke inactive/unused provider payment link.

Authority must be evaluated for the void/cancel capability and current domain state.

### F. REVERSAL

Examples:

- Stripe/PayPal refund;
- provider-native deletion of an already-created external artifact where available.

A reversal is a **new RecoveryEffectId**.

```text
original EffectId E
→ SUCCEEDED
→ RecoveryEffectId R
→ REFUND / DELETE / REVERSE
```

The original Clearance does not automatically authorize R.

Financial reversal especially requires proportional current authority/control because it creates a new money movement.

Target law:

```text
ORIGINAL ACTION CLEARANCE
!=
REVERSAL CLEARANCE
```

### G. COMPENSATION

Compensation is always a new business effect intended to mitigate/offset the original.

Examples:

- apology/follow-up message after irreversible communication;
- replacement booking/service;
- credit or commercial concession outside native provider reversal.

It therefore requires:

```text
new ActionEnvelope
new RecoveryEffectId
current authority/policy/readiness
new ControlRequirement
fresh Clearance where material
```

### H. PRE-AUTHORIZED COMPENSATION

A bounded composite workflow may intentionally pre-authorize a known compensation at the time of original Clearance.

Example shape:

```text
Approve transaction/workflow W
including:
  effect A
  if A succeeds and B fails:
    compensation C allowed up to bounded scope X
```

This is not blanket reuse of the original approval. It is explicit parent coverage over a known compensation capability/parameter/risk envelope.

If compensation escapes those bounds, fresh control is required.

---

## 3. J15 refinements

J18 adds the following J15 target invariants.

### J15-R1 — Clearance has recovery scope

Clearance should be able to state whether it covers:

```text
attempt 1 only
bounded same-effect retries
resume after specific waits
known bounded compensation
```

Silence means no assumption of open-ended recovery authority.

### J15-R2 — Retry identity is exact-action identity

A same-effect retry preserves the original action fingerprint/material parameters.

Material mutation creates a new action and invalidates prior retry coverage.

### J15-R3 — Failure is not authorization evidence

```text
failure / timeout / crash
!=
approval to try something else
```

Fallback action, alternate provider, increased amount, changed recipient, expanded scope, or compensating action must be governed according to its actual capability/effect.

### J15-R4 — Recovery freshness is independently evaluable

Before any material recovery mutation:

```text
EffectiveAuthority(now)
policy(now)
source/business state(now)
ControlEvidence validity
recovery scope
→ current Clearance
```

### J15-R5 — Original and recovery lineage remain linked but distinct

Evidence graph:

```text
Original ActionEnvelope
→ Original Clearance
→ EffectId
→ OutcomeEvidence

EffectId
→ Recovery ActionEnvelope
→ Recovery Clearance
→ RecoveryEffectId
→ RecoveryOutcomeEvidence
```

### J15-R6 — Reconciliation does not silently mutate

A reconcile/status lookup may observe truth under read authority. Any repair mutation discovered as necessary becomes a separately governed consequence/recovery action unless policy explicitly grants bounded automatic repair.

---

## 4. J6 refinements

### J6-R1 — Standing autonomy includes an explicit recovery profile

A proactive delegation should not merely say what KEY may do. It should define what KEY may do **when that action fails**.

Candidate profile:

```yaml
recovery_policy:
  automatic_retry:
    allowed: true
    attempts: 3
    max_elapsed: PT30M
  reconcile_unknown: true
  automatic_cancel_on_stale_source: true
  automatic_reversal: false
  automatic_compensation: false
  require_human_after_attempts: 3
```

### J6-R2 — Recovery cannot widen autonomy

Historical success/failure data may tune retry recommendations, but cannot expand:

- risk tier;
- spend/refund authority;
- provider scope;
- recipient/resource scope;
- compensation capability;
- retry budget beyond authorized policy.

### J6-R3 — Pause/kill/revoke dominates retry

If proactive authority is paused/revoked after attempt N:

```text
scheduled retry N+1
→ no mutation
→ CANCELLED / SUPERSEDED / AWAITING_CONTROL as appropriate
```

A queued transport retry is not authority to continue.

### J6-R4 — OUTCOME_UNKNOWN blocks autonomous duplicate effect

Proactive KEY must not interpret “still failed locally” as permission to repeat an external action when prior external outcome is unknown or already confirmed.

### J6-R5 — automatic compensation must be separately bounded

A standing delegation for `send reminder` does not imply standing authority to:

- refund money;
- send apology/credit offers;
- delete external posts;
- cancel bookings;
- change customer/account state.

These are separate recovery capabilities unless explicitly included in the delegation envelope.

### J6-R6 — Recovery budget is part of autonomy budget

Retries/reversals/compensations consume real provider rate limits, money, communication volume and risk.

Therefore autonomous recovery needs budgets such as:

- attempt count;
- elapsed time;
- financial amount;
- communication count;
- provider/API spend;
- affected-resource count.

---

## 5. Required recovery-clearance decision

Target resolver shape:

```text
RecoveryIntent
  original WorkOccurrenceId
  original EffectId
  failure certainty
  requested recovery action
  current source state
  original Clearance + recovery scope
  current authority/autonomy/delegation
  current policy/readiness
  recovery impact/budget

→ RecoveryControlRequirement
→ current Clearance / denial / wait
```

This can reuse the same J15 control machinery. Do not create a parallel `RecoveryApprovalService` source of truth.

---

## 6. State interactions

### Authority revoked during retry backoff

```text
RETRYING
→ authority/delegation revoked
→ retry transport may still wake
→ eligibility revalidation denies effect
→ CANCELLED / SUPERSEDED / AWAITING_CONTROL
```

### Policy changed during wait

```text
AWAITING_EXTERNAL / WAITING_TIME
→ policy changes
→ resume eligibility
→ old ControlEvidence retained historically
→ current Clearance re-evaluated
```

### Provider success + local consequence failure

F158/F159 class:

```text
provider success confirmed
→ local persistence/consequence failed
```

Recovery authority should normally permit **reconciliation and idempotent local consequence repair** without authorizing the provider effect again.

If repair itself is financially/materially mutating, its bounded repair capability must be explicit.

### Original success + desired reversal

```text
OutcomeEvidence = SUCCEEDED
→ reversal requested
→ new RecoveryActionEnvelope
→ fresh control/authority
→ RecoveryEffectId
```

---

## 7. Backward-reinjection verdict

No new approval/governance subsystem is justified.

J18 strengthens J15/J6 as follows:

```text
J15
→ Clearance gains explicit recovery scope + freshness semantics
→ same-effect retry may be pre-authorized within bounds
→ reversal/compensation is a new exact-action clearance problem
→ failure never grants fallback authority

J6
→ standing delegation gains explicit recovery policy/budget
→ pause/kill/revoke dominates retries
→ OUTCOME_UNKNOWN forbids blind autonomous retry
→ compensation/reversal authority must be separately bounded
```

This is target refinement, not a duplicate finding root by itself.

---

## 8. Proof obligations

Future proof must include:

1. retry attempt while original Clearance still valid and retry scope permits;
2. retry wake after authority revoked — effect blocked;
3. retry wake after source state makes action obsolete — effect cancelled/superseded;
4. provider timeout → OUTCOME_UNKNOWN → autonomous duplicate blocked;
5. confirmed provider success + local failure → local repair without provider re-send;
6. refund requested after successful payment → fresh proportional control unless explicitly pre-authorized;
7. compensation outside parent recovery bounds → AWAITING_CONTROL;
8. proactive loop paused during retry backoff → retry does not mutate;
9. reconciliation can continue under valid read authority while write authority is revoked;
10. changed recovery parameters produce new action fingerprint and invalidate old recovery clearance.

No runtime tests were executed in this forensic pass.
