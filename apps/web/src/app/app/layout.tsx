"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandPalette } from "@/components/command-palette";
import { clearStoredBusinessId } from "@/lib/workspace";
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
  Command,
} from "lucide-react";

const navSections = [
  {
    title: "Primary",
    items: [
      { label: "Command", href: "/app", icon: Command },
      { label: "Contacts", href: "/app/crm/pipeline", icon: Users },
      { label: "Commerce", href: "/app/commerce", icon: CreditCard },
      { label: "Bookings", href: "/app/bookings", icon: Calendar },
      { label: "Social", href: "/app/social", icon: Share2 },
    ],
  },
  {
    title: "Secondary",
    items: [
      { label: "Projects", href: "/app/projects", icon: LayoutDashboard },
      { label: "Automations", href: "/app/automations", icon: Workflow },
      { label: "Reports", href: "/app/reports", icon: BarChart3 },
    ],
  },
  {
    title: "Studio",
    items: [
      { label: "Studio", href: "/app/studio", icon: Sparkles },
      { label: "Settings", href: "/app/settings", icon: Settings },
    ],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const momentumValue = 0.65;

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
      <div 
        className="h-1 w-full"
        style={{ background: "hsl(var(--kf-muted))" }}
      >
        <div
          className="h-full transition-all duration-500"
          style={{ 
            width: `${Math.round(momentumValue * 100)}%`,
            background: "hsl(var(--kf-accent1))"
          }}
        />
      </div>

      <div className="flex">
        <aside 
          className="hidden md:flex md:flex-col md:w-64 border-r border-border min-h-[calc(100vh-4px)]"
          style={{ background: "hsl(var(--kf-sidebar-bg))" }}
        >
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
            <div 
              className="h-10 w-10 rounded-2xl flex items-center justify-center"
              style={{ background: "hsl(var(--kf-accent1))" }}
            >
              <Command className="h-5 w-5 text-white" />
            </div>
            <span className="text-base font-bold tracking-wide" style={{ color: "hsl(var(--kf-accent1))" }}>
              KEYFLOW
            </span>
          </div>

          <nav className="flex-1 px-3 py-4 space-y-6">
            {navSections.map((section) => (
              <div key={section.title} className="space-y-1">
                <div className="px-3 text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
                  {section.title}
                </div>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || 
                    (item.href !== "/app" && pathname.startsWith(item.href));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                        active
                          ? "text-primary bg-primary/10"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                      )}
                    >
                      <Icon className={cn("w-4 h-4", active && "text-primary")} />
                      <span>{item.label}</span>
                      {active && (
                        <div 
                          className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full"
                          style={{ background: "hsl(var(--kf-accent1))" }}
                        />
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="px-4 py-4 border-t border-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Theme</span>
            <ThemeToggle />
          </div>
        </aside>

        <main className="flex-1 flex flex-col min-h-[calc(100vh-4px)]">
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
              <div className="relative">
                <button
                  onClick={() => setAddMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white transition-all hover:opacity-90"
                  style={{ background: "hsl(var(--kf-accent1))" }}
                >
                  <Plus className="w-4 h-4" />
                  New
                  <ChevronDown className="w-3 h-3" />
                </button>
                {addMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 rounded-xl border border-border bg-card shadow-lg p-2 z-50">
                    {[
                      { label: "New Contact", href: "/app/crm/pipeline" },
                      { label: "New Invoice", href: "/app/commerce" },
                      { label: "New Booking", href: "/app/bookings" },
                      { label: "New Automation", href: "/app/automations" },
                    ].map((item) => (
                      <Link
                        key={item.label}
                        href={item.href}
                        onClick={() => setAddMenuOpen(false)}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-muted text-sm transition-colors"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <button className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-border bg-card hover:bg-muted text-muted-foreground transition-colors">
                <Bell className="w-4 h-4" />
              </button>

              <button
                onClick={handleLogout}
                className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Log Out
              </button>

              <div 
                className="h-10 w-10 rounded-xl flex items-center justify-center text-white text-sm font-bold"
                style={{ background: "hsl(var(--kf-accent1))" }}
              >
                KF
              </div>
            </div>
          </header>

          <div className="flex-1 p-4 md:p-6 pb-20 md:pb-6">{children}</div>
        </main>
      </div>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 border-t border-border bg-card flex items-center justify-around px-2 z-50 safe-area-pb">
        {[
          { label: "Home", href: "/app", icon: Command },
          { label: "Contacts", href: "/app/crm/pipeline", icon: Users },
          { label: "Commerce", href: "/app/commerce", icon: CreditCard },
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
                "flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors",
                active ? "text-primary" : "text-muted-foreground"
              )}
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
