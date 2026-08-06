"use client";

import type { LucideIcon } from "lucide-react";
import {
  Zap,
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
    id: "os-core",
    label: "Operating System",
    icon: Zap,
    items: [
      { label: "Command Center", href: "/app/command-center", icon: LayoutDashboard },
      { label: "KEY Worker", href: "/app/key", icon: Bot },
      { label: "KEY Chat", href: "/app/key/chat", icon: MessageSquare },
      { label: "KEY Autonomy", href: "/app/key-autonomy", icon: CheckSquare },
      { label: "KEY Modes", href: "/app/key-modes", icon: BrainCircuit },
      // KEY Inbox is the screen behind the four inbox_* tools — it reads the
      // same keyInboxThread data KeyInboxService writes. It had no nav entry,
      // so the tools' "do it yourself" link was unreachable, and they pointed
      // at /app/inbox, a DIFFERENT inbox over a different table entirely.
      { label: "KEY Inbox", href: "/app/key-inbox", icon: Inbox },
      { label: "Data Inbox", href: "/app/data-inbox", icon: Inbox },
      { label: "Capture", href: "/app/capture", icon: Camera },
    ],
  },
  {
    id: "financial-flow",
    label: "Financial Flow",
    icon: Banknote,
    items: [
      { label: "Financial Flow", href: "/app/financial-flow", icon: Banknote },
      { label: "Revenue", href: "/app/commerce", icon: TrendingUp },
      { label: "Expenses", href: "/app/expenses", icon: Receipt },
      { label: "Budgeting", href: "/app/budgeting", icon: Target },
      // Pointed at /app/finance, an 8-line redirect to /app/financial-flow —
      // the same destination as the "Financial Flow" entry directly above, so
      // this section had two labels for one screen and no way to reach the real
      // 546-line reports page.
      { label: "Reports", href: "/app/reports", icon: BarChart3 },
    ],
  },
  {
    id: "temporal-flow",
    label: "Temporal Flow",
    icon: Clock,
    items: [
      { label: "Temporal Flow", href: "/app/temporal-flow", icon: Clock },
      { label: "Calendar", href: "/app/calendar", icon: CalendarDays },
      { label: "Bookings", href: "/app/bookings", icon: Calendar },
      { label: "Projects", href: "/app/projects", icon: FolderKanban },
      { label: "Tasks", href: "/app/approvals", icon: CheckSquare },
    ],
  },
  {
    id: "people-flow",
    label: "People Flow",
    icon: Users,
    items: [
      { label: "People Flow", href: "/app/people-flow", icon: Users },
      { label: "Contacts", href: "/app/crm/contacts", icon: Contact },
      { label: "Sequences", href: "/app/crm/sequences", icon: Send },
      { label: "Intelligence", href: "/app/crm/intelligence", icon: Brain },
      { label: "Service", href: "/app/helpdesk", icon: Headset },
      // Five call_* tools point here; the screen is AddonPackGate pack="salesPack"
      // and had no nav entry.
      { label: "Calls", href: "/app/call-tasks", icon: MessageCircle, dormantFlag: "salesPack" },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    icon: TrendingUp,
    items: [
      { label: "Commerce", href: "/app/commerce", icon: Receipt },
      // Pointed at /app/crm/contacts. /app/crm/deals is a real 356-line deals
      // screen — forecast, stages, velocity, account pivot — and had no way in.
      { label: "Deals", href: "/app/crm/deals", icon: TrendingUp },
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
      // Seven seo_* tools declare /app/seo as their manual equivalent and the
      // screen had no nav entry at all, so a human could not reach the thing
      // KEY was allowed to do. The screen is AddonPackGate pack="webPresencePack";
      // the entry carries the same flag so the two appear and disappear together.
      { label: "SEO", href: "/app/seo", icon: Globe, dormantFlag: "webPresencePack" },
    ],
  },
  {
    id: "governance",
    label: "Governance",
    icon: ShieldCheck,
    items: [
      { label: "Approvals", href: "/app/approvals", icon: CheckSquare },
      { label: "Compliance", href: "/app/evidence", icon: ShieldCheck },
      { label: "Contracts", href: "/app/contracts", icon: FileText },
      { label: "Legal", href: "/app/legal", icon: Scale },
    ],
  },
  {
    id: "intelligence",
    label: "Intelligence",
    icon: Brain,
    items: [
      { label: "Executive Intelligence", href: "/app/intelligence", icon: LayoutDashboard },
      // Growth, Storefront and Documents were removed from this section on
      // 2026-08-06. All three fetch nothing, wait on a setTimeout to fake
      // network latency, and render invented business metrics — "7.4%
      // conversion", "$29.60 AOV", "94% accuracy". The pages still exist and the
      // layout work is reusable; they are simply not presented as product until
      // they read real data. See no-fabricated-screens.spec.ts.
    ],
  },
  {
    id: "strategy",
    label: "Strategy",
    icon: Target,
    items: [
      { label: "Market Strategy", href: "/app/market", icon: Target },
      { label: "Goals", href: "/app/goals", icon: Target },
      { label: "Business Genome", href: "/app/profile?tab=business-genome", icon: FileText },
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
      { label: "Business Genome", href: "/app/profile?tab=business-genome", icon: BrainCircuit },
      { label: "Storefront", href: "/app/commerce", icon: Store },
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
      { label: "Structure", href: "/app/structure", icon: Layers },
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
      { label: "Key Connect", href: "/app/key-connect", icon: Activity },
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
  { label: "Inbox", href: "/app/data-inbox", icon: Inbox, showUnreadBadge: true },
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
