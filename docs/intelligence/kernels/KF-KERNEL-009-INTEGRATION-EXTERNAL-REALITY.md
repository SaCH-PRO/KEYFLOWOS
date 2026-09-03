# KF-KERNEL-009 — Integration & External Reality

Status: ACTIVE / INITIAL CONVERGENCE / NOT FROZEN

Implementation evidence baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Production implementation remains unauthorized.

## A. Definition / Scope

K9 owns the semantic boundary between KEYFLOWOS internal state and **external systems / external reality**.

It covers:

- inbound provider/webhook event identity and authenticity;
- outbound webhook/event delivery;
- external API/provider effects;
- connector credentials/connectivity state as it affects actionability;
- provider request/response identity;
- retry semantics;
- idempotency keys and provider replay handling;
- `OUTCOME_UNKNOWN` and reconciliation;
- schema/version contracts at integration boundaries;
- external delivery/receipt evidence;
- normalization from provider-specific reality into canonical business evidence;
- external event subscriptions and delivery logs.

K9 does not own domain truth itself. K6 decides valid business-state transitions; K10 owns financial truth; K8 owns normalized evidence/outcome. K9 proves what the external world said/did strongly enough for those kernels to update internal truth safely.

---

## B. Product Intent

KEYFLOWOS should be able to answer:

```text
what did we ask the outside system to do?
which exact provider/account/connector?
what request identity?
did the provider accept it?
did the real-world outcome actually occur?
was this a retry or a distinct operation?
what happens if the provider timed out after possibly acting?
how do we reconcile later?
what external event caused this internal state change?
can the receiver distinguish a replay from a new outbound event?
```

External integrations should feel seamless to the operator while remaining explicit and recoverable internally.

---

## C. Truth Ownership

Core distinctions:

```text
INTERNAL INTENT
!=
PROVIDER REQUEST
!=
PROVIDER ACCEPTANCE
!=
DELIVERY / SETTLEMENT / REAL-WORLD OUTCOME
```

```text
SIGNATURE / AUTHENTICITY
!=
EVENT IDENTITY
!=
DELIVERY IDENTITY
!=
CONSUMPTION IDENTITY
```

```text
TIMEOUT
!=
FAILURE
```

A timeout after an external call may mean `OUTCOME_UNKNOWN`.

Candidate canonical integration objects/projections:

- ConnectorIdentity / ProviderAccount;
- ExternalEventEnvelope;
- ProviderOperation / ExternalEffectAttempt;
- DeliveryIdentity;
- ReconciliationRecord;
- ExternalEvidence;
- ConnectorHealth / freshness;
- schema/provider version.

These are semantic contracts and need not immediately become one table each.

---

## D. Current Implementation Sources

Initial evidence includes:

- `apps/server/src/modules/notifications/transactional-email.service.ts`;
- `apps/server/src/modules/commerce/gmail.service.ts`;
- `apps/server/src/modules/webhooks/webhook-dispatcher.service.ts`;
- `apps/server/src/modules/commerce/invoice-workflow.service.ts` provider-event dedupe;
- WhatsApp/Twilio/Meta inbound verification paths from J15;
- generic inbound SMS HMAC path from J15;
- `apps/server/src/modules/key-cortex/key-cortex-event-bus.service.ts`;
- `apps/server/src/modules/flow/automation-executor.service.ts` outbound channel queueing;
- connector lifecycle/provider services to be fully mapped under J13/J14;
- payment provider reconciliation paths to be fully mapped with K10/J7.

Current integration patterns include:

- synchronous provider calls with inline retry;
- local notification queues;
- provider webhook event uniqueness in some payment paths;
- outbound delivery records for channel adapters;
- in-memory outbound webhook delivery logs;
- signed webhooks;
- provider-specific message/event identifiers;
- optional application-level dedupe keys.

---

## E. Inputs

- exact ActionEnvelope / effect intent;
- businessId / connector/provider account;
- provider credentials/token version;
- effect identity / idempotency key;
- external event ID / provider event type;
- signature/authentication evidence;
- request payload + schema/version;
- retry/attempt number;
- correlation/causation identity;
- expected provider outcome class;
- reconciliation strategy.

---

## F. Outputs / Consumers

- verified ExternalEventEnvelope;
- provider request/attempt record;
- provider acceptance ID;
- delivery/settlement status;
- `FAILED` or `OUTCOME_UNKNOWN` evidence;
- reconciliation result;
- canonical domain-event candidate;
- K8 OutcomeEvidence;
- connector health/staleness signal;
- K10 financial reconciliation evidence;
- receiver-visible outbound event/delivery ID.

---

## G. State / Transition Semantics

### External effect

Candidate lifecycle:

```text
INTENT
→ CLAIMED
→ REQUESTING
→ PROVIDER_ACCEPTED
   | FAILED_BEFORE_ACCEPTANCE
   | OUTCOME_UNKNOWN
→ DELIVERED / SETTLED / COMPLETED
   | PROVIDER_FAILED
   | EXPIRED
→ RECONCILED
```

Not every integration exposes every state. K9 must record the strongest evidence actually available rather than fabricate certainty.

### Inbound external event

```text
RECEIVED
→ AUTHENTICATED
→ IDENTIFIED
→ DEDUPED / FIRST_SEEN
→ NORMALIZED
→ CONSUMED
→ CANONICAL DOMAIN CONSEQUENCE
```

### Outbound webhook

```text
EventOccurrence
→ WebhookDelivery(subscription,event)
→ attempt 1..n
→ success | retryable failure | final failure | unknown
```

Event identity and delivery identity remain distinct.

---

## H. Journey Impact Matrix

Strongly active:

- J5 Conversation → Business Action;
- J6 Proactive KEY;
- J7 Financial Truth;
- J13 Connector Lifecycle;
- J14 Webhook / External Event Ingress;
- J18 Failure → Recovery;
- J23 Long-Running Workflow.

Materially affects:

- J3 Lead → Customer → Cash;
- J4 Booking → Service → Payment;
- J9 Marketing;
- J10 Commerce/Fulfilment;
- J12 Document/Evidence;
- J15 Governance;
- J19 Privacy/Deletion;
- J20 Subscription/AI Cost;
- J21 Public Customer Experience;
- J22 KEY Voice.

---

## I. Canonical Vocabulary / Contracts

Working vocabulary:

- ExternalEventId
- EventOccurrenceId
- DeliveryId
- ProviderOperationId
- EffectId
- AttemptId
- ConnectorId / ProviderAccountId
- IdempotencyKey
- AuthenticityEvidence
- ProviderAcceptance
- DeliveryReceipt
- Settlement
- OutcomeUnknown
- Reconciliation
- Replay
- Retry
- SchemaVersion
- CorrelationId
- CausationId

Avoid `sent`, `success`, `failed`, or `processed` without stating which layer they refer to.

---

## J. Authority / Governance

A valid provider connection does not itself grant authority to use it.

```text
connector available
!=
principal / KEY authorized to invoke capability
```

K3 decides whether the exact external effect is authorized. K9 receives an already governed ActionEnvelope/ExecutionClaim and ensures the external operation preserves that identity.

Inbound external events likewise do not automatically authorize arbitrary business action; they provide evidence/trigger input to K6/K3/K7.

---

## K. Transactions / Concurrency / Idempotency

K9 law:

> External-effect idempotency must be defined at the business-effect identity, not only request/retry loop identity.

Need distinguish:

```text
same logical effect, retry attempt
vs
new logical effect with similar parameters
```

Where provider supports idempotency, stable KeyFlow EffectId should map to provider key.

Where provider does not, KeyFlow must claim locally before sending and reconcile ambiguity rather than blind-retry after uncertain outcome.

Outbound event delivery identity:

```text
EventOccurrenceId + SubscriptionId
→ DeliveryId
→ AttemptId(s)
```

---

## L. Failure / Recovery

Must define:

- network timeout before/after provider acceptance;
- provider 5xx / 429;
- token expiry/refresh failure;
- duplicate provider webhook;
- webhook received twice concurrently;
- successful external side effect but local persistence failure;
- local success claim but provider call never happened;
- queue drainer crash/restart;
- connector temporarily disconnected;
- schema version drift;
- partial batch success;
- outbound webhook recipient timeout after receiving request;
- reconciliation reveals local state wrong;
- provider event arrives out of order.

The core recovery state is often:

```text
OUTCOME_UNKNOWN
→ reconcile before retrying irreversible effect
```

---

## M. Security / Privacy

- verify inbound authenticity before side effects;
- tenant-bind provider identities and callback resolution;
- do not log/expose secrets/tokens in event payloads;
- rotate credentials with version/freshness semantics;
- enforce do-not-contact/consent where relevant at material effect boundary;
- HMAC/sign outbound webhooks;
- replay protection is additional to signature verification;
- minimize external payload to needed business data;
- privacy/deletion must propagate through connector/export boundaries where applicable.

---

## N. Evidence / Observability

Every material provider action should answer:

```text
which KeyFlow action caused this?
which connector/provider account?
which EffectId?
which provider request/response ID?
how many attempts?
what was the strongest proven outcome?
when did we last reconcile it?
```

Every external event should answer:

```text
provider/source event ID
signature/auth proof
first-seen time
replay/duplicate status
normalization result
which internal consequences consumed it
```

---

## O. Reachability / Consumers

Current active evidence demonstrates:

- TransactionalEmailService/Gmail external email;
- Flow Automation channel queueing;
- outbound business webhooks;
- inbound WhatsApp/SMS control channels;
- payment provider webhook dedupe/reconciliation pieces;
- provider-facing operations from domain modules;
- Cortex event bus and external/internal normalization bridges.

A full connector matrix remains for J13/J14.

---

## P. Duplication / Legacy / Compatibility

Current external-effect paths include multiple email/message/provider routes and multiple event buses.

Do not create `IntegrationFabric2` merely to normalize them.

Migration strategy should find existing strong seams by effect class:

- TransactionalEmailService / communication delivery records;
- ActionDispatcher for governed action execution;
- InvoiceWorkflow/payment reconciliation for financial providers;
- KeyCortexEventBus as a useful normalized perception envelope;
- existing provider event tables where uniqueness already exists.

Then introduce shared identity/evidence contracts around them.

---

## Q. Invariants

1. Connector availability never substitutes for action authority.
2. Every material external effect has stable internal EffectId before provider call.
3. Retries of one effect preserve the same effect identity.
4. Provider acceptance is not automatically real-world completion/delivery.
5. Timeout after possible provider action becomes OUTCOME_UNKNOWN unless provider semantics prove otherwise.
6. Unknown external outcome is reconciled before unsafe repeat execution.
7. Inbound authenticity is checked before authority-sensitive side effects.
8. Authentic inbound delivery can still be a replay; event identity/consumption dedupe is separate.
9. Canonical external event schemas are versioned contracts.
10. Outbound webhook consumers receive stable event/delivery identity sufficient for dedupe.
11. External delivery/retry evidence is durable when it governs business truth/recovery.
12. Provider-specific data normalizes into K8 evidence before changing canonical business belief.
13. Partial external success is represented explicitly.
14. Cross-tenant provider identity resolution fails closed.
15. Local logs may not claim an external effect that was never attempted/proven.

---

## R. Findings

Primary current findings:

- F067 quick-confirm server binding weakness;
- F080 staff reply event processed before dedupe;
- F090 fake sent/executed evidence in AutopilotService;
- F099 TransactionalEmail read-before-send dedupe;
- F100 queue draining lacks claim/preserved identity;
- F101 payment recovery collapses send statuses;
- F102 canonical event payload mismatch from DelegationLoop;
- F107 AgentTrigger lacks source-event consumption identity;
- F111 event contract drift;
- F116 canonical event occurrence identity not propagated;
- F117 FlowRunner event-idempotency seam defeated by upstream Date.now key;
- F119 outbound webhook lacks durable event/delivery identity/evidence;
- F120 multiple consequence owners around one business occurrence.

---

## S. Contradictions

Primary active contradictions:

- C043 authenticated event vs replay-safe authorization;
- C053 dedupe key vs atomic effect claim;
- C054 execution status vs provider evidence;
- C056 event name vs incompatible schema;
- C064 canonical event contract vs consumer assumptions;
- C068 one event vs multiple proactive plans;
- additional invoice-consequence contradictions to be pooled after F116-F120.

---

## T. Open Questions

1. What canonical EventEnvelope should bridge domain events, Cortex perception and external webhooks?
2. Which provider integrations support native idempotency keys?
3. Which provider calls can return ambiguous outcomes requiring reconciliation?
4. Which existing tables can hold durable Effect/Delivery identity without parallel truth?
5. What outbound webhook retry schedule and retention contract is appropriate?
6. Which connector health/freshness values should gate KEY readiness?
7. How are OAuth/token rotations/version changes represented in unconsumed work?
8. Which inbound event classes require strict ordering?
9. How should privacy deletion propagate to connector caches and external stores?
10. Where should customer-contact cadence/consent policy sit relative to communication adapters?

---

## U. Target-State Candidate

```text
Canonical ActionEnvelope / EventOccurrence
        ↓
EffectIntent / DeliveryIntent
        ↓
K11 atomic claim
        ↓
K9 ProviderOperation
        ↓
request attempt(s)
        ↓
PROVIDER_ACCEPTED
 | FAILED
 | OUTCOME_UNKNOWN
        ↓
receipt / webhook / polling / reconciliation
        ↓
K8 ExternalOutcomeEvidence
        ↓
K6/K10 canonical business truth transition
```

For outbound webhooks:

```text
Canonical EventOccurrence
→ subscription match
→ DeliveryId
→ attempt(s)
→ durable delivery evidence
```

---

## V. Migration / Compatibility

1. inventory external effect/provider paths;
2. establish EffectId/EventOccurrenceId/DeliveryId vocabulary;
3. characterize provider retry/idempotency capabilities;
4. add identity/evidence to high-risk/external-visible paths first;
5. replace read-before-send dedupe with claims where required;
6. normalize OUTCOME_UNKNOWN + reconciliation;
7. add durable outbound webhook delivery evidence/receiver-visible ID;
8. unify event contract normalization progressively;
9. retire duplicate provider side-effect ownership only after proof.

---

## W. Proof / Test Ratchets

Future proof should include:

- same provider webhook twice concurrently → one authoritative consumption;
- same outbound effect retried after timeout → no duplicate irreversible effect when provider may have accepted;
- Gmail/send provider failure/queueing does not produce false delivered evidence;
- two queue drain workers claim one delivery;
- outbound webhook retry preserves DeliveryId;
- repeated internal event preserves EventOccurrenceId;
- receiver can dedupe KeyFlow webhook replay;
- local persistence failure after provider acceptance becomes reconcilable unknown state;
- connector token expiry during delayed action causes safe revalidation;
- provider payload/schema version drift fails safely;
- cross-tenant provider event cannot mutate another business.

No tests have been executed as part of this dossier creation.

---

## X. Layered Improvement

L0 — distinguish intent/request/acceptance/delivery/reconciliation.

L1 — stable event/effect/delivery identity, replay safety, durable integration evidence.

L2 — unified integration contracts over existing communication/payment/connector seams.

L3 — externally reconciled Business Graph with explicit uncertainty.

L4 — operator/KEY can explain provider state, retries, unknown outcomes and recovery.

L5 — adaptive integration reliability: provider health/freshness feeds readiness and routing without weakening correctness or authority.

---

## Y. Machine-readable Record

```yaml
id: KF-KERNEL-009
name: Integration & External Reality
status: active-initial-convergence
implementation_baseline: d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
active_journeys:
  - KF-JOURNEY-005
  - KF-JOURNEY-006
  - KF-JOURNEY-007
  - KF-JOURNEY-013
  - KF-JOURNEY-014
  - KF-JOURNEY-018
  - KF-JOURNEY-023
adjacent_kernels:
  - KF-KERNEL-003
  - KF-KERNEL-005
  - KF-KERNEL-006
  - KF-KERNEL-007
  - KF-KERNEL-008
  - KF-KERNEL-010
  - KF-KERNEL-011
core_invariants:
  - stable_effect_identity
  - event_identity_separate_from_authenticity
  - timeout_may_be_outcome_unknown
  - reconcile_before_unsafe_retry
  - durable_delivery_evidence
  - provider_truth_normalizes_before_domain_truth
implementation_authorized: false
```
