/**
 * WEDGE-HIDE-STORE part 2 (P225, D-263; owner question 72 open): /book/<slug>/product/<id> offers Add to Cart only
 * when GET /site/storefront/public/<slug> answers `storeCheckout: true` (server row P233). Whether the product is
 * shown at all is question 72's, not pinned here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

const api = vi.hoisted(() => ({ apiGet: vi.fn() }));
/** The item this page is for (the product by default; WHS2-40 opens a bookable service). */
const route = vi.hoisted(() => ({ productId: "prod_whs2_pepper" }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet };
});
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: SLUG, productId: route.productId }),
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
const SERVICE_LINE = { id: "svc_whs2_cut", name: "Haircut", description: null, price: 120, currency: "TTD", duration: 30, imageUrl: null, itemType: "service", requiresBooking: true, quantity: 1 };
const SERVICE = { id: "svc_whs2_cut", name: "Haircut", description: null, duration: 30, price: 120 };
const CART_KEY = `kf_cart_${SLUG}`;
const ADD = /^(add to cart|pre-order)/i;
const COULD_NOT_CHECK = /couldn.t check online ordering/i;
let storefront: Record<string, unknown> | null = {};
/**
 * Gives the page a bounded window of real time (50 ms, inside act) to finish what the last update started: its
 * commit, the passive effects after it (the stored cart is rewritten in one), and anything those put on a timer. A
 * "nothing was deleted" check comes after this window, never inside the waitFor that saw the update and never after
 * a single microtask.
 */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 50)));
const storedCart = (): Array<{ id: string }> => JSON.parse(window.localStorage.getItem(CART_KEY) ?? "[]");

beforeEach(() => {
  route.productId = PRODUCT.id;
  window.localStorage.clear();
  api.apiGet.mockReset();
  api.apiGet.mockImplementation(async (path: string) => {
    if (path === `/identity/businesses/slug/${SLUG}`) return { data: BUSINESS, error: null };
    if (path === `/site/storefront/public/${SLUG}`) return storefront ? { data: storefront, error: null } : { data: null, error: "Request failed" };
    if (path.endsWith("/services")) return { data: [SERVICE], error: null };
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
    // The buying controls of a product on sale: the quantity stepper and the phone's fixed buy bar.
    expect(screen.getByText("Qty:")).toBeTruthy();
    expect(document.querySelector('[data-buy-bar]')).not.toBeNull();
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(storedCart().map((c) => c.id)).toEqual([PRODUCT.id]));
  });

  for (const [label, answer] of [
    ["the field is missing (a server without P233)", { storefront: {} }],
    ["storeCheckout is false", { storefront: {}, storeCheckout: false }],
  ] as Array<[string, Record<string, unknown> | null]>) {
    it(`WHS2-14 not offered when ${label}: no Add to Cart, and a restored product line is dropped`, async () => {
      storefront = answer;
      window.localStorage.setItem(CART_KEY, JSON.stringify([PRODUCT_LINE, SERVICE_LINE]));
      render(<ProductDetailPage />);
      await screen.findAllByText(PRODUCT.name);
      await waitFor(() => {
        expect(storedCart().map((c) => c.id)).toEqual([SERVICE_LINE.id]);
        expect(screen.queryAllByRole("button", { name: ADD })).toHaveLength(0);
        expect(screen.queryAllByRole("button", { name: /in cart|sold out/i })).toHaveLength(0);
      });
      // The cart on this page counts the booking line only.
      expect(await screen.findByRole("button", { name: "Open cart with 1 items" })).toBeTruthy();
    });

    it(`WHS2-23 not offered when ${label}: no quantity stepper, no checkout badges, no empty buy bar`, async () => {
      storefront = answer;
      render(<ProductDetailPage />);
      await screen.findAllByText(PRODUCT.name);
      expect(screen.queryByText("Qty:")).toBeNull();
      expect(screen.queryByText("Secure Checkout")).toBeNull();
      expect(screen.queryByText("Instant Confirmation")).toBeNull();
      expect(document.querySelector('[data-buy-bar]')).toBeNull();
    });
  }

  it("WHS2-30 the storefront read failed: no buying controls, stored cart kept, a notice; a retry that answers true brings Add to Cart and the cart back", async () => {
    storefront = null;
    window.localStorage.setItem(CART_KEY, JSON.stringify([PRODUCT_LINE, SERVICE_LINE]));
    render(<ProductDetailPage />);
    await screen.findAllByText(PRODUCT.name);
    expect(await screen.findByRole("button", { name: "Open cart with 1 items" })).toBeTruthy();
    expect(screen.getByText(COULD_NOT_CHECK)).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: ADD })).toHaveLength(0);
    expect(screen.queryByText("Qty:")).toBeNull();
    expect(document.querySelector('[data-buy-bar]')).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(storedCart().map((c) => c.id)).toEqual([PRODUCT.id, SERVICE_LINE.id]);

    storefront = { storefront: {}, storeCheckout: true };
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Open cart with 3 items" })).toBeTruthy();
    await settle();
    expect(screen.queryByText(COULD_NOT_CHECK)).toBeNull();
    expect(screen.getByText("Qty:")).toBeTruthy();
    expect(storedCart().map((c) => c.id)).toEqual([PRODUCT.id, SERVICE_LINE.id]);
  });

  it("WHS2-31 the storefront read failed, then a retry answers false: only then are the stored product lines dropped", async () => {
    storefront = null;
    window.localStorage.setItem(CART_KEY, JSON.stringify([PRODUCT_LINE, SERVICE_LINE]));
    render(<ProductDetailPage />);
    expect(await screen.findByText(COULD_NOT_CHECK)).toBeTruthy();
    await settle();
    expect(storedCart().map((c) => c.id)).toEqual([PRODUCT.id, SERVICE_LINE.id]);

    storefront = { storefront: {}, storeCheckout: false };
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(storedCart().map((c) => c.id)).toEqual([SERVICE_LINE.id]);
      expect(screen.queryByText(COULD_NOT_CHECK)).toBeNull();
      expect(screen.queryAllByRole("button", { name: ADD })).toHaveLength(0);
    });
  });

  it("WHS2-23e the storefront read failed: no quantity stepper, no checkout badges, no empty buy bar", async () => {
    storefront = null;
    render(<ProductDetailPage />);
    await screen.findAllByText(PRODUCT.name);
    expect(screen.queryByText("Qty:")).toBeNull();
    expect(screen.queryByText("Secure Checkout")).toBeNull();
    expect(screen.queryByText("Instant Confirmation")).toBeNull();
    expect(document.querySelector('[data-buy-bar]')).toBeNull();
    expect(screen.queryAllByRole("button", { name: ADD })).toHaveLength(0);
  });

  it("WHS2-39 the storefront read failed, and failed again on retry: the notice, Try again and the stored lines all stay", async () => {
    storefront = null;
    window.localStorage.setItem(CART_KEY, JSON.stringify([PRODUCT_LINE, SERVICE_LINE]));
    render(<ProductDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    // The signal: the second read was made and has answered (Try again is enabled again).
    await waitFor(() => {
      expect(api.apiGet.mock.calls.filter(([path]) => path === `/site/storefront/public/${SLUG}`)).toHaveLength(2);
      expect((screen.getByRole("button", { name: "Try again" }) as HTMLButtonElement).disabled).toBe(false);
    });
    // Then let the effects of that answer run, and only then look: everything is still there.
    await settle();
    expect(screen.getByText(COULD_NOT_CHECK)).toBeTruthy();
    // Still enabled after the window: Try again is not left dead by something that disables it late.
    expect((screen.getByRole("button", { name: "Try again" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryAllByRole("button", { name: ADD })).toHaveLength(0);
    expect(storedCart().map((c) => c.id)).toEqual([PRODUCT.id, SERVICE_LINE.id]);
  });

  it("WHS2-41 Try again is disabled while its read is out", async () => {
    storefront = null;
    render(<ProductDetailPage />);
    const tryAgain = await screen.findByRole("button", { name: "Try again" });
    let release: (v: unknown) => void = () => {};
    const held = new Promise((r) => { release = r; });
    const usual = api.apiGet.getMockImplementation()!;
    api.apiGet.mockImplementation(async (path: string) => {
      if (path === `/site/storefront/public/${SLUG}`) { await held; return { data: { storefront: {}, storeCheckout: true }, error: null }; }
      return usual(path);
    });
    try {
      fireEvent.click(tryAgain);
      await waitFor(() => expect((screen.getByRole("button", { name: "Try again" }) as HTMLButtonElement).disabled).toBe(true));
    } finally {
      release(null);
    }
    expect((await screen.findAllByRole("button", { name: ADD })).length).toBeGreaterThan(0);
  });

  for (const [label, answer] of [
    ["the field is missing (a server without P233)", { storefront: {} }],
    ["storeCheckout is false", { storefront: {}, storeCheckout: false }],
    ["the storefront read failed", null],
  ] as Array<[string, Record<string, unknown> | null]>) {
    it(`WHS2-40 a bookable service's page is untouched when ${label}: its button stays and books it, with no notice`, async () => {
      storefront = answer;
      route.productId = SERVICE.id;
      render(<ProductDetailPage />);
      const buttons = await screen.findAllByRole("button", { name: ADD });
      expect(screen.queryByText(COULD_NOT_CHECK)).toBeNull();
      fireEvent.click(buttons[0]);
      await waitFor(() => expect(storedCart().map((c) => c.id)).toEqual([SERVICE.id]));
    });
  }
});
