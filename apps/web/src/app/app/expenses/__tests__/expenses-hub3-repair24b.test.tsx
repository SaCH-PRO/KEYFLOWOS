/**
 * EXPENSES-HUB-3 repair round 24b (D-315: a refused secondary read is said, never shown as "no data").
 *
 *   (P252: the vendor-analytics, margin and recurring-patterns reads were removed with the tabs no v1 screen mounts;
 *   their cases here went with them.) The data hook's secondary reads (categories, and the
 *   projects, services and contacts the sheet links to) each keep a read state; a refused or failed one is a failed
 *   block, in the client's real failure shape ({ data: null, error }). Where v1 shows them (the Categories tab, the
 *   category filter, the Recurring view, the Add expense sheet) a failed block says "Couldn't load ..." with Retry,
 *   never its empty state; on another business nothing is set.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { ExpenseBudget, ExpenseCategory, RecurringExpense } from "@/lib/client";

const ZONES: Record<string, string> = vi.hoisted(() => ({ biz_A: "America/Port_of_Spain", biz_B: "America/Port_of_Spain" } as Record<string, string>));
const CURRENCIES: Record<string, string> = vi.hoisted(() => ({ biz_A: "TTD", biz_B: "USD" } as Record<string, string>));
const blocked = vi.hoisted(() => ({ on: false }));
const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));
const client = vi.hoisted(() => ({
  fetchFinanceAccounts: vi.fn(),
  fetchExpenses: vi.fn(),
  fetchExpenseCategories: vi.fn(),
  fetchExpenseSummary: vi.fn(),
  fetchVendorAnalytics: vi.fn(),
  fetchExpenseBudgets: vi.fn(),
  fetchMarginAnalysis: vi.fn(),
  fetchProjects: vi.fn(),
  fetchServices: vi.fn(),
  fetchContacts: vi.fn(),
  deleteExpense: vi.fn(),
  updateExpense: vi.fn(),
  createExpense: vi.fn(),
  getExpenseExportUrl: vi.fn(() => "http://api.test/export.csv"),
  createExpenseCategory: vi.fn(),
  deleteExpenseCategory: vi.fn(),
  fetchRecurringExpenses: vi.fn(),
  createRecurringExpense: vi.fn(),
  updateRecurringExpense: vi.fn(),
  cancelRecurringExpense: vi.fn(),
  runRecurringExpenseNow: vi.fn(),
  extractReceipt: vi.fn(),
  upsertExpenseBudget: vi.fn(),
  deleteExpenseBudget: vi.fn(),
}));

vi.mock("@/lib/client", () => ({ ...client, PAYMENT_METHODS: [{ value: "cash", label: "Cash" }] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
const upload = vi.hoisted(() => ({ uploadFile: vi.fn() }));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: upload.uploadFile, isUploading: false, progress: 0 }) }));
const drive = vi.hoisted(() => ({ uploadToDrive: vi.fn() }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: drive.uploadToDrive }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
const finance = vi.hoisted(() => ({ createBill: vi.fn(), payBill: vi.fn(), voidBill: vi.fn() }));
vi.mock("@/lib/api/finance", () => finance);
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: `${ws.bid} Co`, currency: CURRENCIES[ws.bid] ?? "TTD", timezone: ZONES[ws.bid] ?? "America/Port_of_Spain" } : null),
  getStoredBusinessId: () => { if (blocked.on) throw new DOMException("The operation is insecure.", "SecurityError"); return ws.bid; },
}));

import { toast } from "sonner";
import { useExpensesData } from "../components/use-expenses-data";
import ExpensesInboxPage from "../page";
import { renderHook } from "@testing-library/react";

const ok = <T,>(data: T) => ({ data, error: null });
const CATS: Record<string, ExpenseCategory[]> = {
  biz_A: [{ id: "cat_A_fuel", name: "Fuel A", color: "#f97316" } as ExpenseCategory],
  biz_B: [{ id: "cat_B_rent", name: "Rent B", color: "#06b6d4" } as ExpenseCategory],
};

function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const SCHEDULE = {
  id: "rec_A1", name: "Rent", frequency: "MONTHLY", nextRunDate: "2026-12-01T00:00:00.000Z", isActive: true, runCount: 0,
  failureCount: 0, description: "Rent", amount: 1000, currency: "TTD", createsBill: false,
} as RecurringExpense;
const _BUDGET = { id: "bud_A1", amount: 500, spent: 100, remaining: 400, percentUsed: 20, isOverBudget: false, isNearAlert: false, categoryId: "cat_A_fuel", category: CATS.biz_A[0], month: 11, year: 2026, alertAt: 80 } as unknown as ExpenseBudget;

beforeEach(() => {
  ws.bid = "biz_A";
  for (const fn of Object.values(client)) fn.mockReset();
  client.getExpenseExportUrl.mockReturnValue("http://api.test/export.csv");
  client.fetchExpenses.mockResolvedValue(ok({ data: [], total: 0, page: 1, limit: 20 }));
  client.fetchExpenseCategories.mockImplementation(async (b: string) => ok(CATS[b] ?? []));
  client.fetchExpenseSummary.mockResolvedValue(ok({ total: 0, count: 0, byCategory: [] }));
  client.fetchVendorAnalytics.mockResolvedValue(ok([]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchMarginAnalysis.mockResolvedValue(ok(null));
  client.fetchProjects.mockResolvedValue(ok([]));
  client.fetchServices.mockResolvedValue(ok([]));
  client.fetchContacts.mockResolvedValue(ok({ contacts: [] }));
  client.fetchRecurringExpenses.mockImplementation(async (b: string) => ok(b === "biz_A" ? [SCHEDULE] : []));
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });





afterEach(() => {
  ZONES.biz_A = "America/Port_of_Spain";
  vi.useRealTimers();
});


afterEach(() => { blocked.on = false; });





// The client's real failure shape (lib/api.ts): an HTTP or network failure resolves, it never rejects.
const WORDS = "Request refused by the server";
const refusedAnswer = () => ({ data: null, error: WORDS, status: 503 });
const LONG = { timeout: 10000 };

async function pageFor(view?: "Categories" | "Recurring") {
  render(<ExpensesInboxPage />);
  await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()), LONG);
  if (view) fireEvent.click(await screen.findByRole("tab", { name: view }, LONG));
}

describe("R24b: the data hook's secondary reads, in the client's real failure shape", () => {
  const CASES = [
    ["categories", () => client.fetchExpenseCategories, "categoriesRead", /Couldn't load expense categories/],
  ] as const;
  for (const [name, call, key, words] of CASES) {
    it(`${name}: a refused read is a failed block, never an empty one`, async () => {
      call().mockResolvedValue(refusedAnswer());
      const { result } = renderHook(() => useExpensesData());
      await waitFor(() => expect((result.current as unknown as Record<string, { kind: string; message?: string }>)[key]?.kind).toBe("failed"));
      expect((result.current as unknown as Record<string, { message: string }>)[key].message).toMatch(words);
    });
    it(`${name}: control, a read that answers is ok`, async () => {
      const { result } = renderHook(() => useExpensesData());
      await waitFor(() => expect((result.current as unknown as Record<string, { kind: string }>)[key]?.kind).toBe("ok"));
    });
  }
  it("pickers: a refused projects, services or contacts read is a failed block", async () => {
    client.fetchServices.mockResolvedValue(refusedAnswer());
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.pickersRead?.kind).toBe("failed"));
    expect(result.current.pickersRead.kind === "failed" && result.current.pickersRead.message).toMatch(/Couldn't load the projects, services and contacts to link/);
  });
  it("pickers: control, answering reads are ok", async () => {
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.pickersRead?.kind).toBe("ok"));
  });
  it("A's categories refused after the switch to B do not fail B's block", async () => {
    const catA = deferred<unknown>();
    client.fetchExpenseCategories.mockImplementation((b: string) => (b === "biz_A" ? catA.promise : Promise.resolve(ok(CATS.biz_B))));
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(client.fetchExpenseCategories).toHaveBeenCalledWith("biz_A"));
    ws.bid = "biz_B";
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
    await waitFor(() => expect(result.current.categoriesRead?.kind).toBe("ok"));
    await act(async () => { catA.resolve(refusedAnswer()); });
    await settle();
    expect(result.current.categoriesRead.kind, "A's refusal failed B's categories").toBe("ok");
    expect(result.current.categories.map((c) => c.id)).toEqual(["cat_B_rent"]);
  });
});

describe("R24b: the page says a refused categories read where categories show", () => {
  it("the Categories tab: 'Couldn't load', never 'No categories yet', and Retry reads again", async () => {
    client.fetchExpenseCategories.mockResolvedValue(refusedAnswer());
    await pageFor("Categories");
    expect(await screen.findByText(/Couldn't load expense categories/, {}, LONG)).toBeTruthy();
    expect(screen.queryByText("No categories yet")).toBeNull();
    const before = client.fetchExpenseCategories.mock.calls.length;
    client.fetchExpenseCategories.mockImplementation(async (b: string) => ok(CATS[b] ?? []));
    fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]);
    await waitFor(() => expect(client.fetchExpenseCategories.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByText(/Couldn't load expense categories/)).toBeNull());
  }, 30000);
  it("the Categories tab: control, categories that answer are listed and nothing says it failed", async () => {
    await pageFor("Categories");
    expect(await screen.findAllByText("Fuel A", {}, LONG)).toBeTruthy();
    expect(screen.queryByText(/Couldn't load expense categories/)).toBeNull();
  }, 30000);
  it("the category filter says it", async () => {
    client.fetchExpenseCategories.mockResolvedValue(refusedAnswer());
    await pageFor();
    fireEvent.click(await screen.findByRole("button", { name: "Filters" }, LONG));
    const filters = document.getElementById("expenses-filters")!;
    await waitFor(() => expect(filters.textContent).toMatch(/Couldn't load expense categories/));
  }, 30000);
  it("the Recurring view says it", async () => {
    client.fetchExpenseCategories.mockResolvedValue(refusedAnswer());
    await pageFor("Recurring");
    expect(await screen.findByText(/Couldn't load expense categories/, {}, LONG)).toBeTruthy();
  }, 30000);
  it("the Add expense sheet says it under Category, and says the refused links", async () => {
    client.fetchExpenseCategories.mockResolvedValue(refusedAnswer());
    client.fetchProjects.mockResolvedValue(refusedAnswer());
    await pageFor();
    fireEvent.click((await screen.findAllByRole("button", { name: /add expense/i }, LONG))[0]);
    const dialog = await screen.findByRole("dialog", {}, LONG);
    await waitFor(() => expect(dialog.textContent).toMatch(/Couldn't load expense categories/));
    expect(dialog.textContent).toMatch(/Couldn't load the projects, services and contacts to link/);
  }, 30000);
  it("the Add expense sheet: control, nothing says it failed", async () => {
    await pageFor();
    fireEvent.click((await screen.findAllByRole("button", { name: /add expense/i }, LONG))[0]);
    const dialog = await screen.findByRole("dialog", {}, LONG);
    await settle();
    expect(dialog.textContent).not.toMatch(/Couldn't load/);
  }, 30000);
});

describe("R24b: the secondary blocks' states, around the main read and a switch", () => {
  it("a thrown picker read is a failed block too", async () => {
    client.fetchContacts.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.pickersRead?.kind).toBe("failed"));
  });
  it("Retry of a refused picker read reads it again", async () => {
    client.fetchProjects.mockResolvedValue(refusedAnswer());
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.pickersRead?.kind).toBe("failed"));
    const before = client.fetchProjects.mock.calls.length;
    client.fetchProjects.mockResolvedValue(ok([]));
    act(() => { result.current.retryPickers(); });
    await waitFor(() => expect(client.fetchProjects.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(result.current.pickersRead.kind).toBe("ok"));
  });
  it("when the whole read is refused, the secondary blocks failed with it (never loading for good)", async () => {
    client.fetchExpenses.mockResolvedValue(refusedAnswer());
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.categoriesRead?.kind).toBe("failed"));
  });
  it("a switch to B forgets A's refused block while B's read is out", async () => {
    client.fetchExpenseCategories.mockImplementation((b: string) => (b === "biz_A" ? Promise.resolve(refusedAnswer()) : new Promise(() => {})));
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.categoriesRead?.kind).toBe("failed"));
    ws.bid = "biz_B";
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } })); });
    await waitFor(() => expect(client.fetchExpenseCategories).toHaveBeenCalledWith("biz_B"));
    expect(result.current.categoriesRead.kind, "A's refusal said on B").toBe("loading");
  });
});
