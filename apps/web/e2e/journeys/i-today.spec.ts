import {
  test,
  expect,
  API_URL,
  RUN,
  anonymousContext,
  memberOf,
  recordLoadTiming,
  settle,
  signedInContext,
  type Tenant,
} from "./journey-helpers";
import { amountAfter, oneTapIn, revenueLeaks } from "./journey-text";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

/**
 * GATE-JOURNEYS-G-L, journey I: know what to do today (product audit
 * core_journeys_v1 I; KF-JOURNEY-017, 015; D-70, D-72, D-96; rulings hubs D-150,
 * labels D-151, crons D-163). Each bullet of I's definition of done is a test
 * (I1..I7), on both journey projects, in every variant (README.md in this folder).
 *
 *   I1  Today has exactly 4 blocks (Needs you, Today, Pulse, Get set up), served
 *       by one server read (GET .../today, TODAY-AGGREGATE).
 *   I2  Needs you lists approvals (a staff request waiting on the owner) and
 *       bank-transfer claims, each with inline actions (Approve / Reject;
 *       Confirm / Not yet), and the inline action works.
 *   I2b Needs you lists a proposal KEY makes on its own, with Approve / Run /
 *       Reject (@ai-on @scheduler: a model, and a KEY job switched on for the
 *       run; the crons ruling D-163 keeps KEY's jobs off in production).
 *   I3  The Today block lists today's bookings, due invoices, tasks and orders,
 *       each one tap from its action. Each item is found by what only its own
 *       row shows (the booking's service, the invoice number, the task's
 *       title, the order number): every row may name the customer.
 *   I3b ... and overdue invoices and 'ready to send' reminders, each one tap from
 *       WhatsApp (@scheduler: the overdue job and the run's server clock).
 *   I4  Pulse equals Money > Overview: the five Pulse figures TODAY-AGGREGATE
 *       names (cash, owed to you, you owe, this month's profit, safe to
 *       spend), each shown and each equal to the Overview's; a bill is seeded
 *       so 'you owe' is not 0 on both sides.
 *   I5  No metaphor labels or invented statistics (a fresh business: no Genome,
 *       Hull, Cortex, Command Center; no percentage, no risk count).
 *   I6  A STAFF member sees only tiles for their modules; a member without
 *       revenue:read sees no Pulse. Read on the screen and in the member's own
 *       GET .../today answer (journey-text.ts revenueLeaks: no Pulse, no money
 *       field, no invoice number, no 720), so money hidden only by the client
 *       still fails.
 *   I7  Load time at 375px on throttled 3G is tracked against a 3-second budget
 *       (recorded, never pass/fail).
 *
 * Not a Playwright bullet: "WOS-C01 and the D-72 mount test still pass" names
 * two web unit suites (command-actions-ops-scope.test.tsx and
 * approved-actions-mount.test.tsx); GATE-JOURNEY-RUN runs them with the web
 * suite, not here.
 *
 * Doors: Today is /app/command-center (label 'Today'; D-151). Its four blocks
 * are regions headed "Needs you", "Today", "Pulse" and "Get set up"
 * (TODAY-4BLOCK). Money > Overview is reached as journey H reaches it (the
 * Overview's own page, /app/financial-flow, when Money offers no entry).
 *
 * Prerequisites are made through the API, as the screens before them would make
 * them: a customer, a booking today (a service, a staff member, opening hours),
 * an invoice due today, a task due today, an order to fulfil, a staff member's
 * approval request, and a customer's 'I've paid by bank transfer' claim.
 *
 * RED at the GATE-JOURNEYS-A-F head (e63bcb1a), observed on both projects in
 * the ai-disabled and key-disabled variants (the packet return holds the
 * report): I1 Today is the Business Command Center, 74 headings ('Business
 * Command Center', "Today's KEY Summary", ...) and none of the four blocks,
 * and it makes no GET .../today (TODAY-4BLOCK, TODAY-AGGREGATE; the headline);
 * I2, I3, I4 and I6 find no Needs you, Today or Pulse block; I5 'Command
 * Center' and 'Genome' labels, percentages and risk counts on a fresh
 * business's Today (BUG-069). I7 passes: it records the load time (about 10 s
 * at 375px on 3G, against the 3-second budget) and never fails on it. I2b and
 * I3b are @ai-on or @scheduler legs and do not run here.
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
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const localDay = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The four blocks of Today (TODAY-4BLOCK), by heading. */
const BLOCKS = [/^needs you$/i, /^today$/i, /^pulse$/i, /^get set up$/i] as const;

async function seedCustomer(request: APIRequestContext, owner: Tenant, first: string) {
  const last = `Today${stamp()}`;
  const c = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts`, {
    firstName: first,
    lastName: last,
    phone: `+1868${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
    email: `${last.toLowerCase()}@v62j.test.local`,
  });
  return { id: c.id, name: `${first} ${last}` };
}

/** A booking today in Port of Spain: hours 06:00-23:59, a 30-minute service, a staff member, the slot at 23:00 (or the next half hour). */
async function seedBookingToday(request: APIRequestContext, owner: Tenant, customer: { id: string }) {
  const slug = `${RUN.replace(/_/g, "-")}-i-${stamp()}`.toLowerCase();
  await api(request, owner, "PATCH", `/identity/businesses/${owner.businessId}`, {
    slug,
    businessHours: Object.fromEntries(DAYS.map((d) => [d, { open: "06:00", close: "23:59", closed: false }])),
  });
  const service = await api<{ id: string; name: string }>(request, owner, "POST", `/bookings/businesses/${owner.businessId}/services`, {
    name: `Braiding ${stamp()}`,
    duration: 30,
    price: 150,
    currency: owner.currency,
  });
  const staff = await api<{ id: string; name: string }>(request, owner, "POST", `/bookings/businesses/${owner.businessId}/staff`, { name: `Aaliyah ${stamp()}` });
  const start = new Date(`${localDay(new Date())}T23:00:00-04:00`);
  const booking = await api<{ id: string }>(request, owner, "POST", `/bookings/businesses/${owner.businessId}`, {
    contactId: customer.id,
    serviceId: service.id,
    staffId: staff.id,
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
  });
  return { id: booking.id, service: service.name };
}

/** An invoice sent today, due today. */
async function seedInvoiceDueToday(request: APIRequestContext, owner: Tenant, contactId: string, total: number) {
  const inv = await api<{ id: string; invoiceNumber: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices`, {
    contactId,
    currency: owner.currency,
    dueDate: localDay(new Date()),
    items: [{ description: "Hair treatment", quantity: 1, unitPrice: total }],
  });
  await api(request, owner, "PATCH", `/commerce/invoices/${inv.id}/status/sent`, { businessId: owner.businessId, status: "SENT" });
  return inv;
}

/** A customer's 'I've paid by bank transfer' on the invoice's /pay/link, from the customer's own browser context. */
async function seedClaim(request: APIRequestContext, owner: Tenant, browser: Parameters<typeof anonymousContext>[0], invoiceId: string) {
  const link = await api<{ token: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices/${invoiceId}/payment-link`, {});
  const visitor = await anonymousContext(browser, { who: "customer" });
  const res = await visitor.request.post(`${API_URL}/commerce/public/invoice-link/${link.token}/payment-intent`, { data: { method: "bank_transfer" } });
  expect(res.status(), `the customer's claim: ${await res.text()}`).toBeLessThan(300);
}

/** A task due today on the customer's record. */
async function seedTaskToday(request: APIRequestContext, owner: Tenant, contactId: string) {
  const title = `Call about colour ${stamp()}`;
  await api(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts/${contactId}/tasks`, { title, dueDate: new Date(`${localDay(new Date())}T20:00:00-04:00`).toISOString() });
  return title;
}

/** An order to fulfil: a product, and an order the owner took for a customer (unpaid, to fulfil). */
async function seedOrderToFulfil(request: APIRequestContext, owner: Tenant, customerName: string) {
  const product = await api<{ id: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/products`, {
    name: `Shea butter ${stamp()}`,
    price: 60,
    currency: owner.currency,
    category: "PRODUCT",
  });
  const order = await api<{ id: string; orderNumber: string }>(request, owner, "POST", `/marketplace/businesses/${owner.businessId}/orders`, {
    customerName,
    customerEmail: `${customerName.split(" ").at(-1)!.toLowerCase()}@v62j.test.local`,
    currency: owner.currency,
    items: [{ productId: product.id, quantity: 2 }],
  });
  return order;
}

/**
 * Opens Today and lets it settle; closes the KEY drawer if it opened by itself
 * (journey K reports that). Before anything reads Today's text, it waits for a
 * block heading (up to 15 s) and then for the headings to stop changing, so a
 * read (I1's count, I5's and I6's 'not shown') sees the loaded screen, not its
 * loading state.
 */
async function openToday(page: Page): Promise<Locator> {
  await page.goto("/app/command-center");
  await settle(page, 2_000);
  const closeKey = page.getByRole("button", { name: /close chat/i }).filter({ visible: true });
  if (await closeKey.count()) await closeKey.first().click();
  const main = page.locator("main").first();
  const blockHeading = main.getByRole("heading").filter({ hasText: /^\s*(needs you|today|pulse|get set up)\s*$/i });
  await blockHeading.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  let last = -1;
  for (let round = 0; round < 12; round += 1) {
    const now = await main.getByRole("heading").filter({ visible: true }).count();
    if (now === last) break;
    last = now;
    await page.waitForTimeout(1_000);
  }
  return main;
}

/** A block of Today by its heading: the region it heads. */
function block(main: Locator, heading: RegExp): Locator {
  return main
    .getByRole("region", { name: heading })
    .or(main.locator("section").filter({ has: main.page().getByRole("heading", { name: heading }) }))
    .first();
}

/**
 * The headings of Today's blocks: the level-2 headings when the four block
 * names are among them (TODAY-4BLOCK heads each block so), else every heading
 * in main (what Today shows instead of blocks).
 */
async function blockHeadings(main: Locator): Promise<{ blocks: string[]; all: string[] }> {
  const clean = (ts: string[]) => ts.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
  const h2 = clean(await main.getByRole("heading", { level: 2 }).filter({ visible: true }).allInnerTexts());
  const all = clean(await main.getByRole("heading").filter({ visible: true }).allInnerTexts());
  return { blocks: h2.some((h) => BLOCKS.some((re) => re.test(h))) ? h2 : all, all };
}

test.describe("journey I: know what to do today", () => {
  test.use({ timezoneId: ZONE });

  test("I1 Today has exactly 4 blocks, served by one server read", async ({ page, request, owner, browser }) => {
    test.setTimeout(5 * 60_000);
    const customer = await seedCustomer(request, owner, "Maria");
    await seedBookingToday(request, owner, customer);
    const invoice = await seedInvoiceDueToday(request, owner, customer.id, 450);
    await seedClaim(request, owner, browser, invoice.id);

    const reads: string[] = [];
    page.on("response", (r) => {
      if (r.request().method() === "GET" && r.url().startsWith(`${API_URL}/`)) reads.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });
    const main = await openToday(page);
    const { blocks: headings, all } = await blockHeadings(main);
    const sections = await main.locator("section").count();
    test.info().annotations.push({ type: "today-structure", description: `${sections} sections, ${all.length} headings: ${JSON.stringify(all)}` });
    test.info().annotations.push({ type: "today-reads", description: reads.join("; ").slice(0, 2000) });

    await test.step("four blocks: Needs you, Today, Pulse, Get set up", async () => {
      const found = BLOCKS.map((re) => headings.filter((h) => re.test(h)).length);
      expect.soft(found, `one heading each for Needs you, Today, Pulse, Get set up (Today shows ${all.length} headings in ${sections} sections: ${JSON.stringify(all).slice(0, 600)})`).toEqual([1, 1, 1, 1]);
      expect.soft(headings.length, `exactly 4 blocks (Today shows ${headings.length} block headings)`).toBe(4);
    });

    await test.step("served by one server read (GET .../today)", async () => {
      const today = reads.filter((r) => /\/today(\?|$)/.test(r.split(" ")[1]));
      expect.soft(today.map((r) => r.split(" ")[0]), "one GET .../today, answered 200 (TODAY-AGGREGATE)").toEqual(["200"]);
    });
  });

  test("I2 Needs you lists approvals and bank-transfer claims, each with its inline actions", async ({ page, request, owner, browser }) => {
    test.setTimeout(6 * 60_000);
    const customer = await seedCustomer(request, owner, "Kezia");
    const invoice = await seedInvoiceDueToday(request, owner, customer.id, 380);
    await seedClaim(request, owner, browser, invoice.id);
    const staff = await memberOf(request, owner, "front desk", { role: "STAFF", scopes: { bookings: "write", crm: "read", expenses: "write" } });
    const title = `New blender for the salon ${stamp()}`;
    const approval = await api<{ id: string }>(request, staff, "POST", `/businesses/${owner.businessId}/approvals`, {
      requestType: "expense",
      title,
      description: "TTD 1,200 at Courts",
      threshold: 1200,
      steps: [{ stepOrder: 1, approverId: owner.sub }],
    });

    const main = await openToday(page);
    const needs = block(main, BLOCKS[0]);
    await expect(needs, "Today's Needs you").toBeVisible();

    await test.step("the staff member's approval request, with Approve and Reject", async () => {
      const item = needs.locator("li, [role=listitem], article, div").filter({ hasText: title }).filter({ has: page.getByRole("button", { name: /^approve/i }) }).last();
      await expect(item, `Needs you lists '${title}' with Approve`).toBeVisible();
      await expect(item.getByRole("button", { name: /^reject/i }).first(), "and Reject").toBeVisible();
      await item.getByRole("button", { name: /^approve/i }).first().click();
      await expect
        .poll(async () => (await api<{ status: string }>(request, owner, "GET", `/businesses/${owner.businessId}/approvals/${approval.id}`)).status, { message: "Approve in Needs you approves the request" })
        .toMatch(/APPROVED/i);
    });

    await test.step("the customer's bank-transfer claim, with Confirm and Not yet", async () => {
      const item = needs.locator("li, [role=listitem], article, div").filter({ hasText: /380/ }).filter({ has: page.getByRole("button", { name: /^confirm/i }) }).last();
      await expect(item, "Needs you lists the 380.00 claim with Confirm").toBeVisible();
      await expect(item.getByRole("button", { name: /^not yet$/i }).first(), "and Not yet").toBeVisible();
    });
  });

  test("I2b Needs you lists a proposal KEY made on its own", { tag: ["@ai-on", "@scheduler"] }, async ({ page, request, owner }) => {
    // GATE-STAGING-RUN with AI on and a KEY job switched on for the run (crons ruling D-163 keeps them off in production).
    test.setTimeout(15 * 60_000);
    const customer = await seedCustomer(request, owner, "Leon");
    const invoice = await api<{ id: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices`, {
      contactId: customer.id,
      currency: owner.currency,
      dueDate: localDay(new Date(Date.now() - 20 * 86_400_000)),
      items: [{ description: "Wholesale order", quantity: 1, unitPrice: 2400 }],
    });
    await api(request, owner, "PATCH", `/commerce/invoices/${invoice.id}/status/sent`, { businessId: owner.businessId, status: "SENT" });
    await expect
      .poll(async () => {
        const main = await openToday(page);
        const needs = block(main, BLOCKS[0]);
        return needs.locator("li, [role=listitem], article, div").filter({ has: page.getByRole("button", { name: /^(approve|run)/i }) }).filter({ hasText: /KEY|suggest|propos/i }).count();
      }, { timeout: 12 * 60_000, intervals: [30_000], message: "a proposal KEY made on its own, in Needs you with Approve / Run" })
      .toBeGreaterThan(0);
  });

  test("I3 the Today block lists today's bookings, due invoices, tasks and orders, each one tap from its action", async ({ page, request, owner }) => {
    test.setTimeout(6 * 60_000);
    const customer = await seedCustomer(request, owner, "Simone");
    const booking = await seedBookingToday(request, owner, customer);
    const invoice = await seedInvoiceDueToday(request, owner, customer.id, 600);
    const task = await seedTaskToday(request, owner, customer.id);
    const order = await seedOrderToFulfil(request, owner, customer.name);

    const main = await openToday(page);
    const today = block(main, BLOCKS[1]);
    await expect(today, "Today's 'Today' block").toBeVisible();

    // Each item by what only its own row shows: the customer's name may be on every row (the booking's, the
    // invoice's, the task's and the order's), so it identifies none of them.
    const items = [
      ["today's booking", booking.service],
      ["the invoice due today", invoice.invoiceNumber],
      ["the task due today", task],
      ["the order to fulfil", order.orderNumber],
    ] as const;
    for (const [what, text] of items) {
      await test.step(`${what}, with its action on its own row`, async () => {
        await expect(today.getByText(text).first(), `the Today block lists ${what} ('${text}')`).toBeVisible();
        const others = items.map(([, t]) => t).filter((t) => t !== text);
        // journey-text.ts oneTapIn, run in the page: from the item's text up to its row, an action of its own.
        expect.soft(await today.evaluate(oneTapIn, { text, others: [...others] }), `${what} is one tap from its action (a button or link on its own row)`).toBe(true);
      });
    }

    await test.step("one tap on the invoice opens it", async () => {
      // The row's link (the row itself, or a link naming the invoice), else its own action button, else the row.
      const link = today.getByRole("link").filter({ hasText: invoice.invoiceNumber }).filter({ visible: true });
      const row = today.locator("li, [role=listitem], article, tr").filter({ hasText: invoice.invoiceNumber }).last();
      const button = row.getByRole("button").or(row.getByRole("link")).filter({ visible: true });
      if (await link.count()) await link.first().click();
      else if (await button.count()) await button.first().click();
      else await today.getByText(invoice.invoiceNumber).first().click();
      await expect(page.getByText(invoice.invoiceNumber).first(), "the invoice opens").toBeVisible();
      expect(page.url(), "the invoice's page or sheet").toMatch(new RegExp(`${escapeRe(invoice.id)}|invoice`, "i"));
    });
  });

  test("I3b overdue invoices and 'ready to send' reminders show in Today, each one tap from WhatsApp", { tag: "@scheduler" }, async ({ page, request, owner }) => {
    // GATE-SCHEDULER-RUN: the overdue job and the run's server clock make the invoice OVERDUE and tomorrow's booking due a reminder.
    test.setTimeout(15 * 60_000);
    const customer = await seedCustomer(request, owner, "Darius");
    const invoice = await api<{ id: string; invoiceNumber: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices`, {
      contactId: customer.id,
      currency: owner.currency,
      dueDate: localDay(new Date(Date.now() - 3 * 86_400_000)),
      items: [{ description: "Catering deposit", quantity: 1, unitPrice: 900 }],
    });
    await api(request, owner, "PATCH", `/commerce/invoices/${invoice.id}/status/sent`, { businessId: owner.businessId, status: "SENT" });
    await expect
      .poll(async () => {
        const main = await openToday(page);
        const row = block(main, BLOCKS[1]).locator("li, [role=listitem], article, div").filter({ hasText: invoice.invoiceNumber }).filter({ hasText: /overdue/i });
        return row.count();
      }, { timeout: 10 * 60_000, intervals: [30_000], message: "the overdue invoice in Today" })
      .toBeGreaterThan(0);
    const ready = page.locator("main").first().locator("section, [role=region], div").filter({ has: page.getByRole("heading", { name: /ready to send/i }) }).last();
    await expect(ready.getByText(customer.name).first(), "its reminder is ready to send").toBeVisible();
    await expect(ready.getByRole("link", { name: /whatsapp/i }).or(ready.getByRole("button", { name: /whatsapp/i })).first(), "one tap from WhatsApp").toBeVisible();
  });

  test("I4 Pulse equals Money > Overview", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    const customer = await seedCustomer(request, owner, "Priya");
    const invoice = await seedInvoiceDueToday(request, owner, customer.id, 1000);
    await api(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices/${invoice.id}/payments`, { amount: 400, method: "Cash", idempotencyKey: `${invoice.id}-i4` });
    await api(request, owner, "POST", `/expenses/businesses/${owner.businessId}/expenses`, {
      description: `Supplies ${stamp()}`,
      amount: 120,
      currency: owner.currency,
      date: localDay(new Date()),
      paymentMethod: "CASH",
    });
    // A bill to pay later, so 'you owe' is 250 on both screens, not 0 = 0.
    await api(request, owner, "POST", `/finance/businesses/${owner.businessId}/bills`, {
      description: `Electricity ${stamp()}`,
      amount: 250,
      currency: owner.currency,
      date: localDay(new Date()),
      dueDate: localDay(new Date(Date.now() + 14 * 86_400_000)),
      vendor: "T&TEC",
    });
    // The five Pulse figures TODAY-AGGREGATE names (journey H's Overview set); each must be shown.
    const PULSE = {
      cash: /\bcash(?: balance| on hand)?\b/i,
      owedToYou: /owed to you|money owed|receivable/i,
      youOwe: /you owe|bills (?:due|to pay)|payable/i,
      profit: /(?:this month'?s )?(?:net )?profit/i,
      safeToSpend: /safe.to.spend/i,
    };
    // Figures Pulse may also show; compared when it does.
    const ALSO = {
      moneyIn: /money in\b/i,
      moneyOut: /money out\b/i,
    };
    const LABELS = { ...PULSE, ...ALSO };

    const main = await openToday(page);
    const pulse = block(main, BLOCKS[2]);
    await expect(pulse, "Today's Pulse").toBeVisible();
    const pulseText = (await pulse.innerText()).replace(/\s+/g, " ");
    const shownOnPulse = Object.fromEntries(Object.entries(LABELS).map(([k, re]) => [k, amountAfter(pulseText, re)]));

    await page.goto("/app/financial-flow");
    await settle(page, 1_500);
    const overviewText = (await page.locator("main").first().innerText()).replace(/\s+/g, " ");
    const shownOnOverview = Object.fromEntries(Object.entries(LABELS).map(([k, re]) => [k, amountAfter(overviewText, re)]));
    test.info().annotations.push({ type: "pulse-vs-overview", description: `Pulse ${JSON.stringify(shownOnPulse)}; Overview ${JSON.stringify(shownOnOverview)}` });

    for (const key of Object.keys(PULSE)) {
      expect.soft(shownOnPulse[key], `Pulse shows ${key}`).not.toBeNull();
      expect.soft(shownOnPulse[key], `Pulse's ${key} equals Money > Overview's`).toBe(shownOnOverview[key]);
    }
    expect.soft(shownOnPulse.youOwe, "Pulse's 'you owe' holds the 250 bill").toBe(250);
    for (const key of Object.keys(ALSO)) {
      if (shownOnPulse[key] === null) continue;
      expect.soft(shownOnPulse[key], `Pulse's ${key} equals Money > Overview's`).toBe(shownOnOverview[key]);
    }
  });

  test("I5 no metaphor labels or invented statistics on a fresh business's Today", async ({ page }) => {
    test.setTimeout(3 * 60_000);
    const main = await openToday(page);
    const text = (await main.innerText()).replace(/\s+/g, " ");
    const metaphors = [/\bgenome\b/i, /\bhull\b/i, /\bcortex\b/i, /\bconstitution\b/i, /\bfuel\b/i, /command center/i, /mission control/i, /risk dna/i, /\bpresence\b/i]
      .filter((re) => re.test(text))
      .map((re) => re.source);
    expect.soft(metaphors, "metaphor or internal labels on Today (one name per thing, in plain words)").toEqual([]);
    const percentages = text.match(/\b\d{1,3}(?:\.\d+)?\s?%/g) ?? [];
    expect.soft(percentages, "percentages on a fresh business's Today (no scores on day one)").toEqual([]);
    const risks = text.match(/\b\d+\s+(?:high-priority\s+)?risks?\b|\brisks?\s*:?\s*\d+\b/gi) ?? [];
    expect.soft(risks, "risk counts on a fresh business's Today").toEqual([]);
  });

  test("I6 a staff member sees only tiles for their modules, and no Pulse without revenue read", async ({ request, owner, browser }) => {
    test.setTimeout(6 * 60_000);
    const customer = await seedCustomer(request, owner, "Tamika");
    const booking = await seedBookingToday(request, owner, customer);
    const invoice = await seedInvoiceDueToday(request, owner, customer.id, 720);
    // Front desk: bookings and customers, no money (revenue none).
    const staff = await memberOf(request, owner, "front desk", { role: "STAFF", scopes: { bookings: "write", crm: "read" } });
    const desk = await signedInContext(browser, staff);
    const page = await desk.newPage();
    // The member's own GET .../today (TODAY-AGGREGATE's one read): what the server sent, not only what the screen shows.
    const todayRead = page
      .waitForResponse((r) => r.request().method() === "GET" && r.url().startsWith(`${API_URL}/`) && /\/today$/.test(new URL(r.url()).pathname), { timeout: 30_000 })
      .catch(() => null);
    const main = await openToday(page);
    const text = (await main.innerText()).replace(/\s+/g, " ");

    await test.step("the member's GET .../today carries no Pulse, no money field and no invoice", async () => {
      const read = await todayRead;
      expect.soft(read, "the member's Today is served by GET .../today (TODAY-AGGREGATE)").not.toBeNull();
      if (read) {
        expect.soft(read.status(), "the member's GET .../today").toBe(200);
        const body: unknown = await read.json().catch(() => null);
        const leaks = revenueLeaks(body, { invoiceNumbers: [invoice.invoiceNumber], amounts: [720] });
        test.info().annotations.push({ type: "member-today", description: leaks.join("; ") || "no money in the member's Today answer" });
        expect.soft(leaks, "money in the Today answer of a member without revenue read").toEqual([]);
      }
    });
    await test.step("the booking (bookings scope) is on their Today", async () => {
      await expect(block(main, BLOCKS[1]).getByText(booking.service).first(), "today's booking, in the Today block").toBeVisible();
    });
    await test.step("no invoice and no money for a member without revenue read", async () => {
      expect.soft(text.includes(invoice.invoiceNumber), `the invoice ${invoice.invoiceNumber} on a front-desk Today`).toBe(false);
      expect.soft(await main.getByRole("heading", { name: BLOCKS[2] }).count(), "a Pulse block for a member without revenue read").toBe(0);
      expect.soft(text, "money figures on a front-desk Today").not.toMatch(/\b(TTD|TT\$|USD)\s?[\d,]+\.\d{2}/);
    });
  });

  test("I7 Today's load at 375px on throttled 3G (tracked against the 3 s budget, not pass/fail)", async ({ page }, testInfo) => {
    test.setTimeout(6 * 60_000);
    await openToday(page);
    await recordLoadTiming(page, testInfo, "today-i7", "/app/command-center", (p) =>
      p.locator("main").first().getByRole("heading").first().waitFor({ state: "visible", timeout: 120_000 }),
    );
  });
});
