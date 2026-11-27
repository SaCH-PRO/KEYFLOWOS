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
 *          row against the cited controller's @RequireModuleScope, so an entry added without a row fails. A claim
 *          names the controller file and the route (GET + declared path, with its class when ambiguous) or an
 *          identifier, never a line (beside hub:<id> and D-<n> ruling claims), and the checker reads the file through
 *          the TypeScript parser: it fails when the route is missing or ambiguous, the handler's scopes are not all
 *          among the row's modules, a scoped handler has no ModuleScopeGuard in @UseGuards (on it or its controller),
 *          or a tracked identifier disappears; and it fails closed on anything in a cited file it cannot read with
 *          certainty (see unreadable, unreadableFile, findRoute, scopeEnforced).
 *          Documented limits (orchestrator ruling 2026-11-23): NMS-18 does not read (1) code defined in another file
 *          (an imported decorator's, class's or function's definition, which may run at load) or (2) metadata written
 *          inside a function or method body when it runs, nor (3) the body of a pinned ModuleScopeGuard subclass
 *          (SCOPE_GUARD_SUBCLASSES, each a review decision). The server guard is the boundary; FU-NMS-SERVER-METADATA
 *          (a server spec reading MODULE_SCOPE_KEY and the route table from the compiled controllers for every cited
 *          route) is the follow-up that holds both.
 *   NMS-09 the desktop menu (Main navigation) shows the hubs as links named by their plain labels, and a products
 *          business's menu names no Schedule (journey A4); a front-desk member's menu offers no Sales, Money, Your
 *          page or Settings hub (J5).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import ts from "typescript";
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
  meNav,
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
      // NAV-A2: /app/money and /app/settings are real indexes (they only forwarded before).
      "/app/money",
      "/app/store",
      "/app/settings",
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
    expect(menuSectionsFor("both", OWNER).hubSections.find((s) => s.id === "money")?.href).toBe("/app/money");
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
 * The module(s) each nav entry needs, and why. Every row is a claim the test below checks. Claims locate server code
 * by what it declares, never by line, so other packets moving lines cannot break them (wave 3f). Citations (paths
 * under apps/server/src):
 *   "<path>#[<Class> ]GET <route>"     the @Get('<route>') its page's main read calls (inside controller <Class> when the
 *                                      file has two such routes), whose decorator block carries @RequireModuleScope of
 *                                      modules the row names (and no others);
 *   "unscoped:<path>#[<Class> ]GET <route>"   a read its page calls that carries no module scope;
 *   "service-check:<path>#[<Class> ]GET <route>"   a read that filters or withholds by the member's levels itself;
 *   "hub:<id>"                         the hub that holds the entry, whose module the row then names;
 *   "data:<path>:<module> <identifier> ..."   server code (the identifier must be in that file) showing an unscoped
 *                                      read answers that module's data; the row must name the module;
 *   "D-<n>:<module> ..."               an owner ruling justifying that module (D-<n> alone: beside the unscoped read
 *                                      of a row with no module);
 *   "tracked:<path>:<module> <identifier> <FU-packet> ..."   a pre-existing server exposure tracked in a follow-up
 *                                      server packet, with the nav left as it is by the orchestrator's decision of
 *                                      2026-11-22 (D-100). It justifies nothing; the identifier must still be in the file.
 * A route that is missing or ambiguous fails. Each module a row names must be justified; a row with no module cites
 * the unscoped read it rests on.
 */
const SRV = (f: string, route: string) => `modules/${f}#${route}`;
const MODULE_TABLE: Record<string, { modules: string[]; cite: string[] }> = {
  // Hubs
  "/app/command-center": { modules: [], cite: ["unscoped:modules/business-command-center/business-command-center.controller.ts#GET snapshot", "D-96 every member's home"] },
  "/app/crm/contacts": { modules: ["crm"], cite: [SRV("crm/crm.controller.ts", "GET businesses/:businessId/contacts")] },
  "/app/commerce": { modules: ["revenue"], cite: [SRV("commerce/commerce.controller.ts", "GET businesses/:businessId/invoices")] },
  "/app/schedule/calendar": { modules: ["bookings"], cite: [SRV("calendar/calendar.controller.ts", "GET businesses/:businessId/events")] },
  // NAV-A2: the hubs' own pages are indexes. Each reads only the member's my-access (to offer the entries their modules
  // open); the hub's module is its rule (D-150, J5), and each entry's page carries its own row.
  "/app/money": { modules: ["revenue"], cite: ["unscoped:modules/identity/identity.controller.ts#GET businesses/:businessId/my-access", "D-150:revenue money hub rule (J5); the index offers each entry only when its own module is open"] },
  "/app/settings": { modules: ["settings"], cite: ["unscoped:modules/identity/identity.controller.ts#GET businesses/:businessId/my-access", "D-150:settings hub rule (J5); the index offers each entry only when its own module is open"] },
  "/app/financial-flow": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", "GET overview")] },
  // The store's analytics read withholds revenue below revenue read (FU-SITE-ANALYTICS-REVENUE-SCOPE, in wave 3f).
  "/app/store": { modules: ["storefront"], cite: ["unscoped:modules/bookings/bookings.controller.ts#GET businesses/:businessId/services", "D-150:storefront hub rule: no read route checks storefront; the hub follows the scope (J5)", "service-check:modules/site/site.controller.ts#GET businesses/:businessId/analytics"] },
  "/app/settings/business": { modules: ["settings"], cite: ["unscoped:modules/identity/identity.controller.ts#GET businesses/:businessId", "D-150:settings hub rule (J5); its writes need settings"] },
  // Customers
  "/app/crm/deals": { modules: ["crm"], cite: [SRV("crm/crm-deals.controller.ts", "GET businesses/:businessId/deals")] },
  "/app/crm/accounts": { modules: ["crm"], cite: [SRV("crm/crm-accounts.controller.ts", "GET businesses/:businessId/accounts")] },
  "/app/people-flow": { modules: ["crm"], cite: ["unscoped:modules/people-flow/people-flow.controller.ts#GET overview", "hub:customers"] },
  "/app/crm/sequences": { modules: ["crm"], cite: ["unscoped:modules/crm/crm-sequence.controller.ts#GET businesses/:businessId/sequences", "hub:customers"] },
  "/app/helpdesk": { modules: ["crm"], cite: ["unscoped:modules/helpdesk/helpdesk.controller.ts#GET businesses/:businessId/tickets", "hub:customers"] },
  "/app/call-tasks": { modules: ["crm"], cite: [SRV("call-tasks/call-task.controller.ts", "GET businesses/:businessId/calls")] },
  "/app/crm/intelligence": { modules: ["crm"], cite: [SRV("crm/crm.controller.ts", "GET businesses/:businessId/relationship-health/at-risk")] },
  "/app/crm/data-quality": { modules: ["crm"], cite: [SRV("crm/crm.controller.ts", "GET businesses/:businessId/data-quality/stats")] },
  "/app/crm/duplicates": { modules: ["crm"], cite: [SRV("crm/crm.controller.ts", "GET businesses/:businessId/duplicates")] },
  "/app/crm/network": { modules: ["crm"], cite: [SRV("crm/crm.controller.ts", "GET businesses/:businessId/network")] },
  "/app/crm/dashboard": { modules: ["crm"], cite: [SRV("crm/crm.controller.ts", "GET businesses/:businessId/contacts")] },
  "/app/sales-team": { modules: ["crm", "revenue"], cite: ["unscoped:modules/conversion/conversion.controller.ts#GET businesses/:businessId/sales-reps", "data:modules/conversion/sales-team.service.ts:revenue revenueAttributed, the PAID invoice totals per rep (security review: the route itself carries no scope)", "hub:customers", "tracked:modules/conversion/sales-team.service.ts:revenue revenueAttributed FU-CONVERSION-REPS-REVENUE pre-existing server exposure, tracked; nav unchanged by orchestrator decision 2026-11-22 under D-100"] },
  // Sales
  "/app/commerce/invoices": { modules: ["revenue"], cite: [SRV("commerce/commerce.controller.ts", "GET businesses/:businessId/invoices")] },
  "/app/inventory": { modules: ["revenue"], cite: [SRV("commerce/commerce.controller.ts", "GET businesses/:businessId/products")] },
  "/app/commerce/gateway": { modules: ["revenue"], cite: [SRV("payments/payments-ops.controller.ts", "GET gateways")] },
  // Schedule
  "/app/bookings": { modules: ["bookings"], cite: ["unscoped:modules/bookings/bookings.controller.ts#GET businesses/:businessId", "hub:schedule"] },
  "/app/temporal-flow": { modules: ["bookings"], cite: ["unscoped:modules/temporal-flow/temporal-flow.controller.ts#GET ", "hub:schedule", "tracked:modules/temporal-flow/temporal-flow-key-inbox.listener.ts:operations Analysis: FU-TEMPORAL-FLOW-INBOX-SCOPE pre-existing server exposure, tracked; nav unchanged by orchestrator decision 2026-11-22 under D-100"] },
  // Money
  "/app/payments": { modules: ["revenue"], cite: [SRV("payments/payments-ops.controller.ts", "GET transactions")] },
  "/app/money/expenses": { modules: ["expenses"], cite: [SRV("expenses/expenses.controller.ts", "GET businesses/:businessId/expenses")] },
  "/app/procurement": { modules: ["operations"], cite: [SRV("procurement/procurement.controller.ts", "GET businesses/:businessId")] },
  "/app/retainers": { modules: ["revenue"], cite: ["unscoped:modules/retainers/retainer.controller.ts#GET businesses/:businessId", "hub:money"] },
  "/app/budgeting": { modules: ["expenses"], cite: [SRV("expenses/expenses.controller.ts", "GET businesses/:businessId/expense-budgets")] },
  "/app/payroll": { modules: ["operations"], cite: [SRV("payroll/payroll.controller.ts", "GET rates")] },
  "/app/reports": { modules: ["revenue", "analytics"], cite: [SRV("reports/reports.controller.ts", "GET businesses/:businessId/reports/generate"), "D-179:analytics"] },
  "/app/finance/settings": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", "GET settings")] },
  "/app/finance/reconciliation": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", "GET accounts")] },
  "/app/finance/tax": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", "GET tax-liabilities")] },
  "/app/finance/accounting-periods": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", "GET accounting-periods")] },
  "/app/finance/ledger": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", "GET general-ledger")] },
  "/app/finance/journal": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", "GET journal-entries")] },
  "/app/finance/trial-balance": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", "GET trial-balance")] },
  "/app/finance/recurring-journals": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", "GET recurring-journal-entries")] },
  "/app/finance/fixed-assets": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", "GET fixed-assets")] },
  "/app/finance/bank-rules": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", "GET bank-rules")] },
  "/app/finance/credit-notes": { modules: ["revenue"], cite: [SRV("finance/finance.controller.ts", "GET credit-notes")] },
  "/app/finance/exchange-rates": { modules: ["revenue"], cite: ["unscoped:modules/finance/finance.controller.ts#GET exchange-rates", "hub:money"] },
  "/app/money/books": { modules: ["revenue"], cite: [SRV("commerce/accounting.controller.ts", "GET businesses/:businessId/summary")] },
  // Your page
  // Its overview (unscoped) answers kpis.revenue: every PAID invoice in the period plus store orders (security review
  // round 2), so it needs revenue as well as the hub's storefront.
  "/app/presence": { modules: ["storefront", "revenue"], cite: ["unscoped:modules/site/presence/presence.controller.ts#GET businesses/:businessId/overview", "data:modules/site/presence/presence-overview.service.ts:revenue invoicesRevenue, the PAID invoice totals in kpis.revenue", "hub:page", "tracked:modules/site/presence/presence-overview.service.ts:revenue invoicesRevenue FU-PRESENCE-REVENUE-SCOPE pre-existing server exposure, tracked; nav unchanged by orchestrator decision 2026-11-22 under D-100 (also the leads tab contact email and phone)"] },
  "/app/portal": { modules: ["storefront", "crm"], cite: [SRV("portal/portal.controller.ts", "GET businesses/:businessId/access"), "hub:page"] },
  // Settings
  "/app/profile": { modules: ["settings"], cite: ["unscoped:modules/identity/identity.controller.ts#GET businesses/:businessId", "hub:settings"] },
  "/app/genome": { modules: ["settings"], cite: ["unscoped:modules/business-genome/key-genome/key-genome.controller.ts#GET recommendations", "hub:settings"] },
  "/app/settings/billing": { modules: ["settings"], cite: ["unscoped:modules/subscriptions/subscriptions.controller.ts#GET businesses/:businessId/billing-dashboard", "hub:settings"] },
  // FU-ME-NOTIFICATIONS-SCOPE (D-276): the Me menu. My account is every member's own (GET identity/me); Notifications
  // is the business's customer emails and their log, both read under settings (P30's guard).
  "/app/settings/profile": { modules: [], cite: ["unscoped:modules/identity/identity.controller.ts#GET me"] },
  "/app/settings/notifications": { modules: ["settings"], cite: [SRV("notifications/notifications.controller.ts", "GET businesses/:businessId/customer-preferences"), SRV("notifications/notifications.controller.ts", "GET businesses/:businessId/customer-log")] },
  "/app/settings/team": { modules: ["team"], cite: [SRV("identity/identity.controller.ts", "GET businesses/:businessId/team/dashboard")] },
  "/app/structure": { modules: ["team"], cite: [SRV("structure/structure.controller.ts", "GET businesses/:businessId/stats")] },
  "/app/settings/ai": { modules: ["operations"], cite: [SRV("ai/ai-settings.controller.ts", "GET businesses/:businessId/ai/settings/workload-config")] },
  "/app/settings/compliance": { modules: ["settings"], cite: ["unscoped:modules/communications/omnichannel.controller.ts#GET consent", "hub:settings"] },
  "/app/settings/developers": { modules: ["settings"], cite: [SRV("api-keys/api-keys.controller.ts", "GET ")] },
  "/app/key-connect": { modules: ["settings"], cite: ["unscoped:core/connectors/connector.controller.ts#GET businesses/:businessId/dashboard", "hub:settings"] },
  "/app/templates": { modules: ["settings"], cite: ["unscoped:modules/templates/templates.controller.ts#GET templates", "hub:settings"] },
  "/app/trash": { modules: ["settings"], cite: ["hub:settings", "service-check:modules/trash/trash.controller.ts#GET "] },
  // KEY
  "/app/key/chat": { modules: [], cite: ["unscoped:modules/ai/flow.controller.ts#GET businesses/:businessId/flow/sessions"] },
  "/app/key-inbox": { modules: ["operations"], cite: [SRV("key-inbox/key-inbox.controller.ts", "GET threads")] },
  "/app/key": { modules: [], cite: ["unscoped:modules/ai/ai.controller.ts#GET businesses/:businessId/key/commands"] },
  "/app/key-autonomy": { modules: [], cite: ["unscoped:modules/key-autonomy/key-action-proposal.controller.ts#GET proposals", "tracked:modules/key-autonomy/genome-recommendation-action-bridge.service.ts:revenue rationale FU-KEY-ACTION-GENOME-PROJECTION pre-existing server exposure, tracked; nav unchanged by orchestrator decision 2026-11-22 under D-100"] },
  "/app/key-modes": { modules: [], cite: ["unscoped:modules/intelligence/key-executive-mode.controller.ts#GET "] },
  "/app/data-inbox": { modules: ["operations"], cite: [SRV("ingestion/data-inbox.controller.ts", "GET items")] },
  "/app/capture": { modules: [], cite: ["unscoped:modules/device/device.controller.ts#GET captures"] },
  // Work
  "/app/work/projects": { modules: ["projects"], cite: [SRV("projects/projects.controller.ts", "GET businesses/:businessId")] },
  // The manual tab's reads are unscoped; D-179 keeps this operations surface (its KEY tab reads ai-approvals,
  // operations) out of a menu without operations (orchestrator acceptance M1).
  "/app/approvals": { modules: ["operations"], cite: ["unscoped:modules/approvals/approval.controller.ts#GET businesses/:businessId/approvals", SRV("ai/ai-approvals.controller.ts", "GET items"), "D-179:operations"] },
  "/app/performance": { modules: ["operations"], cite: [SRV("staff-performance/staff-performance.controller.ts", "GET team-summary")] },
  // Its time-entry reads are unscoped; every entry is logged against a project, read through the projects picker.
  "/app/time-tracking": { modules: ["projects"], cite: ["unscoped:modules/time-tracking/time-entry.controller.ts#GET businesses/:businessId/running", SRV("projects/projects.controller.ts", "GET businesses/:businessId")] },
  "/app/operations": { modules: ["operations"], cite: ["unscoped:modules/content-ops/content-ops.controller.ts#GET businesses/:businessId/content-requests", "D-179:operations"] },
  "/app/operations-flow": { modules: ["operations"], cite: ["unscoped:modules/sop/sop.controller.ts#GET sops", "D-179:operations"] },
  // Its list (unscoped) answers each change order with its project's name, scope, amount and hours: project data, as
  // for Time tracking (security review round 3).
  "/app/change-orders": { modules: ["projects"], cite: ["unscoped:modules/change-orders/change-order.controller.ts#GET businesses/:businessId", "data:modules/change-orders/change-order.service.ts:projects project, the project's id and name on every row"] },
  // Marketing
  "/app/communicate/campaigns": { modules: [], cite: ["unscoped:modules/email-marketing/email-marketing.controller.ts#GET businesses/:businessId/campaigns"] },
  "/app/marketing/lists": { modules: ["content"], cite: [SRV("email-marketing/marketing-sync.controller.ts", "GET businesses/:businessId/lists")] },
  "/app/marketing/case-studies": { modules: ["revenue"], cite: ["unscoped:modules/site/site.controller.ts#GET businesses/:businessId/case-studies", "data:modules/site/case-study.service.ts:revenue recentRevenue, stored in metrics and answered by the list read", "tracked:modules/site/case-study.service.ts:revenue recentRevenue FU-CASE-STUDY-REVENUE pre-existing server exposure, tracked; nav unchanged by orchestrator decision 2026-11-22 under D-100"] },
  "/app/content-ops": { modules: [], cite: ["unscoped:modules/content-ops/content-ops.controller.ts#GET businesses/:businessId/content-requests"] },
  "/app/social": { modules: [], cite: ["unscoped:modules/social/social.controller.ts#GET businesses/:businessId/connections"] },
  "/app/seo": { modules: [], cite: ["unscoped:modules/seo/seo.controller.ts#GET businesses/:businessId/dashboard"] },
  "/app/events": { modules: [], cite: ["unscoped:modules/events/events.controller.ts#GET businesses/:businessId/events"] },
  "/app/whatsapp": { modules: ["operations"], cite: [SRV("whatsapp/whatsapp.controller.ts", "GET businesses/:businessId/status")] },
  "/app/marketing-flow": { modules: [], cite: ["unscoped:modules/marketing/marketing.controller.ts#GET campaigns"] },
  // Legal
  "/app/evidence": { modules: [], cite: ["unscoped:modules/evidence/evidence.controller.ts#GET businesses/:businessId/evidence"] },
  "/app/contracts": { modules: ["operations"], cite: [SRV("contracts/contracts.controller.ts", "GET ")] },
  "/app/legal": { modules: [], cite: ["unscoped:modules/blueprint/blueprint.controller.ts#GET "] },
  // Strategy
  "/app/intelligence": { modules: [], cite: ["unscoped:modules/intelligence/business-intelligence.controller.ts#GET executive-brief"] },
  "/app/goals": { modules: [], cite: ["unscoped:modules/key-cortex/key-cortex-goals.controller.ts#GET goals"] },
  "/app/market": { modules: [], cite: ["unscoped:modules/business-genesis/business-genesis.controller.ts#GET market-strategy"] },
  // Automate
  "/app/flows": { modules: ["automations"], cite: [SRV("flow/flow.controller.ts", "GET businesses/:businessId/flows")] },
  "/app/automations": { modules: [], cite: ["unscoped:modules/automation/automation.controller.ts#GET businesses/:businessId/playbooks"] },
  "/app/key-flows": { modules: [], cite: ["unscoped:modules/flow-signal/flow-signal-role.controller.ts#FlowSignalRoleController GET roles"] },
  "/app/assets": { modules: ["content"], cite: [SRV("assets/asset.controller.ts", "GET businesses/:businessId/assets")] },
};

describe("NAV-A1 acceptance M1: every nav entry needs what its page's server reads need", () => {
  const SERVER_SRC = path.join(__dirname, "..", "..", "..", "..", "server", "src");
  const entries = () => [
    ...hubNav.map((hub) => ({ href: hub.href, modules: hub.module ? [hub.module] : [] })),
    ...hubNav.flatMap((hub) => hub.items.map((item) => ({ href: item.href, modules: entryModules(item, hub) }))),
    ...buildSections.flatMap((s) => s.items.map((item) => ({ href: item.href, modules: entryModules(item) }))),
    // FU-ME-NOTIFICATIONS-SCOPE (D-276): the Me menu's entries are checked the same way.
    ...meNav.map((item) => ({ href: item.href, modules: entryModules(item) })),
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
    /**
     * Server code is read through the TypeScript parser (wave 3f closing reviews: a hand-rolled comment lexer kept
     * misreading regex literals and template strings). Comments are not in the syntax tree, so a commented-out route,
     * class, decorator or identifier never counts, and nothing the parser reads as code can be hidden.
     */
    const parsed = new Map<string, ts.SourceFile>();
    const parse = (file: string) => {
      let sf = parsed.get(file);
      if (!sf) {
        sf = ts.createSourceFile(file, fs.readFileSync(path.join(SERVER_SRC, file), "utf8"), ts.ScriptTarget.Latest, true);
        parsed.set(file, sf);
      }
      return sf;
    };
    /**
     * A decorator as a call: its name (the last part of a qualified callee such as Nest.Get), whether the callee was
     * qualified, and its first argument when that is a plain string ('' for no argument; null otherwise). Null when
     * the decorator is not a call of a name at all.
     */
    const unparen = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? unparen(e.expression) : e);
    const decoratorCall = (d: ts.Decorator): { name: string; qualified: boolean; arg: string | null } | null => {
      const e = unparen(d.expression);
      if (!ts.isCallExpression(e)) return null;
      const callee = unparen(e.expression);
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      if (name === null) return null;
      const first = e.arguments[0];
      const arg = !first ? "" : ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first) ? first.text : null;
      return { name, qualified: !ts.isIdentifier(callee), arg };
    };
    const decoratorsOf = (node: ts.Node) => (ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : []);
    /**
     * The route a claim names: the class member decorated @Get('<route>') (an empty route is @Get() or @Get('')),
     * inside the class `cls` when one is named. Every class in the file is searched, nested and expression classes
     * included: exactly one match must exist, and it must be in a top-level named class; anything else fails.
     */
    /** Names that register a route; each may only be a decorator's own callee (RequestMapping not at all). */
    const VERBS = new Set(["Get", "Post", "Put", "Patch", "Delete", "All", "Head", "Options"]);
    /** A controller's own path ('' for @Controller()); the class must carry exactly one plain @Controller('<literal>'). */
    const controllerPath = (cls: ts.ClassDeclaration) => decoratorsOf(cls).map(decoratorCall).find((c) => c?.name === "Controller")?.arg ?? "";
    /**
     * Why the class that owns a cited route cannot be read with certainty (closing review round 4): it must carry a
     * plain @Controller with a literal path, and every class decorator must be a plain name in CLASS_DECORATORS.
     */
    const controllerWhy = (cls: ts.ClassDeclaration): string | null => {
      const calls = decoratorsOf(cls).map((d) => ({ d, call: decoratorCall(d) }));
      const ctl = calls.filter(({ call }) => call?.name === "Controller");
      if (ctl.length !== 1) return `${cls.name?.text ?? "class"} is not a plain @Controller`;
      if (cls.heritageClauses?.length) return `${cls.name?.text} extends or implements something (inherited metadata is not read)`;
      if (ctl[0].call!.arg === null) return `non-literal controller path ${ctl[0].d.getText()}`;
      for (const { d, call } of calls) {
        if (!call || call.qualified || !CLASS_DECORATORS.has(call.name)) return `unlisted class decorator ${d.getText()} on ${cls.name?.text}`;
      }
      return null;
    };
    /**
     * Route segments, compared as Express does (case-insensitively). A segment that can span several segments or none
     * (a wildcard, optional braces, a group) makes the path unread: it is taken to match anything. Any other segment
     * that is not plain text (a :param, a param inside a segment) matches any one segment (correctness review round 6).
     */
    const segments = (p: string) => p.toLowerCase().split("/").filter(Boolean);
    const plain = (seg: string) => /^[a-z0-9._~-]+$/.test(seg);
    const param = (seg: string) => /^:\w+$/.test(seg);
    /** A segment that may match several segments or none (a wildcard, an optional or a group): the whole path is unread. */
    const spans = (seg: string) => /[*?+({]/.test(seg);
    /** A segment that matches any one segment: a :param, or one that is neither plain text nor spans (as :token.gif). */
    const anyOne = (seg: string) => param(seg) || (!plain(seg) && !spans(seg));
    const unread = (segs: string[]) => segs.some(spans);
    /** Whether two route paths can match the same request. */
    const overlaps = (a: string, b: string) => {
      const x = segments(a);
      const y = segments(b);
      if (unread(x) || unread(y)) return true;
      return x.length === y.length && x.every((seg, i) => seg === y[i] || anyOne(seg) || anyOne(y[i]));
    };
    /**
     * Whether an earlier route takes the cited route's own requests: it is at least as general, every segment the
     * same or a segment matching any one segment (anyOne; correctness review round 5: a literal such as items/due declared before items/:id is routine
     * Nest ordering and takes only requests whose param equals that literal).
     */
    const shadows = (earlier: string, cited: string) => {
      const x = segments(earlier);
      const y = segments(cited);
      if (unread(x) || unread(y)) return true;
      return x.length === y.length && x.every((seg, i) => seg === y[i] || anyOne(seg));
    };
    const ROUTE = /^((?:modules|core)\/[^#]+\.ts)#(?:([A-Za-z0-9_]+) )?GET (.*)$/;
    const findRoute = (file: string, cls: string | undefined, route: string): ts.ClassElement | string => {
      const sf = parse(file);
      const hits: { owner: ts.ClassLikeDeclaration; member: ts.ClassElement }[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
          for (const member of node.members) {
            if (decoratorsOf(member).some((d) => {
              const call = decoratorCall(d);
              return call?.name === "Get" && call.arg === route;
            })) hits.push({ owner: node, member });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      const topLevel = (c: ts.ClassLikeDeclaration) => ts.isClassDeclaration(c) && c.parent === sf && !!c.name;
      if (hits.some((h) => !topLevel(h.owner))) return "route also declared in a nested or expression class: cite by hand";
      if (cls && !sf.statements.some((st) => ts.isClassDeclaration(st) && st.name?.text === cls)) return `no class ${cls}`;
      const inScope = cls ? hits.filter((h) => h.owner.name?.text === cls) : hits;
      if (inScope.length === 0) return "no such route";
      if (inScope.length > 1) return `ambiguous route (${inScope.length} @Get) — name its controller class`;
      const cited = inScope[0];
      const ownerWhy = controllerWhy(cited.owner as ts.ClassDeclaration);
      if (ownerWhy) return ownerWhy;
      // Routing (closing review round 4): every route in the file is a literal; no other route can take this path
      // first: an earlier @Get/@All in the same controller, or any route in another controller of the file.
      const full = (owner: ts.ClassDeclaration, arg: string) => `${controllerPath(owner)}/${arg}`;
      const citedPath = full(cited.owner as ts.ClassDeclaration, route);
      for (const st of sf.statements) {
        if (!ts.isClassDeclaration(st)) continue;
        // Security review round 6: every controller in the file is read as the cited one is (so none inherits routes);
        // a route on a class that is not a controller (a base another class could extend) fails; a route on a member
        // whose name is not a plain identifier fails (Nest registers integer-like names first, whatever their place).
        const isController = decoratorsOf(st).some((c) => decoratorCall(c)?.name === "Controller");
        // Security review round 7: a second member of the same name replaces the first at runtime and takes its
        // decorators and its place in Nest's route order, so a name may be declared once (overload signatures aside).
        const names = new Set<string>();
        for (const member of st.members) {
          // A constructor parameter property (readonly getStatus: ...) is an instance member too: it is assigned at
          // construction and replaces a method of that name as Nest's handler (closing security review).
          if (ts.isConstructorDeclaration(member)) {
            for (const p of member.parameters) {
              if (!ts.isParameterPropertyDeclaration(p, member)) continue;
              const key = nameText(p.name);
              if (names.has(key)) return `member ${key} declared twice in ${st.name?.text}`;
              names.add(key);
            }
            continue;
          }
          if (!member.name || (ts.isMethodDeclaration(member) && !member.body)) continue;
          const key = `${ts.getCombinedModifierFlags(member as ts.Declaration) & ts.ModifierFlags.Static ? "static " : ""}${nameText(member.name)}`;
          if (names.has(key)) return `member ${key} declared twice in ${st.name?.text}`;
          names.add(key);
        }
        if (isController && controllerWhy(st)) return controllerWhy(st)!;
        for (const member of st.members) {
          for (const d of decoratorsOf(member)) {
            const call = decoratorCall(d);
            if (!call || !VERBS.has(call.name)) continue;
            if (call.arg === null) return `non-literal route ${d.getText()} in ${st.name?.text}`;
            if (!isController) return `route ${d.getText()} on ${st.name?.text}, which is not a controller`;
            if (!member.name || !ts.isIdentifier(member.name)) return `route ${d.getText()} on a member not named by a plain identifier`;
            if (member === cited.member || !(call.name === "Get" || call.name === "All")) continue;
            if (st !== cited.owner) {
              if (overlaps(full(st, call.arg), citedPath)) return `route ${d.getText()} in ${st.name?.text} overlaps the cited route`;
            } else if (member.pos < cited.member.pos && shadows(full(st, call.arg), citedPath)) return `cited route shadowed by an earlier ${d.getText()}`;
          }
        }
      }
      return cited.member;
    };
    /**
     * Where each name a cited file may use to decorate a cited class or GET handler comes from (closing review rounds
     * 2 and 3). Each is a closed list: a decorator under another name, or a known name bound any other way (an alias,
     * a destructured require, a default import, a local declaration, an import from another module), fails closed.
     * Adding a name is a review decision about whether it can set the module scope.
     */
    const NEST = "@nestjs/common";
    const SCOPE_GUARD = "core/auth/module-scope.guard";
    const SOURCE: Record<string, string> = {
      Get: NEST, UseGuards: NEST, Header: NEST, HttpCode: NEST, Controller: NEST, SetMetadata: NEST, applyDecorators: NEST,
      RequireModuleScope: SCOPE_GUARD, ModuleScopeGuard: SCOPE_GUARD, ShadowEffectiveAuthority: SCOPE_GUARD, MODULE_SCOPE_KEY: SCOPE_GUARD,
      RateLimit: "core/decorators/rate-limit.decorator",
      PublicRateLimit: "core/guards/public-rate-limit.guard",
      CrmRateLimit: "modules/crm/guards/rate-limit.guard",
      RequireFeature: "modules/crm/guards/feature-flag.guard",
      HiddenModuleWrites: "core/auth/hidden-module-writes.decorator",
      forwardRef: NEST,
      PickType: "@nestjs/mapped-types", OmitType: "@nestjs/mapped-types", PartialType: "@nestjs/mapped-types", IntersectionType: "@nestjs/mapped-types",
    };
    /** The decorators a cited GET handler may carry: every name found on a GET handler in the server today. */
    const KNOWN_DECORATORS = new Set(["Get", "UseGuards", "RequireModuleScope", "RateLimit", "CrmRateLimit", "PublicRateLimit", "ShadowEffectiveAuthority", "Header", "HttpCode", "RequireFeature"]);
    /**
     * The decorators a cited controller class may carry. HiddenModuleWrites writes the module scope key onto
     * handlers, but only write verbs (core/auth/hidden-module-writes.decorator.ts, held by the read census); a GET
     * claim is unaffected while that holds.
     */
    const CLASS_DECORATORS = new Set(["Controller", "UseGuards", "HiddenModuleWrites"]);
    /** What can set the module scope when called: allowed only as a decorator call, never called any other way. */
    const SCOPE_CAPABLE = new Set(["RequireModuleScope", "SetMetadata", "applyDecorators"]);
    /**
     * Names that reach metadata, globals or prototypes (closing review round 4): banned anywhere in a cited file
     * (prototype only as Object.prototype.<method>, which reads).
     */
    const BANNED = new Set(["MODULE_SCOPE_KEY", "Reflect", "defineMetadata", "globalThis", "global", "window", "self", "eval", "Function", "Proxy", "setPrototypeOf", "__proto__", "defineProperty", "defineProperties", "prototype"]);
    /**
     * The only calls code may make when a cited file loads or its controller is built (the cited files' own today):
     * forwardRef and the DTO mapped types (pinned in SOURCE), Symbol, and reads of a plain object's own keys.
     */
    const LOAD_CALLS = new Set(["forwardRef", "Symbol", "PickType", "OmitType", "PartialType", "IntersectionType"]);
    const LOAD_OBJECT_CALLS = new Set(["keys", "entries", "values", "freeze"]);
    /** Globals a cited file may not declare for itself (the allowed load-time calls rely on them). */
    const GLOBALS = new Set(["Object", "Symbol", "Set", "Map", "WeakMap", "WeakSet", "Error"]);
    /** Globals code may construct at load or construction (beside imported classes such as Logger). */
    const LOAD_NEW = new Set(["Set", "Map", "WeakMap", "WeakSet", "Error"]);
    /**
     * Libraries whose factories may be called at load: DTO validation (a DTO's own decorators are built from them)
     * and Nest's upload interceptors with multer's storage. None can set handler metadata on its own.
     */
    const DTO_LIBS = new Set(["class-validator", "class-transformer", "@nestjs/platform-express", "multer"]);
    /**
     * Members a runtime calls on its own (coercion, JSON, await, Nest lifecycle hooks at bootstrap): a body under one
     * of these names could run at load, so a cited file may declare none (closing review round 5).
     */
    const SELF_CALLED = new Set(["toString", "valueOf", "toJSON", "then", "onModuleInit", "onApplicationBootstrap", "onModuleDestroy", "beforeApplicationShutdown", "onApplicationShutdown"]);

    /** A member's name as the runtime sees it ('toString' and toString alike). */
    const nameText = (name: ts.Node) => (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name) ? name.text : name.getText());
    /**
     * Why code that runs at load or construction is not plainly declarative: a call other than a decorator's, new of a
     * plain name, or LOAD_CALLS; a computed member access; any write (an assignment, ++ or --, delete, or a for-in/of
     * whose target is not a fresh declaration).
     */
    const loadTimeWhy = (node: ts.Node, imported: Map<string, string>, fail: (reason: string) => void) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const objectRead = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Object" && LOAD_OBJECT_CALLS.has(callee.name.text);
        const dtoFactory = ts.isIdentifier(callee) && DTO_LIBS.has(imported.get(callee.text) ?? "");
        const ok = ts.isDecorator(node.parent) || (ts.isIdentifier(callee) && LOAD_CALLS.has(callee.text)) || dtoFactory || objectRead || callee.kind === ts.SyntaxKind.SuperKeyword;
        if (!ok) fail(`call at load or construction: ${node.getText().slice(0, 80)}`);
      } else if (ts.isNewExpression(node) && !(ts.isIdentifier(node.expression) && (LOAD_NEW.has(node.expression.text) || imported.has(node.expression.text)))) fail(`new at load or construction: ${node.getText().slice(0, 80)}`);
      else if (ts.isComputedPropertyName(node)) fail(`computed name at load or construction: ${node.getText().slice(0, 80)}`);
      else if (ts.isTaggedTemplateExpression(node)) fail(`tagged template at load or construction: ${node.getText().slice(0, 80)}`);
      else if (ts.isElementAccessExpression(node) && !(ts.isStringLiteralLike(node.argumentExpression) || ts.isNumericLiteral(node.argumentExpression))) fail(`computed access at load or construction: ${node.getText().slice(0, 80)}`);
      else if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        // None at all (security review round 6: this.<handler> = ... in a constructor swaps the handler Nest serves).
        fail(`assignment at load or construction: ${node.getText().slice(0, 80)}`);
      } else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
        // Security review round 7: an imported table (LEVEL_RANK.none++) is as writable as by assignment.
        fail(`increment or decrement at load or construction: ${node.getText().slice(0, 80)}`);
      } else if (ts.isDeleteExpression(node)) fail(`delete at load or construction: ${node.getText().slice(0, 80)}`);
      else if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) fail(`for-in/of writing an existing target at load or construction: ${node.getText().slice(0, 80)}`);
    };
    /** An import's module, as a path under the server src (a package name as written). */
    const resolveImport = (file: string, spec: string) =>
      spec.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)) : spec;
    /**
     * Why a cited file cannot be read with certainty, or null:
     * - a known name bound other than by a plain named import from its own module (SOURCE);
     * - an import renaming something to or from a known name;
     * - a namespace import, an import-equals, or a require call;
     * - a scope-capable name used other than as a decorator's own callee or its import;
     * - a BANNED name, or prototype, constructor or __proto__ reached (metadata, globals or prototype chains);
     * - code that runs at load or construction that is not plainly declarative (loadTimeWhy).
     * - a getter or setter, a self-called member (toString, then, Nest lifecycle hooks), a decorated class not at the
     *   top level, a decorator neither imported by name nor a DTO factory, RequestMapping, or a route decorator name
     *   used other than as a decorator.
     * So no code this file defines runs at load or construction except what loadTimeWhy reads. The class owning the
     * route and the file's routing are read by findRoute (controllerWhy, overlaps, shadows).
     * Not read here, and held only by a server test reading the controllers' real metadata and routes (proposed
     * follow-up): code in another file (an imported decorator's or class's definition, which may run at load), and
     * a write made inside a body when it runs.
     */
    const unreadableFile = (file: string): string | null => {
      const sf = parse(file);
      let why: string | null = null;
      const fail = (reason: string) => (why ??= reason);
      /** Names the file binds by a plain named import, and the module each comes from. */
      const imported = new Map<string, string>();
      for (const st of sf.statements) {
        const named = ts.isImportDeclaration(st) ? st.importClause?.namedBindings : undefined;
        if (named && ts.isNamedImports(named)) for (const el of named.elements) imported.set(el.name.text, resolveImport(file, (st as ts.ImportDeclaration).moduleSpecifier.getText().slice(1, -1)));
      }
      /**
       * Decorators the file declares for itself run when the class is defined, so each is read as load-time code. The
       * only form accepted is the DTO pattern: const <Name> = (<params>) => <a DTO_LIBS factory>(...).
       */
      const localDecorators = new Map<string, ts.ArrowFunction>();
      for (const st of sf.statements) {
        if (!ts.isVariableStatement(st)) continue;
        for (const decl of st.declarationList.declarations) {
          const init = decl.initializer;
          if (!ts.isIdentifier(decl.name) || !init || !ts.isArrowFunction(init) || !ts.isCallExpression(init.body)) continue;
          const factory = init.body.expression;
          if (ts.isIdentifier(factory) && DTO_LIBS.has(imported.get(factory.text) ?? "")) localDecorators.set(decl.name.text, init);
        }
      }
      const loadFns = new Set<ts.Node>(localDecorators.values());
      const visit = (node: ts.Node, load: boolean) => {
        if (why) return;
        if (load) loadTimeWhy(node, imported, fail);
        if (ts.isDecorator(node)) {
          const e = unparen(node.expression);
          const callee = ts.isCallExpression(e) ? unparen(e.expression) : e;
          if (!ts.isIdentifier(callee) || !(imported.has(callee.text) || localDecorators.has(callee.text))) fail(`decorator neither imported by name nor a DTO factory: ${node.getText().slice(0, 80)}`);
        }
        if (ts.isGetAccessor(node) || ts.isSetAccessor(node)) fail(`accessor ${node.name.getText()} (runs when read)`);
        else if ((ts.isMethodDeclaration(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node) || ts.isShorthandPropertyAssignment(node)) && SELF_CALLED.has(nameText(node.name))) fail(`self-called member ${nameText(node.name)}`);
        else if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.parent !== sf && (decoratorsOf(node).length || node.members.some((m) => decoratorsOf(m).length))) fail(`decorated class not at top level: ${node.name?.text ?? "anonymous"}`);
        else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "forwardRef" && !(node.arguments.length === 1 && ts.isArrowFunction(node.arguments[0]) && ts.isIdentifier(node.arguments[0].body))) fail(`forwardRef other than () => <Class>: ${node.getText().slice(0, 80)}`);
        if (ts.isPropertyAccessExpression(node) && node.name.text === "prototype" && !(ts.isIdentifier(node.expression) && node.expression.text === "Object")) fail(`prototype reached: ${node.getText().slice(0, 80)}`);
        else if (ts.isPropertyAccessExpression(node) && node.name.text === "constructor") fail(`constructor reached: ${node.getText().slice(0, 80)}`);
        else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && ["prototype", "constructor", "__proto__"].includes(node.argumentExpression.text)) fail(`${node.argumentExpression.text} reached: ${node.getText().slice(0, 80)}`);
        if (ts.isImportSpecifier(node)) {
          const importedName = (node.propertyName ?? node.name).text;
          const local = node.name.text;
          const from = resolveImport(file, (node.parent.parent.parent.moduleSpecifier as ts.StringLiteral).text);
          if (node.propertyName && (importedName in SOURCE || local in SOURCE)) fail(`renamed import ${node.getText()}`);
          else if (local in SOURCE && from !== SOURCE[local]) fail(`${local} imported from ${from}, not ${SOURCE[local]}`);
        } else if (ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node)) fail(`namespace or import-equals ${node.getText()}`);
        else if (ts.isImportClause(node) && node.name && node.name.text in SOURCE) fail(`default import ${node.name.text}`);
        else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") fail(`require ${node.getText()}`);
        else if (ts.isIdentifier(node)) {
          const parent = node.parent;
          const declares = (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isBindingElement(parent) || ts.isParameter(parent)) && parent.name === node;
          if (declares && (node.text in SOURCE || GLOBALS.has(node.text))) fail(`local ${node.text}`);
          else if (BANNED.has(node.text) && !(node.text === "prototype" && ts.isPropertyAccessExpression(parent))) fail(`scope metadata written outside a decorator (${node.text})`);
          else if (node.text === "RequestMapping") fail("RequestMapping (routes are read by verb decorator only)");
          else if ((SCOPE_CAPABLE.has(node.text) || VERBS.has(node.text)) && !ts.isImportSpecifier(parent)) {
            const asCallee = ts.isCallExpression(parent) && parent.expression === node && ts.isDecorator(parent.parent);
            if (!asCallee) fail(`${node.text} used other than as a decorator: ${parent.getText().slice(0, 80)}`);
          }
        } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === "module_scope") fail("scope metadata key named outside a decorator");
        // Code that runs when the module loads or the controller is built (top level, class bodies and their
        // initializers, constructors); a method, function or arrow body runs only when called.
        // A function's decorators, name and parameter decorators are evaluated where it is defined; its body and
        // parameter defaults only when it is called (correctness review round 5). A DTO factory is load-time throughout.
        if (ts.isFunctionLike(node) && !ts.isConstructorDeclaration(node) && !loadFns.has(node)) {
          ts.forEachChild(node, (child) => {
            if (ts.isParameter(child)) {
              decoratorsOf(child).forEach((d) => visit(d, load));
              ts.forEachChild(child, (part) => (ts.isDecorator(part) ? undefined : visit(part, false)));
            } else visit(child, load && (ts.isDecorator(child) || ts.isComputedPropertyName(child) || child === (node as ts.SignatureDeclaration).name));
          });
          return;
        }
        ts.forEachChild(node, (child) => visit(child, load));
      };
      visit(sf, true);
      return why;
    };
    /**
     * Why a handler's decorators cannot be read with certainty, or null. Anything this check cannot read fails
     * closed (closing reviews): a decorator that is not a call of a plain name, a qualified decorator, a name outside
     * KNOWN_DECORATORS (an aliased or composed scope, a raw SetMetadata), a scope whose module is not a literal, or a
     * file that can set the scope some other way (unreadableFile).
     */
    const unreadable = (member: ts.ClassElement): string | null => {
      for (const d of decoratorsOf(member)) {
        const call = decoratorCall(d);
        const text = d.getText();
        if (!call) return `unreadable decorator ${text}`;
        if (call.qualified) return `qualified decorator ${text}`;
        if (!KNOWN_DECORATORS.has(call.name)) return `unlisted decorator ${text}`;
        if (call.name === "RequireModuleScope" && call.arg === null) return `non-literal scope ${text}`;
      }
      return unreadableFile(member.getSourceFile().fileName);
    };
    /** The modules a handler's own @RequireModuleScope decorators name (each a literal, by unreadable()). */
    const scopesOf = (member: ts.ClassElement) =>
      decoratorsOf(member)
        .map(decoratorCall)
        .filter((c): c is { name: string; qualified: boolean; arg: string } => c?.name === "RequireModuleScope" && c.arg !== null)
        .map((c) => c.arg);
    /**
     * The ModuleScopeGuard subclasses accepted as the scope guard, each pinned to its file and reviewed: its body is
     * not read (a documented limit), so adding one, or changing one's canActivate, is a review decision.
     * WhatsAppOperationsScopeGuard lets the business's configuration owners through on purpose.
     */
    const SCOPE_GUARD_SUBCLASSES: Record<string, string[]> = {
      "modules/whatsapp/whatsapp.controller.ts": ["WhatsAppOperationsScopeGuard"],
    };
    /**
     * Whether the scope guard runs on a handler (security review round 7): ModuleScopeGuard is no app-wide guard, so
     * it must be named in @UseGuards on the handler or its controller, itself or a pinned subclass declared in the
     * file that extends it directly.
     */
    const scopeEnforced = (member: ts.ClassElement) => {
      const sf = member.getSourceFile();
      const pinned = SCOPE_GUARD_SUBCLASSES[sf.fileName] ?? [];
      const subclasses = new Set(
        sf.statements
          .filter((st): st is ts.ClassDeclaration => ts.isClassDeclaration(st) && !!st.name && pinned.includes(st.name.text) && !!st.heritageClauses?.some((h) => h.token === ts.SyntaxKind.ExtendsKeyword && h.types.some((t) => t.expression.getText() === "ModuleScopeGuard")))
          .map((st) => st.name!.text),
      );
      const guards = [member, member.parent].flatMap((node) =>
        decoratorsOf(node).flatMap((d) => {
          const e = unparen(d.expression);
          return ts.isCallExpression(e) && ts.isIdentifier(unparen(e.expression)) && (unparen(e.expression) as ts.Identifier).text === "UseGuards" ? e.arguments.filter(ts.isIdentifier).map((a) => a.text) : [];
        }),
      );
      return guards.some((g) => g === "ModuleScopeGuard" || subclasses.has(g));
    };
    /** Whether a handler carries any @RequireModuleScope at all. */
    const anyScope = (member: ts.ClassElement) => decoratorsOf(member).some((d) => decoratorCall(d)?.name === "RequireModuleScope");
    /**
     * An identifier the claim names must be in the file's code: an identifier of that name, or (for a title such as
     * the timeline's "Analysis:") whole-word text in a string or template literal. Comments never count.
     */
    const hasIdentifier = (file: string, id: string) => {
      const word = new RegExp(`(^|[^A-Za-z0-9_$])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_$]|$)`);
      let found = false;
      const visit = (node: ts.Node) => {
        if (found) return;
        if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) found = node.text === id;
        else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) found = word.test(node.text);
        if (!found) ts.forEachChild(node, visit);
      };
      visit(parse(file));
      return found;
    };
    const bad: string[] = [];
    for (const [href, row] of Object.entries(MODULE_TABLE)) {
      if (row.cite.length === 0) bad.push(`${href}: no reason`);
      const justified = new Set<string>();
      for (const cite of row.cite) {
        let m: RegExpExecArray | null;
        if ((m = ROUTE.exec(cite))) {
          const found = findRoute(m[1], m[2], m[3]);
          if (typeof found === "string") {
            bad.push(`${href}: ${cite}: ${found}`);
            continue;
          }
          const why = unreadable(found);
          if (why) {
            bad.push(`${href}: ${cite}: ${why}`);
            continue;
          }
          const scoped = scopesOf(found);
          if (scoped.length === 0 || !scoped.every((mod) => row.modules.includes(mod))) bad.push(`${href}: ${cite} scopes ${JSON.stringify(scoped)}`);
          else if (!scopeEnforced(found)) bad.push(`${href}: ${cite}: no ModuleScopeGuard in @UseGuards on the handler or its controller, so its scope is not enforced`);
          scoped.forEach((mod) => justified.add(mod));
        } else if (cite.startsWith("unscoped:") && (m = ROUTE.exec(cite.slice("unscoped:".length)))) {
          const found = findRoute(m[1], m[2], m[3]);
          if (typeof found === "string") bad.push(`${href}: ${cite}: ${found}`);
          else if (unreadable(found)) bad.push(`${href}: ${cite}: ${unreadable(found)}`);
          else if (anyScope(found)) bad.push(`${href}: ${cite} is scoped`);
        } else if ((m = /^hub:([a-z]+)$/.exec(cite))) {
          const hub = hubNav.find((h) => h.id === m![1]);
          if (!hub || !hub.items.some((item) => item.href === href)) bad.push(`${href}: not in hub ${m[1]}`);
          else if (hub.module) justified.add(hub.module);
        } else if ((m = /^data:((?:modules|core)\/[^:]+\.ts):([a-z]+) ([A-Za-z_$][\w$]*)[\s,]/.exec(cite))) {
          // The identifier must still be in the file, so a removed field fails rather than passes.
          if (!hasIdentifier(m[1], m[3])) bad.push(`${href}: ${cite}: "${m[3]}" is not in ${m[1]}`);
          if (!row.modules.includes(m[2])) bad.push(`${href}: ${cite} names ${m[2]}, which the row lacks`);
          justified.add(m[2]);
        } else if ((m = /^tracked:((?:modules|core)\/[^:]+\.ts):([a-z]+) ([A-Za-z_$][\w$]*:?) (FU-[A-Z0-9-]+) (.+)$/.exec(cite))) {
          // Recorded, not justifying: the identifier is still in the file, and the follow-up packet and decision are named.
          if (!hasIdentifier(m[1], m[3])) bad.push(`${href}: ${cite}: "${m[3]}" is not in ${m[1]}`);
          if (!/^pre-existing server exposure, tracked; nav unchanged by orchestrator decision 2026-11-22 under D-100/.test(m[5])) bad.push(`${href}: ${cite}: no decision named`);
        } else if (cite.startsWith("tracked:")) {
          // A tracked claim that does not parse is never accepted by another branch (closing review).
          bad.push(`${href}: malformed tracked citation ${cite}`);
        } else if (cite.startsWith("service-check:") && (m = ROUTE.exec(cite.slice("service-check:".length)))) {
          const found = findRoute(m[1], m[2], m[3]);
          if (typeof found === "string") bad.push(`${href}: ${cite}: ${found}`);
        } else if ((m = /^D-\d+:([a-z]+)\b/.exec(cite))) {
          // A ruling justifies only the module it names (security review round 2).
          if (!row.modules.includes(m[1])) bad.push(`${href}: ${cite} names ${m[1]}, which the row lacks`);
          justified.add(m[1]);
        } else if (/^D-\d+\b/.test(cite) && row.modules.length === 0) {
          // A ruling beside the unscoped read a row with no module rests on (Today, D-96).
        } else {
          bad.push(`${href}: unknown citation ${cite}`);
        }
      }
      for (const mod of row.modules) if (!justified.has(mod)) bad.push(`${href}: ${mod} is not justified`);
      if (row.modules.length === 0 && !row.cite.some((c) => c.startsWith("unscoped:"))) {
        bad.push(`${href}: no module, and no unscoped read cited`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("NMS-18 a member without projects is not offered Change orders (its list answers project data)", () => {
    const { moreSections } = menuSectionsFor("both", levels({ crm: "read", bookings: "read" }));
    expect(moreSections.flatMap((s) => s.items.map((i) => i.href))).not.toContain("/app/change-orders");
  });

  it("NMS-18 a member with storefront read and no revenue/crm is not offered Presence or Client portal; adding crm read offers Client portal only", () => {
    const storefrontOnly = menuSectionsFor("both", levels({ storefront: "read" }))
      .hubSections.flatMap((s) => s.items.map((i) => i.href));
    expect(storefrontOnly).not.toContain("/app/presence");
    expect(storefrontOnly).not.toContain("/app/portal");

    const withCrm = menuSectionsFor("both", levels({ storefront: "read", crm: "read" }))
      .hubSections.flatMap((s) => s.items.map((i) => i.href));
    expect(withCrm).not.toContain("/app/presence");
    expect(withCrm).toContain("/app/portal");
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
