import { test, expect, memberOf, settle, signedInContext } from "./journeys/journey-helpers";
import type { Page } from "@playwright/test";

/**
 * FU-NOTIFICATIONS-PAGE-REFUSED (owner ruling D-283), the browser half. The jsdom half is
 * src/app/app/settings/notifications/__tests__/notifications-refused-read.test.tsx (NPR-01..06b).
 *
 * The customer-email preferences and log need settings read (@RequireModuleScope('settings', 'read')). A member whose
 * settings access is none can still reach /app/settings/notifications by URL or a bookmark, and the page dropped the
 * two 403s: a blank Preferences tab, and "No customer notifications sent yet" under "Log (0)".
 *
 *   NRS-01 a settings-none STAFF member (the role's default scopes) at /app/settings/notifications: no access, ask the
 *          owner, on the Preferences tab and on the Log tab; never the empty-log text, the Log tab not counted "(0)",
 *          no switch, and nothing scrolls sideways (RED at the base: a blank tab and "No customer notifications sent
 *          yet").
 *   NRS-02 a settings reader (STAFF with settings read) and NRS-03 the owner: the six switches and the log, no
 *          no-access state, nothing scrolls sideways. Repair round 1: each switch and its knob have a real size (RED
 *          on main: the h-5.5 and h-4.5 classes are not Tailwind 3 classes, so the switches render 0px tall).
 *
 * Each at 375, 768, 1024 and 1440. Live: a real API, Postgres and Redis (E2E_LIVE=1, the journey harness's tenants,
 * members and watch; e2e/journeys/README.md and docs/development/agent-memory/LIVE-PROOF-RUNBOOK.md section 3). It is
 * the packet's browser proof, not one of CI's fixed e2e-mocked specs; skipped without E2E_LIVE.
 */

const WIDTHS = [[375, 812], [768, 1024], [1024, 900], [1440, 900]] as const;
const EMPTY_LOG = /no customer notifications sent yet/i;

async function open(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto("/app/settings/notifications");
  await expect(page.getByRole("heading", { name: /customer notifications/i })).toBeVisible({ timeout: 30_000 });
  await settle(page, 1_500);
}

async function noSidewaysScroll(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${what}: the page does not scroll sideways`).toBeLessThanOrEqual(0);
}

/** Each switch, and the knob inside it, is drawn with a real size (a unit test cannot see Tailwind's CSS). */
async function switchesHaveSize(page: Page, what: string): Promise<void> {
  const sizes = await page.getByRole("switch").evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      const knob = el.querySelector("span")?.getBoundingClientRect();
      return { name: el.getAttribute("aria-label"), h: box.height, w: box.width, knobH: knob?.height ?? 0, knobW: knob?.width ?? 0 };
    }),
  );
  expect(sizes, `${what}: six switches`).toHaveLength(6);
  for (const s of sizes) {
    expect(s.h, `${what}: ${s.name} has a height`).toBeGreaterThanOrEqual(20);
    expect(s.w, `${what}: ${s.name} has a width`).toBeGreaterThanOrEqual(36);
    expect(s.knobH, `${what}: ${s.name}'s knob has a height`).toBeGreaterThan(0);
    expect(s.knobW, `${what}: ${s.name}'s knob has a width`).toBeGreaterThan(0);
  }
}

const noAccess = (page: Page) => page.locator('[data-state="no-access"]').filter({ visible: true });
const logTab = (page: Page) => page.getByRole("button", { name: /^log\b/i });

test.describe("D-283: Settings > Notifications says no access on a refused read, not 'nothing sent'", () => {
  test("NRS-01 a settings-none member sees no access on both tabs, never 'nothing sent'", async ({ request, owner, browser }, info) => {
    test.setTimeout(4 * 60_000);
    const staff = await memberOf(request, owner, "front desk", { role: "STAFF" });
    expect(staff.scopes?.settings ?? "none", "the STAFF default grants no settings access").toBe("none");
    const desk = await signedInContext(browser, staff);
    const page = await desk.newPage();
    for (const [width, height] of WIDTHS) {
      await test.step(`at ${width}px`, async () => {
        await open(page, width, height);
        await expect(noAccess(page)).toHaveCount(1);
        await expect(noAccess(page)).toContainText(/no access - ask the owner/i);
        await expect(noAccess(page)).toContainText(/settings requires read access/i);
        await expect(page.getByRole("switch")).toHaveCount(0);
        await expect(logTab(page)).toHaveText(/^log$/i);
        await page.screenshot({ path: info.outputPath(`refused-preferences-${width}.png`), fullPage: true });
        await noSidewaysScroll(page, `preferences at ${width}`);

        await logTab(page).click();
        await expect(noAccess(page)).toHaveCount(1);
        await expect(noAccess(page)).toContainText(/no access - ask the owner/i);
        await expect(page.getByText(EMPTY_LOG)).toHaveCount(0);
        await expect(page.getByRole("alert").filter({ hasText: /couldn't load/i })).toHaveCount(0);
        await page.screenshot({ path: info.outputPath(`refused-log-${width}.png`), fullPage: true });
        await noSidewaysScroll(page, `log at ${width}`);
      });
    }
  });

  for (const who of ["settings reader", "owner"] as const) {
    test(`${who === "owner" ? "NRS-03" : "NRS-02"} the ${who} still sees the preferences and the log`, async ({ request, owner, browser, page: ownerPage }, info) => {
      test.setTimeout(4 * 60_000);
      let page = ownerPage;
      if (who === "settings reader") {
        const reader = await memberOf(request, owner, "settings reader", { role: "STAFF", scopes: { settings: "read" } });
        page = await (await signedInContext(browser, reader)).newPage();
      }
      for (const [width, height] of WIDTHS) {
        await test.step(`at ${width}px`, async () => {
          await open(page, width, height);
          await expect(page.getByRole("switch")).toHaveCount(6);
          await expect(noAccess(page)).toHaveCount(0);
          await expect(logTab(page)).toHaveText(/^log \(\d+\)$/i);
          await switchesHaveSize(page, `${who} at ${width}`);
          await page.screenshot({ path: info.outputPath(`${who.replace(" ", "-")}-preferences-${width}.png`), fullPage: true });
          await noSidewaysScroll(page, `${who} preferences at ${width}`);
          await logTab(page).click();
          await expect(noAccess(page)).toHaveCount(0);
          await expect(page.getByRole("alert").filter({ hasText: /couldn't load/i })).toHaveCount(0);
          await page.screenshot({ path: info.outputPath(`${who.replace(" ", "-")}-log-${width}.png`), fullPage: true });
          await noSidewaysScroll(page, `${who} log at ${width}`);
        });
      }
    });
  }
});
