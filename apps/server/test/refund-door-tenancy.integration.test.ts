/**
 * V1-81 (FOLLOW3-A3-REFUND-DOOR-TENANCY): a Stripe refund event verified by
 * the deployment's own webhook secret is never booked into, or blocked by,
 * another tenant's hand-recorded or self-signed payment row (REAL database,
 * REAL ledger posting, REAL invoice workflow, REAL webhook dedupe).
 *
 * The refund door (PaymentsService.processStripeRefund) looks a platform-signed
 * refund up across every tenant: payments.service.ts read the original as the
 * oldest SUCCESSFUL provider 'stripe' row naming the charge or payment_intent,
 * in any business, and refused it only when a second business matched too.
 * Two kinds of rows can name another tenant's ids:
 *
 *   (a) a hand-recorded row: the manual payment route, KEY processPayment and
 *       the evidence confirm (CommerceService.recordPayment) store provider =
 *       the method typed ('stripe'), providerPaymentId 'manual_...', recordedBy
 *       the actor, and any reference. Such a row is no provider evidence (the
 *       V1-15d rule of payments-ops): it is never an original and never an
 *       ambiguity witness.
 *   (b) a self-signed row: a delivery a tenant signs with the webhook secret it
 *       sets for itself records any payment_intent in reference. Payment does
 *       not store which secret verified it, so the door asks the provider
 *       (owner ruling D-56): StripeConnector.isOwnCharge reads the charge, then
 *       the Checkout Session of its payment_intent, and the refund is booked
 *       only into the business the platform tagged.
 *
 * Contract pinned here (each case its own invoices):
 *
 *   RDT-01  (hand row as witness) A's Checkout payment cs_A1 (reference pi_A1);
 *           B holds a hand-recorded 'stripe' row naming pi_A1, seeded directly
 *           and posted. A platform-signed refund.created {ch_A1, pi_A1, 40}:
 *           RED-BEFORE refused as ambiguous (A has no -40 row, A's posting
 *           unchanged); GREEN-AFTER A gets one -40 REFUNDED row (reference
 *           cs_A1) and a REFUND posting, A's ledger cash net = balance net 60,
 *           and B's rows and ledger are byte-identical
 *   RDT-02  (hand row as the only match) A has no row naming ch_A2; B's hand
 *           'stripe' row (posted, PAID) names ch_A2. A platform-signed
 *           charge.refunded of 100: RED-BEFORE a -100 REFUNDED row on B's
 *           invoice and B's posting reversed; GREEN-AFTER nothing written in
 *           either tenant and the refusal is logged
 *   RDT-03  (self-signed checkout row, only match) B signs, with its own
 *           secret, a checkout.session.completed on its own invoice naming
 *           A's pi_A3; A has no row. A platform-signed refund.created of 100
 *           for ch_A3: RED-BEFORE B's invoice gets -100; GREEN-AFTER the
 *           platform's Checkout Session for pi_A3 names A, so nothing is
 *           written in B, the refusal is logged, and exactly one
 *           GET /v1/charges/ch_A3 plus the session read are made
 *   RDT-03b (self-signed row as witness, the "blocked by" half of the title)
 *           B's self-signed row and A's own Checkout row both name pi_A7 (B's
 *           is the older): RED-BEFORE A's platform refund is refused as
 *           ambiguous; GREEN-AFTER the provider's record binds it to A: one
 *           -30 row linked to cs_A7, B unchanged
 *   RDT-04  (control, R0-20b) a payment recorded through the legacy POST
 *           /webhooks/stripe (recordedBy null, its cs_ id) stays an eligible
 *           original: the platform refund.created delivered there is recorded
 *           in A, green before and after
 *   RDT-05  (critic control, V1-41b and KEY) B's KEY-recorded 'stripe' row
 *           naming pi_A6 and B's evidence-confirmed 'stripe' row naming ch_A6
 *           (both recordedBy set, manual_ ids) neither block nor take A's
 *           platform refund: RED-BEFORE refused as ambiguous; GREEN-AFTER A's
 *           -40 is recorded and B is byte-identical
 *   RDT-06  (control) a refund signed with A's own webhook secret for A's
 *           charge is recorded in A with no provider call, green before and
 *           after (PRD-05 / PRD-10 keep the tenant-secret contract)
 *   RDT-07  every v81c_ row is gone after cleanup
 *
 * Nothing on the boundary is mocked: PrismaService, PaymentsService (built by
 * Nest, so the StripeConnector it receives is the one the DI container wires),
 * StripeConnector, the legacy WebhooksController, CommerceService,
 * PaymentEvidenceService, InvoiceWorkflowService (webhook claims included),
 * RevenuePostingService, PostingService and ChartOfAccountsSeederService write
 * real rows. global fetch is a fake Stripe (accounts keyed by bearer key) that
 * records every call and refuses any other host: no provider traffic. The
 * Stripe SDK the legacy route builds is a stub whose constructEvent verifies
 * the signature as the SDK does. Stripe deliveries are signed with the
 * deployment's STRIPE_WEBHOOK_SECRET (set for this file only, restored after)
 * or with a business's own secret (business.metaData.stripeWebhookSecret).
 * EventEmitter2, EntityResolutionService, ExpensePostingService, the timeline,
 * the stats cache, CRM, AI, Gmail and Drive services are stubs off the boundary.
 *
 * Fixtures: prefix `v81c_` (registered in test/helpers/fixture-prefixes.json);
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

// The Stripe SDK the legacy WebhooksController builds is a stub (no provider
// traffic): constructEvent verifies t=<ts>,v1=<HMAC-SHA256(secret, `${t}.${payload}`)>
// as the SDK does and returns the parsed payload; anything else throws.
vi.mock('stripe', async () => {
  const { createHmac: hmac, timingSafeEqual } = await import('crypto');
  class Stripe {
    webhooks = {
      constructEvent: (payload: Buffer | string, header: string, secret: string) => {
        const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
        const parts = Object.fromEntries(String(header).split(',').map((p) => p.split('=').map((x) => x.trim())));
        const expected = Buffer.from(hmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex'));
        const given = Buffer.from(String(parts.v1 ?? ''));
        if (!parts.t || given.length !== expected.length || !timingSafeEqual(given, expected)) {
          throw new Error('No signatures found matching the expected signature for payload');
        }
        return JSON.parse(raw);
      },
    };
  }
  return { default: Stripe };
});

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v81c_';
const PLATFORM_KEY = `sk_test_${P}platform`;
const PLATFORM_WHSEC = `whsec_${P}platform`;
const SECRET_A = `whsec_${P}a`;
const SECRET_B = `whsec_${P}b`;
/** Mirrors KEY_SYSTEM_ACTOR_ID (src/core/auth/system-actor.ts); asserted equal below. */
const KEY_ACTOR = 'key_ai';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  invA1: `${P}invA1`,
  invB1: `${P}invB1`,
  invA2: `${P}invA2`,
  invB2: `${P}invB2`,
  invA3: `${P}invA3`,
  invB3: `${P}invB3`,
  invA4: `${P}invA4`,
  invA5: `${P}invA5`,
  invA6: `${P}invA6`,
  invB6: `${P}invB6`,
  invB6e: `${P}invB6e`,
  invA7: `${P}invA7`,
  invB7: `${P}invB7`,
};
const TENANT_B_INVOICES = new Set([ID.invB1, ID.invB2, ID.invB3, ID.invB6, ID.invB6e, ID.invB7]);

/** Stripe-shaped ids (the prefix inside, so every globally unique value carries it). */
const S = {
  csA1: `cs_${P}A1`, piA1: `pi_${P}A1`, chA1: `ch_${P}A1`, reA1: `re_${P}A1`,
  piA2: `pi_${P}A2`, chA2: `ch_${P}A2`, reA2: `re_${P}A2`,
  piA3: `pi_${P}A3`, chA3: `ch_${P}A3`, reA3: `re_${P}A3`, csBforged3: `cs_${P}Bforged3`,
  piA4: `pi_${P}A4`, chA4: `ch_${P}A4`, reA4: `re_${P}A4`,
  csA5: `cs_${P}A5`, piA5: `pi_${P}A5`, chA5: `ch_${P}A5`, reA5: `re_${P}A5`,
  csA6: `cs_${P}A6`, piA6: `pi_${P}A6`, chA6: `ch_${P}A6`, reA6: `re_${P}A6`,
  csA7: `cs_${P}A7`, piA7: `pi_${P}A7`, chA7: `ch_${P}A7`, reA7: `re_${P}A7`, csBforged7: `cs_${P}Bforged7`,
};

const TOTAL = 100;
const DEPOSIT_KEYS = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR']);

let db: any;
let app: any;
let redis: any;
let paymentsSvc: any;
let commerceSvc: any;
let evidenceSvc: any;
let revenuePostingSvc: any;
let workflowSvc: any;
let systemActorId: string;
let storedBalanceFn: (total: number, rows: Array<{ amount: number; status: string }>, currency?: string) => any;
let realFetch: typeof fetch;
const savedEnv: Record<string, string | undefined> = {};
const warnings: string[] = [];

const eventStub = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

// ---------------------------------------------------------------------------
// Fake Stripe (no network). Accounts are keyed by the bearer key.
// ---------------------------------------------------------------------------

interface Call { method: string; host: string; path: string; auth: string | null }
interface FakeCharge { id: string; object: 'charge'; amount: number; currency: string; payment_intent: string | null; metadata: Record<string, string> }
interface FakeSession {
  id: string; object: 'checkout.session'; status: 'complete'; payment_intent: string | null;
  client_reference_id: string | null; metadata: Record<string, string>; created: number;
}
interface FakeAccount { charges: FakeCharge[]; sessions: FakeSession[] }

const calls: Call[] = [];
const accounts: Record<string, FakeAccount> = {};
const now = () => Math.floor(Date.now() / 1000);

/**
 * A's customer paid A's invoice through createStripeCheckout on the platform
 * account: the session carries the platform's tag (metadata invoiceId +
 * businessId, client_reference_id), the charge carries none.
 */
function checkoutOnPlatform(invoiceId: string, cs: string, pi: string, ch: string, amountMinor: number) {
  const acct = accounts[PLATFORM_KEY];
  acct.sessions.push({
    id: cs, object: 'checkout.session', status: 'complete', payment_intent: pi, client_reference_id: invoiceId,
    metadata: { invoiceId, businessId: ID.bizA }, created: now(),
  });
  acct.charges.push({ id: ch, object: 'charge', amount: amountMinor, currency: 'ttd', payment_intent: pi, metadata: {} });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stripeApi(method: string, url: URL, auth: string | null): Response {
  const key = (auth ?? '').replace(/^Bearer\s+/, '');
  const acct = accounts[key];
  if (!acct) return json(401, { error: { message: 'Invalid API Key provided' } });
  const p = url.pathname;
  let m: RegExpMatchArray | null;
  if (method === 'GET' && (m = p.match(/^\/v1\/charges\/([^/]+)$/))) {
    const c = acct.charges.find((x) => x.id === decodeURIComponent(m![1]));
    return c ? json(200, c) : json(404, { error: { message: `No such charge: '${m[1]}'` } });
  }
  if (method === 'GET' && p === '/v1/checkout/sessions') {
    const pi = url.searchParams.get('payment_intent');
    const limit = Number(url.searchParams.get('limit') ?? '10');
    const rows = acct.sessions.filter((x) => pi === null || x.payment_intent === pi);
    return json(200, { object: 'list', data: [...rows].sort((a, b) => b.created - a.created).slice(0, limit) });
  }
  return json(400, { error: { message: `fake Stripe: unsupported ${method} ${p}` } });
}

async function fakeFetch(input: any, init: any = {}): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const method = String(init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers ?? {});
  calls.push({ method, host: url.host, path: `${url.pathname}${url.search}`, auth: headers.get('authorization') });
  if (url.host !== 'api.stripe.com') throw new Error(`v81c fake fetch: no network (${url.host})`);
  return stripeApi(method, url, headers.get('authorization'));
}

/** `METHOD host path` (no query) of every provider call since `mark`. */
function callsSince(mark: number): string[] {
  return calls.slice(mark).map((c) => `${c.method} ${c.host} ${c.path.split('?')[0]}`);
}

// ---------------------------------------------------------------------------
// Fixtures and readers
// ---------------------------------------------------------------------------

async function cleanup() {
  for (const sql of [
    `DELETE FROM webhook_events WHERE provider_event_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM connector_statuses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

/** A Stripe delivery, signed as Stripe signs it (the deployment's secret unless another is given). */
async function stripe(evt: string, type: string, object: Record<string, unknown>, secret = PLATFORM_WHSEC) {
  const raw = JSON.stringify({ id: `${P}evt_${evt}`, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const signature = `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
  return paymentsSvc.handleStripeWebhook(raw, signature);
}

/** The same delivery through the deprecated POST /webhooks/stripe (R0-20b), signed with the deployment's secret. */
function legacyStripe(evt: string, type: string, object: Record<string, unknown>) {
  const raw = JSON.stringify({ id: `${P}evt_${evt}`, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const signature = `t=${t},v1=${createHmac('sha256', PLATFORM_WHSEC).update(`${t}.${raw}`).digest('hex')}`;
  return request(app.getHttpServer()).post('/webhooks/stripe').set('content-type', 'application/json').set('stripe-signature', signature).send(raw);
}

/** A's Checkout payment, platform-signed (createStripeCheckout's session: stored as cs_, its pi_ in reference). */
function paySession(evt: string, inv: string, cs: string, pi: string, amount: number) {
  return stripe(evt, 'checkout.session.completed', {
    id: cs, client_reference_id: inv, amount_total: amount * 100, currency: 'ttd', payment_intent: pi, metadata: { invoiceId: inv, businessId: ID.bizA },
  });
}

/** refund.created as Stripe sends it: the Refund object, which carries no owner tag. */
function refundCreated(evt: string, re: string, ch: string, pi: string, amount: number) {
  return stripe(evt, 'refund.created', { id: re, object: 'refund', amount: amount * 100, currency: 'ttd', charge: ch, payment_intent: pi, status: 'succeeded' });
}

/** A hand-recorded 'stripe' row as CommerceService.recordPayment stored it before D-55 (legacy rows stay stored), posted by the ledger door. */
async function handRow(data: { businessId: string; invoiceId: string; providerPaymentId: string; reference: string; amount: number; recordedBy: string }) {
  const row = await db.payment.create({
    data: { ...data, currency: 'TTD', status: 'SUCCESSFUL', provider: 'stripe', method: 'stripe' },
  });
  await revenuePostingSvc.onPaymentRecorded(row.id, { createdById: data.recordedBy });
  await workflowSvc.reconcileFromPayments(data.invoiceId);
  return row;
}

async function invoiceRow(id: string): Promise<any> {
  return db.invoice.findUnique({ where: { id } });
}

async function paymentsOf(invoiceId: string): Promise<any[]> {
  return db.payment.findMany({ where: { invoiceId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

/** `provider:providerPaymentId:status:amount:reference`, in write order. */
async function rowsOf(invoiceId: string): Promise<string[]> {
  return (await paymentsOf(invoiceId)).map((r) => `${r.provider}:${r.providerPaymentId}:${r.status}:${Number(r.amount)}:${r.reference}`);
}

async function paymentBy(providerPaymentId: string): Promise<any> {
  return db.payment.findUnique({ where: { providerPaymentId } });
}

async function balanceOf(invoiceId: string) {
  const inv = await invoiceRow(invoiceId);
  const rows = await paymentsOf(invoiceId);
  return storedBalanceFn(Number(inv.total), rows.map((r) => ({ amount: Number(r.amount), status: r.status })), inv.currency);
}

/** `type:status:amount` of the transactions one payment sourced, in posting order. */
async function postingsOf(paymentId: string): Promise<string[]> {
  const txns = await db.financialTransaction.findMany({
    where: { sourceType: 'Payment', sourceId: paymentId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return txns.map((t: any) => `${t.type}:${t.status}:${Number(t.amount)}`);
}

/** A business's books, byte for byte: every payment row, transaction and ledger entry, and every invoice's status. */
async function booksOf(businessId: string) {
  const [payments, txns, entries, invoices] = await Promise.all([
    db.payment.findMany({ where: { businessId }, orderBy: { id: 'asc' } }),
    db.financialTransaction.findMany({ where: { businessId }, orderBy: { id: 'asc' } }),
    db.ledgerEntry.findMany({ where: { businessId }, orderBy: { id: 'asc' } }),
    db.invoice.findMany({ where: { businessId }, orderBy: { id: 'asc' }, select: { id: true, status: true, paidAt: true, updatedAt: true } }),
  ]);
  return JSON.parse(JSON.stringify({ payments, txns, entries, invoices }));
}

const money = (n: number) => Math.round(n * 100) / 100;
const sum = (rows: any[], key: string) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

/**
 * LEDGER: every transaction the invoice's payments sourced balances; their
 * deposit-side (cash) net equals the stored balance net (and `net`); each
 * REVERSAL's original is REVERSED; the tenant's trial balance balances.
 */
async function expectLedgerAgrees(invoiceId: string, net: number) {
  const inv = await invoiceRow(invoiceId);
  const rows = await paymentsOf(invoiceId);
  const txns = await db.financialTransaction.findMany({
    where: { businessId: inv.businessId, sourceType: 'Payment', sourceId: { in: rows.map((r) => r.id) } },
    include: { entries: { include: { account: { select: { systemKey: true } } } } },
  });
  for (const t of txns) {
    expect(money(sum(t.entries, 'debit')), `${invoiceId} ${t.externalRef}: debits = credits`).toBe(money(sum(t.entries, 'credit')));
  }
  const cashNet = money(
    txns
      .flatMap((t: any) => t.entries)
      .filter((e: any) => DEPOSIT_KEYS.has(e.account?.systemKey))
      .reduce((s: number, e: any) => s + Number(e.debit ?? 0) - Number(e.credit ?? 0), 0),
  );
  const balance = await balanceOf(invoiceId);
  expect(cashNet, `${invoiceId}: ledger cash net = balance net`).toBe(balance.net);
  expect(balance.net, `${invoiceId}: balance net`).toBe(net);
  for (const r of txns.filter((t: any) => t.type === 'REVERSAL')) {
    expect(txns.find((t: any) => t.id === r.reversalOfId)?.status, `${invoiceId}: the reversed original is REVERSED`).toBe('REVERSED');
  }
  const totals = await db.ledgerEntry.aggregate({ where: { businessId: inv.businessId }, _sum: { debit: true, credit: true } });
  expect(money(Number(totals._sum.debit ?? 0)), 'tenant trial balance').toBe(money(Number(totals._sum.credit ?? 0)));
}

/** The warnings PaymentsService logged since `mark` that name `id`. */
function warnedSince(mark: number, id: string): string[] {
  return warnings.slice(mark).filter((w) => w.includes(id));
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const IORedis = (await import('ioredis')).default;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { KEY_SYSTEM_ACTOR_ID } = await import('../src/core/auth/system-actor');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const workflowMod = await import('../src/modules/commerce/invoice-workflow.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  const { WebhooksController } = await import('../src/modules/webhooks/webhooks.controller');
  const { WebhookDispatcherService } = await import('../src/modules/webhooks/webhook-dispatcher.service');
  const { StripeConnector } = await import('../src/core/connectors/implementations/stripe.connector');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  storedBalanceFn = workflowMod.balanceOfStoredRows;
  systemActorId = KEY_SYSTEM_ACTOR_ID;

  // The deployment's Stripe key and webhook secret, for this file only (restored in afterAll).
  for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) savedEnv[k] = process.env[k];
  process.env.STRIPE_SECRET_KEY = PLATFORM_KEY;
  process.env.STRIPE_WEBHOOK_SECRET = PLATFORM_WHSEC;
  accounts[PLATFORM_KEY] = { charges: [], sessions: [] };
  realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch as unknown as typeof fetch;

  // The refusals the door logs (Logger.warn of every Nest logger, PaymentsService's included).
  const originalWarn = Logger.prototype.warn;
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(function (this: any, message: any, ...rest: any[]) {
    warnings.push(String(message));
    return originalWarn.call(this, message, ...rest);
  });

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [WebhooksController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      { provide: REDIS_CLIENT, useValue: redis },
      CommerceService,
      workflowMod.InvoiceWorkflowService,
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
      // The Stripe ledger door, built by the container with the real Stripe connector (D-56's read).
      PaymentsService,
      StripeConnector,
      { provide: EntityResolutionService, useValue: { resolveContact: async () => ({ contactId: undefined }) } },
      { provide: WebhookDispatcherService, useValue: {} },
    ],
  }).compile();
  paymentsSvc = moduleRef.get(PaymentsService);
  commerceSvc = moduleRef.get(CommerceService);
  evidenceSvc = moduleRef.get(PaymentEvidenceService);
  revenuePostingSvc = moduleRef.get(RevenuePostingService);
  workflowSvc = moduleRef.get(workflowMod.InvoiceWorkflowService);

  // rawBody: the legacy Stripe route verifies the exact bytes Stripe signed (as app-bootstrap.ts serves it).
  app = moduleRef.createNestApplication({ rawBody: true });
  await app.init();

  await cleanup();

  for (const [user, biz, contact, secret, name, email, contactEmail] of [
    [ID.ownerA, ID.bizA, ID.contactA, SECRET_A, 'V81C Biz A', `${P}owner_a@test.local`, `${P}c_a@test.local`],
    [ID.ownerB, ID.bizB, ID.contactB, SECRET_B, 'V81C Biz B', `${P}owner_b@test.local`, `${P}c_b@test.local`],
  ] as const) {
    await db.user.create({ data: { id: user, email, role: 'USER' } });
    // No business stores a Stripe key of its own: both take payments on the platform account.
    await db.business.create({ data: { id: biz, name, ownerId: user, currency: 'TTD', accountingBasis: 'CASH', metaData: { stripeWebhookSecret: secret } } });
    await db.membership.create({ data: { id: `${user}_m`, userId: user, businessId: biz, role: 'OWNER' } });
    await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(biz);
    await db.contact.create({ data: { id: contact, businessId: biz, firstName: 'V81c', lastName: name, email: contactEmail } });
  }

  let n = 0;
  for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
    n += 1;
    const tenantB = TENANT_B_INVOICES.has(id);
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `V81C-${String(n).padStart(3, '0')}`,
        status: 'SENT',
        subtotal: TOTAL,
        total: TOTAL,
        currency: 'TTD',
        businessId: tenantB ? ID.bizB : ID.bizA,
        contactId: tenantB ? ID.contactB : ID.contactA,
        items: { create: [{ id: `${id}_item1`, description: `V81C item ${n}`, quantity: 1, unitPrice: TOTAL, total: TOTAL }] },
      },
    });
  }
}, 180_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (realFetch) globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

describe('hand-recorded rows are never provider evidence at the Stripe refund door', () => {
  it("RDT-01: B's hand-recorded 'stripe' row naming A's pi_ does not block A's platform-signed refund.created: A gets one -40 row linked to cs_A1 and a REFUND posting; B's books are byte-identical", async () => {
    checkoutOnPlatform(ID.invA1, S.csA1, S.piA1, S.chA1, 10000);
    await paySession('A1', ID.invA1, S.csA1, S.piA1, 100);
    const a = await paymentBy(S.csA1);
    expect(a).toMatchObject({ businessId: ID.bizA, reference: S.piA1, amount: 100, status: 'SUCCESSFUL', recordedBy: null });
    // B's member typed a 'stripe' payment naming A's payment_intent (the manual route stored any method and reference).
    await handRow({ businessId: ID.bizB, invoiceId: ID.invB1, providerPaymentId: `manual_${P}B1_ref`, reference: S.piA1, amount: 100, recordedBy: ID.ownerB });
    const bBefore = await booksOf(ID.bizB);

    expect(await refundCreated('re_A1', S.reA1, S.chA1, S.piA1, 40)).toEqual({ ok: true, received: true, processed: 'refund.created' });
    // RED-BEFORE: refused as ambiguous (A's row and B's hand row match): no re_A1 row, A's posting INCOME only.
    expect(await paymentBy(S.reA1)).toMatchObject({ businessId: ID.bizA, invoiceId: ID.invA1, status: 'REFUNDED', amount: -40, reference: S.csA1 });
    expect(await rowsOf(ID.invA1)).toEqual([`stripe:${S.csA1}:SUCCESSFUL:100:${S.piA1}`, `stripe:${S.reA1}:REFUNDED:-40:${S.csA1}`]);
    expect(await postingsOf(a.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:40']);
    expect((await invoiceRow(ID.invA1)).status).toBe('PARTIALLY_PAID');
    await expectLedgerAgrees(ID.invA1, 60);
    expect(await booksOf(ID.bizB)).toEqual(bBefore);
  }, 60_000);

  it("RDT-02: B's hand-recorded 'stripe' row is the only one naming ch_A2: a platform-signed charge.refunded writes nothing in either tenant and the refusal is logged", async () => {
    checkoutOnPlatform(ID.invA2, `cs_${P}A2`, S.piA2, S.chA2, 10000);
    const hand = await handRow({ businessId: ID.bizB, invoiceId: ID.invB2, providerPaymentId: `manual_${P}B2_key`, reference: S.chA2, amount: 100, recordedBy: ID.ownerB });
    expect((await invoiceRow(ID.invB2)).status).toBe('PAID');
    expect(await postingsOf(hand.id)).toEqual(['INCOME:POSTED:100']);
    const aBefore = await booksOf(ID.bizA);
    const bBefore = await booksOf(ID.bizB);

    const mark = warnings.length;
    expect(await stripe('chr_A2', 'charge.refunded', {
      id: S.chA2, object: 'charge', payment_intent: S.piA2, amount: 10000, amount_refunded: 10000, currency: 'ttd', metadata: {},
      refunds: { data: [{ id: S.reA2, amount: 10000, currency: 'ttd', charge: S.chA2, payment_intent: S.piA2, status: 'succeeded' }] },
    })).toEqual({ ok: true, received: true, processed: 'charge.refunded' });
    // RED-BEFORE: re_A2 -100 written on B's invoice (reference manual_..._B2_key), B's posting reversed, B's invoice back to SENT.
    expect(await paymentBy(S.reA2)).toBeNull();
    expect(await rowsOf(ID.invB2)).toEqual([`stripe:manual_${P}B2_key:SUCCESSFUL:100:${S.chA2}`]);
    expect(await postingsOf(hand.id)).toEqual(['INCOME:POSTED:100']);
    expect((await invoiceRow(ID.invB2)).status).toBe('PAID');
    expect(await rowsOf(ID.invA2)).toEqual([]);
    expect(await booksOf(ID.bizA)).toEqual(aBefore);
    expect(await booksOf(ID.bizB)).toEqual(bBefore);
    expect(warnedSince(mark, S.chA2), 'the refusal is logged').not.toEqual([]);
  }, 60_000);
});

describe("D-56: a platform-signed refund is bound to the business the platform tagged, never to another tenant's self-signed row", () => {
  it("RDT-03: B's self-signed Checkout row naming A's pi_A3 is the only match: a platform-signed refund.created writes nothing in B; one read of the charge and one of its Checkout Session decide; the refusal is logged", async () => {
    checkoutOnPlatform(ID.invA3, `cs_${P}A3`, S.piA3, S.chA3, 10000);
    // B, with the webhook secret it set for itself, records a session on its own invoice naming A's payment_intent.
    await stripe('cs_Bforged3', 'checkout.session.completed', {
      id: S.csBforged3, client_reference_id: ID.invB3, amount_total: 10000, currency: 'ttd', payment_intent: S.piA3, metadata: { invoiceId: ID.invB3 },
    }, SECRET_B);
    const forged = await paymentBy(S.csBforged3);
    expect(forged).toMatchObject({ businessId: ID.bizB, reference: S.piA3, status: 'SUCCESSFUL', recordedBy: null });
    expect((await invoiceRow(ID.invB3)).status).toBe('PAID');
    const bBefore = await booksOf(ID.bizB);

    const mark = calls.length;
    const warned = warnings.length;
    expect(await refundCreated('re_A3', S.reA3, S.chA3, S.piA3, 100)).toEqual({ ok: true, received: true, processed: 'refund.created' });
    // RED-BEFORE: re_A3 -100 on B's invoice (reference cs_Bforged3), B's posting reversed, B's invoice SENT.
    expect(await paymentBy(S.reA3)).toBeNull();
    expect(await rowsOf(ID.invB3)).toEqual([`stripe:${S.csBforged3}:SUCCESSFUL:100:${S.piA3}`]);
    expect(await postingsOf(forged.id)).toEqual(['INCOME:POSTED:100']);
    expect(await booksOf(ID.bizB)).toEqual(bBefore);
    expect(await rowsOf(ID.invA3)).toEqual([]);
    // RED-BEFORE: no provider call. The charge carries no tag; the Checkout Session of its payment_intent names A.
    expect(callsSince(mark)).toEqual([`GET api.stripe.com /v1/charges/${S.chA3}`, 'GET api.stripe.com /v1/checkout/sessions']);
    expect(calls.slice(mark).at(-1)!.path).toBe(`/v1/checkout/sessions?payment_intent=${S.piA3}&limit=1`);
    expect(calls.slice(mark).map((c) => c.auth)).toEqual([`Bearer ${PLATFORM_KEY}`, `Bearer ${PLATFORM_KEY}`]);
    expect(warnedSince(warned, S.chA3), 'the refusal is logged').not.toEqual([]);
  }, 60_000);

  it("RDT-03b: B's older self-signed row and A's own Checkout row both name pi_A7: A's platform-signed refund.created is bound to A by the provider's record (one -30 row linked to cs_A7), not refused, and B is unchanged", async () => {
    checkoutOnPlatform(ID.invA7, S.csA7, S.piA7, S.chA7, 10000);
    await stripe('cs_Bforged7', 'checkout.session.completed', {
      id: S.csBforged7, client_reference_id: ID.invB7, amount_total: 10000, currency: 'ttd', payment_intent: S.piA7, metadata: { invoiceId: ID.invB7 },
    }, SECRET_B);
    await paySession('A7', ID.invA7, S.csA7, S.piA7, 100);
    const a = await paymentBy(S.csA7);
    const bBefore = await booksOf(ID.bizB);

    expect(await refundCreated('re_A7', S.reA7, S.chA7, S.piA7, 30)).toEqual({ ok: true, received: true, processed: 'refund.created' });
    // RED-BEFORE: refused as ambiguous: A's refund blocked by B's self-signed row.
    expect(await rowsOf(ID.invA7)).toEqual([`stripe:${S.csA7}:SUCCESSFUL:100:${S.piA7}`, `stripe:${S.reA7}:REFUNDED:-30:${S.csA7}`]);
    expect(await postingsOf(a.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:30']);
    await expectLedgerAgrees(ID.invA7, 70);
    expect(await booksOf(ID.bizB)).toEqual(bBefore);
  }, 60_000);
});

describe('controls: rows the provider wrote stay originals; the tenant-secret contract is unchanged', () => {
  it('RDT-04 (R0-20b): a payment recorded through the legacy POST /webhooks/stripe is an eligible original: the platform refund.created delivered there is recorded in A', async () => {
    checkoutOnPlatform(ID.invA5, S.csA5, S.piA5, S.chA5, 10000);
    const paid = await legacyStripe('cs_A5', 'checkout.session.completed', {
      id: S.csA5, object: 'checkout.session', client_reference_id: ID.invA5, amount_total: 10000, currency: 'ttd', payment_intent: S.piA5,
      payment_status: 'paid', metadata: { invoiceId: ID.invA5, businessId: ID.bizA },
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    const original = await paymentBy(S.csA5);
    expect(original).toMatchObject({ businessId: ID.bizA, provider: 'stripe', reference: S.piA5, recordedBy: null, status: 'SUCCESSFUL' });

    const res = await legacyStripe('re_A5', 'refund.created', {
      id: S.reA5, object: 'refund', amount: 2500, currency: 'ttd', charge: S.chA5, payment_intent: S.piA5, status: 'succeeded',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ ok: true, processed: 'refund.created' });
    expect(await rowsOf(ID.invA5)).toEqual([`stripe:${S.csA5}:SUCCESSFUL:100:${S.piA5}`, `stripe:${S.reA5}:REFUNDED:-25:${S.csA5}`]);
    await expectLedgerAgrees(ID.invA5, 75);
  }, 60_000);

  it("RDT-05 (V1-41b, KEY): B's KEY-recorded and evidence-confirmed 'stripe' rows naming A's pi_A6 and ch_A6 (recordedBy set) neither block nor take A's platform-signed refund: A's -40 is recorded and B is byte-identical", async () => {
    expect(systemActorId).toBe(KEY_ACTOR);
    checkoutOnPlatform(ID.invA6, S.csA6, S.piA6, S.chA6, 10000);
    await paySession('A6', ID.invA6, S.csA6, S.piA6, 100);
    const a = await paymentBy(S.csA6);
    // KEY processPayment (CommerceAdapterService): recordPayment as KEY's system actor, method chosen by the model.
    await commerceSvc.recordPayment(ID.invB6, ID.bizB, { amount: 100, method: 'stripe', reference: S.piA6 }, { actorId: KEY_ACTOR });
    // V1-41b: an extracted pending payment a member of B confirms (recordPayment with the member as actor).
    const pending = await evidenceSvc.recordPendingPayment(ID.invB6e, ID.bizB, { amount: 50, method: 'stripe', reference: S.chA6 }, { actorId: KEY_ACTOR });
    await evidenceSvc.confirmPendingPayment(pending.id, ID.bizB, ID.ownerB, { amount: 50 });
    const bRows = (await db.payment.findMany({ where: { businessId: ID.bizB, invoiceId: { in: [ID.invB6, ID.invB6e] }, status: 'SUCCESSFUL' } }))
      .map((r: any) => ({ provider: r.provider, reference: r.reference, recordedBy: r.recordedBy, manual: r.providerPaymentId.startsWith('manual_') }));
    // The witnesses as stored at this head (before D-55's provider 'manual'): provider 'stripe', a manual_ id, recordedBy set.
    expect(bRows).toEqual(expect.arrayContaining([
      { provider: 'stripe', reference: S.piA6, recordedBy: KEY_ACTOR, manual: true },
      { provider: 'stripe', reference: S.chA6, recordedBy: ID.ownerB, manual: true },
    ]));
    const bBefore = await booksOf(ID.bizB);

    expect(await refundCreated('re_A6', S.reA6, S.chA6, S.piA6, 40)).toEqual({ ok: true, received: true, processed: 'refund.created' });
    // RED-BEFORE: refused as ambiguous (B's KEY and evidence rows match too): no re_A6 row.
    expect(await rowsOf(ID.invA6)).toEqual([`stripe:${S.csA6}:SUCCESSFUL:100:${S.piA6}`, `stripe:${S.reA6}:REFUNDED:-40:${S.csA6}`]);
    expect(await postingsOf(a.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:40']);
    await expectLedgerAgrees(ID.invA6, 60);
    expect(await booksOf(ID.bizB)).toEqual(bBefore);
  }, 60_000);

  it("RDT-06: a refund signed with A's own webhook secret for A's charge is recorded in A with no provider call", async () => {
    await stripe('pi_A4', 'payment_intent.succeeded', {
      id: S.piA4, amount_received: 10000, currency: 'ttd', latest_charge: S.chA4, metadata: { invoiceId: ID.invA4 },
    }, SECRET_A);
    const pi = await paymentBy(S.piA4);
    expect(pi).toMatchObject({ businessId: ID.bizA, reference: S.chA4, status: 'SUCCESSFUL' });
    const mark = calls.length;
    expect(await stripe('re_A4', 'refund.created', {
      id: S.reA4, amount: 2000, currency: 'ttd', charge: S.chA4, payment_intent: S.piA4, status: 'succeeded', metadata: { invoiceId: ID.invA4 },
    }, SECRET_A)).toEqual({ ok: true, received: true, processed: 'refund.created' });
    expect(await paymentBy(S.reA4)).toMatchObject({ businessId: ID.bizA, amount: -20, reference: S.piA4, status: 'REFUNDED' });
    expect(await postingsOf(pi.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:20']);
    await expectLedgerAgrees(ID.invA4, 80);
    expect(callsSince(mark)).toEqual([]);
  }, 60_000);
});

describe('fixtures', () => {
  it('RDT-07: cleanup leaves no v81c_ row', async () => {
    await cleanup();
    const counts = await db.$queryRawUnsafe(`
      SELECT
        (SELECT count(*) FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)})::int AS payments,
        (SELECT count(*) FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS txns,
        (SELECT count(*) FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS entries,
        (SELECT count(*) FROM webhook_events WHERE provider_event_id LIKE ${sqlLikePrefix(P)})::int AS events,
        (SELECT count(*) FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS invoices,
        (SELECT count(*) FROM businesses WHERE id LIKE ${sqlLikePrefix(P)})::int AS businesses,
        (SELECT count(*) FROM users WHERE id LIKE ${sqlLikePrefix(P)})::int AS users
    `);
    expect(counts).toEqual([{ payments: 0, txns: 0, entries: 0, events: 0, invoices: 0, businesses: 0, users: 0 }]);
  }, 60_000);
});
