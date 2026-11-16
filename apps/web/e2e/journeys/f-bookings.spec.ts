import {
  test,
  expect,
  API_URL,
  RUN,
  anonymousContext,
  coveredButtonFindings,
  settle,
  type Tenant,
} from "./journey-helpers";
import { offeredPaymentMethods } from "./journey-text";
import type { APIRequestContext, BrowserContext, Locator, Page } from "@playwright/test";

/**
 * GATE-JOURNEYS-A-F, journey F: take bookings (product audit core_journeys_v1 F;
 * KF-JOURNEY-004; D-26, D-65, D-80). Each bullet of F's definition of done is a
 * test (F1..F9), on both journey projects, in every variant (README.md in this
 * folder).
 *
 * Customer side
 *   F1  /book/<slug> (a slug, not a cuid) lists bookable services with staff and prices.
 *   F2  The time picker shows only slots from GET /bookings/public/businesses/:id/slots.
 *   F3  Only methods enabled in Settings > Getting paid are offered; PayPal is never
 *       offered for TTD unless the business has saved its own keys. Getting
 *       paid is saved as its tab saves it (payments-tab.tsx: PATCH
 *       /identity/businesses/:id metaData), twice: bank transfer on and cash
 *       off, then the reverse; each time the checkout offers exactly that one.
 *   F4  An optional deposit can be taken.
 * Owner side
 *   F5  The owner gets a push alert, or an email as fallback, within a minute
 *       (@staging: a real push service and mailbox; alerts ruling D-154).
 *   F6  The booking shows in Schedule with customer and staff names.
 *   F7  The owner can confirm, complete (the invoice nets the deposit), cancel
 *       (the deposit is forfeit) or mark a no-show: F7a confirm then complete
 *       (no deposit: the invoice is the price), F7b complete after a paid 25%
 *       deposit (the invoice is the price less the deposit), F7c the customer
 *       cancelled after paying the deposit (kept, recorded as forfeit, D-26; a
 *       cancel that names no one is the customer's, D-65), F7d no-show, F7e
 *       the business cancelled (V1-84: only a customer cancel forfeits, so the
 *       deposit stays paid). The Cancel says who cancelled: F7c picks the
 *       option naming the customer when one is offered, F7e requires the one
 *       naming the business, and both read who the status write names.
 * Reminders
 *   F8  Tomorrow's booking appears in Today's 'ready to send' reminders
 *       (@scheduler, GATE-SCHEDULER-RUN).
 *   F9  No primary button is covered at any point (customer and owner screens).
 *
 * Doors: the customer books on /book/<slug>: the service's card, "Add to Cart",
 * the cart's "Proceed to Checkout", the Information step (first name, last
 * name, email, phone), "Continue", the Schedule step (a staff choice, a date
 * and the time buttons), "Continue", the Payment step and "Place Order". The
 * owner's bookings are Schedule (/app/bookings), each opening a detail with
 * Confirm, Complete, Cancel and No-show. The business's slug, opening hours
 * (09:00 to 17:00 every day), services and staff are made through the API,
 * and so is F7b/F7c's paid deposit (the public booking route the store uses
 * draws the deposit invoice up; the owner records the 30.00). Every browser
 * keeps Trinidad and Tobago's time, as the owner's and customers' phones do.
 *
 * RED at the GATE-HARNESS head (02e498e8), observed on both projects in the
 * ai-disabled and key-disabled variants (the packet return holds the report):
 * F2 the picker offers every half hour from 09:00 to 16:30, a taken 10:00 and
 * a 16:30 that ends after closing among them, where GET .../slots lists
 * 09:00 and 11:00 to 16:00 (BUG-122, the headline); F1 the store page names
 * no staff; F4 the deposit settings are dropped (BUG-048); F6 the booking's
 * detail shows raw ids, not the staff member's name (BUG-120); F7a and F7d
 * the booking offers no Confirm and no No-show (BUG-120); F7b and F7c stop at
 * the dropped deposit (BUG-048); F9 the calendar's New event Create is under
 * the Mobile navigation bar (375x812) and the KEY bubble (1440x900, BUG-004).
 *
 * Review repair (GATE-JOURNEYS-A-F review): F3 offers Cash where Getting paid
 * turns cash off and bank transfer on (the store always offers 'Cash /
 * Manual Payment'; nothing reads metaData.cashEnabled); F7e stops at the
 * dropped deposit (BUG-048), then needs the Cancel to ask who cancelled.
 * Behind BUG-048 on F7c's leg is a server defect in neither the sweep nor the
 * plan (review SEC-GJ-2): a customer cancel of a paid-deposit booking commits
 * CANCELLED and DEPOSIT_FORFEITED, then answers 400 'Unknown ContactEvent type
 * "booking.deposit_forfeited"' (bookings.service.ts writes a contact event
 * type crm-timeline.service.ts does not know), skipping the booking.cancelled
 * event and timeline row; F7c reads that 400 once BUG-048 is fixed.
 */

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
const ZONE = "America/Port_of_Spain";
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

interface Bookable {
  slug: string;
  service: { id: string; name: string; price: number; duration: number };
  staff: { id: string; name: string };
}

/** A business that takes bookings: its slug, opening hours 09:00-17:00 every day, a 60-minute service at 120 and one staff member. */
async function seedBookable(request: APIRequestContext, owner: Tenant, label: string): Promise<Bookable> {
  const slug = `${RUN.replace(/_/g, "-")}-${label}-${stamp()}`.toLowerCase();
  await api(request, owner, "PATCH", `/identity/businesses/${owner.businessId}`, {
    slug,
    businessHours: Object.fromEntries(DAYS.map((d) => [d, { open: "09:00", close: "17:00", closed: false }])),
  });
  const service = await api<Bookable["service"]>(request, owner, "POST", `/bookings/businesses/${owner.businessId}/services`, {
    name: `Gel manicure ${stamp()}`,
    duration: 60,
    price: 120,
    currency: owner.currency,
  });
  const staff = await api<Bookable["staff"]>(request, owner, "POST", `/bookings/businesses/${owner.businessId}/staff`, { name: `Shanice ${stamp()}` });
  return { slug, service, staff };
}

/** A calendar day `days` ahead, as YYYY-MM-DD in the business's zone. */
function dayAhead(days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + days * 86_400_000));
}

/** The instant of a wall-clock time in Port of Spain (UTC-4, no daylight saving). */
const portOfSpain = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-04:00`);

const localTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

async function ownerBooking(request: APIRequestContext, owner: Tenant, b: Bookable, day: string, hhmm: string, firstName = "Tara") {
  const contact = await api<{ id: string }>(request, owner, "POST", `/crm/businesses/${owner.businessId}/contacts`, { firstName, lastName: `Book${stamp()}` });
  const start = portOfSpain(day, hhmm);
  const booking = await api<{ id: string; status: string }>(request, owner, "POST", `/bookings/businesses/${owner.businessId}`, {
    contactId: contact.id,
    serviceId: b.service.id,
    staffId: b.staff.id,
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + b.service.duration * 60_000).toISOString(),
  });
  const read = await api<{ contact: { firstName: string; lastName: string } }>(request, owner, "GET", `/crm/businesses/${owner.businessId}/contacts/${contact.id}`);
  return { ...booking, customer: `${read.contact.firstName} ${read.contact.lastName}` };
}

async function bookingById(request: APIRequestContext, owner: Tenant, id: string) {
  const list = await api<unknown>(request, owner, "GET", `/bookings/businesses/${owner.businessId}`);
  const rows = (Array.isArray(list) ? list : ((list as { bookings?: unknown[]; data?: unknown[] }).bookings ?? (list as { data?: unknown[] }).data ?? [])) as Array<{
    id: string;
    status: string;
    invoiceId?: string | null;
    paymentStatus?: string | null;
  }>;
  return rows.find((r) => r.id === id);
}

/**
 * A booking whose 25% deposit (30.00 of 120) was taken and paid: the service
 * is set to take the deposit (Schedule > Services; read back, so BUG-048, the
 * dropped deposit settings, fails here), the customer books on the public
 * route the store uses, which draws up the deposit invoice, and the owner
 * records the 30.00 the customer paid against it.
 */
async function depositBooking(request: APIRequestContext, owner: Tenant, b: Bookable, day: string, hhmm: string, firstName: string) {
  await api(request, owner, "PATCH", `/catalog/businesses/${owner.businessId}/services/${b.service.id}`, { depositRequired: true, depositType: "PERCENT", depositValue: 25 });
  const services = await api<Array<Record<string, unknown>>>(request, owner, "GET", `/bookings/businesses/${owner.businessId}/services`);
  const s = (Array.isArray(services) ? services : []).find((x) => x.id === b.service.id);
  expect({ depositRequired: s?.depositRequired, depositType: s?.depositType, depositValue: Number(s?.depositValue) }, "the stored deposit (BUG-048)").toEqual({
    depositRequired: true,
    depositType: "PERCENT",
    depositValue: 25,
  });
  const lastName = `Deposit${stamp()}`;
  const res = await request.post(`${API_URL}/bookings/public/businesses/${owner.businessId}`, {
    data: {
      serviceId: b.service.id,
      staffId: b.staff.id,
      startTime: portOfSpain(day, hhmm).toISOString(),
      firstName,
      lastName,
      email: `${lastName.toLowerCase()}@v62j.test.local`,
      phone: "+18687005678",
      storefrontSlug: b.slug,
    },
  });
  const body = await res.text();
  expect(res.status(), `the customer books on the public route: ${body.slice(0, 300)}`).toBe(201);
  const booking = JSON.parse(body) as { bookingId: string; depositInvoiceId?: string | null; depositAmount?: number };
  expect({ deposit: Boolean(booking.depositInvoiceId), amount: Number(booking.depositAmount) }, "the booking draws up its 30.00 deposit invoice").toEqual({
    deposit: true,
    amount: 30,
  });
  // The public route draws the deposit invoice up as a DRAFT, which takes no payment (F4 asks for an
  // issued one); the owner issues it here so this helper reaches what F7b and F7c test.
  const deposit = await api<{ status: string }>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${booking.depositInvoiceId}`);
  if (deposit.status === "DRAFT") {
    await api(request, owner, "PATCH", `/commerce/invoices/${booking.depositInvoiceId}/status/sent`, { businessId: owner.businessId, status: "SENT" });
  }
  await api(request, owner, "POST", `/commerce/businesses/${owner.businessId}/invoices/${booking.depositInvoiceId}/payments`, {
    amount: 30,
    method: "Cash",
    idempotencyKey: `${booking.bookingId}-deposit`,
  });
  return { id: booking.bookingId, depositInvoiceId: booking.depositInvoiceId!, customer: `${firstName} ${lastName}` };
}

/** Closes the item's detail once it is in the cart (its close control is an unnamed X; the backdrop closes it too). */
async function closeItemDetail(page: Page): Promise<void> {
  const inCart = page.getByRole("button", { name: /in cart/i }).filter({ visible: true });
  const close = page.getByRole("button", { name: /^close$/i }).filter({ visible: true });
  if (await close.count()) await close.first().click();
  else if (await inCart.count()) await page.mouse.click(5, 5);
  await expect(inCart).toHaveCount(0);
}

/** The customer's way from /book/<slug> to the Schedule step, with the details filled in. */
async function toScheduleStep(page: Page, b: Bookable): Promise<void> {
  await page.goto(`/book/${b.slug}`);
  await page.getByText(b.service.name, { exact: true }).first().click();
  await page.getByRole("button", { name: /^add to cart$/i }).filter({ visible: true }).first().click();
  await closeItemDetail(page);
  await page.getByRole("button", { name: /open cart/i }).filter({ visible: true }).first().click();
  await page.getByRole("button", { name: /proceed to checkout/i }).filter({ visible: true }).first().click();
  await page.getByPlaceholder("John", { exact: true }).fill("Nadia");
  await page.getByPlaceholder("Doe", { exact: true }).fill(`Customer${stamp()}`);
  await page.getByPlaceholder("john@example.com").fill(`nadia.${stamp()}@v62j.test.local`);
  const phone = page.getByPlaceholder(/555|868/).first();
  if (await phone.count()) await phone.fill("+18687001234");
  await page.getByRole("button", { name: /^continue$/i }).filter({ visible: true }).first().click();
  await expect(page.locator('input[type="date"]').first(), "the Schedule step's date").toBeVisible();
}

/** A time the Schedule step offers: the button's own label, and the time it names as HH:MM (24-hour). */
interface OfferedTime {
  label: string;
  time: string;
}

/** Picks the staff member and the day on the Schedule step; returns the times offered, in the picker's order. */
async function offeredTimes(page: Page, staffName: string, day: string): Promise<OfferedTime[]> {
  await page.getByRole("button", { name: new RegExp(staffName) }).filter({ visible: true }).first().click();
  await page.locator('input[type="date"]').first().fill(day);
  await page.waitForTimeout(1_000);
  const labels = await page
    .getByRole("button", { name: /^\d{1,2}:\d{2}(\s?[AP]M)?$/i })
    .filter({ visible: true })
    .allInnerTexts();
  return labels.map((label) => {
    const m = label.trim().match(/^(\d{1,2}):(\d{2})\s?([AP]M)?$/i)!;
    let h = Number(m[1]);
    if (m[3] && /pm/i.test(m[3]) && h < 12) h += 12;
    if (m[3] && /am/i.test(m[3]) && h === 12) h = 0;
    return { label: label.trim(), time: `${String(h).padStart(2, "0")}:${m[2]}` };
  });
}

/** Chooses an offered time on the Schedule step by its own label. */
async function pickTime(page: Page, t: OfferedTime): Promise<void> {
  await page.getByRole("button", { name: t.label, exact: true }).filter({ visible: true }).first().click();
}

/** Opens a booking's detail from Schedule (/app/bookings) by its customer's name. */
async function openBooking(page: Page, customer: string): Promise<Locator> {
  await page.goto("/app/bookings");
  await settle(page, 1_000);
  await page.getByText(customer).first().click();
  const detail = page.getByRole("dialog").filter({ visible: true }).last();
  await expect(detail, `the booking of ${customer} opens`).toBeVisible();
  return detail;
}

test.describe("journey F: take bookings", () => {
  // The owner and the customer are in Trinidad and Tobago: their browsers keep its time, as their phones do.
  test.use({ timezoneId: ZONE });

  test("F1 /book/<slug> lists the bookable services with staff and prices; the owner shares the slug, not the id", async ({ page, request, owner, browser }) => {
    test.setTimeout(4 * 60_000);
    const b = await seedBookable(request, owner, "f1");
    const visitor: BrowserContext = await anonymousContext(browser, { who: "customer" });
    const customer = await visitor.newPage();

    await test.step("the customer sees the service, its price and its staff on /book/<slug>", async () => {
      await customer.goto(`/book/${b.slug}`);
      await expect(customer.getByText(b.service.name, { exact: true }).first()).toBeVisible();
      const card = customer.locator("article, li, [role=listitem], div").filter({ hasText: b.service.name }).filter({ hasText: /120/ }).last();
      await expect.soft(card, "the service with its price").toBeVisible();
      await expect.soft(customer.getByText(b.staff.name).first(), "the service's staff").toBeVisible();
    });

    await test.step("Your page shares /book/<slug>, never the business id", async () => {
      await page.goto("/app/store");
      await settle(page, 1_500);
      const share = page.getByRole("tab", { name: /^share/i }).or(page.getByRole("button", { name: /^share/i })).filter({ visible: true });
      if (await share.count()) {
        await share.first().click();
        await settle(page, 1_000);
      }
      // What the page offers to share: its text, its links and the values of its fields (a link to copy).
      const shared = await page.locator("main").first().evaluate((main) =>
        [
          (main as HTMLElement).innerText,
          ...Array.from(main.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href),
          ...Array.from(main.querySelectorAll("input, textarea")).map((i) => (i as HTMLInputElement).value),
        ].join("\n"),
      );
      expect.soft(shared.includes(`/book/${b.slug}`), `Your page offers /book/${b.slug}`).toBe(true);
      expect.soft(shared.includes(`/book/${owner.businessId}`), "Your page offers /book/<business id>").toBe(false);
    });
  });

  test("F2 the time picker offers exactly the free slots the server lists", async ({ request, owner, browser }) => {
    test.setTimeout(5 * 60_000);
    const b = await seedBookable(request, owner, "f2");
    const day = dayAhead(3);
    await ownerBooking(request, owner, b, day, "10:00");
    const server = await api<{ slots: string[] }>(request, owner, "GET", `/bookings/public/businesses/${owner.businessId}/slots?serviceId=${b.service.id}&date=${day}&staffId=${b.staff.id}`);
    const expected = server.slots.map(localTime).sort();
    expect(expected, "the server's free slots for the day").not.toContain("10:00");

    const visitor = await anonymousContext(browser, { who: "customer" });
    const customer = await visitor.newPage();
    await toScheduleStep(customer, b);
    const offered = (await offeredTimes(customer, b.staff.name, day)).map((t) => t.time).sort();
    test.info().annotations.push({ type: "slots", description: `offered ${offered.join(" ")}; server ${expected.join(" ")}` });
    expect.soft(offered, "a taken slot is offered").not.toContain("10:00");
    expect.soft(offered, "a slot that ends after closing is offered").not.toContain("16:30");
    expect(offered, "the picker's times equal GET .../slots").toEqual(expected);
  });

  test("F3 only the payment methods enabled in Settings > Getting paid are offered; no PayPal for TTD without its own keys", async ({ request, owner, browser }) => {
    test.setTimeout(6 * 60_000);
    const b = await seedBookable(request, owner, "f3");
    /** Saves Settings > Getting paid as payments-tab.tsx's Save does (the metaData keys it writes), and reads it back. */
    const gettingPaid = async (methods: { cashEnabled: boolean; bankTransferEnabled: boolean }) => {
      const bank = methods.bankTransferEnabled ? { bankName: "Republic Bank", bankAccountNumber: String(Date.now()).slice(-10) } : {};
      await api(request, owner, "PATCH", `/identity/businesses/${owner.businessId}`, { metaData: { ...methods, ...bank } });
      const read = await api<{ metaData?: Record<string, unknown> }>(request, owner, "GET", `/identity/businesses/${owner.businessId}`);
      expect({ cashEnabled: read.metaData?.cashEnabled, bankTransferEnabled: read.metaData?.bankTransferEnabled }, "Getting paid, as stored").toEqual(methods);
    };
    /** The methods the store's Payment step offers a new customer (its choices: buttons, radios, options, labels). */
    const offered = async (day: string, who: string): Promise<string[]> => {
      const visitor = await anonymousContext(browser, { who });
      const customer = await visitor.newPage();
      await toScheduleStep(customer, b);
      const times = await offeredTimes(customer, b.staff.name, day);
      expect(times.length, "a time to pick").toBeGreaterThan(0);
      await pickTime(customer, times[0]);
      await customer.getByRole("button", { name: /^continue$/i }).filter({ visible: true }).first().click();
      await expect(customer.getByRole("button", { name: /place order/i }).first()).toBeVisible();
      const choices = await customer.locator("button, [role=radio], [role=option], label").filter({ visible: true }).allInnerTexts();
      return offeredPaymentMethods(choices.join("\n"));
    };

    await test.step("Getting paid: bank transfer on, cash off; the checkout offers bank transfer only", async () => {
      await gettingPaid({ cashEnabled: false, bankTransferEnabled: true });
      const methods = await offered(dayAhead(4), "customer, bank transfer on");
      test.info().annotations.push({ type: "methods", description: `bank transfer on, cash off: ${methods.join(", ") || "none"}` });
      expect.soft(methods.filter((m) => m === "paypal"), "PayPal on a TTD store with no PayPal keys (BUG-037)").toEqual([]);
      expect.soft(methods, "the methods offered are exactly those Getting paid enables").toEqual(["bank transfer"]);
    });

    await test.step("Getting paid: cash on, bank transfer off; the checkout offers cash only", async () => {
      await gettingPaid({ cashEnabled: true, bankTransferEnabled: false });
      const methods = await offered(dayAhead(5), "customer, cash on");
      test.info().annotations.push({ type: "methods", description: `cash on, bank transfer off: ${methods.join(", ") || "none"}` });
      expect.soft(methods.filter((m) => m === "paypal"), "PayPal on a TTD store with no PayPal keys (BUG-037)").toEqual([]);
      expect.soft(methods, "the methods offered are exactly those Getting paid enables").toEqual(["cash"]);
    });
  });

  test("F4 an optional deposit can be taken", async ({ request, owner, browser }) => {
    test.setTimeout(5 * 60_000);
    const b = await seedBookable(request, owner, "f4");

    await test.step("the service is set to take a 25% deposit", async () => {
      await api(request, owner, "PATCH", `/catalog/businesses/${owner.businessId}/services/${b.service.id}`, { depositRequired: true, depositType: "PERCENT", depositValue: 25 });
      const services = await api<Array<Record<string, unknown>>>(request, owner, "GET", `/bookings/businesses/${owner.businessId}/services`);
      const s = (Array.isArray(services) ? services : []).find((x) => x.id === b.service.id);
      expect({ depositRequired: s?.depositRequired, depositType: s?.depositType, depositValue: Number(s?.depositValue) }, "the stored deposit (BUG-048)").toEqual({
        depositRequired: true,
        depositType: "PERCENT",
        depositValue: 25,
      });
    });

    await test.step("the customer is asked for the 30.00 deposit and the booking holds it", async () => {
      const visitor = await anonymousContext(browser, { who: "customer" });
      const customer = await visitor.newPage();
      await toScheduleStep(customer, b);
      const times = await offeredTimes(customer, b.staff.name, dayAhead(5));
      await pickTime(customer, times[0]);
      await customer.getByRole("button", { name: /^continue$/i }).filter({ visible: true }).first().click();
      await expect(customer.getByText(/deposit/i).first()).toBeVisible();
      await expect(customer.getByText(/30\.00/).first(), "25% of 120").toBeVisible();
      // The store books each service in the cart through the public booking route, which draws up the deposit.
      const placed = customer.waitForResponse((r) => r.request().method() === "POST" && /\/bookings\/public\/businesses\/[^/]+$/.test(new URL(r.url()).pathname));
      await customer.getByRole("button", { name: /place order/i }).first().click();
      const res = await placed;
      expect(res.status(), await res.text()).toBeLessThan(300);
      const placedBody = (await res.json()) as { depositInvoiceId?: string | null; depositAmount?: number };
      expect({ deposit: Boolean(placedBody.depositInvoiceId), amount: Number(placedBody.depositAmount) }, "the booking carries its 30.00 deposit invoice").toEqual({
        deposit: true,
        amount: 30,
      });
      // Taken means payable: a DRAFT invoice takes no payment (the server answers 409) and its link is not for a customer.
      const deposit = await api<{ status: string }>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${placedBody.depositInvoiceId}`);
      expect(deposit.status, "the deposit invoice is issued, so the customer can pay it").not.toBe("DRAFT");
    });
  });

  test("F5 the owner gets a push alert, or an email as fallback, within a minute", { tag: "@staging" }, async ({ request, owner, browser }) => {
    // GATE-STAGING-RUN: the owner's device subscribed to push (or none, for the email fallback) and a sandbox mailbox.
    test.setTimeout(5 * 60_000);
    const b = await seedBookable(request, owner, "f5");
    const visitor = await anonymousContext(browser, { who: "customer" });
    const customer = await visitor.newPage();
    await toScheduleStep(customer, b);
    const times = await offeredTimes(customer, b.staff.name, dayAhead(6));
    await pickTime(customer, times[0]);
    await customer.getByRole("button", { name: /^continue$/i }).filter({ visible: true }).first().click();
    await customer.getByRole("button", { name: /place order/i }).first().click();
    const mailbox = process.env.E2E_STAGING_MAILBOX_URL ?? "";
    expect(mailbox, "E2E_STAGING_MAILBOX_URL (GATE-STAGING-RUN) reads the owner's alert").not.toBe("");
    await expect
      .poll(async () => {
        const res = await request.get(`${mailbox}?to=${encodeURIComponent(owner.email)}&kind=alert`);
        return res.ok() ? JSON.stringify(await res.json()) : "";
      }, { timeout: 60_000, message: "the owner's booking alert arrives within a minute" })
      .toMatch(/booking/i);
  });

  test("F6 the booking shows in Schedule with the customer's and the staff member's names", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    const b = await seedBookable(request, owner, "f6");
    const booking = await ownerBooking(request, owner, b, dayAhead(2), "11:00", "Yara");
    const detail = await openBooking(page, booking.customer);
    await expect.soft(detail.getByText(booking.customer).first(), "the customer's name").toBeVisible();
    await expect.soft(detail.getByText(b.staff.name).first(), "the staff member's name").toBeVisible();
    const text = await detail.innerText();
    expect.soft(text.match(/\bc[a-z0-9]{20,}\b/g) ?? [], "raw ids in the booking's detail (BUG-120)").toEqual([]);
  });

  /** Opens the booking of `customer` in Schedule and presses `action`, failing with what covers it; resolves once the status write answers. */
  async function act(page: Page, customer: string, action: RegExp): Promise<void> {
    const detail = await openBooking(page, customer);
    const button = detail.getByRole("button", { name: action }).filter({ visible: true });
    await expect(button.first(), `the booking of ${customer} offers '${action.source}'`).toBeVisible();
    expect(await coveredButtonFindings([{ what: `the booking's '${action.source}'`, locator: button.first() }]), "covered booking actions").toEqual([]);
    const done = page.waitForResponse((r) => ["POST", "PATCH"].includes(r.request().method()) && /\/bookings\/[^/]+(\/status)?$/.test(new URL(r.url()).pathname));
    await button.first().click();
    const confirm = page.getByRole("dialog").getByRole("button", { name: /^(confirm|yes|cancel booking|mark)/i }).filter({ visible: true });
    if (await confirm.count()) await confirm.first().click().catch(() => {});
    expect((await done).status()).toBeLessThan(300);
  }

  /** The Cancel's choice naming who cancelled (V1-84): the customer, or the business. */
  const CANCELLED_BY = {
    customer: /customer cancel|cancell?ed by (the )?(customer|client)|(the )?(customer|client) cancell?ed/i,
    business: /we cancell?ed|business cancel|cancell?ed by (us|the business)|(the )?business cancell?ed|our side/i,
  } as const;

  /**
   * Cancels the booking of `customer` from Schedule as `by`'s cancellation: the
   * customer's (a paid deposit is forfeit, D-26; a cancel that names no one is
   * the customer's, D-65) or the business's (not forfeit, V1-84). Picks the
   * Cancel's option naming that side when it offers one; a business cancel
   * needs it. Reads who the status write names, then that it answers.
   */
  async function cancelBooking(page: Page, customer: string, by: "customer" | "business"): Promise<void> {
    const detail = await openBooking(page, customer);
    const cancel = detail.getByRole("button", { name: /^cancel/i }).filter({ visible: true });
    await expect(cancel.first(), `the booking of ${customer} offers Cancel`).toBeVisible();
    expect(await coveredButtonFindings([{ what: "the booking's Cancel", locator: cancel.first() }]), "covered booking actions").toEqual([]);
    const done = page.waitForResponse((r) => ["POST", "PATCH"].includes(r.request().method()) && /\/bookings\/[^/]+(\/status)?$/.test(new URL(r.url()).pathname));
    await cancel.first().click();
    const side = CANCELLED_BY[by];
    const choice = page
      .getByRole("radio", { name: side })
      .or(page.getByRole("button", { name: side }))
      .or(page.getByRole("menuitem", { name: side }))
      .or(page.getByRole("option", { name: side }))
      .filter({ visible: true });
    if (await choice.count()) {
      if ((await choice.first().getAttribute("role")) === "radio" || (await choice.first().evaluate((el) => (el as HTMLInputElement).type === "radio"))) await choice.first().check();
      else await choice.first().click();
    } else {
      expect(by, "the Cancel asks who cancelled: 'we cancelled' keeps the customer's deposit (D-26, V1-84)").toBe("customer");
    }
    const confirm = page.getByRole("dialog").getByRole("button", { name: /^(confirm|yes|cancel booking)/i }).filter({ visible: true });
    if (await confirm.count()) await confirm.first().click().catch(() => {});
    const res = await done;
    const sent = (res.request().postDataJSON() ?? {}) as { status?: string; cancelledBy?: string };
    expect(sent.status, "the status write cancels the booking").toBe("CANCELLED");
    // No initiator is the customer's cancel (D-65); the business's must say so.
    expect(sent.cancelledBy ?? "CUSTOMER", "who cancelled, as the status write names it").toBe(by === "customer" ? "CUSTOMER" : "BUSINESS");
    expect(res.status(), `the cancel answers: ${(await res.text()).slice(0, 300)}`).toBeLessThan(300);
  }

  test("F7a the owner confirms a booking, then completes it: the invoice bills the price", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    const b = await seedBookable(request, owner, "f7a");
    const one = await ownerBooking(request, owner, b, dayAhead(2), "09:00", "Una");

    await test.step("Confirm", async () => {
      await act(page, one.customer, /^confirm/i);
      expect((await bookingById(request, owner, one.id))?.status).toBe("CONFIRMED");
    });

    await test.step("Complete: the invoice is made, for the price (no deposit was taken)", async () => {
      await act(page, one.customer, /^(complete|mark (as )?complete)/i);
      const read = await bookingById(request, owner, one.id);
      expect(read?.status).toBe("COMPLETED");
      expect(read?.invoiceId, "completing makes the invoice").toBeTruthy();
      const invoice = await api<{ total: number }>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${read!.invoiceId}`);
      expect(Number(invoice.total), "the invoice for a booking with no deposit is the price").toBe(120);
    });
  });

  test("F7b completing a booking whose deposit was paid bills the price less the deposit", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    const b = await seedBookable(request, owner, "f7b");
    const booked = await depositBooking(request, owner, b, dayAhead(3), "10:00", "Dana");

    await test.step("Complete (a paid deposit has already confirmed the booking)", async () => {
      expect((await bookingById(request, owner, booked.id))?.status, "a paid deposit confirms the booking").toBe("CONFIRMED");
      await act(page, booked.customer, /^(complete|mark (as )?complete)/i);
    });

    await test.step("the final invoice nets the 30.00 deposit: 90.00, and deposit + final = the price", async () => {
      const read = await bookingById(request, owner, booked.id);
      expect(read?.status).toBe("COMPLETED");
      expect(read?.invoiceId, "completing makes the final invoice").toBeTruthy();
      const invoice = await api<{ total: number }>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${read!.invoiceId}`);
      expect(Number(invoice.total), "the final invoice: 120 less the 30 deposit").toBe(90);
    });
  });

  test("F7c the customer cancelled a booking whose deposit was paid: the owner records it and the deposit is forfeit", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    const b = await seedBookable(request, owner, "f7c");
    const booked = await depositBooking(request, owner, b, dayAhead(3), "13:00", "Vera");

    await test.step("Cancel, as the customer's cancellation (D-26, D-65)", async () => {
      // Once BUG-048 is fixed this write answers 400 although the forfeit commits (review SEC-GJ-2; header).
      await cancelBooking(page, booked.customer, "customer");
    });

    await test.step("the booking is cancelled, the deposit kept and recorded as forfeit (D-26)", async () => {
      const read = await bookingById(request, owner, booked.id);
      expect(read?.status).toBe("CANCELLED");
      expect(read?.paymentStatus, "the booking records the forfeit deposit").toBe("DEPOSIT_FORFEITED");
      const deposit = await api<{ status: string }>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${booked.depositInvoiceId}`);
      expect(deposit.status, "the deposit is kept: its invoice stays paid, nothing refunded").toBe("PAID");
    });
  });

  test("F7d the owner marks a no-show", async ({ page, request, owner }) => {
    test.setTimeout(4 * 60_000);
    const b = await seedBookable(request, owner, "f7d");
    const three = await ownerBooking(request, owner, b, dayAhead(2), "15:00", "Wes");
    await act(page, three.customer, /no.?show/i);
    expect((await bookingById(request, owner, three.id))?.status).toBe("NO_SHOW");
  });

  test("F7e the business cancels a booking whose deposit was paid: the deposit is not forfeit", async ({ page, request, owner }) => {
    test.setTimeout(5 * 60_000);
    const b = await seedBookable(request, owner, "f7e");
    const booked = await depositBooking(request, owner, b, dayAhead(3), "15:00", "Wren");

    await test.step("Cancel, as the business's cancellation (V1-84)", async () => {
      await cancelBooking(page, booked.customer, "business");
    });

    await test.step("the booking is cancelled and the deposit stays paid, not forfeit (D-26: only a customer cancel forfeits)", async () => {
      const read = await bookingById(request, owner, booked.id);
      expect(read?.status).toBe("CANCELLED");
      expect(read?.paymentStatus, "a business cancel keeps the deposit as paid").toBe("DEPOSIT_PAID");
      const deposit = await api<{ status: string }>(request, owner, "GET", `/commerce/businesses/${owner.businessId}/invoices/${booked.depositInvoiceId}`);
      expect(deposit.status, "the deposit invoice stays paid").toBe("PAID");
    });
  });

  test("F8 tomorrow's booking appears in Today's 'ready to send' reminders", { tag: "@scheduler" }, async ({ page, request, owner }) => {
    // GATE-SCHEDULER-RUN: the reminder read runs with the schedulers on and the run's server clock.
    test.setTimeout(10 * 60_000);
    const b = await seedBookable(request, owner, "f8");
    const booking = await ownerBooking(request, owner, b, dayAhead(1), "10:00", "Zane");
    await page.goto("/app/command-center");
    const ready = page.locator("section, [role=region], div").filter({ has: page.getByRole("heading", { name: /ready to send/i }) }).last();
    await expect(ready.getByText(booking.customer).first(), "tomorrow's booking is ready to send").toBeVisible({ timeout: 5 * 60_000 });
    await expect(ready.getByRole("link", { name: /whatsapp/i }).or(ready.getByRole("button", { name: /whatsapp/i })).first()).toBeVisible();
  });

  test("F9 no primary button is covered at any point (customer checkout, the owner's booking and calendar)", async ({ page, request, owner, browser }) => {
    test.setTimeout(6 * 60_000);
    const b = await seedBookable(request, owner, "f9");
    const findings: string[] = [];
    /** Measures a button once it is shown and its panel has finished moving (sheets and steps slide in). */
    const measure = async (what: string, locator: Locator) => {
      await expect(locator, what).toBeVisible();
      await locator.page().waitForTimeout(600);
      findings.push(...(await coveredButtonFindings([{ what, locator }])));
    };

    await test.step("the customer's Add to Cart, Proceed to Checkout, Continue and Place Order", async () => {
      const visitor = await anonymousContext(browser, { who: "customer" });
      const customer = await visitor.newPage();
      await customer.goto(`/book/${b.slug}`);
      await customer.getByText(b.service.name, { exact: true }).first().click();
      const add = customer.getByRole("button", { name: /^add to cart$/i }).filter({ visible: true }).first();
      await measure("Add to Cart", add);
      await add.click();
      await closeItemDetail(customer);
      await customer.getByRole("button", { name: /open cart/i }).filter({ visible: true }).first().click();
      const proceed = customer.getByRole("button", { name: /proceed to checkout/i }).filter({ visible: true }).first();
      await measure("Proceed to Checkout", proceed);
      await proceed.click();
      await customer.getByPlaceholder("John", { exact: true }).fill("Ola");
      await customer.getByPlaceholder("Doe", { exact: true }).fill(`Cover${stamp()}`);
      await customer.getByPlaceholder("john@example.com").fill(`ola.${stamp()}@v62j.test.local`);
      const next = customer.getByRole("button", { name: /^continue$/i }).filter({ visible: true }).first();
      await measure("Continue (details)", next);
      await next.click();
      const times = await offeredTimes(customer, b.staff.name, dayAhead(3));
      await pickTime(customer, times[0]);
      await customer.getByRole("button", { name: /^continue$/i }).filter({ visible: true }).first().click();
      const place = customer.getByRole("button", { name: /place order/i }).filter({ visible: true }).first();
      await measure("Place Order", place);
    });

    await test.step("the owner's booking actions and the calendar's New event Create", async () => {
      const booking = await ownerBooking(request, owner, b, dayAhead(2), "12:00", "Pia");
      const detail = await openBooking(page, booking.customer);
      const confirm = detail.getByRole("button", { name: /^confirm/i }).filter({ visible: true });
      if (await confirm.count()) await measure("the booking's Confirm", confirm.first());
      await page.goto("/app/schedule/calendar");
      await settle(page, 1_000);
      const closeKey = page.getByRole("button", { name: "Close chat" }).filter({ visible: true });
      if (await closeKey.count()) await closeKey.first().click();
      await page.getByRole("button", { name: /^create$/i }).filter({ visible: true }).first().click();
      const sheet = page.getByRole("dialog", { name: "New event" });
      await expect(sheet).toBeVisible();
      await page.waitForTimeout(800);
      findings.push(...(await coveredButtonFindings([{ what: "the New event sheet's Create", locator: sheet.getByRole("button", { name: /^create$/i }) }])));
    });

    expect(findings, "covered primary buttons in journey F").toEqual([]);
  });
});
