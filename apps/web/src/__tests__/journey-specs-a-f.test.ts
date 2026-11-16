/**
 * GATE-JOURNEYS-A-F review repair: the journey specs A to F test what their
 * definitions of done say, and nothing a correct build cannot pass.
 *
 * Two kinds of case:
 *   - the specs' text readers, with no Playwright runtime
 *     (e2e/journeys/journey-text.ts): the totals parser D4 and D7 use, the
 *     KEY-card rule A3 uses, the payment-method reader F3 uses;
 *   - each repaired step, pinned in its spec's source (as journey-harness.test.ts
 *     pins README.md and e2e-live.yml), so a later edit cannot quietly undo it.
 *
 * Findings: SEC-GJ-1 (D3 read the customer's token from the operator read,
 * which SEC-V52-1 removed), GJAF-COR-1 (F3 never set Getting paid),
 * GJAF-COR-2 (the totals parser could not read 'Tax (12.5%) TTD 130.00' or
 * '-TTD 104.00'), GJAF-COR-3 (A3 counted the header's KEY door as a KEY card),
 * GJAF-COR-4 (C3 looked for a toast's reason inside the dialog), GJAF-COR-5 (C7
 * never deleted, never opened the trash), SEC-GJ-3 (F7c never said who
 * cancelled), SEC-GJ-4 / GJAF-COR-8 (C5 never checked bookings for a leak),
 * GJAF-COR-6 (B7 counted products only), GJAF-COR-7 (B2 never read staff or the
 * deposit type), GJAF-COR-9 (B6 could pass on an unread picker), GJAF-COR-10
 * (E14 searched a read that has no activity).
 *
 * journey-text.ts is loaded per test, so a missing module fails the cases that
 * need it and not the file.
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

const source = (file: string) => fs.readFileSync(path.join(JOURNEYS, file), "utf8");

/**
 * The source of one test, by the id its title starts with ("D3", "F7c"): from
 * its `test("<id> ` to the next test's start, or the end of the file.
 */
function testBlock(file: string, id: string): string {
  const src = source(file);
  const start = src.indexOf(`test("${id} `);
  expect(start, `${file} has a test "${id} ..."`).toBeGreaterThanOrEqual(0);
  const next = src.slice(start + 1).search(/\n\s*test\(\s*"/);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

// ── the totals parser (GJAF-COR-2) ───────────────────────────────────────

describe("amountAfter reads the totals layout the app's documents use", () => {
  // The invoice public page /pay/link/<token>, verbatim from the review's repro
  // (lines 800 + 24 x 10, tax 12.5%, discount 10%); the quote page is to show its
  // totals "like the invoice public page" (SWP-QUOTE-PUBLIC-PAGE).
  const INVOICE_PAGE = "Subtotal TTD 1,040.00 Tax (12.5%) TTD 130.00 Discount -TTD 104.00 Total TTD 1,066.00";

  it("reads the subtotal, the tax after its rate, the discount with its sign, and the total", async () => {
    const t = await journeyText();
    expect(t.amountAfter(INVOICE_PAGE, /subtotal/i)).toBe(1040);
    expect(t.amountAfter(INVOICE_PAGE, /\btax\b/i)).toBe(130);
    expect(t.amountAfter(INVOICE_PAGE, /discount/i)).toBe(-104);
    expect(t.amountAfter(INVOICE_PAGE, /\btotal\b/i)).toBe(1066);
  });

  it("skips a rate written after the label with or without brackets, and a rate written after the amount", async () => {
    const t = await journeyText();
    expect(t.amountAfter("VAT 12.5% TTD 130.00", /\bvat\b/i)).toBe(130);
    expect(t.amountAfter("Discount (10%) -TTD 104.00", /discount/i)).toBe(-104);
    expect(t.amountAfter("Tax TTD 130.00 (12.5%)", /\btax\b/i)).toBe(130);
    expect(t.amountAfter("Tax: $130", /\btax\b/i)).toBe(130);
  });

  it("still reads the dashboards' figures (D7) and answers null when no amount follows", async () => {
    const t = await journeyText();
    expect(t.amountAfter("Revenue TTD 400.00", /money in|revenue|received|collected/i)).toBe(400);
    expect(t.amountAfter("Owed to you TTD 600.00 Revenue TTD 400.00", /owed to you|\bowed\b|outstanding/i)).toBe(600);
    expect(t.amountAfter("Outstanding: 1,250.5 this month", /outstanding/i)).toBe(1250.5);
    expect(t.amountAfter("Revenue: no payments yet", /revenue/i)).toBeNull();
    expect(t.amountAfter("Subtotal TTD 10.00", /discount/i)).toBeNull();
  });

  it("D4 and D7 use it from journey-text.ts, and D4 compares the discount shown by its size", () => {
    const d = source("d-quote-deposit.spec.ts");
    expect(d).toMatch(/import\s*\{[^}]*\bamountAfter\b[^}]*\}\s*from\s*"\.\/journey-text"/);
    expect(d, "no private copy of the parser").not.toMatch(/function amountAfter\(/);
    expect(testBlock("d-quote-deposit.spec.ts", "D4")).toMatch(/Math\.abs\(\s*amountAfter\(text,\s*\/discount\/i\)/);
  });
});

// ── A3: a KEY card above the manual form, not the header's KEY door (GJAF-COR-3) ──

describe("keyCardsAboveForm: the header's KEY door is not a KEY card", () => {
  const FORM_TOP = 193;

  it("passes the header's 'Ask KEY anything...' door (journey K: KEY opens from the header button)", async () => {
    const t = await journeyText();
    const door = { text: "Ask KEY anything...", top: 15, headerDoor: true, where: "<button class=\"hidden md:flex\">" };
    expect(t.keyCardsAboveForm([door], FORM_TOP)).toEqual([]);
  });

  it("reports KEY text above the form that is not the header's door, and nothing below the form", async () => {
    const t = await journeyText();
    const card = { text: "Let KEY set up your business", top: 120, headerDoor: false, where: "<section>" };
    const below = { text: "Talk to KEY", top: 700, headerDoor: false, where: "<button>" };
    const found = t.keyCardsAboveForm([card, below], FORM_TOP);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("Let KEY set up your business");
    expect(found[0]).toContain("y=120");
  });

  it("A3 collects the candidates with the header door marked, and judges them with keyCardsAboveForm", () => {
    const a3 = testBlock("a-start-business.spec.ts", "A3");
    expect(a3).toContain("keyCardsAboveForm(");
    expect(a3, "a door is a button or link inside the app header").toMatch(/closest\("header, \[role=banner\]"\)/);
    expect(a3).toMatch(/closest\("button, a, \[role=button\], \[role=link\]"\)/);
  });
});

// ── F3: only what Settings > Getting paid enables (GJAF-COR-1) ──────────

describe("offeredPaymentMethods reads the checkout's method names", () => {
  it("names each method once, in one spelling, from the Payment step's text", async () => {
    const t = await journeyText();
    const step =
      "Payment WiPay Pay with credit/debit card via WiPay PayPal Pay securely with your PayPal account " +
      "Cash / Manual Payment Pay in person or arrange payment with the business Place Order";
    expect(t.offeredPaymentMethods(step)).toEqual(["cash", "paypal", "wipay"]);
    expect(t.offeredPaymentMethods("Bank Transfer Pay into our account Bank transfer")).toEqual(["bank transfer"]);
    expect(t.offeredPaymentMethods("Card Stripe")).toEqual(["card", "stripe"]);
    expect(t.offeredPaymentMethods("Place Order")).toEqual([]);
  });

  it("F3 saves Getting paid as the payments tab does, then requires exactly the enabled methods, both ways", () => {
    const f3 = testBlock("f-bookings.spec.ts", "F3");
    expect(f3).toMatch(/cashEnabled:\s*false/);
    expect(f3).toMatch(/bankTransferEnabled:\s*true/);
    expect(f3).toMatch(/cashEnabled:\s*true/);
    expect(f3).toMatch(/bankTransferEnabled:\s*false/);
    expect(f3).toContain("offeredPaymentMethods(");
    expect(f3).toMatch(/toEqual\(\["bank transfer"\]\)/);
    expect(f3).toMatch(/toEqual\(\["cash"\]\)/);
  });
});

// ── D3: the customer's link comes from the status change, never the operator read (SEC-GJ-1) ──

describe("D3 takes the /quote/<token> link from the send, not from the operator's read", () => {
  it("expects the token the status change handed over (SEC-V52-1 keeps it off GET .../quotes/:id)", () => {
    const d3 = testBlock("d-quote-deposit.spec.ts", "D3");
    expect(d3).not.toMatch(/read\.viewToken/);
    expect(d3).toMatch(/`\/quote\/\$\{quote\.viewToken\}`/);
    expect(d3, "the sent quote's token is known before the link is compared").toMatch(/expect\(quote\.viewToken[^)]*\)\.toBeTruthy\(\)/);
  });
});

// ── C3: the reason may be a toast while the form stays open (GJAF-COR-4) ──

describe("C3 finds the refusal's reason in the dialog or in the toast", () => {
  it("looks in the still-open dialog and in the app's toaster (mounted outside the dialog)", () => {
    const c = source("c-customer.spec.ts");
    const c3 = testBlock("c-customer.spec.ts", "C3");
    expect(c3, "not confined to the dialog").not.toMatch(/dialog\.getByText\(\/(already|no access)/);
    expect(c3.match(/refusalShown\(/g) ?? [], "both legs (409 and 403)").toHaveLength(2);
    expect(c).toMatch(/function refusalShown\([\s\S]*?\[data-sonner-toast\][\s\S]*?\n\}/);
  });
});

// ── C7: a delete reaches the server, the trash restores, Undo keeps (GJAF-COR-5) ──

describe("C7 deletes for real, restores from the trash, and Undo keeps the customer", () => {
  it("waits for the DELETE, reads the customer gone, then restores them from /app/trash", () => {
    const c7 = testBlock("c-customer.spec.ts", "C7");
    expect(c7).toMatch(/method\(\) === "DELETE"/);
    expect(c7, "a delete without Undo leaves the customer gone").toMatch(/toBe\(404\)/);
    expect(c7).toContain('"/app/trash"');
    expect(c7).toMatch(/name: \/\^restore\$\/i/);
    expect(c7).toMatch(/\/restore`/);
  });
});

// ── C5: bookings are checked for a leak too (SEC-GJ-4, GJAF-COR-8) ──────

describe("C5 tells the two customers' bookings apart", () => {
  it("books each customer a service of their own, and looks for the other's on this page", () => {
    const c5 = testBlock("c-customer.spec.ts", "C5");
    expect(c5).toMatch(/const leaked = \[[^\]]*\bb\.booking\b[^\]]*\]/);
    expect(c5).toMatch(/\ba\.booking\b/);
    expect(c5, "no booking marker shared by both customers").not.toMatch(/text\.includes\(serviceName\)/);
  });
});

// ── F7c: the customer cancelled; a business cancel keeps the deposit (SEC-GJ-3) ──

describe("F7c records who cancelled; the converse keeps the deposit", () => {
  it("F7c sends a customer cancel (cancelledBy CUSTOMER, or none: D-65) and reads the forfeit", () => {
    const f7c = testBlock("f-bookings.spec.ts", "F7c");
    expect(f7c).toMatch(/cancelBooking\(page, booked\.customer, "customer"\)/);
    const f = source("f-bookings.spec.ts");
    expect(f).toMatch(/async function cancelBooking\([\s\S]*?cancelledBy[\s\S]*?\n {2}\}/);
  });

  it("a business cancel of a paid deposit keeps it as paid, not forfeit (D-26, V1-84)", () => {
    const f7e = testBlock("f-bookings.spec.ts", "F7e");
    expect(f7e).toMatch(/cancelBooking\(page, booked\.customer, "business"\)/);
    expect(f7e).toMatch(/toBe\("DEPOSIT_PAID"\)/);
  });
});

// ── B2, B6, B7 (GJAF-COR-7, GJAF-COR-9, GJAF-COR-6) ──────────────────────

describe("journey B reads what its bullets name", () => {
  it("B2 reads the deposit type, and the staff member after a reload in the service's Edit", () => {
    const b2 = testBlock("b-catalog.spec.ts", "B2");
    expect(b2).toMatch(/depositType:\s*"PERCENT"/);
    expect(b2).toContain("page.reload()");
    expect(b2).toMatch(/rowAction\(page, [^,]+, \/\^edit\/i\)/);
    expect(b2).toMatch(/toBeChecked\(\)|selectedStaff/);
  });

  it("B6 proves the line picker loaded (an active product is listed) before reading the archived one's absence", () => {
    const b6 = testBlock("b-catalog.spec.ts", "B6");
    expect(b6).toMatch(/const kept = await seedProduct\(/);
    expect(b6).toMatch(/expect\s*\.poll\(async \(\) => \(await pickerCount\(\w+, kept\.name\)\)\.count/);
    expect(b6.indexOf("kept.name"), "the picker is seen loaded before the archived product's count is read").toBeLessThan(b6.indexOf("pickerCount(form, product.name)"));
  });

  it("B7 counts the services a template adds, not only its products", () => {
    const b7 = testBlock("b-catalog.spec.ts", "B7");
    expect(b7).toMatch(/\/bookings\/businesses\/\$\{owner\.businessId\}\/services/);
    expect(b7).toMatch(/services:/);
  });
});

// ── E14: the reminder email is read where it is recorded (GJAF-COR-10) ──

describe("E14 reads the invoice's activity", () => {
  it("reads GET .../invoices/:id/timeline and looks for an emailed reminder there", () => {
    const e14 = testBlock("e-invoice-paid.spec.ts", "E14");
    expect(e14).toMatch(/\/invoices\/\$\{invoice\.id\}\/timeline/);
    expect(e14).toContain('"invoice.payment_reminder_sent"');
    expect(e14, "not the invoice row, which carries no activity").not.toMatch(/JSON\.stringify\(await api\(request, owner, "GET", `\/commerce\/businesses\/\$\{owner\.businessId\}\/invoices\/\$\{invoice\.id\}`\)\)/);
  });
});
