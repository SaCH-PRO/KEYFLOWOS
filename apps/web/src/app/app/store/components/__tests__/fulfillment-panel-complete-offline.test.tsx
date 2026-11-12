/**
 * Trial-N repair round 2 (CR-V18-3, V1-33): the store fulfillment panel's
 * Complete offline action.
 *
 * A CASH or MANUAL storefront order is paid only through POST
 * /site/businesses/:businessId/orders/:orderId/complete-offline (revenue
 * write, a member), which writes its invoice, its payment and that payment's
 * posting. The marketplace mark_paid and PATCH paid routes refuse a STOREFRONT
 * order (V18-10), and the web had no caller of complete-offline, so a cash
 * storefront order had no way to PAID from the app.
 *
 * Pinned here, with the panel's data door (@/lib/api) stubbed with
 * server-shaped answers:
 *
 *   FPO-01  an unpaid CASH or MANUAL STOREFRONT order shows "Complete offline";
 *           it calls the site complete-offline route once (no body fields:
 *           the server decides the amount and the recorder) and renders the
 *           order the server answered. Never the marketplace fulfil route
 *   FPO-02  a cash-on-delivery order DELIVERED before its cash was recorded
 *           still shows the action (the server keeps that status, V33-CR-3)
 *   FPO-03  not shown for an order a provider settles (WIPAY), a PAID order,
 *           a STANDARD (marketplace) order, or a cancelled or refunded order
 *           in either status vocabulary
 *   FPO-04  the server's refusal (403: revenue write needed) is shown and the
 *           order is not updated
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const apiPost = vi.fn();
const apiGet = vi.fn();

vi.mock("@/lib/api", () => ({
  apiPost: (...args: unknown[]) => apiPost(...args),
  apiGet: (...args: unknown[]) => apiGet(...args),
}));

import { FulfillmentPanel, type Order } from "../fulfillment-panel";

const BIZ = "biz_fpo";

function orderOf(over: Partial<Order> & Record<string, unknown> = {}): Order {
  return {
    id: "ord_fpo_1",
    orderNumber: "ORD-FPO-1",
    status: "PENDING",
    customerName: "Fee Pee",
    customerEmail: "fpo@test.local",
    total: 80,
    currency: "TTD",
    items: [{ id: "it_1", name: "Widget", quantity: 2, unitPrice: 40, total: 80 }],
    type: "STOREFRONT",
    paymentMethod: "CASH",
    paymentStatus: "PENDING",
    ...over,
  } as Order;
}

const completeOffline = () => screen.queryByRole("button", { name: /Complete offline/i });

beforeEach(() => {
  apiPost.mockReset();
  apiGet.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("store fulfillment panel: Complete offline (CR-V18-3)", () => {
  it("FPO-01: an unpaid CASH storefront order is completed offline through the site route, and the panel renders the order the server answered", async () => {
    const answered = orderOf({ status: "CONFIRMED", paymentStatus: "PAID" });
    apiPost.mockResolvedValue({ data: answered, error: null });
    const onUpdate = vi.fn();
    render(<FulfillmentPanel order={orderOf()} businessId={BIZ} onUpdate={onUpdate} />);

    fireEvent.click(completeOffline()!);

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(answered));
    expect(apiPost).toHaveBeenCalledTimes(1);
    const [{ path, body }] = apiPost.mock.calls[0] as [{ path: string; body?: Record<string, unknown> }];
    expect(path).toBe(`/site/businesses/${BIZ}/orders/ord_fpo_1/complete-offline`);
    expect(body ?? {}).toEqual({});
    expect(apiPost.mock.calls.map((c) => (c[0] as { path: string }).path).some((p) => p.includes("/fulfill"))).toBe(false);
  });

  it("FPO-01b: a MANUAL storefront order (any case) shows the action too", () => {
    render(<FulfillmentPanel order={orderOf({ paymentMethod: "manual", paymentStatus: "UNPAID" })} businessId={BIZ} onUpdate={vi.fn()} />);
    expect(completeOffline()).not.toBeNull();
  });

  it("FPO-02: a cash-on-delivery order delivered before its cash was recorded still shows the action", () => {
    render(<FulfillmentPanel order={orderOf({ status: "DELIVERED" })} businessId={BIZ} onUpdate={vi.fn()} />);
    expect(completeOffline()).not.toBeNull();
  });

  it.each([
    ["an order a provider settles (WIPAY)", { paymentMethod: "WIPAY" }],
    ["a PAID order", { paymentStatus: "PAID" }],
    ["a STANDARD (marketplace) order", { type: "STANDARD" }],
    ["a CANCELLED order", { status: "CANCELLED" }],
    ["a cancelled order (marketplace vocabulary)", { status: "cancelled" }],
    ["a REFUNDED order", { status: "REFUNDED" }],
  ])("FPO-03: no Complete offline for %s", (_label, over) => {
    render(<FulfillmentPanel order={orderOf(over)} businessId={BIZ} onUpdate={vi.fn()} />);
    expect(completeOffline()).toBeNull();
  });

  it("FPO-04: the server's refusal is shown and the order is not updated", async () => {
    apiPost.mockResolvedValue({ data: null, error: "Insufficient permissions: revenue requires write access (you have read)" });
    const onUpdate = vi.fn();
    render(<FulfillmentPanel order={orderOf()} businessId={BIZ} onUpdate={onUpdate} />);

    fireEvent.click(completeOffline()!);

    expect(await screen.findByText(/revenue requires write access/)).toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
