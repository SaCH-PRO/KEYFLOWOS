/**
 * SWP-BOOKING-SLOTS repair round 1 (acceptance review of 093d689): the schedule step's slot answers stay honest.
 *
 *   CFR-01  (COR-2) a refused Place Order drops the cached answers, so going back re-reads the slots route and no
 *           longer offers the time that was taken
 *   CFR-02  (COR-3) a failed read offers "Try again", which asks again and shows "Loading times…" while it runs
 *   CFR-04  after a refused Place Order, Place Order stays disabled until every row has a time its fresh answer offers
 *   CFR-05  while that re-read runs Place Order stays disabled and the review step says "Checking times…", not that
 *           the time is gone; the notice that it is gone shows only once a fresh answer omits it
 *   CFR-06  a re-read that fails offers Try again on the review step, not the notice that the time is gone
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const apiGet = vi.fn();
vi.mock("@/lib/api", () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
}));

import { CheckoutFlow } from "../checkout-flow";
import type { Business, CartItem } from "../types";

const SLOTS_ROUTE = "/bookings/public/businesses/biz_cfr/slots";
/** 09:00, 11:00 and 12:00 in Port of Spain (UTC-4). */
const BEFORE = ["2026-12-15T13:00:00.000Z", "2026-12-15T15:00:00.000Z", "2026-12-15T16:00:00.000Z"];
/** The same day once someone else took 11:00. */
const AFTER = ["2026-12-15T13:00:00.000Z", "2026-12-15T16:00:00.000Z"];

const business: Business = {
  id: "biz_cfr",
  name: "CFR Studio",
  slug: "cfr-studio",
  timezone: "America/Port_of_Spain",
  currency: "USD",
  businessHours: { tue: { open: "09:00", close: "17:00", closed: false } } as Business["businessHours"],
};

const SERVICE = {
  id: "svc_cfr",
  name: "CFR Session",
  price: 50,
  currency: "USD",
  itemType: "service",
  requiresBooking: true,
  quantity: 1,
} as CartItem;

function renderToSchedule(onSubmit: ReturnType<typeof vi.fn>) {
  const view = render(
    <CheckoutFlow
      business={business}
      cart={[SERVICE]}
      staff={[]}
      primaryColor="#112233"
      secondaryColor="#445566"
      accentColor="#778899"
      cartTotal={50}
      cartCurrency="USD"
      promoCode={null}
      shippingZones={[]}
      onBack={vi.fn()}
      onUpdateQuantity={vi.fn()}
      onSubmit={onSubmit}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText("John"), { target: { value: "Cee" } });
  fireEvent.change(screen.getByPlaceholderText("john@example.com"), { target: { value: "cfr@test.local" } });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
  const dateInput = view.container.querySelector('input[type="date"]') as HTMLInputElement;
  fireEvent.change(dateInput, { target: { value: "2026-12-15" } });
}

const slotCalls = () => apiGet.mock.calls.map(([p]) => String(p)).filter((p) => p.startsWith(SLOTS_ROUTE));

beforeEach(() => {
  apiGet.mockReset();
});
afterEach(() => {
  cleanup();
  try { window.localStorage.clear(); } catch { /* best-effort */ }
});

describe("SWP-BOOKING-SLOTS repair round 1", () => {
  it("CFR-01 a refused Place Order drops the cached answers: going back re-reads and the taken time is gone", async () => {
    let answer = BEFORE;
    apiGet.mockImplementation(async (path: string) =>
      path.startsWith(SLOTS_ROUTE) ? { data: { date: "2026-12-15", slots: answer }, error: null } : { data: [], error: null },
    );
    const onSubmit = vi.fn(async () => {
      throw new Error("That time slot has already been booked. Please choose another.");
    });
    renderToSchedule(onSubmit);
    fireEvent.click(await screen.findByRole("button", { name: "11:00" }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.click(screen.getByText(/I agree to the terms of service/));

    answer = AFTER; // someone else books 11:00 meanwhile
    fireEvent.click(screen.getByRole("button", { name: /Place Order/i }));
    await screen.findByText(/already been booked/);
    fireEvent.click(screen.getByRole("button", { name: /^Back$/ }));

    await waitFor(() => expect(slotCalls().filter((p) => p.includes("date=2026-12-15")).length).toBe(2));
    expect(await screen.findByRole("button", { name: "12:00" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "11:00" }), "the taken 11:00 is not offered again").toBeNull();
  });

  it("CFR-03 after a refused Place Order, a time the fresh answer no longer offers does not count as scheduled", async () => {
    let answer = BEFORE;
    apiGet.mockImplementation(async (path: string) =>
      path.startsWith(SLOTS_ROUTE) ? { data: { date: "2026-12-15", slots: answer }, error: null } : { data: [], error: null },
    );
    const onSubmit = vi.fn(async () => {
      throw new Error("That time slot has already been booked. Please choose another.");
    });
    renderToSchedule(onSubmit);
    fireEvent.click(await screen.findByRole("button", { name: "11:00" }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.click(screen.getByText(/I agree to the terms of service/));
    answer = AFTER;
    fireEvent.click(screen.getByRole("button", { name: /Place Order/i }));
    await screen.findByText(/already been booked/);
    fireEvent.click(screen.getByRole("button", { name: /^Back$/ }));
    expect(await screen.findByRole("button", { name: "12:00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue/i }), "the taken 11:00 no longer schedules the row").toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "12:00" }));
    expect(screen.getByRole("button", { name: /Continue/i })).toBeEnabled();
  });

  it("CFR-02 a failed read offers Try again, which asks again and shows Loading times… while it runs", async () => {
    const pending: Array<(v: unknown) => void> = [];
    let failing = true;
    apiGet.mockImplementation((path: string) => {
      if (!path.startsWith(SLOTS_ROUTE)) return Promise.resolve({ data: [], error: null });
      if (failing) return Promise.resolve({ data: null, error: "Service unavailable" });
      return new Promise((resolve) => pending.push(resolve));
    });
    renderToSchedule(vi.fn(async () => undefined));
    expect(await screen.findByText("Couldn't load times")).toBeInTheDocument();

    failing = false;
    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
    await waitFor(() => expect(slotCalls().length).toBe(2));
    expect(screen.getByText("Loading times…")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load times"), "the stale failure is not shown while the retry runs").toBeNull();

    await act(async () => pending[0]({ data: { date: "2026-12-15", slots: BEFORE }, error: null }));
    expect(await screen.findByRole("button", { name: "09:00" })).toBeInTheDocument();
  });

  it("CFR-04 after a refused Place Order, Place Order stays disabled until every row has a freshly offered time", async () => {
    let answer = BEFORE;
    apiGet.mockImplementation(async (path: string) =>
      path.startsWith(SLOTS_ROUTE) ? { data: { date: "2026-12-15", slots: answer }, error: null } : { data: [], error: null },
    );
    const onSubmit = vi.fn(async () => {
      throw new Error("That time slot has already been booked. Please choose another.");
    });
    renderToSchedule(onSubmit);
    fireEvent.click(await screen.findByRole("button", { name: "11:00" }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.click(screen.getByText(/I agree to the terms of service/));
    answer = AFTER;
    fireEvent.click(screen.getByRole("button", { name: /Place Order/i }));
    await screen.findByText(/already been booked/);

    // Still on the review step: the refused 11:00 is no longer offered, so the order cannot be placed again with it.
    await waitFor(() => expect(slotCalls().length).toBe(2));
    await waitFor(() => expect(screen.getByRole("button", { name: /Place Order/i })).toBeDisabled());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /^Back$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "12:00" }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(screen.getByRole("button", { name: /Place Order/i })).toBeEnabled();
  });

  /** Books 11:00, then has Place Order refused; the re-read after it is answered by `reRead`. */
  async function refusedOnce(reRead: (path: string) => Promise<unknown>) {
    let first = true;
    apiGet.mockImplementation((path: string) => {
      if (!path.startsWith(SLOTS_ROUTE)) return Promise.resolve({ data: [], error: null });
      if (first) {
        first = false;
        return Promise.resolve({ data: { date: "2026-12-15", slots: BEFORE }, error: null });
      }
      return reRead(path);
    });
    const onSubmit = vi.fn(async () => {
      throw new Error("That time slot has already been booked. Please choose another.");
    });
    renderToSchedule(onSubmit);
    fireEvent.click(await screen.findByRole("button", { name: "11:00" }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.click(screen.getByText(/I agree to the terms of service/));
    fireEvent.click(screen.getByRole("button", { name: /Place Order/i }));
    await screen.findByText(/already been booked/);
    return onSubmit;
  }
  const GONE = "A time you chose is no longer available. Go back to pick another.";

  it("CFR-05 while the re-read runs, Place Order is disabled and the step says Checking times…", async () => {
    const pending: Array<(v: unknown) => void> = [];
    await refusedOnce(() => new Promise((resolve) => pending.push(resolve)));
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(screen.getByRole("button", { name: /Place Order/i })).toBeDisabled();
    expect(screen.getByText("Checking times…")).toBeInTheDocument();
    expect(screen.queryByText(GONE), "not said before the fresh answer lands").toBeNull();

    await act(async () => pending[0]({ data: { date: "2026-12-15", slots: AFTER }, error: null }));
    expect(await screen.findByText(GONE)).toBeInTheDocument();
    expect(screen.queryByText("Checking times…")).toBeNull();
    expect(screen.getByRole("button", { name: /Place Order/i })).toBeDisabled();
  });

  it("CFR-06 a re-read that fails offers Try again on the review step, not the notice that the time is gone", async () => {
    let fail = true;
    await refusedOnce(async () =>
      fail ? { data: null, error: "Service unavailable" } : { data: { date: "2026-12-15", slots: BEFORE }, error: null },
    );
    expect(await screen.findByRole("button", { name: /Try again/i })).toBeInTheDocument();
    expect(screen.queryByText(GONE)).toBeNull();
    expect(screen.getByRole("button", { name: /Place Order/i })).toBeDisabled();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
    // 11:00 is still free: the row is scheduled again and the order can be placed.
    await waitFor(() => expect(screen.getByRole("button", { name: /Place Order/i })).toBeEnabled());
  });
});
