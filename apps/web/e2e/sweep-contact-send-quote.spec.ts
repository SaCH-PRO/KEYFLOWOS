import type { APIRequestContext } from "@playwright/test";
import { test, expect, API_URL, type Tenant } from "./journeys/journey-helpers";

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
 * 375, 768, 1024 and 1440 are run. RED at the packet's base (main 977a265c, claim c067bf97): Send Quote pushed
 * ?tab=billing&segment=quotes&contactId=, which the commerce page rewrites to ?tab=snapshot, and no sheet opens.
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

      await test.step("CSQB-01 Sales > Quotes, and the one-shot contactId has left the URL", async () => {
        await expect(page).toHaveURL(/\/app\/commerce\?(.*&)?tab=quotes(&|$)/, { timeout: 20_000 });
        await expect.poll(() => new URL(page.url()).searchParams.get("contactId"), { timeout: 10_000 }).toBeNull();
      });

      await test.step("CSQB-02 the New Quote sheet is open with that customer chosen", async () => {
        const sheet = page.getByRole("dialog", { name: /new quote/i });
        await expect(sheet).toBeVisible({ timeout: 20_000 });
        await expect(sheet.getByText(new RegExp(`${c.first} ${c.last}`)).first()).toBeVisible();
      });
    });
  });
}
