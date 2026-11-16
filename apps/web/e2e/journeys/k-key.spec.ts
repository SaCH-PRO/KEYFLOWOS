import {
  test,
  expect,
  API_URL,
  VARIANT,
  coveredButtonFindings,
  keyUiFindings,
  memberOf,
  settle,
  signedInContext,
} from "./journey-helpers";
import type { APIRequestContext, Page, Request } from "@playwright/test";

/**
 * GATE-JOURNEYS-G-L, journey K: ask KEY, optional (product audit
 * core_journeys_v1 K; KF-JOURNEY-002, 006; D-17, D-44, D-71, D-98; rulings
 * gate D-172, crons D-163). Each bullet of K's definition of done is a test,
 * on both journey projects (README.md in this folder). K has two halves.
 *
 * KEY-off (E2E_VARIANT=key-disabled)
 *   K1  No KEY UI shows on any v1 screen (Today, Customers, Sales, Schedule,
 *       Money, Your page, Settings, the New quote / New invoice / New booking
 *       forms, Settings > KEY): no button or link naming KEY, no drawer opening
 *       by itself, and Ctrl+J / Cmd+J open nothing (keyUiFindings).
 *       "With KEY_DISABLED, a separate run of journeys A to J (and L) passes" is
 *       the key-disabled run of this whole folder (e2e-live.yml), which
 *       GATE-JOURNEY-RUN requires green; it is not a test of its own.
 *
 * KEY-on: the KEY UI (ai-disabled and ai-on variants; skipped under
 * KEY_DISABLED, where K1 holds instead)
 *   K2  KEY opens only from the header button (on phones too) or Ctrl+J / Cmd+J,
 *       never by itself, and never covers a button.
 *   K3  Send, Deep think and Enter all send: each posts the typed message to
 *       KEY's chat route (in the ai-disabled variant the API answers the R0-07
 *       503 provider_not_configured, which the harness records by contract).
 *   K4  One session-list request (GET .../flow/sessions) per open.
 *
 * KEY-on with a model (@ai-on: the ai-on variant, a capped key, staging only)
 *   K5  KEY answers 'who owes me', 'what's on today' and 'how was this month'
 *       from the business's own data, within the member's scopes.
 *   K6  The paste-message box on New quote, New invoice and New booking drafts
 *       from the real catalog.
 *   K7  A write asked for in chat shows a draft card with Confirm and Edit in
 *       the chat itself; Confirm makes it.
 *   K8  A proposal KEY makes on its own appears in Needs you (@ai-on
 *       @scheduler: a KEY job switched on for the run; the crons ruling D-163
 *       keeps KEY's jobs off in production).
 *       "An AI-on smoke run passes, with a capped test key, under authority for
 *       provider traffic" is the ai-on run of K5-K8 (e2e-live.yml's ai_on
 *       dispatch, in its own environment).
 *
 * Doors: the header's KEY button ("Ask KEY", SWP-LAYERS / SWP-KEY-SHELL-SMOKE,
 * shown at 375px too); the drawer is the dialog headed "KEY" with its message
 * box ("Message KEY..."), "Send" and "Deep think". The paste box is "Paste the
 * customer's message" at the top of New quote, New invoice and New booking
 * (KEY-PASTE-BOX). KEY's chat posts to /ai/businesses/:id/flow/chat(/stream).
 *
 * RED at the GATE-JOURNEYS-A-F head (e63bcb1a), observed on both projects in
 * the ai-disabled and key-disabled variants (the packet return holds the
 * report). ai-disabled: K3 Send posts nothing, Deep think cannot be pressed,
 * and sending throws "(e ?? n.input).trim is not a function"; only Enter
 * posts (BUG-040, the headline); K2 the drawer opens by itself on Today, KEY
 * doors sit outside the header, Ctrl+J does not reopen the drawer once it is
 * closed, there is no header KEY button at 375px, and on a desktop the KEY
 * bubble covers New event's Create (BUG-004); K4 dozens to hundreds of
 * session-list reads in 10 s for one open (32 to 151 across runs; BUG-043),
 * and at 375px the drawer cannot be opened a second time; K1 is skipped (it
 * is the key-disabled half). key-disabled: K1
 * finds KEY UI on all ten screens: Today's 'Ask KEY for opportunities' and
 * 'KEY CFO sees ...' cards, a 'Talk to KEY' button on every screen, and on a
 * desktop the menu's 'KEY' link and the header's 'Ask KEY anything... ⌘J'; K2,
 * K3 and K4 are skipped (KEY-on only). K5..K8 are @ai-on legs (K8 @scheduler
 * too) and do not run here.
 */

const auth = (t: { token: string }) => ({ Authorization: `Bearer ${t.token}` });

async function api<T = Record<string, unknown>>(
  request: APIRequestContext,
  who: { token: string },
  method: "GET" | "POST" | "PATCH",
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
const ZONE = "America/Port_of_Spain";
const localDay = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

const KEY_ON = VARIANT !== "key-disabled";
const KEY_ON_ONLY = "KEY-on legs run where the KEY UI is on (ai-disabled, ai-on); under KEY_DISABLED, K1 holds instead";

/** The KEY chat drawer (KeyChatPanel): the innermost block holding its "KEY" heading and its message box. */
const drawerOf = (page: Page) =>
  page
    .locator("[role=dialog], aside, section, div")
    .filter({ has: page.getByRole("heading", { name: /^KEY$/ }) })
    .filter({ has: page.getByRole("textbox") })
    .last();
const drawerHeading = (page: Page) => page.getByRole("heading", { name: /^KEY$/ }).filter({ visible: true });

/**
 * The header's KEY button: a button or link inside the app header naming KEY,
 * or carrying KEY's shortcut (today's header button cycles through sample
 * questions, "Ask KEY anything...", "Why is cash slow?", always with "⌘J").
 */
const HEADER_DOOR = /\bKEY\b|⌘J/;
const headerKeyDoor = (page: Page) =>
  page
    .locator("header, [role=banner]")
    .getByRole("button", { name: HEADER_DOOR })
    .or(page.locator("header, [role=banner]").getByRole("link", { name: HEADER_DOOR }))
    .filter({ visible: true });

/** KEY doors outside the header (the bubble, Today's KEY cards, a nav link): each visible button or link naming KEY outside it. */
async function keyDoorsOutsideHeader(page: Page): Promise<string[]> {
  return page
    .getByRole("button", { name: /\bKEY\b/ })
    .or(page.getByRole("link", { name: /\bKEY\b/ }))
    .filter({ visible: true })
    .evaluateAll((els) =>
      els
        .filter((e) => !e.closest("header, [role=banner]") && !e.closest("[role=dialog]"))
        .map((e) => (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60)),
    );
}

/** Closes the drawer when it is open: its own Close chat, else Escape (Today is one level down: Escape stays on it). */
async function closeDrawer(page: Page): Promise<void> {
  if (!(await drawerHeading(page).count())) return;
  const own = page.getByRole("button", { name: /^close chat$/i }).filter({ visible: true });
  if (await own.count()) await own.first().click().catch(() => {});
  if (await drawerHeading(page).count()) await page.keyboard.press("Escape");
  await drawerHeading(page).first().waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
}

/**
 * Opens the drawer for the legs that use it (K3, K4, K5, K7): the header
 * button, else Ctrl+J, else any other KEY door on the page (the bubble; K2
 * holds the rule that only the header and Ctrl+J may open it). Returns how.
 */
async function openDrawer(page: Page): Promise<string> {
  if (await drawerHeading(page).count()) return "already open";
  const opened = () => drawerHeading(page).first().isVisible({ timeout: 5_000 }).catch(() => false);
  const visibleSoon = () => drawerHeading(page).first().waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
  const door = headerKeyDoor(page);
  if (await door.count()) {
    await door.first().click();
    if (await visibleSoon()) return "the header button";
  }
  await page.keyboard.press("Control+j");
  if (await visibleSoon()) return "Ctrl+J";
  const other = page.getByRole("button", { name: /\bKEY\b/ }).or(page.getByRole("link", { name: /\bKEY\b/ })).filter({ visible: true });
  if (await other.count()) {
    await other.first().click();
    if (await visibleSoon()) return `another KEY door ('${((await other.first().getAttribute("aria-label")) ?? (await other.first().innerText())).trim().slice(0, 40)}')`;
  }
  expect(await opened(), "the KEY drawer opens (header button, Ctrl+J, or any KEY door)").toBe(true);
  return "";
}

const isChatPost = (r: Request) => r.method() === "POST" && /\/ai\/businesses\/[^/]+\/(flow\/)?chat(\/stream)?$/.test(new URL(r.url()).pathname);

/** Today for a fresh owner, settled; the drawer is left as the page leaves it (it may open by itself: K2 reports that). */
async function openToday(page: Page): Promise<void> {
  await page.goto("/app/command-center");
  await settle(page);
}

/** Today with the drawer closed: waits for a drawer that opens by itself (up to 5 s), then closes it. */
async function todayDrawerClosed(page: Page): Promise<void> {
  await openToday(page);
  await drawerHeading(page).first().waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  await closeDrawer(page);
}

test.describe("journey K: ask KEY (optional)", () => {
  test("K1 KEY-off: no KEY UI on any v1 screen, and Ctrl+J opens nothing", async ({ page }) => {
    test.skip(VARIANT !== "key-disabled", "KEY-off runs in the key-disabled variant (E2E_VARIANT=key-disabled)");
    test.setTimeout(10 * 60_000);
    const screens: Array<[string, string, ((p: Page) => Promise<void>) | null]> = [
      ["Today", "/app/command-center", null],
      ["Customers", "/app/crm/contacts", null],
      ["Sales", "/app/commerce", null],
      ["Schedule", "/app/schedule/calendar", null],
      ["Money", "/app/money", null],
      ["Your page", "/app/store", null],
      ["Settings", "/app/settings", null],
      [
        "New quote",
        "/app/commerce?tab=pipeline&view=quotes",
        async (p) => {
          const direct = p.getByRole("button", { name: /^new quote$/i }).filter({ visible: true });
          if (await direct.count()) await direct.first().click();
        },
      ],
      ["New invoice", "/app/commerce/invoices/new", null],
      [
        "New booking",
        "/app/bookings",
        async (p) => {
          const open = p.getByRole("button", { name: /^new booking$/i }).filter({ visible: true });
          if (await open.count()) await open.first().click();
        },
      ],
    ];
    const all: string[] = [];
    for (const [name, path, then] of screens) {
      await test.step(`${name}: no KEY UI`, async () => {
        await page.goto(path);
        await settle(page);
        if (then) {
          await then(page);
          await page.waitForTimeout(800);
        }
        const findings = await keyUiFindings(page);
        const paste = await page.getByLabel(/paste the customer.s message/i).filter({ visible: true }).count();
        if (paste) findings.push("the paste-message box renders");
        for (const f of findings) all.push(`${name}: ${f}`);
        expect.soft(findings, `KEY UI on ${name} under KEY_DISABLED`).toEqual([]);
      });
    }
    await test.step("Settings > KEY is not offered", async () => {
      await page.goto("/app/settings");
      await settle(page, 1_000);
      const entry = page.locator("main").first().getByRole("link", { name: /^KEY\b|KEY assistant|AI (settings|control)/i }).filter({ visible: true });
      expect.soft(await entry.count(), "Settings offers KEY under KEY_DISABLED").toBe(0);
    });
    test.info().annotations.push({ type: "key-ui", description: all.join("; ") || "none" });
  });

  test("K2 KEY opens only from the header button (phones too) or Ctrl+J, never by itself, and never covers a button", async ({ page }) => {
    test.skip(!KEY_ON, KEY_ON_ONLY);
    test.setTimeout(5 * 60_000);
    await openToday(page);

    await test.step("the drawer does not open by itself", async () => {
      const opened = await drawerHeading(page).first().waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
      expect.soft(opened, "the KEY drawer opened by itself on Today").toBe(false);
      await closeDrawer(page);
    });

    await test.step("the header has the KEY button, and it is the only KEY door", async () => {
      await expect.soft(headerKeyDoor(page).first(), "a KEY button in the header (at 375px too)").toBeVisible();
      expect.soft(await keyDoorsOutsideHeader(page), "KEY doors outside the header (the bubble, KEY cards, a nav link)").toEqual([]);
    });

    await test.step("the header button opens KEY", async () => {
      const door = headerKeyDoor(page);
      if (await door.count()) {
        await door.first().click();
        await expect.soft(drawerHeading(page).first(), "the header button opens the KEY drawer").toBeVisible({ timeout: 5_000 });
        await closeDrawer(page);
      }
    });

    await test.step("Ctrl+J opens KEY", async () => {
      await page.keyboard.press("Control+j");
      await expect.soft(drawerHeading(page).first(), "Ctrl+J opens the KEY drawer").toBeVisible({ timeout: 5_000 });
      await closeDrawer(page);
    });

    await test.step("no KEY element covers a primary button (Today's New, the New event sheet's Create)", async () => {
      await page.goto("/app/schedule/calendar");
      await settle(page, 1_000);
      await closeDrawer(page);
      await page.getByRole("button", { name: /^create$/i }).filter({ visible: true }).first().click();
      const sheet = page.getByRole("dialog", { name: "New event" });
      await expect(sheet).toBeVisible();
      await page.waitForTimeout(800);
      const covered = await coveredButtonFindings([{ what: "the New event sheet's Create", locator: sheet.getByRole("button", { name: /^create$/i }) }]);
      expect.soft(covered.filter((f) => /\bKEY\b|chat|bubble/i.test(f)), "KEY covering a primary button (BUG-004)").toEqual([]);
    });
  });

  test("K3 Send, Deep think and Enter all send the message", async ({ page }) => {
    test.skip(!KEY_ON, KEY_ON_ONLY);
    test.setTimeout(5 * 60_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await todayDrawerClosed(page);
    const how = await openDrawer(page);
    test.info().annotations.push({ type: "opened", description: how });
    const drawer = drawerOf(page);
    const box = drawer.getByPlaceholder(/message KEY/i).or(drawer.getByRole("textbox")).first();

    for (const [way, send] of [
      ["Send", async () => drawer.getByRole("button", { name: /^send$/i }).first().click({ timeout: 10_000 })],
      ["Deep think", async () => drawer.getByRole("button", { name: /^deep think$/i }).first().click({ timeout: 10_000 })],
      ["Enter", async () => box.press("Enter")],
    ] as const) {
      await test.step(`${way} sends the typed message`, async () => {
        const text = `who owes me (${way} ${stamp()})`;
        await expect(box, "KEY's message box").toBeEditable({ timeout: 15_000 });
        await box.fill(text);
        const posted = page.waitForRequest((r) => isChatPost(r) && (r.postData() ?? "").includes(text), { timeout: 10_000 }).then(() => true).catch(() => false);
        const pressed = await send().then(() => "").catch((e: Error) => e.message.split("\n")[0]);
        expect.soft(pressed, `${way} can be used in the KEY drawer`).toBe("");
        expect.soft(await posted, `${way} posts '${text}' to KEY's chat (BUG-040: Send and Deep think send nothing)`).toBe(true);
        await page.waitForTimeout(1_000);
      });
    }
    expect.soft(errors.filter((e) => /trim is not a function|TypeError/i.test(e)), "page errors while sending (BUG-040: '(e ?? n.input).trim is not a function')").toEqual([]);
  });

  test("K4 one session-list request per open of the drawer", async ({ page }) => {
    test.skip(!KEY_ON, KEY_ON_ONLY);
    test.setTimeout(5 * 60_000);
    await todayDrawerClosed(page);
    const lists: number[] = [];
    page.on("request", (r) => {
      if (r.method() === "GET" && /\/ai\/businesses\/[^/]+\/flow\/sessions$/.test(new URL(r.url()).pathname)) lists.push(Date.now());
    });
    for (const round of [1, 2]) {
      await test.step(`open ${round}: one GET .../flow/sessions in 10 s`, async () => {
        const before = lists.length;
        await openDrawer(page);
        await page.waitForTimeout(10_000);
        const during = lists.length - before;
        test.info().annotations.push({ type: "session-lists", description: `open ${round}: ${during} GET .../flow/sessions in 10 s` });
        expect.soft(during, `session-list requests during open ${round} (BUG-043: a loop, hundreds in 30 s)`).toBe(1);
        await closeDrawer(page);
        await page.waitForTimeout(1_000);
      });
    }
  });

  test("K5 KEY answers who owes me, what's on today and how this month went, from the business's own data and within scopes", { tag: "@ai-on" }, async ({ page, request, owner, browser }) => {
    test.setTimeout(10 * 60_000);
    const last = `Owes${stamp()}`;
    const customer = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts`, { firstName: "Maria", lastName: last });
    const invoice = await api<{ id: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices`, {
      contactId: customer.id,
      currency: owner.currency,
      items: [{ description: "Catering", quantity: 1, unitPrice: 1000 }],
    });
    await api(request, owner, "PATCH", `/commerce/invoices/${invoice.id}/status/sent`, { businessId: owner.businessId, status: "SENT" });
    await api(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices/${invoice.id}/payments`, { amount: 400, method: "Cash", idempotencyKey: `${invoice.id}-k5` });
    const ask = async (p: Page, question: string): Promise<string> => {
      await todayDrawerClosed(p);
      await openDrawer(p);
      const drawer = drawerOf(p);
      await drawer.getByPlaceholder(/message KEY/i).or(drawer.getByRole("textbox")).first().fill(question);
      await drawer.getByRole("button", { name: /^send$/i }).first().click();
      await p.waitForTimeout(30_000);
      return (await drawer.innerText()).replace(/\s+/g, " ");
    };
    await test.step("'who owes me' names Maria and the 600 owed", async () => {
      const answer = await ask(page, "Who owes me?");
      expect.soft(answer).toContain(last);
      expect.soft(answer).toMatch(/600(\.00)?/);
    });
    await test.step("'what's on today' and 'how was this month' answer from the books", async () => {
      expect.soft(await ask(page, "What's on today?")).toMatch(/today|nothing|no bookings/i);
      expect.soft(await ask(page, "How was this month?")).toMatch(/400(\.00)?/);
    });
    await test.step("a member without revenue read is told no, with no amount", async () => {
      const staff = await memberOf(request, owner, "front desk", { role: "STAFF", scopes: { bookings: "read", crm: "read" } });
      const desk = await signedInContext(browser, staff);
      const answer = await ask(await desk.newPage(), "Who owes me?");
      expect.soft(answer).not.toMatch(/600(\.00)?/);
    });
  });

  test("K6 the paste-message box on New quote, New invoice and New booking drafts from the real catalog", { tag: "@ai-on" }, async ({ page, request, owner }) => {
    test.setTimeout(10 * 60_000);
    const product = await api<{ id: string; name: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/products`, { name: `Sponge cake ${stamp()}`, price: 45, currency: owner.currency, category: "PRODUCT" });
    const service = await api<{ id: string; name: string }>(request, owner, "POST", `/bookings/businesses/${owner.businessId}/services`, { name: `Gel manicure ${stamp()}`, duration: 60, price: 120, currency: owner.currency });
    const forms: Array<[string, string, string, string]> = [
      ["New quote", "/app/commerce?tab=pipeline&view=quotes", "new quote", `Hi, can I get 3 ${product.name} Saturday, 10% off`],
      ["New invoice", "/app/commerce/invoices/new", "", `Invoice me for 2 ${product.name} please`],
      ["New booking", "/app/bookings", "new booking", `Can I book a ${service.name} tomorrow at 10am?`],
    ];
    for (const [name, path, opener, message] of forms) {
      await test.step(`${name}: the pasted message drafts from the catalog`, async () => {
        await page.goto(path);
        await settle(page, 1_000);
        if (opener) await page.getByRole("button", { name: new RegExp(`^${opener}$`, "i") }).filter({ visible: true }).first().click();
        const box = page.getByLabel(/paste the customer.s message/i).filter({ visible: true }).first();
        await expect(box, `${name} offers 'Paste the customer's message'`).toBeVisible();
        await box.fill(message);
        await page.getByRole("button", { name: /^draft/i }).filter({ visible: true }).first().click();
        await expect(page.getByText(name === "New booking" ? service.name : product.name).first(), "the drafted line names the catalog item").toBeVisible({ timeout: 60_000 });
      });
    }
  });

  test("K7 a write asked for in chat shows a draft card with Confirm and Edit in the chat; Confirm makes it", { tag: "@ai-on" }, async ({ page, request, owner }) => {
    test.setTimeout(10 * 60_000);
    const last = `Draft${stamp()}`;
    await api(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts`, { firstName: "Leon", lastName: last });
    await todayDrawerClosed(page);
    await openDrawer(page);
    const drawer = drawerOf(page);
    await drawer.getByPlaceholder(/message KEY/i).or(drawer.getByRole("textbox")).first().fill(`Create an invoice for Leon ${last} for 2 hours of consulting at 250`);
    await drawer.getByRole("button", { name: /^send$/i }).first().click();
    const card = drawer.locator("article, [role=group], div").filter({ has: drawer.getByRole("button", { name: /^confirm/i }) }).filter({ has: drawer.getByRole("button", { name: /^edit/i }) }).last();
    await expect(card, "a draft card with Confirm and Edit in the chat").toBeVisible({ timeout: 90_000 });
    const made = page.waitForResponse((r) => r.request().method() === "POST" && /\/invoices$|\/confirm/.test(new URL(r.url()).pathname));
    await card.getByRole("button", { name: /^confirm/i }).first().click();
    expect((await made).status()).toBeLessThan(300);
  });

  test("K8 a proposal KEY makes on its own appears in Needs you", { tag: ["@ai-on", "@scheduler"] }, async ({ page, request, owner }) => {
    // GATE-STAGING-RUN with AI on and a KEY job switched on for the run (crons ruling D-163 keeps them off in production).
    test.setTimeout(15 * 60_000);
    const customer = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts`, { firstName: "Omar", lastName: `Late${stamp()}` });
    const invoice = await api<{ id: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices`, {
      contactId: customer.id,
      currency: owner.currency,
      dueDate: localDay(new Date(Date.now() - 21 * 86_400_000)),
      items: [{ description: "Wholesale order", quantity: 1, unitPrice: 2400 }],
    });
    await api(request, owner, "PATCH", `/commerce/invoices/${invoice.id}/status/sent`, { businessId: owner.businessId, status: "SENT" });
    await expect
      .poll(async () => {
        await todayDrawerClosed(page);
        const needs = page.locator("main").first().getByRole("region", { name: /^needs you$/i }).or(page.locator("main section").filter({ has: page.getByRole("heading", { name: /^needs you$/i }) })).first();
        return needs.locator("li, [role=listitem], article, div").filter({ has: page.getByRole("button", { name: /^(approve|run)/i }) }).filter({ hasText: /KEY|suggest|propos/i }).count();
      }, { timeout: 12 * 60_000, intervals: [30_000], message: "a proposal KEY made on its own, in Needs you with Approve / Run" })
      .toBeGreaterThan(0);
  });
});
