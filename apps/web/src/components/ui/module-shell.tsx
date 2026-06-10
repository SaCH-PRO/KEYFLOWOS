"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface ModuleTab {
  label: string;
  href: string;
  icon?: LucideIcon;
}

interface ModuleShellProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  tabs?: ModuleTab[];
  children?: React.ReactNode;
}

export function ModuleShell({ icon: Icon, title, subtitle, tabs, children }: ModuleShellProps) {
  const pathname = usePathname();

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/10 border border-[hsl(var(--kf-accent1))]/20 flex items-center justify-center flex-shrink-0 shadow-sm">
          <Icon className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>

      {tabs && tabs.length > 0 && (
        <div className="border-b border-border/60">
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {tabs.map((tab) => {
              const TabIcon = tab.icon;
              const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                    isActive
                      ? "border-[hsl(var(--kf-accent1))] text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  )}
                >
                  {TabIcon && <TabIcon className="w-3.5 h-3.5" />}
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}

      <div className="min-h-[300px]">
        {children ?? (
          <div className="rounded-2xl border border-border/40 bg-slate-950/40 backdrop-blur-sm flex flex-col items-center justify-center h-[320px] p-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/10 to-[hsl(var(--kf-accent2))]/5 border border-[hsl(var(--kf-accent1))]/10 flex items-center justify-center mb-4">
              <Icon className="w-7 h-7 text-[hsl(var(--kf-accent1))]/60" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
            <p className="text-xs text-muted-foreground max-w-xs">
              This module is being prepared. Check back soon for {title.toLowerCase()} tools and insights.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
