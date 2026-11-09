/**
 * G6PUB-R3-STORE-ORDER-DOORS (recheck G6PUB-RC2-4, V1-33): the storefront
 * sends one retry key per checkout.
 *
 * The public checkout (POST /site/storefront/public/:slug/checkout) answers a
 * retried checkout with the order the first call created when the call carries
 * its retry key (V1-33). The storefront sent none, so every retry (a second
 * press of Place Order after an error, a dropped connection) wrote another
 * UNPAID order and counted the promo again. The key travels in the body
 * (`idempotencyKey`) and, since W3-CORS-IDEMPOTENCY-HEADER, in the
 * Idempotency-Key header too: the API's CORS preflight for the public
 * storefront routes allows that header from any origin (app-bootstrap.ts), and
 * the body field stays so a server without that change still dedupes.
 *
 *   CIK-01  one key per checkout: the same checkout asks again with the same
 *           key; a different checkout (cart, customer, method) gets a new one;
 *           a finished checkout (reset) never hands its key to the next one
 *   CIK-02  the checkout request carries the key in its body, beside the
 *           order fields, to the slug's checkout route
 *   CIK-03  a request with no key sends none (the server then creates, as
 *           before)
 *   CIK-04  W3-CORS-IDEMPOTENCY-HEADER: the Idempotency-Key header is sent
 *           with the same key as the body field
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const apiPost = vi.fn();
vi.mock("@/lib/api", () => ({
  apiPost: (...args: unknown[]) => apiPost(...args),
  apiGet: vi.fn(),
}));

import { createCheckoutKeyring, postStorefrontCheckout } from "../checkout-request";

const payload = (over: Record<string, unknown> = {}) => ({
  items: [{ productId: "prod_cik", quantity: 2 }],
  customer: { name: "Cee Ika", email: "cik@test.local" },
  paymentMethod: "WIPAY",
  returnUrl: "https://shop.test/book/cik",
  ...over,
});

beforeEach(() => {
  apiPost.mockReset();
  apiPost.mockResolvedValue({ data: { order: { id: "ord_cik" }, payment: null }, error: null });
});

describe("storefront checkout retry key (G6PUB-RC2-4)", () => {
  it("CIK-01: one key per checkout, reused for the same checkout, new for another, never after a reset", () => {
    const keyring = createCheckoutKeyring();
    const first = keyring.keyFor(payload());
    expect(first).toMatch(/\S{16,}/);
    expect(keyring.keyFor(payload()), "the same checkout, asked again").toBe(first);

    const otherCart = keyring.keyFor(payload({ items: [{ productId: "prod_cik", quantity: 3 }] }));
    expect(otherCart, "another cart is another checkout").not.toBe(first);
    expect(keyring.keyFor(payload({ paymentMethod: "CASH" })), "another method").not.toBe(otherCart);

    const current = keyring.keyFor(payload());
    keyring.reset();
    expect(keyring.keyFor(payload()), "a finished checkout's key is not reused").not.toBe(current);

    expect(createCheckoutKeyring().keyFor(payload()), "two keyrings never share a key").not.toBe(keyring.keyFor(payload()));
  });

  it("CIK-02: the checkout request carries the key in its body, to the slug's checkout route", async () => {
    const out = await postStorefrontCheckout("cik-store", payload(), "key_cik_02");

    expect(apiPost).toHaveBeenCalledTimes(1);
    const [{ path, body, init }] = apiPost.mock.calls[0] as [{ path: string; body: Record<string, unknown>; init?: RequestInit }];
    expect(path).toBe("/site/storefront/public/cik-store/checkout");
    expect(body).toEqual({ ...payload(), idempotencyKey: "key_cik_02" });
    // The header carries the same key (CIK-04, W3-CORS-IDEMPOTENCY-HEADER); it was refused here before.
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("key_cik_02");
    expect(out).toEqual({ order: { id: "ord_cik" }, payment: null });
  });

  it("CIK-03: no key sends none, and a refusal is thrown with the server's message", async () => {
    await postStorefrontCheckout("cik-store", payload(), null);
    const [{ body, init }] = apiPost.mock.calls[0] as [{ body: Record<string, unknown>; init?: RequestInit }];
    expect(body).not.toHaveProperty("idempotencyKey");
    expect(new Headers(init?.headers).has("Idempotency-Key"), "no key, no header").toBe(false);

    apiPost.mockResolvedValueOnce({ data: null, error: "WiPay is not configured for this business" });
    await expect(postStorefrontCheckout("cik-store", payload(), "key_cik_03")).rejects.toThrow(/WiPay is not configured/);
  });

  it("CIK-04: W3-CORS-IDEMPOTENCY-HEADER: the Idempotency-Key header is sent with the same key as the body field", async () => {
    const keyring = createCheckoutKeyring();
    const key = keyring.keyFor(payload());
    await postStorefrontCheckout("cik-store", payload(), key);
    // A retry of the same checkout sends the same key, in both places.
    await postStorefrontCheckout("cik-store", payload(), keyring.keyFor(payload()));

    expect(apiPost).toHaveBeenCalledTimes(2);
    for (const [{ path, body, init }] of apiPost.mock.calls as [{ path: string; body: Record<string, unknown>; init?: RequestInit }][]) {
      expect(path).toBe("/site/storefront/public/cik-store/checkout");
      // The body field stays, so a server without the header allowance still dedupes.
      expect(body.idempotencyKey).toBe(key);
      expect(new Headers(init?.headers).get("Idempotency-Key"), "the header carries the body's key").toBe(key);
    }
  });
});
