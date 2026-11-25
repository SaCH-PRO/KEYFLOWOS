import type { Locator } from "@playwright/test";
import { test, expect, settle, API_URL, memberOf, signedInContext, type Tenant } from "./journeys/journey-helpers";

/**
 * CATALOG-1 web, review round 1, the browser half (the jsdom half is
 * src/app/app/commerce/products/__tests__/products-page-review-r1.test.tsx):
 *   1. Sales (/app/commerce) offers a "Products" door to Sales > Products (journey B1, B5, B6 read it);
 *   2. COR-CAT-11: in the grid, a product's "Off" badge is not under its More actions button;
 *   3. SEC-CAT-1: a member whose revenue scope is "read" sees the products but no New product and no More actions.
 * Live only (E2E_LIVE=1; README in e2e/journeys), at 1440x900, 1024x768, 768x1024 and 375x812.
 */

const auth = (t: { token: string }) => ({ Authorization: `Bearer ${t.token}` });

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function box(l: Locator) {
  const b = await l.boundingBox();
  expect(b, "a laid-out box").not.toBeNull();
  return b!;
}

async function seedProduct(request: import("@playwright/test").APIRequestContext, owner: Tenant, name: string, isActive = true) {
  const res = await request.post(`${API_URL}/commerce/businesses/${owner.businessId}/products`, {
    headers: auth(owner), data: { name, price: 12, currency: owner.currency, category: "PRODUCT", isActive },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]) {
  test.describe(`CATALOG-1 review round 1 (${viewport.width}x${viewport.height})`, () => {
    test.use(viewport.width < 600 ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport });

    test("Sales offers a Products door; an Off badge is not under More actions; a revenue-read member gets no writes", async ({ page, request, owner, browser }) => {
      test.setTimeout(4 * 60_000);
      const stamp = Date.now().toString(36).slice(-5);
      const off = await seedProduct(request, owner, `Retired jar ${stamp}`, false);
      const kept = await seedProduct(request, owner, `Kept jar ${stamp}`);

      await test.step("Sales offers a visible Products door to /app/commerce/products", async () => {
        await page.goto("/app/commerce");
        await settle(page, 1_000);
        const door = page.getByRole("link", { name: /^products$/i }).filter({ visible: true }).first();
        // Soft, so a missing door does not hide the steps after it.
        await expect.soft(door, "Sales offers a visible Products door").toBeVisible();
        if (await door.count()) {
          await expect(door).toHaveAttribute("href", "/app/commerce/products");
          await door.click();
          await expect(page).toHaveURL(/\/app\/commerce\/products$/);
          await expect(page.getByRole("heading", { name: /^products$/i }).first()).toBeVisible();
        }
      });

      await test.step("grid: the inactive product's Off badge is clear of its More actions button", async () => {
        await page.evaluate(() => localStorage.setItem("kf-products-view", "grid"));
        await page.goto("/app/commerce/products");
        await page.getByRole("button", { name: /show inactive/i }).click();
        const card = page.locator("article").filter({ hasText: off.name });
        await expect(card).toHaveCount(1);
        const badge = card.getByText("Off", { exact: true });
        const more = card.getByRole("button", { name: /more actions/i });
        await expect(badge).toBeVisible();
        await expect(more).toBeVisible();
        expect.soft(overlaps(await box(badge), await box(more)), "the Off badge and More actions overlap").toBe(false);
      });

      await test.step("a member with revenue 'read' sees the products but no New product and no More actions", async () => {
        const reader = await memberOf(request, owner, `reader ${stamp}`, { role: "STAFF", scopes: { revenue: "read" } });
        const ctx = await signedInContext(browser, reader, { who: "revenue-read member" });
        const p = await ctx.newPage();
        await p.goto("/app/commerce/products");
        await expect(p.locator("article").filter({ hasText: kept.name })).toHaveCount(1);
        await settle(p, 1_500);
        await expect(p.getByRole("button", { name: /new product/i })).toHaveCount(0);
        await expect(p.getByRole("button", { name: /more actions/i })).toHaveCount(0);
        await expect(p.getByText(/changing products needs revenue write access/i)).toBeVisible();
      });
    });
  });
}
