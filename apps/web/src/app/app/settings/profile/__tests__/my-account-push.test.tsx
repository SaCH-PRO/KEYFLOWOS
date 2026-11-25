/**
 * FU-PUSH-OPTIN-MY-ACCOUNT (owner ruling D-282): every member turns on push for their own device from My account.
 *
 * Since D-276 (FU-ME-NOTIFICATIONS-SCOPE) Settings > Notifications, whose Push tab was the only place a member could
 * turn on push for their own device, is reachable only by members with settings read. The push routes are every
 * member's own (push-notification.controller.ts: BusinessGuard only; subscribeOwn, unsubscribeOwn). So the opt-in
 * moves to My account (/app/settings/profile), for every member; the business's customer emails stay settings-only.
 *
 * The hook also had to reach the server: it fetched `/api/businesses/:id/push/...` relative to the web origin with no
 * Authorization header. The web origin has no such route or rewrite (next.config.ts rewrites only /__api and
 * /site/presence/directory; Caddy sends the web domain to web:5000), so the config read failed, the VAPID key stayed
 * null and "Subscribe" returned without doing anything. Now it sends through lib/api (API_BASE, the member's token).
 *
 *   PSH-01  RED-BEFORE  a member whose settings access is none sees "Push notifications on this device" on My account
 *                       (inside the real settings layout), with Turn on; the strip has no Notifications tab (control)
 *   PSH-02  RED-BEFORE  Turn on asks for permission, subscribes with the server's VAPID key, saves the device at
 *                       API_BASE/api/businesses/:id/push/subscribe with the member's token, and says it is on
 *   PSH-03  RED-BEFORE  Turn off removes the device on the server first, then in the browser, and says it is off
 *   PSH-04  RED-BEFORE  a browser without push says so, and offers no button
 *   PSH-05  RED-BEFORE  notifications blocked in the browser says so, offers no button, and asks no server
 *   PSH-06  RED-BEFORE  a server with no VAPID key says push is not set up, and offers no button
 *   PSH-07  RED-BEFORE  a refused save says so, takes the browser subscription back, and stays off
 *   PSH-08  RED-BEFORE  a config read that fails says so (an alert, not a silent empty state) and offers Retry
 *   PSH-09  RED-BEFORE  a refused turn-off says so and stays on: the browser subscription is kept
 *   PSH-10  RED-BEFORE  permission dismissed (still "default") leaves push off, says why, and subscribes nothing
 *   PSH-11  control     My account reads none of the business's customer-email settings or log
 *
 * Only `fetch` and the browser's push objects (navigator.serviceWorker, PushManager, Notification) are stubbed; no
 * push service is contacted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { API_BASE } from "@/lib/api";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/app/settings/profile",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ getOriginContext: () => null, setCurrentMeta: () => {} }) }));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: async () => ({ objectPath: "/objects/uploads/me.png" }), isUploading: false }) }));

const BIZ = "biz_push";
const ME = { id: "usr_staff", email: "shanice.staff@example.com", name: "Shanice", firstName: "Shanice", lastName: "Ali", phone: null, avatarUrl: null };
/** A VAPID public key's shape: 65 bytes, base64url without padding. */
const KEY_BYTES = Uint8Array.from({ length: 65 }, (_, i) => (i * 7 + 4) % 256);
const VAPID_PUBLIC = Buffer.from(KEY_BYTES).toString("base64url");
const ENDPOINT = "https://push.example.invalid/send/device-1";
const ALL = ["crm", "revenue", "bookings", "storefront", "settings", "analytics", "operations", "expenses", "team", "projects", "content", "automations"];
const FRONT_DESK = Object.fromEntries(ALL.map((m) => [m, m === "bookings" || m === "crm" ? "read" : "none"]));

interface Sent { method: string; url: string; path: string; auth: string | null; body: unknown }
interface Serve {
  config?: { status: number; body: unknown };
  subscribe?: { status: number; body: unknown };
  unsubscribe?: { status: number; body: unknown };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, statusText: status === 200 ? "OK" : "Error", headers: { "content-type": "application/json" } });
}

function serve(opts: Serve = {}): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://web.origin.invalid");
    const method = (init?.method ?? "GET").toUpperCase();
    const auth = new Headers(init?.headers).get("authorization");
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    sent.push({ method, url, path: pathname, auth, body });
    if (pathname.endsWith("/identity/me")) return json(200, ME);
    if (pathname.endsWith(`/identity/businesses/${BIZ}/my-access`)) return json(200, { role: "STAFF", modules: FRONT_DESK });
    if (pathname === `/api/businesses/${BIZ}/push/config`) {
      const c = opts.config ?? { status: 200, body: { publicKey: VAPID_PUBLIC, enabled: true } };
      return json(c.status, c.body);
    }
    if (pathname === `/api/businesses/${BIZ}/push/subscribe` && method === "POST") {
      const s = opts.subscribe ?? { status: 201, body: { id: "psub_1" } };
      return json(s.status, s.body);
    }
    if (pathname === `/api/businesses/${BIZ}/push/unsubscribe` && method === "POST") {
      const s = opts.unsubscribe ?? { status: 201, body: { count: 1 } };
      return json(s.status, s.body);
    }
    return json(404, { message: "Not Found" });
  }));
  return sent;
}

interface FakeSub { endpoint: string; toJSON: () => unknown; unsubscribe: ReturnType<typeof vi.fn> }
interface PushEnv {
  supported?: boolean;
  permission?: NotificationPermission;
  /** What the permission prompt answers. */
  answer?: NotificationPermission;
  existing?: boolean;
}

/** The browser's push objects, faked: a service worker registration whose PushManager hands out one subscription. */
function installPush(env: PushEnv = {}) {
  const state: { sub: FakeSub | null } = { sub: null };
  const makeSub = (): FakeSub => {
    const sub: FakeSub = {
      endpoint: ENDPOINT,
      toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: "p256dh-key", auth: "auth-secret" } }),
      unsubscribe: vi.fn(async () => {
        state.sub = null;
        return true;
      }),
    };
    return sub;
  };
  if (env.existing) state.sub = makeSub();
  const pushManager = {
    getSubscription: vi.fn(async () => state.sub),
    subscribe: vi.fn(async (_opts: PushSubscriptionOptionsInit) => {
      state.sub = makeSub();
      return state.sub;
    }),
  };
  const registration = { pushManager, scope: "/" };
  const serviceWorker = {
    getRegistration: vi.fn(async () => registration),
    register: vi.fn(async () => registration),
    ready: Promise.resolve(registration),
  };
  const notification = {
    permission: env.permission ?? "default",
    requestPermission: vi.fn(async () => {
      notification.permission = env.answer ?? "granted";
      return notification.permission;
    }),
  };
  if (env.supported !== false) {
    Object.defineProperty(navigator, "serviceWorker", { value: serviceWorker, configurable: true });
    (window as unknown as Record<string, unknown>).PushManager = function PushManager() {};
    vi.stubGlobal("Notification", notification);
  }
  return { state, pushManager, serviceWorker, notification };
}

function removePush() {
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  delete (window as unknown as Record<string, unknown>).PushManager;
}

async function renderMyAccount() {
  const { default: Page } = await import("@/app/app/settings/profile/page");
  return render(<Page />);
}

async function renderMyAccountInLayout() {
  const { default: SettingsLayout } = await import("@/app/app/settings/layout");
  const { default: Page } = await import("@/app/app/settings/profile/page");
  return render(
    <SettingsLayout>
      <Page />
    </SettingsLayout>,
  );
}

/** The push section of My account. */
async function pushSection() {
  const heading = await screen.findByRole("heading", { name: /push notifications on this device/i }, { timeout: 4_000 });
  const section = heading.closest("section");
  if (!section) throw new Error("the push heading is not inside a <section>");
  return within(section as HTMLElement);
}

const pushCalls = (sent: Sent[]) => sent.filter((r) => /\/push\//.test(r.path));

beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("activeBusinessId", BIZ);
  window.localStorage.setItem("kf_token", "member-token");
});
afterEach(() => {
  cleanup();
  removePush();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("D-282: a member turns push on and off for their own device from My account", () => {
  it("PSH-01 RED-BEFORE: a settings-none member sees the push control on My account; the strip has no Notifications tab", async () => {
    serve();
    installPush();
    await renderMyAccountInLayout();
    const push = await pushSection();
    expect(await push.findByRole("button", { name: /turn on/i })).toBeTruthy();
    expect(push.getByText(/off for this device/i)).toBeTruthy();
    // D-276 stays: the business's customer-email settings are not offered to this member.
    await waitFor(() => expect(screen.queryAllByRole("tab").length).toBeGreaterThan(0));
    expect(screen.queryAllByRole("tab").map((t) => t.getAttribute("href"))).not.toContain("/app/settings/notifications");
  });

  it("PSH-02 RED-BEFORE: Turn on asks permission, subscribes with the server's key, and saves the device with the member's token", async () => {
    const sent = serve();
    const env = installPush();
    await renderMyAccount();
    const push = await pushSection();
    fireEvent.click(await push.findByRole("button", { name: /turn on/i }));
    expect(await push.findByText(/on for this device/i)).toBeTruthy();
    expect(push.getByRole("button", { name: /turn off/i })).toBeTruthy();

    expect(env.notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(env.pushManager.subscribe).toHaveBeenCalledTimes(1);
    const opts = env.pushManager.subscribe.mock.calls[0][0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
    expect(opts.userVisibleOnly).toBe(true);
    expect(Array.from(opts.applicationServerKey)).toEqual(Array.from(KEY_BYTES));

    const config = sent.find((r) => r.path.endsWith("/push/config"))!;
    expect(config.url).toBe(`${API_BASE}/api/businesses/${BIZ}/push/config`);
    expect(config.auth).toBe("Bearer member-token");
    const saves = sent.filter((r) => r.path.endsWith("/push/subscribe"));
    expect(saves).toHaveLength(1);
    expect(saves[0].method).toBe("POST");
    expect(saves[0].url).toBe(`${API_BASE}/api/businesses/${BIZ}/push/subscribe`);
    expect(saves[0].auth).toBe("Bearer member-token");
    expect((saves[0].body as { subscription: unknown }).subscription).toEqual({
      endpoint: ENDPOINT,
      expirationTime: null,
      keys: { p256dh: "p256dh-key", auth: "auth-secret" },
    });
    expect(push.queryByRole("alert")).toBeNull();
  });

  it("PSH-03 RED-BEFORE: Turn off removes the device on the server, then in the browser", async () => {
    const sent = serve();
    const env = installPush({ permission: "granted", existing: true });
    await renderMyAccount();
    const push = await pushSection();
    expect(await push.findByText(/on for this device/i)).toBeTruthy();
    const sub = env.state.sub!;
    fireEvent.click(push.getByRole("button", { name: /turn off/i }));
    expect(await push.findByText(/off for this device/i)).toBeTruthy();
    const removes = sent.filter((r) => r.path.endsWith("/push/unsubscribe"));
    expect(removes).toHaveLength(1);
    expect(removes[0].url).toBe(`${API_BASE}/api/businesses/${BIZ}/push/unsubscribe`);
    expect(removes[0].auth).toBe("Bearer member-token");
    expect(removes[0].body).toEqual({ endpoint: ENDPOINT });
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(push.getByRole("button", { name: /turn on/i })).toBeTruthy();
  });

  it("PSH-04 RED-BEFORE: a browser without push says so and offers no button", async () => {
    const sent = serve();
    installPush({ supported: false });
    await renderMyAccount();
    const push = await pushSection();
    expect(await push.findByText(/this browser can.t receive push notifications/i)).toBeTruthy();
    expect(push.queryByRole("button")).toBeNull();
    expect(pushCalls(sent)).toHaveLength(0);
  });

  it("PSH-05 RED-BEFORE: notifications blocked in the browser says how to allow them, with no button", async () => {
    const sent = serve();
    installPush({ permission: "denied" });
    await renderMyAccount();
    const push = await pushSection();
    expect(await push.findByText(/blocked/i)).toBeTruthy();
    expect(push.getByText(/site settings/i)).toBeTruthy();
    expect(push.queryByRole("button")).toBeNull();
    expect(pushCalls(sent)).toHaveLength(0);
  });

  it("PSH-06 RED-BEFORE: a server with no VAPID key says push is not set up, with no button", async () => {
    serve({ config: { status: 200, body: { publicKey: null, enabled: false } } });
    const env = installPush();
    await renderMyAccount();
    const push = await pushSection();
    expect(await push.findByText(/not set up on this server/i)).toBeTruthy();
    expect(push.queryByRole("button")).toBeNull();
    expect(env.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("PSH-07 RED-BEFORE: a refused save says so, takes the browser subscription back, and stays off", async () => {
    const sent = serve({ subscribe: { status: 403, body: { statusCode: 403, message: "This device is subscribed by another member" } } });
    const env = installPush();
    await renderMyAccount();
    const push = await pushSection();
    fireEvent.click(await push.findByRole("button", { name: /turn on/i }));
    const alert = await push.findByRole("alert");
    expect(alert.textContent).toMatch(/could not be turned on/i);
    expect(alert.textContent).toMatch(/another member/i);
    expect(env.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(env.state.sub).toBeNull();
    expect(push.getByText(/off for this device/i)).toBeTruthy();
    expect(push.getByRole("button", { name: /turn on/i })).toBeTruthy();
    expect(sent.filter((r) => r.path.endsWith("/push/subscribe"))).toHaveLength(1);
  });

  it("PSH-08 RED-BEFORE: a config read that fails says so and offers Retry, which reads again", async () => {
    const sent = serve({ config: { status: 403, body: { statusCode: 403, message: "Not a member of this business" } } });
    installPush();
    await renderMyAccount();
    const push = await pushSection();
    const alert = await push.findByRole("alert");
    expect(alert.textContent).toMatch(/could not be loaded/i);
    expect(push.queryByRole("button", { name: /turn on/i })).toBeNull();
    const before = sent.filter((r) => r.path.endsWith("/push/config")).length;
    fireEvent.click(push.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(sent.filter((r) => r.path.endsWith("/push/config")).length).toBe(before + 1));
  });

  it("PSH-09 RED-BEFORE: a refused turn-off says so and stays on; the browser subscription is kept", async () => {
    serve({ unsubscribe: { status: 403, body: { statusCode: 403, message: "Forbidden" } } });
    const env = installPush({ permission: "granted", existing: true });
    await renderMyAccount();
    const push = await pushSection();
    const sub = env.state.sub!;
    fireEvent.click(await push.findByRole("button", { name: /turn off/i }));
    const alert = await push.findByRole("alert");
    expect(alert.textContent).toMatch(/could not be turned off/i);
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(env.state.sub).not.toBeNull();
    expect(push.getByText(/on for this device/i)).toBeTruthy();
    expect(push.getByRole("button", { name: /turn off/i })).toBeTruthy();
  });

  it("PSH-10 RED-BEFORE: a dismissed permission prompt leaves push off, says why, and subscribes nothing", async () => {
    const sent = serve();
    const env = installPush({ answer: "default" });
    await renderMyAccount();
    const push = await pushSection();
    fireEvent.click(await push.findByRole("button", { name: /turn on/i }));
    const alert = await push.findByRole("alert");
    expect(alert.textContent).toMatch(/not allowed/i);
    expect(env.pushManager.subscribe).not.toHaveBeenCalled();
    expect(sent.filter((r) => r.path.endsWith("/push/subscribe"))).toHaveLength(0);
    expect(push.getByRole("button", { name: /turn on/i })).toBeTruthy();
  });

  it("PSH-11 control: My account reads none of the business's customer-email settings or log", async () => {
    const sent = serve();
    installPush();
    const { container } = await renderMyAccount();
    await screen.findByRole("heading", { name: /my account/i });
    await waitFor(() => expect(container.textContent).toContain(ME.email));
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.filter((r) => /customer-(preferences|log)/.test(r.path))).toEqual([]);
    // The customer-email toggles ("Toggle Booking Confirmation" ... "Toggle Payment Receipt") are not here. (The phone
    // field's own hint, "Used for booking confirmations and account recovery", is the member's, not the business's.)
    expect(screen.queryAllByRole("switch", { name: /^toggle /i })).toEqual([]);
    expect(container.textContent ?? "").not.toMatch(/payment receipt|appointment reminder|customer notifications/i);
  });
});
