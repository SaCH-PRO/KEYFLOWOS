/**
 * EXPENSES-HUB-3 repair round 4 (round-3 confirmations at f28990b: security MINOR test gaps).
 *
 *   R4-1 a stale loadData of business A (a delete that started in A returns after another tab switched to B) never
 *        shows A's rows in B, and never leaves B loading: a stale call writes nothing and takes no generation
 *   R4-2 isOwnUploadPath requires the "/objects/" segment boundary ("/objectsXuploads/..." is not an upload)
 *   R4-3 an empty or missing business id makes nothing an own upload ("/objects/uploads//obj1")
 *   R4-4 an address on the API origin is judged by the parsed origin, not a string prefix: a disguised host
 *        ("http://API.test", "http://api.test:80") or a percent-encoded "/objects/" is never a link
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, render, screen, cleanup, waitFor, act } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));

const client = vi.hoisted(() => ({
  fetchExpenses: vi.fn(),
  fetchExpenseCategories: vi.fn(),
  fetchExpenseSummary: vi.fn(),
  fetchVendorAnalytics: vi.fn(),
  fetchExpenseBudgets: vi.fn(),
  fetchMarginAnalysis: vi.fn(),
  fetchRecurringCandidates: vi.fn(),
  fetchProjects: vi.fn(),
  fetchServices: vi.fn(),
  fetchContacts: vi.fn(),
  getExpense: vi.fn(),
  updateExpense: vi.fn(),
  deleteExpense: vi.fn(),
  createExpense: vi.fn(),
  createRecurringExpense: vi.fn(),
  extractReceipt: vi.fn(),
  fetchFinanceAccounts: vi.fn(),
}));

vi.mock("@/lib/client", () => ({ ...client, PAYMENT_METHODS: [] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/expenses/exp_r4",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: "exp_r4" }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
vi.mock("@/lib/api/finance", () => ({ createBill: vi.fn(), payBill: vi.fn(), voidBill: vi.fn() }));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: "Co", currency: "TTD", timezone: "America/Port_of_Spain" } : null),
  getStoredBusinessId: () => ws.bid,
}));

import { useExpensesData } from "../components/use-expenses-data";
import { isOwnUploadPath, receiptKind } from "../components/expense-form-sidesheet";
import ExpenseDetailPage from "../[id]/page";

const ok = <T,>(data: T) => ({ data, error: null });

function expense(id: string, description: string): Expense {
  return {
    id,
    description,
    amount: 10,
    currency: "TTD",
    date: "2026-11-20T00:00:00.000Z",
    vendor: "Vendor",
    paymentMethod: "cash",
    tags: [],
    isRecurring: false,
    status: "PAID",
    categoryId: null,
    createdAt: "2026-11-20T00:00:00.000Z",
    updatedAt: "2026-11-20T00:00:00.000Z",
  } as Expense;
}
const page = (rows: Expense[]) => ok({ data: rows, total: rows.length, page: 1, limit: 20 });

beforeEach(() => {
  ws.bid = "biz_A";
  for (const fn of Object.values(client)) fn.mockReset();
  client.fetchExpenseCategories.mockResolvedValue(ok([]));
  client.fetchExpenseSummary.mockResolvedValue(ok({ total: 0, count: 0, byCategory: [], missingReceiptCount: 0 }));
  client.fetchVendorAnalytics.mockResolvedValue(ok([]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchMarginAnalysis.mockResolvedValue(ok(null));
  client.fetchRecurringCandidates.mockResolvedValue(ok({ candidates: [] }));
  client.fetchProjects.mockResolvedValue(ok([]));
  client.fetchServices.mockResolvedValue(ok([]));
  client.fetchContacts.mockResolvedValue(ok({ contacts: [] }));
  client.fetchFinanceAccounts.mockResolvedValue(ok([]));
});
afterEach(() => cleanup());

function switchTo(id: string) {
  ws.bid = id;
  act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: id } })); });
}

describe("R4-1: a stale loadData of the old business", () => {
  it("returning after B's read, it never shows A's rows in B", async () => {
    client.fetchExpenses.mockImplementation(async (b: string) => (b === "biz_A" ? page([expense("a1", "Alpha rent")]) : page([expense("b1", "Beta fuel")])));
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["a1"]));
    const staleLoadOfA = result.current.loadData; // what a delete started in A calls when it returns
    switchTo("biz_B");
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["b1"]));
    await act(async () => { await staleLoadOfA(); });
    expect(result.current.businessId).toBe("biz_B");
    expect(result.current.expenses.map((e) => e.id)).toEqual(["b1"]);
    expect(result.current.read.kind).toBe("ok");
  });

  it("returning while B's read is still in flight, B still settles with its own rows", async () => {
    let resolveB: (v: unknown) => void = () => {};
    client.fetchExpenses.mockImplementation((b: string) =>
      b === "biz_A" ? Promise.resolve(page([expense("a1", "Alpha rent")])) : new Promise((r) => { resolveB = r; }),
    );
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["a1"]));
    const staleLoadOfA = result.current.loadData;
    switchTo("biz_B");
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_B", expect.anything()));
    await act(async () => { await staleLoadOfA(); });
    await act(async () => { resolveB(page([expense("b1", "Beta fuel")])); });
    await waitFor(() => expect(result.current.read.kind).toBe("ok"));
    expect(result.current.loading).toBe(false);
    expect(result.current.expenses.map((e) => e.id)).toEqual(["b1"]);
  });
});

describe("R4-2 / R4-3: isOwnUploadPath", () => {
  it.each([
    ["/objectsXuploads/biz_A/x", "biz_A", false],
    ["/objects/uploads/biz_A/x", "biz_A", true],
    ["/objects/uploads//obj1", "", false],
    ["/objects/uploads//obj1", null, false],
    ["/objects/uploads/undefined/obj1", undefined, false],
  ])("%s for %s → %s", (path, bid, expected) => {
    expect(isOwnUploadPath(path, bid as string)).toBe(expected);
  });

  it("receiptKind with an empty or missing business id never says stored", () => {
    expect(receiptKind("http://api.test/objects/uploads//obj1", "")).not.toBe("stored");
    expect(receiptKind("/objects/uploads//obj1", null)).not.toBe("stored");
    expect(receiptKind("/objects/uploads//obj1", "")).not.toBe("stored");
  });
});

describe("R4-4: disguised API-host and encoded /objects/ paths are never a link", () => {
  it.each([
    "http://API.test/%6Fbjects/uploads/biz2/x.png",
    "http://api.test:80/obj%65cts/uploads/biz2/x.png",
    "http://API.test/objects/uploads/biz_A/obj1",
    "http://api.test:80/objects/uploads/biz_A/obj1",
    "https://elsewhere.test/%6Fbjects/uploads/biz2/x.png",
    "https://elsewhere.test/obj%65cts/x.png",
    // On the API's origin nothing is a link, whatever its path, however the origin is written. (These pin the
    // parsed-origin comparison against the raw string "http://api.test/"; the URL parser itself lower-cases the host,
    // so they do not test hostKey's toLowerCase.)
    "http://API.test/files/x.png",
    "http://api.test:80/x.png",
    "http://api.test/x.png",
  ])("%s is not a link", (url) => {
    expect(receiptKind(url, "biz_A")).not.toBe("link");
  });

  it("an ordinary http(s) receipt elsewhere is still a link", () => {
    expect(receiptKind("https://drive.google.com/file/d/abc/view", "biz_A")).toBe("link");
  });

  for (const url of ["http://API.test/%6Fbjects/uploads/biz2/x.png", "http://api.test:80/obj%65cts/uploads/biz2/x.png"]) {
    it(`the detail page puts ${url} in no href and no img src`, async () => {
      client.getExpense.mockResolvedValue(ok({ ...expense("exp_r4", "Toner"), vendor: "Office Depot", receiptUrl: url }));
      render(<ExpenseDetailPage />);
      await screen.findByRole("heading", { name: "Office Depot" });
      const hrefs = Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href"));
      const srcs = Array.from(document.querySelectorAll("img[src]")).map((i) => i.getAttribute("src"));
      expect(hrefs).not.toContain(url);
      expect(srcs).not.toContain(url);
    });
  }
});
