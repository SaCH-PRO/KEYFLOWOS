import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect, API_URL, settle, coveringElement, type Tenant } from "./journeys/journey-helpers";

/**
 * SWP-SERVICE-DEPOSIT, the browser half (sweep BUG-048; journeys B and F; D-26, D-59, D-80). The jsdom half is
 * src/app/app/bookings/components/__tests__/catalog-capacity-tab-deposit.test.tsx and
 * src/app/app/bookings/__tests__/bookings-service-door.test.tsx; the server half (M17) is
 * test/service-deposit-settings.integration.test.ts in apps/server.
 *
 * The sweep found that a service's deposit could not be set anywhere on the web, and that Presence's
 * "<service> is popular — add a deposit" tip led nowhere useful. Here, for a fresh owner whose business is in USD,
 * on a real API and database, at 375, 768, 1024 and 1440 wide:
 *   1. the tip (three completed bookings of a 120.00 service with no deposit) is on Presence; its "Edit service"
 *      link lands in Bookings > Setup with that service's deposit editor open, and serviceId leaves the URL;
 *   2. a 25% deposit is saved there; after a reload the editor shows it, the card states 25% and USD 30.00, and the
 *      API stores PERCENT 25;
 *   3. a FIXED deposit above the price is refused: on the page before anything is sent (naming USD 120.00), and,
 *      when the page's price is stale (lowered to 80 behind it), by the server, whose message the page shows; the
 *      stored deposit is unchanged;
 *   4. the deposit is turned off; after a reload the card says No deposit and the API stores false / null / null.
 * Every control is pressed as a person would: scrolled into view as far as the page allows, and only if nothing (the
 * phone's Mobile navigation bar, the KEY bubble) covers it there (journey-helpers coveringElement, F9's rule).
 *
 * Live only (E2E_LIVE=1, a production build, a real API and database: the journey harness's own fixtures, README in
 * e2e/journeys); without E2E_LIVE every case is skipped, so the mocked CI job is unaffected. Run it in the
 * "chromium" project:
 *
 *   E2E_LIVE=1 E2E_VARIANT=ai-disabled E2E_API_URL=... E2E_JWT_SECRET=... E2E_WEB_COMMAND=standalone \
 *     E2E_PORT=... E2E_BASE_URL=... npx playwright test e2e/sweep-service-deposit.spec.ts --project=chromium
 */

const PRICE = 120;

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

interface StoredService {
  id: string;
  name: string;
  price: number;
  depositRequired: boolean;
  depositType: string | null;
  depositValue: number | null;
}

async function storedService(request: APIRequestContext, owner: Tenant, id: string): Promise<StoredService> {
  const rows = await api<StoredService[]>(request, owner, "GET", `/catalog/businesses/${owner.businessId}/services`);
  const row = rows.find((s) => s.id === id);
  expect(row, `service ${id} is listed`).toBeTruthy();
  return row!;
}

/** A 120.00 service with no deposit, booked to completion three times on the storefront (the tip's threshold). */
async function seedPopularService(request: APIRequestContext, owner: Tenant): Promise<StoredService> {
  const stamp = `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;
  const service = await api<StoredService>(request, owner, "POST", `/catalog/businesses/${owner.businessId}/services`, {
    name: `Gel manicure ${stamp}`,
    duration: 60,
    price: PRICE,
  });
  // The storefront's own analytics route (no session): three completed bookings of this service, today.
  const res = await request.post(`${API_URL}/public/events`, {
    data: {
      visitorId: `v_${stamp}`,
      sessionId: `s_${stamp}`,
      events: [1, 2, 3].map(() => ({ type: "booking_complete", businessId: owner.businessId, payload: { serviceId: service.id } })),
    },
  });
  expect(res.status(), `POST /public/events: ${await res.text()}`).toBeLessThan(300);
  return service;
}

/** The service's deposit summary button on its Setup card. */
const depositButton = (page: Page, name: string) => page.getByRole("button", { name: `Deposit for ${name}` });
const editorOf = (page: Page, name: string) => page.getByRole("group", { name: `Deposit settings for ${name}` });

/** Scrolls `target` into view as a person would, checks nothing covers it there, and presses it. */
async function press(target: Locator, what: string) {
  expect(await coveringElement(target), `${what} is not covered once scrolled into view`).toBeNull();
  await target.click();
}

async function savePatch(page: Page, serviceId: string, click: () => Promise<void>) {
  const done = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && new URL(r.url()).pathname.endsWith(`/services/${serviceId}`),
  );
  await click();
  return done;
}

const WIDTHS = [375, 768, 1024, 1440] as const;

for (const width of WIDTHS) {
  test.describe(`SWP-SERVICE-DEPOSIT a service's deposit at ${width}px`, () => {
    test.use(
      width === 375
        ? { viewport: { width, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
        : { viewport: { width, height: 900 } },
    );
    test.use({ tenantOptions: { currency: "USD", sells: "services" } });

    test(`the tip opens the service's deposit editor; 25% persists; FIXED above the price is refused; off clears it (${width})`, async ({ page, request, owner }) => {
      test.setTimeout(5 * 60_000);
      const service = await seedPopularService(request, owner);
      const name = service.name;

      await test.step("the tip is offered and links to the service's editor", async () => {
        const overview = await api<{ actionCards: Array<{ key: string; ctaHref: string; relatedId?: string | null }> }>(
          request, owner, "GET", `/site/presence/businesses/${owner.businessId}/overview`,
        );
        const tip = overview.actionCards.find((c) => c.key === "POPULAR_SERVICE_ADD_DEPOSIT" && c.relatedId === service.id);
        expect(tip, "the POPULAR_SERVICE_ADD_DEPOSIT tip for the seeded service").toBeTruthy();
        expect(tip!.ctaHref).toBe(`/app/bookings?tab=catalog&serviceId=${encodeURIComponent(service.id)}`);
      });

      await test.step("Presence's tip lands in Bookings > Setup with that service's deposit editor open", async () => {
        await page.goto("/app/presence");
        await settle(page, 1_500);
        const card = page.locator("div.rounded-lg", { hasText: `${name} is popular` }).filter({ visible: true }).first();
        await expect(card, "the tip on Presence").toBeVisible({ timeout: 30_000 });
        await press(card.getByRole("link", { name: /edit service/i }), "the tip's Edit service");
        await page.waitForURL(/\/app\/bookings/);
        await expect(editorOf(page, name), "the tip opened this service's deposit editor").toBeVisible({ timeout: 30_000 });
        await expect.poll(() => new URL(page.url()).search, { message: "serviceId leaves the URL; tab stays" }).toBe("?tab=catalog");
      });

      await test.step("a 25% deposit is saved, and after a reload the editor and card show it", async () => {
        const editor = editorOf(page, name);
        await press(editor.getByLabel("Require a deposit"), "Require a deposit");
        await expect(editor.getByLabel("Require a deposit")).toBeChecked();
        await expect(editor.getByLabel("Deposit type")).toHaveValue("PERCENT");
        await editor.getByLabel("Deposit percent").fill("25");
        await expect(editor.getByTestId("deposit-preview")).toContainText("USD 30.00 of USD 120.00");
        const res = await savePatch(page, service.id, () => press(editor.getByRole("button", { name: "Save deposit" }), "Save deposit"));
        expect(res.status(), await res.text()).toBe(200);
        await expect(editor).toBeHidden();

        const stored = await storedService(request, owner, service.id);
        expect({ depositRequired: stored.depositRequired, depositType: stored.depositType, depositValue: Number(stored.depositValue) }).toEqual({
          depositRequired: true,
          depositType: "PERCENT",
          depositValue: 25,
        });

        await page.reload();
        await settle(page, 1_000);
        const button = depositButton(page, name);
        await expect(button, "the card after a reload").toContainText("25%", { timeout: 30_000 });
        await expect(button).toContainText("USD 30.00");
        await press(button, "the card's deposit control");
        const reopened = editorOf(page, name);
        await expect(reopened.getByLabel("Require a deposit")).toBeChecked();
        await expect(reopened.getByLabel("Deposit type")).toHaveValue("PERCENT");
        await expect(reopened.getByLabel("Deposit percent")).toHaveValue("25");
      });

      await test.step("a FIXED deposit above the price is refused, on the page and by the server", async () => {
        const editor = editorOf(page, name);
        await editor.getByLabel("Deposit type").selectOption("FIXED");
        const amount = editor.getByLabel("Deposit amount (USD)");
        await amount.fill("130");
        await expect(editor.getByTestId("deposit-problem")).toContainText("at most the price (USD 120.00)");
        await expect(editor.getByRole("button", { name: "Save deposit" })).toBeDisabled();

        // Another screen lowers the price to 80 behind this page, which still believes 120: 100 passes the page's
        // check, and the server's answer is final.
        await api(request, owner, "PATCH", `/catalog/businesses/${owner.businessId}/services/${service.id}`, { price: 80 });
        await amount.fill("100");
        await expect(editor.getByTestId("deposit-problem")).toHaveCount(0);
        const res = await savePatch(page, service.id, () => press(editor.getByRole("button", { name: "Save deposit" }), "Save deposit"));
        expect(res.status()).toBe(400);
        const message = ((await res.json()) as { message: string }).message;
        expect(message).toMatch(/at most the service price/);
        await expect(editor.getByRole("alert"), "the server's own message").toHaveText(message);
        await expect(editor).toBeVisible();

        const stored = await storedService(request, owner, service.id);
        expect({ depositRequired: stored.depositRequired, depositType: stored.depositType, depositValue: Number(stored.depositValue) }, "unchanged").toEqual({
          depositRequired: true,
          depositType: "PERCENT",
          depositValue: 25,
        });
      });

      await test.step("the deposit is turned off, and after a reload it is off", async () => {
        const editor = editorOf(page, name);
        await press(editor.getByLabel("Require a deposit"), "Require a deposit");
        await expect(editor.getByLabel("Require a deposit")).not.toBeChecked();
        await expect(editor.getByLabel("Deposit type")).toHaveCount(0);
        const res = await savePatch(page, service.id, () => press(editor.getByRole("button", { name: "Save deposit" }), "Save deposit"));
        expect(res.status(), await res.text()).toBe(200);
        await expect(editor).toBeHidden();

        const stored = await storedService(request, owner, service.id);
        expect({ depositRequired: stored.depositRequired, depositType: stored.depositType, depositValue: stored.depositValue }).toEqual({
          depositRequired: false,
          depositType: null,
          depositValue: null,
        });

        await page.reload();
        await settle(page, 1_000);
        const button = depositButton(page, name);
        await expect(button, "the card after a reload").toContainText("No deposit", { timeout: 30_000 });
        await press(button, "the card's deposit control");
        await expect(editorOf(page, name).getByLabel("Require a deposit")).not.toBeChecked();
      });
    });
  });
}
