/**
 * FU-PUSH-OPTIN-MY-ACCOUNT (owner ruling D-282): the push opt-in has one home, My account.
 *
 * Settings > Notifications (settings readers only, D-276) had a Push tab with the member's own device opt-in. The
 * opt-in is now on My account for every member, so this page keeps only the business's customer emails and their log,
 * and points a settings reader looking for push to My account. Two copies of the same control would be two sources of
 * truth for one device's state.
 *
 *   NPM-01  RED-BEFORE  no Push tab; a link to My account (/app/settings/profile) for push on this device
 *   NPM-02  RED-BEFORE  the page asks the server nothing about push (no /push/ request)
 *   NPM-03  control     the customer-email preferences and the log are still here
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/settings/notifications",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

const BIZ = "biz_notif";
const PREFS = {
  booking_confirmed: true,
  booking_reminder: true,
  booking_rescheduled: false,
  booking_cancelled: true,
  invoice_sent: true,
  payment_receipt: false,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function serve(): string[] {
  const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://web.origin.invalid");
    paths.push(pathname);
    if (pathname.endsWith(`/notifications/businesses/${BIZ}/customer-preferences`)) return json(200, PREFS);
    if (pathname.endsWith(`/notifications/businesses/${BIZ}/customer-log`)) return json(200, []);
    if (pathname.endsWith("/push/config")) return json(200, { publicKey: "BAAA", enabled: true });
    return json(404, { message: "Not Found" });
  }));
  return paths;
}

/** A browser that supports push, so the old Push tab would have asked the server for its config. */
function installPush() {
  const registration = { pushManager: { getSubscription: async () => null, subscribe: async () => null } };
  Object.defineProperty(navigator, "serviceWorker", {
    value: { getRegistration: async () => registration, register: async () => registration, ready: Promise.resolve(registration) },
    configurable: true,
  });
  (window as unknown as Record<string, unknown>).PushManager = function PushManager() {};
  vi.stubGlobal("Notification", { permission: "default", requestPermission: async () => "default" });
}

async function renderPage() {
  const { default: Page } = await import("@/app/app/settings/notifications/page");
  return render(<Page />);
}

beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("kf_token", "reader-token");
});
afterEach(() => {
  cleanup();
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  delete (window as unknown as Record<string, unknown>).PushManager;
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("D-282: Settings > Notifications keeps the business's customer emails; push is on My account", () => {
  it("NPM-01 RED-BEFORE: no Push tab, and a link to My account for push on this device", async () => {
    serve();
    installPush();
    await renderPage();
    await screen.findByRole("heading", { name: /customer notifications/i });
    expect(screen.queryByRole("button", { name: /^push$/i })).toBeNull();
    const link = screen.getByRole("link", { name: /my account/i });
    expect(link.getAttribute("href")).toBe("/app/settings/profile");
    expect(link.closest("p")?.textContent ?? "").toMatch(/push notifications/i);
  });

  it("NPM-02 RED-BEFORE: the page asks the server nothing about push", async () => {
    const paths = serve();
    installPush();
    await renderPage();
    await screen.findByRole("heading", { name: /customer notifications/i });
    await new Promise((r) => setTimeout(r, 50));
    expect(paths.filter((p) => p.includes("/push/"))).toEqual([]);
  });

  it("NPM-03 control: the customer-email preferences and the log are still here", async () => {
    serve();
    installPush();
    await renderPage();
    await screen.findByRole("heading", { name: /customer notifications/i });
    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(6));
    expect(screen.getByRole("switch", { name: /toggle booking confirmation/i }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: /toggle payment receipt/i }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("button", { name: /^log \(0\)$/i })).toBeTruthy();
  });
});
