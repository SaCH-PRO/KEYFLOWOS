/**
 * R0-09f-D11-FINANCE-TAX-AND-WEB — owner ruling D-11 (editing the business
 * profile is OWNER only, regardless of granted scopes) holds on the last
 * Business-row writer R0-09d's sweep found open: the finance settings PATCH.
 * REAL database.
 *
 *   PATCH /finance/businesses/:id/settings
 *        FinanceController.patchSettings (AuthGuard, BusinessGuard and
 *        ensureAccess: any member) -> FinanceSettingsService.update, which
 *        writes Business.defaultTaxRate — the tax rate the owner-only
 *        PATCH /identity/businesses/:id writes (UpdateBusinessDto, R0-09) —
 *        so a STAFF member with settings:none changes the business's tax rate
 *        the profile PATCH refuses them.
 *
 * REQUIRED (the it.todo this packet removes from
 * identity-boundary.integration.test.ts, "OPEN DEFECTS — D-11 sibling write
 * paths"): a non-owner — STAFF on the role defaults (settings:none), ADMIN on
 * the role defaults, ADMIN granted settings:write — who CHANGES defaultTaxRate
 * is refused 403 BUSINESS_PROFILE_OWNER_ONLY (the code the concierge, genesis
 * and template refusals answer) with the Business row byte-identical
 * (row_to_json text): nothing of the submission is written (cases F01-F04).
 * The owner — an OWNER membership or the distinguished owner
 * (Business.ownerId), the two arms IdentityService.assertBusinessOwner and
 * BusinessGuard admit an owner by — and a SUPER_ADMIN (the platform bypass)
 * still change it (cases F07-F09).
 *
 * GATED BY FIELD, NOT AS A ROUTE: the other finance settings this route
 * writes — accountingBasis, fiscalYearStartMonth, defaultCashAccountId,
 * defaultArAccountId, defaultApAccountId, defaultTaxAccountId and
 * accountantEmail — are not fields of the owner-only profile PATCH (they are
 * not in UpdateBusinessDto) and keep today's rule (any member; case F05). The
 * web finance settings page saves the whole form, defaultTaxRate included,
 * with the value GET returned (FinanceSettingsService.get answers a stored
 * NULL as 0): a non-owner who resubmits the current rate is not changing it,
 * so the save goes through (case F06) and the rate is not written: a
 * non-owner never writes Business.defaultTaxRate, a stored NULL included
 * (case F11).
 * THE OWNER CHECK IS BOUND TO THE ROUTE'S BUSINESS (the R0-09d review SEC-T1
 * fixture): a STAFF member of bizF who owns a business of their own (bizO: an
 * OWNER membership and Business.ownerId) is refused on bizF, also when the
 * x-business-id header, ?businessId= and the body's businessId all name bizO
 * (case F04).
 * TODAY'S RULE PINNED, NOT WIDENED: ensureAccess admits the owner or a member
 * only, so a SUPER_ADMIN with no membership is refused by it before the owner
 * check (403 FORBIDDEN, case F10); the SUPER_ADMIN arm is proven with a
 * SUPER_ADMIN that holds a STAFF membership (case F09).
 *
 * HOW THE APP IS COMPOSED (the contacts-visibility model): a real Nest app with
 * the real FinanceController, FinanceSettingsService, PrismaService, AuthGuard,
 * BusinessGuard and the production GlobalHttpExceptionFilter, against the
 * database at DATABASE_URL. The one stand-in on the authorization path is
 * identity attachment: a test middleware reads `x-test-user`, loads that seeded
 * User row and attaches `{ id, email, role }` exactly as AuthMiddleware does
 * after token verification. FinanceController's other collaborators (ledger,
 * bank, tax, export and the rest) are never reached by the settings routes and
 * are empty stand-ins.
 *
 * FIXTURES: every user, business and membership id has the `k09f_` prefix
 * (registered in test/helpers/fixture-prefixes.json, packet
 * 'R0-09 / R0-09f-D11-FINANCE-TAX-AND-WEB'), every unique column written here
 * (User.email) contains it, and every row is hard-deleted with
 * LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll. No $transaction
 * wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k09f_';

const ID = {
  owner: `${P}owner`,             // the founding owner: OWNER membership + Business.ownerId of bizF
  coOwner: `${P}coOwner`,         // a second OWNER membership on bizF, not Business.ownerId (the membership arm alone)
  staff: `${P}staff`,             // STAFF, role-default scopes (settings: none)
  admin: `${P}admin`,             // ADMIN, role-default scopes
  adminW: `${P}adminW`,           // ADMIN, ADMIN defaults with settings: write
  superStaff: `${P}superStaff`,   // User.role SUPER_ADMIN holding a STAFF membership on bizF (passes ensureAccess)
  superAdmin: `${P}superAdmin`,   // User.role SUPER_ADMIN, no membership anywhere
  legacyOwner: `${P}legacyOwner`, // Business.ownerId of bizL, no membership row
  staffOwner: `${P}staffOwner`,   // STAFF on bizF; OWNER membership and Business.ownerId of bizO (review SEC-T1)
  bizF: `${P}bizF`,               // the finance settings under test
  bizL: `${P}bizL`,               // the distinguished-owner control
  bizO: `${P}bizO`,               // the staff owner's own business
};
const USERS = [ID.owner, ID.coOwner, ID.staff, ID.admin, ID.adminW, ID.superStaff, ID.superAdmin, ID.legacyOwner, ID.staffOwner];
const NON_OWNERS: Array<{ id: string; label: string }> = [
  { id: ID.staff, label: 'STAFF, role defaults (settings:none)' },
  { id: ID.adminW, label: 'ADMIN, settings:write' },
  { id: ID.admin, label: 'ADMIN, role defaults' },
];
const emailOf = (id: string) => `${id}@k09f.test.local`;

/** The owner-set finance settings every case starts from (a reset puts them back). */
const SEEDED = {
  defaultTaxRate: 12.5,
  accountingBasis: 'CASH',
  fiscalYearStartMonth: 1,
  defaultCashAccountId: `${P}seed-cash-account`,
  accountantEmail: `seed@${P}accountant.test.local`,
};

/** The refusal code the server answers with (asserted, so a 403 from another layer does not pass). */
const PROFILE_CODE = 'BUSINESS_PROFILE_OWNER_ONLY';

let db: any;
let app: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort: cascades cover most of these */ }
  }
}

/** The Business row exactly as Postgres stores it, so "unchanged" means byte-identical. */
async function businessRowText(id: string): Promise<string> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(b)::text AS j FROM businesses b WHERE b.id = $1', id);
  expect(rows.length, `business ${id} exists`).toBe(1);
  return rows[0].j as string;
}

async function finance(id: string) {
  return db.business.findUnique({
    where: { id },
    select: {
      defaultTaxRate: true, accountingBasis: true, fiscalYearStartMonth: true,
      defaultCashAccountId: true, accountantEmail: true,
    },
  });
}

/** Each case starts from the seeded finance settings (on the unmodified code the refusal cases change the row). Raw SQL. */
async function reset(
  businessId: string,
  taxRate: number | null = SEEDED.defaultTaxRate,
  cashAccountId: string | null = SEEDED.defaultCashAccountId,
) {
  await db.$executeRawUnsafe(
    `UPDATE businesses SET default_tax_rate = $2, accounting_basis = $3, fiscal_year_start_month = $4,
       default_cash_account_id = $5, accountant_email = $6 WHERE id = $1`,
    businessId, taxRate, SEEDED.accountingBasis, SEEDED.fiscalYearStartMonth, cashAccountId, SEEDED.accountantEmail,
  );
}

function patchSettings(actor: string, businessId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .patch(`/finance/businesses/${businessId}/settings`)
    .set('x-test-user', actor)
    .send(body);
}

function getSettings(actor: string, businessId: string) {
  return request(app.getHttpServer())
    .get(`/finance/businesses/${businessId}/settings`)
    .set('x-test-user', actor);
}

/** Review SEC-T1: every other place a request can name a tenant points at `elsewhere`. */
function patchSettingsNaming(actor: string, businessId: string, elsewhere: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .patch(`/finance/businesses/${businessId}/settings?businessId=${elsewhere}`)
    .set('x-test-user', actor)
    .set('x-business-id', elsewhere)
    .send({ ...body, businessId: elsewhere });
}

/** A refused write: 403 with the expected code and no settings in the body. */
function expectRefusal(res: { status: number; body: any }, label: string) {
  expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(403);
  expect(res.body?.code, `${label}: refusal code`).toBe(PROFILE_CODE);
  for (const key of ['defaultTaxRate', 'accountingBasis', 'fiscalYearStartMonth', 'currency', 'accountantEmail', 'ownerId']) {
    expect(res.body).not.toHaveProperty(key);
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { FinanceSettingsService } = await import('../src/modules/finance/finance-settings.service');

  // FinanceController's other collaborators: never reached by the settings routes.
  const unused = await Promise.all([
    import('../src/modules/finance/receivables.service').then((m) => m.ReceivablesService),
    import('../src/modules/finance/ledger-balance.service').then((m) => m.LedgerBalanceService),
    import('../src/modules/finance/finance-overview.service').then((m) => m.FinanceOverviewService),
    import('../src/modules/finance/finance-accounts.service').then((m) => m.FinanceAccountsService),
    import('../src/modules/finance/finance-coa.service').then((m) => m.FinanceCoaService),
    import('../src/modules/finance/finance-tax-rate.service').then((m) => m.FinanceTaxRateService),
    import('../src/modules/finance/bank-import.service').then((m) => m.BankImportService),
    import('../src/modules/finance/statement-source.service').then((m) => m.StatementSourceService),
    import('../src/modules/finance/bank-matching.service').then((m) => m.BankMatchingService),
    import('../src/modules/finance/bank-rule.service').then((m) => m.BankRuleService),
    import('../src/modules/finance/recurring-journal-entry.service').then((m) => m.RecurringJournalEntryService),
    import('../src/modules/finance/reconciliation.service').then((m) => m.ReconciliationService),
    import('../src/modules/finance/tax-liability.service').then((m) => m.TaxLiabilityService),
    import('../src/modules/finance/accountant-export.service').then((m) => m.AccountantExportService),
    import('../src/modules/finance/finance-intelligence.service').then((m) => m.FinanceIntelligenceService),
    import('../src/modules/finance/accountant-export-email.service').then((m) => m.AccountantExportEmailService),
    import('../src/modules/finance/posting.service').then((m) => m.PostingService),
    import('../src/modules/finance/safe-to-spend.service').then((m) => m.SafeToSpendService),
    import('../src/modules/finance/cashflow-forecast.service').then((m) => m.CashflowForecastService),
    import('../src/modules/finance/money-moves.service').then((m) => m.MoneyMovesService),
    import('../src/modules/finance/cash-reserve.service').then((m) => m.CashReserveService),
    import('../src/modules/finance/credit-note.service').then((m) => m.CreditNoteService),
    import('../src/modules/finance/accounting-period.service').then((m) => m.AccountingPeriodService),
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
      FinanceSettingsService,
      ...unused.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  // Identity attachment only, as AuthMiddleware attaches it from the User row.
  // No guard on these routes is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const id of USERS) {
    await db.user.create({
      data: { id, email: emailOf(id), name: id, role: id === ID.superAdmin || id === ID.superStaff ? 'SUPER_ADMIN' : 'USER' },
    });
  }
  for (const [businessId, ownerId] of [[ID.bizF, ID.owner], [ID.bizL, ID.legacyOwner], [ID.bizO, ID.staffOwner]]) {
    await db.business.create({ data: { id: businessId, name: `${businessId}-name`, ownerId, currency: 'TTD' } });
    await reset(businessId);
  }
  const { ROLE_DEFAULT_SCOPES } = await import('../src/core/authority/module-vocabulary');
  const memberships: Array<{ userId: string; businessId: string; role: string; permissionScopes?: Record<string, string> }> = [
    { userId: ID.owner, businessId: ID.bizF, role: 'OWNER' },
    { userId: ID.coOwner, businessId: ID.bizF, role: 'OWNER' },
    { userId: ID.staff, businessId: ID.bizF, role: 'STAFF' },
    { userId: ID.admin, businessId: ID.bizF, role: 'ADMIN' },
    { userId: ID.adminW, businessId: ID.bizF, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, settings: 'write' } },
    { userId: ID.superStaff, businessId: ID.bizF, role: 'STAFF' },
    { userId: ID.staffOwner, businessId: ID.bizF, role: 'STAFF' },
    // The staff owner's own business: both owner arms (OWNER membership and Business.ownerId).
    { userId: ID.staffOwner, businessId: ID.bizO, role: 'OWNER' },
  ];
  for (const m of memberships) {
    await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}_${m.businessId.slice(P.length)}`, ...m } });
  }
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('R0-09f fixture sanity (real rows)', () => {
  it('[D11F-X01] seeded three tenants, nine users and eight memberships; bizL and the plain super admin have no membership; the co-owner is not Business.ownerId; the staff owner is STAFF on bizF and owns bizO; bizF starts at the seeded finance settings', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(3);
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(9);
    expect(await db.membership.count({ where: { id: { startsWith: P } } })).toBe(8);
    expect(await db.membership.count({ where: { businessId: ID.bizL } })).toBe(0);
    expect(await db.membership.count({ where: { userId: ID.superAdmin } })).toBe(0);
    expect(await db.business.count({ where: { ownerId: ID.coOwner } })).toBe(0);
    const staffOwnerRoles = await db.membership.findMany({
      where: { userId: ID.staffOwner }, select: { businessId: true, role: true }, orderBy: { businessId: 'asc' },
    });
    expect(staffOwnerRoles).toEqual([{ businessId: ID.bizF, role: 'STAFF' }, { businessId: ID.bizO, role: 'OWNER' }]);
    expect(await finance(ID.bizF)).toEqual(SEEDED);
  });
});

describe('R0-09f finance settings cannot change the business tax rate for a non-owner (D-11, R0-09d sweep)', () => {
  it('[D11F-F01] RED-BEFORE: a STAFF member (settings:none) changes defaultTaxRate: 403 BUSINESS_PROFILE_OWNER_ONLY, the Business row byte-identical, GET still answers the seeded rate', async () => {
    await reset(ID.bizF);
    const before = await businessRowText(ID.bizF);
    const res = await patchSettings(ID.staff, ID.bizF, { defaultTaxRate: 99 });
    expect((await finance(ID.bizF))?.defaultTaxRate, `patch ${res.status}: Business.defaultTaxRate`).toBe(SEEDED.defaultTaxRate);
    expect(await businessRowText(ID.bizF), 'the Business row is byte-identical').toBe(before);
    expectRefusal(res, 'STAFF defaultTaxRate');
    const read = await getSettings(ID.staff, ID.bizF);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body.defaultTaxRate).toBe(SEEDED.defaultTaxRate);
  });

  it('[D11F-F02] RED-BEFORE: an ADMIN granted settings:write and an ADMIN on role defaults are refused too (403): the Business row byte-identical', async () => {
    for (const { id, label } of NON_OWNERS.slice(1)) {
      await reset(ID.bizF);
      const before = await businessRowText(ID.bizF);
      const res = await patchSettings(id, ID.bizF, { defaultTaxRate: 0 });
      expect(await businessRowText(ID.bizF), `${label}: patch ${res.status}: the Business row is byte-identical`).toBe(before);
      expectRefusal(res, `${label}: defaultTaxRate`);
    }
  });

  it('[D11F-F03] RED-BEFORE: a defaultTaxRate change sent beside the open finance settings (accountingBasis, fiscalYearStartMonth, defaultCashAccountId, accountantEmail) by a STAFF member or an ADMIN granted settings:write is refused as a whole (403): nothing of the submission is written', async () => {
    for (const { id, label } of NON_OWNERS.slice(0, 2)) {
      await reset(ID.bizF);
      const before = await businessRowText(ID.bizF);
      const res = await patchSettings(id, ID.bizF, {
        defaultTaxRate: 25, accountingBasis: 'ACCRUAL', fiscalYearStartMonth: 7, defaultCashAccountId: null, accountantEmail: `${P}books@example.test`,
      });
      expect(await businessRowText(ID.bizF), `${label}: patch ${res.status}: the Business row is byte-identical`).toBe(before);
      expectRefusal(res, `${label}: defaultTaxRate with open settings`);
    }
  });

  it("[D11F-F04] RED-BEFORE (review SEC-T1): the owner check is bound to the route's business: a STAFF member of bizF who owns another business (OWNER membership and Business.ownerId of bizO) is refused on bizF (403), also when the x-business-id header, ?businessId= and the body's businessId all name bizO; both Business rows byte-identical; on bizO itself the same change is the owner's (200)", async () => {
    for (const [variant, send] of [
      ['route only', () => patchSettings(ID.staffOwner, ID.bizF, { defaultTaxRate: 42 })],
      ['header, query and body name bizO', () => patchSettingsNaming(ID.staffOwner, ID.bizF, ID.bizO, { defaultTaxRate: 42 })],
    ] as const) {
      await reset(ID.bizF);
      await reset(ID.bizO);
      const beforeF = await businessRowText(ID.bizF);
      const beforeO = await businessRowText(ID.bizO);
      const res = await send();
      expect(await businessRowText(ID.bizF), `${variant}: patch ${res.status}: bizF byte-identical`).toBe(beforeF);
      expect(await businessRowText(ID.bizO), `${variant}: patch ${res.status}: bizO byte-identical`).toBe(beforeO);
      expectRefusal(res, `staff owner of bizO on bizF, ${variant}`);
    }
    // The fixture really makes them an owner: on their own business the change is admitted.
    await reset(ID.bizO);
    const own = await patchSettings(ID.staffOwner, ID.bizO, { defaultTaxRate: 42 });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect((await finance(ID.bizO))?.defaultTaxRate).toBe(42);
    expect((await finance(ID.bizF))?.defaultTaxRate).toBe(SEEDED.defaultTaxRate);
    await reset(ID.bizO);
  });

  it("[D11F-F05] today's rule kept: a STAFF member (settings:none) and an ADMIN granted settings:write change accountingBasis, fiscalYearStartMonth, defaultCashAccountId and accountantEmail, which are not owner-only (200): those columns change and defaultTaxRate stays the owner's", async () => {
    for (const { id, label } of NON_OWNERS.slice(0, 2)) {
      await reset(ID.bizF);
      const res = await patchSettings(id, ID.bizF, {
        accountingBasis: 'ACCRUAL', fiscalYearStartMonth: 4, defaultCashAccountId: null, accountantEmail: `${P}books@example.test`,
      });
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body).toMatchObject({ accountingBasis: 'ACCRUAL', fiscalYearStartMonth: 4, defaultTaxRate: SEEDED.defaultTaxRate });
      expect(await finance(ID.bizF), label).toEqual({
        defaultTaxRate: SEEDED.defaultTaxRate, accountingBasis: 'ACCRUAL', fiscalYearStartMonth: 4,
        defaultCashAccountId: null, accountantEmail: `${P}books@example.test`,
      });
    }
  });

  it("[D11F-F06] today's rule kept: the web settings page's whole-form save — every field GET returned, defaultTaxRate unchanged — by a STAFF member or an ADMIN granted settings:write goes through (200): the open settings change and the effective rate is the one GET returned, also when the stored rate is NULL (GET answers 0)", async () => {
    for (const { id, label } of NON_OWNERS.slice(0, 2)) {
      for (const stored of [SEEDED.defaultTaxRate, null] as const) {
        // No default account: the seeded id is not a FinancialAccount, and the
        // whole-form save resubmits every default account id GET returned.
        await reset(ID.bizF, stored, null);
        const read = await getSettings(id, ID.bizF);
        expect(read.status, JSON.stringify(read.body)).toBe(200);
        expect(read.body.defaultTaxRate).toBe(stored ?? 0);
        const res = await patchSettings(id, ID.bizF, { ...read.body, accountingBasis: 'ACCRUAL', fiscalYearStartMonth: 10 });
        expect(res.status, `${label}, stored ${stored}: ${JSON.stringify(res.body)}`).toBe(200);
        expect(res.body, `${label}, stored ${stored}`).toMatchObject({ accountingBasis: 'ACCRUAL', fiscalYearStartMonth: 10, defaultTaxRate: stored ?? 0 });
        expect(await finance(ID.bizF), `${label}, stored ${stored}`).toMatchObject({ accountingBasis: 'ACCRUAL', fiscalYearStartMonth: 10 });
      }
    }
  });

  it('[D11F-F11] RED-BEFORE: a non-owner never writes Business.defaultTaxRate: the unchanged rate a STAFF member or an ADMIN granted settings:write resubmits is not written, so a stored NULL stays NULL (the unmodified code wrote 0 over it)', async () => {
    for (const { id, label } of NON_OWNERS.slice(0, 2)) {
      for (const stored of [SEEDED.defaultTaxRate, null] as const) {
        await reset(ID.bizF, stored, null);
        const res = await patchSettings(id, ID.bizF, { defaultTaxRate: stored ?? 0, accountingBasis: 'ACCRUAL' });
        expect(res.status, `${label}, stored ${stored}: ${JSON.stringify(res.body)}`).toBe(200);
        const row = await finance(ID.bizF);
        expect(row?.accountingBasis, `${label}, stored ${stored}: the open setting is written`).toBe('ACCRUAL');
        expect(row?.defaultTaxRate, `${label}, stored ${stored}: the rate is not written`).toBe(stored);
      }
    }
  });

  it('[D11F-F07] positive control: the founding OWNER (OWNER membership and Business.ownerId) changes defaultTaxRate with the other settings (200): the row and GET reflect it', async () => {
    await reset(ID.bizF);
    const res = await patchSettings(ID.owner, ID.bizF, { defaultTaxRate: 15, accountingBasis: 'ACCRUAL' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ defaultTaxRate: 15, accountingBasis: 'ACCRUAL' });
    expect(await finance(ID.bizF)).toMatchObject({ defaultTaxRate: 15, accountingBasis: 'ACCRUAL' });
  });

  it("[D11F-F08] positive control: a second OWNER membership that is not Business.ownerId (the membership arm alone) changes defaultTaxRate (200); the distinguished owner (Business.ownerId, no membership) is refused (owner ruling D-104: 403 'No access to this business'), the row byte-identical", async () => {
    await reset(ID.bizF);
    const res = await patchSettings(ID.coOwner, ID.bizF, { defaultTaxRate: 8.75 });
    expect(res.status, `${ID.coOwner}: ${JSON.stringify(res.body)}`).toBe(200);
    expect((await finance(ID.bizF))?.defaultTaxRate, ID.coOwner).toBe(8.75);

    await reset(ID.bizL);
    const before = await businessRowText(ID.bizL);
    const refused = await patchSettings(ID.legacyOwner, ID.bizL, { defaultTaxRate: 5 });
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect(refused.body).toMatchObject({ code: 'FORBIDDEN', message: 'No access to this business' });
    expect(await businessRowText(ID.bizL), 'the row is byte-identical').toBe(before);
  });

  it('[D11F-F09] pinned: a SUPER_ADMIN that holds a STAFF membership (so ensureAccess admits it) keeps the platform bypass and changes defaultTaxRate (200)', async () => {
    await reset(ID.bizF);
    const res = await patchSettings(ID.superStaff, ID.bizF, { defaultTaxRate: 3 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await finance(ID.bizF))?.defaultTaxRate).toBe(3);
  });

  it("[D11F-F10] pinned, not widened: a SUPER_ADMIN with no membership is refused by the route's ensureAccess (403 FORBIDDEN, 'No access to this business') before the owner check, for a defaultTaxRate change and for an open setting alike; the row byte-identical", async () => {
    for (const body of [{ defaultTaxRate: 1 }, { accountingBasis: 'ACCRUAL' }]) {
      await reset(ID.bizF);
      const before = await businessRowText(ID.bizF);
      const res = await patchSettings(ID.superAdmin, ID.bizF, body);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN', message: 'No access to this business' });
      expect(await businessRowText(ID.bizF)).toBe(before);
    }
  });
});
