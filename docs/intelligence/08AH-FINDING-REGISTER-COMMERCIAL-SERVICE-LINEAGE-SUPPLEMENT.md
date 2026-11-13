# KeyFlowOS Finding Register — Commercial / Service Lineage Supplement

Status: CANONICAL SUPPLEMENT
Last updated: 2026-09-06
Scope: J3 Lead → Customer → Cash; J4 Booking → Service → Payment
Implementation baseline: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

This supplement continues the J3/J4 commercial-to-cash microscopic reconstruction after F197–F199. It reuses J7 Financial Truth and J18/J23 recovery roots where the underlying semantic defect is already owned there.

---

## F200 — Service deposits do not settle into the final service receivable

Classification: CURRENT IMPLEMENTATION DEFECT / SERVICE FINANCIAL LINEAGE
Primary journey: J4
Primary kernels: K6 State Transition, K8 Evidence & Outcome, K10 Financial Truth, K11 Recovery

### Evidence

`BookingsService.publicCreateBooking()` supports a deposit mode:

```text
service.price = P
depositRequired = true
→ computeServiceDeposit(service) = D
→ CommerceService.createInvoiceForService(..., kind=DEPOSIT, amountOverride=D)
→ Booking.depositInvoiceId = deposit invoice
→ Booking.invoiceId remains null
```

`CommerceService.createInvoiceForService()` creates the deposit invoice for `D` and labels it as a deposit.

When the booking later becomes `COMPLETED`, `BookingsService.autoGenerateInvoiceForCompletedBooking()` checks only `booking.invoiceId`. A deposit booking still has `invoiceId = null`, so it calls `createInvoiceForService()` again without an amount override. The resulting final invoice is therefore the full service price `P`, not `P - D`.

No inspected code path applies the deposit invoice/payment as a credit or settlement against the final service invoice.

Current algebra can therefore become:

```text
service commercial price = P
DEPOSIT invoice = D
FINAL invoice = P
combined invoiced obligation = P + D
```

rather than a declared settlement model such as:

```text
service commercial price = P
deposit applied = D
remaining receivable = P - D
```

### Why this is distinct

This is not F194 gross-vs-net payment projection and not F188 payment consequence completeness. The defect exists before payment: two service receivable artifacts do not compose one declared commercial obligation.

### Target pressure

A booking/service needs a canonical financial-obligation lineage that can state whether a prepayment is:

- an advance applied to the service price;
- a separately earned/non-refundable fee;
- refundable until a policy boundary;
- partially retained on cancellation/no-show.

The word `deposit` must not silently mean an additive charge.

---

## F201 — Booking cancellation/no-show does not resolve existing deposit/invoice/payment descendants under a declared financial disposition

Classification: CURRENT IMPLEMENTATION DEFECT / CORRECTION-CONVERGENCE GAP
Primary journey: J4
Primary kernels: K6, K8, K10, K11

### Evidence

`BookingsService.updateBookingStatus()` permits `CANCELLED` and `NO_SHOW` and persists the new booking status first.

For `CANCELLED`, the inspected path emits `booking.cancelled` and writes CRM/timeline evidence. For `NO_SHOW`, it emits `booking.no_show`.

The status transition does not inspect or reconcile:

```text
Booking.invoiceId
Booking.depositInvoiceId
Invoice status
Payment rows
refund/credit state
RevenueAttribution rows
```

Repository search of `booking.cancelled` consumers found notification/activity/AI/growth handlers but no financial-disposition owner for deposit/final-invoice/payment consequences.

No load-bearing service cancellation/no-show financial policy was found in the inspected booking path.

### Important qualification

This finding does **not** assert that every cancellation should refund a deposit. A legitimate policy may retain a deposit or impose a fee.

The defect is that the current transition has no declared financial disposition contract capable of proving which outcome is correct.

### Target pressure

```text
booking cancellation/no-show
+ existing financial descendants
→ policy-specific financial disposition
→ void / credit / retain / refund / fee / remaining balance as applicable
→ durable evidence + idempotent correction/recovery
```

`CANCELLED` or `NO_SHOW` must not make financial descendants semantically orphaned.

---

## F202 — RevenueAttribution conflates pipeline/booking value with realized invoice revenue and can count one service multiple times

Classification: CURRENT IMPLEMENTATION DEFECT / DERIVED COMMERCIAL VALUE SEMANTICS
Primary journeys: J3/J4
Primary kernels: K8, K10, K4
Related but distinct: F198 customer LTV double-counting

### Evidence

At public booking creation, `BookingsService` writes:

```text
RevenueAttribution
  revenueType = BOOKING
  revenueId = booking.id
  amount = service.price
  currency = TTD
  occurredAt = booking.createdAt
```

The inline comment explicitly describes this as giving dashboards an immediate view of **pipeline value** before invoice/payment lands.

Separately, `StorefrontInvoiceAttributionListener` listens to `invoice.paid` and records each storefront booking invoice as:

```text
RevenueAttribution
  revenueType = INVOICE
  revenueId = invoice.id
  amount = invoice.total
```

This applies to both deposit invoices and booking-completion invoices.

`RevenueAttributionService` is idempotent only on:

```text
(businessId, revenueType, revenueId)
```

so BOOKING and INVOICE rows for the same commercial service are intentionally distinct rows.

`summarizeBySource()` then groups RevenueAttribution rows by source and sums `amount` as revenue without a commercial-lineage/stage discriminator.

For a deposit booking, the current record set can therefore include:

```text
BOOKING attribution = full service price P        (pipeline)
DEPOSIT INVOICE attribution = D                  (paid invoice)
FINAL INVOICE attribution = P                    (paid invoice under F200)
```

with no cross-stage dedupe in the generic source rollup.

`RevenueReportingService.revenuePerHour()` contains a local booking/invoice dedupe specifically because both layers can represent the same revenue event; that consumer-specific repair strengthens the evidence that the underlying attribution model does not itself encode the semantic stage.

Cancellation/no-show does not retract/reclassify the BOOKING attribution in the inspected path.

### Why this is distinct from F198

F198 is a ContactInsight/LTV computation that adds WON Deal value to PAID Invoice value for one contact.

F202 is the shared RevenueAttribution persistence/rollup model treating pipeline booking value and realized invoice value as additive rows across growth/revenue attribution. Either defect can exist without the other.

### Target pressure

Attribution must separate at least:

```text
PIPELINE / EXPECTED VALUE
COMMITTED / CONTRACTED VALUE
INVOICED VALUE
COLLECTED / NET REALIZED VALUE
REFUNDED / REVERSED VALUE
```

and bind those stages to one commercial lineage so a report can deliberately choose the value basis instead of summing heterogeneous stages.

---

## F203 — KeyCortex CRM context queries a non-canonical lowercase customer-status vocabulary

Classification: CURRENT IMPLEMENTATION DEFECT / DERIVED CUSTOMER PROJECTION
Primary journey: J3
Primary kernels: K4 Business Knowledge, K6 State Transition, K8 Evidence & Outcome
Related but distinct: F197 customer lifecycle convergence

### Evidence

Canonical CRM status vocabulary is uppercase:

```text
LEAD | PROSPECT | CLIENT | LOST
```

It is enforced by server/web constants and create/update DTOs, and `CrmService.createContact()` defaults to `LEAD`.

`KeyCortexContextV2Service.getCrmContext()` instead filters live Contact rows using:

```text
status = 'lead'
status = 'customer'
```

including:

- hot-lead selection;
- pipeline-stage grouping;
- leads-created denominator;
- converted-customer numerator;
- context-diff new-lead count.

`customer` is not a canonical CRM status at all; the canonical customer status is `CLIENT`.

Thus even if F197 were fixed and commercial customer evidence correctly converged a contact to `CLIENT`, this KeyCortex projection would still fail to count that canonical state.

### Why this is distinct from F197

F197 says the domain does not automatically converge strong commercial evidence into `Contact.status = CLIENT`.

F203 says a major AI/business-context consumer queries a different status vocabulary, so canonical rows can still disappear from the projection even when the domain state is correct.

### Target pressure

Customer lifecycle projections must consume one canonical status algebra or a versioned mapping owned by the customer-lifecycle contract. They must not invent local synonyms in query predicates.

---

## Combined pressure from F197–F203

```text
commercial evidence
→ canonical customer / service obligation lineage
→ declared lifecycle transitions
→ declared financial descendants
→ canonical value stage
→ correction / cancellation convergence
→ derived CRM / growth / AI projections
```

The architecture must preserve these non-equivalences:

```text
LEAD/PROSPECT/CLIENT classification
!= pipeline stage
!= lifecycle annotation
!= tag

booking created value
!= service earned value
!= invoice value
!= collected value
!= customer lifetime value

deposit
!= additive charge unless explicitly modeled as one

booking cancelled/no-show
!= financial disposition completed
```

No production implementation is authorized by this supplement.
