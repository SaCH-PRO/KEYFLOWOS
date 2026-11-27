/**
 * EXPENSES-HUB-3 repair round 18 (R17 reviews at 1eee70b): the shared start check, and the export's file name.
 *
 *   R18-4  blocked storage (getStoredBusinessId throws) refuses the start, and says so truthfully (not "the business
 *          changed in another tab")
 *   R18-7  the slug drops emoji variation selectors and keycaps, and marks with no base letter, before deciding it is
 *          empty: "☕️" and "❤️" fall back to their ids, "Café ☕️" is cafe, a mark-only name falls back, "ा shop" is
 *          shop; the cap cuts between graphemes, never inside one
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ws = vi.hoisted(() => ({ throwStored: false, stored: "biz_A" as string | null, cached: null as null | { id: string; name?: string; timezone?: string } }));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => ws.cached,
  getStoredBusinessId: () => {
    if (ws.throwStored) throw new DOMException("The operation is insecure.", "SecurityError");
    return ws.stored;
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));

import { canStartFor, startRefusal, BUSINESS_CHANGED_ELSEWHERE, expenseExportFileName } from "../components/expense-utils";

beforeEach(() => {
  ws.throwStored = false;
  ws.stored = "biz_A";
  ws.cached = null;
});

describe("R18-4: blocked storage", () => {
  it("refuses the start", () => {
    ws.throwStored = true;
    expect(canStartFor("biz_A")).toBe(false);
    expect(canStartFor("biz_A", () => true)).toBe(false);
  });

  it("says it could not check which business is open, not that it changed", () => {
    ws.throwStored = true;
    const said = startRefusal("biz_A");
    expect(said).toMatch(/couldn't check which business is open/i);
    expect(said).not.toBe(BUSINESS_CHANGED_ELSEWHERE);
  });

  it("controls: the same business starts; another says it changed", () => {
    expect(startRefusal("biz_A")).toBeNull();
    ws.stored = "biz_B";
    expect(startRefusal("biz_A")).toBe(BUSINESS_CHANGED_ELSEWHERE);
  });
});

const NOON_UTC = new Date("2026-11-20T12:00:00.000Z");
const nameFor = (name: string, id = "biz_A") => {
  ws.cached = { id, name, timezone: "America/Port_of_Spain" };
  return expenseExportFileName(id, NOON_UTC).replace(/^expenses-/, "").replace(/-\d{4}-\d{2}-\d{2}\.csv$/, "");
};

describe("R18-7: the slug", () => {
  it.each([
    ["☕️", "biz-a"],
    ["❤️", "biz-a"],
    ["Café ☕️", "cafe"],
    ["́́", "biz-a"],
    ["ा shop", "shop"],
    ["1️⃣ Bakery", "1-bakery"],
  ])("%j gives %s", (name, slug) => {
    expect(nameFor(name)).toBe(slug);
  });

  it("the cap cuts between graphemes: 59 letters and 'दु' keep the sign or drop the whole cluster", () => {
    const slug = nameFor("a".repeat(59) + "दु");
    expect(slug === "a".repeat(59) + "दु" || slug === "a".repeat(59)).toBe(true);
    expect(slug.endsWith("द")).toBe(false);
  });
});
