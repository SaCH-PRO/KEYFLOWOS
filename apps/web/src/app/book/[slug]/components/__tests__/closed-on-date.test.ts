/**
 * SWP-BOOKING-SLOTS: the checkout's "Closed on <day>" banner reads a day's hours as the store pages do.
 *
 * isDayClosed (utils.ts) read Business.businessHours under sun..sat only, so a day the profile editor saved as
 * sunday..saturday was never closed and the picker offered it. It now asks store-hours.ts (isClosedOnDate), the one
 * hours reader the store pages share: both spellings, and a day whose data is unclear is not called closed.
 *
 *   COD-01  a day closed under either spelling is closed
 *   COD-02  an open day, a day not set, unclear data and no hours are not closed
 *   COD-03  the weekday is the calendar date's, whatever the visitor's clock
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as storeHours from "../store-hours";
import { isDayClosed } from "../utils";
import type { BusinessHours } from "../types";

const isClosedOnDate = (storeHours as unknown as { isClosedOnDate: (h: BusinessHours | null | undefined, d: string) => boolean }).isClosedOnDate;

let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  // UTC+14: a weekday read from a UTC instant of the date would be a day later here.
  process.env.TZ = "Pacific/Kiritimati";
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

const SUNDAY = "2026-12-13";
const MONDAY = "2026-12-14";
const hours = (h: Record<string, unknown>) => h as unknown as BusinessHours;

describe("SWP-BOOKING-SLOTS: isClosedOnDate", () => {
  it("COD-01 a day closed under either spelling is closed, from store-hours and from isDayClosed", () => {
    expect(typeof isClosedOnDate).toBe("function");
    for (const h of [hours({ sun: { closed: true } }), hours({ sunday: { closed: true } })]) {
      expect(isClosedOnDate(h, SUNDAY)).toBe(true);
      expect(isDayClosed(SUNDAY, h)).toBe(true);
    }
  });

  it("COD-02 an open day, a day not set, unclear data and no hours are not closed", () => {
    expect(typeof isClosedOnDate).toBe("function");
    const cases: Array<BusinessHours | null | undefined> = [
      hours({ sunday: { open: "09:00", close: "17:00", closed: false } }),
      hours({ monday: { closed: true } }),
      hours({ sunday: { closed: "true" } }),
      hours({ sunday: { closed: 1 } }),
      hours({}),
      null,
      undefined,
    ];
    for (const h of cases) {
      expect(isClosedOnDate(h, SUNDAY)).toBe(false);
      expect(isDayClosed(SUNDAY, h)).toBe(false);
    }
    expect(isClosedOnDate(hours({ sunday: { closed: true } }), "")).toBe(false);
    expect(isClosedOnDate(hours({ sunday: { closed: true } }), "not-a-date")).toBe(false);
  });

  it("COD-03 the weekday is the calendar date's", () => {
    expect(typeof isClosedOnDate).toBe("function");
    const h = hours({ sunday: { closed: true }, monday: { open: "09:00", close: "17:00" } });
    expect(isClosedOnDate(h, SUNDAY)).toBe(true);
    expect(isClosedOnDate(h, MONDAY)).toBe(false);
  });
});
