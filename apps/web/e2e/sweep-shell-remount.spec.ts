import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect, API_URL, mintToken, settle, type Tenant } from "./journeys/journey-helpers";

/**
 * FU-REQUIRE-AUTH-REMOUNT, the browser half (owner ruling D-281; journeys C, D, F). The jsdom half is
 * src/components/__tests__/require-auth-remount.test.tsx.
 *
 * RequireAuth (components/require-auth.tsx) wraps the whole /app shell. Before the fix it verified the session again
 * on every pathname change: each client navigation put its "Verifying session…" spinner in place of the shell, the
 * shell and the destination page mounted again, and a page that reads and strips a one-shot ?contactId on mount lost
 * it on the second mount. On a production build against the live API, at a phone (375x812) and a desktop
 * (1440x900) width:
 *
 *   1. a client navigation (router.push, as the app's own doors do) between two /app pages keeps the same shell
 *      element and never shows the spinner;
 *   2. the contacts screens' Book appointment door, router.push('/app/bookings?contactId=<id>'), opens the New
 *      booking sheet for that contact (the bookings page reads and strips ?contactId once, on mount), and the shell is
 *      still the same element.
 *
 * Two mechanisms mounted the destination page twice: RequireAuth's teardown (src/components/__tests__/
 * require-auth-remount.test.tsx) and PageTransition's exit wrapper, which renders the current route while it fades
 * out (src/components/transitions/__tests__/page-transition-single-mount.test.tsx). Observed live: at the base build
 * step 1 fails (spinner, new shell) and step 2 passes (the teardown's fresh shell mounts the page once more, at rest);
 * with the RequireAuth fix alone step 2 fails; with both fixes both pass.
 *
 * Not here: the contacts' Create quote door (/app/commerce?tab=billing&segment=quotes&contactId=) opens no New quote
 * form on main even on a full page load (the URL becomes ?tab=snapshot), so it cannot show a remount; it is a defect
 * of its own (the WhatsApp capture web branch carries a fix for its ?tab=quotes form).
 *
 * Review repair round 1 (correctness MAJOR-1): a rotation of the same user's token (refreshAccessToken, on a 401 or
 * at access-token expiry) must not tear the shell down either. The rotation is produced live by writing a token
 * minted for the same `sub` (journey-helpers mintToken, the harness's own signing secret) into kf_token:
 *
 *   3. in this tab (no storage event), then the Book appointment door: one shell, no spinner, the sheet opens, and
 *      /identity/me is asked in the background with the rotated bearer;
 *   4. from another tab of the same browser (the storage event): this tab keeps its shell and the open booking sheet.
 *
 * router.push is the app router's own (window.next.router, which Next sets in the browser), so the navigation is the
 * one every <Link> and useRouter().push makes. Live only (E2E_LIVE=1, the journey harness's fixtures, README in
 * e2e/journeys); run it in the "chromium" project.
 */

function stamp(): string {
  return Date.now().toString(36).slice(-5);
}

async function seedContact(request: APIRequestContext, owner: Tenant, lastName: string): Promise<string> {
  const res = await request.post(`${API_URL}/crm/businesses/${owner.businessId}/contacts`, {
    headers: { Authorization: `Bearer ${owner.token}` },
    data: { firstName: "Remy", lastName },
  });
  const body = await res.text();
  expect(res.status(), `POST contact: ${body.slice(0, 300)}`).toBe(201);
  return (JSON.parse(body) as { id: string }).id;
}

/** Marks the shell element now on screen, and records from here on whether RequireAuth's spinner ever shows. */
async function watchShell(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __kfShell?: Element | null; __kfSpinnerSeen?: boolean; __kfObserver?: MutationObserver };
    w.__kfShell = document.querySelector("main[role=main]");
    w.__kfSpinnerSeen = false;
    w.__kfObserver?.disconnect();
    w.__kfObserver = new MutationObserver(() => {
      if (document.body.textContent?.includes("Verifying session")) w.__kfSpinnerSeen = true;
    });
    w.__kfObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}

async function shellState(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __kfShell?: Element | null; __kfSpinnerSeen?: boolean };
    const now = document.querySelector("main[role=main]");
    return { marked: !!w.__kfShell, sameShell: !!now && now === w.__kfShell, spinnerSeen: !!w.__kfSpinnerSeen };
  });
}

/** Writes kf_token as refreshAccessToken does (localStorage; in this tab no storage event fires). */
async function storeToken(page: Page, token: string) {
  await page.evaluate((t) => window.localStorage.setItem("kf_token", t), token);
}

async function routerPush(page: Page, href: string) {
  await page.evaluate((to) => {
    const next = (window as unknown as { next?: { router?: { push: (href: string) => void } } }).next;
    if (!next?.router) throw new Error("window.next.router is missing: not the app router's client");
    next.router.push(to);
  }, href);
}

for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
  test.describe(`FU-REQUIRE-AUTH-REMOUNT the shell is not torn down on a page change (${viewport.width}x${viewport.height})`, () => {
    test.use(viewport.width < 600 ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport });

    test("a client navigation or a same-user token rotation keeps the shell, and the Book appointment door's ?contactId opens the booking sheet", async ({ page, request, owner }) => {
      test.setTimeout(4 * 60_000);
      const lastName = `Shell${stamp()}`;
      const contactId = await seedContact(request, owner, lastName);

      await page.goto("/app/crm/contacts");
      await expect(page.locator("main[role=main]"), "the app shell renders once the session is verified").toBeVisible();
      await settle(page, 2_000);

      await test.step("a client navigation between two /app pages keeps the same shell and never shows the spinner", async () => {
        await watchShell(page);
        // Money (/app/finance answers with a redirect to /app/financial-flow; this goes to the page itself).
        await routerPush(page, "/app/financial-flow");
        await page.waitForURL(/\/app\/financial-flow(?:[/?#]|$)/, { timeout: 30_000 });
        await settle(page, 3_000);
        const state = await shellState(page);
        expect(state.marked, "the shell was marked before the navigation").toBe(true);
        expect.soft(state.spinnerSeen, "RequireAuth's 'Verifying session…' spinner showed during a client navigation").toBe(false);
        expect.soft(state.sameShell, "the shell element is the same one after a client navigation (not remounted)").toBe(true);
      });

      await test.step("router.push('/app/bookings?contactId=…') opens the New booking sheet for that contact", async () => {
        await watchShell(page);
        await routerPush(page, `/app/bookings?contactId=${encodeURIComponent(contactId)}`);
        await page.waitForURL(/\/app\/bookings(?:[/?#]|$)/, { timeout: 30_000 });
        await expect
          .soft(page.getByRole("heading", { name: new RegExp(`New Booking · Remy ${lastName}`) }), "the New booking sheet, for the contact the door named")
          .toBeVisible({ timeout: 20_000 });
        const state = await shellState(page);
        expect.soft(state.spinnerSeen, "RequireAuth's spinner showed during the door's navigation").toBe(false);
        expect.soft(state.sameShell, "the shell element is the same one after the door's navigation").toBe(true);
      });

      await test.step("a same-user token rotation in this tab, then the Book appointment door: one shell, the sheet opens", async () => {
        await routerPush(page, "/app/crm/contacts");
        await page.waitForURL(/\/app\/crm\/contacts(?:[/?#]|$)/, { timeout: 30_000 });
        await settle(page, 2_000);
        await watchShell(page);
        const rotated = mintToken(owner.sub, owner.email, 4 * 3600 + 120);
        expect(rotated, "a token other than the one the session started with").not.toBe(owner.token);
        const askedWithRotated = page
          .waitForRequest((r) => new URL(r.url()).pathname === "/identity/me" && r.headers()["authorization"] === `Bearer ${rotated}`, { timeout: 20_000 })
          .then(() => true, () => false);
        await storeToken(page, rotated);
        await routerPush(page, `/app/bookings?contactId=${encodeURIComponent(contactId)}`);
        await page.waitForURL(/\/app\/bookings(?:[/?#]|$)/, { timeout: 30_000 });
        await expect
          .soft(page.getByRole("heading", { name: new RegExp(`New Booking · Remy ${lastName}`) }), "the New booking sheet after a same-user rotation")
          .toBeVisible({ timeout: 20_000 });
        expect.soft(await askedWithRotated, "/identity/me asked with the rotated bearer (the background re-verify)").toBe(true);
        const state = await shellState(page);
        expect.soft(state.spinnerSeen, "RequireAuth's spinner showed after a same-user rotation").toBe(false);
        expect.soft(state.sameShell, "the shell element is the same one after a same-user rotation and the door").toBe(true);
      });

      await test.step("another tab rotates the same user's token: this tab keeps its shell and the open booking sheet", async () => {
        await watchShell(page);
        const rotatedAgain = mintToken(owner.sub, owner.email, 4 * 3600 + 240);
        const other = await page.context().newPage();
        await other.goto("/");
        await storeToken(other, rotatedAgain); // this tab receives the storage event
        await settle(page, 3_000);
        await other.close();
        await expect
          .soft(page.getByRole("heading", { name: new RegExp(`New Booking · Remy ${lastName}`) }), "the open booking sheet survives another tab's rotation")
          .toBeVisible({ timeout: 5_000 });
        const state = await shellState(page);
        expect.soft(state.spinnerSeen, "RequireAuth's spinner showed after another tab's same-user rotation").toBe(false);
        expect.soft(state.sameShell, "the shell element is the same one after another tab's same-user rotation").toBe(true);
      });
    });
  });
}
