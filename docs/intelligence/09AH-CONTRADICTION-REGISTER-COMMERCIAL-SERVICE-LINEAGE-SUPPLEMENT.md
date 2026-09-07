# KeyFlowOS Contradiction Register — Commercial / Service Lineage Supplement

Status: CANONICAL SUPPLEMENT
Last updated: 2026-09-06
Scope: J3 Lead → Customer → Cash; J4 Booking → Service → Payment

## C150 — Deposit semantics vs additive final service receivable

```text
service deposit as advance / partial satisfaction of one service price
!= deposit invoice D + later full-price invoice P with no settlement lineage
```

If the commercial obligation is one service price `P`, the current deposit path can create total invoiced amount `P + D` because completion invoicing ignores the prior deposit descendant.

Owner: J4 / K6 / K8 / K10 / K11.
Finding: F200.

---

## C151 — Booking terminal correction vs unresolved financial descendants

```text
Booking CANCELLED or NO_SHOW
!= deposit / invoice / payment / attribution financial disposition resolved
```

The current booking transition updates the operational state and emits non-financial events without a declared policy owner that resolves existing financial descendants.

Owner: J4 / K6 / K8 / K10 / K11.
Finding: F201.

---

## C152 — Revenue attribution as one stage vs heterogeneous commercial-value stages

```text
BOOKING pipeline attribution
+ paid INVOICE attribution
!= directly additive realized revenue
```

`RevenueAttribution` stores booking pipeline value and paid invoice value as separate rows, while generic source rollups sum amounts without a stage/lineage discriminator. Deposit + final invoice descendants can increase the multiplicity further.

Owner: J3/J4 / K8 / K10 / K4.
Finding: F202.

---

## C153 — Canonical CRM status vocabulary vs KeyCortex lowercase aliases

```text
LEAD | PROSPECT | CLIENT | LOST
!= lead | customer query predicates
```

A projection that queries lowercase/non-canonical statuses cannot reliably observe canonical CRM rows and can misstate lead/customer conversion context even after domain lifecycle convergence is repaired.

Owner: J3 / K4 / K6 / K8.
Finding: F203.

No production implementation is authorized by this supplement.
