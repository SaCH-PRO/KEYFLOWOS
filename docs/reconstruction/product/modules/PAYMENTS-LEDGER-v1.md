# Module Contract — Payments & Ledger v1

**Status:** DRAFT FOR CHARACTERIZATION / NOT AN IMPLEMENTATION DIRECTIVE
**Source main:** `b1948d2797e1bae3660a3d7173abb75397e05aad`
**Scope:** tenant-scoped recording of payments, invoice balance reconciliation, settlement evidence, journal integrity and receipts. No live charges, refunds or payment-provider configuration.

## 1. Customer outcome
An authorized operator records an actual payment against the correct business invoice, sees the correct remaining balance on refresh, and has auditable evidence. An unverified receipt upload is not proof of bank settlement.

## 2. Current owners (verify at source main)
| Concern | Code | Initial observation |
|---|---|---|
| HTTP guards/routes | `apps/server/src/modules/commerce/commerce.controller.ts` | invoice/payment status and payment routes to enumerate |
| Payment mutation | `apps/server/src/modules/commerce/commerce.service.ts` | payment recording and invoice status paths |
| Balance transitions | `apps/server/src/modules/commerce/invoice-workflow.service.ts` | computeBalance, deriveStatusAfterPayment, reconcileFromPayments |
| Evidence extraction | `apps/server/src/modules/commerce/payment-evidence.service.ts` | extraction then recordPayment then reconcileFromPayments |
| Schema | `packages/db/prisma/schema.prisma` | exact Payment and accounting/journal models to confirm |
| Finance UI | `apps/web/src/app/app/finance/components/payment-record-modal.tsx` | user flow and retry handling to trace |
| Accounting posting | accounting/ledger services and listeners | exact owners and transaction scope OPEN |

Source blobs: commerce service `6eb4fa80391600ada4f6b9b1ec642626f19eb875`; workflow `deee0ff9cc78235131d4932c99e35e21f80641f2`; evidence service `40da18c6c74461e0f42a2e21d3b306b869107459`.

## 3. Domain / endpoint contract
Trace all actual POST/GET/status routes, DTOs and guards; preserve existing API contracts. Separate (a) manual record, (b) verified settlement, (c) evidence extraction, (d) accounting posting and (e) invoice status derivation. `computeBalance` clamps remaining to zero and exposes overpayment; assess exactly which payment states count, currency treatment, refund/reversal behavior and rounding. Evidence service's sequential recording then reconciliation is not proof of atomicity.

## 4. UI contract
The payment-recording dialog validates amount, currency, method and reference; it displays server-confirmed payment and balance after reload. Pending, failed and unverified states must not appear as collected cash. Do not require a gateway for manual record.

## 5. Invariants and failure rules
- Business and actor authorization precedes any payment or invoice lookup; bare invoice ID is not sufficient.
- Amount positive, precision-safe and denominated/converted under explicit policy.
- Duplicate manual submits and provider events must not double-credit or double-post journals.
- Invoice status derives only from eligible payment rows; refunds, reversals and chargebacks have explicit compensating behavior.
- Payment write, invoice reconciliation and journal posting have documented and tested failure semantics; no silent partial state.
- Ledger debits and credits balance, with traceable source IDs and audit history.
- Receipt/evidence attachment is untrusted input, not automatically settlement.
- No external network charge/refund/webhook or production financial mutation is in scope.

## 6. Pilot proof matrix
| ID | Required proof |
|---|---|
| PL-P01 | Authorized manual payment persists and appears after fresh DB read |
| PL-P02 | Other tenant or insufficient-scope actor cannot list, post or view payment |
| PL-P03 | Duplicate submit/webhook replay does not double-credit |
| PL-P04 | Partial/full payment recalculates correct remaining and status |
| PL-P05 | Pending/failed/refund/reversal rows handled correctly |
| PL-P06 | Overpayment explicitly surfaced, not silently hidden |
| PL-P07 | Currency, rounding, decimal precision correctly handled |
| PL-P08 | Balanced journal posting and failure injection prove atomicity policy |
| PL-P09 | Receipt evidence matches authorized actual payment record |
| PL-P10 | Crash/retry between write/reconcile does not leave unexplained state |

## 7. Characterization and return
Produce a gap ledger anchored to `b1948d2797e1bae3660a3d7173abb75397e05aad` with route/guard tracing, model field/precision evidence, service transaction boundaries, negative-control proposals and risk ranking. Mark unknowns OPEN; mock-only tests are insufficient to prove money conservation. No implementation, migration, payments execution, merge or issue #80 event authorized.
