import type { Locator, Page } from "@playwright/test";
import { test, expect, settle } from "./journeys/journey-helpers";

/**
 * SWP-INV-FORM-UX, the browser half (sweep BUG-052, BUG-090, BUG-092, BUG-093; journey E reads the same pages). The
 * jsdom half is src/app/app/commerce/invoices/__tests__/invoice-form-ux.test.tsx.
 *
 * The sweep's steps, at 1440x900:
 *   - BUG-052: on the new-invoice page, a line's Total and its remove button sat outside the line's card (the card
 *     clips them), so neither could be seen or pressed;
 *   - BUG-090: Save Draft with no client gave no plain message;
 *   - BUG-092: the edit page of an invoice that does not exist showed an editable form;
 *   - BUG-093: a Classic / Modern / Minimal picker that changed nothing.
 *
 * Here, for a fresh owner on a real API and database (live only: E2E_LIVE=1, a production build; the journey
 * harness's fixtures, README in e2e/journeys; without E2E_LIVE every case is skipped, so the mocked CI job is
 * unaffected), at 1440x900, 1024x768, 768x1024 and 375x812:
 *   1. after adding a second line with a long description and prices, each line's Total and remove button are inside
 *      the Line Items card and are what the browser hits at their centre (elementFromPoint); each line's description
 *      box is hit too and is at least 120 px wide; a 1,250,000.00 total does not run into the cell before it
 *      (review F1, F3: at 1024 and 768 the first fix left the description box 0 px wide);
 *   2. Save Draft with no client says "Choose a client" and no invoice is created;
 *   3. no template picker;
 *   4. /app/commerce/invoices/<an id that does not exist>/edit shows "Invoice not found" and no Save Changes.
 *
 *   E2E_LIVE=1 E2E_VARIANT=ai-disabled E2E_API_URL=... E2E_JWT_SECRET=... \
 *     E2E_NO_SERVER=1 E2E_BASE_URL=... npx playwright test e2e/sweep-invoice-form.spec.ts --project=chromium
 */

/** True when the element is inside the container's box and the browser hits it (or a child) at its centre. */
async function reachableInside(page: Page, el: Locator, container: Locator): Promise<{ inside: boolean; hit: boolean }> {
  await el.scrollIntoViewIfNeeded();
  const [box, outer] = [await el.boundingBox(), await container.boundingBox()];
  if (!box || !outer) return { inside: false, hit: false };
  const inside = box.x >= outer.x - 0.5 && box.y >= outer.y - 0.5
    && box.x + box.width <= outer.x + outer.width + 0.5 && box.y + box.height <= outer.y + outer.height + 0.5;
  const hit = await el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!at && (at === node || node.contains(at));
  });
  return { inside, hit };
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]) {
  test.describe(`SWP-INV-FORM-UX the invoice forms (${viewport.width}x${viewport.height})`, () => {
    test.use(viewport.width < 600 ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport });
    test.use({ tenantOptions: { currency: "TTD" } });

    test("line totals and remove buttons are inside the card and pressable; no client says 'Choose a client'; no template picker; a missing invoice's edit page says not found", async ({ page, owner }) => {
      test.setTimeout(3 * 60_000);
      const creates: string[] = [];
      page.on("request", (r) => {
        if (r.method() === "POST" && new URL(r.url()).pathname === `/commerce/businesses/${owner.businessId}/invoices`) creates.push(r.url());
      });

      await page.goto("/app/commerce/invoices/new");
      await expect(page.getByRole("heading", { name: "New Invoice" })).toBeVisible();
      await settle(page, 1_000);
      await page.getByRole("button", { name: /add item/i }).click();
      const descriptions = page.getByPlaceholder("Item description");
      await expect(descriptions).toHaveCount(2);
      const lines = [
        ["Three-tier wedding cake with sugar flowers, delivered and set up at the venue", "1", "1250"],
        ["Catering for 400 guests", "1", "1250000"],
      ] as const;
      for (let i = 0; i < lines.length; i++) {
        await descriptions.nth(i).fill(lines[i][0]);
        const row = descriptions.nth(i).locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' grid ')][1]");
        const numbers = row.locator('input[type="number"]');
        await numbers.nth(0).fill(lines[i][1]);
        await numbers.nth(1).fill(lines[i][2]);
      }

      await test.step("BUG-052: each line's Total and remove button are inside the Line Items card and hit", async () => {
        const card = page.getByRole("heading", { name: "Line Items" }).locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
        for (let i = 0; i < lines.length; i++) {
          const row = descriptions.nth(i).locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' grid ')][1]");
          const total = row.getByTestId("invoice-line-total");
          const remove = row.getByRole("button", { name: /remove line/i });
          expect(await reachableInside(page, total, card), `line ${i + 1} Total`).toEqual({ inside: true, hit: true });
          expect(await reachableInside(page, remove, card), `line ${i + 1} remove`).toEqual({ inside: true, hit: true });
          const description = descriptions.nth(i);
          expect(await reachableInside(page, description, card), `line ${i + 1} description`).toEqual({ inside: true, hit: true });
          expect((await description.boundingBox())?.width ?? 0, `line ${i + 1} description width`).toBeGreaterThanOrEqual(120);
          // The amount's text does not run into the cell before it.
          const clear = await total.evaluate((node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            const text = range.getBoundingClientRect();
            const before = node.parentElement?.previousElementSibling?.getBoundingClientRect();
            return !before || text.left >= before.right - 0.5 || text.top >= before.bottom - 0.5;
          });
          expect(clear, `line ${i + 1} total clear of the cell before it`).toBe(true);
        }
        await expect(page.getByTestId("invoice-line-total").first()).toHaveText(/1,250\.00/);
        await expect(page.getByTestId("invoice-line-total").nth(1)).toHaveText(/1,250,000\.00/);
      });

      await test.step("BUG-093: no template picker", async () => {
        for (const name of ["Classic", "Modern", "Minimal"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
      });

      await test.step("BUG-090: Save Draft with no client says 'Choose a client' and creates nothing", async () => {
        await page.getByRole("button", { name: /save draft/i }).click();
        await expect(page.getByText(/choose a client/i).first()).toBeVisible();
        await page.waitForTimeout(500);
        expect(creates).toEqual([]);
      });

      await test.step("BUG-092: the edit page of an invoice that does not exist says not found", async () => {
        await page.goto("/app/commerce/invoices/inv_does_not_exist_fux/edit");
        await expect(page.getByRole("heading", { name: "Invoice not found" })).toBeVisible();
        await expect(page.getByRole("button", { name: /save changes/i })).toHaveCount(0);
      });
    });
  });
}
