import type { Locator, Page } from "@playwright/test";
import { test, expect, settle, memberOf, signedInContext, type Tenant } from "./journeys/journey-helpers";

/**
 * SWP-TEAM-WEB, the browser half (sweep BUG-063, BUG-115, BUG-116, BUG-135; journey J). The jsdom half is
 * src/app/app/settings/team/__tests__/team-page-states.test.tsx; journey J itself is e2e/journeys/j-team.spec.ts.
 *
 * At 375x812 and 1440x900, on Settings > Team (/app/settings/team):
 *
 *   1. BUG-063  a member refused the team read (a front desk: bookings and customers read, no team) sees "No access",
 *               "ask the owner", no Invite and no "0 owner 0 admin 0 staff"
 *   2. BUG-115  after the owner invites an Admin, the invite form's role is Staff again
 *   3. BUG-116  that invite's row says "Invited", and the counts say 0 staff (pending invites are not members)
 *   4. BUG-135  the invite form's permissions toggle reads "Set permissions & approval tier", with its spaces (the
 *               production build showed "Setpermissions & approval tier")
 *
 * Live only (E2E_LIVE=1, a production build, a real API and database: the journey harness's own fixtures, README in
 * e2e/journeys); without E2E_LIVE every case is skipped. Run it in the "chromium" project.
 *
 * Each check is a soft assertion (D-274 A7), so the base run shows every step's own RED, not only the first.
 */

const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;

const WIDTHS = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
];

/** Opens Settings > Team's invite form (its Invite button toggles it) and returns the email field. */
async function openInvite(page: Page): Promise<Locator> {
  const email = page.getByLabel("Team member email");
  if (!(await email.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /^invite$/i }).first().click();
  }
  await expect(email, "the invite form's email field").toBeVisible();
  return email;
}

/** The invite form's role control (member rows carry their own; the invite form's is the first on the page). */
const inviteRole = (page: Page) => page.getByLabel("Select role").first();

async function invite(page: Page, owner: Tenant, address: string, roleLabel?: string): Promise<number> {
  const email = await openInvite(page);
  await email.fill(address);
  if (roleLabel) await inviteRole(page).selectOption({ label: roleLabel });
  const sent = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/identity/businesses/${owner.businessId}/team`,
  );
  await page.getByRole("button", { name: /^send invite$/i }).click();
  return (await sent).status();
}

for (const viewport of WIDTHS) {
  test(`Settings > Team at ${viewport.width}x${viewport.height}`, async ({ page, request, owner, browser }) => {
    test.setTimeout(4 * 60_000);
    await page.setViewportSize(viewport);

    // 1. BUG-063: a member refused the team read.
    const desk = await memberOf(request, owner, "front desk", { role: "STAFF", scopes: { bookings: "read", crm: "read" } });
    const deskContext = await signedInContext(browser, desk);
    const deskPage = await deskContext.newPage();
    await deskPage.setViewportSize(viewport);
    await deskPage.goto("/app/settings/team");
    await settle(deskPage, 2_000);
    const refused = (await deskPage.locator("main").first().innerText().catch(() => "")).replace(/\s+/g, " ");
    test.info().annotations.push({ type: "refused", description: refused.slice(0, 300) });
    expect.soft(refused, "BUG-063: the refused member is told 'No access'").toMatch(/no access/i);
    expect.soft(refused, "BUG-063: and to ask the owner").toMatch(/ask the owner/i);
    expect.soft(refused, "BUG-063: the refusal shown as zero counts").not.toMatch(/\b0 owner\b|no team members yet/i);
    await expect.soft(deskPage.getByRole("button", { name: /^invite$/i }), "BUG-063: Invite for a member refused the team").toHaveCount(0);
    await deskContext.close();

    // 2. BUG-115: the role resets after an Admin invite.
    await page.goto("/app/settings/team");
    await settle(page, 1_500);
    const admin = `ade.${stamp()}@sweep-team.test.local`;
    expect(await invite(page, owner, admin, "Admin"), "the Admin invite").toBe(201);
    await settle(page, 1_000);
    await openInvite(page);
    const shown = await inviteRole(page).evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.text.trim() ?? "");
    expect.soft(shown, "BUG-115: the invite form's role after an Admin invite").toBe("Staff");

    // 3. BUG-116: the pending invite looks pending and is not counted.
    await page.goto("/app/settings/team");
    await settle(page, 1_500);
    const row = page.locator("div").filter({ hasText: admin }).filter({ has: page.getByRole("button", { name: "Remove team member" }) }).last();
    await expect.soft(row, "the invite's row").toBeVisible();
    await expect.soft(row.getByText(/^invited$/i), "BUG-116: the row says Invited").toBeVisible();
    const counts = (await page.locator("main").first().innerText()).replace(/\s+/g, " ");
    expect.soft(counts, "BUG-116: the counts leave the pending Admin out").toMatch(/\b0 admin\b/i);

    // 4. BUG-135: the permissions toggle's words.
    await openInvite(page);
    const names = await page.locator("main button").evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()));
    const toggle = names.find((n) => /permissions\s*&\s*approval tier/i.test(n));
    test.info().annotations.push({ type: "toggle", description: String(toggle) });
    expect.soft(toggle, "BUG-135: the permissions toggle's words").toBe("Set permissions & approval tier");
  });
}
