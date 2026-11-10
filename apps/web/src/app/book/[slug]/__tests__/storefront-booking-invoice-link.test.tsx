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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const { SLUG, BUSINESS, nothing, passthrough } = vi.hoisted(() => ({
  SLUG: "v95q-shop",
  BUSINESS: { id: "v95q_biz_1", name: "v95q Studio", slug: "v95q-shop", currency: "TTD", storeEnabled: true },
  /** The storefront's sections, none of which the checkout result passes through. */
  nothing: () => null,
  passthrough: ({ children }: { children?: ReactNode }) => children ?? null,
}));
const SERVICE = {
  id: "v95q_svc_1",
  name: "v95q Consultation",
  price: 100,
  currency: "TTD",
  itemType: "service" as const,
  requiresBooking: true,
  quantity: 1,
};

const net = vi.hoisted(() => ({
  bookingAnswer: {} as Record<string, unknown>,
  posts: [] as Array<{ path: string; body: unknown }>,
}));

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
/** The cart drawer, reduced to its checkout door. */
vi.mock("../components/cart-drawer", () => ({
  CartDrawer: ({ onCheckout }: { onCheckout: () => void }) => (
    <button type="button" onClick={onCheckout}>Checkout</button>
  ),
}));
/** The checkout form, reduced to the submit it makes: the cart's one service, booked for a slot. */
vi.mock("../components/checkout-flow", () => ({
  CheckoutFlow: ({ cart, onSubmit }: { cart: Array<{ id: string; itemType: string }>; onSubmit: (d: unknown) => Promise<void> }) => (
    <button
      type="button"
      onClick={() => {
        void onSubmit({
          serviceBookings: Object.fromEntries(
            cart.map((c) => [`${c.id}_${c.itemType}`, { serviceId: c.id, serviceName: "v95q Consultation", staffId: "", date: "2026-12-01", time: "10:00" }]),
          ),
          firstName: "Vee",
          lastName: "Customer",
          email: "v95q_customer@example.test",
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

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  net.posts = [];
  net.bookingAnswer = {};
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
