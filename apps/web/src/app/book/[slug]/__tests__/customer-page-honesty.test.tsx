/**
 * CUSTOMER-PAGE-HONESTY (journeys F and G; G10 "no unearned badge on the store page", G11 "/site/<slug> redirects
 * to /book/<slug>"): the customer pages claim nothing the business has not earned.
 *
 * WHY this test exists: the store page's hero showed 'Verified Business' and 'Instant Booking' to every visitor
 * (KeyFlowOS verifies no business, and a booking may need the owner's confirmation), the trust bar fell back to
 * 'Guaranteed by KeyFlowOS' (KeyFlowOS guarantees nothing), and the hero said 'Open Now' when the business had set
 * no opening hours at all. The open state is read on the business's own clock (Business.timezone), not the
 * visitor's: a customer abroad must not see a Trinidad shop as open at 02:00 in Port of Spain. /site/<slug>, the old
 * page builder's public page (hidden by NAV-B-HIDE), now sends every visitor to the one store page, /book/<slug>,
 * with a temporary redirect, also when the business published a page in the builder.
 *
 * The order confirmation offered "Get Order Updates" with a "Notify Me" button that POSTed the email to
 * /site/storefront/public/order/:orderId/notify, a route the server does not have, and showed "Subscribed!" whatever
 * it answered: a promise of emails nobody sends (the server alerts the owner, OWNER-ALERTS-SERVER). The packet named
 * order/[token]/page.tsx for this, which calls no notify route (CONTRADICTION on issue #80, 2026-11-26); the form
 * and the call are removed from order-confirmation.tsx.
 *
 * Mounted on the real components; only the HTTP edge (fetch, lib/api's apiGet) and next/navigation are stubbed.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { url });
  }),
  permanentRedirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_PERMANENT_REDIRECT ${url}`), { url });
  }),
}));

const api = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet };
});
vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  return { ...actual, trackStoreEvent: vi.fn() };
});

vi.mock("next/navigation", () => ({
  redirect: nav.redirect,
  permanentRedirect: nav.permanentRedirect,
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
  useParams: () => ({ slug: "pepper-co", productId: "prod_honest_1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/book/pepper-co",
}));

import { BusinessHero } from "../components/business-hero";
import { TrustBar, SecurityFooter } from "../components/trust-bar";
import ProductPage from "../product/[productId]/page";
import { CheckoutFlow } from "../components/checkout-flow";
import { ItemDetailModal } from "../components/item-detail-modal";
import PublicBookingPage from "../page";
import type { Business, BusinessHours } from "../components/types";
import { OrderConfirmation } from "../components/order-confirmation";
import PublicSitePage from "../../../site/[slug]/page";

const UNEARNED = ["Verified Business", "Instant Booking", "Guaranteed by KeyFlowOS"];

beforeAll(() => {
  // jsdom has no IntersectionObserver; the trust bar only uses it to fade in.
  class NoopObserver {
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() { return []; }
  }
  vi.stubGlobal("IntersectionObserver", NoopObserver);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } });
  nav.redirect.mockClear();
  nav.permanentRedirect.mockClear();
});

function business(businessHours?: BusinessHours | null): Business {
  return {
    id: "biz_honest_1",
    name: "Pepper Co",
    slug: "pepper-co",
    timezone: "America/Port_of_Spain",
    currency: "TTD",
    businessHours,
  };
}

const WEEKDAYS_9_TO_5: BusinessHours = {
  monday: { open: "09:00", close: "17:00", closed: false },
  tuesday: { open: "09:00", close: "17:00", closed: false },
  wednesday: { open: "09:00", close: "17:00", closed: false },
  thursday: { open: "09:00", close: "17:00", closed: false },
  friday: { open: "09:00", close: "17:00", closed: false },
  saturday: { open: "09:00", close: "13:00", closed: true },
  sunday: { open: "09:00", close: "13:00", closed: true },
};

function renderHero(b: Business) {
  return render(<BusinessHero business={b} primaryColor="#f97316" secondaryColor="#0ea5e9" accentColor="#22c55e" config={null} />);
}

const pageText = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

/** Freeze only the clock (the hero animates with requestAnimationFrame, which stays real). */
function at(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

describe("store hero: no unearned badges", () => {
  it("shows neither 'Verified Business' nor 'Instant Booking' (nothing verified them)", () => {
    renderHero(business(WEEKDAYS_9_TO_5));
    for (const badge of ["Verified Business", "Instant Booking"]) {
      expect(pageText(), `the hero shows '${badge}'`).not.toMatch(new RegExp(badge, "i"));
    }
  });

  it("says nothing about being open when the business has set no opening hours", () => {
    for (const hours of [null, undefined, {} as BusinessHours]) {
      renderHero(business(hours));
      const text = pageText();
      expect(text, `hours ${JSON.stringify(hours)}: 'Open Now'`).not.toMatch(/open now/i);
      expect(text, `hours ${JSON.stringify(hours)}: an open or closed claim`).not.toMatch(/\bopen\b|\bcloses?\b|\bclosed\b|opens at/i);
      cleanup();
    }
  });

  it("says it is open only while today's hours are running, on the business's own clock", () => {
    // Thursday 2026-11-26 10:00 in Port of Spain (UTC-4).
    at("2026-11-26T14:00:00Z");
    renderHero(business(WEEKDAYS_9_TO_5));
    expect(pageText()).toMatch(/open · closes 17:00/i);
    cleanup();

    // Thursday 19:00 in Port of Spain: closed.
    at("2026-11-26T23:00:00Z");
    renderHero(business(WEEKDAYS_9_TO_5));
    expect(pageText()).not.toMatch(/open now|open ·/i);
    expect(pageText()).toMatch(/closed now/i);
    cleanup();

    // Friday 2026-11-27 02:30 UTC is still Thursday 22:30 in Port of Spain: a late shop is open there,
    // whatever the visitor's own clock says (the test machine runs on UTC, where it is a closed Friday).
    at("2026-11-27T02:30:00Z");
    renderHero(business({
      thursday: { open: "18:00", close: "23:30", closed: false },
      friday: { open: "09:00", close: "17:00", closed: true },
    }));
    expect(pageText()).toMatch(/open · closes 23:30/i);
  });
});

describe("store hero: the hours as the store saves them (short day keys)", () => {
  // Your page's hours editor and the server's booking availability key Business.businessHours by sun..sat; the
  // profile editor writes sunday..saturday. Both are read: a business open now is not called closed.
  const SHORT_9_TO_5: BusinessHours = Object.fromEntries(
    ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, { open: "09:00", close: "17:00", closed: false }]),
  );

  it("a business open 09:00-17:00 every day is open at 11:00 in Port of Spain, not 'Closed Today'", () => {
    at("2026-11-26T15:00:00Z");
    renderHero(business(SHORT_9_TO_5));
    expect(pageText()).not.toMatch(/closed today/i);
    expect(pageText()).toMatch(/open · closes 17:00/i);
  });

  it("and closed at 18:00 there", () => {
    at("2026-11-26T22:00:00Z");
    renderHero(business(SHORT_9_TO_5));
    expect(pageText()).toMatch(/closed now/i);
  });
});

describe("trust bar: no unearned badges", () => {
  it("never falls back to 'Guaranteed by KeyFlowOS', with or without today's hours", () => {
    for (const businessHoursToday of [null, undefined, "09:00 – 17:00"]) {
      render(<TrustBar primaryColor="#f97316" secondaryColor="#0ea5e9" businessHoursToday={businessHoursToday} />);
      for (const badge of UNEARNED) {
        expect(pageText(), `hours today ${JSON.stringify(businessHoursToday)}: '${badge}'`).not.toMatch(new RegExp(badge, "i"));
      }
      cleanup();
    }
  });
});

describe("/site/<slug>: a temporary redirect to /book/<slug>", () => {
  const published = {
    business: { id: "biz_honest_1", name: "Pepper Co", primaryColor: "#f97316" },
    payload: { hero: { headline: "Pepper Co: hot sauces" }, sections: [] },
    plan: "FREE",
  };

  async function open(slug: string) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(published), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    let thrown: unknown;
    try {
      await PublicSitePage({ params: Promise.resolve({ slug }) });
    } catch (e) {
      thrown = e;
    }
    return { thrown, fetchMock };
  }

  it("sends a business that published a page in the old builder to /book/<slug>, not permanently", async () => {
    const { thrown } = await open("pepper-co");
    expect(thrown, "the page redirects").toBeTruthy();
    expect(nav.redirect).toHaveBeenCalledTimes(1);
    expect(nav.redirect.mock.calls[0][0]).toBe("/book/pepper-co");
    // A second argument would only choose push/replace; redirect() answers 307 from a server component.
    expect(nav.permanentRedirect, "a permanent (308) redirect").not.toHaveBeenCalled();
  });

  it("keeps the slug a single path segment", async () => {
    await open("pepper co/../x");
    expect(nav.redirect.mock.calls[0][0]).toBe(`/book/${encodeURIComponent("pepper co/../x")}`);
  });

  it("does not render the old builder's page for anyone", async () => {
    const { fetchMock } = await open("pepper-co");
    const presenceReads = fetchMock.mock.calls.filter((c) => String((c as unknown[])[0]).includes("/site/presence/public/"));
    expect(presenceReads, "the old builder's published page is still read").toEqual([]);
  });
});

function renderOrderConfirmation(customerEmail: string | null) {
  return render(
    <OrderConfirmation
      isOrder
      businessName="Pepper Co"
      primaryColor="#f97316"
      secondaryColor="#0ea5e9"
      accentColor="#22c55e"
      confirmedDetails={null}
      bookingResults={[]}
      calendarUrl={null}
      apiBase="http://api.test.local"
      orderItems={[{ id: "p1", name: "Pepper sauce", price: 35, currency: "TTD", quantity: 1, itemType: "product", requiresBooking: false } as never]}
      orderTotal={35}
      orderCurrency="TTD"
      orderNumber="ORD-0001"
      orderId="ord_honest_1"
      customerEmail={customerEmail}
      onContinueShopping={() => {}}
      formatDate={(d) => d}
      formatTime={(t) => t}
    />,
  );
}

describe("order confirmation: no subscribe-to-updates promise, no call to a missing route", () => {
  it("a store order placed without an email offers no 'Notify Me' sign-up", () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    renderOrderConfirmation(null);
    expect(screen.queryByRole("button", { name: /notify me/i }), "a 'Notify Me' button").toBeNull();
    expect(screen.queryByText(/get order updates/i), "'Get Order Updates'").toBeNull();
    expect(screen.queryByText(/receive status notifications/i), "a promise of status emails").toBeNull();
    expect(document.querySelector('input[name="notifyEmail"]'), "an email field for updates").toBeNull();
    const notifyCalls = fetchMock.mock.calls.filter((c) => /\/notify\b/.test(String((c as unknown[])[0])));
    expect(notifyCalls, "a call to the notify route").toEqual([]);
  });

  it("still confirms the order and its number", () => {
    renderOrderConfirmation(null);
    expect(document.body.textContent).toContain("ORD-0001");
  });
});

describe("store footer and product page: no unearned badges", () => {
  it("the store page's footer does not say 'Instant Booking'", () => {
    render(<SecurityFooter primaryColor="#f97316" businessName="Pepper Co" />);
    expect(pageText()).not.toMatch(/instant booking/i);
    expect(pageText()).toContain("Pepper Co");
  });

  it("the product page claims neither 'Instant Booking' nor 'Quality Guaranteed', and still shows the product", async () => {
    const BUSINESS = { id: "biz_honest_1", name: "Pepper Co", slug: "pepper-co", currency: "TTD", timezone: "America/Port_of_Spain", storeEnabled: true };
    const PRODUCT = {
      id: "prod_honest_1", name: "Scorpion pepper sauce", description: "Made in Trinidad", price: 45, currency: "TTD",
      category: "PRODUCT", imageUrl: null, isActive: true, availableQuantity: 8, stockStatus: "in_stock", purchasable: true,
    };
    api.apiGet.mockImplementation(async (path: string) => {
      if (path === "/identity/businesses/slug/pepper-co") return { data: BUSINESS, error: null };
      if (path === "/site/storefront/public/pepper-co") return { data: { business: BUSINESS, storefront: {}, services: [], products: [PRODUCT] }, error: null };
      if (path === `/bookings/public/businesses/${BUSINESS.id}/services`) return { data: [], error: null };
      if (path === `/commerce/public/businesses/${BUSINESS.id}/products`) return { data: [PRODUCT], error: null };
      return { data: null, error: null };
    });
    window.localStorage.clear();
    render(<ProductPage />);
    await screen.findAllByRole("heading", { name: PRODUCT.name });
    const text = pageText();
    for (const claim of ["Instant Booking", "Quality Guaranteed", ...UNEARNED]) {
      expect(text, `the product page says '${claim}'`).not.toMatch(new RegExp(claim, "i"));
    }
    expect(text).toContain("Made in Trinidad");
  });
});

describe("checkout and item details: no guarantee wording", () => {
  it("the checkout's payment step does not say 'Guaranteed by KeyFlowOS' (or any guarantee)", async () => {
    api.apiGet.mockImplementation(async () => ({ data: [], error: null }));
    render(
      <CheckoutFlow
        business={business(null)}
        cart={[{ id: "pkg_honest_1", name: "Pepper sauce gift box", price: 45, currency: "TTD", itemType: "package", requiresBooking: false, quantity: 1 }]}
        staff={[]}
        primaryColor="#f97316"
        secondaryColor="#0ea5e9"
        accentColor="#22c55e"
        cartTotal={45}
        cartCurrency="TTD"
        promoCode={null}
        shippingZones={[]}
        onBack={vi.fn()}
        onUpdateQuantity={vi.fn()}
        onSubmit={vi.fn(async () => undefined)}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("John"), { target: { value: "Cee" } });
    fireEvent.change(screen.getByPlaceholderText("john@example.com"), { target: { value: "cee@test.local" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText(/I agree to the terms of service/)).toBeTruthy());
    expect(pageText(), "a guarantee at checkout").not.toMatch(/guarantee/i);
  });

  it("the item details do not say 'Quality Guaranteed' (or any guarantee)", () => {
    render(
      <ItemDetailModal
        item={{ id: "prod_honest_1", name: "Scorpion pepper sauce", description: "Made in Trinidad", price: 45, currency: "TTD", duration: null, imageUrl: null, itemType: "product", requiresBooking: false }}
        primaryColor="#f97316"
        secondaryColor="#0ea5e9"
        accentColor="#22c55e"
        isInCart={false}
        addToCart={vi.fn()}
        removeFromCart={vi.fn()}
        relatedItems={[]}
        onClose={vi.fn()}
        onSelectItem={vi.fn()}
      />,
    );
    expect(pageText()).toContain("Scorpion pepper sauce");
    expect(pageText(), "a guarantee in the item details").not.toMatch(/guarantee/i);
  });
});

describe("/book/<slug> trust bar: today's hours on the business's clock, or nothing", () => {
  const BUSINESS = { id: "biz_honest_1", name: "Pepper Co", slug: "pepper-co", currency: "TTD", timezone: "America/Port_of_Spain", storeEnabled: true };
  const every = (keys: string[], open: string, close: string) =>
    Object.fromEntries(keys.map((d) => [d, { open, close, closed: false }]));
  const SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const LONG = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  async function openStore(businessHours: unknown) {
    api.apiGet.mockImplementation(async (path: string) => {
      if (path === "/identity/businesses/slug/pepper-co") return { data: { ...BUSINESS, businessHours }, error: null };
      if (path === "/site/storefront/public/pepper-co") return { data: { storefront: {} }, error: null };
      if (path.endsWith("/services") || path.endsWith("/staff") || path.endsWith("/products")) return { data: [], error: null };
      return { data: null, error: null };
    });
    window.localStorage.clear();
    render(<PublicBookingPage />);
    await screen.findAllByText("Pepper Co");
    await waitFor(() => expect(screen.getByText("Secure Checkout")).toBeTruthy());
    return pageText();
  }

  it("hours saved with short keys (sun..sat): today's hours, not 'Closed'", async () => {
    at("2026-11-26T15:00:00Z");
    const text = await openStore(every(SHORT, "09:00", "17:00"));
    expect(text).toContain("Today: 09:00 – 17:00");
    expect(text).not.toMatch(/today: closed/i);
  });

  it("hours saved with long keys (sunday..saturday) read the same", async () => {
    at("2026-11-26T15:00:00Z");
    const text = await openStore(every(LONG, "09:00", "17:00"));
    expect(text).toContain("Today: 09:00 – 17:00");
  });

  it("today is the business's day, not UTC's: 02:30 UTC Friday is still Thursday in Port of Spain", async () => {
    at("2026-11-27T02:30:00Z");
    const text = await openStore({ thu: { open: "18:00", close: "23:30", closed: false }, fri: { open: "09:00", close: "17:00", closed: true } });
    expect(text).toContain("Today: 18:00 – 23:30");
  });

  it("no hours set: no 'Today' line and no 'Closed'", async () => {
    for (const hours of [null, {}]) {
      const text = await openStore(hours);
      expect(text, `hours ${JSON.stringify(hours)}`).not.toMatch(/today:/i);
      expect(text, `hours ${JSON.stringify(hours)}`).not.toMatch(/\bclosed\b/i);
      cleanup();
    }
  });
});
