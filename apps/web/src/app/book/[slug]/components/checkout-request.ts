import { apiPost } from "@/lib/api";
import type { StoreOrderResponse } from "./types";

/**
 * G6PUB-R3-STORE-ORDER-DOORS (recheck G6PUB-RC2-4, V1-33): one retry key per
 * storefront checkout.
 *
 * POST /site/storefront/public/:slug/checkout answers a retried checkout that
 * carries the first call's key with the order (and payment session) that call
 * created, so a second press of Place Order after an error, or a dropped
 * connection, writes no second UNPAID order and counts no promo twice. The key
 * travels in the body (`idempotencyKey`): the API is cross-origin and its CORS
 * preflight allows no Idempotency-Key header (server app-bootstrap.ts
 * allowedHeaders), which would fail the request before it was sent.
 */

/** The checkout fields the server reads (site.controller.ts publicCheckout), without the key. */
export type StorefrontCheckoutPayload = {
  items: { productId: string; quantity: number }[];
  customer: { name: string; email?: string; phone?: string };
  promoCode?: string;
  shipping?: { zoneId?: string; address?: unknown };
  paymentMethod: string;
  returnUrl?: string;
};

function mintKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return `sfc_${c.randomUUID()}`;
  if (c && typeof c.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return `sfc_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  return `sfc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/** JSON with sorted object keys, so the same checkout always reads the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export interface CheckoutKeyring {
  /** The key of this checkout: the same one while the checkout (cart, customer, method, ...) is the same, a new one otherwise. */
  keyFor(payload: StorefrontCheckoutPayload): string;
  /** The checkout finished (the order was placed): its key is never handed to the next checkout. */
  reset(): void;
}

export function createCheckoutKeyring(): CheckoutKeyring {
  let current: { key: string; fingerprint: string } | null = null;
  return {
    keyFor(payload) {
      const fingerprint = canonical(payload);
      if (!current || current.fingerprint !== fingerprint) current = { key: mintKey(), fingerprint };
      return current.key;
    },
    reset() {
      current = null;
    },
  };
}

/** The storefront checkout request, with its retry key in the body (none when `idempotencyKey` is null). */
export async function postStorefrontCheckout(
  slug: string,
  payload: StorefrontCheckoutPayload,
  idempotencyKey: string | null,
): Promise<StoreOrderResponse | null> {
  const { data, error } = await apiPost<StoreOrderResponse>({
    path: `/site/storefront/public/${encodeURIComponent(slug)}/checkout`,
    body: idempotencyKey ? { ...payload, idempotencyKey } : payload,
  });
  if (error) throw new Error(error);
  return data ?? null;
}
