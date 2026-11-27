/**
 * P79 — V1-65 (TODAY-AGGREGATE, P0, BUG-074/BUG-125 + BUG-010 server half,
 * Journeys A/I/D/C4) — One per-member-scoped server read for Today:
 * `GET /business-command-center/businesses/:businessId/today` returning four
 * blocks (`needsYou`, `today`, `pulse`, `getSetUp`) with `pulse` gated on
 * `revenue:read` (D-57) and equal to Money > Overview (`FinanceOverviewService`
 * + `SafeToSpendService`), plus BUG-010 nudge hrefs pointing at real setup
 * pages.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v65b_` prefix and is
 * hard-deleted by raw SQL (`sqlLikePrefix`) in `beforeAll` and `afterAll`.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import { todaySeedFixtures } from './helpers/today-seed-time.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v65b_';
const ID = {
  ownerA: `${P}ownerA`,
  staffBookings: `${P}staffBookings`,
  ownerFresh: `${P}ownerFresh`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizFresh: `${P}bizFresh`,
  bizB: `${P}bizB`,
  contactMaria: `${P}contactMaria`,
  contactB: `${P}contactB`,
  serviceA: `${P}serviceA`,
  productA: `${P}productA`,
  bookingToday: `${P}bookingToday`,
  invOverdue: `${P}invOverdue`,
  invDueToday: `${P}invDueToday`,
  claimIntent: `${P}claimIntent`,
  quoteAccepted: `${P}quoteAccepted`,
  quoteConvertedInv: `${P}quoteConvertedInv`,
  taskDueToday: `${P}taskDueToday`,
  orderToFulfil: `${P}orderToFulfil`,
  coaCash: `${P}coaCash`,
  finAccCash: `${P}finAccCash`,
  coaExpense: `${P}coaExpense`,
  expenseBill: `${P}expenseBill`,
  proposal1: `${P}prop1`,
  proposal2: `${P}prop2`,
  proposal3: `${P}prop3`,
  proposal4: `${P}prop4`,
  proposal5: `${P}prop5`,
};

let db: any;
let app: any;
let financeOverviewSvc: any;
let safeToSpendSvc: any;
let onboardingConciergeSvc: any;

function getToday(businessId: string, actorId?: string) {
  const r = request(app.getHttpServer()).get(`/business-command-center/businesses/${businessId}/today`);
  return actorId ? r.set('x-test-user', actorId) : r;
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_plan_steps WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM approval_steps WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM approval_requests WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_action_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_order_items WHERE order_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quote_items WHERE quote_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_shares WHERE contact_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
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

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { RedisService } = await import('../src/core/redis/redis.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CashPositionService } = await import('../src/modules/finance/cash-position.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { FinancialAccountSeederService } = await import('../src/modules/finance/financial-account-seeder.service');
  const { ReceivablesService } = await import('../src/modules/finance/receivables.service');
  const { FinanceOverviewService } = await import('../src/modules/finance/finance-overview.service');
  const { SafeToSpendService } = await import('../src/modules/finance/safe-to-spend.service');
  const { ReadyToSendService } = await import('../src/modules/commerce/ready-to-send.service');
  const { KeyActionProposalService } = await import('../src/modules/key-autonomy/key-action-proposal.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { OnboardingConciergeService } = await import('../src/modules/onboarding-concierge/onboarding-concierge.service');
  const { DemoDataSeederService } = await import('../src/modules/onboarding-concierge/demo-data-seeder.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { TodayService } = await import('../src/modules/business-command-center/today.service');
  const { TodayController } = await import('../src/modules/business-command-center/today.controller');

  Logger.overrideLogger(false);

  const noopRedis = {
    get: async () => null,
    set: async () => undefined,
    del: async () => undefined,
    getJson: async () => null,
    setJson: async () => undefined,
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [TodayController],
    providers: [
      PrismaService,
      { provide: RedisService, useValue: noopRedis },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CashPositionService,
      ChartOfAccountsSeederService,
      FinancialAccountSeederService,
      ReceivablesService,
      FinanceOverviewService,
      SafeToSpendService,
      ReadyToSendService,
      {
        provide: KeyActionProposalService,
        useValue: {
          listForReader: async (businessId: string, opts: { status?: string }, reader: { id?: string; role?: string } | null) => {
            if (!reader?.id) return [];
            const mem = await db.membership.findUnique({
              where: { userId_businessId: { userId: reader.id, businessId } },
              select: { role: true, permissionScopes: true },
            });
            const scopes = (mem?.permissionScopes ?? {}) as Record<string, string>;
            const canRev = mem?.role === 'OWNER' || mem?.role === 'ADMIN' || scopes.revenue === 'read' || scopes.revenue === 'write' || scopes.revenue === 'admin';
            const rows = await db.keyActionProposal.findMany({
              where: { businessId, ...(opts.status ? { status: opts.status } : {}) },
              orderBy: { createdAt: 'desc' },
            });
            return canRev ? rows : rows.filter((r: any) => !['finance', 'commerce', 'revenue'].includes(String(r.module || '').toLowerCase()));
          },
        },
      },
      {
        provide: CommerceService,
        useValue: {
          listPaymentClaims: async (businessId: string) => {
            const rows = await db.payment.findMany({
              where: {
                businessId,
                status: 'PENDING',
                provider: { in: ['bank_transfer', 'cash', 'check', 'other', 'google_pay'] },
                providerPaymentId: { startsWith: 'manual_' },
                invoice: { businessId, deletedAt: null, status: { in: ['SENT', 'OVERDUE', 'PARTIALLY_PAID', 'PARTIALLY_CREDITED'] } },
              },
              include: { invoice: { include: { contact: { select: { id: true, firstName: true, lastName: true } } } } },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            });
            return rows.map((r: any) => ({
              id: r.id,
              invoiceId: r.invoiceId,
              invoiceNumber: r.invoice.invoiceNumber,
              method: r.method ?? r.provider,
              amount: Number(r.amount || r.invoice.total),
              declaredAmount: Number(r.amount || 0),
              remaining: Number(r.invoice.total),
              currency: r.currency || r.invoice.currency || 'TTD',
              contactId: r.invoice.contactId ?? null,
              customerName: [r.invoice.contact?.firstName, r.invoice.contact?.lastName].filter(Boolean).join(' ') || null,
              reference: r.reference ?? null,
              createdAt: r.createdAt.toISOString(),
            }));
          },
        },
      },
      { provide: EventEmitter2, useValue: { emit: () => true } },
      { provide: BlueprintService, useValue: { getBlueprint: async () => null } },
      { provide: CatalogService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      { provide: DemoDataSeederService, useValue: {} },
      OnboardingConciergeService,
      TodayService,
    ],
  }).compile();

  financeOverviewSvc = moduleRef.get(FinanceOverviewService);
  safeToSpendSvc = moduleRef.get(SafeToSpendService);
  onboardingConciergeSvc = moduleRef.get(OnboardingConciergeService);

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();

  // Seed users & businesses
  for (const [userId, bizId, email, bizName, extraBiz] of [
    [
      ID.ownerA,
      ID.bizA,
      `${P}ownerA@example.test`,
      'Maria Studio',
      {
        slug: `${P}maria-studio`,
        storeEnabled: true,
        timezone: 'America/Port_of_Spain',
        businessHours: { mon: { open: '09:00', close: '17:00', closed: false } },
        metaData: { paymentConfig: { bankTransfer: { enabled: true } } },
      },
    ],
    [
      ID.ownerFresh,
      ID.bizFresh,
      `${P}fresh@example.test`,
      'Fresh Co',
      { slug: null, storeEnabled: false, businessHours: null, metaData: {} },
    ],
    [
      ID.ownerB,
      ID.bizB,
      `${P}ownerB@example.test`,
      'Other Tenant B',
      { slug: `${P}other-b`, storeEnabled: true },
    ],
  ] as const) {
    await db.user.create({ data: { id: userId, email, role: 'USER' } });
    await db.business.create({ data: { id: bizId, name: bizName, ownerId: userId, currency: 'TTD', ...extraBiz } });
    await db.membership.create({ data: { userId, businessId: bizId, role: 'OWNER' } });
  }

  // Bookings-only STAFF in bizA (explicit map: bookings read ONLY -> no revenue, no crm, no storefront, no operations)
  await db.user.create({ data: { id: ID.staffBookings, email: `${P}staff@example.test`, role: 'USER' } });
  await db.membership.create({
    data: {
      userId: ID.staffBookings,
      businessId: ID.bizA,
      role: 'STAFF',
      permissionScopes: { bookings: 'read' },
    },
  });

  // Contacts
  await db.contact.create({
    data: {
      id: ID.contactMaria,
      businessId: ID.bizA,
      firstName: 'Maria',
      lastName: 'Lopez',
      email: `${P}maria@example.test`,
      phone: '+18685550123',
      status: 'CLIENT',
    },
  });
  await db.contact.create({
    data: {
      id: ID.contactB,
      businessId: ID.bizB,
      firstName: 'TenantB',
      lastName: 'Client',
      email: `${P}tb@example.test`,
      status: 'CLIENT',
    },
  });

  // Service & Product in bizA
  await db.service.create({
    data: { id: ID.serviceA, businessId: ID.bizA, name: 'Consultation', duration: 60, price: 300 },
  });
  await db.product.create({
    data: { id: ID.productA, businessId: ID.bizA, name: 'Starter Kit', price: 250, currency: 'TTD' },
  });

  // Ledger cash account in bizA (TTD 5000 opening balance)
  await db.chartOfAccount.create({
    data: { id: ID.coaCash, businessId: ID.bizA, code: '1010', name: 'Main Bank', type: 'ASSET', subtype: 'BANK' },
  });
  await db.financialAccount.create({
    data: {
      id: ID.finAccCash,
      businessId: ID.bizA,
      name: 'Main Bank',
      type: 'BANK',
      currency: 'TTD',
      openingBalance: 5000,
      currentBalance: 5000,
      chartOfAccountId: ID.coaCash,
    },
  });

  const now = new Date();
  // Seed today's fixtures anchored to bizA's business timezone (America/Port_of_Spain)
  // so bookings, due-today invoices, and tasks stay strictly inside TodayService's
  // [dayStart, dayEnd] window at every hour of the 24-hour UTC clock (P203).
  const { bookingStart, bookingEnd, dueToday, yesterday } = todaySeedFixtures(now, 'America/Port_of_Spain');

  // Today's booking
  await db.booking.create({
    data: {
      id: ID.bookingToday,
      businessId: ID.bizA,
      contactId: ID.contactMaria,
      serviceId: ID.serviceA,
      startTime: bookingStart,
      endTime: bookingEnd,
      status: 'CONFIRMED',
    },
  });

  // Overdue invoice + due-today invoice + bank-transfer claim on invOverdue
  await db.invoice.create({
    data: {
      id: ID.invOverdue,
      businessId: ID.bizA,
      contactId: ID.contactMaria,
      invoiceNumber: `${P}INV-001`,
      status: 'OVERDUE',
      subtotal: 1200,
      total: 1200,
      currency: 'TTD',
      issueDate: yesterday,
      dueDate: yesterday,
    },
  });
  await db.invoice.create({
    data: {
      id: ID.invDueToday,
      businessId: ID.bizA,
      contactId: ID.contactMaria,
      invoiceNumber: `${P}INV-002`,
      status: 'SENT',
      subtotal: 800,
      total: 800,
      currency: 'TTD',
      issueDate: yesterday,
      dueDate: dueToday,
    },
  });
  await db.payment.create({
    data: {
      id: ID.claimIntent,
      businessId: ID.bizA,
      invoiceId: ID.invOverdue,
      amount: 1200,
      currency: 'TTD',
      status: 'PENDING',
      provider: 'bank_transfer',
      method: 'bank_transfer',
      providerPaymentId: `manual_${ID.invOverdue}_intent_${P}abc123`,
      reference: `Intent: ${P}INV-001`,
    },
  });

  // Accepted unconverted quote (Journey D)
  await db.quote.create({
    data: {
      id: ID.quoteAccepted,
      businessId: ID.bizA,
      contactId: ID.contactMaria,
      quoteNumber: 'Q-0012',
      status: 'ACCEPTED',
      subtotal: 650,
      total: 650,
      currency: 'TTD',
      acceptedAt: dueToday,
    },
  });

  // Contact task due today
  await db.contactTask.create({
    data: {
      id: ID.taskDueToday,
      businessId: ID.bizA,
      contactId: ID.contactMaria,
      title: 'Follow up with Maria',
      status: 'OPEN',
      dueDate: dueToday,
    },
  });

  // Order to fulfil
  await db.marketplaceOrder.create({
    data: {
      id: ID.orderToFulfil,
      businessId: ID.bizA,
      orderNumber: `${P}ORD-100`,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      customerName: 'Maria Lopez',
      customerEmail: `${P}maria@example.test`,
      subtotal: 250,
      total: 250,
      currency: 'TTD',
    },
  });

  // Pending KEY proposals (5 financial/ops proposals -> combined with claim + accepted quote > 5 for max-5 cap test)
  for (const [idx, propId] of [ID.proposal1, ID.proposal2, ID.proposal3, ID.proposal4, ID.proposal5].entries()) {
    await db.keyActionProposal.create({
      data: {
        id: propId,
        businessId: ID.bizA,
        sourceType: 'PROACTIVE',
        actionType: 'EXECUTE_TOOL',
        title: `Proposal ${idx + 1}`,
        description: `Pending KEY action ${idx + 1}`,
        toolName: 'commerce_send_invoice',
        module: 'commerce',
        status: 'PENDING',
        riskLevel: 'MEDIUM',
        payload: {},
      },
    });
  }
});

afterAll(async () => {
  await cleanup();
  await app?.close();
});

describe('P79 — V1-65 (TODAY-AGGREGATE, P0): four-block per-member Today read', () => {
  it('[TD-01] RED-BEFORE (owner): returns four blocks, Pulse equals Money > Overview + SafeToSpend, max 5 Needs you items with full totalCount, and customer contactId links', async () => {
    const res = await getToday(ID.bizA, ID.ownerA).expect(200);
    const overview = await financeOverviewSvc.getOverview(ID.bizA);
    const sts = await safeToSpendSvc.calculate(ID.bizA);

    const body = res.body;
    expect(body.businessId).toBe(ID.bizA);

    // Block 1: Needs you (capped at 5, totalCount reflects all items)
    expect(body.needsYou).toBeDefined();
    expect(body.needsYou.items.length).toBeLessThanOrEqual(5);
    expect(body.needsYou.items.length).toBe(5);
    expect(body.needsYou.totalCount).toBeGreaterThanOrEqual(7); // 1 claim + 1 accepted quote + 5 proposals
    expect(body.needsYou.items.some((i: any) => i.kind === 'CLAIM' && i.sourceId === ID.claimIntent)).toBe(true);
    expect(
      body.needsYou.items.some(
        (i: any) =>
          i.kind === 'ACCEPTED_QUOTE' &&
          i.sourceId === ID.quoteAccepted &&
          i.contactId === ID.contactMaria &&
          String(i.title).includes('Q-0012'),
      ),
    ).toBe(true);

    // Block 2: Today (bookings with names, overdue & due invoices with contactId, tasks, orders, accepted quotes, reminders)
    expect(body.today.bookings.some((b: any) => b.id === ID.bookingToday && b.customerName === 'Maria Lopez' && b.contactId === ID.contactMaria)).toBe(true);
    expect(body.today.invoices.some((i: any) => i.id === ID.invOverdue && i.isOverdue === true && i.contactId === ID.contactMaria)).toBe(true);
    expect(body.today.invoices.some((i: any) => i.id === ID.invDueToday && i.contactId === ID.contactMaria)).toBe(true);
    expect(body.today.acceptedQuotes.some((q: any) => q.id === ID.quoteAccepted && q.quoteNumber === 'Q-0012' && q.contactId === ID.contactMaria)).toBe(true);
    expect(body.today.tasks.some((t: any) => t.id === ID.taskDueToday && t.contactId === ID.contactMaria)).toBe(true);
    expect(body.today.orders.some((o: any) => o.id === ID.orderToFulfil)).toBe(true);
    expect(Array.isArray(body.today.reminders)).toBe(true);

    // Block 3: Pulse equals Money > Overview + SafeToSpend
    expect(body.pulseStatus).toBe('OK');
    expect(body.pulse).not.toBeNull();
    expect(body.pulse.cash).toBe(overview.cashBalance);
    expect(body.pulse.owedToYou).toBe(overview.outstandingInvoices);
    expect(body.pulse.youOwe).toBe(overview.billsDue);
    expect(body.pulse.monthProfit).toBe(overview.netProfitThisMonth);
    expect(body.pulse.safeToSpend).toBe(sts.safeToSpend);
    expect(body.pulse.currency).toBe(overview.currency);

    // Block 4: Get set up (all 4 configured for bizA, real hrefs, no percentage/riskCount)
    expect(body.getSetUp.steps).toHaveLength(4);
    expect(body.getSetUp.complete).toBe(true);
    expect(body.getSetUp).not.toHaveProperty('percentage');
    expect(body).not.toHaveProperty('riskCount');
    for (const step of body.getSetUp.steps) {
      expect(step.done).toBe(true);
      expect(step.href).not.toContain('/app/onboarding');
    }
  });

  it('[TD-02] RED-BEFORE (D-96 / D-57): STAFF with bookings-only scope receives bookings with names, NO Pulse (null/RESTRICTED), NO invoices, NO claims, NO quotes, NO orders, NO financial proposals', async () => {
    const res = await getToday(ID.bizA, ID.staffBookings).expect(200);
    const body = res.body;

    // D-57: no revenue:read -> pulse is strictly null
    expect(body.pulse).toBeNull();
    expect(body.pulseStatus).toBe('RESTRICTED');

    // Bookings visible with customer name
    expect(body.today.bookings.some((b: any) => b.id === ID.bookingToday && b.customerName === 'Maria Lopez')).toBe(true);

    // Revenue / CRM / Storefront slices withheld
    expect(body.today.invoices).toEqual([]);
    expect(body.today.acceptedQuotes).toEqual([]);
    expect(body.today.tasks).toEqual([]);
    expect(body.today.orders).toEqual([]);

    // Needs you withholds claims, accepted quotes, and financial proposals
    expect(body.needsYou.items.some((i: any) => i.kind === 'CLAIM')).toBe(false);
    expect(body.needsYou.items.some((i: any) => i.kind === 'ACCEPTED_QUOTE')).toBe(false);
    expect(body.needsYou.items.some((i: any) => i.kind === 'KEY_PROPOSAL')).toBe(false);
  });

  it('[TD-03] RED-BEFORE (Journey D): converting an ACCEPTED quote removes it from Needs you and Today', async () => {
    await db.invoice.create({
      data: {
        id: ID.quoteConvertedInv,
        businessId: ID.bizA,
        contactId: ID.contactMaria,
        invoiceNumber: `${P}INV-Q12`,
        status: 'SENT',
        subtotal: 650,
        total: 650,
        currency: 'TTD',
        quoteId: ID.quoteAccepted,
      },
    });
    await db.quote.update({
      where: { id: ID.quoteAccepted },
      data: { status: 'CONVERTED', invoiceId: ID.quoteConvertedInv },
    });

    const res = await getToday(ID.bizA, ID.ownerA).expect(200);
    expect(res.body.needsYou.items.some((i: any) => i.sourceId === ID.quoteAccepted)).toBe(false);
    expect(res.body.today.acceptedQuotes.some((q: any) => q.id === ID.quoteAccepted)).toBe(false);
  });

  it('[TD-04] RED-BEFORE (fresh business + BUG-010 server nudge hrefs): Get set up ticks only when real rows exist, no percentages/risk count, no 3-day hide, and concierge nudges point at real pages', async () => {
    const freshRes = await getToday(ID.bizFresh, ID.ownerFresh).expect(200);
    expect(freshRes.body.getSetUp.complete).toBe(false);
    expect(freshRes.body.getSetUp).not.toHaveProperty('percentage');
    expect(freshRes.body).not.toHaveProperty('riskCount');
    expect(freshRes.body.getSetUp.steps.map((s: any) => [s.key, s.done])).toEqual([
      ['catalog', false],
      ['hours', false],
      ['payments', false],
      ['share_link', false],
    ]);

    // BUG-010 server half: onboarding concierge nudges point at real setup screens (never /app/onboarding?step=...)
    const nudges = await onboardingConciergeSvc.checkAndGenerateNudges(ID.bizFresh);
    expect(nudges.length).toBeGreaterThan(0);
    for (const nudge of nudges) {
      expect(nudge.ctaHref).not.toContain('/app/onboarding');
      expect(nudge.ctaHref.startsWith('/app/')).toBe(true);
    }

    // Even right after checkAndGenerateNudges ran, GET .../today still shows Get set up (no 3-day hide)
    const afterNudge = await getToday(ID.bizFresh, ID.ownerFresh).expect(200);
    expect(afterNudge.body.getSetUp.steps).toHaveLength(4);
    expect(afterNudge.body.getSetUp.complete).toBe(false);

    // Adding a product ticks ONLY catalog
    await db.product.create({
      data: { id: `${P}freshProd`, businessId: ID.bizFresh, name: 'First Item', price: 100, currency: 'TTD' },
    });
    const afterProd = await getToday(ID.bizFresh, ID.ownerFresh).expect(200);
    expect(afterProd.body.getSetUp.steps.map((s: any) => [s.key, s.done])).toEqual([
      ['catalog', true],
      ['hours', false],
      ['payments', false],
      ['share_link', false],
    ]);
  });

  it('[TD-05] RED-BEFORE (tenant isolation & auth): 401 unauthenticated, 403 cross-tenant, and bizB sees zero bizA data', async () => {
    await getToday(ID.bizA).expect(401);
    await getToday(ID.bizA, ID.ownerB).expect(403);

    const resB = await getToday(ID.bizB, ID.ownerB).expect(200);
    expect(resB.body.needsYou.items).toEqual([]);
    expect(resB.body.today.bookings).toEqual([]);
    expect(resB.body.today.invoices).toEqual([]);
    expect(resB.body.today.orders).toEqual([]);
    expect(resB.body.pulse.cash).toBe(0);
    expect(resB.body.pulse.owedToYou).toBe(0);
  });

  it('[TD-06] R1 security (M7 / D-63): PRIVATE and crm_view="owned" contacts are scrubbed on bookings and hidden on claims, invoices, and reminders', async () => {
    const staffOwnedId = `${P}staffOwned`;
    const privateContactId = `${P}contactPriv`;
    const privateBookingId = `${P}bookingPriv`;
    const privateInvoiceId = `${P}invPriv`;
    const privateClaimId = `${P}claimPriv`;

    await db.user.create({
      data: { id: staffOwnedId, email: `${P}staffowned@example.test`, name: 'Owned-Only Rep', role: 'USER' },
    });
    await db.membership.create({
      data: {
        id: `${P}memOwned`,
        userId: staffOwnedId,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { bookings: 'read', revenue: 'write', crm: 'read', crm_view: 'owned' },
      },
    });
    await db.contact.create({
      data: {
        id: privateContactId,
        businessId: ID.bizA,
        firstName: 'Secret',
        lastName: 'VIP',
        email: `${P}vip@example.test`,
        phone: '+18685559999',
        visibility: 'PRIVATE',
        ownerId: ID.ownerA,
      },
    });
    const { privateBookingStart, privateBookingEnd, yesterday: td06Yesterday } = todaySeedFixtures(
      new Date(),
      'America/Port_of_Spain',
    );
    await db.booking.create({
      data: {
        id: privateBookingId,
        businessId: ID.bizA,
        contactId: privateContactId,
        serviceId: ID.serviceA,
        startTime: privateBookingStart,
        endTime: privateBookingEnd,
        status: 'CONFIRMED',
      },
    });
    await db.invoice.create({
      data: {
        id: privateInvoiceId,
        businessId: ID.bizA,
        contactId: privateContactId,
        invoiceNumber: `${P}INV-VIP`,
        status: 'OVERDUE',
        dueDate: td06Yesterday,
        subtotal: 900,
        total: 900,
        currency: 'TTD',
      },
    });
    await db.payment.create({
      data: {
        id: privateClaimId,
        businessId: ID.bizA,
        invoiceId: privateInvoiceId,
        amount: 900,
        currency: 'TTD',
        status: 'PENDING',
        provider: 'bank_transfer',
        method: 'bank_transfer',
        providerPaymentId: `manual_${P}vipclaim`,
      },
    });

    // Bookings-only STAFF (crm: 'none'): keeps booking slot for PRIVATE contact, scrubs customerName & contactId
    const staffBookRes = await getToday(ID.bizA, ID.staffBookings).expect(200);
    const privBookingForStaff = staffBookRes.body.today.bookings.find((b: any) => b.id === privateBookingId);
    expect(privBookingForStaff).toBeDefined();
    expect(privBookingForStaff.customerName).toBeNull();
    expect(privBookingForStaff.contactId).toBeNull();

    // STAFF with crm_view='owned' (owns neither Maria nor Secret VIP):
    // - bookings scrub customerName & contactId for out-of-book contacts
    // - claims, invoices, and reminders drop out-of-book & PRIVATE contacts completely
    const ownedRes = await getToday(ID.bizA, staffOwnedId).expect(200);
    for (const b of ownedRes.body.today.bookings) {
      expect(b.customerName).toBeNull();
      expect(b.contactId).toBeNull();
    }
    expect(ownedRes.body.needsYou.items.some((i: any) => i.sourceId === privateClaimId || i.sourceId === ID.claimIntent)).toBe(false);
    expect(ownedRes.body.today.invoices.some((i: any) => i.id === privateInvoiceId || i.id === ID.invOverdue)).toBe(false);
    expect(
      ownedRes.body.today.reminders.some(
        (r: any) =>
          r.contactId === privateContactId ||
          r.contactId === ID.contactMaria ||
          r.id === privateInvoiceId ||
          r.id === privateBookingId ||
          r.id === ID.invOverdue,
      ),
    ).toBe(false);
  });

  it('[TD-07] R1 security (D-74 / D-57 / D-96 / D-234): STAFF sees no unassigned approvals, no other-member or financial plan steps, and storefront-only STAFF sees total: null on paid orders', async () => {
    const staffOpsId = `${P}staffOps`;
    const staffStoreId = `${P}staffStore`;
    const approvalId = `${P}apprExp`;
    const planId = `${P}planOwner`;
    const planStepId = `${P}stepFin`;

    await db.user.create({
      data: { id: staffOpsId, email: `${P}staffops@example.test`, name: 'Ops Staff', role: 'USER' },
    });
    await db.membership.create({
      data: {
        id: `${P}memOps`,
        userId: staffOpsId,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { operations: 'read' },
      },
    });
    await db.user.create({
      data: { id: staffStoreId, email: `${P}staffstore@example.test`, name: 'Store Staff', role: 'USER' },
    });
    await db.membership.create({
      data: {
        id: `${P}memStore`,
        userId: staffStoreId,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { storefront: 'read' },
      },
    });

    await db.approvalRequest.create({
      data: {
        id: approvalId,
        businessId: ID.bizA,
        requestType: 'EXPENSE',
        title: 'Approve Q4 Vendor Payout',
        status: 'pending',
        currentStep: 1,
        requesterId: ID.ownerA,
        payload: {},
        steps: {
          create: {
            id: `${P}apprStep1`,
            stepOrder: 1,
            approverId: ID.ownerA,
            status: 'pending',
          },
        },
      },
    });

    await db.aiPlan.create({
      data: {
        id: planId,
        businessId: ID.bizA,
        userId: ID.ownerA,
        objective: 'Send invoices',
        status: 'pending',
      },
    });
    await db.aiPlanStep.create({
      data: {
        id: planStepId,
        planId,
        order: 1,
        action: 'Send high-value invoice',
        module: null,
        toolName: 'commerce_send_invoice',
        requiresApproval: true,
        status: 'awaiting_approval',
      },
    });

    // Ops-only STAFF sees neither the OWNER's approval nor the OWNER's financial plan step
    const opsRes = await getToday(ID.bizA, staffOpsId).expect(200);
    expect(opsRes.body.needsYou.items.some((i: any) => i.sourceId === approvalId)).toBe(false);
    expect(opsRes.body.needsYou.items.some((i: any) => i.sourceId === planStepId)).toBe(false);
    expect(opsRes.body.pulse).toBeNull();

    // Storefront-only STAFF sees the order queue for fulfilment, with total withheld (null)
    const storeRes = await getToday(ID.bizA, staffStoreId).expect(200);
    expect(storeRes.body.pulse).toBeNull();
    expect(storeRes.body.pulseStatus).toBe('RESTRICTED');
    const order = storeRes.body.today.orders.find((o: any) => o.id === ID.orderToFulfil);
    expect(order).toBeDefined();
    expect(order.total).toBeNull();
  });

  it('[TD-08] R1 correctness: PaymentsTab flat metaData.bankTransferEnabled ticks payments step, KEY proposals use /actions/proposals/ endpoints, and hasMore reflects >5 items', async () => {
    // Update bizFresh with flat PaymentsTab key
    await db.business.update({
      where: { id: ID.bizFresh },
      data: { metaData: { bankTransferEnabled: true } },
    });
    const freshRes = await getToday(ID.bizFresh, ID.ownerFresh).expect(200);
    const paymentsStep = freshRes.body.getSetUp.steps.find((s: any) => s.key === 'payments');
    expect(paymentsStep?.done).toBe(true);

    // Owner on bizA has >5 needsYou items -> hasMore === true, and KEY proposal actions include /actions/proposals/
    const ownerRes = await getToday(ID.bizA, ID.ownerA).expect(200);
    expect(ownerRes.body.needsYou.totalCount).toBeGreaterThan(5);
    expect(ownerRes.body.needsYou.hasMore).toBe(true);
    const keyProposalItem = ownerRes.body.needsYou.items.find((i: any) => i.kind === 'KEY_PROPOSAL');
    expect(keyProposalItem).toBeDefined();
    expect(keyProposalItem.actions[0].endpoint).toContain(
      `/key-autonomy/businesses/${ID.bizA}/actions/proposals/${keyProposalItem.sourceId}/`,
    );
  });

  it('[TD-09] P203 (FU-TODAY-AGGREGATE-TZ-SEED): bookings seeded via todaySeedFixtures remain visible in Today during 02:00–04:00 UTC (22:00–24:00 America/Port_of_Spain)', async () => {
    const midnightBookingId = `${P}bookingMidnight`;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // Pin clock to 02:30 UTC (22:30 Port-of-Spain) — inside the 02:00–04:00 UTC window where now+2h crossed local midnight
      vi.setSystemTime(new Date('2026-11-26T02:30:00.000Z'));
      const { bookingStart, bookingEnd } = todaySeedFixtures(new Date(), 'America/Port_of_Spain');

      await db.booking.create({
        data: {
          id: midnightBookingId,
          businessId: ID.bizA,
          contactId: ID.contactMaria,
          serviceId: ID.serviceA,
          startTime: bookingStart,
          endTime: bookingEnd,
          status: 'CONFIRMED',
        },
      });

      const owner0230 = await getToday(ID.bizA, ID.ownerA).expect(200);
      expect(
        owner0230.body.today.bookings.some(
          (b: any) => b.id === midnightBookingId && b.customerName === 'Maria Lopez' && b.contactId === ID.contactMaria,
        ),
      ).toBe(true);

      const staff0230 = await getToday(ID.bizA, ID.staffBookings).expect(200);
      expect(
        staff0230.body.today.bookings.some((b: any) => b.id === midnightBookingId && b.customerName === 'Maria Lopez'),
      ).toBe(true);

      // Advance to 03:55 UTC (23:55 Port-of-Spain, 5 minutes before local midnight) — still visible for owner and staff
      vi.setSystemTime(new Date('2026-11-26T03:55:00.000Z'));
      const owner0355 = await getToday(ID.bizA, ID.ownerA).expect(200);
      expect(owner0355.body.today.bookings.some((b: any) => b.id === midnightBookingId)).toBe(true);

      const staff0355 = await getToday(ID.bizA, ID.staffBookings).expect(200);
      expect(staff0355.body.today.bookings.some((b: any) => b.id === midnightBookingId)).toBe(true);
    } finally {
      vi.useRealTimers();
      await db.$executeRaw`DELETE FROM bookings WHERE id = ${midnightBookingId}`;
    }
  });
});

