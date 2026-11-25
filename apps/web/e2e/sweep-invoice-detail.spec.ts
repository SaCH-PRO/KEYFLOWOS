import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect, API_URL, settle, type Tenant } from "./journeys/journey-helpers";

/**
 * SWP-INV-DETAIL, the browser half (sweep BUG-051, BUG-084, BUG-085, BUG-086, the web side of BUG-088; journey E;
 * FCP-COR-1 for journey C4). The jsdom half is src/app/app/commerce/invoices/__tests__/invoice-detail-actions.test.tsx;
 * the server half (sentAt stamped on DRAFT -> SENT, one invoice.sent activity) is
 * apps/server/test/invoice-sent-at.integration.test.ts.
 *
 * For a fresh TTD owner on a real API and database (live only: E2E_LIVE=1, a production build; the journey harness's
 * fixtures, README in e2e/journeys; without E2E_LIVE every case is skipped), with a customer and two invoices seeded
 * through the real routes (one SENT with a cash payment of 100 on its 300, one DRAFT), at 1440x900, 1024x768, 768x1024
 * and 375x812, on /app/commerce/invoices/:id (each case on its own fresh tenant, so each bug shows on its own):
 *   1. BUG-085: "Amount due" is what is still owed (200 of 300), the Payment Summary's Remaining;
 *   2. BUG-084: a payment of 50 recorded on the page before the Payments tab is opened is listed beside the earlier
 *      one (two rows), and Amount due follows it (150);
 *   3. BUG-086: the draft offers no Mark paid (on its page, shown or in its More menu, nor in the Invoices list's row
 *      menu) and no Copy payment link;
 *   4. BUG-088: Send -> Confirm & Send lists 'Invoice sent' in the Activity tab without a reload, and the server's
 *      timeline has exactly one invoice.sent entry;
 *   5. BUG-086 / BUG-084: the now-sent invoice offers Mark paid; it lists the balancing payment, and nothing is due;
 *   6. BUG-051: Print prints the invoice alone: when the browser prints (print media, the window.print the page
 *      calls is recorded instead of opening a dialog), only the invoice sheet is shown (no app navigation, tabs or
 *      buttons), with the invoice's number, customer, line, total and balance due; and page.pdf() of it is one page;
 *   7. BUG-051: Download PDF downloads a one-page A4 PDF of the invoice;
 *   8. FCP-COR-1: the customer is a link that opens /app/crm/contacts/:id.
 *
 *   E2E_LIVE=1 E2E_VARIANT=ai-disabled E2E_API_URL=... E2E_JWT_SECRET=... E2E_WEB_COMMAND=standalone \
 *     E2E_PORT=... E2E_BASE_URL=... npx playwright test e2e/sweep-invoice-detail.spec.ts --project=chromium
 */

const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;

async function api<T = Record<string, unknown>>(request: APIRequestContext, owner: Tenant, method: "GET" | "POST" | "PATCH", path: string, data?: unknown): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, { method, headers: { Authorization: `Bearer ${owner.token}` }, data });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 400)}`).toBe(method === "POST" ? 201 : 200);
  return (text ? JSON.parse(text) : null) as T;
}

interface Seeded {
  contactId: string;
  contactName: string;
  part: { id: string; invoiceNumber: string };
  draft: { id: string; invoiceNumber: string };
}

async function seed(request: APIRequestContext, owner: Tenant): Promise<Seeded> {
  const biz = owner.businessId;
  const last = `Detail${stamp()}`;
  const contact = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${biz}/contacts`, {
    firstName: "Rena",
    lastName: last,
    email: `${last.toLowerCase()}@v64.test.local`,
  });
  const make = () =>
    api<{ id: string; invoiceNumber: string }>(request, owner, "POST", `/commerce/businesses/${biz}/invoices`, {
      contactId: contact.id,
      currency: owner.currency,
      items: [{ description: "Tent hire", quantity: 1, unitPrice: 300 }],
    });
  const part = await make();
  await api(request, owner, "PATCH", `/commerce/invoices/${part.id}/status/sent`, { businessId: biz, status: "SENT" });
  await api(request, owner, "POST", `/commerce/businesses/${biz}/invoices/${part.id}/payments`, { amount: 100, method: "Cash", idempotencyKey: `${part.id}-cash` });
  const draft = await make();
  return { contactId: contact.id, contactName: `Rena ${last}`, part, draft };
}

async function openInvoice(page: Page, invoice: { id: string; invoiceNumber: string }): Promise<void> {
  await page.goto(`/app/commerce/invoices/${invoice.id}`);
  await expect(page.getByRole("heading", { level: 1, name: `Invoice ${invoice.invoiceNumber}` })).toBeVisible();
}

/** The "Amount due" card's value. */
const amountDue = (page: Page): Locator => page.getByText("Amount due", { exact: true }).locator("xpath=../following-sibling::p[1]");
/** The Payment Summary's Remaining. */
const remaining = (page: Page): Locator =>
  page.locator("h3", { hasText: /^Payment Summary$/i }).locator("xpath=..").locator("span", { hasText: /^Remaining$/ }).locator("xpath=following-sibling::span[1]");
const paymentRows = (page: Page): Locator => page.locator("[data-testid='invoice-payment-row']");
const shown = (page: Page, name: RegExp | string): Locator =>
  page.getByRole("button", typeof name === "string" ? { name, exact: true } : { name }).filter({ visible: true });

async function recordPayment(page: Page, businessId: string, invoiceId: string, amount: string): Promise<void> {
  await shown(page, /^record payment$/i).first().click();
  const modal = page.locator("div", { has: page.getByRole("heading", { name: "Record Payment" }) }).last();
  await modal.locator('input[type="number"]').first().fill(amount);
  const recorded = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/commerce/businesses/${businessId}/invoices/${invoiceId}/payments`);
  await modal.getByRole("button", { name: "Record Payment" }).click();
  expect((await recorded).status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Record Payment" })).toHaveCount(0);
}

/** What a print shows: the invoice sheet, and anything else beside it under body that is still drawn. */
async function printedView(page: Page) {
  return page.evaluate(() => {
    const drawn = (el: Element) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };
    const sheet = document.querySelector<HTMLElement>("[data-invoice-print]");
    const others = Array.from(document.body.children)
      .filter((el) => el !== sheet && drawn(el))
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}: ${((el as HTMLElement).innerText ?? "").replace(/\s+/g, " ").slice(0, 60)}`);
    return { sheet: !!sheet && drawn(sheet), text: sheet?.innerText ?? "", others };
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]) {
  test.describe(`SWP-INV-DETAIL the invoice page (${viewport.width}x${viewport.height})`, () => {
    test.use(viewport.width < 600 ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport });
    test.use({ tenantOptions: { currency: "TTD" } });

    test("BUG-085 / BUG-084: Amount due is the balance; a payment recorded before the Payments tab is opened is listed beside the earlier one", async ({ page, request, owner }) => {
      test.setTimeout(4 * 60_000);
      const s = await seed(request, owner);
      await openInvoice(page, s.part);
      await settle(page, 500);

      await test.step("BUG-085: Amount due is what is still owed (200 of 300)", async () => {
        await expect(remaining(page)).toHaveText("TTD 200.00");
        await expect(amountDue(page)).toHaveText("TTD 200.00");
      });

      await test.step("BUG-084: the payment of 50 recorded first is listed beside the cash 100 (two rows); Amount due follows it", async () => {
        await recordPayment(page, owner.businessId, s.part.id, "50");
        await expect(remaining(page)).toHaveText("TTD 150.00");
        await expect(amountDue(page)).toHaveText("TTD 150.00");
        await shown(page, /^Payments/).first().click();
        await expect(paymentRows(page).filter({ hasText: "TTD 50.00" })).toHaveCount(1);
        await expect(paymentRows(page).filter({ hasText: "TTD 100.00" })).toHaveCount(1);
        await expect(paymentRows(page)).toHaveCount(2);
      });
    });

    test("BUG-051: Print prints the invoice alone", async ({ page, request, owner }, testInfo) => {
      test.setTimeout(4 * 60_000);
      const s = await seed(request, owner);
      await openInvoice(page, s.part);
      await settle(page, 500);
      await page.evaluate(() => {
        const w = window as unknown as { __kfPrinted: number };
        w.__kfPrinted = 0;
        window.print = () => { w.__kfPrinted += 1; };
      });
      await shown(page, /^print/i).first().click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __kfPrinted: number }).__kfPrinted)).toBe(1);
      await page.emulateMedia({ media: "print" });
      try {
        const view = await printedView(page);
        await testInfo.attach(`print-${viewport.width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
        expect(view.others, "nothing but the invoice is drawn when printing").toEqual([]);
        expect(view.sheet, "the invoice sheet is drawn when printing").toBe(true);
        for (const part of [s.part.invoiceNumber, s.contactName, "Tent hire", "TTD 300.00", "Balance due", "TTD 200.00"]) expect(view.text, part).toContain(part);
        expect(view.text).not.toMatch(/Record Payment|Mark paid|Copy payment link|Download PDF/);
        const pdf = (await page.pdf({ format: "A4" })).toString("latin1");
        expect((pdf.match(/\/Type\s*\/Page\b/g) ?? []).length, "the printed invoice is one page").toBe(1);
      } finally {
        await page.emulateMedia({ media: null });
      }
      await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
      await expect(page.locator("[data-invoice-print]")).toHaveCount(0);
    });

    test("BUG-051: Download PDF downloads a one-page A4 PDF of the invoice", async ({ page, request, owner }) => {
      test.setTimeout(4 * 60_000);
      const s = await seed(request, owner);
      await openInvoice(page, s.part);
      await settle(page, 500);
      const control = shown(page, /download pdf/i);
      await expect(control.first(), "the invoice offers Download PDF").toBeVisible();
      const [file] = await Promise.all([page.waitForEvent("download"), control.first().click()]);
      expect(file.suggestedFilename()).toBe(`${s.part.invoiceNumber}.pdf`);
      const bytes = (await (await import("node:fs/promises")).readFile(await file.path())).toString("latin1");
      expect(bytes.startsWith("%PDF"), "a PDF").toBe(true);
      expect((bytes.match(/\/Type\s*\/Page\b/g) ?? []).length, "one page").toBe(1);
      const box = bytes.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
      expect(box && [Math.round(Number(box[1])), Math.round(Number(box[2]))], "A4 (595 x 842 points)").toEqual([595, 842]);
      for (const part of [s.part.invoiceNumber, s.contactName, "Tent hire", "Balance due", "200.00"]) expect(bytes, part).toContain(part);
    });

    test("FCP-COR-1: the customer is a link that opens /app/crm/contacts/:id", async ({ page, request, owner }) => {
      test.setTimeout(4 * 60_000);
      const s = await seed(request, owner);
      await openInvoice(page, s.part);
      const link = page.getByRole("link", { name: new RegExp(s.contactName) }).filter({ visible: true });
      await expect(link.first(), "the invoice links its customer").toBeVisible();
      await link.first().click();
      await page.waitForURL(new RegExp(`/app/crm/contacts/${s.contactId}`));
    });

    test("BUG-086 / BUG-088: no Mark paid on a draft (its page or the list's row menu); Send records 'Invoice sent'; the sent invoice is marked paid", async ({ page, request, owner }) => {
      test.setTimeout(4 * 60_000);
      const s = await seed(request, owner);
      const biz = owner.businessId;

      await test.step("BUG-086: the draft offers no Mark paid (its page or the Invoices list's row menu) and no Copy payment link", async () => {
        await page.goto("/app/commerce/invoices");
        await expect(page.getByRole("heading", { name: "Invoices", exact: true })).toBeVisible();
        const row = page.locator("tr").filter({ hasText: s.draft.invoiceNumber }).first();
        await expect(row).toBeVisible();
        await row.locator("button").last().click();
        await expect(shown(page, /^send$/i).first(), "the draft's row menu is open").toBeVisible();
        await expect(shown(page, /mark paid/i), "Mark paid in the draft's row menu").toHaveCount(0);
        await page.keyboard.press("Escape");

        await openInvoice(page, s.draft);
        await settle(page, 500);
        await expect(page.getByRole("button", { name: /mark paid/i, includeHidden: true }), "Mark paid on the draft's page (shown or in its More menu)").toHaveCount(0);
        await expect(page.getByRole("button", { name: /copy (payment )?link/i, includeHidden: true })).toHaveCount(0);
      });

      await test.step("BUG-088: Send -> Confirm & Send lists 'Invoice sent' without a reload; the server records it once", async () => {
        await shown(page, "Send").click();
        await expect(page.getByRole("heading", { name: "Send Invoice" })).toBeVisible();
        const sent = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(s.draft.id) && /status/i.test(r.url()));
        await page.getByRole("button", { name: /confirm & send/i }).click();
        expect((await sent).status()).toBeLessThan(300);
        await expect(page.getByRole("heading", { level: 1, name: `Invoice ${s.draft.invoiceNumber}` }).locator("xpath=following-sibling::span[1]")).toHaveText("Sent");
        // The Activity tab's entry (its label and its date), not the toast that says the same words.
        await expect(page.locator('p:text-is("Invoice sent") + p'), "'Invoice sent' in the Activity tab").toBeVisible();
        const timeline = await api<{ entries: Array<{ type: string }> }>(request, owner, "GET", `/commerce/businesses/${biz}/invoices/${s.draft.id}/timeline`);
        expect(timeline.entries.filter((e) => e.type === "invoice.sent")).toHaveLength(1);
      });

      await test.step("BUG-086 / BUG-084: the sent invoice offers Mark paid; it lists the balancing payment and nothing is due", async () => {
        await shown(page, /^Payments/).first().click();
        await expect(page.getByText("No payments recorded yet.")).toBeVisible();
        const markPaid = shown(page, /^mark paid$/i);
        await expect(markPaid.first(), "the sent invoice offers Mark paid").toBeVisible();
        const paid = page.waitForResponse((r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === `/commerce/invoices/${s.draft.id}/paid`);
        await markPaid.first().click();
        expect((await paid).status()).toBe(200);
        await expect(paymentRows(page)).toHaveCount(1);
        await expect(paymentRows(page).first()).toContainText("TTD 300.00");
        await expect(amountDue(page)).toHaveText("TTD 0.00");
        await expect(remaining(page)).toHaveText("TTD 0.00");
        await expect(page.getByRole("heading", { level: 1, name: `Invoice ${s.draft.invoiceNumber}` }).locator("xpath=following-sibling::span[1]")).toHaveText("Paid");
      });
    });
  });
}
