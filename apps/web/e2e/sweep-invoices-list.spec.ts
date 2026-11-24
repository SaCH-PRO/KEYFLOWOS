import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect, API_URL, settle, type Tenant } from "./journeys/journey-helpers";

/**
 * SWP-INV-LIST, the browser half (sweep BUG-007, BUG-050, BUG-070, BUG-089, BUG-131, BUG-047; journeys D and E read
 * the same list). The jsdom half is src/app/app/commerce/invoices/__tests__/invoices-list.test.tsx.
 *
 * For a fresh TTD owner on a real API and database (live only: E2E_LIVE=1, a production build; the journey harness's
 * fixtures, README in e2e/journeys; without E2E_LIVE every case is skipped), with invoices seeded through the real
 * routes, at 1440x900 and 375x812, on /app/commerce/invoices:
 *   1. BUG-007: the Unpaid card is the TTD invoices' figure and never adds the USD one; a line says one invoice in
 *      another currency is listed and not added in;
 *   2. BUG-070: each card is readable: its amount and label have a contrast of at least 4.5:1 against the card, in
 *      the app's dark and light themes (each stored as next-themes' choice and reloaded) (the cards kept their light-mode pastel backgrounds in dark mode, so the
 *      amounts were near-white on near-white), and the amount stays inside the card;
 *   3. BUG-089: the Unpaid card lists the part-paid invoice it counts;
 *   4. BUG-131: the voided invoice's row says nothing is due;
 *   5. BUG-047: the part-paid row offers Record balance and Remind; Remind opens WhatsApp with the balance and the link;
 *   6. BUG-050: Duplicate opens New Invoice with the client, the tax, the discount and the notes filled in.
 *
 *   E2E_LIVE=1 E2E_VARIANT=ai-disabled E2E_API_URL=... E2E_JWT_SECRET=... \
 *     E2E_NO_SERVER=1 E2E_BASE_URL=... npx playwright test e2e/sweep-invoices-list.spec.ts --project=chromium
 */

const DAY = 24 * 60 * 60 * 1000;
const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;

async function api<T = Record<string, unknown>>(request: APIRequestContext, owner: Tenant, method: "POST" | "PATCH", path: string, data: unknown): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, { method, headers: { Authorization: `Bearer ${owner.token}` }, data });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 400)}`).toBe(method === "POST" ? 201 : 200);
  return (text ? JSON.parse(text) : null) as T;
}

interface Seeded { contactId: string; contactName: string; usd: string; sent: string; part: string; voided: string; dup: string; dupNotes: string }

async function seed(request: APIRequestContext, owner: Tenant): Promise<Seeded> {
  const biz = owner.businessId;
  // Several invoices: the owner moves to Flow (the manual activation the owner may record, D-162), as journey E does.
  await api(request, owner, "POST", `/subscriptions/businesses/${biz}/record-payment`, { plan: "FLOW", currency: owner.currency, method: "manual", reference: "sweep SWP-INV-LIST" });
  const last = `List${stamp()}`;
  const contact = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${biz}/contacts`, { firstName: "Rena", lastName: last, whatsappNumber: "+18687550145" });
  const make = async (over: Record<string, unknown>) =>
    api<{ id: string; invoiceNumber: string; total: number }>(request, owner, "POST", `/commerce/businesses/${biz}/invoices`, {
      contactId: contact.id, items: [{ description: "Event styling", quantity: 1, unitPrice: 100 }], ...over,
    });
  const send = (id: string) => api(request, owner, "PATCH", `/commerce/invoices/${id}/status/sent`, { businessId: biz, status: "SENT" });

  const usd = await make({ currency: "USD", items: [{ description: "Event styling", quantity: 1, unitPrice: 1000 }] });
  await send(usd.id);
  const sent = await make({ currency: "TTD" });
  await send(sent.id);
  const part = await make({ currency: "TTD", items: [{ description: "Tent hire", quantity: 1, unitPrice: 300 }] });
  await send(part.id);
  await api(request, owner, "POST", `/commerce/businesses/${biz}/invoices/${part.id}/payments`, { amount: 100, method: "Cash", idempotencyKey: `${part.id}-part` });
  const voided = await make({ currency: "TTD", dueDate: new Date(Date.now() + 7 * DAY).toISOString() });
  await send(voided.id);
  await api(request, owner, "PATCH", `/commerce/invoices/${voided.id}/status/void`, { businessId: biz, status: "VOID" });
  const dupNotes = `Deposit 50% to confirm ${stamp()}`;
  const dup = await make({ currency: "TTD", taxRate: 12.5, discountType: "FIXED", discountValue: 20, notes: dupNotes });
  return { contactId: contact.id, contactName: `Rena ${last}`, usd: usd.invoiceNumber, sent: sent.invoiceNumber, part: part.invoiceNumber, voided: voided.invoiceNumber, dup: dup.invoiceNumber, dupNotes };
}

const statCard = (page: Page, label: string): Locator => page.locator("button").filter({ has: page.getByText(label, { exact: true }) }).first();
const rowOf = (page: Page, invoiceNumber: string): Locator => page.locator("tr").filter({ hasText: invoiceNumber }).first();

async function openRowMenu(page: Page, invoiceNumber: string): Promise<void> {
  await rowOf(page, invoiceNumber).locator("button").last().click();
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test.describe(`SWP-INV-LIST the Invoices list (${viewport.width}x${viewport.height})`, () => {
    test.use(viewport.width < 600 ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport });
    test.use({ tenantOptions: { currency: "TTD" } });

    test("business currency, readable cards, Unpaid lists part-paid, no 'Due in' on void, part-paid actions, Duplicate keeps tax/discount/notes", async ({ page, request, owner }) => {
      test.setTimeout(4 * 60_000);
      const s = await seed(request, owner);
      // Remind opens wa.me in a new tab: record the URL instead.
      await page.addInitScript(() => {
        (window as unknown as { __opened: string[] }).__opened = [];
        window.open = ((url?: string | URL) => { (window as unknown as { __opened: string[] }).__opened.push(String(url)); return null; }) as typeof window.open;
      });
      await page.goto("/app/commerce/invoices");
      await expect(page.getByRole("heading", { name: "Invoices", exact: true })).toBeVisible();
      await settle(page, 1_000);

      await test.step("BUG-007: the Unpaid card is TTD's and never adds the USD invoice", async () => {
        const unpaid = statCard(page, "Unpaid");
        // TTD 100 sent + TTD 300 part-paid with 100 paid = TTD 300.00 owed; the USD 1,000 is not in it.
        await expect(unpaid).toContainText(/TTD\s*300\.00/);
        await expect(unpaid).not.toContainText(/1,300|1,100|USD/);
        await expect(page.getByText(/1 invoice in other currencies is listed below and not added in/)).toBeVisible();
      });

      await test.step("BUG-070: each card is readable (amount and label contrast at least 4.5:1, in dark and light) and its amount stays inside it", async () => {
        const contrastOf = async (label: string) => statCard(page, label).evaluate((card) => {
          const rgb = (c: string) => (c.match(/[\d.]+/g) ?? ["0", "0", "0", "1"]).map(Number);
          const lum = ([r, g, b]: number[]) => {
            const ch = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
            return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
          };
          // The card's own background, composited over the page behind it when it is translucent.
          const page = rgb(getComputedStyle(document.body).backgroundColor);
          const bgRaw = rgb(getComputedStyle(card).backgroundColor);
          const a = bgRaw[3] ?? 1;
          const bg = [0, 1, 2].map((i) => bgRaw[i]! * a + page[i]! * (1 - a));
          const ratio = (el: Element) => {
            const fg = rgb(getComputedStyle(el).color);
            const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x);
            return (l1! + 0.05) / (l2! + 0.05);
          };
          const value = card.querySelector("p span") ?? card.querySelector("p")!;
          const name = card.querySelector("span")!;
          return { value: ratio(value), label: ratio(name), fits: card.scrollWidth <= card.clientWidth + 1 };
        });
        // The app's theme is next-themes' stored choice (attribute "class", default "dark"); the media query alone does
        // not switch it. Each pass stores the theme, reloads, and checks <html> carries it before measuring.
        for (const scheme of ["dark", "light"] as const) {
          await page.evaluate((t) => window.localStorage.setItem("theme", t), scheme);
          await page.reload();
          await expect(page.getByRole("heading", { name: "Invoices", exact: true })).toBeVisible();
          await settle(page, 800);
          expect(await page.evaluate(() => document.documentElement.classList.contains("dark")), `the page is in ${scheme} mode`).toBe(scheme === "dark");
          for (const label of ["Unpaid", "Overdue", "Paid this month", "Drafts"]) {
            const c = await contrastOf(label);
            expect(c.value, `${label} amount contrast (${scheme})`).toBeGreaterThanOrEqual(4.5);
            expect(c.label, `${label} label contrast (${scheme})`).toBeGreaterThanOrEqual(4.5);
            expect(c.fits, `${label} card fits (${scheme})`).toBe(true);
          }
        }
        await page.evaluate(() => window.localStorage.setItem("theme", "dark"));
        await page.reload();
        await expect(page.getByRole("heading", { name: "Invoices", exact: true })).toBeVisible();
        await settle(page, 800);
      });

      await test.step("BUG-131: the voided invoice's row says nothing is due", async () => {
        await expect(rowOf(page, s.voided)).toBeVisible();
        await expect(rowOf(page, s.voided)).not.toContainText(/Due in|Due today|overdue/i);
      });

      await test.step("BUG-047: the part-paid row offers Record balance and Remind; Remind opens WhatsApp with the balance and the link", async () => {
        await openRowMenu(page, s.part);
        await expect(page.getByRole("button", { name: "Record balance" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);
        await page.getByRole("button", { name: "Remind" }).click();
        await expect.poll(async () => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.length)).toBe(1);
        const opened = new URL(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened[0]!));
        expect(opened.origin + opened.pathname).toBe("https://wa.me/18687550145");
        const text = opened.searchParams.get("text") ?? "";
        expect(text).toMatch(/TTD\s*200\.00/);
        expect(text).toContain(s.part);
        expect(text).toMatch(/\/public\/invoice\//);
      });

      await test.step("BUG-089: the Unpaid card lists the part-paid invoice it counts", async () => {
        await statCard(page, "Unpaid").click();
        await expect(rowOf(page, s.part)).toBeVisible();
        await expect(rowOf(page, s.sent)).toBeVisible();
        await expect(page.locator("tr").filter({ hasText: s.voided })).toHaveCount(0);
      });

      await test.step("BUG-050: Duplicate opens New Invoice with the client, the tax, the discount and the notes", async () => {
        await page.goto("/app/commerce/invoices");
        await settle(page, 1_000);
        await openRowMenu(page, s.dup);
        await page.getByRole("button", { name: "Duplicate" }).click();
        await expect(page.getByRole("heading", { name: "New Invoice" })).toBeVisible();
        await settle(page, 1_000);
        // The client is the form's customer select, set to the duplicated invoice's customer (as journey E11 reads it).
        const client = page.locator("select").filter({ has: page.locator(`option[value="${s.contactId}"]`) }).first();
        await expect(client, "the client").toHaveValue(s.contactId);
        // The Tax & Discount section's fields, found by their labels; the notes are the notes textarea.
        const tax = page.locator("label", { hasText: "Tax Rate (%)" }).locator("xpath=following-sibling::input[1]");
        const discount = page.locator("label", { hasText: /^Discount$/ }).locator("xpath=following-sibling::*[1]//input[@type='number']");
        await expect(tax, "the tax rate").toHaveValue("12.5");
        await expect(discount, "the discount").toHaveValue("20");
        await expect(page.getByPlaceholder(/payment terms, thank you message/i), "the notes").toHaveValue(s.dupNotes);
      });
    });
  });
}
