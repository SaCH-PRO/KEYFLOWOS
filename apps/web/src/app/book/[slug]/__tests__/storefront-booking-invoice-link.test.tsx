/**
 * CR-V28-3 (V1-28 review; W9-WEB-COMMERCE-NAV, was it.todo in
 * apps/server/test/booking-settlement.integration.test.ts): the storefront
 * /book/[slug] hands the customer the token link the public booking create
 * answers.
 *
 * POST /bookings/public/businesses/:businessId answers the booking with the
 * customer's own /public/invoice/<token> link (D-07: token links only):
 * `invoiceUrl` for a service invoiced at booking, `depositInvoiceUrl` for a
 * deposit (BookingsService.createPublicBooking; the real-server proof is
 * booking-settlement.integration.test.ts S-08). The confirmation
 * (OrderConfirmation) opens that link from bookingResults[].invoiceUrl, but
 * this page pushed only {bookingId, invoiceId} into bookingResults, so the
 * link was dropped and the customer saw no invoice button. public/book reads
 * the same answer as `data?.invoiceUrl ?? data?.depositInvoiceUrl`.
 *
 * The page is mounted for real with its network edge (lib/api) answered and
 * its storefront sections stubbed: what is under test is what the checkout
 * hands the confirmation, which is the real OrderConfirmation. The checkout
 * form is reduced to the submit it makes (one service booked for a slot).
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const { SLUG, BUSINESS, nothing, passthrough } = vi.hoisted(() => ({
  SLUG: "v95q-shop",
  BUSINESS: { id: "v95q_biz_1", name: "v95q Studio", slug: "v95q-shop", currency: "TTD", storeEnabled: true },
  /** The storefront's sections, none of which the checkout result passes through. */
  nothing: () => null,
  passthrough: ({ children }: { children?: ReactNode }) => children ?? null,
}));
const { SERVICE, PRODUCT } = vi.hoisted(() => ({
  SERVICE: {
    id: "v95q_svc_1",
    name: "v95q Consultation",
    price: 100,
    currency: "TTD",
    itemType: "service" as const,
    requiresBooking: true,
    quantity: 1,
  },
  /** A product: a cart holding it and the service is a mixed cart (the bookings, then a store order). */
  PRODUCT: {
    id: "v95q_prd_1",
    name: "v95q Widget",
    price: 50,
    currency: "TTD",
    itemType: "product" as const,
    requiresBooking: false,
    quantity: 1,
  },
}));

const net = vi.hoisted(() => ({
  bookingAnswer: {} as Record<string, unknown>,
  /** What POST /site/storefront/public/:slug/checkout (the store order) answers. */
  orderAnswer: null as Record<string, unknown> | null,
  posts: [] as Array<{ path: string; body: unknown }>,
}));
/** Who fills in the checkout form, and how they pay (reset to the default customer before each case). */
const form = vi.hoisted(() => ({ firstName: "", lastName: "", email: "", phone: "", paymentMethod: "" }));
const DEFAULT_FORM = { firstName: "Vee", lastName: "Customer", email: "v95q_customer@example.test", phone: "", paymentMethod: "cash" };

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "v95q-shop" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/book/v95q-shop",
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

vi.mock("@/lib/api", () => ({
  API_BASE: "http://api.v95q.test",
  apiGet: async (path: string) => {
    if (path === `/identity/businesses/slug/${SLUG}`) return { data: BUSINESS, error: null };
    if (path.endsWith("/services") || path.endsWith("/staff") || path.endsWith("/products")) return { data: [], error: null };
    return { data: null, error: null };
  },
  apiPost: async ({ path, body }: { path: string; body: unknown }) => {
    net.posts.push({ path, body });
    if (path === `/bookings/public/businesses/${BUSINESS.id}`) return { data: net.bookingAnswer, error: null };
    if (path === `/site/storefront/public/${SLUG}/checkout` && net.orderAnswer) return { data: net.orderAnswer, error: null };
    return { data: null, error: `not stubbed: ${path}` };
  },
}));
vi.mock("@/lib/client", () => ({ trackStoreEvent: vi.fn() }));

vi.mock("../components/item-detail-modal", () => ({ ItemDetailModal: nothing }));
vi.mock("../components/business-hero", () => ({ BusinessHero: nothing }));
/** The catalog, reduced to one door: add the service to the cart. */
vi.mock("../components/catalog-grid", () => ({
  CatalogGrid: ({ addToCart }: { addToCart: (item: Record<string, unknown>) => void }) => {
    const { quantity: _quantity, ...item } = SERVICE;
    return <button type="button" onClick={() => addToCart({ ...item, purchasable: true })}>Add {SERVICE.name}</button>;
  },
}));
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
/** The cart drawer, reduced to its checkout door and a remove door per line. */
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
/** The checkout form, reduced to the submit it makes: the cart's one service, booked for a slot by `form`'s customer. */
vi.mock("../components/checkout-flow", () => ({
  CheckoutFlow: ({ cart, onSubmit }: { cart: Array<{ id: string; itemType: string }>; onSubmit: (d: unknown) => Promise<void> }) => (
    <button
      type="button"
      onClick={() => {
        void onSubmit({
          serviceBookings: Object.fromEntries(
            cart.map((c) => [`${c.id}_${c.itemType}`, { serviceId: c.id, serviceName: "v95q Consultation", staffId: "", date: "2026-12-01", time: "10:00" }]),
          ),
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone,
          paymentMethod: form.paymentMethod,
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

let openSpy: MockInstance<typeof window.open>;

beforeEach(() => {
  net.posts = [];
  net.bookingAnswer = {};
  net.orderAnswer = null;
  Object.assign(form, DEFAULT_FORM);
  window.localStorage.clear();
  window.localStorage.setItem(`kf_cart_${SLUG}`, JSON.stringify([SERVICE]));
  openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  openSpy.mockRestore();
  window.localStorage.clear();
});

/** Opens the storefront, checks out the cart's service and waits for the confirmation. */
async function bookTheService() {
  render(<PublicBookingPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Checkout" }, { timeout: 3000 }));
  fireEvent.click(await screen.findByRole("button", { name: "Place booking" }));
  await waitFor(() => expect(net.posts.filter((p) => p.path === `/bookings/public/businesses/${BUSINESS.id}`)).toHaveLength(1));
  // The confirmation is on screen (the success heading OrderConfirmation shows).
  await screen.findByRole("heading", { name: "Booking Confirmed!" }, { timeout: 3000 });
}

const TOKEN_LINK = "https://app.v95q.test/public/invoice/v95qTokenInvoiceLinkAbcdefgh";
const DEPOSIT_LINK = "https://app.v95q.test/public/invoice/v95qTokenDepositLinkAbcdefgh";

describe("CR-V28-3: the storefront confirmation opens the token link the booking create answers", () => {
  it("CR-V28-3: the storefront /book/[slug] passes the create answer's invoiceUrl / depositInvoiceUrl into bookingResults, so its confirmation shows the token invoice button (W9-WEB-COMMERCE-NAV, was it.todo)", async () => {
    // A service invoiced at booking: the create answers the invoice's token link.
    net.bookingAnswer = { success: true, bookingId: "v95q_bk_1", invoiceId: "v95q_inv_1", invoiceUrl: TOKEN_LINK };
    await bookTheService();
    fireEvent.click(await screen.findByRole("button", { name: "View invoice and receipt" }, { timeout: 3000 }));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(TOKEN_LINK, "_blank", "noopener,noreferrer");
    cleanup();
    openSpy.mockClear();
    net.posts = [];
    window.localStorage.setItem(`kf_cart_${SLUG}`, JSON.stringify([SERVICE]));

    // A deposit service: the create answers no invoiceUrl, only the deposit's token link.
    net.bookingAnswer = { success: true, bookingId: "v95q_bk_2", depositInvoiceId: "v95q_dep_1", depositInvoiceUrl: DEPOSIT_LINK };
    await bookTheService();
    fireEvent.click(await screen.findByRole("button", { name: "View invoice and receipt" }, { timeout: 3000 }));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(DEPOSIT_LINK, "_blank", "noopener,noreferrer");
  });

  it("CR-V28-3 control: a booking the create answers with no token link shows no invoice button and opens nothing (W9-WEB-COMMERCE-NAV)", async () => {
    net.bookingAnswer = { success: true, bookingId: "v95q_bk_3" };
    await bookTheService();
    expect(screen.queryByRole("button", { name: "View invoice and receipt" })).not.toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
  });
});

/**
 * SEC-W9WCN-1 (W9-WEB-COMMERCE-NAV review; D-07: the token link is the
 * customer's own). A mixed cart books its services first and then places the
 * store order. When that order's payment fails, or the provider redirect is
 * abandoned, the bookings already made are kept (completedBookingResults, and
 * the kf_pending_checkout record for a redirect) so the same customer who
 * comes back (Try Again, or Back to Shop and another payment method) is not
 * booked twice. The next checkout reused them whoever it was for: it booked
 * nothing for the next customer in that tab or browser and showed them the
 * first customer's /public/invoice/<token> page. The kept bookings now go only
 * to the same customer booking the same services; the pending-checkout record
 * holds no token link; a completed checkout keeps nothing.
 */
const BOOK_PATH = `/bookings/public/businesses/${BUSINESS.id}`;
const ORDER_PATH = `/site/storefront/public/${SLUG}/checkout`;
const PENDING_KEY = `kf_pending_checkout_${SLUG}`;
const bookingPosts = () => net.posts.filter((p) => p.path === BOOK_PATH);
const orderPosts = () => net.posts.filter((p) => p.path === ORDER_PATH);
const ALPHA_LINK = "https://app.v95q.test/public/invoice/v95qCustomerAlphaLinkAbcdefgh";
const BRAVO_LINK = "https://app.v95q.test/public/invoice/v95qCustomerBravoLinkAbcdefgh";
/** The next customer: another person at the same browser. */
const CUSTOMER_B = { firstName: "Bee", lastName: "Other", email: "v95q_other@example.test", phone: "", paymentMethod: "cash" };
const ALPHA_BOOKING = { success: true, bookingId: "v95q_bk_alpha", invoiceId: "v95q_inv_alpha", invoiceUrl: ALPHA_LINK };
const BRAVO_BOOKING = { success: true, bookingId: "v95q_bk_bravo", invoiceId: "v95q_inv_bravo", invoiceUrl: BRAVO_LINK };
function storeOrder(payment: Record<string, unknown> | null) {
  return {
    order: {
      id: "v95q_ord_1", orderNumber: "ORD-V95Q-1", status: "PENDING", paymentStatus: "UNPAID",
      subtotal: 50, shippingFee: 0, taxAmount: 0, discountAmount: 0, total: 50, currency: "TTD", items: [],
    },
    payment,
  };
}

/** Opens the checkout from the storefront and submits it as `form`'s customer. */
async function checkOut() {
  fireEvent.click(await screen.findByRole("button", { name: "Checkout" }, { timeout: 3000 }));
  fireEvent.click(await screen.findByRole("button", { name: "Place booking" }));
}

/** Customer A (the default form) checks out the mixed cart with WiPay; the booking answers A's token link. */
async function alphaChecksOutTheMixedCart(payment: Record<string, unknown>) {
  window.localStorage.setItem(`kf_cart_${SLUG}`, JSON.stringify([SERVICE, PRODUCT]));
  Object.assign(form, { paymentMethod: "wipay" });
  net.bookingAnswer = ALPHA_BOOKING;
  net.orderAnswer = storeOrder(payment);
  render(<PublicBookingPage />);
  await checkOut();
  await waitFor(() => expect(orderPosts()).toHaveLength(1));
  expect(bookingPosts()).toHaveLength(1);
}

describe("SEC-W9WCN-1: a checkout's booking token link never reaches the next customer's checkout (W9-WEB-COMMERCE-NAV review, D-07)", () => {
  it("SEC-W9WCN-1: after a mixed cart's product payment fails, Back to Shop and another customer's service checkout books that customer's own service and opens only their own token link (W9-WEB-COMMERCE-NAV)", async () => {
    await alphaChecksOutTheMixedCart({ status: "FAILED" });
    await screen.findByRole("heading", { name: "Payment Failed" }, { timeout: 3000 });

    // A leaves; B, in the same tab, drops the product and books the service for themselves.
    fireEvent.click(screen.getByRole("button", { name: "Back to Shop" }));
    fireEvent.click(await screen.findByRole("button", { name: `Remove ${PRODUCT.name}` }));
    Object.assign(form, CUSTOMER_B);
    net.bookingAnswer = BRAVO_BOOKING;
    await checkOut();
    await screen.findByRole("heading", { name: "Booking Confirmed!" }, { timeout: 3000 });

    // B's service is booked for B (it was skipped, and B was shown A's booking).
    expect(bookingPosts()).toHaveLength(2);
    expect((bookingPosts()[1].body as { email?: string }).email).toBe(CUSTOMER_B.email);
    fireEvent.click(screen.getByRole("button", { name: "View invoice and receipt" }));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(BRAVO_LINK, "_blank", "noopener,noreferrer");
    expect(openSpy.mock.calls.flat()).not.toContain(ALPHA_LINK);
  });

  it("SEC-W9WCN-1: a provider redirect leaves no token link in the kf_pending_checkout record, and the next visitor's service checkout books their own service and opens only their own link (W9-WEB-COMMERCE-NAV)", async () => {
    await alphaChecksOutTheMixedCart({ status: "PENDING", redirectUrl: "https://pay.v95q.test/checkout/v95q_session" });
    await waitFor(() => expect(window.localStorage.getItem(PENDING_KEY)).not.toBeNull());
    const record = window.localStorage.getItem(PENDING_KEY) ?? "";
    expect(record).not.toContain(ALPHA_LINK);
    // The record still names the booking made, so the same customer who returns is not booked twice.
    expect(JSON.parse(record).bookingResults).toEqual([{ bookingId: "v95q_bk_alpha", invoiceId: "v95q_inv_alpha" }]);
    cleanup();

    // The next visitor of this browser: the page restores the pending checkout; they go back to the shop.
    render(<PublicBookingPage />);
    await screen.findByRole("heading", { name: "Payment Processing" }, { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "Back to Shop" }));
    fireEvent.click(await screen.findByRole("button", { name: `Remove ${PRODUCT.name}` }));
    Object.assign(form, CUSTOMER_B);
    net.bookingAnswer = BRAVO_BOOKING;
    await checkOut();
    await screen.findByRole("heading", { name: "Booking Confirmed!" }, { timeout: 3000 });

    expect(bookingPosts()).toHaveLength(2);
    expect((bookingPosts()[1].body as { email?: string }).email).toBe(CUSTOMER_B.email);
    fireEvent.click(screen.getByRole("button", { name: "View invoice and receipt" }));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(BRAVO_LINK, "_blank", "noopener,noreferrer");
    expect(openSpy.mock.calls.flat()).not.toContain(ALPHA_LINK);
  });

  it("SEC-W9WCN-1 control: the same customer back from a failed payment (Back to Shop, another payment method) reuses the booking already made, so the service is not booked twice (W9-WEB-COMMERCE-NAV)", async () => {
    await alphaChecksOutTheMixedCart({ status: "FAILED" });
    await screen.findByRole("heading", { name: "Payment Failed" }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Back to Shop" }));
    Object.assign(form, { paymentMethod: "cash" });
    net.bookingAnswer = BRAVO_BOOKING;
    net.orderAnswer = storeOrder(null);
    await checkOut();
    await screen.findByRole("heading", { name: "Order Placed!" }, { timeout: 3000 });

    expect(orderPosts()).toHaveLength(2);
    expect(bookingPosts()).toHaveLength(1);
  });

  it("SEC-W9WCN-1 control: the same customer back from an abandoned provider redirect reuses the booking the pending-checkout record names (W9-WEB-COMMERCE-NAV)", async () => {
    await alphaChecksOutTheMixedCart({ status: "PENDING", redirectUrl: "https://pay.v95q.test/checkout/v95q_session" });
    await waitFor(() => expect(window.localStorage.getItem(PENDING_KEY)).not.toBeNull());
    cleanup();

    render(<PublicBookingPage />);
    await screen.findByRole("heading", { name: "Payment Processing" }, { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "Back to Shop" }));
    Object.assign(form, { paymentMethod: "cash" });
    net.bookingAnswer = BRAVO_BOOKING;
    net.orderAnswer = storeOrder(null);
    await checkOut();
    await screen.findByRole("heading", { name: "Order Placed!" }, { timeout: 3000 });

    expect(orderPosts()).toHaveLength(2);
    expect(bookingPosts()).toHaveLength(1);
  });

  it("SEC-W9WCN-1: the same customer who drops the product completes with the booking already made (their own link), and a later checkout in that tab books afresh (W9-WEB-COMMERCE-NAV)", async () => {
    await alphaChecksOutTheMixedCart({ status: "FAILED" });
    await screen.findByRole("heading", { name: "Payment Failed" }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Back to Shop" }));
    fireEvent.click(await screen.findByRole("button", { name: `Remove ${PRODUCT.name}` }));
    Object.assign(form, { paymentMethod: "cash" });
    net.bookingAnswer = BRAVO_BOOKING;
    await checkOut();
    await screen.findByRole("heading", { name: "Booking Confirmed!" }, { timeout: 3000 });
    expect(bookingPosts()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "View invoice and receipt" }));
    expect(openSpy).toHaveBeenLastCalledWith(ALPHA_LINK, "_blank", "noopener,noreferrer");

    // That checkout completed: the next one (here, B's) keeps nothing from it.
    fireEvent.click(screen.getByRole("button", { name: "Continue Shopping" }));
    fireEvent.click(await screen.findByRole("button", { name: `Add ${SERVICE.name}` }));
    Object.assign(form, CUSTOMER_B);
    await checkOut();
    await screen.findByRole("heading", { name: "Booking Confirmed!" }, { timeout: 3000 });
    expect(bookingPosts()).toHaveLength(2);
    openSpy.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "View invoice and receipt" }));
    expect(openSpy).toHaveBeenCalledWith(BRAVO_LINK, "_blank", "noopener,noreferrer");
  });
});
