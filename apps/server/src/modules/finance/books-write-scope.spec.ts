import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { MarketplaceController } from '../marketplace/marketplace.controller';
import { MODULE_SCOPE_KEY, ModuleScopeGuard } from '../../core/auth/module-scope.guard';

/**
 * PR195-BOOKS-DOORS (review finding SEC-P195JS-1, a class that exists on main too): every door that
 * writes the Books checked membership only. PR195-JOURNAL-SCOPE gated POST journal-entries and the
 * recurring templates at revenue write, but a member with no revenue scope still posted an
 * arbitrary-amount ADJUSTMENT through POST bank-transactions/import + POST bank-rules + POST
 * bank-rules/apply, and the other Books writes on this controller (auto-match, which applies the rules
 * and so posts; matching; reconciliation, whose completion locks ledger lines; tax-liability file and
 * pay, which posts; fixed-asset depreciate and dispose, which post; the opening balance an account
 * create posts; accounting-period close and reopen, which stamp every transaction of the month) were
 * the same door. Beside them, MarketplaceController's purchase-order advance (RECEIVED posts the stock
 * purchase, DR inventory / CR payables or bank) checked membership only too.
 *
 * THE RULE (the default an owner can change; see the packet's owner questions):
 *   - a write of the Books (a journal, an adjustment, a bank rule, a statement import and its profile,
 *     a match, a reconciliation, an opening balance or a bank/cash account, a fixed asset and its
 *     depreciation or disposal, a tax liability's recompute or filing, an accounting period and its
 *     close or reopen) needs revenue write: D-57 makes revenue the Books' module ("No new module
 *     key"), its reads are revenue read and its manual writes (credit notes, the journal) revenue write;
 *   - a payment out of the business that is an expense by nature needs expenses write, the scope
 *     bills/:id/pay needs: a tax liability's pay, and a purchase order's advance (its receipt books the
 *     stock bought, as a payable or as paid);
 *   - a door that is both would need both (payroll mark-paid: operations write on the route and
 *     expenses write in PayrollService); none of the doors here is both.
 * Each through RequireModuleScope + ModuleScopeGuard, refused 403 before the handler, so a refused
 * call reads and writes nothing; ensureAccess stays on every finance route (and the purchase-order
 * doors get the same membership check), so a platform SUPER_ADMIN who is not a member, whom the guard
 * passes, is refused (D-46). The FIN7 alias routes (tax/liabilities/...) are handlers of their own, so
 * each carries its decorator. The recurring template reads carry amounts, so they need revenue read
 * (D-57, review SEC-P195JS-2), as GET journal-entries does.
 *
 *   BWS-U01  RED-BEFORE  every Books write above runs ModuleScopeGuard with revenue write
 *   BWS-U02  RED-BEFORE  tax-liability pay (and its alias) runs it with expenses write
 *   BWS-U03  RED-BEFORE  GET recurring-journal-entries and GET recurring-journal-entries/:id need revenue read
 *   BWS-U04  RED-BEFORE  every write route on FinanceController carries a module scope or is a reviewed
 *                        exemption (with the reason it writes nothing of the ledger)
 *   BWS-U05  RED-BEFORE  the purchase-order advance and PATCH run ModuleScopeGuard with expenses write
 */

const REVENUE_WRITE = { module: 'revenue', minLevel: 'write' };
const REVENUE_READ = { module: 'revenue', minLevel: 'read' };
const EXPENSES_WRITE = { module: 'expenses', minLevel: 'write' };

const scopeOf = (handler: unknown) => Reflect.getMetadata(MODULE_SCOPE_KEY, handler as object);
const guardsOf = (handler: unknown) => Reflect.getMetadata(GUARDS_METADATA, handler as object);
const routeOf = (handler: unknown) =>
  `${RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler as object) as number]} ${Reflect.getMetadata(PATH_METADATA, handler as object)}`;
const finance = FinanceController.prototype as unknown as Record<string, unknown>;
const marketplace = MarketplaceController.prototype as unknown as Record<string, unknown>;

/** [handler, its route, the scope it needs]. */
const BOOKS_WRITES: ReadonlyArray<readonly [string, string]> = [
  // bank and cash accounts: create posts the opening balance against owner equity (V1-37b)
  ['createAccount', 'POST accounts'],
  ['updateAccount', 'PATCH accounts/:id'],
  ['archiveAccount', 'DELETE accounts/:id'],
  // bank rules: what an apply, an auto-match or an import posts
  ['createBankRule', 'POST bank-rules'],
  ['updateBankRule', 'PATCH bank-rules/:id'],
  ['deleteBankRule', 'DELETE bank-rules/:id'],
  ['applyBankRules', 'POST bank-rules/apply'],
  ['applyBankRulesToAccount', 'POST accounts/:accountId/bank-rules/apply'],
  // statement lines and their matching (auto-match applies the rules first, so it posts)
  ['importBankCsv', 'POST accounts/:accountId/bank-transactions/import'],
  ['saveImportProfile', 'POST accounts/:accountId/import-profile'],
  ['runAutoMatch', 'POST accounts/:accountId/bank-transactions/auto-match'],
  ['manualMatch', 'POST bank-transactions/:bankTransactionId/match'],
  ['unmatch', 'POST bank-transactions/:bankTransactionId/unmatch'],
  ['ignoreBankRow', 'POST bank-transactions/:bankTransactionId/ignore'],
  // reconciliation (complete locks the ledger lines of the period)
  ['createReconciliation', 'POST reconciliations'],
  ['completeReconciliation', 'POST reconciliations/:id/complete'],
  // tax liabilities: what a pay posts, and the filing
  ['recomputeTaxLiabilities', 'POST tax-liabilities/recompute'],
  ['recomputeTaxLiabilitiesAlias', 'POST tax/liabilities/recompute'],
  ['fileTaxLiability', 'POST tax-liabilities/:id/file'],
  ['fileTaxLiabilityAlias', 'POST tax/liabilities/:id/file'],
  // fixed assets: what a depreciation posts, the depreciation and the disposal
  ['createFixedAsset', 'POST fixed-assets'],
  ['updateFixedAsset', 'PATCH fixed-assets/:id'],
  ['depreciateFixedAsset', 'POST fixed-assets/:id/depreciate'],
  ['disposeFixedAsset', 'POST fixed-assets/:id/dispose'],
  ['deleteFixedAsset', 'DELETE fixed-assets/:id'],
  // accounting periods (close and reopen stamp every transaction of the month)
  ['createAccountingPeriod', 'POST accounting-periods'],
  ['updateAccountingPeriod', 'PATCH accounting-periods/:id'],
  ['closeAccountingPeriod', 'POST accounting-periods/:id/close'],
  ['reopenAccountingPeriod', 'POST accounting-periods/:id/reopen'],
  ['deleteAccountingPeriod', 'DELETE accounting-periods/:id'],
];

const EXPENSE_PAYMENTS: ReadonlyArray<readonly [string, string]> = [
  ['payTaxLiability', 'POST tax-liabilities/:id/pay'],
  ['payTaxLiabilityAlias', 'POST tax/liabilities/:id/pay'],
];

/**
 * The write routes on FinanceController that keep no module scope, each with why it writes nothing of
 * the ledger (a change here is a reviewed change). Open items, not rulings: the chart, the tax rates,
 * the reserves, the bank connections and the exchange rates are listed as owner questions.
 */
const REVIEWED_UNSCOPED: Readonly<Record<string, string>> = {
  'POST intelligence/scan': 'finance intelligence: recomputes suggested actions, no Books row',
  'POST intelligence/actions/:id/resolve': 'finance intelligence: marks a suggested action, no Books row',
  'POST intelligence/actions/:id/dismiss': 'finance intelligence: marks a suggested action, no Books row',
  'POST chart-of-accounts': 'the chart: a row postings may name, posting nothing and fixing no amount (owner question)',
  'PATCH chart-of-accounts/:id': 'the chart: a row postings may name, posting nothing and fixing no amount (owner question)',
  'DELETE chart-of-accounts/:id': 'the chart: archives a row, posting nothing (owner question)',
  'POST tax-rates': 'tax rates: invoice settings; the default rate is the owner-only profile (D-11)',
  'PATCH tax-rates/:id': 'tax rates: invoice settings; the default rate is the owner-only profile (D-11)',
  'DELETE tax-rates/:id': 'tax rates: invoice settings; the default rate is the owner-only profile (D-11)',
  'PATCH settings': 'finance settings; the default tax rate is the owner-only profile (D-11)',
  'POST accounts/:accountId/statement-sources': "the business owner's (D-132): assertGoogleConnectOwner",
  'POST accounts/:accountId/statement-sources/:source/sweep': "the business owner's (D-132): assertGoogleConnectOwner",
  'POST reserves': 'cash reserve buckets: a safe-to-spend figure, not the ledger (owner question)',
  'PATCH reserves/:id': 'cash reserve buckets: a safe-to-spend figure, not the ledger (owner question)',
  'DELETE reserves/:id': 'cash reserve buckets: a safe-to-spend figure, not the ledger (owner question)',
  'POST bank-connections': 'a bank connection: the provider link, no statement line or posting (owner question)',
  'PATCH bank-connections/:id': 'a bank connection: the provider link, no statement line or posting (owner question)',
  'POST bank-connections/:id/sync': 'records the provider sync cursor only (BankConnectionService.recordSync)',
  'DELETE bank-connections/:id': 'a bank connection: the provider link, no statement line or posting (owner question)',
  'POST exchange-rates': 'exchange rates: no posting reads them (D-13: one currency per business)',
  'POST exchange-rates/bulk': 'exchange rates: no posting reads them (D-13: one currency per business)',
  'DELETE exchange-rates/:id': 'exchange rates: no posting reads them (D-13: one currency per business)',
};

describe('PR195-BOOKS-DOORS: every door that writes the Books needs a module write (SEC-P195JS-1)', () => {
  it.each(BOOKS_WRITES)('BWS-U01 RED-BEFORE: %s (%s) runs ModuleScopeGuard with revenue write', (method, route) => {
    expect(routeOf(finance[method])).toBe(route);
    expect(scopeOf(finance[method])).toEqual(REVENUE_WRITE);
    expect(guardsOf(finance[method])).toEqual([ModuleScopeGuard]);
  });

  it.each(EXPENSE_PAYMENTS)('BWS-U02 RED-BEFORE: %s (%s), a payment out, runs ModuleScopeGuard with expenses write', (method, route) => {
    expect(routeOf(finance[method])).toBe(route);
    expect(scopeOf(finance[method])).toEqual(EXPENSES_WRITE);
    expect(guardsOf(finance[method])).toEqual([ModuleScopeGuard]);
  });

  it.each([
    ['listRecurringJournals', 'GET recurring-journal-entries'],
    ['getRecurringJournal', 'GET recurring-journal-entries/:id'],
  ])('BWS-U03 RED-BEFORE: %s (%s) needs revenue read, as GET journal-entries (D-57, SEC-P195JS-2)', (method, route) => {
    expect(routeOf(finance[method])).toBe(route);
    expect(scopeOf(finance[method])).toEqual(REVENUE_READ);
    expect(guardsOf(finance[method])).toEqual([ModuleScopeGuard]);
  });

  it('BWS-U04 RED-BEFORE: every write route on FinanceController carries a module scope, or is a reviewed exemption', () => {
    const unscoped: string[] = [];
    for (const name of Object.getOwnPropertyNames(finance)) {
      const handler = finance[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const verb = Reflect.getMetadata(METHOD_METADATA, handler as object) as number | undefined;
      if (verb === undefined || verb === RequestMethod.GET) continue;
      if (scopeOf(handler)) {
        expect(guardsOf(handler), name).toEqual([ModuleScopeGuard]);
        continue;
      }
      unscoped.push(routeOf(handler));
    }
    expect(unscoped.sort()).toEqual(Object.keys(REVIEWED_UNSCOPED).sort());
  });

  it.each([
    ['advancePurchaseOrderStatus', 'POST businesses/:businessId/purchase-orders/:poId/advance'],
    ['updatePurchaseOrder', 'PATCH businesses/:businessId/purchase-orders/:poId'],
  ])('BWS-U05 RED-BEFORE: MarketplaceController.%s (%s) runs ModuleScopeGuard with expenses write (a receipt posts the purchase)', (method, route) => {
    expect(routeOf(marketplace[method])).toBe(route);
    expect(scopeOf(marketplace[method])).toEqual(EXPENSES_WRITE);
    expect(guardsOf(marketplace[method])).toEqual([ModuleScopeGuard]);
  });
});
