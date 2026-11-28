/**
 * EXPENSES-HUB-3 repair round 11 (M40 security wave confirmation), the Categories tab across a business switch.
 *
 *   R11-1 MAJOR  a category created on business A whose create answers after the switch to B is not added to B's
 *                list (nor B's Filters dropdown), and "Category created" is not said on B
 *   R11-2        the same for a delete: A's delete answering on B says nothing on B ("Category deleted" or a refusal)
 *   R11-3 control  on one business, create and delete still add, remove and say so
 *
 * Mounted on the real page, its data hook and the real Categories tab; only the client calls, next/navigation,
 * sonner, the upload hooks and the stored business are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, renderHook, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));
const client = vi.hoisted(() => ({
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
}));

vi.mock("@/lib/client", () => ({ ...client, PAYMENT_METHODS: [{ value: "cash", label: "Cash" }] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
vi.mock("@/lib/api/finance", () => ({ createBill: vi.fn(), payBill: vi.fn(), voidBill: vi.fn() }));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: `${ws.bid} Co`, currency: "TTD", timezone: "America/Port_of_Spain" } : null),
  getStoredBusinessId: () => ws.bid,
}));

import { toast } from "sonner";
import ExpensesInboxPage from "../page";
import { useExpensesData } from "../components/use-expenses-data";

const ok = <T,>(data: T) => ({ data, error: null });
const CATS: Record<string, Array<{ id: string; name: string; color: string }>> = {
  biz_A: [{ id: "cat_A_fuel", name: "Fuel A", color: "#f97316" }],
  biz_B: [{ id: "cat_B_rent", name: "Rent B", color: "#06b6d4" }],
};

function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

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
  client.fetchRecurringExpenses.mockResolvedValue(ok([]));
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(() => cleanup());

async function openCategoriesOf(name: string) {
  render(<ExpensesInboxPage />);
  fireEvent.click(await screen.findByRole("tab", { name: "Categories" }));
  await screen.findByText(name);
}

function switchTo(bid: string) {
  ws.bid = bid;
  act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: bid } })); });
}

/** The option labels of the Expenses view's category filter (the Filters panel, opened). */
function filterOptions(): string[] {
  fireEvent.click(screen.getByRole("tab", { name: "Expenses" }));
  const toggle = screen.getByRole("button", { name: "Filters" });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  const select = screen.getByRole("combobox", { name: "Category" });
  return Array.from(select.querySelectorAll("option")).map((o) => o.textContent ?? "");
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

describe("R11-1: A's category create answering after the switch to B", () => {
  it("is not added to B's list or B's filter, and 'Category created' is not said", async () => {
    const create = deferred<{ data: { id: string; name: string; color: string }; error: null }>();
    client.createExpenseCategory.mockReturnValue(create.promise);
    await openCategoriesOf("Fuel A");
    fireEvent.change(screen.getByPlaceholderText(/category name/i), { target: { value: "Supplies" } });
    fireEvent.click(screen.getByRole("button", { name: /^add category$/i }));
    await waitFor(() => expect(client.createExpenseCategory).toHaveBeenCalledWith("biz_A", expect.objectContaining({ name: "Supplies" })));

    switchTo("biz_B");
    await screen.findByText("Rent B"); // B's categories read has landed
    await act(async () => { create.resolve(ok({ id: "cat_A_supplies", name: "Supplies", color: "#f97316" })); });
    await settle();

    expect(screen.queryByText("Supplies"), "A's category is in B's list").toBeNull();
    expect(toast.success).not.toHaveBeenCalledWith("Category created");
    const options = filterOptions();
    expect(options).toContain("Rent B");
    expect(options, "A's category is in B's Filters dropdown").not.toContain("Supplies");
  });
});

describe("R11-1b: A's refused or failed create answering after the switch to B", () => {
  it.each([
    ["refused", { data: null, error: "Insufficient permissions: expenses requires write access (you have read)", status: 403 }],
    ["empty", { data: null, error: null }],
  ])("says nothing on B when A's create is %s", async (_what, answer) => {
    const create = deferred<unknown>();
    client.createExpenseCategory.mockReturnValue(create.promise);
    await openCategoriesOf("Fuel A");
    fireEvent.change(screen.getByPlaceholderText(/category name/i), { target: { value: "Supplies" } });
    fireEvent.click(screen.getByRole("button", { name: /^add category$/i }));
    await waitFor(() => expect(client.createExpenseCategory).toHaveBeenCalled());
    switchTo("biz_B");
    await screen.findByText("Rent B");
    await act(async () => { create.resolve(answer); });
    await settle();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("R11-1c: the data hook's category writers", () => {
  it("write only for the business shown", async () => {
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.categories.map((c) => c.name)).toEqual(["Fuel A"]));
    switchTo("biz_B");
    await waitFor(() => expect(result.current.categories.map((c) => c.name)).toEqual(["Rent B"]));
    const cat = { id: "cat_A_supplies", name: "Supplies", color: "#f97316" } as never;
    let added = true;
    let removed = true;
    act(() => { added = result.current.addCategory("biz_A", cat); });
    act(() => { removed = result.current.removeCategory("biz_A", "cat_B_rent"); });
    expect(added).toBe(false);
    expect(removed).toBe(false);
    expect(result.current.isCurrentBusiness("biz_A")).toBe(false);
    expect(result.current.categories.map((c) => c.name)).toEqual(["Rent B"]);
    act(() => { added = result.current.addCategory("biz_B", cat); });
    expect(added).toBe(true);
    expect(result.current.categories.map((c) => c.name)).toEqual(["Rent B", "Supplies"]);
  });
});

describe("R11-2: A's category delete answering after the switch to B", () => {
  it.each([
    ["deleted", ok(null)],
    ["refused", { data: null, error: "Insufficient permissions: expenses requires write access (you have read)", status: 403 }],
  ])("says nothing on B when A's delete is %s", async (_what, answer) => {
    const del = deferred<unknown>();
    client.deleteExpenseCategory.mockReturnValue(del.promise);
    await openCategoriesOf("Fuel A");
    fireEvent.click(screen.getByRole("button", { name: "Delete category Fuel A" }));
    await waitFor(() => expect(client.deleteExpenseCategory).toHaveBeenCalledWith("biz_A", "cat_A_fuel"));

    switchTo("biz_B");
    await screen.findByText("Rent B");
    await act(async () => { del.resolve(answer); });
    await settle();

    expect(toast.success).not.toHaveBeenCalledWith("Category deleted");
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByText("Rent B")).toBeTruthy();
  });
});

describe("R11-3 control: on one business, create and delete still work", () => {
  it("adds, then removes, and says so", async () => {
    client.createExpenseCategory.mockResolvedValue(ok({ id: "cat_A_supplies", name: "Supplies", color: "#f97316" }));
    client.deleteExpenseCategory.mockResolvedValue(ok(null));
    await openCategoriesOf("Fuel A");
    fireEvent.change(screen.getByPlaceholderText(/category name/i), { target: { value: "Supplies" } });
    fireEvent.click(screen.getByRole("button", { name: /^add category$/i }));
    await screen.findByText("Supplies");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Category created"));
    fireEvent.click(screen.getByRole("button", { name: "Delete category Supplies" }));
    await waitFor(() => expect(screen.queryByText("Supplies")).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Category deleted");
  });
});
