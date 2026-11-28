/**
 * P231 TRUST-BADGES-TRUE-ONLY (owner ruling D-303): customer pages make no trust claim the product does not verify.
 *
 * Removed: "Trusted Platform"; every owner-picked trust rail ("Verified Business", "Instant Booking", "Secure
 * Checkout", "Fast Delivery", "Custom Support", "Digital Delivery": the product checks none); the default rail's
 * "Secure Checkout", "Instant Confirmation" (a booking can wait for the owner) and "Secure Payments" (an owner toggle,
 * whatever is connected); the item details' "Secure Booking" and "Instant Confirmation"; the product page's "Secure
 * Checkout", "Instant Confirmation" and "Trusted Platform"; the order confirmation's "Secured by KeyFlowOS"; the
 * public booking form's "Secure & Encrypted" and "Instant confirmation". The owner's Trust Rails picker is hidden.
 *
 * Kept, each only when true: "Payments by <gateway>" when the server's public gateway list for this storefront and
 * currency lists it (the checkout's own read); "N Orders Completed" (the server's count); "Today: <hours>" (the
 * owner's hours); "SSL Encrypted" only on a page served over https.
 *
 * Mounted on the real components; only the HTTP edge (lib/api's apiGet) and next/navigation are stubbed.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet, apiPost: api.apiPost };
});
vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  return { ...actual, trackStoreEvent: vi.fn() };
});
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ slug: "pepper-co", productId: "prod_true_1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/book/pepper-co",
}));

import { TrustBar, SecurityFooter } from "../components/trust-bar";
import { ItemDetailModal } from "../components/item-detail-modal";
import { OrderConfirmation } from "../components/order-confirmation";
import ProductPage from "../product/[productId]/page";
import PublicBookPage from "../../../public/book/page";
import { MerchandisingPanel } from "../../../app/store/components/merchandising-panel";
import type { TrustRailItem } from "@/lib/client";

beforeAll(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } });
});
afterEach(() => {
  cleanup();
  api.apiGet.mockReset();
});

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const ALL_RAILS: TrustRailItem[] = ["secure_checkout", "fast_delivery", "verified_business", "instant_booking", "custom_support", "digital_delivery"];
const UNVERIFIED = [
  "Trusted Platform", "Verified Business", "Instant Booking", "Instant Confirmation", "Secure Booking", "Secured by KeyFlowOS",
  "Secure Checkout", "Secure Payments", "Fast Delivery", "Custom Support", "Digital Delivery", "Secure & Encrypted",
];
const expectNoneOf = (claims: string[], where: string) => {
  for (const claim of claims) expect(text(), `${where} says '${claim}'`).not.toMatch(new RegExp(claim.replace(/[&]/g, "\\&"), "i"));
};

function gateways(list: string[] | null) {
  api.apiGet.mockImplementation(async (path: string) =>
    path.startsWith("/site/storefront/public/pepper-co/gateways") ? { data: list, error: list ? null : "failed" } : { data: null, error: null },
  );
}

describe("the trust bar", () => {
  it("renders none of the owner-picked rails", () => {
    render(<TrustBar primaryColor="#f97316" secondaryColor="#0ea5e9" configuredRails={ALL_RAILS} />);
    expectNoneOf(UNVERIFIED, "the trust bar (owner rails)");
  });

  it("its defaults claim no secure checkout, no instant confirmation and no secure payments", () => {
    render(<TrustBar primaryColor="#f97316" secondaryColor="#0ea5e9" showPaymentBadge />);
    expectNoneOf(UNVERIFIED, "the trust bar (defaults)");
  });

  it("keeps the true statements: the completed-order count and today's hours", () => {
    render(<TrustBar primaryColor="#f97316" secondaryColor="#0ea5e9" completedOrdersCount={42} businessHoursToday="09:00 – 17:00" />);
    expect(text()).toMatch(/42\+ Orders Completed/);
    expect(text()).toMatch(/Today: 09:00 – 17:00/);
  });

  it("says 'Payments by WiPay' only when the storefront's gateway list has WiPay", async () => {
    gateways([{ id: "wipay" } as never]);
    render(<TrustBar primaryColor="#f97316" secondaryColor="#0ea5e9" showPaymentBadge slug="pepper-co" currency="TTD" />);
    await waitFor(() => expect(text()).toMatch(/Payments by WiPay/));
    expect(text()).not.toMatch(/PayPal/);
    expect(api.apiGet.mock.calls.some((c) => String(c[0]).startsWith("/site/storefront/public/pepper-co/gateways?currency=TTD"))).toBe(true);
  });

  it("names both gateways when both are connected", async () => {
    gateways([{ id: "wipay" }, { id: "paypal" }] as never);
    render(<TrustBar primaryColor="#f97316" secondaryColor="#0ea5e9" showPaymentBadge slug="pepper-co" currency="TTD" />);
    await waitFor(() => expect(text()).toMatch(/Payments by WiPay and PayPal/));
  });

  it.each([
    ["no gateway connected", []],
    ["the gateway read failed", null],
  ])("says no 'Payments by' when %s", async (_what, list) => {
    gateways(list as string[] | null);
    render(<TrustBar primaryColor="#f97316" secondaryColor="#0ea5e9" showPaymentBadge slug="pepper-co" currency="TTD" />);
    await waitFor(() => expect(api.apiGet).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(text()).not.toMatch(/Payments by/);
    expectNoneOf(UNVERIFIED, "the trust bar");
  });

  it("the owner can still hide the payments line", async () => {
    gateways([{ id: "wipay" } as never]);
    render(<TrustBar primaryColor="#f97316" secondaryColor="#0ea5e9" showPaymentBadge={false} slug="pepper-co" currency="TTD" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(text()).not.toMatch(/Payments by/);
  });
});

describe("the store footer", () => {
  it("says no 'Trusted Platform', and 'SSL Encrypted' only on a page served over https", () => {
    render(<SecurityFooter primaryColor="#f97316" businessName="Pepper Co" />);
    expectNoneOf(["Trusted Platform"], "the footer");
    expect(window.location.protocol).toBe("http:");
    expect(text()).not.toMatch(/SSL Encrypted/);
    cleanup();
    render(<SecurityFooter primaryColor="#f97316" businessName="Pepper Co" servedOverHttps />);
    expect(text()).toMatch(/SSL Encrypted/);
    expect(text()).toMatch(/Powered by KeyFlowOS/);
  });
});

describe("item details, order confirmation, product page, public booking form", () => {
  it("the item details claim no secure booking and no instant confirmation", () => {
    render(
      <ItemDetailModal
        item={{ id: "prod_true_1", name: "Scorpion pepper sauce", description: "Made in Trinidad", price: 45, currency: "TTD", duration: null, imageUrl: null, itemType: "product", requiresBooking: false }}
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
    expect(text()).toContain("Scorpion pepper sauce");
    expectNoneOf(UNVERIFIED, "the item details");
  });

  it("the order confirmation does not say 'Secured by KeyFlowOS'", () => {
    render(
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
        onContinueShopping={() => {}}
        formatDate={(d) => d}
        formatTime={(t) => t}
      />,
    );
    expect(text()).toContain("Pepper Co");
    expectNoneOf(UNVERIFIED, "the order confirmation");
  });

  it("the product page claims none of them", async () => {
    const BUSINESS = { id: "biz_true_1", name: "Pepper Co", slug: "pepper-co", currency: "TTD", timezone: "America/Port_of_Spain", storeEnabled: true };
    const PRODUCT = {
      id: "prod_true_1", name: "Scorpion pepper sauce", description: "Made in Trinidad", price: 45, currency: "TTD",
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
    expect(text()).toContain("Made in Trinidad");
    expectNoneOf(UNVERIFIED, "the product page");
    expect(text()).not.toMatch(/SSL Encrypted/); // jsdom serves over http
  });

  it("the public booking form claims no 'Secure & Encrypted' and no 'Instant confirmation'", () => {
    render(<PublicBookPage />);
    expectNoneOf(UNVERIFIED, "the public booking form");
  });
});

describe("the owner's store editor", () => {
  it("offers no Trust Rails picker", () => {
    render(<MerchandisingPanel config={{ merchandising: { trustRails: ["verified_business"] } } as never} products={[]} services={[]} onConfigChange={vi.fn()} onSave={vi.fn()} saving={false} />);
    expect(screen.queryByText("Trust Rails")).toBeNull();
    expect(screen.queryByText("Verified Business")).toBeNull();
  });
});
