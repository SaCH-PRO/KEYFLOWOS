"use client";

import Link from "next/link";
import {
  CheckCircle2,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Award,
  Mail,
} from "lucide-react";
import type { AiBriefing, FinancialPulse, CampaignBriefing } from "./types";
import { formatCurrency, formatTTD } from "./types";

export function BriefingSummary({ briefing }: { briefing: AiBriefing }) {
  return (
    <div className="space-y-3">
      <p className="kf-text-caption text-muted-foreground leading-relaxed">{briefing.summary}</p>
      {briefing.highlights.length > 0 && (
        <div className="space-y-1">
          {briefing.highlights.map((h, i) => (
            <div key={i} className="flex items-start gap-1.5 kf-text-caption">
              <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
              <span className="text-muted-foreground">{h}</span>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        <CashFlowCell label="Revenue" value={formatCurrency(briefing.cashFlow.revenue)} color="hsl(var(--kf-success))" />
        <CashFlowCell label="Expenses" value={formatCurrency(briefing.cashFlow.expenses)} color="hsl(var(--kf-error))" />
        <CashFlowCell
          label="Net"
          value={formatCurrency(briefing.cashFlow.net)}
          color={briefing.cashFlow.net >= 0 ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))"}
        />
      </div>
      {briefing.suggestion && (
        <div
          className="p-2.5 kf-radius-sm"
          style={{ backgroundColor: "hsl(var(--kf-accent1) / 0.08)", border: "1px solid hsl(var(--kf-accent1) / 0.15)" }}
        >
          <div className="flex items-start gap-1.5">
            <Sparkles className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
            <p className="text-[11px] leading-relaxed text-muted-foreground">{briefing.suggestion}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function FinancialPulseSection({ pulse }: { pulse: FinancialPulse }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 mb-1">
        <TrendingUp className="w-3 h-3" style={{ color: "hsl(var(--kf-accent2))" }} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Financial Pulse</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <CashFlowCell label="Receivable" value={formatTTD(pulse.outstandingReceivables)} />
        <CashFlowCell label="Revenue" value={formatTTD(pulse.monthlyRevenue)} color="hsl(var(--kf-success))" />
        <CashFlowCell label="Overdue" value={formatTTD(pulse.overdueReceivables)} color="hsl(var(--kf-error))" />
      </div>
      {pulse.overdueCount > 0 && (
        <div className="p-2 kf-radius-sm" style={{ background: "hsl(var(--kf-error) / 0.05)", border: "1px solid hsl(var(--kf-error) / 0.1)" }}>
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(var(--kf-error))" }} />
            <p className="text-[10px]" style={{ color: "hsl(var(--kf-error))" }}>
              {pulse.overdueCount} overdue invoice{pulse.overdueCount > 1 ? "s" : ""} — {formatTTD(pulse.overdueReceivables)}
            </p>
          </div>
        </div>
      )}
      {pulse.alerts
        .filter((a) => a.type === "milestone")
        .slice(0, 1)
        .map((alert) => (
          <div key={alert.id} className="p-2 kf-radius-sm" style={{ background: "hsl(var(--kf-success) / 0.05)", border: "1px solid hsl(var(--kf-success) / 0.1)" }}>
            <div className="flex items-start gap-1.5">
              <Award className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
              <p className="text-[10px] leading-relaxed" style={{ color: "hsl(var(--kf-success))" }}>{alert.message}</p>
            </div>
          </div>
        ))}
    </div>
  );
}

export function CampaignIntelSection({ briefings }: { briefings: CampaignBriefing[] }) {
  if (briefings.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Mail className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Campaign Intelligence</span>
        </div>
        <Link href="/app/marketing?tab=insights" className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">View All →</Link>
      </div>
      {briefings.slice(0, 2).map((cb) => (
        <CampaignRow key={cb.id} briefing={cb} />
      ))}
    </div>
  );
}

function CampaignRow({ briefing: cb }: { briefing: CampaignBriefing }) {
  return (
    <div className="bg-muted/20 kf-radius-sm p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold truncate max-w-[70%]">{cb.campaign?.name ?? "Campaign"}</p>
        <span className="text-[9px] text-muted-foreground">{new Date(cb.createdAt).toLocaleDateString()}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <CashFlowCell label="Open" value={`${(cb.openRate ?? 0).toFixed(1)}%`} nested />
        <CashFlowCell label="Click" value={`${(cb.clickRate ?? 0).toFixed(1)}%`} nested />
        <CashFlowCell label="Delivery" value={`${(cb.deliveryRate ?? 0).toFixed(1)}%`} nested />
      </div>
      {cb.aiBriefing && (
        <div className="p-2 kf-radius-sm" style={{ backgroundColor: "hsl(var(--kf-accent1) / 0.08)", border: "1px solid hsl(var(--kf-accent1) / 0.15)" }}>
          <div className="flex items-start gap-1.5">
            <Sparkles className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
            <p className="text-[10px] leading-relaxed text-muted-foreground line-clamp-2">{cb.aiBriefing}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function CashFlowCell({ label, value, color, nested }: { label: string; value: string; color?: string; nested?: boolean }) {
  return (
    <div className={nested ? "bg-muted/30 kf-radius-sm p-1.5 text-center" : "bg-muted/20 kf-radius-sm p-2 text-center"}>
      <p className="text-[9px] text-muted-foreground uppercase">{label}</p>
      <p className="text-xs font-semibold" style={color ? { color } : undefined}>{value}</p>
    </div>
  );
}
