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
  CreditCard,
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
  { id: "key-chat", label: "KEY", icon: Bot, href: "/app/key/chat" },
  { id: "operate", label: "Operate", icon: Briefcase },
  { id: "build", label: "Build", icon: Wrench },
  { id: "me", label: "Me", icon: User },
];

// ============================================================================
// OPERATE — Where you do your work
// Grouped by utility & frequency (see docs/UI_MODULE_MAP_AND_IA_REVIEW.md):
// daily-use surfaces first, dormant/placeholder surfaces stay out.
// ============================================================================

export const operateSections: NavSection[] = [
  {
    id: "today",
    label: "Today",
    icon: CalendarDays,
    items: [
      { label: "Command Center", href: "/app/command-center", icon: LayoutDashboard },
      { label: "Briefing", href: "/app/briefing", icon: Zap },
      { label: "Data Inbox", href: "/app/data-inbox", icon: Inbox },
      { label: "Calendar", href: "/app/calendar", icon: CalendarDays },
      { label: "Tasks", href: "/app/call-tasks", icon: CheckSquare },
      { label: "Bookings", href: "/app/bookings", icon: Calendar },
      { label: "Notifications", href: "/app/notifications", icon: Bell },
      { label: "Capture", href: "/app/capture", icon: Camera },
    ],
  },
  {
    id: "key-system",
    label: "KEY",
    icon: Bot,
    items: [
      { label: "KEY Chat", href: "/app/key/chat", icon: MessageSquare },
      { label: "KEY Worker", href: "/app/key", icon: Bot },
      { label: "KEY Autonomy", href: "/app/key-autonomy", icon: CheckSquare },
      { label: "KEY Modes", href: "/app/key-modes", icon: BrainCircuit },
    ],
  },
  {
    id: "money",
    label: "Money",
    icon: Banknote,
    items: [
      { label: "Financial Flow", href: "/app/financial-flow", icon: Banknote },
      { label: "Money", href: "/app/money", icon: TrendingUp },
      { label: "Commerce", href: "/app/commerce", icon: Receipt },
      { label: "Payment Gateway", href: "/app/commerce/gateway", icon: CreditCard },
      { label: "Expenses", href: "/app/expenses", icon: Receipt },
      { label: "Budgeting", href: "/app/budgeting", icon: Target },
      { label: "Payroll", href: "/app/payroll", icon: CreditCard },
      { label: "Reports", href: "/app/finance", icon: BarChart3 },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    icon: Users,
    items: [
      { label: "People Flow", href: "/app/people-flow", icon: Users },
      { label: "Contacts", href: "/app/crm/contacts", icon: Contact },
      { label: "Sequences", href: "/app/crm/sequences", icon: Send },
      { label: "Intelligence", href: "/app/crm/intelligence", icon: Brain },
      { label: "Helpdesk", href: "/app/helpdesk", icon: Headset },
      { label: "WhatsApp", href: "/app/whatsapp", icon: MessageSquare },
      { label: "Sales Team", href: "/app/sales-team", icon: Users },
      { label: "Performance", href: "/app/performance", icon: Activity },
    ],
  },
  {
    id: "growth",
    label: "Growth",
    icon: TrendingUp,
    items: [
      { label: "Marketing Flow", href: "/app/marketing-flow", icon: Megaphone },
      { label: "Campaigns", href: "/app/marketing", icon: Mail },
      { label: "Content", href: "/app/content-ops", icon: PenTool },
      { label: "Social", href: "/app/social", icon: Share2 },
      { label: "SEO", href: "/app/seo", icon: Globe },
      { label: "Storefront", href: "/app/store", icon: Store },
      { label: "Presence", href: "/app/presence", icon: Globe },
      { label: "Events & Ticketing", href: "/app/events", icon: Calendar },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    icon: BriefcaseBusiness,
    items: [
      { label: "Operations Flow", href: "/app/operations-flow", icon: BriefcaseBusiness },
      { label: "Projects", href: "/app/work/projects", icon: FolderKanban },
      { label: "Documents", href: "/app/documents", icon: FileText },
      { label: "Document Intelligence", href: "/app/document-intelligence", icon: BrainCircuit },
      { label: "Contracts", href: "/app/contracts", icon: FileText },
      { label: "Approvals", href: "/app/approvals", icon: CheckSquare },
      { label: "Evidence", href: "/app/evidence", icon: ShieldCheck },
      { label: "Legal", href: "/app/legal", icon: Scale },
      { label: "Time Tracking", href: "/app/time-tracking", icon: Clock },
      { label: "Procurement", href: "/app/procurement", icon: Truck },
    ],
  },
  {
    id: "intelligence",
    label: "Intelligence",
    icon: Brain,
    items: [
      { label: "Executive Intelligence", href: "/app/intelligence", icon: LayoutDashboard },
      { label: "Growth", href: "/app/growth", icon: TrendingUp },
      { label: "Market Strategy", href: "/app/market", icon: Target },
      { label: "Goals", href: "/app/goals", icon: Target },
      { label: "Business Genome", href: "/app/profile?tab=business-genome", icon: BrainCircuit },
    ],
  },
];

// Flattened Operate nav for disclosure-mode filtering and backward-compat
export const operateNav: NavItem[] = operateSections.flatMap((s) => s.items);

// ============================================================================
// BUILD — Where you configure your business
// ============================================================================

export const buildSections: NavSection[] = [
  {
    id: "business",
    label: "Business",
    icon: Building,
    items: [
      { label: "Business Genome", href: "/app/profile?tab=business-genome", icon: BrainCircuit },
      { label: "Storefront", href: "/app/commerce", icon: Store },
      { label: "Events", href: "/app/events", icon: Calendar },
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
      { label: "Trash", href: "/app/trash", icon: FileText },
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
      { label: "Workflows", href: "/app/workflows", icon: Layers },
      { label: "Automations", href: "/app/automations", icon: Zap },
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

export const mobileBottomNav = [
  { label: "Home", href: "/app/command-center", icon: Zap },
  { label: "Flows", href: "#flows", icon: Briefcase },
  { label: "AI", href: "#key", icon: Brain },
  { label: "Inbox", href: "/app/data-inbox", icon: Inbox },
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
