/**
 * EXPENSES-HUB-3 repair round 20 (R19 reviews at 7a0cb4e): the export's file name.
 *
 *   R20-7  invisible letters (Hangul fillers U+3164, U+1160, U+115F, U+FFA0, and default-ignorable code points) are
 *          dropped: a name of fillers only falls back to the id; a first cluster too large for the bound ends the slug
 *          there (it falls back to the id, never to the clusters after it)
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


const NOON_UTC = new Date("2026-11-20T12:00:00.000Z");
const fileFor = (name: string, id = "biz_A") => {
  ws.cached = { id, name, timezone: "America/Port_of_Spain" };
  return expenseExportFileName(id, NOON_UTC);
};
const slugOf = (file: string) => file.replace(/^expenses-/, "").replace(/-\d{4}-\d{2}-\d{2}\.csv$/, "");
void canStartFor; void startRefusal; void BUSINESS_CHANGED_ELSEWHERE;


describe("R20-7: invisible letters and the oversized first cluster", () => {
  it.each([
    ["\u3164\u3164"],
    ["\u1160\u115F"],
    ["\uFFA0"],
    ["\u3164 \u200B \u2060"],
  ])("%j falls back to the id", (name) => {
    expect(slugOf(fileFor(name))).toBe("biz-a");
  });

  it("'Shop' with a filler inside is shop", () => {
    expect(slugOf(fileFor("Sh\u3164op"))).toBe("shop");
  });

  it("an oversized first cluster, then a word: falls back to the id", () => {
    expect(slugOf(fileFor("\u0E01" + "\u0E48".repeat(300) + " shop"))).toBe("biz-a");
  });
});
