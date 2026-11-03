/**
 * V1-15d-STRIPE-OPS-TENANCY — Stripe operations act only on the business's own
 * charges, never through the shared platform key on another tenant's charge
 * (REAL database, REAL guards, REAL PaymentsOpsService + StripeConnector, REAL
 * V1-29c refund door and ledger posting; Stripe's HTTP API is a stub).
 *
 * Finding F1 (verify-money, int/trial-I, blocking, pre-existing): when tenants
 * share the deployment's STRIPE_SECRET_KEY (no business stores its own
 * stripeSecretKey, the configuration createStripeCheckout itself falls back to,
 * so A's customers pay A's invoices into the platform account), a member of B:
 *   - lists A's charges through B's own route: GET /payments/businesses/B/
 *     transactions answered 200 with A's charge (amount, customer name and
 *     email, A's invoice id), and ?q= searched them;
 *   - refunds A's charge: POST /payments/businesses/B/refunds answered 201 and
 *     Stripe received POST /v1/refunds with the platform key for A's charge. No
 *     local row was written (refundCharge looked for the original only under B
 *     and skipped it); Stripe's platform-signed refund event then recorded the
 *     refund against A's invoice and reopened it;
 *   - lists and revokes the platform account's payment links (A's included).
 *
 * Contract pinned here:
 *
 *   SOT-01  LIST: B's transactions (shared key) hold only B's own charges: none
 *           of A's charges, customers or invoice ids; A's list holds A's own
 *           (recorded by id, by reference, or through the payment_intent its
 *           Checkout Session row references) and not B's. The filter (review
 *           repair SEC-V15D-1/2) is the provider's own record: the businessId
 *           or invoiceId metadata the platform wrote on the charge or on the
 *           Checkout Session of its payment_intent, never a Payment row (a
 *           tenant writes its own rows)
 *   SOT-02  SEARCH: B's ?q= with A's customer email finds nothing; A's finds A's
 *   SOT-03  REFUND (F1 repro): B's refund of A's charge (recorded by A under the
 *           charge id, or as the reference of A's PaymentIntent row) is 404
 *           with no write to the provider: the one call is the read of the
 *           charge whose metadata names A's invoice; A's invoice stays PAID and
 *           no row moves (the stub delivers, platform-signed, any refund it
 *           performed, as Stripe would)
 *   SOT-04  REFUND, Checkout shape: B's refund of the charge of A's Checkout
 *           Session payment (the charge id is not stored; A's cs_ row holds its
 *           payment_intent) is 404 with no write to Stripe: the calls are the
 *           read of the charge and the read of the Checkout Session of its
 *           payment_intent, whose metadata names A
 *   SOT-05  UNKNOWN: a charge nobody recorded is 404 exactly like another
 *           tenant's charge (same status and message), with no refund call
 *   SOT-06  LINKS: B's payment-link list (shared key) holds only links tagged
 *           with B's id (metadata businessId; none of A's, no untagged legacy
 *           link, no line-item lookups for them); a link B creates is tagged
 *           and listed for B only
 *   SOT-07  REVOKE: B's revoke of A's link (both routes) is 404 and Stripe gets
 *           no write; A revokes its own (200)
 *   SOT-08  SCOPES: refunds and link writes keep revenue:write, lists keep
 *           revenue:read (a revenue:read STAFF member lists, and is 403 on a
 *           refund and a link write with no provider call)
 *   SOT-09  OWN REFUND, end to end through the V1-29c refund door: A refunds
 *           the charge of its Checkout Session payment (partial, 40 of 100) and
 *           of its PaymentIntent payment (in full): one POST /v1/refunds each,
 *           with the platform key; Stripe's refund.created through the door
 *           writes ONE negative row linked to the payment and posts it (REFUND
 *           40, then REVERSAL); the invoice reopens; the ledger agrees
 *   SOT-10  OWN REFUND of a payment recorded under its charge id: one POST, one
 *           negative row linked to the payment, and Stripe's refund.created
 *           writes no second row
 *   SOT-11  FORGED CLAIM: a row of B that names A's charge (a reference B could
 *           sign for itself with its own webhook secret) does not make A's
 *           charge B's: B's refund is 404 with no write (the one call is the
 *           read of the charge, which names A's invoice), B's list omits it
 *   RV-01..07 (review repairs, below): a manual or self-signed row neither
 *           claims another tenant's charge nor takes one from its owner (Stripe
 *           and PayPal); a business's own payment-link sales are listed and
 *           refundable; a failed ownership read is an error, not "not found"
 *   SOT-12  PAYPAL: B's refund of A's PayPal capture (platform PayPal creds) is
 *           404 with zero PayPal calls (the ownership check is the service's,
 *           for every gateway)
 *   SOT-13  OWN KEY (control): a business with its own Stripe key lists its own
 *           account unfiltered, never with the platform key; a charge it never
 *           recorded is still 404 on refund
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, the global TenantInterceptor, GlobalHttpExceptionFilter and
 * ValidationPipe, PaymentsOpsService, StripeConnector, PayPalConnector,
 * WiPayConnector, PaymentsService.handleStripeWebhook (the V1-29c door),
 * InvoiceWorkflowService, RevenuePostingService, PostingService and
 * ChartOfAccountsSeederService write real rows. Identity attachment is the one
 * stand-in: a test middleware reads `x-v15d-user`, loads that seeded user row
 * and attaches `{ id, email, role }` as the Supabase-verifying AuthMiddleware
 * would. global fetch is a fake Stripe (accounts keyed by bearer key) and fake
 * PayPal that record every call and refuse any other host: no network traffic.
 * Stripe deliveries are signed with the deployment's STRIPE_WEBHOOK_SECRET (set
 * for this file only, restored after). CurrencyRatesService, EventEmitter2,
 * EntityResolutionService, ExpensePostingService, TimelineService and
 * CommerceService (PaymentsService uses it on pay-link paths only) are stubs
 * off the boundary.
 *
 * Fixtures: prefix `v15d_` (registered in test/helpers/fixture-prefixes.json);
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

const P = 'v15d_';
const HEADER = 'x-v15d-user';
const PLATFORM_KEY = `sk_test_${P}platform`;
const C_KEY = `sk_test_${P}own_c`;
const PLATFORM_WHSEC = `whsec_${P}platform`;
const PAYPAL_PLATFORM_ID = `pp_${P}platform_id`;

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  staffB: `${P}staffB`,
  ownerC: `${P}ownerC`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizC: `${P}bizC`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  contactC: `${P}contactC`,
  invA1: `${P}invA1`,
  invA2: `${P}invA2`,
  invA3: `${P}invA3`,
  invA4: `${P}invA4`,
  invA5: `${P}invA5`,
  invB1: `${P}invB1`,
  invB2: `${P}invB2`,
  invA6: `${P}invA6`,
  invB3: `${P}invB3`,
  invB4: `${P}invB4`,
};

/** Stripe-shaped ids (the prefix inside, so every globally unique value carries it). */
const S = {
  chA1: `ch_${P}A1`, piA1: `pi_${P}A1`,
  csA2: `cs_${P}A2`, piA2: `pi_${P}A2`, chA2: `ch_${P}A2`,
  piA3: `pi_${P}A3`, chA3: `ch_${P}A3`,
  piA4: `pi_${P}A4`, chA4: `ch_${P}A4`,
  chB1: `ch_${P}B1`, piB1: `pi_${P}B1`,
  chC1: `ch_${P}C1`,
  plinkA: `plink_${P}A`, plinkLegacy: `plink_${P}legacy`,
  capA5: `cap_${P}A5`,
  csA6: `cs_${P}A6`, piA6: `pi_${P}A6`, chA6: `ch_${P}A6`,
  chA7: `ch_${P}A7link`, piA7: `pi_${P}A7link`,
  chBlink: `ch_${P}Blink`, piBlink: `pi_${P}Blink`,
};

const A_EMAIL = `alice.of.a.${P}@example.test`;
const B_EMAIL = `bob.of.b.${P}@example.test`;
const LINK_EMAIL = `link.payer.of.b.${P}@example.test`;
/** The webhook secret B sets for itself (Settings > Payments) without a Stripe key of its own. */
const B_WHSEC = `whsec_${P}B_own`;
const DEPOSIT_KEYS = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR']);

let db: any;
let app: any;
let paymentsSvc: any;
let storedBalanceFn: (total: number, rows: Array<{ amount: number; status: string }>, currency?: string) => any;
let realFetch: typeof fetch;
const savedEnv: Record<string, string | undefined> = {};

const eventStub = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

// ---------------------------------------------------------------------------
// Fake Stripe / PayPal (no network). Accounts are keyed by the bearer key.
// ---------------------------------------------------------------------------

interface Call { method: string; host: string; path: string; auth: string | null; body: string }
interface FakeCharge {
  id: string; object: 'charge'; amount: number; amount_refunded: number; currency: string; status: string; paid: boolean;
  refunded: boolean; payment_intent: string | null; description: string | null; created: number;
  billing_details: { name: string | null; email: string | null }; metadata: Record<string, string>;
}
interface FakeRefund { id: string; object: 'refund'; amount: number; currency: string; charge: string; payment_intent: string | null; status: string; reason: string | null; created: number }
interface FakeLink {
  id: string; object: 'payment_link'; url: string; active: boolean; created: number; metadata: Record<string, string>;
  line: { amount_total: number; currency: string; description: string };
  /** payment_intent_data[metadata] the link was created with (the metadata Stripe sets on each PaymentIntent it takes). */
  intentMetadata: Record<string, string>;
}
/** A completed Checkout Session: its metadata stays on the session (Stripe copies a payment link's metadata onto it). */
interface FakeSession {
  id: string; object: 'checkout.session'; status: 'complete'; payment_intent: string | null; payment_link: string | null;
  client_reference_id: string | null; metadata: Record<string, string>; created: number;
}
interface FakeAccount { charges: FakeCharge[]; refunds: FakeRefund[]; links: FakeLink[]; sessions: FakeSession[]; prices: Record<string, { unit_amount: number; currency: string; name: string }> }

const calls: Call[] = [];
/** Refunds the fake Stripe performed and has not yet delivered as refund.created. */
const pendingRefundEvents: FakeRefund[] = [];
let seq = 0;
const now = () => Math.floor(Date.now() / 1000);

function charge(id: string, amountMinor: number, opts: { pi?: string | null; name?: string; email?: string; invoiceId?: string; created?: number } = {}): FakeCharge {
  return {
    id, object: 'charge', amount: amountMinor, amount_refunded: 0, currency: 'ttd', status: 'succeeded', paid: true, refunded: false,
    payment_intent: opts.pi ?? null, description: opts.invoiceId ? `Invoice ${opts.invoiceId}` : null, created: opts.created ?? now(),
    billing_details: { name: opts.name ?? null, email: opts.email ?? null },
    metadata: opts.invoiceId ? { invoiceId: opts.invoiceId } : {},
  };
}

const accounts: Record<string, FakeAccount> = {};

function resetAccounts() {
  const t = now();
  accounts[PLATFORM_KEY] = {
    charges: [
      // A's customers paid A's invoices into the platform account.
      charge(S.chA1, 25000, { pi: S.piA1, name: 'Alice Customer-of-A', email: A_EMAIL, invoiceId: ID.invA1, created: t - 50 }),
      // A Checkout Session charge carries no metadata (the session's metadata stays on the session).
      charge(S.chA2, 10000, { pi: S.piA2, name: 'Alice Customer-of-A', email: A_EMAIL, created: t - 40 }),
      charge(S.chA3, 10000, { pi: S.piA3, name: 'Alice Customer-of-A', email: A_EMAIL, invoiceId: ID.invA3, created: t - 30 }),
      charge(S.chA4, 6000, { pi: S.piA4, name: 'Alice Customer-of-A', email: A_EMAIL, invoiceId: ID.invA4, created: t - 20 }),
      charge(S.chB1, 8000, { pi: S.piB1, name: 'Bob Customer-of-B', email: B_EMAIL, invoiceId: ID.invB1, created: t - 10 }),
    ],
    refunds: [],
    links: [
      { id: S.plinkA, object: 'payment_link', url: `https://buy.stripe.test/${S.plinkA}`, active: true, created: t - 60, metadata: { businessId: ID.bizA }, intentMetadata: { businessId: ID.bizA }, line: { amount_total: 1500, currency: 'ttd', description: 'A link' } },
      { id: S.plinkLegacy, object: 'payment_link', url: `https://buy.stripe.test/${S.plinkLegacy}`, active: true, created: t - 70, metadata: {}, intentMetadata: {}, line: { amount_total: 900, currency: 'ttd', description: 'legacy untagged link' } },
    ],
    // createStripeCheckout's session for A's invoice A2 (metadata invoiceId + businessId, client_reference_id).
    sessions: [
      { id: S.csA2, object: 'checkout.session', status: 'complete', payment_intent: S.piA2, payment_link: null, client_reference_id: ID.invA2, metadata: { invoiceId: ID.invA2, businessId: ID.bizA }, created: t - 41 },
    ],
    prices: {},
  };
  accounts[C_KEY] = {
    // C's own Stripe account: a charge C never recorded locally.
    charges: [charge(S.chC1, 3000, { name: 'Cora Customer-of-C', email: `cora.of.c.${P}@example.test`, created: t - 5 })],
    refunds: [],
    links: [],
    sessions: [],
    prices: {},
  };
}

/**
 * A customer pays a payment link on the account `key`: Stripe creates a completed Checkout Session carrying the
 * link's metadata and a charge whose own metadata is empty (the worst case: nothing copied onto the charge).
 */
function payLink(key: string, linkId: string, chargeId: string, pi: string, amountMinor: number, payer: { name: string; email: string }) {
  const acct = accounts[key];
  const link = acct.links.find((l) => l.id === linkId);
  if (!link) throw new Error(`fake Stripe: no link ${linkId}`);
  const t = now() + 5;
  acct.sessions.push({
    id: `cs_${chargeId.slice(3)}`, object: 'checkout.session', status: 'complete', payment_intent: pi, payment_link: linkId,
    client_reference_id: null, metadata: { ...link.metadata }, created: t,
  });
  acct.charges.push(charge(chargeId, amountMinor, { pi, name: payer.name, email: payer.email, created: t }));
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stripeApi(method: string, url: URL, auth: string | null, body: string): Response {
  const key = (auth ?? '').replace(/^Bearer\s+/, '');
  const acct = accounts[key];
  if (!acct) return json(401, { error: { message: 'Invalid API Key provided' } });
  const p = url.pathname;
  const form = new URLSearchParams(body);
  const limit = Number(url.searchParams.get('limit') ?? '10');
  let m: RegExpMatchArray | null;

  if (method === 'GET' && p === '/v1/charges') {
    return json(200, { object: 'list', data: [...acct.charges].sort((a, b) => b.created - a.created).slice(0, limit) });
  }
  if (method === 'GET' && (m = p.match(/^\/v1\/charges\/([^/]+)$/))) {
    const c = acct.charges.find((x) => x.id === decodeURIComponent(m![1]));
    return c ? json(200, c) : json(404, { error: { message: `No such charge: '${m[1]}'` } });
  }
  if (method === 'GET' && p === '/v1/checkout/sessions') {
    const pi = url.searchParams.get('payment_intent');
    const rows = acct.sessions.filter((x) => pi === null || x.payment_intent === pi);
    return json(200, { object: 'list', data: [...rows].sort((a, b) => b.created - a.created).slice(0, limit) });
  }
  if (method === 'GET' && p === '/v1/refunds') {
    return json(200, { object: 'list', data: [...acct.refunds].sort((a, b) => b.created - a.created).slice(0, limit) });
  }
  if (method === 'POST' && p === '/v1/refunds') {
    const c = acct.charges.find((x) => x.id === form.get('charge'));
    if (!c) return json(404, { error: { message: `No such charge: '${form.get('charge')}'` } });
    const left = c.amount - c.amount_refunded;
    const amount = form.has('amount') ? Number(form.get('amount')) : left;
    if (amount > left) return json(400, { error: { message: `Refund amount exceeds what is left of charge ${c.id}` } });
    seq += 1;
    const r: FakeRefund = {
      id: `re_${P}${seq}`, object: 'refund', amount, currency: c.currency, charge: c.id, payment_intent: c.payment_intent,
      status: 'succeeded', reason: form.get('reason'), created: now(),
    };
    c.amount_refunded += amount;
    c.refunded = c.amount_refunded >= c.amount;
    acct.refunds.push(r);
    pendingRefundEvents.push(r);
    return json(200, r);
  }
  if (method === 'GET' && p === '/v1/payment_links') {
    const active = url.searchParams.get('active');
    const rows = acct.links.filter((l) => active === null || String(l.active) === active);
    return json(200, { object: 'list', data: rows.sort((a, b) => b.created - a.created).slice(0, limit).map(({ line: _line, ...l }) => l) });
  }
  if (method === 'GET' && (m = p.match(/^\/v1\/payment_links\/([^/]+)\/line_items$/))) {
    const l = acct.links.find((x) => x.id === decodeURIComponent(m![1]));
    return l ? json(200, { object: 'list', data: [l.line] }) : json(404, { error: { message: `No such payment_link: '${m[1]}'` } });
  }
  if (method === 'GET' && (m = p.match(/^\/v1\/payment_links\/([^/]+)$/))) {
    const l = acct.links.find((x) => x.id === decodeURIComponent(m![1]));
    if (!l) return json(404, { error: { message: `No such payment_link: '${m[1]}'` } });
    const { line: _line, ...rest } = l;
    return json(200, rest);
  }
  if (method === 'POST' && (m = p.match(/^\/v1\/payment_links\/([^/]+)$/))) {
    const l = acct.links.find((x) => x.id === decodeURIComponent(m![1]));
    if (!l) return json(404, { error: { message: `No such payment_link: '${m[1]}'` } });
    if (form.has('active')) l.active = form.get('active') === 'true';
    const { line: _line, ...rest } = l;
    return json(200, rest);
  }
  if (method === 'POST' && p === '/v1/prices') {
    seq += 1;
    const id = `price_${P}${seq}`;
    acct.prices[id] = { unit_amount: Number(form.get('unit_amount')), currency: form.get('currency') ?? 'usd', name: form.get('product_data[name]') ?? '' };
    return json(200, { id, object: 'price', ...acct.prices[id] });
  }
  if (method === 'POST' && p === '/v1/payment_links') {
    const price = acct.prices[form.get('line_items[0][price]') ?? ''];
    if (!price) return json(400, { error: { message: 'No such price' } });
    seq += 1;
    const metadata: Record<string, string> = {};
    const intentMetadata: Record<string, string> = {};
    for (const [k, v] of form.entries()) {
      const mm = k.match(/^metadata\[(.+)\]$/);
      if (mm) metadata[mm[1]] = v;
      const im = k.match(/^payment_intent_data\[metadata\]\[(.+)\]$/);
      if (im) intentMetadata[im[1]] = v;
    }
    const l: FakeLink = {
      id: `plink_${P}${seq}`, object: 'payment_link', url: `https://buy.stripe.test/plink_${P}${seq}`, active: true, created: now(),
      metadata, intentMetadata, line: { amount_total: price.unit_amount, currency: price.currency, description: price.name },
    };
    acct.links.push(l);
    const { line: _line, ...rest } = l;
    return json(200, rest);
  }
  return json(404, { error: { message: `fake Stripe: unrouted ${method} ${p}` } });
}

function paypalApi(method: string, url: URL, body: string): Response {
  const p = url.pathname;
  const capture = p.match(/^\/v2\/payments\/captures\/([^/]+)$/);
  const captureRefund = p.match(/^\/v2\/payments\/captures\/([^/]+)\/refund$/);
  if (method === 'POST' && p === '/v1/oauth2/token') return json(200, { access_token: `pp_tok_${P}` });
  if (method === 'GET' && capture) {
    return json(200, { id: capture[1], amount: { currency_code: 'TTD', value: '40.00' } });
  }
  if (method === 'POST' && captureRefund) {
    const parsed = body ? JSON.parse(body) : {};
    seq += 1;
    return json(201, { id: `PPRF_${P}${seq}`, status: 'COMPLETED', amount: parsed.amount ?? { value: '40.00', currency_code: 'TTD' }, create_time: new Date().toISOString() });
  }
  return json(404, { message: `fake PayPal: unrouted ${method} ${p}` });
}

async function fakeFetch(input: any, init: any = {}): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const method = String(init.method ?? 'GET').toUpperCase();
  const headers = (init.headers ?? {}) as Record<string, string>;
  const auth = headers.Authorization ?? headers.authorization ?? null;
  const body = typeof init.body === 'string' ? init.body : init.body ? String(init.body) : '';
  calls.push({ method, host: url.host, path: `${url.pathname}${url.search}`, auth, body });
  if (url.host === 'api.stripe.com') return stripeApi(method, url, auth, body);
  if (url.host === 'api-m.paypal.com' || url.host === 'api-m.sandbox.paypal.com') return paypalApi(method, url, body);
  throw new Error(`v15d fake network: refused ${method} ${url.href}`);
}

/** The calls made since `mark`, as `METHOD host path`. */
function callsSince(mark: number): string[] {
  return calls.slice(mark).map((c) => `${c.method} ${c.host} ${c.path.split('?')[0]}`);
}

// ---------------------------------------------------------------------------
// Fixtures and helpers
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

/** A Stripe delivery signed with the deployment's own webhook secret, as Stripe signs it. */
async function stripeEvent(id: string, type: string, object: Record<string, unknown>) {
  const raw = JSON.stringify({ id: `${P}evt_${id}`, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const signature = `t=${t},v1=${createHmac('sha256', PLATFORM_WHSEC).update(`${t}.${raw}`).digest('hex')}`;
  return paymentsSvc.handleStripeWebhook(raw, signature);
}

/** Stripe's refund.created for every refund the fake performed since the last delivery (Stripe sends it after the refund). */
async function deliverRefundEvents() {
  while (pendingRefundEvents.length) {
    const r = pendingRefundEvents.shift()!;
    await stripeEvent(r.id, 'refund.created', { ...r });
  }
}

function as(user: string) {
  const server = app.getHttpServer();
  return {
    get: (url: string) => request(server).get(url).set(HEADER, user),
    post: (url: string, body: unknown) => request(server).post(url).set(HEADER, user).send(body as object),
    del: (url: string) => request(server).delete(url).set(HEADER, user),
  };
}

const ops = (biz: string) => `/payments/businesses/${biz}`;

async function invoiceRow(id: string): Promise<any> {
  return db.invoice.findUnique({ where: { id } });
}

/** `provider:providerPaymentId:status:amount:reference` of an invoice's rows, in write order. */
async function rowsOf(invoiceId: string): Promise<string[]> {
  const rows = await db.payment.findMany({ where: { invoiceId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return rows.map((r: any) => `${r.provider}:${r.providerPaymentId}:${r.status}:${Number(r.amount)}:${r.reference}`);
}

async function rowsOfBusiness(businessId: string): Promise<string[]> {
  const rows = await db.payment.findMany({ where: { businessId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return rows.map((r: any) => `${r.invoiceId}:${r.providerPaymentId}:${r.status}:${Number(r.amount)}:${r.reference}`);
}

async function paymentBy(providerPaymentId: string): Promise<any> {
  return db.payment.findUnique({ where: { providerPaymentId } });
}

/** `type:status:amount` of the transactions one payment sourced, in posting order. */
async function postingsOf(paymentId: string): Promise<string[]> {
  const txns = await db.financialTransaction.findMany({
    where: { sourceType: 'Payment', sourceId: paymentId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return txns.map((t: any) => `${t.type}:${t.status}:${Number(t.amount)}`);
}

const money = (n: number) => Math.round(n * 100) / 100;

/** LEDGER: the invoice's Payment-sourced transactions balance and their cash net equals the stored balance net (= `net`). */
async function expectLedgerAgrees(invoiceId: string, net: number) {
  const inv = await invoiceRow(invoiceId);
  const rows = await db.payment.findMany({ where: { invoiceId } });
  const txns = await db.financialTransaction.findMany({
    where: { businessId: inv.businessId, sourceType: 'Payment', sourceId: { in: rows.map((r: any) => r.id) } },
    include: { entries: { include: { account: { select: { systemKey: true } } } } },
  });
  for (const t of txns) {
    const d = money(t.entries.reduce((s: number, e: any) => s + Number(e.debit ?? 0), 0));
    const c = money(t.entries.reduce((s: number, e: any) => s + Number(e.credit ?? 0), 0));
    expect(d, `${invoiceId} ${t.externalRef}: debits = credits`).toBe(c);
  }
  const cashNet = money(
    txns
      .flatMap((t: any) => t.entries)
      .filter((e: any) => DEPOSIT_KEYS.has(e.account?.systemKey))
      .reduce((s: number, e: any) => s + Number(e.debit ?? 0) - Number(e.credit ?? 0), 0),
  );
  const balance = storedBalanceFn(Number(inv.total), rows.map((r: any) => ({ amount: Number(r.amount), status: r.status })), inv.currency);
  expect(cashNet, `${invoiceId}: ledger cash net = balance net`).toBe(balance.net);
  expect(balance.net, `${invoiceId}: balance net`).toBe(net);
}

/** Everything a list response says, flattened, to look for another tenant's figures. */
function flat(body: unknown): string {
  return JSON.stringify(body);
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_SANDBOX', 'WIPAY_API_KEY', 'WIPAY_ACCOUNT_NUMBER']) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  // The shared-platform configuration: one deployment key and webhook secret, no tenant key.
  process.env.STRIPE_SECRET_KEY = PLATFORM_KEY;
  process.env.STRIPE_WEBHOOK_SECRET = PLATFORM_WHSEC;

  realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch as unknown as typeof fetch;
  resetAccounts();

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { PaymentsOpsController } = await import('../src/modules/payments/payments-ops.controller');
  const { PaymentsOpsService } = await import('../src/modules/payments/payments-ops.service');
  const { CurrencyRatesService } = await import('../src/modules/payments/currency-rates.service');
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  const { StripeConnector } = await import('../src/core/connectors/implementations/stripe.connector');
  const { PayPalConnector } = await import('../src/core/connectors/implementations/paypal.connector');
  const { WiPayConnector } = await import('../src/core/connectors/implementations/wipay.connector');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const workflowMod = await import('../src/modules/commerce/invoice-workflow.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  storedBalanceFn = workflowMod.balanceOfStoredRows;

  const moduleRef = await Test.createTestingModule({
    controllers: [PaymentsOpsController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PaymentsOpsService,
      StripeConnector,
      PayPalConnector,
      WiPayConnector,
      { provide: EntityResolutionService, useValue: {} },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CurrencyRatesService, useValue: { toTtd: async (amount: number, currency: string) => (String(currency).toUpperCase() === 'TTD' ? amount : null) } },
      workflowMod.InvoiceWorkflowService,
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
    ],
  }).compile();
  const prisma = moduleRef.get(PrismaService);
  paymentsSvc = new PaymentsService(
    prisma,
    {} as any, // CommerceService: used on the pay-link paths only, never by the Stripe webhook door.
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
  app.useGlobalInterceptors(new TenantInterceptor(prisma));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();

  for (const [user, biz, contact, name, email, contactEmail, metaData] of [
    [ID.ownerA, ID.bizA, ID.contactA, 'V15D Biz A', `${P}owner_a@test.local`, A_EMAIL, {}],
    [ID.ownerB, ID.bizB, ID.contactB, 'V15D Biz B', `${P}owner_b@test.local`, B_EMAIL, {}],
    [ID.ownerC, ID.bizC, ID.contactC, 'V15D Biz C', `${P}owner_c@test.local`, `${P}c_c@test.local`, { stripeSecretKey: C_KEY }],
  ] as const) {
    await db.user.create({ data: { id: user, email, role: 'USER' } });
    await db.business.create({ data: { id: biz, name, ownerId: user, currency: 'TTD', accountingBasis: 'CASH', metaData } });
    await db.membership.create({ data: { id: `${user}_m`, userId: user, businessId: biz, role: 'OWNER' } });
    await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(biz);
    await db.contact.create({ data: { id: contact, businessId: biz, firstName: 'V15d', lastName: name, email: contactEmail } });
  }
  await db.user.create({ data: { id: ID.staffB, email: `${P}staff_b@test.local`, role: 'USER' } });
  await db.membership.create({ data: { id: `${ID.staffB}_m`, userId: ID.staffB, businessId: ID.bizB, role: 'STAFF', permissionScopes: { revenue: 'read' } } });

  const invoices: Array<[string, string, string, number]> = [
    [ID.invA1, ID.bizA, ID.contactA, 250],
    [ID.invA2, ID.bizA, ID.contactA, 100],
    [ID.invA3, ID.bizA, ID.contactA, 100],
    [ID.invA4, ID.bizA, ID.contactA, 60],
    [ID.invA5, ID.bizA, ID.contactA, 40],
    [ID.invB1, ID.bizB, ID.contactB, 80],
    [ID.invB2, ID.bizB, ID.contactB, 60],
    [ID.invA6, ID.bizA, ID.contactA, 50],
    [ID.invB3, ID.bizB, ID.contactB, 50],
    [ID.invB4, ID.bizB, ID.contactB, 1],
  ];
  let n = 0;
  for (const [id, biz, contact, total] of invoices) {
    n += 1;
    await db.invoice.create({
      data: {
        id, invoiceNumber: `V15D-${String(n).padStart(3, '0')}`, status: 'SENT', subtotal: total, total, currency: 'TTD',
        businessId: biz, contactId: contact,
        items: { create: [{ id: `${id}_item1`, description: `V15D item ${n}`, quantity: 1, unitPrice: total, total }] },
      },
    });
  }

  // Each payment recorded through the real webhook door, platform-signed, as Stripe delivers it.
  await stripeEvent('ch_A1', 'charge.succeeded', { id: S.chA1, amount: 25000, currency: 'ttd', payment_intent: S.piA1, metadata: { invoiceId: ID.invA1 } });
  await stripeEvent('cs_A2', 'checkout.session.completed', { id: S.csA2, client_reference_id: ID.invA2, amount_total: 10000, currency: 'ttd', payment_intent: S.piA2, metadata: { invoiceId: ID.invA2, businessId: ID.bizA } });
  await stripeEvent('pi_A3', 'payment_intent.succeeded', { id: S.piA3, amount_received: 10000, currency: 'ttd', latest_charge: S.chA3, metadata: { invoiceId: ID.invA3 } });
  await stripeEvent('pi_A4', 'payment_intent.succeeded', { id: S.piA4, amount_received: 6000, currency: 'ttd', latest_charge: S.chA4, metadata: { invoiceId: ID.invA4 } });
  await stripeEvent('ch_B1', 'charge.succeeded', { id: S.chB1, amount: 8000, currency: 'ttd', payment_intent: S.piB1, metadata: { invoiceId: ID.invB1 } });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (realFetch) globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('fixtures', () => {
  it('each payment is recorded for its own business through the door, and each invoice is PAID', async () => {
    expect(await paymentBy(S.chA1)).toMatchObject({ businessId: ID.bizA, invoiceId: ID.invA1, status: 'SUCCESSFUL', amount: 250, reference: S.piA1 });
    expect(await paymentBy(S.csA2)).toMatchObject({ businessId: ID.bizA, invoiceId: ID.invA2, status: 'SUCCESSFUL', amount: 100, reference: S.piA2 });
    expect(await paymentBy(S.piA3)).toMatchObject({ businessId: ID.bizA, invoiceId: ID.invA3, status: 'SUCCESSFUL', amount: 100, reference: S.chA3 });
    expect(await paymentBy(S.piA4)).toMatchObject({ businessId: ID.bizA, invoiceId: ID.invA4, status: 'SUCCESSFUL', amount: 60, reference: S.chA4 });
    expect(await paymentBy(S.chB1)).toMatchObject({ businessId: ID.bizB, invoiceId: ID.invB1, status: 'SUCCESSFUL', amount: 80, reference: S.piB1 });
    for (const inv of [ID.invA1, ID.invA2, ID.invA3, ID.invA4, ID.invB1]) expect((await invoiceRow(inv)).status, inv).toBe('PAID');
    // Neither tenant stores a key: every Stripe operation of A and B runs on the platform key.
    expect((await db.business.findUnique({ where: { id: ID.bizA } })).metaData).toEqual({});
    expect((await db.business.findUnique({ where: { id: ID.bizB } })).metaData).toEqual({});
  });
});

describe('SOT-01/02: a tenant lists and searches only its own charges on the shared platform key', () => {
  it('SOT-01: B lists only B\'s charge (no charge, customer or invoice id of A); A lists its own (by id, by reference, through its Checkout Session\'s payment_intent) and not B\'s', async () => {
    const mark = calls.length;
    const b = await as(ID.ownerB).get(`${ops(ID.bizB)}/transactions`);
    expect(b.status, flat(b.body)).toBe(200);
    // RED-BEFORE: [ch_B1, ch_A4, ch_A3, ch_A2, ch_A1]: A's charges, figures, customer and invoice ids served to B.
    expect(b.body.map((t: any) => t.id)).toEqual([S.chB1]);
    for (const leak of [S.chA1, S.chA2, S.chA3, S.chA4, A_EMAIL, 'Alice Customer-of-A', ID.invA1, ID.invA3, ID.invA4]) {
      expect(flat(b.body), `B's list carries ${leak}`).not.toContain(leak);
    }
    // The live read is the platform account's (the key B has): filtered before anything reaches B.
    expect(calls.slice(mark).filter((c) => c.host === 'api.stripe.com').map((c) => c.auth)).toEqual(
      calls.slice(mark).filter((c) => c.host === 'api.stripe.com').map(() => `Bearer ${PLATFORM_KEY}`),
    );

    const a = await as(ID.ownerA).get(`${ops(ID.bizA)}/transactions`);
    expect(a.status, flat(a.body)).toBe(200);
    const aIds = a.body.map((t: any) => t.id);
    // RED-BEFORE: A's list carried B's charge ch_B1 too.
    expect(aIds).not.toContain(S.chB1);
    expect(flat(a.body)).not.toContain(B_EMAIL);
    expect(aIds).toEqual(expect.arrayContaining([S.chA1, S.chA2, S.chA3, S.chA4, S.csA2, S.piA3, S.piA4]));
    expect(a.body.find((t: any) => t.id === S.chA2)).toMatchObject({ customerEmail: A_EMAIL, amount: 100, currency: 'TTD' });
  }, 60_000);

  it('SOT-02: B\'s search for A\'s customer finds nothing; A\'s finds A\'s charges', async () => {
    const b = await as(ID.ownerB).get(`${ops(ID.bizB)}/transactions?q=${encodeURIComponent('alice')}`);
    expect(b.status, flat(b.body)).toBe(200);
    // RED-BEFORE: A's four charges.
    expect(b.body).toEqual([]);
    const byInvoice = await as(ID.ownerB).get(`${ops(ID.bizB)}/transactions?q=${encodeURIComponent(ID.invA1)}`);
    expect(byInvoice.body).toEqual([]);

    const a = await as(ID.ownerA).get(`${ops(ID.bizA)}/transactions?q=${encodeURIComponent('alice')}`);
    expect(a.status).toBe(200);
    expect(a.body.map((t: any) => t.id)).toEqual(expect.arrayContaining([S.chA1, S.chA2, S.chA3, S.chA4]));
  }, 60_000);
});

describe('SOT-03/04/05: a refund names the business\'s own charge, or is 404 before any write to the provider', () => {
  it('SOT-03 (F1): B\'s refund of A\'s charge, recorded by A under the charge id or as its PaymentIntent\'s reference, is 404 with no provider write (one read of the charge); A\'s invoices stay PAID and no row moves', async () => {
    const aBefore = await rowsOfBusiness(ID.bizA);
    const bBefore = await rowsOfBusiness(ID.bizB);
    for (const chargeId of [S.chA1, S.chA3]) {
      const mark = calls.length;
      const res = await as(ID.ownerB).post(`${ops(ID.bizB)}/refunds`, { gateway: 'stripe', chargeId, amount: 10, reason: 'requested_by_customer' });
      // RED-BEFORE: 201, Stripe received POST /v1/refunds with the platform key for A's charge.
      expect(res.status, `${chargeId}: ${flat(res.body)}`).toBe(404);
      // The one call is the read of the provider's record (the charge's metadata names A's invoice); no write.
      expect(callsSince(mark), `${chargeId}: provider calls`).toEqual([`GET api.stripe.com /v1/charges/${chargeId}`]);
      expect(calls.slice(mark).map((c) => c.auth)).toEqual([`Bearer ${PLATFORM_KEY}`]);
      // Stripe sends refund.created for a refund it performed; RED-BEFORE it reopened A's invoice.
      await deliverRefundEvents();
    }
    expect((await invoiceRow(ID.invA1)).status).toBe('PAID');
    expect((await invoiceRow(ID.invA3)).status).toBe('PAID');
    expect(await rowsOfBusiness(ID.bizA)).toEqual(aBefore);
    expect(await rowsOfBusiness(ID.bizB)).toEqual(bBefore);
    expect(accounts[PLATFORM_KEY].refunds).toEqual([]);
  }, 60_000);

  it('SOT-04: B\'s refund of the charge of A\'s Checkout Session payment (charge id not stored) is 404 with no write to Stripe (reads of the charge and of the Checkout Session of its payment_intent)', async () => {
    const mark = calls.length;
    const res = await as(ID.ownerB).post(`${ops(ID.bizB)}/refunds`, { gateway: 'stripe', chargeId: S.chA2 });
    // RED-BEFORE: 201 and A's Checkout payment refunded in full at the provider.
    expect(res.status, flat(res.body)).toBe(404);
    expect(callsSince(mark).filter((c) => c.startsWith('POST'))).toEqual([]);
    // The charge carries no metadata; the session of its payment_intent names A (createStripeCheckout's tag).
    expect(callsSince(mark)).toEqual([`GET api.stripe.com /v1/charges/${S.chA2}`, 'GET api.stripe.com /v1/checkout/sessions']);
    expect(calls.slice(mark).at(-1)!.path).toBe(`/v1/checkout/sessions?payment_intent=${S.piA2}&limit=1`);
    await deliverRefundEvents();
    expect((await invoiceRow(ID.invA2)).status).toBe('PAID');
    expect(await rowsOf(ID.invA2)).toEqual([`stripe:${S.csA2}:SUCCESSFUL:100:${S.piA2}`]);
    expect(accounts[PLATFORM_KEY].refunds).toEqual([]);
  }, 60_000);

  it('SOT-05: a charge nobody recorded is 404 exactly like another tenant\'s charge, with no refund call', async () => {
    const foreign = await as(ID.ownerB).post(`${ops(ID.bizB)}/refunds`, { gateway: 'stripe', chargeId: S.chA1 });
    const mark = calls.length;
    const unknown = await as(ID.ownerA).post(`${ops(ID.bizA)}/refunds`, { gateway: 'stripe', chargeId: `ch_${P}nope` });
    const notACharge = await as(ID.ownerA).post(`${ops(ID.bizA)}/refunds`, { gateway: 'stripe', chargeId: `${P}nope` });
    // RED-BEFORE: 500 (Stripe's "No such charge" surfaced as an internal error).
    expect(unknown.status, flat(unknown.body)).toBe(404);
    expect(notACharge.status, flat(notACharge.body)).toBe(404);
    expect(foreign.status).toBe(404);
    const shape = (b: any) => ({ statusCode: b.statusCode, message: b.message, error: b.error, code: b.code });
    expect(shape(unknown.body)).toEqual(shape(foreign.body));
    expect(shape(notACharge.body)).toEqual(shape(foreign.body));
    expect(callsSince(mark).filter((c) => c.startsWith('POST'))).toEqual([]);
  }, 60_000);
});

describe('SOT-06/07: payment links on the shared key are the business\'s own (tagged with its id)', () => {
  it('SOT-06: B lists none of the platform\'s links that are not B\'s; a link B creates is tagged with B\'s id and listed for B only', async () => {
    const mark = calls.length;
    const b = await as(ID.ownerB).get(`${ops(ID.bizB)}/links`);
    expect(b.status, flat(b.body)).toBe(200);
    // RED-BEFORE: A's link and the untagged legacy link, with their line items looked up.
    expect(b.body).toEqual([]);
    expect(callsSince(mark).filter((c) => c.includes('/line_items'))).toEqual([]);

    const created = await as(ID.ownerB).post(`${ops(ID.bizB)}/links`, { gateway: 'stripe', amount: 25, currency: 'TTD', description: 'V15D B link' });
    expect(created.status, flat(created.body)).toBe(201);
    const post = calls.filter((c) => c.method === 'POST' && c.path === '/v1/payment_links').at(-1)!;
    // RED-BEFORE: no businessId on the link, so nothing could tell B's link from A's.
    expect(new URLSearchParams(post.body).get('metadata[businessId]')).toBe(ID.bizB);

    const bAfter = await as(ID.ownerB).get(`${ops(ID.bizB)}/links`);
    expect(bAfter.body.map((l: any) => l.id)).toEqual([created.body.id]);
    expect(bAfter.body[0]).toMatchObject({ amount: 25, currency: 'TTD', description: 'V15D B link' });
    const a = await as(ID.ownerA).get(`${ops(ID.bizA)}/links`);
    expect(a.body.map((l: any) => l.id)).toEqual([S.plinkA]);
  }, 60_000);

  it('SOT-07: B\'s revoke of A\'s link is 404 on both routes and Stripe gets no write; A revokes its own', async () => {
    for (const url of [`${ops(ID.bizB)}/links/stripe/${S.plinkA}`, `${ops(ID.bizB)}/links/${S.plinkA}?gateway=stripe`]) {
      const mark = calls.length;
      const res = await as(ID.ownerB).del(url);
      // RED-BEFORE: 200 {ok:true} and POST /v1/payment_links/plink_A active=false with the platform key.
      expect(res.status, `${url}: ${flat(res.body)}`).toBe(404);
      expect(callsSince(mark).filter((c) => c.startsWith('POST'))).toEqual([]);
    }
    expect(accounts[PLATFORM_KEY].links.find((l) => l.id === S.plinkA)?.active).toBe(true);

    const own = await as(ID.ownerA).del(`${ops(ID.bizA)}/links/stripe/${S.plinkA}`);
    expect(own.status, flat(own.body)).toBe(200);
    expect(own.body).toEqual({ ok: true });
    expect(accounts[PLATFORM_KEY].links.find((l) => l.id === S.plinkA)?.active).toBe(false);
  }, 60_000);
});

describe('SOT-08: the payments-ops routes keep revenue:write for refunds and link writes, revenue:read for lists', () => {
  it('SOT-08: a revenue:read STAFF member lists, and is 403 on a refund and a link write with no provider call', async () => {
    const list = await as(ID.staffB).get(`${ops(ID.bizB)}/transactions`);
    expect(list.status, flat(list.body)).toBe(200);
    expect(list.body.map((t: any) => t.id)).toEqual([S.chB1]);
    expect((await as(ID.staffB).get(`${ops(ID.bizB)}/links`)).status).toBe(200);

    const mark = calls.length;
    const refund = await as(ID.staffB).post(`${ops(ID.bizB)}/refunds`, { gateway: 'stripe', chargeId: S.chB1 });
    expect(refund.status, flat(refund.body)).toBe(403);
    const link = await as(ID.staffB).post(`${ops(ID.bizB)}/links`, { gateway: 'stripe', amount: 5, currency: 'TTD', description: 'nope' });
    expect(link.status).toBe(403);
    const revoke = await as(ID.staffB).del(`${ops(ID.bizB)}/links/stripe/${S.plinkA}`);
    expect(revoke.status).toBe(403);
    expect(callsSince(mark)).toEqual([]);
    expect(await rowsOf(ID.invB1)).toEqual([`stripe:${S.chB1}:SUCCESSFUL:80:${S.piB1}`]);
  }, 60_000);
});

describe('SOT-09/10: the business\'s own refund still works, end to end through the V1-29c refund door', () => {
  it('SOT-09: A refunds 40 of its Checkout Session payment and all of its PaymentIntent payment: one POST each (platform key); Stripe\'s refund.created writes ONE linked negative row and posts it; the invoice reopens; the ledger agrees', async () => {
    const cs = await paymentBy(S.csA2);
    let mark = calls.length;
    const part = await as(ID.ownerA).post(`${ops(ID.bizA)}/refunds`, { gateway: 'stripe', chargeId: S.chA2, amount: 40, reason: 'requested_by_customer' });
    expect(part.status, flat(part.body)).toBe(201);
    expect(part.body).toMatchObject({ chargeId: S.chA2, amount: 40, currency: 'TTD', status: 'succeeded', provider: 'stripe' });
    const posts = calls.slice(mark).filter((c) => c.method === 'POST');
    expect(posts.map((c) => `${c.path} ${c.auth}`)).toEqual([`/v1/refunds Bearer ${PLATFORM_KEY}`]);
    expect(Object.fromEntries(new URLSearchParams(posts[0].body))).toMatchObject({ charge: S.chA2, amount: '4000', reason: 'requested_by_customer' });

    await deliverRefundEvents();
    expect(await rowsOf(ID.invA2)).toEqual([
      `stripe:${S.csA2}:SUCCESSFUL:100:${S.piA2}`,
      `stripe:${part.body.id}:REFUNDED:-40:${S.csA2}`,
    ]);
    expect(await postingsOf(cs.id)).toEqual(['INCOME:POSTED:100', 'REFUND:POSTED:40']);
    expect((await invoiceRow(ID.invA2)).status).toBe('PARTIALLY_PAID');
    await expectLedgerAgrees(ID.invA2, 60);

    const pi = await paymentBy(S.piA3);
    mark = calls.length;
    const whole = await as(ID.ownerA).post(`${ops(ID.bizA)}/refunds`, { gateway: 'stripe', chargeId: S.chA3 });
    expect(whole.status, flat(whole.body)).toBe(201);
    expect(whole.body).toMatchObject({ chargeId: S.chA3, amount: 100 });
    expect(calls.slice(mark).filter((c) => c.method === 'POST').map((c) => `${c.path} ${c.auth}`)).toEqual([`/v1/refunds Bearer ${PLATFORM_KEY}`]);
    await deliverRefundEvents();
    expect(await rowsOf(ID.invA3)).toEqual([
      `stripe:${S.piA3}:SUCCESSFUL:100:${S.chA3}`,
      `stripe:${whole.body.id}:REFUNDED:-100:${S.piA3}`,
    ]);
    expect(await postingsOf(pi.id)).toEqual(['INCOME:REVERSED:100', 'REVERSAL:POSTED:100']);
    const inv = await invoiceRow(ID.invA3);
    expect(inv.status).toBe('SENT');
    expect(inv.paidAt).toBeNull();
    await expectLedgerAgrees(ID.invA3, 0);
  }, 60_000);

  it('SOT-10: A refunds its payment recorded under the charge id: one POST, one negative row linked to the payment, and Stripe\'s refund.created writes no second row', async () => {
    const mark = calls.length;
    const res = await as(ID.ownerA).post(`${ops(ID.bizA)}/refunds`, { gateway: 'stripe', chargeId: S.chA1, amount: 250 });
    expect(res.status, flat(res.body)).toBe(201);
    expect(calls.slice(mark).filter((c) => c.method === 'POST').map((c) => `${c.path} ${c.auth}`)).toEqual([`/v1/refunds Bearer ${PLATFORM_KEY}`]);
    await deliverRefundEvents();
    expect(await rowsOf(ID.invA1)).toEqual([
      `stripe:${S.chA1}:SUCCESSFUL:250:${S.piA1}`,
      `stripe:${res.body.id}:REFUNDED:-250:${S.chA1}`,
    ]);
  }, 60_000);

  it.todo(
    'SOT-10b: the refund of a payment recorded under its charge id posts and reopens the invoice: payments-ops refundCharge ' +
      'writes that row itself, unposted, before Stripe\'s refund.created, which then finds the row by its refund id and posts ' +
      'nothing (money-state-writer-inventory PAYMENTS_MODULE_WRITERS: refundCharge "unposted", owner V1-29-DM-REFUND-CONVENTION). ' +
      'Routing it through the door needs PaymentsService.createRefundWithPosting (payments.service.ts, owned by V1-05) or ' +
      'removing the writer (money-state-writer-inventory.spec.ts): both outside the V1-15d write set',
  );
});

describe('SOT-11: a row of B naming A\'s charge does not make it B\'s', () => {
  it('SOT-11: with B\'s own row referencing A\'s charge, B\'s refund of it is 404 with no provider write and B\'s list omits it', async () => {
    // The row a delivery B signs with its own webhook secret can write (review SEC-V29C-1: a tenant can store any id in the reference).
    await db.payment.create({
      data: {
        businessId: ID.bizB, invoiceId: ID.invB2, amount: 60, currency: 'TTD', status: 'SUCCESSFUL', provider: 'stripe',
        providerPaymentId: `cs_${P}Bforged`, reference: S.chA4,
      },
    });
    const mark = calls.length;
    const res = await as(ID.ownerB).post(`${ops(ID.bizB)}/refunds`, { gateway: 'stripe', chargeId: S.chA4 });
    // RED-BEFORE: 201 and A's charge refunded with the platform key.
    expect(res.status, flat(res.body)).toBe(404);
    // B's row is not evidence on the shared key: the one call reads the charge, whose metadata names A's invoice.
    expect(callsSince(mark)).toEqual([`GET api.stripe.com /v1/charges/${S.chA4}`]);
    await deliverRefundEvents();
    expect((await invoiceRow(ID.invA4)).status).toBe('PAID');

    const list = await as(ID.ownerB).get(`${ops(ID.bizB)}/transactions`);
    expect(list.status).toBe(200);
    expect(list.body.map((t: any) => t.id)).not.toContain(S.chA4);
    expect(flat(list.body)).not.toContain(A_EMAIL);
  }, 60_000);
});

describe('SOT-12: the ownership check is the service\'s, for every gateway', () => {
  it('SOT-12: B\'s refund of A\'s PayPal capture (platform PayPal credentials) is 404 with zero PayPal calls', async () => {
    await db.payment.create({
      data: {
        businessId: ID.bizA, invoiceId: ID.invA5, amount: 40, currency: 'TTD', status: 'SUCCESSFUL', provider: 'paypal',
        providerPaymentId: S.capA5,
      },
    });
    process.env.PAYPAL_CLIENT_ID = PAYPAL_PLATFORM_ID;
    process.env.PAYPAL_CLIENT_SECRET = `pp_${P}platform_secret`;
    try {
      const mark = calls.length;
      const res = await as(ID.ownerB).post(`${ops(ID.bizB)}/refunds`, { gateway: 'paypal', chargeId: S.capA5, amount: 40 });
      // RED-BEFORE: 201 after POST /v2/payments/captures/cap_A5/refund with the platform PayPal credentials.
      expect(res.status, flat(res.body)).toBe(404);
      expect(callsSince(mark)).toEqual([]);
      expect(await rowsOf(ID.invA5)).toEqual([`paypal:${S.capA5}:SUCCESSFUL:40:null`]);
    } finally {
      delete process.env.PAYPAL_CLIENT_ID;
      delete process.env.PAYPAL_CLIENT_SECRET;
    }
  }, 60_000);
});

describe('SOT-13: a business with its own Stripe key (control)', () => {
  it('SOT-13: C lists its own account unfiltered, never with the platform key; a charge C never recorded is still 404 on refund, with no refund call', async () => {
    let mark = calls.length;
    const c = await as(ID.ownerC).get(`${ops(ID.bizC)}/transactions`);
    expect(c.status, flat(c.body)).toBe(200);
    expect(c.body.map((t: any) => t.id)).toEqual([S.chC1]);
    const stripeCalls = calls.slice(mark).filter((x) => x.host === 'api.stripe.com');
    expect(stripeCalls.length).toBeGreaterThan(0);
    expect(stripeCalls.every((x) => x.auth === `Bearer ${C_KEY}`)).toBe(true);
    for (const other of [ID.bizA, ID.bizB]) {
      const owner = other === ID.bizA ? ID.ownerA : ID.ownerB;
      expect((await as(owner).get(`${ops(other)}/transactions`)).body.map((t: any) => t.id)).not.toContain(S.chC1);
    }

    mark = calls.length;
    const refund = await as(ID.ownerC).post(`${ops(ID.bizC)}/refunds`, { gateway: 'stripe', chargeId: S.chC1 });
    // RED-BEFORE: 201 (refunded in C's account; no row, the payment was never recorded).
    expect(refund.status, flat(refund.body)).toBe(404);
    expect(callsSince(mark).filter((x) => x.startsWith('POST'))).toEqual([]);
    expect(accounts[C_KEY].refunds).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// V1-15d review repairs. On the shared platform key a Payment row is not proof
// of ownership: a tenant writes its own rows (the manual payment route takes any
// method and reference; a delivery signed with its own webhook secret records
// any id). Ownership there is the provider's record: the businessId (or
// invoiceId) metadata the platform itself wrote on the charge or on the
// Checkout Session that took it (createStripeCheckout; a payment link, whose
// metadata Stripe copies onto its sessions).
// ---------------------------------------------------------------------------

/** The row the manual payment route writes (commerce.service: provider = method, reference = the member's input, recordedBy = the member). */
async function manualRow(businessId: string, invoiceId: string, provider: string, key: string, reference: string, recordedBy: string) {
  return db.payment.create({
    data: {
      businessId, invoiceId, amount: 1, currency: 'TTD', status: 'SUCCESSFUL', provider, method: provider,
      providerPaymentId: `${P}manual_${key}`, reference, recordedBy,
    },
  });
}

/** Runs `fn` with one Stripe GET answered `status` (a provider failure), every other call reaching the fake. */
async function withFailingGet<T>(pathname: string, status: number, fn: () => Promise<T>): Promise<T> {
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (String(init.method ?? 'GET').toUpperCase() === 'GET' && url.host === 'api.stripe.com' && url.pathname === pathname) {
      calls.push({ method: 'GET', host: url.host, path: `${url.pathname}${url.search}`, auth: null, body: '' });
      return json(status, { error: { message: `fake Stripe: ${status}` } });
    }
    return inner(input, init);
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = inner;
  }
}

describe('V1-15d review: on the shared key a charge is the business\'s own by the provider\'s record, never by a tenant-writable row', () => {
  it('RV-01 (SEC-V15D-1): a manual "stripe" payment B records with A\'s Checkout charge as its reference neither lists A\'s charge or customer for B nor lets B refund it', async () => {
    // No row of A names ch_A2 (A's cs_A2 row holds its payment_intent): before the repair B's row was the only one, so it was B's.
    await manualRow(ID.bizB, ID.invB3, 'stripe', 'B_A2', S.chA2, ID.ownerB);
    const list = await as(ID.ownerB).get(`${ops(ID.bizB)}/transactions`);
    expect(list.status, flat(list.body)).toBe(200);
    // RED-BEFORE: ch_A2 listed for B with A's customer name and email.
    expect(list.body.map((t: any) => t.id)).not.toContain(S.chA2);
    for (const leak of [A_EMAIL, 'Alice Customer-of-A']) expect(flat(list.body), `B's list carries ${leak}`).not.toContain(leak);

    const aRows = await rowsOfBusiness(ID.bizA);
    const refundsBefore = accounts[PLATFORM_KEY].refunds.length;
    const mark = calls.length;
    const res = await as(ID.ownerB).post(`${ops(ID.bizB)}/refunds`, { gateway: 'stripe', chargeId: S.chA2 });
    // RED-BEFORE: 201 and A's charge refunded in full with the platform key.
    expect(res.status, flat(res.body)).toBe(404);
    expect(res.body.message).toBe('Charge not found');
    expect(callsSince(mark).filter((c) => !c.startsWith('GET'))).toEqual([]);
    expect(accounts[PLATFORM_KEY].refunds.length).toBe(refundsBefore);
    await deliverRefundEvents();
    expect(await rowsOfBusiness(ID.bizA)).toEqual(aRows);
  }, 60_000);

  it('RV-02 (CR-V15D-2, SEC-V15D-3): a row of B naming A\'s charge or payment_intent does not take the charge from A: A lists it and refunds it, B still cannot', async () => {
    // (a) SOT-11's row of B references A's ch_A4.
    expect(await paymentBy(`cs_${P}Bforged`)).toMatchObject({ businessId: ID.bizB, reference: S.chA4 });
    // (b) A takes a Checkout payment; B records a manual "stripe" payment naming its payment_intent.
    accounts[PLATFORM_KEY].sessions.push({
      id: S.csA6, object: 'checkout.session', status: 'complete', payment_intent: S.piA6, payment_link: null,
      client_reference_id: ID.invA6, metadata: { invoiceId: ID.invA6, businessId: ID.bizA }, created: now(),
    });
    accounts[PLATFORM_KEY].charges.push(charge(S.chA6, 5000, { pi: S.piA6, name: 'Alice Customer-of-A', email: A_EMAIL }));
    await stripeEvent('cs_A6', 'checkout.session.completed', {
      id: S.csA6, client_reference_id: ID.invA6, amount_total: 5000, currency: 'ttd', payment_intent: S.piA6,
      metadata: { invoiceId: ID.invA6, businessId: ID.bizA },
    });
    expect(await paymentBy(S.csA6)).toMatchObject({ businessId: ID.bizA, reference: S.piA6, status: 'SUCCESSFUL' });
    await manualRow(ID.bizB, ID.invB3, 'stripe', 'B_A6', S.piA6, ID.ownerB);

    const a = await as(ID.ownerA).get(`${ops(ID.bizA)}/transactions`);
    // RED-BEFORE: both charges dropped from A's list (named by a row of another business).
    expect(a.body.map((t: any) => t.id)).toEqual(expect.arrayContaining([S.chA4, S.chA6]));
    for (const [chargeId, amount] of [[S.chA4, 60], [S.chA6, 10]] as const) {
      const mark = calls.length;
      const res = await as(ID.ownerA).post(`${ops(ID.bizA)}/refunds`, { gateway: 'stripe', chargeId, amount });
      // RED-BEFORE: 404 'Charge not found' and no refund.
      expect(res.status, `${chargeId}: ${flat(res.body)}`).toBe(201);
      expect(res.body).toMatchObject({ chargeId, amount, provider: 'stripe' });
      expect(calls.slice(mark).filter((c) => c.method === 'POST').map((c) => `${c.path} ${c.auth}`)).toEqual([`/v1/refunds Bearer ${PLATFORM_KEY}`]);
    }
    for (const chargeId of [S.chA4, S.chA6]) {
      const mark = calls.length;
      const res = await as(ID.ownerB).post(`${ops(ID.bizB)}/refunds`, { gateway: 'stripe', chargeId });
      expect(res.status, `${chargeId}: ${flat(res.body)}`).toBe(404);
      expect(callsSince(mark).filter((c) => !c.startsWith('GET'))).toEqual([]);
    }
    // Stripe's refund.created for A's two refunds goes through the V1-29c door, whose handling of
    // ids two businesses' rows name (SEC-V29C-1) is payments.service.ts's, outside this write set.
    await deliverRefundEvents();
  }, 60_000);

  it('RV-03 (SEC-V15D-2): a sale through A\'s tagged payment link that nobody recorded is A\'s by the provider\'s record; a delivery B signs with its own secret naming it does not make it B\'s', async () => {
    payLink(PLATFORM_KEY, S.plinkA, S.chA7, S.piA7, 7000, { name: 'Alice Customer-of-A', email: A_EMAIL });
    await db.business.update({ where: { id: ID.bizB }, data: { metaData: { stripeWebhookSecret: B_WHSEC } } });
    try {
      const raw = JSON.stringify({
        id: `${P}evt_forged_B_A7`, type: 'charge.succeeded',
        data: { object: { id: S.chA7, amount: 100, currency: 'ttd', payment_intent: S.piA7, metadata: { invoiceId: ID.invB4 } } },
      });
      const ts = Math.floor(Date.now() / 1000);
      const sig = `t=${ts},v1=${createHmac('sha256', B_WHSEC).update(`${ts}.${raw}`).digest('hex')}`;
      expect(await paymentsSvc.handleStripeWebhook(raw, sig)).toMatchObject({ ok: true, processed: 'charge.succeeded' });
      // B's own row now names A's charge (B still has no Stripe key: it runs on the platform key).
      expect(await paymentBy(S.chA7)).toMatchObject({ businessId: ID.bizB, invoiceId: ID.invB4, status: 'SUCCESSFUL' });

      const list = await as(ID.ownerB).get(`${ops(ID.bizB)}/transactions`);
      expect(list.status).toBe(200);
      for (const leak of [A_EMAIL, 'Alice Customer-of-A']) expect(flat(list.body), `B's list carries ${leak}`).not.toContain(leak);

      let mark = calls.length;
      const b = await as(ID.ownerB).post(`${ops(ID.bizB)}/refunds`, { gateway: 'stripe', chargeId: S.chA7 });
      // RED-BEFORE: 201 and POST /v1/refunds charge=ch_A7link with the platform key.
      expect(b.status, flat(b.body)).toBe(404);
      expect(callsSince(mark).filter((c) => !c.startsWith('GET'))).toEqual([]);

      mark = calls.length;
      const a = await as(ID.ownerA).post(`${ops(ID.bizA)}/refunds`, { gateway: 'stripe', chargeId: S.chA7, amount: 20 });
      // RED-BEFORE: 404 (B's row was the only one naming it).
      expect(a.status, flat(a.body)).toBe(201);
      expect(calls.slice(mark).filter((c) => c.method === 'POST').map((c) => `${c.path} ${c.auth}`)).toEqual([`/v1/refunds Bearer ${PLATFORM_KEY}`]);
    } finally {
      await db.business.update({ where: { id: ID.bizB }, data: { metaData: {} } });
    }
    // The door's matching of a platform refund event to a row B forged is payments.service.ts's (outside this write set).
    await deliverRefundEvents();
  }, 60_000);

  it('RV-04 (CR-V15D-1, SEC-V15D-4): a sale through B\'s own payment link (never recorded: it carries no invoiceId) is listed for B and refundable by B, never by A', async () => {
    const created = await as(ID.ownerB).post(`${ops(ID.bizB)}/links`, { gateway: 'stripe', amount: 30, currency: 'TTD', description: 'V15D B link sale' });
    expect(created.status, flat(created.body)).toBe(201);
    const post = calls.filter((c) => c.method === 'POST' && c.path === '/v1/payment_links').at(-1)!;
    const form = new URLSearchParams(post.body);
    expect(form.get('metadata[businessId]')).toBe(ID.bizB);
    expect(form.get('payment_intent_data[metadata][businessId]')).toBe(ID.bizB);

    payLink(PLATFORM_KEY, created.body.id, S.chBlink, S.piBlink, 3000, { name: 'Link Payer', email: LINK_EMAIL });
    const bRows = await rowsOfBusiness(ID.bizB);
    const ack = await stripeEvent('cs_Blink', 'checkout.session.completed', {
      id: `cs_${P}Blink`, payment_link: created.body.id, amount_total: 3000, currency: 'ttd', payment_intent: S.piBlink,
      metadata: { businessId: ID.bizB },
    });
    expect(ack).toMatchObject({ ok: true, processed: 'checkout.session.completed' });
    expect(await rowsOfBusiness(ID.bizB)).toEqual(bRows);

    const b = await as(ID.ownerB).get(`${ops(ID.bizB)}/transactions`);
    // RED-BEFORE: absent (no Payment row names it).
    expect(b.body.find((t: any) => t.id === S.chBlink)).toMatchObject({ customerEmail: LINK_EMAIL, amount: 30, currency: 'TTD' });
    const a = await as(ID.ownerA).get(`${ops(ID.bizA)}/transactions`);
    expect(a.body.map((t: any) => t.id)).not.toContain(S.chBlink);
    expect(flat(a.body)).not.toContain(LINK_EMAIL);

    let mark = calls.length;
    const byA = await as(ID.ownerA).post(`${ops(ID.bizA)}/refunds`, { gateway: 'stripe', chargeId: S.chBlink });
    expect(byA.status, flat(byA.body)).toBe(404);
    expect(callsSince(mark).filter((c) => !c.startsWith('GET'))).toEqual([]);

    mark = calls.length;
    const own = await as(ID.ownerB).post(`${ops(ID.bizB)}/refunds`, { gateway: 'stripe', chargeId: S.chBlink, amount: 5 });
    // RED-BEFORE: 404 'Charge not found'.
    expect(own.status, flat(own.body)).toBe(201);
    const posts = calls.slice(mark).filter((c) => c.method === 'POST');
    expect(posts.map((c) => `${c.path} ${c.auth}`)).toEqual([`/v1/refunds Bearer ${PLATFORM_KEY}`]);
    expect(Object.fromEntries(new URLSearchParams(posts[0].body))).toMatchObject({ charge: S.chBlink, amount: '500' });
    await deliverRefundEvents();
    // The sale was never recorded, so its refund is not either.
    expect(await rowsOfBusiness(ID.bizB)).toEqual(bRows);
  }, 60_000);
});

describe('V1-15d review: a provider failure on an ownership read is an error, not "not found"', () => {
  it('RV-05 (CR-V15D-3): a 429 on the read of A\'s own link fails the revoke (no write, the link stays active); only Stripe\'s 404 is "not found"', async () => {
    const created = await as(ID.ownerA).post(`${ops(ID.bizA)}/links`, { gateway: 'stripe', amount: 12, currency: 'TTD', description: 'V15D A link 2' });
    expect(created.status, flat(created.body)).toBe(201);
    const linkPath = `/v1/payment_links/${created.body.id}`;
    const mark = calls.length;
    const res = await withFailingGet(linkPath, 429, () => as(ID.ownerA).del(`${ops(ID.bizA)}/links/stripe/${created.body.id}`));
    // RED-BEFORE: 404 'Payment link not found' while the link keeps taking payments.
    expect(res.status, flat(res.body)).toBe(500);
    expect(res.body.message).not.toBe('Payment link not found');
    expect(callsSince(mark).filter((c) => c.startsWith('POST'))).toEqual([]);
    expect(accounts[PLATFORM_KEY].links.find((l) => l.id === created.body.id)?.active).toBe(true);

    const unknown = await as(ID.ownerA).del(`${ops(ID.bizA)}/links/stripe/plink_${P}nope`);
    expect(unknown.status, flat(unknown.body)).toBe(404);
    expect(unknown.body.message).toBe('Payment link not found');

    const again = await as(ID.ownerA).del(`${ops(ID.bizA)}/links/stripe/${created.body.id}`);
    expect(again.status, flat(again.body)).toBe(200);
    expect(accounts[PLATFORM_KEY].links.find((l) => l.id === created.body.id)?.active).toBe(false);
  }, 60_000);

  it('RV-06: a 500 on the read that resolves A\'s own Checkout charge fails the refund (no write), not "Charge not found"', async () => {
    const mark = calls.length;
    const res = await withFailingGet(`/v1/charges/${S.chA2}`, 500, () =>
      as(ID.ownerA).post(`${ops(ID.bizA)}/refunds`, { gateway: 'stripe', chargeId: S.chA2, amount: 1 }),
    );
    expect(res.status, flat(res.body)).toBe(500);
    expect(res.body.message).not.toBe('Charge not found');
    expect(callsSince(mark).filter((c) => c.startsWith('POST'))).toEqual([]);
  }, 60_000);

  it('RV-06b (CR-V15D-4, rejected): the untagged legacy link names no business, so on the platform key it is no tenant\'s to revoke', async () => {
    for (const [owner, biz] of [[ID.ownerA, ID.bizA], [ID.ownerB, ID.bizB]] as const) {
      const mark = calls.length;
      const res = await as(owner).del(`${ops(biz)}/links/stripe/${S.plinkLegacy}`);
      expect(res.status, flat(res.body)).toBe(404);
      expect(callsSince(mark).filter((c) => c.startsWith('POST'))).toEqual([]);
    }
    expect(accounts[PLATFORM_KEY].links.find((l) => l.id === S.plinkLegacy)?.active).toBe(true);
  }, 60_000);
});

describe('V1-15d review: PayPal on the platform credentials', () => {
  it('RV-07 (SEC-V15D-3 for PayPal): a manual "paypal" payment B records naming A\'s capture neither blocks A\'s refund nor makes the capture B\'s', async () => {
    await manualRow(ID.bizB, ID.invB3, 'paypal', 'B_A5', S.capA5, ID.ownerB);
    process.env.PAYPAL_CLIENT_ID = PAYPAL_PLATFORM_ID;
    process.env.PAYPAL_CLIENT_SECRET = `pp_${P}platform_secret`;
    try {
      let mark = calls.length;
      const b = await as(ID.ownerB).post(`${ops(ID.bizB)}/refunds`, { gateway: 'paypal', chargeId: S.capA5, amount: 40 });
      expect(b.status, flat(b.body)).toBe(404);
      expect(callsSince(mark)).toEqual([]);

      mark = calls.length;
      const a = await as(ID.ownerA).post(`${ops(ID.bizA)}/refunds`, { gateway: 'paypal', chargeId: S.capA5, amount: 40 });
      // RED-BEFORE: 404 (B's row named the capture too).
      expect(a.status, flat(a.body)).toBe(201);
      expect(callsSince(mark)).toContain(`POST api-m.paypal.com /v2/payments/captures/${S.capA5}/refund`);
      const rows = await rowsOf(ID.invA5);
      expect(rows[0]).toBe(`paypal:${S.capA5}:SUCCESSFUL:40:null`);
      expect(rows.slice(1)).toEqual([expect.stringMatching(new RegExp(`^paypal:PPRF_${P}\\d+:REFUNDED:-40:${S.capA5}$`))]);
    } finally {
      delete process.env.PAYPAL_CLIENT_ID;
      delete process.env.PAYPAL_CLIENT_SECRET;
    }
  }, 60_000);
});
