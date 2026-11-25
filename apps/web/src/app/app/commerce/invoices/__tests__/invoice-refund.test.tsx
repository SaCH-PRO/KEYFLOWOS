/**
 * SWP-INV-REFUND-UI (sweep BUG-049; journey E10; refund ruling D-169: whole-payment refunds only in v1), the web
 * half on the invoice page (/app/commerce/invoices/[id]). The Payments hub half (Money > Money in, /app/payments) is
 * src/app/app/payments/__tests__/payments-manual-refund.test.tsx; the browser half is e2e/sweep-manual-refund.spec.ts.
 *
 * The server's refund door already exists and is unchanged (POST /commerce/businesses/:businessId/payments/:paymentId/
 * refund, revenue:write, commerce-payment-integrity PM-11..PM-13, PM-20, PM-21): it records a separate negative
 * REFUNDED row for what is left of a SUCCESSFUL payment (never more than the invoice's net received), calls no
 * provider, reopens the invoice (PARTIALLY_PAID, or SENT once nothing net is received), and answers 409 "Payment is
 * already refunded" for a payment with nothing left and 403 without revenue write access. Before this packet no
 * screen called it (BUG-049: a cash payment recorded by mistake could not be refunded anywhere).
 *
 * What the page must do (RED-BEFORE: at the base the Payments tab offers no Refund at all):
 *   - a payment recorded by hand (cash, bank transfer: not a gateway row, not a refund row, not a pending scan) that
 *     still has money left offers Refund; a gateway payment (stripe, paypal, wipay: the hub's gateway refund is its
 *     door), a refund row and a pending extracted row do not; a payment refunded already says Refunded;
 *   - Refund asks first: a dialog names the whole amount that will be refunded (no amount field, D-169), capped at
 *     what the invoice has received net (as the server caps it); nothing is sent until it is confirmed, and Cancel
 *     sends nothing;
 *   - confirming POSTs payments/:id/refund once (a second press while it is in flight sends nothing), names the
 *     amount the server refunded, and reads the invoice and its payments again, so the server's figures and status
 *     show;
 *   - a refusal is shown in the server's own words where the member is looking, never as a refund: a 403 also
 *     withdraws Refund; a 409 reads the payments again.
 *
 * The page is mounted as the route renders it; its data doors (@/lib/client), the workspace, the router and the
 * composer are stubbed with server-shaped answers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { Invoice, PaymentRecord } from "@/lib/client";

const getInvoice = vi.hoisted(() => vi.fn());
const getInvoiceTimeline = vi.hoisted(() => vi.fn());
const listInvoicePayments = vi.hoisted(() => vi.fn());
const refundPayment = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ id: "inv_rf" }),
  usePathname: () => "/app/commerce/invoices/inv_rf",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace")>();
  return { ...actual, refreshWorkspace: async () => "biz_rf", getStoredBusinessId: () => "biz_rf" };
});
vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  return {
    ...actual,
    getInvoice: (...args: unknown[]) => getInvoice(...args),
    getInvoiceTimeline: (...args: unknown[]) => getInvoiceTimeline(...args),
    listInvoicePayments: (...args: unknown[]) => listInvoicePayments(...args),
    refundPayment: (...args: unknown[]) => refundPayment(...args),
  };
});

import { toast } from "sonner";
import InvoiceDetailPage from "../[id]/page";
import { formatAmount } from "../../utils/commerce-utils";

const BIZ = "biz_rf";
const INV = "inv_rf";
const TTD = (n: number) => formatAmount(n, "TTD");

type Row = PaymentRecord & { reference?: string | null; method?: string | null };

function pay(id: string, amount: number, over: Partial<Row> = {}): Row {
  return {
    id,
    amount,
    status: "SUCCESSFUL",
    currency: "TTD",
    provider: "Cash",
    method: "Cash",
    providerPaymentId: `manual_${INV}_${id}`,
    reference: null,
    createdAt: "2026-11-20T10:00:00.000Z",
    businessId: BIZ,
    invoiceId: INV,
    ...over,
  };
}

/** The refund row the server writes for `of`: negative, REFUNDED, linked by reference (D-14). */
function refundRow(id: string, of: Row, amount = Number(of.amount)): Row {
  return pay(id, -amount, { status: "REFUNDED", provider: of.provider, method: of.method, providerPaymentId: `manual_refund_${of.id}_${id}`, reference: of.providerPaymentId });
}

const CASH = pay("pay_cash", 100);

function invoice(status: string, payments: Row[], paidAmount: number, remaining: number): Invoice {
  return {
    id: INV,
    invoiceNumber: "INV-RF",
    status,
    total: 300,
    subtotal: 300,
    taxRate: 0,
    taxAmount: 0,
    discountAmount: 0,
    currency: "TTD",
    issueDate: "2026-11-18T10:00:00.000Z",
    dueDate: "2026-12-18T10:00:00.000Z",
    contactId: "ct_rf",
    contact: { firstName: "Rena", lastName: "Ali", email: "rena@example.test" },
    items: [{ id: "it_1", description: "Catering", quantity: 1, unitPrice: 300, total: 300 } as NonNullable<Invoice["items"]>[number]],
    payments,
    paidAmount,
    remaining,
  };
}

function listed(payments: Row[], paidAmount: number, remaining: number) {
  return { data: { payments, paidAmount, remaining, invoiceTotal: 300 }, error: null };
}

function rowOf(id: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-testid='invoice-payment-row'][data-payment-id='${id}']`);
  if (!row) throw new Error(`no payment row ${id}`);
  return row;
}

/** The Payment Summary's Paid and Remaining (the server's figures). */
function summary(): { paid: string; remaining: string } {
  const box = screen.getByText("Payment Summary").parentElement as HTMLElement;
  const line = (label: string) => Array.from(box.querySelectorAll("div")).find((d) => d.firstElementChild?.textContent === label)?.lastElementChild?.textContent ?? "";
  return { paid: line("Paid"), remaining: line("Remaining") };
}

/** Mounts the page on `first` (also what a read again answers, unless a case says otherwise) with `rows` served for its Payments tab, and opens the tab. */
async function openPayments(first: Invoice, rows: Row[]) {
  getInvoice.mockResolvedValue({ data: first, error: null });
  listInvoicePayments.mockResolvedValue(listed(rows, Number(first.paidAmount), Number(first.remaining)));
  render(<InvoiceDetailPage />);
  await waitFor(() => expect(screen.getByText("Payment Summary")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /^Payments/ }));
  await waitFor(() => expect(document.querySelectorAll("[data-testid='invoice-payment-row']").length).toBe(rows.length));
}

const refundButton = (id: string) => within(rowOf(id)).queryByRole("button", { name: /^refund/i });
const dialog = () => screen.queryByRole("dialog");

/** Presses the row's Refund (the row must offer it). */
function pressRefund(id: string) {
  const button = refundButton(id);
  expect(button, `the payment ${id} offers Refund`).not.toBeNull();
  fireEvent.click(button!);
}

beforeEach(() => {
  for (const fn of [getInvoice, getInvoiceTimeline, listInvoicePayments, refundPayment]) fn.mockReset();
  for (const fn of [toast.success, toast.error, toast.info, toast.warning]) vi.mocked(fn).mockReset();
  getInvoiceTimeline.mockResolvedValue({ data: { entries: [] }, error: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SWP-INV-REFUND-UI: refund a manual payment on the invoice page (BUG-049, D-169)", () => {
  it("RED-BEFORE: a payment recorded by hand offers Refund; a gateway payment, a refund row and a pending scan do not", async () => {
    const bank = pay("pay_bank", 50, { provider: "Bank Transfer", method: "Bank Transfer" });
    const stripe = pay("pay_stripe", 40, { provider: "stripe", method: "card", providerPaymentId: "pi_123" });
    const pending = pay("pay_scan", 30, { status: "PENDING", provider: "extracted", method: "Bank Transfer" });
    const rows = [CASH, bank, stripe, pending];
    await openPayments(invoice("PARTIALLY_PAID", rows, 190, 110), rows);

    expect(refundButton("pay_cash"), "the cash payment offers Refund").not.toBeNull();
    expect(refundButton("pay_bank"), "the bank transfer offers Refund").not.toBeNull();
    expect(refundButton("pay_stripe"), "a gateway payment is refunded through its gateway, not here").toBeNull();
    expect(refundButton("pay_scan"), "a pending scan is not money yet").toBeNull();
  });

  it("RED-BEFORE: Refund asks first, naming the whole payment; nothing is sent until it is confirmed, and Cancel sends nothing", async () => {
    await openPayments(invoice("PARTIALLY_PAID", [CASH], 100, 200), [CASH]);

    pressRefund("pay_cash");
    const asked = dialog();
    expect(asked, "a confirm dialog opens").not.toBeNull();
    expect(asked!.textContent).toContain(TTD(100));
    expect(within(asked!).queryByRole("spinbutton"), "no amount field: the whole payment (D-169)").toBeNull();
    expect(within(asked!).queryByRole("textbox", { name: /amount/i })).toBeNull();
    expect(refundPayment).not.toHaveBeenCalled();

    fireEvent.click(within(asked!).getByRole("button", { name: /^cancel$/i }));
    expect(dialog()).toBeNull();
    expect(refundPayment).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("RED-BEFORE: confirming POSTs payments/:id/refund once, names the server's refund and reads the invoice and its payments again", async () => {
    await openPayments(invoice("PARTIALLY_PAID", [CASH], 100, 200), [CASH]);
    const refunded = refundRow("pay_refund", CASH);
    let answer: (v: unknown) => void = () => {};
    refundPayment.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const reads = getInvoice.mock.calls.length;
    const listReads = listInvoicePayments.mock.calls.length;
    getInvoice.mockResolvedValue({ data: invoice("SENT", [CASH, refunded], 0, 300), error: null });
    listInvoicePayments.mockResolvedValue(listed([refunded, CASH], 0, 300));

    pressRefund("pay_cash");
    const confirm = within(dialog()!).getByRole("button", { name: /^refund/i });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(refundPayment, "one POST, however often it is pressed while in flight").toHaveBeenCalledTimes(1);
    expect(refundPayment.mock.calls[0]!.slice(0, 2)).toEqual([BIZ, "pay_cash"]);
    expect(toast.success, "nothing is claimed before the server answers").not.toHaveBeenCalled();

    answer({ data: { ...refunded, refundOfPaymentId: "pay_cash", invoiceStatus: "SENT" }, error: null, status: 201 });

    await waitFor(() => expect(summary()).toEqual({ paid: TTD(0), remaining: TTD(300) }));
    expect(getInvoice.mock.calls.length, "the invoice is read again").toBeGreaterThan(reads);
    expect(listInvoicePayments.mock.calls.length, "its payments are read again").toBeGreaterThan(listReads);
    await waitFor(() => expect(document.querySelectorAll("[data-testid='invoice-payment-row']").length).toBe(2));
    expect(screen.getByText("Sent", { selector: "span" })).toBeInTheDocument();
    expect(vi.mocked(toast.success).mock.calls.map((c) => String(c[0])).join(" ")).toContain(TTD(100));
    expect(dialog()).toBeNull();
    expect(refundButton("pay_cash"), "a refunded payment offers no second refund").toBeNull();
    expect(within(rowOf("pay_cash")).getByText(/^refunded$/i)).toBeInTheDocument();
  });

  it("RED-BEFORE: a 403 is shown in the server's words, Refund is withdrawn and nothing reads as refunded", async () => {
    const refusal = "Insufficient permissions: revenue requires write access (you have read)";
    await openPayments(invoice("PARTIALLY_PAID", [CASH], 100, 200), [CASH]);
    refundPayment.mockResolvedValue({ data: null, error: refusal, status: 403 });

    pressRefund("pay_cash");
    fireEvent.click(within(dialog()!).getByRole("button", { name: /^refund/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(refusal));
    expect(toast.success).not.toHaveBeenCalled();
    expect(refundButton("pay_cash"), "the action is withdrawn").toBeNull();
    expect(summary()).toEqual({ paid: TTD(100), remaining: TTD(200) });
  });

  it("RED-BEFORE: a 409 (refunded meanwhile) is shown in the server's words, never as a refund, and the payments are read again", async () => {
    const refusal = "Payment is already refunded";
    await openPayments(invoice("PARTIALLY_PAID", [CASH], 100, 200), [CASH]);
    refundPayment.mockResolvedValue({ data: null, error: refusal, status: 409 });
    const listReads = listInvoicePayments.mock.calls.length;

    pressRefund("pay_cash");
    fireEvent.click(within(dialog()!).getByRole("button", { name: /^refund/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(refusal));
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(listInvoicePayments.mock.calls.length).toBeGreaterThan(listReads));
  });

  it("RED-BEFORE (amount check): a payment refunded already offers no Refund, and the dialog never names more than the invoice received net", async () => {
    const other = pay("pay_other", 100, { createdAt: "2026-11-19T10:00:00.000Z" });
    const done = refundRow("pay_done", other);
    // A refund of 60 the server could not link to one payment: the invoice has received 40 net of its 100.
    const unlinked = pay("pay_unlinked", -60, { status: "REFUNDED", providerPaymentId: "manual_refund_x", reference: null });
    const rows = [CASH, other, done, unlinked];
    await openPayments(invoice("PARTIALLY_PAID", rows, 40, 260), rows);

    expect(refundButton("pay_other"), "nothing is left of a refunded payment").toBeNull();
    expect(within(rowOf("pay_other")).getByText(/^refunded$/i)).toBeInTheDocument();
    expect(refundButton("pay_done"), "a refund row is not refunded").toBeNull();

    pressRefund("pay_cash");
    const text = dialog()!.textContent ?? "";
    expect(text, "the refund is capped at what the invoice received net (the server's cap)").toContain(TTD(40));
    expect(text).not.toContain(TTD(100));
  });

  it("CONTROL: a payment recorded on a paid invoice is listed with its amount in the invoice's currency", async () => {
    const full = pay("pay_full", 300);
    await openPayments(invoice("PAID", [full], 300, 0), [full]);
    expect(within(rowOf("pay_full")).getByText(TTD(300))).toBeInTheDocument();
    expect(refundPayment).not.toHaveBeenCalled();
  });
});
