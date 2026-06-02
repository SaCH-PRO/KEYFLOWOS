"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { WorkspaceShell, type WorkspaceTab } from "./workspace-shell";
import { SectionCard } from "./section-card";
import { OriginAwareBreadcrumbs } from "./origin-aware-breadcrumbs";
import { getWorkspaceRelatedActions, type WorkspaceId } from "@/lib/semantic-routes";
import type { LucideIcon } from "lucide-react";

/* ────────────────────────────────────────────────────────────────
 * StandardModuleLayout
 *
 * Enforces a consistent page structure across all KEYFLOWOS modules.
 *
 * Layout grammar:
 *   [Breadcrumbs] → [PageHeader] → [MetricStrip (optional)]
 *   → [Banners (optional)] → [TabNav (optional)] → [Content]
 *
 * Each module page should use this instead of inventing its own
 * page structure. WorkspaceShell is used internally.
 * ──────────────────────────────────────────────────────────────── */

export interface StandardModuleLayoutProps {
  /** Workspace this page belongs to */
  workspace: WorkspaceId;
  /** Module icon */
  icon: LucideIcon;
  /** Page title */
  title: string;
  /** Optional subtitle / description */
  subtitle?: React.ReactNode;
  /** Accent color for icon */
  iconColor?: string;

  /** Tabs (uses WorkspaceShell tab infrastructure) */
  tabs?: WorkspaceTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;

  /** Primary action button */
  actionLabel?: string;
  actionIcon?: LucideIcon;
  onAction?: () => void;

  /** Extra header content (search, filters, etc.) */
  headerRight?: React.ReactNode;

  /** Metric strip below header ( KPIs, summary stats) */
  metricStrip?: React.ReactNode;

  /** Banner alerts / info cards */
  banners?: React.ReactNode;

  /** Enable swipe between tabs on mobile */
  enableSwipe?: boolean;

  /** Show breadcrumbs */
  showBreadcrumbs?: boolean;

  className?: string;
  children: React.ReactNode;
}

export function StandardModuleLayout({
  workspace,
  icon,
  title,
  subtitle,
  iconColor,
  tabs,
  activeTab,
  onTabChange,
  actionLabel,
  actionIcon,
  onAction,
  headerRight,
  metricStrip,
  banners,
  enableSwipe,
  showBreadcrumbs = true,
  className = "",
  children,
}: StandardModuleLayoutProps) {
  const relatedActions = useMemo(() => getWorkspaceRelatedActions(workspace), [workspace]);

  const hasQuickActions = relatedActions.length > 0;

  return (
    <div className={`space-y-0 ${className}`}>
      {showBreadcrumbs && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mb-2"
        >
          <OriginAwareBreadcrumbs />
        </motion.div>
      )}

      <WorkspaceShell
        icon={icon}
        title={title}
        subtitle={subtitle}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={onTabChange}
        actionLabel={actionLabel}
        actionIcon={actionIcon}
        onAction={onAction}
        headerRight={headerRight}
        metricStrip={metricStrip}
        banners={banners}
        enableSwipe={enableSwipe}
        iconColor={iconColor}
      >
        {children}
      </WorkspaceShell>

      {hasQuickActions && (
        <div className="mt-6 pt-4 border-t" style={{ borderColor: "hsl(var(--kf-border) / 0.5)" }}>
          <p className="kf-text-micro font-medium mb-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            Quick Actions
          </p>
          <div className="flex flex-wrap gap-2">
            {relatedActions.map((a) => (
              <a
                key={a.href}
                href={a.href}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium
                  bg-muted hover:bg-muted/80 transition-colors"
                style={{ color: "hsl(var(--kf-foreground))" }}
              >
                {a.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
 * ModulePageSection
 *
 * A standardized section card for use within StandardModuleLayout.
 * Use this instead of raw <div> or ad-hoc card implementations.
 * ──────────────────────────────────────────────────────────────── */

export interface ModulePageSectionProps {
  title?: string;
  subtitle?: string;
  icon?: LucideIcon;
  action?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
  };
  headerRight?: React.ReactNode;
  noPadding?: boolean;
  compact?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function ModulePageSection({
  title,
  subtitle,
  icon,
  action,
  headerRight,
  noPadding,
  compact,
  className,
  children,
}: ModulePageSectionProps) {
  return (
    <SectionCard
      title={title}
      subtitle={subtitle}
      icon={icon}
      action={action}
      headerRight={headerRight}
      noPadding={noPadding}
      compact={compact}
      className={className}
    >
      {children}
    </SectionCard>
  );
}

/* ────────────────────────────────────────────────────────────────
 * ModuleMetricStrip
 *
 * A horizontal strip of metric cards for the top of a module page.
 * ──────────────────────────────────────────────────────────────── */

export interface MetricItem {
  label: string;
  value: string | number;
  change?: string;
  trend?: "up" | "down" | "neutral";
}

export function ModuleMetricStrip({ metrics }: { metrics: MetricItem[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {metrics.map((m, i) => (
        <motion.div
          key={m.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05, duration: 0.2 }}
          className="kf-card kf-radius-md p-3"
        >
          <p className="kf-text-micro truncate" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            {m.label}
          </p>
          <p className="text-lg font-semibold mt-0.5">{m.value}</p>
          {m.change && (
            <p
              className={`kf-text-micro mt-0.5 ${
                m.trend === "up"
                  ? "text-green-500"
                  : m.trend === "down"
                    ? "text-red-500"
                    : ""
              }`}
            >
              {m.change}
            </p>
          )}
        </motion.div>
      ))}
    </div>
  );
}
