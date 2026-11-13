# J23 + J18 L6 — Temporal Work Projection Materialization

Status: ACTIVE TARGET-CONVERGENCE / DERIVATIVE READ-MODEL DESIGN
Implementation authorized: **NO**
Implementation evidence: `main@168732d0e2226e11ed033c14fbdf7b3ea5344a41`
Primary journeys: J23 Temporal Flow, J18 Failure/Recovery, J17 Command Center, J15 Governance, J6 Proactive KEY, J14 External Ingress
Primary kernels: K7 Temporal Work, K8 Evidence, K9 External Reality, K10 Financial Truth, K11 Recovery, K3 Governance

> Goal: converge one cross-domain Temporal Work Projection that makes unresolved work, uncertainty, recovery authority and consequence completeness operable without becoming another authoritative workflow engine or source of truth.

---

## 1. Governing law

```text
PROJECTION != SOURCE OF TRUTH
```

The Temporal Work Projection exists to answer cross-domain questions that current domain tables cannot answer ergonomically in one place.

It must never become a shadow state machine that independently decides what work “really” is.

Source truth remains distributed across legitimate domain owners such as:

- AiPlan / AiPlanStep;
- AiExecutionLog;
- OutboundDelivery / DeliveryEvent;
- ScheduledAgentJob;
- WebhookEvent + downstream domain evidence;
- Payment / Invoice / FinancialTransaction / LedgerEntry;
- SocialPost + per-destination provider artifacts/evidence;
- Flow / Delegation / other work-family owners where applicable.

The projection derives semantic state from those sources using explicit adapters and evidence rules.

---

## 2. Why a projection is justified

A cross-domain read model is justified because operators and KEY need questions such as:

```text
What work is still alive?
What is waiting, and why?
What failed only at attempt level versus finally?
Which external outcomes are uncertain?
Which provider effects succeeded but local consequences are incomplete?
What can be safely retried right now?
What requires reconciliation first?
What is stale or superseded?
What authority currently permits or blocks recovery?
What should an operator do next?
```

Answering these directly from each source would duplicate semantic logic in every UI, agent and operational tool.

The projection centralizes **interpretation**, not canonical business state.

---

## 3. Source adapter contract

Each source family needs a semantic adapter that produces the unified dimensions without mutating the source row.

Candidate adapter contract:

```yaml
source_adapter_result:
  source:
    family: ...
    entity_type: ...
    entity_id: ...
    business_id: ...
    source_updated_at: ...
    source_version_or_fingerprint: ...

  identity:
    work_occurrence_id: ... | derived
    parent_occurrence_id: ... | null
    effect_id: ... | null
    latest_attempt_id: ... | null
    recovery_effect_id: ... | null

  temporal:
    scheduled_for: ... | null
    eligible_at: ... | null
    started_at: ... | null
    last_transition_at: ... | null
    terminal_at: ... | null
    lateness_state: ... | null

  semantics:
    work_state: ...
    original_outcome: ...
    consequence_state: ...
    failure_certainty: ...
    recovery_action: ... | null
    recovery_state: ... | null

  external:
    provider: ... | null
    provider_operation_id: ... | null
    provider_state: ... | null
    external_point_of_no_return: ... | null

  governance:
    clearance_id: ... | null
    clearance_status: ... | null
    recovery_scope_summary: ... | null
    delegation_id: ... | null
    stop_or_revoke_state: ... | null

  evidence:
    outcome_evidence_refs: [...]
    recovery_evidence_refs: [...]
    consequence_evidence_refs: [...]
    classification: PROVEN|DERIVABLE|AMBIGUOUS|UNKNOWN
    confidence_reason: ...
```

The adapter must preserve source ambiguity. It may not upgrade “likely” into “confirmed.”

---

## 4. Initial source-specific adapter rules

### 4.1 AiPlan / AiPlanStep

Important mappings:

- `pending` requires time/dependency/current-eligibility interpretation;
- `executing` is ambiguous because current code writes it after enqueue, before BullMQ execution;
- `running` is stronger but can still reflect crash/stale process state;
- `awaiting_approval` / `waiting_approval` → AWAITING_CONTROL;
- `failed` must inspect attempt/retry/effect evidence before RETRYING vs FAILED_FINAL vs OUTCOME_UNKNOWN;
- `completed` is not enough to prove all external consequences where tool effects are provider-backed.

Projection must never blindly reproduce the source status label as unified truth.

### 4.2 AiExecutionLog / ActionDispatcher

- `success=false` is attempt/effect evidence, not automatic logical final failure;
- failed log under a stable idempotency key cannot be treated as consumed terminal effect identity;
- provider-backed tool success must be qualified by provider operation/evidence when available.

### 4.3 OutboundDelivery / DeliveryEvent

- `Queued`, `Scheduled`, `Sending`, `RetryPending`, `Failed`, `Sent`, `Published`, `Cancelled` require provider/evidence interpretation;
- `Sending` is especially unsafe as a direct logical state after crash;
- post-provider local persistence failure must project provider success + consequence incomplete, not RetryPending/Failed as permission to resend;
- DeliveryEvent can contribute attempt chronology but does not alone decide final business outcome.

### 4.4 ScheduledAgentJob

- PENDING future → SCHEDULED/WAITING_TIME;
- PENDING due → ELIGIBLE candidate subject to source-state validation;
- COMPLETED can mean local handler completion only and must not overclaim downstream effect completion;
- FAILED requires certainty/retry ownership analysis.

### 4.5 WebhookEvent

Existing row proves provider event occurrence was durably seen/claimed.

It does not prove downstream application completed.

Projection needs at least:

```text
RECEIVED
PROCESSING/UNKNOWN
APPLIED_CONFIRMED
FAILED_PROCESSING
REPAIR_REQUIRED
```

as derivative interpretation from downstream evidence, not by rewriting WebhookEvent itself.

### 4.6 Payment / Invoice / Ledger

Projection should expose K10 consequence convergence:

```text
provider outcome
payment evidence
ledger consequence
invoice/order consequence
```

and distinguish:

```text
FINANCIAL_TRUTH_CONVERGED
CONSEQUENCE_INCOMPLETE
OUTCOME_UNKNOWN
REVERSAL_IN_PROGRESS
REVERSAL_CONVERGED
```

### 4.7 SocialPost / provider destinations

Top-level `POSTED` is aggregate any-success, not all-destination success.

Projection should fan out one logical provider-artifact row/view per destination where evidence allows:

```text
Facebook: published / uncertain / failed / reversal unavailable / deleted confirmed...
Instagram: ...
LinkedIn: ...
```

Top-level local `deletedAt` must never render as externally deleted without provider evidence.

---

## 5. Unified projected dimensions

Minimum cross-domain fields:

```yaml
identity:
  business_id
  work_occurrence_id
  source_family
  source_entity_type
  source_entity_id
  parent_occurrence_id
  definition_id
  definition_version
  action_fingerprint

state:
  work_state
  waiting_on
  terminal_reason
  original_outcome
  consequence_state
  failure_certainty
  recovery_action
  recovery_state

time:
  scheduled_for
  eligible_at
  started_at
  last_transition_at
  terminal_at
  lateness_state

attempt:
  latest_attempt_id
  attempt_number
  attempts_consumed
  retry_budget_remaining

external:
  provider
  provider_operation_id
  provider_state
  provider_evidence_strength

recovery_control:
  clearance_id
  clearance_state
  current_recovery_disposition
  recovery_budget_summary
  stop_revoke_state
  human_control_needed

causality:
  source_trigger_ref
  parent_occurrence_id
  child_occurrence_count
  original_effect_id
  recovery_effect_id

quality:
  semantic_classification
  projection_freshness
  source_updated_at
  projected_at
  adapter_version
```

Sensitive payloads/content should not be copied by default.

---

## 6. Recovery Control Twin representation

The Recovery Control Twin is a **view over the Temporal Work Projection plus current governance/evidence**, not an extra entity that owns state.

For one unresolved effect it should be able to present:

```text
What was intended?
What definitely happened?
What is uncertain?
What local consequences remain incomplete?
What is the current legal/safe next action set?
Which actions are blocked and why?
What authority/recovery budget remains?
What evidence would resolve the uncertainty?
Can the operator stop future mutation now?
```

Candidate derived next-action set:

```text
RECONCILE_NOW
RETRY_SAME_EFFECT
RESUME
STOP
CANCEL_PENDING
REQUEST_CONTROL
VOID
REQUEST_REVERSAL
REPAIR_CONSEQUENCE
MITIGATE
WAIT_FOR_EXTERNAL
NO_ACTION_TERMINAL
```

Every candidate action must link to a reason/evidence path.

---

## 7. Materialization strategy options

### Option A — live federation only

At query time, read all domain sources and compute adapters live.

Pros:
- maximum freshness;
- no projection lag;
- no materialized copy.

Cons:
- expensive cross-domain fan-out;
- difficult pagination/sorting;
- repeated semantic computation;
- degraded source can break whole operator surface;
- harder historical trend/queue analytics.

Verdict: useful for low-volume verification, not ideal as sole production operator strategy.

### Option B — fully materialized projection

Each source change incrementally updates projection records.

Pros:
- fast queries;
- easy cross-domain filtering;
- operator/KEY-friendly;
- supports trend/age/SLA analysis.

Cons:
- staleness and replay/rebuild semantics become first-class concerns;
- risk of projection becoming accidental source of truth;
- event/write coverage burden across many fabrics.

Verdict: likely useful, but only with explicit derivative contract and rebuildability.

### Option C — hybrid materialized index + live verification

Persist normalized search/index dimensions, then live-read authoritative sources when an operator/KEY opens or acts on an item.

```text
materialized index
→ fast global discovery/filtering
→ item open/action
→ live source + authority + evidence revalidation
→ display/execute based on current truth
```

Pros:
- fast operator experience;
- projection lag cannot authorize stale mutation because action path revalidates source;
- source-specific detail can remain local;
- sensitive payload duplication minimized.

Cons:
- two-stage read complexity;
- UI must clearly distinguish indexed freshness from live validated action state.

**Preferred target direction: HYBRID**, subject to proof and expected data volume.

---

## 8. Freshness semantics

Projection freshness must be explicit rather than hidden.

Candidate metadata:

```text
projected_at
source_updated_at
projection_lag_ms
adapter_version
freshness_state = CURRENT | STALE | REBUILDING | SOURCE_UNAVAILABLE | UNKNOWN
```

Target law:

```text
STALE PROJECTION MAY SUPPORT DISCOVERY.
STALE PROJECTION MUST NOT AUTHORIZE MUTATION.
```

Before any material operator/KEY recovery action, current authoritative source + current Clearance must be revalidated.

---

## 9. Incremental refresh

Do not require one global event bus redesign to create the projection.

Possible incremental sources in early waves:

- existing durable write points emit/trigger projection refresh;
- polling/checkpoint refresh for legacy tables that lack reliable mutation events;
- webhook/domain-event processing can refresh affected source entities;
- projection self-healing scan compares source `updatedAt`/revision against projected fingerprint.

Preferred migration law:

```text
ADOPT REFRESH MECHANISMS PER SOURCE
before
MANDATING ONE NEW GLOBAL EVENTING INFRASTRUCTURE
```

A common projection refresher interface is justified; one universal physical transport is not yet justified.

---

## 10. Rebuildability and drift detection

Because the projection is derivative, it must be rebuildable from canonical data + adapter logic.

Required capabilities:

```text
rebuild business/tenant
rebuild source family
rebuild one entity
replay adapter version
compare projected fingerprint vs current source
mark stale/error without mutating source
```

Drift classes:

```text
SOURCE_NEWER_THAN_PROJECTION
PROJECTION_ORPHAN
ADAPTER_VERSION_STALE
SOURCE_UNAVAILABLE
SEMANTIC_CLASSIFICATION_CHANGED
```

Projection drift is an observability defect, not permission to “repair” canonical source state automatically.

---

## 11. Degraded-source behavior

If one source is unavailable:

- preserve last projected snapshot with explicit staleness;
- do not fabricate terminal state;
- allow operator discovery if useful;
- disable/limit actions requiring that unavailable source;
- surface what verification is missing.

This keeps the Command Center useful without pretending all sources are healthy.

---

## 12. Tenant isolation

Every projection record/query must be business/tenant scoped.

Requirements:

- no cross-business source joins without explicit privileged platform scope;
- projection rebuild operates tenant-scoped by default;
- provider IDs alone are never trusted as tenant identity;
- action deep-links re-resolve tenant + source ownership;
- aggregate operational metrics should separate tenant data from platform health views.

Projection convenience must not weaken source isolation.

---

## 13. Sensitive evidence minimization

The projection should copy only what is needed for discovery/decision support.

Prefer:

```text
IDs
state summaries
risk/authority summaries
provider operation references
error category/code
timestamps
safe reason labels
```

over:

```text
message bodies
full email content
payment details
raw webhook payloads
credentials/tokens
large provider responses
personal data not needed for operator triage
```

Detailed evidence should be fetched from governed source/evidence stores on demand.

---

## 14. Operator query model

High-value first queries:

```text
Needs attention now
Outcome unknown
Provider succeeded / consequence incomplete
Waiting for approval/control
Retrying with budget remaining
Retry blocked by authority/revocation
Stale/late work that should be stopped
Recovery requested but not confirmed
Financial reversals not converged
External artifacts locally deleted but provider reversal unconfirmed
Webhook received but application not confirmed
```

These are semantic queries, not table-specific filters.

---

## 15. KEY query model

KEY should be able to ask the same projection questions in natural business terms:

```text
What work is stuck?
What can I safely recover automatically?
What needs the owner's decision?
Which actions are uncertain externally?
Which successful provider operations still have incomplete business consequences?
What should be stopped because the source is stale?
```

But KEY actions must still live-revalidate source truth and authority before mutation.

---

## 16. Innovation candidate — Attention Gradient

### Problem

Traditional job consoles sort by age, queue, or status. That treats all unresolved work as equally important.

### KeyFlow synthesis

Because the projection can combine:

```text
business impact
certainty
lateness
reversibility
authority state
financial exposure
customer-facing exposure
causal descendants
recovery budget
```

KeyFlow can derive an **Attention Gradient** — not a source-of-truth priority field, but an explainable operator ranking.

Candidate output:

```text
ATTENTION_NOW
VERIFY_SOON
SAFE_TO_AUTORECOVER
WAITING_EXPECTEDLY
STALE_LOW_VALUE
```

with a reason vector such as:

```text
high financial consequence
+ provider outcome unknown
+ retry currently blocked
+ customer impact active
```

Verdict: **TARGET-CANDIDATE**. Must remain explainable and policy-bounded; no opaque ML ranking is required initially.

---

## 17. Innovation candidate — Causal Recovery Horizon

### Problem

A single failed effect can have descendants. Operators need to know not only “what failed?” but “what downstream future work becomes unsafe if we do nothing or recover incorrectly?”

### KeyFlow synthesis

Use causal lineage in the projection to derive a **Recovery Horizon**:

```text
this unresolved effect
→ blocked children
→ scheduled descendants
→ financial/customer/provider consequences
→ latest safe intervention boundary
```

This can answer:

```text
If we wait 20 minutes, what becomes irreversible?
If we cancel this parent, which descendants should be suppressed?
If we reconcile this provider success, which local consequences can now repair?
```

Verdict: **TARGET-CANDIDATE** for later productization; projection should preserve the causal fields now.

---

## 18. Innovation candidate — Contradiction-aware projection

### Problem

Normal dashboards often choose one status and hide disagreement between systems.

KeyFlow already has evidence that the most dangerous states occur when local/provider/domain truth diverge.

### KeyFlow synthesis

The projection should deliberately represent **contradiction**, not normalize it away.

Examples:

```text
LOCAL_FAILED + PROVIDER_SUCCESS
LOCAL_DELETED + PROVIDER_ARTIFACT_LIVE
WEBHOOK_SEEN + CONSEQUENCE_NOT_APPLIED
PAYMENT_REFUNDED + LEDGER_NOT_REVERSED
PARENT_FAILED + CHILD_AWAITING_CONTROL
```

These contradictions become first-class attention signals and reconciliation targets.

Verdict: **ACCEPTED-DIRECTION**.

This is a meaningful KeyFlow differentiator: the operator surface exposes truth disagreements instead of manufacturing a single reassuring status.

---

## 19. Innovation candidate — projection-generated control surfaces

Instead of hard-coding a universal recovery queue with fixed buttons, the operator UI can derive the legal next-action controls from:

```text
current semantic state
+ provider capability
+ recovery authority
+ consequence state
+ stop rights
```

So one item may show:

```text
Reconcile provider
Stop retries
Request refund approval
```

while another shows:

```text
Wait for delivery callback
Cancel scheduled send
```

and another:

```text
Repair ledger consequence
Do NOT resend provider operation
```

Verdict: **ACCEPTED-DIRECTION at product/semantic level**.

The projection informs controls; the authoritative action path still revalidates source state.

---

## 20. Anti-normalization pressure-test verdict

### H1 — FLOOR

A normal read model gives cross-domain searchable state with clear source ownership, tenant isolation, freshness, rebuildability and safe action revalidation.

### H2 — FRONTIER

Modern systems increasingly favor derived operational views, contextual authorization and evidence-driven reconciliation rather than trusting transport state alone.

### H3 — KEYFLOW SYNTHESIS

Do not stop at “unified jobs dashboard.”

The KeyFlow target is:

```text
Temporal Work Projection
+ Recovery Control Twin
+ contradiction visibility
+ explainable Attention Gradient
+ causal Recovery Horizon
+ generated legal next-action controls
```

all derived from canonical domain truth and revalidated before mutation.

This uses the combination of Temporal history + Authority + Evidence + External Reality + Financial Truth in a way a conventional queue console does not.

---

## 21. Migration strategy

### P0 — adapter characterization

- encode current exact mappings already documented;
- no source rewrite;
- snapshot representative rows by semantic class in proof fixtures later.

### P1 — on-demand semantic federation

- implement/query adapters conceptually first;
- validate operator questions can be answered without new canonical state.

### P2 — materialized index pilot where query cost requires

- persist only normalized index fields;
- include adapter version/source fingerprint/freshness;
- keep mutation paths live-revalidated.

### P3 — incremental refresh + rebuild

- per-source refresh adapters;
- drift detection;
- tenant/family/entity rebuild.

### P4 — operator/KEY control twin

- explain allowed/blocked actions;
- expose contradictions and consequence incomplete;
- derive controls from semantics, never from stale projection alone.

### P5 — value-engineer advanced signals

- Attention Gradient;
- Recovery Horizon;
- contradiction trends;
- predictive/learning layers only if proof shows value and explainability remains intact.

---

## 22. Proof obligations

Before execution-ready status, prove at least:

1. source status disagreement is represented rather than silently collapsed;
2. projection can rebuild from canonical source state;
3. stale projection cannot authorize mutation;
4. current source/clearance revalidation occurs before recovery action;
5. tenant isolation survives cross-domain queries;
6. ambiguous historical rows remain AMBIGUOUS/UNKNOWN;
7. provider-success/local-failure projects consequence incomplete without retry permission;
8. webhook occurrence seen but unprocessed remains visible;
9. social local delete does not display provider deleted without evidence;
10. payment refund with missing ledger/invoice consequence is surfaced;
11. projection refresh failure does not mutate source state;
12. adapter-version migration can reclassify projection safely;
13. Recovery Control Twin actions match current provider/recovery capabilities;
14. projection-generated controls fail closed when provider capability is UNCONFIRMED;
15. operator stop action can be exposed independently from execute authority;
16. contradiction-aware ranking remains explainable;
17. projection can degrade per source without manufacturing certainty.

No runtime tests were executed in this architecture-forensics tranche.

---

## 23. Convergence verdict

The materialization/query strategy is semantically converged enough for J23/J18 L6 proof planning.

Accepted direction:

```text
ONE shared semantic projection contract
HYBRID materialized index + live authoritative verification
SOURCE-SPECIFIC adapters
EXPLICIT freshness/staleness
REBUILDABLE derivative state
NO projection-owned mutation truth
Recovery Control Twin as derived operational view
CONTRADICTIONS exposed, not normalized away
provider/financial consequence completeness visible
operator controls generated from current legal next actions
```

Not justified yet:

```text
universal WorkOccurrence source-of-truth table
universal RecoveryOccurrence table
global event-bus rewrite
workflow engine adoption
projection-driven direct mutation without source revalidation
opaque ML operational priority
```

Next exact action:

`docs/intelligence/investigations/J23-J18-L6-CHARACTERIZATION-CONCURRENCY-CRASH-PROOF-INVENTORY.md`

Inventory existing tests/proof seams and define bounded proof obligations for crash windows, concurrency, retries, reconciliation, authority revocation, migration ambiguity and projection correctness. Do not claim tests were run unless actually executed.
