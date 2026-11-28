/**
 * P267 FU-EXPENSE-FORM-FIELD-NAMES (launch-track, D-315). The expense sheet's Description, Amount, Date, Vendor and
 * Category fields had no accessible name: their <label>s were not linked to them (no htmlFor), so a screen reader
 * announced an unnamed field. Each label is now linked to its field.
 *
 * R1 (first review, 3 NITs): R1-1 the edit sheet's five fields are pinned, not Description alone; R1-2 a required
 * field's name carries no "*" (read aloud as "star") and the field is aria-required; R1-3 the rest of the sheet's
 * fields are named too: Payment Method, Tags, Project, Client, Service, Notes and the recurring frequency.
 *
 * R2 (review B, 3 NITs): R2-1 Date is marked required, so it is validated like Description and Amount: with no date
 * the submit button is disabled and nothing is sent (an empty date was saved as "today" by the server); R2-2 the
 * sweep checks a non-empty computed accessible name, file inputs included, in the add, bill and edit sheets; R2-3
 * Date's name is pinned by getByLabelText (its input has no ARIA role, so getByRole cannot query it).
 *
 * R3 (both reviews of R2, NITs): R3-1 a receipt's date is taken only when it is a plain YYYY-MM-DD (after any time
 * part), otherwise the date already in the form is kept, and the form's validity check is that same pattern; R3-2 a
 * hint beside the submit button names the empty required fields (the button's accessible description), and the
 * form says once what the star means.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within, getRoles, act } from "@testing-library/react";
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
  it("Date: aria-required (its name is pinned by getByLabelText, as a date input has no ARIA role; its star is pinned below)", () => {
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
  /**
   * R2-2: every form control has a non-empty accessible name, as testing-library computes it: a control with an ARIA
   * role is found by getAllByRole(role, { name: /\S/ }); one with none (a date or file input) by getAllByLabelText,
   * whose label must hold text. An empty label or aria-label names nothing and fails.
   */
  function unnamedControls(): string[] {
    const named = new Set<Element>();
    for (const role of Object.keys(getRoles(document.body))) {
      for (const el of screen.queryAllByRole(role, { name: /\S/ })) named.add(el);
    }
    for (const el of screen.queryAllByLabelText(/\S/)) named.add(el);
    return Array.from(document.querySelectorAll<HTMLElement>("input:not([type=hidden]), select, textarea"))
      .filter((el) => !named.has(el))
      .map((el) => el.outerHTML.slice(0, 90));
  }
  for (const [state, open] of [
    ["the add sheet", () => sheet(null, LINKS)],
    ["the bill sheet (Due date)", () => render(<ExpenseFormSideSheet businessId="biz_A" categories={CATS as never} editingExpense={null} initialKind="bill" onClose={vi.fn()} onSaved={vi.fn()} isCurrentBusiness={() => true} {...LINKS} />)],
    ["the edit sheet", () => sheet(EDITING, LINKS)],
  ] as const) {
    it(`${state}: every form control has a non-empty accessible name (file inputs included)`, () => {
      open();
      const recurring = screen.queryByRole("checkbox", { name: /Recurring expense/ });
      if (recurring && !(recurring as HTMLInputElement).checked) fireEvent.click(recurring);
      expect(document.querySelectorAll("input[type=file]").length, "the receipt inputs are not in this sheet").toBeGreaterThan(0);
      expect(unnamedControls(), "fields with no name").toEqual([]);
    });
  }
  it("the sweep's own control: an empty label or an empty aria-label is reported as unnamed", () => {
    render(<form><label htmlFor="e1">{" "}</label><input id="e1" /><input aria-label="" /><label>Named <input /></label></form>);
    expect(unnamedControls()).toHaveLength(2);
  });
  it("Due date (the bill sheet) is named", () => {
    render(<ExpenseFormSideSheet businessId="biz_A" categories={CATS as never} editingExpense={null} initialKind="bill" onClose={vi.fn()} onSaved={vi.fn()} isCurrentBusiness={() => true} />);
    expect((screen.getByLabelText(/^Due date/) as HTMLInputElement).type).toBe("date");
  });
});

describe("P267 R2-1: Date is validated like Description and Amount (it is marked required)", () => {
  const fill = () => {
    fireEvent.change(named("textbox", "Description"), { target: { value: "Printer toner" } });
    fireEvent.change(named("spinbutton", "Amount (TTD)"), { target: { value: "100" } });
  };
  const date = () => screen.getByLabelText(/^Date/) as HTMLInputElement;
  for (const [kind, button, saves] of [
    ["expense", "Add Expense", () => client.createExpense],
    ["bill", "Record bill", () => finance.createBill],
  ] as const) {
    it(`${kind}: with no date the "${button}" button is disabled and a click sends nothing`, async () => {
      render(<ExpenseFormSideSheet businessId="biz_A" categories={CATS as never} editingExpense={null} initialKind={kind} onClose={vi.fn()} onSaved={vi.fn()} isCurrentBusiness={() => true} />);
      fill();
      fireEvent.change(date(), { target: { value: "" } });
      const submit = screen.getByRole("button", { name: button });
      expect(submit, "an empty date can still be submitted").toBeDisabled();
      fireEvent.click(submit);
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(saves(), "an empty date was sent (the server saves it as today)").not.toHaveBeenCalled();
    });
  }
  it("edit: clearing the date disables Update Expense", () => {
    sheet(EDITING);
    fireEvent.change(date(), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Update Expense" })).toBeDisabled();
  });
  it("control: with a date (the sheet's default, today) and no Vendor or Category, the button is enabled", () => {
    sheet();
    fill();
    expect(date().value, "the sheet no longer defaults the date").not.toBe("");
    expect(named("textbox", "Vendor")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Add Expense" })).toBeEnabled();
  });
  it("control: Description and Amount still block on their own", () => {
    sheet();
    expect(screen.getByRole("button", { name: "Add Expense" }), "the button is enabled with nothing filled in").toBeDisabled();
    fireEvent.change(named("textbox", "Description"), { target: { value: "Printer toner" } });
    expect(screen.getByRole("button", { name: "Add Expense" })).toBeDisabled();
  });
});

describe("P267 R3-1: a receipt's date is taken only when it is a plain date", () => {
  const DRIVE = "https://drive.google.com/file/d/abc/view";
  const date = () => screen.getByLabelText(/^Date/) as HTMLInputElement;
  const extractWith = async (issueDate: string) => {
    client.extractReceipt.mockResolvedValue(ok({ invoiceData: { total: 99, issueDate, lineItems: [{ description: "Toner" }] }, confidence: 0.9 }));
    fireEvent.click(screen.getAllByRole("button").find((b) => /Extract with AI/.test(b.textContent ?? ""))!);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  };
  const open = () => render(<ExpenseFormSideSheet businessId="biz_A" categories={CATS as never} editingExpense={null} prefill={{ receiptUrl: DRIVE }} onClose={vi.fn()} onSaved={vi.fn()} isCurrentBusiness={() => true} />);
  it('an ISO date with a time ("2026-03-12T00:00:00Z") fills Date with 2026-03-12', async () => {
    open();
    await extractWith("2026-03-12T00:00:00Z");
    expect(date().value).toBe("2026-03-12");
  });
  it('a non-ISO date ("12/03/2026") keeps the date the form had, and the sheet can still be saved', async () => {
    open();
    const before = date().value;
    expect(before, "the sheet no longer defaults the date").toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await extractWith("12/03/2026");
    expect(date().value, "the receipt's unreadable date replaced the form's").toBe(before);
    expect(screen.getByRole("button", { name: "Add Expense" })).toBeEnabled();
  });
  it("a non-ISO date when Date was cleared: Date stays empty and the button stays disabled (no hidden value passes the check)", async () => {
    open();
    fireEvent.change(date(), { target: { value: "" } });
    await extractWith("12/03/2026");
    expect(date().value).toBe("");
    expect(screen.getByRole("button", { name: "Add Expense" }), "an unreadable date counted as filled in").toBeDisabled();
  });
});

describe("P267 R3-2: why the button is disabled is said beside it", () => {
  const button = () => screen.getByRole("button", { name: "Add Expense" });
  const description = () => {
    const ids = (button().getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
  };
  it("with Date empty (Description and Amount filled), the button's description names Date only", () => {
    sheet();
    fireEvent.change(named("textbox", "Description"), { target: { value: "Printer toner" } });
    fireEvent.change(named("spinbutton", "Amount (TTD)"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: "" } });
    expect(button()).toBeDisabled();
    expect(description(), "the button does not say what is missing").toMatch(/Date/);
    expect(description()).not.toMatch(/Description|Amount/);
  });
  it("with nothing filled in, it names Description and Amount (Date has its default)", () => {
    sheet();
    expect(description()).toMatch(/Description/);
    expect(description()).toMatch(/Amount/);
    expect(description()).not.toMatch(/Date/);
  });
  it("control: with every required field filled, nothing is said as missing", () => {
    sheet();
    fireEvent.change(named("textbox", "Description"), { target: { value: "Printer toner" } });
    fireEvent.change(named("spinbutton", "Amount (TTD)"), { target: { value: "100" } });
    expect(button()).toBeEnabled();
    expect(description()).not.toMatch(/Description|Amount|Date/);
  });
  it('the form says once what the star means ("* = required")', () => {
    sheet();
    expect(screen.getAllByText(/\* = required/)).toHaveLength(1);
  });
});
