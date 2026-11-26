import { test, expect, type Locator, type Page, type Route } from "@playwright/test";
import { TEST_BUSINESS_ID, e2eBaseURL, mockBaseLayout, mockCatchAll } from "./helpers/workspace";

/**
 * FU-UNDO-TOAST-SIGNOUT (owner ruling D-283): the bulk-delete Undo toast lives in the app-wide Toaster and outlived a
 * sign-out (sign-out navigates in place), so its "Deleted 2 contacts" stayed in front of the next person in the tab.
 * Toasts now end with the session that raised them. The jsdom halves: src/lib/__tests__/workspace-session-toasts
 * (UTS), src/hooks/__tests__/use-app-layout-logout-toasts (LOT), src/components/__tests__/require-auth-session-toasts
 * (RAT).
 *
 *   UTB-01 two customers are deleted, the toast offers Undo; the member logs out (the header's user menu, or the
 *          drawer from the bottom bar's More at phone width): sign-in opens and neither the toast's text nor its Undo is on screen.
 *          RED at the base: the toast is still up on the sign-in page.
 *   UTB-02 two customers are deleted, the toast offers Undo; another person signs in in another tab of the browser
 *          (the shared kf_token changes to their token): the toast's text and its Undo are gone from this tab.
 *          RED at the base: the toast stays over the shell's "Verifying session…".
 *
 * Run at 375, 768 and 1440 (the sign-out door moves from the drawer to the header's user menu).
 *
 * Mocked: every API call is answered by page.route on api.test.local; skipped under E2E_LIVE.
 *   pnpm run build (NEXT_PUBLIC_API_BASE_URL=http://api.test.local), then
 *   E2E_WEB_COMMAND=standalone E2E_PORT=5300 pnpm exec playwright test e2e/sweep-undo-toast-signout.spec.ts --project=chromium
 */

test.skip(process.env.E2E_LIVE === "1", "mocked sweep: runs without a live API");

const ALL = ["crm", "revenue", "bookings", "projects", "content", "expenses", "automations", "storefront", "settings", "ai", "team", "analytics", "operations", "connect"];

/** The edge middleware lets /app/* through only with a JWT-shaped kf_token; the mocked API never checks it. */
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwtFor = (sub: string) =>
  `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.e2e`;
const MEMBER_TOKEN = jwtFor("user_e2e");
const OTHER_TOKEN = jwtFor("user_other_person");

const CUSTOMERS = [
  { id: "ct_uts_ana", firstName: "Ana", lastName: "Toasted" },
  { id: "ct_uts_ben", firstName: "Ben", lastName: "Toasted" },
  { id: "ct_uts_cal", firstName: "Cal", lastName: "Keeper" },
];
const PICKED = CUSTOMERS.slice(0, 2);
const name = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`;
const DELETE_PATH = `/crm/businesses/${TEST_BUSINESS_ID}/contacts/bulk`;
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

function subOfBearer(auth: string | undefined): string | null {
  try {
    const token = (auth ?? "").replace(/^Bearer /, "");
    return (JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
}

/** Signs the member in (this page only: another tab opened later starts with the browser's storage as it is). */
async function openCustomers(page: Page): Promise<void> {
  await page.context().addCookies([{ name: "kf_token", value: MEMBER_TOKEN, url: e2eBaseURL(), sameSite: "Lax" }]);
  await page.addInitScript(
    ({ token, businessId }) => {
      if (window.sessionStorage.getItem("uts_seeded")) return;
      window.sessionStorage.setItem("uts_seeded", "1");
      window.localStorage.setItem("kf_token", token);
      window.localStorage.setItem("kf_business_id", businessId);
    },
    { token: MEMBER_TOKEN, businessId: TEST_BUSINESS_ID },
  );
  await mockCatchAll(page);
  await mockBaseLayout(page, { business: { sells: "services", advancedCrm: false } });
  // /identity/me names whoever the bearer is (the helper's answer names one user for every token).
  await page.route("**/identity/me", (route: Route) => {
    const sub = subOfBearer(route.request().headers()["authorization"]);
    return sub ? json(route, 200, { id: sub, email: `${sub}@uts.example`, name: sub }) : json(route, 401, {});
  });
  await page.route(/\/identity\/businesses(\?.*)?$/, (route: Route) => json(route, 200, [{ id: TEST_BUSINESS_ID, name: "E2E Test Business" }]));
  await page.route(`**/identity/businesses/${TEST_BUSINESS_ID}/my-access**`, (route: Route) =>
    json(route, 200, { modules: Object.fromEntries(ALL.map((m) => [m, "write"])) }),
  );
  await page.route(`**/onboarding-concierge/businesses/${TEST_BUSINESS_ID}/onboarding-state**`, (route: Route) =>
    json(route, 200, { onboardingComplete: true, onboardingCompletedAt: new Date().toISOString(), threePillarMet: true, step: "complete" }),
  );

  const trashed = new Set<string>();
  const now = new Date().toISOString();
  await page.route(new RegExp(`/crm/businesses/${TEST_BUSINESS_ID}/contacts(\\?.*)?$`), (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const contacts = CUSTOMERS.filter((c) => !trashed.has(c.id)).map((c) => ({
      ...c,
      email: `${c.firstName.toLowerCase()}@uts.example`,
      status: "LEAD",
      tags: [],
      createdAt: now,
      updatedAt: now,
    }));
    return json(route, 200, { contacts, nextCursor: null, hasMore: false });
  });
  await page.route(new RegExp(`${DELETE_PATH}$`), (route: Route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    const ids = ((route.request().postDataJSON() as { contactIds?: string[] })?.contactIds ?? []).filter((id) => CUSTOMERS.some((c) => c.id === id));
    ids.forEach((id) => trashed.add(id));
    return json(route, 200, { deleted: ids.length });
  });

  await page.goto(`/app/crm/contacts?view=table`);
  await expect(checkbox(page, CUSTOMERS[2]).first()).toBeVisible({ timeout: 30_000 });
}

const checkbox = (page: Page, c: { firstName: string; lastName: string }): Locator =>
  page.getByRole("checkbox", { name: `Select ${name(c)}` }).filter({ visible: true });

/** Deletes the two picked customers from the table view and waits for the toast that offers Undo. */
async function deleteTwo(page: Page): Promise<void> {
  for (const c of PICKED) await checkbox(page, c).first().check();
  await page.getByRole("button", { name: `Delete ${PICKED.length} selected contacts` }).filter({ visible: true }).first().click();
  await page.getByPlaceholder('Type "DELETE" to confirm').fill("DELETE");
  await page.getByRole("button", { name: new RegExp(`^delete ${PICKED.length} contacts$`, "i") }).click();
  await page.getByRole("dialog").filter({ hasText: "Delete Contacts" }).getByRole("button", { name: /^delete$/i }).click();
  await expect(toastText(page), "the toast says what was deleted").toBeVisible({ timeout: 10_000 });
  await expect(undoButton(page), "and offers Undo").toHaveCount(1, { timeout: 5_000 });
}

const toastText = (page: Page) => page.locator("[data-sonner-toast]").filter({ hasText: /Deleted 2 contacts/ }).first();
const undoButton = (page: Page) => page.getByRole("button", { name: /^undo$/i }).filter({ visible: true });

/**
 * Logs out as the member would at this width: the header's user menu, or at phone width the drawer, opened from the
 * bottom bar's More (the toast spans the top of a phone screen and covers the header's menu button).
 */
async function logOut(page: Page, width: number): Promise<void> {
  if (width < 640) {
    await page.getByRole("button", { name: "More", exact: true }).filter({ visible: true }).first().click();
    await page.getByRole("button", { name: /^log out$/i }).filter({ visible: true }).first().click();
  } else {
    await page.getByRole("button", { name: "User menu" }).filter({ visible: true }).first().click();
    await page.getByRole("menuitem", { name: /^log out$/i }).click();
  }
}

for (const width of [375, 768, 1440]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 600 ? 812 : 900 } });

    test(`UTB-01 logging out takes the Undo toast with it (${width})`, async ({ page }) => {
      await openCustomers(page);
      await deleteTwo(page);
      await logOut(page, width);
      await page.waitForURL(/\/auth\/login/, { timeout: 15_000 });
      await expect(toastText(page), "the deleted-contacts toast is not left for the next person").toHaveCount(0, { timeout: 3_000 });
      await expect(undoButton(page), "nor its Undo").toHaveCount(0);
    });

    test(`UTB-02 another person signing in in another tab takes the Undo toast with it (${width})`, async ({ page }) => {
      await openCustomers(page);
      await deleteTwo(page);
      const other = await page.context().newPage();
      await other.goto("/auth/login");
      // The other person's sign-in stores their token in the browser's shared storage (this tab gets the storage event).
      await other.evaluate((token) => window.localStorage.setItem("kf_token", token), OTHER_TOKEN);
      await expect(toastText(page), "the deleted-contacts toast is not shown to the other person").toHaveCount(0, { timeout: 3_000 });
      await expect(undoButton(page), "nor its Undo").toHaveCount(0);
      await other.close();
    });
  });
}
