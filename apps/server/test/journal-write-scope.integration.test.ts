/**
 * PR195-JOURNAL-SCOPE (review finding CR-P195-4): a manual journal is written into the business's books
 * only by a member holding revenue write, on the web and on KEY. REAL database.
 *
 * The port mounted the manual-journal composer at /app/finance/journal. On the head, POST
 * finance/businesses/:b/journal-entries checked membership only (FinanceController.ensureAccess), so a
 * STAFF member holding revenue read, or no finance scope at all, posted any balanced journal (DR cash /
 * CR owner equity, or anything else) into the books. The recurring journal templates were the same door
 * twice: POST recurring-journal-entries then POST .../:id/run posted an ADJUSTMENT at once. KEY's
 * finance_post_journal_entry was ungranted in the derived tool table, so the D-98 revenue gate read it
 * as no money write: a revenue:read member's chat (and a platform SUPER_ADMIN's who is not a member) ran
 * it, and the chat menu offered it.
 *
 * The rule (journal-write-scope.spec.ts, flow-chat-module-menu.spec.ts, job-role-tool-families.spec.ts):
 * the manual journal routes need revenue write (RequireModuleScope + ModuleScopeGuard, as the Books'
 * other manual write, the credit note; D-57: the Books have no module key of their own and their reads
 * are revenue read), ensureAccess still refusing a non-member SUPER_ADMIN (D-46); the derived table holds
 * finance_post_journal_entry at revenue write, so KEY's revenue gate refuses it on every member-driven
 * surface and the menu stops offering it; the plan queue, approved proposals and the graph route were
 * already held by the authority map's prefix floor (finance_* -> revenue write) and stay so; a plan with
 * no member is refused it (D-73).
 *
 *   JWS-01  RED-BEFORE  STAFF {revenue:'read'} and STAFF on role defaults: POST journal-entries 403 'revenue
 *                       requires write access (you have read)', the book unchanged
 *   JWS-02  RED-BEFORE  STAFF with no finance scope ({crm:'read'}): 403 '(you have none)', unchanged
 *   JWS-03  CONTROL     the OWNER, an ADMIN on role defaults and STAFF {revenue:'write'} post (201), each
 *                       ADJUSTMENT authored by its member
 *   JWS-04  CONTROL     a platform SUPER_ADMIN who is not a member: 403 'No access to this business' (D-46)
 *   JWS-05  RED-BEFORE  the recurring journal writes: a revenue:read member's create, edit, run, cancel and
 *                       delete answer 403 and change nothing (no template, no posting); the OWNER's create
 *                       and run post; the non-member SUPER_ADMIN stays refused
 *   JWS-10  RED-BEFORE  KEY chat: a revenue:read member's finance_post_journal_entry is refused with the
 *                       route's words before the ledger door; the book unchanged
 *   JWS-11  RED-BEFORE  KEY chat: a platform SUPER_ADMIN who is not a member is refused it too (D-46)
 *   JWS-12  CONTROL     KEY chat: the OWNER's and an ADMIN's call each post one ADJUSTMENT
 *   JWS-13  RED-BEFORE  KEY chat menu: not offered to a revenue:read member nor to a member with operations
 *                       write and expenses read (payroll_mark_paid); offered to the OWNER
 *   JWS-14  CONTROL     the plan queue and approved proposals (planStepRunAuthority, the gate
 *                       QueueService.processPlanStep and KeyCortexActionExecutorPlugin run) and the graph
 *                       route (assertMayRunGraphAction): a revenue:read member's step is refused, the
 *                       OWNER's and an ADMIN's run, a plan with no member is refused (D-73), a non-member
 *                       SUPER_ADMIN is refused (D-46)
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * TenantInterceptor, FinanceController, PostingService, AccountingPeriodService,
 * ChartOfAccountsSeederService and RecurringJournalEntryService run against DATABASE_URL; KEY is the real
 * FlowOrchestratorService prototype (selectToolsForRequest, executeToolDirectly, executeTool,
 * memberScopeRefusal, executeToolAction) over the real Prisma client and the real PostingService, and the
 * real plan-step-authority / graph-actions gates over real ai_plans rows. Stand-ins: identity attachment
 * (a test middleware reads `x-v98j-user`, loads that seeded user row and attaches `{ id, email, role }`,
 * as the Supabase-verifying AuthMiddleware does); FinanceController's collaborators off these routes; the
 * orchestrator's execution log, tier lookup and graph cache (record or no-op).
 *
 * Fixtures: prefix `v98j_` (registered in test/helpers/fixture-prefixes.json); hard-deleted by raw SQL
 * (patterns built by sqlLikePrefix) in dependency order in beforeAll and afterAll; no $transaction
 * wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

vi.setConfig({ testTimeout: 30_000 });

const P = 'v98j_';
const HEADER = 'x-v98j-user';

const ID = {
  owner: `${P}owner`, // OWNER membership (role defaults: every module admin)
  admin: `${P}admin`, // ADMIN, role defaults (revenue admin)
  staffDefault: `${P}staffDefault`, // STAFF, role defaults (revenue read)
  staffRead: `${P}staffRead`, // STAFF { crm: 'read', revenue: 'read' }
  staffNone: `${P}staffNone`, // STAFF { crm: 'read' }: no finance scope at all (revenue none)
  staffWrite: `${P}staffWrite`, // STAFF { crm: 'read', revenue: 'write' }
  opsWriteExpRead: `${P}opsExpRead`, // STAFF { operations: 'write', expenses: 'read' }
  superAdmin: `${P}super`, // platform SUPER_ADMIN, no Membership
  biz: `${P}biz`,
  planStaff: `${P}plan_staff`,
  planOwner: `${P}plan_owner`,
  planAdmin: `${P}plan_admin`,
  planNoMember: `${P}plan_nomember`,
  planSuper: `${P}plan_super`,
};

const TOOL = 'finance_post_journal_entry';
const READ_REFUSAL = 'Insufficient permissions: revenue requires write access (you have read)';
const NONE_REFUSAL = 'Insufficient permissions: revenue requires write access (you have none)';

let db: any;
let app: any;
let coa: any;
let orchestrator: any;
let gates: {
  planStepRunAuthority: (...a: any[]) => Promise<{ refusal: string | null }>;
  assertMayRunGraphAction: (...a: any[]) => Promise<void>;
};
let keyPrisma: any;
/** The business's CASH and OWNER_EQUITY chart-of-account rows. */
const ACC: Record<string, string> = {};

async function cleanup() {
  for (const sql of [
    `DELETE FROM ai_plan_steps WHERE plan_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM recurring_journal_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** Identity attachment only. No guard is overridden. */
function attachIdentity(nest: any) {
  nest.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
}

/** The business's financial_transactions and ledger_entries row counts, by raw SQL. */
async function bookCounts() {
  const [tx]: Array<{ n: number }> = await db.$queryRawUnsafe(
    'SELECT COUNT(*)::int AS n FROM financial_transactions WHERE business_id = $1', ID.biz,
  );
  const [le]: Array<{ n: number }> = await db.$queryRawUnsafe(
    'SELECT COUNT(*)::int AS n FROM ledger_entries WHERE business_id = $1', ID.biz,
  );
  return { transactions: tx.n, entries: le.n };
}

/** DR cash 30 / CR owner equity 30. */
function journalBody(description = 'v98j manual adjustment') {
  return {
    date: new Date(Date.now() - 60_000).toISOString(),
    description,
    entries: [
      { accountId: ACC.cash, debit: 30 },
      { accountId: ACC.equity, credit: 30 },
    ],
  };
}

const http = () => request(app.getHttpServer());
const fin = (rest: string) => `/finance/businesses/${ID.biz}/${rest}`;

function postJournal(as: string, description?: string) {
  return http().post(fin('journal-entries')).set(HEADER, as).send(journalBody(description));
}

/** A recurring template body (MONTHLY, due yesterday, DR cash 12 / CR equity 12). */
function recurringBody(name: string) {
  return {
    name,
    frequency: 'MONTHLY',
    nextRunDate: new Date(Date.now() - 86_400_000).toISOString(),
    entries: [
      { accountId: ACC.cash, debit: 12 },
      { accountId: ACC.equity, credit: 12 },
    ],
  };
}

/** KEY's arguments for the same journal. */
function keyArgs(description: string) {
  return { type: 'ADJUSTMENT', ...journalBody(description), amount: 30 };
}

function keyChat(userId: string, description: string) {
  return orchestrator.executeToolDirectly(ID.biz, TOOL, keyArgs(description), undefined, { surface: 'CHAT', principalUserId: userId });
}

async function chatMenu(userId: string): Promise<string[]> {
  const tools = await orchestrator.selectToolsForRequest(
    ID.biz,
    [],
    'post a journal entry in finance; mark the payroll run paid; approve the payroll run; view receivables',
    undefined,
    userId,
  );
  return tools.map((t: { function: { name: string } }) => t.function.name);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger } = await import('@nestjs/common');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { LedgerBalanceService } = await import('../src/modules/finance/ledger-balance.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { RecurringJournalEntryService } = await import('../src/modules/finance/recurring-journal-entry.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const planAuthority = await import('../src/modules/ai/plan-step-authority');
  const graphActions = await import('../src/modules/ai/graph-actions.controller');
  gates = { planStepRunAuthority: planAuthority.planStepRunAuthority, assertMayRunGraphAction: graphActions.assertMayRunGraphAction };

  // FinanceController's collaborators off the journal routes.
  const stubs = await Promise.all([
    import('../src/modules/finance/receivables.service').then((m) => m.ReceivablesService),
    import('../src/modules/finance/finance-overview.service').then((m) => m.FinanceOverviewService),
    import('../src/modules/finance/finance-accounts.service').then((m) => m.FinanceAccountsService),
    import('../src/modules/finance/finance-coa.service').then((m) => m.FinanceCoaService),
    import('../src/modules/finance/finance-tax-rate.service').then((m) => m.FinanceTaxRateService),
    import('../src/modules/finance/finance-settings.service').then((m) => m.FinanceSettingsService),
    import('../src/modules/finance/bank-import.service').then((m) => m.BankImportService),
    import('../src/modules/finance/statement-source.service').then((m) => m.StatementSourceService),
    import('../src/modules/finance/bank-matching.service').then((m) => m.BankMatchingService),
    import('../src/modules/finance/bank-rule.service').then((m) => m.BankRuleService),
    import('../src/modules/finance/reconciliation.service').then((m) => m.ReconciliationService),
    import('../src/modules/finance/tax-liability.service').then((m) => m.TaxLiabilityService),
    import('../src/modules/finance/accountant-export.service').then((m) => m.AccountantExportService),
    import('../src/modules/finance/finance-intelligence.service').then((m) => m.FinanceIntelligenceService),
    import('../src/modules/finance/accountant-export-email.service').then((m) => m.AccountantExportEmailService),
    import('../src/modules/finance/safe-to-spend.service').then((m) => m.SafeToSpendService),
    import('../src/modules/finance/cashflow-forecast.service').then((m) => m.CashflowForecastService),
    import('../src/modules/finance/money-moves.service').then((m) => m.MoneyMovesService),
    import('../src/modules/finance/cash-reserve.service').then((m) => m.CashReserveService),
    import('../src/modules/finance/credit-note.service').then((m) => m.CreditNoteService),
    import('../src/modules/finance/bank-connection.service').then((m) => m.BankConnectionService),
    import('../src/modules/finance/exchange-rate.service').then((m) => m.ExchangeRateService),
    import('../src/modules/finance/fixed-asset.service').then((m) => m.FixedAssetService),
    import('../src/core/object-storage').then((m) => m.ObjectStorageService),
  ]);

  const moduleRef = await Test.createTestingModule({
    controllers: [FinanceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      // Live: the ledger door, its period lock, the chart seeder and the recurring templates.
      PostingService,
      AccountingPeriodService,
      LedgerBalanceService,
      ChartOfAccountsSeederService,
      RecurringJournalEntryService,
      ...stubs.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();
  coa = moduleRef.get(ChartOfAccountsSeederService);
  const posting = moduleRef.get(PostingService);

  app = moduleRef.createNestApplication();
  attachIdentity(app);
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  // KEY: the real orchestrator class over the real Prisma client and the real ledger door.
  Logger.overrideLogger(false);
  keyPrisma = new PrismaService();
  const quiet = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
  const registry = new Map<unknown, unknown>([[PostingService, posting]]);
  orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: quiet,
    prisma: keyPrisma,
    moduleRef: {
      get(token: any) {
        if (!registry.has(token)) throw new Error(`test moduleRef has no provider for ${token?.name ?? String(token)}`);
        return registry.get(token);
      },
    },
    governance: { getToolTier: () => 3 },
    executionLog: { logToolExecution: async () => undefined, log: async () => undefined },
    businessGraph: { invalidateCache() {} },
  });

  await cleanup(); // in case a prior run aborted

  for (const [id, role] of [
    [ID.owner, 'USER'], [ID.admin, 'USER'], [ID.staffDefault, 'USER'], [ID.staffRead, 'USER'], [ID.staffNone, 'USER'],
    [ID.staffWrite, 'USER'], [ID.opsWriteExpRead, 'USER'], [ID.superAdmin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V98J Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' } });
  const m = (userId: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}`, userId, businessId: ID.biz, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, 'OWNER');
  await m(ID.admin, 'ADMIN');
  await m(ID.staffDefault, 'STAFF');
  await m(ID.staffRead, 'STAFF', { crm: 'read', revenue: 'read' });
  await m(ID.staffNone, 'STAFF', { crm: 'read' });
  await m(ID.staffWrite, 'STAFF', { crm: 'read', revenue: 'write' });
  await m(ID.opsWriteExpRead, 'STAFF', { operations: 'write', expenses: 'read' });
  await coa.ensureDefaults(ID.biz);
  ACC.cash = (await coa.getBySystemKey(ID.biz, 'CASH')).id;
  ACC.equity = (await coa.getBySystemKey(ID.biz, 'OWNER_EQUITY')).id;

  // KEY plans: one per member under test, and one no member wrote (as a journey or an agent trigger writes them).
  for (const [id, userId] of [
    [ID.planStaff, ID.staffRead], [ID.planOwner, ID.owner], [ID.planAdmin, ID.admin], [ID.planNoMember, null], [ID.planSuper, ID.superAdmin],
  ] as const) {
    await db.aiPlan.create({ data: { id, businessId: ID.biz, userId, objective: 'v98j post a journal', status: 'approved' } });
  }
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('fixture sanity (real rows)', () => {
  it('the business has its OWNER, an ADMIN, STAFF members on role defaults and on explicit maps, its chart, and no posting yet', async () => {
    expect(await db.membership.count({ where: { businessId: ID.biz } })).toBe(7);
    expect(await db.membership.count({ where: { userId: ID.superAdmin } })).toBe(0);
    expect(ACC.cash && ACC.equity).toBeTruthy();
    expect(await bookCounts()).toEqual({ transactions: 0, entries: 0 });
  });
});

describe('REST: POST journal-entries needs revenue write (CR-P195-4)', () => {
  it.each([
    ['staffRead', ID.staffRead],
    ['staffDefault', ID.staffDefault],
  ])("JWS-01 RED-BEFORE: %s (revenue read) is refused 403 'revenue requires write access (you have read)' and the book is unchanged", async (_name, as) => {
    const before = await bookCounts();
    const res = await postJournal(as);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN', message: READ_REFUSAL });
    expect(res.body).not.toHaveProperty('transactionId');
    expect(await bookCounts()).toEqual(before);
    expect(await db.financialTransaction.count({ where: { createdById: as } })).toBe(0);
  });

  it("JWS-02 RED-BEFORE: a STAFF member with no finance scope ({crm:'read'}) is refused 403 '(you have none)' and the book is unchanged", async () => {
    const before = await bookCounts();
    const res = await postJournal(ID.staffNone);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN', message: NONE_REFUSAL });
    expect(await bookCounts()).toEqual(before);
    expect(await db.financialTransaction.count({ where: { createdById: ID.staffNone } })).toBe(0);
  });

  it.each([
    ['the OWNER', ID.owner],
    ['an ADMIN on role defaults', ID.admin],
    ["STAFF {revenue:'write'}", ID.staffWrite],
  ])('JWS-03 CONTROL: %s posts one ADJUSTMENT (DR CASH 30 / CR OWNER_EQUITY 30) authored by itself', async (_name, as) => {
    const before = await bookCounts();
    const res = await postJournal(as, `v98j by ${as}`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.alreadyPosted).toBe(false);
    expect(await bookCounts()).toEqual({ transactions: before.transactions + 1, entries: before.entries + 2 });
    const tx = await db.financialTransaction.findUnique({ where: { id: res.body.transactionId }, include: { entries: true } });
    expect(tx).toMatchObject({ businessId: ID.biz, type: 'ADJUSTMENT', status: 'POSTED', createdById: as });
    const legs = tx.entries.map((e: any) => [e.accountId, Number(e.debit), Number(e.credit)]);
    expect(legs).toEqual(expect.arrayContaining([[ACC.cash, 30, 0], [ACC.equity, 0, 30]]));
  });

  it("JWS-04 CONTROL (D-46): a platform SUPER_ADMIN who is not a member is refused 403 'No access to this business' and the book is unchanged", async () => {
    const before = await bookCounts();
    const res = await postJournal(ID.superAdmin);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN', message: 'No access to this business' });
    expect(await bookCounts()).toEqual(before);
    expect(await db.financialTransaction.count({ where: { createdById: ID.superAdmin } })).toBe(0);
  });
});

describe('REST: the recurring journal writes need revenue write too (the same door twice)', () => {
  it('JWS-05 RED-BEFORE: a revenue:read member creates, edits, runs, cancels and deletes nothing; the OWNER creates and runs; the non-member SUPER_ADMIN stays refused', async () => {
    // A revenue:read member's template is refused, and none is written.
    const create = await http().post(fin('recurring-journal-entries')).set(HEADER, ID.staffRead).send(recurringBody('v98j staff template'));
    expect(create.status, JSON.stringify(create.body)).toBe(403);
    expect(create.body).toMatchObject({ code: 'FORBIDDEN', message: READ_REFUSAL });
    expect(await db.recurringJournalEntry.count({ where: { businessId: ID.biz } })).toBe(0);

    // The OWNER's template.
    const owned = await http().post(fin('recurring-journal-entries')).set(HEADER, ID.owner).send(recurringBody('v98j owner template'));
    expect(owned.status, JSON.stringify(owned.body)).toBe(201);
    const id = owned.body.id as string;
    const template = await db.recurringJournalEntry.findUnique({ where: { id } });

    // Run, edit, cancel and delete by the revenue:read member: 403 each, nothing posted, the template unchanged.
    const before = await bookCounts();
    for (const [verb, rest, body] of [
      ['post', `recurring-journal-entries/${id}/run`, {}],
      ['patch', `recurring-journal-entries/${id}`, { name: 'v98j renamed', isActive: true }],
      ['post', `recurring-journal-entries/${id}/cancel`, {}],
      ['delete', `recurring-journal-entries/${id}`, undefined],
    ] as const) {
      const res = await (http() as any)[verb](fin(rest)).set(HEADER, ID.staffRead).send(body);
      expect(res.status, `${verb} ${rest}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN', message: READ_REFUSAL });
    }
    const noScope = await http().post(fin(`recurring-journal-entries/${id}/run`)).set(HEADER, ID.staffNone).send({});
    expect(noScope.status, JSON.stringify(noScope.body)).toBe(403);
    expect(noScope.body).toMatchObject({ message: NONE_REFUSAL });
    const outsider = await http().post(fin(`recurring-journal-entries/${id}/run`)).set(HEADER, ID.superAdmin).send({});
    expect(outsider.status, JSON.stringify(outsider.body)).toBe(403);
    expect(outsider.body).toMatchObject({ message: 'No access to this business' });
    expect(await bookCounts()).toEqual(before);
    expect(await db.recurringJournalEntry.findUnique({ where: { id } })).toEqual(template);

    // The OWNER runs it: one ADJUSTMENT from the template.
    const run = await http().post(fin(`recurring-journal-entries/${id}/run`)).set(HEADER, ID.owner).send({});
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    expect(await bookCounts()).toEqual({ transactions: before.transactions + 1, entries: before.entries + 2 });
    expect(await db.financialTransaction.count({ where: { businessId: ID.biz, sourceType: 'RecurringJournalEntry', sourceId: id } })).toBe(1);
  });
});

describe('KEY: finance_post_journal_entry needs the member\'s revenue write on chat and its menu', () => {
  it('JWS-10 RED-BEFORE: a revenue:read member\'s chat call is refused with the route\'s words before the ledger door; the book is unchanged', async () => {
    for (const as of [ID.staffRead, ID.staffDefault]) {
      const before = await bookCounts();
      await expect(keyChat(as, `v98j key ${as}`), as).rejects.toThrow(READ_REFUSAL);
      expect(await bookCounts(), as).toEqual(before);
      expect(await db.financialTransaction.count({ where: { businessId: ID.biz, description: `v98j key ${as}` } })).toBe(0);
    }
    const before = await bookCounts();
    await expect(keyChat(ID.staffNone, 'v98j key none')).rejects.toThrow(NONE_REFUSAL);
    expect(await bookCounts()).toEqual(before);
  });

  it('JWS-11 RED-BEFORE (D-46): a platform SUPER_ADMIN who is not a member is refused it on chat; the book is unchanged', async () => {
    const before = await bookCounts();
    await expect(keyChat(ID.superAdmin, 'v98j key super')).rejects.toThrow(NONE_REFUSAL);
    expect(await bookCounts()).toEqual(before);
    expect(await db.financialTransaction.count({ where: { businessId: ID.biz, description: 'v98j key super' } })).toBe(0);
  });

  it('JWS-12 CONTROL: the OWNER\'s and an ADMIN\'s chat call each post one ADJUSTMENT', async () => {
    for (const as of [ID.owner, ID.admin]) {
      const before = await bookCounts();
      const result = await keyChat(as, `v98j key ${as}`);
      expect(result.alreadyPosted, as).toBe(false);
      expect(await bookCounts(), as).toEqual({ transactions: before.transactions + 1, entries: before.entries + 2 });
      const tx = await db.financialTransaction.findUnique({ where: { id: result.transactionId } });
      expect(tx).toMatchObject({ businessId: ID.biz, type: 'ADJUSTMENT', status: 'POSTED', description: `v98j key ${as}` });
    }
  });

  it('JWS-13 RED-BEFORE: the chat menu offers finance_post_journal_entry to the OWNER only among these, and payroll_mark_paid to no member without expenses write', async () => {
    expect(await chatMenu(ID.owner)).toContain(TOOL);
    expect(await chatMenu(ID.owner)).toContain('payroll_mark_paid');
    for (const as of [ID.staffRead, ID.staffDefault, ID.staffNone, ID.superAdmin]) expect(await chatMenu(as), as).not.toContain(TOOL);
    const ops = await chatMenu(ID.opsWriteExpRead);
    expect(ops).not.toContain('payroll_mark_paid');
    expect(ops).toContain('payroll_approve_run');
  });
});

describe('KEY: the plan, proposal and graph paths hold the same rule (the authority map)', () => {
  it('JWS-14 CONTROL: a revenue:read member\'s plan step is refused on the queue and as a proposal; the OWNER\'s and an ADMIN\'s run; a plan with no member is refused (D-73); a non-member SUPER_ADMIN\'s plan is refused (D-46)', async () => {
    for (const memberIsPrincipal of [false, true]) {
      const staff = await gates.planStepRunAuthority(keyPrisma, ID.biz, ID.planStaff, TOOL, { memberIsPrincipal });
      expect(staff.refusal, `principal ${memberIsPrincipal}`).toBe(READ_REFUSAL);
      expect((await gates.planStepRunAuthority(keyPrisma, ID.biz, ID.planOwner, TOOL, { memberIsPrincipal })).refusal).toBeNull();
      expect((await gates.planStepRunAuthority(keyPrisma, ID.biz, ID.planAdmin, TOOL, { memberIsPrincipal })).refusal).toBeNull();
      expect((await gates.planStepRunAuthority(keyPrisma, ID.biz, ID.planNoMember, TOOL, { memberIsPrincipal })).refusal).toMatch(
        /writes the business's money or invoices \(revenue write\), and a KEY plan or monitor with no member principal writes neither \(D-73\)/,
      );
      expect((await gates.planStepRunAuthority(keyPrisma, ID.biz, ID.planSuper, TOOL, { memberIsPrincipal })).refusal).toMatch(
        /Not a member of this business: a platform SUPER_ADMIN who is not a member does not write its invoices \(D-46\)/,
      );
    }
  });

  it('JWS-14 CONTROL: the graph route (POST actions/.../execute) refuses a revenue:read member and a non-member SUPER_ADMIN, and runs the OWNER\'s step', async () => {
    await expect(gates.assertMayRunGraphAction(keyPrisma, ID.biz, { id: ID.staffRead, role: 'USER' }, TOOL, ID.staffRead)).rejects.toThrow(READ_REFUSAL);
    await expect(gates.assertMayRunGraphAction(keyPrisma, ID.biz, { id: ID.staffNone, role: 'USER' }, TOOL, ID.staffNone)).rejects.toThrow(NONE_REFUSAL);
    await expect(gates.assertMayRunGraphAction(keyPrisma, ID.biz, { id: ID.superAdmin, role: 'SUPER_ADMIN' }, TOOL, null)).rejects.toThrow(/\(D-46\)/);
    await expect(gates.assertMayRunGraphAction(keyPrisma, ID.biz, { id: ID.owner, role: 'USER' }, TOOL, ID.owner)).resolves.toBeUndefined();
    await expect(gates.assertMayRunGraphAction(keyPrisma, ID.biz, { id: ID.staffWrite, role: 'USER' }, TOOL, ID.staffWrite)).resolves.toBeUndefined();
  });
});
