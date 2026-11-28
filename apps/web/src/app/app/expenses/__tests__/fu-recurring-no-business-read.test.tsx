/**
 * P254 FU-RECURRING-NO-BUSINESS-READ (launch-track, D-315; from the EH3 R26 correctness review).
 *
 * With no business, the recurring panel reads nothing; it used to keep the previous business's list read (or show its
 * empty state, "No recurring expenses" with Add), so the hub could offer "New recurring expense" with no business.
 * With no business the panel shows no list, no empty state and no Add, reports a read that is not ok, and the hub
 * offers no "New recurring expense".
 * R1: the hub pin reaches the page's own no-business path ("No business is selected.", no Recurring panel); with no
 * business a New request (triggerNew) opens no builder.
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
import RecurringExpensesPanel from "../components/recurring-expenses-panel";
import ExpensesInboxPage from "../page";

const ok = <T,>(data: T) => ({ data, error: null });
const CATS: Record<string, ExpenseCategory[]> = {
  biz_A: [{ id: "cat_A_fuel", name: "Fuel A", color: "#f97316" } as ExpenseCategory],
  biz_B: [{ id: "cat_B_rent", name: "Rent B", color: "#06b6d4" } as ExpenseCategory],
};


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
  client.fetchRecurringCandidates.mockResolvedValue(ok({ candidates: [] }));
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






const LONG = { timeout: 10000 };
import type { BlockRead } from "../components/use-expenses-data";

describe("P254: the recurring panel with no business", () => {
  it("mounted with no business: no empty state, no Add, and a read that is not ok", async () => {
    const reads: BlockRead[] = [];
    render(<RecurringExpensesPanel businessId={null} categories={[]} triggerNew={0} onListRead={(r) => reads.push(r)} />);
    await settle();
    expect(screen.queryByText(/no recurring expenses/i), "an empty state with no business").toBeNull();
    expect(screen.queryByRole("button", { name: "Add Recurring Expense" })).toBeNull();
    expect(reads.at(-1)?.kind).not.toBe("ok");
    expect(client.fetchRecurringExpenses).not.toHaveBeenCalled();
  });
  it("A's list answered, then no business: A's read is forgotten, and nothing of A shows", async () => {
    const reads: BlockRead[] = [];
    const el = (b: string | null) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={0} onListRead={(r) => reads.push(r)} />;
    const view = render(el("biz_A"));
    expect(await screen.findByRole("button", { name: /Run Now/i }, LONG)).toBeTruthy();
    await waitFor(() => expect(reads.at(-1)?.kind).toBe("ok"), LONG); // reported from an effect after the render
    ws.bid = null;
    view.rerender(el(null));
    await settle();
    expect(reads.at(-1)?.kind, "A's ok kept with no business").not.toBe("ok");
    expect(screen.queryByRole("button", { name: /Run Now/i })).toBeNull();
    expect(screen.queryByText(/no recurring expenses/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Recurring Expense" })).toBeNull();
  });
  it("R1-2: with no business, a New request (triggerNew) opens no builder", async () => {
    const el = (t: number) => <RecurringExpensesPanel businessId={null} categories={[]} triggerNew={t} />;
    const view = render(el(0));
    await settle();
    view.rerender(el(1));
    await settle();
    expect(screen.queryByRole("dialog"), "the builder opened with no business").toBeNull();
  });
  it("R1-2: a business given after mount, then a New request, opens the builder", async () => {
    const el = (b: string | null, t: number) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={t} />;
    const view = render(el(null, 0));
    await settle();
    view.rerender(el("biz_A", 0));
    await settle();
    view.rerender(el("biz_A", 1));
    expect(await screen.findByRole("dialog", {}, LONG)).toBeTruthy();
  });
  it("R1-2 control: with a business, a New request opens the builder", async () => {
    const el = (t: number) => <RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={t} />;
    const view = render(el(0));
    await settle();
    view.rerender(el(1));
    expect(await screen.findByRole("dialog", {}, LONG)).toBeTruthy();
  });
  it("control: a business whose list answers empty shows the empty state with Add", async () => {
    client.fetchRecurringExpenses.mockResolvedValue(ok([]));
    render(<RecurringExpensesPanel businessId="biz_A" categories={[]} triggerNew={0} />);
    expect(await screen.findByText(/no recurring expenses/i, {}, LONG)).toBeTruthy();
  });
});

describe("P254: the hub with no business", () => {
  it("the stored business cleared on the Recurring view: no 'New recurring expense'", async () => {
    render(<ExpensesInboxPage />);
    await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()), LONG);
    fireEvent.click(await screen.findByRole("tab", { name: "Recurring" }, LONG));
    expect(await screen.findByRole("button", { name: /New recurring expense/ }, LONG)).toBeTruthy();
    ws.bid = null;
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: null } })); });
    await settle();
    await settle();
    expect(screen.queryByRole("button", { name: /New recurring expense/ }), "offered with no business").toBeNull();
    expect(screen.queryByRole("button", { name: "Add Recurring Expense" })).toBeNull();
    // P254 R1-1: the page's own no-business path (the panel is not mounted with no business), pinned as such.
    expect(await screen.findByText("No business is selected.", {}, LONG)).toBeTruthy();
    expect(document.getElementById("expenses-panel-recurring"), "the Recurring panel mounted with no business").toBeNull();
  }, 30000);
});

describe("P254 R3-1: a business change alone never reopens the builder (COR MINOR-6, at the panel)", () => {
  const el = (b: string | null, t: number) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={t} />;
  async function newOnA() {
    const view = render(el("biz_A", 0));
    await settle();
    view.rerender(el("biz_A", 1));
    expect(await screen.findByRole("dialog", {}, LONG)).toBeTruthy();
    return view;
  }
  it("A, New, then B with the trigger unchanged: no builder", async () => {
    const view = await newOnA();
    view.rerender(el("biz_B", 1));
    await settle();
    await settle();
    expect(screen.queryByRole("dialog"), "the builder reopened for B on the business change alone").toBeNull();
  });
  it("A, New, then none, then B with the trigger unchanged: no builder", async () => {
    const view = await newOnA();
    view.rerender(el(null, 1));
    await settle();
    view.rerender(el("biz_B", 1));
    await settle();
    await settle();
    expect(screen.queryByRole("dialog"), "the builder reopened for B on the business change alone").toBeNull();
  });
});

describe("P254 R3-2: the hub's New request does not outlive the business it was made for", () => {
  const switchTo = (bid: string | null) => {
    ws.bid = bid;
    act(() => { window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: bid } })); });
  };
  for (const path of [["biz_B"], [null, "biz_B"]] as const) {
    it(`New under A, then ${path.map((b) => b ?? "none").join(" → ")}: no builder until New is pressed again`, async () => {
      render(<ExpensesInboxPage />);
      await waitFor(() => expect(client.fetchExpenses).toHaveBeenCalledWith("biz_A", expect.anything()), LONG);
      fireEvent.click(await screen.findByRole("tab", { name: "Recurring" }, LONG));
      fireEvent.click(await screen.findByRole("button", { name: /New recurring expense/ }, LONG));
      expect(await screen.findByRole("dialog", {}, LONG)).toBeTruthy();
      for (const bid of path) {
        switchTo(bid);
        await settle();
        await settle();
      }
      await waitFor(() => expect(client.fetchRecurringExpenses).toHaveBeenCalledWith("biz_B"), LONG);
      const again = await screen.findByRole("button", { name: /New recurring expense/ }, LONG);
      await settle();
      expect(screen.queryByRole("dialog"), "the builder opened for B without a click").toBeNull();
      fireEvent.click(again);
      expect(await screen.findByRole("dialog", {}, LONG), "control: New pressed on B opens the builder").toBeTruthy();
    }, 30000);
  }
});

describe("P254 R4-1: a New queued for A, then the business changes in the same task, before the builder opens", () => {
  const el = (b: string | null, t: number) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={t} />;
  for (const next of [null, "biz_B"] as const) {
    it(`A, New, then ${next ?? "none"} before the queued open runs: no builder`, async () => {
      const view = render(el("biz_A", 0));
      await settle();
      // Two commits in one task: the open queued by the first has not run when the second lands.
      view.rerender(el("biz_A", 1));
      view.rerender(el(next, 1));
      await settle();
      await settle();
      expect(screen.queryByRole("dialog"), `A's queued New opened the builder under ${next ?? "none"}`).toBeNull();
    });
  }
  it("control: A, New, and no change: the builder opens", async () => {
    const view = render(el("biz_A", 0));
    await settle();
    view.rerender(el("biz_A", 1));
    expect(await screen.findByRole("dialog", {}, LONG)).toBeTruthy();
  });
});

describe("P254 R4-2: a New and a business change in the same commit", () => {
  const el = (b: string | null, t: number) => <RecurringExpensesPanel businessId={b} categories={[]} triggerNew={t} />;
  it("A to none, with New: no builder (the ref follows the business before the New is read)", async () => {
    const view = render(el("biz_A", 0));
    await settle();
    view.rerender(el(null, 1));
    await settle();
    await settle();
    expect(screen.queryByRole("dialog"), "the builder opened with no business").toBeNull();
  });
  it("A to B, with New: the builder opens, for B", async () => {
    const view = render(el("biz_A", 0));
    await settle();
    view.rerender(el("biz_B", 1));
    expect(await screen.findByRole("dialog", {}, LONG)).toBeTruthy();
  });
});
