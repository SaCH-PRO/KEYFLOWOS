/**
 * FU-FINANCE-SETTINGS-SCOPE (V1-71; found live by the GATE-JOURNEYS-G-L repair, journey H): who may read the finance
 * settings and change where the accountant export goes. REAL database, through the HTTP routes.
 *
 * THE PROBE (an isolated stack): a STAFF member whose scope map is { bookings: read, crm: read } (no revenue, no
 * settings) PATCHed /finance/businesses/:id/settings accountantEmail to their own address (200, stored; the owner read
 * it back), and GET .../settings answered them every setting. POST .../accountant-export/email sends the books ZIP to
 * Business.accountantEmail when no `to` is sent (the Reports and Tax pages prefill it), and its saveRecipient: true
 * wrote Business.accountantEmail under revenue read alone. So a member redirected the business's books to themselves.
 *
 * THE RULE (the WH3-1 export-binding rule SWEEP-P0-FOLLOWUP set for export destinations: binding a destination that
 * receives the business's data needs read of that data beside settings admin):
 *   - GET settings needs revenue read (ModuleScopeGuard, 403 before the handler, no setting in the body);
 *   - PATCH settings needs revenue read (ModuleScopeGuard), the read every one of its fields needs; the D-11 owner-only
 *     defaultTaxRate rule (FinanceSettingsService.assertTaxRateOwner) runs after it exactly as before;
 *   - POST accountant-export/email keeps revenue read for a send; a saveRecipient that changes the saved recipient needs
 *     settings admin and revenue read (assertMaySetExportDestination, CONNECTOR_EXPORT_READS.accountant_email), checked
 *     before the sender's configuration is read, the export built, anything sent or anything written: a refusal is a
 *     403 with the whole request undone (no email, Business row byte-identical). A saveRecipient that names the address
 *     already saved changes nothing and is not refused.
 * NOT APPLIED HERE (a CONTRADICTION this packet reported; owner question 19): settings admin for PATCH accountantEmail
 * and revenue write for PATCH's other fields. Owner ruling D-205 (2026-11-16) amended the three Release 0 cases that
 * pinned the old rule (d11-sibling-writes.json D11F-F05, F06, F11) and FU-FINANCE-SETTINGS-PATCH applies it; its proof is
 * test/finance-settings-patch.integration.test.ts (v71e_). This suite pins nothing of that rule either way.
 *
 * HOW THE APP IS COMPOSED (the d11-finance-settings model): a real Nest app with the real FinanceController,
 * FinanceSettingsService, AccountantExportEmailService, PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard and the
 * production GlobalHttpExceptionFilter, against DATABASE_URL. Identity attachment is the one stand-in on the
 * authorization path (`x-test-user` -> the seeded User row, as AuthMiddleware attaches it). The accountant export's ZIP
 * builder is a spy returning a fixed package (its content is not under test) and the platform mailer is a tap that
 * records every send and sends nothing (no provider traffic). FinanceController's other collaborators are never reached
 * by these routes and are empty stand-ins.
 *
 * FIXTURES: every id has the `v71d_` prefix (test/helpers/fixture-prefixes.json, packet 'V1-71
 * (FU-FINANCE-SETTINGS-SCOPE)'); every unique column written (User.email) contains it; every row is hard-deleted with
 * LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll. No $transaction wrapping.
 *
 *   V71D-X01  fixture sanity
 *   V71D-G01  RED-BEFORE  GET settings refuses a member without revenue read (the probe; an ADMIN whose map says revenue none)
 *   V71D-G02  control     revenue readers (STAFF on defaults, revenue:read, the owner, a settings ADMIN) still read them
 *   V71D-P01  RED-BEFORE  the probe's PATCH accountantEmail to their own address: 403, the Business row byte-identical
 *   V71D-P02  RED-BEFORE  the probe's PATCH of the other settings (and the whole-form save) is refused too
 *   V71D-P03  control     the owner, a settings-admin ADMIN with revenue read and a revenue-write STAFF member keep their writes
 *   V71D-P04  pinned      D-11 unchanged: a non-owner's defaultTaxRate change is still 403 BUSINESS_PROFILE_OWNER_ONLY
 *   V71D-S01  RED-BEFORE  a revenue:read-only member's saveRecipient: 403, nothing built or sent, the row byte-identical
 *   V71D-S02  RED-BEFORE  STAFF on defaults, a revenue-write STAFF member and an ADMIN with settings write are refused too
 *   V71D-S03  RED-BEFORE  the refusal comes first: refused even when the sender is not configured (403, not the 400)
 *   V71D-S04  control     a send without saveRecipient, and a saveRecipient naming the saved address, go through, saving nothing
 *   V71D-S05  control     the owner, a settings-admin ADMIN with revenue read and a SUPER_ADMIN member save the recipient
 *   V71D-S06  control     the accountant box's way forward (review FSS-CR-3): a STAFF member on role defaults refused the
 *                         save, then the same address with saveRecipient false: 201, sent once, nothing saved
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71d_';

const ID = {
  owner: `${P}owner`,             // OWNER membership + Business.ownerId
  probe: `${P}probe`,             // STAFF, explicit { bookings: read, crm: read } (the probed member: revenue none, settings none)
  staffRead: `${P}staffRead`,     // STAFF, explicit { revenue: read } (revenue read only, settings none)
  staffDefault: `${P}staffDef`,   // STAFF, role defaults (revenue read, settings none)
  staffWrite: `${P}staffWrite`,   // STAFF, explicit { revenue: write } (revenue write, settings none)
  adminSet: `${P}adminSet`,       // ADMIN, explicit { settings: admin, revenue: read }
  adminNoRev: `${P}adminNoRev`,   // ADMIN, ADMIN defaults with revenue: none
  adminW: `${P}adminW`,           // ADMIN, ADMIN defaults with settings: write (revenue admin)
  superStaff: `${P}superStaff`,   // User.role SUPER_ADMIN holding a STAFF membership (ensureAccess admits it)
  biz: `${P}biz`,
};
const USERS = [ID.owner, ID.probe, ID.staffRead, ID.staffDefault, ID.staffWrite, ID.adminSet, ID.adminNoRev, ID.adminW, ID.superStaff];
const emailOf = (id: string) => `${id}@v71d.test.local`;
/** The address a member redirects the books to: their own. */
const ownAddress = (id: string) => `${id}+books@v71d.test.local`;

const SEEDED = {
  accountantEmail: `seed@${P}accountant.test.local`,
  accountingBasis: 'CASH',
  fiscalYearStartMonth: 1,
  defaultTaxRate: 12.5,
};

const REVENUE_READ_REFUSAL = 'Insufficient permissions: revenue requires read access (you have none)';
/** The binding refusal's words (core/connectors/connector-exports.ts, EXPORT_ACCOUNT_WORDS.accountant_email). */
const RECIPIENT_WHAT = "saving the accountant's email address, which receives the business's books (the accountant export),";
const PROFILE_CODE = 'BUSINESS_PROFILE_OWNER_ONLY';

let db: any;
let app: any;

/** The platform mailer, tapped: every send recorded, nothing sent anywhere. */
const mailer = {
  configured: true,
  sent: [] as Array<{ to: string; subject: string; attachments?: Array<{ filename: string }> }>,
  isConfigured() { return this.configured; },
  async sendTransactional(args: { to: string; subject: string; attachments?: Array<{ filename: string }> }) {
    this.sent.push(args);
    return { id: `${P}msg_${this.sent.length}` };
  },
};
/** The accountant export's ZIP builder: a spy (its package is not under test). */
const builder = {
  calls: [] as Array<{ businessId: string }>,
  async build(input: { businessId: string }) {
    this.calls.push(input);
    return { filename: `${P}export.zip`, buffer: Buffer.from('v71d-zip'), bytes: 8, generatedAt: '2026-11-16T00:00:00.000Z' };
  },
};

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
async function businessRowText(): Promise<string> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(b)::text AS j FROM businesses b WHERE b.id = $1', ID.biz);
  expect(rows.length, 'the business exists').toBe(1);
  return rows[0].j as string;
}

async function stored() {
  return db.business.findUnique({
    where: { id: ID.biz },
    select: { accountantEmail: true, accountingBasis: true, fiscalYearStartMonth: true, defaultTaxRate: true, defaultCashAccountId: true },
  });
}

/** Each case starts from the seeded settings, an empty mailer and builder. Raw SQL. */
async function reset() {
  await db.$executeRawUnsafe(
    `UPDATE businesses SET accountant_email = $2, accounting_basis = $3, fiscal_year_start_month = $4, default_tax_rate = $5,
       default_cash_account_id = NULL, default_ar_account_id = NULL, default_ap_account_id = NULL, default_tax_account_id = NULL
     WHERE id = $1`,
    ID.biz, SEEDED.accountantEmail, SEEDED.accountingBasis, SEEDED.fiscalYearStartMonth, SEEDED.defaultTaxRate,
  );
  mailer.sent.length = 0;
  mailer.configured = true;
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

/** A refused call: 403 with the expected message, and no setting (no accountant address) in the body. */
function expectRefused(res: { status: number; body: any }, label: string, message?: string | RegExp) {
  expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(403);
  if (typeof message === 'string') expect(res.body?.message, label).toBe(message);
  else if (message) expect(res.body?.message, label).toMatch(message);
  const text = JSON.stringify(res.body);
  for (const key of ['accountantEmail', 'accountingBasis', 'fiscalYearStartMonth', 'defaultTaxRate', 'savedAsDefault']) {
    expect(res.body, `${label}: no ${key} in a refusal`).not.toHaveProperty(key);
  }
  expect(text, `${label}: the saved address is not in a refusal`).not.toContain(SEEDED.accountantEmail);
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
  await reset();
  const { ROLE_DEFAULT_SCOPES } = await import('../src/core/authority/module-vocabulary');
  const memberships: Array<{ userId: string; role: string; permissionScopes?: Record<string, string> }> = [
    { userId: ID.owner, role: 'OWNER' },
    { userId: ID.probe, role: 'STAFF', permissionScopes: { bookings: 'read', crm: 'read' } },
    { userId: ID.staffRead, role: 'STAFF', permissionScopes: { revenue: 'read' } },
    { userId: ID.staffDefault, role: 'STAFF' },
    { userId: ID.staffWrite, role: 'STAFF', permissionScopes: { revenue: 'write' } },
    { userId: ID.adminSet, role: 'ADMIN', permissionScopes: { settings: 'admin', revenue: 'read' } },
    { userId: ID.adminNoRev, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, revenue: 'none' } },
    { userId: ID.adminW, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, settings: 'write' } },
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

describe('V71D fixture sanity (real rows)', () => {
  it('[V71D-X01] seeded one business, nine users and nine memberships; the probe holds no revenue or settings key; the business starts at the seeded settings', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(1);
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(9);
    expect(await db.membership.count({ where: { id: { startsWith: P } } })).toBe(9);
    const probe = await db.membership.findFirst({ where: { userId: ID.probe }, select: { role: true, permissionScopes: true } });
    expect(probe).toEqual({ role: 'STAFF', permissionScopes: { bookings: 'read', crm: 'read' } });
    expect(await stored()).toMatchObject({ accountantEmail: SEEDED.accountantEmail, accountingBasis: 'CASH', fiscalYearStartMonth: 1 });
  });
});

describe('FU-FINANCE-SETTINGS-SCOPE: GET settings needs revenue read', () => {
  it('[V71D-G01] RED-BEFORE: the probe (bookings and crm read only) and an ADMIN whose map says revenue none are refused GET settings (403 before the handler): no setting, no accountant address answered', async () => {
    for (const actor of [ID.probe, ID.adminNoRev]) {
      const res = await getSettings(actor);
      expectRefused(res, `${actor} GET settings`, REVENUE_READ_REFUSAL);
    }
  });

  it('[V71D-G02] control: STAFF on role defaults, a revenue:read STAFF member, the owner and a settings ADMIN with revenue read still read the settings (200, the saved address included)', async () => {
    for (const actor of [ID.staffDefault, ID.staffRead, ID.owner, ID.adminSet, ID.superStaff]) {
      const res = await getSettings(actor);
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body, actor).toMatchObject({ accountantEmail: SEEDED.accountantEmail, accountingBasis: 'CASH', fiscalYearStartMonth: 1 });
    }
  });
});

describe('FU-FINANCE-SETTINGS-SCOPE: PATCH settings needs revenue read', () => {
  it("[V71D-P01] RED-BEFORE: the probe's PATCH of accountantEmail to their own address is refused (403): the Business row is byte-identical and the owner still reads the saved address", async () => {
    const before = await businessRowText();
    const res = await patchSettings(ID.probe, { accountantEmail: ownAddress(ID.probe) });
    expect(await businessRowText(), `patch ${res.status}: the Business row is byte-identical`).toBe(before);
    expectRefused(res, 'probe PATCH accountantEmail', REVENUE_READ_REFUSAL);
    const read = await getSettings(ID.owner);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body.accountantEmail).toBe(SEEDED.accountantEmail);
  });

  it("[V71D-P02] RED-BEFORE: the probe's PATCH of the other settings, and an ADMIN's whose map says revenue none, are refused (403), the whole-form save included: the row byte-identical", async () => {
    const wholeForm = {
      accountingBasis: 'ACCRUAL', fiscalYearStartMonth: 7, defaultTaxRate: SEEDED.defaultTaxRate, accountantEmail: ownAddress(ID.probe),
      defaultCashAccountId: null, defaultArAccountId: null, defaultApAccountId: null, defaultTaxAccountId: null, currency: 'TTD',
    };
    for (const [actor, body] of [
      [ID.probe, { accountingBasis: 'ACCRUAL', fiscalYearStartMonth: 7 }],
      [ID.probe, wholeForm],
      [ID.adminNoRev, { accountingBasis: 'ACCRUAL' }],
      [ID.adminNoRev, { accountantEmail: ownAddress(ID.adminNoRev) }],
    ] as const) {
      const before = await businessRowText();
      const res = await patchSettings(actor, body);
      expect(await businessRowText(), `${actor} patch ${res.status}: the Business row is byte-identical`).toBe(before);
      expectRefused(res, `${actor} PATCH ${Object.keys(body).join(',')}`, REVENUE_READ_REFUSAL);
    }
  });

  it('[V71D-P03] control: the owner, a settings-admin ADMIN with revenue read and a revenue-write STAFF member keep the writes their scopes allow (200, written)', async () => {
    const owner = await patchSettings(ID.owner, { accountantEmail: `owner-pick@${P}firm.test.local`, accountingBasis: 'ACCRUAL', fiscalYearStartMonth: 4 });
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    expect(await stored()).toMatchObject({ accountantEmail: `owner-pick@${P}firm.test.local`, accountingBasis: 'ACCRUAL', fiscalYearStartMonth: 4 });

    await reset();
    const admin = await patchSettings(ID.adminSet, { accountantEmail: `admin-pick@${P}firm.test.local` });
    expect(admin.status, JSON.stringify(admin.body)).toBe(200);
    expect((await stored())?.accountantEmail).toBe(`admin-pick@${P}firm.test.local`);

    await reset();
    const staff = await patchSettings(ID.staffWrite, { accountingBasis: 'ACCRUAL', fiscalYearStartMonth: 10, defaultCashAccountId: null });
    expect(staff.status, JSON.stringify(staff.body)).toBe(200);
    expect(await stored()).toMatchObject({ accountingBasis: 'ACCRUAL', fiscalYearStartMonth: 10, defaultCashAccountId: null, accountantEmail: SEEDED.accountantEmail });
  });

  it('[V71D-P04] pinned: D-11 unchanged: a revenue-write STAFF member and a settings-admin ADMIN changing defaultTaxRate are refused 403 BUSINESS_PROFILE_OWNER_ONLY (row byte-identical); the owner changes it (200)', async () => {
    for (const actor of [ID.staffWrite, ID.adminSet]) {
      const before = await businessRowText();
      const res = await patchSettings(actor, { defaultTaxRate: 99, accountingBasis: 'ACCRUAL' });
      expect(await businessRowText(), `${actor} patch ${res.status}: the Business row is byte-identical`).toBe(before);
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body?.code, actor).toBe(PROFILE_CODE);
    }
    const owner = await patchSettings(ID.owner, { defaultTaxRate: 15 });
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    expect((await stored())?.defaultTaxRate).toBe(15);
  });
});

describe('FU-FINANCE-SETTINGS-SCOPE: saving the accountant export recipient needs settings admin and revenue read (WH3-1 binding rule)', () => {
  it("[V71D-S01] RED-BEFORE: a revenue:read-only member's send with saveRecipient to their own address is refused as a whole (403, the binding refusal): no export built, no email sent, the Business row byte-identical", async () => {
    const before = await businessRowText();
    const res = await sendExport(ID.staffRead, { to: ownAddress(ID.staffRead), saveRecipient: true });
    expect(await businessRowText(), `send ${res.status}: the Business row is byte-identical`).toBe(before);
    expect(mailer.sent, 'no email is sent for a refused saveRecipient').toEqual([]);
    expect(builder.calls, 'the export is not built for a refused saveRecipient').toEqual([]);
    expectRefused(res, 'staffRead saveRecipient', `Insufficient permissions: ${RECIPIENT_WHAT} needs settings admin access (you have none)`);
    expect(JSON.stringify(res.body), 'the refusal does not echo the address').not.toContain(ownAddress(ID.staffRead));
  });

  it('[V71D-S02] RED-BEFORE: STAFF on role defaults, a revenue-write STAFF member and an ADMIN with settings write (not admin) are refused the same way: no export built, no email sent, the row byte-identical', async () => {
    for (const [actor, level] of [[ID.staffDefault, 'none'], [ID.staffWrite, 'none'], [ID.adminW, 'write']] as const) {
      const before = await businessRowText();
      const res = await sendExport(actor, { to: ownAddress(actor), saveRecipient: true, message: 'please file' });
      expect(await businessRowText(), `${actor} send ${res.status}: the Business row is byte-identical`).toBe(before);
      expect(mailer.sent, `${actor}: no email`).toEqual([]);
      expect(builder.calls, `${actor}: no export built`).toEqual([]);
      expectRefused(res, `${actor} saveRecipient`, `Insufficient permissions: ${RECIPIENT_WHAT} needs settings admin access (you have ${level})`);
    }
  });

  it('[V71D-S03] RED-BEFORE: the refusal comes before the sender configuration is read: with no platform mailer configured, the revenue:read member is still refused 403 (not the 400 a configuration error answers), nothing written', async () => {
    mailer.configured = false;
    const before = await businessRowText();
    const res = await sendExport(ID.staffRead, { to: ownAddress(ID.staffRead), saveRecipient: true });
    expect(await businessRowText(), `send ${res.status}: the Business row is byte-identical`).toBe(before);
    expectRefused(res, 'staffRead saveRecipient, mailer not configured', /needs settings admin access/);
    // control: the configuration error itself is unchanged for a send that saves nothing
    const plain = await sendExport(ID.staffRead, { to: `firm@${P}accountant.test.local` });
    expect(plain.status, JSON.stringify(plain.body)).toBe(400);
    expect(plain.body?.message).toMatch(/Email sender is not configured/);
    expect(mailer.sent).toEqual([]);
  });

  it('[V71D-S04] control: a revenue reader sends without saving (200, sent once, nothing saved), and a saveRecipient that names the saved address (or leaves `to` out) changes nothing and is not refused', async () => {
    const before = await businessRowText();
    const plain = await sendExport(ID.staffRead, { to: `firm@${P}accountant.test.local` });
    expect(plain.status, JSON.stringify(plain.body)).toBe(201);
    expect(plain.body).toMatchObject({ to: `firm@${P}accountant.test.local`, savedAsDefault: false });
    expect(mailer.sent.map((m) => m.to)).toEqual([`firm@${P}accountant.test.local`]);
    expect(await businessRowText(), 'nothing saved').toBe(before);

    for (const body of [{ to: SEEDED.accountantEmail, saveRecipient: true }, { saveRecipient: true }]) {
      mailer.sent.length = 0;
      const res = await sendExport(ID.staffDefault, body);
      expect(res.status, `${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body).toMatchObject({ to: SEEDED.accountantEmail, savedAsDefault: false });
      expect(mailer.sent.map((m) => m.to)).toEqual([SEEDED.accountantEmail]);
      expect(await businessRowText(), `${JSON.stringify(body)}: nothing saved`).toBe(before);
    }
  });

  it('[V71D-S05] control: the owner, a settings-admin ADMIN with revenue read and a SUPER_ADMIN member save a new recipient (201, savedAsDefault, sent once to it, Business.accountantEmail written)', async () => {
    for (const actor of [ID.owner, ID.adminSet, ID.superStaff]) {
      await reset();
      const to = `${actor.slice(P.length).toLowerCase()}-pick@${P}firm.test.local`;
      const res = await sendExport(actor, { to, saveRecipient: true });
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body, actor).toMatchObject({ to, savedAsDefault: true });
      expect(mailer.sent.map((m) => m.to), actor).toEqual([to]);
      expect(builder.calls.map((c) => c.businessId), actor).toEqual([ID.biz]);
      expect((await stored())?.accountantEmail, actor).toBe(to);
    }
  });

  it("[V71D-S06] control (review FSS-CR-3, the accountant box's \"Send without saving\"): a STAFF member on role defaults refused a saveRecipient sends the same address with saveRecipient false: 201, sent once to it, nothing built for the refused send, nothing saved", async () => {
    const before = await businessRowText();
    const to = ownAddress(ID.staffDefault);
    const refused = await sendExport(ID.staffDefault, { to, saveRecipient: true });
    expectRefused(refused, 'staffDefault saveRecipient', `Insufficient permissions: ${RECIPIENT_WHAT} needs settings admin access (you have none)`);
    expect(mailer.sent, 'the refused send sent nothing').toEqual([]);
    expect(builder.calls, 'the refused send built nothing').toEqual([]);
    const unsaved = await sendExport(ID.staffDefault, { to, saveRecipient: false });
    expect(unsaved.status, JSON.stringify(unsaved.body)).toBe(201);
    expect(unsaved.body).toMatchObject({ to, savedAsDefault: false });
    expect(mailer.sent.map((m) => m.to), 'sent once, to the address the member named').toEqual([to]);
    expect(builder.calls.map((c) => c.businessId)).toEqual([ID.biz]);
    expect(await businessRowText(), 'nothing saved: the Business row is byte-identical').toBe(before);
    expect((await stored())?.accountantEmail).toBe(SEEDED.accountantEmail);
  });
});
