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
 * Mounted on the real BillingDetailModal and the real lib/whatsapp.ts; the
 * composer context and the side sections that read the network (timeline,
 * time log, attribution, leverage metrics, AI actions) are stubbed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));
vi.mock("../invoice-timeline", () => ({ InvoiceTimeline: () => null }));
vi.mock("../time-log-widget", () => ({ TimeLogWidget: () => null }));
vi.mock("../attribution-editor", () => ({ AttributionEditor: () => null }));
vi.mock("../leverage-metrics-section", () => ({ LeverageMetricsSection: () => null }));
vi.mock("../detail-parts/detail-ai-actions", () => ({ DetailAIActions: () => null }));

import { BillingDetailModal } from "../billing-detail-modal";
import { setCachedBusiness } from "@/lib/workspace";

function renderModal(phone: string | null, type: "invoice" | "quote" = "invoice") {
  return render(
    <BillingDetailModal
      type={type}
      number={type === "invoice" ? "INV-0001" : "QT-0001"}
      status="SENT"
      contact={{ firstName: "Rena", lastName: "Ali", email: "rena@example.test", phone }}
      contactId="ct_wa_helper"
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

/** The panel's WhatsApp chat link, or null. */
function whatsAppHref(): string | null {
  const links = screen.queryAllByRole("link", { name: /whatsapp/i });
  return links.length ? links[0]!.getAttribute("href") : null;
}

afterEach(() => {
  cleanup();
  setCachedBusiness({ id: "biz_wa_helper", name: "Sweet Treats" });
});

describe("WA-HELPER billing detail panel: WhatsApp opens the customer's own E.164 number", () => {
  it.each(["755-0123", "868-755-0123", "(868) 755-0123", "+1 868 755 0123", "1 868 755 0123"])(
    "a TT customer saved as %j: wa.me/18687550123",
    (typed) => {
      renderModal(typed);
      expect(whatsAppHref()).toBe("https://wa.me/18687550123");
    },
  );

  it("'755-0123' and '868-755-0123' give the same chat, on a quote too", () => {
    renderModal("755-0123", "quote");
    const short = whatsAppHref();
    cleanup();
    renderModal("868-755-0123", "quote");
    expect(short).toBe("https://wa.me/18687550123");
    expect(whatsAppHref()).toBe(short);
  });

  it("a local number reads with the business's own country", () => {
    setCachedBusiness({ id: "biz_wa_helper", name: "Sweet Treats", country: "United Kingdom" } as Parameters<typeof setCachedBusiness>[0]);
    renderModal("07700 900123");
    expect(whatsAppHref()).toBe("https://wa.me/447700900123");
  });

  it("no phone: no WhatsApp button", () => {
    renderModal(null);
    expect(whatsAppHref()).toBeNull();
  });
});
