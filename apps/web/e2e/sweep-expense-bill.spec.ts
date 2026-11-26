import { execFileSync } from "node:child_process";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect, API_URL, controlledClock, isLocal, settle, type Tenant } from "./journeys/journey-helpers";

/**
 * EXPENSES-HUB-2, the browser half (journey H4, H5, H7a; BUG-027, BUG-028,
 * BUG-059, BUG-061). The jsdom half is
 * src/app/app/expenses/__tests__/expense-currency-date.test.tsx and
 * expense-bill-recurring.test.tsx.
 *
 * For a fresh USD business on a real API and database, with the phone's clock
 * at 21:30 in Port of Spain (after midnight UTC):
 *   1. Expenses > Add expense names USD on its amount, nowhere TTD, and its
 *      date is today in Trinidad, not the UTC date (tomorrow);
 *   2. Expenses > Record bill saves a bill to pay later through the bill door
 *      (POST /finance/.../bills): re-read on Postgres, the expenses row is
 *      status BILL, unpaid (paid_at null), with its due date, in USD;
 *   3. Add expense with Recurring (monthly) saves the expense and creates its
 *      schedule through the existing route (POST /expenses/.../recurring):
 *      re-read on Postgres, a recurring_expenses row for this business,
 *      MONTHLY, in USD, next due one month after the expense's date.
 *
 * Widths 375 (a phone) and 1440. Live only (E2E_LIVE=1, a production build, a
 * real API and database: the journey harness's fixtures, README in
 * e2e/journeys); without E2E_LIVE every case is skipped. Run it in the
 * "chromium" project. The Postgres re-read uses psql against E2E_DATABASE_URL
 * (default: the runbook's local keyflowos_e2e database, only for a local API).
 */

const VIEWPORTS = [
  { name: "phone", width: 375, height: 812, mobile: true },
  { name: "desktop", width: 1440, height: 900, mobile: false },
] as const;

const ZONE = "America/Port_of_Spain";
const localDay = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;

function databaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL ?? (isLocal(API_URL) ? "postgresql://keyflow:keyflow@127.0.0.1:5432/keyflowos_e2e" : "");
  expect(url, "E2E_DATABASE_URL: the database the API under test writes (the Postgres re-read)").not.toBe("");
  return url;
}

/** One row from Postgres as JSON. Ids are checked to be plain ids before they go into the SQL. */
function pgRow<T>(sql: string, ...ids: string[]): T | null {
  for (const id of ids) expect(id, "an id fit for the re-read").toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  const out = execFileSync("psql", [databaseUrl(), "-tAX", "-c", `select row_to_json(t) from (${sql}) t`], { encoding: "utf8" }).trim();
  return out ? (JSON.parse(out.split("\n")[0]) as T) : null;
}

async function api<T = Record<string, unknown>>(request: APIRequestContext, owner: Tenant, method: "GET" | "POST", path: string, data?: unknown): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, { method, headers: { Authorization: `Bearer ${owner.token}` }, data });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 400)}`).toBe(method === "POST" ? 201 : 200);
  return (text ? JSON.parse(text) : null) as T;
}

/** Clicks a button after scrolling it into view; fails if something covers it. */
async function press(button: Locator, what: string): Promise<void> {
  await expect(button, what).toBeVisible();
  await button.scrollIntoViewIfNeeded();
  await button.click({ timeout: 10_000 });
}

async function openExpenses(page: Page): Promise<void> {
  await page.goto("/app/expenses");
  await settle(page, 1_500);
}

function sheetOf(page: Page): Locator {
  return page.getByRole("dialog").filter({ visible: true }).last();
}

for (const vp of VIEWPORTS) {
  test.describe(`EXPENSES-HUB-2 expense currency, date, bills and recurring (${vp.name} ${vp.width}x${vp.height})`, () => {
    test.use(
      vp.mobile
        ? { viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
        : { viewport: { width: vp.width, height: vp.height } },
    );
    test.use({ tenantOptions: { currency: "USD" }, timezoneId: ZONE });

    test("Add expense in USD dated today in Trinidad; Record bill saves an unpaid bill; Recurring creates its schedule (re-read on Postgres)", async ({ page, request, owner }, testInfo) => {
      test.setTimeout(5 * 60_000);
      // 21:30 in Port of Spain on the latest such evening: after midnight UTC, tomorrow in UTC terms.
      const now = Date.now();
      let at = new Date(`${localDay(new Date(now))}T21:30:00-04:00`);
      if (at.getTime() > now) at = new Date(at.getTime() - 86_400_000);
      await controlledClock(page, at, testInfo);
      const today = localDay(at);
      expect(today, "the evening is a day behind UTC").not.toBe(at.toISOString().slice(0, 10));

      await test.step(`Add expense names USD and defaults to today in Trinidad (${today})`, async () => {
        await openExpenses(page);
        await press(page.getByRole("button", { name: /^add expense$/i }).filter({ visible: true }).first(), "Add expense");
        const sheet = sheetOf(page);
        await expect(sheet, "the Add expense sheet").toBeVisible();
        await sheet.getByPlaceholder("0.00").first().fill("86.40");
        await expect.soft(sheet.getByText(/Amount \(USD\)/), "the amount is in the business currency (BUG-027)").toBeVisible();
        expect.soft(await sheet.innerText(), "nothing in the sheet says TTD").not.toMatch(/TTD/);
        expect.soft(await sheet.locator('input[type="date"]').first().inputValue(), "the default date (BUG-028: the UTC date, tomorrow)").toBe(today);
        await page.screenshot({ path: testInfo.outputPath(`expense-sheet-${vp.width}.png`), fullPage: true });
        await press(sheet.getByRole("button", { name: /^cancel$/i }).first(), "Cancel");
        await expect(sheet).toBeHidden();
      });

      await test.step("Record bill saves a bill to pay later: unpaid, with its due date, in USD (Postgres)", async () => {
        const description = `Phone bill ${stamp()}`;
        await press(page.getByRole("button", { name: /^record bill$/i }).filter({ visible: true }).first(), "Record bill (BUG-059)");
        const sheet = sheetOf(page);
        await expect(sheet.getByLabel(/bill to pay later/i), "the sheet is a bill").toBeChecked();
        await sheet.getByPlaceholder(/what was this/i).first().fill(description);
        await sheet.getByPlaceholder("0.00").first().fill("320.00");
        await sheet.getByPlaceholder(/vendor/i).first().fill(`Digicel ${stamp()}`);
        const due = localDay(new Date(at.getTime() + 10 * 86_400_000));
        await sheet.getByLabel(/due date/i).fill(due);
        const saved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/finance/businesses/${owner.businessId}/bills`);
        await press(sheet.getByRole("button", { name: /^record bill$/i }).last(), "the sheet's Record bill");
        const res = await saved;
        expect(res.status(), await res.text()).toBe(201);
        const bill = (await res.json()) as { id: string; status: string };
        expect(bill.status, "the bill door answers an unpaid bill").toBe("BILL");
        const row = pgRow<{ status: string; paid_at: string | null; due_date: string | null; currency: string; amount: number; description: string }>(
          `select status, paid_at, due_date::date::text as due_date, currency, amount, description from expenses where id = '${bill.id}' and business_id = '${owner.businessId}'`,
          bill.id,
          owner.businessId,
        );
        testInfo.annotations.push({ type: "bill row", description: JSON.stringify(row) });
        expect(row, "the bill is in Postgres").toMatchObject({ status: "BILL", paid_at: null, due_date: due, currency: "USD", amount: 320, description });
        await expect(sheet).toBeHidden();
      });

      await test.step("Add expense with Recurring (monthly) creates its schedule (Postgres)", async () => {
        const description = `Rent ${stamp()}`;
        await press(page.getByRole("button", { name: /^add expense$/i }).filter({ visible: true }).first(), "Add expense");
        const sheet = sheetOf(page);
        await sheet.getByPlaceholder(/what was this/i).first().fill(description);
        await sheet.getByPlaceholder("0.00").first().fill("4500.00");
        await sheet.getByText(/recurring expense/i).first().click();
        await sheet.locator("select").filter({ has: page.locator("option", { hasText: /^Monthly$/ }) }).first().selectOption("MONTHLY");
        const expenseSaved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/expenses/businesses/${owner.businessId}/expenses`);
        const scheduled = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/expenses/businesses/${owner.businessId}/recurring`);
        await press(sheet.getByRole("button", { name: /^add expense$/i }).last(), "the sheet's Add expense");
        const [eRes, rRes] = await Promise.all([expenseSaved, scheduled]);
        expect(eRes.status(), await eRes.text()).toBe(201);
        expect(rRes.status(), await rRes.text()).toBe(201);
        const schedule = (await rRes.json()) as { id: string };
        const [y, m, d] = today.split("-").map(Number);
        const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        const next = new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
        const row = pgRow<{ frequency: string; next_run: string; currency: string; amount: number; description: string; is_active: boolean; creates_bill: boolean }>(
          `select frequency, next_run_date::date::text as next_run, currency, amount, description, is_active, creates_bill from recurring_expenses where id = '${schedule.id}' and business_id = '${owner.businessId}' and deleted_at is null`,
          schedule.id,
          owner.businessId,
        );
        testInfo.annotations.push({ type: "recurring row", description: JSON.stringify(row) });
        expect(row, "the schedule is in Postgres (BUG-061: the expense was only tagged)").toMatchObject({
          frequency: "MONTHLY",
          next_run: next,
          currency: "USD",
          amount: 4500,
          description,
          is_active: true,
          creates_bill: false,
        });
        const list = await api<Array<{ id: string }>>(request, owner, "GET", `/expenses/businesses/${owner.businessId}/recurring`);
        expect(list.filter((r) => r.id === schedule.id), "the schedule is listed once").toHaveLength(1);
        await page.screenshot({ path: testInfo.outputPath(`expense-recurring-${vp.width}.png`), fullPage: true });
      });
    });
  });
}
