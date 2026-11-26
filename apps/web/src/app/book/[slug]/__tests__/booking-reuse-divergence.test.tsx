/**
 * SWP-BOOKING-SLOTS repair round 4 (MAJOR-1): a held time is never booked once the checkout no longer matches the
 * kept bookings' reuse key.
 *
 * The page reuses kept bookings only when the whole checkout matches their reuse key; otherwise it books every line
 * afresh, and the server refuses a held time (the customer's own PENDING booking still takes it), which could leave
 * a line created first orphaned. Two services are held (Session 11:00, Follow-up 09:00) and the payment fails; the
 * customer keeps the Session at 11:00 and moves the Follow-up to 12:00. From then on no row offers or keeps a held
 * time: the customer is told the held times are released and picks fresh ones, and every booking posted is at an
 * instant the fresh answer offered. Both cart orders are run.
 *
 *   BRD-01  Session first in the cart
 *   BRD-02  Follow-up first in the cart
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const { SLUG, BUSINESS, SERVICE, SERVICE_B, PRODUCT, nothing, passthrough } = vi.hoisted(() => ({
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
  SERVICE_B: {
    id: "brh_svc_2",
    name: "BRH Follow-up",
    price: 80,
    currency: "USD",
    itemType: "service" as const,
    requiresBooking: true,
    sourceServiceId: "brh_svc_2",
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


const net = vi.hoisted(() => ({
  slots: [] as string[],
  slotsBy: {} as Record<string, string[]>,
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
      const serviceId = new URLSearchParams(path.split("?")[1]).get("serviceId") ?? "";
      return { data: { date: "2026-12-15", slots: net.slotsBy[serviceId] ?? net.slots }, error: null };
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

const at = (hhmm: string) => `2026-12-15T${String(Number(hhmm.slice(0, 2)) + 4).padStart(2, "0")}:${hhmm.slice(3)}:00.000Z`;
const ALL = ["09:00", "11:00", "12:00", "13:00"].map(at);
/** After the failed payment: the customer's own PENDING bookings are counted as taken. */
const FRESH = { [SERVICE.id]: ["09:00", "12:00", "13:00"].map(at), [SERVICE_B.id]: ["11:00", "12:00", "13:00"].map(at) };
const HELD = { [SERVICE.id]: at("11:00"), [SERVICE_B.id]: at("09:00") };
const RELEASED = /Changing your booking releases the times we were holding; pick times again\./;

const BOOK_PATH = `/bookings/public/businesses/${BUSINESS.id}`;
const ORDER_PATH = `/site/storefront/public/${SLUG}/checkout`;
const bookingPosts = () => net.posts.filter((p) => p.path === BOOK_PATH);
const orderPosts = () => net.posts.filter((p) => p.path === ORDER_PATH);
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const rowOf = (name: string) => {
  const card = screen.getByText(name, { selector: "h3" }).closest(".rounded-2xl") as HTMLElement;
  return { q: within(card), date: card.querySelector('input[type="date"]') as HTMLInputElement };
};

async function toSchedule() {
  fireEvent.click(await screen.findByRole("button", { name: "Checkout" }, { timeout: 3000 }));
  const first = await screen.findByPlaceholderText("John");
  if (!(first as HTMLInputElement).value) fireEvent.change(first, { target: { value: "Rhea" } });
  const email = screen.getByPlaceholderText("john@example.com") as HTMLInputElement;
  if (!email.value) fireEvent.change(email, { target: { value: "brd_customer@example.test" } });
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
  net.slots = ALL;
  net.slotsBy = {};
  net.orderPayment = { status: "FAILED" };
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

async function moveOneHeldTime(cart: unknown[]) {
  window.localStorage.setItem(`kf_cart_${SLUG}`, JSON.stringify(cart));
  render(<PublicBookingPage />);
  await toSchedule();
  for (const [service, time] of [[SERVICE, "11:00"], [SERVICE_B, "09:00"]] as const) {
    const row = rowOf(service.name);
    fireEvent.change(row.date, { target: { value: "2026-12-15" } });
    fireEvent.click(await row.q.findByRole("button", { name: time }));
  }
  await placeOrder();
  await screen.findByRole("heading", { name: "Payment Failed" }, { timeout: 3000 });
  expect(bookingPosts().map((p) => p.body.startTime).sort()).toEqual([HELD[SERVICE.id], HELD[SERVICE_B.id]].sort());

  fireEvent.click(button("Back to Shop"));
  net.slotsBy = FRESH;
  net.orderPayment = null;
  const before = net.posts.length;
  await toSchedule();

  // Both held times come back; the customer keeps the Session at 11:00 and moves the Follow-up to 12:00.
  const session = rowOf(SERVICE.name);
  const followUp = rowOf(SERVICE_B.name);
  expect(await session.q.findByRole("button", { name: "11:00" })).toBeInTheDocument();
  fireEvent.click(await followUp.q.findByRole("button", { name: "12:00" }));

  expect(screen.getByText(RELEASED)).toBeInTheDocument();
  expect(session.q.queryByRole("button", { name: "11:00" }), "the Session's held 11:00 is no longer offered").toBeNull();
  expect(followUp.q.queryByRole("button", { name: "09:00" }), "the Follow-up's held 09:00 is no longer offered").toBeNull();
  expect(button(/Continue/i), "the released 11:00 does not schedule the Session").toBeDisabled();

  fireEvent.click(await session.q.findByRole("button", { name: "13:00" }));
  await placeOrder();
  await screen.findByRole("heading", { name: "Order Placed!" }, { timeout: 3000 });

  const rebooked = net.posts.slice(before).filter((p) => p.path === BOOK_PATH);
  expect(rebooked).toHaveLength(2);
  for (const p of rebooked) {
    const serviceId = String(p.body.serviceId);
    expect(FRESH[serviceId], `${serviceId} is booked at a time the fresh answer offered`).toContain(p.body.startTime);
    expect(p.body.startTime).not.toBe(HELD[serviceId]);
  }
  expect(orderPosts()).toHaveLength(2);
}

describe("SWP-BOOKING-SLOTS: a held time is never booked once the reuse key no longer matches", () => {
  it("BRD-01 Session first in the cart", async () => {
    await moveOneHeldTime([SERVICE, SERVICE_B, PRODUCT]);
  });
  it("BRD-02 Follow-up first in the cart", async () => {
    await moveOneHeldTime([SERVICE_B, SERVICE, PRODUCT]);
  });
});
