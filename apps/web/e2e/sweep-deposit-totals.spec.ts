import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect, API_URL, settle, type Tenant } from "./journeys/journey-helpers";
import { JOURNEY_VIEWPORTS } from "./journeys/harness-settings";

/**
 * SWP-INV-MONEY-TOTALS, the browser half (sweep BUG-020 and BUG-024 repro;
 * journeys D7, H and I read the same figures). The jsdom half is
 * src/app/app/commerce/payments/__tests__/collections-health.test.tsx; the
 * server half, test/money-totals-partial-payments.integration.test.ts in
 * apps/server.
 *
 * The sweep's steps: an invoice of 13,723 is sent and a 400 deposit recorded
 * on it. Sales then showed Revenue 0 and Owed 0 (BUG-020: the stats counted
 * PAID invoices' totals as revenue and SENT / OVERDUE totals as owed, so a
 * part-paid invoice was neither), and Sales > Collections showed nothing
 * received, the whole 13,723 pending and a Collections Health of
 * "TTD -13723" (BUG-024).
 *
 * Here, for a fresh owner on a real API and database, with that invoice and
 * its deposit recorded through the real routes, and a 999 draft never sent:
 *   1. the API states one set of figures: GET commerce stats answers
 *      totalRevenue 400 and outstandingAmount 13,323; the Executive Summary's
 *      outstanding and the A/R aging's total are the same 13,323 (the draft is
 *      in neither);
 *   2. Sales shows Revenue TTD 400 and Owed TTD 13.3k;
 *   3. Sales > Collections shows TTD 400 received and TTD 13.3k pending, the
 *      Collections Health card states TTD 13.3k to collect, and no figure on
 *      it is negative.
 *
 * Both viewports of the journey gate run: 1440x900 (the sweep's) and 375x812
 * (a phone). It is live only (E2E_LIVE=1, a production build, a real API and
 * database: the journey harness's own fixtures, README in e2e/journeys);
 * without E2E_LIVE every case is skipped, so the mocked CI job is unaffected.
 * Run it in the "chromium" project:
 *
 *   E2E_LIVE=1 E2E_VARIANT=ai-disabled E2E_API_URL=... E2E_JWT_SECRET=... \
 *     E2E_NO_SERVER=1 E2E_BASE_URL=... npx playwright test e2e/sweep-deposit-totals.spec.ts --project=chromium
 */

const TOTAL = 13723;
const DEPOSIT = 400;
const OWED = TOTAL - DEPOSIT;
const DRAFT = 999;

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

/** The sweep's book: 13,723 sent with a 400 deposit, and a 999 draft never sent. */
async function seedDepositBook(request: APIRequestContext, owner: Tenant): Promise<void> {
  const stamp = `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;
  const contact = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts`, {
    firstName: "Maria",
    lastName: `Deposit${stamp}`,
    phone: `+18687${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
  });
  const invoice = await api<{ id: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices`, {
    contactId: contact.id,
    currency: owner.currency,
    items: [{ description: "Event catering", quantity: 1, unitPrice: TOTAL }],
  });
  await api(request, owner, "PATCH", `/commerce/invoices/${invoice.id}/status/sent`, { businessId: owner.businessId, status: "SENT" });
  await api(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices/${invoice.id}/payments`, {
    amount: DEPOSIT,
    method: "Cash",
    idempotencyKey: `${invoice.id}-deposit`,
  });
  await api(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices`, {
    contactId: contact.id,
    currency: owner.currency,
    items: [{ description: "Not sent yet", quantity: 1, unitPrice: DRAFT }],
  });
}

/** The visible text of the page's main region, on one line. */
async function mainText(page: Page, path: string): Promise<string> {
  await page.goto(path);
  await settle(page, 2_000);
  await page.keyboard.press("Escape");
  return (await page.locator("main").first().innerText()).replace(/\s+/g, " ");
}

/** A figure below zero, however the minus is written ("TTD -13723", "-TTD 12.9k"). */
const NEGATIVE_FIGURE = /[-−–]\s*(?:[A-Z]{3}\s*)?[0-9]|[A-Z]{3}\s*[-−–]\s*[0-9]/;

for (const [project, viewport] of Object.entries(JOURNEY_VIEWPORTS)) {
  test.describe(`SWP-INV-MONEY-TOTALS a deposit counts (${project} ${viewport.width}x${viewport.height})`, () => {
    test.use(
      project === "phone"
        ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
        : { viewport },
    );
    test.use({ tenantOptions: { currency: "TTD" } });

    test("a 400 deposit on 13,723 is revenue 400 and owed 13,323 on the API, on Sales and on Collections, and nothing reads negative", async ({ page, request, owner }) => {
      test.setTimeout(4 * 60_000);
      await seedDepositBook(request, owner);

      await test.step("the API states one set of figures", async () => {
        const stats = await api<{ totalRevenue: number; outstandingAmount: number; currency: string }>(
          request, owner, "GET", `/commerce/businesses/${owner.businessId}/stats`,
        );
        expect({ totalRevenue: stats.totalRevenue, outstandingAmount: stats.outstandingAmount }, "commerce stats (BUG-020: 0 / 0)")
          .toEqual({ totalRevenue: DEPOSIT, outstandingAmount: OWED });
        const aging = await api<{ totalOutstanding: number }>(request, owner, "GET", `/finance/businesses/${owner.businessId}/receivables/aging`);
        expect(Number(aging.totalOutstanding), "the A/R aging").toBe(OWED);
        const report = await api<{ metrics: { revenue: { outstanding: number; outstandingCount: number } } }>(
          request, owner, "GET", `/businesses/${owner.businessId}/reports/generate?type=executive`,
        );
        expect(report.metrics.revenue, "the Executive Summary's outstanding (it was the 999 draft alone)")
          .toMatchObject({ outstanding: aging.totalOutstanding, outstandingCount: 1 });
      });

      await test.step("Sales: Revenue TTD 400, Owed TTD 13.3k", async () => {
        const text = await mainText(page, "/app/commerce");
        // The KPI strip draws each label and then its figure; an invoice row's "TTD 400.00" is not the Revenue figure.
        expect.soft(text, "Sales shows the deposit as revenue").toMatch(/revenue\s*TTD 400(?![.,\d])/i);
        expect.soft(text, "Sales shows what is left as owed").toMatch(/owed\s*TTD 13\.3k/i);
        // The overview's hero, where the screen draws it (found red on a desktop by journey D7: 0.00 and TTD 0 collected).
        if (/outstanding revenue/i.test(text)) {
          expect.soft(text, "the hero states what is left").toMatch(/outstanding revenue\D*13,323\.00/i);
          expect.soft(text, "the hero states the deposit as collected").toMatch(/TTD 400 collected/);
        }
      });

      await test.step("Sales > Collections: 400 received, 13.3k pending, no negative Collections Health", async () => {
        await page.goto("/app/commerce?tab=pipeline&view=collections");
        await settle(page, 2_000);
        await page.keyboard.press("Escape");
        const card = page.locator("div.rounded-xl", { has: page.getByText("Collections Health", { exact: true }) }).last();
        await expect(card, "the Collections Health card").toBeVisible();
        const text = (await card.innerText()).replace(/\s+/g, " ");
        expect.soft(text, "the deposit is received").toContain("TTD 400 received");
        expect.soft(text, "what is left is pending").toContain("TTD 13.3k pending");
        expect.soft(text, "no figure on the card is negative (BUG-024: TTD -13723)").not.toMatch(NEGATIVE_FIGURE);
        await expect.soft(card.getByTestId("collections-to-collect"), "the headline is what is still to collect").toHaveText("TTD 13.3k");
      });
    });
  });
}
