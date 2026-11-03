/**
 * V1-46-PUB-PAY-LINK-TOKEN-GATE + V1-46b-TOKEN-PAY-COMPLETE — the customer pay
 * surface is keyed by the pay-link token (REAL database).
 *
 * M34 (P1). D-07, ruled 2026-10-31 by the owner: token links only, the
 * bare-id pay page is retired. At the V1-49 head:
 *
 *   - /pay/link/[token] reads GET /commerce/payment-links/:token, which hands
 *     out the invoice id, and router.replace()s to /pay/:invoiceId
 *     (pay/link/[token]/page.tsx:18-40); public/invoice/[token]'s Pay button
 *     goes through that page;
 *   - every API the /pay/:invoiceId page calls is keyed by the bare invoice
 *     id, among them POST /commerce/invoices/:invoiceId/payment-intent, so
 *     deactivating or expiring the link has no effect once the customer (or
 *     anyone holding the id) is past the first visit.
 *
 * Contract pinned here:
 *
 *   GET  /commerce/public/invoice-link/:token/pay             live link -> 200, the pay-page projection:
 *                                                             what the bare-id public read
 *                                                             (KF-REVENUE-AUTH-PROJECTION-001) answers an
 *                                                             anonymous caller, LESS the invoice id (V1-46b,
 *                                                             TG-16); no payment rows, bank details or
 *                                                             customer email
 *   POST /commerce/public/invoice-link/:token/payment-intent  live link -> the R0-22 intent contract
 *                                                             (one PENDING row on the invoice's own
 *                                                             tenant, status unchanged, 409 when settled)
 *   GET  /payments/public/invoice-link/:token/status          V1-46b: the five-key status of the token's invoice
 *   GET  /payments/public/invoice-link/:token/gateways        V1-46b: the gateway list of the token's tenant
 *   POST /payments/public/invoice-link/:token/checkout        V1-46b: a Stripe, WiPay or PayPal checkout for the
 *                                                             token's invoice ({ gateway, returnUrl | successUrl,
 *                                                             cancelUrl })
 *   POST /payments/public/invoice-link/:token/paypal/capture/:orderId
 *                                                             V1-46b: the PayPal capture, recorded against the
 *                                                             token's invoice (a body invoiceId is ignored);
 *                                                             review SEC-V46B-3: only an order made for that
 *                                                             invoice and its total is captured (400 otherwise,
 *                                                             nothing captured or written)
 *   deactivated (operator route), expired, inactive, unknown or foreign-tenant link, and a DRAFT,
 *   VOID or deleted invoice behind a live link
 *                                                          -> 404 on every customer action (pay page,
 *                                                             intent, receipt, status, gateways, checkout,
 *                                                             capture), one body, no provider called; the
 *                                                             link view answers its invalid_or_expired body
 *   POST /commerce/invoices/:invoiceId/payment-intent        retired -> 404, nothing written
 *   GET  /commerce/payment-links/:token                       retired -> 404 (the resolver that handed
 *                                                             out the invoice id for the downgrade)
 *   POST /payments/invoice/:id/{stripe,wipay,paypal/create-order}, POST /payments/paypal/capture/:orderId
 *                                                          -> V1-46b: retired (the token routes replace them)
 *   GET  /commerce/invoices/:invoiceId, GET /payments/invoice/:id/{status,gateways},
 *   POST /payments/create-checkout (invoice payables), anonymous
 *                                                          -> V1-46b: the unknown-id 404 for an invoice whose
 *                                                             own-tenant links are ALL revoked or expired; an
 *                                                             invoice with a live link, or one that never had
 *                                                             a link (release0-journey step 6 pins that one),
 *                                                             keeps the KF-REVENUE-AUTH-PROJECTION-001 answer;
 *                                                             the operator (authenticated, revenue:read) read
 *                                                             and the tenant-bound routes are unchanged
 *   guards                    -> PublicRateLimitGuard only on every token route (the token is the
 *                                credential); the public-surface ledger stays at 11 on both controllers
 *   producers                 -> every customer URL is /public/invoice/<token> (CommerceService
 *                                publicInvoiceUrl: createPaymentLink, else findAnyPaymentLink, as
 *                                send-email does); no source emits /pay/<invoiceId> or /widgets/pay/<id>.
 *                                Review SEC-V46B-1/2, CR-V46B-01: the automated producers (reminders,
 *                                payment-failed, KEY, autopilot) go through automatedInvoiceUrl: the live
 *                                link reused as it is (expiry kept), a link minted only for an invoice that
 *                                never had one and only once the contact has an email, and NO link (no pay
 *                                button) when every link was revoked or expired, so nothing reopens them
 *   webhooks                  -> Stripe, PayPal and WiPay callbacks still record the money for an invoice
 *                                whose link was revoked (keyed by the signed provider event)
 *   invoice id                -> the token read and the JSON token routes never carry it; the WiPay hosted
 *                                checkout does, as WiPay's order_id (its callback is keyed by it; review
 *                                SEC-V46B-4, TG-16b), and once the link is revoked that id reopens nothing
 *   LEDGER                    -> no Payment row, FinancialTransaction or LedgerEntry is reachable
 *                                through a revoked token
 *   TENANT                    -> a token of tenant B never reads or writes tenant A's invoice
 *
 * Nothing on the boundary is mocked: PrismaService, PublicRateLimitGuard (real
 * Redis at REDIS_URL, this suite's own key namespace), AuthGuard,
 * BusinessGuard, ModuleScopeGuard, CommerceService, PaymentsService,
 * InvoiceWorkflowService, InvoiceReceiptBuilderService and the real ledger
 * chain write and read real rows; the production GlobalHttpExceptionFilter +
 * ValidationPipe are installed. Links, payments and the deactivation are made
 * through the real operator routes. Identity attachment (operator routes
 * only) is a test middleware reading `x-v46a-user`; every customer request is
 * anonymous. The payment providers are stubbed at the network edge: global
 * fetch answers Stripe, WiPay and PayPal's verification endpoints and refuses
 * any other host, and the PayPal SDK client is replaced on the PaymentsService
 * instance, so no request leaves the process. Collaborators off the boundary
 * (contact timeline, stats cache, Gmail / AI / Drive, the producers' email
 * senders) are stubs.
 *
 * Fixtures: prefix `v46a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping. Literals in globally unique columns embed the prefix.
 */
import 'reflect-metadata';
import path from 'path';
import fs from 'fs';
import { createHash, createHmac } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import { computeBalance } from '../src/modules/commerce/invoice-workflow.service';
import { appUrl } from '../src/core/config/runtime-urls';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v46a_';
const HEADER = 'x-v46a-user';
const REPO = path.resolve(__dirname, '../../..');

/** Every fixture string that must never reach the customer carries this. */
const CANARY = 'V46A_SECRET_';

// This suite's public rate-limit keys live under its own namespace, so the
// resets below never touch another suite's windows on the same Redis index.
const RATE_LIMIT_NS = P;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

// Provider configuration for this process only (restored in afterAll). Every
// provider endpoint is answered by the fetch stub below; nothing goes out.
const PROVIDER_ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: `${P}sk_test`,
  STRIPE_PUBLISHABLE_KEY: `${P}pk_test`,
  STRIPE_WEBHOOK_SECRET: `${P}whsec`,
  PUBLIC_URL_ALLOWLIST: 'https://pay.v46a.test',
  WIPAY_API_KEY: `${P}wipay_key`,
  WIPAY_ACCOUNT_NUMBER: '4600000000',
  PAYPAL_CLIENT_ID: `${P}pp_client`,
  PAYPAL_CLIENT_SECRET: `${P}pp_secret`,
  PAYPAL_WEBHOOK_ID: `${P}pp_webhook`,
  PAYPAL_ENVIRONMENT: 'sandbox',
};
const PREVIOUS_PROVIDER_ENV: Record<string, string | undefined> = {};

const RETURN_URL = 'https://pay.v46a.test/pay/link/return';
const STRIPE_REDIRECT = 'https://checkout.v46a.test/stripe-session';
const WIPAY_REDIRECT = 'https://checkout.v46a.test/wipay-session';
const CHECKOUT_BODIES: Array<Record<string, string>> = [
  { gateway: 'stripe', successUrl: `${RETURN_URL}?stripe=success`, cancelUrl: `${RETURN_URL}?stripe=cancel` },
  { gateway: 'wipay', returnUrl: RETURN_URL },
  { gateway: 'paypal' },
];

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  // tenant A: one invoice per case, so balances and links never bleed between cases
  invLive: `${P}invLive`,
  invIntent: `${P}invIntent`,
  invPartial: `${P}invPartial`,
  invPaid: `${P}invPaid`,
  invRevoke: `${P}invRevoke`,
  invExpired: `${P}invExpired`,
  invInactive: `${P}invInactive`,
  invForeign: `${P}invForeign`,
  invDraft: `${P}invDraft`,
  invVoid: `${P}invVoid`,
  invDeleted: `${P}invDeleted`,
  invBare: `${P}invBare`,
  invLedger: `${P}invLedger`,
  invResolver: `${P}invResolver`,
  // V1-46b
  invTokPay: `${P}invTokPay`,
  invCapture: `${P}invCapture`,
  invNoLink: `${P}invNoLink`,
  invFlowOverdue: `${P}invFlowOverdue`,
  invDueSoon: `${P}invDueSoon`,
  invKeySend: `${P}invKeySend`,
  invRecovery: `${P}invRecovery`,
  invWhStripe: `${P}invWhStripe`,
  invWhPaypal: `${P}invWhPaypal`,
  invWhWipay: `${P}invWhWipay`,
  // tenant B
  invB: `${P}invB`,
  // V1-46b review repairs (tenant A; after invB so the earlier invoice numbers are unchanged)
  invAutoRevoked: `${P}invAutoRevoked`,
  invAutoExpired: `${P}invAutoExpired`,
  invAutoExpiring: `${P}invAutoExpiring`,
  invAutoNoEmail: `${P}invAutoNoEmail`,
  invCaptureBind: `${P}invCaptureBind`,
  invWipayRevoked: `${P}invWipayRevoked`,
};

/** Seeded PaymentLink rows (every other link is minted by the real route). */
const LINK = {
  expired: { id: `${P}link_expired`, token: `${P}tok_expired` },
  inactive: { id: `${P}link_inactive`, token: `${P}tok_inactive` },
  // A link row of tenant B pointing at tenant A's SENT invoice (M31: no FK ties the two).
  foreign: { id: `${P}link_foreign`, token: `${P}tok_foreign` },
  draft: { id: `${P}link_draft`, token: `${P}tok_draft` },
  void: { id: `${P}link_void`, token: `${P}tok_void` },
  deleted: { id: `${P}link_deleted`, token: `${P}tok_deleted` },
  // V1-46b review (SEC-V46B-2): a link that expired, and a live one with the operator's expiry.
  autoExpired: { id: `${P}link_auto_expired`, token: `${P}tok_auto_expired` },
  autoExpiring: { id: `${P}link_auto_expiring`, token: `${P}tok_auto_expiring` },
};
const UNKNOWN_TOKEN = `${P}tok_nosuchlink`;
const UNKNOWN_INVOICE = `${P}inv_nosuch`;

const TOTAL = 100;
const DAY_MS = 86_400_000;

let db: any;
let app: any;
let redis: any;
let commerce: any;
let payments: any;
let prismaService: any;
let CommerceControllerRef: any;
let PaymentsControllerRef: any;
let PublicRateLimitGuardRef: any;
let PUBLIC_RATE_LIMIT_KEY_REF: string;
let FlowListenerRef: any;
let FlowOrchestratorServiceRef: any;
let DelegationLoopServiceRef: any;
let EventEmitter2Ref: any;
let WiPayConnectorRef: any;

/** Route-minted links: invoice -> { id, token }. */
const LINK_OF: Record<string, { id: string; token: string }> = {};

let unknownPay: { status: number; body: any };
let unknownIntent: { status: number; body: any };
let unknownReceipt: { status: number; body: any };
let unknownView: { status: number; body: any };
let unknownTokStatus: { status: number; body: any };
let unknownTokGateways: { status: number; body: any };
let unknownTokCheckout: { status: number; body: any };
let unknownTokCapture: { status: number; body: any };
let unknownBareRead: { status: number; body: any };
let unknownBareStatus: { status: number; body: any };
let unknownBareGateways: { status: number; body: any };
let unknownBareCheckout: { status: number; body: any };

// ---- the provider edge: stubbed, recorded, never on the network -------------

const realFetch = globalThis.fetch;
const providerCalls: Array<{ url: string; body: string }> = [];
let checkoutSeq = 0;
/**
 * The orders the PayPal stub knows, with their purchase units: createOrder
 * records each one, a case may add one, and getOrder answers only these
 * (V1-46b review SEC-V46B-3: the capture reads the order before capturing).
 */
const paypalOrderBook = new Map<string, any[]>();
/** V1-46b review (SEC-V46B-4): WiPay answers 200 with an empty body, so the checkout builds the GET redirect itself. */
let wipayAnswersEmpty = false;
const paypalOrders = {
  createOrder: vi.fn(async (req: any) => {
    const id = `${P}order_${++checkoutSeq}`;
    paypalOrderBook.set(id, req?.body?.purchaseUnits ?? []);
    return { result: { id } };
  }),
  getOrder: vi.fn(async (req: { id: string }) => {
    const purchaseUnits = paypalOrderBook.get(req.id);
    if (!purchaseUnits) throw new Error(`V46A: the PayPal stub has no order ${req.id}`);
    return { result: { id: req.id, status: 'APPROVED', purchaseUnits } };
  }),
  captureOrder: vi.fn(async (req: { id: string }) => ({
    result: {
      id: req.id,
      status: 'COMPLETED',
      purchaseUnits: [{ payments: { captures: [{ id: `${P}cap_${req.id}` }] } }],
      payer: {},
    },
  })),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function providerFetch(input: any, init?: any): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const body = typeof init?.body === 'string' ? init.body : '';
  providerCalls.push({ url, body });
  const { host, pathname } = new URL(url);
  if (host === 'api.stripe.com' && pathname === '/v1/checkout/sessions') {
    return jsonResponse({ id: `${P}cs_checkout_${++checkoutSeq}`, url: STRIPE_REDIRECT });
  }
  if (host.endsWith('wipayfinancial.com')) {
    if (wipayAnswersEmpty) return new Response('', { status: 200 });
    return new Response(null, { status: 302, headers: { location: WIPAY_REDIRECT } });
  }
  if (host.startsWith('api-m.') && pathname === '/v1/oauth2/token') {
    return jsonResponse({ access_token: `${P}pp_access` });
  }
  if (host.startsWith('api-m.') && pathname === '/v1/notifications/verify-webhook-signature') {
    return jsonResponse({ verification_status: 'SUCCESS' });
  }
  throw new Error(`V46A: no network in this suite (refused ${url})`);
}

function paypalCallCount() {
  return (
    paypalOrders.createOrder.mock.calls.length +
    paypalOrders.getOrder.mock.calls.length +
    paypalOrders.captureOrder.mock.calls.length
  );
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM webhook_events WHERE provider_event_id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    // V1-46b review (TG-18i): the real WiPayConnector records its error state per business.
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

async function clearRateLimits() {
  const keys: string[] = await redis.keys(`pub_rate_limit:${RATE_LIMIT_NS}:*`);
  if (keys.length) await redis.del(...keys);
}

function agent() {
  return request(app.getHttpServer());
}

// ---- the customer's actions: anonymous, by the pay-link token alone --------

function payPage(token: string) {
  return agent().get(`/commerce/public/invoice-link/${encodeURIComponent(token)}/pay`);
}

function intent(token: string, body: Record<string, unknown>) {
  return agent().post(`/commerce/public/invoice-link/${encodeURIComponent(token)}/payment-intent`).send(body);
}

function receipt(token: string) {
  return agent().get(`/commerce/public/invoice-link/${encodeURIComponent(token)}/receipt`);
}

function view(token: string) {
  return agent().get(`/commerce/public/invoice-link/${encodeURIComponent(token)}`);
}

/** V1-46b: the token payment routes of payments.controller.ts. */
function tokStatus(token: string) {
  return agent().get(`/payments/public/invoice-link/${encodeURIComponent(token)}/status`);
}

function tokGateways(token: string) {
  return agent().get(`/payments/public/invoice-link/${encodeURIComponent(token)}/gateways`);
}

function tokCheckout(token: string, body: Record<string, unknown>) {
  return agent().post(`/payments/public/invoice-link/${encodeURIComponent(token)}/checkout`).send(body);
}

function tokCapture(token: string, orderId: string, body: Record<string, unknown> = {}) {
  return agent()
    .post(`/payments/public/invoice-link/${encodeURIComponent(token)}/paypal/capture/${encodeURIComponent(orderId)}`)
    .send(body);
}

/** The bare-id public read (KF-REVENUE-AUTH-PROJECTION-001), anonymous. */
function bareProjection(invoiceId: string) {
  return agent().get(`/commerce/invoices/${encodeURIComponent(invoiceId)}`);
}

function bareStatus(invoiceId: string) {
  return agent().get(`/payments/invoice/${encodeURIComponent(invoiceId)}/status`);
}

function bareGateways(invoiceId: string) {
  return agent().get(`/payments/invoice/${encodeURIComponent(invoiceId)}/gateways`);
}

/** The generic checkout with an invoice payable keyed by the bare id (the retired widget's call). */
function bareCheckout(invoiceId: string) {
  return agent()
    .post('/payments/create-checkout')
    .send({ payableType: 'invoice', payableId: invoiceId, ...CHECKOUT_BODIES[0] });
}

function bizOf(invoiceId: string) {
  return invoiceId === ID.invB ? ID.bizB : ID.bizA;
}

function ownerOf(biz: string) {
  return biz === ID.bizB ? ID.ownerB : ID.ownerA;
}

/** A link minted by the operator route (AuthGuard, BusinessGuard, revenue:write). */
async function mintLink(invoiceId: string) {
  const biz = bizOf(invoiceId);
  const res = await agent()
    .post(`/commerce/businesses/${biz}/invoices/${invoiceId}/payment-link`)
    .set(HEADER, ownerOf(biz))
    .send({});
  if (res.status !== 201 || !res.body?.token) throw new Error(`link on ${invoiceId} failed: ${res.status} ${JSON.stringify(res.body)}`);
  LINK_OF[invoiceId] = { id: res.body.id, token: res.body.token };
  return LINK_OF[invoiceId];
}

/** The operator's "deactivate link" through the real route (revenue:write). */
async function deactivate(invoiceId: string) {
  const biz = bizOf(invoiceId);
  const res = await agent()
    .delete(`/commerce/businesses/${biz}/payment-links/${LINK_OF[invoiceId].id}`)
    .set(HEADER, ownerOf(biz));
  if (![200, 204].includes(res.status)) throw new Error(`deactivate on ${invoiceId} failed: ${res.status} ${JSON.stringify(res.body)}`);
}

/** An operator payment through the real route (a real posting). */
async function pay(invoiceId: string, amount: number, slip: string) {
  const biz = bizOf(invoiceId);
  const res = await agent()
    .post(`/commerce/businesses/${biz}/invoices/${invoiceId}/payments`)
    .set(HEADER, ownerOf(biz))
    .send({ amount, method: 'cash', reference: `${CANARY}${P}${slip}`, notes: `${CANARY}note_${slip}` });
  if (res.status !== 201) throw new Error(`operator payment on ${invoiceId} failed: ${res.status} ${JSON.stringify(res.body)}`);
}

async function paymentsOf(invoiceId: string): Promise<any[]> {
  return db.payment.findMany({ where: { invoiceId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

async function linksOf(invoiceId: string): Promise<any[]> {
  return db.paymentLink.findMany({ where: { invoiceId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

async function invoiceRow(id: string): Promise<any> {
  // Raw read: the soft-delete extension hides the deleted fixture from findUnique.
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT id, status::text AS status, total, paid_at AS "paidAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
       FROM invoices WHERE id = $1`,
    id,
  );
  return rows[0] ?? null;
}

async function balanceOf(invoiceId: string) {
  const inv = await db.invoice.findFirst({
    where: { id: invoiceId },
    select: { total: true, currency: true, payments: { select: { amount: true, status: true } } },
  });
  return computeBalance(Number(inv.total), inv.payments, inv.currency);
}

async function ledgerCounts(businessId: string) {
  return {
    transactions: await db.financialTransaction.count({ where: { businessId } }),
    entries: await db.ledgerEntry.count({ where: { businessId } }),
  };
}

/** Every invoice, payment and link row of a tenant, as plain JSON (byte-for-byte comparable). */
async function tenantSnapshot(businessId: string): Promise<string> {
  const invoices = await db.$queryRawUnsafe(
    `SELECT id, status::text AS status, total, paid_at AS "paidAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
       FROM invoices WHERE business_id = $1 ORDER BY id`,
    businessId,
  );
  const payments = await db.$queryRawUnsafe(
    `SELECT id, invoice_id AS "invoiceId", amount, status, provider, method, provider_payment_id AS "providerPaymentId"
       FROM payments WHERE business_id = $1 ORDER BY id`,
    businessId,
  );
  const links = await db.$queryRawUnsafe(
    `SELECT id, invoice_id AS "invoiceId", token, active, expires_at AS "expiresAt" FROM payment_links WHERE business_id = $1 ORDER BY id`,
    businessId,
  );
  return JSON.stringify({ invoices, payments, links });
}

/** The error body without the per-request fields, so two 404s can be compared. */
function neutral(body: any) {
  const { path: _path, timestamp: _timestamp, correlationId: _correlationId, ...rest } = body ?? {};
  return rest;
}

/** The answer an unknown token gets on the same action: same status and same body (less the per-request fields). */
function expectUnknownAnswer(res: { status: number; body: any }, unknown: { status: number; body: any }, label: string) {
  expect(res.status, label).toBe(404);
  expect(neutral(res.body), label).toEqual(neutral(unknown.body));
  expect(res.body, label).not.toHaveProperty('invoiceNumber');
  expect(res.body, label).not.toHaveProperty('remaining');
}

function expectNoCanary(body: unknown) {
  expect(JSON.stringify(body ?? {})).not.toContain(CANARY);
}

/**
 * No payment row, reference, note, bank detail or customer email anywhere in
 * the body, at any depth. The business's own public contact email is the one
 * email allowed (the profile the link view already serves).
 */
function expectNoPaymentRowsOrEmail(body: unknown) {
  const forbidden = ['payments', 'reference', 'providerPaymentId', 'evidenceUrl', 'recordedBy', 'metaData', 'invoiceTemplate', 'quoteTemplate'];
  const walk = (node: unknown, at: string) => {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      expect(forbidden, `${at}.${k}`).not.toContain(k);
      if (at !== '$.business') expect(k, `${at}.${k}`).not.toBe('email');
      walk(v, `${at}.${k}`);
    }
  };
  walk(body, '$');
  expectNoCanary(body);
}

/** V1-46b: the token payment routes answer one token as they answer an unknown token; no provider is called. */
async function expectTokenPaymentRoutesRefused(token: string, label: string) {
  const calls = providerCalls.length;
  const paypal = paypalCallCount();
  expectUnknownAnswer(await tokStatus(token), unknownTokStatus, `${label}: status`);
  expectUnknownAnswer(await tokGateways(token), unknownTokGateways, `${label}: gateways`);
  for (const body of CHECKOUT_BODIES) {
    expectUnknownAnswer(await tokCheckout(token, body), unknownTokCheckout, `${label}: checkout ${body.gateway}`);
  }
  expectUnknownAnswer(await tokCapture(token, `${P}order_refused`), unknownTokCapture, `${label}: PayPal capture`);
  expect(providerCalls.length, `${label}: no provider request`).toBe(calls);
  expect(paypalCallCount(), `${label}: no PayPal SDK call`).toBe(paypal);
}

/** Every customer action on one token answers as for an unknown token. */
async function expectEveryActionRefused(token: string, label: string) {
  expectUnknownAnswer(await payPage(token), unknownPay, `${label}: pay page`);
  expectUnknownAnswer(await intent(token, { method: 'bank_transfer' }), unknownIntent, `${label}: intent`);
  expectUnknownAnswer(await intent(token, { method: 'cash', amount: 10 }), unknownIntent, `${label}: intent with an amount`);
  expectUnknownAnswer(await receipt(token), unknownReceipt, `${label}: receipt`);
  const v = await view(token);
  expect(v.status, `${label}: view`).toBe(200);
  expect(v.body, `${label}: view`).toEqual(unknownView.body);
  await expectTokenPaymentRoutesRefused(token, label);
}

/** Source text of a repo file (static pins). */
function source(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

beforeAll(async () => {
  for (const [k, v] of Object.entries(PROVIDER_ENV)) {
    PREVIOUS_PROVIDER_ENV[k] = process.env[k];
    process.env[k] = v;
  }
  globalThis.fetch = providerFetch as typeof fetch;

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
  const rateLimitMod = await import('../src/core/guards/public-rate-limit.guard');
  const { PublicRateLimitGuard, PUBLIC_RATE_LIMIT_KEY } = rateLimitMod;
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { PaymentsController } = await import('../src/modules/payments/payments.controller');
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
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
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  ({ FlowListener: FlowListenerRef } = await import('../src/modules/flow/flow.listener'));
  ({ FlowOrchestratorService: FlowOrchestratorServiceRef } = await import('../src/modules/ai/flow-orchestrator.service'));
  ({ DelegationLoopService: DelegationLoopServiceRef } = await import('../src/modules/autopilot/delegation-loop.service'));
  ({ WiPayConnector: WiPayConnectorRef } = await import('../src/core/connectors/implementations/wipay.connector'));
  EventEmitter2Ref = EventEmitter2;
  CommerceControllerRef = CommerceController;
  PaymentsControllerRef = PaymentsController;
  PublicRateLimitGuardRef = PublicRateLimitGuard;
  PUBLIC_RATE_LIMIT_KEY_REF = PUBLIC_RATE_LIMIT_KEY;

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController, PaymentsController],
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
      PaymentsService,
      InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      // Real ledger chain: the operator payments post real rows.
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      // COGS: no fixture invoice carries a product line, so nothing is sold.
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      {
        provide: EventEmitter2,
        useValue: { emit: () => true, emitAsync: async () => [], on: () => undefined, off: () => undefined, once: () => undefined, removeListener: () => undefined },
      },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
    ],
  }).compile();

  commerce = moduleRef.get(CommerceService);
  payments = moduleRef.get(PaymentsService);
  prismaService = moduleRef.get(PrismaService);
  // The PayPal SDK client is the provider edge for orders and captures.
  vi.spyOn(payments, 'getPaypalClient').mockImplementation(() => ({ client: {}, ordersController: paypalOrders }));

  // rawBody: the Stripe and PayPal webhooks verify the raw payload, as in app-bootstrap.
  app = moduleRef.createNestApplication({ rawBody: true });
  // Identity attachment only (the operator routes). No guard is overridden.
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
  await clearRateLimits();

  // ---- two tenants, each with an owner, a contact and a system chart of accounts.
  // Business A carries bank details under metaData (no public route serves
  // them) and its contact a canary email: neither may reach the customer.
  await db.user.create({ data: { id: ID.ownerA, email: `${P}ownerA@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' } });
  await db.business.create({
    data: { id: ID.bizA, name: 'V46A Biz A', ownerId: ID.ownerA, currency: 'TTD', email: `${P}billing@test.local`, metaData: { bankAccountNumber: `${CANARY}acct` } },
  });
  await db.business.create({ data: { id: ID.bizB, name: 'V46A Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'V46a', lastName: 'Customer', email: `${P}${CANARY}customer@test.local` } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'V46a', lastName: 'CustomerB', email: `${P}customerB@test.local` } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.bizA);
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.bizB);

  // ---- invoices: 100 each; SENT unless the case needs another start state ----
  const startStatus: Record<string, string> = {
    [ID.invDraft]: 'DRAFT',
    [ID.invVoid]: 'VOID',
    [ID.invFlowOverdue]: 'OVERDUE',
    [ID.invRecovery]: 'OVERDUE',
  };
  let n = 0;
  for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
    n += 1;
    const biz = bizOf(id);
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `V46A-${String(n).padStart(3, '0')}`,
        status: startStatus[id] ?? 'SENT',
        subtotal: TOTAL,
        total: TOTAL,
        currency: 'TTD',
        notes: 'Thank you for your business',
        businessId: biz,
        contactId: biz === ID.bizB ? ID.contactB : ID.contactA,
        dueDate: new Date(Date.now() - 10 * DAY_MS),
        // Item ids do not embed the invoice id, so TG-16 can look for the id anywhere in a body.
        items: { create: [{ id: `${P}item_${String(n).padStart(3, '0')}`, description: `V46A item ${n}`, quantity: 1, unitPrice: TOTAL, total: TOTAL }] },
      },
    });
  }

  // ---- links minted by the real route while the invoices are payable ------
  for (const inv of [
    ID.invLive, ID.invIntent, ID.invPartial, ID.invPaid, ID.invRevoke, ID.invBare, ID.invLedger, ID.invResolver, ID.invB,
    ID.invTokPay, ID.invCapture, ID.invKeySend, ID.invWhStripe, ID.invWhPaypal, ID.invWhWipay,
    ID.invAutoRevoked, ID.invCaptureBind, ID.invWipayRevoked,
  ]) {
    await mintLink(inv);
  }

  // ---- operator payments through the real route (real postings) -------------
  await pay(ID.invPartial, 40, 'slip_partial');
  await pay(ID.invPaid, 100, 'slip_paid');
  await pay(ID.invLedger, 30, 'slip_ledger');

  // ---- the links the cases revoke, through the operator route ---------------
  for (const inv of [ID.invBare, ID.invLedger, ID.invWhStripe, ID.invWhPaypal, ID.invWhWipay, ID.invAutoRevoked]) {
    await deactivate(inv);
  }

  // ---- seeded rows the routes cannot make -----------------------------------
  await db.paymentLink.create({ data: { id: LINK.expired.id, token: LINK.expired.token, invoiceId: ID.invExpired, businessId: ID.bizA, active: true, expiresAt: new Date(Date.now() - DAY_MS) } });
  await db.paymentLink.create({ data: { id: LINK.inactive.id, token: LINK.inactive.token, invoiceId: ID.invInactive, businessId: ID.bizA, active: false } });
  await db.paymentLink.create({ data: { id: LINK.foreign.id, token: LINK.foreign.token, invoiceId: ID.invForeign, businessId: ID.bizB, active: true } });
  await db.paymentLink.create({ data: { id: LINK.draft.id, token: LINK.draft.token, invoiceId: ID.invDraft, businessId: ID.bizA, active: true } });
  await db.paymentLink.create({ data: { id: LINK.void.id, token: LINK.void.token, invoiceId: ID.invVoid, businessId: ID.bizA, active: true } });
  await db.paymentLink.create({ data: { id: LINK.deleted.id, token: LINK.deleted.token, invoiceId: ID.invDeleted, businessId: ID.bizA, active: true } });
  await db.paymentLink.create({ data: { id: LINK.autoExpired.id, token: LINK.autoExpired.token, invoiceId: ID.invAutoExpired, businessId: ID.bizA, active: true, expiresAt: new Date(Date.now() - DAY_MS) } });
  await db.paymentLink.create({ data: { id: LINK.autoExpiring.id, token: LINK.autoExpiring.token, invoiceId: ID.invAutoExpiring, businessId: ID.bizA, active: true, expiresAt: new Date(Date.now() + 5 * DAY_MS) } });
  await db.$executeRawUnsafe(`UPDATE invoices SET deleted_at = NOW() WHERE id = $1`, ID.invDeleted);

  await clearRateLimits();
  unknownPay = await payPage(UNKNOWN_TOKEN);
  unknownIntent = await intent(UNKNOWN_TOKEN, { method: 'bank_transfer' });
  unknownReceipt = await receipt(UNKNOWN_TOKEN);
  unknownView = await view(UNKNOWN_TOKEN);
  unknownTokStatus = await tokStatus(UNKNOWN_TOKEN);
  unknownTokGateways = await tokGateways(UNKNOWN_TOKEN);
  unknownTokCheckout = await tokCheckout(UNKNOWN_TOKEN, CHECKOUT_BODIES[0]);
  unknownTokCapture = await tokCapture(UNKNOWN_TOKEN, `${P}order_unknown`);
  unknownBareRead = await bareProjection(UNKNOWN_INVOICE);
  unknownBareStatus = await bareStatus(UNKNOWN_INVOICE);
  unknownBareGateways = await bareGateways(UNKNOWN_INVOICE);
  unknownBareCheckout = await bareCheckout(UNKNOWN_INVOICE);
  providerCalls.length = 0;
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) {
    try { await clearRateLimits(); } catch { /* best-effort */ }
    await redis.quit();
  }
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(PREVIOUS_PROVIDER_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (PREVIOUS_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
});

beforeEach(async () => {
  await clearRateLimits();
});

describe('fixture sanity (real rows)', () => {
  it('two tenants; links minted, paid and revoked through the operator routes; the unknown-token answers are 404 on the token routes', async () => {
    expect((await invoiceRow(ID.invLive)).status).toBe('SENT');
    expect((await invoiceRow(ID.invPartial)).status).toBe('PARTIALLY_PAID');
    expect((await invoiceRow(ID.invPaid)).status).toBe('PAID');
    expect((await invoiceRow(ID.invDraft)).status).toBe('DRAFT');
    expect((await invoiceRow(ID.invDeleted)).deletedAt).toBeTruthy();
    expect((await db.paymentLink.findUnique({ where: { id: LINK_OF[ID.invBare].id } })).active).toBe(false);
    expect((await db.paymentLink.findUnique({ where: { id: LINK_OF[ID.invLedger].id } })).active).toBe(false);
    expect((await db.paymentLink.findUnique({ where: { id: LINK_OF[ID.invRevoke].id } })).active).toBe(true);
    expect(unknownView.body).toEqual({ ok: false, reason: 'invalid_or_expired' });
    expect(unknownReceipt.status).toBe(404);
    expect(unknownPay.status).toBe(404);
    expect(unknownIntent.status).toBe(404);
    // The ledger case is not vacuous: the operator payments posted real rows.
    expect((await ledgerCounts(ID.bizA)).transactions).toBeGreaterThanOrEqual(3);
  });
});

describe('the pay page is keyed by the token (V1-46)', () => {
  it("TG-01: a live link answers the pay-page projection: the bare-id public read's anonymous answer less the invoice id; no payment rows, bank details or customer email", async () => {
    const res = await payPage(LINK_OF[ID.invLive].token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      businessId: ID.bizA,
      status: 'SENT',
      total: TOTAL,
      currency: 'TTD',
      paid: 0,
      remaining: TOTAL,
      business: { name: 'V46A Biz A' },
      contact: { firstName: 'V46a', lastName: 'Customer' },
    });
    expect(res.body).not.toHaveProperty('id');
    expect(res.body.items).toHaveLength(1);
    expectNoPaymentRowsOrEmail(res.body);

    const bare = await bareProjection(ID.invLive);
    expect(bare.status).toBe(200);
    const { id: bareId, ...bareLessId } = bare.body;
    expect(bareId).toBe(ID.invLive);
    expect(res.body).toEqual(bareLessId);
  });

  it('TG-02: the projection states what has been paid and what remains (40 of 100), and a settled invoice stays readable through its link as PAID with nothing remaining', async () => {
    const partial = await payPage(LINK_OF[ID.invPartial].token);
    expect(partial.status, JSON.stringify(partial.body)).toBe(200);
    expect(partial.body).toMatchObject({ status: 'PARTIALLY_PAID', paid: 40, remaining: 60 });
    expectNoPaymentRowsOrEmail(partial.body);

    const paid = await payPage(LINK_OF[ID.invPaid].token);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body).toMatchObject({ status: 'PAID', paid: TOTAL, remaining: 0 });
  });

  it('TG-03: a payment intent through a live link answers the R0-22 success, writes one PENDING row on the invoice\'s own tenant, leaves the status and the ledger as they were, and the link still reads', async () => {
    const ledgerBefore = await ledgerCounts(ID.bizA);
    const res = await intent(LINK_OF[ID.invIntent].token, { method: 'bank_transfer' });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(res.body).toEqual({ success: true, method: 'bank_transfer', invoiceNumber: expect.any(String) });

    const rows = await paymentsOf(ID.invIntent);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'PENDING', method: 'bank_transfer', businessId: ID.bizA, amount: 0 });
    expect((await invoiceRow(ID.invIntent)).status).toBe('SENT');
    expect(await ledgerCounts(ID.bizA)).toEqual(ledgerBefore);

    const again = await intent(LINK_OF[ID.invIntent].token, { method: 'bank_transfer' });
    expect(again.status).toBe(res.status);
    expect(await paymentsOf(ID.invIntent)).toHaveLength(1);
    expect((await payPage(LINK_OF[ID.invIntent].token)).status).toBe(200);
  });

  it('TG-04: an intent through the live link of a settled invoice is the R0-22 409; nothing written', async () => {
    const before = await paymentsOf(ID.invPaid);
    const res = await intent(LINK_OF[ID.invPaid].token, { method: 'cash' });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(await paymentsOf(ID.invPaid)).toEqual(before);
  });
});

describe('a revoked link stops every customer action (M34)', () => {
  it('TG-05: deactivating the link through the operator route turns a working pay page and intent into the unknown-token 404 on every action; nothing is written after the revocation', async () => {
    const token = LINK_OF[ID.invRevoke].token;
    expect((await payPage(token)).status, 'pay page before the revocation').toBe(200);
    const first = await intent(token, { method: 'cash' });
    expect([200, 201], JSON.stringify(first.body)).toContain(first.status);
    const afterFirst = await paymentsOf(ID.invRevoke);
    expect(afterFirst).toHaveLength(1);

    await deactivate(ID.invRevoke);
    await clearRateLimits();

    await expectEveryActionRefused(token, 'deactivated');
    expect(await paymentsOf(ID.invRevoke)).toEqual(afterFirst);
    expect((await invoiceRow(ID.invRevoke)).status).toBe('SENT');
  });

  it('TG-06: an expired, an inactive, an unknown and a foreign-tenant link answer one 404 on every action; nothing written', async () => {
    const bBefore = await tenantSnapshot(ID.bizB);
    for (const [token, inv] of [
      [LINK.expired.token, ID.invExpired],
      [LINK.inactive.token, ID.invInactive],
      [LINK.foreign.token, ID.invForeign],
    ] as const) {
      await clearRateLimits();
      await expectEveryActionRefused(token, token);
      expect(await paymentsOf(inv), token).toHaveLength(0);
      expect((await invoiceRow(inv)).status, token).toBe('SENT');
    }
    await clearRateLimits();
    await expectEveryActionRefused(UNKNOWN_TOKEN, 'unknown');
    expect(await tenantSnapshot(ID.bizB)).toBe(bBefore);
  });

  it('TG-07: a DRAFT, a VOID and a soft-deleted invoice behind a live link answer the unknown-token 404 on the pay page and the intent; nothing written', async () => {
    for (const [token, inv, status] of [
      [LINK.draft.token, ID.invDraft, 'DRAFT'],
      [LINK.void.token, ID.invVoid, 'VOID'],
      [LINK.deleted.token, ID.invDeleted, 'SENT'],
    ] as const) {
      await clearRateLimits();
      expectUnknownAnswer(await payPage(token), unknownPay, `${token}: pay page`);
      expectUnknownAnswer(await intent(token, { method: 'bank_transfer' }), unknownIntent, `${token}: intent`);
      // V1-46b: the token payment routes refuse what the pay page refuses.
      await expectTokenPaymentRoutesRefused(token, token);
      expect(await paymentsOf(inv), token).toHaveLength(0);
      expect((await invoiceRow(inv)).status, token).toBe(status);
    }
  });

  it('TG-08 LEDGER: no payment or posting is reachable through a revoked token: Payment rows, computeBalance and both ledger counts are unchanged', async () => {
    const token = LINK_OF[ID.invLedger].token;
    const balanceBefore = await balanceOf(ID.invLedger);
    expect(balanceBefore).toMatchObject({ paid: 30, remaining: 70 });
    const rowsBefore = await paymentsOf(ID.invLedger);
    const countsA = await ledgerCounts(ID.bizA);
    const countsB = await ledgerCounts(ID.bizB);

    for (const body of [{ method: 'bank_transfer' }, { method: 'cash', amount: 70 }, { method: 'google_pay' }]) {
      expectUnknownAnswer(await intent(token, body), unknownIntent, JSON.stringify(body));
    }
    expectUnknownAnswer(await payPage(token), unknownPay, 'pay page');
    expectUnknownAnswer(await receipt(token), unknownReceipt, 'receipt');
    await clearRateLimits();
    // V1-46b: neither a provider checkout nor a PayPal capture is reachable either.
    await expectTokenPaymentRoutesRefused(token, 'revoked');

    expect(await paymentsOf(ID.invLedger)).toEqual(rowsBefore);
    expect(await balanceOf(ID.invLedger)).toEqual(balanceBefore);
    expect(await ledgerCounts(ID.bizA)).toEqual(countsA);
    expect(await ledgerCounts(ID.bizB)).toEqual(countsB);
    expect((await invoiceRow(ID.invLedger)).status).toBe('PARTIALLY_PAID');
  });
});

describe('the bare-id pay actions are retired (D-07)', () => {
  it('TG-09: POST /commerce/invoices/:invoiceId/payment-intent is gone: a SENT invoice whose only link is revoked answers 404 and nothing is written', async () => {
    const ledgerBefore = await ledgerCounts(ID.bizA);
    for (const body of [{ method: 'bank_transfer' }, { method: 'cash', amount: 25 }]) {
      const res = await agent().post(`/commerce/invoices/${ID.invBare}/payment-intent`).send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body).not.toHaveProperty('success');
    }
    expect(await paymentsOf(ID.invBare)).toHaveLength(0);
    expect((await invoiceRow(ID.invBare)).status).toBe('SENT');
    expect(await ledgerCounts(ID.bizA)).toEqual(ledgerBefore);
  });

  it('TG-10: GET /commerce/payment-links/:token, the resolver that handed out the invoice id for the /pay/:invoiceId downgrade, is gone: 404 with no invoice id', async () => {
    const res = await agent().get(`/commerce/payment-links/${encodeURIComponent(LINK_OF[ID.invResolver].token)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(ID.invResolver);
    // The link itself still works through the token routes.
    expect((await payPage(LINK_OF[ID.invResolver].token)).status).toBe(200);
  });

  it('TG-11: the bare-id public read keeps its redacted projection (KF-REVENUE-AUTH-PROJECTION-001): 200 for a SENT invoice, 404 for a DRAFT one', async () => {
    const res = await bareProjection(ID.invResolver);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: ID.invResolver, status: 'SENT', remaining: TOTAL });
    expectNoPaymentRowsOrEmail(res.body);
    expect((await bareProjection(ID.invDraft)).status).toBe(404);
  });
});

describe('TENANT and the route contract (V1-46)', () => {
  it("TG-12 TENANT: tenant B's live token reads and writes tenant B's invoice only; tenant A's invoices, payments and links are byte-identical", async () => {
    const aBefore = await tenantSnapshot(ID.bizA);
    const page = await payPage(LINK_OF[ID.invB].token);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ businessId: ID.bizB });
    expect(JSON.stringify(page.body)).not.toContain(ID.bizA);

    const res = await intent(LINK_OF[ID.invB].token, { method: 'bank_transfer', amount: 10 });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    const rows = await paymentsOf(ID.invB);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ businessId: ID.bizB, invoiceId: ID.invB, status: 'PENDING', amount: 10 });
    expect(await tenantSnapshot(ID.bizA)).toBe(aBefore);
  });

  it('TG-13: both token routes sit behind PublicRateLimitGuard alone (the token is the credential); the pay page allows 30 reads a minute and the intent 10 writes', async () => {
    const { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } = await import('@nestjs/common/constants');
    const { RequestMethod } = await import('@nestjs/common');

    const payHandler = CommerceControllerRef.prototype.getPayPageByToken;
    expect(typeof payHandler, 'pay page handler').toBe('function');
    expect(Reflect.getMetadata(PATH_METADATA, payHandler)).toBe('public/invoice-link/:token/pay');
    expect(Reflect.getMetadata(METHOD_METADATA, payHandler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PUBLIC_RATE_LIMIT_KEY_REF, payHandler)).toEqual({ limit: 30, windowMs: 60_000 });
    expect(Reflect.getMetadata(GUARDS_METADATA, payHandler) ?? []).toEqual([PublicRateLimitGuardRef]);

    const intentHandler = CommerceControllerRef.prototype.recordPaymentIntentByToken;
    expect(typeof intentHandler, 'intent handler').toBe('function');
    expect(Reflect.getMetadata(PATH_METADATA, intentHandler)).toBe('public/invoice-link/:token/payment-intent');
    expect(Reflect.getMetadata(METHOD_METADATA, intentHandler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PUBLIC_RATE_LIMIT_KEY_REF, intentHandler)).toEqual({ limit: 10, windowMs: 60_000 });
    expect(Reflect.getMetadata(GUARDS_METADATA, intentHandler) ?? []).toEqual([PublicRateLimitGuardRef]);

    // The two bare-id handlers are gone from the controller.
    expect(CommerceControllerRef.prototype.recordPublicPaymentIntent).toBeUndefined();
    expect(CommerceControllerRef.prototype.getPaymentLinkByToken).toBeUndefined();

    for (let i = 1; i <= 30; i += 1) {
      const res = await payPage(LINK_OF[ID.invLive].token);
      expect(res.status, `read ${i}`).toBe(200);
    }
    expect((await payPage(LINK_OF[ID.invLive].token)).status).toBe(429);
  });
});

describe('the payment routes are keyed by the token (V1-46b)', () => {
  it('TG-14: through a live link the status (five keys), the gateway list and a checkout per provider (Stripe, WiPay, PayPal; stubbed, no network) answer, and each provider request names the token\'s invoice; nothing is recorded by a checkout', async () => {
    const token = LINK_OF[ID.invTokPay].token;

    const status = await tokStatus(token);
    expect(status.status, JSON.stringify(status.body)).toBe(200);
    expect(Object.keys(status.body).sort()).toEqual(['currency', 'lastPaymentAt', 'paid', 'remaining', 'status']);
    expect(status.body).toMatchObject({ status: 'SENT', paid: 0, remaining: TOTAL, currency: 'TTD' });

    const gateways = await tokGateways(token);
    expect(gateways.status, JSON.stringify(gateways.body)).toBe(200);
    expect(gateways.body.map((g: { id: string }) => g.id).sort()).toEqual(['paypal', 'stripe', 'wipay']);

    const stripe = await tokCheckout(token, CHECKOUT_BODIES[0]);
    expect(stripe.status, JSON.stringify(stripe.body)).toBe(201);
    expect(stripe.body).toEqual({ type: 'redirect', redirectUrl: STRIPE_REDIRECT });
    const stripeCall = providerCalls.filter((c) => c.url.startsWith('https://api.stripe.com/')).pop()!;
    expect(new URLSearchParams(stripeCall.body).get('metadata[invoiceId]')).toBe(ID.invTokPay);
    expect(new URLSearchParams(stripeCall.body).get('metadata[businessId]')).toBe(ID.bizA);

    const wipay = await tokCheckout(token, CHECKOUT_BODIES[1]);
    expect(wipay.status, JSON.stringify(wipay.body)).toBe(201);
    expect(wipay.body).toEqual({ type: 'redirect', redirectUrl: WIPAY_REDIRECT });
    const wipayCall = providerCalls.filter((c) => c.url.includes('wipayfinancial.com')).pop()!;
    expect(new URLSearchParams(wipayCall.body).get('order_id')).toBe(ID.invTokPay);

    const paypal = await tokCheckout(token, CHECKOUT_BODIES[2]);
    expect(paypal.status, JSON.stringify(paypal.body)).toBe(201);
    expect(paypal.body).toEqual({ type: 'paypal_order', orderId: expect.stringContaining(P) });
    const order = paypalOrders.createOrder.mock.calls.at(-1)![0];
    expect(order.body.purchaseUnits[0].customId).toBe(ID.invTokPay);

    // A checkout records nothing: the provider's webhook or the capture does.
    expect(await paymentsOf(ID.invTokPay)).toHaveLength(0);
    expect((await invoiceRow(ID.invTokPay)).status).toBe('SENT');
  });

  it("TG-14b: the PayPal capture through a live link records one SUCCESSFUL row against the token's invoice; an invoiceId in the body naming another invoice is ignored", async () => {
    const token = LINK_OF[ID.invCapture].token;
    const liveBefore = await paymentsOf(ID.invLive);
    // The order is the one the token checkout made for this invoice (review SEC-V46B-3: only such an order is captured).
    const checkout = await tokCheckout(token, CHECKOUT_BODIES[2]);
    expect(checkout.status, JSON.stringify(checkout.body)).toBe(201);
    const orderId: string = checkout.body.orderId;

    const res = await tokCapture(token, orderId, { invoiceId: ID.invLive });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ id: orderId, status: 'COMPLETED' });
    expect(paypalOrders.captureOrder.mock.calls.at(-1)![0]).toMatchObject({ id: orderId });

    const rows = await paymentsOf(ID.invCapture);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'paypal',
      providerPaymentId: `${P}cap_${orderId}`,
      status: 'SUCCESSFUL',
      businessId: ID.bizA,
      invoiceId: ID.invCapture,
    });
    expect(await paymentsOf(ID.invLive)).toEqual(liveBefore);
  });

  it("TG-14d (review SEC-V46B-3): the token capture captures only an order made for the token's invoice and its total: another invoice's, another tenant's, a wrong-amount and an unknown order are refused (400) before PayPal captures anything, and nothing is written", async () => {
    const token = LINK_OF[ID.invCaptureBind].token;
    const orderOf = async (inv: string) => {
      await clearRateLimits();
      const res = await tokCheckout(LINK_OF[inv].token, CHECKOUT_BODIES[2]);
      expect(res.status, `${inv}: checkout ${JSON.stringify(res.body)}`).toBe(201);
      return res.body.orderId as string;
    };
    const otherInvoiceOrder = await orderOf(ID.invLive);
    const otherTenantOrder = await orderOf(ID.invB);
    const wrongAmountOrder = `${P}order_wrong_amount`;
    paypalOrderBook.set(wrongAmountOrder, [{ customId: ID.invCaptureBind, referenceId: ID.invCaptureBind, amount: { currencyCode: 'USD', value: '1.00' } }]);
    const twoUnitOrder = `${P}order_two_units`;
    paypalOrderBook.set(twoUnitOrder, [
      { customId: ID.invCaptureBind, amount: { currencyCode: 'USD', value: TOTAL.toFixed(2) } },
      { customId: ID.invCaptureBind, amount: { currencyCode: 'USD', value: TOTAL.toFixed(2) } },
    ]);
    const unknownOrder = `${P}order_nosuch`;

    const before = {
      bind: await paymentsOf(ID.invCaptureBind),
      live: await paymentsOf(ID.invLive),
      b: await paymentsOf(ID.invB),
      ledgerA: await ledgerCounts(ID.bizA),
      ledgerB: await ledgerCounts(ID.bizB),
    };
    const captures = paypalOrders.captureOrder.mock.calls.length;

    for (const [label, orderId] of [
      ['another invoice of the tenant', otherInvoiceOrder],
      ['another tenant', otherTenantOrder],
      ['a wrong amount', wrongAmountOrder],
      ['two purchase units', twoUnitOrder],
      ['an unknown order', unknownOrder],
    ] as const) {
      await clearRateLimits();
      const res = await tokCapture(token, orderId);
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.message, label).toBe('This PayPal order does not belong to this invoice');
      expect(res.body, label).not.toHaveProperty('status', 'COMPLETED');
      expect(paypalOrders.getOrder.mock.calls.at(-1)![0], label).toMatchObject({ id: orderId });
    }

    expect(paypalOrders.captureOrder.mock.calls.length, 'PayPal captured nothing').toBe(captures);
    expect(await paymentsOf(ID.invCaptureBind), 'no SUCCESSFUL or FAILED row').toEqual(before.bind);
    expect(await paymentsOf(ID.invLive)).toEqual(before.live);
    expect(await paymentsOf(ID.invB)).toEqual(before.b);
    expect((await invoiceRow(ID.invCaptureBind)).status).toBe('SENT');
    expect((await invoiceRow(ID.invLive)).status).toBe('SENT');
    expect((await invoiceRow(ID.invB)).status).toBe('SENT');
    expect(await ledgerCounts(ID.bizA)).toEqual(before.ledgerA);
    expect(await ledgerCounts(ID.bizB)).toEqual(before.ledgerB);

    // Control: the invoice's own order is captured and recorded, so the refusal is not blanket.
    const ownOrder = await orderOf(ID.invCaptureBind);
    await clearRateLimits();
    const own = await tokCapture(token, ownOrder);
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(own.body).toMatchObject({ id: ownOrder, status: 'COMPLETED' });
    const rows = await paymentsOf(ID.invCaptureBind);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'paypal', providerPaymentId: `${P}cap_${ownOrder}`, status: 'SUCCESSFUL', invoiceId: ID.invCaptureBind, businessId: ID.bizA });
  });

  it('TG-14c: the route contract: the four token payment routes sit behind the class-level PublicRateLimitGuard alone with their limits; the bare-id per-provider checkouts and the bare-id PayPal capture are gone from payments.controller.ts', async () => {
    const { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } = await import('@nestjs/common/constants');
    const { RequestMethod } = await import('@nestjs/common');
    const proto = PaymentsControllerRef.prototype;

    expect(Reflect.getMetadata(GUARDS_METADATA, PaymentsControllerRef)).toEqual([PublicRateLimitGuardRef]);
    for (const [name, routePath, method, limit] of [
      ['getPaymentStatusByToken', 'public/invoice-link/:token/status', RequestMethod.GET, 20],
      ['getGatewaysByToken', 'public/invoice-link/:token/gateways', RequestMethod.GET, 20],
      ['createCheckoutByToken', 'public/invoice-link/:token/checkout', RequestMethod.POST, 5],
      ['capturePaypalOrderByToken', 'public/invoice-link/:token/paypal/capture/:orderId', RequestMethod.POST, 5],
    ] as const) {
      const handler = proto[name];
      expect(typeof handler, name).toBe('function');
      expect(Reflect.getMetadata(PATH_METADATA, handler), name).toBe(routePath);
      expect(Reflect.getMetadata(METHOD_METADATA, handler), name).toBe(method);
      expect(Reflect.getMetadata(PUBLIC_RATE_LIMIT_KEY_REF, handler), name).toEqual({ limit, windowMs: 60_000 });
      expect(Reflect.getMetadata(GUARDS_METADATA, handler) ?? [], name).toEqual([]);
    }
    for (const gone of ['createWipayCheckout', 'createPaypalOrder', 'capturePaypalOrder', 'createStripeCheckout']) {
      expect(proto[gone], gone).toBeUndefined();
    }
    // Kept, behind the link gate: the bare-id status, gateway list and generic checkout.
    for (const kept of ['getInvoicePaymentStatus', 'getGateways', 'createCheckout']) {
      expect(typeof proto[kept], kept).toBe('function');
    }
  });
});

describe('revocation holds on the bare-id routes (V1-46b, ST-1)', () => {
  it('TG-15 (ST-1): after the only link is revoked or has expired, an anonymous caller holding the invoice id gets the unknown-id 404 from GET /commerce/invoices/:id, GET /payments/invoice/:id/status and /gateways and POST /payments/create-checkout; the bare per-provider checkouts and capture are gone; nothing is written and no provider is called', async () => {
    for (const inv of [ID.invBare, ID.invExpired, ID.invInactive]) {
      await clearRateLimits();
      const calls = providerCalls.length;
      const paypal = paypalCallCount();
      const before = await paymentsOf(inv);

      expectUnknownAnswer(await bareProjection(inv), unknownBareRead, `${inv}: GET /commerce/invoices/:id`);
      expectUnknownAnswer(await bareStatus(inv), unknownBareStatus, `${inv}: status`);
      expectUnknownAnswer(await bareGateways(inv), unknownBareGateways, `${inv}: gateways`);
      expectUnknownAnswer(await bareCheckout(inv), unknownBareCheckout, `${inv}: create-checkout`);

      for (const [label, res] of [
        ['stripe', await agent().post(`/payments/invoice/${inv}/stripe`).send({ successUrl: `${RETURN_URL}?stripe=success`, cancelUrl: RETURN_URL })],
        ['wipay', await agent().post(`/payments/invoice/${inv}/wipay`).send({ returnUrl: RETURN_URL })],
        ['paypal create-order', await agent().post(`/payments/invoice/${inv}/paypal/create-order`).send({})],
        ['paypal capture', await agent().post(`/payments/paypal/capture/${P}order_bare`).send({ invoiceId: inv })],
      ] as const) {
        expect(res.status, `${inv}: bare ${label} ${JSON.stringify(res.body)}`).toBe(404);
        expect(res.body, `${inv}: bare ${label}`).not.toHaveProperty('redirectUrl');
        expect(res.body, `${inv}: bare ${label}`).not.toHaveProperty('orderId');
      }

      expect(providerCalls.length, `${inv}: no provider request`).toBe(calls);
      expect(paypalCallCount(), `${inv}: no PayPal SDK call`).toBe(paypal);
      expect(await paymentsOf(inv), inv).toEqual(before);
      expect((await invoiceRow(inv)).status, inv).toBe('SENT');
    }
  });

  it('TG-15b: the operator routes are unchanged for that invoice: the owner reads the full shape on GET /commerce/invoices/:id and on the tenant-bound detail route', async () => {
    const asOwner = await agent().get(`/commerce/invoices/${ID.invBare}`).set(HEADER, ID.ownerA);
    expect(asOwner.status, JSON.stringify(asOwner.body)).toBe(200);
    expect(asOwner.body).toMatchObject({ id: ID.invBare, businessId: ID.bizA, status: 'SENT' });
    expect(Array.isArray(asOwner.body.payments)).toBe(true);
    expect(asOwner.body.contact?.email).toBe(`${P}${CANARY}customer@test.local`);

    const tenant = await agent().get(`/commerce/businesses/${ID.bizA}/invoices/${ID.invBare}`).set(HEADER, ID.ownerA);
    expect(tenant.status, JSON.stringify(tenant.body)).toBe(200);
    expect(tenant.body).toMatchObject({ id: ID.invBare, status: 'SENT' });

    // A member of another tenant is anonymous for revenue purposes: the gate applies.
    const asOther = await agent().get(`/commerce/invoices/${ID.invBare}`).set(HEADER, ID.ownerB);
    expectUnknownAnswer(asOther, unknownBareRead, 'tenant B owner');
  });

  it('TG-15c: an invoice with a live link, and one that never had a link, keep the bare-id projection (KF-REVENUE-AUTH-PROJECTION-001; release0-journey step 6 pins the never-linked case)', async () => {
    for (const inv of [ID.invResolver, ID.invNoLink]) {
      await clearRateLimits();
      const read = await bareProjection(inv);
      expect(read.status, `${inv}: read`).toBe(200);
      expect(read.body).toMatchObject({ id: inv, status: 'SENT', remaining: TOTAL });
      expectNoPaymentRowsOrEmail(read.body);
      const status = await bareStatus(inv);
      expect(status.status, `${inv}: status`).toBe(200);
      expect(Object.keys(status.body).sort()).toEqual(['currency', 'lastPaymentAt', 'paid', 'remaining', 'status']);
      expect((await bareGateways(inv)).status, `${inv}: gateways`).toBe(200);
    }
    expect(await linksOf(ID.invNoLink)).toHaveLength(0);
  });

  it('TG-16 (ST-1): the token pay read no longer returns the invoice id, and the status, gateway list, Stripe and PayPal checkouts do not answer it (the WiPay checkout carries it as WiPay\'s order_id: TG-16b)', async () => {
    const token = LINK_OF[ID.invLive].token;
    const page = await payPage(token);
    expect(page.status).toBe(200);
    expect(page.body).not.toHaveProperty('id');
    // The tenant key stays: the page's presence tracker reads it.
    expect(page.body.businessId).toBe(ID.bizA);
    for (const [label, res] of [
      ['pay page', page],
      ['status', await tokStatus(token)],
      ['gateways', await tokGateways(token)],
      ['stripe checkout', await tokCheckout(token, CHECKOUT_BODIES[0])],
      ['paypal checkout', await tokCheckout(token, CHECKOUT_BODIES[2])],
    ] as const) {
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
      expect(JSON.stringify(res.body), label).not.toContain(ID.invLive);
    }
  });

  it("TG-16b (review SEC-V46B-4): the WiPay checkout is the one token answer that carries the invoice id, as WiPay's order_id (its hosted page and callback are keyed by it); once the link is revoked, that id opens no bare-id route and no token route", async () => {
    const inv = ID.invWipayRevoked;
    const token = LINK_OF[inv].token;
    wipayAnswersEmpty = true;
    let redirectUrl: string;
    try {
      const res = await tokCheckout(token, CHECKOUT_BODIES[1]);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(['redirectUrl', 'type']);
      redirectUrl = res.body.redirectUrl;
    } finally {
      wipayAnswersEmpty = false;
    }
    const redirect = new URL(redirectUrl);
    expect(redirect.host.endsWith('wipayfinancial.com')).toBe(true);
    // WiPay's order key, as the POST to WiPay names it (TG-14) and the return URL hands it back.
    expect(redirect.searchParams.get('order_id')).toBe(inv);
    expect(redirect.searchParams.get('return_url')).toBe(RETURN_URL);

    // The operator revokes the link. The id the customer saw opens nothing any more.
    await deactivate(inv);
    const leakedId = redirect.searchParams.get('order_id')!;
    const calls = providerCalls.length;
    await clearRateLimits();
    expectUnknownAnswer(await bareProjection(leakedId), unknownBareRead, 'bare read');
    expectUnknownAnswer(await bareStatus(leakedId), unknownBareStatus, 'bare status');
    expectUnknownAnswer(await bareGateways(leakedId), unknownBareGateways, 'bare gateways');
    expectUnknownAnswer(await bareCheckout(leakedId), unknownBareCheckout, 'bare create-checkout');
    await clearRateLimits();
    await expectTokenPaymentRoutesRefused(token, 'revoked WiPay link');
    expect(providerCalls.length, 'no provider request').toBe(calls);
    expect(await commerce.isBareIdPublicAccessOpen(inv)).toBe(false);
    expect((await linksOf(inv)).map((l) => l.active)).toEqual([false]);
  });
});

describe('the widget pay page and the producers (V1-46b, ST-2, CR-01)', () => {
  it("TG-17 (ST-2): widgets/pay/[invoiceId] is retired: it reads and writes nothing and shows the 'no longer used' state of /pay/[invoiceId]; the attendee row links the token link", () => {
    const retired = source('apps/web/src/app/pay/[invoiceId]/page.tsx');
    const title = /title="([^"]+)"/.exec(retired)?.[1];
    expect(title).toBe('This payment address is no longer used');

    const widget = source('apps/web/src/app/widgets/pay/[invoiceId]/page.tsx');
    expect(widget).toContain(title!);
    expect(widget).toContain('PublicPageState');
    for (const banned of ['apiGet', 'apiPost', 'fetch(', '/commerce/', '/payments/', 'create-checkout']) {
      expect(widget, banned).not.toContain(banned);
    }

    const row = source('apps/web/src/app/app/events/components/attendee-row.tsx');
    expect(row).not.toMatch(/widgets\/pay/);
    expect(row).toContain('createInvoicePaymentLink');
    expect(row).toMatch(/\/public\/invoice\//);
  });

  it('TG-18a (CR-01): no source file emits a bare /pay/<invoiceId> or /widgets/pay/<invoiceId> URL, and the pay page and client.ts call only token-keyed payment routes', () => {
    // The retired pages themselves are allowed to exist; they must emit nothing (TG-17 pins what they read).
    const ALLOWED: Record<string, string> = {
      'apps/web/src/app/pay/[invoiceId]/page.tsx': 'the retired bare-id pay page itself',
      'apps/web/src/app/widgets/pay/[invoiceId]/page.tsx': 'the retired bare-id widget page itself',
    };
    const BARE_PAY_URL = [/\/pay\/\$\{/, /["'`]\/pay\/["'`]\s*\+/, /widgets\/pay\/\$\{/];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (['node_modules', 'dist', '.next', '__tests__'].includes(e.name)) continue;
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(e.name) || /\.(spec|test)\.tsx?$/.test(e.name)) continue;
        const rel = path.relative(REPO, p).split(path.sep).join('/');
        if (rel in ALLOWED) continue;
        const text = fs.readFileSync(p, 'utf8');
        for (const re of BARE_PAY_URL) if (re.test(text)) offenders.push(`${rel} ${re}`);
      }
    };
    walk(path.join(REPO, 'apps/server/src'));
    walk(path.join(REPO, 'apps/web/src'));
    expect(offenders).toEqual([]);

    // The operator copy-link fallbacks, the booking widget and the bare-id entry page carry no /pay/ address at all.
    for (const rel of [
      'apps/web/src/app/app/commerce/invoices/invoices-panel.tsx',
      'apps/web/src/app/app/commerce/invoices/page.tsx',
      'apps/web/src/app/app/commerce/invoices/[id]/page.tsx',
      'apps/web/src/app/widgets/booking/[slug]/page.tsx',
      'apps/web/src/app/public/pay/page.tsx',
    ]) {
      expect(source(rel), rel).not.toMatch(/["'`]\/pay\//);
    }

    const page = source('apps/web/src/app/pay/link/[token]/page.tsx');
    for (const re of [/\/payments\/invoice\//, /\/payments\/paypal\/capture\//, /create-checkout/, /\binvoice\.id\b/, /\bloaded\.id\b/, /\/commerce\/invoices\//]) {
      expect(page, String(re)).not.toMatch(re);
    }
    const client = source('apps/web/src/lib/client.ts');
    for (const re of [/\/payments\/invoice\//, /\/payments\/paypal\/capture\//, /\/payments\/create-checkout/]) {
      expect(client, String(re)).not.toMatch(re);
    }
    expect(client).toContain('/payments/public/invoice-link/');
  });

  /** A customer email sender stub that records what each producer sends. */
  function emailRecorder() {
    const sent: any[] = [];
    return { sent, send: vi.fn(async (payload: any) => { sent.push(payload); return { status: 'SENT' }; }) };
  }

  const quietLogger = { debug: () => undefined, log: () => undefined, warn: () => undefined, error: () => undefined };

  async function liveLinkUrl(invoiceId: string) {
    const live = (await linksOf(invoiceId)).filter((l) => l.active && (!l.expiresAt || l.expiresAt > new Date()));
    expect(live, `${invoiceId}: one live link`).toHaveLength(1);
    return `${appUrl()}/public/invoice/${live[0].token}`;
  }

  it('TG-18b (CR-01): the overdue reminder (flow.listener) emails /public/invoice/<token>, creating the link when the invoice has none', async () => {
    expect(await linksOf(ID.invFlowOverdue)).toHaveLength(0);
    const mail = emailRecorder();
    const listener = Object.assign(Object.create(FlowListenerRef.prototype), {
      prisma: { client: { notification: { create: async () => ({}) } } },
      transactionalEmail: { send: mail.send },
      commerce,
      logger: quietLogger,
    });
    await listener.handleInvoiceOverdue({
      businessId: ID.bizA,
      invoice: {
        id: ID.invFlowOverdue,
        invoiceNumber: 'V46A-OVERDUE',
        total: TOTAL,
        currency: 'TTD',
        dueDate: new Date(Date.now() - 10 * DAY_MS),
        contact: { id: ID.contactA, firstName: 'V46a', lastName: 'Customer', email: `${P}overdue@test.local` },
      },
    });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].type).toBe('invoice_overdue');
    expect(mail.sent[0].templateData.invoiceUrl).toBe(await liveLinkUrl(ID.invFlowOverdue));
    expect(mail.sent[0].templateData.invoiceUrl).not.toContain(ID.invFlowOverdue);
  });

  it("TG-18c (CR-01): KEY's invoice_sent (flow-orchestrator) emails /public/invoice/<token> and reuses the invoice's live link", async () => {
    const mail = emailRecorder();
    const orchestrator = Object.assign(Object.create(FlowOrchestratorServiceRef.prototype), {
      prisma: prismaService,
      getTransactionalEmail: () => mail,
      getCommerce: () => ({
        // Review SEC-V46B-2: KEY's send is an automated producer (automatedInvoiceUrl, the real one).
        automatedInvoiceUrl: (invoiceId: string, businessId: string) => commerce.automatedInvoiceUrl(invoiceId, businessId),
        publicInvoiceUrl: (invoiceId: string, businessId: string) => commerce.publicInvoiceUrl(invoiceId, businessId),
        updateInvoiceStatus: async () => ({ id: ID.invKeySend, status: 'SENT' }),
      }),
      getActivityLog: () => ({ createActivity: async () => ({}) }),
    });
    const result = await orchestrator.executeToolAction(ID.bizA, 'commerce_send_invoice', { invoiceId: ID.invKeySend });
    expect(result.status).toBe('SENT');
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].type).toBe('invoice_sent');
    expect(mail.sent[0].templateData.invoiceUrl).toBe(`${appUrl()}/public/invoice/${LINK_OF[ID.invKeySend].token}`);
    expect(await linksOf(ID.invKeySend)).toHaveLength(1);
  });

  it('TG-18d (CR-01): autopilot payment recovery (delegation-loop) emails /public/invoice/<token>', async () => {
    expect(await linksOf(ID.invRecovery)).toHaveLength(0);
    const mail = emailRecorder();
    const tasks: any[] = [];
    const loop = Object.assign(Object.create(DelegationLoopServiceRef.prototype), {
      prisma: {
        client: {
          invoice: {
            findMany: async () => [{
              id: ID.invRecovery,
              invoiceNumber: 'V46A-RECOVERY',
              total: TOTAL,
              dueDate: new Date(Date.now() - 10 * DAY_MS),
              status: 'OVERDUE',
              contact: { id: ID.contactA, firstName: 'V46a', lastName: 'Customer', email: `${P}recovery@test.local`, phone: null, doNotContact: false },
            }],
            update: async () => ({}),
          },
          autopilotTask: {
            findFirst: async () => null,
            create: async ({ data }: any) => { const t = { id: `${P}task_${tasks.length + 1}`, ...data }; tasks.push(t); return t; },
            update: async () => ({}),
          },
        },
      },
      timeline: { logEvent: async () => undefined },
      events: { emit: () => true },
      emailService: { send: mail.send },
      logger: quietLogger,
      contactWindow: async () => ({ allowed: true }),
      getCommerce: () => commerce,
    });
    await loop.runPaymentRecovery(ID.bizA, {}, { itemsScanned: 0, itemsMatched: 0, actionsCreated: 0, results: [] }, false);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].templateData.isPaymentReminder).toBe(true);
    expect(mail.sent[0].templateData.invoiceUrl).toBe(await liveLinkUrl(ID.invRecovery));
  });

  it('TG-18e: the due-soon reminder (flow.listener), which linked the non-existent /invoices/<id>, emails /public/invoice/<token>', async () => {
    expect(await linksOf(ID.invDueSoon)).toHaveLength(0);
    const mail = emailRecorder();
    const listener = Object.assign(Object.create(FlowListenerRef.prototype), {
      prisma: {
        client: {
          invoice: {
            findMany: async () => [{
              id: ID.invDueSoon,
              businessId: ID.bizA,
              invoiceNumber: 'V46A-DUESOON',
              total: TOTAL,
              currency: 'TTD',
              dueDate: new Date(Date.now() + DAY_MS),
              contact: { id: ID.contactA, firstName: 'V46a', lastName: 'Customer', email: `${P}duesoon@test.local` },
              items: [],
            }],
          },
          customerNotificationLog: { findFirst: async () => null },
        },
      },
      transactionalEmail: { send: mail.send },
      commerce,
      logger: quietLogger,
    });
    await listener.handleInvoiceDueSoonReminders();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].type).toBe('invoice_due_soon');
    expect(mail.sent[0].templateData.invoiceUrl).toBe(await liveLinkUrl(ID.invDueSoon));
  });

  it("TG-18g: the payment-failed email's retry link (flow.listener), which pointed at the non-existent /invoices/<id>/pay, is /public/invoice/<token>", async () => {
    const mail = emailRecorder();
    const listener = Object.assign(Object.create(FlowListenerRef.prototype), {
      prisma: {
        client: {
          invoice: {
            findFirst: async () => ({
              id: ID.invKeySend,
              invoiceNumber: 'V46A-FAILED',
              total: TOTAL,
              currency: 'TTD',
              contact: { id: ID.contactA, firstName: 'V46a', lastName: 'Customer', email: `${P}failed@test.local` },
            }),
          },
        },
      },
      transactionalEmail: { send: mail.send },
      commerce,
      logger: quietLogger,
    });
    await listener.handlePaymentFailedCustomerNotif({ businessId: ID.bizA, invoiceId: ID.invKeySend, amount: TOTAL, currency: 'TTD', error: 'declined' });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].type).toBe('payment_failed');
    expect(mail.sent[0].templateData.retryUrl).toBe(`${appUrl()}/public/invoice/${LINK_OF[ID.invKeySend].token}`);
  });

  it('TG-18f: the shared helper gives a settled invoice its existing link (findAnyPaymentLink, as resend-receipt does), never a bare-id URL', async () => {
    const url = await commerce.publicInvoiceUrl(ID.invPaid, ID.bizA);
    expect(url).toBe(`${appUrl()}/public/invoice/${LINK_OF[ID.invPaid].token}`);
    // A foreign tenant gets nothing for this invoice.
    await expect(commerce.publicInvoiceUrl(ID.invLive, ID.bizB)).rejects.toThrow();
  });

  /** The automated producers, each wired to the real CommerceService and an email recorder (TG-18b..e, g). */
  function producers(mail: ReturnType<typeof emailRecorder>) {
    const flowWith = (client: Record<string, unknown>) =>
      Object.assign(Object.create(FlowListenerRef.prototype), {
        prisma: { client: { notification: { create: async () => ({}) }, ...client } },
        transactionalEmail: { send: mail.send },
        commerce,
        logger: quietLogger,
      });
    const contactWithEmail = (email: string | null) => ({ id: ID.contactA, firstName: 'V46a', lastName: 'Customer', email });
    return {
      overdue: (invoiceId: string, email: string | null = `${P}auto_overdue@test.local`) =>
        flowWith({}).handleInvoiceOverdue({
          businessId: ID.bizA,
          invoice: {
            id: invoiceId,
            invoiceNumber: 'V46A-AUTO-OVERDUE',
            total: TOTAL,
            currency: 'TTD',
            dueDate: new Date(Date.now() - 10 * DAY_MS),
            contact: email === null ? null : contactWithEmail(email),
          },
        }),
      dueSoon: (invoiceId: string, email: string | null = `${P}auto_duesoon@test.local`) =>
        flowWith({
          invoice: {
            findMany: async () => [{
              id: invoiceId,
              businessId: ID.bizA,
              invoiceNumber: 'V46A-AUTO-DUESOON',
              total: TOTAL,
              currency: 'TTD',
              dueDate: new Date(Date.now() + DAY_MS),
              contact: contactWithEmail(email),
              items: [],
            }],
          },
          customerNotificationLog: { findFirst: async () => null },
        }).handleInvoiceDueSoonReminders(),
      paymentFailed: (invoiceId: string) =>
        flowWith({
          invoice: {
            findFirst: async () => ({
              id: invoiceId,
              invoiceNumber: 'V46A-AUTO-FAILED',
              total: TOTAL,
              currency: 'TTD',
              contact: contactWithEmail(`${P}auto_failed@test.local`),
            }),
          },
        }).handlePaymentFailedCustomerNotif({ businessId: ID.bizA, invoiceId, amount: TOTAL, currency: 'TTD', error: 'declined' }),
      recovery: (invoiceId: string) =>
        Object.assign(Object.create(DelegationLoopServiceRef.prototype), {
          prisma: {
            client: {
              invoice: {
                findMany: async () => [{
                  id: invoiceId,
                  invoiceNumber: 'V46A-AUTO-RECOVERY',
                  total: TOTAL,
                  dueDate: new Date(Date.now() - 10 * DAY_MS),
                  status: 'OVERDUE',
                  contact: { ...contactWithEmail(`${P}auto_recovery@test.local`), phone: null, doNotContact: false },
                }],
                update: async () => ({}),
              },
              autopilotTask: {
                findFirst: async () => null,
                create: async ({ data }: any) => ({ id: `${P}task_auto_${invoiceId}`, ...data }),
                update: async () => ({}),
              },
            },
          },
          timeline: { logEvent: async () => undefined },
          events: { emit: () => true },
          emailService: { send: mail.send },
          logger: quietLogger,
          contactWindow: async () => ({ allowed: true }),
          getCommerce: () => commerce,
        }).runPaymentRecovery(ID.bizA, {}, { itemsScanned: 0, itemsMatched: 0, actionsCreated: 0, results: [] }, false),
      keySend: (invoiceId: string) =>
        Object.assign(Object.create(FlowOrchestratorServiceRef.prototype), {
          prisma: prismaService,
          getTransactionalEmail: () => mail,
          getCommerce: () => ({
            automatedInvoiceUrl: (id: string, biz: string) => commerce.automatedInvoiceUrl(id, biz),
            publicInvoiceUrl: (id: string, biz: string) => commerce.publicInvoiceUrl(id, biz),
            updateInvoiceStatus: async () => ({ id: invoiceId, status: 'SENT' }),
          }),
          getActivityLog: () => ({ createActivity: async () => ({}) }),
        }).executeToolAction(ID.bizA, 'commerce_send_invoice', { invoiceId }),
    };
  }

  it('TG-18h (review SEC-V46B-2, CR-V46B-01): no automated producer reopens an invoice whose links were all revoked or expired: the overdue, due-soon, payment-failed, autopilot and KEY emails go without a pay link, no link is minted, and the bare-id routes stay closed', async () => {
    for (const inv of [ID.invAutoRevoked, ID.invAutoExpired]) {
      const linksBefore = await linksOf(inv);
      expect(linksBefore, inv).toHaveLength(1);
      expect(await commerce.isBareIdPublicAccessOpen(inv), inv).toBe(false);
      expect(await commerce.automatedInvoiceUrl(inv, ID.bizA), inv).toBeNull();

      const mail = emailRecorder();
      const run = producers(mail);
      await run.overdue(inv);
      await run.dueSoon(inv);
      await run.paymentFailed(inv);
      await run.recovery(inv);
      await run.keySend(inv);

      expect(mail.sent.map((m) => m.type), inv).toEqual(['invoice_overdue', 'invoice_due_soon', 'payment_failed', 'invoice_sent', 'invoice_sent']);
      for (const m of mail.sent) {
        expect(m.templateData.invoiceUrl, `${inv}: ${m.type}`).toBeUndefined();
        expect(m.templateData.retryUrl, `${inv}: ${m.type}`).toBeUndefined();
        expect(JSON.stringify(m.templateData), `${inv}: ${m.type}`).not.toContain('/public/invoice/');
      }
      expect(await linksOf(inv), `${inv}: links unchanged`).toEqual(linksBefore);
      expect(await commerce.isBareIdPublicAccessOpen(inv), inv).toBe(false);
      await clearRateLimits();
      expectUnknownAnswer(await bareProjection(inv), unknownBareRead, `${inv}: bare read`);
      expectUnknownAnswer(await bareStatus(inv), unknownBareStatus, `${inv}: bare status`);
      expectUnknownAnswer(await bareGateways(inv), unknownBareGateways, `${inv}: bare gateways`);
    }

    // A live link the operator gave an expiry is reused as it is: same token, same expiry, no second link.
    const expiring = await linksOf(ID.invAutoExpiring);
    const mail = emailRecorder();
    const run = producers(mail);
    await run.overdue(ID.invAutoExpiring);
    await run.dueSoon(ID.invAutoExpiring);
    await run.paymentFailed(ID.invAutoExpiring);
    expect(mail.sent).toHaveLength(3);
    const url = `${appUrl()}/public/invoice/${LINK.autoExpiring.token}`;
    expect(mail.sent.map((m) => m.templateData.invoiceUrl ?? m.templateData.retryUrl)).toEqual([url, url, url]);
    expect(await linksOf(ID.invAutoExpiring)).toEqual(expiring);

    // No email, no reminder: an invoice that never had a link gets none from a reminder that cannot be sent.
    expect(await linksOf(ID.invAutoNoEmail)).toHaveLength(0);
    const silent = emailRecorder();
    const quiet = producers(silent);
    await quiet.overdue(ID.invAutoNoEmail, null);
    await quiet.dueSoon(ID.invAutoNoEmail, null);
    expect(silent.sent).toHaveLength(0);
    expect(await linksOf(ID.invAutoNoEmail)).toHaveLength(0);
  });

  it('TG-18i (review SEC-V46B-1; V1-05 CR-V05-3): an anonymous, unsigned WiPay failure callback for an invoice whose link was revoked mints no link and mails nothing: it is answered { success: false } and emits no payment-failed event (real WiPayConnector and event bus), and the bare-id routes stay closed', async () => {
    const inv = ID.invAutoRevoked;
    const bus = new EventEmitter2Ref();
    const mail = emailRecorder();
    const listener = Object.assign(Object.create(FlowListenerRef.prototype), {
      prisma: prismaService,
      transactionalEmail: { send: mail.send },
      commerce,
      logger: quietLogger,
    });
    const handled: Promise<unknown>[] = [];
    bus.on('payment.failed', (payload: any) => { handled.push(listener.handlePaymentFailedCustomerNotif(payload)); });
    const previousConnector = payments.wipayConnector;
    payments.wipayConnector = new WiPayConnectorRef(prismaService, bus, {});
    const linksBefore = await linksOf(inv);
    const emitFailed = vi.spyOn(payments.wipayConnector, 'emitPaymentFailed');
    try {
      expect(await commerce.isBareIdPublicAccessOpen(inv)).toBe(false);
      const res = await agent()
        .get('/payments/wipay/callback')
        .query({ order_id: inv, status: 'failed', transaction_id: `${P}tx_forged_fail`, total: '1.00' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toEqual({ success: false, invoiceId: inv, message: 'Payment was not successful' });
    } finally {
      payments.wipayConnector = previousConnector;
    }

    // V1-05 (CR-V05-3, D-19): an unsigned failure is answered and acted on in no way: no payment-failed event, no email,
    // no FAILED row (it emailed the contact and wrote one before: TG-22, M35).
    expect(emitFailed).not.toHaveBeenCalled();
    expect(handled).toHaveLength(0);
    expect(mail.sent).toHaveLength(0);
    expect(await paymentsOf(inv)).toEqual([]);
    expect(await linksOf(inv), 'no link minted').toEqual(linksBefore);
    expect(await commerce.isBareIdPublicAccessOpen(inv)).toBe(false);
    await clearRateLimits();
    expectUnknownAnswer(await bareProjection(inv), unknownBareRead, 'bare read');
    expectUnknownAnswer(await bareStatus(inv), unknownBareStatus, 'bare status');
    expectUnknownAnswer(await bareGateways(inv), unknownBareGateways, 'bare gateways');
    expectUnknownAnswer(await bareCheckout(inv), unknownBareCheckout, 'bare create-checkout');
  });
});

describe('provider webhooks and callbacks keep working (V1-46b)', () => {
  it('TG-19: a signed Stripe checkout.session.completed webhook records the payment for an invoice whose link has been revoked (keyed by the signed event; no network)', async () => {
    expect((await linksOf(ID.invWhStripe)).every((l) => !l.active)).toBe(true);
    const payload = JSON.stringify({
      id: `${P}evt_stripe_wh`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `${P}cs_wh`,
          object: 'checkout.session',
          amount_total: 2500,
          currency: 'ttd',
          client_reference_id: ID.invWhStripe,
          metadata: { invoiceId: ID.invWhStripe, businessId: ID.bizA },
          payment_intent: `${P}pi_wh`,
        },
      },
    });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', PROVIDER_ENV.STRIPE_WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
    const res = await agent()
      .post('/payments/stripe/webhook')
      .set('stripe-signature', `t=${t},v1=${sig}`)
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rows = await paymentsOf(ID.invWhStripe);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'stripe', providerPaymentId: `${P}cs_wh`, status: 'SUCCESSFUL', amount: 25, businessId: ID.bizA });
    expect((await invoiceRow(ID.invWhStripe)).status).toBe('PARTIALLY_PAID');
  });

  it('TG-20: a verified PayPal PAYMENT.CAPTURE.COMPLETED webhook records the capture for an invoice whose link has been revoked (verification stubbed; no network)', async () => {
    const payload = JSON.stringify({
      id: `${P}evt_paypal_wh`,
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: `${P}cap_wh`, custom_id: ID.invWhPaypal, status: 'COMPLETED', amount: { value: '25.00', currency_code: 'TTD' } },
    });
    const res = await agent()
      .post('/payments/paypal/webhook')
      .set('Content-Type', 'application/json')
      .set('paypal-transmission-id', `${P}tx`)
      .set('paypal-transmission-time', new Date().toISOString())
      .set('paypal-transmission-sig', `${P}sig`)
      .set('paypal-cert-url', 'https://api-m.sandbox.paypal.com/cert.pem')
      .set('paypal-auth-algo', 'SHA256withRSA')
      .send(payload);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(providerCalls.some((c) => c.url.endsWith('/v1/notifications/verify-webhook-signature'))).toBe(true);
    const rows = await paymentsOf(ID.invWhPaypal);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'paypal', providerPaymentId: `${P}cap_wh`, status: 'SUCCESSFUL', amount: 25, businessId: ID.bizA });
  });

  it('TG-21: a WiPay success callback records the payment for an invoice whose link has been revoked', async () => {
    const q = { transaction_id: `${P}wipay_tx`, order_id: ID.invWhWipay, status: 'success', total: TOTAL.toFixed(2) };
    // V1-05 (D-19): WiPay's keyed proof over the requested total (the invoice's), which is the amount recorded.
    const hash = createHash('md5').update(`${q.transaction_id}${TOTAL.toFixed(2)}${PROVIDER_ENV.WIPAY_API_KEY}`).digest('hex');
    const res = await agent().get('/payments/wipay/callback').query({ ...q, hash });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    const rows = await paymentsOf(ID.invWhWipay);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'wipay', providerPaymentId: `${P}wipay_tx`, status: 'SUCCESSFUL', amount: TOTAL, businessId: ID.bizA });
  });

  it.todo(
    'TG-22 (M35, V1-05; found here, not in this write set\'s remit): the WiPay callback "signature" is md5(transaction_id + order_id + total + status) with no ' +
      'secret, so anyone holding an invoice id can forge a success callback and record a SUCCESSFUL, ledger-posted payment whatever the link state; ' +
      'the fix needs WiPay\'s keyed hash spec. An unsigned FAILURE callback likewise writes a FAILED row and emails the contact (TG-18i: no link any more). ' +
      'The token PayPal capture now captures only an order made for the invoice and its total (TG-14d, review SEC-V46B-3), but still records ' +
      'invoice.total rather than the captured amount and posts nothing to the ledger (payment.create, not createPaymentWithPosting); a later ' +
      'CAPTURE.COMPLETED webhook is then deduplicated and never posts.',
  );
});
