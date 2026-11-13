import {
  test as base,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { createHmac } from "node:crypto";
import { liveSessionState } from "../helpers/workspace";
import {
  JOURNEY_PREFIX,
  KEY_UI,
  LOAD_BUDGET_MS,
  THROTTLE_3G,
  describeTiming,
  devBuildSigns,
  nextBuildIdOf,
  parseVariant,
  type JourneyVariant,
  type LoadTiming,
} from "./harness-settings";

/**
 * GATE-HARNESS: the shared fixtures and helpers of the v1 journey specs
 * (e2e/journeys/*.spec.ts). README.md in this folder says how to run them and
 * what the harness cannot reach.
 *
 * Every journey runs against a real API, Postgres and Redis (E2E_LIVE=1, as
 * release0-live.spec.ts does), with a fresh tenant per test, signed in the way
 * release0-live.spec.ts signs one in: an HS256 token shaped like a Supabase
 * one, signed with the secret the API verifies locally under NODE_ENV=test
 * (E2E_JWT_SECRET = the API's SUPABASE_JWT_SECRET), and POST
 * /identity/bootstrap. Nothing is mocked.
 *
 * Before the first journey of a worker, the stack is checked (preflight):
 * the API answers, the API and web are local, the web is a production build
 * (`next build` output, so feature flags take production values), and the API
 * runs the variant E2E_VARIANT names. Throughout every journey: no request
 * leaves localhost and no 5xx (the R0-07 503 provider_not_configured of an
 * optional service is recorded, not a failure, as in release0-live.spec.ts).
 */

export { expect } from "@playwright/test";

export const LIVE = process.env.E2E_LIVE === "1";
export const API_URL = (process.env.E2E_API_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const JWT_SECRET = process.env.E2E_JWT_SECRET ?? "";
export const VARIANT: JourneyVariant = parseVariant(process.env.E2E_VARIANT);

/** This worker's fixture stamp: every user id, email and business name embeds it (README: fixtures). */
export const RUN = `${JOURNEY_PREFIX}${Date.now().toString(36)}${process.env.TEST_WORKER_INDEX ?? ""}`;
let tenantSeq = 0;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLocal(url: string): boolean {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "ws:" && u.protocol !== "wss:") return true;
  return LOCAL_HOSTS.has(u.hostname);
}

// ── tenants ───────────────────────────────────────────────────────────────

/** The onboarding answer that sets the hubs (BIZ-SETTINGS-SERVER: Business.metaData.sells). */
export type Sells = "services" | "products" | "both";
export type Currency = "TTD" | "USD";

export interface TenantOptions {
  /** Finish onboarding through the two routes the manual form uses (default true). */
  onboard?: boolean;
  currency?: Currency;
  sells?: Sells;
  timezone?: string;
  /** Business name; the run's prefix is always embedded. */
  businessName?: string;
}

export interface Tenant {
  label: string;
  sub: string;
  email: string;
  token: string;
  businessId: string;
  businessName: string;
  currency: Currency;
  sells: Sells | null;
  onboarded: boolean;
}

const b64url = (s: string) => Buffer.from(s).toString("base64url");

/** An HS256 access token shaped like Supabase's (release0-live.spec.ts mintToken). */
export function mintToken(sub: string, email: string, ttlSec = 4 * 3600): string {
  expect(JWT_SECRET, "E2E_JWT_SECRET must equal the API's SUPABASE_JWT_SECRET").not.toBe("");
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({ sub, email, aud: "authenticated", role: "authenticated", iat: now, exp: now + ttlSec }),
  );
  const signature = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * A fresh tenant: a new user and the business POST /identity/bootstrap makes
 * for a first sign-in (OWNER). With onboard (the default) it then does what the
 * manual onboarding form does (PATCH /identity/businesses/:id with name,
 * currency and timezone; POST /onboarding-concierge/businesses/:id/complete),
 * so /app lands on Today. Journey A drives onboarding in the browser instead
 * (onboard: false).
 */
export async function freshTenant(request: APIRequestContext, label: string, options: TenantOptions = {}): Promise<Tenant> {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "t";
  tenantSeq += 1;
  const sub = `${RUN}_${slug}_${tenantSeq}`;
  const email = `${sub}@v62j.test.local`;
  const token = mintToken(sub, email);
  const currency = options.currency ?? "TTD";
  const businessName = `${RUN} ${options.businessName ?? `${slug} Trading`}`;
  const res = await request.post(`${API_URL}/identity/bootstrap`, {
    headers: auth(token),
    data: { email, name: `Owner ${slug}`, firstName: "Owner", lastName: slug, company: businessName },
  });
  const body = await res.text();
  expect(res.status(), `POST /identity/bootstrap for ${label}: ${body}`).toBe(201);
  const parsed = JSON.parse(body) as { isNewBusiness?: boolean; business?: { id?: string } };
  expect(parsed.isNewBusiness, body).toBe(true);
  const tenant: Tenant = {
    label,
    sub,
    email,
    token,
    businessId: parsed.business!.id!,
    businessName,
    currency,
    sells: options.sells ?? null,
    onboarded: false,
  };
  if (options.onboard ?? true) {
    const profile = await request.patch(`${API_URL}/identity/businesses/${tenant.businessId}`, {
      headers: auth(token),
      data: { name: businessName, currency, timezone: options.timezone ?? "America/Port_of_Spain" },
    });
    expect(profile.status(), `PATCH the business profile of ${label}: ${await profile.text()}`).toBe(200);
    const complete = await request.post(`${API_URL}/onboarding-concierge/businesses/${tenant.businessId}/complete`, {
      headers: auth(token),
    });
    expect(complete.status(), `complete onboarding for ${label}: ${await complete.text()}`).toBe(201);
    tenant.onboarded = true;
  }
  if (options.sells) await seedBusinessType(request, tenant, options.sells);
  return tenant;
}

/**
 * The "services, products or both" answer, stored where BIZ-SETTINGS-SERVER
 * keeps it (Business.metaData.sells, through the owner-only profile PATCH,
 * which merges the bag over the stored one). Read back, so a refusal fails here.
 */
export async function seedBusinessType(request: APIRequestContext, tenant: Tenant, sells: Sells): Promise<void> {
  const res = await request.patch(`${API_URL}/identity/businesses/${tenant.businessId}`, {
    headers: auth(tenant.token),
    data: { metaData: { sells } },
  });
  expect(res.status(), `store sells=${sells} for ${tenant.label}: ${await res.text()}`).toBe(200);
  const read = await request.get(`${API_URL}/identity/businesses/${tenant.businessId}`, { headers: auth(tenant.token) });
  expect(read.status()).toBe(200);
  const business = (await read.json()) as { metaData?: { sells?: unknown } };
  expect(business.metaData?.sells, `sells read back for ${tenant.label}`).toBe(sells);
  tenant.sells = sells;
}

/** A browser context signed in as `tenant`, on its business (workspace.ts liveSessionState), for a second person. */
export async function signedInContext(browser: Browser, tenant: Tenant, baseURL: string): Promise<BrowserContext> {
  return browser.newContext({ storageState: liveSessionState(tenant.token, tenant.businessId, baseURL) });
}

// ── what the browser did ──────────────────────────────────────────────────

export interface Watch {
  offHost: string[];
  serverErrors: string[];
  optionalUnavailable: string[];
  apiCalls: Array<{ method: string; url: string; status: number }>;
}

/** Records, per context, requests that left localhost, 5xx answers and API calls (release0-live.spec.ts watch). */
export function watch(context: BrowserContext): Watch {
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
    if (res.status() === 503 && code === "provider_not_configured") w.optionalUnavailable.push(line);
    else w.serverErrors.push(line);
  });
  return w;
}

// ── preflight ─────────────────────────────────────────────────────────────

export interface Stack {
  apiUrl: string;
  webUrl: string;
  variant: JourneyVariant;
  webBuildId: string | null;
  /** What the preflight saw, for the run's output. */
  notes: string[];
}

/**
 * The stack this run claims to drive, checked once per worker: refuses a
 * non-local API or web, a web that is not a production build, and an API that
 * does not run the variant E2E_VARIANT names.
 *
 *   ai-disabled   no AI provider is configured (GET .../ai/provider-health), and
 *                 a chat call answers 503 provider_not_configured WITHOUT reason
 *                 key_disabled (the probe is sent only once no provider is
 *                 configured, so it cannot reach one).
 *   key-disabled  a chat call answers 503 provider_not_configured WITH reason
 *                 key_disabled (refused before anything is read or called).
 *   ai-on         at least one provider is configured. No chat call is sent:
 *                 the preflight spends nothing on the capped key.
 */
export async function preflight(webUrl: string): Promise<Stack> {
  const notes: string[] = [];
  expect(isLocal(API_URL), `E2E_API_URL must be local, got ${API_URL}`).toBe(true);
  expect(isLocal(webUrl), `the web base URL must be local, got ${webUrl}`).toBe(true);
  const api = await playwrightRequest.newContext();
  try {
    const health = await api.get(`${API_URL}/healthz`).catch((e: Error) => e);
    expect(health instanceof Error ? `unreachable: ${health.message}` : health.status(), `API at ${API_URL}/healthz`).toBe(200);

    // The web: a production build, so feature flags take production values.
    const page = await api.get(`${webUrl}/auth/login`).catch((e: Error) => e);
    expect(page instanceof Error ? `unreachable: ${page.message}` : page.status(), `web at ${webUrl}/auth/login`).toBe(200);
    const html = page instanceof Error ? "" : await page.text();
    expect(devBuildSigns(html), `the web at ${webUrl} must serve \`next build\` output (E2E_WEB_COMMAND=standalone)`).toEqual([]);
    const webBuildId = nextBuildIdOf(html);
    notes.push(`web ${webUrl} build ${webBuildId}`);

    // The API: the variant. A throwaway tenant (the preflight's own) asks.
    const probe = await freshTenant(api, "preflight", { onboard: false });
    const providers = await api.get(`${API_URL}/ai/businesses/${probe.businessId}/ai/provider-health`, { headers: auth(probe.token) });
    expect(providers.status(), await providers.text()).toBe(200);
    const configured = ((await providers.json()) as Array<{ provider: string; configured: boolean }>)
      .filter((p) => p.configured)
      .map((p) => p.provider);
    if (VARIANT === "ai-on") {
      expect(configured.length, "E2E_VARIANT=ai-on needs an AI provider configured on the API (a capped test key)").toBeGreaterThan(0);
      notes.push(`variant ai-on: providers configured ${configured.join(", ")}; no AI call made by the preflight`);
    } else {
      expect(configured, `E2E_VARIANT=${VARIANT}: the API must have no AI provider key`).toEqual([]);
      const chat = await api.post(`${API_URL}/ai/businesses/${probe.businessId}/ai/chat`, {
        headers: auth(probe.token),
        data: { message: "preflight" },
      });
      const text = await chat.text();
      const body = (() => {
        try {
          return JSON.parse(text) as { code?: string; details?: { reason?: string } };
        } catch {
          return {};
        }
      })();
      expect({ status: chat.status(), code: body.code }, `the API's AI refusal: ${text}`).toEqual({
        status: 503,
        code: "provider_not_configured",
      });
      const keyDisabled = body.details?.reason === "key_disabled";
      expect(keyDisabled, `E2E_VARIANT=${VARIANT}: the API ${keyDisabled ? "runs" : "does not run"} with KEY_DISABLED`).toBe(
        VARIANT === "key-disabled",
      );
      notes.push(`variant ${VARIANT}: no AI provider configured; AI refusal ${chat.status()} ${body.code}${keyDisabled ? " (key_disabled)" : ""}`);
    }
    return { apiUrl: API_URL, webUrl, variant: VARIANT, webBuildId, notes };
  } finally {
    await api.dispose();
  }
}

// ── fixtures ──────────────────────────────────────────────────────────────

interface JourneyFixtures {
  /** How the owner fixture's tenant is made; set per file with test.use({ tenantOptions: { ... } }). */
  tenantOptions: TenantOptions;
  /** A fresh onboarded tenant for this test, and the session the page starts signed in to. */
  owner: Tenant;
  /** The page's context, watched; the test fails on a request off localhost or a 5xx. */
  journeyWatch: Watch;
}

interface JourneyWorkerFixtures {
  stack: Stack;
}

const NOT_LIVE = "requires a running API, web server and database (E2E_LIVE=1); see e2e/journeys/README.md";

/**
 * `test` for journey specs. Without E2E_LIVE every journey is skipped with the
 * reason (as release0-live.spec.ts is): it needs a running API, web and
 * database. With it, `owner` is a fresh tenant and `page` (and `context`)
 * start signed in to it; a second person (a member, another tenant) gets their
 * own context from freshTenant() and signedInContext(), and a customer an
 * anonymous browser.newContext().
 */
export const test = base.extend<JourneyFixtures, JourneyWorkerFixtures>({
  stack: [
    async ({}, use, workerInfo) => {
      const webUrl = String(workerInfo.project.use.baseURL ?? "");
      await use(LIVE ? await preflight(webUrl) : { apiUrl: API_URL, webUrl, variant: VARIANT, webBuildId: null, notes: ["not live"] });
    },
    { scope: "worker" },
  ],
  tenantOptions: [{}, { option: true }],
  owner: async ({ stack, request, tenantOptions }, use, testInfo) => {
    testInfo.skip(!LIVE, NOT_LIVE);
    const tenant = await freshTenant(request, testInfo.title, tenantOptions);
    testInfo.annotations.push({
      type: "tenant",
      description: `${tenant.sub} business ${tenant.businessId} (${tenant.businessName}, ${tenant.currency}${tenant.sells ? `, sells ${tenant.sells}` : ""}); ${stack.notes.join("; ")}`,
    });
    await use(tenant);
  },
  storageState: async ({ owner, baseURL }, use) => {
    await use(liveSessionState(owner.token, owner.businessId, baseURL ?? undefined));
  },
  journeyWatch: [
    async ({ context }, use, testInfo) => {
      testInfo.skip(!LIVE, NOT_LIVE);
      const w = watch(context);
      await use(w);
      if (w.optionalUnavailable.length) {
        testInfo.annotations.push({
          type: "optional-services",
          description: `${w.optionalUnavailable.length} R0-07 503 provider_not_configured answer(s), by contract`,
        });
      }
      expect.soft(w.offHost, "requests that left localhost").toEqual([]);
      expect.soft(w.serverErrors, "5xx responses").toEqual([]);
    },
    { auto: true },
  ],
});


// ── the controlled clock ──────────────────────────────────────────────────

/**
 * Pins the page's clock (Playwright page.clock) before it loads, so dates the
 * browser computes ("today", due dates, the booking picker) are the journey's.
 * The API keeps its own clock: legs that need the server's time moved (overdue,
 * reminders, recurring runs) are @scheduler legs and run in GATE-SCHEDULER-RUN,
 * which owns the server-side clock. Returns the page clock's controls.
 */
export async function controlledClock(page: Page, at: Date | string, testInfo?: TestInfo) {
  const time = typeof at === "string" ? new Date(at) : at;
  expect(Number.isNaN(time.getTime()), `controlledClock: invalid time ${String(at)}`).toBe(false);
  await page.clock.install({ time });
  testInfo?.annotations.push({ type: "clock", description: `browser clock pinned at ${time.toISOString()}` });
  return {
    /** Moves the browser's clock forward, firing due timers. */
    advance: (ms: number) => page.clock.runFor(ms),
    /** Jumps the browser's clock to a later time. */
    /** Sets the browser's clock to a later time without firing the timers in between. */
    jumpTo: (to: Date | string) => page.clock.setSystemTime(typeof to === "string" ? new Date(to) : to),
    time,
  };
}

// ── 3G load timing ────────────────────────────────────────────────────────

/**
 * Loads `url` on a throttled 3G network (Chrome DevTools' preset, cache off)
 * and records how long until `ready` holds: a tracked budget (journey I: 3 s
 * at 375px), never a pass/fail. The figure goes into the test's annotations
 * and an attached JSON (journey-timing-<label>.json) the gate run collects
 * into BUILD-MAP-001.md (GATE-JOURNEY-RUN). Off Chromium nothing is
 * throttled and the timing says so.
 */
export async function recordLoadTiming(
  page: Page,
  testInfo: TestInfo,
  label: string,
  url: string,
  ready: (page: Page) => Promise<unknown>,
  budgetMs = LOAD_BUDGET_MS,
): Promise<LoadTiming> {
  let cdp: Awaited<ReturnType<BrowserContext["newCDPSession"]>> | null = null;
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", THROTTLE_3G);
  } catch {
    cdp = null;
  }
  const started = Date.now();
  let readyMs = 0;
  let loadEventEndMs: number | null = null;
  try {
    await page.goto(url, { timeout: 120_000 });
    await ready(page);
    readyMs = Date.now() - started;
    loadEventEndMs = await page
      .evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        return nav && nav.loadEventEnd > 0 ? nav.loadEventEnd : null;
      })
      .catch(() => null);
  } finally {
    if (cdp) {
      await cdp
        .send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
        .catch(() => {});
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: false }).catch(() => {});
      await cdp.detach().catch(() => {});
    }
  }
  const timing: LoadTiming = {
    label,
    url,
    project: testInfo.project.name,
    viewport: page.viewportSize(),
    network: cdp ? "3G" : "unthrottled",
    readyMs,
    loadEventEndMs,
    budgetMs,
    overBudget: readyMs > budgetMs,
  };
  testInfo.annotations.push({ type: "load-timing", description: describeTiming(timing) });
  await testInfo.attach(`journey-timing-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`, {
    contentType: "application/json",
    body: JSON.stringify(timing, null, 2),
  });
  return timing;
}

// ── KEY UI and covered buttons ────────────────────────────────────────────

/**
 * The KEY UI on the page now, as findings (empty when there is none): each
 * visible element KEY_UI names (with its name, so the report says which door),
 * the KEY drawer if it opens without being asked for (the shell opens it 2 s
 * after Today loads for a new owner; this waits up to 5 s for it), and the
 * drawer if Ctrl+J or Cmd+J opens it. It closes anything that opened, scans
 * again (an open drawer hides the page from the accessibility tree), and
 * leaves the page as it found it.
 */
export async function keyUiFindings(page: Page): Promise<string[]> {
  const findings = new Set<string>();
  const drawer = page.getByRole("heading", { name: /^KEY$/ }).filter({ visible: true });
  const scan = async () => {
    for (const marker of KEY_UI) {
      if (marker.role === "heading") continue; // the drawer is reported below
      const found = page.getByRole(marker.role, { name: marker.name }).filter({ visible: true });
      const names = await found.evaluateAll((els) =>
        els.map((e) => (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60)),
      );
      for (const name of names) findings.add(`${marker.what} renders: "${name}"`);
    }
  };
  const closeDrawer = async () => {
    await page.keyboard.press("Escape");
    await drawer.first().waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
  };
  const opensWithin = (ms: number) =>
    drawer
      .first()
      .waitFor({ state: "visible", timeout: ms })
      .then(() => true)
      .catch(() => false);

  await scan();
  if (await opensWithin(5_000)) {
    findings.add("the KEY chat drawer (KeyChatPanel) opens without being asked for");
    await closeDrawer();
    await scan();
  }
  for (const shortcut of ["Control+j", "Meta+j"]) {
    await page.keyboard.press(shortcut);
    if (await opensWithin(1_500)) {
      findings.add(`${shortcut.replace("Control", "Ctrl").replace("Meta", "Cmd").replace("+j", "+J")} opens the KEY chat drawer`);
      await closeDrawer();
    }
  }
  return [...findings];
}

/**
 * What covers `target` where a finger or pointer would press it, or null when
 * nothing does: elementFromPoint at its centre and at two points inset 20%
 * from its left and right edges, after scrolling it as far into view as the
 * page allows (centred when the page can scroll that far, so a button that is
 * covered only until the user scrolls is not counted). Each covering element
 * is described by tag, accessible label and its first classes, with the point.
 */
export async function coveringElement(target: Locator): Promise<string | null> {
  await target.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" }));
  await target.page().waitForTimeout(150);
  const box = await target.boundingBox();
  expect(box, "the button to check has no box (not rendered)").not.toBeNull();
  const points = [
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
    { x: box!.x + box!.width * 0.2, y: box!.y + box!.height / 2 },
    { x: box!.x + box!.width * 0.8, y: box!.y + box!.height / 2 },
  ];
  const covers = await target.evaluate((el, pts) => {
    const describe = (node: Element | null): string => {
      if (!node) return "nothing (off screen)";
      const owner = node.closest("button, a, nav, [role], [aria-label]") ?? node;
      const label = owner.getAttribute("aria-label") ?? (owner.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
      const cls = (owner.getAttribute("class") ?? "").split(/\s+/).slice(0, 4).join(" ");
      return `<${owner.tagName.toLowerCase()}${label ? ` "${label}"` : ""}${cls ? ` class="${cls}"` : ""}>`;
    };
    const out: string[] = [];
    for (const p of pts) {
      const hit = document.elementFromPoint(p.x, p.y);
      if (!hit || !(hit === el || el.contains(hit))) out.push(`${describe(hit)} at (${Math.round(p.x)}, ${Math.round(p.y)})`);
    }
    return out;
  }, points);
  return covers.length ? covers.join("; ") : null;
}

/** Findings for each named primary button that something covers (empty when none is). */
export async function coveredButtonFindings(buttons: Array<{ what: string; locator: Locator }>): Promise<string[]> {
  const findings: string[] = [];
  for (const { what, locator } of buttons) {
    const cover = await coveringElement(locator);
    if (cover) findings.push(`${what} is covered by ${cover}`);
  }
  return findings;
}

/** Waits for the app shell to settle: the network quiet and the shell's own timers run (the KEY nudge fires at 2 s). */
export async function settle(page: Page, ms = 3_000): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(ms);
}
