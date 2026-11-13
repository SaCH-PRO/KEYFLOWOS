import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { ExpensesController } from '../expenses/expenses.controller';
import { BillsController } from '../expenses/bills.controller';
import { RecurringExpensesController } from '../expenses/recurring-expenses.controller';
import { MODULE_SCOPE_KEY, ModuleScopeGuard } from '../../core/auth/module-scope.guard';

/**
 * PR195-KEY-GATES (review findings SEC-P195BW-4, SEC-P195BW-7; owner rulings D-57, D-146, D-46).
 *
 * D-146: "Books reads, recurring-journal templates included, need revenue read." The packet before gated
 * only the recurring-template reads, so a member with no revenue access still read, on FinanceController,
 * the account list with each bank and cash balance, a bank account's statement lines with the General
 * Journal postings offered beside them, the bank rules, the reconciliations and their reports, the tax
 * liabilities with the PAID invoices (customer name and email) behind them, the fixed assets and their
 * depreciation, the accounting periods, the cash reserves and the finance action items. Each is gated here
 * at revenue read (ModuleScopeGuard + RequireModuleScope, 403 before the handler); ensureAccess stays on each,
 * so a platform SUPER_ADMIN who is not a member is still refused (D-46). GET expense-breakdown sums the month's
 * Expense rows against their budgets, the data of GET expenses/summary, so it takes that route's scope,
 * expenses read. The reads that carry no figure of the business (its settings, tax rates, chart of
 * accounts, exchange rates and bank-connection status) stay membership-only, each listed with its reason.
 *
 * D-46 (SEC-P195BW-7): a platform SUPER_ADMIN who is not a member writes none of the business's books. The
 * FinanceController doors and the purchase-order doors already refused them; the expense-natured payment
 * doors, which post the ledger the same way, did not (BusinessGuard and ModuleScopeGuard both pass that
 * role): POST expenses and its edit and delete (which re-post or reverse), POST bills and a bill's pay and
 * void, and a recurring expense's run-now. Each now runs BusinessMemberGuard (a Membership of the business).
 *
 *   BRS-U01  RED-BEFORE  every Books read below runs ModuleScopeGuard with revenue read
 *   BRS-U02  RED-BEFORE  GET expense-breakdown runs it with expenses read
 *   BRS-U03  RED-BEFORE  every GET on FinanceController carries a module scope or is a reviewed exemption
 *   BRS-U04  RED-BEFORE  the expense-natured doors that post the ledger run BusinessMemberGuard (D-46)
 */

const REVENUE_READ = { module: 'revenue', minLevel: 'read' };
const EXPENSES_READ = { module: 'expenses', minLevel: 'read' };

const scopeOf = (handler: unknown) => Reflect.getMetadata(MODULE_SCOPE_KEY, handler as object);
const guardsOf = (handler: unknown) => (Reflect.getMetadata(GUARDS_METADATA, handler as object) ?? []) as unknown[];
const routeOf = (handler: unknown) =>
  `${RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler as object) as number]} ${Reflect.getMetadata(PATH_METADATA, handler as object)}`;
const finance = FinanceController.prototype as unknown as Record<string, unknown>;

const BOOKS_READS: ReadonlyArray<readonly [string, string]> = [
  // the accounts with their opening and current balances
  ['listAccounts', 'GET accounts'],
  // a bank account's statement lines and the ledger postings offered to match them
  ['listBankTransactions', 'GET accounts/:accountId/bank-transactions'],
  // the bank rules (what they post, and to which account)
  ['listBankRules', 'GET bank-rules'],
  ['getBankRule', 'GET bank-rules/:id'],
  // reconciliations, their reports and the CSV
  ['listReconciliations', 'GET reconciliations'],
  ['getReconciliation', 'GET reconciliations/:id'],
  ['reconciliationReport', 'GET reconciliations/:id/report'],
  ['reconciliationReportCsv', 'GET reconciliations/:id/report.csv'],
  // tax liabilities (amounts due), the PAID invoices behind one, the tax calendar; and the FIN7 aliases,
  // handlers of their own
  ['listTaxLiabilities', 'GET tax-liabilities'],
  ['getTaxLiability', 'GET tax-liabilities/:id'],
  ['taxContributingInvoices', 'GET tax-liabilities/:id/contributing-invoices'],
  ['taxCalendar', 'GET tax-calendar'],
  ['listTaxLiabilitiesAlias', 'GET tax/liabilities'],
  ['getTaxLiabilityAlias', 'GET tax/liabilities/:id'],
  ['taxContributingInvoicesAlias', 'GET tax/liabilities/:id/contributing-invoices'],
  // fixed assets, their book values and depreciation
  ['listFixedAssets', 'GET fixed-assets'],
  ['getFixedAsset', 'GET fixed-assets/:id'],
  ['calculateDepreciation', 'GET fixed-assets/:id/depreciation'],
  // accounting periods (the close and its lock)
  ['listAccountingPeriods', 'GET accounting-periods'],
  ['getAccountingPeriod', 'GET accounting-periods/:id'],
  // cash reserve buckets (amounts set aside, a safe-to-spend figure)
  ['listReserves', 'GET reserves'],
  // the finance action items and the insight strip (overdue amounts, cash-flow risk)
  ['listIntelActions', 'GET intelligence/actions'],
  ['getIntelInsight', 'GET intelligence/insight'],
];

/** The GETs on FinanceController that keep no module scope, each with why it carries no figure (a change here is reviewed). */
const REVIEWED_UNSCOPED_READS: Readonly<Record<string, string>> = {
  'GET settings': 'finance settings (currency, basis, default rate): what every money form needs to render, no figure',
  'GET tax-rates': 'tax rates: invoice and expense forms need them, no figure of the business',
  'GET chart-of-accounts': 'the chart: account names and codes postings may name, no balance',
  'GET exchange-rates': 'market exchange rates, no figure of the business (D-13: one currency per business)',
  'GET exchange-rates/latest': 'market exchange rates, no figure of the business (D-13: one currency per business)',
  'GET bank-connections': 'a bank connection: provider, status and last sync, no balance or statement line',
  'GET bank-connections/:id': 'a bank connection: provider, status and last sync, no balance or statement line',
};

describe('PR195-KEY-GATES: Books reads need revenue read (D-146, SEC-P195BW-4)', () => {
  it.each(BOOKS_READS)('BRS-U01 RED-BEFORE: %s (%s) runs ModuleScopeGuard with revenue read', (method, route) => {
    expect(routeOf(finance[method])).toBe(route);
    expect(scopeOf(finance[method])).toEqual(REVENUE_READ);
    expect(guardsOf(finance[method])).toEqual([ModuleScopeGuard]);
  });

  it('BRS-U02 RED-BEFORE: GET expense-breakdown (the month\'s expenses against their budgets) runs ModuleScopeGuard with expenses read', () => {
    expect(routeOf(finance.getExpenseBreakdown)).toBe('GET expense-breakdown');
    expect(scopeOf(finance.getExpenseBreakdown)).toEqual(EXPENSES_READ);
    expect(guardsOf(finance.getExpenseBreakdown)).toEqual([ModuleScopeGuard]);
  });

  it('BRS-U03 RED-BEFORE: every GET on FinanceController carries a module scope, or is a reviewed exemption', () => {
    const unscoped: string[] = [];
    for (const name of Object.getOwnPropertyNames(finance)) {
      const handler = finance[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const verb = Reflect.getMetadata(METHOD_METADATA, handler as object) as number | undefined;
      if (verb !== RequestMethod.GET) continue;
      if (scopeOf(handler)) {
        expect(guardsOf(handler), name).toEqual([ModuleScopeGuard]);
        continue;
      }
      unscoped.push(routeOf(handler));
    }
    expect(unscoped.sort()).toEqual(Object.keys(REVIEWED_UNSCOPED_READS).sort());
  });
});

describe('PR195-KEY-GATES: a SUPER_ADMIN who is not a member posts none of the business\'s expenses (D-46, SEC-P195BW-7)', () => {
  const DOORS: ReadonlyArray<readonly [string, object, string, string]> = [
    ['ExpensesController', ExpensesController.prototype, 'createExpense', 'POST businesses/:businessId/expenses'],
    ['ExpensesController', ExpensesController.prototype, 'updateExpense', 'PATCH businesses/:businessId/expenses/:expenseId'],
    ['ExpensesController', ExpensesController.prototype, 'deleteExpense', 'DELETE businesses/:businessId/expenses/:expenseId'],
    ['BillsController', BillsController.prototype, 'createBill', 'POST businesses/:businessId/bills'],
    ['BillsController', BillsController.prototype, 'payBill', 'POST businesses/:businessId/bills/:billId/pay'],
    ['BillsController', BillsController.prototype, 'voidBill', 'POST businesses/:businessId/bills/:billId/void'],
    ['RecurringExpensesController', RecurringExpensesController.prototype, 'runNow', 'POST businesses/:businessId/recurring/:id/run'],
  ];
  it.each(DOORS)('BRS-U04 RED-BEFORE: %s.%s runs BusinessMemberGuard after ModuleScopeGuard', async (_c, proto, method) => {
    // Loaded here so the rest of this file runs (and fails on its own assertions) before the guard exists.
    const { BusinessMemberGuard } = (await import('../../core/auth/business-member.guard').catch(() => ({}))) as { BusinessMemberGuard?: unknown };
    expect(BusinessMemberGuard, 'core/auth/business-member.guard exports BusinessMemberGuard').toBeDefined();
    const handler = (proto as Record<string, unknown>)[method];
    const route = DOORS.find((d) => d[2] === method && d[1] === proto)![3];
    expect(routeOf(handler)).toBe(route);
    const guards = guardsOf(handler);
    expect(guards).toContain(ModuleScopeGuard);
    expect(guards).toContain(BusinessMemberGuard);
    expect(guards.indexOf(BusinessMemberGuard)).toBeGreaterThan(guards.indexOf(ModuleScopeGuard));
  });
});
