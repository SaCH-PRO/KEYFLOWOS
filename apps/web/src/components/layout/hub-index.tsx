"use client";

/**
 * NAV-A2 (D-150): a hub's own page, as an index of its entries (/app/money, /app/settings).
 *
 * Each entry opens its page. An entry is offered only when the member's modules open it, read the way the nav reads
 * them (useMemberModuleLevels, canOpenModule): unknown (no answer yet, a failed read) hides nothing, and the server
 * still refuses. When nothing is left, the page says why rather than showing an empty grid (journey J6's wording).
 */
import Link from "next/link";
import { ChevronRight, Lock, type LucideIcon } from "lucide-react";
import { useMemberModuleLevels } from "@/hooks/use-app-layout";
import { canOpenModule, type NavModule } from "@/lib/nav-config";

export interface HubIndexEntry {
  name: string;
  href: string;
  description: string;
  icon: LucideIcon;
  /** The module scope(s) the entry's page reads need; none: every member's. */
  module?: NavModule | NavModule[];
}

interface HubIndexProps {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  entries: HubIndexEntry[];
  /** Whether to draw the page's own heading (Settings' layout already draws one). */
  showHeading?: boolean;
}

export function HubIndex({ title, subtitle, icon: Icon, entries, showHeading = true }: HubIndexProps) {
  const levels = useMemberModuleLevels();
  const shown = entries.filter((e) => canOpenModule(levels, e.module));

  return (
    <div className="space-y-5">
      {showHeading && (
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white shadow-lg">
            <Icon className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <div role="status" className="kf-card p-6 flex items-start gap-3 text-sm text-muted-foreground">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>No access to {title} in this business. Ask the owner if you need it.</span>
        </div>
      ) : (
        <nav aria-label={title}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {shown.map((e) => {
              const EntryIcon = e.icon;
              return (
                <li key={e.href}>
                  <Link
                    href={e.href}
                    className="kf-card p-4 flex items-center gap-3 min-h-[64px] hover:border-primary/30 hover:bg-card transition-colors focus-ring"
                  >
                    <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <EntryIcon className="w-4 h-4 text-primary" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground" data-entry-name>{e.name}</p>
                      <p className="text-xs text-muted-foreground">{e.description}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
