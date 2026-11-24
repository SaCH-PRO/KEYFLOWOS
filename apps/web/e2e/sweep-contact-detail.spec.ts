import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect, API_URL, settle, type Tenant } from "./journeys/journey-helpers";

/**
 * SWP-CONTACT-DETAIL, the browser half (sweep BUG-127, BUG-128, BUG-129, BUG-062; journey C). The jsdom half is
 * src/components/contacts/__tests__/contact-detail-sweep.test.tsx.
 *
 * A customer is seeded through the API with a dropdown custom field set to a stored value ("gold", label "Gold
 * member") and a note. Then, on the Customers list view (/app/crm/contacts?view=list, the side panel Release 0's
 * live spec edits through):
 *
 *   1. BUG-062  the 'Contact details' region shows a summary, an Open link to the customer's page and Edit, and no
 *               tab strip.
 *   2. BUG-127  the panel's custom field reads "Gold member", not "gold".
 *   3. BUG-128  the panel's Delete dialog says the client moves to Trash with Undo, not "cannot be undone"; its
 *               Forget dialog says the data is erased for good and never mentions Trash; both are cancelled and
 *               the customer is still there.
 *   4. BUG-129  Recent Activity reads the note in plain words, and its 'View all' opens the customer's Timeline
 *               page, which reads "Note added", never the event's code.
 *   5. BUG-128  the table view's bulk delete dialog says the contacts move to Trash, not "cannot be undone"
 *               (cancelled before anything is deleted).
 *
 * The desktop viewport only: the list view's side panel is the desktop layout (on a phone the list opens the
 * customer's page). Live only (E2E_LIVE=1, a production build, a real API and database: the journey harness's own
 * fixtures, README in e2e/journeys); without E2E_LIVE every case is skipped. Run it in the "chromium" project:
 *
 *   E2E_LIVE=1 E2E_VARIANT=ai-disabled E2E_API_URL=... E2E_JWT_SECRET=... \
 *     E2E_NO_SERVER=1 E2E_BASE_URL=... npx playwright test e2e/sweep-contact-detail.spec.ts --project=chromium
 *
 * RED at the SWP-CONTACT-DETAIL base (main 054cac4b): the panel draws a tab strip and has no Open link; the field
 * reads "gold"; the Delete dialog says "cannot be undone"; the Timeline page prints the event's code; the bulk
 * dialog says "cannot be undone".
 */

const auth = (t: Tenant) => ({ Authorization: `Bearer ${t.token}` });

async function api<T = Record<string, unknown>>(
  request: APIRequestContext,
  owner: Tenant,
  method: "GET" | "POST",
  path: string,
  data?: unknown,
): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, { method, headers: auth(owner), data });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 400)}`).toBe(method === "POST" ? 201 : 200);
  return (text ? JSON.parse(text) : null) as T;
}

const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;

interface Seeded {
  id: string;
  first: string;
  last: string;
}

/** A customer whose dropdown field holds "gold" (labelled "Gold member"), with one note. */
async function seedCustomer(request: APIRequestContext, owner: Tenant): Promise<Seeded> {
  const field = `tier${stamp()}`;
  await api(request, owner, "POST", `/crm/businesses/${owner.businessId}/custom-field-definitions`, {
    name: field,
    label: "Membership tier",
    type: "SELECT",
    options: { options: [{ label: "Gold member", value: "gold" }, { label: "Silver member", value: "silver" }] },
  });
  const first = "Jade";
  const last = `Panel${stamp()}`;
  const contact = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts`, {
    firstName: first,
    lastName: last,
    email: `jade.${last.toLowerCase()}@v62j.test.local`,
    customFieldValues: { [field]: "gold" },
  });
  // The premise: the stored value is the option's value, not its label.
  const values = await api<Array<{ value: unknown; definition: { name: string } }>>(
    request,
    owner,
    "GET",
    `/crm/businesses/${owner.businessId}/contacts/${contact.id}/custom-field-values`,
  );
  expect(values.find((v) => v.definition.name === field)?.value, "the field stores the option's value").toBe("gold");
  await api(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts/${contact.id}/notes`, { body: "Prefers mornings" });
  return { id: contact.id, first, last };
}

/** The list view with this customer's row selected; returns the side panel. */
async function openPanel(page: Page, c: Seeded): Promise<Locator> {
  await page.goto("/app/crm/contacts?view=list");
  // The card (role=option, labelled "<name> - <status>"), as release0-live.spec.ts selects it.
  const row = page.locator(`div[role="option"][aria-label^="${c.first} ${c.last} - "]`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  if ((await row.getAttribute("aria-selected")) !== "true") await row.click();
  await expect(row).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("region", { name: "Contact details" });
  await expect(panel).toHaveCount(1);
  await expect(panel.getByTitle("Edit client")).toBeVisible();
  return panel;
}

/** No event code (Note.Created, note.created) on screen: the plain words only. */
async function expectNoEventCode(page: Page, where: string) {
  const text = await page.locator("body").innerText();
  expect(text.match(/\b[A-Za-z]+\.(created|updated|added|completed|sent)\b/gi) ?? [], `${where}: event codes on screen`).toEqual([]);
}

test.describe("SWP-CONTACT-DETAIL the contact pages say what the owner sees (desktop 1440x900)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the list's side panel is a summary with Open and Edit; labels, dialogs and events in plain words", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    const c = await seedCustomer(request, owner);

    await test.step("BUG-062: the 'Contact details' region shows a summary, Open and Edit, and no tab strip", async () => {
      const panel = await openPanel(page, c);
      await expect(panel.getByRole("heading", { name: new RegExp(`${c.first} ${c.last}`) }).first()).toBeVisible();
      const open = panel.getByRole("link", { name: /^open .*page$/i });
      await expect(open).toHaveAttribute("href", `/app/crm/contacts/${c.id}/overview`);
      await expect(panel.getByRole("tablist")).toHaveCount(0);
      await expect(panel.getByRole("tab")).toHaveCount(0);
    });

    await test.step("BUG-127: the panel's dropdown field reads its label, 'Gold member'", async () => {
      const panel = page.getByRole("region", { name: "Contact details" });
      const more = panel.getByRole("button", { name: /more details/i });
      if (await more.count()) await more.first().click();
      await expect(panel.getByText("Gold member")).toBeVisible();
      await expect(panel.getByText("gold", { exact: true })).toHaveCount(0);
    });

    await test.step("BUG-128: Delete says Trash and Undo; Forget says erased for good and never Trash; both cancelled", async () => {
      const panel = page.getByRole("region", { name: "Contact details" });
      await panel.getByTitle("Delete client").click();
      const deleting = page.getByRole("dialog").filter({ hasText: /delete/i });
      await expect(deleting).toBeVisible();
      await expect(deleting).toContainText(/trash/i);
      await expect(deleting).toContainText(/undo/i);
      await expect(deleting).not.toContainText(/cannot be undone/i);
      await deleting.getByRole("button", { name: /^cancel$/i }).click();
      await expect(deleting).toHaveCount(0);

      await panel.getByTitle("Forget contact (GDPR right-to-be-forgotten)").click();
      const forgetting = page.getByRole("dialog").filter({ hasText: /forget/i });
      await expect(forgetting).toBeVisible();
      await expect(forgetting).toContainText(/for good/i);
      await expect(forgetting).not.toContainText(/trash/i);
      await forgetting.getByRole("button", { name: /^cancel$/i }).click();
      await expect(forgetting).toHaveCount(0);
      await api(request, owner, "GET", `/crm/businesses/${owner.businessId}/contacts/${c.id}`);
    });

    await test.step("BUG-129: Recent Activity reads the note in plain words; 'View all' opens the Timeline page, which does too", async () => {
      const panel = page.getByRole("region", { name: "Contact details" });
      const recent = panel.getByRole("button", { name: /recent activity/i });
      await expect(recent).toContainText(/note added/i);
      await recent.click();
      await panel.getByRole("link", { name: /view all/i }).click();
      await expect(page).toHaveURL(new RegExp(`/app/crm/contacts/${c.id}/timeline`));
      await expect(page.getByText("Note added").first()).toBeVisible({ timeout: 30_000 });
      await settle(page, 1_000);
      await expectNoEventCode(page, "the Timeline page");
    });

    await test.step("BUG-128: the table view's bulk delete dialog says Trash, not 'cannot be undone' (cancelled)", async () => {
      await page.goto("/app/crm/contacts?view=table");
      const pick = page.getByRole("checkbox", { name: `Select ${c.first} ${c.last}` });
      await expect(pick).toBeVisible({ timeout: 30_000 });
      await pick.check();
      await page.getByRole("button", { name: /^delete 1 selected contacts$/i }).first().click();
      const bulk = page.locator("#db-bulk-delete-desc");
      await expect(bulk).toBeVisible();
      await expect(bulk).toContainText(/trash/i);
      await expect(bulk).not.toContainText(/cannot be undone/i);
      await page.getByRole("dialog").filter({ has: bulk }).getByRole("button", { name: /^cancel$/i }).click();
      await expect(bulk).toHaveCount(0);
      await api(request, owner, "GET", `/crm/businesses/${owner.businessId}/contacts/${c.id}`);
    });
  });
});
