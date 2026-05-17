import type { LucideIcon } from "lucide-react";
import {
  Zap,
  LayoutGrid,
  Wrench,
  Globe,
  Landmark,
  Users,
  Calendar,
  Mail,
  Megaphone,
  FileText,
  Package,
  Store,
  Shield,
  Image as ImageIcon,
  ClipboardCheck,
  Phone,
  LifeBuoy,
  Network,
  Activity,
  MessageCircle,
  BookOpen,
  Truck,
  Settings,
  User,
  Bell,
  Sparkles,
  FolderKanban,
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
  /**
   * Optional feature flag key. When set, the nav item is rendered as a
   * locked "coming soon" entry whenever the matching FeatureFlag in the
   * owner console is marked comingSoon and the current user is not on
   * its bypass list. See `/admin/feature-flags`.
   */
  featureKey?: string;
  /**
   * Optional dormant feature flag key. When set and the corresponding
   * static `featureFlags` entry is `false`, the nav item is hidden
   * entirely. See `lib/feature-flags.ts` (KEY-9 cleanup target).
   */
  dormantFlag?: DormantFeatureFlagKey;
}

// Legacy section ids preserved on PrimaryNavItem so older nav data and any
// downstream consumers that still grep on these tokens keep working even
// though the rail no longer renders Workspaces / Studio / Public groups.
type PrimarySectionId = "cockpit" | "tower" | "store" | "workspaces" | "studio" | "public" | "key";

export interface PrimaryNavItem {
  id: PrimarySectionId;
  label: string;
  icon: LucideIcon;
  href?: string;
}

// v2.0 Information Architecture: Cockpit / Workspaces / Studio / Public
// Leverage principles: money, time, people, scalability

// Rail: top-level surfaces + Cockpit + KEY
export const primaryNav: PrimaryNavItem[] = [
  { id: "cockpit", label: "Cockpit", icon: Zap, href: "/app/keyflow-command" },
  { id: "workspaces", label: "Workspaces", icon: LayoutGrid, href: undefined },
  { id: "studio", label: "Studio", icon: Wrench, href: undefined },
  { id: "public", label: "Public", icon: Globe, href: undefined },
];

// Workspaces = daily execution (money, time, people)
export const workspacesNav: NavItem[] = [
  { label: "Revenue", href: "/app/commerce", icon: Landmark },
  { label: "Contacts", href: "/app/crm/pipeline", icon: Users },
  { label: "Bookings", href: "/app/bookings", icon: Calendar },
  { label: "Calendar", href: "/app/calendar", icon: Calendar },
  { label: "Flows", href: "/app/automations", icon: Zap },
  { label: "Projects", href: "/app/projects", icon: FolderKanban },
  { label: "Inbox", href: "/app/inbox", icon: Mail },
  { label: "Content", href: "/app/marketing", icon: Megaphone, dormantFlag: "contentScheduler" },
  { label: "Content Ops", href: "/app/content-ops", icon: Package },
  { label: "Approvals", href: "/app/approvals", icon: Shield },
  { label: "Assets", href: "/app/assets", icon: ImageIcon },
  { label: "Evidence", href: "/app/evidence", icon: ClipboardCheck },
  { label: "Call Tasks", href: "/app/call-tasks", icon: Phone },
  { label: "Helpdesk", href: "/app/helpdesk", icon: LifeBuoy },
  { label: "Structure", href: "/app/structure", icon: Network },
  { label: "Operations", href: "/app/operations", icon: Activity },
];

// Studio = build & configure (scalability)
export const studioNav: NavItem[] = [
  { label: "Storefront", href: "/app/store", icon: Store },
  { label: "Settings", href: "/app/settings", icon: Settings },
];

// Public = customer-facing surfaces
export const publicNav: NavItem[] = [
  { label: "Intake Forms", href: "/app/crm/intake", icon: FileText },
  { label: "Business Profile", href: "/app/presence", icon: Globe },
];

// Dormant modules — rendered when feature flags enable them
export const comingSoonNav: NavItem[] = [
  { label: "Documents", href: "/app/documents", icon: FileText, dormantFlag: "documents" },
  { label: "Community", href: "/app/community", icon: MessageCircle, dormantFlag: "community" },
  { label: "Learn", href: "/app/learn", icon: BookOpen, dormantFlag: "learning" },
  { label: "Marketplace", href: "/app/marketplace", icon: Globe, dormantFlag: "marketplaceBrowsing" },
  { label: "Supplier", href: "/app/marketplace?tab=suppliers", icon: Truck, dormantFlag: "supplier" },
];

export const mobileBottomNav = [
  { label: "Cockpit", href: "/app/keyflow-command", icon: Zap },
  { label: "Workspaces", href: "#workspaces", icon: LayoutGrid },
  { label: "AI", href: "/app/keyflow-command?mode=key", icon: Sparkles },
  { label: "Notifications", href: "#notifications", icon: Bell },
  { label: "Profile", href: "/app/profile", icon: User },
];
