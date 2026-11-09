/**
 * FOLLOW3-A1-D46-COMMERCE-WRITES (V1-81) — D-46 on the commerce invoice, quote
 * and payment write routes, and a hand-recorded payment can never pose as a
 * gateway payment (owner ruling D-55). REAL database, REAL guards, REAL ledger.
 *
 * Item 1 (F2, verify-money-findings): ModuleScopeGuard and BusinessGuard both
 * admit a platform SUPER_ADMIN to every tenant, and only the bare-id services
 * check a Membership. Every `commerce/businesses/:businessId` write forwarded
 * to a service that checks none, so a SUPER_ADMIN who is not a member of
 * business A recorded payments, refunded, bulk-voided, deleted, edited,
 * converted quotes and minted payment links in A (F2 SA-01..SA-07). D-46: a
 * non-member SUPER_ADMIN stays refused on tenant invoice writes; FOLLOW3-A2's
 * rule applies (a SUPER_ADMIN acts on a business's money only through a
 * Membership in it whose scope map, or role defaults, hold revenue:write).
 *
 *   D46-C01..C07  the non-member SUPER_ADMIN on A: POST invoices/:id/payments,
 *                 POST payments/:id/refund, PATCH invoices/bulk {void}, DELETE
 *                 invoices/:id, PATCH invoices/:id {notes}, POST quotes/:id/
 *                 convert, POST invoices/:id/payment-link.
 *                 RED-BEFORE: 201/200 and rows written in A.
 *                 GREEN-AFTER: 403 'Not authorized to update this invoice'
 *                 ('... this quote' for the quote route) and A is byte-identical:
 *                 invoices, quotes, payments, payment links, financial
 *                 transactions, ledger entries, Activity rows (no
 *                 payment_recorded / payment_refunded) and BusinessEvent rows
 *                 (D-08 audit trail stays clean).
 *   D46-CTL       controls, green before and after: owner A's identical calls
 *                 succeed; a SUPER_ADMIN that is an ADMIN member of A is
 *                 admitted; a non-member USER (owner B on A) gets 403 'No
 *                 access to this business' from BusinessGuard; a SUPER_ADMIN
 *                 whose membership holds only revenue:read (STAFF default) gets
 *                 the guard's 'Insufficient permissions' 403 (FOLLOW3-A2 rule).
 *   D46-R01..R04  review repair SEC-A1-1: the four bare-id routes the census
 *                 lists as SERVICE_REFUSED (mark-paid, payment-failed, invoice
 *                 status, quote status). A SUPER_ADMIN member of A whose
 *                 revenue level is read (STAFF default) or an explicit none
 *                 RED-BEFORE: 200 and the write done (a payment, its posting
 *                 and PAID; FAILED; VOID; SENT with a view token).
 *                 GREEN-AFTER: the guard's 403 'Insufficient permissions ...
 *                 (you have read|none)', as a regular revenue:read member
 *                 gets, A byte-identical; the service each route calls (and
 *                 ai-execute's mark_paid / void_invoice / send_quote reach)
 *                 refuses the same actors itself. Controls: the SUPER_ADMIN
 *                 ADMIN member and owner A are admitted; the non-member
 *                 SUPER_ADMIN keeps 'Not authorized to update this ...'.
 *
 * W3-D46-CREATE-AND-RECURRING (V1-89, owner ruling D-46): the two writes
 * FOLLOW3-A1 left out (its census it.todo D46-S07 and D46-S08).
 *   D46-S08   POST invoices (createInvoice, EXEMPT in FOLLOW3-A1: CC-FORWARD
 *             pinned a non-member SUPER_ADMIN's create at 201).
 *   D46-S07a..e  POST recurring-invoices, PATCH recurring-invoices/:id, POST
 *             recurring-invoices/:id/pause, POST .../resume, DELETE
 *             recurring-invoices/:id (RecurringInvoiceController, OPEN in
 *             FOLLOW3-A1: neither it nor its service checked a SUPER_ADMIN's
 *             Membership, so a non-member SUPER_ADMIN wrote an ACTIVE schedule
 *             the scheduler turns into real invoices).
 *             RED-BEFORE: 201/200 and the invoice or schedule written in A.
 *             GREEN-AFTER: 403 'Not authorized to update this invoice' for the
 *             non-member SUPER_ADMIN, the guard's 'Insufficient permissions'
 *             for a SUPER_ADMIN member below revenue:write; A byte-identical
 *             (schedules included) and no BusinessEvent.
 *   controls  owner A and the SUPER_ADMIN ADMIN member of A keep 201/200 and
 *             the write, and each schedule write answers the contact projected
 *             to id, businessId, firstName, lastName and email (review
 *             SEC-W3D46R-2, D-64); owner B (a non-member USER) keeps BusinessGuard's 403;
 *             the recurring run (the scheduler, which acts as the system and
 *             never as a SUPER_ADMIN) still bills a schedule the SUPER_ADMIN
 *             member created.
 *
 * W4-TRASH-D46 (V1-90, owner ruling D-46; review SEC-W3D46R-3, census it.todo
 * D46-S09): TrashController (api/businesses/:b/trash) restored and permanently
 * deleted revenue rows behind BusinessGuard alone.
 *   D46-S09a,b  POST trash/recurringInvoice/:id/restore and DELETE
 *             trash/recurringInvoice/:id by the non-member SUPER_ADMIN.
 *             RED-BEFORE: 201 (the trashed ACTIVE, due schedule back, billed on
 *             the next run) and 200 (the row erased).
 *             GREEN-AFTER: 403 'Not authorized to update this invoice', A
 *             byte-identical, and the real recurring run bills nothing from it.
 *   D46-S09c,d  the same two calls by a revenue:read USER member, and by the
 *             SUPER_ADMIN members below revenue:write: the guard's
 *             'Insufficient permissions' 403, nothing changed, never billed.
 *   D46-S09e  the trash's other revenue models (invoice, quote) by the
 *             non-member SUPER_ADMIN: 403 before any lookup.
 *   controls  owner A and the SUPER_ADMIN ADMIN member restore (201) and
 *             permanently delete (200); owner B keeps BusinessGuard's 403.
 *   D46-S09f  review repair SEC-TRASH-D46-1 (revenue:read): GET trash?model=
 *             recurringInvoice|invoice|quote by a USER member whose scope map
 *             holds revenue:'none'. RED-BEFORE: 200 and the rows.
 *             GREEN-AFTER: the guard's 403 'requires read access (you have
 *             none)', as GET recurring-invoices, invoices and quotes answer.
 *             D46-S09g (the every-model listing) was an it.todo here (a
 *             pre-existing 500, see its block); W5-TRASH-LIST-500 makes it
 *             live: RED-BEFORE 500 for every caller (queryModel('opportunity')
 *             filtered on businessId, which Opportunity does not have).
 *             GREEN-AFTER: 200; the revenue:'none' member gets no revenue
 *             model's row, owner A gets A's trashed records and no live row.
 *
 * Item 3 (V1-15d residual, D-55): recordPayment wrote provider = method, so a
 * hand-recorded payment with method 'stripe' and a reference naming another
 * tenant's PaymentIntent stored a SUCCESSFUL provider 'stripe' row. The Stripe
 * refund door (payments.service.ts processStripeRefund) matches provider
 * 'stripe' plus providerPaymentId/reference across every tenant on a
 * platform-signed delivery, so that row made C's genuine refund ambiguous and
 * C's books never showed it.
 *
 *   D46-C08  owner B posts B/invoices/:id/payments {amount:1, method:'stripe',
 *            reference:<C's pi_>}.
 *            RED-BEFORE: 201 with provider 'stripe'; the platform-signed
 *            refund.created for C's pi_ then writes no -X row in C.
 *            GREEN-AFTER (D-55): 201, the row is provider 'manual', method
 *            'stripe', and its INCOME posting still debits PAYMENT_PROCESSOR;
 *            the refund writes C's -100 REFUNDED row and reverses C's posting,
 *            C's ledger cash net = C's balance net; B is byte-identical.
 *   D46-C09  KEY processPayment through CommerceAdapterService (no req.user,
 *            actor KEY_SYSTEM_ACTOR_ID) on A's invoice with method 'stripe' and
 *            reference C's second pi_: same RED and GREEN as C08.
 *   D46-C10  controls: owner A posts 'PayPal' (the web option), 'PAYPAL' (the
 *            evidence confirm spelling), 'card', 'cash', 'bank_transfer',
 *            'other': each stored with provider = method exactly as today
 *            (exact lower-case comparison, never case-folded) and posted to
 *            the deposit account it posts to today; exactly 'stripe',
 *            'paypal', 'wipay' are stored provider 'manual', method kept,
 *            posted to PAYMENT_PROCESSOR.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, TenantInterceptor, GlobalHttpExceptionFilter,
 * ValidationPipe, CommerceService, InvoiceWorkflowService, RevenuePostingService,
 * PostingService, ChartOfAccountsSeederService, TimelineService (Activity rows)
 * and PaymentsService (Stripe webhook door) write real rows; the production
 * BusinessEventInterceptor is installed as APP_INTERCEPTOR and its emitter
 * writes the business_events row the worker would. Identity attachment is the
 * one stand-in: a test middleware reads `x-v81a-user`, loads that seeded user
 * row and attaches `{ id, email, role }`. Gateways, Gmail, the contact timeline
 * and EventEmitter2 are stubs off the boundary.
 *
 * Fixtures: prefix `v81a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order
 * in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

// W4-FLAKE-HARDEN: every case here is a chain of real HTTP writes, postings and
// ledger reads against Postgres (D46-C09 alone: a checkout payment, a KEY
// payment, a platform-signed refund and four ledger reads). Under a loaded
// database D46-C09 ran past vitest's 5 s default and was reported as a failure
// although nothing it asserts had gone wrong. An explicit bound for every case
// (and the cleanup hook below): a slow database is not a red result.
vi.setConfig({ testTimeout: 60_000 });

const P = 'v81a_';
const HEADER = 'x-v81a-user';
const PLATFORM = `whsec_${P}platform`;
const TOTAL = 100;

const ID = {
  ownerA: `${P}ownerA`,
  saNon: `${P}saNon`, // SUPER_ADMIN, member of no business
  saAdminA: `${P}saAdminA`, // SUPER_ADMIN, ADMIN member of A (revenue:admin by default)
  saStaffA: `${P}saStaffA`, // SUPER_ADMIN, STAFF member of A (revenue:read by default)
  saNoneA: `${P}saNoneA`, // SUPER_ADMIN, ADMIN member of A with an explicit { revenue: 'none' } map
  staffReadA: `${P}staffReadA`, // USER, STAFF member of A (revenue:read by default)
  // W4-TRASH-D46 review repair SEC-TRASH-D46-1: USER, ADMIN member of A with { revenue: 'none', settings: 'admin', crm: 'write' }
  userNoneA: `${P}userNoneA`,
  ownerB: `${P}ownerB`,
  ownerC: `${P}ownerC`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizC: `${P}bizC`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  contactC: `${P}contactC`,
};
const CONTACT_OF: Record<string, string> = { [ID.bizA]: ID.contactA, [ID.bizB]: ID.contactB, [ID.bizC]: ID.contactC };
const DEPOSIT_KEYS = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR']);

let db: any;
let app: any;
let redis: any;
let paymentsSvc: any;
let commerceSvc: any;
let keyAdapter: any;
let keyActorId: string;
/** W3-D46-CREATE-AND-RECURRING: the real recurring runner, its due scan scoped to one business of this suite. */
let recurringRunner: (businessId: string) => any;
let storedBalanceFn: (total: number, rows: Array<{ amount: number; status: string }>, currency?: string) => any;

const eventStub = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

/** Side effects the request path starts without awaiting (Activity rows, the BusinessEvent write). */
const pending: Array<Promise<unknown>> = [];
function track<T>(p: Promise<T>): Promise<T> {
  pending.push(p.catch(() => undefined));
  return p;
}
async function settle() {
  while (pending.length) await Promise.all(pending.splice(0));
}

/** The audit emitter behind the real BusinessEventInterceptor: the row the worker writes. */
const auditJobs: Array<{ businessId: string; eventType: string; actorId: string }> = [];
const auditEmitter = {
  emit: (job: any) =>
    track(
      (async () => {
        auditJobs.push({ businessId: job.businessId, eventType: job.eventType, actorId: job.actorId });
        await db.businessEvent.create({
          data: {
            businessId: job.businessId,
            eventType: job.eventType,
            subjectType: job.subjectType,
            subjectId: String(job.subjectId),
            actorType: job.actorType,
            actorId: job.actorId,
            action: job.action,
            source: job.source ?? 'api',
            evidenceIds: [],
            messageIds: [],
          },
        });
      })(),
    ),
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM webhook_events WHERE provider_event_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `UPDATE quotes SET invoice_id = NULL WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM recurring_invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    // W5-TRASH-LIST-500 (D46-S09g): the trashed and live opportunities of A and B.
    `DELETE FROM community_opportunities WHERE poster_business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

let docSeq = 0;
/** An invoice of `biz` in `status` with one line of `total`. */
async function makeInvoice(biz: string, tag: string, status: string, total = TOTAL): Promise<string> {
  docSeq += 1;
  const id = `${P}inv_${tag}`;
  await db.invoice.create({
    data: {
      id,
      invoiceNumber: `V81A-${String(docSeq).padStart(4, '0')}`,
      status,
      subtotal: total,
      total,
      currency: 'TTD',
      businessId: biz,
      contactId: CONTACT_OF[biz],
      items: { create: [{ id: `${id}_i1`, description: `V81A ${tag}`, quantity: 1, unitPrice: total, total }] },
    },
  });
  return id;
}

/** A quote of `biz` in `status` (ACCEPTED, the default, is convertible). */
async function makeQuote(biz: string, tag: string, status = 'ACCEPTED'): Promise<string> {
  docSeq += 1;
  const id = `${P}q_${tag}`;
  await db.quote.create({
    data: {
      id,
      quoteNumber: `V81A-Q${String(docSeq).padStart(4, '0')}`,
      status,
      subtotal: TOTAL,
      total: TOTAL,
      currency: 'TTD',
      businessId: biz,
      contactId: CONTACT_OF[biz],
      items: { create: [{ id: `${id}_i1`, description: `V81A ${tag}`, quantity: 1, unitPrice: TOTAL, total: TOTAL }] },
    },
  });
  return id;
}

function as(actor: string | null, req: any) {
  return actor ? req.set(HEADER, actor) : req;
}
const agent = () => request(app.getHttpServer());

function recordPaymentCall(actor: string | null, biz: string, invoiceId: string, body: Record<string, unknown>) {
  return as(actor, agent().post(`/commerce/businesses/${biz}/invoices/${invoiceId}/payments`)).send(body);
}

/**
 * Every row of a business the seven writes can touch, as stored. Settles the
 * request path's unawaited side effects first, so a write of an earlier call
 * never lands inside a later comparison.
 */
async function stateOf(businessId: string) {
  await settle();
  const byId = { orderBy: { id: 'asc' as const } };
  const [invoices, quotes, schedules, payments, links, txns, entries, activities, events] = await Promise.all([
    // Raw: the client hides soft-deleted invoices and quotes, and a delete must show.
    db.$queryRawUnsafe('SELECT * FROM invoices WHERE business_id = $1 ORDER BY id', businessId),
    db.$queryRawUnsafe('SELECT * FROM quotes WHERE business_id = $1 ORDER BY id', businessId),
    // W3-D46-CREATE-AND-RECURRING: the recurring writes (D46-S07a..e) show here too.
    db.$queryRawUnsafe('SELECT * FROM recurring_invoices WHERE business_id = $1 ORDER BY id', businessId),
    db.payment.findMany({ where: { businessId }, ...byId }),
    db.paymentLink.findMany({ where: { businessId }, ...byId }),
    db.financialTransaction.findMany({ where: { businessId }, ...byId }),
    db.ledgerEntry.findMany({ where: { businessId }, ...byId }),
    db.activity.findMany({ where: { businessId }, ...byId }),
    db.businessEvent.findMany({ where: { businessId }, ...byId }),
  ]);
  return JSON.parse(JSON.stringify({ invoices, quotes, schedules, payments, links, txns, entries, activities, events }));
}

/** A Stripe delivery signed with the deployment's own webhook secret (platform-verified, no tenant binding). */
async function platformStripe(id: string, type: string, object: Record<string, unknown>) {
  const raw = JSON.stringify({ id: `${P}${id}`, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const signature = `t=${t},v1=${createHmac('sha256', PLATFORM).update(`${t}.${raw}`).digest('hex')}`;
  const prev = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = PLATFORM;
  try {
    return await paymentsSvc.handleStripeWebhook(raw, signature);
  } finally {
    if (prev === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prev;
  }
}

/**
 * C's Stripe Checkout payment of `amount` (stored as cs_, its pi_ in reference). Its metadata names
 * the invoice's business, as every session createStripeCheckout makes does and as a platform-signed
 * payment event must (R0-20c review SEC-R020C-1).
 */
async function payBySession(inv: string, n: string, amount: number) {
  const { businessId } = await db.invoice.findUnique({ where: { id: inv }, select: { businessId: true } });
  return platformStripe(`evt_cs_${n}`, 'checkout.session.completed', {
    id: `${P}cs_${n}`, client_reference_id: inv, amount_total: amount * 100, currency: 'ttd', payment_intent: `${P}pi_${n}`, metadata: { invoiceId: inv, businessId },
  });
}

/** refund.created for the charge / PaymentIntent of `n`. */
function refundCreated(n: string, amount: number) {
  return platformStripe(`evt_re_${n}`, 'refund.created', {
    id: `${P}re_${n}`, amount: amount * 100, currency: 'ttd', charge: `${P}ch_${n}`, payment_intent: `${P}pi_${n}`, status: 'succeeded',
  });
}

async function paymentsOf(invoiceId: string): Promise<any[]> {
  return db.payment.findMany({ where: { invoiceId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

/** `type:status:amount` of the transactions one payment sourced, in posting order. */
async function postingsOf(paymentId: string): Promise<string[]> {
  const txns = await db.financialTransaction.findMany({
    where: { sourceType: 'Payment', sourceId: paymentId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return txns.map((t: any) => `${t.type}:${t.status}:${Number(t.amount)}`);
}

/** The system key of the account the payment's INCOME posting debits. */
async function depositAccountOf(paymentId: string): Promise<string | undefined> {
  const txn = await db.financialTransaction.findFirst({
    where: { sourceType: 'Payment', sourceId: paymentId, type: 'INCOME' },
    include: { entries: { include: { account: { select: { systemKey: true } } } } },
  });
  return txn?.entries.find((e: any) => Number(e.debit ?? 0) > 0)?.account?.systemKey;
}

const money = (n: number) => Math.round(n * 100) / 100;

/** The invoice's Payment-sourced deposit-side (cash) net equals its stored balance net, and is `net`. */
async function expectLedgerAgrees(invoiceId: string, net: number) {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId } });
  const rows = await paymentsOf(invoiceId);
  const txns = await db.financialTransaction.findMany({
    where: { businessId: inv.businessId, sourceType: 'Payment', sourceId: { in: rows.map((r) => r.id) } },
    include: { entries: { include: { account: { select: { systemKey: true } } } } },
  });
  const cashNet = money(
    txns
      .flatMap((t: any) => t.entries)
      .filter((e: any) => DEPOSIT_KEYS.has(e.account?.systemKey))
      .reduce((s: number, e: any) => s + Number(e.debit ?? 0) - Number(e.credit ?? 0), 0),
  );
  const balance = storedBalanceFn(Number(inv.total), rows.map((r) => ({ amount: Number(r.amount), status: r.status })), inv.currency);
  expect(cashNet, `${invoiceId}: ledger cash net = balance net`).toBe(balance.net);
  expect(balance.net, `${invoiceId}: balance net`).toBe(net);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const IORedis = (await import('ioredis')).default;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { KEY_SYSTEM_ACTOR_ID } = await import('../src/core/auth/system-actor');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { BusinessEventInterceptor } = await import('../src/modules/business-events/business-event.interceptor');
  const { ResilientEmitterService } = await import('../src/modules/business-events/resilient-emitter.service');
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
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  const { CommerceAdapterService } = await import('../src/modules/key-cortex/adapters/commerce-adapter.service');
  const { RecurringInvoiceController } = await import('../src/modules/commerce/recurring-invoice.controller');
  const { RecurringInvoiceService } = await import('../src/modules/commerce/recurring-invoice.service');
  const { TrashController } = await import('../src/modules/trash/trash.controller');
  storedBalanceFn = workflowMod.balanceOfStoredRows;
  keyActorId = KEY_SYSTEM_ACTOR_ID;

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    // W3-D46-CREATE-AND-RECURRING: RecurringInvoiceController too (D46-S07a..e).
    // W4-TRASH-D46: TrashController too (D46-S09a..e; its CatalogService is the stub below).
    controllers: [CommerceController, RecurringInvoiceController, TrashController],
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
      RecurringInvoiceService,
      workflowMod.InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      // The real TimelineService (Activity rows), its unawaited writes tracked.
      {
        provide: TimelineService,
        useFactory: (prisma: any) => {
          const real = new TimelineService(prisma);
          return { recordEvent: (input: any) => track(real.recordEvent(input)) };
        },
        inject: [PrismaService],
      },
      { provide: APP_INTERCEPTOR, useClass: BusinessEventInterceptor },
      { provide: ResilientEmitterService, useValue: auditEmitter },
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: { attachVisitorToContact: async () => undefined } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
    ],
  }).compile();
  const commerce = moduleRef.get(CommerceService);
  commerceSvc = commerce;
  paymentsSvc = new PaymentsService(
    moduleRef.get(PrismaService),
    commerce,
    moduleRef.get(workflowMod.InvoiceWorkflowService),
    moduleRef.get(RevenuePostingService),
  );
  keyAdapter = new CommerceAdapterService(commerce);
  // The real recurring runner over the real workflow (as commerce-document-numbering composes it);
  // its due scan is scoped to one of this suite's businesses so a run never bills another suite's schedules.
  const workflowSvc = moduleRef.get(workflowMod.InvoiceWorkflowService);
  recurringRunner = (businessId: string) => {
    const scoped = new Proxy(db, {
      get(target: any, prop: string | symbol) {
        if (prop === 'recurringInvoice') {
          const delegate = Reflect.get(target, prop);
          return new Proxy(delegate, {
            get(d: any, method: string | symbol) {
              const orig = Reflect.get(d, method);
              if (method !== 'findMany' || typeof orig !== 'function') return typeof orig === 'function' ? orig.bind(d) : orig;
              return (args: any = {}) => orig.call(d, { ...args, where: { AND: [args.where ?? {}, { businessId }] } });
            },
          });
        }
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    return new RecurringInvoiceService({ client: scoped } as any, eventStub as any, workflowSvc);
  };

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
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const [id, role] of [
    [ID.ownerA, 'USER'], [ID.ownerB, 'USER'], [ID.ownerC, 'USER'],
    [ID.saNon, 'SUPER_ADMIN'], [ID.saAdminA, 'SUPER_ADMIN'], [ID.saStaffA, 'SUPER_ADMIN'],
    [ID.saNoneA, 'SUPER_ADMIN'], [ID.staffReadA, 'USER'], [ID.userNoneA, 'USER'],
  ] as const) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length).toLowerCase()}@test.local`, name: id, role } });
  }
  for (const [biz, owner, contact, name] of [
    [ID.bizA, ID.ownerA, ID.contactA, 'V81A Biz A'],
    [ID.bizB, ID.ownerB, ID.contactB, 'V81A Biz B'],
    [ID.bizC, ID.ownerC, ID.contactC, 'V81A Biz C'],
  ] as const) {
    await db.business.create({ data: { id: biz, name, ownerId: owner, currency: 'TTD', accountingBasis: 'CASH' } });
    await db.membership.create({ data: { id: `${owner}_m`, userId: owner, businessId: biz, role: 'OWNER' } });
    await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(biz);
    await db.contact.create({ data: { id: contact, businessId: biz, firstName: 'V81a', lastName: name, email: `${P}${contact.slice(P.length).toLowerCase()}@test.local` } });
  }
  await db.membership.create({ data: { id: `${ID.saAdminA}_m`, userId: ID.saAdminA, businessId: ID.bizA, role: 'ADMIN' } });
  await db.membership.create({ data: { id: `${ID.saStaffA}_m`, userId: ID.saStaffA, businessId: ID.bizA, role: 'STAFF' } });
  await db.membership.create({
    data: { id: `${ID.saNoneA}_m`, userId: ID.saNoneA, businessId: ID.bizA, role: 'ADMIN', permissionScopes: { revenue: 'none', crm: 'write' } },
  });
  await db.membership.create({ data: { id: `${ID.staffReadA}_m`, userId: ID.staffReadA, businessId: ID.bizA, role: 'STAFF' } });
  await db.membership.create({
    data: { id: `${ID.userNoneA}_m`, userId: ID.userNoneA, businessId: ID.bizA, role: 'ADMIN', permissionScopes: { revenue: 'none', settings: 'admin', crm: 'write' } },
  });
}, 180_000);

afterAll(async () => {
  await settle();
  if (app) await app.close();
  if (db) {
    await cleanup();
    // The fixtures leave nothing behind.
    const left = await db.$queryRawUnsafe(`SELECT
      (SELECT count(*) FROM businesses WHERE id LIKE ${sqlLikePrefix(P)})::int AS businesses,
      (SELECT count(*) FROM users WHERE id LIKE ${sqlLikePrefix(P)})::int AS users,
      (SELECT count(*) FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS payments,
      (SELECT count(*) FROM webhook_events WHERE provider_event_id LIKE ${sqlLikePrefix(P)})::int AS webhooks`);
    expect(left).toEqual([{ businesses: 0, users: 0, payments: 0, webhooks: 0 }]);
  }
  if (redis) await redis.quit();
}, 60_000);

/**
 * One of the seven writes: its fixture (made fresh per actor, so every actor
 * acts on its own document), the call, and what an admitted call does.
 */
interface WriteCase {
  id: string;
  what: string;
  subject: 'invoice' | 'quote';
  okStatus: number;
  prepare: (tag: string) => Promise<Record<string, string>>;
  call: (actor: string, fx: Record<string, string>) => any;
  admitted: (fx: Record<string, string>, res: any) => Promise<void>;
}

const CASES: WriteCase[] = [
  {
    id: 'D46-C01',
    what: 'POST invoices/:id/payments {amount:100, method:cash}',
    subject: 'invoice',
    okStatus: 201,
    prepare: async (tag) => ({ inv: await makeInvoice(ID.bizA, `c01_${tag}`, 'SENT') }),
    call: (actor, fx) => recordPaymentCall(actor, ID.bizA, fx.inv, { amount: 100, method: 'cash' }),
    admitted: async (fx) => {
      expect((await db.invoice.findUnique({ where: { id: fx.inv } })).status).toBe('PAID');
      const rows = await paymentsOf(fx.inv);
      expect(rows.map((r) => `${r.status}:${Number(r.amount)}`)).toEqual(['SUCCESSFUL:100']);
      expect(await postingsOf(rows[0].id)).toEqual(['INCOME:POSTED:100']);
    },
  },
  {
    id: 'D46-C02',
    what: 'POST payments/:id/refund',
    subject: 'invoice',
    okStatus: 201,
    prepare: async (tag) => {
      const inv = await makeInvoice(ID.bizA, `c02_${tag}`, 'SENT');
      const paid = await recordPaymentCall(ID.ownerA, ID.bizA, inv, { amount: 100, method: 'cash' });
      expect(paid.status, JSON.stringify(paid.body)).toBe(201);
      return { inv, payment: paid.body.payment.id };
    },
    call: (actor, fx) => as(actor, agent().post(`/commerce/businesses/${ID.bizA}/payments/${fx.payment}/refund`)).send({ reason: 'v81a refund' }),
    admitted: async (fx) => {
      const rows = await paymentsOf(fx.inv);
      expect(rows.map((r) => `${r.status}:${Number(r.amount)}`)).toEqual(['SUCCESSFUL:100', 'REFUNDED:-100']);
      expect(await postingsOf(fx.payment)).toEqual(['INCOME:REVERSED:100', 'REVERSAL:POSTED:100']);
    },
  },
  {
    id: 'D46-C03',
    what: 'PATCH invoices/bulk {action:void}',
    subject: 'invoice',
    okStatus: 200,
    prepare: async (tag) => ({ inv: await makeInvoice(ID.bizA, `c03_${tag}`, 'SENT') }),
    call: (actor, fx) => as(actor, agent().patch(`/commerce/businesses/${ID.bizA}/invoices/bulk`)).send({ ids: [fx.inv], action: 'void' }),
    admitted: async (fx, res) => {
      expect(res.body).toMatchObject({ updated: 1, action: 'void' });
      expect((await db.invoice.findUnique({ where: { id: fx.inv } })).status).toBe('VOID');
    },
  },
  {
    id: 'D46-C04',
    what: 'DELETE invoices/:id',
    subject: 'invoice',
    okStatus: 200,
    prepare: async (tag) => ({ inv: await makeInvoice(ID.bizA, `c04_${tag}`, 'DRAFT') }),
    call: (actor, fx) => as(actor, agent().delete(`/commerce/businesses/${ID.bizA}/invoices/${fx.inv}`)),
    admitted: async (fx) => {
      // The client hides a soft-deleted row; the table is read directly.
      const [row] = await db.$queryRawUnsafe('SELECT deleted_at FROM invoices WHERE id = $1', fx.inv);
      expect(row?.deleted_at).toBeInstanceOf(Date);
    },
  },
  {
    id: 'D46-C05',
    what: 'PATCH invoices/:id {notes}',
    subject: 'invoice',
    okStatus: 200,
    prepare: async (tag) => ({ inv: await makeInvoice(ID.bizA, `c05_${tag}`, 'DRAFT') }),
    call: (actor, fx) => as(actor, agent().patch(`/commerce/businesses/${ID.bizA}/invoices/${fx.inv}`)).send({ notes: `${P}edited` }),
    admitted: async (fx) => {
      expect((await db.invoice.findUnique({ where: { id: fx.inv } })).notes).toBe(`${P}edited`);
    },
  },
  {
    id: 'D46-C06',
    what: 'POST quotes/:id/convert',
    subject: 'quote',
    okStatus: 201,
    prepare: async (tag) => ({ quote: await makeQuote(ID.bizA, `c06_${tag}`) }),
    call: (actor, fx) => as(actor, agent().post(`/commerce/businesses/${ID.bizA}/quotes/${fx.quote}/convert`)).send({}),
    admitted: async (fx, res) => {
      const quote = await db.quote.findUnique({ where: { id: fx.quote } });
      expect(quote.invoiceId).toBe(res.body.id);
      expect((await db.invoice.findUnique({ where: { id: quote.invoiceId } })).status).toBe('DRAFT');
    },
  },
  {
    id: 'D46-C07',
    what: 'POST invoices/:id/payment-link',
    subject: 'invoice',
    okStatus: 201,
    prepare: async (tag) => ({ inv: await makeInvoice(ID.bizA, `c07_${tag}`, 'SENT') }),
    call: (actor, fx) => as(actor, agent().post(`/commerce/businesses/${ID.bizA}/invoices/${fx.inv}/payment-link`)).send({}),
    admitted: async (fx) => {
      expect(await db.paymentLink.count({ where: { invoiceId: fx.inv, businessId: ID.bizA } })).toBe(1);
    },
  },
];

describe('Item 1 (D-46): a SUPER_ADMIN with no membership in A is refused on every commerce write in A, and nothing is written', () => {
  for (const c of CASES) {
    it(`${c.id}: ${c.what} by the non-member SUPER_ADMIN answers 403 'Not authorized to update this ${c.subject}'; A's invoices, quotes, payments, links, postings, ledger, Activity and BusinessEvent rows are byte-identical`, async () => {
      const fx = await c.prepare('saNon');
      const before = await stateOf(ID.bizA);
      const jobsBefore = auditJobs.length;
      const res = await c.call(ID.saNon, fx);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.message).toBe(`Not authorized to update this ${c.subject}`);
      expect(await stateOf(ID.bizA)).toEqual(before);
      // D-08: no audit trail of a write that did not happen.
      expect(auditJobs.slice(jobsBefore)).toEqual([]);
    });
  }

  it("D46-C01..C07 (A2 rule): a SUPER_ADMIN whose membership in A holds only revenue:read (STAFF default) gets the guard's 403 'Insufficient permissions' on every write; A is byte-identical", async () => {
    for (const c of CASES) {
      const fx = await c.prepare('saStaff');
      const before = await stateOf(ID.bizA);
      const res = await c.call(ID.saStaffA, fx);
      expect(res.status, `${c.id}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body.message, c.id).toBe('Insufficient permissions: revenue requires write access (you have read)');
      expect(await stateOf(ID.bizA), c.id).toEqual(before);
    }
  });
});

describe('Item 1 controls (green before and after)', () => {
  for (const c of CASES) {
    it(`${c.id} control: owner A's identical call is admitted (${c.okStatus}) and does the write`, async () => {
      const fx = await c.prepare('owner');
      const res = await c.call(ID.ownerA, fx);
      expect(res.status, JSON.stringify(res.body)).toBe(c.okStatus);
      await c.admitted(fx, res);
    });

    it(`${c.id} control: a SUPER_ADMIN that is an ADMIN member of A is admitted (${c.okStatus}) and does the write`, async () => {
      const fx = await c.prepare('saAdmin');
      const res = await c.call(ID.saAdminA, fx);
      expect(res.status, JSON.stringify(res.body)).toBe(c.okStatus);
      await c.admitted(fx, res);
    });

    it(`${c.id} control: a non-member USER (owner B on A) is refused by BusinessGuard (403 No access to this business); A is byte-identical`, async () => {
      const fx = await c.prepare('ownerB');
      const before = await stateOf(ID.bizA);
      const res = await c.call(ID.ownerB, fx);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.message).toBe('No access to this business');
      expect(await stateOf(ID.bizA)).toEqual(before);
    });
  }
});

/**
 * Review repair SEC-A1-1: the four bare-id revenue:write routes (the census's
 * SERVICE_REFUSED) carry no :businessId, so the controller helper does not run
 * on them, and ModuleScopeGuard admits SUPER_ADMIN without a scope. Their
 * services checked only that a Membership existed, so a SUPER_ADMIN member of
 * A whose revenue level is read or none marked A's invoices paid (a payment,
 * its posting, PAID), failed and voided them and sent its quotes, where the
 * guarded twins refused it. The service now applies the rest of the rule
 * (scope map, else role defaults, revenue >= write) to every human actor. The
 * same service is what POST businesses/:b/ai-execute's mark_paid,
 * void_invoice, convert_quote and send_quote reach.
 */
interface BareIdCase {
  id: string;
  what: string;
  subject: 'invoice' | 'quote';
  prepare: (tag: string) => Promise<string>;
  http: (actor: string, doc: string) => any;
  service: (actor: string, doc: string) => Promise<unknown>;
  admitted: (doc: string) => Promise<void>;
}

const BARE_ID: BareIdCase[] = [
  {
    id: 'D46-R01',
    what: 'PATCH invoices/:id/paid?businessId=A (CommerceService.markInvoicePaid)',
    subject: 'invoice',
    prepare: (tag) => makeInvoice(ID.bizA, `r01_${tag}`, 'SENT'),
    http: (actor, inv) => as(actor, agent().patch(`/commerce/invoices/${inv}/paid?businessId=${ID.bizA}`)).send({}),
    service: (actor, inv) => commerceSvc.markInvoicePaid(inv, actor, ID.bizA),
    admitted: async (inv) => {
      expect((await db.invoice.findUnique({ where: { id: inv } })).status).toBe('PAID');
      const rows = await paymentsOf(inv);
      expect(rows.map((r) => `${r.status}:${Number(r.amount)}`)).toEqual(['SUCCESSFUL:100']);
      expect(await postingsOf(rows[0].id)).toEqual(['INCOME:POSTED:100']);
    },
  },
  {
    id: 'D46-R02',
    what: 'PATCH invoices/:id/payment-failed?businessId=A (CommerceService.markInvoicePaymentFailed)',
    subject: 'invoice',
    prepare: (tag) => makeInvoice(ID.bizA, `r02_${tag}`, 'SENT'),
    http: (actor, inv) => as(actor, agent().patch(`/commerce/invoices/${inv}/payment-failed?businessId=${ID.bizA}`)).send({ reason: 'v81a' }),
    service: (actor, inv) => commerceSvc.markInvoicePaymentFailed(inv, actor, 'v81a', ID.bizA),
    admitted: async (inv) => {
      expect((await db.invoice.findUnique({ where: { id: inv } })).status).toBe('FAILED');
    },
  },
  {
    id: 'D46-R03',
    what: "PATCH invoices/:id/status/void {status:'VOID', businessId:A} (CommerceService.updateInvoiceStatus)",
    subject: 'invoice',
    prepare: (tag) => makeInvoice(ID.bizA, `r03_${tag}`, 'SENT'),
    http: (actor, inv) => as(actor, agent().patch(`/commerce/invoices/${inv}/status/void`)).send({ status: 'VOID', businessId: ID.bizA }),
    service: (actor, inv) => commerceSvc.updateInvoiceStatus({ invoiceId: inv, status: 'VOID', actorId: actor, businessId: ID.bizA }),
    admitted: async (inv) => {
      expect((await db.invoice.findUnique({ where: { id: inv } })).status).toBe('VOID');
    },
  },
  {
    id: 'D46-R04',
    what: 'PATCH quotes/:id/status/sent {businessId:A} on a DRAFT quote (CommerceService.updateQuoteStatus)',
    subject: 'quote',
    prepare: (tag) => makeQuote(ID.bizA, `r04_${tag}`, 'DRAFT'),
    http: (actor, q) => as(actor, agent().patch(`/commerce/quotes/${q}/status/sent`)).send({ businessId: ID.bizA }),
    service: (actor, q) => commerceSvc.updateQuoteStatus({ quoteId: q, status: 'SENT', actorId: actor, businessId: ID.bizA }),
    admitted: async (q) => {
      const quote = await db.quote.findUnique({ where: { id: q } });
      expect(quote.status).toBe('SENT');
      expect(typeof quote.viewToken).toBe('string');
    },
  },
];

async function rejectionOf(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  return null;
}

const BELOW_WRITE: Array<[actor: string, level: string]> = [
  [ID.saStaffA, 'read'], // SUPER_ADMIN, STAFF member (role defaults)
  [ID.saNoneA, 'none'], // SUPER_ADMIN, ADMIN member with an explicit { revenue: 'none' }
];

describe('Review repair SEC-A1-1: the four service-refused bare-id writes hold FOLLOW3-A2\'s whole rule (a Membership holding revenue:write), not a Membership alone', () => {
  for (const c of BARE_ID) {
    it(`${c.id}: ${c.what} by a SUPER_ADMIN member of A below revenue:write (STAFF default read; explicit none) answers the guard's 403 'Insufficient permissions', as a regular revenue:read member does; A is byte-identical`, async () => {
      for (const [actor, level] of [...BELOW_WRITE, [ID.staffReadA, 'read'] as [string, string]]) {
        const doc = await c.prepare(actor.slice(P.length));
        const before = await stateOf(ID.bizA);
        const jobsBefore = auditJobs.length;
        const res = await c.http(actor, doc);
        // RED-BEFORE (SUPER_ADMIN members): 200, and the write done.
        expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(res.body.message, actor).toBe(`Insufficient permissions: revenue requires write access (you have ${level})`);
        expect(await stateOf(ID.bizA), actor).toEqual(before);
        expect(auditJobs.slice(jobsBefore), actor).toEqual([]);
      }
    });

    it(`${c.id} (service half, what ai-execute reaches): the service refuses the same actors, and a regular revenue:read member, with ForbiddenException 'Insufficient permissions' before anything is written`, async () => {
      for (const [actor, level] of [...BELOW_WRITE, [ID.staffReadA, 'read'] as [string, string]]) {
        const doc = await c.prepare(`svc_${actor.slice(P.length)}`);
        const before = await stateOf(ID.bizA);
        const err = await rejectionOf(c.service(actor, doc));
        expect(err?.getStatus?.(), `${actor}: ${String(err)}`).toBe(403);
        expect(err.message, actor).toBe(`Insufficient permissions: revenue requires write access (you have ${level})`);
        expect(await stateOf(ID.bizA), actor).toEqual(before);
      }
    });

    it(`${c.id} control: a SUPER_ADMIN that is an ADMIN member of A and owner A are admitted (200) and the write is done`, async () => {
      for (const actor of [ID.saAdminA, ID.ownerA]) {
        const doc = await c.prepare(`ok_${actor.slice(P.length)}`);
        const res = await c.http(actor, doc);
        expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(200);
        await c.admitted(doc);
      }
    });

    it(`${c.id} control: the non-member SUPER_ADMIN still answers 403 'Not authorized to update this ${c.subject}' (route and service); A is byte-identical`, async () => {
      const doc = await c.prepare('saNon');
      const before = await stateOf(ID.bizA);
      const res = await c.http(ID.saNon, doc);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.message).toBe(`Not authorized to update this ${c.subject}`);
      const err = await rejectionOf(c.service(ID.saNon, doc));
      expect(err?.getStatus?.(), String(err)).toBe(403);
      expect(err.message).toBe(`Not authorized to update this ${c.subject}`);
      expect(await stateOf(ID.bizA)).toEqual(before);
    });
  }
});

describe('Item 3 (D-55): a hand-recorded payment never poses as a gateway payment', () => {
  it("D46-C08: owner B hand-records {amount:1, method:'stripe', reference:<C's pi_>}: 201, stored provider 'manual' with method 'stripe' and posted to PAYMENT_PROCESSOR; C's platform-signed refund.created then writes C's -100 REFUNDED row and reverses C's posting; B is byte-identical", async () => {
    const invC = await makeInvoice(ID.bizC, 'c08_c', 'SENT');
    expect(await payBySession(invC, 'C08', 100)).toMatchObject({ ok: true });
    const original = await db.payment.findUnique({ where: { providerPaymentId: `${P}cs_C08` } });
    expect(original).toMatchObject({ businessId: ID.bizC, provider: 'stripe', status: 'SUCCESSFUL', reference: `${P}pi_C08` });
    await expectLedgerAgrees(invC, 100);

    const invB = await makeInvoice(ID.bizB, 'c08_b', 'SENT');
    const res = await recordPaymentCall(ID.ownerB, ID.bizB, invB, { amount: 1, method: 'stripe', reference: `${P}pi_C08` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [hand] = await paymentsOf(invB);

    const bBefore = await stateOf(ID.bizB);
    expect(await refundCreated('C08', 100)).toMatchObject({ ok: true });
    // RED-BEFORE: null. B's hand row (provider 'stripe', reference C's pi_)
    // matched too, so the door refused the refund as ambiguous: C's books never
    // showed it.
    const refundRow = await db.payment.findUnique({ where: { providerPaymentId: `${P}re_C08` } });
    expect(refundRow).toMatchObject({ businessId: ID.bizC, invoiceId: invC, provider: 'stripe', status: 'REFUNDED', reference: `${P}cs_C08` });
    expect(Number(refundRow.amount)).toBe(-100);
    expect(await postingsOf(original.id)).toEqual(['INCOME:REVERSED:100', 'REVERSAL:POSTED:100']);
    await expectLedgerAgrees(invC, 0);
    expect(await stateOf(ID.bizB)).toEqual(bBefore);

    // RED-BEFORE: provider 'stripe'. The method is kept, so the receipt still
    // posts to the payment-processor account exactly as it did.
    expect(hand).toMatchObject({ businessId: ID.bizB, status: 'SUCCESSFUL', provider: 'manual', method: 'stripe', reference: `${P}pi_C08`, recordedBy: ID.ownerB });
    expect(await depositAccountOf(hand.id)).toBe('PAYMENT_PROCESSOR');
  });

  it("D46-C09: KEY processPayment (no req.user, actor KEY_SYSTEM_ACTOR_ID) on A's invoice with method 'stripe' and C's pi_: stored provider 'manual', posted to PAYMENT_PROCESSOR; C's platform-signed refund is recorded in C; A is byte-identical", async () => {
    const invC = await makeInvoice(ID.bizC, 'c09_c', 'SENT');
    expect(await payBySession(invC, 'C09', 100)).toMatchObject({ ok: true });
    const original = await db.payment.findUnique({ where: { providerPaymentId: `${P}cs_C09` } });
    expect(original).toMatchObject({ businessId: ID.bizC, provider: 'stripe', status: 'SUCCESSFUL' });

    const invA = await makeInvoice(ID.bizA, 'c09_a', 'SENT');
    await keyAdapter.processPayment({ businessId: ID.bizA, invoiceId: invA, amount: 1, method: 'stripe', reference: `${P}pi_C09`, initiatedBy: ID.ownerA });
    const [keyRow] = await paymentsOf(invA);

    const aBefore = await stateOf(ID.bizA);
    expect(await refundCreated('C09', 100)).toMatchObject({ ok: true });
    // RED-BEFORE: null (refused as ambiguous; no -100 row in C).
    const refundRow = await db.payment.findUnique({ where: { providerPaymentId: `${P}re_C09` } });
    expect(refundRow).toMatchObject({ businessId: ID.bizC, invoiceId: invC, status: 'REFUNDED', reference: `${P}cs_C09` });
    expect(Number(refundRow.amount)).toBe(-100);
    expect(await postingsOf(original.id)).toEqual(['INCOME:REVERSED:100', 'REVERSAL:POSTED:100']);
    await expectLedgerAgrees(invC, 0);
    expect(await stateOf(ID.bizA)).toEqual(aBefore);

    // RED-BEFORE: provider 'stripe'.
    expect(keyRow).toMatchObject({ businessId: ID.bizA, status: 'SUCCESSFUL', provider: 'manual', method: 'stripe', reference: `${P}pi_C09`, recordedBy: keyActorId });
    expect(await depositAccountOf(keyRow.id)).toBe('PAYMENT_PROCESSOR');
  });

  it("D46-C10 controls (green before and after): owner A's 'PayPal' (the web option), 'PAYPAL' (the evidence confirm spelling), 'card', 'cash', 'bank_transfer' and 'other' are stored with provider = method and posted to the account they post to today", async () => {
    const inv = await makeInvoice(ID.bizA, 'c10', 'SENT', 1000);
    const expected: Array<[string, string, string]> = [
      // [method, stored provider, deposit account]
      ['PayPal', 'PayPal', 'PAYMENT_PROCESSOR'],
      ['PAYPAL', 'PAYPAL', 'PAYMENT_PROCESSOR'],
      ['card', 'card', 'PAYMENT_PROCESSOR'],
      ['cash', 'cash', 'CASH'],
      ['bank_transfer', 'bank_transfer', 'BANK'],
      ['other', 'other', 'CASH'],
    ];
    for (const [method] of expected) {
      const res = await recordPaymentCall(ID.ownerA, ID.bizA, inv, { amount: 1, method });
      expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(201);
    }
    const rows = await paymentsOf(inv);
    expect(rows.map((r) => [r.method, r.provider])).toEqual(expected.map(([m, p]) => [m, p]));
    for (const [i, row] of rows.entries()) {
      expect(await depositAccountOf(row.id), row.method).toBe(expected[i]![2]);
    }
    await expectLedgerAgrees(inv, expected.length);
  });

  it("D46-C10b: exactly 'stripe', 'paypal' and 'wipay' (the ingress providers) are accepted (201) and stored provider 'manual' with the method kept, posted to PAYMENT_PROCESSOR as before", async () => {
    const inv = await makeInvoice(ID.bizA, 'c10b', 'SENT', 1000);
    const methods = ['stripe', 'paypal', 'wipay'];
    for (const method of methods) {
      const res = await recordPaymentCall(ID.ownerA, ID.bizA, inv, { amount: 1, method });
      expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(201);
    }
    const rows = await paymentsOf(inv);
    // RED-BEFORE: provider = the method.
    expect(rows.map((r) => [r.method, r.provider])).toEqual(methods.map((m) => [m, 'manual']));
    for (const row of rows) {
      expect(await depositAccountOf(row.id), row.method).toBe('PAYMENT_PROCESSOR');
    }
    await expectLedgerAgrees(inv, methods.length);
  });
});

/**
 * W3-D46-CREATE-AND-RECURRING (V1-89, owner ruling D-46): the writes
 * FOLLOW3-A1 left out of the helper (census it.todo D46-S07 and D46-S08), as
 * WriteCase rows over the same fixtures. Schedules are seeded with a future
 * nextRunDate, so no run bills them unless a case asks.
 */
async function makeSchedule(tag: string, status = 'ACTIVE'): Promise<string> {
  const id = `${P}rec_${tag}`;
  await db.recurringInvoice.create({
    data: {
      id,
      businessId: ID.bizA,
      contactId: ID.contactA,
      name: `V81A schedule ${tag}`,
      frequency: 'MONTHLY',
      amount: TOTAL,
      currency: 'TTD',
      startDate: new Date('2026-01-01T00:00:00Z'),
      nextRunDate: new Date(Date.now() + 30 * 24 * 3600_000),
      status,
    },
  });
  return id;
}

async function scheduleOf(id: string): Promise<any> {
  return db.recurringInvoice.findUnique({ where: { id } });
}

const SCHEDULES = `/commerce/businesses/${ID.bizA}/recurring-invoices`;

/**
 * W3-D46-CREATE-AND-RECURRING review SEC-W3D46R-2 (D-64): every schedule
 * write answers the contact projected to these keys (toScheduleResponse);
 * the whole Contact row has 80+.
 */
const SCHEDULE_CONTACT_KEYS = ['businessId', 'email', 'firstName', 'id', 'lastName'];
function expectProjectedContact(res: request.Response) {
  expect(Object.keys(res.body.contact ?? {}).sort(), 'the schedule write answers the projected contact (review SEC-W3D46R-2)').toEqual(SCHEDULE_CONTACT_KEYS);
  expect(res.body.contact.id).toBe(ID.contactA);
}

const LATE_CASES: WriteCase[] = [
  {
    id: 'D46-S08',
    what: 'POST invoices {contactId, items}',
    subject: 'invoice',
    okStatus: 201,
    prepare: async (tag) => ({ notes: `${P}s08_${tag}` }),
    call: (actor, fx) =>
      as(actor, agent().post(`/commerce/businesses/${ID.bizA}/invoices`)).send({
        contactId: ID.contactA,
        items: [{ description: 'V81A S08 line', quantity: 1, unitPrice: TOTAL }],
        notes: fx.notes,
      }),
    admitted: async (fx, res) => {
      const rows = await db.invoice.findMany({ where: { businessId: ID.bizA, notes: fx.notes } });
      expect(rows.map((r: any) => [r.id, r.status, r.contactId, Number(r.total)])).toEqual([[res.body.id, 'DRAFT', ID.contactA, TOTAL]]);
    },
  },
  {
    id: 'D46-S07a',
    what: 'POST recurring-invoices {contactId, name, frequency, amount, dates}',
    subject: 'invoice',
    okStatus: 201,
    prepare: async (tag) => ({ name: `${P}s07a_${tag}` }),
    call: (actor, fx) =>
      as(actor, agent().post(SCHEDULES)).send({
        contactId: ID.contactA,
        name: fx.name,
        frequency: 'MONTHLY',
        amount: TOTAL,
        startDate: '2026-01-01T00:00:00Z',
        nextRunDate: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
      }),
    admitted: async (fx, res) => {
      const rows = await db.recurringInvoice.findMany({ where: { businessId: ID.bizA, name: fx.name } });
      expect(rows.map((r: any) => [r.id, r.status, r.contactId])).toEqual([[res.body.id, 'ACTIVE', ID.contactA]]);
      expectProjectedContact(res);
    },
  },
  {
    id: 'D46-S07b',
    what: 'PATCH recurring-invoices/:id {name}',
    subject: 'invoice',
    okStatus: 200,
    prepare: async (tag) => ({ rec: await makeSchedule(`s07b_${tag}`), name: `${P}s07b_renamed_${tag}` }),
    call: (actor, fx) => as(actor, agent().patch(`${SCHEDULES}/${fx.rec}`)).send({ name: fx.name }),
    admitted: async (fx, res) => {
      expect((await scheduleOf(fx.rec)).name).toBe(fx.name);
      expectProjectedContact(res);
    },
  },
  {
    id: 'D46-S07c',
    what: 'POST recurring-invoices/:id/pause',
    subject: 'invoice',
    okStatus: 201,
    prepare: async (tag) => ({ rec: await makeSchedule(`s07c_${tag}`) }),
    call: (actor, fx) => as(actor, agent().post(`${SCHEDULES}/${fx.rec}/pause`)).send({}),
    admitted: async (fx, res) => {
      expect((await scheduleOf(fx.rec)).status).toBe('PAUSED');
      expectProjectedContact(res);
    },
  },
  {
    id: 'D46-S07d',
    what: 'POST recurring-invoices/:id/resume',
    subject: 'invoice',
    okStatus: 201,
    prepare: async (tag) => ({ rec: await makeSchedule(`s07d_${tag}`, 'PAUSED') }),
    call: (actor, fx) => as(actor, agent().post(`${SCHEDULES}/${fx.rec}/resume`)).send({}),
    admitted: async (fx, res) => {
      expect((await scheduleOf(fx.rec)).status).toBe('ACTIVE');
      expectProjectedContact(res);
    },
  },
  {
    id: 'D46-S07e',
    what: 'DELETE recurring-invoices/:id',
    subject: 'invoice',
    okStatus: 200,
    prepare: async (tag) => ({ rec: await makeSchedule(`s07e_${tag}`) }),
    call: (actor, fx) => as(actor, agent().delete(`${SCHEDULES}/${fx.rec}`)),
    admitted: async (fx, res) => {
      expect((await scheduleOf(fx.rec)).status).toBe('CANCELLED');
      expectProjectedContact(res);
    },
  },
];

describe('W3-D46-CREATE-AND-RECURRING (D-46): POST invoices and the recurring-invoice writes refuse a SUPER_ADMIN that is not a member of A, and nothing is written', () => {
  for (const c of LATE_CASES) {
    it(`${c.id}: ${c.what} by the non-member SUPER_ADMIN answers 403 'Not authorized to update this ${c.subject}'; A's invoices, schedules, payments, postings, ledger, Activity and BusinessEvent rows are byte-identical (D-46)`, async () => {
      const fx = await c.prepare('saNon');
      const before = await stateOf(ID.bizA);
      const jobsBefore = auditJobs.length;
      const res = await c.call(ID.saNon, fx);
      // RED-BEFORE: 201/200 and the invoice or schedule written in A.
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.message).toBe(`Not authorized to update this ${c.subject}`);
      expect(await stateOf(ID.bizA)).toEqual(before);
      expect(auditJobs.slice(jobsBefore)).toEqual([]);
    });

    it(`${c.id} (A2 rule, D-46): a SUPER_ADMIN whose membership in A holds revenue:read (STAFF default) or an explicit revenue:'none' gets the guard's 403 'Insufficient permissions'; A is byte-identical`, async () => {
      for (const [actor, level] of BELOW_WRITE) {
        const fx = await c.prepare(actor.slice(P.length));
        const before = await stateOf(ID.bizA);
        const res = await c.call(actor, fx);
        expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(res.body.message, actor).toBe(`Insufficient permissions: revenue requires write access (you have ${level})`);
        expect(await stateOf(ID.bizA), actor).toEqual(before);
      }
    });

    it(`${c.id} control: owner A and a SUPER_ADMIN that is an ADMIN member of A are admitted (${c.okStatus}) and do the write`, async () => {
      for (const actor of [ID.ownerA, ID.saAdminA]) {
        const fx = await c.prepare(`ok_${actor.slice(P.length)}`);
        const res = await c.call(actor, fx);
        expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(c.okStatus);
        await c.admitted(fx, res);
      }
    });

    it(`${c.id} control: a non-member USER (owner B on A) is refused by BusinessGuard (403 No access to this business); A is byte-identical`, async () => {
      const fx = await c.prepare('ownerB');
      const before = await stateOf(ID.bizA);
      const res = await c.call(ID.ownerB, fx);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.message).toBe('No access to this business');
      expect(await stateOf(ID.bizA)).toEqual(before);
    });
  }

  it('D46-S07 control (D-46): the recurring run acts as the system, not as a SUPER_ADMIN: a due schedule the SUPER_ADMIN ADMIN member of A created over HTTP is billed (one SENT invoice in A on its contact) and advances', async () => {
    const due = new Date(Date.now() - 60_000);
    const res = await as(ID.saAdminA, agent().post(SCHEDULES)).send({
      contactId: ID.contactA,
      name: `${P}s07_run`,
      frequency: 'MONTHLY',
      amount: 75,
      startDate: '2026-01-01T00:00:00Z',
      nextRunDate: due.toISOString(),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const result = await recurringRunner(ID.bizA).processRecurringInvoices();
    expect(result.map((r: any) => r.recurringId)).toEqual([res.body.id]);
    const billed = await db.invoice.findMany({ where: { recurringInvoiceId: res.body.id }, select: { businessId: true, contactId: true, status: true, total: true } });
    expect(billed.map((i: any) => [i.businessId, i.contactId, i.status, Number(i.total)])).toEqual([[ID.bizA, ID.contactA, 'SENT', 75]]);
    const schedule = await scheduleOf(res.body.id);
    expect(schedule.generatedCount).toBe(1);
    expect(schedule.nextRunDate.getTime()).toBeGreaterThan(due.getTime());
  });
});

/**
 * W4-TRASH-D46 (owner ruling D-46; review SEC-W3D46R-3, census it.todo D46-S09):
 * TrashController restored and permanently deleted recurringInvoice rows behind
 * BusinessGuard alone (its @RequireModuleScope('settings') has no
 * ModuleScopeGuard), so a non-member SUPER_ADMIN and a revenue:read member
 * brought a trashed ACTIVE schedule back (it then billed again) or erased it.
 * Trashed schedules here are ACTIVE and due (nextRunDate in the past), so a
 * restore would bill on the next run; the controls use a schedule that is not due.
 */
const TRASH = `/api/businesses/${ID.bizA}/trash`;

/** A trashed (soft-deleted) ACTIVE schedule of A; `due` puts its nextRunDate in the past. */
async function makeTrashedSchedule(tag: string, due: boolean): Promise<string> {
  const id = await makeSchedule(tag);
  await db.recurringInvoice.update({
    where: { id },
    data: { deletedAt: new Date(), ...(due ? { nextRunDate: new Date(Date.now() - 60_000) } : {}) },
  });
  return id;
}

/** A trashed invoice or quote of A (raw: the client's soft-delete extension hides the row from its own reads). */
async function trashDocument(table: 'invoices' | 'quotes', id: string) {
  await db.$executeRawUnsafe(`UPDATE ${table} SET deleted_at = now() WHERE id = $1`, id);
}

/** The real recurring run over A bills nothing from these schedules, which stay trashed. */
async function expectNeverBilled(ids: string[]) {
  const result = await recurringRunner(ID.bizA).processRecurringInvoices();
  for (const id of ids) {
    expect(result.map((r: any) => r.recurringId), id).not.toContain(id);
    const billed: Array<{ n: number }> = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM invoices WHERE recurring_invoice_id = $1', id);
    expect(billed[0]!.n, `${id}: invoices billed`).toBe(0);
    const row = await scheduleOf(id);
    expect(row, id).not.toBeNull();
    expect(row.deletedAt, `${id} stays in the trash`).not.toBeNull();
    expect(row.generatedCount, id).toBe(0);
  }
}

const trashRestore = (actor: string, model: string, id: string) => as(actor, agent().post(`${TRASH}/${model}/${id}/restore`)).send({});
const trashDelete = (actor: string, model: string, id: string) => as(actor, agent().delete(`${TRASH}/${model}/${id}`));

describe('W4-TRASH-D46 (D-46, D46-S09): trash restore and permanent delete of revenue records hold D-46 and revenue:write', () => {
  it("D46-S09a (D-46): POST trash/recurringInvoice/:id/restore by the non-member SUPER_ADMIN answers 403 'Not authorized to update this invoice'; A is byte-identical and the due schedule never bills on that call", async () => {
    const rec = await makeTrashedSchedule('s09a', true);
    const before = await stateOf(ID.bizA);
    const jobsBefore = auditJobs.length;
    const res = await trashRestore(ID.saNon, 'recurringInvoice', rec);
    // RED-BEFORE: 201 and the row back {status ACTIVE, deletedAt null}, billed on the next run.
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.message).toBe('Not authorized to update this invoice');
    expect(await stateOf(ID.bizA)).toEqual(before);
    expect(auditJobs.slice(jobsBefore)).toEqual([]);
    await expectNeverBilled([rec]);
  });

  it("D46-S09b (D-46): DELETE trash/recurringInvoice/:id by the non-member SUPER_ADMIN answers 403 'Not authorized to update this invoice'; the schedule is still there and A is byte-identical", async () => {
    const rec = await makeTrashedSchedule('s09b', true);
    const before = await stateOf(ID.bizA);
    const jobsBefore = auditJobs.length;
    const res = await trashDelete(ID.saNon, 'recurringInvoice', rec);
    // RED-BEFORE: 200 and the row gone.
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.message).toBe('Not authorized to update this invoice');
    expect(await stateOf(ID.bizA)).toEqual(before);
    expect(auditJobs.slice(jobsBefore)).toEqual([]);
    expect(await scheduleOf(rec)).not.toBeNull();
  });

  it("D46-S09c (D-46, revenue:write): a revenue:read member of A (USER, STAFF default) gets the guard's 403 'Insufficient permissions' on restore and on permanent delete of a trashed schedule; A is byte-identical and the schedule never bills on their call", async () => {
    const rec = await makeTrashedSchedule('s09c', true);
    for (const call of [trashRestore, trashDelete]) {
      const before = await stateOf(ID.bizA);
      const res = await call(ID.staffReadA, 'recurringInvoice', rec);
      // RED-BEFORE: 201 (restored ACTIVE) / 200 (erased).
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.message).toBe('Insufficient permissions: revenue requires write access (you have read)');
      expect(await stateOf(ID.bizA)).toEqual(before);
    }
    await expectNeverBilled([rec]);
  });

  it("D46-S09d (D-46, A2 rule): a SUPER_ADMIN whose membership in A holds revenue:read (STAFF default) or an explicit revenue:'none' gets the guard's 403 'Insufficient permissions' on restore and on permanent delete; A is byte-identical and the schedule never bills on their call", async () => {
    const rec = await makeTrashedSchedule('s09d', true);
    for (const [actor, level] of BELOW_WRITE) {
      for (const call of [trashRestore, trashDelete]) {
        const before = await stateOf(ID.bizA);
        const res = await call(actor, 'recurringInvoice', rec);
        expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(res.body.message, actor).toBe(`Insufficient permissions: revenue requires write access (you have ${level})`);
        expect(await stateOf(ID.bizA), actor).toEqual(before);
      }
    }
    await expectNeverBilled([rec]);
  });

  it("D46-S09e (D-46): the trash's other revenue models: restore and permanent delete of a trashed invoice and quote by the non-member SUPER_ADMIN answer 403 'Not authorized to update this invoice|quote' before any lookup; A is byte-identical", async () => {
    const inv = await makeInvoice(ID.bizA, 's09e', 'SENT');
    const quote = await makeQuote(ID.bizA, 's09e');
    await trashDocument('invoices', inv);
    await trashDocument('quotes', quote);
    for (const [model, id, subject] of [['invoice', inv, 'invoice'], ['quote', quote, 'quote']] as const) {
      for (const call of [trashRestore, trashDelete]) {
        const before = await stateOf(ID.bizA);
        const res = await call(ID.saNon, model, id);
        // RED-BEFORE: 404 'Trashed ... not found' (a lookup ran for the non-member).
        expect(res.status, `${model}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(res.body.message, model).toBe(`Not authorized to update this ${subject}`);
        expect(await stateOf(ID.bizA), model).toEqual(before);
      }
    }
  });

  it('D46-S09 control (D-46): owner A and a SUPER_ADMIN that is an ADMIN member of A restore a trashed schedule (201, back in its stored status) and permanently delete another (200, gone)', async () => {
    for (const actor of [ID.ownerA, ID.saAdminA]) {
      const tag = actor.slice(P.length);
      const kept = await makeTrashedSchedule(`s09ok_r_${tag}`, false);
      const restored = await trashRestore(actor, 'recurringInvoice', kept);
      expect(restored.status, `${actor}: ${JSON.stringify(restored.body)}`).toBe(201);
      expect(restored.body).toMatchObject({ restored: true, model: 'recurringInvoice', id: kept });
      const row = await scheduleOf(kept);
      expect([row.deletedAt, row.status], actor).toEqual([null, 'ACTIVE']);

      const gone = await makeTrashedSchedule(`s09ok_d_${tag}`, false);
      const deleted = await trashDelete(actor, 'recurringInvoice', gone);
      expect(deleted.status, `${actor}: ${JSON.stringify(deleted.body)}`).toBe(200);
      expect(deleted.body).toEqual({ deleted: true, model: 'recurringInvoice', id: gone });
      expect(await scheduleOf(gone), actor).toBeNull();
    }
  });

  it('D46-S09 control: a non-member USER (owner B on A) is refused by BusinessGuard (403 No access to this business); A is byte-identical', async () => {
    const rec = await makeTrashedSchedule('s09_ownerB', true);
    for (const call of [trashRestore, trashDelete]) {
      const before = await stateOf(ID.bizA);
      const res = await call(ID.ownerB, 'recurringInvoice', rec);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.message).toBe('No access to this business');
      expect(await stateOf(ID.bizA)).toEqual(before);
    }
  });
});

/**
 * W4-TRASH-D46 review repair SEC-TRASH-D46-1 (revenue:read; owner ruling D-46
 * rules writes only): GET api/businesses/:b/trash ran behind BusinessGuard
 * alone (its @RequireModuleScope('settings') has no ModuleScopeGuard), so a
 * member whose revenue level is 'none' read whole invoice, quote and schedule
 * rows (amount, contactId, metadata, lastError) that GET recurring-invoices,
 * invoices and quotes refuse that member (revenue:read). The listing now
 * applies ModuleScopeGuard's revenue:read rule to the revenue models: a model
 * filter naming one refuses with the guard's message, and the every-model
 * listing leaves those models out for that caller. A SUPER_ADMIN keeps
 * ModuleScopeGuard's read admission (D-46 is about writes).
 *
 * Two pre-existing listing defects, outside this repair, shape the cases:
 * ?model=invoice|quote lists the business's LIVE rows (the client's
 * soft-delete extension overwrites the handler's deletedAt filter with null
 * for Invoice and Quote), and the every-model listing answers 500 for every
 * caller (queryModel('opportunity') filters on businessId, which Opportunity
 * does not have: it names its business posterBusinessId). The every-model
 * omission was therefore proven in the unit half
 * (src/modules/commerce/d46-write-routes.spec.ts D46-S09g) and its HTTP half
 * was an it.todo here.
 *
 * W5-TRASH-LIST-500 (D46-S09g) makes the HTTP half live: the every-model
 * listing scopes Opportunity by posterBusinessId and answers 200, and it lists
 * trashed records only (a model the soft-delete extension rewrites to
 * deletedAt null answers live rows, which are not trash). Trashed opportunities
 * of A and B and a live one of A are the fixtures that tell the scoping apart.
 *
 * W5-TRASH-LIST-500 review repair SEC-TL500-2 (D46-S09i, below) closes the
 * first defect too: ?model= lists trashed rows only, so ?model=invoice|quote
 * lists none of A's live rows. The D46-S09 control below therefore no longer
 * expects an invoice or quote row there: it asserted the live rows the defect
 * listed (A's trashed invoice and quote stay unreadable, the D46-S09g
 * follow-up it.todo).
 */
const trashList =(actor: string, model?: string) => as(actor, agent().get(model ? `${TRASH}?model=${model}` : TRASH));
const REVENUE_TRASH_MODELS = ['recurringInvoice', 'invoice', 'quote'] as const;

/** W5-TRASH-LIST-500 (D46-S09g): an opportunity posted by `biz`, trashed unless `live`. */
async function makeOpportunity(biz: string, tag: string, live = false): Promise<string> {
  const id = `${P}opp_${tag}`;
  await db.opportunity.create({
    data: { id, posterBusinessId: biz, title: `V81A ${tag}`, description: `V81A ${tag}`, ...(live ? {} : { deletedAt: new Date() }) },
  });
  return id;
}

describe('W4-TRASH-D46 review repair SEC-TRASH-D46-1 (revenue:read): the trash listing of revenue records holds revenue:read', () => {
  const fx = { recurringInvoice: '', invoice: '', quote: '', oppA: '', oppLiveA: '', oppB: '' };

  beforeAll(async () => {
    fx.recurringInvoice = await makeTrashedSchedule('s09fg', false);
    fx.invoice = await makeInvoice(ID.bizA, 's09fg', 'SENT');
    fx.quote = await makeQuote(ID.bizA, 's09fg');
    await trashDocument('invoices', fx.invoice);
    await trashDocument('quotes', fx.quote);
    // W5-TRASH-LIST-500 (D46-S09g)
    fx.oppA = await makeOpportunity(ID.bizA, 's09g_trashedA');
    fx.oppLiveA = await makeOpportunity(ID.bizA, 's09g_liveA', true);
    fx.oppB = await makeOpportunity(ID.bizB, 's09g_trashedB');
  });

  it("D46-S09f (SEC-TRASH-D46-1, revenue:read): GET trash?model=recurringInvoice|invoice|quote by a USER ADMIN member of A whose scope map holds revenue:'none' answers the guard's 403 'Insufficient permissions: revenue requires read access (you have none)', as GET recurring-invoices, invoices and quotes answer that member; no row in the body", async () => {
    for (const path of ['recurring-invoices', 'invoices', 'quotes']) {
      const direct = await as(ID.userNoneA, agent().get(`/commerce/businesses/${ID.bizA}/${path}`));
      expect(direct.status, `${path}: ${JSON.stringify(direct.body)}`).toBe(403);
      expect(direct.body.message, path).toBe('Insufficient permissions: revenue requires read access (you have none)');
    }
    for (const model of REVENUE_TRASH_MODELS) {
      const res = await trashList(ID.userNoneA, model);
      // RED-BEFORE: 200 { items, total, model }: the trashed schedule (amount, contactId, metadata,
      // lastError), and for invoice and quote A's live rows (the soft-delete extension, above).
      expect(res.status, `${model}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body.message, model).toBe('Insufficient permissions: revenue requires read access (you have none)');
      expect(res.body.items, model).toBeUndefined();
      expect(JSON.stringify(res.body), model).not.toContain(fx[model]);
    }
  });

  /** Every listed item is A's trashed record: a row of A (businessId, or posterBusinessId for Opportunity) with deletedAt set. */
  function expectOnlyTrashOfA(body: any, label: string) {
    for (const item of body.items) {
      const key = `${label} ${item._model}:${item.id}`;
      expect(item.deletedAt, `${key} is trash, not a live row`).not.toBeNull();
      expect(item._model === 'opportunity' ? item.posterBusinessId : item.businessId, key).toBe(ID.bizA);
    }
  }

  // W5-TRASH-LIST-500: the it.todo D46-S09g HTTP half made live.
  it("D46-S09g (W5-TRASH-LIST-500, SEC-TRASH-D46-1, HTTP half): GET trash (every model) by that member answers 200 with no invoice, quote or recurringInvoice item; A's trashed opportunity is listed (scoped by posterBusinessId), A's live one and B's trashed one are not", async () => {
    const res = await trashList(ID.userNoneA);
    // RED-BEFORE: 500 for every caller (queryModel('opportunity') filtered on businessId).
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(200);
    const models = new Set(res.body.items.map((i: any) => i._model));
    for (const model of REVENUE_TRASH_MODELS) expect(models.has(model), model).toBe(false);
    const ids = res.body.items.map((i: any) => i.id);
    expect(ids).toContain(fx.oppA);
    for (const id of [fx.oppLiveA, fx.oppB, fx.recurringInvoice, fx.invoice, fx.quote]) expect(ids, id).not.toContain(id);
    expectOnlyTrashOfA(res.body, 'userNoneA');
    expect(res.body.total).toBe(res.body.items.length);
  });

  it("D46-S09g control (W5-TRASH-LIST-500): GET trash (every model) by owner A, a revenue:read STAFF member and the non-member SUPER_ADMIN answers 200 with A's trashed schedule and trashed opportunity, every item a trashed record of A (no live row, no row of B)", async () => {
    for (const actor of [ID.ownerA, ID.staffReadA, ID.saNon]) {
      const res = await trashList(actor);
      // RED-BEFORE: 500 for every caller (queryModel('opportunity') filtered on businessId).
      expect(res.status, `${actor}: ${JSON.stringify(res.body).slice(0, 500)}`).toBe(200);
      const listed = res.body.items.map((i: any) => `${i._model}:${i.id}`);
      expect(listed, actor).toContain(`recurringInvoice:${fx.recurringInvoice}`);
      expect(listed, actor).toContain(`opportunity:${fx.oppA}`);
      for (const id of [fx.oppLiveA, fx.oppB]) expect(listed, `${actor} ${id}`).not.toContain(`opportunity:${id}`);
      expectOnlyTrashOfA(res.body, actor);
      expect(res.body.total, actor).toBe(res.body.items.length);
    }
  });

  it.todo(
    "D46-S09g follow-up (W5-TRASH-LIST-500): GET trash (every model) by owner A lists A's trashed invoice and quote. " +
      'Blocked outside this write set: the client soft-delete extension (packages/db/src/client.ts softDelete list: Contact, ' +
      'Product, Quote, Invoice, StaffMember, Service, Booking, SocialPost, Project, ProjectTask, Site) rewrites the trash ' +
      "filter to deletedAt null on findMany, count and findFirst, so trash.controller cannot read those models' trashed rows; " +
      'the listing now leaves their live rows out instead of presenting them as trash. Needs a soft-delete opt-out in packages/db.',
  );

  it('D46-S09 control (SEC-TRASH-D46-1): owner A, a revenue:read STAFF member and the non-member SUPER_ADMIN (ModuleScopeGuard admits a SUPER_ADMIN to reads; D-46 rules writes) keep 200 on GET trash?model=recurringInvoice|invoice|quote, the trashed schedule listed and every row of A', async () => {
    for (const actor of [ID.ownerA, ID.staffReadA, ID.saNon]) {
      for (const model of REVENUE_TRASH_MODELS) {
        const res = await trashList(actor, model);
        expect(res.status, `${actor} ${model}: ${JSON.stringify(res.body)}`).toBe(200);
        expect(res.body.model, `${actor} ${model}`).toBe(model);
        // W5-TRASH-LIST-500 review repair SEC-TL500-2 (D46-S09i): every row listed is a trashed row of A.
        // The non-empty check for invoice and quote is gone: the rows it found were A's LIVE invoices and
        // quotes (the soft-delete defect described above); recurringInvoice keeps it below (the trashed schedule).
        for (const item of res.body.items) {
          expect(item.businessId, `${actor} ${model} ${item.id}`).toBe(ID.bizA);
          expect(item.deletedAt, `${actor} ${model} ${item.id} is trash, not a live row`).not.toBeNull();
        }
      }
      const schedules = await trashList(actor, 'recurringInvoice');
      expect(schedules.body.items.map((i: any) => i.id), actor).toContain(fx.recurringInvoice);
    }
  });

  it('D46-S09 control (SEC-TRASH-D46-1): a non-member USER (owner B on A) is refused the listing by BusinessGuard (403 No access to this business)', async () => {
    for (const model of [undefined, ...REVENUE_TRASH_MODELS]) {
      const res = await trashList(ID.ownerB, model);
      expect(res.status, `${String(model)}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body.message, String(model)).toBe('No access to this business');
    }
  });
});

/**
 * W5-TRASH-LIST-500 review repair (owner ruling D-46 unchanged; review
 * SEC-TL500-1, CR-TL500-1, SEC-TL500-2):
 *
 *   D46-S09h  D46-S09g lists A's trashed opportunities, but POST
 *             trash/opportunity/:id/restore and DELETE trash/opportunity/:id
 *             looked the row up with { id, businessId, deletedAt }, which
 *             Opportunity does not have (posterBusinessId): 500 for every
 *             caller and the row unchanged, while the web Trash page, which
 *             ignores the error, dropped the row as if it were done. The lookup
 *             now uses the listing's filter; it is the only tenant check, as the
 *             write keys on the id alone.
 *             RED-BEFORE: 500 on restore and delete. GREEN-AFTER: 201 / 200 on
 *             A's trashed opportunity; 404 on B's (through A's trash) and on
 *             A's live one, both unchanged.
 *   D46-S09i  ?model= listed the LIVE rows of the models the client's
 *             soft-delete extension covers (Contact, Invoice, Quote and eight
 *             more): ?model=contact showed every live contact, PRIVATE ones of
 *             other members included, to a member whose crm scope is 'none',
 *             and restore and delete acted on those live rows (DELETE
 *             soft-deleted a live contact or invoice). Every trash read and
 *             lookup now carries a filter the extension cannot overwrite.
 *             RED-BEFORE: the live rows listed (total counting them); DELETE
 *             200 and the live row trashed. GREEN-AFTER: no live row listed;
 *             404 'Trashed <model> not found' and the row unchanged.
 */
describe('W5-TRASH-LIST-500 review repair (D46-S09h, D46-S09i): an opportunity in the trash is restored and deleted, and the trash neither lists nor acts on a live row', () => {
  /** USER, STAFF member of A whose crm, settings, expenses and revenue scopes are 'none'. */
  const NO_SCOPE = `${P}noScopeA`;
  const fx = { restoreA: '', deleteA: '', liveA: '', trashedB: '', privateContact: `${P}contact_s09i_private`, liveInvoice: '', liveQuote: '' };

  beforeAll(async () => {
    await db.user.create({ data: { id: NO_SCOPE, email: `${P}noscopea@test.local`, name: NO_SCOPE, role: 'USER' } });
    await db.membership.create({
      data: {
        id: `${NO_SCOPE}_m`,
        userId: NO_SCOPE,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { crm: 'none', settings: 'none', expenses: 'none', revenue: 'none' },
      },
    });
    fx.restoreA = await makeOpportunity(ID.bizA, 's09h_restoreA');
    fx.deleteA = await makeOpportunity(ID.bizA, 's09h_deleteA');
    fx.liveA = await makeOpportunity(ID.bizA, 's09h_liveA', true);
    fx.trashedB = await makeOpportunity(ID.bizB, 's09h_trashedB');
    await db.contact.create({
      data: {
        id: fx.privateContact,
        businessId: ID.bizA,
        firstName: 'V81a',
        lastName: 'Private',
        email: `${P}contact_s09i_private@test.local`,
        ownerId: ID.ownerA,
        visibility: 'PRIVATE',
      },
    });
    fx.liveInvoice = await makeInvoice(ID.bizA, 's09i_live', 'SENT');
    fx.liveQuote = await makeQuote(ID.bizA, 's09i_live');
  });

  /** The stored row as JSON, raw (the client hides a soft-deleted contact, invoice or quote; contacts carry a tsvector). */
  const rowOf = async (table: string, id: string): Promise<any[]> => {
    const rows: Array<{ j: string }> = await db.$queryRawUnsafe(`SELECT row_to_json(t)::text AS j FROM ${table} t WHERE t.id = $1`, id);
    return rows.map((r) => JSON.parse(r.j));
  };

  it("D46-S09h (W5-TRASH-LIST-500 repair SEC-TL500-1, CR-TL500-1): owner A restores A's trashed opportunity (201, deletedAt cleared, out of the trash listing) and permanently deletes another (200, the row gone)", async () => {
    const restored = await trashRestore(ID.ownerA, 'opportunity', fx.restoreA);
    // RED-BEFORE: 500 (PrismaClientValidationError: Unknown argument `businessId`), the row still trashed.
    expect(restored.status, JSON.stringify(restored.body).slice(0, 500)).toBe(201);
    expect(restored.body).toMatchObject({ restored: true, model: 'opportunity', id: fx.restoreA });
    const [row] = await rowOf('community_opportunities', fx.restoreA);
    expect([row.deleted_at, row.poster_business_id]).toEqual([null, ID.bizA]);

    const deleted = await trashDelete(ID.ownerA, 'opportunity', fx.deleteA);
    // RED-BEFORE: 500, the row still there and trashed.
    expect(deleted.status, JSON.stringify(deleted.body).slice(0, 500)).toBe(200);
    expect(deleted.body).toEqual({ deleted: true, model: 'opportunity', id: fx.deleteA });
    expect(await rowOf('community_opportunities', fx.deleteA)).toEqual([]);

    for (const model of [undefined, 'opportunity']) {
      const listed = await trashList(ID.ownerA, model);
      expect(listed.status, String(model)).toBe(200);
      const ids = listed.body.items.map((i: any) => i.id);
      expect(ids, String(model)).not.toContain(fx.restoreA);
      expect(ids, String(model)).not.toContain(fx.deleteA);
    }
  });

  it("D46-S09h tenancy (W5-TRASH-LIST-500 repair SEC-TL500-1): through A's trash, owner A's restore and permanent delete of B's trashed opportunity and of A's live one answer 404 'Trashed opportunity not found'; both rows are unchanged", async () => {
    const before = [await rowOf('community_opportunities', fx.trashedB), await rowOf('community_opportunities', fx.liveA)];
    for (const id of [fx.trashedB, fx.liveA]) {
      for (const call of [trashRestore, trashDelete]) {
        const res = await call(ID.ownerA, 'opportunity', id);
        // RED-BEFORE: 500 (the businessId lookup).
        expect(res.status, `${id}: ${JSON.stringify(res.body).slice(0, 500)}`).toBe(404);
        expect(res.body.message, id).toBe('Trashed opportunity not found');
      }
    }
    expect([await rowOf('community_opportunities', fx.trashedB), await rowOf('community_opportunities', fx.liveA)]).toEqual(before);
    expect(before[0][0].deleted_at).not.toBeNull();
    expect(before[1][0].deleted_at).toBeNull();
  });

  it("D46-S09i (W5-TRASH-LIST-500 repair SEC-TL500-2): GET trash?model=contact by a STAFF member of A whose crm, settings, expenses and revenue scopes are 'none' answers 200 with no live contact (A's contact and owner A's PRIVATE contact are not listed) and a total that counts none", async () => {
    const res = await trashList(NO_SCOPE, 'contact');
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(200);
    const ids = res.body.items.map((i: any) => i.id);
    // RED-BEFORE: [v81a_contactA (TEAM), v81a_contact_s09i_private (PRIVATE)], both live, total counting A's live contacts.
    for (const id of [ID.contactA, fx.privateContact]) expect(ids, id).not.toContain(id);
    for (const item of res.body.items) expect(item.deletedAt, item.id).not.toBeNull();
    expect(res.body.total).toBe(res.body.items.length);
  });

  it("D46-S09i (W5-TRASH-LIST-500 repair SEC-TL500-2): owner A's GET trash?model=invoice|quote|contact lists none of A's live invoices, quotes or contacts, and its total counts none", async () => {
    for (const [model, live] of [['invoice', fx.liveInvoice], ['quote', fx.liveQuote], ['contact', ID.contactA]] as const) {
      const res = await trashList(ID.ownerA, model);
      expect(res.status, `${model}: ${JSON.stringify(res.body).slice(0, 500)}`).toBe(200);
      // RED-BEFORE: A's live rows listed as trash.
      expect(res.body.items.map((i: any) => i.id), model).not.toContain(live);
      for (const item of res.body.items) {
        expect(item.businessId, `${model} ${item.id}`).toBe(ID.bizA);
        expect(item.deletedAt, `${model} ${item.id} is trash, not a live row`).not.toBeNull();
      }
      expect(res.body.total, model).toBe(res.body.items.length);
    }
  });

  it("D46-S09i (W5-TRASH-LIST-500 repair SEC-TL500-2): the trash does not act on a live row: that member's POST restore and DELETE of owner A's live PRIVATE contact, and owner A's POST restore and DELETE of A's live SENT invoice, answer 404 'Trashed contact|invoice not found'; both rows stay live and unchanged", async () => {
    for (const [actor, model, table, id] of [
      [NO_SCOPE, 'contact', 'contacts', fx.privateContact],
      [ID.ownerA, 'invoice', 'invoices', fx.liveInvoice],
    ] as const) {
      const before = await rowOf(table, id);
      expect(before[0].deleted_at, id).toBeNull();
      for (const call of [trashRestore, trashDelete]) {
        const res = await call(actor, model, id);
        // RED-BEFORE: DELETE 200 and the live row soft-deleted (restore 201 on the live row).
        expect(res.status, `${model} ${call === trashDelete ? 'delete' : 'restore'}: ${JSON.stringify(res.body).slice(0, 500)}`).toBe(404);
        expect(res.body.message, model).toBe(`Trashed ${model} not found`);
      }
      expect(await rowOf(table, id), id).toEqual(before);
    }
  });

  it.todo(
    "SEC-TL500-3 follow-up (W5-TRASH-LIST-500 review repair): GET trash (every model and ?model=) holds each listed model's own module scope, " +
      "or the declared settings scope, as SEC-TRASH-D46-1 does for revenue: a member with expenses and settings 'none' gets no trashed Expense " +
      'row (amounts) and no trashed opportunity. Not done here: no ruling says which module governs each trash model (account, staffMember, ' +
      'opportunity, community posts and comments, landing pages, ...), and enforcing settings (STAFF default none) would shut every STAFF member ' +
      'out of the trash, against the D46-S09, D46-S09f and D46-S09g controls. Needs an owner ruling.',
  );
});
