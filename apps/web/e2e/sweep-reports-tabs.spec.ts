import type { Page } from "@playwright/test";
import { test, expect, settle } from "./journeys/journey-helpers";

/**
 * SWP-FIN-WEB-CRASHES, the browser half (journey H, step H8; sweep BUG-039).
 * The jsdom half is
 * src/app/app/reports/components/__tests__/books-report-tab-switch.test.tsx.
 *
 * Reports > the Books tabs kept the last report loaded and drew the next tab
 * from it before that tab's own report arrived: 'Books · Cashflow' after a P&L
 * read `accrualAdjustments` of undefined, 'Balance Sheet' after a cash flow
 * read `assets.lines`, 'Tax Summary' read `invoiceTaxes`; each threw a
 * TypeError and the page showed the app's error page ("Something went wrong").
 *
 * Here, for a fresh business on a real API and database, every ledger report
 * answer is held back 1.5 s (a slow network, so the switch always happens
 * while the next report is on the way). Then:
 *   1. Reports: Profit & Loss, Books · PnL, Books · Cashflow, Balance Sheet,
 *      A/R Aging, A/P Aging, Tax Summary, twice through, each opened after
 *      another one: no error page, no TypeError, and each tab ends on its own
 *      report (its own heading line);
 *   2. /app/finance lands on /app/financial-flow, not on the error page.
 *
 * Widths 375 (a phone) and 1440. Live only (E2E_LIVE=1, a production build, a
 * real API and database: the journey harness's fixtures, README in
 * e2e/journeys); without E2E_LIVE every case is skipped. Run it in the
 * "chromium" project.
 */

const VIEWPORTS = [
  { name: "phone", width: 375, height: 812, mobile: true },
  { name: "desktop", width: 1440, height: 900, mobile: false },
] as const;

/** Each Books tab, and a line only its own report draws. */
const TABS: Array<{ name: string; own: RegExp }> = [
  { name: "Profit & Loss", own: /^Gross Profit$/ },
  { name: "Books · PnL", own: /^Gross Profit$/ },
  { name: "Books · Cashflow", own: /^Net Movement$/ },
  { name: "Balance Sheet", own: /^Total Assets$/ },
  { name: "A/R Aging", own: /Total outstanding/ },
  { name: "A/P Aging", own: /Total payable/ },
  { name: "Tax Summary", own: /^Estimated tax due$/ },
];

const LEDGER_REPORTS = /\/businesses\/[^/]+\/reports\/(pnl|cashflow|balance-sheet|ar-aging|ap-aging|tax-summary)$/;

async function holdBackLedgerReports(page: Page): Promise<void> {
  await page.route((url) => LEDGER_REPORTS.test(url.pathname), async (route) => {
    if (route.request().method() === "OPTIONS") return route.continue();
    await new Promise((done) => setTimeout(done, 1_500));
    await route.continue().catch(() => undefined);
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`SWP-FIN-WEB-CRASHES Reports Books tabs switch without crashing (${vp.name} ${vp.width}x${vp.height})`, () => {
    test.use(
      vp.mobile
        ? { viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
        : { viewport: { width: vp.width, height: vp.height } },
    );

    test("each Books tab opened after another, with slow answers, shows its own report and never the error page; /app/finance lands on /app/financial-flow", async ({ page }, testInfo) => {
      test.setTimeout(5 * 60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await holdBackLedgerReports(page);

      await page.goto("/app/reports");
      await settle(page, 1_500);
      const main = page.locator("main").first();
      const crashed = () => page.getByText(/something went wrong/i).filter({ visible: true });
      const tab = (name: string) => main.getByRole("tab", { name, exact: true }).filter({ visible: true }).first();
      await expect(tab(TABS[0].name), "Reports shows its tabs").toBeVisible({ timeout: 30_000 });

      const visited: string[] = [];
      for (const round of [1, 2]) {
        for (const { name, own } of TABS) {
          await test.step(`round ${round}: ${name}`, async () => {
            await tab(name).scrollIntoViewIfNeeded();
            await tab(name).click();
            visited.push(`${round}:${name}`);
            const where = `after opening '${name}' (round ${round}; opened: ${visited.join(" > ")})`;
            // While its report is on the way, and once it has arrived.
            await page.waitForTimeout(300);
            expect(await crashed().count(), `the error page ${where}, while its report is on the way`).toBe(0);
            await expect(main.getByText(own).filter({ visible: true }).first(), `its own report ${where}`).toBeVisible({ timeout: 30_000 });
            expect(await crashed().count(), `the error page ${where}`).toBe(0);
          });
        }
      }
      expect(errors.filter((e) => /TypeError|Cannot read/i.test(e)), "page errors while switching report tabs").toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`reports-tabs-${vp.width}.png`), fullPage: true });

      await test.step("/app/finance lands on /app/financial-flow", async () => {
        await page.goto("/app/finance");
        await page.waitForURL((u) => u.pathname === "/app/financial-flow", { timeout: 30_000 });
        await settle(page, 1_500);
        expect(new URL(page.url()).pathname).toBe("/app/financial-flow");
        expect(await crashed().count(), "no error page at /app/financial-flow").toBe(0);
      });
    });
  });
}
