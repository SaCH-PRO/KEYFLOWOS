/**
 * WA-HELPER (whatsapp ruling D-153): the invoice / quote detail panel's
 * WhatsApp button opens a chat with the customer's own number, however the
 * number was typed.
 *
 * Before this packet the panel built `https://wa.me/<the digits as typed>`, so
 * a Trinidad and Tobago customer saved as '755-0123' got wa.me/7550123 and
 * the same customer saved as '868-755-0123' got wa.me/8687550123: two
 * different links for one customer, neither of them a live chat.
 *
 * Repair (review of 087b0365, WAH-CR-4): the panel showed WhatsApp only when
 * its `contact` prop carried a phone, and neither caller (the invoices panel,
 * the quotes panel) ever passes one: the operator invoice and quote reads
 * serve the customer's name and e-mail only (OPERATOR_INVOICE_CONTACT_SELECT,
 * OPERATOR_QUOTE_CONTACT_SELECT). So the button never rendered in production
 * and the earlier tests, which passed a phone, proved nothing. The panel now
 * reads the customer by id (GET /crm/businesses/:id/contacts/:contactId, the
 * member's own read) with the business id its caller passes, and, as the
 * quote and invoice shares do (SEC-WAH-1), opens the WhatsApp number the
 * business saved on the contact: a phone alone may have come from a public
 * form, so it is not offered on a document screen.
 *
 * Mounted on the real BillingDetailModal, the real client and the real
 * lib/whatsapp.ts with fetch stubbed at the network edge; the composer
 * context and the side sections that read the network (timeline, time log,
 * attribution, leverage metrics, AI actions) are stubbed.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));
vi.mock("../invoice-timeline", () => ({ InvoiceTimeline: () => null }));
vi.mock("../time-log-widget", () => ({ TimeLogWidget: () => null }));
vi.mock("../attribution-editor", () => ({ AttributionEditor: () => null }));
vi.mock("../leverage-metrics-section", () => ({ LeverageMetricsSection: () => null }));
vi.mock("../detail-parts/detail-ai-actions", () => ({ DetailAIActions: () => null }));

import { BillingDetailModal } from "../billing-detail-modal";
import { setCachedBusiness } from "@/lib/workspace";

const BIZ = "biz_wa_helper_modal";

/** The customer as the member's contact read serves it, or that read's refusal. */
let served: { status: number; contact: Record<string, unknown> | null } = { status: 200, contact: null };
let contactReads: string[] = [];

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 400 ? "Error" : "OK",
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    headers: new Headers({ "content-type": "application/json" }),
  } as unknown as Response;
}

beforeEach(() => {
  contactReads = [];
  served = { status: 200, contact: null };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
      if (url.pathname === `/crm/businesses/${BIZ}/contacts/ct_wa_helper`) {
        contactReads.push(url.pathname);
        return served.status === 200
          ? jsonResponse(200, { contact: served.contact, events: [], notes: [], tasks: [] })
          : jsonResponse(served.status, { message: "Contact not found" });
      }
      return jsonResponse(200, {});
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setCachedBusiness({ id: "biz_wa_helper", name: "Sweet Treats" });
});

/** The customer the read serves, with the WhatsApp number and phone the business has on file. */
function customer(whatsappNumber: string | null, phone: string | null = whatsappNumber) {
  return { id: "ct_wa_helper", firstName: "Rena", lastName: "Ali", email: "rena@example.test", phone, whatsappNumber };
}

/** The panel as both callers mount it: the operator read's contact (no phone), the contact id and the business id. */
function renderModal(type: "invoice" | "quote" = "invoice") {
  return render(
    <BillingDetailModal
      type={type}
      number={type === "invoice" ? "INV-0001" : "QT-0001"}
      status="SENT"
      contact={{ firstName: "Rena", lastName: "Ali", email: "rena@example.test" }}
      contactId="ct_wa_helper"
      businessId={BIZ}
      total={100}
      currency="TTD"
      items={[{ id: "li_1", description: "Cake", quantity: 1, unitPrice: 100, total: 100 }]}
      dateLabel1="Issued"
      dateValue1="2026-11-16T10:00:00.000Z"
      dateLabel2="Due"
      dateValue2={null}
      taxRate={0}
      actions={null}
      onClose={vi.fn()}
    />,
  );
}

/** The panel's WhatsApp chat link, once the customer's read has answered (null: no button). */
async function whatsAppHref(): Promise<string | null> {
  await waitFor(() => expect(contactReads.length).toBeGreaterThan(0));
  try {
    const link = await screen.findByRole("link", { name: /whatsapp/i }, { timeout: 1000 });
    return link.getAttribute("href");
  } catch {
    return null;
  }
}

describe("WA-HELPER billing detail panel: WhatsApp opens the customer's own E.164 number", () => {
  it.each(["755-0123", "868-755-0123", "(868) 755-0123", "+1 868 755 0123", "1 868 755 0123"])(
    "a TT customer whose WhatsApp number is saved as %j: wa.me/18687550123 (RED at 087b0365: no button, the operator read has no phone)",
    async (typed) => {
      served = { status: 200, contact: customer(typed) };
      renderModal();
      expect(await whatsAppHref()).toBe("https://wa.me/18687550123");
      expect(contactReads).toEqual([`/crm/businesses/${BIZ}/contacts/ct_wa_helper`]);
    },
  );

  it("'755-0123' and '868-755-0123' give the same chat, on a quote too", async () => {
    served = { status: 200, contact: customer("755-0123") };
    renderModal("quote");
    const short = await whatsAppHref();
    cleanup();
    contactReads = [];
    served = { status: 200, contact: customer("868-755-0123") };
    renderModal("quote");
    expect(short).toBe("https://wa.me/18687550123");
    expect(await whatsAppHref()).toBe(short);
  });

  it("a local number reads with the business's own country", async () => {
    setCachedBusiness({ id: "biz_wa_helper", name: "Sweet Treats", country: "United Kingdom" } as Parameters<typeof setCachedBusiness>[0]);
    served = { status: 200, contact: customer("07700 900123") };
    renderModal();
    expect(await whatsAppHref()).toBe("https://wa.me/447700900123");
  });

  it("a phone with no WhatsApp number saved by the business (a public form can write it): no WhatsApp button on the document", async () => {
    served = { status: 200, contact: customer(null, "+1 868 555 0199") };
    renderModal();
    expect(await whatsAppHref()).toBeNull();
  });

  it("no number on file, or the member's read of the customer is refused: no WhatsApp button", async () => {
    served = { status: 200, contact: customer(null, null) };
    renderModal();
    expect(await whatsAppHref()).toBeNull();
    cleanup();
    contactReads = [];
    served = { status: 404, contact: null };
    renderModal();
    expect(await whatsAppHref()).toBeNull();
  });
});
