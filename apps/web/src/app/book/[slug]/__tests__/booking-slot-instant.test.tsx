/**
 * SWP-BOOKING-SLOTS: the storefront books exactly the instant the server offered.
 *
 * The page built each booking's startTime as new Date(`${date}T${time}`), on the visitor's clock. The picker's times
 * are the business's (Business.timezone), so a visitor in another zone booked a different instant from the one
 * shown, which the server then judged against the business's hours and bookings. The checkout now carries the
 * chosen slot's instant (ServiceBookingData.startIso, from the public slots route) and the page posts it as is.
 *
 * The page is mounted for real with its network edge (lib/api) answered and its sections stubbed; the checkout form
 * is reduced to the submit it makes. This file runs on Pacific/Kiritimati (UTC+14), a zone other than the business's.
 *
 *   BSI-01  a visitor in another zone books the instant the server offered (startIso), not the wall time on their clock
 *   BSI-02  (SEC-M2) a row with no server instant is refused, not posted on the visitor's clock
 *   BSI-03  every row with no server instant is named, not only the first
 *   BSI-04  the confirmation's Google Calendar link starts at the booked instant and ends a service's length later
 *   BSI-05  the link's title and location are encoded: a crafted name or location adds no parameter
 *   BSI-06  a service length that is not a sane number of minutes (1e13) gives the hour's fallback, never a crash
 *   BSI-07  a service with no length gives an hour
 *   BSI-08  a restored confirmation with no instant shows no link; a corrupted one (bad instant or length) never crashes
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { SLUG, BUSINESS, SERVICE, SERVICE_2, nothing, passthrough } = vi.hoisted(() => ({
  SLUG: "bsi-shop",
  BUSINESS: { id: "bsi_biz_1", name: "BSI Studio", slug: "bsi-shop", currency: "TTD", timezone: "America/Port_of_Spain", storeEnabled: true },
  SERVICE: {
    id: "bsi_svc_1",
    name: "BSI Session",
    price: 100,
    currency: "TTD",
    itemType: "service" as const,
    requiresBooking: true,
    quantity: 1,
    duration: 45,
  },
  /** A second service, for a cart with two rows (BSI-03). */
  SERVICE_2: {
    id: "bsi_svc_2",
    name: "BSI Follow-up",
    price: 60,
    currency: "TTD",
    itemType: "service" as const,
    requiresBooking: true,
    quantity: 1,
    duration: 30,
  },
  nothing: () => null,
  passthrough: ({ children }: { children?: ReactNode }) => children ?? null,
}));

const net = vi.hoisted(() => ({ posts: [] as Array<{ path: string; body: Record<string, unknown> }> }));
/** The instant the stubbed checkout submits for its row (undefined: a row with no server instant, SEC-M2). */
const row = vi.hoisted(() => ({ startIso: "2026-12-15T15:00:00.000Z" as string | undefined, error: "", location: undefined as string | undefined }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "bsi-shop" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/book/bsi-shop",
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("@/lib/api", () => ({
  API_BASE: "http://api.bsi.test",
  apiGet: async (path: string) => {
    if (path === `/identity/businesses/slug/${SLUG}`) return { data: BUSINESS, error: null };
    if (path.endsWith("/services") || path.endsWith("/staff") || path.endsWith("/products")) return { data: [], error: null };
    return { data: null, error: null };
  },
  apiPost: async ({ path, body }: { path: string; body: Record<string, unknown> }) => {
    net.posts.push({ path, body });
    if (path === `/bookings/public/businesses/${BUSINESS.id}`) return { data: { success: true, bookingId: "bsi_bk_1" }, error: null };
    return { data: null, error: `not stubbed: ${path}` };
  },
}));
vi.mock("@/lib/client", () => ({ trackStoreEvent: vi.fn() }));

vi.mock("../components/item-detail-modal", () => ({ ItemDetailModal: nothing }));
vi.mock("../components/business-hero", () => ({ BusinessHero: nothing }));
vi.mock("../components/catalog-grid", () => ({ CatalogGrid: nothing }));
vi.mock("../components/trust-bar", () => ({ TrustBar: nothing, SecurityFooter: nothing }));
vi.mock("../components/store-section-wrapper", () => ({ StoreSectionWrapper: passthrough }));
vi.mock("../components/faq-section", () => ({ FaqSection: nothing }));
vi.mock("../components/policies-section", () => ({ PoliciesFooterLinks: nothing }));
vi.mock("../components/contact-section", () => ({ ContactSection: nothing }));
vi.mock("../components/testimonials-section", () => ({ TestimonialsSection: nothing }));
vi.mock("../components/featured-section", () => ({ FeaturedSection: nothing }));
vi.mock("../components/category-nav", () => ({ CategoryNav: nothing }));
vi.mock("../components/structured-data", () => ({ OrganizationSchema: nothing, BreadcrumbListSchema: nothing }));
vi.mock("../components/wishlist-drawer", () => ({ WishlistDrawer: nothing }));
vi.mock("../components/share-buttons", () => ({ ShareStoreButton: nothing, ShareButtons: nothing }));
vi.mock("../components/guided-selector", () => ({ GuidedSelector: nothing }));
vi.mock("../components/asset-intake", () => ({ AssetIntake: nothing }));
vi.mock("../components/cart-drawer", () => ({
  CartDrawer: ({ onCheckout }: { onCheckout: () => void }) => (
    <button type="button" onClick={onCheckout}>Checkout</button>
  ),
}));
/**
 * The checkout form, reduced to its submit: 11:00 on the business's clock, with `row.startIso` (the instant the
 * slots route offered). A refused submit's message is kept in `row.error`, as the real checkout shows it.
 */
vi.mock("../components/checkout-flow", () => ({
  CheckoutFlow: ({ cart, onSubmit }: { cart: Array<{ id: string; itemType: string }>; onSubmit: (d: unknown) => Promise<void> }) => (
    <button
      type="button"
      onClick={() => {
        onSubmit({
          serviceBookings: Object.fromEntries(
            cart.map((c) => [
              `${c.id}_${c.itemType}`,
              { serviceId: c.id, serviceName: "BSI Session", staffId: "", date: "2026-12-15", time: "11:00", startIso: row.startIso, location: row.location },
            ]),
          ),
          firstName: "Bee",
          lastName: "Customer",
          email: "bsi_customer@example.test",
          phone: "",
          paymentMethod: "cash",
          deliveryAddress: null,
          shippingZoneId: null,
          termsAccepted: true,
        }).catch((e: unknown) => {
          row.error = e instanceof Error ? e.message : String(e);
        });
      }}
    >
      Place booking
    </button>
  ),
}));

import PublicBookingPage from "../page";

let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = "Pacific/Kiritimati";
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

beforeEach(() => {
  net.posts = [];
  row.startIso = "2026-12-15T15:00:00.000Z";
  row.error = "";
  row.location = undefined;
  window.localStorage.clear();
  window.localStorage.setItem(`kf_cart_${SLUG}`, JSON.stringify([SERVICE]));
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("SWP-BOOKING-SLOTS: the storefront books the instant the server offered", () => {
  it("BSI-01 a visitor in another zone books exactly the server's instant", async () => {
    render(<PublicBookingPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Checkout" }, { timeout: 3000 }));
    fireEvent.click(await screen.findByRole("button", { name: "Place booking" }));
    await waitFor(() => expect(net.posts.filter((p) => p.path === `/bookings/public/businesses/${BUSINESS.id}`)).toHaveLength(1));
    const booking = net.posts.find((p) => p.path === `/bookings/public/businesses/${BUSINESS.id}`)!;
    // At base: 2026-12-15T11:00 on Kiritimati's clock, 2026-12-14T21:00:00.000Z, a day off from the slot offered.
    expect(booking.body.startTime).toBe("2026-12-15T15:00:00.000Z");
  });

  it("BSI-02 a row with no server instant is refused: nothing is booked and the customer is told to pick a time again", async () => {
    row.startIso = undefined;
    render(<PublicBookingPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Checkout" }, { timeout: 3000 }));
    fireEvent.click(await screen.findByRole("button", { name: "Place booking" }));
    await waitFor(() => expect(row.error).not.toBe(""));
    expect(row.error).toMatch(/pick a time/i);
    expect(net.posts.filter((p) => p.path === `/bookings/public/businesses/${BUSINESS.id}`)).toHaveLength(0);
  });

  it("BSI-03 every row with no server instant is named, not only the first", async () => {
    row.startIso = undefined;
    window.localStorage.setItem(`kf_cart_${SLUG}`, JSON.stringify([SERVICE, SERVICE_2]));
    render(<PublicBookingPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Checkout" }, { timeout: 3000 }));
    fireEvent.click(await screen.findByRole("button", { name: "Place booking" }));
    await waitFor(() => expect(row.error).not.toBe(""));
    expect(row.error).toContain("BSI Session");
    expect(row.error).toContain("BSI Follow-up");
    expect(net.posts.filter((p) => p.path === `/bookings/public/businesses/${BUSINESS.id}`)).toHaveLength(0);
  });

  it("BSI-04 the Google Calendar link starts at the booked instant and ends a service's length later", async () => {
    render(<PublicBookingPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Checkout" }, { timeout: 3000 }));
    fireEvent.click(await screen.findByRole("button", { name: "Place booking" }));
    const link = await screen.findByRole("link", { name: /Add to Calendar/i }, { timeout: 3000 });
    const dates = new URL(link.getAttribute("href") ?? "").searchParams.get("dates");
    // At base: 11:00 read on Kiritimati's clock, 20261214T210000Z/20261214T220000Z.
    expect(dates).toBe("20261215T150000Z/20261215T154500Z");
  });

  /** Books the cart's service through the stubbed checkout and returns the confirmation's calendar link, if any. */
  async function calendarLink(): Promise<URL | null> {
    render(<PublicBookingPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Checkout" }, { timeout: 3000 }));
    fireEvent.click(await screen.findByRole("button", { name: "Place booking" }));
    await screen.findByRole("heading", { name: "Booking Confirmed!" }, { timeout: 3000 });
    const link = screen.queryByRole("link", { name: /Add to Calendar/i });
    return link ? new URL(link.getAttribute("href") ?? "") : null;
  }

  it("BSI-05 the link's title and location are encoded: a crafted name or location adds no parameter", async () => {
    const crafted = "Cut&dates=20000101T000000Z/20000101T010000Z&location=Elsewhere";
    window.localStorage.setItem(`kf_cart_${SLUG}`, JSON.stringify([{ ...SERVICE, name: crafted }]));
    row.location = `Salon ${crafted}`;
    const url = await calendarLink();
    expect(url).not.toBeNull();
    expect(url!.searchParams.get("text")).toBe(`${crafted} - BSI Studio`);
    expect(url!.searchParams.get("location")).toBe(`Salon ${crafted}`);
    expect(url!.searchParams.getAll("dates")).toEqual(["20261215T150000Z/20261215T154500Z"]);
    expect(url!.searchParams.getAll("location")).toHaveLength(1);
  });

  it("BSI-06 a service length that is not a sane number of minutes gives the hour's fallback, never a crash", async () => {
    window.localStorage.setItem(`kf_cart_${SLUG}`, JSON.stringify([{ ...SERVICE, duration: 1e13 }]));
    const url = await calendarLink();
    expect(url?.searchParams.get("dates")).toBe("20261215T150000Z/20261215T160000Z");
  });

  it("BSI-07 a service with no length gives an hour", async () => {
    const { duration: _duration, ...withoutLength } = SERVICE;
    window.localStorage.setItem(`kf_cart_${SLUG}`, JSON.stringify([withoutLength]));
    const url = await calendarLink();
    expect(url?.searchParams.get("dates")).toBe("20261215T150000Z/20261215T160000Z");
  });

  it("BSI-08 a restored confirmation with no instant shows no link; a corrupted one never crashes", async () => {
    const record = (details: Record<string, unknown>) =>
      JSON.stringify({
        bookingResults: [{ bookingId: "bsi_bk_9" }],
        bookingReuseKey: null,
        orderPayload: null,
        orderNumber: null,
        orderId: null,
        orderTotal: 100,
        paymentMethod: "cash",
        shippingZoneId: null,
        items: [SERVICE],
        customerEmail: null,
        confirmedDetails: { serviceNames: ["BSI Session"], dates: ["2026-12-15"], times: ["11:00"], locations: [null], businessName: "BSI Studio", ...details },
      });
    const cases: Array<Record<string, unknown>> = [
      {},
      { starts: ["not-a-time"], durations: [45] },
      { starts: ["2026-12-15T15:00:00.000Z"], durations: ["abc"] },
      { starts: ["2026-12-15T15:00:00.000Z"], durations: [1e13] },
    ];
    for (const details of cases) {
      window.localStorage.setItem(`kf_pending_checkout_${SLUG}`, record(details));
      render(<PublicBookingPage />);
      await screen.findByRole("heading", { name: "Booking Confirmed!" }, { timeout: 3000 });
      const link = screen.queryByRole("link", { name: /Add to Calendar/i });
      if ("starts" in details && String((details.starts as string[])[0]).startsWith("2026")) {
        expect(new URL(link!.getAttribute("href") ?? "").searchParams.get("dates"), JSON.stringify(details)).toBe("20261215T150000Z/20261215T160000Z");
      } else {
        expect(link, `no link for ${JSON.stringify(details)}`).toBeNull();
      }
      cleanup();
    }
  });
});
