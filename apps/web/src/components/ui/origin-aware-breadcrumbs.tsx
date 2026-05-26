"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { useNavigationContext } from "@/lib/navigation-context";

/* ────────────────────────────────────────────────────────────────
 * LABEL_MAP — single source of truth for breadcrumb labels.
 * Keep alphabetically sorted by key for maintainability.
 * ──────────────────────────────────────────────────────────────── */
const LABEL_MAP: Record<string, string> = {
  // Core
  app: "Home",

  // A
  accounts: "Accounts",
  actions: "Owed to You",
  "ai-insights": "AI Insights",
  analytics: "Analytics",
  approvals: "Approvals",
  audiences: "Audiences",
  automations: "Automations",

  // B
  billing: "Billing",
  blueprint: "Blueprint",
  bookings: "Calendar",
  books: "Books",
  budgets: "Budgets",
  business: "Business",

  // C
  calendar: "Calendar",
  "call-tasks": "Calls",
  catalog: "Catalog",
  certificates: "Certificates",
  cohorts: "Cohorts",
  commerce: "Revenue",
  community: "Community",
  compliance: "Compliance",
  connections: "Connections",
  "control-tower": "KEYFLOW",
  "content-ops": "Content",

  // D
  dashboard: "Dashboard",
  deals: "Deals",
  developers: "Developers",
  documents: "Documents",

  // E
  evidence: "Compliance",
  expenses: "Expenses",

  // F
  feed: "Feed",
  finance: "Books",
  forms: "Forms",

  // G
  goals: "Goals",

  // H
  helpdesk: "Service",

  // I
  insights: "Insights",
  integrations: "Integrations",
  intelligence: "Intelligence",
  invoices: "Invoices",
  "api-keys": "API Keys",

  // J
  journal: "Journal",

  // K
  "keyflow-command": "Command",

  // L
  learn: "Learn",

  // M
  marketplace: "Marketplace",
  marketing: "Content",
  money: "Overview",

  // N
  notes: "Notes",
  notifications: "Notifications",

  // O
  onboarding: "Onboarding",
  operations: "Operations",
  "output-templates": "AI Output",
  overview: "Overview",

  // P
  payments: "Payments",
  performance: "Performance",
  pipeline: "Clients",
  procurement: "Procurement",
  products: "Products",
  profile: "Profile",
  projects: "Projects",

  // Q
  "quotes-invoices": "Quotes & Invoices",
  quotes: "Quotes",

  // R
  recommendations: "Recommendations",
  reconciliation: "Reconciliation",
  recurring: "Recurring",
  reports: "Reports",
  "books-pnl": "Books",
  "books-cashflow": "Books",
  "books-balance-sheet": "Books",
  "books-ar-aging": "Books",
  "books-ap-aging": "Books",
  "books-tax": "Books",
  retainers: "Agreements",

  // S
  schedule: "Schedule",
  security: "Security",
  sequences: "Sequences",
  settings: "Studio",
  social: "Social",
  store: "Presence",
  studio: "Studio",
  suppliers: "Suppliers",

  // T
  tasks: "Tasks",
  tax: "Tax",
  templates: "Templates",
  timeline: "Timeline",

  // U

  // W
  webhooks: "Webhooks",
  workflows: "Workflows",

  // Misc
  "change-orders": "Change Orders",
  contacts: "Clients",
  crm: "CRM",
  "time-tracking": "Time",
  inbox: "Inbox",
  presence: "Presence",
  connect: "Connect",
};

/* ────────────────────────────────────────────────────────────────
 * ROUTE_ALIASES — breadcrumb links that would 404 are remapped
 * to their actual list / index pages.
 * ──────────────────────────────────────────────────────────────── */
const ROUTE_ALIASES: Record<string, string> = {
  "/app/crm/contacts": "/app/crm/pipeline",
  "/app/crm/deals": "/app/crm/deals",
  "/app/money/books": "/app/finance",
  "/app/money/revenue": "/app/commerce",
  "/app/money/expenses": "/app/expenses",
  "/app/money/cashflow": "/app/money",
  "/app/money/intelligence": "/app/money",
};

/* ────────────────────────────────────────────────────────────────
 * NO_LINK_SEGMENTS — intermediate crumbs that are just container
 * categories without their own page. Rendered as plain text.
 * ──────────────────────────────────────────────────────────────── */
const PARENT_OVERRIDES: Record<string, Array<{ label: string; href: string }>> = {
  money: [{ label: "Financial Flow", href: "/app/money" }],
  commerce: [{ label: "Financial Flow", href: "/app/money" }],
  expenses: [{ label: "Financial Flow", href: "/app/money" }],
  finance: [{ label: "Financial Flow", href: "/app/money" }],
  reports: [{ label: "Financial Flow", href: "/app/money" }],
};

const NO_LINK_SEGMENTS = new Set([
  // CRM contact detail tabs have no standalone pages
  "overview",
  "timeline",
  "tasks",
  "notes",
  "ai-insights",
  "recommendations",
  "quotes-invoices",
]);

/* ────────────────────────────────────────────────────────────────
 * TAB_MAP — ?tab= query params mapped to human labels per page.
 * ──────────────────────────────────────────────────────────────── */
const TAB_MAP: Record<string, Record<string, string>> = {
  "/app/commerce": {
    snapshot: "Snapshot",
    pipeline: "Pipeline",
    recurring: "Recurring",
  },
  "/app/expenses": {
    snapshot: "Snapshot",
    pipeline: "Pipeline",
    budgets: "Budgets",
    categories: "Categories",
    insights: "Insights",
  },
  "/app/finance": {
    snapshot: "Snapshot",
    cashflow: "Cashflow",
    accounts: "Accounts",
    journal: "Journal",
  },
  "/app/reports": {
    executive: "Executive Summary",
    pnl: "Profit & Loss",
    revenue: "Revenue & Collections",
    "revenue-detail": "Revenue Reports",
    "cash-flow": "Cash Flow Forecast",
    expenses: "Expenses & Profitability",
    clients: "Client Portfolio",
    bookings: "Bookings Performance",
    marketing: "Marketing ROI",
    "books-pnl": "Books · PnL",
    "books-cashflow": "Books · Cashflow",
    "books-balance-sheet": "Balance Sheet",
    "books-ar-aging": "A/R Aging",
    "books-ap-aging": "A/P Aging",
    "books-tax": "Tax Summary",
  },
  "/app/payments": {
    transactions: "Recent activity",
    links: "Payment links",
    refunds: "Refunds",
  },
  "/app/bookings": {
    schedule: "Schedule",
    performance: "Performance",
    setup: "Setup",
  },
  "/app/accounting": {
    invoices: "Invoices",
    customers: "Customers",
    "chart-of-accounts": "Chart of Accounts",
  },
  "/app/marketplace": {
    suppliers: "Suppliers",
  },
  "/app/settings": {
    profile: "Profile",
    connections: "Connections",
    ai: "AI",
    compliance: "Compliance",
    developers: "Developers",
    billing: "Billing",
  },
};

/* ────────────────────────────────────────────────────────────────
 * SURFACE DETECTION — controls the "Return to …" origin link.
 * ──────────────────────────────────────────────────────────────── */
const CONFIG_SURFACES = new Set([
  "settings",
  "studio",
  "onboarding",
  "profile",
  "branding",
]);

const DETAIL_SURFACES = new Set([
  "contacts",
  "deals",
  "invoices",
  "quotes",
  "products",
  "projects",
  "bookings",
  "sequences",
  "call-tasks",
  "content-ops",
  "evidence",
  "approvals",
  "assets",
  "plans",
  "documents",
]);

function isUuid(s: string) {
  return /^[0-9a-f-]{20,}$/i.test(s);
}

/* ─── Flow Connector between crumbs ─── */
function FlowConnector() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mx-0.5 opacity-40">
      <path
        d="M4 8h8M9 5l3 3-3 3"
        stroke="url(#crumbGradient)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="crumbGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="hsl(var(--kf-accent1))" />
          <stop offset="100%" stopColor="hsl(var(--kf-accent2))" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function OriginAwareBreadcrumbs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { getOriginContext } = useNavigationContext();
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length <= 1) return null;

  const appIndex = segments.indexOf("app");
  if (appIndex === -1) return null;

  const crumbs = segments.slice(appIndex + 1);
  if (crumbs.length === 0) return null;

  const topModule = crumbs[0];
  const isConfigSurface = CONFIG_SURFACES.has(topModule);
  const isDetailSurface =
    crumbs.length > 1 && DETAIL_SURFACES.has(topModule) && crumbs.some(isUuid);

  const origin = isHydrated ? getOriginContext() : null;
  const showOriginContext =
    (isConfigSurface || isDetailSurface) && origin && origin.route !== pathname;

  /* ── Build intermediate hrefs with alias resolution ── */
  const crumbMeta = crumbs.map((segment, idx) => {
    if (isUuid(segment)) return null;

    const rawHref = "/app/" + crumbs.slice(0, idx + 1).join("/");
    const aliasedHref = ROUTE_ALIASES[rawHref] ?? rawHref;
    const hasAlias = aliasedHref !== rawHref;

    // Determine if this segment should be a link:
    // 1. Last crumb is always plain text
    // 2. UUID-preceding crumb is plain text
    // 3. Segments in NO_LINK_SEGMENTS are plain text (they're detail tabs)
    // 4. Segments with aliases are links (they redirect to a real page)
    const isLast =
      idx === crumbs.length - 1 ||
      (idx === crumbs.length - 2 && isUuid(crumbs[crumbs.length - 1]));

    const isNoLink = NO_LINK_SEGMENTS.has(segment);
    const isLinkable = !isLast && !isNoLink;

    return {
      segment,
      href: isLinkable ? aliasedHref : undefined,
      label: LABEL_MAP[segment] || segment.charAt(0).toUpperCase() + segment.slice(1),
      isLast,
      hasAlias,
    };
  });

  /* ── Active tab label (if any) ── */
  const tabParam = searchParams.get("tab");
  const viewParam = searchParams.get("view");
  let tabLabel: string | null = null;
  if (tabParam) {
    // Find the deepest matching base path in TAB_MAP
    const basePaths = Object.keys(TAB_MAP).sort((a, b) => b.length - a.length);
    for (const base of basePaths) {
      if (pathname === base || pathname.startsWith(base + "/")) {
        tabLabel = TAB_MAP[base]?.[tabParam] ?? null;
        break;
      }
    }
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-0.5 text-xs text-muted-foreground px-1 py-1.5 flex-wrap"
    >
      <AnimatePresence mode="popLayout">
        {showOriginContext && origin && (
          <motion.span
            key="origin"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className="flex items-center gap-1"
          >
            <Link
              href={origin.route}
              className="flex items-center gap-1 text-muted-foreground/70 hover:text-foreground transition-colors group"
              title={`Return to ${origin.workspace ?? "previous page"}`}
            >
              <ChevronLeft className="w-3 h-3 text-muted-foreground/50 group-hover:text-[hsl(var(--kf-accent2))] transition-colors" />
              <span className="italic">
                {origin.workspace ?? "Previous"}
                {origin.tab
                  ? ` › ${origin.tab.charAt(0).toUpperCase() + origin.tab.slice(1)}`
                  : ""}
                {origin.selectedEntityLabel
                  ? ` › ${origin.selectedEntityLabel}`
                  : ""}
              </span>
            </Link>
            <FlowConnector />
          </motion.span>
        )}
      </AnimatePresence>

      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.05 }}
      >
        <Link href="/app" className="hover:text-foreground transition-colors">
          Home
        </Link>
      </motion.span>

      {crumbMeta.flatMap((meta, idx) => {
        if (!meta) return [];
        const { segment, href, label, isLast } = meta;

        const parentOverride = PARENT_OVERRIDES[segment];
        const items: React.ReactNode[] = [];

        if (parentOverride) {
          parentOverride.forEach((parent, pIdx) => {
            items.push(
              <motion.span
                key={`parent-${segment}-${pIdx}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  delay: idx * 0.04 + 0.05,
                  type: "spring",
                  stiffness: 400,
                  damping: 25,
                }}
                className="flex items-center gap-0.5"
              >
                <FlowConnector />
                <Link href={parent.href} className="hover:text-foreground transition-colors">
                  {parent.label}
                </Link>
              </motion.span>
            );
          });
        }

        // For /app/commerce and /app/expenses with tabs, render tab + view as separate crumbs
        const isTabbedPage = (segment === "commerce" || segment === "expenses") && tabParam && tabLabel;
        const viewLabel = viewParam ? viewParam.charAt(0).toUpperCase() + viewParam.slice(1) : null;

        if (isTabbedPage) {
          // Module crumb (linkable)
          items.push(
            <motion.span
              key={segment + idx}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                delay: idx * 0.04 + 0.05,
                type: "spring",
                stiffness: 400,
                damping: 25,
              }}
              className="flex items-center gap-0.5"
            >
              <FlowConnector />
              <Link href={href ?? `/app/${segment}`} className="hover:text-foreground transition-colors">
                {label}
              </Link>
            </motion.span>
          );
          // Tab crumb (linkable, not last if view exists)
          items.push(
            <motion.span
              key={`tab-${tabParam}`}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                delay: idx * 0.04 + 0.08,
                type: "spring",
                stiffness: 400,
                damping: 25,
              }}
              className="flex items-center gap-0.5"
            >
              <FlowConnector />
              <Link href={`/app/${segment}?tab=${tabParam}`} className="hover:text-foreground transition-colors">
                {tabLabel}
              </Link>
            </motion.span>
          );
          // View crumb (last, plain text)
          if (viewLabel) {
            items.push(
              <motion.span
                key={`view-${viewParam}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  delay: idx * 0.04 + 0.11,
                  type: "spring",
                  stiffness: 400,
                  damping: 25,
                }}
                className="flex items-center gap-0.5"
              >
                <FlowConnector />
                <span className="text-foreground font-medium relative">
                  {viewLabel}
                  <motion.span
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    className="absolute -bottom-0.5 left-0 right-0 h-[2px] rounded-full origin-left"
                    style={{
                      background:
                        "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                    }}
                  />
                </span>
              </motion.span>
            );
          }
        } else {
          items.push(
            <motion.span
              key={segment + idx}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                delay: idx * 0.04 + 0.05,
                type: "spring",
                stiffness: 400,
                damping: 25,
              }}
              className="flex items-center gap-0.5"
            >
              <FlowConnector />
              {isLast ? (
                <span className="text-foreground font-medium relative">
                  {/* Books tabs on reports page show "Books" instead of "Reports › Books · PnL" */}
                  {tabParam?.startsWith("books-") && segment === "reports" ? "Books" : label}
                  {tabLabel && !(tabParam?.startsWith("books-") && segment === "reports") && (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      › {tabLabel}
                    </span>
                  )}
                  {isDetailSurface &&
                    idx ===
                      crumbs.length - (isUuid(crumbs[crumbs.length - 1]) ? 2 : 1) && (
                      <motion.span
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        className="absolute -bottom-0.5 left-0 right-0 h-[2px] rounded-full origin-left"
                        style={{
                          background:
                            "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                        }}
                      />
                    )}
                </span>
              ) : href ? (
                <Link
                  href={href}
                  className="hover:text-foreground transition-colors"
                >
                  {label}
                </Link>
              ) : (
                <span className="text-muted-foreground/60">{label}</span>
              )}
            </motion.span>
          );
        }

        return items;
      })}
    </nav>
  );
}
