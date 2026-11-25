/**
 * FU-STUDIO-PAGE-SCOPE (owner ruling D-283): /studio offered settings entries to members the server refuses.
 *
 * /studio ("Business Setup", src/app/studio/page.tsx) listed Notifications, Webhooks & API and Payment Gateways, with
 * Business Profile and Compliance & Tax, to every visitor: no module filter, and outside the /app shell, so not even
 * signed in. Nothing in the app links to it (the command palette's "Studio" opens /app/settings). The page is removed,
 * and next.config.ts answers /studio with a 307 to /app/settings, the Settings index, which offers each entry only to
 * the members whose modules open it (HubIndex, canOpenModule) and sits behind the /app middleware.
 *
 * A redirect in the page itself does not answer 307: the root loading.tsx makes every app page stream, so the page's
 * redirect() reaches the browser as a 200 with a meta refresh (seen at 8b05aa1b and 7ded133c). next.config redirects run
 * before routing.
 *
 *   SPS-01 RED-BEFORE: there is no /studio page any more (no page file under src/app/studio).
 *   SPS-02 RED-BEFORE: next.config.ts answers /studio, and only /studio, with a temporary redirect to /app/settings.
 *   SPS-03 RED-BEFORE: a settings-none member who opens /studio is shown the page /studio resolves to, and it offers no
 *          settings entry, only My account.
 *   SPS-04 CONTROL: a settings reader is offered Getting paid and Notifications there.
 *   SPS-05 CONTROL: nothing in the web source links to /studio.
 *   SPS-06 CONTROL: /app/settings is a page of its own, and neither middleware nor next.config sends it elsewhere.
 * The browser half is e2e/sweep-studio-scope.spec.ts (SPB-01..05).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  redirect: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  redirect: nav.redirect,
  useRouter: () => nav.router,
  usePathname: () => "/app/settings",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

const WEB = path.resolve(__dirname, "../..");
const APP = path.join(WEB, "src/app");
const CONFIG = path.join(WEB, "next.config.ts");

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

interface Rule { source: string; destination: string; permanent: string }
/** The redirect table as written in next.config.ts (read as text, as redirect-shadowing.spec.ts reads it). */
function rules(): Rule[] {
  const cfg = fs.readFileSync(CONFIG, "utf8");
  const re = /\{\s*source:\s*["'`]([^"'`]+)["'`],\s*destination:\s*["'`]([^"'`]+)["'`],\s*permanent:\s*(true|false),?\s*\}/g;
  const out: Rule[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cfg))) out.push({ source: m[1], destination: m[2], permanent: m[3] });
  return out;
}
/** Where /studio lands: the single next.config rule whose source is /studio, or /studio itself when there is none. */
function studioDestination(): string {
  return rules().find((r) => r.source === "/studio")?.destination ?? "/studio";
}

/** Renders the page file that serves `route` (src/app<route>/page.tsx). */
async function renderRoute(route: string) {
  const file = path.join(APP, route, "page.tsx");
  expect(fs.existsSync(file), `a page serves ${route}`).toBe(true);
  const { default: Page } = (await import(/* @vite-ignore */ file)) as { default: React.ComponentType };
  render(<Page />);
  await new Promise((r) => setTimeout(r, 30));
}

/** The entries /studio listed whose pages' reads need settings (or which the Settings index hides). */
const SETTINGS_HREF = /^\/app\/settings\/(notifications|developers|webhooks|business|compliance)(\?|$)/;
const SETTINGS_NAME = /notifications|webhooks|payment gateways|developers|compliance/i;
/**
 * "My account" is every member's own page, never a settings entry, whatever its description says: since
 * FU-PUSH-OPTIN-MY-ACCOUNT (D-282) it reads "… and push notifications", which the name pattern would match.
 */
const MY_ACCOUNT_HREF = /^\/app\/settings\/profile(\?|$)/;
const settingsLinksShown = () =>
  Array.from(document.querySelectorAll("a"))
    .map((a) => ({ name: (a.textContent ?? "").replace(/\s+/g, " ").trim(), href: a.getAttribute("href") ?? "" }))
    .filter((l) => !MY_ACCOUNT_HREF.test(l.href) && (SETTINGS_HREF.test(l.href) || SETTINGS_NAME.test(l.name)));
const indexEntries = () =>
  within(screen.getByRole("navigation", { name: /settings/i }))
    .getAllByRole("link")
    .map((a) => (a.querySelector("[data-entry-name]")?.textContent ?? "").trim());

beforeEach(() => {
  nav.redirect.mockClear();
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("activeBusinessId", BIZ);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("FU-STUDIO-PAGE-SCOPE: the /studio page is removed; /studio answers 307 to /app/settings", () => {
  it("SPS-01 RED-BEFORE: there is no /studio page any more", () => {
    const left = fs.existsSync(path.join(APP, "studio"))
      ? fs.readdirSync(path.join(APP, "studio"), { recursive: true }).map(String).filter((f) => /(^|\/)(page|layout|route)\.[tj]sx?$/.test(f))
      : [];
    expect(left).toEqual([]);
  });

  it("SPS-02 RED-BEFORE: next.config.ts answers /studio, and only /studio, with a temporary redirect to /app/settings", () => {
    const studio = rules().filter((r) => /^\/studio(\/|$)/.test(r.source));
    expect(studio).toEqual([{ source: "/studio", destination: "/app/settings", permanent: "false" }]);
  });

  it("SPS-03 RED-BEFORE: a settings-none member who opens /studio is offered no settings entry, only My account", async () => {
    serve(modules({ crm: "read", bookings: "read" }));
    await renderRoute(studioDestination());
    expect(settingsLinksShown(), "settings entries where /studio lands").toEqual([]);
    await waitFor(() => expect(indexEntries()).toEqual(["My account"]));
    expect(settingsLinksShown(), "settings entries where /studio lands, once access is known").toEqual([]);
  });

  it("SPS-04 CONTROL: a settings reader who opens /studio is offered Getting paid and Notifications", async () => {
    serve(modules({ crm: "read", settings: "read" }));
    await renderRoute("/app/settings");
    await waitFor(() =>
      expect(indexEntries()).toEqual(["Business profile", "Getting paid", "Documents & messages", "Notifications", "Plan & billing", "My account"]),
    );
  });

  it("SPS-05 CONTROL: nothing in the web source links to /studio", () => {
    const srcDir = path.join(WEB, "src");
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

  it("SPS-06 CONTROL: /app/settings is a page of its own, and neither middleware nor next.config sends it elsewhere", () => {
    expect(fs.existsSync(path.join(APP, "app/settings/page.tsx"))).toBe(true);
    const middleware = fs.readFileSync(path.join(WEB, "src/middleware.ts"), "utf8");
    expect(middleware).not.toMatch(/["']\/app\/settings["']\s*:/);
    expect(rules().filter((r) => r.source === "/app/settings")).toEqual([]);
  });
});
