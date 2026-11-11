/**
 * W10-PAYPAL-CURRENCY review PPC-REV-02 (owner ruling D-106): PayPal is not
 * offered for an order in a currency PayPal does not support (TTD, JMD, BBD,
 * GYD, XCD and any other it does not list).
 *
 * The server's storefront gateway list (GET /site/storefront/public/:slug/
 * gateways?currency=, PaymentsService.getAvailableGateways) leaves PayPal out
 * for such a cart (and for a store with no PayPal configured), but the
 * checkout listed PayPal from a static list for every cart: a TTD cart of a
 * store with no WiPay key of its own (D-105) got PayPal as the default choice,
 * and its order was refused 400 PAYPAL_CURRENCY_UNSUPPORTED. The checkout now
 * drops PayPal once the server's list leaves it out. Until the list answers,
 * or when it cannot, PayPal stays listed: the server refuses a PayPal checkout
 * it cannot take before the order is written (StoreOrderService.createOrder,
 * review SEC-W10PPC-1).
 *
 *   CFP-01  a TTD cart whose list carries neither PayPal nor WiPay: neither is
 *           listed, and the default choice places a cash order
 *   CFP-02  a TTD cart whose list carries WiPay only: WiPay is listed and is
 *           the default; PayPal is not listed
 *   CFP-03  PayPal picked before the list answered: once the list leaves it
 *           out it is no longer listed, and the order is not sent to PayPal
 *   CFP-04  a USD cart of a store with no PayPal configured (the list leaves
 *           it out) is not offered PayPal; control: a USD cart whose list
 *           carries PayPal is offered it, as the default
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

const SLUG = "cfp-store";

/** The storefront's gateway list as the server answers it for the cart's currency (PaymentsService.getAvailableGateways). */
function serveGateways(ids: string[], currency: string) {
  apiGet.mockImplementation(async (path: string) => {
    if (path.startsWith(`/site/storefront/public/${SLUG}/gateways`)) {
      return { data: ids.map((id) => ({ id, name: id, currencies: [currency] })), error: null };
    }
    return { data: null, error: "unexpected path" };
  });
}

beforeEach(() => {
  apiGet.mockReset();
});

afterEach(() => {
  cleanup();
  try { window.localStorage.clear(); } catch { /* best-effort */ }
});

function business(currency: string): Business {
  return { id: "biz_cfp", name: "CFP Store", slug: SLUG, timezone: "America/Port_of_Spain", currency };
}

function cartOf(currency: string): CartItem[] {
  return [{ id: "pkg_cfp", name: "CFP Bundle", price: 40, currency, itemType: "package", requiresBooking: false, quantity: 2 }];
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
  fireEvent.change(screen.getByPlaceholderText("john@example.com"), { target: { value: "cfp@test.local" } });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
  return onSubmit;
}

const paypalOption = () => screen.queryByRole("button", { name: /PayPal/ });
const wipayOption = () => screen.queryByRole("button", { name: /WiPay/ });

async function placeOrder(onSubmit: ReturnType<typeof vi.fn>): Promise<string> {
  fireEvent.click(screen.getByText(/I agree to the terms of service/));
  fireEvent.click(screen.getByRole("button", { name: /Place Order/i }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  const [data] = onSubmit.mock.calls[0] as unknown as [{ paymentMethod: string }];
  return data.paymentMethod;
}

describe("storefront checkout: PayPal only where the server lists it (W10-PAYPAL-CURRENCY review PPC-REV-02, D-106)", () => {
  it("CFP-01 (W10-PAYPAL-CURRENCY review PPC-REV-02, D-106): a TTD cart whose gateway list carries neither PayPal nor WiPay lists neither, and the default choice places a cash order", async () => {
    serveGateways([], "TTD");
    const onSubmit = toPaymentStep("TTD");
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    // At 0d9babbe: PayPal is listed, as the default, and the server refuses the order (400 PAYPAL_CURRENCY_UNSUPPORTED).
    await waitFor(() => expect(paypalOption(), "PayPal is not offered for a TTD cart").toBeNull());
    expect(wipayOption()).toBeNull();
    expect(screen.getByRole("button", { name: /Cash \/ Manual Payment/ })).toBeInTheDocument();

    expect(await placeOrder(onSubmit), "the order is not sent to PayPal").toBe("cash");
  });

  it("CFP-02 (W10-PAYPAL-CURRENCY review PPC-REV-02, D-106): a TTD cart whose gateway list carries WiPay only lists WiPay, as the default, and no PayPal", async () => {
    serveGateways(["wipay"], "TTD");
    const onSubmit = toPaymentStep("TTD");
    expect(await screen.findByRole("button", { name: /WiPay/ })).toBeInTheDocument();
    // At 0d9babbe: PayPal is listed beside WiPay.
    expect(paypalOption(), "PayPal is not offered for a TTD cart").toBeNull();

    expect(await placeOrder(onSubmit)).toBe("wipay");
  });

  it("CFP-03 (W10-PAYPAL-CURRENCY review PPC-REV-02, D-106): PayPal picked before the gateway list answered is dropped once the list leaves it out, and the order is not sent to PayPal", async () => {
    let answer: (value: unknown) => void = () => undefined;
    apiGet.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const onSubmit = toPaymentStep("TTD");
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    // Until the list answers PayPal stays listed (the server refuses a PayPal checkout it cannot take before the
    // order is written, SEC-W10PPC-1); the customer picks it.
    fireEvent.click(screen.getByRole("button", { name: /PayPal/ }));

    answer({ data: [], error: null });
    // At 0d9babbe: PayPal stays listed and chosen.
    await waitFor(() => expect(paypalOption(), "PayPal is dropped once the list leaves it out").toBeNull());

    expect(await placeOrder(onSubmit), "the order is not sent to PayPal").not.toBe("paypal");
  });

  it("CFP-04 (W10-PAYPAL-CURRENCY review PPC-REV-02, D-106): a USD cart of a store with no PayPal configured is not offered PayPal; control: a USD cart whose gateway list carries PayPal is offered it, as the default", async () => {
    serveGateways([], "USD");
    const unconfigured = toPaymentStep("USD");
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    // At 0d9babbe: PayPal is listed and is the default (createStorePayment then fails: PayPal is not configured).
    await waitFor(() => expect(paypalOption(), "PayPal is not offered").toBeNull());
    expect(await placeOrder(unconfigured)).toBe("cash");
    cleanup();

    apiGet.mockReset();
    serveGateways(["paypal"], "USD");
    const configured = toPaymentStep("USD");
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: /PayPal/ })).toBeInTheDocument();
    expect(await placeOrder(configured)).toBe("paypal");
  });
});
