/**
 * W11-STORE-CHECKOUT-METHOD-GATE (F-21, server half; D-106, D-105, D-18): the
 * one rule the public storefront checkout reads before it writes an order. A
 * checkout may name no method, CASH, MANUAL, or a method the storefront's
 * gateway list offers (PaymentsService.getAvailableGateways). The method is
 * read trimmed and upper-cased; PayPal and Stripe count as configured by the
 * same reading of the business settings and the platform env as the gateway
 * list.
 *
 *   SCM-01  normalizeStorefrontMethod trims and upper-cases; a blank or
 *           non-string method is no method (null)
 *   SCM-02  the methods a storefront checkout may name are CASH, MANUAL, WIPAY,
 *           PAYPAL and STRIPE, and the list cannot be changed at runtime
 *   SCM-03  paypalConfigured and stripeConfigured over the business settings /
 *           env combinations, and getAvailableGateways offers PayPal and Stripe
 *           for exactly the same rows (one table drives both)
 *   SCM-04  the refusal bodies: PAYMENT_METHOD_UNSUPPORTED names the trimmed
 *           method, PAYMENT_METHOD_NOT_OFFERED names the provider
 *   SCM-05  (todo) review SEC-W11SCM-1: whether the platform's PayPal / Stripe
 *           env credentials, alone or mixed with a store's own, may count as
 *           the store's own awaits an owner ruling (a D-105 analogue). The
 *           SCM-03 rows marked "as built (SEC-W11SCM-1)" record the gateway
 *           list's reading before this packet, kept so the gate and the list
 *           agree; they are not a ruled expectation and change with the ruling
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PAYMENT_METHOD_NOT_OFFERED,
  PAYMENT_METHOD_UNSUPPORTED,
  STOREFRONT_CHECKOUT_METHODS,
  normalizeStorefrontMethod,
  paypalConfigured,
  storefrontMethodNotOffered,
  storefrontMethodUnsupported,
  stripeConfigured,
} from './storefront-checkout-methods';
import { PaymentsService } from './payments.service';

const ENV_KEYS = [
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'STRIPE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
] as const;
type EnvKey = (typeof ENV_KEYS)[number];

// Obviously fake values (no provider key shape).
const PP_ID = 'scm-paypal-client-fake';
const PP_SECRET = 'scm-paypal-secret-fake';
const ST_PUB = 'scm-stripe-publishable-fake';
const ST_SECRET = 'scm-stripe-secret-fake';
const ST_WH = 'scm-stripe-webhook-fake';

type Row = {
  label: string;
  meta: unknown;
  env: Partial<Record<EnvKey, string>>;
  paypal: boolean;
  stripe: boolean;
};

// Rows labelled "as built, SEC-W11SCM-1" admit the platform's env credentials, alone or mixed with a store's own: the
// gateway list's reading before this packet, kept so the checkout gate and the list agree. Whether the platform's
// PayPal / Stripe may stand in for a store's own awaits an owner ruling (a D-105 analogue); these rows change with it.
const ROWS: Row[] = [
  { label: 'nothing anywhere', meta: null, env: {}, paypal: false, stripe: false },
  { label: 'empty settings', meta: {}, env: {}, paypal: false, stripe: false },
  { label: 'settings that are not an object', meta: 'not-an-object', env: {}, paypal: false, stripe: false },
  { label: 'PayPal pair in the settings', meta: { paypalClientId: PP_ID, paypalClientSecret: PP_SECRET }, env: {}, paypal: true, stripe: false },
  { label: 'PayPal id only in the settings', meta: { paypalClientId: PP_ID }, env: {}, paypal: false, stripe: false },
  { label: 'PayPal secret only in the settings', meta: { paypalClientSecret: PP_SECRET }, env: {}, paypal: false, stripe: false },
  { label: 'PayPal blank in the settings', meta: { paypalClientId: '', paypalClientSecret: '' }, env: {}, paypal: false, stripe: false },
  { label: 'PayPal pair in the env (as built, SEC-W11SCM-1)', meta: null, env: { PAYPAL_CLIENT_ID: PP_ID, PAYPAL_CLIENT_SECRET: PP_SECRET }, paypal: true, stripe: false },
  { label: 'PayPal id in the settings, secret in the env (as built, SEC-W11SCM-1)', meta: { paypalClientId: PP_ID }, env: { PAYPAL_CLIENT_SECRET: PP_SECRET }, paypal: true, stripe: false },
  { label: 'PayPal id only in the env', meta: {}, env: { PAYPAL_CLIENT_ID: PP_ID }, paypal: false, stripe: false },
  {
    label: 'Stripe triple in the settings',
    meta: { stripePublishableKey: ST_PUB, stripeSecretKey: ST_SECRET, stripeWebhookSecret: ST_WH },
    env: {},
    paypal: false,
    stripe: true,
  },
  { label: 'Stripe without a webhook secret', meta: { stripePublishableKey: ST_PUB, stripeSecretKey: ST_SECRET }, env: {}, paypal: false, stripe: false },
  { label: 'Stripe secret only in the settings', meta: { stripeSecretKey: ST_SECRET }, env: {}, paypal: false, stripe: false },
  {
    label: 'Stripe triple in the env (as built, SEC-W11SCM-1)',
    meta: null,
    env: { STRIPE_PUBLISHABLE_KEY: ST_PUB, STRIPE_SECRET_KEY: ST_SECRET, STRIPE_WEBHOOK_SECRET: ST_WH },
    paypal: false,
    stripe: true,
  },
  {
    label: 'Stripe with the NEXT_PUBLIC publishable key (as built, SEC-W11SCM-1)',
    meta: {},
    env: { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: ST_PUB, STRIPE_SECRET_KEY: ST_SECRET, STRIPE_WEBHOOK_SECRET: ST_WH },
    paypal: false,
    stripe: true,
  },
  {
    label: 'Stripe split between the settings and the env (as built, SEC-W11SCM-1)',
    meta: { stripePublishableKey: ST_PUB },
    env: { STRIPE_SECRET_KEY: ST_SECRET, STRIPE_WEBHOOK_SECRET: ST_WH },
    paypal: false,
    stripe: true,
  },
  { label: 'Stripe env without a publishable key', meta: {}, env: { STRIPE_SECRET_KEY: ST_SECRET, STRIPE_WEBHOOK_SECRET: ST_WH }, paypal: false, stripe: false },
  {
    label: 'both in the settings',
    meta: { paypalClientId: PP_ID, paypalClientSecret: PP_SECRET, stripePublishableKey: ST_PUB, stripeSecretKey: ST_SECRET, stripeWebhookSecret: ST_WH },
    env: {},
    paypal: true,
    stripe: true,
  },
];

/** getAvailableGateways over a business whose stored settings are `meta` (USD: PayPal and Stripe both take it). */
async function gatewayIdsFor(meta: unknown): Promise<string[]> {
  const prisma = { client: { business: { findUnique: async () => ({ metaData: meta, currency: 'USD' }) } } };
  const service = new PaymentsService(prisma as never, {} as never, {} as never, {} as never);
  return (await service.getAvailableGateways('scm_biz', 'USD')).map((g) => g.id);
}

describe('W11-STORE-CHECKOUT-METHOD-GATE: the methods a storefront checkout may name (F-21; D-106, D-105, D-18)', () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('SCM-01 (W11-STORE-CHECKOUT-METHOD-GATE, F-21): normalizeStorefrontMethod trims and upper-cases; a blank or non-string method is no method', () => {
    const cases: Array<[unknown, string | null]> = [
      ['PAYPAL', 'PAYPAL'],
      [' PAYPAL', 'PAYPAL'],
      ['paypal ', 'PAYPAL'],
      [' PayPal ', 'PAYPAL'],
      ['cash', 'CASH'],
      ['Manual', 'MANUAL'],
      ['\twipay\n', 'WIPAY'],
      ['stripe', 'STRIPE'],
      ['bitcoin', 'BITCOIN'],
      ['', null],
      ['   ', null],
      [null, null],
      [undefined, null],
      [42, null],
      [true, null],
      [{}, null],
      [['PAYPAL'], null],
    ];
    for (const [raw, expected] of cases) {
      expect(normalizeStorefrontMethod(raw), JSON.stringify(raw)).toBe(expected);
    }
  });

  it('SCM-02 (W11-STORE-CHECKOUT-METHOD-GATE, F-21): a storefront checkout may name CASH, MANUAL, WIPAY, PAYPAL or STRIPE, and the list cannot be changed at runtime', () => {
    expect([...STOREFRONT_CHECKOUT_METHODS]).toEqual(['CASH', 'MANUAL', 'WIPAY', 'PAYPAL', 'STRIPE']);
    expect(Object.isFrozen(STOREFRONT_CHECKOUT_METHODS)).toBe(true);
    for (const method of ['CARD', 'BITCOIN', 'BANK_TRANSFER']) {
      expect(STOREFRONT_CHECKOUT_METHODS.includes(method), method).toBe(false);
    }
  });

  it('SCM-03 (W11-STORE-CHECKOUT-METHOD-GATE, F-21; D-106): paypalConfigured and stripeConfigured read the business settings or the env as getAvailableGateways does: one table drives the helpers and the gateway list', async () => {
    for (const row of ROWS) {
      for (const k of ENV_KEYS) delete process.env[k];
      Object.assign(process.env, row.env);
      expect(`${paypalConfigured(row.meta)}/${stripeConfigured(row.meta)}`, `helpers: ${row.label}`).toBe(`${row.paypal}/${row.stripe}`);
      const ids = await gatewayIdsFor(row.meta);
      expect(`${ids.includes('paypal')}/${ids.includes('stripe')}`, `gateway list: ${row.label}`).toBe(`${row.paypal}/${row.stripe}`);
    }
  });

  it('SCM-04 (W11-STORE-CHECKOUT-METHOD-GATE, F-21): the refusal bodies name the trimmed method or the provider, with their codes', () => {
    expect(PAYMENT_METHOD_UNSUPPORTED).toBe('PAYMENT_METHOD_UNSUPPORTED');
    expect(PAYMENT_METHOD_NOT_OFFERED).toBe('PAYMENT_METHOD_NOT_OFFERED');
    expect(storefrontMethodUnsupported('  bitcoin ')).toEqual({ code: 'PAYMENT_METHOD_UNSUPPORTED', message: 'Unsupported payment method: bitcoin' });
    expect(storefrontMethodNotOffered('PAYPAL')).toEqual({
      code: 'PAYMENT_METHOD_NOT_OFFERED',
      message: 'PayPal is not configured for this business: choose another payment method',
    });
    expect(storefrontMethodNotOffered('STRIPE')).toEqual({
      code: 'PAYMENT_METHOD_NOT_OFFERED',
      message: 'Stripe is not configured for this business: choose another payment method',
    });
  });

  // Review SEC-W11SCM-1 (pre-existing, not a regression of this packet): needs an owner ruling before the reading
  // changes; the gateway list, this gate and createStorePayment must then change together.
  it.todo(
    "SCM-05 (W11-STORE-CHECKOUT-METHOD-GATE review SEC-W11SCM-1; awaiting an owner ruling, a D-105 analogue for PayPal and Stripe): whether the platform's PayPal / Stripe env credentials, alone or mixed with a store's own, may count as the store's own at the storefront gateway list and checkout; SCM-03's 'as built' rows change with that ruling",
  );
});
