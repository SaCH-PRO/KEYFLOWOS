"use client";

import type { LucideIcon } from "lucide-react";
import {
  Zap,
  Boxes,
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
  BriefcaseBusiness,
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
  Plug,
  Mail,
  FileText,
  RefreshCw,
  Layers,
  BookOpen,
  Truck,
  Bell,
  LayoutDashboard,
  TrendingUp,
  Camera,
  Inbox,
} from "lucide-react";
import type { DormantFeatureFlagKey } from "./feature-flags";

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
  exactMatch?: boolean;
  featureKey?: string;
  dormantFlag?: DormantFeatureFlagKey;
}

export interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

export type DrawerSurface = "operate" | "build" | "me" | null;

export interface PrimaryNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
}

// ============================================================================
// PRIMARY RAIL
// ============================================================================

export const primaryNav: PrimaryNavItem[] = [
  { id: "cockpit", label: "Cockpit", icon: Zap, href: "/app/command-center" },
  { id: "operate", label: "Operate", icon: Briefcase },
  { id: "build", label: "Build", icon: Wrench },
  { id: "me", label: "Me", icon: User },
];

// ============================================================================
// OPERATE — Where you do your work
// All hrefs point to existing working pages (content migration happens later)
// ============================================================================

export const operateSections: NavSection[] = [
  {
    id: "key",
    label: "KEY",
    icon: Bot,
    items: [
      { label: "Chat", href: "/app/key/chat", icon: MessageSquare },
      { label: "Inbox", href: "/app/key-inbox", icon: Inbox },
      { label: "Worker", href: "/app/key", icon: Bot },
      { label: "Autonomy", href: "/app/key-autonomy", icon: CheckSquare },
      { label: "Modes", href: "/app/key-modes", icon: BrainCircuit },
      { label: "Data Inbox", href: "/app/data-inbox", icon: Layers },
      { label: "Capture", href: "/app/capture", icon: Camera },
    ],
  },
  {
    id: "money",
    label: "Money",
    icon: Banknote,
    items: [
      { label: "Overview", href: "/app/financial-flow", icon: Banknote },
      { label: "Sales", href: "/app/commerce", icon: Receipt },
      // Stock is money you have already spent and not yet earned back, so it
      // belongs beside Sales rather than in a systems menu. It had no nav entry
      // at all until 2026-08-07 — the command centre was a tab inside a
      // dormant-flagged marketplace page, behind a redirect to a tab that did
      // not exist.
      { label: "Inventory", href: "/app/inventory", icon: Boxes },
      { label: "Expenses", href: "/app/expenses", icon: Receipt },
      { label: "Budgets", href: "/app/budgeting", icon: Target },
      { label: "Reports", href: "/app/reports", icon: BarChart3 },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    icon: Users,
    items: [
      { label: "Overview", href: "/app/people-flow", icon: Users },
      { label: "Contacts", href: "/app/crm/contacts", icon: Contact },
      { label: "Deals", href: "/app/crm/deals", icon: TrendingUp },
      { label: "Sequences", href: "/app/crm/sequences", icon: Send },
      { label: "Support", href: "/app/helpdesk", icon: Headset },
      { label: "Calls", href: "/app/call-tasks", icon: MessageCircle, dormantFlag: "salesPack" },
      { label: "Insights", href: "/app/crm/intelligence", icon: Brain },
    ],
  },
  {
    id: "schedule",
    label: "Schedule",
    icon: CalendarDays,
    items: [
      { label: "Overview", href: "/app/temporal-flow", icon: Clock },
      { label: "Calendar", href: "/app/calendar", icon: CalendarDays },
      { label: "Bookings", href: "/app/bookings", icon: Calendar },
    ],
  },
  {
    id: "work",
    label: "Work",
    icon: FolderKanban,
    items: [
      { label: "Projects", href: "/app/projects", icon: FolderKanban },
      { label: "Approvals", href: "/app/approvals", icon: CheckSquare },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    icon: Megaphone,
    items: [
      { label: "Campaigns", href: "/app/marketing", icon: Mail },
      { label: "Content", href: "/app/content-ops", icon: PenTool },
      { label: "Social", href: "/app/social", icon: Share2 },
      { label: "SEO", href: "/app/seo", icon: Globe, dormantFlag: "webPresencePack" },
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    icon: ShieldCheck,
    items: [
      { label: "Evidence", href: "/app/evidence", icon: ShieldCheck },
      { label: "Contracts", href: "/app/contracts", icon: FileText },
      { label: "Legal", href: "/app/legal", icon: Scale },
    ],
  },
  {
    id: "strategy",
    label: "Strategy",
    icon: Target,
    items: [
      { label: "Insights", href: "/app/intelligence", icon: LayoutDashboard },
      { label: "Goals", href: "/app/goals", icon: Target },
      { label: "Market", href: "/app/market", icon: Target },
    ],
  },
];


// Flattened Operate nav for disclosure-mode filtering and backward-compat
export const operateNav: NavItem[] = operateSections.flatMap((s) => s.items);

// ============================================================================
// BUILD — Where you configure your business
// All hrefs point to existing working pages
// ============================================================================

export const buildSections: NavSection[] = [
  {
    id: "business",
    label: "Business",
    icon: Building,
    items: [
      { label: "Profile", href: "/app/profile?tab=business-genome", icon: BrainCircuit },
      { label: "Storefront", href: "/app/store", icon: Store },
      { label: "Presence", href: "/app/presence", icon: Globe },
      { label: "Templates", href: "/app/templates", icon: GraduationCap },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: Cog,
    items: [
      { label: "Account", href: "/app/settings/profile", icon: User },
      { label: "Workspace", href: "/app/settings", icon: Building },
      { label: "Team", href: "/app/settings/team", icon: Users },
      { label: "Org Chart", href: "/app/structure", icon: Layers },
      { label: "AI", href: "/app/settings/ai", icon: Bot },
      { label: "Compliance", href: "/app/settings/compliance", icon: ShieldCheck },
      { label: "Developers", href: "/app/settings/developers", icon: Code },
    ],
  },
  {
    id: "connect",
    label: "Connect",
    icon: Plug,
    items: [
      { label: "Integrations", href: "/app/key-connect", icon: Activity },
    ],
  },
  {
    id: "automate",
    label: "Automate",
    icon: Zap,
    items: [
      { label: "Flows", href: "/app/flows", icon: RefreshCw },
    ],
  },
];

// Flattened Build nav for disclosure-mode filtering and backward-compat
export const buildNav: NavItem[] = buildSections.flatMap((s) => s.items);

// ============================================================================
// MORE — Dormant / coming-soon modules (hidden by default, collapsible)
// ============================================================================

export const moreNav: NavItem[] = [
  { label: "Community", href: "/app/community", icon: MessageCircle, dormantFlag: "community" },
  { label: "Learn", href: "/app/learn", icon: BookOpen, dormantFlag: "learning" },
  { label: "Marketplace", href: "/app/marketplace", icon: Globe, dormantFlag: "marketplaceBrowsing" },
  { label: "Supplier", href: "/app/marketplace?tab=suppliers", icon: Truck, dormantFlag: "supplier" },
];

// ============================================================================
// ME — Personal hub
// ============================================================================

export const meNav: NavItem[] = [
  { label: "Profile", href: "/app/profile", icon: User },
  { label: "Notifications", href: "/app/notifications", icon: Bell },
];

// ============================================================================
// MOBILE BOTTOM NAV
// ============================================================================

/**
 * `showUnreadBadge` marks the item that carries the unread count.
 *
 * It was a route comparison in the component — `item.href === "/app/inbox"` —
 * against an href that is `/app/data-inbox` here. So the badge never rendered,
 * and nothing said so. A flag on the item cannot drift from itself the way two
 * copies of a route string can.
 */
export const mobileBottomNav: Array<{
  label: string;
  href: string;
  icon: LucideIcon;
  showUnreadBadge?: boolean;
}> = [
  { label: "Home", href: "/app/command-center", icon: Zap },
  { label: "Flows", href: "#flows", icon: Briefcase },
  { label: "AI", href: "#key", icon: Brain },
  { label: "Inbox", href: "/app/key-inbox", icon: Inbox, showUnreadBadge: true },
  { label: "Me", href: "#me", icon: User },
];

// ============================================================================
// BACKWARD COMPATIBILITY — Legacy exports
// ============================================================================

/** @deprecated Use operateNav instead */
export const workspacesNav = operateNav;
/** @deprecated Use buildNav instead */
export const studioNav = buildNav;
/** @deprecated Use buildSections[0].items instead */
export const publicNav: NavItem[] = buildSections[0].items;
/** @deprecated Use moreNav instead */
export const comingSoonNav = moreNav;
