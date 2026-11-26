/**
 * FU-CONTACT-SEND-QUOTE-DOOR repair round 1 (SEC-SQD-3, a guard): the WhatsApp sheet's New quote door carries the
 * customer's id encoded, so an id with URL-reserved characters reaches the Quotes tab whole and cannot add or replace a
 * parameter. The sheet already encodes it (new-from-whatsapp.tsx, encodeURIComponent(saved.contact.id)); this pins it.
 *
 *   WAE-01 guard  New quote opens /app/commerce?tab=quotes&contactId=<encoded id>, and that URL reads back the id whole
 *
 * Setup as in new-from-whatsapp.test.tsx: the real lib/api transport; only fetch, the router and the navigation are
 * stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/command-center",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { NewFromWhatsAppSheet, newFromWhatsAppNavigation } from "../new-from-whatsapp";
import { setCachedBusiness } from "@/lib/workspace";

const BIZ = "biz_waw_a";

type Answer = { status: number; body: unknown } | "network";
let answer: Answer;
const fetchMock = vi.fn();

function contact(over: Record<string, unknown> = {}) {
  return {
    id: "c_waw_1",
    businessId: BIZ,
    firstName: null,
    lastName: null,
    displayName: null,
    email: null,
    phone: "+18687771234",
    whatsappNumber: "+18687771234",
    status: "LEAD",
    source: "whatsapp_inbound",
    ...over,
  };
}

/** The server half's 201 answer (crm.service.ts captureInboundWhatsApp). */
function captured(over: { contact?: Record<string, unknown>; created?: boolean; normalizedPhone?: string; body?: string } = {}) {
  const body = over.body ?? "Hi, can I get a price for 3 shirts?";
  return {
    status: 201,
    body: {
      contact: contact(over.contact),
      created: over.created ?? true,
      normalizedPhone: over.normalizedPhone ?? "+18687771234",
      note: { id: "n_waw_1", contactId: "c_waw_1", body, source: "whatsapp_inbound", createdAt: "2026-11-25T10:00:00.000Z" },
      event: { id: "e_waw_1", type: "communication.whatsapp" },
    },
  };
}

function captureCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes("/whatsapp/inbound-capture"));
}

const onClose = vi.fn();
let assign: MockInstance<(href: string) => void>;

/** The door the sheet opened: a full page load, never a client navigation (see WAW-05). */
function opened(href: string) {
  expect(assign).toHaveBeenCalledWith(href);
  expect(nav.push).not.toHaveBeenCalled();
}

function open(props: Partial<React.ComponentProps<typeof NewFromWhatsAppSheet>> = {}) {
  return render(<NewFromWhatsAppSheet open onClose={onClose} {...props} />);
}
const dialog = () => screen.getByRole("dialog", { name: /new from whatsapp/i });
const numberField = () => within(dialog()).getByLabelText(/whatsapp number/i);
const messageField = () => within(dialog()).getByLabelText(/their message/i);
const saveButton = () => within(dialog()).getByRole("button", { name: /^save/i });

function fill(number: string, message: string) {
  fireEvent.change(numberField(), { target: { value: number } });
  fireEvent.change(messageField(), { target: { value: message } });
}

async function save() {
  fireEvent.click(saveButton());
  await waitFor(() => expect(captureCalls().length).toBeGreaterThan(0));
}

beforeEach(() => {
  window.localStorage.setItem("kf_token", "t_waw");
  window.localStorage.setItem("kf_business_id", BIZ);
  setCachedBusiness({ id: BIZ, name: "WAW Business", country: "Trinidad and Tobago" } as never);
  answer = captured();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => {
    if (answer === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  nav.push.mockReset();
  onClose.mockReset();
  // (Absent before the doors became full page loads: the door cases then fail on their own assertion, not here.)
  assign = newFromWhatsAppNavigation
    ? vi.spyOn(newFromWhatsAppNavigation, "assign").mockImplementation(() => {})
    : vi.fn<(href: string) => void>();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("SEC-SQD-3 the WhatsApp sheet's New quote door encodes the customer's id", () => {
  it("WAE-01 guard New quote opens the Quotes door with the id encoded", async () => {
    const ID = "c_wae&tab=snapshot#x";
    answer = captured({ contact: { id: ID, firstName: "Wren" } });
    open();
    fill("777 1234", "Price for 2 shirts?");
    await save();
    fireEvent.click(await within(dialog()).findByRole("button", { name: /^new quote$/i }));
    opened(`/app/commerce?tab=quotes&contactId=${encodeURIComponent(ID)}`);
    const href = new URL(assign.mock.calls[0][0], "http://localhost");
    expect(href.searchParams.get("tab")).toBe("quotes");
    expect(href.searchParams.get("contactId")).toBe(ID);
    expect(href.hash).toBe("");
  });
});
