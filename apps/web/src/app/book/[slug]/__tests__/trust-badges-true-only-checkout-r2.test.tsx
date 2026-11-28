/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 2 (R2-1): the checkout's PayPal method says what it is, not that it is
 * secure: "Pay with your PayPal account", not "Pay securely with your PayPal account".
 *
 * Only lib/api's apiGet (the storefront gateway list: WiPay and PayPal) and next/navigation are stubbed.
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

function openCheckout(currency = "TTD") {
  api.apiGet.mockImplementation(async (path: string) =>
    path.startsWith("/site/storefront/public/pepper-co/gateways") ? { data: [{ id: "wipay" }, { id: "paypal" }], error: null } : { data: [], error: null },
  );
  render(
    <CheckoutFlow
      business={{ id: "biz_true_co", name: "Pepper Co", slug: "pepper-co", timezone: "America/Port_of_Spain", currency: "TTD" }}
      cart={[{ id: "pkg_true_1", name: "Pepper sauce gift box", price: 45, currency, itemType: "package", requiresBooking: false, quantity: 1 }]}
      staff={[]}
      primaryColor="#f97316"
      secondaryColor="#0ea5e9"
      accentColor="#22c55e"
      cartTotal={45}
      cartCurrency={currency}
      promoCode={null}
      shippingZones={[]}
      onBack={vi.fn()}
      onUpdateQuantity={vi.fn()}
      onSubmit={vi.fn(async () => undefined)}
    />,
  );
}

describe("the checkout's PayPal method", () => {
  it("reads 'Pay with your PayPal account', with no 'securely'", async () => {
    openCheckout("USD");
    fireEvent.change(screen.getByPlaceholderText("John"), { target: { value: "Cee" } });
    fireEvent.change(screen.getByPlaceholderText("john@example.com"), { target: { value: "cee@test.local" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText(/I agree to the terms of service/)).toBeTruthy());
    await waitFor(() => expect(text()).toMatch(/Pay with your PayPal account/));
    expect(text()).not.toMatch(/securely/i);
  });
});
