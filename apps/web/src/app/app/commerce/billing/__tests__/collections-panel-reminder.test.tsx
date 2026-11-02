/**
 * V1-42c-INVOICE-STATUS-EVENTS (VR-01): the Collections panel's "Send
 * Reminder" button reminds, and says "Reminder sent" only when the server says
 * a reminder went out.
 *
 * Before: handleSendReminder called updateInvoiceStatus(id, "SENT") on the
 * panel's past-due rows. Since V1-42 the status route answers a SENT invoice
 * idempotently (200, no invoice.sent, no timeline entry), so nobody was
 * reminded while the panel toasted "Reminder sent"; on an OVERDUE row the same
 * call was a 409 (OVERDUE -> SENT is not a transition).
 *
 * After: the button calls the existing reminder door (sendInvoiceReminder,
 * POST /commerce/businesses/:b/invoices/:id/send-reminder) and reads its
 * answer: delivered -> "Reminder sent"; not delivered (no customer email) ->
 * a warning that no email went out; an error -> the error. The row's status
 * is not touched (a reminder changes nothing on the invoice). The server half
 * is apps/server/test/invoice-status-events.integration.test.ts (VR-01a..e).
 *
 * The panel is mounted as billing-panel.tsx mounts it; only its data door
 * (@/lib/client) and the toast are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Invoice } from "@/lib/client";
import { toast } from "sonner";

const sendInvoiceReminder = vi.fn();
const updateInvoiceStatus = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/lib/client", () => ({
  markInvoicePaid: vi.fn(),
  commerceAiInvoiceReminder: vi.fn(),
  updateInvoiceStatus: (...args: unknown[]) => updateInvoiceStatus(...args),
  sendInvoiceReminder: (...args: unknown[]) => sendInvoiceReminder(...args),
}));

import CollectionsPanel from "../collections-panel";

const BIZ = "biz_v42c";
const PAST_DUE = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();

function invoice(id: string, status: string): Invoice {
  return {
    id, invoiceNumber: id.toUpperCase(), status, total: 100, currency: "TTD",
    issueDate: PAST_DUE, dueDate: PAST_DUE, contactId: null,
    contact: { firstName: "V42c", lastName: id, email: null }, items: [], payments: [],
  };
}

function mount(invoices: Invoice[], businessId: string | null = BIZ) {
  const setInvoices = vi.fn();
  render(
    <CollectionsPanel
      invoices={invoices}
      quotes={[]}
      currency="TTD"
      businessId={businessId}
      contacts={[]}
      setInvoices={setInvoices}
    />,
  );
  return { setInvoices };
}

async function clickSendReminder() {
  fireEvent.click(screen.getByTitle("Send Reminder"));
}

beforeEach(() => {
  updateInvoiceStatus.mockResolvedValue({ data: { id: "x", status: "SENT" }, error: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Collections panel: Send Reminder (V1-42c VR-01)", () => {
  it("RED-BEFORE: a SENT past-due row calls the reminder door, never the status route, and says 'Reminder sent' when it delivered", async () => {
    sendInvoiceReminder.mockResolvedValue({ data: { delivered: true, channel: "email", messageId: "m1", paymentUrl: null }, error: null });
    const { setInvoices } = mount([invoice("inv_sent", "SENT")]);
    await clickSendReminder();

    await waitFor(() => expect(sendInvoiceReminder).toHaveBeenCalledTimes(1));
    expect(sendInvoiceReminder).toHaveBeenCalledWith(BIZ, "inv_sent", {});
    expect(updateInvoiceStatus).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reminder sent"));
    expect(setInvoices, "a reminder changes nothing on the invoice").not.toHaveBeenCalled();
  });

  it("RED-BEFORE: an OVERDUE row reminds through the same door (the status route refused OVERDUE -> SENT with 409) and keeps its status", async () => {
    sendInvoiceReminder.mockResolvedValue({ data: { delivered: true, channel: "email", paymentUrl: null }, error: null });
    const { setInvoices } = mount([invoice("inv_overdue", "OVERDUE")]);
    await clickSendReminder();

    await waitFor(() => expect(sendInvoiceReminder).toHaveBeenCalledWith(BIZ, "inv_overdue", {}));
    expect(updateInvoiceStatus).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reminder sent"));
    expect(setInvoices).not.toHaveBeenCalled();
  });

  it("RED-BEFORE: when the door delivered nothing (no customer email) the panel does not say 'Reminder sent'; it warns that no email went out", async () => {
    sendInvoiceReminder.mockResolvedValue({ data: { delivered: false, channel: "manual", paymentUrl: null }, error: null });
    mount([invoice("inv_no_email", "SENT")]);
    await clickSendReminder();

    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    expect(String((toast.warning as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toMatch(/not emailed|no email/i);
    expect(toast.success).not.toHaveBeenCalled();
    expect(updateInvoiceStatus).not.toHaveBeenCalled();
  });

  it("RED-BEFORE: a refused reminder (e.g. Gmail not connected, 503) is shown as the error, never as 'Reminder sent'", async () => {
    sendInvoiceReminder.mockResolvedValue({ data: null, error: "Gmail is not connected" });
    mount([invoice("inv_fails", "SENT")]);
    await clickSendReminder();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Gmail is not connected"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(updateInvoiceStatus).not.toHaveBeenCalled();
  });

  it("RED-BEFORE: with no workspace selected the panel sends nothing and says so (it toasted 'Reminder sent')", async () => {
    mount([invoice("inv_nobiz", "SENT")], null);
    await clickSendReminder();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(sendInvoiceReminder).not.toHaveBeenCalled();
    expect(updateInvoiceStatus).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
