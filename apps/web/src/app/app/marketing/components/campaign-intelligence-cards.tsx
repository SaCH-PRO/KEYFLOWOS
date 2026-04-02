"use client";

import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Clock,
  Users,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  HeartPulse,
  Calendar,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Target,
  RefreshCw,
} from "lucide-react";
import type {
  CampaignBriefing,
  AudienceHealthSummary,
  SendTimeRecommendation,
  SegmentSendTimeResult,
  PreSendValidationResult,
  PreSendWarning,
} from "@/lib/client";
import {
  fetchCampaignBriefings,
  fetchAudienceHealth,
  fetchSendTimeRecommendations,
} from "@/lib/client";
import { AiBadge } from "@/components/ui/ai-badge";
import { InfoBadge } from "@/components/ui/info-badge";

const stagger = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } },
  item: {
    hidden: { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35 } },
  },
};

function PerformanceBadge({ performance }: { performance: string | null }) {
  if (!performance) return null;
  const config = {
    above_average: { label: "Above Average", icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10" },
    below_average: { label: "Below Average", icon: TrendingDown, color: "text-amber-400", bg: "bg-amber-500/10" },
    average: { label: "On Par", icon: Target, color: "text-blue-400", bg: "bg-blue-500/10" },
  }[performance] || { label: performance, icon: Target, color: "text-muted-foreground", bg: "bg-muted/10" };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${config.color} ${config.bg}`}>
      <config.icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

function BriefingCard({ briefing }: { briefing: CampaignBriefing }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      variants={stagger.item}
      className="kf-card p-4 space-y-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Brain className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            <h4 className="text-sm font-semibold truncate">{briefing.campaign?.name || "Campaign"}</h4>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {briefing.campaign?.sentAt
              ? `Sent ${new Date(briefing.campaign.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} to ${briefing.campaign?.totalRecipients ?? 0} recipients`
              : "Performance briefing"}
          </p>
        </div>
        <PerformanceBadge performance={briefing.performanceVsAvg} />
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Open Rate", value: briefing.openRate != null ? `${briefing.openRate.toFixed(1)}%` : "—", avg: briefing.historicalAvgOpenRate },
          { label: "Click Rate", value: briefing.clickRate != null ? `${briefing.clickRate.toFixed(1)}%` : "—", avg: briefing.historicalAvgClickRate },
          { label: "Delivery", value: briefing.deliveryRate != null ? `${briefing.deliveryRate.toFixed(1)}%` : "—", avg: null },
          { label: "Bounce", value: briefing.bounceRate != null ? `${briefing.bounceRate.toFixed(1)}%` : "—", avg: null },
        ].map((metric) => (
          <div key={metric.label} className="text-center">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{metric.label}</p>
            <p className="text-sm font-bold">{metric.value}</p>
            {metric.avg != null && (
              <p className="text-[9px] text-muted-foreground">avg: {metric.avg.toFixed(1)}%</p>
            )}
          </div>
        ))}
      </div>

      {briefing.aiBriefing && (
        <div className="rounded-xl bg-[hsl(var(--kf-accent1))]/5 border border-[hsl(var(--kf-accent1))]/10 p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sparkles className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
            <span className="text-[10px] font-medium text-[hsl(var(--kf-accent1))]">AI Analysis</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {expanded ? briefing.aiBriefing : briefing.aiBriefing.slice(0, 200) + (briefing.aiBriefing.length > 200 ? "..." : "")}
          </p>
          {briefing.aiBriefing.length > 200 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-[hsl(var(--kf-accent1))] hover:underline mt-1 flex items-center gap-0.5"
            >
              {expanded ? <><ChevronUp className="w-3 h-3" /> Less</> : <><ChevronDown className="w-3 h-3" /> More</>}
            </button>
          )}
        </div>
      )}

      {briefing.insights && Array.isArray(briefing.insights) && briefing.insights.length > 0 && (
        <div className="space-y-1">
          {briefing.insights.map((insight, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
              <span>{insight}</span>
            </div>
          ))}
        </div>
      )}

      {briefing.recommendations && Array.isArray(briefing.recommendations) && briefing.recommendations.length > 0 && (
        <div className="space-y-1">
          {briefing.recommendations.map((rec, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="w-3 h-3 text-blue-400 mt-0.5 shrink-0" />
              <span>{rec}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export function CampaignBriefingsSection({ businessId }: { businessId: string | null }) {
  const [briefings, setBriefings] = useState<CampaignBriefing[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchCampaignBriefings(businessId);
      if (res.data) setBriefings(res.data);
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="kf-card p-6 text-center">
        <RefreshCw className="w-5 h-5 text-muted-foreground animate-spin mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Loading campaign briefings...</p>
      </div>
    );
  }

  if (briefings.length === 0) {
    return (
      <div className="kf-card p-6 text-center">
        <Brain className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-sm font-medium text-muted-foreground">No campaign briefings yet</p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Briefings are generated automatically 48 hours after sending a campaign
        </p>
      </div>
    );
  }

  return (
    <motion.div variants={stagger.container} initial="hidden" animate="visible" className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Brain className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
        <h3 className="text-sm font-semibold">Campaign Performance Briefings</h3>
        <AiBadge label="AI Analysis" explanation="AI analyzes open rates, click-through rates, and engagement patterns to generate actionable post-campaign insights." />
      </div>
      {briefings.map((b) => (
        <BriefingCard key={b.id} briefing={b} />
      ))}
    </motion.div>
  );
}

export function AudienceHealthSection({ businessId }: { businessId: string | null }) {
  const [health, setHealth] = useState<AudienceHealthSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchAudienceHealth(businessId);
      if (res.data) setHealth(res.data);
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="kf-card p-6 text-center">
        <RefreshCw className="w-5 h-5 text-muted-foreground animate-spin mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Analyzing audience health...</p>
      </div>
    );
  }

  if (!health || health.totalContacts === 0) {
    return (
      <div className="kf-card p-6 text-center">
        <HeartPulse className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-sm font-medium text-muted-foreground">No audience data</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Add contacts with email addresses to see audience health</p>
      </div>
    );
  }

  const segments = [
    { label: "Healthy", count: health.healthy, color: "#22c55e", pct: Math.round((health.healthy / health.totalContacts) * 100) },
    { label: "At Risk", count: health.atRisk, color: "#f59e0b", pct: Math.round((health.atRisk / health.totalContacts) * 100) },
    { label: "Disengaged", count: health.disengaged, color: "#ef4444", pct: Math.round((health.disengaged / health.totalContacts) * 100) },
  ];

  return (
    <motion.div variants={stagger.item} className="kf-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HeartPulse className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold">Audience Health</h3>
          <InfoBadge title="Audience Health Score" body="Measures overall engagement quality of your subscriber list. Based on open rates, click rates, bounce rates, and unsubscribe rates. Above 70% is healthy." iconSize={12} />
        </div>
        <span className="text-lg font-bold text-emerald-400">{health.healthPercentage}%</span>
      </div>

      <div className="space-y-2">
        {segments.map((s) => (
          <div key={s.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-medium">{s.count} ({s.pct}%)</span>
            </div>
            <div className="h-2 rounded-full bg-border/20 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${s.pct}%` }}
                transition={{ duration: 0.7 }}
                className="h-full rounded-full"
                style={{ backgroundColor: s.color }}
              />
            </div>
          </div>
        ))}
      </div>

      {health.recommendations.length > 0 && (
        <div className="space-y-1 pt-1">
          {health.recommendations.map((rec, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="w-3 h-3 text-blue-400 mt-0.5 shrink-0" />
              <span>{rec}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function SendTimeList({ recommendations, label }: { recommendations: SendTimeRecommendation[]; label?: string }) {
  return (
    <div className="space-y-2">
      {label && <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</p>}
      {recommendations.slice(0, 5).map((rec, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-2 rounded-lg bg-border/5 hover:bg-border/10 transition-colors"
        >
          <div className="w-6 h-6 rounded-full bg-[hsl(var(--kf-accent2))]/10 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-[hsl(var(--kf-accent2))]">#{i + 1}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{rec.dayOfWeek} &middot; {rec.timeSlot}</p>
            <p className="text-[10px] text-muted-foreground">{rec.recommendation}</p>
          </div>
          {rec.campaignCount > 0 && (
            <div className="text-right shrink-0">
              <p className="text-xs font-medium">{rec.avgOpenRate.toFixed(1)}%</p>
              <p className="text-[9px] text-muted-foreground">open rate</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function SendTimeSection({ businessId }: { businessId: string | null }) {
  const [result, setResult] = useState<SegmentSendTimeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSegments, setShowSegments] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchSendTimeRecommendations(businessId);
      if (res.data) setResult(res.data);
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="kf-card p-6 text-center">
        <RefreshCw className="w-5 h-5 text-muted-foreground animate-spin mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Analyzing send times...</p>
      </div>
    );
  }

  if (!result || result.overall.length === 0) {
    return null;
  }

  const segmentKeys = Object.keys(result.bySegment);

  return (
    <motion.div variants={stagger.item} className="kf-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
        <h3 className="text-sm font-semibold">Best Send Times</h3>
      </div>

      <SendTimeList recommendations={result.overall} label="All Audiences" />

      {segmentKeys.length > 0 && (
        <>
          <button
            onClick={() => setShowSegments(!showSegments)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {showSegments ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {segmentKeys.length} audience segment{segmentKeys.length !== 1 ? "s" : ""}
          </button>
          <AnimatePresence>
            {showSegments && segmentKeys.map((seg) => (
              <motion.div
                key={seg}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="pt-2 border-t border-border/10"
              >
                <SendTimeList recommendations={result.bySegment[seg]} label={seg} />
              </motion.div>
            ))}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  );
}

export function PreSendValidationWarnings({
  validation,
  loading,
}: {
  validation: PreSendValidationResult | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/30 border border-border/40">
        <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />
        <span className="text-xs text-muted-foreground">Checking audience quality...</span>
      </div>
    );
  }

  if (!validation) return null;

  if (validation.warnings.length === 0) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        <span className="text-xs text-emerald-400">Audience looks good! Ready to send.</span>
      </div>
    );
  }

  const severityIcon = (severity: string) => {
    switch (severity) {
      case "error": return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
      case "warning": return <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
      default: return <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
    }
  };

  const borderColor = validation.warnings.some((w) => w.severity === "error")
    ? "border-red-500/30 bg-red-500/5"
    : validation.warnings.some((w) => w.severity === "warning")
    ? "border-amber-500/30 bg-amber-500/5"
    : "border-blue-500/30 bg-blue-500/5";

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${borderColor}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-xs font-medium">Pre-Send Check</span>
      </div>
      {validation.warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-2">
          {severityIcon(w.severity)}
          <div>
            <p className="text-xs">{w.message}</p>
            {w.detail && <p className="text-[10px] text-muted-foreground mt-0.5">{w.detail}</p>}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3 pt-1 text-[10px] text-muted-foreground border-t border-border/30 mt-2">
        <span>Targeted: {validation.audienceSummary.totalTargeted}</span>
        <span>With email: {validation.audienceSummary.withEmail}</span>
        <span>Healthy: {validation.audienceSummary.healthy}</span>
      </div>
    </div>
  );
}
