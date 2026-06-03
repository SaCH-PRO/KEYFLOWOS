"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { OriginAwareBreadcrumbs } from "@/components/ui/origin-aware-breadcrumbs";
import { cn } from "@/lib/utils";

export interface TabDef {
  label: string;
  href: string;
  icon?: LucideIcon;
}

export interface UnifiedPageShellProps {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  maxWidth?: "4xl" | "5xl" | "6xl" | "full";
  headerActions?: React.ReactNode;
  tabs?: TabDef[];
  showBreadcrumbs?: boolean;
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
}

const MAX_WIDTH_MAP = {
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
  full: "max-w-none",
};

export function UnifiedPageShell({
  title,
  subtitle,
  icon,
  maxWidth = "5xl",
  headerActions,
  tabs,
  showBreadcrumbs = true,
  children,
  className,
  innerClassName,
}: UnifiedPageShellProps) {
  const pathname = usePathname();
  const widthClass = MAX_WIDTH_MAP[maxWidth];

  return (
    <div className={cn("min-h-[calc(100vh-4rem)]", className)}>
      <div className={cn("mx-auto px-4 py-6", widthClass, innerClassName)}>
        {showBreadcrumbs && (
          <div className="mb-4">
            <OriginAwareBreadcrumbs />
          </div>
        )}

        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          <PageHeader
            icon={icon}
            title={title}
            subtitle={subtitle}
            rightSlot={headerActions}
          />
        </motion.div>

        {tabs && tabs.length > 0 && (
          <div className="mt-4 mb-6">
            <div className="flex gap-1 p-1 rounded-xl bg-muted/30 border border-border/40 overflow-x-auto scrollbar-none">
              {tabs.map((tab) => {
                const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
                const TabIcon = tab.icon;
                return (
                  <a
                    key={tab.href}
                    href={tab.href}
                    className={cn(
                      "relative flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-all duration-200 shrink-0",
                      isActive
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground/80"
                    )}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="unified-shell-tab-bg"
                        className="absolute inset-0 rounded-lg bg-background border border-border/60 shadow-sm"
                        transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                      />
                    )}
                    <span className="relative flex items-center gap-1.5">
                      {TabIcon && <TabIcon className="w-3.5 h-3.5" />}
                      {tab.label}
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05, ease: "easeOut" }}
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}
