import {
  test,
  expect,
  API_URL,
  allowBusinessNamed,
  memberOf,
  settle,
  signedInContext,
  type Member,
  type Tenant,
} from "./journey-helpers";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

/**
 * GATE-JOURNEYS-G-L, journey J: work with my team safely (product audit
 * core_journeys_v1 J; KF-JOURNEY-025; D-11, D-95, D-104, D-116, D-125; rulings
 * hubs D-150, legacyaccess D-179). Each bullet of J's definition of done is a
 * test (J1..J10), on both journey projects, in every variant (README.md in this
 * folder).
 *
 *   J1  The owner invites by email, case-insensitive: the same address in other
 *       letters is refused, and the team holds one invite for it.
 *   J2  ... with a role preset: Admin, Front desk or Bookkeeper; module scopes
 *       are optional (an invite with a preset and no scope edits is accepted).
 *   J3  The role control resets after each invite.
 *   J4  Pending invites look pending (marked so, and not counted as members).
 *   J5  A staff member's menu shows only the hubs they may open.
 *   J6  A refused screen says 'No access, ask the owner', never zeros.
 *   J7  Staff cannot read webhook secrets or API keys through the API, and
 *       cannot write stock or projects outside their scope.
 *   J8  A removed member is told they were removed.
 *   J9  'My account' is separate from Business profile.
 *   J10 The Staff screen in Schedule explains that booking staff are not app logins.
 *
 * Doors: Settings > Team is /app/settings/team: an email field ("Team member
 * email"), the role control, "Send Invite" (or "Invite"), and the members list.
 * The menu is the app's navigation (the sidebar on a desktop; the bottom bar
 * and its More drawer on a phone); its hubs are Today, Customers, Sales,
 * Schedule, Money, Your page and Settings (NAV-A1). 'My account' is in the
 * account (avatar) menu and at /app/settings/profile (NAV-A3). Schedule's Staff
 * screen is the bookings staff list (/app/bookings, its Staff or Setup tab).
 *
 * Members are made through the API as the Team screen makes them
 * (journey-helpers.ts memberOf), and each signs in with a browser of their own
 * (signedInContext); the API refuses them by module scope, never by tenancy.
 *
 * RED at the GATE-JOURNEYS-A-F head (e63bcb1a), observed on both projects in
 * the ai-disabled and key-disabled variants (the packet return holds the
 * report): J1 the same address in upper case is invited again, 201 and a
 * second row (BUG-016, the headline); J2 the role control offers only Admin
 * and Staff; J3 after an Admin invite the control stays on Admin and the next
 * invite is silently ADMIN (BUG-115); J4 the staff count includes the pending
 * invite; J5 a bookings-and-customers member's menu is Command Center, KEY and
 * Home (desktop) or Home and Inbox (phone), not Customers, Schedule and Today;
 * J6 Expenses & bills and Settings > Team show zeros, not 'No access, ask the
 * owner' (BUG-063, BUG-064); J8 a removed member gets a brief toast, then
 * their own empty workspace (BUG-117); J9 the account menu has no My account;
 * J10 Schedule's Staff screen does not say booking staff are not app logins
 * (at 375px its Staff tab is an unnamed icon and the list is not reached). J7
 * passes: the API refuses staff the webhook, API-key, stock and project
 * routes.
 */

const auth = (t: { token: string }) => ({ Authorization: `Bearer ${t.token}` });

async function api<T = Record<string, unknown>>(
  request: APIRequestContext,
  who: { token: string },
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  data?: unknown,
  expected?: number,
): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, { method, headers: auth(who), data });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 400)}`).toBe(expected ?? (method === "POST" ? 201 : 200));
  return (text ? JSON.parse(text) : null) as T;
}

const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;

interface TeamRow {
  id: string;
  role: string;
  user?: { email?: string | null } | null;
  email?: string | null;
  invitePending?: boolean;
  permissionScopes?: Record<string, string> | null;
}

/** The team as GET /identity/businesses/:id/team lists it. */
async function team(request: APIRequestContext, owner: Tenant): Promise<TeamRow[]> {
  const body = await api<unknown>(request, owner, "GET", `/identity/businesses/${owner.businessId}/team`);
  if (Array.isArray(body)) return body as TeamRow[];
  const b = body as Record<string, unknown>;
  for (const k of ["members", "team", "data", "items"]) if (Array.isArray(b[k])) return b[k] as TeamRow[];
  return [];
}

const emailOf = (r: TeamRow) => (r.user?.email ?? r.email ?? "").toLowerCase();

const EMAIL_FIELD = /team member email|email/i;

/**
 * The invite form on Settings > Team: the block holding the email field and the
 * send button (not a member's row, whose role control is named the same).
 * Opens Settings > Team when asked to, and the Invite tab when there is one.
 */
async function inviteForm(page: Page, open = false): Promise<Locator> {
  if (open) {
    await page.goto("/app/settings/team");
    await settle(page, 1_000);
  }
  const main = page.locator("main").first();
  const email = main.getByLabel(EMAIL_FIELD).or(main.getByPlaceholder(/@/)).filter({ visible: true }).first();
  // The form may sit behind an Invite tab or button (it closes after each invite today). The screen may still
  // be loading (no toggle yet, or a press before it responds), so the toggle is pressed again, 5 s apart (a
  // press that did open the form has time to show it), until the field shows or 25 s pass; the expect below
  // then says the field never came.
  const toggle = main.getByRole("tab", { name: /^invite$/i }).or(main.getByRole("button", { name: /^invite$/i })).filter({ visible: true });
  for (const until = Date.now() + 25_000; Date.now() < until; ) {
    if (await email.isVisible().catch(() => false)) break;
    if (await toggle.count()) await toggle.first().click().catch(() => undefined);
    await email.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  }
  await expect(email, "the Team screen's invite email field").toBeVisible();
  // The form: the innermost block holding the email field and its submit (every match is an ancestor of the
  // field). The inner locators of `has` are relative to each block, so they are built from the page, not main.
  const field = page.getByLabel(EMAIL_FIELD).or(page.getByPlaceholder(/@/));
  return main.locator("form, section, div").filter({ has: field }).filter({ has: page.getByRole("button", { name: SUBMIT }) }).last();
}

const SUBMIT = /^(send invite|send|invite)$/i;

/** The role control of the invite form: a select, or a group of preset choices. */
function roleControl(form: Locator): Locator {
  return form
    .getByRole("combobox", { name: /role/i })
    .or(form.locator("select[aria-label*='role' i]"))
    .or(form.getByRole("radiogroup", { name: /role/i }))
    .filter({ visible: true })
    .first();
}

/** The role choices the invite form offers (the select's options, or the radio group's choices). */
async function roleChoices(form: Locator): Promise<string[]> {
  const control = roleControl(form);
  if ((await control.evaluate((e) => e.tagName)) === "SELECT") {
    return control.evaluate((el) => Array.from((el as HTMLSelectElement).options).map((o) => o.text.trim()));
  }
  return (await control.getByRole("radio").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") || e.closest("label")?.textContent || e.textContent || ""))).map((t) => t.trim());
}

/** What the invite form's role control shows now (the selected option, or the checked choice). */
async function roleShown(form: Locator): Promise<string> {
  const control = roleControl(form);
  if ((await control.evaluate((e) => e.tagName)) === "SELECT") {
    return control.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.text.trim() ?? "");
  }
  const checked = control.getByRole("radio", { checked: true });
  return (await checked.count()) ? ((await checked.first().getAttribute("aria-label")) ?? (await checked.first().innerText())).trim() : "";
}

/** Picks a role on the invite form by its shown name. */
async function pickRole(form: Locator, name: RegExp): Promise<void> {
  const control = roleControl(form);
  if ((await control.evaluate((e) => e.tagName)) === "SELECT") {
    const label = (await roleChoices(form)).find((c) => name.test(c));
    expect(label, `the role control offers ${name.source}`).toBeTruthy();
    await control.selectOption({ label: label! });
  } else {
    await control.getByRole("radio", { name }).first().check();
  }
}

/** Sends the invite form for `email` (the role as it stands); resolves with the team route's answer. */
async function sendInvite(page: Page, owner: Tenant, email: string): Promise<{ status: number; body: string }> {
  const form = await inviteForm(page);
  await form.getByLabel(EMAIL_FIELD).or(form.getByPlaceholder(/@/)).filter({ visible: true }).first().fill(email);
  const sent = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/identity/businesses/${owner.businessId}/team`);
  await form.getByRole("button", { name: SUBMIT }).filter({ visible: true }).last().click();
  const res = await sent;
  return { status: res.status(), body: await res.text() };
}

/** A member's view of the app's menu: every navigation link's name (the sidebar; on a phone the bottom bar and its More drawer). */
async function menuNames(page: Page): Promise<string[]> {
  const names = async () =>
    (await page.getByRole("navigation").getByRole("link").filter({ visible: true }).evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim()))).filter(Boolean);
  const seen = new Set(await names());
  const more = page.getByRole("button", { name: /^(more|menu|open menu|open navigation)$/i }).filter({ visible: true });
  if (await more.count()) {
    await more.first().click();
    await page.waitForTimeout(600);
    for (const n of await names()) seen.add(n);
    const drawer = page.getByRole("dialog").filter({ visible: true });
    if (await drawer.count()) for (const n of await drawer.getByRole("link").filter({ visible: true }).allInnerTexts()) seen.add(n.replace(/\s+/g, " ").trim());
    await page.keyboard.press("Escape");
  }
  return [...seen];
}

/** The v1 hubs (NAV-A1), by the names a menu entry may carry. */
const HUBS: Record<string, RegExp> = {
  Today: /^today\b/i,
  Customers: /^customers\b/i,
  Sales: /^sales\b/i,
  Schedule: /^schedule\b/i,
  Money: /^money\b/i,
  "Your page": /^(your page|booking page|online store)\b/i,
  Settings: /^settings\b/i,
};

const hubsIn = (names: string[]) => Object.entries(HUBS).filter(([, re]) => names.some((n) => re.test(n))).map(([hub]) => hub);

test.describe("journey J: work with my team safely", () => {
  test("J1 the owner invites by email, case-insensitive: the same address in other letters is refused", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    const address = `nadine.${stamp()}@v62j.test.local`;
    await inviteForm(page, true);

    await test.step(`invite ${address}`, async () => {
      const first = await sendInvite(page, owner, address);
      expect(first.status, `the first invite: ${first.body.slice(0, 200)}`).toBe(201);
    });

    await test.step("the same address in upper case is refused, with a reason, and the team holds one invite", async () => {
      await inviteForm(page, true);
      const again = await sendInvite(page, owner, address.toUpperCase());
      test.info().annotations.push({ type: "invite-case", description: `${again.status} ${again.body.slice(0, 200)}` });
      expect.soft(again.status, `inviting ${address.toUpperCase()} again (BUG-016: 201, a second member)`).toBeGreaterThanOrEqual(400);
      expect.soft(again.status, "the refusal is not a server error").toBeLessThan(500);
      const rows = (await team(request, owner)).filter((r) => emailOf(r) === address);
      expect.soft(rows.length, `members or invites for ${address}, in any letters`).toBe(1);
    });
  });

  test("J2 the invite offers the role presets Admin, Front desk and Bookkeeper; scopes are optional", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    const form = await inviteForm(page, true);
    const choices = await roleChoices(form);
    test.info().annotations.push({ type: "roles", description: JSON.stringify(choices) });
    for (const preset of [/^admin/i, /^front desk/i, /^bookkeeper/i]) {
      expect.soft(choices.some((c) => preset.test(c)), `the role control offers ${preset.source} (offers ${JSON.stringify(choices)})`).toBe(true);
    }
    await test.step("an invite with the Front desk preset and no scope edits is accepted", async () => {
      const address = `kai.${stamp()}@v62j.test.local`;
      await pickRole(form, /^front desk/i);
      const sent = await sendInvite(page, owner, address);
      expect(sent.status, sent.body.slice(0, 200)).toBe(201);
      const row = (await team(request, owner)).find((r) => emailOf(r) === address);
      expect(row, "the invite is on the team").toBeTruthy();
      expect(row!.role, "a preset is not the owner").not.toBe("OWNER");
    });
  });

  test("J3 the role control resets after each invite", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    const form = await inviteForm(page, true);
    const defaultRole = await roleShown(form);
    const admin = `ade.${stamp()}@v62j.test.local`;
    const next = `bea.${stamp()}@v62j.test.local`;
    await pickRole(form, /^admin/i);
    expect((await sendInvite(page, owner, admin)).status).toBe(201);
    await test.step("after an Admin invite the invite form's role control shows the default again", async () => {
      await page.waitForTimeout(500);
      expect.soft(await roleShown(await inviteForm(page)), "the invite form's role after the Admin invite (BUG-115: still Admin)").toBe(defaultRole);
    });
    await test.step("the next invite, role untouched, is not an Admin", async () => {
      expect((await sendInvite(page, owner, next)).status).toBe(201);
      const row = (await team(request, owner)).find((r) => emailOf(r) === next);
      expect(row?.role, `${next}'s role (BUG-115: silently ADMIN)`).not.toBe("ADMIN");
    });
  });

  test("J4 a pending invite looks pending and is not counted as a member", async ({ page, owner }) => {
    test.setTimeout(4 * 60_000);
    const address = `pending.${stamp()}@v62j.test.local`;
    await inviteForm(page, true);
    expect((await sendInvite(page, owner, address)).status).toBe(201);
    await page.goto("/app/settings/team");
    await settle(page, 1_000);
    const membersTab = page.getByRole("tab", { name: /^members/i }).or(page.getByRole("button", { name: /^members/i })).filter({ visible: true });
    if (await membersTab.count()) await membersTab.first().click();
    // The invite's own row: the innermost block that holds the address and a control (its role, Remove, Resend, ...).
    const row = page.locator("tr, li, [role=row], [role=listitem], article, div").filter({ hasText: address }).filter({ has: page.locator("button, select") }).last();
    await expect(row, `the invite for ${address} is listed`).toBeVisible();
    await expect.soft(row.getByText(/invited|pending|invite sent/i).first(), "the row says it is pending (BUG-116: shown as a full member)").toBeVisible();
    const text = (await page.locator("main").first().innerText()).replace(/\s+/g, " ");
    const counted = text.match(/\b(\d+)\s+staff\b/i);
    if (counted) expect.soft(Number(counted[1]), "the staff count leaves the pending invite out").toBe(0);
  });

  test("J5 a staff member's menu shows only the hubs they may open", async ({ request, owner, browser }) => {
    test.setTimeout(4 * 60_000);
    // Bookings and customers only (NAV-A1's case: a STAFF member with bookings read sees Today, Schedule and Customers).
    const staff = await memberOf(request, owner, "front desk", { role: "STAFF", scopes: { bookings: "read", crm: "read" } });
    const desk = await signedInContext(browser, staff);
    const page = await desk.newPage();
    await page.goto("/app");
    await settle(page, 2_000);
    const names = await menuNames(page);
    const hubs = hubsIn(names);
    test.info().annotations.push({ type: "menu", description: `${JSON.stringify(names)} -> hubs ${JSON.stringify(hubs)}` });
    expect(hubs.sort(), `the hubs a bookings-and-customers member's menu shows (menu: ${JSON.stringify(names).slice(0, 500)})`).toEqual(["Customers", "Schedule", "Today"]);
  });

  test("J6 a refused screen says 'No access, ask the owner', never zeros", async ({ request, owner, browser }) => {
    test.setTimeout(5 * 60_000);
    await api(request, owner, "POST", `/expenses/businesses/${owner.businessId}/expenses`, {
      description: `Rent ${stamp()}`,
      amount: 1250,
      currency: owner.currency,
      paymentMethod: "CASH",
    });
    const staff = await memberOf(request, owner, "front desk", { role: "STAFF", scopes: { bookings: "read", crm: "read" } });
    const desk = await signedInContext(browser, staff);
    const page = await desk.newPage();
    for (const [screen, path] of [
      ["Expenses & bills", "/app/expenses"],
      ["Settings > Team", "/app/settings/team"],
    ] as const) {
      await test.step(`${screen} says no access and to ask the owner`, async () => {
        await page.goto(path);
        await settle(page, 2_000);
        const text = (await page.locator("main").first().innerText().catch(() => "")).replace(/\s+/g, " ");
        test.info().annotations.push({ type: "refused-screen", description: `${screen}: ${text.slice(0, 400)}` });
        expect.soft(text, `${screen} says 'No access'`).toMatch(/no access/i);
        expect.soft(text, `${screen} says to ask the owner`).toMatch(/ask (the|your) owner/i);
        expect.soft(text, `${screen} shows zeros for a refusal (BUG-063, BUG-064)`).not.toMatch(/\b(TTD|TT\$|\$)\s?\$?0\.00\b|no team members yet|\b0 owner\b/i);
      });
    }
  });

  test("J7 staff cannot read webhook secrets or API keys, nor write stock or projects outside their scope", async ({ request, owner }) => {
    test.setTimeout(4 * 60_000);
    const product = await api<{ id: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/products`, { name: `Hair oil ${stamp()}`, price: 45, currency: owner.currency, category: "PRODUCT" });
    const warehouse = await api<{ id: string }>(request, owner, "POST", `/marketplace/businesses/${owner.businessId}/warehouses`, { name: `Back room ${stamp()}` });
    const stock = await api<{ id: string }>(request, owner, "POST", `/marketplace/businesses/${owner.businessId}/inventory`, { productId: product.id, warehouseId: warehouse.id, quantity: 12 });
    // Read on the store and on projects; no settings (a module the map leaves out is none).
    const staff: Member = await memberOf(request, owner, "stock clerk", { role: "STAFF", scopes: { storefront: "read", projects: "read", crm: "read" } });
    const asStaff = async (method: "GET" | "POST", path: string, data?: unknown) => {
      const res = await request.fetch(`${API_URL}${path}`, { method, headers: auth(staff), data });
      return { status: res.status(), body: await res.text() };
    };
    const checks = [
      { what: "the webhooks list (signing secrets)", call: () => asStaff("GET", `/webhooks/businesses/${owner.businessId}/webhooks`) },
      { what: "the API keys list", call: () => asStaff("GET", `/api/businesses/${owner.businessId}/api-keys`) },
      { what: "a stock adjustment (store read only)", call: () => asStaff("POST", `/marketplace/businesses/${owner.businessId}/inventory/adjust`, { stockId: stock.id, quantityChange: -2, reasonCode: "COUNT_CORRECTION" }) },
      { what: "a new project (projects read only)", call: () => asStaff("POST", `/projects/businesses/${owner.businessId}`, { name: `Staff project ${stamp()}` }) },
    ];
    for (const check of checks) {
      await test.step(check.what, async () => {
        const res = await check.call();
        expect.soft(res.status, `${check.what} as a staff member: ${res.body.slice(0, 200)}`).toBe(403);
        expect.soft(res.body, `${check.what}: refused by module scope, not tenancy`).not.toMatch(/no access to this business/i);
        expect.soft(res.body, `${check.what}: no secret in the answer`).not.toMatch(/"secret"\s*:\s*"[^"]+"|kf_[A-Za-z0-9]{8,}/);
      });
    }
    const after = await api<Array<{ id: string; quantity: number }>>(request, owner, "GET", `/marketplace/businesses/${owner.businessId}/inventory`);
    expect((Array.isArray(after) ? after : []).find((s) => s.id === stock.id)?.quantity, "the stock is untouched").toBe(12);
  });

  test("J8 a removed member is told they were removed", async ({ request, owner, browser }) => {
    test.setTimeout(5 * 60_000);
    const staff = await memberOf(request, owner, "removed member", { role: "STAFF", scopes: { bookings: "read", crm: "read" } });
    const desk = await signedInContext(browser, staff);
    // After the removal, the member's own business (the one their first sign-in made) is theirs to open.
    allowBusinessNamed(desk, staff.ownBusinessId, "after the owner removes them, the member's own business is still theirs");
    const page = await desk.newPage();
    await page.goto("/app/crm/contacts");
    await settle(page, 1_500);

    await test.step("the owner removes the member", async () => {
      await api(request, owner, "DELETE", `/identity/businesses/${owner.businessId}/team/${staff.membershipId}`);
    });

    await test.step("the member is told they no longer have access to the business, not dropped into an empty workspace", async () => {
      await page.goto("/app/crm/contacts");
      await settle(page, 3_000);
      const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      test.info().annotations.push({ type: "removed", description: `${page.url()} ${text.slice(0, 300)}` });
      expect.soft(text, "a lasting notice that they were removed (BUG-117: a brief toast, then their own empty workspace)").toMatch(/no longer have access|you were removed|removed you|access (was|has been) removed/i);
      expect.soft(text, "the notice names the business").toContain(owner.businessName);
      expect.soft(new URL(page.url()).pathname, "never onboarding for that reason").not.toMatch(/\/app\/onboarding/);
    });
  });

  test("J9 'My account' is the member's own account, separate from Business profile", async ({ request, owner, browser }) => {
    test.setTimeout(4 * 60_000);
    const staff = await memberOf(request, owner, "front desk", { role: "STAFF", scopes: { bookings: "read", crm: "read" } });
    const desk = await signedInContext(browser, staff);
    const page = await desk.newPage();
    await page.goto("/app/command-center");
    await settle(page, 1_500);
    // A KEY drawer that opened by itself (journey K reports it) is closed first, so the header is reachable.
    const closeKey = page.getByRole("button", { name: /close chat/i }).filter({ visible: true });
    if (await closeKey.count()) await closeKey.first().click();

    await test.step("the account menu's 'My account' opens the member's own account", async () => {
      // The account (avatar) menu; on a phone it may sit in the menu drawer (Me, or the navigation menu).
      const accountMenu = page.getByRole("button", { name: /user menu|account menu|my account|avatar|^me$/i }).filter({ visible: true });
      const name = /my (account|profile)/i;
      const mine = () => page.getByRole("menuitem", { name }).or(page.getByRole("link", { name })).or(page.getByRole("button", { name })).filter({ visible: true });
      if (await accountMenu.count()) await accountMenu.first().click({ timeout: 20_000 });
      await page.waitForTimeout(500);
      const navOpen = await page.getByRole("dialog", { name: /navigation/i }).filter({ visible: true }).count();
      if (!(await mine().count()) && !navOpen) {
        const drawer = page.getByRole("button", { name: /^(open navigation menu|menu|more)$/i }).filter({ visible: true });
        if (await drawer.count()) await drawer.first().click();
      }
      await expect(mine().first(), "the account menu offers My account").toBeVisible();
      await mine().first().click();
      await settle(page, 1_500);
      expect.soft(new URL(page.url()).pathname, "My account is not the business profile (BUG-118: /app/profile)").not.toBe("/app/profile");
      const text = (await page.locator("main").first().innerText()).replace(/\s+/g, " ");
      expect.soft(text, "it shows the member's own email").toContain(staff.email);
      expect.soft(text, "it is not the business's profile").not.toMatch(/business (profile|intelligence)|genome/i);
    });

    await test.step("Settings' account page is the same account page", async () => {
      await page.goto("/app/settings/profile");
      await settle(page, 1_500);
      expect.soft(new URL(page.url()).pathname, "/app/settings/profile stays the account page (BUG-118: it replaces itself with /app/profile)").not.toBe("/app/profile");
    });
  });

  test("J10 the Staff screen in Schedule says booking staff are not app logins", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    const staffName = `Shanice ${stamp()}`;
    await api(request, owner, "POST", `/bookings/businesses/${owner.businessId}/staff`, { name: staffName });
    await page.goto("/app/bookings");
    await settle(page, 1_500);
    // Schedule > Staff: a Staff tab, or the one inside Setup.
    for (const tab of [/^setup$/i, /^staff/i]) {
      const door = page.getByRole("tab", { name: tab }).or(page.getByRole("button", { name: tab })).or(page.getByRole("link", { name: tab })).filter({ visible: true });
      if (await door.count()) {
        await door.first().click();
        await settle(page, 1_000);
      }
    }
    const main = page.locator("main").first();
    await expect(main.getByText(staffName).first(), "Schedule's Staff screen lists the booking staff member").toBeVisible();
    const text = (await main.innerText()).replace(/\s+/g, " ");
    test.info().annotations.push({ type: "staff-screen", description: text.slice(0, 600) });
    expect.soft(text, "it says booking staff do not sign in to the app").toMatch(/(not|n't|never)\s.{0,30}(app )?(log ?ins?|sign ?ins?|logins|accounts|users)|(do not|don't|cannot|can't) (sign|log) in/i);
    await expect.soft(main.getByRole("link", { name: /team/i }).first(), "and points to Settings > Team for app access").toBeVisible();
  });
});
