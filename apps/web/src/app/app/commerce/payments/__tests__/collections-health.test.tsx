/**
 * V1-64 (SWP-INV-MONEY-TOTALS; sweep BUG-024, with BUG-020): the Payments tab's
 * money strip and its Collections Health card count deposits and part payments,
 * and a deposit never turns a figure negative.
 *
 * Before: the tab read an invoice's money from its status alone. Received was
 * the totals of PAID invoices, so a 400 deposit on an invoice of 13,723 was not
 * received at all; Pending and Overdue were whole invoice totals, so that
 * invoice was still "13.7k pending"; a DRAFT nobody was sent counted as pending
 * too. The Collections Health headline was received - pending - overdue, so the
 * owner who had just taken a deposit read "TTD -13723".
 *
 * After (the server half is apps/server/test/money-totals-partial-payments
 * .integration.test.ts): every figure is read from the invoice's own payment
 * rows through the shared balance contract (invoiceBalanceOfStoredRows, the
 * mirror of the server's balanceOfStoredRows; owner rulings D-14, D-75):
 *   - Received is the money received net of refunds, on any invoice;
 *   - This Month is the money received net of refunds this month, by the date
 *     of each payment row;
 *   - Pending and Overdue are what is still owed (the remaining balance) on
 *     SENT / PARTIALLY_PAID / OVERDUE invoices, never a DRAFT, never below 0;
 *   - the Collections Health headline is what is still to collect (pending +
 *     overdue), never a negative figure.
 *
 * The tab is mounted as finance-pipeline.tsx mounts it; only its data door
 * (@/lib/client) and the toast are stubbed. Rows are shaped as GET
 * .../invoices serves them (own-tenant payment rows on each invoice).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React, { useState } from "react";
import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
import type { Invoice, PaymentRecord } from "@/lib/client";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
const markInvoicePaid = vi.fn();
vi.mock("@/lib/client", () => ({
  markInvoicePaid: (...args: unknown[]) => markInvoicePaid(...args),
  updateInvoiceStatus: vi.fn(),
  sendInvoiceReminder: vi.fn(),
}));

import PaymentsTab from "../payments-tab";
import { CashFlowSummary } from "../../components/cash-flow-summary";

const DAY = 24 * 60 * 60 * 1000;
const PAST_DUE = new Date(Date.now() - 20 * DAY).toISOString();
const NOT_YET_DUE = new Date(Date.now() + 20 * DAY).toISOString();
const NOW = new Date().toISOString();
/** The 15th of the month before this one: never this month. */
const LAST_MONTH = (() => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - 1, 15, 12).toISOString();
})();

let seq = 0;
function payment(invoiceId: string, amount: number, status = "SUCCESSFUL", createdAt: string = NOW): PaymentRecord {
  seq += 1;
  return {
    id: `pay_${seq}`, amount, currency: "TTD", status, provider: "cash", providerPaymentId: `pp_${seq}`,
    createdAt, businessId: "biz_v64", invoiceId,
  };
}

function invoice(id: string, status: string, total: number, payments: PaymentRecord[] = [], over: Partial<Invoice> = {}): Invoice {
  return {
    id, invoiceNumber: id.toUpperCase(), status, total, currency: "TTD",
    issueDate: NOW, dueDate: NOT_YET_DUE, contactId: null,
    contact: { firstName: "V64", lastName: id, email: null }, items: [], payments,
    ...over,
  };
}

function mount(invoices: Invoice[]) {
  render(<PaymentsTab invoices={invoices} currency="TTD" businessId="biz_v64" setInvoices={() => {}} />);
}

/** The tab over a real invoices state, as finance-pipeline.tsx holds it, so what setInvoices does is drawn. */
function mountLive(invoices: Invoice[]) {
  function Holder() {
    const [list, setList] = useState<Invoice[]>(invoices);
    return <PaymentsTab invoices={list} currency="TTD" businessId="biz_v64" setInvoices={setList} />;
  }
  render(<Holder />);
}

/** The count on the view filter's button for `label` (All / Received / Pending / Overdue). */
function filterCount(label: string): string {
  const buttons = screen.getAllByRole("button").filter((b) => b.children.length === 2 && b.children[1].textContent === label);
  expect(buttons, `the ${label} filter`).toHaveLength(1);
  return buttons[0].children[0].textContent ?? "";
}

function openFilter(label: string) {
  const buttons = screen.getAllByRole("button").filter((b) => b.children.length === 2 && b.children[1].textContent === label);
  fireEvent.click(buttons[0]);
}

/** The figure the money strip shows beside `label` ("—" when there is none). */
function strip(label: "Received" | "This Month" | "Pending" | "Overdue"): string {
  // The strip draws <div><icon/><span>figure</span><span>label</span></div>; the view filter's buttons carry the same words.
  const labels = screen.getAllByText(label).filter((el) => el.tagName === "SPAN" && el.parentElement?.tagName === "DIV" && el.previousElementSibling?.tagName === "SPAN");
  expect(labels, `the strip's ${label}`).toHaveLength(1);
  return labels[0].previousElementSibling!.textContent ?? "";
}

/** The Collections Health card. */
function health(): HTMLElement {
  const title = screen.getByText("Collections Health");
  const card = title.closest("div.rounded-xl");
  expect(card, "the Collections Health card").not.toBeNull();
  return card as HTMLElement;
}

/** No figure on the card is below zero ("TTD -13723", "-TTD 12.9k", a minus sign of any kind). */
function expectNoNegativeFigure(card: HTMLElement) {
  expect(card.textContent ?? "").not.toMatch(/[-−–]\s*(TTD\s*)?\d|TTD\s*[-−–]/);
}

beforeEach(() => {
  markInvoicePaid.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("V1-64 Payments tab: a deposit is received and the rest is owed (BUG-024)", () => {
  it("CH-01: 13,723 with a 400 deposit -> Received TTD 400, Pending TTD 13.3k, and no negative Collections Health", () => {
    mount([invoice("dep", "PARTIALLY_PAID", 13723, [payment("dep", 400)])]);
    expect(strip("Received")).toBe("TTD 400");
    expect(strip("This Month")).toBe("TTD 400");
    expect(strip("Pending")).toBe("TTD 13.3k");
    expect(strip("Overdue")).toBe("—");

    const card = health();
    expectNoNegativeFigure(card);
    expect(within(card).getByText("TTD 400 received")).toBeTruthy();
    expect(within(card).getByText("TTD 13.3k pending")).toBeTruthy();
    expect(within(card).getByText("TTD 0 overdue")).toBeTruthy();
    // The headline is what is still to collect.
    expect(within(card).getByTestId("collections-to-collect").textContent).toBe("TTD 13.3k");
    expect(card.textContent).toContain("TTD 13.3k collectible from 1 pending invoice");
  });

  it("CH-02: a DRAFT nobody was sent is not pending and not owed: no figure, no negative, the card says it is unsent", () => {
    mount([invoice("draft", "DRAFT", 500)]);
    expect(strip("Received")).toBe("—");
    expect(strip("Pending")).toBe("—");
    const card = health();
    expectNoNegativeFigure(card);
    expect(within(card).getByText("TTD 0 pending")).toBeTruthy();
    expect(within(card).getByTestId("collections-to-collect").textContent).toBe("TTD 0");
    expect(card.textContent).toContain("1 draft invoice not yet sent");
  });

  it("CH-03: a part-paid invoice past its due date is overdue by what is left (500 with 200 paid -> TTD 300)", () => {
    mount([invoice("late", "PARTIALLY_PAID", 500, [payment("late", 200)], { dueDate: PAST_DUE })]);
    expect(strip("Received")).toBe("TTD 200");
    expect(strip("Overdue")).toBe("TTD 300");
    expect(strip("Pending")).toBe("—");
    const card = health();
    expectNoNegativeFigure(card);
    expect(within(card).getByText("TTD 300 overdue")).toBeTruthy();
    expect(within(card).getByTestId("collections-to-collect").textContent).toBe("TTD 300");
    expect(card.textContent).toContain("TTD 300 overdue from 1 invoice");
  });

  it("CH-04: a refund is not received (D-14): 60 + 40 paid with the 40 refunded -> Received TTD 60, Pending TTD 40", () => {
    mount([
      invoice("ref", "PARTIALLY_PAID", 100, [payment("ref", 60), payment("ref", 40), payment("ref", -40, "REFUNDED")]),
    ]);
    expect(strip("Received")).toBe("TTD 60");
    expect(strip("This Month")).toBe("TTD 60");
    expect(strip("Pending")).toBe("TTD 40");
  });

  it("CH-05: This Month goes by the payment's date, not the invoice's status: a deposit last month and one now on an unpaid invoice", () => {
    mount([invoice("two", "PARTIALLY_PAID", 1000, [payment("two", 300, "SUCCESSFUL", LAST_MONTH), payment("two", 150)])]);
    expect(strip("Received")).toBe("TTD 450");
    expect(strip("This Month")).toBe("TTD 150");
    expect(strip("Pending")).toBe("TTD 550");
  });

  it("CH-06: rows that are not money and an overpayment: PENDING / FAILED rows count nothing; 120 on a PAID 100 owes 0, never a negative", () => {
    mount([
      invoice("noise", "SENT", 90, [payment("noise", 90, "PENDING"), payment("noise", 90, "FAILED")]),
      invoice("over", "PAID", 100, [payment("over", 120)], { paidAt: NOW }),
    ]);
    expect(strip("Received")).toBe("TTD 120");
    expect(strip("Pending")).toBe("TTD 90");
    const card = health();
    expectNoNegativeFigure(card);
    expect(within(card).getByTestId("collections-to-collect").textContent).toBe("TTD 90");
  });

  it("CH-07: paid in full and nothing owed -> Received the total, nothing pending, the card reads healthy", () => {
    mount([invoice("paid", "PAID", 75, [payment("paid", 75)], { paidAt: NOW })]);
    expect(strip("Received")).toBe("TTD 75");
    expect(strip("Pending")).toBe("—");
    const card = health();
    expectNoNegativeFigure(card);
    expect(within(card).getByTestId("collections-to-collect").textContent).toBe("TTD 0");
    expect(card.textContent).toContain("Collections healthy");
  });
});

describe("V1-64 Collections Health card on its own", () => {
  it("CH-08: more owed than received is not a negative figure (400 received, 13,323 pending)", () => {
    render(<CashFlowSummary totalReceived={400} totalPending={13323} totalOverdue={0} currency="TTD" pendingCount={1} />);
    const card = health();
    expectNoNegativeFigure(card);
    expect(within(card).getByTestId("collections-to-collect").textContent).toBe("TTD 13.3k");
  });

  it("CH-09: figures handed in below zero are shown as zero, never as a negative", () => {
    render(<CashFlowSummary totalReceived={-40} totalPending={-5} totalOverdue={-1} currency="TTD" />);
    const card = health();
    expectNoNegativeFigure(card);
    expect(within(card).getByTestId("collections-to-collect").textContent).toBe("TTD 0");
  });
});

/**
 * Review repairs (RED-BEFORE = the packet head 7513180a).
 */
describe("V1-64 review repairs: the tab after Mark paid, PAID invoices with no payment row, one definition per label", () => {
  it("CH-10 RED-BEFORE (COR-1): Mark paid on a part-paid invoice raises Received by what was settled, without a reload (the server answers no payment rows)", async () => {
    // What PATCH .../paid answers: the invoice, PAID. Mark-paid records the remaining balance as a payment (D-05).
    markInvoicePaid.mockResolvedValue({ data: { id: "late", status: "PAID", paidAt: NOW }, error: null });
    mountLive([invoice("late", "PARTIALLY_PAID", 500, [payment("late", 200)], { dueDate: PAST_DUE })]);
    expect(strip("Received")).toBe("TTD 200");
    expect(strip("Overdue")).toBe("TTD 300");
    fireEvent.click(screen.getAllByTitle("Mark Paid")[0]);
    await waitFor(() => expect(strip("Received")).toBe("TTD 500"));
    expect(strip("This Month")).toBe("TTD 500");
    expect(strip("Overdue")).toBe("—");
    expect(within(health()).getByTestId("collections-to-collect").textContent).toBe("TTD 0");
    expect(health().textContent).toContain("Collections healthy");
  });

  it("CH-11 RED-BEFORE (COR-1): when the server answers the payment rows, they are the rows shown (no second count)", async () => {
    markInvoicePaid.mockResolvedValue({
      data: { id: "sent", status: "PAID", paidAt: NOW, payments: [payment("sent", 500)] },
      error: null,
    });
    mountLive([invoice("sent", "SENT", 500, [], { dueDate: PAST_DUE })]);
    expect(strip("Received")).toBe("—");
    fireEvent.click(screen.getAllByTitle("Mark Paid")[0]);
    await waitFor(() => expect(strip("Received")).toBe("TTD 500"));
    expect(strip("Overdue")).toBe("—");
  });

  it("CH-12 RED-BEFORE (COR-2): a PAID invoice with no payment row still counts its total, on the day it was paid (a marketplace order's INV-ORD invoice)", () => {
    mount([
      invoice("ord", "PAID", 250, [], { paidAt: NOW }),
      invoice("old", "PAID", 60, [], { paidAt: LAST_MONTH }),
    ]);
    expect(strip("Received")).toBe("TTD 310");
    expect(strip("This Month")).toBe("TTD 250");
    expect(within(health()).getByText("TTD 310 received")).toBeTruthy();
  });

  it("CH-13 RED-BEFORE (COR-5): one definition per label. A draft is not Pending in the strip, the filter count or the list", () => {
    mount([
      invoice("draft", "DRAFT", 999),
      invoice("dep", "PARTIALLY_PAID", 13723, [payment("dep", 400)]),
      invoice("late", "PARTIALLY_PAID", 500, [payment("late", 200)], { dueDate: PAST_DUE }),
      invoice("settled", "SENT", 80, [payment("settled", 80)], { dueDate: PAST_DUE }),
    ]);
    expect(strip("Pending")).toBe("TTD 13.3k");
    expect(filterCount("All")).toBe("4");
    expect(filterCount("Pending")).toBe("1");
    expect(filterCount("Overdue")).toBe("1");
    openFilter("Pending");
    expect(screen.queryByText("DEP")).not.toBeNull();
    expect(screen.queryByText("DRAFT")).toBeNull();
    // The Recovery Queue lists what is overdue and still owed, by what is left: not the settled SENT invoice, and 300 not 500.
    const queue = screen.getByText("Recovery Queue").closest("div.rounded-xl") as HTMLElement;
    expect(queue.textContent).toContain("LATE");
    expect(queue.textContent).not.toContain("SETTLED");
    expect(queue.textContent).toMatch(/300\.00/);
    expect(queue.textContent).not.toMatch(/500\.00/);
  });

  it("CH-14 (COR-7): a month whose refunds outweigh its receipts shows no figure, never a negative (100 received last month, refunded now)", () => {
    mount([
      invoice("gone", "SENT", 100, [payment("gone", 100, "SUCCESSFUL", LAST_MONTH), payment("gone", -100, "REFUNDED")]),
    ]);
    expect(strip("Received")).toBe("—");
    expect(strip("This Month")).toBe("—");
    expect(strip("Pending")).toBe("TTD 100");
    expectNoNegativeFigure(health());
  });
});
