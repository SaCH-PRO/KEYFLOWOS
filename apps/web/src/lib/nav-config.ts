"use client";

import type { LucideIcon } from "lucide-react";
import {
  Zap,
  Briefcase,
  Wrench,
  User,
  Landmark,
  Banknote,
  Receipt,
  BookOpenCheck,
  ArrowUpCircle,
  Users,
  Contact,
  Filter,
  Send,
  Brain,
  Headset,
  BriefcaseBusiness,
  FolderKanban,
  Clock,
  FileSignature,
  CheckSquare,
  Calendar,
  CalendarDays,
  Phone,
  MessageCircle,
  Inbox,
  Megaphone,
  PenTool,
  Share2,
  BarChart3,
  Target,
  Activity,
  ShieldCheck,
  Building,
  BrainCircuit,
  Store,
  Globe,
  GraduationCap,
  Cog,
  Link,
  Bot,
  Code,
  Plug,
  Search,
  Mail,
  CreditCard,
  Calculator,
  FileText,
  RefreshCw,
  Layers,
  BookOpen,
  Truck,
  Bell,
  Settings,
  LayoutDashboard,
  TrendingUp,
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
  { id: "cockpit", label: "Cockpit", icon: Zap, href: "/app/keyflow-command" },
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
    id: "financial-flow",
    label: "Financial Flow",
    icon: Banknote,
    items: [
      { label: "Overview", href: "/app/money", icon: LayoutDashboard },
      { label: "Revenue", href: "/app/commerce", icon: TrendingUp },
      { label: "Expenses", href: "/app/expenses", icon: Receipt },
      { label: "Budgeting", href: "/app/budgeting", icon: Target },
      { label: "Reports", href: "/app/reports", icon: BarChart3 },
    ],
  },
  {
    id: "network",
    label: "Network",
    icon: Users,
    items: [
      { label: "Contacts", href: "/app/network/contacts", icon: Contact },
      { label: "Sequences", href: "/app/crm/sequences", icon: Send },
      { label: "Intelligence", href: "/app/crm/intelligence", icon: Brain },
      { label: "Service", href: "/app/helpdesk", icon: Headset },
    ],
  },
  {
    id: "work",
    label: "Work",
    icon: BriefcaseBusiness,
    items: [
      { label: "Projects", href: "/app/projects", icon: FolderKanban },
      { label: "Time", href: "/app/time-tracking", icon: Clock },
      { label: "Agreements", href: "/app/retainers", icon: FileSignature },
      { label: "Tasks", href: "/app/approvals", icon: CheckSquare },
    ],
  },
  {
    id: "schedule",
    label: "Schedule",
    icon: Calendar,
    items: [
      { label: "Calendar", href: "/app/calendar", icon: CalendarDays },
      { label: "Bookings", href: "/app/bookings", icon: Calendar },
      { label: "Calls", href: "/app/call-tasks", icon: Phone },
    ],
  },
  {
    id: "communicate",
    label: "Communicate",
    icon: MessageCircle,
    items: [
      { label: "Inbox", href: "/app/inbox", icon: Inbox },
      { label: "Campaigns", href: "/app/marketing", icon: Megaphone },
      { label: "Content", href: "/app/content-ops", icon: PenTool },
      { label: "Social", href: "/app/social", icon: Share2 },
    ],
  },
  {
    id: "intelligence",
    label: "Intelligence",
    icon: BarChart3,
    items: [
      { label: "Reports", href: "/app/reports", icon: BarChart3 },
      { label: "Goals", href: "/app/goals", icon: Target },
      { label: "Operations", href: "/app/operations", icon: Activity },
      { label: "Compliance", href: "/app/evidence", icon: ShieldCheck },
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
      { label: "Blueprint", href: "/app/blueprint", icon: BrainCircuit },
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
      { label: "Connections", href: "/app/settings/connections", icon: Link },
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
      { label: "Overview", href: "/app/connect", icon: Activity },
      { label: "Google", href: "/app/connect", icon: Search },
      { label: "Microsoft", href: "/app/connect", icon: Mail },
      { label: "Payments", href: "/app/connect", icon: CreditCard },
      { label: "Accounting", href: "/app/connect", icon: Calculator },
      { label: "Marketing", href: "/app/connect", icon: Megaphone },
      { label: "Social", href: "/app/connect", icon: Share2 },
      { label: "Forms", href: "/app/connect", icon: FileText },
      { label: "WhatsApp", href: "/app/connect", icon: MessageCircle },
    ],
  },
  {
    id: "automate",
    label: "Automate",
    icon: Zap,
    items: [
      { label: "Flows", href: "/app/automations", icon: RefreshCw },
      { label: "Workflows", href: "/app/workflows", icon: Layers },
    ],
  },
];

// Flattened Build nav for disclosure-mode filtering and backward-compat
export const buildNav: NavItem[] = buildSections.flatMap((s) => s.items);

// ============================================================================
// MORE — Dormant / coming-soon modules (hidden by default, collapsible)
// ============================================================================

export const moreNav: NavItem[] = [
  { label: "Documents", href: "/app/documents", icon: FileText },
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
  { label: "Preferences", href: "/app/settings/profile", icon: Settings },
];

// ============================================================================
// MOBILE BOTTOM NAV
// ============================================================================

export const mobileBottomNav = [
  { label: "Home", href: "/app/keyflow-command", icon: Zap },
  { label: "Operate", href: "#operate", icon: Briefcase },
  { label: "AI", href: "#key", icon: Brain },
  { label: "Inbox", href: "/app/inbox", icon: Mail },
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
