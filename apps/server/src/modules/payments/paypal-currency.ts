/**
 * W10-PAYPAL-CURRENCY (owner ruling D-106; PC-08b, review V05-COR-4 /
 * CR-V05-4): PayPal is not offered for an invoice, pay link or storefront
 * order in a currency PayPal does not support (TTD, JMD, BBD, GYD, XCD and
 * any other it does not list). PayPal refused createPaypalOrder's order in
 * such a currency, so the payer of a TTD invoice was offered PayPal and got
 * 500 'Failed to create PayPal order'.
 *
 * The one list of the currencies PayPal supports, from PayPal's REST API
 * reference (Currency codes, developer.paypal.com/api/rest/reference/
 * currency-codes). Nothing asks PayPal at runtime. A code that is not here is
 * never offered: the gateway lists leave PayPal out
 * (PaymentsService.getAvailableGateways) and every PayPal order and capture
 * for it is refused 400 PAYPAL_CURRENCY_UNSUPPORTED before PayPal is called
 * (createPaypalOrder, capturePaypalOrder, createStorePayment); a storefront
 * PayPal checkout of such an order is refused before the order is written
 * (StoreOrderService.createOrder, review SEC-W10PPC-1), and the storefront
 * checkout drops PayPal when the gateway list leaves it out
 * (checkout-flow.tsx, review PPC-REV-02). The web
 * payment settings keep a copy (PAYPAL_CURRENCIES in payments-tab.tsx) to say
 * why PayPal is missing for the business currency; paypal-currency.spec.ts
 * fails if the two differ.
 *
 * Some codes PayPal lists are for in-country PayPal accounts only (BRL, CNY,
 * MYR) and some take no decimals (HUF, JPY, TWD); PayPal itself refuses an
 * order it cannot take for those, so the checkout still fails closed there.
 * RUB is left out (PayPal suspended its service in Russia in 2022).
 */
export const PAYPAL_SUPPORTED_CURRENCIES: readonly string[] = Object.freeze([
  'AUD',
  'BRL',
  'CAD',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'HKD',
  'HUF',
  'ILS',
  'JPY',
  'MYR',
  'MXN',
  'TWD',
  'NZD',
  'NOK',
  'PHP',
  'PLN',
  'GBP',
  'SGD',
  'SEK',
  'CHF',
  'THB',
  'USD',
]);

/** D-106: the code of the refusal of a PayPal order or capture in a currency PayPal does not support. */
export const PAYPAL_CURRENCY_UNSUPPORTED = 'PAYPAL_CURRENCY_UNSUPPORTED';

function normalized(currency: string | null | undefined): string {
  return typeof currency === 'string' ? currency.trim().toUpperCase() : '';
}

/** D-106: whether PayPal takes an amount in this currency (compared trimmed and upper-cased, as normalizeCurrency does). */
export function paypalTakesCurrency(currency: string | null | undefined): boolean {
  const code = normalized(currency);
  return code !== '' && PAYPAL_SUPPORTED_CURRENCIES.includes(code);
}

/** D-106: the body of the 400 refusing a PayPal order or capture for a payable in `currency`. Names no payable id. */
export function paypalCurrencyRefusal(
  currency: string | null | undefined,
  payable: 'invoice' | 'order',
): { code: string; message: string } {
  const code = normalized(currency) || 'no currency';
  return {
    code: PAYPAL_CURRENCY_UNSUPPORTED,
    message: `PayPal does not support ${code}: this ${payable} cannot be paid with PayPal. Choose another payment method.`,
  };
}
