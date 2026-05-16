"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  getDisclosureMode,
  setDisclosureMode,
  MODE_LABELS,
  MODE_WORKSPACE_ITEMS,
  MODE_STUDIO_ITEMS,
  type DisclosureMode,
} from "@/lib/disclosure-mode";
import { KeyAgent } from "@/components/key";
import { OriginAwareBreadcrumbs } from "@/components/ui/origin-aware-breadcrumbs";
import { NavigationContextProvider, useNavigationContext } from "@/lib/navigation-context";
import { clearStoredBusinessId, getStoredBusinessId, getCachedUser, getUserDisplayName, getUserInitials, refreshWorkspace, getCachedBusiness, isSuperAdmin } from "@/lib/workspace";
import { apiGet, apiPatch } from "@/lib/api";
import { useThemeColors } from "@/lib/theme-context";
import {
  Settings,
  Users,
  CreditCard,
  Calendar,
  Bell,
  Plus,
  ChevronDown,
  BarChart3,
  LogOut,
  Search,
  Zap,
  MessageCircle,
  Store,
  Menu,
  X,
  MoreHorizontal,
  Receipt,
  Megaphone,
  FolderKanban,
  FileText,
  User,
  Sparkles,
  Gauge,
  LayoutGrid,
  Wrench,
  Globe,
  Package,
  Palette,
  Plug,
  Mail,
  BookOpen,
  ChevronRight,
  Users2,
  Shield,
  Brain,
  Radar,
  Award,
  Lock,
  Search as SearchIcon2,
  Landmark,
  Calculator,
  Building2,
  Network,
  Truck,
  ShoppingCart,
  TrendingUp,
  Briefcase,
  Share2,
  LifeBuoy,
  Activity,
} from "lucide-react";

interface ResolvedFeatureFlag {
  key: string;
  label: string;
  category: string | null;
  comingSoon: boolean;
  bypass: boolean;
}


import type { CopilotModule } from "@/components/ai/copilot-panel";
import { AiContextProvider } from "@/contexts/ai-context";
import { usePlanLimitHandler } from "@/hooks/use-plan";
import { PlanLimitDialog } from "@/components/ui/upgrade-prompt";
import { KeyflowOSStoreDrawer } from "@/components/keyflowos-store-drawer";
import { MobileFab } from "@/components/ui/mobile-fab";
import { RequireAuth } from "@/components/require-auth";
import { featureFlags as dormantFeatureFlags, type DormantFeatureFlagKey } from "@/lib/feature-flags";
import { NotesProvider } from "@/components/keyflow/notes-context";
import { KeyflowNotesDrawer } from "@/components/keyflow/keyflow-notes-drawer";
import { NotesQueryParamTrigger } from "@/components/keyflow/notes-query-param-trigger";
import dynamic from "next/dynamic";

const MissionsButton = dynamic(
  () => import("@/components/ui/missions-button").then((m) => m.MissionsButton),
  { ssr: false, loading: () => null },
);

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

interface AppNotification {
  id: string;
  title?: string;
  body?: string;
  type?: string;
  category?: string;
  read?: boolean;
  createdAt: string;
  link?: string;
  href?: string;
  data?: { link?: string; [key: string]: unknown };
  [key: string]: unknown;
}

function getNotificationIcon(n: AppNotification): typeof Bell {
  const type = (n.type || n.category || "").toLowerCase();
  const title = (n.title || "").toLowerCase();
  if (type.includes("invoice") || title.includes("invoice") || title.includes("payment")) return Receipt;
  if (type.includes("booking") || title.includes("booking") || title.includes("appointment")) return Calendar;
  if (type.includes("contact") || title.includes("contact") || title.includes("lead")) return Users;
  if (type.includes("campaign") || title.includes("campaign") || title.includes("marketing")) return Megaphone;
  if (type.includes("project") || title.includes("project") || title.includes("task")) return FolderKanban;
  if (type.includes("expense") || title.includes("expense")) return Receipt;
  if (type.includes("automation") || title.includes("automation") || title.includes("playbook")) return Zap;
  if (type.includes("endorsement") || title.includes("endorsed")) return Award;
  if (type.includes("connector") || title.includes("reconnect")) return Plug;
  return Bell;
}

function getNotificationLink(n: AppNotification): string | null {
  const type = (n.type || n.category || "").toLowerCase();
  const title = (n.title || "").toLowerCase();
  if (type.includes("invoice") || title.includes("invoice")) return "/app/commerce?tab=invoices";
  if (type.includes("payment") || title.includes("payment")) return "/app/commerce?tab=payments";
  if (type.includes("booking") || title.includes("booking") || title.includes("appointment")) return "/app/bookings";
  if (type.includes("contact") || title.includes("contact") || title.includes("lead")) return "/app/crm/pipeline";
  if (type.includes("campaign") || title.includes("campaign")) return "/app/marketing";
  if (type.includes("project") || title.includes("project")) return "/app/projects";
  if (type.includes("expense") || title.includes("expense")) return "/app/expenses";
  if (type.includes("automation") || title.includes("automation")) return "/app/automations";
  if (type.includes("endorsement") && n.data?.link) return n.data.link;
  if (type.includes("connector") || title.includes("reconnect")) return "/app/connect";
  if (n.data?.link) return n.data.link;
  return n.link || n.href || null;
}

function NewEntityMenu({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = useState(-1);
  const items = useMemo(() => {
    const base = [
      { label: "Contact", icon: Users, href: "/app/crm/pipeline", shortcut: "⌘⇧C" },
      { label: "Invoice", icon: Receipt, href: "/app/commerce", shortcut: "⌘⇧I" },
      { label: "Quote", icon: FileText, href: "/app/commerce?tab=quotes" },
      { label: "Booking", icon: Calendar, href: "/app/bookings", shortcut: "⌘⇧B" },
      { label: "Expense", icon: Receipt, href: "/app/expenses" },
      { label: "Project", icon: FolderKanban, href: "/app/projects" },
      { label: "Flow", icon: Zap, href: "/app/automations" },
    ];
    if (dormantFeatureFlags.contentScheduler) {
      base.splice(6, 0,
        { label: "Campaign", icon: Megaphone, href: "/app/marketing" },
        { label: "Post", icon: MessageCircle, href: "/app/marketing?tab=social" },
      );
    }
    return base;
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((prev) => Math.min(prev + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && focusIdx >= 0) {
        e.preventDefault();
        router.push(items[focusIdx].href);
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focusIdx, items, onClose, router]);

  useEffect(() => {
    if (focusIdx >= 0) {
      const el = menuRef.current?.querySelector(`[data-menu-idx="${focusIdx}"]`) as HTMLElement | null;
      el?.focus();
    }
  }, [focusIdx]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div ref={menuRef} className="absolute right-0 mt-1.5 w-56 kf-glass-surface p-1.5 z-50 max-h-[70vh] overflow-y-auto" role="menu">
        {items.map((action, idx) => {
          const ActionIcon = action.icon;
          return (
            <Link
              key={action.label}
              href={action.href}
              data-menu-idx={idx}
              onClick={onClose}
              role="menuitem"
              className={cn(
                "flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-md text-sm hover:bg-muted transition-colors",
                focusIdx === idx && "bg-muted"
              )}
            >
              <div className="flex items-center gap-2.5">
                <ActionIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-[13px]">{action.label}</span>
              </div>
              {action.shortcut && (
                <kbd className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono text-muted-foreground">{action.shortcut}</kbd>
              )}
            </Link>
          );
        })}
      </div>
    </>
  );
}

interface NavItem {
  label: string;
  href: string;
  icon: typeof Zap;
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

interface PrimaryNavItem {
  id: PrimarySectionId;
  label: string;
  icon: typeof Gauge;
  href?: string;
}

// v2.0 Information Architecture: Cockpit / Workspaces / Studio / Public
// Leverage principles: money, time, people, scalability

// Rail: top-level surfaces + Cockpit + KEY
const primaryNav: PrimaryNavItem[] = [
  { id: "cockpit", label: "Cockpit", icon: Zap, href: "/app/keyflow-command" },
  { id: "workspaces", label: "Workspaces", icon: LayoutGrid, href: undefined },
  { id: "studio", label: "Studio", icon: Wrench, href: undefined },
  { id: "public", label: "Public", icon: Globe, href: undefined },
];

// Legacy section-based secondary nav retained for compatibility.
const _legacySecondaryNav: Record<string, NavItem[]> = {
  workspaces: [
    { label: "Revenue", href: "/app/commerce", icon: Landmark },
    { label: "Contacts", href: "/app/crm/pipeline", icon: Users },
    { label: "Bookings", href: "/app/bookings", icon: Calendar },
    { label: "Calendar", href: "/app/calendar", icon: Calendar },
    { label: "Flows", href: "/app/automations", icon: Zap },
    { label: "Projects", href: "/app/projects", icon: FolderKanban },
    { label: "Inbox", href: "/app/inbox", icon: Mail },
    { label: "Content", href: "/app/marketing", icon: Megaphone },
    { label: "Reports", href: "/app/reports", icon: BarChart3 },
    { label: "Documents", href: "/app/documents", icon: FileText, featureKey: "nav.workspaces.documents" },
    { label: "SEO", href: "/app/seo", icon: SearchIcon2, featureKey: "nav.workspaces.seo" },
  ],
  studio: [
    { label: "Business", href: "/app/settings/business", icon: Building2 },
    { label: "Products", href: "/app/store?tab=catalog", icon: Package, matchTab: "catalog" },
    { label: "Services", href: "/app/bookings?tab=catalog", icon: Briefcase, matchTab: "catalog" },
    { label: "Storefront", href: "/app/store", icon: Store },
    { label: "Branding", href: "/app/profile", icon: Palette },
    { label: "Flows", href: "/app/automations", icon: Zap },
    { label: "Team", href: "/app/settings/team", icon: Users2 },
    { label: "Integrations", href: "/app/connect", icon: Plug },
    { label: "Templates", href: "/app/settings/templates", icon: FileText },
    { label: "Billing", href: "/app/settings/billing", icon: CreditCard },
  ],
  public: [
    { label: "Booking Page", href: "/app/bookings", icon: Calendar },
    { label: "Payment Page", href: "/app/commerce?tab=payments", icon: CreditCard, matchTab: "payments" },
    { label: "Intake Forms", href: "/app/crm/intake", icon: FileText },
    { label: "Business Profile", href: "/app/presence", icon: Globe },
    { label: "Share Links", href: "/app/commerce?tab=quotes", icon: Share2, matchTab: "quotes" },
  ],
};
void _legacySecondaryNav;

// Workspaces = daily execution (money, time, people)
const workspacesNav: NavItem[] = [
  { label: "Revenue", href: "/app/commerce", icon: Landmark },
  { label: "Contacts", href: "/app/crm/pipeline", icon: Users },
  { label: "Bookings", href: "/app/bookings", icon: Calendar },
  { label: "Calendar", href: "/app/calendar", icon: Calendar },
  { label: "Flows", href: "/app/automations", icon: Zap },
  { label: "Projects", href: "/app/projects", icon: FolderKanban },
  { label: "Inbox", href: "/app/inbox", icon: Mail },
  { label: "Content", href: "/app/marketing", icon: Megaphone, dormantFlag: "contentScheduler" },
  { label: "Helpdesk", href: "/app/helpdesk", icon: LifeBuoy },
  { label: "Structure", href: "/app/structure", icon: Network },
  { label: "Operations", href: "/app/operations", icon: Activity },
];

// Studio = build & configure (scalability)
const studioNav: NavItem[] = [
  { label: "Storefront", href: "/app/store", icon: Store },
  { label: "Settings", href: "/app/settings", icon: Settings },
];

// Public = customer-facing surfaces
const publicNav: NavItem[] = [
  { label: "Intake Forms", href: "/app/crm/intake", icon: FileText },
  { label: "Business Profile", href: "/app/presence", icon: Globe },
];

// Dormant modules — rendered when feature flags enable them
const comingSoonNav: NavItem[] = [
  { label: "Documents", href: "/app/documents", icon: FileText, dormantFlag: "documents" },
  { label: "Community", href: "/app/community", icon: MessageCircle, dormantFlag: "community" },
  { label: "Learn", href: "/app/learn", icon: BookOpen, dormantFlag: "learning" },
  { label: "Marketplace", href: "/app/marketplace", icon: Globe, dormantFlag: "marketplaceBrowsing" },
  { label: "Supplier", href: "/app/marketplace?tab=suppliers", icon: Truck, dormantFlag: "supplier" },
];

const mobileBottomNav = [
  { label: "Cockpit", href: "/app/keyflow-command", icon: Zap },
  { label: "Workspaces", href: "#workspaces", icon: LayoutGrid },
  { label: "AI", href: "/app/keyflow-command?mode=key", icon: Sparkles },
  { label: "Notifications", href: "#notifications", icon: Bell },
  { label: "Profile", href: "/app/profile", icon: User },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <Suspense fallback={null}>
        <NavigationContextProvider>
          <AiContextProvider>
            <NotesProvider>
              <NotesQueryParamTrigger />
              <AppLayoutInner>{children}</AppLayoutInner>
              <KeyflowNotesDrawer />
            </NotesProvider>
          </AiContextProvider>
        </NavigationContextProvider>
      </Suspense>
    </RequireAuth>
  );
}

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  useNavigationContext();

  const copilotModule = useMemo((): CopilotModule => {
    if (pathname === "/app") return "cockpit";
    if (pathname.startsWith("/app/crm")) return "crm";
    if (pathname.startsWith("/app/commerce")) return "revenue";
    if (pathname.startsWith("/app/payments")) return "revenue";
    if (pathname.startsWith("/app/bookings")) return "calendar";
    if (pathname.startsWith("/app/social") || pathname.startsWith("/app/marketing")) return "content";
    if (pathname.startsWith("/app/projects")) return "projects";
    if (pathname.startsWith("/app/expenses")) return "expenses";
    if (pathname.startsWith("/app/automations")) return "flows";
    if (pathname.startsWith("/app/settings")) return "settings";
    if (pathname.startsWith("/app/store")) return "store";
    if (pathname.startsWith("/app/profile")) return "profile";
    if (pathname.startsWith("/app/structure")) return "flows";
    return "cockpit";
  }, [pathname]);
  const [drawerSurface, setDrawerSurface] = useState<"workspaces" | "studio" | "public" | null>(null);

  useEffect(() => {
    setDrawerSurface(null);
  }, [pathname]);

  const isSecondaryActive = useCallback((item: NavItem) => {
    const basePath = item.href.split("?")[0];
    if (item.matchTab) {
      return pathname === basePath && searchParams.get("tab") === item.matchTab;
    }
    if (item.exactMatch) {
      return pathname === basePath && !searchParams.get("tab");
    }
    return pathname === basePath || pathname.startsWith(basePath + "/");
  }, [pathname, searchParams]);

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { setAccent1, setAccent2 } = useThemeColors();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [connectorAlertCount, setConnectorAlertCount] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [initials, setInitials] = useState("KF");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [, setOnboardingChecked] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [, setUserEmail] = useState<string | null>(null);
  const [featureFlags, setFeatureFlags] = useState<Record<string, ResolvedFeatureFlag>>({});
  const isFeatureLocked = useCallback(
    (item: NavItem) => {
      if (!item.featureKey) return false;
      const flag = featureFlags[item.featureKey];
      if (!flag) return false;
      return flag.comingSoon && !flag.bypass;
    },
    [featureFlags],
  );
  const isItemHiddenByDormantFlag = useCallback(
    (item: NavItem) => {
      if (!item.dormantFlag) return false;
      return !dormantFeatureFlags[item.dormantFlag];
    },
    [],
  );
  // Progressive disclosure mode (startup / growth / enterprise)
  const [disclosureMode, setDisclosureModeState] = useState<DisclosureMode>(getDisclosureMode);

  const visibleWorkspacesNav = useMemo(
    () => workspacesNav.filter((i) => {
      if (isItemHiddenByDormantFlag(i)) return false;
      if (disclosureMode === "enterprise") return true;
      return MODE_WORKSPACE_ITEMS[disclosureMode].includes(i.label);
    }),
    [isItemHiddenByDormantFlag, disclosureMode],
  );
  const visibleStudioNav = useMemo(
    () => studioNav.filter((i) => {
      if (isItemHiddenByDormantFlag(i)) return false;
      if (disclosureMode === "enterprise") return true;
      return MODE_STUDIO_ITEMS[disclosureMode].includes(i.label);
    }),
    [isItemHiddenByDormantFlag, disclosureMode],
  );
  const visiblePublicNav = useMemo(
    () => publicNav.filter((i) => !isItemHiddenByDormantFlag(i)),
    [isItemHiddenByDormantFlag],
  );
  const visibleComingSoonNav = useMemo(
    () => comingSoonNav.filter((i) => !isItemHiddenByDormantFlag(i)),
    [isItemHiddenByDormantFlag],
  );
  // Gamification badges hidden (dormant module sunset)
  // const showGamificationBadges = dormantFeatureFlags.gamificationBadges;
  const { planLimitHit, clearPlanLimit } = usePlanLimitHandler();
  const [kfStoreOpen, setKfStoreOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: CustomEvent<{ mode: DisclosureMode }>) => {
      setDisclosureModeState(e.detail.mode);
    };
    window.addEventListener("kf:disclosure-mode-changed", handler as EventListener);
    return () => window.removeEventListener("kf:disclosure-mode-changed", handler as EventListener);
  }, []);

  useEffect(() => {
    setMobileDrawerOpen(false);
    if (pathname && pathname !== "/app/onboarding") {
      try {
        const segments = pathname.split("/").filter(Boolean);
        const last = segments[segments.length - 1];
        const isUuid = /^[0-9a-f-]{20,}$/i.test(last || "");
        const labelSegment = isUuid && segments.length > 1 ? segments[segments.length - 2] : last;
        const labelMap: Record<string, string> = {
          app: "KEYFLOW", crm: "Contacts", pipeline: "Contacts", commerce: "Revenue",
          bookings: "Bookings", marketing: "Content", expenses: "Studio",
          projects: "Projects", documents: "Documents", automations: "Flows", reports: "Reports",
          store: "Storefront", settings: "Studio", learn: "Learn",
          community: "Community", marketplace: "Marketplace",
          "control-tower": "Cockpit",
          "keyflow-command": "Cockpit",
          structure: "Studio",
          inbox: "Inbox",
          calendar: "Calendar",
          presence: "Public",
          connect: "Integrations",
        };
        const label = labelMap[labelSegment || ""] || (labelSegment ? labelSegment.charAt(0).toUpperCase() + labelSegment.slice(1) : "");
        if (label) {
          const key = "kf-command-recent";
          const raw = localStorage.getItem(key);
          const items: { label: string; href: string; timestamp: number }[] = raw ? JSON.parse(raw) : [];
          const filtered = items.filter((r) => r.href !== pathname);
          filtered.unshift({ label, href: pathname, timestamp: Date.now() });
          localStorage.setItem(key, JSON.stringify(filtered.slice(0, 5)));
        }
      } catch {}
    }
  }, [pathname]);

  useEffect(() => {
    const init = async () => {
      await refreshWorkspace();
      const user = getCachedUser();
      const _business = getCachedBusiness();

      if (user) {
        setDisplayName(getUserDisplayName());
        setInitials(getUserInitials());
        if (user.avatarUrl) setAvatarUrl(user.avatarUrl);
        setIsAdminUser(isSuperAdmin());
        setUserEmail(user.email ?? null);
      }

      const businessId = getStoredBusinessId();
      if (businessId) {
        const res = await apiGet(`/identity/businesses/${businessId}`);
        if (res.data) {
          const data = res.data as { primaryColor?: string; secondaryColor?: string; onboardingComplete?: boolean };
          if (data.primaryColor) setAccent1(data.primaryColor);
          if (data.secondaryColor) setAccent2(data.secondaryColor);

          // NOTE: The legacy multi-step onboarding wizard was removed in
          // Task #293; the unified Notes drawer's "Get Started" entry is
          // now the soft onboarding surface. We intentionally do NOT
          // hard-redirect users with onboardingComplete=false anymore —
          // doing so traps new Google sign-in users in a loop because the
          // /app/onboarding route just bounces back to /app and opens the
          // Notes drawer. Users can still open Get Started from any page
          // via the "?" Notes button or keyboard shortcut.
          void data.onboardingComplete;
        }
      }
      const flagsRes = await apiGet<{ flags: ResolvedFeatureFlag[] }>(`/api/feature-flags`);
      if (flagsRes.data?.flags) {
        const map: Record<string, ResolvedFeatureFlag> = {};
        for (const f of flagsRes.data.flags) map[f.key] = f;
        setFeatureFlags(map);
      }

      setOnboardingChecked(true);
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, router]);

  const fetchNotifications = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const [listRes, countRes] = await Promise.all([
      apiGet(`/notifications/businesses/${businessId}?unreadOnly=false`),
      apiGet(`/notifications/businesses/${businessId}/unread-count`),
    ]);
    if (listRes.data) setNotifications(listRes.data as AppNotification[]);
    if (countRes.data) setUnreadCount((countRes.data as { count?: number }).count ?? 0);
  }, []);

  const fetchConnectorAlerts = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const res = await apiGet(`/connectors/businesses/${businessId}/needs-attention`);
    if (res.data) {
      setConnectorAlertCount((res.data as { count?: number }).count ?? 0);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    fetchConnectorAlerts();
    const interval = setInterval(() => {
      fetchNotifications();
      fetchConnectorAlerts();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications, fetchConnectorAlerts]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    if (notifOpen || userMenuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [notifOpen, userMenuOpen]);

  useEffect(() => {
    if (mobileDrawerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileDrawerOpen]);

  const markAllRead = async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    await apiPatch(`/notifications/businesses/${businessId}/read-all`, {});
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const handleLogout = () => {
    clearStoredBusinessId();
    router.push("/auth/login");
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setAddMenuOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setAddMenuOpen(false);
        setMobileDrawerOpen(false);
        setNotifOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const isPrimaryActive = useCallback(
    (item: PrimaryNavItem) => {
      if (!item.href) return false;
      const basePath = item.href.split("?")[0];
      return pathname === basePath || pathname.startsWith(basePath + "/");
    },
    [pathname],
  );

  return (
    <div className="h-dvh bg-background text-foreground overflow-hidden">
      <div className="flex h-full">
        <aside
          role="navigation"
          aria-label="Main navigation"
          className="hidden md:flex h-full"
        >
          <div
            className="w-[52px] flex flex-col items-center border-r border-border h-full py-3 gap-1 flex-shrink-0"
            style={{ background: "hsl(var(--kf-sidebar-bg))" }}
          >
            <Link
              href="/app/keyflow-command"
              className="h-10 w-10 min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center flex-shrink-0 mb-3"
              style={{ background: "hsl(var(--kf-accent1))" }}
              title="KEYFLOW — home"
            >
              <Zap className="w-4 h-4 text-white" />
            </Link>

            {primaryNav.map((item) => {
              const Icon = item.icon;
              const isActive = isPrimaryActive(item);
              const isSurface = !item.href;
              const surfaceId = item.id as string;
              const isSurfaceOpen = drawerSurface === surfaceId;

              if (isSurface) {
                return (
                  <button
                    key={item.label}
                    onClick={() => setDrawerSurface((prev) => (prev === surfaceId ? null : surfaceId as "workspaces" | "studio" | "public"))}
                    className={cn(
                      "w-11 h-11 min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center transition-all relative group",
                      isSurfaceOpen
                        ? "text-foreground bg-muted/50"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                    )}
                    title={item.label}
                    aria-label={item.label}
                    aria-expanded={isSurfaceOpen}
                  >
                    {isSurfaceOpen && (
                      <div
                        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[14px] w-[3px] h-5 rounded-r-full"
                        style={{ background: "hsl(var(--kf-accent1))" }}
                      />
                    )}
                    <Icon className="w-[18px] h-[18px]" />
                  </button>
                );
              }

              return (
                <Link
                  key={item.label}
                  href={item.href ?? "#"}
                  className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center transition-all relative group",
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                  title={item.label}
                  aria-label={item.label}
                  onClick={() => setDrawerSurface(null)}
                >
                  {isActive && (
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[14px] w-[3px] h-5 rounded-r-full"
                      style={{ background: "hsl(var(--kf-accent1))" }}
                    />
                  )}
                  <Icon className="w-[18px] h-[18px]" />
                </Link>
              );
            })}

            <div className="mt-auto flex flex-col items-center gap-1">
              {isAdminUser && (
                <Link
                  href="/admin"
                  className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
                  title="Owner Console"
                >
                  <Shield className="w-[18px] h-[18px]" />
                </Link>
              )}
              <button
                onClick={() => setKfStoreOpen(true)}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
                title="KF Store"
              >
                <div
                  className="w-[18px] h-[18px] rounded flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, #F97316, #14B8A6)" }}
                >
                  <Sparkles className="w-2.5 h-2.5 text-white" />
                </div>
              </button>
              <ThemeToggle />
            </div>
          </div>

          {drawerSurface !== null && (
            <div
              className="w-[208px] border-r border-border h-full flex flex-col overflow-hidden"
              style={{ background: "hsl(var(--kf-sidebar-bg) / 0.7)" }}
            >
              <div className="px-3 py-3 border-b border-border/50 flex items-center justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {drawerSurface === "workspaces" ? "Workspaces" : drawerSurface === "studio" ? "Studio" : "Public"}
                </h2>
                <button
                  onClick={() => setDrawerSurface(null)}
                  className="p-0.5 rounded text-muted-foreground hover:text-foreground"
                  aria-label="Close menu"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto py-1.5 px-1.5">
                {/* WORKSPACES */}
                <div className="mb-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-2 mb-1">
                    Workspaces
                  </div>
                  <div className="flex flex-col gap-px">
                    {visibleWorkspacesNav.map((item) => {
                      const Icon = item.icon;
                      const active = isSecondaryActive(item);
                      const isLocked = isFeatureLocked(item);
                      if (isLocked) {
                        return (
                          <button
                            key={item.href + item.label}
                            type="button"
                            aria-disabled="true"
                            title="future keyflow"
                            onClick={(e) => e.preventDefault()}
                            className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-muted-foreground/50 cursor-not-allowed opacity-60"
                          >
                            <Icon className="w-4 h-4 flex-shrink-0" />
                            <span>{item.label}</span>
                            <Lock className="w-3 h-3 ml-auto text-muted-foreground/60" />
                          </button>
                        );
                      }
                      return (
                        <Link
                          key={item.href + item.label}
                          href={item.href}
                          className={cn(
                            "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all",
                            active
                              ? "bg-[hsl(var(--kf-accent1))]/10 text-foreground font-medium"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                          )}
                        >
                          <Icon className="w-4 h-4 flex-shrink-0" />
                          <span>{item.label}</span>
                          {active && (
                            <ChevronRight className="w-3 h-3 ml-auto text-muted-foreground/50" />
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>

                {/* STUDIO */}
                <div className="mb-3 pt-3 border-t border-border/40">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-2 mb-1">
                    Studio
                  </div>
                  <div className="flex flex-col gap-px">
                    {visibleStudioNav.map((item) => {
                      const Icon = item.icon;
                      const active = isSecondaryActive(item);
                      const showConnectorBadge =
                        item.href === "/app/connect" && connectorAlertCount > 0;
                      const isLocked = isFeatureLocked(item);
                      if (isLocked) {
                        return (
                          <button
                            key={item.href + item.label}
                            type="button"
                            aria-disabled="true"
                            title="future keyflow"
                            onClick={(e) => e.preventDefault()}
                            className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-muted-foreground/50 cursor-not-allowed opacity-60"
                          >
                            <Icon className="w-4 h-4 flex-shrink-0" />
                            <span>{item.label}</span>
                            <Lock className="w-3 h-3 ml-auto text-muted-foreground/60" />
                          </button>
                        );
                      }
                      return (
                        <Link
                          key={item.href + item.label}
                          href={item.href}
                          className={cn(
                            "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all",
                            active
                              ? "bg-[hsl(var(--kf-accent1))]/10 text-foreground font-medium"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                          )}
                        >
                          <Icon className="w-4 h-4 flex-shrink-0" />
                          <span>{item.label}</span>
                          {showConnectorBadge && (
                            <span
                              className="ml-auto h-4 min-w-[16px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
                              style={{ background: "hsl(var(--kf-accent1))" }}
                              title={`${connectorAlertCount} connector${connectorAlertCount === 1 ? "" : "s"} need${connectorAlertCount === 1 ? "s" : ""} attention`}
                              aria-label={`${connectorAlertCount} connectors need attention`}
                            >
                              {connectorAlertCount > 9 ? "9+" : connectorAlertCount}
                            </span>
                          )}
                          {active && !showConnectorBadge && (
                            <ChevronRight className="w-3 h-3 ml-auto text-muted-foreground/50" />
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>

                {/* PUBLIC */}
                <div className="mb-3 pt-3 border-t border-border/40">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-2 mb-1">
                    Public
                  </div>
                  <div className="flex flex-col gap-px">
                    {visiblePublicNav.map((item) => {
                      const Icon = item.icon;
                      const active = isSecondaryActive(item);
                      const isLocked = isFeatureLocked(item);
                      if (isLocked) {
                        return (
                          <button
                            key={item.href + item.label}
                            type="button"
                            aria-disabled="true"
                            title="future keyflow"
                            onClick={(e) => e.preventDefault()}
                            className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-muted-foreground/50 cursor-not-allowed opacity-60"
                          >
                            <Icon className="w-4 h-4 flex-shrink-0" />
                            <span>{item.label}</span>
                            <Lock className="w-3 h-3 ml-auto text-muted-foreground/60" />
                          </button>
                        );
                      }
                      return (
                        <Link
                          key={item.href + item.label}
                          href={item.href}
                          className={cn(
                            "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all",
                            active
                              ? "bg-[hsl(var(--kf-accent1))]/10 text-foreground font-medium"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                          )}
                        >
                          <Icon className="w-4 h-4 flex-shrink-0" />
                          <span>{item.label}</span>
                          {active && (
                            <ChevronRight className="w-3 h-3 ml-auto text-muted-foreground/50" />
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>

                {visibleComingSoonNav.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/40">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-2 mb-1">
                      Coming soon
                    </div>
                    <div className="flex flex-col gap-px">
                      {visibleComingSoonNav.map((item) => {
                        const Icon = item.icon;
                        const active = isSecondaryActive(item);
                        return (
                          <Link
                            key={item.href + item.label}
                            href={item.href}
                            className={cn(
                              "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all opacity-70",
                              active
                                ? "bg-[hsl(var(--kf-accent1))]/10 text-foreground font-medium"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                            )}
                          >
                            <Icon className="w-4 h-4 flex-shrink-0" />
                            <span>{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>

        <main role="main" className="flex-1 flex flex-col h-full min-w-0">
          <header
            className="h-12 border-b border-border px-3 md:px-5 flex items-center justify-between flex-shrink-0 z-40"
            style={{ background: "hsl(var(--kf-header-bg))" }}
          >
            <div className="flex items-center gap-2 md:gap-3 flex-1">
              <button
                onClick={() => setMobileDrawerOpen(true)}
                className="md:hidden p-2 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Open navigation menu"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="md:hidden flex items-center gap-2 flex-1 min-w-0">
                <div
                  className="h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{ background: "hsl(var(--kf-accent1))" }}
                >
                  <Zap className="w-3 h-3 text-white" />
                </div>
                <span className="text-sm font-bold tracking-tight truncate">KEYFLOWOS</span>
              </div>

              <button
                onClick={() => window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "chat" } }))}
                className="hidden md:flex flex-1 min-w-0 max-w-lg items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-1.5 text-sm text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground/70 transition-colors cursor-pointer"
              >
                <Brain className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
                <span className="truncate">Ask KEY anything…</span>
                <kbd className="ml-auto px-1 py-0.5 rounded bg-muted text-[10px] font-mono shrink-0">⌘J</kbd>
              </button>
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "palette" } }))}
                className="hidden md:flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-muted-foreground/30 transition-colors shrink-0"
                title="Command palette (⌘K)"
              >
                <Search className="w-3.5 h-3.5" />
                <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">⌘K</kbd>
              </button>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "palette" } }))}
                className="lg:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Search"
              >
                <Search className="w-5 h-5" />
              </button>

              {/* Disclosure Mode Switcher */}
              <div className="relative" ref={modeMenuRef}>
                <button
                  onClick={() => setModeMenuOpen((v) => !v)}
                  className={cn(
                    "hidden sm:flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors shrink-0",
                    disclosureMode === "startup"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15"
                      : disclosureMode === "growth"
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/15"
                        : "border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/15"
                  )}
                  title={`Mode: ${MODE_LABELS[disclosureMode].title}`}
                >
                  <span>{MODE_LABELS[disclosureMode].title}</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
                {modeMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-[55]" onClick={() => setModeMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-border bg-card/95 backdrop-blur-xl shadow-xl z-[56] p-1.5">
                      <div className="px-3 py-2">
                        <p className="text-xs font-semibold text-foreground">Workspace Mode</p>
                        <p className="text-[11px] text-muted-foreground">Show only what you need</p>
                      </div>
                      <div className="border-t border-border my-1" />
                      {(["startup", "growth", "enterprise"] as DisclosureMode[]).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => {
                            setDisclosureMode(mode);
                            setModeMenuOpen(false);
                          }}
                          className={cn(
                            "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between",
                            disclosureMode === mode
                              ? "bg-muted font-medium"
                              : "hover:bg-muted/50 text-muted-foreground"
                          )}
                        >
                          <div>
                            <p className="text-sm">{MODE_LABELS[mode].title}</p>
                            <p className="text-[11px] text-muted-foreground">{MODE_LABELS[mode].subtitle}</p>
                          </div>
                          {disclosureMode === mode && (
                            <div className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--kf-accent1))]" />
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="relative">
                <button
                  onClick={() => setAddMenuOpen((v) => !v)}
                  className="kf-btn-primary inline-flex items-center gap-1.5 !px-2.5 !py-1.5 !text-xs !rounded-lg"
                  title="New (⌘N)"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">New</span>
                  <kbd className="hidden sm:inline px-1 py-0.5 rounded bg-black/20 text-[9px] font-mono">⌘N</kbd>
                </button>
                {addMenuOpen && (
                  <NewEntityMenu onClose={() => setAddMenuOpen(false)} />
                )}
              </div>

              {/* MissionsButton hidden — gamification module is dormant */}

              <div className="relative" ref={notifRef}>
                <button
                  onClick={() => { setNotifOpen((v) => !v); }}
                  className={cn(
                    "relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
                    unreadCount > 0 && "kf-notif-pulse"
                  )}
                  aria-label="Notifications"
                >
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full text-[9px] font-bold flex items-center justify-center text-white" style={{ background: "hsl(var(--kf-accent1))" }}>
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <>
                    <div className="fixed inset-0 z-[55] md:hidden bg-black/40" onClick={() => setNotifOpen(false)} />
                    <div className="fixed inset-x-0 bottom-0 top-auto md:absolute md:right-0 md:left-auto md:bottom-auto md:top-full mt-0 md:mt-2 w-full md:w-80 max-h-[70vh] md:max-h-96 overflow-y-auto rounded-t-2xl md:rounded-xl border border-border bg-card/95 backdrop-blur-xl shadow-xl z-[56]">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-card z-10">
                        <span className="text-sm font-semibold">Notifications</span>
                        <div className="flex items-center gap-3">
                          {unreadCount > 0 && (
                            <button onClick={markAllRead} className="text-xs hover:underline" style={{ color: "hsl(var(--kf-accent1))" }}>
                              Mark all read
                            </button>
                          )}
                          <button onClick={() => setNotifOpen(false)} className="md:hidden p-1 text-muted-foreground">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      {notifications.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-muted-foreground">No notifications yet</div>
                      ) : (
                        notifications.slice(0, 20).map((n) => {
                          const notifLink = getNotificationLink(n);
                          const NotifIcon = getNotificationIcon(n);
                          const itemClass = cn(
                            "block px-4 py-3 border-b border-border last:border-0 hover:bg-muted/50 transition-colors active:bg-muted/70",
                            !n.read && "bg-muted/30",
                            notifLink && "cursor-pointer"
                          );
                          const content = (
                            <div className="flex items-start gap-2.5">
                              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 bg-muted/50">
                                <NotifIcon className="w-3.5 h-3.5 text-muted-foreground" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-sm font-medium">{n.title}</p>
                                  {!n.read && (
                                    <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: "hsl(var(--kf-accent1))" }} />
                                  )}
                                </div>
                                {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                                <p className="text-[10px] text-muted-foreground mt-1">
                                  {relativeTime(n.createdAt)}
                                </p>
                              </div>
                            </div>
                          );
                          if (notifLink) {
                            return (
                              <Link key={n.id} href={notifLink} onClick={() => setNotifOpen(false)} className={itemClass}>
                                {content}
                              </Link>
                            );
                          }
                          return (
                            <div key={n.id} className={itemClass}>
                              {content}
                            </div>
                          );
                        })
                      )}
                      <div className="h-safe-area-inset-bottom md:hidden" />
                    </div>
                  </>
                )}
              </div>

              <div className="hidden sm:flex items-center relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="flex items-center gap-1.5 p-1 rounded-lg hover:bg-muted transition-colors min-h-[44px]"
                  aria-label="User menu"
                  aria-expanded={userMenuOpen}
                  aria-haspopup="true"
                >
                  {avatarUrl ? (
                    <Image
                      src={avatarUrl}
                      alt={displayName || "User"}
                      className="h-7 w-7 rounded-full object-cover"
                     width={28} height={28} unoptimized />
                  ) : (
                    <div
                      className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white"
                      style={{ background: "hsl(var(--kf-accent1))" }}
                    >
                      {initials}
                    </div>
                  )}
                  <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform duration-200 ${userMenuOpen ? "rotate-180" : ""}`} />
                </button>

                {userMenuOpen && (
                  <div
                    className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-border shadow-xl z-50 py-1 overflow-hidden"
                    style={{ background: "hsl(var(--kf-card))" }}
                    role="menu"
                  >
                    <div className="px-3 py-2 border-b border-border">
                      <p className="text-xs font-medium text-foreground truncate">{displayName || "User"}</p>
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">{getCachedUser()?.email}</p>
                    </div>
                    <Link
                      href="/app/profile"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-foreground/80 hover:bg-muted transition-colors min-h-[44px]"
                      role="menuitem"
                    >
                      <User className="w-3.5 h-3.5 text-muted-foreground" />
                      My Profile
                    </Link>
                    <Link
                      href="/app/settings"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-foreground/80 hover:bg-muted transition-colors min-h-[44px]"
                      role="menuitem"
                    >
                      <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                      Studio
                    </Link>
                    {isAdminUser && (
                      <Link
                        href="/admin"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-foreground/80 hover:bg-muted transition-colors min-h-[44px]"
                        role="menuitem"
                      >
                        <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                        Owner Console
                      </Link>
                    )}
                    <div className="border-t border-border mt-1 pt-1">
                      <button
                        onClick={() => { setUserMenuOpen(false); handleLogout(); }}
                        className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-foreground/80 hover:bg-muted transition-colors w-full text-left min-h-[44px]"
                        role="menuitem"
                      >
                        <LogOut className="w-3.5 h-3.5 text-muted-foreground" />
                        Log out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="px-3 md:px-6 pt-1">
            <OriginAwareBreadcrumbs />
          </div>
          <div data-scroll-root="app" className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 md:p-6 pb-24 md:pb-6">{children}</div>
        </main>

      </div>

      {mobileDrawerOpen && (
        <div className="md:hidden fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileDrawerOpen(false)} />
          <div
            className="absolute left-0 top-0 bottom-0 w-72 border-r border-border flex flex-col overflow-y-auto"
            role="navigation"
            aria-label="Main navigation"
            style={{ background: "hsl(var(--kf-sidebar-bg))" }}
          >
            <div className="flex items-center justify-between px-3 py-3 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div
                  className="h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "hsl(var(--kf-accent1))" }}
                >
                  <Zap className="w-3.5 h-3.5 text-white" />
                </div>
                <h1 className="text-sm font-bold tracking-tight">KEYFLOWOS</h1>
              </div>
              <button
                onClick={() => setMobileDrawerOpen(false)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {displayName && (
              <Link
                href="/app/profile"
                onClick={() => setMobileDrawerOpen(false)}
                className="px-3 py-2.5 border-b border-border flex items-center gap-2.5 hover:bg-muted transition-colors min-h-[44px]"
              >
                {avatarUrl ? (
                  <Image src={avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover"  width={28} height={28} unoptimized />
                ) : (
                  <div
                    className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white flex-shrink-0"
                    style={{ background: "hsl(var(--kf-accent1))" }}
                  >
                    {initials}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{displayName}</p>
                  <p className="text-[10px] text-muted-foreground truncate">View profile</p>
                </div>
                <ChevronDown className="w-3 h-3 text-muted-foreground -rotate-90" />
              </Link>
            )}

            <div className="flex-1 py-2 px-2">
              <Link
                href="/app/keyflow-command"
                onClick={() => setMobileDrawerOpen(false)}
                className={cn(
                  "kf-nav-item py-2.5 active:scale-[0.98] mb-2",
                  (pathname === "/app" ||
                    pathname.startsWith("/app/keyflow-command") ||
                    pathname.startsWith("/app/control-tower")) &&
                    "active"
                )}
              >
                <Zap className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                <span>Cockpit</span>
              </Link>

              {/* WORKSPACES */}
              <div className="mt-2">
                <div className="kf-section-label flex items-center gap-1.5">
                  <LayoutGrid className="w-3 h-3" />
                  Workspaces
                </div>
                <div className="flex flex-col gap-px">
                  {visibleWorkspacesNav.map((item) => {
                    const Icon = item.icon;
                    const active = isSecondaryActive(item);
                    const isLocked = isFeatureLocked(item);
                    if (isLocked) {
                      return (
                        <button
                          key={item.href + item.label}
                          type="button"
                          aria-disabled="true"
                          title="future keyflow"
                          onClick={(e) => e.preventDefault()}
                          className="kf-nav-item py-2.5 w-full text-left opacity-60 cursor-not-allowed"
                        >
                          <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                          <span>{item.label}</span>
                          <Lock className="w-3 h-3 ml-auto text-muted-foreground/60" />
                        </button>
                      );
                    }
                    return (
                      <Link
                        key={item.href + item.label}
                        href={item.href}
                        onClick={() => setMobileDrawerOpen(false)}
                        className={cn("kf-nav-item py-2.5 active:scale-[0.98]", active && "active")}
                      >
                        <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>

              {/* STUDIO */}
              <div className="mt-2">
                <div className="kf-section-label flex items-center gap-1.5">
                  <Wrench className="w-3 h-3" />
                  Studio
                </div>
                <div className="flex flex-col gap-px">
                  {visibleStudioNav.map((item) => {
                    const Icon = item.icon;
                    const active = isSecondaryActive(item);
                    const showConnectorBadge =
                      item.href === "/app/connect" && connectorAlertCount > 0;
                    const isLocked = isFeatureLocked(item);
                    if (isLocked) {
                      return (
                        <button
                          key={item.href + item.label}
                          type="button"
                          aria-disabled="true"
                          title="future keyflow"
                          onClick={(e) => e.preventDefault()}
                          className="kf-nav-item py-2.5 w-full text-left opacity-60 cursor-not-allowed"
                        >
                          <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                          <span>{item.label}</span>
                          <Lock className="w-3 h-3 ml-auto text-muted-foreground/60" />
                        </button>
                      );
                    }
                    return (
                      <Link
                        key={item.href + item.label}
                        href={item.href}
                        onClick={() => setMobileDrawerOpen(false)}
                        className={cn("kf-nav-item py-2.5 active:scale-[0.98]", active && "active")}
                      >
                        <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                        <span>{item.label}</span>
                        {showConnectorBadge && (
                          <span
                            className="ml-auto h-4 min-w-[16px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
                            style={{ background: "hsl(var(--kf-accent1))" }}
                            aria-label={`${connectorAlertCount} connectors need attention`}
                          >
                            {connectorAlertCount > 9 ? "9+" : connectorAlertCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>

              {/* PUBLIC */}
              <div className="mt-2">
                <div className="kf-section-label flex items-center gap-1.5">
                  <Globe className="w-3 h-3" />
                  Public
                </div>
                <div className="flex flex-col gap-px">
                  {visiblePublicNav.map((item) => {
                    const Icon = item.icon;
                    const active = isSecondaryActive(item);
                    const isLocked = isFeatureLocked(item);
                    if (isLocked) {
                      return (
                        <button
                          key={item.href + item.label}
                          type="button"
                          aria-disabled="true"
                          title="future keyflow"
                          onClick={(e) => e.preventDefault()}
                          className="kf-nav-item py-2.5 w-full text-left opacity-60 cursor-not-allowed"
                        >
                          <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                          <span>{item.label}</span>
                          <Lock className="w-3 h-3 ml-auto text-muted-foreground/60" />
                        </button>
                      );
                    }
                    return (
                      <Link
                        key={item.href + item.label}
                        href={item.href}
                        onClick={() => setMobileDrawerOpen(false)}
                        className={cn("kf-nav-item py-2.5 active:scale-[0.98]", active && "active")}
                      >
                        <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>

              {visibleComingSoonNav.length > 0 && (
                <div className="mt-2">
                  <div className="kf-section-label flex items-center gap-1.5">
                    <Lock className="w-3 h-3" />
                    Coming soon
                  </div>
                  <div className="flex flex-col gap-px">
                    {visibleComingSoonNav.map((item) => {
                      const Icon = item.icon;
                      const active = isSecondaryActive(item);
                      return (
                        <Link
                          key={item.href + item.label}
                          href={item.href}
                          onClick={() => setMobileDrawerOpen(false)}
                          className={cn("kf-nav-item py-2.5 active:scale-[0.98] opacity-70", active && "active")}
                        >
                          <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="kf-divider my-2" />

              <button
                onClick={() => { setMobileDrawerOpen(false); setKfStoreOpen(true); }}
                className="kf-nav-item py-2.5 active:scale-[0.98] w-full"
              >
                <div
                  className="w-[18px] h-[18px] rounded flex items-center justify-center flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, #F97316, #14B8A6)" }}
                >
                  <Sparkles className="w-3 h-3 text-white" />
                </div>
                <span>KF Store</span>
              </button>

              {isAdminUser && (
                <Link
                  href="/admin"
                  onClick={() => setMobileDrawerOpen(false)}
                  className="kf-nav-item py-2.5 active:scale-[0.98]"
                >
                  <Shield className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                  <span>Owner Console</span>
                </Link>
              )}
            </div>

            <div className="mt-auto px-2 pb-4 space-y-1 border-t border-border pt-2">
              <div className="flex items-center justify-between px-2">
                <ThemeToggle />
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted transition-all w-full active:scale-[0.98]"
              >
                <LogOut className="w-4 h-4" />
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}

      <nav aria-label="Mobile navigation" className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-card/95 backdrop-blur-xl z-50" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="flex items-center justify-around px-1" style={{ height: "56px" }}>
          {mobileBottomNav.map((item) => {
            const Icon = item.icon;
            if (item.href === "#workspaces") {
              return (
                <button
                  key="workspaces"
                  onClick={() => setMobileDrawerOpen(true)}
                  className={cn(
                    "flex flex-col items-center justify-center min-w-[56px] min-h-[44px] py-1 transition-all active:scale-95",
                    mobileDrawerOpen ? "" : "text-muted-foreground"
                  )}
                  style={mobileDrawerOpen ? { color: "hsl(var(--kf-accent1))" } : undefined}
                  aria-label="Workspaces"
                >
                  <Icon className="w-[20px] h-[20px]" />
                  <span className="text-[10px] mt-0.5">{item.label}</span>
                </button>
              );
            }
            if (item.href === "#notifications") {
              return (
                <button
                  key="notifications"
                  onClick={() => setNotifOpen((v) => !v)}
                  className={cn(
                    "flex flex-col items-center justify-center min-w-[56px] min-h-[44px] py-1 transition-all active:scale-95 relative",
                    notifOpen ? "" : "text-muted-foreground"
                  )}
                  style={notifOpen ? { color: "hsl(var(--kf-accent1))" } : undefined}
                  aria-label="Notifications"
                >
                  <Icon className="w-[20px] h-[20px]" />
                  <span className="text-[10px] mt-0.5">{item.label}</span>
                  {unreadCount > 0 && (
                    <span className="absolute top-0 right-1 h-3.5 w-3.5 rounded-full text-[9px] font-bold flex items-center justify-center text-white" style={{ background: "hsl(var(--kf-accent1))" }}>
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>
              );
            }
            const active = pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center min-w-[56px] min-h-[44px] py-1 transition-all active:scale-95",
                  active ? "" : "text-muted-foreground"
                )}
                style={active ? { color: "hsl(var(--kf-accent1))" } : undefined}
              >
                <Icon className="w-[20px] h-[20px]" />
                <span className="text-[10px] mt-0.5">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <PlanLimitDialog planLimit={planLimitHit} onClose={clearPlanLimit} />
      <KeyflowOSStoreDrawer open={kfStoreOpen} onClose={() => setKfStoreOpen(false)} />
      <KeyAgent currentModule={copilotModule} />
      <MobileFab />
    </div>
  );
}
