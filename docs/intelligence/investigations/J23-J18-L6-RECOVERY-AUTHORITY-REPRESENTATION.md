# J23 + J18 L6 — Recovery Authority Representation

Status: ACTIVE TARGET-CONVERGENCE / SEMANTIC REPRESENTATION
Implementation authorized: **NO**
Implementation evidence: `main@168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Code-bearing forensic baseline: `d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Primary journeys: J15 Approval/Governance, J6 Proactive KEY/Autonomy, J18 Failure/Recovery, J23 Temporal Flow, J2 Governed Action
Primary kernels: K3 Governance, K6 State Legality, K7 Temporal Work, K8 Evidence, K9 External Reality, K10 Financial Truth, K11 Recovery

> Goal: represent recovery authority precisely enough to support target convergence, migration and proof without freezing a premature database schema or creating a parallel recovery-approval subsystem.

---

## 1. Governing distinction

Recovery is not one permission.

```text
RECONCILE
RETRY
RESUME
STOP / CANCEL
VOID
REVERSAL
COMPENSATION
MITIGATION_ONLY
```

have different authority implications.

Core law:

```text
FAILURE DOES NOT GRANT AUTHORITY.
```

A failure, timeout, crash, missed schedule, provider ambiguity, stale local row or operator frustration cannot widen the action that was previously authorized.

The representation therefore has to answer two different questions:

```text
1. What recovery action is semantically correct now?
2. Is that recovery action currently authorized now?
```

Neither question may be collapsed into a retry counter or status transition.

---

## 2. Standard floor versus KeyFlow target

### 2.1 Production floor

Strong authorization systems commonly evaluate a principal, action, resource and contextual information for each authorization request. Fine-grained authorization standards also support carrying detailed action/resource parameters rather than only coarse scopes. Dynamic/contextual authorization systems show that request-time data such as time or other state can legitimately affect authorization decisions.

These properties validate several KeyFlow requirements:

- exact action/resource binding;
- current contextual evaluation;
- default-deny behavior;
- explicit fine-grained action details;
- policy changes affecting future authorization decisions;
- historical grant evidence does not mean perpetual future authorization.

They are the floor, not the final KeyFlow design.

### 2.2 Why the normal solution is insufficient

A conventional policy check normally answers something like:

```text
Can principal P perform action A on resource R in context C?
```

Recovery needs more context than a normal mutation because the current decision depends on causal history:

```text
What original action existed?
Was the provider effect created?
What is known versus uncertain?
Which attempt failed?
Is the requested recovery the same effect or a new effect?
Has the source state changed?
Has the business value of the action expired?
Has authority changed?
Has the recovery budget already been consumed?
Would this create a duplicate irreversible effect?
Is this repair local consequence completion rather than provider mutation?
```

Therefore KeyFlow's target should not be merely “run authorization again before retry.”

### 2.3 KeyFlow synthesis

The differentiated target is a **Recovery Clearance Loop**:

```text
Original Intent / ActionEnvelope
+ Original Clearance
+ WorkOccurrence / Effect / Attempt lineage
+ OutcomeEvidence / FailureCertainty
+ Provider Reality
+ Source / Business State now
+ Authority / Delegation now
+ Recovery Budget consumed / remaining
+ Time / lateness / policy now
+ Financial / communication / resource impact

→ RecoveryIntent
→ RecoveryControlRequirement
→ Recovery Clearance decision
→ recovery mutation OR reconcile OR wait OR stop
→ new evidence
→ next decision if still unresolved
```

This is not a generic workflow retry policy. It is a governed closed-loop recovery decision over current business reality.

---

## 3. Semantic representation — Clearance RecoveryScope

This is a semantic contract. Field names are target concepts, not yet an ORM schema commitment.

```yaml
Clearance:
  clearance_id: ClearanceId
  action_fingerprint: ActionFingerprint
  issued_for:
    action_type: ...
    resource_scope: ...
    tenant_id: ...
    principal_or_agent: ...
  authority_revision: ...
  delegation_revision: ... | null
  policy_revision: ...
  issued_at: ...
  expires_at: ... | null
  invalidation_rules: [...]

  recovery_scope:
    same_effect_retry:
      allowed: true|false
      max_attempts_total: ... | null
      max_recovery_attempts: ... | null
      max_elapsed_time: ... | null
      retry_window_expires_at: ... | null
      allowed_failure_certainty:
        - RETRYABLE_ATTEMPT_FAILURE
      require_reconcile_before_retry_when:
        - OUTCOME_UNKNOWN
        - AWAITING_EXTERNAL
      stop_on_authority_revision_change: true|false
      stop_on_delegation_revision_change: true|false
      stop_on_policy_revision_change: true|false
      stop_on_material_source_change: true|false
      stop_on_lateness_violation: true|false

    resume:
      allowed_after_waits:
        - WAITING_TIME
        - AWAITING_CONTROL
        - AWAITING_DEPENDENCY
        - AWAITING_EXTERNAL
      require_current_clearance_recheck: true

    reconcile:
      allowed: true|false
      read_capability: ...
      may_continue_after_write_revocation: policy_decision

    cancel_or_stop:
      allowed: true|false
      scope: own_work|tenant_work|delegated_work|...

    void:
      allowed: true|false
      capability: ...
      bounds: ...

    reversal:
      preauthorized: true|false
      allowed_types: [...]
      max_financial_amount: ... | null
      max_resource_count: ... | null
      max_risk_tier: ... | null
      provider_scope: [...] | null
      requires_fresh_clearance_if_material_change: true

    compensation:
      preauthorized: true|false
      allowed_types: [...]
      max_financial_amount: ... | null
      max_communication_count: ... | null
      max_resource_count: ... | null
      max_risk_tier: ... | null
      requires_fresh_clearance_if_outside_parent_envelope: true
```

### 3.1 Required semantics

The target representation must preserve these distinctions:

```text
ControlEvidence = historical evidence that control/approval occurred.
Clearance       = current authorization decision for an exact action.
RecoveryScope   = bounded continuation/recovery rights attached to that exact Clearance.
RecoveryIntent  = what the system/operator proposes to do now.
```

A past approval can remain valid historical evidence while a present recovery mutation is denied.

### 3.2 Clearance identity and fingerprint

The recovery decision must bind to material action identity.

At minimum the fingerprint must detect material changes such as:

- provider/action family;
- recipient / target resource;
- financial amount/currency;
- content/template where policy materially depends on it;
- business object / source revision;
- risk tier or capability;
- tenant/business;
- external resource identity where known.

Target law:

```text
MATERIAL ACTION MUTATION
→ NEW ACTION FINGERPRINT
→ OLD SAME-EFFECT RETRY COVERAGE DOES NOT APPLY
```

### 3.3 Revision binding

A Clearance should record the authority/delegation/policy revisions used when issued.

This does **not** imply every unrelated policy edit revokes every action. It enables deterministic invalidation rules.

Possible decision categories:

```text
UNCHANGED_MATERIAL_AUTHORITY
MATERIAL_AUTHORITY_CHANGED_REEVALUATE
DELEGATION_REVOKED_STOP
POLICY_CHANGED_BUT_NONMATERIAL
POLICY_CHANGED_MATERIAL_REEVALUATE
```

---

## 4. J6 Standing RecoveryPolicy

Standing authority for proactive KEY must define failure behavior, not only happy-path permission.

Semantic target:

```yaml
StandingRecoveryPolicy:
  policy_id: ...
  delegation_id: ...
  delegation_revision: ...

  automatic_reconcile:
    allowed: true
    allowed_provider_scopes: [...]

  automatic_retry:
    allowed: true|false
    max_attempts_per_effect: ...
    max_elapsed_per_effect: ...
    allowed_failure_certainty:
      - RETRYABLE_ATTEMPT_FAILURE
    prohibit_when:
      - OUTCOME_UNKNOWN
      - SUCCEEDED_CONFIRMED
      - CANCELLED
      - SUPERSEDED
      - EXPIRED

  stale_work:
    auto_cancel_if_source_obsolete: true|false
    auto_cancel_if_late_beyond: ... | null
    await_human_if_materially_changed: true|false

  automatic_reversal:
    allowed: true|false
    allowed_types: [...]
    max_amount_per_effect: ... | null
    max_amount_per_period: ... | null
    provider_scope: [...] | null

  automatic_compensation:
    allowed: true|false
    allowed_types: [...]
    max_financial_amount: ... | null
    max_communication_count: ... | null
    max_resource_count: ... | null

  budgets:
    max_retry_attempts_per_period: ... | null
    max_provider_api_spend_per_period: ... | null
    max_financial_recovery_value_per_period: ... | null
    max_communications_per_period: ... | null
    max_affected_resources_per_period: ... | null

  escalation:
    require_human_on_unknown_outcome: true
    require_human_after_attempts: ... | null
    require_human_above_financial_amount: ... | null
    require_human_above_risk_tier: ... | null
    require_human_on_policy_or_authority_change: true|false
```

### 4.1 Hard J6 laws

```text
LEARNING MAY SUGGEST A BETTER RECOVERY POLICY.
LEARNING MAY NOT SILENTLY EXPAND AUTHORITY.
```

```text
AUTONOMY BUDGET
includes
RECOVERY BUDGET.
```

```text
PAUSE / KILL / REVOKE
beats
not-yet-effective RETRY / REVERSAL / COMPENSATION.
```

Read-only reconciliation may continue only when separately authorized and useful to establish external truth.

---

## 5. Recovery authority decision function

Target semantic resolver:

```text
resolveRecoveryAuthority(
  RecoveryIntent,
  OriginalActionEnvelope,
  OriginalClearance,
  WorkOccurrence,
  Effect,
  AttemptHistory,
  FailureCertainty,
  OutcomeEvidence,
  ProviderReality,
  ConsequenceState,
  CurrentSourceState,
  CurrentAuthority,
  CurrentDelegation,
  CurrentPolicy,
  RecoveryBudgetState,
  TemporalValidity
)

→ one of:
  AUTHORIZED
  AUTHORIZED_RECONCILE_ONLY
  AWAITING_CONTROL
  DENIED_REVOKED
  DENIED_STALE_SOURCE
  DENIED_BUDGET_EXHAUSTED
  DENIED_UNSAFE_UNCERTAINTY
  CANCELLED
  SUPERSEDED
  EXPIRED
```

No universal physical resolver service is committed yet. This is the shared semantic function that existing J15/J6 control seams must converge on.

---

## 6. Action-specific authority matrix

| Recovery action | Same original EffectId? | New RecoveryEffectId? | Typical authority behavior | Current-state requirement |
|---|---:|---:|---|---|
| RECONCILE | yes/reference | no | read/reconciliation capability | provider/domain truth lookup valid |
| RETRY | yes | no | may reuse bounded RecoveryScope | same material intent + retry certainty + budget + current validity |
| RESUME | yes | no | historical ControlEvidence may survive; Clearance re-evaluated | source/policy/authority still current |
| STOP/CANCEL pending work | n/a | maybe no provider effect | explicit stop right may be broader than execute | work not yet irreversibly effective |
| VOID | no | usually yes recovery action identity | current domain mutation authority | resource still voidable |
| REVERSAL | no | yes | fresh proportional authority unless explicitly pre-authorized | original effect confirmed + provider/domain reversal legal |
| COMPENSATION | no | yes | fresh authority unless inside explicit bounded parent envelope | mitigation remains useful/legal/current |
| MITIGATION_ONLY | no | yes where material | separately governed follow-up action | true inverse unavailable |

---

## 7. Stop authority versus execute authority

KeyFlow should explicitly preserve an asymmetric safety property:

```text
STOP AUTHORITY MAY BE BROADER THAN EXECUTE AUTHORITY.
```

An operator can reasonably be authorized to prevent future risk without being authorized to create the original risky effect.

Examples:

- pause proactive outreach without permission to send messages;
- stop future refund retries without authority to issue refunds;
- cancel an unexecuted scheduled action without permission to perform it;
- revoke a standing KEY delegation without possessing each delegated capability.

This is a strong KeyFlow control property and should surface in operator UX later.

---

## 8. Certainty-aware recovery authority

A conventional authorization layer often ignores whether the system knows what happened externally. KeyFlow should make certainty an authorization input.

### 8.1 Retryable attempt failure

```text
FailureCertainty = RETRYABLE_ATTEMPT_FAILURE
+ same material EffectId
+ retry scope valid
+ budget remains
+ source still current
→ RETRY may be authorized
```

### 8.2 Unknown external outcome

```text
FailureCertainty = OUTCOME_UNKNOWN
→ duplicate mutation authorization = DENY / WAIT
→ RECONCILE is preferred authorized action
```

### 8.3 Provider success + consequence incomplete

```text
Outcome = SUCCEEDED_CONFIRMED
ConsequenceState = INCOMPLETE
→ provider RETRY is invalid
→ local/domain consequence repair may be authorized
```

This is especially important for K10 financial truth and F158/F159 class failures.

---

## 9. Adaptive recovery budget — innovation candidate

### Problem / opportunity

Static retry counts are poor proxies for actual business risk. Three harmless status lookups and three refund attempts are not equivalent.

### Why the normal solution is insufficient

Typical retry policies budget attempts/time. They do not naturally combine:

- financial exposure;
- provider cost;
- communication volume;
- affected resource count;
- certainty;
- reversibility;
- business freshness;
- operator intervention.

### Novel KeyFlow synthesis

Candidate concept: **Recovery Risk Budget**.

Instead of only:

```text
attempts_remaining = 2
```

KeyFlow can compute a bounded recovery envelope from multiple dimensions:

```text
RecoveryBudgetState = {
  attempts,
  elapsed_time,
  financial_value,
  provider_spend,
  communications,
  affected_resources,
  uncertainty_cost,
  irreversibility_weight
}
```

The budget is still deterministic policy-controlled. ML/KEY may recommend future policy changes but cannot silently change the live authority envelope.

Verdict: **TARGET-CANDIDATE**, subject to proof that complexity yields material operator/safety value.

---

## 10. Recovery authority re-pricing — innovation candidate

### Problem / opportunity

The value/risk of a recovery action can change while work waits.

Examples:

- a reminder becomes pointless after the customer pays;
- a booking retry becomes harmful after the slot expires;
- a delayed post becomes reputationally unsafe after campaign context changes;
- a refund changes from optional goodwill to mandatory correction after reconciliation;
- a provider timeout becomes known success after webhook evidence arrives.

### Novel KeyFlow synthesis

Candidate concept: **Recovery Authority Re-pricing**.

At each material wake/recovery boundary, KeyFlow recomputes:

```text
current usefulness
current risk
current certainty
current authority
current reversibility
remaining budget
```

and can move work between:

```text
AUTO_RECOVER
RECONCILE_FIRST
AWAIT_CONTROL
STOP_AS_STALE
MITIGATE_ONLY
```

This is stronger than static approval + retry because Temporal history, Authority, Evidence and Business Graph state participate in the decision.

Verdict: **ACCEPTED-DIRECTION at semantic level**. Physical implementation remains unconverged.

---

## 11. Recovery Control Twin — innovation candidate

### Problem / opportunity

Operators normally inspect separate queues, logs, provider dashboards and approval screens. This fragments the answer to “what may the system safely do next?”

### Novel KeyFlow synthesis

The future Temporal Work Projection can expose a derivative **Recovery Control Twin** per unresolved effect:

```text
original intent
current work state
external certainty
consequence completeness
current authority
remaining recovery budget
recommended legal next actions
why each action is allowed/blocked
latest evidence
stop/revoke controls
```

Important: this is a projection/read model, not a new source of truth.

Potential value:

- operator sees one causal recovery picture;
- KEY can explain why it is waiting rather than retrying;
- governance can distinguish “needs approval” from “needs external truth”;
- recovery queues become generated views over live semantics, not isolated DLQ tables.

Verdict: **TARGET-CANDIDATE**, to be carried into Temporal Work Projection materialization.

---

## 12. Counterfactual recovery simulation — research candidate

For higher-risk recovery actions, KeyFlow may eventually use Business Graph + Genome + current state to simulate immediate consequences before mutation:

```text
If we refund this payment:
- what invoice/order balance changes?
- what ledger reversal is required?
- what downstream automation becomes invalid?
- what customer communication is triggered?
- what authority/budget is consumed?
```

This could make Clearance depend not only on action parameters but on a computed consequence envelope.

This is promising but not yet necessary for J18/J23 L6 convergence.

Verdict: **RESEARCH / DEFER**.

---

## 13. Explicit non-decisions

This artifact does **not** justify:

- a new `RecoveryApprovalService`;
- a universal policy engine migration;
- adopting Cedar/OpenFGA/OPA as a product dependency;
- a universal RecoveryOccurrence table;
- a workflow engine;
- a generic DLQ;
- machine-learned authorization decisions;
- autonomous authority expansion;
- physical schema names above as final ORM design.

External systems validate properties. They are not selected implementations.

---

## 14. Migration implications

Existing rows generally lack explicit recovery authority metadata.

Historical migration must therefore distinguish:

```text
PROVEN     — explicit durable evidence supports a recovery-authority conclusion
DERIVABLE — conclusion follows from source fields + current semantic adapter
AMBIGUOUS  — insufficient evidence; do not invent old authority/retry rights
UNKNOWN    — historical control context unrecoverable
```

Do not backfill “retry allowed” merely because work historically retried.

For live migration, preferred order remains:

```text
preserve raw control/effect/work records
→ add semantic recovery decision at write/wake boundaries
→ persist new evidence/revision/budget data where justified
→ expose derivative projection
→ migrate consumers
```

---

## 15. Operator permissions that must remain distinct

Future operator action model should distinguish at least:

```text
VIEW_RECOVERY_STATE
RECONCILE_EXTERNAL_STATE
STOP_FUTURE_WORK
CANCEL_PENDING_WORK
RETRY_SAME_EFFECT
RESUME_WORK
VOID_RESOURCE
REQUEST_REVERSAL
APPROVE_REVERSAL
EXECUTE_REVERSAL
REQUEST_COMPENSATION
APPROVE_COMPENSATION
EXECUTE_COMPENSATION
OVERRIDE_STALE_OR_LATE_BLOCK
```

Do not compress these into `manage_recovery` without later proof that the broader permission is safe.

---

## 16. Proof obligations

Target proof inventory must eventually include:

1. same EffectId retry while RecoveryScope remains valid;
2. retry blocked after authority/delegation revocation;
3. retry blocked after material source change;
4. OUTCOME_UNKNOWN permits reconcile but blocks blind duplicate mutation;
5. provider success + local failure routes to consequence repair, not provider replay;
6. historical approval remains visible while current Clearance is denied;
7. stop right succeeds for operator lacking execute right where policy allows;
8. compensation outside pre-authorized envelope becomes AWAITING_CONTROL;
9. recovery budget exhaustion blocks autonomous continuation;
10. budget counters survive process restart/replica movement if they govern authority;
11. policy revision changes only invalidate materially affected recoveries;
12. proactive pause/kill dominates scheduled retry wake;
13. reversal amount above standing bound requires fresh control;
14. material fingerprint mutation cannot reuse old retry Clearance;
15. reconciliation after write revocation does not silently perform repair mutation;
16. Recovery Control Twin never becomes an independent authoritative state machine.

No runtime proof was executed in this architecture-forensics tranche.

---

## 17. Anti-normalization pressure-test verdict

### H1 — FLOOR

Adopt exact-action, contextual, current authorization; fine-grained action details; default-deny; revision-aware invalidation; bounded rights.

### H2 — FRONTIER

Use dynamic context and continuous/request-time reevaluation as evidence that authorization need not be a one-time static grant. Keep uncertainty, causal evidence and bounded autonomy as first-class decision inputs rather than hidden workflow implementation details.

### H3 — KEYFLOW SYNTHESIS

Do **not** stop at “policy check before retry.”

Target semantic direction:

```text
certainty-aware
+ causal-history-aware
+ source-state-aware
+ revocable
+ budgeted
+ consequence-aware
+ explainable
RECOVERY CLEARANCE LOOP
```

with a derivative Recovery Control Twin for operator/KEY visibility.

This is materially more differentiated than the normal retry/DLQ/approval pattern while preserving production safety.

---

## 18. Convergence verdict

J15/J6 recovery authority representation is now semantically converged enough to unblock the next J23/J18 L6 tranche.

Accepted direction:

```text
Clearance carries bounded RecoveryScope semantics.
Standing delegation carries bounded RecoveryPolicy semantics.
Every material recovery wake can re-price current recovery authorization.
OUTCOME_UNKNOWN narrows mutation authority toward reconciliation.
Stop/revoke dominates future mutation.
Reversal/compensation remain new governed effects.
Recovery budget is multidimensional, not merely retry count.
Operator/KEY view should be derivative from canonical evidence/state, not a new queue truth.
```

Next exact action:

`J23-J18-L6-TEMPORAL-WORK-PROJECTION-MATERIALIZATION.md`

Converge source adapters, derivative projection fields, freshness/rebuild strategy, tenant/evidence minimization, operator queries, Recovery Control Twin representation, and live-vs-materialized value engineering.
