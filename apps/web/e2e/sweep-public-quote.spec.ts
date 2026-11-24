import { test, expect, type Route } from "@playwright/test";
import { amountAfter } from "./journeys/journey-text";

/**
 * SWP-QUOTE-PUBLIC-PAGE, the browser half (sweep BUG-046; journey D4 reads the same page live). The jsdom half is
 * src/app/quote/[token]/__tests__/public-quote-totals.test.tsx.
 *
 * The sweep's step: the customer opens /quote/<token> for journey D's quote and sees the quote number, the lines and
 * a total, but not who the quote is from, and not the subtotal, the discount or the tax that make the total.
 *
 * Mocked (the "chromium" project's mocked API at http://api.test.local, as public-flows.spec.ts): the public quote
 * read answers journey D's quote with the business block and the stored figures. In a real browser, at a phone and a
 * desktop width, the page shows:
 *   1. the business's name and its logo (an image this web app serves, so nothing leaves localhost);
 *   2. Subtotal 1,040.00, Discount 104.00, Tax 130.00 and Total 1,066.00, each with the TTD code, read as journey D4
 *      reads them (amountAfter);
 *   3. no bare "$" amount.
 */

const API = "http://api.test.local";
const TOKEN = "tok_sweep_public_quote";

function quote(logoUrl: string) {
  return {
    id: "q_sweep", quoteNumber: "QT-0107", status: "SENT", lifecycleStep: "VIEWED", currency: "TTD",
    subtotal: 1040, taxRate: 12.5, taxAmount: 130, discountType: "PERCENT", discountValue: 10, discountAmount: 104,
    total: 1066, issueDate: "2026-11-20T10:00:00.000Z", expiryDate: "2026-12-20T10:00:00.000Z",
    businessId: "biz_sweep", contactId: "ct_sweep", termsVersion: "tv_sweep", createdAt: "2026-11-20T10:00:00.000Z",
    contact: { firstName: "Kezia", lastName: "Baptiste" },
    items: [
      { id: "i1", description: "Wedding cake, 3 tier", quantity: 1, unitPrice: 800, total: 800 },
      { id: "i2", description: "Cupcakes", quantity: 24, unitPrice: 10, total: 240 },
    ],
    business: { id: "biz_sweep", name: "Sugar & Spice Bakery", logoUrl, primaryColor: "#F97316" },
  };
}

for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
  test(`SWP-QUOTE-PUBLIC-PAGE: the customer's quote page names the business and states subtotal, discount, tax and total (${viewport.width}x${viewport.height})`, async ({ page, baseURL }) => {
    await page.setViewportSize(viewport);
    const logo = new URL("/icons/icon-192x192.png", baseURL ?? "http://localhost:3000").toString();
    await page.route(`${API}/commerce/public/quotes/**`, async (route: Route) => {
      if (route.request().method() !== "GET") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(quote(logo)) });
    });

    await page.goto(`/quote/${TOKEN}`);
    await expect(page.getByText("QT-0107").first()).toBeVisible();
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");

    await test.step("the business's name and logo", async () => {
      expect(text).toContain("Sugar & Spice Bakery");
      const logos = await page.locator("img").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).currentSrc || (i as HTMLImageElement).src));
      expect(logos.some((src) => src.endsWith("/icons/icon-192x192.png")), JSON.stringify(logos)).toBe(true);
    });

    await test.step("subtotal, discount, tax and total, with the currency code", async () => {
      expect(amountAfter(text, /subtotal/i)).toBe(1040);
      expect(Math.abs(amountAfter(text, /discount/i) ?? Number.NaN)).toBe(104);
      expect(amountAfter(text, /\btax\b/i)).toBe(130);
      expect(text).toContain("TTD 1,066.00");
      expect(text).not.toMatch(/(?<![A-Z])\$\s?\d/);
    });
  });
}
