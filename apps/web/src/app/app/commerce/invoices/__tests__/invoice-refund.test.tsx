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
 * Repair round 1 (the two reviews' minors; RED-R1 cases fail at 58423afe):
 *   - a payment is offered Refund only when the server's hand-recording door wrote it (its providerPaymentId is one of
 *     recordPayment's manual_ slots), whatever its provider says: a gateway row, a row of an unknown provider, a
 *     gateway name in another casing and a storefront order's row are not (fail closed);
 *   - Refund reads the invoice and its payments again and names the amount from that read (a stale cap is not used);
 *   - the amount is summed as the server sums it (exact decimals, rounded once), so a legacy sub-cent refund counts;
 *   - the dialog says what was paid and what will be refunded ("Refund TTD 60.00 of the TTD 100.00 paid by Cash on");
 *   - test gaps closed (CONTROL at 58423afe): an unlinked same-provider refund is subtracted where the cap does not hide
 *     it, and a refund linked by provider and reference is that payment's.
 *
 * Repair round 1b (the bookkeeping door is open to gateway payments on the server: commerce-refund RF-10/RF-12; WiPay
 * has no refund API; RED-R1B cases fail at 379e3309): a WiPay payment (provider exactly 'wipay', which only the WiPay
 * door writes: D-55 stores a hand-typed gateway name as 'manual') offers "Record refund", worded as a refund made
 * outside KeyFlow, through the same route; a Stripe or PayPal payment offers no bookkeeping refund but a link to the
 * existing gateway refund in Money > Money in (/app/payments?tab=refunds); another casing or provider offers neither.
 *
 * Repair round 2 (RED-R2 cases fail at a1ab2d8a; GUARD-R2 cases pin in-flight guards that are right at a1ab2d8a and
 * fail under their mutants N2, N4, N5, N6): a mark-paid row written before R0-PL-04 (manual_<invoiceId>_<13-digit ms>)
 * is offered Refund; the "whole" wording reads cents exactly (a legacy 1.005 payment reads "Refund the TTD 1.01");
 * while the dialog's read is in flight its confirm is disabled and sends nothing; a read landing after Cancel does
 * not reopen it; a failed read closes it with the error; of two quick presses only the last read opens its amount.
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

/** 32 hex characters standing for the server's sha256 slice. */
const hex32 = (id: string) => Array.from(id, (c) => c.charCodeAt(0).toString(16)).join("").padEnd(32, "0").slice(0, 32);

function pay(id: string, amount: number, over: Partial<Row> = {}): Row {
  return {
    id,
    amount,
    status: "SUCCESSFUL",
    currency: "TTD",
    provider: "Cash",
    method: "Cash",
    // recordPayment's keyed slot (CommerceService.manualProviderPaymentId): what the Record Payment form writes.
    providerPaymentId: `manual_${INV}_key_${hex32(id)}`,
    reference: null,
    createdAt: "2026-11-20T10:00:00.000Z",
    businessId: BIZ,
    invoiceId: INV,
    ...over,
  };
}

/** The refund row the server writes for `of`: negative, REFUNDED, linked by reference (D-14). */
function refundRow(id: string, of: Row, amount = Number(of.amount)): Row {
  return pay(id, -amount, { status: "REFUNDED", provider: of.provider, method: of.method, providerPaymentId: `manual_refund_${of.id}_${hex32(id).slice(0, 16)}`, reference: of.providerPaymentId });
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

/** The dialog's confirm, once it names `amount` and can be pressed. */
async function confirmFor(amount: number): Promise<HTMLElement> {
  let confirm: HTMLElement | null = null;
  await waitFor(() => {
    confirm = within(dialog()!).getByRole("button", { name: `Refund ${TTD(amount)}` });
    expect(confirm).not.toBeDisabled();
  });
  return confirm!;
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
    const pending = pay("pay_scan", 30, { status: "PENDING", provider: "extracted", method: "Bank Transfer", providerPaymentId: `extracted_${hex32("scan")}` });
    const rows = [CASH, bank, stripe, pending];
    await openPayments(invoice("PARTIALLY_PAID", rows, 190, 110), rows);

    expect(refundButton("pay_cash"), "the cash payment offers Refund").not.toBeNull();
    expect(refundButton("pay_bank"), "the bank transfer offers Refund").not.toBeNull();
    expect(refundButton("pay_stripe"), "a gateway payment is refunded through its gateway, not here").toBeNull();
    expect(refundButton("pay_scan"), "a pending scan is not money yet").toBeNull();
  });

  it("RED-R1 (fail closed): only a row the hand-recording door wrote offers Refund, whatever its provider says", async () => {
    const markPaid = pay("pay_markpaid", 20, { provider: "manual", method: "MANUAL", providerPaymentId: `manual_${INV}_markpaid_${hex32("mp")}` });
    const unkeyed = pay("pay_unkeyed", 10, { provider: "Other", method: "Other", providerPaymentId: "manual_1764000000000_k3x9q2" });
    const byRef = pay("pay_byref", 10, { provider: "PAYPAL", method: "PAYPAL", providerPaymentId: `manual_${INV}_ref_${hex32("rf")}` });
    const paypal = pay("pay_paypal", 10, { provider: "paypal", method: "paypal", providerPaymentId: "8AB12345CD678901E" });
    const wipay = pay("pay_wipay", 10, { provider: "wipay", method: "card", providerPaymentId: "wipay_txn_77" });
    const casing = pay("pay_casing", 10, { provider: "Stripe", method: "card", providerPaymentId: "pi_999" });
    const unknown = pay("pay_unknown", 10, { provider: "fygaro", method: "card", providerPaymentId: "fyg_abc123" });
    const manualNamed = pay("pay_named", 10, { provider: "manual", method: "MANUAL", providerPaymentId: "ch_3abc" });
    const store = pay("pay_store", 10, { provider: "manual", method: "manual", providerPaymentId: "manual_cmorder123_1764000000000" });
    const rows = [CASH, markPaid, unkeyed, byRef, paypal, wipay, casing, unknown, manualNamed, store];
    await openPayments(invoice("PARTIALLY_PAID", rows, 200, 100), rows);

    for (const id of ["pay_cash", "pay_markpaid", "pay_unkeyed", "pay_byref"]) expect(refundButton(id), `${id} was recorded by hand`).not.toBeNull();
    for (const id of ["pay_paypal", "pay_wipay", "pay_casing", "pay_unknown", "pay_named", "pay_store"]) {
      expect(refundButton(id), `${id} was not written by the hand-recording door`).toBeNull();
    }
  });

  it("RED-BEFORE: Refund asks first, naming the whole payment; nothing is sent until it is confirmed, and Cancel sends nothing", async () => {
    await openPayments(invoice("PARTIALLY_PAID", [CASH], 100, 200), [CASH]);

    pressRefund("pay_cash");
    await confirmFor(100);
    const asked = dialog()!;
    expect(asked.textContent).toContain(`Refund the ${TTD(100)} paid by Cash on`);
    expect(within(asked).queryByRole("spinbutton"), "no amount field: the whole payment (D-169)").toBeNull();
    expect(within(asked).queryByRole("textbox", { name: /amount/i })).toBeNull();
    expect(refundPayment).not.toHaveBeenCalled();

    fireEvent.click(within(asked).getByRole("button", { name: /^cancel$/i }));
    expect(dialog()).toBeNull();
    expect(refundPayment).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("RED-BEFORE: confirming POSTs payments/:id/refund once, names the server's refund and reads the invoice and its payments again", async () => {
    await openPayments(invoice("PARTIALLY_PAID", [CASH], 100, 200), [CASH]);
    const refunded = refundRow("pay_refund", CASH);
    let answer: (v: unknown) => void = () => {};
    refundPayment.mockReturnValue(new Promise((resolve) => { answer = resolve; }));

    pressRefund("pay_cash");
    const confirm = await confirmFor(100);
    const reads = getInvoice.mock.calls.length;
    const listReads = listInvoicePayments.mock.calls.length;
    getInvoice.mockResolvedValue({ data: invoice("SENT", [CASH, refunded], 0, 300), error: null });
    listInvoicePayments.mockResolvedValue(listed([refunded, CASH], 0, 300));
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
    fireEvent.click(await confirmFor(100));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(refusal));
    expect(toast.success).not.toHaveBeenCalled();
    expect(refundButton("pay_cash"), "the action is withdrawn").toBeNull();
    expect(summary()).toEqual({ paid: TTD(100), remaining: TTD(200) });
  });

  it("RED-BEFORE: a 409 (refunded meanwhile) is shown in the server's words, never as a refund, and the payments are read again", async () => {
    const refusal = "Payment is already refunded";
    await openPayments(invoice("PARTIALLY_PAID", [CASH], 100, 200), [CASH]);
    refundPayment.mockResolvedValue({ data: null, error: refusal, status: 409 });

    pressRefund("pay_cash");
    const confirm = await confirmFor(100);
    const listReads = listInvoicePayments.mock.calls.length;
    fireEvent.click(confirm);

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
    await confirmFor(40);
    expect(within(dialog()!).queryByRole("button", { name: `Refund ${TTD(100)}` }), "the refund is capped at what the invoice received net (the server's cap)").toBeNull();
  });

  it("RED-R1 (fresh amount): Refund reads the invoice and its payments again and names the amount from that read, not the stale one", async () => {
    await openPayments(invoice("PARTIALLY_PAID", [CASH], 100, 200), [CASH]);
    // Meanwhile another member refunded part of it (60) through the partial door: 40 is left.
    const part = refundRow("pay_part", CASH, 60);
    const reads = getInvoice.mock.calls.length;
    const listReads = listInvoicePayments.mock.calls.length;
    getInvoice.mockResolvedValue({ data: invoice("PARTIALLY_PAID", [CASH, part], 40, 260), error: null });
    listInvoicePayments.mockResolvedValue(listed([part, CASH], 40, 260));

    pressRefund("pay_cash");
    await confirmFor(40);
    expect(getInvoice.mock.calls.length, "the invoice is read again").toBeGreaterThan(reads);
    expect(listInvoicePayments.mock.calls.length, "its payments are read again").toBeGreaterThan(listReads);
    expect(within(dialog()!).queryByRole("button", { name: `Refund ${TTD(100)}` }), "never the stale amount").toBeNull();
  });

  it("RED-R1 (wording): a partly refunded payment's dialog says what was paid and what will be refunded", async () => {
    const part = refundRow("pay_part", CASH, 40);
    await openPayments(invoice("PARTIALLY_PAID", [CASH, part], 60, 240), [part, CASH]);

    pressRefund("pay_cash");
    await confirmFor(60);
    expect(dialog()!.textContent).toContain(`Refund ${TTD(60)} of the ${TTD(100)} paid by Cash on`);
    expect(dialog()!.textContent).not.toMatch(/TTD 60\.00 paid/);
  });

  it("RED-R1 (rounding parity): legacy sub-cent refund rows are summed exactly and rounded once, as the server sums them", async () => {
    const other = pay("pay_other", 50);
    // Two legacy rows of -0.004 linked to the cash payment: the server sums 0.008 and rounds once to 0.01.
    const legacyA = refundRow("pay_legacy_a", CASH, 0.004);
    const legacyB = refundRow("pay_legacy_b", CASH, 0.004);
    const rows = [CASH, other, legacyA, legacyB];
    await openPayments(invoice("PARTIALLY_PAID", rows, 149.99, 150.01), rows);

    pressRefund("pay_cash");
    await confirmFor(99.99);
  });

  it("CONTROL-R1 (test gap): an unlinked same-provider refund is subtracted where the cap does not hide it", async () => {
    const big = pay("pay_big", 150);
    const unlinked = pay("pay_unlinked", -60, { status: "REFUNDED", providerPaymentId: "manual_refund_unlinked", reference: null });
    const rows = [CASH, big, unlinked];
    await openPayments(invoice("PARTIALLY_PAID", rows, 190, 110), rows);

    pressRefund("pay_cash");
    await confirmFor(40);
  });

  it("CONTROL-R1 (test gap): a refund linked by its provider and the payment's own reference is that payment's", async () => {
    const withRef = pay("pay_ref", 100, { reference: "R-7" });
    const other = pay("pay_other", 150);
    // The provider's refund names the payment's reference, not its providerPaymentId.
    const linked = pay("pay_ref_refund", -100, { status: "REFUNDED", providerPaymentId: "manual_refund_byref", reference: "R-7" });
    const rows = [withRef, other, linked];
    await openPayments(invoice("PARTIALLY_PAID", rows, 150, 150), rows);

    expect(refundButton("pay_ref"), "nothing is left of it").toBeNull();
    expect(within(rowOf("pay_ref")).getByText(/^refunded$/i)).toBeInTheDocument();
    pressRefund("pay_other");
    await confirmFor(150);
  });

  it("RED-R1B: a WiPay payment offers Record refund, worded as a refund made outside KeyFlow, through the same route", async () => {
    const wipay = pay("pay_wipay", 100, { provider: "wipay", method: "card", providerPaymentId: "wipay_txn_77" });
    await openPayments(invoice("PARTIALLY_PAID", [wipay], 100, 200), [wipay]);
    const record = within(rowOf("pay_wipay")).queryByRole("button", { name: /^record refund/i });
    expect(record, "WiPay has no refund API: its refund is recorded here").not.toBeNull();
    expect(refundButton("pay_wipay"), "not offered as a refund KeyFlow makes").toBeNull();

    fireEvent.click(record!);
    let confirm: HTMLElement | null = null;
    await waitFor(() => {
      confirm = within(dialog()!).getByRole("button", { name: `Record refund ${TTD(100)}` });
      expect(confirm).not.toBeDisabled();
    });
    expect(dialog()!.textContent).toMatch(/outside KeyFlow/);
    expect(dialog()!.textContent).toContain(`the ${TTD(100)} paid through WiPay on`);
    expect(refundPayment).not.toHaveBeenCalled();

    const refunded = refundRow("pay_wipay_refund", wipay);
    refundPayment.mockResolvedValue({ data: { ...refunded, refundOfPaymentId: "pay_wipay", invoiceStatus: "SENT" }, error: null, status: 201 });
    getInvoice.mockResolvedValue({ data: invoice("SENT", [wipay, refunded], 0, 300), error: null });
    listInvoicePayments.mockResolvedValue(listed([refunded, wipay], 0, 300));
    fireEvent.click(confirm!);
    await waitFor(() => expect(summary()).toEqual({ paid: TTD(0), remaining: TTD(300) }));
    expect(refundPayment).toHaveBeenCalledTimes(1);
    expect(refundPayment.mock.calls[0]!.slice(0, 2)).toEqual([BIZ, "pay_wipay"]);
    expect(within(rowOf("pay_wipay")).getByText(/^refunded$/i)).toBeInTheDocument();
  });

  it("RED-R1B: a Stripe or PayPal payment links to the gateway refund in Money in and offers no bookkeeping refund; other providers offer neither", async () => {
    const stripe = pay("pay_stripe", 40, { provider: "stripe", method: "card", providerPaymentId: "pi_123" });
    const paypal = pay("pay_paypal", 30, { provider: "paypal", method: "paypal", providerPaymentId: "8AB12345CD678901E" });
    const casing = pay("pay_casing", 20, { provider: "WiPay", method: "card", providerPaymentId: "WIPAY_1" });
    const unknown = pay("pay_unknown", 10, { provider: "fygaro", method: "card", providerPaymentId: "fyg_1" });
    const rows = [stripe, paypal, casing, unknown];
    await openPayments(invoice("PARTIALLY_PAID", rows, 100, 200), rows);

    for (const id of ["pay_stripe", "pay_paypal"]) {
      const link = within(rowOf(id)).queryByRole("link", { name: /refund in money in/i });
      expect(link, `${id} is refunded through its gateway`).not.toBeNull();
      expect(link!.getAttribute("href")).toBe("/app/payments?tab=refunds");
      expect(within(rowOf(id)).queryByRole("button", { name: /refund/i }), `${id} offers no bookkeeping refund`).toBeNull();
    }
    for (const id of ["pay_casing", "pay_unknown"]) {
      expect(within(rowOf(id)).queryByRole("button", { name: /refund/i }), `${id}: fail closed`).toBeNull();
      expect(within(rowOf(id)).queryByRole("link", { name: /refund/i }), `${id}: fail closed`).toBeNull();
    }
  });

  it("RED-R2 (legacy mark-paid): a mark-paid row written before R0-PL-04 (manual_<invoiceId>_<ms>) offers Refund", async () => {
    const legacy = pay("pay_legacy_mp", 300, { provider: "manual", method: "MANUAL", providerPaymentId: `manual_${INV}_1731000000000` });
    await openPayments(invoice("PAID", [legacy], 300, 0), [legacy]);
    pressRefund("pay_legacy_mp");
    await confirmFor(300);
  });

  it("RED-R2 (exact cents in the wording): a legacy 1.005 payment reads as the whole TTD 1.01", async () => {
    const odd = pay("pay_odd", 1.005);
    await openPayments(invoice("PARTIALLY_PAID", [odd], 1.01, 298.99), [odd]);
    pressRefund("pay_odd");
    await confirmFor(1.01);
    expect(dialog()!.textContent).toContain(`Refund the ${TTD(1.01)} paid by Cash on`);
  });

  /** Makes the next read of the payments wait until the returned function is called with its answer. */
  function holdNextRead(): (answer: unknown) => void {
    let release: (v: unknown) => void = () => {};
    listInvoicePayments.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    return (answer) => release(answer);
  }

  it("GUARD-R2 (N2): while the read is in flight the confirm is disabled, and pressing it sends nothing", async () => {
    await openPayments(invoice("PARTIALLY_PAID", [CASH], 100, 200), [CASH]);
    const release = holdNextRead();
    pressRefund("pay_cash");
    const confirm = await waitFor(() => within(dialog()!).getByRole("button", { name: /^refund/i }));
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(refundPayment).not.toHaveBeenCalled();
    release(listed([CASH], 100, 200));
    await confirmFor(100);
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it("GUARD-R2 (N4): a read that lands after Cancel does not reopen the dialog", async () => {
    await openPayments(invoice("PARTIALLY_PAID", [CASH], 100, 200), [CASH]);
    const release = holdNextRead();
    pressRefund("pay_cash");
    await waitFor(() => expect(dialog()).not.toBeNull());
    fireEvent.click(within(dialog()!).getByRole("button", { name: /^cancel$/i }));
    expect(dialog()).toBeNull();
    release(listed([CASH], 100, 200));
    await new Promise((r) => setTimeout(r, 50));
    expect(dialog(), "cancelled stays cancelled").toBeNull();
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it("GUARD-R2 (N5): a failed read closes the dialog, shows the error and posts nothing", async () => {
    await openPayments(invoice("PARTIALLY_PAID", [CASH], 100, 200), [CASH]);
    listInvoicePayments.mockResolvedValueOnce({ data: null, error: "Payments could not be read: connection reset" });
    pressRefund("pay_cash");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Payments could not be read: connection reset"));
    expect(dialog()).toBeNull();
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it("GUARD-R2 (N6): of two quick Refund presses, only the last one's read opens its amount", async () => {
    const other = pay("pay_other", 50);
    await openPayments(invoice("PARTIALLY_PAID", [CASH, other], 150, 150), [CASH, other]);
    const releaseFirst = holdNextRead();
    pressRefund("pay_cash");
    pressRefund("pay_other");
    await confirmFor(50);
    releaseFirst(listed([CASH, other], 150, 150));
    await new Promise((r) => setTimeout(r, 50));
    expect(within(dialog()!).queryByRole("button", { name: `Refund ${TTD(100)}` }), "the stale read is ignored").toBeNull();
    expect(within(dialog()!).getByRole("button", { name: `Refund ${TTD(50)}` })).toBeInTheDocument();
  });

  it("CONTROL: a payment recorded on a paid invoice is listed with its amount in the invoice's currency", async () => {
    const full = pay("pay_full", 300);
    await openPayments(invoice("PAID", [full], 300, 0), [full]);
    expect(within(rowOf("pay_full")).getByText(TTD(300))).toBeInTheDocument();
    expect(refundPayment).not.toHaveBeenCalled();
  });
});
