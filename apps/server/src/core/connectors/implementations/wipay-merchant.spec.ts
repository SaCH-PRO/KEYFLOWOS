/**
 * W10-WIPAY-KEY review SEC-W10WK-1 / SEC-W10WK-2 (owner ruling D-105): the
 * one rule every WiPay reader takes its merchant from. WiPay's documented
 * public sandbox key ('123') is no key, in the business's metaData and in the
 * platform's WIPAY_API_KEY alike, and the platform key is read only to
 * recognise a payment a checkout made into the platform's account before
 * D-105 (it settles nothing). The behaviour on the real routes is pinned in
 * test/payments-provider-callbacks.integration.test.ts (PC-11, PC-21).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  WIPAY_PUBLIC_SANDBOX_KEY,
  isWipayPublicSandboxKey,
  platformWipayKeyForTransition,
  resolveWipayMerchant,
  wipayMerchantComplete,
} from './wipay-merchant';

const PREVIOUS = process.env.WIPAY_API_KEY;

afterEach(() => {
  if (PREVIOUS === undefined) delete process.env.WIPAY_API_KEY;
  else process.env.WIPAY_API_KEY = PREVIOUS;
});

describe('W10-WIPAY-KEY review SEC-W10WK-1 (D-105): resolveWipayMerchant', () => {
  it("SEC-W10WK-1: WiPay's public sandbox key, saved as a string, a padded string or a number, is no key, so the merchant is incomplete", () => {
    expect(WIPAY_PUBLIC_SANDBOX_KEY).toBe('123');
    for (const wipayApiKey of ['123', ' 123 ', 123]) {
      const merchant = resolveWipayMerchant({ wipayApiKey, wipayAccountNumber: 'acct-fake' });
      expect(merchant, String(wipayApiKey)).toEqual({ apiKey: null, accountNumber: 'acct-fake' });
      expect(wipayMerchantComplete(merchant), String(wipayApiKey)).toBe(false);
    }
    expect(isWipayPublicSandboxKey(' 123')).toBe(true);
    expect(isWipayPublicSandboxKey('1234')).toBe(false);
  });

  it("SEC-W10WK-1 control: a business's own key and account are its merchant; nothing configured is no merchant, whatever the platform's key", () => {
    process.env.WIPAY_API_KEY = 'platform-key-fake';
    expect(resolveWipayMerchant({ wipayApiKey: 'own-key-fake', wipayAccountNumber: 'acct-fake' })).toEqual({ apiKey: 'own-key-fake', accountNumber: 'acct-fake' });
    expect(resolveWipayMerchant({})).toEqual({ apiKey: null, accountNumber: null });
    expect(resolveWipayMerchant(null)).toEqual({ apiKey: null, accountNumber: null });
  });
});

describe('W10-WIPAY-KEY review SEC-W10WK-2 (D-105 deploy transition): platformWipayKeyForTransition', () => {
  it('SEC-W10WK-2: the platform key when WIPAY_API_KEY is set; null when it is unset, blank or the public sandbox key', () => {
    process.env.WIPAY_API_KEY = 'platform-key-fake';
    expect(platformWipayKeyForTransition()).toBe('platform-key-fake');
    for (const value of [undefined, '', '   ', '123', ' 123 ']) {
      if (value === undefined) delete process.env.WIPAY_API_KEY;
      else process.env.WIPAY_API_KEY = value;
      expect(platformWipayKeyForTransition(), JSON.stringify(value)).toBeNull();
    }
  });
});
