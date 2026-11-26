/**
 * FU-CONTACT-PAGES-RAW-STATUS (CDC-4): the contact's Quotes & Invoices tab printed stored statuses as they are
 * ("PARTIALLY_PAID", "EXPIRED"). They read in plain words from lib/status-labels.ts; an invoice's in the invoice
 * domain, so PARTIAL is "Part-paid".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const apiGet = vi.fn();
vi.mock("next/navigation", () => ({ useParams: () => ({ contactId: "c_1" }) }));
vi.mock("@/lib/workspace", () => ({ getStoredBusinessId: () => "biz_1" }));
vi.mock("@/lib/api", () => ({ apiGet: (...a: unknown[]) => apiGet(...a) }));

import ContactQuotesInvoicesPage from "../quotes-invoices/page";

function seed() {
  apiGet.mockImplementation(async (path: string) => {
    if (path.includes("/invoices")) {
      return {
        data: {
          data: [
            { id: "inv_1aaaaaaa", invoiceNumber: "INV-1", status: "PARTIALLY_PAID", total: 200, currency: "TTD" },
            { id: "inv_2aaaaaaa", invoiceNumber: "INV-2", status: "PARTIAL", total: 300, currency: "TTD" },
            { id: "inv_3aaaaaaa", invoiceNumber: "INV-3", status: "OVERDUE", total: 50, currency: "TTD" },
          ],
        },
      };
    }
    return {
      data: {
        data: [
          { id: "quo_1aaaaaaa", quoteNumber: "Q-1", status: "EXPIRED", total: 90, currency: "TTD" },
          { id: "quo_2aaaaaaa", quoteNumber: "Q-2", status: "SENT", total: 90, currency: "TTD" },
        ],
      },
    };
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("contact Quotes & Invoices tab: statuses in plain words", () => {
  it("invoices: PARTIALLY_PAID and PARTIAL read 'Part-paid', OVERDUE 'Overdue', never the code", async () => {
    seed();
    render(<ContactQuotesInvoicesPage />);
    expect(await screen.findByText("INV-1")).toBeInTheDocument();
    expect(screen.getAllByText("Part-paid")).toHaveLength(2);
    expect(screen.getByText("Overdue")).toHaveClass("bg-red-100");
    expect(document.body.textContent ?? "").not.toMatch(/\b(PARTIALLY_PAID|PARTIAL|OVERDUE)\b/);
  });

  it("quotes: EXPIRED reads 'Expired' and SENT 'Sent', never the code", async () => {
    seed();
    render(<ContactQuotesInvoicesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Quotes \(2\)/ }));
    expect(await screen.findByText("Expired")).toBeInTheDocument();
    expect(screen.getByText("Sent")).toHaveClass("bg-amber-100");
    expect(document.body.textContent ?? "").not.toMatch(/\b(EXPIRED|SENT)\b/);
  });
});
