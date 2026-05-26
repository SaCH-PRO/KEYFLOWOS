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
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>

      {tabs && tabs.length > 0 && (
        <div className="border-b border-border">
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
          <div className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
            <Icon className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">{title} content coming soon.</p>
          </div>
        )}
      </div>
    </div>
  );
}
