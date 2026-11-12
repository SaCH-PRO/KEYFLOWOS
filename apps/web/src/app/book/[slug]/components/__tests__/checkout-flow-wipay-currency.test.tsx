/**
 * Trial-N repair round 2, recheck G6PUB-RC1-1 (D-69): the public storefront
 * checkout offers WiPay only for a TTD cart.
 *
 * D-69: a WiPay checkout for an amount not in TTD answers 400 and WiPay is not
 * offered for it, until WiPay's currency parameter is verified from its docs.
 * The checkout listed WiPay for every cart, as the default choice, so a USD
 * customer who kept the default was sent to a checkout the server refuses.
 *
 *   CFW-01  a USD cart: the payment step lists no WiPay, and an order placed
 *           with the default choice is not a WiPay order
 *   CFW-02  control: a TTD cart of a business with a WiPay merchant pair lists
 *           WiPay, still the default
 *
 * G6PUB-R3-STORE-ORDER-DOORS (recheck G6PUB-RC2-4): WiPay was listed, as the
 * default, for every TTD cart, also for a business with no WiPay merchant pair,
 * whose WiPay checkout the server refuses after the order is written.
 *
 *   CFW-03  the checkout asks the server which gateways the storefront takes
 *           for the cart's currency (GET /site/storefront/public/:slug/gateways)
 *   CFW-04  a TTD cart of a business with no WiPay merchant pair lists no WiPay,
 *           and the default choice places no WiPay order
 *   CFW-05  while the answer is pending, or when it fails, WiPay is not offered
 *           and is never the silent default
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const apiGet = vi.fn();
vi.mock("@/lib/api", () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
}));

import { CheckoutFlow } from "../checkout-flow";
import type { Business, CartItem } from "../types";

/** The storefront's gateway list as the server answers it (PaymentsService.getAvailableGateways). */
function serveGateways(ids: string[]) {
  apiGet.mockImplementation(async (path: string) => {
    if (path.startsWith("/site/storefront/public/cfw-store/gateways")) {
      return { data: ids.map((id) => ({ id, name: id, currencies: id === "wipay" ? ["TTD"] : ["USD"] })), error: null };
    }
    return { data: null, error: "unexpected path" };
  });
}

beforeEach(() => {
  apiGet.mockReset();
  // The business of CFW-01/02 has a WiPay merchant pair; WiPay is listed for its TTD amounts only (D-69).
  serveGateways(["wipay", "paypal"]);
});

function business(currency: string): Business {
  return { id: "biz_cfw", name: "CFW Store", slug: "cfw-store", timezone: "America/Port_of_Spain", currency };
}

function cartOf(currency: string): CartItem[] {
  return [
    {
      id: "pkg_cfw",
      name: "CFW Bundle",
      price: 40,
      currency,
      itemType: "package",
      requiresBooking: false,
      quantity: 2,
    },
  ];
}

/** Renders the checkout, fills the information step and continues to the payment step. */
function toPaymentStep(currency: string, onSubmit = vi.fn(async () => undefined)) {
  render(
    <CheckoutFlow
      business={business(currency)}
      cart={cartOf(currency)}
      staff={[]}
      primaryColor="#112233"
      secondaryColor="#445566"
      accentColor="#778899"
      cartTotal={80}
      cartCurrency={currency}
      promoCode={null}
      shippingZones={[]}
      onBack={vi.fn()}
      onUpdateQuantity={vi.fn()}
      onSubmit={onSubmit}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText("John"), { target: { value: "Cee" } });
  fireEvent.change(screen.getByPlaceholderText("john@example.com"), { target: { value: "cfw@test.local" } });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
  return onSubmit;
}

const wipayOption = () => screen.queryByRole("button", { name: /WiPay/ });

afterEach(() => {
  cleanup();
  try { window.localStorage.clear(); } catch { /* best-effort */ }
});

describe("storefront checkout: WiPay only for a TTD cart (D-69, G6PUB-RC1-1)", () => {
  it("CFW-01: a USD cart lists no WiPay, and the default choice places no WiPay order", async () => {
    const onSubmit = toPaymentStep("USD");
    expect(screen.getByRole("button", { name: /PayPal/ })).toBeInTheDocument();
    // At c549a12f: WiPay is listed for a USD cart, and it is the default choice.
    expect(wipayOption(), "WiPay is not offered for a USD cart").toBeNull();

    fireEvent.click(screen.getByText(/I agree to the terms of service/));
    fireEvent.click(screen.getByRole("button", { name: /Place Order/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [data] = onSubmit.mock.calls[0] as unknown as [{ paymentMethod: string }];
    expect(data.paymentMethod, "the order is not sent to WiPay").not.toBe("wipay");
  });

  it("CFW-02: control: a TTD cart of a business with a WiPay merchant pair lists WiPay, and it is still the default", async () => {
    const onSubmit = toPaymentStep("TTD");
    expect(await screen.findByRole("button", { name: /WiPay/ })).toBeInTheDocument();

    fireEvent.click(screen.getByText(/I agree to the terms of service/));
    fireEvent.click(screen.getByRole("button", { name: /Place Order/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [data] = onSubmit.mock.calls[0] as unknown as [{ paymentMethod: string }];
    expect(data.paymentMethod).toBe("wipay");
  });
});

describe("storefront checkout: WiPay only where the business can take it (G6PUB-RC2-4)", () => {
  it("CFW-03: the checkout asks the server which gateways the storefront takes for the cart's currency", async () => {
    toPaymentStep("TTD");
    // At 9f09d6c8: the checkout asked nothing; WiPay was listed for every TTD cart.
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    const paths = apiGet.mock.calls.map(([p]) => String(p));
    expect(paths).toContain("/site/storefront/public/cfw-store/gateways?currency=TTD");
  });

  it("CFW-04: a TTD cart of a business with no WiPay merchant pair lists no WiPay, and the default choice places no WiPay order", async () => {
    serveGateways(["paypal"]);
    const onSubmit = toPaymentStep("TTD");
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /PayPal/ })).toBeInTheDocument();
    // At 9f09d6c8: WiPay is listed and is the default (the server then refuses it after writing the order).
    await waitFor(() => expect(wipayOption(), "WiPay is not offered").toBeNull());

    fireEvent.click(screen.getByText(/I agree to the terms of service/));
    fireEvent.click(screen.getByRole("button", { name: /Place Order/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [data] = onSubmit.mock.calls[0] as unknown as [{ paymentMethod: string }];
    expect(data.paymentMethod, "the order is not sent to WiPay").not.toBe("wipay");
  });

  it.each([
    ["pending", () => apiGet.mockImplementation(() => new Promise(() => undefined))],
    ["failed", () => apiGet.mockResolvedValue({ data: null, error: "Network error" })],
  ])("CFW-05: while the gateway answer is %s, WiPay is not offered and is never the default", async (_label, arrange) => {
    arrange();
    const onSubmit = toPaymentStep("TTD");
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    // At 9f09d6c8: WiPay is listed, as the default, whatever the business takes.
    expect(wipayOption()).toBeNull();

    fireEvent.click(screen.getByText(/I agree to the terms of service/));
    fireEvent.click(screen.getByRole("button", { name: /Place Order/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [data] = onSubmit.mock.calls[0] as unknown as [{ paymentMethod: string }];
    expect(data.paymentMethod).not.toBe("wipay");
  });
});
