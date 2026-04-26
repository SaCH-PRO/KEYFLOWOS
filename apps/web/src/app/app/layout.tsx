"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandPalette } from "@/components/command-palette";
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
  PanelLeftClose,
  PanelLeft,
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
  Building2,
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
} from "lucide-react";


import { CopilotPanel, type CopilotModule } from "@/components/ai/copilot-panel";
import { AiContextProvider } from "@/contexts/ai-context";
import { usePlanLimitHandler } from "@/hooks/use-plan";
import { PlanLimitDialog } from "@/components/ui/upgrade-prompt";
import { KeyflowOSStoreDrawer } from "@/components/keyflowos-store-drawer";

const OriginAwareBreadcrumbs = dynamic(
  () => import("@/components/ui/origin-aware-breadcrumbs").then((mod) => mod.OriginAwareBreadcrumbs),
  { ssr: false }
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

function getNotificationIcon(n: any): typeof Bell {
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
  return Bell;
}

function getNotificationLink(n: any): string | null {
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
  if (n.data?.link) return n.data.link;
  if (n.link || n.href) return n.link || n.href;
  return null;
}

function NewEntityMenu({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = useState(-1);
  const items = [
    { label: "Contact", icon: Users, href: "/app/crm/pipeline", shortcut: "⌘⇧C" },
    { label: "Invoice", icon: Receipt, href: "/app/commerce", shortcut: "⌘⇧I" },
    { label: "Quote", icon: FileText, href: "/app/commerce?tab=quotes" },
    { label: "Booking", icon: Calendar, href: "/app/bookings", shortcut: "⌘⇧B" },
    { label: "Expense", icon: Receipt, href: "/app/expenses" },
    { label: "Project", icon: FolderKanban, href: "/app/projects" },
    { label: "Campaign", icon: Megaphone, href: "/app/marketing" },
    { label: "Post", icon: MessageCircle, href: "/app/marketing?tab=social" },
    { label: "Flow", icon: Zap, href: "/app/automations" },
  ];

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
}

type PrimarySectionId = "cockpit" | "tower" | "store" | "workspaces" | "studio" | "public";

interface PrimaryNavItem {
  id: PrimarySectionId;
  label: string;
  icon: typeof Gauge;
  href?: string;
}

const primaryNav: PrimaryNavItem[] = [
  { id: "tower", label: "Command Flow", icon: Radar, href: "/app/control-tower" },
  { id: "store", label: "Store", icon: Store, href: "/app/store" },
  { id: "workspaces", label: "Workspaces", icon: LayoutGrid },
  { id: "studio", label: "Studio", icon: Wrench },
  { id: "public", label: "Public", icon: Globe },
];

const secondaryNav: Record<string, NavItem[]> = {
  workspaces: [
    { label: "Clients", href: "/app/crm/pipeline", icon: Users },
    { label: "Calendar", href: "/app/bookings", icon: Calendar },
    { label: "Revenue", href: "/app/commerce", icon: CreditCard },
    { label: "Content", href: "/app/marketing", icon: Megaphone },
    { label: "Automations", href: "/app/automations", icon: Zap },
    { label: "Projects", href: "/app/projects", icon: FolderKanban },
    { label: "Expenses", href: "/app/expenses", icon: Receipt },
    { label: "Reports", href: "/app/reports", icon: BarChart3 },
    { label: "Documents", href: "/app/documents", icon: FileText },
  ],
  studio: [
    { label: "Business", href: "/app/settings/business", icon: Building2 },
    { label: "Services", href: "/app/commerce?tab=products", icon: Package, matchTab: "products" },
    { label: "Team", href: "/app/settings/team", icon: Users2 },
    { label: "Branding", href: "/app/profile", icon: Palette },
    { label: "Integrations", href: "/app/settings/connections", icon: Plug },
    { label: "Templates", href: "/app/settings/templates", icon: FileText },
    { label: "Emails", href: "/app/settings/notifications", icon: Mail },
  ],
  public: [
    { label: "Community", href: "/app/community", icon: MessageCircle },
    { label: "Learn", href: "/app/learn", icon: BookOpen },
    { label: "Marketplace", href: "/app/marketplace", icon: Globe },
  ],
};

const routeToSurface: [string, PrimarySectionId][] = [
  ["/app/control-tower", "tower"],
  ["/app/settings", "studio"],
  ["/app/profile", "studio"],
  ["/app/launchpad", "store"],
  ["/app/store", "store"],
  ["/app/community", "public"],
  ["/app/learn", "public"],
  ["/app/marketplace", "public"],
  ["/app/social", "workspaces"],
  ["/app/crm", "workspaces"],
  ["/app/commerce", "workspaces"],
  ["/app/bookings", "workspaces"],
  ["/app/marketing", "workspaces"],
  ["/app/automations", "workspaces"],
  ["/app/projects", "workspaces"],
  ["/app/expenses", "workspaces"],
  ["/app/reports", "workspaces"],
  ["/app/documents", "workspaces"],
  ["/app/onboarding", "tower"],
];

function detectPrimarySection(pathname: string): PrimarySectionId {
  if (pathname === "/app") return "tower";
  for (const [prefix, section] of routeToSurface) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return section;
    }
  }
  return "workspaces";
}

const mobileBottomNav = [
  { label: "Command", href: "/app/control-tower", icon: Radar },
  { label: "Revenue", href: "/app/commerce", icon: CreditCard },
  { label: "Calendar", href: "/app/bookings", icon: Calendar },
  { label: "Clients", href: "/app/crm/pipeline", icon: Users },
  { label: "More", href: "#more", icon: MoreHorizontal },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <NavigationContextProvider>
      <AiContextProvider>
        <Suspense fallback={<div className="min-h-screen bg-background" />}>
          <AppLayoutInner>{children}</AppLayoutInner>
        </Suspense>
      </AiContextProvider>
    </NavigationContextProvider>
  );
}

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { pushContext, setTaskOrigin, current } = useNavigationContext();
  const [activeTabQuery, setActiveTabQuery] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      setActiveTabQuery(params.get("tab"));
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [pathname]);


  const activePrimary = useMemo(() => detectPrimarySection(pathname), [pathname]);
  const copilotModule = useMemo((): CopilotModule => {
    if (pathname === "/app") return "cockpit";
    if (pathname.startsWith("/app/crm")) return "crm";
    if (pathname.startsWith("/app/commerce")) return "revenue";
    if (pathname.startsWith("/app/bookings")) return "calendar";
    if (pathname.startsWith("/app/social") || pathname.startsWith("/app/marketing")) return "content";
    if (pathname.startsWith("/app/projects")) return "projects";
    if (pathname.startsWith("/app/expenses")) return "expenses";
    if (pathname.startsWith("/app/automations")) return "flows";
    if (pathname.startsWith("/app/settings")) return "settings";
    if (pathname.startsWith("/app/store")) return "store";
    if (pathname.startsWith("/app/profile")) return "profile";
    return "cockpit";
  }, [pathname]);
  const [expandedSection, setExpandedSection] = useState<PrimarySectionId | null>(null);
  const secondaryVisible = expandedSection ?? (activePrimary !== "cockpit" && activePrimary !== "tower" ? activePrimary : null);

  useEffect(() => {
    setExpandedSection(null);
  }, [pathname]);

  const isSecondaryActive = useCallback((item: NavItem) => {
    const basePath = item.href.split("?")[0];
    if (item.matchTab) {
      return pathname === basePath && activeTabQuery === item.matchTab;
    }
    if (item.exactMatch) {
      return pathname === basePath && !activeTabQuery;
    }
    return pathname === basePath || pathname.startsWith(basePath + "/");
  }, [pathname, activeTabQuery]);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { setAccent1, setAccent2 } = useThemeColors();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [initials, setInitials] = useState("KF");
  const [userEmail, setUserEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const { planLimitHit, clearPlanLimit } = usePlanLimitHandler();
  const [kfStoreOpen, setKfStoreOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);

  useEffect(() => {
    setMobileDrawerOpen(false);
    if (pathname && pathname !== "/app/onboarding") {
      try {
        const segments = pathname.split("/").filter(Boolean);
        const last = segments[segments.length - 1];
        const isUuid = /^[0-9a-f-]{20,}$/i.test(last || "");
        const labelSegment = isUuid && segments.length > 1 ? segments[segments.length - 2] : last;
        const labelMap: Record<string, string> = {
          app: "Command Flow", crm: "CRM", pipeline: "Clients", commerce: "Revenue",
          bookings: "Calendar", marketing: "Content", expenses: "Expenses",
          projects: "Projects", documents: "Documents", automations: "Automations", reports: "Reports",
          store: "Store", settings: "Studio", learn: "Learn",
          community: "Community", marketplace: "Marketplace",
          "control-tower": "Command Flow",
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
      const business = getCachedBusiness();
      
      if (user) {
        setDisplayName(getUserDisplayName());
        setInitials(getUserInitials());
        setUserEmail(user.email ?? "");
        if (user.avatarUrl) setAvatarUrl(user.avatarUrl);
        setIsAdminUser(isSuperAdmin());
      }

      const businessId = getStoredBusinessId();
      if (businessId) {
        const res = await apiGet(`/identity/businesses/${businessId}`);
        if (res.data) {
          const data = res.data as { primaryColor?: string; secondaryColor?: string; onboardingComplete?: boolean };
          if (data.primaryColor) setAccent1(data.primaryColor);
          if (data.secondaryColor) setAccent2(data.secondaryColor);
          
          if (data.onboardingComplete === false && !pathname.startsWith("/app/onboarding")) {
            if (current) {
              setTaskOrigin(current);
            }
            pushContext({
              taskIntent: "onboarding-setup",
              draftId: null,
            });
            router.push("/app/onboarding");
            return;
          }
        }
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
    if (listRes.data) setNotifications(listRes.data as any[]);
    if (countRes.data) setUnreadCount((countRes.data as any).count ?? 0);
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

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
    router.push("/");
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setCopilotOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setAddMenuOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setPaletteOpen(false);
        setAddMenuOpen(false);
        setMobileDrawerOpen(false);
        setNotifOpen(false);
        setCopilotOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const [copilotInitialPrompt, setCopilotInitialPrompt] = useState<string | undefined>();

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.prompt) {
        setCopilotInitialPrompt(detail.prompt);
      }
      setCopilotOpen(true);
    };
    window.addEventListener("kf:open-copilot", handler);
    return () => window.removeEventListener("kf:open-copilot", handler);
  }, []);

  const handlePrimaryClick = (item: PrimaryNavItem) => {
    if (item.href) {
      router.push(item.href);
      setExpandedSection(null);
    } else {
      setExpandedSection((prev) => (prev === item.id ? null : item.id));
    }
  };

  const currentSecondary = secondaryVisible ? secondaryNav[secondaryVisible] : null;
  const currentSectionLabel = primaryNav.find((p) => p.id === secondaryVisible)?.label;

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
              href="/app"
              className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 mb-3"
              style={{ background: "hsl(var(--kf-accent1))" }}
              title="KEYFLOWOS"
            >
              <Zap className="w-4 h-4 text-white" />
            </Link>

            {primaryNav.map((item) => {
              const Icon = item.icon;
              const isActive = activePrimary === item.id;
              const isExpanded = expandedSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handlePrimaryClick(item)}
                  className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center transition-all relative group",
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                    isExpanded && "bg-muted/50"
                  )}
                  title={item.label}
                  aria-label={item.label}
                >
                  {isActive && (
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[14px] w-[3px] h-5 rounded-r-full"
                      style={{ background: "hsl(var(--kf-accent1))" }}
                    />
                  )}
                  <Icon className="w-[18px] h-[18px]" />
                </button>
              );
            })}

            <div className="mt-auto flex flex-col items-center gap-1">
              <button
                onClick={() => setCopilotOpen(true)}
                className={cn(
                  "w-9 h-9 rounded-lg flex items-center justify-center transition-all relative group",
                  copilotOpen
                    ? "text-foreground bg-muted/50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
                title="AI Copilot (⌘J)"
                aria-label="AI Copilot"
              >
                <Brain className="w-[18px] h-[18px]" />
              </button>
              {isAdminUser && (
                <Link
                  href="/admin"
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
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

          {currentSecondary && (
            <div
              className="w-[192px] border-r border-border h-full flex flex-col overflow-hidden"
              style={{ background: "hsl(var(--kf-sidebar-bg) / 0.7)" }}
            >
              <div className="px-3 py-3 border-b border-border/50">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {currentSectionLabel}
                </h2>
              </div>
              <div className="flex-1 overflow-y-auto py-1.5 px-1.5">
                <div className="flex flex-col gap-px">
                  {currentSecondary.map((item) => {
                    const Icon = item.icon;
                    const active = isSecondaryActive(item);
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
                onClick={() => setCopilotOpen(true)}
                className="hidden md:flex flex-1 min-w-0 max-w-lg items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-1.5 text-sm text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground/70 transition-colors cursor-pointer"
              >
                <Brain className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
                <span className="truncate">Ask AI anything...</span>
                <kbd className="ml-auto px-1 py-0.5 rounded bg-muted text-[10px] font-mono shrink-0">⌘J</kbd>
              </button>
              <button
                onClick={() => setPaletteOpen(true)}
                className="hidden md:flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-muted-foreground/30 transition-colors shrink-0"
                title="Search (⌘K)"
              >
                <Search className="w-3.5 h-3.5" />
                <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">⌘K</kbd>
              </button>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={() => setPaletteOpen(true)}
                className="lg:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Search"
              >
                <Search className="w-5 h-5" />
              </button>
              
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
                        notifications.slice(0, 20).map((n: any) => {
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
                    <img 
                      src={avatarUrl} 
                      alt={displayName || "User"} 
                      className="h-7 w-7 rounded-full object-cover"
                    />
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
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">{userEmail}</p>
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
                  <img src={avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
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
                href="/app/control-tower"
                onClick={() => setMobileDrawerOpen(false)}
                className={cn(
                  "kf-nav-item py-2.5 active:scale-[0.98] mb-2",
                  (pathname === "/app" || pathname.startsWith("/app/control-tower")) && "active"
                )}
              >
                <Radar className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                <span>Command Flow</span>
              </Link>

              {(["workspaces", "studio", "public"] as const).map((sectionId) => {
                const section = primaryNav.find((p) => p.id === sectionId)!;
                const items = secondaryNav[sectionId] || [];
                const SectionIcon = section.icon;
                return (
                  <div key={sectionId} className="mt-2">
                    <div className="kf-section-label flex items-center gap-1.5">
                      <SectionIcon className="w-3 h-3" />
                      {section.label}
                    </div>
                    <div className="flex flex-col gap-px">
                      {items.map((item) => {
                        const Icon = item.icon;
                        const active = isSecondaryActive(item);
                        return (
                          <Link
                            key={item.href + item.label}
                            href={item.href}
                            onClick={() => setMobileDrawerOpen(false)}
                            className={cn(
                              "kf-nav-item py-2.5 active:scale-[0.98]",
                              active && "active"
                            )}
                          >
                            <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                            <span>{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

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
            if (item.href === "#more") {
              return (
                <button
                  key="more"
                  onClick={() => setMobileDrawerOpen(true)}
                  className="flex flex-col items-center justify-center min-w-[56px] min-h-[44px] py-1 transition-all text-muted-foreground active:scale-95"
                  aria-label="More navigation options"
                >
                  <Icon className="w-[20px] h-[20px]" />
                  <span className="text-[10px] mt-0.5">{item.label}</span>
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

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <PlanLimitDialog planLimit={planLimitHit} onClose={clearPlanLimit} />
      <KeyflowOSStoreDrawer open={kfStoreOpen} onClose={() => setKfStoreOpen(false)} />
      <CopilotPanel open={copilotOpen} onClose={() => setCopilotOpen(false)} currentModule={copilotModule} initialPrompt={copilotInitialPrompt} onInitialPromptConsumed={() => setCopilotInitialPrompt(undefined)} />
    </div>
  );
}
