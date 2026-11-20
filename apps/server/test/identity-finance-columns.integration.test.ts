/**
 * FU-IDENTITY-FINANCE-COLUMNS (V1-71; review SEC-V71-2 of FU-FINANCE-SETTINGS-SCOPE, added to the plan by owner ruling
 * D-221; the rule is owner ruling D-205's, applied to reads): the business reads stop handing the finance settings to a
 * member who may not read them. REAL database, through the HTTP routes.
 *
 * THE GAP: GET /finance/businesses/:id/settings needs revenue read (ModuleScopeGuard, FU-FINANCE-SETTINGS-SCOPE), but
 * GET /identity/businesses and GET /identity/businesses/:businessId answered the same Business columns to every member
 * (sanitizeBusiness strips the OAuth tokens and masks the metaData secrets, nothing else): Business.accountantEmail,
 * where every accountant export without a `to` goes, and the four default ledger account ids (cash, AR, AP, tax). So a
 * STAFF member with { bookings: read, crm: read } and no revenue read, refused GET settings, read the saved recipient and
 * the default accounts from the identity read, and the settings gate confined nothing. POST /identity/bootstrap, the
 * web's sign-in call, answers a Business read too, and it can answer a business the caller is only a member of (the
 * oldest membership of a Business.ownerId holder who holds no membership on the business they are recorded as owning,
 * D-104), so it was a third door.
 *
 * THE RULE: those reads answer accountantEmail, defaultCashAccountId, defaultArAccountId, defaultApAccountId and
 * defaultTaxAccountId only to a reader holding revenue read on that business, read exactly as ModuleScopeGuard reads it
 * for GET settings (the membership's explicit permissionScopes map, a JSON array included, where a missing key is none,
 * else the role's defaults; a platform SUPER_ADMIN passes), so for every member the identity reads answer those columns
 * exactly when GET settings answers them. Every other field stays for every member: the fields the screens a member
 * without revenue read opens need (currency, the default tax rate the invoice form and the business settings page read,
 * the timezone, the name, the masked metaData, the v1 settings), and nothing else changes. The list answers each
 * business by the caller's membership in that business. The owner-only profile PATCH (D-11) and the in-process server
 * readers are unchanged.
 *
 * HOW THE APP IS COMPOSED (the payment-secrets-write-only and finance-settings-patch models): a real Nest app with the
 * real IdentityController and IdentityService, the real FinanceController and FinanceSettingsService (GET settings, the
 * gate the identity reads must agree with), PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard and the production
 * GlobalHttpExceptionFilter, against DATABASE_URL. Identity attachment is the one stand-in on the authorization path
 * (`x-test-user` -> the seeded User row, as AuthMiddleware attaches it). Collaborators these routes never reach are
 * empty stand-ins (BlueprintService a no-op). No provider is called: nothing on these paths reaches one.
 *
 * FIXTURES: every id has the `v71f_` prefix (test/helpers/fixture-prefixes.json, packet 'V1-71
 * (FU-IDENTITY-FINANCE-COLUMNS)'); every unique column written (User.email, User.referralCode, ChartOfAccount code)
 * contains it; every row is hard-deleted with LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll. No $transaction
 * wrapping.
 *
 *   V71F-X01  fixture sanity
 *   V71F-A01  RED-BEFORE  a STAFF member with { bookings: read, crm: read } (no revenue read) reads GET
 *                         /identity/businesses/:id without accountantEmail or a default account id, and neither value
 *                         appears anywhere in the body
 *   V71F-A02  RED-BEFORE  so does every other member without revenue read: STAFF and ADMIN maps with revenue none, a
 *                         stored JSON array of scopes (every module none)
 *   V71F-A03  RED-BEFORE  the answer keeps every other field the owner reads: its keys are the owner's minus exactly those
 *                         five, and currency, the default tax rate, the basis, the fiscal year, the timezone and the
 *                         name read as stored
 *   V71F-A04  control     the owner, STAFF on role defaults (revenue read), a revenue:read STAFF member, an ADMIN on role
 *                         defaults and a SUPER_ADMIN holding a STAFF membership without revenue read all read the five
 *                         columns as stored
 *   V71F-B01  RED-BEFORE  GET /identity/businesses answers each business by the caller's membership in it: a member
 *                         without revenue read in bizA and OWNER of bizB reads bizA without the five and bizB with them
 *   V71F-B02  RED-BEFORE  every member kind reads the list entry for bizA as GET /identity/businesses/:id answers it
 *   V71F-C01  RED-BEFORE  the projection is GET settings' gate: for every member kind, the identity reads answer the five
 *                         columns exactly when GET /finance/businesses/:id/settings answers 200, and then with the same
 *                         values
 *   V71F-D01  RED-BEFORE  POST /identity/bootstrap answering a business the caller is a member of without revenue read
 *                         (a Business.ownerId holder with no membership on that business, STAFF on bizA) answers it
 *                         without the five; the owner's bootstrap still answers them
 *   V71F-D02  RED-BEFORE  (review SEC-IFC-1) the bootstrap's revenue-read check is the caller's own membership of the
 *                         business it answers, whatever ambient tenant context the request carries: inside a tenant
 *                         context for bizA, the OWNER of bizB bootstrapping is answered bizB with the five (RED: the
 *                         membership read was narrowed to bizA, so the five were withheld from the business's owner);
 *                         the stranded caller is still withheld under the same context (control: fails closed only)
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71f_';

const ID = {
  owner: `${P}owner`,             // OWNER membership + Business.ownerId of bizA
  staffBC: `${P}staffBC`,         // STAFF, explicit { bookings: read, crm: read } (the packet's actor: no revenue read)
  staffRevNone: `${P}staffRevNone`, // STAFF, role defaults with revenue: none
  adminRevNone: `${P}adminRevNone`, // ADMIN, role defaults with revenue: none (settings admin, no revenue read)
  arrayScopes: `${P}arrayScopes`, // STAFF, permissionScopes stored as a JSON array (every module none)
  staffDefault: `${P}staffDef`,   // STAFF, role defaults (revenue read)
  staffRead: `${P}staffRead`,     // STAFF, explicit { revenue: read }
  adminDefault: `${P}adminDef`,   // ADMIN, role defaults (revenue admin)
  superStaff: `${P}superStaff`,   // User.role SUPER_ADMIN holding a STAFF { bookings: read } membership
  mixed: `${P}mixed`,             // STAFF { bookings: read } of bizA, OWNER (and Business.ownerId) of bizB
  stranded: `${P}stranded`,       // Business.ownerId of bizS with no membership on it; STAFF { bookings: read } of bizA
  bizA: `${P}bizA`,               // the business under test: every finance column set
  bizB: `${P}bizB`,               // mixed's own business: its finance columns set too
  bizS: `${P}bizS`,               // stranded's recorded business (no membership: bootstrap answers bizA instead)
  coaA: `${P}coaA`,
  coaB: `${P}coaB`,
};
const USERS = [
  ID.owner, ID.staffBC, ID.staffRevNone, ID.adminRevNone, ID.arrayScopes, ID.staffDefault, ID.staffRead,
  ID.adminDefault, ID.superStaff, ID.mixed, ID.stranded,
];
const emailOf = (id: string) => `${id}@v71f.test.local`;

/** The five columns a reader without revenue read is not answered. */
const FINANCE_PRIVATE = [
  'accountantEmail', 'defaultCashAccountId', 'defaultArAccountId', 'defaultApAccountId', 'defaultTaxAccountId',
] as const;

/** Each business's stored finance columns (accounts exist in its chart; the address is the books' recipient). */
const FINANCE: Record<string, Record<(typeof FINANCE_PRIVATE)[number], string>> = {
  [ID.bizA]: {
    accountantEmail: `books@${P}accountant-a.test.local`,
    defaultCashAccountId: `${P}acctA_cash`,
    defaultArAccountId: `${P}acctA_ar`,
    defaultApAccountId: `${P}acctA_ap`,
    defaultTaxAccountId: `${P}acctA_tax`,
  },
  [ID.bizB]: {
    accountantEmail: `books@${P}accountant-b.test.local`,
    defaultCashAccountId: `${P}acctB_cash`,
    defaultArAccountId: `${P}acctB_ar`,
    defaultApAccountId: `${P}acctB_ap`,
    defaultTaxAccountId: `${P}acctB_tax`,
  },
};
/** Fields every member keeps, as stored on bizA. */
const BIZ_A_PUBLIC = {
  name: `${P}bizA-name`,
  currency: 'TTD',
  defaultTaxRate: 12.5,
  accountingBasis: 'ACCRUAL',
  fiscalYearStartMonth: 4,
  timezone: 'America/Port_of_Spain',
};

/** Who holds revenue read on bizA, by ModuleScopeGuard's rule (and so who GET settings answers). */
const REVENUE_READERS_A = new Set([ID.owner, ID.staffDefault, ID.staffRead, ID.adminDefault, ID.superStaff]);
const NO_REVENUE_A = [ID.staffBC, ID.staffRevNone, ID.adminRevNone, ID.arrayScopes, ID.mixed, ID.stranded];
const MEMBERS_A = [...REVENUE_READERS_A, ...NO_REVENUE_A];

let db: any;
let app: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM user_identities WHERE user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort: cascades cover most of these */ }
  }
}

const http = () => request(app.getHttpServer());
const getBusiness = (actor: string, businessId: string) => http().get(`/identity/businesses/${businessId}`).set('x-test-user', actor);
const listBusinesses = (actor: string) => http().get('/identity/businesses').set('x-test-user', actor);
const getSettings = (actor: string, businessId: string) =>
  http().get(`/finance/businesses/${businessId}/settings`).set('x-test-user', actor);
const bootstrap = (actor: string) => http().post('/identity/bootstrap').set('x-test-user', actor).send({});

/** Every stored finance value of a business that appears anywhere in a body. */
function leakedValues(body: unknown, businessId: string): string[] {
  const text = JSON.stringify(body ?? null);
  return Object.values(FINANCE[businessId]).filter((v) => text.includes(v));
}

/** A business read answered to a member without revenue read: none of the five keys, none of their values. */
function expectWithheld(business: any, businessId: string, label: string) {
  expect(business?.id, `${label}: the business is answered`).toBe(businessId);
  for (const key of FINANCE_PRIVATE) expect(business, `${label}: no ${key}`).not.toHaveProperty(key);
  expect(leakedValues(business, businessId), `${label}: a stored finance value in the body`).toEqual([]);
}

/** A business read answered to a revenue reader: the five columns as stored. */
function expectAnswered(business: any, businessId: string, label: string) {
  expect(business?.id, `${label}: the business is answered`).toBe(businessId);
  for (const key of FINANCE_PRIVATE) expect(business?.[key], `${label}: ${key}`).toBe(FINANCE[businessId][key]);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { OptionalAuthGuard } = await import('../src/core/auth/optional-auth.guard');
  const { SupabaseAdminService } = await import('../src/core/auth/supabase-admin.service');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { IdentityController } = await import('../src/modules/identity/identity.controller');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const { IdentitySignupService } = await import('../src/modules/identity/identity-signup.service');
  const { BusinessContextService } = await import('../src/modules/identity/business-context.service');
  const { AuthSecurityService } = await import('../src/modules/identity/auth-security.service');
  const { IdentityPasswordService } = await import('../src/modules/identity/identity-password.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { DefaultTriggersService } = await import('../src/modules/ai/default-triggers.service');
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { FinanceSettingsService } = await import('../src/modules/finance/finance-settings.service');
  const { AccountantExportEmailService } = await import('../src/modules/finance/accountant-export-email.service');
  const { AccountantExportService } = await import('../src/modules/finance/accountant-export.service');
  const { SystemEmailService } = await import('../src/modules/notifications/system-email.service');

  // FinanceController's other collaborators: never reached by GET settings.
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
    import('../src/modules/finance/finance-intelligence.service').then((m) => m.FinanceIntelligenceService),
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
    controllers: [IdentityController, FinanceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      OptionalAuthGuard,
      IdentityService,
      FinanceSettingsService,
      // Not on the business GET, list, bootstrap or GET settings path.
      { provide: BlueprintService, useValue: { inferFromOnboarding: async () => null } },
      { provide: DefaultTriggersService, useValue: {} },
      { provide: IdentitySignupService, useValue: {} },
      { provide: BusinessContextService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      { provide: AuthSecurityService, useValue: {} },
      { provide: IdentityPasswordService, useValue: {} },
      { provide: SupabaseAdminService, useValue: {} },
      { provide: REDIS_CLIENT, useValue: {} },
      { provide: AccountantExportEmailService, useValue: {} },
      { provide: AccountantExportService, useValue: {} },
      { provide: SystemEmailService, useValue: {} },
      ...unused.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  // Identity attachment only, as AuthMiddleware attaches it from the User row. No guard is overridden.
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
      data: {
        id, email: emailOf(id), name: id, role: id === ID.superStaff ? 'SUPER_ADMIN' : 'USER',
        // Prefixed, so bootstrap generates no unprefixed unique value.
        referralCode: `${id}_ref`,
      },
    });
  }
  // Creation order fixes "oldest" for bootstrap: bizS (stranded's own) first, then bizA, then bizB.
  await db.business.create({ data: { id: ID.bizS, name: `${ID.bizS}-name`, ownerId: ID.stranded, currency: 'TTD' } });
  await db.business.create({
    data: {
      id: ID.bizA, ownerId: ID.owner, ...BIZ_A_PUBLIC,
      metaData: { bankName: `${P}Republic`, sells: 'both' },
    },
  });
  await db.business.create({ data: { id: ID.bizB, name: `${ID.bizB}-name`, ownerId: ID.mixed, currency: 'USD' } });
  for (const [biz, coa] of [[ID.bizA, ID.coaA], [ID.bizB, ID.coaB]] as const) {
    await db.chartOfAccount.create({ data: { id: coa, businessId: biz, name: `${P}Bank`, type: 'ASSET', code: `${coa}_1010` } });
    for (const key of FINANCE_PRIVATE.filter((k) => k !== 'accountantEmail')) {
      const acct = FINANCE[biz][key];
      await db.financialAccount.create({ data: { id: acct, businessId: biz, chartOfAccountId: coa, name: acct, type: 'BANK', currency: 'TTD' } });
    }
    await db.business.update({ where: { id: biz }, data: { ...FINANCE[biz] } });
  }

  const { ROLE_DEFAULT_SCOPES } = await import('../src/core/authority/module-vocabulary');
  const memberships: Array<{ userId: string; businessId: string; role: string; permissionScopes?: unknown }> = [
    { userId: ID.owner, businessId: ID.bizA, role: 'OWNER' },
    { userId: ID.staffBC, businessId: ID.bizA, role: 'STAFF', permissionScopes: { bookings: 'read', crm: 'read' } },
    { userId: ID.staffRevNone, businessId: ID.bizA, role: 'STAFF', permissionScopes: { ...ROLE_DEFAULT_SCOPES.STAFF, revenue: 'none' } },
    { userId: ID.adminRevNone, businessId: ID.bizA, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, revenue: 'none' } },
    { userId: ID.arrayScopes, businessId: ID.bizA, role: 'STAFF', permissionScopes: [] },
    { userId: ID.staffDefault, businessId: ID.bizA, role: 'STAFF' },
    { userId: ID.staffRead, businessId: ID.bizA, role: 'STAFF', permissionScopes: { revenue: 'read' } },
    { userId: ID.adminDefault, businessId: ID.bizA, role: 'ADMIN' },
    { userId: ID.superStaff, businessId: ID.bizA, role: 'STAFF', permissionScopes: { bookings: 'read' } },
    { userId: ID.mixed, businessId: ID.bizA, role: 'STAFF', permissionScopes: { bookings: 'read' } },
    { userId: ID.mixed, businessId: ID.bizB, role: 'OWNER' },
    { userId: ID.stranded, businessId: ID.bizA, role: 'STAFF', permissionScopes: { bookings: 'read' } },
  ];
  for (const m of memberships) {
    await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}_${m.businessId.slice(P.length)}`, ...m } as any });
  }
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('FU-IDENTITY-FINANCE-COLUMNS: the business reads answer the finance settings only to a revenue reader', () => {
  it('V71F-X01 fixture sanity: bizA stores every finance column; the members hold the scopes named', async () => {
    const row = await db.business.findUnique({ where: { id: ID.bizA } });
    for (const key of FINANCE_PRIVATE) expect(row?.[key], key).toBe(FINANCE[ID.bizA][key]);
    expect(row?.defaultTaxRate).toBe(BIZ_A_PUBLIC.defaultTaxRate);
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(MEMBERS_A.length);
    expect(await db.membership.count({ where: { userId: ID.stranded, businessId: ID.bizS } })).toBe(0);
    const stored = await db.membership.findUnique({ where: { userId_businessId: { userId: ID.arrayScopes, businessId: ID.bizA } } });
    expect(Array.isArray(stored?.permissionScopes), 'a JSON array is stored').toBe(true);
    // The packet's actor is refused GET settings (the gate FU-FINANCE-SETTINGS-SCOPE set) at this head and after.
    const refused = await getSettings(ID.staffBC, ID.bizA);
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
  });

  it('V71F-A01 RED-BEFORE: a STAFF member with bookings and crm read and no revenue read reads GET /identity/businesses/:id without accountantEmail or a default account id', async () => {
    const res = await getBusiness(ID.staffBC, ID.bizA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expectWithheld(res.body, ID.bizA, 'STAFF { bookings: read, crm: read }');
  });

  it('V71F-A02 RED-BEFORE: every other member without revenue read is answered the same (revenue none in a STAFF or ADMIN map, a stored array of scopes)', async () => {
    for (const actor of [ID.staffRevNone, ID.adminRevNone, ID.arrayScopes, ID.mixed, ID.stranded]) {
      const res = await getBusiness(actor, ID.bizA);
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(200);
      expectWithheld(res.body, ID.bizA, actor);
    }
  });

  it('V71F-A03 RED-BEFORE: the answer keeps every other field the owner reads (the owner\'s keys minus exactly the five), currency and the tax rate included', async () => {
    const ownerRes = await getBusiness(ID.owner, ID.bizA);
    expect(ownerRes.status).toBe(200);
    const expectedKeys = Object.keys(ownerRes.body).filter((k) => !(FINANCE_PRIVATE as readonly string[]).includes(k)).sort();
    for (const actor of NO_REVENUE_A) {
      const res = await getBusiness(actor, ID.bizA);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort(), `${actor}: the owner's fields minus the five`).toEqual(expectedKeys);
      for (const [key, value] of Object.entries(BIZ_A_PUBLIC)) expect(res.body[key], `${actor}: ${key}`).toEqual(value);
      expect(res.body.metaData, `${actor}: metaData as the owner reads it`).toEqual(ownerRes.body.metaData);
      expect(res.body.sells, `${actor}: the v1 settings`).toBe(ownerRes.body.sells);
      expect(res.body.depth, `${actor}: the v1 settings`).toEqual(ownerRes.body.depth);
    }
  });

  it('V71F-A04 control: the owner, STAFF on role defaults, a revenue:read STAFF member, an ADMIN on role defaults and a SUPER_ADMIN read the five columns as stored', async () => {
    for (const actor of REVENUE_READERS_A) {
      const res = await getBusiness(actor, ID.bizA);
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(200);
      expectAnswered(res.body, ID.bizA, actor);
      for (const [key, value] of Object.entries(BIZ_A_PUBLIC)) expect(res.body[key], `${actor}: ${key}`).toEqual(value);
    }
  });

  it('V71F-B01 RED-BEFORE: GET /identity/businesses answers each business by the caller\'s membership in it (bizA withheld, bizB answered, for the same caller)', async () => {
    const res = await listBusinesses(ID.mixed);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const byId = new Map<string, any>((res.body as any[]).map((b) => [b.id, b]));
    expect([...byId.keys()].sort()).toEqual([ID.bizA, ID.bizB].sort());
    expectWithheld(byId.get(ID.bizA), ID.bizA, 'mixed, bizA (STAFF bookings read)');
    expectAnswered(byId.get(ID.bizB), ID.bizB, 'mixed, bizB (OWNER)');
    expect(byId.get(ID.bizA)?.currency).toBe('TTD');
    expect(byId.get(ID.bizA)?.defaultTaxRate).toBe(BIZ_A_PUBLIC.defaultTaxRate);
  });

  it('V71F-B02 RED-BEFORE: every member kind reads its list entry for bizA as GET /identity/businesses/:id answers it', async () => {
    for (const actor of MEMBERS_A) {
      const res = await listBusinesses(actor);
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(200);
      const entry = (res.body as any[]).find((b) => b.id === ID.bizA);
      if (REVENUE_READERS_A.has(actor)) expectAnswered(entry, ID.bizA, `${actor} (list)`);
      else expectWithheld(entry, ID.bizA, `${actor} (list)`);
      expect(entry, `${actor}: no membership rows in the answer`).not.toHaveProperty('members');
    }
  });

  it('V71F-C01 RED-BEFORE: the identity reads answer the five columns exactly when GET settings answers them, with the same values', async () => {
    for (const actor of MEMBERS_A) {
      const settings = await getSettings(actor, ID.bizA);
      const one = await getBusiness(actor, ID.bizA);
      const list = await listBusinesses(actor);
      const entry = (list.body as any[]).find((b) => b.id === ID.bizA);
      expect([200, 403], `${actor}: GET settings ${JSON.stringify(settings.body)}`).toContain(settings.status);
      const mayRead = settings.status === 200;
      expect(mayRead, `${actor}: GET settings answers exactly the revenue readers`).toBe(REVENUE_READERS_A.has(actor));
      for (const [label, business] of [['GET :id', one.body], ['list', entry]] as const) {
        for (const key of FINANCE_PRIVATE) {
          if (mayRead) expect(business?.[key], `${actor} ${label}: ${key} as GET settings answers it`).toBe(settings.body[key]);
          else expect(business, `${actor} ${label}: no ${key} where GET settings refuses`).not.toHaveProperty(key);
        }
      }
    }
  });

  it('V71F-D01 RED-BEFORE: POST /identity/bootstrap answering a business the caller holds no revenue read on withholds the five; the owner\'s bootstrap answers them', async () => {
    const stranded = await bootstrap(ID.stranded);
    expect(stranded.status, JSON.stringify(stranded.body)).toBe(201);
    expect(stranded.body.isNewBusiness).toBe(false);
    expectWithheld(stranded.body.business, ID.bizA, 'stranded owner, STAFF of bizA (bootstrap)');
    expect(stranded.body.business?.currency).toBe('TTD');
    expect(stranded.body.business?.defaultTaxRate).toBe(BIZ_A_PUBLIC.defaultTaxRate);

    const owner = await bootstrap(ID.owner);
    expect(owner.status, JSON.stringify(owner.body)).toBe(201);
    expect(owner.body.isNewBusiness).toBe(false);
    expectAnswered(owner.body.business, ID.bizA, 'owner (bootstrap)');
  });

  it('V71F-D02 RED-BEFORE (review SEC-IFC-1): the bootstrap reads the caller\'s own membership of the business it answers whatever tenant context the request carries: inside a tenant context for bizA, the OWNER of bizB is answered bizB with the five; the stranded caller is still withheld', async () => {
    // POST /identity/bootstrap has no business in its path, so TenantInterceptor's context is whatever
    // `?businessId=` or body businessId the caller belongs to (the test app registers no interceptor: the
    // context is set here as the interceptor would). mixed is STAFF { bookings: read } of bizA and OWNER of
    // bizB; bootstrap answers bizB (the oldest membership is bizA's, but Business.ownerId names bizB: the
    // route's own rule, V71F-D01 covers it). The revenue-read check must read mixed's membership of bizB,
    // not a membership of bizB narrowed to the ambient tenant bizA (which finds nothing and withholds).
    const { runWithTenant, getCurrentBusinessId } = await import('../src/core/tenant/tenant-context');
    const { setTenantContextProvider } = await import('@keyflow/db');
    const { IdentityService } = await import('../src/modules/identity/identity.service');
    // As main.ts wires it: every Prisma read of a business-scoped model is narrowed to the ambient tenant.
    setTenantContextProvider({ getCurrentBusinessId });
    const identity = app.get(IdentityService);

    const mixed = await runWithTenant(ID.bizA, ID.mixed, () =>
      identity.bootstrapUser({ userId: ID.mixed, email: emailOf(ID.mixed) }),
    );
    expect(mixed.isNewBusiness).toBe(false);
    expect(mixed.business?.id).toBe(ID.bizB);
    expectAnswered(mixed.business, ID.bizB, 'mixed, OWNER of bizB, bootstrap under tenant context bizA');

    // Without a context the answer is the same (the route as the web calls it: no businessId).
    const plain = await identity.bootstrapUser({ userId: ID.mixed, email: emailOf(ID.mixed) });
    expect(plain.business?.id).toBe(ID.bizB);
    expectAnswered(plain.business, ID.bizB, 'mixed, OWNER of bizB, bootstrap with no tenant context');

    // Control: the check never opens. stranded (STAFF { bookings: read } of bizA) under bizA's context is
    // answered bizA without the five, as V71F-D01 proves without a context; and under bizB's context too.
    for (const ctx of [ID.bizA, ID.bizB]) {
      const stranded = await runWithTenant(ctx, ID.stranded, () =>
        identity.bootstrapUser({ userId: ID.stranded, email: emailOf(ID.stranded) }),
      );
      expect(stranded.isNewBusiness).toBe(false);
      expectWithheld(stranded.business, ID.bizA, `stranded, bootstrap under tenant context ${ctx}`);
    }
  });
});
