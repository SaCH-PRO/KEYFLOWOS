"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Gauge,
  LayoutGrid,
  Package,
  Users,
  ShoppingBag,
  Search,
  BarChart3,
  Settings,
} from "lucide-react";

const TABS: {
  key: string;
  label: string;
  href: string;
  Icon: React.ComponentType<{ className?: string }>;
  match: (pathname: string) => boolean;
  external?: boolean;
}[] = [
  {
    key: "overview",
    label: "Overview",
    href: "/app/presence",
    Icon: Gauge,
    match: (p) => p === "/app/presence" || p === "/app/presence/",
  },
  {
    key: "pages",
    label: "Pages",
    href: "/app/presence/pages",
    Icon: LayoutGrid,
    match: (p) => p.startsWith("/app/presence/pages"),
  },
  {
    key: "catalog",
    label: "Catalog",
    href: "/app/store",
    Icon: Package,
    match: () => false,
    external: true,
  },
  {
    key: "leads",
    label: "Leads",
    href: "/app/presence/leads",
    Icon: Users,
    match: (p) => p.startsWith("/app/presence/leads"),
  },
  {
    key: "orders",
    label: "Orders & Bookings",
    href: "/app/presence/orders",
    Icon: ShoppingBag,
    match: (p) =>
      p.startsWith("/app/presence/orders") ||
      p.startsWith("/app/presence/bookings"),
  },
  {
    key: "seo",
    label: "SEO & Sharing",
    href: "/app/presence/pages?focus=seo",
    Icon: Search,
    match: () => false,
  },
  {
    key: "insights",
    label: "Insights",
    href: "/app/presence/insights",
    Icon: BarChart3,
    match: (p) => p.startsWith("/app/presence/insights"),
  },
  {
    key: "settings",
    label: "Settings",
    href: "/app/settings",
    Icon: Settings,
    match: () => false,
    external: true,
  },
];

export default function PresenceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/app/presence";
  return (
    <div className="flex flex-col min-h-full">
      <div className="border-b border-border/40 bg-slate-950/40 sticky top-0 z-10">
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-lg font-semibold flex items-center gap-2">
                <Gauge className="w-4 h-4 text-orange-400" />
                Presence Command Center
              </h1>
              <p className="text-xs text-muted-foreground">
                Your storefront&apos;s health, growth, and revenue actions in one place.
              </p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-1 -mb-px overflow-x-auto" role="tablist">
            {TABS.map((t) => {
              const active = t.match(pathname);
              return (
                <Link
                  key={t.key}
                  href={t.href}
                  role="tab"
                  aria-selected={active}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t-md border-b-2 transition-colors whitespace-nowrap",
                    active
                      ? "border-orange-500 text-orange-300 bg-slate-900/40"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-slate-900/30",
                  )}
                >
                  <t.Icon className="w-3.5 h-3.5" />
                  {t.label}
                  {t.external && <span className="text-[9px] text-muted-foreground/70">↗</span>}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
