/**
 * SWP-BOOKING-SLOTS repair round 6: a customer back from WiPay or PayPal sees exactly the order they placed, and a
 * hand-edited kf_pending_checkout record can neither crash the page nor show made-up amounts.
 *
 * The page writes the record before the provider redirect and restores it on return (restorePendingCheckout). The
 * record outlives the tab, so the restore reads each field only in the shape the page itself writes.
 *
 *   RST-01  a WiPay return shows the exact items (optional fields included), quantities, line totals, total and method
 *   RST-02  a PayPal return with a total of 0 shows 0.00 and PayPal
 *   RST-03  a total that is not a number shows 0.00, never the text it holds
 *   RST-04  a record that is a JSON array or string is removed and ignored
 *   RST-05  hand-edited order number, order id, e-mail, booking refs and item fields never crash the confirmation;
 *           the order id is encoded wherever it goes into a URL
 *   RST-06  order lines with a negative, fractional or zero quantity, or a negative or infinite price, are dropped
 *   RST-07  the confirmation's order link encodes the order id (/, ? and #)
 *   RST-08  a restored line's image renders only from an http(s) or same-site URL; anything else (an object, a
 *           javascript: or data: URL, a //host URL) renders no image
 *   RST-09  an empty or blank order number, order id or e-mail is none: the booking confirmation, no blank Order #
 *           and no blank booking reference
 *   RST-10  a quantity that is not a safe whole number up to 999 (1e21, 1e308, 1000) is dropped, and so is a line
 *           whose total overflows (a finite price times its quantity)
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { SLUG, BUSINESS, nothing, passthrough } = vi.hoisted(() => ({
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

const net = vi.hoisted(() => ({ gets: [] as string[] }));
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
    net.gets.push(path);
    if (path === `/identity/businesses/slug/${SLUG}`) return { data: BUSINESS, error: null };
    if (path.startsWith("/site/storefront/public/order/")) return { data: { paymentStatus: "PAID", status: "CONFIRMED" }, error: null };
    if (path.endsWith("/services") || path.endsWith("/staff") || path.endsWith("/products")) return { data: [], error: null };
    return { data: null, error: null };
  },
  apiPost: async () => ({ data: null, error: "not stubbed" }),
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
import { formatPrice } from "@/lib/format";

const KEY = `kf_pending_checkout_${SLUG}`;
const ITEMS = [
  {
    id: "rst_prd_1", name: "RST Candle", description: null, price: 49.5, currency: "TTD", duration: null, imageUrl: null,
    itemType: "product", requiresBooking: false, stockStatus: "available", purchasable: true, quantity: 1,
  },
  {
    id: "rst_pkg_1", name: "RST Gift Box", description: "two candles", price: 75, currency: "TTD", imageUrl: null,
    itemType: "package", requiresBooking: false, sourceServiceId: "rst_svc_9", stockStatus: "untracked", purchasable: true, quantity: 2,
  },
];
function record(extra: Record<string, unknown>) {
  return JSON.stringify({
    bookingResults: [],
    bookingReuseKey: null,
    orderPayload: null,
    orderNumber: "ORD-RST-1",
    orderId: "rst_ord_1",
    orderTotal: 199.5,
    paymentMethod: "wipay",
    shippingZoneId: null,
    items: ITEMS,
    customerEmail: "rst@example.test",
    confirmedDetails: null,
    ...extra,
  });
}
async function restored(extra: Record<string, unknown>) {
  window.localStorage.setItem(KEY, record(extra));
  render(<PublicBookingPage />);
  await screen.findByRole("heading", { name: "Order Placed!" }, { timeout: 3000 });
}

beforeEach(() => {
  net.gets = [];
  window.localStorage.clear();
  window.localStorage.setItem(`kf_cart_${SLUG}`, JSON.stringify([]));
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("SWP-BOOKING-SLOTS: the restored order is exactly the one placed", () => {
  it("RST-01 a WiPay return shows the exact items, quantities, line totals, total and method", async () => {
    await restored({});
    expect(screen.getByText("RST Candle")).toBeInTheDocument();
    expect(screen.getByText("RST Gift Box")).toBeInTheDocument();
    expect(screen.getByText("x1")).toBeInTheDocument();
    expect(screen.getByText("x2")).toBeInTheDocument();
    expect(screen.getByText(formatPrice(49.5, "TTD"))).toBeInTheDocument();
    expect(screen.getByText(formatPrice(150, "TTD"))).toBeInTheDocument();
    expect(screen.getByText(formatPrice(199.5, "TTD"))).toBeInTheDocument();
    expect(screen.getByText("WiPay (Card)")).toBeInTheDocument();
  });

  it("RST-02 a PayPal return with a total of 0 shows 0.00 and PayPal", async () => {
    await restored({ paymentMethod: "paypal", orderTotal: 0, items: [{ ...ITEMS[0], price: 0 }] });
    expect(screen.getAllByText(formatPrice(0, "TTD")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("PayPal")).toBeInTheDocument();
  });

  it("RST-03 a total that is not a number shows 0.00, never the text it holds", async () => {
    await restored({ orderTotal: "abc" });
    expect(screen.getByText(formatPrice(0, "TTD"))).toBeInTheDocument();
    expect(screen.queryByText(/abc/)).toBeNull();
  });

  it("RST-04 a record that is a JSON array or string is removed and ignored", async () => {
    for (const raw of [JSON.stringify([{ orderNumber: "ORD-X" }]), JSON.stringify("ORD-X")]) {
      window.localStorage.setItem(KEY, raw);
      render(<PublicBookingPage />);
      await waitFor(() => expect(window.localStorage.getItem(KEY)).toBeNull());
      expect(screen.queryByRole("heading", { name: /Order Placed|Confirmed|Failed|Processing/ })).toBeNull();
      cleanup();
    }
  });

  it("RST-05 hand-edited fields never crash the confirmation; the order id is encoded in its URL", async () => {
    // Without an order number that is a string the record is not a store order: the booking confirmation shows.
    const shapes: Array<[Record<string, unknown>, string]> = [
      [{ orderNumber: 123 }, "Booking Confirmed!"],
      [{ orderNumber: {}, orderId: 5, customerEmail: { at: "x" } }, "Booking Confirmed!"],
      [{ bookingResults: [{ bookingId: 7 }, "x", null, { bookingId: "rst_bk_ok" }] }, "Order Placed!"],
      [{ items: [{ ...ITEMS[0], currency: 5, imageUrl: {} }, { ...ITEMS[1], name: 9 }] }, "Order Placed!"],
    ];
    for (const [extra, heading] of shapes) {
      window.localStorage.setItem(KEY, record(extra));
      render(<PublicBookingPage />);
      expect(await screen.findByRole("heading", { name: heading }, { timeout: 3000 }), JSON.stringify(extra)).toBeInTheDocument();
      if ("items" in extra) {
        expect(screen.getByText("RST Candle"), "a line with a bad currency or image keeps its name and amount").toBeInTheDocument();
        expect(screen.getByText(formatPrice(49.5, "TTD"))).toBeInTheDocument();
        expect(screen.queryByText("9"), "a line whose name is not text is dropped").toBeNull();
      }
      cleanup();
    }
    net.gets = [];
    await restored({ orderId: "rst/ord 1?x=1" });
    const statusReads = net.gets.filter((p) => p.startsWith("/site/storefront/public/order/"));
    expect(statusReads).toHaveLength(1);
    expect(statusReads[0].startsWith(`/site/storefront/public/order/${encodeURIComponent("rst/ord 1?x=1")}?email=`)).toBe(true);
  });

  it("RST-06 order lines with a bad quantity or price are dropped", async () => {
    const bad = [
      { ...ITEMS[0], id: "b1", name: "RST Negative Qty", quantity: -3 },
      { ...ITEMS[0], id: "b2", name: "RST Fraction Qty", quantity: 1.5 },
      { ...ITEMS[0], id: "b3", name: "RST Negative Price", price: -30 },
      { ...ITEMS[0], id: "b4", name: "RST Zero Qty", quantity: 0 },
    ];
    window.localStorage.setItem(KEY, record({ items: [...bad, ITEMS[1]] }).replace('"price":75', '"price":1e309'));
    render(<PublicBookingPage />);
    await screen.findByRole("heading", { name: "Order Placed!" }, { timeout: 3000 });
    for (const b of bad) expect(screen.queryByText(b.name), b.name).toBeNull();
    expect(screen.queryByText("RST Gift Box"), "an unbounded price").toBeNull();
    expect(screen.queryByText(/∞|-\s?TTD|TTD\s?-/)).toBeNull();
  });

  it("RST-07 the confirmation's order link encodes the order id", async () => {
    const openSpy: MockInstance<typeof window.open> = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      const id = "rst/ord?x=1#frag";
      await restored({ orderId: id });
      fireEvent.click(screen.getByRole("button", { name: "View order details" }));
      expect(openSpy).toHaveBeenCalledWith(
        `http://api.bsi.test/site/storefront/public/order/${encodeURIComponent(id)}?email=${encodeURIComponent("rst@example.test")}`,
        "_blank",
      );
    } finally {
      openSpy.mockRestore();
    }
  });

  it("RST-08 a restored line's image renders only from an http(s) or same-site URL", async () => {
    const refused: unknown[] = [{ src: "x", width: 1, height: 1 }, "javascript:alert(1)", "data:image/png;base64,AAAA", "//evil.test/x.png", "  "];
    for (const imageUrl of refused) {
      await restored({ items: [{ ...ITEMS[0], imageUrl }] });
      expect(screen.getByText("RST Candle")).toBeInTheDocument();
      expect(screen.queryByRole("img", { name: "RST Candle" }), JSON.stringify(imageUrl)).toBeNull();
      cleanup();
    }
    for (const imageUrl of ["https://cdn.rst.test/candle.png", "http://cdn.rst.test/candle.png", "/images/candle.png"]) {
      await restored({ items: [{ ...ITEMS[0], imageUrl }] });
      expect(screen.getByRole("img", { name: "RST Candle" }).getAttribute("src"), imageUrl).toBe(imageUrl);
      cleanup();
    }
  });

  it("RST-09 an empty or blank order number, order id or e-mail is none", async () => {
    for (const blank of ["", "   "]) {
      window.localStorage.setItem(KEY, record({ orderNumber: blank, orderId: blank, customerEmail: blank }));
      render(<PublicBookingPage />);
      expect(await screen.findByRole("heading", { name: "Booking Confirmed!" }, { timeout: 3000 }), JSON.stringify(blank)).toBeInTheDocument();
      expect(screen.queryByText("Order #")).toBeNull();
      expect(screen.queryByText("Booking Ref:")).toBeNull();
      expect(net.gets.some((p) => p.startsWith("/site/storefront/public/order/")), "no status read for a blank id").toBe(false);
      cleanup();
    }
  });

  it("RST-10 a quantity beyond a safe whole number up to 999, or a line total that overflows, is dropped", async () => {
    const bad = [
      { ...ITEMS[0], id: "q1", name: "RST Huge Qty", quantity: 1e21 },
      { ...ITEMS[0], id: "q2", name: "RST Max Qty", quantity: 1e308 },
      { ...ITEMS[0], id: "q3", name: "RST Thousand Qty", quantity: 1000 },
      { ...ITEMS[0], id: "q4", name: "RST Overflow Total", price: 1e308, quantity: 2 },
    ];
    await restored({ items: [...bad, { ...ITEMS[1], quantity: 999, price: 1 }] });
    for (const b of bad) expect(screen.queryByText(b.name), b.name).toBeNull();
    expect(screen.getByText("RST Gift Box"), "999 is a quantity").toBeInTheDocument();
    expect(screen.queryByText(/∞/)).toBeNull();
  });
});
