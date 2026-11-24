/**
 * V1-86 (FU-PENDING-OWED-SERVER; owner ruling D-256, 2026-11-22):
 * Every server owed figure counts PENDING invoices through the single shared
 * open-receivable status list (OPEN_RECEIVABLE_STATUSES / OPEN_RECEIVABLE_STATUS_LIST
 * in commerce-stats.service.ts). DRAFT never counts as owed. Reminder, share,
 * payment-intent and overdue-transition lists MUST NOT gain PENDING (D-256 / D-260).
 *
 * REAL Postgres via PrismaService + real NestJS HTTP app for route-level
 * payment-evidence, revenue-intelligence and AI morning-briefing gates.
 *
 * FIXTURES: prefix `v86a_` (registered in test/helpers/fixture-prefixes.json,
 * packet `V1-86 (FU-PENDING-OWED-SERVER)`). Every seeded row is cleaned up with
 * `LIKE ${sqlLikePrefix(P)}` in beforeAll and afterAll.
 */
import 'reflect-metadata';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that touches @keyflow/db / DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v86a_';
const SRC_ROOT = path.resolve(__dirname, '../src/modules');

const ID = {
  owner: `${P}owner`,
  revRead: `${P}rev_read`,
  revNone: `${P}rev_none`,
  otherOwner: `${P}other_owner`,
  biz: `${P}biz`,
  otherBiz: `${P}other_biz`,
  contactPending: `${P}c_pend`,
  contactDraft: `${P}c_draft`,
  contactDeleted: `${P}c_del`,
  contactOther: `${P}c_other`,
  invPendingOverdue: `${P}inv_pend_od`,
  invPendingUpcoming: `${P}inv_pend_up`,
  invDraftOverdue: `${P}inv_draft_od`,
  invPaid: `${P}inv_paid`,
  invPendingDeleted: `${P}inv_pend_del`,
  invOtherPending: `${P}inv_other_pend`,
  staffRep: `${P}staff_rep`,
  product: `${P}prod_svc`,
  service: `${P}svc_linked`,
  expenseService: `${P}exp_svc`,
};

const emailOf = (id: string) => `${id}@v86a.test.local`;

let prisma: any;
let app: any;
let mods: any = {};

async function cleanup() {
  const db = prisma.client;
  for (const sql of [
    `DELETE FROM "invoice_items" WHERE id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "payments" WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "invoices" WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "revenue_actions" WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "expenses" WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "services" WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "products" WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "staff_members" WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "contacts" WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "chart_of_accounts" WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "memberships" WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "businesses" WHERE id LIKE ${sqlLikePrefix(P)} OR slug LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "users" WHERE id LIKE ${sqlLikePrefix(P)} OR email LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

async function seed() {
  const db = prisma.client;
  const now = new Date();
  const tenDaysAgo = new Date(now.getTime() - 10 * 86400000);
  const fiveDaysAgo = new Date(now.getTime() - 5 * 86400000);
  const tenDaysFromNow = new Date(now.getTime() + 10 * 86400000);

  for (const uid of [ID.owner, ID.revRead, ID.revNone, ID.otherOwner]) {
    await db.user.create({
      data: { id: uid, email: emailOf(uid), name: uid, role: 'USER' },
    });
  }

  await db.business.create({
    data: { id: ID.biz, name: 'V86A Primary Studio', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' },
  });
  await db.business.create({
    data: { id: ID.otherBiz, name: 'V86A Other Studio', slug: `${P}other`, ownerId: ID.otherOwner, currency: 'TTD' },
  });

  await db.membership.createMany({
    data: [
      { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' },
      {
        id: `${P}m_read`,
        userId: ID.revRead,
        businessId: ID.biz,
        role: 'STAFF',
        permissionScopes: { revenue: 'read', crm: 'read', contacts: 'read' } as any,
      },
      {
        id: `${P}m_none`,
        userId: ID.revNone,
        businessId: ID.biz,
        role: 'STAFF',
        permissionScopes: { revenue: 'none', crm: 'read', contacts: 'read' } as any,
      },
      { id: `${P}m_other`, userId: ID.otherOwner, businessId: ID.otherBiz, role: 'OWNER' },
    ],
  });

  await db.staffMember.create({
    data: { id: ID.staffRep, businessId: ID.biz, name: 'V86A Rep' },
  });

  await db.contact.createMany({
    data: [
      {
        id: ID.contactPending,
        businessId: ID.biz,
        firstName: 'Penny',
        lastName: 'Pending',
        email: `${P}penny@v86a.test.local`,
        status: 'CLIENT',
        custom: { salesRepId: ID.staffRep } as any,
      },
      {
        id: ID.contactDraft,
        businessId: ID.biz,
        firstName: 'Danny',
        lastName: 'DraftOnly',
        email: `${P}danny@v86a.test.local`,
        status: 'LEAD',
      },
      {
        id: ID.contactDeleted,
        businessId: ID.biz,
        firstName: 'Delia',
        lastName: 'Deleted',
        email: `${P}delia@v86a.test.local`,
        status: 'CLIENT',
        deletedAt: now,
      },
      {
        id: ID.contactOther,
        businessId: ID.otherBiz,
        firstName: 'Other',
        lastName: 'Tenant',
        email: `${P}otherc@v86a.test.local`,
        status: 'CLIENT',
      },
    ],
  });

  await db.product.create({
    data: { id: ID.product, businessId: ID.biz, name: 'V86A Consulting', price: 300, currency: 'TTD' },
  });
  await db.service.create({
    data: {
      id: ID.service,
      businessId: ID.biz,
      name: 'V86A Consulting Service',
      duration: 60,
      price: 300,
      sourceProductId: ID.product,
    },
  });
  await db.expense.create({
    data: {
      id: ID.expenseService,
      businessId: ID.biz,
      description: 'V86A Service Materials',
      amount: 50,
      currency: 'TTD',
      date: fiveDaysAgo,
      serviceId: ID.service,
    },
  });

  // Invoices in primary biz:
  // 1) PENDING + past due (500 TTD)
  // 2) PENDING + upcoming due in 10d (250 TTD)
  // 3) DRAFT + past due (999 TTD) -> MUST NEVER count as owed!
  // 4) PAID (paid 15d late, 400 TTD) -> establishes contactPending as slow payer + paid revenue
  // 5) PENDING + soft-deleted (777 TTD) -> MUST NEVER count!
  // 6) Other business PENDING (1200 TTD) -> cross-tenant isolation!
  await db.invoice.createMany({
    data: [
      {
        id: ID.invPendingOverdue,
        businessId: ID.biz,
        contactId: ID.contactPending,
        invoiceNumber: `${P}INV-001`,
        status: 'PENDING',
        subtotal: 500,
        total: 500,
        currency: 'TTD',
        issueDate: tenDaysAgo,
        dueDate: fiveDaysAgo,
      },
      {
        id: ID.invPendingUpcoming,
        businessId: ID.biz,
        contactId: ID.contactPending,
        invoiceNumber: `${P}INV-002`,
        status: 'PENDING',
        subtotal: 250,
        total: 250,
        currency: 'TTD',
        issueDate: now,
        dueDate: tenDaysFromNow,
      },
      {
        id: ID.invDraftOverdue,
        businessId: ID.biz,
        contactId: ID.contactDraft,
        invoiceNumber: `${P}INV-003`,
        status: 'DRAFT',
        subtotal: 999,
        total: 999,
        currency: 'TTD',
        issueDate: tenDaysAgo,
        dueDate: fiveDaysAgo,
      },
      {
        id: ID.invPaid,
        businessId: ID.biz,
        contactId: ID.contactPending,
        invoiceNumber: `${P}INV-004`,
        status: 'PAID',
        subtotal: 400,
        total: 400,
        currency: 'TTD',
        issueDate: new Date(now.getTime() - 25 * 86400000),
        dueDate: new Date(now.getTime() - 20 * 86400000),
        paidAt: fiveDaysAgo,
      },
      {
        id: ID.invPendingDeleted,
        businessId: ID.biz,
        contactId: ID.contactPending,
        invoiceNumber: `${P}INV-005`,
        status: 'PENDING',
        subtotal: 777,
        total: 777,
        currency: 'TTD',
        issueDate: tenDaysAgo,
        dueDate: fiveDaysAgo,
        deletedAt: now,
      },
      {
        id: ID.invOtherPending,
        businessId: ID.otherBiz,
        contactId: ID.contactOther,
        invoiceNumber: `${P}INV-OTHER`,
        status: 'PENDING',
        subtotal: 1200,
        total: 1200,
        currency: 'TTD',
        issueDate: tenDaysAgo,
        dueDate: fiveDaysAgo,
      },
      // Historical paid invoices (>50d ago, inside SlowPayerDetector 180d window, outside PO-10 40d window):
      // 3 fast-paid (2d) for contactDraft + 2 slow-paid (25d) for contactPending -> allDays >= 5, penny > 1.5x median.
      ...[1, 2, 3].map((n) => ({
        id: `${P}inv_hist_fast_${n}`,
        businessId: ID.biz,
        contactId: ID.contactDraft,
        invoiceNumber: `${P}HIST-F${n}`,
        status: 'PAID' as const,
        subtotal: 100,
        total: 100,
        currency: 'TTD',
        createdAt: new Date(now.getTime() - (70 + n) * 86400000),
        issueDate: new Date(now.getTime() - (70 + n) * 86400000),
        dueDate: new Date(now.getTime() - (68 + n) * 86400000),
        paidAt: new Date(now.getTime() - (68 + n) * 86400000),
      })),
      ...[1, 2].map((n) => ({
        id: `${P}inv_hist_slow_${n}`,
        businessId: ID.biz,
        contactId: ID.contactPending,
        invoiceNumber: `${P}HIST-S${n}`,
        status: 'PAID' as const,
        subtotal: 100,
        total: 100,
        currency: 'TTD',
        createdAt: new Date(now.getTime() - (85 + n) * 86400000),
        issueDate: new Date(now.getTime() - (85 + n) * 86400000),
        dueDate: new Date(now.getTime() - (75 + n) * 86400000),
        paidAt: new Date(now.getTime() - (55 + n) * 86400000),
      })),
    ],
  });

  await db.invoiceItem.create({
    data: {
      id: `${P}ii_pend`,
      invoiceId: ID.invPendingOverdue,
      productId: ID.product,
      description: 'V86A Consulting',
      quantity: 1,
      unitPrice: 500,
      total: 500,
    },
  });
}

describe('V1-86 (FU-PENDING-OWED-SERVER; D-256): every server owed figure counts PENDING through the shared list', () => {
  beforeAll(async () => {
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { AuthGuard } = await import('../src/core/auth/auth.guard');
    const { BusinessGuard } = await import('../src/core/auth/business.guard');
    const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
    const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
    const { FinanceOverviewService } = await import('../src/modules/finance/finance-overview.service');
    const { CashflowForecastService } = await import('../src/modules/finance/cashflow-forecast.service');
    const { AccountantExportService } = await import('../src/modules/finance/accountant-export.service');
    const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
    const { OsService } = await import('../src/modules/os/os.service');
    const { RevenueForecastService } = await import('../src/modules/commerce/revenue-forecast.service');
    const { SlowPayerDetector } = await import('../src/modules/commerce/slow-payer-detector.service');
    const { RevenueBriefingService } = await import('../src/modules/commerce/revenue-briefing.service');
    const { RevenueIntelligenceController } = await import('../src/modules/commerce/revenue-intelligence.controller');
    const { RevenueActionService } = await import('../src/modules/commerce/revenue-action.service');
    const { CommerceAiService } = await import('../src/modules/commerce/commerce-ai.service');
    const { FinancialCopilotService } = await import('../src/modules/commerce/financial-copilot.service');
    const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
    const { CommerceService } = await import('../src/modules/commerce/commerce.service');
    const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
    const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
    const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
    const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
    const { PricingSignalsService } = await import('../src/modules/commerce/pricing-signals.service');
    const { BusinessCommandCenterService } = await import('../src/modules/business-command-center/business-command-center.service');
    const { AiController } = await import('../src/modules/ai/ai.controller');
    const { KeyCommandService } = await import('../src/modules/ai/key-command.service');
    const { BusinessGraphService } = await import('../src/modules/ai/business-graph.service');
    const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
    const { CrmAiService } = await import('../src/modules/crm/crm-ai.service');
    const { CrmRevenueService } = await import('../src/modules/crm/crm-revenue.service');
    const { RelationshipHealthService } = await import('../src/modules/people-flow/relationship-health.service');
    const { PeopleFlowController } = await import('../src/modules/people-flow/people-flow.controller');
    const { PeopleOverviewService } = await import('../src/modules/people-flow/people-overview.service');
    const { CommerceAdapterService } = await import('../src/modules/key-cortex/adapters/commerce-adapter.service');
    const { FlowService } = await import('../src/modules/flow/flow.service');
    const { GamificationService } = await import('../src/modules/gamification/gamification.service');
    const { SalesTeamService } = await import('../src/modules/conversion/sales-team.service');
    const { buildContactWhere } = await import('../src/modules/crm/contact-filters.helper');
    const { ExpensesService } = await import('../src/modules/expenses/expenses.service');
    const { SHAREABLE_INVOICE_STATUSES, CREDIT_AWARE_SHAREABLE_INVOICE_STATUSES } = await import(
      '../src/modules/commerce/invoice-workflow.service'
    );
    const { OPEN_RECEIVABLE_STATUS_LIST } = await import('../src/modules/commerce/commerce-stats.service');
    const { runWithTenant } = await import('../src/core/tenant/tenant-context');

    mods = {
      FinanceOverviewService,
      CashflowForecastService,
      AccountantExportService,
      ChartOfAccountsSeederService,
      OsService,
      RevenueForecastService,
      SlowPayerDetector,
      RevenueActionService,
      CommerceAiService,
      FinancialCopilotService,
      BusinessCommandCenterService,
      KeyCommandService,
      BusinessGraphService,
      CrmStatsService,
      CrmAiService,
      CrmRevenueService,
      RelationshipHealthService,
      CommerceAdapterService,
      FlowService,
      GamificationService,
      SalesTeamService,
      buildContactWhere,
      ExpensesService,
      SHAREABLE_INVOICE_STATUSES,
      CREDIT_AWARE_SHAREABLE_INVOICE_STATUSES,
      OPEN_RECEIVABLE_STATUS_LIST,
      runWithTenant,
    };

    const { db } = await import('@keyflow/db');
    prisma = { client: db };
    await cleanup();
    await seed();

    // Minimal real NestJS HTTP app for route-level payment-evidence, revenue-intelligence, people-flow & morning-briefing gates.
    const moduleRef = await Test.createTestingModule({
      controllers: [CommerceController, RevenueIntelligenceController, AiController, PeopleFlowController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        AuthGuard,
        BusinessGuard,
        ModuleScopeGuard,
        RevenueForecastService,
        SlowPayerDetector,
        PricingSignalsService,
        RelationshipHealthService,
        { provide: PeopleOverviewService, useValue: {} },
        {
          provide: RevenueBriefingService,
          useFactory: (p: any, f: any, s: any, pr: any) =>
            new RevenueBriefingService(
              p,
              { callAi: async () => { throw new Error('ai-disabled'); } } as any,
              f,
              s,
              pr,
              {} as any,
            ),
          inject: [PrismaService, RevenueForecastService, SlowPayerDetector, PricingSignalsService],
        },
        { provide: CommerceService, useValue: {} },
        { provide: CommerceVisionService, useValue: {} },
        { provide: StoreReadinessService, useValue: {} },
        { provide: TimeEntryService, useValue: {} },
        {
          provide: PaymentEvidenceService,
          useValue: {
            extractEvidence: async () => ({
              extracted: { amount: 500, currency: 'TTD', payerName: 'Penny Pending', reference: `${P}INV-001` },
              raw: 'stub',
            }),
          },
        },
        { provide: EventEmitter2, useValue: new EventEmitter2() },
      ],
    })
      .useMocker(() => ({}))
      .compile();

    app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      const uid = req.headers['x-test-user'];
      if (typeof uid === 'string' && uid.length > 0) {
        req.user = { id: uid, email: emailOf(uid), role: 'USER' };
      }
      next();
    });
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    await app.init();
  }, 60000);

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) {
      await cleanup();
    }
  });

  // ── Site class 1: Dashboards, forecasts & operational summaries ───────────
  describe('Class 1 — Dashboards, forecasts & operational summaries', () => {
    it('PO-01: FinanceOverviewService.getOverview counts PENDING (750) and excludes DRAFT & soft-deleted', async () => {
      const svc = new mods.FinanceOverviewService(prisma);
      const overview = await svc.getOverview(ID.biz);
      expect(overview.outstandingInvoices).toBe(750);
      expect(overview.outstandingInvoiceCount).toBe(2);
    });

    it('PO-02: CashflowForecastService.forecast includes upcoming PENDING invoice (250) and excludes DRAFT', async () => {
      const svc = new mods.CashflowForecastService(prisma);
      const fc = await svc.forecast(ID.biz, 30);
      const totalInvoiceInflow = (fc.inflows ?? [])
        .filter((i: any) => i.source === 'invoice')
        .reduce((s: number, i: any) => s + Number(i.amount ?? 0), 0);
      expect(totalInvoiceInflow).toBe(250);
    });

    it('PO-03: OsService.getCommandCenter counts PENDING (750) in flows.financial.outstandingInvoices', async () => {
      const svc = new mods.OsService(
        prisma,
        { summary: async () => ({ open: 0, waitingApproval: 0, byCategory: [] }) } as any,
        { getCashPosition: async () => ({ cashBalance: 0, currency: 'TTD', basis: 'LEDGER', asOf: new Date().toISOString(), byCurrency: [] }) } as any,
      );
      const cc = await svc.getCommandCenter(ID.biz);
      expect(cc.flows.financial.outstandingInvoices).toBe(750);
    });

    it('PO-04: RevenueForecastService.compute & SlowPayerDetector.detect count PENDING (750) and exclude DRAFT', async () => {
      const forecastSvc = new mods.RevenueForecastService(prisma);
      const fc = await forecastSvc.compute(ID.biz);
      const json = JSON.stringify(fc);
      expect(json).not.toContain('999');
      const fromInvoices = (fc.buckets ?? []).reduce((s: number, b: any) => s + Number(b.fromInvoices ?? 0), 0);
      expect(fromInvoices).toBeGreaterThan(0);

      const slowSvc = new mods.SlowPayerDetector(prisma);
      const slow = await slowSvc.detect(ID.biz);
      const penny = slow.slowPayers.find((s: any) => s.contactId === ID.contactPending);
      expect(penny).toBeDefined();
      expect(penny!.outstandingTotal).toBe(750);
    });

    it('PO-05: RevenueBriefingService + RevenueIntelligenceController HTTP gate counts PENDING in inputs, never chases PENDING, & enforces revenue:read + cross-tenant 403', async () => {
      const ok = await request(app.getHttpServer())
        .get(`/commerce/businesses/${ID.biz}/revenue-intelligence/briefing`)
        .set('x-test-user', ID.owner)
        .expect(200);
      expect(ok.body.inputs.overdueCount).toBe(1);
      expect(ok.body.inputs.overdueTotal).toBe(500);
      // D-256 / D-260: never-sent PENDING invoice MUST NOT become a "Send a payment reminder" chase item!
      const invoiceChases = (ok.body.briefing?.whatToChase ?? []).filter(
        (c: any) => c.relatedType === 'invoice',
      );
      expect(invoiceChases).toHaveLength(0);

      // Revenue-scope refusal (revenue: none -> 403)
      await request(app.getHttpServer())
        .get(`/commerce/businesses/${ID.biz}/revenue-intelligence/briefing`)
        .set('x-test-user', ID.revNone)
        .expect(403);

      // Cross-tenant refusal (otherOwner -> 403)
      await request(app.getHttpServer())
        .get(`/commerce/businesses/${ID.biz}/revenue-intelligence/briefing`)
        .set('x-test-user', ID.otherOwner)
        .expect(403);
    });

    it('PO-06: BusinessCommandCenterService counts PENDING (2 open invoices) for owner and restricts revenue:none', async () => {
      const svc = new mods.BusinessCommandCenterService(
        {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {},
        prisma,
      );
      const ownerSnap = await mods.runWithTenant(ID.biz, ID.owner, () =>
        svc.snapshot(ID.biz, { id: ID.owner, role: 'USER' }),
      );
      expect(ownerSnap.results.openInvoices.status).toBe('OK');
      expect(ownerSnap.results.openInvoices.count).toBe(2);

      const noRevSnap = await mods.runWithTenant(ID.biz, ID.revNone, () =>
        svc.snapshot(ID.biz, { id: ID.revNone, role: 'USER' }),
      );
      expect(noRevSnap.results.openInvoices.status).toBe('RESTRICTED');
      expect(noRevSnap.results.openInvoices.count).toBeNull();
    });

    it('PO-07: AccountantExportService AR aging counts PENDING (INV-001, INV-002) and excludes DRAFT', async () => {
      const coa = new mods.ChartOfAccountsSeederService(prisma);
      const svc = new mods.AccountantExportService(prisma, coa);
      const bundle = await svc.build({
        businessId: ID.biz,
        periodStart: new Date(Date.now() - 30 * 86400000),
        periodEnd: new Date(Date.now() + 30 * 86400000),
      });
      // Read ar-aging.csv from the ZIP buffer (supports store method 0 and deflate method 8).
      const buf: Buffer = bundle.buffer;
      let offset = 0;
      let arCsv = '';
      while (offset + 30 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
        const method = buf.readUInt16LE(offset + 8);
        const compSize = buf.readUInt32LE(offset + 18);
        const nameLen = buf.readUInt16LE(offset + 26);
        const extraLen = buf.readUInt16LE(offset + 28);
        const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
        const dataStart = offset + 30 + nameLen + extraLen;
        const raw = buf.subarray(dataStart, dataStart + compSize);
        if (name === 'ar-aging.csv') {
          arCsv = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
          break;
        }
        offset = dataStart + compSize;
      }
      expect(arCsv).toContain(`${P}INV-001`);
      expect(arCsv).toContain(`${P}INV-002`);
      expect(arCsv).not.toContain(`${P}INV-003`);
    });

    it('PO-08: RevenueActionService.overviewKpis counts PENDING (750, 2) and excludes DRAFT', async () => {
      const svc = new mods.RevenueActionService(prisma, new EventEmitter2());
      const kpis = await svc.overviewKpis(ID.biz);
      expect(kpis.outstanding).toBe(750);
      expect(kpis.outstandingCount).toBe(2);
    });

    it('PO-09: FlowService.getCockpitSummary counts PENDING in owed metrics (drops DRAFT) while keeping PENDING out of WhatsApp reminder priorities', async () => {
      const svc = new mods.FlowService(prisma);
      const cockpit = await svc.getCockpitSummary(ID.biz);
      // 2 PENDING invoices, DRAFT excluded!
      expect(cockpit.stats.pendingInvoices).toBe(2);
      expect(cockpit.stats.overdueInvoices).toBe(1);
      const invoicedPhase = cockpit.phases.find((p: any) => p.name === 'Invoiced');
      expect(invoicedPhase?.count).toBe(2);
      expect(invoicedPhase?.value).toBe(750);
      // Negative control: WhatsApp reminder priority items MUST NOT include PENDING invoices (D-256 / D-260)
      const reminderPriorities = cockpit.priorities.filter(
        (p: any) => p.type === 'overdue_invoice' || p.type === 'unpaid_invoice',
      );
      expect(reminderPriorities).toHaveLength(0);
    });

    it('PO-10: GamificationService no-overdue & ExpensesService.getMarginAnalysis (total + byService) count PENDING and exclude DRAFT', async () => {
      const gamSvc = new mods.GamificationService(prisma);
      const gam = await gamSvc.getGamificationStats(ID.biz);
      // Past-due PENDING invoice flips the 'no-overdue' achievement to false even though PAID invoices exist.
      const noOverdue = (gam.achievements ?? []).find((a: any) => a.id === 'no-overdue');
      expect(noOverdue).toBeDefined();
      expect(noOverdue.achieved).toBe(false);

      const expSvc = new mods.ExpensesService(prisma, new EventEmitter2());
      const margin = await expSvc.getMarginAnalysis(
        ID.biz,
        'custom',
        new Date(Date.now() - 40 * 86400000).toISOString(),
        new Date(Date.now() + 2 * 86400000).toISOString(),
      );
      // PAID (400) + PENDING overdue (500) + PENDING upcoming (250) = 1150; DRAFT (999) excluded!
      expect(margin.totalRevenue).toBe(1150);
      // Service-linked invoice item on PENDING overdue invoice (500) exercises expenses.service.ts:1111!
      const svcMargin = (margin.byService ?? []).find((s: any) => s.serviceId === ID.service);
      expect(svcMargin).toBeDefined();
      expect(svcMargin.revenue).toBe(500);
    });
  });

  // ── Site class 2: KEY tools & AI intelligence ─────────────────────────────
  describe('Class 2 — KEY tools & AI intelligence', () => {
    it('PO-11: AiController GET /ai/businesses/:b/briefing/morning counts PENDING (2), hides for revenue:none (0), refuses cross-tenant (403)', async () => {
      const ok = await request(app.getHttpServer())
        .get(`/ai/businesses/${ID.biz}/briefing/morning`)
        .set('x-test-user', ID.owner)
        .expect(200);
      expect(ok.body.openInvoices).toBe(2);

      const noRev = await request(app.getHttpServer())
        .get(`/ai/businesses/${ID.biz}/briefing/morning`)
        .set('x-test-user', ID.revNone)
        .expect(200);
      expect(noRev.body.openInvoices).toBe(0);

      await request(app.getHttpServer())
        .get(`/ai/businesses/${ID.biz}/briefing/morning`)
        .set('x-test-user', ID.otherOwner)
        .expect(403);
    });

    it('PO-12: KeyCommandService.generateDoItForMe reports past-due PENDING & PARTIALLY_CREDITED in overdue finding AND keeps both out of invoice_reminder drafts (D-256 / D-260)', async () => {
      const svc = new mods.KeyCommandService(prisma, { record: async () => ({}) } as any);
      const res = await svc.generateDoItForMe(ID.biz, 'chase overdue invoices', ID.owner);
      expect(res.findings.some((f: string) => f.includes('1 overdue invoice') && f.includes('500'))).toBe(true);
      expect(res.actions.filter((a: any) => a.actionType === 'invoice_reminder')).toHaveLength(0);

      // Temporary past-due PARTIALLY_CREDITED invoice: counts in overdue money finding, NEVER offered as invoice_reminder (409 on send-reminder)
      const tempId = `${P}inv_temp_pc`;
      await prisma.client.invoice.create({
        data: {
          id: tempId,
          businessId: ID.biz,
          contactId: ID.contactPending,
          invoiceNumber: `${P}INV-PC`,
          status: 'PARTIALLY_CREDITED',
          subtotal: 120,
          total: 120,
          currency: 'TTD',
          issueDate: new Date(Date.now() - 12 * 86400000),
          dueDate: new Date(Date.now() - 4 * 86400000),
        },
      });
      try {
        const resPc = await svc.generateDoItForMe(ID.biz, 'chase overdue invoices', ID.owner);
        expect(resPc.findings.some((f: string) => f.includes('2 overdue invoices') && f.includes('620'))).toBe(true);
        expect(resPc.actions.filter((a: any) => a.actionType === 'invoice_reminder')).toHaveLength(0);
      } finally {
        await prisma.client.invoice.delete({ where: { id: tempId } });
      }
    });

    it('PO-13: BusinessGraphService snapshot & entities count PENDING (750 outstanding, 500 overdue) and DROP DRAFT', async () => {
      const svc = new mods.BusinessGraphService(prisma);
      const snap = await svc.getSnapshotForViewer(ID.biz, ID.owner, true);
      expect(snap.revenue.outstandingAmount).toBe(750);
      expect(snap.revenue.outstandingCount).toBe(2);
      expect(snap.revenue.overdueAmount).toBe(500);
      expect(snap.revenue.overdueCount).toBe(1);
      // assembleEntityLinks (business-graph.service.ts:614): includes PENDING overdue, excludes DRAFT
      const overdueEntityIds = (snap.entities?.overdueInvoices ?? []).map((i: any) => i.id);
      expect(overdueEntityIds).toContain(ID.invPendingOverdue);
      expect(overdueEntityIds).not.toContain(ID.invDraftOverdue);
    });

    it('PO-14: CommerceAiService (clientPaymentIntelligence + predictiveCollectionsScore), FinancialCopilotService (pulse + weeklyBriefing) & CommerceAdapterService (all + overdueOnly) count PENDING and exclude DRAFT', async () => {
      const capturedPrompts: string[] = [];
      const stubAi = {
        callAi: async (req: any) => {
          capturedPrompts.push(JSON.stringify(req?.messages ?? req));
          return { content: 'non-json-fallback', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
        },
      } as any;
      const commerceAi = new mods.CommerceAiService(prisma, stubAi, {} as any);
      const cpi = await commerceAi.clientPaymentIntelligence(ID.biz, ID.contactPending);
      expect(cpi.outstandingBalance).toBe(750);
      expect(cpi.invoiceSummary.outstanding).toBe(2);

      // predictiveCollectionsScore (commerce-ai.service.ts:1069, 1142): scores past-due PENDING without advising "Send a follow-up reminder"
      const collections = await commerceAi.predictiveCollectionsScore(ID.biz);
      const pendScore = (collections.scores ?? []).find((s: any) => s.invoiceId === ID.invPendingOverdue);
      expect(pendScore).toBeDefined();
      expect(String(pendScore.nextAction ?? '').toLowerCase()).not.toContain('reminder');

      const copilot = new mods.FinancialCopilotService(prisma, stubAi);
      const pulse = await copilot.getFinancialPulse(ID.biz);
      expect(pulse.outstandingReceivables).toBe(750);
      expect(pulse.overdueCount).toBe(1);
      // generateWeeklyBriefing (financial-copilot.service.ts:562)
      const weekly = await copilot.generateWeeklyBriefing(ID.biz);
      expect(weekly).toBeDefined();
      expect(capturedPrompts.some((p) => p.includes('750'))).toBe(true);

      const adapter = new mods.CommerceAdapterService({
        listInvoices: async (businessId: string) => ({
          data: await prisma.client.invoice.findMany({ where: { businessId, deletedAt: null } }),
        }),
      } as any);
      const outstanding = await adapter.getOutstandingInvoices({ businessId: ID.biz });
      expect(outstanding.map((i: any) => i.id).sort()).toEqual([ID.invPendingOverdue, ID.invPendingUpcoming].sort());
      const overdueOnly = await adapter.getOutstandingInvoices({ businessId: ID.biz, overdueOnly: true });
      expect(overdueOnly.map((i: any) => i.id)).toEqual([ID.invPendingOverdue]);
    });
  });

  // ── Site class 3: CRM figures & sales team ────────────────────────────────
  describe('Class 3 — CRM figures & sales team', () => {
    it('PO-15: CrmStatsService (raw SQL attachContactStats, contactDetail, segmentSummary, flowHighlights) counts PENDING and excludes DRAFT', async () => {
      const cacheStub = { get: () => null, set: () => {}, invalidate: () => {} };
      const timelineStub = { buildTimeline: async () => [] };
      const statsSvc = new mods.CrmStatsService(prisma, timelineStub as any, cacheStub as any);
      const contacts = await prisma.client.contact.findMany({
        where: { id: { in: [ID.contactPending, ID.contactDraft] } },
      });
      const enriched = await statsSvc.attachContactStats(ID.biz, contacts);
      const penny = enriched.find((c: any) => c.id === ID.contactPending)!;
      const danny = enriched.find((c: any) => c.id === ID.contactDraft)!;
      expect(penny.meta?.outstandingBalance).toBe(750);
      expect(penny.meta?.unpaidInvoices).toBe(2);
      expect(danny.meta?.outstandingBalance ?? 0).toBe(0);
      expect(danny.meta?.unpaidInvoices ?? 0).toBe(0);

      const detail = await statsSvc.contactDetail({ businessId: ID.biz, contactId: ID.contactPending });
      expect((detail as any).meta.outstandingBalance).toBe(750);
      expect((detail as any).meta.unpaidInvoices).toBe(2);

      const segments = await statsSvc.segmentSummary({ businessId: ID.biz, viewerUserId: ID.owner });
      expect(segments.unpaid).toBe(1);

      const highlights = await statsSvc.flowHighlights({
        businessId: ID.biz,
        readsRevenue: true,
        viewerUserId: ID.owner,
      });
      const unpaidGroup = highlights.segments.find((g: any) => g.key === 'cold-with-unpaid');
      expect(unpaidGroup?.count).toBe(1);
    });

    it('PO-16: CrmRevenueService, RelationshipHealthService, buildContactWhere & SalesTeamService count PENDING and exclude DRAFT', async () => {
      const crmRev = new mods.CrmRevenueService(prisma);
      const revPending = await crmRev.getContactRevenueSummary(ID.biz, ID.contactPending);
      expect(revPending.outstandingBalance).toBe(750);
      const revDraft = await crmRev.getContactRevenueSummary(ID.biz, ID.contactDraft);
      expect(revDraft.outstandingBalance).toBe(0);

      const relHealth = new mods.RelationshipHealthService(prisma);
      const health = await relHealth.computeHealth(ID.biz, ID.contactPending);
      expect(health?.outstandingBalance).toBe(750);
      expect(health?.openInvoiceCount).toBe(2);
      // Soft-deleted contact must return null from computeHealth
      expect(await relHealth.computeHealth(ID.biz, ID.contactDeleted)).toBeNull();
      // Cross-tenant contact must return null from computeHealth
      expect(await relHealth.computeHealth(ID.biz, ID.contactOther)).toBeNull();

      const whereUnpaid = mods.buildContactWhere(ID.biz, { hasUnpaidInvoices: true });
      const matched = await prisma.client.contact.findMany({ where: whereUnpaid, select: { id: true } });
      expect(matched.map((c: any) => c.id)).toEqual([ID.contactPending]);

      const salesTeam = new mods.SalesTeamService(prisma);
      const pipeline = await salesTeam.getRepPipeline(ID.biz, ID.staffRep);
      const repContact = pipeline.find((r: any) => r.id === ID.contactPending);
      expect(repContact?.openDeals).toBe(2);
    });

    it('PO-16b: CrmAiService counts PENDING (750, excludes soft-deleted 777) & PeopleFlowController enforces revenue:read on contact health', async () => {
      const prompts: string[] = [];
      const crmAi = new mods.CrmAiService(
        prisma,
        {
          callAi: async (req: any) => {
            prompts.push(JSON.stringify(req?.messages ?? req));
            return { content: '{}', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
          },
        } as any,
        {} as any,
      );

      await crmAi.summarizeContact(ID.biz, ID.contactPending);
      await crmAi.generatePrepBrief(ID.biz, ID.contactPending);
      await crmAi.generateFollowUpDraft(ID.biz, ID.contactPending);

      expect(prompts).toHaveLength(3);
      // Both summarizeContact & generatePrepBrief must show 750 (NOT 1527 from soft-deleted 777, NOT 0)
      expect(prompts[0]).toContain('750');
      expect(prompts[0]).not.toContain('1527');
      expect(prompts[1]).toContain('750');
      expect(prompts[1]).not.toContain('1527');
      // generateFollowUpDraft must include PENDING amounts and explicitly note not-yet-sent (no payment reminder)
      expect(prompts[2]).toContain('500');
      expect(prompts[2].toLowerCase()).toContain('not yet sent');
    });

    it('PO-16c: PeopleFlowController GET /people-flow/businesses/:b/contacts/:c/health enforces revenue:read and cross-tenant 403', async () => {
      // Owner (revenue:read) sees live PENDING totals (750, 2 open)
      const ownerHealth = await request(app.getHttpServer())
        .get(`/people-flow/businesses/${ID.biz}/contacts/${ID.contactPending}/health`)
        .set('x-test-user', ID.owner)
        .expect(200);
      expect(ownerHealth.body.outstandingBalance).toBe(750);
      expect(ownerHealth.body.openInvoiceCount).toBe(2);

      // revenue:none member gets zero money fields & zero money signals (D-100 / D-234 / D-259)
      const noRevHealth = await request(app.getHttpServer())
        .get(`/people-flow/businesses/${ID.biz}/contacts/${ID.contactPending}/health`)
        .set('x-test-user', ID.revNone)
        .expect(200);
      expect(noRevHealth.body.outstandingBalance).toBe(0);
      expect(noRevHealth.body.lifetimeValue).toBe(0);
      expect(noRevHealth.body.openInvoiceCount).toBe(0);
      expect(noRevHealth.body.totalInvoiceCount).toBe(0);
      const signalsJoined = (noRevHealth.body.signals ?? []).join(' ').toLowerCase();
      expect(signalsJoined).not.toContain('outstanding');
      expect(signalsJoined).not.toContain('overdue');
      expect(signalsJoined).not.toContain('750');

      // Cross-tenant caller refused 403
      await request(app.getHttpServer())
        .get(`/people-flow/businesses/${ID.biz}/contacts/${ID.contactPending}/health`)
        .set('x-test-user', ID.otherOwner)
        .expect(403);
    });
  });

  // ── Site class 4: Payment evidence matching (HTTP) ────────────────────────
  describe('Class 4 — Payment evidence matching (HTTP)', () => {
    it('PO-17: POST /commerce/businesses/:b/payments/extract-evidence returns PENDING candidates (not DRAFT/deleted/other-tenant) & enforces revenue:write + tenant 403', async () => {
      const ok = await request(app.getHttpServer())
        .post(`/commerce/businesses/${ID.biz}/payments/extract-evidence`)
        .set('x-test-user', ID.owner)
        .send({ text: 'Paid 500 TTD for INV-001' })
        .expect(201);

      const candidateIds = (ok.body.candidates ?? []).map((c: any) => c.id);
      expect(candidateIds).toContain(ID.invPendingOverdue);
      expect(candidateIds).toContain(ID.invPendingUpcoming);
      expect(candidateIds).not.toContain(ID.invDraftOverdue);
      expect(candidateIds).not.toContain(ID.invPendingDeleted);
      expect(candidateIds).not.toContain(ID.invOtherPending);

      // revenue:read only -> 403 (requires revenue:write)
      await request(app.getHttpServer())
        .post(`/commerce/businesses/${ID.biz}/payments/extract-evidence`)
        .set('x-test-user', ID.revRead)
        .send({ text: 'Paid 500' })
        .expect(403);

      // cross-tenant -> 403
      await request(app.getHttpServer())
        .post(`/commerce/businesses/${ID.biz}/payments/extract-evidence`)
        .set('x-test-user', ID.otherOwner)
        .send({ text: 'Paid 500' })
        .expect(403);
    });
  });

  // ── Negative controls & static drift guard ────────────────────────────────
  describe('Negative controls & shared-list drift guard', () => {
    it('PO-18: reminder, shareable, intent-payable and overdue-transition lists MUST NOT gain PENDING, and OPEN_RECEIVABLE_STATUS_LIST is frozen', () => {
      expect(Object.isFrozen(mods.OPEN_RECEIVABLE_STATUS_LIST)).toBe(true);
      expect(mods.SHAREABLE_INVOICE_STATUSES).not.toContain('PENDING');
      expect(mods.CREDIT_AWARE_SHAREABLE_INVOICE_STATUSES).not.toContain('PENDING');

      const commerceSrc = fs.readFileSync(path.join(SRC_ROOT, 'commerce/commerce.service.ts'), 'utf8');
      const remindMatch = commerceSrc.match(/REMINDABLE_INVOICE_STATUSES[^=]*=\s*new Set\(\[([^\]]*)\]\)/);
      expect(remindMatch).not.toBeNull();
      expect(remindMatch![1]).not.toContain('PENDING');
      expect(remindMatch![1]).not.toContain('PARTIALLY_CREDITED');

      const intentMatch = commerceSrc.match(/INTENT_PAYABLE_STATUSES[^=]*=\s*new Set\(\[([^\]]*)\]\)/);
      expect(intentMatch).not.toBeNull();
      expect(intentMatch![1]).not.toContain('PENDING');

      // DelegationLoopService:548 transitions SENT -> OVERDUE and sends PAYMENT_RECOVERY reminder emails (R0 TG-18d).
      const delegationSrc = fs.readFileSync(path.join(SRC_ROOT, 'autopilot/delegation-loop.service.ts'), 'utf8');
      const delMatch = delegationSrc.match(/const overdueInvoices = await this\.prisma\.client\.invoice\.findMany\(\{[\s\S]*?status:\s*\{\s*in:\s*\[([^\]]*)\]/);
      expect(delMatch).not.toBeNull();
      expect(delMatch![1]).not.toContain('PENDING');
    });

    it('PO-19: every migrated owed-figure reader imports the shared list from commerce-stats.service and keeps no private owed-status literal (in any order or syntax)', () => {
      const migratedFiles = [
        'finance/finance-overview.service.ts',
        'finance/cashflow-forecast.service.ts',
        'os/os.service.ts',
        'commerce/revenue-briefing.service.ts',
        'business-command-center/business-command-center.service.ts',
        'finance/accountant-export.service.ts',
        'commerce/revenue-forecast.service.ts',
        'commerce/revenue-intelligence.controller.ts',
        'ai/ai.controller.ts',
        'ai/key-command.service.ts',
        'ai/business-graph.service.ts',
        'commerce/commerce-ai.service.ts',
        'commerce/financial-copilot.service.ts',
        'commerce/revenue-action.service.ts',
        'commerce/slow-payer-detector.service.ts',
        'crm/crm-stats.service.ts',
        'crm/crm-ai.service.ts',
        'crm/crm-revenue.service.ts',
        'people-flow/relationship-health.service.ts',
        'key-cortex/adapters/commerce-adapter.service.ts',
        'flow/flow.service.ts',
        'gamification/gamification.service.ts',
        'conversion/sales-team.service.ts',
        'crm/contact-filters.helper.ts',
        'expenses/expenses.service.ts',
        'commerce/commerce.controller.ts',
      ];

      // Detects any private invoice open-receivable status literal list (array, Set, SQL IN, or chained ===),
      // including lists that copy PENDING + SENT/OVERDUE/PARTIALLY_PAID/PARTIALLY_CREDITED in any order.
      const isForbiddenOwedLiteral = (src: string): string | null => {
        if (/const OPEN_INVOICE_STATUSES\b/.test(src)) return 'const OPEN_INVOICE_STATUSES';
        if (/status\s*===\s*['"]SENT['"]\s*\|\|\s*[a-zA-Z0-9_.]+\.status\s*===\s*['"]DRAFT['"]/.test(src)) {
          return "chained status === 'SENT' || ...status === 'DRAFT'";
        }
        // Any bracketed array literal of >=2 uppercase status strings containing a private invoice owed combination
        const arrayMatches = src.matchAll(/\[(?:\s*['"][A-Z_]+['"]\s*,)+\s*['"][A-Z_]+['"]\s*,?\s*\]/g);
        for (const m of arrayMatches) {
          const items = [...m[0].matchAll(/'([A-Z_]+)'|"([A-Z_]+)"/g)].map((x) => x[1] || x[2]);
          const hasPending = items.includes('PENDING');
          const hasSent = items.includes('SENT');
          const hasOverdue = items.includes('OVERDUE');
          const hasPartPaid = items.includes('PARTIALLY_PAID');
          const hasPartCred = items.includes('PARTIALLY_CREDITED');
          const hasDraft = items.includes('DRAFT');
          // Reject any list combining PENDING with SENT/OVERDUE/PARTIALLY_PAID/PARTIALLY_CREDITED,
          // OR SENT with OVERDUE/PARTIALLY_PAID/PARTIALLY_CREDITED.
          if (hasPending && (hasSent || hasOverdue || hasPartPaid || hasPartCred)) {
            return `private PENDING owed array literal ${m[0]}`;
          }
          if (hasSent && (hasOverdue || hasPartPaid || hasPartCred)) {
            return `private SENT/OVERDUE owed array literal ${m[0]}`;
          }
          // Reject ['SENT', 'DRAFT'] when used inside an invoice query (quote queries are allowed on quotes)
          if (hasSent && hasDraft) {
            const before = src.slice(Math.max(0, (m.index ?? 0) - 120), m.index ?? 0);
            if (/invoice/i.test(before) && !/quote/i.test(before)) {
              return `private invoice SENT/DRAFT literal ${m[0]}`;
            }
          }
        }
        // Raw SQL IN ('SENT', 'OVERDUE', ...) or IN ('PENDING', ...)
        const sqlMatches = src.matchAll(/status(?:::text)?\s+IN\s*\(([^)]+)\)/gi);
        for (const m of sqlMatches) {
          if (/'(?:SENT|OVERDUE|PENDING|PARTIALLY_PAID|PARTIALLY_CREDITED)'/i.test(m[1])) {
            return `private SQL status IN literal ${m[0]}`;
          }
        }
        return null;
      };

      // Self-test: prove the drift detector catches re-introduced literals (including PENDING lists)
      expect(isForbiddenOwedLiteral("status: { in: ['PENDING', 'SENT', 'OVERDUE', 'PARTIALLY_PAID', 'PARTIALLY_CREDITED'] }")).not.toBeNull();
      expect(isForbiddenOwedLiteral("new Set(['PENDING', 'SENT', 'OVERDUE']).has(i.status)")).not.toBeNull();
      expect(isForbiddenOwedLiteral("WHERE status::text IN ('PENDING', 'SENT', 'OVERDUE')")).not.toBeNull();
      expect(isForbiddenOwedLiteral("i.status === 'SENT' || i.status === 'DRAFT'")).not.toBeNull();

      // Single-site anchored exclusion for the documented FOLLOW3-A9 refund reopen check (non-owed) at L307-313.
      for (const rel of migratedFiles) {
        const src = fs.readFileSync(path.join(SRC_ROOT, rel), 'utf8');
        expect(src, `${rel} must import OPEN_RECEIVABLE_STATUSES or OPEN_RECEIVABLE_STATUS_LIST`).toMatch(
          /import\s+\{[^}]*OPEN_RECEIVABLE_STATUS(?:ES|_LIST)[^}]*\}\s+from\s+['"][^'"]*commerce-stats\.service['"]/,
        );

        const filteredSrc =
          rel === 'commerce/revenue-action.service.ts'
            ? src.replace(
                /(id:\s*\{\s*in:\s*openReceipts\.map\(\(r\)\s*=>\s*r\.relatedId as string\)\s*\},\s*\n\s*)status:\s*\{\s*in:\s*\['SENT',\s*'OVERDUE'\]\s*\},/,
                '$1// allowed-FOLLOW3-A9-refund-reopen',
              )
            : src;

        expect(isForbiddenOwedLiteral(filteredSrc), `${rel} must not contain a private owed-status literal`).toBeNull();
      }
    });
  });
});
