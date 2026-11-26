/**
 * EXPENSES-HUB-2 (SWP-EXPENSE-CURRENCY-DATE; BUG-027, BUG-028; journey H4).
 *
 * BUG-027: the expense screens name TTD whatever the business currency is: the
 * forms' "Amount (TTD)" label and footer, expense-utils' formatCurrency (the
 * page's figures, the detail page, the budgets tab), the snapshot tab and the
 * recurring builder. A USD business must see USD.
 *
 * BUG-028: the new expense's date defaults to the UTC date
 * (`new Date().toISOString()`), so at 21:00 in Port of Spain (01:00 UTC the
 * next day) it is tomorrow. It must be today in Trinidad.
 *
 * Mounted on the real components; only the client calls, the upload hooks,
 * sonner and the cached business (lib/workspace) are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Expense, ExpenseBudget, ExpenseSummary } from "@/lib/client";

const BUSINESS = "biz_hub2_usd";
const ZONE_FOR_DISPLAY = "America/Port_of_Spain";
const cachedBusiness = vi.hoisted(() => ({ value: { id: "biz_hub2_usd", name: "Hub2 USD Co", currency: "USD" } as Record<string, unknown> | null }));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test" }));
vi.mock("@/lib/workspace", () => ({
  getCachedBusiness: () => cachedBusiness.value,
  getStoredBusinessId: () => (cachedBusiness.value?.id as string | undefined) ?? null,
}));
vi.mock("@/lib/api/finance", () => ({ createBill: vi.fn(), payBill: vi.fn(), voidBill: vi.fn() }));
vi.mock("@/lib/client", () => ({
  createExpense: vi.fn(async () => ({ data: { id: "exp_new" }, error: null })),
  updateExpense: vi.fn(),
  extractReceipt: vi.fn(),
  fetchRecurringExpenses: vi.fn(async () => ({ data: [], error: null })),
  createRecurringExpense: vi.fn(async () => ({ data: { id: "rec_new" }, error: null })),
  updateRecurringExpense: vi.fn(),
  cancelRecurringExpense: vi.fn(),
  runRecurringExpenseNow: vi.fn(),
  upsertExpenseBudget: vi.fn(),
  deleteExpenseBudget: vi.fn(),
  PAYMENT_METHODS: [{ value: "cash", label: "Cash" }],
}));

import { ExpenseFormModal } from "../components/expense-form-modal";
import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";
import { formatCurrency, formatDate } from "../components/expense-utils";
import { ExpensesSnapshotTab } from "../components/expenses-snapshot-tab";
import { ExpenseBudgetsTab } from "../components/expense-budgets-tab";
import RecurringExpensesPanel from "../components/recurring-expenses-panel";

type Form = "modal" | "sidesheet";

function mountForm(form: Form) {
  const props = { businessId: BUSINESS, categories: [], editingExpense: null, onClose: vi.fn(), onSaved: vi.fn() };
  return render(form === "modal" ? <ExpenseFormModal {...props} /> : <ExpenseFormSideSheet {...props} />);
}

beforeEach(() => {
  cachedBusiness.value = { id: BUSINESS, name: "Hub2 USD Co", currency: "USD" };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BUG-027: a USD business sees USD on the expense screens, never TTD", () => {
  it("expense-utils formatCurrency names the business currency", () => {
    const text = formatCurrency(150);
    expect(text).toMatch(/USD/);
    expect(text).not.toMatch(/TTD/);
    expect(text).toMatch(/150\.00/);
  });

  it("an amount in a named currency keeps that currency", () => {
    expect(formatCurrency(20, "EUR")).toMatch(/^EUR /);
  });

  it("a TTD business still sees TTD", () => {
    cachedBusiness.value = { id: BUSINESS, name: "Doubles Co", currency: "TTD" };
    expect(formatCurrency(150)).toMatch(/TTD/);
  });

  it.each<Form>(["modal", "sidesheet"])("the %s names USD on its amount field and nowhere TTD", (form) => {
    const { container } = mountForm(form);
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "86.4" } });
    expect(screen.getByText(/Amount \(USD\)/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/TTD/);
  });

  it("the snapshot tab's total and average are in USD", () => {
    const summary = { total: 300, count: 2, averageExpense: 150 } as unknown as ExpenseSummary;
    const expenses = [
      { id: "e1", description: "Hosting", amount: 100, currency: "USD", date: "2026-11-20T00:00:00.000Z", status: "PAID", tags: [], isRecurring: false },
      { id: "e2", description: "Domain", amount: 200, currency: "USD", date: "2026-11-21T00:00:00.000Z", status: "PAID", tags: [], isRecurring: false },
    ] as unknown as Expense[];
    const { container } = render(<ExpensesSnapshotTab expenses={expenses} categories={[]} summary={summary} budgets={[]} />);
    expect(container.textContent).toMatch(/USD/);
    expect(container.textContent).not.toMatch(/TTD/);
  });

  it("the budgets tab (unmounted in v1) shows its figures and its limit field in USD", () => {
    const budgets = [
      { id: "b1", categoryId: "c1", amount: 500, spent: 120, remaining: 380, percentUsed: 24, isOverBudget: false, isNearAlert: false, alertAt: 80, month: 11, year: 2026 },
    ] as unknown as ExpenseBudget[];
    const { container } = render(
      <ExpenseBudgetsTab businessId={BUSINESS} budgets={budgets} categories={[{ id: "c1", name: "Rent" } as never]} expenses={[]} summary={null} onReload={vi.fn()} />,
    );
    const add = screen.queryAllByRole("button").find((b) => /budget/i.test(b.textContent ?? ""));
    if (add) fireEvent.click(add);
    expect(container.textContent).toMatch(/USD/);
    expect(document.body.textContent).not.toMatch(/TTD/);
  });

  it("the recurring builder names USD on its amount field", async () => {
    render(<RecurringExpensesPanel businessId={BUSINESS} categories={[]} triggerNew={1} />);
    await waitFor(() => expect(screen.getByText(/Amount \(USD\)/)).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/TTD/);
  });
});

describe("BUG-028: the new expense's date is today in Trinidad", () => {
  // 21:00 on 25 November in Port of Spain (UTC-4) is 01:00 on 26 November UTC.
  const EVENING = new Date("2026-11-26T01:00:00.000Z");

  it.each<Form>(["modal", "sidesheet"])("the %s at 21:00 in Port of Spain defaults to 2026-11-25, not the UTC date", (form) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(EVENING);
    const { container } = mountForm(form);
    const date = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(date).toBeTruthy();
    expect(date.value).toBe("2026-11-25");
  });

  it.each<Form>(["modal", "sidesheet"])("the %s at 10:00 in Port of Spain defaults to that same day", (form) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T14:00:00.000Z"));
    const { container } = mountForm(form);
    expect((container.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-11-25");
  });
});

describe("BUG-028: an expense's date shows as the day it was dated, in Port of Spain", () => {
  // The expense date is a calendar day, stored as midnight UTC: read in Port of Spain's local time it is 20:00 the day before.
  let tz: string | undefined;
  beforeEach(() => {
    tz = process.env.TZ;
    process.env.TZ = ZONE_FOR_DISPLAY;
  });
  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it("formatDate of 2026-11-25 (stored midnight UTC) reads Nov 25, 2026, not Nov 24", () => {
    expect(new Date("2026-11-25T00:00:00.000Z").getDate(), "the test runs in Port of Spain's local time").toBe(24);
    expect(formatDate("2026-11-25T00:00:00.000Z")).toBe("Nov 25, 2026");
    expect(formatDate("2026-11-25")).toBe("Nov 25, 2026");
  });

  it("the recurring panel shows a schedule's next date as its calendar day", async () => {
    const client = await import("@/lib/client");
    vi.mocked(client.fetchRecurringExpenses).mockResolvedValueOnce({
      data: [{ id: "r1", name: "Rent", description: "Rent", amount: 4500, currency: "USD", frequency: "MONTHLY", nextRunDate: "2026-12-25T00:00:00.000Z", isActive: true, runCount: 0, failureCount: 0, createsBill: false, businessId: BUSINESS, createdAt: "", updatedAt: "" }],
      error: null,
    } as never);
    render(<RecurringExpensesPanel businessId={BUSINESS} categories={[]} />);
    await waitFor(() => expect(screen.getByText(/Next: Dec 25/)).toBeTruthy());
  });
});
