/**
 * V1-91 (FU-RECURRING-EXPENSE-SERVER, P213 — from EXPENSES-HUB-2 reviews
 * SEC-EXH2-3 / COR-F1 / COR-F6): real PostgreSQL + real HTTP (supertest)
 * integration proof covering all 7 server findings on expenses / recurring
 * expenses / bills pay (NO mocked guards, NO mocked ledger services).
 *
 * Contract pinned here:
 *
 *   1. Cross-tenant / nonexistent / soft-deleted FK ownership validation on
 *      RecurringExpenseService.create and .update (SEC-EXH2-3):
 *      - RES-01 RED-BEFORE: POST .../recurring rejects foreign-tenant,
 *        nonexistent, and soft-deleted categoryId/projectId/contactId/serviceId
 *        with 400, zero rows written, and identical message per field (no
 *        cross-tenant existence leak).
 *      - RES-02 RED-BEFORE: PATCH .../recurring/:id rejects foreign-tenant,
 *        nonexistent, and soft-deleted categoryId/projectId/contactId/serviceId
 *        with 400, zero mutation, and identical message per field.
 *      - RES-03 CONTROL: valid in-tenant active FKs on POST/PATCH and clearing
 *        to null on PATCH succeed.
 *
 *   2. Guard parity on RecurringExpensesController (D-46 / BusinessMemberGuard):
 *      - RES-04 RED-BEFORE: non-member SUPER_ADMIN is refused 403 on POST
 *        .../recurring, PATCH .../recurring/:id, DELETE .../recurring/:id, and
 *        POST .../recurring/:id/run, with zero DB writes.
 *      - RES-05 CONTROL: expenses:read member gets 200 on GET list/detail and
 *        403 on all write routes; expenses:write member succeeds on all write
 *        routes; unauthenticated caller gets 401.
 *
 *   3. runOnce honors dueOffsetDays: 0:
 *      - RES-06 RED-BEFORE: createsBill: true with dueOffsetDays: 0 produces a
 *        BILL whose dueDate === runDate (NOT runDate + 30 days).
 *      - RES-07 CONTROL: dueOffsetDays: 10 -> +10 days; dueOffsetDays: null ->
 *        +30 days; createsBill: false -> PAID with dueDate: null.
 *
 *   4. processDueRecurringExpenses catch-up / paid-status safety (COR-F1):
 *      - RES-08 RED-BEFORE: a schedule seeded with nextRunDate 6 months in the
 *        past generates at most 1 expense across repeated hourly ticks (no
 *        unbounded backdated PAID catch-up), advances nextRunDate strictly past
 *        now while preserving anchor day, and posts 1 ledger transaction only.
 *
 *   5. computeNext month-end drift (COR-F6):
 *      - RES-09 RED-BEFORE: Jan 31 + MONTHLY -> Feb 28 (non-leap) / Feb 29
 *        (leap), never Mar 3; anchor day preserved (Jan 31 -> Feb 28 -> Mar 31
 *        -> Apr 30 -> May 31); Nov 30 + QUARTERLY -> Feb 28; Feb 29 + YEARLY ->
 *        Feb 28; DB runOnce from Jan 31 lands on Feb 28.
 *
 *   6. Refuse a past nextRunDate on create and update:
 *      - RES-10 RED-BEFORE: POST and PATCH with a strictly past nextRunDate
 *        (yesterday in business TZ, historical date, or invalid date) return
 *        400 with zero DB writes.
 *      - RES-11 CONTROL: today (YYYY-MM-DD in business TZ and new Date()) and
 *        future dates are accepted; PATCH omitting nextRunDate on a schedule
 *        whose existing nextRunDate is in the past still succeeds; Asia/Tokyo
 *        business timezone boundary is respected.
 *
 *   7. Eliminate distinguishable payment-account refusals on bills/:id/pay:
 *      - RES-12 RED-BEFORE: a member with expenses:write and NO revenue:read
 *        probing POST .../bills/:id/pay with any paymentAccountId (valid bank,
 *        archived, LOAN, USD mismatch, inactive COA, foreign-tenant, or
 *        nonexistent) receives a uniform 403 refusal with identical message and
 *        zero DB/ledger writes (no existence/state/balance oracle).
 *      - RES-13 CONTROL: the same member without revenue:read can still pay a
 *        bill via default path (omitted or null paymentAccountId -> 201); a
 *        member WITH expenses:write + revenue:read can pay with explicit
 *        paymentAccountId -> 201 crediting the chosen Bank COA.
 *
 * Fixtures: prefix `v91b_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (sqlLikePrefix) in dependency order in beforeAll and
 * afterAll (zero `.deleteMany(` calls).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import type { ChartOfAccountsSeederService } from '../src/modules/finance/chart-of-accounts-seeder.service';
import type { RecurringExpenseService } from '../src/modules/expenses/recurring-expense.service';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v91b_';
const HEADER = 'x-v91b-user';

const ID = {
  owner: `${P}owner`,
  reader: `${P}reader`,
  writerNoRev: `${P}writerNoRev`,
  writerWithRev: `${P}writerWithRev`,
  superAdmin: `${P}superAdmin`,
  ownerF: `${P}ownerF`,
  biz: `${P}biz`,
  bizTokyo: `${P}bizTokyo`,
  bizF: `${P}bizF`,
  catOwn: `${P}catOwn`,
  catForeign: `${P}catForeign`,
  projOwn: `${P}projOwn`,
  projDeleted: `${P}projDeleted`,
  projForeign: `${P}projForeign`,
  contactOwn: `${P}contactOwn`,
  contactDeleted: `${P}contactDeleted`,
  contactForeign: `${P}contactForeign`,
  svcOwn: `${P}svcOwn`,
  svcDeleted: `${P}svcDeleted`,
  svcForeign: `${P}svcForeign`,
  coaBankChecking: `${P}coaBankChecking`,
  coaInactive: `${P}coaInactive`,
  faBank: `${P}faBank`,
  faArchived: `${P}faArchived`,
  faLoan: `${P}faLoan`,
  faUsd: `${P}faUsd`,
  faInactiveCoa: `${P}faInactiveCoa`,
  faForeign: `${P}faForeign`,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let app: any;
let coa: ChartOfAccountsSeederService;
let recurringSvc: RecurringExpenseService;
let RecurringExpenseServiceClass: typeof RecurringExpenseService;
let coaBankCheckingId: string;
/* eslint-enable @typescript-eslint/no-explicit-any */

const eventStub = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

function dayInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function addDaysToDayString(day: string, deltaDays: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `UPDATE financial_transactions SET reversal_of_id = NULL WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM recurring_expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expense_categories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM projects WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

function agent() {
  return request(app.getHttpServer());
}

function postRecurring(body: Record<string, unknown>, businessId = ID.biz, actor: string | null = ID.owner) {
  const req = agent().post(`/expenses/businesses/${businessId}/recurring`);
  if (actor) req.set(HEADER, actor);
  return req.send(body);
}

function patchRecurring(
  id: string,
  body: Record<string, unknown>,
  businessId = ID.biz,
  actor: string | null = ID.owner,
) {
  const req = agent().patch(`/expenses/businesses/${businessId}/recurring/${id}`);
  if (actor) req.set(HEADER, actor);
  return req.send(body);
}

function deleteRecurring(id: string, businessId = ID.biz, actor: string | null = ID.owner) {
  const req = agent().delete(`/expenses/businesses/${businessId}/recurring/${id}`);
  if (actor) req.set(HEADER, actor);
  return req;
}

function runRecurringNow(id: string, businessId = ID.biz, actor: string | null = ID.owner) {
  const req = agent().post(`/expenses/businesses/${businessId}/recurring/${id}/run`);
  if (actor) req.set(HEADER, actor);
  return req.send({});
}

function getRecurringList(businessId = ID.biz, actor: string | null = ID.owner) {
  const req = agent().get(`/expenses/businesses/${businessId}/recurring`);
  if (actor) req.set(HEADER, actor);
  return req;
}

function getRecurringOne(id: string, businessId = ID.biz, actor: string | null = ID.owner) {
  const req = agent().get(`/expenses/businesses/${businessId}/recurring/${id}`);
  if (actor) req.set(HEADER, actor);
  return req;
}

function createBill(body: Record<string, unknown>, businessId = ID.biz, actor = ID.owner) {
  return agent().post(`/finance/businesses/${businessId}/bills`).set(HEADER, actor).send(body);
}

function payBill(
  expenseId: string,
  body: Record<string, unknown> = {},
  businessId = ID.biz,
  actor = ID.owner,
) {
  return agent().post(`/finance/businesses/${businessId}/bills/${expenseId}/pay`).set(HEADER, actor).send(body);
}

async function ledgerCounts(businessId: string): Promise<{ txns: number; entries: number }> {
  return {
    txns: await db.financialTransaction.count({ where: { businessId } }),
    entries: await db.ledgerEntry.count({ where: { businessId } }),
  };
}

function futureDay(daysAhead = 15, timeZone = 'America/Port_of_Spain'): string {
  return addDaysToDayString(dayInZone(new Date(), timeZone), daysAhead);
}

function baseSchedulePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `${P}Schedule`,
    description: `${P}Monthly service`,
    amount: 100,
    frequency: 'MONTHLY',
    nextRunDate: futureDay(10),
    createsBill: false,
    ...overrides,
  };
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { BusinessMemberGuard } = await import('../src/core/auth/business-member.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { RecurringExpensesController } = await import('../src/modules/expenses/recurring-expenses.controller');
  const { RecurringExpenseService: RecSvc } = await import('../src/modules/expenses/recurring-expense.service');
  const { BillsController } = await import('../src/modules/expenses/bills.controller');
  const { ExpensesController } = await import('../src/modules/expenses/expenses.controller');
  const { ExpensesService } = await import('../src/modules/expenses/expenses.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');

  RecurringExpenseServiceClass = RecSvc;

  const moduleRef = await Test.createTestingModule({
    controllers: [RecurringExpensesController, BillsController, ExpensesController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      BusinessMemberGuard,
      TeamAuditInterceptor,
      ExpensesService,
      RecSvc,
      ExpensePostingService,
      PostingService,
      AccountingPeriodService,
      ChartOfAccountsSeederService,
      { provide: EventEmitter2, useValue: eventStub },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: DocumentIntelligenceService, useValue: {} },
    ],
  }).compile();

  coa = moduleRef.get(ChartOfAccountsSeederService);
  recurringSvc = moduleRef.get(RecSvc);

  app = moduleRef.createNestApplication();
  // Identity attachment only. No guard is overridden.
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
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' },
      { id: ID.reader, email: `${P}reader@test.local`, role: 'USER' },
      { id: ID.writerNoRev, email: `${P}writernorev@test.local`, role: 'USER' },
      { id: ID.writerWithRev, email: `${P}writerwithrev@test.local`, role: 'USER' },
      { id: ID.superAdmin, email: `${P}superadmin@test.local`, role: 'SUPER_ADMIN' },
      { id: ID.ownerF, email: `${P}ownerf@test.local`, role: 'USER' },
    ],
  });

  await db.business.create({
    data: {
      id: ID.biz,
      name: `V91B ${ID.biz}`,
      ownerId: ID.owner,
      currency: 'TTD',
      timezone: 'America/Port_of_Spain',
    },
  });
  await db.business.create({
    data: {
      id: ID.bizTokyo,
      name: `V91B ${ID.bizTokyo}`,
      ownerId: ID.owner,
      currency: 'TTD',
      timezone: 'Asia/Tokyo',
    },
  });
  await db.business.create({
    data: {
      id: ID.bizF,
      name: `V91B ${ID.bizF}`,
      ownerId: ID.ownerF,
      currency: 'TTD',
      timezone: 'America/Port_of_Spain',
    },
  });

  await db.membership.createMany({
    data: [
      { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' },
      { id: `${P}m_owner_tokyo`, userId: ID.owner, businessId: ID.bizTokyo, role: 'OWNER' },
      {
        id: `${P}m_reader`,
        userId: ID.reader,
        businessId: ID.biz,
        role: 'STAFF',
        permissionScopes: { expenses: 'read' },
      },
      {
        id: `${P}m_writer_norev`,
        userId: ID.writerNoRev,
        businessId: ID.biz,
        role: 'STAFF',
        permissionScopes: { expenses: 'write' },
      },
      {
        id: `${P}m_writer_rev`,
        userId: ID.writerWithRev,
        businessId: ID.biz,
        role: 'STAFF',
        permissionScopes: { expenses: 'write', revenue: 'read' },
      },
      { id: `${P}m_ownerF`, userId: ID.ownerF, businessId: ID.bizF, role: 'OWNER' },
    ],
  });

  await coa.ensureDefaults(ID.biz);
  await coa.ensureDefaults(ID.bizTokyo);
  await coa.ensureDefaults(ID.bizF);

  // Categories
  await db.expenseCategory.createMany({
    data: [
      { id: ID.catOwn, businessId: ID.biz, name: `${P}Own Category` },
      { id: ID.catForeign, businessId: ID.bizF, name: `${P}Foreign Category` },
    ],
  });

  // Projects (active own, soft-deleted own, foreign)
  await db.project.createMany({
    data: [
      { id: ID.projOwn, businessId: ID.biz, name: `${P}Own Project` },
      { id: ID.projDeleted, businessId: ID.biz, name: `${P}Deleted Project`, deletedAt: new Date() },
      { id: ID.projForeign, businessId: ID.bizF, name: `${P}Foreign Project` },
    ],
  });

  // Contacts (active own, soft-deleted own, foreign)
  await db.contact.createMany({
    data: [
      { id: ID.contactOwn, businessId: ID.biz, firstName: 'Own', lastName: 'Vendor', email: `${P}owncontact@test.local` },
      {
        id: ID.contactDeleted,
        businessId: ID.biz,
        firstName: 'Deleted',
        lastName: 'Vendor',
        email: `${P}delcontact@test.local`,
        deletedAt: new Date(),
      },
      {
        id: ID.contactForeign,
        businessId: ID.bizF,
        firstName: 'Foreign',
        lastName: 'Vendor',
        email: `${P}forcontact@test.local`,
      },
    ],
  });

  // Services (active own, soft-deleted own, foreign)
  await db.service.createMany({
    data: [
      { id: ID.svcOwn, businessId: ID.biz, name: `${P}Own Service`, duration: 60, price: 100 },
      { id: ID.svcDeleted, businessId: ID.biz, name: `${P}Deleted Service`, duration: 60, price: 100, deletedAt: new Date() },
      { id: ID.svcForeign, businessId: ID.bizF, name: `${P}Foreign Service`, duration: 60, price: 100 },
    ],
  });

  // Financial accounts for Finding 7
  const loanPayable = await coa.getBySystemKey(ID.biz, 'LOAN_PAYABLE');
  const bankF = await coa.getBySystemKey(ID.bizF, 'BANK');

  const bankChecking = await db.chartOfAccount.create({
    data: {
      id: ID.coaBankChecking,
      businessId: ID.biz,
      code: '1011',
      name: `${P}Republic Bank Checking`,
      type: 'ASSET',
      systemKey: null,
      isSystem: false,
      isActive: true,
    },
  });
  coaBankCheckingId = bankChecking.id;

  const inactiveCoa = await db.chartOfAccount.create({
    data: {
      id: ID.coaInactive,
      businessId: ID.biz,
      code: '1012',
      name: `${P}Closed Bank COA`,
      type: 'ASSET',
      systemKey: null,
      isSystem: false,
      isActive: false,
    },
  });

  await db.financialAccount.createMany({
    data: [
      {
        id: ID.faBank,
        businessId: ID.biz,
        chartOfAccountId: bankChecking.id,
        name: `${P}Republic Checking`,
        type: 'BANK',
        currency: 'TTD',
        openingBalance: 5000,
        currentBalance: 5000,
        isActive: true,
      },
      {
        id: ID.faArchived,
        businessId: ID.biz,
        chartOfAccountId: bankChecking.id,
        name: `${P}Archived Checking`,
        type: 'BANK',
        currency: 'TTD',
        isActive: false,
      },
      {
        id: ID.faLoan,
        businessId: ID.biz,
        chartOfAccountId: loanPayable!.id,
        name: `${P}Equipment Loan`,
        type: 'LOAN',
        currency: 'TTD',
        isActive: true,
      },
      {
        id: ID.faUsd,
        businessId: ID.biz,
        chartOfAccountId: bankChecking.id,
        name: `${P}USD Wire Account`,
        type: 'BANK',
        currency: 'USD',
        isActive: true,
      },
      {
        id: ID.faInactiveCoa,
        businessId: ID.biz,
        chartOfAccountId: inactiveCoa.id,
        name: `${P}Inactive COA Bank`,
        type: 'BANK',
        currency: 'TTD',
        isActive: true,
      },
      {
        id: ID.faForeign,
        businessId: ID.bizF,
        chartOfAccountId: bankF!.id,
        name: `${P}Foreign Tenant Bank`,
        type: 'BANK',
        currency: 'TTD',
        isActive: true,
      },
    ],
  });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('Finding 1 (SEC-EXH2-3): cross-tenant, nonexistent & soft-deleted FK ownership validation on recurring create & update', () => {
  it('RES-01 RED-BEFORE: POST .../recurring rejects foreign-tenant, nonexistent, and soft-deleted categoryId/projectId/contactId/serviceId with 400, zero rows, and uniform message', async () => {
    const beforeCount = await db.recurringExpense.count({ where: { businessId: ID.biz } });

    const fieldCases: Array<{
      field: 'categoryId' | 'projectId' | 'contactId' | 'serviceId';
      foreign: string;
      nonexistent: string;
      deleted?: string;
    }> = [
      { field: 'categoryId', foreign: ID.catForeign, nonexistent: `${P}missing_cat` },
      { field: 'projectId', foreign: ID.projForeign, nonexistent: `${P}missing_proj`, deleted: ID.projDeleted },
      { field: 'contactId', foreign: ID.contactForeign, nonexistent: `${P}missing_contact`, deleted: ID.contactDeleted },
      { field: 'serviceId', foreign: ID.svcForeign, nonexistent: `${P}missing_svc`, deleted: ID.svcDeleted },
    ];

    for (const c of fieldCases) {
      const resForeign = await postRecurring(baseSchedulePayload({ name: `${P}bad_${c.field}_f`, [c.field]: c.foreign }));
      const resMissing = await postRecurring(baseSchedulePayload({ name: `${P}bad_${c.field}_m`, [c.field]: c.nonexistent }));

      expect(resForeign.status, `${c.field} foreign: ${JSON.stringify(resForeign.body)}`).toBe(400);
      expect(resMissing.status, `${c.field} missing: ${JSON.stringify(resMissing.body)}`).toBe(400);
      expect(resForeign.body.message, `${c.field} must not distinguish foreign vs nonexistent`).toBe(resMissing.body.message);

      if (c.deleted) {
        const resDeleted = await postRecurring(baseSchedulePayload({ name: `${P}bad_${c.field}_d`, [c.field]: c.deleted }));
        expect(resDeleted.status, `${c.field} soft-deleted: ${JSON.stringify(resDeleted.body)}`).toBe(400);
        expect(resDeleted.body.message, `${c.field} must not distinguish soft-deleted vs nonexistent`).toBe(resMissing.body.message);
      }
    }

    expect(await db.recurringExpense.count({ where: { businessId: ID.biz } })).toBe(beforeCount);
  });

  it('RES-02 RED-BEFORE: PATCH .../recurring/:id rejects foreign-tenant, nonexistent, and soft-deleted categoryId/projectId/contactId/serviceId with 400 and leaves row untouched', async () => {
    const created = await postRecurring(
      baseSchedulePayload({
        name: `${P}patch_fk_target`,
        categoryId: ID.catOwn,
        projectId: ID.projOwn,
        contactId: ID.contactOwn,
        serviceId: ID.svcOwn,
      }),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const recId = created.body.id;

    const fieldCases: Array<{
      field: 'categoryId' | 'projectId' | 'contactId' | 'serviceId';
      foreign: string;
      nonexistent: string;
      deleted?: string;
    }> = [
      { field: 'categoryId', foreign: ID.catForeign, nonexistent: `${P}missing_cat_p` },
      { field: 'projectId', foreign: ID.projForeign, nonexistent: `${P}missing_proj_p`, deleted: ID.projDeleted },
      { field: 'contactId', foreign: ID.contactForeign, nonexistent: `${P}missing_contact_p`, deleted: ID.contactDeleted },
      { field: 'serviceId', foreign: ID.svcForeign, nonexistent: `${P}missing_svc_p`, deleted: ID.svcDeleted },
    ];

    for (const c of fieldCases) {
      const resForeign = await patchRecurring(recId, { [c.field]: c.foreign });
      const resMissing = await patchRecurring(recId, { [c.field]: c.nonexistent });

      expect(resForeign.status, `PATCH ${c.field} foreign: ${JSON.stringify(resForeign.body)}`).toBe(400);
      expect(resMissing.status, `PATCH ${c.field} missing: ${JSON.stringify(resMissing.body)}`).toBe(400);
      expect(resForeign.body.message).toBe(resMissing.body.message);

      if (c.deleted) {
        const resDeleted = await patchRecurring(recId, { [c.field]: c.deleted });
        expect(resDeleted.status, `PATCH ${c.field} soft-deleted: ${JSON.stringify(resDeleted.body)}`).toBe(400);
        expect(resDeleted.body.message).toBe(resMissing.body.message);
      }
    }

    const row = await db.recurringExpense.findUnique({ where: { id: recId } });
    expect(row.categoryId).toBe(ID.catOwn);
    expect(row.projectId).toBe(ID.projOwn);
    expect(row.contactId).toBe(ID.contactOwn);
    expect(row.serviceId).toBe(ID.svcOwn);
  });

  it('RES-03 CONTROL: POST and PATCH accept valid own-tenant active FKs and clearing them to null on PATCH', async () => {
    const created = await postRecurring(
      baseSchedulePayload({
        name: `${P}valid_fks`,
        categoryId: ID.catOwn,
        projectId: ID.projOwn,
        contactId: ID.contactOwn,
        serviceId: ID.svcOwn,
      }),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.categoryId).toBe(ID.catOwn);
    expect(created.body.projectId).toBe(ID.projOwn);
    expect(created.body.contactId).toBe(ID.contactOwn);
    expect(created.body.serviceId).toBe(ID.svcOwn);

    const cleared = await patchRecurring(created.body.id, {
      categoryId: null,
      projectId: null,
      contactId: null,
      serviceId: null,
    });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(cleared.body.categoryId).toBeNull();
    expect(cleared.body.projectId).toBeNull();
    expect(cleared.body.contactId).toBeNull();
    expect(cleared.body.serviceId).toBeNull();
  });
});

describe('Finding 2: guard parity (BusinessMemberGuard + ModuleScopeGuard) on RecurringExpensesController', () => {
  it('RES-04 RED-BEFORE: non-member SUPER_ADMIN is refused 403 on POST/PATCH/DELETE/run recurring routes with zero writes', async () => {
    const seeded = await postRecurring(baseSchedulePayload({ name: `${P}guard_parity_seed` }));
    expect(seeded.status, JSON.stringify(seeded.body)).toBe(201);
    const recId = seeded.body.id;
    const beforeCount = await db.recurringExpense.count({ where: { businessId: ID.biz } });

    const createRes = await postRecurring(baseSchedulePayload({ name: `${P}sa_create` }), ID.biz, ID.superAdmin);
    expect(createRes.status, `POST SUPER_ADMIN: ${JSON.stringify(createRes.body)}`).toBe(403);
    expect(await db.recurringExpense.count({ where: { businessId: ID.biz } })).toBe(beforeCount);

    const patchRes = await patchRecurring(recId, { amount: 999 }, ID.biz, ID.superAdmin);
    expect(patchRes.status, `PATCH SUPER_ADMIN: ${JSON.stringify(patchRes.body)}`).toBe(403);
    expect((await db.recurringExpense.findUnique({ where: { id: recId } })).amount).toBe(100);

    const runRes = await runRecurringNow(recId, ID.biz, ID.superAdmin);
    expect(runRes.status, `POST run SUPER_ADMIN: ${JSON.stringify(runRes.body)}`).toBe(403);
    expect(await db.expense.count({ where: { businessId: ID.biz, recurringExpenseId: recId } })).toBe(0);

    const delRes = await deleteRecurring(recId, ID.biz, ID.superAdmin);
    expect(delRes.status, `DELETE SUPER_ADMIN: ${JSON.stringify(delRes.body)}`).toBe(403);
    expect((await db.recurringExpense.findUnique({ where: { id: recId } })).isActive).toBe(true);
  });

  it('RES-05 CONTROL: scope & auth parity across GET/POST/PATCH/DELETE/run routes', async () => {
    const created = await postRecurring(baseSchedulePayload({ name: `${P}scope_ctrl` }), ID.biz, ID.writerNoRev);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const recId = created.body.id;

    // Unauthenticated -> 401
    expect((await getRecurringList(ID.biz, null)).status).toBe(401);
    expect((await postRecurring(baseSchedulePayload({ name: `${P}anon` }), ID.biz, null)).status).toBe(401);

    // expenses:read -> 200 on GET, 403 on all writes
    expect((await getRecurringList(ID.biz, ID.reader)).status).toBe(200);
    expect((await getRecurringOne(recId, ID.biz, ID.reader)).status).toBe(200);
    expect((await postRecurring(baseSchedulePayload({ name: `${P}reader_post` }), ID.biz, ID.reader)).status).toBe(403);
    expect((await patchRecurring(recId, { amount: 111 }, ID.biz, ID.reader)).status).toBe(403);
    expect((await runRecurringNow(recId, ID.biz, ID.reader)).status).toBe(403);
    expect((await deleteRecurring(recId, ID.biz, ID.reader)).status).toBe(403);

    // expenses:write member succeeds on PATCH, run, DELETE
    expect((await patchRecurring(recId, { amount: 120 }, ID.biz, ID.writerNoRev)).status).toBe(200);
    expect((await runRecurringNow(recId, ID.biz, ID.writerNoRev)).status).toBe(201);
    expect((await deleteRecurring(recId, ID.biz, ID.writerNoRev)).status).toBe(200);
  });
});

describe('Finding 3: runOnce honors dueOffsetDays: 0', () => {
  it('RES-06 RED-BEFORE: createsBill: true with dueOffsetDays: 0 sets dueDate === runDate (not +30 days)', async () => {
    const created = await postRecurring(
      baseSchedulePayload({
        name: `${P}due_zero`,
        description: `${P}Due on receipt bill`,
        createsBill: true,
        dueOffsetDays: 0,
      }),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.dueOffsetDays).toBe(0);

    const runAt = new Date('2026-12-15T12:00:00.000Z');
    await recurringSvc.runOnce(created.body.id, ID.biz, runAt);

    const generated = await db.expense.findMany({
      where: { businessId: ID.biz, recurringExpenseId: created.body.id },
    });
    expect(generated).toHaveLength(1);
    expect(generated[0].status).toBe('BILL');
    expect(generated[0].date.getTime()).toBe(runAt.getTime());
    expect(generated[0].dueDate?.getTime()).toBe(runAt.getTime());
  });

  it('RES-07 CONTROL: dueOffsetDays positive / null and createsBill: false keep expected dueDate semantics', async () => {
    const runAt = new Date('2026-12-15T12:00:00.000Z');

    const tenDays = await postRecurring(
      baseSchedulePayload({ name: `${P}due_10`, createsBill: true, dueOffsetDays: 10 }),
    );
    expect(tenDays.status).toBe(201);
    await recurringSvc.runOnce(tenDays.body.id, ID.biz, runAt);
    const [exp10] = await db.expense.findMany({ where: { businessId: ID.biz, recurringExpenseId: tenDays.body.id } });
    expect(exp10.status).toBe('BILL');
    expect(exp10.dueDate?.getTime()).toBe(runAt.getTime() + 10 * 86400000);

    const nullOffset = await postRecurring(
      baseSchedulePayload({ name: `${P}due_null`, createsBill: true }),
    );
    expect(nullOffset.status).toBe(201);
    await recurringSvc.runOnce(nullOffset.body.id, ID.biz, runAt);
    const [expNull] = await db.expense.findMany({ where: { businessId: ID.biz, recurringExpenseId: nullOffset.body.id } });
    expect(expNull.status).toBe('BILL');
    expect(expNull.dueDate?.getTime()).toBe(runAt.getTime() + 30 * 86400000);

    const paidRec = await postRecurring(
      baseSchedulePayload({ name: `${P}paid_rec`, createsBill: false }),
    );
    expect(paidRec.status).toBe(201);
    await recurringSvc.runOnce(paidRec.body.id, ID.biz, runAt);
    const [expPaid] = await db.expense.findMany({ where: { businessId: ID.biz, recurringExpenseId: paidRec.body.id } });
    expect(expPaid.status).toBe('PAID');
    expect(expPaid.dueDate).toBeNull();
  });
});

describe('Finding 4 (COR-F1): processDueRecurringExpenses catch-up / paid-status safety', () => {
  it('RES-08 RED-BEFORE: a schedule 6 months overdue generates at most 1 expense across repeated ticks, advances nextRunDate strictly past now, and never catches up historical PAID outflows', async () => {
    const now = new Date();
    const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, 15, 0, 0, 0));

    const stale = await db.recurringExpense.create({
      data: {
        id: `${P}stale_catchup`,
        businessId: ID.biz,
        name: `${P}Stale Monthly Rent`,
        description: `${P}Stale Monthly Rent`,
        amount: 250,
        currency: 'TTD',
        frequency: 'MONTHLY',
        nextRunDate: sixMonthsAgo,
        createsBill: false,
        isActive: true,
      },
    });

    // Tick 1 (Hour 1)
    await recurringSvc.processDueRecurringExpenses();

    const afterTick1 = await db.recurringExpense.findUnique({ where: { id: stale.id } });
    const expensesAfterTick1 = await db.expense.findMany({
      where: { businessId: ID.biz, recurringExpenseId: stale.id },
    });
    expect(expensesAfterTick1).toHaveLength(1);
    expect(afterTick1.runCount).toBe(1);
    expect(
      afterTick1.nextRunDate.getTime(),
      `nextRunDate (${afterTick1.nextRunDate.toISOString()}) must advance strictly past now (${now.toISOString()})`,
    ).toBeGreaterThan(now.getTime());
    expect(afterTick1.nextRunDate.getUTCDate()).toBe(15);

    // Tick 2 (Hour 2) — MUST NOT generate a second catch-up expense
    await recurringSvc.processDueRecurringExpenses();

    const expensesAfterTick2 = await db.expense.findMany({
      where: { businessId: ID.biz, recurringExpenseId: stale.id },
    });
    expect(expensesAfterTick2, 'second hourly tick must not catch up missed periods').toHaveLength(1);
    const afterTick2 = await db.recurringExpense.findUnique({ where: { id: stale.id } });
    expect(afterTick2.runCount).toBe(1);

    // Exactly 1 ledger transaction for the single emitted expense (no historical catch-up postings)
    const txns = await db.financialTransaction.findMany({
      where: { businessId: ID.biz, sourceType: 'Expense', sourceId: expensesAfterTick2[0].id },
    });
    expect(txns).toHaveLength(1);
  });
});

describe('Finding 5 (COR-F6): computeNext month-end clamping and anchor-day preservation', () => {
  it('RES-09 RED-BEFORE: computeNext clamps month-end dates without overflowing into March and preserves anchor day across months', async () => {
    const computeNext = RecurringExpenseServiceClass.computeNext as (
      from: Date,
      frequency: string,
      anchorDay?: number,
    ) => Date;

    // Non-leap Jan 31 + MONTHLY -> Feb 28 (NOT Mar 3)
    const jan31 = new Date('2026-01-31T00:00:00.000Z');
    const feb28 = computeNext(jan31, 'MONTHLY', 31);
    expect(feb28.toISOString()).toBe('2026-02-28T00:00:00.000Z');

    // Without explicit anchorDay, single step still clamps to Feb 28 (NOT Mar 3)
    expect(computeNext(jan31, 'MONTHLY').toISOString()).toBe('2026-02-28T00:00:00.000Z');

    // Leap year Jan 31 + MONTHLY -> Feb 29 (NOT Mar 2)
    const leapJan31 = new Date('2028-01-31T00:00:00.000Z');
    expect(computeNext(leapJan31, 'MONTHLY').toISOString()).toBe('2028-02-29T00:00:00.000Z');

    // Anchor day 31 preserved across subsequent months: Feb 28 -> Mar 31 -> Apr 30 -> May 31
    const mar31 = computeNext(feb28, 'MONTHLY', 31);
    expect(mar31.toISOString()).toBe('2026-03-31T00:00:00.000Z');
    const apr30 = computeNext(mar31, 'MONTHLY', 31);
    expect(apr30.toISOString()).toBe('2026-04-30T00:00:00.000Z');
    const may31 = computeNext(apr30, 'MONTHLY', 31);
    expect(may31.toISOString()).toBe('2026-05-31T00:00:00.000Z');

    // QUARTERLY: Nov 30 -> Feb 28 (NOT Mar 2), then May 30 with anchor 30
    const nov30 = new Date('2025-11-30T00:00:00.000Z');
    const qFeb28 = computeNext(nov30, 'QUARTERLY', 30);
    expect(qFeb28.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(computeNext(qFeb28, 'QUARTERLY', 30).toISOString()).toBe('2026-05-30T00:00:00.000Z');

    // YEARLY: leap Feb 29 -> Feb 28 (NOT Mar 1)
    const leapDay = new Date('2024-02-29T00:00:00.000Z');
    expect(computeNext(leapDay, 'YEARLY').toISOString()).toBe('2025-02-28T00:00:00.000Z');

    // WEEKLY / BIWEEKLY
    expect(computeNext(jan31, 'WEEKLY').toISOString()).toBe('2026-02-07T00:00:00.000Z');
    expect(computeNext(jan31, 'BIWEEKLY').toISOString()).toBe('2026-02-14T00:00:00.000Z');

    // DB persistence via runOnce on Jan 31 lands on Feb 28 (NOT Mar 3)
    const jan31Schedule = await db.recurringExpense.create({
      data: {
        id: `${P}jan31_rec`,
        businessId: ID.biz,
        name: `${P}Jan 31 Schedule`,
        description: `${P}Jan 31 Schedule`,
        amount: 50,
        currency: 'TTD',
        frequency: 'MONTHLY',
        nextRunDate: new Date('2026-01-31T00:00:00.000Z'),
        createsBill: true,
        isActive: true,
      },
    });
    await recurringSvc.runOnce(jan31Schedule.id, ID.biz, new Date('2026-01-31T10:00:00.000Z'));
    const updated = await db.recurringExpense.findUnique({ where: { id: jan31Schedule.id } });
    expect(updated.nextRunDate.toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });
});

describe('Finding 6: refuse a past nextRunDate on create and update (respecting business timezone)', () => {
  it('RES-10 RED-BEFORE: POST and PATCH refuse strictly past or invalid nextRunDate with 400 and zero DB writes', async () => {
    const todayPos = dayInZone(new Date(), 'America/Port_of_Spain');
    const yesterdayPos = addDaysToDayString(todayPos, -1);
    const beforeCount = await db.recurringExpense.count({ where: { businessId: ID.biz } });

    const resYesterday = await postRecurring(baseSchedulePayload({ name: `${P}past_yest`, nextRunDate: yesterdayPos }));
    expect(resYesterday.status, `yesterday create: ${JSON.stringify(resYesterday.body)}`).toBe(400);

    const resOld = await postRecurring(baseSchedulePayload({ name: `${P}past_2020`, nextRunDate: '2020-01-15' }));
    expect(resOld.status, `2020 create: ${JSON.stringify(resOld.body)}`).toBe(400);

    const resInvalid = await postRecurring(baseSchedulePayload({ name: `${P}bad_date`, nextRunDate: 'not-a-date' }));
    expect(resInvalid.status, `invalid date create: ${JSON.stringify(resInvalid.body)}`).toBe(400);

    expect(await db.recurringExpense.count({ where: { businessId: ID.biz } })).toBe(beforeCount);

    // Create a valid schedule, then try to PATCH nextRunDate into the past
    const valid = await postRecurring(baseSchedulePayload({ name: `${P}patch_past_target`, nextRunDate: futureDay(5) }));
    expect(valid.status).toBe(201);
    const originalNextRun = valid.body.nextRunDate;

    const patchYest = await patchRecurring(valid.body.id, { nextRunDate: yesterdayPos });
    expect(patchYest.status, `PATCH yesterday: ${JSON.stringify(patchYest.body)}`).toBe(400);

    const patchOld = await patchRecurring(valid.body.id, { nextRunDate: '2020-01-15' });
    expect(patchOld.status, `PATCH 2020: ${JSON.stringify(patchOld.body)}`).toBe(400);

    const patchBad = await patchRecurring(valid.body.id, { nextRunDate: 'not-a-date' });
    expect(patchBad.status, `PATCH invalid: ${JSON.stringify(patchBad.body)}`).toBe(400);

    const after = await db.recurringExpense.findUnique({ where: { id: valid.body.id } });
    expect(after.nextRunDate.toISOString()).toBe(originalNextRun);
  });

  it('RES-11 CONTROL: today in business TZ (YYYY-MM-DD and Date) and future dates succeed; PATCH omitting nextRunDate on past schedule succeeds; Asia/Tokyo TZ honored', async () => {
    const todayPos = dayInZone(new Date(), 'America/Port_of_Spain');
    const todayRes = await postRecurring(baseSchedulePayload({ name: `${P}today_pos`, nextRunDate: todayPos }));
    expect(todayRes.status, `today YYYY-MM-DD: ${JSON.stringify(todayRes.body)}`).toBe(201);

    // Service call with `new Date()` (EC-04 compatibility)
    const directNow = await recurringSvc.create({
      businessId: ID.biz,
      name: `${P}direct_now`,
      description: `${P}direct_now`,
      amount: 42,
      frequency: 'MONTHLY',
      nextRunDate: new Date(),
    });
    expect(directNow.id).toBeTruthy();

    // Existing schedule with past nextRunDate can still be patched when nextRunDate is omitted
    const pastRow = await db.recurringExpense.create({
      data: {
        id: `${P}past_edit_ok`,
        businessId: ID.biz,
        name: `${P}Past Paused`,
        description: `${P}Past Paused`,
        amount: 80,
        currency: 'TTD',
        frequency: 'MONTHLY',
        nextRunDate: new Date('2025-01-10T00:00:00.000Z'),
        isActive: false,
      },
    });
    const patchAmount = await patchRecurring(pastRow.id, { amount: 95 });
    expect(patchAmount.status, JSON.stringify(patchAmount.body)).toBe(200);
    expect(patchAmount.body.amount).toBe(95);

    // Asia/Tokyo timezone: today in Tokyo accepted, yesterday in Tokyo rejected
    const todayTokyo = dayInZone(new Date(), 'Asia/Tokyo');
    const yesterdayTokyo = addDaysToDayString(todayTokyo, -1);
    const tokyoOk = await postRecurring(
      baseSchedulePayload({ name: `${P}tokyo_today`, nextRunDate: todayTokyo }),
      ID.bizTokyo,
      ID.owner,
    );
    expect(tokyoOk.status, `Tokyo today: ${JSON.stringify(tokyoOk.body)}`).toBe(201);

    const tokyoPast = await postRecurring(
      baseSchedulePayload({ name: `${P}tokyo_yest`, nextRunDate: yesterdayTokyo }),
      ID.bizTokyo,
      ID.owner,
    );
    expect(tokyoPast.status, `Tokyo yesterday: ${JSON.stringify(tokyoPast.body)}`).toBe(400);
  });
});

describe('Finding 7: eliminate distinguishable payment-account refusals on bills/:id/pay', () => {
  it('RES-12 RED-BEFORE: member with expenses:write and NO revenue:read gets a uniform 403 refusal across every paymentAccountId state (no existence/type/currency/archive oracle)', async () => {
    const created = await createBill({
      description: `${P}oracle_guard_bill`,
      amount: 160,
      currency: 'TTD',
      vendor: 'Oracle Vendor',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const billId = created.body.id;
    const beforeCounts = await ledgerCounts(ID.biz);

    const probeIds: Array<[string, string]> = [
      ['valid active BANK account', ID.faBank],
      ['archived account', ID.faArchived],
      ['LOAN account', ID.faLoan],
      ['USD currency mismatch account', ID.faUsd],
      ['inactive COA account', ID.faInactiveCoa],
      ['foreign-tenant account', ID.faForeign],
      ['nonexistent account', `${P}nonexistent_fa`],
    ];

    const messages = new Set<string>();
    for (const [label, paymentAccountId] of probeIds) {
      const res = await payBill(billId, { paymentAccountId }, ID.biz, ID.writerNoRev);
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(403);
      messages.add(String(res.body?.message ?? ''));

      const row = await db.expense.findUnique({ where: { id: billId } });
      expect(row.status, `${label} must leave bill as BILL`).toBe('BILL');
      expect(row.paidAt, `${label} must leave paidAt null`).toBeNull();
      expect(await ledgerCounts(ID.biz), `${label} must write zero ledger rows`).toEqual(beforeCounts);
    }

    expect(
      messages.size,
      `all paymentAccountId probes for a member without revenue:read must return one uniform message, got: ${JSON.stringify([...messages])}`,
    ).toBe(1);
  });

  it('RES-13 CONTROL: member without revenue:read can still pay via default cash path; member with expenses:write + revenue:read can pay with explicit paymentAccountId', async () => {
    // 1. writerNoRev omits paymentAccountId -> 201 (default cash path)
    const bill1 = await createBill({ description: `${P}default_pay_norev`, amount: 75, currency: 'TTD' });
    expect(bill1.status).toBe(201);
    const payDefault = await payBill(bill1.body.id, { paymentMethod: 'cash' }, ID.biz, ID.writerNoRev);
    expect(payDefault.status, JSON.stringify(payDefault.body)).toBe(201);
    expect(payDefault.body.status).toBe('PAID');

    // 2. writerNoRev sends explicit paymentAccountId: null -> 201 (default cash path)
    const bill2 = await createBill({ description: `${P}null_pay_norev`, amount: 85, currency: 'TTD' });
    expect(bill2.status).toBe(201);
    const payNull = await payBill(bill2.body.id, { paymentAccountId: null }, ID.biz, ID.writerNoRev);
    expect(payNull.status, JSON.stringify(payNull.body)).toBe(201);
    expect(payNull.body.status).toBe('PAID');

    // 3. writerWithRev (expenses:write + revenue:read) pays with explicit BANK paymentAccountId -> 201 crediting chosen Bank COA
    const bill3 = await createBill({ description: `${P}explicit_pay_withrev`, amount: 190, currency: 'TTD' });
    expect(bill3.status).toBe(201);
    const payExplicit = await payBill(bill3.body.id, { paymentAccountId: ID.faBank }, ID.biz, ID.writerWithRev);
    expect(payExplicit.status, JSON.stringify(payExplicit.body)).toBe(201);
    expect(payExplicit.body.status).toBe('PAID');

    const txns = await db.financialTransaction.findMany({
      where: { sourceType: 'Expense', sourceId: bill3.body.id, externalRef: `Expense:${bill3.body.id}:bill_paid` },
      include: { entries: true },
    });
    expect(txns).toHaveLength(1);
    const cr = txns[0].entries.find((e: any) => Number(e.credit) > 0);
    expect(cr.accountId).toBe(coaBankCheckingId);
  });
});
