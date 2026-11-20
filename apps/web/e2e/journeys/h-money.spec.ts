import {
  test,
  expect,
  API_URL,
  anonymousContext,
  controlledClock,
  coveredButtonFindings,
  settle,
  signedInContext,
  type Tenant,
} from "./journey-helpers";
import { accountantExportAnswer, amountAfter } from "./journey-text";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

/**
 * GATE-JOURNEYS-G-L, journey H: know my money (product audit core_journeys_v1
 * H; KF-JOURNEY-007, 015, 019; D-57, D-67, D-107, D-135; rulings billpay D-168,
 * voidexpense D-170). Each bullet of H's definition of done is a test (H1..H10),
 * on both journey projects, in every variant (README.md in this folder).
 *
 * Overview and Money in
 *   H1  Money > Overview shows cash, owed to you, you owe, this month's profit
 *       and safe-to-spend; each figure comes from the ledger and equals Reports
 *       (the balance sheet, the P&L) and the safe-to-spend read.
 *   H2  The cash forecast on Money > Overview opens on the ledger's cash, the
 *       same cash the balance sheet holds ("each figure comes from the ledger";
 *       BUG-022: it opens on FinancialAccount.currentBalance, 0).
 *   H3  Money in lists payments by method, refunds and pending bank-transfer claims.
 * Expenses and bills
 *   H4  Add an expense with a category from a list; the date defaults to today in
 *       Trinidad (the phone's clock at 21:30 in Port of Spain, after midnight UTC);
 *       the receipt control takes a photo (an image input, the camera on a phone).
 *   H4b The receipt photo uploads and shows on another device (@staging: object
 *       storage is a provider the CI stack does not have).
 *   H5  Record a bill (pay later), then pay it, choosing the account and method
 *       (billpay ruling D-168: the app always asks).
 *   H6  Void a posted expense, with a confirm step (voidexpense ruling D-170):
 *       the void answers the expense VOID and its posting nets to 0. (A voided
 *       expense is soft-deleted, so GET .../expenses/:id no longer answers it:
 *       the void's own answer and the ledger are the reads.)
 *   H7a Marking an expense recurring creates its schedule.
 *   H7b Scheduler run: the recurring expense generates on schedule (@scheduler).
 * Reports
 *   H8  Report tabs switch without crashing (P&L, cash flow, balance sheet, ...).
 *   H9  'Send to my accountant' produces the export ZIP and sends it: the button
 *       asks for the accountant's email and the ZIP for the period is produced
 *       (CI: GET .../accountant-export.zip?start&end). On the CI stack there is
 *       no mail sender, so the email route answers its documented 400 'Email
 *       sender is not configured' and the screen must say the email was not
 *       sent; where the email is sent, the address is kept (saveRecipient), so
 *       it is asked once. The email arriving, and the address kept, are H9b
 *       (@staging).
 * H10 No invented figures anywhere on the Money screens.
 *
 * Doors (the packets that turn these green build to them): Money is /app/money,
 * an index whose entries are Overview (/app/financial-flow), Money in
 * (/app/payments), Expenses & bills (/app/expenses), Reports (/app/reports) and
 * Books (/app/finance) (NAV-A2). Each test opens Money and takes its entry; when
 * Money offers no such entry, or the entry opens another page, the test says so
 * (soft) and opens the entry's page directly, so the rest of the bullet is still
 * read. (BUG-114, /app/money as an error page, does not reproduce at this base:
 * /app/money redirects to Financial Flow, which has no such entries.) A test
 * never presses Escape on a page two levels down: the app's Escape opens the
 * level above (use-keyboard-shortcuts.ts). Expenses & bills has "Add expense"
 * (a sheet: description, amount, date, category, receipt, recurring) and a way
 * to record a bill to pay later; a bill offers Pay (asking the account and
 * method); a posted expense offers "Void expense". Reports has "Send to my
 * accountant".
 *
 * The figures are seeded through the API, as the screens before them would make
 * them: an invoice of 1,000 sent, with 500 paid in cash (owed to you 500), an
 * expense of 150 paid in cash (cash 350), and a bill of 250 to pay later (you
 * owe 250). The expected figures are read from the ledger reports, not
 * computed here.
 *
 * RED at the GATE-JOURNEYS-A-F head (e63bcb1a), observed on both projects in
 * the ai-disabled and key-disabled variants (the packet return holds the
 * report): H1 Money is not the index NAV-A2 names (/app/money lands on
 * /app/financial-flow, which offers no Overview entry), and the Overview shows
 * no 'Owed to you' and no 'You owe' (its cash, profit and safe-to-spend equal
 * the books); H2 the 90-day forecast opens on 0 against the ledger's 350
 * (BUG-022, the headline); H3 /app/payments lists none of the payments, the
 * refund or the bank-transfer claim (Money's 'Money in' card, where it shows,
 * opens /app/commerce); H4 the date defaults to tomorrow (BUG-028), the
 * sheet's Add expense cannot be pressed on desktop (covered) and is an
 * unnamed icon at 375px; H5 there is no way to record a bill (BUG-059); H6 a
 * posted expense offers Delete, not Void (BUG-058); H7a stops at Add expense,
 * as H4 does; H8 Reports crashes on 'Books · Cashflow' and 'Tax Summary'
 * (BUG-039); H9 'Send to my accountant' asks for no email; H10 Expenses &
 * bills shows '0% of monthly budget' with no budget set, 'categoryies', and
 * (desktop) 'May 2026' in November. H4b, H7b and H9b are @staging or
 * @scheduler legs and do not run here.
 */

const auth = (t: Tenant) => ({ Authorization: `Bearer ${t.token}` });

async function api<T = Record<string, unknown>>(
  request: APIRequestContext,
  owner: Tenant,
  method: "GET" | "POST" | "PATCH",
  path: string,
  data?: unknown,
  expected?: number,
): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, { method, headers: auth(owner), data });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 400)}`).toBe(expected ?? (method === "POST" ? 201 : 200));
  return (text ? JSON.parse(text) : null) as T;
}

function rowsOf<T = Record<string, unknown>>(body: unknown, ...keys: string[]): T[] {
  if (Array.isArray(body)) return body as T[];
  const b = body as Record<string, unknown>;
  for (const k of [...keys, "data", "items", "results", "expenses"]) if (Array.isArray(b?.[k])) return b[k] as T[];
  return [];
}

const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;
const ZONE = "America/Port_of_Spain";
const localDay = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
const firstOfMonth = () => `${localDay(new Date()).slice(0, 8)}01`;

async function seedCustomer(request: APIRequestContext, owner: Tenant, first = "Maria") {
  const last = `Money${stamp()}`;
  const c = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts`, { firstName: first, lastName: last, email: `${last.toLowerCase()}@v62j.test.local` });
  return { id: c.id, name: `${first} ${last}` };
}

async function seedSentInvoice(request: APIRequestContext, owner: Tenant, contactId: string, total: number, description = "Catering") {
  const inv = await api<{ id: string; invoiceNumber: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices`, {
    contactId,
    currency: owner.currency,
    items: [{ description, quantity: 1, unitPrice: total }],
  });
  await api(request, owner, "PATCH", `/commerce/invoices/${inv.id}/status/sent`, { businessId: owner.businessId, status: "SENT" });
  return inv;
}

async function recordPayment(request: APIRequestContext, owner: Tenant, invoiceId: string, amount: number, method: string) {
  return api<{ id?: string; payment?: { id: string } }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices/${invoiceId}/payments`, {
    amount,
    method,
    idempotencyKey: `${invoiceId}-${method}-${amount}`,
  });
}

async function seedExpense(request: APIRequestContext, owner: Tenant, amount: number, description: string, extra: Record<string, unknown> = {}) {
  return api<{ id: string; status: string }>(request, owner, "POST", `/expenses/businesses/${owner.businessId}/expenses`, {
    description,
    amount,
    currency: owner.currency,
    date: localDay(new Date()),
    vendor: "Massy Stores",
    paymentMethod: "CASH",
    ...extra,
  });
}

async function seedBill(request: APIRequestContext, owner: Tenant, amount: number, description: string) {
  return api<{ id: string; status: string }>(request, owner, "POST", `/finance/businesses/${owner.businessId}/bills`, {
    description,
    amount,
    currency: owner.currency,
    date: localDay(new Date()),
    dueDate: localDay(new Date(Date.now() + 14 * 86_400_000)),
    vendor: "T&TEC",
  });
}

/** The books of the seeded month: an invoice of 1,000 with 500 paid in cash, an expense of 150 in cash, a bill of 250 to pay later. */
async function seedMonth(request: APIRequestContext, owner: Tenant) {
  const customer = await seedCustomer(request, owner);
  const invoice = await seedSentInvoice(request, owner, customer.id, 1000);
  await recordPayment(request, owner, invoice.id, 500, "Cash");
  await seedExpense(request, owner, 150, `Packaging ${stamp()}`);
  await seedBill(request, owner, 250, `Electricity ${stamp()}`);
  return { customer, invoice };
}

/**
 * What the books say, read from Reports' own reads: the balance sheet (cash and
 * bank, payables), the A/R aging (what customers owe: on the cash basis no
 * receivable is posted, so the aging reads the open invoices), this month's
 * P&L, and the safe-to-spend read.
 */
async function ledgerFigures(request: APIRequestContext, owner: Tenant) {
  const sheet = await api<{ assets: { cashAndBank: number }; liabilities: { accountsPayable: number } }>(
    request,
    owner,
    "GET",
    `/businesses/${owner.businessId}/reports/balance-sheet`,
  );
  const aging = await api<{ totalOutstanding: number }>(request, owner, "GET", `/finance/businesses/${owner.businessId}/receivables/aging`);
  const pnl = await api<{ netProfit: number }>(request, owner, "GET", `/businesses/${owner.businessId}/reports/pnl?from=${firstOfMonth()}&to=${localDay(new Date(Date.now() + 86_400_000))}`);
  const safe = await api<{ safeToSpend: number }>(request, owner, "GET", `/finance/businesses/${owner.businessId}/safe-to-spend`);
  return {
    cash: Number(sheet.assets.cashAndBank),
    owedToYou: Number(aging.totalOutstanding),
    youOwe: Number(sheet.liabilities.accountsPayable),
    profit: Number(pnl.netProfit),
    safeToSpend: Number(safe.safeToSpend),
  };
}

/** Money's entries (NAV-A2): each named so (a card may add a line under the name), and the page it opens. */
const MONEY_ENTRIES = {
  Overview: { name: /^overview\b/i, path: "/app/financial-flow", lands: /\/app\/(financial-flow|money)(\/overview)?$/ },
  "Money in": { name: /^money in\b/i, path: "/app/payments", lands: /\/app\/(payments|money\/(money-in|payments))$/ },
  "Expenses & bills": { name: /^expenses\b/i, path: "/app/expenses", lands: /\/app\/(money\/)?expenses$/ },
  Reports: { name: /^reports\b/i, path: "/app/reports", lands: /\/app\/(money\/)?reports$/ },
} as const;

/**
 * Money > <entry>: opens Money (/app/money) and takes its entry. When Money
 * offers no such entry the test records it (soft) and opens the entry's page
 * directly, so the rest of the bullet is still read.
 */
async function openMoney(page: Page, entry: keyof typeof MONEY_ENTRIES): Promise<void> {
  const { name, path, lands } = MONEY_ENTRIES[entry];
  await page.goto("/app/money");
  await settle(page, 1_000);
  const main = page.locator("main").first();
  const door = main.getByRole("link", { name }).or(main.getByRole("tab", { name })).or(main.getByRole("button", { name })).filter({ visible: true });
  const offered = await door.count();
  expect.soft(offered, `Money offers '${entry}' (NAV-A2: Money is an index of Overview, Money in, Expenses & bills, Reports and Books; /app/money lands on ${new URL(page.url()).pathname})`).toBeGreaterThan(0);
  let how = "opened directly";
  if (offered) {
    await door.first().click();
    await page.waitForURL((u) => lands.test(u.pathname), { timeout: 15_000 }).catch(() => {});
    const at = new URL(page.url()).pathname;
    expect.soft(lands.test(at), `Money's '${entry}' opens ${entry} (it opened ${at})`).toBe(true);
    how = `taken from Money (${at})`;
  }
  if (!lands.test(new URL(page.url()).pathname)) await page.goto(path);
  await page.waitForURL((u) => lands.test(u.pathname), { timeout: 30_000 }).catch(() => {});
  await settle(page, 1_500);
  if (!lands.test(new URL(page.url()).pathname)) {
    // A redirect still running from Money's own page took the browser elsewhere: open the entry again.
    await page.goto(path);
    await settle(page, 1_500);
  }
  // No Escape here: on a page two levels down the app's Escape goes up a level (use-keyboard-shortcuts.ts).
  test.info().annotations.push({ type: "money-door", description: `${entry}: ${how}, read at ${new URL(page.url()).pathname}` });
}

/** The main region's text, whitespace folded. */
async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").first().innerText()).replace(/\s+/g, " ");
}

/** Presses a primary button, failing with what covers it when something does. */
async function press(button: Locator, what: string): Promise<void> {
  await expect(button, what).toBeVisible();
  expect(await coveredButtonFindings([{ what, locator: button }]), `${what} can be pressed`).toEqual([]);
  await button.click();
}

/** A form control by its label: an associated label, else the first control after a label naming it. */
function field(scope: Locator, label: RegExp): Locator {
  return scope
    .getByLabel(label)
    .or(scope.locator("label", { hasText: label }).locator("xpath=following::*[self::input or self::select or self::textarea][1]"))
    .filter({ visible: true })
    .first();
}

/** Expenses & bills > Add expense: the sheet it opens. */
async function openAddExpense(page: Page): Promise<Locator> {
  await openMoney(page, "Expenses & bills");
  await press(page.getByRole("button", { name: /^(\+ ?)?(add|new) expense$/i }).filter({ visible: true }).first(), "Add expense");
  const sheet = page.getByRole("dialog").filter({ visible: true }).last();
  await expect(sheet, "the Add expense sheet").toBeVisible();
  return sheet;
}

test.describe("journey H: know my money", () => {
  test.use({ timezoneId: ZONE });

  test("H1 Money > Overview shows cash, owed to you, you owe, this month's profit and safe-to-spend, each equal to the ledger", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    await seedMonth(request, owner);
    const ledger = await ledgerFigures(request, owner);
    test.info().annotations.push({ type: "ledger", description: JSON.stringify(ledger) });
    // The seeds, as the books hold them: 500 in less 150 out; 1,000 invoiced less 500 paid; the 250 bill.
    expect({ cash: ledger.cash, owedToYou: ledger.owedToYou, youOwe: ledger.youOwe }, "the books hold the seeded month").toEqual({ cash: 350, owedToYou: 500, youOwe: 250 });

    await openMoney(page, "Overview");
    // The figures load after the page: read once the cash figure is shown (or 15 s have passed).
    await expect
      .poll(async () => amountAfter(await mainText(page), /\bcash(?: balance| on hand)?\b/i), { timeout: 15_000 })
      .not.toBeNull()
      .catch(() => {});
    await page.waitForTimeout(1_500);
    const text = await mainText(page);
    test.info().annotations.push({ type: "overview", description: text.slice(0, 1500) });
    const shown = {
      // Labels without capturing groups: amountAfter numbers its own.
      cash: amountAfter(text, /\bcash(?: balance| on hand)?\b/i),
      owedToYou: amountAfter(text, /owed to you|money owed|receivable/i),
      youOwe: amountAfter(text, /you owe|bills (?:due|to pay)|payable/i),
      profit: amountAfter(text, /(?:this month'?s )?(?:net )?profit/i),
      safeToSpend: amountAfter(text, /safe.to.spend/i),
    };
    test.info().annotations.push({ type: "shown", description: JSON.stringify(shown) });
    expect.soft(shown.cash, "Cash, as the balance sheet's cash and bank").toBe(ledger.cash);
    expect.soft(shown.owedToYou, "Owed to you, as the A/R aging").toBe(ledger.owedToYou);
    expect.soft(shown.youOwe, "You owe, as the balance sheet's payables").toBe(ledger.youOwe);
    expect.soft(shown.profit, "This month's profit, as the P&L").toBe(ledger.profit);
    expect.soft(shown.safeToSpend, "Safe to spend, as the safe-to-spend read").toBe(ledger.safeToSpend);
  });

  test("H2 the cash forecast on Money > Overview opens on the ledger's cash", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    await seedMonth(request, owner);
    const ledger = await ledgerFigures(request, owner);

    await test.step("the forecast opens on the cash the balance sheet holds", async () => {
      const forecast = await api<{ openingCash: number; currency?: string }>(request, owner, "GET", `/finance/businesses/${owner.businessId}/cashflow-forecast?days=90`);
      test.info().annotations.push({ type: "forecast", description: `openingCash ${forecast.openingCash}; ledger cash ${ledger.cash}` });
      expect(Number(forecast.openingCash), "the 90-day forecast's opening cash (BUG-022: 0, from FinancialAccount.currentBalance)").toBe(ledger.cash);
    });

    await test.step("Money > Overview shows the forecast", async () => {
      await openMoney(page, "Overview");
      await expect(page.locator("main").getByText(/forecast/i).first(), "the cash forecast on Money > Overview").toBeVisible();
    });
  });

  test("H3 Money in lists payments by method, refunds and pending bank-transfer claims", async ({ page, request, owner, browser }) => {
    test.setTimeout(6 * 60_000);
    const customer = await seedCustomer(request, owner, "Rena");
    const cash = await seedSentInvoice(request, owner, customer.id, 400, "Cake order");
    await recordPayment(request, owner, cash.id, 400, "Cash");
    const bank = await seedSentInvoice(request, owner, customer.id, 275, "Pastry tray");
    await recordPayment(request, owner, bank.id, 275, "Bank Transfer");
    const refunded = await seedSentInvoice(request, owner, customer.id, 130, "Cupcakes");
    await recordPayment(request, owner, refunded.id, 130, "Cash");
    const payments = rowsOf<{ id: string; amount: number }>(await api(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${refunded.id}/payments`), "payments");
    await api(request, owner, "POST", `/commerce/businesses/${owner.businessId}/payments/${payments[0].id}/refund`, { reason: "Order cancelled" });
    const claimed = await seedSentInvoice(request, owner, customer.id, 450, "Wedding cake");

    await test.step("the customer says they paid 450 by bank transfer (a pending claim)", async () => {
      const link = await api<{ token: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices/${claimed.id}/payment-link`, {});
      const visitor = await anonymousContext(browser, { who: "customer" });
      const res = await visitor.request.post(`${API_URL}/commerce/public/invoice-link/${link.token}/payment-intent`, { data: { method: "bank_transfer" } });
      expect(res.status(), await res.text()).toBeLessThan(300);
    });

    await openMoney(page, "Money in");
    // Money in may split its list over tabs: read every tab it offers.
    let text = await mainText(page);
    const tabs = page.locator("main").first().getByRole("tab").filter({ visible: true });
    for (let i = 0; i < (await tabs.count()); i++) {
      await tabs.nth(i).click();
      await settle(page, 800);
      text += ` ${await mainText(page)}`;
    }
    test.info().annotations.push({ type: "money-in", description: text.slice(0, 1500) });
    await test.step("the payments, each with its method", async () => {
      expect.soft(text, "the 400.00 cash payment").toMatch(/400\.00/);
      expect.soft(text, "a payment's method: cash").toMatch(/\bcash\b/i);
      expect.soft(text, "the 275.00 bank-transfer payment").toMatch(/275\.00/);
      expect.soft(text, "a payment's method: bank transfer").toMatch(/bank transfer/i);
    });
    await test.step("the refund", async () => {
      expect.soft(text, "the 130.00 refund").toMatch(/refund[^.]{0,80}130\.00|130\.00[^.]{0,80}refund/i);
    });
    await test.step("the pending bank-transfer claim", async () => {
      expect.soft(text, "the 450.00 claim waiting for confirmation").toMatch(/(pending|claim|waiting|to confirm)[^]{0,120}450\.00|450\.00[^]{0,120}(pending|claim|waiting|to confirm)/i);
    });
  });

  test("H4 add an expense: a category from a list, the date today in Trinidad, a receipt photo from the camera", async ({ page, request, owner }, testInfo) => {
    test.setTimeout(5 * 60_000);
    const category = await api<{ id: string; name: string }>(request, owner, "POST", `/expenses/businesses/${owner.businessId}/expense-categories`, { name: `Supplies ${stamp()}` });
    // The phone's clock at 21:30 in Port of Spain on the latest such evening: after midnight UTC, the day before in UTC terms.
    const now = Date.now();
    let at = new Date(`${localDay(new Date(now))}T21:30:00-04:00`);
    if (at.getTime() > now) at = new Date(at.getTime() - 86_400_000);
    await controlledClock(page, at, testInfo);
    const today = localDay(at);

    const sheet = await openAddExpense(page);
    const description = `Flour ${stamp()}`;

    await test.step(`the date defaults to today in Trinidad (${today})`, async () => {
      const date = sheet.locator('input[type="date"]').first();
      await expect(date, "the expense's date field").toBeVisible();
      expect.soft(await date.inputValue(), "the default date (BUG-028: the UTC date, tomorrow)").toBe(today);
      await date.fill(today);
    });

    await test.step("the category is chosen from a list that holds the business's categories", async () => {
      const select = sheet.locator("select").filter({ has: page.locator(`option`, { hasText: category.name }) });
      const combo = sheet.getByRole("combobox", { name: /category/i });
      if (await select.count()) await select.first().selectOption({ label: category.name });
      else {
        await expect(combo.first(), `a category list offering '${category.name}' (BUG-060)`).toBeVisible();
        await combo.first().click();
        await page.getByRole("option", { name: category.name }).first().click();
      }
    });

    await test.step("the receipt control takes a photo (an image input; the camera on a phone)", async () => {
      const upload = sheet.locator('input[type="file"]');
      expect(await upload.count(), "a receipt control").toBeGreaterThan(0);
      const accept = (await upload.first().getAttribute("accept")) ?? "";
      expect.soft(accept, "the receipt takes images").toMatch(/image/);
      if (testInfo.project.name === "phone") {
        const capture = await upload.evaluateAll((els) => els.map((e) => e.getAttribute("capture")).filter((c) => c !== null));
        expect.soft(capture.length, "on a phone the receipt opens the camera (capture)").toBeGreaterThan(0);
      }
    });

    await test.step("the expense saves with its category and date", async () => {
      await sheet.getByPlaceholder(/what was this expense for|description/i).first().fill(description);
      await sheet.getByPlaceholder(/0\.00/).first().fill("86.40");
      const saved = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/expenses/businesses/${owner.businessId}/expenses`);
      await press(sheet.getByRole("button", { name: /^(add|save|create)( expense)?$/i }).filter({ visible: true }).last(), "the sheet's Add expense");
      const res = await saved;
      expect(res.status(), await res.text()).toBe(201);
      const stored = (await res.json()) as { categoryId?: string | null; date?: string };
      expect.soft(stored.categoryId, "the stored category").toBe(category.id);
      expect.soft(String(stored.date ?? "").slice(0, 10), "the stored date").toBe(today);
    });
  });

  test("H4b the receipt photo uploads and shows on another device", { tag: "@staging" }, async ({ page, request, owner, browser }) => {
    // GATE-STAGING-RUN: object storage (S3_BUCKET and its keys) is a provider the CI stack does not have.
    test.setTimeout(5 * 60_000);
    const sheet = await openAddExpense(page);
    const description = `Receipt ${stamp()}`;
    await sheet.getByPlaceholder(/what was this expense for|description/i).first().fill(description);
    await sheet.getByPlaceholder(/0\.00/).first().fill("42.00");
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c63f8cfc0f01f0005000201ffa165b10000000049454e44ae426082", "hex");
    await sheet.locator('input[type="file"]').first().setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText(/receipt uploaded/i).first()).toBeVisible();
    await press(sheet.getByRole("button", { name: /^(add|save|create)( expense)?$/i }).filter({ visible: true }).last(), "the sheet's Add expense");
    const list = rowsOf<{ description: string; receiptUrl?: string | null }>(await api(request, owner, "GET", `/expenses/businesses/${owner.businessId}/expenses`), "expenses");
    const stored = list.find((e) => e.description === description)?.receiptUrl ?? "";
    expect(stored, "the receipt is stored on the server").toMatch(/^(https?:|\/objects\/)/);
    const second = await signedInContext(browser, owner, { who: "owner, second device" });
    const other = await second.newPage();
    await other.goto("/app/expenses");
    await other.getByText(description).first().click();
    await expect(other.locator("img[src*='objects'], img[alt*='receipt' i]").first(), "the receipt on another device").toBeVisible();
  });

  test("H5 record a bill to pay later, then pay it choosing the account and the method", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    const vendor = `Digicel ${stamp()}`;
    let billId = "";

    await test.step("Expenses & bills records a bill to pay later (a due date, not paid)", async () => {
      await openMoney(page, "Expenses & bills");
      const door = page.getByRole("button", { name: /(record|add|new) (a )?bill|pay later/i }).or(page.getByRole("tab", { name: /^bills/i })).filter({ visible: true });
      await expect(door.first(), "a way to record a bill to pay later (BUG-059)").toBeVisible();
      await door.first().click();
      const sheet = page.getByRole("dialog").filter({ visible: true }).last();
      await sheet.getByPlaceholder(/what|description/i).first().fill(`Phone bill ${stamp()}`);
      await sheet.getByPlaceholder(/0\.00/).first().fill("320.00");
      await sheet.getByPlaceholder(/vendor/i).first().fill(vendor);
      const due = field(sheet, /due/i);
      await due.fill(localDay(new Date(Date.now() + 10 * 86_400_000)));
      const saved = page.waitForResponse((r) => r.request().method() === "POST" && /\/(bills|expenses)$/.test(new URL(r.url()).pathname));
      await press(sheet.getByRole("button", { name: /^(add|save|create|record)( bill)?$/i }).filter({ visible: true }).last(), "the bill sheet's save");
      const res = await saved;
      expect(res.status(), await res.text()).toBe(201);
      const bill = (await res.json()) as { id: string; status: string };
      expect(bill.status, "a bill is saved unpaid").toBe("BILL");
      billId = bill.id;
    });

    await test.step("Pay asks for the account and the method, and pays from the account chosen", async () => {
      await page.goto(`/app/expenses/${billId}`);
      await settle(page, 1_000);
      await press(page.getByRole("button", { name: /^(pay|pay bill|mark (as )?paid|approve)/i }).filter({ visible: true }).first(), "the bill's Pay");
      const dialog = page.getByRole("dialog").filter({ visible: true }).last();
      await expect(dialog, "Pay asks before paying (BUG-025: Approve pays from Cash at once)").toBeVisible();
      const account = dialog.getByRole("combobox", { name: /account|pay from/i }).or(dialog.locator("select").filter({ hasText: /bank|cash/i })).first();
      await expect(account, "the account to pay from").toBeVisible();
      const method = dialog.getByRole("combobox", { name: /method/i }).or(dialog.locator("select").filter({ hasText: /transfer|cheque|card/i })).first();
      await expect(method, "the payment method").toBeVisible();
      if ((await account.evaluate((e) => e.tagName)) === "SELECT") await account.selectOption({ label: (await account.locator("option", { hasText: /bank/i }).first().innerText()).trim() });
      if ((await method.evaluate((e) => e.tagName)) === "SELECT") await method.selectOption({ label: (await method.locator("option", { hasText: /transfer/i }).first().innerText()).trim() });
      const paid = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith(`/bills/${billId}/pay`));
      await dialog.getByRole("button", { name: /^(pay|confirm|record payment)/i }).last().click();
      const res = await paid;
      expect(res.status(), await res.text()).toBeLessThan(300);
      const gl = await api<{ rows: Array<{ accountType: string; accountName: string; credit: string | number; sourceId: string | null }> }>(request, owner, "GET", `/finance/businesses/${owner.businessId}/general-ledger?pageSize=500`);
      const credited = gl.rows.filter((r) => r.sourceId === billId && Number(r.credit) > 0 && r.accountType === "ASSET").map((r) => r.accountName);
      expect.soft(credited, "the payment comes out of the bank account chosen, not Cash").toEqual([expect.stringMatching(/bank/i)]);
    });
  });

  test("H6 void a posted expense, with a confirm step", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    const expense = await seedExpense(request, owner, 95, `Gas cylinder ${stamp()}`);
    await page.goto(`/app/expenses/${expense.id}`);
    await settle(page, 1_000);
    const action = page.getByRole("button", { name: /^void( expense)?$/i }).filter({ visible: true });
    await expect(action.first(), `the posted expense offers Void (BUG-058; offers: ${JSON.stringify(await page.locator("main button").filter({ visible: true }).allInnerTexts())})`).toBeVisible();
    await press(action.first(), "Void expense");
    const confirm = page.getByRole("dialog").getByRole("button", { name: /^(void|confirm|yes)/i }).filter({ visible: true });
    await expect(confirm.first(), "a confirm step").toBeVisible();
    const voided = page.waitForResponse((r) => r.request().method() === "POST" && /\/void$/.test(new URL(r.url()).pathname));
    await confirm.first().click();
    const voidRes = await voided;
    expect(voidRes.status(), `the void: ${new URL(voidRes.url()).pathname}`).toBeLessThan(300);
    // A voided expense is soft-deleted (voidExpense sets deletedAt; getExpense reads deletedAt null), so the
    // void's own answer says it is VOID, and the ledger says the posting is reversed.
    const voidBody = (await voidRes.json().catch(() => ({}))) as { id?: string; status?: string };
    expect.soft(voidBody.id, "the void answers this expense").toBe(expense.id);
    expect(voidBody.status, "the void answers the expense as VOID").toBe("VOID");
    const gl = await api<{ rows: Array<{ accountType: string; debit: string | number; credit: string | number; sourceId: string | null }> }>(request, owner, "GET", `/finance/businesses/${owner.businessId}/general-ledger?pageSize=500`);
    const net = gl.rows.filter((r) => r.sourceId === expense.id && r.accountType === "EXPENSE").reduce((s, r) => s + Number(r.debit) - Number(r.credit), 0);
    expect(net, "the posting is reversed: the expense nets to 0").toBe(0);
  });

  test("H7a marking an expense recurring creates its schedule", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    const sheet = await openAddExpense(page);
    const description = `Rent ${stamp()}`;
    await sheet.getByPlaceholder(/what was this expense for|description/i).first().fill(description);
    await sheet.getByPlaceholder(/0\.00/).first().fill("4500.00");
    await sheet.getByText(/recurring/i).first().click();
    const frequency = sheet.locator("select").filter({ has: page.locator("option", { hasText: /monthly/i }) });
    if (await frequency.count()) await frequency.first().selectOption({ label: (await frequency.first().locator("option", { hasText: /monthly/i }).first().innerText()).trim() });
    await press(sheet.getByRole("button", { name: /^(add|save|create)( expense)?$/i }).filter({ visible: true }).last(), "the sheet's Add expense");
    await expect
      .poll(async () => rowsOf<{ description?: string; vendor?: string; amount?: number }>(await api(request, owner, "GET", `/expenses/businesses/${owner.businessId}/recurring`), "recurring").filter((r) => (r.description ?? "").includes(description)).length, {
        message: "a monthly recurring schedule for the rent (BUG-061: the expense is only tagged)",
        timeout: 15_000,
      })
      .toBe(1);
  });

  test("H7b scheduler run: a recurring expense generates on schedule", { tag: "@scheduler" }, async ({ request, owner }) => {
    // GATE-SCHEDULER-RUN: the recurring-expense job runs with the schedulers on and the run's server clock.
    test.setTimeout(15 * 60_000);
    const description = `Rent ${stamp()}`;
    await api(request, owner, "POST", `/expenses/businesses/${owner.businessId}/recurring`, {
      name: description,
      description,
      amount: 4500,
      currency: owner.currency,
      frequency: "MONTHLY",
      startDate: localDay(new Date()),
      nextRunDate: localDay(new Date()),
      vendor: "Landlord",
    });
    await expect
      .poll(async () => rowsOf<{ description: string }>(await api(request, owner, "GET", `/expenses/businesses/${owner.businessId}/expenses`), "expenses").filter((e) => e.description.includes(description)).length, {
        message: "the scheduled run writes the month's rent",
        timeout: 10 * 60_000,
        intervals: [15_000],
      })
      .toBeGreaterThan(0);
  });

  test("H8 report tabs switch without crashing", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    await seedMonth(request, owner);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openMoney(page, "Reports");
    const main = page.locator("main").first();
    const crashed = () => main.getByText(/something went wrong|went wrong loading/i);
    const tabNames = /^(p&l|profit|pnl|profit (&|and) loss|cash ?flow|balance sheet|tax|receivables|payables|aging|books)/i;
    const tabs = main.getByRole("tab", { name: tabNames }).or(main.getByRole("button", { name: tabNames })).filter({ visible: true });
    await expect(tabs.first(), "Reports shows its report tabs").toBeVisible();
    const names = (await tabs.allInnerTexts()).map((t) => t.trim());
    expect(names.length, `Reports offers its tabs (found ${JSON.stringify(names)})`).toBeGreaterThan(1);
    const visited: string[] = [];
    // Twice through, so each tab is opened after another one (BUG-039: switching tabs crashes).
    for (const round of [1, 2]) {
      for (const name of names) {
        await main.getByRole("tab", { name, exact: true }).or(main.getByRole("button", { name, exact: true })).filter({ visible: true }).first().click();
        await page.waitForTimeout(1_200);
        visited.push(`${round}:${name}`);
        expect.soft(await crashed().count(), `Reports after opening '${name}' (round ${round}; opened: ${visited.join(" > ")})`).toBe(0);
        if (await crashed().count()) {
          await page.reload();
          await settle(page, 1_000);
        }
      }
    }
    expect.soft(errors.filter((e) => /TypeError|Cannot read/i.test(e)), "page errors while switching report tabs").toEqual([]);
  });

  test("H9 'Send to my accountant' asks for the accountant's email and produces the export ZIP", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    await seedMonth(request, owner);
    const accountant = `accountant.${stamp()}@v62j.test.local`;
    await openMoney(page, "Reports");
    const send = page.getByRole("button", { name: /send to (my )?accountant/i }).filter({ visible: true });
    await expect(send.first(), "Reports offers 'Send to my accountant'").toBeVisible();
    await press(send.first(), "Send to my accountant");
    const dialog = page.getByRole("dialog").filter({ visible: true }).last();
    const email = dialog.getByLabel(/email/i).or(dialog.locator('input[type="email"]')).first();
    await expect(email, "it asks for the accountant's email").toBeVisible();
    await email.fill(accountant);
    const exported = page.waitForResponse((r) => /accountant-export/.test(new URL(r.url()).pathname) && r.request().method() !== "OPTIONS", { timeout: 60_000 });
    await dialog.getByRole("button", { name: /^(send|export|email)/i }).last().click();
    const res = await exported;
    const path = new URL(res.url()).pathname;
    const text = await res.text().catch(() => "");
    const answer = accountantExportAnswer(path, res.status(), text);
    test.info().annotations.push({ type: "export", description: `${res.status()} ${res.request().method()} ${path}: ${answer} ${text.slice(0, 200)}` });
    // The CI stack has no mail sender: the email route answers its documented 400 'Email sender is not
    // configured' (no-mail-sender). A sent email, or a produced ZIP, is the other right answer; a missing period
    // or a server error is not.
    expect(answer, `the export's answer: ${res.status()} ${path} ${text.slice(0, 200)}`).not.toBe("wrong");

    // The period the button asked for (the request's periodStart/periodEnd, or start/end), else this month to date.
    const asked = (() => {
      const url = new URL(res.url());
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(res.request().postData() ?? "{}") as Record<string, unknown>;
      } catch {
        body = {};
      }
      const pick = (...vals: unknown[]) => vals.find((v): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v))?.slice(0, 10);
      return {
        start: pick(body.periodStart, body.start, url.searchParams.get("start")) ?? firstOfMonth(),
        end: pick(body.periodEnd, body.end, url.searchParams.get("end")) ?? localDay(new Date()),
      };
    })();

    if (answer === "no-mail-sender") {
      await test.step("the screen says the email could not be sent, and never that it was", async () => {
        const reason = /(?:not|n['’]t) (?:been |be )?(?:set up|configured|available|sent)\b|(?:can['’]?t|cannot|could ?not|couldn['’]t|unable to) send|no (?:email|mail) (?:sender|service)/i;
        await expect
          .soft(dialog.getByText(reason).or(page.locator("[data-sonner-toast], [role=alert]").filter({ hasText: reason })).filter({ visible: true }).first(), "the screen says, in plain words, that the email was not sent")
          .toBeVisible({ timeout: 10_000 });
        await expect.soft(page.locator("[data-sonner-toast], [role=alert], [role=status]").filter({ hasText: /\b(sent|emailed)\b(?! ?(failed|error))/i }).filter({ hasNotText: reason }), "no notice that the export was sent").toHaveCount(0);
      });
    }

    await test.step(`the export ZIP for ${asked.start} to ${asked.end} is produced`, async () => {
      const zip = await request.get(`${API_URL}/finance/businesses/${owner.businessId}/accountant-export.zip?start=${asked.start}&end=${asked.end}`, { headers: auth(owner) });
      expect(zip.status(), "the export ZIP is produced").toBe(200);
      expect((await zip.body()).subarray(0, 2).toString("latin1"), "a ZIP").toBe("PK");
    });

    if (answer === "sent") {
      await test.step("the address is kept, so it is asked once", async () => {
        const settings = await api<{ accountantEmail?: string | null }>(request, owner, "GET", `/finance/businesses/${owner.businessId}/settings`);
        expect(settings.accountantEmail, "the accountant's email is kept (saveRecipient)").toBe(accountant);
      });
    } else {
      test.info().annotations.push({ type: "export", description: "no email was sent on this stack, so no address is saved: H9b (@staging) holds 'asked once'" });
    }
  });

  test("H9b the accountant receives the export by email", { tag: "@staging" }, async ({ request, owner }) => {
    // GATE-STAGING-RUN: the platform mail provider and a sandbox mailbox.
    test.setTimeout(5 * 60_000);
    await seedMonth(request, owner);
    const accountant = `accountant.${stamp()}@v62j.test.local`;
    // The route the Send to my accountant button uses (sendAccountantExportEmail): the period is required, and
    // saveRecipient keeps the address (identity's PATCH does not take accountantEmail).
    await api(request, owner, "POST", `/finance/businesses/${owner.businessId}/accountant-export/email`, { to: accountant, saveRecipient: true, periodStart: firstOfMonth(), periodEnd: localDay(new Date()) });
    const settings = await api<{ accountantEmail?: string | null }>(request, owner, "GET", `/finance/businesses/${owner.businessId}/settings`);
    expect(settings.accountantEmail, "the accountant's address is kept, so it is asked once").toBe(accountant);
    const mailbox = process.env.E2E_STAGING_MAILBOX_URL ?? "";
    expect(mailbox, "E2E_STAGING_MAILBOX_URL (GATE-STAGING-RUN) reads the accountant's mail").not.toBe("");
    await expect
      .poll(async () => {
        const res = await request.get(`${mailbox}?to=${encodeURIComponent(accountant)}`);
        return res.ok() ? JSON.stringify(await res.json()) : "";
      }, { timeout: 120_000, message: "the export reaches the accountant" })
      .toMatch(/\.zip/i);
  });

  test("H10 no invented figures on the Money screens", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    const expense = await seedExpense(request, owner, 75, `Stationery ${stamp()}`);
    const month = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "long", year: "numeric" }).format(new Date());
    // Placeholders the sweep found shown as data (BUG-072, BUG-073), and a month that is not this one.
    const invented = [
      /\d+% of (your )?monthly budget/i,
      /travel policy/i,
      /approval:\s*manager/i,
      /\bJane\b/,
      /categoryies/i,
    ];
    const seen: string[] = [];
    for (const [where, open] of [
      ["Overview", () => openMoney(page, "Overview")],
      ["Expenses & bills", () => openMoney(page, "Expenses & bills")],
      ["the expense's page", async () => {
        await page.goto(`/app/expenses/${expense.id}`);
        await settle(page, 1_500);
      }],
      ["Reports", () => openMoney(page, "Reports")],
    ] as const) {
      await open();
      const text = await mainText(page);
      for (const re of invented) if (re.test(text)) seen.push(`${where}: ${re.source}`);
      const months = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d\b/g) ?? [];
      for (const m of months) if (m !== month && where === "Expenses & bills") seen.push(`${where}: '${m}' (this month is ${month})`);
    }
    expect(seen, "figures and text the server did not send").toEqual([]);
  });
});
