/**
 * Trial-N repair round 2, recheck G6PUB-RC1-2 (CR-V18-3, V1-33): Complete
 * offline reaches every unpaid CASH or MANUAL storefront order.
 *
 * The action was mounted only in the Operations snapshot, which shows at most
 * 3 active and 2 completed of the latest 20 orders and kept only uppercase
 * statuses, so an order the panel's own Confirm moved to 'awaiting_payment'
 * left both lists. The full store order list (Performance > Orders) had no such
 * action.
 *
 * Pinned here, with the data door (@/lib/api) stubbed with server-shaped
 * answers:
 *
 *   OCO-01  the store order list offers Complete offline on EVERY unpaid CASH
 *           or MANUAL storefront order (five here, more than the snapshot
 *           shows); it calls the site complete-offline route once with no body
 *           fields and renders the order the server answered
 *   OCO-02  not offered for an order a provider settles (WIPAY), a PAID order,
 *           a STANDARD (marketplace) order, or a cancelled or refunded order
 *   OCO-03  the server's refusal (403) is shown and the order is not changed
 *   OCO-04  the Operations snapshot keeps an order the server answered
 *           'awaiting_payment' (the marketplace vocabulary) among the active
 *           orders, with its Complete offline action
 *   OCO-05  the Operations snapshot offers Complete offline on every unpaid
 *           CASH storefront order it loaded (five here), not only on the 3
 *           active and 2 completed panels it shows
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const apiPost = vi.fn();
const apiGet = vi.fn();
const apiPatch = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/lib/api", () => ({
  apiPost: (...args: unknown[]) => apiPost(...args),
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPatch: (...args: unknown[]) => apiPatch(...args),
}));
vi.mock("@/lib/workspace", () => ({ getStoredBusinessId: () => BIZ }));
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }));

const BIZ = "biz_oco";

import { OrdersPanel } from "../orders-panel";

type ApiOrder = Record<string, unknown> & { id: string; orderNumber: string; status: string };

function apiOrder(n: number, over: Record<string, unknown> = {}): ApiOrder {
  return {
    id: `ord_oco_${n}`,
    orderNumber: `ORD-OCO-${n}`,
    status: "PENDING",
    type: "STOREFRONT",
    customerName: `Customer ${n}`,
    customerEmail: `oco${n}@test.local`,
    subtotal: 80,
    shippingFee: 0,
    taxAmount: 0,
    discountAmount: 0,
    total: 80,
    currency: "TTD",
    paymentStatus: "PENDING",
    paymentMethod: "CASH",
    items: [{ id: `it_${n}`, productId: "prod_oco", name: "Widget", quantity: 2, unitPrice: 40, total: 80, currency: "TTD" }],
    createdAt: `2026-11-0${n % 9 || 1}T10:00:00.000Z`,
    updatedAt: `2026-11-0${n % 9 || 1}T10:00:00.000Z`,
    ...over,
  };
}

function serveOrders(orders: ApiOrder[]) {
  apiGet.mockImplementation(async (path: string) => {
    if (path.startsWith(`/site/businesses/${BIZ}/orders`)) {
      return { data: { data: orders, total: orders.length, page: 1, pageSize: 100, totalPages: 1 }, error: null };
    }
    return { data: null, error: null };
  });
}

const completeOffline = () => screen.queryByRole("button", { name: /Complete offline/i });

async function openOrder(orderNumber: string) {
  fireEvent.click(await screen.findByText(orderNumber));
}

beforeEach(() => {
  apiPost.mockReset();
  apiGet.mockReset();
  apiPatch.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("store order list: Complete offline on every unpaid cash storefront order (G6PUB-RC1-2)", () => {
  it("OCO-01: five unpaid CASH / MANUAL storefront orders each offer Complete offline, which calls the site route and renders the server's order", async () => {
    const orders = [1, 2, 3, 4, 5].map((n) => apiOrder(n, n === 5 ? { paymentMethod: "manual", paymentStatus: "UNPAID", status: "awaiting_payment" } : {}));
    serveOrders(orders);
    render(<OrdersPanel />);

    for (const order of orders) {
      await openOrder(order.orderNumber);
      // At c549a12f: the store order list has no Complete offline action.
      expect(completeOffline(), `${order.orderNumber} offers Complete offline`).not.toBeNull();
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(completeOffline()).toBeNull());
    }

    const answered = { ...orders[0], status: "CONFIRMED", paymentStatus: "PAID", updatedAt: "2026-11-03T12:00:00.000Z" };
    apiPost.mockResolvedValue({ data: answered, error: null });
    await openOrder("ORD-OCO-1");
    fireEvent.click(completeOffline()!);

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [{ path, body }] = apiPost.mock.calls[0] as [{ path: string; body?: Record<string, unknown> }];
    expect(path).toBe(`/site/businesses/${BIZ}/orders/ord_oco_1/complete-offline`);
    expect(body ?? {}).toEqual({});
    // The server's answer is rendered: the order is paid, so the action is gone.
    await waitFor(() => expect(completeOffline()).toBeNull());
    expect(toastError).not.toHaveBeenCalled();
  });

  it.each([
    ["an order a provider settles (WIPAY)", { paymentMethod: "WIPAY" }],
    ["a PAID order", { paymentStatus: "PAID" }],
    ["a STANDARD (marketplace) order", { type: "STANDARD" }],
    ["a CANCELLED order", { status: "CANCELLED" }],
    ["a refunded order", { status: "REFUNDED", paymentStatus: "REFUNDED" }],
  ])("OCO-02: no Complete offline for %s", async (_label, over) => {
    serveOrders([apiOrder(1, over)]);
    render(<OrdersPanel />);
    await openOrder("ORD-OCO-1");
    expect(screen.getByText(/Payment:/)).toBeInTheDocument();
    expect(completeOffline()).toBeNull();
  });

  it("OCO-03: the server's refusal is shown and the order is not changed", async () => {
    serveOrders([apiOrder(1)]);
    apiPost.mockResolvedValue({ data: null, error: "Insufficient permissions: revenue requires write access (you have read)" });
    render(<OrdersPanel />);
    await openOrder("ORD-OCO-1");

    fireEvent.click(completeOffline()!);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/revenue requires write access/)));
    expect(completeOffline(), "still unpaid: the action stays").not.toBeNull();
  });
});

/** Renders the store's Operations mode over these marketplace-route orders and loads the snapshot. */
async function renderOperations(orders: ApiOrder[]) {
  vi.resetModules();
  vi.doMock("../delivery-config-panel", () => ({ DeliveryConfigPanel: () => null }));
  vi.doMock("../shipping-zones-panel", () => ({ ShippingZonesPanel: () => null }));
  vi.doMock("../qualification-config", () => ({ QualificationConfig: () => null }));
  vi.doMock("../hours-editor", () => ({ HoursEditor: () => null }));
  const { OperationsMode } = await import("../operations-mode");

  apiGet.mockImplementation(async (path: string) => {
    if (path.startsWith(`/marketplace/businesses/${BIZ}/orders`)) return { data: { data: orders, total: orders.length }, error: null };
    return { data: null, error: null };
  });

  render(
    <OperationsMode
      businessId={BIZ}
      storeEnabled
      businessHours={{}}
      storefrontConfig={{} as never}
      onConfigChange={vi.fn()}
      onSaveConfig={vi.fn(async () => undefined)}
      configSaving={false}
      onHoursChange={vi.fn()}
      onSaveHours={vi.fn(async () => undefined)}
      hoursSaving={false}
      onToggleStoreEnabled={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Load Orders/i }));
}

describe("Operations snapshot keeps the marketplace vocabulary's active orders (G6PUB-RC1-2)", () => {
  it("OCO-05: every unpaid CASH storefront order in the snapshot offers Complete offline (five, past the snapshot's 3 / 2 caps)", async () => {
    const orders = [
      apiOrder(1),
      apiOrder(2),
      apiOrder(3, { status: "CONFIRMED" }),
      apiOrder(4, { status: "PROCESSING" }),
      apiOrder(5, { status: "DELIVERED" }),
      apiOrder(6, { status: "DELIVERED", paymentStatus: "PAID" }),
      apiOrder(7, { status: "DELIVERED", paymentStatus: "PAID" }),
      apiOrder(8, { status: "DELIVERED", paymentStatus: "PAID" }),
    ];
    await renderOperations(orders);

    // At c549a12f (R1): 3 active and 2 completed panels are shown, so only 3 of the 5 unpaid cash orders offer it.
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Complete offline/i })).toHaveLength(5));
  });

  it("OCO-04: an order answered 'awaiting_payment' stays among the active orders with its Complete offline action", async () => {
    await renderOperations([apiOrder(1, { status: "awaiting_payment" })]);
    // At c549a12f: 'awaiting_payment' is in neither list (0 active orders, no panel, no action).
    expect(await screen.findByText(/^1 active order$/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Complete offline/i })).toBeInTheDocument();
  });
});
