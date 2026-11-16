import type { BrowserContext } from "@playwright/test";
import {
  test,
  expect,
  API_URL,
  allowBusinessNamed,
  anonymousContext,
  describeFinding,
  freshTenant,
  memberOf,
  signedInContext,
  watchFindingsSoFar,
} from "./journey-helpers";

/**
 * GATE-HARNESS self-check (review repair SEC-GH-1, SEC-GH-2, SEC-GH-3,
 * GH-COR-2): the harness's own guarantees, live, on each project and in each
 * variant. e2e-live.yml runs this file as its own required step and leaves it
 * out of the journeys' RED report (tag @harness).
 *
 *   - A customer's context (anonymousContext) starts with no session at all;
 *     a bare browser.newContext() / browser.newPage() is refused in a journey,
 *     because Playwright would start it signed in as the owner, unwatched.
 *   - A member (memberOf) is a member of the owner's business: module scopes
 *     refuse them, not tenancy, and their browser opens the owner's business.
 *   - Negative controls: what a customer's, a second tenant's or a member's
 *     browser does is watched like the owner's page. A request off localhost,
 *     a 5xx, and an API call naming a business the context is not on are each
 *     raised (watchFindingsSoFar) and would fail the journey; these tests
 *     declare exactly the findings they provoke (watchSelfCheck, which only
 *     this file may set), and the teardown fails them if any is not raised or
 *     anything else is.
 *   - An allowance the spec declares (allowBusinessNamed) lets a leg name
 *     another business on purpose, and is recorded.
 *
 * Nothing here leaves the machine: the off-host URLs are under `.invalid`
 * (RFC 6761: never resolves) and every context that asks for one aborts it
 * before it is sent; the 5xx is answered by the context itself.
 */

const OFF_HOST = "https://offhost.invalid";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** A request from a page of `context` to a host that is not localhost; aborted in the browser, so nothing is sent. */
async function requestOffHost(context: BrowserContext, tag: string): Promise<void> {
  await context.route(`${OFF_HOST}/**`, (route) => route.abort());
  const page = await context.newPage();
  await page.goto("/robots.txt");
  await page.evaluate((url) => fetch(url).then(
    () => null,
    () => null,
  ), `${OFF_HOST}/${tag}`);
}

/** GET {API}/crm/businesses/:id/contacts from `context`'s first page, with the session it holds; the status. */
async function readContactsOf(context: BrowserContext, businessId: string): Promise<number> {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("/robots.txt");
  return page.evaluate(
    async (url) => (await fetch(url, { headers: { Authorization: `Bearer ${window.localStorage.getItem("kf_token") ?? ""}` } })).status,
    `${API_URL}/crm/businesses/${encodeURIComponent(businessId)}/contacts`,
  );
}

const findingsNow = async () => (await watchFindingsSoFar()).map(describeFinding);

test.describe("journey harness self-check", { tag: "@harness" }, () => {
  test.describe.configure({ timeout: 180_000 });

  test("a customer's context starts with no session: no cookie, no stored token, and /app sends it to sign-in", async ({ browser, page, owner }) => {
    const customer = await anonymousContext(browser);
    expect(await customer.cookies(), "the customer's cookies").toEqual([]);
    const customerPage = await customer.newPage();
    await customerPage.goto("/app");
    await customerPage.waitForURL(/\/auth\/login/);
    expect(
      await customerPage.evaluate(() => [window.localStorage.getItem("kf_token"), window.localStorage.getItem("kf_business_id")]),
      "the customer's stored session",
    ).toEqual([null, null]);
    // The owner's own page is still the owner's.
    await page.goto("/robots.txt");
    expect(await page.evaluate(() => window.localStorage.getItem("kf_token"))).toBe(owner.token);
  });

  test("a bare browser.newContext() or browser.newPage() is refused in a journey: it would start signed in as the owner, unwatched", async ({ browser }) => {
    await expect(browser.newContext()).rejects.toThrow(/anonymousContext\(\)[\s\S]*signedInContext\(\)[\s\S]*memberOf\(\)/);
    await expect(browser.newPage()).rejects.toThrow(/anonymousContext\(\)/);
    await expect(browser.newContext({ storageState: { cookies: [], origins: [] } })).rejects.toThrow(/anonymousContext\(\)/);
  });

  test("a member is a member of the owner's business: module scopes refuse them, not tenancy, and their browser opens the owner's business", async ({
    browser,
    request,
    owner,
  }) => {
    const staff = await memberOf(request, owner, "staff member");
    expect({ businessId: staff.businessId, role: staff.role }).toEqual({ businessId: owner.businessId, role: "STAFF" });
    expect(staff.ownBusinessId, "the member's own first sign-in made a business of its own").not.toBe(owner.businessId);
    const as = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

    const business = await request.get(`${API_URL}/identity/businesses/${owner.businessId}`, as(staff.token));
    expect(business.status(), `the member reads the owner's business: ${await business.text()}`).toBe(200);
    const team = await request.get(`${API_URL}/identity/businesses/${owner.businessId}/team`, as(staff.token));
    expect(team.status()).toBe(403);
    expect(await team.text(), "refused by the module scope, not by tenancy").toMatch(
      /Insufficient permissions: team requires read access \(you have none\)/,
    );

    const reader = await memberOf(request, owner, "team reader", { scopes: { team: "read" } });
    expect(reader.scopes).toEqual({ team: "read" });
    const teamRead = await request.get(`${API_URL}/identity/businesses/${owner.businessId}/team`, as(reader.token));
    expect(teamRead.status(), `a member granted team:read reads the team: ${await teamRead.text()}`).toBe(200);

    // What the README used to call a member: another tenant, refused by tenancy.
    const stranger = await freshTenant(request, "stranger", { onboard: false });
    const refused = await request.get(`${API_URL}/identity/businesses/${owner.businessId}/team`, as(stranger.token));
    expect(refused.status()).toBe(403);
    expect(await refused.text()).toMatch(/No access to this business/);

    const memberBrowser = await signedInContext(browser, staff, { who: "staff member" });
    const memberPage = await memberBrowser.newPage();
    await memberPage.goto("/app");
    await memberPage.waitForURL(/\/app\/.+/);
    await memberPage.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    expect(await memberPage.evaluate(() => window.localStorage.getItem("kf_business_id")), "the member's browser stays on the owner's business").toBe(
      owner.businessId,
    );
    // The teardown holds the member's browser to the owner's business: no call names another.
  });

  test.describe("negative control: requests off localhost from a customer, a second tenant and a member", () => {
    test.use({
      watchSelfCheck: {
        provokes: [
          /^customer 1: left localhost: GET https:\/\/offhost\.invalid\/customer$/,
          /^second tenant: left localhost: GET https:\/\/offhost\.invalid\/second-tenant$/,
          /^member: left localhost: GET https:\/\/offhost\.invalid\/member$/,
        ],
      },
    });

    test("are each raised against the context that made them", async ({ browser, request, owner }) => {
      await requestOffHost(await anonymousContext(browser), "customer");
      const tenant = await freshTenant(request, "second tenant", { onboard: false });
      await requestOffHost(await signedInContext(browser, tenant, { who: "second tenant" }), "second-tenant");
      const member = await memberOf(request, owner, "member");
      await requestOffHost(await signedInContext(browser, member, { who: "member" }), "member");
      await expect.poll(findingsNow, { timeout: 10_000 }).toEqual([
        "customer 1: left localhost: GET https://offhost.invalid/customer",
        "second tenant: left localhost: GET https://offhost.invalid/second-tenant",
        "member: left localhost: GET https://offhost.invalid/member",
      ]);
    });
  });

  test.describe("negative control: a 5xx answered to a customer's page", () => {
    const path = "/__harness_self_check__/5xx";
    test.use({ watchSelfCheck: { provokes: [new RegExp(`^customer 1: 5xx: 500 GET ${escapeRe(API_URL + path)}$`)] } });

    test("is raised", async ({ browser }) => {
      const customer = await anonymousContext(browser);
      await customer.route(`${API_URL}${path}`, (route) =>
        route.fulfill({ status: 500, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"code":"self_check"}' }),
      );
      const page = await customer.newPage();
      await page.goto("/robots.txt");
      await page.evaluate((url) => fetch(url).then(
        () => null,
        () => null,
      ), `${API_URL}${path}`);
      await expect.poll(findingsNow, { timeout: 10_000 }).toEqual([`customer 1: 5xx: 500 GET ${API_URL}${path}`]);
    });
  });

  test.describe("negative control: the owner's browser naming another business (release0-live.spec.ts: no allowance)", () => {
    test.use({ watchSelfCheck: { provokes: [/^owner: named another business: 403 GET \/crm\/businesses\/[^/]+\/contacts$/] } });

    test("is raised, though the API refused it with a 403", async ({ context, request }) => {
      const other = await freshTenant(request, "other business", { onboard: false });
      expect(await readContactsOf(context, other.businessId), "the API refuses the read").toBe(403);
      await expect.poll(findingsNow, { timeout: 10_000 }).toEqual([
        `owner: named another business: 403 GET /crm/businesses/${other.businessId}/contacts`,
      ]);
    });
  });

  test("an allowance the spec declares (allowBusinessNamed) lets a leg name another business on purpose, and is recorded", async ({
    context,
    request,
  }, testInfo) => {
    const other = await freshTenant(request, "probed business", { onboard: false });
    allowBusinessNamed(context, other.businessId, "self-check: this leg reads another tenant's business on purpose");
    expect(await readContactsOf(context, other.businessId)).toBe(403);
    expect(await findingsNow()).toEqual([]);
    expect(testInfo.annotations).toContainEqual({
      type: "tenancy-allowance",
      description: `owner may name business ${other.businessId}: self-check: this leg reads another tenant's business on purpose`,
    });
    expect(() => allowBusinessNamed(context, other.businessId, " "), "an allowance needs its reason").toThrow(/reason/);
  });
});
