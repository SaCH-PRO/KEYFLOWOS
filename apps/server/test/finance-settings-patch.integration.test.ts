/**
 * FU-FINANCE-SETTINGS-PATCH (V1-71; owner ruling D-205, 2026-11-16): who may change which finance setting through
 * PATCH /finance/businesses/:id/settings, and what GET settings tells the caller in advance. REAL database, through the
 * HTTP routes.
 *
 * THE GAP (review SEC-V71-1 / FSS-CR-1 of FU-FINANCE-SETTINGS-SCOPE, reproduced on Postgres): saving the accountant
 * export's recipient from the accountant box (POST .../accountant-export/email saveRecipient) needs settings admin and
 * revenue read (assertMaySetExportDestination, the WH3-1 binding rule), but PATCH settings wrote the same column,
 * Business.accountantEmail, under revenue read alone: a STAFF member on role defaults (revenue read, settings none) set
 * it to their own address (200), and the owner's next send without a `to` went there.
 *
 * THE RULE (D-205: "The accountant export address needs settings admin plus money read; the accounting basis, fiscal
 * year and default accounts need money write; the tax rate stays owner-only"), by field, after the route's revenue read
 * (ModuleScopeGuard) and the D-11 tax rate check (assertTaxRateOwner), both unchanged:
 *   - a change of accountantEmail (a new address, or clearing it) needs settings admin and revenue read: the same
 *     assertMaySetExportDestination(..., ACCOUNTANT_EMAIL_EXPORT_TYPE) check saveRecipient runs, the same 403 words;
 *   - a change of accountingBasis, fiscalYearStartMonth or a default account id (cash, AR, AP, tax) needs revenue write:
 *     403 "Insufficient permissions: revenue requires write access (you have <level>)", ModuleScopeGuard's words;
 *   - a refusal names the refused fields (`fields`) and writes nothing of the submission (the row byte-identical);
 *   - a submitted value equal to the one GET answers is not a change (the settings page saves the whole form, as
 *     assertTaxRateOwner already reads the rate): a member who may not change that field does not write it, so a stored
 *     NULL stays NULL and a submission with nothing they may change writes nothing at all.
 * GET settings (and PATCH's answer) carry the caller's capability hints, computed by the same checks the writes run:
 *   mayChangeAccountantEmail (assertMaySetExportDestination passes), mayChangeBooksSettings (revenue write),
 *   mayChangeTaxRate (the D-11 owner test), so the accountant box knows before a send whether "Remember" will be
 *   allowed, and the settings page which fields to offer.
 *
 * HOW THE APP IS COMPOSED (the finance-settings-scope model): a real Nest app with the real FinanceController,
 * FinanceSettingsService, AccountantExportEmailService, PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard and the
 * production GlobalHttpExceptionFilter, against DATABASE_URL. Identity attachment is the one stand-in on the
 * authorization path (`x-test-user` -> the seeded User row, as AuthMiddleware attaches it). The accountant export's ZIP
 * builder is a spy returning a fixed package and the platform mailer is a tap that records every send and sends nothing
 * (no provider traffic). FinanceController's other collaborators are never reached by these routes and are empty
 * stand-ins.
 *
 * FIXTURES: every id has the `v71e_` prefix (test/helpers/fixture-prefixes.json, packet 'V1-71
 * (FU-FINANCE-SETTINGS-PATCH)'); every unique column written (User.email, FinancialAccount name per business) contains
 * it; every row is hard-deleted with LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll. No $transaction wrapping.
 *
 *   V71E-X01  fixture sanity
 *   V71E-A01  RED-BEFORE  STAFF on role defaults and a revenue:read-only member are refused PATCH accountantEmail (a new
 *                         address, or clearing it): 403 with the binding refusal, Business row byte-identical
 *   V71E-A02  RED-BEFORE  a revenue:write STAFF member and an ADMIN with settings write (not admin) are refused it too, and
 *                         so is the whole-form save that carries the new address
 *   V71E-A03  control     the owner, an ADMIN with settings admin + revenue read, an ADMIN on role defaults and a SUPER_ADMIN
 *                         member change it (200, written, GET reads it back); the ADMIN clears it too
 *   V71E-B01  RED-BEFORE  revenue readers (STAFF on defaults, revenue:read, an ADMIN with settings admin + revenue read) are
 *                         refused a change of each of the basis, the fiscal year and the four default account ids
 *   V71E-B02  control     a revenue:write STAFF member and an ADMIN with settings write change the basis, the fiscal year and
 *                         the four default accounts (200, written); the accountant address is not touched
 *   V71E-C01  RED-BEFORE  an unchanged value is not a change: the whole-form save of a member who may change nothing in it
 *                         is 200 and writes nothing (row byte-identical, a NULL fiscal year stays NULL); a member who may
 *                         change one field writes only that field
 *   V71E-D01  pinned      D-11 unchanged: a non-owner's defaultTaxRate change is 403 BUSINESS_PROFILE_OWNER_ONLY first, also
 *                         beside fields they may change and for members holding every scope; the owner changes it
 *   V71E-G01  RED-BEFORE  GET settings answers the caller's capability hints (mayChangeAccountantEmail,
 *                         mayChangeBooksSettings, mayChangeTaxRate) for every member kind
 *   V71E-G02  RED-BEFORE  each hint is the server's own rule: mayChangeAccountantEmail is what PATCH accountantEmail and the
 *                         accountant box's saveRecipient answer, mayChangeBooksSettings what PATCH accountingBasis answers,
 *                         mayChangeTaxRate what PATCH defaultTaxRate answers, for every member kind
 *   V71E-G03  RED-BEFORE  PATCH answers the same hints as GET (the settings page keeps them after a save); a refusal carries
 *                         no setting and no hint
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71e_';

const ID = {
  owner: `${P}owner`,             // OWNER membership + Business.ownerId
  staffDefault: `${P}staffDef`,   // STAFF, role defaults (revenue read, settings none)
  staffRead: `${P}staffRead`,     // STAFF, explicit { revenue: read } (revenue read only)
  staffWrite: `${P}staffWrite`,   // STAFF, explicit { revenue: write } (revenue write, settings none)
  adminSet: `${P}adminSet`,       // ADMIN, explicit { settings: admin, revenue: read }
  adminW: `${P}adminW`,           // ADMIN, ADMIN defaults with settings: write (revenue admin)
  adminDefault: `${P}adminDef`,   // ADMIN, role defaults (settings admin, revenue admin)
  superStaff: `${P}superStaff`,   // User.role SUPER_ADMIN holding a STAFF membership (ensureAccess admits it)
  biz: `${P}biz`,
  coa: `${P}coa_bank`,
  cash: `${P}acct_cash`,
  ar: `${P}acct_ar`,
  ap: `${P}acct_ap`,
  tax: `${P}acct_tax`,
};
const USERS = [ID.owner, ID.staffDefault, ID.staffRead, ID.staffWrite, ID.adminSet, ID.adminW, ID.adminDefault, ID.superStaff];
const ACCOUNTS = [ID.cash, ID.ar, ID.ap, ID.tax];
const emailOf = (id: string) => `${id}@v71e.test.local`;
/** The address a member redirects the books to: their own. */
const ownAddress = (id: string) => `${id}+books@v71e.test.local`;

const SEEDED = {
  accountantEmail: `seed@${P}accountant.test.local`,
  accountingBasis: 'CASH',
  fiscalYearStartMonth: 1,
  defaultTaxRate: 12.5,
};

/** What each member kind may change, by D-205 (and D-11 for the rate). */
const HINTS: Record<string, { mayChangeAccountantEmail: boolean; mayChangeBooksSettings: boolean; mayChangeTaxRate: boolean }> = {
  [ID.owner]: { mayChangeAccountantEmail: true, mayChangeBooksSettings: true, mayChangeTaxRate: true },
  [ID.staffDefault]: { mayChangeAccountantEmail: false, mayChangeBooksSettings: false, mayChangeTaxRate: false },
  [ID.staffRead]: { mayChangeAccountantEmail: false, mayChangeBooksSettings: false, mayChangeTaxRate: false },
  [ID.staffWrite]: { mayChangeAccountantEmail: false, mayChangeBooksSettings: true, mayChangeTaxRate: false },
  [ID.adminSet]: { mayChangeAccountantEmail: true, mayChangeBooksSettings: false, mayChangeTaxRate: false },
  [ID.adminW]: { mayChangeAccountantEmail: false, mayChangeBooksSettings: true, mayChangeTaxRate: false },
  [ID.adminDefault]: { mayChangeAccountantEmail: true, mayChangeBooksSettings: true, mayChangeTaxRate: false },
  [ID.superStaff]: { mayChangeAccountantEmail: true, mayChangeBooksSettings: true, mayChangeTaxRate: true },
};
const HINT_KEYS = ['mayChangeAccountantEmail', 'mayChangeBooksSettings', 'mayChangeTaxRate'] as const;

/** The binding refusal's words (core/connectors/connector-exports.ts, EXPORT_ACCOUNT_WORDS.accountant_email). */
const RECIPIENT_WHAT = "saving the accountant's email address, which receives the business's books (the accountant export),";
const recipientRefusal = (level: string) => `Insufficient permissions: ${RECIPIENT_WHAT} needs settings admin access (you have ${level})`;
const booksRefusal = (level: string) => `Insufficient permissions: revenue requires write access (you have ${level})`;
const PROFILE_CODE = 'BUSINESS_PROFILE_OWNER_ONLY';

let db: any;
let app: any;

/** The platform mailer, tapped: every send recorded, nothing sent anywhere. */
const mailer = {
  sent: [] as Array<{ to: string }>,
  isConfigured() { return true; },
  async sendTransactional(args: { to: string }) {
    this.sent.push(args);
    return { id: `${P}msg_${this.sent.length}` };
  },
};
/** The accountant export's ZIP builder: a spy (its package is not under test). */
const builder = {
  calls: [] as Array<{ businessId: string }>,
  async build(input: { businessId: string }) {
    this.calls.push(input);
    return { filename: `${P}export.zip`, buffer: Buffer.from('v71e-zip'), bytes: 8, generatedAt: '2026-11-16T00:00:00.000Z' };
  },
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort: cascades cover most of these */ }
  }
}

/** The Business row exactly as Postgres stores it, so "unchanged" means byte-identical (updated_at included). */
async function businessRowText(): Promise<string> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(b)::text AS j FROM businesses b WHERE b.id = $1', ID.biz);
  expect(rows.length, 'the business exists').toBe(1);
  return rows[0].j as string;
}

async function stored() {
  return db.business.findUnique({
    where: { id: ID.biz },
    select: {
      accountantEmail: true, accountingBasis: true, fiscalYearStartMonth: true, defaultTaxRate: true,
      defaultCashAccountId: true, defaultArAccountId: true, defaultApAccountId: true, defaultTaxAccountId: true,
    },
  });
}

/** Each case starts from the seeded settings (fiscal year as given: NULL reads as 1), no default accounts, an empty mailer and builder. Raw SQL. */
async function reset(fiscalYear: number | null = SEEDED.fiscalYearStartMonth) {
  await db.$executeRawUnsafe(
    `UPDATE businesses SET accountant_email = $2, accounting_basis = $3, fiscal_year_start_month = $4, default_tax_rate = $5,
       default_cash_account_id = NULL, default_ar_account_id = NULL, default_ap_account_id = NULL, default_tax_account_id = NULL,
       updated_at = TIMESTAMP '2026-01-01 00:00:00'
     WHERE id = $1`,
    ID.biz, SEEDED.accountantEmail, SEEDED.accountingBasis, fiscalYear, SEEDED.defaultTaxRate,
  );
  mailer.sent.length = 0;
  builder.calls.length = 0;
}

const getSettings = (actor: string) =>
  request(app.getHttpServer()).get(`/finance/businesses/${ID.biz}/settings`).set('x-test-user', actor);
const patchSettings = (actor: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).patch(`/finance/businesses/${ID.biz}/settings`).set('x-test-user', actor).send(body);
const sendExport = (actor: string, body: Record<string, unknown>) =>
  request(app.getHttpServer())
    .post(`/finance/businesses/${ID.biz}/accountant-export/email`)
    .set('x-test-user', actor)
    .send({ periodStart: '2026-01-01', periodEnd: '2026-12-31', ...body });

/**
 * A refused write: 403 with the expected message (and the refused fields, when named: the production filter answers an
 * exception's extra properties under `details`), no setting and no hint in the body.
 */
function expectRefused(res: { status: number; body: any }, label: string, message: string, fields?: string[]) {
  expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(403);
  expect(res.body?.message, label).toBe(message);
  if (fields) expect([...(res.body?.details?.fields ?? [])].sort(), `${label}: the refused fields`).toEqual([...fields].sort());
  for (const key of ['accountantEmail', 'accountingBasis', 'fiscalYearStartMonth', 'defaultTaxRate', 'currency', ...HINT_KEYS]) {
    expect(res.body, `${label}: no ${key} in a refusal`).not.toHaveProperty(key);
  }
  expect(JSON.stringify(res.body), `${label}: the saved address is not in a refusal`).not.toContain(SEEDED.accountantEmail);
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
  const { AccountantExportEmailService } = await import('../src/modules/finance/accountant-export-email.service');
  const { AccountantExportService } = await import('../src/modules/finance/accountant-export.service');
  const { SystemEmailService } = await import('../src/modules/notifications/system-email.service');

  // FinanceController's other collaborators: never reached by these routes.
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
    controllers: [FinanceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      FinanceSettingsService,
      AccountantExportEmailService,
      { provide: AccountantExportService, useValue: builder },
      { provide: SystemEmailService, useValue: mailer },
      ...unused.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  // Identity attachment only, as AuthMiddleware attaches it from the User row. No guard on these routes is overridden.
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
    await db.user.create({ data: { id, email: emailOf(id), name: id, role: id === ID.superStaff ? 'SUPER_ADMIN' : 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: `${ID.biz}-name`, ownerId: ID.owner, currency: 'TTD' } });
  await db.chartOfAccount.create({ data: { id: ID.coa, businessId: ID.biz, name: `${P}Bank`, type: 'ASSET', code: `${P}1010` } });
  for (const id of ACCOUNTS) {
    await db.financialAccount.create({ data: { id, businessId: ID.biz, chartOfAccountId: ID.coa, name: id, type: 'BANK', currency: 'TTD' } });
  }
  await reset();
  const { ROLE_DEFAULT_SCOPES } = await import('../src/core/authority/module-vocabulary');
  const memberships: Array<{ userId: string; role: string; permissionScopes?: Record<string, string> }> = [
    { userId: ID.owner, role: 'OWNER' },
    { userId: ID.staffDefault, role: 'STAFF' },
    { userId: ID.staffRead, role: 'STAFF', permissionScopes: { revenue: 'read' } },
    { userId: ID.staffWrite, role: 'STAFF', permissionScopes: { revenue: 'write' } },
    { userId: ID.adminSet, role: 'ADMIN', permissionScopes: { settings: 'admin', revenue: 'read' } },
    { userId: ID.adminW, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, settings: 'write' } },
    { userId: ID.adminDefault, role: 'ADMIN' },
    { userId: ID.superStaff, role: 'STAFF' },
  ];
  for (const m of memberships) {
    await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}`, businessId: ID.biz, ...m } });
  }
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

beforeEach(async () => {
  if (db) await reset();
});

describe('V71E fixture sanity (real rows)', () => {
  it('[V71E-X01] seeded one business, eight users and eight memberships, four default-account candidates on its own chart; STAFF on defaults holds no settings key; the business starts at the seeded settings with no default account', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(1);
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(8);
    expect(await db.membership.count({ where: { id: { startsWith: P } } })).toBe(8);
    expect(await db.financialAccount.count({ where: { businessId: ID.biz } })).toBe(4);
    const staff = await db.membership.findFirst({ where: { userId: ID.staffDefault }, select: { role: true, permissionScopes: true } });
    expect(staff).toEqual({ role: 'STAFF', permissionScopes: null });
    expect(await stored()).toEqual({
      accountantEmail: SEEDED.accountantEmail, accountingBasis: 'CASH', fiscalYearStartMonth: 1, defaultTaxRate: SEEDED.defaultTaxRate,
      defaultCashAccountId: null, defaultArAccountId: null, defaultApAccountId: null, defaultTaxAccountId: null,
    });
  });
});

describe('FU-FINANCE-SETTINGS-PATCH (D-205): changing the accountant export address needs settings admin and revenue read', () => {
  it('[V71E-A01] RED-BEFORE: STAFF on role defaults and a revenue:read-only member are refused PATCH accountantEmail, to their own address or cleared: 403 with the binding refusal naming accountantEmail, Business row (Business.accountantEmail included) byte-identical, the owner still reads the saved address', async () => {
    for (const actor of [ID.staffDefault, ID.staffRead]) {
      for (const accountantEmail of [ownAddress(actor), null, '']) {
        const before = await businessRowText();
        const res = await patchSettings(actor, { accountantEmail });
        expect(await businessRowText(), `${actor} -> ${JSON.stringify(accountantEmail)}: patch ${res.status}: the Business row is byte-identical`).toBe(before);
        expectRefused(res, `${actor} PATCH accountantEmail ${JSON.stringify(accountantEmail)}`, recipientRefusal('none'), ['accountantEmail']);
        expect(JSON.stringify(res.body), 'the refusal does not echo the address').not.toContain(ownAddress(actor));
      }
    }
    const read = await getSettings(ID.owner);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body.accountantEmail).toBe(SEEDED.accountantEmail);
  });

  it("[V71E-A02] RED-BEFORE: a revenue:write STAFF member and an ADMIN with settings write (not admin) are refused PATCH accountantEmail too, alone and in the settings page's whole-form save: 403, row byte-identical", async () => {
    for (const [actor, level] of [[ID.staffWrite, 'none'], [ID.adminW, 'write']] as const) {
      const read = await getSettings(actor);
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      for (const body of [
        { accountantEmail: ownAddress(actor) },
        { ...read.body, accountantEmail: ownAddress(actor) },
        { ...read.body, accountingBasis: 'ACCRUAL', accountantEmail: ownAddress(actor) },
      ]) {
        const before = await businessRowText();
        const res = await patchSettings(actor, body);
        expect(await businessRowText(), `${actor} ${Object.keys(body).length} keys: patch ${res.status}: the Business row is byte-identical`).toBe(before);
        expectRefused(res, `${actor} PATCH ${Object.keys(body).join(',')}`, recipientRefusal(level), ['accountantEmail']);
      }
    }
  });

  it('[V71E-A03] control: the owner, an ADMIN with settings admin and revenue read, an ADMIN on role defaults and a SUPER_ADMIN member change accountantEmail (200, written, GET reads it back); the ADMIN with settings admin clears it (null)', async () => {
    for (const actor of [ID.owner, ID.adminSet, ID.adminDefault, ID.superStaff]) {
      await reset();
      const to = `${actor.slice(P.length).toLowerCase()}-pick@${P}firm.test.local`;
      const res = await patchSettings(actor, { accountantEmail: `  ${to} ` });
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.accountantEmail, actor).toBe(to);
      expect((await stored())?.accountantEmail, actor).toBe(to);
      const read = await getSettings(ID.owner);
      expect(read.body.accountantEmail, `${actor}: the owner reads it back`).toBe(to);
    }
    await reset();
    const cleared = await patchSettings(ID.adminSet, { accountantEmail: null });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect((await stored())?.accountantEmail).toBeNull();
  });
});

describe('FU-FINANCE-SETTINGS-PATCH (D-205): changing the accounting basis, fiscal year and default accounts needs revenue write', () => {
  it('[V71E-B01] RED-BEFORE: revenue readers (STAFF on role defaults, a revenue:read STAFF member, an ADMIN with settings admin and revenue read) are refused a change of each of accountingBasis, fiscalYearStartMonth and the four default account ids, and of all of them together: 403 naming the changed fields, row byte-identical', async () => {
    const changes: Array<Record<string, unknown>> = [
      { accountingBasis: 'ACCRUAL' },
      { fiscalYearStartMonth: 7 },
      { defaultCashAccountId: ID.cash },
      { defaultArAccountId: ID.ar },
      { defaultApAccountId: ID.ap },
      { defaultTaxAccountId: ID.tax },
      { accountingBasis: 'ACCRUAL', fiscalYearStartMonth: 7, defaultCashAccountId: ID.cash, defaultArAccountId: ID.ar, defaultApAccountId: ID.ap, defaultTaxAccountId: ID.tax },
    ];
    for (const actor of [ID.staffDefault, ID.staffRead, ID.adminSet]) {
      for (const body of changes) {
        const before = await businessRowText();
        const res = await patchSettings(actor, body);
        expect(await businessRowText(), `${actor} ${Object.keys(body).join(',')}: patch ${res.status}: the Business row is byte-identical`).toBe(before);
        expectRefused(res, `${actor} PATCH ${Object.keys(body).join(',')}`, booksRefusal('read'), Object.keys(body));
      }
    }
  });

  it('[V71E-B02] control: a revenue:write STAFF member and an ADMIN with settings write (revenue admin) change the basis, the fiscal year and the four default accounts (200, written), and the accountant address is not touched', async () => {
    for (const actor of [ID.staffWrite, ID.adminW]) {
      await reset();
      const res = await patchSettings(actor, {
        accountingBasis: 'ACCRUAL', fiscalYearStartMonth: 10,
        defaultCashAccountId: ID.cash, defaultArAccountId: ID.ar, defaultApAccountId: ID.ap, defaultTaxAccountId: ID.tax,
      });
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(await stored(), actor).toEqual({
        accountantEmail: SEEDED.accountantEmail, accountingBasis: 'ACCRUAL', fiscalYearStartMonth: 10, defaultTaxRate: SEEDED.defaultTaxRate,
        defaultCashAccountId: ID.cash, defaultArAccountId: ID.ar, defaultApAccountId: ID.ap, defaultTaxAccountId: ID.tax,
      });
      // and back to no default account (null is a change too, and theirs to make)
      const cleared = await patchSettings(actor, { defaultCashAccountId: null });
      expect(cleared.status, `${actor} clears: ${JSON.stringify(cleared.body)}`).toBe(200);
      expect((await stored())?.defaultCashAccountId, actor).toBeNull();
    }
  });
});

describe('FU-FINANCE-SETTINGS-PATCH (D-205): a submitted value equal to the one GET answers is not a change', () => {
  it("[V71E-C01] RED-BEFORE: the settings page's whole-form save (every field GET returned, a NULL fiscal year read as 1) by STAFF on role defaults is 200 and writes nothing (row byte-identical); an ADMIN with settings admin and revenue read who changes only the address writes only it (the NULL fiscal year stays NULL); a revenue:write member who changes only the basis writes only it", async () => {
    // STAFF on role defaults: nothing in the form is theirs to change, and nothing changes.
    await reset(null);
    let read = await getSettings(ID.staffDefault);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body.fiscalYearStartMonth, 'GET answers a stored NULL fiscal year as 1').toBe(1);
    let before = await businessRowText();
    let res = await patchSettings(ID.staffDefault, { ...read.body });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await businessRowText(), 'nothing written: the Business row is byte-identical').toBe(before);
    // the same with the address re-spelled as the page may send it (surrounding spaces): the same address
    res = await patchSettings(ID.staffDefault, { ...read.body, accountantEmail: ` ${SEEDED.accountantEmail} ` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await businessRowText(), 'the same address, trimmed, is not a change').toBe(before);

    // An ADMIN with settings admin and revenue read: the address is theirs, the fiscal year is not.
    await reset(null);
    read = await getSettings(ID.adminSet);
    res = await patchSettings(ID.adminSet, { ...read.body, accountantEmail: `admin-pick@${P}firm.test.local` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await stored()).toMatchObject({ accountantEmail: `admin-pick@${P}firm.test.local`, fiscalYearStartMonth: null, accountingBasis: 'CASH' });

    // A revenue:write STAFF member: the basis is theirs, the address is not (and it is not rewritten).
    await reset(null);
    read = await getSettings(ID.staffWrite);
    before = await businessRowText();
    res = await patchSettings(ID.staffWrite, { ...read.body, accountingBasis: 'ACCRUAL' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await stored()).toMatchObject({ accountantEmail: SEEDED.accountantEmail, accountingBasis: 'ACCRUAL' });
    expect(before).not.toBe(await businessRowText());
  });
});

describe('FU-FINANCE-SETTINGS-PATCH: the D-11 owner-only tax rate is unchanged', () => {
  it('[V71E-D01] pinned: a revenue:write STAFF member, an ADMIN with settings admin and revenue read and an ADMIN on role defaults changing defaultTaxRate are refused 403 BUSINESS_PROFILE_OWNER_ONLY, also beside fields they may change (row byte-identical); the owner changes it (200)', async () => {
    for (const [actor, beside] of [
      [ID.staffWrite, { accountingBasis: 'ACCRUAL' }],
      [ID.adminSet, { accountantEmail: `admin-pick@${P}firm.test.local` }],
      [ID.adminDefault, { accountingBasis: 'ACCRUAL', accountantEmail: `admin-pick@${P}firm.test.local` }],
    ] as const) {
      for (const body of [{ defaultTaxRate: 99 }, { defaultTaxRate: 99, ...beside }]) {
        const before = await businessRowText();
        const res = await patchSettings(actor, body);
        expect(await businessRowText(), `${actor} patch ${res.status}: the Business row is byte-identical`).toBe(before);
        expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(res.body?.code, actor).toBe(PROFILE_CODE);
      }
    }
    const owner = await patchSettings(ID.owner, { defaultTaxRate: 15, accountingBasis: 'ACCRUAL', accountantEmail: `owner-pick@${P}firm.test.local` });
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    expect(await stored()).toMatchObject({ defaultTaxRate: 15, accountingBasis: 'ACCRUAL', accountantEmail: `owner-pick@${P}firm.test.local` });
  });
});

describe('FU-FINANCE-SETTINGS-PATCH: GET settings tells the caller in advance what they may change', () => {
  it('[V71E-G01] RED-BEFORE: GET settings answers the caller\'s mayChangeAccountantEmail, mayChangeBooksSettings and mayChangeTaxRate beside the settings, for every member kind (owner, STAFF on defaults, revenue:read, revenue:write, settings admin + revenue read, ADMIN with settings write, ADMIN on defaults, a SUPER_ADMIN member)', async () => {
    for (const actor of USERS) {
      const res = await getSettings(actor);
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(200);
      const hints = Object.fromEntries(HINT_KEYS.map((k) => [k, res.body[k]]));
      expect(hints, actor).toEqual(HINTS[actor]);
      expect(res.body, actor).toMatchObject({ accountantEmail: SEEDED.accountantEmail, accountingBasis: 'CASH', fiscalYearStartMonth: 1 });
    }
  });

  it("[V71E-G02] RED-BEFORE: each hint is the server's own rule: for every member kind, mayChangeAccountantEmail is what PATCH accountantEmail and the accountant box's saveRecipient answer, mayChangeBooksSettings what PATCH accountingBasis answers and mayChangeTaxRate what PATCH defaultTaxRate answers", async () => {
    for (const actor of USERS) {
      await reset();
      const hints = (await getSettings(actor)).body;
      const label = (what: string) => `${actor}: ${what} (hints ${JSON.stringify(Object.fromEntries(HINT_KEYS.map((k) => [k, hints[k]])))})`;

      const patchEmail = await patchSettings(actor, { accountantEmail: ownAddress(actor) });
      expect(patchEmail.status === 200, label(`PATCH accountantEmail answered ${patchEmail.status}`)).toBe(hints.mayChangeAccountantEmail);

      await reset();
      const remember = await sendExport(actor, { to: ownAddress(actor), saveRecipient: true });
      const saved = remember.status === 201 && remember.body?.savedAsDefault === true;
      expect(saved, label(`saveRecipient answered ${remember.status} ${JSON.stringify(remember.body?.message ?? remember.body?.savedAsDefault)}`)).toBe(hints.mayChangeAccountantEmail);
      if (!saved) expect(remember.status, label('a refused saveRecipient is the 403')).toBe(403);

      await reset();
      const basis = await patchSettings(actor, { accountingBasis: 'ACCRUAL' });
      expect(basis.status === 200, label(`PATCH accountingBasis answered ${basis.status}`)).toBe(hints.mayChangeBooksSettings);

      await reset();
      const rate = await patchSettings(actor, { defaultTaxRate: 7 });
      expect(rate.status === 200, label(`PATCH defaultTaxRate answered ${rate.status}`)).toBe(hints.mayChangeTaxRate);
    }
  }, 60_000);

  it('[V71E-G03] RED-BEFORE: PATCH answers the settings it wrote with the same hints GET answers (the settings page keeps them after a save); a refused PATCH carries no setting and no hint', async () => {
    for (const actor of [ID.owner, ID.staffWrite, ID.adminSet]) {
      await reset();
      const read = await getSettings(actor);
      const body = actor === ID.adminSet ? { accountantEmail: `admin-pick@${P}firm.test.local` } : { accountingBasis: 'ACCRUAL' };
      const res = await patchSettings(actor, body);
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(200);
      for (const k of HINT_KEYS) expect(res.body[k], `${actor}: ${k}`).toBe(read.body[k]);
      expect(Object.fromEntries(HINT_KEYS.map((k) => [k, res.body[k]])), actor).toEqual(HINTS[actor]);
    }
    await reset();
    const refused = await patchSettings(ID.staffDefault, { accountantEmail: ownAddress(ID.staffDefault) });
    expectRefused(refused, 'STAFF on defaults PATCH accountantEmail', recipientRefusal('none'), ['accountantEmail']);
  });
});
