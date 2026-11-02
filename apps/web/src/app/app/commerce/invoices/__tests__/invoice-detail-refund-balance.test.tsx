/**
 * V1-29b-REFUND-READERS (review V36-CR-1): the invoice detail page
 * (/app/commerce/invoices/[id]) shows the server's figures (the tenant detail
 * route's paidAmount / remaining) and, when a response carries none, reads the
 * served rows through the shared contract (@keyflow/shared
 * invoiceBalanceOfStoredRows), never a sum of the SUCCESSFUL rows alone.
 *
 * Before: the fallback summed SUCCESSFUL rows, so 60 + 40 paid with the 40
 * refunded (a separate -40 REFUNDED row, D-14) read Paid 100, Remaining 0, a
 * full progress bar, and recording the 40 still owed asked to confirm an
 * over-payment.
 *
 * The page is mounted as the route renders it; its data doors (@/lib/client,
 * @/lib/api), the workspace id, the router and the composer context are
 * stubbed. The balance is the real shared contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { Invoice, PaymentRecord } from "@/lib/client";

const getInvoice = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ id: "inv_v29b" }),
  usePathname: () => "/app/commerce/invoices/inv_v29b",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/workspace", () => ({ refreshWorkspace: async () => "biz_v29b", getStoredBusinessId: () => "biz_v29b" }));
vi.mock("@/lib/api", () => ({ apiDelete: vi.fn(async () => ({ data: null, error: null })) }));
vi.mock("@/lib/client", () => ({
  getInvoice: (...args: unknown[]) => getInvoice(...args),
  getInvoiceTimeline: async () => ({ data: { entries: [] }, error: null }),
  listInvoicePayments: async () => ({ data: { payments: [] }, error: null }),
  updateInvoiceStatus: vi.fn(),
  markInvoicePaid: vi.fn(),
  resendInvoiceReceipt: vi.fn(),
  createInvoicePaymentLink: vi.fn(),
  recordInvoicePayment: vi.fn(),
}));

import InvoiceDetailPage from "../[id]/page";
import { formatAmount } from "../../utils/commerce-utils";

let seq = 0;
function row(amount: number, status: string): PaymentRecord {
  seq += 1;
  return {
    id: `pay_${seq}`, amount, status, currency: "TTD", provider: "manual", providerPaymentId: `pp_${seq}`,
    createdAt: "2026-11-01T10:00:00.000Z", businessId: "biz_v29b", invoiceId: "inv_v29b",
  };
}

function invoice(status: string, payments: Array<[number, string]>, figures?: { paidAmount: number; remaining: number }): Invoice {
  return {
    id: "inv_v29b", invoiceNumber: "INV-V29B", status, total: 100, subtotal: 100, currency: "TTD",
    issueDate: new Date().toISOString(), dueDate: null, contactId: null, contact: null, items: [],
    payments: payments.map(([amount, s]) => row(amount, s)),
    ...(figures ?? {}),
  };
}

/** The Payment Summary card: Paid, Remaining and the progress bar width. */
function summary(): { paid: string; remaining: string; bar: string | null } {
  const box = screen.getByText("Payment Summary").parentElement as HTMLElement;
  const value = (label: string) => {
    const line = Array.from(box.querySelectorAll("div")).find((d) => d.firstElementChild?.textContent === label);
    return line?.lastElementChild?.textContent ?? "";
  };
  const bar = box.querySelector("div.bg-emerald-500") as HTMLElement | null;
  return { paid: value("Paid"), remaining: value("Remaining"), bar: bar ? bar.style.width : null };
}

async function mount(inv: Invoice) {
  getInvoice.mockResolvedValue({ data: inv, error: null });
  render(<InvoiceDetailPage />);
  await waitFor(() => expect(screen.getByText("Payment Summary")).toBeInTheDocument());
}

beforeEach(() => {
  getInvoice.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("V1-29b-REFUND-READERS: the invoice detail page reads the shared balance contract", () => {
  it("with no server figures, 60 + 40 paid with the 40 refunded reads Paid 60, Remaining 40, a 60% bar (not Paid 100, Remaining 0)", async () => {
    await mount(invoice("PARTIALLY_PAID", [[60, "SUCCESSFUL"], [40, "SUCCESSFUL"], [-40, "REFUNDED"]]));
    // RED-BEFORE (int/trial-I 7f4b81a2): Paid TTD 100.00, Remaining TTD 0.00, width 100%.
    expect(summary()).toEqual({ paid: formatAmount(60, "TTD"), remaining: formatAmount(40, "TTD"), bar: "60%" });
  });

  it("with no server figures, a fully refunded invoice reads Paid 0, Remaining 100; a pre-V1-29 flipped 60 reads as the base read it (Paid 0, Remaining 100)", async () => {
    await mount(invoice("SENT", [[100, "SUCCESSFUL"], [-100, "REFUNDED"]]));
    // RED-BEFORE: Paid TTD 100.00, Remaining TTD 0.00.
    expect(summary()).toEqual({ paid: formatAmount(0, "TTD"), remaining: formatAmount(100, "TTD"), bar: "0%" });
    cleanup();
    await mount(invoice("SENT", [[60, "REFUNDED"]]));
    expect(summary()).toEqual({ paid: formatAmount(0, "TTD"), remaining: formatAmount(100, "TTD"), bar: "0%" });
  });

  it("with no server figures, 10.10 + 20.20 + 30.30 paid beside PENDING and FAILED rows reads Paid 60.60, Remaining 39.40 in cents", async () => {
    await mount(invoice("PARTIALLY_PAID", [[10.1, "SUCCESSFUL"], [20.2, "SUCCESSFUL"], [30.3, "SUCCESSFUL"], [25, "PENDING"], [5, "FAILED"]]));
    expect(summary()).toMatchObject({ paid: formatAmount(60.6, "TTD"), remaining: formatAmount(39.4, "TTD") });
  });

  it("control: the server's figures (the tenant detail route) are shown as served", async () => {
    await mount(invoice("PARTIALLY_PAID", [[60, "SUCCESSFUL"], [40, "SUCCESSFUL"], [-40, "REFUNDED"]], { paidAmount: 60, remaining: 40 }));
    expect(summary()).toEqual({ paid: formatAmount(60, "TTD"), remaining: formatAmount(40, "TTD"), bar: "60%" });
  });
});
