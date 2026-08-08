/**
 * Progressive Disclosure Mode System
 *
 * Reduces day-one overwhelm by showing only the features a business
 * actually needs based on their current stage.
 *
 * Modes:
 *   - startup   : Solopreneurs & new businesses (<10 people, <$1M)
 *   - growth    : Established businesses with teams (10-40 people, $1M-$5M)
 *   - enterprise: Multi-service, multi-location (40+ people, $5M+)
 */

export type DisclosureMode = "startup" | "growth" | "enterprise";

const STORAGE_KEY = "kf_disclosure_mode";

const DEFAULT_MODE: DisclosureMode = "startup";

/**
 * REMOVED: a route-based visibility table.
 *
 * It listed /app/money, /app/work, /app/schedule, /app/build/* — an information
 * architecture that never shipped. nav-config emits /app/commerce,
 * /app/projects, /app/bookings, and the /app/build tree has been deleted, so
 * every entry named a route the nav does not use.
 *
 * Nothing read it: use-app-layout filters on the LABEL allowlists below. A
 * second, contradictory source of truth that no code consults is how the two
 * lists below drifted far enough to hide most of the app.
 */

/**
 * Which Operate nav items are shown per mode.
 *
 * These labels must match the `label` field in operateSections EXACTLY — the
 * filter in use-app-layout.ts is a strict allowlist, so a label that does not
 * match hides the item rather than failing loudly.
 *
 * That constraint was written in a comment and enforced by nothing, and the two
 * files drifted. Measured before this fix: of startup's six entries only
 * "Revenue", "Calendar" and "Bookings" existed. "Overview", "Directory" and
 * "Pipeline" matched nothing — the real labels are "Command Center",
 * "Contacts" and "Deals". Since startup is the DEFAULT mode and empty sections
 * are dropped entirely, every new user saw a nav containing three items.
 *
 * disclosure-mode.spec.ts now asserts every entry here resolves to a real nav
 * label, so the next rename fails a test instead of quietly hiding a feature.
 */
export const MODE_OPERATE_ITEMS: Record<DisclosureMode, string[]> = {
  // A solopreneur: talk to KEY, see the money, know the customers, keep the diary.
  startup: [
    "Chat", "Inbox",
    "Overview", "Sales", "Expenses",
    "Contacts", "Deals",
    "Calendar", "Bookings",
  ],
  // A team: add delivery, support, campaigns and reporting.
  growth: [
    "Chat", "Inbox", "Worker", "Autonomy",
    "Overview", "Sales", "Inventory", "Payments", "Expenses", "Budgets", "Reports",
    "Accounts & tax setup", "Reconcile bank", "Tax", "Close the month", "General ledger", "Trial balance", "Recurring journals", "Assets & depreciation",
    "Contacts", "Deals", "Sequences", "Support",
    "Calendar", "Bookings",
    "Projects", "Approvals",
    "Campaigns",
    "Goals",
  ],
  // Everything. use-app-layout short-circuits this mode, so the list is not
  // consulted — kept accurate anyway, because a list nobody reads is where the
  // other two got their errors from.
  enterprise: [
    "Chat", "Inbox", "Worker", "Autonomy", "Modes", "Data Inbox", "Capture",
    "Overview", "Sales", "Inventory", "Payments", "Expenses", "Purchasing", "Retainers", "Budgets", "Reports",
    "Accounts & tax setup", "Reconcile bank", "Tax", "Close the month", "General ledger", "Trial balance", "Recurring journals", "Assets & depreciation",
    "Bank rules", "Credit notes", "Exchange rates", "Accounting sync",
    "Contacts", "Deals", "Sequences", "Support", "Calls", "Insights",
    "Accounts", "Data quality", "Duplicates", "Relationship map", "Dashboard", "Sales team",
    "Calendar", "Bookings",
    "Projects", "Approvals", "Time tracking", "Operations", "SOPs", "Change orders",
    "Campaigns", "Content", "Social", "SEO", "WhatsApp", "Campaign plans",
    "Evidence", "Contracts", "Legal",
    "Goals", "Market",
    // Arrived with integration/2026-07-consolidation when the fork was closed.
    // The nav union added the routes; this list is the other half of that edit,
    // and the comment above is exactly right about why it must be kept accurate.
    "Payment gateway", "Payroll", "Performance", "Events",
  ],
};

/**
 * Which Build nav items are shown per mode.
 *
 * Same rule and same history as MODE_OPERATE_ITEMS above: "Blueprint" was in
 * all three lists and the nav label is "Business Genome", so the one item a new
 * business most needs to fill in was hidden from them. "Overview", "Google",
 * "Microsoft", "Payments", "Accounting", "Marketing", "Forms" and "WhatsApp"
 * matched nothing either.
 */
export const MODE_BUILD_ITEMS: Record<DisclosureMode, string[]> = {
  startup: ["Profile", "Storefront", "Presence", "Account", "Workspace", "Integrations"],
  growth: [
    "Profile", "Storefront", "Presence", "Templates",
    "Account", "Workspace", "Team", "AI",
    "Flows", "Integrations",
  ],
  enterprise: [
    "Profile", "Storefront", "Presence", "Templates",
    "Account", "Workspace", "Team", "Org Chart", "AI", "Compliance", "Developers",
    "Flows", "Integrations",
  ],
};

/** Human-readable labels. */
export const MODE_LABELS: Record<DisclosureMode, { title: string; subtitle: string }> = {
  startup: {
    title: "Startup",
    subtitle: "Focus on selling & delivering. Just the essentials.",
  },
  growth: {
    title: "Growth",
    subtitle: "Team workflows, automation & deeper reporting.",
  },
  enterprise: {
    title: "Enterprise",
    subtitle: "Full platform access. Every module unlocked.",
  },
};

export function getDisclosureMode(): DisclosureMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "startup" || raw === "growth" || raw === "enterprise") {
    return raw;
  }
  return DEFAULT_MODE;
}

export function setDisclosureMode(mode: DisclosureMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, mode);
  // Notify listeners so React components can re-render
  window.dispatchEvent(new CustomEvent("kf:disclosure-mode-changed", { detail: { mode } }));
}

/**
 * REMOVED with it: isRouteVisible(), the only consumer of that table.
 *
 * No caller anywhere in apps/web. It read routes the nav does not emit, so even
 * its callers would have got wrong answers — a dead function over a dead table,
 * describing an architecture that never shipped.
 */

/** Returns true if the user has explicitly chosen a mode (not just the default). */
export function hasChosenMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) !== null;
}

// ============================================================================
// BACKWARD COMPATIBILITY — Legacy exports
// ============================================================================

/** @deprecated Use MODE_OPERATE_ITEMS instead */
export const MODE_WORKSPACE_ITEMS = MODE_OPERATE_ITEMS;

/** @deprecated Use MODE_BUILD_ITEMS instead */
export const MODE_STUDIO_ITEMS = MODE_BUILD_ITEMS;
