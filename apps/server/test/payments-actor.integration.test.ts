/**
 * R0-PL-07-PAYMENT-ACTOR — the acting user is recorded on manual payments and
 * refunds (REAL database, REAL ledger posting, REAL contact timeline).
 *
 * Payments lane PK-PL-07 / PL-F12: Payment.recordedBy exists in the schema and
 * was never written on the manual path; the ledger posting's
 * FinancialTransaction.createdById, the refund reversal's createdById and the
 * contact timeline event carried no actor either. Release 0 needs an audit
 * trail for the manual payment.
 *
 * Contract pinned here:
 *
 *   POST /commerce/businesses/:b/invoices/:id/payments by user U
 *     -> Payment.recordedBy = U                                  (fresh Prisma read)
 *     -> posting FinancialTransaction.createdById = U            (column exists on the model)
 *     -> ContactEvent invoice.payment_recorded: actorId U, actorType USER, data.recordedBy U
 *        and the payment's FINANCE payment_recorded activity entry carries actorId U
 *        (W3-V1-55c, owner ruling D-90: the FINANCE row is the payment's feed row
 *        and names who recorded it; until then the actor was read on the CRM
 *        invoice.payment_recorded copy, which D-90 retires)
 *   the same route by user V (STAFF, revenue:write)  -> V on every one of the above
 *   idempotent replay (R0-D2) by V of U's key       -> U's row, recordedBy still U, nothing new written
 *   POST /commerce/businesses/:b/payments/:id/refund by user V
 *     -> the reversal FinancialTransaction.createdById = V
 *     -> the original Payment stays SUCCESSFUL with recordedBy U (who recorded the
 *        receipt is not overwritten); since V1-29 (D-14) the refund is a separate
 *        negative REFUNDED row linked by reference, and its recordedBy is V
 *   KEY cortex adapter process_payment               -> KEY_SYSTEM_ACTOR_ID, actorType SYSTEM
 *   PaymentEvidenceService (POST .../payments/from-evidence) -> KEY_SYSTEM_ACTOR_ID, actorType SYSTEM
 *     (V1-41, D-27: a PENDING row; its payment_pending_recorded activities row
 *     keeps the uploader as data.initiatedBy, PA-14b; the confirming member
 *     records the money)
 *   service caller passing no actor                  -> recordedBy null (no invented actor)
 *
 * Open gaps found by the R0-11 review (it.todo at the end of the file; every
 * fix is in product code outside R0-11-PL07-PAYMENT-ACTOR's manifest-only
 * write set):
 *   PA-16 (ST-R011-1) PATCH /commerce/businesses/:b/invoices/:id {status:'PAID'} by a human
 *         writes a payment attributed to KEY_SYSTEM_ACTOR_ID, with no human recorded.
 *         CLOSED by R0-CMF1-INVOICE-PATCH-ACTOR: the it.todo is replaced by the
 *         PA-16a..j cases below (PAID, SENT, OVERDUE, VOID through PATCH name the
 *         human; the body is a whitelisted DTO; an invalid status is a 400; a
 *         revenue:read member is refused like the mark-paid route; the owner's
 *         PATCH and mark-paid ledger effects are identical; KEY stays KEY).
 *         R0-CMF1 review repairs PA-16k..m: the service refuses a status outside
 *         SENT / OVERDUE / VOID / PAID (SEC-CMF1-1), the invoice write routes
 *         project the contact (SEC-CMF1-2), KEY's status entries are SYSTEM
 *         (SEC-CMF1-4). Still open, outside that write set (it.todo):
 *         PA-16n (SEC-CMF1-3) an omitted actor means KEY; PA-16o (SEC-CMF1-5)
 *         the ACCRUAL invoice_finalized posting and its reversal name no creator.
 *   PA-17 (ST-R011-2) refunding a SUCCESSFUL payment with no payment_recorded posting
 *         records the refunder nowhere
 *         CLOSED by R0-CMF2-PAYMENT-ACTOR-GAPS: PA-17a..e below. Every manual
 *         refund, posted or not, writes one FINANCE payment_refunded activity
 *         row naming the refunder, inside the refund transaction (a
 *         rolled-back refund leaves none). The contact-event registry has no
 *         canonical refund type (packages/shared, outside that write set), so
 *         the audit row is the unified activity row the posted-refund path
 *         already wrote. R0-CMF2 review repairs PA-17f..g (SEC-CMF2-1,
 *         CR-CMF2-1): the row no longer goes through the best-effort timeline,
 *         so a failing timeline cannot drop it, and a failed insert fails the
 *         refund rather than committing one that names nobody.
 *   PA-18 (ST-R011-3) drive-intake approval drops the approver: record_payment records null
 *         CLOSED by R0-CMF2-PAYMENT-ACTOR-GAPS: PA-18a..b below (the approve
 *         route names the approver; an approval with no human records null).
 *         R0-CMF2 review repairs PA-18c..d (SEC-CMF2-2): the record_payment
 *         step is keyed on the intake file and step, so two concurrent
 *         approvals, or a re-run, credit the invoice once. PA-18e
 *         (SEC-CMF2-3, the approve route required no revenue:write) was an
 *         it.todo outside that write set; CLOSED by W7-DRIVE-INTAKE-SCOPE:
 *         PA-18e..f below (a member below revenue:write is refused 403 as the
 *         manual payment route refuses them, and, owner ruling D-46, so is a
 *         non-member SUPER_ADMIN; nothing is written and the plan stays
 *         approvable by a member who may).
 *
 * Review repairs (R0-PL-07-PAYMENT-ACTOR-repair):
 *   PATCH /commerce/invoices/:id/paid by U (no payment yet) -> the manual row's recordedBy = U   (PL07-ST-2, PL07-CR-1)
 *   refund of an already REFUNDED payment, or of a PENDING / FAILED one -> 409, nothing changes (PL07-ST-1)
 *   two concurrent refunds of one payment -> one 201, one 409, one reversal                     (PL07-ST-1)
 *   KEY adapter / from-evidence: recorder stays KEY (SYSTEM); the human it acted for is kept as
 *     contact event data.initiatedBy, taken from the command / req.user, never from the body   (PL07-ST-3)
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService, ChartOfAccountsSeederService,
 * PaymentEvidenceService and CrmTimelineService write real rows, and the
 * production GlobalHttpExceptionFilter + ValidationPipe are installed. Identity
 * attachment is the one stand-in: a test middleware reads `x-pya-user`, loads
 * that seeded user row and attaches `{ id, email, role }` exactly as the
 * Supabase-verifying AuthMiddleware would. Document intelligence (the AI
 * boundary), Gmail, vision and stats cache are stubs off the boundary. The
 * unified activity timeline records what it is handed and (R0-CMF2) passes it
 * on to the real TimelineService, so each entry is also a real `activities`
 * row. R0-CMF2 also mounts DriveIntakeController over the real
 * DriveIntakeOrchestrator; its connector, messaging, email, oversight and
 * credit-note collaborators are stubs off the boundary (the plans seeded here
 * use none of them).
 *
 * Fixtures: prefix `pya_` (legacy registry entry); hard-deleted by raw SQL
 * (LIKE through sqlLikePrefix) in dependency order in beforeAll and afterAll;
 * no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
// Type-only: erased at runtime, so the dynamic-import order below (dotenv
// before anything that reads DATABASE_URL) is unchanged.
import type { CommerceService } from '../src/modules/commerce/commerce.service';
import type { CommerceAdapterService } from '../src/modules/key-cortex/adapters/commerce-adapter.service';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'pya_';
const HEADER = 'x-pya-user';
/** Mirrors KEY_SYSTEM_ACTOR_ID (src/core/auth/system-actor.ts); asserted equal below. */
const KEY_ACTOR = 'key_ai';

const ID = {
  userU: `${P}userU`,
  userV: `${P}userV`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  // one invoice per case so balances never bleed between cases
  invU: `${P}invU`,
  invV: `${P}invV`,
  invReplay: `${P}invReplay`,
  invRefund: `${P}invRefund`,
  invKey: `${P}invKey`,
  invEvidence: `${P}invEvidence`,
  invNoActor: `${P}invNoActor`,
  // review repairs (PL07-ST-1/2/3, PL07-CR-1)
  invMarkPaid: `${P}invMarkPaid`,
  invDoubleRefund: `${P}invDoubleRefund`,
  invNotRefundable: `${P}invNotRefundable`,
  invRefundRace: `${P}invRefundRace`,
  invEvidenceV: `${P}invEvidenceV`,
  // V1-41 review (AUD-V41-3, CR-V41-2): PA-14b, the uploader of a PENDING evidence payment
  invEvidenceInit: `${P}invEvidenceInit`,
  invHumanInit: `${P}invHumanInit`,
  // R0-PL-04: PA-13, refund of a mark-paid payment
  invMarkPaidRefund: `${P}invMarkPaidRefund`,
  // R0-CMF1-INVOICE-PATCH-ACTOR: PA-16a..j, status changes through
  // PATCH /commerce/businesses/:b/invoices/:id. W (STAFF, revenue:read) is
  // seeded by that describe block, after the fixture sanity case.
  userW: `${P}userW`,
  invPatchPaidV: `${P}invPatchPaidV`,
  invPatchSpoofV: `${P}invPatchSpoofV`,
  invPatchSentV: `${P}invPatchSentV`, // moved back to DRAFT by its describe block
  invPatchOverdueV: `${P}invPatchOverdueV`,
  invPatchVoidV: `${P}invPatchVoidV`,
  invPatchDeniedW: `${P}invPatchDeniedW`,
  invPatchInvalid: `${P}invPatchInvalid`,
  invPatchPaidU: `${P}invPatchPaidU`,
  invRoutePaidU: `${P}invRoutePaidU`,
  invKeyPatchPaid: `${P}invKeyPatchPaid`,
  invKeyPatchVoid: `${P}invKeyPatchVoid`,
  // R0-CMF1 review repairs: PA-16k..m (SEC-CMF1-1, -2, -4). The PRIVATE
  // contact owned by U is seeded by that describe block, after the fixture
  // sanity case.
  invKeyBadStatus: `${P}invKeyBadStatus`,
  privContact: `${P}privContact`,
  invPrivPatchPaid: `${P}invPrivPatchPaid`,
  invPrivPatchVoid: `${P}invPrivPatchVoid`,
  invPrivPatchEdit: `${P}invPrivPatchEdit`,
  invPrivMarkPaid: `${P}invPrivMarkPaid`,
  invPrivStatusVoid: `${P}invPrivStatusVoid`,
  invKeySent: `${P}invKeySent`, // moved back to DRAFT by its describe block
  invKeyOverdue: `${P}invKeyOverdue`,
  // R0-CMF2-PAYMENT-ACTOR-GAPS: PA-17a..e (refund audit row), PA-18a..b
  // (drive-intake approver). The unposted payment and the intake files are
  // seeded by their cases, after the fixture sanity case.
  invUnpostedRefund: `${P}invUnpostedRefund`,
  invPostedRefundAudit: `${P}invPostedRefundAudit`,
  invRefundNoActor: `${P}invRefundNoActor`,
  invRefundRollback: `${P}invRefundRollback`,
  invRefundKey: `${P}invRefundKey`,
  invDriveV: `${P}invDriveV`,
  invDriveSystem: `${P}invDriveSystem`,
  // R0-CMF2 review repairs: PA-17f..g (SEC-CMF2-1, CR-CMF2-1), PA-18c..d (SEC-CMF2-2).
  invRefundTimelineReject: `${P}invRefundTimelineReject`,
  invRefundTimelineSwallow: `${P}invRefundTimelineSwallow`,
  invRefundAuditFail: `${P}invRefundAuditFail`,
  invDriveRace: `${P}invDriveRace`,
  invDriveRerun: `${P}invDriveRerun`,
  // W3-V1-55c review repairs (D-90): PA-19a..c (SEC-V55C-2, -3, -4).
  invRecordRollback: `${P}invRecordRollback`,
  invRecordRerun: `${P}invRecordRerun`,
  invKeyInitiated: `${P}invKeyInitiated`,
  invHumanInitiated: `${P}invHumanInitiated`,
  // W7-DRIVE-INTAKE-SCOPE (SEC-CMF2-3; D-46): PA-18e..f. The two members below
  // revenue:write and the non-member SUPER_ADMIN are seeded by that describe
  // block, after the fixture sanity case.
  userDriveReader: `${P}userDriveReader`,
  userDriveCrm: `${P}userDriveCrm`,
  userDriveSuper: `${P}userDriveSuper`,
  invDriveScope: `${P}invDriveScope`,
  invDriveSuper: `${P}invDriveSuper`,
};

const INVOICE_TOTAL = 100;

let db: any;
let app: any;
let redis: any;
let commerce: CommerceService;
let adapter: CommerceAdapterService;
let systemActorId: string;
let workflow: any;
let driveOrchestrator: any;
let revenuePosting: any;
/** V1-41 (D-27): the real PaymentEvidenceService, whose confirmPendingPayment records an extracted payment. */
let paymentEvidence: any;
/** The real TimelineService the recorder below passes every entry on to. */
let realTimeline: { recordEvent: (input: any) => Promise<unknown> } | null = null;
/** The TimelineService class, for PA-17f's timeline whose insert fails. */
let TimelineServiceClass: any;

// PaymentEvidenceService is the real one over the real CommerceService;
// document intelligence (the AI boundary) is the stub and returns what the
// next receipt "says".
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

// The unified activity ledger (TimelineService): a recorder of what
// CrmTimelineService.logEvent and RevenuePostingService hand it, which (R0-CMF2)
// passes each entry on to the real TimelineService, so the entry is also a real
// `activities` row (the refund audit row PA-17 reads back).
const activity: Array<Record<string, any>> = [];
const timelineStub = {
  recordEvent: async (input: Record<string, any>) => {
    activity.push(input);
    return realTimeline ? realTimeline.recordEvent(input) : null;
  },
};

async function cleanup() {
  // `pya_` matched literally: a bare LIKE 'pya_%' would also match any 'pya?…' prefix.
  const like = sqlLikePrefix(P);
  for (const sql of [
    `DELETE FROM activities WHERE business_id LIKE ${like}`,
    `DELETE FROM drive_intake_files WHERE business_id LIKE ${like}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${like}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${like}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${like}`,
    `DELETE FROM payments WHERE business_id LIKE ${like} OR invoice_id LIKE ${like}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${like} OR invoice_id LIKE ${like}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${like}`,
    `DELETE FROM invoices WHERE business_id LIKE ${like}`,
    `DELETE FROM contacts WHERE business_id LIKE ${like}`,
    `DELETE FROM memberships WHERE business_id LIKE ${like} OR user_id LIKE ${like}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${like}`,
    `DELETE FROM businesses WHERE id LIKE ${like}`,
    `DELETE FROM users WHERE id LIKE ${like}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}

const route = (inv: string) => `/commerce/businesses/${ID.biz}/invoices/${inv}/payments`;

function postAs(user: string, inv: string, body: Record<string, unknown>) {
  return agent().post(route(inv)).set(HEADER, user).send(body);
}

function refundAs(user: string, paymentId: string, reason = 'pya test refund') {
  return agent().post(`/commerce/businesses/${ID.biz}/payments/${paymentId}/refund`).set(HEADER, user).send({ reason });
}

/** Fresh read of the Payment row (never the HTTP response). */
async function paymentRow(id: string): Promise<any> {
  return db.payment.findUnique({ where: { id } });
}

async function paymentsOf(invoiceId: string): Promise<any[]> {
  return db.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } });
}

/** The ledger transaction posted for a payment row (FIN2 externalRef). */
async function postingsFor(paymentId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, externalRef: `Payment:${paymentId}:payment_recorded` },
  });
}

/** The reversal PostingService.reverse writes for a refunded payment's posting. */
async function reversalsFor(paymentId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, externalRef: `Payment:${paymentId}:payment_recorded:reversal` },
  });
}

/**
 * V1-29 (D-14): the refund rows linked to a payment. A manual refund keeps the
 * original SUCCESSFUL and adds a negative REFUNDED row whose reference is the
 * original's providerPaymentId (the provider refund convention).
 */
async function refundRowsOf(paymentId: string): Promise<any[]> {
  const original = await paymentRow(paymentId);
  return db.payment.findMany({
    where: { invoiceId: original.invoiceId, status: 'REFUNDED', amount: { lt: 0 }, reference: original.providerPaymentId },
  });
}

/** ContactEvent rows of a type for one invoice (fresh read). */
async function contactEventsFor(invoiceId: string, type = 'invoice.payment_recorded'): Promise<any[]> {
  const rows = await db.contactEvent.findMany({
    where: { businessId: ID.biz, contactId: ID.contact, type },
    orderBy: { createdAt: 'asc' },
  });
  return rows.filter((r: any) => (r.data as any)?.invoiceId === invoiceId);
}

/**
 * W3-V1-55c (owner ruling D-90): the FINANCE payment_recorded `activities` rows
 * (real, fresh read) of this invoice's payments. Each is its payment's one feed
 * row and names who recorded it (USER for a person, SYSTEM for KEY); the PA
 * cases read the actor here, no longer on the CRM invoice.payment_recorded
 * copy. The W3-V1-55c review (SEC-V55C-2) has RevenuePostingService write the
 * row with the payment's transaction, not through the timeline, so the row is
 * read from the table.
 */
async function financeActivityFor(invoiceId: string): Promise<Array<Record<string, any>>> {
  const ids = (await paymentsOf(invoiceId)).map((p) => p.id);
  if (ids.length === 0) return [];
  return db.activity.findMany({
    where: { businessId: ID.biz, module: 'FINANCE', action: 'payment_recorded', entityType: 'payment', entityId: { in: ids } },
    orderBy: { occurredAt: 'asc' },
  });
}

/** One posting for this payment, attributed to `actor`. */
async function expectPostingBy(paymentId: string, actor: string | null) {
  const txns = await postingsFor(paymentId);
  expect(txns, `postings for ${paymentId}`).toHaveLength(1);
  expect(txns[0]).toMatchObject({ type: 'INCOME', status: 'POSTED', sourceType: 'Payment', sourceId: paymentId });
  expect(txns[0].createdById, `posting creator for ${paymentId}`).toBe(actor);
}

/** One invoice.payment_recorded ContactEvent for this invoice, and its payment's FINANCE feed row, attributed to `actor`. */
async function expectContactEventBy(invoiceId: string, actor: string, actorType: 'USER' | 'SYSTEM') {
  const events = await contactEventsFor(invoiceId);
  expect(events, `contact events for ${invoiceId}`).toHaveLength(1);
  expect(events[0]).toMatchObject({ actorId: actor, actorType, source: 'commerce' });
  expect((events[0].data as any).recordedBy).toBe(actor);
  // W3-V1-55c (D-90): the same actor on the payment's FINANCE row.
  const act = await financeActivityFor(invoiceId);
  expect(act, `FINANCE payment_recorded activity for ${invoiceId}`).toHaveLength(1);
  expect(act[0]).toMatchObject({ actorId: actor, actorType });
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
  const { KEY_SYSTEM_ACTOR_ID } = await import('../src/core/auth/system-actor');
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
  const { CommerceAdapterService } = await import('../src/modules/key-cortex/adapters/commerce-adapter.service');
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
  // R0-CMF2 (PA-18): the drive-intake approve route over the real orchestrator.
  const { DriveIntakeController } = await import('../src/modules/commerce/drive-intake.controller');
  const { DriveIntakeOrchestrator } = await import('../src/modules/commerce/drive-intake-orchestrator.service');
  const { ConnectorIntelligenceService } = await import('../src/modules/ai/connector-intelligence.service');
  const { CrmCommunicationService } = await import('../src/modules/crm/crm-communication.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { CreditNoteService } = await import('../src/modules/finance/credit-note.service');

  systemActorId = KEY_SYSTEM_ACTOR_ID;

  // What tsc emits for DriveIntakeController's constructor (it declares its
  // dependencies only through `design:paramtypes`, which vitest's esbuild
  // transform does not emit; the evidence-feed suite does the same for
  // TimelineController).
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
      // Real ledger chain: the proof is the creator column on the posted rows.
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: {} },
      { provide: EventEmitter2, useValue: eventStub },
      // Real contact timeline: CommerceService only calls
      // CrmService.logContactEvent, which delegates to CrmTimelineService.
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
      { provide: TimelineService, useValue: timelineStub },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      // The real PaymentEvidenceService over the real CommerceService; AI
      // extraction and the Drive download are the stubs.
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: docIntelStub },
      { provide: GoogleDriveService, useValue: {} },
      // R0-CMF2 (PA-18): the real DriveIntakeOrchestrator over the real
      // CommerceService and InvoiceWorkflowService. The seeded plans carry
      // only record_payment steps and no contact, so none of these is called.
      DriveIntakeOrchestrator,
      { provide: ConnectorIntelligenceService, useValue: {} },
      { provide: CrmCommunicationService, useValue: {} },
      { provide: TransactionalEmailService, useValue: {} },
      { provide: AiOversightService, useValue: { resolveApproval: async () => undefined } },
      { provide: CreditNoteService, useValue: {} },
    ],
  }).compile();
  commerce = moduleRef.get(CommerceService);
  workflow = moduleRef.get(InvoiceWorkflowService);
  driveOrchestrator = moduleRef.get(DriveIntakeOrchestrator);
  revenuePosting = moduleRef.get(RevenuePostingService);
  paymentEvidence = moduleRef.get(PaymentEvidenceService);
  TimelineServiceClass = TimelineService;
  realTimeline = new TimelineService(moduleRef.get(PrismaService));
  // The KEY cortex adapter, constructed exactly as KeyCortexModule wires it.
  adapter = new CommerceAdapterService(commerce);

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
  // Same filter and pipe as app-bootstrap.ts, so status codes are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.userU, email: `${ID.userU}@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.userV, email: `${ID.userV}@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'PYA Biz', ownerId: ID.userU, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_userU`, userId: ID.userU, businessId: ID.biz, role: 'OWNER' } });
  // V is a second human with revenue:write, so "the actor" is never just "the owner".
  await db.membership.create({
    data: { id: `${P}m_userV`, userId: ID.userV, businessId: ID.biz, role: 'STAFF', permissionScopes: { revenue: 'write' } },
  });
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'Pya', lastName: 'Customer', email: `${P}c@test.local` } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);

  let n = 0;
  for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
    n += 1;
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `PYA-${String(n).padStart(3, '0')}`,
        status: 'SENT',
        subtotal: INVOICE_TOTAL,
        total: INVOICE_TOTAL,
        currency: 'TTD',
        businessId: ID.biz,
        contactId: ID.contact,
        items: { create: [{ id: `${id}_item1`, description: `PYA item ${n}`, quantity: 1, unitPrice: INVOICE_TOTAL, total: INVOICE_TOTAL }] },
      },
    });
  }
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

beforeEach(() => {
  activity.length = 0;
});

describe('fixture sanity (real rows)', () => {
  it('seeded two humans with revenue:write, a system chart of accounts and one SENT invoice per case; the KEY actor id is the shared constant', async () => {
    expect(systemActorId).toBe(KEY_ACTOR);
    const members = await db.membership.findMany({ where: { businessId: ID.biz }, orderBy: { userId: 'asc' } });
    expect(members.map((m: any) => [m.userId, m.role])).toEqual([[ID.userU, 'OWNER'], [ID.userV, 'STAFF']]);
    expect(await db.chartOfAccount.count({ where: { businessId: ID.biz, isSystem: true } })).toBeGreaterThan(0);
    for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
      expect(await paymentsOf(id), id).toHaveLength(0);
    }
  });
});

describe('manual payment through the HTTP route records the acting user', () => {
  it('PA-01: user U records -> Payment.recordedBy = U (fresh read), posting createdById = U, contact event and activity actorId U', async () => {
    const res = await postAs(ID.userU, ID.invU, { amount: 40, method: 'cash', reference: 'PYA-U-1' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const paymentId = res.body.payment.id;

    const row = await paymentRow(paymentId);
    expect(row).toMatchObject({ invoiceId: ID.invU, businessId: ID.biz, status: 'SUCCESSFUL', amount: 40 });
    expect(row.recordedBy).toBe(ID.userU);
    await expectPostingBy(paymentId, ID.userU);
    await expectContactEventBy(ID.invU, ID.userU, 'USER');
  });

  it('PA-02: user V (STAFF, revenue:write) records -> every audit column names V, not the owner', async () => {
    const res = await postAs(ID.userV, ID.invV, { amount: 25, method: 'bank_transfer', reference: 'PYA-V-1' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const paymentId = res.body.payment.id;

    expect((await paymentRow(paymentId)).recordedBy).toBe(ID.userV);
    await expectPostingBy(paymentId, ID.userV);
    await expectContactEventBy(ID.invV, ID.userV, 'USER');
  });

  it('PA-03: a client-sent recordedBy / actorId in the body never overrides the authenticated actor', async () => {
    const res = await postAs(ID.userV, ID.invV, {
      amount: 5, method: 'cash', reference: 'PYA-V-2', recordedBy: ID.userU, actorId: ID.userU,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await paymentRow(res.body.payment.id)).recordedBy).toBe(ID.userV);
    await expectPostingBy(res.body.payment.id, ID.userV);
  });
});

describe('idempotent replay (R0-D2) keeps the original recorder', () => {
  it('PA-04: U records with key K; V replays K -> 201 with U\'s row, recordedBy still U, no new row, posting or contact event', async () => {
    const body = { amount: 30, method: 'cash', idempotencyKey: 'pya-key-1' };
    const first = await postAs(ID.userU, ID.invReplay, body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    const replay = await postAs(ID.userV, ID.invReplay, body);
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(replay.body.payment.id).toBe(first.body.payment.id);
    expect(replay.body.payment.recordedBy).toBe(ID.userU);

    const rows = await paymentsOf(ID.invReplay);
    expect(rows).toHaveLength(1);
    expect(rows[0].recordedBy).toBe(ID.userU);
    await expectPostingBy(first.body.payment.id, ID.userU);
    const events = await contactEventsFor(ID.invReplay);
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(ID.userU);
  });
});

describe('refund through the HTTP route records the refunding user', () => {
  // Title bound by scripts/proof-admission/manifests/payments-actor.json. Since
  // V1-29 (D-14) "Payment REFUNDED" is the separate refund row; the original
  // stays SUCCESSFUL with recordedBy U.
  it('PA-05: U records, V refunds -> reversal createdById = V; Payment REFUNDED with recordedBy still U; original posting still U', async () => {
    const res = await postAs(ID.userU, ID.invRefund, { amount: 60, method: 'cash', reference: 'PYA-R-1' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const paymentId = res.body.payment.id;

    const refunded = await refundAs(ID.userV, paymentId);
    expect(refunded.status, JSON.stringify(refunded.body)).toBe(201);
    expect(refunded.body.status).toBe('REFUNDED');

    const row = await paymentRow(paymentId);
    // V1-29 (D-14): the original is kept as it was, recorded by U; the refund
    // is a separate negative REFUNDED row linked to it, recorded by V.
    expect(row.status).toBe('SUCCESSFUL');
    expect(row.recordedBy).toBe(ID.userU);
    const refunds = await refundRowsOf(paymentId);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amount: -60, recordedBy: ID.userV });
    expect(refunded.body).toMatchObject({ id: refunds[0].id, refundOfPaymentId: paymentId });
    expect(await paymentsOf(ID.invRefund)).toHaveLength(2);

    const reversals = await reversalsFor(paymentId);
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ type: 'REVERSAL', status: 'POSTED', sourceType: 'Payment', sourceId: paymentId });
    expect(reversals[0].createdById).toBe(ID.userV);

    const original = await postingsFor(paymentId);
    expect(original).toHaveLength(1);
    expect(original[0]).toMatchObject({ status: 'REVERSED', createdById: ID.userU });
    expect(reversals[0].reversalOfId).toBe(original[0].id);
  });
});

describe('KEY and evidence paths record the system actor, distinct from a human', () => {
  it('PA-06: KEY cortex adapter process_payment -> recordedBy KEY_SYSTEM_ACTOR_ID, posting createdById KEY, contact event SYSTEM', async () => {
    const result = await adapter.execute({
      module: 'commerce',
      action: 'process_payment',
      parameters: { invoiceId: ID.invKey, amount: 15, method: 'cash', reference: 'PYA-K-1' },
      businessId: ID.biz,
      userId: ID.userU,
      source: 'key_cortex',
      timestamp: new Date(),
      correlationId: `${P}corr_1`,
    } as any);
    expect(result.success, JSON.stringify(result)).toBe(true);

    const rows = await paymentsOf(ID.invKey);
    expect(rows).toHaveLength(1);
    expect(rows[0].recordedBy).toBe(KEY_ACTOR);
    expect(rows[0].recordedBy).not.toBe(ID.userU);
    await expectPostingBy(rows[0].id, KEY_ACTOR);
    await expectContactEventBy(ID.invKey, KEY_ACTOR, 'SYSTEM');
    // Review PL07-ST-3: the human the KEY command ran for stays on the trail.
    expect(((await contactEventsFor(ID.invKey))[0].data as any).initiatedBy).toBe(ID.userU);
  });

  // V1-41 (D-27): an AI-extracted amount is recorded PENDING by KEY and
  // moves no money; the member who confirms it records the money.
  it('PA-07: POST .../payments/from-evidence (PaymentEvidenceService) -> the PENDING row is recorded by KEY_SYSTEM_ACTOR_ID and nothing is posted (D-27); U confirms it -> the payment, its posting and the contact event name U (USER)', async () => {
    nextExtraction = {
      documentType: 'receipt',
      confidence: 0.92,
      invoiceData: { total: 45, invoiceNumber: 'PYA-EVID-1', notes: 'bank transfer' },
    };
    const res = await agent()
      .post(`/commerce/businesses/${ID.biz}/invoices/${ID.invEvidence}/payments/from-evidence`)
      .set(HEADER, ID.userU)
      .send({ evidenceUrl: 'https://evidence.test/pya.pdf', evidenceMimeType: 'application/pdf', filename: 'pya.pdf', source: 'upload' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const [pending] = await paymentsOf(ID.invEvidence);
    expect(pending).toMatchObject({ status: 'PENDING', amount: 45, evidenceUrl: 'https://evidence.test/pya.pdf' });
    expect(pending.recordedBy).toBe(KEY_ACTOR);
    expect(await postingsFor(pending.id)).toHaveLength(0);
    expect(await contactEventsFor(ID.invEvidence)).toHaveLength(0);

    const confirmed = await paymentEvidence.confirmPendingPayment(pending.id, ID.biz, ID.userU);
    const rows = await paymentsOf(ID.invEvidence);
    expect(rows.map((r: any) => [r.id, r.status, r.recordedBy])).toEqual([
      [pending.id, 'CONFIRMED', KEY_ACTOR],
      [confirmed.payment.id, 'SUCCESSFUL', ID.userU],
    ]);
    expect(rows[1]).toMatchObject({ amount: 45, evidenceUrl: 'https://evidence.test/pya.pdf' });
    expect(await postingsFor(pending.id)).toHaveLength(0);
    await expectPostingBy(confirmed.payment.id, ID.userU);
    await expectContactEventBy(ID.invEvidence, ID.userU, 'USER');
  });

  // R0-11 review (ST-R011-3): this is a direct service call with no actor. It
  // is not drive intake, which has an authenticated approver and drops it
  // (PA-18, it.todo below).
  it('PA-08: a service caller that passes no actor records recordedBy null; no actor is invented', async () => {
    const result = await commerce.recordPayment(ID.invNoActor, ID.biz, { amount: 10, method: 'cash', reference: 'PYA-N-1' });
    const row = await paymentRow(result.payment.id);
    expect(row.recordedBy).toBeNull();
    await expectPostingBy(result.payment.id, null);
    const events = await contactEventsFor(ID.invNoActor);
    expect(events).toHaveLength(1);
    expect((events[0].data as any).initiatedBy).toBeUndefined();
  });
});

describe('review repairs: mark-paid, refund guard, initiating human', () => {
  it('PA-09 (PL07-ST-2, PL07-CR-1): PATCH /commerce/invoices/:id/paid by U creates the manual row with recordedBy = U', async () => {
    const res = await agent().patch(`/commerce/invoices/${ID.invMarkPaid}/paid`).set(HEADER, ID.userU).send({ businessId: ID.biz });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = await paymentsOf(ID.invMarkPaid);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'manual', method: 'MANUAL', status: 'SUCCESSFUL', amount: INVOICE_TOTAL });
    expect(rows[0].recordedBy).toBe(ID.userU);
    const paid = await contactEventsFor(ID.invMarkPaid, 'invoice.paid');
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ actorId: ID.userU, actorType: 'USER' });
  });

  it('PA-10 (PL07-ST-1): U records, V refunds, U refunds again -> 409; status, notes and the single reversal (by V) are unchanged', async () => {
    const res = await postAs(ID.userU, ID.invDoubleRefund, { amount: 20, method: 'cash', reference: 'PYA-D-1' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const paymentId = res.body.payment.id;

    const first = await refundAs(ID.userV, paymentId, 'first');
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const afterFirst = await paymentRow(paymentId);
    // V1-29 (D-14): the original is kept; the refund row carries the reason.
    expect(afterFirst.status).toBe('SUCCESSFUL');
    expect(await refundRowsOf(paymentId)).toEqual([expect.objectContaining({ notes: 'Refunded: first', recordedBy: ID.userV })]);

    const second = await refundAs(ID.userU, paymentId, 'second');
    expect(second.status, JSON.stringify(second.body)).toBe(409);
    expect(second.body.message).toMatch(/already refunded/i);

    const row = await paymentRow(paymentId);
    expect(row).toEqual(afterFirst);
    expect(row).toMatchObject({ status: 'SUCCESSFUL', recordedBy: ID.userU });
    expect(await refundRowsOf(paymentId)).toEqual([expect.objectContaining({ notes: 'Refunded: first', recordedBy: ID.userV })]);
    const reversals = await reversalsFor(paymentId);
    expect(reversals).toHaveLength(1);
    expect(reversals[0].createdById).toBe(ID.userV);
  });

  it('PA-11 (PL07-ST-1): refunding a PENDING or a FAILED payment -> 409; the row, the ledger and the timeline are untouched', async () => {
    for (const status of ['PENDING', 'FAILED']) {
      const id = `${P}pay_${status.toLowerCase()}`;
      await db.payment.create({
        data: {
          id, businessId: ID.biz, invoiceId: ID.invNotRefundable, amount: 10, currency: 'TTD', status,
          provider: 'wipay', method: 'card', providerPaymentId: `${P}prov_${status.toLowerCase()}`, notes: 'seeded',
        },
      });
      const res = await refundAs(ID.userV, id, 'not refundable');
      expect(res.status, `${status}: ${JSON.stringify(res.body)}`).toBe(409);
      expect(res.body.message).toMatch(new RegExp(status, 'i'));
      expect(await paymentRow(id)).toMatchObject({ status, notes: 'seeded', recordedBy: null });
      expect(await reversalsFor(id)).toHaveLength(0);
      expect(await postingsFor(id)).toHaveLength(0);
    }
    expect(await contactEventsFor(ID.invNotRefundable, 'invoice.payment_recorded')).toHaveLength(0);
  });

  it('PA-12 (PL07-ST-1): two concurrent refunds of one payment -> exactly one 201 and one 409, one reversal, one "Refunded:" note', async () => {
    const res = await postAs(ID.userU, ID.invRefundRace, { amount: 35, method: 'cash', reference: 'PYA-RACE-1' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const paymentId = res.body.payment.id;

    const results = await Promise.all([refundAs(ID.userU, paymentId, 'race'), refundAs(ID.userV, paymentId, 'race')]);
    expect(results.map((r) => r.status).sort(), JSON.stringify(results.map((r) => r.body))).toEqual([201, 409]);
    const winner = results.find((r) => r.status === 201)!;
    const winnerId = winner === results[0] ? ID.userU : ID.userV;

    const row = await paymentRow(paymentId);
    // V1-29 (D-14): the original is kept; exactly one refund row, by the winner.
    expect(row.status).toBe('SUCCESSFUL');
    expect(row.notes).toBeNull();
    expect(await refundRowsOf(paymentId)).toEqual([expect.objectContaining({ amount: -35, notes: 'Refunded: race', recordedBy: winnerId })]);
    const reversals = await reversalsFor(paymentId);
    expect(reversals).toHaveLength(1);
    expect(reversals[0].createdById).toBe(winnerId);
  });

  it('PA-13 (PL07-ST-1, remainder; closed by R0-PL-04): U marks paid, V refunds the mark-paid payment -> reversal createdById = V; original posting by U, REVERSED; recordedBy still U', async () => {
    // R0-PL-04 (G2) posts the mark-paid row to the ledger, so its refund has a
    // posting to reverse and the reversal carries the refunder.
    const marked = await agent().patch(`/commerce/invoices/${ID.invMarkPaidRefund}/paid`).set(HEADER, ID.userU).send({ businessId: ID.biz });
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    const rows = await paymentsOf(ID.invMarkPaidRefund);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'manual', method: 'MANUAL', status: 'SUCCESSFUL', amount: INVOICE_TOTAL, recordedBy: ID.userU });
    const paymentId = rows[0].id;
    await expectPostingBy(paymentId, ID.userU);

    const refunded = await refundAs(ID.userV, paymentId);
    expect(refunded.status, JSON.stringify(refunded.body)).toBe(201);
    expect(refunded.body.status).toBe('REFUNDED');

    const reversals = await reversalsFor(paymentId);
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ type: 'REVERSAL', status: 'POSTED', sourceType: 'Payment', sourceId: paymentId });
    expect(reversals[0].createdById).toBe(ID.userV);
    const original = await postingsFor(paymentId);
    expect(original).toHaveLength(1);
    expect(original[0]).toMatchObject({ status: 'REVERSED', createdById: ID.userU });
    expect(reversals[0].reversalOfId).toBe(original[0].id);
    expect((await paymentRow(paymentId)).recordedBy).toBe(ID.userU);
  });

  it('PA-14 (PL07-ST-3): from-evidence by V -> the PENDING row\'s recorder is KEY (SYSTEM), never the body\'s recordedBy / initiatedBy / actorId; V confirms it -> the money is recorded as V, never as the body\'s actor (D-27)', async () => {
    nextExtraction = {
      documentType: 'receipt',
      confidence: 0.9,
      invoiceData: { total: 12, invoiceNumber: 'PYA-EVID-V', notes: 'cash' },
    };
    const res = await agent()
      .post(`/commerce/businesses/${ID.biz}/invoices/${ID.invEvidenceV}/payments/from-evidence`)
      .set(HEADER, ID.userV)
      .send({
        evidenceUrl: 'https://evidence.test/pya-v.pdf', evidenceMimeType: 'application/pdf', filename: 'pya-v.pdf', source: 'upload',
        initiatedBy: ID.userU, recordedBy: ID.userU, actorId: ID.userU,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const [pending] = await paymentsOf(ID.invEvidenceV);
    expect(pending).toMatchObject({ status: 'PENDING', recordedBy: KEY_ACTOR });
    expect(await postingsFor(pending.id)).toHaveLength(0);

    const confirmed = await paymentEvidence.confirmPendingPayment(pending.id, ID.biz, ID.userV);
    expect((await paymentRow(confirmed.payment.id)).recordedBy).toBe(ID.userV);
    await expectPostingBy(confirmed.payment.id, ID.userV);
    await expectContactEventBy(ID.invEvidenceV, ID.userV, 'USER');
    expect(JSON.stringify(await paymentsOf(ID.invEvidenceV))).not.toContain(ID.userU);
  });

  // V1-41 (D-27): recordPayment kept the uploader on the invoice.payment_recorded
  // contact event (PL07-ST-3). A PENDING row writes no contact event (the
  // canonical CONTACT_EVENT_TYPES has no pending-payment type). V1-41 review
  // (AUD-V41-3, CR-V41-2): PaymentEvidenceService.recordPendingPayment writes,
  // with the row, one COMMERCE payment_pending_recorded `activities` row that
  // keeps the uploader as data.initiatedBy (the R0-CMF2 refund audit row is
  // the same kind of row).
  it('PA-14b (PL07-ST-3, D-27): from-evidence by V (the body naming U) -> the PENDING row\'s payment_pending_recorded activities row is recorded by KEY (SYSTEM) with initiatedBy V, never U; U confirms it -> the money names U and the row still names V as the uploader', async () => {
    nextExtraction = {
      documentType: 'receipt',
      confidence: 0.9,
      invoiceData: { total: 14, invoiceNumber: 'PYA-EVID-INIT', notes: 'cash' },
    };
    const res = await agent()
      .post(`/commerce/businesses/${ID.biz}/invoices/${ID.invEvidenceInit}/payments/from-evidence`)
      .set(HEADER, ID.userV)
      .send({
        evidenceUrl: 'https://evidence.test/pya-init.pdf', evidenceMimeType: 'application/pdf', filename: 'pya-init.pdf', source: 'upload',
        initiatedBy: ID.userU, recordedBy: ID.userU, actorId: ID.userU,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [pending] = await paymentsOf(ID.invEvidenceInit);
    expect(pending).toMatchObject({ status: 'PENDING', recordedBy: KEY_ACTOR });

    const auditRows = () => db.activity.findMany({ where: { businessId: ID.biz, entityType: 'payment', entityId: pending.id } });
    const before = await auditRows();
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ module: 'COMMERCE', action: 'payment_pending_recorded', actorType: 'SYSTEM', actorId: KEY_ACTOR });
    expect(before[0].data).toMatchObject({ invoiceId: ID.invEvidenceInit, recordedBy: KEY_ACTOR, initiatedBy: ID.userV });
    expect(JSON.stringify(before)).not.toContain(ID.userU);

    const confirmed = await paymentEvidence.confirmPendingPayment(pending.id, ID.biz, ID.userU);
    expect((await paymentRow(confirmed.payment.id)).recordedBy).toBe(ID.userU);
    await expectContactEventBy(ID.invEvidenceInit, ID.userU, 'USER');
    const after = await auditRows();
    expect(after).toHaveLength(1);
    expect(after[0].data.initiatedBy).toBe(ID.userV);
  });

  it('PA-15 (PL07-ST-3): initiatedBy is kept only beside the system recorder; a human recorder ignores it', async () => {
    const result = await commerce.recordPayment(
      ID.invHumanInit, ID.biz, { amount: 8, method: 'cash', reference: 'PYA-HI-1' }, { actorId: ID.userU, initiatedBy: ID.userV },
    );
    expect((await paymentRow(result.payment.id)).recordedBy).toBe(ID.userU);
    const events = await contactEventsFor(ID.invHumanInit);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: ID.userU, actorType: 'USER' });
    expect((events[0].data as any).initiatedBy).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// R0-CMF1-INVOICE-PATCH-ACTOR (R0-11 review ST-R011-1, BLOCKING): PA-16.
//
// PATCH /commerce/businesses/:b/invoices/:id took an inline body type, so the
// global ValidationPipe saw `Object` and stripped nothing: `status` reached
// CommerceService.updateInvoice, which hard-coded KEY_SYSTEM_ACTOR_ID for
// markInvoicePaid and updateInvoiceStatus. A human's PATCH {status:'PAID'}
// wrote Payment.recordedBy 'key_ai', a posting by 'key_ai' and timeline
// entries by KEY: the human was recorded nowhere. The authority PATCH status
// PAID needs is the dedicated mark-paid route's: AuthGuard + BusinessGuard +
// ModuleScopeGuard revenue:write, then markInvoicePaid's Membership check.
// ---------------------------------------------------------------------------

const invoiceRoute = (inv: string) => `/commerce/businesses/${ID.biz}/invoices/${inv}`;

function patchInvoiceAs(user: string, inv: string, body: Record<string, unknown>) {
  return agent().patch(invoiceRoute(inv)).set(HEADER, user).send(body);
}

function markPaidAs(user: string, inv: string) {
  return agent().patch(`/commerce/invoices/${inv}/paid`).set(HEADER, user).send({ businessId: ID.biz });
}

async function invoiceRow(id: string): Promise<any> {
  return db.invoice.findUnique({ where: { id } });
}

/** Every ContactEvent of any type on the fixture contact for one invoice. */
async function allContactEventsFor(invoiceId: string): Promise<any[]> {
  const rows = await db.contactEvent.findMany({ where: { businessId: ID.biz }, orderBy: { createdAt: 'asc' } });
  return rows.filter((r: any) => (r.data as any)?.invoiceId === invoiceId);
}

/** The unified activity entries the contact timeline wrote for one invoice and event type. */
function activityFor(invoiceId: string, action: string): Array<Record<string, any>> {
  return activity.filter((a) => a.module === 'crm' && a.action === action && a.data?.invoiceId === invoiceId);
}

/** Every ledger transaction about this invoice or one of its payments. */
async function postingsAbout(invoiceId: string): Promise<any[]> {
  const paymentIds = (await paymentsOf(invoiceId)).map((p) => p.id);
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, OR: [{ sourceId: invoiceId }, { sourceId: { in: paymentIds } }] },
  });
}

/** One payment's posting as a fingerprint without ids, so two postings compare. */
async function ledgerEffect(paymentId: string) {
  const txns = await postingsFor(paymentId);
  expect(txns, `postings for ${paymentId}`).toHaveLength(1);
  const txn = txns[0];
  const entries = await db.ledgerEntry.findMany({ where: { transactionId: txn.id } });
  return {
    type: txn.type,
    status: txn.status,
    amount: Number(txn.amount),
    currency: txn.currency,
    sourceType: txn.sourceType,
    createdById: txn.createdById,
    entries: entries
      .map((e: any) => ({ accountId: e.accountId, debit: Number(e.debit), credit: Number(e.credit), currency: e.currency }))
      .sort((a: any, b: any) => `${a.accountId}:${a.debit}`.localeCompare(`${b.accountId}:${b.debit}`)),
  };
}

/** No row and no activity entry written about this invoice names KEY. */
async function expectNoKeyActor(invoiceId: string) {
  for (const p of await paymentsOf(invoiceId)) expect(p.recordedBy, `payment ${p.id}`).not.toBe(KEY_ACTOR);
  for (const t of await postingsAbout(invoiceId)) expect(t.createdById, `posting ${t.externalRef}`).not.toBe(KEY_ACTOR);
  for (const e of await allContactEventsFor(invoiceId)) {
    expect(e.actorId, `contact event ${e.type}`).not.toBe(KEY_ACTOR);
    expect((e.data as any)?.recordedBy, `contact event ${e.type} data.recordedBy`).not.toBe(KEY_ACTOR);
  }
  for (const a of activity.filter((x) => x.data?.invoiceId === invoiceId)) expect(a.actorId, `activity ${a.action}`).not.toBe(KEY_ACTOR);
  // W3-V1-55c (D-90): the payments' FINANCE rows name their recorder too.
  for (const a of await financeActivityFor(invoiceId)) expect(a.actorId, `activity ${a.module} ${a.action}`).not.toBe(KEY_ACTOR);
}

const messagesOf = (body: Record<string, unknown>) => [body.message].flat().map(String);

describe('R0-CMF1: status changes through PATCH .../invoices/:id record the human who made them (PA-16, ST-R011-1)', () => {
  beforeAll(async () => {
    // W is a member WITHOUT revenue:write: the dedicated mark-paid route refuses W.
    await db.user.create({ data: { id: ID.userW, email: `${ID.userW}@test.local`, role: 'USER' } });
    await db.membership.create({
      data: { id: `${P}m_userW`, userId: ID.userW, businessId: ID.biz, role: 'STAFF', permissionScopes: { revenue: 'read' } },
    });
    // SENT is reachable only from DRAFT.
    await db.invoice.update({ where: { id: ID.invPatchSentV }, data: { status: 'DRAFT' } });
  });

  it('PA-16a: V (STAFF, revenue:write) PATCH {status:"PAID"} -> 200 PAID; Payment.recordedBy, the posting createdById and the invoice.payment_recorded / invoice.paid entries name V; KEY is recorded nowhere', async () => {
    const inv = ID.invPatchPaidV;
    const res = await patchInvoiceAs(ID.userV, inv, { status: 'PAID' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: inv, status: 'PAID' });
    expect((await invoiceRow(inv)).status).toBe('PAID');

    const rows = await paymentsOf(inv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'manual', method: 'MANUAL', status: 'SUCCESSFUL', amount: INVOICE_TOTAL });
    expect(rows[0].recordedBy).toBe(ID.userV);
    await expectPostingBy(rows[0].id, ID.userV);
    await expectContactEventBy(inv, ID.userV, 'USER');
    const paid = await contactEventsFor(inv, 'invoice.paid');
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ actorId: ID.userV, actorType: 'USER', source: 'commerce' });
    expect(activityFor(inv, 'invoice.paid')).toEqual([expect.objectContaining({ actorId: ID.userV, actorType: 'USER' })]);
    await expectNoKeyActor(inv);
  });

  it('PA-16b: actor and computed fields in the PATCH body (actorId KEY, recordedBy, initiatedBy, total, invoiceNumber, businessId) are stripped; the service is handed V as the actor and every audit column names V', async () => {
    const inv = ID.invPatchSpoofV;
    const spy = vi.spyOn(commerce, 'updateInvoice');
    try {
      const res = await patchInvoiceAs(ID.userV, inv, {
        status: 'PAID',
        actorId: KEY_ACTOR,
        recordedBy: ID.userU,
        initiatedBy: ID.userU,
        total: 1,
        invoiceNumber: `${P}HIJACK`,
        businessId: `${P}otherBiz`,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.status).toBe('PAID');
      expect(spy).toHaveBeenCalledTimes(1);
      const [input, actor] = spy.mock.calls[0] as unknown as [Record<string, unknown>, unknown];
      expect(actor, 'the actor argument').toBe(ID.userV);
      expect(input).toMatchObject({ invoiceId: inv, businessId: ID.biz, status: 'PAID' });
      for (const key of ['actorId', 'recordedBy', 'initiatedBy', 'total', 'invoiceNumber']) {
        expect(input, key).not.toHaveProperty(key);
      }
    } finally {
      spy.mockRestore();
    }
    const rows = await paymentsOf(inv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: INVOICE_TOTAL, recordedBy: ID.userV });
    await expectPostingBy(rows[0].id, ID.userV);
    await expectContactEventBy(inv, ID.userV, 'USER');
    expect(((await contactEventsFor(inv))[0].data as any).initiatedBy).toBeUndefined();
    expect((await invoiceRow(inv)).invoiceNumber).not.toBe(`${P}HIJACK`);
    await expectNoKeyActor(inv);
  });

  const statusCases: Array<[string, string, 'SENT' | 'OVERDUE' | 'VOID', string]> = [
    ['PA-16c', ID.invPatchSentV, 'SENT', 'invoice.sent'],
    ['PA-16d', ID.invPatchOverdueV, 'OVERDUE', 'invoice.overdue'],
    ['PA-16e', ID.invPatchVoidV, 'VOID', 'invoice.void'],
  ];
  for (const [label, inv, status, eventType] of statusCases) {
    it(`${label}: V PATCH {status:"${status}"} -> 200 ${status}; the ${eventType} entry and its activity record name V (USER), never KEY; no payment is written`, async () => {
      const res = await patchInvoiceAs(ID.userV, inv, { status });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ id: inv, status });
      expect((await invoiceRow(inv)).status).toBe(status);
      const events = await contactEventsFor(inv, eventType);
      expect(events, eventType).toHaveLength(1);
      expect(events[0]).toMatchObject({ actorId: ID.userV, actorType: 'USER', source: 'commerce' });
      expect(activityFor(inv, eventType)).toEqual([expect.objectContaining({ actorId: ID.userV, actorType: 'USER' })]);
      expect(await paymentsOf(inv)).toHaveLength(0);
      await expectNoKeyActor(inv);
    });
  }

  it('PA-16f: W (STAFF, revenue:read) PATCH {status:"PAID"} or {status:"VOID"} -> 403, the same refusal the dedicated mark-paid route gives W; nothing is written', async () => {
    const inv = ID.invPatchDeniedW;
    for (const body of [{ status: 'PAID' }, { status: 'VOID' }]) {
      const res = await patchInvoiceAs(ID.userW, inv, body);
      expect(res.status, `${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body.message).toMatch(/^Insufficient permissions: revenue requires write access/);
    }
    // The control: mark-paid itself refuses W the same way.
    const dedicated = await markPaidAs(ID.userW, inv);
    expect(dedicated.status, JSON.stringify(dedicated.body)).toBe(403);
    expect(dedicated.body.message).toMatch(/^Insufficient permissions: revenue requires write access/);

    expect(await invoiceRow(inv)).toMatchObject({ status: 'SENT', paidAt: null });
    expect(await paymentsOf(inv)).toHaveLength(0);
    expect(await postingsAbout(inv)).toHaveLength(0);
    expect(await allContactEventsFor(inv)).toHaveLength(0);
    expect(activity.filter((a) => a.data?.invoiceId === inv)).toHaveLength(0);
  });

  it('PA-16g: a status outside SENT / OVERDUE / VOID / PAID (BOGUS, DRAFT, PARTIALLY_PAID, lower-case paid, a number) -> 400 BAD_REQUEST, never 409 or 500; nothing is written', async () => {
    const inv = ID.invPatchInvalid;
    for (const status of ['BOGUS', 'DRAFT', 'PARTIALLY_PAID', 'paid', 42]) {
      const res = await patchInvoiceAs(ID.userV, inv, { status });
      expect(res.status, `${String(status)}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
      expect(
        messagesOf(res.body).some((m) => /^status must be one of the following values: SENT, OVERDUE, VOID, PAID$/.test(m)),
        `${String(status)}: ${JSON.stringify(res.body.message)}`,
      ).toBe(true);
    }
    expect(await invoiceRow(inv)).toMatchObject({ status: 'SENT', paidAt: null });
    expect(await paymentsOf(inv)).toHaveLength(0);
    expect(await postingsAbout(inv)).toHaveLength(0);
    expect(await allContactEventsFor(inv)).toHaveLength(0);
  });

  it('PA-16h: the owner U marks paid via PATCH {status:"PAID"} and via PATCH /commerce/invoices/:id/paid -> the same Payment row, ledger posting and entries, and timeline entries, all naming U', async () => {
    const viaPatch = await patchInvoiceAs(ID.userU, ID.invPatchPaidU, { status: 'PAID' });
    expect(viaPatch.status, JSON.stringify(viaPatch.body)).toBe(200);
    const viaRoute = await markPaidAs(ID.userU, ID.invRoutePaidU);
    expect(viaRoute.status, JSON.stringify(viaRoute.body)).toBe(200);
    expect(viaPatch.body.status).toBe('PAID');
    expect(viaRoute.body.status).toBe('PAID');

    const [a, b] = [await paymentsOf(ID.invPatchPaidU), await paymentsOf(ID.invRoutePaidU)];
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    const shape = (p: any) => ({
      provider: p.provider, method: p.method, status: p.status, amount: p.amount, currency: p.currency, recordedBy: p.recordedBy,
    });
    expect(shape(a[0])).toEqual(shape(b[0]));
    expect(shape(a[0])).toEqual({ provider: 'manual', method: 'MANUAL', status: 'SUCCESSFUL', amount: INVOICE_TOTAL, currency: 'TTD', recordedBy: ID.userU });

    const [effectA, effectB] = [await ledgerEffect(a[0].id), await ledgerEffect(b[0].id)];
    expect(effectA).toEqual(effectB);
    expect(effectA).toMatchObject({ type: 'INCOME', status: 'POSTED', amount: INVOICE_TOTAL, sourceType: 'Payment', createdById: ID.userU });
    expect(effectA.entries.length).toBeGreaterThan(1);

    for (const inv of [ID.invPatchPaidU, ID.invRoutePaidU]) {
      const row = await invoiceRow(inv);
      expect(row.status, inv).toBe('PAID');
      expect(row.paidAt, inv).not.toBeNull();
      await expectContactEventBy(inv, ID.userU, 'USER');
      const paid = await contactEventsFor(inv, 'invoice.paid');
      expect(paid, inv).toHaveLength(1);
      expect(paid[0]).toMatchObject({ actorId: ID.userU, actorType: 'USER' });
      await expectNoKeyActor(inv);
    }
  });

  it('PA-16i: the KEY flow executor call (commerce_update_invoice: updateInvoice with the tenant and no human actor) still marks PAID, attributed to KEY_SYSTEM_ACTOR_ID', async () => {
    const inv = ID.invKeyPatchPaid;
    // The call shape of flow-orchestrator.service.ts `commerce_update_invoice`.
    const result: any = await commerce.updateInvoice({ invoiceId: inv, businessId: ID.biz, status: 'PAID' });
    expect(result.status).toBe('PAID');
    const rows = await paymentsOf(inv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'manual', amount: INVOICE_TOTAL, recordedBy: KEY_ACTOR });
    await expectPostingBy(rows[0].id, KEY_ACTOR);
    await expectContactEventBy(inv, KEY_ACTOR, 'SYSTEM');
    const paid = await contactEventsFor(inv, 'invoice.paid');
    expect(paid).toHaveLength(1);
    expect(paid[0].actorId).toBe(KEY_ACTOR);
    // R0-CMF1 review SEC-CMF1-4: KEY is labelled SYSTEM on invoice.paid too,
    // as on invoice.payment_recorded, never as a USER.
    expect(paid[0].actorType).toBe('SYSTEM');
    expect(activityFor(inv, 'invoice.paid')).toEqual([expect.objectContaining({ actorId: KEY_ACTOR, actorType: 'SYSTEM' })]);
  });

  it('PA-16j: updateInvoice with KEY_SYSTEM_ACTOR_ID passed explicitly voids the invoice; the invoice.void entry names KEY', async () => {
    const inv = ID.invKeyPatchVoid;
    const update = commerce.updateInvoice as unknown as (input: Record<string, unknown>, actorId?: string) => Promise<any>;
    const result = await update.call(commerce, { invoiceId: inv, businessId: ID.biz, status: 'VOID' }, systemActorId);
    expect(result.status).toBe('VOID');
    const events = await contactEventsFor(inv, 'invoice.void');
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(KEY_ACTOR);
    // R0-CMF1 review SEC-CMF1-4: labelled SYSTEM, never USER.
    expect(events[0].actorType).toBe('SYSTEM');
    expect(await paymentsOf(inv)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// R0-CMF1 review repairs (SEC-CMF1-1, -2, -4).
//
// SEC-CMF1-1: only the HTTP DTO checked `status`. KEY's commerce_update_invoice
// calls the service with the model's raw args.status, so a SENT invoice moved
// to PARTIALLY_PAID / PENDING / FAILED with no payment behind it: the workflow
// transition committed, then logContactEvent refused the event type and the
// tool reported a failure for a row that had already changed. The service now
// checks the same PATCHABLE_INVOICE_STATUSES before anything is read or written.
//
// SEC-CMF1-2: the PATCH response carried the invoice's whole Contact row, so a
// revenue:write member with no CRM scope read a PRIVATE contact's internal
// notes, phone, visibility and owner (the R28-ST-01 class, fixed for quote
// status). The invoice write routes now answer with the operator invoice
// read's customer fields only.
//
// SEC-CMF1-4: KEY's invoice.paid / invoice.sent / invoice.overdue / invoice.void
// entries were labelled actorType USER; they are SYSTEM, as payment_recorded is.
// ---------------------------------------------------------------------------

/** The customer fields an invoice write response may carry (SEC-CMF1-2). */
const INVOICE_WRITE_CONTACT_KEYS = ['businessId', 'email', 'firstName', 'id', 'lastName'];

describe('R0-CMF1 review repairs: service-level status allow-list, contact projection, KEY audit label', () => {
  beforeAll(async () => {
    await db.contact.create({
      data: {
        id: ID.privContact,
        businessId: ID.biz,
        firstName: 'Priv',
        lastName: 'Ate',
        email: `${P}priv@test.local`,
        phone: '+18685551234',
        notesInternal: `${P}INTERNAL do not share`,
        visibility: 'PRIVATE',
        ownerId: ID.userU,
      },
    });
    await db.invoice.updateMany({
      where: { id: { in: [ID.invPrivPatchPaid, ID.invPrivPatchVoid, ID.invPrivPatchEdit, ID.invPrivMarkPaid, ID.invPrivStatusVoid] } },
      data: { contactId: ID.privContact },
    });
    // SENT is reachable only from DRAFT.
    await db.invoice.update({ where: { id: ID.invKeySent }, data: { status: 'DRAFT' } });
  });

  it('PA-16k (SEC-CMF1-1): the KEY flow executor call with a status outside SENT / OVERDUE / VOID / PAID (PARTIALLY_PAID, PENDING, FAILED, DRAFT, BOGUS) -> BadRequestException before anything is written; the row stays SENT with no payment, posting or timeline entry', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    const inv = ID.invKeyBadStatus;
    for (const status of ['PARTIALLY_PAID', 'PENDING', 'FAILED', 'DRAFT', 'BOGUS']) {
      // The call shape of flow-orchestrator.service.ts `commerce_update_invoice`
      // (args.status is the model's raw string).
      const call = commerce.updateInvoice({ invoiceId: inv, businessId: ID.biz, status: status as any, notes: `${P}${status}` });
      await expect(call, status).rejects.toMatchObject({
        status: 400,
        message: 'status must be one of the following values: SENT, OVERDUE, VOID, PAID',
      });
      await expect(call).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(await invoiceRow(inv)).toMatchObject({ status: 'SENT', paidAt: null, notes: null });
    expect(await paymentsOf(inv)).toHaveLength(0);
    expect(await postingsAbout(inv)).toHaveLength(0);
    expect(await allContactEventsFor(inv)).toHaveLength(0);
    expect(activity.filter((a) => a.data?.invoiceId === inv)).toHaveLength(0);
  });

  it('PA-16l (SEC-CMF1-2): V (STAFF, revenue:write) PATCH {status:"PAID"}, {status:"VOID"} and a notes edit, mark-paid and the status route on invoices of U\'s PRIVATE contact -> 200, and body.contact carries only id, businessId, firstName, lastName and email: no internal notes, phone, visibility or owner', async () => {
    const responses: Array<[string, request.Response]> = [
      ['PATCH status PAID', await patchInvoiceAs(ID.userV, ID.invPrivPatchPaid, { status: 'PAID' })],
      ['PATCH status VOID', await patchInvoiceAs(ID.userV, ID.invPrivPatchVoid, { status: 'VOID' })],
      ['PATCH notes edit', await patchInvoiceAs(ID.userV, ID.invPrivPatchEdit, { notes: `${P}edited` })],
      ['mark-paid', await markPaidAs(ID.userV, ID.invPrivMarkPaid)],
      [
        'status route VOID',
        await agent().patch(`/commerce/invoices/${ID.invPrivStatusVoid}/status/void`).set(HEADER, ID.userV).send({ businessId: ID.biz, status: 'VOID' }),
      ],
    ];
    for (const [label, res] of responses) {
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.contactId, label).toBe(ID.privContact);
      expect(Object.keys(res.body.contact ?? {}).sort(), label).toEqual(INVOICE_WRITE_CONTACT_KEYS);
      expect(res.body.contact, label).toEqual({
        id: ID.privContact,
        businessId: ID.biz,
        firstName: 'Priv',
        lastName: 'Ate',
        email: `${P}priv@test.local`,
      });
      const text = JSON.stringify(res.body);
      for (const secret of [`${P}INTERNAL do not share`, '+18685551234']) expect(text, `${label}: ${secret}`).not.toContain(secret);
    }
    // The operator invoice read (getInvoiceForBusiness) discloses no more than this.
    const detail: any = await commerce.getInvoiceForBusiness(ID.invPrivPatchPaid, ID.biz);
    for (const key of Object.keys(detail.contact)) expect(INVOICE_WRITE_CONTACT_KEYS, key).toContain(key);
    // The writes themselves happened, attributed to V.
    expect((await invoiceRow(ID.invPrivPatchPaid)).status).toBe('PAID');
    expect((await invoiceRow(ID.invPrivPatchVoid)).status).toBe('VOID');
    expect((await invoiceRow(ID.invPrivPatchEdit)).notes).toBe(`${P}edited`);
    expect((await invoiceRow(ID.invPrivMarkPaid)).status).toBe('PAID');
    expect((await invoiceRow(ID.invPrivStatusVoid)).status).toBe('VOID');
    expect((await paymentsOf(ID.invPrivPatchPaid)).map((p) => p.recordedBy)).toEqual([ID.userV]);
  });

  it('PA-16m (SEC-CMF1-4): KEY\'s status changes through updateInvoice (SENT and OVERDUE with KEY passed explicitly) write invoice.sent / invoice.overdue entries and activity labelled SYSTEM with actorId KEY, never USER', async () => {
    const update = commerce.updateInvoice as unknown as (input: Record<string, unknown>, actorId?: string) => Promise<any>;
    const cases: Array<[string, 'SENT' | 'OVERDUE', string]> = [
      [ID.invKeySent, 'SENT', 'invoice.sent'],
      [ID.invKeyOverdue, 'OVERDUE', 'invoice.overdue'],
    ];
    for (const [inv, status, eventType] of cases) {
      const result = await update.call(commerce, { invoiceId: inv, businessId: ID.biz, status }, systemActorId);
      expect(result.status, eventType).toBe(status);
      const events = await contactEventsFor(inv, eventType);
      expect(events, eventType).toHaveLength(1);
      expect(events[0]).toMatchObject({ actorId: KEY_ACTOR, actorType: 'SYSTEM', source: 'commerce' });
      expect(activityFor(inv, eventType)).toEqual([expect.objectContaining({ actorId: KEY_ACTOR, actorType: 'SYSTEM' })]);
      expect(await paymentsOf(inv)).toHaveLength(0);
    }
  });
});

// R0-CMF1 review: real gaps whose fixes are in product code outside the
// R0-CMF1-INVOICE-PATCH-ACTOR write set (commerce.controller.ts,
// commerce.service.ts, dto/update-invoice.dto.ts). Each it.todo names the
// behaviour a follow-up packet must make pass and the file it has to change.
describe('open gaps found by the R0-CMF1 review (outside the R0-CMF1 write set)', () => {
  it.todo(
    'PA-16n (SEC-CMF1-3): CommerceService.updateInvoice called with no actor is refused (403) instead of acting as KEY_SYSTEM_ACTOR_ID; KEY\'s ' +
      'commerce_update_invoice passes KEY_SYSTEM_ACTOR_ID explicitly and still marks PAID as KEY (PA-16i) - needs ai/flow-orchestrator.service.ts ' +
      'commerce_update_invoice to pass the KEY actor, then actorId made required in commerce.service.ts updateInvoice; outside the R0-CMF1 write set',
  );
  it.todo(
    'PA-16o (SEC-CMF1-5): on an ACCRUAL business, V PATCH {status:"SENT"} then {status:"VOID"} -> the Invoice:<id>:invoice_finalized posting and its ' +
      ':reversal have createdById = V (today null) - needs invoice-workflow.service.ts transition to take the actor and pass createdById to ' +
      'RevenuePostingService.onInvoiceFinalized / onInvoiceVoided (PostingOpts already has createdById); outside the R0-CMF1 write set',
  );
});

// ---------------------------------------------------------------------------
// R0-CMF2-PAYMENT-ACTOR-GAPS (R0-11 review ST-R011-2, ST-R011-3): PA-17, PA-18.
//
// ST-R011-2: markPaymentRefunded handed the refunder only to
// RevenuePostingService.onPaymentRefunded, which wrote it on the reversal
// FinancialTransaction and returned null when the payment had no
// Payment:<id>:payment_recorded posting (a mark-paid row written before
// R0-PL-04). Such a refund named its refunder on no row at all; a posted one
// named it only on the reversal, and its FINANCE payment_refunded activity
// entry carried no actor and was written inside the refund transaction, so a
// refund that rolled back still left "Payment refunded" behind.
//
// The contact-event registry (packages/shared CONTACT_EVENT_TYPES) has no
// refund type for invoices and is outside this write set, so the audit row is
// the unified activity row the posted-refund path already wrote, now for every
// manual refund, naming the refunder, written inside the refund transaction.
// Payment has no refunded-by column and none is added: Payment.recordedBy
// keeps the recorder.
//
// R0-CMF2 review (SEC-CMF2-1, CR-CMF2-1): the packet first recorded that row
// after commit through TimelineService.recordEvent, which swallows every
// error, so a failed insert committed a REFUNDED payment naming nobody. The
// row is now written with the refund's transaction client and is never handed
// to the best-effort timeline: it commits with the refund or not at all.
//
// ST-R011-3: DriveIntakeOrchestrator.executePlan(businessId, intakeFileId,
// userId) passed userId to credit notes, messages and tasks but called
// recordPayment with no actor, so a payment written by an approved intake plan
// had recordedBy null and a posting with no creator.
// ---------------------------------------------------------------------------

/** The `activities` rows (real, fresh read) the refund audit wrote for one payment. */
async function refundActivityRows(paymentId: string): Promise<any[]> {
  return db.activity.findMany({
    where: { businessId: ID.biz, module: 'FINANCE', action: 'payment_refunded', entityType: 'payment', entityId: paymentId },
    orderBy: { occurredAt: 'asc' },
  });
}

/** The payment_refunded entries handed to the best-effort unified timeline for one payment. */
function refundActivityHanded(paymentId: string): Array<Record<string, any>> {
  return activity.filter((a) => a.module === 'FINANCE' && a.action === 'payment_refunded' && a.entityId === paymentId);
}

/** Exactly one refund audit row for this payment, naming `actor` (null: none). */
async function expectOneRefundAuditBy(paymentId: string, actor: string | null, actorType: 'USER' | 'SYSTEM' | null, ledgerReversed: boolean) {
  const rows = await refundActivityRows(paymentId);
  expect(rows, `refund audit rows for ${paymentId}`).toHaveLength(1);
  expect(rows[0].actorId, `refund audit actorId for ${paymentId}`).toBe(actor);
  expect(rows[0].actorType, `refund audit actorType for ${paymentId}`).toBe(actorType);
  expect(rows[0].contactId).toBe(ID.contact);
  expect(rows[0].data).toMatchObject({ refundedBy: actor, ledgerReversed });
  // R0-CMF2 review (SEC-CMF2-1): the row is written by the refund transaction
  // itself, never handed to the best-effort timeline that swallows errors.
  expect(refundActivityHanded(paymentId), `refund entries handed to the best-effort timeline for ${paymentId}`).toHaveLength(0);
}

/**
 * The refund transaction client with an `activities` insert that fails (the
 * database refusing the audit row); every other model and method is the real
 * transaction's, so the reversal and the payment flip run for real.
 */
function txWithFailingActivityInsert(tx: any, onAttempt: () => void) {
  return new Proxy(tx, {
    get(target, prop) {
      if (prop === 'activity') {
        return {
          create: async () => {
            onAttempt();
            throw new Error(`${P}activities insert failed`);
          },
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** Seed a SUCCESSFUL payment row with no ledger posting (a mark-paid row written before R0-PL-04). */
async function seedUnpostedPayment(id: string, invoiceId: string, recordedBy: string | null) {
  await db.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID', paidAt: new Date() } });
  await db.payment.create({
    data: {
      id, businessId: ID.biz, invoiceId, amount: INVOICE_TOTAL, currency: 'TTD', status: 'SUCCESSFUL',
      provider: 'manual', method: 'MANUAL', providerPaymentId: `${id}_prov`, notes: 'seeded pre-R0-PL-04 mark-paid', recordedBy,
    },
  });
}

describe('R0-CMF2: a refund names its refunder on a durable row, posted or not (PA-17, ST-R011-2)', () => {
  it('PA-17a: V refunds a SUCCESSFUL payment with no payment_recorded posting -> 201 REFUNDED; one payment_refunded activity row names V (USER); no ledger row is invented; recordedBy is not overwritten; a second refund (409) adds nothing', async () => {
    const paymentId = `${P}pay_unposted`;
    await seedUnpostedPayment(paymentId, ID.invUnpostedRefund, null);
    expect(await postingsFor(paymentId)).toHaveLength(0);

    const res = await refundAs(ID.userV, paymentId, 'unposted');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('REFUNDED');

    const row = await paymentRow(paymentId);
    // V1-29 (D-14): the original is kept as seeded; the refund row names V.
    expect(row).toMatchObject({ status: 'SUCCESSFUL', recordedBy: null });
    expect(await refundRowsOf(paymentId)).toEqual([expect.objectContaining({ amount: -INVOICE_TOTAL, recordedBy: ID.userV })]);
    // Nothing to reverse, and no posting is invented to make one.
    expect(await postingsFor(paymentId)).toHaveLength(0);
    expect(await reversalsFor(paymentId)).toHaveLength(0);
    expect(await db.financialTransaction.count({ where: { businessId: ID.biz, sourceId: paymentId } })).toBe(0);

    await expectOneRefundAuditBy(paymentId, ID.userV, 'USER', false);
    const [audit] = await refundActivityRows(paymentId);
    expect(audit.data).toMatchObject({ invoiceId: ID.invUnpostedRefund, amount: INVOICE_TOTAL, currency: 'TTD' });

    const again = await refundAs(ID.userU, paymentId, 'again');
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    await expectOneRefundAuditBy(paymentId, ID.userV, 'USER', false);
  });

  it('PA-17b: U records, V refunds a posted payment -> the reversal createdById = V and one payment_refunded activity row names V (USER) with ledgerReversed true', async () => {
    const res = await postAs(ID.userU, ID.invPostedRefundAudit, { amount: 55, method: 'cash', reference: 'PYA-RA-1' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const paymentId = res.body.payment.id;

    const refunded = await refundAs(ID.userV, paymentId);
    expect(refunded.status, JSON.stringify(refunded.body)).toBe(201);
    const reversals = await reversalsFor(paymentId);
    expect(reversals).toHaveLength(1);
    expect(reversals[0].createdById).toBe(ID.userV);
    await expectOneRefundAuditBy(paymentId, ID.userV, 'USER', true);
    expect((await paymentRow(paymentId)).recordedBy).toBe(ID.userU);
  });

  it('PA-17c: a service caller refunding with no actor writes the audit row with actorId null and refundedBy null; no actor is invented', async () => {
    const paymentId = `${P}pay_noactor_refund`;
    await seedUnpostedPayment(paymentId, ID.invRefundNoActor, null);
    const updated = await commerce.markPaymentRefunded(paymentId, ID.biz, 'no actor');
    expect(updated.status).toBe('REFUNDED');
    await expectOneRefundAuditBy(paymentId, null, null, false);
  });

  it('PA-17d: a refund that rolls back (reconcile fails inside the transaction) leaves no audit row and hands the timeline nothing; the payment stays SUCCESSFUL and its posting POSTED', async () => {
    const res = await postAs(ID.userU, ID.invRefundRollback, { amount: 45, method: 'cash', reference: 'PYA-RB-1' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const paymentId = res.body.payment.id;

    const spy = vi.spyOn(workflow, 'reconcileFromPayments').mockRejectedValueOnce(new Error(`${P}forced reconcile failure`));
    try {
      const refunded = await refundAs(ID.userV, paymentId, 'rolled back');
      expect(refunded.status, JSON.stringify(refunded.body)).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect((await paymentRow(paymentId)).status).toBe('SUCCESSFUL');
    // V1-29: the rollback leaves no refund row (the original stays SUCCESSFUL either way).
    expect(await refundRowsOf(paymentId)).toHaveLength(0);
    expect(await reversalsFor(paymentId)).toHaveLength(0);
    expect((await postingsFor(paymentId))[0].status).toBe('POSTED');
    expect(refundActivityHanded(paymentId)).toHaveLength(0);
    expect(await refundActivityRows(paymentId)).toHaveLength(0);
  });

  it('PA-17e: a refund with KEY_SYSTEM_ACTOR_ID as the actor labels its audit row SYSTEM with actorId KEY, never USER', async () => {
    const paymentId = `${P}pay_key_refund`;
    await seedUnpostedPayment(paymentId, ID.invRefundKey, null);
    await commerce.markPaymentRefunded(paymentId, ID.biz, 'key', systemActorId);
    await expectOneRefundAuditBy(paymentId, KEY_ACTOR, 'SYSTEM', false);
  });

  it('PA-17f (SEC-CMF2-1, CR-CMF2-1): the audit row does not depend on the best-effort timeline: with the unified timeline rejecting, or its insert failing and being swallowed, V refunds an unposted payment -> 201 REFUNDED and exactly one payment_refunded row names V (USER)', async () => {
    // (a) The unified timeline rejects every entry.
    const rejected = `${P}pay_tl_reject`;
    await seedUnpostedPayment(rejected, ID.invRefundTimelineReject, null);
    const spy = vi.spyOn(timelineStub, 'recordEvent').mockRejectedValue(new Error(`${P}timeline down`));
    try {
      const res = await refundAs(ID.userV, rejected, 'timeline rejects');
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.status).toBe('REFUNDED');
    } finally {
      spy.mockRestore();
    }
    // V1-29 (D-14): the refund is a separate row; the original stays SUCCESSFUL.
    expect((await paymentRow(rejected)).status).toBe('SUCCESSFUL');
    expect(await refundRowsOf(rejected)).toHaveLength(1);
    await expectOneRefundAuditBy(rejected, ID.userV, 'USER', false);

    // (b) The real TimelineService over a client whose activities insert
    // fails: it logs and swallows, as in production.
    const swallowed = `${P}pay_tl_swallow`;
    await seedUnpostedPayment(swallowed, ID.invRefundTimelineSwallow, null);
    const saved = realTimeline;
    realTimeline = new TimelineServiceClass({
      client: { activity: { create: async () => { throw new Error(`${P}db down`); } } },
    });
    try {
      const res = await refundAs(ID.userV, swallowed, 'timeline swallows');
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    } finally {
      realTimeline = saved;
    }
    await expectOneRefundAuditBy(swallowed, ID.userV, 'USER', false);
  });

  it('PA-17g (SEC-CMF2-1, CR-CMF2-1): the audit row is part of the refund: when its insert fails inside the refund transaction, V\'s refund rolls back (500); the payment stays SUCCESSFUL with its notes, its posting POSTED, no reversal and no audit row; the retried refund then names V once', async () => {
    const res = await postAs(ID.userU, ID.invRefundAuditFail, { amount: 35, method: 'cash', reference: 'PYA-AF-1' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const paymentId = res.body.payment.id;
    const notesBefore = (await paymentRow(paymentId)).notes;

    let insertAttempts = 0;
    const real = revenuePosting.onPaymentRefunded;
    const spy = vi.spyOn(revenuePosting, 'onPaymentRefunded').mockImplementationOnce((id: any, opts: any) =>
      real.call(revenuePosting, id, { ...opts, tx: txWithFailingActivityInsert(opts.tx, () => { insertAttempts += 1; }) }),
    );
    try {
      const refunded = await refundAs(ID.userV, paymentId, 'audit insert fails');
      expect(refunded.status, JSON.stringify(refunded.body)).toBe(500);
    } finally {
      spy.mockRestore();
    }
    // The insert was attempted with the refund's own transaction client.
    expect(insertAttempts).toBe(1);
    const row = await paymentRow(paymentId);
    expect(row.status).toBe('SUCCESSFUL');
    expect(row.notes).toBe(notesBefore);
    // V1-29: the original stays SUCCESSFUL even after a refund, so the rollback
    // is proven by the absence of the refund row.
    expect(await refundRowsOf(paymentId)).toHaveLength(0);
    expect(await reversalsFor(paymentId)).toHaveLength(0);
    expect((await postingsFor(paymentId))[0].status).toBe('POSTED');
    expect(await refundActivityRows(paymentId)).toHaveLength(0);
    expect(refundActivityHanded(paymentId)).toHaveLength(0);

    const retried = await refundAs(ID.userV, paymentId, 'retried');
    expect(retried.status, JSON.stringify(retried.body)).toBe(201);
    expect(await reversalsFor(paymentId)).toHaveLength(1);
    await expectOneRefundAuditBy(paymentId, ID.userV, 'USER', true);
  });
});

/** Seed a drive intake file awaiting approval whose plan records one payment on `invoiceId`. */
async function seedDriveIntake(id: string, invoiceId: string, payload: Record<string, unknown>) {
  await db.driveIntakeFile.create({
    data: {
      id,
      businessId: ID.biz,
      driveFileId: `${id}_file`,
      name: `${id}.pdf`,
      mimeType: 'application/pdf',
      modifiedTime: new Date(),
      status: 'reviewing',
      documentType: 'receipt',
      proposedActions: {
        intakeFileId: id,
        documentType: 'receipt',
        summary: 'pya drive receipt',
        actions: [{ type: 'record_payment', payload: { invoiceId, ...payload } }],
      },
    },
  });
}

describe('R0-CMF2: drive-intake approval names the approver on the payment it records (PA-18, ST-R011-3)', () => {
  it('PA-18a: V approves a plan with a record_payment step (POST /drive/businesses/:b/intake/:id/approve) -> Payment.recordedBy, the posting createdById and the invoice.payment_recorded entry name V; a recorder named in the plan payload is ignored', async () => {
    const intakeId = `${P}drive_v`;
    await seedDriveIntake(intakeId, ID.invDriveV, {
      amount: 30, method: 'bank_transfer', reference: 'PYA-DRV-1', recordedBy: ID.userU, actorId: ID.userU,
    });

    const res = await agent().post(`/drive/businesses/${ID.biz}/intake/${intakeId}/approve`).set(HEADER, ID.userV).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.success, JSON.stringify(res.body)).toBe(true);
    expect(res.body.results).toEqual([expect.objectContaining({ action: 'record_payment', success: true })]);

    // V1-41 (D-27): the approved step records the payment PENDING, recorded by
    // V; nothing is posted until a member confirms it (here V).
    const [pending] = await paymentsOf(ID.invDriveV);
    expect(pending).toMatchObject({ amount: 30, status: 'PENDING', reference: 'PYA-DRV-1', recordedBy: ID.userV });
    expect(pending.id).toBe(res.body.results[0].entityId);
    expect(await postingsFor(pending.id)).toHaveLength(0);
    expect(await contactEventsFor(ID.invDriveV)).toHaveLength(0);
    expect((await db.driveIntakeFile.findUnique({ where: { id: intakeId } })).status).toBe('approved');

    const confirmed = await paymentEvidence.confirmPendingPayment(pending.id, ID.biz, ID.userV);
    const rows = await paymentsOf(ID.invDriveV);
    expect(rows.map((r: any) => [r.status, r.recordedBy])).toEqual([['CONFIRMED', ID.userV], ['SUCCESSFUL', ID.userV]]);
    expect(rows[1]).toMatchObject({ id: confirmed.payment.id, amount: 30, reference: 'PYA-DRV-1' });
    await expectPostingBy(confirmed.payment.id, ID.userV);
    await expectContactEventBy(ID.invDriveV, ID.userV, 'USER');
    expect(JSON.stringify(rows)).not.toContain(ID.userU);
  });

  it('PA-18b: the ingestion auto-execute runs the plan with no human (approver "system") -> the PENDING row\'s recordedBy is null, nothing is posted and no contact event is written (D-27); "system" is recorded nowhere (PA-08 holds)', async () => {
    const intakeId = `${P}drive_sys`;
    await seedDriveIntake(intakeId, ID.invDriveSystem, { amount: 20, method: 'cash', reference: 'PYA-DRV-SYS' });

    const result = await driveOrchestrator.executePlan(ID.biz, intakeId, 'system');
    expect(result.success, JSON.stringify(result)).toBe(true);

    const rows = await paymentsOf(ID.invDriveSystem);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'PENDING', recordedBy: null });
    expect(await postingsFor(rows[0].id)).toHaveLength(0);
    expect(await contactEventsFor(ID.invDriveSystem)).toHaveLength(0);
    expect(await financeActivityFor(ID.invDriveSystem)).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain('"system"');
    // No member, no money: the system placeholder cannot confirm it either.
    await expect(paymentEvidence.confirmPendingPayment(rows[0].id, ID.biz, 'system')).rejects.toMatchObject({ status: 403 });
    expect(await postingsFor(rows[0].id)).toHaveLength(0);
  });
});

function approveIntakeAs(user: string, intakeId: string) {
  return agent().post(`/drive/businesses/${ID.biz}/intake/${intakeId}/approve`).set(HEADER, user).send({});
}

describe('R0-CMF2 review repairs: a drive-intake payment step credits the invoice once (PA-18, SEC-CMF2-2)', () => {
  it('PA-18c: U and V approve the same intake concurrently -> one PENDING payment naming one approver and nothing posted (D-27); every successful answer is that payment; once that approver confirms it, one posting and one contact event name them and the invoice is credited once', async () => {
    const intakeId = `${P}drive_race`;
    await seedDriveIntake(intakeId, ID.invDriveRace, { amount: 30, method: 'bank_transfer', reference: 'PYA-DRV-RACE' });

    const answers = await Promise.all([approveIntakeAs(ID.userU, intakeId), approveIntakeAs(ID.userV, intakeId)]);

    const rows = await paymentsOf(ID.invDriveRace);
    expect(rows.map((r: any) => [r.amount, r.status])).toEqual([[30, 'PENDING']]);
    const recorder = rows[0].recordedBy;
    expect([ID.userU, ID.userV]).toContain(recorder);
    expect(await postingsFor(rows[0].id)).toHaveLength(0);
    // Each answer is the one payment (the second replayed) or, if the first
    // had already flipped the intake to approved, the already-executed refusal.
    for (const res of answers) {
      if (res.status === 201) {
        expect(res.body.success, JSON.stringify(res.body)).toBe(true);
        expect(res.body.results).toEqual([expect.objectContaining({ action: 'record_payment', success: true, entityId: rows[0].id })]);
      } else {
        expect(res.status, JSON.stringify(res.body)).toBe(400);
      }
    }
    expect(answers.map((r) => r.status)).toContain(201);
    expect((await db.invoice.findUnique({ where: { id: ID.invDriveRace }, select: { status: true } })).status).toBe('SENT');

    const confirmed = await paymentEvidence.confirmPendingPayment(rows[0].id, ID.biz, recorder);
    const after = await paymentsOf(ID.invDriveRace);
    expect(after.map((r: any) => [r.amount, r.status])).toEqual([[30, 'CONFIRMED'], [30, 'SUCCESSFUL']]);
    await expectPostingBy(confirmed.payment.id, recorder);
    await expectContactEventBy(ID.invDriveRace, recorder, 'USER');
    const invoice = await db.invoice.findUnique({ where: { id: ID.invDriveRace }, select: { status: true } });
    expect(invoice.status).toBe('PARTIALLY_PAID');
  });

  it('PA-18d: U approves an intake; it is run again by V (status back to reviewing, as after a crash before the approved flip) -> no second payment; the replay answers with U\'s payment and U stays the recorder', async () => {
    const intakeId = `${P}drive_rerun`;
    await seedDriveIntake(intakeId, ID.invDriveRerun, { amount: 25, method: 'cash', reference: 'PYA-DRV-RERUN' });

    const first = await approveIntakeAs(ID.userU, intakeId);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.success, JSON.stringify(first.body)).toBe(true);
    await db.driveIntakeFile.update({ where: { id: intakeId }, data: { status: 'reviewing', processedAt: null } });

    const second = await approveIntakeAs(ID.userV, intakeId);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body.success, JSON.stringify(second.body)).toBe(true);
    expect(second.body.results[0].entityId).toBe(first.body.results[0].entityId);

    // V1-41 (D-27): the one row is PENDING, recorded by U, and unposted.
    const rows = await paymentsOf(ID.invDriveRerun);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 25, status: 'PENDING', recordedBy: ID.userU });
    expect(await postingsFor(rows[0].id)).toHaveLength(0);

    // U confirms it: the money is recorded and posted once, by U.
    const confirmed = await paymentEvidence.confirmPendingPayment(rows[0].id, ID.biz, ID.userU);
    expect((await paymentsOf(ID.invDriveRerun)).map((r: any) => [r.status, r.recordedBy])).toEqual([
      ['CONFIRMED', ID.userU],
      ['SUCCESSFUL', ID.userU],
    ]);
    await expectPostingBy(confirmed.payment.id, ID.userU);
    await expectContactEventBy(ID.invDriveRerun, ID.userU, 'USER');
  });
});

// R0-CMF2 review SEC-CMF2-3: the drive-intake approve route wrote payments
// (and, through a plan's create_invoice and apply_credit_note steps, invoices
// and credit notes) behind AuthGuard and BusinessGuard only, so a member with
// revenue:read, or with only crm:read, approved a plan the manual payment route
// refuses them. W7-DRIVE-INTAKE-SCOPE makes the it.todo live: approve carries
// ModuleScopeGuard with RequireModuleScope('revenue', 'write'), the rule every
// payment-writing route has applied since R0-02, and, as a revenue:write
// handler of the commerce module, owner ruling D-46 (a platform SUPER_ADMIN
// who is not a member stays refused on tenant invoice writes;
// d46-write-routes.spec.ts lists it GUARDED). The approver is still the
// recorder (PA-18a). Still open, outside that write set: the data-inbox approve
// route (operations:write, and correctItem rewrites proposedActions).
describe('W7-DRIVE-INTAKE-SCOPE: approving a drive intake plan needs revenue:write (PA-18e, SEC-CMF2-3; D-46)', () => {
  beforeAll(async () => {
    // Two members below revenue:write (an explicit revenue:read, and a scope
    // map holding only crm:read, so revenue is 'none'), and a platform
    // SUPER_ADMIN with no membership in the business.
    await db.user.create({ data: { id: ID.userDriveReader, email: `${ID.userDriveReader}@test.local`, role: 'USER' } });
    await db.membership.create({
      data: { id: `${P}m_userDriveReader`, userId: ID.userDriveReader, businessId: ID.biz, role: 'STAFF', permissionScopes: { revenue: 'read' } },
    });
    await db.user.create({ data: { id: ID.userDriveCrm, email: `${ID.userDriveCrm}@test.local`, role: 'USER' } });
    await db.membership.create({
      data: { id: `${P}m_userDriveCrm`, userId: ID.userDriveCrm, businessId: ID.biz, role: 'STAFF', permissionScopes: { crm: 'read' } },
    });
    await db.user.create({ data: { id: ID.userDriveSuper, email: `${ID.userDriveSuper}@test.local`, role: 'SUPER_ADMIN' } });
  });

  it('PA-18e (SEC-CMF2-3): a STAFF member with revenue:read, or with only crm:read, POST /drive/businesses/:b/intake/:id/approve on a plan with a record_payment step -> 403 like POST .../invoices/:id/payments, and no payment is written; the intake stays reviewing, and V (revenue:write) then approves it and is recorded as the recorder', async () => {
    const intakeId = `${P}drive_scope`;
    await seedDriveIntake(intakeId, ID.invDriveScope, { amount: 15, method: 'cash', reference: 'PYA-DRV-SCOPE' });

    for (const [user, level] of [[ID.userDriveReader, 'read'], [ID.userDriveCrm, 'none']] as const) {
      const res = await approveIntakeAs(user, intakeId);
      // RED-BEFORE: 201 and a PENDING payment recorded by this member.
      expect(res.status, `${level}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body.message).toBe(`Insufficient permissions: revenue requires write access (you have ${level})`);
      // The control: the manual payment route refuses this member the same way.
      const manual = await postAs(user, ID.invDriveScope, { amount: 15, method: 'cash', reference: 'PYA-DRV-SCOPE-MANUAL' });
      expect(manual.status, `${level}: ${JSON.stringify(manual.body)}`).toBe(403);
      expect(manual.body.message).toBe(res.body.message);
    }

    // Refused before the claim: nothing written, the plan not used up.
    expect(await paymentsOf(ID.invDriveScope)).toEqual([]);
    expect(await contactEventsFor(ID.invDriveScope)).toHaveLength(0);
    expect(await financeActivityFor(ID.invDriveScope)).toEqual([]);
    expect(await db.driveIntakeFile.findUnique({ where: { id: intakeId } })).toMatchObject({ status: 'reviewing', processedAt: null });

    // V (STAFF, revenue:write) approves the same plan: V is the recorder (PA-18a holds).
    const approved = await approveIntakeAs(ID.userV, intakeId);
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    expect(approved.body.results).toEqual([expect.objectContaining({ action: 'record_payment', success: true })]);
    const rows = await paymentsOf(ID.invDriveScope);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: approved.body.results[0].entityId, amount: 15, status: 'PENDING', reference: 'PYA-DRV-SCOPE', recordedBy: ID.userV });
    expect(await postingsFor(rows[0].id)).toHaveLength(0);
    expect((await db.driveIntakeFile.findUnique({ where: { id: intakeId } })).status).toBe('approved');
  });

  it('PA-18f (D-46): a platform SUPER_ADMIN with no membership in the business approves a plan with a record_payment step -> 403 \'Not authorized to update this invoice\', as the manual payment route refuses them; nothing is written and the intake stays reviewing', async () => {
    const intakeId = `${P}drive_super`;
    await seedDriveIntake(intakeId, ID.invDriveSuper, { amount: 18, method: 'cash', reference: 'PYA-DRV-SUPER' });

    const res = await approveIntakeAs(ID.userDriveSuper, intakeId);
    // RED-BEFORE: BusinessGuard and ModuleScopeGuard admit SUPER_ADMIN; 201.
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.message).toBe('Not authorized to update this invoice');
    const manual = await postAs(ID.userDriveSuper, ID.invDriveSuper, { amount: 18, method: 'cash', reference: 'PYA-DRV-SUPER-MANUAL' });
    expect(manual.status, JSON.stringify(manual.body)).toBe(403);
    expect(manual.body.message).toBe(res.body.message);

    expect(await paymentsOf(ID.invDriveSuper)).toEqual([]);
    expect(await contactEventsFor(ID.invDriveSuper)).toHaveLength(0);
    expect(await db.driveIntakeFile.findUnique({ where: { id: intakeId } })).toMatchObject({ status: 'reviewing', processedAt: null });
  });
});

// ---------------------------------------------------------------------------
// W3-V1-55c review repairs (owner ruling D-90, on D-08): a payment's FINANCE
// payment_recorded row is its one feed row naming who recorded it, so it is
// part of the payment (SEC-V55C-2: written by the payment's transaction, a
// payment that rolls back leaves none), written once per payment (SEC-V55C-3:
// a re-run on a posted payment, as scripts/finance-backfill-revenue.ts does,
// adds none) and keeps the human a KEY command ran for (SEC-V55C-4: data
// .initiatedBy, as the CRM invoice.payment_recorded copy keeps it).
// ---------------------------------------------------------------------------

/** The FINANCE payment_recorded `activities` rows (real, fresh read) for one payment id. */
async function financeRowsFor(paymentId: string): Promise<any[]> {
  return db.activity.findMany({
    where: { businessId: ID.biz, module: 'FINANCE', action: 'payment_recorded', entityType: 'payment', entityId: paymentId },
    orderBy: { occurredAt: 'asc' },
  });
}

/** The FINANCE payment_recorded entries handed to the best-effort unified timeline for one payment id. */
function financeEntriesHanded(paymentId: string): Array<Record<string, any>> {
  return activity.filter((a) => a.module === 'FINANCE' && a.action === 'payment_recorded' && a.entityId === paymentId);
}

/** Wait out any best-effort (not awaited) timeline write before reading the table. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

describe('W3-V1-55c review repairs: the FINANCE payment_recorded row is part of the payment, once, and keeps the initiating human (PA-19, D-90)', () => {
  it('PA-19a (SEC-V55C-2, D-90): a payment that rolls back (reconcile fails inside the payment transaction) leaves no FINANCE payment_recorded row naming its recorder: 500, no payment, posting or row, and nothing handed to the best-effort timeline; the retried payment then writes its one row naming V with the payment', async () => {
    const invoice = await db.invoice.findUnique({ where: { id: ID.invRecordRollback }, select: { invoiceNumber: true } });
    const rowsForInvoice = () => db.activity.findMany({
      where: { businessId: ID.biz, module: 'FINANCE', action: 'payment_recorded', detail: `Invoice ${invoice.invoiceNumber}` },
    });

    const spy = vi.spyOn(workflow, 'reconcileFromPayments').mockRejectedValueOnce(new Error(`${P}forced reconcile failure`));
    try {
      const res = await postAs(ID.userV, ID.invRecordRollback, { amount: 10, method: 'cash', reference: 'PYA-RR-1' });
      expect(res.status, JSON.stringify(res.body)).toBe(500);
    } finally {
      spy.mockRestore();
    }
    await settle();
    expect(await paymentsOf(ID.invRecordRollback)).toHaveLength(0);
    expect(await db.financialTransaction.count({ where: { businessId: ID.biz, reference: invoice.invoiceNumber } })).toBe(0);
    expect(await rowsForInvoice(), 'FINANCE rows for the rolled-back payment').toEqual([]);
    expect(activity.filter((a) => a.module === 'FINANCE' && a.action === 'payment_recorded'), 'FINANCE entries handed to the timeline').toEqual([]);

    // The retry is recorded once, its row written with it and naming V.
    const retried = await postAs(ID.userV, ID.invRecordRollback, { amount: 10, method: 'cash', reference: 'PYA-RR-2' });
    expect(retried.status, JSON.stringify(retried.body)).toBe(201);
    const paymentId = retried.body.payment.id;
    await expectPostingBy(paymentId, ID.userV);
    const rows = await financeRowsFor(paymentId);
    expect(rows.map((r: any) => [r.actorType, r.actorId, r.contactId, r.title])).toEqual([['USER', ID.userV, ID.contact, 'Payment recorded: TTD 10']]);
    expect(financeEntriesHanded(paymentId), 'written by the payment transaction, not the best-effort timeline').toEqual([]);
    expect((await rowsForInvoice()).map((r: any) => r.entityId)).toEqual([paymentId]);
  });

  it('PA-19b (SEC-V55C-3, D-90): re-running onPaymentRecorded on a payment already posted (scripts/finance-backfill-revenue.ts, with or without a transaction) answers alreadyPosted and adds no second FINANCE row: the payment keeps ONE row, naming V, and one posting', async () => {
    const res = await postAs(ID.userV, ID.invRecordRerun, { amount: 10, method: 'cash', reference: 'PYA-RE-1' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const paymentId = res.body.payment.id;

    const again = await revenuePosting.onPaymentRecorded(paymentId);
    expect(again).toMatchObject({ alreadyPosted: true });
    const inTx = await db.$transaction((tx: any) => revenuePosting.onPaymentRecorded(paymentId, { tx }));
    expect(inTx).toMatchObject({ alreadyPosted: true });
    await settle();

    await expectPostingBy(paymentId, ID.userV);
    const rows = await financeRowsFor(paymentId);
    expect(rows.map((r: any) => [r.actorType, r.actorId])).toEqual([['USER', ID.userV]]);
  });

  it("PA-19c (SEC-V55C-4, PL07-ST-3, D-90): KEY's process_payment for a member names KEY (SYSTEM) on the FINANCE row and keeps that member as data.initiatedBy, as the contact event does; a human recorder's row carries no initiatedBy (PA-15's rule)", async () => {
    await adapter.processPayment({ businessId: ID.biz, invoiceId: ID.invKeyInitiated, amount: 10, method: 'cash', reference: 'PYA-KI-1', initiatedBy: ID.userU });
    const [keyPayment] = await paymentsOf(ID.invKeyInitiated);
    expect(keyPayment.recordedBy).toBe(KEY_ACTOR);
    const keyRows = await financeRowsFor(keyPayment.id);
    expect(keyRows.map((r: any) => [r.actorType, r.actorId])).toEqual([['SYSTEM', KEY_ACTOR]]);
    expect(keyRows[0].data).toMatchObject({ amount: 10, currency: 'TTD', initiatedBy: ID.userU });
    expect(((await contactEventsFor(ID.invKeyInitiated))[0].data as any).initiatedBy).toBe(ID.userU);

    // A human recorder: initiatedBy is ignored, on the row as on the contact event.
    const human = await commerce.recordPayment(
      ID.invHumanInitiated, ID.biz, { amount: 10, method: 'cash', reference: 'PYA-HI-2' }, { actorId: ID.userU, initiatedBy: ID.userV },
    );
    const humanRows = await financeRowsFor(human.payment.id);
    expect(humanRows.map((r: any) => [r.actorType, r.actorId])).toEqual([['USER', ID.userU]]);
    expect((humanRows[0].data as any).initiatedBy).toBeUndefined();
    expect(((await contactEventsFor(ID.invHumanInitiated))[0].data as any).initiatedBy).toBeUndefined();
  });
});
