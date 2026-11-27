/**
 * EXPENSES-HUB-3 repair round 16 (R15 reviews at 89f75fa): the export's file name.
 *
 *   R16-4  names keep their letters and digits in any script (NFKD, accents dropped: "Café Ñandú" is "cafe-nandu");
 *          a name with none falls back to the business id's slug, so two such businesses never share a name; the
 *          slug is at most 60 characters; nothing path-like survives; the date is the business's own day
 *   R16-5  the cached business is used only when it is this business: A's export is never named after B
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ws = vi.hoisted(() => ({ cached: null as null | { id: string; name?: string; timezone?: string; currency?: string } }));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => ws.cached,
  getStoredBusinessId: () => ws.cached?.id ?? null,
}));

import { expenseExportFileName } from "../components/expense-utils";

const NOON_UTC = new Date("2026-11-20T12:00:00.000Z");
beforeEach(() => { ws.cached = null; });

const nameFor = (name: string | undefined, id = "biz_A", now = NOON_UTC) => {
  ws.cached = { id, name, timezone: "America/Port_of_Spain", currency: "TTD" };
  return expenseExportFileName(id, now);
};

describe("R16-4: the business part of the name", () => {
  it("drops accents but keeps the letters: 'Café Ñandú' is cafe-nandu", () => {
    expect(nameFor("Café Ñandú")).toBe("expenses-cafe-nandu-2026-11-20.csv");
  });

  it("keeps letters and digits of any script", () => {
    expect(nameFor("東京商店 2")).toBe("expenses-東京商店-2-2026-11-20.csv");
    expect(nameFor("Пекарня")).toBe("expenses-пекарня-2026-11-20.csv");
  });

  it("a name with no letters or digits falls back to the business id, so two such businesses differ", () => {
    const a = nameFor("★★★", "biz_A");
    const b = nameFor("   ", "biz_B");
    expect(a).toBe("expenses-biz-a-2026-11-20.csv");
    expect(b).toBe("expenses-biz-b-2026-11-20.csv");
  });

  it("is at most 60 characters", () => {
    const name = nameFor("Long ".repeat(40));
    const slug = name.replace(/^expenses-/, "").replace(/-\d{4}-\d{2}-\d{2}\.csv$/, "");
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug).not.toMatch(/^-|-$/);
  });

  it("keeps nothing path-like", () => {
    const name = nameFor("../../etc/passwd\\x");
    expect(name).not.toMatch(/[/\\]|\.\./);
    expect(name).toBe("expenses-etc-passwd-x-2026-11-20.csv");
  });

  it("is dated on the business's own day, not UTC's", () => {
    ws.cached = { id: "biz_T", name: "Tokyo Co", timezone: "Asia/Tokyo", currency: "JPY" };
    // 20:00 UTC on the 20th is already the 21st in Tokyo.
    expect(expenseExportFileName("biz_T", new Date("2026-11-20T20:00:00.000Z"))).toBe("expenses-tokyo-co-2026-11-21.csv");
  });
});

describe("R16-5: only this business's cache entry names it", () => {
  it("with B's entry cached, A's export is named after A's id, not B", () => {
    ws.cached = { id: "biz_B", name: "B Bakery", timezone: "America/Port_of_Spain", currency: "TTD" };
    const name = expenseExportFileName("biz_A", NOON_UTC);
    expect(name).not.toMatch(/bakery/);
    expect(name).toBe("expenses-biz-a-2026-11-20.csv");
  });
});
