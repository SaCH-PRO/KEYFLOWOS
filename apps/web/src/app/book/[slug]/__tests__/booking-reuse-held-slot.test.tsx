/**
 * SWP-BOOKING-SLOTS repair round 3 (MAJOR, with SEC-W9WCN-1): a customer back from a failed payment keeps the
 * time they already booked, and is not booked twice.
 *
 * A mixed cart books its service before the store order; when the order's payment fails the booking is kept for
 * the same customer and the same service lines (bookingReuseKey), so their next checkout reuses it. The server's
 * public slots route counts that PENDING booking as taken, so once the picker read the server it no longer offered
 * the customer's own time: the row could not be scheduled with it, another time changed the reuse key, and the
 * service was booked a second time, leaving the first booking orphaned. The page now hands the checkout the slots
 * it holds under the kept key; the checkout fills those rows with them, offers each held time beside the server's
 * answer, and counts it as scheduled.
 *
 * The page and the real CheckoutFlow are mounted with the network edge (lib/api) answered; the storefront
 * sections are stubbed.
 *
 *   BRH-01  after a failed payment, the same customer checks out again with the time already booked (selected,
 *           though the fresh answer omits it); the service is booked once, at that instant, and the order placed
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { SLUG, BUSINESS, SERVICE, PRODUCT, nothing, passthrough } = vi.hoisted(() => ({
  SLUG: "brh-shop",
  BUSINESS: {
    id: "brh_biz_1",
    name: "BRH Studio",
    slug: "brh-shop",
    currency: "USD",
    timezone: "America/Port_of_Spain",
    storeEnabled: true,
    businessHours: { tue: { open: "09:00", close: "17:00", closed: false } },
  },
  SERVICE: {
    id: "brh_svc_1",
    name: "BRH Session",
    price: 100,
    currency: "USD",
    itemType: "service" as const,
    requiresBooking: true,
    sourceServiceId: "brh_svc_1",
    quantity: 1,
    duration: 60,
  },
  PRODUCT: {
    id: "brh_prd_1",
    name: "BRH Widget",
    price: 50,
    currency: "USD",
    itemType: "product" as const,
    requiresBooking: false,
    quantity: 1,
  },
  nothing: () => null,
  passthrough: ({ children }: { children?: ReactNode }) => children ?? null,
}));

/** 09:00, 11:00 and 12:00 in Port of Spain (UTC-4). */
const FREE = ["2026-12-15T13:00:00.000Z", "2026-12-15T15:00:00.000Z", "2026-12-15T16:00:00.000Z"];
/** The same day with the customer's own PENDING 11:00 booking counted as taken. */
const WITHOUT_OWN = ["2026-12-15T13:00:00.000Z", "2026-12-15T16:00:00.000Z"];
const ELEVEN = "2026-12-15T15:00:00.000Z";

const net = vi.hoisted(() => ({
  slots: [] as string[],
  orderPayment: null as Record<string, unknown> | null,
  posts: [] as Array<{ path: string; body: Record<string, unknown> }>,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "brh-shop" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/book/brh-shop",
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("@/lib/api", () => ({
  API_BASE: "http://api.brh.test",
  apiGet: async (path: string) => {
    if (path === `/identity/businesses/slug/${SLUG}`) return { data: BUSINESS, error: null };
    if (path.startsWith(`/bookings/public/businesses/${BUSINESS.id}/slots`)) {
      return { data: { date: "2026-12-15", slots: net.slots }, error: null };
    }
    if (path.endsWith("/services") || path.endsWith("/staff") || path.endsWith("/products") || path.includes("/gateways")) {
      return { data: [], error: null };
    }
    return { data: null, error: null };
  },
  apiPost: async ({ path, body }: { path: string; body: Record<string, unknown> }) => {
    net.posts.push({ path, body });
    if (path === `/bookings/public/businesses/${BUSINESS.id}`) {
      return { data: { success: true, bookingId: `brh_bk_${net.posts.length}` }, error: null };
    }
    if (path === `/site/storefront/public/${SLUG}/checkout`) {
      return {
        data: {
          order: {
            id: "brh_ord_1", orderNumber: "ORD-BRH-1", status: "PENDING", paymentStatus: "UNPAID",
            subtotal: 50, shippingFee: 0, taxAmount: 0, discountAmount: 0, total: 50, currency: "USD", items: [],
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
  CartDrawer: ({ onCheckout }: { onCheckout: () => void }) => (
    <button type="button" onClick={onCheckout}>Checkout</button>
  ),
}));

import PublicBookingPage from "../page";

const BOOK_PATH = `/bookings/public/businesses/${BUSINESS.id}`;
const ORDER_PATH = `/site/storefront/public/${SLUG}/checkout`;
const bookingPosts = () => net.posts.filter((p) => p.path === BOOK_PATH);
const orderPosts = () => net.posts.filter((p) => p.path === ORDER_PATH);
const button = (name: string | RegExp) => screen.getByRole("button", { name });

/** The checkout's information and delivery steps, up to its Schedule part (the details are remembered after once). */
async function toSchedule() {
  fireEvent.click(await screen.findByRole("button", { name: "Checkout" }, { timeout: 3000 }));
  const first = await screen.findByPlaceholderText("John");
  if (!(first as HTMLInputElement).value) fireEvent.change(first, { target: { value: "Rhea" } });
  const email = screen.getByPlaceholderText("john@example.com") as HTMLInputElement;
  if (!email.value) fireEvent.change(email, { target: { value: "brh_customer@example.test" } });
  fireEvent.click(button(/Continue/i));
  fireEvent.change(screen.getByPlaceholderText("123 Main Street"), { target: { value: "1 Frederick St" } });
  fireEvent.change(screen.getByPlaceholderText("Port of Spain"), { target: { value: "Port of Spain" } });
}

async function placeOrder() {
  fireEvent.click(button(/Continue/i));
  fireEvent.click(screen.getByText(/I agree to the terms of service/));
  fireEvent.click(button(/Place Order/i));
}

beforeEach(() => {
  net.posts = [];
  net.slots = FREE;
  net.orderPayment = { status: "FAILED" };
  window.localStorage.clear();
  window.localStorage.setItem(`kf_cart_${SLUG}`, JSON.stringify([SERVICE, PRODUCT]));
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("SWP-BOOKING-SLOTS: a kept booking's time stays the customer's after a failed payment", () => {
  it("BRH-01 the same customer checks out again with the time already booked, and is booked once", async () => {
    render(<PublicBookingPage />);
    await toSchedule();
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-12-15" } });
    fireEvent.click(await screen.findByRole("button", { name: "11:00" }));
    await placeOrder();
    await screen.findByRole("heading", { name: "Payment Failed" }, { timeout: 3000 });
    expect(bookingPosts()).toHaveLength(1);
    expect(bookingPosts()[0].body.startTime).toBe(ELEVEN);

    // Back to the shop. The server now counts the customer's own PENDING 11:00 as taken.
    fireEvent.click(button("Back to Shop"));
    net.slots = WITHOUT_OWN;
    net.orderPayment = null;
    await toSchedule();

    // The row comes back with the time already booked, chosen and offered, though the fresh answer omits it.
    expect((document.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-12-15");
    expect(await screen.findByRole("button", { name: "11:00" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "12:00" })).toBeInTheDocument();
    expect(button(/Continue/i), "the kept 11:00 schedules the row").toBeEnabled();

    await placeOrder();
    await screen.findByRole("heading", { name: "Order Placed!" }, { timeout: 3000 });
    expect(orderPosts()).toHaveLength(2);
    expect(bookingPosts(), "the service is booked once, not again at another time").toHaveLength(1);
  });
});
