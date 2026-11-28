/**
 * P267 FU-EXPENSE-FORM-FIELD-NAMES (launch-track, D-315). The expense sheet's Description, Amount, Date, Vendor and
 * Category fields had no accessible name: their <label>s were not linked to them (no htmlFor), so a screen reader
 * announced an unnamed field. Each label is now linked to its field.
 *
 * R1 (first review, 3 NITs): R1-1 the edit sheet's five fields are pinned, not Description alone; R1-2 a required
 * field's name carries no "*" (read aloud as "star") and the field is aria-required; R1-3 the rest of the sheet's
 * fields are named too: Payment Method, Tags, Project, Client, Service, Notes and the recurring frequency.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
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
const LINKS = {
  projects: [{ id: "prj_1", name: "Fit-out" }],
  contacts: [{ id: "ct_1", name: "Ada Customer" }],
  services: [{ id: "svc_1", name: "Install" }],
};
const sheet = (editing: Expense | null = null, links: Partial<typeof LINKS> = {}) =>
  render(<ExpenseFormSideSheet businessId="biz_A" categories={CATS as never} editingExpense={editing} onClose={vi.fn()} onSaved={vi.fn()} isCurrentBusiness={() => true} {...(links as object)} />);
const EDITING = { id: "exp_A1", description: "Printer toner", amount: 100, currency: "TTD", date: "2026-10-15T00:00:00.000Z", vendor: "Office Depot", paymentMethod: "cash", tags: [], isRecurring: false, status: "PAID", categoryId: "cat_1", createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z" } as unknown as Expense;
/** A field's accessible name, exactly (no "*"), found by its role. */
const named = (role: string, name: string) => screen.getByRole(role, { name });

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

describe("P267 R1-1: the edit sheet's five fields are named, each holding the expense's value", () => {
  for (const [field, find, value] of [
    ["Description", () => named("textbox", "Description"), "Printer toner"],
    ["Amount", () => named("spinbutton", "Amount (TTD)"), "100"],
    ["Date", () => screen.getByLabelText(/^Date/), "2026-10-15"],
    ["Vendor", () => named("textbox", "Vendor"), "Office Depot"],
    ["Category", () => named("combobox", "Category"), "cat_1"],
  ] as const) {
    it(`${field}: named in the edit sheet, with the saved value`, () => {
      sheet(EDITING);
      expect((find() as HTMLInputElement).value).toBe(value);
    });
  }
});

describe("P267 R1-2: a required field's name has no star, and the field is marked required", () => {
  for (const [field, role, name] of [
    ["Description", "textbox", "Description"],
    ["Amount", "spinbutton", "Amount (TTD)"],
  ] as const) {
    it(`${field}: named "${name}" exactly, and aria-required`, () => {
      sheet();
      const el = named(role, name);
      expect(el.getAttribute("aria-required"), `${field} is not marked required`).toBe("true");
    });
  }
  it("Date: aria-required (a date input has no role here to name-check; its star is pinned below with the others)", () => {
    sheet();
    const date = screen.getByLabelText(/^Date/) as HTMLInputElement;
    expect(date.type).toBe("date");
    expect(date.getAttribute("aria-required")).toBe("true");
  });
  it("each visible star is hidden from assistive technology", () => {
    sheet();
    const labels = Array.from(document.querySelectorAll("label")).filter((l) => (l.textContent ?? "").includes("*"));
    expect(labels.length, "the stars are no longer shown").toBeGreaterThanOrEqual(3);
    for (const label of labels) {
      const stars = Array.from(label.querySelectorAll("*")).filter((el) => el.textContent?.trim() === "*");
      expect(stars.length, `"${label.textContent}": the star is not its own element`).toBe(1);
      expect(stars[0].getAttribute("aria-hidden"), `"${label.textContent}": the star is read aloud`).toBe("true");
    }
  });
  it("control: an optional field is not marked required", () => {
    sheet();
    expect(named("textbox", "Vendor").getAttribute("aria-required")).not.toBe("true");
    expect(named("combobox", "Category").getAttribute("aria-required")).not.toBe("true");
  });
});

describe("P267 R1-3: the rest of the sheet's fields are named", () => {
  it("Payment Method, Tags and Notes", () => {
    sheet();
    expect((named("combobox", "Payment Method") as HTMLSelectElement).tagName).toBe("SELECT");
    expect(named("textbox", "Tags").getAttribute("placeholder")).toBe("tag1, tag2, ...");
    expect(named("textbox", "Notes").tagName).toBe("TEXTAREA");
  });
  it("Project, Client and Service (the Link to Business Entity selects)", () => {
    sheet(null, LINKS);
    for (const [name, option] of [["Project", "Fit-out"], ["Client", "Ada Customer"], ["Service", "Install"]] as const) {
      const select = named("combobox", name);
      expect(within(select).getByRole("option", { name: option }), `${name} names another select`).toBeTruthy();
    }
  });
  it("the recurring frequency select is named once Recurring expense is ticked", () => {
    sheet();
    fireEvent.click(screen.getByRole("checkbox", { name: /Recurring expense/ }));
    const frequency = named("combobox", "Recurring frequency");
    expect(within(frequency).getByRole("option", { name: "Monthly" })).toBeTruthy();
  });
  it("every form control in the sheet has a name (no unnamed field is left)", () => {
    sheet(null, LINKS);
    fireEvent.click(screen.getByRole("checkbox", { name: /Recurring expense/ }));
    const unnamed = Array.from(document.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([type=file]), select, textarea")).filter(
      (el) => !el.getAttribute("aria-label") && !(el as HTMLInputElement).labels?.length && !el.getAttribute("aria-labelledby"),
    );
    expect(unnamed.map((el) => el.outerHTML.slice(0, 80)), "fields with no name").toEqual([]);
  });
});
