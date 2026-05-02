"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  ShieldAlert,
  Banknote,
  UserX,
  Clock,
  CalendarOff,
  Store,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import type { ControlTowerRiskAlert } from "@/lib/client";

const DOMAIN_CONFIG: Record<string, { icon: typeof ShieldAlert; label: string }> = {
  cash_flow: { icon: Banknote, label: "Cash Flow" },
  churn: { icon: UserX, label: "Churn Risk" },
  overdue: { icon: Clock, label: "Overdue" },
  capacity: { icon: CalendarOff, label: "Capacity" },
  storefront: { icon: Store, label: "Storefront" },
  delivery: { icon: AlertTriangle, label: "Delivery" },
};

const SEVERITY_COLORS: Record<string, { color: string; bg: string }> = {
  critical: { color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.08)" },
  warning: { color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.08)" },
  info: { color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.08)" },
};

export function RiskAlerts({ risks }: { risks: ControlTowerRiskAlert[] }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const sorted = [...risks].sort((a, b) => {
    const sev = { critical: 3, warning: 2, info: 1 };
    return (sev[b.severity] ?? 0) - (sev[a.severity] ?? 0);
  });

  const visible = expanded ? sorted : sorted.slice(0, 4);
  const hasMore = sorted.length > 4;
  const criticalCount = sorted.filter((r) => r.severity === "critical").length;
  const warningCount = sorted.filter((r) => r.severity === "warning").length;

  if (risks.length === 0) {
    return (
      <SectionCard title="Risk Alerts" subtitle="Threats & vulnerabilities" icon={ShieldAlert}>
        <div className="text-center py-6">
          <p className="text-sm font-medium" style={{ color: "hsl(var(--kf-success))" }}>No active risks</p>
          <p className="text-xs mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            All domains are healthy
          </p>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Risk Alerts"
      subtitle={
        [
          criticalCount > 0 ? `${criticalCount} critical` : null,
          warningCount > 0 ? `${warningCount} warning` : null,
        ].filter(Boolean).join(" · ") || `${risks.length} alert${risks.length > 1 ? "s" : ""}`
      }
      icon={ShieldAlert}
    >
      <div className="space-y-1.5">
        <AnimatePresence initial={false}>
          {visible.map((risk, i) => {
            const domainCfg = DOMAIN_CONFIG[risk.domain] ?? DOMAIN_CONFIG.overdue;
            const sevColors = SEVERITY_COLORS[risk.severity] ?? SEVERITY_COLORS.warning;
            const Icon = domainCfg.icon;

            return (
              <motion.div
                key={risk.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all group cursor-pointer hover:scale-[1.005]"
                style={{ background: sevColors.bg, border: `1px solid ${sevColors.color}15` }}
                onClick={() => risk.actionRoute && router.push(risk.actionRoute)}
                role={risk.actionRoute ? "link" : undefined}
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: `${sevColors.color}15` }}
                >
                  <Icon className="w-3.5 h-3.5" style={{ color: sevColors.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: "hsl(var(--kf-foreground))" }}>
                    {risk.title}
                  </p>
                  <p className="text-[10px] truncate" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                    {risk.description}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
                    style={{ background: `${sevColors.color}15`, color: sevColors.color }}
                  >
                    {domainCfg.label}
                  </span>
                  <div className="w-2 h-2 rounded-full" style={{ background: sevColors.color }} />
                  {risk.actionRoute && (
                    <ArrowRight
                      className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity"
                      style={{ color: "hsl(var(--kf-muted-foreground))" }}
                    />
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      {hasMore && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-center gap-1.5 mt-2 py-2 text-[10px] font-medium transition-colors hover:opacity-70 min-h-[36px]"
          style={{ color: "hsl(var(--kf-accent1))" }}
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? "Show less" : `Show ${sorted.length - 4} more`}
        </button>
      )}
    </SectionCard>
  );
}
