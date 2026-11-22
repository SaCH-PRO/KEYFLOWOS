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
 *   NMS-10 review round 1 (COR-1): a screen with a module of its own (Expenses, Team) stays in More for a member who
 *          may open it even when they may not open its hub's page; the heading then opens nothing.
 *   NMS-11 review round 1 (SEC-1, SEC-2, COR-7): the levels belong to the member who read them (another member's
 *          sign-in in this browser is unknown until read for them), and they are read again when the tab is looked at.
 *   NMS-12 review round 1 (COR-2): while what the business sells is still loading, no hub that depends on it shows
 *          (no Schedule, no bar slots), so a products business never flashes the 'both' bar.
 *   NMS-13 review round 1 (COR-4, COR-6): aria-current is "page" only on the hub's own page ("true" inside the
 *          hub); the bar's New toggles the New menu.
 *   NMS-14 review round 2 (R2-COR-1, R2-COR-2): a failed re-read keeps the levels already known for the same member
 *          and business; looking again within BUSINESS_SETTINGS_FRESH_MS (30 s) of the last answer asks nothing.
 *   NMS-15 review round 3: a first read that failed is retried on the next look (only an answer with levels is
 *          fresh); a return to the tab (visibilitychange and focus together) sends one request (lib/api joins
 *          identical reads in flight).
 *   NMS-16 review round 4: a look while the tab is hidden asks nothing; a slow answer for a business left behind
 *          never stands for the one selected since; a clock stepped back counts the levels stale, not fresh.
 *   NMS-17 review round 5: another member's failed first read is never kept from the previous member's answer, so
 *          it is unknown and is asked again on the next look, inside the 30 s.
 *   NMS-18 orchestrator acceptance M1 (D-179 fully enforced): a legacy bookkeeper {revenue: write, expenses: write}
 *          with no operations entry sees none of Payroll, Approvals, Performance, Data Inbox, Inbox (KEY), Contracts
 *          or WhatsApp; and every nav entry names the module(s) its page's server reads require, cross-checked row by
 *          row against the controller's @RequireModuleScope (file:line), so an entry added without a row fails.
 *   NMS-09 the desktop menu (Main navigation) shows the hubs as links named by their plain labels, and a products
 *          business's menu names no Schedule (journey A4); a front-desk member's menu offers no Sales, Money, Your
 *          page or Settings hub (J5).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
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
  buildSections,
  entryModules,
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

  it("NMS-10 a screen with its own module stays in More when its hub's page is closed to the member", () => {
    const member = levels({ expenses: "write", team: "read" });
    expect(labelsOf(hubsFor("both", member))).toEqual(["Today"]);
    const { hubSections } = menuSectionsFor("both", member);
    const money = hubSections.find((s) => s.id === "money");
    // Budgets reads expense budgets (expenses read, acceptance M1's table), so it stays with Expenses.
    expect(money?.items.map((i) => i.label)).toEqual(["Expenses", "Budgets"]);
    expect(money?.href, "the Money heading opens nothing for a member who may not open Money").toBeUndefined();
    const settingsHub = hubSections.find((s) => s.id === "settings");
    expect(settingsHub?.items.map((i) => i.label)).toEqual(["Team", "Org chart"]);
    expect(settingsHub?.href).toBeUndefined();
    // A hub the member may open keeps its heading door.
    expect(menuSectionsFor("both", OWNER).hubSections.find((s) => s.id === "money")?.href).toBe("/app/financial-flow");
  });

  it("NMS-12 while sells is loading no sells-dependent hub shows", () => {
    expect(labelsOf(hubsFor(null, OWNER))).toEqual(["Today", "Customers", "Sales", "Money", "Your page", "Settings"]);
    expect(bottomBarFor(null, OWNER)).toEqual([]);
    expect(menuSectionsFor(null, OWNER).hubSections.map((s) => s.id)).not.toContain("schedule");
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


/* ───────────────────────── every entry's module, cited (acceptance M1) ───────────────────────── */

/**
 * The module(s) each nav entry needs, and why. A citation is a server handler (apps/server/src path:line of the
 * @Get its page's main read calls), checked below to carry @RequireModuleScope of that module; "hub:<id>" for an
 * entry whose page's reads carry no module scope, so it takes its hub's (it is shown only inside a hub the member
 * may open); "D-179" for an operations or analytics surface the legacyaccess ruling keeps out of a menu without the
 * entry, even where its page's reads are not scoped. An entry with neither, outside a hub, needs no module.
 */
const SRV = (f: string, line: number) => `modules/${f}:${line}`;
const MODULE_TABLE: Record<string, { modules: string[]; cite: string[] }> = {
  // Hubs
  "/app/command-center": { modules: [], cite: ["unscoped:modules/business-command-center/business-command-center.controller.ts:25", "every member's home (D-96)"] },
  "/app/crm/contacts": { modules: ["crm"], cite: [SRV("crm/crm.controller.ts", 493)] },
  "/app/commerce": { modules: ["revenue"], cite: [SRV("commerce/commerce.controller.ts", 706)] },
  "/app/schedule/calendar": { modules: ["bookings"], cite: [SRV("calendar/calendar.controller.ts", 256)] },
  "/app/financial-flow": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", 359)] },
  "/app/store": { modules: ["storefront"], cite: ["unscoped:modules/bookings/bookings.controller.ts:358", "D-150 hub rule: no read route checks storefront; the hub follows the scope (J5)"] },
  "/app/settings/business": { modules: ["settings"], cite: ["unscoped:modules/identity/identity.controller.ts:858", "D-150 hub rule (J5); its writes need settings"] },
  // Customers
  "/app/crm/deals": { modules: ["crm"], cite: [SRV("crm/crm-deals.controller.ts", 216)] },
  "/app/crm/accounts": { modules: ["crm"], cite: [SRV("crm/crm-accounts.controller.ts", 22)] },
  "/app/people-flow": { modules: ["crm"], cite: ["unscoped:modules/people-flow/people-flow.controller.ts:18", "hub:customers"] },
  "/app/crm/sequences": { modules: ["crm"], cite: ["unscoped:modules/crm/crm-sequence.controller.ts:33", "hub:customers"] },
  "/app/helpdesk": { modules: ["crm"], cite: ["unscoped:modules/helpdesk/helpdesk.controller.ts:13", "hub:customers"] },
  "/app/call-tasks": { modules: ["crm"], cite: [SRV("call-tasks/call-task.controller.ts", 95)] },
  "/app/crm/intelligence": { modules: ["crm"], cite: [SRV("crm/crm.controller.ts", 1108)] },
  "/app/crm/data-quality": { modules: ["crm"], cite: [SRV("crm/crm.controller.ts", 865)] },
  "/app/crm/duplicates": { modules: ["crm"], cite: [SRV("crm/crm.controller.ts", 1558)] },
  "/app/crm/network": { modules: ["crm"], cite: [SRV("crm/crm.controller.ts", 338)] },
  "/app/crm/dashboard": { modules: ["crm"], cite: [SRV("crm/crm.controller.ts", 493)] },
  "/app/sales-team": { modules: ["crm", "revenue"], cite: ["unscoped:modules/conversion/conversion.controller.ts:67", "data:modules/conversion/sales-team.service.ts:80:revenue revenueAttributed, the PAID invoice totals per rep (security review: the route itself carries no scope)", "hub:customers"] },
  // Sales
  "/app/commerce/invoices": { modules: ["revenue"], cite: [SRV("commerce/commerce.controller.ts", 706)] },
  "/app/inventory": { modules: ["revenue"], cite: [SRV("commerce/commerce.controller.ts", 300)] },
  "/app/commerce/gateway": { modules: ["revenue"], cite: [SRV("payments/payments-ops.controller.ts", 78)] },
  // Schedule
  "/app/bookings": { modules: ["bookings"], cite: ["unscoped:modules/bookings/bookings.controller.ts:101", "hub:schedule"] },
  "/app/temporal-flow": { modules: ["bookings"], cite: ["unscoped:modules/temporal-flow/temporal-flow.controller.ts:34", "hub:schedule"] },
  // Money
  "/app/payments": { modules: ["revenue"], cite: [SRV("payments/payments-ops.controller.ts", 90)] },
  "/app/money/expenses": { modules: ["expenses"], cite: [SRV("expenses/expenses.controller.ts", 20)] },
  "/app/procurement": { modules: ["operations"], cite: [SRV("procurement/procurement.controller.ts", 30)] },
  "/app/retainers": { modules: ["revenue"], cite: ["unscoped:modules/retainers/retainer.controller.ts:151", "hub:money"] },
  "/app/budgeting": { modules: ["expenses"], cite: [SRV("expenses/expenses.controller.ts", 243)] },
  "/app/payroll": { modules: ["operations"], cite: [SRV("payroll/payroll.controller.ts", 22)] },
  "/app/reports": { modules: ["revenue", "analytics"], cite: [SRV("reports/reports.controller.ts", 56), "D-179"] },
  "/app/finance/settings": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", 611)] },
  "/app/finance/reconciliation": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", 466)] },
  "/app/finance/tax": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", 1101)] },
  "/app/finance/accounting-periods": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", 1575)] },
  "/app/finance/ledger": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", 236)] },
  "/app/finance/journal": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", 191)] },
  "/app/finance/trial-balance": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", 265)] },
  "/app/finance/recurring-journals": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", 756)] },
  "/app/finance/fixed-assets": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", 1742)] },
  "/app/finance/bank-rules": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", 662)] },
  "/app/finance/credit-notes": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", 1493)] },
  "/app/finance/exchange-rates": { modules: ["revenue"], cite: ["unscoped:modules/finance/finance.controller.ts:1698", "hub:money"] },
  "/app/money/books": { modules: ["revenue"], cite: [SRV("commerce/accounting.controller.ts", 61)] },
  // Your page
  "/app/presence": { modules: ["storefront"], cite: ["unscoped:modules/site/presence/presence.controller.ts:79", "hub:page"] },
  "/app/portal": { modules: ["storefront"], cite: ["unscoped:modules/portal/portal.controller.ts:29", "hub:page"] },
  // Settings
  "/app/profile": { modules: ["settings"], cite: ["unscoped:modules/identity/identity.controller.ts:858", "hub:settings"] },
  "/app/genome": { modules: ["settings"], cite: ["unscoped:modules/business-genome/key-genome/key-genome.controller.ts:248", "hub:settings"] },
  "/app/settings/billing": { modules: ["settings"], cite: ["unscoped:modules/subscriptions/subscriptions.controller.ts:36", "hub:settings"] },
  "/app/settings/team": { modules: ["team"], cite: [SRV("identity/identity.controller.ts", 1255)] },
  "/app/structure": { modules: ["team"], cite: [SRV("structure/structure.controller.ts", 180)] },
  "/app/settings/ai": { modules: ["operations"], cite: [SRV("ai/ai-settings.controller.ts", 33)] },
  "/app/settings/compliance": { modules: ["settings"], cite: ["unscoped:modules/communications/omnichannel.controller.ts:253", "hub:settings"] },
  "/app/settings/developers": { modules: ["settings"], cite: [SRV("api-keys/api-keys.controller.ts", 25)] },
  "/app/key-connect": { modules: ["settings"], cite: ["unscoped:core/connectors/connector.controller.ts:156", "hub:settings"] },
  "/app/templates": { modules: ["settings"], cite: ["unscoped:modules/templates/templates.controller.ts:13", "hub:settings"] },
  "/app/trash": { modules: ["settings"], cite: ["hub:settings", "service-check:modules/trash/trash.controller.ts:325"] },
  // KEY
  "/app/key/chat": { modules: [], cite: ["unscoped:modules/ai/flow.controller.ts:99"] },
  "/app/key-inbox": { modules: ["operations"], cite: [SRV("key-inbox/key-inbox.controller.ts", 125)] },
  "/app/key": { modules: [], cite: ["unscoped:modules/ai/ai.controller.ts:1643"] },
  "/app/key-autonomy": { modules: [], cite: ["unscoped:modules/key-autonomy/key-action-proposal.controller.ts:36"] },
  "/app/key-modes": { modules: [], cite: ["unscoped:modules/intelligence/key-executive-mode.controller.ts:14"] },
  "/app/data-inbox": { modules: ["operations"], cite: [SRV("ingestion/data-inbox.controller.ts", 23)] },
  "/app/capture": { modules: [], cite: ["unscoped:modules/device/device.controller.ts:48"] },
  // Work
  "/app/work/projects": { modules: ["projects"], cite: [SRV("projects/projects.controller.ts", 43)] },
  "/app/approvals": { modules: ["operations"], cite: [SRV("ai/ai-approvals.controller.ts", 54), "D-179"] },
  "/app/performance": { modules: ["operations"], cite: [SRV("staff-performance/staff-performance.controller.ts", 30)] },
  "/app/time-tracking": { modules: ["projects"], cite: [SRV("projects/projects.controller.ts", 43)] },
  "/app/operations": { modules: ["operations"], cite: ["unscoped:modules/content-ops/content-ops.controller.ts:68", "D-179"] },
  "/app/operations-flow": { modules: ["operations"], cite: ["unscoped:modules/sop/sop.controller.ts:13", "D-179"] },
  "/app/change-orders": { modules: [], cite: ["unscoped:modules/change-orders/change-order.controller.ts:111"] },
  // Marketing
  "/app/communicate/campaigns": { modules: [], cite: ["unscoped:modules/email-marketing/email-marketing.controller.ts:18"] },
  "/app/marketing/lists": { modules: ["content"], cite: [SRV("email-marketing/marketing-sync.controller.ts", 53)] },
  "/app/marketing/case-studies": { modules: [], cite: ["unscoped:modules/site/site.controller.ts:688"] },
  "/app/content-ops": { modules: [], cite: ["unscoped:modules/content-ops/content-ops.controller.ts:68"] },
  "/app/social": { modules: [], cite: ["unscoped:modules/social/social.controller.ts:325"] },
  "/app/seo": { modules: [], cite: ["unscoped:modules/seo/seo.controller.ts:71"] },
  "/app/events": { modules: [], cite: ["unscoped:modules/events/events.controller.ts:41"] },
  "/app/whatsapp": { modules: ["operations"], cite: [SRV("whatsapp/whatsapp.controller.ts", 166)] },
  "/app/marketing-flow": { modules: [], cite: ["unscoped:modules/marketing/marketing.controller.ts:13"] },
  // Legal
  "/app/evidence": { modules: [], cite: ["unscoped:modules/evidence/evidence.controller.ts:53"] },
  "/app/contracts": { modules: ["operations"], cite: [SRV("contracts/contracts.controller.ts", 28)] },
  "/app/legal": { modules: [], cite: ["unscoped:modules/blueprint/blueprint.controller.ts:14"] },
  // Strategy
  "/app/intelligence": { modules: [], cite: ["unscoped:modules/intelligence/business-intelligence.controller.ts:14"] },
  "/app/goals": { modules: [], cite: ["unscoped:modules/key-cortex/key-cortex-goals.controller.ts:233"] },
  "/app/market": { modules: [], cite: ["unscoped:modules/business-genesis/business-genesis.controller.ts:99"] },
  // Automate
  "/app/flows": { modules: ["automations"], cite: [SRV("flow/flow.controller.ts", 206)] },
  "/app/automations": { modules: [], cite: ["unscoped:modules/automation/automation.controller.ts:30"] },
  "/app/key-flows": { modules: [], cite: ["unscoped:modules/flow-signal/flow-signal-role.controller.ts:14"] },
  "/app/assets": { modules: ["content"], cite: [SRV("assets/asset.controller.ts", 48)] },
};

describe("NAV-A1 acceptance M1: every nav entry needs what its page's server reads need", () => {
  const SERVER_SRC = path.join(__dirname, "..", "..", "..", "..", "server", "src");
  const entries = () => [
    ...hubNav.map((hub) => ({ href: hub.href, modules: hub.module ? [hub.module] : [] })),
    ...hubNav.flatMap((hub) => hub.items.map((item) => ({ href: item.href, modules: entryModules(item, hub) }))),
    ...buildSections.flatMap((s) => s.items.map((item) => ({ href: item.href, modules: entryModules(item) }))),
  ];

  it("NMS-18 a legacy bookkeeper with no operations entry sees none of the operations surfaces", () => {
    const bookkeeper = levels({ revenue: "write", expenses: "write" });
    const { hubSections, moreSections } = menuSectionsFor("both", bookkeeper);
    const shown = [...hubSections, ...moreSections].flatMap((s) => s.items.map((i) => i.href));
    for (const href of ["/app/payroll", "/app/approvals", "/app/performance", "/app/data-inbox", "/app/key-inbox", "/app/contracts", "/app/whatsapp"]) {
      expect(shown, href).not.toContain(href);
    }
    // The rest of Money stays for them.
    expect(shown).toContain("/app/money/expenses");
    expect(shown).toContain("/app/budgeting");
  });

  it("NMS-18 every nav entry has a row, and names exactly the row's modules", () => {
    const seen = entries();
    const missing = seen.filter((e) => !(e.href in MODULE_TABLE)).map((e) => e.href);
    expect(missing, "a nav entry with no row: add one citing the controller its page reads").toEqual([]);
    const wrong = seen
      .filter((e) => JSON.stringify([...e.modules].sort()) !== JSON.stringify([...MODULE_TABLE[e.href].modules].sort()))
      .map((e) => `${e.href}: nav ${JSON.stringify(e.modules)} vs table ${JSON.stringify(MODULE_TABLE[e.href].modules)}`);
    expect(wrong).toEqual([]);
    const stale = Object.keys(MODULE_TABLE).filter((h) => !seen.some((e) => e.href === h));
    expect(stale, "rows for entries that left the nav").toEqual([]);
  });

  it("NMS-18 every row is a checked claim: each module justified, each citation true", () => {
    /** The decorators stacked on the @Get at `at` (0-based), its own line included. */
    const decorators = (lines: string[], at: number) => {
      const block: string[] = [lines[at]];
      for (let i = at - 1; i >= 0 && /^\s*@/.test(lines[i]); i--) block.push(lines[i]);
      for (let i = at + 1; i < lines.length && /^\s*@/.test(lines[i]); i++) block.push(lines[i]);
      return block.join("\n");
    };
    const at = (file: string, line: number) => {
      const lines = fs.readFileSync(path.join(SERVER_SRC, file), "utf8").split("\n");
      return { lines, i: line - 1 };
    };
    const bad: string[] = [];
    for (const [href, row] of Object.entries(MODULE_TABLE)) {
      if (row.cite.length === 0) bad.push(`${href}: no reason`);
      const justified = new Set<string>();
      for (const cite of row.cite) {
        let m: RegExpExecArray | null;
        if ((m = /^((?:modules|core)\/[^:]+\.ts):(\d+)$/.exec(cite))) {
          const { lines, i } = at(m[1], Number(m[2]));
          if (!/@Get\(/.test(lines[i] ?? "")) bad.push(`${href}: ${cite} is not a @Get`);
          const scoped = [...decorators(lines, i).matchAll(/RequireModuleScope\(\s*'([a-z]+)'/g)].map((x) => x[1]);
          if (!scoped.some((mod) => row.modules.includes(mod))) bad.push(`${href}: ${cite} scopes ${JSON.stringify(scoped)}`);
          scoped.forEach((mod) => justified.add(mod));
        } else if ((m = /^unscoped:((?:modules|core)\/[^:]+\.ts):(\d+)$/.exec(cite))) {
          const { lines, i } = at(m[1], Number(m[2]));
          if (!/@Get\(/.test(lines[i] ?? "")) bad.push(`${href}: ${cite} is not a @Get`);
          if (/RequireModuleScope\(/.test(decorators(lines, i))) bad.push(`${href}: ${cite} is scoped`);
        } else if ((m = /^hub:([a-z]+)$/.exec(cite))) {
          const hub = hubNav.find((h) => h.id === m![1]);
          if (!hub || !hub.items.some((item) => item.href === href)) bad.push(`${href}: not in hub ${m[1]}`);
          else if (hub.module) justified.add(hub.module);
        } else if ((m = /^data:((?:modules|core)\/[^:]+\.ts):(\d+):([a-z]+) /.exec(cite))) {
          const { lines, i } = at(m[1], Number(m[2]));
          if (!(lines[i] ?? "").trim()) bad.push(`${href}: ${cite} points at nothing`);
          justified.add(m[3]);
        } else if ((m = /^service-check:((?:modules|core)\/[^:]+\.ts):(\d+)$/.exec(cite))) {
          const { lines, i } = at(m[1], Number(m[2]));
          if (!/@Get\(/.test(lines[i] ?? "")) bad.push(`${href}: ${cite} is not a @Get`);
        } else if (/^D-\d+/.test(cite) || /\bD-\d+\b/.test(cite)) {
          row.modules.forEach((mod) => justified.add(mod));
        } else {
          bad.push(`${href}: unknown citation ${cite}`);
        }
      }
      for (const mod of row.modules) if (!justified.has(mod)) bad.push(`${href}: ${mod} is not justified`);
      if (row.modules.length === 0 && !row.cite.some((c) => c.startsWith("unscoped:") || /\bD-\d+/.test(c))) {
        bad.push(`${href}: no module, and no unscoped read or ruling cited`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("NMS-18 a member with customers read and no revenue is not offered Rep performance (its read answers revenue per rep)", () => {
    const { hubSections } = menuSectionsFor("both", levels({ crm: "read" }));
    const shown = hubSections.flatMap((s) => s.items.map((i) => i.href));
    expect(shown).not.toContain("/app/sales-team");
    expect(shown).toContain("/app/crm/deals");
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
        // 404, not 503: lib/api retries a 503 with a backoff, and a retry landing in a later case would count there
        // (review round 4).
        const a = answers[id] ?? { status: 404, body: { message: "Not Found" } };
        return jsonResponse(a.status, a.body);
      }
      return jsonResponse(404, { message: "Not Found" });
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
      [OTHER]: { status: 404, body: { message: "Not Found" } },
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

/** Only this business's reads count (review round 4). */
const bizAsks = (asked: string[]) => asked.filter((id) => id === BIZ).length;

/** A session token naming `sub` (lib/business-settings reads the subject; nothing verifies it here). */
const tokenFor = (sub: string) => `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, "")}.s`;

describe("NAV-A1 review round 1: the levels belong to the member who read them", () => {
  it("NMS-11 another member signing in here is unknown until read for them; the tab looked at again reads again", async () => {
    window.localStorage.setItem("kf_token", tokenFor("usr_a"));
    const asked = serveAccess({ [BIZ]: { status: 200, body: { modules: { crm: "read", revenue: "none" } } } });
    const { result } = renderHook(() => useMemberModuleLevels());
    await waitFor(() => expect(result.current).toEqual({ crm: "read", revenue: "none" }));
    expect(bizAsks(asked)).toBe(1);

    // Another member's session in this browser (another tab signed in): the first member's levels are not theirs.
    act(() => {
      window.localStorage.setItem("kf_token", tokenFor("usr_b"));
      window.dispatchEvent(new StorageEvent("storage", { key: "kf_token" }));
    });
    expect(result.current, "the previous member's levels never stand for the next").toBeNull();
    await waitFor(() => expect(bizAsks(asked)).toBe(2));
    await waitFor(() => expect(result.current).toEqual({ crm: "read", revenue: "none" }));

    // The owner changed this member's scopes elsewhere: looking at the tab again, once the answer is no longer
    // fresh, reads again.
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(bizAsks(asked)).toBe(3));
  });

  it("NMS-14 a failed re-read keeps the levels known; a look within 30 s asks nothing", async () => {
    window.localStorage.setItem("kf_token", tokenFor("usr_a"));
    const answers: Record<string, { status: number; body: unknown }> = {
      [BIZ]: { status: 200, body: { modules: { crm: "read", revenue: "none" } } },
    };
    const asked = serveAccess(answers);
    const { result } = renderHook(() => useMemberModuleLevels());
    await waitFor(() => expect(result.current).toEqual({ crm: "read", revenue: "none" }));

    // Looked at again at once: still fresh, nothing asked.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(bizAsks(asked)).toBe(1);

    // Later, the re-read is refused (403, which lib/api does not retry; it is also what a removed member gets): what
    // is known for this member and business stays.
    answers[BIZ] = { status: 403, body: { statusCode: 403, message: "No access to this business", error: "Forbidden" } };
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(bizAsks(asked)).toBe(2));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(result.current).toEqual({ crm: "read", revenue: "none" });
  });

  it("NMS-15 a failed first read is retried on the next look; a return to the tab sends one request", async () => {
    window.localStorage.setItem("kf_token", tokenFor("usr_a"));
    const answers: Record<string, { status: number; body: unknown }> = {
      [BIZ]: { status: 403, body: { statusCode: 403, message: "Unable to verify business access", error: "Forbidden" } },
    };
    const asked = serveAccess(answers);
    const { result } = renderHook(() => useMemberModuleLevels());
    await waitFor(() => expect(bizAsks(asked)).toBe(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(result.current).toBeNull();

    // Looked at again at once: nothing was known, so it asks again.
    answers[BIZ] = { status: 200, body: { modules: { crm: "read" } } };
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current).toEqual({ crm: "read" }));
    expect(bizAsks(asked)).toBe(2);

    // Later, a return to the tab fires visibilitychange and focus together: one ask.
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(bizAsks(asked)).toBeGreaterThanOrEqual(3));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(bizAsks(asked)).toBe(3);
  });
  it("NMS-16 a hidden tab asks nothing; a slow answer for a business left behind never stands; a clock stepped back is stale", async () => {
    window.localStorage.setItem("kf_token", tokenFor("usr_a"));
    let releaseSlow!: () => void;
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const m = /\/identity\/businesses\/([^/]+)\/my-access$/.exec(new URL(url, "http://localhost").pathname);
        if (!m) return jsonResponse(404, { message: "Not Found" });
        const id = decodeURIComponent(m[1]);
        asked.push(id);
        if (id === BIZ && asked.filter((x) => x === BIZ).length === 1) {
          // The first read of BIZ is slow: it lands after the switch to OTHER.
          await new Promise<void>((r) => (releaseSlow = r));
          return jsonResponse(200, { modules: { crm: "admin", revenue: "admin" } });
        }
        return jsonResponse(200, { modules: id === OTHER ? { crm: "read", revenue: "none" } : { crm: "admin" } });
      }),
    );
    const { result } = renderHook(() => useMemberModuleLevels());
    await waitFor(() => expect(asked).toContain(BIZ));
    act(() => {
      selectBusiness(OTHER);
    });
    await waitFor(() => expect(result.current).toEqual({ crm: "read", revenue: "none" }));
    await act(async () => {
      releaseSlow();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(result.current, "the business left behind does not overwrite the one selected").toEqual({ crm: "read", revenue: "none" });

    // A look while the tab is hidden asks nothing, even when the levels are no longer fresh.
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    const before = asked.length;
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(asked.length).toBe(before);
    visibility.mockRestore();

    // The clock stepped back past the last answer: the levels are stale, so the next look asks.
    clock.mockReturnValue(now - 120_000);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(asked.length).toBe(before + 1));
  });
  it("NMS-17 another member's failed first read is unknown and asked again on the next look", async () => {
    window.localStorage.setItem("kf_token", tokenFor("usr_a"));
    const answers: Record<string, { status: number; body: unknown }> = {
      [BIZ]: { status: 200, body: { modules: { crm: "admin", revenue: "admin" } } },
    };
    const asked = serveAccess(answers);
    const { result } = renderHook(() => useMemberModuleLevels());
    await waitFor(() => expect(result.current).toEqual({ crm: "admin", revenue: "admin" }));

    // Member B signs in here and their first read is refused (403, not retried).
    answers[BIZ] = { status: 403, body: { statusCode: 403, message: "Unable to verify business access", error: "Forbidden" } };
    act(() => {
      window.localStorage.setItem("kf_token", tokenFor("usr_b"));
      window.dispatchEvent(new StorageEvent("storage", { key: "kf_token" }));
    });
    await waitFor(() => expect(bizAsks(asked)).toBe(2));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(result.current).toBeNull();

    // At once (well inside A's 30 s), B looks again: nothing is fresh for B, so it asks.
    answers[BIZ] = { status: 200, body: { modules: { crm: "read" } } };
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current).toEqual({ crm: "read" }));
    expect(bizAsks(asked)).toBe(3);
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
    // NMS-13: New toggles the New menu.
    const toggle = openNew.mock.calls[0][0] as (v: boolean) => boolean;
    expect(typeof toggle).toBe("function");
    expect([toggle(false), toggle(true)]).toEqual([true, false]);
    fireEvent.click(within(bar).getByRole("button", { name: "More" }));
    expect(openDrawer).toHaveBeenCalledWith(true);
  });

  it("NMS-13 aria-current is page only on the hub's own page, true elsewhere inside the hub", () => {
    serveAccess({});
    const bar = (pathname: string) =>
      render(
        createElement(MobileBottomNavV2, {
          pathname,
          mobileDrawerOpen: false,
          setMobileDrawerOpen: noop,
          notifOpen: false,
          setNotifOpen: noop,
          unreadCount: 0,
          setAddMenuOpen: noop,
          bottomBarHubs: bottomBarFor("products", null),
        } as never),
      );
    const first = bar("/app/inventory");
    expect(screen.getByRole("link", { name: "Sales" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("link", { name: "Today" }).getAttribute("aria-current")).toBeNull();
    first.unmount();
    const second = bar("/app/commerce");
    expect(screen.getByRole("link", { name: "Sales" }).getAttribute("aria-current")).toBe("page");
    second.unmount();
    // Orchestrator acceptance m5: /app is Today's own page (it lands on /app/command-center), so "page", not "true".
    bar("/app");
    expect(screen.getByRole("link", { name: "Today" }).getAttribute("aria-current")).toBe("page");
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
