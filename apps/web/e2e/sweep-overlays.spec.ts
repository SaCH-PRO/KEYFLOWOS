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
 *   8. The header fits the screen (review LAY-CR-1): every control it shows is
 *      inside the viewport and is the topmost element where it sits, with no
 *      scrolling (the shell's root is overflow-hidden, so a control clipped
 *      off the right edge cannot be reached at all), and a tap where the
 *      Notifications bell is opens the notifications panel. The phone is
 *      measured at 375, 360 and 320 px wide; the desktop at 1440, 1024 and 768.
 *   9. A page's own dialog still covers the header (review LAY-CR-2): with the
 *      CRM data-quality settings dialog open (its backdrop is the page's z-40
 *      literal, not on the layer table yet), the topmost element where the
 *      header's New sits is that backdrop, and a tap there closes the dialog
 *      and opens no New menu over it.
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

/** The widths each project measures the header at (its own viewport first). */
const HEADER_WIDTHS: Record<string, number[]> = { phone: [375, 360, 320], desktop: [1440, 1024, 768] };

/**
 * What of the app header does not fit the screen at the page's current width:
 * the header's content wider than the header, and each control it shows that
 * lies outside the viewport or is not the topmost element at its centre and 20%
 * in from each side. Measured where everything is, with no scrolling: the
 * shell's root is overflow-hidden, so what it clips no user can scroll to (the
 * journey helpers' coveringElement scrolls a button into view first, which
 * would move the clipped header instead).
 */
async function headerFitFindings(page: Page, label: string): Promise<string[]> {
  return page.evaluate((label) => {
    const header = document.querySelector("main header") as HTMLElement | null;
    if (!header) return [`${label}: the app header is not on the page`];
    const findings: string[] = [];
    const vw = document.documentElement.clientWidth;
    if (header.scrollWidth > header.clientWidth + 1) {
      findings.push(`${label}: the header's content is ${header.scrollWidth}px wide in a ${header.clientWidth}px header`);
    }
    const nameOf = (el: Element) =>
      el.getAttribute("aria-label") ?? el.getAttribute("title") ?? (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
    const controls = Array.from(header.querySelectorAll<HTMLElement>("button, a[href]")).filter((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== "hidden";
    });
    if (controls.length === 0) findings.push(`${label}: the header shows no control`);
    for (const el of controls) {
      const box = el.getBoundingClientRect();
      const name = nameOf(el);
      if (box.left < -0.5 || box.right > vw + 0.5) {
        findings.push(`${label}: "${name}" is off screen (x ${Math.round(box.left)} to ${Math.round(box.right)} of ${vw})`);
        continue;
      }
      for (const f of [0.5, 0.2, 0.8]) {
        const x = box.left + box.width * f;
        const y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !(hit === el || el.contains(hit))) {
          const by = hit ? `<${hit.tagName.toLowerCase()} "${nameOf(hit.closest("button, a, [aria-label]") ?? hit)}">` : "nothing (off screen)";
          findings.push(`${label}: "${name}" is covered at (${Math.round(x)}, ${Math.round(y)}) by ${by}`);
        }
      }
    }
    return findings;
  }, label);
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

    test("the header fits the screen: every header control is on screen and topmost, and a tap on the Notifications bell opens it", async ({ page }, testInfo) => {
      test.setTimeout(3 * 60_000);
      await page.goto("/app/command-center");
      await settle(page);
      await closeKeyDrawerIfOpen(page);
      const findings: string[] = [];
      for (const width of HEADER_WIDTHS[project]) {
        await page.setViewportSize({ width, height: viewport.height });
        await page.waitForTimeout(500);
        const label = `${width}x${viewport.height}`;
        // KEY's drawer can open by itself after the first check (SWP-KEY-SHELL-SMOKE's defect, recorded, not this file's).
        if (await closeKeyDrawerIfOpen(page)) testInfo.annotations.push({ type: "key-drawer", description: `opened by itself before the ${label} measure` });
        findings.push(...(await headerFitFindings(page, label)));

        // A tap where the bell is (page.mouse, no scrolling) opens the notifications panel; a second tap there closes it.
        const bell = page.locator("main header").getByRole("button", { name: "Notifications" });
        const box = await bell.boundingBox();
        if (!box) {
          findings.push(`${label}: the Notifications bell has no box`);
          continue;
        }
        const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await page.mouse.click(at.x, at.y);
        const panel = page.locator("main header").getByText("Notifications", { exact: true }).filter({ visible: true });
        const opened = await panel.first().waitFor({ state: "visible", timeout: 3_000 }).then(() => true, () => false);
        if (!opened) {
          findings.push(`${label}: a tap at the Notifications bell (${Math.round(at.x)}, ${Math.round(at.y)}) does not open the notifications panel`);
          continue;
        }
        await page.mouse.click(at.x, at.y);
        await panel.first().waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
      }
      expect(findings, "header controls a user cannot reach (LAY-CR-1)").toEqual([]);
    });

    test("a page's own dialog covers the header: with the data-quality settings open, a tap on New closes the dialog and opens no New menu", async ({ page }) => {
      test.setTimeout(2 * 60_000);
      await page.goto("/app/crm/data-quality");
      await settle(page);
      await closeKeyDrawerIfOpen(page);
      await page.getByRole("button", { name: "Settings", exact: true }).filter({ visible: true }).first().click();
      const dialogTitle = page.getByRole("heading", { name: "Data quality settings" });
      await expect(dialogTitle, "the data-quality settings dialog").toBeVisible();
      await closeKeyDrawerIfOpen(page); // one that opened by itself would cover both (SWP-KEY-SHELL-SMOKE's defect)

      const newButton = page.locator("main header").getByRole("button", { name: /^new\b/i }).filter({ visible: true }).first();
      const box = await newButton.boundingBox();
      expect(box, "the header's New has a box").not.toBeNull();
      const at = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
      // What is topmost where New sits: the dialog's backdrop (the dialog's own container), not New.
      const topmost = await page.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        if (!hit) return "nothing";
        if (hit.closest("main header")) return `the header's ${hit.closest("button")?.getAttribute("title") ?? hit.tagName.toLowerCase()}`;
        const backdrop = Array.from(document.querySelectorAll("h2")).find((h) => h.textContent === "Data quality settings")?.closest(".fixed");
        return backdrop && (hit === backdrop || backdrop.contains(hit)) ? "the dialog's backdrop" : `<${hit.tagName.toLowerCase()} class="${hit.getAttribute("class") ?? ""}">`;
      }, at);
      expect(topmost, "the topmost element where the header's New sits, with a page dialog open").toBe("the dialog's backdrop");

      await page.mouse.click(at.x, at.y);
      await expect(dialogTitle, "a tap outside the dialog (on its backdrop) closes it").toBeHidden();
      await expect(
        page.locator("main header").getByRole("menuitem", { name: /^contact/i }),
        "no New menu opened over the dialog",
      ).toHaveCount(0);
    });
  });
}
