/**
 * V1-42c-INVOICE-STATUS-EVENTS — a collections reminder still reminds, and a
 * full refund's reopen to SENT emits a status event its listeners act on
 * (REAL database, REAL invoice workflow, REAL ledger posting, REAL event bus
 * and calendar projection).
 *
 * Independent verification of int/trial-I (verify-money) confirmed two
 * regressions introduced by V1-42 and V1-29:
 *
 *   VR-01  Collections "Send reminder" (collections-panel.tsx handleSendReminder) called
 *          PATCH /commerce/invoices/:id/status/sent on the panel's SENT past-due rows. The base
 *          ran that as a SENT -> SENT transition that emitted invoice.sent (flow.listener turns
 *          it into the customer's invoice_sent notification) and logged invoice.sent on the
 *          contact timeline. Since V1-42 the status route answers a held status idempotently:
 *          200, no event, no timeline entry, and the panel still said "Reminder sent". On the
 *          panel's OVERDUE rows it was always a 409 (OVERDUE -> SENT is not a transition).
 *          Fix (the packet's first option): the panel calls the existing reminder door, POST
 *          /commerce/businesses/:b/invoices/:id/send-reminder (CommerceService.sendInvoiceReminder),
 *          and says "Reminder sent" only when that door answers delivered: true. The status
 *          route keeps V1-42's idempotent answer (it is not a reminder). The web half is
 *          apps/web/src/app/app/commerce/billing/__tests__/collections-panel-reminder.test.tsx.
 *   VR-05  A full refund moves PAID (or PARTIALLY_PAID) -> SENT with paidAt cleared (D-14) and
 *          emitted nothing, so the status listeners (the calendar projection) kept showing the
 *          invoice paid: due item COMPLETED, meta { status PAID, paidAt set }. Fix: the
 *          reconcile's D-14 reopen queues invoice.reopened (NOT invoice.sent: nobody is emailed)
 *          on the same post-commit path as invoice.paid / invoice.payment_recorded, and the
 *          calendar commerce listener re-projects on it.
 *
 * Cases:
 *   VR-01a  the status route on a SENT past-due invoice answers 200 and reminds nobody (no event,
 *           no timeline entry, no email): it is not a reminder, so the panel may not use it
 *   VR-01b  the reminder door on the same kind of row (contact with an email) -> 201 delivered:
 *           true; one reminder email to the contact; invoice.payment_reminder_sent on the bus
 *           and on the timeline (no invoice.sent); the invoice stays SENT; nothing is posted
 *   VR-01c  an OVERDUE row (the panel's other rows): the status route is a 409; the reminder door
 *           reminds (delivered: true) and the invoice stays OVERDUE
 *   VR-01d  a contact with no email: the door answers delivered: false, channel manual, sends no
 *           email (so the panel must not say "Reminder sent")
 *   VR-01e  a mail failure is the response (503), invoice.reminder_failed is emitted, no
 *           reminder is logged as sent
 *   VR-05a  (RED at trial-I) a past-due PAID invoice fully refunded -> SENT, paidAt null;
 *           events ['invoice.reopened'] (no invoice.sent, no invoice.paid, no email); the calendar
 *           due item is back to SCHEDULED with meta { status SENT, paidAt null } and the overdue
 *           item is projected again; paying it again completes the due item again
 *   VR-05b  (control) a partial refund (60 + 40 paid, 40 refunded) keeps emitting
 *           invoice.payment_recorded: calendar SCHEDULED, meta PARTIALLY_PAID
 *   VR-05c  (RED at trial-I) a PARTIALLY_PAID invoice whose only payment is refunded -> SENT;
 *           events ['invoice.reopened'] with previousStatus PARTIALLY_PAID; calendar meta SENT
 *   VR-05d  (RED at trial-I) the provider path: a Stripe Checkout payment fully refunded by the
 *           real Stripe refund webhook (the reconcile emits on its own, no event buffer) ->
 *           events ['invoice.reopened']; the calendar due item is back to SCHEDULED
 *   LEDGER  every refund case: each payment transaction balances and the tenant trial balance
 *           balances
 *   SEC-V42C-1a (review, RED before the repair) three concurrent reconciles of one committed full
 *           refund: one changed, one invoice.reopened (it was three of each)
 *   SEC-V42C-1b (review, RED before the repair) a reconcile that starts while a money door holds the
 *           invoice lock reads the door's payment: no SENT written over the settled PAID, no reopen
 *
 * FOLLOW3-A9-REOPEN-LISTENERS (V1-81) turns three census todos into cases: invoice.reopened reaches
 * the CRM timeline and insight, the outbound webhooks and the revenue actions (RED before: each of
 * them kept a fully refunded invoice as paid).
 *   A9-CRM  a full manual refund (PAID -> SENT): the contact timeline (real ContactEvent rows through
 *           RevenueEventListener and CrmTimelineService) gets one invoice.reopened entry { invoiceId,
 *           invoiceNumber, previousStatus PAID, status SENT } after its invoice.paid; the contact
 *           insight snapshot is marked stale with reason 'invoice.reopened' (ContactInsightListener)
 *   A9-HOOK a full manual refund: one invoice.reopened delivery to each active webhook of the business
 *           subscribed to invoice.paid (owner ruling D-58) or to invoice.reopened, signed with that
 *           webhook's secret like the paid delivery; none to a webhook on other events; another
 *           business's webhook receives nothing
 *   A9-ACT  a full manual refund removes the PENDING PAID_INVOICE_NO_RECEIPT ("Send receipt") action of
 *           the invoice; paying it again emits invoice.paid and raises the action again; another
 *           business's row naming the same invoice id is left
 *   A9-STRIPE the Stripe refund webhook path (no event buffer): the timeline entry, the stale insight,
 *           the reopen delivery and the removal of a SNOOZED action
 *   A9-KEEP a COMPLETED or a DISMISSED PAID_INVOICE_NO_RECEIPT row is the operator's record: left
 *   A9-PART (control) a partial refund (PARTIALLY_PAID, invoice.payment_recorded only) triggers none
 *           of the new handlers: no timeline entry, no stale reason, no delivery, the action stays
 *
 * Census of the other invoice-status listeners (outside this packet's write set, it.todo below; the
 * review, SEC-V42C-2, completed it): every one of the 21 invoice.paid handlers but the calendar,
 * first ReferralRewardService (the referrer credit stays after a full refund), then CRM network /
 * revenue-event / insight, projects, margin, attribution, gamification, webhooks, revenue actions,
 * review solicitation, flow / activity / automation, receipts and the AI triggers (CRM revenue-event /
 * insight, webhooks and revenue actions are cases since FOLLOW3-A9). The Payments tab's
 * own Send Reminder (review CR-V42C-1) is a todo in the web test: it is outside the write set.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * CommerceService, InvoiceWorkflowService, RevenuePostingService, PostingService,
 * ChartOfAccountsSeederService, the real EventEmitter2 (EventEmitterModule), the real
 * CalendarCommerceListener and CalendarProjectionService write real rows, and the production
 * GlobalHttpExceptionFilter + ValidationPipe are installed. FOLLOW3-A9 adds the real
 * RevenueEventListener + CrmTimelineService (ContactEvent rows), ContactInsightListener +
 * ContactInsightService (snapshot rows), WebhookDispatcherService (webhook rows; its outbound
 * fetch is recorded and answered 200, no network) and RevenueActionService (revenue_actions rows;
 * its AI draft falls back to the template). Identity attachment is the one
 * stand-in: a test middleware reads `x-v42c-user`, loads that seeded user row and attaches
 * `{ id, email, role }` exactly as the Supabase-verifying AuthMiddleware would. The commerce
 * service's own timeline writes (CrmService.logContactEvent) are a recording stub; the Gmail service records every
 * email and sends nothing; COGS, stats cache, AI, the Activity feed (TimelineService, D-08) and Drive are stubs off the boundary. No
 * provider traffic: the Stripe webhook handler is called directly with a built payload.
 *
 * Fixtures: prefix `v42c_` (registered in test/helpers/fixture-prefixes.json); hard-deleted by
 * raw SQL (patterns built by sqlLikePrefix) in dependency order in beforeAll and afterAll; no
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v42c_';
const HEADER = 'x-v42c-user';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  contactNoEmail: `${P}contactNoEmail`,
  contactMailFails: `${P}contactMailFails`,
  // VR-01
  invRemindStatus: `${P}invRemindStatus`,
  invRemindDoor: `${P}invRemindDoor`,
  invRemindOverdue: `${P}invRemindOverdue`,
  invRemindNoEmail: `${P}invRemindNoEmail`,
  invRemindFails: `${P}invRemindFails`,
  // VR-05
  invFullRefund: `${P}invFullRefund`,
  invPartRefund: `${P}invPartRefund`,
  invPartToSent: `${P}invPartToSent`,
  invStripe: `${P}invStripe`,
  // SEC-V42C-1 (review): concurrent reconciles of one reopen
  invRaceReopen: `${P}invRaceReopen`,
  invRaceStale: `${P}invRaceStale`,
  // FOLLOW3-A9: the invoice.reopened consumers (own contacts where the insight snapshot is read)
  contactA9Crm: `${P}contactA9Crm`,
  contactA9Stripe: `${P}contactA9Stripe`,
  invA9Crm: `${P}invA9Crm`,
  invA9Hook: `${P}invA9Hook`,
  invA9Action: `${P}invA9Action`,
  invA9Stripe: `${P}invA9Stripe`,
  invA9Completed: `${P}invA9Completed`,
  invA9Dismissed: `${P}invA9Dismissed`,
  invA9Partial: `${P}invA9Partial`,
};

/** FOLLOW3-A9 tenant negative control: another business, its owner, contact, webhook and action rows. */
const B = {
  owner: `${P}ownerB`,
  biz: `${P}bizB`,
  contact: `${P}contactB`,
};

const CONTACT_OF: Record<string, string> = {
  [ID.invRemindNoEmail]: ID.contactNoEmail,
  [ID.invRemindFails]: ID.contactMailFails,
  [ID.invA9Crm]: ID.contactA9Crm,
  [ID.invA9Stripe]: ID.contactA9Stripe,
};

/** FOLLOW3-A9 outbound webhooks: the dispatcher's fetch is recorded for these URLs; any other URL throws (no network). */
const HOOK_BASE = `https://hooks.test.local/${P}`;
const SECRET_A = `${P}whsec_a`;
const SECRET_B = `${P}whsec_b`;
const HOOK = {
  paid: { id: `${P}wh_paid`, url: `${HOOK_BASE}paid`, events: ['invoice.paid'], businessId: ID.biz, secret: SECRET_A },
  both: { id: `${P}wh_both`, url: `${HOOK_BASE}both`, events: ['invoice.paid', 'invoice.reopened'], businessId: ID.biz, secret: SECRET_A },
  reopenedOnly: { id: `${P}wh_reopened`, url: `${HOOK_BASE}reopened`, events: ['invoice.reopened'], businessId: ID.biz, secret: SECRET_A },
  sentOnly: { id: `${P}wh_sent`, url: `${HOOK_BASE}sent`, events: ['invoice.sent'], businessId: ID.biz, secret: SECRET_A },
  otherTenant: { id: `${P}wh_b`, url: `${HOOK_BASE}b`, events: ['invoice.paid', 'invoice.reopened'], businessId: B.biz, secret: SECRET_B },
};

/** Every outbound webhook POST the real WebhookDispatcherService made (recorded, never sent). */
const hookDeliveries: Array<{ url: string; event: string; signature: string; timestamp: string; userAgent: string; body: string; json: any }> = [];

function deliveriesFor(invoiceId: string): Array<{ url: string; event: string; signature: string; timestamp: string; userAgent: string; body: string; json: any }> {
  return hookDeliveries.filter((d) => d.json?.data?.invoice?.id === invoiceId);
}

const sign = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('hex');

/** Every reason ContactInsightListener marked a contact's insight snapshot stale with (its safeMarkStale `source`). */
const insightMarks: Array<{ businessId: string; contactId: string; reason: string }> = [];

const STATUS_OF: Record<string, string> = {
  [ID.invRemindOverdue]: 'OVERDUE',
};

const TOTAL = 100;
const MAIL_FAILS_TO = `${P}fails@test.local`;
const PAST_DUE = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

let db: any;
let app: any;
let redis: any;
let paymentsSvc: any;
let workflow: any;
let revenueActions: any;

const WAIT = { timeout: 4_000, interval: 50 };

const sentEmails: Array<{ businessId: string; to: string; subject: string; htmlBody: string }> = [];
let gmailStub: { sendEmail: (args: { businessId: string; to: string; subject: string; htmlBody: string }) => Promise<{ messageId: string }> };

/** The contact timeline: every CrmService.logContactEvent call (the base's "contact timeline"). */
const timeline: Array<{ type: string; contactId: string; data: any }> = [];

/** Every event on the real bus (recorded with onAny, beside the real listeners). */
const emitted: Array<{ name: string; payload: any }> = [];

function eventsFor(invoiceId: string): string[] {
  return emitted.filter((e) => e.payload?.invoice?.id === invoiceId).map((e) => e.name);
}

function timelineFor(invoiceId: string): string[] {
  return timeline.filter((t) => t.data?.invoiceId === invoiceId).map((t) => t.type);
}

/** The real contact timeline (ContactEvent rows) of one invoice, oldest first. */
async function contactTimeline(invoiceId: string, businessId = ID.biz): Promise<any[]> {
  return db.contactEvent.findMany({
    where: { businessId, data: { path: ['invoiceId'], equals: invoiceId } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

/** The PAID_INVOICE_NO_RECEIPT ("Send receipt") revenue action of an invoice in a business, or null. */
async function receiptAction(invoiceId: string, businessId = ID.biz): Promise<any> {
  return db.revenueAction.findUnique({
    where: { businessId_type_relatedType_relatedId: { businessId, type: 'PAID_INVOICE_NO_RECEIPT', relatedType: 'invoice', relatedId: invoiceId } },
  });
}

/** Let the async listeners of an event that should change nothing run before asserting that nothing changed. */
const settle = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms));

async function cleanup() {
  for (const sql of [
    `DELETE FROM calendar_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_insight_snapshots WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM revenue_actions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM webhooks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM webhook_events WHERE provider_event_id LIKE ${sqlLikePrefix(P)}`,
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

function statusRoute(inv: string, status: 'SENT' | 'OVERDUE' | 'VOID') {
  return agent()
    .patch(`/commerce/invoices/${inv}/status/${status.toLowerCase()}`)
    .set(HEADER, ID.owner)
    .send({ businessId: ID.biz, status });
}

function reminderDoor(inv: string, body: Record<string, unknown> = {}) {
  return agent().post(`/commerce/businesses/${ID.biz}/invoices/${inv}/send-reminder`).set(HEADER, ID.owner).send(body);
}

function pay(inv: string, body: Record<string, unknown>) {
  return agent().post(`/commerce/businesses/${ID.biz}/invoices/${inv}/payments`).set(HEADER, ID.owner).send(body);
}

function refund(paymentId: string, reason = 'v42c refund') {
  return agent().post(`/commerce/businesses/${ID.biz}/payments/${paymentId}/refund`).set(HEADER, ID.owner).send({ reason });
}

async function paid(inv: string, amount: number, reference: string) {
  const res = await pay(inv, { amount, method: 'cash', reference });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.payment;
}

async function invoiceRow(id: string): Promise<any> {
  return db.invoice.findUnique({ where: { id } });
}

async function calendarRow(sourceType: 'invoice' | 'invoice_overdue', sourceId: string): Promise<any> {
  return db.calendarEvent.findUnique({
    where: { businessId_sourceType_sourceId: { businessId: ID.biz, sourceType, sourceId } },
  });
}

/** A projected row that is present and not soft-deleted. */
const isLive = (row: any): boolean => row != null && row.deletedAt == null;

/** The calendar listener is async ({ async: true }): wait until its row reads as expected. */
async function waitForCalendar(
  sourceType: 'invoice' | 'invoice_overdue',
  sourceId: string,
  check: (row: any) => void,
) {
  await vi.waitFor(async () => check(await calendarRow(sourceType, sourceId)), { timeout: 4_000, interval: 50 });
}

const money = (n: number) => Math.round(n * 100) / 100;
const sum = (rows: any[], key: string) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

/** LEDGER: each payment transaction of the invoice balances and the tenant trial balance balances. */
async function expectLedgerBalanced(invoiceId: string) {
  const rows = await db.payment.findMany({ where: { invoiceId } });
  const txns = await db.financialTransaction.findMany({
    where: { businessId: ID.biz, sourceType: 'Payment', sourceId: { in: rows.map((r: any) => r.id) } },
    include: { entries: true },
  });
  for (const t of txns) {
    expect(money(sum(t.entries, 'debit')), `${invoiceId} ${t.externalRef}: debits = credits`).toBe(money(sum(t.entries, 'credit')));
  }
  const totals = await db.ledgerEntry.aggregate({ where: { businessId: ID.biz }, _sum: { debit: true, credit: true } });
  expect(money(Number(totals._sum.debit ?? 0)), 'tenant trial balance: debits = credits').toBe(money(Number(totals._sum.credit ?? 0)));
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, ServiceUnavailableException } = await import('@nestjs/common');
  const { EventEmitter2, EventEmitterModule } = await import('@nestjs/event-emitter');
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
  const workflowMod = await import('../src/modules/commerce/invoice-workflow.service');
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
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { CalendarProjectionService } = await import('../src/modules/calendar/calendar-projection.service');
  const { CalendarCommerceListener } = await import('../src/modules/calendar/listeners/commerce.listener');
  // FOLLOW3-A9: the invoice.reopened consumers under test.
  const { RevenueEventListener } = await import('../src/modules/crm/revenue-event.listener');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { ContactInsightListener } = await import('../src/modules/crm/contact-insight.listener');
  const { ContactInsightService } = await import('../src/modules/crm/contact-insight.service');
  const { BestChannelService } = await import('../src/modules/crm/best-channel.service');
  const { WebhookDispatcherService } = await import('../src/modules/webhooks/webhook-dispatcher.service');
  const { RevenueActionService } = await import('../src/modules/commerce/revenue-action.service');
  const { ModelGatewayService } = await import('../src/modules/ai/model-gateway.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');

  // The dispatcher's outbound POSTs: recorded and answered 200 for the fixture URLs; anything else is refused (no network).
  vi.stubGlobal('fetch', async (input: unknown, init?: { headers?: Record<string, string>; body?: unknown }) => {
    const url = String(input);
    if (!url.startsWith(HOOK_BASE)) throw new Error(`v42c: no network in this suite (${url})`);
    const headers = init?.headers ?? {};
    const body = String(init?.body ?? '');
    hookDeliveries.push({
      url,
      event: headers['X-KeyFlow-Event'],
      signature: headers['X-KeyFlow-Signature'],
      timestamp: headers['X-KeyFlow-Timestamp'],
      userAgent: headers['User-Agent'],
      body,
      json: JSON.parse(body),
    });
    return new Response('ok', { status: 200 });
  });

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  gmailStub = {
    sendEmail: async (args) => {
      if (args.to === MAIL_FAILS_TO) {
        throw new ServiceUnavailableException({ error: 'provider_not_configured', message: 'v42c: Gmail is not connected' });
      }
      sentEmails.push(args);
      return { messageId: `${P}msg_${sentEmails.length}` };
    },
  };

  const moduleRef = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot()],
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
      workflowMod.InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      // The status listener under test, over the real projection table.
      CalendarProjectionService,
      CalendarCommerceListener,
      // FOLLOW3-A9: the CRM timeline + insight, outbound webhooks and revenue actions, over real rows.
      RevenueEventListener,
      CrmTimelineService,
      ContactInsightListener,
      ContactInsightService,
      WebhookDispatcherService,
      RevenueActionService,
      { provide: BestChannelService, useValue: {} },
      { provide: ModelGatewayService, useValue: {} },
      {
        provide: AiUsageService,
        useValue: { trackAndComplete: async () => { throw new Error('v42c: no AI in this suite'); } },
      },
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      {
        provide: CrmService,
        useValue: {
          logContactEvent: async (e: { type: string; contactId: string; data: any }) => {
            timeline.push({ type: e.type, contactId: e.contactId, data: e.data });
            return null;
          },
        },
      },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: gmailStub },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
    ],
  }).compile();

  workflow = moduleRef.get(workflowMod.InvoiceWorkflowService);
  revenueActions = moduleRef.get(RevenueActionService);

  // Record every reason the insight listener marks a snapshot stale (the call itself is the real one).
  const insightListener = moduleRef.get(ContactInsightListener) as any;
  const realSafeMarkStale = insightListener.safeMarkStale.bind(insightListener);
  insightListener.safeMarkStale = async (businessId: string, contactId: string, reason: string) => {
    insightMarks.push({ businessId, contactId, reason });
    return realSafeMarkStale(businessId, contactId, reason);
  };

  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  paymentsSvc = new PaymentsService(
    moduleRef.get(PrismaService),
    moduleRef.get(CommerceService),
    moduleRef.get(workflowMod.InvoiceWorkflowService),
    moduleRef.get(RevenuePostingService),
  );

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

  moduleRef.get(EventEmitter2).onAny((name: string | string[], payload: any) => {
    emitted.push({ name: Array.isArray(name) ? name.join('.') : String(name), payload });
  });

  await cleanup();

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V42C Biz', ownerId: ID.owner, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${ID.owner}_m`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'V42c', lastName: 'Customer', email: `${P}c@test.local` } });
  await db.contact.create({ data: { id: ID.contactNoEmail, businessId: ID.biz, firstName: 'V42c', lastName: 'NoEmail', email: null } });
  await db.contact.create({ data: { id: ID.contactMailFails, businessId: ID.biz, firstName: 'V42c', lastName: 'MailFails', email: MAIL_FAILS_TO } });
  await db.contact.create({ data: { id: ID.contactA9Crm, businessId: ID.biz, firstName: 'V42c', lastName: 'A9Crm', email: `${P}a9crm@test.local` } });
  await db.contact.create({ data: { id: ID.contactA9Stripe, businessId: ID.biz, firstName: 'V42c', lastName: 'A9Stripe', email: `${P}a9stripe@test.local` } });
  // FOLLOW3-A9 tenant negative control: business B, its contact (with an insight snapshot) and its webhook.
  await db.user.create({ data: { id: B.owner, email: `${P}ownerB@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: B.biz, name: 'V42C Biz B', ownerId: B.owner, currency: 'TTD' } });
  await db.contact.create({ data: { id: B.contact, businessId: B.biz, firstName: 'V42c', lastName: 'TenantB', email: `${P}b@test.local` } });
  await db.contactInsightSnapshot.create({ data: { businessId: B.biz, contactId: B.contact, payload: {}, stale: false } });
  for (const h of Object.values(HOOK)) {
    await db.webhook.create({ data: { id: h.id, businessId: h.businessId, name: h.id, url: h.url, events: h.events, secret: h.secret, isActive: true } });
  }

  let n = 0;
  for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
    n += 1;
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `V42C-${String(n).padStart(3, '0')}`,
        status: STATUS_OF[id] ?? 'SENT',
        sentAt: new Date(PAST_DUE.getTime() - 14 * 24 * 60 * 60 * 1000),
        dueDate: PAST_DUE,
        subtotal: TOTAL,
        total: TOTAL,
        currency: 'TTD',
        businessId: ID.biz,
        contactId: CONTACT_OF[id] ?? ID.contact,
        items: { create: [{ id: `${id}_item1`, description: `V42C item ${n}`, quantity: 1, unitPrice: TOTAL, total: TOTAL }] },
      },
    });
  }
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  emitted.length = 0;
  sentEmails.length = 0;
  timeline.length = 0;
  hookDeliveries.length = 0;
  insightMarks.length = 0;
});

describe('fixture sanity (real rows)', () => {
  it('every fixture invoice is past due, 100, with no payment; the reminder rows are SENT or OVERDUE', async () => {
    for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
      const row = await invoiceRow(id);
      expect(row, id).toMatchObject({ status: STATUS_OF[id] ?? 'SENT', total: TOTAL, businessId: ID.biz });
      expect(new Date(row.dueDate).getTime(), id).toBeLessThan(Date.now());
      expect(await db.payment.count({ where: { invoiceId: id } }), id).toBe(0);
    }
  });
});

describe('VR-01: the collections "Send reminder" reminds (the panel uses the reminder door, not the status route)', () => {
  it('VR-01a: PATCH status/sent on a SENT past-due invoice answers 200 and reminds nobody (no event, no timeline entry, no email): the V1-42 idempotent answer, not a reminder', async () => {
    const inv = ID.invRemindStatus;
    const before = await invoiceRow(inv);
    const res = await statusRoute(inv, 'SENT');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(eventsFor(inv)).toEqual([]);
    expect(timelineFor(inv)).toEqual([]);
    expect(sentEmails).toHaveLength(0);
    const after = await invoiceRow(inv);
    expect(after).toMatchObject({ status: 'SENT', sentAt: before.sentAt });
  });

  it('VR-01b: the reminder door on a SENT past-due invoice -> 201 delivered: true; one reminder email to the contact; invoice.payment_reminder_sent on the bus and the timeline (no invoice.sent); the invoice stays SENT and nothing is posted', async () => {
    const inv = ID.invRemindDoor;
    const before = await invoiceRow(inv);
    const postingsBefore = await db.financialTransaction.count({ where: { businessId: ID.biz } });
    const res = await reminderDoor(inv);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ delivered: true, channel: 'email', messageId: `${P}msg_1` });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({ businessId: ID.biz, to: `${P}c@test.local` });
    expect(sentEmails[0].subject).toMatch(/^Reminder: Invoice #V42C-/);
    expect(eventsFor(inv)).toEqual(['invoice.payment_reminder_sent']);
    expect(timelineFor(inv)).toEqual(['invoice.payment_reminder_sent']);
    expect(timeline[0].data).toMatchObject({ channel: 'email', status: 'SENT' });
    const after = await invoiceRow(inv);
    expect(after).toMatchObject({ status: 'SENT', sentAt: before.sentAt });
    expect(await db.financialTransaction.count({ where: { businessId: ID.biz } }), 'a reminder posts nothing').toBe(postingsBefore);
  });

  it('VR-01c: an OVERDUE row (the panel lists them too): the status route is a 409, the reminder door reminds (delivered: true) and the invoice stays OVERDUE', async () => {
    const inv = ID.invRemindOverdue;
    const viaStatus = await statusRoute(inv, 'SENT');
    expect(viaStatus.status, JSON.stringify(viaStatus.body)).toBe(409);
    expect(eventsFor(inv)).toEqual([]);

    const res = await reminderDoor(inv);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ delivered: true, channel: 'email' });
    expect(sentEmails.map((m) => m.to)).toEqual([`${P}c@test.local`]);
    expect(eventsFor(inv)).toEqual(['invoice.payment_reminder_sent']);
    expect(timelineFor(inv)).toEqual(['invoice.payment_reminder_sent']);
    expect((await invoiceRow(inv)).status).toBe('OVERDUE');
  });

  it('VR-01d: a contact with no email -> 201 delivered: false, channel manual, no email (the panel must not say "Reminder sent")', async () => {
    const inv = ID.invRemindNoEmail;
    const res = await reminderDoor(inv);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ delivered: false, channel: 'manual' });
    expect(sentEmails).toHaveLength(0);
    expect(timelineFor(inv)).toEqual(['invoice.payment_reminder_sent']);
    expect(timeline[0].data).toMatchObject({ channel: 'manual' });
    expect((await invoiceRow(inv)).status).toBe('SENT');
  });

  it('VR-01e: a mail failure is the response (503), invoice.reminder_failed is emitted and no reminder is logged as sent', async () => {
    const inv = ID.invRemindFails;
    const res = await reminderDoor(inv);
    expect(res.status, JSON.stringify(res.body)).toBe(503);
    expect(sentEmails).toHaveLength(0);
    expect(eventsFor(inv)).toEqual(['invoice.reminder_failed']);
    expect(timelineFor(inv)).toEqual([]);
    expect((await invoiceRow(inv)).status).toBe('SENT');
  });
});

describe('VR-05: a refund that reopens an invoice emits a status event its listeners act on', () => {
  it('VR-05a (RED at trial-I): a past-due PAID invoice fully refunded -> SENT, paidAt null; events [invoice.reopened] only (no invoice.sent, no invoice.paid, no email); the calendar due item is SCHEDULED again with meta { SENT, paidAt null } and the overdue item is projected again; paying again completes it again', async () => {
    const inv = ID.invFullRefund;
    const original = await paid(inv, 100, 'V42C-FULL');
    expect(await invoiceRow(inv)).toMatchObject({ status: 'PAID' });
    expect(eventsFor(inv)).toContain('invoice.paid');
    await waitForCalendar('invoice', inv, (row) => {
      expect(row).toMatchObject({ type: 'INVOICE_DUE', status: 'COMPLETED', deletedAt: null });
      expect(row.meta).toMatchObject({ status: 'PAID' });
      expect(row.meta.paidAt).not.toBeNull();
    });
    await waitForCalendar('invoice_overdue', inv, (row) => expect(isLive(row), 'no live overdue item while PAID').toBe(false));
    emitted.length = 0;
    timeline.length = 0;

    const res = await refund(original.id, 'customer cancelled');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ invoiceStatus: 'SENT', balance: { net: 0, remaining: 100 } });
    const row = await invoiceRow(inv);
    expect(row).toMatchObject({ status: 'SENT', paidAt: null });

    // RED at trial-I: [] (the D-14 reopen emitted nothing).
    expect(eventsFor(inv)).toEqual(['invoice.reopened']);
    const evt = emitted.find((e) => e.name === 'invoice.reopened')!;
    expect(evt.payload).toMatchObject({
      businessId: ID.biz,
      status: 'SENT',
      previousStatus: 'PAID',
      eventName: 'invoice.reopened',
      balance: { net: 0, remaining: 100 },
      invoice: { id: inv, status: 'SENT', paidAt: null },
    });
    expect(sentEmails, 'nobody is emailed by a reopen').toHaveLength(0);
    expect(timelineFor(inv)).not.toContain('invoice.sent');

    // RED at trial-I: the due item stayed COMPLETED with meta { PAID, paidAt set }.
    await waitForCalendar('invoice', inv, (cal) => {
      expect(cal).toMatchObject({ type: 'INVOICE_DUE', status: 'SCHEDULED', deletedAt: null });
      expect(cal.meta).toEqual({ status: 'SENT', paidAt: null });
    });
    await waitForCalendar('invoice_overdue', inv, (cal) => {
      expect(cal).toMatchObject({ type: 'INVOICE_OVERDUE', status: 'OVERDUE', deletedAt: null });
      expect(cal.meta).toMatchObject({ status: 'SENT', paidAt: null });
    });
    await expectLedgerBalanced(inv);

    // Settling it again completes the due item again.
    emitted.length = 0;
    await paid(inv, 100, 'V42C-FULL-AGAIN');
    expect(await invoiceRow(inv)).toMatchObject({ status: 'PAID' });
    expect(eventsFor(inv)).toEqual(['invoice.paid']);
    await waitForCalendar('invoice', inv, (cal) => expect(cal).toMatchObject({ status: 'COMPLETED', deletedAt: null }));
    await waitForCalendar('invoice_overdue', inv, (cal) => expect(isLive(cal), 'the overdue item is removed again').toBe(false));
    await expectLedgerBalanced(inv);
  });

  it('VR-05b (control): a partial refund (60 + 40 paid, 40 refunded) keeps emitting invoice.payment_recorded only; the calendar due item reads SCHEDULED, meta PARTIALLY_PAID, paidAt null', async () => {
    const inv = ID.invPartRefund;
    await paid(inv, 60, 'V42C-P-60');
    const forty = await paid(inv, 40, 'V42C-P-40');
    expect((await invoiceRow(inv)).status).toBe('PAID');
    await waitForCalendar('invoice', inv, (row) => expect(row).toMatchObject({ status: 'COMPLETED' }));
    emitted.length = 0;

    const res = await refund(forty.id, 'returned part');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await invoiceRow(inv)).toMatchObject({ status: 'PARTIALLY_PAID', paidAt: null });
    expect(eventsFor(inv)).toEqual(['invoice.payment_recorded']);
    await waitForCalendar('invoice', inv, (cal) => {
      expect(cal).toMatchObject({ status: 'SCHEDULED', deletedAt: null });
      expect(cal.meta).toEqual({ status: 'PARTIALLY_PAID', paidAt: null });
    });
    expect(sentEmails).toHaveLength(0);
    await expectLedgerBalanced(inv);
  });

  it('VR-05c (RED at trial-I): a PARTIALLY_PAID invoice whose only payment is refunded -> SENT; events [invoice.reopened] with previousStatus PARTIALLY_PAID; the calendar meta reads SENT', async () => {
    const inv = ID.invPartToSent;
    const forty = await paid(inv, 40, 'V42C-PS-40');
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_PAID');
    await waitForCalendar('invoice', inv, (row) => expect(row?.meta).toMatchObject({ status: 'PARTIALLY_PAID' }));
    emitted.length = 0;

    const res = await refund(forty.id, 'all of it back');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await invoiceRow(inv)).toMatchObject({ status: 'SENT', paidAt: null });
    expect(eventsFor(inv)).toEqual(['invoice.reopened']);
    expect(emitted.find((e) => e.name === 'invoice.reopened')!.payload).toMatchObject({
      status: 'SENT',
      previousStatus: 'PARTIALLY_PAID',
      invoice: { id: inv, status: 'SENT' },
    });
    await waitForCalendar('invoice', inv, (cal) => {
      expect(cal).toMatchObject({ status: 'SCHEDULED', deletedAt: null });
      expect(cal.meta).toEqual({ status: 'SENT', paidAt: null });
    });
    expect(sentEmails).toHaveLength(0);
    await expectLedgerBalanced(inv);
  });

  it('VR-05d (RED at trial-I): the provider path, a Stripe Checkout payment fully refunded by the real Stripe refund webhook (the reconcile emits on its own) -> events [invoice.reopened]; the calendar due item is SCHEDULED again', async () => {
    const inv = ID.invStripe;
    await paymentsSvc.processStripeChargeOrSession(
      'checkout.session.completed',
      { id: `${P}cs_full`, client_reference_id: inv, amount_total: 10000, currency: 'ttd', payment_intent: `${P}pi_full` },
      `${P}evt_full`,
    );
    expect(await invoiceRow(inv)).toMatchObject({ status: 'PAID' });
    await waitForCalendar('invoice', inv, (row) => expect(row).toMatchObject({ status: 'COMPLETED' }));
    emitted.length = 0;

    await paymentsSvc.processStripeRefund('charge.refunded', {
      id: `${P}ch_full`, payment_intent: `${P}pi_full`, amount_refunded: 10000, currency: 'ttd',
      refunds: { data: [{ id: `${P}re_full`, amount: 10000, currency: 'ttd', charge: `${P}ch_full`, payment_intent: `${P}pi_full`, status: 'succeeded' }] },
    });
    expect(await invoiceRow(inv)).toMatchObject({ status: 'SENT', paidAt: null });
    expect(eventsFor(inv)).toEqual(['invoice.reopened']);
    expect(emitted.find((e) => e.name === 'invoice.reopened')!.payload).toMatchObject({ status: 'SENT', previousStatus: 'PAID' });
    await waitForCalendar('invoice', inv, (cal) => {
      expect(cal).toMatchObject({ status: 'SCHEDULED', deletedAt: null });
      expect(cal.meta).toEqual({ status: 'SENT', paidAt: null });
    });
    expect(sentEmails).toHaveLength(0);
    await expectLedgerBalanced(inv);
  });

  // Census (V1-42c, completed by review SEC-V42C-2): every listener that acts on invoice.paid and is
  // not told of the reopen. `grep -rn "OnEvent('invoice.paid'" apps/server/src` lists 21 handlers; only
  // the calendar (CalendarCommerceListener, above) also listens to invoice.reopened. Each other one is
  // outside this packet's write set (apps/server/src/modules/{conversion,crm,webhooks,projects,flow,
  // gamification,growth-intelligence,ai,whatsapp}/**, commerce/{revenue-action,margin-on-payment,
  // storefront-invoice-attribution,invoice-receipt}.*, packages/shared ContactEventType), so each stays a
  // todo for a follow-up packet, in order of what a pay-then-full-refund leaves behind. FOLLOW3-A9 made
  // the CRM RevenueEventListener / ContactInsightListener, WebhookDispatcherService and RevenueActionService
  // ones cases (A9-* below, in their todos' place).
  it.todo('VR-05 census (value credit, first): ReferralRewardService.onInvoicePaid (conversion/referral-reward.service.ts:42-100) credits the referrer custom.referralRewardBalance (+referrerReward) and referralRewardsEarned and marks the referred contact referralRewardEarned; after a full refund the credit stays (pay, refund leaves value behind). It must reverse the award on invoice.reopened when the reopened invoice was the one that earned it');
  it.todo('VR-05 census: CrmNetworkService.onInvoicePaid (crm/crm-network.service.ts:396) bumps the referrer lead score and logs referral.deal_won on its timeline; neither is undone by the reopen');
  it.todo('VR-05 census: ProjectRevenueListener.onInvoicePaid (projects/project-revenue.listener.ts:36) advances the invoice projects fromStatus -> toStatusOnInvoicePaid; a reopen leaves them advanced');
  it.todo('VR-05 census: MarginOnPaymentListener.onInvoicePaid (commerce/margin-on-payment.listener.ts:29) captures the invoice margin snapshot; it stays for a refunded sale');
  it.todo('VR-05 census: StorefrontInvoiceAttributionListener.handleInvoicePaid (commerce/storefront-invoice-attribution.listener.ts:30) and JourneyListenerService.onInvoicePaid (growth-intelligence/journey-listener.service.ts:117) record revenue attribution / a CONVERSION touchpoint with the invoice value; neither is reversed');
  it.todo('VR-05 census: GamificationListener.handleInvoicePaid (gamification/gamification.listener.ts:12) sets business metaData.firstSaleMade; a refund of the only sale leaves it set (a ruling, not necessarily a reversal)');
  // FOLLOW3-A9-REOPEN-LISTENERS (V1-81): the three census todos on the CRM timeline / insight, the outbound
  // webhooks and the revenue actions are the cases below (converted in place), with the Stripe path, the
  // COMPLETED / DISMISSED action control and the partial-refund control.
  it('A9-CRM (VR-05 census, RED before FOLLOW3-A9): a full manual refund reopens PAID -> SENT; the contact timeline gets one invoice.reopened entry { invoiceId, invoiceNumber, previousStatus PAID, status SENT } after its invoice.paid and the insight snapshot is marked stale with reason invoice.reopened; no invoice.sent, no email; business B is untouched', async () => {
    const inv = ID.invA9Crm;
    const contactId = ID.contactA9Crm;
    await db.contactInsightSnapshot.create({ data: { businessId: ID.biz, contactId, payload: {}, stale: false } });
    const original = await paid(inv, 100, 'V42C-A9-CRM');
    const invoiceNumber = (await invoiceRow(inv)).invoiceNumber;
    await vi.waitFor(async () => expect((await contactTimeline(inv)).map((e) => e.type)).toEqual(['invoice.paid']), WAIT);
    await vi.waitFor(() => expect(insightMarks.filter((m) => m.contactId === contactId).map((m) => m.reason)).toContain('invoice.paid'), WAIT);
    await settle();
    // The paid invalidation is done: the snapshot reads fresh again before the refund.
    await db.contactInsightSnapshot.update({ where: { contactId }, data: { stale: false } });
    insightMarks.length = 0;
    emitted.length = 0;
    timeline.length = 0;

    const res = await refund(original.id, 'customer cancelled');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await invoiceRow(inv)).toMatchObject({ status: 'SENT', paidAt: null });
    expect(eventsFor(inv)).toEqual(['invoice.reopened']);

    // RED before: the timeline kept invoice.paid and nothing after it.
    await vi.waitFor(async () => expect((await contactTimeline(inv)).map((e) => e.type)).toEqual(['invoice.paid', 'invoice.reopened']), WAIT);
    const reopened = (await contactTimeline(inv))[1];
    expect(reopened).toMatchObject({ businessId: ID.biz, contactId, actorType: 'SYSTEM', source: 'event-bus' });
    expect(reopened.data).toMatchObject({ invoiceId: inv, invoiceNumber, previousStatus: 'PAID', status: 'SENT' });

    // RED before: the insight snapshot was not marked stale by the reopen.
    await vi.waitFor(() => expect(insightMarks).toContainEqual({ businessId: ID.biz, contactId, reason: 'invoice.reopened' }), WAIT);
    await vi.waitFor(async () => expect((await db.contactInsightSnapshot.findUnique({ where: { contactId } })).stale).toBe(true), WAIT);

    await settle();
    expect((await contactTimeline(inv)).map((e) => e.type), 'one reopen, one entry').toEqual(['invoice.paid', 'invoice.reopened']);
    expect(sentEmails, 'nobody is emailed by a reopen').toHaveLength(0);
    expect(timelineFor(inv)).not.toContain('invoice.sent');
    // Tenant negative control: B's timeline and B's snapshot are untouched by A's reopen.
    expect(await db.contactEvent.count({ where: { businessId: B.biz } })).toBe(0);
    expect((await db.contactInsightSnapshot.findUnique({ where: { contactId: B.contact } })).stale).toBe(false);
    expect(insightMarks.filter((m) => m.businessId !== ID.biz)).toEqual([]);
  });

  it('A9-HOOK (VR-05 census, RED before FOLLOW3-A9, owner ruling D-58): a full manual refund -> one invoice.reopened delivery to each active webhook of the business subscribed to invoice.paid or invoice.reopened, signed with its secret like the paid delivery; none to an invoice.sent-only webhook; business B\'s webhook receives nothing', async () => {
    const inv = ID.invA9Hook;
    const original = await paid(inv, 100, 'V42C-A9-HOOK');
    await vi.waitFor(() => expect(deliveriesFor(inv).map((d) => d.url).sort()).toEqual([HOOK.both.url, HOOK.paid.url].sort()), WAIT);
    const paidDelivery = deliveriesFor(inv).find((d) => d.url === HOOK.paid.url)!;
    expect(paidDelivery).toMatchObject({ event: 'invoice.paid', userAgent: 'KeyFlowOS-Webhooks/1.0' });
    expect(paidDelivery.signature).toBe(sign(SECRET_A, paidDelivery.body));
    await settle();
    hookDeliveries.length = 0;
    emitted.length = 0;

    const res = await refund(original.id, 'customer cancelled');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(eventsFor(inv)).toEqual(['invoice.reopened']);

    // RED before: the invoice.paid subscriber got the paid delivery and nothing for the reopen.
    const subscribed = [HOOK.both.url, HOOK.paid.url, HOOK.reopenedOnly.url].sort();
    await vi.waitFor(() => expect(deliveriesFor(inv).map((d) => d.url).sort()).toEqual(subscribed), WAIT);
    await settle();
    const got = deliveriesFor(inv);
    expect(got.map((d) => d.url).sort(), 'one delivery per subscribed webhook').toEqual(subscribed);
    for (const d of got) {
      expect(d.event).toBe('invoice.reopened');
      expect(d.userAgent).toBe(paidDelivery.userAgent);
      expect(d.json).toMatchObject({
        event: 'invoice.reopened',
        businessId: ID.biz,
        timestamp: d.timestamp,
        data: { invoice: { id: inv, status: 'SENT', paidAt: null }, status: 'SENT', previousStatus: 'PAID' },
      });
      expect(d.signature, 'signed like the paid delivery, with the business webhook secret').toBe(sign(SECRET_A, d.body));
      expect(d.signature, 'never with another tenant\'s secret').not.toBe(sign(SECRET_B, d.body));
    }
    expect(hookDeliveries.filter((d) => d.url === HOOK.sentOnly.url || d.url === HOOK.otherTenant.url)).toEqual([]);
    expect(sentEmails).toHaveLength(0);
  });

  it('A9-ACT (VR-05 census, RED before FOLLOW3-A9): paying raises the PENDING PAID_INVOICE_NO_RECEIPT "Send receipt" action; a full manual refund removes it (business B\'s row naming the same invoice id is left); paying again emits invoice.paid and raises it again', async () => {
    const inv = ID.invA9Action;
    // Business B's row that names A's invoice id: a reopen in A must not reach it.
    await db.revenueAction.create({
      data: { id: `${P}ra_b`, businessId: B.biz, type: 'PAID_INVOICE_NO_RECEIPT', title: 'V42C B row', priority: 3, status: 'PENDING', relatedType: 'invoice', relatedId: inv },
    });
    const original = await paid(inv, 100, 'V42C-A9-ACT');
    await vi.waitFor(async () => expect(await receiptAction(inv)).toMatchObject({ status: 'PENDING', contactId: ID.contact, title: expect.stringMatching(/^Send receipt for invoice #V42C-/) }), WAIT);
    await settle();
    emitted.length = 0;

    const res = await refund(original.id, 'customer cancelled');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await invoiceRow(inv)).toMatchObject({ status: 'SENT', paidAt: null });
    expect(eventsFor(inv)).toEqual(['invoice.reopened']);
    // RED before: the PENDING Send receipt action stayed for the reopened invoice.
    await vi.waitFor(async () => expect(await receiptAction(inv), 'the Send receipt action of a reopened invoice is removed').toBeNull(), WAIT);
    expect(await receiptAction(inv, B.biz), 'another tenant\'s row is left').toMatchObject({ id: `${P}ra_b`, status: 'PENDING' });

    emitted.length = 0;
    await paid(inv, 100, 'V42C-A9-ACT-AGAIN');
    expect(await invoiceRow(inv)).toMatchObject({ status: 'PAID' });
    expect(eventsFor(inv)).toEqual(['invoice.paid']);
    await vi.waitFor(async () => expect(await receiptAction(inv), 'paying again raises it again').toMatchObject({ status: 'PENDING', relatedId: inv }), WAIT);
    expect(sentEmails).toHaveLength(0);
    await expectLedgerBalanced(inv);
  });

  it('A9-STRIPE (RED before FOLLOW3-A9): the Stripe refund webhook path (the reconcile emits on its own, no event buffer) reaches every new consumer: one invoice.reopened timeline entry, the insight marked stale (invoice.reopened), one reopen delivery per subscribed webhook, and a SNOOZED Send receipt action removed', async () => {
    const inv = ID.invA9Stripe;
    const contactId = ID.contactA9Stripe;
    await db.contactInsightSnapshot.create({ data: { businessId: ID.biz, contactId, payload: {}, stale: false } });
    await paymentsSvc.processStripeChargeOrSession(
      'checkout.session.completed',
      { id: `${P}cs_a9`, client_reference_id: inv, amount_total: 10000, currency: 'ttd', payment_intent: `${P}pi_a9` },
      `${P}evt_a9`,
    );
    expect(await invoiceRow(inv)).toMatchObject({ status: 'PAID' });
    await vi.waitFor(async () => expect((await contactTimeline(inv)).map((e) => e.type)).toEqual(['invoice.paid']), WAIT);
    await vi.waitFor(async () => expect(await receiptAction(inv)).toMatchObject({ status: 'PENDING' }), WAIT);
    await vi.waitFor(() => expect(deliveriesFor(inv)).toHaveLength(2), WAIT);
    await settle();
    await revenueActions.snooze(ID.biz, (await receiptAction(inv)).id, new Date(Date.now() + 86_400_000), ID.owner);
    expect(await receiptAction(inv)).toMatchObject({ status: 'SNOOZED' });
    await db.contactInsightSnapshot.update({ where: { contactId }, data: { stale: false } });
    insightMarks.length = 0;
    hookDeliveries.length = 0;
    emitted.length = 0;

    await paymentsSvc.processStripeRefund('charge.refunded', {
      id: `${P}ch_a9`, payment_intent: `${P}pi_a9`, amount_refunded: 10000, currency: 'ttd',
      refunds: { data: [{ id: `${P}re_a9`, amount: 10000, currency: 'ttd', charge: `${P}ch_a9`, payment_intent: `${P}pi_a9`, status: 'succeeded' }] },
    });
    expect(await invoiceRow(inv)).toMatchObject({ status: 'SENT', paidAt: null });
    expect(eventsFor(inv)).toEqual(['invoice.reopened']);

    await vi.waitFor(async () => expect((await contactTimeline(inv)).map((e) => e.type)).toEqual(['invoice.paid', 'invoice.reopened']), WAIT);
    expect((await contactTimeline(inv))[1].data).toMatchObject({ invoiceId: inv, previousStatus: 'PAID', status: 'SENT' });
    await vi.waitFor(() => expect(insightMarks).toContainEqual({ businessId: ID.biz, contactId, reason: 'invoice.reopened' }), WAIT);
    await vi.waitFor(async () => expect((await db.contactInsightSnapshot.findUnique({ where: { contactId } })).stale).toBe(true), WAIT);
    const subscribed = [HOOK.both.url, HOOK.paid.url, HOOK.reopenedOnly.url].sort();
    await vi.waitFor(() => expect(deliveriesFor(inv).map((d) => d.url).sort()).toEqual(subscribed), WAIT);
    for (const d of deliveriesFor(inv)) {
      expect(d).toMatchObject({ event: 'invoice.reopened', json: { event: 'invoice.reopened', data: { previousStatus: 'PAID', status: 'SENT' } } });
      expect(d.signature).toBe(sign(SECRET_A, d.body));
    }
    await vi.waitFor(async () => expect(await receiptAction(inv), 'a SNOOZED Send receipt action is removed too').toBeNull(), WAIT);
    expect(sentEmails).toHaveLength(0);
    await expectLedgerBalanced(inv);
  });

  it('A9-KEEP (control): a COMPLETED or a DISMISSED Send receipt action is the operator\'s record: the refund that reopens the invoice leaves it as it is', async () => {
    for (const [inv, close, status] of [
      [ID.invA9Completed, 'complete', 'COMPLETED'],
      [ID.invA9Dismissed, 'dismiss', 'DISMISSED'],
    ] as const) {
      const original = await paid(inv, 100, `V42C-A9-${status}`);
      await vi.waitFor(async () => expect(await receiptAction(inv)).toMatchObject({ status: 'PENDING' }), WAIT);
      await settle();
      await revenueActions[close](ID.biz, (await receiptAction(inv)).id, ID.owner, `v42c ${close}`);
      const closed = await receiptAction(inv);
      expect(closed.status).toBe(status);
      emitted.length = 0;

      const res = await refund(original.id, 'customer cancelled');
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(eventsFor(inv)).toEqual(['invoice.reopened']);
      // The reopen's listeners ran (its calendar projection is back to SCHEDULED); the closed row is left as it is.
      await waitForCalendar('invoice', inv, (cal) => expect(cal).toMatchObject({ status: 'SCHEDULED', deletedAt: null }));
      await settle();
      expect(await receiptAction(inv), `${status} is left`).toMatchObject({
        id: closed.id,
        status,
        completedAt: closed.completedAt,
        resolution: closed.resolution,
        resolvedBy: ID.owner,
      });
    }
  });

  it('A9-PART (control): a partial refund (60 + 40 paid, 40 refunded -> PARTIALLY_PAID, invoice.payment_recorded only) triggers none of the new handlers: no invoice.reopened timeline entry, no reopened stale mark, no delivery, the Send receipt action stays', async () => {
    const inv = ID.invA9Partial;
    await paid(inv, 60, 'V42C-A9-P-60');
    const forty = await paid(inv, 40, 'V42C-A9-P-40');
    expect((await invoiceRow(inv)).status).toBe('PAID');
    await vi.waitFor(async () => expect(await receiptAction(inv)).toMatchObject({ status: 'PENDING' }), WAIT);
    await vi.waitFor(async () => expect((await contactTimeline(inv)).map((e) => e.type)).toEqual(['invoice.paid']), WAIT);
    await settle();
    const before = await receiptAction(inv);
    emitted.length = 0;
    hookDeliveries.length = 0;
    insightMarks.length = 0;

    const res = await refund(forty.id, 'returned part');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await invoiceRow(inv)).toMatchObject({ status: 'PARTIALLY_PAID', paidAt: null });
    expect(eventsFor(inv)).toEqual(['invoice.payment_recorded']);
    await waitForCalendar('invoice', inv, (cal) => expect(cal.meta).toEqual({ status: 'PARTIALLY_PAID', paidAt: null }));
    await settle();
    expect((await contactTimeline(inv)).map((e) => e.type)).toEqual(['invoice.paid']);
    expect(insightMarks.map((m) => m.reason)).not.toContain('invoice.reopened');
    expect(deliveriesFor(inv)).toEqual([]);
    expect(await receiptAction(inv)).toMatchObject({ id: before.id, status: 'PENDING' });
    expect(sentEmails).toHaveLength(0);
  });
  it.todo('VR-05 census: ReviewSolicitationService.onInvoicePaid (conversion/review-solicitation.service.ts:42) schedules a review-request job to the customer; the reopen does not cancel it');
  it.todo('VR-05 census: FlowListener (flow/flow.listener.ts:110 confirms the linked booking and notifies "Invoice Paid"; :324 revenue milestone notification; :483 payment_receipt to the customer), ActivityEventListener (flow/activity-event.listener.ts:58) and AutomationExecutorService.onInvoicePaid (flow/automation-executor.service.ts:650, playbooks / flows on trigger invoice.paid, and AutomationService rule invoice.paid -> "Send thank-you note" task): the booking stays confirmed and no invoice.reopened trigger or activity exists');
  it.todo('VR-05 census: InvoiceReceiptListener (commerce/invoice-receipt.listener.ts:31) and WhatsappNotificationsListener (whatsapp/whatsapp-notifications.listener.ts:73) message the customer on paid; by this packet ruling the reopen messages nobody, so a follow-up rules whether the customer is told of a refund');
  it.todo('VR-05 census: AiListener.onInvoicePaid (ai/ai.listener.ts:36) and AgentTriggerService (onAny, exact eventPattern, no cooldown; default trigger invoice.paid in ai/default-triggers.constants.ts:62) have no invoice.reopened trigger; a business trigger on it fires once per event, which SEC-V42C-1 below keeps to one per reopen');
});

/**
 * Review SEC-V42C-1: a reopen is reconciled, and invoice.reopened emitted, once. The provider refund
 * webhooks (PaymentsService Stripe / PayPal refund paths) call reconcileFromPayments after their refund
 * transaction committed, outside the invoice lock, and a redelivery or a charge.refunded beside its
 * refund.created can run two of them side by side. The reconcile wrote the status by id alone, so every
 * concurrent call read PAID, wrote SENT, returned changed: true and queued invoice.reopened (consumers act
 * once per event: AgentTriggerService.onAny, the calendar). The same gap let a reconcile that read before a
 * money door committed a payment write SENT over the PAID that door left, and emit invoice.reopened for a
 * settled invoice. Fix: without a caller's transaction the reconcile reads and writes under the invoice
 * row lock every money write takes (SELECT ... FOR NO KEY UPDATE), and its status write is compare-and-set
 * on the status it read (a P2025 is changed: false, no event), as transition() is since V1-42.
 */
describe('SEC-V42C-1: one reopen, one invoice.reopened (the reconcile reads under the invoice lock and writes compare-and-set)', () => {
  /** What a provider refund door commits before its reconcile runs (V1-29c): a negative REFUNDED row linked to the payment; the invoice status is left to the reconcile. */
  async function committedRefundRow(inv: string, paymentId: string, key: string) {
    const original = await db.payment.findUnique({ where: { id: paymentId } });
    await db.payment.create({
      data: {
        id: `${P}${key}`,
        amount: -Number(original.amount),
        currency: 'TTD',
        status: 'REFUNDED',
        provider: 'stripe',
        method: 'card',
        providerPaymentId: `${P}${key}`,
        reference: original.providerPaymentId,
        businessId: ID.biz,
        invoiceId: inv,
      },
    });
  }

  it('SEC-V42C-1a (RED before the repair): three concurrent reconciles of one committed full refund -> one changed, one invoice.reopened; the invoice is SENT, paidAt null, the calendar due item SCHEDULED', async () => {
    const inv = ID.invRaceReopen;
    const original = await paid(inv, 100, 'V42C-RACE');
    expect(await invoiceRow(inv)).toMatchObject({ status: 'PAID' });
    await waitForCalendar('invoice', inv, (row) => expect(row).toMatchObject({ status: 'COMPLETED' }));
    await committedRefundRow(inv, original.id, 'race_refund');
    expect((await invoiceRow(inv)).status, 'the refund row alone moves nothing').toBe('PAID');
    emitted.length = 0;

    const results = await Promise.all([1, 2, 3].map(() => workflow.reconcileFromPayments(inv)));

    // Before the repair: [[SENT, true], [SENT, true], [SENT, true]] and three invoice.reopened.
    expect(results.map((r: any) => r.status)).toEqual(['SENT', 'SENT', 'SENT']);
    expect(results.filter((r: any) => r.changed), 'exactly one reconcile moves the invoice').toHaveLength(1);
    expect(eventsFor(inv)).toEqual(['invoice.reopened']);
    expect(await invoiceRow(inv)).toMatchObject({ status: 'SENT', paidAt: null });
    await waitForCalendar('invoice', inv, (cal) => {
      expect(cal).toMatchObject({ status: 'SCHEDULED', deletedAt: null });
      expect(cal.meta).toEqual({ status: 'SENT', paidAt: null });
    });
  });

  it('SEC-V42C-1b (RED before the repair): a reconcile that starts while a money door holds the invoice lock waits for it and reads its payment: the invoice stays PAID, no invoice.reopened', async () => {
    const inv = ID.invRaceStale;
    const original = await paid(inv, 100, 'V42C-STALE');
    await waitForCalendar('invoice', inv, (row) => expect(row).toMatchObject({ status: 'COMPLETED' }));
    await committedRefundRow(inv, original.id, 'stale_refund');
    emitted.length = 0;

    // A money door in flight (CommerceService.recordPayment's shape): it holds the invoice row lock and
    // writes a +100 payment, which leaves the invoice PAID, then commits. This transaction is the
    // concurrency under test, not fixture wrapping.
    let lockHeld!: () => void;
    const held = new Promise<void>((resolve) => { lockHeld = resolve; });
    const door = db.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${inv} FOR NO KEY UPDATE`;
      await tx.payment.create({
        data: {
          id: `${P}stale_repay`,
          amount: 100,
          currency: 'TTD',
          status: 'SUCCESSFUL',
          provider: 'cash',
          method: 'cash',
          providerPaymentId: `${P}stale_repay`,
          businessId: ID.biz,
          invoiceId: inv,
        },
      });
      lockHeld();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }, { timeout: 10_000 });
    await held;
    const reconcile = workflow.reconcileFromPayments(inv);
    await door;
    const result = await reconcile;

    // Before the repair: the reconcile read PAID with [100, -100] (the door's row not yet committed),
    // derived SENT, waited on the row lock and then wrote SENT over the settled invoice: { SENT, true }
    // and invoice.reopened, with 100 net received. A compare-and-set alone does not catch it (the status
    // it read, PAID, is still the status when it writes).
    expect(result).toMatchObject({ status: 'PAID', changed: false, balance: { net: 100, remaining: 0 } });
    expect(await invoiceRow(inv)).toMatchObject({ status: 'PAID' });
    expect(eventsFor(inv)).toEqual([]);
  });
});
