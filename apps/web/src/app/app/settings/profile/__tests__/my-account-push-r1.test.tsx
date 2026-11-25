// @vitest-environment-options {"url": "https://app.keyflowos.test/app/settings/profile"}
/**
 * FU-PUSH-OPTIN-MY-ACCOUNT (D-282), repair round 1 (reviews of b058731f4). The first round is my-account-push.test.tsx
 * (PSH-01..11); the local development origin is my-account-push-localhost.test.tsx (PLH-01..02).
 *
 *   R1-01  RED-BEFORE  COR-M1 shared device: the browser's subscription is another member's (the server's
 *                      unsubscribeOwn deletes none of the caller's rows and answers 201 { count: 0 }). The browser
 *                      subscription is NOT removed (that would end the other member's push); the page says whose it is
 *                      and offers no Turn off. Round 2 (N1): count 0 alone no longer says whose it is; the hook asks
 *                      with POST /push/subscribe, and subscribeOwn's 403 "This device is subscribed by another member"
 *                      does (my-account-push-r2.test.tsx R2-01..04), so this case's server answers that 403 too
 *   R1-02  pin         COR-M2: with no service worker registered yet, Turn on registers /sw.js and waits for it
 *   R1-03  pin         COR-M2: a service worker that never becomes ready is reported after 10 s; nothing is saved
 *   R1-04  pin         COR-M2: the state read does not wait on navigator.serviceWorker.ready (it never resolves when
 *                      no worker is registered): no registration reads as off
 *   R1-05  pin         MIN-3: a public key with enabled false (the server cannot send) is "not set up"
 *   R1-06  pin         COR-M5: permission denied at the prompt shows the blocked state and subscribes nothing
 *   R1-07  RED-BEFORE  COR-M11: a browser unsubscribe that throws after the server removed the device is not reported
 *                      as off: the device is saved back on the server and push stays on, with an alert
 *   R1-08  RED-BEFORE  COR-M4: the copy says who gets alerts today (owners: new bookings, payments received, payment
 *                      claims; P58 owner-alerts.listener.ts) and that other members get none yet
 *
 * Only `fetch` and the browser's push objects are stubbed; no push service is contacted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/settings/profile",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: async () => ({ objectPath: "/objects/uploads/me.png" }), isUploading: false }) }));

const BIZ = "biz_push_r1";
const ME = { id: "usr_staff", email: "staff.r1@example.com", name: "Staff", firstName: "Staff", lastName: "R1", phone: null, avatarUrl: null };
const VAPID_PUBLIC = Buffer.from(Uint8Array.from({ length: 65 }, (_, i) => (i * 7 + 4) % 256)).toString("base64url");
const ENDPOINT = "https://push.example.invalid/send/shared-tablet";

interface Sent { method: string; path: string; body: unknown }
interface Serve {
  config?: { status: number; body: unknown };
  unsubscribe?: { status: number; body: unknown };
  subscribe?: { status: number; body: unknown };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function serve(opts: Serve = {}): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://web.origin.invalid");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    sent.push({ method, path: pathname, body });
    if (pathname.endsWith("/identity/me")) return json(200, ME);
    if (pathname === `/api/businesses/${BIZ}/push/config`) {
      const c = opts.config ?? { status: 200, body: { publicKey: VAPID_PUBLIC, enabled: true } };
      return json(c.status, c.body);
    }
    if (pathname === `/api/businesses/${BIZ}/push/subscribe` && method === "POST") {
      const a = opts.subscribe ?? { status: 201, body: { id: "psub_r1" } };
      return json(a.status, a.body);
    }
    if (pathname === `/api/businesses/${BIZ}/push/unsubscribe` && method === "POST") {
      // What the server answers (push-notification.controller.ts unsubscribe: unsubscribeOwn's prisma deleteMany, 201).
      const u = opts.unsubscribe ?? { status: 201, body: { count: 1 } };
      return json(u.status, u.body);
    }
    return json(404, { message: "Not Found" });
  }));
  return sent;
}

interface PushEnv {
  permission?: NotificationPermission;
  answer?: NotificationPermission;
  existing?: boolean;
  /** A service worker is registered at load (true by default). */
  registered?: boolean;
  /** navigator.serviceWorker.ready never resolves, whatever is registered. */
  neverReady?: boolean;
  /** The browser refuses to remove its subscription. */
  unsubscribeThrows?: boolean;
}

function installPush(env: PushEnv = {}) {
  const state: { sub: { endpoint: string; toJSON: () => unknown; unsubscribe: ReturnType<typeof vi.fn> } | null; registered: boolean } = {
    sub: null,
    registered: env.registered !== false,
  };
  const makeSub = () => {
    const sub = {
      endpoint: ENDPOINT,
      toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: "p256dh-key", auth: "auth-secret" } }),
      unsubscribe: vi.fn(async () => {
        if (env.unsubscribeThrows) throw new Error("the browser kept it");
        state.sub = null;
        return true;
      }),
    };
    return sub;
  };
  if (env.existing) state.sub = makeSub();
  const pushManager = {
    getSubscription: vi.fn(async () => state.sub),
    subscribe: vi.fn(async () => {
      state.sub = makeSub();
      return state.sub;
    }),
  };
  const registration = { pushManager, scope: "/" };
  let activate: (r: typeof registration) => void = () => {};
  // ready resolves once a worker is registered (as in a browser); never, under neverReady.
  const ready = new Promise<typeof registration>((resolve) => {
    activate = resolve;
  });
  if (state.registered && !env.neverReady) activate(registration);
  const serviceWorker = {
    getRegistration: vi.fn(async () => (state.registered ? registration : undefined)),
    register: vi.fn(async (_url: string, _opts?: RegistrationOptions) => {
      state.registered = true;
      if (!env.neverReady) activate(registration);
      return registration;
    }),
    get ready() {
      return ready;
    },
  };
  const notification = {
    permission: env.permission ?? "default",
    requestPermission: vi.fn(async () => {
      notification.permission = env.answer ?? "granted";
      return notification.permission;
    }),
  };
  Object.defineProperty(navigator, "serviceWorker", { value: serviceWorker, configurable: true });
  (window as unknown as Record<string, unknown>).PushManager = function PushManager() {};
  vi.stubGlobal("Notification", notification);
  return { state, pushManager, serviceWorker, notification };
}

async function renderMyAccount() {
  const { default: Page } = await import("@/app/app/settings/profile/page");
  return render(<Page />);
}

async function pushSection() {
  const heading = await screen.findByRole("heading", { name: /push notifications on this device/i }, { timeout: 4_000 });
  return within(heading.closest("section") as HTMLElement);
}

const calls = (sent: Sent[], tail: string) => sent.filter((r) => r.path.endsWith(tail));

beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("kf_token", "member-token");
});
afterEach(() => {
  cleanup();
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  delete (window as unknown as Record<string, unknown>).PushManager;
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("D-282 repair round 1", () => {
  it("R1-01 RED-BEFORE: another member's push on a shared device is not removed by this member's Turn off", async () => {
    const sent = serve({
      unsubscribe: { status: 201, body: { count: 0 } },
      // subscribeOwn (push-notification.service.ts): another member's row holds this endpoint.
      subscribe: { status: 403, body: { statusCode: 403, message: "This device is subscribed by another member", error: "Forbidden" } },
    });
    const env = installPush({ permission: "granted", existing: true });
    await renderMyAccount();
    const push = await pushSection();
    const sub = env.state.sub!;
    fireEvent.click(await push.findByRole("button", { name: /turn off/i }));
    expect(await push.findByText(/belongs to another member.s sign-in/i)).toBeTruthy();
    expect(push.getByText(/their my account/i)).toBeTruthy();
    expect(calls(sent, "/push/unsubscribe")).toHaveLength(1);
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(env.state.sub).not.toBeNull();
    expect(push.queryByRole("button", { name: /turn (on|off)/i })).toBeNull();
    expect(push.queryByText(/off for this device/i)).toBeNull();
  });

  it("R1-02 pin: with no service worker registered, Turn on registers /sw.js and turns on", async () => {
    const sent = serve();
    const env = installPush({ registered: false });
    await renderMyAccount();
    const push = await pushSection();
    fireEvent.click(await push.findByRole("button", { name: /turn on/i }));
    expect(await push.findByText(/on for this device/i)).toBeTruthy();
    expect(env.serviceWorker.register).toHaveBeenCalledTimes(1);
    expect(env.serviceWorker.register.mock.calls[0][0]).toBe("/sw.js");
    expect(calls(sent, "/push/subscribe")).toHaveLength(1);
  });

  it("R1-03 pin: a service worker that never becomes ready is reported after 10 s; nothing is saved", { timeout: 20_000 }, async () => {
    const sent = serve();
    const env = installPush({ registered: false, neverReady: true });
    await renderMyAccount();
    const push = await pushSection();
    fireEvent.click(await push.findByRole("button", { name: /turn on/i }));
    const alert = await push.findByRole("alert", {}, { timeout: 14_000 });
    expect(alert.textContent).toMatch(/did not start/i);
    expect(env.pushManager.subscribe).not.toHaveBeenCalled();
    expect(calls(sent, "/push/subscribe")).toHaveLength(0);
    expect(push.getByText(/off for this device/i)).toBeTruthy();
  });

  it("R1-04 pin: the state read does not wait on serviceWorker.ready; no registration reads as off", async () => {
    serve();
    installPush({ registered: false, neverReady: true });
    await renderMyAccount();
    const push = await pushSection();
    expect(await push.findByText(/off for this device/i, {}, { timeout: 3_000 })).toBeTruthy();
    expect(push.getByRole("button", { name: /turn on/i })).toBeTruthy();
  });

  it("R1-05 pin: a public key with enabled false is not set up", async () => {
    serve({ config: { status: 200, body: { publicKey: VAPID_PUBLIC, enabled: false } } });
    const env = installPush();
    await renderMyAccount();
    const push = await pushSection();
    expect(await push.findByText(/not set up on this server/i)).toBeTruthy();
    expect(push.queryByRole("button")).toBeNull();
    expect(env.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("R1-06 pin: permission denied at the prompt shows the blocked state and subscribes nothing", async () => {
    const sent = serve();
    const env = installPush({ answer: "denied" });
    await renderMyAccount();
    const push = await pushSection();
    fireEvent.click(await push.findByRole("button", { name: /turn on/i }));
    expect(await push.findByText(/blocked/i)).toBeTruthy();
    expect(push.queryByRole("button")).toBeNull();
    expect(env.pushManager.subscribe).not.toHaveBeenCalled();
    expect(calls(sent, "/push/subscribe")).toHaveLength(0);
  });

  it("R1-07 RED-BEFORE: a browser unsubscribe that throws is not reported as off; the device is saved back", async () => {
    const sent = serve();
    const env = installPush({ permission: "granted", existing: true, unsubscribeThrows: true });
    await renderMyAccount();
    const push = await pushSection();
    fireEvent.click(await push.findByRole("button", { name: /turn off/i }));
    const alert = await push.findByRole("alert");
    expect(alert.textContent).toMatch(/could not be turned off/i);
    expect(push.queryByText(/off for this device/i)).toBeNull();
    expect(push.getByText(/on for this device/i)).toBeTruthy();
    expect(push.getByRole("button", { name: /turn off/i })).toBeTruthy();
    // The server removed it first; it is saved back, so server and browser agree again.
    await waitFor(() => expect(calls(sent, "/push/subscribe")).toHaveLength(1));
    expect(sent.findIndex((r) => r.path.endsWith("/push/subscribe"))).toBeGreaterThan(sent.findIndex((r) => r.path.endsWith("/push/unsubscribe")));
    expect((calls(sent, "/push/subscribe")[0].body as { subscription: { endpoint: string } }).subscription.endpoint).toBe(ENDPOINT);
    expect(env.state.sub).not.toBeNull();
  });

  it("R1-08 RED-BEFORE: the copy says owners get booking and payment alerts here, and other members none yet", async () => {
    serve();
    installPush();
    await renderMyAccount();
    const heading = await screen.findByRole("heading", { name: /push notifications on this device/i }, { timeout: 4_000 });
    const text = (heading.closest("section") as HTMLElement).textContent ?? "";
    expect(text).toMatch(/owners/i);
    expect(text).toMatch(/new bookings/i);
    expect(text).toMatch(/payments received/i);
    expect(text).toMatch(/payment claims/i);
    expect(text).toMatch(/other members .*none yet|none yet.*other members/i);
  });
});
