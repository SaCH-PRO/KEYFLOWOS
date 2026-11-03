/**
 * V1-41b-PENDING-PAYMENT-CONFIRM-ROUTE (V1-41 review CR-V41-3; owner ruling
 * D-27): the finance pipeline's Record Payment modal, evidence import ("Scan &
 * Record Payment"), says what the server did.
 *
 * Since V1-41 the from-evidence route records the AI-extracted payment PENDING
 * ({ payment.status: 'PENDING', requiresConfirmation: true }); the invoice
 * balance does not move until a member with revenue write access confirms it
 * on the invoice's Payments tab. The modal still toasted "Payment recorded from
 * <file>".
 *
 * The modal is mounted with its data doors (@/lib/client), the upload hook and
 * the toast stubbed with server-shaped answers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Invoice } from "@/lib/client";

const getInvoice = vi.fn();
const recordPaymentFromEvidence = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/lib/client", () => ({
  getInvoice: (...args: unknown[]) => getInvoice(...args),
  recordPaymentFromEvidence: (...args: unknown[]) => recordPaymentFromEvidence(...args),
}));
vi.mock("@/hooks/use-upload", () => ({
  useUpload: () => ({
    uploadFile: async () => ({ uploadURL: "https://uploads.test/v41b-slip.pdf" }),
    isUploading: false,
    progress: 0,
  }),
}));

import { toast } from "sonner";
import { PaymentRecordModal } from "../payment-record-modal";
import { formatCurrency } from "@/lib/currency";

const BIZ = "biz_v41b_modal";
const INV = "inv_v41b_modal";

const invoice: Invoice = { id: INV, invoiceNumber: "INV-V41B-M", status: "SENT", total: 100, currency: "TTD", payments: [] };

function evidenceAnswer(status: "PENDING" | "SUCCESSFUL") {
  return {
    data: {
      payment: {
        id: "pay_v41b_m", amount: 30, currency: "TTD", status, provider: status === "PENDING" ? "extracted" : "CASH",
        providerPaymentId: "extracted_inv_v41b_modal_x", createdAt: "2026-11-03T10:00:00.000Z", businessId: BIZ, invoiceId: INV,
      },
      invoiceStatus: status === "PENDING" ? "SENT" : "PARTIALLY_PAID",
      extracted: { amount: 30, method: "CASH", confidence: 0.9 },
      ...(status === "PENDING" ? { requiresConfirmation: true } : {}),
    },
    error: null,
  };
}

async function scanThroughTheModal() {
  const onClose = vi.fn();
  render(<PaymentRecordModal invoice={invoice} businessId={BIZ} onClose={onClose} onSubmit={vi.fn()} />);
  await screen.findByText("Import Evidence");
  const file = new File(["%PDF-1.4 v41b"], "v41b-slip.pdf", { type: "application/pdf" });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.click(await screen.findByRole("button", { name: /Scan & Record Payment/ }));
  await waitFor(() => expect(recordPaymentFromEvidence).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  return { onClose };
}

function toastTexts(fn: unknown): string[] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  getInvoice.mockReset();
  recordPaymentFromEvidence.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.info).mockReset();
  vi.mocked(toast.error).mockReset();
  getInvoice.mockResolvedValue({ data: { ...invoice, paidAmount: 0, remaining: 100 }, error: null });
});

afterEach(() => {
  cleanup();
});

describe("V1-41b: the evidence import of the Record Payment modal says a PENDING payment awaits confirmation (D-27, CR-V41-3)", () => {
  it("a response with status PENDING and requiresConfirmation:true is announced as pending confirmation, never as recorded", async () => {
    recordPaymentFromEvidence.mockResolvedValue(evidenceAnswer("PENDING"));
    await scanThroughTheModal();

    expect(recordPaymentFromEvidence).toHaveBeenCalledWith(BIZ, INV, expect.objectContaining({ filename: "v41b-slip.pdf", source: "upload" }));
    // RED-BEFORE: toast.success("Payment recorded from v41b-slip.pdf").
    expect(toastTexts(toast.success)).toEqual([]);
    expect(toastTexts(toast.info)).toEqual([
      `Payment of ${formatCurrency(30, "TTD")} from v41b-slip.pdf is pending confirmation`,
    ]);
    const options = vi.mocked(toast.info).mock.calls[0]?.[1] as { description?: string } | undefined;
    expect(options?.description).toMatch(/Payments tab/);
  });

  it("control: a SUCCESSFUL response is still announced as recorded", async () => {
    recordPaymentFromEvidence.mockResolvedValue(evidenceAnswer("SUCCESSFUL"));
    await scanThroughTheModal();

    expect(toastTexts(toast.success)).toEqual(["Payment recorded from v41b-slip.pdf"]);
    expect(toastTexts(toast.info)).toEqual([]);
  });
});
