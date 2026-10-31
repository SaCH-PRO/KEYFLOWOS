# Invoicing and Payments gap report 001

```yaml
document_id: CC-GAP-TRACK-C-REVENUE-001
in_reply_to: CG-AUTH-TRACK-C-REVENUE-GAP-001   # relayed in session; not a #80 event
kind: READ_ONLY_GAP_ANALYSIS
executor: cloud Claude session
code_anchor_main: b1948d2797e1bae3660a3d7173abb75397e05aad
spec_branch: docs/keyflow-reconstruction-20261029
spec_head: 1b143fa35298cb19640848d092533a789f168ce7
specs_read: [INVOICING-v1.md, PAYMENTS-LEDGER-v1.md]
mutations: none   # no code, commit, branch, PR, worker state, payment execution, production access, #80 message
status: SUBMITTED_FOR_INDEPENDENT_CHATGPT_REVIEW
```

Every line number is at `main` `b1948d2797`. Blob SHAs cited by the specs were verified: controller `6ae7cb93`, service `6eb4fa80`, workflow `deee0ff9`, evidence service `40da18c6` all match. **CONFIRMED** means read directly in the code on this revision. **HYPOTHESIS** means a runtime behaviour inferred but not executed. Nothing here was run against a database.

## 1. Summary

The money core is better structured than the specs assume: there is a single state machine, a pure balance function with rounding, a ledger posting service with an idempotency key, and payment-plus-posting in one transaction on the manual path. The gaps are around it, not in it.

Seventeen gaps are confirmed. The five that matter most:

1. **An invoice can be set PAID with no money recorded**, by any member of the business, through the generic status route. The handler reads the status from the URL, not from the validated body, so `paid` reaches the state machine, which permits SENT to PAID. (G1)
2. **Mark-paid fabricates a full-total SUCCESSFUL payment with no ledger entry**, and only when the invoice has zero payment rows; with a prior partial payment the invoice goes PAID while the ledger and balance say otherwise, and the next reconcile flips it back. (G2)
3. **Recording a payment against a DRAFT invoice commits the payment row and its ledger entries, then throws**, because DRAFT to PARTIALLY_PAID is illegal. Money is on the books against an invoice that still says DRAFT. (G3)
4. **Three status-mutating routes have no module scope and never bind the guard's tenant to the invoice.** Cross-tenant is stopped only by a second membership lookup inside the service; within-tenant, a member with no revenue scope can mark paid, mark failed, send, void. (G4)
5. **The unauthenticated invoice route and the unauthenticated payment-status route return every payment row**, including references, notes, evidence URLs and who recorded them, plus the customer's email, to anyone holding an invoice id. (G5)

No existing test creates an invoice or a payment in a real database. Every invoicing and payment test is a mock, an in-memory ledger harness, or a pure-function test. Nothing in the repository today proves money conservation end to end.

## 2. Spec anchor verification

| Spec claim | Verified at main |
|---|---|
| INVOICING §2 controller lines: list 411, create 469, receipt 510, detail 518, status 354 | all correct (409-422, 464-485, 509-516, 518-521, 353-369) |
| INVOICING §2 service lines: createInvoice 177, listInvoices 246, getInvoiceWithBusiness 389 | all correct |
| PAYMENTS §2 `computeBalance`, `deriveStatusAfterPayment`, `reconcileFromPayments` in the workflow service | correct: 70-96, 102-111, 196-250 |
| PAYMENTS §2 evidence service "extraction then recordPayment then reconcileFromPayments" | correct: 166-176; the second reconcile is redundant because `recordPayment` already reconciles at 1416 |
| PAYMENTS §2 `payment-record-modal.tsx` path | exists, 415 lines |
| INVOICING §2 UI `apps/web/src/app/app/finance/revenue/page.tsx` | a 6-line re-export of `app/commerce/page`; the real surface is `app/commerce/invoices/invoices-panel.tsx` and `finance/components/payment-record-modal.tsx` |
| INVOICING §3 "`createInvoice` uses a timestamp-based fallback invoice number" | correct, 189; also the only numbering in `convertQuoteToInvoice`, 1291 |
| INVOICING §3 status set of eight | the workflow handles eight (14-22); the Prisma enum has eleven (`schema.prisma` 11-23: adds FULLY_CREDITED, PARTIALLY_CREDITED, PARTIAL). The three credit-note statuses are outside the state machine. OPEN |
| PAYMENTS §2 "exact Payment model to confirm" | `Payment.amount Float`, `status String` with comment "PENDING, SUCCESSFUL, FAILED" but code uses REFUNDED; `providerPaymentId @unique` is the only dedup key |
| PAYMENTS §2 "accounting posting owners OPEN" | `finance/revenue-posting.service.ts` (AR/Revenue on SENT, deposit on payment, reversal on refund, 105-389), `finance/posting.service.ts` (journal write, dedup by `businessId + externalRef`, 118-129), `finance/expense-posting.service.ts` (COGS on PAID via the workflow, 136-165) |

**Owners the specs miss:** `modules/payments/payments.controller.ts` (public gateway and status routes, `@Controller('payments')` with class-level rate-limit guard), `modules/webhooks/webhooks.controller.ts` (legacy Stripe webhook that calls mark-paid), `commerce/invoice-receipt-builder.service.ts`, `commerce/invoice-overdue.scheduler.ts`, `commerce/recurring-invoice.service.ts`, `modules/ai/undo.service.ts` (calls `undoInvoice`), `modules/ai/flow-orchestrator.service.ts` (KEY tools call mark-paid and status), the public pay page `apps/web/src/app/pay/[invoiceId]/page.tsx`.

## 3. Route and guard matrix

Prefix `/commerce` unless stated. "Scope" is `@RequireModuleScope('revenue', …)`. "Tenant bound" means the service query includes the guard's `businessId`.

| Route | Guards | Scope | Tenant bound in service | Note |
|---|---|---|---|---|
| `GET businesses/:b/invoices` 411 | Auth, Business, Scope | read | yes (`listInvoices` 249) | |
| `POST businesses/:b/invoices` 469 | Auth, Business, Scope, PlanLimit | write | yes | body untyped, see G9 |
| `GET invoices/:id` 518 | **none** | | no | public by design; see G5 |
| `GET invoices/:id/receipt` 510 | Auth, Business | **none** | **no** (`buildReceipt` 8-31) | G7 |
| `PATCH invoices/:id/paid` 333 | Auth, Business | **none** | membership only (470-487) | G2, G4 |
| `PATCH invoices/:id/payment-failed` 343 | Auth, Business | **none** | membership only (553-560) | G4 |
| `PATCH invoices/:id/status/:status` 354 | Auth, Business | **none** | membership only (740-758) | G1, G4 |
| `PATCH businesses/:b/invoices/:id` 555 | Auth, Business, Scope | write | yes (1903) | G11 |
| `DELETE businesses/:b/invoices/:id` 545 | Auth, Business, Scope | write | yes (344) | G17 |
| `PATCH businesses/:b/invoices/bulk` 525 | Auth, Business, Scope | write | yes | G17 |
| `POST businesses/:b/quotes/:q/convert` 734 | Auth, Business, Scope | write | yes (1260) | |
| `GET businesses/:b/invoices/:id/payments` 1197 | Auth, Business, Scope | read | yes (1867) | |
| `POST businesses/:b/invoices/:id/payments` 1207 | Auth, Business, Scope | write | yes (1360) | G3, G8, G9 |
| `POST …/payments/from-evidence` 1225 | Auth, Business, Scope | write | yes via recordPayment | G14 |
| `POST businesses/:b/payments/:p/refund` 1371 | Auth, Business, Scope | write | yes (1510) | G12 |
| `POST businesses/:b/payments/:p/retry` 1382 | Auth, Business, Scope | write | yes (1538) | |
| `POST invoices/:id/payment-intent` 1439 | PublicRateLimit 10/min | | public | G6 |
| `GET public/invoice-link/:token` 1159 | PublicRateLimit 60/min | | token | preferred public path |
| `GET /payments/invoice/:id/status` (payments.controller 62-66) | class guard, **no limit decorator → guard returns true** (`public-rate-limit.guard.ts` 27) | | public | G5 |
| `GET /payments/invoice/:id/gateways` 18-26 | 20/min | | public | discloses only gateway config |
| `POST /webhooks/stripe` (legacy, webhooks.controller 50-103) | Stripe signature | | none in service | G2 path, see G15 |

## 4. Gap ledger, ranked

### G1. PAID with no money, via the path parameter. CONFIRMED. HIGH.

- `commerce.controller.ts` 353-369: `updateInvoiceStatus` is decorated with `UpdateInvoiceStatusDto` (whose `status` is validated `IsIn(['SENT','OVERDUE','VOID'])`, `dto/update-invoice-status.dto.ts` 4-5) but the handler passes `status.toUpperCase()` **from the URL** (362) to the service and never reads `body.status`.
- `commerce.service.ts` 716-793 `updateInvoiceStatus` types the parameter as the three-value union but performs no runtime check, and calls `invoiceWorkflow.transition(id, status)` (763).
- `invoice-workflow.service.ts` 29-42: SENT, PENDING, OVERDUE and FAILED all permit PAID. `transition` 257-348 sets `paidAt`, posts COGS (316-322) and emits `invoice.paid` (323-327). No payment row is created, so `computeBalance` reports unpaid and the AR posted at SENT is never cleared.
- Reachable states from the URL also include `partially_paid`, `pending`, `failed`, `draft` (illegal from most states, 409) and anything else (409 from `assertLegalTransition`).
- **Risk:** any member of the business (G4) marks an invoice paid with no money; downstream listeners (`flow.listener.ts` 80/292/451, `project-revenue.listener.ts` 36, `crm-network.service.ts` 396, `automation-executor.service.ts` 650) act on a false `invoice.paid`; accrual AR stays open.
- **Missing proof:** IV-P06 negative control `PATCH …/status/paid` with body `{status:'SENT'}` expecting 400.
- **Smallest correction:** in the controller use the validated `body.status`, or validate the path value against the same set before the cast; pass `businessId` to the service (G4).

### G2. Mark-paid fabricates a SUCCESSFUL payment with no ledger entry. CONFIRMED. HIGH.

- `commerce.service.ts` 459-543 `markInvoicePaid`: after `transition(id,'PAID')` (500), it counts payments (505-507) and, **only when there are none**, creates a `Payment` for `existingInvoice.total` with `provider: 'manual'`, `status: 'SUCCESSFUL'` (509-520) by direct `payment.create`, **not** through `revenuePosting.onPaymentRecorded`. Compare `recordPayment` 1387-1412, which posts inside the same transaction and documents the invariant "every SUCCESSFUL payment has a matching ledger transaction".
- With one or more prior payments, no balancing row is created: the invoice is PAID while `computeBalance` says `net < total`; the next `reconcileFromPayments` (any later payment, refund, or evidence) derives PARTIALLY_PAID, which PAID permits (39), and flips it back.
- Callers: the route at 333, the KEY tool (`flow-orchestrator.service.ts` 3331, 4340, with tenant), `updateInvoice` with `status:'PAID'` (1923), and the legacy Stripe webhook (G15).
- **Risk:** cash recorded with no deposit entry; AR never cleared on accrual; revenue never recognised on cash basis; paid state unstable.
- **Missing proof:** PL-P08 after mark-paid, assert a `FinancialTransaction` with `externalRef = Payment:<id>:payment_recorded` exists; PL-P04 mark-paid after a partial payment then any reconcile.
- **Smallest correction:** replace the synthetic create with `recordPayment(invoiceId, businessId, { amount: remaining, method: 'MANUAL' })` for the remaining balance, inside the transaction, and let `reconcileFromPayments` set PAID; or make mark-paid require an explicit payment first.

### G3. Payment against a DRAFT invoice commits money, then throws. CONFIRMED. HIGH.

- `recordPayment` 1360-1369 rejects only PAID and VOID. DRAFT passes.
- 1387-1412: payment row and deposit posting commit in one `$transaction`.
- 1416: `reconcileFromPayments` derives PARTIALLY_PAID or PAID; `assertLegalTransition('DRAFT', …)` throws 409 (workflow 30, 216) **after the commit**.
- **Observed effect:** SUCCESSFUL payment and ledger entries exist for an invoice that remains DRAFT; the client receives an error; the UI shows nothing recorded. Also reachable through `from-evidence` and the KEY payment tools.
- **Missing proof:** PL-P10 with a DRAFT invoice; assert no payment row after the error, or a defined state.
- **Smallest correction:** reject DRAFT before the transaction (allowed: SENT, PENDING, PARTIALLY_PAID, OVERDUE, FAILED), or move the reconcile inside the transaction so the 409 rolls the row back.

### G4. Bare-id status routes: no scope, tenant not bound. CONFIRMED. HIGH.

- Routes 332-369 use `AuthGuard, BusinessGuard` only. `BusinessGuard` (`business.guard.ts` 22) reads `businessId` from params, then body, then query; these routes have no `businessId` param, so the caller chooses it. The handlers read `@Body('businessId')` and **drop it** (339, 350, 362-368): `markInvoicePaid(invoiceId, actor)` and `updateInvoiceStatus({... no businessId})`, although both methods accept and would enforce it (468-472, 737-741, with comments explaining exactly this hazard).
- Cross-tenant is prevented only by the membership lookup against the invoice's own business (480-487, 553-560, 751-758). That check exists, so cross-tenant mutation is **not** open today; it is one line from open.
- Within tenant: no `ModuleScopeGuard`, so a STAFF member whose scope map has `revenue: 'none'` or `'read'` can mark paid, mark failed, send, void. Every other write on this controller carries `revenue: write`.
- `invoice-status-contract.spec.ts` 36-54 documents the body-supplied tenant as the intended contract.
- **Missing proof:** IV-P03 negative controls: read-only member on each of the three routes expecting 403; member of business B passing `businessId: B` with an invoice of A expecting 404 (today 403-equivalent via "Not authorized"; the test should pin it).
- **Smallest correction:** add `ModuleScopeGuard` + `RequireModuleScope('revenue','write')` to the three routes and forward `businessId` to the service calls. No service change needed.

### G5. Unauthenticated routes disclose payment rows and customer email. CONFIRMED. MEDIUM-HIGH.

- `GET /commerce/invoices/:id` 518-521 has no guard. `getInvoiceWithBusiness(id, true)` 389-446 returns `contact.email`, all `items`, **all `payments`** (every column: `reference`, `notes`, `evidenceUrl`, `evidenceMimeType`, `recordedBy`, `providerPaymentId`) and the business profile, gated only on status in SENT/PAID/OVERDUE/PARTIALLY_PAID (432-437). The public pay page depends on it (`pay/[invoiceId]/page.tsx` 189, 218, 240, 255).
- `GET /payments/invoice/:id/status` (`payments.controller.ts` 62-66) returns `payment.findMany({ where: { invoiceId } })` raw (`payments.service.ts` 953-958). The method has no `@PublicRateLimit`, and the guard returns `true` when no options are set (`public-rate-limit.guard.ts` 26-27): public and unthrottled.
- Invoice ids are cuids, not guessable at scale, but they appear in emails, payment URLs and browser history, and the route is unthrottled.
- **Risk:** customer PII and signed evidence URLs to anyone with a link; a competitor with one invoice id enumerates nothing, but a customer with their own id sees internal notes and the operator's identity.
- **Missing proof:** IV-P03 / PL-P02: unauthenticated GET on both routes asserting no `payments[].notes|evidenceUrl|recordedBy` and no `contact.email`.
- **Smallest correction:** a public projection for both routes (invoice number, total, currency, status, paid, remaining, items; no payment rows, no email), and `@PublicRateLimit` on the status route. Longer term, retire id-based public access in favour of `public/invoice-link/:token`.

### G6. Public payment-intent writes rows and status outside the state machine. CONFIRMED. MEDIUM.

- `recordPublicPaymentIntent` 2115-2154: public (10/min per IP, 1437-1438). Creates a PENDING payment with any `amount >= 0` the caller sends (2133-2143), then for `bank_transfer` or `cash` sets `invoice.status = 'PENDING'` by direct `invoice.update` (2145-2150), bypassing `transition`. The only status check is `!== 'PAID'` (2129).
- **Observed effects:** VOID → PENDING and DRAFT → PENDING are reachable (both illegal in the workflow, 30 and 41); unbounded PENDING rows per invoice; PENDING rows are shown by `listPayments` 1866 and by G5's public routes; `providerPaymentId` is `manual_<invoiceId>_<ms>` so two intents in one millisecond fail on the unique index with a 500.
- `computeBalance` ignores PENDING (82-83), so money totals are unaffected.
- **Missing proof:** PL-P05: intent on a VOID invoice expecting 400; two intents expecting one PENDING row or an explicit policy.
- **Smallest correction:** route the status change through `transition(id,'PENDING')`; allow intents only from SENT/OVERDUE/PENDING; one open intent per invoice; ignore or cap `amount` to `remaining`.

### G7. Receipt route is cross-tenant readable. CONFIRMED. MEDIUM.

- 509-516: `AuthGuard, BusinessGuard` with `businessId` from the **query string**, then `receipts.buildReceipt(invoiceId)`; `invoice-receipt-builder.service.ts` 8-31 looks up by id alone and returns contact name and email, items, totals, business name.
- Any authenticated member of any business reads any invoice's receipt by supplying their own `businessId` in the query.
- Both public booking confirmations (`book/[slug]/components/order-confirmation.tsx` 490, `public/book/page.tsx` 165) open this URL **without** a `businessId` and without a session, so for the public customer it fails on `AuthGuard`; the route serves neither audience correctly.
- **Smallest correction:** `buildReceipt(invoiceId, businessId)` with `findFirst({ id, businessId })`; a separate token-based public receipt for customers.

### G8. No idempotency on manual payment recording. CONFIRMED. MEDIUM.

- 1395: `providerPaymentId` is `manual_<ms>_<random6>`; nothing derives it from the request. Two submits create two SUCCESSFUL rows, each posted to the ledger (the posting key is per payment id, `revenue-posting.service.ts` 328-330, so dedup cannot help).
- UI: `payment-record-modal.tsx` 181 disables the button on `loading || !amount` only; a retried request after a timeout is a second payment.
- Provider webhooks do have dedup (`assertNewProviderEvent` 356-385, `webhookEvent` unique); the manual path has none.
- **Missing proof:** PL-P03 manual double submit.
- **Smallest correction:** client sends an idempotency key; server sets `providerPaymentId = manual_<invoiceId>_<key>`; the existing unique index turns the replay into a P2002 that is mapped to "already recorded".

### G9. Invoice arithmetic trusts the client and is unvalidated. CONFIRMED. MEDIUM.

- Controller 469-485 declares an inline body type (no class), so the global `ValidationPipe({ whitelist, transform })` (`app-bootstrap.ts` 28-31) has no metatype and **validates and strips nothing**. The handler spreads `{ ...body, businessId }` (484).
- Service 177-244 accepts `subtotal`, `taxAmount`, `total` and per-item `total` as **overrides** (`input.subtotal ?? calculated`, 193; `input.taxAmount ?? …`, 196; `input.total ?? …`, 203; `item.total ?? …`, 225). A client can therefore post items summing to 1,000 and `total: 1`. Neither the inline type nor the UI sends these today; the API accepts them.
- No validation of `quantity` (Int, may be 0 or negative), `unitPrice` (may be negative or NaN), empty `items`, or `currency` (free string). FIXED discount larger than subtotal yields a negative total (203). `validateTaxAndDiscount` 161-175 checks only tax 0-100 and non-negative discount.
- No rounding on write: `roundMoney` (workflow 45-50) is applied only in `computeBalance`; stored `Float` columns carry raw binary sums.
- Same shape in `convertQuoteToInvoice` 1274-1284 (no override inputs there) and `updateInvoice` 1945-1992.
- **Missing proof:** IV-P04: negative or NaN unit price, total override, discount > subtotal, each expecting 400 and no row.
- **Smallest correction:** a `CreateInvoiceDto` with class-validator (positive quantity, finite non-negative price, non-empty items, ISO currency), drop the override inputs from the HTTP path (keep them only for the internal `createInvoiceForService` caller if needed), round at write.

### G10. Invoice numbering collides and is unretried. CONFIRMED. MEDIUM.

- 189 and 1291: `INV-${Date.now()}` under `@@unique([businessId, invoiceNumber])` (`schema.prisma`). Two creations in the same millisecond for one business raise P2002, which is not caught: a 500 with no retry and no user-readable message.
- The service accepts a client `invoiceNumber` (178-190) with no format or uniqueness pre-check (same P2002 path).
- Duplicate submission of the same create request produces two invoices (no idempotency, as G8).
- **Missing proof:** IV-P05: concurrent create; IV-P09: replayed create.
- **Smallest correction:** per-business sequence (a `nextInvoiceNumber` counter updated in the same transaction) or retry-on-P2002 with a suffix; request idempotency key.

### G11. SENT invoices are editable without ledger adjustment. CONFIRMED. MEDIUM.

- `updateInvoice` 1890-2000 blocks edits only for PAID and PARTIALLY_PAID (1910-1912). SENT and OVERDUE invoices, whose AR and revenue were posted by `onInvoiceFinalized` at the SENT transition (workflow 304-309), can have items and `total` replaced (1945-1996) with **no call** to any posting service.
- `deleteInvoice` 343-364 and the bulk `delete` 263-272 soft-delete SENT and OVERDUE invoices without voiding the posting (`onInvoiceVoided` is called only by `transition(…,'VOID')`, 309).
- `undoInvoice` 366-387 reverts any non-DRAFT status (including PAID) to DRAFT by direct update, bypassing the workflow and leaving postings and payment rows in place. Caller: `ai/undo.service.ts` 172.
- **Risk:** accrual ledger diverges from invoice totals on every post-send edit or delete.
- **Missing proof:** PL-P08: edit a SENT invoice's total, assert ledger AR equals the new total or the edit is refused.
- **Smallest correction:** refuse item/total edits once SENT (require VOID then re-issue), make delete of SENT/OVERDUE go through VOID, and confine `undoInvoice` to DRAFT.

### G12. Refund reconcile failure is swallowed. CONFIRMED. LOW-MEDIUM.

- `markPaymentRefunded` 1509-1535: status flip and reversal posting commit together (1516-1529), then `reconcileFromPayments(...).catch(() => null)` (1531). If the reconcile throws, the invoice keeps its old status with no signal to the caller.
- No status precondition: refunding a REFUNDED or PENDING payment flips nothing harmful (reversal is idempotent on `REVERSED`, `revenue-posting.service.ts` 371-373) but appends "Refunded:" to notes each time.
- **Smallest correction:** let the reconcile error surface, and refuse refund unless `status === 'SUCCESSFUL'`.

### G13. Precision and currency policy are undefined. CONFIRMED (design). LOW-MEDIUM.

- `Invoice.subtotal/taxAmount/discountAmount/total`, `InvoiceItem.unitPrice/total`, `Payment.amount/processorFee` are all `Float`. `computeBalance` rounds to two decimals and tolerates half a cent (87-95); `roundMoney` ignores its `currency` argument (45-50), so zero-decimal currencies are unsupported, as its comment says.
- `isFullyPaid` requires `totalRounded > 0` (88): a zero-total invoice can never become PAID through payments.
- `recordPayment` forces `currency: invoice.currency` (1392) and ignores any client currency; the modal shows but does not send one. No conversion path exists.
- **Decision gate, not a defect:** PL-P07 needs a stated policy (store minor units as integers, or `Decimal(12,2)`), and a list of supported currencies.

### G14. Evidence extraction creates settled money from an untrusted document. CONFIRMED (design). MEDIUM.

- `payment-evidence.service.ts` 166-176: the AI-extracted `amount` goes straight into `recordPayment`, which writes `status: 'SUCCESSFUL'` and posts to the ledger. The spec's invariant "receipt evidence is untrusted input, not settlement" is not what the code does.
- The second `reconcileFromPayments` at 176 is redundant (`recordPayment` reconciles at 1416).
- **Smallest correction:** record evidence-derived payments as PENDING with the extracted amount prefilled for operator confirmation, which then calls the manual path.

### G15. Legacy Stripe webhook marks paid from the invoice total, with no posting. CONFIRMED. LOW.

- `webhooks.controller.ts` 50-103: signature-verified, so not an open path, but on `checkout.session.completed` it calls `markInvoicePaid(invoiceId)` with no actor and no tenant (86), which bypasses both checks in 468-487 by design of that method, and inherits G2: the recorded amount is `invoice.total`, not the session amount, with no ledger entry and no `assertNewProviderEvent` dedup. The handler itself logs that it is deprecated in favour of `/payments/stripe/webhook`, whose service posts correctly (`payments.service.ts` 47-62).
- **Smallest correction:** retire the route or delegate to `PaymentsService`.

### G16. Guard tenant and service tenant are decoupled on bare-id routes. CONFIRMED. LOW (hardening).

- Same facts as G4, stated as the structural point: `BusinessGuard` proves "the caller belongs to some business X"; the service then independently proves "the caller belongs to the invoice's business Y". Nothing asserts X = Y. Today it is safe because the second proof exists; a future caller that passes `actorId: null` (the webhook already does) gets no proof at all.

### G17. Delete paths skip the ledger. CONFIRMED. MEDIUM.

Listed under G11; separated because the fix is distinct: `deleteInvoice` 343-364 and bulk delete 263-272 should refuse SENT/OVERDUE or void first.

## 5. Where the existing code is already right

Stating these so the implementation packet does not re-do them.

- One state machine (`ALLOWED_TRANSITIONS` 29-42), enforced by `transition` and `reconcileFromPayments`; PAID to SENT and VOID to anything are refused.
- `computeBalance` 70-96 is pure, rounds, ignores PENDING and FAILED, treats refunds by absolute value, clamps `remaining` at zero and flags `isOverpaid`. PL-P06 is satisfied at the function level and surfaced by `recordPayment` (1377-1378) and the modal (70-71).
- Manual payment: row and deposit posting in one transaction (1387-1412); refund: flip and reversal in one transaction (1516-1529); SENT and VOID: status and AR posting in one transaction (`transition` 257-312); PAID and COGS in one transaction (`reconcileFromPayments` 222-240).
- Ledger idempotency by `businessId + externalRef` with a P2002 race fallback (`posting.service.ts` 118-129, 218-225); refund reversal is idempotent on `REVERSED`.
- Provider webhooks dedup by `(provider, providerEventId)` (workflow 356-385) and the Stripe and PayPal paths are tested for replay (`payments-webhooks.service.test.ts` 144-176, 426).
- Tenant-bound queries on every `businesses/:b/…` invoice and payment route.
- Quote conversion is transactional and guarded by `quoteId @unique` and the `ACCEPTED` precondition (1251-1349).

## 6. Test evidence

| File | What it exercises | Database |
|---|---|---|
| `test/commerce.service.test.ts` | 4 cases, mocked Prisma, mocked workflow | none |
| `test/finance-revenue-flow.e2e.test.ts` | FIN2 recipes against an in-memory ledger harness (`makeHarness`, 30-110) | none |
| `test/payments-webhooks.service.test.ts` | Stripe and PayPal webhook handling, dedup, refunds; mocked | none |
| `src/modules/finance/posting.service.integration.spec.ts` | dedup, P2002 race, rollback; "stub Prisma at the `$transaction` boundary … no DB required" (header) | none |
| `src/modules/commerce/invoice-workflow.service.spec.ts` | `computeBalance`, `deriveStatusAfterPayment`, `isLegalTransition` as pure functions | none |
| `src/modules/commerce/invoice-status-contract.spec.ts` | DTO shape and the body-supplied tenant contract | none |
| `test/*.integration.test.ts` | none creates an invoice or a payment | |

**No test on this revision proves, against a real database, that creating an invoice, recording a payment, refunding, or marking paid leaves the invoice, the payment rows and the ledger in agreement.** The CI test job provisions pgvector Postgres and runs the integration suite, so the harness exists; the tests do not.

## 7. Proof matrix disposition

| ID | Status at main | What is needed |
|---|---|---|
| IV-P01 create and reload | NOT_PROVED | real-DB create then read; blocked by nothing |
| IV-P02 tenant linkage | PARTIAL | `contactId` is not checked against the business at create (177-244: `data.contactId = input.contactId` with no lookup); cross-tenant contact attach is possible. Add to G9's DTO fix |
| IV-P03 actor scopes on list/detail/receipt/email | FAIL by reading | G4, G5, G7 |
| IV-P04 invalid values, no partial writes | FAIL by reading | G9 |
| IV-P05 concurrent numbering | FAIL by reading | G10 |
| IV-P06 transitions | PARTIAL | state machine is right (pure tests exist); G1 bypasses the DTO |
| IV-P07 partial and full payments | PARTIAL | `computeBalance` right; G2 and G3 break it at the edges |
| IV-P08 customer document matches persisted | NOT_PROVED | needs the public projection (G5) first |
| IV-P09 replay creates no duplicates | FAIL by reading | G8, G10 |
| IV-P10 refresh, no provider | PLAUSIBLE | manual path needs no provider; untested |
| PL-P01 manual payment persists | PLAUSIBLE | untested on a real DB |
| PL-P02 other tenant or scope cannot list/post/view | FAIL by reading | G5 (view), G7; post is tenant-bound |
| PL-P03 duplicate submit / replay | FAIL (manual) / PASS (webhook, mocked) | G8 |
| PL-P04 partial and full recalculation | PARTIAL | G2 |
| PL-P05 pending/failed/refund/reversal | PARTIAL | balance logic right; G6, G12 |
| PL-P06 overpayment surfaced | PASS by reading | 1377-1378, modal 70 |
| PL-P07 currency and precision | OPEN | G13 decision |
| PL-P08 balanced posting and failure injection | PARTIAL | transactions exist; G2, G11, G17 leave the ledger unbalanced; no real-DB failure-injection test |
| PL-P09 evidence matches authorised record | FAIL by design | G14 |
| PL-P10 crash between write and reconcile | FAIL by reading | G3 (reconcile outside the transaction), G12 |

## 8. Suggested packet boundaries

Ordered so that each packet is small, independently provable on a real database, and does not depend on the precision decision.

1. **Authorization and projection** (G1, G4, G5, G7, G16): controller only, plus `invoice-receipt-builder.service.ts` and a public projection in `getInvoiceWithBusiness`; add `@PublicRateLimit` to the status route. Tests: the route and scope matrix, real DB, same pattern as `contacts-visibility.integration.test.ts`.
2. **Money consistency** (G2, G3, G12, G17, G11-delete): `commerce.service.ts` only. Tests: mark-paid posts; payment on DRAFT refused; refund reconcile surfaces; delete of SENT refused.
3. **Input and idempotency** (G8, G9, G10, IV-P02): a `CreateInvoiceDto` and `RecordPaymentDto`, idempotency keys, numbering sequence. Tests: validation matrix, concurrent create, double submit.
4. **Public intent** (G6) and **evidence as pending** (G14): separate because each changes a product behaviour and needs a decision in the ledger.
5. **Precision and currency** (G13): decision first, migration after.

Out of this report's scope: quote routes (`GET quotes/:quoteId` 644 is unguarded in the same way as G5), recurring invoices, credit notes, provider checkout flows, bank reconciliation.

## 9. Open questions for the decision ledger

1. Is mark-paid without a payment row a product feature (an operator asserting settlement) or a defect? The ledger needs a row either way (G2).
2. Should a customer be able to assert a payment intent on a public page at all, and if so from which statuses (G6)?
3. Precision: integer minor units, `Decimal`, or keep `Float` with write-time rounding (G13)?
4. Post-send edits: forbid, or void-and-reissue (G11)?
5. Evidence-derived payments: PENDING until confirmed, or SUCCESSFUL as today (G14)?
6. The eleven-value `InvoiceStatus` enum versus the eight-value workflow: who owns the credit-note statuses?

## 10. What was not checked

Runtime behaviour of any route; gateway flows (Stripe, PayPal, WiPay) beyond their dedup; recurring invoices; credit notes; the KEY tools that call these services beyond confirming they pass a tenant; the web UI beyond the pay page and the payment modal; Prisma's handling of `NaN` in a `Float` column (HYPOTHESIS that it is accepted; Postgres accepts it).
