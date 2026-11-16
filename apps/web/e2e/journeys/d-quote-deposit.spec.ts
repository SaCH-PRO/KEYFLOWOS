import {
  test,
  expect,
  API_URL,
  VARIANT,
  anonymousContext,
  coveredButtonFindings,
  settle,
  type Tenant,
} from "./journey-helpers";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

/**
 * GATE-JOURNEYS-A-F, journey D: quote, accept, invoice, deposit (product audit
 * core_journeys_v1 D; KF-JOURNEY-003 second half; D-04, D-48). Each bullet of
 * D's definition of done is a test (D1..D9), on both journey projects, in every
 * variant (README.md in this folder).
 *
 *   D1  KEY on (@ai-on): pasting a customer's WhatsApp message into New quote
 *       drafts the lines from the real catalog. KEY off: the manual form does the
 *       same job (and under KEY_DISABLED no paste box renders).
 *   D2  Edit a draft quote.
 *   D3  'WhatsApp' opens a chat with the customer's own number and the tokenized
 *       /quote/<token> link; 'Copy link' works; no Gmail is needed
 *       (whatsapp ruling D-153: wa.me only).
 *   D4  The customer page shows the business name, lines, subtotal, discount, tax and total.
 *   D5  The customer accepts, naming the terms version, and the owner sees the acceptance on Today.
 *   D6  Convert on the accepted quote creates an invoice carrying the lines, tax, discount and notes.
 *   D7  A deposit counts in Owed and Revenue on Today, Sales and Money.
 *   D8  A part-paid invoice offers Record balance and Remind.
 *   D9  Bulk Void never deletes.
 *
 * Doors: Sales > Quotes is reached at /app/commerce?tab=pipeline&view=quotes
 * (the Quotes door today; MOUNT-QUOTES keeps that URL landing on the Quotes
 * tab). A quote's row is found by its number; its actions (Edit, WhatsApp,
 * Copy link, Convert) are on the row or behind its More / Actions menu. A
 * WhatsApp control is a link whose href is the wa.me URL, or a button that
 * opens it with window.open: the spec reads the URL and never follows it (the
 * harness fails a journey on any request off localhost). Copy link is read
 * from what the page writes to the clipboard. The tax order follows the
 * taxorder ruling (D-164): tax on the subtotal before the discount, as the
 * server computes it.
 *
 * RED at the GATE-HARNESS head (02e498e8), observed on both projects in the
 * ai-disabled and key-disabled variants (the packet return holds the report):
 * D6 the accepted quote offers only Delete: no Convert (BUG-003, the
 * headline); D1 the sheet's Create Quote is under the KEY bubble at 1440x900
 * (BUG-004; KEY UI still renders under KEY_DISABLED) and under the Mobile
 * navigation bar, partly off screen, at 375x812 (no paste box renders under
 * KEY_DISABLED); D2 no Edit on a draft (BUG-045); D3 no WhatsApp and no Copy
 * link (BUG-044); D4 no business name, no logo, and no subtotal, discount or
 * tax on /quote/<token> (BUG-046); D5 the acceptance (naming the terms
 * version) works, but Today does not show it (TODAY-AGGREGATE /
 * TODAY-4BLOCK); D7 the 400 deposit counts nowhere: revenue 0 and owed 0 on
 * Sales, revenue 0 and no owed figure on Today, neither figure on Money
 * (BUG-020); D8 the part-paid row
 * offers Record payment, Duplicate, Share WhatsApp and Void, but no Record
 * balance or Remind (BUG-047); D9 bulk Status > Void deletes the quote
 * (BUG-033, 1440x900), and at 375x812 the bulk bar's Status is under the
 * Mobile navigation bar; at 375px a quote row's menu cannot be opened.
 */

const auth = (t: Tenant) => ({ Authorization: `Bearer ${t.token}` });

async function api<T = Record<string, unknown>>(
  request: APIRequestContext,
  owner: Tenant,
  method: "GET" | "POST" | "PATCH",
  path: string,
  data?: unknown,
  expected?: number,
): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, { method, headers: auth(owner), data });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 400)}`).toBe(expected ?? (method === "POST" ? 201 : 200));
  return (text ? JSON.parse(text) : null) as T;
}

const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;
const ttDigits = () => `7${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Quote {
  id: string;
  quoteNumber: string;
  status: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discountType: string | null;
  discountValue: number;
  discountAmount: number;
  total: number;
  notes: string | null;
  invoiceId: string | null;
  viewToken: string | null;
  items: Array<{ description: string; quantity: number; unitPrice: number; productId?: string | null }>;
}

async function seedCustomer(request: APIRequestContext, owner: Tenant) {
  const digits = ttDigits();
  const last = `Quote${stamp()}`;
  const contact = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts`, {
    firstName: "Maria",
    lastName: last,
    phone: `+1868${digits}`,
  });
  return { id: contact.id, name: `Maria ${last}`, e164Digits: `1868${digits}` };
}

/** A quote as the composer saves one: two lines, 12.5% tax, 10% discount, notes with the deposit terms. */
async function seedQuote(request: APIRequestContext, owner: Tenant, contactId: string, status: "DRAFT" | "SENT" | "ACCEPTED" = "DRAFT") {
  const quote = await api<Quote>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/quotes`, {
    contactId,
    currency: owner.currency,
    items: [
      { description: "Wedding cake, 3 tier", quantity: 1, unitPrice: 800 },
      { description: "Cupcakes", quantity: 24, unitPrice: 10 },
    ],
    taxRate: 12.5,
    discountType: "PERCENT",
    discountValue: 10,
    notes: "50% deposit to confirm the date",
  });
  const read = () => api<Quote>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/quotes/${quote.id}`);
  if (status === "DRAFT") return read();
  const sent = await api<Quote>(request, owner, "PATCH", `/commerce/quotes/${quote.id}/status/sent`, { businessId: owner.businessId });
  // The operator read leaves the customer token out; the status change hands it over.
  if (status === "SENT") return { ...(await read()), viewToken: sent.viewToken };
  const token = sent.viewToken!;
  const view = await api<{ termsVersion: string }>(request, owner, "GET", `/commerce/public/quotes/${token}`);
  await api(request, owner, "POST", `/commerce/public/quotes/${token}/accept`, { termsVersion: view.termsVersion });
  return { ...(await read()), viewToken: token };
}

async function seedPartPaidInvoice(request: APIRequestContext, owner: Tenant, contactId: string, total: number, paid: number) {
  const invoice = await api<{ id: string; invoiceNumber: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices`, {
    contactId,
    currency: owner.currency,
    items: [{ description: "Event catering", quantity: 1, unitPrice: total }],
  });
  await api(request, owner, "PATCH", `/commerce/invoices/${invoice.id}/status/sent`, { businessId: owner.businessId, status: "SENT" });
  await api(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices/${invoice.id}/payments`, {
    amount: paid,
    method: "Cash",
    idempotencyKey: `${invoice.id}-deposit`,
  });
  return invoice;
}

/** Sales > Quotes (the Quotes door; MOUNT-QUOTES keeps it landing on the Quotes tab). */
async function openQuotes(page: Page): Promise<void> {
  await page.goto("/app/commerce?tab=pipeline&view=quotes");
  await settle(page, 1_000);
}

/** Presses a primary button, failing with what covers it when something does (journey F's rule holds everywhere). */
async function press(button: Locator, what: string): Promise<void> {
  await expect(button, what).toBeVisible();
  expect(await coveredButtonFindings([{ what, locator: button }]), `${what} can be pressed`).toEqual([]);
  await button.click();
}

/** Opens the New Quote sheet: Sales > Quotes' "New Quote", or the Sales "New" menu's "New quote". */
async function openNewQuote(page: Page): Promise<Locator> {
  await openQuotes(page);
  const direct = page.getByRole("button", { name: /^new quote$/i }).filter({ visible: true });
  if (await direct.count()) await direct.first().click();
  else {
    await page.getByRole("button", { name: "New", exact: true }).filter({ visible: true }).first().click();
    await page.getByRole("menuitem", { name: /new quote/i }).or(page.getByRole("button", { name: /new quote/i })).filter({ visible: true }).first().click();
  }
  const sheet = page.getByRole("dialog", { name: /new quote/i });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** The row of a list that shows `text`: a table row, list item or option around it, else the card around it. */
async function rowOf(page: Page, text: string): Promise<Locator> {
  const structural = page.locator("tr, li, [role=row], [role=listitem], [role=option], article").filter({ hasText: text });
  if (await structural.count()) return structural.last();
  const label = page.getByText(text, { exact: true }).first();
  await expect(label, `a row showing ${text}`).toBeVisible();
  return label.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' group ')][1]");
}

/**
 * The row's More / Actions menu trigger: a button named so, else the row's
 * last button with no name at all (an icon-only "..." trigger), or null.
 */
async function rowMenu(row: Locator): Promise<Locator | null> {
  const named = row.getByRole("button", { name: /^(more|actions|options|menu|more actions|row actions)$/i }).filter({ visible: true });
  if (await named.count()) return named.first();
  const buttons = row.locator("button").filter({ visible: true });
  for (let i = (await buttons.count()) - 1; i >= 0; i--) {
    const b = buttons.nth(i);
    const name = ((await b.getAttribute("aria-label")) ?? (await b.innerText())).trim();
    if (!name) return b;
  }
  return null;
}

/** Whether a row offers an action (on the row, shown on hover, or in its More / Actions menu); returns it when it does. */
async function findRowAction(page: Page, row: Locator, name: RegExp): Promise<Locator | null> {
  await row.hover().catch(() => {});
  const direct = row.getByRole("button", { name }).or(row.getByRole("link", { name })).filter({ visible: true });
  if (await direct.count()) return direct.first();
  const menu = await rowMenu(row);
  if (!menu) return null;
  // A menu a finger cannot open (covered, or shown only on hover) offers nothing.
  if (!(await menu.click({ timeout: 5_000 }).then(() => true).catch(() => false))) return null;
  const item = page.getByRole("menuitem", { name }).or(page.getByRole("button", { name })).filter({ visible: true });
  if (await item.count()) return item.first();
  await page.keyboard.press("Escape");
  await menu.click({ timeout: 5_000 }).catch(() => {});
  return null;
}

/** What a row offers: its visible buttons and links, and its menu's items. */
async function rowActionNames(page: Page, row: Locator): Promise<string[]> {
  await row.hover().catch(() => {});
  const names = (els: Element[]) => els.map((e) => (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const own = await row.locator("button, a").filter({ visible: true }).evaluateAll(names);
  const menu = await rowMenu(row);
  if (!menu) return own;
  const before = await page.locator("button, [role=menuitem]").filter({ visible: true }).evaluateAll(names);
  if (!(await menu.click({ timeout: 5_000 }).then(() => true).catch(() => false))) return [...own, "menu: (cannot be opened)"];
  const after = await page.locator("button, [role=menuitem]").filter({ visible: true }).evaluateAll(names);
  await page.keyboard.press("Escape");
  await menu.click({ timeout: 5_000 }).catch(() => {});
  return [...own, ...after.filter((n) => !before.includes(n)).map((n) => `menu: ${n}`)];
}

/** Picks the customer in a document form: a select, or the customer combobox (type, then choose). */
async function chooseCustomer(scope: Locator, customer: { id: string; name: string }): Promise<void> {
  const select = scope.locator("select").filter({ has: scope.page().locator(`option[value="${customer.id}"]`) });
  if (await select.count()) {
    await select.first().selectOption(customer.id);
    return;
  }
  const combo = scope.getByRole("combobox").first();
  await combo.fill(customer.name.split(" ").at(-1)!);
  await scope.page().getByRole("option", { name: new RegExp(customer.name) }).first().click();
}

/**
 * The wa.me URL a WhatsApp control opens, without following it: an anchor's
 * href, or what the click hands window.open.
 */
async function whatsAppTarget(page: Page, control: Locator): Promise<string> {
  const href = await control.evaluate((el) => (el as HTMLAnchorElement).href ?? el.closest("a")?.href ?? "");
  if (/wa\.me|whatsapp\.com/.test(href)) return href;
  await page.evaluate(() => {
    const w = window as unknown as { __kfOpened: string[] };
    w.__kfOpened = [];
    window.open = ((url?: string | URL) => {
      w.__kfOpened.push(String(url ?? ""));
      return null;
    }) as typeof window.open;
  });
  await control.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __kfOpened: string[] }).__kfOpened.length)).toBeGreaterThan(0);
  return page.evaluate(() => (window as unknown as { __kfOpened: string[] }).__kfOpened[0]);
}

/** What a click writes to the clipboard (navigator.clipboard.writeText, recorded as it happens). */
async function copiedBy(page: Page, click: () => Promise<void>): Promise<string> {
  await page.evaluate(() => {
    const w = window as unknown as { __kfCopied: string[] };
    w.__kfCopied = [];
    const clip = navigator.clipboard;
    if (clip) {
      const original = clip.writeText.bind(clip);
      clip.writeText = async (text: string) => {
        w.__kfCopied.push(text);
        await original(text).catch(() => {});
      };
    }
  });
  await click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __kfCopied: string[] }).__kfCopied.length), { message: "the page copies a link" }).toBeGreaterThan(0);
  return page.evaluate(() => (window as unknown as { __kfCopied: string[] }).__kfCopied.at(-1) ?? "");
}

/** The first amount shown after a label in a block of text ("Revenue TTD 400.00" -> 400). */
function amountAfter(text: string, label: RegExp): number | null {
  const m = text.match(new RegExp(`(?:${label.source})[^0-9-]{0,40}(-?[0-9][0-9,]*(?:\\.[0-9]{1,2})?)`, label.flags.includes("i") ? "i" : ""));
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

test.describe("journey D: quote, accept, invoice, deposit", () => {
  test("D1 KEY on: a pasted WhatsApp message drafts the quote lines from the real catalog", { tag: "@ai-on" }, async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    await api(request, owner, "POST", `/commerce/businesses/${owner.businessId}/products`, { name: "Sponge cake", price: 45, currency: owner.currency, category: "PRODUCT" });
    await seedCustomer(request, owner);
    const sheet = await openNewQuote(page);
    const box = sheet.getByLabel(/paste the customer.s message/i);
    await expect(box, "New quote offers 'Paste the customer's message' (KEY-PASTE-BOX)").toBeVisible();
    await box.fill("Hi, can I get 3 sponge cakes Saturday, 10% off");
    await sheet.getByRole("button", { name: /^draft/i }).click();
    await expect(sheet.getByText("Sponge cake").first(), "the drafted line names the catalog item").toBeVisible({ timeout: 60_000 });
    await expect(sheet.locator('input[value="3"]').first(), "the drafted quantity").toBeVisible();
  });

  test("D1 KEY off: the manual New quote form builds the same quote from the catalog", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    const product = await api<{ id: string; name: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/products`, {
      name: `Sponge cake ${stamp()}`,
      price: 45,
      currency: owner.currency,
      category: "PRODUCT",
    });
    const customer = await seedCustomer(request, owner);

    await test.step("open New quote", async () => {
      await openNewQuote(page);
    });

    const sheet = page.getByRole("dialog", { name: /new quote/i });
    await test.step(VARIANT === "key-disabled" ? "no paste box under KEY_DISABLED" : "the manual form works without the paste box", async () => {
      if (VARIANT === "key-disabled") await expect(sheet.getByLabel(/paste the customer.s message/i)).toHaveCount(0);
    });

    await test.step("pick the customer and 3 of the catalog item, 10% off, and create the quote", async () => {
      await chooseCustomer(sheet, customer);
      const picker = sheet.locator("select").filter({ has: page.locator(`option[value="${product.id}"]`) }).first();
      await picker.selectOption(product.id);
      const qty = sheet.locator('input[type="number"]').first();
      await qty.fill("3");
      const discount = sheet.getByPlaceholder(/^(10|50\.00)$/).first();
      if (!(await discount.isVisible())) await sheet.getByRole("button", { name: /tax & discount/i }).first().click();
      await discount.fill("10");
      const created = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/commerce/businesses/${owner.businessId}/quotes`);
      await press(sheet.getByRole("button", { name: /^create quote$/i }), "the sheet's Create Quote");
      const res = await created;
      expect(res.status(), await res.text()).toBe(201);
      const quote = (await res.json()) as Quote;
      expect(quote.items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) }))).toEqual([
        { productId: product.id, quantity: 3, unitPrice: 45 },
      ]);
      expect(Number(quote.discountValue)).toBe(10);
    });
  });

  test("D2 edit a draft quote", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    const customer = await seedCustomer(request, owner);
    const quote = await seedQuote(request, owner, customer.id, "DRAFT");
    await openQuotes(page);
    const row = await rowOf(page, quote.quoteNumber);
    const edit = await findRowAction(page, row, /^edit/i);
    expect(edit, `the draft ${quote.quoteNumber} offers Edit (offers: ${JSON.stringify(await rowActionNames(page, row))})`).not.toBeNull();
    await edit!.click();
    const sheet = page.getByRole("dialog", { name: /edit quote/i });
    await expect(sheet).toBeVisible();
    await sheet.getByPlaceholder(/notes/i).fill("Deposit 40% to confirm");
    const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && new URL(r.url()).pathname.endsWith(`/quotes/${quote.id}`));
    await sheet.getByRole("button", { name: /^(update|save)/i }).click();
    expect((await saved).status()).toBe(200);
    const read = await api<Quote>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/quotes/${quote.id}`);
    expect(read.notes).toBe("Deposit 40% to confirm");
  });

  test("D3 'WhatsApp' opens the customer's own number with the /quote/<token> link; 'Copy link' works; no Gmail needed", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    const customer = await seedCustomer(request, owner);
    const quote = await seedQuote(request, owner, customer.id, "SENT");
    const gmail: string[] = [];
    page.on("request", (r) => {
      if (/\/gmail\//.test(r.url())) gmail.push(`${r.method()} ${r.url()}`);
    });
    await openQuotes(page);
    const row = await rowOf(page, quote.quoteNumber);

    await test.step("WhatsApp: wa.me/<the customer's E.164 number> with the /quote/<token> link", async () => {
      const control = await findRowAction(page, row, /whatsapp/i);
      expect(control, `the sent quote offers WhatsApp (offers: ${JSON.stringify(await rowActionNames(page, row))})`).not.toBeNull();
      const target = new URL(await whatsAppTarget(page, control!));
      expect(target.hostname).toMatch(/(^|\.)wa\.me$|whatsapp\.com$/);
      expect(target.pathname.replace(/\D/g, "") || target.searchParams.get("phone"), "the customer's own number, E.164").toBe(customer.e164Digits);
      const text = target.searchParams.get("text") ?? "";
      const read = await api<Quote>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/quotes/${quote.id}`);
      expect(text, "the message carries the tokenized quote link").toContain(`/quote/${read.viewToken}`);
    });

    await test.step("Copy link copies the /quote/<token> link", async () => {
      const r = await rowOf(page, quote.quoteNumber);
      const control = await findRowAction(page, r, /copy link/i);
      expect(control, "the sent quote offers Copy link").not.toBeNull();
      const copied = await copiedBy(page, () => control!.click());
      expect(copied).toMatch(/\/quote\/[A-Za-z0-9_-]{16,}/);
    });

    await test.step("no Gmail call was needed", async () => {
      expect(gmail).toEqual([]);
    });
  });

  test("D4 the customer's quote page shows the business name and logo, the lines, subtotal, discount, tax and total", async ({ request, owner, browser, baseURL }) => {
    test.setTimeout(3 * 60_000);
    // The business's logo: an image the web itself serves, so the customer's browser stays on localhost.
    // The API's URL check wants a dotted host, so localhost is written 127.0.0.1.
    const logo = new URL("/icons/icon-192x192.png", (baseURL ?? "http://127.0.0.1:5000").replace("//localhost", "//127.0.0.1")).toString();
    await api(request, owner, "PATCH", `/identity/businesses/${owner.businessId}`, { logoUrl: logo });
    const customer = await seedCustomer(request, owner);
    const quote = await seedQuote(request, owner, customer.id, "SENT");
    const visitor = await anonymousContext(browser, { who: "customer" });
    const page = await visitor.newPage();
    await page.goto(`/quote/${quote.viewToken}`);
    await expect(page.getByText(quote.quoteNumber).first()).toBeVisible();
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    await test.step("the business name and logo", async () => {
      expect.soft(text.includes(owner.businessName), `'${owner.businessName}' on /quote/<token>`).toBe(true);
      const logos = await page.locator("img").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).currentSrc || (i as HTMLImageElement).src));
      expect.soft(logos.some((src) => src.endsWith("/icons/icon-192x192.png")), `the business logo on /quote/<token> (images: ${JSON.stringify(logos)})`).toBe(true);
    });
    await test.step("each line", async () => {
      for (const item of quote.items) expect.soft(text.includes(item.description), `line '${item.description}'`).toBe(true);
    });
    await test.step("subtotal, discount, tax and total, as the server computed them", async () => {
      expect.soft(amountAfter(text, /subtotal/i), "Subtotal").toBe(Number(quote.subtotal));
      expect.soft(amountAfter(text, /discount/i), "Discount").toBe(Number(quote.discountAmount));
      expect.soft(amountAfter(text, /\btax\b/i), "Tax").toBe(Number(quote.taxAmount));
      expect.soft(text.includes(money(Number(quote.total))), `Total ${money(Number(quote.total))}`).toBe(true);
    });
  });

  test("D5 the customer accepts naming the terms version; the owner sees the acceptance on Today", async ({ page, request, owner, browser }) => {
    test.setTimeout(4 * 60_000);
    const customer = await seedCustomer(request, owner);
    const quote = await seedQuote(request, owner, customer.id, "SENT");
    const visitor = await anonymousContext(browser, { who: "customer" });
    const customerPage = await visitor.newPage();

    await test.step("the customer accepts on /quote/<token>; the acceptance names the terms version shown", async () => {
      await customerPage.goto(`/quote/${quote.viewToken}`);
      const view = await api<{ termsVersion: string }>(request, owner, "GET", `/commerce/public/quotes/${quote.viewToken}`);
      const accepted = customerPage.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/public/quotes/${quote.viewToken}/accept`));
      await customerPage.getByRole("button", { name: /accept quote/i }).click();
      const confirm = customerPage.getByRole("dialog").getByRole("button", { name: /^(confirm|accept|yes)/i }).filter({ visible: true });
      if (await confirm.count()) await confirm.first().click();
      const res = await accepted;
      expect(res.status(), await res.text()).toBeLessThan(300);
      expect((res.request().postDataJSON() as { termsVersion?: string }).termsVersion, "the accept names the terms version").toBe(view.termsVersion);
      const read = await api<Quote>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/quotes/${quote.id}`);
      expect(read.status).toBe("ACCEPTED");
    });

    await test.step("Today shows the owner the acceptance (Needs you: accepted, Convert)", async () => {
      await page.goto("/app/command-center");
      await settle(page, 1_000);
      await page.keyboard.press("Escape");
      const main = page.locator("main").first();
      await expect(main.getByText(new RegExp(`${quote.quoteNumber}`)).first(), `Today names ${quote.quoteNumber}`).toBeVisible();
      await expect(main.getByText(/accepted/i).first()).toBeVisible();
    });
  });

  test("D6 Convert on the accepted quote creates an invoice carrying the lines, tax, discount and notes", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    const customer = await seedCustomer(request, owner);
    const quote = await seedQuote(request, owner, customer.id, "ACCEPTED");
    expect(quote.status).toBe("ACCEPTED");

    await test.step("the accepted quote offers Convert", async () => {
      await openQuotes(page);
      const row = await rowOf(page, quote.quoteNumber);
      const convert = await findRowAction(page, row, /convert/i);
      expect(convert, `ACCEPTED ${quote.quoteNumber} offers Convert (offers: ${JSON.stringify(await rowActionNames(page, row))})`).not.toBeNull();
      const converted = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith(`/quotes/${quote.id}/convert`));
      await convert!.click();
      const go = page.getByRole("dialog").getByRole("button", { name: /convert|create invoice/i }).filter({ visible: true });
      if (await go.count()) await go.last().click();
      const res = await converted;
      expect(res.status(), await res.text()).toBe(201);
    });

    await test.step("the invoice carries the lines, tax, discount and notes", async () => {
      const read = await api<Quote>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/quotes/${quote.id}`);
      expect(read.invoiceId, "the quote names its invoice").toBeTruthy();
      const invoice = await api<Quote>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${read.invoiceId}`);
      const lines = (q: Quote) => q.items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) }));
      expect(lines(invoice)).toEqual(lines(quote));
      expect({ taxRate: Number(invoice.taxRate), discountType: invoice.discountType, discountValue: Number(invoice.discountValue) }).toEqual({
        taxRate: 12.5,
        discountType: "PERCENT",
        discountValue: 10,
      });
      expect.soft(invoice.notes, "the quote's notes (deposit terms) on the invoice (BUG-102)").toBe(quote.notes);
    });
  });

  test("D7 a deposit counts in Owed and Revenue on Today, Sales and Money", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    const customer = await seedCustomer(request, owner);
    await seedPartPaidInvoice(request, owner, customer.id, 1000, 400);
    const read = async (path: string) => {
      await page.goto(path);
      await settle(page, 2_000);
      await page.keyboard.press("Escape");
      return (await page.locator("main").first().innerText()).replace(/\s+/g, " ");
    };

    // The labels each screen may use for the two figures (TODAY-AGGREGATE's Pulse says 'owed to you';
    // Sales and Money say Owed / Outstanding and Revenue / Money in).
    const OWED = /owed to you|\bowed\b|outstanding/i;
    const IN = /money in|revenue|received|collected/i;
    for (const [where, path] of [
      ["Sales", "/app/commerce"],
      ["Today", "/app/command-center"],
      ["Money", "/app/money"],
    ] as const) {
      await test.step(`${where}: owed 600, revenue 400`, async () => {
        const text = await read(path);
        expect.soft(amountAfter(text, OWED), `${where}: owed`).toBe(600);
        expect.soft(amountAfter(text, IN), `${where}: revenue / money in`).toBe(400);
      });
    }
  });

  test("D8 a part-paid invoice offers Record balance and Remind", async ({ page, request, owner }) => {
    test.setTimeout(3 * 60_000);
    const customer = await seedCustomer(request, owner);
    const invoice = await seedPartPaidInvoice(request, owner, customer.id, 900, 300);
    await page.goto("/app/commerce/invoices");
    await settle(page, 1_000);
    const row = await rowOf(page, invoice.invoiceNumber);
    const offers = await rowActionNames(page, row);
    expect.soft(await findRowAction(page, row, /record balance/i), `Record balance on the part-paid row (offers ${JSON.stringify(offers)})`).not.toBeNull();
    expect.soft(await findRowAction(page, row, /^remind/i), `Remind on the part-paid row (offers ${JSON.stringify(offers)})`).not.toBeNull();
  });

  test("D9 bulk Void never deletes a quote", async ({ page, request, owner }) => {
    test.setTimeout(3 * 60_000);
    const customer = await seedCustomer(request, owner);
    const quote = await seedQuote(request, owner, customer.id, "DRAFT");
    await openQuotes(page);
    const row = await rowOf(page, quote.quoteNumber);
    await row.getByRole("checkbox").first().check();
    // Ticking a row must not open its detail (MOUNT-QUOTES); if it does, close it to reach the bulk bar, and say so.
    const opened = page.getByRole("dialog").filter({ visible: true });
    if (await opened.count()) {
      test.info().annotations.push({ type: "bulk-select", description: "ticking the quote's checkbox opened its detail" });
      await page.keyboard.press("Escape");
      await expect(opened).toHaveCount(0);
    }
    const voidDirect = page.getByRole("button", { name: /^void/i }).filter({ visible: true });
    const status = page.getByRole("button", { name: /^status/i }).filter({ visible: true });
    let used = "none: the bulk bar offers no Void";
    if (await voidDirect.count()) {
      await press(voidDirect.first(), "the bulk bar's Void");
      used = "Void";
    } else if (await status.count()) {
      await press(status.first(), "the bulk bar's Status");
      const item = page.getByRole("menuitem", { name: /void/i }).or(page.getByRole("button", { name: /^void/i })).filter({ visible: true });
      if (await item.count()) {
        await item.first().click();
        used = "Status > Void";
      }
    }
    const confirm = page.getByRole("dialog").getByRole("button", { name: /^(void|confirm|yes)/i }).filter({ visible: true });
    if (await confirm.count()) await confirm.first().click();
    await settle(page, 1_000);
    test.info().annotations.push({ type: "bulk-void", description: used });
    const res = await request.get(`${API_URL}/commerce/businesses/${owner.businessId}/quotes/${quote.id}`, { headers: auth(owner) });
    expect(res.status(), `${quote.quoteNumber} after bulk ${used}: it still exists (BUG-033 deletes it)`).toBe(200);
  });
});
