/**
 * SWP-BOOKING-SLOTS (BUG-122): the checkout's schedule step offers only the times the server will book.
 *
 * The step built its times from the opening hours alone (utils.ts getAvailableSlots), so it offered a booked time
 * and a time ending after closing, both refused only at Place Order. It now asks the server's public slots route
 * for the service, date and staff member chosen, and offers nothing while it waits or when the route fails.
 *
 *   CFS-01  the step asks the slots route and offers only its times (not the booked 10:00, not 16:30)
 *   CFS-02  while the answer is pending it says so and offers no time
 *   CFS-03  a failed answer says the times could not be loaded and offers no time
 *   CFS-04  an answer for an older date or staff member is never shown
 *   CFS-05  the time chosen travels with the server's exact instant
 *   CFS-06  a day closed under the sunday..saturday spelling shows the closed banner
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
import type { Business, CartItem, Staff } from "../types";

const SLOTS_ROUTE = "/bookings/public/businesses/biz_cfs/slots";

/** The server's answer for 2026-12-15 in Port of Spain (UTC-4): 09:00 and 11:00 to 16:00; 10:00 is booked. */
const SERVER_SLOTS = [13, 15, 16, 17, 18, 19, 20].map((h) => `2026-12-15T${h}:00:00.000Z`);

type Pending = { path: string; resolve: (v: unknown) => void };
let pending: Pending[] = [];

function business(hours?: Record<string, unknown>): Business {
  return {
    id: "biz_cfs",
    name: "CFS Studio",
    slug: "cfs-studio",
    timezone: "America/Port_of_Spain",
    currency: "USD",
    businessHours: (hours ?? { tue: { open: "09:00", close: "17:00", closed: false } }) as Business["businessHours"],
  };
}

const SERVICE: CartItem = {
  id: "svc_cfs",
  name: "CFS Session",
  price: 50,
  currency: "USD",
  itemType: "service",
  requiresBooking: true,
  quantity: 1,
} as CartItem;

function renderToSchedule(opts: { hours?: Record<string, unknown>; staff?: Staff[]; onSubmit?: ReturnType<typeof vi.fn> } = {}) {
  const onSubmit = opts.onSubmit ?? vi.fn(async () => undefined);
  const view = render(
    <CheckoutFlow
      business={business(opts.hours)}
      cart={[SERVICE]}
      staff={opts.staff ?? []}
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
  fireEvent.change(screen.getByPlaceholderText("john@example.com"), { target: { value: "cfs@test.local" } });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
  const dateInput = view.container.querySelector('input[type="date"]') as HTMLInputElement;
  return { onSubmit, dateInput, pick: (date: string) => fireEvent.change(dateInput, { target: { value: date } }) };
}

const slotCalls = () => apiGet.mock.calls.map(([p]) => String(p)).filter((p) => p.startsWith(SLOTS_ROUTE));
const timeButton = (t: string) => screen.queryByRole("button", { name: t });

beforeEach(() => {
  pending = [];
  apiGet.mockReset();
  apiGet.mockImplementation(async (path: string) => {
    if (path.startsWith(SLOTS_ROUTE)) return { data: { date: "2026-12-15", slots: SERVER_SLOTS }, error: null };
    return { data: [], error: null };
  });
});

afterEach(() => {
  cleanup();
  try { window.localStorage.clear(); } catch { /* best-effort */ }
});

describe("SWP-BOOKING-SLOTS: the schedule step offers the server's free slots", () => {
  it("CFS-01 asks the slots route and offers only its times", async () => {
    const { pick } = renderToSchedule();
    pick("2026-12-15");
    expect(await screen.findByRole("button", { name: "09:00" })).toBeInTheDocument();
    expect(timeButton("16:00")).toBeInTheDocument();
    expect(timeButton("10:00"), "the booked 10:00 is not offered").toBeNull();
    expect(timeButton("16:30"), "16:30 would end after the 17:00 close").toBeNull();
    const calls = slotCalls();
    expect(calls.length).toBeGreaterThan(0);
    const q = new URLSearchParams(calls[calls.length - 1].split("?")[1]);
    expect(q.get("serviceId")).toBe("svc_cfs");
    expect(q.get("date")).toBe("2026-12-15");
  });

  it("CFS-02 while the answer is pending it says so and offers no time", async () => {
    apiGet.mockImplementation((path: string) =>
      path.startsWith(SLOTS_ROUTE)
        ? new Promise((resolve) => pending.push({ path, resolve }))
        : Promise.resolve({ data: [], error: null }),
    );
    const { pick } = renderToSchedule();
    pick("2026-12-15");
    expect(await screen.findByText("Loading times…")).toBeInTheDocument();
    expect(timeButton("09:00")).toBeNull();
    expect(screen.queryByText("No time slots available for this date.")).toBeNull();
  });

  it("CFS-03 a failed answer says the times could not be loaded and offers no time", async () => {
    apiGet.mockImplementation(async (path: string) =>
      path.startsWith(SLOTS_ROUTE) ? { data: null, error: "Too many requests" } : { data: [], error: null },
    );
    const { pick } = renderToSchedule();
    pick("2026-12-15");
    expect(await screen.findByText("Couldn't load times")).toBeInTheDocument();
    expect(timeButton("09:00")).toBeNull();
    expect(timeButton("10:00")).toBeNull();
  });

  it("CFS-04 an answer for an older date or staff member is never shown", async () => {
    apiGet.mockImplementation((path: string) =>
      path.startsWith(SLOTS_ROUTE)
        ? new Promise((resolve) => pending.push({ path, resolve }))
        : Promise.resolve({ data: [], error: null }),
    );
    const { pick } = renderToSchedule({
      hours: { tue: { open: "09:00", close: "17:00" }, wed: { open: "09:00", close: "17:00" } },
      staff: [{ id: "stf_1", name: "Ana" }],
    });
    pick("2026-12-15");
    await waitFor(() => expect(pending.some((p) => p.path.includes("date=2026-12-15"))).toBe(true));
    pick("2026-12-16");
    await waitFor(() => expect(pending.some((p) => p.path.includes("date=2026-12-16"))).toBe(true));

    // The newer date's answer arrives first, then the older one's, late.
    const newer = pending.find((p) => p.path.includes("date=2026-12-16"))!;
    const older = pending.find((p) => p.path.includes("date=2026-12-15"))!;
    await act(async () => newer.resolve({ data: { date: "2026-12-16", slots: ["2026-12-16T14:00:00.000Z"] }, error: null }));
    await act(async () => older.resolve({ data: { date: "2026-12-15", slots: SERVER_SLOTS }, error: null }));
    expect(await screen.findByRole("button", { name: "10:00" })).toBeInTheDocument();
    expect(timeButton("09:00"), "the older date's 09:00 is not shown").toBeNull();

    // Choosing a staff member asks again, for that staff member, and shows only that answer.
    fireEvent.click(screen.getByRole("button", { name: /Ana/ }));
    await waitFor(() => expect(pending.some((p) => p.path.includes("staffId=stf_1"))).toBe(true));
    expect(screen.getByText("Loading times…")).toBeInTheDocument();
    expect(timeButton("10:00"), "the answer for no staff member is not shown for Ana").toBeNull();
    const forAna = pending.find((p) => p.path.includes("staffId=stf_1"))!;
    await act(async () => forAna.resolve({ data: { date: "2026-12-16", slots: ["2026-12-16T19:00:00.000Z"] }, error: null }));
    expect(await screen.findByRole("button", { name: "15:00" })).toBeInTheDocument();
  });

  it("CFS-05 the time chosen travels with the server's exact instant", async () => {
    const { pick, onSubmit } = renderToSchedule();
    pick("2026-12-15");
    fireEvent.click(await screen.findByRole("button", { name: "11:00" }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.click(screen.getByText(/I agree to the terms of service/));
    fireEvent.click(screen.getByRole("button", { name: /Place Order/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [data] = onSubmit.mock.calls[0] as unknown as [{ serviceBookings: Record<string, { date: string; time: string; startIso?: string }> }];
    const bd = data.serviceBookings["svc_cfs_service"];
    expect(bd.date).toBe("2026-12-15");
    expect(bd.time).toBe("11:00");
    expect(bd.startIso).toBe("2026-12-15T15:00:00.000Z");
  });

  it("CFS-07 a failed answer is asked again when the row comes back to that date", async () => {
    let failing = true;
    apiGet.mockImplementation(async (path: string) => {
      if (!path.startsWith(SLOTS_ROUTE)) return { data: [], error: null };
      if (failing) return { data: null, error: "Service unavailable" };
      return { data: { date: "2026-12-15", slots: SERVER_SLOTS }, error: null };
    });
    const { pick } = renderToSchedule({ hours: { tue: { open: "09:00", close: "17:00" }, wed: { open: "09:00", close: "17:00" } } });
    pick("2026-12-15");
    expect(await screen.findByText("Couldn't load times")).toBeInTheDocument();
    failing = false;
    pick("2026-12-16");
    pick("2026-12-15");
    expect(await screen.findByRole("button", { name: "09:00" })).toBeInTheDocument();
    expect(slotCalls().filter((p) => p.includes("date=2026-12-15")).length).toBe(2);
  });

  it("CFS-06 a day closed under the sunday..saturday spelling shows the closed banner and offers no time", async () => {
    const { pick } = renderToSchedule({ hours: { sunday: { closed: true }, tuesday: { open: "09:00", close: "17:00" } } });
    pick("2026-12-13");
    expect(await screen.findByText(/Closed on/)).toBeInTheDocument();
    expect(timeButton("09:00")).toBeNull();
  });
});
