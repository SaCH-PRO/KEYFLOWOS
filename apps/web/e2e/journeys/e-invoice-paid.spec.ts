import {
  test,
  expect,
  API_URL,
  anonymousContext,
  coveredButtonFindings,
  settle,
  type Tenant,
} from "./journey-helpers";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

/**
 * GATE-JOURNEYS-A-F, journey E: invoice and get paid (product audit
 * core_journeys_v1 E; KF-JOURNEY-003, 007; D-05, D-13, D-14, D-60, D-66). Each
 * bullet of E's definition of done is a test (E1..E14), on both journey
 * projects, in every variant (README.md in this folder).
 *
 * Totals and currency
 *   E1  The preview total equals the saved total for every mix of discount and
 *       tax, under the taxorder ruling (D-164: nothing changes until the
 *       accountant rules, so tax is on the subtotal before the discount, as the
 *       server computes it today).
 *   E2  Quantities follow the decimals ruling (D-166): 2.5 on a non-stock line is
 *       kept; a stock line takes whole units and says so.
 *   E3  Amounts show in the business currency everywhere (a USD business).
 *   E4  The VAT number prints on the invoice, receipt and PDF whenever tax is
 *       charged (vat ruling D-165).
 * Sharing
 *   E5  A draft cannot be shared.
 *   E6  Once issued, 'WhatsApp' and 'Copy link' share /public/invoice/<token>.
 * Payment, owner side
 *   E7  The owner records part and full payments in cash or by bank transfer;
 *       the customer gets a receipt link.
 * Bank-transfer claim (CLAIM-LOOP)
 *   E8  The customer taps 'I've paid by bank transfer' on /pay/link; a Needs-you
 *       item appears; Confirm records the payment in one tap (E8a); 'Not yet'
 *       leaves the invoice open (E8b). The owner's alert (push, else email:
 *       alerts ruling D-154) is a @staging leg (E8c).
 * Online payment (@staging, WiPay sandbox)
 *   E9  The customer pays on /pay/link with WiPay; the invoice is paid, the
 *       customer gets a receipt and the owner is alerted.
 * Other actions
 *   E10 Refund a manual payment (refund ruling D-169: the whole payment).
 *   E11 Duplicate keeps the client, tax, discount and notes.
 *   E12 'Download PDF' gives a one-invoice A4 document.
 *   E13 A voided invoice's link says it is voided.
 * Overdue (@scheduler, GATE-SCHEDULER-RUN)
 *   E14 The overdue job fires and the invoice appears in Today's 'ready to send'
 *       list; email goes out only if Gmail is connected (read on the invoice's
 *       activity, GET .../invoices/:id/timeline).
 *
 * Doors: New invoice is /app/commerce/invoices/new; the invoice's page is
 * /app/commerce/invoices/<id>, whose actions (Record payment, WhatsApp, Copy
 * link, Duplicate, Download PDF, Refund on a payment) are buttons or menu
 * items by those names, directly or behind its Actions / More menu; the list
 * is /app/commerce/invoices. WhatsApp URLs are read, never followed (the
 * harness fails a journey on any request off localhost); copied links are read
 * from what the page writes to the clipboard. Documents a test does not create
 * itself are made through the API.
 *
 * RED at the GATE-HARNESS head (02e498e8), observed on both projects in the
 * ai-disabled and key-disabled variants (the packet return holds the report):
 * E1 with tax and a discount the preview taxes after the discount (384.75
 * and 399.38) while the server saves 389.50 and 402.50 (BUG-018, the
 * headline; the four other mixes agree); E2 2.5 is saved as 2 (BUG-008) and a
 * stock line takes 1.5 with no message; E3 a USD business's invoice is sent
 * and saved in TTD (BUG-007); E4 no VAT number field (VAT-BASICS); E5 a draft
 * offers 'Copy payment link' and the server mints one (BUG-053); E6 Copy
 * payment link works, but there is no WhatsApp; E7 both payments record
 * (cash, then bank transfer) but the paid invoice gives the customer no
 * receipt link: its Copy payment link copies nothing; E8 /pay/link has no
 * 'I've paid by bank transfer' (CLAIM-LOOP); E10 no Refund (BUG-049); E11
 * Duplicate drops the client, tax, discount and notes (BUG-050); E12 no
 * Download PDF (Print / PDF prints the screen, BUG-051); E13 a voided link
 * says neither page is voided and /pay/link still offers to pay (BUG-087).
 * E1 moves the tenant to Flow first (FREE caps invoices at 5 a month).
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
const num = (s: string) => Number(s.replace(/[^0-9.-]/g, ""));

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discountType: string | null;
  discountValue: number;
  discountAmount: number;
  total: number;
  currency: string;
  notes: string | null;
  contactId: string | null;
  items: Array<{ description: string; quantity: number; unitPrice: number }>;
}

async function seedCustomer(request: APIRequestContext, owner: Tenant) {
  const digits = ttDigits();
  const last = `Pay${stamp()}`;
  const contact = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts`, {
    firstName: "Rena",
    lastName: last,
    phone: `+1868${digits}`,
    email: `${last.toLowerCase()}@v62j.test.local`,
  });
  return { id: contact.id, name: `Rena ${last}`, e164Digits: `1868${digits}` };
}

async function seedInvoice(
  request: APIRequestContext,
  owner: Tenant,
  contactId: string,
  options: { total?: number; taxRate?: number; discount?: number; notes?: string; status?: "DRAFT" | "SENT" } = {},
): Promise<Invoice> {
  const invoice = await api<Invoice>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices`, {
    contactId,
    currency: owner.currency,
    items: [{ description: "Catering for 40", quantity: 1, unitPrice: options.total ?? 300 }],
    ...(options.taxRate ? { taxRate: options.taxRate } : {}),
    ...(options.discount ? { discountType: "PERCENT", discountValue: options.discount } : {}),
    ...(options.notes ? { notes: options.notes } : {}),
  });
  if ((options.status ?? "SENT") === "DRAFT") return invoice;
  return api<Invoice>(request, owner, "PATCH", `/commerce/invoices/${invoice.id}/status/sent`, { businessId: owner.businessId, status: "SENT" });
}

async function paymentLink(request: APIRequestContext, owner: Tenant, invoiceId: string): Promise<string> {
  const link = await api<{ token: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices/${invoiceId}/payment-link`, {});
  return link.token;
}

/** An action on the invoice page by name: a visible button, link or menu item, else behind its Actions / More menu. */
async function invoiceAction(page: Page, name: RegExp): Promise<Locator | null> {
  const direct = page.getByRole("button", { name }).or(page.getByRole("link", { name })).filter({ visible: true });
  if (await direct.count()) return direct.first();
  // A menu that opens on hover keeps its items in the page: reveal the one asked for.
  const hidden = page.locator("main").getByRole("button", { name, includeHidden: true });
  if (await hidden.count()) {
    await hidden.first().locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' group ')][1]").hover().catch(() => {});
    if (await hidden.first().isVisible()) return hidden.first();
  }
  const menu = page.getByRole("button", { name: /^(actions|more|more actions|options)$/i }).filter({ visible: true });
  if (!(await menu.count())) return null;
  await menu.first().click();
  const item = page.getByRole("menuitem", { name }).or(page.getByRole("button", { name })).filter({ visible: true });
  if (await item.count()) return item.first();
  await page.keyboard.press("Escape");
  return null;
}

/**
 * A list row's More / Actions menu trigger: a button named so, else the row's
 * last button with no name at all (an icon-only "..." trigger), or null.
 */
async function rowMenu(row: Locator): Promise<Locator | null> {
  const named = row.getByRole("button", { name: /^(more|actions|options|menu|more actions|row actions)$/i }).filter({ visible: true });
  if (await named.count()) return named.first();
  const buttons = row.locator("button").filter({ visible: true });
  for (let i = (await buttons.count()) - 1; i >= 0; i--) {
    const b = buttons.nth(i);
    const label = ((await b.getAttribute("aria-label")) ?? (await b.innerText())).trim();
    if (!label) return b;
  }
  return null;
}

async function visibleActionNames(page: Page): Promise<string[]> {
  return page
    .locator("main button, main a")
    .filter({ visible: true })
    .evaluateAll((els) => [...new Set(els.map((e) => (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean))]);
}

async function openInvoice(page: Page, invoice: { id: string; invoiceNumber: string }): Promise<void> {
  await page.goto(`/app/commerce/invoices/${invoice.id}`);
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(invoice.invoiceNumber) })).toBeVisible();
}

/** The wa.me URL a WhatsApp control opens, read and never followed. */
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
  await confirmWhatsAppNumberOnce(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __kfOpened: string[] }).__kfOpened.length)).toBeGreaterThan(0);
  return page.evaluate(() => (window as unknown as { __kfOpened: string[] }).__kfOpened[0]);
}

/**
 * FU-WA-CONTACT-PHONE (D-153, D-221): a customer the owner created with a
 * phone and no WhatsApp number is asked about once. The share shows the
 * phone's E.164 reading and 'Use this as their WhatsApp number'; pressing it
 * saves the number on the customer and opens the chat. The step does not vouch
 * for the phone (a public form can fill it): it asks the member to save it only
 * if they know it is the customer's WhatsApp. A share that opens straight away
 * (a saved WhatsApp number) passes through.
 */
async function confirmWhatsAppNumberOnce(page: Page): Promise<void> {
  const step = page.getByRole("dialog", { name: /whatsapp number/i });
  const opened = () => page.evaluate(() => (window as unknown as { __kfOpened: string[] }).__kfOpened.length);
  await expect.poll(async () => (await opened()) > 0 || (await step.isVisible()), { message: "the share opens a chat or asks to confirm the number" }).toBe(true);
  if ((await opened()) > 0) return;
  await expect(step, "the confirm step shows the phone's E.164 reading").toContainText(/\+\d{8,15}/);
  await expect(step, "the step does not vouch for the phone on file (SEC-WACP-1)").toContainText(/only if you know it is .*WhatsApp/i);
  const use = step.getByRole("button", { name: /^use this as their whatsapp number$/i });
  await expect(use, "the confirm step offers Use this as their WhatsApp number").toBeVisible();
  expect(await coveredButtonFindings([{ what: "the confirm step's Use this as their WhatsApp number", locator: use }]), "it can be pressed").toEqual([]);
  await use.click();
}

/** What a click writes to the clipboard. */
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

/** The input that follows a label's text (the invoice form's labels are not tied to their inputs today). */
function inputAfter(scope: Page | Locator, label: RegExp): Locator {
  return scope.getByLabel(label).or(scope.locator("label").filter({ hasText: label }).locator("xpath=following::input[1]")).first();
}

interface FormLine {
  description: string;
  quantity: string;
  price: string;
}

/** Fills New invoice: the client, the lines, tax and discount. */
async function fillNewInvoice(
  page: Page,
  values: { contactId: string; lines: FormLine[]; tax?: string; discount?: { type: "PERCENT" | "FIXED"; value: string } },
): Promise<void> {
  await page.goto("/app/commerce/invoices/new");
  await expect(page.getByRole("heading", { name: "New Invoice" })).toBeVisible();
  const client = page.locator("select").filter({ has: page.locator(`option[value="${values.contactId}"]`) }).first();
  await expect(client).toBeAttached();
  await client.selectOption(values.contactId);
  for (let i = 1; i < values.lines.length; i++) await page.getByRole("button", { name: /add item/i }).click();
  const descriptions = page.getByPlaceholder("Item description");
  await expect(descriptions).toHaveCount(values.lines.length);
  for (const [i, line] of values.lines.entries()) {
    await descriptions.nth(i).fill(line.description);
    const row = descriptions.nth(i).locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' grid ')][1]");
    const numbers = row.locator('input[type="number"]');
    await numbers.nth(0).fill(line.quantity);
    await numbers.nth(1).fill(line.price);
  }
  if (values.tax !== undefined) await inputAfter(page, /tax rate/i).fill(values.tax);
  if (values.discount) {
    const box = page.locator("label").filter({ hasText: /^discount$/i }).locator("xpath=..");
    await box.locator("select").selectOption(values.discount.type);
    await box.locator('input[type="number"]').fill(values.discount.value);
  }
}

/** The total the form previews ("Total due" in the Summary, else its "Total"). */
async function previewTotal(page: Page): Promise<number> {
  const due = page.getByText(/^total due$/i);
  const label = (await due.count()) ? due.first() : page.getByText(/^total$/i).last();
  const value = label.locator("xpath=following-sibling::*[1]");
  await expect(value).toBeVisible();
  return num(await value.innerText());
}

async function saveDraft(page: Page, businessId: string): Promise<{ status: number; body: Invoice; sent: Record<string, unknown> }> {
  const created = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/commerce/businesses/${businessId}/invoices`);
  await page.getByRole("button", { name: /save draft/i }).first().click();
  const res = await created;
  return { status: res.status(), body: (await res.json()) as Invoice, sent: res.request().postDataJSON() as Record<string, unknown> };
}

/** Records a payment through the invoice page's payment form. */
async function recordPayment(page: Page, businessId: string, invoiceId: string, amount: string, method: "Cash" | "Bank Transfer"): Promise<number> {
  const open = await invoiceAction(page, /^record (a )?payment$|^record balance$/i);
  expect(open, "the invoice offers Record payment").not.toBeNull();
  await open!.click();
  const modal = page.locator("div", { has: page.getByRole("heading", { name: /record payment/i }) }).last();
  await modal.locator('input[type="number"]').first().fill(amount);
  const methodField = modal.getByLabel(/method/i).or(modal.locator("select")).first();
  await methodField.selectOption({ label: method }).catch(async () => methodField.selectOption(method));
  const recorded = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/commerce/businesses/${businessId}/invoices/${invoiceId}/payments`);
  await modal.getByRole("button", { name: /^record payment$/i }).click();
  return (await recorded).status();
}

test.describe("journey E: invoice and get paid", () => {
  test("E1 the preview total equals the saved total for every mix of discount and tax", async ({ page, request, owner }) => {
    test.setTimeout(8 * 60_000);
    // Six invoices: the owner moves to Flow (the manual activation the owner may record, D-162) so FREE's monthly cap does not cut the run short.
    await api(request, owner, "POST", `/subscriptions/businesses/${owner.businessId}/record-payment`, { plan: "FLOW", currency: owner.currency, method: "manual", reference: "journey gate E1" });
    const customer = await seedCustomer(request, owner);
    const lines: FormLine[] = [
      { description: "Consulting", quantity: "2", price: "150" },
      { description: "Setup", quantity: "1", price: "80" },
    ];
    const mixes: Array<{ name: string; tax: string; discount?: { type: "PERCENT" | "FIXED"; value: string } }> = [
      { name: "no tax, no discount", tax: "" },
      { name: "12.5% tax", tax: "12.5" },
      { name: "10% discount", tax: "", discount: { type: "PERCENT", value: "10" } },
      { name: "fixed 25 discount", tax: "", discount: { type: "FIXED", value: "25" } },
      { name: "12.5% tax and 10% discount", tax: "12.5", discount: { type: "PERCENT", value: "10" } },
      { name: "12.5% tax and fixed 25 discount", tax: "12.5", discount: { type: "FIXED", value: "25" } },
    ];
    const results: string[] = [];
    for (const mix of mixes) {
      await test.step(`${mix.name}: preview total = saved total`, async () => {
        await fillNewInvoice(page, { contactId: customer.id, lines, tax: mix.tax, discount: mix.discount });
        const preview = await previewTotal(page);
        const saved = await saveDraft(page, owner.businessId);
        expect(saved.status, JSON.stringify(saved.body)).toBe(201);
        results.push(`${mix.name}: preview ${preview}, saved ${Number(saved.body.total)}`);
        expect.soft(preview, `${mix.name}: the preview (saved total ${Number(saved.body.total)})`).toBeCloseTo(Number(saved.body.total), 2);
      });
    }
    test.info().annotations.push({ type: "totals", description: results.join("; ") });
  });

  test("E2 quantities follow the decimals ruling: 2.5 on a non-stock line is kept; a stock line takes whole units", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    const customer = await seedCustomer(request, owner);

    await test.step("2.5 hours on a line with no stock is saved as 2.5", async () => {
      await fillNewInvoice(page, { contactId: customer.id, lines: [{ description: "Design hours", quantity: "2.5", price: "100" }] });
      expect(await previewTotal(page)).toBe(250);
      const saved = await saveDraft(page, owner.businessId);
      expect(saved.status, JSON.stringify(saved.body)).toBe(201);
      expect.soft(Number(saved.body.items[0].quantity), "the saved quantity").toBe(2.5);
      expect.soft(Number(saved.body.total), "the saved total").toBe(250);
    });

    await test.step("1.5 of a stock product is refused in the form, in plain words, before anything is sent", async () => {
      const product = await api<{ id: string; name: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/products`, {
        name: `Flour bag ${stamp()}`,
        price: 30,
        currency: owner.currency,
        category: "PRODUCT",
        inventoryMode: "tracked",
      });
      await fillNewInvoice(page, { contactId: customer.id, lines: [{ description: "x", quantity: "1", price: "30" }] });
      await page.locator("select").filter({ has: page.locator(`option[value="${product.id}"]`) }).first().selectOption(product.id);
      const row = page.getByPlaceholder("Item description").first().locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' grid ')][1]");
      await row.locator('input[type="number"]').first().fill("1.5");
      const posts: string[] = [];
      page.on("request", (r) => {
        if (r.method() === "POST" && /\/invoices$/.test(new URL(r.url()).pathname)) posts.push(r.url());
      });
      await page.getByRole("button", { name: /save draft/i }).first().click();
      await expect.soft(page.getByText(/whole (units|numbers)/i).first(), "a plain message that stock lines take whole units").toBeVisible();
      await page.waitForTimeout(1_000);
      expect.soft(posts, "nothing is sent for 1.5 of a stock product").toEqual([]);
    });
  });

  test.describe("a USD business", () => {
    test.use({ tenantOptions: { currency: "USD" } });

    test("E3 amounts show in the business currency everywhere", async ({ page, request, owner, browser }) => {
      test.setTimeout(5 * 60_000);
      const customer = await seedCustomer(request, owner);
      let invoice: Invoice;

      await test.step("New invoice saves in USD", async () => {
        await fillNewInvoice(page, { contactId: customer.id, lines: [{ description: "Website", quantity: "1", price: "650" }] });
        const saved = await saveDraft(page, owner.businessId);
        expect(saved.status).toBe(201);
        expect.soft(saved.sent.currency ?? "(none: the server takes the business's)", "the currency the form sends").not.toBe("TTD");
        expect(saved.body.currency, "the saved invoice's currency").toBe("USD");
        invoice = saved.body;
      });

      await test.step("the invoice list's cards and rows say USD, never TTD", async () => {
        await page.goto("/app/commerce/invoices");
        await settle(page, 1_500);
        const text = await page.locator("main").first().innerText();
        expect.soft(text.match(/\bTTD\b|TT\$/g) ?? [], "TTD on a USD business's invoice list").toEqual([]);
        expect(text).toMatch(/USD|US\$/);
      });

      await test.step("the invoice page and the customer's page say USD", async () => {
        await openInvoice(page, invoice!);
        expect.soft((await page.locator("main").first().innerText()).match(/\bTTD\b/g) ?? []).toEqual([]);
        await api(request, owner, "PATCH", `/commerce/invoices/${invoice!.id}/status/sent`, { businessId: owner.businessId, status: "SENT" });
        const token = await paymentLink(request, owner, invoice!.id);
        const visitor = await anonymousContext(browser, { who: "customer" });
        const view = await visitor.newPage();
        await view.goto(`/public/invoice/${token}`);
        await expect(view.getByText(invoice!.invoiceNumber).first()).toBeVisible();
        const text = await view.locator("body").innerText();
        expect.soft(text, "the customer's page names USD").toMatch(/USD|US\$/);
        expect.soft(text.match(/\bTTD\b/g) ?? []).toEqual([]);
      });
    });
  });

  test("E4 the VAT number prints on the invoice, the receipt and the PDF whenever tax is charged", async ({ page, request, owner, browser }) => {
    test.setTimeout(5 * 60_000);
    const vat = ["VAT", stamp().toUpperCase()].join("-");
    await test.step("the owner saves the VAT registration number in Settings > Business profile", async () => {
      await page.goto("/app/settings/business");
      const field = page.getByLabel(/vat (registration )?number/i);
      await expect(field, "Business profile has a VAT number field").toBeVisible();
      await field.fill(vat);
      await page.getByRole("button", { name: /^save/i }).filter({ visible: true }).first().click();
      const business = await api<{ vatNumber?: string | null }>(request, owner, "GET", `/identity/businesses/${owner.businessId}`);
      expect(business.vatNumber).toBe(vat);
    });

    const customer = await seedCustomer(request, owner);
    const taxed = await seedInvoice(request, owner, customer.id, { taxRate: 12.5 });
    const untaxed = await seedInvoice(request, owner, customer.id);
    const visitor = await anonymousContext(browser, { who: "customer" });
    const view = await visitor.newPage();

    await test.step("the taxed invoice shows it to the owner and the customer; the untaxed one does not", async () => {
      await openInvoice(page, taxed);
      await expect.soft(page.getByText(vat).first(), "the owner's invoice page").toBeVisible();
      await view.goto(`/public/invoice/${await paymentLink(request, owner, taxed.id)}`);
      await expect.soft(view.getByText(vat).first(), "the customer's invoice page").toBeVisible();
      await view.goto(`/public/invoice/${await paymentLink(request, owner, untaxed.id)}`);
      await expect(view.getByText(untaxed.invoiceNumber).first()).toBeVisible();
      await expect.soft(view.getByText(vat), "no VAT number when no tax is charged").toHaveCount(0);
    });

    await test.step("the receipt of the paid taxed invoice shows it", async () => {
      const token = await paymentLink(request, owner, taxed.id);
      await api(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices/${taxed.id}/payments`, { amount: Number(taxed.total), method: "Cash", idempotencyKey: `${taxed.id}-full` });
      await view.goto(`/public/invoice/${token}`);
      await expect.soft(view.getByText(/receipt/i).first(), "the paid invoice's page is the receipt").toBeVisible();
      await expect.soft(view.getByText(vat).first(), "the receipt").toBeVisible();
    });

    await test.step("the taxed invoice's PDF carries it", async () => {
      await openInvoice(page, taxed);
      const download = await invoiceAction(page, /download pdf/i);
      expect(download, "Download PDF").not.toBeNull();
      const [file] = await Promise.all([page.waitForEvent("download"), download!.click()]);
      const bytes = await (await import("node:fs/promises")).readFile(await file.path());
      expect(bytes.toString("latin1")).toContain(vat);
    });
  });

  test("E5 a draft cannot be shared", async ({ page, request, owner }) => {
    test.setTimeout(3 * 60_000);
    const customer = await seedCustomer(request, owner);
    const draft = await seedInvoice(request, owner, customer.id, { status: "DRAFT" });
    await test.step("the draft's page offers no WhatsApp, Copy link or payment link", async () => {
      await openInvoice(page, draft);
      const names = await visibleActionNames(page);
      const menu = page.getByRole("button", { name: /^(actions|more|more actions|options)$/i }).filter({ visible: true });
      if (await menu.count()) {
        await menu.first().click();
        names.push(...(await page.getByRole("menuitem").filter({ visible: true }).allInnerTexts()));
        await page.keyboard.press("Escape");
      }
      expect.soft(names.filter((n) => /whatsapp|copy (payment )?link|share|payment link/i.test(n)), "share doors on a draft").toEqual([]);
    });
    await test.step("the server refuses a customer link for a draft", async () => {
      const res = await request.post(`${API_URL}/commerce/businesses/${owner.businessId}/invoices/${draft.id}/payment-link`, { headers: auth(owner), data: {} });
      expect.soft(res.status(), "POST payment-link on a DRAFT").toBe(409);
    });
  });

  test("E6 once issued, 'WhatsApp' and 'Copy link' share /public/invoice/<token>", async ({ page, request, owner, browser }) => {
    test.setTimeout(4 * 60_000);
    const customer = await seedCustomer(request, owner);
    const invoice = await seedInvoice(request, owner, customer.id);
    await openInvoice(page, invoice);
    let link = "";

    await test.step("Copy link copies /public/invoice/<token>, and the customer can open it", async () => {
      const copy = await invoiceAction(page, /^copy (payment )?link$/i);
      expect(copy, "the issued invoice offers Copy link").not.toBeNull();
      link = await copiedBy(page, () => copy!.click());
      expect(link).toMatch(/\/public\/invoice\/[A-Za-z0-9_-]{16,}/);
      const visitor = await anonymousContext(browser, { who: "customer" });
      const view = await visitor.newPage();
      await view.goto(new URL(link).pathname);
      await expect(view.getByText(invoice.invoiceNumber).first()).toBeVisible();
    });

    await test.step("WhatsApp opens a chat with the customer's own number and the same link", async () => {
      await openInvoice(page, invoice);
      const control = await invoiceAction(page, /whatsapp/i);
      expect(control, `the issued invoice offers WhatsApp (offers: ${JSON.stringify(await visibleActionNames(page))})`).not.toBeNull();
      const target = new URL(await whatsAppTarget(page, control!));
      expect(target.pathname.replace(/\D/g, "") || target.searchParams.get("phone")).toBe(customer.e164Digits);
      expect(target.searchParams.get("text") ?? "").toContain(new URL(link).pathname);
    });
  });

  test("E7 the owner records a part payment in cash and the balance by bank transfer; the customer gets a receipt link", async ({ page, request, owner, browser }) => {
    test.setTimeout(5 * 60_000);
    const customer = await seedCustomer(request, owner);
    const invoice = await seedInvoice(request, owner, customer.id, { total: 300 });
    await openInvoice(page, invoice);

    await test.step("100 in cash: part-paid", async () => {
      expect(await recordPayment(page, owner.businessId, invoice.id, "100", "Cash")).toBe(201);
      const read = await api<Invoice>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${invoice.id}`);
      expect(read.status).toBe("PARTIALLY_PAID");
    });

    await test.step("the balance of 200 by bank transfer: paid", async () => {
      await openInvoice(page, invoice);
      expect(await recordPayment(page, owner.businessId, invoice.id, "200", "Bank Transfer")).toBe(201);
      const read = await api<Invoice>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${invoice.id}`);
      expect(read.status).toBe("PAID");
    });

    await test.step("the owner can give the customer a receipt link, and it opens the receipt", async () => {
      await openInvoice(page, invoice);
      // A receipt door (Copy receipt link), else the invoice's own link, which for a paid invoice must open its receipt.
      let control = await invoiceAction(page, /receipt link|^(copy|share) receipt/i);
      if (!control) control = await invoiceAction(page, /^copy (payment )?link$/i);
      expect(control, `the paid invoice offers a link for the customer (offers: ${JSON.stringify(await visibleActionNames(page))})`).not.toBeNull();
      const url = await copiedBy(page, () => control!.click());
      const visitor = await anonymousContext(browser, { who: "customer" });
      const view = await visitor.newPage();
      await view.goto(new URL(url).pathname);
      await expect(view.getByText(invoice.invoiceNumber).first()).toBeVisible();
      await expect(view.getByText(/receipt/i).first(), "the customer's link opens a receipt").toBeVisible();
    });
  });

  for (const answer of ["Confirm", "Not yet"] as const) {
    test(`E8${answer === "Confirm" ? "a" : "b"} the customer says 'I've paid by bank transfer'; Needs you shows it; ${answer === "Confirm" ? "Confirm records the payment in one tap" : "'Not yet' leaves the invoice open"}`, async ({
      page,
      request,
      owner,
      browser,
    }) => {
      test.setTimeout(5 * 60_000);
      const customer = await seedCustomer(request, owner);
      const invoice = await seedInvoice(request, owner, customer.id, { total: 450 });
      const token = await paymentLink(request, owner, invoice.id);

      await test.step("the customer taps 'I've paid by bank transfer' on /pay/link", async () => {
        const visitor = await anonymousContext(browser, { who: "customer" });
        const pay = await visitor.newPage();
        await pay.goto(`/pay/link/${token}`);
        await expect(pay.getByText(invoice.invoiceNumber).first()).toBeVisible();
        const method = pay.getByRole("button", { name: /^bank transfer/i }).filter({ visible: true });
        if (await method.count()) await method.first().click();
        const claim = pay.getByRole("button", { name: /i.?ve paid by bank transfer/i });
        await expect(claim, "/pay/link offers 'I've paid by bank transfer'").toBeVisible();
        await claim.click();
        await expect(pay.getByText(new RegExp(`let ${owner.businessName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} know|notified`, "i")).first()).toBeVisible();
      });

      await test.step(`Needs you on Today shows the claim; ${answer}`, async () => {
        await page.goto("/app/command-center");
        await settle(page, 1_000);
        await page.keyboard.press("Escape");
        const needs = page.locator("section, [role=region], div").filter({ has: page.getByRole("heading", { name: /needs you/i }) }).last();
        await expect(needs, "Today's Needs you").toBeVisible();
        const item = needs.locator("li, [role=listitem], article, div").filter({ hasText: /450/ }).filter({ has: page.getByRole("button", { name: answer === "Confirm" ? /^confirm/i : /^not yet$/i }) }).last();
        await expect(item, "a Needs-you item for the claim").toBeVisible();
        await item.getByRole("button", { name: answer === "Confirm" ? /^confirm/i : /^not yet$/i }).click();
        await settle(page, 1_000);
      });

      await test.step(answer === "Confirm" ? "the payment is recorded: the invoice is paid" : "the invoice stays open, with nothing recorded", async () => {
        const read = await api<Invoice>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${invoice.id}`);
        expect(read.status).toBe(answer === "Confirm" ? "PAID" : "SENT");
      });
    });
  }

  test("E8c the owner is alerted of a bank-transfer claim (push, else email)", { tag: "@staging" }, async ({ request, owner, browser }) => {
    // GATE-STAGING-RUN: a push subscription (or none, for the email fallback) on the owner's device, and a sandbox mailbox.
    test.setTimeout(5 * 60_000);
    const customer = await seedCustomer(request, owner);
    const invoice = await seedInvoice(request, owner, customer.id, { total: 450 });
    const token = await paymentLink(request, owner, invoice.id);
    const visitor = await anonymousContext(browser, { who: "customer" });
    const pay = await visitor.newPage();
    await pay.goto(`/pay/link/${token}`);
    await pay.getByRole("button", { name: /i.?ve paid by bank transfer/i }).click();
    const mailbox = process.env.E2E_STAGING_MAILBOX_URL ?? "";
    expect(mailbox, "E2E_STAGING_MAILBOX_URL (GATE-STAGING-RUN) reads the owner's alert").not.toBe("");
    await expect
      .poll(async () => {
        const res = await request.get(`${mailbox}?to=${encodeURIComponent(owner.email)}&kind=alert`);
        return res.ok() ? JSON.stringify(await res.json()) : "";
      }, { timeout: 60_000, message: "the owner's alert arrives within a minute" })
      .toContain(invoice.invoiceNumber);
  });

  test("E9 the customer pays on /pay/link with WiPay (sandbox); the invoice is paid, the customer gets a receipt and the owner is alerted", { tag: "@staging" }, async ({ request, owner, browser }) => {
    // GATE-STAGING-RUN: the business's own WiPay sandbox key (D-105) saved in Settings > Getting paid.
    test.setTimeout(10 * 60_000);
    const customer = await seedCustomer(request, owner);
    const invoice = await seedInvoice(request, owner, customer.id, { total: 120 });
    const token = await paymentLink(request, owner, invoice.id);
    const visitor = await anonymousContext(browser, { who: "customer" });
    const pay = await visitor.newPage();
    await pay.goto(`/pay/link/${token}`);
    await pay.getByRole("button", { name: /wipay/i }).click();
    await pay.getByRole("button", { name: /^pay/i }).last().click();
    await pay.waitForURL(/wipay/i, { timeout: 60_000 });
    await pay.getByRole("button", { name: /pay|submit|approve/i }).first().click();
    await pay.waitForURL(new RegExp(`/pay/link/${token}|/public/invoice/`), { timeout: 120_000 });
    await expect(pay.getByText(/receipt|paid/i).first()).toBeVisible();
    await expect
      .poll(async () => (await api<Invoice>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${invoice.id}`)).status, { timeout: 120_000 })
      .toBe("PAID");
    // The owner is alerted (push, else email: alerts ruling D-154), read from the staging run's mailbox.
    const mailbox = process.env.E2E_STAGING_MAILBOX_URL ?? "";
    expect(mailbox, "E2E_STAGING_MAILBOX_URL (GATE-STAGING-RUN) reads the owner's alert").not.toBe("");
    await expect
      .poll(async () => {
        const res = await request.get(`${mailbox}?to=${encodeURIComponent(owner.email)}&kind=alert`);
        return res.ok() ? JSON.stringify(await res.json()) : "";
      }, { timeout: 60_000, message: "the owner's payment alert arrives within a minute" })
      .toContain(invoice.invoiceNumber);
  });

  test("E10 refund a manual payment (the whole payment)", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    const customer = await seedCustomer(request, owner);
    const invoice = await seedInvoice(request, owner, customer.id, { total: 300 });
    await api(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices/${invoice.id}/payments`, { amount: 100, method: "Cash", idempotencyKey: `${invoice.id}-cash` });
    await openInvoice(page, invoice);
    const tab = page.getByRole("tab", { name: /payments/i }).or(page.getByRole("button", { name: /^payments/i })).filter({ visible: true });
    if (await tab.count()) await tab.first().click();
    const refund = page.getByRole("button", { name: /^refund/i }).filter({ visible: true });
    await expect(refund.first(), `the cash payment offers Refund (offers: ${JSON.stringify(await visibleActionNames(page))})`).toBeVisible();
    const refunded = page.waitForResponse((r) => r.request().method() === "POST" && /refund/.test(new URL(r.url()).pathname));
    await refund.first().click();
    const confirm = page.getByRole("dialog").getByRole("button", { name: /^(refund|confirm)/i }).filter({ visible: true });
    if (await confirm.count()) await confirm.first().click();
    expect((await refunded).status()).toBeLessThan(300);
    const read = await api<Invoice & { paidAmount?: number; remaining?: number }>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${invoice.id}`);
    expect({ status: read.status, remaining: read.remaining }).toEqual({ status: "SENT", remaining: 300 });
  });

  test("E11 Duplicate keeps the client, tax, discount and notes", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    const customer = await seedCustomer(request, owner);
    const invoice = await seedInvoice(request, owner, customer.id, { total: 500, taxRate: 12.5, discount: 10, notes: "Thank you for your business" });
    await page.goto("/app/commerce/invoices");
    await settle(page, 1_000);
    const row = page.locator("tr, li, [role=row], [role=listitem], article").filter({ hasText: invoice.invoiceNumber }).last();
    await expect(row).toBeVisible();
    await row.hover();
    const direct = row.getByRole("button", { name: /^duplicate$/i }).filter({ visible: true });
    if (await direct.count()) await direct.first().click();
    else {
      const menu = await rowMenu(row);
      expect(menu, "the invoice row offers Duplicate or a More / Actions menu").not.toBeNull();
      await menu!.click();
      await page.getByRole("menuitem", { name: /duplicate/i }).or(page.getByRole("button", { name: /^duplicate$/i })).filter({ visible: true }).first().click();
    }
    await page.waitForURL(/\/app\/commerce\/invoices\/new/);
    const client = page.locator("select").filter({ has: page.locator(`option[value="${customer.id}"]`) }).first();
    await expect.soft(client, "the client").toHaveValue(customer.id);
    await expect.soft(inputAfter(page, /tax rate/i), "the tax rate").toHaveValue(/^12\.5/);
    await expect.soft(page.locator("label").filter({ hasText: /^discount$/i }).locator("xpath=..").locator('input[type="number"]'), "the discount").toHaveValue(/^10/);
    await expect.soft(page.getByPlaceholder(/notes/i).first(), "the notes").toHaveValue("Thank you for your business");
  });

  test("E12 'Download PDF' gives a one-invoice A4 document", async ({ page, request, owner }) => {
    test.setTimeout(3 * 60_000);
    const customer = await seedCustomer(request, owner);
    const invoice = await seedInvoice(request, owner, customer.id, { total: 275 });
    await openInvoice(page, invoice);
    const control = await invoiceAction(page, /download pdf/i);
    expect(control, `the invoice offers Download PDF (offers: ${JSON.stringify(await visibleActionNames(page))})`).not.toBeNull();
    const [file] = await Promise.all([page.waitForEvent("download"), control!.click()]);
    const bytes = (await (await import("node:fs/promises")).readFile(await file.path())).toString("latin1");
    expect(bytes.startsWith("%PDF"), "a PDF").toBe(true);
    expect((bytes.match(/\/Type\s*\/Page\b/g) ?? []).length, "one page").toBe(1);
    const box = bytes.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
    expect(box && [Math.round(Number(box[1])), Math.round(Number(box[2]))], "A4 (595 x 842 points)").toEqual([595, 842]);
  });

  test("E13 a voided invoice's link says it is voided", async ({ request, owner, browser }) => {
    test.setTimeout(3 * 60_000);
    const customer = await seedCustomer(request, owner);
    const invoice = await seedInvoice(request, owner, customer.id);
    const token = await paymentLink(request, owner, invoice.id);
    await api(request, owner, "PATCH", `/commerce/invoices/${invoice.id}/status/void`, { businessId: owner.businessId, status: "VOID" });
    const visitor = await anonymousContext(browser, { who: "customer" });
    const view = await visitor.newPage();
    await view.goto(`/public/invoice/${token}`);
    await expect.soft(view.getByText(/voided|has been void/i).first(), "/public/invoice/<token> says voided").toBeVisible();
    await view.goto(`/pay/link/${token}`);
    await expect.soft(view.getByText(/voided|has been void/i).first(), "/pay/link/<token> says voided").toBeVisible();
    await expect.soft(view.getByRole("button", { name: /^pay|try again/i }), "nothing to pay on a voided invoice").toHaveCount(0);
  });

  test("E14 the overdue job puts an unpaid invoice in Today's 'ready to send'; email only with Gmail", { tag: "@scheduler" }, async ({ page, request, owner }) => {
    // GATE-SCHEDULER-RUN: the schedulers run and the server clock is the run's.
    test.setTimeout(20 * 60_000);
    const customer = await seedCustomer(request, owner);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const invoice = await api<Invoice>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices`, {
      contactId: customer.id,
      currency: owner.currency,
      dueDate: yesterday,
      items: [{ description: "Overdue work", quantity: 1, unitPrice: 210 }],
    });
    await api(request, owner, "PATCH", `/commerce/invoices/${invoice.id}/status/sent`, { businessId: owner.businessId, status: "SENT", dueDate: yesterday });
    await expect
      .poll(async () => (await api<Invoice>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${invoice.id}`)).status, { timeout: 15 * 60_000, intervals: [30_000] })
      .toBe("OVERDUE");
    await page.goto("/app/command-center");
    const ready = page.locator("section, [role=region], div").filter({ has: page.getByRole("heading", { name: /ready to send/i }) }).last();
    await expect(ready.getByText(invoice.invoiceNumber).first(), "the overdue invoice is ready to send").toBeVisible();
    await expect(ready.getByRole("link", { name: /whatsapp/i }).or(ready.getByRole("button", { name: /whatsapp/i })).first()).toBeVisible();
    const gmail = await api<{ connected: boolean }>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/gmail/status`);
    // A reminder's sending is recorded on the invoice's activity (its timeline: an
    // invoice.payment_reminder_sent entry with its channel), not on the invoice row.
    const timeline = await api<{ entries: Array<{ type: string; label: string; data?: { channel?: unknown } }> }>(
      request,
      owner,
      "GET",
      `/commerce/businesses/${owner.businessId}/invoices/${invoice.id}/timeline`,
    );
    expect(timeline.entries.map((e) => e.type), "the invoice's activity is read (it names the invoice's creation)").toContain("invoice.created");
    const emailed = timeline.entries.filter(
      (e) => e.type === "invoice.payment_reminder_sent" && (/email|gmail/i.test(String(e.data?.channel ?? "")) || /\((e-?mail|gmail)\)/i.test(e.label)),
    );
    if (!gmail.connected) expect(emailed, "no reminder email without Gmail").toEqual([]);
  });
});
