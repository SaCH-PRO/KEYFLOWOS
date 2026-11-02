/**
 * V1-29b-REFUND-READERS (review V36-CR-1): the nav "Invoices" hub
 * (/app/commerce/invoices, invoices/page.tsx) reads each invoice's balance
 * through the shared contract (@keyflow/shared invoiceBalanceOfStoredRows, the
 * mirror of the server's balanceOfStoredRows).
 *
 * The hub summed each row's SUCCESSFUL payments: 60 + 40 paid with the 40
 * refunded (a separate -40 REFUNDED row, D-14) read "100% paid" and nothing
 * unpaid, and a fully refunded invoice (back to SENT) read nothing owed on the
 * Unpaid / Overdue cards. V1-36 moved three files no route renders
 * (invoice-list.tsx, invoice-stat-cards.tsx, invoices-panel.tsx); this is the
 * screen the nav opens.
 *
 * The page is mounted as the route renders it; only its data doors
 * (@/lib/client, @/lib/api), the workspace id, the router and the composer
 * context are stubbed. The balance is the real shared contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { Invoice, PaymentRecord } from "@/lib/client";

const fetchInvoices = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/commerce/invoices",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/workspace", () => ({ refreshWorkspace: async () => "biz_v29b", getStoredBusinessId: () => "biz_v29b" }));
vi.mock("@/lib/api", () => ({ apiDelete: vi.fn(async () => ({ data: null, error: null })) }));
vi.mock("@/lib/client", () => ({
  fetchInvoices: (...args: unknown[]) => fetchInvoices(...args),
  fetchContacts: async () => ({ data: { contacts: [] }, error: null }),
  fetchProducts: async () => ({ data: [], error: null }),
  getGmailStatus: async () => ({ data: { connected: false, email: null }, error: null }),
  updateInvoiceStatus: vi.fn(),
  markInvoicePaid: vi.fn(),
  resendInvoiceReceipt: vi.fn(),
  createInvoicePaymentLink: vi.fn(),
}));

import InvoicesHubPage from "../page";
import { formatAmount } from "../../utils/commerce-utils";

let seq = 0;
function row(invoiceId: string, amount: number, status: string): PaymentRecord {
  seq += 1;
  return {
    id: `pay_${seq}`, amount, status, currency: "TTD", provider: "manual", providerPaymentId: `pp_${seq}`,
    createdAt: "2026-11-01T10:00:00.000Z", businessId: "biz_v29b", invoiceId,
  };
}

function invoice(id: string, status: string, total: number, payments: Array<[number, string]>): Invoice {
  return {
    id, invoiceNumber: id.toUpperCase(), status, total, currency: "TTD",
    issueDate: new Date().toISOString(), dueDate: null, contactId: null,
    contact: { firstName: "V29b", lastName: id, email: null }, items: [],
    payments: payments.map(([amount, s]) => row(id, amount, s)),
  };
}

/** The value and count on one stat card. */
function card(label: string): { value: string; count: string } {
  const button = screen
    .getAllByText(label)
    .map((el) => el.closest("button"))
    .find((b) => b?.querySelector("p.text-2xl")) as HTMLElement;
  const [value, count] = Array.from(button.querySelectorAll("p")).map((p) => p.textContent ?? "");
  return { value, count };
}

/** The "% paid" line of one invoice row (only part-paid rows carry one). */
function paidLine(invoiceNumber: string): string | null {
  const tr = screen.getByText(invoiceNumber).closest("tr") as HTMLElement;
  return Array.from(tr.querySelectorAll("span")).map((s) => s.textContent ?? "").find((t) => /% paid$/.test(t)) ?? null;
}

async function mount(invoices: Invoice[]) {
  fetchInvoices.mockResolvedValue({ data: invoices, error: null });
  render(<InvoicesHubPage />);
  await waitFor(() => expect(screen.getAllByText("Unpaid").length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.getByText(invoices[0].invoiceNumber as string)).toBeInTheDocument());
}

beforeEach(() => {
  fetchInvoices.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("V1-29b-REFUND-READERS: the Invoices hub reads the shared balance contract", () => {
  it("60 + 40 paid with the 40 refunded on a 100 invoice reads 60% paid and 40 unpaid, not 100% paid and nothing owed", async () => {
    await mount([invoice("inv-cf17", "PARTIALLY_PAID", 100, [[60, "SUCCESSFUL"], [40, "SUCCESSFUL"], [-40, "REFUNDED"]])]);
    // RED-BEFORE (int/trial-I 7f4b81a2): "100% paid" and Unpaid TTD 0.00 (the SUCCESSFUL rows alone).
    expect(paidLine("INV-CF17")).toBe("60% paid");
    expect(card("Unpaid")).toEqual({ value: formatAmount(40, "TTD"), count: "1 invoice" });
  });

  it("a fully refunded invoice (SENT, net 0) and a fully refunded OVERDUE one count their whole total as owed", async () => {
    await mount([
      invoice("inv-full", "SENT", 100, [[100, "SUCCESSFUL"], [-100, "REFUNDED"]]),
      invoice("inv-late", "OVERDUE", 50, [[50, "SUCCESSFUL"], [-50, "REFUNDED"]]),
    ]);
    // RED-BEFORE: Unpaid TTD 0.00 and Overdue TTD 0.00.
    expect(card("Unpaid")).toEqual({ value: formatAmount(100, "TTD"), count: "1 invoice" });
    expect(card("Overdue")).toEqual({ value: formatAmount(50, "TTD"), count: "1 invoice" });
  });

  it("the cards add every invoice's contract remaining: CF-17 40 + fully refunded 100 + a pre-V1-29 flipped 60 read as the base read it (100) + 10.10 + 20.20 + 30.30 paid (39.40) = 279.40; PENDING and FAILED rows are not paid", async () => {
    await mount([
      invoice("inv-cf17", "PARTIALLY_PAID", 100, [[60, "SUCCESSFUL"], [40, "SUCCESSFUL"], [-40, "REFUNDED"]]),
      invoice("inv-full", "SENT", 100, [[100, "SUCCESSFUL"], [-100, "REFUNDED"]]),
      invoice("inv-legacy", "SENT", 100, [[60, "REFUNDED"]]),
      invoice("inv-cents", "PARTIALLY_PAID", 100, [[10.1, "SUCCESSFUL"], [20.2, "SUCCESSFUL"], [30.3, "SUCCESSFUL"], [25, "PENDING"], [5, "FAILED"]]),
    ]);
    // RED-BEFORE: TTD 139.40 (0 + 0 + 100 + 39.40).
    expect(card("Unpaid")).toEqual({ value: formatAmount(279.4, "TTD"), count: "4 invoices" });
    expect(paidLine("INV-CF17")).toBe("60% paid");
    expect(paidLine("INV-CENTS")).toBe("61% paid");
  });
});
