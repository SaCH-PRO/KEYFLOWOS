/**
 * SWP-BOOKING-SLOTS (BUG-122): the public booking picker offers only the times the server will book.
 *
 * getAvailableSlots (utils.ts) built the picker's times from the opening hours alone, every 30 minutes from open
 * until close, so it offered a time already booked and a time whose appointment ends after closing; both were
 * refused only at Place Order. The server's public slots route (GET /bookings/public/businesses/:id/slots, backed
 * by BookingsService.getAvailableSlots) puts every candidate through the guard the write paths use, so the picker
 * reads that route and shows its instants on the business's own clock (Business.timezone). When the route cannot be
 * read, nothing is offered: no local guess can know the bookings.
 *
 *   AVS-01  with a 10:00 booking and a 17:00 close, a 60-minute service offers neither 10:00 nor 16:30
 *   AVS-02  the route is asked for the business, service, date and staff member chosen
 *   AVS-03  the instants are shown on the business's clock, not the visitor's
 *   AVS-04  a failed or malformed answer offers nothing (null), never an opening-hours guess
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
vi.mock("@/lib/api", () => ({ apiGet: (...args: unknown[]) => apiGet(...args), API_BASE: "http://api.test.local" }));

import * as utils from "../utils";

type Fetch = (p: {
  businessId: string;
  serviceId: string;
  date: string;
  staffId?: string;
  timeZone?: string | null;
}) => Promise<string[] | null>;

const fetchAvailableSlots = (utils as unknown as { fetchAvailableSlots: Fetch }).fetchAvailableSlots;

/**
 * What the server answers for 2026-12-15 at a business in America/Port_of_Spain (UTC-4, no DST) open 09:00 to 17:00,
 * a 60-minute service and a booking 10:00 to 11:00: 09:00, then 11:00 to 16:00 (09:30, 10:00 and 10:30 overlap the
 * booking; 16:30 would end at 17:30, after closing).
 */
const SERVER_SLOTS = [
  "2026-12-15T13:00:00.000Z",
  "2026-12-15T15:00:00.000Z",
  "2026-12-15T15:30:00.000Z",
  "2026-12-15T16:00:00.000Z",
  "2026-12-15T16:30:00.000Z",
  "2026-12-15T17:00:00.000Z",
  "2026-12-15T17:30:00.000Z",
  "2026-12-15T18:00:00.000Z",
  "2026-12-15T18:30:00.000Z",
  "2026-12-15T19:00:00.000Z",
  "2026-12-15T19:30:00.000Z",
  "2026-12-15T20:00:00.000Z",
];

const ask = { businessId: "biz-1", serviceId: "svc-60", date: "2026-12-15", timeZone: "America/Port_of_Spain" };

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue({ data: { date: "2026-12-15", slots: SERVER_SLOTS }, error: null, status: 200 });
});

describe("SWP-BOOKING-SLOTS: the public picker reads the server's free slots", () => {
  it("AVS-01 offers neither the booked 10:00 nor 16:30, which would end after the 17:00 close", async () => {
    expect(typeof fetchAvailableSlots).toBe("function");
    const slots = await fetchAvailableSlots(ask);
    expect(slots).not.toBeNull();
    expect(slots).not.toContain("10:00");
    expect(slots).not.toContain("16:30");
    expect(slots).toEqual(["09:00", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"]);
  });

  it("AVS-02 asks the public slots route for the business, service, date and staff member", async () => {
    await fetchAvailableSlots({ ...ask, staffId: "staff 7" });
    expect(apiGet).toHaveBeenCalledTimes(1);
    const path = String(apiGet.mock.calls[0][0]);
    const [route, query] = path.split("?");
    expect(route).toBe("/bookings/public/businesses/biz-1/slots");
    const params = new URLSearchParams(query);
    expect(params.get("serviceId")).toBe("svc-60");
    expect(params.get("date")).toBe("2026-12-15");
    expect(params.get("staffId")).toBe("staff 7");

    apiGet.mockClear();
    await fetchAvailableSlots(ask);
    expect(new URLSearchParams(String(apiGet.mock.calls[0][0]).split("?")[1]).has("staffId")).toBe(false);
  });

  it("AVS-03 shows each instant on the business's clock", async () => {
    apiGet.mockResolvedValue({ data: { date: "2026-12-15", slots: ["2026-12-15T13:00:00.000Z"] }, error: null, status: 200 });
    expect(await fetchAvailableSlots(ask)).toEqual(["09:00"]);
    expect(await fetchAvailableSlots({ ...ask, timeZone: "Asia/Tokyo" })).toEqual(["22:00"]);
  });

  it("AVS-04 offers nothing when the route fails or answers something else", async () => {
    apiGet.mockResolvedValue({ data: null, error: "Store not found", status: 404 });
    expect(await fetchAvailableSlots(ask)).toBeNull();
    apiGet.mockResolvedValue({ data: { date: "2026-12-15" }, error: null, status: 200 });
    expect(await fetchAvailableSlots(ask)).toBeNull();
    apiGet.mockResolvedValue({ data: { date: "2026-12-15", slots: ["not a time"] }, error: null, status: 200 });
    expect(await fetchAvailableSlots(ask)).toBeNull();
    apiGet.mockRejectedValue(new Error("network down"));
    expect(await fetchAvailableSlots(ask)).toBeNull();
    apiGet.mockResolvedValue({ data: { date: "2026-12-15", slots: SERVER_SLOTS }, error: null, status: 200 });
    expect(await fetchAvailableSlots({ ...ask, timeZone: "Not/AZone" })).toBeNull();
  });

  it("AVS-04 asks nothing and offers nothing without a date or service", async () => {
    expect(await fetchAvailableSlots({ ...ask, date: "" })).toBeNull();
    expect(await fetchAvailableSlots({ ...ask, serviceId: "" })).toBeNull();
    expect(apiGet).not.toHaveBeenCalled();
  });
});
