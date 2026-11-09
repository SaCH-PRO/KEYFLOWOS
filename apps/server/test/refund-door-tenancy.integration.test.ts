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
 *       the evidence confirm (CommerceService.recordPayment) store the method
 *       typed ('stripe'; provider 'manual' since owner ruling D-55, provider
 *       'stripe' on rows stored before it), providerPaymentId 'manual_...',
 *       recordedBy the actor, and any reference. Such a row is no provider evidence (the
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
 *   RDT-08..13 (review SEC-A3-1/2, CR-A3-1/2) a platform-signed event is
 *           about a charge on the platform account, so only a business with
 *           no Stripe key of its own is asked. B with its own key (even an
 *           invalid one) and a self-signed row naming A's ids neither fails A's
 *           delivery (RDT-08), blocks it (RDT-09) nor takes it (RDT-10); B
 *           saving a key while the door reads the provider for A changes
 *           nothing (RDT-11 its answer, RDT-12 its failed read).
 *   RDT-13..13c (W3-PLATFORM-CHARGE-BIND, review CR-A3-1, owner ruling D-56)
 *           a payment A took on the platform account before it saved a Stripe
 *           key of its own is bound by the platform account's own record
 *           (StripeConnector.isOwnPlatformCharge, read with the deployment's
 *           key, never A's): its platform-signed refund is booked into A
 *           (RDT-13, refund.created; RDT-13b, charge.refunded with B's older
 *           self-signed row naming the same payment_intent), and a row A
 *           self-signed before saving its key does not take another business's
 *           pre-key charge (RDT-13c, refused and logged)
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
/** Stripe keys a business can save in Settings > Payments: its own (empty) accounts, and one Stripe refuses (401). */
const A_OWN_KEY = `sk_test_${P}a_own`;
const B_OWN_KEY = `sk_test_${P}b_own`;
const REVOKED_KEY = `sk_test_${P}revoked`;
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
  invA8: `${P}invA8`,
  invB8: `${P}invB8`,
  invA9: `${P}invA9`,
  invB9: `${P}invB9`,
  invA10: `${P}invA10`,
  invB10: `${P}invB10`,
  invA11: `${P}invA11`,
  invB11: `${P}invB11`,
  invA12: `${P}invA12`,
  invB12: `${P}invB12`,
  invA13: `${P}invA13`,
  invA13b: `${P}invA13b`,
  invB13b: `${P}invB13b`,
  invA13c: `${P}invA13c`,
  invB13c: `${P}invB13c`,
};
const TENANT_B_INVOICES = new Set([ID.invB1, ID.invB2, ID.invB3, ID.invB6, ID.invB6e, ID.invB7, ID.invB8, ID.invB9, ID.invB10, ID.invB11, ID.invB12, ID.invB13b, ID.invB13c]);

/** Stripe-shaped ids (the prefix inside, so every globally unique value carries it). */
const S = {
  csA1: `cs_${P}A1`, piA1: `pi_${P}A1`, chA1: `ch_${P}A1`, reA1: `re_${P}A1`,
  piA2: `pi_${P}A2`, chA2: `ch_${P}A2`, reA2: `re_${P}A2`,
  piA3: `pi_${P}A3`, chA3: `ch_${P}A3`, reA3: `re_${P}A3`, csBforged3: `cs_${P}Bforged3`,
  piA4: `pi_${P}A4`, chA4: `ch_${P}A4`, reA4: `re_${P}A4`,
  csA5: `cs_${P}A5`, piA5: `pi_${P}A5`, chA5: `ch_${P}A5`, reA5: `re_${P}A5`,
  csA6: `cs_${P}A6`, piA6: `pi_${P}A6`, chA6: `ch_${P}A6`, reA6: `re_${P}A6`,
  csA7: `cs_${P}A7`, piA7: `pi_${P}A7`, chA7: `ch_${P}A7`, reA7: `re_${P}A7`, csBforged7: `cs_${P}Bforged7`,
  csA8: `cs_${P}A8`, piA8: `pi_${P}A8`, chA8: `ch_${P}A8`, reA8: `re_${P}A8`, csBforged8: `cs_${P}Bforged8`,
  csA9: `cs_${P}A9`, piA9: `pi_${P}A9`, chA9: `ch_${P}A9`, reA9: `re_${P}A9`, csBforged9: `cs_${P}Bforged9`,
  csA10: `cs_${P}A10`, piA10: `pi_${P}A10`, chA10: `ch_${P}A10`, reA10: `re_${P}A10`, csBforged10: `cs_${P}Bforged10`,
  csA11: `cs_${P}A11`, piA11: `pi_${P}A11`, chA11: `ch_${P}A11`, reA11: `re_${P}A11`, csBforged11: `cs_${P}Bforged11`,
  csA12: `cs_${P}A12`, piA12: `pi_${P}A12`, chA12: `ch_${P}A12`, reA12: `re_${P}A12`, csBforged12: `cs_${P}Bforged12`,
  csA13: `cs_${P}A13`, piA13: `pi_${P}A13`, chA13: `ch_${P}A13`, reA13: `re_${P}A13`,
  csA13b: `cs_${P}A13b`, piA13b: `pi_${P}A13b`, chA13b: `ch_${P}A13b`, reA13b: `re_${P}A13b`, csBforged13b: `cs_${P}Bforged13b`,
  csB13c: `cs_${P}B13c`, piB13c: `pi_${P}B13c`, chB13c: `ch_${P}B13c`, reB13c: `re_${P}B13c`, csAforged13c: `cs_${P}Aforged13c`,
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
/**
 * Runs once, before the fake Stripe answers its next call, then clears
 * itself: a change a tenant makes while the door is reading the provider.
 */
let beforeNextAnswer: ((c: Call) => Promise<void>) | null = null;
const now = () => Math.floor(Date.now() / 1000);

/**
 * A's customer paid A's invoice through createStripeCheckout on the platform
 * account: the session carries the platform's tag (metadata invoiceId +
 * businessId, client_reference_id), the charge carries none. `businessId`
 * names another business whose customer paid its own invoice there (RDT-13c).
 */
function checkoutOnPlatform(invoiceId: string, cs: string, pi: string, ch: string, amountMinor: number, businessId: string = ID.bizA) {
  const acct = accounts[PLATFORM_KEY];
  acct.sessions.push({
    id: cs, object: 'checkout.session', status: 'complete', payment_intent: pi, client_reference_id: invoiceId,
    metadata: { invoiceId, businessId }, created: now(),
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
  const call: Call = { method, host: url.host, path: `${url.pathname}${url.search}`, auth: headers.get('authorization') };
  calls.push(call);
  if (url.host !== 'api.stripe.com') throw new Error(`v81c fake fetch: no network (${url.host})`);
  const hook = beforeNextAnswer;
  beforeNextAnswer = null;
  if (hook) await hook(call);
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

/** Settings > Payments of a business: its own webhook secret, and a Stripe key of its own when `ownKey` is given. */
async function setStripeSettings(businessId: string, ownKey: string | null) {
  const stripeWebhookSecret = businessId === ID.bizA ? SECRET_A : SECRET_B;
  await db.business.update({
    where: { id: businessId },
    data: { metaData: ownKey ? { stripeWebhookSecret, stripeSecretKey: ownKey } : { stripeWebhookSecret } },
  });
}

/** The bearer key of every provider call since `mark`. */
function keysSince(mark: number): Array<string | null> {
  return calls.slice(mark).map((c) => c.auth);
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
  // The accounts behind the keys a business can save as its own hold none of the platform's charges.
  accounts[A_OWN_KEY] = { charges: [], sessions: [] };
  accounts[B_OWN_KEY] = { charges: [], sessions: [] };
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
      .map((r: any) => ({ provider: r.provider, method: r.method, reference: r.reference, recordedBy: r.recordedBy, manual: r.providerPaymentId.startsWith('manual_') }));
    // The witnesses as stored (owner ruling D-55, FOLLOW3-A1): the method typed ('stripe') is kept, the
    // provider is 'manual', the id a manual_ one and recordedBy set. The door's hand-row rule (recordedBy
    // set or a manual_ id) also keeps rows stored before D-55 with provider 'stripe' out.
    expect(bRows).toEqual(expect.arrayContaining([
      { provider: 'manual', method: 'stripe', reference: S.piA6, recordedBy: KEY_ACTOR, manual: true },
      { provider: 'manual', method: 'stripe', reference: S.chA6, recordedBy: ID.ownerB, manual: true },
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

describe('review SEC-A3-1/2, CR-A3-1/2: only a business that takes payments on the platform account is asked about a platform-signed refund', () => {
  const PROCESSED = { ok: true, received: true, processed: 'refund.created' };
  const PLATFORM = `Bearer ${PLATFORM_KEY}`;

  it("RDT-08 (SEC-A3-1): B saved an invalid Stripe key of its own and self-signs a row naming A's pi_A8: A's platform-signed refund.created is booked into A on its first delivery, B's key is never used, and the redelivery is acknowledged", async () => {
    try {
      await setStripeSettings(ID.bizB, REVOKED_KEY);
      checkoutOnPlatform(ID.invA8, S.csA8, S.piA8, S.chA8, 10000);
      await paySession('A8', ID.invA8, S.csA8, S.piA8, 100);
      const a = await paymentBy(S.csA8);
      await stripe('cs_Bforged8', 'checkout.session.completed', {
        id: S.csBforged8, client_reference_id: ID.invB8, amount_total: 10000, currency: 'ttd', payment_intent: S.piA8, metadata: { invoiceId: ID.invB8 },
      }, SECRET_B);
      expect(await paymentBy(S.csBforged8)).toMatchObject({ businessId: ID.bizB, reference: S.piA8, status: 'SUCCESSFUL', recordedBy: null });
      const bBefore = await booksOf(ID.bizB);

      const mark = calls.length;
      // RED-BEFORE (e70f235b): B was asked with its own key, and every delivery threw 'Invalid API Key provided'.
      expect(await refundCreated('re_A8', S.reA8, S.chA8, S.piA8, 40)).toEqual(PROCESSED);
      expect(await refundCreated('re_A8', S.reA8, S.chA8, S.piA8, 40)).toEqual({ ok: true, received: true });
      expect(await rowsOf(ID.invA8)).toEqual([`stripe:${S.csA8}:SUCCESSFUL:100:${S.piA8}`, `stripe:${S.reA8}:REFUNDED:-40:${S.csA8}`]);
      expect(await postingsOf(a.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:40']);
      await expectLedgerAgrees(ID.invA8, 60);
      expect(await booksOf(ID.bizB)).toEqual(bBefore);
      // Only A is asked, on the platform account: the charge, then the Checkout Session of its payment_intent.
      expect(callsSince(mark)).toEqual([`GET api.stripe.com /v1/charges/${S.chA8}`, 'GET api.stripe.com /v1/checkout/sessions']);
      expect(keysSince(mark)).toEqual([PLATFORM, PLATFORM]);
    } finally {
      await setStripeSettings(ID.bizB, null);
    }
  }, 60_000);

  it("RDT-09 (SEC-A3-2 R2, CR-A3-2): B holds a Stripe key of its own and self-signs a row whose reference is A's ch_A9: A's platform-signed refund is booked into A, not refused as owned by both", async () => {
    try {
      await setStripeSettings(ID.bizB, B_OWN_KEY);
      checkoutOnPlatform(ID.invA9, S.csA9, S.piA9, S.chA9, 10000);
      await stripe('cs_Bforged9', 'checkout.session.completed', {
        id: S.csBforged9, client_reference_id: ID.invB9, amount_total: 10000, currency: 'ttd', charge: S.chA9, metadata: { invoiceId: ID.invB9 },
      }, SECRET_B);
      expect(await paymentBy(S.csBforged9)).toMatchObject({ businessId: ID.bizB, reference: S.chA9, status: 'SUCCESSFUL', recordedBy: null });
      await paySession('A9', ID.invA9, S.csA9, S.piA9, 100);
      const a = await paymentBy(S.csA9);
      const bBefore = await booksOf(ID.bizB);

      const mark = calls.length;
      expect(await refundCreated('re_A9', S.reA9, S.chA9, S.piA9, 30)).toEqual(PROCESSED);
      // RED-BEFORE (e70f235b): B's own row named ch_A9, so isOwnCharge counted B as an owner beside A and the refund was refused.
      expect(await rowsOf(ID.invA9)).toEqual([`stripe:${S.csA9}:SUCCESSFUL:100:${S.piA9}`, `stripe:${S.reA9}:REFUNDED:-30:${S.csA9}`]);
      expect(await postingsOf(a.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:30']);
      await expectLedgerAgrees(ID.invA9, 70);
      expect(await booksOf(ID.bizB)).toEqual(bBefore);
      expect(keysSince(mark)).toEqual([PLATFORM, PLATFORM]);
    } finally {
      await setStripeSettings(ID.bizB, null);
    }
  }, 60_000);

  it("RDT-10 (SEC-A3-2 R3): B holds a Stripe key of its own and its self-signed row naming A's ch_A10 is the only match: nothing is written in either tenant, no provider call is made, and the refusal is logged", async () => {
    try {
      await setStripeSettings(ID.bizB, B_OWN_KEY);
      checkoutOnPlatform(ID.invA10, S.csA10, S.piA10, S.chA10, 10000);
      await stripe('cs_Bforged10', 'checkout.session.completed', {
        id: S.csBforged10, client_reference_id: ID.invB10, amount_total: 10000, currency: 'ttd', charge: S.chA10, metadata: { invoiceId: ID.invB10 },
      }, SECRET_B);
      const forged = await paymentBy(S.csBforged10);
      expect(forged).toMatchObject({ businessId: ID.bizB, reference: S.chA10, status: 'SUCCESSFUL', recordedBy: null });
      const aBefore = await booksOf(ID.bizA);
      const bBefore = await booksOf(ID.bizB);

      const mark = calls.length;
      const warned = warnings.length;
      expect(await refundCreated('re_A10', S.reA10, S.chA10, S.piA10, 30)).toEqual(PROCESSED);
      // RED-BEFORE (e70f235b): B's own row answered for B, and re_A10 -30 was booked on B's invoice.
      expect(await paymentBy(S.reA10)).toBeNull();
      expect(await rowsOf(ID.invB10)).toEqual([`stripe:${S.csBforged10}:SUCCESSFUL:100:${S.chA10}`]);
      expect(await postingsOf(forged.id)).toEqual(['INCOME:POSTED:100']);
      expect(await rowsOf(ID.invA10)).toEqual([]);
      expect(await booksOf(ID.bizA)).toEqual(aBefore);
      expect(await booksOf(ID.bizB)).toEqual(bBefore);
      expect(callsSince(mark)).toEqual([]);
      const refusal = warnedSince(warned, S.chA10);
      expect(refusal, 'the refusal is logged').toHaveLength(1);
      expect(refusal[0]).toContain(ID.bizB);
    } finally {
      await setStripeSettings(ID.bizB, null);
    }
  }, 60_000);

  it("RDT-11: B saves a Stripe key of its own while the door reads the platform account for A: B's answer from its own account (its row naming ch_A11) does not make it an owner, and A's refund is booked into A", async () => {
    try {
      checkoutOnPlatform(ID.invA11, S.csA11, S.piA11, S.chA11, 10000);
      await paySession('A11', ID.invA11, S.csA11, S.piA11, 100);
      const a = await paymentBy(S.csA11);
      await stripe('cs_Bforged11', 'checkout.session.completed', {
        id: S.csBforged11, client_reference_id: ID.invB11, amount_total: 10000, currency: 'ttd', charge: S.chA11, metadata: { invoiceId: ID.invB11 },
      }, SECRET_B);
      expect(await paymentBy(S.csBforged11)).toMatchObject({ businessId: ID.bizB, reference: S.chA11, recordedBy: null });
      const bBefore = await booksOf(ID.bizB);

      // A's payment is the older, so A is asked first; B saves its key during that read.
      beforeNextAnswer = async () => setStripeSettings(ID.bizB, B_OWN_KEY);
      const mark = calls.length;
      expect(await refundCreated('re_A11', S.reA11, S.chA11, S.piA11, 30)).toEqual(PROCESSED);
      // RED-BEFORE: B, now on its own key, answered from its own row and the refund was refused as owned by both.
      expect(await rowsOf(ID.invA11)).toEqual([`stripe:${S.csA11}:SUCCESSFUL:100:${S.piA11}`, `stripe:${S.reA11}:REFUNDED:-30:${S.csA11}`]);
      expect(await postingsOf(a.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:30']);
      await expectLedgerAgrees(ID.invA11, 70);
      expect(await booksOf(ID.bizB)).toEqual(bBefore);
      expect(keysSince(mark)).toEqual([PLATFORM, PLATFORM]);
    } finally {
      beforeNextAnswer = null;
      await setStripeSettings(ID.bizB, null);
    }
  }, 60_000);

  it("RDT-12: B saves an invalid Stripe key of its own while the door reads the platform account for A: B's failed read on its own key does not fail the delivery, and A's refund is booked into A", async () => {
    try {
      checkoutOnPlatform(ID.invA12, S.csA12, S.piA12, S.chA12, 10000);
      await paySession('A12', ID.invA12, S.csA12, S.piA12, 100);
      const a = await paymentBy(S.csA12);
      await stripe('cs_Bforged12', 'checkout.session.completed', {
        id: S.csBforged12, client_reference_id: ID.invB12, amount_total: 10000, currency: 'ttd', payment_intent: S.piA12, metadata: { invoiceId: ID.invB12 },
      }, SECRET_B);
      expect(await paymentBy(S.csBforged12)).toMatchObject({ businessId: ID.bizB, reference: S.piA12, recordedBy: null });
      const bBefore = await booksOf(ID.bizB);

      beforeNextAnswer = async () => setStripeSettings(ID.bizB, REVOKED_KEY);
      const mark = calls.length;
      // RED-BEFORE: B's read with its own (revoked) key threw, and the delivery failed.
      expect(await refundCreated('re_A12', S.reA12, S.chA12, S.piA12, 30)).toEqual(PROCESSED);
      expect(await rowsOf(ID.invA12)).toEqual([`stripe:${S.csA12}:SUCCESSFUL:100:${S.piA12}`, `stripe:${S.reA12}:REFUNDED:-30:${S.csA12}`]);
      expect(await postingsOf(a.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:30']);
      await expectLedgerAgrees(ID.invA12, 70);
      expect(await booksOf(ID.bizB)).toEqual(bBefore);
      // A on the platform account; then B, already listed to be asked, read its own account with the key it had just saved (refused).
      expect(keysSince(mark)).toEqual([PLATFORM, PLATFORM, `Bearer ${REVOKED_KEY}`]);
    } finally {
      beforeNextAnswer = null;
      await setStripeSettings(ID.bizB, null);
    }
  }, 60_000);

  it("RDT-13 (CR-A3-1, D-56): A took a payment on the platform account, then saved a Stripe key of its own: a platform-signed refund.created of that payment is booked into A by the platform account's record, read with the deployment's key (A's own key never used), and the redelivery writes nothing", async () => {
    try {
      checkoutOnPlatform(ID.invA13, S.csA13, S.piA13, S.chA13, 10000);
      await paySession('A13', ID.invA13, S.csA13, S.piA13, 100);
      const a = await paymentBy(S.csA13);
      await setStripeSettings(ID.bizA, A_OWN_KEY);
      const bBefore = await booksOf(ID.bizB);

      const mark = calls.length;
      expect(await refundCreated('re_A13', S.reA13, S.chA13, S.piA13, 40)).toEqual(PROCESSED);
      expect(await refundCreated('re_A13', S.reA13, S.chA13, S.piA13, 40)).toEqual({ ok: true, received: true });
      // RED-BEFORE (the residual the W3-STRIPE-LEGACY-BINDING head pinned here): A, holding a key of its own, was not asked; refused and logged, no row, no provider call.
      expect(await paymentBy(S.reA13)).toMatchObject({ businessId: ID.bizA, invoiceId: ID.invA13, status: 'REFUNDED', amount: -40, reference: S.csA13 });
      expect(await rowsOf(ID.invA13)).toEqual([`stripe:${S.csA13}:SUCCESSFUL:100:${S.piA13}`, `stripe:${S.reA13}:REFUNDED:-40:${S.csA13}`]);
      expect(await postingsOf(a.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:40']);
      expect((await invoiceRow(ID.invA13)).status).toBe('PARTIALLY_PAID');
      await expectLedgerAgrees(ID.invA13, 60);
      expect(await booksOf(ID.bizB)).toEqual(bBefore);
      // The platform account, with the deployment's key: the charge, then the Checkout Session of its payment_intent. A's own (empty) account is never read.
      expect(callsSince(mark)).toEqual([`GET api.stripe.com /v1/charges/${S.chA13}`, 'GET api.stripe.com /v1/checkout/sessions']);
      expect(keysSince(mark)).toEqual([PLATFORM, PLATFORM]);
    } finally {
      await setStripeSettings(ID.bizA, null);
    }
  }, 60_000);

  it("RDT-13b (CR-A3-1 follow-up, D-56): B's older self-signed row and A's own Checkout row both name pi_A13b, and A saved a Stripe key of its own after taking that payment on the platform account: a platform-signed charge.refunded is booked into A by the platform account's record (one -30 row linked to cs_A13b), and B is unchanged", async () => {
    try {
      checkoutOnPlatform(ID.invA13b, S.csA13b, S.piA13b, S.chA13b, 10000);
      // B (no key of its own), with the webhook secret it set for itself, records a session on its own invoice naming A's payment_intent.
      await stripe('cs_Bforged13b', 'checkout.session.completed', {
        id: S.csBforged13b, client_reference_id: ID.invB13b, amount_total: 10000, currency: 'ttd', payment_intent: S.piA13b, metadata: { invoiceId: ID.invB13b },
      }, SECRET_B);
      expect(await paymentBy(S.csBforged13b)).toMatchObject({ businessId: ID.bizB, reference: S.piA13b, status: 'SUCCESSFUL', recordedBy: null });
      await paySession('A13b', ID.invA13b, S.csA13b, S.piA13b, 100);
      const a = await paymentBy(S.csA13b);
      await setStripeSettings(ID.bizA, A_OWN_KEY);
      const bBefore = await booksOf(ID.bizB);

      const mark = calls.length;
      expect(await stripe('chr_A13b', 'charge.refunded', {
        id: S.chA13b, object: 'charge', payment_intent: S.piA13b, amount: 10000, amount_refunded: 3000, currency: 'ttd', metadata: {},
        refunds: { data: [{ id: S.reA13b, amount: 3000, currency: 'ttd', charge: S.chA13b, payment_intent: S.piA13b, status: 'succeeded' }] },
      })).toEqual({ ok: true, received: true, processed: 'charge.refunded' });
      // RED-BEFORE: B (on the platform account) was asked and is not the owner; A (a key of its own) was not asked; refused, no re_A13b row.
      expect(await rowsOf(ID.invA13b)).toEqual([`stripe:${S.csA13b}:SUCCESSFUL:100:${S.piA13b}`, `stripe:${S.reA13b}:REFUNDED:-30:${S.csA13b}`]);
      expect(await postingsOf(a.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:30']);
      await expectLedgerAgrees(ID.invA13b, 70);
      expect(await booksOf(ID.bizB)).toEqual(bBefore);
      // B (its row is the older) through isOwnCharge, then A through the platform-account read: both on the platform account.
      expect(callsSince(mark)).toEqual([
        `GET api.stripe.com /v1/charges/${S.chA13b}`, 'GET api.stripe.com /v1/checkout/sessions',
        `GET api.stripe.com /v1/charges/${S.chA13b}`, 'GET api.stripe.com /v1/checkout/sessions',
      ]);
      expect(keysSince(mark)).toEqual([PLATFORM, PLATFORM, PLATFORM, PLATFORM]);
    } finally {
      await setStripeSettings(ID.bizA, null);
    }
  }, 60_000);

  it("RDT-13c (control, D-56): A self-signed a row naming B's pi_B13c before it saved a Stripe key of its own, and B took that payment on the platform account: a platform-signed refund.created of B's charge is not booked into A (refused and logged, nothing written in either tenant), and A's own key is never used", async () => {
    try {
      // B's customer paid B's invoice on the platform account: the session the platform tagged names B.
      checkoutOnPlatform(ID.invB13c, S.csB13c, S.piB13c, S.chB13c, 10000, ID.bizB);
      // A, with the webhook secret it set for itself, records a session on its own invoice naming B's payment_intent, then saves a key of its own.
      await stripe('cs_Aforged13c', 'checkout.session.completed', {
        id: S.csAforged13c, client_reference_id: ID.invA13c, amount_total: 10000, currency: 'ttd', payment_intent: S.piB13c, metadata: { invoiceId: ID.invA13c },
      }, SECRET_A);
      const forged = await paymentBy(S.csAforged13c);
      expect(forged).toMatchObject({ businessId: ID.bizA, reference: S.piB13c, status: 'SUCCESSFUL', recordedBy: null });
      await setStripeSettings(ID.bizA, A_OWN_KEY);
      const aBefore = await booksOf(ID.bizA);
      const bBefore = await booksOf(ID.bizB);

      const mark = calls.length;
      const warned = warnings.length;
      expect(await refundCreated('re_B13c', S.reB13c, S.chB13c, S.piB13c, 40)).toEqual(PROCESSED);
      expect(await paymentBy(S.reB13c)).toBeNull();
      expect(await rowsOf(ID.invA13c)).toEqual([`stripe:${S.csAforged13c}:SUCCESSFUL:100:${S.piB13c}`]);
      expect(await postingsOf(forged.id)).toEqual(['INCOME:POSTED:100']);
      expect(await rowsOf(ID.invB13c)).toEqual([]);
      expect(await booksOf(ID.bizA)).toEqual(aBefore);
      expect(await booksOf(ID.bizB)).toEqual(bBefore);
      // Only the platform account may be read (its record names B); A's own account never.
      expect(keysSince(mark).every((k) => k === PLATFORM), 'every provider read uses the deployment key').toBe(true);
      const refusal = warnedSince(warned, S.chB13c);
      expect(refusal, 'the refusal is logged').toHaveLength(1);
      expect(refusal[0]).toContain(ID.bizA);
    } finally {
      await setStripeSettings(ID.bizA, null);
    }
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
