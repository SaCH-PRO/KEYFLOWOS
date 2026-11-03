/**
 * FOLLOW3-A8-PAYMENTS-TAB-REMINDER (VR-01, second caller): the Payments tab's
 * "Send Reminder" button reminds, and reports only what the server did.
 *
 * Before: handleSendReminder called updateInvoiceStatus(id, "SENT") from the
 * Recovery Queue and from every unpaid row, rewrote the row to SENT and
 * toasted "Reminder sent". Since V1-42 the status route answers a SENT invoice
 * idempotently (200, no invoice.sent, no email, no timeline entry), so nobody
 * was reminded; on a PARTIALLY_PAID or OVERDUE row the same call is an illegal
 * transition (409), and when it did answer the tab set the row to SENT.
 *
 * After: the button calls the reminder door exactly as the Collections panel
 * does since V1-42c (sendInvoiceReminder, POST
 * /commerce/businesses/:b/invoices/:id/send-reminder) and reads its answer:
 * delivered -> "Reminder sent"; not delivered (no customer email) -> a warning
 * that it was logged but not emailed; an error -> the error. The row's status
 * is never touched (a reminder changes nothing on the invoice), and with no
 * workspace selected nothing is sent. The server half is
 * apps/server/test/invoice-status-events.integration.test.ts (VR-01a..e).
 *
 * The tab is mounted as finance-pipeline.tsx mounts it, with a real React
 * state holder behind setInvoices so a status rewrite would show on screen;
 * only its data door (@/lib/client) and the toast are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { useState } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Invoice } from "@/lib/client";
import { toast } from "sonner";

const sendInvoiceReminder = vi.fn();
const updateInvoiceStatus = vi.fn();
const markInvoicePaid = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/lib/client", () => ({
  markInvoicePaid: (...args: unknown[]) => markInvoicePaid(...args),
  updateInvoiceStatus: (...args: unknown[]) => updateInvoiceStatus(...args),
  sendInvoiceReminder: (...args: unknown[]) => sendInvoiceReminder(...args),
}));

import PaymentsTab from "../payments-tab";

const BIZ = "biz_a8";
const PAST_DUE = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();

function invoice(id: string, status: string): Invoice {
  return {
    id, invoiceNumber: id.toUpperCase(), status, total: 100, currency: "TTD",
    issueDate: PAST_DUE, dueDate: PAST_DUE, contactId: null,
    contact: { firstName: "A8", lastName: id, email: null }, items: [], payments: [],
  };
}

/** The tab with a real invoices state, so whatever setInvoices does is rendered. */
function mount(invoices: Invoice[], businessId: string | null = BIZ) {
  const setInvoicesSpy = vi.fn();
  let current: Invoice[] = invoices;
  function Holder() {
    const [list, setList] = useState<Invoice[]>(invoices);
    current = list;
    const setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>> = (action) => {
      setInvoicesSpy(action);
      setList(action);
    };
    return <PaymentsTab invoices={list} currency="TTD" businessId={businessId} setInvoices={setInvoices} />;
  }
  render(<Holder />);
  return { setInvoicesSpy, statusOf: (id: string) => current.find((i) => i.id === id)?.status };
}

/** Recovery Queue button (first in the DOM) or the payments-list row button (last). */
function clickSendReminder(where: "queue" | "list" = "queue") {
  const buttons = screen.getAllByTitle("Send Reminder");
  fireEvent.click(where === "queue" ? buttons[0] : buttons[buttons.length - 1]);
}

beforeEach(() => {
  // What the status route answers a SENT invoice since V1-42: 200, nothing done.
  updateInvoiceStatus.mockResolvedValue({ data: { id: "x", status: "SENT" }, error: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Payments tab: Send Reminder (FOLLOW3-A8, VR-01)", () => {
  it("RED-BEFORE: a SENT past-due row (Recovery Queue) calls the reminder door, never the status route, and says 'Reminder sent' when it delivered", async () => {
    sendInvoiceReminder.mockResolvedValue({ data: { delivered: true, channel: "email", messageId: "m1", paymentUrl: null }, error: null });
    const { setInvoicesSpy, statusOf } = mount([invoice("inv_sent", "SENT")]);
    clickSendReminder("queue");

    await waitFor(() => expect(sendInvoiceReminder).toHaveBeenCalledTimes(1));
    expect(sendInvoiceReminder).toHaveBeenCalledWith(BIZ, "inv_sent", {});
    expect(updateInvoiceStatus).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reminder sent"));
    expect(toast.error).not.toHaveBeenCalled();
    expect(setInvoicesSpy, "a reminder changes nothing on the invoice").not.toHaveBeenCalled();
    expect(statusOf("inv_sent")).toBe("SENT");
  });

  it("RED-BEFORE: the payments-list row button reminds through the same door", async () => {
    sendInvoiceReminder.mockResolvedValue({ data: { delivered: true, channel: "email", paymentUrl: null }, error: null });
    const { setInvoicesSpy } = mount([invoice("inv_list", "SENT")]);
    expect(screen.getAllByTitle("Send Reminder")).toHaveLength(2);
    clickSendReminder("list");

    await waitFor(() => expect(sendInvoiceReminder).toHaveBeenCalledWith(BIZ, "inv_list", {}));
    expect(updateInvoiceStatus).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reminder sent"));
    expect(setInvoicesSpy).not.toHaveBeenCalled();
  });

  it("RED-BEFORE: a PARTIALLY_PAID past-due row is reminded and keeps its status (the tab used to rewrite it to SENT)", async () => {
    sendInvoiceReminder.mockResolvedValue({ data: { delivered: true, channel: "email", paymentUrl: null }, error: null });
    const { setInvoicesSpy, statusOf } = mount([invoice("inv_part", "PARTIALLY_PAID")]);
    clickSendReminder("queue");

    await waitFor(() => expect(sendInvoiceReminder).toHaveBeenCalledWith(BIZ, "inv_part", {}));
    expect(updateInvoiceStatus).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reminder sent"));
    expect(setInvoicesSpy).not.toHaveBeenCalled();
    expect(statusOf("inv_part")).toBe("PARTIALLY_PAID");
    expect(screen.queryByText("SENT")).toBeNull();
  });

  it("RED-BEFORE: an OVERDUE row reminds through the same door (the status route refuses OVERDUE -> SENT with 409) and keeps its status", async () => {
    sendInvoiceReminder.mockResolvedValue({ data: { delivered: true, channel: "email", paymentUrl: null }, error: null });
    const { setInvoicesSpy, statusOf } = mount([invoice("inv_overdue", "OVERDUE")]);
    clickSendReminder("queue");

    await waitFor(() => expect(sendInvoiceReminder).toHaveBeenCalledWith(BIZ, "inv_overdue", {}));
    expect(updateInvoiceStatus).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reminder sent"));
    expect(setInvoicesSpy).not.toHaveBeenCalled();
    expect(statusOf("inv_overdue")).toBe("OVERDUE");
  });

  it("RED-BEFORE: when the door delivered nothing (no customer email) the tab does not say 'Reminder sent'; it warns the reminder was logged but not emailed", async () => {
    sendInvoiceReminder.mockResolvedValue({ data: { delivered: false, channel: "manual", paymentUrl: null }, error: null });
    const { setInvoicesSpy, statusOf } = mount([invoice("inv_no_email", "SENT")]);
    clickSendReminder("queue");

    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    expect(String((toast.warning as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toMatch(/logged but not emailed/i);
    expect(toast.success).not.toHaveBeenCalled();
    expect(updateInvoiceStatus).not.toHaveBeenCalled();
    expect(setInvoicesSpy).not.toHaveBeenCalled();
    expect(statusOf("inv_no_email")).toBe("SENT");
  });

  it("RED-BEFORE: a refused reminder (e.g. Gmail not connected, 503) is shown as the error, never as 'Reminder sent', and the row is untouched", async () => {
    sendInvoiceReminder.mockResolvedValue({ data: null, error: "Gmail is not connected" });
    const { setInvoicesSpy, statusOf } = mount([invoice("inv_fails", "PARTIALLY_PAID")]);
    clickSendReminder("queue");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Gmail is not connected"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(updateInvoiceStatus).not.toHaveBeenCalled();
    expect(setInvoicesSpy).not.toHaveBeenCalled();
    expect(statusOf("inv_fails")).toBe("PARTIALLY_PAID");
  });

  it("RED-BEFORE: with no workspace selected the tab sends nothing and says so (it toasted 'Reminder sent')", async () => {
    const { setInvoicesSpy } = mount([invoice("inv_nobiz", "SENT")], null);
    clickSendReminder("queue");

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(sendInvoiceReminder).not.toHaveBeenCalled();
    expect(updateInvoiceStatus).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(setInvoicesSpy).not.toHaveBeenCalled();
  });
});
