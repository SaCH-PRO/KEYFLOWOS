/**
 * FU-CONTACT-PAGES-RAW-STATUS (CDC-4): the contact's Money tab printed stored invoice and quote statuses as they
 * are ("PARTIALLY_PAID", "ACCEPTED") and each revenue event's code ("invoice.paid") in a badge beside its label.
 * Statuses read in plain words from lib/status-labels.ts (an invoice in the invoice domain, so PARTIAL is
 * "Part-paid"); an event shows its label once, and where the server had no label for it (the label is the code
 * itself) the code read by eventLabel.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const fetchContactRevenueSummary = vi.fn();
const apiGet = vi.fn();
vi.mock("next/navigation", () => ({ useParams: () => ({ contactId: "c_1" }) }));
vi.mock("@/lib/workspace", () => ({ getStoredBusinessId: () => "biz_1" }));
vi.mock("@/lib/client", () => ({ fetchContactRevenueSummary: (...a: unknown[]) => fetchContactRevenueSummary(...a) }));
vi.mock("@/lib/api", () => ({ apiGet: (...a: unknown[]) => apiGet(...a) }));

import ContactMoneyPage from "../money/page";

const now = new Date().toISOString();

function summary(actions: Array<{ type: string; label: string }>) {
  return {
    contactId: "c_1",
    currency: "TTD",
    lifetimeRevenue: 300,
    outstandingBalance: 100,
    openInvoices: 2,
    openQuotes: 1,
    lastPaymentAt: null,
    lastPaymentAmount: null,
    paymentReliability: null,
    recentRevenueActions: actions.map((a) => ({ ...a, amount: 50, currency: "TTD", occurredAt: now, entityId: null })),
  };
}

function seed(actions: Array<{ type: string; label: string }>) {
  fetchContactRevenueSummary.mockResolvedValue({ data: summary(actions) });
  apiGet.mockImplementation(async (path: string) => {
    if (path.includes("/invoices")) {
      return {
        data: {
          data: [
            { id: "inv_1aaaaaaa", invoiceNumber: "INV-1", status: "PARTIALLY_PAID", total: 200, currency: "TTD" },
            { id: "inv_2aaaaaaa", invoiceNumber: "INV-2", status: "PARTIAL", total: 300, currency: "TTD" },
            { id: "inv_3aaaaaaa", invoiceNumber: "INV-3", status: "PAID", total: 50, currency: "TTD" },
          ],
        },
      };
    }
    return { data: { data: [{ id: "quo_1aaaaaaa", quoteNumber: "Q-1", status: "ACCEPTED", total: 90, currency: "TTD" }] } };
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("contact Money tab: statuses and events in plain words", () => {
  it("a stored PARTIALLY_PAID and PARTIAL invoice read 'Part-paid', an ACCEPTED quote 'Accepted', never the code", async () => {
    seed([]);
    render(<ContactMoneyPage />);
    expect(await screen.findByText("INV-1")).toBeInTheDocument();
    expect(screen.getAllByText("Part-paid")).toHaveLength(2);
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\b(PARTIALLY_PAID|PARTIAL|PAID|ACCEPTED)\b/);
  });

  it("a revenue event shows its label, not its code: 'invoice.paid' is not on screen", async () => {
    seed([{ type: "invoice.paid", label: "Invoice paid" }]);
    render(<ContactMoneyPage />);
    expect(await screen.findByText("Invoice paid")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("invoice.paid");
  });

  it("the server's own label wins over the code read in plain words (review MIN-1)", async () => {
    // eventLabel("invoice.payment_recorded") would read "Invoice payment recorded"; the server says otherwise.
    seed([{ type: "invoice.payment_recorded", label: "Payment recorded" }]);
    render(<ContactMoneyPage />);
    expect(await screen.findByText("Payment recorded")).toBeInTheDocument();
    expect(screen.queryByText("Invoice payment recorded")).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("invoice.payment_recorded");
  });

  it("an event the server has no label for (its label is its code) reads in plain words", async () => {
    seed([{ type: "invoice.written_off", label: "invoice.written_off" }]);
    render(<ContactMoneyPage />);
    expect(await screen.findByText("Invoice written off")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("invoice.written_off");
  });

  it("control: the invoice badge colour still follows the stored status (paid is green)", async () => {
    seed([]);
    render(<ContactMoneyPage />);
    // The badge is the element after the document number, whatever it says.
    expect((await screen.findByText("INV-3")).nextElementSibling).toHaveClass("bg-green-100");
    expect(screen.getByText("Q-1").nextElementSibling).toHaveClass("bg-green-100");
  });
});
