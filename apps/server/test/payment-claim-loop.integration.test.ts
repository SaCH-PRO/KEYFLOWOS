/**
 * P76 — V1-65 (CLAIM-LOOP, server half, P0 launch-track, Journeys E / H / I):
 *
 * Real Postgres + real Redis + real HTTP NestJS app (`CommerceController`,
 * `CommerceService`, `RevenuePostingService`, `PostingService`,
 * `ChartOfAccountsSeederService`, `AuthGuard`, `BusinessGuard`,
 * `ModuleScopeGuard`, `PublicRateLimitGuard`).
 *
 * Proves:
 *   - [CL-01] Anonymous bank_transfer intent emits `invoice.payment_claimed`
 *             once after commit, appears in `GET claims`, writes zero ledger rows.
 *   - [CL-02] `POST claims/:id/confirm` posts 1 payment + 1 ledger posting +
 *             1 `invoice.paid` event via `recordPayment` with claim-id
 *             idempotencyKey; second confirm is idempotent (0 new rows/events).
 *   - [CL-03] `POST claims/:id/dismiss` ('Not yet') retires the pending claim
 *             without touching invoice status or ledger; subsequent confirm -> 409;
 *             a new customer intent opens 1 fresh claim + 1 fresh event.
 *   - [CL-04] Abuse / anti-flood: 20 mixed-method intents on one invoice emit
 *             exactly 1 `invoice.payment_claimed` event and yield 1 row in
 *             `GET claims`; confirming retires all pending method rows.
 *   - [CL-05] RBAC (`revenue:write`), D-46 (non-member SUPER_ADMIN refused on
 *             confirm/dismiss), tenant isolation, and extracted-evidence rows
 *             are excluded from claims.
 *   - [CL-06] Partial confirm amount + invalid amount rejection (400, claim intact).
 *
 * Fixtures use pre-allocated prefix `v65d_` and are hard-deleted with `sqlLikePrefix(P)`.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import IORedis from 'ioredis';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 90_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v65d_';
const HEADER = 'x-test-user-id';

const ID = {
  ownerA: `${P}ownerA`,
  staffReadA: `${P}staffReadA`,
  staffNoneA: `${P}staffNoneA`,
  ownerB: `${P}ownerB`,
  superAdmin: `${P}superAdmin`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let app: INestApplication;
let redis: IORedis;
let commerceService: any;
const emittedEvents: Array<{ name: string; payload: any }> = [];
/* eslint-enable @typescript-eslint/no-explicit-any */

async function clearRateLimits() {
  if (!redis) return;
  const keys = await redis.keys('pubrl:*');
  if (keys.length > 0) await redis.del(...keys);
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM credit_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
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

async function cleanupDynamicRows() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM credit_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

let invSeq = 0;
async function seedSentInvoiceWithLink(bizId: string, contactId: string, total = 450) {
  invSeq += 1;
  const id = `${P}inv_${invSeq}`;
  const invoiceNumber = `${P}INV-${invSeq}`;
  const inv = await db.invoice.create({
    data: {
      id,
      businessId: bizId,
      contactId,
      invoiceNumber,
      status: 'SENT',
      subtotal: total,
      total,
      currency: 'TTD',
    },
  });
  const token = `${P}tok_${invSeq}_abcdef1234567890`;
  await db.paymentLink.create({
    data: {
      id: `${P}pl_${invSeq}`,
      businessId: bizId,
      invoiceId: id,
      token,
      active: true,
    },
  });
  return { invoice: inv, token };
}

async function ledgerCounts(bizId: string) {
  const [txCount, entryCount] = await Promise.all([
    db.financialTransaction.count({ where: { businessId: bizId } }),
    db.ledgerEntry.count({ where: { businessId: bizId } }),
  ]);
  return { txCount, entryCount };
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });

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
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      {
        provide: EventEmitter2,
        useValue: {
          emit: (name: string, payload: unknown) => {
            emittedEvents.push({ name, payload });
            return true;
          },
          emitAsync: async (name: string, payload: unknown) => {
            emittedEvents.push({ name, payload });
            return [];
          },
          on: () => undefined,
          off: () => undefined,
          once: () => undefined,
          removeListener: () => undefined,
        },
      },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
    ],
  }).compile();

  commerceService = moduleRef.get(CommerceService);
  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const id = typeof req.headers[HEADER] === 'string' ? req.headers[HEADER] : undefined;
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
  await clearRateLimits();

  for (const [id, email, role] of [
    [ID.ownerA, `${P}owner-a@test.local`, 'USER'],
    [ID.staffReadA, `${P}staff-read-a@test.local`, 'USER'],
    [ID.staffNoneA, `${P}staff-none-a@test.local`, 'USER'],
    [ID.ownerB, `${P}owner-b@test.local`, 'USER'],
    [ID.superAdmin, `${P}super@test.local`, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email, role } });
  }

  await db.business.create({ data: { id: ID.bizA, name: 'V65D Biz A', slug: `${P}biz-a`, ownerId: ID.ownerA, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'V65D Biz B', slug: `${P}biz-b`, ownerId: ID.ownerB, currency: 'TTD' } });

  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({
    data: {
      id: `${P}m_staffReadA`,
      userId: ID.staffReadA,
      businessId: ID.bizA,
      role: 'STAFF',
      permissionScopes: { revenue: 'read' },
    },
  });
  await db.membership.create({
    data: {
      id: `${P}m_staffNoneA`,
      userId: ID.staffNoneA,
      businessId: ID.bizA,
      role: 'STAFF',
      permissionScopes: { revenue: 'none' },
    },
  });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });

  await db.contact.create({
    data: { id: ID.contactA, businessId: ID.bizA, firstName: 'Maria', lastName: 'Singh', email: `${P}maria@test.local`, phone: '+18685550101' },
  });
  await db.contact.create({
    data: { id: ID.contactB, businessId: ID.bizB, firstName: 'Devon', lastName: 'Ali', email: `${P}devon@test.local`, phone: '+18685550102' },
  });

  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.bizA);
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.bizB);
});

beforeEach(async () => {
  emittedEvents.length = 0;
  await cleanupDynamicRows();
  await clearRateLimits();
});

afterAll(async () => {
  await cleanup();
  await clearRateLimits();
  if (app) await app.close();
  if (redis) await redis.quit();
});

describe('P76 — V1-65 (CLAIM-LOOP, P0): Bank-transfer claim loop', () => {
  it('[CL-01] RED-BEFORE: anonymous payment intent emits invoice.payment_claimed once after commit, appears in GET claims, and writes zero ledger rows', async () => {
    const { invoice, token } = await seedSentInvoiceWithLink(ID.bizA, ID.contactA, 450);
    const before = await ledgerCounts(ID.bizA);

    const intentRes = await request(app.getHttpServer())
      .post(`/commerce/public/invoice-link/${token}/payment-intent`)
      .send({ method: 'bank_transfer' });
    expect(intentRes.status).toBe(201);

    const claimEvents = emittedEvents.filter((e) => e.name === 'invoice.payment_claimed');
    expect(claimEvents).toHaveLength(1);
    expect(claimEvents[0].payload).toMatchObject({
      businessId: ID.bizA,
      invoiceId: invoice.id,
      method: 'bank_transfer',
      amount: 450,
      currency: 'TTD',
      customerName: 'Maria Singh',
      invoice: expect.objectContaining({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      }),
    });
    expect(typeof claimEvents[0].payload.claimId).toBe('string');

    // No ledger write on claim itself; invoice remains SENT.
    expect(await ledgerCounts(ID.bizA)).toEqual(before);
    const invRow = await db.invoice.findUnique({ where: { id: invoice.id }, select: { status: true } });
    expect(invRow.status).toBe('SENT');

    const listRes = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/claims`)
      .set(HEADER, ID.ownerA);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0]).toMatchObject({
      id: claimEvents[0].payload.claimId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      method: 'bank_transfer',
      amount: 450,
      remaining: 450,
      currency: 'TTD',
      customerName: 'Maria Singh',
    });
  });

  it('[CL-02] RED-BEFORE: POST claims/:id/confirm records 1 payment + 1 ledger posting + 1 invoice.paid event, projects invoice safely, and a second confirm is idempotent', async () => {
    const { invoice, token } = await seedSentInvoiceWithLink(ID.bizA, ID.contactA, 450);

    await request(app.getHttpServer())
      .post(`/commerce/public/invoice-link/${token}/payment-intent`)
      .send({ method: 'bank_transfer' })
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/claims`)
      .set(HEADER, ID.ownerA)
      .expect(200);
    const claimId = listRes.body[0].id as string;
    emittedEvents.length = 0;

    const confirm1 = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizA}/claims/${claimId}/confirm`)
      .set(HEADER, ID.ownerA)
      .send({});
    expect([200, 201]).toContain(confirm1.status);
    expect(confirm1.body.claimId).toBe(claimId);
    expect(confirm1.body.payment).toMatchObject({
      amount: 450,
      status: 'SUCCESSFUL',
      recordedBy: ID.ownerA,
    });
    expect(confirm1.body.invoice.status).toBe('PAID');
    // Contact PII projection safety (SEC3-ST-1 / DISC-V41-6): never leak raw contact phone/metaData.
    expect(confirm1.body.invoice.contact?.phone).toBeUndefined();

    const after1 = await ledgerCounts(ID.bizA);
    expect(after1.txCount).toBe(1);
    expect(after1.entryCount).toBeGreaterThanOrEqual(2);

    const paidEvents1 = emittedEvents.filter((e) => e.name === 'invoice.paid');
    expect(paidEvents1).toHaveLength(1);

    const paymentsAfter1 = await db.payment.findMany({
      where: { businessId: ID.bizA, invoiceId: invoice.id, status: 'SUCCESSFUL' },
    });
    expect(paymentsAfter1).toHaveLength(1);

    // Claim list is now empty.
    const listAfter = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/claims`)
      .set(HEADER, ID.ownerA)
      .expect(200);
    expect(listAfter.body).toEqual([]);

    // Second confirm on the same claimId is idempotent: writes nothing, emits nothing.
    const confirm2 = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizA}/claims/${claimId}/confirm`)
      .set(HEADER, ID.ownerA)
      .send({});
    expect([200, 201]).toContain(confirm2.status);
    expect(confirm2.body.payment.id).toBe(confirm1.body.payment.id);
    expect(await ledgerCounts(ID.bizA)).toEqual(after1);
    expect(emittedEvents.filter((e) => e.name === 'invoice.paid')).toHaveLength(1);
    const paymentsAfter2 = await db.payment.findMany({
      where: { businessId: ID.bizA, invoiceId: invoice.id, status: 'SUCCESSFUL' },
    });
    expect(paymentsAfter2).toHaveLength(1);
  });

  it('[CL-03] RED-BEFORE: POST claims/:id/dismiss leaves invoice SENT with zero ledger rows, blocks confirm with 409, and a subsequent intent opens 1 new claim + 1 new event', async () => {
    const { invoice, token } = await seedSentInvoiceWithLink(ID.bizA, ID.contactA, 380);
    const before = await ledgerCounts(ID.bizA);

    await request(app.getHttpServer())
      .post(`/commerce/public/invoice-link/${token}/payment-intent`)
      .send({ method: 'bank_transfer' })
      .expect(201);

    const list1 = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/claims`)
      .set(HEADER, ID.ownerA)
      .expect(200);
    expect(list1.body).toHaveLength(1);
    const claimId1 = list1.body[0].id as string;

    const dismissRes = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizA}/claims/${claimId1}/dismiss`)
      .set(HEADER, ID.ownerA)
      .send({});
    expect([200, 201]).toContain(dismissRes.status);
    expect(await ledgerCounts(ID.bizA)).toEqual(before);

    const invRow = await db.invoice.findUnique({ where: { id: invoice.id }, select: { status: true } });
    expect(invRow.status).toBe('SENT');

    const listAfterDismiss = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/claims`)
      .set(HEADER, ID.ownerA)
      .expect(200);
    expect(listAfterDismiss.body).toEqual([]);

    // Confirming a dismissed claim is refused with 409.
    const confirmDismissed = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizA}/claims/${claimId1}/confirm`)
      .set(HEADER, ID.ownerA)
      .send({});
    expect(confirmDismissed.status).toBe(409);

    // A new customer intent after dismissal opens 1 fresh claim + emits 1 fresh event.
    emittedEvents.length = 0;
    await request(app.getHttpServer())
      .post(`/commerce/public/invoice-link/${token}/payment-intent`)
      .send({ method: 'bank_transfer' })
      .expect(201);

    expect(emittedEvents.filter((e) => e.name === 'invoice.payment_claimed')).toHaveLength(1);
    const list2 = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/claims`)
      .set(HEADER, ID.ownerA)
      .expect(200);
    expect(list2.body).toHaveLength(1);
    expect(list2.body[0].id).not.toBe(claimId1);
  });

  it('[CL-04] RED-BEFORE (abuse): 20 mixed-method intents on one invoice emit exactly 1 payment_claimed event and show 1 claim row; confirming retires all pending rows for that invoice', async () => {
    const { invoice } = await seedSentInvoiceWithLink(ID.bizA, ID.contactA, 500);
    const methods = ['bank_transfer', 'cash', 'check', 'other', 'google_pay'] as const;

    for (let i = 0; i < 20; i += 1) {
      const method = methods[i % methods.length];
      const amount = i % 3 === 0 ? undefined : 100 + i;
      await commerceService.recordPublicPaymentIntent(invoice.id, method, amount);
    }

    const claimEvents = emittedEvents.filter((e) => e.name === 'invoice.payment_claimed');
    expect(claimEvents).toHaveLength(1);

    const listRes = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/claims`)
      .set(HEADER, ID.ownerA)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].invoiceId).toBe(invoice.id);

    // Confirming that 1 claim retires ALL underlying pending intent rows on the invoice.
    const claimId = listRes.body[0].id as string;
    const confirmRes = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizA}/claims/${claimId}/confirm`)
      .set(HEADER, ID.ownerA)
      .send({ amount: 500 });
    expect([200, 201]).toContain(confirmRes.status);

    const listAfter = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/claims`)
      .set(HEADER, ID.ownerA)
      .expect(200);
    expect(listAfter.body).toEqual([]);
  });

  it('[CL-05] RED-BEFORE (RBAC, D-46, tenancy, scope): STAFF without revenue:write refused 403, non-member SUPER_ADMIN refused 403 on writes, tenant B isolated, extracted-evidence rows excluded', async () => {
    const { invoice, token } = await seedSentInvoiceWithLink(ID.bizA, ID.contactA, 200);
    await request(app.getHttpServer())
      .post(`/commerce/public/invoice-link/${token}/payment-intent`)
      .send({ method: 'bank_transfer' })
      .expect(201);

    // Also seed an extracted-evidence PENDING row — must NEVER appear in claims or be confirmed via claims route.
    const extracted = await db.payment.create({
      data: {
        id: `${P}ext_1`,
        businessId: ID.bizA,
        invoiceId: invoice.id,
        amount: 200,
        currency: 'TTD',
        status: 'PENDING',
        provider: 'EXTRACTED',
        method: 'bank_transfer',
        providerPaymentId: `extracted_${invoice.id}_${P}1`,
      },
    });

    const ownerList = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/claims`)
      .set(HEADER, ID.ownerA)
      .expect(200);
    expect(ownerList.body).toHaveLength(1);
    const claimId = ownerList.body[0].id as string;
    expect(claimId).not.toBe(extracted.id);

    // STAFF with revenue:read and STAFF with revenue:none both refused 403 on all 3 claim routes.
    for (const actor of [ID.staffReadA, ID.staffNoneA]) {
      expect(
        (await request(app.getHttpServer()).get(`/commerce/businesses/${ID.bizA}/claims`).set(HEADER, actor)).status,
      ).toBe(403);
      expect(
        (await request(app.getHttpServer()).post(`/commerce/businesses/${ID.bizA}/claims/${claimId}/confirm`).set(HEADER, actor).send({})).status,
      ).toBe(403);
      expect(
        (await request(app.getHttpServer()).post(`/commerce/businesses/${ID.bizA}/claims/${claimId}/dismiss`).set(HEADER, actor).send({})).status,
      ).toBe(403);
    }

    // D-46: non-member SUPER_ADMIN refused 403 on confirm and dismiss.
    expect(
      (await request(app.getHttpServer()).post(`/commerce/businesses/${ID.bizA}/claims/${claimId}/confirm`).set(HEADER, ID.superAdmin).send({})).status,
    ).toBe(403);
    expect(
      (await request(app.getHttpServer()).post(`/commerce/businesses/${ID.bizA}/claims/${claimId}/dismiss`).set(HEADER, ID.superAdmin).send({})).status,
    ).toBe(403);

    // Tenant isolation: Biz B sees 0 claims and gets 404 targeting Biz A's claim id.
    const bizBList = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizB}/claims`)
      .set(HEADER, ID.ownerB)
      .expect(200);
    expect(bizBList.body).toEqual([]);
    expect(
      (await request(app.getHttpServer()).post(`/commerce/businesses/${ID.bizB}/claims/${claimId}/confirm`).set(HEADER, ID.ownerB).send({})).status,
    ).toBe(404);
    expect(
      (await request(app.getHttpServer()).post(`/commerce/businesses/${ID.bizB}/claims/${claimId}/dismiss`).set(HEADER, ID.ownerB).send({})).status,
    ).toBe(404);

    // Extracted-evidence row cannot be confirmed/dismissed through the customer claims routes.
    expect(
      (await request(app.getHttpServer()).post(`/commerce/businesses/${ID.bizA}/claims/${extracted.id}/confirm`).set(HEADER, ID.ownerA).send({})).status,
    ).toBe(404);
    expect(
      (await request(app.getHttpServer()).post(`/commerce/businesses/${ID.bizA}/claims/${extracted.id}/dismiss`).set(HEADER, ID.ownerA).send({})).status,
    ).toBe(404);
  });

  it('[CL-06] RED-BEFORE: partial confirm amount updates invoice to PARTIALLY_PAID; invalid amount returns 400 leaving claim intact', async () => {
    const { invoice, token } = await seedSentInvoiceWithLink(ID.bizA, ID.contactA, 450);
    await request(app.getHttpServer())
      .post(`/commerce/public/invoice-link/${token}/payment-intent`)
      .send({ method: 'bank_transfer' })
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/claims`)
      .set(HEADER, ID.ownerA)
      .expect(200);
    const claimId = listRes.body[0].id as string;

    // Invalid amounts rejected 400; claim stays pending.
    for (const badAmount of [-10, 0, 'abc', 9999]) {
      const bad = await request(app.getHttpServer())
        .post(`/commerce/businesses/${ID.bizA}/claims/${claimId}/confirm`)
        .set(HEADER, ID.ownerA)
        .send({ amount: badAmount });
      expect(bad.status).toBe(400);
    }
    const stillPending = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/claims`)
      .set(HEADER, ID.ownerA)
      .expect(200);
    expect(stillPending.body).toHaveLength(1);

    // Valid partial confirm records 150 -> PARTIALLY_PAID, clears claim.
    const partial = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizA}/claims/${claimId}/confirm`)
      .set(HEADER, ID.ownerA)
      .send({ amount: 150 });
    expect([200, 201]).toContain(partial.status);
    expect(partial.body.payment.amount).toBe(150);
    expect(partial.body.invoice.status).toBe('PARTIALLY_PAID');

    const invAfter = await db.invoice.findUnique({ where: { id: invoice.id }, select: { status: true } });
    expect(invAfter.status).toBe('PARTIALLY_PAID');
  });
});
