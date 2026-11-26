/**
 * SWP-INV-REFUND-UI (sweep BUG-049; journey E10; refund ruling D-169: whole-payment refunds only in v1), the Payments
 * hub half: Money > Money in (/app/payments). The invoice page half is
 * src/app/app/commerce/invoices/__tests__/invoice-refund.test.tsx; the browser half is e2e/sweep-manual-refund.spec.ts.
 *
 * Before this packet the hub listed and refunded gateway charges only (Stripe, PayPal, WiPay, through
 * POST /payments/businesses/:id/refunds): a payment recorded by hand (cash, bank transfer) appeared nowhere on it and
 * could not be refunded (RED-BEFORE). Now:
 *   - Recent activity lists the payments recorded by hand (GET /commerce/businesses/:id/payments, revenue:read), each
 *     with its invoice, its amount in its own currency and Refund while something is left of it; one refunded already
 *     says Refunded; a gateway row is not listed here (its gateway refund is the hub's other door);
 *   - Refund reads that invoice's payments now (the server's rows and net received) and asks first, naming the whole
 *     amount that will be refunded (no amount field); nothing is sent until it is confirmed;
 *   - confirming POSTs /commerce/businesses/:id/payments/:paymentId/refund once, names the server's refund and reads
 *     the payments again; a refusal is shown in the server's words, never as a refund (a 403 withdraws Refund);
 *   - D-100: when the payments cannot be read (403 without revenue read), no amount is shown.
 *
 * Repair round 1 (the two reviews' minors; RED-R1 cases fail at 58423afe): only a row the hand-recording door wrote is
 * listed (fail closed on provider); the dialog says what was paid and what will be refunded; typing in the search box
 * does not read the payments again; of two quick Refund presses only the last one's lookup opens its dialog; and
 * (CONTROL-R1, a test gap) a 409 reads the payments again and the row then reads Refunded.
 *
 * Repair round 2 (GUARD-R2: right at a1ab2d8a, failing under mutants N2, N4, N5): while the dialog's read is in flight
 * its confirm is disabled and sends nothing; a read landing after Cancel does not reopen it; a failed read closes it
 * with the error and posts nothing.
 *
 * The page is mounted with its shell reduced to its children and its data doors (@/lib/client) stubbed with
 * server-shaped answers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { BusinessPayment, PaymentRecord } from "@/lib/client";

const fetchBusinessPayments = vi.hoisted(() => vi.fn());
const listInvoicePayments = vi.hoisted(() => vi.fn());
const refundPayment = vi.hoisted(() => vi.fn());
const refundPaymentsCharge = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/payments",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ui/workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div>,
}));
vi.mock("@/lib/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace")>();
  return { ...actual, getStoredBusinessId: () => "biz_hub" };
});
vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  return {
    ...actual,
    fetchPaymentsGateways: async () => ({ data: [], error: null }),
    fetchPaymentsTransactions: async () => ({ data: [], error: null }),
    fetchPaymentsLinks: async () => ({ data: [], error: null }),
    fetchBusinessPayments: (...args: unknown[]) => fetchBusinessPayments(...args),
    listInvoicePayments: (...args: unknown[]) => listInvoicePayments(...args),
    refundPayment: (...args: unknown[]) => refundPayment(...args),
    refundPaymentsCharge: (...args: unknown[]) => refundPaymentsCharge(...args),
  };
});

import { toast } from "sonner";
import PaymentsPage from "../page";
import { formatCurrency } from "@/lib/currency";

const BIZ = "biz_hub";
const USD = (n: number) => formatCurrency(n, "USD");

/** 32 hex characters standing for the server's sha256 slice. */
const hex32 = (id: string) => Array.from(id, (c) => c.charCodeAt(0).toString(16)).join("").padEnd(32, "0").slice(0, 32);

function bp(id: string, invoiceId: string, amount: number, over: Partial<BusinessPayment> = {}): BusinessPayment {
  return {
    id,
    amount,
    currency: "USD",
    status: "SUCCESSFUL",
    provider: "Cash",
    method: "Cash",
    // recordPayment's keyed slot (CommerceService.manualProviderPaymentId): what the Record Payment form writes.
    providerPaymentId: `manual_${invoiceId}_key_${hex32(id)}`,
    reference: null,
    createdAt: "2026-11-20T10:00:00.000Z",
    businessId: BIZ,
    invoiceId,
    invoice: {
      id: invoiceId,
      invoiceNumber: `INV-${invoiceId.toUpperCase()}`,
      status: "PARTIALLY_PAID",
      currency: "USD",
      total: 300,
      dueDate: null,
      issueDate: null,
      receiptSentAt: null,
      contactId: "ct_1",
      contact: { id: "ct_1", firstName: "Rena", lastName: "Ali", email: "rena@example.test" },
    },
    ...over,
  };
}

/** The refund row the server writes for `of` (D-14): negative, REFUNDED, linked by reference. */
function refundOf(id: string, of: BusinessPayment): BusinessPayment {
  return bp(id, of.invoiceId, -Number(of.amount), { status: "REFUNDED", providerPaymentId: `manual_refund_${of.id}_${hex32(id).slice(0, 16)}`, reference: of.providerPaymentId });
}

const asRecord = (p: BusinessPayment): PaymentRecord & { reference?: string | null } => ({ ...p });
const listedFor = (rows: BusinessPayment[], paidAmount: number) => ({ data: { payments: rows.map(asRecord), paidAmount, remaining: 300 - paidAmount, invoiceTotal: 300 }, error: null });

const CASH = bp("pay_cash", "inv_a", 120);
const OLD = bp("pay_old", "inv_b", 80, { createdAt: "2026-11-01T10:00:00.000Z" });
const OLD_REFUND = refundOf("pay_old_refund", OLD);
const STRIPE = bp("pay_stripe", "inv_c", 60, { provider: "stripe", method: "card", providerPaymentId: "pi_1" });

function row(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-testid='recorded-payment-row'][data-payment-id='${id}']`);
  if (!el) throw new Error(`no recorded payment row ${id}`);
  return el;
}
const refundButton = (id: string) => within(row(id)).queryByRole("button", { name: /^refund/i });
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
    confirm = within(dialog()!).getByRole("button", { name: `Refund ${USD(amount)}` });
    expect(confirm).not.toBeDisabled();
  });
  return confirm!;
}

async function mount(rows: BusinessPayment[]) {
  fetchBusinessPayments.mockResolvedValue({ data: rows, error: null });
  render(<PaymentsPage />);
  await waitFor(() => expect(document.querySelector("[data-testid='recorded-payment-row']")).not.toBeNull());
}

beforeEach(() => {
  for (const fn of [fetchBusinessPayments, listInvoicePayments, refundPayment, refundPaymentsCharge]) fn.mockReset();
  for (const fn of [toast.success, toast.error, toast.info, toast.warning]) vi.mocked(fn).mockReset();
  listInvoicePayments.mockResolvedValue(listedFor([CASH], 120));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SWP-INV-REFUND-UI: refund a manual payment from Money > Money in (BUG-049, D-169)", () => {
  it("RED-BEFORE: Recent activity lists the payments recorded by hand with their invoice and amount; Refund while something is left", async () => {
    await mount([CASH, OLD_REFUND, OLD, STRIPE]);

    expect(row("pay_cash").textContent).toContain(USD(120));
    expect(row("pay_cash").textContent).toContain("INV-INV_A");
    expect(refundButton("pay_cash"), "the cash payment offers Refund").not.toBeNull();
    expect(refundButton("pay_old"), "nothing is left of a refunded payment").toBeNull();
    expect(within(row("pay_old")).getByText(/^refunded$/i)).toBeInTheDocument();
    expect(document.querySelector("[data-payment-id='pay_stripe']"), "a gateway row is refunded through its gateway").toBeNull();
    expect(document.querySelector("[data-payment-id='pay_old_refund']"), "a refund row is not a payment").toBeNull();
  });

  it("RED-R1 (fail closed): only a row the hand-recording door wrote is listed, whatever its provider says", async () => {
    const markPaid = bp("pay_markpaid", "inv_d", 20, { provider: "manual", method: "MANUAL", providerPaymentId: `manual_inv_d_markpaid_${hex32("mp")}` });
    const paypal = bp("pay_paypal", "inv_e", 10, { provider: "paypal", method: "paypal", providerPaymentId: "8AB12345CD678901E" });
    const wipay = bp("pay_wipay", "inv_e", 10, { provider: "wipay", method: "card", providerPaymentId: "wipay_txn_77" });
    const casing = bp("pay_casing", "inv_e", 10, { provider: "Stripe", method: "card", providerPaymentId: "pi_999" });
    const unknown = bp("pay_unknown", "inv_e", 10, { provider: "fygaro", method: "card", providerPaymentId: "fyg_abc123" });
    const store = bp("pay_store", "inv_e", 10, { provider: "manual", method: "manual", providerPaymentId: "manual_cmorder123_1764000000000" });
    await mount([CASH, markPaid, STRIPE, paypal, wipay, casing, unknown, store]);

    expect(refundButton("pay_cash")).not.toBeNull();
    expect(refundButton("pay_markpaid"), "mark-paid is the hand-recording door's").not.toBeNull();
    for (const id of ["pay_stripe", "pay_paypal", "pay_wipay", "pay_casing", "pay_unknown", "pay_store"]) {
      expect(document.querySelector(`[data-testid='recorded-payment-row'][data-payment-id='${id}']`), `${id} was not recorded by hand`).toBeNull();
    }
  });

  it("RED-BEFORE: Refund reads the invoice's payments and asks first, naming the whole payment; Cancel sends nothing", async () => {
    await mount([CASH]);

    pressRefund("pay_cash");
    await confirmFor(120);
    expect(listInvoicePayments).toHaveBeenCalledWith(BIZ, "inv_a");
    expect(dialog()!.textContent).toContain(`Refund the ${USD(120)} paid by Cash on`);
    expect(within(dialog()!).queryByRole("spinbutton"), "no amount field (D-169)").toBeNull();
    expect(refundPayment).not.toHaveBeenCalled();

    fireEvent.click(within(dialog()!).getByRole("button", { name: /^cancel$/i }));
    expect(dialog()).toBeNull();
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it("RED-BEFORE (amount check): the dialog never names more than the invoice received net, and a payment with nothing left is not sent", async () => {
    await mount([CASH]);
    // The invoice has received 50 net (another refund the hub's list does not show).
    listInvoicePayments.mockResolvedValueOnce(listedFor([CASH], 50));
    pressRefund("pay_cash");
    await confirmFor(50);
    expect(within(dialog()!).queryByRole("button", { name: `Refund ${USD(120)}` })).toBeNull();
    expect(dialog()!.textContent, "what was paid and what will be refunded").toContain(`Refund ${USD(50)} of the ${USD(120)} paid by Cash on`);
    fireEvent.click(within(dialog()!).getByRole("button", { name: /^cancel$/i }));

    // Refunded meanwhile (by another member): the fresh read shows nothing left, so nothing is asked or sent.
    listInvoicePayments.mockResolvedValueOnce(listedFor([refundOf("r2", CASH), CASH], 0));
    pressRefund("pay_cash");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/nothing is left to refund/i));
    expect(dialog()).toBeNull();
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it("RED-BEFORE: confirming POSTs payments/:id/refund once, names the server's refund and reads the payments again", async () => {
    await mount([CASH]);
    const refunded = refundOf("pay_cash_refund", CASH);
    let answer: (v: unknown) => void = () => {};
    refundPayment.mockReturnValue(new Promise((resolve) => { answer = resolve; }));

    pressRefund("pay_cash");
    const confirm = await confirmFor(120);
    const reads = fetchBusinessPayments.mock.calls.length;
    fetchBusinessPayments.mockResolvedValue({ data: [refunded, CASH], error: null });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(refundPayment).toHaveBeenCalledTimes(1);
    expect(refundPayment.mock.calls[0]!.slice(0, 2)).toEqual([BIZ, "pay_cash"]);
    expect(refundPaymentsCharge, "not the gateway refund door").not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();

    answer({ data: { ...refunded, refundOfPaymentId: "pay_cash", invoiceStatus: "SENT" }, error: null, status: 201 });

    await waitFor(() => expect(fetchBusinessPayments.mock.calls.length).toBeGreaterThan(reads));
    await waitFor(() => expect(refundButton("pay_cash")).toBeNull());
    expect(within(row("pay_cash")).getByText(/^refunded$/i)).toBeInTheDocument();
    expect(vi.mocked(toast.success).mock.calls.map((c) => String(c[0])).join(" ")).toContain(USD(120));
    expect(dialog()).toBeNull();
  });

  it("RED-BEFORE: a refusal is shown in the server's words, never as a refund; a 403 withdraws Refund", async () => {
    const refusal = "Insufficient permissions: revenue requires write access (you have read)";
    await mount([CASH]);
    refundPayment.mockResolvedValue({ data: null, error: refusal, status: 403 });

    pressRefund("pay_cash");
    fireEvent.click(await confirmFor(120));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(refusal));
    expect(toast.success).not.toHaveBeenCalled();
    expect(refundButton("pay_cash")).toBeNull();
    expect(within(row("pay_cash")).queryByText(/^refunded$/i)).toBeNull();
  });

  it("CONTROL-R1 (test gap): a 409 is shown in the server's words, the payments are read again and the row then reads Refunded", async () => {
    const refusal = "Payment is already refunded";
    await mount([CASH]);
    refundPayment.mockResolvedValue({ data: null, error: refusal, status: 409 });

    pressRefund("pay_cash");
    const confirm = await confirmFor(120);
    const reads = fetchBusinessPayments.mock.calls.length;
    fetchBusinessPayments.mockResolvedValue({ data: [refundOf("pay_cash_other_refund", CASH), CASH], error: null });
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(refusal));
    await waitFor(() => expect(fetchBusinessPayments.mock.calls.length).toBeGreaterThan(reads));
    await waitFor(() => expect(within(row("pay_cash")).getByText(/^refunded$/i)).toBeInTheDocument());
    expect(refundButton("pay_cash")).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("RED-R1: typing in the search box does not read the payments again", async () => {
    await mount([CASH]);
    const reads = fetchBusinessPayments.mock.calls.length;
    const box = screen.getByPlaceholderText(/search by id/i);
    fireEvent.change(box, { target: { value: "r" } });
    fireEvent.change(box, { target: { value: "re" } });
    fireEvent.change(box, { target: { value: "ren" } });
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchBusinessPayments.mock.calls.length).toBe(reads);
  });

  it("RED-R1 (race): of two quick Refund presses, only the last one's lookup opens its dialog", async () => {
    const OTHER = bp("pay_other", "inv_o", 70);
    await mount([CASH, OTHER]);
    let first: (v: unknown) => void = () => {};
    listInvoicePayments.mockImplementation((_biz: string, invoiceId: string) =>
      invoiceId === "inv_a" ? new Promise((resolve) => { first = resolve; }) : Promise.resolve(listedFor([OTHER], 70)),
    );

    pressRefund("pay_cash");
    pressRefund("pay_other");
    await confirmFor(70);
    first(listedFor([CASH], 120));
    await new Promise((r) => setTimeout(r, 50));
    expect(within(dialog()!).queryByRole("button", { name: `Refund ${USD(120)}` }), "the stale lookup is ignored").toBeNull();
    expect(within(dialog()!).getByRole("button", { name: `Refund ${USD(70)}` })).toBeInTheDocument();
  });

  /** Makes the next read of an invoice's payments wait until the returned function is called with its answer. */
  function holdNextRead(): (answer: unknown) => void {
    let release: (v: unknown) => void = () => {};
    listInvoicePayments.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    return (answer) => release(answer);
  }

  it("GUARD-R2 (N2): while the read is in flight the confirm is disabled, and pressing it sends nothing", async () => {
    await mount([CASH]);
    const release = holdNextRead();
    pressRefund("pay_cash");
    const confirm = await waitFor(() => within(dialog()!).getByRole("button", { name: /^refund/i }));
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(refundPayment).not.toHaveBeenCalled();
    release(listedFor([CASH], 120));
    await confirmFor(120);
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it("GUARD-R2 (N4): a read that lands after Cancel does not reopen the dialog", async () => {
    await mount([CASH]);
    const release = holdNextRead();
    pressRefund("pay_cash");
    await waitFor(() => expect(dialog()).not.toBeNull());
    fireEvent.click(within(dialog()!).getByRole("button", { name: /^cancel$/i }));
    expect(dialog()).toBeNull();
    release(listedFor([CASH], 120));
    await new Promise((r) => setTimeout(r, 50));
    expect(dialog(), "cancelled stays cancelled").toBeNull();
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it("GUARD-R2 (N5): a failed read closes the dialog, shows the error and posts nothing", async () => {
    await mount([CASH]);
    listInvoicePayments.mockResolvedValueOnce({ data: null, error: "Payments could not be read: connection reset" });
    pressRefund("pay_cash");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Payments could not be read: connection reset"));
    expect(dialog()).toBeNull();
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it("CONTROL (D-100): when the payments cannot be read (no revenue read), no amount is shown", async () => {
    fetchBusinessPayments.mockResolvedValue({ data: null, error: "Insufficient permissions: revenue requires read access (you have none)", status: 403 });
    render(<PaymentsPage />);
    await waitFor(() => expect(screen.queryByText(/loading payments/i)).toBeNull());
    expect(document.querySelector("[data-testid='recorded-payment-row']")).toBeNull();
    expect(document.body.textContent).not.toContain(USD(120));
  });
});
