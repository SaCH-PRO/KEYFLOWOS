"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandPalette } from "@/components/command-palette";
import { clearStoredBusinessId, getStoredBusinessId, getCachedUser, getUserDisplayName, getUserInitials, refreshWorkspace, getCachedBusiness } from "@/lib/workspace";
import { apiGet, apiPatch } from "@/lib/api";
import { useThemeColors } from "@/lib/theme-context";
import {
  Activity,
  Settings,
  Sparkles,
  Users,
  CreditCard,
  Calendar,
  Share2,
  Workflow,
  Bell,
  Plus,
  ChevronDown,
  LayoutDashboard,
  BarChart3,
  LogOut,
  Search,
  Zap,
  Home,
  MessageCircle,
  PanelLeftClose,
  PanelLeft,
  Store,
  Menu,
  X,
  MoreHorizontal,
} from "lucide-react";

const navItems = [
  { label: "Cockpit", href: "/app", icon: Home },
  { label: "Contacts", href: "/app/crm/pipeline", icon: Users },
  { label: "Commerce", href: "/app/commerce", icon: CreditCard },
  { label: "Bookings", href: "/app/bookings", icon: Calendar },
  { label: "Store", href: "/app/store", icon: Store },
  { label: "Social", href: "/app/social", icon: MessageCircle },
  { label: "Automations", href: "/app/automations", icon: Zap },
  { label: "Reports", href: "/app/reports", icon: BarChart3 },
];

const bottomNavItems = [
  { label: "Studio", href: "/app/studio", icon: Sparkles },
  { label: "Settings", href: "/app/settings", icon: Settings },
];

const mobileBottomNav = [
  { label: "Home", href: "/app", icon: Home },
  { label: "Social", href: "/app/social", icon: MessageCircle },
  { label: "Commerce", href: "/app/commerce", icon: CreditCard },
  { label: "Bookings", href: "/app/bookings", icon: Calendar },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const momentumValue = 0.52;
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
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex">
        <aside 
          className={cn(
            "hidden md:flex md:flex-col border-r border-border min-h-screen transition-all duration-300",
            sidebarCollapsed ? "w-[72px]" : "w-64"
          )}
          style={{ background: "hsl(var(--kf-sidebar-bg))" }}
        >
          <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
            <div 
              className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
            >
              <Zap className="w-5 h-5 text-white" />
            </div>
            {!sidebarCollapsed && (
              <div className="flex-1 min-w-0">
                <h1 className="text-lg font-bold tracking-tight">KEYFLOWOS</h1>
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col py-4 px-3 gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href));
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
                  <Icon className="w-5 h-5 flex-shrink-0 kf-nav-icon" />
                  {!sidebarCollapsed && <span className="text-sm font-medium">{item.label}</span>}
                </Link>
              );
            })}
          </div>

          <div className="mt-auto px-3 pb-4 space-y-1">
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
                  <Icon className="w-5 h-5 flex-shrink-0 kf-nav-icon" />
                  {!sidebarCollapsed && <span className="text-sm font-medium">{item.label}</span>}
                </Link>
              );
            })}
            
            <div className="pt-3 border-t border-border flex items-center justify-between">
              {!sidebarCollapsed && <ThemeToggle />}
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {sidebarCollapsed ? <PanelLeft className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </aside>

        <main className="flex-1 flex flex-col min-h-screen">
          <header 
            className="h-14 md:h-16 border-b border-border px-3 md:px-6 flex items-center justify-between sticky top-0 z-40"
            style={{ background: "hsl(var(--kf-header-bg))" }}
          >
            <div className="flex items-center gap-2 md:gap-4 flex-1">
              <button
                onClick={() => setMobileDrawerOpen(true)}
                className="md:hidden p-2.5 -ml-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Open navigation menu"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="md:hidden flex items-center gap-2 flex-1 min-w-0">
                <div 
                  className="h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
                >
                  <Zap className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-sm font-bold tracking-tight truncate">KEYFLOWOS</span>
              </div>

              <button
                onClick={() => setPaletteOpen(true)}
                className="hidden lg:flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-4 py-2 text-sm text-muted-foreground hover:bg-muted/50 transition-colors min-w-[280px]"
              >
                <Search className="w-4 h-4" />
                <span>Search or press</span>
                <kbd className="ml-auto px-1.5 py-0.5 rounded bg-muted text-xs font-mono">⌘K</kbd>
              </button>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-3">
              <div className="hidden sm:flex items-center gap-2 mr-2">
                <div className="text-xs text-muted-foreground">Momentum</div>
                <div className="w-24 kf-momentum-bar">
                  <div className="kf-momentum-fill" style={{ width: `${momentumValue * 100}%` }} />
                </div>
                <div className="text-sm font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
                  {Math.round(momentumValue * 100)}%
                </div>
              </div>

              <button
                onClick={() => setPaletteOpen(true)}
                className="lg:hidden p-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Search"
              >
                <Search className="w-5 h-5" />
              </button>
              
              <div className="relative">
                <button
                  onClick={() => setAddMenuOpen((v) => !v)}
                  className="kf-btn-primary inline-flex items-center gap-1 sm:gap-2 !px-2.5 sm:!px-4 !py-2"
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline text-sm">New</span>
                  <ChevronDown className="w-3 h-3 hidden sm:block" />
                </button>
                {addMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setAddMenuOpen(false)} />
                    <div className="absolute right-0 mt-2 w-48 rounded-xl border border-border bg-card shadow-lg p-2 z-50">
                      {[
                        { label: "New Contact", href: "/app/crm/pipeline" },
                        { label: "New Invoice", href: "/app/commerce" },
                        { label: "New Booking", href: "/app/bookings" },
                        { label: "New Post", href: "/app/social" },
                      ].map((action) => (
                        <Link
                          key={action.label}
                          href={action.href}
                          onClick={() => setAddMenuOpen(false)}
                          className="block px-3 py-2.5 text-sm rounded-lg hover:bg-muted transition-colors"
                        >
                          {action.label}
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="relative" ref={notifRef}>
                <button 
                  onClick={() => { setNotifOpen((v) => !v); }}
                  className="relative p-2 rounded-xl border border-border bg-card hover:bg-muted transition-colors"
                  aria-label="Notifications"
                >
                  <Bell className="w-5 h-5 text-muted-foreground" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full text-[10px] font-bold flex items-center justify-center text-white" style={{ background: "hsl(var(--kf-accent1))" }}>
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <>
                    <div className="fixed inset-0 z-[55] md:hidden bg-black/40" onClick={() => setNotifOpen(false)} />
                    <div className="fixed inset-x-0 bottom-0 top-auto md:absolute md:right-0 md:left-auto md:bottom-auto md:top-full mt-0 md:mt-2 w-full md:w-80 max-h-[70vh] md:max-h-96 overflow-y-auto rounded-t-2xl md:rounded-xl border border-border bg-card shadow-xl z-[56]">
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

              <button
                onClick={handleLogout}
                className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card text-sm hover:bg-muted transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Log Out</span>
              </button>

              <div className="hidden sm:flex items-center gap-2">
                {displayName && (
                  <span className="hidden sm:inline text-sm font-medium text-foreground">{displayName}</span>
                )}
                {avatarUrl ? (
                  <img 
                    src={avatarUrl} 
                    alt={displayName || "User"} 
                    className="h-9 w-9 md:h-10 md:w-10 rounded-xl object-cover"
                  />
                ) : (
                  <div 
                    className="h-9 w-9 md:h-10 md:w-10 rounded-xl flex items-center justify-center text-sm font-bold text-white"
                    style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
                  >
                    {initials}
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="flex-1 p-3 sm:p-4 md:p-6 pb-24 md:pb-6">{children}</div>
        </main>
      </div>

      {mobileDrawerOpen && (
        <div className="md:hidden fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileDrawerOpen(false)} />
          <div
            className="absolute left-0 top-0 bottom-0 w-72 border-r border-border flex flex-col overflow-y-auto"
            style={{ background: "hsl(var(--kf-sidebar-bg))" }}
          >
            <div className="flex items-center justify-between px-4 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div 
                  className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
                >
                  <Zap className="w-4 h-4 text-white" />
                </div>
                <h1 className="text-base font-bold tracking-tight">KEYFLOWOS</h1>
              </div>
              <button
                onClick={() => setMobileDrawerOpen(false)}
                className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {displayName && (
              <div className="px-4 py-3 border-b border-border flex items-center gap-3">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="h-9 w-9 rounded-xl object-cover" />
                ) : (
                  <div 
                    className="h-9 w-9 rounded-xl flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
                  >
                    {initials}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{displayName}</p>
                  <p className="text-[10px] text-muted-foreground">Manage your business</p>
                </div>
              </div>
            )}

            <div className="flex-1 py-3 px-3 space-y-0.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all active:scale-[0.98]",
                      isActive
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                    style={isActive ? { background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" } : undefined}
                  >
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    {item.label}
                  </Link>
                );
              })}

              <div className="my-2 border-t border-border" />

              {bottomNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all active:scale-[0.98]",
                      isActive
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                    style={isActive ? { background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" } : undefined}
                  >
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>

            <div className="mt-auto px-3 pb-6 space-y-2 border-t border-border pt-3">
              <div className="flex items-center justify-between px-3">
                <ThemeToggle />
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all w-full active:scale-[0.98]"
              >
                <LogOut className="w-5 h-5" />
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}

      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-card/95 backdrop-blur-lg z-50 safe-area-pb" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="flex items-center justify-around px-1" style={{ height: "60px" }}>
          {mobileBottomNav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 min-w-[56px] py-1.5 px-2 rounded-xl transition-all active:scale-95",
                  active ? "" : "text-muted-foreground"
                )}
                style={active ? { color: "hsl(var(--kf-accent1))" } : undefined}
              >
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {active && (
                    <div
                      className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-0.5 rounded-full"
                      style={{ background: "hsl(var(--kf-accent1))" }}
                    />
                  )}
                </div>
                <span className="text-[10px] font-medium mt-0.5">{item.label}</span>
              </Link>
            );
          })}
          <button
            onClick={() => setMobileDrawerOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 min-w-[56px] py-1.5 px-2 rounded-xl transition-all text-muted-foreground active:scale-95"
            aria-label="More navigation options"
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-0.5">More</span>
          </button>
        </div>
      </nav>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
