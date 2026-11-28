/**
 * EXPENSES-HUB-3 repair round 1 (acceptance reviews at f6d3c2f0), the Expenses page and its data hook.
 *
 *   SEC-EXH3-1  a business switch with the page open: every figure of the old business goes, the page re-reads for
 *               the new one, late replies for the old one are dropped; the toolbar upload and the save use the
 *               page's own business (a receipt path of another business is never attached)
 *   SEC-EXH3-2  an ok read, then a refusal on refetch, clears the hook's data (not only the render gate)
 *   COR MINOR-2 the toolbar upload keeps the Drive copy the sheet's own photo makes
 *   COR MINOR-3 the Categories tab shows no trend the browser invented ("Spike +100%" on a prevTotal of 0)
 *   COR MINOR-5 page sums say "on this page"; "Missing receipts" is the server's count; no "Owner" column showing the
 *               vendor; no "Forecast risk this month"
 *   COR MINOR-7 a refused summary or budgets read shows no zeros for its block; no stored business is said, not spun
 *   COR MINOR-6 the Recurring builder opens only on a new click, not on every later visit to the tab
 *   COR MINOR-8 a member refused the expenses read is not offered Record bill or Add expense
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, renderHook, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
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
const uploadFile = vi.hoisted(() => vi.fn());
const uploadToDrive = vi.hoisted(() => vi.fn(async (_req: Record<string, unknown>) => true));

vi.mock("@/lib/client", () => ({ ...client, PAYMENT_METHODS: [{ value: "cash", label: "Cash" }] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile, isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
vi.mock("@/lib/api/finance", () => ({ createBill: vi.fn(), payBill: vi.fn(), voidBill: vi.fn() }));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: "Co", currency: "TTD", timezone: "America/Port_of_Spain" } : null),
  getStoredBusinessId: () => ws.bid,
}));

import { toast } from "sonner";
import ExpensesInboxPage from "../page";
import { useExpensesData } from "../components/use-expenses-data";

const ok = <T,>(data: T) => ({ data, error: null });
const REFUSED = { data: null, error: "Insufficient permissions: expenses requires read access (you have none)", status: 403 };
const text = () => document.body.textContent?.replace(/\s+/g, " ") ?? "";

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: "exp_a1",
    description: "Alpha rent",
    amount: 4321,
    currency: "TTD",
    date: "2026-11-20T00:00:00.000Z",
    vendor: "Alpha Landlord",
    paymentMethod: "cash",
    tags: [],
    isRecurring: false,
    status: "PAID",
    categoryId: null,
    createdAt: "2026-11-20T00:00:00.000Z",
    updatedAt: "2026-11-20T00:00:00.000Z",
    ...over,
  } as Expense;
}

function summary(total: number, extra: Record<string, unknown> = {}) {
  return { total, count: 1, byCategory: [], missingReceiptCount: 0, comparison: { prevTotal: 0, prevCount: 0, changePercent: 0, direction: "flat" }, ...extra };
}

/** Per-business answers: each business reads only its own rows. */
function booksFor(byBusiness: Record<string, { expenses: Expense[]; total: number }>) {
  client.fetchExpenses.mockImplementation(async (b: string) => ok({ data: byBusiness[b]?.expenses ?? [], total: byBusiness[b]?.expenses.length ?? 0, page: 1, limit: 20 }));
  client.fetchExpenseSummary.mockImplementation(async (b: string) => ok(summary(byBusiness[b]?.total ?? 0)));
}

beforeEach(() => {
  ws.bid = "biz_A";
  for (const fn of Object.values(client)) fn.mockReset();
  client.getExpenseExportUrl.mockReturnValue("http://api.test/export.csv");
  client.fetchExpenses.mockResolvedValue(ok({ data: [], total: 0, page: 1, limit: 20 }));
  client.fetchExpenseCategories.mockResolvedValue(ok([]));
  client.fetchExpenseSummary.mockResolvedValue(ok(summary(0)));
  client.fetchVendorAnalytics.mockResolvedValue(ok([]));
  client.fetchExpenseBudgets.mockResolvedValue(ok([]));
  client.fetchMarginAnalysis.mockResolvedValue(ok(null));
  client.fetchRecurringCandidates.mockResolvedValue(ok({ candidates: [] }));
  client.fetchProjects.mockResolvedValue(ok([]));
  client.fetchServices.mockResolvedValue(ok([]));
  client.fetchContacts.mockResolvedValue(ok({ contacts: [] }));
  client.fetchRecurringExpenses.mockResolvedValue(ok([]));
  client.createExpense.mockResolvedValue(ok({ id: "exp_new", description: "x", amount: 1, status: "PAID" }));
  uploadFile.mockReset();
  uploadToDrive.mockClear();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

afterEach(() => cleanup());

/**
 * P265 R2: reads held on a gate, for the twins. A 0 ms timer raced the next poll of a call-only wait, so a twin failed
 * in some whole-file runs and not others. Here the reads answer only once released, and the release is scheduled
 * right after the call-only wait (afterRequest), so a lookup made at once always runs before any reply.
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
/** Right after a wait that only checks a read was made: the held reads answer once this task has run on. */
const afterRequest = () => { const release = gate.release; setTimeout(release, 0); };
afterEach(() => { gate.release = () => {}; });

function switchTo(id: string) {
  ws.bid = id;
  act(() => {
    window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: id } }));
  });
}

/** A photo as a browser gives it (jsdom's File has no arrayBuffer; the sheet's Drive copy reads the bytes). */
const photo = () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const file = new File([bytes], "receipt.jpg", { type: "image/jpeg" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  return file;
};

describe("SEC-EXH3-1: a business switch with the Expenses page open", () => {
  it("drops every figure of the old business and re-reads for the new one", async () => {
    booksFor({ biz_A: { expenses: [expense()], total: 4321 }, biz_B: { expenses: [expense({ id: "exp_b1", description: "Beta fuel", amount: 55, vendor: "Beta Gas" })], total: 55 } });
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(text()).toMatch(/alpha rent/i));
    switchTo("biz_B");
    await waitFor(() => expect(text()).toMatch(/beta fuel/i));
    expect(client.fetchExpenses.mock.calls.at(-1)?.[0]).toBe("biz_B");
    expect(text()).not.toMatch(/alpha/i);
    expect(text()).not.toMatch(/4,321/);
  });

  it("shows nothing of the old business while the new one loads", async () => {
    booksFor({ biz_A: { expenses: [expense()], total: 4321 } });
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(text()).toMatch(/alpha rent/i));
    client.fetchExpenses.mockImplementation(() => new Promise(() => {}));
    switchTo("biz_B");
    await waitFor(() => expect(text()).not.toMatch(/alpha rent/i));
    expect(text()).not.toMatch(/4,321/);
  });

  it("a late reply for the old business is dropped", async () => {
    let resolveA: (v: unknown) => void = () => {};
    client.fetchExpenses.mockImplementation((b: string) =>
      b === "biz_A" ? new Promise((r) => { resolveA = r; }) : Promise.resolve(ok({ data: [expense({ id: "exp_b1", description: "Beta fuel", amount: 55 })], total: 1, page: 1, limit: 20 })),
    );
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()));
    switchTo("biz_B");
    await waitFor(() => expect(text()).toMatch(/beta fuel/i));
    await act(async () => { resolveA(ok({ data: [expense()], total: 1, page: 1, limit: 20 })); });
    expect(text()).not.toMatch(/alpha rent/i);
    expect(text()).toMatch(/beta fuel/i);
  });

  it("a receipt uploaded across a switch is not attached for the new business", async () => {
    let finish: (v: unknown) => void = () => {};
    uploadFile.mockImplementation(() => new Promise((r) => { finish = r; }));
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalled());
    fireEvent.change(await screen.findByLabelText(/^upload receipt$/i), { target: { files: [photo()] } });
    await waitFor(() => expect(uploadFile).toHaveBeenCalled());
    switchTo("biz_B");
    await act(async () => { finish({ uploadURL: "http://s3.test/put", objectPath: "/objects/uploads/biz_A/obj1", metadata: {} }); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(client.createExpense).not.toHaveBeenCalled();
  });

  it("a receipt path of another business is never attached", async () => {
    uploadFile.mockResolvedValue({ uploadURL: "http://s3.test/put", objectPath: "/objects/uploads/biz_OTHER/obj1", metadata: {} });
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalled());
    fireEvent.change(await screen.findByLabelText(/^upload receipt$/i), { target: { files: [photo()] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the toolbar upload refuses when the stored business is not the page's", async () => {
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()));
    ws.bid = "biz_B"; // stored behind the page's back, no event yet
    fireEvent.change(await screen.findByLabelText(/^upload receipt$/i), { target: { files: [photo()] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("the Add expense sheet open for the old business closes on a switch", async () => {
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalled());
    // P265: the button is offered once the read has answered ok, so it is waited for, not looked up at once.
    fireEvent.click(await screen.findByRole("button", { name: /^add expense$/i }, { timeout: 10000 }));
    expect(await screen.findByRole("dialog", {}, { timeout: 10000 })).toBeTruthy();
    switchTo("biz_B");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 10000 });
  }, 30000);
  it("P265: the same, with the expenses read held until after the lookup (as a network reply can be)", async () => {
    // The Add expense button is offered only once the expenses read has answered ok (page.tsx). A read that has been
    // made but not answered yet must not be taken as the button being there.
    holdReads([client.fetchExpenses]);
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalled());
    afterRequest();
    // P265: the button is offered once the read has answered ok, so it is waited for, not looked up at once.
    fireEvent.click(await screen.findByRole("button", { name: /^add expense$/i }, { timeout: 10000 }));
    expect(await screen.findByRole("dialog", {}, { timeout: 10000 })).toBeTruthy();
    switchTo("biz_B");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 10000 });
  }, 30000);
});

describe("SEC-EXH3-2: an ok read, then a refusal on refetch, clears the hook's data", () => {
  it("expenses, summary, budgets and categories are emptied by the refusal", async () => {
    client.fetchExpenses.mockResolvedValue(ok({ data: [expense()], total: 1, page: 1, limit: 20 }));
    client.fetchExpenseSummary.mockResolvedValue(ok(summary(4321)));
    client.fetchExpenseBudgets.mockResolvedValue(ok([{ id: "bud1", categoryId: "c1", amount: 100, spent: 10, remaining: 90, percentUsed: 10, isOverBudget: false, isNearAlert: false }]));
    client.fetchExpenseCategories.mockResolvedValue(ok([{ id: "c1", name: "Rent" }]));
    const { result } = renderHook(() => useExpensesData());
    await waitFor(() => expect(result.current.expenses).toHaveLength(1));
    expect(result.current.summary?.total).toBe(4321);

    client.fetchExpenses.mockResolvedValue(REFUSED);
    await act(async () => { result.current.setPeriod("90d"); });
    await waitFor(() => expect(result.current.read.kind).toBe("no-access"));
    expect(result.current.expenses).toEqual([]);
    expect(result.current.summary).toBeNull();
    expect(result.current.budgets).toEqual([]);
    expect(result.current.categories).toEqual([]);
  });
});

describe("COR MINOR-2: the toolbar upload keeps the Drive copy", () => {
  it("saving after the toolbar upload sends the photo to Drive, as the sheet's own photo does", async () => {
    uploadFile.mockResolvedValue({ uploadURL: "http://s3.test/put", objectPath: "/objects/uploads/biz_A/obj1", metadata: {} });
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalled());
    const file = photo();
    fireEvent.change(await screen.findByLabelText(/^upload receipt$/i), { target: { files: [file] } });
    const sheet = await screen.findByRole("dialog");
    fireEvent.change(within(sheet).getByPlaceholderText(/What was this expense for|description/i), { target: { value: "Flour" } });
    fireEvent.change(within(sheet).getByPlaceholderText("0.00"), { target: { value: "10" } });
    const buttons = within(sheet).getAllByRole("button", { name: /^(add|save|create)( expense)?$/i });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(client.createExpense).toHaveBeenCalled());
    await waitFor(() => expect(uploadToDrive).toHaveBeenCalledTimes(1));
    expect(uploadToDrive.mock.calls[0][0]).toMatchObject({ businessId: "biz_A", entityType: "expense", entityId: "exp_new", mimeType: "image/jpeg" });
  });
});

/** COR MINOR-3's body (P265 R1: shared with the delayed-read twin below). */
async function categoriesInventNoTrend() {
  client.fetchExpenseCategories.mockResolvedValue(ok([{ id: "c1", name: "Fuel", color: "#f97316", _count: { expenses: 2 } }]));
  client.fetchExpenseSummary.mockResolvedValue(ok(summary(200, {
    byCategory: [{ categoryId: "c1", name: "Fuel", color: "#f97316", total: 200, count: 2, prevTotal: 0, percent: 100 }],
    comparison: { prevTotal: 0, prevCount: 0, changePercent: 0, direction: "flat" },
  })));
  render(<ExpensesInboxPage />);
  await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalled());
  afterRequest();
  // P265 R1-1: the tabs are rendered once the expenses read has answered ok, so the tab is waited for.
  fireEvent.click(await screen.findByRole("tab", { name: "Categories" }, { timeout: 10000 }));
  await waitFor(() => expect(text()).toMatch(/fuel/i));
  expect(text()).not.toMatch(/spike/i);
  expect(text()).not.toMatch(/\+100%/);
  expect(text()).not.toMatch(/saved/i);
  expect(text()).not.toMatch(/trending down/i);
  expect(text()).not.toMatch(/vs prev period/i);
}
describe("COR MINOR-3: the Categories tab invents no trend", () => {
  it("a category with no spend last period shows no 'Spike' and no browser-made percentage", categoriesInventNoTrend);
});

describe("COR MINOR-5: page figures say what they are", () => {
  it("pending approval is 'on this page'; missing receipts is the server's count; no Owner column; no forecast risk", async () => {
    client.fetchExpenses.mockResolvedValue(ok({ data: [expense({ status: "BILL", amount: 70 })], total: 45, page: 1, limit: 20 }));
    client.fetchExpenseSummary.mockResolvedValue(ok(summary(500, { missingReceiptCount: 7 })));
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(text()).toMatch(/alpha rent/i));
    // The stat card, not the status tab of the same name.
    const pending = screen.getAllByRole("button", { name: /pending approval/i }).find((b) => /TTD/.test(b.textContent ?? ""))!;
    expect(pending, "the Pending approval card").toBeTruthy();
    expect(pending.textContent).toMatch(/on this page/i);
    const missing = screen.getByRole("button", { name: /missing receipts/i });
    expect(within(missing).getByText("7"), "the server's missing-receipt count").toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: /^owner$/i })).toBeNull();
    expect(text()).not.toMatch(/forecast risk/i);
  });
});

describe("COR MINOR-7: each block is gated on its own read", () => {
  it("a refused summary shows no TTD 0.00 for the spend; refused budgets show no '0 categories'", async () => {
    client.fetchExpenses.mockResolvedValue(ok({ data: [expense()], total: 1, page: 1, limit: 20 }));
    client.fetchExpenseSummary.mockResolvedValue(REFUSED);
    client.fetchExpenseBudgets.mockResolvedValue(REFUSED);
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(text()).toMatch(/alpha rent/i));
    const spent = screen.getByRole("button", { name: /^spent/i });
    expect(spent.textContent).not.toMatch(/0\.00/);
    expect(spent.textContent).toMatch(/no access/i);
    const over = screen.getByRole("button", { name: /over budget/i });
    expect(over.textContent).not.toMatch(/0 categories/);
    expect(over.textContent).toMatch(/no access/i);
    expect(text()).not.toMatch(/no budgets set/i);
  });

  it("with no stored business the page says so and does not spin", async () => {
    ws.bid = null;
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(text()).toMatch(/no business (is )?selected/i));
    expect(screen.queryByRole("status", { name: /loading expenses/i })).toBeNull();
    expect(client.fetchExpenses).not.toHaveBeenCalled();
  });
});

/** COR MINOR-6's body (P265 R1: shared with the delayed-read twin below). */
async function recurringOpensOnce() {
  render(<ExpensesInboxPage />);
  await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalled());
  afterRequest();
  // P265 R1-2: the same for the Recurring tab.
  fireEvent.click(await screen.findByRole("tab", { name: "Recurring" }, { timeout: 10000 }));
  // R26-6: the button is offered once the Recurring list's read has answered, so it is awaited.
  fireEvent.click(await screen.findByRole("button", { name: /new recurring expense/i }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Expenses" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("tab", { name: "Recurring" }));
  await screen.findByText(/no recurring expenses/i);
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByRole("dialog")).toBeNull();
}
describe("COR MINOR-6: the Recurring builder opens only on a new click", () => {
  it("New recurring opens it once; leaving and coming back to the tab does not reopen it", recurringOpensOnce);
});

describe("COR MINOR-8: no expense writes are offered to a member refused the read", () => {
  it("no Record bill and no Add expense on the no-access state", async () => {
    client.fetchExpenses.mockResolvedValue(REFUSED);
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(text()).toMatch(/no access/i));
    expect(screen.queryByRole("button", { name: /^record bill$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^add expense$/i })).toBeNull();
  });
});

describe("P265 R1: the tab tests with every default expenses read held until after the lookup (as network replies can be)", () => {
  beforeEach(() => {
    holdReads([client.fetchExpenses, client.fetchExpenseCategories, client.fetchExpenseSummary, client.fetchExpenseBudgets]);
  });
  it("COR MINOR-3, delayed: the Categories tab invents no trend", categoriesInventNoTrend, 30000);
  it("COR MINOR-6, delayed: the Recurring builder opens only on a new click", recurringOpensOnce, 30000);
});
