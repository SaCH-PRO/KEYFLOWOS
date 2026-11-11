/**
 * W10-PAYPAL-CURRENCY (owner ruling D-106; closes PC-08b of
 * test/payments-provider-callbacks.integration.test.ts): PayPal is not offered
 * for an invoice, pay link or storefront order in a currency PayPal does not
 * support. The codes PayPal supports are one named constant
 * (PAYPAL_SUPPORTED_CURRENCIES, paypal-currency.ts), taken from PayPal's
 * documentation; nothing asks PayPal at runtime.
 *
 *   PPC-01  the Caribbean currencies the ruling names (TTD, JMD, BBD, GYD,
 *           XCD) are not PayPal currencies, nor is a missing, blank or unknown
 *           code
 *   PPC-02  documented codes are, compared trimmed and case-insensitively
 *   PPC-03  the constant holds unique three-letter upper-case codes and cannot
 *           be changed at runtime
 *   PPC-04  the refusal carries the code PAYPAL_CURRENCY_UNSUPPORTED and names
 *           the currency and the payable kind, nothing else
 *   PPC-05  the web payment settings' copy of the list (PAYPAL_CURRENCIES in
 *           payments-tab.tsx, which says why PayPal is missing for the business
 *           currency) is the same list
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import {
  PAYPAL_CURRENCY_UNSUPPORTED,
  PAYPAL_SUPPORTED_CURRENCIES,
  paypalCurrencyRefusal,
  paypalTakesCurrency,
} from './paypal-currency';

const REPO = join(__dirname, '..', '..', '..', '..', '..');
const SETTINGS_TAB = join(REPO, 'apps', 'web', 'src', 'app', 'app', 'settings', 'business', 'payments-tab.tsx');

describe('W10-PAYPAL-CURRENCY: the currencies PayPal supports (D-106)', () => {
  it('PPC-01 (W10-PAYPAL-CURRENCY, D-106): TTD, JMD, BBD, GYD and XCD are not PayPal currencies, nor is a missing, blank or unknown code', () => {
    for (const code of ['TTD', 'JMD', 'BBD', 'GYD', 'XCD', 'ttd', ' xcd ']) {
      expect(paypalTakesCurrency(code), code).toBe(false);
    }
    for (const code of [null, undefined, '', '   ', 'XXX', 'US', 'USDD']) {
      expect(paypalTakesCurrency(code as string | null | undefined), String(code)).toBe(false);
    }
  });

  it("PPC-02 (W10-PAYPAL-CURRENCY, D-106): PayPal's documented codes are PayPal currencies, compared trimmed and case-insensitively", () => {
    for (const code of ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'usd', ' eur ']) {
      expect(paypalTakesCurrency(code), code).toBe(true);
    }
  });

  it('PPC-03 (W10-PAYPAL-CURRENCY, D-106): the constant is unique three-letter upper-case codes, frozen, and holds none of the ruling\'s Caribbean currencies', () => {
    expect(PAYPAL_SUPPORTED_CURRENCIES.length).toBeGreaterThan(10);
    for (const code of PAYPAL_SUPPORTED_CURRENCIES) expect(code).toMatch(/^[A-Z]{3}$/);
    expect(new Set(PAYPAL_SUPPORTED_CURRENCIES).size).toBe(PAYPAL_SUPPORTED_CURRENCIES.length);
    expect(Object.isFrozen(PAYPAL_SUPPORTED_CURRENCIES)).toBe(true);
    for (const code of ['TTD', 'JMD', 'BBD', 'GYD', 'XCD']) expect(PAYPAL_SUPPORTED_CURRENCIES).not.toContain(code);
  });

  it('PPC-04 (W10-PAYPAL-CURRENCY, D-106): the refusal carries PAYPAL_CURRENCY_UNSUPPORTED and names the currency and the payable kind', () => {
    expect(PAYPAL_CURRENCY_UNSUPPORTED).toBe('PAYPAL_CURRENCY_UNSUPPORTED');
    expect(paypalCurrencyRefusal(' ttd ', 'invoice')).toEqual({
      code: PAYPAL_CURRENCY_UNSUPPORTED,
      message: 'PayPal does not support TTD: this invoice cannot be paid with PayPal. Choose another payment method.',
    });
    expect(paypalCurrencyRefusal('JMD', 'order')).toEqual({
      code: PAYPAL_CURRENCY_UNSUPPORTED,
      message: 'PayPal does not support JMD: this order cannot be paid with PayPal. Choose another payment method.',
    });
    expect(paypalCurrencyRefusal(null, 'order').message).toBe(
      'PayPal does not support no currency: this order cannot be paid with PayPal. Choose another payment method.',
    );
  });

  it("PPC-05 (W10-PAYPAL-CURRENCY, D-106): the web payment settings' PAYPAL_CURRENCIES is the same list as the server's constant", () => {
    const text = readFileSync(SETTINGS_TAB, 'utf8');
    const match = text.match(/const PAYPAL_CURRENCIES[^=]*=\s*\[([^\]]*)\]/);
    expect(match, 'payments-tab.tsx declares PAYPAL_CURRENCIES').not.toBeNull();
    const webList = Array.from(match![1].matchAll(/"([A-Z]{3})"/g), (m) => m[1]);
    expect(webList).toEqual([...PAYPAL_SUPPORTED_CURRENCIES]);
  });
});
