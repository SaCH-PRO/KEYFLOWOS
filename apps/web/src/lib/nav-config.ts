"use client";

import type { LucideIcon } from "lucide-react";
import {
  Zap,
  Boxes,
  CreditCard,
  Briefcase,
  Wrench,
  User,
  Banknote,
  Receipt,
  Users,
  Contact,
  Send,
  Brain,
  Headset,
  FolderKanban,
  Clock,
  CheckSquare,
  Calendar,
  CalendarDays,
  MessageCircle,
  Megaphone,
  PenTool,
  Share2,
  BarChart3,
  Target,
  Activity,
  ShieldCheck,
  Scale,
  Building,
  BrainCircuit,
  Store,
  Globe,
  GraduationCap,
  Cog,
  Bot,
  MessageSquare,
  Code,
  Mail,
  FileText,
  RefreshCw,
  Layers,
  BookOpen,
  Truck,
  Bell,
  LayoutDashboard,
  TrendingUp,
  Calculator,
  Trash2,
  Camera,
  Inbox,
  Wallet,
  Dna,
  Landmark,
  Settings,
} from "lucide-react";
import type { DormantFeatureFlagKey } from "./feature-flags";
import type { BusinessHub, BusinessSells } from "./business-settings";
import { NAV_ROUTE_LABELS } from "./semantic-routes";

/**
 * The app's navigation (NAV-A1; owner rulings D-150 'hubs', D-151 'labels', D-152 'hide', D-179 'legacyaccess').
 *
 * Seven hubs that fit what the business sells: Today, Customers, Sales, Schedule, Money, Your page and Settings.
 * The desktop menu shows the hubs; the phone's bottom bar is Today, two hubs, New and More (bottomBarFor); every
 * other screen is under More, grouped by hub and then by area. What decides what shows:
 *   - what the business sells (useBusinessSettings().sells, stored on the business, BIZ-SETTINGS-WEB): a products
 *     business has no Schedule hub;
 *   - what the member may open: each hub and entry names the module scope that opens it (`module`), and an entry is
 *     shown only when the member's level on it is read or more (GET identity/businesses/:b/my-access, read as
 *     ModuleScopeGuard reads it). An answer that has not landed or failed hides nothing (WOS-R1): the server still
 *     refuses every route the member may not use.
 * The disclosure modes (startup / growth / enterprise) are gone: a per-browser label allowlist that hid most of the
 * app more than once (see the disclosure spec in lib/__tests__).
 *
 * Every href is the final URL (nav-reachability.spec.ts): never a next.config redirect source and never a page that
 * only forwards. /app/money and /app/settings are real indexes since NAV-A2 (they only forwarded before), so the Money
 * and Settings hubs name them.
 *
 * NAV-B-HIDE hides the screens v1 does not promise (D-152); until then they stay reachable under More.
 */

/** A module scope a nav entry needs read access on (core/authority/module-vocabulary.ts on the server). */
export type NavModule =
  | "crm"
  | "revenue"
  | "bookings"
  | "storefront"
  | "settings"
  | "analytics"
  | "operations"
  | "expenses"
  | "team"
  | "projects"
  | "content"
  | "automations";

export type AccessLevel = "none" | "read" | "write" | "admin";

/**
 * The member's level per module in the selected business, as the server answered it; null when unknown (no answer
 * yet, a failed read). A module the answer does not name is unknown too.
 */
export type ModuleLevels = Partial<Record<string, AccessLevel>> | null;

export interface ResolvedFeatureFlag {
  key: string;
  label: string;
  category: string | null;
  comingSoon: boolean;
  bypass: boolean;
}

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  matchTab?: string;
  /**
   * With matchTab: the entry lights only on this ?view of that tab
   * (W9-WEB-COMMERCE-NAV).
   */
  matchView?: string;
  exactMatch?: boolean;
  featureKey?: string;
  dormantFlag?: DormantFeatureFlagKey;
  /**
   * The module scope(s) its page's server reads require (every one named must be open to the member); a hub entry
   * without one takes its hub's. nav-member-scope.spec.ts holds the cited table (controller path:line or D-179).
   */
  module?: NavModule | NavModule[];
}

/**
 * Whether a section entry is the page on screen (the rail's active state).
 * An entry with matchTab lights on its path with that ?tab (and, with
 * matchView, that ?view); an exactMatch entry on its path with no ?tab; any
 * other on its path or below it. `search` is the current search params, read
 * reactively by the caller so a search-param-only navigation re-lights the
 * rail (W9-WEB-COMMERCE-NAV).
 */
export function isNavItemActive(
  item: NavItem,
  pathname: string,
  search: { get(name: string): string | null } | null,
): boolean {
  const basePath = item.href.split("?")[0];
  const tab = search?.get("tab") ?? null;
  if (item.matchTab) {
    if (pathname !== basePath || tab !== item.matchTab) return false;
    return item.matchView ? (search?.get("view") ?? null) === item.matchView : true;
  }
  if (item.exactMatch) {
    return pathname === basePath && !tab;
  }
  return pathname === basePath || pathname.startsWith(basePath + "/");
}

export interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
  /** A hub's section: its heading opens the hub's own page. */
  href?: string;
}

/** The desktop rail's drawers: "operate" is the More drawer (every section), "me" the member's own. */
export type DrawerSurface = "operate" | "build" | "me" | null;

/** A hub: its own page (href), the module that opens it (none for Today), and the screens it holds. */
export interface HubNavItem {
  id: BusinessHub;
  label: string;
  href: string;
  icon: LucideIcon;
  module?: NavModule;
  items: NavItem[];
  /** Other paths that belong to the hub, for its active state. */
  alsoActiveOn?: string[];
}

// ============================================================================
// THE SEVEN HUBS (D-150, D-151)
// ============================================================================

export const hubNav: HubNavItem[] = [
  { id: "today", label: NAV_ROUTE_LABELS["/app/command-center"], href: "/app/command-center", icon: Zap, items: [] },
  {
    id: "customers", label: "Customers", href: "/app/crm/contacts", icon: Users, module: "crm",
    alsoActiveOn: ["/app/crm"],
    items: [
      { label: "Deals", href: "/app/crm/deals", icon: TrendingUp },
      // Companies, as distinct from the people at them; one entry also opens the [accountId] detail.
      { label: "Companies", href: "/app/crm/accounts", icon: Building },
      { label: "Segments", href: "/app/people-flow", icon: Contact },
      { label: "Sequences", href: "/app/crm/sequences", icon: Send },
      { label: "Support", href: "/app/helpdesk", icon: Headset },
      { label: "Calls", href: "/app/call-tasks", icon: MessageCircle, dormantFlag: "salesPack" },
      { label: "Customer insights", href: "/app/crm/intelligence", icon: Brain },
      { label: "Data quality", href: "/app/crm/data-quality", icon: ShieldCheck },
      { label: "Duplicates", href: "/app/crm/duplicates", icon: Layers },
      { label: "Relationship map", href: "/app/crm/network", icon: Share2 },
      // At-risk contacts, due tasks, next actions, the presence funnel.
      { label: "Customer dashboard", href: "/app/crm/dashboard", icon: LayoutDashboard },
      // The sales reps' revenue and commissions: its read (GET conversion/.../sales-reps) carries no scope on the server
      // but answers PAID invoice totals per rep, so it needs revenue as well as customers (review: server follow-up).
      { label: "Rep performance", href: "/app/sales-team", icon: Users, module: ["crm", "revenue"] },
    ],
  },
  {
    // Label under D-151 (NAV_ROUTE_LABELS["/app/commerce"]). The pipeline and its quotes view are not doors here:
    // MOUNT-QUOTES makes Quotes a tab of Sales.
    id: "sales", label: NAV_ROUTE_LABELS["/app/commerce"], href: "/app/commerce", icon: Receipt, module: "revenue",
    items: [
      { label: "Invoices", href: "/app/commerce/invoices", icon: Receipt },
      // Stock is money spent and not yet earned back, so it sits beside what you sell.
      { label: "Inventory", href: "/app/inventory", icon: Boxes },
      // The gateway console: transactions, links, refunds across three providers.
      { label: "Payment gateway", href: "/app/commerce/gateway", icon: Landmark },
    ],
  },
  {
    id: "schedule", label: "Schedule", href: "/app/schedule/calendar", icon: CalendarDays, module: "bookings",
    alsoActiveOn: ["/app/calendar", "/app/schedule"],
    items: [
      { label: "Bookings", href: "/app/bookings", icon: Calendar },
      { label: "Timeline", href: "/app/temporal-flow", icon: Clock },
    ],
  },
  {
    id: "money", label: "Money", href: "/app/money", icon: Banknote, module: "revenue",
    alsoActiveOn: ["/app/financial-flow", "/app/finance"],
    items: [
      // NAV-A2: the Money index's Overview (journey H); the hub's own page is now the index.
      { label: "Overview", href: "/app/financial-flow", icon: LayoutDashboard },
      { label: "Payments", href: "/app/payments", icon: CreditCard },
      { label: "Expenses", href: "/app/money/expenses", icon: Receipt, module: "expenses" },
      // Purchasing is money leaving on a promise. Every procurement route needs operations (D-40).
      { label: "Purchasing", href: "/app/procurement", icon: Truck, module: "operations" },
      { label: "Retainers", href: "/app/retainers", icon: RefreshCw },
      { label: "Budgets", href: "/app/budgeting", icon: Target, module: "expenses" },
      { label: "Payroll", href: "/app/payroll", icon: Wallet, module: "operations" },
      // The report reads need revenue; D-179 also keeps Reports from a member with no analytics entry.
      { label: "Reports", href: "/app/reports", icon: BarChart3, module: ["revenue", "analytics"] },
      // The books. "Accounts & tax setup" first: the rows below it are unusable until it exists.
      { label: "Accounts & tax setup", href: "/app/finance/settings", icon: Cog },
      { label: "Reconcile bank", href: "/app/finance/reconciliation", icon: RefreshCw },
      { label: "Tax", href: "/app/finance/tax", icon: Scale },
      { label: "Close the month", href: "/app/finance/accounting-periods", icon: CalendarDays },
      { label: "General ledger", href: "/app/finance/ledger", icon: BookOpen },
      { label: "Journal entries", href: "/app/finance/journal", icon: BookOpen },
      { label: "Trial balance", href: "/app/finance/trial-balance", icon: BarChart3 },
      { label: "Recurring journals", href: "/app/finance/recurring-journals", icon: RefreshCw },
      { label: "Assets & depreciation", href: "/app/finance/fixed-assets", icon: Building },
      { label: "Bank rules", href: "/app/finance/bank-rules", icon: RefreshCw },
      { label: "Credit notes", href: "/app/finance/credit-notes", icon: Receipt },
      { label: "Exchange rates", href: "/app/finance/exchange-rates", icon: Globe },
      // QuickBooks / Xero sync (/app/accounting forwards here).
      { label: "Accounting sync", href: "/app/money/books", icon: Calculator },
    ],
  },
  {
    id: "page", label: "Your page", href: "/app/store", icon: Store, module: "storefront",
    items: [
      // Its overview (unscoped on the server) answers the business's paid invoice and order revenue, so it needs
      // revenue as well as the hub's storefront (security review; server follow-up: project kpis.revenue).
      { label: "Presence", href: "/app/presence", icon: Globe, module: ["storefront", "revenue"] },
      // What a client sees when you share work with them; GET businesses/:businessId/access requires crm:read (P145).
      { label: "Client portal", href: "/app/portal", icon: Globe, module: ["storefront", "crm"] },
    ],
  },
  {
    id: "settings", label: "Settings", href: "/app/settings", icon: Settings, module: "settings",
    alsoActiveOn: ["/app/settings", "/app/profile", "/app/genome", "/app/structure", "/app/key-connect", "/app/templates", "/app/trash"],
    items: [
      { label: "Business profile", href: "/app/profile", icon: BrainCircuit },
      // NAV-A2 (journey F; D-105, D-138): the payments page.
      { label: "Getting paid", href: "/app/settings/business", icon: Wallet },
      { label: "Business Genome", href: "/app/genome", icon: Dna },
      { label: "Plan & billing", href: "/app/settings/billing", icon: CreditCard },
      { label: "Team", href: "/app/settings/team", icon: Users, module: "team" },
      { label: "Org chart", href: "/app/structure", icon: Layers, module: "team" },
      { label: "AI", href: "/app/settings/ai", icon: Bot, module: "operations" },
      { label: "Compliance", href: "/app/settings/compliance", icon: ShieldCheck },
      { label: "Developers", href: "/app/settings/developers", icon: Code },
      { label: "Integrations", href: "/app/key-connect", icon: Activity },
      { label: "Templates", href: "/app/templates", icon: GraduationCap },
      // Soft-deleted records, restorable.
      { label: "Trash", href: "/app/trash", icon: Trash2 },
    ],
  },
];

/** The hub sections of More: each hub's own screens, the heading opening the hub. */
export const operateSections: NavSection[] = hubNav
  .filter((hub) => hub.items.length > 0)
  .map((hub) => ({
    id: hub.id,
    label: hub.label,
    icon: hub.icon,
    href: hub.href,
    items: hub.items.map((item) => (item.module || !hub.module ? item : { ...item, module: hub.module })),
  }));

// ============================================================================
// MORE — everything that is not a hub (NAV-B-HIDE hides what v1 does not promise)
// ============================================================================

export const buildSections: NavSection[] = [
  {
    id: "key",
    label: "KEY",
    icon: Bot,
    items: [
      { label: "Chat", href: "/app/key/chat", icon: MessageSquare },
      { label: "Inbox", href: "/app/key-inbox", icon: Inbox, module: "operations" },
      { label: "Worker", href: "/app/key", icon: Bot },
      { label: "Autonomy", href: "/app/key-autonomy", icon: CheckSquare },
      { label: "Modes", href: "/app/key-modes", icon: BrainCircuit },
      { label: "Data Inbox", href: "/app/data-inbox", icon: Layers, module: "operations" },
      { label: "Capture", href: "/app/capture", icon: Camera },
    ],
  },
  {
    id: "work",
    label: "Work",
    icon: FolderKanban,
    items: [
      // /app/projects forwards here.
      { label: "Projects", href: "/app/work/projects", icon: FolderKanban, module: "projects" },
      { label: "Approvals", href: "/app/approvals", icon: CheckSquare, module: "operations" },
      { label: "Performance", href: "/app/performance", icon: Activity, module: "operations" },
      { label: "Time tracking", href: "/app/time-tracking", icon: Clock, module: "projects" },
      // Operations surfaces need operations (D-40); an older member with no entry is refused (D-179).
      { label: "Operations", href: "/app/operations", icon: Briefcase, module: "operations" },
      { label: "SOPs", href: "/app/operations-flow", icon: BookOpen, module: "operations" },
      // Each change order carries its project's name, scope, amount and hours (as Time tracking, projects).
      { label: "Change orders", href: "/app/change-orders", icon: FileText, module: "projects" },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    icon: Megaphone,
    items: [
      // /app/marketing forwards to the campaigns; all three wear the contentScheduler dormant gate.
      { label: "Campaigns", href: "/app/communicate/campaigns", icon: Mail, dormantFlag: "contentScheduler" },
      { label: "Mailing lists", href: "/app/marketing/lists", icon: Users, dormantFlag: "contentScheduler", module: "content" },
      // Its read (unscoped) answers 60-day paid order revenue, so it needs revenue.
      { label: "Case studies", href: "/app/marketing/case-studies", icon: FileText, dormantFlag: "contentScheduler", module: "revenue" },
      { label: "Content", href: "/app/content-ops", icon: PenTool },
      { label: "Social", href: "/app/social", icon: Share2 },
      { label: "SEO", href: "/app/seo", icon: Globe, dormantFlag: "webPresencePack" },
      { label: "Events", href: "/app/events", icon: Calendar },
      { label: "WhatsApp", href: "/app/whatsapp", icon: MessageCircle, module: "operations" },
      { label: "Campaign plans", href: "/app/marketing-flow", icon: Megaphone },
    ],
  },
  {
    id: "legal",
    label: "Legal",
    icon: ShieldCheck,
    items: [
      { label: "Evidence", href: "/app/evidence", icon: ShieldCheck },
      { label: "Contracts", href: "/app/contracts", icon: FileText, module: "operations" },
      { label: "Legal", href: "/app/legal", icon: Scale },
    ],
  },
  {
    id: "strategy",
    label: "Strategy",
    icon: Target,
    items: [
      { label: "Business insights", href: "/app/intelligence", icon: LayoutDashboard },
      { label: "Goals", href: "/app/goals", icon: Target },
      { label: "Market", href: "/app/market", icon: Target },
    ],
  },
  {
    id: "automate",
    label: "Automate",
    icon: Wrench,
    items: [
      { label: "Flows", href: "/app/flows", icon: RefreshCw, module: "automations" },
      { label: "Automations", href: "/app/automations", icon: Zap },
      { label: "Role flows", href: "/app/key-flows", icon: Layers },
      // The brand-asset library: files and folders (not Money's "Assets & depreciation").
      { label: "Asset library", href: "/app/assets", icon: Layers, module: "content" },
    ],
  },
];

// ============================================================================
// DORMANT — coming-soon modules (hidden by their flags)
// ============================================================================

export const moreNav: NavItem[] = [
  { label: "Community", href: "/app/community", icon: MessageCircle, dormantFlag: "community" },
  { label: "Learn", href: "/app/learn", icon: BookOpen, dormantFlag: "learning" },
  { label: "Marketplace", href: "/app/marketplace", icon: Globe, dormantFlag: "marketplaceBrowsing" },
  { label: "Supplier", href: "/app/marketplace?tab=suppliers", icon: Truck, dormantFlag: "supplier" },
];

// ============================================================================
// ME — the member's own
// ============================================================================

export const meNav: NavItem[] = [
  // NAV-A3 (BUG-118): the member's own account; the business's page is Settings > Business profile (/app/profile).
  { label: "My account", href: "/app/settings/profile", icon: User },
  // /app/notifications forwards here. FU-ME-NOTIFICATIONS-SCOPE (D-276): the business's customer emails and their
  // log, read under settings (P30), so offered only to settings readers, as the Settings index offers it. A member's
  // own alerts stay in the header bell.
  { label: "Notifications", href: "/app/settings/notifications", icon: Bell, module: "settings" },
];

// ============================================================================
// WHAT A MEMBER IS SHOWN
// ============================================================================

const LEVELS: readonly AccessLevel[] = ["none", "read", "write", "admin"];

/** The server's my-access answer, read strictly: only the four levels count; anything else is unknown (null). */
export function memberModuleLevelsOf(answer: unknown): ModuleLevels {
  if (!answer || typeof answer !== "object") return null;
  const modules = (answer as { modules?: unknown }).modules;
  if (!modules || typeof modules !== "object" || Array.isArray(modules)) return null;
  const out: Partial<Record<string, AccessLevel>> = {};
  for (const [module, level] of Object.entries(modules as Record<string, unknown>)) {
    if (typeof level === "string" && (LEVELS as readonly string[]).includes(level)) out[module] = level as AccessLevel;
  }
  return out;
}

/**
 * Whether a member with `levels` is shown an entry that needs `module` (every module, when several): hidden only on
 * a known 'none'.
 */
export function canOpenModule(levels: ModuleLevels, module: NavModule | NavModule[] | undefined): boolean {
  if (!module || !levels) return true;
  return (Array.isArray(module) ? module : [module]).every((m) => {
    const level = levels[m];
    return level === undefined || level !== "none";
  });
}

/** The modules an entry needs: its own, else (inside a hub) its hub's, else none. */
export function entryModules(item: NavItem, hub?: { module?: NavModule }): NavModule[] {
  const own = item.module ?? hub?.module;
  return own === undefined ? [] : Array.isArray(own) ? own : [own];
}

/**
 * The hubs a business that sells `sells` has (D-150): a products business has no Schedule. `null` is not known (the
 * settings are not ready: no business yet, loading, or failed): only the hubs every business has, so a products
 * business never sees Schedule.
 */
function hubsForSells(sells: BusinessSells | null): HubNavItem[] {
  return sells === "both" || sells === "services" ? hubNav : hubNav.filter((h) => h.id !== "schedule");
}

/** The Me menu's entries a member is shown: each only when their modules open it (unknown hides nothing; D-276). */
export function meNavFor(levels: ModuleLevels): NavItem[] {
  return meNav.filter((item) => canOpenModule(levels, item.module));
}

/** The hubs a member is shown, in menu order, each holding only the screens they may open. */
export function hubsFor(sells: BusinessSells | null, levels: ModuleLevels): HubNavItem[] {
  return hubsForSells(sells)
    .filter((hub) => canOpenModule(levels, hub.module))
    .map((hub) => {
      const items = hub.items.filter((item) => canOpenModule(levels, item.module ?? hub.module));
      return items.length === hub.items.length ? hub : { ...hub, items };
    });
}

/** The phone's two hub slots per what the business sells (intuitiveness principle 'The app fits what you sell'). */
const BOTTOM_BAR: Record<BusinessSells, BusinessHub[]> = {
  services: ["schedule", "customers"],
  products: ["sales", "customers"],
  both: ["schedule", "sales"],
};

/** Who takes a slot of a hub the member cannot open, in order. */
const BOTTOM_BAR_FALLBACK: BusinessHub[] = ["customers", "schedule", "sales", "money"];

/**
 * The hubs between Today and New, and New and More, on the phone's bottom bar. A hub the member cannot open gives
 * its slot to the next one they can; never a hub they cannot open, so the bar may hold one hub, or none.
 */
export function bottomBarFor(sells: BusinessSells | null, levels: ModuleLevels): HubNavItem[] {
  // Not known (not ready: no business yet, loading, or failed): no slot, rather than the wrong two.
  if (sells === null) return [];
  const open = hubsFor(sells, levels);
  const byId = (id: BusinessHub) => open.find((h) => h.id === id);
  const chosen: HubNavItem[] = [];
  for (const id of BOTTOM_BAR[sells]) {
    const hub = byId(id);
    if (hub) chosen.push(hub);
  }
  for (const id of BOTTOM_BAR_FALLBACK) {
    if (chosen.length >= 2) break;
    const hub = byId(id);
    if (hub && !chosen.includes(hub)) chosen.push(hub);
  }
  // Slots in the bar's own order: the sells order first, then the fallbacks.
  return chosen.slice(0, 2);
}

/** Entries a member may open, a section they emptied dropped. Returns the input when nothing is hidden. */
function sectionsFor(sections: NavSection[], keep: (item: NavItem) => boolean): NavSection[] {
  let changed = false;
  const shown = sections.flatMap((section) => {
    const items = section.items.filter(keep);
    if (items.length === section.items.length) return [section];
    changed = true;
    return items.length > 0 ? [{ ...section, items }] : [];
  });
  return changed ? shown : sections;
}

/** More, as a member sees it: the hub sections they may open, then everything else they may open. */
export function menuSectionsFor(
  sells: BusinessSells | null,
  levels: ModuleLevels,
): { hubSections: NavSection[]; moreSections: NavSection[] } {
  const forSells = new Set(hubsForSells(sells).map((h) => h.id as string));
  const openHubs = new Set(hubsFor(sells, levels).map((h) => h.id as string));
  // A screen with a module of its own (Expenses, Team) is shown to a member who may open it even when they may not
  // open its hub's page (review COR-1); the section heading then opens nothing.
  const hubSections = sectionsFor(
    operateSections.filter((s) => forSells.has(s.id)),
    (item) => canOpenModule(levels, item.module),
  ).map((section) => (openHubs.has(section.id) ? section : { ...section, href: undefined }));
  const moreSections = sectionsFor(buildSections, (item) => canOpenModule(levels, item.module));
  return { hubSections, moreSections };
}

/** Whether `pathname` is the hub's own page (aria-current "page"); /app lands on Today (acceptance m5). */
export function isHubPage(hub: HubNavItem, pathname: string): boolean {
  return pathname === hub.href || (hub.id === "today" && pathname === "/app");
}

/** Whether `pathname` is in a hub: its own page, its screens, or a path it claims. */
export function isHubActive(hub: HubNavItem, pathname: string): boolean {
  const under = (p: string) => {
    const base = p.split("?")[0];
    return pathname === base || pathname.startsWith(base + "/");
  };
  if (hub.id === "today" && pathname === "/app") return true;
  return under(hub.href) || hub.items.some((i) => under(i.href)) || (hub.alsoActiveOn ?? []).some(under);
}

// ============================================================================
// BACKWARD COMPATIBILITY — Legacy exports
// ============================================================================

/** Every hub screen, flattened. */
export const operateNav: NavItem[] = operateSections.flatMap((s) => s.items);
/** Every other screen, flattened. */
export const buildNav: NavItem[] = buildSections.flatMap((s) => s.items);
/** @deprecated Use operateNav instead */
export const workspacesNav = operateNav;
/** @deprecated Use buildNav instead */
export const studioNav = buildNav;
/** @deprecated Use moreNav instead */
export const comingSoonNav = moreNav;
