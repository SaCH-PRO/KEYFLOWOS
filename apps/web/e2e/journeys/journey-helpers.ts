import {
  test as base,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { createHmac } from "node:crypto";
import { e2eBaseURL, liveSessionState } from "../helpers/workspace";
import {
  JOURNEY_PREFIX,
  KEY_UI,
  LOAD_BUDGET_MS,
  SELF_CHECK_SPEC,
  THROTTLE_3G,
  anonymousStorageState,
  describeFinding,
  describeTiming,
  devBuildSigns,
  journeyWatchFindings,
  nextBuildIdOf,
  parseVariant,
  sortFindings,
  type ApiCall,
  type FindingKind,
  type JourneyFinding,
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
 * runs the variant E2E_VARIANT names. Throughout every journey, in every
 * browser context it makes (the owner's page, and each customer, second tenant
 * or member made through anonymousContext, signedInContext and memberOf): no
 * request leaves localhost, no 5xx (the R0-07 503 provider_not_configured of an
 * optional service is recorded, not a failure, as in release0-live.spec.ts),
 * and the browser names no business other than the one that context is on
 * (release0-live.spec.ts callsNamingAnotherBusiness, "no allowance"; a leg that
 * names another on purpose declares it with allowBusinessNamed). A bare
 * browser.newContext() is refused inside a journey: Playwright would start it
 * signed in as the owner, and the watch would not see it.
 */

export { expect } from "@playwright/test";
export { callsNamingAnotherBusiness, describeFinding } from "./harness-settings";
export type { JourneyFinding } from "./harness-settings";

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

// ── the other people in a journey ─────────────────────────────────────────

/** Anyone with a session: the owner, another tenant, a member of the owner's business. */
export interface Person {
  label: string;
  token: string;
  /** The business their session is on (kf_business_id). */
  businessId: string;
}

/** The member roles an owner can invite (the API refuses OWNER). */
export type MemberRole = "ADMIN" | "STAFF";

export interface MemberOptions {
  /** STAFF by default. */
  role?: MemberRole;
  /**
   * An explicit module scope map (D-71, D-146), e.g. { team: "read" }; a module
   * it leaves out is `none`. Omitted: the role's defaults (STAFF: read on most
   * modules, none on settings, team and ai).
   */
  scopes?: Record<string, string>;
  maxApprovalTier?: number;
}

/** A member of the owner's business: their session is on the owner's business, with a role and module scopes. */
export interface Member extends Person {
  sub: string;
  email: string;
  role: MemberRole;
  /** The scope map the membership stores (the role's defaults, written out, when none was asked for). */
  scopes: Record<string, string> | null;
  membershipId: string;
  /** The business their own first sign-in made (POST /identity/bootstrap always makes one); not the one they work on. */
  ownBusinessId: string;
}

/**
 * A member of `owner`'s business, for the authority legs (D-71/D-146 module
 * scopes, the D-11 owner-only rules, journey J's staff limits, K's member
 * gate). A new user signs in (POST /identity/bootstrap, which gives every new
 * user a business of their own, left aside here), then the owner invites that
 * address with the role and scopes asked for (POST
 * /identity/businesses/:id/team, the Team screen's route), which makes the
 * membership at once for an address that already has an account. Read back:
 * the member's token opens the owner's business (GET
 * /identity/businesses/:id). Sign them in with signedInContext(browser, member):
 * their session is on the owner's business, so the API refuses them by module
 * scope ("Insufficient permissions"), never by tenancy ("No access to this
 * business"). A second freshTenant() is not a member: it is another tenant.
 */
export async function memberOf(request: APIRequestContext, owner: Tenant, label: string, options: MemberOptions = {}): Promise<Member> {
  const role = options.role ?? "STAFF";
  const person = await freshTenant(request, label, { onboard: false });
  const invite = await request.post(`${API_URL}/identity/businesses/${owner.businessId}/team`, {
    headers: auth(owner.token),
    data: {
      email: person.email,
      role,
      ...(options.scopes ? { scopes: options.scopes } : {}),
      ...(options.maxApprovalTier === undefined ? {} : { maxApprovalTier: options.maxApprovalTier }),
    },
  });
  const text = await invite.text();
  expect(invite.status(), `${owner.label} invites ${label} as ${role}: ${text}`).toBe(201);
  const membership = JSON.parse(text) as { id: string; userId: string; role: string; permissionScopes?: Record<string, string> | null };
  expect({ userId: membership.userId, role: membership.role }, `the membership ${label} was given`).toEqual({ userId: person.sub, role });
  const read = await request.get(`${API_URL}/identity/businesses/${owner.businessId}`, { headers: auth(person.token) });
  expect(read.status(), `${label} opens ${owner.label}'s business as a member: ${await read.text()}`).toBe(200);
  return {
    label,
    sub: person.sub,
    email: person.email,
    token: person.token,
    businessId: owner.businessId,
    role,
    scopes: membership.permissionScopes ?? null,
    membershipId: membership.id,
    ownBusinessId: person.businessId,
  };
}

/** Options for a context the harness makes: any Playwright context option but the session, plus how the watch names it. */
export type JourneyContextOptions = Omit<BrowserContextOptions, "storageState"> & {
  /** How the run's findings name this context (default "customer <n>", or the person's label). */
  who?: string;
};

/**
 * A customer's browser: a context with no session at all (no cookie, nothing
 * stored), watched like the owner's page. Use it for every leg a customer
 * walks: quote acceptance (D), /pay/link (E), booking (F), the store (G). Its
 * browser may name the journey's business (the owner's: public pages read
 * /bookings/public/businesses/<id>/..., for instance); a page that names it
 * another way (a slug in an id's place) is declared with allowBusinessNamed.
 * Never browser.newContext(): inside a journey Playwright starts that one
 * signed in as the owner, and the watch does not see it.
 */
export async function anonymousContext(browser: Browser, options: JourneyContextOptions = {}): Promise<BrowserContext> {
  const journey = journeyInProgress("anonymousContext");
  const { who, ...contextOptions } = options;
  const context = await newWatchedContext(browser, { ...contextOptions, storageState: anonymousStorageState() });
  return enlist(journey, context, who ?? `customer ${++journey.customers}`, [journey.owner.businessId], true);
}

/**
 * A browser signed in as `person` (another tenant from freshTenant, a member
 * from memberOf), on `person.businessId` (workspace.ts liveSessionState),
 * watched like the owner's page: its browser may name only that business.
 * The third argument may still be a base URL string (the harness's first
 * version); by default the project's base URL is used.
 */
export async function signedInContext(
  browser: Browser,
  person: Person,
  options: JourneyContextOptions | string = {},
): Promise<BrowserContext> {
  const journey = journeyInProgress("signedInContext");
  const opts: JourneyContextOptions = typeof options === "string" ? { baseURL: options } : options;
  const { who, ...contextOptions } = opts;
  const baseURL = contextOptions.baseURL ?? journey.baseURL;
  const context = await newWatchedContext(browser, {
    ...contextOptions,
    storageState: liveSessionState(person.token, person.businessId, baseURL),
  });
  return enlist(journey, context, who ?? person.label, [person.businessId], true);
}

/**
 * Declares that `context` (the test's own `context`, or one the harness made)
 * names `businessId` on purpose, for a leg that probes another tenant's
 * business (release0-live.spec.ts forces tenant A's id into tenant B's
 * session). Recorded as a "tenancy-allowance" annotation with the reason; any
 * other business that context names still fails the journey.
 */
export function allowBusinessNamed(context: BrowserContext, businessId: string, why: string): void {
  const journey = journeyInProgress("allowBusinessNamed");
  if (!why.trim()) throw new Error("allowBusinessNamed needs the reason this leg names another business");
  const watched = journey.contexts.find((c) => c.context === context);
  if (!watched) throw new Error("allowBusinessNamed: this context is not one the journey watches (the test's own, or one from anonymousContext / signedInContext)");
  watched.businessIds.add(businessId);
  journey.testInfo.annotations.push({ type: "tenancy-allowance", description: `${watched.who} may name business ${businessId}: ${why.trim()}` });
}

/**
 * Every finding the watch has raised so far in this journey, across every
 * context, as journeyWatch's teardown will judge them (each fails the journey).
 * For the harness self-check; a journey has no need to read it.
 */
export async function watchFindingsSoFar(): Promise<JourneyFinding[]> {
  const journey = journeyInProgress("watchFindingsSoFar");
  await Promise.all(journey.contexts.map((c) => settled(c.watch)));
  return journeyWatchFindings(journey.contexts.map(asWatchedCalls));
}

// ── what the browser did ──────────────────────────────────────────────────

export interface Watch {
  offHost: string[];
  serverErrors: string[];
  optionalUnavailable: string[];
  apiCalls: ApiCall[];
}

/** The response handlers of each watch still reading a body. */
const inFlight = new WeakMap<Watch, Set<Promise<void>>>();

/** Resolves once every response the watch has seen so far is recorded. */
async function settled(w: Watch): Promise<void> {
  await Promise.allSettled([...(inFlight.get(w) ?? [])]);
}

/** Records, per context, requests that left localhost, 5xx answers and API calls (release0-live.spec.ts watch). */
export function watch(context: BrowserContext): Watch {
  const w: Watch = { offHost: [], serverErrors: [], optionalUnavailable: [], apiCalls: [] };
  const pending = new Set<Promise<void>>();
  inFlight.set(w, pending);
  context.on("request", (req) => {
    if (!isLocal(req.url())) w.offHost.push(`${req.method()} ${req.url()}`);
  });
  context.on("page", (page) => {
    page.on("websocket", (ws) => {
      if (!isLocal(ws.url())) w.offHost.push(`WS ${ws.url()}`);
    });
  });
  context.on("response", (res) => {
    const url = res.url();
    if (url.startsWith(`${API_URL}/`)) w.apiCalls.push({ method: res.request().method(), url, status: res.status() });
    if (res.status() < 500) return;
    const line = `${res.status()} ${res.request().method()} ${url}`;
    const recorded = (async () => {
      let code: unknown;
      try {
        code = ((await res.json()) as { code?: unknown } | null)?.code;
      } catch {
        code = undefined;
      }
      if (res.status() === 503 && code === "provider_not_configured") w.optionalUnavailable.push(line);
      else w.serverErrors.push(line);
    })();
    pending.add(recorded);
    void recorded.finally(() => pending.delete(recorded));
  });
  return w;
}

// ── the journey in progress: every context it watches ─────────────────────

interface WatchedContext {
  who: string;
  context: BrowserContext;
  watch: Watch;
  /** The businesses this context's browser may name: its own, plus any allowBusinessNamed declares. */
  businessIds: Set<string>;
  /** Made by the harness (closed at the end of the test); the owner's is Playwright's. */
  harnessMade: boolean;
}

interface JourneyInProgress {
  owner: Tenant;
  baseURL: string;
  testInfo: TestInfo;
  contexts: WatchedContext[];
  customers: number;
}

/** The journey this worker is running (a worker runs one test at a time); set by journeyWatch. */
let current: JourneyInProgress | null = null;

function journeyInProgress(helper: string): JourneyInProgress {
  if (!current) {
    throw new Error(`${helper}() works inside a journey test only (\`test\` from journey-helpers.ts, live): the harness watches the contexts it makes for the test`);
  }
  return current;
}

function enlist(journey: JourneyInProgress, context: BrowserContext, who: string, businessIds: string[], harnessMade: boolean): BrowserContext {
  if (journey.contexts.some((c) => c.who === who)) throw new Error(`two contexts in one journey are both called "${who}"; give one another \`who\``);
  journey.contexts.push({ who, context, watch: watch(context), businessIds: new Set(businessIds), harnessMade });
  return context;
}

const asWatchedCalls = (c: WatchedContext) => ({
  who: c.who,
  businessIds: [...c.businessIds],
  offHost: c.watch.offHost,
  serverErrors: c.watch.serverErrors,
  apiCalls: c.watch.apiCalls,
});

/**
 * The refusal a bare browser.newContext() / browser.newPage() meets inside a
 * journey (review GH-COR-2, SEC-GH-1): Playwright fills every option a test
 * omits from the test's own, so it would start signed in as the owner; and the
 * watch would not see it.
 */
const BARE_CONTEXT_REFUSED =
  "a journey makes other people's browsers with anonymousContext() (a customer), signedInContext() (another tenant, a member) or memberOf() then signedInContext() (journey-helpers.ts): " +
  "a bare browser.newContext() or browser.newPage() would start signed in as the owner (the journey's storageState) and is not watched";

/** browser.newContext as Playwright defines it, past the journey's refusal. */
function newWatchedContext(browser: Browser, options: BrowserContextOptions): Promise<BrowserContext> {
  const proto = Object.getPrototypeOf(browser) as Browser;
  return proto.newContext.call(browser, options);
}

const FINDING_MESSAGE: Record<FindingKind, string> = {
  "left localhost": "requests that left localhost (every context of the journey)",
  "5xx": "5xx responses (every context of the journey)",
  "named another business": "API calls naming a business other than the context's own (release0-live.spec.ts: no allowance)",
};

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
  /**
   * The watch on the owner's page (its context), and, through the helpers, on
   * every context the journey makes; the test fails on any request off
   * localhost, any 5xx, and any API call naming a business the context is not on.
   */
  journeyWatch: Watch;
  /**
   * The findings a harness negative control provokes on purpose (`provokes`:
   * patterns over describeFinding lines). Only
   * e2e/journeys/harness-self-check.spec.ts may set it; each must then be
   * raised, and nothing else may be. (An object, not a bare array: test.use
   * reads an array whose second item is an object as [value, options].)
   */
  watchSelfCheck: WatchSelfCheck;
}

export interface WatchSelfCheck {
  provokes: RegExp[];
}

interface JourneyWorkerFixtures {
  stack: Stack;
}

const NOT_LIVE = "requires a running API, web server and database (E2E_LIVE=1); see e2e/journeys/README.md";

/**
 * `test` for journey specs. Without E2E_LIVE every journey is skipped with the
 * reason (as release0-live.spec.ts is): it needs a running API, web and
 * database. With it, `owner` is a fresh tenant and `page` (and `context`)
 * start signed in to it. Everyone else gets a browser from the harness,
 * watched like the owner's: another tenant from freshTenant() then
 * signedInContext(browser, tenant); a customer from anonymousContext(browser);
 * a member of the owner's business from memberOf(request, owner, label,
 * { role, scopes }) then signedInContext(browser, member). A bare
 * browser.newContext() is refused: it would start signed in as the owner.
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
  watchSelfCheck: [{ provokes: [] }, { option: true }],
  journeyWatch: [
    async ({ context, owner, browser, baseURL, watchSelfCheck }, use, testInfo) => {
      testInfo.skip(!LIVE, NOT_LIVE);
      const provoked = watchSelfCheck.provokes;
      if (provoked.length && !SELF_CHECK_SPEC.test(testInfo.file)) {
        throw new Error(`watchSelfCheck declares findings a journey may raise; only e2e/journeys/harness-self-check.spec.ts may set it (set in ${testInfo.file})`);
      }
      const journey: JourneyInProgress = {
        owner,
        baseURL: baseURL ?? e2eBaseURL(),
        testInfo,
        contexts: [],
        customers: 0,
      };
      enlist(journey, context, "owner", [owner.businessId], false);
      // A bare browser.newContext() (and browser.newPage(), which calls it) is
      // refused for the test's duration; the helpers go past it.
      const refuse = async () => {
        throw new Error(BARE_CONTEXT_REFUSED);
      };
      Object.defineProperty(browser, "newContext", { value: refuse, configurable: true, writable: true });
      current = journey;
      try {
        await use(journey.contexts[0].watch);
      } finally {
        current = null;
        delete (browser as { newContext?: unknown }).newContext;
      }

      await Promise.all(journey.contexts.map((c) => settled(c.watch)));
      for (const c of journey.contexts) if (c.harnessMade) await c.context.close().catch(() => {});
      const optional = journey.contexts.flatMap((c) => c.watch.optionalUnavailable.map((line) => `${c.who}: ${line}`));
      if (optional.length) {
        testInfo.annotations.push({
          type: "optional-services",
          description: `${optional.length} R0-07 503 provider_not_configured answer(s), by contract`,
        });
      }
      const { unexpected, missing } = sortFindings(journeyWatchFindings(journey.contexts.map(asWatchedCalls)), provoked);
      for (const kind of Object.keys(FINDING_MESSAGE) as FindingKind[]) {
        expect.soft(unexpected.filter((f) => f.kind === kind).map(describeFinding), FINDING_MESSAGE[kind]).toEqual([]);
      }
      if (provoked.length) expect.soft(missing, "findings the self-check provoked that the watch did not raise").toEqual([]);
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
