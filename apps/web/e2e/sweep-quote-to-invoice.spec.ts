import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect, API_URL, settle, type Tenant } from "./journeys/journey-helpers";
import { JOURNEY_VIEWPORTS } from "./journeys/harness-settings";

/**
 * MOUNT-QUOTES, the browser half (BUG-003, 033, 044, 045, 098 to 102, 132;
 * journey D reads the same screen). The jsdom half is
 * src/app/app/commerce/__tests__/commerce-no-pipeline-tab.test.tsx and
 * src/app/app/commerce/quotes/__tests__/quotes-panel-mounted.test.tsx.
 *
 * For a fresh owner on a real API and database, with a draft quote and an
 * accepted quote seeded through the real routes:
 *   1. Sales > Quotes (/app/commerce?tab=pipeline&view=quotes, the door the
 *      journeys use, and /app/commerce?tab=quotes) is the quotes panel: no
 *      Pipeline tab, the quotes' search box, both quotes listed;
 *   2. the draft offers Edit; the edit sheet saves the notes (PATCH 200) and
 *      the API reads them back;
 *   3. ticking the draft's checkbox opens no dialog, and the bulk bar's Status
 *      menu offers Send All and Reject All and no Void (BUG-033);
 *   4. the accepted quote offers Copy link, which copies its /quote/<token>;
 *   5. the accepted quote offers Convert; the convert creates the invoice
 *      (POST 201) carrying the quote's notes, tax and discount (BUG-003, 102);
 *   6. the invoices door (?tab=pipeline&view=invoices) lands on
 *      /app/commerce/invoices, and the collections door
 *      (?tab=pipeline&view=collections) shows the Collections Health card.
 *
 * Both viewports of the journey gate run: 1440x900 and 375x812. Live only
 * (E2E_LIVE=1, a production build, a real API and database: the journey
 * harness's own fixtures, README in e2e/journeys); without E2E_LIVE every case
 * is skipped, so the mocked CI job is unaffected. Run it in the "chromium"
 * project:
 *
 *   E2E_LIVE=1 E2E_VARIANT=ai-disabled E2E_API_URL=... E2E_JWT_SECRET=... \
 *     E2E_NO_SERVER=1 E2E_BASE_URL=... npx playwright test e2e/sweep-quote-to-invoice.spec.ts --project=chromium
 *
 * RED at main 9a7b5011: step 1 finds the Pipeline tab and no quotes search box,
 * and step 5 finds no Convert on the accepted quote (BUG-003).
 */

const NOTES = "50% deposit to confirm the date";

async function api<T = Record<string, unknown>>(
  request: APIRequestContext,
  owner: Tenant,
  method: "GET" | "POST" | "PATCH",
  path: string,
  data?: unknown,
): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, { method, headers: { Authorization: `Bearer ${owner.token}` }, data });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 400)}`).toBe(method === "POST" ? 201 : 200);
  return (text ? JSON.parse(text) : null) as T;
}

interface Quote {
  id: string;
  quoteNumber: string;
  status: string;
  taxRate: number;
  discountType: string | null;
  discountValue: number;
  notes: string | null;
  invoiceId: string | null;
  viewToken: string | null;
  items: Array<{ description: string; quantity: number; unitPrice: number }>;
}

const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;

/** A customer and two quotes as the composer saves them: a draft, and one the customer accepted. */
async function seedQuotes(request: APIRequestContext, owner: Tenant): Promise<{ draft: Quote; accepted: Quote }> {
  const contact = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts`, {
    firstName: "Maria",
    lastName: `Quote${stamp()}`,
    phone: `+18687${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
  });
  const make = () =>
    api<Quote>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/quotes`, {
      contactId: contact.id,
      currency: owner.currency,
      items: [
        { description: "Wedding cake, 3 tier", quantity: 1, unitPrice: 800 },
        { description: "Cupcakes", quantity: 24, unitPrice: 10 },
      ],
      taxRate: 12.5,
      discountType: "PERCENT",
      discountValue: 10,
      notes: NOTES,
    });
  const read = (id: string) => api<Quote>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/quotes/${id}`);
  const draft = await make();
  const toAccept = await make();
  const sent = await api<Quote>(request, owner, "PATCH", `/commerce/quotes/${toAccept.id}/status/sent`, { businessId: owner.businessId });
  const view = await api<{ termsVersion: string }>(request, owner, "GET", `/commerce/public/quotes/${sent.viewToken}`);
  await api(request, owner, "POST", `/commerce/public/quotes/${sent.viewToken}/accept`, { termsVersion: view.termsVersion });
  return { draft: await read(draft.id), accepted: { ...(await read(toAccept.id)), viewToken: sent.viewToken } };
}

/** The row of a list that shows `text`: a structural row around it, else the card around it. */
async function rowOf(page: Page, text: string): Promise<Locator> {
  const structural = page.locator("tr, li, [role=row], [role=listitem], article").filter({ hasText: text });
  if (await structural.count()) return structural.last();
  const label = page.getByText(text, { exact: true }).first();
  await expect(label, `a row showing ${text}`).toBeVisible();
  return label.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' group ')][1]");
}

/** The row's More / Actions menu trigger, else the row's last unnamed icon button, or null. */
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

/** An action a row offers, on the row or in its menu; null when it offers none. */
async function findRowAction(page: Page, row: Locator, name: RegExp): Promise<Locator | null> {
  await row.hover().catch(() => {});
  const direct = row.getByRole("button", { name }).or(row.getByRole("link", { name })).filter({ visible: true });
  if (await direct.count()) return direct.first();
  const menu = await rowMenu(row);
  if (!menu) return null;
  if (!(await menu.click({ timeout: 5_000 }).then(() => true).catch(() => false))) return null;
  const item = page.getByRole("menuitem", { name }).or(page.getByRole("button", { name })).filter({ visible: true });
  if (await item.count()) return item.first();
  await page.keyboard.press("Escape");
  return null;
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

/** Waits until a sheet has finished sliding in (its transform settles), so its buttons hold still. */
async function settled(sheet: Locator): Promise<void> {
  await expect
    .poll(() => sheet.evaluate((el) => getComputedStyle(el).transform), { message: "the sheet finished sliding in", timeout: 10_000 })
    .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
}

async function openQuotes(page: Page, door = "/app/commerce?tab=pipeline&view=quotes"): Promise<void> {
  await page.goto(door);
  await settle(page, 1_000);
  await page.keyboard.press("Escape");
}

for (const [project, viewport] of Object.entries(JOURNEY_VIEWPORTS)) {
  test.describe(`MOUNT-QUOTES Sales > Quotes (${project} ${viewport.width}x${viewport.height})`, () => {
    test.use(project === "phone" ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport });
    test.use({ tenantOptions: { currency: "TTD" } });

    test("the quotes panel is the Quotes tab: edit a draft, tick without opening, no bulk Void, Copy link, Convert keeps the notes, the other doors land", async ({ page, request, owner }) => {
      test.setTimeout(6 * 60_000);
      const { draft, accepted } = await seedQuotes(request, owner);

      await test.step("1. Sales > Quotes is the quotes panel, with no Pipeline tab", async () => {
        for (const door of ["/app/commerce?tab=pipeline&view=quotes", "/app/commerce?tab=quotes"]) {
          await openQuotes(page, door);
          await expect(page.getByPlaceholder("Search quotes..."), `${door}: the quotes' search box`).toBeVisible({ timeout: 20_000 });
          expect(await page.getByRole("button", { name: /^pipeline$/i }).or(page.getByRole("tab", { name: /^pipeline$/i })).count(), `${door}: no Pipeline tab`).toBe(0);
          await expect(page.getByText(draft.quoteNumber, { exact: true }).first(), `${door}: the draft is listed`).toBeVisible();
          await expect(page.getByText(accepted.quoteNumber, { exact: true }).first(), `${door}: the accepted quote is listed`).toBeVisible();
          expect(new URL(page.url()).searchParams.get("tab"), `${door}: the URL names the Quotes tab`).toBe("quotes");
        }
      });

      await test.step("2. the draft offers Edit; the sheet saves the notes", async () => {
        const row = await rowOf(page, draft.quoteNumber);
        const edit = await findRowAction(page, row, /^edit/i);
        expect(edit, `the draft ${draft.quoteNumber} offers Edit (BUG-045)`).not.toBeNull();
        await edit!.click();
        const sheet = page.getByRole("dialog", { name: /edit quote/i });
        await expect(sheet).toBeVisible();
        await settled(sheet);
        await sheet.getByPlaceholder(/notes/i).fill("Deposit 40% to confirm");
        await settled(sheet);
        const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && new URL(r.url()).pathname.endsWith(`/quotes/${draft.id}`));
        await sheet.getByRole("button", { name: /^(update|save)/i }).click();
        expect((await saved).status()).toBe(200);
        const read = await api<Quote>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/quotes/${draft.id}`);
        expect(read.notes).toBe("Deposit 40% to confirm");
        await expect(sheet).toHaveCount(0);
      });

      await test.step("3. ticking the draft opens nothing; the bulk Status menu offers Send All and Reject All, no Void", async () => {
        await openQuotes(page);
        await page.getByLabel(`Select quote ${draft.quoteNumber}`).check();
        expect(await page.getByRole("dialog").filter({ visible: true }).count(), "ticking a row opens no dialog").toBe(0);
        const status = page.getByRole("button", { name: /^status$/i }).filter({ visible: true });
        await expect(status, "the bulk bar's Status").toBeVisible();
        await status.click();
        const options = await page.locator("button").filter({ visible: true }).evaluateAll((els) =>
          els.map((e) => (e.textContent ?? "").trim()).filter((t) => t === "Send All" || t === "Reject All" || /void/i.test(t)),
        );
        expect(options, "the bulk statuses (BUG-033)").toEqual(["Send All", "Reject All"]);
        await page.keyboard.press("Escape");
        await page.getByLabel(`Select quote ${draft.quoteNumber}`).uncheck().catch(() => {});
      });

      await test.step("4. the accepted quote offers Copy link, which copies its /quote/<token>", async () => {
        await openQuotes(page);
        const row = await rowOf(page, accepted.quoteNumber);
        const control = await findRowAction(page, row, /copy link/i);
        expect(control, "the accepted quote offers Copy link (BUG-044)").not.toBeNull();
        const copied = await copiedBy(page, () => control!.click());
        expect(copied).toContain(`/quote/${accepted.viewToken}`);
      });

      let invoiceId: string | null = null;
      await test.step("5. Convert on the accepted quote creates the invoice carrying the notes, tax and discount", async () => {
        await openQuotes(page);
        const row = await rowOf(page, accepted.quoteNumber);
        const convert = await findRowAction(page, row, /convert/i);
        expect(convert, `the accepted ${accepted.quoteNumber} offers Convert (BUG-003)`).not.toBeNull();
        const converted = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith(`/quotes/${accepted.id}/convert`));
        await convert!.click();
        const dialog = page.getByRole("dialog").or(page.getByText("Convert Quote to Invoice")).filter({ visible: true });
        await expect(dialog.first()).toBeVisible();
        await expect(page.getByPlaceholder(/payment terms or notes/i), "the convert form carries the quote's notes").toHaveValue(NOTES);
        await page.getByRole("button", { name: /^create invoice$/i }).filter({ visible: true }).first().click();
        const res = await converted;
        expect(res.status(), await res.text()).toBe(201);
        invoiceId = ((await res.json()) as { id: string }).id;
        const invoice = await api<Quote>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${invoiceId}`);
        expect(invoice.notes, "the quote's notes (deposit terms) on the invoice (BUG-102)").toBe(NOTES);
        expect({ taxRate: Number(invoice.taxRate), discountType: invoice.discountType, discountValue: Number(invoice.discountValue) }).toEqual({ taxRate: 12.5, discountType: "PERCENT", discountValue: 10 });
        const quote = await api<Quote>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/quotes/${accepted.id}`);
        expect(quote.invoiceId).toBe(invoiceId);
      });

      await test.step("6. the invoices and collections doors land on real screens", async () => {
        await page.goto("/app/commerce?tab=pipeline&view=invoices");
        await page.waitForURL(/\/app\/commerce\/invoices(\?|$)/, { timeout: 20_000 });
        await page.goto("/app/commerce?tab=pipeline&view=collections");
        await settle(page, 1_000);
        await expect(page.getByText("Collections Health", { exact: true }).first(), "the Collections tab shows the pipeline's collections view").toBeVisible({ timeout: 20_000 });
        expect(new URL(page.url()).searchParams.get("tab")).toBe("collections");
      });
    });
  });
}
