/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 1 (acceptance reviews at bed0f8f, MAJOR-1, the checkout part): the real
 * CheckoutFlow makes no security claim the product does not verify.
 *
 *   details step  no "Your information is kept private and secure"
 *   payment step  no "Secure Checkout" and no "Encrypted" badges
 *   footer        "Powered by KeyFlowOS" only, no "· Secure Checkout"
 *
 * Only lib/api's apiGet (the storefront gateway list) and next/navigation are stubbed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

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
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({ slug: "pepper-co" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/book/pepper-co",
}));

import { CheckoutFlow } from "../components/checkout-flow";

afterEach(() => {
  cleanup();
  api.apiGet.mockReset();
});

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

function openCheckout() {
  api.apiGet.mockImplementation(async (path: string) =>
    path.startsWith("/site/storefront/public/pepper-co/gateways") ? { data: [{ id: "wipay" }], error: null } : { data: [], error: null },
  );
  render(
    <CheckoutFlow
      business={{ id: "biz_true_co", name: "Pepper Co", slug: "pepper-co", timezone: "America/Port_of_Spain", currency: "TTD" }}
      cart={[{ id: "pkg_true_1", name: "Pepper sauce gift box", price: 45, currency: "TTD", itemType: "package", requiresBooking: false, quantity: 1 }]}
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
}

describe("the checkout", () => {
  it("the details step says no 'kept private and secure', and the footer only 'Powered by KeyFlowOS'", () => {
    openCheckout();
    expect(screen.getByPlaceholderText("John")).toBeTruthy(); // the details step
    expect(text()).not.toMatch(/private and secure/i);
    expect(text()).toMatch(/Powered by KeyFlowOS/);
    expect(text()).not.toMatch(/Secure Checkout/i);
  });

  it("the payment step shows no 'Secure Checkout' or 'Encrypted' badges", async () => {
    openCheckout();
    fireEvent.change(screen.getByPlaceholderText("John"), { target: { value: "Cee" } });
    fireEvent.change(screen.getByPlaceholderText("john@example.com"), { target: { value: "cee@test.local" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText(/I agree to the terms of service/)).toBeTruthy());
    expect(text()).toMatch(/WiPay/); // the payment step, with the connected gateway
    expect(text()).not.toMatch(/Secure Checkout/i);
    expect(text()).not.toMatch(/Encrypted/i); // no word boundary: textContent runs "…applied.EncryptedBack" together
    expect(text()).toMatch(/Powered by KeyFlowOS/);
  });
});
