import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect, settle, API_URL, coveredButtonFindings, type Tenant } from "./journeys/journey-helpers";

/**
 * CATALOG-1, the web half (SWP-PRODUCT-CREATE, BUG-005; journey B1 reads the same page). The jsdom half is
 * src/app/app/commerce/products/__tests__/products-page.test.tsx.
 *
 * Before this packet Sales > Products did not exist: /app/commerce/products was a 404, so an owner could not create,
 * edit or archive a product anywhere, and the doors that name it ('Manage products' in Settings > Catalog, 'Add
 * product' in the command palette's Sales actions) opened the 404. Your page > Catalog's 'Manage in Commerce' opened
 * the Sales overview, which has no products. Photos were kept in this browser only (lib/image-store.ts, IndexedDB).
 *
 * Here, for a fresh owner whose business sells in USD (so a price in TTD, the old default, is caught), on a real API
 * and database (live only: E2E_LIVE=1, a production build; the journey harness's fixtures, README in e2e/journeys;
 * without E2E_LIVE every case is skipped, so the mocked CI job is unaffected), at 1440x900, 1024x768, 768x1024 and
 * 375x812:
 *   1. the doors: Settings > Catalog 'Manage products' and Your page > Catalog's 'Manage products' link to Sales >
 *      Products (soft checks, so a missing door does not hide the steps after it);
 *   2. Sales > Products offers New product, pressable (nothing covers it);
 *   3. the form's Name and Price are labelled fields, the price is in the business currency, and Create Product makes
 *      the product (201, stored in USD) and lists it once, with its price in USD;
 *   4. the product row's Edit opens the form with the product; a new price is stored and read back after a reload;
 *   5. the form offers no photo upload that would keep the photo in this browser only (no file input), and the
 *      stored product carries no browser-only image address;
 *   6. the row's Archive takes the product off the list (read back after a reload and through the API);
 *   7. ?action=add (the command palette's 'Add product') opens New product.
 *
 *   E2E_LIVE=1 E2E_VARIANT=ai-disabled E2E_API_URL=... E2E_JWT_SECRET=... \
 *     E2E_WEB_COMMAND=standalone E2E_BASE_URL=... E2E_PORT=... npx playwright test e2e/sweep-product-create.spec.ts --project=chromium
 */

const auth = (t: Tenant) => ({ Authorization: `Bearer ${t.token}` });

async function listProducts(request: APIRequestContext, owner: Tenant) {
  const res = await request.get(`${API_URL}/commerce/businesses/${owner.businessId}/products?pageSize=100`, { headers: auth(owner) });
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { data?: Array<{ id: string; name: string; price: number; currency: string; imageUrl?: string | null }> };
  return body.data ?? [];
}

/** The product's row on Sales > Products: the list item (article) that names it. */
function rowOf(page: Page, name: string): Locator {
  return page.locator("article").filter({ hasText: name });
}

/** A row action by name: on the row, or behind the row's More actions menu. */
async function rowAction(page: Page, row: Locator, name: RegExp): Promise<Locator> {
  const direct = row.getByRole("button", { name }).filter({ visible: true });
  if (await direct.count()) return direct.first();
  const menu = row.getByRole("button", { name: /more|actions/i }).filter({ visible: true });
  await expect(menu.first(), `the row offers '${name.source}' or a More actions menu`).toBeVisible();
  await menu.first().click();
  const item = page.getByRole("menuitem", { name }).filter({ visible: true });
  await expect(item.first(), `'${name.source}' in the row's menu`).toBeVisible();
  return item.first();
}

async function pressable(button: Locator, what: string) {
  await expect(button, what).toBeVisible();
  expect(await coveredButtonFindings([{ what, locator: button }]), `${what} can be pressed`).toEqual([]);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]) {
  test.describe(`SWP-PRODUCT-CREATE Sales > Products (${viewport.width}x${viewport.height})`, () => {
    test.use(viewport.width < 600 ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport });
    test.use({ tenantOptions: { currency: "USD" } });

    test("the doors open Sales > Products; New product creates a product in the business currency; Edit and Archive work; no browser-only photo", async ({ page, request, owner }) => {
      test.setTimeout(4 * 60_000);
      const name = `Pepper sauce ${Date.now().toString(36).slice(-5)}`;

      await test.step("the doors: Settings > Catalog 'Manage products' and Your page > Catalog open Sales > Products", async () => {
        await page.goto("/app/settings/catalog");
        const manage = page.getByRole("link", { name: /manage products/i }).first();
        await expect.soft(manage, "Settings > Catalog links to Sales > Products").toHaveAttribute("href", "/app/commerce/products");
        await page.goto("/app/store?tab=catalog");
        await settle(page, 1_000);
        const door = page.getByRole("link", { name: /manage products/i }).filter({ visible: true }).first();
        await expect.soft(door, "Your page > Catalog links to Sales > Products").toHaveAttribute("href", "/app/commerce/products");
      });

      await test.step("Sales > Products exists and offers New product, pressable", async () => {
        await page.goto("/app/commerce/products");
        await expect(page.getByRole("heading", { name: /page not found|404/i }), "Sales > Products exists (/app/commerce/products)").toHaveCount(0);
        await expect(page.getByRole("heading", { name: /^products$/i }).first()).toBeVisible();
        await pressable(page.getByRole("button", { name: /new product/i }).first(), "New product");
      });

      let productId = "";
      await test.step("New product: labelled Name and Price, the price in USD; Create Product stores it in USD and lists it once", async () => {
        await page.getByRole("button", { name: /new product/i }).first().click();
        const form = page.getByRole("dialog").filter({ visible: true }).last();
        await expect(form).toBeVisible();
        await form.getByLabel(/^name/i).first().fill(name);
        await form.getByLabel(/^price/i).first().fill("45");
        await expect(form.getByText(/\bUSD\b/).first(), "the price is in the business currency").toBeVisible();
        await expect(form.getByText(/\bTTD\b/), "no TTD on a USD business's form").toHaveCount(0);
        const created = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/commerce/businesses/${owner.businessId}/products`);
        const create = form.getByRole("button", { name: /^(save|create|add)( product)?$/i });
        await pressable(create, "Create Product");
        await create.click();
        const res = await created;
        expect(res.status(), await res.text()).toBe(201);
        const body = (await res.json()) as { id: string; currency: string; price: number };
        productId = body.id;
        expect({ currency: body.currency, price: body.price }).toEqual({ currency: "USD", price: 45 });
        await expect(rowOf(page, name)).toHaveCount(1);
        await expect(rowOf(page, name)).toContainText(/USD\s*45\.00/);
      });

      await test.step("the row's Edit: a new price is stored and read back after a reload", async () => {
        await (await rowAction(page, rowOf(page, name), /^edit/i)).click();
        const form = page.getByRole("dialog").filter({ visible: true }).last();
        await expect(form.getByLabel(/^name/i).first()).toHaveValue(name);
        await form.getByLabel(/^price/i).first().fill("50");
        const updated = page.waitForResponse((r) => r.request().method() === "PATCH" && new URL(r.url()).pathname.endsWith(`/products/${productId}`));
        await form.getByRole("button", { name: /^(save|update)/i }).click();
        expect((await updated).status()).toBe(200);
        await page.reload();
        await expect(rowOf(page, name)).toContainText(/USD\s*50\.00/);
        expect((await listProducts(request, owner)).find((p) => p.id === productId)?.price).toBe(50);
      });

      await test.step("no photo kept in this browser only: no file input, and no browser-only address stored", async () => {
        await (await rowAction(page, rowOf(page, name), /^edit/i)).click();
        const form = page.getByRole("dialog").filter({ visible: true }).last();
        await expect(form).toBeVisible();
        await expect(form.locator('input[type="file"]'), "a photo upload that never reaches the server").toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(form).toBeHidden();
        const stored = (await listProducts(request, owner)).find((p) => p.id === productId)?.imageUrl ?? "";
        expect(stored).not.toMatch(/^(data|blob|idb|indexeddb):|__local__/i);
      });

      await test.step("the row's Archive takes it off the list (after a reload, and in the API's list)", async () => {
        await (await rowAction(page, rowOf(page, name), /^archive/i)).click();
        const confirm = page.getByRole("button", { name: /^(archive|confirm|yes)/i }).filter({ visible: true });
        await expect(confirm.first()).toBeVisible();
        const archived = page.waitForResponse((r) => ["DELETE", "PATCH"].includes(r.request().method()) && new URL(r.url()).pathname.includes(`/products/${productId}`));
        await confirm.first().click();
        expect((await archived).status()).toBeLessThan(400);
        await page.reload();
        await expect(page.getByRole("button", { name: /new product/i }).first()).toBeVisible();
        await expect(rowOf(page, name)).toHaveCount(0);
        expect((await listProducts(request, owner)).map((p) => p.id)).not.toContain(productId);
      });

      await test.step("?action=add (the command palette's 'Add product') opens New product", async () => {
        await page.goto("/app/commerce/products?action=add");
        const form = page.getByRole("dialog").filter({ visible: true }).last();
        await expect(form.getByLabel(/^name/i).first()).toBeVisible();
        await expect(form.getByRole("button", { name: /^create product$/i })).toBeVisible();
      });
    });
  });
}
