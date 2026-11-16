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
 *           insight snapshot is marked stale with reason 'invoice.reopened' (ContactInsightListener);
 *           since PR196-CRM-LIFECYCLE (D-81) its paid invoice also asks CrmService, once, to move the
 *           invoice row's contact (recorded stub; review CR-1)
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
 * FOLLOW3-A9 review repairs (each RED before the repair):
 *   A9-R1  (SEC-A9-1) the paid handler is still drafting its recommendation (a slow AI call) when the
 *          refund's reopen handler runs and finds no row: no Send receipt action is raised for the
 *          reopened invoice afterwards
 *   A9-R2  (SEC-A9-1) the reopen's handler runs between the paid handler's last status check and its
 *          write: the row it writes is removed by its own check after the write
 *   A9-R3  (SEC-A9-1, reverse window) a re-pay commits between the reopen handler's status read and its
 *          delete: the PAID invoice keeps (gets back) its Send receipt action
 *   A9-R4  (SEC-A9-1) the 5-minute sweep (reconcileBusiness) removes an open Send receipt action of a
 *          SENT or OVERDUE invoice of the business; PAID, PARTIALLY_PAID, COMPLETED rows and a row
 *          naming another business's invoice are left
 *   A9-R5  (SEC-A9-2 / CR-A9-1) pay, full refund, pay again, full refund again inside the dedupe window:
 *          the timeline is [paid, reopened, paid, reopened], each entry the invoice's status at the
 *          time; a re-delivery of the same paid or reopen event still writes nothing
 *
 * Census of the other invoice-status listeners (outside this packet's write set, it.todo below; the
 * review, SEC-V42C-2, completed it): every one of the 21 invoice.paid handlers but the calendar,
 * first ReferralRewardService (the referrer credit stays after a full refund), then CRM network /
 * revenue-event / insight, projects, margin, attribution, gamification, webhooks, revenue actions,
 * review solicitation, flow / activity / automation, receipts and the AI triggers (CRM revenue-event /
 * insight, webhooks and revenue actions are cases since FOLLOW3-A9). The Payments tab's
 * own Send Reminder (review CR-V42C-1) is a todo in the web test: it is outside the write set.
 *
 * W10-REOPEN-REVERSALS (owner ruling D-102) turns the ten remaining census todos into cases. The money
 * effects of a paid invoice are undone when a full refund reopens it (each RED before the packet): the
 * referral reward credit (ReferralRewardService), the referrer's lead-score bump (CrmNetworkService, with a
 * referral.deal_reopened note and no message), the projects' paid advance (ProjectRevenueListener), the
 * margin snapshot (MarginOnPaymentListener: marked reversed, never deleted) and a review request not yet sent
 * (ReviewSolicitationService). Each reversal is idempotent (a re-delivered reopen reverses nothing more) and
 * skipped when the paid effect never ran. These five run as real providers on the real bus. What D-102 keeps
 * is pinned live (green on the base, no source change): attribution history, the first-sale flag, the
 * booking confirmation and paid notifications, the messages already sent, and the AI listeners (no
 * invoice.reopened trigger). Those listeners message the customer or write the feed on invoice.paid, which
 * the other cases here must not see, so each pin subscribes its listeners' own @OnEvent handlers to the real
 * bus for that case only (wireOnBus reads the metadata the Nest event-emitter loader reads), over real rows
 * where they write rows and recording stubs where they would message someone.
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
  // FOLLOW3-A9 review repairs (SEC-A9-1, SEC-A9-2 / CR-A9-1)
  invA9RaceDraft: `${P}invA9RaceDraft`,
  invA9RaceWrite: `${P}invA9RaceWrite`,
  invA9RaceRepay: `${P}invA9RaceRepay`,
  invA9Repay: `${P}invA9Repay`,
  // W10-REOPEN-REVERSALS (D-102): the reversals and the keep pins
  contactD102Referrer: `${P}contactD102Referrer`,
  contactD102Referred: `${P}contactD102Referred`,
  contactD102NetReferrer: `${P}contactD102NetReferrer`,
  contactD102NetReferred: `${P}contactD102NetReferred`,
  contactD102NetLate: `${P}contactD102NetLate`,
  contactD102Msg: `${P}contactD102Msg`,
  invD102Referral: `${P}invD102Referral`,
  invD102Referral2: `${P}invD102Referral2`,
  invD102Network: `${P}invD102Network`,
  invD102NetLate: `${P}invD102NetLate`,
  invD102Project: `${P}invD102Project`,
  invD102ProjectOther: `${P}invD102ProjectOther`,
  invD102Margin: `${P}invD102Margin`,
  invD102MarginPart: `${P}invD102MarginPart`,
  invD102Review: `${P}invD102Review`,
  invD102ReviewSent: `${P}invD102ReviewSent`,
  invD102KeepAttr: `${P}invD102KeepAttr`,
  invD102KeepGame: `${P}invD102KeepGame`,
  invD102KeepFlow: `${P}invD102KeepFlow`,
  invD102KeepMsg: `${P}invD102KeepMsg`,
  invD102KeepAi: `${P}invD102KeepAi`,
};

/** W10-REOPEN-REVERSALS (D-102) fixtures beside the invoices: a product, a service, bookings, projects. */
const D102 = {
  product: `${P}prod_d102`,
  service: `${P}svc_d102`,
  bookingAttr: `${P}bk_d102_attr`,
  bookingFlow: `${P}bk_d102_flow`,
  prjAdvance: `${P}prj_d102_advance`,
  prjAlready: `${P}prj_d102_already`,
  prjMoved: `${P}prj_d102_moved`,
  prjOther: `${P}prj_d102_other`,
  trigPaid: `${P}trig_d102_paid`,
  trigReopened: `${P}trig_d102_reopened`,
};

/** The invoices whose one line item is the D-102 product (MarginOnPaymentListener snapshots product lines). */
const PRODUCT_OF: Record<string, string> = {
  [ID.invD102Margin]: D102.product,
  [ID.invD102MarginPart]: D102.product,
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
  [ID.invD102Referral]: ID.contactD102Referred,
  [ID.invD102Referral2]: ID.contactD102Referred,
  [ID.invD102Network]: ID.contactD102NetReferred,
  [ID.invD102NetLate]: ID.contactD102NetLate,
  [ID.invD102KeepMsg]: ID.contactD102Msg,
};

/** FOLLOW3-A9 outbound webhooks: the dispatcher's fetch is recorded for these URLs; any other URL throws (no network). */
// SWEEP-P0-SCOPES (BUG-001): a TEST-NET-3 address literal (documentation only, never routed): every delivery now
// passes the outbound-address guard, which resolves a name; an IP literal is checked without DNS.
const HOOK_BASE = `https://203.0.113.21/${P}`;
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

/**
 * PR196-CRM-LIFECYCLE (D-81, review CR-1): every paid-invoice contact move RevenueEventListener asks
 * CrmService for (recorded; the move itself, its rows and events, is proven on a real CrmService by
 * crm-lifecycle-paid-invoice.integration.test.ts). Without the method the stub threw a TypeError the
 * listener swallowed, and this suite could not see the call.
 */
const lifecycleMoves: Array<{ businessId: string; contactId: string; invoiceId: string; invoiceNumber?: string | null }> = [];

/**
 * W10-REOPEN-REVERSALS (D-102): every customer email a TransactionalEmailService stub was asked to send
 * (the review-request runner's, and in the keep pins the flow listeners'); recorded, never sent.
 */
const transactionalSends: Array<{ businessId: string; type: string; recipientEmail?: string; dedupeKey?: string; templateData?: any }> = [];

/** W10-REOPEN-REVERSALS keep pins: a handler of a listener wired by wireOnBus that threw (none may). */
const wiredErrors: string[] = [];
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
let revenueEvents: any;
let calendarListener: any;
// W10-REOPEN-REVERSALS (D-102): the bus, the real services the keep pins build their listeners over, and
// the five reversal providers (their reopen handlers are re-delivered directly).
let bus: any;
let prismaSvc: any;
let commerceSvc: any;
let referralRewards: any;
let crmNetwork: any;
let projectRevenue: any;
let marginListener: any;
let reviewSolicitation: any;

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
    // W10-REOPEN-REVERSALS (D-102): bookings first (they hold invoices, contacts and the service).
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM margin_snapshots WHERE product_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM scheduled_agent_jobs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM projects WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM agent_triggers WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM revenue_attributions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM journey_touchpoints WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM customer_journeys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_relationships WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

/**
 * W10-REOPEN-REVERSALS (D-102 keep pins): subscribes a listener instance's own @OnEvent handlers to the
 * real bus, as the Nest event-emitter loader does (it reads the same EVENT_LISTENER_METADATA from each
 * method), for one case only. Returns the event names it subscribed and the unsubscribe; a handler that
 * throws is recorded in wiredErrors (the loader's suppressErrors would log it).
 */
function wireOnBus(instance: object): { events: string[]; unwire: () => void } {
  const proto = Object.getPrototypeOf(instance);
  const subs: Array<[string, (...args: any[]) => Promise<void>]> = [];
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor') continue;
    const fn = (proto as Record<string, unknown>)[key];
    if (typeof fn !== 'function') continue;
    const meta: Array<{ event: string | string[] }> = Reflect.getMetadata('EVENT_LISTENER_METADATA', fn) ?? [];
    for (const { event } of meta) {
      for (const name of Array.isArray(event) ? event : [event]) {
        const handler = async (...args: any[]) => {
          try {
            await fn.apply(instance, args);
          } catch (e) {
            wiredErrors.push(`${instance.constructor.name}.${key} on ${name}: ${(e as Error).message}`);
          }
        };
        bus.on(name, handler);
        subs.push([name, handler]);
      }
    }
  }
  return { events: subs.map(([n]) => n), unwire: () => { for (const [n, h] of subs) bus.off(n, h); } };
}

/** The reopen payload of an invoice on the bus (recorded since `emitted` was last cleared). */
function reopenPayload(invoiceId: string): any {
  const e = emitted.find((x) => x.name === 'invoice.reopened' && x.payload?.invoice?.id === invoiceId);
  expect(e, `invoice.reopened for ${invoiceId}`).toBeDefined();
  return e!.payload;
}

/** A full manual refund that reopens the invoice: 201, SENT, and one invoice.reopened. */
async function fullRefund(inv: string, paymentId: string, reason: string) {
  emitted.length = 0;
  const res = await refund(paymentId, reason);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(await invoiceRow(inv)).toMatchObject({ status: 'SENT', paidAt: null });
  expect(eventsFor(inv)).toEqual(['invoice.reopened']);
  return reopenPayload(inv);
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
  // W10-REOPEN-REVERSALS (D-102): the five reversal listeners under test, over real rows.
  const { ReferralRewardService } = await import('../src/modules/conversion/referral-reward.service');
  const { CrmNetworkService } = await import('../src/modules/crm/crm-network.service');
  const { ReputationService } = await import('../src/modules/community/reputation.service');
  const { ProjectRevenueListener } = await import('../src/modules/projects/project-revenue.listener');
  const { MarginOnPaymentListener } = await import('../src/modules/commerce/margin-on-payment.listener');
  const { LandedCostEngine } = await import('../src/modules/commerce/landed-cost-engine.service');
  const { ReviewSolicitationService } = await import('../src/modules/conversion/review-solicitation.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');

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
      // W10-REOPEN-REVERSALS (D-102): the reversal listeners (real), the reputation recalculation a
      // stub off the boundary, the review-request email recorded. LandedCostEngine and
      // MarginOnPaymentListener are built by factory: their constructors name types without @Inject.
      ReferralRewardService,
      CrmNetworkService,
      { provide: ReputationService, useValue: { recalculate: async () => null } },
      ProjectRevenueListener,
      { provide: LandedCostEngine, useFactory: (p: any) => new LandedCostEngine(p), inject: [PrismaService] },
      {
        provide: MarginOnPaymentListener,
        useFactory: (p: any, engine: any) => new MarginOnPaymentListener(p, engine),
        inject: [PrismaService, LandedCostEngine],
      },
      ReviewSolicitationService,
      {
        provide: TransactionalEmailService,
        useValue: { send: async (a: any) => { transactionalSends.push(a); return { sent: true }; } },
      },
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      {
        provide: CrmService,
        useValue: {
          logContactEvent: async (e: { type: string; contactId: string; data: any }) => {
            timeline.push({ type: e.type, contactId: e.contactId, data: e.data });
            return null;
          },
          advanceToClientOnInvoicePaid: async (m: { businessId: string; contactId: string; invoiceId: string; invoiceNumber?: string | null }) => {
            lifecycleMoves.push(m);
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
  revenueEvents = moduleRef.get(RevenueEventListener);
  calendarListener = moduleRef.get(CalendarCommerceListener);
  bus = moduleRef.get(EventEmitter2);
  prismaSvc = moduleRef.get(PrismaService);
  commerceSvc = moduleRef.get(CommerceService);
  referralRewards = moduleRef.get(ReferralRewardService);
  crmNetwork = moduleRef.get(CrmNetworkService);
  projectRevenue = moduleRef.get(ProjectRevenueListener);
  marginListener = moduleRef.get(MarginOnPaymentListener);
  reviewSolicitation = moduleRef.get(ReviewSolicitationService);

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
  // W10-REOPEN-REVERSALS (D-102): the referral pair (the referred contact names its referrer in custom),
  // the network pair (a referred_by edge; NetLate's edge is added by its case after its payment), the
  // keep-pin customer with a phone, and the product the margin invoices sell.
  await db.contact.create({ data: { id: ID.contactD102Referrer, businessId: ID.biz, firstName: 'V42c', lastName: 'Referrer', email: `${P}d102referrer@test.local`, custom: {} } });
  await db.contact.create({ data: { id: ID.contactD102Referred, businessId: ID.biz, firstName: 'V42c', lastName: 'Referred', email: `${P}d102referred@test.local`, custom: { referralSourceId: ID.contactD102Referrer } } });
  await db.contact.create({ data: { id: ID.contactD102NetReferrer, businessId: ID.biz, firstName: 'V42c', lastName: 'NetReferrer', email: `${P}d102netreferrer@test.local`, leadScore: 20 } });
  await db.contact.create({ data: { id: ID.contactD102NetReferred, businessId: ID.biz, firstName: 'V42c', lastName: 'NetReferred', email: `${P}d102netreferred@test.local` } });
  await db.contact.create({ data: { id: ID.contactD102NetLate, businessId: ID.biz, firstName: 'V42c', lastName: 'NetLate', email: `${P}d102netlate@test.local` } });
  await db.contact.create({ data: { id: ID.contactD102Msg, businessId: ID.biz, firstName: 'V42c', lastName: 'Msg', email: `${P}d102msg@test.local`, phone: '+18685550142' } });
  await db.contactRelationship.create({ data: { businessId: ID.biz, fromContactId: ID.contactD102NetReferred, toContactId: ID.contactD102NetReferrer, type: 'referred_by' } });
  await db.product.create({ data: { id: D102.product, businessId: ID.biz, name: 'V42C D102 product', price: TOTAL, currency: 'TTD' } });
  await db.service.create({ data: { id: D102.service, businessId: ID.biz, name: 'V42C D102 service', duration: 60, price: TOTAL } });

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
        items: { create: [{ id: `${id}_item1`, description: `V42C item ${n}`, quantity: 1, unitPrice: TOTAL, total: TOTAL, productId: PRODUCT_OF[id] ?? null }] },
      },
    });
  }
  // W10-REOPEN-REVERSALS (D-102): the projects of the project invoice (and one of another invoice) and the
  // bookings of the two keep-pin invoices that belong to a visit.
  const project = (id: string, status: string, invoiceId: string) =>
    db.project.create({ data: { id, businessId: ID.biz, name: id, status, invoiceId, contactId: ID.contact } });
  await project(D102.prjAdvance, 'ACTIVE', ID.invD102Project);
  await project(D102.prjAlready, 'IN_PROGRESS', ID.invD102Project);
  await project(D102.prjMoved, 'ACTIVE', ID.invD102Project);
  await project(D102.prjOther, 'ACTIVE', ID.invD102ProjectOther);
  const visit = { startTime: new Date(Date.now() + 2 * 86_400_000), endTime: new Date(Date.now() + 2 * 86_400_000 + 3_600_000) };
  await db.booking.create({ data: { id: D102.bookingAttr, businessId: ID.biz, contactId: ID.contact, serviceId: D102.service, invoiceId: ID.invD102KeepAttr, status: 'CONFIRMED', ...visit } });
  await db.booking.create({ data: { id: D102.bookingFlow, businessId: ID.biz, contactId: ID.contact, serviceId: D102.service, invoiceId: ID.invD102KeepFlow, status: 'PENDING', ...visit } });
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
  lifecycleMoves.length = 0;
  transactionalSends.length = 0;
  wiredErrors.length = 0;
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
  // W10-REOPEN-REVERSALS (owner ruling D-102): the six census todos above the A9 cases are cases (converted
  // in place). The reopen undoes the paid invoice's money effects; what the ruling keeps is pinned live.
  it('VR-05 census (value credit, first) (W10-REOPEN-REVERSALS, D-102, was it.todo): ReferralRewardService.onInvoicePaid credits the referrer custom.referralRewardBalance (+10) and referralRewardsEarned (+1) and marks the referred contact referralRewardEarned; the full refund that reopens the invoice which earned it reverses all three (the referral itself stays); a re-delivered reopen reverses nothing more; a second paid invoice of the same contact earned nothing, so its reopen reverses nothing; paying again earns it again and the next reopen reverses it once more; nobody is messaged', async () => {
    const custom = async (id: string) => ((await db.contact.findUnique({ where: { id } })).custom ?? {}) as Record<string, any>;
    const credit = async () => {
      const c = await custom(ID.contactD102Referrer);
      return { balance: c.referralRewardBalance ?? 0, earned: c.referralRewardsEarned ?? 0 };
    };

    const p1 = await paid(ID.invD102Referral, 100, 'V42C-D102-REF-1');
    await vi.waitFor(async () => expect(await credit()).toEqual({ balance: 10, earned: 1 }), WAIT);
    expect(await custom(ID.contactD102Referred)).toMatchObject({ referralSourceId: ID.contactD102Referrer, referralRewardEarned: true });

    // The same contact's second paid invoice earns nothing (the reward is once per referred contact) ...
    const p2 = await paid(ID.invD102Referral2, 100, 'V42C-D102-REF-2');
    await settle();
    expect(await credit()).toEqual({ balance: 10, earned: 1 });
    // ... so its reopen reverses nothing: the paid effect never ran for it.
    await fullRefund(ID.invD102Referral2, p2.id, 'v42c d102 second invoice');
    await settle();
    expect(await credit(), 'the reward the second invoice did not earn stays').toEqual({ balance: 10, earned: 1 });
    expect(await custom(ID.contactD102Referred)).toMatchObject({ referralRewardEarned: true });

    // RED before: the credit and the mark stayed after the refund of the invoice that earned them.
    const reopen = await fullRefund(ID.invD102Referral, p1.id, 'v42c d102 first invoice');
    await vi.waitFor(async () => expect(await credit()).toEqual({ balance: 0, earned: 0 }), WAIT);
    const referred = await custom(ID.contactD102Referred);
    expect(referred.referralRewardEarned ?? false, 'the referred contact may earn it again').toBe(false);
    expect(referred.referralSourceId, 'the referral itself stays').toBe(ID.contactD102Referrer);

    // A re-delivered reopen reverses nothing more.
    await referralRewards.onInvoiceReopened(reopen);
    await settle();
    expect(await credit()).toEqual({ balance: 0, earned: 0 });

    // Paying again earns it again; the next reopen reverses it once more.
    const p3 = await paid(ID.invD102Referral, 100, 'V42C-D102-REF-3');
    await vi.waitFor(async () => expect(await credit()).toEqual({ balance: 10, earned: 1 }), WAIT);
    await fullRefund(ID.invD102Referral, p3.id, 'v42c d102 first invoice again');
    await vi.waitFor(async () => expect(await credit()).toEqual({ balance: 0, earned: 0 }), WAIT);
    await settle();
    expect(await credit()).toEqual({ balance: 0, earned: 0 });
    expect(sentEmails, 'the reopen messages no one').toHaveLength(0);
    await expectLedgerBalanced(ID.invD102Referral);
  }, 30_000);

  it('VR-05 census (W10-REOPEN-REVERSALS, D-102, was it.todo): CrmNetworkService.onInvoicePaid bumps the referrer lead score (+15) and logs referral.deal_won on its timeline; the reopen takes the bump back and logs one referral.deal_reopened note on the referrer timeline (nobody is messaged); a re-delivered reopen changes nothing; an invoice paid before its contact named the referrer moved no score, so its reopen moves none', async () => {
    const referrer = ID.contactD102NetReferrer;
    const score = async () => (await db.contact.findUnique({ where: { id: referrer }, select: { leadScore: true } })).leadScore;
    const notes = async (inv: string) =>
      (await db.contactEvent.findMany({
        where: { businessId: ID.biz, contactId: referrer, type: 'note.created', data: { path: ['invoiceId'], equals: inv } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })) as any[];
    expect(await score()).toBe(20);

    const p = await paid(ID.invD102Network, 100, 'V42C-D102-NET');
    await vi.waitFor(async () => expect(await score()).toBe(35), WAIT);
    await vi.waitFor(async () => expect((await notes(ID.invD102Network)).map((e) => e.data.kind)).toEqual(['referral.deal_won']), WAIT);

    // Control: NetLate's invoice is paid before NetLate names the referrer, so no bump ran for it ...
    const late = await paid(ID.invD102NetLate, 100, 'V42C-D102-NET-LATE');
    await settle();
    expect(await score()).toBe(35);
    await db.contactRelationship.create({ data: { businessId: ID.biz, fromContactId: ID.contactD102NetLate, toContactId: referrer, type: 'referred_by' } });
    // ... and its reopen (the edge exists now) takes nothing back and logs nothing.
    await fullRefund(ID.invD102NetLate, late.id, 'v42c d102 late referral');
    await settle();
    expect(await score(), 'a bump that never ran is not taken back').toBe(35);
    expect(await notes(ID.invD102NetLate)).toEqual([]);

    // RED before: the score stayed bumped and the timeline ended on referral.deal_won.
    const reopen = await fullRefund(ID.invD102Network, p.id, 'v42c d102 network');
    await vi.waitFor(async () => expect(await score()).toBe(20), WAIT);
    await vi.waitFor(async () => expect((await notes(ID.invD102Network)).map((e) => e.data.kind)).toEqual(['referral.deal_won', 'referral.deal_reopened']), WAIT);
    const reopened = (await notes(ID.invD102Network))[1];
    expect(reopened).toMatchObject({ businessId: ID.biz, contactId: referrer, source: 'crm-network' });
    expect(reopened.data).toMatchObject({ kind: 'referral.deal_reopened', referredContactId: ID.contactD102NetReferred, invoiceId: ID.invD102Network });

    // A re-delivered reopen changes nothing.
    await crmNetwork.onInvoiceReopened(reopen);
    await settle();
    expect(await score()).toBe(20);
    expect((await notes(ID.invD102Network)).map((e) => e.data.kind)).toEqual(['referral.deal_won', 'referral.deal_reopened']);
    expect(sentEmails, 'the reopen messages no one').toHaveLength(0);
  }, 30_000);

  it('VR-05 census (W10-REOPEN-REVERSALS, D-102, was it.todo): ProjectRevenueListener.onInvoicePaid advances the invoice projects ACTIVE -> IN_PROGRESS; the reopen steps the ones it moved back to ACTIVE; a project already IN_PROGRESS before the payment, one the operator moved on since (COMPLETED) and another invoice\'s project are left; a re-delivered reopen moves nothing (not even a project the operator advanced again); paying again advances it again and the next reopen steps it back once more', async () => {
    const status = async (id: string) => (await db.project.findUnique({ where: { id } })).status;
    const p = await paid(ID.invD102Project, 100, 'V42C-D102-PRJ');
    await vi.waitFor(async () => {
      expect(await status(D102.prjAdvance)).toBe('IN_PROGRESS');
      expect(await status(D102.prjMoved)).toBe('IN_PROGRESS');
    }, WAIT);
    expect(await status(D102.prjAlready)).toBe('IN_PROGRESS');
    expect(await status(D102.prjOther)).toBe('ACTIVE');
    // The operator moves one of the advanced projects on.
    await db.project.update({ where: { id: D102.prjMoved }, data: { status: 'COMPLETED' } });

    // RED before: the reopen left the advanced project IN_PROGRESS.
    const reopen = await fullRefund(ID.invD102Project, p.id, 'v42c d102 project');
    await vi.waitFor(async () => expect(await status(D102.prjAdvance)).toBe('ACTIVE'), WAIT);
    await settle();
    expect(await status(D102.prjAlready), 'IN_PROGRESS before the payment: the paid move never ran for it').toBe('IN_PROGRESS');
    expect(await status(D102.prjMoved), 'moved on since the paid move: left').toBe('COMPLETED');
    expect(await status(D102.prjOther)).toBe('ACTIVE');

    // A re-delivered reopen moves nothing, not even a project the operator has advanced again.
    await db.project.update({ where: { id: D102.prjAdvance }, data: { status: 'IN_PROGRESS' } });
    await projectRevenue.onInvoiceReopened(reopen);
    await settle();
    expect(await status(D102.prjAdvance), 'the reopen was already reversed once').toBe('IN_PROGRESS');
    expect(await status(D102.prjAlready)).toBe('IN_PROGRESS');
    expect(await status(D102.prjMoved)).toBe('COMPLETED');

    // Paying again advances it again; the next reopen steps it back once more.
    await db.project.update({ where: { id: D102.prjAdvance }, data: { status: 'ACTIVE' } });
    const p2 = await paid(ID.invD102Project, 100, 'V42C-D102-PRJ-2');
    await vi.waitFor(async () => expect(await status(D102.prjAdvance)).toBe('IN_PROGRESS'), WAIT);
    await fullRefund(ID.invD102Project, p2.id, 'v42c d102 project again');
    await vi.waitFor(async () => expect(await status(D102.prjAdvance)).toBe('ACTIVE'), WAIT);
    await settle();
    expect(await status(D102.prjAlready)).toBe('IN_PROGRESS');
    expect(await status(D102.prjMoved)).toBe('COMPLETED');
    expect(sentEmails).toHaveLength(0);
  }, 30_000);

  it('VR-05 census (W10-REOPEN-REVERSALS, D-102, was it.todo): MarginOnPaymentListener.onInvoicePaid captures one margin snapshot per product line (snapshotReason invoice_paid); the reopen marks it reversed (snapshotReason invoice_paid_reversed) and keeps the row and its figures; a re-delivered reopen writes nothing more; paying again restores the same snapshot (no second row); a PARTIALLY_PAID product invoice refunded to SENT had no snapshot and gets none', async () => {
    const snaps = async (inv: string) => (await db.marginSnapshot.findMany({ where: { invoiceId: inv }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })) as any[];
    const reasons = async (inv: string) => (await snaps(inv)).map((s) => [s.id, s.snapshotReason]);

    const p = await paid(ID.invD102Margin, 100, 'V42C-D102-MARGIN');
    await vi.waitFor(async () => expect((await snaps(ID.invD102Margin)).map((s) => s.snapshotReason)).toEqual(['invoice_paid']), WAIT);
    const [snap] = await snaps(ID.invD102Margin);
    expect(snap).toMatchObject({ productId: D102.product, sellingPrice: TOTAL, quantity: 1 });

    // RED before: the snapshot stayed invoice_paid for the refunded sale.
    const reopen = await fullRefund(ID.invD102Margin, p.id, 'v42c d102 margin');
    await vi.waitFor(async () => expect(await reasons(ID.invD102Margin)).toEqual([[snap.id, 'invoice_paid_reversed']]), WAIT);
    const reversed = (await snaps(ID.invD102Margin))[0];
    const figures = (s: any) => ({ productId: s.productId, sourceCost: s.sourceCost, sellingPrice: s.sellingPrice, landedCostEstimate: s.landedCostEstimate, grossMargin: s.grossMargin, grossProfit: s.grossProfit, quantity: s.quantity, createdAt: s.createdAt });
    expect(figures(reversed), 'marked, never deleted or rewritten').toEqual(figures(snap));

    // A re-delivered reopen writes nothing more.
    await marginListener.onInvoiceReopened(reopen);
    await settle();
    expect(await reasons(ID.invD102Margin)).toEqual([[snap.id, 'invoice_paid_reversed']]);

    // Paying again restores the same snapshot.
    await paid(ID.invD102Margin, 100, 'V42C-D102-MARGIN-2');
    await vi.waitFor(async () => expect(await reasons(ID.invD102Margin)).toEqual([[snap.id, 'invoice_paid']]), WAIT);

    // Control: a PARTIALLY_PAID product invoice never captured a snapshot; its reopen to SENT writes none.
    const forty = await paid(ID.invD102MarginPart, 40, 'V42C-D102-MARGIN-P40');
    expect((await invoiceRow(ID.invD102MarginPart)).status).toBe('PARTIALLY_PAID');
    await fullRefund(ID.invD102MarginPart, forty.id, 'v42c d102 margin partial');
    await settle();
    expect(await snaps(ID.invD102MarginPart)).toEqual([]);
  }, 30_000);

  it('VR-05 census (W10-REOPEN-REVERSALS, D-102 keep, was it.todo): StorefrontInvoiceAttributionListener.handleInvoicePaid and JourneyListenerService.onInvoicePaid record the paid booking invoice\'s revenue attribution and its CONVERSION payment touchpoint; by D-102 attribution history stays: neither listens to invoice.reopened, and the full refund leaves both rows as they were and adds none', async () => {
    const { StorefrontInvoiceAttributionListener } = await import('../src/modules/commerce/storefront-invoice-attribution.listener');
    const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
    const { JourneyListenerService } = await import('../src/modules/growth-intelligence/journey-listener.service');
    const { CustomerJourneyService } = await import('../src/modules/growth-intelligence/customer-journey.service');
    const inv = ID.invD102KeepAttr;
    const attributions = async () => db.revenueAttribution.findMany({ where: { businessId: ID.biz, revenueId: inv }, orderBy: { id: 'asc' } });
    const touchpoints = async () =>
      db.journeyTouchpoint.findMany({ where: { businessId: ID.biz, metadata: { path: ['invoiceId'], equals: inv } }, orderBy: { id: 'asc' } });

    const attr = wireOnBus(new StorefrontInvoiceAttributionListener(prismaSvc, new RevenueAttributionService(prismaSvc)));
    const journey = wireOnBus(new JourneyListenerService(new CustomerJourneyService(prismaSvc)));
    try {
      expect(attr.events).toEqual(['invoice.paid']);
      expect(journey.events).toContain('invoice.paid');
      expect(journey.events, 'no reopen handler: the history is kept').not.toContain('invoice.reopened');

      const p = await paid(inv, 100, 'V42C-D102-KEEP-ATTR');
      await vi.waitFor(async () => expect(await attributions()).toHaveLength(1), WAIT);
      await vi.waitFor(async () => expect((await touchpoints()).map((t: any) => t.touchpointType)).toContain('payment'), WAIT);
      await settle();
      const attrRows = await attributions();
      const tpRows = await touchpoints();
      expect(attrRows[0]).toMatchObject({ revenueType: 'INVOICE', amount: TOTAL, source: 'storefront', sourceDetail: `booking:${D102.bookingAttr}`, contactId: ID.contact });
      expect(tpRows.find((t: any) => t.touchpointType === 'payment')).toMatchObject({ stageHint: 'CONVERSION', source: 'commerce', contactId: ID.contact });

      await fullRefund(inv, p.id, 'v42c d102 keep attribution');
      await waitForCalendar('invoice', inv, (cal) => expect(cal).toMatchObject({ status: 'SCHEDULED' }));
      await settle();
      expect(await attributions(), 'the revenue attribution stays as it was').toEqual(attrRows);
      expect(await touchpoints(), 'the CONVERSION touchpoint stays, none added').toEqual(tpRows);
      expect(wiredErrors).toEqual([]);
    } finally {
      attr.unwire();
      journey.unwire();
    }
  }, 30_000);

  it('VR-05 census (W10-REOPEN-REVERSALS, D-102 keep, was it.todo): GamificationListener.handleInvoicePaid sets the business metaData.firstSaleMade; by D-102 the first-sale flag stays: it has no invoice.reopened handler and a full refund of the sale that set it leaves it set', async () => {
    const { GamificationListener } = await import('../src/modules/gamification/gamification.listener');
    const inv = ID.invD102KeepGame;
    const flag = async () => ((await db.business.findUnique({ where: { id: ID.biz }, select: { metaData: true } })).metaData ?? {} as any).firstSaleMade;
    expect(await flag(), 'not set before this sale (the listener is wired for this case only)').toBeFalsy();

    const game = wireOnBus(new GamificationListener(prismaSvc));
    try {
      expect(game.events).toContain('invoice.paid');
      expect(game.events).not.toContain('invoice.reopened');
      const p = await paid(inv, 100, 'V42C-D102-KEEP-GAME');
      await vi.waitFor(async () => expect(await flag()).toBe(true), WAIT);

      await fullRefund(inv, p.id, 'v42c d102 keep first sale');
      await waitForCalendar('invoice', inv, (cal) => expect(cal).toMatchObject({ status: 'SCHEDULED' }));
      await settle();
      expect(await flag(), 'the first-sale flag stays').toBe(true);
      expect(wiredErrors).toEqual([]);
    } finally {
      game.unwire();
    }
  }, 30_000);
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
    // PR196-CRM-LIFECYCLE (D-81, review CR-1): the paid invoice asks CrmService, once, to move the
    // invoice row's own contact in the invoice's business.
    await vi.waitFor(() => expect(lifecycleMoves).toEqual([{ businessId: ID.biz, contactId, invoiceId: inv, invoiceNumber }]), WAIT);
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
  // W10-REOPEN-REVERSALS (owner ruling D-102): the last four census todos are cases (converted in place).
  it('VR-05 census (W10-REOPEN-REVERSALS, D-102, was it.todo): ReviewSolicitationService.onInvoicePaid schedules a PENDING review-request job to the customer; the reopen cancels it before it is sent (CANCELLED: the runner only takes PENDING jobs); a re-delivered reopen changes nothing; paying again re-arms it; a request the runner already sent (COMPLETED) is a message already sent and stays; nobody is messaged by the reopen', async () => {
    const job = async (inv: string) =>
      db.scheduledAgentJob.findFirst({ where: { businessId: ID.biz, entityId: inv, checkpoint: `review_invoice_${inv}` } });

    const p = await paid(ID.invD102Review, 100, 'V42C-D102-REVIEW');
    await vi.waitFor(async () => expect(await job(ID.invD102Review)).toMatchObject({ jobType: 'review_solicitation', status: 'PENDING' }), WAIT);
    const scheduled = await job(ID.invD102Review);
    expect(scheduled.payload).toMatchObject({ contactId: ID.contact, contactEmail: `${P}c@test.local`, entityType: 'invoice' });

    // RED before: the job stayed PENDING, so the refunded customer was asked for a review three days later.
    const reopen = await fullRefund(ID.invD102Review, p.id, 'v42c d102 review');
    await vi.waitFor(async () => expect(await job(ID.invD102Review)).toMatchObject({ id: scheduled.id, status: 'CANCELLED', executedAt: null }), WAIT);
    const cancelled = await job(ID.invD102Review);

    // A re-delivered reopen changes nothing.
    await reviewSolicitation.onInvoiceReopened(reopen);
    await settle();
    expect(await job(ID.invD102Review)).toMatchObject({ id: scheduled.id, status: 'CANCELLED', updatedAt: cancelled.updatedAt });

    // Paying again re-arms the same job.
    await paid(ID.invD102Review, 100, 'V42C-D102-REVIEW-2');
    await vi.waitFor(async () => expect(await job(ID.invD102Review)).toMatchObject({ id: scheduled.id, status: 'PENDING', executedAt: null }), WAIT);
    expect(new Date((await job(ID.invD102Review)).scheduledFor).getTime()).toBeGreaterThan(Date.now());

    // A request already sent stays: the runner claims a due job by writing COMPLETED before it sends (V1-35).
    const s = await paid(ID.invD102ReviewSent, 100, 'V42C-D102-REVIEW-SENT');
    await vi.waitFor(async () => expect(await job(ID.invD102ReviewSent)).toMatchObject({ status: 'PENDING' }), WAIT);
    const executedAt = new Date();
    await db.scheduledAgentJob.update({ where: { id: (await job(ID.invD102ReviewSent)).id }, data: { status: 'COMPLETED', executedAt } });
    await fullRefund(ID.invD102ReviewSent, s.id, 'v42c d102 review sent');
    await waitForCalendar('invoice', ID.invD102ReviewSent, (cal) => expect(cal).toMatchObject({ status: 'SCHEDULED' }));
    await settle();
    expect(await job(ID.invD102ReviewSent), 'a request already sent is the customer\'s message: left').toMatchObject({ status: 'COMPLETED', executedAt });
    expect(transactionalSends, 'the reopen sends nothing').toEqual([]);
    expect(sentEmails).toHaveLength(0);
  }, 30_000);

  it('VR-05 census (W10-REOPEN-REVERSALS, D-102 keep, was it.todo): FlowListener (confirms the linked booking, the "Invoice Paid" notification, the revenue milestone check, the payment_receipt to the customer), ActivityEventListener and AutomationExecutorService.onInvoicePaid (playbooks / flows on invoice.paid, the "Send thank-you note" task): by D-102 the booking confirmation and the notifications stay; none of them listens to invoice.reopened, and the full refund leaves the booking CONFIRMED, adds no notification, activity, task or customer email', async () => {
    const { FlowListener } = await import('../src/modules/flow/flow.listener');
    const { ActivityEventListener } = await import('../src/modules/flow/activity-event.listener');
    const { AutomationExecutorService } = await import('../src/modules/flow/automation-executor.service');
    const { BookingsService } = await import('../src/modules/bookings/bookings.service');
    const inv = ID.invD102KeepFlow;
    const activities: any[] = [];
    const tasks: any[] = [];
    const milestones: any[] = [];
    const activityStub = { log: async (a: any) => { activities.push(a); return null; } };
    const emailStub = { send: async (a: any) => { transactionalSends.push(a); return { sent: true }; } };
    // The real confirmation (BookingsService.confirmBookingForPaidInvoice) over the real booking row; its
    // contact-timeline write is the suite's recording CrmService stub; the rest of BookingsService is unused.
    const bookings = new BookingsService(prismaSvc, bus, { logContactEvent: async (e: any) => { timeline.push(e); return null; } } as any, commerceSvc, {} as any, {} as any, emailStub as any, {} as any, {} as any);
    const flow = new FlowListener(bookings, prismaSvc, { checkRevenueMilestoneOnPayment: async (...a: any[]) => { milestones.push(a); return null; } } as any, emailStub as any, commerceSvc);
    const activity = new ActivityEventListener(activityStub as any, prismaSvc);
    const automation = new AutomationExecutorService(prismaSvc, activityStub as any, { addTask: async (t: any) => { tasks.push(t); return null; } } as any, emailStub as any, null, null);
    const notifications = async () => db.notification.findMany({ where: { businessId: ID.biz, data: { path: ['invoiceId'], equals: inv } }, orderBy: { id: 'asc' } });
    const booking = async () => db.booking.findUnique({ where: { id: D102.bookingFlow } });

    const wired = [wireOnBus(flow), wireOnBus(activity), wireOnBus(automation)];
    try {
      for (const w of wired) {
        expect(w.events).toContain('invoice.paid');
        expect(w.events, 'no reopen handler').not.toContain('invoice.reopened');
      }
      expect((await booking()).status).toBe('PENDING');

      const p = await paid(inv, 100, 'V42C-D102-KEEP-FLOW');
      await vi.waitFor(async () => expect((await booking()).status).toBe('CONFIRMED'), WAIT);
      await vi.waitFor(async () => expect((await notifications()).map((n: any) => n.type)).toEqual(['invoice.paid']), WAIT);
      await vi.waitFor(() => {
        expect(transactionalSends.filter((s) => s.type === 'payment_receipt' && s.dedupeKey === `receipt_invoice_${inv}`)).toHaveLength(1);
        expect(activities.filter((a) => a.entityId === inv && a.action === 'paid')).toHaveLength(1);
        expect(tasks.map((t) => t.title)).toEqual(['Send thank-you note']);
        expect(milestones).toHaveLength(1);
      }, WAIT);
      await settle();
      const before = { notifications: await notifications(), sends: transactionalSends.length, activities: activities.length, tasks: tasks.length, milestones: milestones.length };

      await fullRefund(inv, p.id, 'v42c d102 keep flow');
      await waitForCalendar('invoice', inv, (cal) => expect(cal).toMatchObject({ status: 'SCHEDULED' }));
      await settle();
      expect((await booking()).status, 'the booking stays confirmed').toBe('CONFIRMED');
      expect(await notifications(), 'no notification added or removed').toEqual(before.notifications);
      expect({ sends: transactionalSends.length, activities: activities.length, tasks: tasks.length, milestones: milestones.length }, 'no email, activity, task or milestone check for the reopen').toEqual({
        sends: before.sends, activities: before.activities, tasks: before.tasks, milestones: before.milestones,
      });
      expect(sentEmails).toHaveLength(0);
      expect(wiredErrors).toEqual([]);
    } finally {
      for (const w of wired) w.unwire();
    }
  }, 30_000);

  it('VR-05 census (W10-REOPEN-REVERSALS, D-102 keep, was it.todo): InvoiceReceiptListener and WhatsAppNotificationsListener message the customer once on paid (the receipt email, the WhatsApp payment confirmation); by D-102 messages already sent stay and the reopen messages no one: neither listens to invoice.reopened and the full refund sends nothing', async () => {
    const { InvoiceReceiptListener } = await import('../src/modules/commerce/invoice-receipt.listener');
    const { WhatsAppNotificationsListener } = await import('../src/modules/whatsapp/whatsapp-notifications.listener');
    const inv = ID.invD102KeepMsg;
    const receipts: any[] = [];
    const whatsapps: any[] = [];
    const receipt = wireOnBus(new InvoiceReceiptListener(commerceSvc, { sendEmail: async (a: any) => { receipts.push(a); return { messageId: `${P}d102_receipt_${receipts.length}` }; } } as any));
    const whatsapp = wireOnBus(new WhatsAppNotificationsListener({ sendMessage: async (b: string, m: any) => { whatsapps.push({ businessId: b, ...m }); return { success: true }; } } as any));
    try {
      expect(receipt.events).toEqual(['invoice.paid']);
      expect(whatsapp.events).toContain('invoice.paid');
      expect(whatsapp.events).not.toContain('invoice.reopened');

      const p = await paid(inv, 100, 'V42C-D102-KEEP-MSG');
      await vi.waitFor(() => {
        expect(receipts.map((r) => r.to)).toEqual([`${P}d102msg@test.local`]);
        expect(whatsapps.map((w) => w.to)).toEqual(['+18685550142']);
      }, WAIT);
      await settle();

      await fullRefund(inv, p.id, 'v42c d102 keep messages');
      await waitForCalendar('invoice', inv, (cal) => expect(cal).toMatchObject({ status: 'SCHEDULED' }));
      await settle();
      expect(receipts, 'no receipt or refund email from the reopen').toHaveLength(1);
      expect(whatsapps, 'no WhatsApp message from the reopen').toHaveLength(1);
      expect(sentEmails).toHaveLength(0);
      expect(wiredErrors).toEqual([]);
    } finally {
      receipt.unwire();
      whatsapp.unwire();
    }
  }, 30_000);

  it('VR-05 census (W10-REOPEN-REVERSALS, D-102 keep, was it.todo): AiListener.onInvoicePaid invalidates the business graph and AgentTriggerService (onAny) runs the business\'s invoice.paid trigger (the default "Payment Received -> Thank You") once on paid; by D-102 no invoice.reopened trigger fires a message: no default trigger or journey template listens to invoice.reopened, AiListener has no reopen handler, and the full refund starts no plan; a trigger the business itself adds on invoice.reopened runs once per reopen', async () => {
    const { AiListener } = await import('../src/modules/ai/ai.listener');
    const { AgentTriggerService } = await import('../src/modules/ai/agent-trigger.service');
    const { DEFAULT_AGENT_TRIGGERS } = await import('../src/modules/ai/default-triggers.constants');
    const { getTemplatesForEvent } = await import('../src/modules/ai/journey-templates');
    const inv = ID.invD102KeepAi;
    expect(DEFAULT_AGENT_TRIGGERS.map((t: any) => t.eventPattern)).not.toContain('invoice.reopened');
    expect(getTemplatesForEvent('invoice.reopened')).toEqual([]);
    const paidDefault = DEFAULT_AGENT_TRIGGERS.find((t: any) => t.eventPattern === 'invoice.paid')!;
    await db.agentTrigger.create({ data: { id: D102.trigPaid, businessId: ID.biz, name: paidDefault.name, eventPattern: 'invoice.paid', objective: paidDefault.objective, enabled: true } });

    const invalidated: string[] = [];
    const plans: any[] = [];
    const journeyEvents: string[] = [];
    const ai = wireOnBus(new AiListener({ invalidateCache: (b: string) => { invalidated.push(b); } } as any, bus));
    // AgentTriggerService subscribes with onAny in onModuleInit: the real onModuleInit runs against a bus
    // facade that hands its listener over, and that listener goes on the real bus for this case only.
    let onAnyListener: ((name: string, payload: any) => void) | undefined;
    const triggers = new AgentTriggerService(
      prismaSvc,
      { onAny: (l: any) => { onAnyListener = l; }, emit: (...a: any[]) => bus.emit(...a) } as any,
      { evaluateAutoApproval: async () => ({ autoApproved: false }) } as any,
      { createPlan: async (_b: string, input: any) => { plans.push(input); return null; } } as any,
      {} as any,
      { log: async () => null } as any,
      { handleEvent: async (name: string) => { journeyEvents.push(name); return []; } } as any,
    );
    triggers.onModuleInit();
    expect(onAnyListener).toBeDefined();
    bus.onAny(onAnyListener);
    const forInvoice = (input: any) => String(input?.rawInput ?? '');
    try {
      expect(ai.events).toContain('invoice.paid');
      expect(ai.events, 'AiListener has no reopen handler').not.toContain('invoice.reopened');

      const p = await paid(inv, 100, 'V42C-D102-KEEP-AI');
      await vi.waitFor(() => expect(plans.map((x) => x.objective)).toEqual([paidDefault.objective]), WAIT);
      expect(forInvoice(plans[0])).toContain('invoice.paid');
      expect(invalidated).toContain(ID.biz);
      await settle();
      const before = { plans: plans.length, invalidated: invalidated.length };

      journeyEvents.length = 0;
      const reopen = await fullRefund(inv, p.id, 'v42c d102 keep ai');
      await vi.waitFor(() => expect(journeyEvents).toContain('invoice.reopened'), WAIT);
      await settle();
      expect(plans.length, 'no plan (no message) for the reopen').toBe(before.plans);
      expect(invalidated.length, 'AiListener does not act on the reopen').toBe(before.invalidated);

      expect(reopen).toMatchObject({ businessId: ID.biz, previousStatus: 'PAID' });

      // A trigger the business itself adds on invoice.reopened runs once per reopen (one event, SEC-V42C-1).
      await db.agentTrigger.create({ data: { id: D102.trigReopened, businessId: ID.biz, name: 'V42C D102 own reopen rule', eventPattern: 'invoice.reopened', objective: 'v42c d102 owner rule', enabled: true } });
      const p2 = await paid(inv, 100, 'V42C-D102-KEEP-AI-2');
      await vi.waitFor(() => expect(plans.map((x) => x.objective)).toEqual([paidDefault.objective, paidDefault.objective]), WAIT);
      await fullRefund(inv, p2.id, 'v42c d102 keep ai again');
      await vi.waitFor(() => expect(plans.map((x) => x.objective)).toEqual([paidDefault.objective, paidDefault.objective, 'v42c d102 owner rule']), WAIT);
      await settle();
      expect(plans.filter((x) => x.objective === 'v42c d102 owner rule'), 'once per reopen').toHaveLength(1);
      expect(wiredErrors).toEqual([]);
    } finally {
      ai.unwire();
      bus.offAny(onAnyListener);
      await db.agentTrigger.deleteMany({ where: { id: { in: [D102.trigPaid, D102.trigReopened] } } });
    }
  }, 30_000);
});

/**
 * FOLLOW3-A9 review repairs. SEC-A9-1: the refund's reopen handler and the paid handler that raised the
 * Send receipt action race (the paid handler awaits an AI draft between its PAID read and its write), so
 * the paid handler checks the status again before and after its write, the reopen handler checks it
 * again after its delete, and the 5-minute sweep removes an open Send receipt action of a reopened
 * invoice. SEC-A9-2 / CR-A9-1: the CRM timeline dedupes invoice.paid / invoice.reopened per transition,
 * so pay -> refund -> pay inside the 10-minute window logs every move.
 */
describe('FOLLOW3-A9 review: the Send receipt action and the contact timeline follow every transition', () => {
  const actionCreated = (inv: string) =>
    emitted.filter((e) => e.name === 'revenue_action.created' && e.payload?.type === 'PAID_INVOICE_NO_RECEIPT' && e.payload?.relatedId === inv);

  it('A9-R1 (SEC-A9-1, RED before): the paid handler is still drafting (slow AI) when the refund reopens the invoice and the reopen handler finds no row -> no Send receipt action is raised for the SENT invoice', async () => {
    const inv = ID.invA9RaceDraft;
    const ai = (revenueActions as any).aiUsage;
    const realTrack = ai.trackAndComplete;
    // The paid handler's draft (the AI call) is held until the refund's reopen listeners have run.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let drafting = false;
    ai.trackAndComplete = async () => {
      drafting = true;
      await gate;
      throw new Error('v42c: slow AI, then the template');
    };
    try {
      const original = await paid(inv, 100, 'V42C-A9-R1');
      await vi.waitFor(() => expect(drafting, 'the paid handler is drafting').toBe(true), WAIT);
      const res = await refund(original.id, 'mistaken payment');
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(await invoiceRow(inv)).toMatchObject({ status: 'SENT', paidAt: null });
      expect(eventsFor(inv)).toEqual(['invoice.paid', 'invoice.reopened']);
      // The reopen's listeners ran (the calendar is back to SCHEDULED); the revenue-action one found no row.
      await waitForCalendar('invoice', inv, (cal) => expect(cal).toMatchObject({ status: 'SCHEDULED' }));
      await settle(300);
      expect(await receiptAction(inv)).toBeNull();
      // Now the paid handler's draft ends and it goes on to raise the action.
      release();
      await settle(1_000);
      expect(await receiptAction(inv), 'a reopened invoice gets no Send receipt action').toBeNull();
      expect(actionCreated(inv), 'none is raised, not even for a moment').toEqual([]);
    } finally {
      release();
      ai.trackAndComplete = realTrack;
    }
  }, 20_000);

  it('A9-R2 (SEC-A9-1, RED before): the refund reopens the invoice after the paid handler\'s last status check and before its write -> the row it writes is removed by its own check after the write', async () => {
    const inv = ID.invA9RaceWrite;
    const svc = revenueActions as any;
    const proto = Object.getPrototypeOf(svc);
    const calendar = calendarListener as any;
    const inner: string[] = [];
    let reopenedInside = false;
    // W4-FLAKE-HARDEN: each staged step is awaited on its real completion, not on a timed wait
    // (under load the staged refund committed after the 4 s WAIT below had expired). Each deferred
    // resolves with the run of a real handler for this invoice: the paid handler
    // (generateForPaidInvoiceMissingReceipt: draft, check, write, check after the write), and the
    // revenue-action and calendar handlers of the refund's invoice.reopened.
    const deferred = () => {
      let resolve!: (run: Promise<unknown>) => void;
      const promise = new Promise<Promise<unknown>>((r) => { resolve = r; });
      return { promise, resolve };
    };
    const paidHandled = deferred();
    const reopenHandled = deferred();
    const calendarReopened = deferred();
    const isReopenOf = (payload: any) => payload?.eventName === 'invoice.reopened' && payload?.invoice?.id === inv;
    svc.generateForPaidInvoiceMissingReceipt = (businessId: string, invoiceId: string) => {
      const run = proto.generateForPaidInvoiceMissingReceipt.call(svc, businessId, invoiceId);
      if (invoiceId === inv) paidHandled.resolve(run);
      return run;
    };
    svc.onInvoiceReopened = (payload: any) => {
      const run = proto.onInvoiceReopened.call(svc, payload);
      if (isReopenOf(payload)) reopenHandled.resolve(run);
      return run;
    };
    calendar.onInvoiceChanged = (payload: any) => {
      const run = Object.getPrototypeOf(calendar).onInvoiceChanged.call(calendar, payload);
      if (isReopenOf(payload)) calendarReopened.resolve(run);
      return run;
    };
    svc.upsertAction = async (input: any) => {
      if (input?.type === 'PAID_INVOICE_NO_RECEIPT' && input?.relatedId === inv && !reopenedInside) {
        reopenedInside = true;
        try {
          // The full refund commits and its reopen handler runs (no row to remove yet) before this write.
          const payment = await db.payment.findFirst({ where: { invoiceId: inv, amount: { gt: 0 } } });
          const res = await refund(payment.id, 'mistaken payment');
          if (res.status !== 201) {
            inner.push(`refund ${res.status} ${JSON.stringify(res.body)}`);
          } else {
            // W4-FLAKE-HARDEN: the reopen's listeners have finished (was: a 4 s calendar wait, then 300 ms).
            await (await reopenHandled.promise);
            await (await calendarReopened.promise);
          }
          await waitForCalendar('invoice', inv, (cal) => expect(cal).toMatchObject({ status: 'SCHEDULED' }));
        } catch (e) {
          inner.push(String(e));
        }
      }
      return proto.upsertAction.call(svc, input);
    };
    try {
      await paid(inv, 100, 'V42C-A9-R2');
      // W4-FLAKE-HARDEN: the paid handler's whole run, with the staged refund inside its write.
      await (await paidHandled.promise);
      expect(inner, 'the staged refund inside the paid handler\'s write').toEqual([]);
      await vi.waitFor(() => expect(reopenedInside).toBe(true), WAIT);
      await vi.waitFor(async () => expect(await invoiceRow(inv)).toMatchObject({ status: 'SENT', paidAt: null }), WAIT);
      // The write happened (revenue_action.created) and its own check removed it.
      await vi.waitFor(() => expect(actionCreated(inv)).toHaveLength(1), WAIT);
      await vi.waitFor(async () => expect(await receiptAction(inv), 'the row written for the reopened invoice is removed').toBeNull(), WAIT);
      await settle();
      expect(await receiptAction(inv)).toBeNull();
      expect(inner).toEqual([]);
    } finally {
      delete svc.upsertAction;
      delete svc.onInvoiceReopened;
      delete svc.generateForPaidInvoiceMissingReceipt;
      delete calendar.onInvoiceChanged;
    }
  }, 30_000);

  it('A9-R3 (SEC-A9-1 reverse window, RED before): a re-pay commits between the reopen handler\'s status read and its delete (its paid handler refreshes the row the delete then removes) -> the PAID invoice gets its Send receipt action back', async () => {
    const inv = ID.invA9RaceRepay;
    const original = await paid(inv, 100, 'V42C-A9-R3');
    await vi.waitFor(async () => expect(await receiptAction(inv)).toMatchObject({ status: 'PENDING' }), WAIT);
    await settle();
    const svc = revenueActions as any;
    const inner: string[] = [];
    let repaidInside = false;
    let deletedAfterRepay = false;
    svc.removeOpenReceiptActions = async (businessId: string, ids: string[]) => {
      if (!repaidInside && ids.includes(inv)) {
        repaidInside = true;
        try {
          const res = await pay(inv, { amount: 100, method: 'cash', reference: 'V42C-A9-R3-AGAIN' });
          if (res.status !== 201) inner.push(`re-pay ${res.status} ${JSON.stringify(res.body)}`);
          await vi.waitFor(() => expect(emitted.filter((e) => e.name === 'invoice.paid' && e.payload?.invoice?.id === inv)).toHaveLength(1), WAIT);
          // The re-pay's paid handler refreshes the existing row.
          await settle();
        } catch (e) {
          inner.push(String(e));
        }
      }
      const removed = await Object.getPrototypeOf(svc).removeOpenReceiptActions.call(svc, businessId, ids);
      if (repaidInside && ids.includes(inv)) deletedAfterRepay = true;
      return removed;
    };
    try {
      emitted.length = 0;
      const res = await refund(original.id, 'mistaken payment');
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(eventsFor(inv)).toContain('invoice.reopened');
      // The reopen handler's delete ran after the re-pay refreshed the row (it removed that row).
      await vi.waitFor(() => expect(deletedAfterRepay).toBe(true), WAIT);
      await vi.waitFor(async () => expect(await invoiceRow(inv)).toMatchObject({ status: 'PAID' }), WAIT);
      await vi.waitFor(async () => expect(await receiptAction(inv), 'the PAID invoice has its Send receipt action').toMatchObject({ status: 'PENDING', relatedId: inv }), WAIT);
      await settle();
      expect((await invoiceRow(inv)).status).toBe('PAID');
      expect(await receiptAction(inv)).toMatchObject({ status: 'PENDING', relatedId: inv });
      expect(inner).toEqual([]);
      await expectLedgerBalanced(inv);
    } finally {
      delete svc.removeOpenReceiptActions;
    }
  }, 20_000);

  it('A9-R4 (SEC-A9-1, RED before): the 5-minute sweep (reconcileBusiness) removes an open Send receipt action of a SENT or OVERDUE invoice of the business; PAID, PARTIALLY_PAID and COMPLETED rows and a row naming another business\'s invoice are left', async () => {
    const S = {
      sent: `${P}bSweepSent`,
      overdue: `${P}bSweepOverdue`,
      paid: `${P}bSweepPaid`,
      part: `${P}bSweepPart`,
      done: `${P}bSweepDone`,
    };
    let n = 0;
    const invoice = async (id: string, status: string, extra: Record<string, unknown> = {}) => {
      n += 1;
      await db.invoice.create({
        data: {
          id, invoiceNumber: `V42C-BS-${n}`, status, sentAt: PAST_DUE, dueDate: PAST_DUE, subtotal: TOTAL, total: TOTAL,
          currency: 'TTD', businessId: B.biz, contactId: B.contact, ...extra,
        },
      });
    };
    await invoice(S.sent, 'SENT');
    await invoice(S.overdue, 'OVERDUE');
    await invoice(S.paid, 'PAID', { paidAt: new Date() });
    await invoice(S.part, 'PARTIALLY_PAID');
    await invoice(S.done, 'SENT');
    const action = (id: string, relatedId: string, status: string, extra: Record<string, unknown> = {}) =>
      db.revenueAction.create({
        data: { id, businessId: B.biz, type: 'PAID_INVOICE_NO_RECEIPT', title: `V42C sweep ${id}`, priority: 3, status, relatedType: 'invoice', relatedId, ...extra },
      });
    await action(`${P}ra_sweep_sent`, S.sent, 'PENDING');
    await action(`${P}ra_sweep_overdue`, S.overdue, 'SNOOZED', { snoozedUntil: new Date(Date.now() + 86_400_000) });
    await action(`${P}ra_sweep_paid`, S.paid, 'PENDING');
    await action(`${P}ra_sweep_part`, S.part, 'PENDING');
    await action(`${P}ra_sweep_done`, S.done, 'COMPLETED', { completedAt: new Date() });
    // Business B's row naming business A's SENT invoice: B's sweep never reads A's invoice, so it is left.
    expect((await invoiceRow(ID.invRemindStatus)).status).toBe('SENT');
    await action(`${P}ra_sweep_cross`, ID.invRemindStatus, 'PENDING');
    const aRowsBefore = await db.revenueAction.count({ where: { businessId: ID.biz } });

    await revenueActions.reconcileBusiness(B.biz);

    expect(await receiptAction(S.sent, B.biz), 'SENT: removed').toBeNull();
    expect(await receiptAction(S.overdue, B.biz), 'OVERDUE (SNOOZED row): removed').toBeNull();
    expect(await receiptAction(S.paid, B.biz), 'PAID: left').toMatchObject({ id: `${P}ra_sweep_paid`, status: 'PENDING' });
    expect(await receiptAction(S.part, B.biz), 'PARTIALLY_PAID: left (as the event path leaves a partial refund)').toMatchObject({ id: `${P}ra_sweep_part`, status: 'PENDING' });
    expect(await receiptAction(S.done, B.biz), 'COMPLETED: the operator\'s record').toMatchObject({ id: `${P}ra_sweep_done`, status: 'COMPLETED' });
    expect(await receiptAction(ID.invRemindStatus, B.biz), 'a row naming another business\'s invoice').toMatchObject({ id: `${P}ra_sweep_cross`, status: 'PENDING' });
    expect(await db.revenueAction.count({ where: { businessId: ID.biz } }), 'business A is untouched by B\'s sweep').toBe(aRowsBefore);
  }, 20_000);

  it('A9-R5 (SEC-A9-2 / CR-A9-1, RED before): pay, full refund, pay again, full refund again inside the 10-minute dedupe window -> the timeline is [paid, reopened, paid, reopened], each ending on the invoice\'s status at the time; a re-delivery of the same paid or reopen event writes nothing', async () => {
    const inv = ID.invA9Repay;
    const types = async () => (await contactTimeline(inv)).map((e) => e.type);
    const p1 = await paid(inv, 100, 'V42C-A9-R5-1');
    await vi.waitFor(async () => expect(await types()).toEqual(['invoice.paid']), WAIT);
    expect((await refund(p1.id, 'first refund')).status).toBe(201);
    await vi.waitFor(async () => expect(await types()).toEqual(['invoice.paid', 'invoice.reopened']), WAIT);

    emitted.length = 0;
    const p2 = await paid(inv, 100, 'V42C-A9-R5-2');
    expect((await invoiceRow(inv)).status).toBe('PAID');
    // RED before: the second invoice.paid was dropped as a duplicate of the first; the timeline ended on reopened.
    await vi.waitFor(async () => expect(await types()).toEqual(['invoice.paid', 'invoice.reopened', 'invoice.paid']), WAIT);
    const paidEvent = emitted.find((e) => e.name === 'invoice.paid' && e.payload?.invoice?.id === inv)!;
    await revenueEvents.onInvoicePaid(paidEvent.payload);
    expect(await types(), 'a re-delivered paid event is still a duplicate').toEqual(['invoice.paid', 'invoice.reopened', 'invoice.paid']);

    emitted.length = 0;
    expect((await refund(p2.id, 'second refund')).status).toBe(201);
    expect(await invoiceRow(inv)).toMatchObject({ status: 'SENT', paidAt: null });
    // RED before: the second reopen was dropped as a duplicate of the first.
    await vi.waitFor(async () => expect(await types()).toEqual(['invoice.paid', 'invoice.reopened', 'invoice.paid', 'invoice.reopened']), WAIT);
    const reopenEvent = emitted.find((e) => e.name === 'invoice.reopened' && e.payload?.invoice?.id === inv)!;
    await revenueEvents.onInvoiceReopened(reopenEvent.payload);
    await settle();

    const rows = await contactTimeline(inv);
    expect(rows.map((e) => e.type), 'a re-delivered reopen event is still a duplicate').toEqual(['invoice.paid', 'invoice.reopened', 'invoice.paid', 'invoice.reopened']);
    expect(new Set(rows.filter((r) => r.type === 'invoice.paid').map((r) => r.data.paidAt)).size, 'each paid entry names its own settlement').toBe(2);
    expect(new Set(rows.filter((r) => r.type === 'invoice.reopened').map((r) => r.data.reopenedAt)).size, 'each reopen entry names its own reopen').toBe(2);
    for (const r of rows) expect(r.data.dedupeKey).toBe(`rev:${r.type}:${inv}`);
    await expectLedgerBalanced(inv);
  }, 20_000);
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

/**
 * W10-REOPEN-REVERSALS review repairs (owner ruling D-102), each RED before the repair:
 *   SEC-W10RR-1  the referral award and its reversal write the referrer under its row lock (they were
 *                read-modify-writes of the whole custom object): eight invoices of eight contacts the
 *                same referrer referred, paid, then reopened, with their handlers run together, earn
 *                80 / 8 and give all of it back (0 / 0); every referred contact loses its mark
 *   SEC-W10RR-2  a cancelled review request re-armed by a new payment is addressed to the contact who
 *                paid now (the invoice moved to another contact while SENT, or the contact's email
 *                changed), not the refunded recipient the first payment stored
 *   SEC-W10RR-3  the lead-score ledger is the crm-network's own referral notes (source crm-network, no
 *                USER actor): notes of the same kind a crm:write member logs through POST
 *                .../contacts/:contactId/events neither stop a payment's bump, nor shield it from the
 *                reversal, nor take 15 from a bystander
 *   CR-REOPEN-1  each of the five paid handlers reads PAID before its write and again after it, and
 *                undoes its own write when the invoice was reopened meanwhile (the SEC-A9-1 pattern of
 *                RevenueActionService): a paid handler that finishes after the reopen handler leaves no
 *                referral credit, lead-score bump, project advance, invoice_paid margin snapshot or
 *                PENDING review request on the SENT invoice; a stale invoice.paid delivered after the
 *                reopen writes nothing
 *   CR-REOPEN-2  the reopen takes back the bump the payment applied (recorded on its referral.deal_won
 *                note), not a fixed 15: a referrer at 95 is bumped to 100 (the cap) and goes back to 95
 */
describe('W10-REOPEN-REVERSALS review repairs (owner ruling D-102)', () => {
  let rrSeq = 0;

  async function rrContact(id: string, extra: Record<string, unknown> = {}) {
    return db.contact.create({
      data: { id, businessId: ID.biz, firstName: 'V42c', lastName: id.slice(P.length), email: `${P}${id.slice(P.length).toLowerCase()}@test.local`, ...extra },
    });
  }

  async function rrInvoice(id: string, contactId: string, productId: string | null = null) {
    rrSeq += 1;
    return db.invoice.create({
      data: {
        id,
        invoiceNumber: `V42C-RR-${String(rrSeq).padStart(3, '0')}`,
        status: 'SENT',
        sentAt: new Date(PAST_DUE.getTime() - 14 * 24 * 60 * 60 * 1000),
        dueDate: PAST_DUE,
        subtotal: TOTAL,
        total: TOTAL,
        currency: 'TTD',
        businessId: ID.biz,
        contactId,
        items: { create: [{ id: `${id}_item1`, description: `V42C RR item ${rrSeq}`, quantity: 1, unitPrice: TOTAL, total: TOTAL, productId }] },
      },
    });
  }

  const customOf = async (id: string) => ((await db.contact.findUnique({ where: { id } })).custom ?? {}) as Record<string, any>;
  const creditOf = async (id: string) => {
    const c = await customOf(id);
    return { balance: c.referralRewardBalance ?? 0, earned: c.referralRewardsEarned ?? 0 };
  };
  const scoreOf = async (id: string) => (await db.contact.findUnique({ where: { id }, select: { leadScore: true } })).leadScore;
  /** The crm-network's own referral notes on a contact for an invoice (the ledger), oldest first. */
  const networkNotes = async (contactId: string, inv: string) =>
    (await db.contactEvent.findMany({
      where: { businessId: ID.biz, contactId, type: 'note.created', source: 'crm-network', data: { path: ['invoiceId'], equals: inv } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })) as any[];
  const reviewJob = async (inv: string) =>
    db.scheduledAgentJob.findFirst({ where: { businessId: ID.biz, entityId: inv, checkpoint: `review_invoice_${inv}` } });

  /** A gate: everything awaiting `opened` waits until open() is called. */
  function gate() {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => { open = resolve; });
    return { opened, open };
  }

  it('SEC-W10RR-1 (D-102, RED before): eight invoices of eight contacts the same referrer referred are paid, their award handlers run together, then each is fully refunded and the reversals run together -> the referrer earns 80 / 8 and gives all of it back, 0 / 0 (the award and the reversal write it under its row lock); every referred contact loses its mark and keeps its referral', async () => {
    const N = 8;
    const referrer = `${P}rrRefReferrer`;
    await rrContact(referrer, { custom: {} });
    const referred = Array.from({ length: N }, (_, i) => `${P}rrRef${i}`);
    const invoices = Array.from({ length: N }, (_, i) => `${P}invRrRef${i}`);
    for (let i = 0; i < N; i += 1) {
      await rrContact(referred[i], { custom: { referralSourceId: referrer } });
      await rrInvoice(invoices[i], referred[i]);
    }
    const svc = referralRewards as any;
    const proto = Object.getPrototypeOf(svc);
    const paidGate = gate();
    const reopenGate = gate();
    const paidRuns: Promise<unknown>[] = [];
    const reopenRuns: Promise<unknown>[] = [];
    // Each handler delivery for these invoices is held until all N have arrived, then all run at once.
    svc.onInvoicePaid = (payload: any) => {
      if (!invoices.includes(payload?.invoice?.id)) return proto.onInvoicePaid.call(svc, payload);
      const run = paidGate.opened.then(() => proto.onInvoicePaid.call(svc, payload));
      paidRuns.push(run);
      return run;
    };
    svc.onInvoiceReopened = (payload: any) => {
      if (!invoices.includes(payload?.invoice?.id)) return proto.onInvoiceReopened.call(svc, payload);
      const run = reopenGate.opened.then(() => proto.onInvoiceReopened.call(svc, payload));
      reopenRuns.push(run);
      return run;
    };
    try {
      const payments: any[] = [];
      for (let i = 0; i < N; i += 1) payments.push(await paid(invoices[i], 100, `V42C-RR-REF-${i}`));
      await vi.waitFor(() => expect(paidRuns).toHaveLength(N), WAIT);
      paidGate.open();
      await Promise.all(paidRuns);
      expect(await creditOf(referrer), 'every award is credited').toEqual({ balance: 10 * N, earned: N });
      for (const id of referred) expect(await customOf(id)).toMatchObject({ referralRewardEarned: true });

      for (let i = 0; i < N; i += 1) await fullRefund(invoices[i], payments[i].id, `v42c rr referral ${i}`);
      await vi.waitFor(() => expect(reopenRuns).toHaveLength(N), WAIT);
      reopenGate.open();
      await Promise.all(reopenRuns);
      // RED before: each reversal read the referrer, then wrote its balance less 10 over the others' writes (40 / 4, 60 / 6).
      expect(await creditOf(referrer), 'every credit is taken back').toEqual({ balance: 0, earned: 0 });
      for (const id of referred) {
        const c = await customOf(id);
        expect(c.referralRewardEarned ?? false, `${id} may earn it again`).toBe(false);
        expect(c.referralRewardInvoiceId, `${id}: no award left to reverse`).toBeUndefined();
        expect(c.referralSourceId, 'the referral itself stays').toBe(referrer);
      }
      await settle();
      expect(await creditOf(referrer)).toEqual({ balance: 0, earned: 0 });
    } finally {
      paidGate.open();
      reopenGate.open();
      delete svc.onInvoicePaid;
      delete svc.onInvoiceReopened;
    }
  }, 60_000);

  it('SEC-W10RR-2 (D-102, RED before): a refunded invoice moved to another contact while SENT (updateInvoice refuses only PAID / PARTIALLY_PAID) and paid again re-arms its review request addressed to the contact who paid now; a contact whose email changed is asked at the new address; the runner sends to them and never to the refunded recipient', async () => {
    const oldC = `${P}rrRvOld`;
    const newC = `${P}rrRvNew`;
    const inv = `${P}invRrReview`;
    const oldEmail = `${oldC.toLowerCase()}@test.local`;
    const newEmail = `${newC.toLowerCase()}@test.local`;
    const movedEmail = `${P}rrrvnew_moved@test.local`;
    await rrContact(oldC);
    await rrContact(newC);
    await rrInvoice(inv, oldC);

    const p1 = await paid(inv, 100, 'V42C-RR-RV-1');
    await vi.waitFor(async () => expect(await reviewJob(inv)).toMatchObject({ status: 'PENDING' }), WAIT);
    const first = await reviewJob(inv);
    expect(first.payload).toMatchObject({ contactId: oldC, contactEmail: oldEmail });
    await fullRefund(inv, p1.id, 'v42c rr review old');
    await vi.waitFor(async () => expect(await reviewJob(inv)).toMatchObject({ id: first.id, status: 'CANCELLED' }), WAIT);

    // The SENT invoice is moved to another contact, and that contact pays it.
    await db.invoice.update({ where: { id: inv }, data: { contactId: newC } });
    const p2 = await paid(inv, 100, 'V42C-RR-RV-2');
    await vi.waitFor(async () => expect(await reviewJob(inv)).toMatchObject({ id: first.id, status: 'PENDING' }), WAIT);
    // RED before: the re-armed job kept the first payment's payload (the refunded contact's address).
    expect((await reviewJob(inv)).payload).toMatchObject({
      contactId: newC,
      contactEmail: newEmail,
      contactName: `V42c ${newC.slice(P.length)}`,
      entityType: 'invoice',
    });

    // The paying contact's email changes before the next refund and payment: the re-arm reads it again.
    await fullRefund(inv, p2.id, 'v42c rr review new');
    await vi.waitFor(async () => expect(await reviewJob(inv)).toMatchObject({ status: 'CANCELLED' }), WAIT);
    await db.contact.update({ where: { id: newC }, data: { email: movedEmail } });
    await paid(inv, 100, 'V42C-RR-RV-3');
    await vi.waitFor(async () => expect(await reviewJob(inv)).toMatchObject({ status: 'PENDING' }), WAIT);
    expect((await reviewJob(inv)).payload).toMatchObject({ contactId: newC, contactEmail: movedEmail });

    // The runner sends the request, once due, to the contact who paid, at their address now.
    await db.scheduledAgentJob.update({ where: { id: first.id }, data: { scheduledFor: new Date(Date.now() - 60_000) } });
    await reviewSolicitation.processPendingJobs();
    const sent = transactionalSends.filter((s) => s.type === 'review_request' && [oldEmail, newEmail, movedEmail].includes(String(s.recipientEmail)));
    expect(sent.map((s) => s.recipientEmail)).toEqual([movedEmail]);
    expect(await reviewJob(inv)).toMatchObject({ status: 'COMPLETED' });
  }, 40_000);

  it('SEC-W10RR-3 (D-102, RED before): the lead-score reversal reads only the crm-network\'s own referral notes (source crm-network, no USER actor): a referral.deal_won note a crm:write member logs on the referrer before the payment does not stop its bump; a referral.deal_reopened note logged on the referrer does not shield the bump from the refund; a referral.deal_won note logged on a bystander takes nothing from them', async () => {
    const referrer = `${P}rrNetReferrer`;
    const referredC = `${P}rrNetReferred`;
    const victim = `${P}rrNetVictim`;
    const inv = `${P}invRrNet`;
    await rrContact(referrer, { leadScore: 20 });
    await rrContact(referredC);
    await rrContact(victim, { leadScore: 50 });
    await db.contactRelationship.create({ data: { businessId: ID.biz, fromContactId: referredC, toContactId: referrer, type: 'referred_by' } });
    await rrInvoice(inv, referredC);
    const timelineSvc = (crmNetwork as any).timeline;
    // What POST crm/businesses/:businessId/contacts/:contactId/events writes (crm.controller createEvent).
    const memberNote = (contactId: string, kind: string) =>
      timelineSvc.logContactEvent({
        businessId: ID.biz,
        contactId,
        type: 'note.created',
        data: { description: 'v42c member note', kind, invoiceId: inv, referredContactId: referredC },
        actorType: 'USER',
        actorId: ID.owner,
        source: 'crm',
      });

    await memberNote(referrer, 'referral.deal_won');
    const p = await paid(inv, 100, 'V42C-RR-NET');
    await vi.waitFor(async () => expect(await scoreOf(referrer), 'the member note does not stop the payment\'s bump').toBe(35), WAIT);
    await vi.waitFor(async () => expect((await networkNotes(referrer, inv)).map((e) => e.data.kind)).toEqual(['referral.deal_won']), WAIT);

    await memberNote(referrer, 'referral.deal_reopened');
    await memberNote(victim, 'referral.deal_won');
    await fullRefund(inv, p.id, 'v42c rr network');
    // RED before: { referrer: 35, victim: 35 } (the member notes shielded the bump and moved the bystander).
    await vi.waitFor(async () => expect((await networkNotes(referrer, inv)).map((e) => e.data.kind)).toEqual(['referral.deal_won', 'referral.deal_reopened']), WAIT);
    await settle();
    expect({ referrer: await scoreOf(referrer), victim: await scoreOf(victim) }).toEqual({ referrer: 20, victim: 50 });
    expect(await networkNotes(victim, inv), 'the bystander gets no system note').toEqual([]);
  }, 30_000);

  it('CR-REOPEN-2 (D-102, RED before): the reopen takes back the bump the payment applied, recorded on its referral.deal_won note: a referrer at 95 is bumped to 100 (the cap) and goes back to 95, not 85; paying again bumps it again and the next reopen takes that back', async () => {
    const referrer = `${P}rrCapReferrer`;
    const referredC = `${P}rrCapReferred`;
    const inv = `${P}invRrCap`;
    await rrContact(referrer, { leadScore: 95 });
    await rrContact(referredC);
    await db.contactRelationship.create({ data: { businessId: ID.biz, fromContactId: referredC, toContactId: referrer, type: 'referred_by' } });
    await rrInvoice(inv, referredC);

    const p = await paid(inv, 100, 'V42C-RR-CAP');
    await vi.waitFor(async () => expect(await scoreOf(referrer)).toBe(100), WAIT);
    await vi.waitFor(async () => expect((await networkNotes(referrer, inv)).map((e) => [e.data.kind, e.data.bump])).toEqual([['referral.deal_won', 5]]), WAIT);
    await fullRefund(inv, p.id, 'v42c rr cap');
    // RED before: 85 (a fixed 15 taken back).
    await vi.waitFor(async () => expect((await networkNotes(referrer, inv)).map((e) => e.data.kind)).toEqual(['referral.deal_won', 'referral.deal_reopened']), WAIT);
    expect(await scoreOf(referrer)).toBe(95);

    await db.contact.update({ where: { id: referrer }, data: { leadScore: 30 } });
    const p2 = await paid(inv, 100, 'V42C-RR-CAP-2');
    await vi.waitFor(async () => expect(await scoreOf(referrer)).toBe(45), WAIT);
    await fullRefund(inv, p2.id, 'v42c rr cap again');
    await vi.waitFor(async () => expect((await networkNotes(referrer, inv)).map((e) => e.data.kind)).toEqual(['referral.deal_won', 'referral.deal_reopened', 'referral.deal_won', 'referral.deal_reopened']), WAIT);
    expect(await scoreOf(referrer)).toBe(30);
  }, 30_000);

  it('CR-REOPEN-1 (D-102, RED before): the five paid handlers each pass their PAID check and are held before their write while the full refund\'s reopen handlers run and find nothing to undo; released, each writes, reads the invoice SENT and undoes its own write: no referral credit, no lead-score bump, the project back to ACTIVE, the margin snapshot invoice_paid_reversed, the review request CANCELLED (the runner sends nothing); the stale invoice.paid delivered again to each writes nothing', async () => {
    const referrer = `${P}rrLateReferrer`;
    const late = `${P}rrLate`;
    const inv = `${P}invRrLate`;
    const project = `${P}prj_rr_late`;
    await rrContact(referrer, { leadScore: 20, custom: {} });
    await rrContact(late, { custom: { referralSourceId: referrer } });
    await db.contactRelationship.create({ data: { businessId: ID.biz, fromContactId: late, toContactId: referrer, type: 'referred_by' } });
    await rrInvoice(inv, late, D102.product);
    await db.project.create({ data: { id: project, businessId: ID.biz, name: project, status: 'ACTIVE', invoiceId: inv, contactId: late } });

    const release = gate();
    const held: string[] = [];
    const paidRuns: Promise<unknown>[] = [];
    // [service, its write step (held once for this invoice), whether a call of that step is this invoice's]
    const holds: Array<[any, string, (...a: any[]) => boolean]> = [
      [referralRewards, 'checkAndAwardReward', (...a) => a[3] === inv],
      [crmNetwork, 'bumpOnDealWon', (...a) => a[3] === inv],
      [projectRevenue, 'transition', (...a) => a[1] === project],
      [marginListener, 'captureForInvoice', (...a) => a[1] === inv],
      [reviewSolicitation, 'scheduleReviewRequest', (...a) => a[1] === inv],
    ];
    for (const [svc, step, mine] of holds) {
      const proto = Object.getPrototypeOf(svc);
      let once = false;
      svc[step] = async (...args: any[]) => {
        if (mine(...args) && !once) {
          once = true;
          held.push(`${svc.constructor.name}.${step}`);
          await release.opened;
        }
        return proto[step].apply(svc, args);
      };
      svc.onInvoicePaid = (payload: any) => {
        const run = proto.onInvoicePaid.call(svc, payload);
        if (payload?.invoice?.id === inv) paidRuns.push(run);
        return run;
      };
    }
    try {
      const p = await paid(inv, 100, 'V42C-RR-LATE');
      const paidPayload = emitted.find((e) => e.name === 'invoice.paid' && e.payload?.invoice?.id === inv)!.payload;
      await vi.waitFor(() => expect([...held].sort()).toEqual([
        'CrmNetworkService.bumpOnDealWon',
        'MarginOnPaymentListener.captureForInvoice',
        'ProjectRevenueListener.transition',
        'ReferralRewardService.checkAndAwardReward',
        'ReviewSolicitationService.scheduleReviewRequest',
      ]), WAIT);
      await fullRefund(inv, p.id, 'v42c rr late');
      // The reopen's handlers ran first and found nothing to undo.
      await waitForCalendar('invoice', inv, (cal) => expect(cal).toMatchObject({ status: 'SCHEDULED' }));
      await settle();
      expect(await reviewJob(inv)).toBeNull();
      expect(await scoreOf(referrer)).toBe(20);

      release.open();
      expect(paidRuns).toHaveLength(5);
      await Promise.all(paidRuns);
      await settle();
      expect((await invoiceRow(inv)).status).toBe('SENT');
      // RED before: credit 10 / 1, score 35, IN_PROGRESS, ['invoice_paid'], PENDING.
      expect(await creditOf(referrer), 'no referral credit for the reopened invoice').toEqual({ balance: 0, earned: 0 });
      expect((await customOf(late)).referralRewardEarned ?? false).toBe(false);
      expect(await scoreOf(referrer), 'no lead-score bump').toBe(20);
      expect((await networkNotes(referrer, inv)).map((e) => e.data.kind)).toEqual(['referral.deal_won', 'referral.deal_reopened']);
      expect((await db.project.findUnique({ where: { id: project } })).status, 'the advance is stepped back').toBe('ACTIVE');
      const snaps = await db.marginSnapshot.findMany({ where: { invoiceId: inv } });
      expect(snaps.map((s: any) => s.snapshotReason), 'the snapshot is marked reversed').toEqual(['invoice_paid_reversed']);
      expect(await reviewJob(inv), 'the review request is cancelled').toMatchObject({ status: 'CANCELLED' });
      await db.scheduledAgentJob.updateMany({ where: { businessId: ID.biz, entityId: inv }, data: { scheduledFor: new Date(Date.now() - 60_000) } });
      await reviewSolicitation.processPendingJobs();
      expect(transactionalSends.filter((s) => s.recipientEmail === `${late.toLowerCase()}@test.local`), 'nobody is asked for a review').toEqual([]);

      // A stale invoice.paid delivered again after the reopen: each paid handler reads SENT and writes nothing.
      for (const [svc] of holds) await Object.getPrototypeOf(svc).onInvoicePaid.call(svc, paidPayload);
      await settle();
      expect(await creditOf(referrer)).toEqual({ balance: 0, earned: 0 });
      expect(await scoreOf(referrer)).toBe(20);
      expect((await networkNotes(referrer, inv)).map((e) => e.data.kind)).toEqual(['referral.deal_won', 'referral.deal_reopened']);
      expect((await db.project.findUnique({ where: { id: project } })).status).toBe('ACTIVE');
      expect((await db.marginSnapshot.findMany({ where: { invoiceId: inv } })).map((s: any) => s.snapshotReason)).toEqual(['invoice_paid_reversed']);
      expect(await reviewJob(inv), 'the CANCELLED request is not re-armed').toMatchObject({ status: 'CANCELLED' });
      expect(sentEmails).toHaveLength(0);
    } finally {
      release.open();
      for (const [svc, step] of holds) {
        delete svc[step];
        delete svc.onInvoicePaid;
      }
    }
  }, 40_000);
});
