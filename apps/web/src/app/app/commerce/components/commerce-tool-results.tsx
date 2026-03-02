"use client";

import {
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Minus,
  Lightbulb, Target, DollarSign, Clock, Mail,
  ChevronDown, ChevronUp, BarChart3, Shield, ArrowRight,
  MessageSquare, Package, Receipt,
} from "lucide-react";
import { useState } from "react";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-border/30 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
      >
        <span className="text-[11px] font-semibold text-foreground/80">{title}</span>
        {open ? <ChevronUp className="w-3 h-3 text-muted-foreground/50" /> : <ChevronDown className="w-3 h-3 text-muted-foreground/50" />}
      </button>
      {open && <div className="px-3 py-2.5">{children}</div>}
    </div>
  );
}

const HEALTH_COLORS: Record<string, string> = {
  excellent: "text-emerald-400",
  good: "text-green-400",
  fair: "text-amber-400",
  poor: "text-red-400",
  critical: "text-red-400",
};

const DIRECTION_ICONS: Record<string, typeof TrendingUp> = {
  up: TrendingUp,
  down: TrendingDown,
  stable: Minus,
};

const SEVERITY_COLORS: Record<string, string> = {
  high: "text-red-400",
  medium: "text-amber-400",
  low: "text-blue-400",
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "text-red-400",
  medium: "text-amber-400",
  low: "text-blue-400",
};

function RevenueAnalysisResult({ data }: { data: any }) {
  if (!data) return null;
  const healthColor = HEALTH_COLORS[data.healthLabel?.toLowerCase()] || "text-blue-400";
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3">
        <div className="relative w-14 h-14">
          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" className="text-white/5" strokeWidth="4" />
            <circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" className={healthColor} strokeWidth="4"
              strokeDasharray={`${((data.healthScore || 0) / 100) * 151} 151`} strokeLinecap="round" />
          </svg>
          <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${healthColor}`}>
            {data.healthScore}
          </span>
        </div>
        <div>
          <span className={`text-sm font-semibold ${healthColor}`}>{data.healthLabel}</span>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">Revenue Health Score</p>
        </div>
      </div>
      {data.summary && (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{data.summary}</p>
      )}
      {data.trends?.length > 0 && (
        <Section title="Trends">
          <div className="space-y-1.5">
            {data.trends.map((t: any, i: number) => {
              const Icon = DIRECTION_ICONS[t.direction] || Minus;
              const color = t.direction === "up" ? "text-emerald-400" : t.direction === "down" ? "text-red-400" : "text-blue-400";
              return (
                <div key={i} className="flex items-start gap-2">
                  <Icon className={`w-3 h-3 shrink-0 mt-0.5 ${color}`} />
                  <div>
                    <span className="text-[11px] font-medium text-foreground/80">{t.label}</span>
                    <p className="text-[10px] text-muted-foreground/60">{t.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
      {data.topClients?.length > 0 && (
        <Section title="Top Clients">
          <div className="space-y-1.5">
            {data.topClients.map((c: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-border/30">
                <div>
                  <span className="text-[11px] font-medium text-foreground/80">{c.name}</span>
                  <p className="text-[10px] text-muted-foreground/50">{c.invoiceCount} invoices</p>
                </div>
                <span className="text-[11px] font-medium text-emerald-400">${Number(c.revenue).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.recommendations?.length > 0 && (
        <Section title="Recommendations">
          <div className="space-y-1.5">
            {data.recommendations.map((r: any, i: number) => (
              <div key={i} className="flex items-start gap-1.5">
                <Lightbulb className={`w-3 h-3 shrink-0 mt-0.5 ${PRIORITY_COLORS[r.priority] || "text-amber-400"}`} />
                <div>
                  <span className="text-[11px] font-medium text-foreground/80">{r.title}</span>
                  <p className="text-[10px] text-muted-foreground/60">{r.description}</p>
                  {r.estimatedImpact && (
                    <span className="text-[10px] text-emerald-400">Impact: {r.estimatedImpact}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function CashFlowForecastResult({ data }: { data: any }) {
  if (!data) return null;
  const periods = [
    { key: "thirtyDay", label: "30 Days" },
    { key: "sixtyDay", label: "60 Days" },
    { key: "ninetyDay", label: "90 Days" },
  ];
  return (
    <div className="space-y-2.5">
      {data.summary && (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{data.summary}</p>
      )}
      <Section title="Forecast">
        <div className="space-y-2">
          {periods.map(({ key, label }) => {
            const f = data.forecast?.[key];
            if (!f) return null;
            return (
              <div key={key} className="p-2 rounded-lg border border-border/30 bg-white/[0.02]">
                <span className="text-[11px] font-medium text-foreground/80">{label}</span>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  <div>
                    <span className="text-[10px] text-muted-foreground/50">Conservative</span>
                    <p className="text-[11px] text-amber-400">${Number(f.conservative).toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground/50">Expected</span>
                    <p className="text-[11px] text-blue-400 font-medium">${Number(f.expected).toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground/50">Optimistic</span>
                    <p className="text-[11px] text-emerald-400">${Number(f.optimistic).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>
      {data.risks?.length > 0 && (
        <Section title="Risks">
          <div className="space-y-1.5">
            {data.risks.map((r: any, i: number) => (
              <div key={i} className="flex items-start gap-1.5">
                <AlertTriangle className={`w-3 h-3 shrink-0 mt-0.5 ${SEVERITY_COLORS[r.severity] || "text-amber-400"}`} />
                <div>
                  <span className="text-[11px] text-foreground/80">{r.description}</span>
                  <p className="text-[10px] text-muted-foreground/50">Mitigation: {r.mitigation}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.collectionPriority?.length > 0 && (
        <Section title={`Collection Priority (${data.collectionPriority.length})`}>
          <div className="space-y-1.5">
            {data.collectionPriority.slice(0, 8).map((cp: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-border/30">
                <div>
                  <span className="text-[11px] font-medium text-foreground/80">{cp.contactName}</span>
                  <p className="text-[10px] text-muted-foreground/50">{cp.invoiceRef} · {cp.daysPastDue}d overdue</p>
                </div>
                <div className="text-right">
                  <span className="text-[11px] font-medium text-red-400">${Number(cp.amount).toLocaleString()}</span>
                  <p className="text-[10px] text-muted-foreground/50">{cp.suggestedAction}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.opportunities?.length > 0 && (
        <Section title="Opportunities">
          <div className="space-y-1.5">
            {data.opportunities.map((o: any, i: number) => (
              <div key={i} className="flex items-start gap-1.5">
                <Target className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-[11px] text-foreground/80">{o.description}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-emerald-400">${Number(o.estimatedValue).toLocaleString()}</span>
                    <span className="text-[10px] text-muted-foreground/50">{o.timeframe}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function InvoiceReminderResult({ data }: { data: any }) {
  if (!data) return null;
  return (
    <div className="space-y-2.5">
      <div className="rounded-lg border border-border/30 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border-b border-border/20">
          <Mail className="w-3 h-3 text-blue-400" />
          <span className="text-[10px] font-medium text-foreground/70 capitalize">{data.tone} tone</span>
        </div>
        {data.subject && (
          <div className="px-3 py-1.5 border-b border-border/10">
            <span className="text-[10px] text-muted-foreground/50">Subject: </span>
            <span className="text-[11px] text-foreground/80">{data.subject}</span>
          </div>
        )}
        <div className="px-3 py-2">
          <p className="text-[11px] text-muted-foreground/70 whitespace-pre-wrap leading-relaxed">{data.message}</p>
        </div>
      </div>
      {data.suggestedFollowUpDate && (
        <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
          <Clock className="w-3 h-3" /> Follow up by: {data.suggestedFollowUpDate}
        </span>
      )}
      {data.alternativeMessages?.length > 0 && (
        <Section title="Alternative Tones">
          <div className="space-y-2">
            {data.alternativeMessages.map((alt: any, i: number) => (
              <div key={i} className="rounded-lg border border-border/30 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border-b border-border/20">
                  <MessageSquare className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
                  <span className="text-[10px] font-medium text-foreground/70 capitalize">{alt.tone}</span>
                </div>
                <div className="px-3 py-2">
                  <p className="text-[11px] text-muted-foreground/70 whitespace-pre-wrap leading-relaxed">{alt.message}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function PricingAdvisorResult({ data }: { data: any }) {
  if (!data) return null;
  const priceDiff = (data.suggestedPrice || 0) - (data.currentPrice || 0);
  const priceDirection = priceDiff > 0 ? "up" : priceDiff < 0 ? "down" : "stable";
  const priceColor = priceDirection === "up" ? "text-emerald-400" : priceDirection === "down" ? "text-red-400" : "text-blue-400";
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-xl bg-white/[0.02] border border-border/30">
          <span className="text-[10px] text-muted-foreground/50 block">Current</span>
          <span className="text-lg font-bold text-foreground/80">${data.currentPrice}</span>
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground/30" />
        <div className={`p-3 rounded-xl border ${priceDirection === "up" ? "bg-emerald-500/5 border-emerald-500/20" : priceDirection === "down" ? "bg-red-500/5 border-red-500/20" : "bg-blue-500/5 border-blue-500/20"}`}>
          <span className="text-[10px] text-muted-foreground/50 block">Suggested</span>
          <span className={`text-lg font-bold ${priceColor}`}>${data.suggestedPrice}</span>
        </div>
      </div>
      {data.priceRange && (
        <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-border/30">
          <span className="text-[10px] text-muted-foreground/50">Price Range: </span>
          <span className="text-[11px] text-foreground/80">${data.priceRange.min} — ${data.priceRange.max}</span>
        </div>
      )}
      {data.reasoning && (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{data.reasoning}</p>
      )}
      {data.competitivePosition && (
        <div className="px-3 py-2 rounded-lg bg-[hsl(var(--kf-accent1))]/5 border border-[hsl(var(--kf-accent1))]/20">
          <span className="text-[11px] text-[hsl(var(--kf-accent1))]">Position: {data.competitivePosition}</span>
        </div>
      )}
      {data.factors?.length > 0 && (
        <Section title="Price Factors">
          <div className="space-y-1.5">
            {data.factors.map((f: any, i: number) => (
              <div key={i} className="flex items-start gap-2">
                {f.impact === "positive" ? <TrendingUp className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" /> :
                 f.impact === "negative" ? <TrendingDown className="w-3 h-3 text-red-400 shrink-0 mt-0.5" /> :
                 <Minus className="w-3 h-3 text-muted-foreground/50 shrink-0 mt-0.5" />}
                <div>
                  <span className="text-[11px] font-medium text-foreground/80">{f.factor}</span>
                  <p className="text-[10px] text-muted-foreground/60">{f.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.strategies?.length > 0 && (
        <Section title="Pricing Strategies">
          <div className="space-y-1.5">
            {data.strategies.map((s: any, i: number) => (
              <div key={i} className="flex items-start gap-1.5">
                <Lightbulb className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-[11px] font-medium text-foreground/80">{s.name}</span>
                  <p className="text-[10px] text-muted-foreground/60">{s.description}</p>
                  {s.expectedImpact && (
                    <span className="text-[10px] text-emerald-400">Impact: {s.expectedImpact}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function PipelineAnalysisResult({ data }: { data: any }) {
  if (!data) return null;
  const convRate = Math.round((data.quoteConversionRate || 0) * 100);
  const convColor = convRate >= 50 ? "text-emerald-400" : convRate >= 25 ? "text-amber-400" : "text-red-400";
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <span className="text-[10px] text-muted-foreground/50 block">Conversion Rate</span>
          <span className={`text-lg font-bold ${convColor}`}>{convRate}%</span>
        </div>
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <span className="text-[10px] text-muted-foreground/50 block">Avg Invoice</span>
          <span className="text-lg font-bold text-foreground/80">${Number(data.averageInvoiceValue || 0).toLocaleString()}</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <Receipt className="w-3.5 h-3.5 text-blue-400 mx-auto mb-1" />
          <span className="text-[11px] font-bold text-foreground/80">{data.invoiceCount}</span>
          <span className="text-[10px] text-muted-foreground/50 block">Invoices</span>
        </div>
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <BarChart3 className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))] mx-auto mb-1" />
          <span className="text-[11px] font-bold text-foreground/80">{data.quoteCount}</span>
          <span className="text-[10px] text-muted-foreground/50 block">Quotes</span>
        </div>
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <DollarSign className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-1" />
          <span className="text-[11px] font-bold text-foreground/80">${Number(data.totalRevenue || 0).toLocaleString()}</span>
          <span className="text-[10px] text-muted-foreground/50 block">Revenue</span>
        </div>
      </div>
      {data.outstandingAmount > 0 && (
        <div className="px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
          <span className="text-xs text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            Outstanding: ${Number(data.outstandingAmount).toLocaleString()}
          </span>
        </div>
      )}
      {data.quoteStatusBreakdown && Object.keys(data.quoteStatusBreakdown).length > 0 && (
        <Section title="Quote Status">
          <div className="space-y-1">
            {Object.entries(data.quoteStatusBreakdown).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground/70 capitalize">{status.toLowerCase().replace("_", " ")}</span>
                <span className="text-[11px] font-medium text-foreground/80">{count as number}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.topProducts?.length > 0 && (
        <Section title="Top Products">
          <div className="space-y-1.5">
            {data.topProducts.slice(0, 5).map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-1.5 rounded-lg bg-white/[0.02]">
                <div className="flex items-center gap-1.5">
                  <Package className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
                  <span className="text-[11px] text-foreground/80">{p.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/50">{p.count} sold</span>
                  <span className="text-[11px] text-emerald-400">${Number(p.revenue).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.revenueByMonth?.length > 0 && (
        <Section title="Revenue Trend">
          <div className="space-y-1">
            {data.revenueByMonth.map((m: any, i: number) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground/70">{m.month}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/50">{m.invoiceCount} inv</span>
                  <span className="text-[11px] font-medium text-foreground/80">${Number(m.revenue).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function OverdueRecoveryResult({ data }: { data: any }) {
  if (!data) return null;
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div className="px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20">
          <span className="text-[10px] text-muted-foreground/50 block">Overdue</span>
          <span className="text-sm font-bold text-red-400">${Number(data.overdueAmount || 0).toLocaleString()}</span>
        </div>
        <div className="px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
          <span className="text-[10px] text-muted-foreground/50 block">Outstanding</span>
          <span className="text-sm font-bold text-amber-400">${Number(data.outstandingAmount || 0).toLocaleString()}</span>
        </div>
      </div>
      {data.overdueAmount === 0 && (
        <div className="px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <span className="text-[11px] text-emerald-400 flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5" /> No overdue invoices — your collections are up to date
          </span>
        </div>
      )}
      {data.collectionPriority?.length > 0 && (
        <Section title={`Collection Priority (${data.collectionPriority.length})`}>
          <div className="space-y-1.5">
            {data.collectionPriority.slice(0, 8).map((cp: any, i: number) => (
              <div key={i} className="p-2 rounded-lg border border-border/30 bg-white/[0.02]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground/80">{cp.contactName}</span>
                  <span className="text-[11px] font-medium text-red-400">${Number(cp.amount).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/50">{cp.invoiceRef}</span>
                  <span className="text-[10px] text-red-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {cp.daysPastDue}d overdue
                  </span>
                </div>
                <p className="text-[10px] text-[hsl(var(--kf-accent1))] mt-0.5">{cp.suggestedAction}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.risks?.length > 0 && (
        <Section title="Risks">
          <div className="space-y-1.5">
            {data.risks.map((r: any, i: number) => (
              <div key={i} className="flex items-start gap-1.5">
                <Shield className={`w-3 h-3 shrink-0 mt-0.5 ${SEVERITY_COLORS[r.severity] || "text-amber-400"}`} />
                <div>
                  <span className="text-[11px] text-foreground/80">{r.description}</span>
                  <p className="text-[10px] text-muted-foreground/50">{r.mitigation}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.opportunities?.length > 0 && (
        <Section title="Recovery Opportunities">
          <div className="space-y-1.5">
            {data.opportunities.map((o: any, i: number) => (
              <div key={i} className="flex items-start gap-1.5">
                <Target className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-[11px] text-foreground/80">{o.description}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-emerald-400">${Number(o.estimatedValue).toLocaleString()}</span>
                    <span className="text-[10px] text-muted-foreground/50">{o.timeframe}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

export function renderCommerceToolResult(toolId: string, result: unknown): React.ReactNode {
  switch (toolId) {
    case "revenue-analysis":
      return <RevenueAnalysisResult data={result} />;
    case "cashflow-forecast":
      return <CashFlowForecastResult data={result} />;
    case "invoice-reminder":
      return <InvoiceReminderResult data={result} />;
    case "pricing-advisor":
      return <PricingAdvisorResult data={result} />;
    case "pipeline-analysis":
      return <PipelineAnalysisResult data={result} />;
    case "overdue-recovery":
      return <OverdueRecoveryResult data={result} />;
    default:
      return (
        <pre className="text-[11px] text-muted-foreground/70 whitespace-pre-wrap overflow-auto max-h-64">
          {JSON.stringify(result, null, 2)}
        </pre>
      );
  }
}
