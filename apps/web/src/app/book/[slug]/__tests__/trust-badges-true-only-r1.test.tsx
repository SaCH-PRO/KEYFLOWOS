/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 1 (acceptance reviews at bed0f8f).
 *
 *   MAJOR-1 (part)  the cart drawer says no "Secure checkout"; its "SSL Encrypted" shows only over https
 *   MAJOR-2         a trust bar whose only line arrives late ("Payments by WiPay" once the gateway list answers, or
 *                   "N Orders Completed" once the count does) is visible: the fade-in observer attaches when the bar
 *                   first has a line, not only on mount (when the bar rendered nothing)
 *   MINOR-1         with no trust line at all, the store's trust row keeps a placeholder, so the share and wishlist
 *                   group stays on the right
 *
 * Real components; only lib/api's apiGet, next/navigation and (for the https case) the browser's scheme are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ apiGet: vi.fn() }));
const scheme = vi.hoisted(() => ({ https: false }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet };
});
vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  return { ...actual, trackStoreEvent: vi.fn() };
});
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ slug: "pepper-co" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/book/pepper-co",
}));
// jsdom always serves over http and its location cannot be redefined: the scheme is the one stubbed fact here.
vi.mock("../components/trust-bar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/trust-bar")>();
  return { ...actual, useServedOverHttps: () => scheme.https };
});

import { TrustBar } from "../components/trust-bar";
import { CartDrawer } from "../components/cart-drawer";
import PublicBookingPage from "../page";

/** An observer that reports every observed element as on screen at once, as a browser does for a bar in view. */
const observed: Element[] = [];
class SeenObserver {
  constructor(private cb: IntersectionObserverCallback) {}
  observe(el: Element) {
    observed.push(el);
    this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  disconnect() {}
  unobserve() {}
  takeRecords() { return []; }
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", SeenObserver);
  observed.length = 0;
  scheme.https = false;
});
afterEach(() => {
  cleanup();
  api.apiGet.mockReset();
  vi.unstubAllGlobals();
});

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
/** Whether `el` and every ancestor are fully opaque (an inline opacity of 0 anywhere hides it). */
function shown(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (n.style.opacity !== "" && Number(n.style.opacity) < 1) return false;
  }
  return true;
}

describe("MAJOR-2: a trust bar whose only line arrives late is visible", () => {
  it.each(["inline", "banner"] as const)("'Payments by WiPay' alone (%s): visible once the gateway list answers", async (variant) => {
    let answer: (v: unknown) => void = () => {};
    api.apiGet.mockImplementation((path: string) =>
      path.startsWith("/site/storefront/public/pepper-co/gateways") ? new Promise((r) => { answer = r; }) : Promise.resolve({ data: null, error: null }),
    );
    render(<TrustBar primaryColor="#f97316" secondaryColor="#0ea5e9" showPaymentBadge completedOrdersCount={0} businessHoursToday={null} slug="pepper-co" currency="TTD" variant={variant} />);
    expect(text()).not.toMatch(/Payments by/); // nothing to show yet
    answer({ data: [{ id: "wipay" }], error: null });
    const line = await screen.findByText("Payments by WiPay");
    await waitFor(() => expect(shown(line), "the bar stays at opacity 0").toBe(true));
  });

  it("'N Orders Completed' alone: visible once the count arrives", async () => {
    const { rerender } = render(<TrustBar primaryColor="#f97316" secondaryColor="#0ea5e9" showPaymentBadge={false} businessHoursToday={null} />);
    expect(text()).not.toMatch(/Orders Completed/);
    rerender(<TrustBar primaryColor="#f97316" secondaryColor="#0ea5e9" showPaymentBadge={false} completedOrdersCount={12} businessHoursToday={null} />);
    const line = await screen.findByText("12+ Orders Completed");
    await waitFor(() => expect(shown(line), "the bar stays at opacity 0").toBe(true));
  });

  it("control: a bar with a line from the first render is visible", async () => {
    render(<TrustBar primaryColor="#f97316" secondaryColor="#0ea5e9" showPaymentBadge={false} businessHoursToday="09:00 – 17:00" />);
    const line = screen.getByText("Today: 09:00 – 17:00");
    await waitFor(() => expect(shown(line)).toBe(true));
  });
});

describe("MAJOR-1: the cart drawer", () => {
  function openCart() {
    render(
      <CartDrawer
        cart={[{ id: "p1", name: "Pepper sauce", price: 35, currency: "TTD", quantity: 1, itemType: "product", requiresBooking: false } as never]}
        cartOpen
        cartCount={1}
        cartTotal={35}
        cartCurrency="TTD"
        primaryColor="#f97316"
        secondaryColor="#0ea5e9"
        accentColor="#22c55e"
        promoCode={null}
        slug="pepper-co"
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onUpdateQuantity={vi.fn()}
        onRemoveFromCart={vi.fn()}
        onCheckout={vi.fn()}
        onApplyPromo={vi.fn(async () => ({ success: true }))}
        onRemovePromo={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Pepper sauce").length).toBeGreaterThan(0);
  }

  it("says no 'Secure checkout', and no 'SSL Encrypted' over http", () => {
    openCart();
    expect(text()).not.toMatch(/Secure checkout/i);
    expect(text()).not.toMatch(/SSL Encrypted/i);
  });

  it("says 'SSL Encrypted' over https, and still no 'Secure checkout'", () => {
    scheme.https = true;
    openCart();
    expect(text()).toMatch(/SSL Encrypted/);
    expect(text()).not.toMatch(/Secure checkout/i);
  });
});

describe("MINOR-1: the store's trust row with no trust line", () => {
  it("keeps a placeholder before the share and wishlist group", async () => {
    const BUSINESS = { id: "biz_true_r1", name: "Pepper Co", slug: "pepper-co", currency: "TTD", timezone: "America/Port_of_Spain", storeEnabled: true };
    api.apiGet.mockImplementation(async (path: string) => {
      if (path === "/identity/businesses/slug/pepper-co") return { data: BUSINESS, error: null };
      if (path === "/site/storefront/public/pepper-co") return { data: { storefront: {} }, error: null };
      if (path.startsWith("/site/storefront/public/pepper-co/gateways")) return { data: [], error: null };
      if (path.endsWith("/services") || path.endsWith("/staff") || path.endsWith("/products")) return { data: [], error: null };
      return { data: null, error: null };
    });
    window.localStorage.clear();
    render(<PublicBookingPage />);
    const wishlist = await screen.findByTitle("Wishlist");
    await new Promise((r) => setTimeout(r, 20));
    expect(text()).not.toMatch(/Payments by|Orders Completed|Today:/); // no trust line at all
    const group = wishlist.parentElement!;
    const row = group.parentElement!;
    expect(row.className).toMatch(/justify-between/);
    expect(row.children.length, "the share and wishlist group is the row's only child, so it sits on the left").toBe(2);
    expect(row.lastElementChild).toBe(group);
  });
});
