# KeyFlowOS Finding Register — Customer Lifecycle and Value Supplement

Status: CANONICAL CONTINUATION — J3 LEAD → CUSTOMER → CASH
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F197 — Commercial customer reality can advance while canonical Contact.status remains LEAD

**Status:** VERIFIED CROSS-DOMAIN CUSTOMER-LIFECYCLE FINDING

`CrmService.createContact()` defaults:

```text
Contact.status = LEAD
```

and the accepted status vocabulary is:

```text
LEAD | PROSPECT | CLIENT | LOST
```

The current revenue spine can then establish materially stronger customer evidence:

```text
Deal = WON
Quote = ACCEPTED
Quote → Invoice converted
Invoice = PAID
StoreOrder = PAID / completed
```

but the inspected core event paths do not promote the Contact to `CLIENT`.

`RevenueEventListener` records quote/invoice/payment/store-order events into the Contact timeline and invalidates insight projections, but `invoice.paid`, `quote.converted`, `store_order.paid` and related handlers do not update `Contact.status`.

Marketplace integration can add descriptive tags such as `customer`, `store-order`, `paid`, while the Contact's status can remain `LEAD`.

`CrmService.updateContact()` permits a caller to manually write status, and an AI journey template can explicitly set `CLIENT`, but that is not equivalent to a canonical domain-owned customer-lifecycle convergence rule.

This matters because several downstream product/intelligence paths treat `status='CLIENT'` as operative truth, including People Overview client counts, CRM flow counts, relationship-health logic and OS high-value-client queries.

Thus a reachable state is:

```text
commercial evidence says customer
while
Contact.status says LEAD
and
downstream projections count/score by Contact.status
```

This is distinct from J7 financial-completion findings. The defect exists even if payment/accounting truth is perfect: it concerns **customer relationship/lifecycle ownership**.

Target law:

```text
COMMERCIAL CUSTOMER EVIDENCE
→ governed CustomerLifecycle assessment/convergence
→ one declared canonical customer relationship state
```

with explicit rules for what evidence is sufficient to become `CLIENT`, and what later refund/cancellation/relationship changes do or do not mean for that classification.

Do not automatically equate one payment with permanent customer status without product policy; the target needs a declared lifecycle rule rather than a hard-coded event shortcut.

Affected kernels: K6, K8, K4.
Affected journeys: J3, J4, J10, J17.

---

## F198 — Contact lifetime value adds pipeline success and realized revenue as independent value, allowing double counting and financial-semantic drift

**Status:** VERIFIED DERIVED-CUSTOMER-VALUE FINDING

`ContactInsightService.aggregate()` computes:

```text
wonDealValue = sum(Deal.value where status = WON)
paidInvoiceTotal = sum(Invoice.total where status = PAID)
lifetimeValue = wonDealValue + paidInvoiceTotal
```

A normal commercial chain can therefore contribute the same economic sale twice:

```text
Deal WON value = 1,000
→ quote/invoice for same sale
→ Invoice PAID = 1,000
→ ContactInsight lifetimeValue = 2,000
```

The computation also:

- uses Invoice status/total rather than canonical net Payment/refund semantics;
- does not subtract later refunds/credits;
- selects one display currency from the first invoice or deal while potentially adding values from heterogeneous currencies.

The refund and valuation aspects reuse J7 F194/F186. The distinct J3 root is the semantic addition of **pipeline/conversion value and realized customer revenue as though they were non-overlapping value classes**.

This derived value feeds downstream reasoning such as high-value tags and churn-risk context, so overstatement can alter customer prioritization rather than remaining a cosmetic metric.

Target distinction:

```text
PIPELINE / WON DEAL VALUE
!= CONTRACTED / INVOICED VALUE
!= GROSS RECEIPTS
!= NET REALIZED REVENUE
!= CUSTOMER LIFETIME VALUE
```

A target customer-value contract must define which economic occurrences contribute, how they are deduplicated by commercial lineage, how refunds/credits affect them, and which valuation basis applies.

Affected kernels: K6, K8, K10, K4.
Affected journeys: J3, J17.

No production implementation is authorized by this supplement.
