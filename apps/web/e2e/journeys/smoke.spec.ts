import {
  test,
  expect,
  VARIANT,
  coveredButtonFindings,
  keyUiFindings,
  recordLoadTiming,
  settle,
} from "./journey-helpers";

/**
 * GATE-HARNESS smoke journey: the harness end to end, on each project (phone
 * 375x812, desktop 1440x900) and in each variant (E2E_VARIANT).
 *
 *   1. A fresh owner, signed in as the journeys sign one in, opens Today.
 *   2. Under KEY_DISABLED no KEY UI renders: no KEY bubble, no header
 *      'Ask KEY' button, no KEY drawer opening by itself, and Ctrl+J / Cmd+J
 *      open nothing (journey K, KEY-off; SWP-KEY-SHELL-SMOKE).
 *   3. Nothing covers a primary button (intuitiveness principle "Nothing covers
 *      the primary button, and nothing opens by itself"; journey F "No primary
 *      button is covered at any point"): Today's header "New" once the shell
 *      has settled, and "Create" on the calendar's New event sheet.
 *   4. Today's load on throttled 3G is recorded against the 3 s budget
 *      (tracked, not pass/fail).
 *
 * Expected RED until SWP-LAYERS (bubble and banner unmounted, one z-index
 * layer contract) and SWP-KEY-SHELL-SMOKE (no KEY UI under KEY_DISABLED, the
 * drawer never opens by itself) land: the run records which KEY UI renders and
 * what covers each button, per project.
 */

test.describe("journey harness smoke", () => {
  test("a fresh owner opens Today; no KEY UI under KEY_DISABLED; nothing covers a primary button", async ({ page, owner }, testInfo) => {
    test.setTimeout(6 * 60_000);

    await test.step("Today opens for a fresh, onboarded tenant", async () => {
      await page.goto("/app");
      await page.waitForURL(/\/app\/command-center/);
      expect(await page.evaluate(() => window.localStorage.getItem("kf_business_id"))).toBe(owner.businessId);
      await settle(page);
    });

    await test.step(`no KEY UI renders (${VARIANT === "key-disabled" ? "KEY_DISABLED: required" : `${VARIANT}: recorded only`})`, async () => {
      const findings = await keyUiFindings(page);
      testInfo.annotations.push({ type: "key-ui", description: findings.length ? findings.join("; ") : "none" });
      if (VARIANT === "key-disabled") expect.soft(findings, "KEY UI under KEY_DISABLED").toEqual([]);
    });

    await test.step("nothing covers Today's header New button once the shell has settled", async () => {
      await page.goto("/app/command-center");
      await settle(page);
      const findings = await coveredButtonFindings([
        { what: "Today's header 'New' button", locator: page.getByRole("button", { name: /^new\b/i }).filter({ visible: true }).first() },
      ]);
      expect.soft(findings, "covered primary buttons on Today").toEqual([]);
    });

    await test.step("nothing covers Create on the calendar's New event sheet", async () => {
      await page.goto("/app/schedule/calendar");
      await settle(page, 1_000);
      // Close anything that opened by itself first (recorded above), so the sheet is reachable.
      const closeKey = page.getByRole("button", { name: "Close chat" }).filter({ visible: true });
      if (await closeKey.count()) await closeKey.first().click();
      await page.getByRole("button", { name: /^create$/i }).filter({ visible: true }).first().click();
      const sheet = page.getByRole("dialog", { name: "New event" });
      await expect(sheet).toBeVisible();
      // The sheet slides in; measure where it comes to rest.
      await page.waitForTimeout(800);
      const create = sheet.getByRole("button", { name: /^create$/i });
      const findings = await coveredButtonFindings([{ what: "the New event sheet's 'Create' button", locator: create }]);
      expect.soft(findings, "covered primary buttons on the New event sheet").toEqual([]);
    });

    await test.step("Today's load on throttled 3G (tracked against the 3 s budget, not pass/fail)", async () => {
      await recordLoadTiming(page, testInfo, "today", "/app/command-center", (p) =>
        p.getByRole("button", { name: /^new\b/i }).filter({ visible: true }).first().waitFor({ state: "visible", timeout: 120_000 }),
      );
    });
  });
});
