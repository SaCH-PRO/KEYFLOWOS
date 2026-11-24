/**
 * FU-FINANCE-INTEL-DOORS (owner ruling D-258, 2026-11-22, #80 comment 7086321614): the finance intelligence doors are
 * gated. REAL database, through the HTTP routes.
 *
 * THE GAP: POST /finance/businesses/:b/intelligence/scan and POST .../intelligence/actions/:id/resolve and /dismiss
 * checked membership only (ensureAccess), so a member with no revenue scope at all re-ran the money detectors (which
 * write FinanceActionItem rows and mirror them into RevenueAction and CommandItem) and closed the business's money
 * action items (and their mirrored revenue actions and command items). The GET siblings (intelligence/actions,
 * intelligence/insight) already need revenue read (D-146).
 *
 * THE RULE (D-258: "POST intelligence actions /:id/resolve and /:id/dismiss need revenue write; POST intelligence scan
 * (finance and the intelligence module's scan) needs revenue read"):
 *   - finance resolve and dismiss: ModuleScopeGuard at revenue write, refused 403 before the handler, so nothing of
 *     the item (nor its mirrors) is written;
 *   - finance scan: ModuleScopeGuard at revenue read, refused 403 before the handler, nothing written;
 *   - the intelligence module's scan (POST /intelligence/businesses/:b/scan) keeps its settings write (the route's
 *     guard, unchanged: this packet narrows, never widens) and needs revenue read too (the scan writes money signals
 *     and command items: overdue invoices, quotes, uncategorised expenses), checked first in the handler with
 *     ModuleScopeGuard's words (assertMemberModuleLevel);
 *   - ensureAccess stays on the finance routes (D-46: a platform SUPER_ADMIN who is not a member writes nothing);
 *   - an action item id of another business is 404 for a member who may write (it was a 500: the service throws a
 *     plain Error), and the other business's row is not touched.
 * The scheduler's scans (FinanceIntelligenceScheduler, ScheduledScansService.runAllScans) run with no member and keep
 * their behaviour; no KEY tool calls scan, resolve or dismiss (finance_list_action_items reads the list only).
 *
 * HOW THE APP IS COMPOSED: a real Nest app with the real FinanceController, FinanceIntelligenceService and
 * IntelligenceController, PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard and the production
 * GlobalHttpExceptionFilter, against DATABASE_URL. Identity attachment is the one stand-in on the authorization path
 * (`x-test-user` -> the seeded User row, as AuthMiddleware attaches it). FinanceIntelligenceService's mirrors
 * (RevenueActionService.upsertExternal, CommandService) are recorders; the intelligence module's scan
 * (ScheduledScansService.scanBusiness) is a recorder too: what it writes is not under test, only whether the door
 * lets the call through. Every other collaborator is never reached by these routes and is an empty stand-in.
 *
 * FIXTURES: every id has the `v71x_` prefix (test/helpers/fixture-prefixes.json, packet 'V1-71
 * (FU-FINANCE-INTEL-DOORS)'); every User.email contains it; every row is hard-deleted with LIKE ${sqlLikePrefix(P)} in
 * beforeAll and afterAll. No $transaction wrapping.
 *
 *   FID-X01  fixture sanity
 *   FID-A01  RED-BEFORE  a member with revenue none (every other module at ADMIN's defaults) is refused the finance
 *                        scan: 403 in ModuleScopeGuard's words, no action item written or refreshed, no mirror call
 *   FID-A02  RED-BEFORE  revenue none and revenue read are refused resolve and dismiss: 403, the item and every action
 *                        item of the business byte-identical
 *   FID-A03  RED-BEFORE  revenue none is refused the intelligence module's scan (settings admin held): 403 in the
 *                        guard's words, the scan never runs
 *   FID-A04  control     revenue read may scan (finance and, with settings write, the intelligence module)
 *   FID-B01  control     the owner, a STAFF revenue:write member and an ADMIN with revenue write resolve and dismiss
 *                        (200, written); the finance scan of each writes the detected item
 *   FID-B02  pinned      the intelligence scan keeps its settings write: a STAFF revenue:write member (settings none)
 *                        is refused it; the owner and an ADMIN with revenue write run it
 *   FID-C01  RED-BEFORE  another business's action item id through this business's path is 404 for the owner and a
 *                        revenue:write member, and that item is byte-identical
 *   FID-C02  pinned      the other business's owner (not a member here) is refused every door here (403)
 *   FID-C03  pinned      a platform SUPER_ADMIN who is not a member is refused the finance doors (ensureAccess, D-46)
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71x_';

const ID = {
  owner: `${P}owner`,             // OWNER of biz (Business.ownerId + OWNER membership)
  revNone: `${P}revNone`,         // ADMIN, ADMIN defaults with revenue: none
  revRead: `${P}revRead`,         // ADMIN, ADMIN defaults with revenue: read
  staffWrite: `${P}staffWrite`,   // STAFF, explicit { revenue: write } (settings none)
  adminWrite: `${P}adminWrite`,   // ADMIN, ADMIN defaults with revenue: write
  otherOwner: `${P}otherOwner`,   // OWNER of other; no membership of biz
  superNon: `${P}superNon`,       // User.role SUPER_ADMIN, no membership anywhere
  biz: `${P}biz`,
  other: `${P}other`,
  item: `${P}item_a`,
  otherItem: `${P}item_b`,
  expense: `${P}exp_a`,
};
const USERS = [ID.owner, ID.revNone, ID.revRead, ID.staffWrite, ID.adminWrite, ID.otherOwner, ID.superNon];
const emailOf = (id: string) => `${id}@v71x.test.local`;

const refusal = (level: 'read' | 'write', have: string) => `Insufficient permissions: revenue requires ${level} access (you have ${have})`;

let db: any;
let app: any;

/** FinanceIntelligenceService's mirror into RevenueAction: a recorder. */
const revenueActions = {
  calls: [] as unknown[],
  async upsertExternal(input: unknown) {
    this.calls.push(input);
    return { actionId: null };
  },
};
/** The intelligence module's scan: a recorder (the door is under test, not the scan). */
const scans = {
  calls: [] as string[],
  async scanBusiness(businessId: string) {
    this.calls.push(businessId);
  },
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM command_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM finance_action_items WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort: cascades cover most of these */ }
  }
}

/** Every action item of a business exactly as Postgres stores it, ordered by id: "unchanged" means byte-identical. */
async function itemsText(businessId: string): Promise<string> {
  const rows = await db.$queryRawUnsafe(
    'SELECT row_to_json(f)::text AS j FROM finance_action_items f WHERE f.business_id = $1 ORDER BY f.id',
    businessId,
  );
  return rows.map((r: { j: string }) => r.j).join('\n');
}

async function itemRow(id: string) {
  return db.financeActionItem.findUnique({ where: { id }, select: { status: true, resolvedBy: true, resolution: true } });
}

/** Each case starts from one OPEN item per business (and nothing the scan wrote), with empty recorders. */
async function reset() {
  await db.$executeRawUnsafe(`DELETE FROM command_items WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM finance_action_items WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  for (const [id, businessId] of [[ID.item, ID.biz], [ID.otherItem, ID.other]] as const) {
    await db.financeActionItem.create({
      data: {
        id, businessId, kind: 'OVERSPENDING', severity: 'WARNING', title: `${P}title`, body: `${P}body`,
        entityType: 'budget', entityId: `${id}_entity`,
        detectedAt: new Date('2026-01-01T00:00:00Z'), lastSeenAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
  }
  revenueActions.calls.length = 0;
  scans.calls.length = 0;
}

const post = (actor: string, url: string, body: Record<string, unknown> = {}) =>
  request(app.getHttpServer()).post(url).set('x-test-user', actor).send(body);
const financeScan = (actor: string, biz = ID.biz) => post(actor, `/finance/businesses/${biz}/intelligence/scan`);
const resolveItem = (actor: string, id = ID.item, biz = ID.biz) =>
  post(actor, `/finance/businesses/${biz}/intelligence/actions/${id}/resolve`, { resolution: `${P}done` });
const dismissItem = (actor: string, id = ID.item, biz = ID.biz) =>
  post(actor, `/finance/businesses/${biz}/intelligence/actions/${id}/dismiss`);
const intelScan = (actor: string, biz = ID.biz) => post(actor, `/intelligence/businesses/${biz}/scan`);

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { FinanceIntelligenceService } = await import('../src/modules/finance/finance-intelligence.service');
  const { RevenueActionService } = await import('../src/modules/commerce/revenue-action.service');
  const { CommandService } = await import('../src/modules/command/command.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { IntelligenceController } = await import('../src/modules/intelligence/intelligence.controller');
  const { ScheduledScansService } = await import('../src/modules/intelligence/scheduled-scans.service');

  // The controllers' other collaborators: never reached by these routes.
  const unused = await Promise.all([
    import('../src/modules/finance/receivables.service').then((m) => m.ReceivablesService),
    import('../src/modules/finance/ledger-balance.service').then((m) => m.LedgerBalanceService),
    import('../src/modules/finance/finance-overview.service').then((m) => m.FinanceOverviewService),
    import('../src/modules/finance/finance-accounts.service').then((m) => m.FinanceAccountsService),
    import('../src/modules/finance/finance-coa.service').then((m) => m.FinanceCoaService),
    import('../src/modules/finance/finance-tax-rate.service').then((m) => m.FinanceTaxRateService),
    import('../src/modules/finance/finance-settings.service').then((m) => m.FinanceSettingsService),
    import('../src/modules/finance/bank-import.service').then((m) => m.BankImportService),
    import('../src/modules/finance/statement-source.service').then((m) => m.StatementSourceService),
    import('../src/modules/finance/bank-matching.service').then((m) => m.BankMatchingService),
    import('../src/modules/finance/bank-rule.service').then((m) => m.BankRuleService),
    import('../src/modules/finance/recurring-journal-entry.service').then((m) => m.RecurringJournalEntryService),
    import('../src/modules/finance/reconciliation.service').then((m) => m.ReconciliationService),
    import('../src/modules/finance/tax-liability.service').then((m) => m.TaxLiabilityService),
    import('../src/modules/finance/accountant-export.service').then((m) => m.AccountantExportService),
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
    import('../src/modules/intelligence/rules.service').then((m) => m.RulesService),
    import('../src/modules/intelligence/signals.service').then((m) => m.SignalsService),
    import('../src/modules/intelligence/health-score.service').then((m) => m.HealthScoreService),
    import('../src/modules/intelligence/entity-resolver.service').then((m) => m.EntityResolverService),
  ]);

  const moduleRef = await Test.createTestingModule({
    controllers: [FinanceController, IntelligenceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      FinanceIntelligenceService,
      { provide: RevenueActionService, useValue: revenueActions },
      { provide: CommandService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      { provide: ScheduledScansService, useValue: scans },
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
    await db.user.create({ data: { id, email: emailOf(id), name: id, role: id === ID.superNon ? 'SUPER_ADMIN' : 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: `${ID.biz}-name`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.other, name: `${ID.other}-name`, ownerId: ID.otherOwner, currency: 'TTD' } });
  // An uncategorised expense 30 days old: the finance scan detects it (UNCATEGORISED) and writes an action item.
  await db.expense.create({
    data: { id: ID.expense, businessId: ID.biz, description: `${P}expense`, amount: 125, vendor: `${P}vendor`, date: new Date(Date.now() - 30 * 86_400_000) },
  });
  const { ROLE_DEFAULT_SCOPES } = await import('../src/core/authority/module-vocabulary');
  const memberships: Array<{ userId: string; businessId: string; role: string; permissionScopes?: Record<string, string> }> = [
    { userId: ID.owner, businessId: ID.biz, role: 'OWNER' },
    { userId: ID.revNone, businessId: ID.biz, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, revenue: 'none' } },
    { userId: ID.revRead, businessId: ID.biz, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, revenue: 'read' } },
    { userId: ID.staffWrite, businessId: ID.biz, role: 'STAFF', permissionScopes: { revenue: 'write' } },
    { userId: ID.adminWrite, businessId: ID.biz, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, revenue: 'write' } },
    { userId: ID.otherOwner, businessId: ID.other, role: 'OWNER' },
  ];
  for (const m of memberships) {
    await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}_${m.businessId.slice(P.length)}`, ...m } });
  }
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

beforeEach(async () => {
  await reset();
});

describe('FU-FINANCE-INTEL-DOORS (D-258): the finance intelligence doors need revenue scope', () => {
  it('FID-X01 fixture sanity: the members, both items OPEN, the expense uncategorised', async () => {
    expect(await db.membership.count({ where: { businessId: ID.biz } })).toBe(5);
    expect((await itemRow(ID.item))?.status).toBe('OPEN');
    expect((await itemRow(ID.otherItem))?.status).toBe('OPEN');
    expect((await db.expense.findUnique({ where: { id: ID.expense } }))?.categoryId).toBeNull();
  });

  it('FID-A01 RED-BEFORE: revenue none is refused the finance scan, nothing written', async () => {
    const before = await itemsText(ID.biz);
    const res = await financeScan(ID.revNone);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body?.message).toBe(refusal('read', 'none'));
    expect(await itemsText(ID.biz)).toBe(before);
    expect(revenueActions.calls).toHaveLength(0);
    expect(await db.commandItem.count({ where: { businessId: ID.biz } })).toBe(0);
  });

  it.each([
    ['revenue none', ID.revNone, 'none'],
    ['revenue read', ID.revRead, 'read'],
  ])('FID-A02 RED-BEFORE: %s is refused resolve and dismiss, the items byte-identical', async (_label, actor, have) => {
    const before = await itemsText(ID.biz);
    for (const [door, call] of [['resolve', resolveItem], ['dismiss', dismissItem]] as const) {
      const res = await call(actor);
      expect(res.status, `${door}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body?.message, door).toBe(refusal('write', have));
      expect(await itemsText(ID.biz), door).toBe(before);
    }
  });

  it('FID-A03 RED-BEFORE: revenue none (settings admin) is refused the intelligence scan, which never runs', async () => {
    const res = await intelScan(ID.revNone);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body?.message).toBe(refusal('read', 'none'));
    expect(scans.calls).toHaveLength(0);
  });

  it('FID-A04 control: revenue read may scan, finance and (with settings write) the intelligence module', async () => {
    const fin = await financeScan(ID.revRead);
    expect(fin.status, JSON.stringify(fin.body)).toBe(201);
    expect(await db.financeActionItem.count({ where: { businessId: ID.biz, kind: 'UNCATEGORISED' } })).toBe(1);
    const intel = await intelScan(ID.revRead);
    expect(intel.status, JSON.stringify(intel.body)).toBe(201);
    expect(scans.calls).toEqual([ID.biz]);
  });

  it.each([
    ['the owner', ID.owner],
    ['a STAFF revenue:write member', ID.staffWrite],
    ['an ADMIN with revenue write', ID.adminWrite],
  ])('FID-B01 control: %s resolves, dismisses and scans', async (_label, actor) => {
    const resolved = await resolveItem(actor);
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(201);
    expect(await itemRow(ID.item)).toEqual({ status: 'RESOLVED', resolvedBy: actor, resolution: `${P}done` });

    await reset();
    const dismissed = await dismissItem(actor);
    expect(dismissed.status, JSON.stringify(dismissed.body)).toBe(201);
    expect(await itemRow(ID.item)).toEqual({ status: 'DISMISSED', resolvedBy: actor, resolution: null });

    const scanned = await financeScan(actor);
    expect(scanned.status, JSON.stringify(scanned.body)).toBe(201);
    expect(await db.financeActionItem.count({ where: { businessId: ID.biz, kind: 'UNCATEGORISED' } })).toBe(1);
  });

  it('FID-B02 pinned: the intelligence scan keeps settings write; the owner and an ADMIN with revenue write run it', async () => {
    const staff = await intelScan(ID.staffWrite);
    expect(staff.status, JSON.stringify(staff.body)).toBe(403);
    expect(staff.body?.message).toBe('Insufficient permissions: settings requires write access (you have none)');
    expect(scans.calls).toHaveLength(0);
    for (const actor of [ID.owner, ID.adminWrite]) {
      const res = await intelScan(actor);
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(201);
    }
    expect(scans.calls).toEqual([ID.biz, ID.biz]);
  });

  it.each([
    ['the owner', ID.owner],
    ['a STAFF revenue:write member', ID.staffWrite],
  ])("FID-C01 RED-BEFORE: another business's item through this business's path is 404 for %s, that item untouched", async (_label, actor) => {
    const otherBefore = await itemsText(ID.other);
    for (const [door, call] of [['resolve', resolveItem], ['dismiss', dismissItem]] as const) {
      const res = await call(actor, ID.otherItem);
      expect(res.status, `${door}: ${JSON.stringify(res.body)}`).toBe(404);
      expect(await itemsText(ID.other), door).toBe(otherBefore);
    }
  });

  it("FID-C02 pinned: the other business's owner is refused every door here", async () => {
    const before = await itemsText(ID.biz);
    for (const [door, res] of [
      ['finance scan', await financeScan(ID.otherOwner)],
      ['resolve', await resolveItem(ID.otherOwner)],
      ['dismiss', await dismissItem(ID.otherOwner)],
      ['intelligence scan', await intelScan(ID.otherOwner)],
    ] as const) {
      expect(res.status, `${door}: ${JSON.stringify(res.body)}`).toBe(403);
    }
    expect(await itemsText(ID.biz)).toBe(before);
    expect(revenueActions.calls).toHaveLength(0);
    expect(scans.calls).toHaveLength(0);
  });

  it('FID-C03 pinned: a SUPER_ADMIN who is not a member is refused the finance doors (D-46)', async () => {
    const before = await itemsText(ID.biz);
    for (const [door, res] of [
      ['finance scan', await financeScan(ID.superNon)],
      ['resolve', await resolveItem(ID.superNon)],
      ['dismiss', await dismissItem(ID.superNon)],
    ] as const) {
      expect(res.status, `${door}: ${JSON.stringify(res.body)}`).toBe(403);
    }
    expect(await itemsText(ID.biz)).toBe(before);
    expect(revenueActions.calls).toHaveLength(0);
  });
});
