"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandPalette } from "@/components/command-palette";
import { fetchBusinesses, getActiveBusinessId, setActiveBusinessId, type Membership } from "@/lib/client";
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
  Building2,
  Search,
} from "lucide-react";

const navSections = [
  {
    title: "Primary",
    items: [
  { label: "Command", href: "/app", icon: Activity },
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
      { label: "Identity", href: "/app/identity", icon: Building2 },
      { label: "Studio", href: "/app/studio", icon: Sparkles },
      { label: "Settings", href: "/app/settings", icon: Settings },
    ],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [businessMenuOpen, setBusinessMenuOpen] = useState(false);
  const [businesses, setBusinesses] = useState<Membership[]>([]);
  const [activeBusinessId, setActiveBusinessIdState] = useState<string>("");
  const [businessLoading, setBusinessLoading] = useState(false);
  // Temporary momentum value; could be wired to live data
  const momentumValue = 0.65;

  // Hotkey Cmd/Ctrl + K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setPaletteOpen(false);
        setAddMenuOpen(false);
        setBusinessMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    setActiveBusinessIdState(getActiveBusinessId());
    setBusinessLoading(true);
    fetchBusinesses()
      .then((res) => {
        const items = res.data ?? [];
        setBusinesses(items);
        const stored = getActiveBusinessId();
        const exists = items.some((m) => m.business?.id === stored);
        if (!exists && items[0]?.business?.id) {
          setActiveBusinessId(items[0].business.id);
          setActiveBusinessIdState(items[0].business.id);
        }
      })
      .finally(() => setBusinessLoading(false));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { businessId?: string } | undefined;
      setActiveBusinessIdState(detail?.businessId ?? getActiveBusinessId());
    };
    window.addEventListener("kf:businessChanged", handler as EventListener);
    return () => window.removeEventListener("kf:businessChanged", handler as EventListener);
  }, []);

  const activeBusiness = businesses.find((membership) => membership.business?.id === activeBusinessId);
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Slim momentum bar visible across pages */}
      <div className="h-1 w-full bg-muted border-b border-border/60">
        <div
          className="h-full bg-gradient-to-r from-primary via-accent to-primary/80 transition-all duration-500 shadow-[0_0_12px_hsl(var(--kf-primary)/0.35)]"
          style={{ width: `${Math.round(momentumValue * 100)}%` }}
        />
      </div>
      <div className="flex">
        <aside className="hidden md:flex md:flex-col md:w-64 border-r border-border/60 bg-card">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-border/60">
            <div className="h-9 w-9 rounded-2xl bg-primary/20 flex items-center justify-center shadow-[var(--kf-glow)]">
              <span className="h-4 w-4 rounded-full bg-primary" />
            </div>
            <div className="text-sm font-semibold text-primary tracking-[0.24em] drop-shadow-[0_0_12px_rgba(41,123,255,0.7)]">
              KEYFLOWOS
            </div>
          </div>

          <nav className="flex-1 px-2 py-4 space-y-4">
            {navSections.map((section) => (
              <div key={section.title} className="space-y-1">
                <div className="px-3 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                  {section.title}
                </div>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "group relative flex items-center gap-3 px-3 py-2 rounded-2xl text-sm font-medium transition-colors border border-transparent",
                        active
                          ? "text-primary bg-primary/10 border-primary/30"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted hover:border-border/60",
                      )}
                    >
                      <span className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 blur-xl bg-primary/20 pointer-events-none transition-opacity" />
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="relative z-10">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="px-4 pb-4 border-t border-border/60 flex items-center justify-end text-xs text-muted-foreground">
            <ThemeToggle />
          </div>
        </aside>

        <main className="flex-1 flex flex-col min-h-screen">
          <header className="h-14 border-b border-border/60 px-4 md:px-6 flex items-center justify-between bg-background/80 backdrop-blur-xl">
            <div className="flex items-center gap-3 flex-1">
              <div className="hidden lg:flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs text-muted-foreground min-w-[280px]">
                <Search className="w-3.5 h-3.5" />
                <span className="text-muted-foreground/80">Global search or type Cmd/Ctrl + K</span>
              </div>
              <button
                onClick={() => setPaletteOpen(true)}
                className="inline-flex items-center gap-2 rounded-full border border-primary/70 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-ping" />
                Command Palette
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <button
                  onClick={() => setAddMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-full border border-primary/70 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add New
                  <ChevronDown className="w-3 h-3" />
                </button>
                {addMenuOpen ? (
                  <div className="absolute right-0 mt-2 w-48 rounded-2xl border border-border/70 bg-card shadow-[var(--kf-shadow)] p-2 text-sm text-foreground z-20">
                    {[
                      { label: "New Contact", href: "/app/crm/pipeline" },
                      { label: "New Invoice", href: "/app/commerce" },
                      { label: "New Booking", href: "/app/bookings" },
                      { label: "New Automation", href: "/app/automations" },
                    ].map((item) => (
                      <Link
                        key={item.label}
                        href={item.href}
                        className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-muted text-sm text-foreground"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
              <button className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-border bg-card hover:border-primary/60 text-muted-foreground">
                <Bell className="w-4 h-4" />
              </button>
              <div className="relative hidden sm:block">
                <button
                  onClick={() => setBusinessMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground"
                >
                  <Building2 className="w-3.5 h-3.5" />
                  {businessLoading
                    ? "Loading..."
                    : activeBusiness?.business?.name ?? "Select Business"}
                  <ChevronDown className="w-3 h-3" />
                </button>
                {businessMenuOpen ? (
                  <div className="absolute right-0 mt-2 w-60 rounded-2xl border border-border/70 bg-card shadow-[var(--kf-shadow)] p-2 text-sm text-foreground z-20">
                    {businesses.length === 0 && (
                      <Link
                        href="/app/identity"
                        className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-muted text-sm text-foreground"
                      >
                        Create a business
                      </Link>
                    )}
                    {businesses.map((membership) => {
                      const id = membership.business?.id ?? "";
                      return (
                        <button
                          key={membership.id}
                          onClick={() => {
                            if (!id) return;
                            setActiveBusinessId(id);
                            setActiveBusinessIdState(id);
                            setBusinessMenuOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-xl px-2 py-2 text-sm",
                            id === activeBusinessId
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-muted text-foreground",
                          )}
                        >
                          <span>{membership.business?.name ?? "Unnamed"}</span>
                          <span className="text-[11px] text-muted-foreground">{membership.role}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary/60 to-accent/60 border border-primary/50 shadow-[var(--kf-glow)] flex items-center justify-center text-[10px] uppercase tracking-wide">
                KF
              </div>
            </div>
          </header>

          <div key={activeBusinessId} className="flex-1 px-4 md:px-6 py-4 md:py-6">
            {children}
          </div>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
