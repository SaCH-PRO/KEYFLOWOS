/**
 * V1-41b-PENDING-PAYMENT-CONFIRM-ROUTE (V1-41 review CR-V41-3; owner ruling
 * D-27): the standalone Record Payment sheet (scan evidence, match an invoice,
 * record) says what the server did.
 *
 * Since V1-41 POST .../invoices/:id/payments/from-evidence records the
 * AI-extracted payment PENDING ({ payment.status: 'PENDING',
 * requiresConfirmation: true }): nothing is posted and the invoice balance does
 * not move until a member with revenue write access confirms it on the
 * invoice's Payments tab. The sheet still toasted "Payment of X recorded" and
 * showed "Payment Recorded", so the operator was told money was recorded while
 * the invoice stayed unpaid.
 *
 * The sheet is mounted as the commerce page mounts it; its data doors
 * (@/lib/client), the upload hooks and the toast are stubbed with
 * server-shaped answers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const extractPaymentEvidence = vi.fn();
const recordPaymentFromEvidence = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/lib/client", () => ({
  extractPaymentEvidence: (...args: unknown[]) => extractPaymentEvidence(...args),
  recordPaymentFromEvidence: (...args: unknown[]) => recordPaymentFromEvidence(...args),
}));
vi.mock("@/hooks/use-upload", () => ({
  useUpload: () => ({
    uploadFile: async () => ({ uploadURL: "https://uploads.test/v41b-receipt.pdf" }),
    isUploading: false,
    progress: 0,
  }),
}));
vi.mock("@/hooks/use-drive-upload", () => ({ useDriveUpload: () => ({ uploadToDrive: async () => false }) }));

import { toast } from "sonner";
import { StandalonePaymentRecorder } from "../standalone-payment-recorder";
import { formatCurrency } from "@/lib/currency";

const BIZ = "biz_v41b";
const INV = "inv_v41b";

function evidenceAnswer(status: "PENDING" | "SUCCESSFUL") {
  return {
    data: {
      payment: {
        id: "pay_v41b", amount: 45, currency: "TTD", status, provider: status === "PENDING" ? "extracted" : "BANK_TRANSFER",
        providerPaymentId: "extracted_inv_v41b_x", createdAt: "2026-11-03T10:00:00.000Z", businessId: BIZ, invoiceId: INV,
      },
      invoiceStatus: status === "PENDING" ? "SENT" : "PARTIALLY_PAID",
      extracted: { amount: 45, method: "BANK_TRANSFER", confidence: 0.9 },
      ...(status === "PENDING" ? { requiresConfirmation: true } : {}),
    },
    error: null,
  };
}

async function recordThroughTheSheet() {
  const onRecorded = vi.fn();
  render(<StandalonePaymentRecorder businessId={BIZ} open onClose={vi.fn()} onRecorded={onRecorded} />);
  const file = new File(["%PDF-1.4 v41b"], "v41b-receipt.pdf", { type: "application/pdf" });
  if (typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function") {
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(8) });
  }
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.click(await screen.findByRole("button", { name: /Scan & Find Invoice/ }));
  await waitFor(() => expect(extractPaymentEvidence).toHaveBeenCalledTimes(1));
  const record = await screen.findByRole("button", { name: /^Record Payment$/ }, { timeout: 3000 });
  fireEvent.click(record);
  await waitFor(() => expect(recordPaymentFromEvidence).toHaveBeenCalledTimes(1));
  return { onRecorded };
}

function toastTexts(fn: unknown): string[] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  extractPaymentEvidence.mockReset();
  recordPaymentFromEvidence.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.info).mockReset();
  vi.mocked(toast.error).mockReset();
  extractPaymentEvidence.mockResolvedValue({
    data: {
      extracted: { amount: 45, method: "BANK_TRANSFER", confidence: 0.9 },
      candidates: [
        { id: INV, invoiceNumber: "INV-V41B", total: 100, remaining: 100, currency: "TTD", status: "SENT", contactName: "Vfa Customer", dueDate: null },
      ],
      raw: {},
    },
    error: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("V1-41b: the standalone recorder says a PENDING extracted payment awaits confirmation (D-27, CR-V41-3)", () => {
  it("a response with status PENDING and requiresConfirmation:true is announced as pending confirmation, never as recorded", async () => {
    recordPaymentFromEvidence.mockResolvedValue(evidenceAnswer("PENDING"));
    const { onRecorded } = await recordThroughTheSheet();

    expect(recordPaymentFromEvidence).toHaveBeenCalledWith(BIZ, INV, expect.objectContaining({ filename: "v41b-receipt.pdf", source: "upload" }));
    // RED-BEFORE: toast.success("Payment of TTD 45.00 recorded") and a "Payment Recorded" panel.
    await screen.findByText("Payment Pending Confirmation", undefined, { timeout: 3000 });
    expect(screen.queryByText("Payment Recorded")).toBeNull();
    expect(screen.queryByText(/was recorded against the invoice/)).toBeNull();
    expect(screen.getByText(/confirm it on the invoice's Payments tab/i)).toBeInTheDocument();
    expect(toastTexts(toast.success).filter((t) => /recorded/i.test(t))).toEqual([]);
    expect(toastTexts(toast.info)).toEqual([`Payment of ${formatCurrency(45, "TTD")} is pending confirmation`]);
    expect(onRecorded).toHaveBeenCalledTimes(1);
  });

  it("control: a SUCCESSFUL response (money recorded) is still announced as recorded", async () => {
    recordPaymentFromEvidence.mockResolvedValue(evidenceAnswer("SUCCESSFUL"));
    await recordThroughTheSheet();

    await screen.findByText("Payment Recorded", undefined, { timeout: 3000 });
    expect(screen.queryByText("Payment Pending Confirmation")).toBeNull();
    expect(toastTexts(toast.success)).toContain(`Payment of ${formatCurrency(45, "TTD")} recorded`);
    expect(toastTexts(toast.info)).toEqual([]);
  });
});
