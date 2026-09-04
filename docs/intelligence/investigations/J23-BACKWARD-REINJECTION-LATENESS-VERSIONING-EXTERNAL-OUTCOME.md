# J23 Backward Reinjection — Lateness / Versioning / External Outcome

Status: RECURSIVE BACKWARD RE-AUDIT / NO PRODUCTION IMPLEMENTATION
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

This extends the earlier cancellation reinjection with J23 findings F145–F149 and contradictions C096–C099. It avoids duplicate root findings.

---

## 1. New cross-system laws

```text
SCHEDULED TIME
!= PERPETUAL RELEVANCE

DEFINITION ID
!= IMMUTABLE ACTION SEMANTICS

LOCAL FAILURE
!= PROOF EXTERNAL EFFECT DID NOT OCCUR
```

Together:

> Long-lived work must remain temporally relevant, definition-bound, governable and externally reconcilable until terminal OutcomeEvidence exists.

---

## 2. J15 — control evidence needs time + version semantics

J15 already requires exact-action fingerprinting, freshness and invalidation.

J23 strengthens this in two ways.

### Lateness

A clearance may be fresh enough at T0 but become semantically inappropriate after significant delay even without an explicit authority-revocation event.

Examples:

```text
approval to send time-sensitive campaign
approval to make booking-related change
approval to contact customer about an overdue state
```

Target:

```text
ControlEvidence / Clearance
+ ActionFingerprint
+ validity window / policy version where required
+ current source-state eligibility
→ still executable or requires re-control
```

Do not make every clearance short-lived by default; capability/impact semantics determine relevant freshness.

### Definition/action mutation

If a waiting occurrence changes from definition/action V1 to V2 and the material ActionFingerprint changes:

```text
old Clearance
→ cannot silently authorize V2
→ invalidate/re-evaluate
→ new ControlEvidence only if required
```

This strengthens KF-REC-023 and KF-REC-026; no new approval primitive is required.

---

## 3. J6 — proactive schedules require misfire and version policy

Proactive recurring work cannot safely mean:

```text
missed while offline
→ execute every historical occurrence when service returns
```

Each DelegationLoop/proactive work family needs explicit recurrence/misfire semantics, for example:

```text
payment recovery
  bounded catch-up / coalesce by current invoice state

lead reactivation
  likely latest/current-state driven rather than replay every missed scan

owner digest
  latest-wins/coalesce

booking preparation
  expire after booking relevance window
```

Likewise changing a standing delegation or autonomy configuration must have an explicit policy for already-created waiting occurrences.

J6 stop semantics therefore become:

```text
STOP/PAUSE/KILL
+
recurrence misfire policy
+
definition/policy version
+
current eligibility
→ whether any historical/current proactive work may resume
```

No new root finding is created; this strengthens J6 stop/standing-authority findings and KF-REC-042/043/045/046.

---

## 4. J14 — provider corrections are temporal wake-up/invalidation events

J14 already requires durable provider occurrence identity and reconciliation.

J23 adds that later provider lifecycle events can act as temporal transitions over existing work:

```text
provider accepted
→ local work AWAITING_EXTERNAL
→ later provider delivered / failed / reversed / corrected
→ same causal occurrence advances or invalidates dependent work
```

Provider lifecycle ingestion is therefore not merely another webhook feature. It can be the wake-up/reconciliation mechanism for J23 work suspended in `AWAITING_EXTERNAL` or `OUTCOME_UNKNOWN`.

Causal identity must flow both directions:

```text
outbound ExecutionClaim/providerOperationId
↔ provider lifecycle occurrence
↔ local WorkOccurrence / OutcomeEvidence
```

This further strengthens KF-REC-035 and KF-REC-037.

---

## 5. J18 — failure/recovery is reopened materially

J23 now gives J18 a sharper recovery taxonomy.

Current systems often overuse one `FAILED` concept. Target recovery must distinguish:

```text
ATTEMPT_FAILED_RETRYABLE
  logical work remains alive; retry same occurrence/effect identity

FAILED_FINAL_CONFIRMED
  retry exhausted or failure definitively non-retryable

OUTCOME_UNKNOWN
  external effect may exist; reconcile before retry

EXPIRED
  work missed its business-validity window; do not retry

CANCELLED / SUPERSEDED
  execution right removed; do not recover into execution

AWAITING_EXTERNAL
  provider accepted/requested; waiting for authoritative lifecycle evidence
```

### Recovery decision tree

```text
worker/process failure
→ did effect claim exist?
  no  → resume/claim safely if occurrence still eligible
  yes → did provider/domain give confirmed outcome?
        yes success → record OutcomeEvidence
        yes failure → retry only under same effect/retry policy
        no → OUTCOME_UNKNOWN → reconcile first

before any retry:
→ re-check cancellation/supersession
→ re-check lateness/expiry
→ re-check definition/action version
→ re-check current authority/policy/source state
```

This means J18 is not merely "retry failed jobs". It is **restore truthful state and only then decide whether execution remains valid**.

J18 should be admitted for a dedicated microscopic dossier after J23 target convergence, because it now has enough cross-kernel evidence to avoid a shallow generic reliability audit.

---

## 6. K7 — temporal truth expanded

K7 owns the logical lifecycle and now must include:

```text
original scheduled time
lateness/misfire policy
definition/version binding
cancellation/supersession/expiry
wait reason
external-wait state
terminal reason
```

K7 must not decide provider truth itself; it consumes K9/K8 evidence to move a logical occurrence out of `AWAITING_EXTERNAL` / `OUTCOME_UNKNOWN`.

---

## 7. K8 — evidence strength / provenance

K8 must explicitly distinguish evidence strength:

```text
request-attempt evidence
provider-acceptance evidence
provider-sent/published evidence
provider-delivery/settlement evidence
recipient-read/ack evidence
reversal/compensation evidence
business-outcome evidence
```

A stronger label must never be inferred from weaker evidence merely for UI convenience.

Likewise:

```text
EXPIRED evidence
!= FAILED evidence
CANCELLED evidence
!= provider reversal evidence
SUPERSEDED evidence
!= failed execution evidence
```

---

## 8. K9 — external reality becomes a first-class temporal dependency

The accumulated J14/J23 evidence is now sufficient to justify full K9 dossier instantiation soon.

K9 needs to own provider-specific semantics such as:

```text
operation identity
request acceptance
status/lifecycle lookup
callback identity
point of no return
reversal/compensation capability
outcome uncertainty
reconciliation owner
```

It should normalize evidence for K8/J23 without pretending all providers share one lifecycle vocabulary.

---

## 9. K11 — recovery gate before retry

K11 retry algorithm now requires a pre-retry gate:

```text
attempt failed
→ classify failure as definitive vs ambiguous
→ verify occurrence still live
→ verify lateness/misfire policy
→ verify cancellation/supersession
→ verify definition/action version
→ verify current governance/source state
→ if ambiguous external effect: reconcile, do not retry yet
→ otherwise retry using same logical/effect identity
```

This prevents reliability mechanics from manufacturing stale or duplicate business effects.

---

## 10. Constellation reinjection

J23 now links four constellation dynamics:

```text
A Authority/Governance/Action
  clearance validity across time/version

D Commitment/Delivery
  obligations and due work can expire/supersede/change

E External Reality
  provider lifecycle resolves AWAITING_EXTERNAL / OUTCOME_UNKNOWN

F Platform Survival
  recovery must preserve business validity, not merely process completion
```

Machine-readable graph edge classes should include:

```text
CREATED_FROM_VERSION
MIGRATES_TO
EXPIRES_AT
MISFIRE_POLICY
INVALIDATES
SUPERSEDES
AWAITS_EXTERNAL
RESOLVED_BY
RECONCILES
```

alongside earlier `CAUSES / WAITS_ON / CLAIMS / HANDS_OFF_TO / COMPENSATES`.

---

## 11. Backward re-audit verdict

```yaml
j15:
  reopened: true
  effect:
    - clearance_validity_may_be_time_sensitive_by_capability
    - material_definition_mutation_invalidates_exact_action_clearance
  new_root_finding: false
j6:
  reopened: true
  effect:
    - proactive_recurrence_requires_misfire_policy
    - standing_definition_changes_need_pending_occurrence_policy
  new_root_finding: false
j14:
  reopened: true
  effect:
    - provider_lifecycle_event_can_resume_or_reconcile_waiting_external_work
  new_root_finding: false
j18:
  reopened: true
  effect:
    - recovery_taxonomy_now_distinguishes_retryable_final_unknown_expired_cancelled_superseded
  dedicated_dossier_recommended: true
k7:
  effect: add_lateness_version_external_wait_semantics
k8:
  effect: evidence_strength_must_match_provider_business_truth
k9:
  effect: enough_shared_evidence_to_instantiate_full_dossier
k11:
  effect: pre_retry_validity_and_reconciliation_gate
recommendations_reused:
  - KF-REC-023
  - KF-REC-026
  - KF-REC-035
  - KF-REC-037
  - KF-REC-038
  - KF-REC-040
  - KF-REC-042
  - KF-REC-043
  - KF-REC-044
  - KF-REC-045
  - KF-REC-046
  - KF-REC-047
```

No tests were executed and no production implementation is authorized.
