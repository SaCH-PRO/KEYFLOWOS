"use client";

import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Minus,
  Lightbulb,
  Target,
  DollarSign,
  Clock,
  Mail,
  ChevronDown,
  ChevronUp,
  BarChart3,
  Shield,
  ArrowRight,
  MessageSquare,
  Package,
  Receipt,
  Search,
} from "lucide-react";
import { useState } from "react";
import { formatCurrencyShort } from "@/lib/currency";

const fc = (v: number | string, cur = "TTD") => formatCurrencyShort(Number(v) || 0, cur);

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


type TrendItem = { direction?: string; label?: string; detail?: string };
type ClientItem = { name?: string; invoiceCount?: number; revenue?: number | string };
type RecommendationItem = { priority?: string; title?: string; description?: string; estimatedImpact?: string };
type RiskItem = { severity?: string; description?: string; mitigation?: string };
type CollectionItem = { contactName?: string; invoiceRef?: string; daysPastDue?: number; amount?: number | string; suggestedAction?: string };
type OpportunityItem = { description?: string; estimatedValue?: number | string; timeframe?: string };
type FactorItem = { impact?: string; factor?: string; detail?: string };
type StrategyItem = { name?: string; description?: string; expectedImpact?: string };
type ProductItem = { name?: string; count?: number; revenue?: number | string };
type RevenueByMonthItem = { month?: string; invoiceCount?: number; revenue?: number | string };
type IssueItem = { productName?: string; severity?: string; issue?: string; suggestion?: string };
type RecentInvoiceItem = { invoiceNumber?: string; total?: number | string; status?: string };
type RecentQuoteItem = { quoteNumber?: string; contactName?: string; total?: number | string; status?: string };
type AlternativeMessage = { tone?: string; message?: string };

interface RevenueAnalysisData {
  healthLabel?: string; healthScore?: number; summary?: string;
  trends?: TrendItem[]; topClients?: ClientItem[]; recommendations?: RecommendationItem[];
}
interface ForecastBucket { conservative?: number | string; expected?: number | string; optimistic?: number | string }
interface CashFlowForecastData {
  summary?: string;
  forecast?: { thirtyDay?: ForecastBucket; sixtyDay?: ForecastBucket; ninetyDay?: ForecastBucket };
  risks?: RiskItem[]; collectionPriority?: CollectionItem[]; opportunities?: OpportunityItem[];
}
interface InvoiceReminderData {
  tone?: string; subject?: string; message?: string;
  suggestedFollowUpDate?: string; alternativeMessages?: AlternativeMessage[];
}
interface PricingAdvisorData {
  currentPrice?: number; suggestedPrice?: number;
  priceRange?: { min?: number | string; max?: number | string };
  reasoning?: string; competitivePosition?: string;
  factors?: FactorItem[]; strategies?: StrategyItem[];
}
interface PipelineAnalysisData {
  quoteConversionRate?: number; averageInvoiceValue?: number; invoiceCount?: number;
  quoteCount?: number; totalRevenue?: number; outstandingAmount?: number;
  quoteStatusBreakdown?: Record<string, number>;
  topProducts?: ProductItem[]; revenueByMonth?: RevenueByMonthItem[];
}
interface OverdueRecoveryData {
  overdueAmount?: number; outstandingAmount?: number;
  collectionPriority?: CollectionItem[]; risks?: RiskItem[]; opportunities?: OpportunityItem[];
}
interface ProductHealthScanData {
  healthLabel?: string; healthScore?: number;
  summary?: { activeProducts?: number; totalProducts?: number };
  issueCount?: { high?: number; medium?: number; low?: number };
  issues?: IssueItem[];
}
interface ClientIntelligenceData {
  reliabilityScore?: number; reliabilityLabel?: string; contactName?: string;
  invoiceSummary?: { total?: number; paid?: number; overdue?: number };
  quoteSummary?: { total?: number; conversionRate?: number; accepted?: number };
  paymentDelayLabel?: string; avgPaymentDelay?: number;
  lifetimeValue?: number; outstandingBalance?: number;
  avgMonthlyRevenue?: number; monthsActive?: number;
  recentInvoices?: RecentInvoiceItem[];
}
interface QuoteWinAnalysisData {
  conversionRate?: number; rejectionRate?: number;
  summary?: { total?: number; draft?: number; sent?: number; accepted?: number; rejected?: number; expired?: number };
  values?: { totalWonValue?: number | string; pipelineValue?: number; avgAcceptedValue?: number; avgRejectedValue?: number };
  suggestions?: string[]; recentQuotes?: RecentQuoteItem[];
}
interface NlSearchItem { name?: string; isActive?: boolean; price?: number | string; invoiceNumber?: string; quoteNumber?: string; status?: string; total?: number | string; contact?: { firstName?: string; lastName?: string } }
interface CommerceNlSearchData {
  type?: string; interpretation?: string; confidence?: number;
  results?: NlSearchItem[];
}


function RevenueAnalysisResult({ data }: { data: RevenueAnalysisData | null }) {
  if (!data) return null;
  const healthColor = HEALTH_COLORS[data.healthLabel?.toLowerCase() || ""] || "text-blue-400";
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
      {Array.isArray(data.trends) && data.trends.length > 0 && (
        <Section title="Trends">
          <div className="space-y-1.5">
            {data.trends.map((t: TrendItem, i: number) => {
              const Icon = DIRECTION_ICONS[t.direction ?? ""] || Minus;
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
      {Array.isArray(data.topClients) && data.topClients.length > 0 && (
        <Section title="Top Clients">
          <div className="space-y-1.5">
            {data.topClients.map((c: ClientItem, i: number) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-border/30">
                <div>
                  <span className="text-[11px] font-medium text-foreground/80">{c.name}</span>
                  <p className="text-[10px] text-muted-foreground/50">{c.invoiceCount} invoices</p>
                </div>
                <span className="text-[11px] font-medium text-emerald-400"> {fc(c.revenue ?? 0)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {Array.isArray(data.recommendations) && data.recommendations.length > 0 && (
        <Section title="Recommendations">
          <div className="space-y-1.5">
            {data.recommendations.map((r: RecommendationItem, i: number) => (
              <div key={i} className="flex items-start gap-1.5">
                <Lightbulb className={`w-3 h-3 shrink-0 mt-0.5 ${PRIORITY_COLORS[r.priority ?? ""] || "text-amber-400"}`} />
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

function CashFlowForecastResult({ data }: { data: CashFlowForecastData | null }) {
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
            const f = (data.forecast as Record<string, ForecastBucket | undefined> | undefined)?.[key];
            if (!f) return null;
            return (
              <div key={key} className="p-2 rounded-lg border border-border/30 bg-white/[0.02]">
                <span className="text-[11px] font-medium text-foreground/80">{label}</span>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  <div>
                    <span className="text-[10px] text-muted-foreground/50">Conservative</span>
                    <p className="text-[11px] text-amber-400"> {fc(f.conservative ?? 0)}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground/50">Expected</span>
                    <p className="text-[11px] text-blue-400 font-medium"> {fc(f.expected ?? 0)}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground/50">Optimistic</span>
                    <p className="text-[11px] text-emerald-400"> {fc(f.optimistic ?? 0)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>
      {Array.isArray(data.risks) && data.risks.length > 0 && (
        <Section title="Risks">
          <div className="space-y-1.5">
            {data.risks.map((r: RiskItem, i: number) => (
              <div key={i} className="flex items-start gap-1.5">
                <AlertTriangle className={`w-3 h-3 shrink-0 mt-0.5 ${SEVERITY_COLORS[r.severity ?? ""] || "text-amber-400"}`} />
                <div>
                  <span className="text-[11px] text-foreground/80">{r.description}</span>
                  <p className="text-[10px] text-muted-foreground/50">Mitigation: {r.mitigation}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {Array.isArray(data.collectionPriority) && data.collectionPriority.length > 0 && (
        <Section title={`Collection Priority (${data.collectionPriority.length})`}>
          <div className="space-y-1.5">
            {data.collectionPriority.slice(0, 8).map((cp: CollectionItem, i: number) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-border/30">
                <div>
                  <span className="text-[11px] font-medium text-foreground/80">{cp.contactName}</span>
                  <p className="text-[10px] text-muted-foreground/50">{cp.invoiceRef} · {cp.daysPastDue}d overdue</p>
                </div>
                <div className="text-right">
                  <span className="text-[11px] font-medium text-red-400"> {fc(cp.amount ?? 0)}</span>
                  <p className="text-[10px] text-muted-foreground/50">{cp.suggestedAction}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {Array.isArray(data.opportunities) && data.opportunities.length > 0 && (
        <Section title="Opportunities">
          <div className="space-y-1.5">
            {data.opportunities.map((o: OpportunityItem, i: number) => (
              <div key={i} className="flex items-start gap-1.5">
                <Target className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-[11px] text-foreground/80">{o.description}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-emerald-400"> {fc(o.estimatedValue ?? 0)}</span>
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

function InvoiceReminderResult({ data }: { data: InvoiceReminderData | null }) {
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
      {Array.isArray(data.alternativeMessages) && data.alternativeMessages.length > 0 && (
        <Section title="Alternative Tones">
          <div className="space-y-2">
            {data.alternativeMessages.map((alt: AlternativeMessage, i: number) => (
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

function PricingAdvisorResult({ data }: { data: PricingAdvisorData | null }) {
  if (!data) return null;
  const priceDiff = (data.suggestedPrice || 0) - (data.currentPrice || 0);
  const priceDirection = priceDiff > 0 ? "up" : priceDiff < 0 ? "down" : "stable";
  const priceColor = priceDirection === "up" ? "text-emerald-400" : priceDirection === "down" ? "text-red-400" : "text-blue-400";
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-xl bg-white/[0.02] border border-border/30">
          <span className="text-[10px] text-muted-foreground/50 block">Current</span>
          <span className="text-lg font-bold text-foreground/80">{fc(data.currentPrice ?? 0)}</span>
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground/30" />
        <div className={`p-3 rounded-xl border ${priceDirection === "up" ? "bg-emerald-500/5 border-emerald-500/20" : priceDirection === "down" ? "bg-red-500/5 border-red-500/20" : "bg-blue-500/5 border-blue-500/20"}`}>
          <span className="text-[10px] text-muted-foreground/50 block">Suggested</span>
          <span className={`text-lg font-bold ${priceColor}`}>{fc(data.suggestedPrice ?? 0)}</span>
        </div>
      </div>
      {data.priceRange && (
        <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-border/30">
          <span className="text-[10px] text-muted-foreground/50">Price Range: </span>
          <span className="text-[11px] text-foreground/80">{fc(data.priceRange?.min ?? 0)} — {fc(data.priceRange?.max ?? 0)}</span>
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
      {Array.isArray(data.factors) && data.factors.length > 0 && (
        <Section title="Price Factors">
          <div className="space-y-1.5">
            {data.factors.map((f: FactorItem, i: number) => (
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
      {Array.isArray(data.strategies) && data.strategies.length > 0 && (
        <Section title="Pricing Strategies">
          <div className="space-y-1.5">
            {data.strategies.map((s: StrategyItem, i: number) => (
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

function PipelineAnalysisResult({ data }: { data: PipelineAnalysisData | null }) {
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
          <span className="text-lg font-bold text-foreground/80"> {fc(data.averageInvoiceValue || 0)}</span>
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
          <span className="text-[11px] font-bold text-foreground/80"> {fc(data.totalRevenue || 0)}</span>
          <span className="text-[10px] text-muted-foreground/50 block">Revenue</span>
        </div>
      </div>
      {(data.outstandingAmount ?? 0) > 0 && (
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
      {Array.isArray(data.topProducts) && data.topProducts.length > 0 && (
        <Section title="Top Products">
          <div className="space-y-1.5">
            {data.topProducts.slice(0, 5).map((p: ProductItem, i: number) => (
              <div key={i} className="flex items-center justify-between p-1.5 rounded-lg bg-white/[0.02]">
                <div className="flex items-center gap-1.5">
                  <Package className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
                  <span className="text-[11px] text-foreground/80">{p.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/50">{p.count} sold</span>
                  <span className="text-[11px] text-emerald-400"> {fc(p.revenue ?? 0)}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {Array.isArray(data.revenueByMonth) && data.revenueByMonth.length > 0 && (
        <Section title="Revenue Trend">
          <div className="space-y-1">
            {data.revenueByMonth.map((m: RevenueByMonthItem, i: number) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground/70">{m.month}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/50">{m.invoiceCount} inv</span>
                  <span className="text-[11px] font-medium text-foreground/80"> {fc(m.revenue ?? 0)}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function OverdueRecoveryResult({ data }: { data: OverdueRecoveryData | null }) {
  if (!data) return null;
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div className="px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20">
          <span className="text-[10px] text-muted-foreground/50 block">Overdue</span>
          <span className="text-sm font-bold text-red-400"> {fc(data.overdueAmount || 0)}</span>
        </div>
        <div className="px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
          <span className="text-[10px] text-muted-foreground/50 block">Outstanding</span>
          <span className="text-sm font-bold text-amber-400"> {fc(data.outstandingAmount || 0)}</span>
        </div>
      </div>
      {(data.overdueAmount ?? 0) === 0 && (
        <div className="px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <span className="text-[11px] text-emerald-400 flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5" /> No overdue invoices — your collections are up to date
          </span>
        </div>
      )}
      {Array.isArray(data.collectionPriority) && data.collectionPriority.length > 0 && (
        <Section title={`Collection Priority (${data.collectionPriority.length})`}>
          <div className="space-y-1.5">
            {data.collectionPriority.slice(0, 8).map((cp: CollectionItem, i: number) => (
              <div key={i} className="p-2 rounded-lg border border-border/30 bg-white/[0.02]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground/80">{cp.contactName}</span>
                  <span className="text-[11px] font-medium text-red-400"> {fc(cp.amount ?? 0)}</span>
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
      {Array.isArray(data.risks) && data.risks.length > 0 && (
        <Section title="Risks">
          <div className="space-y-1.5">
            {data.risks.map((r: RiskItem, i: number) => (
              <div key={i} className="flex items-start gap-1.5">
                <Shield className={`w-3 h-3 shrink-0 mt-0.5 ${SEVERITY_COLORS[r.severity ?? ""] || "text-amber-400"}`} />
                <div>
                  <span className="text-[11px] text-foreground/80">{r.description}</span>
                  <p className="text-[10px] text-muted-foreground/50">{r.mitigation}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {Array.isArray(data.opportunities) && data.opportunities.length > 0 && (
        <Section title="Recovery Opportunities">
          <div className="space-y-1.5">
            {data.opportunities.map((o: OpportunityItem, i: number) => (
              <div key={i} className="flex items-start gap-1.5">
                <Target className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-[11px] text-foreground/80">{o.description}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-emerald-400"> {fc(o.estimatedValue ?? 0)}</span>
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

function ProductHealthScanResult({ data }: { data: ProductHealthScanData | null }) {
  if (!data) return null;
  const healthColor = HEALTH_COLORS[(data.healthLabel?.toLowerCase()?.replace("needs_attention", "poor")) || ""] || "text-blue-400";
  const s = data.summary || {};
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
          <span className={`text-sm font-semibold ${healthColor}`}>{data.healthLabel?.replace("_", " ")}</span>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">Product Health Score</p>
          <p className="text-[10px] text-muted-foreground/50">{s.activeProducts ?? 0}/{s.totalProducts ?? 0} active</p>
        </div>
      </div>
      {data.issueCount && (
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2 rounded-lg bg-red-500/5 border border-red-500/20 text-center">
            <span className="text-sm font-bold text-red-400">{data.issueCount.high}</span>
            <span className="text-[10px] text-muted-foreground/50 block">High</span>
          </div>
          <div className="p-2 rounded-lg bg-amber-500/5 border border-amber-500/20 text-center">
            <span className="text-sm font-bold text-amber-400">{data.issueCount.medium}</span>
            <span className="text-[10px] text-muted-foreground/50 block">Medium</span>
          </div>
          <div className="p-2 rounded-lg bg-blue-500/5 border border-blue-500/20 text-center">
            <span className="text-sm font-bold text-blue-400">{data.issueCount.low}</span>
            <span className="text-[10px] text-muted-foreground/50 block">Low</span>
          </div>
        </div>
      )}
      {Array.isArray(data.issues) && data.issues.length > 0 && (
        <Section title={`Issues (${data.issues.length})`}>
          <div className="space-y-1.5">
            {data.issues.slice(0, 10).map((issue: IssueItem, i: number) => (
              <div key={i} className="p-2 rounded-lg border border-border/30 bg-white/[0.02]">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <Package className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
                    <span className="text-[11px] font-medium text-foreground/80">{issue.productName}</span>
                  </div>
                  <span className={`text-[10px] font-medium ${SEVERITY_COLORS[issue.severity ?? ""] || "text-amber-400"}`}>
                    {issue.severity}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground/60">{issue.issue}</p>
                <p className="text-[10px] text-[hsl(var(--kf-accent1))] mt-0.5">{issue.suggestion}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function ClientIntelligenceResult({ data }: { data: ClientIntelligenceData | null }) {
  if (!data) return null;
  const reliabilityColor = (data.reliabilityScore ?? 0) >= 80 ? "text-emerald-400" : (data.reliabilityScore ?? 0) >= 60 ? "text-amber-400" : "text-red-400";
  const inv = data.invoiceSummary || {};
  const qt = data.quoteSummary || {};
  const delayLabel = data.paymentDelayLabel?.replace("_", " ") || "unknown";
  const delayColor = (data.avgPaymentDelay ?? 0) <= 0 ? "text-emerald-400" : (data.avgPaymentDelay ?? 0) <= 7 ? "text-blue-400" : (data.avgPaymentDelay ?? 0) <= 14 ? "text-amber-400" : "text-red-400";
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3">
        <div className="relative w-14 h-14">
          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" className="text-white/5" strokeWidth="4" />
            <circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" className={reliabilityColor} strokeWidth="4"
              strokeDasharray={`${((data.reliabilityScore || 0) / 100) * 151} 151`} strokeLinecap="round" />
          </svg>
          <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${reliabilityColor}`}>
            {data.reliabilityScore}
          </span>
        </div>
        <div>
          <span className={`text-sm font-semibold ${reliabilityColor}`}>{data.reliabilityLabel}</span>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">Payment Reliability</p>
          {data.contactName && (
            <p className="text-[10px] text-muted-foreground/50">{data.contactName}</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <span className="text-[10px] text-muted-foreground/50 block">Lifetime Value</span>
          <span className="text-sm font-bold text-emerald-400"> {fc(data.lifetimeValue || 0)}</span>
        </div>
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <span className="text-[10px] text-muted-foreground/50 block">Avg Pay Delay</span>
          <span className={`text-sm font-bold ${delayColor}`}>{data.avgPaymentDelay || 0}d</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <Receipt className="w-3.5 h-3.5 text-blue-400 mx-auto mb-1" />
          <span className="text-[11px] font-bold text-foreground/80">{inv.total || 0}</span>
          <span className="text-[10px] text-muted-foreground/50 block">Invoices</span>
        </div>
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <CheckCircle className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-1" />
          <span className="text-[11px] font-bold text-foreground/80">{inv.paid || 0}</span>
          <span className="text-[10px] text-muted-foreground/50 block">Paid</span>
        </div>
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 mx-auto mb-1" />
          <span className="text-[11px] font-bold text-red-400">{inv.overdue || 0}</span>
          <span className="text-[10px] text-muted-foreground/50 block">Overdue</span>
        </div>
      </div>
      {(data.outstandingBalance ?? 0) > 0 && (
        <div className="px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
          <span className="text-[11px] text-amber-400 flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5" />
            Outstanding: ${Number(data.outstandingBalance).toLocaleString()}
          </span>
        </div>
      )}
      <div className="px-3 py-2 rounded-lg bg-[hsl(var(--kf-accent1))]/5 border border-[hsl(var(--kf-accent1))]/20">
        <span className="text-[11px] text-[hsl(var(--kf-accent1))]">Payment pattern: {delayLabel}</span>
        {(qt.total ?? 0) > 0 && (
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">Quote conversion: {qt.conversionRate}% ({qt.accepted}/{qt.total})</p>
        )}
        <p className="text-[10px] text-muted-foreground/50">Avg monthly revenue: ${Number(data.avgMonthlyRevenue || 0).toLocaleString()} · {data.monthsActive || 0} months active</p>
      </div>
      {Array.isArray(data.recentInvoices) && data.recentInvoices.length > 0 && (
        <Section title="Recent Invoices">
          <div className="space-y-1.5">
            {data.recentInvoices.slice(0, 5).map((inv: RecentInvoiceItem, i: number) => (
              <div key={i} className="flex items-center justify-between p-1.5 rounded-lg bg-white/[0.02]">
                <div className="flex items-center gap-1.5">
                  <Receipt className="w-3 h-3 text-blue-400" />
                  <span className="text-[11px] text-foreground/80">{inv.invoiceNumber}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-emerald-400"> {fc(inv.total ?? 0)}</span>
                  <span className={`text-[10px] font-medium ${inv.status === "PAID" ? "text-emerald-400" : inv.status === "OVERDUE" ? "text-red-400" : "text-blue-400"}`}>
                    {inv.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function QuoteWinAnalysisResult({ data }: { data: QuoteWinAnalysisData | null }) {
  if (!data) return null;
  const convRate = Math.round(data.conversionRate || 0);
  const convColor = convRate >= 50 ? "text-emerald-400" : convRate >= 25 ? "text-amber-400" : "text-red-400";
  const s = data.summary || {};
  const v = data.values || {};
  const funnelStages = s.total ? [
    { stage: "Draft", count: s.draft || 0, pct: s.total > 0 ? Math.round(((s.draft || 0) / s.total) * 100) : 0 },
    { stage: "Sent", count: s.sent || 0, pct: s.total > 0 ? Math.round(((s.sent || 0) / s.total) * 100) : 0 },
    { stage: "Accepted", count: s.accepted || 0, pct: s.total > 0 ? Math.round(((s.accepted || 0) / s.total) * 100) : 0 },
    { stage: "Rejected", count: s.rejected || 0, pct: s.total > 0 ? Math.round(((s.rejected || 0) / s.total) * 100) : 0 },
    { stage: "Expired", count: s.expired || 0, pct: s.total > 0 ? Math.round(((s.expired || 0) / s.total) * 100) : 0 },
  ] : [];
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <span className="text-[10px] text-muted-foreground/50 block">Win Rate</span>
          <span className={`text-lg font-bold ${convColor}`}>{convRate}%</span>
        </div>
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <span className="text-[10px] text-muted-foreground/50 block">Rejection Rate</span>
          <span className="text-lg font-bold text-red-400">{data.rejectionRate || 0}%</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <BarChart3 className="w-3.5 h-3.5 text-blue-400 mx-auto mb-1" />
          <span className="text-[11px] font-bold text-foreground/80">{s.total || 0}</span>
          <span className="text-[10px] text-muted-foreground/50 block">Total</span>
        </div>
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <CheckCircle className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-1" />
          <span className="text-[11px] font-bold text-foreground/80">{s.accepted || 0}</span>
          <span className="text-[10px] text-muted-foreground/50 block">Won</span>
        </div>
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <DollarSign className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-1" />
          <span className="text-[11px] font-bold text-emerald-400"> {fc(v.totalWonValue ?? 0)}</span>
          <span className="text-[10px] text-muted-foreground/50 block">Won Value</span>
        </div>
      </div>
      {(v.pipelineValue ?? 0) > 0 && (
        <div className="px-3 py-2 rounded-lg bg-[hsl(var(--kf-accent1))]/5 border border-[hsl(var(--kf-accent1))]/20">
          <span className="text-[11px] text-[hsl(var(--kf-accent1))] flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5" />
            Pipeline: ${Number(v.pipelineValue).toLocaleString()}
          </span>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">
            Avg accepted: ${Number(v.avgAcceptedValue || 0).toLocaleString()} · Avg rejected: ${Number(v.avgRejectedValue || 0).toLocaleString()}
          </p>
        </div>
      )}
      {funnelStages.length > 0 && (
        <Section title="Quote Funnel">
          <div className="space-y-1.5">
            {funnelStages.map((stage, i) => (
              <div key={i} className="p-2 rounded-lg bg-white/[0.02] border border-border/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-foreground/80">{stage.stage}</span>
                  <span className="text-[11px] font-medium text-foreground/80">{stage.count}</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[hsl(var(--kf-accent1))] transition-all"
                    style={{ width: `${Math.min(stage.pct, 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground/50">{stage.pct}%</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {Array.isArray(data.suggestions) && data.suggestions.length > 0 && (
        <Section title="Suggestions">
          <div className="space-y-1.5">
            {data.suggestions.map((suggestion: string, i: number) => (
              <div key={i} className="flex items-start gap-1.5">
                <Lightbulb className="w-3 h-3 shrink-0 mt-0.5 text-amber-400" />
                <p className="text-[11px] text-muted-foreground/70">{suggestion}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
      {Array.isArray(data.recentQuotes) && data.recentQuotes.length > 0 && (
        <Section title="Recent Quotes">
          <div className="space-y-1.5">
            {data.recentQuotes.slice(0, 6).map((q: RecentQuoteItem, i: number) => (
              <div key={i} className="flex items-center justify-between p-1.5 rounded-lg bg-white/[0.02]">
                <div>
                  <span className="text-[11px] text-foreground/80">{q.quoteNumber}</span>
                  <span className="text-[10px] text-muted-foreground/50 ml-1">{q.contactName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-emerald-400"> {fc(q.total ?? 0)}</span>
                  <span className={`text-[10px] font-medium ${q.status === "ACCEPTED" ? "text-emerald-400" : q.status === "REJECTED" ? "text-red-400" : "text-blue-400"}`}>
                    {q.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function mapNlResult(type: string, r: NlSearchItem): { name: string; status?: string; total?: number } {
  if (type === "products") {
    return { name: r.name || "Untitled", status: r.isActive ? "ACTIVE" : "INACTIVE", total: r.price ? Number(r.price) : undefined };
  }
  if (type === "invoices") {
    const contactName = r.contact ? `${r.contact.firstName ?? ""} ${r.contact.lastName ?? ""}`.trim() : "";
    return { name: r.invoiceNumber ? `${r.invoiceNumber}${contactName ? ` — ${contactName}` : ""}` : contactName || "Invoice", status: r.status, total: r.total ? Number(r.total) : undefined };
  }
  if (type === "quotes") {
    const contactName = r.contact ? `${r.contact.firstName ?? ""} ${r.contact.lastName ?? ""}`.trim() : "";
    return { name: r.quoteNumber ? `${r.quoteNumber}${contactName ? ` — ${contactName}` : ""}` : contactName || "Quote", status: r.status, total: r.total ? Number(r.total) : undefined };
  }
  return { name: r.name || r.invoiceNumber || r.quoteNumber || "Item" };
}

function CommerceNlSearchResult({ data }: { data: CommerceNlSearchData | null }) {
  if (!data) return null;
  const TYPE_ICONS: Record<string, typeof Package> = {
    products: Package,
    invoices: Receipt,
    quotes: BarChart3,
  };
  const STATUS_COLORS: Record<string, string> = {
    PAID: "text-emerald-400",
    SENT: "text-blue-400",
    DRAFT: "text-muted-foreground/60",
    OVERDUE: "text-red-400",
    ACCEPTED: "text-emerald-400",
    REJECTED: "text-red-400",
    ACTIVE: "text-emerald-400",
    INACTIVE: "text-muted-foreground/40",
    PENDING: "text-amber-400",
    VOID: "text-muted-foreground/40",
  };
  const resultType = data.type || "products";
  const TypeIcon = TYPE_ICONS[resultType ?? ""] || Package;
  const results = data.results || [];
  const totalResults = results.length;
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 mb-1">
        <Search className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
        <span className="text-[11px] text-muted-foreground/70 italic">&quot;{data.interpretation || "search"}&quot;</span>
        {(data.confidence ?? 0) > 0 && (
          <span className="text-[10px] text-muted-foreground/40 ml-auto">{Math.round((data.confidence ?? 0) * 100)}% confidence</span>
        )}
      </div>
      <div className="px-3 py-1.5 rounded-lg bg-white/[0.02] border border-border/30 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/50">{totalResults} {resultType} found</span>
        <span className="text-[10px] text-[hsl(var(--kf-accent1))] capitalize">{resultType}</span>
      </div>
      {Array.isArray(results) && results.length > 0 && (
        <div className="space-y-1.5">
          {results.slice(0, 12).map((r: NlSearchItem, i: number) => {
            const mapped = mapNlResult(resultType, r);
            return (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-border/30">
                <div className="flex items-center gap-2">
                  <TypeIcon className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
                  <span className="text-[11px] font-medium text-foreground/80 truncate max-w-[180px]">{mapped.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {mapped.total != null && (
                    <span className="text-[11px] font-medium text-emerald-400"> {fc(mapped.total ?? 0)}</span>
                  )}
                  {mapped.status && (
                    <span className={`text-[10px] font-medium ${STATUS_COLORS[mapped.status ?? ""] || "text-muted-foreground/50"}`}>
                      {mapped.status}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {(!Array.isArray(results) || results.length === 0) && (
        <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <span className="text-[11px] text-muted-foreground/50">No results matched your query</span>
        </div>
      )}
    </div>
  );
}

export function renderCommerceToolResult(toolId: string, result: unknown): React.ReactNode {
  switch (toolId) {
    case "revenue-analysis":
      return <RevenueAnalysisResult data={result as RevenueAnalysisData | null} />;
    case "cashflow-forecast":
      return <CashFlowForecastResult data={result as CashFlowForecastData | null} />;
    case "invoice-reminder":
      return <InvoiceReminderResult data={result as InvoiceReminderData | null} />;
    case "pricing-advisor":
      return <PricingAdvisorResult data={result as PricingAdvisorData | null} />;
    case "pipeline-analysis":
      return <PipelineAnalysisResult data={result as PipelineAnalysisData | null} />;
    case "overdue-recovery":
      return <OverdueRecoveryResult data={result as OverdueRecoveryData | null} />;
    case "product-health-scan":
      return <ProductHealthScanResult data={result as ProductHealthScanData | null} />;
    case "client-intelligence":
      return <ClientIntelligenceResult data={result as ClientIntelligenceData | null} />;
    case "quote-win-analysis":
      return <QuoteWinAnalysisResult data={result as QuoteWinAnalysisData | null} />;
    case "commerce-nl-search":
      return <CommerceNlSearchResult data={result as CommerceNlSearchData | null} />;
    default:
      return (
        <pre className="text-[11px] text-muted-foreground/70 whitespace-pre-wrap overflow-auto max-h-64">
          {JSON.stringify(result, null, 2)}
        </pre>
      );
  }
}
