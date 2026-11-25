/**
 * W11-STORE-CHECKOUT-METHOD-GATE (F-21, server half; owner rulings D-106,
 * D-105, D-69, D-18): the one rule for the payment method a public storefront
 * checkout names. It may name no method, CASH, MANUAL, or a method the
 * storefront's gateway list (PaymentsService.getStorefrontGateways, what GET
 * /site/storefront/public/:slug/gateways answers) offers for the business and
 * the order's currency. Anything else is refused before the order is written.
 *
 * At fb00af1c the checkout passed the method raw: createOrder compared it
 * upper-cased but untrimmed, and createStorePayment matched it exactly, so
 * ' PAYPAL', 'paypal', 'cash', 'BITCOIN', a PayPal store with no PayPal (a
 * 500) and a Stripe store with no Stripe were each refused only after the
 * order, its retry slot and its promo use had committed and the CRM hooks had
 * run.
 *
 * The method is read trimmed and upper-cased (normalizeStorefrontMethod); the
 * public checkout normalises it once (SiteController.publicCheckout) and the
 * normalised value is what the order stores and the retry key hashes.
 *
 * W11-STORE-OWN-PAYMENT-KEYS (owner ruling D-138, 2026-11-12, closing review
 * SEC-W11SCM-1: D-105 extended to PayPal and Stripe): a storefront offers
 * PayPal or Stripe only when the business has saved its own complete set in
 * its settings (storePaypalCredentials: a client id and a secret;
 * storeStripeCredentials: a publishable key, a secret key and a webhook
 * secret), each a non-blank string. The platform env (PAYPAL_CLIENT_ID /
 * PAYPAL_CLIENT_SECRET, STRIPE_*) never stands in for a store, and a store's
 * key is never mixed with a platform key. One reading for every storefront
 * path, changed together: the storefront gateway list
 * (PaymentsService.getStorefrontGateways), the checkout gate
 * (StoreOrderService.createOrder), createStorePayment (the PayPal client and
 * the Stripe session are built from these values only) and the storefront
 * PayPal capture (the PayPal webhook's signature check for a storefront order,
 * PaymentsService.resolvePaypalBusinessCreds). Before D-138 each credential
 * came from the settings or else the env, one by one, so the platform's PayPal
 * / Stripe, alone or beside one of the store's own keys, counted as the
 * store's. Review repair (SEC-W11OPK-2, OPK-COR-1): the storefront Stripe
 * settlement too: the store's own account's event naming its order is verified
 * with storeStripeCredentials(...).webhookSecret (PaymentsService.
 * handleStripeWebhook), and a platform-signed one does not settle the order of
 * a store holding its own complete set (bindStripePaymentEvent).
 *
 * The invoice pay link is NOT changed by D-138 here: paypalConfigured and
 * stripeConfigured below are its reading (PaymentsService.getAvailableGateways
 * serves the pay link, the bare-id pay page and the generic invoice checkout),
 * and still admit the platform env, alone or mixed. Recorded as a deviation for
 * an owner ruling.
 */

/** The methods a storefront checkout may name (normalised). CASH and MANUAL start no provider session (D-18). */
export const STOREFRONT_CHECKOUT_METHODS: readonly string[] = Object.freeze(['CASH', 'MANUAL', 'WIPAY', 'PAYPAL', 'STRIPE']);

/** The code of the 400 refusing a method outside STOREFRONT_CHECKOUT_METHODS. */
export const PAYMENT_METHOD_UNSUPPORTED = 'PAYMENT_METHOD_UNSUPPORTED';

/** The code of the 400 refusing a known method this business's storefront does not offer (no PayPal, no Stripe). */
export const PAYMENT_METHOD_NOT_OFFERED = 'PAYMENT_METHOD_NOT_OFFERED';

/** The method trimmed and upper-cased; a blank or non-string method is no method (null). */
export function normalizeStorefrontMethod(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const method = raw.trim().toUpperCase();
  return method === '' ? null : method;
}

/** The business settings as getAvailableGateways reads them (`metaData || {}`). */
function settingsOf(meta: unknown): Record<string, unknown> {
  return (meta as Record<string, unknown>) || {};
}

/** A credential the business saved: a non-blank string in its settings object, as stored; else null. */
function savedCredential(meta: unknown, key: string): string | null {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const value = (meta as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** A store's own PayPal app credentials (D-138, W1F-STORE-PAYPAL / OPK-COR-2). */
export interface StorePaypalCredentials {
  clientId: string;
  clientSecret: string;
  webhookId: string;
}

/** A store's own Stripe account credentials (D-138). */
export interface StoreStripeCredentials {
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
}

/**
 * W11-STORE-OWN-PAYMENT-KEYS (D-138) + W1F-STORE-PAYPAL (OPK-COR-2): the store's own complete PayPal set (client id,
 * client secret, and webhook id) from its settings, or null. Never reads the platform env, so a store missing any of
 * the three (including webhook id, without which storefront captures cannot settle) has no storefront PayPal.
 */
export function storePaypalCredentials(meta: unknown): StorePaypalCredentials | null {
  const clientId = savedCredential(meta, 'paypalClientId');
  const clientSecret = savedCredential(meta, 'paypalClientSecret');
  const webhookId = savedCredential(meta, 'paypalWebhookId');
  return clientId && clientSecret && webhookId ? { clientId, clientSecret, webhookId } : null;
}

/**
 * W11-STORE-OWN-PAYMENT-KEYS (D-138): the store's own complete Stripe set (publishable key, secret key and webhook
 * secret) from its settings, or null. Never reads the platform env.
 */
export function storeStripeCredentials(meta: unknown): StoreStripeCredentials | null {
  const publishableKey = savedCredential(meta, 'stripePublishableKey');
  const secretKey = savedCredential(meta, 'stripeSecretKey');
  const webhookSecret = savedCredential(meta, 'stripeWebhookSecret');
  return publishableKey && secretKey && webhookSecret ? { publishableKey, secretKey, webhookSecret } : null;
}

/**
 * W11-STORE-OWN-PAYMENT-KEYS (D-138): the store's own PayPal webhook id (paypalWebhookId in its settings), or null.
 * The storefront PayPal capture (PayPal's webhook naming a storefront order) is verified with the store's own triple
 * only: the platform's PAYPAL_WEBHOOK_ID belongs to the platform's app and is never mixed in.
 */
export function storePaypalWebhookId(meta: unknown): string | null {
  return savedCredential(meta, 'paypalWebhookId');
}

/**
 * The invoice pay link's reading (PaymentsService.getAvailableGateways), not the storefront's: PayPal is configured
 * for a business with a client id and secret, each from its settings or else the platform env, as built. D-138 rules
 * this out for the storefront (storePaypalCredentials); whether the pay link keeps it awaits an owner ruling.
 */
export function paypalConfigured(meta: unknown): boolean {
  const m = settingsOf(meta);
  return Boolean((m.paypalClientId || process.env.PAYPAL_CLIENT_ID) && (m.paypalClientSecret || process.env.PAYPAL_CLIENT_SECRET));
}

/**
 * The invoice pay link's reading (PaymentsService.getAvailableGateways), not the storefront's: Stripe is configured for
 * a business with a publishable key, a secret key and a webhook secret, each from its settings or else the env, as
 * built. D-138 rules this out for the storefront (storeStripeCredentials); the pay link awaits an owner ruling.
 */
export function stripeConfigured(meta: unknown): boolean {
  const m = settingsOf(meta);
  const publishable = m.stripePublishableKey || process.env.STRIPE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const secret = m.stripeSecretKey || process.env.STRIPE_SECRET_KEY;
  const webhook = m.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
  return Boolean(publishable && secret && webhook);
}

/** The body of the 400 refusing a method no storefront checkout takes; names the method as sent, trimmed. */
export function storefrontMethodUnsupported(raw: string): { code: string; message: string } {
  return { code: PAYMENT_METHOD_UNSUPPORTED, message: `Unsupported payment method: ${raw.trim()}` };
}

/** The body of the 400 refusing PayPal or Stripe for a store with no complete set of its own (D-138). */
export function storefrontMethodNotOffered(method: 'PAYPAL' | 'STRIPE'): { code: string; message: string } {
  const name = method === 'PAYPAL' ? 'PayPal' : 'Stripe';
  return { code: PAYMENT_METHOD_NOT_OFFERED, message: `${name} is not configured for this business: choose another payment method` };
}
