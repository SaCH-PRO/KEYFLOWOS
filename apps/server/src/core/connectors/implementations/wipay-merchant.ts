/**
 * The WiPay merchant a business's checkouts pay into: the API key that
 * verifies its callbacks and the account number its checkouts name.
 *
 * Trial-N repair round 2 (recheck G6RC-1, G6RC-7): the two come from ONE
 * source, never mixed. A business with any WiPay setting of its own
 * (metaData.wipayApiKey or metaData.wipayAccountNumber) uses its own pair
 * only; the platform's pair (WIPAY_API_KEY, WIPAY_ACCOUNT_NUMBER) serves only a
 * business with neither. Mixed, a business with its own key and no account
 * was given a live checkout into the platform's account whose callback (keyed
 * with the platform's key) its own key refused: the payer was charged and
 * nothing was recorded. A business with its own account and only the
 * platform's key had the mirror defect (review V05-SEC-3, NEW-1).
 *
 * A side that is missing is null: the checkout is refused and WiPay is not
 * offered unless both are set (PaymentsService.wipayCheckoutTarget,
 * getAvailableGateways), the callback is verified with apiKey alone (null
 * refuses it), and the connector reports 'connected' on the same rule as the
 * gateway list (WiPayConnector.healthCheck).
 */
export interface WipayMerchant {
  apiKey: string | null;
  accountNumber: string | null;
}

function configured(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function resolveWipayMerchant(metaData: unknown): WipayMerchant {
  const meta = (metaData && typeof metaData === 'object' ? metaData : {}) as Record<string, unknown>;
  const ownKey = configured(meta.wipayApiKey);
  const ownAccount = configured(meta.wipayAccountNumber);
  if (ownKey || ownAccount) return { apiKey: ownKey, accountNumber: ownAccount };
  return { apiKey: configured(process.env.WIPAY_API_KEY), accountNumber: configured(process.env.WIPAY_ACCOUNT_NUMBER) };
}

/** D-69: the one currency a WiPay checkout is made in, until WiPay's currency parameter is verified from its docs. */
export const WIPAY_CURRENCY = 'TTD';

/**
 * D-69: whether WiPay takes an amount in this currency (compared trimmed and
 * upper-cased, as normalizeCurrency does). The gateway lists, both checkouts
 * (PaymentsService) and the storefront order door (StoreOrderService.
 * createOrder, before the order is written) read this one rule.
 */
export function wipayTakesCurrency(currency: string | null | undefined): boolean {
  return typeof currency === 'string' && currency.trim().toUpperCase() === WIPAY_CURRENCY;
}

/** Whether a WiPay checkout can start and its callback be verified: both sides of one merchant are set. */
export function wipayMerchantComplete(merchant: WipayMerchant): merchant is { apiKey: string; accountNumber: string } {
  return merchant.apiKey !== null && merchant.accountNumber !== null;
}
