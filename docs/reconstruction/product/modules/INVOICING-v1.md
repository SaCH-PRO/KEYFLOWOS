# Module Contract — Invoicing v1

**Status:** DRAFT FOR CHARACTERIZATION / NOT AN IMPLEMENTATION DIRECTIVE
**Source main:** `b1948d2797e1bae3660a3d7173abb75397e05aad`
**Scope:** authenticated, tenant-scoped invoice create/list/detail, contact association, invoice status and receipt; characterize existing implementation, do not rewrite.

## 1. Customer outcome
An authorized user can create an accurate invoice for their business, reload it, inspect its balance and use existing delivery/receipt surfaces. Basic invoicing must work without AI, messaging or gateway credentials.

## 2. Current owners (verify at source main)
| Concern | Code | Initial observation |
|---|---|---|
| API and guards | `apps/server/src/modules/commerce/commerce.controller.ts` | list around line 411; primary create around 469; receipt around 510; detail after 518; status around 354 |
| Persistence | `apps/server/src/modules/commerce/commerce.service.ts` | createInvoice around 177; listInvoices around 246; getInvoiceWithBusiness around 389 |
| Status/reconciliation | `apps/server/src/modules/commerce/invoice-workflow.service.ts` | permitted transitions, payment-derived balance |
| Schema | `packages/db/prisma/schema.prisma` | Invoice, InvoiceItem, Contact, Payment; exact constraints OPEN |
| UI | `apps/web/src/app/app/finance/revenue/page.tsx` and finance components | current revenue workflow; inspect client requests |
| Tests | commerce/invoice tests and HTTP/integration suites | determine real database coverage |

Source blobs: controller `6ae7cb93082846f05004499bfa1da7acda355e9a`; service `6eb4fa80391600ada4f6b9b1ec642626f19eb875`; workflow `deee0ff9cc78235131d4932c99e35e21f80641f2`. Route prefix, schemas, line ranges and behavior require exact verification.

## 3. Domain and HTTP contract
Trace actual controller prefix and guards for list, create, detail, status, receipt, quote conversion, recurring, send and time-entry invoicing. Preserve existing request/response envelopes. Model totals, taxes, discounts, currency and item rounding from real Prisma and service code. `createInvoice` uses a timestamp-based fallback invoice number; concurrency/uniqueness is an OPEN question. Invoice workflow encodes DRAFT, SENT, PENDING, PARTIALLY_PAID, PAID, OVERDUE, FAILED, VOID; prove actual transitions.

## 4. UI contract
Use existing finance/revenue surfaces for create, list, detail, refresh, validated errors and payment/balance display. Do not show success until database state is confirmed; preserve current keyboard/navigation behavior where applicable.

## 5. Invariants and failure rules
- Tenant and actor authorization enforced on *all* reads/writes, including bare invoice-ID routes, attachments, receipts and messages.
- Customer/contact and quote association must belong to the invoice business; guessed identifiers do not confer permission.
- Line items, taxes, discounts, currency, totals and decimals must reconcile with persisted state.
- Invalid status transitions fail; payments, not superficial labels, determine paid state.
- Repeat create/conversion/send must have explicit duplicate and idempotency behavior.
- Numbering, post-send edits, credits, void and soft-delete policies are decision gates, not presumed implementation.
- Audit, receipt and email claims reflect persisted data and actual delivery state.
- No external provider should be necessary for basic draft/create/list/detail.

## 6. Pilot proof matrix
| ID | Required proof |
|---|---|
| IV-P01 | Owner creates invoice; real DB reload matches ID and total |
| IV-P02 | Correct tenant contact/quote linkage; cross-tenant IDs denied |
| IV-P03 | Invoice list, detail, receipt and email respect actor scopes |
| IV-P04 | Invalid values/rounding/tax/currency fail with no partial writes |
| IV-P05 | Concurrent numbering and duplicate submission tested |
| IV-P06 | Legal status transitions proven; invalid transitions denied |
| IV-P07 | Partial/full payments produce correct statuses and remaining balance |
| IV-P08 | Customer-visible document matches persisted invoice and amount |
| IV-P09 | Replayed requests do not create silent duplicate financial documents |
| IV-P10 | Browser refresh and no-provider configuration preserve core behavior |

## 7. Characterization and return
Produce read-only gap ledger with exact source blob/line anchors, confirmed behavior vs hypotheses, missing negative controls, risk, minimum possible later implementation scope. Do not modify code, schema, tests, PRs, worker states or issue #80. No release or programme credit.
