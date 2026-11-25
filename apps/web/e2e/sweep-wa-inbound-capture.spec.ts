import { test, expect, type Page, type Route, type Request } from "@playwright/test";
import { TEST_BUSINESS_ID, e2eBaseURL, mockBaseLayout, mockCatchAll, seedWorkspace } from "./helpers/workspace";

/**
 * WEDGE-WA-INBOUND-CAPTURE, the web half's browser proof (P0, the D-263 wedge; D-153: v1 sends WhatsApp links out, the
 * inbox is V1.1). The jsdom halves are src/components/whatsapp/__tests__/new-from-whatsapp.test.tsx (WAW-*),
 * src/components/layout/__tests__/new-entity-menu-whatsapp.test.tsx (NEM-*) and
 * src/app/app/commerce/__tests__/quote-for-customer-url.test.tsx (QFC-*). The server half's proof is
 * apps/server/test/wa-inbound-capture.integration.test.ts.
 *
 * "+ New > From WhatsApp": the owner pastes a customer's WhatsApp message and number; the capture route finds or creates
 * the customer by E.164 and keeps the message on their timeline; the sheet then opens New quote or New booking for them.
 *
 *   WAB-01 New > From WhatsApp > Save > New quote: the capture is sent as typed, the saved message is shown as text,
 *          and Sales > Quotes opens the New Quote sheet with the customer chosen.
 *   WAB-02 ... > New booking: Bookings opens the new-booking sheet with the customer chosen (its heading names them).
 *   WAB-03 a refusal (the number cannot be read for the business's country) keeps the sheet open with what was typed
 *          and says why; no customer screen opens.
 *   WAB-04 a member with crm read is not offered the door (the server would refuse the capture); the other doors stay.
 *          A guard: it passes at the base too.
 *
 * Entry points: at 375 the phone bottom bar's New (it opens the header's New menu), from 768 the header's New button.
 * 375, 768, 1024 and 1440 are run. The flow starts on Settings, which loads cleanly under these mocks (the cockpit's
 * own reads are not mocked and show its error state; the New menu is the shell's, so the screen does not matter).
 *
 * Mocked: every API call is answered by page.route on api.test.local; nothing reaches WhatsApp or KEY (the spec fails
 * if a request leaves for wa.me or the Graph API). Skipped under E2E_LIVE. CI's e2e-mocked step runs a fixed list of
 * specs that does not include this one: it is the packet's browser proof.
 *   NEXT_PUBLIC_API_BASE_URL=http://api.test.local pnpm run build, then
 *   E2E_WEB_COMMAND=standalone E2E_PORT=5400 pnpm exec playwright test e2e/sweep-wa-inbound-capture.spec.ts --project=chromium
 */

test.skip(process.env.E2E_LIVE === "1", "mocked sweep: runs without a live API");

const ALL = ["crm", "revenue", "bookings", "projects", "content", "expenses", "automations", "storefront", "settings", "ai", "team", "analytics", "operations", "connect"];
const modules = (granted: Record<string, string>, rest = "none") => Object.fromEntries(ALL.map((m) => [m, granted[m] ?? rest]));

const OWNER = { modules: modules({}, "admin") };
const CRM_READER = { modules: modules({ crm: "read", revenue: "write", bookings: "write" }) };

/** The edge middleware wants a JWT-shaped kf_token (sweep-me-notifications.spec.ts); the mocked API never checks it. */
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT_SHAPED = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub: "user_e2e", exp: Math.floor(Date.now() / 1000) + 3600 })}.e2e`;

const CONTACT = {
  id: "c_wab_keisha",
  businessId: TEST_BUSINESS_ID,
  firstName: "Keisha",
  lastName: "Ramdial",
  displayName: "Keisha Ramdial",
  email: null,
  phone: "+18687771234",
  whatsappNumber: "+18687771234",
  status: "LEAD",
  source: "whatsapp_inbound",
  tags: [],
};
const MESSAGE = "Hi! Can I get a price for <b>3</b> shirts by Friday?\nThanks";

type Capture = { status: number; body: unknown };
const SAVED: Capture = {
  status: 201,
  body: {
    contact: CONTACT,
    created: true,
    normalizedPhone: "+18687771234",
    note: { id: "n_wab_1", contactId: CONTACT.id, body: MESSAGE, source: "whatsapp_inbound", createdAt: new Date().toISOString() },
    event: { id: "e_wab_1", type: "communication.whatsapp" },
  },
};
const UNREADABLE: Capture = {
  status: 400,
  body: {
    statusCode: 400,
    message: "Phone number could not be normalised for this business country. Include the country code or check the digits.",
    error: "Bad Request",
  },
};

interface Sent {
  captures: Array<Record<string, unknown>>;
  offsite: string[];
}

async function signIn(page: Page, access: unknown, capture: Capture = SAVED): Promise<Sent> {
  const sent: Sent = { captures: [], offsite: [] };
  page.on("request", (req: Request) => {
    if (/wa\.me|whatsapp\.com|graph\.facebook\.com/.test(req.url())) sent.offsite.push(req.url());
  });
  await seedWorkspace(page.context());
  await page.context().addCookies([{ name: "kf_token", value: JWT_SHAPED, url: e2eBaseURL(), sameSite: "Lax" }]);
  await page.context().addInitScript((token) => window.localStorage.setItem("kf_token", token), JWT_SHAPED);
  await mockCatchAll(page);
  await mockBaseLayout(page, { business: { sells: "both", advancedCrm: false, country: "Trinidad and Tobago" } });
  await page.route(/\/identity\/businesses(\?.*)?$/, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: TEST_BUSINESS_ID, name: "E2E Test Business" }]) }),
  );
  // The onboarding gate (use-genome-gate.ts) reads this on every navigation: a finished business.
  await page.route(`**/onboarding-concierge/businesses/${TEST_BUSINESS_ID}/onboarding-state**`, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ onboardingComplete: true, onboardingCompletedAt: "2026-11-01T00:00:00.000Z", threePillarMet: true }),
    }),
  );
  await page.route(`**/identity/businesses/${TEST_BUSINESS_ID}/my-access**`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(access) }),
  );
  // The customers the Quotes and Bookings screens list: the one the capture found or created.
  await page.route(new RegExp(`/crm/businesses/${TEST_BUSINESS_ID}/contacts(\\?.*)?$`), (route: Route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ contacts: [CONTACT], nextCursor: null, hasMore: false }) })
      : route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "the sheet must not create contacts itself" }) }),
  );
  await mockQuotesAndBookingsScreens(page);
  await page.route(`**/crm/businesses/${TEST_BUSINESS_ID}/whatsapp/inbound-capture`, (route: Route) => {
    sent.captures.push(JSON.parse(route.request().postData() ?? "{}"));
    return route.fulfill({ status: capture.status, contentType: "application/json", body: JSON.stringify(capture.body) });
  });
  return sent;
}

/**
 * The reads Sales > Quotes and Bookings make, in the shapes their clients parse (lib/client.ts), so both screens load
 * empty under the catch-all (whose bare [] they refuse): no quotes, products, invoices, bookings or events yet. The
 * stats reads answer 404: the screens show no figures for a failed read.
 */
async function mockQuotesAndBookingsScreens(page: Page): Promise<void> {
  const json = (body: unknown, status = 200) => (route: Route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const page0 = { data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 };
  const B = TEST_BUSINESS_ID;
  for (const list of ["products", "invoices", "quotes"]) {
    await page.route(new RegExp(`/commerce/businesses/${B}/${list}(\\?.*)?$`), json(page0));
  }
  await page.route(new RegExp(`/commerce/businesses/${B}/stats(\\?.*)?$`), json({ message: "Not Found" }, 404));
  await page.route(new RegExp(`/bookings/businesses/${B}/stats(\\?.*)?$`), json({ todayCount: 0, weekCount: 0, pendingCount: 0, totalBookings: 0 }));
  await page.route(new RegExp(`/bookings/businesses/${B}/calendar/status(\\?.*)?$`), json({ connected: false }));
  await page.route(new RegExp(`/bookings/businesses/${B}/optimizer/schedule-health(\\?.*)?$`), json({ message: "Not Found" }, 404));
  await page.route(new RegExp(`/calendar/businesses/${B}/events(\\?.*)?$`), json({ events: [], total: 0, truncated: false, cap: 500, limit: 500, nextCursor: null }));
  await page.route(new RegExp(`/calendar/businesses/${B}/conflicts(\\?.*)?$`), json({ conflicts: [], scanned: 0 }));
}

/** Opens + New the way this width offers it: the phone bottom bar's New at 375, the header's New from 768. */
async function openNewMenu(page: Page, width: number): Promise<void> {
  const button =
    width < 768
      ? page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("button", { name: "New", exact: true })
      : page.getByRole("button", { name: /^new/i }).filter({ visible: true }).first();
  await expect(button).toBeVisible({ timeout: 20_000 });
  // Let the member's access answer land before reading the menu (the menu re-renders on it).
  await page.waitForTimeout(1_500);
  await button.click();
  await expect(page.getByRole("menu")).toBeVisible();
}

async function captureFromWhatsApp(page: Page, width: number, number: string) {
  await openNewMenu(page, width);
  await page.getByRole("menuitem", { name: /from whatsapp/i }).click();
  const sheet = page.getByRole("dialog", { name: /new from whatsapp/i });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel(/whatsapp number/i).fill(number);
  await sheet.getByLabel(/their message/i).fill(MESSAGE);
  await sheet.getByLabel(/first name/i).fill("Keisha");
  await sheet.getByLabel(/last name/i).fill("Ramdial");
  await sheet.getByRole("button", { name: /^save/i }).click();
  return sheet;
}

for (const width of [375, 768, 1024, 1440]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 768 ? 812 : 900 } });

    test(`WAB-01 New > From WhatsApp > New quote opens with the customer chosen (${width})`, async ({ page }) => {
      const sent = await signIn(page, OWNER);
      await page.goto("/app/settings");
      const sheet = await captureFromWhatsApp(page, width, "777 1234");

      await expect(sheet.getByText(/saved/i).first()).toBeVisible();
      expect(sent.captures).toEqual([{ phone: "777 1234", message: MESSAGE, firstName: "Keisha", lastName: "Ramdial" }]);
      // The message as text: its markup is shown, not rendered.
      await expect(sheet.getByTestId("wa-saved-message")).toHaveText(MESSAGE);
      await expect(sheet.getByTestId("wa-saved-message").locator("b")).toHaveCount(0);
      await expect(sheet.getByText("+18687771234").first()).toBeVisible();

      await sheet.getByRole("button", { name: /^new quote$/i }).click();
      await expect(page).toHaveURL(/\/app\/commerce(\?|$)/);
      const quote = page.getByRole("dialog", { name: /new quote/i });
      await expect(quote).toBeVisible({ timeout: 20_000 });
      await expect(quote.getByText(/Keisha Ramdial/).first()).toBeVisible();
      expect(new URL(page.url()).searchParams.get("contactId")).toBeNull();
      expect(sent.offsite).toEqual([]);
    });

    test(`WAB-02 New > From WhatsApp > New booking opens with the customer chosen (${width})`, async ({ page }) => {
      const sent = await signIn(page, OWNER);
      await page.goto("/app/settings");
      const sheet = await captureFromWhatsApp(page, width, "+1 868 777 1234");
      await expect(sheet.getByText(/saved/i).first()).toBeVisible();

      await sheet.getByRole("button", { name: /^new booking$/i }).click();
      await expect(page).toHaveURL(/\/app\/bookings/);
      // The new-booking sheet (booking-side-sheet.tsx) names the customer it was opened for in its heading.
      const booking = page.getByRole("heading", { name: /^new booking · keisha ramdial$/i }).filter({ visible: true });
      await expect(booking).toHaveCount(1, { timeout: 20_000 });
      expect(sent.offsite).toEqual([]);
    });

    test(`WAB-03 a refusal keeps the sheet open with what was typed and says why (${width})`, async ({ page }) => {
      const sent = await signIn(page, OWNER, UNREADABLE);
      await page.goto("/app/settings");
      const sheet = await captureFromWhatsApp(page, width, "12");

      await expect(sheet.getByRole("alert")).toContainText(/could not be normalised for this business country/i);
      await expect(sheet).toBeVisible();
      await expect(sheet.getByLabel(/whatsapp number/i)).toHaveValue("12");
      await expect(sheet.getByLabel(/their message/i)).toHaveValue(MESSAGE);
      await expect(sheet.getByRole("button", { name: /^new quote$/i })).toHaveCount(0);
      expect(sent.captures).toHaveLength(1);
      await expect(page).toHaveURL(/\/app\/settings/);
    });

    test(`WAB-04 a member with crm read is not offered From WhatsApp (${width})`, async ({ page }) => {
      await signIn(page, CRM_READER);
      await page.goto("/app/settings");
      await openNewMenu(page, width);
      await expect(page.getByRole("menuitem", { name: /^invoice/i })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: /from whatsapp/i })).toHaveCount(0);
    });
  });
}
