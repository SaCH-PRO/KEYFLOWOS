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
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
const markInvoicePaid = vi.fn();
const getInvoice = vi.fn();
vi.mock("@/lib/client", () => ({
  markInvoicePaid: (...args: unknown[]) => markInvoicePaid(...args),
  getInvoice: (...args: unknown[]) => getInvoice(...args),
  updateInvoiceStatus: vi.fn(),
  sendInvoiceReminder: vi.fn(),
}));

vi.mock("../../components/commerce-hub", () => ({ CommerceHub: () => null }));

import PaymentsTab from "../payments-tab";
import { CommerceOverviewTab } from "../../components/commerce-overview-tab";
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
  getInvoice.mockReset();
  vi.mocked(toast.success).mockClear();
  // Unless a case says otherwise the re-read after Mark paid fails, so the tab falls back to what it knows.
  getInvoice.mockResolvedValue({ data: null, error: "offline" });
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
  it("CH-10 (COR-1; round 2 C2-2, S2-1): after Mark paid the tab shows the rows the server holds (re-read through the tenant-bound detail route), not its own guess", async () => {
    // The tab was loaded before another member recorded 100: the server then records the 200 left, not 300.
    markInvoicePaid.mockResolvedValue({ data: { id: "late", status: "PAID", paidAt: NOW }, error: null });
    getInvoice.mockResolvedValue({
      data: { ...invoice("late", "PAID", 500, [payment("late", 200), payment("late", 100), payment("late", 200)], { paidAt: NOW }) },
      error: null,
    });
    mountLive([invoice("late", "PARTIALLY_PAID", 500, [payment("late", 200)], { dueDate: PAST_DUE })]);
    expect(strip("Received")).toBe("TTD 200");
    expect(strip("Overdue")).toBe("TTD 300");
    fireEvent.click(screen.getAllByTitle("Mark Paid")[0]);
    await waitFor(() => expect(strip("Received")).toBe("TTD 500"));
    expect(getInvoice).toHaveBeenCalledWith("biz_v64", "late");
    // Round 3 S3-2: the write names the same business as the re-read (the tab's own), not whatever storage holds.
    expect(markInvoicePaid).toHaveBeenCalledWith("late", "biz_v64");
    expect(strip("Overdue")).toBe("—");
    expect(within(health()).getByTestId("collections-to-collect").textContent).toBe("TTD 0");
    expect(health().textContent).toContain("Collections healthy");
  });

  it("CH-11 (C2-2a): a credited invoice settled by Mark paid stays PARTIALLY_CREDITED with the money the server recorded; no paid date is invented", async () => {
    // 200 less a 50 credit note with 30 paid: mark-paid records the 120 left and the invoice stays PARTIALLY_CREDITED, paidAt null.
    markInvoicePaid.mockResolvedValue({ data: { id: "cred", status: "PARTIALLY_CREDITED", paidAt: null }, error: null });
    getInvoice.mockResolvedValue({
      data: { ...invoice("cred", "PARTIALLY_CREDITED", 200, [payment("cred", 30), payment("cred", 120)], { paidAt: null }) },
      error: null,
    });
    const seen: Invoice[][] = [];
    function Holder() {
      const [list, setList] = useState<Invoice[]>([invoice("cred", "PARTIALLY_CREDITED", 200, [payment("cred", 30)], { paidAt: null })]);
      seen.push(list);
      return <PaymentsTab invoices={list} currency="TTD" businessId="biz_v64" setInvoices={setList} />;
    }
    render(<Holder />);
    expect(strip("Received")).toBe("TTD 30");
    fireEvent.click(screen.getAllByTitle("Mark Paid")[0]);
    await waitFor(() => expect(strip("Received")).toBe("TTD 150"));
    const last = seen[seen.length - 1][0];
    expect(last.status).toBe("PARTIALLY_CREDITED");
    expect(last.paidAt ?? null).toBeNull();
  });

  it("CH-11b (C2-2b): when the re-read fails the tab adds what mark-paid records (what was left), for any status it accepts, and invents no paid date unless PAID", async () => {
    markInvoicePaid.mockImplementation(async (id: string) => ({ data: { id, status: id === "cred" ? "PARTIALLY_CREDITED" : "PAID", paidAt: id === "cred" ? null : NOW }, error: null }));
    const seen: Invoice[][] = [];
    function Holder() {
      const [list, setList] = useState<Invoice[]>([
        invoice("failed", "FAILED", 500, [payment("failed", 200)]),
        invoice("cred", "PARTIALLY_CREDITED", 200, [payment("cred", 30)], { paidAt: null }),
      ]);
      seen.push(list);
      return <PaymentsTab invoices={list} currency="TTD" businessId="biz_v64" setInvoices={setList} />;
    }
    render(<Holder />);
    expect(strip("Received")).toBe("TTD 230");
    // The FAILED invoice: the server records the 300 left and the invoice is PAID.
    fireEvent.click(screen.getAllByTitle("Mark Paid")[0]);
    await waitFor(() => expect(strip("Received")).toBe("TTD 530"));
    // The credited invoice: what the server recorded cannot be told from the list row (credit notes are not on it):
    // nothing is guessed and no paid date is invented.
    fireEvent.click(screen.getAllByTitle("Mark Paid")[0]);
    // Round 3 C3-1: the toast follows the state update, so what is read below is the state after it.
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));
    expect(markInvoicePaid).toHaveBeenCalledTimes(2);
    expect(getInvoice).toHaveBeenCalledTimes(2);
    const cred = seen[seen.length - 1].find((i) => i.id === "cred")!;
    expect(cred.paidAt ?? null).toBeNull();
    expect(strip("Received")).toBe("TTD 530");
  });

  it("CH-11c (C2-8): bulk Mark Paid takes the same path: each settled invoice is re-read and Received rises", async () => {
    markInvoicePaid.mockImplementation(async (id: string) => ({ data: { id, status: "PAID", paidAt: NOW }, error: null }));
    getInvoice.mockImplementation(async (_biz: string, id: string) => ({
      data: invoice(id, "PAID", id === "one" ? 100 : 250, [payment(id, id === "one" ? 100 : 250)], { paidAt: NOW }),
      error: null,
    }));
    mountLive([invoice("one", "SENT", 100), invoice("two", "SENT", 250)]);
    expect(strip("Received")).toBe("—");
    fireEvent.click(screen.getByLabelText("Select payment ONE"));
    fireEvent.click(screen.getByLabelText("Select payment TWO"));
    fireEvent.click(screen.getByRole("button", { name: /status/i }));
    fireEvent.click(screen.getByText("Mark Paid")); // the bulk menu's entry (the row buttons carry it as a title only)
    await waitFor(() => expect(strip("Received")).toBe("TTD 350"));
    expect(strip("Pending")).toBe("—");
    expect(getInvoice).toHaveBeenCalledTimes(2);
    expect(markInvoicePaid).toHaveBeenCalledWith("one", "biz_v64");
    expect(markInvoicePaid).toHaveBeenCalledWith("two", "biz_v64");
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

  it("CH-15 RED-BEFORE (round 2 C2-1): Received means one thing. The strip, its count, the filter count and the list are the invoices money came in on", () => {
    mount([
      invoice("dep", "PARTIALLY_PAID", 13723, [payment("dep", 400)]),
      invoice("paid", "PAID", 75, [payment("paid", 75)], { paidAt: NOW }),
      invoice("sent", "SENT", 90),
    ]);
    expect(strip("Received")).toBe("TTD 475");
    // The strip counts the invoices behind its figure: "· 2".
    const label = screen.getAllByText("Received").filter((el) => el.tagName === "SPAN" && el.parentElement?.tagName === "DIV" && el.previousElementSibling?.tagName === "SPAN")[0];
    expect(label.nextElementSibling?.textContent).toBe("· 2");
    expect(filterCount("Received")).toBe("2");
    openFilter("Received");
    expect(screen.queryByText("DEP")).not.toBeNull();
    expect(screen.queryByText("PAID", { selector: "span.truncate" })).not.toBeNull();
    expect(screen.queryByText("SENT", { selector: "span.truncate" })).toBeNull();
  });

  it("CH-16 RED-BEFORE (C2-4): Payment Methods are the money rows behind Received, on any invoice; a FAILED or PENDING row is no payment", () => {
    mount([
      invoice("dep", "PARTIALLY_PAID", 13723, [payment("dep", 400)]),
      invoice("retry", "PAID", 100, [payment("retry", 100, "FAILED"), payment("retry", 100)], { paidAt: NOW }),
      invoice("ord", "PAID", 250, [], { paidAt: NOW }),
    ]);
    expect(strip("Received")).toBe("TTD 750");
    const card = screen.getByText("Payment Methods").closest("div.rounded-xl") as HTMLElement;
    // cash: the 400 deposit and the 100 that went through (2 payments); Other: the invoice with no payment row.
    expect(card.textContent).toContain("cashTTD 5002 payments");
    expect(card.textContent).toContain("OtherTTD 2501 payment");
  });

  it("CH-17 RED-BEFORE (C2-5): a part-paid row states what is left beside its total, and a settled invoice past its due date is not drawn overdue", () => {
    mount([
      invoice("late", "PARTIALLY_PAID", 500, [payment("late", 200)], { dueDate: PAST_DUE }),
      invoice("settled", "SENT", 80, [payment("settled", 80)], { dueDate: PAST_DUE }),
    ]);
    const row = screen.getByLabelText("Select payment LATE").closest("div.rounded-lg") as HTMLElement;
    expect(row.textContent).toMatch(/500\.00/);
    expect(row.textContent).toMatch(/300\.00 left/);
    expect(row.className).toContain("bg-red-500");
    const settled = screen.getByLabelText("Select payment SETTLED").closest("div.rounded-lg") as HTMLElement;
    expect(settled.textContent).not.toMatch(/left/);
    expect(settled.className).not.toContain("bg-red-500");
  });

  it("CH-18 RED-BEFORE (C2-7): Received is the net of every money row, as the server states it: a refund on one invoice is not hidden by another's receipt", () => {
    mount([
      // A refund row with no payment row beside it (its payment was recorded elsewhere): money out.
      invoice("out", "SENT", 100, [payment("out", -40, "REFUNDED")]),
      invoice("in", "PARTIALLY_PAID", 500, [payment("in", 100)]),
    ]);
    expect(strip("Received")).toBe("TTD 60");
    expect(strip("This Month")).toBe("TTD 60");
  });

  it("CH-19 (C2-10): a PAID invoice with no paid date counts in Received and in no month; one whose only rows are PENDING / FAILED counts its total", () => {
    mount([
      invoice("undated", "PAID", 70, [], { paidAt: null }),
      invoice("noise", "PAID", 30, [payment("noise", 30, "PENDING"), payment("noise", 30, "FAILED")], { paidAt: LAST_MONTH }),
    ]);
    expect(strip("Received")).toBe("TTD 100");
    expect(strip("This Month")).toBe("—");
  });
});

/**
 * The Sales overview's hero (commerce-overview-tab.tsx, outside the packet's
 * write set; found by running journey D7 live at 30cc9f3e: on a desktop Sales
 * still read "Outstanding Revenue TTD 0.00 ... TTD 0 collected" for the
 * deposit book, BUG-020 itself). It summed invoice totals by status (SENT /
 * OVERDUE owed, PAID collected), so a part-paid invoice was neither. It reads
 * the same per-invoice money as the Payments tab.
 */
describe("V1-64 Sales overview hero: a deposit is collected and the rest is outstanding (BUG-020, desktop)", () => {
  function hero(invoices: Invoice[]): string {
    render(
      <CommerceOverviewTab invoices={invoices} quotes={[]} recurring={[]} currency="TTD" loading={false} onNavigate={() => {}} onNewItem={() => {}} />,
    );
    const label = screen.getByText("Outstanding Revenue");
    return (label.parentElement?.textContent ?? "").replace(/\s+/g, " ");
  }

  it("CH-20 RED-BEFORE: 13,723 with a 400 deposit -> Outstanding Revenue 13,323.00 and TTD 400 collected (it read 0.00 and TTD 0)", () => {
    const text = hero([invoice("dep", "PARTIALLY_PAID", 13723, [payment("dep", 400)]), invoice("draft", "DRAFT", 999)]);
    expect(text).toMatch(/Outstanding Revenue\D*13,323\.00/);
    expect(text).toContain("TTD 400 collected");
    expect(text).not.toMatch(/overdue/);
  });

  it("CH-21 RED-BEFORE: overdue is what is left past the due date, flagged OVERDUE or not; a paid invoice is collected, a refund is not", () => {
    const text = hero([
      invoice("late", "PARTIALLY_PAID", 500, [payment("late", 200)], { dueDate: PAST_DUE }),
      invoice("flag", "OVERDUE", 100, [], { dueDate: PAST_DUE }),
      invoice("paid", "PAID", 75, [payment("paid", 75)], { paidAt: NOW }),
      invoice("ref", "PARTIALLY_PAID", 100, [payment("ref", 60), payment("ref", 40), payment("ref", -40, "REFUNDED")]),
    ]);
    // owed: 300 + 100 + 40; collected: 200 + 75 + 60; overdue: 300 + 100 on two invoices
    expect(text).toMatch(/Outstanding Revenue\D*440\.00/);
    expect(text).toContain("TTD 335 collected");
    expect(text).toContain("2 overdue — TTD 400");
  });

  it("CH-22: a book of whole invoices reads as before: SENT owed, PAID collected (with or without a payment row)", () => {
    const text = hero([
      invoice("sent", "SENT", 600),
      invoice("paid", "PAID", 850, [payment("paid", 850)], { paidAt: NOW }),
      invoice("ord", "PAID", 250, [], { paidAt: NOW }),
    ]);
    expect(text).toMatch(/Outstanding Revenue\D*600\.00/);
    expect(text).toContain("TTD 1.1k collected");
  });
});
