// @vitest-environment-options {"url": "https://app.keyflowos.test/app/settings/profile"}
/**
 * OWNER-ALERTS-WEB, BUG-068: use-push-notifications must ask the API (API_BASE) for the push config, not the web
 * origin, and subscribe with the server's VAPID key.
 *
 * Found already fixed at base 6f67c91e by FU-PUSH-OPTIN-MY-ACCOUNT (P62, 952ba65): the hook sends through lib/api.
 * These cases are the hook-level pin of that fix (the packet's definition of done names a hook test); they pass at
 * the base, so they are controls, not RED. Page-level coverage stays in settings/profile/__tests__/my-account-push*.
 *
 *   UPN-01  control  the config read goes to API_BASE/api/businesses/:id/push/config with the member's token, and
 *                    never to the web origin
 *   UPN-02  control  subscribe passes the server's VAPID public key (decoded) as applicationServerKey, and saves the
 *                    device at API_BASE/api/businesses/:id/push/subscribe
 *   UPN-03  control  a server without a VAPID key is 'unconfigured' and subscribe asks the browser nothing
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { API_BASE } from "@/lib/api";
import { usePushNotifications } from "@/hooks/use-push-notifications";

const BIZ = "biz_upn";
// A test key, not a real VAPID key: 65 bytes 0x04, 0x01, 0x02 ... as base64url.
const KEY_BYTES = Uint8Array.from([4, ...Array.from({ length: 64 }, (_, i) => i + 1)]);
const KEY = btoa(String.fromCharCode(...KEY_BYTES)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

interface Call { url: string; method: string; auth: string | null; body: unknown }

function serve(config: { publicKey: string | null; enabled?: boolean }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? "GET", auth: headers.get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url === `${API_BASE}/api/businesses/${BIZ}/push/config`) return Response.json(config);
    if (url === `${API_BASE}/api/businesses/${BIZ}/push/subscribe`) return Response.json({ id: "sub_1" }, { status: 201 });
    return Response.json({ message: "Not Found" }, { status: 404 });
  }));
  return calls;
}

function installPush() {
  const subscription = { endpoint: "https://push.example.test/ep", toJSON: () => ({ endpoint: "https://push.example.test/ep", keys: { p256dh: "p", auth: "a" } }), unsubscribe: vi.fn(async () => true) };
  const subscribe = vi.fn(async (_opts: PushSubscriptionOptionsInit) => subscription);
  const registration = { pushManager: { getSubscription: vi.fn(async () => null), subscribe } };
  Object.defineProperty(navigator, "serviceWorker", {
    value: { getRegistration: async () => registration, register: async () => registration, ready: Promise.resolve(registration) },
    configurable: true,
  });
  (window as unknown as Record<string, unknown>).PushManager = function PushManager() {};
  vi.stubGlobal("Notification", { permission: "granted", requestPermission: vi.fn(async () => "granted") });
  return { subscribe };
}

beforeEach(() => {
  window.localStorage.setItem("kf_token", "member-token");
});
afterEach(() => {
  cleanup();
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  delete (window as unknown as Record<string, unknown>).PushManager;
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("BUG-068: use-push-notifications reaches the API and subscribes with the server's VAPID key", () => {
  it("UPN-01 control: the config read goes to API_BASE with the member's token, never the web origin", async () => {
    const calls = serve({ publicKey: KEY, enabled: true });
    installPush();
    const { result } = renderHook(() => usePushNotifications(BIZ));
    await waitFor(() => expect(result.current.status).toBe("unsubscribed"));
    const config = calls.filter((c) => c.url.endsWith("/push/config"));
    expect(config).toHaveLength(1);
    expect(config[0].url).toBe(`${API_BASE}/api/businesses/${BIZ}/push/config`);
    expect(config[0].url.startsWith(window.location.origin)).toBe(false);
    expect(config[0].auth).toBe("Bearer member-token");
    expect(calls.every((c) => /^https?:\/\//.test(c.url) && !c.url.startsWith(window.location.origin))).toBe(true);
  });

  it("UPN-02 control: subscribe uses the server's VAPID key and saves the device at API_BASE", async () => {
    const calls = serve({ publicKey: KEY, enabled: true });
    const { subscribe } = installPush();
    const { result } = renderHook(() => usePushNotifications(BIZ));
    await waitFor(() => expect(result.current.status).toBe("unsubscribed"));
    await act(async () => { await result.current.subscribe(); });
    expect(result.current.status).toBe("subscribed");
    expect(subscribe).toHaveBeenCalledTimes(1);
    const opts = subscribe.mock.calls[0][0] as unknown as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
    expect(opts.userVisibleOnly).toBe(true);
    expect(Array.from(opts.applicationServerKey)).toEqual(Array.from(KEY_BYTES));
    const save = calls.filter((c) => c.method === "POST");
    expect(save.map((c) => c.url)).toEqual([`${API_BASE}/api/businesses/${BIZ}/push/subscribe`]);
    expect(save[0].auth).toBe("Bearer member-token");
    expect((save[0].body as { subscription: { endpoint: string } }).subscription.endpoint).toBe("https://push.example.test/ep");
  });

  it("UPN-03 control: no VAPID key on the server is 'unconfigured', and subscribe asks the browser nothing", async () => {
    serve({ publicKey: null, enabled: false });
    const { subscribe } = installPush();
    const { result } = renderHook(() => usePushNotifications(BIZ));
    await waitFor(() => expect(result.current.status).toBe("unconfigured"));
    await act(async () => { await result.current.subscribe(); });
    expect(subscribe).not.toHaveBeenCalled();
  });
});
