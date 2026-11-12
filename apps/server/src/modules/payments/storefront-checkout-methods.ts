/**
 * W11-STORE-CHECKOUT-METHOD-GATE (F-21, server half; owner rulings D-106,
 * D-105, D-69, D-18): the one rule for the payment method a public storefront
 * checkout names. It may name no method, CASH, MANUAL, or a method the
 * storefront's gateway list (PaymentsService.getAvailableGateways, what GET
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
 * PayPal and Stripe count as configured by the same reading of the business
 * settings and the platform env as the gateway list (paypalConfigured,
 * stripeConfigured; getAvailableGateways reads these two).
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

/** PayPal is configured for a business with a client id and secret, each from its settings or else the platform env. */
export function paypalConfigured(meta: unknown): boolean {
  const m = settingsOf(meta);
  return Boolean((m.paypalClientId || process.env.PAYPAL_CLIENT_ID) && (m.paypalClientSecret || process.env.PAYPAL_CLIENT_SECRET));
}

/** Stripe is configured for a business with a publishable key, a secret key and a webhook secret, each from its settings or else the env. */
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

/** The body of the 400 refusing PayPal or Stripe for a business that has not configured it. */
export function storefrontMethodNotOffered(method: 'PAYPAL' | 'STRIPE'): { code: string; message: string } {
  const name = method === 'PAYPAL' ? 'PayPal' : 'Stripe';
  return { code: PAYMENT_METHOD_NOT_OFFERED, message: `${name} is not configured for this business: choose another payment method` };
}
