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
    "/app/commerce",          // Revenue
    "/app/crm/pipeline",      // Contacts
    "/app/bookings",          // Bookings
    "/app/calendar",          // Calendar
    "/app/store",             // Storefront
    "/app/profile",           // Profile
    "/app/settings",          // Settings
  ]),
  growth: new Set([
    "/app/keyflow-command",   // Cockpit
    "/app/commerce",          // Revenue
    "/app/crm/pipeline",      // Contacts
    "/app/bookings",          // Bookings
    "/app/calendar",          // Calendar
    "/app/automations",       // Flows
    "/app/projects",          // Projects
    "/app/inbox",             // Inbox
    "/app/marketing",         // Content
    "/app/reports",           // Reports
    "/app/expenses",          // Expenses
    "/app/finance",           // Finance
    "/app/store",             // Storefront
    "/app/profile",           // Profile
    "/app/settings",          // Settings
  ]),
  enterprise: new Set([
    // All routes — every path starting with /app is visible
    "*",
  ]),
};

/** Which workspace nav items are shown per mode.
 *  These labels must match the `label` field in workspacesNav exactly.
 */
export const MODE_WORKSPACE_ITEMS: Record<DisclosureMode, string[]> = {
  startup: ["Revenue", "Contacts", "Bookings", "Calendar"],
  growth: ["Revenue", "Contacts", "Bookings", "Calendar", "Flows", "Projects", "Inbox", "Content", "Helpdesk", "Structure"],
  enterprise: ["Revenue", "Contacts", "Bookings", "Calendar", "Flows", "Projects", "Inbox", "Content", "Helpdesk", "Structure"],
};

/** Which studio nav items are shown per mode.
 *  Both modes show Storefront + Settings.
 */
export const MODE_STUDIO_ITEMS: Record<DisclosureMode, string[]> = {
  startup: ["Storefront", "Settings"],
  growth: ["Storefront", "Settings"],
  enterprise: ["Storefront", "Settings"],
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
