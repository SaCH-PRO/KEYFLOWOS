import type { Locator, Page, Route } from "@playwright/test";
import { test, expect, API_URL, settle } from "./journeys/journey-helpers";

/**
 * EXPENSES-HUB-3, the browser half (journey H4 "a category from a list and a receipt photo"; BUG-060). The jsdom half
 * is src/app/app/expenses/__tests__/expense-receipt-upload.test.tsx and expenses-tabs-mounted.test.tsx.
 *
 * For a fresh business on a real API and database, at 375 (a phone) and 1440:
 *   1. Expenses > Categories creates a category (BUG-060: the tab was never mounted, so no category could be made);
 *   2. the page's Upload receipt is a photo control that opens the camera on a phone (accept image/*, capture);
 *   3. choosing a photo uploads it through the presigned upload and opens Add expense with the receipt attached;
 *      the expense is saved with the new category picked from the sheet's list, and the API answers it with
 *      receiptUrl = the API's object path;
 *   4. after a reload the uploader still finds that stored path on the expense (its detail page links it, and the
 *      API re-read holds it).
 *
 * What is stubbed, and why: only the object-storage provider. The presign route (POST /uploads/request-url) needs
 * S3 (core/object-storage is S3 only), which the local and CI stacks do not have, so this spec answers that one
 * request and the PUT it names (a localhost address: the harness fails any request that leaves localhost).
 * Everything after the upload (the expense save, the reload, the re-read) is the real API and database.
 *
 * Not asserted: that the image loads. No server route serves /objects/... (CONTRADICTION on issue #80,
 * comment 7199263047), so the stored path answers nothing yet for anyone. The read from another session is the
 * pending case below, named for server row P222 (an authenticated, business-scoped receipt read route).
 *
 * Live only (E2E_LIVE=1, a production build, a real API and database: the journey harness's fixtures, README in
 * e2e/journeys); without E2E_LIVE every case is skipped. Run it in the "chromium" project.
 */

const VIEWPORTS = [
  { name: "phone", width: 375, height: 812, mobile: true },
  { name: "desktop", width: 1440, height: 900, mobile: false },
] as const;

const STORAGE = "http://127.0.0.1:5999/kf-e2e-storage";
const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;
// A 1x1 PNG.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c63f8cfc0f01f0005000201ffa165b10000000049454e44ae426082",
  "hex",
);

/** Answers the presign request and the PUT it names in place of the S3 provider; returns what it received. */
async function stubObjectStorage(page: Page, businessId: string) {
  const seen = { presign: [] as Record<string, unknown>[], puts: [] as { bytes: number; contentType: string | null }[], objectPath: "" };
  const objectId = `e2e${stamp()}`;
  seen.objectPath = `/objects/uploads/${businessId}/${objectId}`;
  await page.route(`${API_URL}/uploads/request-url`, async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    seen.presign.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ uploadURL: `${STORAGE}/${objectId}?X-Amz-Signature=e2e`, objectPath: seen.objectPath, metadata: { name: body.name, size: body.size, contentType: body.contentType } }),
    });
  });
  await page.route(`${STORAGE}/**`, async (route: Route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "PUT", "access-control-allow-headers": "*" } });
    seen.puts.push({ bytes: req.postDataBuffer()?.length ?? 0, contentType: req.headers()["content-type"] ?? null });
    return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, body: "" });
  });
  return seen;
}

async function press(button: Locator, what: string): Promise<void> {
  await expect(button, what).toBeVisible();
  await button.scrollIntoViewIfNeeded();
  await button.click({ timeout: 10_000 });
}

for (const vp of VIEWPORTS) {
  test.describe(`EXPENSES-HUB-3 category and receipt photo (${vp.name} ${vp.width}x${vp.height})`, () => {
    test.use(
      vp.mobile
        ? { viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
        : { viewport: { width: vp.width, height: vp.height } },
    );

    test("a category made on the Categories tab, a receipt photo uploaded into receiptUrl, the stored path kept after a reload", async ({ page, request, owner }, testInfo) => {
      test.setTimeout(5 * 60_000);
      const categoryName = `Supplies ${stamp()}`;
      const description = `Flour ${stamp()}`;

      await page.goto("/app/expenses");
      await settle(page, 1_500);

      await test.step("Expenses > Categories creates a category (BUG-060)", async () => {
        await press(page.getByRole("tab", { name: "Categories" }), "the Categories tab");
        await page.getByLabel(/^category name$/i).fill(categoryName);
        const created = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/expenses/businesses/${owner.businessId}/expense-categories`);
        await press(page.getByRole("button", { name: /^add category$/i }), "Add category");
        const res = await created;
        expect(res.status(), await res.text()).toBe(201);
        await expect(page.getByText(categoryName).first(), "the new category is listed").toBeVisible();
        await press(page.getByRole("tab", { name: "Expenses" }), "the Expenses tab");
      });

      const storage = await stubObjectStorage(page, owner.businessId);
      let stored = "";

      await test.step("Upload receipt is a photo control that opens the camera on a phone", async () => {
        const input = page.getByLabel(/^upload receipt$/i);
        await expect(input).toHaveAttribute("type", "file");
        expect(await input.getAttribute("accept"), "the receipt takes images").toMatch(/image\//);
        expect(await input.getAttribute("capture"), "on a phone the receipt opens the camera (capture)").toBe("environment");
      });

      await test.step("a photo uploads through the presigned upload and opens Add expense with it attached", async () => {
        await page.getByLabel(/^upload receipt$/i).setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PNG });
        const sheet = page.getByRole("dialog").filter({ visible: true }).last();
        await expect(sheet, "Add expense opens with the receipt").toBeVisible();
        await expect(sheet.getByText(/receipt attached/i)).toBeVisible();
        expect(storage.presign, "one presign request, for this business").toEqual([expect.objectContaining({ businessId: owner.businessId, name: "receipt.png", contentType: "image/png" })]);
        expect(storage.puts, "the photo's bytes were PUT to the presigned URL").toEqual([{ bytes: PNG.length, contentType: "image/png" }]);
        await page.screenshot({ path: testInfo.outputPath(`receipt-sheet-${vp.width}.png`), fullPage: true });

        await sheet.getByPlaceholder(/what was this expense for|description/i).first().fill(description);
        await sheet.getByPlaceholder("0.00").first().fill("86.40");
        const category = sheet.locator("select").filter({ has: page.locator("option", { hasText: categoryName }) });
        await expect(category, `the sheet's category list offers '${categoryName}'`).toHaveCount(1);
        await category.selectOption({ label: categoryName });
        const saved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/expenses/businesses/${owner.businessId}/expenses`);
        await press(sheet.getByRole("button", { name: /^(add|save|create)( expense)?$/i }).filter({ visible: true }).last(), "the sheet's Add expense");
        const res = await saved;
        expect(res.status(), await res.text()).toBe(201);
        const body = (await res.json()) as { id: string; receiptUrl?: string | null; categoryId?: string | null };
        expect(body.receiptUrl, "the expense is saved with the uploaded receipt's path").toBe(`${API_URL}${storage.objectPath}`);
        expect(body.categoryId, "and the category chosen from the list").toBeTruthy();
        stored = body.id;
      });

      await test.step("after a reload the uploader finds the stored receipt path on the expense", async () => {
        await page.reload();
        await settle(page, 1_500);
        // The list opens on Inbox; a paid expense with its receipt and category is Approved, so read All.
        await press(page.getByRole("button", { name: /^all\b/i }).filter({ visible: true }).first(), "the All status tab");
        await press(page.getByText(description).filter({ visible: true }).first(), "the saved expense in the list");
        await page.waitForURL(new RegExp(`/app/expenses/${stored}$`), { timeout: 30_000 });
        const link = page.getByRole("link", { name: /view receipt|download/i }).first();
        await expect(link, "the detail page links the stored receipt").toHaveAttribute("href", `${API_URL}${storage.objectPath}`);
        const reread = await request.get(`${API_URL}/expenses/businesses/${owner.businessId}/expenses/${stored}`, { headers: { Authorization: `Bearer ${owner.token}` } });
        expect(reread.status()).toBe(200);
        expect(((await reread.json()) as { receiptUrl?: string }).receiptUrl, "the API re-read holds the path").toBe(`${API_URL}${storage.objectPath}`);
      });
    });

    test(
      "another session sees the receipt image (pending server row P222: an authenticated, business-scoped receipt read route)",
      { tag: "@pending-P222" },
      async () => {
        test.fixme(true, "P222: no server route serves /objects/...; issue #80 CONTRADICTION 7199263047. Unblock when P222 lands.");
      },
    );
  });
}
