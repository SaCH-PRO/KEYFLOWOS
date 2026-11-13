# KF-JOURNEY-004 — Booking → Service → Payment

Status: **PROVISIONALLY CONVERGED / TARGET-ALIGNED ANALYTICAL TRANCHE**
Last updated: 2026-09-06
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Canonical intelligence branch: `docs/keyflow-intelligence-foundation`
Production implementation remains **UNAUTHORIZED / READ-ONLY**.

## A. Definition

J4 models how KeyFlowOS turns a requested service booking into delivered service, receivable/payment consequences, cancellation/no-show disposition, customer-lifecycle evidence and downstream automation.

It asks:

> When a booking is created, paid, completed, cancelled or marked no-show, what exact commercial obligation exists, which financial descendants belong to it, which consequences are still expected or missing, and which automated actions are valid under the canonical event/tool contract?

Primary kernels:

```text
K6  State Transition
K8  Evidence & Outcome
K10 Financial Truth
K7  Temporal / Event / Workflow
K11 Recovery & Reliability
K4  Business Knowledge
K3  Governance where automated execution is material
```

Primary adjacent journeys:

```text
J3  Lead → Customer → Cash
J7  Financial Truth
J17 Command Center → Priority → Action
J18 Failure → Recovery
J23 Temporal Flow / Long-Running Workflow
J6  Proactive KEY / Autonomy
```

---

## B. Product intent

Target product behavior:

```text
booking request
→ service occurrence / reserved time
→ declared commercial obligation
→ deposit/prepayment/final receivable lineage
→ provider/payment/accounting truth
→ service completion or cancellation/no-show disposition
→ expected consequences satisfied / waived / failed / unresolved
→ customer lifecycle + operator + automation projections
```

A user should be able to ask:

- What has this client paid for this service occurrence?
- Was a deposit an advance, an earned fee, or something else?
- What remains due after the deposit?
- If the booking was cancelled/no-show, should the deposit be refunded, retained, credited or reviewed?
- If service was completed but invoicing failed, what unresolved work remains?
- Did the automation that should run after booking completion receive a contract-compatible payload?
- Which descendant action is missing, duplicated, blocked or already satisfied?

and receive an explainable answer tied to one commercial lineage rather than independent booking/invoice/payment rows.

---

## C. Current live chain

The current reconstructed booking/service chain includes:

```text
publicCreateBooking()
→ Booking created
→ optional DEPOSIT Invoice created
→ Booking.depositInvoiceId set
→ Booking.invoiceId may remain null
→ BOOKING RevenueAttribution = full service price
→ booking.created event

later status transition
→ CONFIRMED / COMPLETED / CANCELLED / NO_SHOW

COMPLETED
→ durable Booking.status update first
→ booking.completed event
→ CRM/timeline/rebooking consequences
→ autoGenerateInvoiceForCompletedBooking()

invoice payment
→ invoice/payment/accounting flow under J7
→ invoice.paid event
→ booking confirmation / downstream listeners where applicable
```

Cancellation/no-show currently updates operational state without a declared financial disposition contract for existing deposit/invoice/payment descendants.

---

## D. Booking state and financial state are non-equivalent

Observed booking statuses include operational/service lifecycle meanings such as:

```text
PENDING
CONFIRMED
CANCELLED
COMPLETED
NO_SHOW
```

Observed `Booking.paymentStatus` schema vocabulary:

```text
UNPAID | DEPOSIT_PAID | PAID
```

Current code tracing has not established this field as the canonical maintained financial aggregate for the live payment path; invoice/payment relations and events carry the load-bearing financial evidence instead.

Target law:

```text
Booking operational/service state
!= commercial obligation state
!= Invoice/payment state
!= accounting truth
!= cancellation/no-show financial disposition
```

---

## E. Deposit / final receivable lineage

Current deposit mode can produce:

```text
service price = P
deposit invoice = D
Booking.depositInvoiceId = deposit invoice
Booking.invoiceId = null
```

On later completion, completion-time invoicing checks `booking.invoiceId` and can generate a new invoice for full `P` rather than `P - D`.

No inspected canonical settlement path applies the prior deposit as satisfaction/credit against the final service receivable.

Reachable algebra:

```text
commercial service price = P
DEPOSIT invoice = D
FINAL invoice = P
combined invoiced = P + D
```

This is F200/C150.

Target semantics require `CommercialObligationLineage` to bind deposit, final receivable, payments, credits/refunds and remaining obligation to the same commercial occurrence.

---

## F. Completion-time receivable consequence

For completion-invoice services, `BookingsService.updateBookingStatus(..., COMPLETED)` commits the booking state before attempting invoice creation.

The completion invoice helper catches creation failure, logs it and returns.

Thus a reachable state is:

```text
Booking = COMPLETED
service evidence = present
required completion Invoice = absent
recovery owner = absent
```

This is F199/C149.

Target law:

```text
service completion may precede receivable creation
but required receivable failure
→ durable ExpectedConsequence state
→ idempotent recovery ownership
→ linked Invoice OR explicit waiver/not-applicable disposition
```

Absence of an Invoice row must not mean absence of unfinished commercial work.

---

## G. Cancellation / no-show financial disposition

Current `CANCELLED` and `NO_SHOW` transitions persist operational state and emit corresponding events.

The inspected path does not resolve:

```text
Booking.invoiceId
Booking.depositInvoiceId
Invoice state
Payment rows
refund / credit state
RevenueAttribution rows
```

No load-bearing policy owner was found that determines whether existing money should be:

```text
REFUND
PARTIAL_REFUND
RETAIN_AS_EARNED_FEE
APPLY_AS_CUSTOMER_CREDIT
CANCELLATION_FEE
WAIVE_REMAINING_BALANCE
BALANCE_REMAINS_DUE
MANUAL_REVIEW
NOT_APPLICABLE
```

This is F201/C151.

The target contract must choose a policy-versioned `ServiceFinancialDisposition`; only then do KF-REC-052/K10 own the financial descendants.

---

## H. Revenue attribution / commercial value stages

At booking creation, current code writes a BOOKING attribution at full service price before payment.

At invoice payment, the storefront invoice attribution listener writes INVOICE attribution for paid booking-related invoices.

Thus one service can produce rows representing different stages:

```text
BOOKING = pipeline / expected full service value P
DEPOSIT INVOICE = paid D
FINAL INVOICE = paid P under current F200 path
```

Generic attribution persistence distinguishes row identity by `(businessId, revenueType, revenueId)` rather than commercial lineage/stage.

This is F202/C152.

Target reports must declare `CommercialValueStage` such as:

```text
EXPECTED
COMMITTED
INVOICED
COLLECTED_GROSS
NET_REALIZED
REVERSED / CREDITED
```

and deliberately choose a stage instead of adding heterogeneous rows.

---

## I. Event / automation contract

The live `booking.completed` event emits a canonical payload shaped around:

```text
booking
contact?
businessId
```

The mounted post-booking journey template assumes flat fields such as:

```text
contactId
serviceName
amount
bookingId
contactName
```

and its first `commerce_create_invoice` step fails to provide the actual tool contract fields required by `CommerceService.createInvoice()`.

This is F204/C154.

Consequences include blocking later intended steps such as customer promotion/follow-up/review automation.

Target law:

```text
DomainEventSchema vN
+ explicit adapter/mapping vX
+ Action/ToolSchema vM
→ compatibility validation before activation/execution
```

Plan-step idempotency remains distinct from semantic commercial-effect idempotency.

---

## J. Frontend / public booking surface

Public booking UX can create a booking and may redirect into payment depending on service/payment configuration.

Target UX must not imply that:

- a deposit equals full settlement;
- a confirmed/completed booking means financial completion;
- cancellation automatically resolved money;
- an absent descendant means no action remains.

Where financial disposition or recovery is unresolved, operator/public surfaces should reflect pending/manual-review state rather than a falsely terminal outcome.

---

## K. API / write-door pressure

Status transitions should remain operationally scoped, while commercial/financial consequences are resolved through owned contracts.

Future write-door pressure includes:

- booking status transition policy;
- commercial obligation identity/lineage;
- policy-versioned financial disposition;
- expected consequence state;
- typed event-to-action adapters;
- semantic effect idempotency for invoice/credit/refund creation.

No recommendation here authorizes a universal Booking super-state or universal commercial table.

---

## L. Backend mutation ledger — relevant owners

| Model/domain | Current role | Target interpretation |
|---|---|---|
| Booking | Operational/service occurrence state | Origin/evidence for commercial lineage |
| Booking.invoiceId | Final/current linked invoice relation | Descendant reference, not full obligation truth |
| Booking.depositInvoiceId | Deposit descendant relation | Deposit/prepayment descendant reference |
| Booking.paymentStatus | Schema-level payment projection | Must be classified/migrated; cannot silently compete with canonical financial truth |
| Service | Price/duration/deposit policy inputs | Commercial policy input |
| Invoice | Receivable/document state | KF-REC-052/K10 financial descendant |
| Payment | Money-movement evidence | KF-REC-052/K10 financial truth input |
| RevenueAttribution | Pipeline/paid stage persistence | Must expose stage + lineage |
| ExpectedConsequence | Target semantic concept | Makes missing descendants explicit even when row absent |

---

## M. Tenant / identity

Every Booking, Service, Contact, Invoice, Payment, attribution row and policy evaluation remains business-scoped. Public booking entry must resolve the correct Business and must not allow cross-tenant service/staff/contact/invoice linkage.

---

## N. Events / coordination

Operational state changes and financial consequence work can be asynchronous, but the architecture must preserve causality:

```text
source Booking occurrence/transition
→ event/evidence identity
→ expected commercial consequence
→ execution attempt(s)
→ observed descendant/outcome
→ recovery/correction if incomplete
```

A listener firing successfully is not proof that the required commercial effect completed.

---

## O. KEY / AI

AI automation may propose or execute follow-ups around booking/service state only after canonical event schemas, authority, lifecycle semantics and financial disposition are known.

KEY must not infer that `COMPLETED`, `CANCELLED`, `NO_SHOW` or `PAID` means more than its owning domain proves.

Customer-learning effects from the journey consume only epistemically eligible outcomes under KF-REC-049.

---

## P. Authority / governance

Financial disposition policy can be business-configurable, but money-moving execution still belongs to K3/K10/K9 authority boundaries.

Examples:

```text
policy says deposit refundable
!= refund actually executed

policy says retain as earned fee
!= accounting consequence posted
```

Disposition selection, execution authority and outcome proof remain separate.

---

## Q. Canonical J4 invariants

1. Booking/service state is not financial truth.
2. One service occurrence has one coherent commercial obligation lineage even when it has multiple descendants.
3. A deposit/prepayment is not silently additive to final service price.
4. Completion does not imply receivable/payment/accounting completion.
5. Required missing descendants are explicit unresolved work.
6. Cancellation/no-show does not imply financial disposition completion.
7. Disposition is policy-versioned and does not assume all deposits are refundable or earned.
8. Financial descendants delegate to KF-REC-052/K10.
9. Revenue attribution declares value stage and lineage.
10. Repeated repair does not duplicate the commercial effect.
11. Event name equality is not event/tool schema compatibility.
12. Automated event→action execution requires validated schema composition.
13. Plan-step/message idempotency is not commercial effect idempotency.
14. Customer lifecycle consequences delegate to J3/KF-REC-053.
15. Recovery certainty delegates to KF-REC-048/K11.

---

## R. Failure matrix

| Failure | Canonical root | Target behavior |
|---|---|---|
| Completion invoice creation fails after Booking COMPLETED | F199/C149 | durable expected consequence + idempotent repair |
| Deposit plus full final invoice exceed service price | F200/C150 | obligation lineage + settlement allocation |
| CANCELLED/NO_SHOW leaves paid deposit unresolved | F201/C151 | explicit ServiceFinancialDisposition + descendants |
| Booking pipeline + invoice paid rows summed | F202/C152 | stage-explicit attribution |
| booking.completed journey cannot map to invoice tool | F204/C154 | typed/versioned event-to-action adapter |
| Customer remains wrong lifecycle state | F197/F203/F205 adjacency | J3 canonical lifecycle contract |

---

## S. Idempotency / transaction / concurrency

The booking slot conflict transaction protects against one class of double booking, but commercial descendant effects need their own semantic identities.

Examples:

```text
booking occurrence -> completion receivable effect
booking occurrence -> deposit obligation effect
booking cancellation -> refund/retain/credit effect
```

Retries must converge on one semantic effect even across worker/process boundaries.

A plan-step ID or provider event ID does not by itself establish uniqueness of the commercial obligation consequence.

---

## T. Security / privacy

Public booking is externally reachable and therefore must preserve business/service/staff binding and minimize exposed customer/financial data. Internal recovery/disposition paths must remain tenant-scoped and authority-aware.

---

## U. Observability

For one booking/service occurrence, the system should be able to explain:

```text
booking/service status
commercial obligation identity
service contracted amount
existing deposit/final invoices
allocated paid amount
credited/refunded/retained amount
remaining amount
selected disposition + policy version
expected consequences
missing/failed consequences
recovery state
relevant event/action contract versions
```

---

## V. Proof / test pressure

Future proof obligations include:

- deposit + final invoice do not exceed intended obligation unless policy explicitly says so;
- partial payment/credit/refund allocation deterministically computes remaining obligation;
- cancellation/no-show selects one disposition and proves required descendants;
- missing completion invoice is observable/recoverable without an Invoice row;
- repeated repair cannot duplicate invoice/refund/credit effects;
- incompatible event/tool schemas fail before runtime effect pursuit;
- mapping version is traceable from event occurrence to effect/outcome;
- old/new schema versions can coexist under explicit compatibility rules.

Runtime proof has not been executed in this analytical programme.

---

## W. Reachability

F199–F204 are grounded in mounted/live service, listener, journey-orchestration or attribution paths.

The candidate second valid completion invoice from the AI journey is **not proven** because the current post-booking mapping is malformed before a valid invoice effect is established.

---

## X. Duplication / competing truths

Current competing or incomplete financial/commercial representations around one booking can include:

```text
Booking.status
Booking.paymentStatus
Booking.invoiceId
Booking.depositInvoiceId
Invoice.status
Payment rows
RevenueAttribution BOOKING row
RevenueAttribution INVOICE rows
provider/payment/accounting state
journey automation intent
```

Target architecture composes these through lineage and owned truth layers rather than picking one row as universal truth.

---

## Y. Architecture alignment

J4 is now aligned to:

- `KF-REC-053 — Commercial Relationship & Obligation Contract` for commercial lineage, value stages, disposition, expected consequences and event/action composition;
- `KF-REC-052 — Financial Truth & Valuation Contract` for payments/refunds/accounting/valuation;
- `KF-REC-048 — Recovery Contract` for certainty/retry/compensation;
- `KF-REC-047 — Temporal Work Projection` for unresolved/scheduled work visibility;
- `KF-REC-051 — Operator Attention & Priority Contract` for ranking unresolved consequences;
- `KF-REC-049 — Business Knowledge Contract` for epistemic eligibility.

---

## Z. Canonical contradictions

Primary J4 contradictions:

```text
C149 completed service != guaranteed required receivable descendant
C150 deposit as service advance != additive deposit + full final receivable
C151 CANCELLED/NO_SHOW != financial descendant disposition complete
C152 booking pipeline value + paid invoice value != additive realized revenue
C154 canonical booking.completed payload != template-local/tool input contract
```

---

## AA. Canonical findings

Primary:

```text
F199 completion-time receivable creation can fail silently after Booking COMPLETED
F200 service deposits do not settle into final service receivable
F201 cancellation/no-show does not resolve financial descendants
F202 RevenueAttribution conflates booking/pipeline and realized invoice stages
F204 post-booking journey consumes an incompatible event/tool contract
```

Adjacent J3 pressure:

```text
F197 customer evidence can advance without canonical lifecycle convergence
F203 KeyCortex reads noncanonical customer status predicates
F205 Contact.status admits incompatible lifecycle/health dialects
```

---

## AB. Canonical journey graph

```text
public booking request
      ↓
Booking occurrence + Service policy
      ↓
CommercialObligationLineage
      ├── deposit/prepayment descendant
      ├── completion/final receivable descendant
      ├── expected consequence state
      └── ServiceFinancialDisposition on correction/cancel/no-show
      ↓
Invoice / Payment / Credit / Refund descendants
      ↓
KF-REC-052 Financial Truth
      ↓
CommercialValueStage projection
      ↓
CustomerLifecycle evidence → J3
      ↓
Temporal/recovery/operator projections
      ↓
Typed DomainEventSchema → Adapter → ToolSchema → governed automation
```

---

## AC. Machine-readable record

```yaml
journey: KF-JOURNEY-004
name: Booking -> Service -> Payment
status: PROVISIONALLY_CONVERGED_TARGET_ALIGNED
implementation_baseline: 4e9f60c65bdb78fbdadcb08731c5dab95b3645c7
production_implementation_authorized: false
primary_kernels: [K6, K8, K10, K7, K11, K4]
adjacent_journeys: [J3, J7, J17, J18, J23, J6]
primary_findings: [F199, F200, F201, F202, F204]
adjacent_findings: [F197, F203, F205]
primary_contradictions: [C149, C150, C151, C152, C154]
target_recommendations: [KF-REC-053, KF-REC-052, KF-REC-048, KF-REC-047, KF-REC-051, KF-REC-049]
canonical_laws:
  - booking_state != financial_truth
  - deposit != additive_charge_unless_policy_says_so
  - service_complete != financial_complete
  - cancelled_or_no_show != financial_disposition_complete
  - missing_descendant != nothing_left_to_do
  - event_name_equality != schema_compatibility
  - plan_step_idempotency != commercial_effect_idempotency
runtime_proof: NOT_EXECUTED
reopenable: true
```

## Current maturity

```text
MICROSCOPIC RECONSTRUCTION:      complete for current J4 tranche
CROSS-KERNEL RECONCILIATION:    complete for current tranche
TARGET SYNTHESIS:                complete via KF-REC-053
BACKWARD RE-AUDIT:               complete for current J17/J18/J23/J7/K4 impact set
PRODUCTION IMPLEMENTATION:       not authorized
RUNTIME / MIGRATION PROOF:       not executed
WHOLE-SYSTEM REAUDIT:            future
```

J4 remains reopenable when live-data inventory, implementation planning, runtime proof, payment-provider disposition rules or adjacent commerce/contract journeys add new evidence.
