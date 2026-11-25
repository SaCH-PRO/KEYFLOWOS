import { test, expect, API_URL, RUN, anonymousContext, settle, type Tenant } from "./journeys/journey-helpers";

/**
 * CATALOG-1 web, review round 3 (COR-CAT-R2-1), the browser half of journey B4 for a product made in Sales > Products
 * with the form's defaults: at 67035693 such a product was created tracked + "hide" with no stock, so after 'Add to
 * store' the public store (/book/<slug>) never showed it. Created with the defaults (Untracked), it shows, once.
 *
 * Live only (E2E_LIVE=1; README in e2e/journeys), at 1440x900 and 375x812.
 */

const auth = (t: Tenant) => ({ Authorization: `Bearer ${t.token}` });

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test.describe(`a product made with the form's defaults shows on the store (${viewport.width}x${viewport.height})`, () => {
    test.use(viewport.width < 600 ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport });

    test("New product (defaults) > Add to store > the customer sees it once on /book/<slug>", async ({ page, request, owner, browser }) => {
      test.setTimeout(4 * 60_000);
      const name = `Mango chow ${Date.now().toString(36).slice(-5)}`;
      const slug = `${RUN.replace(/_/g, "-")}-vis${viewport.width}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const patched = await request.patch(`${API_URL}/identity/businesses/${owner.businessId}`, { headers: auth(owner), data: { slug } });
      expect(patched.status(), await patched.text()).toBe(200);

      await test.step("create it in Sales > Products, touching only Name and Price", async () => {
        await page.goto("/app/commerce/products");
        await page.getByRole("button", { name: /^new product$/i }).first().click();
        const form = page.getByRole("dialog").filter({ visible: true }).last();
        await form.getByLabel(/^name/i).first().fill(name);
        await form.getByLabel(/^price/i).first().fill("15");
        const created = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/commerce/businesses/${owner.businessId}/products`);
        await form.getByRole("button", { name: /^create product$/i }).click();
        expect((await created).status()).toBe(201);
      });

      await test.step("Your page > Catalog: Add to store", async () => {
        await page.goto("/app/store?tab=catalog");
        const row = page.locator("li").filter({ hasText: name }).last();
        await expect(row).toBeVisible();
        const done = page.waitForResponse((r) => r.request().method() === "POST" && r.status() < 400 && r.url().startsWith(API_URL));
        await row.getByRole("button", { name: /add to store/i }).click();
        await done;
        await expect(row.getByRole("button", { name: /remove from store/i })).toBeVisible();
      });

      await test.step("the customer sees it exactly once on /book/<slug>", async () => {
        const customer = await anonymousContext(browser, { who: "customer" });
        const shop = await customer.newPage();
        await shop.goto(`/book/${slug}`);
        await settle(shop, 1_500);
        await expect.poll(() => shop.getByText(name, { exact: true }).count(), { message: `'${name}' on /book/${slug}`, timeout: 15_000 }).toBe(1);
      });
    });
  });
}
