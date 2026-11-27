/**
 * WEDGE-HIDE-STORE part 2 (P225, D-263, D-304), repair round 2: the page's own addToCart guard.
 *
 * Every child that could put a product in the cart hides its button when the store checkout is not offered (pinned
 * in store-checkout-gate.test.tsx and components/__tests__/not-for-sale-buttons.test.tsx). The page does not trust
 * them: its addToCart refuses a product line itself. Here the catalog is replaced by a door that calls addToCart
 * with a product and with a service, whatever the answer, so only the page's guard stands between it and the cart.
 *
 *   WHS2-19  not offered: the product is refused (no cart line, no add_to_cart event), the service is taken
 *   WHS2-20  offered: both are taken
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(async () => ({ data: null, error: null })) }));
const door = vi.hoisted(() => ({
  PRODUCT: { id: "prod_whs2_door", name: "Door product", description: null, price: 35, currency: "TTD", duration: null, imageUrl: null, itemType: "product", requiresBooking: false, purchasable: true },
  SERVICE: { id: "svc_whs2_door", name: "Door service", description: null, price: 120, currency: "TTD", duration: 30, imageUrl: null, itemType: "service", requiresBooking: true, sourceServiceId: "svc_whs2_door" },
}));

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
const client = vi.hoisted(() => ({ trackStoreEvent: vi.fn() }));
vi.mock("@/lib/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/client")>()), trackStoreEvent: client.trackStoreEvent }));
vi.mock("../components/catalog-grid", () => ({
  CatalogGrid: ({ addToCart }: { addToCart: (item: Record<string, unknown>) => void }) => (
    <>
      <button type="button" onClick={() => addToCart(door.PRODUCT)}>Door: add the product</button>
      <button type="button" onClick={() => addToCart(door.SERVICE)}>Door: add the service</button>
    </>
  ),
}));

import PublicBookingPage from "../page";

const SLUG = "whs2-guard";
const BUSINESS = { id: "biz_whs2_g", name: "WHS2 Guard", slug: SLUG, currency: "TTD", timezone: "America/Port_of_Spain", storeEnabled: true };
let storefront: Record<string, unknown> = {};
const storedCart = (): Array<{ id: string }> => JSON.parse(window.localStorage.getItem(`kf_cart_${SLUG}`) ?? "[]");

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
  client.trackStoreEvent.mockClear();
  api.apiGet.mockReset();
  api.apiGet.mockImplementation(async (path: string) => {
    if (path === `/identity/businesses/slug/${SLUG}`) return { data: BUSINESS, error: null };
    if (path === `/site/storefront/public/${SLUG}`) return { data: storefront, error: null };
    if (path.endsWith("/services") || path.endsWith("/staff") || path.endsWith("/products")) return { data: [], error: null };
    return { data: null, error: null };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WEDGE-HIDE-STORE part 2: the page's addToCart refuses a product when the store checkout is not offered", () => {
  for (const [label, answer] of [
    ["the field is missing", { storefront: {} }],
    ["storeCheckout is false", { storefront: {}, storeCheckout: false }],
  ] as Array<[string, Record<string, unknown>]>) {
    it(`WHS2-19 not offered when ${label}: the product is refused, the service is taken`, async () => {
      storefront = answer;
      render(<PublicBookingPage />);
      fireEvent.click(await screen.findByRole("button", { name: "Door: add the product" }));
      fireEvent.click(screen.getByRole("button", { name: "Door: add the service" }));
      await waitFor(() => expect(storedCart().map((c) => c.id)).toEqual([door.SERVICE.id]));
      expect(await screen.findByRole("button", { name: "Open cart with 1 items" })).toBeTruthy();
      // Refused at the door, not only filtered out afterwards: the store is not told a product went into a cart.
      const added = client.trackStoreEvent.mock.calls.filter(([, event]) => event === "add_to_cart").map(([, , id]) => id);
      expect(added).toEqual([door.SERVICE.id]);
    });
  }

  it("WHS2-20 offered: the product and the service are both taken", async () => {
    storefront = { storefront: {}, storeCheckout: true };
    render(<PublicBookingPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Door: add the product" }));
    fireEvent.click(screen.getByRole("button", { name: "Door: add the service" }));
    await waitFor(() => expect(storedCart().map((c) => c.id)).toEqual([door.PRODUCT.id, door.SERVICE.id]));
  });
});
