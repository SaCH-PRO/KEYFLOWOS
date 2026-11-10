/**
 * W7-WEB-OPS-SCOPE (FOLLOW8, Release 0 exit; owner rulings D-40 and D-96): the
 * nav hides the procurement entry ("Purchasing", /app/procurement) from a member
 * the server refuses operations, and only from them.
 *
 * WHY: R0-13g-OPS-SCOPE-COMMAND-PROCUREMENT (D-40) put every procurement route
 * behind the existing 'operations' module scope (read for a GET), so a member
 * whose scope map grants no operations is refused (403) on every call the
 * procurement screens make. The nav still offered them the door: the desktop
 * sidebar, the mobile drawer and the mobile module launcher all listed
 * Purchasing for every member (OPS-T02 in
 * apps/server/test/ops-scope-command-procurement.integration.test.ts).
 *
 * The web cannot read a STAFF member's own scope map, so it reads the level the
 * way the other module gates do: from the server's own answer
 * (lib/module-access.ts: GET procurement stats needs operations read; 403 is
 * none, success is read or more, anything else is unknown and shows the entry).
 * The cockpit (/app/command-center) is not gated: it is every member's home,
 * each tile filtered by the member's own permissions (D-96).
 *
 * Mounted on the real sidebar, drawer and bottom nav with the real nav-config
 * sections and the real client (lib/client.ts, lib/api.ts); only `fetch` and
 * the router are stubbed. A 403 is the body the production
 * GlobalHttpExceptionFilter answers for ModuleScopeGuard's refusal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor, within, cleanup, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(),
    refresh: vi.fn(), prefetch: vi.fn(),
  }),
  usePathname: () => "/app/command-center",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { DesktopSidebar } from "../desktop-sidebar";
import { MobileDrawer } from "../mobile-drawer";
import { MobileBottomNavV2 } from "../mobile-bottom-nav-v2";
import { operateSections } from "@/lib/nav-config";
import { selectBusiness } from "@/lib/workspace";

const BIZ = "biz_w7wos_a";
const OTHER = "biz_w7wos_b";
const NOW = "2026-11-10T10:00:00.000Z";

type Answer = { status: number; body: unknown };

/** ModuleScopeGuard's refusal of GET procurement stats, as GlobalHttpExceptionFilter answers it. */
function forbidden(businessId: string, have: string): Answer {
  return {
    status: 403,
    body: {
      statusCode: 403,
      message: `Insufficient permissions: operations requires read access (you have ${have})`,
      error: "Forbidden",
      timestamp: NOW,
      path: `/procurement/businesses/${businessId}/stats`,
    },
  };
}

const STATS: Answer = {
  status: 200,
  body: { total: 0, byStatus: {}, byPriority: {}, byCategory: {}, averageBudget: 0, totalBudget: 0, pendingApprovals: 0 },
};

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  const statusText = status === 200 ? "OK" : status === 403 ? "Forbidden" : "Service Unavailable";
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    clone() { return jsonResponse(status, body); },
  } as unknown as Response;
}

/** Answer GET procurement stats per business; every other request answers 503 (not under test). */
function serve(stats: Record<string, Answer>) {
  const statsReads: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const match = method === "GET" ? /\/procurement\/businesses\/([^/]+)\/stats$/.exec(pathname) : null;
    if (match) {
      const businessId = decodeURIComponent(match[1]);
      statsReads.push(businessId);
      const answer = stats[businessId] ?? { status: 503, body: { message: "Service Unavailable" } };
      return jsonResponse(answer.status, answer.body);
    }
    return jsonResponse(503, { message: "Service Unavailable" });
  }));
  return { statsReads };
}

/** The three nav surfaces as app/app/layout.tsx mounts them, every one open on the Operate sections. */
function renderNav() {
  const noop = () => {};
  render(
    <>
      <DesktopSidebar
        drawerSurface="operate"
        setDrawerSurface={noop}
        isPrimaryActive={() => false}
        visibleOperateSections={operateSections}
        visibleBuildSections={[]}
        visibleMoreNav={[]}
        meNav={[]}
        isSecondaryActive={() => false}
        isFeatureLocked={() => false}
        connectorAlertCount={0}
        isAdminUser={false}
        setKfStoreOpen={noop}
      />
      <MobileDrawer
        mobileDrawerOpen
        setMobileDrawerOpen={noop}
        pathname="/app/command-center"
        displayName="Member"
        initials="M"
        avatarUrl={null}
        visibleOperateSections={operateSections}
        visibleBuildSections={[]}
        visibleMoreNav={[]}
        meNav={[]}
        isSecondaryActive={() => false}
        isFeatureLocked={() => false}
        connectorAlertCount={0}
        isAdminUser={false}
        setKfStoreOpen={noop}
        handleLogout={noop}
      />
      <MobileBottomNavV2
        pathname="/app/command-center"
        mobileDrawerOpen={false}
        setMobileDrawerOpen={noop}
        notifOpen={false}
        setNotifOpen={noop}
        unreadCount={0}
        visibleOperateSections={operateSections}
        visibleBuildSections={[]}
        visibleMoreNav={[]}
      />
    </>,
  );
  // The bottom nav's module launcher lists the sections only once opened.
  act(() => {
    window.dispatchEvent(new Event("kf:open-module-launcher"));
  });
}

/**
 * How many times each surface lists the entry labelled `label`: the desktop sidebar's Operate
 * drawer, the mobile drawer, and the module launcher, which renders a mobile and a desktop variant
 * of its sheet (one hidden by CSS), counted per variant.
 */
function entries(label: string) {
  const sidebar = document.querySelector("aside");
  const drawer = screen.getByRole("dialog", { name: "Navigation menu" });
  const launchers = screen.getAllByRole("dialog", { name: "Module Launcher" });
  const count = (root: Element) => within(root as HTMLElement).queryAllByText(label).length;
  return {
    sidebar: sidebar ? count(sidebar) : -1,
    drawer: count(drawer),
    launcher: launchers.map(count),
  };
}

/** Once per surface (and per launcher variant). */
const EVERYWHERE = { sidebar: 1, drawer: 1, launcher: [1, 1] };
const NOWHERE = { sidebar: 0, drawer: 0, launcher: [0, 0] };

beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("activeBusinessId", BIZ);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("W7-WEB-OPS-SCOPE (D-40, D-96): the nav's procurement entry follows the member's operations level", () => {
  it("[WOS-N01] RED-BEFORE: a member without operations (GET procurement stats 403, you have none) sees no Purchasing entry in the desktop sidebar, the mobile drawer or the module launcher; the rest of Money and the cockpit stay", async () => {
    const { statsReads } = serve({ [BIZ]: forbidden(BIZ, "none") });
    renderNav();

    await waitFor(() => expect(statsReads).toContain(BIZ));
    await waitFor(() => expect(entries("Purchasing")).toEqual(NOWHERE));
    // Only the gated door goes: the sibling entry of the Money section is still in every surface.
    expect(entries("Expenses")).toEqual(EVERYWHERE);
    // D-96: the cockpit stays every member's home.
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "/app/command-center")).toBe(true);
  });

  it("[WOS-N02] a member with operations write (GET procurement stats 200) sees the Purchasing entry in every surface", async () => {
    const { statsReads } = serve({ [BIZ]: STATS });
    renderNav();

    await waitFor(() => expect(statsReads).toContain(BIZ));
    // Settled: the answer is in and the entry is still there, once per surface.
    await act(async () => {});
    expect(entries("Purchasing")).toEqual(EVERYWHERE);
    for (const entry of screen.getAllByText("Purchasing")) {
      expect(entry.closest("a")?.getAttribute("href")).toBe("/app/procurement");
    }
  });

  it("[WOS-N03] an answer that is neither success nor 403 (503) keeps the entry: unknown never hides a door", async () => {
    const { statsReads } = serve({});
    renderNav();

    await waitFor(() => expect(statsReads).toContain(BIZ));
    await act(async () => {});
    expect(entries("Purchasing")).toEqual(EVERYWHERE);
  });

  it("[WOS-N04] RED-BEFORE: the entry follows the selected business: hidden where the member is refused, shown again after switching to a business that grants operations", async () => {
    const { statsReads } = serve({ [BIZ]: forbidden(BIZ, "none"), [OTHER]: STATS });
    renderNav();
    await waitFor(() => expect(entries("Purchasing")).toEqual(NOWHERE));

    act(() => {
      selectBusiness(OTHER);
    });
    await waitFor(() => expect(statsReads).toContain(OTHER));
    await waitFor(() => expect(entries("Purchasing")).toEqual(EVERYWHERE));
  });
});
