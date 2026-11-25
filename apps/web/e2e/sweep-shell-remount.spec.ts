import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect, API_URL, settle, type Tenant } from "./journeys/journey-helpers";

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
 *      booking sheet for that contact, and the shell is still the same element.
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

    test("a client navigation keeps the shell, and the Book appointment door's ?contactId opens the booking sheet", async ({ page, request, owner }) => {
      test.setTimeout(4 * 60_000);
      const lastName = `Shell${stamp()}`;
      const contactId = await seedContact(request, owner, lastName);

      await page.goto("/app/crm/contacts");
      await expect(page.locator("main[role=main]"), "the app shell renders once the session is verified").toBeVisible();
      await settle(page, 2_000);

      await test.step("a client navigation between two /app pages keeps the same shell and never shows the spinner", async () => {
        await watchShell(page);
        await routerPush(page, "/app/finance");
        await page.waitForURL(/\/app\/finance(?:[/?#]|$)/);
        await settle(page, 3_000);
        const state = await shellState(page);
        expect(state.marked, "the shell was marked before the navigation").toBe(true);
        expect.soft(state.spinnerSeen, "RequireAuth's 'Verifying session…' spinner showed during a client navigation").toBe(false);
        expect.soft(state.sameShell, "the shell element is the same one after a client navigation (not remounted)").toBe(true);
      });

      await test.step("router.push('/app/bookings?contactId=…') opens the New booking sheet for that contact", async () => {
        await watchShell(page);
        await routerPush(page, `/app/bookings?contactId=${encodeURIComponent(contactId)}`);
        await page.waitForURL(/\/app\/bookings(?:[/?#]|$)/);
        await expect
          .soft(page.getByRole("heading", { name: new RegExp(`New Booking · Remy ${lastName}`) }), "the New booking sheet, for the contact the door named")
          .toBeVisible({ timeout: 20_000 });
        const state = await shellState(page);
        expect.soft(state.spinnerSeen, "RequireAuth's spinner showed during the door's navigation").toBe(false);
        expect.soft(state.sameShell, "the shell element is the same one after the door's navigation").toBe(true);
      });
    });
  });
}
