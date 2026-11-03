/**
 * V1-41-DM-UNTRUSTED-MONEY-INPUTS (M32, G14; owner ruling D-27) - REAL database.
 *
 * D-27: payments extracted from evidence or Drive intake are recorded PENDING
 * and move no balance until a member confirms them.
 *
 * Before this packet both untrusted inputs settled money on their own:
 *   - POST .../invoices/:id/payments/from-evidence ran the AI extraction and
 *     handed its amount straight to CommerceService.recordPayment, which wrote
 *     a SUCCESSFUL Payment, posted Payment:<id>:payment_recorded and moved the
 *     invoice to PARTIALLY_PAID / PAID (payment-evidence.service.ts);
 *   - an approved Drive intake plan's record_payment step did the same with the
 *     amount read from the document (drive-intake-orchestrator.service.ts). The
 *     approve route needs no revenue:write, and the ingestion auto-execute runs
 *     it with no human at all.
 *
 * Contract pinned here:
 *   V41-01/02  each untrusted input writes one PENDING row (recorder kept), no
 *              posting, the invoice status and the V1-36 balance (GET
 *              .../invoices/:id/payments, balanceOfStoredRows) unchanged.
 *   V41-03/04  PaymentEvidenceService.confirmPendingPayment(paymentId,
 *              businessId, memberId): a member with revenue:write confirms; the
 *              money is recorded through the existing operator door
 *              (CommerceService.recordPayment) as that member: one SUCCESSFUL
 *              row recorded by the member, exactly one
 *              Payment:<id>:payment_recorded posting created by the member, the
 *              invoice reconciled; the pending row is retired (CONFIRMED), never
 *              posted, and keeps its recorder.
 *   V41-05..09 refusals write nothing: a foreign row (404) or a business the
 *              member is not in (403); an already-confirmed row (409); a member
 *              with revenue:read only (403); a row of this tenant that was not
 *              extracted from an untrusted input (409); two concurrent confirms
 *              record the money once.
 *   V41-10     a Drive plan re-run after its payment was confirmed writes no
 *              second pending row and no second payment.
 *
 * Nothing on the authorization or money boundary is mocked: PrismaService,
 * AuthGuard, BusinessGuard, ModuleScopeGuard, CommerceService,
 * InvoiceWorkflowService, RevenuePostingService, PostingService, the chart of
 * accounts, PaymentEvidenceService, DriveIntakeController and
 * DriveIntakeOrchestrator are real against DATABASE_URL. Identity attachment is
 * a test middleware reading `x-v41a-user` (as the Supabase AuthMiddleware would
 * attach it). No provider traffic: document intelligence (the LLM boundary)
 * answers what the next receipt "says", and the Drive download, messaging,
 * oversight, credit-note and task collaborators are stubs the seeded plans
 * never reach.
 *
 * Fixtures: prefix `v41a_` (registered in test/helpers/fixture-prefixes.json),
 * hard-deleted by raw SQL matched through sqlLikePrefix, in dependency order
 * in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v41a_';
const HEADER = 'x-v41a-user';
/** Mirrors KEY_SYSTEM_ACTOR_ID (src/core/auth/system-actor.ts). */
const KEY_ACTOR = 'key_ai';
const INVOICE_TOTAL = 100;

const ID = {
  owner: `${P}owner`, // OWNER of bizA
  writer: `${P}writer`, // STAFF of bizA, revenue:write
  reader: `${P}reader`, // STAFF of bizA, revenue:read
  ownerB: `${P}ownerB`, // OWNER of bizB only
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  // one invoice per case, so balances never bleed between cases
  invEvidence: `${P}invEvidence`,
  invDrive: `${P}invDrive`,
  invEvConfirm: `${P}invEvConfirm`,
  invDrvConfirm: `${P}invDrvConfirm`,
  invEvTwice: `${P}invEvTwice`,
  invEvReader: `${P}invEvReader`,
  invEvRace: `${P}invEvRace`,
  invNotExtracted: `${P}invNotExtracted`,
  invDrvRerun: `${P}invDrvRerun`,
  invB: `${P}invB`, // bizB
};

let db: any;
let app: any;
let redis: any;
let evidence: any;
let commerce: any;

// Document intelligence (the LLM boundary) returns what the next receipt "says".
let nextExtraction: Record<string, unknown> = {};
const docIntelStub = { extractFromDocument: async () => nextExtraction };

const eventStub = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM drive_intake_files WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}

function fromEvidenceAs(user: string, biz: string, inv: string, filename: string) {
  return agent()
    .post(`/commerce/businesses/${biz}/invoices/${inv}/payments/from-evidence`)
    .set(HEADER, user)
    .send({ evidenceUrl: `https://evidence.test/${filename}`, evidenceMimeType: 'application/pdf', filename, source: 'upload' });
}

function approveIntakeAs(user: string, intakeId: string) {
  return agent().post(`/drive/businesses/${ID.bizA}/intake/${intakeId}/approve`).set(HEADER, user).send({});
}

/** The V1-36 balance read contract as the operator route serves it. */
async function balanceOf(inv: string, biz = ID.bizA, user = ID.owner) {
  const res = await agent().get(`/commerce/businesses/${biz}/invoices/${inv}/payments`).set(HEADER, user);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { paidAmount: res.body.paidAmount, remaining: res.body.remaining };
}

async function paymentsOf(invoiceId: string): Promise<any[]> {
  return db.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } });
}

async function invoiceStatus(invoiceId: string): Promise<string> {
  return (await db.invoice.findUnique({ where: { id: invoiceId }, select: { status: true } })).status;
}

/** Every ledger transaction sourced from a Payment row of this invoice. */
async function paymentPostingsOf(invoiceId: string): Promise<any[]> {
  const ids = (await paymentsOf(invoiceId)).map((p) => p.id);
  if (ids.length === 0) return [];
  return db.financialTransaction.findMany({ where: { sourceType: 'Payment', sourceId: { in: ids } } });
}

async function postingsFor(paymentId: string): Promise<any[]> {
  return db.financialTransaction.findMany({ where: { externalRef: `Payment:${paymentId}:payment_recorded` } });
}

/** A snapshot of everything a refused confirm must leave untouched. */
async function moneyStateOf(invoiceId: string) {
  const payments = (await paymentsOf(invoiceId)).map((p) => ({ id: p.id, status: p.status, amount: p.amount, recordedBy: p.recordedBy }));
  const postings = (await paymentPostingsOf(invoiceId)).map((t) => ({ id: t.id, status: t.status, externalRef: t.externalRef }));
  return { payments, postings, status: await invoiceStatus(invoiceId) };
}

/** The HTTP status a service call refuses with, or 'ok'. A TypeError (no such door) is reported as its name. */
async function outcomeOf(promise: Promise<unknown>): Promise<number | string> {
  try {
    await promise;
    return 'ok';
  } catch (err: any) {
    if (typeof err?.getStatus === 'function') return err.getStatus();
    return err?.name ?? 'error';
  }
}

function confirm(paymentId: string, businessId: string, memberId: string) {
  // V1-41: the confirm door; absent before this packet (TypeError).
  return Promise.resolve().then(() => evidence.confirmPendingPayment(paymentId, businessId, memberId));
}

/** Seed a drive intake awaiting approval whose plan records one payment on `invoiceId`. */
async function seedDriveIntake(id: string, invoiceId: string, payload: Record<string, unknown>) {
  await db.driveIntakeFile.create({
    data: {
      id,
      businessId: ID.bizA,
      driveFileId: `${id}_file`,
      name: `${id}.pdf`,
      mimeType: 'application/pdf',
      modifiedTime: new Date(),
      status: 'reviewing',
      documentType: 'receipt',
      proposedActions: {
        intakeFileId: id,
        documentType: 'receipt',
        summary: 'v41a drive receipt',
        actions: [{ type: 'record_payment', payload: { invoiceId, ...payload } }],
      },
    },
  });
}

/** Writes one evidence-extracted payment of `amount` on `inv` through the real route. */
async function evidencePayment(user: string, biz: string, inv: string, amount: number, filename: string) {
  nextExtraction = {
    documentType: 'receipt',
    confidence: 0.91,
    invoiceData: { total: amount, invoiceNumber: `${inv}-REF`, notes: 'bank transfer' },
  };
  const res = await fromEvidenceAs(user, biz, inv, filename);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
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
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { DriveIntakeController } = await import('../src/modules/commerce/drive-intake.controller');
  const { DriveIntakeOrchestrator } = await import('../src/modules/commerce/drive-intake-orchestrator.service');
  const { ConnectorIntelligenceService } = await import('../src/modules/ai/connector-intelligence.service');
  const { CrmCommunicationService } = await import('../src/modules/crm/crm-communication.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { CreditNoteService } = await import('../src/modules/finance/credit-note.service');

  // What tsc emits for DriveIntakeController's constructor (vitest's esbuild
  // transform emits no design:paramtypes; payments-actor does the same).
  if (!Reflect.getMetadata('design:paramtypes', DriveIntakeController)) {
    Reflect.defineMetadata('design:paramtypes', [ConnectorIntelligenceService, DriveIntakeOrchestrator, PrismaService], DriveIntakeController);
  }

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController, DriveIntakeController],
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
      // Real ledger chain: the proof is the posted rows.
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: {} },
      { provide: EventEmitter2, useValue: eventStub },
      // Real contact timeline behind CrmService.logContactEvent.
      CrmTimelineService,
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      {
        provide: CrmService,
        useFactory: (t: InstanceType<typeof CrmTimelineService>) => ({
          logContactEvent: (input: Parameters<InstanceType<typeof CrmTimelineService>['logContactEvent']>[0]) => t.logContactEvent(input),
        }),
        inject: [CrmTimelineService],
      },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      // The real PaymentEvidenceService; the LLM extraction and the Drive download are stubs.
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: docIntelStub },
      { provide: GoogleDriveService, useValue: {} },
      // The real DriveIntakeOrchestrator; the seeded plans carry only
      // record_payment steps and no contact, so these stubs are never called.
      DriveIntakeOrchestrator,
      { provide: ConnectorIntelligenceService, useValue: {} },
      { provide: CrmCommunicationService, useValue: {} },
      { provide: TransactionalEmailService, useValue: {} },
      { provide: AiOversightService, useValue: { resolveApproval: async () => undefined } },
      { provide: CreditNoteService, useValue: {} },
    ],
  }).compile();
  evidence = moduleRef.get(PaymentEvidenceService);
  commerce = moduleRef.get(CommerceService);

  app = moduleRef.createNestApplication();
  // Identity attachment only. No guard is overridden.
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

  await cleanup(); // in case a prior run aborted

  for (const [id, name] of [[ID.owner, 'owner'], [ID.writer, 'writer'], [ID.reader, 'reader'], [ID.ownerB, 'ownerB']]) {
    await db.user.create({ data: { id, email: `${P}${name}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V41A Biz A', ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'V41A Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({
    data: { id: `${P}m_writer`, userId: ID.writer, businessId: ID.bizA, role: 'STAFF', permissionScopes: { revenue: 'write' } },
  });
  await db.membership.create({
    data: { id: `${P}m_reader`, userId: ID.reader, businessId: ID.bizA, role: 'STAFF', permissionScopes: { revenue: 'read' } },
  });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'Vfa', lastName: 'Customer', email: `${P}ca@test.local` } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'Vfb', lastName: 'Customer', email: `${P}cb@test.local` } });
  const seeder = moduleRef.get(ChartOfAccountsSeederService);
  await seeder.ensureDefaults(ID.bizA);
  await seeder.ensureDefaults(ID.bizB);

  let n = 0;
  for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
    n += 1;
    const inB = id === ID.invB;
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `V41A-${String(n).padStart(3, '0')}`,
        status: 'SENT',
        subtotal: INVOICE_TOTAL,
        total: INVOICE_TOTAL,
        currency: 'TTD',
        businessId: inB ? ID.bizB : ID.bizA,
        contactId: inB ? ID.contactB : ID.contactA,
        items: { create: [{ id: `${id}_item1`, description: `V41A item ${n}`, quantity: 1, unitPrice: INVOICE_TOTAL, total: INVOICE_TOTAL }] },
      },
    });
  }
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

describe('fixture sanity (real rows)', () => {
  it('V41-00: two tenants, a revenue:write and a revenue:read member in A, one SENT invoice per case with no payment and no posting', async () => {
    const members = await db.membership.findMany({ where: { businessId: ID.bizA }, orderBy: { userId: 'asc' } });
    expect(members.map((m: any) => [m.userId, m.role])).toEqual([
      [ID.owner, 'OWNER'],
      [ID.reader, 'STAFF'],
      [ID.writer, 'STAFF'],
    ]);
    for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
      expect(await paymentsOf(id), id).toHaveLength(0);
      expect(await invoiceStatus(id), id).toBe('SENT');
    }
  });
});

describe('D-27: an untrusted input is recorded PENDING and moves no balance (RED before V1-41)', () => {
  it('V41-01: an AI-extracted amount from payment evidence (POST .../payments/from-evidence) writes one PENDING row recorded by KEY; no posting, the invoice stays SENT and the balance is unchanged', async () => {
    const body = await evidencePayment(ID.owner, ID.bizA, ID.invEvidence, 45, 'v41a-ev1.pdf');

    const rows = await paymentsOf(ID.invEvidence);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'PENDING',
      amount: 45,
      businessId: ID.bizA,
      recordedBy: KEY_ACTOR,
      evidenceUrl: 'https://evidence.test/v41a-ev1.pdf',
    });
    expect(body.payment).toMatchObject({ id: rows[0].id, status: 'PENDING', amount: 45 });
    expect(body.invoiceStatus).toBe('SENT');
    // LEDGER: zero FinancialTransaction rows before confirmation.
    expect(await paymentPostingsOf(ID.invEvidence)).toHaveLength(0);
    expect(await invoiceStatus(ID.invEvidence)).toBe('SENT');
    expect(await balanceOf(ID.invEvidence)).toEqual({ paidAmount: 0, remaining: INVOICE_TOTAL });
  });

  it('V41-02: an approved Drive intake record_payment step (POST /drive/businesses/:b/intake/:id/approve) writes one PENDING row recorded by the approver; no posting, the invoice stays SENT and the balance is unchanged', async () => {
    const intakeId = `${P}drive_pending`;
    await seedDriveIntake(intakeId, ID.invDrive, { amount: 30, method: 'bank_transfer', reference: 'V41A-DRV-1' });

    const res = await approveIntakeAs(ID.writer, intakeId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.success, JSON.stringify(res.body)).toBe(true);

    const rows = await paymentsOf(ID.invDrive);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'PENDING', amount: 30, reference: 'V41A-DRV-1', recordedBy: ID.writer });
    expect(res.body.results).toEqual([expect.objectContaining({ action: 'record_payment', success: true, entityId: rows[0].id })]);
    expect(await paymentPostingsOf(ID.invDrive)).toHaveLength(0);
    expect(await invoiceStatus(ID.invDrive)).toBe('SENT');
    expect(await balanceOf(ID.invDrive)).toEqual({ paidAmount: 0, remaining: INVOICE_TOTAL });
    expect((await db.driveIntakeFile.findUnique({ where: { id: intakeId } })).status).toBe('approved');
  });
});

describe('D-27: a member with revenue:write confirms through the operator door', () => {
  it('V41-03: the writer confirms an evidence-extracted pending payment -> one SUCCESSFUL row recorded by the writer, exactly one Payment:<id>:payment_recorded posting by the writer, the invoice PARTIALLY_PAID; the pending row is retired, never posted, and keeps KEY as its recorder', async () => {
    const body = await evidencePayment(ID.owner, ID.bizA, ID.invEvConfirm, 45, 'v41a-ev-confirm.pdf');
    const pendingId = body.payment.id;
    expect(await paymentPostingsOf(ID.invEvConfirm)).toHaveLength(0);

    const result = await confirm(pendingId, ID.bizA, ID.writer);
    expect(result.payment).toMatchObject({ status: 'SUCCESSFUL', amount: 45, recordedBy: ID.writer });
    const confirmedId = result.payment.id;
    expect(confirmedId).not.toBe(pendingId);

    const rows = await paymentsOf(ID.invEvConfirm);
    expect(rows.map((r) => [r.id, r.status, r.amount, r.recordedBy])).toEqual([
      [pendingId, 'CONFIRMED', 45, KEY_ACTOR],
      [confirmedId, 'SUCCESSFUL', 45, ID.writer],
    ]);
    expect(rows[1].evidenceUrl).toBe('https://evidence.test/v41a-ev-confirm.pdf');
    // LEDGER: exactly one Payment:<id>:payment_recorded after confirmation.
    const postings = await paymentPostingsOf(ID.invEvConfirm);
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({
      externalRef: `Payment:${confirmedId}:payment_recorded`,
      status: 'POSTED',
      createdById: ID.writer,
    });
    expect(await postingsFor(pendingId)).toHaveLength(0);
    expect(await invoiceStatus(ID.invEvConfirm)).toBe('PARTIALLY_PAID');
    expect(await balanceOf(ID.invEvConfirm)).toEqual({ paidAmount: 45, remaining: 55 });
  });

  it('V41-04: the owner confirms a Drive-intake pending payment the writer approved -> recorded and posted once by the owner; the invoice PAID', async () => {
    const intakeId = `${P}drive_confirm`;
    await seedDriveIntake(intakeId, ID.invDrvConfirm, { amount: 100, method: 'cash', reference: 'V41A-DRV-2' });
    const approved = await approveIntakeAs(ID.writer, intakeId);
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    const [pending] = await paymentsOf(ID.invDrvConfirm);
    expect(pending).toMatchObject({ status: 'PENDING', recordedBy: ID.writer });

    const result = await confirm(pending.id, ID.bizA, ID.owner);
    expect(result.payment).toMatchObject({ status: 'SUCCESSFUL', amount: 100, recordedBy: ID.owner, reference: 'V41A-DRV-2' });

    const rows = await paymentsOf(ID.invDrvConfirm);
    expect(rows.map((r) => [r.status, r.recordedBy])).toEqual([
      ['CONFIRMED', ID.writer],
      ['SUCCESSFUL', ID.owner],
    ]);
    const postings = await paymentPostingsOf(ID.invDrvConfirm);
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({ externalRef: `Payment:${result.payment.id}:payment_recorded`, createdById: ID.owner });
    expect(await invoiceStatus(ID.invDrvConfirm)).toBe('PAID');
    expect(await balanceOf(ID.invDrvConfirm)).toEqual({ paidAmount: 100, remaining: 0 });
  });
});

describe('D-27: refused confirmations write nothing', () => {
  it('V41-05: a pending row of another tenant cannot be confirmed: under the member\'s own business it is 404, under the foreign business (not a member) 403; nothing is written in either tenant', async () => {
    const body = await evidencePayment(ID.ownerB, ID.bizB, ID.invB, 40, 'v41a-ev-foreign.pdf');
    const foreignId = body.payment.id;
    const before = await moneyStateOf(ID.invB);

    expect(await outcomeOf(confirm(foreignId, ID.bizA, ID.owner))).toBe(404);
    expect(await outcomeOf(confirm(foreignId, ID.bizB, ID.owner))).toBe(403);

    expect(await moneyStateOf(ID.invB)).toEqual(before);
    expect(before.payments).toEqual([expect.objectContaining({ id: foreignId, status: 'PENDING' })]);
    expect(before.postings).toHaveLength(0);
  });

  it('V41-06: an already-confirmed pending row cannot be confirmed again -> 409; no second payment and no second posting', async () => {
    const body = await evidencePayment(ID.owner, ID.bizA, ID.invEvTwice, 20, 'v41a-ev-twice.pdf');
    const first = await confirm(body.payment.id, ID.bizA, ID.writer);
    expect(first.payment.status).toBe('SUCCESSFUL');
    const before = await moneyStateOf(ID.invEvTwice);

    expect(await outcomeOf(confirm(body.payment.id, ID.bizA, ID.owner))).toBe(409);
    expect(await outcomeOf(confirm(body.payment.id, ID.bizA, ID.writer))).toBe(409);

    expect(await moneyStateOf(ID.invEvTwice)).toEqual(before);
    expect(before.postings).toHaveLength(1);
    expect(await balanceOf(ID.invEvTwice)).toEqual({ paidAmount: 20, remaining: 80 });
  });

  it('V41-07: a member with revenue:read only cannot confirm -> 403; the row stays PENDING and nothing is posted', async () => {
    const body = await evidencePayment(ID.owner, ID.bizA, ID.invEvReader, 15, 'v41a-ev-reader.pdf');
    const before = await moneyStateOf(ID.invEvReader);

    expect(await outcomeOf(confirm(body.payment.id, ID.bizA, ID.reader))).toBe(403);

    expect(await moneyStateOf(ID.invEvReader)).toEqual(before);
    expect(before.payments).toEqual([expect.objectContaining({ status: 'PENDING' })]);
    expect(before.postings).toHaveLength(0);
  });

  it('V41-08: two members confirm the same pending row concurrently -> the money is recorded and posted once; one confirm succeeds, the other answers 409', async () => {
    const body = await evidencePayment(ID.owner, ID.bizA, ID.invEvRace, 35, 'v41a-ev-race.pdf');

    const outcomes = await Promise.all([
      outcomeOf(confirm(body.payment.id, ID.bizA, ID.owner)),
      outcomeOf(confirm(body.payment.id, ID.bizA, ID.writer)),
    ]);
    expect(outcomes.slice().sort()).toEqual([409, 'ok']);

    const rows = await paymentsOf(ID.invEvRace);
    expect(rows.map((r) => r.status).sort()).toEqual(['CONFIRMED', 'SUCCESSFUL']);
    const successful = rows.find((r) => r.status === 'SUCCESSFUL');
    const postings = await paymentPostingsOf(ID.invEvRace);
    expect(postings).toHaveLength(1);
    expect(postings[0].externalRef).toBe(`Payment:${successful.id}:payment_recorded`);
    expect(await balanceOf(ID.invEvRace)).toEqual({ paidAmount: 35, remaining: 65 });
  });

  it('V41-09: a row of this tenant that no untrusted input wrote (a member-recorded payment, a customer payment intent) is not confirmable here -> 409; nothing is written', async () => {
    const recorded = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${ID.invNotExtracted}/payments`)
      .set(HEADER, ID.owner)
      .send({ amount: 10, method: 'cash', reference: 'V41A-MANUAL-1' });
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(201);
    await commerce.recordPublicPaymentIntent(ID.invNotExtracted, 'cash', 5);
    const before = await moneyStateOf(ID.invNotExtracted);
    const intent = before.payments.find((p) => p.status === 'PENDING');
    expect(intent).toBeDefined();

    expect(await outcomeOf(confirm(recorded.body.payment.id, ID.bizA, ID.owner))).toBe(409);
    expect(await outcomeOf(confirm(intent!.id, ID.bizA, ID.owner))).toBe(409);

    expect(await moneyStateOf(ID.invNotExtracted)).toEqual(before);
    expect(before.postings).toHaveLength(1);
  });
});

describe('D-27: the Drive step stays idempotent across confirmation', () => {
  it('V41-10: a Drive plan re-run after its payment was confirmed (status back to reviewing, as after a crash before the approved flip) writes no second pending row and no second payment', async () => {
    const intakeId = `${P}drive_rerun`;
    await seedDriveIntake(intakeId, ID.invDrvRerun, { amount: 25, method: 'cash', reference: 'V41A-DRV-RERUN' });
    const first = await approveIntakeAs(ID.writer, intakeId);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const pendingId = first.body.results[0].entityId;
    await confirm(pendingId, ID.bizA, ID.owner);
    const before = await moneyStateOf(ID.invDrvRerun);

    await db.driveIntakeFile.update({ where: { id: intakeId }, data: { status: 'reviewing', processedAt: null } });
    const second = await approveIntakeAs(ID.owner, intakeId);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body.results[0]).toMatchObject({ action: 'record_payment', success: true, entityId: pendingId });

    expect(await moneyStateOf(ID.invDrvRerun)).toEqual(before);
    expect(before.payments.map((p) => p.status)).toEqual(['CONFIRMED', 'SUCCESSFUL']);
    expect(before.postings).toHaveLength(1);
  });
});
