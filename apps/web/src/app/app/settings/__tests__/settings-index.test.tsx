/**
 * NAV-A2 (journey F; D-105, D-138): /app/settings is a real index of the v1 Settings, with Getting paid.
 *
 * Before: settings/page.tsx replaced itself with /app/settings/billing, so Settings had no index and no Getting paid.
 * The v1 entries, in order: Business profile, Getting paid, Team, Documents & messages, Notifications, Plan & billing,
 * KEY, My account. Getting paid opens the payments page (/app/settings/business, which holds only payments-tab.tsx;
 * that file is bound through whatsapp-config-authority.json and is not edited) and leads with cash, bank transfer and
 * WiPay, with PayPal and Stripe as "your own keys" (D-105, D-138). Developers and Webhooks are not on the index (they
 * are hidden by HIDE-DEV-WEBHOOKS). KEY hides under KEY_DISABLED once SWP-KEY-SHELL-SMOKE gives the web that switch.
 *
 * Entries follow the member's modules as the nav reads them (my-access); My account is every member's.
 * Every case is tagged RED-BEFORE (each fails on the packet's base, 04730333), except the review case marked CONTROL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/app/settings",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

const BIZ = "biz_nav_a2";

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    clone() { return jsonResponse(status, body); },
  } as unknown as Response;
}
function serve(modules: Record<string, string> | null) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    // SWP-KEY-SHELL-SMOKE: the index offers KEY once /identity/me says KEY is on (useKeyEnabled), as it does in the app.
    if (pathname === "/identity/me") return jsonResponse(200, { id: "usr_nav_a2", keyDisabled: false });
    if (pathname.endsWith(`/identity/businesses/${BIZ}/my-access`)) {
      return modules ? jsonResponse(200, { role: "STAFF", modules }) : jsonResponse(503, { message: "Service Unavailable" });
    }
    return jsonResponse(404, { message: "Not Found" });
  }));
}

async function renderSettings() {
  const { default: Page } = await import("@/app/app/settings/page");
  render(<Page />);
}
const index = () => screen.getByRole("navigation", { name: /settings/i });
const entries = () =>
  within(index()).getAllByRole("link").map((a) => ({ name: (a.querySelector("[data-entry-name]")?.textContent ?? "").trim(), href: a.getAttribute("href") }));

beforeEach(() => {
  router.replace.mockClear();
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("activeBusinessId", BIZ);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NAV-A2: /app/settings is the v1 Settings index", () => {
  it("RED-BEFORE: it stays on the index; it does not send the member to Plan & billing", async () => {
    serve(null);
    await renderSettings();
    await new Promise((r) => setTimeout(r, 30));
    expect(router.replace).not.toHaveBeenCalled();
    expect(index()).toBeTruthy();
  });

  it("RED-BEFORE: it lists the v1 Settings in order, each opening its page", async () => {
    serve(null);
    await renderSettings();
    await waitFor(() => expect(entries()).toEqual([
      { name: "Business profile", href: "/app/profile" },
      { name: "Getting paid", href: "/app/settings/business" },
      { name: "Team", href: "/app/settings/team" },
      { name: "Documents & messages", href: "/app/settings/templates" },
      { name: "Notifications", href: "/app/settings/notifications" },
      { name: "Plan & billing", href: "/app/settings/billing" },
      { name: "KEY", href: "/app/settings/ai" },
      { name: "My account", href: "/app/settings/profile" },
    ]));
  });

  it("RED-BEFORE: Getting paid leads with cash, bank transfer and WiPay, and names PayPal and Stripe as your own keys", async () => {
    serve(null);
    await renderSettings();
    const paid = within(index()).getByRole("link", { name: /getting paid/i });
    const text = (paid.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toMatch(/cash, bank transfer and wipay/i);
    expect(text).toMatch(/paypal and stripe.*your own keys/i);
  });

  it("RED-BEFORE: Developers and Webhooks are not on the index", async () => {
    serve(null);
    await renderSettings();
    const hrefs = entries().map((e) => e.href ?? "");
    expect(hrefs.filter((h) => /developers|webhooks/.test(h))).toEqual([]);
  });

  it("CONTROL (review M4): a member with settings but no team or operations access is offered neither Team nor KEY", async () => {
    // Team's page reads need team, KEY's need operations (the nav's rows); settings alone opens the rest.
    serve({ settings: "write", team: "none", operations: "none" });
    await renderSettings();
    await waitFor(() => expect(entries().map((e) => e.name)).not.toContain("Team"));
    expect(entries().map((e) => e.name)).toEqual(["Business profile", "Getting paid", "Documents & messages", "Notifications", "Plan & billing", "My account"]);
  });

  it("RED-BEFORE: a member without the team module is not offered Team; My account is every member's", async () => {
    serve({ settings: "none", team: "none", operations: "none" });
    await renderSettings();
    await waitFor(() => expect(entries().map((e) => e.name)).not.toContain("Team"));
    expect(entries().map((e) => e.name)).toEqual(["My account"]);
  });
});
