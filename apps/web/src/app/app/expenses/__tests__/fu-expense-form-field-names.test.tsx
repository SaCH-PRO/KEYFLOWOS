/**
 * P267 FU-EXPENSE-FORM-FIELD-NAMES (launch-track, D-315). The expense sheet's Description, Amount, Date, Vendor and
 * Category fields had no accessible name: their <label>s were not linked to them (no htmlFor), so a screen reader
 * announced an unnamed field. Each label is now linked to its field.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import type { Expense } from "@/lib/client";

const blocked = vi.hoisted(() => ({ on: false }));
const ws = vi.hoisted(() => ({ bid: "biz_A" as string | null }));
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const routeParams = vi.hoisted(() => ({ id: "exp_A1" }));
const client = vi.hoisted(() => ({
  getExpense: vi.fn(),
  fetchExpenseCategories: vi.fn(),
  fetchExpenseBudgets: vi.fn(),
  deleteExpense: vi.fn(),
  updateExpense: vi.fn(),
  createExpense: vi.fn(),
  createRecurringExpense: vi.fn(),
  extractReceipt: vi.fn(),
  fetchFinanceAccounts: vi.fn(),
}));
const finance = vi.hoisted(() => ({ payBill: vi.fn(), voidBill: vi.fn(), createBill: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/expenses/exp_A1",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: routeParams.id }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/lib/workspace", () => ({
  BUSINESS_CHANGED_EVENT: "kf:business-changed",
  getStoredBusinessId: () => { if (blocked.on) throw new DOMException("The operation is insecure.", "SecurityError"); return ws.bid; },
  getCachedBusiness: () => (ws.bid ? { id: ws.bid, name: `${ws.bid} Co`, currency: "TTD", timezone: "America/Port_of_Spain" } : null),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: vi.fn(async () => true) }) }));
vi.mock("@/lib/api", () => ({ API_BASE: "http://api.test", getAuthHeaders: () => ({}) }));
vi.mock("@/lib/client", () => ({ ...client, PAYMENT_METHODS: [{ value: "cash", label: "Cash" }] }));
vi.mock("@/lib/api/finance", () => finance);


import { ExpenseFormSideSheet } from "../components/expense-form-sidesheet";

const ok = <T,>(data: T) => ({ data, error: null });
const CATS = [{ id: "cat_1", name: "Supplies", color: "#f97316" }];
beforeEach(() => {
  ws.bid = "biz_A";
  for (const fn of [...Object.values(client), ...Object.values(finance)]) fn.mockReset();
  client.fetchFinanceAccounts.mockResolvedValue(ok({ items: [] }));
});
afterEach(() => { cleanup(); blocked.on = false; });
const sheet = (editing: Expense | null = null) =>
  render(<ExpenseFormSideSheet businessId="biz_A" categories={CATS as never} editingExpense={editing} onClose={vi.fn()} onSaved={vi.fn()} isCurrentBusiness={() => true} />);

describe("P267: the expense sheet's fields are named by their labels", () => {
  const FIELDS: Array<[string, RegExp, string, string]> = [
    // [field, its label, its role, its placeholder or kind]
    ["Description", /^Description/, "textbox", "What was this expense for?"],
    ["Amount", /^Amount/, "spinbutton", "0.00"],
    ["Vendor", /^Vendor/, "textbox", "Vendor name"],
    ["Category", /^Category/, "combobox", ""],
  ];
  for (const [field, label, role, placeholder] of FIELDS) {
    it(`${field}: getByLabelText finds the field, and its role carries the name`, () => {
      sheet();
      const byLabel = screen.getByLabelText(label);
      const byRole = screen.getByRole(role, { name: label });
      expect(byRole, `${field}'s accessible name is not its label`).toBe(byLabel);
      if (placeholder) expect(byLabel.getAttribute("placeholder")).toBe(placeholder);
    });
  }
  it("Date: getByLabelText finds the date field", () => {
    sheet();
    const date = screen.getByLabelText(/^Date/) as HTMLInputElement;
    expect(date.type).toBe("date");
  });
  it("each label names one field, and each field's id is its own", () => {
    sheet();
    const ids = [/^Description/, /^Amount/, /^Date/, /^Vendor/, /^Category/].map((l) => screen.getByLabelText(l).id);
    expect(ids.every(Boolean), "a field has no id").toBe(true);
    expect(new Set(ids).size, "two fields share an id").toBe(ids.length);
  });
  it("control: the edit sheet's fields are named too", () => {
    sheet({ id: "exp_A1", description: "Printer toner", amount: 100, currency: "TTD", date: "2026-10-15T00:00:00.000Z", vendor: "Office Depot", paymentMethod: "cash", tags: [], isRecurring: false, status: "PAID", categoryId: null, createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z" } as Expense);
    expect((screen.getByRole("textbox", { name: /^Description/ }) as HTMLInputElement).value).toBe("Printer toner");
  });
});
