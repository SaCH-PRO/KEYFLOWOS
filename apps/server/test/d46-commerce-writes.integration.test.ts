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
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v81a_';
const HEADER = 'x-v81a-user';
const PLATFORM = `whsec_${P}platform`;
const TOTAL = 100;

const ID = {
  ownerA: `${P}ownerA`,
  saNon: `${P}saNon`, // SUPER_ADMIN, member of no business
  saAdminA: `${P}saAdminA`, // SUPER_ADMIN, ADMIN member of A (revenue:admin by default)
  saStaffA: `${P}saStaffA`, // SUPER_ADMIN, STAFF member of A (revenue:read by default)
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
let keyAdapter: any;
let keyActorId: string;
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
    `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

/** An ACCEPTED quote of `biz` (convertible). */
async function makeQuote(biz: string, tag: string): Promise<string> {
  docSeq += 1;
  const id = `${P}q_${tag}`;
  await db.quote.create({
    data: {
      id,
      quoteNumber: `V81A-Q${String(docSeq).padStart(4, '0')}`,
      status: 'ACCEPTED',
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
  const [invoices, quotes, payments, links, txns, entries, activities, events] = await Promise.all([
    // Raw: the client hides soft-deleted invoices and quotes, and a delete must show.
    db.$queryRawUnsafe('SELECT * FROM invoices WHERE business_id = $1 ORDER BY id', businessId),
    db.$queryRawUnsafe('SELECT * FROM quotes WHERE business_id = $1 ORDER BY id', businessId),
    db.payment.findMany({ where: { businessId }, ...byId }),
    db.paymentLink.findMany({ where: { businessId }, ...byId }),
    db.financialTransaction.findMany({ where: { businessId }, ...byId }),
    db.ledgerEntry.findMany({ where: { businessId }, ...byId }),
    db.activity.findMany({ where: { businessId }, ...byId }),
    db.businessEvent.findMany({ where: { businessId }, ...byId }),
  ]);
  return JSON.parse(JSON.stringify({ invoices, quotes, payments, links, txns, entries, activities, events }));
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

/** C's Stripe Checkout payment of `amount` (stored as cs_, its pi_ in reference). */
function payBySession(inv: string, n: string, amount: number) {
  return platformStripe(`evt_cs_${n}`, 'checkout.session.completed', {
    id: `${P}cs_${n}`, client_reference_id: inv, amount_total: amount * 100, currency: 'ttd', payment_intent: `${P}pi_${n}`, metadata: { invoiceId: inv },
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
  storedBalanceFn = workflowMod.balanceOfStoredRows;
  keyActorId = KEY_SYSTEM_ACTOR_ID;

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
  paymentsSvc = new PaymentsService(
    moduleRef.get(PrismaService),
    commerce,
    moduleRef.get(workflowMod.InvoiceWorkflowService),
    moduleRef.get(RevenuePostingService),
  );
  keyAdapter = new CommerceAdapterService(commerce);

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
});

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
