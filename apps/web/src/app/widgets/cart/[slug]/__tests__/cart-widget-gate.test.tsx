/**
 * WEDGE-HIDE-STORE part 2 (P225, D-263): /widgets/cart/<slug> sells only when GET /site/storefront/public/<slug>
 * answers `storeCheckout: true` (server row P233). Anything else: the widget says it is not available, lists no
 * product and submits no order.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
const nav = vi.hoisted(() => ({ query: "" }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet, apiPost: api.apiPost };
});
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "whs2-shop" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.query),
}));

import CartWidgetPage from "../page";

const PRODUCT = { id: "prod_whs2_pepper", name: "Pepper sauce", price: 35 };
let answer: { data: unknown; error: string | null } = { data: null, error: null };

beforeEach(() => {
  nav.query = "";
  api.apiPost.mockReset();
  api.apiPost.mockImplementation(async () => ({ data: null, error: "not stubbed" }));
  api.apiGet.mockReset();
  api.apiGet.mockImplementation(async () => answer);
});
afterEach(() => cleanup());

describe("WEDGE-HIDE-STORE part 2: /widgets/cart/<slug>", () => {
  it("WHS2-11 storeCheckout true: the widget lists the products with Add", async () => {
    answer = { data: { products: [PRODUCT], storeCheckout: true }, error: null };
    render(<CartWidgetPage />);
    expect(await screen.findByText(PRODUCT.name)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("button", { name: "Checkout" })).toBeTruthy();
  });

  for (const [label, data] of [
    ["the field is missing (a server without P233)", { products: [PRODUCT] }],
    ["storeCheckout is false", { products: [PRODUCT], storeCheckout: false }],
  ] as Array<[string, unknown]>) {
    it(`WHS2-12 not offered when ${label}: not available, no Order Now heading, no product, no Add, no order`, async () => {
      nav.query = `productId=${PRODUCT.id}`;
      answer = { data, error: null };
      render(<CartWidgetPage />);
      expect(await screen.findByText("Online orders are not available from this business.")).toBeTruthy();
      expect(screen.queryByRole("heading", { name: /order now|checkout/i })).toBeNull();
      expect(screen.queryByText(PRODUCT.name)).toBeNull();
      expect(screen.queryByRole("button", { name: /^(add|checkout|try again)$/i })).toBeNull();
      expect(screen.queryByText(/^Cart \(/)).toBeNull();
      expect(api.apiPost).not.toHaveBeenCalled();
    });
  }

  for (const [label, fail] of [
    ["the read answers an error", () => api.apiGet.mockImplementationOnce(async () => ({ data: null, error: "Request failed" }))],
    ["the read rejects", () => api.apiGet.mockImplementationOnce(async () => { throw new Error("network down"); })],
  ] as Array<[string, () => void]>) {
    it(`WHS2-24 when ${label}: 'Unable to load', not 'not available'; Try again reads again and the widget sells`, async () => {
      nav.query = `productId=${PRODUCT.id}`;
      answer = { data: { products: [PRODUCT], storeCheckout: true }, error: null };
      fail();
      render(<CartWidgetPage />);
      expect(await screen.findByText(/unable to load/i)).toBeTruthy();
      expect(screen.queryByText("Online orders are not available from this business.")).toBeNull();
      expect(screen.queryByText(PRODUCT.name)).toBeNull();
      expect(screen.queryByText(/^Cart \(/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByText(PRODUCT.name)).toBeTruthy();
      expect(api.apiGet).toHaveBeenCalledTimes(2);
    });
  }
});
