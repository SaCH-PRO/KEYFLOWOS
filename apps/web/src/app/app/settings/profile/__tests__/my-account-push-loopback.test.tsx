// @vitest-environment-options {"url": "http://127.0.0.1:3000/app/settings/profile"}
/**
 * FU-PUSH-OPTIN-MY-ACCOUNT (D-282), repair round 2, N2: 127.0.0.1 is a local development origin too (public/sw.js
 * IS_LOCALHOST and the root layout's inline script read localhost and 127.0.0.1). The rest of this header is
 * my-account-push-localhost.test.tsx's (PLH-01..02), whose harness this file repeats on 127.0.0.1.
 *
 *   PLB-01  pin  127.0.0.1: "not available on a local development server", no button, no push request
 *   PLB-02  pin  127.0.0.1 with the test-only switch: the real path
 *
 * Round 1, COR-M3: push is not offered on a local development origin.
 *
 * On localhost and 127.0.0.1 the app's service worker unregisters itself (public/sw.js, IS_LOCALHOST) and the root
 * layout's inline script unregisters any worker that controls the page. A "Turn on" there would save a server row
 * for a browser subscription that dies with its worker. So My account says push is not available on a local
 * development server and offers no button. jsdom's default origin (http://localhost:3000) is such an origin.
 *
 * The mocked browser sweep (e2e/sweep-push-optin.spec.ts) runs on localhost with a faked ServiceWorkerContainer and
 * sets the documented test-only switch window.__KF_PUSH_ALLOW_LOCALHOST__ = true to exercise the real path.
 *
 *   PLH-01  RED-BEFORE  localhost: "not available on a local development server", no button, no push request
 *   PLH-02  control     localhost with the test-only switch: the real path (Turn on)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/settings/profile",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("@/hooks/use-upload", () => ({ useUpload: () => ({ uploadFile: async () => ({ objectPath: "/objects/uploads/me.png" }), isUploading: false }) }));

const BIZ = "biz_push_local";
const VAPID_PUBLIC = Buffer.from(Uint8Array.from({ length: 65 }, (_, i) => (i * 3 + 1) % 256)).toString("base64url");

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function serve(): string[] {
  const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://web.origin.invalid");
    paths.push(pathname);
    if (pathname.endsWith("/identity/me")) return json(200, { id: "usr_dev", email: "dev@example.com", name: "Dev" });
    if (pathname.endsWith("/push/config")) return json(200, { publicKey: VAPID_PUBLIC, enabled: true });
    return json(404, { message: "Not Found" });
  }));
  return paths;
}

function installPush() {
  const registration = { pushManager: { getSubscription: async () => null, subscribe: vi.fn(async () => null) }, scope: "/" };
  Object.defineProperty(navigator, "serviceWorker", {
    value: { getRegistration: async () => registration, register: vi.fn(async () => registration), ready: Promise.resolve(registration) },
    configurable: true,
  });
  (window as unknown as Record<string, unknown>).PushManager = function PushManager() {};
  vi.stubGlobal("Notification", { permission: "default", requestPermission: async () => "granted" });
}

async function pushSection() {
  const { default: Page } = await import("@/app/app/settings/profile/page");
  render(<Page />);
  const heading = await screen.findByRole("heading", { name: /push notifications on this device/i }, { timeout: 4_000 });
  return within(heading.closest("section") as HTMLElement);
}

beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("kf_token", "dev-token");
});
afterEach(() => {
  cleanup();
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  delete (window as unknown as Record<string, unknown>).PushManager;
  delete (window as unknown as Record<string, unknown>).__KF_PUSH_ALLOW_LOCALHOST__;
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("D-282 repair round 2: 127.0.0.1 is a local development origin", () => {
  it("PLB-01 pin: 127.0.0.1 says push is not available on a local development server, with no button", async () => {
    expect(window.location.hostname).toBe("127.0.0.1");
    const paths = serve();
    installPush();
    const push = await pushSection();
    expect(await push.findByText(/not available on a local development server/i)).toBeTruthy();
    expect(push.queryByRole("button")).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(paths.filter((p) => p.includes("/push/"))).toEqual([]);
  });

  it("PLB-02 pin: 127.0.0.1 with the test-only switch takes the real path", async () => {
    (window as unknown as Record<string, unknown>).__KF_PUSH_ALLOW_LOCALHOST__ = true;
    serve();
    installPush();
    const push = await pushSection();
    expect(await push.findByRole("button", { name: /turn on/i })).toBeTruthy();
    expect(push.queryByText(/local development server/i)).toBeNull();
  });
});
