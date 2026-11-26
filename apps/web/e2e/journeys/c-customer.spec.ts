import {
  test,
  expect,
  API_URL,
  coveredButtonFindings,
  memberOf,
  signedInContext,
  settle,
  type Tenant,
} from "./journey-helpers";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

/**
 * GATE-JOURNEYS-A-F, journey C: one customer record (product audit
 * core_journeys_v1 C; KF-JOURNEY-003, first half). Each bullet of C's
 * definition of done is a test (C1..C8), on both journey projects, in every
 * variant (README.md in this folder).
 *
 *   C1  Add a customer, quick or full, from Customers and from the header New
 *       menu; no banner blocks either door.
 *   C2  The phone number is stored in E.164, using the business's country
 *       (Trinidad and Tobago: +1 868).
 *   C3  A refusal (duplicate, or no access) keeps the form open and says why.
 *   C4  Every link to a customer opens /app/crm/contacts/<id>: from the list,
 *       Cmd/Ctrl+K, Today and documents.
 *   C5  The detail page shows only this customer's quotes, invoices, payments,
 *       bookings, notes and tasks (each customer's booking is of a service of
 *       their own, so either's booking can be told apart).
 *   C6  Labels are plain (no event codes, raw ids or stored values).
 *   C7  CSV import, tags, trash and undo work: a delete reaches the server
 *       and the customer is gone; the trash lists them and Restore brings them
 *       back; Undo inside the window keeps them.
 *   C8  At 375px the list is the first thing on screen (asserted on both
 *       projects: the first row is on screen, in the top half, unscrolled).
 *
 * Doors: Customers is /app/crm/contacts with an "Add contact" quick dialog
 * (fields First name "Jane", Last name "Doe", Email, Phone; "Open full form"
 * opens the full form "Add New Contact"); the header's "New" menu has
 * "Contact". A refusal's reason shows in the still-open dialog or in a toast
 * while the dialog stays open and filled (FAILURE-KIT: one toast that keeps
 * the form open; the app's toaster is mounted at the root, outside the
 * dialog). Trash is /app/trash, whose rows offer Restore. The detail page's
 * tabs are the links under /app/crm/contacts/<id>/ (the v1 tab set is
 * Overview, Money, Bookings, Notes and tasks, Details; the test reads every
 * tab the page links, whatever their names). The second customer, the
 * documents and the bookings each test reads are made through the API.
 *
 * RED at the GATE-HARNESS head (02e498e8), observed on both projects in the
 * ai-disabled and key-disabled variants (the packet return holds the report):
 * C1 the header New menu's Contact is under the Genome banner and cannot be
 * clicked (BUG-041); C2 the phone is stored as typed, '7xx-xxxx'
 * (WA-E164-SERVER); C3 the quick dialog closes on the 409 (BUG-009); C4
 * /app/crm/contacts/<id> opens 'Could not load this contact - Missing id'
 * (BUG-038); C5 the Tasks tab's read answers 500 (BUG-036), while this
 * customer's quote, invoice, payment, booking, note and task all show and
 * another customer's do not (BUG-030 did not reproduce); C6 the contact's id
 * on every tab (BUG-123) and 'Note.Created' / 'Contact.Created' on the
 * timeline (BUG-129); C8 the first row is off screen (375x812) or 1,400 px
 * down (1440x900). C7 (CSV import, tags, trash and Undo) passes.
 */

/**
 * C6's whole-word detector (FU-CONTACT-PAGES-RAW-STATUS): the stored one-word and snake codes the customer's pages
 * read (packages/db InvoiceStatus, QuoteStatus, BookingStatus; the contact statuses; task priorities). Matched case
 * sensitively as whole words, so "Lead" or "High" in a sentence is not a finding and "LEAD" is.
 */
const STORED_CODES = [
  "DRAFT", "SENT", "VIEWED", "PAID", "PARTIALLY_PAID", "PARTIAL", "OVERDUE", "VOID", "FAILED", "PENDING",
  "FULLY_CREDITED", "PARTIALLY_CREDITED", "ACCEPTED", "REJECTED", "EXPIRED", "INVOICED", "CONVERTED",
  "CONFIRMED", "UNCONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW",
  "LEAD", "PROSPECT", "CLIENT", "LOST",
  "HIGH", "NORMAL", "MEDIUM", "LOW", "URGENT",
];
const STORED_WORD = new RegExp(`\\b(${STORED_CODES.join("|")})\\b`, "g");
/** The same codes in lower case, as the whole text of one element (a badge). */
const LOWER_CODES = new Set(STORED_CODES.map((c) => c.toLowerCase()));
/** A lower-case event code: "invoice.paid", "payment.received", "recurring_invoice.generated". */
const LOWER_EVENT_CODE = /\b(invoice|payment|quote|booking|note|contact|task|recurring_invoice)\.[a-z_]+\b/g;

const auth = (t: Tenant) => ({ Authorization: `Bearer ${t.token}` });

async function api<T = Record<string, unknown>>(
  request: APIRequestContext,
  owner: Tenant,
  method: "GET" | "POST" | "PATCH",
  path: string,
  data?: unknown,
  expected?: number,
): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, { method, headers: auth(owner), data });
  const text = await res.text();
  expect(res.status(), `${method} ${path}: ${text.slice(0, 400)}`).toBe(expected ?? (method === "POST" ? 201 : 200));
  return (text ? JSON.parse(text) : null) as T;
}

const stamp = () => `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;
/** A Trinidad and Tobago mobile number, seven digits, unique to the run. */
const localTtNumber = () => `7${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;

async function seedContact(request: APIRequestContext, owner: Tenant, firstName: string, lastName: string, extra: Record<string, unknown> = {}) {
  return api<{ id: string; firstName: string; lastName: string }>(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts`, { firstName, lastName, ...extra });
}

async function seedSentInvoice(request: APIRequestContext, owner: Tenant, contactId: string, description: string, dueDate?: string) {
  const inv = await api<{ id: string; invoiceNumber: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices`, {
    contactId,
    currency: owner.currency,
    items: [{ description, quantity: 1, unitPrice: 200 }],
    ...(dueDate ? { dueDate } : {}),
  });
  await api(request, owner, "PATCH", `/commerce/invoices/${inv.id}/status/sent`, { businessId: owner.businessId, status: "SENT", ...(dueDate ? { dueDate } : {}) });
  return inv;
}

/** The Customers quick dialog (role dialog "Add contact"). */
const quickDialog = (page: Page) => page.getByRole("dialog", { name: /^add contact$/i });

async function openQuickAdd(page: Page): Promise<Locator> {
  await page.goto("/app/crm/contacts");
  await page.getByRole("button", { name: /^add contact$/i }).filter({ visible: true }).first().click();
  const dialog = quickDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * The refusal's reason, where it may show while the form stays open: inside
 * the dialog, or in a toast (the app's sonner <Toaster>, mounted at the root
 * outside the dialog; FAILURE-KIT's one toast that keeps the form open).
 */
function refusalShown(page: Page, dialog: Locator, reason: RegExp): Locator {
  return dialog
    .getByText(reason)
    .or(page.locator("[data-sonner-toast], [role=alert]").filter({ hasText: reason }))
    .filter({ visible: true })
    .first();
}

const contactPath = (businessId: string) => (r: { request(): { method(): string }; url(): string }) =>
  r.request().method() === "POST" && new URL(r.url()).pathname === `/crm/businesses/${businessId}/contacts`;

/** Closes the KEY drawer if it opened by itself (A9 reports that), so the page under it can be used. */
async function closeKeyDrawer(page: Page): Promise<void> {
  const drawer = page.getByRole("heading", { name: /^KEY$/ }).filter({ visible: true });
  // The shell opens it about 2 s after Today loads; give it the time keyUiFindings gives it.
  await drawer.first().waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  for (let i = 0; i < 3 && (await drawer.count()); i++) {
    const close = page.getByRole("button", { name: /^close chat$/i }).filter({ visible: true });
    if (await close.count()) await close.first().click();
    else await page.keyboard.press("Escape");
    await drawer.first().waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
  }
}

/** The detail page of a customer has loaded: its heading names them, and it is not the 'Missing id' state. */
async function expectContactPage(page: Page, contactId: string, name: string): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/app/crm/contacts/${contactId}(/overview)?([?#].*)?$`));
  const heading = page.getByRole("heading", { level: 1, name });
  const refused = page.getByText(/missing id|could not load this contact/i);
  // Whichever the page settles on: the customer, or the error state.
  await expect(heading.or(refused).first()).toBeVisible();
  await expect(refused, `the customer page loads, not 'Could not load this contact - Missing id' (BUG-038)`).toHaveCount(0);
  await expect(heading).toBeVisible();
}

test.describe("journey C: one customer record", () => {
  test("C1 add a customer, quick or full, from Customers and from the header New menu; no banner blocks either door", async ({ page, owner }) => {
    test.setTimeout(5 * 60_000);

    await test.step("Customers > Add contact (quick) creates the customer", async () => {
      const dialog = await openQuickAdd(page);
      const last = `Quick${stamp()}`;
      await dialog.getByPlaceholder("Jane", { exact: true }).fill("Ama");
      await dialog.getByPlaceholder("Doe", { exact: true }).fill(last);
      const created = page.waitForResponse(contactPath(owner.businessId));
      await dialog.getByRole("button", { name: /^add contact$/i }).click();
      expect((await created).status()).toBe(201);
      await expect(page.getByText(last).first()).toBeVisible();
    });

    await test.step("Customers > Add contact > Open full form creates the customer", async () => {
      const dialog = await openQuickAdd(page);
      await dialog.getByRole("button", { name: /open full form/i }).click();
      const form = page.getByRole("dialog").filter({ hasText: /add new contact/i }).last();
      await expect(form).toBeVisible();
      const last = `Full${stamp()}`;
      await form.locator("#contact-form-firstName").fill("Bryce");
      await form.locator("#contact-form-lastName").fill(last);
      const created = page.waitForResponse(contactPath(owner.businessId));
      await form.getByRole("button", { name: /^add contact$/i }).click();
      expect((await created).status()).toBe(201);
      await expect(page.getByText(last).first()).toBeVisible();
    });

    await test.step("the header New menu's Contact is not covered, and it opens a new-customer form that saves", async () => {
      await page.goto("/app/command-center");
      await settle(page);
      await closeKeyDrawer(page);
      const newButton = page.getByRole("button", { name: /^new\b/i }).filter({ visible: true }).first();
      expect(await coveredButtonFindings([{ what: "the header's New", locator: newButton }]), "the header's New door").toEqual([]);
      await newButton.click();
      const item = page.getByRole("menuitem", { name: /^contact/i }).filter({ visible: true }).first();
      await expect(item).toBeVisible();
      const covered = await coveredButtonFindings([{ what: "the header New menu's 'Contact'", locator: item }]);
      expect.soft(covered, "the New menu's Contact door (BUG-041)").toEqual([]);
      await item.click();
      await page.waitForURL(/\/app\/crm\/contacts/);
      const dialog = page.getByRole("dialog").filter({ hasText: /add (new )?contact/i }).filter({ visible: true }).last();
      await expect(dialog, "New > Contact opens a new-customer form").toBeVisible();
      const last = `Menu${stamp()}`;
      const first = dialog.getByPlaceholder("Jane", { exact: true }).or(dialog.locator("#contact-form-firstName")).first();
      await first.fill("Cleo");
      await dialog.getByPlaceholder("Doe", { exact: true }).or(dialog.locator("#contact-form-lastName")).first().fill(last);
      const created = page.waitForResponse(contactPath(owner.businessId));
      await dialog.getByRole("button", { name: /^add contact$/i }).click();
      expect((await created).status()).toBe(201);
    });
  });

  test("C2 the phone number is stored in E.164 with the business's country (+1 868)", async ({ page, request, owner }) => {
    test.setTimeout(3 * 60_000);
    const digits = localTtNumber();
    const typed = `${digits.slice(0, 3)}-${digits.slice(3)}`;
    let contactId = "";

    await test.step(`quick-add a customer with the local number ${typed}`, async () => {
      const dialog = await openQuickAdd(page);
      await dialog.getByPlaceholder("Jane", { exact: true }).fill("Dara");
      await dialog.getByPlaceholder("Doe", { exact: true }).fill(`Phone${stamp()}`);
      await dialog.getByPlaceholder(/868/).fill(typed);
      const created = page.waitForResponse(contactPath(owner.businessId));
      await dialog.getByRole("button", { name: /^add contact$/i }).click();
      const res = await created;
      expect(res.status(), await res.text()).toBe(201);
      contactId = ((await res.json()) as { id: string }).id;
    });

    await test.step("the stored phone is +1868 and the seven digits", async () => {
      const detail = await api<{ contact: { phone?: string | null } }>(request, owner, "GET", `/crm/businesses/${owner.businessId}/contacts/${contactId}`);
      expect(detail.contact.phone).toBe(`+1868${digits}`);
    });
  });

  test("C3 a refusal (duplicate phone, or no access) keeps the form open and says why", async ({ page, request, owner, browser }) => {
    test.setTimeout(5 * 60_000);
    const digits = localTtNumber();
    await seedContact(request, owner, "Existing", `Dup${stamp()}`, { phone: `+1868${digits}` });

    await test.step("a duplicate phone: 409, the dialog stays open with what was typed, and says why", async () => {
      const dialog = await openQuickAdd(page);
      const last = `Again${stamp()}`;
      await dialog.getByPlaceholder("Jane", { exact: true }).fill("Eve");
      await dialog.getByPlaceholder("Doe", { exact: true }).fill(last);
      await dialog.getByPlaceholder(/868/).fill(`+1868${digits}`);
      const refused = page.waitForResponse(contactPath(owner.businessId));
      await dialog.getByRole("button", { name: /^add contact$/i }).click();
      expect((await refused).status(), "the server refuses the duplicate").toBe(409);
      await expect(dialog, "the dialog stays open").toBeVisible();
      await expect(dialog.getByPlaceholder("Doe", { exact: true }), "what was typed is kept").toHaveValue(last);
      await expect(refusalShown(page, dialog, /already|duplicate|exists|in use/i), "the dialog or its toast says why").toBeVisible();
    });

    await test.step("no access: a member with read-only Customers access is refused, and the dialog says so", async () => {
      const member = await memberOf(request, owner, "front desk", { role: "STAFF", scopes: { crm: "read" } });
      const context = await signedInContext(browser, member);
      const memberPage = await context.newPage();
      const dialog = await openQuickAdd(memberPage);
      await dialog.getByPlaceholder("Jane", { exact: true }).fill("Finn");
      await dialog.getByPlaceholder("Doe", { exact: true }).fill(`Noaccess${stamp()}`);
      const refused = memberPage.waitForResponse(contactPath(owner.businessId));
      await dialog.getByRole("button", { name: /^add contact$/i }).click();
      expect((await refused).status(), "the server refuses a read-only member").toBe(403);
      await expect(dialog, "the dialog stays open").toBeVisible();
      await expect(refusalShown(memberPage, dialog, /no access|permission|not allowed|ask the owner|read[- ]only/i), "the dialog or its toast says why").toBeVisible();
    });
  });

  test("C4 every link to a customer opens /app/crm/contacts/<id>: the list, Cmd/Ctrl+K, Today and documents", async ({ page, request, owner }) => {
    test.setTimeout(6 * 60_000);
    const last = `Links${stamp()}`;
    const contact = await seedContact(request, owner, "Gina", last);
    const name = `Gina ${last}`;
    const today = new Date().toISOString().slice(0, 10);
    const invoice = await seedSentInvoice(request, owner, contact.id, "Hair treatment", today);

    await test.step("its address opens the customer (no 'Missing id')", async () => {
      await page.goto(`/app/crm/contacts/${contact.id}`);
      await expectContactPage(page, contact.id, name);
    });

    await test.step("from the Customers list", async () => {
      await page.goto("/app/crm/contacts");
      await page.getByText(name, { exact: true }).first().click();
      const open = page.locator(`a[href^="/app/crm/contacts/${contact.id}"]`).filter({ visible: true });
      if (!/\/app\/crm\/contacts\/[^/?]+/.test(page.url()) && (await open.count())) await open.first().click();
      await expectContactPage(page, contact.id, name);
    });

    await test.step("from Cmd/Ctrl+K", async () => {
      await page.goto("/app/command-center");
      await settle(page, 1_000);
      await page.keyboard.press("Escape");
      await page.keyboard.press("ControlOrMeta+k");
      const search = page.getByPlaceholder(/search/i).filter({ visible: true }).last();
      await expect(search).toBeVisible();
      await search.fill(last);
      // The palette's own result, inside its dialog: Today links the same customer (FCP-COR-1) behind the palette's
      // backdrop, and the first match in the document would be that link (FU-PALETTE-INERT: the palette does not make
      // the page behind it inert).
      const palette = page.getByRole("dialog").filter({ has: search });
      await palette.getByRole("option", { name: new RegExp(last) }).or(palette.getByRole("link", { name: new RegExp(last) })).first().click();
      await expectContactPage(page, contact.id, name);
    });

    await test.step("from Today (the invoice due today names its customer)", async () => {
      await page.goto("/app/command-center");
      await settle(page, 1_000);
      await page.keyboard.press("Escape");
      const link = page.getByRole("link", { name: new RegExp(name) }).filter({ visible: true });
      await expect(link.first(), "Today links the customer of the invoice due today").toBeVisible();
      await link.first().click();
      await expectContactPage(page, contact.id, name);
    });

    await test.step("from the invoice (its customer is a link)", async () => {
      await page.goto(`/app/commerce/invoices/${invoice.id}`);
      const link = page.getByRole("link", { name: new RegExp(name) }).filter({ visible: true });
      await expect(link.first(), "the invoice links its customer").toBeVisible();
      await link.first().click();
      await expectContactPage(page, contact.id, name);
    });
  });

  test("C5 the detail page shows only this customer's quotes, invoices, payments, bookings, notes and tasks", async ({ page, request, owner }) => {
    test.setTimeout(6 * 60_000);
    const staff = await api<{ id: string }>(request, owner, "POST", `/bookings/businesses/${owner.businessId}/staff`, { name: `Therapist ${stamp()}` });
    // Amounts no other record on the page carries (each service is 250, each invoice 200, each quote 90).
    // Each customer's booking is of a service of their own, named for them, so the booking shown on
    // a page says whose it is (the Bookings tab lists every booking of the business and filters them
    // in the browser: a broken filter shows the other customer's).
    const seed = async (first: string, dayOffset: number, payment: number) => {
      const booking = `${first === "Hana" ? "Massage" : "Facial"} for ${first} ${stamp()}`;
      const service = await api<{ id: string }>(request, owner, "POST", `/bookings/businesses/${owner.businessId}/services`, { name: booking, duration: 60, price: 250, currency: owner.currency });
      const last = `${first}${stamp()}`;
      const contact = await seedContact(request, owner, first, last);
      const invoice = await seedSentInvoice(request, owner, contact.id, `Invoice line for ${first}`);
      await api(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices/${invoice.id}/payments`, { amount: payment, method: "Cash", idempotencyKey: `${last}-pay` });
      const quote = await api<{ quoteNumber: string }>(request, owner, "POST", `/commerce/businesses/${owner.businessId}/quotes`, { contactId: contact.id, currency: owner.currency, items: [{ description: `Quote line for ${first}`, quantity: 1, unitPrice: 90 }] });
      const note = `Note for ${first} ${stamp()}`;
      const task = `Task for ${first} ${stamp()}`;
      await api(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts/${contact.id}/notes`, { body: note });
      await api(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts/${contact.id}/tasks`, { title: task });
      const start = new Date(Date.now() + dayOffset * 86_400_000);
      start.setUTCHours(15, 0, 0, 0);
      await api(request, owner, "POST", `/bookings/businesses/${owner.businessId}`, {
        contactId: contact.id,
        serviceId: service.id,
        staffId: staff.id,
        startTime: start.toISOString(),
        endTime: new Date(start.getTime() + 3_600_000).toISOString(),
      });
      return { contact, last, invoice: invoice.invoiceNumber, quote: quote.quoteNumber, note, task, payment: payment.toFixed(2), booking };
    };
    const a = await seed("Hana", 3, 37.25);
    const b = await seed("Ivan", 4, 61.75);

    let text = "";
    await test.step("read every tab of the customer's page", async () => {
      await page.goto(`/app/crm/contacts/${a.contact.id}/overview`);
      await expect(page.getByRole("heading", { level: 1, name: `Hana ${a.last}` })).toBeVisible();
      const hrefs = await page
        .locator(`a[href^="/app/crm/contacts/${a.contact.id}/"]`)
        .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("href") ?? ""))]);
      expect(hrefs.length, "the customer page has tabs").toBeGreaterThan(1);
      // Tabs load their lists after the page: read them until this customer's records show, or 3 times.
      const wanted = [a.quote, a.invoice, a.note, a.task, a.payment, a.booking];
      for (let round = 0; round < 3 && !wanted.every((w) => text.includes(w)); round++) {
        text = "";
        for (const href of hrefs) {
          await page.goto(href);
          await settle(page, 1_500 + round * 2_000);
          text += `\n${href}\n${await page.locator("main").first().innerText()}`;
        }
      }
      await test.info().attach("customer-page-text.txt", { contentType: "text/plain", body: text });
    });

    await test.step("this customer's quote, invoice, payment, booking, note and task are shown", async () => {
      for (const [what, needle] of [
        ["quote", a.quote],
        ["invoice", a.invoice],
        ["note", a.note],
        ["task", a.task],
      ] as const) {
        expect.soft(text.includes(needle), `${what} ${needle} on ${a.last}'s page`).toBe(true);
      }
      expect.soft(text.includes(a.payment), `the payment of ${a.payment} on the customer's page`).toBe(true);
      expect.soft(text.includes(a.booking), `the booking (${a.booking}) on the customer's page`).toBe(true);
    });

    await test.step("another customer's records are not shown, their booking included", async () => {
      const leaked = [b.quote, b.invoice, b.note, b.task, b.payment, b.booking].filter((needle) => text.includes(needle));
      expect(leaked, `${b.last}'s records on ${a.last}'s page (BUG-030)`).toEqual([]);
    });
  });

  test("C6 labels are plain on a customer's pages: no event codes, raw ids or stored values", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    const last = `Plain${stamp()}`;
    const contact = await seedContact(request, owner, "Jade", last);
    await api(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts/${contact.id}/notes`, { body: "Prefers mornings" });
    // FU-CONTACT-PAGES-RAW-STATUS (CDC-4): a note alone reaches none of the stored statuses the other tabs print.
    // A part-paid invoice, a quote, a no-show booking and a high-priority task do (the contact itself is a LEAD).
    const invoice = await seedSentInvoice(request, owner, contact.id, "Plain words line");
    await api(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices/${invoice.id}/payments`, { amount: 50, method: "Cash", idempotencyKey: `${last}-part` });
    await api(request, owner, "POST", `/commerce/businesses/${owner.businessId}/quotes`, { contactId: contact.id, currency: owner.currency, items: [{ description: "Plain words quote", quantity: 1, unitPrice: 90 }] });
    await api(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts/${contact.id}/tasks`, { title: "Plain words task", priority: "HIGH" });
    const staff = await api<{ id: string }>(request, owner, "POST", `/bookings/businesses/${owner.businessId}/staff`, { name: `Stylist ${stamp()}` });
    const service = await api<{ id: string }>(request, owner, "POST", `/bookings/businesses/${owner.businessId}/services`, { name: `Trim for Jade ${stamp()}`, duration: 60, price: 250, currency: owner.currency });
    const start = new Date(Date.now() + 2 * 86_400_000);
    start.setUTCHours(14, 0, 0, 0);
    const booking = await api<{ id: string }>(request, owner, "POST", `/bookings/businesses/${owner.businessId}`, {
      contactId: contact.id,
      serviceId: service.id,
      staffId: staff.id,
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 3_600_000).toISOString(),
    });
    await api(request, owner, "POST", `/bookings/businesses/${owner.businessId}/bookings/${booking.id}/status`, { status: "NO_SHOW", cancelledBy: "BUSINESS" });
    const stored = await api<{ data?: Array<{ id: string; status: string }> }>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices?contactId=${contact.id}`);
    expect((stored.data ?? []).find((i) => i.id === invoice.id)?.status, "the seeded invoice is part-paid").toMatch(/^PARTIAL(LY_PAID)?$/);

    await page.goto(`/app/crm/contacts/${contact.id}/overview`);
    await expect(page.getByRole("heading", { level: 1, name: `Jade ${last}` })).toBeVisible();
    const hrefs = await page
      .locator(`a[href^="/app/crm/contacts/${contact.id}/"]`)
      .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("href") ?? ""))]);
    const findings: string[] = [];
    for (const href of hrefs) {
      await page.goto(href);
      await settle(page, 1_500);
      const text = await page.locator("body").innerText();
      for (const m of text.match(/\b[A-Z][a-z]+\.[A-Z][a-z]+\b/g) ?? []) findings.push(`${href}: event code "${m}"`);
      for (const m of text.match(/\b[A-Z]+_[A-Z_]+\b/g) ?? []) findings.push(`${href}: stored value "${m}"`);
      // A one-word stored code (LEAD, SENT, HIGH) has no underscore for the detector above to see.
      for (const m of text.match(STORED_WORD) ?? []) findings.push(`${href}: stored value "${m}"`);
      for (const m of text.match(LOWER_EVENT_CODE) ?? []) findings.push(`${href}: event code "${m}"`);
      // A lower-case code printed as a badge of its own ("high", "pending").
      const leaves = await page.locator("body *").evaluateAll((els) =>
        // HTML elements only: an icon's SVG parts have no innerText.
        els.filter((e): e is HTMLElement => e instanceof HTMLElement && e.children.length === 0 && e.offsetParent !== null).map((e) => e.innerText.trim()),
      );
      for (const leaf of leaves) if (LOWER_CODES.has(leaf)) findings.push(`${href}: stored value "${leaf}"`);
      if (text.includes(contact.id)) findings.push(`${href}: the contact's id is on screen`);
    }
    expect([...new Set(findings)], "raw labels on the customer's pages").toEqual([]);
  });

  test("C7 CSV import, tags, trash and undo work", async ({ page, request, owner }) => {
    test.setTimeout(6 * 60_000);
    const tag = `vip${stamp()}`;
    const imported = [`Imp${stamp()}`, `Imp${stamp()}`];

    await test.step("import two customers from a CSV file", async () => {
      await page.goto("/app/crm/contacts");
      await page.getByRole("button", { name: /^import contacts$/i }).filter({ visible: true }).first().click();
      // The import panel may open folded (its header names the formats) and offer several methods.
      const unfold = page.getByRole("button", { name: /import contacts.*csv/i }).filter({ visible: true });
      if ((await page.locator('input[type="file"]').count()) === 0 && (await unfold.count())) await unfold.first().click();
      const fileMethod = page.getByRole("button", { name: /^upload file$/i }).filter({ visible: true });
      if (await fileMethod.count()) await fileMethod.first().click();
      const csv = `First name,Last name,Email\nKai,${imported[0]},${imported[0].toLowerCase()}@v62j.test.local\nLia,${imported[1]},${imported[1].toLowerCase()}@v62j.test.local\n`;
      // The import's own file input (the page has others, e.g. the business-card scan).
      await page.locator('input[type="file"][accept*=".csv"], input[type="file"][accept*="text/csv"]').first().setInputFiles({ name: "customers.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      // A CSV goes through field mapping first.
      const mapFields = page.getByRole("button", { name: /map fields/i }).filter({ visible: true });
      if (await mapFields.count()) {
        await expect(mapFields.first()).toBeEnabled();
        await mapFields.first().click();
      }
      const submit = page.getByRole("button", { name: /^import (customers|\d+ mapped)/i }).filter({ visible: true });
      await expect(submit.first(), "the import's submit button").toBeEnabled();
      await submit.first().click();
      const all = page.getByRole("button", { name: /^import all\b/i }).filter({ visible: true });
      if (await all.count()) await all.first().click();
      await expect
        .poll(async () => {
          const res = await api<{ contacts?: Array<{ lastName: string }> }>(request, owner, "GET", `/crm/businesses/${owner.businessId}/contacts`);
          return (res.contacts ?? []).map((c) => c.lastName).filter((n) => imported.includes(n)).length;
        }, { timeout: 60_000, message: "both imported customers exist" })
        .toBe(2);
    });

    /** A customer's row in the Customers list. */
    const listRow = (name: string) =>
      page.locator(`div[role="option"][aria-label^="${name} - "]`).or(page.locator("tr, li, [role=row]").filter({ hasText: name })).first();

    await test.step("tag a customer from the list; the tag is stored", async () => {
      const last = `Tag${stamp()}`;
      const contact = await seedContact(request, owner, "Tad", last);
      await page.goto("/app/crm/contacts?view=list");
      const row = listRow(`Tad ${last}`);
      await expect(row).toBeVisible();
      const select = page.getByRole("button", { name: /^select contacts$/i }).filter({ visible: true });
      if (await select.count()) await select.first().click();
      const box = row.getByRole("checkbox");
      if (await box.count()) await box.first().check();
      else await row.click();
      await page.getByRole("button", { name: /^(add tag|tag)$/i }).filter({ visible: true }).first().click();
      const input = page.getByPlaceholder(/tag/i).filter({ visible: true }).first();
      await input.fill(tag);
      await input.press("Enter");
      await expect
        .poll(async () => (await api<{ contact: { tags: string[] } }>(request, owner, "GET", `/crm/businesses/${owner.businessId}/contacts/${contact.id}`)).contact.tags, { timeout: 15_000 })
        .toContain(tag);
    });

    /** Deletes a customer from the Customers list: Delete on their row, or in the row's actions menu, then any confirm. */
    const deleteFromList = async (name: string) => {
      await page.goto("/app/crm/contacts?view=list");
      const remove = /^(delete contact|delete|move to trash)$/i;
      const row = page.locator("[role=option], tr, li, [role=row]").filter({ hasText: name }).last();
      await expect(row).toBeVisible();
      await row.hover();
      const direct = row.getByRole("button", { name: remove });
      if (await direct.count()) await direct.first().click();
      else {
        const menu = row.locator('button[aria-haspopup="menu"]').or(row.getByRole("button", { name: /more|actions/i })).first();
        await expect(menu, `a Delete door on ${name}'s row`).toBeVisible();
        await menu.click();
        await page.getByRole("menuitem", { name: remove }).or(page.getByRole("button", { name: remove })).filter({ visible: true }).first().click();
      }
      const confirm = page.getByRole("dialog").getByRole("button", { name: /^(delete|move to trash|confirm)/i });
      if (await confirm.count()) await confirm.first().click();
    };
    const readContact = (id: string) => request.get(`${API_URL}/crm/businesses/${owner.businessId}/contacts/${id}`, { headers: auth(owner) });
    const isDelete = (id: string) => (r: { request(): { method(): string }; url(): string }) =>
      r.request().method() === "DELETE" && new URL(r.url()).pathname === `/crm/businesses/${owner.businessId}/contacts/${id}`;

    // A delete with no Undo first: it must reach the server (the list may defer it a few seconds
    // for Undo) and leave the customer gone, so Undo's leg below proves Undo kept them.
    const trashedFirst = `Vic${stamp()}`;
    let trashedId = "";
    await test.step("delete a customer without Undo: the delete reaches the server and the customer is gone", async () => {
      const last = `Trash${stamp()}`;
      const contact = await seedContact(request, owner, trashedFirst, last);
      trashedId = contact.id;
      const deleted = page.waitForResponse(isDelete(contact.id), { timeout: 30_000 });
      await deleteFromList(`${trashedFirst} ${last}`);
      const res = await deleted;
      expect(res.status(), `the delete answers: ${await res.text()}`).toBeLessThan(300);
      expect((await readContact(contact.id)).status(), "the deleted customer is gone").toBe(404);
    });

    await test.step("the trash lists the deleted customer, and Restore brings them back", async () => {
      await page.goto("/app/trash");
      await settle(page, 1_000);
      const contacts = page.getByRole("button", { name: /^contacts$/i }).filter({ visible: true });
      if (await contacts.count()) await contacts.first().click();
      const row = page
        .locator("div")
        .filter({ hasText: trashedFirst })
        .filter({ has: page.getByRole("button", { name: /^restore$/i }) })
        .last();
      await expect(row, `${trashedFirst} in the trash`).toBeVisible();
      const restored = page.waitForResponse(
        (r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/businesses/${owner.businessId}/trash/contact/${trashedId}/restore`,
      );
      await row.getByRole("button", { name: /^restore$/i }).click();
      const res = await restored;
      expect(res.status(), `the restore answers: ${await res.text()}`).toBeLessThan(300);
      expect((await readContact(trashedId)).status(), "the restored customer is back").toBe(200);
    });

    await test.step("delete a customer, then Undo brings them back", async () => {
      const last = `Trash${stamp()}`;
      const contact = await seedContact(request, owner, "Uma", last);
      await deleteFromList(`Uma ${last}`);
      await page.getByRole("button", { name: /^undo$/i }).filter({ visible: true }).first().click();
      // Past any deferred delete (the leg above shows one lands within it), so Undo is what kept the customer.
      await page.waitForTimeout(8_000);
      expect((await readContact(contact.id)).status(), "the customer is back after Undo").toBe(200);
    });
  });

  test("C8 the customer list is the first thing on screen", async ({ page, request, owner }) => {
    test.setTimeout(3 * 60_000);
    const last = `Aaron${stamp()}`;
    await seedContact(request, owner, "Aaa", last);
    await page.goto("/app/crm/contacts");
    await settle(page, 1_500);
    const first = page.getByText(`Aaa ${last}`, { exact: true }).first();
    await expect(first, "a customer row, without scrolling").toBeInViewport({ ratio: 1 });
    const box = await first.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.y, `the first row's top (viewport ${viewport.width}x${viewport.height})`).toBeLessThan(viewport.height / 2);
  });
});
