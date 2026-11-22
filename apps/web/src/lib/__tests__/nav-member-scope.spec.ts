/**
 * NAV-A1 (re-cut v1 plan, step 3; owner rulings D-150 'hubs', D-151 'labels', D-179 'legacyaccess'): the app is
 * seven hubs that fit what the business sells, and each hub shows a member only when the member's module scopes let
 * it open (journey J5: a staff member's menu shows only the hubs they may open). The server still refuses; this only
 * decides what the menu offers.
 *
 * The member's levels come from the server (GET identity/businesses/:b/my-access, read exactly as ModuleScopeGuard
 * reads them). An answer that has not landed, failed, or names another business says nothing about the member and
 * hides nothing: a door the server then refuses is better than a door hidden on a network blip (WOS-R1).
 *
 *   NMS-01 a STAFF member with bookings read and customers read sees Today, Customers and Schedule only (J5).
 *   NMS-02 the hubs follow what the business sells: a products business has no Schedule hub; services and both
 *          have all seven.
 *   NMS-03 the phone's bottom bar: services Today, Schedule, New, Customers, More; products Today, Sales, New,
 *          Customers, More; both Today, Schedule, New, Sales, More; a hub the member cannot open gives its slot to
 *          the next hub they can.
 *   NMS-04 legacyaccess (D-179): a member whose map has no analytics or operations entry gets no Reports and no
 *          operations surfaces (Purchasing, Operations, SOPs) in the menu; with them granted, they come back.
 *   NMS-05 unknown access (no answer yet, a failed read) shows every hub.
 *   NMS-06 the answer is read strictly: only the four levels, only for the business asked about.
 *   NMS-07 the shell's reader asks GET identity/businesses/:b/my-access for the selected business and applies only
 *          that business's answer; a failed read is unknown.
 *   NMS-08 the bottom bar as a phone renders it: its links and buttons read Today, Sales, New, Customers, More for a
 *          products business (journey A4), New opens the New menu and More opens the navigation drawer.
 *   NMS-09 the desktop menu (Main navigation) shows the hubs as links named by their plain labels, and a products
 *          business's menu names no Schedule (journey A4); a front-desk member's menu offers no Sales, Money, Your
 *          page or Settings hub (J5).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { render, screen, within, cleanup, renderHook, waitFor, fireEvent, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/command-center",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

import {
  hubNav,
  hubsFor,
  bottomBarFor,
  menuSectionsFor,
  memberModuleLevelsOf,
  type ModuleLevels,
} from "../nav-config";
import { useMemberModuleLevels } from "@/hooks/use-app-layout";
import { MobileBottomNavV2 } from "@/components/layout/mobile-bottom-nav-v2";
import { DesktopSidebar } from "@/components/layout/desktop-sidebar";
import { selectBusiness } from "../workspace";

const ALL = ["crm", "revenue", "bookings", "projects", "content", "expenses", "automations", "storefront", "settings", "ai", "team", "analytics", "operations", "connect"];

/** A member's answer: every module none except the ones given. */
function levels(granted: Record<string, "read" | "write" | "admin">): ModuleLevels {
  const out: Record<string, string> = {};
  for (const m of ALL) out[m] = granted[m] ?? "none";
  return out as ModuleLevels;
}

const FRONT_DESK = levels({ bookings: "read", crm: "read" });
const OWNER = levels(Object.fromEntries(ALL.map((m) => [m, "admin"])) as Record<string, "admin">);

const labelsOf = (hubs: { label: string }[]) => hubs.map((h) => h.label);
const itemLabels = (sections: { items: { label: string }[] }[]) => sections.flatMap((s) => s.items.map((i) => i.label));

describe("NAV-A1: the hubs a member is shown", () => {
  it("NMS-01 a STAFF member with bookings and customers read sees Today, Customers and Schedule only (J5)", () => {
    expect(labelsOf(hubsFor("both", FRONT_DESK))).toEqual(["Today", "Customers", "Schedule"]);
    const { hubSections, moreSections } = menuSectionsFor("both", FRONT_DESK);
    const names = [...hubSections.map((s) => s.label), ...itemLabels(hubSections), ...itemLabels(moreSections)];
    for (const hub of [/^sales\b/i, /^money\b/i, /^settings\b/i, /^(your page|booking page|online store)\b/i]) {
      expect(names.filter((n) => hub.test(n)), `${hub} in a front-desk menu`).toEqual([]);
    }
  });

  it("NMS-02 the hubs follow what the business sells", () => {
    const seven = ["Today", "Customers", "Sales", "Schedule", "Money", "Your page", "Settings"];
    expect(labelsOf(hubNav)).toEqual(seven);
    expect(labelsOf(hubsFor("both", OWNER))).toEqual(seven);
    expect(labelsOf(hubsFor("services", OWNER))).toEqual(seven);
    expect(labelsOf(hubsFor("products", OWNER))).toEqual(["Today", "Customers", "Sales", "Money", "Your page", "Settings"]);
    expect(hubNav.map((h) => h.href)).toEqual([
      "/app/command-center",
      "/app/crm/contacts",
      "/app/commerce",
      "/app/schedule/calendar",
      // /app/money and /app/settings only forward today (to /app/financial-flow and /app/settings/billing); the hubs
      // name final URLs until NAV-A2 makes both real indexes.
      "/app/financial-flow",
      "/app/store",
      "/app/settings/business",
    ]);
  });

  it("NMS-03 the phone's bottom bar fits what the business sells, and what the member may open", () => {
    expect(labelsOf(bottomBarFor("services", OWNER))).toEqual(["Schedule", "Customers"]);
    expect(labelsOf(bottomBarFor("products", OWNER))).toEqual(["Sales", "Customers"]);
    expect(labelsOf(bottomBarFor("both", OWNER))).toEqual(["Schedule", "Sales"]);
    // A front-desk member of a 'both' business cannot open Sales: Customers takes its slot.
    expect(labelsOf(bottomBarFor("both", FRONT_DESK))).toEqual(["Schedule", "Customers"]);
    // A member who may open only Customers gets one hub slot, never a hub they cannot open.
    expect(labelsOf(bottomBarFor("products", levels({ crm: "read" })))).toEqual(["Customers"]);
  });

  it("NMS-04 legacyaccess (D-179): no analytics or operations entry means no Reports and no operations surfaces", () => {
    const bookkeeper = levels({ revenue: "write", expenses: "write" });
    const { hubSections, moreSections } = menuSectionsFor("both", bookkeeper);
    const names = [...itemLabels(hubSections), ...itemLabels(moreSections)];
    for (const gone of ["Reports", "Purchasing", "Operations", "SOPs"]) expect(names, gone).not.toContain(gone);
    expect(names, "the rest of Money stays").toContain("Expenses");

    const regranted = levels({ revenue: "write", expenses: "write", analytics: "read", operations: "read" });
    const back = menuSectionsFor("both", regranted);
    const backNames = [...itemLabels(back.hubSections), ...itemLabels(back.moreSections)];
    for (const shown of ["Reports", "Purchasing", "Operations", "SOPs"]) expect(backNames, shown).toContain(shown);
  });

  it("NMS-05 unknown access shows every hub", () => {
    expect(labelsOf(hubsFor("both", null))).toEqual(["Today", "Customers", "Sales", "Schedule", "Money", "Your page", "Settings"]);
    expect(labelsOf(bottomBarFor("products", null))).toEqual(["Sales", "Customers"]);
  });

  it("NMS-06 the server's answer is read strictly", () => {
    expect(memberModuleLevelsOf({ modules: { crm: "read", revenue: "none", settings: "root", team: 3 } })).toEqual({ crm: "read", revenue: "none" });
    expect(memberModuleLevelsOf(null)).toBeNull();
    expect(memberModuleLevelsOf({})).toBeNull();
    expect(memberModuleLevelsOf({ modules: [] })).toBeNull();
    // A module the answer does not name is unknown, so it hides nothing.
    expect(labelsOf(hubsFor("both", { crm: "read" }))).toEqual(["Today", "Customers", "Sales", "Schedule", "Money", "Your page", "Settings"]);
  });
});

/* ───────────────────────────── the shell's reader ───────────────────────────── */

const BIZ = "biz_nava1_a";
const OTHER = "biz_nava1_b";

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    clone() {
      return jsonResponse(status, body);
    },
  } as unknown as Response;
}

function serveAccess(answers: Record<string, { status: number; body: unknown }>) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      const m = /\/identity\/businesses\/([^/]+)\/my-access$/.exec(pathname);
      if (m) {
        const id = decodeURIComponent(m[1]);
        asked.push(id);
        const a = answers[id] ?? { status: 503, body: { message: "Service Unavailable" } };
        return jsonResponse(a.status, a.body);
      }
      return jsonResponse(503, { message: "Service Unavailable" });
    }),
  );
  return asked;
}

beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("activeBusinessId", BIZ);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("NAV-A1: the shell reads the member's levels for the selected business", () => {
  it("NMS-07 asks my-access for the selected business, applies only its answer, and follows a switch; a failed read is unknown", async () => {
    const asked = serveAccess({
      [BIZ]: { status: 200, body: { modules: { crm: "read", bookings: "read", revenue: "none" } } },
      [OTHER]: { status: 503, body: { message: "Service Unavailable" } },
    });
    const { result } = renderHook(() => useMemberModuleLevels());
    expect(result.current, "unknown before the answer lands").toBeNull();
    await waitFor(() => expect(result.current).toEqual({ crm: "read", bookings: "read", revenue: "none" }));
    expect(asked).toContain(BIZ);

    act(() => {
      selectBusiness(OTHER);
    });
    // The previous business's answer never stands for this one; this one failed, so it is unknown.
    await waitFor(() => expect(asked).toContain(OTHER));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current).toBeNull();
  });
});

/* ───────────────────────────── the surfaces ───────────────────────────── */

const noop = () => {};

describe("NAV-A1: the surfaces as a member sees them", () => {
  it("NMS-08 the phone's bottom bar for a products business reads Today, Sales, New, Customers, More; New opens the New menu, More the drawer", () => {
    serveAccess({});
    const openNew = vi.fn();
    const openDrawer = vi.fn();
    render(
      createElement(MobileBottomNavV2, {
        pathname: "/app/command-center",
        mobileDrawerOpen: false,
        setMobileDrawerOpen: openDrawer,
        notifOpen: false,
        setNotifOpen: noop,
        unreadCount: 0,
        setAddMenuOpen: openNew,
        bottomBarHubs: bottomBarFor("products", null),
      } as never),
    );
    const bar = screen.getByRole("navigation", { name: "Mobile navigation" });
    const names = Array.from(bar.querySelectorAll("a, button"))
      .map((e) => (e.getAttribute("aria-label") || e.textContent || "").replace(/[^A-Za-z ]/g, "").trim())
      .filter(Boolean);
    expect(names).toEqual(["Today", "Sales", "New", "Customers", "More"]);
    expect(within(bar).getByRole("link", { name: "Today" }).getAttribute("href")).toBe("/app/command-center");
    expect(within(bar).getByRole("link", { name: "Sales" }).getAttribute("href")).toBe("/app/commerce");
    expect(within(bar).getByRole("link", { name: "Customers" }).getAttribute("href")).toBe("/app/crm/contacts");
    expect(within(bar).getByRole("link", { name: "Today" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(within(bar).getByRole("button", { name: "New" }));
    expect(openNew).toHaveBeenCalledWith(true);
    fireEvent.click(within(bar).getByRole("button", { name: "More" }));
    expect(openDrawer).toHaveBeenCalledWith(true);
  });

  const sidebar = (hubs: ReturnType<typeof hubsFor>) =>
    render(
      createElement(DesktopSidebar, {
        drawerSurface: null,
        setDrawerSurface: noop,
        isPrimaryActive: () => false,
        visibleHubs: hubs,
        visibleOperateSections: [],
        visibleBuildSections: [],
        visibleMoreNav: [],
        meNav: [],
        isSecondaryActive: () => false,
        isFeatureLocked: () => false,
        connectorAlertCount: 0,
        isAdminUser: false,
        setKfStoreOpen: noop,
      } as never),
    );

  it("NMS-09 the desktop menu shows the hubs as plain-labelled links; a products business names no Schedule", () => {
    serveAccess({});
    sidebar(hubsFor("products", OWNER));
    const menu = screen.getByRole("navigation", { name: "Main navigation" });
    for (const name of ["Today", "Customers", "Sales", "Money", "Your page", "Settings"]) {
      expect(within(menu).getByRole("link", { name }), name).toBeTruthy();
    }
    expect(within(menu).queryAllByText(/^Schedule$/)).toHaveLength(0);
    expect(within(menu).getByRole("button", { name: "More" })).toBeTruthy();
  });

  it("NMS-09b a front-desk member's desktop menu offers Today, Customers and Schedule, and no other hub", () => {
    serveAccess({});
    sidebar(hubsFor("both", FRONT_DESK));
    const menu = screen.getByRole("navigation", { name: "Main navigation" });
    const names = within(menu)
      .getAllByRole("link")
      .map((a) => (a.getAttribute("aria-label") || a.textContent || "").trim());
    for (const hub of ["Today", "Customers", "Schedule"]) expect(names, hub).toContain(hub);
    for (const hub of [/^sales\b/i, /^money\b/i, /^settings\b/i, /^your page\b/i]) {
      expect(names.filter((n) => hub.test(n)), String(hub)).toEqual([]);
    }
  });
});
