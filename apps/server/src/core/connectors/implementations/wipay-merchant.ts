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
 * W10-WIPAY-KEY (owner ruling D-105; SEC-V33-2, PC-11b): WiPay is offered
 * only to a business that has connected its own WiPay key, and tenants no
 * longer share the platform's WiPay account. The merchant is the business's
 * own pair, always: the platform's pair (WIPAY_API_KEY, WIPAY_ACCOUNT_NUMBER)
 * serves no tenant, so a business with no WiPay setting of its own resolves to
 * no merchant. It used to check out into the platform's account, and the
 * platform key then verified a success for any such business's payable of the
 * same total; WiPay's proof names no order_id, so the payable the money was
 * booked against was the caller's choice. With one key per business, the key
 * that proves a success names the business whose payable it may settle.
 *
 * A side that is missing is null: the checkout is refused and WiPay is not
 * offered unless both are set (PaymentsService.wipayCheckoutTarget,
 * getAvailableGateways, StoreOrderService.createOrder), the callback is
 * verified with apiKey alone (null refuses it), and the connector reports
 * 'connected' on the same rule as the gateway list (WiPayConnector.healthCheck).
 */
export interface WipayMerchant {
  apiKey: string | null;
  accountNumber: string | null;
}

/**
 * D-105: the error code of a WiPay checkout refused because the business has
 * no WiPay key of its own (400, before anything is written or WiPay called).
 */
export const WIPAY_KEY_REQUIRED = 'WIPAY_KEY_REQUIRED';

/**
 * W10-WIPAY-KEY review SEC-W10WK-1 (D-105): WiPay's documented public sandbox
 * API key. Anyone computes WiPay's response proof md5(transaction_id + total +
 * '123'), so a merchant keyed with it is keyed with no secret. Since D-105 a
 * business's own key is the only thing that verifies its WiPay successes, and
 * a business that saved this key (the payment-secret write stores any
 * non-blank string) was offered WiPay and had its invoices and storefront
 * orders settled by anyone who sent that proof. It is never a key: wherever it
 * is stored (the business's metaData, or the platform's WIPAY_API_KEY) it reads
 * as not configured, so WiPay is not offered, every checkout is refused
 * WIPAY_KEY_REQUIRED, no callback verifies with it and the connector is not
 * connected.
 */
export const WIPAY_PUBLIC_SANDBOX_KEY = '123';

/** SEC-W10WK-1: whether a configured key is WiPay's public sandbox key (compared trimmed). */
export function isWipayPublicSandboxKey(value: string): boolean {
  return value.trim() === WIPAY_PUBLIC_SANDBOX_KEY;
}

function configured(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** SEC-W10WK-1: a WiPay API key as configured, or null when it is unset, blank or the public sandbox key. */
function configuredKey(value: unknown): string | null {
  const key = configured(value);
  return key !== null && isWipayPublicSandboxKey(key) ? null : key;
}

export function resolveWipayMerchant(metaData: unknown): WipayMerchant {
  const meta = (metaData && typeof metaData === 'object' ? metaData : {}) as Record<string, unknown>;
  // D-105: the business's own pair only; no fallback to the platform's WIPAY_API_KEY / WIPAY_ACCOUNT_NUMBER.
  // Review SEC-W10WK-1: WiPay's public sandbox key is no key (configuredKey).
  return { apiKey: configuredKey(meta.wipayApiKey), accountNumber: configured(meta.wipayAccountNumber) };
}

/**
 * W10-WIPAY-KEY review SEC-W10WK-2 / WK-CR-1 (the D-105 deploy transition):
 * the platform's WiPay key (WIPAY_API_KEY), read ONLY to recognise a success
 * that a checkout started before D-105 paid into the platform's WiPay account
 * (a business with no WiPay setting of its own checked out there until
 * D-105). It verifies and settles no payable: resolveWipayMerchant never
 * returns it, and PaymentsService.handleWipayCallback only keeps such a
 * success as a refused claim and tells the business (refuseWipayPlatformAccount).
 * Null when WIPAY_API_KEY is unset, blank or the public sandbox key.
 */
export function platformWipayKeyForTransition(): string | null {
  return configuredKey(process.env.WIPAY_API_KEY);
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
