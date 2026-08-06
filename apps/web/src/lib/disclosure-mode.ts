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

/** Which nav routes are visible in each mode. */
const MODE_VISIBILITY: Record<DisclosureMode, Set<string>> = {
  startup: new Set([
    "/app/keyflow-command",   // Cockpit
    "/app/money",             // Money
    "/app/money/revenue",     // Revenue
    "/app/crm/contacts",            // People
    "/app/crm/contacts",   // Pipeline
    "/app/schedule",          // Schedule
    "/app/schedule/bookings", // Bookings
    "/app/build",             // Build
    "/app/build/business",    // Business
    "/app/build/business/store", // Storefront
    "/app/build/system",      // System
    "/app/build/system/workspace", // Workspace settings
    "/app/profile",           // Profile
  ]),
  growth: new Set([
    "/app/keyflow-command",   // Cockpit
    "/app/money",             // Money
    "/app/money/revenue",     // Revenue
    "/app/money/expenses",    // Expenses
    "/app/crm/contacts",            // People
    "/app/crm/contacts",   // Pipeline
    "/app/work",              // Work
    "/app/work/projects",     // Projects
    "/app/schedule",          // Schedule
    "/app/schedule/bookings", // Bookings
    "/app/schedule/calendar", // Calendar
    "/app/inbox",             // Inbox
    "/app/communicate",       // Communicate
    "/app/communicate/campaigns", // Campaigns
    "/app/intelligence",      // Intelligence
    "/app/intelligence/reports", // Reports
    "/app/build",             // Build
    "/app/build/business",    // Business
    "/app/build/business/store", // Storefront
    "/app/build/system",      // System
    "/app/build/system/workspace", // Workspace
    "/app/build/automate",    // Automate
    "/app/build/automate/flows", // Flows
    "/app/profile",           // Profile
  ]),
  enterprise: new Set([
    // All routes — every path starting with /app is visible
    "*",
  ]),
};

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
  // A solopreneur: see the money, the people, and the diary. Nothing else.
  startup: [
    "Command Center",
    "Revenue", "Expenses",
    "Contacts", "Deals",
    "Calendar", "Bookings",
  ],
  // A team: add delivery, the shared inbox, campaigns and reporting.
  growth: [
    "Command Center", "KEY Inbox", "Data Inbox",
    "Revenue", "Expenses", "Budgeting", "Reports",
    "Contacts", "Deals", "Sequences", "Service",
    "Projects", "Tasks",
    "Calendar", "Bookings",
    "Campaigns",
    "Goals",
  ],
  // Everything. use-app-layout short-circuits on this mode, so the list is not
  // consulted — but it is kept accurate rather than decorative, because the
  // spec checks it and a wrong list is how the other two got wrong.
  enterprise: [
    "Command Center", "KEY Worker", "KEY Chat", "KEY Autonomy", "KEY Modes",
    "KEY Inbox", "Data Inbox", "Capture",
    "Financial Flow", "Revenue", "Expenses", "Budgeting", "Reports",
    "Temporal Flow", "Calendar", "Bookings", "Projects", "Tasks",
    "People Flow", "Contacts", "Sequences", "Intelligence", "Service", "Calls",
    "Commerce", "Deals",
    "Campaigns", "Content", "Social", "SEO",
    "Approvals", "Compliance", "Contracts", "Legal",
    "Executive Intelligence",
    "Market Strategy", "Goals", "Business Genome",
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
  startup: ["Business Genome", "Storefront", "Presence", "Account", "Workspace", "Key Connect"],
  growth: [
    "Business Genome", "Storefront", "Presence", "Templates",
    "Account", "Workspace", "Team", "AI",
    "Flows", "Key Connect",
  ],
  enterprise: [
    "Business Genome", "Storefront", "Presence", "Templates",
    "Account", "Workspace", "Team", "Structure", "AI", "Compliance", "Developers",
    "Flows", "Workflows", "Key Connect",
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

/** Check if a route is visible in the current mode. */
export function isRouteVisible(route: string, mode?: DisclosureMode): boolean {
  const m = mode ?? getDisclosureMode();
  const visible = MODE_VISIBILITY[m];
  if (visible.has("*")) return true;
  // Check exact match or parent route match
  if (visible.has(route)) return true;
  // Check if any visible prefix matches
  for (const prefix of visible) {
    if (route.startsWith(prefix + "/")) return true;
  }
  return false;
}

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
