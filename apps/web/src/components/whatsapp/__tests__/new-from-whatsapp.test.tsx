/**
 * WEDGE-WA-INBOUND-CAPTURE, the web half (P0, the D-263 wedge; whatsapp ruling D-153: v1 sends WhatsApp links out and
 * the inbox is V1.1). "+ New > From WhatsApp" is a sheet where the owner pastes what a customer sent on WhatsApp and the
 * customer's number. The server half (POST /crm/businesses/:businessId/whatsapp/inbound-capture, crm write, tenant
 * bound; apps/server/test/wa-inbound-capture.integration.test.ts) reads the number with Business.country, finds the
 * customer by that E.164 number or creates them, keeps the message as a plain-text note on their timeline and never
 * sends anything. The sheet then offers New quote and New booking for that customer.
 *
 *   WAW-01 the number is read for the business's country: the sheet shows how it reads (the WA-HELPER reading with the
 *          business's country) and, once saved, the number the server normalised; it sends the number as typed.
 *   WAW-02 an existing customer is found by E.164 and not duplicated: one capture request, no contact create, and the
 *          sheet says the customer was already there.
 *   WAW-03 a new customer is created: the optional name is sent, and the sheet says the customer was added.
 *   WAW-04 the message is saved verbatim and shown as plain text: markup in it is text, never HTML.
 *   WAW-04b (review pin COR-5) what shows is what the server stored (note.body), not what was typed.
 *   WAW-05 New quote opens the Quotes tab with the customer chosen (?tab=quotes&contactId=<id>).
 *   WAW-06 New booking opens Bookings with the customer chosen (?contactId=<id>).
 *          Both doors are a full page load (newFromWhatsAppNavigation.assign), not router.push. That was chosen when
 *          RequireAuth (components/require-auth.tsx) remounted the app shell on every pathname change, so a client
 *          navigation mounted the destination page twice and the first instance dropped the one-shot ?contactId (seen
 *          in the browser sweep at every width). FU-REQUIRE-AUTH-REMOUNT removed that remount; the sheet keeps the full
 *          load, which still works (FU-CONTACT-SEND-QUOTE-DOOR).
 *   WAW-07 a refusal keeps the sheet open, with what was typed, and says why (400, 403 crm read, 409, network).
 *   WAW-08 nothing is sent to the customer from here: the only request is the capture.
 *   WAW-09 Save waits for a number and a message; a message over 10,000 characters is said, not sent or cut.
 *   WAW-10 the door is offered only to a member who may write customers (unknown hides nothing).
 *   WAW-11 New quote and New booking follow the member's access and what the business sells (unknown hides nothing).
 *
 * The real lib/api transport and failure kit; only fetch and the router are stubbed. Error bodies are the ones the
 * production GlobalHttpExceptionFilter answers.
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

import { NewFromWhatsAppSheet, mayCaptureFromWhatsApp, newFromWhatsAppNavigation } from "../new-from-whatsapp";
import { setCachedBusiness } from "@/lib/workspace";

const BIZ = "biz_waw_a";
const CAPTURE_URL = `/crm/businesses/${BIZ}/whatsapp/inbound-capture`;

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
function sentBody(i = 0): Record<string, unknown> {
  return JSON.parse(String((captureCalls()[i][1] as RequestInit).body));
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

describe("WEDGE-WA-INBOUND-CAPTURE: + New > From WhatsApp", () => {
  it("WAW-01 reads the number for the business's country, sends it as typed and shows the server's E.164 number", async () => {
    setCachedBusiness({ id: BIZ, name: "WAW Business", country: "Guyana" } as never);
    answer = captured({ normalizedPhone: "+5926221234", contact: { phone: "+5926221234", whatsappNumber: "+5926221234" } });
    open();
    fill("622 1234", "Do you deliver to Linden?");
    // Before saving: the WA-HELPER reading with the business's country (Guyana, +592), not TT's +1 868.
    expect(within(dialog()).getByText(/\+5926221234/)).toBeInTheDocument();
    expect(within(dialog()).queryByText(/\+18686221234/)).toBeNull();

    await save();
    expect(String(captureCalls()[0][0])).toContain(CAPTURE_URL);
    expect((captureCalls()[0][1] as RequestInit).method).toBe("POST");
    expect(sentBody().phone).toBe("622 1234");
    // Saved: the number the server normalised.
    expect(await within(dialog()).findByText(/saved/i)).toBeInTheDocument();
    expect(within(dialog()).getAllByText(/\+5926221234/).length).toBeGreaterThan(0);
  });

  it("WAW-01b a TT business reads a 7-digit local number as +1 868", () => {
    open();
    fill("777-1234", "Hi");
    expect(within(dialog()).getByText(/\+18687771234/)).toBeInTheDocument();
  });

  it("WAW-02 an existing customer found by E.164 is not duplicated: one capture request, no contact create", async () => {
    answer = captured({ created: false, contact: { id: "c_waw_existing", firstName: "Maria", lastName: "Lopez", displayName: "Maria Lopez" } });
    open();
    fill("+1 868 777 1234", "Is Saturday still good?");
    await save();
    expect(await within(dialog()).findByText(/already a customer/i)).toBeInTheDocument();
    expect(within(dialog()).getAllByText(/Maria Lopez/).length).toBeGreaterThan(0);
    expect(within(dialog()).queryByText(/new customer added/i)).toBeNull();
    // The capture is the only write: the sheet never creates the contact itself.
    expect(captureCalls()).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url, init]) => /\/contacts(\?|$)/.test(String(url)) && (init as RequestInit | undefined)?.method === "POST")).toEqual([]);
    fireEvent.click(within(dialog()).getByRole("button", { name: /^new quote$/i }));
    opened("/app/commerce?tab=quotes&contactId=c_waw_existing");
  });

  it("WAW-03 a new customer is created, with the optional name sent", async () => {
    answer = captured({ created: true, contact: { firstName: "Dev", lastName: "Persad", displayName: "Dev Persad" } });
    open();
    fill("7771234", "Need a quote for a fence");
    fireEvent.change(within(dialog()).getByLabelText(/first name/i), { target: { value: "  Dev " } });
    fireEvent.change(within(dialog()).getByLabelText(/last name/i), { target: { value: "Persad" } });
    await save();
    expect(sentBody()).toMatchObject({ phone: "7771234", message: "Need a quote for a fence", firstName: "Dev", lastName: "Persad" });
    expect(await within(dialog()).findByText(/new customer added/i)).toBeInTheDocument();
    expect(within(dialog()).getAllByText(/Dev Persad/).length).toBeGreaterThan(0);
  });

  it("WAW-03b no name typed: none is sent (the server keeps the customer nameless, found by number)", async () => {
    open();
    fill("7771234", "Hello");
    await save();
    const body = sentBody();
    expect(body).not.toHaveProperty("firstName");
    expect(body).not.toHaveProperty("lastName");
    expect(body).not.toHaveProperty("contactId");
  });

  it("WAW-04 the message is saved verbatim and shown as plain text, markup and line breaks included", async () => {
    const pasted = "Hi!\nCan I get <b>3</b> shirts? <img src=x onerror=\"alert(1)\"> & a hat";
    answer = captured({ body: pasted });
    const { container } = open();
    fill("7771234", `  ${pasted}\n`);
    await save();
    // Sent as pasted (outer whitespace aside, which the server trims the same way).
    expect(sentBody().message).toBe(pasted);
    await within(dialog()).findByText(/saved/i);
    const shown = within(dialog()).getByTestId("wa-saved-message");
    expect(shown.textContent).toBe(pasted);
    // Text, never HTML: no element came out of the message.
    expect(shown.querySelector("b, img")).toBeNull();
    expect(container.ownerDocument.querySelector("img[src='x']")).toBeNull();
  });

  it("WAW-04b shows what the server stored (note.body), not the text typed in the sheet", async () => {
    answer = captured({ body: "Stored on the timeline" });
    open();
    fill("7771234", "Typed in the sheet");
    await save();
    await within(dialog()).findByText(/saved/i);
    expect(within(dialog()).getByTestId("wa-saved-message").textContent).toBe("Stored on the timeline");
    expect(within(dialog()).queryByText("Typed in the sheet")).toBeNull();
  });

  it("WAW-05 New quote opens the Quotes tab with the customer chosen, and closes the sheet", async () => {
    open();
    fill("7771234", "Quote please");
    await save();
    fireEvent.click(await within(dialog()).findByRole("button", { name: /^new quote$/i }));
    opened("/app/commerce?tab=quotes&contactId=c_waw_1");
    expect(onClose).toHaveBeenCalled();
  });

  it("WAW-06 New booking opens Bookings with the customer chosen, and closes the sheet", async () => {
    open();
    fill("7771234", "Can I book Friday?");
    await save();
    fireEvent.click(await within(dialog()).findByRole("button", { name: /^new booking$/i }));
    opened("/app/bookings?contactId=c_waw_1");
    expect(onClose).toHaveBeenCalled();
  });

  it("WAW-06b the customer's id is encoded in both doors", async () => {
    answer = captured({ contact: { id: "c/1?x=y" } });
    open();
    fill("7771234", "Hi");
    await save();
    fireEvent.click(await within(dialog()).findByRole("button", { name: /^new booking$/i }));
    opened("/app/bookings?contactId=c%2F1%3Fx%3Dy");
  });

  describe("WAW-07 a refusal keeps the sheet open with what was typed and says why", () => {
    const cases: Array<[string, Answer, RegExp]> = [
      [
        "400 the number cannot be read",
        { status: 400, body: { statusCode: 400, message: "Phone number could not be normalised for this business country. Include the country code or check the digits.", error: "Bad Request" } },
        /could not be normalised for this business country/i,
      ],
      [
        "403 a member with crm read",
        { status: 403, body: { statusCode: 403, message: "Insufficient permissions: crm requires write access (you have read)", error: "Forbidden" } },
        /it needs crm write access/i,
      ],
      [
        "409 the number belongs to a customer this member cannot open",
        { status: 409, body: { statusCode: 409, code: "contact_phone_taken", message: "A contact with this phone number already exists in this workspace." } },
        /already exists in this workspace/i,
      ],
      ["the network failing", "network", /failed to fetch|couldn't|try again/i],
    ];
    for (const [label, refusal, reason] of cases) {
      it(label, async () => {
        answer = refusal;
        open();
        fill("12", "Keep this message");
        await save();
        expect(await within(dialog()).findByRole("alert")).toHaveTextContent(reason);
        expect(dialog()).toBeInTheDocument();
        expect(numberField()).toHaveValue("12");
        expect(messageField()).toHaveValue("Keep this message");
        expect(within(dialog()).queryByRole("button", { name: /^new quote$/i })).toBeNull();
        expect(onClose).not.toHaveBeenCalled();
        expect(nav.push).not.toHaveBeenCalled();
        expect(assign).not.toHaveBeenCalled();
      });
    }

    it("a refusal followed by a fixed number saves, and the reason goes", async () => {
      answer = { status: 400, body: { statusCode: 400, message: "Phone number could not be normalised for this business country. Include the country code or check the digits." } };
      open();
      fill("12", "Keep this message");
      await save();
      await within(dialog()).findByRole("alert");
      answer = captured({ body: "Keep this message" });
      fireEvent.change(numberField(), { target: { value: "7771234" } });
      fireEvent.click(saveButton());
      expect(await within(dialog()).findByText(/saved/i)).toBeInTheDocument();
      expect(within(dialog()).queryByRole("alert")).toBeNull();
    });
  });

  it("WAW-08 nothing is sent to the customer: the capture is the only request, and no WhatsApp window opens", async () => {
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    open();
    fill("7771234", "Hi");
    await save();
    await within(dialog()).findByText(/saved/i);
    expect(fetchMock.mock.calls.map(([url]) => String(url)).filter((u) => !u.includes("/whatsapp/inbound-capture"))).toEqual([]);
    expect(fetchMock.mock.calls.some(([url]) => /wa\.me|graph\.facebook|whatsapp\.com/.test(String(url)))).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("WAW-09 Save waits for a number and a message", () => {
    open();
    expect(saveButton()).toBeDisabled();
    fireEvent.change(numberField(), { target: { value: "7771234" } });
    expect(saveButton()).toBeDisabled();
    fireEvent.change(messageField(), { target: { value: "   " } });
    expect(saveButton()).toBeDisabled();
    fireEvent.change(messageField(), { target: { value: "Hi" } });
    expect(saveButton()).toBeEnabled();
  });

  it("WAW-09b a message over 10,000 characters is kept whole, said, and not sent", () => {
    open();
    const long = "a".repeat(10_001);
    fill("7771234", long);
    // Not cut: the field keeps every character, so nothing the customer wrote is lost silently.
    expect((messageField() as HTMLTextAreaElement).value).toHaveLength(10_001);
    expect(within(dialog()).getByText(/10,000/)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    fireEvent.click(saveButton());
    expect(captureCalls()).toHaveLength(0);
  });

  it("WAW-09c exactly 10,000 characters is allowed", async () => {
    open();
    const max = "b".repeat(10_000);
    answer = captured({ body: max });
    fill("7771234", max);
    expect(saveButton()).toBeEnabled();
    await save();
    expect(sentBody().message).toHaveLength(10_000);
  });

  it("WAW-10 the door is offered only to a member who may write customers; unknown hides nothing", () => {
    expect(mayCaptureFromWhatsApp(null)).toBe(true);
    expect(mayCaptureFromWhatsApp({})).toBe(true);
    expect(mayCaptureFromWhatsApp({ revenue: "write" })).toBe(true);
    expect(mayCaptureFromWhatsApp({ crm: "write" })).toBe(true);
    expect(mayCaptureFromWhatsApp({ crm: "admin" })).toBe(true);
    expect(mayCaptureFromWhatsApp({ crm: "read" })).toBe(false);
    expect(mayCaptureFromWhatsApp({ crm: "none" })).toBe(false);
  });

  describe("WAW-11 New quote and New booking follow the member's access and what the business sells", () => {
    async function savedWith(props: Partial<React.ComponentProps<typeof NewFromWhatsAppSheet>>) {
      open(props);
      fill("7771234", "Hi");
      await save();
      await within(dialog()).findByText(/saved/i);
    }
    const quote = () => within(dialog()).queryByRole("button", { name: /^new quote$/i });
    const booking = () => within(dialog()).queryByRole("button", { name: /^new booking$/i });

    it("unknown access and sells: both offered", async () => {
      await savedWith({ levels: null, sells: null });
      expect(quote()).not.toBeNull();
      expect(booking()).not.toBeNull();
    });
    it("revenue read: no New quote; bookings none: no New booking", async () => {
      await savedWith({ levels: { crm: "write", revenue: "read", bookings: "none" }, sells: "both" });
      expect(quote()).toBeNull();
      expect(booking()).toBeNull();
      // The customer is still reachable.
      expect(within(dialog()).getByRole("link", { name: /open customer/i })).toHaveAttribute("href", "/app/crm/contacts/c_waw_1");
    });
    it("a products business has no bookings: no New booking", async () => {
      await savedWith({ levels: { crm: "write", revenue: "write", bookings: "write" }, sells: "products" });
      expect(quote()).not.toBeNull();
      expect(booking()).toBeNull();
    });
  });

  it("closed: nothing is rendered", () => {
    render(<NewFromWhatsAppSheet open={false} onClose={onClose} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
