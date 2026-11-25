// @vitest-environment-options {"url": "https://app.keyflowos.test/app/settings/profile"}
/**
 * FU-PUSH-OPTIN-MY-ACCOUNT (D-282), repair round 2 (confirmations of 5ba8b21e2), N1.
 *
 * unsubscribe answering { count: 0 } (unsubscribeOwn's deleteMany) means none of this member's rows hold the device:
 * either another member's row does, or no row does at all (a re-save that failed, a refused save whose browser
 * rollback failed, the server's expiry cleanup). Round 1 read every count 0 as "another member's": on the member's own
 * phone that was a false message and a dead end. Now the hook asks who holds it with POST /push/subscribe and the same
 * subscription: subscribeOwn refuses with 403 "This device is subscribed by another member" when another member's row
 * holds it, and saves it as this member's otherwise; then the turn-off the member asked for is completed.
 *
 *   R2-01  RED-BEFORE  count 0, then subscribe 403: another member's; the browser subscription is left alone
 *   R2-02  RED-BEFORE  count 0, then subscribe OK: this member's stale device; the turn-off completes (a second
 *                      unsubscribe, one browser unsubscribe) and ends off
 *   R2-03  RED-BEFORE  count 0, then subscribe 500: who holds it is unknown; an alert with Retry, browser left alone
 *   R2-04  RED-BEFORE  count 0, subscribe OK, then the second unsubscribe fails: it stays on (the device is saved as
 *                      this member's again), with an alert; never "off"
 *   R2-05  pin         round 1's re-save branch: the browser unsubscribe throws and the re-save fails: an alert with
 *                      Retry, and neither "on" nor "off" is claimed
 *
 * Only `fetch` and the browser's push objects are stubbed; no push service is contacted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/settings/profile",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: async () => ({ objectPath: "/objects/uploads/me.png" }), isUploading: false }) }));

const BIZ = "biz_push_r2";
const VAPID_PUBLIC = Buffer.from(Uint8Array.from({ length: 65 }, (_, i) => (i * 5 + 2) % 256)).toString("base64url");
const ENDPOINT = "https://push.example.invalid/send/own-phone";

type Answer = { status: number; body: unknown };
interface Sent { method: string; path: string; body: unknown }

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Answers subscribe and unsubscribe in turn from these queues (the last answer repeats). */
function serve(queues: { subscribe?: Answer[]; unsubscribe?: Answer[] }): Sent[] {
  const sent: Sent[] = [];
  const next = (q: Answer[] | undefined, fallback: Answer) => (q && q.length > 1 ? q.shift()! : q?.[0] ?? fallback);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://web.origin.invalid");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    sent.push({ method, path: pathname, body });
    if (pathname.endsWith("/identity/me")) return json(200, { id: "usr_own", email: "own@example.com", name: "Own" });
    if (pathname === `/api/businesses/${BIZ}/push/config`) return json(200, { publicKey: VAPID_PUBLIC, enabled: true });
    if (pathname === `/api/businesses/${BIZ}/push/subscribe` && method === "POST") {
      const a = next(queues.subscribe, { status: 201, body: { id: "psub_r2" } });
      return json(a.status, a.body);
    }
    if (pathname === `/api/businesses/${BIZ}/push/unsubscribe` && method === "POST") {
      const a = next(queues.unsubscribe, { status: 201, body: { count: 1 } });
      return json(a.status, a.body);
    }
    return json(404, { message: "Not Found" });
  }));
  return sent;
}

function installPush(env: { unsubscribeThrows?: boolean } = {}) {
  const state: { sub: { endpoint: string; toJSON: () => unknown; unsubscribe: ReturnType<typeof vi.fn> } | null } = { sub: null };
  const sub = {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: "p256dh-key", auth: "auth-secret" } }),
    unsubscribe: vi.fn(async () => {
      if (env.unsubscribeThrows) throw new Error("the browser kept it");
      state.sub = null;
      return true;
    }),
  };
  state.sub = sub;
  const registration = { pushManager: { getSubscription: vi.fn(async () => state.sub), subscribe: vi.fn(async () => sub) }, scope: "/" };
  Object.defineProperty(navigator, "serviceWorker", {
    value: { getRegistration: vi.fn(async () => registration), register: vi.fn(async () => registration), ready: Promise.resolve(registration) },
    configurable: true,
  });
  (window as unknown as Record<string, unknown>).PushManager = function PushManager() {};
  vi.stubGlobal("Notification", { permission: "granted", requestPermission: vi.fn(async () => "granted") });
  return { state, sub };
}

async function turnOff() {
  const { default: Page } = await import("@/app/app/settings/profile/page");
  render(<Page />);
  const heading = await screen.findByRole("heading", { name: /push notifications on this device/i }, { timeout: 4_000 });
  const push = within(heading.closest("section") as HTMLElement);
  fireEvent.click(await push.findByRole("button", { name: /turn off/i }));
  return push;
}

const pushCalls = (sent: Sent[]) => sent.filter((r) => /\/push\/(subscribe|unsubscribe)$/.test(r.path)).map((r) => r.path.split("/").pop());
const COUNT0: Answer = { status: 201, body: { count: 0 } };
const REFUSED: Answer = { status: 403, body: { statusCode: 403, message: "This device is subscribed by another member", error: "Forbidden" } };
const FAILED: Answer = { status: 500, body: { statusCode: 500, message: "Internal server error" } };

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

describe("D-282 repair round 2 (N1): count 0 is resolved, not assumed", () => {
  it("R2-01 RED-BEFORE: count 0, then subscribe 403: another member's, browser left alone", async () => {
    const sent = serve({ unsubscribe: [COUNT0], subscribe: [REFUSED] });
    const { sub } = installPush();
    const push = await turnOff();
    expect(await push.findByText(/belongs to another member.s sign-in/i)).toBeTruthy();
    expect(pushCalls(sent)).toEqual(["unsubscribe", "subscribe"]);
    expect((sent.find((r) => r.path.endsWith("/push/subscribe"))!.body as { subscription: { endpoint: string } }).subscription.endpoint).toBe(ENDPOINT);
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(push.queryByRole("button", { name: /turn (on|off)/i })).toBeNull();
  });

  it("R2-02 RED-BEFORE: count 0, then subscribe OK: the member's own stale device; the turn-off completes", async () => {
    const sent = serve({ unsubscribe: [COUNT0, { status: 201, body: { count: 1 } }] });
    const { sub, state } = installPush();
    const push = await turnOff();
    expect(await push.findByText(/off for this device/i)).toBeTruthy();
    expect(pushCalls(sent)).toEqual(["unsubscribe", "subscribe", "unsubscribe"]);
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(state.sub).toBeNull();
    expect(push.queryByRole("alert")).toBeNull();
    expect(push.queryByText(/another member/i)).toBeNull();
  });

  it("R2-03 RED-BEFORE: count 0, then subscribe 500: an alert with Retry; the browser is left alone", { timeout: 15_000 }, async () => {
    serve({ unsubscribe: [COUNT0], subscribe: [FAILED] });
    const { sub } = installPush();
    const push = await turnOff();
    const alert = await push.findByRole("alert", {}, { timeout: 10_000 });
    expect(alert.textContent).toMatch(/could not be turned off/i);
    expect(push.getByRole("button", { name: /retry/i })).toBeTruthy();
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(push.queryByText(/another member/i)).toBeNull();
    expect(push.queryByText(/off for this device/i)).toBeNull();
  });

  it("R2-04 RED-BEFORE: count 0, subscribe OK, then the second unsubscribe fails: it stays on, never off", { timeout: 15_000 }, async () => {
    const sent = serve({ unsubscribe: [COUNT0, FAILED] });
    const { sub } = installPush();
    const push = await turnOff();
    const alert = await push.findByRole("alert", {}, { timeout: 10_000 });
    expect(alert.textContent).toMatch(/could not be turned off/i);
    expect(pushCalls(sent).slice(0, 3)).toEqual(["unsubscribe", "subscribe", "unsubscribe"]);
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(push.getByText(/on for this device/i)).toBeTruthy();
    expect(push.queryByText(/off for this device/i)).toBeNull();
    expect(push.getByRole("button", { name: /turn off/i })).toBeTruthy();
  });

  it("R2-05 pin: the browser unsubscribe throws and the re-save fails: an alert with Retry, neither on nor off", { timeout: 15_000 }, async () => {
    serve({ unsubscribe: [{ status: 201, body: { count: 1 } }], subscribe: [FAILED] });
    installPush({ unsubscribeThrows: true });
    const push = await turnOff();
    const alert = await push.findByRole("alert", {}, { timeout: 10_000 });
    expect(alert.textContent).toMatch(/could not be saved again/i);
    expect(push.getByRole("button", { name: /retry/i })).toBeTruthy();
    expect(push.queryByText(/on for this device/i)).toBeNull();
    expect(push.queryByText(/off for this device/i)).toBeNull();
    expect(push.queryByRole("button", { name: /turn (on|off)/i })).toBeNull();
  });
});
