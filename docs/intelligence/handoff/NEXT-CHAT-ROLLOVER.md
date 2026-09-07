# KEYFLOWOS — Next Chat Rollover Packet

Status: LIVE CONTINUITY ARTIFACT — CURRENT
Last refreshed: 2026-09-06
Canonical intelligence branch: `docs/keyflow-intelligence-foundation`
Production implementation authorized: **NO**

> Repository continuity is the source of truth. A fresh session must continue without restarting the architecture programme.

## Fresh-chat instruction

```text
Continue KEYFLOWOS from canonical repository intelligence. Do not restart from scratch.
Load 04-CONCEPT-REGISTRY.md, 04A-CANONICAL-TAXONOMY-AND-NAMING-REGISTRY.md,
04B-CANONICAL-ID-ALLOCATION-LEDGER.md, CURRENT-HANDOFF.md,
CURRENT-STATE.yaml and both ROLLOVER files.
Run Context Integrity Check first.
Production code remains read-only.
J7 Financial Truth is pooled through F196/C146/KF-REC-052 with 32 proof obligations and 16 deterministic fault points.
Active frontier is J3/J4 commercial-to-cash through F203/C153.
Resume at booking.completed → AgentTrigger → JourneyOrchestrator → PlanExecutor → commerce_create_invoice reachability,
then cancellation/no-show financial disposition, customer lifecycle ownership and RevenueAttribution stage semantics.
```

## Context integrity

```text
Repository:             SaCH-PRO/KEYFLOWOS
Implementation branch:  main
Current main head:       4e9f60c65bdb78fbdadcb08731c5dab95b3645c7
Previous main head:      9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76
Code-bearing baseline:  d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
Main delta class:        audit / architecture-journal only
Intelligence branch:     docs/keyflow-intelligence-foundation
Context integrity:       PASS
Implementation:          UNAUTHORIZED / READ-ONLY
```

## Canonical taxonomy

```text
Findings:        F203
Contradictions:  C153
Recommendations: KF-REC-052
Concepts:        KF-CONCEPT-042
```

Before new IDs:

```text
LOAD 04A + 04B
→ SEARCH exact term + synonyms + implementation names + target names
→ REUSE / REFINE / CROSS-REFERENCE
→ allocate only if genuinely distinct
```

## Mature / pooled fronts

- J16/K4 Business Knowledge: through F178/C128 / KF-REC-049.
- J17 Operator Attention: through F184/C134 / KF-REC-051 / 20 proof obligations.
- J23/J18 temporal/recovery: 39 proof obligations / 16 deterministic fault points; runtime proof not executed.
- J7 Financial Truth: F185–F196 / C135–C146 / KF-REC-052 / 32 proof obligations / 16 deterministic fault points; runtime proof not executed.

## Active frontier — J3 + J4

```text
J3 — Lead → Customer → Cash
J4 — Booking → Service → Payment
```

Stage:

```text
COMMERCIAL_OBLIGATION_AND_LIFECYCLE_CONVERGENCE
```

Canonical roots:

```text
F197/C147 — strong commercial customer evidence can exist while Contact.status remains LEAD
F198/C148 — ContactInsight LTV adds won Deal + PAID Invoice value for the same sale
F199/C149 — completed booking can lose required completion-time invoice into log-only failure
F200/C150 — deposit D + later full-price invoice P do not compose one service obligation
F201/C151 — CANCELLED/NO_SHOW has no declared financial-descendant disposition
F202/C152 — RevenueAttribution mixes BOOKING pipeline value + paid INVOICE value as additive revenue stages
F203/C153 — KeyCortex queries lowercase lead/customer instead of canonical LEAD/PROSPECT/CLIENT/LOST
```

Working target vocabulary — not standalone concepts yet:

```text
CustomerLifecycle
CommercialObligationLineage
CommercialValueStage
ServiceFinancialDisposition
```

## Key current evidence

### Service deposit lineage

```text
service price = P
deposit invoice = D
Booking.depositInvoiceId = deposit
Booking.invoiceId = null
booking COMPLETED
→ completion helper sees no Booking.invoiceId
→ creates FULL invoice P
```

No inspected path applies D against P. Do not assume whether a deposit is refundable or earned; target must make policy explicit.

### Cancellation / no-show

Operational status/events are updated, but the inspected transition does not resolve existing deposit/invoice/payment/attribution descendants. The defect is absence of a declared financial-disposition contract, not a presumption that cancellation always means refund.

### Revenue attribution stage

Booking creation writes full service price as `RevenueAttribution(BOOKING)` for immediate pipeline visibility. Paid booking invoices later write `RevenueAttribution(INVOICE)`. Generic source rollups can add these heterogeneous stages; a local `revenuePerHour()` dedupe demonstrates the overlap but does not repair the shared model.

### CRM status projection

Canonical Contact status is:

```text
LEAD | PROSPECT | CLIENT | LOST
```

KeyCortex CRM context uses `lead` and `customer`, so even a correctly converged `CLIENT` can disappear from that projection.

## Candidate evidence — not yet a finding

`booking.completed` appears able to activate two invoice-generation mechanisms:

```text
BookingsService autoGenerateInvoiceForCompletedBooking()
+
AgentTriggerService onAny
→ JourneyOrchestrator post-booking template
→ first step commerce_create_invoice
```

The journey template is reachable and `commerce_create_invoice` is tier 2, so JourneyOrchestrator may auto-approve it. However, exact duplicate-effect reachability is not yet proven because the PlanExecutor path, booking event payload shape, tool argument mapping and invoice idempotency must still be traced.

## Exact next work

```text
1. trace booking.completed → AgentTriggerService → JourneyOrchestrator → AiPlan/AiPlanStep → plan.approved → PlanExecutor → FlowOrchestrator commerce_create_invoice;
2. determine exact booking.completed payload shape and whether post-booking template inputs are valid;
3. determine invoice idempotency/lineage protection on that AI path and allocate only if a distinct duplicate-receivable root is proven;
4. trace cancellation/no-show deposit/payment policy and financial disposition;
5. resolve Contact.status vs lifecycleStage vs pipelineStage vs Deal state vs tags ownership;
6. trace RevenueAttribution consumers for stage-aware vs additive treatment;
7. check whether missing receivable/cancelled financial descendants surface to J17/J18/J23 operator/recovery projections;
8. reuse J7/J18/J23 roots before new IDs and persist before broadening.
```

## KF-EXEC boundary

`KF-EXEC-EXTFX-001` remains pooled implementation-shape evidence only:

```text
PROGRAMME FRONTIER = NO
AUTHORIZED = NO
IMPLEMENTED = NO
TESTED = NO
```

> If this chat disappears, resume at **J3/J4 after F203/C153, beginning with the booking.completed AI duplicate-invoice reachability trace**. Do not implement production code.
