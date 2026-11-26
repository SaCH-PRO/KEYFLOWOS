import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect, API_URL, memberOf, settle, signedInContext, type Tenant } from "./journeys/journey-helpers";

/**
 * FU-TIMELINE-LOAD-OLDER, the browser half (owner ruling D-284; journey C). The jsdom half is
 * src/app/app/crm/contacts/[contactId]/__tests__/timeline-load-older.test.tsx (TLO-01..11).
 *
 * A customer with 45 timeline records is seeded through the real API, oldest first: its contact.created record, a
 * payment, logged calls and emails ("Older n"), one pasted WhatsApp message (POST .../whatsapp/inbound-capture: a
 * note.created and a communication.whatsapp record; nothing is sent), then 19 newer SMS records ("Newer n"). Newest
 * first, the pasted message's two records are the 20th and 21st: the first page ends between them. Then the
 * customer's Timeline page:
 *
 *   1. it shows the newest 20 records and says so ("The latest 20 timeline records are loaded ..."), counts with
 *      "+", the pasted message once, and offers Load older;
 *   2. Load older: the latest 40, still "+", the pasted message still once (its note is folded across the page
 *      boundary: no "Note added" row);
 *   3. Load older again: all 45 records; the plain words ("n events", no line, no "+", no Load older); the oldest
 *      record is listed; All counts 44 items (the pasted message's two records are one);
 *   4. no sideways page scroll;
 *   5. D-100: a member with crm read and no revenue read loads every page too, and is served, listed and counted no
 *      payment: All is one fewer than the owner's.
 *
 * The premise is checked through the real paged read (GET .../events?paged=true&limit=20) before the page is opened.
 *
 * Run at 375, 768, 1024 and 1440. Live only (E2E_LIVE=1, a production build, a real API and database: the journey
 * harness's own fixtures, README in e2e/journeys); without E2E_LIVE every case is skipped. Run it in the "chromium"
 * project.
 *
 * RED at the base (main 977a265c): the Timeline reads the newest 20 only, says "Only the latest 20 timeline records
 * were loaded", and offers no Load older. Each check is a soft assertion (D-274 A7), so the base run shows each
 * step's own RED.
 */

const auth = (t: { token: string }) => ({ Authorization: `Bearer ${t.token}` });

async function api<T = Record<string, unknown>>(
  request: APIRequestContext,
  who: { token: string },
  method: "GET" | "POST",
  path: string,
  data?: unknown,
): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, { method, headers: auth(who), data });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 400)}`).toBe(method === "POST" ? 201 : 200);
  return (text ? JSON.parse(text) : null) as T;
}

const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;

const PASTED = "Can I move Saturday to 11? <i>thanks</i>";
const PAYMENT_WORDS = "Deposit paid";
const TOTAL = 45;
const NEWER = 19;

interface Served {
  id: string;
  type: string;
  source?: string | null;
}

/** Every record the member may read, newest first, through the real paged read. */
async function readAllPages(request: APIRequestContext, who: { token: string }, b: string, contactId: string): Promise<Served[][]> {
  const pages: Served[][] = [];
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ paged: "true", limit: "20" });
    if (cursor) q.set("cursor", cursor);
    const page: { events: Served[]; nextCursor: string | null; hasMore: boolean } = await api(request, who, "GET", `/crm/businesses/${b}/contacts/${contactId}/events?${q}`);
    pages.push(page.events);
    cursor = page.hasMore ? page.nextCursor : null;
  } while (cursor && pages.length < 10);
  return pages;
}

/** The customer of the header: 45 records, a pasted message split across the first page boundary. */
async function seedCustomer(request: APIRequestContext, owner: Tenant): Promise<string> {
  const b = owner.businessId;
  const last = `Older${stamp()}`;
  const contact = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${b}/contacts`, {
    firstName: "Noor",
    lastName: last,
    email: `noor.${last.toLowerCase()}@tlo.test.local`,
  });
  const already = (await readAllPages(request, owner, b, contact.id)).flat().length;
  await api(request, owner, "POST", `/crm/businesses/${b}/contacts/${contact.id}/events`, { type: "payment.received", description: PAYMENT_WORDS, data: { amount: 4200 } });
  // Older records: TOTAL less the newer ones, the pasted message's two, the payment and what creation wrote.
  const older = TOTAL - NEWER - 2 - 1 - already;
  for (let i = 0; i < older; i++) {
    await api(request, owner, "POST", `/crm/businesses/${b}/contacts/${contact.id}/log-communication`, {
      channelType: i % 2 === 0 ? "call" : "email",
      outcome: i % 2 === 0 ? "answered" : "sent",
      notes: `Older ${i}`,
    });
  }
  const digits = String(1000 + Math.floor(Math.random() * 9000));
  await api(request, owner, "POST", `/crm/businesses/${b}/whatsapp/inbound-capture`, { phone: `+1868555${digits}`, message: PASTED, contactId: contact.id });
  for (let i = 0; i < NEWER; i++) {
    await api(request, owner, "POST", `/crm/businesses/${b}/contacts/${contact.id}/events`, { type: "sms.sent", description: `Newer ${i}`, data: { body: `Newer ${i}` } });
  }
  return contact.id;
}

function filterButton(page: Page, label: string) {
  return page.getByRole("group", { name: /filter by channel/i }).getByRole("button", { name: new RegExp(`^${label}\\b`) });
}

/** What a filter states, "(n)" or "(n+)": the text inside the brackets, or null when there is none. */
async function stated(page: Page, label: string): Promise<string | null> {
  const button = filterButton(page, label);
  if (!(await button.count())) return null;
  const m = (await button.first().innerText()).match(/\((\d+\+?)\)/);
  return m ? m[1] : null;
}

function loadOlder(page: Page) {
  return page.getByRole("button", { name: /^load older$/i });
}

async function openTimeline(page: Page, contactId: string) {
  await page.goto(`/app/crm/contacts/${contactId}/timeline`);
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/loading timeline/i)).toHaveCount(0, { timeout: 30_000 });
  await settle(page, 1_000);
}

/** Clicks Load older when it is there (at the base it is not: the soft checks around it record the RED). */
async function clickLoadOlder(page: Page, header: RegExp): Promise<boolean> {
  if (!(await loadOlder(page).count())) return false;
  // The phone's fixed bottom bar covers the viewport's bottom edge, where a plain scroll-into-view leaves the button:
  // a person scrolls it up into view first, and so does this (the scroll root's pb-28 leaves room above the bar).
  await loadOlder(page).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await loadOlder(page).click();
  await expect(page.getByText(header)).toHaveCount(1, { timeout: 30_000 });
  await settle(page, 500);
  return true;
}

for (const width of [375, 768, 1024, 1440]) {
  test.describe(`FU-TIMELINE-LOAD-OLDER the Timeline loads older events (${width}px)`, () => {
    test.use({ viewport: { width, height: width < 600 ? 812 : 900 } });

    test(`45 records: the newest 20, then all 45; a split pasted message shows once; members see no money (${width})`, async ({ page, request, owner, browser }) => {
      test.setTimeout(6 * 60_000);
      const b = owner.businessId;
      const contactId = await seedCustomer(request, owner);

      // The premise, through the real paged read: 45 records over three pages, and the first page ends between the
      // pasted message's two records.
      const pages = await readAllPages(request, owner, b, contactId);
      const all = pages.flat();
      expect(pages.map((p) => p.length), "pages of the paged read").toEqual([20, 20, 5]);
      expect(all, "the customer has 45 records").toHaveLength(TOTAL);
      expect(new Set(all.map((e) => e.id)).size, "each record once").toBe(TOTAL);
      const split = [pages[0][19], pages[1][0]].map((e) => `${e.type}/${e.source}`).sort();
      expect(split, "the pasted message's records are the 20th and 21st").toEqual(["communication.whatsapp/whatsapp_inbound", "note.created/whatsapp_inbound"]);
      const olderLogged = all.filter((e) => e.type === "communication.call" || e.type === "communication.email").length;

      await openTimeline(page, contactId);
      const main = page.locator("main");

      await test.step("1. the newest 20, said so, counted with +; the pasted message once; Load older", async () => {
        await expect.soft(main.getByText("The latest 20 timeline records are loaded; older ones are not listed or counted until you load them."), "the line says the latest 20 are loaded").toHaveCount(1);
        await expect.soft(main.getByText(/^Only the latest 20/), "the old 'only 20' line is gone").toHaveCount(0);
        await expect.soft(main.getByText(/^\d+ items? from the latest 20 records$/), "the header counts items of the latest 20 records").toHaveCount(1);
        await expect.soft(main.getByText(/^Newer \d+$/), "the 19 newer records").toHaveCount(NEWER);
        await expect.soft(main.getByText(/^Older \d+$/), "no older record yet").toHaveCount(0);
        await expect.soft(main.getByText(PASTED, { exact: true }), "the pasted message, once").toHaveCount(1);
        expect.soft(await stated(page, "All"), "All counts within the loaded, with +").toBe("20+");
        expect.soft(await stated(page, "WhatsApp"), "WhatsApp counts within the loaded, with +").toBe("1+");
        await expect.soft(loadOlder(page), "Load older is offered").toHaveCount(1);
      });

      await test.step("2. Load older: the latest 40; the pasted message still once (its note folds across pages)", async () => {
        expect.soft(await clickLoadOlder(page, /^\d+ items from the latest 40 records$/), "Load older loads the next page").toBe(true);
        await expect.soft(main.getByText("The latest 40 timeline records are loaded; older ones are not listed or counted until you load them."), "the line says the latest 40").toHaveCount(1);
        await expect.soft(main.getByText(PASTED, { exact: true }), "the pasted message, once").toHaveCount(1);
        await expect.soft(main.getByText("Note added"), "no second row for its note").toHaveCount(0);
        expect.soft(await stated(page, "WhatsApp"), "WhatsApp still one, with +").toBe("1+");
        expect.soft(await stated(page, "All"), "All: 39 items from 40 records, with +").toBe("39+");
      });

      let ownerAll: string | null = null;
      await test.step("3. Load older again: all 45 records; plain words; no Load older", async () => {
        expect.soft(await clickLoadOlder(page, /^\d+ events$/), "Load older loads the last page").toBe(true);
        await expect.soft(main.getByText(/^44 events$/), "44 items from 45 records, in plain words").toHaveCount(1);
        await expect.soft(main.getByText(/timeline records are loaded/), "no 'latest' line").toHaveCount(0);
        await expect.soft(loadOlder(page), "no Load older").toHaveCount(0);
        await expect.soft(main.getByText(/^Older \d+$/), "every older record").toHaveCount(olderLogged);
        await expect.soft(main.getByText(PAYMENT_WORDS), "the payment, for the owner").toHaveCount(1);
        await expect.soft(main.getByText(PASTED, { exact: true }), "the pasted message, once").toHaveCount(1);
        expect.soft(await stated(page, "All"), "All: 44, no +").toBe("44");
        expect.soft(await stated(page, "WhatsApp"), "WhatsApp: 1, no +").toBe("1");
        ownerAll = await stated(page, "All");
      });

      await test.step("4. no sideways page scroll", async () => {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect.soft(overflow, "page wider than the viewport by").toBeLessThanOrEqual(0);
      });

      await test.step("5. D-100: a member without revenue read pages through and sees and counts no payment", async () => {
        const member = await memberOf(request, owner, `load older member ${width}`, { role: "STAFF", scopes: { crm: "read" } });
        const memberServed = (await readAllPages(request, member, b, contactId)).flat();
        expect(memberServed.map((e) => e.type), "the member is served no payment on any page").not.toContain("payment.received");
        expect(memberServed, "the member is served the rest").toHaveLength(TOTAL - 1);
        const desk = await signedInContext(browser, member, { viewport: { width, height: width < 600 ? 812 : 900 } });
        const memberPage = await desk.newPage();
        await openTimeline(memberPage, contactId);
        await clickLoadOlder(memberPage, /^\d+ items from the latest 40 records$/);
        await clickLoadOlder(memberPage, /^\d+ events$/);
        await expect.soft(memberPage.locator("main").getByText(PAYMENT_WORDS), "the member sees no payment").toHaveCount(0);
        await expect.soft(memberPage.locator("main").getByText("4200"), "nor its amount").toHaveCount(0);
        await expect.soft(loadOlder(memberPage), "every page loaded").toHaveCount(0);
        expect.soft(await stated(memberPage, "All"), "the member's All: the owner's less the payment").toBe(ownerAll === null ? null : String(Number(ownerAll) - 1));
        await desk.close();
      });
    });
  });
}
