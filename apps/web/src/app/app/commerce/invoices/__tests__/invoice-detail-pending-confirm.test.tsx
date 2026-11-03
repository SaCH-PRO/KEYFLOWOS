/**
 * V1-41b-PENDING-PAYMENT-CONFIRM-ROUTE (V1-41 review CR-V41-3, CR-V41-4; owner
 * ruling D-27): the invoice detail page's Payments tab
 * (/app/commerce/invoices/[id]) is where a member confirms a payment an
 * untrusted input (evidence scan, Drive intake) recorded PENDING.
 *
 *   - A PENDING extracted row (provider 'extracted') carries a Confirm action;
 *     a PENDING customer pay-link intent and a SUCCESSFUL row do not.
 *   - Confirm calls POST .../invoices/:id/payments/:paymentId/confirm with the
 *     amount the member was shown, takes the server's figures from the answer,
 *     re-reads the payments and shows the confirmed money once: a CONFIRMED
 *     pending row beside its SUCCESSFUL payment is not a second money row.
 *   - A member without revenue write access is told so (403) and the action is
 *     withdrawn; nothing is shown as confirmed.
 *
 * Before V1-41b the tab had no Confirm action (no route existed), and listed a
 * CONFIRMED row as a second amber money row.
 *
 * The page is mounted as the route renders it; its data doors (@/lib/client,
 * @/lib/api), the workspace id, the router and the composer context are
 * stubbed with server-shaped answers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { Invoice, PaymentRecord } from "@/lib/client";

const getInvoice = vi.fn();
const listInvoicePayments = vi.fn();
const confirmPendingInvoicePayment = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ id: "inv_v41b" }),
  usePathname: () => "/app/commerce/invoices/inv_v41b",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/workspace", () => ({ refreshWorkspace: async () => "biz_v41b", getStoredBusinessId: () => "biz_v41b" }));
vi.mock("@/lib/api", () => ({ apiDelete: vi.fn(async () => ({ data: null, error: null })) }));
vi.mock("@/lib/client", () => ({
  getInvoice: (...args: unknown[]) => getInvoice(...args),
  getInvoiceTimeline: async () => ({ data: { entries: [] }, error: null }),
  listInvoicePayments: (...args: unknown[]) => listInvoicePayments(...args),
  confirmPendingInvoicePayment: (...args: unknown[]) => confirmPendingInvoicePayment(...args),
  updateInvoiceStatus: vi.fn(),
  markInvoicePaid: vi.fn(),
  resendInvoiceReceipt: vi.fn(),
  createInvoicePaymentLink: vi.fn(),
  recordInvoicePayment: vi.fn(),
}));

import { toast } from "sonner";
import InvoiceDetailPage from "../[id]/page";
import { formatAmount } from "../../utils/commerce-utils";

const BIZ = "biz_v41b";
const INV = "inv_v41b";

function pay(id: string, amount: number, status: string, provider: string, providerPaymentId: string): PaymentRecord {
  return { id, amount, status, currency: "TTD", provider, providerPaymentId, createdAt: "2026-11-03T10:00:00.000Z", businessId: BIZ, invoiceId: INV };
}

const PENDING_EXTRACTED = pay("pay_pending", 45, "PENDING", "extracted", `extracted_${INV}_aa`);
const PENDING_INTENT = pay("pay_intent", 5, "PENDING", "cash", `manual_${INV}_intent_bb`);
const MANUAL = pay("pay_manual", 20, "SUCCESSFUL", "cash", `manual_${INV}_ref_cc`);
const CONFIRMED_ROW = { ...PENDING_EXTRACTED, status: "CONFIRMED" };
const RECORDED = pay("pay_recorded", 45, "SUCCESSFUL", "BANK_TRANSFER", `manual_${INV}_key_dd`);

function invoice(status: string, payments: PaymentRecord[], figures: { paidAmount: number; remaining: number }): Invoice {
  return {
    id: INV, invoiceNumber: "INV-V41B", status, total: 100, subtotal: 100, currency: "TTD",
    issueDate: new Date().toISOString(), dueDate: null, contactId: null, contact: null, items: [], payments, ...figures,
  };
}

function paymentRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-testid='invoice-payment-row']"));
}

function rowOf(id: string): HTMLElement {
  const row = paymentRows().find((r) => r.dataset.paymentId === id);
  if (!row) throw new Error(`no payment row ${id}`);
  return row;
}

/** The Payment Summary card's Paid and Remaining figures. */
function summary(): { paid: string; remaining: string } {
  const box = screen.getByText("Payment Summary").parentElement as HTMLElement;
  const value = (label: string) => {
    const line = Array.from(box.querySelectorAll("div")).find((d) => d.firstElementChild?.textContent === label);
    return line?.lastElementChild?.textContent ?? "";
  };
  return { paid: value("Paid"), remaining: value("Remaining") };
}

async function openPaymentsTab() {
  render(<InvoiceDetailPage />);
  await waitFor(() => expect(screen.getByText("Payment Summary")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /^Payments/ }));
  await screen.findByText(formatAmount(45, "TTD"));
}

beforeEach(() => {
  getInvoice.mockReset();
  listInvoicePayments.mockReset();
  confirmPendingInvoicePayment.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  getInvoice.mockResolvedValue({
    data: invoice("PARTIALLY_PAID", [MANUAL, PENDING_EXTRACTED, PENDING_INTENT], { paidAmount: 20, remaining: 80 }),
    error: null,
  });
  listInvoicePayments.mockResolvedValueOnce({
    data: { payments: [PENDING_EXTRACTED, PENDING_INTENT, MANUAL], paidAmount: 20, remaining: 80, invoiceTotal: 100 },
    error: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("V1-41b: the invoice Payments tab confirms a PENDING extracted payment (D-27, CR-V41-3, CR-V41-4)", () => {
  it("only the PENDING extracted row carries a Confirm action and reads as awaiting confirmation; the pay-link intent and the recorded payment carry none", async () => {
    await openPaymentsTab();

    // RED-BEFORE: no Confirm action anywhere (no route to call).
    expect(screen.getAllByRole("button", { name: /^Confirm/ })).toHaveLength(1);
    expect(within(rowOf("pay_pending")).getByRole("button", { name: /^Confirm/ })).toBeInTheDocument();
    expect(within(rowOf("pay_pending")).getByText(/Awaiting confirmation/i)).toBeInTheDocument();
    expect(within(rowOf("pay_intent")).queryByRole("button", { name: /^Confirm/ })).toBeNull();
    expect(within(rowOf("pay_manual")).queryByRole("button", { name: /^Confirm/ })).toBeNull();
  });

  it("Confirm calls the route with the amount shown, refreshes, and shows the confirmed money once (a CONFIRMED pending row served beside it is not a second money row)", async () => {
    confirmPendingInvoicePayment.mockResolvedValue({
      data: {
        payment: RECORDED,
        invoice: invoice("PARTIALLY_PAID", [MANUAL, CONFIRMED_ROW, PENDING_INTENT, RECORDED], { paidAmount: 65, remaining: 35 }),
        paidAmount: 65,
        remaining: 35,
        confirmedPaymentId: PENDING_EXTRACTED.id,
      },
      error: null,
    });
    listInvoicePayments.mockResolvedValueOnce({
      data: { payments: [RECORDED, CONFIRMED_ROW, PENDING_INTENT, MANUAL], paidAmount: 65, remaining: 35, invoiceTotal: 100 },
      error: null,
    });
    await openPaymentsTab();

    fireEvent.click(within(rowOf("pay_pending")).getByRole("button", { name: /^Confirm/ }));

    await waitFor(() => expect(confirmPendingInvoicePayment).toHaveBeenCalledWith(BIZ, INV, "pay_pending", { amount: 45 }));
    await waitFor(() => expect(listInvoicePayments).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(paymentRows().map((r) => r.dataset.paymentId)).toEqual(["pay_recorded", "pay_intent", "pay_manual"]));
    const fortyFive = paymentRows().filter((r) => r.textContent?.includes(formatAmount(45, "TTD")));
    expect(fortyFive).toHaveLength(1);
    expect(screen.queryAllByRole("button", { name: /^Confirm/ })).toHaveLength(0);
    expect(summary()).toEqual({ paid: formatAmount(65, "TTD"), remaining: formatAmount(35, "TTD") });
    expect(vi.mocked(toast.success).mock.calls.map((c) => String(c[0]))).toEqual([`Payment of ${formatAmount(45, "TTD")} confirmed`]);
  });

  it("a member without revenue write access (403) is told so; the action is withdrawn and nothing reads as confirmed", async () => {
    confirmPendingInvoicePayment.mockResolvedValue({
      data: null,
      error: "Insufficient permissions: revenue requires write access (you have read)",
      status: 403,
    });
    await openPaymentsTab();

    fireEvent.click(within(rowOf("pay_pending")).getByRole("button", { name: /^Confirm/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(String(vi.mocked(toast.error).mock.calls[0]?.[0])).toMatch(/revenue write access/);
    await waitFor(() => expect(screen.queryAllByRole("button", { name: /^Confirm/ })).toHaveLength(0));
    expect(within(rowOf("pay_pending")).getByText(/Awaiting confirmation/i)).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    expect(summary()).toEqual({ paid: formatAmount(20, "TTD"), remaining: formatAmount(80, "TTD") });
  });
});
