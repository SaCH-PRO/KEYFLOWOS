/**
 * PR195-KEY-GATES (review findings SEC-P195BW-4, SEC-P195BW-6, SEC-P195BW-7; owner rulings D-57, D-146, D-46).
 * REAL database.
 *
 * D-146: "Books reads, recurring-journal templates included, need revenue read." The packet before gated only
 * the recurring-template reads, so a member with no revenue access read, through FinanceController's
 * membership-only GETs, every bank and cash balance (GET accounts), a bank account's statement lines and
 * the General Journal postings offered beside them, the bank rules, reconciliations and their reports, tax
 * liabilities with the PAID invoices behind them, fixed assets and their depreciation, the accounting periods,
 * the cash reserves and the finance action items.
 *
 *   BRD-01  RED-BEFORE  each Books read: a revenue-none member (STAFF on an explicit map, and the D-114 ADMIN
 *                       whose revenue is 'none') is refused 403 with the guard's words and no figure; a
 *                       revenue-read member and the OWNER read it (200); a non-member SUPER_ADMIN is still
 *                       refused 'No access to this business' (D-46)
 *   BRD-02  RED-BEFORE  GET expense-breakdown: expenses read (the scope of GET expenses/summary, the same rows)
 *   BRD-03  RED-BEFORE  SEC-P195BW-6: POST accounts and PATCH accounts/:id refuse a chart row that is not this
 *                       business's with 404, in the words an unknown id gets (no existence oracle), whatever the
 *                       opening balance; nothing is written; the business's own row still works
 *   BRD-04  RED-BEFORE  SEC-P195BW-7 (D-46): the expense doors that post the ledger (POST expenses, PATCH and
 *                       DELETE expenses/:id, POST bills, bills/:id/pay, bills/:id/void, recurring/:id/run)
 *                       refuse a SUPER_ADMIN who is not a member 403 'No access to this business' and write
 *                       nothing; a member with expenses write still posts
 *   BRD-05  RED-BEFORE  ...and on KEY: the graph route's authority (assertMayRunGraphAction, which the plan
 *                       queue and approved proposals share) refuses that SUPER_ADMIN expenses_create,
 *                       finance_create_bill and finance_pay_bill; a SUPER_ADMIN who is a member passes
 *   BRD-06  RED-BEFORE  review repair SEC-P195KG-4: the chart of accounts, as SEC-P195BW-6 did for financial
 *                       accounts: FinanceCoaService.update (PATCH chart-of-accounts/:id) refuses a parentId that
 *                       is not this business's row in create()'s words, for another business's row and for an id
 *                       that exists nowhere (it answered a raw P2003, a 500: an existence oracle); nothing is
 *                       written; the business's own parent, and clearing the parent, still work
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * BusinessMemberGuard, TenantInterceptor, TeamAuditInterceptor, FinanceController, ExpensesController,
 * BillsController, RecurringExpensesController and the services the doors call (FinanceAccountsService,
 * BankMatchingService, BankRuleService, ReconciliationService, TaxLiabilityService, FixedAssetService,
 * AccountingPeriodService, PostingService, ExpensesService, ExpensePostingService, RecurringExpenseService, the
 * chart seeders) run against DATABASE_URL. Stand-ins: identity attachment (a test middleware reads `x-v98k-user`,
 * loads that seeded user row and attaches `{ id, email, role }`, as the Supabase-verifying AuthMiddleware does);
 * FinanceController's collaborators off these routes; CashReserveService and FinanceIntelligenceService (their
 * reads answer fixed rows naming a figure, so a refusal is seen to carry none); TimelineService.
 *
 * Fixtures: prefix `v98k_` (registered in test/helpers/fixture-prefixes.json); hard-deleted by raw SQL
 * (patterns built by sqlLikePrefix) in dependency order in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

vi.setConfig({ testTimeout: 30_000 });

const P = 'v98k_';
const HEADER = 'x-v98k-user';

const ID = {
  owner: `${P}owner`, // OWNER, role defaults
  revRead: `${P}revRead`, // STAFF { revenue: 'read', expenses: 'read' }
  crmOnly: `${P}crmOnly`, // STAFF { crm: 'read' }: revenue none, expenses none
  expWrite: `${P}expWrite`, // STAFF { revenue: 'read', expenses: 'write' }
  adminRevNone: `${P}adminRevNone`, // ADMIN { crm, operations, expenses admin; revenue 'none' } (D-114)
  superAdmin: `${P}super`, // platform SUPER_ADMIN, no Membership
  saMember: `${P}saMember`, // platform SUPER_ADMIN holding a STAFF membership { revenue: 'read', expenses: 'read' }
  ownerB: `${P}ownerB`,
  biz: `${P}biz`,
  bizB: `${P}bizB`,
};

const REV_READ_NONE = 'Insufficient permissions: revenue requires read access (you have none)';
const EXP_READ_NONE = 'Insufficient permissions: expenses requires read access (you have none)';
const NOT_MEMBER = 'No access to this business';
/** Figures seeded below: none may appear in a refusal. */
/** Five digits each, so no timestamp or id in a refusal can hold one by chance. */
const FIGURES = ['43219', '88887', '77711', '12003', '42421', '61617'];

let db: any;
let app: any;
let prismaSvc: any;
const COA: Record<string, string> = {};
let coaB = '';
const ROW: Record<string, string> = {};

async function cleanup() {
  for (const sql of [
    `DELETE FROM recurring_expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bank_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bank_rules WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM reconciliations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM tax_liabilities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM fixed_assets WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expense_categories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort: a table this schema does not have */ }
  }
}

const http = () => request(app.getHttpServer());
/** The JSON body of an answer, also from a route that declares another content type (the CSV report). */
const bodyOf = (res: request.Response): unknown => (res.body && Object.keys(res.body).length ? res.body : JSON.parse(res.text || '{}'));
const fin = (rest: string) => `/finance/businesses/${ID.biz}/${rest}`;
const exp = (rest: string) => `/expenses/businesses/${ID.biz}/${rest}`;
const bills = (rest: string) => `/finance/businesses/${ID.biz}/${rest}`;

/** The business's money tables, row by row (raw SQL): "nothing written" is byte-identical. */
const MONEY_TABLES = ['financial_transactions', 'ledger_entries', 'expenses', 'financial_accounts', 'recurring_expenses'];
async function money(): Promise<string> {
  const out: string[] = [];
  for (const table of MONEY_TABLES) {
    const [row]: Array<{ j: string }> = await db.$queryRawUnsafe(
      `SELECT COALESCE(json_agg(t ORDER BY t.id), '[]'::json)::text AS j FROM ${table} t WHERE t.business_id = $1`,
      ID.biz,
    );
    out.push(`${table}:${row.j}`);
  }
  return out.join('\n');
}

/** Each Books read, by its handler's route; ids filled in beforeAll. */
const BOOKS_READS = (): Array<readonly [string, string]> => [
  ['GET accounts (every balance)', fin('accounts')],
  ['GET accounts/:accountId/bank-transactions (statement lines, ledger candidates)', fin(`accounts/${ROW.bank}/bank-transactions`)],
  ['GET bank-rules', fin('bank-rules')],
  ['GET bank-rules/:id', fin(`bank-rules/${ROW.rule}`)],
  ['GET reconciliations', fin('reconciliations')],
  ['GET reconciliations/:id', fin(`reconciliations/${ROW.recon}`)],
  ['GET reconciliations/:id/report', fin(`reconciliations/${ROW.recon}/report`)],
  ['GET reconciliations/:id/report.csv', fin(`reconciliations/${ROW.recon}/report.csv`)],
  ['GET tax-liabilities', fin('tax-liabilities')],
  ['GET tax-liabilities/:id', fin(`tax-liabilities/${ROW.tax}`)],
  ['GET tax-liabilities/:id/contributing-invoices', fin(`tax-liabilities/${ROW.tax}/contributing-invoices`)],
  ['GET tax-calendar', fin('tax-calendar')],
  ['GET tax/liabilities (alias)', fin('tax/liabilities')],
  ['GET tax/liabilities/:id (alias)', fin(`tax/liabilities/${ROW.tax}`)],
  ['GET tax/liabilities/:id/contributing-invoices (alias)', fin(`tax/liabilities/${ROW.tax}/contributing-invoices`)],
  ['GET fixed-assets', fin('fixed-assets')],
  ['GET fixed-assets/:id', fin(`fixed-assets/${ROW.asset}`)],
  ['GET fixed-assets/:id/depreciation', fin(`fixed-assets/${ROW.asset}/depreciation`)],
  ['GET accounting-periods', fin('accounting-periods')],
  ['GET accounting-periods/:id', fin(`accounting-periods/${ROW.period}`)],
  ['GET reserves', fin('reserves')],
  ['GET intelligence/actions', fin('intelligence/actions')],
  ['GET intelligence/insight', fin('intelligence/insight')],
];

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitterModule } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { ExpensesController } = await import('../src/modules/expenses/expenses.controller');
  const { BillsController } = await import('../src/modules/expenses/bills.controller');
  const { RecurringExpensesController } = await import('../src/modules/expenses/recurring-expenses.controller');
  const { ExpensesService } = await import('../src/modules/expenses/expenses.service');
  const { RecurringExpenseService } = await import('../src/modules/expenses/recurring-expense.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { LedgerBalanceService } = await import('../src/modules/finance/ledger-balance.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { FinancialAccountSeederService } = await import('../src/modules/finance/financial-account-seeder.service');
  const { FinanceAccountsService } = await import('../src/modules/finance/finance-accounts.service');
  const { FinanceAuditService } = await import('../src/modules/finance/finance-audit.service');
  const { BankRuleService } = await import('../src/modules/finance/bank-rule.service');
  const { BankImportService } = await import('../src/modules/finance/bank-import.service');
  const { BankMatchingService } = await import('../src/modules/finance/bank-matching.service');
  const { ReconciliationService } = await import('../src/modules/finance/reconciliation.service');
  const { TaxLiabilityService } = await import('../src/modules/finance/tax-liability.service');
  const { FixedAssetService } = await import('../src/modules/finance/fixed-asset.service');
  const { RecurringJournalEntryService } = await import('../src/modules/finance/recurring-journal-entry.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { CashReserveService } = await import('../src/modules/finance/cash-reserve.service');
  const { FinanceIntelligenceService } = await import('../src/modules/finance/finance-intelligence.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');

  // FinanceController's collaborators off these routes.
  const stubs = await Promise.all([
    import('../src/modules/finance/receivables.service').then((m) => m.ReceivablesService),
    import('../src/modules/finance/finance-overview.service').then((m) => m.FinanceOverviewService),
    import('../src/modules/finance/finance-coa.service').then((m) => m.FinanceCoaService),
    import('../src/modules/finance/finance-tax-rate.service').then((m) => m.FinanceTaxRateService),
    import('../src/modules/finance/finance-settings.service').then((m) => m.FinanceSettingsService),
    import('../src/modules/finance/statement-source.service').then((m) => m.StatementSourceService),
    import('../src/modules/finance/accountant-export.service').then((m) => m.AccountantExportService),
    import('../src/modules/finance/accountant-export-email.service').then((m) => m.AccountantExportEmailService),
    import('../src/modules/finance/safe-to-spend.service').then((m) => m.SafeToSpendService),
    import('../src/modules/finance/cashflow-forecast.service').then((m) => m.CashflowForecastService),
    import('../src/modules/finance/money-moves.service').then((m) => m.MoneyMovesService),
    import('../src/modules/finance/credit-note.service').then((m) => m.CreditNoteService),
    import('../src/modules/finance/bank-connection.service').then((m) => m.BankConnectionService),
    import('../src/modules/finance/exchange-rate.service').then((m) => m.ExchangeRateService),
    import('../src/core/object-storage').then((m) => m.ObjectStorageService),
  ]);
  const guards: unknown[] = [PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard];
  const memberGuard = await import('../src/core/auth/business-member.guard').then((m) => m.BusinessMemberGuard).catch(() => null);
  if (memberGuard) guards.push(memberGuard);

  const moduleRef = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 })],
    controllers: [FinanceController, ExpensesController, BillsController, RecurringExpensesController],
    providers: [
      ...(guards as any[]),
      TeamAuditInterceptor,
      PostingService,
      AccountingPeriodService,
      LedgerBalanceService,
      ChartOfAccountsSeederService,
      FinancialAccountSeederService,
      FinanceAccountsService,
      FinanceAuditService,
      BankRuleService,
      BankImportService,
      BankMatchingService,
      ReconciliationService,
      TaxLiabilityService,
      FixedAssetService,
      RecurringJournalEntryService,
      ExpensePostingService,
      ExpensesService,
      RecurringExpenseService,
      { provide: CashReserveService, useValue: { list: async () => [{ id: `${P}reserve`, name: 'Tax pot', currentAmount: 42421 }] } },
      {
        provide: FinanceIntelligenceService,
        useValue: {
          list: async () => [{ id: `${P}action`, kind: 'SLOW_PAYER', title: 'Alice owes 61617', body: 'Overdue 61617' }],
          getInsightStrip: async () => ({ headline: 'Cash runway 61617 days' }),
        },
      },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: CatalogService, useValue: {} },
      ...stubs.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();
  const coa = moduleRef.get(ChartOfAccountsSeederService);
  prismaSvc = moduleRef.get(PrismaService);

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();

  for (const [id, role] of [
    [ID.owner, 'USER'], [ID.revRead, 'USER'], [ID.crmOnly, 'USER'], [ID.expWrite, 'USER'], [ID.adminRevNone, 'USER'],
    [ID.superAdmin, 'SUPER_ADMIN'], [ID.saMember, 'SUPER_ADMIN'], [ID.ownerB, 'USER'],
  ] as const) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V98K Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'V98K Other', slug: `${P}bizb`, ownerId: ID.ownerB, currency: 'TTD' } });
  const m = (userId: string, role: string, permissionScopes?: Record<string, string>, businessId = ID.biz) =>
    db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}_${businessId.slice(P.length)}`, userId, businessId, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, 'OWNER');
  await m(ID.revRead, 'STAFF', { revenue: 'read', expenses: 'read' });
  await m(ID.crmOnly, 'STAFF', { crm: 'read' });
  await m(ID.expWrite, 'STAFF', { revenue: 'read', expenses: 'write' });
  await m(ID.adminRevNone, 'ADMIN', { crm: 'admin', revenue: 'none', operations: 'admin', expenses: 'admin' });
  await m(ID.saMember, 'STAFF', { revenue: 'read', expenses: 'read' });
  await m(ID.ownerB, 'OWNER', undefined, ID.bizB);
  await coa.ensureDefaults(ID.biz);
  await coa.ensureDefaults(ID.bizB);
  for (const key of ['BANK', 'CASH', 'OWNER_EQUITY']) COA[key] = (await coa.getBySystemKey(ID.biz, key)).id;
  coaB = (await coa.getBySystemKey(ID.bizB, 'BANK')).id;

  // Figures the reads would carry.
  ROW.bank = (await db.financialAccount.create({
    data: { businessId: ID.biz, chartOfAccountId: COA.BANK, name: 'v98k main', type: 'BANK', currency: 'TTD', openingBalance: 43219, currentBalance: 43219 },
  })).id;
  await db.bankTransaction.create({ data: { businessId: ID.biz, accountId: ROW.bank, date: new Date(Date.now() - 86_400_000), description: 'v98k deposit', amount: 88887, currency: 'TTD', status: 'UNMATCHED' } });
  ROW.rule = (await db.bankRule.create({ data: { businessId: ID.biz, name: 'v98k rule', pattern: 'v98k', matchType: 'contains', accountId: COA.OWNER_EQUITY, isActive: true } })).id;
  ROW.recon = (await db.reconciliation.create({
    data: { businessId: ID.biz, accountId: ROW.bank, periodStart: new Date(Date.UTC(2000, 0, 1)), periodEnd: new Date(Date.UTC(2000, 0, 31)), statementBalance: 88887, systemBalance: 0, difference: 88887, status: 'IN_PROGRESS' },
  })).id;
  ROW.tax = (await db.taxLiability.create({
    data: { businessId: ID.biz, type: 'VAT', periodStart: new Date(Date.UTC(2002, 0, 1)), periodEnd: new Date(Date.UTC(2002, 0, 31, 23, 59, 59)), taxCollected: 77711, amountDue: 77711, status: 'OPEN' },
  })).id;
  const purchaseDate = new Date();
  purchaseDate.setUTCMonth(purchaseDate.getUTCMonth() - 12);
  ROW.asset = (await db.fixedAsset.create({
    data: { businessId: ID.biz, name: 'v98k van', category: 'vehicle', purchaseDate, purchaseCost: 12003, salvageValue: 0, usefulLifeMonths: 24, depreciationMethod: 'straight_line', accumulatedDepreciation: 0, netBookValue: 12003 },
  })).id;
  ROW.period = (await db.accountingPeriod.create({
    data: { businessId: ID.biz, year: 2003, month: 1, startDate: new Date(Date.UTC(2003, 0, 1)), endDate: new Date(Date.UTC(2003, 0, 31, 23, 59, 59, 999)), status: 'OPEN' },
  })).id;
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('fixture sanity (real rows)', () => {
  it('the business has its members on explicit maps, the Books rows with their figures; the SUPER_ADMIN is no member', async () => {
    expect(await db.membership.count({ where: { businessId: ID.biz } })).toBe(6);
    expect(await db.membership.count({ where: { userId: ID.superAdmin } })).toBe(0);
    expect(Object.values(ROW).every(Boolean)).toBe(true);
    expect(coaB && coaB !== COA.BANK).toBeTruthy();
  });
});

describe('BRD-01: the Books reads need revenue read (D-146, SEC-P195BW-4)', () => {
  it.each(BOOKS_READS().map(([name], i) => [name, i] as const))('%s', async (_name, i) => {
    const [, url] = BOOKS_READS()[i];
    // RED-BEFORE: 200 with the figures for a revenue-none member.
    for (const who of [ID.crmOnly, ID.adminRevNone]) {
      const refused = await http().get(url).set(HEADER, who);
      expect(refused.status, `${who}: ${refused.text}`).toBe(403);
      expect(bodyOf(refused)).toMatchObject({ code: 'FORBIDDEN', message: REV_READ_NONE });
      for (const f of FIGURES) expect(refused.text, `${who} sees ${f}`).not.toContain(f);
    }
    for (const who of [ID.revRead, ID.owner, ID.saMember]) {
      const ok = await http().get(url).set(HEADER, who);
      expect(ok.status, `${who}: ${JSON.stringify(ok.body)}`).toBe(200);
    }
    // D-46: the guard passes a SUPER_ADMIN; ensureAccess still refuses one who is not a member.
    const outsider = await http().get(url).set(HEADER, ID.superAdmin);
    expect(outsider.status).toBe(403);
    expect(bodyOf(outsider)).toMatchObject({ code: 'FORBIDDEN', message: NOT_MEMBER });
  });

  it('BRD-01 control: the revenue reader is served the figures the refusal withholds', async () => {
    const accounts = await http().get(fin('accounts')).set(HEADER, ID.revRead);
    expect(JSON.stringify(accounts.body)).toContain('43219');
    const lines = await http().get(fin(`accounts/${ROW.bank}/bank-transactions`)).set(HEADER, ID.revRead);
    expect(JSON.stringify(lines.body)).toContain('88887');
    const tax = await http().get(fin('tax-liabilities')).set(HEADER, ID.revRead);
    expect(JSON.stringify(tax.body)).toContain('77711');
    const assets = await http().get(fin('fixed-assets')).set(HEADER, ID.revRead);
    expect(JSON.stringify(assets.body)).toContain('12003');
  });
});

describe('BRD-02: GET expense-breakdown takes the scope of the expense rows it sums', () => {
  it('BRD-02 RED-BEFORE: expenses none is refused 403 with no figure; expenses read and the OWNER read it', async () => {
    const refused = await http().get(fin('expense-breakdown')).set(HEADER, ID.crmOnly);
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect(refused.body).toMatchObject({ code: 'FORBIDDEN', message: EXP_READ_NONE });
    for (const who of [ID.revRead, ID.owner]) expect((await http().get(fin('expense-breakdown')).set(HEADER, who)).status, who).toBe(200);
  });
});

describe('BRD-03: an account names only this business\'s chart row (SEC-P195BW-6)', () => {
  const NOT_FOUND = (id: string) => `Chart-of-account id(s) not found in this business: ${id}`;

  it('BRD-03 RED-BEFORE: POST accounts with another business\'s chart row (opening 0 and opening 50) or an unknown id: 404 in the same words, nothing written', async () => {
    for (const [chartOfAccountId, openingBalance] of [[coaB, 0], [coaB, 50], [`${P}coa_nowhere`, 0]] as const) {
      const before = await money();
      const res = await http().post(fin('accounts')).set(HEADER, ID.owner).send({ name: `v98k foreign ${openingBalance}`, type: 'BANK', openingBalance, chartOfAccountId });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body).toMatchObject({ message: NOT_FOUND(chartOfAccountId) });
      expect(await money()).toEqual(before);
    }
    expect(await db.financialAccount.count({ where: { businessId: ID.biz, chartOfAccountId: coaB } })).toBe(0);
  });

  it('BRD-03 RED-BEFORE: PATCH accounts/:id to another business\'s chart row or an unknown one: 404 in the same words (an unknown id answered 500), the link unchanged', async () => {
    const own = (await db.financialAccount.create({ data: { businessId: ID.biz, chartOfAccountId: COA.BANK, name: 'v98k patch', type: 'BANK', currency: 'TTD' } })).id;
    for (const chartOfAccountId of [coaB, `${P}coa_nowhere`]) {
      const res = await http().patch(fin(`accounts/${own}`)).set(HEADER, ID.owner).send({ chartOfAccountId });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body).toMatchObject({ message: NOT_FOUND(chartOfAccountId) });
      expect((await db.financialAccount.findUnique({ where: { id: own } })).chartOfAccountId).toBe(COA.BANK);
    }
  });

  it('BRD-03 control: the business\'s own chart row still works on both doors', async () => {
    const created = await http().post(fin('accounts')).set(HEADER, ID.owner).send({ name: 'v98k own', type: 'CASH', openingBalance: 0, chartOfAccountId: COA.CASH });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.chartOfAccountId).toBe(COA.CASH);
    const patched = await http().patch(fin(`accounts/${created.body.id}`)).set(HEADER, ID.owner).send({ chartOfAccountId: COA.BANK });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.chartOfAccountId).toBe(COA.BANK);
  });
});

describe('BRD-04/05: a SUPER_ADMIN who is not a member posts none of the business\'s expenses (D-46, SEC-P195BW-7)', () => {
  async function newExpense(status: 'PAID' | 'BILL', label: string) {
    const res = await http().post(status === 'BILL' ? bills('bills') : exp('expenses')).set(HEADER, ID.expWrite).send({ description: `v98k ${label}`, amount: 25 });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    return res.body.id as string;
  }

  it('BRD-04 RED-BEFORE: each expense door that posts the ledger refuses the outsider 403 and writes nothing; a member with expenses write posts', async () => {
    const paid = await newExpense('PAID', 'paid');
    const billToPay = await newExpense('BILL', 'bill to pay');
    const billToVoid = await newExpense('BILL', 'bill to void');
    const recurring = await db.recurringExpense.create({
      data: { businessId: ID.biz, name: 'v98k rent', description: 'v98k rent', amount: 30, frequency: 'MONTHLY', nextRunDate: new Date(), isActive: true },
    });
    const DOORS: Array<[string, () => request.Test]> = [
      ['POST expenses', () => http().post(exp('expenses')).send({ description: 'v98k outsider', amount: 99999 })],
      ['PATCH expenses/:id', () => http().patch(exp(`expenses/${paid}`)).send({ amount: 99999 })],
      ['DELETE expenses/:id', () => http().delete(exp(`expenses/${paid}`))],
      ['POST bills', () => http().post(bills('bills')).send({ description: 'v98k outsider bill', amount: 99999 })],
      ['POST bills/:id/pay', () => http().post(bills(`bills/${billToPay}/pay`)).send({})],
      ['POST bills/:id/void', () => http().post(bills(`bills/${billToVoid}/void`)).send({})],
      ['POST recurring/:id/run', () => http().post(exp(`recurring/${recurring.id}/run`)).send({})],
    ];
    for (const [name, call] of DOORS) {
      const before = await money();
      const res = await call().set(HEADER, ID.superAdmin);
      expect(res.status, `${name}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body, name).toMatchObject({ code: 'FORBIDDEN', message: NOT_MEMBER });
      expect(await money(), name).toEqual(before);
    }
    expect(await db.expense.count({ where: { businessId: ID.biz, amount: 99999 } })).toBe(0);
    // control: the member pays the bill and the ledger moves
    const before = await money();
    const pay = await http().post(bills(`bills/${billToPay}/pay`)).set(HEADER, ID.expWrite).send({});
    expect([200, 201], JSON.stringify(pay.body)).toContain(pay.status);
    expect(await money()).not.toEqual(before);
  });

  it('BRD-05 RED-BEFORE: on KEY the graph route\'s authority refuses that SUPER_ADMIN the expense writes; one who is a member passes', async () => {
    const { assertMayRunGraphAction } = await import('../src/modules/ai/graph-actions.controller');
    for (const tool of ['expenses_create', 'finance_create_bill', 'finance_pay_bill']) {
      const err = await assertMayRunGraphAction(prismaSvc, ID.biz, { id: ID.superAdmin, role: 'SUPER_ADMIN' }, tool, null).then(() => null, (e: unknown) => e);
      expect(err, tool).toBeInstanceOf(ForbiddenException);
      expect((err as Error).message, tool).toMatch(/\(D-46\)/);
      await expect(assertMayRunGraphAction(prismaSvc, ID.biz, { id: ID.saMember, role: 'SUPER_ADMIN' }, tool, null), tool).resolves.toBeUndefined();
    }
    // a read stays open to the platform role, as ModuleScopeGuard leaves it
    await expect(assertMayRunGraphAction(prismaSvc, ID.biz, { id: ID.superAdmin, role: 'SUPER_ADMIN' }, 'expenses_list', null)).resolves.toBeUndefined();
  });
});

describe('BRD-06: a chart row names only this business\'s parent (SEC-P195KG-4)', () => {
  const PARENT_REFUSAL = 'Parent account not found in this business';
  let coaSvc: any;
  let child = '';
  let ownParent = '';
  let foreign = '';
  const parentOf = async (id: string) => (await db.chartOfAccount.findUnique({ where: { id }, select: { parentId: true } }))?.parentId ?? null;

  beforeAll(async () => {
    const { FinanceCoaService } = await import('../src/modules/finance/finance-coa.service');
    const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
    coaSvc = new FinanceCoaService(prismaSvc, new ChartOfAccountsSeederService(prismaSvc));
    child = (await coaSvc.create(ID.biz, { name: 'v98k child', type: 'EXPENSE', code: '6901' })).id;
    ownParent = (await coaSvc.create(ID.biz, { name: 'v98k parent', type: 'EXPENSE', code: '6900' })).id;
    foreign = (await coaSvc.create(ID.bizB, { name: 'v98k B secret parent', type: 'EXPENSE', code: '9999' })).id;
  });

  it('BRD-06 control: create() already refuses another business\'s parent', async () => {
    await expect(coaSvc.create(ID.biz, { name: 'v98k x', type: 'EXPENSE', parentId: foreign })).rejects.toThrow(PARENT_REFUSAL);
  });

  it('BRD-06 RED-BEFORE: update() refuses another business\'s row and an id that exists nowhere, in the same words; the link is unchanged', async () => {
    for (const parentId of [foreign, `${P}does_not_exist_anywhere`]) {
      let err: any = null;
      try {
        await coaSvc.update(ID.biz, child, { parentId });
      } catch (e) {
        err = e;
      }
      expect(err, parentId).not.toBeNull();
      expect(err.constructor?.name, parentId).toBe('BadRequestException');
      expect(err.message, parentId).toBe(PARENT_REFUSAL);
      expect(err.code, parentId).toBeUndefined();
      expect(await parentOf(child), parentId).toBeNull();
    }
  });

  it('BRD-06 control: the business\'s own parent links, and clearing the parent unlinks', async () => {
    await coaSvc.update(ID.biz, child, { parentId: ownParent });
    expect(await parentOf(child)).toBe(ownParent);
    await coaSvc.update(ID.biz, child, { parentId: null });
    expect(await parentOf(child)).toBeNull();
  });
});
