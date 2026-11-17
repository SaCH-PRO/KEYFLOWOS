import type { APIRequestContext, Locator, Page, Response } from "@playwright/test";
import { test, expect, API_URL, coveredButtonFindings, memberOf, settle, signedInContext, type Tenant } from "./journeys/journey-helpers";
import { JOURNEY_VIEWPORTS } from "./journeys/harness-settings";

/**
 * SWP-PROFILE-TEAMSIZE, the browser half (sweep BUG-006 repro; journey A: the
 * owner's business details are saved). The jsdom half is
 * src/app/app/profile/components/__tests__/my-business-teamsize.test.tsx; the
 * server half, test/business-profile-save.integration.test.ts in apps/server.
 *
 * The sweep's steps (scratchpad sweep/onboarding/21-business-profile.mjs):
 * Profile > Business Profile; change the name, tagline and description,
 * optionally pick a team size; Save Business Info; reload. Every save
 * answered 400 "teamSize must be one of: ..." (the form sent SOLO,
 * SMALL_TEAM, ... and "" for no team size), the reason was drawn about 731px
 * above the viewport, only "You have unsaved changes" was in view, and the
 * reload showed the old values.
 *
 * Here, for a fresh owner on a real API and database:
 *   1. The save goes through with no team size chosen, and again with each
 *      team size the form offers; each PATCH answers 200 and the reload shows
 *      what was saved (RED at the base: every PATCH answers 400).
 *   2. A save the server refuses is said where the person is looking and
 *      keeps what they typed: a STAFF member (owner ruling D-11: the profile
 *      is the owner's) presses Save, the real PATCH answers 403, and the
 *      server's words are in a toast and beside the Save button, inside the
 *      viewport, with the typed tagline still in its field (RED at the base:
 *      the reason is only in the page's banner, above the viewport, and no
 *      toast is shown).
 *
 * Both viewports of the journey gate run: 1440x900 (the sweep's) and 375x812
 * (a phone). It is live only (E2E_LIVE=1, a production build, a real API and
 * database: the journey harness's own fixtures, README in e2e/journeys);
 * without E2E_LIVE every case is skipped, so the mocked CI job is unaffected.
 * Run it in the "chromium" project:
 *
 *   E2E_LIVE=1 E2E_VARIANT=ai-disabled E2E_API_URL=... E2E_JWT_SECRET=... \
 *     E2E_NO_SERVER=1 E2E_BASE_URL=... npx playwright test e2e/sweep-profile-save.spec.ts --project=chromium
 */

/** Closes a KEY drawer that opened by itself (not this file's defect), so the screen is reachable. */
async function closeKeyDrawerIfOpen(page: Page): Promise<void> {
  const drawer = page.getByRole("heading", { name: /^KEY$/ }).filter({ visible: true });
  await drawer.first().waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  if (!(await drawer.count())) return;
  const close = page.getByRole("button", { name: /^close chat$/i }).filter({ visible: true });
  if (await close.count()) await close.first().click();
  else await page.keyboard.press("Escape");
  await drawer.first().waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
}

/** Profile > Business Profile (the mode button reads "Business" on a phone). */
async function openBusinessProfile(page: Page): Promise<void> {
  await page.goto("/app/profile?tab=identity");
  await settle(page, 1_500);
  await closeKeyDrawerIfOpen(page);
  await page.getByRole("button", { name: /^business( profile)?$/i }).filter({ visible: true }).first().click();
  await expect(page.getByPlaceholder("Your Business Name")).toBeVisible();
  // The form fills from the business once it has loaded.
  await expect(page.getByPlaceholder("Your Business Name")).not.toHaveValue("");
}

/**
 * Team & Scale is closed by default: open it and return the team size select. The section is drawn again (closed)
 * when the page reloads the business while it settles, so a click that lands just before that is tried again.
 */
async function teamSizeSelect(page: Page): Promise<Locator> {
  const select = page.getByRole("combobox", { name: "Team size" });
  await expect(async () => {
    if (!(await select.isVisible().catch(() => false))) await page.getByRole("button", { name: /team & scale/i }).click();
    await expect(select).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return select;
}

const isProfilePatch = (businessId: string) => (r: Response) =>
  r.request().method() === "PATCH" && r.url().endsWith(`/identity/businesses/${businessId}`);

/**
 * Presses Save Business Info and returns the PATCH's answer. The button is brought to the middle of the screen
 * first, as a person scrolls to it (on a phone the page's last button can sit under the bottom bar until the page is
 * scrolled further), and nothing may cover it there.
 */
async function save(page: Page, businessId: string): Promise<Response> {
  const button = page.getByRole("button", { name: /save business info/i });
  // coveredButtonFindings centres the button first, as a person scrolls to it.
  expect(await coveredButtonFindings([{ what: "Save Business Info", locator: button }])).toEqual([]);
  const answered = page.waitForResponse(isProfilePatch(businessId));
  await button.click();
  return answered;
}

/** The business as the API stores it, read with the owner's token (not through any browser). */
async function storedBusiness(request: APIRequestContext, owner: Tenant) {
  const res = await request.get(`${API_URL}/identity/businesses/${owner.businessId}`, { headers: { Authorization: `Bearer ${owner.token}` } });
  expect(res.status()).toBe(200);
  return (await res.json()) as { name: string; tagline: string | null; description: string | null; teamSize: string | null };
}

/** Whether the element's box lies inside the viewport, as the page is scrolled now. */
async function inViewport(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
  });
}

for (const [project, viewport] of Object.entries(JOURNEY_VIEWPORTS)) {
  test.describe(`SWP-PROFILE-TEAMSIZE Business Profile save (${project} ${viewport.width}x${viewport.height})`, () => {
    test.use(
      project === "phone"
        ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
        : { viewport },
    );

    test("the owner's save goes through with no team size and with each team size offered, and survives a reload", async ({ page, request, owner }) => {
      test.setTimeout(4 * 60_000);
      const name = `${owner.businessName} & Bakes`;
      const tagline = "Fresh from the oven daily";
      const description = "Family bakery in Point Fortin making currants rolls, coconut drops and custom cakes since 2012.";

      await test.step("no team size chosen: the name, tagline and description are saved", async () => {
        await openBusinessProfile(page);
        expect(await (await teamSizeSelect(page)).inputValue(), "a fresh business has no team size").toBe("");
        await page.getByPlaceholder("Your Business Name").fill(name);
        await page.getByPlaceholder("A short tagline for your business").fill(tagline);
        await page.getByRole("textbox", { name: "Business description" }).fill(description);
        const res = await save(page, owner.businessId);
        expect(res.status(), `PATCH answered ${await res.text()}`).toBe(200);
        await expect(page.getByText("You have unsaved changes")).toHaveCount(0);
        expect(await storedBusiness(request, owner)).toMatchObject({ name, tagline, description, teamSize: null });
      });

      const offered: Array<{ value: string; label: string }> = [];
      await test.step("each team size the form offers is saved", async () => {
        const select = await teamSizeSelect(page);
        for (const o of await select.locator("option").all()) {
          const value = (await o.getAttribute("value")) ?? "";
          if (value) offered.push({ value, label: (await o.textContent())?.trim() ?? value });
        }
        expect(offered.length, "the form offers team sizes").toBeGreaterThanOrEqual(4);
        const refused: string[] = [];
        for (const { value, label } of offered) {
          await select.selectOption(value);
          const res = await save(page, owner.businessId);
          if (res.status() !== 200) refused.push(`'${label}' (${value}): ${res.status()} ${(await res.text()).slice(0, 200)}`);
          else expect((await storedBusiness(request, owner)).teamSize, `'${label}'`).toBe(value);
        }
        expect(refused, "every team size the form offers is saved").toEqual([]);
      });

      await test.step("a reload shows what was saved", async () => {
        await openBusinessProfile(page);
        await expect(page.getByPlaceholder("Your Business Name")).toHaveValue(name);
        await expect(page.getByPlaceholder("A short tagline for your business")).toHaveValue(tagline);
        await expect(page.getByRole("textbox", { name: "Business description" })).toHaveValue(description);
        await expect(await teamSizeSelect(page)).toHaveValue(offered[offered.length - 1].value);
      });
    });

    test("a refused save is said in view, in a toast and beside Save, and keeps what was typed (a STAFF member, D-11)", async ({ browser, request, owner }) => {
      test.setTimeout(3 * 60_000);
      const staff = await memberOf(request, owner, "profile staff");
      const context = await signedInContext(browser, staff, project === "phone"
        ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
        : { viewport });
      const page = await context.newPage();
      const before = await storedBusiness(request, owner);
      const typed = "Typed by staff, kept after the refusal";

      await openBusinessProfile(page);
      await page.getByPlaceholder("A short tagline for your business").fill(typed);
      const res = await save(page, owner.businessId);
      expect(res.status(), "the profile is the owner's (D-11)").toBe(403);
      const reason = ((await res.json()) as { message: string }).message;
      expect(reason).toBe("Only the business owner can edit the business profile");

      const toast = page.locator("[data-sonner-toast]").filter({ hasText: reason });
      await expect(toast, "a toast says why").toBeVisible();

      const alert = page.getByRole("alert").filter({ hasText: reason });
      await expect(alert, "the reason is beside the Save button").toBeVisible();
      await expect.poll(() => inViewport(alert), { message: "the reason is inside the viewport" }).toBe(true);

      await expect(page.getByPlaceholder("A short tagline for your business"), "what was typed is kept").toHaveValue(typed);
      await expect(page.getByText("You have unsaved changes")).toBeVisible();
      await expect(page.getByRole("button", { name: /save business info/i })).toBeEnabled();
      expect((await storedBusiness(request, owner)).tagline, "nothing was written").toBe(before.tagline);
    });
  });
}
