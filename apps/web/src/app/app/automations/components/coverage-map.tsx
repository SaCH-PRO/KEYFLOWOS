"use client";

import { Shield, CheckCircle, AlertTriangle, Users, CreditCard, CalendarDays, Megaphone, UserCog, Timer } from "lucide-react";
import { COVERAGE_MODULES } from "./automation-constants";

interface CoverageMapProps {
  activeTriggers: Set<string>;
}

const MODULE_ICONS: Record<string, typeof Users> = {
  clients: Users,
  revenue: CreditCard,
  bookings: CalendarDays,
  content: Megaphone,
  staff: UserCog,
  scheduled: Timer,
};

export function CoverageMap({ activeTriggers }: CoverageMapProps) {
  const coverageData = COVERAGE_MODULES.map((mod) => {
    const covered = mod.triggers.filter((t) => activeTriggers.has(t)).length;
    const total = mod.triggers.length;
    const pct = total > 0 ? Math.round((covered / total) * 100) : 0;
    let status: "full" | "partial" | "none" = "none";
    if (pct >= 75) status = "full";
    else if (pct > 0) status = "partial";
    return { ...mod, covered, total, pct, status };
  });

  const overallCoverage = Math.round(
    coverageData.reduce((acc, m) => acc + m.pct, 0) / coverageData.length
  );

  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: "hsl(var(--kf-info) / 0.15)" }}>
            <Shield className="w-3 h-3" style={{ color: "hsl(var(--kf-info))" }} />
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Trigger Coverage by Module</span>
        </div>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-md"
          style={{
            background: overallCoverage >= 50 ? "hsl(var(--kf-success) / 0.1)" : "hsl(var(--kf-warning) / 0.1)",
            color: overallCoverage >= 50 ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))",
          }}
        >
          {overallCoverage}% overall
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {coverageData.map((mod) => {
          const Icon = MODULE_ICONS[mod.key] ?? Shield;
          const statusColor =
            mod.status === "full"
              ? "hsl(var(--kf-success))"
              : mod.status === "partial"
                ? "hsl(var(--kf-warning))"
                : "hsl(var(--muted-foreground))";
          const statusBg =
            mod.status === "full"
              ? "hsl(var(--kf-success) / 0.08)"
              : mod.status === "partial"
                ? "hsl(var(--kf-warning) / 0.08)"
                : "hsl(var(--muted) / 0.2)";
          const statusLabel =
            mod.status === "full"
              ? "Covered"
              : mod.status === "partial"
                ? "Partial"
                : "No coverage";

          return (
            <div
              key={mod.key}
              className="rounded-lg px-3 py-2.5"
              style={{ background: statusBg, border: `1px solid ${statusColor}20` }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <Icon className="w-3.5 h-3.5" style={{ color: statusColor }} />
                <span className="text-xs font-medium truncate">{mod.label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {mod.status === "full" ? (
                  <CheckCircle className="w-3 h-3" style={{ color: statusColor }} />
                ) : (
                  <AlertTriangle className="w-3 h-3" style={{ color: statusColor }} />
                )}
                <span className="text-[10px]" style={{ color: statusColor }}>
                  {statusLabel}
                </span>
                <span className="text-[10px] text-muted-foreground ml-auto">{mod.covered}/{mod.total}</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted) / 0.3)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${mod.pct}%`, background: statusColor }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
