/**
 * FU-STUDIO-PAGE-SCOPE (owner ruling D-283): /studio offered settings entries to members the server refuses.
 *
 * /studio ("Business Setup", src/app/studio/page.tsx) listed Notifications, Webhooks & API and Payment Gateways, with
 * Business Profile and Compliance & Tax, to every visitor: no module filter, and outside the /app shell, so not even
 * signed in. Nothing in the app links to it (the command palette's "Studio" opens /app/settings). The page goes, and
 * /studio sends an old bookmark to /app/settings, the Settings index, which offers each entry only to the members whose
 * modules open it (HubIndex, canOpenModule).
 *
 *   SPS-01..04 RED-BEFORE: whoever opens /studio (a settings-none member, a settings reader, an owner, a visitor with no
 *              business) sees no settings entries there and is sent to /app/settings.
 *   SPS-05     CONTROL: /app/settings, where /studio now sends them, offers a settings-none member no settings entry.
 *   SPS-06     CONTROL: nothing in the web source links to /studio.
 *   SPS-07     CONTROL: /app/settings is a page of its own, and neither middleware nor next.config sends it elsewhere.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  redirect: nav.redirect,
  permanentRedirect: nav.permanentRedirect,
  useRouter: () => nav.router,
  usePathname: () => "/studio",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

const BIZ = "biz_studio_scope";
const ALL = ["crm", "revenue", "bookings", "projects", "content", "expenses", "automations", "storefront", "settings", "ai", "team", "analytics", "operations", "connect"];
const modules = (granted: Record<string, string>) => Object.fromEntries(ALL.map((m) => [m, granted[m] ?? "none"]));

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

/** my-access answers with these modules; every other read answers 403, as the server does for a member without them. */
function serve(mods: Record<string, string>) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    if (pathname.endsWith(`/identity/businesses/${BIZ}/my-access`)) return jsonResponse(200, { role: "STAFF", modules: mods });
    return jsonResponse(403, { message: "Forbidden" });
  }));
}

/** The entries /studio listed whose pages' reads need settings (or which the Settings index hides). */
const SETTINGS_HREFS = [
  "/app/settings/notifications",
  "/app/settings/developers",
  "/app/settings/business?tab=payments",
  "/app/settings/business",
  "/app/settings/compliance",
];
const SETTINGS_NAMES = /notifications|webhooks|payment gateways|business profile|compliance/i;

async function openStudio() {
  const { default: StudioPage } = await import("@/app/studio/page");
  render(<StudioPage />);
  // Let any read the page starts settle before looking.
  await new Promise((r) => setTimeout(r, 30));
}
const settingsLinksShown = () =>
  Array.from(document.querySelectorAll("a"))
    .map((a) => ({ name: (a.textContent ?? "").replace(/\s+/g, " ").trim(), href: a.getAttribute("href") ?? "" }))
    .filter((l) => SETTINGS_HREFS.includes(l.href) || SETTINGS_NAMES.test(l.name));

beforeEach(() => {
  nav.redirect.mockClear();
  nav.permanentRedirect.mockClear();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("FU-STUDIO-PAGE-SCOPE: /studio offers no settings entries; it sends the visitor to /app/settings", () => {
  const VISITORS: { id: string; who: string; mods: Record<string, string> | null }[] = [
    { id: "SPS-01", who: "a member whose settings access is none", mods: modules({ crm: "read", bookings: "read" }) },
    { id: "SPS-02", who: "a member with settings read", mods: modules({ crm: "read", settings: "read" }) },
    { id: "SPS-03", who: "an owner", mods: modules(Object.fromEntries(ALL.map((m) => [m, "manage"]))) },
    { id: "SPS-04", who: "a visitor with no business stored (signed out)", mods: null },
  ];

  for (const v of VISITORS) {
    it(`${v.id} RED-BEFORE: ${v.who} sees no settings entries on /studio and is sent to /app/settings`, async () => {
      if (v.mods) {
        window.localStorage.setItem("kf_business_id", BIZ);
        window.localStorage.setItem("activeBusinessId", BIZ);
        serve(v.mods);
      } else {
        serve(modules({}));
      }
      await openStudio();
      expect(settingsLinksShown(), "settings entries listed on /studio").toEqual([]);
      expect(document.querySelectorAll("a"), "links listed on /studio").toHaveLength(0);
      expect(nav.redirect).toHaveBeenCalledTimes(1);
      expect(nav.redirect).toHaveBeenCalledWith("/app/settings");
      expect(nav.permanentRedirect).not.toHaveBeenCalled();
    });
  }
});

describe("FU-STUDIO-PAGE-SCOPE: where /studio sends the visitor", () => {
  it("SPS-05 CONTROL: /app/settings offers a settings-none member no settings entry, only My account", async () => {
    window.localStorage.setItem("kf_business_id", BIZ);
    window.localStorage.setItem("activeBusinessId", BIZ);
    serve(modules({ crm: "read", bookings: "read" }));
    const { default: SettingsIndexPage } = await import("@/app/app/settings/page");
    render(<SettingsIndexPage />);
    const index = screen.getByRole("navigation", { name: /settings/i });
    const names = () => within(index).getAllByRole("link").map((a) => (a.querySelector("[data-entry-name]")?.textContent ?? "").trim());
    await waitFor(() => expect(names()).toEqual(["My account"]));
  });

  it("SPS-06 CONTROL: nothing in the web source links to /studio", () => {
    const srcDir = path.resolve(__dirname, "../../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__" || entry.name === "node_modules") continue;
          walk(full);
        } else if (/\.(tsx?|jsx?|mjs)$/.test(entry.name) && !/\.(test|spec)\.[tj]sx?$/.test(entry.name)) {
          const text = fs.readFileSync(full, "utf8");
          if (/["'`]\/studio(?:["'`?#/])/.test(text)) hits.push(path.relative(srcDir, full));
        }
      }
    };
    walk(srcDir);
    expect(hits).toEqual([]);
  });

  it("SPS-07 CONTROL: /app/settings is a page of its own, and neither middleware nor next.config sends it elsewhere", () => {
    const webDir = path.resolve(__dirname, "../../../..");
    expect(fs.existsSync(path.join(webDir, "src/app/app/settings/page.tsx"))).toBe(true);
    const middleware = fs.readFileSync(path.join(webDir, "src/middleware.ts"), "utf8");
    expect(middleware).not.toMatch(/["']\/app\/settings["']\s*:/);
    const nextConfig = fs.readFileSync(path.join(webDir, "next.config.ts"), "utf8");
    expect(nextConfig).not.toMatch(/source:\s*["']\/app\/settings["']/);
  });
});
