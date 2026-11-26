import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect, API_URL, memberOf, settle, signedInContext, type Tenant } from "./journeys/journey-helpers";

/**
 * FU-CONTACT-TIMELINE-CHANNELS, the browser half (owner ruling D-277; journey C). The jsdom half is
 * src/app/app/crm/contacts/[contactId]/__tests__/timeline-channels.test.tsx (TCH-01..11).
 *
 * A customer is seeded through the real API: a pasted WhatsApp message (POST .../whatsapp/inbound-capture, the
 * WEDGE-WA-INBOUND-CAPTURE route: a plain-text ContactNote plus a communication.whatsapp event; nothing is sent),
 * a note, a logged call, a logged email and a payment event carrying an amount. Then the customer's Timeline page:
 *
 *   1. it offers a channel filter: All, WhatsApp, Email, SMS, Calls, Notes, with All on;
 *   2. All shows the pasted message, once, as typed, and the call and the payment;
 *   3. WhatsApp shows the pasted message and nothing else seeded; Calls the call only; Email the email only;
 *      Notes the note only; SMS says it has nothing;
 *   4. the filter fits the width: no sideways page scroll;
 *   5. member scope (D-100): a member with crm read and no revenue read is served no payment event, and the
 *      filter shows and counts none (All is one fewer than the owner's; every channel count is the owner's).
 *   6. review round 1 COR-TCH-1: the events read serves at most 20 at a time. A second customer has a call, then 11
 *      pasted messages (22 newer events): the page says the latest 20 timeline records are loaded, the header counts
 *      the items those make ("11 items from the latest 20 records" or fewer), the counts read "(n+)", and Calls says
 *      "No calls in the latest 20 records.", never "No calls yet." (the call is real, only older). Since
 *      FU-TIMELINE-LOAD-OLDER (D-284) the line reads "The latest 20 timeline records are loaded; older ones are not
 *      listed or counted until you load them." in place of "Only the latest 20 ... were loaded" (the older ones can
 *      be loaded: e2e/sweep-timeline-load-older.spec.ts).
 *
 * Run at 375, 768, 1024 and 1440. Live only (E2E_LIVE=1, a production build, a real API and database: the journey
 * harness's own fixtures, README in e2e/journeys); without E2E_LIVE every case is skipped. Run it in the "chromium"
 * project.
 *
 * RED at the base (main 08170696): the Timeline has no channel filter, and a logged call's words are not shown.
 * Each check is a soft assertion (D-274 A7), so the base run shows every step's own RED.
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

const PASTED = "Hi! Can I book Saturday at 10? <b>thanks</b>";
const CALL_WORDS = "Talked through the quote";
const EMAIL_WORDS = "Sent the price list";
const PAYMENT_WORDS = "Deposit paid";
const FILTERS = ["All", "WhatsApp", "Email", "SMS", "Calls", "Notes"] as const;

/** A customer with a pasted WhatsApp message, a note, a call, an email and a payment event. */
async function seedCustomer(request: APIRequestContext, owner: Tenant): Promise<string> {
  const b = owner.businessId;
  const last = `Channels${stamp()}`;
  const contact = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${b}/contacts`, {
    firstName: "Rae",
    lastName: last,
    email: `rae.${last.toLowerCase()}@tch.test.local`,
  });
  const digits = String(1000 + Math.floor(Math.random() * 9000));
  const captured = await api<{ contact: { id: string }; event: { type: string } }>(request, owner, "POST", `/crm/businesses/${b}/whatsapp/inbound-capture`, {
    phone: `+1868555${digits}`,
    message: PASTED,
    contactId: contact.id,
  });
  expect(captured.contact.id, "the pasted message lands on this customer").toBe(contact.id);
  expect(captured.event.type, "as a communication.whatsapp event").toBe("communication.whatsapp");
  await api(request, owner, "POST", `/crm/businesses/${b}/contacts/${contact.id}/notes`, { body: "Prefers mornings" });
  await api(request, owner, "POST", `/crm/businesses/${b}/contacts/${contact.id}/log-communication`, { channelType: "call", outcome: "answered", notes: CALL_WORDS });
  await api(request, owner, "POST", `/crm/businesses/${b}/contacts/${contact.id}/log-communication`, { channelType: "email", outcome: "sent", notes: EMAIL_WORDS });
  await api(request, owner, "POST", `/crm/businesses/${b}/contacts/${contact.id}/events`, {
    type: "payment.received",
    description: PAYMENT_WORDS,
    data: { amount: 4200 },
  });
  return contact.id;
}

/** A customer with one logged call, then `pastes` pasted WhatsApp messages (each two events), all newer than the call. */
async function seedBusyCustomer(request: APIRequestContext, owner: Tenant, pastes: number): Promise<string> {
  const b = owner.businessId;
  const last = `Busy${stamp()}`;
  const contact = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${b}/contacts`, {
    firstName: "Lee",
    lastName: last,
    email: `lee.${last.toLowerCase()}@tch.test.local`,
  });
  await api(request, owner, "POST", `/crm/businesses/${b}/contacts/${contact.id}/log-communication`, { channelType: "call", outcome: "answered", notes: CALL_WORDS });
  const digits = String(1000 + Math.floor(Math.random() * 9000));
  for (let i = 0; i < pastes; i++) {
    await api(request, owner, "POST", `/crm/businesses/${b}/whatsapp/inbound-capture`, { phone: `+1868555${digits}`, message: `Busy message ${i}`, contactId: contact.id });
  }
  return contact.id;
}

function filterButton(page: Page, label: string) {
  return page.getByRole("group", { name: /filter by channel/i }).getByRole("button", { name: new RegExp(`^${label}\\b`) });
}

/** The count a filter states, as "(n)"; null when the filter or its count is missing. */
async function countOf(page: Page, label: string): Promise<number | null> {
  const button = filterButton(page, label);
  if (!(await button.count())) return null;
  const m = (await button.first().innerText()).match(/\((\d+)\+?\)/);
  return m ? Number(m[1]) : null;
}

/** Chooses a filter when it exists (at the base it does not: the soft checks around it record the RED). */
async function choose(page: Page, label: string): Promise<boolean> {
  const button = filterButton(page, label);
  if (!(await button.count())) return false;
  await button.first().click();
  await expect(button.first()).toHaveAttribute("aria-pressed", "true");
  return true;
}

async function openTimeline(page: Page, contactId: string) {
  await page.goto(`/app/crm/contacts/${contactId}/timeline`);
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/loading timeline/i)).toHaveCount(0, { timeout: 30_000 });
  await settle(page, 1_000);
}

for (const width of [375, 768, 1024, 1440]) {
  test.describe(`FU-CONTACT-TIMELINE-CHANNELS the Timeline filters by channel (${width}px)`, () => {
    test.use({ viewport: { width, height: width < 600 ? 812 : 900 } });

    test(`a pasted WhatsApp message shows under WhatsApp and under All; members see no money (${width})`, async ({ page, request, owner, browser }) => {
      test.setTimeout(5 * 60_000);
      const contactId = await seedCustomer(request, owner);
      await openTimeline(page, contactId);
      const main = page.locator("main");

      await test.step("1. the channel filter: All, WhatsApp, Email, SMS, Calls, Notes; All is on", async () => {
        const group = page.getByRole("group", { name: /filter by channel/i });
        await expect.soft(group, "a channel filter").toHaveCount(1);
        const names = (await group.getByRole("button").allInnerTexts()).map((t) => t.replace(/\s*\(\d+\)\s*$/, "").trim());
        expect.soft(names, "its choices").toEqual([...FILTERS]);
        if (await filterButton(page, "All").count()) await expect.soft(filterButton(page, "All")).toHaveAttribute("aria-pressed", "true");
      });

      await test.step("2. All: the pasted message once, as typed; the call and the payment too", async () => {
        await expect.soft(main.getByText(PASTED, { exact: true }), "the pasted message, once").toHaveCount(1);
        await expect.soft(main.getByText(CALL_WORDS), "the call").toHaveCount(1);
        await expect.soft(main.getByText(PAYMENT_WORDS), "the payment").toHaveCount(1);
      });

      const ownerCounts: Record<string, number | null> = {};
      for (const f of FILTERS) ownerCounts[f] = await countOf(page, f);

      await test.step("3. each channel shows its own: WhatsApp the message; Calls the call; Email the email; Notes the note; SMS nothing", async () => {
        expect.soft(await choose(page, "WhatsApp"), "a WhatsApp filter").toBe(true);
        await expect.soft(main.getByText(PASTED, { exact: true }), "WhatsApp: the pasted message").toHaveCount(1);
        await expect.soft(main.getByText(CALL_WORDS), "WhatsApp: no call").toHaveCount(0);
        await expect.soft(main.getByText(PAYMENT_WORDS), "WhatsApp: no payment").toHaveCount(0);
        await expect.soft(main.getByText("Note added"), "WhatsApp: no note row").toHaveCount(0);

        expect.soft(await choose(page, "Calls"), "a Calls filter").toBe(true);
        await expect.soft(main.getByText(CALL_WORDS), "Calls: the call").toHaveCount(1);
        await expect.soft(main.getByText(PASTED, { exact: true }), "Calls: no WhatsApp").toHaveCount(0);

        expect.soft(await choose(page, "Email"), "an Email filter").toBe(true);
        await expect.soft(main.getByText(EMAIL_WORDS), "Email: the email").toHaveCount(1);
        await expect.soft(main.getByText(CALL_WORDS), "Email: no call").toHaveCount(0);

        expect.soft(await choose(page, "Notes"), "a Notes filter").toBe(true);
        await expect.soft(main.getByText("Note added"), "Notes: the note, once (the pasted message is WhatsApp)").toHaveCount(1);
        await expect.soft(main.getByText(PASTED, { exact: true }), "Notes: no WhatsApp").toHaveCount(0);

        expect.soft(await choose(page, "SMS"), "an SMS filter").toBe(true);
        await expect.soft(main.getByText("No SMS messages yet."), "SMS: says it has nothing").toHaveCount(1);

        expect.soft(ownerCounts, "the owner's counts").toEqual({ All: ownerCounts.All, WhatsApp: 1, Email: 1, SMS: 0, Calls: 1, Notes: 1 });
        expect.soft(ownerCounts.All ?? 0, "All holds at least the six seeded items").toBeGreaterThanOrEqual(6);
        await choose(page, "All");
      });

      await test.step("4. the filter fits the width: no sideways page scroll", async () => {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect.soft(overflow, "page wider than the viewport by").toBeLessThanOrEqual(0);
        const group = page.getByRole("group", { name: /filter by channel/i });
        if (await group.count()) {
          const box = await group.boundingBox();
          expect.soft((box?.x ?? 0) + (box?.width ?? 0), "the filter ends inside the viewport").toBeLessThanOrEqual(width);
        }
      });

      await test.step("5. member scope (D-100): no revenue read, no payment event, and none counted", async () => {
        const member = await memberOf(request, owner, `timeline member ${width}`, { role: "STAFF", scopes: { crm: "read" } });
        // The premise: the events read withholds the payment from this member.
        const served = await api<Array<{ type: string }>>(request, member, "GET", `/crm/businesses/${owner.businessId}/contacts/${contactId}/events`);
        expect(served.map((e) => e.type), "the member is served no payment event").not.toContain("payment.received");
        const desk = await signedInContext(browser, member, { viewport: { width, height: width < 600 ? 812 : 900 } });
        const memberPage = await desk.newPage();
        await openTimeline(memberPage, contactId);
        await expect.soft(memberPage.locator("main").getByText(PASTED, { exact: true }), "the member sees the pasted message").toHaveCount(1);
        await expect.soft(memberPage.locator("main").getByText(PAYMENT_WORDS), "the member sees no payment").toHaveCount(0);
        await expect.soft(memberPage.locator("main").getByText("4200"), "nor its amount").toHaveCount(0);
        const memberCounts: Record<string, number | null> = {};
        for (const f of FILTERS) memberCounts[f] = await countOf(memberPage, f);
        expect.soft(memberCounts, "the member's counts: the owner's, less the payment in All").toEqual({
          ...ownerCounts,
          All: ownerCounts.All === null ? null : ownerCounts.All - 1,
        });
        await desk.close();
      });

      await test.step("6. COR-TCH-1: a full read (20 events) says it shows the latest 20; Calls says none in those, not none ever", async () => {
        const busyId = await seedBusyCustomer(request, owner, 11);
        // The premise: the read serves 20 and leaves the older call out.
        const served = await api<Array<{ type: string }>>(request, owner, "GET", `/crm/businesses/${owner.businessId}/contacts/${busyId}/events`);
        expect(served, "the events read serves 20").toHaveLength(20);
        expect(served.map((e) => e.type), "the call is older than the 20 served").not.toContain("communication.call");
        await openTimeline(page, busyId);
        await expect
          .soft(page.getByText("The latest 20 timeline records are loaded; older ones are not listed or counted until you load them."), "the page says the latest 20 are loaded")
          .toHaveCount(1);
        await expect.soft(page.getByText(/^\d+ items from the latest 20 records$/), "the header counts items of those 20 records").toHaveCount(1);
        await expect.soft(filterButton(page, "Calls"), "Calls counts within the latest 20").toContainText("(0+)");
        await expect.soft(filterButton(page, "WhatsApp"), "WhatsApp counts within the latest 20").toContainText("+)");
        expect.soft(await choose(page, "Calls"), "a Calls filter").toBe(true);
        await expect.soft(page.locator("main").getByText("No calls in the latest 20 records."), "Calls: none in the latest 20").toHaveCount(1);
        await expect.soft(page.locator("main").getByText("No calls yet."), "never 'No calls yet.'").toHaveCount(0);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect.soft(overflow, "page wider than the viewport by").toBeLessThanOrEqual(0);
      });
    });
  });
}
