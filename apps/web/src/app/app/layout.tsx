"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandPalette } from "@/components/command-palette";
import { clearStoredBusinessId, getStoredBusinessId, getCachedUser, getUserDisplayName, getUserInitials, refreshWorkspace, getCachedBusiness } from "@/lib/workspace";
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
  GraduationCap,
  FolderKanban,
  Globe,
  Link2,
} from "lucide-react";
import { AiCommandBar, AiCopilotTrigger } from "./_command/ai-command-bar";

interface NavItem {
  label: string;
  href: string;
  icon: typeof Zap;
  matchTab?: string;
  exactMatch?: boolean;
}

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "OPERATE",
    items: [
      { label: "Command", href: "/app", icon: Zap },
      { label: "Contacts", href: "/app/crm/pipeline", icon: Users },
      { label: "Commerce", href: "/app/commerce", icon: CreditCard },
      { label: "Bookings", href: "/app/bookings", icon: Calendar },
    ],
  },
  {
    label: "GROW",
    items: [
      { label: "Marketing", href: "/app/marketing", icon: Megaphone },
      { label: "Marketplace", href: "/app/marketplace", icon: Globe },
    ],
  },
  {
    label: "MANAGE",
    items: [
      { label: "Expenses", href: "/app/expenses", icon: Receipt },
      { label: "Projects", href: "/app/projects", icon: FolderKanban, exactMatch: true },
      { label: "Automations", href: "/app/projects?tab=playbooks", icon: Zap, matchTab: "playbooks" },
      { label: "Reports", href: "/app/reports", icon: BarChart3 },
    ],
  },
  {
    label: "SETUP",
    items: [
      { label: "Store Setup", href: "/app/store", icon: Store },
    ],
  },
];

const bottomNavItems = [
  { label: "Learn", href: "/app/learn", icon: GraduationCap },
  { label: "Community", href: "/app/community", icon: Users },
  { label: "Settings", href: "/app/settings", icon: Settings },
];

const mobileBottomNav = [
  { label: "Command", href: "/app", icon: Zap },
  { label: "Commerce", href: "/app/commerce", icon: CreditCard },
  { label: "Bookings", href: "/app/bookings", icon: Calendar },
  { label: "Contacts", href: "/app/crm/pipeline", icon: Users },
  { label: "More", href: "#more", icon: MoreHorizontal },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const isNavActive = useCallback((item: NavItem) => {
    const basePath = item.href.split("?")[0];
    if (item.matchTab) {
      return pathname === basePath && searchParams.get("tab") === item.matchTab;
    }
    if (item.exactMatch) {
      return pathname === basePath && !searchParams.get("tab");
    }
    return pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href));
  }, [pathname, searchParams]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const { setAccent1, setAccent2 } = useThemeColors();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [initials, setInitials] = useState("KF");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  useEffect(() => {
    setMobileDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    const init = async () => {
      await refreshWorkspace();
      const user = getCachedUser();
      const business = getCachedBusiness();
      
      if (user) {
        setDisplayName(getUserDisplayName());
        setInitials(getUserInitials());
        if (user.avatarUrl) setAvatarUrl(user.avatarUrl);
      }

      const businessId = getStoredBusinessId();
      if (businessId) {
        const res = await apiGet(`/identity/businesses/${businessId}`);
        if (res.data) {
          const data = res.data as { primaryColor?: string; secondaryColor?: string; onboardingComplete?: boolean };
          if (data.primaryColor) setAccent1(data.primaryColor);
          if (data.secondaryColor) setAccent2(data.secondaryColor);
          
          if (data.onboardingComplete === false && !pathname.startsWith("/app/onboarding")) {
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
    };
    if (notifOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [notifOpen]);

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
      if (e.key === "Escape") {
        setPaletteOpen(false);
        setAddMenuOpen(false);
        setMobileDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="h-dvh bg-background text-foreground overflow-hidden">
      <div className="flex h-full">
        <aside 
          role="navigation"
          aria-label="Main navigation"
          className={cn(
            "hidden md:flex md:flex-col border-r border-border h-full transition-all duration-200",
            sidebarCollapsed ? "w-[60px]" : "w-56"
          )}
          style={{ background: "hsl(var(--kf-sidebar-bg))" }}
        >
          <div className="flex items-center gap-2.5 px-3 py-4">
            <div 
              className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "hsl(var(--kf-accent1))" }}
            >
              <Zap className="w-4 h-4 text-white" />
            </div>
            {!sidebarCollapsed && (
              <h1 className="text-sm font-bold tracking-tight">KEYFLOWOS</h1>
            )}
          </div>

          <div className="flex-1 flex flex-col py-1 px-2 overflow-y-auto min-h-0">
            {navGroups.map((group, groupIdx) => (
              <div key={group.label} className={cn(groupIdx > 0 && "mt-4")}>
                {!sidebarCollapsed && (
                  <div className="kf-section-label">{group.label}</div>
                )}
                {sidebarCollapsed && groupIdx > 0 && (
                  <div className="kf-divider mx-1 mb-1" />
                )}
                <div className="flex flex-col gap-px">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = isNavActive(item);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "kf-nav-item",
                          active && "active",
                          sidebarCollapsed && "justify-center px-2"
                        )}
                        title={sidebarCollapsed ? item.label : undefined}
                      >
                        <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                        {!sidebarCollapsed && <span>{item.label}</span>}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-auto px-2 pb-3 space-y-px">
            {bottomNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "kf-nav-item",
                    isActive && "active",
                    sidebarCollapsed && "justify-center px-2"
                  )}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                  {!sidebarCollapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
            
            <div className="pt-2 mt-1 border-t border-border flex items-center justify-between">
              {!sidebarCollapsed && <ThemeToggle />}
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {sidebarCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
              </button>
            </div>
          </div>
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

              <div className="hidden md:flex flex-1 min-w-0 max-w-lg">
                <AiCommandBar />
              </div>
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
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">New</span>
                </button>
                {addMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setAddMenuOpen(false)} />
                    <div className="absolute right-0 mt-1.5 w-56 kf-glass-surface p-1.5 z-50 max-h-[70vh] overflow-y-auto">
                      {[
                        { label: "Contact", icon: Users, href: "/app/crm/pipeline" },
                        { label: "Invoice", icon: Receipt, href: "/app/commerce" },
                        { label: "Booking", icon: Calendar, href: "/app/bookings" },
                        { label: "Post", icon: MessageCircle, href: "/app/marketing?tab=social" },
                        { label: "Expense", icon: Receipt, href: "/app/expenses" },
                        { label: "Project", icon: FolderKanban, href: "/app/projects" },
                        { label: "Campaign", icon: Megaphone, href: "/app/marketing" },
                      ].map((action) => {
                        const ActionIcon = action.icon;
                        return (
                          <Link
                            key={action.label}
                            href={action.href}
                            onClick={() => setAddMenuOpen(false)}
                            className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm hover:bg-muted transition-colors"
                          >
                            <ActionIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            <span className="text-[13px]">{action.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </>
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
                        notifications.slice(0, 20).map((n: any) => (
                          <div
                            key={n.id}
                            className={cn(
                              "px-4 py-3 border-b border-border last:border-0 hover:bg-muted/50 transition-colors active:bg-muted/70",
                              !n.read && "bg-muted/30"
                            )}
                          >
                            <div className="flex items-start gap-2">
                              <div className={cn("w-2 h-2 rounded-full mt-1.5 flex-shrink-0", n.read ? "bg-transparent" : "")} style={!n.read ? { background: "hsl(var(--kf-accent1))" } : {}} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">{n.title}</p>
                                {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                                <p className="text-[10px] text-muted-foreground mt-1">
                                  {new Date(n.createdAt).toLocaleString()}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                      <div className="h-safe-area-inset-bottom md:hidden" />
                    </div>
                  </>
                )}
              </div>

              <div className="hidden sm:flex items-center gap-1.5">
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
                <button
                  onClick={handleLogout}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label="Log out"
                  title="Log out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </header>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 md:p-6 pb-24 md:pb-6">{children}</div>
        </main>
        <AiCopilotTrigger />
      </div>

      {mobileDrawerOpen && (
        <div className="md:hidden fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileDrawerOpen(false)} />
          <div
            className="absolute left-0 top-0 bottom-0 w-64 border-r border-border flex flex-col overflow-y-auto"
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
              <div className="px-3 py-2.5 border-b border-border flex items-center gap-2.5">
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
                </div>
              </div>
            )}

            <div className="flex-1 py-2 px-2">
              {navGroups.map((group, groupIdx) => (
                <div key={group.label} className={cn(groupIdx > 0 && "mt-3")}>
                  <div className="kf-section-label">{group.label}</div>
                  <div className="flex flex-col gap-px">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = isNavActive(item);
                      return (
                        <Link
                          key={item.href}
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
              ))}

              <div className="kf-divider my-2" />

              <div className="flex flex-col gap-px">
                {bottomNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileDrawerOpen(false)}
                      className={cn(
                        "kf-nav-item py-2.5 active:scale-[0.98]",
                        isActive && "active"
                      )}
                    >
                      <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
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
    </div>
  );
}
