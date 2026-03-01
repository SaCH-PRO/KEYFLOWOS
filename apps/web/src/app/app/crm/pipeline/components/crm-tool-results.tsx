"use client";

import {
  Heart, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Minus,
  Lightbulb, Target, Shield, MessageSquare, Tags, ShieldAlert,
  ChevronDown, ChevronUp, Brain, Clock, FileText,
} from "lucide-react";
import { useState } from "react";

const SENTIMENT_ICONS: Record<string, typeof Heart> = {
  positive: CheckCircle,
  neutral: Minus,
  negative: TrendingDown,
  at_risk: AlertTriangle,
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "text-emerald-400",
  neutral: "text-blue-400",
  negative: "text-red-400",
  at_risk: "text-amber-400",
};

const HEALTH_COLORS: Record<string, string> = {
  strong: "text-emerald-400",
  good: "text-green-400",
  neutral: "text-blue-400",
  weak: "text-amber-400",
  critical: "text-red-400",
};

const SCORE_CONFIG: Record<string, { color: string; bg: string }> = {
  Hot: { color: "text-red-400", bg: "bg-red-500/10" },
  Warm: { color: "text-orange-400", bg: "bg-orange-500/10" },
  Neutral: { color: "text-blue-400", bg: "bg-blue-500/10" },
  Cool: { color: "text-cyan-400", bg: "bg-cyan-500/10" },
  Cold: { color: "text-slate-400", bg: "bg-slate-500/10" },
};

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

function SummaryResult({ data }: { data: any }) {
  if (!data) return null;
  const SentIcon = SENTIMENT_ICONS[data.sentiment] || Minus;
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <SentIcon className={`w-3.5 h-3.5 ${SENTIMENT_COLORS[data.sentiment] || "text-muted-foreground"}`} />
          <span className={`text-xs font-medium ${SENTIMENT_COLORS[data.sentiment] || "text-muted-foreground"}`}>
            {data.sentiment?.replace("_", " ")}
          </span>
        </div>
        {data.relationshipHealth && (
          <span className={`text-xs ${HEALTH_COLORS[data.relationshipHealth] || "text-muted-foreground"}`}>
            Health: {data.relationshipHealth}
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{data.summary}</p>
      {data.keyInsights?.length > 0 && (
        <Section title="Key Insights">
          <ul className="space-y-1">
            {data.keyInsights.map((i: string, idx: number) => (
              <li key={idx} className="flex items-start gap-1.5">
                <Lightbulb className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                <span className="text-[11px] text-muted-foreground/70">{i}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {data.recommendedAction && (
        <div className="px-3 py-2 rounded-lg bg-[hsl(var(--kf-accent1))]/5 border border-[hsl(var(--kf-accent1))]/20">
          <span className="text-[11px] text-[hsl(var(--kf-accent1))]">{data.recommendedAction}</span>
        </div>
      )}
    </div>
  );
}

function LeadScoreResult({ data }: { data: any }) {
  if (!data) return null;
  const cfg = SCORE_CONFIG[data.label] || SCORE_CONFIG.Neutral;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <div className="relative w-16 h-16">
          <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" className="text-white/5" strokeWidth="4" />
            <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" className={cfg.color} strokeWidth="4"
              strokeDasharray={`${(data.score / 100) * 176} 176`} strokeLinecap="round" />
          </svg>
          <span className={`absolute inset-0 flex items-center justify-center text-lg font-bold ${cfg.color}`}>
            {data.score}
          </span>
        </div>
        <div>
          <span className={`text-sm font-semibold ${cfg.color}`}>{data.label}</span>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">{data.reasoning}</p>
        </div>
      </div>
      {data.factors?.length > 0 && (
        <Section title="Score Factors">
          <div className="space-y-1.5">
            {data.factors.map((f: any, i: number) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground/70">{f.factor}</span>
                <div className="flex items-center gap-1.5">
                  {f.impact === "positive" ? <TrendingUp className="w-3 h-3 text-emerald-400" /> :
                    f.impact === "negative" ? <TrendingDown className="w-3 h-3 text-red-400" /> :
                    <Minus className="w-3 h-3 text-muted-foreground/50" />}
                  <span className="text-[10px] text-muted-foreground/50">w:{f.weight}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function PrepBriefResult({ data }: { data: any }) {
  if (!data) return null;
  return (
    <div className="space-y-2.5">
      {data.relationshipHealth && (
        <div className="flex items-center gap-2 mb-2">
          <Heart className={`w-3.5 h-3.5 ${HEALTH_COLORS[data.relationshipHealth] || "text-muted-foreground"}`} />
          <span className={`text-xs font-medium ${HEALTH_COLORS[data.relationshipHealth] || "text-muted-foreground"}`}>
            {data.relationshipHealth} relationship
          </span>
        </div>
      )}
      {data.keyInfo?.length > 0 && (
        <Section title="Key Info">
          <ul className="space-y-1">
            {data.keyInfo.map((i: string, idx: number) => (
              <li key={idx} className="text-[11px] text-muted-foreground/70 flex items-start gap-1.5">
                <FileText className="w-3 h-3 text-blue-400 shrink-0 mt-0.5" />
                {i}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {data.talkingPoints?.length > 0 && (
        <Section title="Talking Points">
          <ul className="space-y-1">
            {data.talkingPoints.map((p: string, idx: number) => (
              <li key={idx} className="text-[11px] text-muted-foreground/70 flex items-start gap-1.5">
                <MessageSquare className="w-3 h-3 text-[hsl(var(--kf-accent1))] shrink-0 mt-0.5" />
                {p}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {data.icebreakers?.length > 0 && (
        <Section title="Icebreakers">
          <ul className="space-y-1">
            {data.icebreakers.map((i: string, idx: number) => (
              <li key={idx} className="text-[11px] text-muted-foreground/70">"{i}"</li>
            ))}
          </ul>
        </Section>
      )}
      {data.thingsToAvoid?.length > 0 && (
        <Section title="Avoid">
          <ul className="space-y-1">
            {data.thingsToAvoid.map((a: string, idx: number) => (
              <li key={idx} className="text-[11px] text-red-400/70 flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                {a}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function TagSuggestionsResult({ data }: { data: any }) {
  if (!data?.suggestedTags) return null;
  return (
    <div className="space-y-2">
      {data.suggestedTags.map((tag: any, i: number) => (
        <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-border/30">
          <div className="flex items-center gap-2">
            <Tags className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
            <span className="text-xs font-medium text-foreground/80">{tag.tag}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground/50">{tag.reason}</span>
            <span className={`text-[10px] font-medium ${tag.confidence >= 0.8 ? "text-emerald-400" : tag.confidence >= 0.6 ? "text-blue-400" : "text-amber-400"}`}>
              {Math.round(tag.confidence * 100)}%
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ChurnDetectionResult({ data }: { data: any }) {
  if (!data) return null;
  const RISK_COLORS: Record<string, string> = {
    critical: "text-red-400",
    high: "text-amber-400",
    medium: "text-yellow-400",
  };
  return (
    <div className="space-y-2.5">
      {data.summary && (
        <p className="text-[11px] text-muted-foreground/70">{data.summary}</p>
      )}
      {data.estimatedRevenueLoss && (
        <div className="px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20">
          <span className="text-xs text-red-400">Estimated revenue at risk: ${data.estimatedRevenueLoss}</span>
        </div>
      )}
      {data.atRiskContacts?.length > 0 && (
        <Section title={`At-Risk Contacts (${data.atRiskContacts.length})`}>
          <div className="space-y-2">
            {data.atRiskContacts.map((c: any, i: number) => (
              <div key={i} className="p-2 rounded-lg border border-border/30 bg-white/[0.02]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground/80">{c.name}</span>
                  <span className={`text-[10px] font-bold ${RISK_COLORS[c.riskLevel] || "text-muted-foreground"}`}>
                    {c.probability}% risk
                  </span>
                </div>
                {c.reasons?.length > 0 && (
                  <ul className="space-y-0.5">
                    {c.reasons.slice(0, 3).map((r: string, ri: number) => (
                      <li key={ri} className="text-[10px] text-muted-foreground/60">• {r}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function AnalysisResult({ data }: { data: any }) {
  if (!data) return null;
  return (
    <div className="space-y-2.5">
      {data.analysis && (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{data.analysis}</p>
      )}
      {data.suggestedActions?.length > 0 && (
        <Section title="Recommended Actions">
          <div className="space-y-1.5">
            {data.suggestedActions.map((a: any, i: number) => (
              <div key={i} className="flex items-start gap-1.5">
                <Target className="w-3 h-3 text-[hsl(var(--kf-accent1))] shrink-0 mt-0.5" />
                <div>
                  <span className="text-[11px] font-medium text-foreground/80">{a.title || a.description}</span>
                  {a.description && a.title && (
                    <p className="text-[10px] text-muted-foreground/60">{a.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.guidelines?.length > 0 && (
        <Section title="Guidelines">
          <ul className="space-y-1">
            {data.guidelines.map((g: string, i: number) => (
              <li key={i} className="text-[11px] text-muted-foreground/70 flex items-start gap-1.5">
                <Lightbulb className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                {g}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

export function renderCrmToolResult(toolId: string, result: unknown): React.ReactNode {
  switch (toolId) {
    case "contact-summary":
      return <SummaryResult data={result} />;
    case "lead-score":
      return <LeadScoreResult data={result} />;
    case "prep-brief":
      return <PrepBriefResult data={result} />;
    case "tag-suggestions":
      return <TagSuggestionsResult data={result} />;
    case "churn-detection":
      return <ChurnDetectionResult data={result} />;
    case "crm-analysis":
      return <AnalysisResult data={result} />;
    default:
      return (
        <div className="rounded-xl border border-border/40 p-3 bg-white/[0.02]">
          <pre className="text-[11px] text-muted-foreground/70 whitespace-pre-wrap overflow-auto max-h-[300px]">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      );
  }
}
