/**
 * V1-29b-REFUND-READERS (review V36-CR-1): the finance Record Payment modal
 * (the Sales pipeline's live Record-payment form, finance-pipeline.tsx) shows
 * the server's figures from the tenant detail route and, when that read fails
 * or no workspace is selected, reads the row it was opened with through the
 * shared contract (@keyflow/shared invoiceBalanceOfStoredRows), never a sum of
 * the SUCCESSFUL rows alone.
 *
 * Before: the fallback summed SUCCESSFUL rows, so 60 + 40 paid with the 40
 * refunded (a separate -40 REFUNDED row, D-14) read already-paid 100 and
 * remaining 0, and recording the 40 still owed asked to confirm an
 * over-payment.
 *
 * The modal is mounted as the pipeline mounts it; the client's tenant detail
 * read (getInvoice) and the evidence upload hook are stubbed. The balance is
 * the real shared contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Invoice, PaymentRecord } from "@/lib/client";

const getInvoice = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: vi.fn(), isUploading: false, progress: 0 }) }));
vi.mock("@/lib/client", () => ({
  getInvoice: (...args: unknown[]) => getInvoice(...args),
  recordPaymentFromEvidence: vi.fn(),
}));

import { PaymentRecordModal } from "../payment-record-modal";
import { formatCurrency } from "@/lib/currency";

let seq = 0;
function row(amount: number, status: string): PaymentRecord {
  seq += 1;
  return {
    id: `pay_${seq}`, amount, status, currency: "TTD", provider: "manual", providerPaymentId: `pp_${seq}`,
    createdAt: "2026-11-01T10:00:00.000Z", businessId: "biz_v29b", invoiceId: "inv_v29b",
  };
}

function invoice(payments: Array<[number, string]>, status = "PARTIALLY_PAID"): Invoice {
  return { id: "inv_v29b", invoiceNumber: "INV-V29B", status, total: 100, currency: "TTD", payments: payments.map(([a, s]) => row(a, s)) };
}

/** The summary block renders each label, then its value as the next sibling. */
function summaryFigure(label: string): string {
  const labels = screen.getAllByText(label, { selector: "span" });
  const inSummary = labels.find((el) => el.nextElementSibling);
  return inSummary?.nextElementSibling?.textContent ?? "";
}

function mount(inv: Invoice, businessId: string | null) {
  const onSubmit = vi.fn();
  render(<PaymentRecordModal invoice={inv} businessId={businessId} onClose={vi.fn()} onSubmit={onSubmit} />);
  return { onSubmit };
}

const CF17: Array<[number, string]> = [[60, "SUCCESSFUL"], [40, "SUCCESSFUL"], [-40, "REFUNDED"]];

beforeEach(() => {
  getInvoice.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("V1-29b-REFUND-READERS: the Record Payment modal's fallback reads the shared balance contract", () => {
  it("the tenant detail read fails: 60 + 40 paid with the 40 refunded reads already-paid 60, remaining 40; recording the 40 still owed needs no over-payment confirm", async () => {
    getInvoice.mockResolvedValue({ data: null, error: "Network error" });
    const { onSubmit } = mount(invoice(CF17), "biz_v29b");
    await waitFor(() => expect(summaryFigure("Already paid")).not.toBe("…"));
    // RED-BEFORE (int/trial-I 7f4b81a2): already-paid 100, remaining 0.
    expect(summaryFigure("Already paid")).toBe(formatCurrency(60, "TTD"));
    expect(summaryFigure("Remaining")).toBe(formatCurrency(40, "TTD"));

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    // RED-BEFORE: "Over-payment of TTD 40.00" asked for confirmation and nothing was recorded.
    expect(screen.queryByText(/over-payment of/i)).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][1]).toMatchObject({ amount: "40" });
  });

  it("no workspace selected: a fully refunded invoice reads already-paid 0, remaining 100; a pre-V1-29 flipped 60 reads as the base read it (0 paid, 100 remaining)", async () => {
    mount(invoice([[100, "SUCCESSFUL"], [-100, "REFUNDED"]], "SENT"), null);
    // RED-BEFORE: already-paid 100, remaining 0.
    expect(summaryFigure("Already paid")).toBe(formatCurrency(0, "TTD"));
    expect(summaryFigure("Remaining")).toBe(formatCurrency(100, "TTD"));
    expect(getInvoice).not.toHaveBeenCalled();
    cleanup();

    mount(invoice([[60, "REFUNDED"]], "SENT"), null);
    expect(summaryFigure("Already paid")).toBe(formatCurrency(0, "TTD"));
    expect(summaryFigure("Remaining")).toBe(formatCurrency(100, "TTD"));
  });

  it("control: the server's figures from the tenant detail route are shown as served", async () => {
    getInvoice.mockResolvedValue({ data: { ...invoice(CF17), paidAmount: 60, remaining: 40 }, error: null });
    mount(invoice(CF17), "biz_v29b");
    await waitFor(() => expect(summaryFigure("Already paid")).toBe(formatCurrency(60, "TTD")));
    expect(summaryFigure("Remaining")).toBe(formatCurrency(40, "TTD"));
  });
});
