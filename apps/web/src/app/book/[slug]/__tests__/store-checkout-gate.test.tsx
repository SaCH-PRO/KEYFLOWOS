/**
 * WEDGE-HIDE-STORE part 2 (P225, D-263; owner question 72 open): on /book/<slug> the store checkout is offered only
 * when GET /site/storefront/public/<slug> answers `storeCheckout: true` (server row P233).
 *
 * WHY this test exists: D-263 does not offer the store checkout to a new business at launch; a business already
 * selling keeps it. The answer is the server's. Anything but `true` (a missing field, false, a failed read) means
 * not offered. WHS2-10 pins the consequence on purpose: against a server WITHOUT the field every business reads
 * "not offered", so this web half may only ship with or after P233.
 *
 * Whether a product is LISTED is not decided here (owner question 72): these tests pin only that it cannot be put
 * in the cart, that a restored cart loses its product lines, and that no store order is submitted. Bookings are
 * untouched: a service keeps its Add button and its cart line.
 *
 * Mounted on the real page; only lib/api's apiGet/apiPost (the HTTP edge) and the router are stubbed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet, apiPost: api.apiPost };
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: SLUG }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => `/book/${SLUG}`,
}));

import PublicBookingPage from "../page";

const SLUG = "whs2-shop";
const BUSINESS = { id: "biz_whs2_1", name: "WHS2 Studio", slug: SLUG, currency: "TTD", timezone: "America/Port_of_Spain", storeEnabled: true };
const PRODUCT = {
  id: "prod_whs2_pepper", name: "Pepper sauce", description: null, price: 35, currency: "TTD", category: "PRODUCT", imageUrl: null,
  isActive: true, availableQuantity: null, stockStatus: "untracked", purchasable: true,
};
const SERVICE = { id: "svc_whs2_cut", name: "Haircut", description: null, duration: 30, price: 120 };
const PRODUCT_LINE = { id: PRODUCT.id, name: PRODUCT.name, description: null, price: 35, currency: "TTD", duration: null, imageUrl: null, itemType: "product", requiresBooking: false, quantity: 2 };
const SERVICE_LINE = { id: SERVICE.id, name: SERVICE.name, description: null, price: 120, currency: "TTD", duration: 30, imageUrl: null, itemType: "service", requiresBooking: true, sourceServiceId: SERVICE.id, quantity: 1 };
const CART_KEY = `kf_cart_${SLUG}`;
const ORDER_PAYLOAD = { items: [{ productId: PRODUCT.id, quantity: 1 }], customer: { name: "Ana Ali", email: "ana@whs2.test" }, paymentMethod: "WIPAY" };

/** What GET /site/storefront/public/<slug> answers in a test: an object, or "fails" for a failed read. */
let storefront: Record<string, unknown> | "fails" = { storefront: {} };
let services: unknown[] = [];
let products: unknown[] = [];

const ADD = /^(add|pre-order|add to cart)$/i;
const storedCart = (): Array<{ id: string }> => JSON.parse(window.localStorage.getItem(CART_KEY) ?? "[]");
const checkoutPosts = () => api.apiPost.mock.calls.filter(([arg]) => String((arg as { path?: string })?.path ?? "").endsWith("/checkout"));

beforeAll(() => {
  class NoopObserver {
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() { return []; }
  }
  vi.stubGlobal("IntersectionObserver", NoopObserver);
});

beforeEach(() => {
  window.localStorage.clear();
  storefront = { storefront: {} };
  services = [];
  products = [];
  api.apiPost.mockReset();
  api.apiPost.mockImplementation(async () => ({ data: null, error: null }));
  api.apiGet.mockReset();
  api.apiGet.mockImplementation(async (path: string) => {
    if (path === `/identity/businesses/slug/${SLUG}`) return { data: BUSINESS, error: null };
    if (path === `/site/storefront/public/${SLUG}`) return storefront === "fails" ? { data: null, error: "Request failed" } : { data: storefront, error: null };
    if (path.startsWith("/site/storefront/public/order/")) return { data: { paymentStatus: "FAILED", status: "PENDING" }, error: null };
    if (path === `/bookings/public/businesses/${BUSINESS.id}/services`) return { data: services, error: null };
    if (path === `/bookings/public/businesses/${BUSINESS.id}/staff`) return { data: [], error: null };
    if (path === `/commerce/public/businesses/${BUSINESS.id}/products`) return { data: products, error: null };
    return { data: null, error: null };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOT_OFFERED: Array<[string, Record<string, unknown> | "fails"]> = [
  ["the field is missing (a server without P233)", { storefront: {} }],
  ["storeCheckout is false", { storefront: {}, storeCheckout: false }],
  ["storeCheckout is a truthy non-boolean", { storefront: {}, storeCheckout: "true" }],
  ["the storefront read failed", "fails"],
];

describe("WEDGE-HIDE-STORE part 2: /book/<slug> offers the store checkout only on storeCheckout: true", () => {
  it("WHS2-03 storeCheckout true: a product can be added to the cart", async () => {
    storefront = { storefront: {}, storeCheckout: true };
    products = [PRODUCT];
    render(<PublicBookingPage />);
    await screen.findAllByText(PRODUCT.name, { exact: true });
    fireEvent.click(screen.getAllByRole("button", { name: ADD })[0]);
    await waitFor(() => expect(storedCart().map((c) => c.id)).toEqual([PRODUCT.id]));
  });

  for (const [label, answer] of NOT_OFFERED) {
    it(`WHS2-04 not offered when ${label}: no product can be added to the cart`, async () => {
      storefront = answer;
      products = [PRODUCT];
      services = [SERVICE];
      render(<PublicBookingPage />);
      await screen.findAllByText(SERVICE.name, { exact: true });
      // The only Add buttons left are the service's: pressing every one puts no product in the cart.
      for (const button of screen.queryAllByRole("button", { name: ADD })) fireEvent.click(button);
      await waitFor(() => expect(storedCart().map((c) => c.id)).toEqual([SERVICE.id]));
      expect(screen.queryAllByRole("button", { name: /sold out/i })).toHaveLength(0);
    });

    it(`WHS2-05 not offered when ${label}: a restored cart loses its product lines and keeps its service lines`, async () => {
      storefront = answer;
      products = [PRODUCT];
      services = [SERVICE];
      window.localStorage.setItem(CART_KEY, JSON.stringify([PRODUCT_LINE, SERVICE_LINE]));
      render(<PublicBookingPage />);
      await screen.findAllByText(SERVICE.name, { exact: true });
      await waitFor(() => expect(storedCart().map((c) => c.id)).toEqual([SERVICE.id]));
      expect(await screen.findByRole("button", { name: "Open cart with 1 items" })).toBeTruthy();
    });

    it(`WHS2-06 not offered when ${label}: a kept failed order cannot be submitted again`, async () => {
      storefront = answer;
      window.localStorage.setItem(`kf_pending_checkout_${SLUG}`, JSON.stringify({
        orderId: "ord_whs2_1", orderNumber: "ORD-1001", customerEmail: "ana@whs2.test", items: [PRODUCT_LINE], orderTotal: 70,
        paymentMethod: "wipay", orderPayload: ORDER_PAYLOAD,
      }));
      render(<PublicBookingPage />);
      fireEvent.click(await screen.findByRole("button", { name: /retry payment|try again/i }));
      await new Promise((r) => setTimeout(r, 50));
      expect(checkoutPosts()).toHaveLength(0);
    });
  }

  it("WHS2-07 storeCheckout true: a restored cart keeps its product and service lines", async () => {
    storefront = { storefront: {}, storeCheckout: true };
    products = [PRODUCT];
    services = [SERVICE];
    window.localStorage.setItem(CART_KEY, JSON.stringify([PRODUCT_LINE, SERVICE_LINE]));
    render(<PublicBookingPage />);
    await screen.findAllByText(SERVICE.name, { exact: true });
    expect(await screen.findByRole("button", { name: "Open cart with 3 items" })).toBeTruthy();
    expect(storedCart().map((c) => c.id)).toEqual([PRODUCT.id, SERVICE.id]);
  });

  it("WHS2-08 storeCheckout true: a kept failed order is submitted again on Retry", async () => {
    storefront = { storefront: {}, storeCheckout: true };
    window.localStorage.setItem(`kf_pending_checkout_${SLUG}`, JSON.stringify({
      orderId: "ord_whs2_1", orderNumber: "ORD-1001", customerEmail: "ana@whs2.test", items: [PRODUCT_LINE], orderTotal: 70,
      paymentMethod: "wipay", orderPayload: ORDER_PAYLOAD,
    }));
    render(<PublicBookingPage />);
    fireEvent.click(await screen.findByRole("button", { name: /retry payment|try again/i }));
    await waitFor(() => expect(checkoutPosts()).toHaveLength(1));
  });

  it("WHS2-09 while the answer is not yet known, the cart shows no product line and the stored cart is not rewritten", async () => {
    let release: (v: unknown) => void = () => {};
    const held = new Promise((r) => { release = r; });
    api.apiGet.mockImplementation(async (path: string) => {
      if (path === `/identity/businesses/slug/${SLUG}`) return { data: BUSINESS, error: null };
      if (path === `/site/storefront/public/${SLUG}`) { await held; return { data: { storefront: {}, storeCheckout: true }, error: null }; }
      if (path.endsWith("/services")) return { data: [SERVICE], error: null };
      if (path.endsWith("/products")) return { data: [PRODUCT], error: null };
      return { data: [], error: null };
    });
    window.localStorage.setItem(CART_KEY, JSON.stringify([PRODUCT_LINE, SERVICE_LINE]));
    try {
      render(<PublicBookingPage />);
      await new Promise((r) => setTimeout(r, 50));
      // A business that sells must not lose a customer's cart because the answer is late.
      expect(storedCart().map((c) => c.id)).toEqual([PRODUCT.id, SERVICE.id]);
      expect(screen.queryByRole("button", { name: "Open cart with 3 items" })).toBeNull();
    } finally {
      release(null);
    }
    expect(await screen.findByRole("button", { name: "Open cart with 3 items" })).toBeTruthy();
  });

  it("WHS2-10 DEPENDENCY PIN: against a server without the field (before P233) a selling business's store checkout is off", async () => {
    // This is the fail-closed cost, stated on purpose: this web half must ship with or after server row P233.
    storefront = { storefront: {}, completedOrdersCount: 12 };
    products = [PRODUCT];
    window.localStorage.setItem(CART_KEY, JSON.stringify([PRODUCT_LINE]));
    render(<PublicBookingPage />);
    await waitFor(() => expect(storedCart()).toEqual([]));
    expect(screen.queryAllByRole("button", { name: ADD })).toHaveLength(0);
  });
});
