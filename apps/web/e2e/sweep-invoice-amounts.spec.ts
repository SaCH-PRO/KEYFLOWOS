import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect, API_URL, settle, type Tenant } from "./journeys/journey-helpers";
import { JOURNEY_VIEWPORTS } from "./journeys/harness-settings";

/**
 * SWP-INV-MATH, the browser half (sweep BUG-018 and BUG-019 repro; journey E reads the same screens). The jsdom
 * half is src/app/app/commerce/invoices/__tests__/invoice-form-amounts.test.tsx; the arithmetic parity with the
 * server is src/lib/finance/__tests__/document-amounts.test.ts.
 *
 * The sweep's steps: a new invoice with tax and a discount showed one total and the saved invoice another (BUG-018:
 * the form took the tax after the discount, the server takes it on the subtotal before the discount, ruling D-164
 * keeps the server's order until the accountant answers); and clearing the tax rate on the edit page and saving kept
 * the old tax (BUG-019: the page sent no rate at all).
 *
 * Here, for a fresh owner on a real API and database, with journey D's order (a TTD 800 cake and 24 cupcakes at 10,
 * 12.5% tax, 10% off; the server's figures are 1,040 + 130 - 104 = 1,066.00):
 *   1. the new-invoice page's summary reads Total due TTD 1,066.00 before saving, and the invoice it saves has a
 *      total of 1,066 and a tax of 130 (the page used to read 1,053.00);
 *   2. on that invoice's edit page the preview reads TTD 1,066.00; the tax rate is cleared, the preview reads
 *      TTD 936.00, and after Save Changes the server's invoice has no tax and a total of 936.
 *
 * Both viewports of the journey gate run: 1440x900 and 375x812 (a phone). It is live only (E2E_LIVE=1, a production
 * build, a real API and database: the journey harness's own fixtures, README in e2e/journeys); without E2E_LIVE
 * every case is skipped, so the mocked CI job is unaffected. Run it in the "chromium" project:
 *
 *   E2E_LIVE=1 E2E_VARIANT=ai-disabled E2E_API_URL=... E2E_JWT_SECRET=... \
 *     E2E_NO_SERVER=1 E2E_BASE_URL=... npx playwright test e2e/sweep-invoice-amounts.spec.ts --project=chromium
 */

const SERVER_TOTAL = 1066;
const SERVER_TAX = 130;
const NO_TAX_TOTAL = 936;

async function api<T = Record<string, unknown>>(
  request: APIRequestContext,
  owner: Tenant,
  method: "GET" | "POST",
  path: string,
  data?: unknown,
): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, { method, headers: { Authorization: `Bearer ${owner.token}` }, data });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 400)}`).toBe(method === "POST" ? 201 : 200);
  return (text ? JSON.parse(text) : null) as T;
}

type StoredInvoice = { id: string; total: number | string; taxAmount: number | string | null; taxRate: number | string | null };

async function storedInvoice(request: APIRequestContext, owner: Tenant, id: string): Promise<StoredInvoice> {
  return api<StoredInvoice>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${id}`);
}

/** The text of the summary row that holds "Total due", on one line. */
async function totalDue(page: Page): Promise<string> {
  return ((await page.getByText(/^Total due$/).locator("xpath=..").innerText()) ?? "").replace(/\s+/g, " ");
}

/** The labelled input of the full-page invoice forms ("Tax Rate (%)", "Discount"). */
function labelledNumber(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("xpath=..").locator('input[type="number"]').first();
}

for (const [project, viewport] of Object.entries(JOURNEY_VIEWPORTS)) {
  test.describe(`SWP-INV-MATH the preview is the saved total (${project} ${viewport.width}x${viewport.height})`, () => {
    test.use(
      project === "phone"
        ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
        : { viewport },
    );
    test.use({ tenantOptions: { currency: "TTD" } });

    test("journey D's order previews and saves TTD 1,066.00, and clearing the tax saves 936 with no tax", async ({ page, request, owner }) => {
      test.setTimeout(4 * 60_000);
      const stamp = `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;
      const contact = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts`, {
        firstName: "Kezia",
        lastName: `Amounts${stamp}`,
        phone: `+18687${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
      });
      let invoiceId = "";

      await test.step("the new-invoice page previews TTD 1,066.00 and the saved invoice is 1,066 with 130 tax (BUG-018)", async () => {
        await page.goto("/app/commerce/invoices/new");
        await expect(page.getByRole("heading", { name: "New Invoice" })).toBeVisible();
        await settle(page, 1_000);
        const client = page.locator("select", { has: page.locator("option", { hasText: "Select a client..." }) });
        await expect(client.locator(`option[value="${contact.id}"]`)).toBeAttached();
        await client.selectOption(contact.id);
        await page.getByRole("button", { name: /add item/i }).click();
        const descriptions = page.getByPlaceholder("Item description");
        await expect(descriptions).toHaveCount(2);
        const fill = async (row: number, description: string, qty: string, price: string) => {
          await descriptions.nth(row).fill(description);
          const line = descriptions.nth(row).locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' grid ')][1]");
          const numbers = line.locator('input[type="number"]');
          await numbers.nth(0).fill(qty);
          await numbers.nth(1).fill(price);
        };
        await fill(0, "Wedding cake, 3 tier", "1", "800");
        await fill(1, "Cupcakes", "24", "10");
        await labelledNumber(page, "Tax Rate (%)").fill("12.5");
        await labelledNumber(page, "Discount").fill("10");
        await expect.poll(() => totalDue(page), { message: "the preview (it read TTD 1,053.00)" }).toContain("TTD 1,066.00");

        const created = page.waitForResponse(
          (r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/commerce/businesses/${owner.businessId}/invoices`,
        );
        await page.getByRole("button", { name: /save draft/i }).click();
        const res = await created;
        expect(res.status(), await res.text()).toBe(201);
        invoiceId = ((await res.json()) as { id: string }).id;
        const saved = await storedInvoice(request, owner, invoiceId);
        expect({ total: Number(saved.total), taxAmount: Number(saved.taxAmount) }, "the saved invoice equals the preview")
          .toEqual({ total: SERVER_TOTAL, taxAmount: SERVER_TAX });
      });

      await test.step("the edit page previews TTD 1,066.00; clearing the tax previews and saves 936 with no tax (BUG-019)", async () => {
        await page.goto(`/app/commerce/invoices/${invoiceId}/edit`);
        const tax = labelledNumber(page, "Tax Rate (%)");
        await expect(tax).toHaveValue("12.5");
        await expect.poll(() => totalDue(page)).toContain("TTD 1,066.00");
        await tax.fill("");
        await expect.poll(() => totalDue(page), { message: "the preview with no tax" }).toContain("TTD 936.00");

        const patched = page.waitForResponse(
          (r) => r.request().method() === "PATCH" && new URL(r.url()).pathname.endsWith(`/invoices/${invoiceId}`),
        );
        await page.getByRole("button", { name: /save changes/i }).first().click();
        const res = await patched;
        expect(res.status(), await res.text()).toBe(200);
        const saved = await storedInvoice(request, owner, invoiceId);
        expect(
          { total: Number(saved.total), taxAmount: Number(saved.taxAmount ?? 0), taxRate: Number(saved.taxRate ?? 0) },
          "the server dropped the tax (it kept 12.5% and 130)",
        ).toEqual({ total: NO_TAX_TOTAL, taxAmount: 0, taxRate: 0 });
      });
    });
  });
}
