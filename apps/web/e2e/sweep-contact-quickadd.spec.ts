import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect, API_URL, memberOf, signedInContext, type Tenant } from "./journeys/journey-helpers";

/**
 * SWP-CONTACT-QUICKADD, the browser half (sweep BUG-009, BUG-034, BUG-035; journey C's C1 and C3 read the same
 * dialog). The jsdom half is src/app/app/crm/pipeline/__tests__/quick-add-contact.test.tsx.
 *
 * The sweep, on Customers > Add contact:
 *   - BUG-009: a refused save closed the dialog, emptied it and said nothing;
 *   - BUG-034: Company was not sent;
 *   - BUG-035: a first name alone was saved with the last name "User".
 *
 * Here, for a fresh owner on a real API and database (live only: E2E_LIVE=1, a production build; the journey
 * harness's fixtures, README in e2e/journeys; without E2E_LIVE every case is skipped, so the mocked CI job is
 * unaffected), at 1440x900 and 375x812:
 *   1. a duplicate phone: the server answers 409, the dialog stays open with what was typed, and the dialog itself
 *      says why (role alert, "already exists");
 *   2. a member with read-only Customers access: the server answers 403, the dialog stays open and says the member
 *      needs crm write access;
 *   3. a first name and a Company, nothing else: 201, and the API reads back the company and no last name; the list
 *      shows the name without "User".
 *
 *   E2E_LIVE=1 E2E_VARIANT=ai-disabled E2E_API_URL=... E2E_JWT_SECRET=... \
 *     E2E_NO_SERVER=1 E2E_BASE_URL=... npx playwright test e2e/sweep-contact-quickadd.spec.ts --project=chromium
 */

const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;
/** A Trinidad and Tobago mobile number, seven digits, unique to the run. */
const localTtNumber = () => `7${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;

const contactPost = (businessId: string) => (r: { request(): { method(): string }; url(): string }) =>
  r.request().method() === "POST" && new URL(r.url()).pathname === `/crm/businesses/${businessId}/contacts`;

async function openQuickAdd(page: Page): Promise<Locator> {
  await page.goto("/app/crm/contacts");
  await page.getByRole("button", { name: /^add contact$/i }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: /^add contact$/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function seedContact(request: APIRequestContext, owner: Tenant, body: Record<string, unknown>): Promise<void> {
  const res = await request.post(`${API_URL}/crm/businesses/${owner.businessId}/contacts`, {
    headers: { Authorization: `Bearer ${owner.token}` },
    data: body,
  });
  expect(res.status(), await res.text()).toBe(201);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test.describe(`SWP-CONTACT-QUICKADD Customers > Add contact (${viewport.width}x${viewport.height})`, () => {
    test.use(viewport.width < 600 ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport });

    test("a refusal keeps the dialog filled and says why in it; Company is saved; no invented 'User' last name", async ({ page, request, owner, browser }) => {
      test.setTimeout(4 * 60_000);

      await test.step("BUG-009: a duplicate phone is refused (409); the dialog stays open, keeps what was typed and says why", async () => {
        const digits = localTtNumber();
        await seedContact(request, owner, { firstName: "Existing", lastName: `Dup${stamp()}`, phone: `+1868${digits}` });
        const dialog = await openQuickAdd(page);
        const last = `Again${stamp()}`;
        await dialog.getByPlaceholder("Jane", { exact: true }).fill("Eve");
        await dialog.getByPlaceholder("Doe", { exact: true }).fill(last);
        await dialog.getByPlaceholder(/868/).fill(`+1868${digits}`);
        const refused = page.waitForResponse(contactPost(owner.businessId));
        await dialog.getByRole("button", { name: /^add contact$/i }).click();
        expect((await refused).status(), "the server refuses the duplicate").toBe(409);
        await expect(dialog, "the dialog stays open").toBeVisible();
        await expect(dialog.getByPlaceholder("Doe", { exact: true }), "what was typed is kept").toHaveValue(last);
        await expect(dialog.getByRole("alert"), "the dialog says why").toContainText(/already exists/i);
      });

      await test.step("BUG-009: a member with read-only Customers access is refused (403); the dialog stays open and says why", async () => {
        const member = await memberOf(request, owner, "front desk", { role: "STAFF", scopes: { crm: "read" } });
        const context = await signedInContext(browser, member);
        const memberPage = await context.newPage();
        const dialog = await openQuickAdd(memberPage);
        const last = `Noaccess${stamp()}`;
        await dialog.getByPlaceholder("Jane", { exact: true }).fill("Finn");
        await dialog.getByPlaceholder("Doe", { exact: true }).fill(last);
        const refused = memberPage.waitForResponse(contactPost(owner.businessId));
        await dialog.getByRole("button", { name: /^add contact$/i }).click();
        expect((await refused).status(), "the server refuses a read-only member").toBe(403);
        await expect(dialog, "the dialog stays open").toBeVisible();
        await expect(dialog.getByPlaceholder("Doe", { exact: true }), "what was typed is kept").toHaveValue(last);
        await expect(dialog.getByRole("alert"), "the dialog says why").toContainText(/needs crm write access/i);
        await context.close();
      });

      await test.step("BUG-034, BUG-035: a first name and a Company only: Company is saved and no last name is invented", async () => {
        const first = `Solo${stamp()}`;
        const company = `Persad Catering ${stamp()}`;
        const dialog = await openQuickAdd(page);
        await dialog.getByPlaceholder("Jane", { exact: true }).fill(first);
        await dialog.getByRole("button", { name: /more fields/i }).click();
        await dialog.getByPlaceholder("Acme Co.").fill(company);
        const created = page.waitForResponse(contactPost(owner.businessId));
        await dialog.getByRole("button", { name: /^add contact$/i }).click();
        const res = await created;
        expect(res.status(), await res.text()).toBe(201);
        const { id } = (await res.json()) as { id: string };
        await expect(dialog, "a saved contact closes the dialog").toBeHidden();

        const read = await request.get(`${API_URL}/crm/businesses/${owner.businessId}/contacts/${id}`, {
          headers: { Authorization: `Bearer ${owner.token}` },
        });
        expect(read.status()).toBe(200);
        const { contact } = (await read.json()) as { contact: { firstName: string; lastName: string | null; companyName: string | null } };
        expect(contact.firstName).toBe(first);
        expect(contact.companyName, "BUG-034: Company is saved").toBe(company);
        expect(contact.lastName ?? "", "BUG-035: no invented last name").toBe("");
        await expect(page.getByText(`${first} User`), "the list shows no '<name> User'").toHaveCount(0);
      });
    });
  });
}
