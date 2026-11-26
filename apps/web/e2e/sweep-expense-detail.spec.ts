import { execFileSync } from "node:child_process";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect, API_URL, isLocal, settle, type Tenant } from "./journeys/journey-helpers";

/**
 * EXPENSES-HUB-1, the browser half (journey H5, H6; BUG-025, BUG-031, BUG-058; owner rulings billpay D-168,
 * voidexpense D-170). The jsdom half is src/app/app/expenses/__tests__/expense-detail-truth.test.tsx and
 * bill-pay-dialog.test.tsx; the server half is apps/server/test/bill-pay-account.integration.test.ts.
 *
 * For a fresh business on a real API and database, on the expense detail page:
 *   1. Delete on a paid (posted) expense says it can't be deleted and to void it, never "Expense deleted", and
 *      stays on the expense: re-read on Postgres, the row is not deleted (BUG-031);
 *   2. the posted expense offers "Void expense", which asks first; the confirm voids it: re-read on Postgres, the
 *      row is VOID and each of its postings is reversed exactly once (D-170, BUG-058);
 *   3. a bill's Approve pays nothing at once: it opens Pay, which asks the account and the method; paying from
 *      "Bank Account" by bank transfer sends that account: re-read on Postgres, the bill is PAID by bank_transfer,
 *      posted once, and its payment credits the chart account the chosen financial account is linked to, not Cash
 *      (D-168, BUG-025).
 *
 * Widths 375 (a phone) and 1440. Live only (E2E_LIVE=1, a production build, a real API and database: the journey
 * harness's fixtures, README in e2e/journeys); without E2E_LIVE every case is skipped. Run it in the "chromium"
 * project. The Postgres re-read uses psql against E2E_DATABASE_URL (default: the runbook's local keyflowos_e2e
 * database, only for a local API).
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

/** Rows from Postgres as JSON. Ids are checked to be plain ids before they go into the SQL. */
function pgRows<T>(sql: string, ...ids: string[]): T[] {
  for (const id of ids) expect(id, "an id fit for the re-read").toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  const out = execFileSync("psql", [databaseUrl(), "-tAX", "-c", `select row_to_json(t) from (${sql}) t`], { encoding: "utf8" }).trim();
  return out ? out.split("\n").map((l) => JSON.parse(l) as T) : [];
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

async function openDetail(page: Page, id: string): Promise<void> {
  await page.goto(`/app/expenses/${id}`);
  await settle(page, 1_000);
}

function dialogOf(page: Page): Locator {
  return page.getByRole("dialog").filter({ visible: true }).last();
}

for (const vp of VIEWPORTS) {
  test.describe(`EXPENSES-HUB-1 expense detail: Delete, Void and Pay (${vp.name} ${vp.width}x${vp.height})`, () => {
    test.use(
      vp.mobile
        ? { viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
        : { viewport: { width: vp.width, height: vp.height } },
    );
    test.use({ timezoneId: ZONE });

    test("Delete on a posted expense tells the truth; Void asks, then reverses it once; Pay asks the account and method and pays from it (re-read on Postgres)", async ({ page, request, owner }, testInfo) => {
      test.setTimeout(5 * 60_000);
      const base = `/expenses/businesses/${owner.businessId}`;
      const expense = await api<{ id: string; status: string }>(request, owner, "POST", `${base}/expenses`, {
        description: `Gas cylinder ${stamp()}`,
        amount: 95,
        currency: owner.currency,
        date: localDay(new Date()),
        vendor: `Massy Gas ${stamp()}`,
        paymentMethod: "cash",
      });
      expect(expense.status, "a paid expense").toBe("PAID");
      const postings = pgRows<{ id: string }>(
        `select id from financial_transactions where business_id = '${owner.businessId}' and source_type = 'Expense' and source_id = '${expense.id}' and reversal_of_id is null`,
        owner.businessId,
        expense.id,
      );
      expect(postings.length, "the expense is posted").toBeGreaterThan(0);

      await test.step("Delete on the posted expense says it can't be deleted and to void it; nothing is deleted (BUG-031)", async () => {
        await openDetail(page, expense.id);
        await press(page.getByRole("button", { name: /^delete expense$/i }).filter({ visible: true }).first(), "Delete expense");
        const confirm = dialogOf(page);
        const answered = page.waitForResponse((r) => r.request().method() === "DELETE" && new URL(r.url()).pathname === `${base}/expenses/${expense.id}`);
        await press(confirm.getByRole("button", { name: /^delete$/i }), "the confirm's Delete");
        const res = await answered;
        expect(res.status(), "the server refuses to delete a posted expense").toBe(400);
        await expect(page.getByText(/can't be deleted/i).first(), "the page says why").toBeVisible();
        await expect(page.getByText(/^expense deleted$/i), "and never that it was deleted").toHaveCount(0);
        expect(new URL(page.url()).pathname, "still on the expense").toBe(`/app/expenses/${expense.id}`);
        const [row] = pgRows<{ deleted: boolean; status: string }>(
          `select deleted_at is not null as deleted, status from expenses where id = '${expense.id}' and business_id = '${owner.businessId}'`,
          expense.id,
          owner.businessId,
        );
        expect(row, "the expense is still there (Postgres)").toEqual({ deleted: false, status: "PAID" });
        await page.screenshot({ path: testInfo.outputPath(`expense-delete-refused-${vp.width}.png`), fullPage: true });
      });

      await test.step("Void expense asks first; the confirm voids it and reverses each posting once (D-170, Postgres)", async () => {
        await openDetail(page, expense.id);
        await press(page.getByRole("button", { name: /^void expense$/i }).filter({ visible: true }).first(), "Void expense (BUG-058)");
        const confirm = dialogOf(page);
        await expect(confirm.getByText(/void this expense\?/i), "a confirm step").toBeVisible();
        const voided = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/finance/businesses/${owner.businessId}/bills/${expense.id}/void`);
        await press(confirm.getByRole("button", { name: /^void expense$/i }), "the confirm's Void expense");
        const res = await voided;
        expect(res.status(), await res.text()).toBeLessThan(300);
        await expect(page.getByText(/^expense voided$/i).first(), "the page says it was voided").toBeVisible();
        const [row] = pgRows<{ status: string }>(`select status from expenses where id = '${expense.id}' and business_id = '${owner.businessId}'`, expense.id, owner.businessId);
        expect(row?.status, "the expense is VOID (Postgres)").toBe("VOID");
        const reversals = pgRows<{ original: string; n: number }>(
          `select o.id as original, (select count(*)::int from financial_transactions r where r.reversal_of_id = o.id) as n from financial_transactions o where o.business_id = '${owner.businessId}' and o.source_type = 'Expense' and o.source_id = '${expense.id}' and o.reversal_of_id is null`,
          owner.businessId,
          expense.id,
        );
        testInfo.annotations.push({ type: "reversals", description: JSON.stringify(reversals) });
        expect(reversals.length, "the postings").toBe(postings.length);
        expect(reversals.every((r) => r.n === 1), "each posting is reversed exactly once").toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`expense-voided-${vp.width}.png`), fullPage: true });
      });

      await test.step("a bill's Approve opens Pay, which asks the account and the method, and pays from the account chosen (D-168, Postgres)", async () => {
        const bill = await api<{ id: string; status: string }>(request, owner, "POST", `/finance/businesses/${owner.businessId}/bills`, {
          description: `Phone bill ${stamp()}`,
          amount: 320,
          date: localDay(new Date()),
          dueDate: localDay(new Date(Date.now() + 10 * 86_400_000)),
          vendor: `Digicel ${stamp()}`,
        });
        expect(bill.status, "an unpaid bill").toBe("BILL");
        const pays: string[] = [];
        page.on("request", (r) => {
          if (r.method() === "POST" && new URL(r.url()).pathname.endsWith(`/bills/${bill.id}/pay`)) pays.push(r.postData() ?? "");
        });
        await openDetail(page, bill.id);
        await press(page.getByRole("button", { name: /^approve/i }).filter({ visible: true }).first(), "the bill's Approve");
        const dialog = dialogOf(page);
        await expect(dialog.getByRole("heading", { name: /pay bill/i }), "Pay asks before paying (BUG-025)").toBeVisible();
        expect(pays, "nothing is paid before the owner chooses").toEqual([]);
        const account = dialog.getByRole("combobox", { name: /pay from/i });
        const method = dialog.getByRole("combobox", { name: /payment method/i });
        await expect(account, "the account to pay from").toBeVisible();
        await expect(method, "the payment method").toBeVisible();
        await account.selectOption({ label: (await account.locator("option", { hasText: /^Bank Account/ }).first().innerText()).trim() });
        await method.selectOption("bank_transfer");
        const chosen = await account.inputValue();
        await page.screenshot({ path: testInfo.outputPath(`bill-pay-dialog-${vp.width}.png`), fullPage: true });
        const paid = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith(`/bills/${bill.id}/pay`));
        await press(dialog.getByRole("button", { name: /^pay/i }).last(), "Pay");
        const res = await paid;
        expect(res.status(), await res.text()).toBeLessThan(300);
        expect(pays.map((b) => JSON.parse(b)), "the account and method chosen are sent, once").toEqual([{ paymentAccountId: chosen, paymentMethod: "bank_transfer" }]);
        await expect(dialog).toBeHidden();

        const [row] = pgRows<{ status: string; payment_method: string | null }>(
          `select status, payment_method from expenses where id = '${bill.id}' and business_id = '${owner.businessId}'`,
          bill.id,
          owner.businessId,
        );
        expect(row, "the bill is paid by bank transfer (Postgres)").toEqual({ status: "PAID", payment_method: "bank_transfer" });
        const credits = pgRows<{ account_id: string; credit: number; txns: number }>(
          `select le.account_id, le.credit::float as credit, (select count(*)::int from financial_transactions x where x.business_id = '${owner.businessId}' and x.source_id = '${bill.id}' and x.external_ref like '%:bill_paid') as txns from ledger_entries le join financial_transactions t on t.id = le.transaction_id where t.business_id = '${owner.businessId}' and t.source_type = 'Expense' and t.source_id = '${bill.id}' and t.external_ref like '%:bill_paid' and le.credit > 0`,
          owner.businessId,
          bill.id,
        );
        const [linked] = pgRows<{ chart_of_account_id: string }>(
          `select chart_of_account_id from financial_accounts where id = '${chosen}' and business_id = '${owner.businessId}'`,
          chosen,
          owner.businessId,
        );
        testInfo.annotations.push({ type: "bill payment credits", description: JSON.stringify({ credits, linked }) });
        expect(credits, "the payment posts once and credits the chosen account's chart row, not Cash").toEqual([
          { account_id: linked.chart_of_account_id, credit: 320, txns: 1 },
        ]);
      });
    });
  });
}
