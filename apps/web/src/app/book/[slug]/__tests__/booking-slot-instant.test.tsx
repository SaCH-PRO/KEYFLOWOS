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
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { SLUG, BUSINESS, SERVICE, nothing, passthrough } = vi.hoisted(() => ({
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
  },
  nothing: () => null,
  passthrough: ({ children }: { children?: ReactNode }) => children ?? null,
}));

const net = vi.hoisted(() => ({ posts: [] as Array<{ path: string; body: Record<string, unknown> }> }));

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
/** The checkout form, reduced to its submit: 11:00 on the business's clock, the instant the slots route offered. */
vi.mock("../components/checkout-flow", () => ({
  CheckoutFlow: ({ cart, onSubmit }: { cart: Array<{ id: string; itemType: string }>; onSubmit: (d: unknown) => Promise<void> }) => (
    <button
      type="button"
      onClick={() => {
        void onSubmit({
          serviceBookings: Object.fromEntries(
            cart.map((c) => [
              `${c.id}_${c.itemType}`,
              { serviceId: c.id, serviceName: "BSI Session", staffId: "", date: "2026-12-15", time: "11:00", startIso: "2026-12-15T15:00:00.000Z" },
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
});
