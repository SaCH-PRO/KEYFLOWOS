import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect, API_URL, memberOf, signedInContext, type Tenant } from "./journeys/journey-helpers";

/**
 * FU-CONTACT-SEND-QUOTE-DOOR, the browser half (D-283; journeys C and D). The jsdom half is
 * src/app/app/commerce/__tests__/contact-send-quote-door.test.tsx (CSQ-*).
 *
 * A customer is seeded through the API. Then, on Customers' list view (/app/crm/contacts?view=list: the cards there
 * carry Quick actions; the default focus view's cards do not), the customer's card Quick actions > Send Quote must open Sales > Quotes with the New Quote sheet open and that customer chosen, by a
 * client navigation (the contacts screen's router.push; the shell stays mounted since FU-REQUIRE-AUTH-REMOUNT):
 *
 *   CSQB-01 the URL lands on /app/commerce on the Quotes tab, and the one-shot contactId has left it
 *   CSQB-02 the New Quote sheet is open and names the customer
 *
 * Round 2 (orchestrator fold-in): the next-action "Send Quote" door (Customers > Action Center > the action's button,
 * use-contacts-pipeline.ts handleDoAction, router.push to the same URL) gets the same CSQB-01/02 checks. The server
 * proposes send_quote only for a PROSPECT customer created more than 5 days ago (crm-actions.service.ts), which the API
 * cannot backdate, so that one read (GET .../next-actions) is answered by page.route with a send_quote action for the
 * customer seeded through the real API. Everything else is live. That door's code is not changed by this packet: the
 * cases prove it now works (it failed only because RequireAuth remounted the shell, FU-REQUIRE-AUTH-REMOUNT).
 *
 * 375, 768, 1024 and 1440 are run. RED at the packet's base (main 977a265c, claim c067bf97): Send Quote pushed
 * ?tab=billing&segment=quotes&contactId=, which the commerce page rewrites to ?tab=snapshot, and no sheet opens.
 *
 * Repair round 1 (review SEC-SQD-1): a member with revenue read (crm write) is not offered Send Quote in a card's
 * Quick actions, as the WhatsApp sheet offers New quote only to one who may write quotes; the card's other actions stay.
 * RED at the base, where every member is offered it.
 *
 * Round 4 (review SEC-SQD-4): the same member is not offered the next-action Send Quote either. Their next actions
 * (GET .../next-actions answered by page.route, as in the owner's next-action case) hold a send_quote and a follow_up
 * for the seeded customer: the Follow Up is shown, the Send Quote is not.
 *
 * Live only (E2E_LIVE=1, a production build, a real API and database: the journey harness's own fixtures, README in
 * e2e/journeys); without E2E_LIVE every case is skipped. Run it in the "chromium" project:
 *
 *   E2E_LIVE=1 E2E_VARIANT=ai-disabled E2E_API_URL=... E2E_JWT_SECRET=... E2E_WEB_COMMAND=standalone \
 *     E2E_BASE_URL=... E2E_PORT=... npx playwright test e2e/sweep-contact-send-quote.spec.ts --project=chromium
 */

const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;

async function seedCustomer(request: APIRequestContext, owner: Tenant): Promise<{ id: string; first: string; last: string }> {
  const first = "Quincy";
  const last = `Quote${stamp()}`;
  const res = await request.post(`${API_URL}/crm/businesses/${owner.businessId}/contacts`, {
    headers: { Authorization: `Bearer ${owner.token}` },
    data: { firstName: first, lastName: last, email: `quincy.${last.toLowerCase()}@csq.test.local` },
  });
  const text = await res.text();
  expect(res.status(), `POST contacts: ${text.slice(0, 400)}`).toBe(201);
  return { id: (JSON.parse(text) as { id: string }).id, first, last };
}

/** CSQB-01 and CSQB-02, after a door was pressed. */
async function expectNewQuoteFor(page: Page, c: { first: string; last: string }): Promise<void> {
  await test.step("CSQB-01 Sales > Quotes, and the one-shot contactId has left the URL", async () => {
    await expect(page).toHaveURL(/\/app\/commerce\?(.*&)?tab=quotes(&|$)/, { timeout: 20_000 });
    await expect.poll(() => new URL(page.url()).searchParams.get("contactId"), { timeout: 10_000 }).toBeNull();
  });

  await test.step("CSQB-02 the New Quote sheet is open with that customer chosen", async () => {
    const sheet = page.getByRole("dialog", { name: /new quote/i });
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    await expect(sheet.getByText(new RegExp(`${c.first} ${c.last}`)).first()).toBeVisible();
  });
}

for (const width of [375, 768, 1024, 1440]) {
  test.describe(`FU-CONTACT-SEND-QUOTE-DOOR a contact's Send Quote (${width}px)`, () => {
    test.use({ viewport: { width, height: width < 768 ? 812 : 900 } });

    test(`Quick actions > Send Quote opens New Quote for that customer (${width})`, async ({ page, request, owner }) => {
      test.setTimeout(3 * 60_000);
      const c = await seedCustomer(request, owner);

      await page.goto("/app/crm/contacts?view=list");
      // The card (role=option, labelled "<name> - <status>"), as release0-live.spec.ts selects it.
      const card = page.locator(`div[role="option"][aria-label^="${c.first} ${c.last} - "]`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.hover();
      await card.getByTitle("Quick actions").click();
      await page.getByRole("menuitem", { name: /^send quote$/i }).click();

      await expectNewQuoteFor(page, c);
    });

    test(`a member with revenue read is not offered Send Quote (${width})`, async ({ browser, request, owner }) => {
      test.setTimeout(3 * 60_000);
      const c = await seedCustomer(request, owner);
      const member = await memberOf(request, owner, "quote reader", { role: "STAFF", scopes: { crm: "write", revenue: "read" } });
      const context = await signedInContext(browser, member, { viewport: { width, height: width < 768 ? 812 : 900 } });
      const memberPage = await context.newPage();
      await memberPage.goto("/app/crm/contacts?view=list");
      const card = memberPage.locator(`div[role="option"][aria-label^="${c.first} ${c.last} - "]`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.hover();
      await card.getByTitle("Quick actions").click();
      await expect(memberPage.getByRole("menuitem", { name: /^book appointment$/i })).toBeVisible();
      // The member's access is read by the screen; once it is answered the door is not offered.
      await expect(memberPage.getByRole("menuitem", { name: /^send quote$/i })).toHaveCount(0, { timeout: 15_000 });
    });

    test(`a member with revenue read is not offered the next-action Send Quote (${width})`, async ({ browser, request, owner }) => {
      test.setTimeout(3 * 60_000);
      const c = await seedCustomer(request, owner);
      const name = `${c.first} ${c.last}`;
      const member = await memberOf(request, owner, "next quote reader", { role: "STAFF", scopes: { crm: "write", revenue: "read" } });
      const context = await signedInContext(browser, member, { viewport: { width, height: width < 768 ? 812 : 900 } });
      const memberPage = await context.newPage();
      await memberPage.route(new RegExp(`/crm/businesses/${owner.businessId}/next-actions(\\?.*)?$`), (route) =>
        route.request().method() === "GET"
          ? route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify([
                { id: `sendquote_${c.id}`, type: "send_quote", contactId: c.id, contactName: name, description: "Prospect for 9d with no quote — prepare proposal", estimatedTime: 45, priority: "high" },
                { id: `followup_${c.id}`, type: "follow_up", contactId: c.id, contactName: name, description: "No touch in 21d — check in", estimatedTime: 15, priority: "high" },
              ]),
            })
          : route.continue(),
      );
      await memberPage.goto("/app/crm/contacts");
      await expect(memberPage.getByTitle(`Follow Up — ${name}`).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
      await expect(memberPage.getByTitle(`Send Quote — ${name}`)).toHaveCount(0, { timeout: 15_000 });
    });

    test(`Next action > Send Quote opens New Quote for that customer (${width})`, async ({ page, request, owner }) => {
      test.setTimeout(3 * 60_000);
      const c = await seedCustomer(request, owner);
      const name = `${c.first} ${c.last}`;
      // The one read answered by the test (see the header): a send_quote action, in the shape the server sends it.
      await page.route(new RegExp(`/crm/businesses/${owner.businessId}/next-actions(\\?.*)?$`), (route) =>
        route.request().method() === "GET"
          ? route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify([
                {
                  id: `sendquote_${c.id}`,
                  type: "send_quote",
                  contactId: c.id,
                  contactName: name,
                  description: "Prospect for 9d with no quote — prepare proposal",
                  estimatedTime: 45,
                  priority: "high",
                },
              ]),
            })
          : route.continue(),
      );

      await page.goto("/app/crm/contacts");
      const door = page.getByTitle(`Send Quote — ${name}`).filter({ visible: true }).first();
      await expect(door).toBeVisible({ timeout: 30_000 });
      await door.click();

      await expectNewQuoteFor(page, c);
    });
  });
}
