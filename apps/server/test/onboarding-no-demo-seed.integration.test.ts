/**
 * P102 / V1-65 (DEMO-PREVIEW, owner rulings D-157 & B3, BUG-094) —
 * Onboarding completion writes ZERO demo rows into a live tenant, and legacy
 * demo invoices (`DEMO-%` on a `source = 'demo'` contact) never consume the
 * FREE monthly invoice allowance. REAL database.
 *
 * WHY:
 *   1. D-157: `POST /onboarding-concierge/businesses/:businessId/complete`
 *      must finish onboarding cleanly (`demoData: null`) without seeding a
 *      fake Contact, Invoice, FinancialTransaction, or LedgerEntry into the
 *      user's live workspace. (`POST .../seed-demo` and `DemoDataSeederService`
 *      remain intact for explicit owner invocation.)
 *   2. BUG-094: Existing FREE businesses that already hold a legacy demo
 *      invoice (`DEMO-%` linked to a `source = 'demo'` contact, even if that
 *      contact was later soft-deleted) must not lose 1 of their 5 monthly
 *      invoices to it. Anti-forgery: a `DEMO-%` invoice on a non-demo contact
 *      (`source = 'manual'`) and a real `INV-...` invoice on a `source = 'demo'`
 *      contact MUST both still count toward the monthly cap.
 *
 * FIXTURES: prefix `v65c_` (registered in test/helpers/fixture-prefixes.json).
 * Every row is hard-deleted by raw SQL in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v65c_';
const ID = {
  owner: `${P}owner`,
  admin: `${P}admin`,
  staff: `${P}staff`,
  outsider: `${P}outsider`,
  bizComplete: `${P}bizComp`,
  bizAuth: `${P}bizAuth`,
  bizOther: `${P}bizOth`,
  bizFree: `${P}bizFree`,
  bizSoftDel: `${P}bizSoft`,
  bizForge1: `${P}bizFrg1`,
  bizForge2: `${P}bizFrg2`,
  cDemoFree: `${P}cDemFre`,
  cRealFree: `${P}cRelFre`,
  cDemoSoft: `${P}cDemSft`,
  cManualForge: `${P}cManFrg`,
  cDemoForge: `${P}cDemFrg`,
};

const COMPLETABLE = { currency: 'TTD', timezone: 'America/Port_of_Spain' };
const emailOf = (id: string) => `${id}@test.local`;

let db: any;
let app: any;
let subscriptionsService: any;

async function cleanup() {
  const statements = [
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM subscriptions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ];
  for (const sql of statements) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

async function businessRowFootprint(businessId: string) {
  const [contacts, invoices, financialTransactions, ledgerEntries, activities] = await Promise.all([
    db.contact.count({ where: { businessId } }),
    db.invoice.count({ where: { businessId } }),
    db.financialTransaction.count({ where: { businessId } }),
    db.ledgerEntry.count({ where: { businessId } }),
    db.teamActivityLog.findMany({ where: { businessId } }),
  ]);
  return { contacts, invoices, financialTransactions, ledgerEntries, activities };
}

function postComplete(actor: string | null, businessId: string) {
  const req = request(app.getHttpServer()).post(`/onboarding-concierge/businesses/${businessId}/complete`);
  return actor ? req.set('x-test-user', actor) : req;
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { OnboardingConciergeController } = await import('../src/modules/onboarding-concierge/onboarding-concierge.controller');
  const { OnboardingConciergeService } = await import('../src/modules/onboarding-concierge/onboarding-concierge.service');
  const { OnboardingStateService } = await import('../src/modules/onboarding-concierge/onboarding-state.service');
  const { DemoDataSeederService } = await import('../src/modules/onboarding-concierge/demo-data-seeder.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');

  const moduleRef = await Test.createTestingModule({
    controllers: [OnboardingConciergeController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      OnboardingConciergeService,
      DemoDataSeederService,
      SubscriptionsService,
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
      { provide: AiUsageService, useValue: {} },
      { provide: CatalogService, useValue: {} },
      { provide: OnboardingStateService, useValue: {} },
      {
        provide: BlueprintService,
        useValue: {
          calculateGenomeIntegrity: async () => {
            throw new Error('no genome on this path');
          },
          getBlueprint: async () => null,
        },
      },
    ],
  }).compile();

  subscriptionsService = moduleRef.get(SubscriptionsService);

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
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

  await cleanup();

  for (const id of [ID.owner, ID.admin, ID.staff, ID.outsider]) {
    await db.user.create({
      data: { id, email: emailOf(id), name: id, role: 'USER' },
    });
  }

  for (const [id, ownerId] of [
    [ID.bizComplete, ID.owner],
    [ID.bizAuth, ID.owner],
    [ID.bizOther, ID.outsider],
    [ID.bizFree, ID.owner],
    [ID.bizSoftDel, ID.owner],
    [ID.bizForge1, ID.owner],
    [ID.bizForge2, ID.owner],
  ] as const) {
    await db.business.create({
      data: { id, name: `${id}-name`, ownerId, ...COMPLETABLE },
    });
  }

  const m = (userId: string, businessId: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({
      data: {
        id: `${P}m_${userId.slice(P.length)}_${businessId.slice(P.length)}`,
        userId,
        businessId,
        role,
        permissionScopes: permissionScopes ?? undefined,
      },
    });

  await m(ID.owner, ID.bizComplete, 'OWNER');
  await m(ID.owner, ID.bizAuth, 'OWNER');
  await m(ID.admin, ID.bizAuth, 'ADMIN');
  await m(ID.staff, ID.bizAuth, 'STAFF', { settings: 'write', crm: 'write', revenue: 'write' });
  await m(ID.outsider, ID.bizOther, 'OWNER');
  await m(ID.owner, ID.bizFree, 'OWNER');
  await m(ID.owner, ID.bizSoftDel, 'OWNER');
  await m(ID.owner, ID.bizForge1, 'OWNER');
  await m(ID.owner, ID.bizForge2, 'OWNER');

  // Seed legacy demo contact + legacy DEMO-ABC123 invoice on FREE business bizFree
  await db.contact.create({
    data: {
      id: ID.cDemoFree,
      businessId: ID.bizFree,
      firstName: 'Sample',
      lastName: 'Client',
      email: emailOf(ID.cDemoFree),
      emailNormalized: emailOf(ID.cDemoFree),
      source: 'demo',
    },
  });
  await db.contact.create({
    data: {
      id: ID.cRealFree,
      businessId: ID.bizFree,
      firstName: 'Real',
      lastName: 'Customer',
      email: emailOf(ID.cRealFree),
      emailNormalized: emailOf(ID.cRealFree),
      source: 'manual',
    },
  });
  await db.invoice.create({
    data: {
      id: `${P}inv_demo_free`,
      businessId: ID.bizFree,
      contactId: ID.cDemoFree,
      invoiceNumber: 'DEMO-ABC123',
      status: 'DRAFT',
      subtotal: 150,
      total: 150,
      currency: 'TTD',
    },
  });

  // Seed soft-deleted legacy demo contact + live DEMO-DEL001 invoice on bizSoftDel
  await db.contact.create({
    data: {
      id: ID.cDemoSoft,
      businessId: ID.bizSoftDel,
      firstName: 'Deleted',
      lastName: 'Demo',
      email: emailOf(ID.cDemoSoft),
      emailNormalized: emailOf(ID.cDemoSoft),
      source: 'demo',
      deletedAt: new Date(),
    },
  });
  await db.invoice.create({
    data: {
      id: `${P}inv_demo_soft`,
      businessId: ID.bizSoftDel,
      contactId: ID.cDemoSoft,
      invoiceNumber: 'DEMO-DEL001',
      status: 'DRAFT',
      subtotal: 150,
      total: 150,
      currency: 'TTD',
    },
  });

  // Anti-forgery fixture 1: DEMO-FAKE01 invoice on a manual (non-demo) contact
  await db.contact.create({
    data: {
      id: ID.cManualForge,
      businessId: ID.bizForge1,
      firstName: 'Manual',
      lastName: 'Buyer',
      email: emailOf(ID.cManualForge),
      emailNormalized: emailOf(ID.cManualForge),
      source: 'manual',
    },
  });
  await db.invoice.create({
    data: {
      id: `${P}inv_forge_manual`,
      businessId: ID.bizForge1,
      contactId: ID.cManualForge,
      invoiceNumber: 'DEMO-FAKE01',
      status: 'DRAFT',
      subtotal: 200,
      total: 200,
      currency: 'TTD',
    },
  });

  // Anti-forgery fixture 2: real INV-... invoice on a source='demo' contact
  await db.contact.create({
    data: {
      id: ID.cDemoForge,
      businessId: ID.bizForge2,
      firstName: 'Sample',
      lastName: 'Reused',
      email: emailOf(ID.cDemoForge),
      emailNormalized: emailOf(ID.cDemoForge),
      source: 'demo',
    },
  });
  await db.invoice.create({
    data: {
      id: `${P}inv_forge_demo_c`,
      businessId: ID.bizForge2,
      contactId: ID.cDemoForge,
      invoiceNumber: `INV-${P}0001`,
      status: 'SENT',
      subtotal: 250,
      total: 250,
      currency: 'TTD',
    },
  });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('DEMO-PREVIEW (P102, D-157): onboarding completion writes zero demo rows', () => {
  it('[DP-01] RED-BEFORE: owner POST /complete returns 201 with demoData: null and writes zero Contact, Invoice, FinancialTransaction, and LedgerEntry rows', async () => {
    const res = await postComplete(ID.owner, ID.bizComplete);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ complete: true, demoData: null });

    const biz = await db.business.findUnique({
      where: { id: ID.bizComplete },
      select: { onboardingComplete: true, onboardingCompletedAt: true, onboardingStep: true },
    });
    expect(biz?.onboardingComplete).toBe(true);
    expect(biz?.onboardingCompletedAt).toBeInstanceOf(Date);
    expect(biz?.onboardingStep).toBe('complete');

    const footprint = await businessRowFootprint(ID.bizComplete);
    expect(footprint.contacts, 'zero Contact rows written').toBe(0);
    expect(footprint.invoices, 'zero Invoice rows written').toBe(0);
    expect(footprint.financialTransactions, 'zero FinancialTransaction rows written').toBe(0);
    expect(footprint.ledgerEntries, 'zero LedgerEntry rows written').toBe(0);

    const completed = footprint.activities.filter((a: any) => a.action === 'onboarding_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0].userId).toBe(ID.owner);
    expect(completed[0].meta).toEqual({
      demoContactId: null,
      demoInvoiceId: null,
      demoInvoiceNumber: null,
    });

    // Replay remains idempotent and writes nothing more
    const replay = await postComplete(ID.owner, ID.bizComplete);
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(replay.body).toEqual({ complete: true, alreadyComplete: true });
    const afterReplay = await businessRowFootprint(ID.bizComplete);
    expect(afterReplay.contacts).toBe(0);
    expect(afterReplay.invoices).toBe(0);
    expect(afterReplay.financialTransactions).toBe(0);
    expect(afterReplay.ledgerEntries).toBe(0);
  });
});

describe('DEMO-PREVIEW (P102, BUG-094): legacy demo invoices are excluded from monthly cap', () => {
  it('[DP-02] RED-BEFORE: FREE business with 1 legacy demo contact + 1 DEMO-ABC123 invoice reports current: 0, allows creating full FREE monthly cap of real invoices, then refuses (cap + 1)', async () => {
    const initial = await subscriptionsService.checkLimit(ID.bizFree, 'invoices');
    expect(initial).toMatchObject({ allowed: true, current: 0, upgradeTo: 'FLOW' });
    const cap = initial.limit;
    expect(cap).toBeGreaterThan(0);

    const dashboardBefore = await subscriptionsService.getBillingDashboard(ID.bizFree);
    const invUsageBefore = dashboardBefore.resourceUsage.find((r: any) => r.key === 'invoices');
    expect(invUsageBefore?.current).toBe(0);

    // Create the full FREE monthly cap of real invoices (1..cap)
    for (let i = 1; i <= cap; i += 1) {
      const preCheck = await subscriptionsService.checkLimit(ID.bizFree, 'invoices');
      expect(preCheck.allowed, `invoice ${i}/${cap} must be allowed`).toBe(true);
      expect(preCheck.current).toBe(i - 1);

      await db.invoice.create({
        data: {
          id: `${P}inv_real_${i}`,
          businessId: ID.bizFree,
          contactId: ID.cRealFree,
          invoiceNumber: `INV-${P}REAL-${i}`,
          status: 'SENT',
          subtotal: 100 * i,
          total: 100 * i,
          currency: 'TTD',
        },
      });
    }

    // Now at cap (5 real invoices + 1 legacy demo invoice in DB) -> cap + 1 is refused
    const atCap = await subscriptionsService.checkLimit(ID.bizFree, 'invoices');
    expect(atCap).toEqual({ allowed: false, limit: cap, current: cap, upgradeTo: 'FLOW' });

    const totalRows = await db.invoice.count({ where: { businessId: ID.bizFree, deletedAt: null } });
    expect(totalRows).toBe(cap + 1);
  });

  it('[DP-03] RED-BEFORE: legacy DEMO-% invoice remains excluded even when its source=demo contact was soft-deleted (deletedAt != null)', async () => {
    const rows = await db.$queryRaw<Array<{ source: string | null; deleted_at: Date | null }>>`
      SELECT source, deleted_at FROM contacts WHERE id = ${ID.cDemoSoft}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('demo');
    expect(rows[0].deleted_at).toBeInstanceOf(Date);

    const check = await subscriptionsService.checkLimit(ID.bizSoftDel, 'invoices');
    expect(check).toMatchObject({ allowed: true, current: 0, upgradeTo: 'FLOW' });
  });
});

describe('DEMO-PREVIEW (P102): anti-forgery controls on invoice cap', () => {
  it('[DP-04] control: DEMO-FAKE01 invoice on a non-demo (source=manual) contact IS counted toward the monthly cap (current: 1)', async () => {
    const check = await subscriptionsService.checkLimit(ID.bizForge1, 'invoices');
    expect(check).toMatchObject({ allowed: true, current: 1, upgradeTo: 'FLOW' });
  });

  it('[DP-05] control: real INV-... invoice on a source=demo contact IS counted toward the monthly cap (current: 1)', async () => {
    const check = await subscriptionsService.checkLimit(ID.bizForge2, 'invoices');
    expect(check).toMatchObject({ allowed: true, current: 1, upgradeTo: 'FLOW' });
  });
});

describe('DEMO-PREVIEW (P102): tenant isolation and auth controls on /complete', () => {
  it('[DP-06] control: unauthenticated, cross-tenant outsider, ADMIN, and STAFF callers are refused on /complete and write zero rows', async () => {
    const unauth = await postComplete(null, ID.bizAuth);
    expect(unauth.status, JSON.stringify(unauth.body)).toBe(401);

    const outsider = await postComplete(ID.outsider, ID.bizAuth);
    expect(outsider.status, JSON.stringify(outsider.body)).toBe(403);

    const admin = await postComplete(ID.admin, ID.bizAuth);
    expect(admin.status, JSON.stringify(admin.body)).toBe(403);
    expect(admin.body?.code).toBe('ONBOARDING_COMPLETE_FORBIDDEN');

    const staff = await postComplete(ID.staff, ID.bizAuth);
    expect(staff.status, JSON.stringify(staff.body)).toBe(403);
    expect(staff.body?.code).toBe('ONBOARDING_COMPLETE_FORBIDDEN');

    const biz = await db.business.findUnique({
      where: { id: ID.bizAuth },
      select: { onboardingComplete: true, onboardingCompletedAt: true },
    });
    expect(biz).toEqual({ onboardingComplete: false, onboardingCompletedAt: null });

    const footprint = await businessRowFootprint(ID.bizAuth);
    expect(footprint.contacts).toBe(0);
    expect(footprint.invoices).toBe(0);
    expect(footprint.financialTransactions).toBe(0);
    expect(footprint.ledgerEntries).toBe(0);
    expect(footprint.activities).toEqual([]);
  });
});
