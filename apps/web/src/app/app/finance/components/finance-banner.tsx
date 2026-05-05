"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Landmark, X } from "lucide-react";

/**
 * FIN5 — Dismissible banner shown on legacy `/app/commerce` and
 * `/app/expenses` surfaces pointing users to the unified Finance cockpit.
 * Persists dismissal in localStorage so users only see it once per device.
 */
export function FinanceBanner({ from }: { from: "commerce" | "expenses" }) {
  // FIN5 — only show this banner on the *legacy* surface route. When the
  // legacy page module is composed inside the Finance shell at
  // /app/finance/revenue or /app/finance/expenses, suppress the banner
  // (we're already inside Finance — pointing users back to it would loop).
  const pathname = usePathname() ?? "";
  const onLegacyRoute = pathname === "/app/commerce" || pathname === "/app/expenses";

  const storageKey = `kf_finance_banner_dismissed_${from}`;
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(window.localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  if (!onLegacyRoute) return null;
  if (dismissed) return null;

  const dismiss = () => {
    window.localStorage.setItem(storageKey, "1");
    setDismissed(true);
  };

  const fromHref = from === "commerce" ? "/app/finance/revenue" : "/app/finance/expenses";

  return (
    <div className="mb-3 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">
      <Landmark className="w-4 h-4 mt-0.5 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">There&apos;s a unified Finance cockpit now.</p>
        <p className="text-xs text-muted-foreground">
          Cash, revenue, expenses, tax and reports together at <Link href={fromHref} className="text-primary hover:underline inline-flex items-center gap-0.5">/app/finance <ArrowRight className="w-3 h-3" /></Link>. This page still works.
        </p>
      </div>
      <button
        onClick={dismiss}
        className="text-muted-foreground hover:text-foreground p-0.5"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
