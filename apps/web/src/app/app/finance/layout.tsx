"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote, BarChart3, BookOpen, Calculator, Landmark,
  LayoutDashboard, Receipt, Settings as SettingsIcon, TrendingUp,
  Wallet, Zap,
} from "lucide-react";

/**
 * FIN5 — File-based shell for the unified Finance cockpit. Each tab is its
 * own route segment under /app/finance, so navigation is handled by Next's
 * router (deep-linkable, browser back/forward works) instead of a query
 * param. Sub-routes that live under Money In / Money Out / Reports compose
 * the existing default-exported page modules from /app/commerce, /app/expenses
 * and /app/reports — no React state duplication, single source of truth.
 *
 * User-facing tab labels follow the FIN5 audit (§16): "Money In", "Money Out",
 * "Owed to You" instead of accountant-speak.
 */
const TABS = [
  { href: "/app/finance",                label: "Overview",       icon: LayoutDashboard },
  { href: "/app/finance/revenue",        label: "Money In",       icon: TrendingUp },
  { href: "/app/finance/expenses",       label: "Money Out",      icon: Receipt },
  { href: "/app/finance/cashflow",       label: "Cashflow",       icon: Banknote },
  { href: "/app/finance/accounts",       label: "Accounts",       icon: Wallet },
  { href: "/app/finance/reconciliation", label: "Reconciliation", icon: BookOpen },
  { href: "/app/finance/reports",        label: "Reports",        icon: BarChart3 },
  { href: "/app/finance/tax",            label: "Tax",            icon: Calculator },
  { href: "/app/finance/actions",        label: "Owed to You",    icon: Zap },
];

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/app/finance";
  // Match deepest prefix so /app/finance/accounts/anything still highlights Accounts.
  const active = TABS.reduce((acc, t) =>
    pathname === t.href || pathname.startsWith(t.href + "/")
      ? (t.href.length > acc.href.length ? t : acc)
      : acc,
    TABS[0],
  );

  // Settings page is presented as its own surface — it has its own header.
  if (pathname.startsWith("/app/finance/settings")) {
    return <>{children}</>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Landmark className="w-4 h-4" />
          </span>
          <div>
            <h1 className="text-base font-semibold leading-tight">Finance</h1>
            <p className="text-xs text-muted-foreground">Cash, revenue, expenses, tax — one cockpit.</p>
          </div>
        </div>
        <Link
          href="/app/finance/settings"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/50 px-2.5 py-1.5 text-xs font-medium hover:bg-card/80 transition-colors"
        >
          <SettingsIcon className="w-3.5 h-3.5" />
          Settings
        </Link>
      </div>

      <nav className="flex items-center gap-1 overflow-x-auto -mx-1 px-1 pb-1 border-b border-border/40">
        {TABS.map((t) => {
          const isActive = t.href === active.href;
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-card/60"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </Link>
          );
        })}
      </nav>

      <div>{children}</div>
    </div>
  );
}
