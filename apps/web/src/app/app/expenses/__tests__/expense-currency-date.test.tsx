/**
 * R22: ExpenseFormModal is retired (it had no production mount); its tests in this file were removed. The R22
 * PROGRESS on #273 names the side-sheet test that covers each.
 *
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
const storedBusinessId = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test" }));
vi.mock("@/lib/workspace", () => ({
  getCachedBusiness: () => cachedBusiness.value,
  getStoredBusinessId: () => storedBusinessId.value ?? (cachedBusiness.value?.id as string | undefined) ?? null,
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

import { toast } from "sonner";
import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";
import { formatCurrency, formatDate } from "../components/expense-utils";
import { ExpensesSnapshotTab } from "../components/expenses-snapshot-tab";
import { ExpenseBudgetsTab } from "../components/expense-budgets-tab";
import RecurringExpensesPanel from "../components/recurring-expenses-panel";

type Form = "sidesheet"; // R22: the modal is retired

/**
 * P254 R5-1: the panel opens its builder on a New pressed while it is mounted (a change of triggerNew), never on the
 * value it mounts with, so the builder is opened here as the page opens it: mounted with 0, then New.
 */
function newPressed() {
  const view = render(<RecurringExpensesPanel businessId={BUSINESS} categories={[]} triggerNew={0} />);
  view.rerender(<RecurringExpensesPanel businessId={BUSINESS} categories={[]} triggerNew={1} />);
  return view;
}

function mountForm(_form: Form) {
  const props = { businessId: BUSINESS, categories: [], editingExpense: null, onClose: vi.fn(), onSaved: vi.fn() };
  return render(<ExpenseFormSideSheet {...props} />);
}

beforeEach(() => {
  cachedBusiness.value = { id: BUSINESS, name: "Hub2 USD Co", currency: "USD" };
  storedBusinessId.value = null;
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

  it.each<Form>(["sidesheet"])("the %s names USD on its amount field and nowhere TTD", (form) => {
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
    newPressed();
    await waitFor(() => expect(screen.getByText(/Amount \(USD\)/)).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/TTD/);
  });
});

describe("BUG-028: the new expense's date is today in Trinidad", () => {
  // 21:00 on 25 November in Port of Spain (UTC-4) is 01:00 on 26 November UTC.
  const EVENING = new Date("2026-11-26T01:00:00.000Z");

  it.each<Form>(["sidesheet"])("the %s at 21:00 in Port of Spain defaults to 2026-11-25, not the UTC date", (form) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(EVENING);
    const { container } = mountForm(form);
    const date = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(date).toBeTruthy();
    expect(date.value).toBe("2026-11-25");
  });

  it.each<Form>(["sidesheet"])("the %s at 10:00 in Port of Spain defaults to that same day", (form) => {
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

describe("COR-F2: a stored instant is shown as its day in the business zone; a calendar day as itself", () => {
  let tz: string | undefined;
  beforeEach(() => {
    tz = process.env.TZ;
    process.env.TZ = "UTC";
  });
  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it("21:00 on 25 November in Port of Spain, stored as 2026-11-26T01:00Z, reads Nov 25", () => {
    expect(formatDate("2026-11-26T01:00:00.000Z")).toBe("Nov 25, 2026");
  });

  it("a calendar day (date-only, or exactly midnight UTC) reads as that day", () => {
    expect(formatDate("2026-11-26")).toBe("Nov 26, 2026");
    expect(formatDate("2026-11-26T00:00:00.000Z")).toBe("Nov 26, 2026");
    expect(formatDate("2026-11-26T00:00:00Z")).toBe("Nov 26, 2026");
  });

  it("the recurring panel shows a schedule's instant as its day in the business zone", async () => {
    const client = await import("@/lib/client");
    vi.mocked(client.fetchRecurringExpenses).mockResolvedValueOnce({
      data: [{ id: "r2", name: "Rent", description: "Rent", amount: 4500, currency: "USD", frequency: "MONTHLY", nextRunDate: "2026-12-26T01:00:00.000Z", isActive: true, runCount: 1, failureCount: 0, createsBill: false, businessId: BUSINESS, createdAt: "", updatedAt: "" }],
      error: null,
    } as never);
    render(<RecurringExpensesPanel businessId={BUSINESS} categories={[]} />);
    await waitFor(() => expect(screen.getByText(/Next: Dec 25/)).toBeTruthy());
  });
});

describe("COR-F5: a business in another zone gets its own today", () => {
  it.each<Form>(["sidesheet"])("the %s of a Tokyo business at 16:00 UTC defaults to the next day in Tokyo", (form) => {
    cachedBusiness.value = { id: BUSINESS, name: "Tokyo Co", currency: "JPY", timezone: "Asia/Tokyo" };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T16:00:00.000Z"));
    const { container } = mountForm(form);
    expect((container.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-11-26");
  });

  it("a Tokyo business's stored instant is shown as its Tokyo day", () => {
    cachedBusiness.value = { id: BUSINESS, name: "Tokyo Co", currency: "JPY", timezone: "Asia/Tokyo" };
    expect(formatDate("2026-11-25T16:00:00.000Z")).toBe("Nov 26, 2026");
  });

  it("an unknown zone falls back to Trinidad", () => {
    cachedBusiness.value = { id: BUSINESS, name: "Odd Co", currency: "USD", timezone: "Mars/Olympus" };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-26T01:00:00.000Z"));
    const { container } = mountForm("sidesheet");
    expect((container.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-11-25");
  });
});

describe("SEC-EXH2-1: another business's cached currency never labels this business's form", () => {
  it.each<Form>(["sidesheet"])("the %s for business X, with Y (USD) cached, does not say USD", (form) => {
    cachedBusiness.value = { id: "biz_other_y", name: "Y Co", currency: "USD", timezone: "Asia/Tokyo" };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T16:00:00.000Z"));
    const { container } = mountForm(form);
    expect(container.textContent).not.toMatch(/USD/);
    expect(screen.getByText(/Amount \(TTD\)/)).toBeTruthy();
    expect((container.querySelector('input[type="date"]') as HTMLInputElement).value, "nor Y's zone its date").toBe("2026-11-25");
  });

  it("formatCurrency does not use a cached business that is not the stored one", () => {
    cachedBusiness.value = { id: "biz_other_y", name: "Y Co", currency: "USD" };
    storedBusinessId.value = BUSINESS;
    expect(formatCurrency(150)).not.toMatch(/USD/);
  });
});

describe("SEC-r1-1: the panel and the utils use the business in hand, not the cached-and-stored one", () => {
  // A reloaded tab: business Y (USD, Tokyo) is stored and cached, while this panel shows business X.
  beforeEach(() => {
    cachedBusiness.value = { id: "biz_other_y", name: "Y Co", currency: "USD", timezone: "Asia/Tokyo" };
    storedBusinessId.value = "biz_other_y";
  });

  it("the builder of X's panel does not show Y's currency", async () => {
    newPressed();
    await waitFor(() => expect(screen.getByText(/Amount \(TTD\)/)).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "45" } });
    expect(document.body.textContent).not.toMatch(/USD/);
  });

  it("X's panel shows a schedule's instant in X's zone (Trinidad), not Y's (Tokyo)", async () => {
    const client = await import("@/lib/client");
    vi.mocked(client.fetchRecurringExpenses).mockResolvedValueOnce({
      data: [{ id: "r3", name: "Rent", description: "Rent", amount: 4500, currency: "TTD", frequency: "MONTHLY", nextRunDate: "2026-12-26T01:00:00.000Z", isActive: true, runCount: 1, failureCount: 0, createsBill: false, businessId: BUSINESS, createdAt: "", updatedAt: "" }],
      error: null,
    } as never);
    render(<RecurringExpensesPanel businessId={BUSINESS} categories={[]} />);
    await waitFor(() => expect(screen.getByText(/Next: Dec 25/)).toBeTruthy());
  });

  it("formatCurrency and formatDate given X do not use Y", () => {
    expect(formatCurrency(150, undefined, BUSINESS)).not.toMatch(/USD/);
    expect(formatDate("2026-11-26T01:00:00.000Z", BUSINESS)).toBe("Nov 25, 2026");
    // Without X they still read the stored business (Y): the comparison the callers no longer rely on.
    expect(formatDate("2026-11-26T01:00:00.000Z")).toBe("Nov 26, 2026");
  });
});

describe("SEC-r1-2: the New Recurring Expense builder never schedules a past run", () => {
  // 10:00 on 26 November 2026 in Port of Spain.
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-26T14:00:00.000Z"));
    const client = await import("@/lib/client");
    vi.mocked(client.createRecurringExpense).mockReset().mockResolvedValue({ data: { id: "rec_new" }, error: null } as never);
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  async function openBuilder() {
    newPressed();
    await waitFor(() => expect(screen.getByPlaceholderText("e.g., Office Rent")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("e.g., Office Rent"), { target: { value: "Office rent" } });
    fireEvent.change(screen.getByPlaceholderText("What is this expense for?"), { target: { value: "Office rent" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "4500" } });
    return document.querySelector('input[type="date"]') as HTMLInputElement;
  }

  it("the next run date cannot be before tomorrow in the business zone", async () => {
    const date = await openBuilder();
    expect(date.min).toBe("2026-11-27");
  });

  it.each(["2026-11-26", "2026-03-10"])("a next run on %s (today or past) is refused inline and nothing is sent", async (day) => {
    const client = await import("@/lib/client");
    const date = await openBuilder();
    fireEvent.change(date, { target: { value: day } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.getByText(/next run.*after today/i)).toBeTruthy());
    expect(client.createRecurringExpense).not.toHaveBeenCalled();
  });

  it("a next run tomorrow is sent", async () => {
    const client = await import("@/lib/client");
    const date = await openBuilder();
    fireEvent.change(date, { target: { value: "2026-11-27" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(client.createRecurringExpense).toHaveBeenCalledTimes(1));
    expect(vi.mocked(client.createRecurringExpense).mock.calls[0][1]).toMatchObject({ nextRunDate: "2026-11-27" });
  });

  it("a double click creates one schedule", async () => {
    const client = await import("@/lib/client");
    let release: (v: unknown) => void = () => {};
    vi.mocked(client.createRecurringExpense).mockImplementation((() => new Promise((r) => { release = r; })) as never);
    const date = await openBuilder();
    fireEvent.change(date, { target: { value: "2026-12-01" } });
    const create = screen.getByRole("button", { name: "Create" });
    fireEvent.click(create);
    fireEvent.click(create);
    await waitFor(() => expect(client.createRecurringExpense).toHaveBeenCalledTimes(1));
    release({ data: { id: "rec_new" }, error: null });
    fireEvent.click(create);
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalled());
    expect(client.createRecurringExpense).toHaveBeenCalledTimes(1);
  });

  it("after a refused create the builder can save again", async () => {
    const client = await import("@/lib/client");
    vi.mocked(client.createRecurringExpense).mockResolvedValueOnce({ data: null, error: "Invalid frequency", status: 400 } as never);
    const date = await openBuilder();
    fireEvent.change(date, { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Invalid frequency"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(client.createRecurringExpense).toHaveBeenCalledTimes(2));
  });
});

describe("Round 3: the recurring builder's date is a real day; an edit keeps a past run it did not change; the card's currency", () => {
  // 10:00 on 26 November 2026 in Port of Spain.
  const PAST: Record<string, unknown> = { id: "r_past", name: "Office rent", description: "Office rent", amount: 4500, currency: "TTD", frequency: "MONTHLY", nextRunDate: "2026-03-10T00:00:00.000Z", isActive: false, runCount: 3, failureCount: 2, createsBill: false, businessId: BUSINESS, createdAt: "", updatedAt: "" };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-26T14:00:00.000Z"));
    const client = await import("@/lib/client");
    vi.mocked(client.createRecurringExpense).mockReset().mockResolvedValue({ data: { id: "rec_new" }, error: null } as never);
    vi.mocked(client.updateRecurringExpense).mockReset().mockResolvedValue({ data: { id: "r_past" }, error: null } as never);
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it.each(["9/1/2025", "March 10, 2026", "2026-02-30", "2026-13-01"])("a next run of '%s' (not a YYYY-MM-DD day) is refused inline and nothing is sent", async (typed) => {
    const client = await import("@/lib/client");
    newPressed();
    await waitFor(() => expect(screen.getByPlaceholderText("e.g., Office Rent")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("e.g., Office Rent"), { target: { value: "Office rent" } });
    fireEvent.change(screen.getByPlaceholderText("What is this expense for?"), { target: { value: "Office rent" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "4500" } });
    // A page edited to type="text" (or a script) can put any string in the field.
    const date = document.querySelector('input[type="date"]') as HTMLInputElement;
    date.setAttribute("type", "text");
    fireEvent.change(date, { target: { value: typed } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/next run/i));
    expect(client.createRecurringExpense).not.toHaveBeenCalled();
  });

  async function editPast() {
    const client = await import("@/lib/client");
    vi.mocked(client.fetchRecurringExpenses).mockResolvedValueOnce({ data: [PAST], error: null } as never);
    render(<RecurringExpensesPanel businessId={BUSINESS} categories={[]} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Update" })).toBeTruthy());
    return client;
  }

  it("editing only the amount of a past-dated (paused) schedule sends, and leaves its next run out of the PATCH", async () => {
    const client = await editPast();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "4800" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(client.updateRecurringExpense).toHaveBeenCalledTimes(1));
    const [, id, patch] = vi.mocked(client.updateRecurringExpense).mock.calls[0];
    expect(id).toBe("r_past");
    expect(patch).toMatchObject({ amount: 4800 });
    expect(Object.keys(patch as object)).not.toContain("nextRunDate");
  });

  it("an edit that moves the next run to a past day is refused inline and nothing is sent", async () => {
    const client = await editPast();
    const date = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/next run.*after today/i));
    expect(client.updateRecurringExpense).not.toHaveBeenCalled();
  });

  it("an edit that moves the next run after today sends the new day", async () => {
    const client = await editPast();
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: "2026-12-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(client.updateRecurringExpense).toHaveBeenCalledTimes(1));
    expect(vi.mocked(client.updateRecurringExpense).mock.calls[0][2]).toMatchObject({ nextRunDate: "2026-12-10" });
  });

  it("a schedule with no currency shows the USD business's currency, not TTD", async () => {
    const client = await import("@/lib/client");
    vi.mocked(client.fetchRecurringExpenses).mockResolvedValueOnce({ data: [{ ...PAST, currency: null }], error: null } as never);
    const { container } = render(<RecurringExpensesPanel businessId={BUSINESS} categories={[]} />);
    await waitFor(() => expect(container.textContent).toMatch(/USD 4,500\.00/));
    expect(container.textContent).not.toMatch(/TTD/);
  });
});

describe("Round 4: each schedule and the create form get their own builder state", () => {
  const SCHEDULE: Record<string, unknown> = { id: "r_edit", name: "Office rent", description: "Office rent", amount: 4500, currency: "USD", frequency: "QUARTERLY", nextRunDate: "2027-01-10T00:00:00.000Z", isActive: true, runCount: 0, failureCount: 0, createsBill: false, businessId: BUSINESS, createdAt: "", updatedAt: "" };

  it("New, pressed while an Edit sheet is still mounted, opens an empty Create form, not the edited schedule's fields", async () => {
    const client = await import("@/lib/client");
    vi.mocked(client.fetchRecurringExpenses).mockResolvedValue({ data: [SCHEDULE], error: null } as never);
    const view = render(<RecurringExpensesPanel businessId={BUSINESS} categories={[]} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect((screen.getByPlaceholderText("e.g., Office Rent") as HTMLInputElement).value).toBe("Office rent"));

    view.rerender(<RecurringExpensesPanel businessId={BUSINESS} categories={[]} triggerNew={1} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create" })).toBeTruthy());
    const names = screen.getAllByPlaceholderText("e.g., Office Rent") as HTMLInputElement[];
    const create = names[names.length - 1];
    expect(create.value, "the create form starts empty").toBe("");
    expect((screen.getAllByPlaceholderText("0.00").at(-1) as HTMLInputElement).value).toBe("");
    vi.mocked(client.fetchRecurringExpenses).mockReset().mockResolvedValue({ data: [], error: null } as never);
  });

  it("Edit, pressed while the Create form is still mounted, opens the schedule's own fields, not what was typed into Create", async () => {
    const client = await import("@/lib/client");
    vi.mocked(client.fetchRecurringExpenses).mockResolvedValue({ data: [SCHEDULE], error: null } as never);
    newPressed();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy());
    await waitFor(() => expect(screen.getByRole("button", { name: "Create" })).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("e.g., Office Rent"), { target: { value: "Typed into create" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Update" })).toBeTruthy());
    const names = screen.getAllByPlaceholderText("e.g., Office Rent") as HTMLInputElement[];
    expect(names[names.length - 1].value, "the edit form holds the schedule").toBe("Office rent");
    vi.mocked(client.fetchRecurringExpenses).mockReset().mockResolvedValue({ data: [], error: null } as never);
  });
});
