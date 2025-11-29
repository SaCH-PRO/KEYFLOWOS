"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  Shield,
  Users,
  Building2,
  Activity,
  Bell,
  Cpu,
  LayoutTemplate,
  Home,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Overview", href: "/admin", icon: Home },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Businesses", href: "/admin/businesses", icon: Building2 },
  { label: "Analytics", href: "/admin/analytics", icon: Activity },
  { label: "Events", href: "/admin/events", icon: Bell },
  { label: "System Mind", href: "/admin/system", icon: Cpu },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-slate-950 to-slate-900 text-foreground">
      <div className="flex">
        <aside className="hidden md:flex md:flex-col md:w-64 border-r border-border/70 bg-slate-950/80 backdrop-blur-xl">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-border/70">
            <div className="h-9 w-9 rounded-2xl bg-primary/20 flex items-center justify-center shadow-glow-primary">
              <Shield className="w-4 h-4 text-primary" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">KeyFlow</div>
              <div className="text-sm font-semibold">Owner Console</div>
            </div>
            <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-primary/50 bg-primary/10 px-2 py-1 text-[11px] text-primary">
              SUPER ADMIN
            </span>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1">
            {navItems.map((item) => {
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
                      : "text-muted-foreground hover:text-foreground hover:bg-slate-900/60 hover:border-border/60",
                  )}
                >
                  <span className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 blur-xl bg-primary/20 pointer-events-none transition-opacity" />
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="relative z-10">{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="px-4 pb-4 border-t border-border/70 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Platform status</span>
              <span className="inline-flex items-center gap-1 text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Stable
              </span>
            </div>
          </div>
        </aside>
        <main className="flex-1 min-h-screen">
          <header className="h-14 border-b border-border/70 px-4 md:px-6 flex items-center justify-between bg-slate-950/70 backdrop-blur-xl">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <LayoutTemplate className="w-4 h-4" />
              Overwatch - full platform view
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/50 bg-primary/10 px-2 py-1 text-primary">
                Electric Blue Mode
              </span>
            </div>
          </header>
          <div className="p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
