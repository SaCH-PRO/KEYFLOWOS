"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Landmark,
  TrendingUp,
  Receipt,
  BookOpen,
  BarChart3,
} from "lucide-react";

/**
 * Money Directory — Unified hub for Money, Finance, and Revenue Intelligence.
 * Every tab links to a real surface. No redirects, no dead ends.
 */
const MONEY_TABS = [
  { href: "/app/money", label: "Overview", icon: Landmark },
  { href: "/app/commerce", label: "Revenue", icon: TrendingUp },
  { href: "/app/expenses", label: "Expenses", icon: Receipt },
  { href: "/app/finance", label: "Books", icon: BookOpen },
  { href: "/app/reports", label: "Reports", icon: BarChart3 },
];

export default function MoneyLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/app/money";

  const active = MONEY_TABS.reduce((acc, t) =>
    pathname === t.href || pathname.startsWith(t.href + "/")
      ? (t.href.length > acc.href.length ? t : acc)
      : acc,
    MONEY_TABS[0],
  );

  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-1 overflow-x-auto -mx-2 px-2 pb-1 border-b border-border/40">
        {MONEY_TABS.map((t) => {
          const isActive = t.href === active.href;
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? "bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
                  : "text-muted-foreground hover:text-foreground hover:bg-card"
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
