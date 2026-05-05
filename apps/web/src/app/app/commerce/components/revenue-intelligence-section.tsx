"use client";

import React, { useEffect, useState } from "react";
import {
  Sparkles, RefreshCw, TrendingUp, AlertTriangle, Target, Calendar, ArrowRight,
  Loader2, CheckCircle2, Tag, Users, Package,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip as RTooltip } from "recharts";
import { toast } from "sonner";
import {
  fetchRevenueBriefing,
  regenerateRevenueBriefing,
  delegateRevenueBriefingChase,
  type RevenueBriefingSnapshot,
  type RevenueBriefingChase,
  type PricingSignal,
  type SlowPayerEntry,
} from "@/lib/client";
import { formatCurrencyCompact } from "@/lib/currency";

interface Props {
  businessId: string | null;
  currency: string;
}

const SIGNAL_LABELS: Record<PricingSignal["signal"], { label: string; tone: string }> = {
  high_margin_promote: { label: "Promote", tone: "text-emerald-300 bg-emerald-500/15 border-emerald-500/25" },
  underpriced: { label: "Underpriced", tone: "text-amber-300 bg-amber-500/15 border-amber-500/25" },
  underperforming_high_margin: { label: "Hidden gem", tone: "text-blue-300 bg-blue-500/15 border-blue-500/25" },
};

const SEVERITY_TONE: Record<SlowPayerEntry["severity"], string> = {
  severe: "text-red-300 bg-red-500/15 border-red-500/25",
  moderate: "text-amber-300 bg-amber-500/15 border-amber-500/25",
  mild: "text-yellow-300 bg-yellow-500/15 border-yellow-500/25",
};

export function RevenueIntelligenceSection({ businessId, currency }: Props) {
  const [snapshot, setSnapshot] = useState<RevenueBriefingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [delegating, setDelegating] = useState<Record<string, boolean>>({});
  const [delegated, setDelegated] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    fetchRevenueBriefing(businessId).then((res) => {
      if (cancelled) return;
      if (res.data) setSnapshot(res.data);
      else if (res.error) toast.error(res.error);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [businessId]);

  const handleRegenerate = async () => {
    if (!businessId) return;
    setRegenerating(true);
    const res = await regenerateRevenueBriefing(businessId);
    if (res.data) {
      setSnapshot(res.data);
      setDelegated({});
      toast.success("Briefing refreshed");
    } else if (res.error) {
      toast.error(res.error);
    }
    setRegenerating(false);
  };

  const handleDelegate = async (chase: RevenueBriefingChase) => {
    if (!businessId) return;
    setDelegating((d) => ({ ...d, [chase.id]: true }));
    const res = await delegateRevenueBriefingChase(businessId, chase);
    if (res.data?.created || res.data?.actionId) {
      setDelegated((d) => ({ ...d, [chase.id]: true }));
      toast.success(res.data?.created ? "Action queued" : "Already in your action queue");
    } else if (res.error) {
      toast.error(res.error);
    }
    setDelegating((d) => ({ ...d, [chase.id]: false }));
  };

  if (!businessId) return null;
  if (loading && !snapshot) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-4 animate-pulse">
        <div className="h-4 w-40 bg-muted/30 rounded mb-3" />
        <div className="h-32 w-full bg-muted/20 rounded" />
      </div>
    );
  }
  if (!snapshot) return null;

  const { briefing, forecast, slowPayers, pricingSignals } = snapshot;
  const fmt = (n: number) => formatCurrencyCompact(n, currency);

  return (
    <div className="space-y-3">
      {/* === Forecast curve === */}
      <div className="rounded-xl border border-border/50 bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-foreground/85">30-day cash forecast</h3>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border ${
              forecast.confidence === "high" ? "text-emerald-300 bg-emerald-500/15 border-emerald-500/25" :
              forecast.confidence === "medium" ? "text-amber-300 bg-amber-500/15 border-amber-500/25" :
              "text-muted-foreground bg-muted/20 border-border/40"
            }`}>{forecast.confidence} confidence</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Updated {new Date(snapshot.generatedAt).toLocaleString()}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <Stat label="Expected" value={fmt(forecast.totalExpected)} accent="text-emerald-300" />
          <Stat label="Best case" value={fmt(forecast.totalBest)} accent="text-emerald-200" />
          <Stat label="Worst case" value={fmt(forecast.totalWorst)} accent="text-amber-300" />
        </div>
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={forecast.buckets} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="rfBest" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--kf-accent1))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(var(--kf-accent1))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="rfExp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => v.slice(5)} />
              <YAxis hide />
              <RTooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
                formatter={(v) => fmt(typeof v === "number" ? v : Number(v) || 0)}
              />
              <Area type="monotone" dataKey="best" stroke="hsl(var(--kf-accent1))" strokeWidth={1} fill="url(#rfBest)" />
              <Area type="monotone" dataKey="expected" stroke="#10b981" strokeWidth={2} fill="url(#rfExp)" />
              <Area type="monotone" dataKey="worst" stroke="#f59e0b" strokeWidth={1} fill="none" strokeDasharray="3 3" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
          <span><span className="inline-block w-2 h-2 bg-emerald-400 rounded-full mr-1" />Expected</span>
          <span><span className="inline-block w-2 h-2 bg-[hsl(var(--kf-accent1))] rounded-full mr-1" />Best</span>
          <span><span className="inline-block w-2 h-2 bg-amber-400 rounded-full mr-1" />Worst</span>
          <span className="ml-auto">{forecast.inputs.openInvoices} open invoices · {forecast.inputs.acceptedQuotes} accepted quotes · {forecast.inputs.activeRecurring} recurring</span>
        </div>
      </div>

      {/* === Intelligence strip === */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-foreground/85">Slow payers</h3>
            <span className="text-[10px] text-muted-foreground ml-auto">
              Median {slowPayers.businessMedianDays}d · threshold {slowPayers.threshold}d
            </span>
          </div>
          {slowPayers.slowPayers.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No slow payers detected. Your customers pay on time.</p>
          ) : (
            <ul className="space-y-1.5">
              {slowPayers.slowPayers.slice(0, 4).map((p) => (
                <li key={p.contactId} className="flex items-center gap-2 text-xs">
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${SEVERITY_TONE[p.severity]}`}>
                    {p.avgDaysToPay}d
                  </span>
                  <span className="flex-1 truncate text-foreground/80">{p.contactName}</span>
                  {p.outstandingTotal > 0 && (
                    <span className="text-[11px] text-amber-300">{fmt(p.outstandingTotal)} owed</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Tag className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-foreground/85">Pricing signals</h3>
          </div>
          {pricingSignals.signals.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No pricing opportunities right now. Add cost data on products to surface signals.</p>
          ) : (
            <ul className="space-y-1.5">
              {pricingSignals.signals.slice(0, 4).map((s) => (
                <li key={s.productId} className="flex items-start gap-2 text-xs">
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${SIGNAL_LABELS[s.signal].tone}`}>
                    {SIGNAL_LABELS[s.signal].label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-foreground/80">{s.productName}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{s.grossMarginPct}% · {s.unitsSold90d}u</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground/70 truncate">{s.suggestion}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* === AI Briefing card === */}
      <div className="rounded-xl border border-[hsl(var(--kf-accent1))]/30 bg-gradient-to-br from-[hsl(var(--kf-accent1))]/5 via-card to-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            <h3 className="text-sm font-semibold text-foreground/85">Revenue briefing</h3>
            {briefing.source === "fallback" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/30 text-muted-foreground border border-border/40">
                template
              </span>
            )}
          </div>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-muted/20 hover:bg-muted/40 text-foreground/70 transition disabled:opacity-50"
          >
            {regenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Regenerate
          </button>
        </div>

        <p className="text-sm text-foreground/90 leading-relaxed mb-4">{briefing.headline}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Section icon={<Calendar className="w-3.5 h-3.5 text-blue-400" />} title="What changed" items={briefing.whatChanged} />
          <Section icon={<AlertTriangle className="w-3.5 h-3.5 text-red-400" />} title="What's at risk" items={briefing.whatsAtRisk} />

          <div className="md:col-span-2 rounded-lg border border-border/40 bg-card/50 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-3.5 h-3.5 text-emerald-400" />
              <h4 className="text-xs font-semibold text-foreground/80">What to chase</h4>
            </div>
            {briefing.whatToChase.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Nothing urgent to chase this week.</p>
            ) : (
              <ul className="space-y-2">
                {briefing.whatToChase.map((c) => {
                  const isDone = !!delegated[c.id];
                  const isLoading = !!delegating[c.id];
                  return (
                    <li key={c.id} className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-foreground/85 truncate">{c.title}</span>
                          {c.amountAtRisk != null && c.amountAtRisk > 0 && (
                            <span className="text-[10px] text-amber-300 shrink-0">{fmt(c.amountAtRisk)}</span>
                          )}
                        </div>
                        {c.detail && <p className="text-[11px] text-muted-foreground/70 leading-snug">{c.detail}</p>}
                      </div>
                      <button
                        onClick={() => handleDelegate(c)}
                        disabled={isLoading || isDone}
                        className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md font-medium transition shrink-0 ${
                          isDone
                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25"
                            : "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/25 border border-[hsl(var(--kf-accent1))]/25"
                        } disabled:opacity-60`}
                      >
                        {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> :
                          isDone ? <CheckCircle2 className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
                        {isDone ? "Queued" : "Delegate"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <Section icon={<Package className="w-3.5 h-3.5 text-cyan-400" />} title="What to plan" items={briefing.whatToPlan} className="md:col-span-2" />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-lg bg-muted/15 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${accent}`}>{value}</div>
    </div>
  );
}

function Section({ icon, title, items, className }: { icon: React.ReactNode; title: string; items: string[]; className?: string }) {
  return (
    <div className={`rounded-lg border border-border/40 bg-card/50 p-3 ${className ?? ""}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h4 className="text-xs font-semibold text-foreground/80">{title}</h4>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Nothing notable.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li key={i} className="text-[11px] text-foreground/75 leading-relaxed flex gap-1.5">
              <span className="text-muted-foreground/60">•</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
