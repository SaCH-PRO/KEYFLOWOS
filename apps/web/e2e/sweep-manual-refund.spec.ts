import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect, API_URL, memberOf, settle, signedInContext, type Tenant } from "./journeys/journey-helpers";

/**
 * SWP-INV-REFUND-UI, the browser half (sweep BUG-049; journey E10; refund ruling D-169: whole-payment refunds only in
 * v1). The jsdom halves are src/app/app/commerce/invoices/__tests__/invoice-refund.test.tsx (the invoice page) and
 * src/app/app/payments/__tests__/payments-manual-refund.test.tsx (Money > Money in).
 *
 * BUG-049: a payment recorded by hand (cash, bank transfer) could not be refunded anywhere: the invoice's Payments tab
 * had no Refund, and Money > Money in (/app/payments) listed and refunded gateway charges only. The server's door
 * (POST /commerce/businesses/:businessId/payments/:paymentId/refund, revenue:write) existed and no screen called it.
 * The refund calls no provider: it records a negative REFUNDED row (D-14) and reopens the invoice.
 *
 * For a fresh TTD owner on a real API and database (live only: E2E_LIVE=1, a production build; the journey harness's
 * fixtures, README in e2e/journeys; without E2E_LIVE every case is skipped), with an invoice of 300 seeded through the
 * real routes, SENT, with a cash payment of 100 recorded on it, at 1440x900, 1024x768, 768x1024 and 375x812 (each case
 * on its own fresh tenant):
 *   1. the invoice page: the cash payment offers Refund; Refund asks first, naming TTD 100.00 (no amount field), and
 *      Cancel sends nothing; confirming POSTs the refund (201) and the page shows the server's figures without a
 *      reload (Remaining TTD 300.00, status Sent, the payment Refunded and offering no second Refund); the server
 *      holds one refund row of -100 and the invoice is SENT with 300 remaining;
 *   2. Money > Money in: the cash payment is listed with its invoice and TTD 100.00 and offers Refund; confirming
 *      POSTs the refund (201), and the payment reads Refunded; the server's invoice is SENT with 300 remaining;
 *   3. a member with revenue read only: Refund on the invoice is refused (403), the refusal is shown in the server's
 *      words, nothing reads as refunded, and the server's invoice is unchanged (PARTIALLY_PAID, 200 remaining).
 *
 *   E2E_LIVE=1 E2E_VARIANT=ai-disabled E2E_API_URL=... E2E_JWT_SECRET=... E2E_WEB_COMMAND=standalone \
 *     E2E_PORT=... E2E_BASE_URL=... npx playwright test e2e/sweep-manual-refund.spec.ts --project=chromium
 */

const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;

async function api<T = Record<string, unknown>>(request: APIRequestContext, token: string, method: "GET" | "POST" | "PATCH", path: string, data?: unknown): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 400)}`).toBe(method === "POST" ? 201 : 200);
  return (text ? JSON.parse(text) : null) as T;
}

interface Seeded {
  invoice: { id: string; invoiceNumber: string };
  paymentId: string;
}

interface PaymentRow {
  id: string;
  amount: number;
  status: string;
  reference: string | null;
  providerPaymentId: string;
}

/** An invoice of 300, SENT, with a cash payment of 100 recorded through the owner's route. */
async function seed(request: APIRequestContext, owner: Tenant): Promise<Seeded> {
  const biz = owner.businessId;
  const last = `Refund${stamp()}`;
  const contact = await api<{ id: string }>(request, owner.token, "POST", `/crm/businesses/${biz}/contacts`, {
    firstName: "Rena",
    lastName: last,
    email: `${last.toLowerCase()}@v1rf.test.local`,
  });
  const invoice = await api<{ id: string; invoiceNumber: string }>(request, owner.token, "POST", `/commerce/businesses/${biz}/invoices`, {
    contactId: contact.id,
    currency: owner.currency,
    items: [{ description: "Catering for 40", quantity: 1, unitPrice: 300 }],
  });
  await api(request, owner.token, "PATCH", `/commerce/invoices/${invoice.id}/status/sent`, { businessId: biz, status: "SENT" });
  const recorded = await api<{ payment: { id: string } }>(request, owner.token, "POST", `/commerce/businesses/${biz}/invoices/${invoice.id}/payments`, {
    amount: 100,
    method: "Cash",
    idempotencyKey: `${invoice.id}-cash`,
  });
  return { invoice, paymentId: recorded.payment.id };
}

/** The server's reading of the invoice: its status, what remains and its payment rows. */
async function serverInvoice(request: APIRequestContext, owner: Tenant, invoiceId: string) {
  const read = await api<{ status: string; remaining: number }>(request, owner.token, "GET", `/commerce/businesses/${owner.businessId}/invoices/${invoiceId}`);
  const listed = await api<{ payments: PaymentRow[] }>(request, owner.token, "GET", `/commerce/businesses/${owner.businessId}/invoices/${invoiceId}/payments`);
  return { status: read.status, remaining: read.remaining, payments: listed.payments };
}

async function openInvoice(page: Page, invoice: { id: string; invoiceNumber: string }): Promise<void> {
  await page.goto(`/app/commerce/invoices/${invoice.id}`);
  await expect(page.getByRole("heading", { level: 1, name: `Invoice ${invoice.invoiceNumber}` })).toBeVisible();
}

const shown = (scope: Page | Locator, name: RegExp): Locator => scope.getByRole("button", { name }).filter({ visible: true });
const invoiceRow = (page: Page, paymentId: string): Locator => page.locator(`[data-testid='invoice-payment-row'][data-payment-id='${paymentId}']`);
const remaining = (page: Page): Locator =>
  page.locator("h3", { hasText: /^Payment Summary$/i }).locator("xpath=..").locator("span", { hasText: /^Remaining$/ }).locator("xpath=following-sibling::span[1]");
const isRefundPost = (businessId: string, paymentId: string) => (r: { request(): { method(): string }; url(): string }) =>
  r.request().method() === "POST" && new URL(r.url()).pathname === `/commerce/businesses/${businessId}/payments/${paymentId}/refund`;

/** Records every refund POST the page sends. */
function refundPosts(page: Page): string[] {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/payments\/[^/]+\/refund$/.test(new URL(r.url()).pathname)) posts.push(r.url());
  });
  return posts;
}

async function openPaymentsTab(page: Page): Promise<void> {
  await shown(page, /^Payments/).first().click();
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]) {
  test.describe(`SWP-INV-REFUND-UI refund a manual payment (${viewport.width}x${viewport.height})`, () => {
    test.use(viewport.width < 600 ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport });
    test.use({ tenantOptions: { currency: "TTD" } });

    test("BUG-049 the invoice page: the cash payment is refunded whole, after a confirm, and the page shows the server's figures", async ({ page, request, owner }) => {
      test.setTimeout(4 * 60_000);
      const s = await seed(request, owner);
      const posts = refundPosts(page);
      await openInvoice(page, s.invoice);
      await settle(page, 500);
      await expect(remaining(page)).toHaveText("TTD 200.00");
      await openPaymentsTab(page);
      const row = invoiceRow(page, s.paymentId);
      await expect(row).toBeVisible();

      await test.step("Refund asks first, naming the whole payment (no amount field); Cancel sends nothing", async () => {
        await shown(row, /^refund/i).first().click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText("TTD 100.00");
        await expect(dialog.getByRole("spinbutton")).toHaveCount(0);
        await dialog.getByRole("button", { name: /^cancel$/i }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        expect(posts, "nothing is sent without a confirm").toEqual([]);
      });

      await test.step("confirming refunds it (201); the page shows Remaining TTD 300.00, Sent, and the payment Refunded", async () => {
        await shown(row, /^refund/i).first().click();
        const refunded = page.waitForResponse(isRefundPost(owner.businessId, s.paymentId));
        await page.getByRole("dialog").getByRole("button", { name: /^refund/i }).click();
        expect((await refunded).status()).toBe(201);
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(remaining(page)).toHaveText("TTD 300.00");
        await expect(page.locator("h1").locator("xpath=following-sibling::span[1]")).toHaveText("Sent");
        await expect(row.getByText(/^refunded$/i)).toBeVisible();
        await expect(shown(row, /^refund/i)).toHaveCount(0);
        expect(posts).toHaveLength(1);
      });

      await test.step("the server holds one refund of -100 linked to the payment; the invoice is SENT with 300 remaining", async () => {
        const read = await serverInvoice(request, owner, s.invoice.id);
        const original = read.payments.find((p) => p.id === s.paymentId)!;
        const refunds = read.payments.filter((p) => p.status === "REFUNDED");
        expect(refunds.map((p) => ({ amount: Number(p.amount), reference: p.reference }))).toEqual([{ amount: -100, reference: original.providerPaymentId }]);
        expect({ status: read.status, remaining: read.remaining }).toEqual({ status: "SENT", remaining: 300 });
      });
    });

    test("BUG-049 Money > Money in: the cash payment is listed with its invoice and refunded whole after a confirm", async ({ page, request, owner }) => {
      test.setTimeout(4 * 60_000);
      const s = await seed(request, owner);
      const posts = refundPosts(page);
      await page.goto("/app/payments");
      await settle(page, 500);
      const row = page.locator(`[data-testid='recorded-payment-row'][data-payment-id='${s.paymentId}']`);

      await test.step("the payment recorded by hand is listed with its invoice and TTD 100.00, and offers Refund", async () => {
        await expect(row).toBeVisible();
        await expect(row).toContainText(s.invoice.invoiceNumber);
        await expect(row).toContainText("TTD 100.00");
        await expect(shown(row, /^refund/i)).toHaveCount(1);
      });

      await test.step("Refund asks first, naming TTD 100.00; confirming refunds it (201) and the payment reads Refunded", async () => {
        await shown(row, /^refund/i).first().click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toContainText("TTD 100.00");
        await expect(dialog.getByRole("spinbutton")).toHaveCount(0);
        expect(posts).toEqual([]);
        const refunded = page.waitForResponse(isRefundPost(owner.businessId, s.paymentId));
        await dialog.getByRole("button", { name: /^refund/i }).click();
        expect((await refunded).status()).toBe(201);
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(row.getByText(/^refunded$/i)).toBeVisible();
        await expect(shown(row, /^refund/i)).toHaveCount(0);
        expect(posts).toHaveLength(1);
      });

      await test.step("the server's invoice is SENT with 300 remaining", async () => {
        const read = await serverInvoice(request, owner, s.invoice.id);
        expect({ status: read.status, remaining: read.remaining }).toEqual({ status: "SENT", remaining: 300 });
      });
    });

    test("BUG-049 a member with revenue read only: the refusal is shown in the server's words and nothing is refunded", async ({ browser, request, owner }) => {
      test.setTimeout(4 * 60_000);
      const s = await seed(request, owner);
      const member = await memberOf(request, owner, "revenue reader", { role: "STAFF", scopes: { revenue: "read", crm: "read" } });
      const context = await signedInContext(browser, member, viewport.width < 600 ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport });
      const page = await context.newPage();
      await openInvoice(page, s.invoice);
      await settle(page, 500);
      await openPaymentsTab(page);
      const row = invoiceRow(page, s.paymentId);
      await expect(row).toBeVisible();

      await shown(row, /^refund/i).first().click();
      const refused = page.waitForResponse(isRefundPost(owner.businessId, s.paymentId));
      await page.getByRole("dialog").getByRole("button", { name: /^refund/i }).click();
      const answer = await refused;
      expect(answer.status()).toBe(403);
      const message = String(((await answer.json()) as { message?: unknown }).message ?? "");
      expect(message, "the server says why").not.toBe("");

      await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
      await expect(row.getByText(/^refunded$/i)).toHaveCount(0);
      await expect(shown(row, /^refund/i), "the action is withdrawn").toHaveCount(0);
      await expect(remaining(page)).toHaveText("TTD 200.00");
      const read = await serverInvoice(request, owner, s.invoice.id);
      expect({ status: read.status, remaining: read.remaining, refunds: read.payments.filter((p) => p.status === "REFUNDED").length }).toEqual({
        status: "PARTIALLY_PAID",
        remaining: 200,
        refunds: 0,
      });
    });
  });
}
