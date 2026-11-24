import type { Page, Request } from "@playwright/test";
import { test, expect, settle } from "./journeys/journey-helpers";

/**
 * SWP-KEY-CHAT-WEB (sweep BUG-040, BUG-042, BUG-043), live, at both widths, in the KEY-on variants.
 *
 *   - BUG-040: the drawer's Send button posts the typed text (it passed its click event, and .trim() threw).
 *   - BUG-042: an open drawer reads GET flow/sessions once, not in a loop.
 *   - BUG-043: keeping the chat at its newest message scrolls only the messages, never the app's own scroll root
 *     ([data-scroll-root="app"], app/app/layout.tsx): on onboarding that scroll hid "Set up manually" (D-03).
 *
 * The answer itself is not under test (AI is off in the ai-disabled variant; the reply may be a refusal): what the
 * button sends, how often the history reads, and what scrolls.
 */

const VARIANT = process.env.E2E_VARIANT ?? "ai-disabled";
const isChatPost = (r: Request) => r.method() === "POST" && /\/ai\/businesses\/[^/]+\/(flow\/)?chat(\/stream)?$/.test(new URL(r.url()).pathname);
const isSessionsRead = (r: Request) => r.method() === "GET" && /\/flow\/sessions$/.test(new URL(r.url()).pathname);

const drawer = (page: Page) => page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Send" }) }).filter({ visible: true }).last();

/** Today with the KEY drawer open (header button, else Ctrl+J), and its composer visible. */
async function openDrawer(page: Page): Promise<void> {
  await page.goto("/app/command-center");
  await settle(page, 1_500);
  if (!(await drawer(page).count())) {
    const door = page.locator("header, [role=banner]").getByRole("button", { name: /ask key|^key\b/i }).filter({ visible: true });
    if (await door.count()) await door.first().click();
    else await page.keyboard.press("Control+j");
  }
  await expect(drawer(page).getByRole("textbox").first(), "the KEY drawer's composer").toBeVisible({ timeout: 15_000 });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test.describe(`SWP-KEY-CHAT-WEB the KEY drawer (${viewport.width}x${viewport.height})`, () => {
    test.use(viewport.width < 600 ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport });
    test.skip(VARIANT === "key-disabled", "the drawer is off under KEY_DISABLED (journey K1 holds that)");

    test("Send posts the typed text; the history reads once; only the messages scroll", async ({ page, owner }) => {
      void owner;
      test.setTimeout(3 * 60_000);
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      const sessionReads: string[] = [];
      page.on("request", (r) => {
        if (isSessionsRead(r)) sessionReads.push(new URL(r.url()).pathname);
      });

      await openDrawer(page);

      await test.step("BUG-042: the open drawer reads its sessions at most once in 5 s", async () => {
        const before = sessionReads.length;
        await page.waitForTimeout(5_000);
        expect.soft(sessionReads.length - before, `GET flow/sessions while the drawer sat open (${sessionReads.length} in all)`).toBeLessThanOrEqual(1);
      });

      const root = page.locator('[data-scroll-root="app"]').first();
      const rootTopBefore = await root.evaluate((el) => el.scrollTop).catch(() => 0);

      await test.step("BUG-040: Send posts exactly the typed text, with no page error", async () => {
        const text = `Who owes me money? ${Date.now().toString(36)}`;
        await drawer(page).getByRole("textbox").first().fill(text);
        const posted = page.waitForRequest(isChatPost, { timeout: 15_000 }).catch(() => null);
        await drawer(page).getByRole("button", { name: "Send" }).click();
        const req = await posted;
        expect(req, "Send posts the chat").not.toBeNull();
        const body = (req?.postDataJSON() ?? {}) as { message?: unknown };
        expect(body.message, "the posted message is the typed text").toBe(text);
        await page.waitForTimeout(1_000);
        expect(pageErrors.filter((m) => /trim is not a function|TypeError/.test(m)), "no TypeError on Send").toEqual([]);
      });

      await test.step("BUG-043: the reply's arrival does not scroll the app's own scroll root", async () => {
        await page.waitForTimeout(2_000);
        const rootTopAfter = await root.evaluate((el) => el.scrollTop).catch(() => 0);
        expect.soft(rootTopAfter, "the app root did not move while the chat kept to its newest message").toBe(rootTopBefore);
      });
    });
  });
}
