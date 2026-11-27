/**
 * WEDGE-HIDE-STORE part 2 (P225, D-263; owner question 72 open): /book/<slug>/product/<id> offers Add to Cart only
 * when GET /site/storefront/public/<slug> answers `storeCheckout: true` (server row P233). Whether the product is
 * shown at all is question 72's, not pinned here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet };
});
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: SLUG, productId: PRODUCT.id }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => `/book/${SLUG}/product/${PRODUCT.id}`,
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("@/lib/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/client")>()), trackStoreEvent: vi.fn() }));

import ProductDetailPage from "../page";

const SLUG = "whs2-shop";
const BUSINESS = { id: "biz_whs2_1", name: "WHS2 Studio", slug: SLUG, currency: "TTD", storeEnabled: true };
const PRODUCT = {
  id: "prod_whs2_pepper", name: "Pepper sauce", description: null, price: 35, currency: "TTD", category: "PRODUCT", imageUrl: null,
  isActive: true, availableQuantity: null, stockStatus: "untracked", purchasable: true,
};
const PRODUCT_LINE = { id: PRODUCT.id, name: PRODUCT.name, description: null, price: 35, currency: "TTD", duration: null, imageUrl: null, itemType: "product", requiresBooking: false, quantity: 2 };
const CART_KEY = `kf_cart_${SLUG}`;
const ADD = /^(add to cart|pre-order)/i;
let storefront: Record<string, unknown> | null = {};
const storedCart = (): Array<{ id: string }> => JSON.parse(window.localStorage.getItem(CART_KEY) ?? "[]");

beforeEach(() => {
  window.localStorage.clear();
  api.apiGet.mockReset();
  api.apiGet.mockImplementation(async (path: string) => {
    if (path === `/identity/businesses/slug/${SLUG}`) return { data: BUSINESS, error: null };
    if (path === `/site/storefront/public/${SLUG}`) return storefront ? { data: storefront, error: null } : { data: null, error: "Request failed" };
    if (path.endsWith("/services")) return { data: [], error: null };
    if (path.endsWith("/products")) return { data: [PRODUCT], error: null };
    return { data: null, error: null };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WEDGE-HIDE-STORE part 2: /book/<slug>/product/<id>", () => {
  it("WHS2-13 storeCheckout true: Add to Cart puts the product in the cart", async () => {
    storefront = { storefront: {}, storeCheckout: true };
    render(<ProductDetailPage />);
    const buttons = await screen.findAllByRole("button", { name: ADD });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(storedCart().map((c) => c.id)).toEqual([PRODUCT.id]));
  });

  for (const [label, answer] of [
    ["the field is missing (a server without P233)", { storefront: {} }],
    ["storeCheckout is false", { storefront: {}, storeCheckout: false }],
    ["the storefront read failed", null],
  ] as Array<[string, Record<string, unknown> | null]>) {
    it(`WHS2-14 not offered when ${label}: no Add to Cart, and a restored product line is dropped`, async () => {
      storefront = answer;
      window.localStorage.setItem(CART_KEY, JSON.stringify([PRODUCT_LINE]));
      render(<ProductDetailPage />);
      await screen.findAllByText(PRODUCT.name);
      await waitFor(() => expect(storedCart()).toEqual([]));
      expect(screen.queryAllByRole("button", { name: ADD })).toHaveLength(0);
      expect(screen.queryAllByRole("button", { name: /in cart|sold out/i })).toHaveLength(0);
    });
  }
});
