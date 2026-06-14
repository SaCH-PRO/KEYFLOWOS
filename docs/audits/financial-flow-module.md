# Financial Flow Module Audit

**Date:** 2026-06-11  
**Scope:** Front-end Financial Flow / Money hub, back-end `finance` module, and supporting database schema.  
**Method:** Read-only code review across `apps/web/src/app/app/financial-flow`, `apps/web/src/app/app/money`, `apps/server/src/modules/finance`, `packages/db/prisma/schema.prisma`, and related migrations.  

---

## Executive Summary

The Financial Flow module provides the dashboard users rely on for cash position, safe-to-spend, forecasting, reserve buckets, and action items. While the architecture is mostly sound — double-entry postings are centralized through `PostingService`, tenant scoping exists, and Redis caching has been introduced — the audit surfaced a number of **High** severity correctness, integrity, and UX issues that can produce materially wrong numbers or silently broken workflows.

Top risks to fix first:

1. **Cashflow forecast is broken on both ends:** the server queries a non-existent `nextRunDate` on `Expense`, and the front-end expects a DTO shape that the server no longer returns.
2. **Credit notes cannot be applied** because of a `sourceType` case mismatch (`'INVOICE'` vs `'Invoice'`).
3. **Financial Flow page swallows all load errors and duplicates the “Add bucket” control.**
4. **Finance Overview GET endpoint mutates the database** (seeds accounts and upserts `RevenueAction` rows) and its 60-second Redis cache has no invalidation triggers.
5. **Database schema stores monetary values as `Float` despite the project rule requiring `Decimal(18,4)`**, creating rounding-drift risk.
6. **Several cross-tenant write paths** perform the authorization check *after* the mutation.

---

## Severity Summary

| Layer | 🔴 High | 🟡 Medium | 🟢 Low |
|-------|--------|----------|--------|
| Front-end | 3 | 8 | 4 |
| Back-end | 10 | 16 | 6 |
| Database / Schema | 2 | 16 | 5 |
| **Total** | **15** | **40** | **15** |

---

## 1. Front-End Findings

### 🔴 F1. `financial-flow/page.tsx` forecast DTO mismatch renders zeros
**File:** `apps/web/src/app/app/financial-flow/page.tsx`  
**Lines:** 39, 55, 153–189

The local `forecast` state is typed as a flat object:

```ts
{ days, expected, conservative, optimistic, dangerDate, recommendations: string[] }
```

but the server now returns `CashflowForecastDto`:

```ts
{ scenarios: { expected[], conservative[], optimistic[] }, dangerDates[], recommendations: { title, description, impact }[] }
```

The 90-day forecast card therefore displays `undefined`/0 for every scenario, never shows a danger date, and prints `[object Object]` for recommendations.

**Recommendation:** Update the local type to `CashflowForecastDto`, render `forecast.scenarios.expected/conservative/optimistic`, `dangerDates[0]`, and `rec.title`/`rec.description`.

---

### 🔴 F2. All initial-load errors are swallowed
**File:** `apps/web/src/app/app/financial-flow/page.tsx`  
**Line:** 62

```ts
catch {
  // fail silently
}
```

Network, auth, or server failures leave the user looking at skeletons or zeroed cards with no feedback and no retry affordance.

**Recommendation:** Surface the error in a banner, toast, or inline error state, and provide a retry button.

---

### 🔴 F3. Loading state never resolves when `businessId` is missing
**File:** `apps/web/src/app/app/financial-flow/page.tsx`  
**Lines:** 35, 49–50

`businessId` is coalesced to `""`. `load()` returns early when it is empty, but `setLoading(false)` is only reached in `finally` after the early return, so `loading` stays `true` indefinitely.

**Recommendation:** Treat missing `businessId` as an explicit error/redirect state and always set loading to false.

---

### 🟡 F4. Duplicate “Add bucket” controls
**File:** `apps/web/src/app/app/financial-flow/page.tsx`  
**Lines:** 196–215

One button is rendered in `SectionCard headerRight` and an identical button is rendered inside the card body.

**Recommendation:** Remove the body button.

---

### 🟡 F5. Optimistic delete without verifying success
**File:** `apps/web/src/app/app/financial-flow/page.tsx`  
**Lines:** 96–100

`handleDelete` filters local state immediately after calling `deleteReserveBucket`, regardless of whether the request succeeded.

**Recommendation:** Wait for the API response and only update state on success; show a toast on failure.

---

### 🟡 F6. Create-bucket handler ignores failures
**File:** `apps/web/src/app/app/financial-flow/page.tsx`  
**Lines:** 73–94

`handleAdd` has no `catch`, so network or validation errors silently leave the form open with `saving === false` and the user has no feedback.

**Recommendation:** Check `res.error`, show `toast.error`, and keep the form open on failure.

---

### 🟡 F7. Reserve-bucket inputs accept negatives and very large values
**File:** `apps/web/src/app/app/financial-flow/page.tsx`  
**Lines:** 237–252

Target and current amount inputs are plain `type="number"` with no `min`, no `max`, and no currency formatting.

**Recommendation:** Swap to the existing `<CurrencyInput min={0} />` and disable submit until inputs are valid.

---

### 🟡 F8. `financial-intelligence-panel` collapses forecast months across years
**File:** `apps/web/src/app/app/money/components/financial-intelligence-panel.tsx`  
**Lines:** 96–113

`pushMonth` keys the aggregation map by short month label (`"Jan"`, `"Feb"`, …). A forecast spanning a year boundary overwrites earlier months.

**Recommendation:** Key by `YYYY-MM` and render a formatted month label.

---

### 🟡 F9. Hardcoded `$` in intelligence panel
**File:** `apps/web/src/app/app/money/components/financial-intelligence-panel.tsx`  
**Lines:** 268, 303

Forecast mini-bars and expense-vs-budget labels use `$` instead of the business currency.

**Recommendation:** Use the existing `fmtMoney()` helper.

---

### 🟡 F10. “Review” insight action is a no-op
**File:** `apps/web/src/app/app/money/components/financial-intelligence-panel.tsx`  
**Lines:** 371–374

The `actionLabel` button has no `onClick` or `href`.

**Recommendation:** Wire it to a relevant route or remove the button.

---

### 🟡 F11. `financial-intelligence-panel` poll races with in-flight requests
**File:** `apps/web/src/app/app/money/components/financial-intelligence-panel.tsx`  
**Lines:** 147–151

`setInterval(load, 5 * 60 * 1000)` fires every 5 minutes even if a previous request is still in flight.

**Recommendation:** Track in-flight state and skip overlapping polls; reset the interval on manual retry.

---

### 🟡 F12. `load` is not memoized with `useCallback`
**File:** `apps/web/src/app/app/money/components/financial-intelligence-panel.tsx`  
**Lines:** 81–145

`load` is recreated every render. It is currently only used in a `useEffect` keyed to `businessId`, but it is inconsistent and easy to regress.

**Recommendation:** Wrap `load` in `useCallback` and include it in the effect dependency array.

---

### 🟡 F13. Runway units are wrong in `money-action-cards`
**File:** `apps/web/src/app/app/money/components/money-action-cards.tsx`  
**Lines:** 122–135

`runway` comes from `overview.cashRunwayMonths` but is compared to `< 30` and rendered as “days of cash left”. This fires for almost every business and displays the wrong unit.

**Recommendation:** Rename the comparison/description to months, or convert months to days using real average daily burn.

---

### 🟡 F14. Bulk action error reporting is all-or-nothing
**File:** `apps/web/src/app/app/money/components/money-action-cards.tsx`  
**Lines:** 48–82

`Promise.all` over reminders/follow-ups shows a single error toast even if only one of the calls failed.

**Recommendation:** Use `Promise.allSettled` and report per-item success/failure counts.

---

### 🟢 F15–F18. Minor front-end polish
- **Icon-only delete button lacks `aria-label`** (`financial-flow/page.tsx:282–287`).
- **Filter buttons in activity feed lack `aria-pressed`** (`money-activity-feed.tsx:206–218`).
- **`Number(inv.total) ?? 0` does not guard against `NaN`** (`money-activity-feed.tsx:87, 102, 117`).
- **Hardcoded route strings are duplicated** across cards; centralize in `lib/nav-config.ts`.

---

## 2. Back-End Findings

### 🔴 B1. Cashflow forecast reads recurring bills from the wrong table
**File:** `apps/server/src/modules/finance/cashflow-forecast.service.ts`  
**Lines:** 68–76

```ts
(this.prisma.client as any).expense.findMany({
  where: { businessId, isRecurring: true, status: 'BILL', nextRunDate: { gte: now, lte: horizonEnd } },
})
```

`Expense` has no `nextRunDate` field; that field lives on `RecurringExpense`. The cast to `any` bypasses TypeScript but causes the query to omit all recurring bills at runtime (or throw, depending on Prisma version).

**Recommendation:** Query `prisma.recurringExpense.findMany` with `nextRunDate` in the horizon window and remove the `as any` cast.

---

### 🔴 B2. Cashflow forecast uses full invoice total for partially-paid invoices
**File:** `apps/server/src/modules/finance/cashflow-forecast.service.ts`  
**Lines:** 59–66, 90–97

Open invoices include `PARTIALLY_PAID`, but the forecast inflow uses `Number(inv.total)` without subtracting payments already received.

**Recommendation:** Compute outstanding per invoice (`total - successfulPayments`) and use that as the inflow amount.

---

### 🔴 B3. Credit-note application cannot find invoice ledger entries
**File:** `apps/server/src/modules/finance/credit-note.service.ts`  
**Lines:** 111, 124

Queries `transaction.sourceType: 'INVOICE'` (uppercase), but revenue postings store `'Invoice'` (title-case) in `apps/server/src/modules/finance/revenue-posting.service.ts:160`.

**Recommendation:** Standardize on one case (prefer the existing `'Invoice'` / `'Payment'` convention) and migrate historical rows if needed.

---

### 🔴 B4. Reconciliation system balance ignores opening balance
**File:** `apps/server/src/modules/finance/reconciliation.service.ts`  
**Lines:** 49–61

`computeSystemBalance` loads `openingBalance` but returns only `ledgerNet`. An account with an opening balance and no ledger entries reports `0`.

**Recommendation:** Return `ledgerNet + openingBalance`, or document and test the intended behavior.

---

### 🔴 B5. Finance Overview cache is never invalidated
**File:** `apps/server/src/modules/finance/finance-overview.service.ts`  
**Lines:** 83–87, 362–364

A 60-second Redis cache is written on every load, but `invalidateCache()` is defined and never called by any producer.

**Recommendation:** Call `overview.invalidateCache(businessId)` from all finance write paths (postings, invoice status changes, expense/bill creation, reserve-bucket updates) or switch to event-based invalidation.

---

### 🔴 B6. Cash reserve update performs unauthorized cross-tenant write
**File:** `apps/server/src/modules/finance/cash-reserve.service.ts`  
**Lines:** 43–55 (`update`), 58–65 (`delete`)

```ts
prisma.cashReserveBucket.update({ where: { id } })
```

runs before the `bucket.businessId !== businessId` check. The check only fires after the mutation and throws a plain `Error`.

**Recommendation:** Scope the `where` clause to `{ id, businessId }` and throw `ForbiddenException` before mutating.

---

### 🔴 B7. Finance Overview GET endpoint mutates the database
**File:** `apps/server/src/modules/finance/finance-overview.service.ts`  
**Lines:** 98–100, 289–319

A dashboard read triggers account/COA seeding and upserts up to 25 `RevenueAction` rows. This makes the endpoint non-idempotent under load and breaks the expectation that GET requests are read-only.

**Recommendation:** Move synthetic action generation to a background job or write-side hook; keep `getOverview` a pure aggregate read.

---

### 🔴 B8. Overview silently swallows Redis failures
**File:** `apps/server/src/modules/finance/finance-overview.service.ts`  
**Lines:** 85–86, 91–93, 362–364

All Redis calls are wrapped in `.catch(() => {})`. If Redis is down or returns corrupt data, the service silently serves stale cache or skips caching.

**Recommendation:** Log cache failures at `warn` level with context; consider a circuit-breaker or fallback.

---

### 🔴 B9. Authorization is inconsistent across finance endpoints
**File:** `apps/server/src/modules/finance/finance.controller.ts`  
**Lines:** 202–220, 957–960, 963–971, 974–977

Some endpoints call `this.ensureAccess()`, others rely only on the class-level `BusinessGuard`. The duplication is inconsistent and error-prone; a future refactor could remove the guard and leave endpoints exposed.

**Recommendation:** Use a single source of truth for authorization. Either rely entirely on `BusinessGuard` or make `ensureAccess` the single enforcer and add explicit SUPER_ADMIN policy tests.

---

### 🔴 B10. Overview write side effects run even for read-only users
**File:** `apps/server/src/modules/finance/finance-overview.service.ts`  
**Lines:** 89–366

Because `getOverview` writes `RevenueAction` rows, any future read-only member role will still trigger mutations.

**Recommendation:** Separate reads from writes (same as B7).

---

### 🟡 B11–B22. Selected medium back-end issues
| # | Finding | File | Lines | Recommendation |
|---|---------|------|-------|----------------|
| B11 | Safe-to-spend operating buffer comment says “minimum 10% or 500” but code uses `Math.max(cashBalance * 0.1, 500)` | `safe-to-spend.service.ts` | 72–73 | Clarify product intent and fix the formula or comment |
| B12 | `monthExpenses` aggregates all expenses regardless of `status` (VOID, unpaid bills) | `finance-overview.service.ts` | 136–139 | Exclude VOID and respect accounting basis |
| B13 | `billsDue` sums recurring expenses by `date`, not actual unpaid bills by `dueDate` | `finance-overview.service.ts` | 167–175 | Query `status: 'BILL'` with `dueDate` within window |
| B14 | Money Moves burn calculation includes void/unpaid expenses | `money-moves.service.ts` | 133–135 | Exclude VOID and restrict to paid expenses |
| B15 | Tax rate resolution heuristic misinterprets stored values | `tax-liability.service.ts` | 94–109 | Enforce consistent fraction storage and remove heuristic |
| B16 | Fixed-asset depreciation can post into closed accounting periods | `fixed-asset.service.ts` | 141–180 | Reject dates in closed periods |
| B17 | Fixed-asset disposal hardcodes settlement to `BANK` | `fixed-asset.service.ts` | 204–232 | Accept a validated settlement account id |
| B18 | Recurring journal entries emit outside a single transaction | `recurring-journal-entry.service.ts` | 132–203 | Pass a shared transaction client to posting + scheduler update |
| B19 | Recurring journal scheduler has no distributed lock | `recurring-journal-entry.service.ts` | 31–57 | Use Redis or DB advisory lock |
| B20 | Bank rule matching logs to `console.warn` | `bank-rule.service.ts` | 155 | Inject NestJS `Logger` |
| B21 | Recurring journal scheduler silently disables entries after 5 failures | `recurring-journal-entry.service.ts` | 144–160 | Log errors and emit metrics |
| B22 | Receivables aging loads all invoices and all payment entries unbounded | `receivables.service.ts` | 222–240 | Add pagination / scope payments to relevant invoices |

---

### 🟢 B23–B28. Minor back-end polish
- No DTO validation on most finance controller inputs (`finance.controller.ts` throughout).
- Bank import CSV dedupe key ignores description, causing collisions (`bank-import.service.ts:217–219`).
- Finance intelligence insight cache is in-memory only (`finance-intelligence.service.ts:88, 841–877`).
- Redis module has no health indicator (`redis.module.ts:7–31`).
- No distributed tracing on high-value operations (`posting.service.ts`, `reconciliation.service.ts`).
- Audit log warning message has a typo (`finance-audit.service.ts:66`).

---

## 3. Database / Schema Findings

### 🔴 D1. Monetary fields use `Float` instead of `Decimal(18,4)`
**File:** `packages/db/prisma/schema.prisma`  
**Lines:** 1739–1749, 1815–1817, 2991–2997, 3051–3068, 4486–4504, 3210–3212

The schema header at line 7360 explicitly states *“monetary fields use Decimal(18,4) (NOT Float) because rounding drift accumulates over a ledger and breaks reconciliation.”* Yet `Invoice.subtotal/taxAmount/total/discount*`, `InvoiceItem.unitPrice/total`, `Payment.amount`, `Expense/RecurringExpense.amount`, `QuoteItem.*`, `FinanceProfile.*`, `ExpenseBudget.amount`, and `Business.defaultTaxRate` are all `Float`.

**Recommendation:** Migrate these columns to `Decimal @db.Decimal(18, 4)` and update services that cast to `Number()` to use `Prisma.Decimal` arithmetic.

---

### 🔴 D2. Missing index for `LedgerEntry` account-only aggregations
**File:** `packages/db/prisma/schema.prisma`  
**Lines:** 7528–7532

`LedgerBalanceService.getAccountBalance()` filters by `accountId` only. The existing index `(businessId, accountId, date)` cannot be used because `accountId` is not the leading column.

**Recommendation:** Add `@@index([accountId, date])` on `LedgerEntry`.

---

### 🟡 D3–D10. Selected medium schema issues
| # | Finding | File / Lines | Recommendation |
|---|---------|--------------|----------------|
| D3 | `Expense.projectId/contactId/serviceId` and `RecurringExpense` equivalents are plain `String?` with no FK constraints | `schema.prisma:3026–3028, 3081–3083` | Add `@relation` + FK or remove if unused |
| D4 | `Business.defaultCash/Ar/Ap/TaxAccountId` are plain `String?` with no FK | `schema.prisma:240–248` | Add FK constraints to `FinancialAccount` |
| D5 | `BankTransaction.matchedTransactionId` has no FK | `schema.prisma:7551` | Add formal relation to `FinancialTransaction` |
| D6 | `CreditNote.reversalTransactionId` has no FK or index | `schema.prisma:7742` | Add relation + index |
| D7 | `FinancialAccount.currentBalance` is stored and can drift from ledger | `schema.prisma:7386` | Compute on read or add sync trigger/job |
| D8 | `Reconciliation.difference` is a stored computed value that can become stale | `schema.prisma:7579` | Compute in API layer or refresh on ledger events |
| D9 | Status/type fields are plain `String` instead of enums | Throughout finance models | Convert to Prisma enums |
| D10 | JSONB columns used for filtering lack GIN indexes | `schema.prisma:7480, 7553, 7737, 3021, 7706` | Add GIN indexes or normalize frequently queried keys |

---

### 🟡 D11–D14. Migration safety
| # | Finding | File | Recommendation |
|---|---------|------|----------------|
| D11 | Large multi-table finance migration holds a long transaction | `migrations/20260609180418_add_finance_control_models/migration.sql` | Split broad schema additions into smaller migrations for production |
| D12 | Index creation does not use `CONCURRENTLY` | `migrations/20260611135733_add_finance_indexes/migration.sql` | Use `CREATE INDEX CONCURRENTLY` for large tables |
| D13 | Tax liability unique constraint drop/create has a brief uniqueness window | `migrations/20260605100000_fin7_tax_liability_amendments/migration.sql` | Run in a maintenance window |
| D14 | Expense `paid_at` backfill uses `date` without validation | `migrations/20260513000000_add_finance_expense_ledger/migration.sql` | Validate backfill results and consider a safer default |

---

### 🟢 D15–D18. Minor schema polish
- Naming mismatch: UI refers to `ReserveBucket` / `TaxPayment` but models are `CashReserveBucket` / `TaxLiability`.
- `Invoice` soft-delete leaves `Payment` rows active (hard FK, no soft-delete cascade).
- Several service hot paths use JS loops instead of Prisma aggregates (`TaxLiabilityService`, `AccountingPeriodService`).
- `BankRuleService.applyRules()` calls `posting.post()` inside a loop, creating one transaction per match.

---

## 4. Cross-Cutting Concerns

### 🔴 C1. Duplicated/complementary data fetches across the money hub
`financial-flow/page.tsx`, `financial-intelligence-panel.tsx`, and any overview client all call `/overview` and/or `/cashflow-forecast` independently. This causes over-fetching and can show inconsistent numbers on the same screen.

**Recommendation:** Hoist finance overview data into a shared hook/provider (e.g., `useFinanceOverview`) with a single request and SWR-style refresh.

---

### 🟡 C2. No request deduplication or cache invalidation
`apiGet` appends `_t=${Date.now()}` and uses `cache: "no-store"`, so every mount refetches; after mutations the forecast/safe-to-spend data becomes stale.

**Recommendation:** Implement TanStack Query / SWR or a lightweight in-flight request dedupe + manual invalidation after writes.

---

### 🟡 C3. Client-side businessId is read independently in every component
If a user switches workspaces, already-mounted panels keep the old ID and stale data.

**Recommendation:** Use a workspace context that emits changes and re-initializes dependent components.

---

## 5. Recommended Remediation Roadmap

### Week 1 — Critical correctness & trust
1. Fix the cashflow forecast server query to use `RecurringExpense` and outstanding invoice amounts (B1, B2).
2. Fix the `financial-flow` front-end to consume `CashflowForecastDto` correctly (F1).
3. Fix the credit-note `sourceType` case mismatch (B3).
4. Stop swallowing errors in `financial-flow/page.tsx` (F2, F5, F6).
5. Remove duplicate “Add bucket” button (F4).
6. Fix runway units in `money-action-cards` (F13).

### Week 2 — Integrity & security
1. Scope cash-reserve writes to `{ id, businessId }` and add `ForbiddenException` (B6).
2. Move `FinanceOverview` write side effects out of the GET path (B7, B10).
3. Wire `invalidateCache()` into all finance mutations (B5).
4. Standardize authorization to a single source of truth (B9).
5. Log Redis failures instead of swallowing them (B8).

### Week 3 — Schema & performance
1. Migrate monetary columns from `Float` to `Decimal(18,4)` (D1).
2. Add missing indexes (`LedgerEntry.accountId`, `CreditNote.reversalTransactionId`, FKs for orphaned IDs) (D2, D5, D6).
3. Convert closed-vocabulary status/type fields to enums (D9).
4. Add caching to `safe-to-spend`, `cashflow-forecast`, and `money-moves` (B22 / performance).

### Week 4 — UX polish & operations
1. Add form validation and accessible labels to reserve-bucket creation/deletion.
2. Add keyboard navigation and ARIA roles to `SmartEntitySearch`.
3. Add Redis health indicator and scheduler failure metrics.
4. Centralize route strings and currency formatting.

---

## 6. Files of Interest

```
apps/web/src/app/app/financial-flow/page.tsx
apps/web/src/app/app/money/components/financial-intelligence-panel.tsx
apps/web/src/app/app/money/components/money-action-cards.tsx
apps/web/src/app/app/money/components/money-activity-feed.tsx
apps/web/src/app/app/money/components/money-flow-bar.tsx
apps/web/src/components/finance/inline-line-item-builder.tsx
apps/web/src/components/finance/smart-entity-search.tsx
apps/web/src/lib/api/finance.ts

apps/server/src/modules/finance/cashflow-forecast.service.ts
apps/server/src/modules/finance/credit-note.service.ts
apps/server/src/modules/finance/finance-overview.service.ts
apps/server/src/modules/finance/safe-to-spend.service.ts
apps/server/src/modules/finance/cash-reserve.service.ts
apps/server/src/modules/finance/reconciliation.service.ts
apps/server/src/modules/finance/recurring-journal-entry.service.ts
apps/server/src/modules/finance/receivables.service.ts
apps/server/src/modules/finance/finance.controller.ts
apps/server/src/modules/finance/posting.service.ts
apps/server/src/core/redis/redis.service.ts

packages/db/prisma/schema.prisma
packages/db/prisma/migrations/20260611135733_add_finance_indexes/migration.sql
packages/db/prisma/migrations/20260609180418_add_finance_control_models/migration.sql
```

---

*End of audit. The next step is to prioritize the Week 1 items and create implementation tickets or proceed directly with fixes.*
