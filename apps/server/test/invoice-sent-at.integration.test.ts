/**
 * P45 — V1-64 (SWP-INV-DETAIL, server half, BUG-088):
 * Transitioning an invoice DRAFT -> SENT without an explicit `sentAt` stamps
 * `invoices.sent_at` on the database row and surfaces exactly one `invoice.sent`
 * entry in `GET /commerce/businesses/:businessId/invoices/:invoiceId/timeline`.
 *
 * REAL Postgres database, REAL CommerceController, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CommerceService, InvoiceWorkflowService, GlobalHttpExceptionFilter,
 * and ValidationPipe. Fixtures use prefix `v64b_` and are hard-deleted in
 * beforeAll/afterAll without `$transaction` wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v64b_';
const HEADER = 'x-v64b-user';

const ID = {
  ownerA: `${P}ownerA`,
  staffReadA: `${P}staffReadA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  invHttp: `${P}invHttp`,
  invDirect: `${P}invDirect`,
  invExplicit: `${P}invExplicit`,
  invVoid: `${P}invVoid`,
  invAuth: `${P}invAuth`,
};

let db: any;
let app: any;
let workflow: any;
let redis: any;

const recordedEvents: Array<{ name: string; payload: unknown }> = [];
const eventRecorder = {
  emit: (name: string, payload: unknown) => {
    recordedEvents.push({ name, payload });
    return true;
  },
  emitAsync: async (name: string, payload: unknown) => {
    recordedEvents.push({ name, payload });
    return [];
  },
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

const crmCalls: Array<{ type: string; data?: Record<string, unknown> }> = [];
const crmRecorder = {
  logContactEvent: async (input: { type: string; data?: Record<string, unknown> }) => {
    crmCalls.push(input);
    return { id: `${P}evt_${crmCalls.length}` };
  },
};

const postingRecorder = {
  onInvoiceFinalized: async () => undefined,
  onInvoiceVoided: async () => undefined,
  onPaymentRecorded: async () => undefined,
  onPaymentRefunded: async () => undefined,
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

async function seedDraft(id: string, invoiceNumber: string) {
  await db.invoice.create({
    data: {
      id,
      businessId: ID.bizA,
      contactId: ID.contactA,
      invoiceNumber,
      status: 'DRAFT',
      currency: 'TTD',
      subtotal: 250,
      taxAmount: 0,
      total: 250,
      sentAt: null,
      paidAt: null,
      items: {
        create: {
          id: `${id}_item1`,
          description: 'Consulting session',
          quantity: 1,
          unitPrice: 250,
          total: 250,
        },
      },
    },
  });
}

function patchStatus(actor: string, businessId: string, invoiceId: string, status: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .patch(`/commerce/invoices/${invoiceId}/status/${status.toLowerCase()}`)
    .set(HEADER, actor)
    .send({ businessId, ...body });
}

function getTimeline(actor: string, businessId: string, invoiceId: string) {
  return request(app.getHttpServer())
    .get(`/commerce/businesses/${businessId}/invoices/${invoiceId}/timeline`)
    .set(HEADER, actor);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const IORedis = (await import('ioredis')).default;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PublicRateLimitGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      { provide: REDIS_CLIENT, useValue: redis },
      CommerceService,
      InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      { provide: RevenuePostingService, useValue: postingRecorder },
      { provide: ExpensePostingService, useValue: {} },
      { provide: EventEmitter2, useValue: eventRecorder },
      { provide: CrmService, useValue: crmRecorder },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
    ],
  }).compile();

  workflow = moduleRef.get(InvoiceWorkflowService);
  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();

  for (const [key, id] of [
    ['ownerA', ID.ownerA],
    ['staffReadA', ID.staffReadA],
    ['ownerB', ID.ownerB],
  ] as const) {
    await db.user.create({ data: { id, email: `${P}${key}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V64B Biz A', ownerId: ID.ownerA, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'V64B Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.createMany({
    data: [
      { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      { id: `${P}m_readA`, userId: ID.staffReadA, businessId: ID.bizA, role: 'STAFF', permissionScopes: { revenue: 'read' } },
      { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });
  await db.contact.create({
    data: { id: ID.contactA, businessId: ID.bizA, firstName: 'Sita', lastName: 'Persad', email: `${P}sita@test.local` },
  });

  await seedDraft(ID.invHttp, 'V64B-001');
  await seedDraft(ID.invDirect, 'V64B-002');
  await seedDraft(ID.invExplicit, 'V64B-003');
  await seedDraft(ID.invVoid, 'V64B-004');
  await seedDraft(ID.invAuth, 'V64B-005');
}, 60_000);

beforeEach(() => {
  recordedEvents.length = 0;
  crmCalls.length = 0;
});

afterAll(async () => {
  await cleanup();
  await app?.close();
  await redis?.quit();
}, 30_000);

describe('P45 (SWP-INV-DETAIL server half, BUG-088): DRAFT -> SENT stamps sentAt and records one invoice.sent activity', () => {
  it('SENT-01 RED-BEFORE: PATCH DRAFT -> SENT without sentAt stamps sentAt on the row and produces one invoice.sent timeline entry', async () => {
    const before = Date.now() - 1000;
    const res = await patchStatus(ID.ownerA, ID.bizA, ID.invHttp, 'sent', { status: 'SENT' });
    const after = Date.now() + 1000;

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SENT');
    expect(res.body.sentAt).toBeTruthy();

    const stampedMs = new Date(res.body.sentAt).getTime();
    expect(stampedMs).toBeGreaterThanOrEqual(before);
    expect(stampedMs).toBeLessThanOrEqual(after);

    const row = await db.invoice.findUnique({ where: { id: ID.invHttp }, select: { status: true, sentAt: true, paidAt: true } });
    expect(row?.status).toBe('SENT');
    expect(row?.sentAt).toBeInstanceOf(Date);
    expect(row?.paidAt).toBeNull();

    const tl = await getTimeline(ID.ownerA, ID.bizA, ID.invHttp);
    expect(tl.status).toBe(200);
    const sentEntries = (tl.body.entries as Array<{ type: string; label: string; at: string }>).filter((e) => e.type === 'invoice.sent');
    expect(sentEntries).toHaveLength(1);
    expect(sentEntries[0].label).toBe('Invoice sent');
    expect(new Date(sentEntries[0].at).getTime()).toBe(row!.sentAt!.getTime());

    expect(recordedEvents.filter((e) => e.name === 'invoice.sent')).toHaveLength(1);
    expect(crmCalls.filter((c) => c.type === 'invoice.sent')).toHaveLength(1);
  });

  it('SENT-02 RED-BEFORE: InvoiceWorkflowService.transition(DRAFT -> SENT) without extra.sentAt stamps sentAt directly', async () => {
    const before = Date.now() - 1000;
    const updated = await workflow.transition(ID.invDirect, 'SENT', { actorId: ID.ownerA });
    const after = Date.now() + 1000;

    expect(updated.status).toBe('SENT');
    expect(updated.sentAt).toBeInstanceOf(Date);
    expect(updated.sentAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(updated.sentAt.getTime()).toBeLessThanOrEqual(after);

    const row = await db.invoice.findUnique({ where: { id: ID.invDirect }, select: { sentAt: true } });
    expect(row?.sentAt).toBeInstanceOf(Date);
  });

  it('SENT-03 control: explicit sentAt on DRAFT -> SENT is preserved verbatim', async () => {
    const explicit = '2026-10-15T12:00:00.000Z';
    const res = await patchStatus(ID.ownerA, ID.bizA, ID.invExplicit, 'sent', { status: 'SENT', sentAt: explicit });
    expect(res.status).toBe(200);
    expect(new Date(res.body.sentAt).toISOString()).toBe(explicit);

    const row = await db.invoice.findUnique({ where: { id: ID.invExplicit }, select: { sentAt: true } });
    expect(row?.sentAt?.toISOString()).toBe(explicit);
  });

  it('SENT-04 idempotency: repeated PATCH SENT -> SENT without sentAt keeps original sentAt and still shows one invoice.sent activity', async () => {
    const beforeRow = await db.invoice.findUnique({ where: { id: ID.invHttp }, select: { sentAt: true } });
    expect(beforeRow?.sentAt).toBeInstanceOf(Date);

    const res = await patchStatus(ID.ownerA, ID.bizA, ID.invHttp, 'sent', { status: 'SENT' });
    expect(res.status).toBe(200);
    expect(new Date(res.body.sentAt).getTime()).toBe(beforeRow!.sentAt!.getTime());
    expect(recordedEvents.filter((e) => e.name === 'invoice.sent')).toHaveLength(0);
    expect(crmCalls.filter((c) => c.type === 'invoice.sent')).toHaveLength(0);

    const tl = await getTimeline(ID.ownerA, ID.bizA, ID.invHttp);
    expect(tl.status).toBe(200);
    const sentEntries = (tl.body.entries as Array<{ type: string }>).filter((e) => e.type === 'invoice.sent');
    expect(sentEntries).toHaveLength(1);
  });

  it('SENT-05 control: DRAFT -> VOID leaves sentAt null and emits no invoice.sent timeline entry', async () => {
    const res = await patchStatus(ID.ownerA, ID.bizA, ID.invVoid, 'void', { status: 'VOID' });
    expect(res.status).toBe(200);
    expect(res.body.sentAt).toBeNull();

    const tl = await getTimeline(ID.ownerA, ID.bizA, ID.invVoid);
    expect(tl.status).toBe(200);
    const sentEntries = (tl.body.entries as Array<{ type: string }>).filter((e) => e.type === 'invoice.sent');
    expect(sentEntries).toHaveLength(0);
  });

  it('SENT-06 auth & tenant boundary: revenue:read-only and foreign-tenant actors are refused and leave DRAFT sentAt null', async () => {
    const readOnly = await patchStatus(ID.staffReadA, ID.bizA, ID.invAuth, 'sent', { status: 'SENT' });
    expect(readOnly.status).toBe(403);

    const foreign = await patchStatus(ID.ownerB, ID.bizB, ID.invAuth, 'sent', { status: 'SENT' });
    expect([403, 404]).toContain(foreign.status);

    const row = await db.invoice.findUnique({ where: { id: ID.invAuth }, select: { status: true, sentAt: true } });
    expect(row?.status).toBe('DRAFT');
    expect(row?.sentAt).toBeNull();
  });
});
