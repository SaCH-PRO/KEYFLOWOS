/**
 * W11-PROVIDER-OUTAGE-503 (R-5 part 1): what the invoice detail page
 * (/app/commerce/invoices/[id]) says when "Email invoice" meets a Gmail that
 * did not answer.
 *
 * The server now answers a Gmail outage on POST .../invoices/:id/send-email
 * 503 { code: 'provider_unavailable', message: 'Failed to send email',
 * details: { service: 'gmail', upstreamStatus } } (it was a 400 before, which
 * the page showed as a plain failure toast). The page already reads that
 * shape through providerUnavailableOf (W9-WEB-COMMERCE-NAV, R0-07): it says
 * "Email is unavailable right now" where the owner is looking, with the
 * server's message, and leaves the invoice as it was. Characterization, green
 * at int/v1-base 15ca8599: the screen needs no change for this packet; the
 * case pins that it reads the server's new answer.
 *
 * The page is mounted as the route renders it; its data doors (@/lib/client),
 * the workspace id, the router and the composer context are stubbed with
 * server-shaped answers. providerUnavailableOf is the real one (@/lib/api).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Invoice } from "@/lib/client";

const getInvoice = vi.fn();
const sendInvoiceEmail = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ id: "inv_pof" }),
  usePathname: () => "/app/commerce/invoices/inv_pof",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/workspace", () => ({
  refreshWorkspace: async () => "biz_pof",
  getStoredBusinessId: () => "biz_pof",
  refreshAccessToken: async () => false,
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiDelete: vi.fn(async () => ({ data: null, error: null })),
}));
vi.mock("@/lib/client", () => ({
  getInvoice: (...args: unknown[]) => getInvoice(...args),
  getInvoiceTimeline: async () => ({ data: { entries: [] }, error: null }),
  listInvoicePayments: async () => ({ data: { payments: [] }, error: null }),
  sendInvoiceEmail: (...args: unknown[]) => sendInvoiceEmail(...args),
  updateInvoiceStatus: vi.fn(),
  markInvoicePaid: vi.fn(),
  resendInvoiceReceipt: vi.fn(),
  createInvoicePaymentLink: vi.fn(),
  recordInvoicePayment: vi.fn(),
}));

import { toast } from "sonner";
import InvoiceDetailPage from "../[id]/page";

const DRAFT: Invoice = {
  id: "inv_pof", invoiceNumber: "INV-POF", status: "DRAFT", total: 100, subtotal: 100, currency: "TTD",
  issueDate: new Date().toISOString(), dueDate: null, contactId: null, contact: null, items: [], payments: [],
  paidAmount: 0, remaining: 100,
};

/** The api.ts result of a structured 503 from the server's production filter. */
function unavailable(code: "provider_unavailable" | "provider_not_configured", message: string) {
  return {
    data: null,
    error: message,
    status: 503,
    rawError: { statusCode: 503, code, message, details: { service: "gmail", ...(code === "provider_unavailable" ? { upstreamStatus: 500 } : {}) } },
  };
}

async function clickEmailInvoice() {
  render(<InvoiceDetailPage />);
  const button = await screen.findByRole("button", { name: /Email invoice/ });
  fireEvent.click(button);
  await waitFor(() => expect(sendInvoiceEmail).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  getInvoice.mockReset();
  sendInvoiceEmail.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  getInvoice.mockResolvedValue({ data: DRAFT, error: null });
});

afterEach(() => {
  cleanup();
});

describe("W11-PROVIDER-OUTAGE-503: the invoice page says email is unavailable when Gmail does not answer", () => {
  it("a 503 provider_unavailable from send-email shows 'Email is unavailable right now' with the server's message, and the invoice stays DRAFT", async () => {
    sendInvoiceEmail.mockResolvedValue(unavailable("provider_unavailable", "Failed to send email"));

    await clickEmailInvoice();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Email is unavailable right now: Failed to send email. The invoice was not emailed.");
    expect(sendInvoiceEmail).toHaveBeenCalledWith("biz_pof", "inv_pof", {});
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    // Still a DRAFT: no SENT marker replaced it, and the Email action is still offered.
    expect(screen.getByRole("button", { name: /Email invoice/ })).toBeInTheDocument();
    expect(screen.queryByText("Invoice emailed")).toBeNull();
  });

  it("control: a 503 provider_not_configured still says 'Email is not configured'", async () => {
    sendInvoiceEmail.mockResolvedValue(unavailable("provider_not_configured", "Gmail not connected"));

    await clickEmailInvoice();

    expect(await screen.findByRole("alert")).toHaveTextContent("Email is not configured: Gmail not connected. The invoice was not emailed.");
  });

  it("control: Gmail refusing the message (400 'Failed to send email') is a failure toast, not the unavailable notice", async () => {
    sendInvoiceEmail.mockResolvedValue({ data: null, error: "Failed to send email", status: 400, rawError: { statusCode: 400, code: "BAD_REQUEST", message: "Failed to send email" } });

    await clickEmailInvoice();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to send email"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
