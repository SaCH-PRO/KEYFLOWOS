/**
 * WA-HELPER (whatsapp ruling D-153): the booking drawer's WhatsApp button
 * opens a chat with the customer's own number, however the number was typed.
 *
 * Before this packet the drawer built `https://wa.me/<the digits as typed>`:
 * a Trinidad and Tobago customer saved as '755-0123' got wa.me/7550123 and the
 * same customer saved as '868-755-0123' got wa.me/8687550123. Neither is a
 * WhatsApp number (no country code), so both chats were dead.
 *
 * Mounted on the real BookingDetailDrawer and the real lib/whatsapp.ts; only
 * the composer context and the time-log widget (its own network reads) are
 * stubbed. The business's country is the workspace's cached business.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));
vi.mock("../../../commerce/components/time-log-widget", () => ({ TimeLogWidget: () => null }));

import BookingDetailDrawer from "../booking-detail-drawer";
import type { Booking } from "../bookings-types";
import { setCachedBusiness } from "@/lib/workspace";

function booking(phone: string | null): Booking {
  return {
    id: "bk_wa_helper",
    startTime: "2026-11-20T14:00:00.000Z",
    endTime: "2026-11-20T15:00:00.000Z",
    status: "CONFIRMED",
    contactId: "ct_wa_helper",
    contact: { id: "ct_wa_helper", firstName: "Rena", lastName: "Ali", email: null, phone },
  };
}

function renderDrawer(phone: string | null) {
  return render(
    <BookingDetailDrawer
      selectedBooking={booking(phone)}
      onClose={vi.fn()}
      onStatusChange={vi.fn()}
      onSyncCalendar={vi.fn()}
      calendarConnected={false}
    />,
  );
}

/** The drawer's WhatsApp link, or null. */
function whatsAppHref(): string | null {
  const link = screen.queryByRole("link", { name: /whatsapp/i });
  return link ? link.getAttribute("href") : null;
}

afterEach(() => {
  cleanup();
  setCachedBusiness({ id: "biz_wa_helper", name: "Sweet Treats" });
});

describe("WA-HELPER booking drawer: WhatsApp opens the customer's own E.164 number", () => {
  it.each(["755-0123", "868-755-0123", "(868) 755-0123", "+1 868 755 0123", "1-868-755-0123"])(
    "a TT customer saved as %j: wa.me/18687550123",
    (typed) => {
      renderDrawer(typed);
      expect(whatsAppHref()).toBe("https://wa.me/18687550123");
    },
  );

  it("'755-0123' and '868-755-0123' give the same chat", () => {
    renderDrawer("755-0123");
    const short = whatsAppHref();
    cleanup();
    renderDrawer("868-755-0123");
    expect(whatsAppHref()).toBe(short);
  });

  it("a local number reads with the business's own country", () => {
    setCachedBusiness({ id: "biz_wa_helper", name: "Sweet Treats", country: "Jamaica" } as Parameters<typeof setCachedBusiness>[0]);
    renderDrawer("555-0123");
    expect(whatsAppHref()).toBe("https://wa.me/18765550123");
  });

  it("no phone: no WhatsApp button", () => {
    renderDrawer(null);
    expect(whatsAppHref()).toBeNull();
  });
});
