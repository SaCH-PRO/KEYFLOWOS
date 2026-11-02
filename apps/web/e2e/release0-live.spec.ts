import {
  test,
  expect,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { createHmac } from "node:crypto";

/**
 * R0-25-PLAYWRIGHT-R0: the Release 0 journey (issue #186) in a real browser,
 * against a REAL API and database. Nothing here is mocked: no page.route().
 *
 *   signup page -> seeded owner (D-02 option C, below) -> GET /app sends the new
 *   owner to /app/onboarding -> manual onboarding (R0-06 on R0-32, no AI) ->
 *   lands in the workspace of the selected business (R0-18) -> create a contact
 *   -> edit it -> create an invoice -> issue it -> record a manual payment ->
 *   every page reloaded with its values read back from the server -> a second
 *   tenant is denied the first tenant's contact and invoice: in the browser,
 *   and with its token on the first tenant's business path (reads, contact
 *   edit, invoice status, payment), after which the first tenant's invoice,
 *   payments and contact read back unchanged.
 *
 * Throughout: no 5xx (an optional service answering the R0-07 503
 * `provider_not_configured` is recorded, not a failure, because that is its
 * contract), and no request leaves localhost.
 *
 * SUBSTITUTION, recorded in the run's output (owner ruling D-02, option C:
 * hosted Supabase). POST /identity/signup proxies Supabase sign-up, so the
 * sign-up submit needs a Supabase project, which a local stack does not have
 * and this run must not call. That leg runs in the operator-authorized staging
 * run (#186 step B). Here the spec renders /auth/signup, then starts the owner
 * the way the signup page does once Supabase has answered
 * (apps/web/src/app/auth/signup/page.tsx, the "authenticated" branch): an
 * access token (here an HS256 token shaped like a Supabase one, signed with
 * the API's SUPABASE_JWT_SECRET, which the API verifies locally under
 * NODE_ENV=test), POST /identity/bootstrap with the profile, kf_token and
 * kf_business_id stored, then /app.
 *
 * RUN (local stack; the API with the isolated database from wt-prep.sh /
 * scripts/test-local.sh, NODE_ENV=test, AI_DISABLED=1, HIBP_DISABLED=true, no
 * provider keys, SUPABASE_JWT_SECRET=<s>; see .github/workflows/e2e-live.yml):
 *
 *   E2E_LIVE=1 E2E_API_URL=http://localhost:<api port> E2E_JWT_SECRET=<s> \
 *     npx playwright test e2e/release0-live.spec.ts
 *
 * The config starts the web pointed at E2E_API_URL (or set E2E_NO_SERVER=1 and
 * E2E_BASE_URL for a web server already running). With the API stopped the
 * spec fails at its first step (the negative control).
 *
 * FIXTURES: every user id, user email and business name embeds the prefix
 * `k25a_` (the k<NN><a-z>_ head for R0-25) and a per-run stamp. The prefix is
 * NOT registered in apps/server/test/helpers/fixture-prefixes.json: that
 * registry covers apps/server/test suites, and its gate
 * (fixture-prefix-registry.spec.ts) requires each owner to be a file under
 * apps/server/test that declares the prefix, which this web spec is not. No
 * server suite's cleanup pattern reaches `k25a_` (new suites escape '_' with
 * sqlLikePrefix(); no legacy head matches it). Rows are left behind on
 * purpose (as in live-journey.spec.ts): a cleanup that runs after a failure
 * destroys the evidence. Users and businesses are found by the prefix;
 * contacts, invoices and payments carry no prefix and are found through the
 * business ids the run prints ("journey" in its output).
 */

const LIVE = process.env.E2E_LIVE === "1";
const API_URL = (process.env.E2E_API_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const JWT_SECRET = process.env.E2E_JWT_SECRET ?? "";

const PREFIX = "k25a_";
const RUN = `${PREFIX}${Date.now().toString(36)}`;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const SUBSTITUTION =
  "D-02 option C (hosted Supabase): the sign-up submit (POST /identity/signup, which calls Supabase) does not run here; " +
  "it runs in the operator-authorized staging run (#186 step B). This run rendered /auth/signup, then started each owner " +
  "from a seeded HS256 token (verified locally by the API under NODE_ENV=test) and POST /identity/bootstrap, the calls the " +
  "signup page makes once Supabase has answered.";

interface Owner {
  label: string;
  sub: string;
  email: string;
  token: string;
  businessId: string;
}

/** What the browser did, per context: hosts, server errors, and the API calls it made. */
interface Watch {
  offHost: string[];
  serverErrors: string[];
  optionalUnavailable: string[];
  apiCalls: Array<{ method: string; url: string; status: number }>;
}

const b64url = (s: string) => Buffer.from(s).toString("base64url");

/** An HS256 access token shaped like Supabase's, as the real-server suites mint (onboarding-manual-complete). */
function mintToken(sub: string, email: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({ sub, email, aud: "authenticated", role: "authenticated", iat: now, exp: now + 4 * 3600 }),
  );
  const signature = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function isLocal(url: string): boolean {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "ws:" && u.protocol !== "wss:") return true;
  return LOCAL_HOSTS.has(u.hostname);
}

function watch(context: BrowserContext): Watch {
  const w: Watch = { offHost: [], serverErrors: [], optionalUnavailable: [], apiCalls: [] };
  context.on("request", (req) => {
    if (!isLocal(req.url())) w.offHost.push(`${req.method()} ${req.url()}`);
  });
  context.on("page", (page) => {
    page.on("websocket", (ws) => {
      if (!isLocal(ws.url())) w.offHost.push(`WS ${ws.url()}`);
    });
  });
  context.on("response", async (res) => {
    const url = res.url();
    if (url.startsWith(`${API_URL}/`)) w.apiCalls.push({ method: res.request().method(), url, status: res.status() });
    if (res.status() < 500) return;
    const line = `${res.status()} ${res.request().method()} ${url}`;
    let code: unknown;
    try {
      code = ((await res.json()) as { code?: unknown } | null)?.code;
    } catch {
      code = undefined;
    }
    // R0-07: an optional service with no provider answers this 503 by contract.
    if (res.status() === 503 && code === "provider_not_configured") w.optionalUnavailable.push(line);
    else w.serverErrors.push(line);
  });
  return w;
}

/** The API calls a context made that named a business other than `businessId` (`/businesses/<id>/` paths). */
function callsNamingAnotherBusiness(w: Watch, businessId: string): string[] {
  const out: string[] = [];
  for (const c of w.apiCalls) {
    const path = new URL(c.url).pathname;
    const m = path.match(/\/businesses\/([^/]+)/);
    if (m && m[1] !== "slug" && decodeURIComponent(m[1]) !== businessId) out.push(`${c.status} ${c.method} ${path}`);
  }
  return [...new Set(out)];
}

/**
 * KNOWN DEFECT, recorded rather than hidden (M09, owned by R0-15, outside this
 * packet's write set): the contact panel and the contact form mount
 * ContactCustomFields without a businessId (components/contacts/
 * contact-detail-info.tsx and contact-form.tsx), so fetchCustomFieldDefinitions
 * (lib/client.ts) falls back to DEFAULT_BUSINESS_ID "biz_demo". The API refuses
 * it (403), so nothing leaks, but the structured custom fields never load. Only
 * this exact call, refused, is let through; any other call naming a business
 * that is not the selected one fails the run.
 */
const KNOWN_FOREIGN_CALLS = new Set(["403 GET /crm/businesses/biz_demo/custom-field-definitions"]);

async function seedOwner(request: APIRequestContext, label: string): Promise<Owner> {
  const sub = `${RUN}_${label}`;
  const email = `${sub}@k25a.test.local`;
  const token = mintToken(sub, email);
  const res = await request.post(`${API_URL}/identity/bootstrap`, {
    headers: { Authorization: `Bearer ${token}` },
    // What the signup page sends (signup/page.tsx), the company embedding the prefix.
    data: { email, name: `Owner ${label.toUpperCase()}`, firstName: "Owner", lastName: label.toUpperCase(), company: `${RUN} ${label.toUpperCase()} Trading` },
  });
  const body = await res.text();
  expect(res.status(), `POST /identity/bootstrap for ${label}: ${body}`).toBe(201);
  const parsed = JSON.parse(body) as { isNewBusiness?: boolean; business?: { id?: string; name?: string } };
  expect(parsed.isNewBusiness, body).toBe(true);
  expect(parsed.business?.name, body).toContain(PREFIX);
  return { label, sub, email, token, businessId: parsed.business!.id! };
}

/** Stores the session as the signup page does (setStoredToken, setStoredBusinessId: localStorage plus cookie). */
async function storeSession(page: Page, owner: Owner, businessId = owner.businessId) {
  await page.evaluate(
    ({ token, businessId }) => {
      const cookie = (name: string, value: string) =>
        (document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=604800; SameSite=Lax`);
      window.localStorage.setItem("kf_token", token);
      cookie("kf_token", token);
      window.localStorage.setItem("kf_business_id", businessId);
      cookie("kf_business_id", businessId);
    },
    { token: owner.token, businessId },
  );
}

const storedBusinessId = (page: Page) => page.evaluate(() => window.localStorage.getItem("kf_business_id"));

/** The Payment Summary card's Total, Paid and Remaining values. */
async function paymentSummary(page: Page) {
  const card = page.locator("h3", { hasText: /^Payment Summary$/i }).locator("xpath=..");
  const valueOf = (label: string) =>
    card.locator("span", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::span[1]").innerText();
  return { total: await valueOf("Total"), paid: await valueOf("Paid"), remaining: await valueOf("Remaining") };
}

const invoiceHeading = (page: Page, invoiceNumber: string) =>
  page.getByRole("heading", { level: 1, name: `Invoice ${invoiceNumber}` });

/** The status badge beside the invoice heading. */
const invoiceBadge = (page: Page, invoiceNumber: string): Locator =>
  invoiceHeading(page, invoiceNumber).locator("xpath=following-sibling::span[1]");

function record(testInfo: TestInfo, type: string, description: string) {
  testInfo.annotations.push({ type, description });
  console.log(`[release0-live] ${type}: ${description}`);
}

test.describe(LIVE ? "Release 0 live journey (R0-25)" : "Release 0 live journey (R0-25, skipped: set E2E_LIVE=1)", () => {
  test.skip(!LIVE, "requires a running API, web server and database (E2E_LIVE=1)");

  test("signup page -> seeded owner -> manual onboarding -> selected business -> contact, invoice, payment, each persisted across a reload; tenant B denied", async ({
    browser,
    request,
  }, testInfo) => {
    // A dev server compiles each route on first visit; the journey visits a dozen.
    test.setTimeout(20 * 60_000);

    // ── preflight: the stack this run claims to drive ─────────────────────────
    expect(JWT_SECRET, "E2E_JWT_SECRET must equal the API's SUPABASE_JWT_SECRET").not.toBe("");
    expect(isLocal(API_URL), `E2E_API_URL must be local, got ${API_URL}`).toBe(true);
    const baseURL = testInfo.project.use.baseURL ?? "";
    expect(isLocal(baseURL), `the web base URL must be local, got ${baseURL}`).toBe(true);
    // The negative control fails here: with the API stopped nothing answers.
    const health = await request.get(`${API_URL}/healthz`).catch((e: Error) => e);
    expect(health instanceof Error ? `unreachable: ${health.message}` : health.status(), `API at ${API_URL}/healthz`).toBe(200);

    record(testInfo, "substitution", SUBSTITUTION);
    record(testInfo, "run", `prefix ${RUN}; API ${API_URL}; web ${baseURL}`);

    const contextA = await browser.newContext();
    const watchA = watch(contextA);
    const page = await contextA.newPage();

    // ── step 1a: the sign-up page renders ─────────────────────────────────────
    await test.step("the sign-up page renders (its submit is the staging leg, D-02 option C)", async () => {
      await page.goto("/auth/signup");
      await expect(page.locator('input[placeholder="John"]')).toBeVisible();
      await expect(page.getByRole("button", { name: /continue/i }).first()).toBeVisible();
    });

    // ── step 1b: the seeded owner, started as the signup page starts one ──────
    const ownerA = await seedOwner(request, "a");
    await storeSession(page, ownerA);
    const businessName = `${RUN} Bakery`;

    await test.step("GET /app sends the new owner to /app/onboarding, and the manual path completes it without AI", async () => {
      await page.goto("/app");
      await page.waitForURL(/\/app\/onboarding(\?|$)/);
      const manual = page.locator("section", { has: page.getByRole("heading", { name: /set up manually/i }) });
      await expect(manual).toBeVisible();
      await manual.getByLabel("Business name").fill(businessName);
      await manual.getByLabel("Currency").fill("TTD");
      await manual.getByLabel("Timezone").fill("America/Port_of_Spain");
      await manual.getByRole("button", { name: /finish setup/i }).click();
      await page.waitForURL(/\/app\/command-center/);
    });

    await test.step("lands on the selected business, and stays there across a reload", async () => {
      expect(await storedBusinessId(page)).toBe(ownerA.businessId);
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await expect(page).toHaveURL(/\/app\/command-center/);
      // Onboarding is finished on the server, so its page sends the owner back to the workspace.
      await page.goto("/app/onboarding");
      await page.waitForURL(/\/app\/command-center/);
      expect(await storedBusinessId(page)).toBe(ownerA.businessId);
      const profile = await request.get(`${API_URL}/identity/businesses/${ownerA.businessId}`, {
        headers: { Authorization: `Bearer ${ownerA.token}` },
      });
      expect(profile.status()).toBe(200);
      expect(await profile.json()).toMatchObject({ id: ownerA.businessId, name: businessName, currency: "TTD", timezone: "America/Port_of_Spain" });
    });

    // ── step 2: create and edit a contact ─────────────────────────────────────
    const firstName = "Ada";
    const lastName = `Lovelace${Date.now().toString(36)}`;
    const editedLastName = `${lastName}-Byron`;
    let contactId = "";

    await test.step("create a contact from Contacts quick-add; it is listed after a reload", async () => {
      await page.goto("/app/crm/contacts");
      await expect(page.getByRole("heading", { level: 1, name: "Contacts" })).toBeVisible();
      await page.getByRole("button", { name: "Add contact" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Add contact" });
      await expect(dialog).toBeVisible();
      await dialog.getByPlaceholder("Jane", { exact: true }).fill(firstName);
      await dialog.getByPlaceholder("Doe", { exact: true }).fill(lastName);
      const created = page.waitForResponse(
        (r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/crm/businesses/${ownerA.businessId}/contacts`,
      );
      await dialog.getByRole("button", { name: /add contact/i }).click();
      const res = await created;
      expect(res.status(), await res.text()).toBe(201);
      contactId = ((await res.json()) as { id: string }).id;
      expect(contactId).toBeTruthy();
      await expect(page.getByText(lastName).first()).toBeVisible();

      await page.reload();
      await expect(page.getByText(lastName).first()).toBeVisible();
    });

    await test.step("edit the contact; the edit is read back after a reload", async () => {
      await page.goto(`/app/crm/contacts/${contactId}/overview`);
      await expect(page.getByRole("heading", { level: 1, name: `${firstName} ${lastName}` })).toBeVisible();
      // The list view (the default focus view has no edit door): the row's panel holds Edit. The
      // list opens its first contact's panel by itself (use-contact-detail.ts auto-select), and a
      // click on an open row closes it, so the row is clicked only when its panel is not the open one.
      await page.goto("/app/crm/contacts?view=list");
      // The card (role=option, labelled "<name> - <status>") inside the row wrapper, which is an option too.
      const row = page.locator(`div[role="option"][aria-label^="${firstName} ${lastName} - "]`);
      await expect(row).toBeVisible();
      const panel = page.getByRole("region", { name: "Contact details" });
      await expect(panel).toBeVisible();
      if ((await row.getAttribute("aria-selected")) !== "true") await row.click();
      await expect(row).toHaveAttribute("aria-selected", "true");
      await expect(panel).toHaveCount(1);
      await panel.getByTitle("Edit client").click();
      const form = page.getByRole("dialog", { name: /edit contact/i });
      await expect(form).toBeVisible();
      await form.locator("#contact-form-lastName").fill(editedLastName);
      const patched = page.waitForResponse(
        (r) =>
          r.request().method() === "PATCH" &&
          new URL(r.url()).pathname === `/crm/businesses/${ownerA.businessId}/contacts/${contactId}`,
      );
      await form.getByRole("button", { name: /save changes/i }).click();
      const res = await patched;
      expect(res.status(), await res.text()).toBe(200);

      await page.goto(`/app/crm/contacts/${contactId}/overview`);
      await expect(page.getByRole("heading", { level: 1, name: `${firstName} ${editedLastName}` })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: `${firstName} ${editedLastName}` })).toBeVisible();
    });

    // ── step 3: create and issue an invoice ───────────────────────────────────
    let invoiceId = "";
    let invoiceNumber = "";

    await test.step("create a DRAFT invoice for the contact (two items, TTD 250.00); it reads back after a reload", async () => {
      await page.goto("/app/commerce/invoices/new");
      await expect(page.getByRole("heading", { name: "New Invoice" })).toBeVisible();
      const client = page.locator("select", { has: page.locator("option", { hasText: "Select a client..." }) });
      await expect(client.locator(`option[value="${contactId}"]`)).toBeAttached();
      await client.selectOption(contactId);
      await page.getByRole("button", { name: /add item/i }).click();
      const descriptions = page.getByPlaceholder("Item description");
      await expect(descriptions).toHaveCount(2);
      const fill = async (row: number, description: string, qty: string, price: string) => {
        await descriptions.nth(row).fill(description);
        const line = descriptions.nth(row).locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' grid ')][1]");
        const numbers = line.locator('input[type="number"]');
        await numbers.nth(0).fill(qty);
        await numbers.nth(1).fill(price);
      };
      await fill(0, "Consulting", "2", "100");
      await fill(1, "Setup", "1", "50");
      const created = page.waitForResponse(
        (r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/commerce/businesses/${ownerA.businessId}/invoices`,
      );
      await page.getByRole("button", { name: /save draft/i }).click();
      const res = await created;
      expect(res.status(), await res.text()).toBe(201);
      const body = (await res.json()) as { id: string; invoiceNumber: string; status: string; total: number | string; currency: string };
      expect(body).toMatchObject({ status: "DRAFT", currency: "TTD" });
      expect(Number(body.total)).toBe(250);
      invoiceId = body.id;
      invoiceNumber = body.invoiceNumber;
      await page.waitForURL(new RegExp(`/app/commerce/invoices/${invoiceId}$`));

      await expect(invoiceHeading(page, invoiceNumber)).toBeVisible();
      await expect(invoiceBadge(page, invoiceNumber)).toHaveText("Draft");
      expect(await paymentSummary(page)).toEqual({ total: "TTD 250.00", paid: "TTD 0.00", remaining: "TTD 250.00" });
      await page.reload();
      await expect(invoiceHeading(page, invoiceNumber)).toBeVisible();
      await expect(invoiceBadge(page, invoiceNumber)).toHaveText("Draft");
      await expect(page.getByText("Consulting")).toBeVisible();
      await expect(page.getByText("Setup", { exact: true })).toBeVisible();
      expect(await paymentSummary(page)).toEqual({ total: "TTD 250.00", paid: "TTD 0.00", remaining: "TTD 250.00" });
    });

    await test.step("issue the invoice (Send -> Confirm & Send); SENT is read back after a reload", async () => {
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Send Invoice" })).toBeVisible();
      const sent = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(invoiceId) && /status/i.test(r.url()));
      await page.getByRole("button", { name: /confirm & send/i }).click();
      const res = await sent;
      expect(res.status(), await res.text()).toBeLessThan(300);
      await expect(invoiceBadge(page, invoiceNumber)).toHaveText("Sent");
      await page.reload();
      await expect(invoiceHeading(page, invoiceNumber)).toBeVisible();
      await expect(invoiceBadge(page, invoiceNumber)).toHaveText("Sent");
      await expect(page.getByRole("button", { name: /record payment/i }).first()).toBeVisible();
    });

    // ── step 4: record a manual payment ───────────────────────────────────────
    await test.step("record a manual payment of 100; 100 paid, 150 remaining, Part-paid, read back after a reload", async () => {
      await page.getByRole("button", { name: /record payment/i }).first().click();
      const modal = page.locator("div", { has: page.getByRole("heading", { name: "Record Payment" }) }).last();
      await modal.getByPlaceholder("250.00").fill("100");
      const recorded = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).pathname === `/commerce/businesses/${ownerA.businessId}/invoices/${invoiceId}/payments`,
      );
      await modal.getByRole("button", { name: "Record Payment" }).click();
      const res = await recorded;
      expect(res.status(), await res.text()).toBe(201);
      const sentBody = res.request().postDataJSON() as { amount: number; method: string; idempotencyKey?: string };
      expect(sentBody).toMatchObject({ amount: 100, method: "Cash" });
      expect(typeof sentBody.idempotencyKey).toBe("string");
      await expect(page.getByRole("heading", { name: "Record Payment" })).toHaveCount(0);
      expect(await paymentSummary(page)).toEqual({ total: "TTD 250.00", paid: "TTD 100.00", remaining: "TTD 150.00" });
      await expect(invoiceBadge(page, invoiceNumber)).toHaveText("Part-paid");

      await page.reload();
      await expect(invoiceHeading(page, invoiceNumber)).toBeVisible();
      await expect(invoiceBadge(page, invoiceNumber)).toHaveText("Part-paid");
      expect(await paymentSummary(page)).toEqual({ total: "TTD 250.00", paid: "TTD 100.00", remaining: "TTD 150.00" });
    });

    await test.step("the contact list and the contact still read back after a reload", async () => {
      await page.goto("/app/crm/contacts");
      await expect(page.getByText(editedLastName).first()).toBeVisible();
      await page.reload();
      await expect(page.getByText(editedLastName).first()).toBeVisible();
      expect(await storedBusinessId(page)).toBe(ownerA.businessId);
    });

    // ── tenant B: denied tenant A's contact and invoice ───────────────────────
    const ownerB = await seedOwner(request, "b");
    // Tenant B finishes onboarding through the same two routes the manual step uses.
    const auth = { Authorization: `Bearer ${ownerB.token}` };
    const profileB = await request.patch(`${API_URL}/identity/businesses/${ownerB.businessId}`, {
      headers: auth,
      data: { name: `${RUN} B Bakery`, currency: "TTD", timezone: "America/Port_of_Spain" },
    });
    expect(profileB.status(), await profileB.text()).toBe(200);
    const completeB = await request.post(`${API_URL}/onboarding-concierge/businesses/${ownerB.businessId}/complete`, { headers: auth });
    expect(completeB.status(), await completeB.text()).toBe(201);

    const contextB = await browser.newContext();
    const watchB = watch(contextB);
    const pageB = await contextB.newPage();

    await test.step("tenant B, in its own business, opening tenant A's invoice and contact gets not-found, never A's data", async () => {
      await pageB.goto("/auth/signup");
      await storeSession(pageB, ownerB);
      await pageB.goto(`/app/commerce/invoices/${invoiceId}`);
      await expect(pageB.getByRole("heading", { name: "Invoice not found" })).toBeVisible();
      await expect(pageB.getByText(invoiceNumber)).toHaveCount(0);
      await expect(pageB.getByText(/payment summary/i)).toHaveCount(0);

      await pageB.goto(`/app/crm/contacts/${contactId}/overview`);
      await expect(pageB.getByTestId("contact-unavailable")).toBeVisible();
      await expect(pageB.getByText(editedLastName)).toHaveCount(0);
    });

    await test.step("tenant B with tenant A's business forced into its session: every call its browser makes on A's business is refused, and it is never shown A's data", async () => {
      // The invoice page re-selects its business from the server
      // (refreshWorkspace() in app/commerce/invoices/[id]/page.tsx), which
      // replaces the forced id with B's own, so the browser never asks for A's
      // invoice on A's path; its A-path calls here are the app shell's. A's
      // invoice, payments and contact on A's path are probed with B's token in
      // the next step (review repair SEC-R025-1).
      await storeSession(pageB, ownerB, ownerA.businessId);
      await pageB.goto(`/app/commerce/invoices/${invoiceId}`);
      await expect(pageB.getByRole("heading", { name: "Invoice not found" })).toBeVisible();
      await expect(pageB.getByText(invoiceNumber)).toHaveCount(0);
      await pageB.goto("/app/crm/contacts");
      await expect(pageB.getByRole("heading", { level: 1, name: "Contacts" })).toBeVisible();
      await pageB.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await expect(pageB.getByText(editedLastName)).toHaveCount(0);
      // Every read B's browser made of tenant A's business was refused.
      const onA = watchB.apiCalls.filter((c) => new URL(c.url).pathname.includes(`/businesses/${ownerA.businessId}`));
      expect(onA.length, "B's browser never asked for tenant A's business").toBeGreaterThan(0);
      expect(onA.filter((c) => c.status < 400), "a read of tenant A's business that B was allowed").toEqual([]);
      expect(onA.filter((c) => c.status !== 403 && c.status !== 404)).toEqual([]);
    });

    await test.step("tenant B's token on tenant A's business path: every read and write of A's invoice, payments and contact is refused (403); A's records are unchanged", async () => {
      const invoiceOnA = `${API_URL}/commerce/businesses/${ownerA.businessId}/invoices/${invoiceId}`;
      const contactOnA = `${API_URL}/crm/businesses/${ownerA.businessId}/contacts/${contactId}`;
      // Each write, had it been admitted, would show in the read-back below.
      const attempts: Array<[string, () => Promise<APIResponse>]> = [
        ["GET A's contact", () => request.get(contactOnA, { headers: auth })],
        ["GET A's invoice", () => request.get(invoiceOnA, { headers: auth })],
        ["GET A's invoice payments", () => request.get(`${invoiceOnA}/payments`, { headers: auth })],
        ["PATCH A's contact", () => request.patch(contactOnA, { headers: auth, data: { lastName: `${RUN}_b_overwrote` } })],
        [
          "PATCH A's invoice status to VOID (tenant A named in the body)",
          () =>
            request.patch(`${API_URL}/commerce/invoices/${invoiceId}/status/void`, {
              headers: auth,
              data: { businessId: ownerA.businessId, status: "VOID" },
            }),
        ],
        [
          "POST a payment on A's invoice",
          () =>
            request.post(`${invoiceOnA}/payments`, {
              headers: auth,
              data: { amount: 150, method: "Cash", idempotencyKey: `${RUN}_b_payment` },
            }),
        ],
      ];
      const answered: string[] = [];
      for (const [label, call] of attempts) {
        const res = await call();
        answered.push(`${label}: ${res.status()}`);
      }
      record(testInfo, "tenant-b-on-a-path", answered.join("; "));
      expect(answered, "tenant B's token on tenant A's business path").toEqual(attempts.map(([label]) => `${label}: 403`));

      // Read back as tenant A: still part-paid 100 of 250 (not VOID), one payment, the edited contact.
      const authA = { Authorization: `Bearer ${ownerA.token}` };
      const invoiceA = await request.get(invoiceOnA, { headers: authA });
      expect(invoiceA.status(), await invoiceA.text()).toBe(200);
      const inv = (await invoiceA.json()) as { status: string; total: number | string; paidAmount: number; remaining: number };
      expect({ status: inv.status, total: Number(inv.total), paidAmount: inv.paidAmount, remaining: inv.remaining }).toEqual({
        status: "PARTIALLY_PAID",
        total: 250,
        paidAmount: 100,
        remaining: 150,
      });
      const paymentsA = await request.get(`${invoiceOnA}/payments`, { headers: authA });
      expect(paymentsA.status(), await paymentsA.text()).toBe(200);
      const pays = (await paymentsA.json()) as { payments: Array<{ amount: number | string }> };
      expect(pays.payments.map((p) => Number(p.amount)), "the payments on tenant A's invoice").toEqual([100]);
      const contactA = await request.get(contactOnA, { headers: authA });
      expect(contactA.status(), await contactA.text()).toBe(200);
      // The contact detail route answers { contact, bookings, notes, tasks, ... }.
      const detail = (await contactA.json()) as { contact?: unknown };
      expect(detail.contact, "tenant A's contact").toMatchObject({ id: contactId, firstName, lastName: editedLastName });
    });

    // ── the whole run ─────────────────────────────────────────────────────────
    await test.step("no request left localhost, no 5xx, and tenant A's browser only ever named its own business", async () => {
      const apiAnswered = watchA.apiCalls.filter((c) => c.status >= 200 && c.status < 300);
      expect(apiAnswered.length, `the browser talked to the live API at ${API_URL}`).toBeGreaterThan(10);
      expect([...watchA.offHost, ...watchB.offHost], "requests that left localhost").toEqual([]);
      expect([...watchA.serverErrors, ...watchB.serverErrors], "5xx responses").toEqual([]);
      const foreign = callsNamingAnotherBusiness(watchA, ownerA.businessId);
      expect(foreign.filter((c) => !KNOWN_FOREIGN_CALLS.has(c)), "tenant A's browser named another business").toEqual([]);
      record(
        testInfo,
        "known-defect",
        foreign.length
          ? `M09 (R0-15): the selected business was bypassed by ${foreign.join("; ")} (ContactCustomFields without businessId falls back to biz_demo; refused by the API)`
          : "M09 (R0-15) biz_demo fallback not observed in this run",
      );
      const optional = [...watchA.optionalUnavailable, ...watchB.optionalUnavailable];
      record(
        testInfo,
        "optional-services",
        optional.length
          ? `${optional.length} R0-07 503 provider_not_configured answer(s), by contract: ${[...new Set(optional.map((l) => l.replace(/\/businesses\/[^/]+/, "/businesses/:b")))].join("; ")}`
          : "none called",
      );
      record(
        testInfo,
        "journey",
        `owner A ${ownerA.sub} business ${ownerA.businessId} (${businessName}); contact ${contactId}; invoice ${invoiceNumber} (${invoiceId}) SENT then PARTIALLY_PAID 100/250; owner B ${ownerB.sub} business ${ownerB.businessId} denied`,
      );
    });

    await testInfo.attach("release0-live-output.txt", {
      contentType: "text/plain",
      body: testInfo.annotations.map((a) => `${a.type}: ${a.description}`).join("\n"),
    });
    await contextA.close();
    await contextB.close();
  });
});
