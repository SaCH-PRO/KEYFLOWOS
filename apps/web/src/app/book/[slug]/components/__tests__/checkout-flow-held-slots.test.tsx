/**
 * SWP-BOOKING-SLOTS repair round 4: a kept booking's slots are offered only while the whole reuse key still matches.
 *
 * The page reuses kept bookings only when the whole checkout matches their reuse key (bookingReuseKey: the customer
 * and every service line, with its quantity, date, time, staff, location and instant); otherwise it books every
 * line afresh, and the server refuses a held time, which the customer's own PENDING booking still takes. So the
 * checkout offers and counts the held slots only while that whole key would still match, and says so once it no
 * longer does.
 *
 *   HSF-01  each row is offered its own service's held time, never another service's (service scoping)
 *   HSF-02  a cart that gained a service no longer matches the kept key: nothing is filled, the new row stays empty
 *           and unscheduled, and no row is offered a held time or location
 *   HSF-03  a kept key whose line has another quantity than the cart does not match: nothing is filled or offered
 *   HSF-04  editing a filled row's location releases the held time until the location matches again
 *   HSF-05  changing a filled row's date or staff member releases the held time (date and staff scoping)
 *   HSF-06  a customer whose details no longer match after a fill gets the filled rows cleared
 *   HSF-07  a kept key with more lines than the cart (the cart lost a service) does not match: nothing is filled,
 *           only fresh times are offered, and the held time is never offered
 *   HSF-08  the release notice says how to keep the earlier times
 *   HSF-09  a checkout whose cart loses a service while it is open releases the hold (the gate, not only the fill)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const apiGet = vi.fn();
vi.mock("@/lib/api", () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
}));

import { CheckoutFlow } from "../checkout-flow";
import type { Business, CartItem, Staff } from "../types";

const DAY = "2026-12-15";
const at = (hhmm: string) => `${DAY}T${String(Number(hhmm.slice(0, 2)) + 4).padStart(2, "0")}:${hhmm.slice(3)}:00.000Z`; // Port of Spain, UTC-4
const RELEASED = /Changing your booking releases the times we were holding; pick times again\./;
const KEEP_HOW = /To keep your earlier times, go back to the shop and open checkout again\./;

const business: Business = {
  id: "biz_hsf",
  name: "HSF Studio",
  slug: "hsf-studio",
  timezone: "America/Port_of_Spain",
  currency: "USD",
  businessHours: { tue: { open: "09:00", close: "17:00", closed: false }, wed: { open: "09:00", close: "17:00", closed: false } } as Business["businessHours"],
};

const service = (id: string, name: string): CartItem =>
  ({ id, name, price: 50, currency: "USD", itemType: "service", requiresBooking: true, sourceServiceId: id, quantity: 1, duration: 60 }) as CartItem;
const A = service("svc_a", "Service Alpha");
const B = service("svc_b", "Service Beta");

const CUSTOMER = ["Hana", "", "hsf@test.local", ""];
type Line = { service: CartItem; time: string; staffId?: string; location?: string; quantity?: number };
/** A reuse key as bookingReuseKey writes it: the customer, then one line per service. */
const keyOf = (lines: Line[], customer = CUSTOMER) =>
  JSON.stringify({
    customer,
    services: lines.map((l) => [l.service.id, l.quantity ?? 1, DAY, l.time, l.staffId ?? "", l.location ?? "", at(l.time)]),
  });

/** Each service's fresh answer: the server counts the customer's own PENDING booking as taken. */
const FRESH: Record<string, string[]> = {
  svc_a: ["12:00", "13:00"],
  svc_b: ["12:00", "13:00"],
};

function renderFlow(cart: CartItem[], heldReuseKey: string | null, staff: Staff[] = []) {
  const onSubmit = vi.fn(async () => undefined);
  const view = render(flowElement(cart, heldReuseKey, staff, onSubmit));
  return Object.assign(onSubmit, { rerenderWith: (next: CartItem[]) => view.rerender(flowElement(next, heldReuseKey, staff, onSubmit)) });
}

function flowElement(cart: CartItem[], heldReuseKey: string | null, staff: Staff[], onSubmit: ReturnType<typeof vi.fn>) {
  return (
    <CheckoutFlow
      business={business}
      cart={cart}
      staff={staff}
      primaryColor="#112233"
      secondaryColor="#445566"
      accentColor="#778899"
      cartTotal={100}
      cartCurrency="USD"
      promoCode={null}
      shippingZones={[]}
      onBack={vi.fn()}
      onUpdateQuantity={vi.fn()}
      onSubmit={onSubmit}
      {...({ heldReuseKey } as Record<string, unknown>)}
    />
  );
}

function fillInfo(firstName = CUSTOMER[0], email = CUSTOMER[2]) {
  fireEvent.change(screen.getByPlaceholderText("John"), { target: { value: firstName } });
  fireEvent.change(screen.getByPlaceholderText("john@example.com"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
}

/** A service's row on the Schedule step. */
const rowOf = (name: string) => {
  const card = screen.getByText(name, { selector: "h3" }).closest(".rounded-2xl") as HTMLElement;
  return { card, q: within(card), date: card.querySelector('input[type="date"]') as HTMLInputElement };
};

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockImplementation(async (path: string) => {
    const m = /\/bookings\/public\/businesses\/biz_hsf\/slots\?(.*)$/.exec(path);
    if (!m) return { data: [], error: null };
    const q = new URLSearchParams(m[1]);
    return { data: { date: q.get("date"), slots: (FRESH[q.get("serviceId") ?? ""] ?? []).map(at) }, error: null };
  });
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("SWP-BOOKING-SLOTS: held slots only while the whole reuse key matches", () => {
  it("HSF-01 each row is offered its own service's held time, never another service's", async () => {
    renderFlow([A, B], keyOf([{ service: A, time: "11:00" }, { service: B, time: "09:00" }]));
    fillInfo();
    const a = rowOf("Service Alpha");
    const b = rowOf("Service Beta");
    expect(a.date.value).toBe(DAY);
    expect(b.date.value).toBe(DAY);
    expect(await a.q.findByRole("button", { name: "11:00" })).toBeInTheDocument();
    expect(await b.q.findByRole("button", { name: "09:00" })).toBeInTheDocument();
    expect(a.q.queryByRole("button", { name: "09:00" }), "Alpha is not offered Beta's held 09:00").toBeNull();
    expect(b.q.queryByRole("button", { name: "11:00" }), "Beta is not offered Alpha's held 11:00").toBeNull();
    expect(screen.getByRole("button", { name: /Continue/i })).toBeEnabled();
  });

  it("HSF-02 a cart that gained a service no longer matches: nothing is filled and no held time or location is offered", async () => {
    renderFlow([A, B], keyOf([{ service: A, time: "11:00", location: "Studio 2" }]));
    fillInfo();
    const a = rowOf("Service Alpha");
    const b = rowOf("Service Beta");
    expect(b.date.value, "Beta's row stays empty").toBe("");
    expect(a.date.value, "Alpha is not filled either: the kept booking is not reused").toBe("");
    expect(screen.getByText(RELEASED)).toBeInTheDocument();
    for (const row of [a, b]) {
      fireEvent.change(row.date, { target: { value: DAY } });
      expect(await row.q.findByRole("button", { name: "12:00" })).toBeInTheDocument();
      expect(row.q.queryByRole("button", { name: "11:00" })).toBeNull();
      expect((row.card.querySelector('input[type="text"]') as HTMLInputElement | null)?.value ?? "").not.toContain("Studio 2");
    }
    expect(screen.getByRole("button", { name: /Continue/i })).toBeDisabled();
  });

  it("HSF-03 a kept line with another quantity than the cart's does not match: nothing is filled or offered", async () => {
    renderFlow([A], keyOf([{ service: A, time: "11:00", quantity: 2 }]));
    fillInfo();
    const a = rowOf("Service Alpha");
    expect(a.date.value).toBe("");
    expect(screen.getByText(RELEASED)).toBeInTheDocument();
    fireEvent.change(a.date, { target: { value: DAY } });
    expect(await a.q.findByRole("button", { name: "12:00" })).toBeInTheDocument();
    expect(a.q.queryByRole("button", { name: "11:00" })).toBeNull();
  });

  it("HSF-04 editing a filled row's location releases the held time until it matches again", async () => {
    renderFlow([A], keyOf([{ service: A, time: "11:00", location: "Studio 2" }]));
    fillInfo();
    const a = rowOf("Service Alpha");
    const location = a.card.querySelector('input[type="text"]') as HTMLInputElement;
    expect(location.value).toBe("Studio 2");
    expect(await a.q.findByRole("button", { name: "11:00" })).toBeInTheDocument();
    expect(screen.queryByText(RELEASED)).toBeNull();

    fireEvent.change(location, { target: { value: "Studio 3" } });
    expect(screen.getByText(RELEASED)).toBeInTheDocument();
    expect(a.q.queryByRole("button", { name: "11:00" })).toBeNull();
    expect(screen.getByRole("button", { name: /Continue/i })).toBeDisabled();

    fireEvent.change(location, { target: { value: "Studio 2" } });
    expect(await a.q.findByRole("button", { name: "11:00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue/i })).toBeEnabled();
  });

  it("HSF-05 changing a filled row's date or staff member releases the held time", async () => {
    renderFlow([A], keyOf([{ service: A, time: "11:00" }]), [{ id: "stf_1", name: "Ana" }]);
    fillInfo();
    let a = rowOf("Service Alpha");
    expect(await a.q.findByRole("button", { name: "11:00" })).toBeInTheDocument();

    // Another day, then back to the held day: the held time is not offered again.
    fireEvent.change(a.date, { target: { value: "2026-12-16" } });
    fireEvent.change(a.date, { target: { value: DAY } });
    expect(await a.q.findByRole("button", { name: "12:00" })).toBeInTheDocument();
    expect(a.q.queryByRole("button", { name: "11:00" }), "date scoping").toBeNull();
    cleanup();

    renderFlow([A], keyOf([{ service: A, time: "11:00" }]), [{ id: "stf_1", name: "Ana" }]);
    fillInfo();
    a = rowOf("Service Alpha");
    expect(await a.q.findByRole("button", { name: "11:00" })).toBeInTheDocument();
    fireEvent.click(a.q.getByRole("button", { name: /Ana/ }));
    await waitFor(() => expect(apiGet.mock.calls.some(([p]) => String(p).includes("staffId=stf_1"))).toBe(true));
    expect(await a.q.findByRole("button", { name: "12:00" })).toBeInTheDocument();
    expect(a.q.queryByRole("button", { name: "11:00" }), "staff scoping").toBeNull();
    expect(screen.getByRole("button", { name: /Continue/i })).toBeDisabled();
  });

  it("HSF-06 a customer whose details no longer match after a fill gets the filled rows cleared", async () => {
    renderFlow([A], keyOf([{ service: A, time: "11:00", location: "Studio 2" }]));
    fillInfo();
    expect(rowOf("Service Alpha").date.value).toBe(DAY);
    fireEvent.click(screen.getByRole("button", { name: /^Back$/ }));
    fillInfo("Otto", "other@test.local");
    const a = rowOf("Service Alpha");
    expect(a.date.value, "the other customer's row does not keep the held date").toBe("");
    expect((a.card.querySelector('input[type="text"]') as HTMLInputElement | null)?.value ?? "").toBe("");
    expect(screen.queryByText(RELEASED), "another customer is not told about someone else's hold").toBeNull();
  });

  it("HSF-07 a kept key with more lines than the cart does not match: nothing is filled and the held time is never offered", async () => {
    renderFlow([A], keyOf([{ service: A, time: "11:00" }, { service: B, time: "09:00" }]));
    fillInfo();
    const a = rowOf("Service Alpha");
    expect(a.date.value, "nothing is filled from a hold the cart no longer matches").toBe("");
    expect(screen.getByText(RELEASED)).toBeInTheDocument();
    fireEvent.change(a.date, { target: { value: DAY } });
    expect(await a.q.findByRole("button", { name: "12:00" })).toBeInTheDocument();
    expect(a.q.queryByRole("button", { name: "11:00" }), "the held 11:00 is never offered").toBeNull();
    expect(screen.getByRole("button", { name: /Continue/i })).toBeDisabled();
    fireEvent.click(a.q.getByRole("button", { name: "12:00" }));
    expect(screen.getByRole("button", { name: /Continue/i })).toBeEnabled();
  });

  it("HSF-08 the release notice says how to keep the earlier times", async () => {
    renderFlow([A], keyOf([{ service: A, time: "11:00", location: "Studio 2" }]));
    fillInfo();
    const location = rowOf("Service Alpha").card.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(location, { target: { value: "Studio 3" } });
    expect(screen.getByText(KEEP_HOW)).toBeInTheDocument();
  });

  it("HSF-09 a checkout whose cart loses a service while it is open releases the hold", async () => {
    const flow = renderFlow([A, B], keyOf([{ service: A, time: "11:00" }, { service: B, time: "09:00" }]));
    fillInfo();
    expect(await rowOf("Service Alpha").q.findByRole("button", { name: "11:00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue/i })).toBeEnabled();

    flow.rerenderWith([A]);
    const a = rowOf("Service Alpha");
    expect(await screen.findByText(RELEASED)).toBeInTheDocument();
    expect(a.q.queryByRole("button", { name: "11:00" }), "the held 11:00 is no longer offered").toBeNull();
    expect(screen.getByRole("button", { name: /Continue/i })).toBeDisabled();
  });
});
