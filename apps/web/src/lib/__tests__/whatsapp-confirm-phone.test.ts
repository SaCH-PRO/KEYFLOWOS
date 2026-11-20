/**
 * FU-WA-CONTACT-PHONE (V1-71; whatsapp ruling D-153, follow-ups ruling D-221):
 * a contact with only a phone number can get a WhatsApp share after the owner
 * confirms the number once.
 *
 * WA-HELPER's security repair (SEC-WAH-1) opens wa.me for a quote or invoice
 * share only for the WhatsApp number the business saved on the contact
 * (savedWhatsAppNumber): a public form can fill Contact.phone, and the share
 * carries the document's bearer link. So a contact created with only a phone
 * (an owner POST, the composer's quick-add, a CSV import) got WhatsApp's
 * chooser, which leaves journeys D3 and E6 short of D-153.
 *
 * The containment stays, and the gap closes with one confirm step. Pinned here
 * (the helper; the screens are pinned by their own tests):
 *   - whatsAppShareNumber(contact, country): the number a document share may
 *     open is the saved WhatsApp number ('saved'); with none saved and a phone
 *     that reads as E.164 under the business's country, the share asks the
 *     member to confirm that reading ('confirm', with the phone as stored and
 *     its E.164 reading); otherwise WhatsApp's chooser ('none'). A phone the
 *     helper cannot read (an unknown country, too short) is never offered;
 *   - readWhatsAppShareNumber(businessId, contactId, country): the same, read
 *     by id through the member's own contact read at share time (a refused
 *     read is 'none');
 *   - saveWhatsAppNumber(businessId, contactId, e164): the confirmation saves
 *     the number as the contact's WhatsApp number through the existing contact
 *     update route (PATCH /crm/businesses/:id/contacts/:contactId with
 *     { whatsappNumber } and nothing else). The member's own crm write is
 *     checked by the server; a refusal comes back in plain words, never as
 *     the guard's internal sentence alone.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { whatsAppShareNumber, readWhatsAppShareNumber, saveWhatsAppNumber } from "../whatsapp";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Call = { method: string; path: string; body: unknown };

/** The network edge: the member's contact read and the contact update, answered as given. */
function serve(answers: {
  read?: { status: number; contact?: Record<string, unknown> | null };
  patch?: { status: number; body: unknown };
}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      let status = 404;
      let body: unknown = { message: "Not found" };
      if (method === "GET" && answers.read) {
        status = answers.read.status;
        body = status === 200 ? { contact: answers.read.contact ?? null, events: [], notes: [], tasks: [] } : { message: "Contact not found" };
      } else if (method === "PATCH" && answers.patch) {
        status = answers.patch.status;
        body = answers.patch.body;
      }
      const text = JSON.stringify(body);
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? "OK" : "Error",
        json: async () => JSON.parse(text) as unknown,
        text: async () => text,
        headers: new Headers({ "content-type": "application/json" }),
      } as unknown as Response;
    }),
  );
  return calls;
}

describe("whatsAppShareNumber: saved, confirm once, or the chooser", () => {
  it("a saved WhatsApp number is used as saved (no confirm step)", () => {
    expect(whatsAppShareNumber({ whatsappNumber: "868-755-0199", phone: "755-0123" }, null)).toEqual({ kind: "saved", number: "868-755-0199" });
  });

  it.each(["755-0123", "868-755-0123", "(868) 755-0123", "+1 868 755 0123", "+18687550123"])(
    "a phone %j and no WhatsApp number: the confirm step with its E.164 reading +18687550123",
    (phone) => {
      expect(whatsAppShareNumber({ firstName: "Maria", lastName: "Lee", phone, whatsappNumber: null }, null)).toEqual({
        kind: "confirm",
        phone,
        e164: "+18687550123",
        name: "Maria Lee",
      });
    },
  );

  it("the reading uses the business's own country", () => {
    expect(whatsAppShareNumber({ phone: "555-0123", whatsappNumber: "  " }, "Jamaica")).toMatchObject({ kind: "confirm", e164: "+18765550123" });
    expect(whatsAppShareNumber({ phone: "07700 900123" }, "United Kingdom")).toMatchObject({ kind: "confirm", e164: "+447700900123" });
  });

  it("a phone the helper cannot read is never offered: the chooser (an unknown country, too short, no digits)", () => {
    expect(whatsAppShareNumber({ phone: "456-1234" }, "Other Caribbean")).toEqual({ kind: "none" });
    expect(whatsAppShareNumber({ phone: "755-012" }, null)).toEqual({ kind: "none" });
    expect(whatsAppShareNumber({ phone: "ask at the counter" }, null)).toEqual({ kind: "none" });
  });

  it("no number at all, or no contact: the chooser", () => {
    expect(whatsAppShareNumber({ phone: null, whatsappNumber: null }, null)).toEqual({ kind: "none" });
    expect(whatsAppShareNumber({}, null)).toEqual({ kind: "none" });
    expect(whatsAppShareNumber(null, null)).toEqual({ kind: "none" });
  });

  it("a contact with no name is still offered (the step then says 'this customer')", () => {
    expect(whatsAppShareNumber({ phone: "755-0123" }, null)).toEqual({ kind: "confirm", phone: "755-0123", e164: "+18687550123", name: null });
  });
});

describe("readWhatsAppShareNumber: read by id at share time, through the member's own contact read", () => {
  it("a phone-only customer: the confirm step", async () => {
    const calls = serve({ read: { status: 200, contact: { id: "ct_maria", firstName: "Maria", phone: "755-0123", whatsappNumber: null } } });
    await expect(readWhatsAppShareNumber("biz_wa", "ct_maria", null)).resolves.toEqual({
      kind: "confirm",
      phone: "755-0123",
      e164: "+18687550123",
      name: "Maria",
    });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /crm/businesses/biz_wa/contacts/ct_maria"]);
  });

  it("a saved number: used", async () => {
    serve({ read: { status: 200, contact: { id: "ct_maria", phone: "755-0123", whatsappNumber: "+18687550177" } } });
    await expect(readWhatsAppShareNumber("biz_wa", "ct_maria", null)).resolves.toEqual({ kind: "saved", number: "+18687550177" });
  });

  it("a refused read, or no ids: the chooser", async () => {
    serve({ read: { status: 404 } });
    await expect(readWhatsAppShareNumber("biz_wa", "ct_hidden", null)).resolves.toEqual({ kind: "none" });
    await expect(readWhatsAppShareNumber(null, "ct_x", null)).resolves.toEqual({ kind: "none" });
    await expect(readWhatsAppShareNumber("biz_wa", null, null)).resolves.toEqual({ kind: "none" });
  });
});

describe("saveWhatsAppNumber: the confirmation saves through the contact update route", () => {
  it("sends the WhatsApp number alone to PATCH .../contacts/:contactId and answers the number the server stored", async () => {
    const calls = serve({ patch: { status: 200, body: { id: "ct_maria", phone: "755-0123", whatsappNumber: "+18687550123" } } });
    await expect(saveWhatsAppNumber("biz_wa", "ct_maria", "+18687550123")).resolves.toEqual({ ok: true, number: "+18687550123" });
    expect(calls).toEqual([{ method: "PATCH", path: "/crm/businesses/biz_wa/contacts/ct_maria", body: { whatsappNumber: "+18687550123" } }]);
  });

  it("a member without crm write: refused, in plain words that say what to do next", async () => {
    serve({ patch: { status: 403, body: { statusCode: 403, message: "Insufficient permissions: crm requires write access (you have read)" } } });
    const result = await saveWhatsAppNumber("biz_wa", "ct_maria", "+18687550123");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.permission).toBe(true);
    expect(result.refusal).toMatch(/can't save/i);
    expect(result.refusal).toMatch(/WhatsApp number/);
    expect(result.refusal).toMatch(/share without a number/i);
    // Plain words: not the guard's internal module name and levels.
    expect(result.refusal).not.toMatch(/Insufficient permissions|crm requires|you have read/);
  });

  it("a member who may not edit this customer: refused with the server's own words", async () => {
    serve({ patch: { status: 403, body: { statusCode: 403, message: "You can only edit contacts you own" } } });
    const result = await saveWhatsAppNumber("biz_wa", "ct_tom", "+18687550167");
    expect(result).toMatchObject({ ok: false, permission: true });
    if (!result.ok) expect(result.refusal).toContain("You can only edit contacts you own");
  });

  it("any other failure is said, and may be tried again", async () => {
    serve({ patch: { status: 500, body: { statusCode: 500, message: "Internal server error" } } });
    const result = await saveWhatsAppNumber("biz_wa", "ct_maria", "+18687550123");
    expect(result).toMatchObject({ ok: false, permission: false });
    if (!result.ok) expect(result.refusal).toMatch(/not saved/i);
  });

  it("no ids: nothing is sent", async () => {
    const calls = serve({});
    await expect(saveWhatsAppNumber(null, "ct_x", "+18687550123")).resolves.toMatchObject({ ok: false });
    await expect(saveWhatsAppNumber("biz_wa", null, "+18687550123")).resolves.toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });
});
