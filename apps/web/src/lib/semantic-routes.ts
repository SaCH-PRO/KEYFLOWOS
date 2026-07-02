/**
 * Semantic Route Registry
 *
 * Single source of truth for:
 * - breadcrumb labels,
 * - workspace classification,
 * - route aliases,
 * - tab mappings,
 * - entity type detection,
 * - parent category injection,
 * - related quick actions.
 *
 * This replaces the fragmented LABEL_MAP + WORKSPACE_MAP + ROUTE_ALIASES
 * + TAB_MAP scattered across origin-aware-breadcrumbs.tsx and nav-config.ts.
 */

import {
  type LucideIcon,
  Zap,
  Users,
  Banknote,
  Calendar,
  Store,
  Bot,
  Settings,
  FolderKanban,
  FileText,
  BarChart3,
  Cog,
  ShoppingCart,
  Receipt,
  Package,
  Clock,
  MessageSquare,
  Link,
  ShieldCheck,
  BookOpen,
  Truck,
  Briefcase,
  Target,
  Mail,
  CreditCard,
  Landmark,
  Phone,
  Globe,
  GraduationCap,
  Code,
  Bell,
  Image,
  Wallet,
  TrendingUp,
} from "lucide-react";

/* ────────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────────── */

export type WorkspaceId =
  | "cockpit"
  | "contacts"
  | "commerce"
  | "calendar"
  | "storefront"
  | "key"
  | "settings"
  | "finance"
  | "operations"
  | "reports"
  | "inbox"
  | "connect"
  | "team"
  | "governance";

export type EntityType =
  | "contact"
  | "invoice"
  | "quote"
  | "payment"
  | "booking"
  | "project"
  | "task"
  | "product"
  | "event"
  | "command"
  | "expense"
  | "deal"
  | "sequence"
  | "asset"
  | "document"
  | "sop"
  | "workflow"
  | "signal"
  | "rule";

export interface SemanticRoute {
  /** URL segment (e.g. "contacts", "invoices") */
  segment: string;
  /** Human-readable label */
  label: string;
  /** Workspace this route belongs to */
  workspace: WorkspaceId;
  /** Lucide icon (optional) */
  icon?: LucideIcon;
  /** If this segment represents a detail surface (has UUID child routes) */
  isDetailSurface?: boolean;
  /** If this segment is a config surface (shows "Return to …" origin link) */
  isConfigSurface?: boolean;
  /** Entity type for detail surfaces */
  entityType?: EntityType;
  /** Route alias — breadcrumb links that would 404 are remapped */
  alias?: string;
  /** Parent category crumbs injected before this segment */
  parentOverride?: Array<{ label: string; href: string }>;
  /** Tab mappings for ?tab= query params */
  tabs?: Record<string, string>;
  /** Related quick actions shown in breadcrumbs */
  relatedActions?: Array<{ label: string; href: string; icon?: LucideIcon }>;
  /** Whether this segment should render as plain text (no link) */
  noLink?: boolean;
}

/* ────────────────────────────────────────────────────────────────
 * Route Registry
 * ──────────────────────────────────────────────────────────────── */

export const SEMANTIC_ROUTES: SemanticRoute[] = [
  /* ─── Core ─── */
  { segment: "app", label: "Home", workspace: "cockpit", icon: Zap },
  { segment: "command-center", label: "Command Center", workspace: "cockpit", icon: Zap },
  { segment: "keyflow-command", label: "Command", workspace: "cockpit", icon: Zap },
  { segment: "control-tower", label: "KEYFLOW", workspace: "cockpit", icon: Zap },
  { segment: "key", label: "KEY", workspace: "key", icon: Bot },

  /* ─── Contacts ─── */
  { segment: "network", label: "Network", workspace: "contacts", icon: Users },
  { segment: "contacts", label: "Contacts", workspace: "contacts", icon: Users, isDetailSurface: true, entityType: "contact" },
  { segment: "crm", label: "Network", workspace: "contacts", icon: Users, alias: "/app/crm/contacts" },
  { segment: "pipeline", label: "Contacts", workspace: "contacts", icon: Users },
  { segment: "deals", label: "Deals", workspace: "contacts", icon: Target, isDetailSurface: true, entityType: "deal" },
  { segment: "sequences", label: "Sequences", workspace: "contacts", icon: Mail, isDetailSurface: true, entityType: "sequence" },

  /* ─── Commerce ─── */
  { segment: "commerce", label: "Revenue", workspace: "commerce", icon: Banknote, parentOverride: [{ label: "Financial Flow", href: "/app/money" }] },
  { segment: "invoices", label: "Invoices", workspace: "commerce", icon: Receipt, isDetailSurface: true, entityType: "invoice" },
  { segment: "quotes", label: "Quotes", workspace: "commerce", icon: FileText, isDetailSurface: true, entityType: "quote" },
  { segment: "products", label: "Products", workspace: "commerce", icon: Package, isDetailSurface: true, entityType: "product" },
  { segment: "payments", label: "Payments", workspace: "commerce", icon: CreditCard, isDetailSurface: true, entityType: "payment" },
  { segment: "recurring", label: "Recurring", workspace: "commerce", icon: Clock },
  { segment: "catalog", label: "Catalog", workspace: "commerce", icon: Package },

  /* ─── Calendar ─── */
  { segment: "calendar", label: "Calendar", workspace: "calendar", icon: Calendar },
  { segment: "bookings", label: "Bookings", workspace: "calendar", icon: Calendar, isDetailSurface: true, entityType: "booking" },

  /* ─── Storefront ─── */
  { segment: "store", label: "Presence", workspace: "storefront", icon: Store },
  { segment: "presence", label: "Presence", workspace: "storefront", icon: Store },

  /* ─── Finance ─── */
  { segment: "money", label: "Financial Flow", workspace: "finance", icon: Wallet },
  { segment: "finance", label: "Books", workspace: "finance", icon: BookOpen, parentOverride: [{ label: "Financial Flow", href: "/app/money" }] },
  { segment: "expenses", label: "Expenses", workspace: "finance", icon: Receipt, parentOverride: [{ label: "Financial Flow", href: "/app/money" }] },
  { segment: "budgeting", label: "Budgeting", workspace: "finance", icon: BarChart3, parentOverride: [{ label: "Financial Flow", href: "/app/money" }] },
  { segment: "accounts", label: "Accounts", workspace: "finance", icon: Landmark },
  { segment: "tax", label: "Tax", workspace: "finance", icon: ShieldCheck },
  { segment: "reconciliation", label: "Reconciliation", workspace: "finance", icon: ShieldCheck },
  { segment: "journal", label: "Journal", workspace: "finance", icon: BookOpen },

  /* ─── Operations ─── */
  { segment: "projects", label: "Projects", workspace: "operations", icon: FolderKanban, isDetailSurface: true, entityType: "project" },
  { segment: "tasks", label: "Tasks", workspace: "operations", icon: Briefcase, isDetailSurface: true, entityType: "task" },
  { segment: "automations", label: "Automations", workspace: "operations", icon: Cog },
  { segment: "workflows", label: "Workflows", workspace: "operations", icon: Cog },
  { segment: "operations", label: "Operations", workspace: "operations", icon: Cog },
  { segment: "sops", label: "SOPs", workspace: "operations", icon: FileText, isDetailSurface: true, entityType: "sop" },

  /* ─── Reports ─── */
  { segment: "reports", label: "Reports", workspace: "reports", icon: BarChart3, parentOverride: [{ label: "Financial Flow", href: "/app/money" }] },
  { segment: "analytics", label: "Analytics", workspace: "reports", icon: BarChart3 },
  { segment: "insights", label: "Insights", workspace: "reports", icon: TrendingUp },
  { segment: "intelligence", label: "Intelligence", workspace: "reports", icon: TrendingUp },

  /* ─── Inbox / Communications ─── */
  { segment: "inbox", label: "Inbox", workspace: "inbox", icon: Mail },
  { segment: "call-tasks", label: "Call Tasks", workspace: "inbox", icon: Phone, isDetailSurface: true, entityType: "task" },
  { segment: "content-ops", label: "Content", workspace: "inbox", icon: MessageSquare },
  { segment: "marketing", label: "Content", workspace: "inbox", icon: MessageSquare },
  { segment: "social", label: "Social", workspace: "inbox", icon: Globe },

  /* ─── Connect ─── */
  { segment: "connect", label: "Connect", workspace: "connect", icon: Link },
  { segment: "integrations", label: "Integrations", workspace: "connect", icon: Link },
  { segment: "webhooks", label: "Webhooks", workspace: "connect", icon: Code },

  /* ─── Team ─── */
  { segment: "settings", label: "Studio", workspace: "settings", icon: Settings, isConfigSurface: true },
  { segment: "structure", label: "Structure", workspace: "team", icon: Users },
  { segment: "team", label: "Team", workspace: "team", icon: Users },
  { segment: "profile", label: "Profile", workspace: "settings", icon: Users, isConfigSurface: true },

  /* ─── Misc ─── */
  { segment: "assets", label: "Assets", workspace: "operations", icon: Image, isDetailSurface: true, entityType: "asset" },
  { segment: "documents", label: "Documents", workspace: "operations", icon: FileText, isDetailSurface: true, entityType: "document" },
  { segment: "blueprint", label: "Blueprint", workspace: "settings", icon: Target },
  { segment: "templates", label: "Templates", workspace: "settings", icon: FileText },
  { segment: "notifications", label: "Notifications", workspace: "settings", icon: Bell },
  { segment: "approvals", label: "Approvals", workspace: "key", icon: ShieldCheck, isDetailSurface: true, entityType: "command" },
  { segment: "evidence", label: "Compliance", workspace: "settings", icon: ShieldCheck },
  { segment: "compliance", label: "Compliance", workspace: "settings", icon: ShieldCheck },
  { segment: "developers", label: "Developers", workspace: "settings", icon: Code, isConfigSurface: true },
  { segment: "api-keys", label: "API Keys", workspace: "settings", icon: Code },
  { segment: "helpdesk", label: "Helpdesk", workspace: "settings", icon: Phone },
  { segment: "marketplace", label: "Commerce", workspace: "connect", icon: ShoppingCart },
  { segment: "suppliers", label: "Suppliers", workspace: "connect", icon: Truck },
  { segment: "procurement", label: "Procurement", workspace: "operations", icon: Truck },
  { segment: "community", label: "Community", workspace: "connect", icon: GraduationCap },
  { segment: "learn", label: "MasterClass", workspace: "connect", icon: GraduationCap },
  { segment: "cohorts", label: "Cohorts", workspace: "connect", icon: GraduationCap },
  { segment: "onboarding", label: "Onboarding", workspace: "settings", icon: Target, isConfigSurface: true },
  { segment: "audiences", label: "Audiences", workspace: "inbox", icon: Users },
  { segment: "forms", label: "Forms", workspace: "inbox", icon: FileText },
  { segment: "retainers", label: "Agreements", workspace: "operations", icon: FileText },
  { segment: "change-orders", label: "Change Orders", workspace: "operations", icon: FileText },
  { segment: "time-tracking", label: "Time", workspace: "operations", icon: Clock },

  /* ─── Missing from original LABEL_MAP — added for completeness ─── */
  { segment: "actions", label: "Owed to You", workspace: "cockpit" },
  { segment: "business", label: "Business", workspace: "settings" },
  { segment: "certificates", label: "Certificates", workspace: "settings" },
  { segment: "dashboard", label: "Dashboard", workspace: "cockpit" },
  { segment: "feed", label: "Feed", workspace: "inbox" },
  { segment: "goals", label: "Goals", workspace: "operations" },
  { segment: "output-templates", label: "AI Output", workspace: "settings" },
  { segment: "performance", label: "Performance", workspace: "reports" },
  { segment: "security", label: "Security", workspace: "settings" },
  { segment: "studio", label: "Studio", workspace: "settings", isConfigSurface: true },

  /* ─── No-link segments (tabs without standalone pages) ─── */
  { segment: "overview", label: "Overview", workspace: "cockpit", noLink: true },
  { segment: "timeline", label: "Timeline", workspace: "cockpit", noLink: true },
  { segment: "notes", label: "Notes", workspace: "cockpit", noLink: true },
  { segment: "ai-insights", label: "AI Insights", workspace: "cockpit", noLink: true },
  { segment: "recommendations", label: "Recommendations", workspace: "cockpit", noLink: true },
  { segment: "quotes-invoices", label: "Quotes & Invoices", workspace: "commerce", noLink: true },
];

/* ────────────────────────────────────────────────────────────────
 * Tab Mappings
 * ──────────────────────────────────────────────────────────────── */

export const SEMANTIC_TAB_MAP: Record<string, Record<string, string>> = {
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
 * Route Aliases
 * ──────────────────────────────────────────────────────────────── */

export const SEMANTIC_ROUTE_ALIASES: Record<string, string> = {
  "/app/network": "/app/crm/contacts",
  "/app/crm": "/app/crm/contacts",
  "/app/crm/contacts": "/app/crm/contacts",
  "/app/money/books": "/app/finance",
  "/app/money/revenue": "/app/commerce",
  "/app/money/expenses": "/app/expenses",
  "/app/money/cashflow": "/app/money",
  "/app/money/intelligence": "/app/money",
};

/* ────────────────────────────────────────────────────────────────
 * Lookup Helpers
 * ──────────────────────────────────────────────────────────────── */

const bySegment = new Map<string, SemanticRoute>();
for (const route of SEMANTIC_ROUTES) {
  bySegment.set(route.segment, route);
}

export function getRouteBySegment(segment: string): SemanticRoute | undefined {
  return bySegment.get(segment);
}

export function getLabel(segment: string): string {
  return bySegment.get(segment)?.label ?? segment;
}

export function getWorkspace(segment: string): WorkspaceId {
  return bySegment.get(segment)?.workspace ?? "cockpit";
}

export function isDetailSurface(segment: string): boolean {
  return bySegment.get(segment)?.isDetailSurface ?? false;
}

export function isConfigSurface(segment: string): boolean {
  return bySegment.get(segment)?.isConfigSurface ?? false;
}

export function getEntityType(segment: string): EntityType | undefined {
  return bySegment.get(segment)?.entityType;
}

export function getTabLabel(path: string, tab: string): string | undefined {
  return SEMANTIC_TAB_MAP[path]?.[tab];
}

export function getAlias(path: string): string | undefined {
  return SEMANTIC_ROUTE_ALIASES[path];
}

export function getParentOverride(segment: string): Array<{ label: string; href: string }> | undefined {
  return bySegment.get(segment)?.parentOverride;
}

export function isNoLinkSegment(segment: string): boolean {
  return bySegment.get(segment)?.noLink ?? false;
}

/* ────────────────────────────────────────────────────────────────
 * Entity Resolution
 * ──────────────────────────────────────────────────────────────── */

export interface ResolvedEntity {
  id: string;
  type: EntityType;
  label: string;
  href: string;
  workspace: WorkspaceId;
}

/** Resolves a URL path into breadcrumb nodes with entity names.
 *  This is a client-side helper; actual entity names are fetched
 *  via the /api/entities/resolve endpoint for UUID segments.
 */
export function resolvePathToBreadcrumbNodes(
  pathname: string,
  searchParams?: URLSearchParams,
): Array<{ label: string; href: string; isLink: boolean }> {
  const segments = pathname.split("/").filter(Boolean);
  const appIndex = segments.indexOf("app");
  if (appIndex === -1) return [];

  const crumbs = segments.slice(appIndex + 1);
  if (crumbs.length === 0) return [];

  const nodes: Array<{ label: string; href: string; isLink: boolean }> = [];

  // Inject parent overrides for the top module
  const topModule = crumbs[0];
  const parentOverride = getParentOverride(topModule);
  if (parentOverride) {
    for (const p of parentOverride) {
      nodes.push({ label: p.label, href: p.href, isLink: true });
    }
  }

  for (let i = 0; i < crumbs.length; i++) {
    const segment = crumbs[i];
    const isLast = i === crumbs.length - 1;

    // Skip UUIDs — they are resolved separately
    if (isUuid(segment)) continue;

    const route = getRouteBySegment(segment);
    const label = route?.label ?? segment;
    const rawHref = "/app/" + crumbs.slice(0, i + 1).join("/");
    const href = getAlias(rawHref) ?? rawHref;
    const isLink = !isLast && !isNoLinkSegment(segment);

    nodes.push({ label, href, isLink });
  }

  // Append tab label if present
  if (searchParams) {
    const tab = searchParams.get("tab");
    if (tab) {
      const tabLabel = getTabLabel(pathname, tab);
      if (tabLabel) {
        nodes.push({ label: tabLabel, href: pathname + "?tab=" + tab, isLink: false });
      }
    }
  }

  return nodes;
}

function isUuid(s: string) {
  return /^[0-9a-f-]{20,}$/i.test(s);
}

/* ────────────────────────────────────────────────────────────────
 * Related Actions per Workspace
 * ──────────────────────────────────────────────────────────────── */

export function getWorkspaceRelatedActions(workspace: WorkspaceId): Array<{ label: string; href: string }> {
  switch (workspace) {
    case "contacts":
      return [
        { label: "Add contact", href: "/app/crm/contacts?action=add" },
        { label: "Import contacts", href: "/app/crm/contacts?action=import" },
        { label: "View follow-ups", href: "/app/crm/contacts?tab=follow-ups" },
      ];
    case "commerce":
      return [
        { label: "Create invoice", href: "/app/commerce/invoices?action=create" },
        { label: "Create quote", href: "/app/commerce/quotes?action=create" },
        { label: "Add product", href: "/app/commerce/products?action=add" },
      ];
    case "calendar":
      return [
        { label: "New booking", href: "/app/bookings?action=create" },
        { label: "New event", href: "/app/calendar?action=create" },
      ];
    case "storefront":
      return [
        { label: "Preview store", href: "/app/store?action=preview" },
        { label: "Add product", href: "/app/store?action=add-product" },
      ];
    case "finance":
      return [
        { label: "Record expense", href: "/app/expenses?action=create" },
        { label: "Reconcile", href: "/app/finance?action=reconcile" },
      ];
    case "operations":
      return [
        { label: "New project", href: "/app/projects?action=create" },
        { label: "New task", href: "/app/tasks?action=create" },
      ];
    case "key":
      return [
        { label: "Ask KEY", href: "/app/key?mode=ask" },
        { label: "View approvals", href: "/app/key?tab=approvals" },
      ];
    case "governance":
      return [
        { label: "Approvals", href: "/app/approvals" },
        { label: "Compliance", href: "/app/evidence" },
        { label: "Contracts", href: "/app/contracts" },
      ];
    default:
      return [];
  }
}
