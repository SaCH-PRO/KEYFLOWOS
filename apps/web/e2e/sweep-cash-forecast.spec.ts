import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect, API_URL, memberOf, settle, signedInContext, type Tenant } from "./journeys/journey-helpers";

/**
 * SWP-FIN-CASH-SOURCES, the browser half of the web packet (journeys H and I;
 * BUG-023, BUG-110; owner rulings D-13, D-135, D-100). The jsdom half is
 * src/app/app/reports/components/__tests__/cash-flow-forecast-ledger-cash.test.tsx;
 * the server half (M19, P72) is test/cash-position.integration.test.ts in apps/server.
 *
 * GET /ai/businesses/:id/ai/cash-flow-forecast opens on the ledger's cash
 * (CashPositionService): booked entries up to now, in the business currency,
 * with the other currencies' cash apart and unconverted. Reports > Cash Flow
 * Forecast labelled its figures "TTD" whatever the business currency (or the
 * generated report's), never said what the balance is, and showed none of the
 * cash held in another currency.
 *
 * Here, for a fresh USD business on a real API and database:
 *   - USD cash 350 in the ledger: a USD till with a 200 opening, and 150 paid in
 *     cash on a 400 invoice (a part payment counts);
 *   - a 1,000 USD cash entry dated ten days ahead, which is not cash today;
 *   - a TTD bank account with a 550 opening: cash in a second currency.
 * Then:
 *   1. the API: the forecast's currentBalance is 350 USD, the balance sheet's
 *      cash, with the TTD 550 listed apart (never added: not 900, not 1,350);
 *   2. Reports > Cash Flow Forecast shows USD 350.00, says it is booked ledger
 *      cash in USD with future-dated entries not counted, lists TTD 550.00
 *      apart as not converted and not included, and nothing on the page sums
 *      them; the page has no sideways scroll;
 *   3. a STAFF member without revenue read sees the revenue-access notice and
 *      no figure (D-100).
 *
 * Widths 375 (a phone), 768, 1024 and 1440. Live only (E2E_LIVE=1, a
 * production build, a real API and database: the journey harness's fixtures,
 * README in e2e/journeys); without E2E_LIVE every case is skipped. Run it in
 * the "chromium" project.
 */

const VIEWPORTS = [
  { name: "phone", width: 375, height: 812, mobile: true },
  { name: "tablet", width: 768, height: 1024, mobile: false },
  { name: "laptop", width: 1024, height: 768, mobile: false },
  { name: "desktop", width: 1440, height: 900, mobile: false },
] as const;

async function api<T = Record<string, unknown>>(
  request: APIRequestContext,
  owner: Tenant,
  method: "GET" | "POST" | "PATCH",
  path: string,
  data?: unknown,
): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, { method, headers: { Authorization: `Bearer ${owner.token}` }, data });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 400)}`).toBe(method === "POST" ? 201 : 200);
  return (text ? JSON.parse(text) : null) as T;
}

/** USD 350 today, USD 1,000 dated ahead, TTD 550 in a second account. */
async function seedCashBook(request: APIRequestContext, owner: Tenant): Promise<void> {
  const b = owner.businessId;
  await api(request, owner, "POST", `/finance/businesses/${b}/accounts`, { name: "Till", type: "CASH", currency: "USD", openingBalance: 200 });
  await api(request, owner, "POST", `/finance/businesses/${b}/accounts`, { name: "TT bank", type: "BANK", currency: "TTD", openingBalance: 550 });

  const stamp = `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;
  const contact = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${b}/contacts`, {
    firstName: "Maria",
    lastName: `Cash${stamp}`,
    email: `cash${stamp}@v62j.test.local`,
  });
  const invoice = await api<{ id: string }>(request, owner, "POST", `/commerce/businesses/${b}/invoices`, {
    contactId: contact.id,
    currency: "USD",
    items: [{ description: "Catering", quantity: 1, unitPrice: 400 }],
  });
  await api(request, owner, "PATCH", `/commerce/invoices/${invoice.id}/status/sent`, { businessId: b, status: "SENT" });
  await api(request, owner, "POST", `/commerce/businesses/${b}/invoices/${invoice.id}/payments`, {
    amount: 150,
    method: "Cash",
    idempotencyKey: `${invoice.id}-part`,
  });

  const chart = await api<{ items: Array<{ id: string; systemKey: string | null }> }>(request, owner, "GET", `/finance/businesses/${b}/chart-of-accounts`);
  const row = (key: string) => {
    const found = chart.items.find((a) => a.systemKey === key);
    expect(found, `the chart of accounts has ${key}`).toBeTruthy();
    return found!.id;
  };
  await api(request, owner, "POST", `/finance/businesses/${b}/journal-entries`, {
    date: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    description: "Owner deposit, dated ahead",
    entries: [
      { accountId: row("CASH"), debit: 1000 },
      { accountId: row("OWNER_EQUITY"), credit: 1000 },
    ],
  });
}

/** Reports > Cash Flow Forecast, once its balance is on screen. */
async function openForecast(page: Page): Promise<void> {
  await page.goto("/app/reports?tab=cash-flow");
  await settle(page, 1_500);
  await page.keyboard.press("Escape");
}

for (const vp of VIEWPORTS) {
  test.describe(`SWP-FIN-CASH-SOURCES the Reports forecast shows ledger cash (${vp.name} ${vp.width}x${vp.height})`, () => {
    test.use(
      vp.mobile
        ? { viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
        : { viewport: { width: vp.width, height: vp.height } },
    );
    test.use({ tenantOptions: { currency: "USD" } });

    test("USD 350 ledger cash, the future entry not counted, TTD 550 listed apart and never summed; a member without revenue read sees no figure", async ({ page, request, owner, browser }, testInfo) => {
      test.setTimeout(4 * 60_000);
      await seedCashBook(request, owner);

      await test.step("the API: the forecast opens on the balance sheet's cash, the TTD apart", async () => {
        const forecast = await api<{
          currentBalance: number;
          currency?: string;
          cashBasis?: string;
          otherCurrencyCash?: Array<{ currency: string; amount: number }>;
        }>(request, owner, "GET", `/ai/businesses/${owner.businessId}/ai/cash-flow-forecast?days=90`);
        const sheet = await api<{ assets: { cashAndBank: number } }>(request, owner, "GET", `/businesses/${owner.businessId}/reports/balance-sheet`);
        testInfo.annotations.push({ type: "forecast", description: JSON.stringify({ forecast, sheetCash: sheet.assets.cashAndBank }) });
        expect(forecast.currentBalance, "ledger cash today: 200 opening + 150 part payment; the 1,000 dated ahead is not in it").toBe(350);
        expect(Number(sheet.assets.cashAndBank), "the balance sheet's cash").toBe(forecast.currentBalance);
        expect({ currency: forecast.currency, cashBasis: forecast.cashBasis, other: forecast.otherCurrencyCash }).toEqual({
          currency: "USD",
          cashBasis: "ledger",
          other: [{ currency: "TTD", amount: 550 }],
        });
      });

      await test.step("Reports > Cash Flow Forecast: USD 350.00, its basis, TTD 550.00 apart", async () => {
        await openForecast(page);
        const main = page.locator("main").first();
        const balance = main.getByText("Current Balance", { exact: true });
        await expect(balance, "the forecast's Current Balance").toBeVisible({ timeout: 30_000 });
        const card = balance.locator("xpath=../..");
        await expect.soft(card, "the balance is the USD ledger cash").toHaveText(/USD\s*350\.00/);
        await expect.soft(main.getByTestId("cash-basis"), "it says what the balance is").toHaveText(
          /booked ledger cash in USD up to today; future-dated entries are not counted/i,
        );
        const other = main.getByTestId("other-currency-cash");
        await expect.soft(other, "the TTD cash is listed apart").toContainText("TTD 550.00");
        await expect.soft(other, "and says it is not converted nor included").toContainText(/not converted, and not included/i);
        const text = (await main.innerText()).replace(/\s+/g, " ");
        expect.soft(text, "no figure adds the TTD to the USD (900) or counts the entry dated ahead (1,350 today)").not.toMatch(/\b900\.00|USD\s*1,350\.00|TTD\s*350\.00/);
        expect.soft(text, "no figure is labelled TTD but the TTD cash").not.toMatch(/TTD\s*(?!550\.00)[\d,]+\.\d{2}/);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect.soft(overflow, "no sideways scroll").toBeLessThanOrEqual(1);
        await page.screenshot({ path: testInfo.outputPath(`cash-forecast-${vp.width}.png`), fullPage: true });
      });

      await test.step("a member without revenue read sees the notice and no figure (D-100)", async () => {
        const member = await memberOf(request, owner, `cash member ${vp.width}`, { role: "STAFF", scopes: { crm: "read" } });
        const context = await signedInContext(browser, member, {
          viewport: { width: vp.width, height: vp.height },
          ...(vp.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
        });
        const memberPage = await context.newPage();
        await openForecast(memberPage);
        const main = memberPage.locator("main").first();
        await expect(main.getByText("Cash flow forecast needs revenue access."), "the revenue-access notice").toBeVisible({ timeout: 30_000 });
        const text = (await main.innerText()).replace(/\s+/g, " ");
        expect.soft(text, "no cash figure").not.toMatch(/350\.00|550\.00|1,350|Current Balance/);
        await expect.soft(main.getByTestId("other-currency-cash")).toHaveCount(0);
        await expect.soft(main.getByTestId("cash-basis")).toHaveCount(0);
        await memberPage.screenshot({ path: testInfo.outputPath(`cash-forecast-member-${vp.width}.png`), fullPage: true });
        await context.close();
      });
    });
  });
}
