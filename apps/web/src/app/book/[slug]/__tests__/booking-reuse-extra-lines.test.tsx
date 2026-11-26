/**
 * SWP-BOOKING-SLOTS repair round 5 (MAJOR, page side): the page reuses kept bookings only for exactly their reuse key.
 *
 * A mixed cart books two services; the order's payment fails and both bookings are kept under the checkout's reuse
 * key. The customer then drops one service and checks out the other at the very instant it was booked: the kept
 * key has a line more than this checkout, so the kept bookings are not this checkout's and the service is booked
 * again (the server then judges it). The checkout form is stubbed to submit exactly that, so what is under test is
 * the page's own comparison, not the checkout's gate.
 *
 *   BRX-01  a checkout whose lines are a part of the kept key's books afresh, never reusing the kept bookings
 *   BRX-02  control: the same customer with the same lines reuses them
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { SLUG, BUSINESS, SERVICE, SERVICE_2, PRODUCT, nothing, passthrough } = vi.hoisted(() => ({
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
  PRODUCT: {
    id: "bsi_prd_1",
    name: "BSI Widget",
    price: 50,
    currency: "TTD",
    itemType: "product" as const,
    requiresBooking: false,
    quantity: 1,
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

const net = vi.hoisted(() => ({
  posts: [] as Array<{ path: string; body: Record<string, unknown> }>,
  orderPayment: null as Record<string, unknown> | null,
}));
/** Each service's chosen time and the instant the slots route offered for it. */
const row = vi.hoisted(() => ({
  time: { bsi_svc_1: "11:00", bsi_svc_2: "09:00" } as Record<string, string>,
  at: { bsi_svc_1: "2026-12-15T15:00:00.000Z", bsi_svc_2: "2026-12-15T13:00:00.000Z" } as Record<string, string>,
}));

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
    if (path === `/bookings/public/businesses/${BUSINESS.id}`) return { data: { success: true, bookingId: `bsi_bk_${net.posts.length}` }, error: null };
    if (path === `/site/storefront/public/${SLUG}/checkout`) {
      return {
        data: {
          order: {
            id: "brx_ord_1", orderNumber: "ORD-BRX-1", status: "PENDING", paymentStatus: "UNPAID",
            subtotal: 50, shippingFee: 0, taxAmount: 0, discountAmount: 0, total: 50, currency: "TTD", items: [],
          },
          payment: net.orderPayment,
        },
        error: null,
      };
    }
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
  CartDrawer: ({ cart, onCheckout, onRemoveFromCart }: {
    cart: Array<{ id: string; itemType: string; name: string }>;
    onCheckout: () => void;
    onRemoveFromCart: (id: string, itemType: string) => void;
  }) => (
    <div>
      <button type="button" onClick={onCheckout}>Checkout</button>
      {cart.map((c) => (
        <button key={`${c.itemType}:${c.id}`} type="button" onClick={() => onRemoveFromCart(c.id, c.itemType)}>
          Remove {c.name}
        </button>
      ))}
    </div>
  ),
}));
/**
 * The checkout form, reduced to its submit: 11:00 on the business's clock, with `row.startIso` (the instant the
 * slots route offered). A refused submit's message is kept in `row.error`, as the real checkout shows it.
 */
/** The checkout form, reduced to its submit: each service in the cart at the instant `row.at` names for it. */
vi.mock("../components/checkout-flow", () => ({
  CheckoutFlow: ({ cart, onSubmit }: { cart: Array<{ id: string; itemType: string; requiresBooking?: boolean }>; onSubmit: (d: unknown) => Promise<void> }) => (
    <button
      type="button"
      onClick={() => {
        onSubmit({
          serviceBookings: Object.fromEntries(
            cart
              .filter((c) => c.requiresBooking)
              .map((c) => [
                `${c.id}_${c.itemType}`,
                { serviceId: c.id, serviceName: c.id, staffId: "", date: "2026-12-15", time: row.time[c.id], startIso: row.at[c.id] },
              ]),
          ),
          firstName: "Bee",
          lastName: "Customer",
          email: "brx_customer@example.test",
          phone: "",
          paymentMethod: "cash",
          deliveryAddress: { street: "1 Frederick St", city: "Port of Spain", state: "", postalCode: "", country: "" },
          shippingZoneId: null,
          termsAccepted: true,
        }).catch(() => undefined);
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
  process.env.TZ = "America/Port_of_Spain";
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

const BOOK_PATH = `/bookings/public/businesses/${BUSINESS.id}`;
const bookingPosts = () => net.posts.filter((p) => p.path === BOOK_PATH);

beforeEach(() => {
  net.posts = [];
  net.orderPayment = { status: "FAILED" };
  window.localStorage.clear();
  window.localStorage.setItem(`kf_cart_${SLUG}`, JSON.stringify([SERVICE, SERVICE_2, PRODUCT]));
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

async function bothBookedThenFailed() {
  render(<PublicBookingPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Checkout" }, { timeout: 3000 }));
  fireEvent.click(await screen.findByRole("button", { name: "Place booking" }));
  await screen.findByRole("heading", { name: "Payment Failed" }, { timeout: 3000 });
  expect(bookingPosts()).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Back to Shop" }));
  net.orderPayment = null;
}

describe("SWP-BOOKING-SLOTS: the page reuses kept bookings only for exactly their reuse key", () => {
  it("BRX-01 a checkout whose lines are a part of the kept key's books afresh", async () => {
    await bothBookedThenFailed();
    fireEvent.click(await screen.findByRole("button", { name: `Remove ${SERVICE_2.name}` }));
    fireEvent.click(await screen.findByRole("button", { name: "Checkout" }));
    fireEvent.click(await screen.findByRole("button", { name: "Place booking" }));
    await waitFor(() => expect(bookingPosts()).toHaveLength(3));
    expect(bookingPosts()[2].body.serviceId).toBe(SERVICE.id);
    expect(bookingPosts()[2].body.startTime).toBe(row.at[SERVICE.id]);
  });

  it("BRX-02 control: the same customer with the same lines reuses the kept bookings", async () => {
    await bothBookedThenFailed();
    fireEvent.click(await screen.findByRole("button", { name: "Checkout" }));
    fireEvent.click(await screen.findByRole("button", { name: "Place booking" }));
    await screen.findByRole("heading", { name: "Order Placed!" }, { timeout: 3000 });
    expect(bookingPosts()).toHaveLength(2);
  });
});
