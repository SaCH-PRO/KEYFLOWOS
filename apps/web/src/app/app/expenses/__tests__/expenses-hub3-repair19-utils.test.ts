/**
 * EXPENSES-HUB-3 repair round 19 (R18 reviews at c2a3e49): the export's file name.
 *
 *   R19-4  the slug drops supplementary variation selectors (U+E0100-E01EF) and enclosing marks (\p{Me}); a mark with
 *          no letter before it is dropped wherever it is (after a digit too: "1\u0301x" is 1x); and the slug is bounded
 *          in size as well as in graphemes, so the whole file name stays under 255 bytes of UTF-8
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
const bytes = (s: string) => new TextEncoder().encode(s).length;
void canStartFor; void startRefusal; void BUSINESS_CHANGED_ELSEWHERE;

describe("R19-4: the slug", () => {
  it.each([
    ["Bakery\u{E0100}", "bakery"],
    ["Shop ⃝", "shop"],
    ["1́x", "1x"],
    ["Caf⃝e", "cafe"],
  ])("%j gives %s", (name, slug) => {
    expect(slugOf(fileFor(name))).toBe(slug);
  });

  it("'ก' and 300 tone marks: the whole file name stays under 255 bytes", () => {
    const file = fileFor("ก" + "่".repeat(300));
    expect(bytes(file)).toBeLessThan(255);
  });

  it("'दु' 60 times: under 255 bytes, and never a cluster cut in two", () => {
    const file = fileFor("दु".repeat(60));
    expect(bytes(file)).toBeLessThan(255);
    const slug = slugOf(file);
    expect(slug.length % 2, "a cluster was cut").toBe(0);
    expect(slug).toMatch(/^(दु)+$/);
  });
});
