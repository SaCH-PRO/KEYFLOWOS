/**
 * GATE-JOURNEYS-G-L review repair: the journey specs G to L test what their
 * definitions of done say, and nothing a correct build cannot pass.
 *
 * Two kinds of case, as in journey-specs-a-f.test.ts:
 *   - the specs' readers, with no Playwright runtime
 *     (e2e/journeys/journey-text.ts): what a role preset grants (J2), KEY's
 *     reply and what it may not name (K5), the accountant export's answers
 *     (H9), the Today row's own action (I3, a DOM walk run here in jsdom),
 *     the money a member's Today read may not carry (I6), and whether a page's
 *     answer forbids another site to frame it (G9);
 *   - each repaired step, pinned in its spec's source, so a later edit cannot
 *     quietly undo it.
 *
 * Findings (blocking): SEC-GL-1 (J2 passed any preset that was not OWNER),
 * SEC-GL-2 (K5's member leg passed on no answer, an error, or any leak but
 * '600'), COR-GL-1 (H9 read the ZIP without its period, refused the CI mail
 * answer, and required an address only a sent email saves), COR-GL-2 (H6 read
 * a voided expense through a read that hides it), COR-GL-3 (I3 marked the
 * customer's name as another row's, so every row naming the customer failed),
 * COR-GL-4 (H7b's recurring expense had no name), COR-GL-5 (H9b sent no
 * period and PATCHed a field identity drops). Minor: SEC-GL-3 (K5's owner leg
 * never looked for another business's debtor), SEC-GL-4 (G9 judged framing by
 * absent text 3 s in), SEC-GL-5 (I6 never read the member's Today answer),
 * SEC-GL-6 (J6 never looked for the owner's expense), SEC-GL-7 (J7 never
 * created an API key as staff, and seeded no secret), COR-GL-6 (I4 compared
 * neither 'you owe' nor 'safe to spend'), COR-GL-7 (J1 and G3 checked the
 * refusal at the API only, never on the screen).
 *
 * journey-text.ts is loaded per test, so a missing reader fails the cases
 * that need it and not the file.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type JourneyText = typeof import("../../e2e/journeys/journey-text");

const WEB = path.resolve(__dirname, "../..");
const JOURNEYS = path.join(WEB, "e2e/journeys");
const TEXT_MODULE = path.join(JOURNEYS, "journey-text.ts");

async function journeyText(): Promise<JourneyText> {
  return (await import(/* @vite-ignore */ TEXT_MODULE)) as JourneyText;
}

/** A reader journey-text.ts must export; a missing one fails here, by name. */
async function reader<K extends keyof JourneyText>(name: K): Promise<JourneyText[K]> {
  const t = await journeyText();
  expect(typeof t[name], `journey-text.ts exports ${String(name)}`).toBe("function");
  return t[name];
}

const source = (file: string) => fs.readFileSync(path.join(JOURNEYS, file), "utf8");

/** The source of one test, by the id its title starts with ("J2", "H9b"), to the next test or the end of the file. */
function testBlock(file: string, id: string): string {
  const src = source(file);
  const start = src.indexOf(`test("${id} `);
  expect(start, `${file} has a test "${id} ..."`).toBeGreaterThanOrEqual(0);
  const next = src.slice(start + 1).search(/\n\s*test\(\s*"/);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

// ── J2: each preset grants its own scope set (SEC-GL-1) ─────────────────

describe("presetFindings: what a role preset's invite really granted (J2)", () => {
  // ROLE_DEFAULT_SCOPES (apps/server/src/core/authority/module-vocabulary.ts), written out as the
  // team read answers them (IdentityService.resolveScopes): what an invite with no scope map stores.
  const MODULES = ["crm", "revenue", "bookings", "projects", "content", "expenses", "automations", "storefront", "settings", "ai", "team", "analytics", "operations", "connect"];
  const defaults = (level: (m: string) => string) => Object.fromEntries(MODULES.map((m) => [m, m === "connect" ? "none" : level(m)]));
  const ADMIN_DEFAULTS = defaults((m) => (m === "team" ? "write" : "admin"));
  const STAFF_DEFAULTS = defaults((m) => (["settings", "team", "ai"].includes(m) ? "none" : "read"));

  it("Front desk: STAFF with bookings and customers, and no money, settings or team; ADMIN or the STAFF defaults fail", async () => {
    const t = await journeyText();
    const presetFindings = await reader("presetFindings");
    const frontDesk = t.ROLE_PRESETS["Front desk"];
    // The review's three rows (scratchpad/revgl-sec/predicates.mjs): J2 passed all three.
    expect(presetFindings({ role: "ADMIN", permissionScopes: ADMIN_DEFAULTS }, frontDesk).length).toBeGreaterThan(0);
    const staffDefaults = presetFindings({ role: "STAFF", permissionScopes: STAFF_DEFAULTS }, frontDesk);
    expect(staffDefaults.join(" | ")).toMatch(/revenue/);
    expect(staffDefaults.join(" | ")).toMatch(/expenses/);
    expect(presetFindings({ role: "STAFF", permissionScopes: { bookings: "write", crm: "read" } }, frontDesk)).toEqual([]);
    // A module an explicit map leaves out is none (EXPLICIT_MAP_MISSING_KEY); a front desk without bookings fails.
    expect(presetFindings({ role: "STAFF", permissionScopes: { crm: "read" } }, frontDesk).join(" | ")).toMatch(/bookings/);
    expect(presetFindings({ role: "STAFF", permissionScopes: null }, frontDesk).length).toBeGreaterThan(0);
  });

  it("Bookkeeper: STAFF with money read, and no settings or team; Admin: ADMIN with settings admin and team write", async () => {
    const t = await journeyText();
    const presetFindings = await reader("presetFindings");
    const bookkeeper = t.ROLE_PRESETS.Bookkeeper;
    const admin = t.ROLE_PRESETS.Admin;
    expect(presetFindings({ role: "STAFF", permissionScopes: { revenue: "write", expenses: "write", crm: "read" } }, bookkeeper)).toEqual([]);
    expect(presetFindings({ role: "STAFF", permissionScopes: { bookings: "write", crm: "read" } }, bookkeeper).join(" | ")).toMatch(/revenue/);
    expect(presetFindings({ role: "STAFF", permissionScopes: { revenue: "read", expenses: "read", settings: "admin" } }, bookkeeper).join(" | ")).toMatch(/settings/);
    expect(presetFindings({ role: "ADMIN", permissionScopes: ADMIN_DEFAULTS }, bookkeeper).join(" | ")).toMatch(/role/);
    expect(presetFindings({ role: "ADMIN", permissionScopes: ADMIN_DEFAULTS }, admin)).toEqual([]);
    expect(presetFindings({ role: "STAFF", permissionScopes: STAFF_DEFAULTS }, admin).length).toBeGreaterThan(0);
    expect(presetFindings({ role: "ADMIN", permissionScopes: { ...ADMIN_DEFAULTS, settings: "read" } }, admin).join(" | ")).toMatch(/settings/);
  });

  it("J2 sends all three presets and judges each row with presetFindings, not 'is not the owner'", () => {
    const j2 = testBlock("j-team.spec.ts", "J2");
    expect(j2, "the old check could not fail (the API never stores an OWNER invite)").not.toMatch(/not\.toBe\("OWNER"\)/);
    expect(j2).toContain("presetFindings(");
    expect(j2).toContain("ROLE_PRESETS[");
    for (const preset of ["Front desk", "Bookkeeper", "Admin"]) expect(j2, `J2 sends the ${preset} preset`).toContain(`"${preset}"`);
    expect(j2, "each preset is picked on the invite form").toMatch(/pickRole\(await inviteForm\(page\), pick\)/);
  });
});

// ── K5: KEY's answer to a member without revenue read (SEC-GL-2, SEC-GL-3) ──

describe("K5 reads KEY's reply, and judges the member's by refusal and by what it names", () => {
  const SEEDED = { names: ["Owesab12c3"], invoiceNumbers: ["INV-0001"], amounts: [1000, 400, 600] };
  // The review's six answers (scratchpad/revgl-sec/predicates.mjs), as the drawer shows them after the question.
  const ANSWERS: Record<string, { drawer: string; pass: boolean }> = {
    "KEY lists the debt as invoiced/paid figures": { drawer: "KEY\nWho owes me?\nMaria Owesab12c3 has invoice INV-0001 for TTD 1,000.00; TTD 400.00 has been paid.", pass: false },
    "KEY names the debtor and the amount in words": { drawer: "KEY\nWho owes me?\nMaria Owesab12c3 still owes you six hundred dollars.", pass: false },
    "no answer within the wait": { drawer: "KEY\nWho owes me?", pass: false },
    "KEY failed outright": { drawer: "KEY\nWho owes me?\nSomething went wrong. Try again.", pass: false },
    "KEY refused (the correct build)": { drawer: "KEY\nWho owes me?\n10:42 AM\nYou don’t have access to money. Ask the owner.\n10:42 AM", pass: true },
    "KEY leaks the exact figure": { drawer: "KEY\nWho owes me?\nMaria Owesab12c3 owes TTD 600.00.", pass: false },
  };

  it("the member leg passes only KEY's refusal, of the review's six answers", async () => {
    const t = await journeyText();
    const replyLines = await reader("replyLines");
    const isRefusal = await reader("isRefusal");
    const answerLeaks = await reader("answerLeaks");
    for (const [what, { drawer, pass }] of Object.entries(ANSWERS)) {
      const reply = replyLines("KEY\nAsk me anything", drawer, "Who owes me?");
      const passes = reply !== "" && isRefusal(reply) && answerLeaks(reply, SEEDED).length === 0;
      expect(passes, `${what}: reply '${reply}'`).toBe(pass);
    }
    expect(t.answerLeaks("Maria Owesab12c3 still owes you six hundred dollars.", { amounts: [600] }), "an amount in words").toEqual(["amount 600"]);
  });

  it("replyLines keeps only what came after the question: an earlier exchange in the drawer, the question and the times are not the reply", async () => {
    const replyLines = await reader("replyLines");
    const before = "KEY\nWhat's on today?\nNothing booked today.\n9:01 AM";
    const after = `${before}\nWho owes me?\n9:02 AM\nNothing booked today.\nMaria owes 600.00.`;
    expect(replyLines(before, after, "Who owes me?")).toBe("Nothing booked today. Maria owes 600.00.");
    expect(replyLines(before, `${before}\nWho owes me?\n9:02 AM`, "Who owes me?")).toBe("");
  });

  it("amountMentioned finds an amount written any common way, and nothing inside another number or an id", async () => {
    const amountMentioned = await reader("amountMentioned");
    for (const text of ["TTD 1,000.00", "$1000", "1000.00 owed", "one thousand dollars", "a total of 1,000"]) expect(amountMentioned(text, 1000), text).toBe(true);
    for (const text of ["TTD 10,000.00", "1,000,000", "1000.50", "21000", "cm4z1000xy", "+18681000123", "2026-11-16T10:00:00.000Z"]) expect(amountMentioned(text, 1000), text).toBe(false);
    expect(amountMentioned("six hundred and fifty", 600), "650 in words is not 600").toBe(false);
    expect(amountMentioned("Six hundred.", 600)).toBe(true);
  });

  it("chatBodyText reads what the chat answer carries (a JSON reply, SSE deltas, tool results), not its usage counters or status codes", async () => {
    const chatBodyText = await reader("chatBodyText");
    const answerLeaks = await reader("answerLeaks");
    const sse = [
      'data: {"type":"tool_results","results":[{"name":"finance_list_receivables","output":{"rows":[{"contact":"Maria Owesab12c3","invoiceNumber":"INV-0001","amountDue":600}]}}]}',
      'data: {"type":"content_delta","content":"You don\'t have access "}',
      'data: {"type":"content_delta","content":"to money. Ask the owner."}',
      'data: {"type":"usage","usage":{"promptTokens":1000,"completionTokens":400}}',
      'data: {"type":"done","sessionId":"cs_1"}',
      "data: [DONE]",
    ].join("\n\n");
    const text = chatBodyText(sse);
    expect(text).toContain("You don't have access to money. Ask the owner.");
    expect(answerLeaks(text, SEEDED), "the tool result reached the member's browser").toEqual(expect.arrayContaining(["names 'Owesab12c3'", "invoice INV-0001", "amount 600"]));
    expect(answerLeaks(text, SEEDED), "usage counters are not amounts").not.toEqual(expect.arrayContaining(["amount 1000"]));
    expect(chatBodyText('{"reply":"No access. Ask the owner.","sessionId":"cs_2"}')).toContain("No access. Ask the owner.");
    expect(answerLeaks(chatBodyText('{"statusCode":400,"message":"Insufficient permissions: revenue"}'), SEEDED), "a status code is not an amount").toEqual([]);
  });

  it("K5 waits for KEY's reply, reads the chat answer too, and requires a refusal with nothing seeded in it", () => {
    const k5 = testBlock("k-key.spec.ts", "K5");
    expect(k5, "no fixed 30 s wait before reading the drawer").not.toMatch(/waitForTimeout\(30_000\)/);
    expect(k5).toContain("replyLines(");
    expect(k5).toContain("chatBodyText(");
    expect(k5).toMatch(/waitForResponse\([\s\S]*?isChatPost/);
    expect(k5).toMatch(/isRefusal\(/);
    expect(k5, "the debtor, the invoice number and every seeded amount").toMatch(/answerLeaks\([^)]*\{ names: \[last\], invoiceNumbers: \[invoice\.invoiceNumber\], amounts: \[1000, 400, 600\] \}/);
  });

  it("K5's owner leg names neither another business's debtor nor its amount (SEC-GL-3)", () => {
    const k5 = testBlock("k-key.spec.ts", "K5");
    expect(k5, "a second business with an open invoice").toMatch(/freshTenant\(request,/);
    expect(k5).toMatch(/answerLeaks\([^)]*\{ names: \[otherLast\], amounts: \[777\] \}/);
    expect(source("k-key.spec.ts")).toMatch(/import \{[^}]*\bfreshTenant\b[^}]*\} from "\.\/journey-helpers"/);
  });
});

// ── H9 / H9b: the accountant export as the server answers it (COR-GL-1, COR-GL-5) ──

describe("accountantExportAnswer: the export's answers on the CI stack and on staging", () => {
  it("names a sent email, a ZIP, the CI stack's 'no mail sender' 400, and anything else as wrong", async () => {
    const accountantExportAnswer = await reader("accountantExportAnswer");
    const email = "/finance/businesses/b1/accountant-export/email";
    expect(accountantExportAnswer(email, 201, '{"to":"a@x.test","filename":"export.zip"}')).toBe("sent");
    // The CI answer the review observed (env -i, no RESEND key).
    expect(accountantExportAnswer(email, 400, '{"message":"Email sender is not configured. Set RESEND_API_KEY and EMAIL_FROM_ADDRESS to enable accountant emails."}')).toBe("no-mail-sender");
    expect(accountantExportAnswer(email, 400, '{"message":"periodStart and periodEnd body fields are required (YYYY-MM-DD or ISO timestamp)"}')).toBe("wrong");
    expect(accountantExportAnswer("/finance/businesses/b1/accountant-export.zip", 200, "PK...")).toBe("zip");
    expect(accountantExportAnswer("/finance/businesses/b1/accountant-export.zip", 400, "start and end query params are required (YYYY-MM-DD)")).toBe("wrong");
    expect(accountantExportAnswer("/finance/businesses/b1/accountant-export", 500, "Internal server error")).toBe("wrong");
  });

  it("H9 reads the ZIP for a period, takes the CI mail answer, and requires the address only after a sent email", () => {
    const h9 = testBlock("h-money.spec.ts", "H9");
    expect(h9, "the ZIP route requires start and end").toMatch(/accountant-export\.zip\?start=\$\{[^}]+\}&end=\$\{[^}]+\}/);
    expect(h9).toContain("accountantExportAnswer(");
    expect(h9, "the old acceptance refused the documented 400").not.toMatch(/res\.status\(\) < 300 \|\| res\.status\(\) === 503/);
    expect(h9, "the address is read where the Reports page reads it").toMatch(/\/finance\/businesses\/\$\{owner\.businessId\}\/settings/);
    expect(h9, "only a sent email saves the address").toMatch(/if \(answer === "sent"\)/);
    expect(h9, "on the CI stack the screen says the email cannot be sent").toMatch(/answer === "no-mail-sender"/);
  });

  it("H9b sends the period and saves the address through the email route (identity's PATCH drops accountantEmail)", () => {
    const h9b = testBlock("h-money.spec.ts", "H9b");
    expect(h9b).not.toMatch(/PATCH", `\/identity\/businesses/);
    expect(h9b).toMatch(/accountant-export\/email`, \{ to: accountant, saveRecipient: true, periodStart: [^,]+, periodEnd: [^}]+\}/);
  });
});

// ── H6, H7b: the void and recurring doors as they answer (COR-GL-2, COR-GL-4) ──

describe("H6 reads VOID from the void's answer; H7b's recurring expense has its name", () => {
  it("H6 takes the status from the void's own answer (a voided expense is soft-deleted: GET .../expenses/:id answers empty)", () => {
    const h6 = testBlock("h-money.spec.ts", "H6");
    expect(h6, "no read of the voided expense through the read that hides it").not.toMatch(/"GET", `\/expenses\/businesses\/\$\{owner\.businessId\}\/expenses\/\$\{expense\.id\}`/);
    expect(h6).toMatch(/const voidRes = await voided;/);
    expect(h6).toMatch(/\(await voidRes\.json\(\)[^;]*;/);
    expect(h6).toMatch(/expect\(voidBody\.status, "the void answers the expense as VOID"\)\.toBe\("VOID"\)/);
    expect(h6, "the ledger check stays").toMatch(/toBe\(0\)/);
  });

  it("H7b's POST .../recurring carries the required name", () => {
    const h7b = testBlock("h-money.spec.ts", "H7b");
    expect(h7b).toMatch(/\/recurring`, \{\s*name: /);
  });
});

// ── I3: each Today row is one tap from its own action (COR-GL-3) ────────

describe("oneTapIn: a Today row's own action, with the customer named on every row", () => {
  // The review's block (scratchpad/rev-gl-cor/onetap-repro.cjs): four rows, each naming the customer,
  // each with its own button or link, as a correct TODAY-4BLOCK may render them.
  const TODAY = `<section><h2>Today</h2><ul>
    <li><div><p>Braiding k3x9</p><p>Simone Todayab12 · 7:00 PM</p></div><a href="/app/bookings/b1">Open</a></li>
    <li><div><p>INV-0001</p><p>Simone Todayab12 · TTD 600.00 due today</p></div><button>Remind</button></li>
    <li><div><p>Call about colour q7</p><p>Simone Todayab12</p></div><button>Done</button></li>
    <li><div><p>MKT-MWJ1M95Q-BZMI</p><p>Simone Todayab12 · 2 items</p></div><a href="/app/commerce?tab=orders">Fulfil</a></li>
  </ul></section>`;
  const ITEMS = ["Braiding k3x9", "INV-0001", "Call about colour q7", "MKT-MWJ1M95Q-BZMI"];

  it("finds each row's own action when the booking is named by its service and the others only by what their own row shows", async () => {
    const oneTapIn = await reader("oneTapIn");
    document.body.innerHTML = TODAY;
    const root = document.querySelector("section")!;
    for (const text of ITEMS) expect(oneTapIn(root, { text, others: ITEMS.filter((o) => o !== text) }), text).toBe(true);
  });

  it("still reports a row with no action of its own (one action shared by two items)", async () => {
    const oneTapIn = await reader("oneTapIn");
    document.body.innerHTML = `<section><ul><li><div><p>INV-0001</p><p>Call about colour q7</p></div><button>Open</button></li></ul></section>`;
    const root = document.querySelector("section")!;
    expect(oneTapIn(root, { text: "INV-0001", others: ["Call about colour q7"] })).toBe(false);
  });

  it("I3 names the booking by its service, keeps the customer out of the other items, and judges with oneTapIn", () => {
    const i3 = testBlock("i-today.spec.ts", "I3");
    expect(i3).not.toContain("void booking");
    expect(i3).toMatch(/\["today's booking", booking\.service\]/);
    expect(i3, "the customer's name is on every row; it marks none of them").not.toMatch(/\["today's booking", customer\.name\]/);
    expect(i3).toContain("oneTapIn");
    expect(source("i-today.spec.ts"), "one walk, from journey-text.ts").not.toMatch(/async function oneTap\(/);
  });
});

// ── I4 and I6: Pulse's five figures; the member's Today answer (COR-GL-6, SEC-GL-5) ──

describe("revenueLeaks: money a member without revenue read may not receive in the Today answer", () => {
  it("finds a Pulse block, a money field and the seeded invoice, and passes a bookings-only answer", async () => {
    const revenueLeaks = await reader("revenueLeaks");
    const seeded = { invoiceNumbers: ["INV-0001"], amounts: [720] };
    expect(revenueLeaks({ pulse: { cash: 350, owedToYou: 720 }, today: { bookings: [] } }, seeded).length).toBeGreaterThan(0);
    expect(revenueLeaks({ today: { invoices: [{ invoiceNumber: "INV-0001", total: 720 }] } }, seeded).join(" | ")).toMatch(/INV-0001/);
    expect(revenueLeaks({ today: { items: [{ label: "INV-0001 due today", amount: "TTD 720.00" }] } }, seeded).length).toBeGreaterThan(0);
    expect(revenueLeaks({ cash: 350 }, seeded), "a money field by its name").toEqual(["cash: a money field"]);
    const bookingsOnly = {
      needsYou: { items: [], count: 0 },
      today: { bookings: [{ id: "cb1", service: "Braiding k3x9", price: 150, customerName: "Tamika Today9", phone: "+18687201234", startTime: "2026-11-16T23:00:00.000Z" }], invoices: [] },
      pulse: null,
      getSetUp: { steps: [] },
    };
    expect(revenueLeaks(bookingsOnly, seeded)).toEqual([]);
  });

  it("I6 captures the member's GET .../today and judges it with revenueLeaks; the booking is found by its service", () => {
    const i6 = testBlock("i-today.spec.ts", "I6");
    expect(i6).toMatch(/waitForResponse\(/);
    expect(i6).toMatch(/\/today\$\//);
    expect(i6).toMatch(/revenueLeaks\([^)]*\{ invoiceNumbers: \[invoice\.invoiceNumber\], amounts: \[720\] \}/);
    expect(i6).toMatch(/getByText\(booking\.service\)/);
  });

  it("I4 seeds a bill and compares the five Pulse figures TODAY-AGGREGATE names, each required", () => {
    const i4 = testBlock("i-today.spec.ts", "I4");
    expect(i4, "a bill, so 'you owe' is not 0 on both sides").toMatch(/\/finance\/businesses\/\$\{owner\.businessId\}\/bills`/);
    for (const key of ["cash", "owedToYou", "youOwe", "profit", "safeToSpend"]) expect(i4, `Pulse's ${key}`).toMatch(new RegExp(`\\b${key}:`));
    expect(i4, "each of the five is required, not compared only when shown").toMatch(/for \(const key of Object\.keys\(PULSE\)\)[\s\S]*?not\.toBeNull\(\)/);
  });
});

// ── J6, J7: what a refused member must not see (SEC-GL-6, SEC-GL-7) ─────

describe("J6 and J7 look for the owner's own data and secrets in what a member gets", () => {
  it("J6 keeps the owner's expense and requires neither its description nor its amount on a refused screen", () => {
    const j6 = testBlock("j-team.spec.ts", "J6");
    expect(j6).toMatch(/const rent = `Rent \$\{stamp\(\)\}`;/);
    expect(j6).toMatch(/text\.includes\(rent\)/);
    expect(j6).toMatch(/amountMentioned\(text, 1250\)/);
  });

  it("J7 seeds an owner webhook and API key, creates a key as staff (403), and looks for the secrets in every answer", () => {
    const j7 = testBlock("j-team.spec.ts", "J7");
    expect(j7, "an owner webhook (its signing secret)").toMatch(/"POST", `\/webhooks\/businesses\/\$\{owner\.businessId\}\/webhooks`/);
    expect(j7, "an owner API key (its raw key)").toMatch(/"POST", `\/api\/businesses\/\$\{owner\.businessId\}\/api-keys`/);
    expect(j7, "BUG-013's exposure: POST create as staff").toMatch(/asStaff\("POST", `\/api\/businesses\/\$\{owner\.businessId\}\/api-keys`/);
    expect(j7, "no 64-hex key material").toMatch(/\[0-9a-f\]\{64\}/);
    expect(j7, "the owner's own secrets are named").toMatch(/includes\(hook\.secret\)/);
    expect(j7).toMatch(/includes\(ownerKey\.key\)/);
  });
});

// ── G9: framing judged by the browser and the answer's headers (SEC-GL-4) ──

describe("framingRefused: whether a page's answer forbids another site to frame it", () => {
  const PAGE = "http://127.0.0.1:5373";
  const OTHER = "http://localhost:5373";

  it("reads X-Frame-Options and CSP frame-ancestors as the browser does (CSP first)", async () => {
    const framingRefused = await reader("framingRefused");
    expect(framingRefused({ "x-frame-options": "DENY" }, OTHER, PAGE)).toBe(true);
    expect(framingRefused({ "x-frame-options": "SAMEORIGIN" }, OTHER, PAGE)).toBe(true);
    expect(framingRefused({ "x-frame-options": "SAMEORIGIN" }, PAGE, PAGE)).toBe(false);
    expect(framingRefused({ "content-security-policy": "default-src 'self'; frame-ancestors 'self'" }, OTHER, PAGE)).toBe(true);
    expect(framingRefused({ "content-security-policy": "frame-ancestors 'self'" }, PAGE, PAGE)).toBe(false);
    expect(framingRefused({ "content-security-policy": "frame-ancestors 'none'" }, PAGE, PAGE)).toBe(true);
    expect(framingRefused({ "content-security-policy": "frame-ancestors *", "x-frame-options": "DENY" }, OTHER, PAGE), "CSP frame-ancestors overrides X-Frame-Options").toBe(false);
    expect(framingRefused({ "content-security-policy": "frame-ancestors 'self' http://localhost:5373" }, OTHER, PAGE)).toBe(false);
    expect(framingRefused({}, OTHER, PAGE), "no header: another site may frame it").toBe(false);
  });

  it("G9 reads the framed page's answer and the browser's refusal, and no longer passes on text still loading", () => {
    const g9 = testBlock("g-sell-online.spec.ts", "G9");
    expect(g9, "the old check passed whenever the name was not there 3 s in").not.toMatch(/full\.includes\(product\.name\), "the full \/book\/<slug> page framed by another site"\)\.toBe\(false\)/);
    expect(g9).toContain("framingRefused(");
    expect(g9).toMatch(/startsWith\("chrome-error:"\)[\s\S]*?"refused"/);
    expect(g9).toMatch(/toBe\("refused"\)/);
  });
});

// ── J1, G3: the refusal on the screen the person sees (COR-GL-7) ────────

describe("J1 and G3 read the refusal where the person sees it", () => {
  it("J1 requires the Team screen to say the address is already invited, and never that the invite was sent", () => {
    const j1 = testBlock("j-team.spec.ts", "J1");
    expect(j1).toMatch(/\[data-sonner-toast\], \[role=alert\]/);
    expect(j1).toMatch(/already/);
    expect(j1, "no success claim for the refused invite").toMatch(/invite\|invitation\) sent/);
  });

  it("G3 drops the stock under a customer's cart and requires the checkout screen to refuse the order in plain words", () => {
    const g3 = testBlock("g-sell-online.spec.ts", "G3");
    expect(g3, "the owner lowers the stock while the customer is at the Payment step").toMatch(/inventory\/adjust`/);
    expect(g3).toMatch(/toPaymentStep\(/);
    expect(g3, "the customer's own Place Order").toMatch(/name: \/place order\/i/);
    expect(g3).toMatch(/OVERSELL_REFUSAL/);
    expect(g3, "no confirmation on the screen").toContain("order (placed|confirmed)");
  });
});
