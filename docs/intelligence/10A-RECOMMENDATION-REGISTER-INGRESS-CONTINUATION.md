# KeyFlowOS Recommendation Register — External Ingress Continuation

Status: CANONICAL CONTINUATION OF `10-RECOMMENDATION-REGISTER.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical recommendation sequence continues after KF-REC-034.

---

## KF-REC-035 — Durable IngressOccurrence with resumable processing ownership

**Status:** PROVISIONAL / STRONGLY SUPPORTED TARGET

**Primary kernels:** K7 Temporal/Event/Workflow, K9 Integration/External Reality, K11 Recovery/Reliability

Introduce/evolve a narrow external-ingress lifecycle contract that sits after provider-specific authentication/tenant binding and before material domain consequences.

Target shape:

```text
Provider Adapter
→ authenticated + tenant-bound provider occurrence
→ IngressOccurrence
    identity
    provider/source
    tenant/account binding evidence
    event type/schema version
    raw-payload reference/provenance
    state
    attempts
    processing owner/lease
    last error
→ Domain Applicator
→ canonical StateTransition / EventOccurrence
→ consequence graph
```

Candidate lifecycle:

```text
RECEIVED
→ AUTHENTICATED
→ TENANT_BOUND
→ OCCURRENCE_IDENTIFIED
→ CLAIMED
→ PROCESSING
    ├─ APPLIED
    ├─ IGNORED
    ├─ RETRYABLE_FAILED
    └─ DEAD_LETTER
```

### Required distinctions

```text
ProviderDeliveryId
!= ProviderOccurrenceId
!= EventOccurrenceId
!= ConsumptionId
!= ConsequenceId
!= EffectAttemptId
!= ProviderEffectId
```

And:

```text
occurrence uniqueness
!= processing ownership
!= consequence uniqueness
!= effect idempotency/reconciliation
```

### Existing seams to strengthen

Do not build a parallel “WebhookEngine2”. Reuse/evolve:

- payment `WebhookEvent` provider-event uniqueness;
- provider-native verifier code/SDKs;
- KeyInbox/MessageIntake external-message identities;
- connector account/destination mappings;
- domain transition owners such as `InvoiceWorkflowService`;
- K11 ExecutionClaim concepts where execution ownership semantics overlap.

### Non-goals

IngressOccurrence is **not**:

- a replacement for domain event payloads;
- a universal event-sourcing database;
- a replacement for FlowRunner/Temporal workflows;
- an authorization token;
- proof that a provider-reported business outcome is true merely because the request authenticated;
- a reason to force all pull-based connectors into push/webhook architecture.

### Minimum production properties

1. fail-closed provider authentication;
2. independent tenant/account binding;
3. stable provider occurrence identity where available;
4. atomic processing claim/lease;
5. resumable retryable failure;
6. terminal APPLIED/IGNORED distinction;
7. dead-letter/operator visibility;
8. durable acceptance before successful asynchronous HTTP acknowledgement;
9. causal identity propagation into material consequences;
10. provider/domain reconciliation for out-of-order or later corrections.

### Standards / working-model evidence

Properties are supported by current primary-source behavior/specifications from:

- CloudEvents stable `source + id` occurrence identity;
- Stripe webhook duplicate/retry/out-of-order semantics;
- Twilio signed-request verification semantics;
- WiPay lifecycle webhook stable ID/signature/retry semantics.

These are comparative evidence sources, not mandated technologies.

### Proof ratchets

Before execution-ready:

- concurrent same-occurrence delivery yields one processing owner;
- crash after claim but before apply resumes;
- crash after apply but before terminal evidence does not duplicate material effect;
- authenticated occurrence cannot be rebound to another tenant;
- APPLIED replay is no-op for one-time consequence;
- RETRYABLE_FAILED replay resumes;
- poison occurrence becomes visible dead-letter;
- out-of-order provider events converge to domain/provider truth.

Affected journeys: J5, J7, J9, J13, J14, J18, J23 and other provider-event consumers.

---

## KF-REC-036 — Compatibility ingress URLs must delegate to one canonical processor

**Status:** PROVISIONAL / HIGH-CONFIDENCE TARGET

**Primary kernels:** K9 Integration/External Reality, K10 Financial Truth, K11 Recovery/Reliability

When a provider endpoint URL must remain for backward compatibility, retain transport compatibility without retaining parallel business semantics.

Target:

```text
legacy provider URL
→ compatibility adapter
→ canonical verifier / tenant binder / occurrence processor
→ same domain applicator
→ same evidence + reconciliation
```

Do not permit:

```text
legacy URL
→ legacy business mutation

primary URL
→ new business mutation
```

Current motivating evidence: mounted `/webhooks/stripe` and `/payments/stripe/webhook` routes have divergent processing/evidence semantics despite the legacy route comment describing consolidation.

Migration should include provider-dashboard endpoint inventory, dual-route characterization, event/evidence parity proof, observability and a retirement window rather than simply deleting a URL.

Affected journeys: J7, J13, J14, J18.

---

## KF-REC-037 — Treat provider lifecycle reconciliation as a first-class external-truth loop

**Status:** PROVISIONAL / STRONGLY SUPPORTED

**Primary kernels:** K8 Evidence/Outcome, K9 Integration/External Reality, K10 Financial Truth, K11 Recovery/Reliability

Immediate callbacks, browser redirects and provider acknowledgements must not be promoted directly into long-lived business truth when the provider exposes later correction events or authoritative status APIs.

Target loop:

```text
provider occurrence
→ local application
→ provisional/current domain truth
→ later provider lifecycle event / reconciliation
→ supersede or confirm
→ durable OutcomeEvidence
```

Examples include payment refund/reversal/chargeback/fraud lifecycle, message delivery/bounce, and comparable external corrections.

The implementation should remain provider-specific at the adapter/reconciliation layer while producing normalized evidence semantics to K8/K10.

Affected journeys: J5, J7, J13, J14, J18.

---

# Promotion rule

These recommendations are architecture targets, not production authorization. Promotion to `KF-EXEC-*` requires current-baseline revalidation, migration inventory, provider-version verification, exact data-model impact, characterization tests, adversarial concurrency/replay proof, rollback and observability.
