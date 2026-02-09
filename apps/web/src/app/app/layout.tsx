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

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  }, [setAccent1, setAccent2, pathname, router]);

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
            className="h-16 border-b border-border px-4 md:px-6 flex items-center justify-between sticky top-0 z-40"
            style={{ background: "hsl(var(--kf-header-bg))" }}
          >
            <div className="flex items-center gap-4 flex-1">
              <button
                onClick={() => setPaletteOpen(true)}
                className="hidden lg:flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-4 py-2 text-sm text-muted-foreground hover:bg-muted/50 transition-colors min-w-[280px]"
              >
                <Search className="w-4 h-4" />
                <span>Search or press</span>
                <kbd className="ml-auto px-1.5 py-0.5 rounded bg-muted text-xs font-mono">⌘K</kbd>
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 mr-2">
                <div className="text-xs text-muted-foreground">Momentum</div>
                <div className="w-24 kf-momentum-bar">
                  <div className="kf-momentum-fill" style={{ width: `${momentumValue * 100}%` }} />
                </div>
                <div className="text-sm font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
                  {Math.round(momentumValue * 100)}%
                </div>
              </div>
              
              <div className="relative">
                <button
                  onClick={() => setAddMenuOpen((v) => !v)}
                  className="kf-btn-primary inline-flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">New</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
                {addMenuOpen && (
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
                        className="block px-3 py-2 text-sm rounded-lg hover:bg-muted transition-colors"
                      >
                        {action.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative" ref={notifRef}>
                <button 
                  onClick={() => { setNotifOpen((v) => !v); }}
                  className="relative p-2 rounded-xl border border-border bg-card hover:bg-muted transition-colors"
                >
                  <Bell className="w-5 h-5 text-muted-foreground" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full text-[10px] font-bold flex items-center justify-center text-white" style={{ background: "hsl(var(--kf-accent1))" }}>
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-xl border border-border bg-card shadow-xl z-50">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      <span className="text-sm font-semibold">Notifications</span>
                      {unreadCount > 0 && (
                        <button onClick={markAllRead} className="text-xs hover:underline" style={{ color: "hsl(var(--kf-accent1))" }}>
                          Mark all read
                        </button>
                      )}
                    </div>
                    {notifications.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-muted-foreground">No notifications yet</div>
                    ) : (
                      notifications.slice(0, 20).map((n: any) => (
                        <div
                          key={n.id}
                          className={cn(
                            "px-4 py-3 border-b border-border last:border-0 hover:bg-muted/50 transition-colors",
                            !n.read && "bg-muted/30"
                          )}
                        >
                          <div className="flex items-start gap-2">
                            <div className={cn("w-2 h-2 rounded-full mt-1.5 flex-shrink-0", n.read ? "bg-transparent" : "")} style={!n.read ? { background: "hsl(var(--kf-accent1))" } : {}} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{n.title}</p>
                              {n.body && <p className="text-xs text-muted-foreground mt-0.5 truncate">{n.body}</p>}
                              <p className="text-[10px] text-muted-foreground mt-1">
                                {new Date(n.createdAt).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={handleLogout}
                className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card text-sm hover:bg-muted transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Log Out</span>
              </button>

              <div className="flex items-center gap-2">
                {displayName && (
                  <span className="hidden sm:inline text-sm font-medium text-foreground">{displayName}</span>
                )}
                {avatarUrl ? (
                  <img 
                    src={avatarUrl} 
                    alt={displayName || "User"} 
                    className="h-10 w-10 rounded-xl object-cover"
                  />
                ) : (
                  <div 
                    className="h-10 w-10 rounded-xl flex items-center justify-center text-sm font-bold text-white"
                    style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
                  >
                    {initials}
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="flex-1 p-4 md:p-6 pb-20 md:pb-6">{children}</div>
        </main>
      </div>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-card/95 backdrop-blur-lg flex items-center justify-around px-2 z-50 safe-area-pb" style={{ height: "64px" }}>
        {[
          { label: "Home", href: "/app", icon: Home },
          { label: "Contacts", href: "/app/crm/pipeline", icon: Users },
          { label: "Store", href: "/app/store", icon: Store },
          { label: "Bookings", href: "/app/bookings", icon: Calendar },
          { label: "Settings", href: "/app/settings", icon: Settings },
        ].map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all",
                active ? "text-accent1" : "text-muted-foreground"
              )}
              style={active ? { color: "hsl(var(--kf-accent1))" } : undefined}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
