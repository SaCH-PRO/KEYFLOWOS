/**
 * CUSTOMER-PAGE-HONESTY, repair round 1 (acceptance reviews of a4d6dc29: SEC-M2, MIN-3, MIN-4, surviving timezone
 * mutant): the store pages' opening-hours rules in components/store-hours.ts, which the store hero (getOpenStatus) and
 * /book/<slug>'s trust bar (todaysHoursLabel) share.
 *
 *  - A day counts as set only when `closed === true`, or its open and close are valid HH:MM times. Anything else (a
 *    `closed: "false"` string, '9am', a missing time) is unset, and an unset today says nothing, in both places
 *    alike: the hero and the trust bar never disagree (MIN-4), and garbage never reads as "Closed Today" (SEC-M2).
 *  - Hours that close after midnight (18:00-02:00) run past midnight, including the previous day's span (MIN-3).
 *  - "Now" and "today" are the business's (Business.timezone). This file runs with the process clock in
 *    Pacific/Kiritimati (UTC+14), so a call that falls back to the runner's zone gives another day and fails here,
 *    whether the runner is on UTC or not.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";

import { getOpenStatus, todaysHoursLabel } from "../components/store-hours";
import type { BusinessHours } from "../components/types";

const POS = "America/Port_of_Spain"; // UTC-4, no daylight saving
const TOKYO = "Asia/Tokyo"; // UTC+9

let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = "Pacific/Kiritimati";
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});
afterEach(() => vi.useRealTimers());

function at(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

const SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const every = (open: string, close: string): BusinessHours =>
  Object.fromEntries(SHORT.map((d) => [d, { open, close, closed: false }]));

describe("the runner's own zone never decides (it is UTC+14 here)", () => {
  it("the process clock really is on another day than Port of Spain", () => {
    at("2026-11-26T15:00:00Z"); // Thursday 11:00 in Port of Spain, Friday 05:00 in Kiritimati
    expect(new Date().getDay(), "the runner's weekday").toBe(5);
  });

  it("Port of Spain (behind UTC): Thursday 11:00 there is open, though it is Friday 05:00 on the runner", () => {
    at("2026-11-26T15:00:00Z");
    const hours = { thu: { open: "09:00", close: "17:00", closed: false }, fri: { open: "09:00", close: "17:00", closed: true } };
    expect(getOpenStatus(hours, POS)).toEqual({ isOpen: true, label: "Open · Closes 17:00" });
    expect(todaysHoursLabel(hours, POS)).toBe("09:00 – 17:00");
  });

  it("Tokyo (ahead of UTC): Friday 10:00 there is open, though it is Thursday 01:00 in UTC", () => {
    at("2026-11-27T01:00:00Z"); // Friday 10:00 in Tokyo
    const hours = { thu: { open: "09:00", close: "17:00", closed: true }, fri: { open: "09:00", close: "17:00", closed: false } };
    expect(getOpenStatus(hours, TOKYO)).toEqual({ isOpen: true, label: "Open · Closes 17:00" });
    expect(todaysHoursLabel(hours, TOKYO)).toBe("09:00 – 17:00");
  });
});

describe("SEC-M2: only a real closed flag or valid HH:MM times count as set", () => {
  it("garbage for today beside one real closed day says nothing (not 'Closed Today')", () => {
    at("2026-11-23T15:00:00Z"); // Monday 11:00 in Port of Spain
    const hours = {
      sun: { open: "", close: "", closed: true },
      mon: { closed: "false" },
      tue: { open: "x", close: "y", closed: false },
    } as unknown as BusinessHours;
    expect(getOpenStatus(hours, POS)).toBeNull();
    expect(todaysHoursLabel(hours, POS)).toBeNull();
  });

  it("nothing but garbage is no hours at all", () => {
    at("2026-11-23T15:00:00Z");
    for (const hours of [
      { mon: { closed: "false" } },
      { mon: { closed: 1 } },
      { mon: { open: "09:00" } },
      { mon: "09:00-17:00" },
    ] as unknown as BusinessHours[]) {
      expect(getOpenStatus(hours, POS), JSON.stringify(hours)).toBeNull();
      expect(todaysHoursLabel(hours, POS), JSON.stringify(hours)).toBeNull();
    }
  });

  it("repair round 2: a closed flag that is neither a boolean nor absent ('true', 1, 'false') says nothing, beside valid times too", () => {
    // Round 1 read closed: "false" beside valid times as an open day; round 2 (orchestrator, 2026-11-26): a closed
    // flag that is not exactly true, false, undefined or null is unknown, so that day is neither open nor closed.
    at("2026-11-23T15:00:00Z");
    for (const closed of ["true", 1, "false"]) {
      const hours = { mon: { open: "09:00", close: "17:00", closed }, tue: { open: "09:00", close: "17:00", closed: false } } as unknown as BusinessHours;
      expect(getOpenStatus(hours, POS), `closed ${JSON.stringify(closed)}`).toBeNull();
      expect(todaysHoursLabel(hours, POS), `closed ${JSON.stringify(closed)}`).toBeNull();
    }
  });

  it("closed false, null or absent beside valid times is an open day", () => {
    at("2026-11-23T15:00:00Z");
    for (const day of [{ open: "09:00", close: "17:00", closed: false }, { open: "09:00", close: "17:00", closed: null }, { open: "09:00", close: "17:00" }]) {
      const hours = { mon: day } as unknown as BusinessHours;
      expect(getOpenStatus(hours, POS), JSON.stringify(day)).toEqual({ isOpen: true, label: "Open · Closes 17:00" });
      expect(todaysHoursLabel(hours, POS), JSON.stringify(day)).toBe("09:00 – 17:00");
    }
  });

  it("closed === true is closed", () => {
    at("2026-11-23T15:00:00Z");
    const hours = { mon: { open: "09:00", close: "17:00", closed: true } };
    expect(getOpenStatus(hours, POS)).toEqual({ isOpen: false, label: "Closed Today" });
    expect(todaysHoursLabel(hours, POS)).toBe("Closed");
  });
});

describe("MIN-4: the hero and the trust bar use the same validity rule", () => {
  it("'9am'-'5pm' shows neither an open state nor a 'Today' line", () => {
    at("2026-11-26T15:00:00Z");
    const hours = every("9am", "5pm");
    expect(getOpenStatus(hours, POS)).toBeNull();
    expect(todaysHoursLabel(hours, POS)).toBeNull();
  });

  it("out-of-range times are invalid too", () => {
    at("2026-11-26T15:00:00Z");
    for (const [open, close] of [["25:00", "17:00"], ["09:60", "17:00"], ["09:00", "9"]]) {
      expect(getOpenStatus(every(open, close), POS), `${open}-${close}`).toBeNull();
      expect(todaysHoursLabel(every(open, close), POS), `${open}-${close}`).toBeNull();
    }
  });
});

describe("MIN-3: hours past midnight (18:00-02:00)", () => {
  const late = every("18:00", "02:00");

  it("23:00 Thursday: open, closes 02:00", () => {
    at("2026-11-27T03:00:00Z"); // Thursday 23:00 in Port of Spain
    expect(getOpenStatus(late, POS)).toEqual({ isOpen: true, label: "Open · Closes 02:00" });
    expect(todaysHoursLabel(late, POS)).toBe("18:00 – 02:00");
  });

  it("00:30 Friday: still open from Thursday, closes 02:00 (not 'Opens at 18:00')", () => {
    at("2026-11-27T04:30:00Z"); // Friday 00:30 in Port of Spain
    expect(getOpenStatus(late, POS)).toEqual({ isOpen: true, label: "Open · Closes 02:00" });
    expect(todaysHoursLabel(late, POS), "the span in progress").toBe("18:00 – 02:00");
  });

  it("03:00 Friday: closed until 18:00", () => {
    at("2026-11-27T07:00:00Z"); // Friday 03:00 in Port of Spain
    expect(getOpenStatus(late, POS)).toEqual({ isOpen: false, label: "Opens at 18:00" });
    expect(todaysHoursLabel(late, POS)).toBe("18:00 – 02:00");
  });

  it("Thursday's late span still runs at 00:30 on a Friday the business is closed", () => {
    const hours = { thu: { open: "18:00", close: "02:00", closed: false }, fri: { open: "09:00", close: "17:00", closed: true } };
    at("2026-11-27T04:30:00Z");
    expect(getOpenStatus(hours, POS)).toEqual({ isOpen: true, label: "Open · Closes 02:00" });
    expect(todaysHoursLabel(hours, POS)).toBe("18:00 – 02:00");
    at("2026-11-27T07:00:00Z");
    expect(getOpenStatus(hours, POS)).toEqual({ isOpen: false, label: "Closed Today" });
    expect(todaysHoursLabel(hours, POS)).toBe("Closed");
  });

  it("a day span is unchanged: 09:00-17:00 at 08:00, 12:00 and 18:00", () => {
    const day = every("09:00", "17:00");
    at("2026-11-26T12:00:00Z");
    expect(getOpenStatus(day, POS)).toEqual({ isOpen: false, label: "Opens at 09:00" });
    at("2026-11-26T16:00:00Z");
    expect(getOpenStatus(day, POS)).toEqual({ isOpen: true, label: "Open · Closes 17:00" });
    at("2026-11-26T22:00:00Z");
    expect(getOpenStatus(day, POS)).toEqual({ isOpen: false, label: "Closed Now" });
  });
});

describe("repair round 2: HH:MM:SS and a 24:00 close", () => {
  it("times with seconds read as their HH:MM", () => {
    at("2026-11-26T16:00:00Z"); // Thursday 12:00 in Port of Spain
    const hours = every("09:00:00", "17:00:00");
    expect(getOpenStatus(hours, POS)).toEqual({ isOpen: true, label: "Open · Closes 17:00" });
    expect(todaysHoursLabel(hours, POS)).toBe("09:00 – 17:00");
  });

  it("a 24:00 close is the end of the day, open until midnight", () => {
    const hours = every("18:00", "24:00");
    at("2026-11-27T03:30:00Z"); // Thursday 23:30 in Port of Spain
    expect(getOpenStatus(hours, POS)).toEqual({ isOpen: true, label: "Open · Closes 24:00" });
    expect(todaysHoursLabel(hours, POS)).toBe("18:00 – 24:00");
    at("2026-11-27T04:30:00Z"); // Friday 00:30: Thursday's span ended at midnight
    expect(getOpenStatus(hours, POS)).toEqual({ isOpen: false, label: "Opens at 18:00" });
  });

  it("24:00 is not an opening time, and seconds out of range are invalid", () => {
    at("2026-11-26T16:00:00Z");
    for (const [open, close] of [["24:00", "17:00"], ["09:00:60", "17:00"]]) {
      expect(getOpenStatus(every(open, close), POS), `${open}-${close}`).toBeNull();
      expect(todaysHoursLabel(every(open, close), POS), `${open}-${close}`).toBeNull();
    }
  });
});
