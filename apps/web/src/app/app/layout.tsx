"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandPalette } from "@/components/command-palette";
import {
  Activity,
  Settings,
  Sparkles,
  Users,
  CreditCard,
  Calendar,
  Share2,
  Workflow,
} from "lucide-react";

const navItems = [
  { label: "Cockpit", href: "/app", icon: Activity },
  { label: "CRM", href: "/app/crm", icon: Users },
  { label: "Commerce", href: "/app/commerce", icon: CreditCard },
  { label: "Bookings", href: "/app/bookings", icon: Calendar },
  { label: "Social", href: "/app/social", icon: Share2 },
  { label: "Automations", href: "/app/automations", icon: Workflow },
  { label: "Studio", href: "/app/studio", icon: Sparkles },
  { label: "Settings", href: "/app/settings", icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Hotkey Cmd/Ctrl + K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-slate-950/95 text-foreground">
      <div className="flex">
        <aside className="hidden md:flex md:flex-col md:w-64 border-r border-border/60 bg-slate-950/70 backdrop-blur-xl">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-border/60">
            <div className="h-9 w-9 rounded-2xl bg-primary/20 flex items-center justify-center shadow-glow-primary">
              <span className="h-4 w-4 rounded-full bg-primary" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">KeyFlow</div>
              <div className="text-sm font-semibold">Command OS</div>
            </div>
          </div>

          <nav className="flex-1 px-2 py-4 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group relative flex items-center gap-3 px-3 py-2 rounded-2xl text-sm font-medium transition-colors",
                    active
                      ? "text-primary bg-primary/10 border border-primary/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-slate-900/60",
                  )}
                >
                  <span className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 blur-xl bg-primary/20 pointer-events-none transition-opacity" />
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="relative z-10">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="px-4 pb-4 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
            <span>Workspace: Demo</span>
            <ThemeToggle />
          </div>
        </aside>

        <main className="flex-1 flex flex-col min-h-screen">
          <header className="h-14 border-b border-border/60 px-4 md:px-6 flex items-center justify-between bg-slate-950/50 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/70 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-ping" />
                Cmd/Ctrl + K
              </span>
              <span className="text-xs text-muted-foreground hidden md:inline">
                Run AI actions, jump to modules, or search.
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button className="hidden sm:inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground">
                Switch Business
              </button>
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary/60 to-slate-800 border border-primary/50 shadow-glow-primary flex items-center justify-center text-[10px] uppercase tracking-wide">
                KF
              </div>
            </div>
          </header>

          <div className="flex-1 px-4 md:px-6 py-4 md:py-6">{children}</div>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
