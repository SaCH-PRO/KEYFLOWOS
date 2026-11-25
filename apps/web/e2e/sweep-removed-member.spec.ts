import type { APIRequestContext } from "@playwright/test";
import { test, expect, API_URL, allowBusinessNamed, memberOf, settle, signedInContext } from "./journeys/journey-helpers";

/**
 * SWP-REMOVED-MEMBER-NOTICE, the browser half (BUG-117; journey J8 asserts the same at its step "the member is told
 * they no longer have access"). The jsdom half is src/lib/__tests__/workspace-removed-member.test.ts,
 * src/components/layout/__tests__/removed-business-notice.test.tsx and
 * src/hooks/__tests__/use-genome-gate.removed-notice.test.tsx.
 *
 * A staff member works in the owner's business; the owner removes them. On their next page load:
 *
 *   1. a lasting notice says they no longer have access, naming the owner's business;
 *   2. it is not onboarding: the member is not sent to /app/onboarding for that reason;
 *   3. it is still there a moment later and after another navigation (not a toast), and offers the business they
 *      still have;
 *   4. dismissing it removes it.
 *
 * RED at the base (W11-WEB-OWNER-MEMBERSHIP-REFUSAL 2c3ef7ab): the member is moved silently into their own business
 * and the Business Genome gate sends them to /app/onboarding. Each check is a soft assertion (D-274 A7), so the base
 * run shows every step's own RED. Desktop only; live only (E2E_LIVE=1, the journey harness's fixtures, README in
 * e2e/journeys); run it in the "chromium" project.
 */

const auth = (who: { token: string }) => ({ Authorization: `Bearer ${who.token}` });

async function removeMember(request: APIRequestContext, owner: { token: string; businessId: string }, membershipId: string) {
  const res = await request.fetch(`${API_URL}/identity/businesses/${owner.businessId}/team/${membershipId}`, { method: "DELETE", headers: auth(owner) });
  expect(res.status(), `DELETE team member: ${(await res.text()).slice(0, 300)}`).toBe(200);
}

test.describe("SWP-REMOVED-MEMBER-NOTICE a removed member is told, by name (desktop 1440x900)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("after the owner removes them, the member sees a lasting notice naming the business, not onboarding", async ({ request, owner, browser }) => {
    test.setTimeout(5 * 60_000);
    const staff = await memberOf(request, owner, "removed member sweep", { role: "STAFF", scopes: { bookings: "read", crm: "read" } });
    const desk = await signedInContext(browser, staff);
    allowBusinessNamed(desk, staff.ownBusinessId, "after the removal the member's own business is still theirs");
    const page = await desk.newPage();
    await page.goto("/app/crm/contacts");
    await settle(page, 1_500);

    await removeMember(request, owner, staff.membershipId);

    await test.step("a notice names the business they lost", async () => {
      await page.goto("/app/crm/contacts");
      await settle(page, 3_000);
      const notice = page.getByRole("alert").filter({ hasText: /no longer have access/i });
      await expect.soft(notice, "a notice says they no longer have access").toHaveCount(1);
      await expect.soft(notice).toContainText(owner.businessName);
    });

    await test.step("not onboarding for that reason", async () => {
      expect.soft(new URL(page.url()).pathname, "never onboarding for that reason").not.toMatch(/\/app\/onboarding/);
    });

    await test.step("it lasts: still there after a moment and after another navigation, and offers the business they still have", async () => {
      await settle(page, 6_000);
      const notice = page.getByRole("alert").filter({ hasText: /no longer have access/i });
      await expect.soft(notice, "still there after six seconds (not a toast)").toHaveCount(1);
      await page.goto("/app/bookings");
      await settle(page, 2_000);
      await expect.soft(notice, "still there on the next screen").toHaveCount(1);
      await expect.soft(notice.getByRole("button", { name: /^open /i }), "it offers the business they still have").not.toHaveCount(0);
    });

    await test.step("dismissing it removes it", async () => {
      const notice = page.getByRole("alert").filter({ hasText: /no longer have access/i });
      if (await notice.count()) {
        await notice.getByRole("button", { name: /dismiss/i }).click();
        await expect.soft(notice).toHaveCount(0);
      }
    });

    await desk.close();
  });
});
