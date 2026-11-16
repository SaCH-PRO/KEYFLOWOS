/**
 * WA-HELPER (V1, whatsapp ruling D-153: outbound WhatsApp is a wa.me link to
 * the customer's own number with the document's tokenized link).
 *
 * Before this packet lib/whatsapp.ts prefixed 1868 to anything that did not
 * start with 1 and had at most 10 digits, so a TT number typed '868-755-0123'
 * became wa.me/18688687550123 (a dead chat), and only a few screens used it:
 * twenty more files built wa.me links by hand in three ways (the digits as
 * typed, digits with a '+' left in the path, or no number at all). The booking
 * drawer turned '755-0123' into wa.me/7550123 and '868-755-0123' into
 * wa.me/8687550123, both dead.
 *
 * Contract pinned here:
 *   - toE164(phone, businessCountry) reads TT, US and other spellings of one
 *     number as the same E.164 number, using the business's country (default
 *     Trinidad and Tobago, +1 868) for a local number, and answers null for a
 *     number it cannot read;
 *   - buildWhatsAppLink({ to, text, link, country }) opens a chat with that
 *     number, the text prefilled and the tokenized link after it; with no
 *     readable number it opens WhatsApp's own chooser with the same text;
 *   - the positional form buildWhatsAppLink(phone, message) the contact
 *     screens use reads the number the same way;
 *   - ownBusinessCountry() is the signed-in business's country (the workspace
 *     cache), for owner screens;
 *   - repair (review of 087b0365): a business whose country the helper does
 *     not know ('Other Caribbean', 'Other' from the onboarding profile card)
 *     is not read as Trinidad and Tobago: only a number written
 *     internationally is readable there (SEC-WAH-2); an international number
 *     typed without its '+' (11 digits not starting with 1) is kept in a NANP
 *     country, as before the packet (WAH-CR-2); a quote or invoice share,
 *     which carries the document's bearer link, opens only the WhatsApp number
 *     the business saved on the contact, read by id at share time
 *     (SEC-WAH-1, WAH-CR-1); and owner screens pass the business's country,
 *     the positional form being left to the customer pages (WAH-CR-5);
 *   - census: no file under apps/web/src outside lib/whatsapp.ts builds a
 *     WhatsApp URL itself (wa.me/, api.whatsapp.com/send, web.whatsapp.com/send,
 *     whatsapp://send), except the two surfaces v1 does not edit, each listed
 *     with its reason.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildWhatsAppLink, toE164, ownBusinessCountry, getContactPhone, savedWhatsAppNumber, readSavedWhatsAppNumber } from "../whatsapp";
import { setCachedBusiness } from "../workspace";

/** The chat number of a wa.me link (its path digits), and its prefilled text. */
function chat(url: string): { number: string; text: string | null } {
  const u = new URL(url);
  expect(u.origin).toBe("https://wa.me");
  return { number: u.pathname.replace(/^\//, ""), text: u.searchParams.get("text") };
}

describe("toE164: one number, every spelling", () => {
  // A Trinidad and Tobago mobile number (7xx-xxxx), as owners and customers type it.
  const TT = "+18687550123";

  it.each([
    "755-0123",
    "7550123",
    "755 0123",
    "868-755-0123",
    "(868) 755-0123",
    "868 755 0123",
    "8687550123",
    "1-868-755-0123",
    "1 (868) 755-0123",
    "18687550123",
    "+1 868 755 0123",
    "+1 (868) 755-0123",
    "+1-868-755-0123",
    "+18687550123",
    "  +1 868 755 0123  ",
  ])("a TT business reads %j as +1 868 755 0123", (typed) => {
    expect(toE164(typed)).toBe(TT);
    expect(toE164(typed, "TT")).toBe(TT);
    expect(toE164(typed, "Trinidad and Tobago")).toBe(TT);
    expect(toE164(typed, "trinidad & tobago")).toBe(TT);
    expect(toE164(typed, "Trinidad")).toBe(TT);
    expect(toE164(typed, null)).toBe(TT);
    expect(toE164(typed, "")).toBe(TT);
  });

  // SEC-WAH-2 (RED at 087b0365: an unknown country fell back to Trinidad and
  // Tobago, so a St Lucian '456-1234' became +1 868 456 1234 and an Italian
  // '312 345 6789' a Chicago number, each a stranger's chat that a quote or
  // invoice share prefilled with its bearer link).
  it.each(["Other Caribbean", "Other", "other", "Atlantis"])(
    "a business in %j (a country the helper does not know) is not read as TT: a local or national number is unreadable",
    (country) => {
      expect(toE164("456-1234", country)).toBeNull();
      expect(toE164("755-0123", country)).toBeNull();
      expect(toE164("312 345 6789", country)).toBeNull();
      expect(toE164("868-755-0123", country)).toBeNull();
      expect(toE164("1 868 755 0123", country)).toBeNull();
      expect(toE164("07700 900123", country)).toBeNull();
    },
  );

  it.each(["Other Caribbean", "Other", "Atlantis"])(
    "a business in %j still reads a number written internationally ('+' or 00)",
    (country) => {
      expect(toE164("+39 312 345 6789", country)).toBe("+393123456789");
      expect(toE164("0039 312 345 6789", country)).toBe("+393123456789");
      expect(toE164("+1 758 456 1234", country)).toBe("+17584561234");
      expect(toE164("+44 (0)7700 900123", country)).toBe("+447700900123");
    },
  );

  it("no country at all is still the default market (TT, +1 868)", () => {
    expect(toE164("755-0123", null)).toBe(TT);
    expect(toE164("755-0123", undefined)).toBe(TT);
    expect(toE164("755-0123", "  ")).toBe(TT);
  });

  it.each(["(212) 555-0123", "212-555-0123", "212 555 0123", "1 212 555 0123", "+1 212-555-0123", "+12125550123"])(
    "a US business reads %j as +1 212 555 0123, and so does a TT business (ten digits carry their own area code)",
    (typed) => {
      expect(toE164(typed, "US")).toBe("+12125550123");
      expect(toE164(typed, "United States")).toBe("+12125550123");
      expect(toE164(typed, "USA")).toBe("+12125550123");
      expect(toE164(typed)).toBe("+12125550123");
    },
  );

  // WAH-CR-2 (RED at 087b0365: in a NANP country only more than 11 digits
  // were kept without a '+', so a French, Spanish or Dutch mobile (33/34/31 +
  // 9 digits), a Panamanian, Costa Rican or Haitian number (507/506/509 + 8),
  // a Curacao number (5999 + 7), an Australian or South African mobile, typed
  // without its '+', opened the chooser; before the packet they opened their
  // chat). NANP has no 11-digit number that does not start with 1.
  it.each([
    ["33612345678", "+33612345678"],
    ["34612345678", "+34612345678"],
    ["31612345678", "+31612345678"],
    ["50761234567", "+50761234567"],
    ["50683123456", "+50683123456"],
    ["50934123456", "+50934123456"],
    ["59997654321", "+59997654321"],
    ["61412345678", "+61412345678"],
    ["27821234567", "+27821234567"],
    ["33 6 12 34 56 78", "+33612345678"],
  ])("an international number typed without its '+' (%j, 11 digits not starting with 1) is kept: %s", (typed, e164) => {
    expect(toE164(typed)).toBe(e164);
    expect(toE164(typed, "TT")).toBe(e164);
    expect(toE164(typed, "United States")).toBe(e164);
    expect(toE164(typed, "Jamaica")).toBe(e164);
  });

  it("an 11-digit number starting with 0 is a national number of another country, not one this business can read", () => {
    expect(toE164("07700900123")).toBeNull();
    expect(toE164("07700900123", "US")).toBeNull();
  });

  it("a US business cannot read a seven-digit number (no area code), where a TT one can", () => {
    expect(toE164("555-0123", "US")).toBeNull();
    expect(toE164("555-0123", "TT")).toBe("+18685550123");
  });

  it("other Caribbean NANP countries add their own area code to a seven-digit number", () => {
    expect(toE164("555-0123", "Jamaica")).toBe("+18765550123");
    expect(toE164("555-0123", "JM")).toBe("+18765550123");
    expect(toE164("555-0123", "Barbados")).toBe("+12465550123");
    expect(toE164("876-555-0123", "Jamaica")).toBe("+18765550123");
  });

  it.each([
    ["07700 900123", "United Kingdom"],
    ["07700900123", "UK"],
    ["7700 900123", "GB"],
    ["+44 7700 900123", "GB"],
    ["+44 (0)7700 900123", "GB"],
    ["0044 7700 900123", "GB"],
    ["+44 7700 900123", "TT"],
    ["0044 7700 900123", "TT"],
  ])("other countries: %j (business in %s) is +44 7700 900123", (typed, country) => {
    expect(toE164(typed, country)).toBe("+447700900123");
  });

  it("a country without a trunk prefix adds its calling code", () => {
    expect(toE164("600 1234", "Guyana")).toBe("+5926001234");
    expect(toE164("+592 600 1234", "TT")).toBe("+5926001234");
  });

  it("outside NANP a national number is told from one carrying its country code by its length, not its first digits", () => {
    // An Indian mobile can start with 91, the calling code: ten digits are still national.
    expect(toE164("91234 56789", "India")).toBe("+919123456789");
    expect(toE164("091234 56789", "India")).toBe("+919123456789");
    expect(toE164("91 91234 56789", "India")).toBe("+919123456789");
    // A Guyanese number typed with its calling code and no '+'.
    expect(toE164("592 600 1234", "Guyana")).toBe("+5926001234");
    // A customer abroad typed in full without the '+': kept, not given a second calling code.
    expect(toE164("1 868 755 0123", "United Kingdom")).toBe("+18687550123");
    // A trunk 0 in front of a number too long to be national is not a number.
    expect(toE164("0 1868 755 0123 45", "United Kingdom")).toBeNull();
  });

  it.each([undefined, null, "", "   ", "abc", "ext.", "12345", "755-012", "+12", "+1 234 567 890 123 456"])(
    "%j is not a number it can read: null",
    (typed) => {
      expect(toE164(typed as string | null | undefined)).toBeNull();
    },
  );
});

describe("buildWhatsAppLink: a chat with the customer's own number, the text and the tokenized link", () => {
  const LINK = "https://app.keyflow.test/public/invoice/tok_wa_helper_0001";

  it("'755-0123' and '868-755-0123' open the same live chat (RED before WA-HELPER: one was dead)", () => {
    const short = chat(buildWhatsAppLink({ to: "755-0123" }));
    const long = chat(buildWhatsAppLink({ to: "868-755-0123" }));
    expect(short.number).toBe("18687550123");
    expect(long.number).toBe("18687550123");
    expect(short.text).toBeNull();
  });

  it("the text is prefilled and the link follows it after one space, so the message reads as one line", () => {
    const url = buildWhatsAppLink({ to: "+1 868 755 0123", text: "Hi Rena, here is your invoice INV-0001. You can view and pay it here:", link: LINK });
    expect(chat(url)).toEqual({
      number: "18687550123",
      text: `Hi Rena, here is your invoice INV-0001. You can view and pay it here: ${LINK}`,
    });
  });

  it("text that already ends in a line break keeps it: the link starts the next line", () => {
    const url = buildWhatsAppLink({ text: "Our new menu\n\n", link: LINK });
    expect(chat(url).text).toBe(`Our new menu\n\n${LINK}`);
  });

  it("a link alone is the whole message", () => {
    expect(chat(buildWhatsAppLink({ to: "755-0123", link: LINK })).text).toBe(LINK);
  });

  it("the message is encoded once (no raw spaces, no double encoding)", () => {
    const url = buildWhatsAppLink({ to: "755-0123", text: "Hi, I have a question about my order & total 50%" });
    expect(url).toBe("https://wa.me/18687550123?text=Hi%2C%20I%20have%20a%20question%20about%20my%20order%20%26%20total%2050%25");
  });

  it("no number: WhatsApp's own chooser with the same message", () => {
    expect(buildWhatsAppLink({ text: "Check out our store:", link: "https://app.keyflow.test/book/sweet-treats" })).toBe(
      `https://wa.me/?text=${encodeURIComponent("Check out our store: https://app.keyflow.test/book/sweet-treats")}`,
    );
    expect(buildWhatsAppLink({ to: null, text: "Hi" })).toBe("https://wa.me/?text=Hi");
  });

  it("a number it cannot read never becomes a dead chat: the chooser opens instead", () => {
    expect(buildWhatsAppLink({ to: "12345", text: "Hi" })).toBe("https://wa.me/?text=Hi");
    expect(buildWhatsAppLink({ to: "call reception", text: "Hi" })).toBe("https://wa.me/?text=Hi");
  });

  it("the business's country decides a local number", () => {
    expect(chat(buildWhatsAppLink({ to: "07700 900123", country: "United Kingdom" })).number).toBe("447700900123");
    expect(chat(buildWhatsAppLink({ to: "555-0123", country: "Jamaica" })).number).toBe("18765550123");
  });

  it("the positional form (phone, message) reads the number the same way (RED before WA-HELPER: 868-755-0123 became 1868 868 755 0123)", () => {
    expect(buildWhatsAppLink("868-755-0123")).toBe("https://wa.me/18687550123");
    expect(buildWhatsAppLink("755-0123", "Hi there")).toBe("https://wa.me/18687550123?text=Hi%20there");
    expect(buildWhatsAppLink("+1 868 755 0123", "Hi")).toBe("https://wa.me/18687550123?text=Hi");
    expect(buildWhatsAppLink("+44 7700 900123")).toBe("https://wa.me/447700900123");
  });

  it("an international number stored without its '+' opens its chat from the positional and the object form (WAH-CR-2)", () => {
    // The contact card's positional call and the booking drawer's object call, on numbers saved as typed.
    expect(buildWhatsAppLink("33612345678", "Hi Ana, ")).toBe("https://wa.me/33612345678?text=Hi%20Ana%2C%20");
    expect(buildWhatsAppLink({ to: "50761234567", country: null })).toBe("https://wa.me/50761234567");
  });

  it("a business in 'Other Caribbean' sharing an invoice with a local number gets WhatsApp's chooser, never a Trinidad chat (SEC-WAH-2)", () => {
    const LINK_TOKEN = "https://app.keyflow.test/public/invoice/tok_wa_helper_0002";
    expect(buildWhatsAppLink({ to: "456-1234", text: "Your invoice:", link: LINK_TOKEN, country: "Other Caribbean" })).toBe(
      `https://wa.me/?text=${encodeURIComponent(`Your invoice: ${LINK_TOKEN}`)}`,
    );
    expect(buildWhatsAppLink({ to: "312 345 6789", text: "Your invoice:", link: LINK_TOKEN, country: "Other" })).toBe(
      `https://wa.me/?text=${encodeURIComponent(`Your invoice: ${LINK_TOKEN}`)}`,
    );
  });

  it("getContactPhone still prefers the WhatsApp number over the phone", () => {
    expect(getContactPhone({ whatsappNumber: "755-0199", phone: "755-0123" })).toBe("755-0199");
    expect(getContactPhone({ whatsappNumber: null, phone: "755-0123" })).toBe("755-0123");
    expect(getContactPhone({})).toBeNull();
  });
});

// SEC-WAH-1 / WAH-CR-1: the number a quote or invoice share may open.
describe("savedWhatsAppNumber / readSavedWhatsAppNumber: a document share opens only the WhatsApp number the business saved", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is the contact's WhatsApp number; a phone alone (a public form can fill it on an existing contact) is not", () => {
    expect(savedWhatsAppNumber({ whatsappNumber: "868-755-0199", phone: "755-0123" })).toBe("868-755-0199");
    expect(savedWhatsAppNumber({ whatsappNumber: null, phone: "+1 868 555 0199" })).toBeNull();
    expect(savedWhatsAppNumber({ whatsappNumber: "   ", phone: "+1 868 555 0199" })).toBeNull();
    expect(savedWhatsAppNumber({})).toBeNull();
    expect(savedWhatsAppNumber(null)).toBeNull();
  });

  function serveContact(status: number, contact: Record<string, unknown> | null) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
        calls.push(url.pathname);
        const body = status === 200 ? { contact, events: [], notes: [], tasks: [] } : { message: "Contact not found" };
        const text = JSON.stringify(body);
        return {
          ok: status >= 200 && status < 300,
          status,
          statusText: status === 200 ? "OK" : "Not Found",
          json: async () => JSON.parse(text) as unknown,
          text: async () => text,
          headers: new Headers({ "content-type": "application/json" }),
        } as unknown as Response;
      }),
    );
    return calls;
  }

  it("reads the customer by id through the member's own contact read, not the list a screen loaded", async () => {
    const calls = serveContact(200, { id: "ct_old", firstName: "Oldest", phone: "755-0123", whatsappNumber: "868-755-0123" });
    await expect(readSavedWhatsAppNumber("biz_wa", "ct_old")).resolves.toBe("868-755-0123");
    expect(calls).toEqual(["/crm/businesses/biz_wa/contacts/ct_old"]);
  });

  it("a contact with a phone only, a refused read, or no ids: no number (WhatsApp's chooser)", async () => {
    serveContact(200, { id: "ct_victim", firstName: "Vera", phone: "+1 868 555 0199", whatsappNumber: null });
    await expect(readSavedWhatsAppNumber("biz_wa", "ct_victim")).resolves.toBeNull();
    serveContact(404, null);
    await expect(readSavedWhatsAppNumber("biz_wa", "ct_hidden")).resolves.toBeNull();
    await expect(readSavedWhatsAppNumber(null, "ct_x")).resolves.toBeNull();
    await expect(readSavedWhatsAppNumber("biz_wa", null)).resolves.toBeNull();
  });
});

describe("ownBusinessCountry: the signed-in business's country, for owner screens", () => {
  afterEach(() => {
    setCachedBusiness({ id: "biz_wa_helper", name: "Sweet Treats" });
  });

  it("is the workspace's cached business country, or null", () => {
    setCachedBusiness({ id: "biz_wa_helper", name: "Sweet Treats", country: "United Kingdom" } as Parameters<typeof setCachedBusiness>[0]);
    expect(ownBusinessCountry()).toBe("United Kingdom");
    expect(toE164("07700 900123", ownBusinessCountry())).toBe("+447700900123");
    setCachedBusiness({ id: "biz_wa_helper", name: "Sweet Treats" });
    expect(ownBusinessCountry()).toBeNull();
    expect(toE164("755-0123", ownBusinessCountry())).toBe("+18687550123");
  });
});

// ── Census ──────────────────────────────────────────────────────────────────

const WEB_SRC = path.join(__dirname, "..", "..");
const HELPER = "lib/whatsapp.ts";
/** Every way a page could build a WhatsApp chat URL itself. */
const WHATSAPP_URL = /wa\.me\/|api\.whatsapp\.com\/send|web\.whatsapp\.com\/send|whatsapp:\/\/send/;
/** Surfaces v1 does not edit, each with the reason (the WA-HELPER packet's scope). */
const EXEMPT: Array<{ prefix: string; reason: string }> = [
  { prefix: "app/me/refer/", reason: "/me/refer is deferred to V1.3 and hidden by NAV-B-HIDE; not edited in v1" },
  { prefix: "app/site/_components/", reason: "/site/<slug> redirects to /book/<slug> (CUSTOMER-PAGE-HONESTY); not edited in v1" },
];
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** Every source file under apps/web/src (tests excluded: they read the URLs pages build), relative, with "/" separators. */
function sourceFiles(dir = WEB_SRC): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      out.push(...sourceFiles(full));
    } else if (SOURCE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      out.push(path.relative(WEB_SRC, full).split(path.sep).join("/"));
    }
  }
  return out;
}

describe("census: every WhatsApp link goes through lib/whatsapp.ts", () => {
  const files = sourceFiles();
  const building = files.filter((f) => WHATSAPP_URL.test(fs.readFileSync(path.join(WEB_SRC, f), "utf8")));

  it("the scan reads the source tree and finds the helper itself", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(building).toContain(HELPER);
  });

  it("no other file builds a wa.me (or other WhatsApp) URL by hand", () => {
    const offenders = building.filter((f) => f !== HELPER && !EXEMPT.some((e) => f.startsWith(e.prefix)));
    expect(offenders, "build the link with buildWhatsAppLink from @/lib/whatsapp").toEqual([]);
  });

  it("each exemption names its reason", () => {
    for (const e of EXEMPT) expect(e.reason.length).toBeGreaterThan(20);
  });
});

/**
 * The customer pages that read a business's number with the default market:
 * they must never read the visitor's own workspace (ownBusinessCountry), and
 * their payloads are edited by CUSTOMER-PAGE-HONESTY, not here.
 */
const POSITIONAL_ALLOWED = ["app/order/[token]/page.tsx", "components/ui/public-page-state.tsx"];
/** buildWhatsAppLink called with a phone first (the positional form), not an object. */
const POSITIONAL_CALL = /buildWhatsAppLink\(\s*[^\s{)]/;

// WAH-CR-5 (RED at 087b0365: the booking list, contact card, contact header,
// notes, tasks and timeline tabs, broadcast, insight card and recommendations
// read a customer's number as TT while the booking drawer of the same
// booking read it with the business's own country).
describe("census: owner screens read a customer's number with the business's own country", () => {
  const files = sourceFiles().filter((f) => f !== HELPER);
  const positional = files.filter((f) => POSITIONAL_CALL.test(fs.readFileSync(path.join(WEB_SRC, f), "utf8")));

  it("the positional form (which takes no country) is left to the customer pages", () => {
    expect(positional.sort(), "owner screens call buildWhatsAppLink({ to, text, country: ownBusinessCountry() })").toEqual(
      [...POSITIONAL_ALLOWED].sort(),
    );
  });
});
