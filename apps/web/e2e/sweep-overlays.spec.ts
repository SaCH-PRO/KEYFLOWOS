import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect, API_URL, VARIANT, coveredButtonFindings, settle, type Tenant } from "./journeys/journey-helpers";
import { JOURNEY_VIEWPORTS } from "./journeys/harness-settings";

/**
 * SWP-LAYERS, the browser half (sweep BUG-004 and BUG-041 repro; journeys A,
 * F, I and K: "No primary button is covered at any point"; "KEY opens only
 * from the header button (on phones too) or Cmd/Ctrl+J, and never covers a
 * button"). The jsdom half, the layer table and who paints over whom, is
 * src/components/__tests__/overlay-stacking.test.tsx.
 *
 * For each primary button the sweep found covered, document.elementFromPoint
 * at its centre and 20% in from each side (coveredButtonFindings, the journey
 * harness's own measure) must be the button itself:
 *
 *   1. Calendar > Create > the New event sheet's "Create" (BUG-004).
 *   2. Expenses > Add expense > the sheet's "Add Expense" (BUG-004; desktop
 *      only: at 375px that sheet's footer puts the button off screen, a
 *      separate defect of the expense sheet).
 *   3. The email composer's "Send email", opened by a sent invoice's
 *      "Send reminder" (the same composer the quote's Send opens; BUG-004).
 *   4. Sales > Collections > a sent invoice's "Mark Paid" (BUG-004).
 *   5. The header's New > "Contact", and the click opens the new-contact
 *      form (BUG-041: the Business Genome banner covered it).
 *
 * and the app shell's KEY doors:
 *
 *   6. No floating KEY bubble ("Talk to KEY") renders on any screen.
 *   7. The header's "Ask KEY" is shown on a phone and on a desktop and opens
 *      KEY's chat drawer (not under KEY_DISABLED, where SWP-KEY-SHELL-SMOKE
 *      hides every KEY door).
 *
 * Both viewports of the journey gate run: 1440x900 (the sweep's) and 375x812
 * (a phone, where the bottom bar covered the sheets' footers). It is live
 * only (E2E_LIVE=1, a production build, a real API and database: the journey
 * harness's own fixtures, README in e2e/journeys); without E2E_LIVE every
 * case is skipped, so the mocked CI job is unaffected. Run it in the
 * "chromium" project:
 *
 *   E2E_LIVE=1 E2E_VARIANT=ai-disabled E2E_API_URL=... E2E_JWT_SECRET=... \
 *     E2E_NO_SERVER=1 E2E_BASE_URL=... npx playwright test e2e/sweep-overlays.spec.ts --project=chromium
 *
 * RED at the SWP-LAYERS base (5e6b0c9a): on the desktop the KEY bubble
 * covers Create, Add Expense and Send email; on the phone the bottom bar
 * covers them; on both the Genome banner covers New > Contact; the bubble
 * renders; the header has no "Ask KEY" button (the desktop's KEY bar is
 * named by its typing placeholder and hidden on a phone).
 */

const auth = (t: Tenant) => ({ Authorization: `Bearer ${t.token}` });

async function api<T = Record<string, unknown>>(
  request: APIRequestContext,
  owner: Tenant,
  method: "GET" | "POST" | "PATCH",
  path: string,
  data?: unknown,
): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, { method, headers: auth(owner), data });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 400)}`).toBe(method === "POST" ? 201 : 200);
  return (text ? JSON.parse(text) : null) as T;
}

const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;

/** A customer with an email, and a SENT invoice to them (made through the API, as the journeys seed one). */
async function seedSentInvoice(request: APIRequestContext, owner: Tenant) {
  const last = `Layers${stamp()}`;
  const contact = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts`, {
    firstName: "Nia",
    lastName: last,
    email: `nia.${last.toLowerCase()}@v62j.test.local`,
  });
  const invoice = await api<{ id: string; invoiceNumber: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices`, {
    contactId: contact.id,
    currency: owner.currency,
    items: [{ description: "Layered cake", quantity: 1, unitPrice: 350 }],
  });
  await api(request, owner, "PATCH", `/commerce/invoices/${invoice.id}/status/sent`, { businessId: owner.businessId, status: "SENT" });
  return invoice;
}

/** Closes a KEY drawer that opened by itself (SWP-KEY-SHELL-SMOKE's defect, recorded, not this file's), so the screen is reachable. */
async function closeKeyDrawerIfOpen(page: Page): Promise<boolean> {
  const drawer = page.getByRole("heading", { name: /^KEY$/ }).filter({ visible: true });
  await drawer.first().waitFor({ state: "visible", timeout: 3_000 }).catch(() => {});
  if (!(await drawer.count())) return false;
  const close = page.getByRole("button", { name: /^close chat$/i }).filter({ visible: true });
  if (await close.count()) await close.first().click();
  else await page.keyboard.press("Escape");
  await drawer.first().waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
  return true;
}

/**
 * Runs one door's steps and measures; a door that cannot be reached is itself
 * a finding (so every door is measured in one run, and none passes by being
 * skipped).
 */
async function attempt(findings: string[], what: string, steps: () => Promise<string[]>): Promise<void> {
  try {
    findings.push(...(await steps()));
  } catch (e) {
    findings.push(`${what} could not be reached: ${String((e as Error).message ?? e).split("\n")[0]}`);
  }
}

/** Waits for a sheet's button to come to rest (sheets slide in), then reports what covers it. */
async function coverOf(what: string, locator: Locator): Promise<string[]> {
  await expect(locator, what).toBeVisible();
  await locator.page().waitForTimeout(800);
  return coveredButtonFindings([{ what, locator }]);
}

for (const [project, viewport] of Object.entries(JOURNEY_VIEWPORTS)) {
  test.describe(`SWP-LAYERS overlays (${project} ${viewport.width}x${viewport.height})`, () => {
    test.use(
      project === "phone"
        ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
        : { viewport },
    );

    test("the sheets' primary buttons are not covered: Create, Add Expense, Send email; and Collections' Mark Paid", async ({ page, request, owner }, testInfo) => {
      test.setTimeout(6 * 60_000);
      const invoice = await seedSentInvoice(request, owner);
      const findings: string[] = [];

      await test.step("Calendar > Create: the New event sheet's Create", () =>
        attempt(findings, "the New event sheet's 'Create'", async () => {
          await page.goto("/app/schedule/calendar");
          await settle(page, 1_000);
          if (await closeKeyDrawerIfOpen(page)) testInfo.annotations.push({ type: "key-drawer", description: "opened by itself on the calendar" });
          await page.getByRole("button", { name: /^create$/i }).filter({ visible: true }).first().click();
          const sheet = page.getByRole("dialog", { name: "New event" });
          return coverOf("the New event sheet's 'Create'", sheet.getByRole("button", { name: /^create$/i }));
        }));

      // At 375px the expense sheet's footer lays "Add Expense" out past the
      // screen's right edge (x ~ 570), a layout defect of that sheet
      // (expense-form-sidesheet.tsx, EXPENSES-HUB-2/3), not a layer: no
      // elementFromPoint reaches it, so the phone measures the other doors and
      // the commerce sheet's layer is held in jsdom (overlay-stacking.test.tsx).
      if (project === "desktop") await test.step("Expenses > Add expense: the sheet's Add Expense", () =>
        attempt(findings, "the expense sheet's 'Add Expense'", async () => {
          await page.goto("/app/expenses");
          await settle(page, 1_000);
          await closeKeyDrawerIfOpen(page);
          // The page header's add button; on a phone it is its "+" icon alone (the label is hidden below sm).
          const add = page
            .getByRole("heading", { name: "Expenses", level: 1 })
            .locator("xpath=ancestor::div[.//button][1]")
            .locator("button:has(svg.lucide-plus)")
            .first();
          await add.click();
          const sheet = page.getByRole("dialog").filter({ has: page.getByPlaceholder("What was this expense for?") });
          await sheet.getByPlaceholder("What was this expense for?").fill(`Flour ${stamp()}`);
          await sheet.getByPlaceholder("0.00").first().fill("125.50");
          return coverOf("the expense sheet's 'Add Expense'", sheet.getByRole("button", { name: /^add expense$/i }));
        }));

      await test.step("a sent invoice's Send reminder opens the email composer: its Send email", () =>
        attempt(findings, "the email composer's 'Send email'", async () => {
          await page.goto(`/app/commerce/invoices/${invoice.id}`);
          await settle(page, 1_000);
          await closeKeyDrawerIfOpen(page);
          await page.getByRole("button", { name: /^(send reminder|remind)$/i }).filter({ visible: true }).first().click();
          const composer = page.getByRole("dialog").filter({ hasText: "Compose email" });
          const covered = await coverOf("the email composer's 'Send email'", composer.getByRole("button", { name: /^send email$/i }));
          await page.keyboard.press("Escape");
          return covered;
        }));

      await test.step("Sales > Collections: the sent invoice's Mark Paid", () =>
        attempt(findings, "Collections' 'Mark Paid'", async () => {
          await page.goto("/app/commerce?tab=pipeline&view=collections");
          await settle(page, 1_000);
          await closeKeyDrawerIfOpen(page);
          // The tenant's one sent invoice is the only one Collections lists (a phone hides its number).
          const markPaid = page.locator('button[title="Mark Paid"]').filter({ visible: true }).first();
          await expect(markPaid, `Collections lists ${invoice.invoiceNumber}`).toBeVisible({ timeout: 20_000 });
          return coverOf("Collections' 'Mark Paid'", markPaid);
        }));

      expect(findings, "covered primary buttons (BUG-004)").toEqual([]);
    });

    test("the header's New > Contact is the topmost control where it sits, and opens the new-contact form", async ({ page }) => {
      test.setTimeout(2 * 60_000);
      await page.goto("/app/command-center");
      await settle(page);
      await closeKeyDrawerIfOpen(page);
      const banner = page.getByText("Build your Business Genome").filter({ visible: true });
      expect.soft(await banner.count(), "the Business Genome banner renders in the app shell (BUG-041)").toBe(0);
      await page.getByRole("button", { name: /^new\b/i }).filter({ visible: true }).first().click();
      const contact = page.getByRole("menuitem", { name: /^contact/i }).filter({ visible: true }).first();
      await expect(contact).toBeVisible();
      expect(await coveredButtonFindings([{ what: "the header New menu's 'Contact'", locator: contact }]), "New > Contact (BUG-041)").toEqual([]);
      await contact.click();
      await page.waitForURL(/\/app\/crm\/contacts\?action=new/);
    });

    test("no floating KEY bubble; the header's Ask KEY shows and opens KEY's drawer", async ({ page }) => {
      test.setTimeout(2 * 60_000);
      await page.goto("/app/command-center");
      await settle(page);
      await closeKeyDrawerIfOpen(page);
      await expect(page.getByRole("button", { name: "Talk to KEY" }), "the floating KEY bubble (BUG-004)").toHaveCount(0);
      test.skip(VARIANT === "key-disabled", "under KEY_DISABLED no KEY door renders (SWP-KEY-SHELL-SMOKE)");
      const askKey = page.locator("header").getByRole("button", { name: "Ask KEY" });
      await expect(askKey, "the header's Ask KEY door").toBeVisible();
      expect(await coveredButtonFindings([{ what: "the header's 'Ask KEY'", locator: askKey }]), "Ask KEY").toEqual([]);
      await askKey.click();
      await expect(page.getByRole("heading", { name: /^KEY$/ }).filter({ visible: true }), "KEY's chat drawer").toBeVisible();
    });
  });
}
