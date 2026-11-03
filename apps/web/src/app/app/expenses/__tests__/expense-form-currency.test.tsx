/**
 * FOLLOW3-B4-EXPENSE-CURRENCY-CENTS (V1-82; VL-06) — the expense forms never
 * name a currency; the server defaults an expense to the business currency.
 *
 * WHY: ExpenseFormModal (:56) and ExpenseFormSideSheet (:128) sent the literal
 * `currency: "TTD"` on create AND on edit, so a USD business's expenses were
 * TTD through the main UI path even after the server learnt to default to the
 * business currency. The payload must carry no `currency` key at all.
 *
 * FOLLOW3-B7 (D-67): an edit the server refuses (409, the amount of a posted
 * expense) comes back as an ApiResult with `error`; the forms surface it with
 * toast.error and do not report "Expense saved".
 *
 * Mounted on the real components; only the client calls, the upload hooks and
 * sonner are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const createExpense = vi.fn();
const updateExpense = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test" }));
vi.mock("@/lib/client", () => ({
  createExpense: (...args: unknown[]) => createExpense(...args),
  updateExpense: (...args: unknown[]) => updateExpense(...args),
  extractReceipt: vi.fn(),
  PAYMENT_METHODS: [{ value: "cash", label: "Cash" }],
}));

import { toast } from "sonner";
import { ExpenseFormModal } from "../components/expense-form-modal";
import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";

const BUSINESS = "biz_b4_forms";

const EXISTING: Expense = {
  id: "exp_b4",
  description: "Hosting",
  amount: 25,
  currency: "USD",
  date: "2026-11-01T00:00:00.000Z",
  vendor: "Cloud Co",
  paymentMethod: "cash",
  tags: [],
  isRecurring: false,
  status: "PAID",
  categoryId: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

type Form = "modal" | "sidesheet";

function mount(form: Form, editing: Expense | null) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const props = { businessId: BUSINESS, categories: [], editingExpense: editing, onClose, onSaved };
  render(form === "modal" ? <ExpenseFormModal {...props} /> : <ExpenseFormSideSheet {...props} />);
  return { onSaved, onClose };
}

function submitLabel(form: Form, editing: boolean): string {
  if (!editing) return "Add Expense";
  return form === "modal" ? "Update" : "Update Expense";
}

beforeEach(() => {
  createExpense.mockReset().mockResolvedValue({ data: { ...EXISTING, id: "exp_new" }, error: null });
  updateExpense.mockReset().mockResolvedValue({ data: EXISTING, error: null });
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

afterEach(() => {
  cleanup();
});

describe.each<Form>(["modal", "sidesheet"])("FOLLOW3-B4: the %s sends no currency; the server defaults it", (form) => {
  it("create: createExpense is called with a payload that has no `currency` key", async () => {
    mount(form, null);
    fireEvent.change(screen.getByPlaceholderText("What was this expense for?"), { target: { value: "Domain renewal" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "12.5" } });
    fireEvent.click(screen.getByRole("button", { name: submitLabel(form, false) }));

    await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
    const [businessId, payload] = createExpense.mock.calls[0];
    expect(businessId).toBe(BUSINESS);
    expect(payload).toMatchObject({ description: "Domain renewal", amount: 12.5 });
    expect(Object.keys(payload)).not.toContain("currency");
    expect(updateExpense).not.toHaveBeenCalled();
  });

  it("edit: updateExpense is called with a payload that has no `currency` key", async () => {
    mount(form, EXISTING);
    fireEvent.click(screen.getByRole("button", { name: submitLabel(form, true) }));

    await waitFor(() => expect(updateExpense).toHaveBeenCalledTimes(1));
    const [businessId, expenseId, payload] = updateExpense.mock.calls[0];
    expect([businessId, expenseId]).toEqual([BUSINESS, EXISTING.id]);
    expect(payload).toMatchObject({ description: "Hosting", amount: 25 });
    expect(Object.keys(payload)).not.toContain("currency");
    expect(createExpense).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Expense saved"));
  });

  it("FOLLOW3-B7: an edit the server refuses (409) shows toast.error with its reason, no success toast, and the form stays open", async () => {
    const reason = "Cannot change the amount or currency of a posted expense: void it and record a new one";
    updateExpense.mockResolvedValue({ data: null, error: reason, status: 409 });
    const { onSaved, onClose } = mount(form, EXISTING);
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: submitLabel(form, true) }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(reason));
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
