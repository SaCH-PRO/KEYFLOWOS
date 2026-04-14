"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Users, CreditCard, Calendar, Receipt, FolderKanban, Megaphone, Zap, Store,
} from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import type { ControlTowerModules, StrategicDashboard } from "@/lib/client";

type ModuleCard = {
  key: string;
  label: string;
  icon: React.ElementType;
  href: string;
  primary: string;
  secondary: string;
  status: "good" | "warn" | "critical";
};

function buildCards(modules: ControlTowerModules, dashboard: StrategicDashboard): ModuleCard[] {
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const fmtD = (n: number) => `$${n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0)}`;

  return [
    {
      key: "clients",
      label: "Clients",
      icon: Users,
      href: "/app/crm/pipeline",
      primary: `${fmt(modules.contacts.total)} contacts`,
      secondary: modules.contacts.staleLeadCount > 0 ? `${modules.contacts.staleLeadCount} stale leads` : `${modules.contacts.recentCount} new this week`,
      status: modules.contacts.staleLeadCount > 10 ? "critical" : modules.contacts.staleLeadCount > 0 ? "warn" : "good",
    },
    {
      key: "revenue",
      label: "Revenue",
      icon: CreditCard,
      href: "/app/commerce",
      primary: `${fmtD(modules.revenue.monthlyRevenue)} this month`,
      secondary: dashboard.overdueInvoices > 0 ? `${dashboard.overdueInvoices} overdue` : `${fmtD(modules.revenue.outstandingAmount)} outstanding`,
      status: dashboard.overdueInvoices > 3 ? "critical" : dashboard.overdueInvoices > 0 ? "warn" : "good",
    },
    {
      key: "calendar",
      label: "Calendar",
      icon: Calendar,
      href: "/app/bookings",
      primary: `${modules.bookings.upcomingCount} upcoming`,
      secondary: `${modules.bookings.utilizationRate.toFixed(0)}% utilization`,
      status: modules.bookings.utilizationRate < 30 ? "warn" : "good",
    },
    {
      key: "expenses",
      label: "Expenses",
      icon: Receipt,
      href: "/app/expenses",
      primary: `${fmtD(modules.expenses.totalThisMonth)} this month`,
      secondary: modules.expenses.budgetUtilization > 0 ? `${modules.expenses.budgetUtilization.toFixed(0)}% of budget` : "No budgets set",
      status: modules.expenses.budgetUtilization > 100 ? "critical" : modules.expenses.budgetUtilization > 90 ? "warn" : "good",
    },
    {
      key: "projects",
      label: "Projects",
      icon: FolderKanban,
      href: "/app/projects",
      primary: `${modules.projects.activeCount} active`,
      secondary: modules.projects.overdueTaskCount > 0 ? `${modules.projects.overdueTaskCount} overdue tasks` : `${modules.projects.completionRate.toFixed(0)}% complete`,
      status: modules.projects.overdueTaskCount > 5 ? "critical" : modules.projects.overdueTaskCount > 0 ? "warn" : "good",
    },
    {
      key: "content",
      label: "Content",
      icon: Megaphone,
      href: "/app/marketing",
      primary: `${modules.content.scheduledPostCount} scheduled`,
      secondary: `${modules.content.draftPostCount} drafts, ${modules.content.draftCampaignCount} campaigns`,
      status: "good",
    },
    {
      key: "automations",
      label: "Flows",
      icon: Zap,
      href: "/app/automations",
      primary: `${modules.automations.activeCount} active`,
      secondary: `${fmt(modules.automations.totalRuns)} total runs`,
      status: modules.automations.activeCount === 0 ? "warn" : "good",
    },
    {
      key: "store",
      label: "Storefront",
      icon: Store,
      href: "/app/store",
      primary: `${modules.storefront.activeProductCount} products`,
      secondary: modules.storefront.averagePrice > 0 ? `Avg ${fmtD(modules.storefront.averagePrice)}` : "No pricing",
      status: modules.storefront.activeProductCount === 0 ? "warn" : "good",
    },
  ];
}

const STATUS_COLORS = {
  good: "hsl(var(--kf-success))",
  warn: "hsl(var(--kf-warning))",
  critical: "hsl(var(--kf-error))",
};

export function ModuleHealthGrid({
  modules,
  dashboard,
}: {
  modules: ControlTowerModules;
  dashboard: StrategicDashboard;
}) {
  const router = useRouter();
  const cards = buildCards(modules, dashboard);

  return (
    <SectionCard title="Module Status" subtitle="Health across all workspaces" icon={Store}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {cards.map((card, i) => {
          const Icon = card.icon;
          const dotColor = STATUS_COLORS[card.status];
          return (
            <motion.button
              key={card.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => router.push(card.href)}
              className="text-left rounded-xl p-3 transition-all hover:scale-[1.02] min-h-[44px]"
              style={{
                background: "hsl(var(--kf-muted) / 0.06)",
                border: "1px solid hsl(var(--kf-border) / 0.25)",
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: "hsl(var(--kf-accent1) / 0.08)" }}
                >
                  <Icon className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <div className="w-2 h-2 rounded-full" style={{ background: dotColor }} />
              </div>
              <p className="text-[11px] font-semibold truncate" style={{ color: "hsl(var(--kf-foreground))" }}>
                {card.label}
              </p>
              <p className="text-[10px] font-medium truncate" style={{ color: "hsl(var(--kf-foreground) / 0.8)" }}>
                {card.primary}
              </p>
              <p className="text-[9px] truncate mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                {card.secondary}
              </p>
            </motion.button>
          );
        })}
      </div>
    </SectionCard>
  );
}
