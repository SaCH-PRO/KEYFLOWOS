/**
 * EXPENSES-HUB-3 (SWP-EXPENSE-TABS-MOUNT; BUG-060; journey H4 "a category from a list").
 *
 * BUG-060: the Expenses page mounts neither the categories tab nor the recurring panel. Both components exist
 * (components/expense-categories-tab.tsx, components/recurring-expenses-panel.tsx) but nothing renders them, so no
 * category can be created anywhere in the app's Expenses screens and the sheet's category list stays empty.
 *
 * Mounted on the real page and the real tab components; only the client calls, next/navigation, sonner, the upload
 * hooks and the cached business are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const BUSINESS = "biz_hub3_tabs";

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
  getCachedBusiness: () => ({ id: "biz_hub3_tabs", name: "Tabs Co", currency: "TTD", timezone: "America/Port_of_Spain" }),
  getStoredBusinessId: () => "biz_hub3_tabs",
}));

import { toast } from "sonner";
import ExpensesInboxPage from "../page";

const ok = <T,>(data: T) => ({ data, error: null });

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
  client.getExpenseExportUrl.mockReturnValue("http://api.test/export.csv");
  client.fetchExpenses.mockResolvedValue(ok({ data: [], total: 0, page: 1, limit: 20 }));
  client.fetchExpenseCategories.mockResolvedValue(ok([]));
  client.fetchExpenseSummary.mockResolvedValue(ok({ total: 0, count: 0, byCategory: [] }));
  client.fetchVendorAnalytics.mockResolvedValue(ok([]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchMarginAnalysis.mockResolvedValue(ok(null));
  client.fetchRecurringCandidates.mockResolvedValue(ok({ candidates: [] }));
  client.fetchProjects.mockResolvedValue(ok([]));
  client.fetchServices.mockResolvedValue(ok([]));
  client.fetchContacts.mockResolvedValue(ok({ contacts: [] }));
  client.fetchRecurringExpenses.mockResolvedValue(ok([]));
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

afterEach(() => cleanup());

// R28: the whole page mounts here; under a loaded full-suite run its first read can take longer than waitFor's 1 s
// default and the test's 5 s default (one timeout seen under load, 3 of 3 passes alone). The waits are longer; what
// each test asserts is unchanged.
vi.setConfig({ testTimeout: 30000 });
/**
 * P265 R2-3: reads held on a gate, for the twin below; the release is scheduled right after mountPage's call-only
 * wait, so a lookup made at once always runs before any reply (as P265 R2-1 does in expenses-hub3-repair-page).
 */
const gate = { release: () => {} };
function holdReads(fns: Array<ReturnType<typeof vi.fn>>) {
  let release: () => void = () => {};
  const opened = new Promise<void>((r) => { release = r; });
  gate.release = release;
  for (const fn of fns) {
    const answer = fn.getMockImplementation();
    fn.mockImplementation((...args: unknown[]) => opened.then(() => (answer ? answer(...args) : undefined)));
  }
}
afterEach(() => { gate.release = () => {}; });
async function mountPage() {
  const view = render(<ExpensesInboxPage />);
  await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalled(), { timeout: 10000 });
  const release = gate.release;
  setTimeout(release, 0);
  // P265 R2-3: the view tabs are rendered once the expenses read has answered ok, so the first one is waited for (as
  // repair27 and repair28 do) before any case looks a tab up.
  await screen.findByRole("tab", { name: "Expenses" }, { timeout: 10000 });
  return view;
}

/** BUG-060's cases (P265 R2-3: run as they were, and again with the reads held until after mountPage's wait). */
function bug060Cases() {
  it("the page offers Expenses, Categories and Recurring views", async () => {
    await mountPage();
    const views = screen.getByRole("tablist", { name: /expenses views/i });
    const names = within(views).getAllByRole("tab").map((t) => t.textContent?.trim());
    expect(names).toEqual(["Expenses", "Categories", "Recurring"]);
  });

  it("a category is created from the Categories tab, and the Add expense sheet's list then offers it", async () => {
    client.createExpenseCategory.mockResolvedValue(ok({ id: "cat_new", name: "Supplies", color: "#f97316" }));
    await mountPage();
    fireEvent.click(screen.getByRole("tab", { name: "Categories" }));
    fireEvent.change(screen.getByPlaceholderText(/category name/i), { target: { value: "Supplies" } });
    fireEvent.click(screen.getByRole("button", { name: /^add category$/i }));

    await waitFor(() => expect(client.createExpenseCategory).toHaveBeenCalledTimes(1), { timeout: 10000 });
    expect(client.createExpenseCategory.mock.calls[0][0]).toBe(BUSINESS);
    expect(client.createExpenseCategory.mock.calls[0][1]).toMatchObject({ name: "Supplies" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Category created"), { timeout: 10000 });

    // The category is the page's own list: the sheet opened from the Expenses view offers it.
    fireEvent.click(screen.getByRole("tab", { name: "Expenses" }));
    fireEvent.click(screen.getByRole("button", { name: /^add expense$/i }));
    const sheet = await screen.findByRole("dialog", {}, { timeout: 10000 });
    const options = within(sheet).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Supplies");
  });

  it("a refused category create says so and is never reported as created", async () => {
    client.createExpenseCategory.mockResolvedValue({ data: null, error: "Insufficient permissions: expenses requires write access (you have read)", status: 403 });
    await mountPage();
    fireEvent.click(screen.getByRole("tab", { name: "Categories" }));
    fireEvent.change(screen.getByPlaceholderText(/category name/i), { target: { value: "Fuel" } });
    fireEvent.click(screen.getByRole("button", { name: /^add category$/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled(), { timeout: 10000 });
    expect(toast.success).not.toHaveBeenCalledWith("Category created");
    // What was typed stays, so the member can ask and try again.
    expect((screen.getByPlaceholderText(/category name/i) as HTMLInputElement).value).toBe("Fuel");
  });

  it("the Recurring tab mounts the recurring panel on the business's schedules", async () => {
    client.fetchRecurringExpenses.mockResolvedValue(ok([]));
    await mountPage();
    fireEvent.click(screen.getByRole("tab", { name: "Recurring" }));
    await waitFor(() => expect(client.fetchRecurringExpenses).toHaveBeenCalledWith(BUSINESS), { timeout: 10000 });
    expect(await screen.findByText(/no recurring expenses/i, {}, { timeout: 10000 })).toBeTruthy();
  });

  it("the Expenses view's status tabs and table are not shown on the Categories view", async () => {
    await mountPage();
    expect(screen.getByRole("button", { name: /^inbox/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Categories" }));
    expect(screen.queryByRole("button", { name: /^inbox/i })).toBeNull();
    expect(screen.getByText(/create category/i)).toBeTruthy();
  });
}
describe("BUG-060: the categories tab and the recurring panel are mounted on the Expenses page", bug060Cases);
describe("P265 R2-3: BUG-060 with every default expenses read held until after mountPage's wait", () => {
  beforeEach(() => {
    holdReads([client.fetchExpenses, client.fetchExpenseCategories, client.fetchExpenseSummary, client.fetchExpenseBudgets]);
  });
  bug060Cases();
});
