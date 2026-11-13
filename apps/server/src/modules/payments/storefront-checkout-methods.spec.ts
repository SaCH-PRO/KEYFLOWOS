/**
 * W11-STORE-CHECKOUT-METHOD-GATE (F-21, server half; D-106, D-105, D-18): the
 * one rule the public storefront checkout reads before it writes an order. A
 * checkout may name no method, CASH, MANUAL, or a method the storefront's
 * gateway list offers (PaymentsService.getStorefrontGateways). The method is
 * read trimmed and upper-cased; PayPal and Stripe count as offered by the same
 * reading of the business settings as the storefront gateway list: the
 * business's own complete credentials only (D-138, W11-STORE-OWN-PAYMENT-KEYS).
 *
 *   SCM-01  normalizeStorefrontMethod trims and upper-cases; a blank or
 *           non-string method is no method (null)
 *   SCM-02  the methods a storefront checkout may name are CASH, MANUAL, WIPAY,
 *           PAYPAL and STRIPE, and the list cannot be changed at runtime
 *   SCM-03  W11-STORE-OWN-PAYMENT-KEYS (owner ruling D-138): one table of
 *           business settings / env combinations drives two readings. The
 *           storefront's (storePaypalCredentials, storeStripeCredentials,
 *           getStorefrontGateways: what GET /site/storefront/public/:slug/
 *           gateways answers and the checkout gate reads) counts only the
 *           business's own complete set: PayPal a client id and a secret,
 *           Stripe a publishable key, a secret key and a webhook secret, each a
 *           non-blank string saved in its settings; the platform env never
 *           stands in and is never mixed in. The invoice pay link's
 *           (paypalConfigured, stripeConfigured, getAvailableGateways) is
 *           unchanged by D-138 (rows marked "pay link as built": the platform
 *           env alone or mixed still counts there, recorded as a deviation for
 *           an owner ruling)
 *   SCM-04  the refusal bodies: PAYMENT_METHOD_UNSUPPORTED names the trimmed
 *           method, PAYMENT_METHOD_NOT_OFFERED names the provider
 *   SCM-05  (was it.todo, review SEC-W11SCM-1; ruled D-138) the storefront
 *           credentials are exactly the store's own saved values whatever the
 *           platform env holds: never the platform's, never one of the
 *           platform's beside one of the store's; an incomplete own set is no
 *           set (null) even with the platform's set complete, and the
 *           storefront gateway list agrees row by row
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PAYMENT_METHOD_NOT_OFFERED,
  PAYMENT_METHOD_UNSUPPORTED,
  STOREFRONT_CHECKOUT_METHODS,
  normalizeStorefrontMethod,
  paypalConfigured,
  storePaypalCredentials,
  storeStripeCredentials,
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

// Obviously fake values (no provider key shape). The store's own (in its settings) and the platform's (in the env)
// differ, so a reading that mixes them is visible.
const PP_ID = 'scm-paypal-client-fake';
const PP_SECRET = 'scm-paypal-secret-fake';
const ST_PUB = 'scm-stripe-publishable-fake';
const ST_SECRET = 'scm-stripe-secret-fake';
const ST_WH = 'scm-stripe-webhook-fake';
const PLATFORM_PP_ID = 'scm-platform-paypal-client-fake';
const PLATFORM_PP_SECRET = 'scm-platform-paypal-secret-fake';
const PLATFORM_ST_PUB = 'scm-platform-stripe-publishable-fake';
const PLATFORM_ST_SECRET = 'scm-platform-stripe-secret-fake';
const PLATFORM_ST_WH = 'scm-platform-stripe-webhook-fake';
const PLATFORM_PAYPAL_ENV = { PAYPAL_CLIENT_ID: PLATFORM_PP_ID, PAYPAL_CLIENT_SECRET: PLATFORM_PP_SECRET };
const PLATFORM_STRIPE_ENV = {
  STRIPE_PUBLISHABLE_KEY: PLATFORM_ST_PUB,
  STRIPE_SECRET_KEY: PLATFORM_ST_SECRET,
  STRIPE_WEBHOOK_SECRET: PLATFORM_ST_WH,
};

/** [paypal, stripe] offered. */
type Offer = [paypal: boolean, stripe: boolean];

type Row = {
  label: string;
  meta: unknown;
  env: Partial<Record<EnvKey, string>>;
  /** D-138: the storefront (gateway list, checkout gate, createStorePayment). */
  store: Offer;
  /** The invoice pay link (getAvailableGateways), unchanged by D-138: rows marked "pay link as built" admit the env. */
  payLink: Offer;
};

// D-138 (W11-STORE-OWN-PAYMENT-KEYS): the storefront offers PayPal / Stripe only for the business's own complete set
// in its settings. Rows marked "pay link as built" are the invoice pay link's reading, which this packet does not
// change (the platform env alone or mixed with a business's own still counts there): a deviation recorded for an owner
// ruling, not a ruled expectation.
const ROWS: Row[] = [
  { label: 'nothing anywhere', meta: null, env: {}, store: [false, false], payLink: [false, false] },
  { label: 'empty settings', meta: {}, env: {}, store: [false, false], payLink: [false, false] },
  { label: 'settings that are not an object', meta: 'not-an-object', env: {}, store: [false, false], payLink: [false, false] },
  { label: 'PayPal pair in the settings', meta: { paypalClientId: PP_ID, paypalClientSecret: PP_SECRET }, env: {}, store: [true, false], payLink: [true, false] },
  {
    label: 'PayPal pair in the settings, another pair in the env',
    meta: { paypalClientId: PP_ID, paypalClientSecret: PP_SECRET },
    env: PLATFORM_PAYPAL_ENV,
    store: [true, false],
    payLink: [true, false],
  },
  { label: 'PayPal id only in the settings', meta: { paypalClientId: PP_ID }, env: {}, store: [false, false], payLink: [false, false] },
  { label: 'PayPal secret only in the settings', meta: { paypalClientSecret: PP_SECRET }, env: {}, store: [false, false], payLink: [false, false] },
  { label: 'PayPal blank in the settings', meta: { paypalClientId: '', paypalClientSecret: '' }, env: {}, store: [false, false], payLink: [false, false] },
  {
    label: 'PayPal spaces in the settings (no saved credential; pay link as built)',
    meta: { paypalClientId: '   ', paypalClientSecret: ' ' },
    env: {},
    store: [false, false],
    payLink: [true, false],
  },
  {
    label: 'PayPal not strings in the settings (no saved credential; pay link as built)',
    meta: { paypalClientId: 42, paypalClientSecret: true },
    env: {},
    store: [false, false],
    payLink: [true, false],
  },
  { label: 'PayPal pair in the env only (D-138: not the store\'s; pay link as built)', meta: null, env: PLATFORM_PAYPAL_ENV, store: [false, false], payLink: [true, false] },
  {
    label: 'PayPal id in the settings, secret in the env (D-138: never mixed; pay link as built)',
    meta: { paypalClientId: PP_ID },
    env: { PAYPAL_CLIENT_SECRET: PLATFORM_PP_SECRET },
    store: [false, false],
    payLink: [true, false],
  },
  {
    label: 'PayPal id in the settings, the platform pair in the env (D-138: never mixed; pay link as built)',
    meta: { paypalClientId: PP_ID },
    env: PLATFORM_PAYPAL_ENV,
    store: [false, false],
    payLink: [true, false],
  },
  {
    label: 'PayPal secret in the settings, id in the env (D-138: never mixed; pay link as built)',
    meta: { paypalClientSecret: PP_SECRET },
    env: { PAYPAL_CLIENT_ID: PLATFORM_PP_ID },
    store: [false, false],
    payLink: [true, false],
  },
  { label: 'PayPal id only in the env', meta: {}, env: { PAYPAL_CLIENT_ID: PLATFORM_PP_ID }, store: [false, false], payLink: [false, false] },
  {
    label: 'Stripe triple in the settings',
    meta: { stripePublishableKey: ST_PUB, stripeSecretKey: ST_SECRET, stripeWebhookSecret: ST_WH },
    env: {},
    store: [false, true],
    payLink: [false, true],
  },
  {
    label: 'Stripe triple in the settings, another triple in the env',
    meta: { stripePublishableKey: ST_PUB, stripeSecretKey: ST_SECRET, stripeWebhookSecret: ST_WH },
    env: PLATFORM_STRIPE_ENV,
    store: [false, true],
    payLink: [false, true],
  },
  { label: 'Stripe without a webhook secret', meta: { stripePublishableKey: ST_PUB, stripeSecretKey: ST_SECRET }, env: {}, store: [false, false], payLink: [false, false] },
  { label: 'Stripe secret only in the settings', meta: { stripeSecretKey: ST_SECRET }, env: {}, store: [false, false], payLink: [false, false] },
  {
    label: 'Stripe blank webhook secret in the settings',
    meta: { stripePublishableKey: ST_PUB, stripeSecretKey: ST_SECRET, stripeWebhookSecret: '  ' },
    env: {},
    store: [false, false],
    payLink: [false, true],
  },
  { label: 'Stripe triple in the env only (D-138: not the store\'s; pay link as built)', meta: null, env: PLATFORM_STRIPE_ENV, store: [false, false], payLink: [false, true] },
  {
    label: 'Stripe with the NEXT_PUBLIC publishable key in the env (D-138: not the store\'s; pay link as built)',
    meta: {},
    env: { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PLATFORM_ST_PUB, STRIPE_SECRET_KEY: PLATFORM_ST_SECRET, STRIPE_WEBHOOK_SECRET: PLATFORM_ST_WH },
    store: [false, false],
    payLink: [false, true],
  },
  {
    label: 'Stripe publishable key in the settings, the rest in the env (D-138: never mixed; pay link as built)',
    meta: { stripePublishableKey: ST_PUB },
    env: { STRIPE_SECRET_KEY: PLATFORM_ST_SECRET, STRIPE_WEBHOOK_SECRET: PLATFORM_ST_WH },
    store: [false, false],
    payLink: [false, true],
  },
  {
    label: 'Stripe keys in the settings, webhook secret in the env (D-138: never mixed; pay link as built)',
    meta: { stripePublishableKey: ST_PUB, stripeSecretKey: ST_SECRET },
    env: PLATFORM_STRIPE_ENV,
    store: [false, false],
    payLink: [false, true],
  },
  { label: 'Stripe env without a publishable key', meta: {}, env: { STRIPE_SECRET_KEY: PLATFORM_ST_SECRET, STRIPE_WEBHOOK_SECRET: PLATFORM_ST_WH }, store: [false, false], payLink: [false, false] },
  {
    label: 'both in the settings',
    meta: { paypalClientId: PP_ID, paypalClientSecret: PP_SECRET, stripePublishableKey: ST_PUB, stripeSecretKey: ST_SECRET, stripeWebhookSecret: ST_WH },
    env: {},
    store: [true, true],
    payLink: [true, true],
  },
  {
    label: 'both in the env only (D-138: not the store\'s; pay link as built)',
    meta: {},
    env: { ...PLATFORM_PAYPAL_ENV, ...PLATFORM_STRIPE_ENV },
    store: [false, false],
    payLink: [true, true],
  },
];

/** A PaymentsService over a business whose stored settings are `meta` (USD: PayPal and Stripe both take it). */
function serviceFor(meta: unknown): PaymentsService {
  const prisma = { client: { business: { findUnique: async () => ({ metaData: meta, currency: 'USD' }) } } };
  return new PaymentsService(prisma as never, {} as never, {} as never, {} as never);
}

/** The invoice pay link's gateway list (getAvailableGateways), as [paypal, stripe] offered. */
async function payLinkOfferFor(meta: unknown): Promise<Offer> {
  const ids = (await serviceFor(meta).getAvailableGateways('scm_biz', 'USD')).map((g) => g.id);
  return [ids.includes('paypal'), ids.includes('stripe')];
}

/** The storefront's gateway list (getStorefrontGateways, GET /site/storefront/public/:slug/gateways), as [paypal, stripe] offered. */
async function storefrontOfferFor(meta: unknown): Promise<Offer> {
  const ids = (await serviceFor(meta).getStorefrontGateways('scm_biz', 'USD')).map((g) => g.id);
  return [ids.includes('paypal'), ids.includes('stripe')];
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

  it("SCM-03 (W11-STORE-CHECKOUT-METHOD-GATE, F-21; W11-STORE-OWN-PAYMENT-KEYS, D-138): one table drives two readings: the storefront's (storePaypalCredentials / storeStripeCredentials and getStorefrontGateways) counts only the business's own complete set in its settings, never the platform env alone or mixed; the invoice pay link's (paypalConfigured / stripeConfigured and getAvailableGateways) is unchanged", async () => {
    for (const row of ROWS) {
      for (const k of ENV_KEYS) delete process.env[k];
      Object.assign(process.env, row.env);
      const expectedStore = `${row.store[0]}/${row.store[1]}`;
      const expectedPayLink = `${row.payLink[0]}/${row.payLink[1]}`;
      expect(
        `${storePaypalCredentials(row.meta) !== null}/${storeStripeCredentials(row.meta) !== null}`,
        `storefront helpers: ${row.label}`,
      ).toBe(expectedStore);
      expect((await storefrontOfferFor(row.meta)).join('/'), `storefront gateway list: ${row.label}`).toBe(expectedStore);
      expect(`${paypalConfigured(row.meta)}/${stripeConfigured(row.meta)}`, `pay-link helpers: ${row.label}`).toBe(expectedPayLink);
      expect((await payLinkOfferFor(row.meta)).join('/'), `pay-link gateway list: ${row.label}`).toBe(expectedPayLink);
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

  it("SCM-05 (W11-STORE-OWN-PAYMENT-KEYS, D-138; was it.todo, review SEC-W11SCM-1): the storefront credentials are exactly the store's own saved values whatever the platform env holds (never the platform's, never one of each), and an incomplete own set is no set even with the platform's set complete", () => {
    Object.assign(process.env, PLATFORM_PAYPAL_ENV, PLATFORM_STRIPE_ENV, { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PLATFORM_ST_PUB });

    // The store's own complete sets: its values, each one, with the platform's complete sets in the env.
    expect(storePaypalCredentials({ paypalClientId: PP_ID, paypalClientSecret: PP_SECRET })).toEqual({ clientId: PP_ID, clientSecret: PP_SECRET });
    expect(storeStripeCredentials({ stripePublishableKey: ST_PUB, stripeSecretKey: ST_SECRET, stripeWebhookSecret: ST_WH })).toEqual({
      publishableKey: ST_PUB,
      secretKey: ST_SECRET,
      webhookSecret: ST_WH,
    });

    // Every incomplete own set, with the platform's complete sets in the env: no set (the platform's never fills a gap).
    const paypalPartial: unknown[] = [
      null,
      undefined,
      {},
      [],
      'not-an-object',
      { paypalClientId: PP_ID },
      { paypalClientSecret: PP_SECRET },
      { paypalClientId: PP_ID, paypalClientSecret: '' },
      { paypalClientId: '', paypalClientSecret: PP_SECRET },
      { paypalClientId: PP_ID, paypalClientSecret: '   ' },
      { paypalClientId: ' \t', paypalClientSecret: PP_SECRET },
      { paypalClientId: PP_ID, paypalClientSecret: 7 },
      { paypalClientId: { id: PP_ID }, paypalClientSecret: PP_SECRET },
    ];
    for (const meta of paypalPartial) {
      expect(storePaypalCredentials(meta), `PayPal ${JSON.stringify(meta)}`).toBeNull();
    }
    const triple = { stripePublishableKey: ST_PUB, stripeSecretKey: ST_SECRET, stripeWebhookSecret: ST_WH };
    const stripePartial: unknown[] = [null, undefined, {}, 'not-an-object'];
    for (const key of Object.keys(triple) as Array<keyof typeof triple>) {
      stripePartial.push({ ...triple, [key]: undefined }, { ...triple, [key]: '' }, { ...triple, [key]: '  ' }, { ...triple, [key]: 1 });
    }
    for (const meta of stripePartial) {
      expect(storeStripeCredentials(meta), `Stripe ${JSON.stringify(meta)}`).toBeNull();
    }
  });
});
