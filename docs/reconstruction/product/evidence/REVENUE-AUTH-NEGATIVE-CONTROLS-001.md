# Revenue authorization negative-control matrix 001, revision 2

```yaml
document_id: CC-NC-REVENUE-AUTH-001
revision: 2
supersedes: revision 1 (submitted under CG-AUTH-REVENUE-NEGATIVE-CONTROLS-001)
in_reply_to: CG-AUTH-REVENUE-NC-REVISION-002   # relayed in session; not a #80 event
for_packet: KF-REVENUE-AUTH-PROJECTION-001     # draft, not released
reference: REVENUE-GAP-REPORT-001.md (CC-GAP-TRACK-C-REVENUE-001)
code_anchor_main: b1948d2797e1bae3660a3d7173abb75397e05aad
covers: [G1, G4, G5, G7, G16]
mutations: none
implementation_authority: NONE
merge_authority: NONE
status: SUBMITTED_FOR_INDEPENDENT_CHATGPT_REVIEW
```

Every line number is at `main` `b1948d2797`, re-resolved for this revision (`origin/main` still `b1948d27`). Blobs: `commerce.controller.ts` `6ae7cb93`, `commerce.service.ts` `6eb4fa80`, `invoice-receipt-builder.service.ts` (8-31), `payments/payments.controller.ts` (63-66), `payments/payments.service.ts` (953-958), `core/guards/public-rate-limit.guard.ts` (13-14, 26-27), `core/filters/http-exception.filter.ts` (39-66), `core/auth/business.guard.ts` (10-51), `core/auth/module-scope.guard.ts` (14-15, 60-105), `modules/webhooks/webhooks.controller.ts` (81-103), `commerce/invoice-status-contract.spec.ts` (44-104), `packages/db/prisma/schema.prisma` (Invoice 3552-3611, InvoiceItem 3613-3628, Payment 3630-3654, PaymentLink 3692-3705, FinancialTransaction 9839-9885, LedgerEntry 9891-9923), `packages/db/src/client.ts` (21-36), `packages/db/src/middleware/soft-delete.ts` (13-105).

This is a test design. It implements nothing and modifies no test file. "Before" is the behaviour the test must observe on unmodified `main` (the negative control); "After" is the behaviour the packet must produce. A test that passes before the fix proves nothing about the fix, so every true negative control below is expected to **fail** on `main`, and that failure is evidence.

## 0. What changed in revision 2

| # | Ruling | Where it lands |
|---|---|---|
| 1 | RA-G1-04: URL status and body status disagree → **400**. The body-supplied `businessId` contract is preserved. | §4.1 RA-G1-01, 02, 04; §3; §5.4 |
| 2 | RA-G7-03/04: `revenue: read` is **mandatory** for authenticated receipts; explicit `revenue: none` is **403**. | §4.4 RA-G7-03, 04, new 07; §3 |
| 3 | RA-G5-05/06: the public payment-status route is **retained** with a minimal projection and `@PublicRateLimit(20, 60_000)`. The "or remove the route" option is withdrawn. | §3; §4.3 RA-G5-05, 06 |
| 4 | RA-G16-01: the legacy Stripe webhook dependency is recorded; service-level actor tightening is **DEFERRED** to the financial-integrity packet and not approved for this packet. Boundary decision from CG-AUTH-REVENUE-NC-REVISION-002. | §4.5; §5.1 list A excludes it; §6 |
| 5 | Prisma fixture and foreign-key preflight added. | new §2.5 |
| 6 | Section 5 restated as three named lists: expected pre-fix failures, existing passing regression controls, post-fix acceptance tests. | §5.1-5.3 |
| + | `invoice-status-contract.spec.ts` joins the proposed test write set with the explicit requirement to preserve its body-supplied tenant contract. | §5.4 |

Revision 1 cell text that these rulings replace is gone, not struck through, so the matrix reads as one contract.

## 1. Method, carried over from the Contacts pilot

- **Tests first, committed before the fix**, run once on `main` in CI so the real-database failures are on record (the PR #190 pattern: pre-fix head fails as intended, fix head passes, both at exact SHAs).
- **Three evidence layers**, kept explicitly separate, as the ruling on Contacts required:
  - **L1 mocked HTTP** (`test/commerce-authorization.e2e.test.ts`, like `crm.e2e.test.ts`): real controller, real `ModuleScopeGuard`, `BusinessGuard` and `PublicRateLimitGuard` with their lookups mocked, mocked `CommerceService` and Prisma. Proves routing, guards, decorator metadata and what the controller forwards. Never proves persistence or disclosure.
  - **L2 real-database HTTP** (new `test/revenue-authorization.integration.test.ts`, the one allowed new file, modelled on `test/contacts-visibility.integration.test.ts`): real `PrismaService`, real `AuthGuard`, `BusinessGuard`, `ModuleScopeGuard`, `PublicRateLimitGuard` (CI provides Redis at `REDIS_URL`), real `CommerceService`, `InvoiceReceiptBuilderService`, `InvoiceWorkflowService`, `RevenuePostingService` and `PostingService` (so a status change that posts to the ledger is observable). Request identity from a test-only header into `req.user`; guards not overridden. Stubs only for collaborators off the boundary: `CrmService.logContactEvent`, `CommerceStatsService`, Gmail, vision, drive, AI, `EventEmitter2` (recorded, not dispatched, so listeners cannot mutate). Runs in the CI `test` job (`ci-cd.yml` 340-444: `pgvector/pgvector:pg16`, `redis:7-alpine`, `pnpm test:ci`).
  - **L3 pure** (`invoice-workflow.service.spec.ts` already covers the state machine; `invoice-status-contract.spec.ts` covers the DTO and verb contract and gains one case, §5.4).
- **Fixtures use the prefix `rva_`** and are hard-deleted by raw SQL in `beforeAll` and `afterAll` in the dependency order given in §2.5.
- **Sensitive fields** are asserted by name, and additionally by a canary: every fixture string that must never leave the server contains the token `RVA_SECRET_` (a payment note, an evidence URL, a customer email local-part, a recorder id). Every denied or public response is checked with `expect(JSON.stringify(body)).not.toContain('RVA_SECRET_')`, which catches a leak through any field the named assertions miss.
- **Database must-not assertions** are made by direct Prisma reads after the request, never by trusting the response.

## 2. Fixtures

### 2.1 Tenants, users, memberships

| Id | Role in business A | `permissionScopes` | Effective `revenue` level |
|---|---|---|---|
| `rva_ownerA` | OWNER | none | admin (OWNER default) |
| `rva_adminA` | ADMIN | none | admin |
| `rva_staffWriteA` | STAFF | `{ revenue: 'write' }` | write |
| `rva_staffReadA` | STAFF | `{ revenue: 'read' }` | read |
| `rva_staffNoneA` | STAFF | `{ revenue: 'none', crm: 'read' }` | none (explicit deny) |
| `rva_staffDefaultA` | STAFF | none | read (STAFF default, `module-vocabulary.ts` 130) |
| `rva_noMember` | none | | not a member of A |
| `rva_ownerB` | OWNER of business B | none | admin in B only |
| `rva_superAdmin` | `User.role = SUPER_ADMIN`, no membership | | bypass in both guards |

Business A `rva_bizA` (owner `rva_ownerA`), business B `rva_bizB` (owner `rva_ownerB`). Contact `rva_contactA` in A with `email: 'RVA_SECRET_customer@test.local'`; contact `rva_contactB` in B. Both contacts exist because `Invoice.contactId` is required (§2.5).

### 2.2 Invoices and payments

| Id | Business | Contact | Status | Total | Payments | Notes |
|---|---|---|---|---|---|---|
| `rva_invSent` | A | `rva_contactA` | SENT | 100.00 | `rva_pay_s1`: SUCCESSFUL 40.00, `providerPaymentId: 'rva_pp_s1'`, `reference: 'RVA_SECRET_ref'`, `notes: 'RVA_SECRET_note'`, `evidenceUrl: 'https://x/RVA_SECRET_evidence.pdf'`, `recordedBy: 'RVA_SECRET_recorder'`; `rva_pay_s2`: PENDING 10.00, `providerPaymentId: 'rva_pp_s2'` | the read-only subject; never mutated by a test |
| `rva_invDraft` | A | `rva_contactA` | DRAFT | 50.00 | none | not shareable |
| `rva_invPaid` | A | `rva_contactA` | PAID | 20.00 | `rva_pay_p1`: SUCCESSFUL 20.00, `providerPaymentId: 'rva_pp_p1'` | |
| `rva_invVoid` | A | `rva_contactA` | VOID | 30.00 | none | |
| `rva_invB` | B | `rva_contactB` | SENT | 70.00 | none | cross-tenant target |
| `rva_invMut_<case>` | A | `rva_contactA` | SENT or DRAFT as the case needs | 100.00 | as the case needs, `providerPaymentId: 'rva_pp_<case>_<n>'` | **one fresh copy per mutating case**, created in that case's `beforeEach`; see §2.5 |

`rva_invSent` was moved to SENT by the real workflow in `beforeAll` (`transition(id,'SENT')`) so its AR posting exists; the test records the resulting `FinancialTransaction` ids as the ledger baseline. `rva_linkSent`: active `PaymentLink` for `rva_invSent`; `rva_linkExpired`: `PaymentLink` for `rva_invSent` with `expiresAt` in the past.

### 2.3 Request shape

`GET /commerce/...` with header `x-rva-user: <user id>`; the test middleware sets `req.user = { id, role }`. No header means unauthenticated. Bodies are JSON.

### 2.4 Status-code conventions, as they are today

The global filter (`http-exception.filter.ts` 39-66) maps `HttpException` subclasses to their status and **every other `Error` to 500 "Internal server error"**. `markInvoicePaid`, `updateInvoiceStatus`, `recordPayment`, `listPayments` throw plain `Error('Invoice not found')` and `Error('Not authorized to update this invoice')` (service 465, 470, 480, 487, 550, 559, 745, 757, 1364), so today a caller sees **500** for both. The service comments say the two cases are made "indistinguishable from not found on purpose"; in practice both are indistinguishable from a crash. The matrix therefore records "Before: 500" where that is what `main` does, and "After: 404 / 403" as the packet's target. Changing those throws to `NotFoundException` / `ForbiddenException` is inside the packet's write set (`commerce.service.ts`) and is part of the fix for G4.

### 2.5 Fixture preflight (new in revision 2)

These are the schema and runtime facts the L2 file must be written against. Each one has bitten a real-database test before or would bite this one.

**Prisma constraints**

| Constraint | Source | Consequence for the fixtures |
|---|---|---|
| `Payment.providerPaymentId` is `@unique` (global, not per business) | schema 3637 | every payment row, including the synthetic one `markInvoicePaid` creates (service 505-520) and every per-case copy, needs a distinct `providerPaymentId`. Fixture ids are `rva_pp_<subject>_<n>`. A case that expects the service to create a synthetic payment must assert on the row the service names, not on a fixture id. |
| `Invoice.contactId` is required, FK `NoAction` | schema 3574-3575 | no invoice without a contact; `rva_contactB` exists only so `rva_invB` can. |
| `@@unique([businessId, invoiceNumber])` | schema 3606 | per-case invoice copies use `invoiceNumber: 'RVA-<case>'`, never the service's `INV-${Date.now()}` (two copies in one millisecond would collide). |
| `FinancialTransaction @@unique([businessId, externalRef])` | schema 9879 | re-running `transition(…,'SENT')` on the same invoice is a no-op posting; per-case copies have their own `externalRef = Invoice:<copyId>:invoice_finalized`. The baseline assertion must key on the copy's id. |
| `Payment → Invoice` is `onDelete: NoAction` | schema 3650 | payments must be deleted **before** invoices or the delete fails. |
| `LedgerEntry → FinancialTransaction` is `onDelete: NoAction`; `LedgerEntry → ChartOfAccount` is `NoAction` | schema 9900, 9904 | ledger entries must be deleted before financial transactions, and before businesses (business cascade would try to drop `chart_of_accounts` first and fail on the entry FK). |
| `InvoiceItem → Invoice` and `PaymentLink → Invoice` are `Cascade` | schema 3621, 3696 | deleting invoices removes them, but the explicit order below deletes them first anyway so the cleanup is order-independent of cascade behaviour. |
| `FinancialTransaction.contactId` is `SetNull` | schema 9852 | harmless for cleanup; listed so nobody adds contacts after transactions in the delete order. |

**Hard-delete order** (raw SQL via `$executeRawUnsafe`, each statement best-effort, as in `contacts-visibility.integration.test.ts` 89-101), run in `beforeAll` and `afterAll`:

```
ledger_entries          WHERE business_id LIKE 'rva_%'
financial_transactions  WHERE business_id LIKE 'rva_%'
payments                WHERE business_id LIKE 'rva_%' OR invoice_id LIKE 'rva_%'
payment_links           WHERE business_id LIKE 'rva_%'
invoice_items           WHERE invoice_id LIKE 'rva_%'
invoices                WHERE business_id LIKE 'rva_%'
contacts                WHERE business_id LIKE 'rva_%'
memberships             WHERE business_id LIKE 'rva_%' OR user_id LIKE 'rva_%'
chart_of_accounts       WHERE business_id LIKE 'rva_%'
businesses              WHERE id LIKE 'rva_%'
users                   WHERE id LIKE 'rva_%'
```

`payments` is matched on both columns because the synthetic row the service creates carries the invoice's `businessId` but a service-chosen `id`. `webhook_events` is not touched: nothing in this matrix reaches a webhook handler (§4.5).

**Soft-delete extension**

`packages/db/src/client.ts` 21-36 wraps `Business`, `Contact`, `Invoice` (and others) in the soft-delete extension; `Payment`, `PaymentLink`, `Membership`, `FinancialTransaction`, `LedgerEntry` are **not** wrapped. Consequences:

- `prisma.invoice.delete`/`deleteMany` become `update … deletedAt` (middleware 13-35), so cleanup must be raw SQL, never the Prisma delete API, or the rows survive and the `@@unique([businessId, invoiceNumber])` collides on the next run.
- `findUnique`, `findFirst`, `findMany`, `count` on wrapped models add `deletedAt: null` (middleware 37-105). So `getInvoiceWithBusiness`, `markInvoicePaid` and the receipt builder already exclude soft-deleted invoices without saying so. RA-G7-06 and RA-G5-04 use a **non-existent** id, not a soft-deleted one, so they do not depend on this extension; a soft-deleted case is not needed for the authorization claims.
- The L2 "DB must not" reads must use the same `prisma.client` the app uses (`PrismaService` imports `db` from `@keyflow/db`, `prisma.service.ts` 2), so they see the same filters. Raw SQL is used only when a test must see through them (none here).
- The tenant-isolation extensions (`client.ts` 699) are active on the same client; the L2 file must not construct a bare `PrismaClient`.

**Transaction isolation**

- The test must **not** wrap requests in a `$transaction` and roll back. `recordPayment` commits inside its own transaction (service 1387-1412) and runs `reconcileFromPayments` **outside** it (1416); `refund` swallows the reconcile error (1535). Wrapping would hide exactly the partial-commit behaviour G3 and G12 describe, and would deadlock the service's own interactive transaction. Isolation comes from the `rva_` prefix and from per-case invoice copies, not from rollback.
- `vitest run` (the CI command, `apps/server/package.json` 16) runs **files** in parallel workers and **cases within a file** sequentially. `contacts-visibility.integration.test.ts` (prefix `tcv_`) may run concurrently against the same database; the prefixes do not overlap and neither file reads the other's rows. The L2 file must not assert on global counts (for example "no payments exist"), only on `rva_`-scoped rows.
- Every mutating case (`PATCH …/paid`, `…/payment-failed`, `…/status/:status`, PC-07, PC-09) runs against its own `rva_invMut_<case>` copy created in `beforeEach`, so a case that wrongly succeeds on `main` (the whole point of a negative control) cannot poison the next case's "Before".
- `rva_invSent` is read-only for every case; the two routes that could change it are only ever called with a `rva_invMut_*` id.

**Rate-limit state**

- `PublicRateLimitGuard` keys on `ip:handler:route` in Redis (guard 34). RA-G5-06 must `DEL pub_rate_limit:*getInvoicePaymentStatus*` in its `beforeEach` and `afterEach`, or a re-run inside the same minute inherits the previous count. The CI Redis is fresh per job, but the local developer's is not.

## 3. The public projection the packet must introduce (special requirement)

`getInvoiceWithBusiness(invoiceId, requireShareable)` (service 389-446) stays byte-identical. It has six callers that depend on its full shape: the two email paths (controller 1051, 1119), the receipt listener (`invoice-receipt.listener.ts` 31), the token route (controller 1163), the KEY commerce adapter (`key-cortex/adapters/commerce-adapter.service.ts` 57) and the public detail route (520). Only the last one changes.

**New method** `getInvoicePublicView(invoiceId)` in `commerce.service.ts`, returning exactly the shape the token route already hand-builds at controller 1175-1192, which is the proven public-safe contract:

```
id, invoiceNumber, status, total, currency, issueDate, dueDate, notes,
items[{ id, description, quantity, unitPrice, total }],
contact: { firstName, lastName } | null,          // no email
business: { name, logoUrl, primaryColor, email, phone } | null,
paid, remaining                                    // from computeBalance; no payment rows
```

Same shareable-status gate as today (SENT, PAID, OVERDUE, PARTIALLY_PAID; 432-437), returning null otherwise. `GET /commerce/invoices/:id` (518-521) calls it. The pay page (`pay/[invoiceId]/page.tsx` 56-85) reads only `invoiceNumber, status, total, notes, currency, items, contact.firstName/lastName, business`, so it keeps working; PC-01 proves it.

**Public payment status** (ruling 3). `GET /payments/invoice/:id/status` (`payments.controller.ts` 63-66) is **retained**. It returns `{ status, paid, remaining, currency, lastPaymentAt }` computed server-side from `computeBalance`, no rows, and is decorated `@PublicRateLimit(20, 60_000)` (the decorator at `public-rate-limit.guard.ts` 13-14; the sibling Stripe checkout route at 68 already uses `@PublicRateLimit(5, 60_000)`, so the guard is wired on this controller). The route is kept because the pay page's post-payment polling is the natural consumer and because removing a public route is a product decision the packet is not authorized to take. The projection and the limit are both pinned (RA-G5-05, RA-G5-06).

**Receipt** (ruling 2). `buildReceipt(invoiceId, businessId)` with `findFirst({ where: { id, businessId, deletedAt: null } })`. The only caller is controller 515. The receipt route gains `@RequireModuleScope('revenue', 'read')` behind `ModuleScopeGuard` (decorator at `module-scope.guard.ts` 14-15; the controller already applies it to other routes, for example at 68 and 83), so `revenue: read` is the mandatory floor for an authenticated receipt and an explicit `revenue: none` is refused.

**Status route** (ruling 1). `PATCH /commerce/invoices/:invoiceId/status/:status` keeps `@Body('businessId')` as the tenant source for `BusinessGuard` (controller 356; `business.guard.ts` 22 resolves params → body → query) and keeps `UpdateInvoiceStatusDto.status` as the validated status source (`IsIn(['SENT','OVERDUE','VOID'])`, dto 4). The handler compares `status.toUpperCase()` from the path with `body.status`; a disagreement is `BadRequestException` (400) before any service call. The DTO is not changed, so `invoice-status-contract.spec.ts` 57-104 continues to pass unchanged (§5.4).

## 4. Matrix

Columns: **Invariant** · **Actor / fixture** · **Request** · **Before** (on `main`) · **After** (packet target) · **Must not expose** · **DB must not** · **Evidence** · **Anchor**. Mutating cases run against a fresh `rva_invMut_<case>` copy (§2.5); the fixture column names the copy's starting state.

### 4.1 G1, PAID without a payment through the path parameter

| ID | Invariant | Actor / fixture | Request | Before | After | Must not expose | DB must not | Evidence | Anchor |
|---|---|---|---|---|---|---|---|---|---|
| RA-G1-01 | Status comes from the validated body, never the URL | `rva_ownerA`, copy SENT | `PATCH /commerce/invoices/<copy>/status/paid` body `{ businessId: 'rva_bizA', status: 'SENT' }` | 200; invoice `PAID`, `paidAt` set, `invoice.paid` emitted, COGS attempted, zero new payment rows | **400** (path `PAID` ≠ body `SENT`); status unchanged | n/a | `invoices.status` must still be SENT; no `financial_transactions` row with `kind = 'cogs'` for the copy; no `invoice.paid` in the recorded event buffer | L1 (400 before the service spy is called), **L2** (state and ledger) | controller 362; service 763; workflow 30, 316-327 |
| RA-G1-02 | Same, for every path value outside the DTO set | `rva_ownerA`, copy SENT, body `{ businessId: 'rva_bizA', status: 'SENT' }` each time | path status in `partially_paid`, `pending`, `failed`, `draft`, `PAID`, `Paid`, `void%20` | `partially_paid` / `pending` / `failed`: 200 and the status changes; `draft`: 409; others: 409 or 500 | **400** for all (none equals `SENT`) | n/a | status unchanged for all | L2 | controller 362; workflow 29-42 |
| RA-G1-03 | Legal body values still work (positive control) | `rva_ownerA`, copy DRAFT | `PATCH /commerce/invoices/<copy>/status/sent` body `{ businessId: 'rva_bizA', status: 'SENT', sentAt: <iso> }` | 200, DRAFT → SENT, AR posted | same | n/a | — must create: one `FinancialTransaction` with `externalRef = Invoice:<copy>:invoice_finalized` | L2 | workflow 257-312; revenue-posting 105 |
| RA-G1-04 | Body and path disagree on two **legal** values → 400, nothing changes | `rva_ownerA`, copy DRAFT | path `void`, body `{ businessId: 'rva_bizA', status: 'SENT' }` | 200, becomes VOID (path wins) | **400** `status mismatch`; the body's `businessId` was still read by the guard (the request is not 403) | n/a | status still DRAFT; no posting | L1 (guard passed, handler refused, service not called), L2 | controller 356, 362; business.guard 22 |
| RA-G1-05 | Path and body agree on a legal value (positive, pins the agreement rule) | `rva_ownerA`, copy DRAFT | path `sent`, body `{ businessId: 'rva_bizA', status: 'SENT' }` | 200 | 200, identical to RA-G1-03 | | | L2 | |

### 4.2 G4, scope and tenant on the three bare-id status routes

| ID | Invariant | Actor / fixture | Request | Before | After | Must not expose | DB must not | Evidence | Anchor |
|---|---|---|---|---|---|---|---|---|---|
| RA-G4-01 | `revenue: write` required to mark paid | `rva_staffReadA`, copy SENT with one SUCCESSFUL 40.00 | `PATCH /commerce/invoices/<copy>/paid` body `{ businessId: 'rva_bizA' }` | 200; PAID; synthetic payment **not** created (one SUCCESSFUL exists) | 403 `Insufficient permissions` from `ModuleScopeGuard` | n/a | status unchanged; `payments` count for the copy unchanged | **L1** (guard), L2 | controller 332-340; module-scope.guard 98 |
| RA-G4-02 | Same for explicit `revenue: none` | `rva_staffNoneA`, copy SENT | same request | 200; PAID | 403 | | same | L1, L2 | |
| RA-G4-03 | Same for STAFF default (read) | `rva_staffDefaultA`, copy SENT | same request | 200; PAID | 403 | | same | L1, L2 | module-vocabulary 130 |
| RA-G4-04 | Write scope may mark paid (positive) | `rva_staffWriteA`, copy SENT | same request | 200 | 200 (G2 semantics are a later packet; this packet asserts only that the write-scope actor is admitted) | | | L1, L2 | |
| RA-G4-05 | `revenue: write` required to mark failed | `rva_staffReadA`, copy SENT | `PATCH /commerce/invoices/<copy>/payment-failed` body `{ businessId: 'rva_bizA', reason: 'x' }` | 200; FAILED | 403 | | status unchanged; no `invoice.payment_failed` event | L1, L2 | controller 342-351 |
| RA-G4-06 | `revenue: write` required for send / overdue / void | `rva_staffReadA`, copy DRAFT | `PATCH /commerce/invoices/<copy>/status/sent` body `{ businessId: 'rva_bizA', status: 'SENT' }` | 200; SENT and AR posted | 403 | | status unchanged; **no** `FinancialTransaction` created | L1, **L2** (ledger side effect is the point) | controller 353-369; workflow 304-309 |
| RA-G4-07 | Tenant from the guard is bound to the invoice | `rva_ownerB`, target copy in A | `PATCH /commerce/invoices/<copy>/paid` body `{ businessId: 'rva_bizB' }` | guard passes (B is theirs); service membership check throws plain Error → **500**; invoice unchanged | 404 `Invoice not found` (tenant mismatch, indistinguishable from absent) | body must not reveal that the id exists | status unchanged; no payment row | L2 | business.guard 22; service 467-488 |
| RA-G4-08 | Same on the status route | `rva_ownerB`, copy SENT in A | `PATCH /commerce/invoices/<copy>/status/void` body `{ businessId: 'rva_bizB', status: 'VOID' }` | 500; unchanged | 404 | id existence | status unchanged; no void posting | L2 | service 737-758 |
| RA-G4-09 | Same on payment-failed | `rva_ownerB`, copy SENT in A | `PATCH /commerce/invoices/<copy>/payment-failed` body `{ businessId: 'rva_bizB' }` | 500; unchanged | 404 | | unchanged | L2 | service 545-574 (no tenant param today; packet adds it) |
| RA-G4-10 | Non-member is refused at the guard | `rva_noMember` | any of the three with `businessId: 'rva_bizA'` | 403 `No access to this business` | 403 | | unchanged | L1, L2 | business.guard 44 |
| RA-G4-11 | Missing `businessId` is refused, not defaulted | `rva_ownerA` | `PATCH /commerce/invoices/<copy>/paid` body `{}` | 403 `businessId is required` | 403 | | unchanged | L1 | business.guard 24; `invoice-status-contract.spec.ts` 52-55 |
| RA-G4-12 | Controller forwards the guard's tenant to the service | `rva_ownerA` | `PATCH /commerce/invoices/<copy>/paid` body `{ businessId: 'rva_bizA' }` | service called with `(id, actor)` and **no** `businessId` | service called with `(id, actor, 'rva_bizA')`; status route called with `businessId: 'rva_bizA'` | | | **L1** (spy on the mocked service, the Contacts pattern) | controller 339, 350, 362-368 |
| RA-G4-13 | SUPER_ADMIN still passes (positive) | `rva_superAdmin`, copy SENT | mark paid with `businessId: 'rva_bizA'` | 200 | 200 | | | L2 | business.guard 18; module-scope.guard 67 |
| RA-G4-14 | Plain errors become HTTP errors | `rva_ownerA` | `PATCH /commerce/invoices/rva_does_not_exist/paid` body `{ businessId: 'rva_bizA' }` | 500 | 404 | | | L2 | service 465; filter 61 |

### 4.3 G5, public disclosure

| ID | Invariant | Actor / fixture | Request | Before | After | Must not expose | DB must not | Evidence | Anchor |
|---|---|---|---|---|---|---|---|---|---|
| RA-G5-01 | Public invoice view carries no payment rows | unauthenticated, `rva_invSent` | `GET /commerce/invoices/rva_invSent` | 200 with `payments[2]` including `reference`, `notes`, `evidenceUrl`, `evidenceMimeType`, `recordedBy`, `providerPaymentId`; `contact.email` | 200 with `paid: 40`, `remaining: 60`, no `payments` key, no `contact.email` | `payments`, `contact.email`, `business.address|whatsapp|facebook|instagram|twitter|website|invoiceTemplate|quoteTemplate` (not in the token projection), canary `RVA_SECRET_` | — | **L2** | controller 518-521; service 389-446; token projection 1175-1192 |
| RA-G5-02 | PENDING rows never appear publicly | unauthenticated | same | the 10.00 PENDING row is in `payments` | nothing row-shaped; `paid` excludes PENDING (`computeBalance` 82-83) | `status: 'PENDING'` anywhere in body | | L2 | workflow 70-96 |
| RA-G5-03 | Non-shareable statuses stay hidden | unauthenticated, `rva_invDraft`, `rva_invVoid` | `GET /commerce/invoices/<id>` | 200 with body `null` (controller returns null → empty 200) | 404 | existence beyond "not found" | | L2 | service 432-437 |
| RA-G5-04 | Unknown id | unauthenticated | `GET /commerce/invoices/rva_nope` | 200 `null` | 404, byte-identical body to RA-G5-03 | | | L2 | |
| RA-G5-05 | Public status route carries no rows | unauthenticated, `rva_invSent` | `GET /payments/invoice/rva_invSent/status` | 200 with two raw `Payment` rows | 200 `{ status: 'SENT', paid: 40, remaining: 60, currency, lastPaymentAt: <rva_pay_s1.createdAt> }` and **no other keys** (`Object.keys(body).sort()` equals the five) | every `Payment` column; canary | | L2 | payments.controller 63-66; payments.service 953-958 |
| RA-G5-06 | Public status route is rate limited at 20 per minute per IP | unauthenticated | 21 requests in one minute from one IP, Redis key cleared first (§2.5) | all 200 (guard returns true with no metadata, guard 27) | requests 1-20 are 200, the 21st is **429**; L1 additionally reads the metadata and asserts `{ limit: 20, windowMs: 60000 }` | | | **L1** (metadata), **L2** (real guard, real Redis) | public-rate-limit.guard 13-14, 26-27, 34 |
| RA-G5-07 | Authenticated owner still gets full detail on the tenant route (positive) | `rva_ownerA` | `GET /commerce/businesses/rva_bizA/invoices` | 200 with `payments` included (`listInvoices` 254) | same | n/a, authorised | | L2 | service 246-261 |
| RA-G5-08 | Tenant payments route unchanged (positive) | `rva_staffReadA` | `GET /commerce/businesses/rva_bizA/invoices/rva_invSent/payments` | 200 with rows, `paidAmount 40`, `remaining 60` | same | n/a | | L2 | service 1866-1884 |
| RA-G5-09 | Cross-tenant payments route stays closed | `rva_ownerB` | `GET /commerce/businesses/rva_bizB/invoices/rva_invSent/payments` | 500 (plain Error) | 404 | canary | | L2 | service 1867-1872 |

### 4.4 G7, receipt tenant binding and read scope

| ID | Invariant | Actor / fixture | Request | Before | After | Must not expose | DB must not | Evidence | Anchor |
|---|---|---|---|---|---|---|---|---|---|
| RA-G7-01 | Receipt is bound to the guard's tenant | `rva_ownerB`, target `rva_invSent` (A) | `GET /commerce/invoices/rva_invSent/receipt?businessId=rva_bizB` | 200 with contact name, `contact.email`, items, business name | 404 | `contact.*`, `items`, `business.name`, canary | | **L2** | controller 509-516; receipt builder 8-31 |
| RA-G7-02 | Own-tenant receipt works (positive) | `rva_ownerA` | `GET /commerce/invoices/rva_invSent/receipt?businessId=rva_bizA` | 200 | 200, same shape as today (`invoiceNumber, status, total, currency, contact, business, items, issuedAt, paidAt`) | n/a | | L2 | receipt builder 15-30 |
| RA-G7-03 | `revenue: read` is sufficient for a receipt (positive, pins the floor) | `rva_staffReadA` and `rva_staffDefaultA` | same as RA-G7-02 | 200 | 200 | | | L1 (decorator metadata `{ module: 'revenue', minLevel: 'read' }` on the handler), L2 | module-scope.guard 14-15 |
| RA-G7-04 | Explicit `revenue: none` is refused | `rva_staffNoneA` | same | 200 | **403** `Insufficient permissions` | `contact.*`, `items`, canary | | L1 (guard), **L2** | module-scope.guard 98 |
| RA-G7-05 | Unauthenticated receipt stays closed, and the public booking pages are known broken (disclosure, not a fix) | no header | `GET /commerce/invoices/rva_invSent/receipt` | 401 | 401 | | | L1 | `book/[slug]/components/order-confirmation.tsx` 490; `public/book/page.tsx` 165 open this URL without a session and fail today; out of this packet, recorded for the decision ledger |
| RA-G7-06 | Receipt for a non-existent id | `rva_ownerA` | `GET /commerce/invoices/rva_nope/receipt?businessId=rva_bizA` | 404 (`NotFoundException`, builder 13) | 404, byte-identical to RA-G7-01 | existence | | L2 | |
| RA-G7-07 | Non-member cannot read a receipt even with the right tenant id | `rva_noMember` | `GET /commerce/invoices/rva_invSent/receipt?businessId=rva_bizA` | 403 `No access to this business` | 403 | canary | | L1, L2 | business.guard 44 |

### 4.5 G16, guard tenant and service tenant must agree

Ruling 4 and the boundary decision in CG-AUTH-REVENUE-NC-REVISION-002 apply here. The service-level tightening ("no actor and no tenant → refuse") is **recorded, not released**.

**Dependency on record.** `modules/webhooks/webhooks.controller.ts` 81-103 (the deprecated Stripe handler; the response at 107 points callers to `/payments/stripe/webhook`) calls `this.commerce.markInvoicePaid(invoiceId)` at **86** with no actor and no tenant, then looks the invoice up at **88-91** (`select: { businessId, total, currency }`) only to emit a connector event. On `main` that call succeeds precisely because `markInvoicePaid` skips both the tenant comparison (467) and the membership check (482-489) when neither argument is present. Tightening the service would therefore break this handler unless it is changed to pass the invoice's `businessId` it already fetches, which is a webhook behaviour change and is outside the authorization packet. The first authorization packet must not silently expand into webhook behaviour.

| ID | Invariant | Actor / fixture | Request | Before | After in **this** packet | Disposition | Evidence | Anchor |
|---|---|---|---|---|---|---|---|---|
| RA-G16-01 | A caller with no actor and no tenant cannot mark paid through the service | direct service call in L2: `commerce.markInvoicePaid('<copy>')` | resolves, invoice PAID (both checks skipped) | **unchanged** (still resolves). The case is written and committed with `it.todo` or `describe.skip` carrying the text `DEFERRED: KF-REVENUE-FINANCIAL-INTEGRITY (webhooks.controller.ts 86-91)`, so the deferral is visible in the test file and in the run output, and it is **excluded** from list A in §5.1 | **DEFERRED** to the financial-integrity packet. It may be pulled forward only by a separately approved, explicitly bounded correction that adds `modules/webhooks/webhooks.controller.ts` to the write set and changes line 86 to pass the tenant from the lookup at 88-91 (moving that lookup above the call). Not approved by this revision. | L2 (service-level), when released | service 459-489; webhooks.controller 86-91 |
| RA-G16-02 | Supplying the wrong tenant is refused even with a valid actor | `commerce.markInvoicePaid('<copy>', 'rva_ownerA', 'rva_bizB')` | throws plain `Error('Invoice not found')` | throws `NotFoundException` (the G4 error-mapping change; the comparison at 467-471 already exists) | in this packet | L2 | service 467-471 |
| RA-G16-03 | The controller's forwarded tenant is the one the guard validated | L1 spy | see RA-G4-12 | | | in this packet | L1 | controller 332-369 |
| RA-G16-04 | The system actor still requires a tenant (regression guard) | `commerce.markInvoicePaid('<copy>', KEY_SYSTEM_ACTOR_ID)` | throws plain `Error('Not authorized…')` (472-481) | throws `ForbiddenException` | in this packet (error mapping only; the check already exists) | L2 | service 472-481; `core/auth/system-actor.ts` |

What the deferral leaves open is stated plainly: after this packet, every **HTTP** path to mark-paid carries the guard's tenant (RA-G4-07, RA-G4-12), but the **service** still accepts an anonymous, tenantless call. The only production caller of that form is the deprecated Stripe handler. That residual is the financial-integrity packet's first item.

### 4.6 Positive controls across the packet

| ID | Journey that must keep working | Actor / fixture | Request(s) | Expected | Evidence | Anchor |
|---|---|---|---|---|---|---|
| PC-01 | Public payment page renders from the projection | unauthenticated | `GET /commerce/invoices/rva_invSent` then `GET /payments/invoice/rva_invSent/gateways` | first body contains every field the page reads: `invoiceNumber, status, total, notes, currency, items[].description/quantity/unitPrice/total, contact.firstName/lastName, business.name/logoUrl/primaryColor`; second 200 | L2; plus one web unit test that renders `pay/[invoiceId]/page.tsx` against the new shape (apps/web `test:unit`) | pay page 56-85, 189, 255-256 |
| PC-02 | Token public view unchanged | unauthenticated | `GET /commerce/public/invoice-link/<rva_linkSent.token>` | 200, `ok: true`, same body as today; expired token → `ok: false, reason: 'invalid_or_expired'` | L2 | controller 1157-1195; service 2074-2098 |
| PC-03 | Invoice email generation unchanged | `rva_ownerA` with Gmail stubbed to capture HTML | `POST /commerce/businesses/rva_bizA/invoices/rva_invSent/send-email` body `{ to: 'c@test.local' }` | 200; captured HTML contains amount paid 40.00 and remaining 60.00 (the reason `payments` is included at service 398-403) | L2 with `GmailService.sendMessage` stubbed | controller 1041-1075, 1051; `getInvoiceWithBusiness` 389-446 untouched |
| PC-04 | Reminder and receipt emails unchanged | same | `.../send-reminder`, `.../resend-receipt` | 200; captured HTML as today | L2 | controller 1077-1143 |
| PC-05 | Receipt listener unchanged | fire `invoice.paid` for `rva_invPaid` through the real listener with Gmail stubbed | listener calls `getInvoiceWithBusiness(id, true)` and sends | L2 | `invoice-receipt.listener.ts` 31 |
| PC-06 | KEY commerce adapter unchanged | call `commerceAdapter.getInvoice({ invoiceId })` | returns the full shape incl. `payments` | L2 or L1 | `key-cortex/adapters/commerce-adapter.service.ts` 57 |
| PC-07 | Authorised mark-paid, send, void still work | `rva_ownerA`, `rva_staffWriteA`, fresh copies | the three routes with legal, agreeing values and `businessId: 'rva_bizA'` | 200 each; events recorded; postings created where the workflow creates them today | L2 | |
| PC-08 | Customer payment intent still works from a public page | unauthenticated | `POST /commerce/invoices/rva_invSent/payment-intent` body `{ method: 'bank_transfer' }` | 200 as today (G6 is a later packet; this pins that the auth packet does not break it) | L2 | controller 1437-1449 |
| PC-09 | Getting a receipt by the operator after payment | `rva_ownerA`, fresh copy | mark paid, then `GET .../receipt?businessId=rva_bizA` | 200 with `paidAt` set | L2 | |
| PC-10 | Public status route still answers the pay page's poll | unauthenticated | `GET /payments/invoice/rva_invSent/status` once | 200 with the five keys of RA-G5-05 | L2 | payments.controller 63-66 |
| PC-11 | Existing suites still pass | | `commerce-public-quote.e2e.test.ts`, `invoice-status-contract.spec.ts`, `commerce.service.test.ts`, `payments-webhooks.service.test.ts` | unchanged counts, plus the one added case in §5.4 | CI | |

## 5. Evidence and file plan

### 5.1 List A: expected pre-fix failures (true negative controls)

Each of these must **fail** on `main` `b1948d27` in the hosted real-database run and **pass** at the fix head. A case in this list that passes on `main` is a defect in the test, to be reported, not a free pass.

| Group | Cases | What the pre-fix failure proves |
|---|---|---|
| G1 path status | RA-G1-01, RA-G1-02, RA-G1-04 | the URL can set PAID / illegal states today; body-path disagreement is silently resolved in the URL's favour |
| G4 scope | RA-G4-01, 02, 03, 05, 06 | read-level and explicit-none actors can mutate invoice state and post to the ledger |
| G4 tenant | RA-G4-07, 08, 09, 12, 14 | the guard's tenant never reaches the service; cross-tenant attempts surface as 500, not 404 |
| G5 disclosure | RA-G5-01, 02, 03, 04, 05, 06, 09 | raw payment rows and the customer email are public; non-shareable and unknown ids answer 200 `null`; the status route has no projection and no limit |
| G7 receipt | RA-G7-01, RA-G7-04 | receipts are cross-tenant readable and have no scope floor |
| G16 | RA-G16-02, RA-G16-04 | the existing service checks throw plain `Error` (500), not HTTP errors. **RA-G16-01 is not in this list** (deferred, §4.5) |

Count: 24 cases.

### 5.2 List B: existing passing regression controls (pass before and after)

These pin behaviour `main` already has that the packet must not break. They pass on `main` and must still pass at the fix head; a change in either direction is a finding.

| Cases | Behaviour pinned |
|---|---|
| RA-G1-03, RA-G1-05 | legal, agreeing status transitions still work and still post AR |
| RA-G4-04, RA-G4-10, RA-G4-11, RA-G4-13 | write scope admitted; non-member refused at the guard; missing `businessId` refused (the `invoice-status-contract.spec.ts` 52-55 contract, now also exercised over HTTP); SUPER_ADMIN bypass |
| RA-G5-07, RA-G5-08 | tenant-scoped invoice and payment listings keep their full shape |
| RA-G7-02, RA-G7-03, RA-G7-05, RA-G7-06, RA-G7-07 | own-tenant receipt; read-scope receipt; unauthenticated 401; unknown id 404; non-member 403 |
| RA-G16-03 | identical to RA-G4-12's L1 spy; listed here because its L1 half (the guard passing the tenant) already holds, its "forwarded" half is RA-G4-12 in list A |
| PC-02 … PC-06, PC-08, PC-11 | token view, three email paths, receipt listener, KEY adapter, payment intent, existing suites |

Count: 21 cases, PC-11 being the four existing suites.

### 5.3 List C: post-fix acceptance tests (pass only after; absent behaviour before)

These assert behaviour that does not exist on `main` and is not a denial, so they are neither negative controls nor regression guards. On `main` they fail because the projection or decorator is missing, not because something is leaking; the RETURN reports them separately so a reviewer can tell "closed a hole" from "built the replacement".

| Cases | Behaviour accepted |
|---|---|
| PC-01 | the pay page renders from `getInvoicePublicView` (the L2 half and the web unit test) |
| PC-07, PC-09 | authorised mutations and the post-payment receipt work through the new guard and tenant plumbing with fresh copies |
| PC-10 | the retained public status route answers with exactly the five-key projection |
| RA-G5-06 L1 half | the `@PublicRateLimit(20, 60000)` metadata is present on the handler |
| RA-G7-03 L1 half | the `@RequireModuleScope('revenue', 'read')` metadata is present on the receipt handler |

The L2 halves of RA-G5-05, RA-G5-06 and RA-G7-04 remain in list A because on `main` they fail by **disclosure or admission**, which is the negative-control evidence.

### 5.4 Proposed test write set

| Layer | File | Status | Cases | Constraint |
|---|---|---|---|---|
| L1 | `apps/server/test/commerce-authorization.e2e.test.ts` | new, mocked service, real guards (or extend `commerce-public-quote.e2e.test.ts`, which already wires the controller with stubs; the packet decides, one file) | RA-G1-01/02/04 (400 before the spy), RA-G4-01..03, 05, 06 (guard half), 10, 11, 12, RA-G5-06 (metadata), RA-G7-03 (metadata), RA-G7-04/05/07 (guard half), RA-G16-03 | |
| L2 | `apps/server/test/revenue-authorization.integration.test.ts` | new, the one new real-database file | every RA-* (RA-G16-01 as a visibly deferred placeholder) and PC-01..10 | §2.5 preflight is binding |
| L3 | `apps/server/src/modules/commerce/invoice-status-contract.spec.ts` | **existing, joins the write set (ruling +)** | gains one case: body `{ businessId: 'biz_1', status: 'SENT' }` with path `void` is refused with 400 by the handler's agreement check (a pure-function or controller-level assertion in the style of the file's existing `CONTROLLER` source checks at 106-124, or a direct handler call with a stubbed service) | **Every existing case at 44-124 is preserved verbatim.** In particular: the body-supplied `businessId` contract (48-55, 91-103) stays the tenant source for `BusinessGuard`, the DTO keeps `status` required and `IsIn(['SENT','OVERDUE','VOID'])` (57-70, 82-89), and the verbs stay PATCH (106-124). The packet must not mirror the path into the body, strip body `status`, or add `businessId` to the DTO; any of those would turn a passing case here red and is out of scope. |
| web | `apps/web` unit test for the pay page against the projection | optional but recommended | PC-01 | |
| CI | `test` job, `ci-cd.yml` 340-444: pgvector/pg16 + redis:7, `pnpm test:ci` | already runs every `*.test.ts` and `*.spec.ts` under `apps/server` | pre-fix red (list A only), post-fix green (A, B, C), both at exact heads, every skip disclosed | RA-G16-01's deferred placeholder is reported as **skipped by design**, not as a pass |

Expected pre-fix result on `main`, to be recorded in the RETURN: list A (24) fails; list B (21, including the four suites) passes; list C fails for absence; RA-G16-01 skipped with its deferral text in the run output.

## 6. Out of this matrix, recorded for the ledger

- **G16 service-level tightening is deferred** to the financial-integrity packet (ruling 4). Its precondition is a bounded change to `modules/webhooks/webhooks.controller.ts` 86-91 (pass the invoice's tenant into `markInvoicePaid`), which touches webhook behaviour and needs its own explicit authorization. Until then the deprecated Stripe handler remains the one caller that can mark an invoice paid with no actor and no tenant.
- G2, G3, G12, G17 (money consistency) and G6 (public intent) are not asserted here beyond PC-07 and PC-08 pinning that this packet does not change them.
- The public booking confirmation pages open the authenticated receipt URL without a session and fail today (RA-G7-05). A token-based public receipt is a product decision.
- `GET /commerce/quotes/:quoteId` (controller 644) has the same unguarded shape as G5 and is outside the revenue write set; it should get its own projection in a quotes packet.
- The receipt scope floor is now decided (`revenue: read`, ruling 2) and no longer an open policy choice.
- The public status route is now decided (retained, projected, limited at 20 per minute, ruling 3) and no longer an open choice.

## 7. What this matrix does not do

It does not run anything, does not change any test, and does not claim that any "After" behaviour exists. The "Before" column is what reading the code predicts; the pre-fix CI run is what proves it. Revision 2 changes the contract only where the six rulings and the G16 boundary decision direct; no implementation authority is implied by any cell.
