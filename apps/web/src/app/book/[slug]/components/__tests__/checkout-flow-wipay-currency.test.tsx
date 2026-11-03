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
 *   CFW-02  control: a TTD cart lists WiPay, still the default
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

import { CheckoutFlow } from "../checkout-flow";
import type { Business, CartItem } from "../types";

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

  it("CFW-02: control: a TTD cart lists WiPay, and it is still the default", async () => {
    const onSubmit = toPaymentStep("TTD");
    expect(wipayOption()).not.toBeNull();

    fireEvent.click(screen.getByText(/I agree to the terms of service/));
    fireEvent.click(screen.getByRole("button", { name: /Place Order/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [data] = onSubmit.mock.calls[0] as unknown as [{ paymentMethod: string }];
    expect(data.paymentMethod).toBe("wipay");
  });
});
