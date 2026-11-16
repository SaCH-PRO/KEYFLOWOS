/**
 * WA-HELPER (whatsapp ruling D-153): the autopilot card's "Open WhatsApp"
 * opens a chat with the contact's own number and the drafted message.
 *
 * Before this packet the card kept the '+' of '+1 868 755 0123' in the path
 * (wa.me/+18687550123) and left a local '755-0123' without its country code
 * (wa.me/7550123), so neither opened a live chat.
 *
 * Mounted on the real AutopilotActions and the real lib/whatsapp.ts; the
 * draft and execute calls are stubbed at the client.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  return {
    ...actual,
    generateAutopilotDraft: vi.fn(async () => ({
      data: { subject: "", message: "Hi Rena, just checking in. Shall we book your next session?", tone: "warm", suggestedChannel: "whatsapp" },
      error: null,
    })),
    executeAutopilotAction: vi.fn(async () => ({ data: { ok: true }, error: null })),
  };
});

import { AutopilotActions, type AutopilotAction } from "../autopilot-actions";

let windowOpen: ReturnType<typeof vi.fn>;

beforeEach(() => {
  windowOpen = vi.fn(() => null);
  window.open = windowOpen as unknown as typeof window.open;
});

afterEach(() => {
  cleanup();
});

function action(contactPhone: string | undefined): AutopilotAction {
  return {
    id: "ap_wa",
    type: "check_in",
    status: "needs_approval",
    contactName: "Rena Ali",
    contactId: "ct_rena",
    contactPhone,
    description: "No visit in 60 days",
  };
}

async function openWhatsApp(contactPhone: string | undefined): Promise<URL> {
  render(<AutopilotActions actions={[action(contactPhone)]} businessId="biz_wa_helper" />);
  fireEvent.click(screen.getByText("AI Draft"));
  fireEvent.click(await screen.findByText("Open WhatsApp"));
  await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
  return new URL(String(windowOpen.mock.calls[0]![0]));
}

describe("WA-HELPER autopilot: Open WhatsApp opens the contact's own E.164 number", () => {
  it.each(["755-0123", "868-755-0123", "+1 868 755 0123"])("a contact saved as %j: wa.me/18687550123 with the draft", async (typed) => {
    const target = await openWhatsApp(typed);
    expect(target.origin + target.pathname).toBe("https://wa.me/18687550123");
    expect(target.searchParams.get("text")).toBe("Hi Rena, just checking in. Shall we book your next session?");
  });

  it("no number: WhatsApp's chooser with the draft", async () => {
    const target = await openWhatsApp(undefined);
    expect(target.origin + target.pathname).toBe("https://wa.me/");
    expect(target.searchParams.get("text")).toBe("Hi Rena, just checking in. Shall we book your next session?");
  });
});
