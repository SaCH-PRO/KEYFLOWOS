# KEYFLOWOS — Next Chat Rollover Packet

Status: LIVE CONTINUITY ARTIFACT — CURRENT
Last refreshed: 2026-09-06
Canonical intelligence branch: `docs/keyflow-intelligence-foundation`
Production implementation authorized: **NO**

> Repository continuity is the source of truth. A fresh session must continue without restarting the architecture programme.

## Fresh-chat instruction

```text
Continue KEYFLOWOS from canonical repository intelligence. Do not restart from scratch.
Load AGENTS.md, AGENT-CONTINUITY.md, 00-START-HERE.md,
04-CONCEPT-REGISTRY.md, 04A-CANONICAL-TAXONOMY-AND-NAMING-REGISTRY.md,
04B-CANONICAL-ID-ALLOCATION-LEDGER.md, 07-CURRENT-STATE.md,
CURRENT-HANDOFF.md, CURRENT-STATE.yaml and both ROLLOVER files.
Run Context Integrity Check first.
Production code remains read-only.
J7 — Financial Truth is active through F189/C139/KF-REC-052.
Resume at payment consequence completeness → CreditNote reversal → reconciliation locks → currentBalance/FX valuation.
```

## Context integrity

```text
Repository:             SaCH-PRO/KEYFLOWOS
Implementation branch:  main
Current main head:       9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76
Code-bearing baseline:  d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
Main delta class:        audit / architecture-journal only
Intelligence branch:     docs/keyflow-intelligence-foundation
Context integrity:       PASS
Implementation:          UNAUTHORIZED / READ-ONLY
```

## Canonical taxonomy

```text
Findings:        F189
Contradictions:  C139
Recommendations: KF-REC-052
Concepts:        KF-CONCEPT-042
```

Before new IDs:

```text
LOAD 04A + 04B
→ SEARCH
→ REUSE / REFINE / CROSS-REFERENCE
→ only then allocate if genuinely new
```

## Pooled fronts

- J16/K4 Business Knowledge: through F178/C128 / KF-REC-049.
- J17 Operator Attention: through F184/C134 / KF-REC-051 / 20 local proof obligations.
- J23/J18 temporal/recovery: 39 proof obligations / 16 deterministic fault points; runtime proof not executed.

## Active J7 frontier

Dossier: `docs/intelligence/journeys/KF-JOURNEY-007-FINANCIAL-TRUTH.md`
Recommendation: `KF-REC-052 — Financial Truth & Valuation Contract`

Canonical J7 roots:

```text
F185 / C135 — currentBalance competes with ledger-derived live cash
F186 / C136 — currency-tagged ledger entries aggregate without valuation/FX
F187 / C137 — PayrollRun PAID without proven disbursement/accounting consequence
F188 / C138 — direct PayPal capture can yield SUCCESSFUL Payment + PAID Invoice without payment ledger leg, then dedupe blocks webhook repair
F189 / C139 — CreditNote reversal looks up INVOICE while canonical posting uses Invoice
```

Reused root:

```text
F155 — direct provider refund may create REFUNDED Payment while ledger/invoice consequences remain incomplete; do not duplicate
```

Financial truth layers:

```text
commercial / operational document state
→ external money reality
→ KeyFlow money-movement record
→ accounting truth
→ reconciliation truth
→ valuation truth
→ derived operator/reporting projection
```

Core laws:

```text
Payment / Invoice terminal status != mandatory financial consequences complete
occurrence / Payment dedupe != descendant consequence completeness
financial source identity must be canonical, typed and stable
strong PAID / REFUNDED / SETTLED claims require declared evidence contracts
heterogeneous currencies are not directly additive without valuation
```

## Strong positive seams

- one `PostingService` ledger door;
- Decimal balanced postings;
- deterministic business-scoped posting idempotency;
- transactional Payment+posting where canonical wrapper is used;
- transactional refund Payment+reversal where canonical helper is used;
- history-preserving reversal;
- reconciliation locks;
- Invoice state recomputed from all Payment rows;
- PAID+COGS transactional coupling;
- ledger-native reporting;
- AR invoice-vs-ledger drift visibility.

## Exact next work

```text
1. verify Stripe/WiPay/manual successful-payment paths against createPaymentWithPosting;
2. trace CreditNote apply/void posting and bookkeeping;
3. characterize reconciliation-lock interaction with refund/reversal and any reopen/unlock mechanism;
4. map all FinancialAccount.currentBalance consumers to ledger/materialized-projection target;
5. trace ExchangeRate, provider currency behavior and report valuation intent;
6. pressure-test KF-REC-052 against current accounting/payment/reconciliation standards and frontier architecture;
7. backward re-audit J3/J4/J17/J18/J23 + K8/K9/K10/K11/K3;
8. reuse mature roots before allocating anything new.
```

## KF-EXEC boundary

`KF-EXEC-EXTFX-001` remains pooled implementation-shape evidence only:

```text
PROGRAMME FRONTIER = NO
AUTHORIZED = NO
IMPLEMENTED = NO
TESTED = NO
```

> If this chat disappears, resume at J7 after F189/C139. Do not implement production code.
