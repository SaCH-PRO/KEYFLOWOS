/**
 * R22: ExpenseFormModal is retired (it had no production mount); its tests in this file were removed. The R22
 * PROGRESS on #273 names the side-sheet test that covers each.
 *
 * EXPENSES-HUB-2 (SWP-EXPENSE-BILLS-RECURRING; BUG-059, BUG-061; journey H5, H7a).
 *
 * BUG-059: there is no way to record a bill to pay later: the expense sheet
 * only saves a PAID expense (POST .../expenses), which posts against cash. A
 * bill is saved through the existing bill door (POST /finance/.../bills, status
 * BILL, a due date), and is never reported as paid.
 *
 * BUG-061: ticking "Recurring expense" only tags the expense
 * (isRecurring/recurringFrequency); no schedule is created, so nothing ever
 * recurs. Saving a recurring expense must also create its schedule through the
 * existing route (POST /expenses/.../recurring), due one period after the
 * expense's date (the expense itself is this period's), and a schedule that is
 * refused is said, never hidden behind "Expense saved".
 *
 * Mounted on the real components; only the client calls, the upload hooks,
 * sonner and the cached business are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const BUSINESS = "biz_hub2_bills";

const createExpense = vi.fn();
const updateExpense = vi.fn();
const createRecurringExpense = vi.fn();
const createBill = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test" }));
vi.mock("@/lib/workspace", () => ({
  getCachedBusiness: () => ({ id: "biz_hub2_bills", name: "Bills Co", currency: "TTD" }),
  getStoredBusinessId: () => "biz_hub2_bills",
}));
vi.mock("@/lib/api/finance", () => ({
  createBill: (...args: unknown[]) => createBill(...args),
  payBill: vi.fn(),
  voidBill: vi.fn(),
}));
vi.mock("@/lib/client", () => ({
  createExpense: (...args: unknown[]) => createExpense(...args),
  updateExpense: (...args: unknown[]) => updateExpense(...args),
  createRecurringExpense: (...args: unknown[]) => createRecurringExpense(...args),
  extractReceipt: vi.fn(),
  PAYMENT_METHODS: [{ value: "cash", label: "Cash" }],
}));

import { toast } from "sonner";
import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";

type Form = "sidesheet"; // R22: the modal is retired; the sheet is the form production mounts

const EXISTING: Expense = {
  id: "exp_hub2",
  description: "Office rent",
  amount: 4500,
  currency: "TTD",
  date: "2026-11-01T00:00:00.000Z",
  vendor: "Landlord Ltd",
  paymentMethod: "bank_transfer",
  tags: [],
  isRecurring: false,
  status: "PAID",
  categoryId: "cat_rent",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

function mount(form: Form, opts: { editing?: Expense | null; kind?: "expense" | "bill" } = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const props = { businessId: BUSINESS, categories: [], editingExpense: opts.editing ?? null, onClose, onSaved };
  const view = render(
    <ExpenseFormSideSheet {...props} initialKind={opts.kind} />,
  );
  return { onSaved, onClose, ...view };
}

function fillBasics(container: HTMLElement, description: string, amount: string, date = "2026-11-25") {
  fireEvent.change(screen.getByPlaceholderText(/What was this expense for|description/i), { target: { value: description } });
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: amount } });
  const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
  fireEvent.change(dateInput, { target: { value: date } });
}

function tickRecurring(container: HTMLElement, frequency = "MONTHLY") {
  fireEvent.click(screen.getByText(/Recurring expense/i));
  const select = Array.from(container.querySelectorAll("select")).find((s) => Array.from(s.options).some((o) => o.value === "QUARTERLY"));
  expect(select, "the frequency list").toBeTruthy();
  fireEvent.change(select!, { target: { value: frequency } });
}

beforeEach(() => {
  createExpense.mockReset().mockResolvedValue({ data: { ...EXISTING, id: "exp_new" }, error: null });
  updateExpense.mockReset().mockResolvedValue({ data: EXISTING, error: null });
  createRecurringExpense.mockReset().mockResolvedValue({ data: { id: "rec_new" }, error: null });
  createBill.mockReset().mockResolvedValue({ data: { ...EXISTING, id: "bill_new", status: "BILL" }, error: null });
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

afterEach(() => cleanup());

describe("BUG-059: the expense sheet records a bill to pay later", () => {
  it("the sheet offers 'bill to pay later'; it asks a due date and saves through the bill door, unpaid", async () => {
    const { container, onSaved } = mount("sidesheet");
    fireEvent.click(screen.getByLabelText(/bill to pay later/i));
    fillBasics(container, "Phone bill", "320");
    fireEvent.change(screen.getByPlaceholderText(/vendor/i), { target: { value: "Digicel" } });
    fireEvent.change(screen.getByLabelText(/due date/i), { target: { value: "2026-12-05" } });
    fireEvent.click(screen.getByRole("button", { name: /^record bill$/i }));

    await waitFor(() => expect(createBill).toHaveBeenCalledTimes(1));
    const [businessId, body] = createBill.mock.calls[0];
    expect(businessId).toBe(BUSINESS);
    expect(body).toMatchObject({ description: "Phone bill", amount: 320, date: "2026-11-25", dueDate: "2026-12-05", vendor: "Digicel" });
    expect(Object.keys(body)).not.toContain("currency");
    expect(Object.keys(body)).not.toContain("paymentMethod");
    expect(createExpense, "a bill is never saved as a paid expense").not.toHaveBeenCalled();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/bill/i));
    expect(toast.success).not.toHaveBeenCalledWith(expect.stringMatching(/paid/i));
  });

  it("opened as a bill (Record bill on the page) the sheet starts in bill mode", () => {
    mount("sidesheet", { kind: "bill" });
    expect((screen.getByLabelText(/bill to pay later/i) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText(/due date/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^record bill$/i })).toBeTruthy();
  });

  it("a bill's receipt and tags, which the bill door does not take, are written onto the bill after it is created", async () => {
    const { container } = mount("sidesheet", { kind: "bill" });
    fillBasics(container, "Water bill", "75");
    fireEvent.change(screen.getByPlaceholderText(/tag1/i), { target: { value: "utilities" } });
    fireEvent.click(screen.getByRole("button", { name: /^record bill$/i }));
    await waitFor(() => expect(createBill).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(updateExpense).toHaveBeenCalledTimes(1));
    const [, id, patch] = updateExpense.mock.calls[0];
    expect(id).toBe("bill_new");
    expect(patch).toMatchObject({ tags: ["utilities"] });
    expect(Object.keys(patch)).not.toContain("amount");
  });

  it("a bill the server refuses is shown with its reason and the sheet stays open", async () => {
    createBill.mockResolvedValue({ data: null, error: "Amount must be positive", status: 400 });
    const { container, onSaved, onClose } = mount("sidesheet", { kind: "bill" });
    fillBasics(container, "Bad bill", "5");
    fireEvent.click(screen.getByRole("button", { name: /^record bill$/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Amount must be positive"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("an ordinary expense still saves as paid through the expense door", async () => {
    const { container } = mount("sidesheet");
    fillBasics(container, "Flour", "86.4");
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
    expect(createBill).not.toHaveBeenCalled();
  });
});

/** The browser's clock, at `iso`, still moving (waitFor keeps its timeouts). */
function pinClock(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(iso));
}

describe.each<Form>(["sidesheet"])("BUG-061: in the %s, 'Recurring' creates a real schedule", (form) => {
  // 10:00 on 25 November in Port of Spain: the expenses below are dated today or ahead.
  beforeEach(() => pinClock("2026-11-25T14:00:00.000Z"));
  afterEach(() => vi.useRealTimers());

  it("a new monthly recurring expense creates its schedule, due one month after the expense's date", async () => {
    const { container } = mount(form);
    fillBasics(container, "Office rent", "4500", "2026-11-25");
    tickRecurring(container, "MONTHLY");
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));

    await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(createRecurringExpense).toHaveBeenCalledTimes(1));
    const [businessId, body] = createRecurringExpense.mock.calls[0];
    expect(businessId).toBe(BUSINESS);
    expect(body).toMatchObject({ name: "Office rent", description: "Office rent", amount: 4500, frequency: "MONTHLY", nextRunDate: "2026-12-25" });
    expect(Object.keys(body)).not.toContain("currency");
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it.each([
    ["WEEKLY", "2026-11-25", "2026-12-02"],
    ["BIWEEKLY", "2026-11-25", "2026-12-09"],
    ["QUARTERLY", "2026-11-25", "2027-02-25"],
    ["YEARLY", "2026-11-25", "2027-11-25"],
    ["MONTHLY", "2026-12-31", "2027-01-31"],
    ["MONTHLY", "2027-01-31", "2027-02-28"],
  ])("%s from %s is next due %s", async (frequency, date, next) => {
    const { container } = mount(form);
    fillBasics(container, "Subscription", "10", date);
    tickRecurring(container, frequency);
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(createRecurringExpense).toHaveBeenCalledTimes(1));
    expect(createRecurringExpense.mock.calls[0][1]).toMatchObject({ frequency, nextRunDate: next });
  });

  it("no schedule is created for an expense that is not recurring", async () => {
    const { container } = mount(form);
    fillBasics(container, "One-off", "10");
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(createRecurringExpense).not.toHaveBeenCalled();
  });

  it("no schedule is created when the expense itself is refused", async () => {
    createExpense.mockResolvedValue({ data: null, error: "Refused", status: 400 });
    const { container } = mount(form);
    fillBasics(container, "Office rent", "4500");
    tickRecurring(container);
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Refused"));
    expect(createRecurringExpense).not.toHaveBeenCalled();
  });

  it("a schedule the server refuses is said, not hidden behind 'Expense saved'", async () => {
    createRecurringExpense.mockResolvedValue({ data: null, error: "Invalid frequency", status: 400 });
    const { container } = mount(form);
    fillBasics(container, "Office rent", "4500");
    tickRecurring(container);
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/recurring schedule[\s\S]*Invalid frequency/i)));
    expect(toast.success).not.toHaveBeenCalledWith("Expense saved");
  });

  it("editing an expense to make it recurring creates its schedule; editing one already recurring does not create another", async () => {
    const first = mount(form, { editing: EXISTING });
    tickRecurring(first.container, "MONTHLY");
    fireEvent.click(screen.getByRole("button", { name: "Update Expense" }));
    await waitFor(() => expect(updateExpense).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(createRecurringExpense).toHaveBeenCalledTimes(1));
    expect(createRecurringExpense.mock.calls[0][1]).toMatchObject({ frequency: "MONTHLY", nextRunDate: "2026-12-01", categoryId: "cat_rent", vendor: "Landlord Ltd" });
    cleanup();

    createRecurringExpense.mockClear();
    updateExpense.mockClear();
    mount(form, { editing: { ...EXISTING, isRecurring: true, recurringFrequency: "MONTHLY" } });
    fireEvent.click(screen.getByRole("button", { name: "Update Expense" }));
    await waitFor(() => expect(updateExpense).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(createRecurringExpense).not.toHaveBeenCalled();
  });
});

describe("BUG-061 with BUG-059: a recurring bill's schedule generates bills", () => {
  beforeEach(() => pinClock("2026-11-25T14:00:00.000Z"));
  afterEach(() => vi.useRealTimers());
  it("the schedule of a recurring bill creates bills, due as many days after their date as this one", async () => {
    const { container } = mount("sidesheet", { kind: "bill" });
    fillBasics(container, "Internet", "399", "2026-11-25");
    fireEvent.change(screen.getByLabelText(/due date/i), { target: { value: "2026-12-05" } });
    tickRecurring(container, "MONTHLY");
    fireEvent.click(screen.getByRole("button", { name: /^record bill$/i }));
    await waitFor(() => expect(createRecurringExpense).toHaveBeenCalledTimes(1));
    expect(createRecurringExpense.mock.calls[0][1]).toMatchObject({ createsBill: true, dueOffsetDays: 10, nextRunDate: "2026-12-25" });
  });
});

describe.each<Form>(["sidesheet"])("COR-F1: in the %s, a back-dated recurring expense never catches up", (form) => {
  // 10:00 on 26 November 2026 in Port of Spain. The server generates one expense per due period from nextRunDate,
  // so a schedule whose first run is already past would book every missed period at once: the first run is the
  // first period boundary after today.
  beforeEach(() => pinClock("2026-11-26T14:00:00.000Z"));
  afterEach(() => vi.useRealTimers());

  it.each([
    ["MONTHLY", "2026-03-10", "2026-12-10"],
    ["MONTHLY", "2026-01-31", "2026-11-30"],
    ["MONTHLY", "2026-10-26", "2026-12-26"],
    ["MONTHLY", "2026-11-26", "2026-12-26"],
    ["YEARLY", "2024-02-29", "2027-02-28"],
    ["YEARLY", "2025-12-01", "2026-12-01"],
    ["QUARTERLY", "2025-11-30", "2026-11-30"],
    ["QUARTERLY", "2025-08-15", "2027-02-15"],
    ["WEEKLY", "2026-11-01", "2026-11-29"],
    ["BIWEEKLY", "2026-10-01", "2026-12-10"],
  ])("%s dated %s is first due %s, after today, with no catch-up", async (frequency, date, next) => {
    const { container } = mount(form);
    fillBasics(container, "Internet", "399", date);
    tickRecurring(container, frequency);
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(createRecurringExpense).toHaveBeenCalledTimes(1));
    expect(createRecurringExpense.mock.calls[0][1]).toMatchObject({ frequency, nextRunDate: next });
  });
});

describe.each<Form>(["sidesheet"])("COR-F3: in the %s, a double click saves once", (form) => {
  it("a second click while the save is in flight sends nothing", async () => {
    let release: (v: unknown) => void = () => {};
    createExpense.mockImplementation(() => new Promise((r) => { release = r; }));
    const { container } = mount(form);
    fillBasics(container, "Office rent", "4500");
    tickRecurring(container);
    const save = screen.getByRole("button", { name: "Add Expense" });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
    expect((save as HTMLButtonElement).disabled, "the save is disabled while it is in flight").toBe(true);
    release({ data: { ...EXISTING, id: "exp_new" }, error: null });
    await waitFor(() => expect(createRecurringExpense).toHaveBeenCalledTimes(1));
    expect(createExpense).toHaveBeenCalledTimes(1);
  });
});

describe("COR-F3: a double click on Record bill records one bill", () => {
  it("one bill, one PATCH, one schedule", async () => {
    let release: (v: unknown) => void = () => {};
    createBill.mockImplementation(() => new Promise((r) => { release = r; }));
    const { container } = mount("sidesheet", { kind: "bill" });
    fillBasics(container, "Internet", "399");
    fireEvent.change(screen.getByPlaceholderText(/tag1/i), { target: { value: "utilities" } });
    tickRecurring(container);
    const save = screen.getByRole("button", { name: /^record bill$/i });
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(createBill).toHaveBeenCalledTimes(1));
    release({ data: { ...EXISTING, id: "bill_new", status: "BILL" }, error: null });
    await waitFor(() => expect(createRecurringExpense).toHaveBeenCalledTimes(1));
    expect(createBill).toHaveBeenCalledTimes(1);
    expect(updateExpense).toHaveBeenCalledTimes(1);
  });
});

describe("COR-F5: a bill whose receipt and tags are refused says so", () => {
  it("the refused PATCH after the bill is shown, not 'Bill recorded' alone", async () => {
    updateExpense.mockResolvedValue({ data: null, error: "Forbidden", status: 403 });
    const { container, onSaved } = mount("sidesheet", { kind: "bill" });
    fillBasics(container, "Water bill", "75");
    fireEvent.change(screen.getByPlaceholderText(/tag1/i), { target: { value: "utilities" } });
    fireEvent.click(screen.getByRole("button", { name: /^record bill$/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^Bill recorded, but its receipt and tags were not saved: Forbidden/)));
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSaved, "the bill exists: the sheet closes and the list reloads").toHaveBeenCalled();
  });
});

describe.each<Form>(["sidesheet"])("COR-r1-1: in the %s, the save guard clears after a refused save", (form) => {
  it("a save refused (409) can be pressed again, and the second press sends", async () => {
    createExpense.mockResolvedValueOnce({ data: null, error: "Conflict", status: 409 });
    const { container } = mount(form);
    fillBasics(container, "Office rent", "4500");
    const save = screen.getByRole("button", { name: "Add Expense" });
    fireEvent.click(save);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Conflict"));
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(2));
  });

  it("a save that throws can be pressed again", async () => {
    createExpense.mockRejectedValueOnce(new Error("network down"));
    const { container } = mount(form);
    fillBasics(container, "Office rent", "4500");
    const save = screen.getByRole("button", { name: "Add Expense" });
    fireEvent.click(save);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to save expense"));
    fireEvent.click(save);
    await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(2));
  });
});

describe("COR-r1-1: a refused bill can be recorded again", () => {
  it("Record bill after a refusal sends again", async () => {
    createBill.mockResolvedValueOnce({ data: null, error: "Amount must be positive", status: 400 });
    const { container } = mount("sidesheet", { kind: "bill" });
    fillBasics(container, "Bill", "5");
    const save = screen.getByRole("button", { name: /^record bill$/i });
    fireEvent.click(save);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Amount must be positive"));
    fireEvent.click(save);
    await waitFor(() => expect(createBill).toHaveBeenCalledTimes(2));
  });
});
