"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Brain,
  Calendar,
  FileText,
  Inbox,
  Loader2,
  Minus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { normalizeFrontendChannel, getChannelLabel } from "@/lib/key-inbox/channels";
import { Button, Card, Badge } from "@keyflow/ui";
import {
  type IntelligenceScope,
  type KeyInboxIntelligenceReport,
  type KeyInboxIntelligenceInsight,
  type MetricTrend,
  fetchLatestInboxIntelligence,
  generateInboxIntelligence,
} from "@/lib/api/key-inbox";

const SCOPE_LABELS: Record<IntelligenceScope, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  CUSTOM: "Custom",
};

const INSIGHT_COLORS: Record<string, string> = {
  REVENUE_OPPORTUNITY: "bg-emerald-500",
  LEAD_OPPORTUNITY: "bg-blue-500",
  BOOKING_SIGNAL: "bg-violet-500",
  INVOICE_SIGNAL: "bg-amber-500",
  PRICING_SIGNAL: "bg-cyan-500",
  CUSTOMER_COMPLAINT: "bg-rose-500",
  OPERATIONAL_RISK: "bg-red-500",
  SUPPORT_SIGNAL: "bg-orange-500",
  FOLLOW_UP_GAP: "bg-yellow-500",
  CHANNEL_PERFORMANCE: "bg-slate-500",
  OFFER_CONFUSION: "bg-pink-500",
  REPEATED_QUESTION: "bg-indigo-500",
  GENOME_SIGNAL: "bg-purple-500",
};

function toStringList(items: unknown[]): string[] {
  return items.filter((item): item is string => typeof item === "string");
}

function formatPeriod(start: string, end: string): string {
  return `${format(new Date(start), "MMM d, yyyy")} – ${format(new Date(end), "MMM d, yyyy")}`;
}

function getTrendIcon(trend: MetricTrend) {
  if (trend.direction === "up") return <ArrowUpRight className="w-4 h-4 text-emerald-500" />;
  if (trend.direction === "down") return <ArrowDownRight className="w-4 h-4 text-rose-500" />;
  return <Minus className="w-4 h-4 text-muted-foreground" />;
}

function getTrendClass(trend: MetricTrend) {
  if (trend.direction === "up") return "text-emerald-600";
  if (trend.direction === "down") return "text-rose-600";
  return "text-muted-foreground";
}

function TrendCard({ label, trend }: { label: string; trend?: MetricTrend }) {
  if (!trend) return null;
  const percent = trend.deltaPercent !== null ? `${trend.deltaPercent > 0 ? "+" : ""}${trend.deltaPercent}%` : "N/A";
  return (
    <Card variant="glass" padding="md" className="flex flex-col justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-end justify-between mt-2">
        <span className="text-2xl font-semibold">{trend.current}</span>
        <div className={`flex items-center gap-1 text-xs font-medium ${getTrendClass(trend)}`}>
          {getTrendIcon(trend)}
          <span>{percent}</span>
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground mt-1">Previous: {trend.previous}</span>
    </Card>
  );
}

function KpiCard({ label, value }: { label: string; value: number | null | undefined }) {
  const display = value === null || value === undefined ? "–" : typeof value === "number" ? value.toLocaleString() : String(value);
  return (
    <Card variant="glass" padding="md" className="flex flex-col justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold mt-1">{display}</span>
    </Card>
  );
}

function InsightGroup({
  title,
  insights,
}: {
  title: string;
  insights: KeyInboxIntelligenceInsight[];
}) {
  if (insights.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-2">
        {insights.map((insight, idx) => (
          <Card key={idx} variant="glass" padding="md">
            <div className="flex items-start gap-3">
              <span className={`mt-1.5 h-2 w-2 rounded-full ${INSIGHT_COLORS[insight.type] ?? "bg-muted-foreground"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{insight.title}</span>
                  <Badge tone={insight.severity === "CRITICAL" || insight.severity === "HIGH" ? "danger" : "warning"}>
                    {insight.severity}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{insight.description}</p>
                {insight.evidence.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {insight.evidence.map((ev, i) => (
                      <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                        <span className="mt-1 h-1 w-1 rounded-full bg-muted-foreground/60" />
                        {ev}
                      </li>
                    ))}
                  </ul>
                )}
                {insight.suggestedAction && (
                  <div className="mt-3 flex items-center gap-2">
                    <Link
                      href={actionLink(insight.type, insight.suggestedAction.type)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[hsl(var(--kf-accent1))]/10 text-[11px] font-medium text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
                    >
                      {insight.suggestedAction.label}
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function actionLink(type: string, actionType: string): string {
  if (type === "FOLLOW_UP_GAP" || actionType === "follow_up") return "/app/key-inbox?status=OPEN";
  if (type === "PRICING_SIGNAL") return "/app/key-inbox?intent=pricing_question";
  if (type === "BOOKING_SIGNAL") return "/app/key-inbox?intent=booking_request";
  if (type === "INVOICE_SIGNAL") return "/app/key-inbox?intent=invoice_request";
  if (type === "LEAD_OPPORTUNITY") return "/app/key-inbox?intent=lead_inquiry";
  if (type === "CUSTOMER_COMPLAINT" || type === "SUPPORT_SIGNAL") return "/app/key-inbox?intent=complaint";
  if (type === "OPERATIONAL_RISK") return "/app/key-inbox?sendStatus=FAILED";
  return "/app/key-inbox";
}

function groupInsights(insights: KeyInboxIntelligenceInsight[]) {
  return {
    revenue: insights.filter((i) => ["REVENUE_OPPORTUNITY", "PRICING_SIGNAL"].includes(i.type)),
    leads: insights.filter((i) => ["LEAD_OPPORTUNITY", "BOOKING_SIGNAL", "INVOICE_SIGNAL"].includes(i.type)),
    pain: insights.filter((i) => ["CUSTOMER_COMPLAINT", "OFFER_CONFUSION", "REPEATED_QUESTION"].includes(i.type)),
    risk: insights.filter((i) => ["OPERATIONAL_RISK", "SUPPORT_SIGNAL"].includes(i.type)),
    followUp: insights.filter((i) => i.type === "FOLLOW_UP_GAP"),
    channel: insights.filter((i) => i.type === "CHANNEL_PERFORMANCE"),
    genome: insights.filter((i) => i.type === "GENOME_SIGNAL"),
  };
}

export default function KeyInboxBriefPage() {
  const businessId = getStoredBusinessId();
  const [scope, setScope] = useState<IntelligenceScope>("WEEKLY");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [report, setReport] = useState<KeyInboxIntelligenceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const fetchReport = async (signal?: AbortSignal) => {
    if (!businessId) return;
    setLoading(true);
    const res = await fetchLatestInboxIntelligence(businessId, scope);
    if (signal?.aborted) return;
    if (res.error) {
      if (res.error.includes("No intelligence report")) {
        setReport(null);
      } else {
        toast.error(res.error);
        setReport(null);
      }
    } else {
      setReport(res.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchReport(controller.signal);
    return () => controller.abort();
  }, [businessId, scope]);

  const handleGenerate = async () => {
    if (!businessId) return;
    setGenerating(true);
    const res = await generateInboxIntelligence(
      businessId,
      scope,
      scope === "CUSTOM" ? customStart : undefined,
      scope === "CUSTOM" ? customEnd : undefined,
    );
    if (res.error) {
      toast.error(res.error);
    } else if (res.data) {
      setReport(res.data);
      toast.success(`${SCOPE_LABELS[scope]} intelligence refreshed`);
    }
    setGenerating(false);
  };

  const grouped = useMemo(() => (report ? groupInsights(report.insights ?? []) : null), [report]);
  const trendEntries = useMemo(() => {
    if (!report) return [];
    return Object.entries(report.trends ?? {}).filter(([key]) => key in TREND_LABELS) as [string, MetricTrend][];
  }, [report]);

  if (!businessId) {
    return (
      <div className="max-w-6xl mx-auto p-4">
        <p className="text-sm text-muted-foreground">No active business — pick a workspace first.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-violet-500/20 to-rose-500/20 border border-border/40 flex items-center justify-center">
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">KEYInbox Intelligence</h1>
            <p className="text-xs text-muted-foreground">
              Strategic insights from your omnichannel conversations.
            </p>
          </div>
        </div>
        <Link
          href="/app/key-inbox"
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
        >
          <Inbox className="w-3.5 h-3.5" /> Open Key Inbox
        </Link>
      </div>

      {/* Scope tabs + generate */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
        <div className="inline-flex items-center rounded-lg border border-border/40 bg-muted/30 p-0.5 flex-wrap">
          {(["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"] as IntelligenceScope[]).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                scope === s
                  ? "bg-[hsl(var(--kf-accent1))] text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {SCOPE_LABELS[s]}
            </button>
          ))}
        </div>

        {scope === "CUSTOM" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-2 py-1.5 text-xs rounded-md border border-border/40 bg-muted/30"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-2 py-1.5 text-xs rounded-md border border-border/40 bg-muted/30"
            />
          </div>
        )}

        <Button
          size="sm"
          onClick={handleGenerate}
          disabled={generating || loading || (scope === "CUSTOM" && (!customStart || !customEnd))}
          className="gap-1.5"
        >
          {generating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          Generate report
        </Button>
      </div>

      {/* Loading skeleton */}
      {loading && !report && (
        <div className="space-y-4">
          <Card variant="glass" padding="lg" className="space-y-3">
            <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
            <div className="h-20 rounded bg-muted animate-pulse" />
          </Card>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} variant="glass" padding="md" className="space-y-2">
                <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
                <div className="h-8 w-1/3 rounded bg-muted animate-pulse" />
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !report && (
        <Card variant="glass" padding="lg" className="text-center">
          <Sparkles className="w-8 h-8 mx-auto text-muted-foreground/50 mb-3" />
          <h3 className="text-sm font-medium">No intelligence report available yet.</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Generate your first {SCOPE_LABELS[scope].toLowerCase()} report.
          </p>
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={generating || (scope === "CUSTOM" && (!customStart || !customEnd))}
            className="mt-4 gap-1.5"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Generate {SCOPE_LABELS[scope]} report
          </Button>
        </Card>
      )}

      {/* Report content */}
      {report && !loading && (
        <div className="space-y-6">
          {/* Summary card */}
          <Card variant="glass" padding="lg">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Badge tone="info">{SCOPE_LABELS[report.scope]}</Badge>
              {report.generatedBy === "fallback" && <Badge tone="warning">AI fallback</Badge>}
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {formatPeriod(report.periodStart, report.periodEnd)}
              </span>
            </div>
            <p className="text-sm leading-relaxed">{report.executiveSummary || report.summary}</p>
          </Card>

          {/* KPI strip */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key metrics</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <KpiCard label="Inbound" value={report.metrics?.inboundMessages} />
              <KpiCard label="Outbound" value={report.metrics?.outboundMessages} />
              <KpiCard label="Open threads" value={report.metrics?.openThreads} />
              <KpiCard label="Urgent threads" value={report.metrics?.urgentThreads} />
              <KpiCard label="Leads" value={report.metrics?.leadInquiries} />
              <KpiCard label="Bookings" value={report.metrics?.bookingRequests} />
              <KpiCard label="Pricing" value={report.metrics?.pricingQuestions} />
              <KpiCard label="Complaints" value={report.metrics?.complaints} />
              <KpiCard label="Failed replies" value={report.metrics?.failedReplies} />
              <KpiCard
                label="Avg response (min)"
                value={report.metrics?.averageFirstResponseMinutes}
              />
            </div>
          </div>

          {/* Trend cards */}
          {trendEntries.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trends vs previous period</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {trendEntries.map(([key, trend]) => (
                  <TrendCard key={key} label={TREND_LABELS[key]} trend={trend} />
                ))}
              </div>
            </div>
          )}

          {/* Key findings */}
          {report.keyFindings && report.keyFindings.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key findings</h3>
              <Card variant="glass" padding="md">
                <ul className="space-y-2">
                  {toStringList(report.keyFindings).map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--kf-accent1))] shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}

          {/* Recommendations */}
          {report.recommendations && report.recommendations.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recommendations</h3>
              <Card variant="glass" padding="md">
                <ul className="space-y-2">
                  {toStringList(report.recommendations).map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}

          {/* Suggested tasks */}
          {report.taskSuggestions && report.taskSuggestions.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggested tasks</h3>
              <Card variant="glass" padding="md">
                <ul className="space-y-2">
                  {toStringList(report.taskSuggestions).map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--kf-accent1))] shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}

          {/* Insights */}
          {grouped && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <InsightGroup title="Revenue opportunities" insights={grouped.revenue} />
              <InsightGroup title="Lead opportunities" insights={grouped.leads} />
              <InsightGroup title="Customer pain points" insights={grouped.pain} />
              <InsightGroup title="Operational risks" insights={grouped.risk} />
              <InsightGroup title="Follow-up gaps" insights={grouped.followUp} />
              <InsightGroup title="Channel performance" insights={grouped.channel} />
            </div>
          )}

          {/* Genome signals preview */}
          {report.genomeSignals && report.genomeSignals.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Brain className="w-3.5 h-3.5" />
                Genome Signal Preview
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {report.genomeSignals.map((signal, idx) => (
                  <Card key={idx} variant="outlined" padding="md">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-purple-600">{signal.section}</span>
                      <span className="text-[10px] text-muted-foreground">{Math.round(signal.confidence * 100)}% confidence</span>
                    </div>
                    <h4 className="text-sm font-medium mt-1">{signal.title}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{signal.reason}</p>
                    <div className="mt-2 text-[10px] text-muted-foreground">
                      Domain: <span className="font-medium">{signal.domain}</span> · Type: <span className="font-medium">{signal.signalType}</span>
                    </div>
                    {signal.evidence.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {signal.evidence.slice(0, 2).map((ev, i) => (
                          <p key={i} className="text-[10px] text-muted-foreground truncate">
                            “{ev.excerpt}”
                          </p>
                        ))}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Channel breakdown */}
          {report.channelBreakdown && Object.keys(report.channelBreakdown).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5" />
                Channel breakdown
              </h3>
              <Card variant="glass" padding="md">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(report.channelBreakdown).map(([channel, count]) => {
                    const canonical = normalizeFrontendChannel(channel);
                    return (
                      <Link
                        key={channel}
                        href={`/app/key-inbox?channel=${encodeURIComponent(canonical)}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/40 text-xs hover:bg-muted/60 transition-colors"
                      >
                        <span className="font-medium">{getChannelLabel(canonical)}</span>
                        <span className="text-muted-foreground">{count}</span>
                      </Link>
                    );
                  })}
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const TREND_LABELS: Record<string, string> = {
  inboundMessages: "Inbound messages",
  outboundMessages: "Outbound messages",
  leadInquiries: "Lead inquiries",
  pricingQuestions: "Pricing questions",
  bookingRequests: "Booking requests",
  invoiceRequests: "Invoice requests",
  supportRequests: "Support requests",
  complaints: "Complaints",
  urgentThreads: "Urgent threads",
  unansweredThreads: "Unanswered threads",
  failedReplies: "Failed replies",
  averageResponseTime: "Avg response time",
};
