/**
 * EXPENSES-HUB-3 repair round 17 (R16 reviews at 4e1ef6b): the export's file name.
 *
 *   R17-3  the 60-character cap counts characters (code points), so a name is never cut inside a surrogate pair
 *   R17-4  combining marks are dropped only after a Latin letter ("Café Ñandú" is cafe-nandu); in other scripts they
 *          are part of the word and kept (Devanagari, Japanese voicing, Thai, Arabic)
 *   R17-7  blocked storage (getCachedBusiness throws) names the file after the business id
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ws = vi.hoisted(() => ({ blocked: false, cached: null as null | { id: string; name?: string; timezone?: string; currency?: string } }));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => { if (ws.blocked) throw new DOMException("The operation is insecure.", "SecurityError"); return ws.cached; },
  getStoredBusinessId: () => ws.cached?.id ?? null,
}));

import { expenseExportFileName } from "../components/expense-utils";

const NOON_UTC = new Date("2026-11-20T12:00:00.000Z");
beforeEach(() => { ws.cached = null; ws.blocked = false; });

const nameFor = (name: string | undefined, id = "biz_A", now = NOON_UTC) => {
  ws.cached = { id, name, timezone: "America/Port_of_Spain", currency: "TTD" };
  return expenseExportFileName(id, now);
};


const slugOf = (file: string) => file.replace(/^expenses-/, "").replace(/-\d{4}-\d{2}-\d{2}\.csv$/, "");

describe("R17-3: the cap counts characters", () => {
  it("59 letters and two astral characters: 60 characters, no lone surrogate", () => {
    const slug = slugOf(nameFor("a".repeat(59) + "𠀀𠀀"));
    expect(Array.from(slug)).toHaveLength(60);
    expect(slug).toBe("a".repeat(59) + "𠀀");
    expect(slug).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});

describe("R17-4: combining marks", () => {
  it.each([
    ["Café Ñandú", "cafe-nandu"],
    ["दुकान", "दुकान"],
    ["ガス", "ガス"],
    ["ไทยการค้า", "ไทยการค้า"],
    ["مَتجر", "مَتجر"],
  ])("%s keeps what its script needs: %s", (name, slug) => {
    expect(slugOf(nameFor(name))).toBe(slug.normalize("NFC"));
  });
});

describe("R17-7: blocked storage", () => {
  it("getCachedBusiness throwing names the file after the business id", () => {
    ws.blocked = true;
    expect(expenseExportFileName("biz_A", NOON_UTC)).toMatch(/^expenses-biz-a-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
