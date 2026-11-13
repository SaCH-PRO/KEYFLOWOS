# KF-JOURNEY-014 — Webhook / External Event Ingress

Status: ACTIVE FORENSICS / CROSS-KERNEL TARGET REFINEMENT
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Last evidence pass: 2026-09-03
Primary kernels: K7 Temporal/Event/Workflow, K9 Integration/External Reality, K11 Recovery/Reliability
Secondary kernels: K1 Tenant/Identity, K6 State Transition, K8 Evidence/Outcome, K10 Financial Truth
Primary adjacent journeys: J13 Connector Lifecycle, J18 Failure/Recovery, J23 Temporal Flow, J7 Financial Truth, J5 Conversation/Business Action

> This dossier distinguishes CURRENT REALITY from TARGET KEYFLOWOS. No production implementation is authorized by this document.

---

## A. Definition

J14 is the lifecycle by which an occurrence outside KeyFlowOS becomes authenticated, tenant-bound, replay-safe, normalized, durably processed and translated into canonical internal state/events/consequences.

It covers provider webhooks, callbacks, signed security events, messaging ingress, form submissions and comparable external push channels.

It does **not** mean every connector is push-driven. Example: current Shopify integration is pull/manual-sync only and is not currently a J14 ingress producer.

---

## B. Product Intent

External reality must enter KeyFlowOS once, into the correct business, with sufficient provenance to explain:

- who/provider sent it;
- which external occurrence it represents;
- which KeyFlow business/account it belongs to;
- whether it is a retry/replay;
- what schema/version was interpreted;
- whether processing finished, failed or remains uncertain;
- which internal consequences were produced;
- how later provider corrections reconcile prior truth.

The user-facing goal is simple: **KeyFlow should not duplicate, lose, mis-route or falsely finalize real-world events.**

---

## C. Actors

- external provider / event source;
- provider account / destination / endpoint configuration;
- public ingress controller;
- authenticator/verifier;
- tenant/account binder;
- occurrence normalizer;
- durable ingress occurrence store/claim owner (target primitive; fragmented today);
- domain applicator;
- event consumers / consequence owners;
- provider reconciliation process;
- operator / recovery tooling;
- KEY where external events become observation or agency inputs.

---

## D. Entry Surfaces — Current Reality

Representative live surfaces inspected:

- `/payments/stripe/webhook`;
- `/payments/paypal/webhook`;
- `/payments/wipay/callback`;
- legacy `/webhooks/stripe`;
- shared Meta WhatsApp webhook and legacy scoped WhatsApp webhook;
- shared Meta social webhook and legacy scoped social webhook;
- generic `/communications/inbound/email` and `/communications/inbound/sms`;
- Google RISC `/webhooks/risc`;
- `/webhooks/forms/:businessId/:type`;
- LiveKit `/livekit/webhook`;
- Chatwoot `/chatwoot/webhook/:secret`;
- Twilio phone-voice inbound webhook.

Current Shopify module exposes authenticated pull/sync routes; no Shopify push webhook route was found in this pass.

---

## E. State Machine

### Current reality

There is no one cross-provider ingress state machine. Representative patterns diverge:

```text
PAYMENTS
verify
→ insert WebhookEvent(first-seen)
→ provider-specific processing

RISC
verify
→ check jti absence
→ perform security action
→ persist riscEvent

CHATWOOT
verify path secret
→ return 202
→ fire-and-forget AI/reply processing

WHATSAPP
verify
→ staff/entity/event consequences
→ later KeyInbox/MessageIntake dedupe
```

### Target KeyFlowOS

```text
EXTERNAL DELIVERY
    ↓
RECEIVED
    ↓
AUTHENTICATED
    ↓
TENANT_BOUND
    ↓
OCCURRENCE_IDENTIFIED
    ↓
CLAIMED
    ↓
PROCESSING
    ├─→ IGNORED                 (supported terminal no-op)
    ├─→ RETRYABLE_FAILED        (reclaim/resume)
    ├─→ DEAD_LETTER             (non-retryable/operator action)
    └─→ APPLIED
          ↓
      CONSEQUENCES / RECONCILIATION
```

`RECEIVED`, `CLAIMED` and `APPLIED` are different facts.

A provider retry of an occurrence in `RETRYABLE_FAILED` or expired `PROCESSING` state must be able to resume safely. A retry of `APPLIED` should acknowledge without reapplying one-time consequences.

---

## F. Frontend Path

Most ingress has no direct frontend path. User-facing surfaces consume its effects: payments, inbox, automations, security, connector health, voice sessions, webhook delivery history and recovery UI.

Target product requirement: operational surfaces should distinguish at minimum:

- provider event received;
- authenticated/rejected;
- processing / retrying;
- applied;
- ignored;
- failed/dead-letter;
- outcome/reconciliation pending.

Do not show `received` as equivalent to `business state updated`.

---

## G. API Path

Provider-specific API protocols remain provider-specific. The target normalization boundary is after provider verification and tenant binding, not a forced universal public webhook payload.

Provider adapters should yield one internal envelope before material domain consequences:

```yaml
provider: stripe|paypal|wipay|meta|twilio|livekit|google-risc|chatwoot|...
provider_account_id: ...
delivery_id: ...                 # if provider exposes transport delivery identity
provider_occurrence_id: ...      # logical provider event identity
business_id: ...
event_type: ...
schema_version: ...
occurred_at: ...
received_at: ...
subject:
  type: ...
  external_id: ...
authentication:
  method: hmac|jwt|provider-api|bearer-secret|...
  verified: true
  key_or_endpoint_version: ...
routing_evidence:
  destination_id: ...
  account_id: ...
  tenant_claim: ...
correlation:
  provider_object_id: ...
  prior_occurrence_id: ...
raw_payload_ref: ...
normalized_payload: ...
```

Not every provider supplies every field; absence must be explicit rather than synthesized as proof.

---

## H. Backend Chain

Target causal chain:

```text
provider
→ protocol adapter / authenticator
→ tenant-account binder
→ occurrence normalizer
→ durable IngressOccurrence claim
→ processor ownership/lease
→ domain applicator
→ canonical StateTransition/EventOccurrence
→ consequence graph
→ per-consumer ConsumptionClaim / ExecutionClaim
→ external/internal effect
→ OutcomeEvidence
→ reconciliation
```

Existing seams worth strengthening:

- `WebhookEvent` unique provider-event identity;
- `KeyInboxMessage @@unique([businessId, channel, externalMessageId])` plus conflict recovery;
- MessageIntake external ID uniqueness;
- provider SDK verifiers (Stripe/LiveKit/Twilio where applicable);
- `InvoiceWorkflowService` canonical invoice transition semantics;
- Payment.providerPaymentId uniqueness;
- ActionDispatcher / K11 execution ownership direction;
- connector destination/account mapping.

The target should evolve these seams rather than create parallel `*2` ingress systems.

---

## I. Data Mutation Ledger

Representative current mutations include:

- `WebhookEvent` first-seen provider events;
- Payment / revenue posting / invoice reconciliation;
- RiscEvent and user/session security state;
- KeyInboxMessage;
- MessageIntake and KeyActionProposal;
- Contact/entity resolution and CRM events;
- LeadFormSubmission;
- VoiceSession;
- outbound provider replies/messages;
- external webhook delivery attempts.

Target adds an explicit durable occurrence-processing lifecycle rather than inferring processing completion from domain rows or a boolean seen table.

---

## J. Tenant / Identity

### Critical distinction

```text
AUTHENTICATION
proves who/provider sent the envelope

TENANT BINDING
proves which KeyFlow business/account owns the occurrence
```

Both are required when the event can mutate tenant state.

Provider-neutral law:

> A tenant claim must be cryptographically bound to the authenticated request or independently derived/validated from provider-owned routing/account evidence.

Examples:

- Twilio validation covers the full URL including query parameters, so a signed `businessId` in the configured URL is materially different from an unsigned path label.
- Meta body signatures authenticate the body, not a separately supplied `:businessId` URL path. Scoped legacy Meta routes therefore require destination/page ownership validation or retirement in favor of provider-routed shared endpoints.
- generic inbound email/SMS should cross-check any declared business with the destination/account mapping when both are present.

---

## K. Events / Coordination

### Identity taxonomy

Do not collapse these identities:

```text
ProviderDeliveryId
  = one transport delivery/attempt identity

ProviderOccurrenceId
  = one logical external event identity

EventOccurrenceId
  = KeyFlow's canonical stable representation of that occurrence

ConsumptionId
  = consumer C processing occurrence O

ConsequenceId
  = semantic business effect derived from O

EffectAttemptId
  = one execution attempt

ProviderEffectId
  = external provider result/message/payment/etc identity
```

CloudEvents' `source + id` uniqueness is a useful reference property, not a mandate to adopt CloudEvents as the storage model.

---

## L. KEY / AI

External messages/events may become KEY observations, plans or direct responses. Therefore ingress replay ownership must dominate AI-triggering branches.

Current WhatsApp staff routing can reach KEY before downstream KeyInbox replay uniqueness. Current Chatwoot can invoke KEY fire-and-forget before any durable occurrence claim.

Target:

```text
verified occurrence
→ durable acceptance
→ KEY observation/proposal
→ governance
→ action
```

A provider redelivery must not be interpreted as new user intent unless provider semantics say it is a new occurrence.

---

## M. Capability Mapping

Ingress is not itself permission to execute arbitrary business capabilities.

External events can:

- establish facts/signals;
- request state reconciliation;
- trigger configured automation;
- supply human control evidence where explicitly designed;
- generate plans/proposals.

Material child capabilities remain subject to K3/K5 authority/governance rules.

---

## N. Authority / Governance

Authentication of a provider event is evidence of origin, not blanket authorization for arbitrary effects.

Target governance should distinguish:

```text
provider fact accepted
→ canonical state/fact update allowed by domain contract

provider event causes consequential new action
→ capability/control policy applies
```

Examples: payment settlement reconciliation may be a canonical domain transition; a customer message causing an outbound campaign is a new capability invocation.

---

## O. Blueprint / Graph / Genome

Only `APPLIED`/reconciled facts should enter the Business Graph as durable truth at the appropriate confidence/provenance level.

`RECEIVED` or `AUTHENTICATED` alone means “the provider delivered a statement,” not “the claimed business outcome is true.”

Later lifecycle events (refund, chargeback, reversal, account re-enable, etc.) must supersede/reconcile earlier truth rather than merely append disconnected notifications.

---

## P. Invariants

1. Signature/authentication verification is fail-closed for material provider ingress.
2. Tenant identity is bound to authenticated or independently verified provider routing evidence.
3. Every material external logical occurrence has stable identity when the provider makes such identity available.
4. `received != applied`.
5. Durable acceptance precedes successful HTTP acknowledgement when processing is deferred.
6. Claiming an occurrence does not mark it successfully processed.
7. Processing ownership is atomic/leaseable for concurrent workers.
8. Retryable failure remains resumable.
9. APPLIED replay is a no-op for one-time consequences.
10. Out-of-order provider events are reconciled against authoritative domain/provider state where required.
11. Event occurrence identity survives into material downstream consequence identity.
12. Authentication, occurrence identity, processing ownership and effect idempotency are separate controls.
13. Compatibility ingress routes must delegate to the canonical processor; they must not implement parallel business semantics.
14. Immediate checkout/browser callback truth is not a substitute for long-lived provider lifecycle truth.
15. Provider payload schema/version is part of interpretation provenance.
16. Unsupported/ignored events terminate explicitly as IGNORED rather than masquerading as APPLIED.
17. No AI or external side-effect branch may occur before replay/occurrence ownership where duplicate effect would matter.

---

## Q. Failure Matrix

| Failure | Current examples | Target handling |
|---|---|---|
| Invalid signature | provider-specific rejects | REJECTED, no tenant mutation |
| Authenticated but wrong tenant claim | legacy Meta scoped paths / generic body businessId risk | fail tenant binding |
| Duplicate delivery | fragmented per subsystem | same occurrence, APPLIED no-op or resume unfinished |
| Crash after claim before effect | WebhookEvent pattern can suppress retry | lease + RETRYABLE_FAILED/resume |
| Effect before durable claim | RISC / some messaging branches | claim before material effect |
| HTTP 2xx before durable acceptance | Chatwoot | persist/queue then acknowledge |
| Concurrent same occurrence | RISC read-before-effect; messaging variants | atomic claim |
| Out-of-order lifecycle event | payment providers | reconcile from authoritative state / legal transitions |
| Unknown event | provider switches | explicit IGNORED with evidence |
| Missing provider event id | some callback/form paths | provider-specific semantic identity or explicit weaker assurance |
| Legacy duplicate route | Stripe | compatibility adapter delegates to canonical processor |
| Later provider correction | WiPay refunds/chargebacks etc. | lifecycle ingestion + reconciliation |
| Processing poison event | not normalized globally | retry budget → dead letter/operator evidence |

---

## R. Idempotency / Transactions / Concurrency

Replace vague “webhook idempotency” with four properties:

```text
1. OCCURRENCE UNIQUENESS
   Is this the same logical external occurrence?

2. PROCESSING OWNERSHIP
   Which worker owns processing now?

3. CONSEQUENCE UNIQUENESS
   Should consumer C perform effect E once for occurrence O?

4. EFFECT IDEMPOTENCY / RECONCILIATION
   If execution is retried, how are duplicate real-world effects prevented or resolved?
```

A unique event ID solves only (1).

---

## S. Security / Privacy

- raw-body preservation where signature protocols require it;
- constant-time comparison for MAC/signature digests/secrets where applicable;
- timestamp/replay-window checks where provider protocol supports them;
- endpoint/account-scoped secrets where appropriate;
- secret rotation/version provenance;
- do not log raw credentials/tokens;
- minimize retained raw payloads; preserve sufficient evidence/provenance;
- tenant routing is an authorization boundary, not mere request parsing;
- provider-native verification should be preferred over home-grown approximation.

Current discrepancy: form webhook documentation calls its shared-secret equality check “HMAC”; implementation compares the supplied header directly with the stored secret. Treat that as bearer-secret authentication unless/until a real payload MAC is implemented.

---

## T. Observability

Target ingress telemetry:

```text
ingress_received_total{provider,type}
ingress_auth_failed_total{provider,reason}
ingress_tenant_bind_failed_total{provider}
ingress_replay_total{provider,type,state}
ingress_processing_total{state,provider,type}
ingress_processing_latency
retry_count / dead_letter_count
oldest_retryable_age
occurrence_to_consequence trace
provider reconciliation lag
```

Every operator-visible failure should expose occurrence ID, provider/source, business (when safely resolved), state, last error, retry eligibility and consequence status.

---

## U. Proof / Test

Required proof classes before J14 can be target-converged:

- invalid signature cannot mutate state;
- valid provider payload cannot be rebound to a different tenant;
- same occurrence delivered concurrently yields one processing owner;
- crash after durable claim but before domain application can resume;
- crash after domain application but before APPLIED evidence cannot duplicate one-time business effect;
- APPLIED replay acknowledges without duplicate consequence;
- out-of-order lifecycle events converge to correct domain/provider truth;
- legacy compatibility route produces exactly the same canonical processing path/evidence as primary route;
- deferred/async webhook only returns success after durable handoff;
- poison event becomes visible dead-letter rather than infinite retry or false success;
- downstream EventOccurrenceId/ConsequenceId lineage is preserved.

No tests were executed during this forensic pass; these are proof requirements, not test results.

---

## V. Reachability

Verified mounted/live through root modules or direct controller/module evidence:

- PaymentsModule provider webhooks;
- WebhooksModule legacy Stripe route;
- WhatsAppModule;
- SocialModule;
- CommunicationsModule;
- RiscModule;
- LivekitModule;
- ChatwootModule;
- PhoneVoiceModule;
- connector form webhook controller through ConnectorModule.

Shopify current module is mounted but the inspected surface is pull/sync; no inbound Shopify webhook was found in this pass.

Generic communications email/SMS external caller reachability remains less certain than route reachability; treat exposure severity separately from code-contract weakness.

---

## W. Duplication / Legacy / Compatibility

Highest-value duplication currently observed:

```text
Stripe primary: /payments/stripe/webhook
  → provider event claim
  → Payment rows
  → ledger posting
  → invoice reconciliation

Stripe legacy: /webhooks/stripe
  → separate Stripe SDK verification
  → CommerceService.markInvoicePaid
  → connector event
  → may synthesize local Payment when none exists
```

The legacy controller comment says it forwards to the payments module, but current implementation does not.

Target compatibility rule:

> A legacy ingress URL may remain temporarily, but after provider verification/routing it must delegate to the same canonical occurrence processor. Compatibility is transport aliasing, not business-semantic duplication.

---

## X. Architecture Alignment

Historical KeyFlow principle: modules may be isolated internally while integration is seamless to the user.

J14 target supports this by giving provider adapters one stable contract without forcing all domains into one implementation. Domain modules retain their state semantics; K7/K9/K11 supply the cross-cutting occurrence/processing/recovery laws.

---

## Y. Contradictions

Active contradiction classes:

- first-seen dedupe vs recoverable processing;
- authenticated sender vs bound tenant;
- downstream projection dedupe vs pre-consequence replay ownership;
- canonical Stripe financial ingestion vs live legacy parallel ingestion;
- browser checkout result vs long-lived payment truth;
- documented HMAC vs bearer-secret equality;
- fast HTTP acknowledgement vs durable acceptance.

Canonical contradiction IDs are pooled separately.

---

## Z. Unknowns

- exact long-term migration status/configuration count of legacy Meta scoped webhook URLs;
- whether generic inbound email/SMS routes are called by a trusted internal normalizer or external providers directly;
- provider-specific event IDs available on all current form webhook variants;
- exact production WiPay integration version/account configuration and whether current provider lifecycle webhooks are enabled outside repo evidence;
- whether any infrastructure-level queue/proxy supplies durable acceptance before Chatwoot handler (none observed in app code);
- precise retention/privacy policy for future raw ingress payload references;
- target event ordering strategy per domain (global ordering is neither required nor desirable).

---

## AA. Findings

This dossier currently supports the next canonical finding sequence beginning F127. Key classes:

- seen-before-processing can suppress recovery;
- action-before-claim can duplicate effects;
- authentication can be valid while tenant binding is invalid;
- replay ownership can occur too late in the consequence graph;
- compatibility routes can preserve divergent business truth;
- immediate provider callbacks can be weaker than lifecycle truth;
- fire-and-forget acceptance can lose work;
- external submission IDs can be carried but not used as durable occurrence identity.

---

## AB. Canonical Journey Graph

```text
EXTERNAL REALITY
      │
      ▼
┌──────────────────────┐
│ Provider delivery    │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ Authenticate source  │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ Bind provider/tenant │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ Normalize occurrence │
│ source + stable id   │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ Durable occurrence   │
│ CLAIM / PROCESSING   │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ Domain application   │
│ K6 canonical state   │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ EventOccurrence      │
│ consequence graph    │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ Consumption/Effect   │
│ claims               │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ OutcomeEvidence      │
│ reconciliation       │
└──────────┬───────────┘
           │
           └────► Business Graph / Genome / user-visible truth
```

Failure feedback:

```text
PROCESSING timeout/error
→ RETRYABLE_FAILED
→ reacquire
→ resume/reconcile

uncertain external side effect
→ OUTCOME_UNKNOWN
→ provider reconciliation
→ APPLIED | FAILED_FINAL
```

---

## AC. Machine-readable record

```yaml
id: KF-JOURNEY-014
type: journey
status: ACTIVE_FORENSICS
title: Webhook / External Event Ingress
implementation_baseline: d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
current_reality:
  ingress_regimes:
    - payments_webhooks
    - legacy_stripe_webhook
    - meta_whatsapp
    - meta_social
    - generic_email_sms
    - google_risc
    - connector_form_webhooks
    - livekit
    - chatwoot
    - twilio_voice
  fragmented_occurrence_lifecycle: true
  parallel_stripe_semantics: true
  shopify_push_ingress_observed: false
identity_layers:
  - provider_delivery_id
  - provider_occurrence_id
  - event_occurrence_id
  - consumption_id
  - consequence_id
  - effect_attempt_id
  - provider_effect_id
target_states:
  - RECEIVED
  - AUTHENTICATED
  - TENANT_BOUND
  - OCCURRENCE_IDENTIFIED
  - CLAIMED
  - PROCESSING
  - APPLIED
  - IGNORED
  - RETRYABLE_FAILED
  - DEAD_LETTER
uses_kernels:
  - KF-KERNEL-007
  - KF-KERNEL-009
  - KF-KERNEL-011
affects_kernels:
  - KF-KERNEL-001
  - KF-KERNEL-006
  - KF-KERNEL-008
  - KF-KERNEL-010
affects_journeys:
  - KF-JOURNEY-005
  - KF-JOURNEY-007
  - KF-JOURNEY-013
  - KF-JOURNEY-018
  - KF-JOURNEY-023
invariants:
  - J14-I01-authenticate-fail-closed
  - J14-I02-tenant-binding-independent
  - J14-I03-stable-occurrence-identity
  - J14-I04-received-not-applied
  - J14-I05-durable-accept-before-ack
  - J14-I06-claim-not-completion
  - J14-I07-atomic-processing-owner
  - J14-I08-retryable-resumable
  - J14-I09-applied-replay-no-op
  - J14-I10-out-of-order-reconcilable
  - J14-I11-causal-identity-propagates
  - J14-I12-controls-not-collapsed
  - J14-I13-legacy-route-delegates
  - J14-I14-callback-not-lifecycle-truth
proof_required:
  - concurrent_replay
  - crash_before_application
  - crash_after_application_before_terminal_evidence
  - cross_tenant_rebinding
  - out_of_order_lifecycle
  - legacy_route_equivalence
  - durable_ack_handoff
  - dead_letter_visibility
external_references:
  - https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md
  - https://docs.stripe.com/webhooks
  - https://www.twilio.com/docs/usage/webhooks/webhooks-security
  - https://docs.wipayfinancial.com/payments-api
  - https://docs.wipayfinancial.com/webhooks
  - https://docs.wipayfinancial.com/webhooks/payments-api
```
