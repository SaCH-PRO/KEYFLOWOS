import { test, expect, type Locator, type Page, type Request, type Route } from "@playwright/test";
import { TEST_BUSINESS_ID, e2eBaseURL, mockBaseLayout, mockCatchAll, seedWorkspace } from "./helpers/workspace";

/**
 * FU-BULK-DELETE-UNDO, the web half (owner ruling D-277b): "a bulk delete is sent at once, then a toast offers Undo,
 * which restores exactly those customers from Trash in one call. There is no delayed send, so leaving the page can
 * never drop it." The jsdom half is src/app/app/crm/pipeline/hooks/__tests__/bulk-delete-undo.test.tsx (BDU-01..10).
 *
 * The customers screen has two bulk deletes, and each is driven here: the list view (select mode, BulkActionBar,
 * the screen's confirm dialog) and the table view (row checkboxes, DatabaseBulkBar, the table's confirm dialog).
 *
 *   BDB-01 two of three customers are selected and deleted: one DELETE /crm/businesses/:b/contacts/bulk is sent with
 *          exactly those two ids, and they leave the list; a toast offers Undo (RED at the base: the toast has no
 *          Undo); Undo sends one POST /api/businesses/:b/trash/contact/bulk-restore with exactly those two ids, the
 *          toast says they were restored, and the list shows them again.
 *
 * Run at 375, 768, 1024 and 1440 (the bulk bars and the shell's rail change between them).
 *
 * Mocked: every API call is answered by page.route on api.test.local (the contacts list, the delete and the restore
 * share one in-memory Trash); skipped under E2E_LIVE.
 *   pnpm run build (NEXT_PUBLIC_API_BASE_URL=http://api.test.local), then
 *   E2E_WEB_COMMAND=standalone E2E_PORT=5200 pnpm exec playwright test e2e/sweep-bulk-delete-undo.spec.ts --project=chromium
 */

test.skip(process.env.E2E_LIVE === "1", "mocked sweep: runs without a live API");

const ALL = ["crm", "revenue", "bookings", "projects", "content", "expenses", "automations", "storefront", "settings", "ai", "team", "analytics", "operations", "connect"];

/**
 * The edge middleware lets /app/* through only with a JWT-shaped kf_token (three parts, not expired); the helpers'
 * TEST_TOKEN is not one, so this spec stores an unsigned JWT-shaped token over it (the mocked API never checks it).
 */
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT_SHAPED = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub: "user_e2e", exp: Math.floor(Date.now() / 1000) + 3600 })}.e2e`;

const CUSTOMERS = [
  { id: "ct_bdb_ana", firstName: "Ana", lastName: "Undoable" },
  { id: "ct_bdb_ben", firstName: "Ben", lastName: "Undoable" },
  { id: "ct_bdb_cal", firstName: "Cal", lastName: "Keeper" },
];
const PICKED = CUSTOMERS.slice(0, 2);
const name = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`;

type View = "list" | "table";

/** A customer as each view shows it: the list's card prints the full name; the table has a "Select <name>" checkbox per row. */
function customer(page: Page, view: View, c: { firstName: string; lastName: string }): Locator {
  const shown = view === "list" ? page.getByText(name(c), { exact: true }) : page.getByRole("checkbox", { name: `Select ${name(c)}` });
  return shown.filter({ visible: true });
}

const DELETE_PATH = `/crm/businesses/${TEST_BUSINESS_ID}/contacts/bulk`;
const RESTORE_PATH = `/api/businesses/${TEST_BUSINESS_ID}/trash/contact/bulk-restore`;
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Signs in and serves the contacts list, the bulk delete and the bulk restore over one in-memory Trash. */
async function openCustomers(page: Page, view: View): Promise<void> {
  await seedWorkspace(page.context());
  await page.context().addCookies([{ name: "kf_token", value: JWT_SHAPED, url: e2eBaseURL(), sameSite: "Lax" }]);
  await page.context().addInitScript((token) => window.localStorage.setItem("kf_token", token), JWT_SHAPED);
  await mockCatchAll(page);
  await mockBaseLayout(page, { business: { sells: "services", advancedCrm: false } });
  await page.route(/\/identity\/businesses(\?.*)?$/, (route: Route) => json(route, 200, [{ id: TEST_BUSINESS_ID, name: "E2E Test Business" }]));
  await page.route(`**/identity/businesses/${TEST_BUSINESS_ID}/my-access**`, (route: Route) =>
    json(route, 200, { modules: Object.fromEntries(ALL.map((m) => [m, "write"])) }),
  );
  // An onboarded business: the genome gate (hooks/use-genome-gate.ts) keeps the screen instead of sending it to onboarding.
  await page.route(`**/onboarding-concierge/businesses/${TEST_BUSINESS_ID}/onboarding-state**`, (route: Route) =>
    json(route, 200, { onboardingComplete: true, onboardingCompletedAt: new Date().toISOString(), threePillarMet: true, step: "complete" }),
  );

  const trashed = new Set<string>();
  const now = new Date().toISOString();
  await page.route(new RegExp(`/crm/businesses/${TEST_BUSINESS_ID}/contacts(\\?.*)?$`), (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const contacts = CUSTOMERS.filter((c) => !trashed.has(c.id)).map((c) => ({
      ...c,
      email: `${c.firstName.toLowerCase()}@bdb.example`,
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
  await page.route(new RegExp(`${RESTORE_PATH}$`), (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const ids = (route.request().postDataJSON() as { ids?: string[] })?.ids ?? [];
    const restored = ids.filter((id) => trashed.delete(id));
    const failed = ids.filter((id) => !restored.includes(id)).map((id) => ({ id, code: "not_found", message: "Trashed contact not found" }));
    return json(route, 200, { model: "contact", restored, failed, restoredCount: restored.length, failedCount: failed.length });
  });

  await page.goto(`/app/crm/contacts?view=${view}`);
  await expect(customer(page, view, CUSTOMERS[2]).first()).toBeVisible({ timeout: 30_000 });
}

/** Picks the two customers and confirms the delete, as each view's bulk bar and dialogs ask. */
async function deletePicked(page: Page, view: View): Promise<Request> {
  if (view === "list") {
    await page.getByRole("button", { name: "Select contacts", exact: true }).filter({ visible: true }).first().click();
    for (const c of PICKED) {
      await page.getByRole("option").filter({ hasText: name(c) }).getByRole("checkbox").filter({ visible: true }).first().check();
    }
  } else {
    for (const c of PICKED) {
      await customer(page, view, c).first().check();
    }
  }
  await page.getByRole("button", { name: `Delete ${PICKED.length} selected contacts` }).filter({ visible: true }).first().click();
  await page.getByPlaceholder('Type "DELETE" to confirm').fill("DELETE");
  await page.getByRole("button", { name: new RegExp(`^delete ${PICKED.length} contacts$`, "i") }).click();
  const sent = page.waitForRequest((r) => r.method() === "DELETE" && new URL(r.url()).pathname === DELETE_PATH);
  await page.getByRole("dialog").filter({ hasText: "Delete Contacts" }).getByRole("button", { name: /^delete$/i }).click();
  return sent;
}

for (const width of [375, 768, 1024, 1440]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 600 ? 812 : 900 } });

    for (const view of ["list", "table"] as const) {
      test(`BDB-01 ${view} view: the delete is sent at once and Undo restores exactly those two (${width})`, async ({ page }) => {
        await openCustomers(page, view);
        const del = await deletePicked(page, view);
        expect(del.postDataJSON(), "one delete, sent at once with the two picked ids").toEqual({ contactIds: PICKED.map((c) => c.id) });

        for (const c of PICKED) await expect(customer(page, view, c), `${name(c)} leaves the list`).toHaveCount(0, { timeout: 10_000 });
        await expect(customer(page, view, CUSTOMERS[2]).first(), "the one not picked stays").toBeVisible();

        const undo = page.getByRole("button", { name: /^undo$/i }).filter({ visible: true });
        await expect(undo, "the toast offers Undo").toHaveCount(1, { timeout: 5_000 });
        const restore = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === RESTORE_PATH);
        await undo.click();
        expect((await restore).postDataJSON(), "one restore with exactly those two ids").toEqual({ ids: PICKED.map((c) => c.id) });
        await expect(page.getByText(/restored 2 contacts/i).first(), "the toast says both came back").toBeVisible();
        for (const c of PICKED) await expect(customer(page, view, c).first(), `${name(c)} is back in the list`).toBeVisible({ timeout: 10_000 });
      });
    }
  });
}
