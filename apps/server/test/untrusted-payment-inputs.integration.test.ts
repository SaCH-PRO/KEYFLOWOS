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
 * Review repairs (V1-41 review):
 *   V41-11/12  SEC-V41-1, SEC-V41-2, CR-V41-1: an extracted row's provider is
 *              EXTRACTED_PAYMENT_PROVIDER ('extracted'), which no customer
 *              intent method equals, so the anonymous pay-link intent (its
 *              "one PENDING row per invoice and method" upsert) never rewrites
 *              the extracted amount: the intent gets its own row, the member
 *              confirms what was extracted, and a Drive re-run still replays.
 *   V41-13     SEC-V41-1: the member may bind the amount they approved
 *              (confirmPendingPayment(..., { amount })); a mismatch is a 409
 *              and writes nothing.
 *   V41-14/15  AUD-V41-3, CR-V41-2 (PL07-ST-3): every new pending row writes,
 *              in the same transaction, one COMMERCE payment_pending_recorded
 *              `activities` row naming its recorder and, beside KEY, the
 *              uploader (req.user, never the body) as data.initiatedBy; it
 *              stays after the confirmation; a keyed replay adds none.
 *
 * V1-41b-PENDING-PAYMENT-CONFIRM-ROUTE (CR-V41-3, DISC-V41-6, CR-V41-4): the
 * it.todo V41-T1 is replaced by real cases on POST
 * /commerce/businesses/:b/invoices/:i/payments/:paymentId/confirm, the HTTP
 * door to confirmPendingPayment:
 *   V41-T1a    mounted with the manual payment route's guard stack and its
 *              revenue:write module scope.
 *   V41-T1b    a revenue:write member confirms (binding the amount shown):
 *              one SUCCESSFUL row, one payment_recorded posting and the
 *              invoice.payment_recorded contact event name that member; the
 *              pending row is retired; the invoice moves by the balance rule.
 *   V41-T1c    DISC-V41-6: the answer is projected like the manual route
 *              (toInvoiceWriteResponse): the contact's private fields are absent.
 *   V41-T1d    CR-V41-4: GET .../payments lists the confirmed money once (a
 *              CONFIRMED pending row is not a second money row).
 *   V41-T1e    a confirm retried after the money was recorded but before the
 *              row was retired answers the same payment and writes nothing new;
 *              a confirm of a CONFIRMED row is 409 and writes nothing.
 *   V41-T1f    revenue:read 403, a non-member 403, a non-member SUPER_ADMIN 403
 *              (D-46), no identity 401; nothing written.
 *   V41-T1g    another tenant's payment id, a row of another invoice, a
 *              member-recorded SUCCESSFUL row and a pay-link intent: 404 / 409,
 *              nothing written.
 *   V41-T1h    the optional {amount}: malformed 400, mismatch 409, nothing
 *              written; the matching amount confirms.
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
  superAdmin: `${P}superAdmin`, // SUPER_ADMIN, member of no business (D-46)
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
  // review repairs (SEC-V41-1/2, CR-V41-1, AUD-V41-3, CR-V41-2)
  invIntentOther: `${P}invIntentOther`,
  invIntentCash: `${P}invIntentCash`,
  invBound: `${P}invBound`,
  invAuditEv: `${P}invAuditEv`,
  invAuditDrv: `${P}invAuditDrv`,
  // V1-41b: the HTTP confirm route (CR-V41-3, DISC-V41-6, CR-V41-4)
  invRouteEv: `${P}invRouteEv`,
  invRouteDisc: `${P}invRouteDisc`,
  invRouteList: `${P}invRouteList`,
  invRouteDrv: `${P}invRouteDrv`,
  invRouteAuth: `${P}invRouteAuth`,
  invRouteKind: `${P}invRouteKind`,
  invRouteOther: `${P}invRouteOther`,
  invRouteBody: `${P}invRouteBody`,
  invB: `${P}invB`, // bizB
  invRouteB: `${P}invRouteB`, // bizB
};

/** V1-41b (DISC-V41-6): contactA's private fields, which no invoice write answer may carry. */
const CONTACT_A_PHONE = '+18685550141';
const CONTACT_A_PRIVATE_NOTE = 'v41a private: owes the bank';

/** The pay-link token of invIntentOther (globally unique column: embeds the prefix). */
const LINK_TOKEN = `${P}tok1`;

// R0-00: this suite's public rate-limit windows are its own (NODE_ENV=test only).
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = P;

let db: any;
let app: any;
let redis: any;
let evidence: any;
let commerce: any;
let commerceControllerClass: any;

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

function confirm(paymentId: string, businessId: string, memberId: string, options?: { amount?: unknown }) {
  // V1-41: the confirm door; absent before this packet (TypeError).
  return Promise.resolve().then(() =>
    options === undefined
      ? evidence.confirmPendingPayment(paymentId, businessId, memberId)
      : evidence.confirmPendingPayment(paymentId, businessId, memberId, options),
  );
}

async function clearRateLimits() {
  const keys: string[] = await redis.keys(`pub_rate_limit:${P}:*`);
  if (keys.length) await redis.del(...keys);
}

/** The customer's anonymous offline intent through the live pay link (no identity header). */
function publicIntent(token: string, body: Record<string, unknown>) {
  return agent().post(`/commerce/public/invoice-link/${encodeURIComponent(token)}/payment-intent`).send(body);
}

/** V1-41b: the HTTP confirm route (no identity header when `user` is null). */
function confirmRouteAs(user: string | null, biz: string, inv: string, paymentId: string, body: Record<string, unknown> = {}) {
  const req = agent().post(
    `/commerce/businesses/${biz}/invoices/${inv}/payments/${encodeURIComponent(paymentId)}/confirm`,
  );
  if (user) req.set(HEADER, user);
  return req.send(body);
}

/** The invoice.payment_recorded contact events of one invoice (fresh read). */
async function paymentRecordedEventsOf(invoiceId: string): Promise<any[]> {
  const rows = await db.contactEvent.findMany({
    where: { businessId: ID.bizA, type: 'invoice.payment_recorded' },
    orderBy: { createdAt: 'asc' },
  });
  return rows.filter((r: any) => (r.data as any)?.invoiceId === invoiceId);
}

/** The `activities` rows (real, fresh read) written for one payment row. */
async function activitiesFor(paymentId: string): Promise<any[]> {
  return db.activity.findMany({ where: { entityType: 'payment', entityId: paymentId }, orderBy: { occurredAt: 'asc' } });
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
  commerceControllerClass = CommerceController;

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
  await db.user.create({ data: { id: ID.superAdmin, email: `${P}superadmin@test.local`, role: 'SUPER_ADMIN' } });
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
  // V1-41b (DISC-V41-6): contactA carries private fields no invoice write answer may disclose.
  await db.contact.create({
    data: {
      id: ID.contactA, businessId: ID.bizA, firstName: 'Vfa', lastName: 'Customer', email: `${P}ca@test.local`,
      phone: CONTACT_A_PHONE, notesInternal: CONTACT_A_PRIVATE_NOTE,
    },
  });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'Vfb', lastName: 'Customer', email: `${P}cb@test.local` } });
  const seeder = moduleRef.get(ChartOfAccountsSeederService);
  await seeder.ensureDefaults(ID.bizA);
  await seeder.ensureDefaults(ID.bizB);

  let n = 0;
  for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
    n += 1;
    const inB = id === ID.invB || id === ID.invRouteB;
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
  if (redis) {
    await clearRateLimits().catch(() => undefined);
    await redis.quit();
  }
  if (PREVIOUS_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
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

describe('review repairs: a customer payment intent never rewrites an extracted row (SEC-V41-1, SEC-V41-2, CR-V41-1)', () => {
  it('V41-11: a Drive pending row with method "other", then an anonymous pay-link intent {method: "other", amount: 100} -> the intent writes its own PENDING row; the extracted row keeps 30 (provider "extracted"); the confirming member records 30, never the customer\'s 100', async () => {
    const intakeId = `${P}drive_other`;
    await seedDriveIntake(intakeId, ID.invIntentOther, { amount: 30, method: 'other', reference: 'V41A-DRV-OTHER' });
    const approved = await approveIntakeAs(ID.writer, intakeId);
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    const pendingId = approved.body.results[0].entityId;
    const [extracted] = await paymentsOf(ID.invIntentOther);
    expect(extracted).toMatchObject({ id: pendingId, status: 'PENDING', amount: 30, method: 'other', provider: 'extracted', recordedBy: ID.writer });

    await db.paymentLink.create({ data: { id: `${P}link1`, token: LINK_TOKEN, invoiceId: ID.invIntentOther, businessId: ID.bizA, active: true } });
    await clearRateLimits();
    const intent = await publicIntent(LINK_TOKEN, { method: 'other', amount: 100 });
    expect(intent.status, JSON.stringify(intent.body)).toBe(201);

    const rows = await paymentsOf(ID.invIntentOther);
    expect(rows.map((r) => [r.status, r.amount, r.method, r.provider, r.recordedBy])).toEqual([
      ['PENDING', 30, 'other', 'extracted', ID.writer],
      ['PENDING', 100, 'other', 'other', null],
    ]);
    expect(rows[0].id).toBe(pendingId);
    expect(rows[1].providerPaymentId.startsWith(`manual_${ID.invIntentOther}_intent_`)).toBe(true);

    const result = await confirm(pendingId, ID.bizA, ID.owner);
    expect(result.payment).toMatchObject({ status: 'SUCCESSFUL', amount: 30, method: 'other', provider: 'other', recordedBy: ID.owner });
    const after = await paymentsOf(ID.invIntentOther);
    expect(after.map((r) => [r.status, r.amount])).toEqual([
      ['CONFIRMED', 30],
      ['PENDING', 100],
      ['SUCCESSFUL', 30],
    ]);
    const postings = await paymentPostingsOf(ID.invIntentOther);
    expect(postings).toHaveLength(1);
    expect(postings[0].externalRef).toBe(`Payment:${result.payment.id}:payment_recorded`);
    expect(await invoiceStatus(ID.invIntentOther)).toBe('PARTIALLY_PAID');
    expect(await balanceOf(ID.invIntentOther)).toEqual({ paidAmount: 30, remaining: 70 });
  });

  it('V41-12: a Drive pending row with method "cash", then intents {method: "cash"} with no amount and with 5 -> the extracted row keeps 40 and stays confirmable; the member records 40; a Drive re-run then replays the same row and writes nothing', async () => {
    const intakeId = `${P}drive_cash`;
    await seedDriveIntake(intakeId, ID.invIntentCash, { amount: 40, method: 'cash', reference: 'V41A-DRV-CASH' });
    const approved = await approveIntakeAs(ID.writer, intakeId);
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    const pendingId = approved.body.results[0].entityId;

    await commerce.recordPublicPaymentIntent(ID.invIntentCash, 'cash');
    let rows = await paymentsOf(ID.invIntentCash);
    expect(rows.map((r) => [r.id === pendingId, r.status, r.amount, r.provider])).toEqual([
      [true, 'PENDING', 40, 'extracted'],
      [false, 'PENDING', 0, 'cash'],
    ]);
    await commerce.recordPublicPaymentIntent(ID.invIntentCash, 'cash', 5);
    rows = await paymentsOf(ID.invIntentCash);
    expect(rows.map((r) => [r.id === pendingId, r.status, r.amount, r.provider])).toEqual([
      [true, 'PENDING', 40, 'extracted'],
      [false, 'PENDING', 5, 'cash'],
    ]);

    const result = await confirm(pendingId, ID.bizA, ID.owner);
    expect(result.payment).toMatchObject({ status: 'SUCCESSFUL', amount: 40, recordedBy: ID.owner, reference: 'V41A-DRV-CASH' });
    expect(await balanceOf(ID.invIntentCash)).toEqual({ paidAmount: 40, remaining: 60 });
    const before = await moneyStateOf(ID.invIntentCash);

    await db.driveIntakeFile.update({ where: { id: intakeId }, data: { status: 'reviewing', processedAt: null } });
    const rerun = await approveIntakeAs(ID.owner, intakeId);
    expect(rerun.status, JSON.stringify(rerun.body)).toBe(201);
    expect(rerun.body.success, JSON.stringify(rerun.body)).toBe(true);
    expect(rerun.body.results[0]).toMatchObject({ action: 'record_payment', success: true, entityId: pendingId });
    expect(await moneyStateOf(ID.invIntentCash)).toEqual(before);
  });
});

describe('review repairs: the confirming member binds the amount they approved (SEC-V41-1)', () => {
  it('V41-13: confirm naming an amount other than the pending row\'s -> 409, a malformed amount -> 400, nothing written; the matching amount -> recorded and posted once', async () => {
    const body = await evidencePayment(ID.owner, ID.bizA, ID.invBound, 45, 'v41a-ev-bound.pdf');
    const before = await moneyStateOf(ID.invBound);

    expect(await outcomeOf(confirm(body.payment.id, ID.bizA, ID.owner, { amount: 100 }))).toBe(409);
    expect(await outcomeOf(confirm(body.payment.id, ID.bizA, ID.owner, { amount: 'abc' }))).toBe(400);
    expect(await moneyStateOf(ID.invBound)).toEqual(before);
    expect(before.payments).toEqual([expect.objectContaining({ status: 'PENDING', amount: 45 })]);

    const result = await confirm(body.payment.id, ID.bizA, ID.owner, { amount: 45 });
    expect(result.payment).toMatchObject({ status: 'SUCCESSFUL', amount: 45, recordedBy: ID.owner });
    expect(await paymentPostingsOf(ID.invBound)).toHaveLength(1);
    expect(await balanceOf(ID.invBound)).toEqual({ paidAmount: 45, remaining: 55 });
  });
});

describe('review repairs: who recorded and who uploaded a pending payment stays on the audit trail (AUD-V41-3, CR-V41-2, PL07-ST-3)', () => {
  it('V41-14: the writer uploads evidence (the body naming the owner as initiatedBy / recordedBy / actorId) -> one COMMERCE payment_pending_recorded activities row: actor KEY (SYSTEM), data.initiatedBy the writer; after the owner confirms, the row still names the writer and the money names the owner', async () => {
    nextExtraction = {
      documentType: 'receipt',
      confidence: 0.9,
      invoiceData: { total: 25, invoiceNumber: 'V41A-AUDIT-EV', notes: 'cash' },
    };
    const res = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${ID.invAuditEv}/payments/from-evidence`)
      .set(HEADER, ID.writer)
      .send({
        evidenceUrl: 'https://evidence.test/v41a-audit.pdf', evidenceMimeType: 'application/pdf', filename: 'v41a-audit.pdf', source: 'upload',
        initiatedBy: ID.owner, recordedBy: ID.owner, actorId: ID.owner,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const pendingId = res.body.payment.id;

    const audit = await activitiesFor(pendingId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      businessId: ID.bizA,
      module: 'COMMERCE',
      action: 'payment_pending_recorded',
      entityType: 'payment',
      entityId: pendingId,
      category: 'PAYMENT',
      status: 'PENDING',
      contactId: ID.contactA,
      actorType: 'SYSTEM',
      actorId: KEY_ACTOR,
    });
    expect(audit[0].data).toMatchObject({ invoiceId: ID.invAuditEv, amount: 25, recordedBy: KEY_ACTOR, initiatedBy: ID.writer });

    const result = await confirm(pendingId, ID.bizA, ID.owner);
    expect(result.payment.recordedBy).toBe(ID.owner);
    const after = await activitiesFor(pendingId);
    expect(after).toHaveLength(1);
    expect(after[0].data.initiatedBy).toBe(ID.writer);
    expect(JSON.stringify(after)).not.toContain(ID.owner);
  });

  it('V41-15: a Drive step\'s pending row names its approver (USER, no initiatedBy); a keyed re-run adds no second audit row; a caller with no human names no actor, and an initiatedBy beside a non-KEY recorder is not kept', async () => {
    const intakeId = `${P}drive_audit`;
    await seedDriveIntake(intakeId, ID.invAuditDrv, { amount: 12, method: 'cash', reference: 'V41A-DRV-AUDIT' });
    const first = await approveIntakeAs(ID.writer, intakeId);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const pendingId = first.body.results[0].entityId;

    const audit = await activitiesFor(pendingId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ module: 'COMMERCE', action: 'payment_pending_recorded', actorType: 'USER', actorId: ID.writer });
    expect(audit[0].data).toMatchObject({ invoiceId: ID.invAuditDrv, amount: 12, method: 'cash', recordedBy: ID.writer });
    expect(audit[0].data.initiatedBy).toBeUndefined();

    await db.driveIntakeFile.update({ where: { id: intakeId }, data: { status: 'reviewing', processedAt: null } });
    const rerun = await approveIntakeAs(ID.owner, intakeId);
    expect(rerun.status, JSON.stringify(rerun.body)).toBe(201);
    expect(rerun.body.results[0]).toMatchObject({ action: 'record_payment', success: true, entityId: pendingId });
    expect(await activitiesFor(pendingId)).toHaveLength(1);

    const unattended = await evidence.recordPendingPayment(
      ID.invAuditDrv, ID.bizA, { amount: 3, method: 'cash' }, { actorId: null, initiatedBy: ID.owner },
    );
    const [row] = await activitiesFor(unattended.id);
    expect(row).toMatchObject({ action: 'payment_pending_recorded', actorType: null, actorId: null });
    expect(row.data).toMatchObject({ amount: 3, recordedBy: null });
    expect(row.data.initiatedBy).toBeUndefined();
  });
});

describe('V1-41b: a member confirms a pending extracted payment over HTTP (CR-V41-3; RED before V1-41b: no route)', () => {
  const CONFIRM_PATH = 'businesses/:businessId/invoices/:invoiceId/payments/:paymentId/confirm';

  it('V41-T1a: POST .../invoices/:invoiceId/payments/:paymentId/confirm is mounted beside the manual payment route with the same guard stack and the same revenue:write module scope', () => {
    const proto = commerceControllerClass.prototype;
    const manual = proto.recordPayment;
    const confirmHandler = proto.confirmPendingPayment;
    expect(typeof confirmHandler, 'CommerceController.confirmPendingPayment').toBe('function');
    expect(Reflect.getMetadata('path', confirmHandler)).toBe(CONFIRM_PATH);
    expect(Reflect.getMetadata('method', confirmHandler)).toBe(Reflect.getMetadata('method', manual));
    const guards = Reflect.getMetadata('__guards__', confirmHandler);
    expect(guards.map((g: any) => g.name)).toEqual(['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard']);
    expect(guards).toEqual(Reflect.getMetadata('__guards__', manual));
    expect(Reflect.getMetadata('module_scope', confirmHandler)).toEqual({ module: 'revenue', minLevel: 'write' });
    expect(Reflect.getMetadata('module_scope', confirmHandler)).toEqual(Reflect.getMetadata('module_scope', manual));
  });

  it('V41-T1b: the writer (STAFF, revenue:write) confirms an evidence-extracted pending payment binding the amount shown -> 201; one SUCCESSFUL row, one payment_recorded posting and one invoice.payment_recorded contact event, all naming the writer (never a body field); the pending row CONFIRMED and unposted; the invoice PARTIALLY_PAID', async () => {
    const body = await evidencePayment(ID.owner, ID.bizA, ID.invRouteEv, 45, 'v41a-route-ev.pdf');
    const pendingId = body.payment.id;
    expect(body.requiresConfirmation).toBe(true);
    expect(await paymentRecordedEventsOf(ID.invRouteEv)).toHaveLength(0);

    const res = await confirmRouteAs(ID.writer, ID.bizA, ID.invRouteEv, pendingId, {
      amount: 45, recordedBy: ID.owner, actorId: ID.owner, initiatedBy: ID.owner,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.payment).toMatchObject({ status: 'SUCCESSFUL', amount: 45, recordedBy: ID.writer });
    expect(res.body.confirmedPaymentId).toBe(pendingId);
    expect(res.body).toMatchObject({ paidAmount: 45, remaining: 55 });
    expect(res.body.invoice).toMatchObject({ id: ID.invRouteEv, status: 'PARTIALLY_PAID' });
    const confirmedId = res.body.payment.id;
    expect(confirmedId).not.toBe(pendingId);

    const rows = await paymentsOf(ID.invRouteEv);
    expect(rows.map((r) => [r.id, r.status, r.amount, r.recordedBy])).toEqual([
      [pendingId, 'CONFIRMED', 45, KEY_ACTOR],
      [confirmedId, 'SUCCESSFUL', 45, ID.writer],
    ]);
    // LEDGER: exactly one Payment:<id>:payment_recorded, created by the writer; the pending row is never posted.
    const postings = await paymentPostingsOf(ID.invRouteEv);
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({ externalRef: `Payment:${confirmedId}:payment_recorded`, status: 'POSTED', createdById: ID.writer });
    expect(await postingsFor(pendingId)).toHaveLength(0);
    // AUDIT: the contact event names the confirming member exactly as a manual payment names its recorder.
    const events = await paymentRecordedEventsOf(ID.invRouteEv);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorType: 'USER', actorId: ID.writer, source: 'commerce' });
    expect(events[0].data).toMatchObject({ invoiceId: ID.invRouteEv, amount: 45, recordedBy: ID.writer });
    expect(events[0].data.initiatedBy).toBeUndefined();
    expect(await invoiceStatus(ID.invRouteEv)).toBe('PARTIALLY_PAID');
    expect(await balanceOf(ID.invRouteEv)).toEqual({ paidAmount: 45, remaining: 55 });
  });

  it('V41-T1c (DISC-V41-6): the confirm answer is projected like the manual payment route: the invoice contact carries id, businessId, firstName, lastName and email only (no phone, no internal notes, no booking); a confirm with no amount in the body confirms the pending amount', async () => {
    const body = await evidencePayment(ID.owner, ID.bizA, ID.invRouteDisc, 30, 'v41a-route-disc.pdf');
    const contact = await db.contact.findUnique({ where: { id: ID.contactA } });
    expect(contact).toMatchObject({ phone: CONTACT_A_PHONE, notesInternal: CONTACT_A_PRIVATE_NOTE });

    const res = await confirmRouteAs(ID.owner, ID.bizA, ID.invRouteDisc, body.payment.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.payment).toMatchObject({ status: 'SUCCESSFUL', amount: 30, recordedBy: ID.owner });
    expect(Object.keys(res.body.invoice.contact).sort()).toEqual(['businessId', 'email', 'firstName', 'id', 'lastName']);
    expect(res.body.invoice.contact).toMatchObject({ id: ID.contactA, businessId: ID.bizA, firstName: 'Vfa', lastName: 'Customer' });
    expect(res.body.invoice.contact.phone).toBeUndefined();
    expect(res.body.invoice.contact.notesInternal).toBeUndefined();
    expect('booking' in res.body.invoice).toBe(false);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(CONTACT_A_PHONE);
    expect(text).not.toContain(CONTACT_A_PRIVATE_NOTE);
  });

  it('V41-T1d (CR-V41-4): after a confirm, GET .../invoices/:id/payments lists the confirmed money once: the SUCCESSFUL row, never the CONFIRMED pending row beside it; the figures are unchanged', async () => {
    const body = await evidencePayment(ID.owner, ID.bizA, ID.invRouteList, 25, 'v41a-route-list.pdf');
    const pendingId = body.payment.id;
    const pendingList = await agent().get(`/commerce/businesses/${ID.bizA}/invoices/${ID.invRouteList}/payments`).set(HEADER, ID.reader);
    expect(pendingList.status).toBe(200);
    expect(pendingList.body.payments.map((p: any) => [p.id, p.status, p.provider])).toEqual([[pendingId, 'PENDING', 'extracted']]);

    // Confirmed through the door itself, so this case isolates the list (CR-V41-4 was a listPayments defect).
    const result = await confirm(pendingId, ID.bizA, ID.owner, { amount: 25 });
    expect(result.payment).toMatchObject({ status: 'SUCCESSFUL', amount: 25 });

    const list = await agent().get(`/commerce/businesses/${ID.bizA}/invoices/${ID.invRouteList}/payments`).set(HEADER, ID.reader);
    expect(list.status).toBe(200);
    expect(list.body.payments.map((p: any) => [p.id, p.status, p.amount])).toEqual([[result.payment.id, 'SUCCESSFUL', 25]]);
    expect(list.body).toMatchObject({ paidAmount: 25, remaining: 75 });
    // The CONFIRMED row is kept (what was extracted, and by whom); it is not money and is not listed as money.
    expect((await paymentsOf(ID.invRouteList)).map((r) => r.status)).toEqual(['CONFIRMED', 'SUCCESSFUL']);
  });

  it('V41-T1e: a confirm retried after the money was recorded under the door\'s key but before the row was retired answers that same payment and writes nothing new; a further confirm of the CONFIRMED row is 409 and writes nothing (a Drive-intake row)', async () => {
    const intakeId = `${P}drive_route`;
    await seedDriveIntake(intakeId, ID.invRouteDrv, { amount: 60, method: 'cash', reference: 'V41A-DRV-ROUTE' });
    const approved = await approveIntakeAs(ID.writer, intakeId);
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    const pendingId = approved.body.results[0].entityId;
    // What a first confirm commits before it retires the row (its keyed recordPayment).
    const first = await commerce.recordPayment(
      ID.invRouteDrv, ID.bizA,
      { amount: 60, method: 'cash', reference: 'V41A-DRV-ROUTE', idempotencyKey: `extracted-confirm:${pendingId}` },
      { actorId: ID.owner },
    );
    const before = await moneyStateOf(ID.invRouteDrv);
    expect(before.payments.map((p) => p.status)).toEqual(['PENDING', 'SUCCESSFUL']);
    expect(before.postings).toHaveLength(1);

    const res = await confirmRouteAs(ID.owner, ID.bizA, ID.invRouteDrv, pendingId, { amount: 60 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.payment).toMatchObject({ id: first.payment.id, status: 'SUCCESSFUL', amount: 60, recordedBy: ID.owner });
    expect(res.body.confirmedPaymentId).toBe(pendingId);
    // The keyed replay reloads the invoice with the whole Contact row; the route projects it too.
    expect(Object.keys(res.body.invoice.contact).sort()).toEqual(['businessId', 'email', 'firstName', 'id', 'lastName']);
    const after = await moneyStateOf(ID.invRouteDrv);
    expect(after.payments.map((p) => [p.id, p.status])).toEqual([
      [pendingId, 'CONFIRMED'],
      [first.payment.id, 'SUCCESSFUL'],
    ]);
    expect(after.postings).toEqual(before.postings);
    expect(await paymentRecordedEventsOf(ID.invRouteDrv)).toHaveLength(1);

    const again = await confirmRouteAs(ID.owner, ID.bizA, ID.invRouteDrv, pendingId, { amount: 60 });
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect(await moneyStateOf(ID.invRouteDrv)).toEqual(after);
    expect(await balanceOf(ID.invRouteDrv)).toEqual({ paidAmount: 60, remaining: 40 });
  });

  it('V41-T1f: a revenue:read member 403, a member of another business 403, a SUPER_ADMIN who is not a member 403 (D-46), no identity 401, the owner through a business they are not in 403; the row stays PENDING and nothing is written', async () => {
    const body = await evidencePayment(ID.owner, ID.bizA, ID.invRouteAuth, 15, 'v41a-route-auth.pdf');
    const pendingId = body.payment.id;
    const before = await moneyStateOf(ID.invRouteAuth);

    const answers = {
      reader: (await confirmRouteAs(ID.reader, ID.bizA, ID.invRouteAuth, pendingId, { amount: 15 })).status,
      nonMember: (await confirmRouteAs(ID.ownerB, ID.bizA, ID.invRouteAuth, pendingId, { amount: 15 })).status,
      superAdmin: (await confirmRouteAs(ID.superAdmin, ID.bizA, ID.invRouteAuth, pendingId, { amount: 15 })).status,
      anonymous: (await confirmRouteAs(null, ID.bizA, ID.invRouteAuth, pendingId, { amount: 15 })).status,
      ownerViaB: (await confirmRouteAs(ID.owner, ID.bizB, ID.invRouteAuth, pendingId, { amount: 15 })).status,
    };
    expect(answers).toEqual({ reader: 403, nonMember: 403, superAdmin: 403, anonymous: 401, ownerViaB: 403 });

    expect(await moneyStateOf(ID.invRouteAuth)).toEqual(before);
    expect(before.payments).toEqual([expect.objectContaining({ id: pendingId, status: 'PENDING' })]);
    expect(before.postings).toHaveLength(0);
    expect(await paymentRecordedEventsOf(ID.invRouteAuth)).toHaveLength(0);
  });

  it('V41-T1g: another tenant\'s pending row 404 (under this tenant\'s invoice or the foreign invoice id), a row of this tenant under another invoice\'s path 404, a member-recorded SUCCESSFUL row 409, a pay-link intent PENDING row 409; nothing is written in either tenant', async () => {
    const foreign = await evidencePayment(ID.ownerB, ID.bizB, ID.invRouteB, 40, 'v41a-route-foreign.pdf');
    const own = await evidencePayment(ID.owner, ID.bizA, ID.invRouteKind, 20, 'v41a-route-kind.pdf');
    const manual = await agent()
      .post(`/commerce/businesses/${ID.bizA}/invoices/${ID.invRouteKind}/payments`)
      .set(HEADER, ID.owner)
      .send({ amount: 10, method: 'cash', reference: 'V41A-ROUTE-MANUAL' });
    expect(manual.status, JSON.stringify(manual.body)).toBe(201);
    await commerce.recordPublicPaymentIntent(ID.invRouteKind, 'cash', 5);
    const intent = (await paymentsOf(ID.invRouteKind)).find((p) => p.status === 'PENDING' && p.provider === 'cash');
    expect(intent).toBeDefined();
    const before = {
      kind: await moneyStateOf(ID.invRouteKind),
      other: await moneyStateOf(ID.invRouteOther),
      foreign: await moneyStateOf(ID.invRouteB),
    };

    const answers = {
      foreignUnderOwnInvoice: (await confirmRouteAs(ID.owner, ID.bizA, ID.invRouteKind, foreign.payment.id, { amount: 40 })).status,
      foreignUnderForeignInvoice: (await confirmRouteAs(ID.owner, ID.bizA, ID.invRouteB, foreign.payment.id, { amount: 40 })).status,
      ownUnderAnotherInvoice: (await confirmRouteAs(ID.owner, ID.bizA, ID.invRouteOther, own.payment.id, { amount: 20 })).status,
      memberRecorded: (await confirmRouteAs(ID.owner, ID.bizA, ID.invRouteKind, manual.body.payment.id, { amount: 10 })).status,
      payLinkIntent: (await confirmRouteAs(ID.owner, ID.bizA, ID.invRouteKind, intent!.id, { amount: 5 })).status,
    };
    expect(answers).toEqual({
      foreignUnderOwnInvoice: 404,
      foreignUnderForeignInvoice: 404,
      ownUnderAnotherInvoice: 404,
      memberRecorded: 409,
      payLinkIntent: 409,
    });

    expect({
      kind: await moneyStateOf(ID.invRouteKind),
      other: await moneyStateOf(ID.invRouteOther),
      foreign: await moneyStateOf(ID.invRouteB),
    }).toEqual(before);
    expect(before.kind.payments.find((p) => p.id === own.payment.id)).toMatchObject({ status: 'PENDING' });
    expect(before.foreign.payments).toEqual([expect.objectContaining({ id: foreign.payment.id, status: 'PENDING' })]);
    expect(before.other.payments).toHaveLength(0);
  });

  it('V41-T1h: the optional {amount} is the amount the member approved: a string, null or non-numeric amount 400, a mismatch 409, nothing written; the matching amount confirms once', async () => {
    const body = await evidencePayment(ID.owner, ID.bizA, ID.invRouteBody, 45, 'v41a-route-body.pdf');
    const pendingId = body.payment.id;
    const before = await moneyStateOf(ID.invRouteBody);

    const answers = {
      nonNumeric: (await confirmRouteAs(ID.owner, ID.bizA, ID.invRouteBody, pendingId, { amount: 'abc' })).status,
      numericString: (await confirmRouteAs(ID.owner, ID.bizA, ID.invRouteBody, pendingId, { amount: '45' })).status,
      nullAmount: (await confirmRouteAs(ID.owner, ID.bizA, ID.invRouteBody, pendingId, { amount: null })).status,
      mismatch: (await confirmRouteAs(ID.owner, ID.bizA, ID.invRouteBody, pendingId, { amount: 100 })).status,
    };
    expect(answers).toEqual({ nonNumeric: 400, numericString: 400, nullAmount: 400, mismatch: 409 });
    expect(await moneyStateOf(ID.invRouteBody)).toEqual(before);
    expect(before.payments).toEqual([expect.objectContaining({ status: 'PENDING', amount: 45 })]);

    const ok = await confirmRouteAs(ID.owner, ID.bizA, ID.invRouteBody, pendingId, { amount: 45 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.payment).toMatchObject({ status: 'SUCCESSFUL', amount: 45, recordedBy: ID.owner });
    expect(await paymentPostingsOf(ID.invRouteBody)).toHaveLength(1);
    expect(await balanceOf(ID.invRouteBody)).toEqual({ paidAmount: 45, remaining: 55 });
  });
});
