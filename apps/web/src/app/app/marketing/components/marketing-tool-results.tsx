"use client";

import {
  TrendingUp,
  TrendingDown,
  Minus,
  Lightbulb,
  Target,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Mail,
  Users,
  Zap,
  ClipboardList,
  Star,
} from "lucide-react";
import { useState } from "react";
import type {
  MarketingAiSearchResult,
  MarketingAiContentResult,
  MarketingAiPerformanceResult,
  MarketingAiAudienceResult,
  MarketingAiSubjectLineResult,
  MarketingAiFormOptimizerResult,
} from "@/lib/client";

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

const PRIORITY_COLORS: Record<string, string> = {
  high: "text-red-400",
  medium: "text-amber-400",
  low: "text-blue-400",
};

const IMPACT_COLORS: Record<string, string> = {
  high: "bg-red-500/10 text-red-400 border-red-500/30",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  low: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
};

function ImpactBadge({ impact }: { impact: string }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${IMPACT_COLORS[impact] ?? IMPACT_COLORS.medium}`}>
      {impact}
    </span>
  );
}

function NlSearchRenderer({ data }: { data: MarketingAiSearchResult }) {
  const results = data.results ?? [];
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-muted-foreground">{data.interpretation}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-muted-foreground">
            {data.type}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </span>
          {data.confidence !== undefined && (
            <span className={`text-[10px] font-medium ${
              data.confidence >= 0.7 ? "text-emerald-400" :
              data.confidence >= 0.4 ? "text-amber-400" : "text-red-400"
            }`}>
              {Math.round(data.confidence * 100)}% confidence
            </span>
          )}
        </div>
      </div>
      {results.length > 0 ? (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {results.slice(0, 20).map((r: Record<string, any>, i: number) => {
            const name = r.name || r.subject || "Untitled";
            const status = r.status || (r.isActive !== undefined ? (r.isActive ? "ACTIVE" : "INACTIVE") : "");
            return (
              <div key={i} className="text-xs p-2 rounded-lg bg-white/[0.02] border border-border/30 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{name}</span>
                  {status && (
                    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      status === "SENT" ? "bg-blue-500/15 text-blue-300" :
                      status === "DRAFT" ? "bg-muted text-muted-foreground" :
                      status === "SCHEDULED" ? "bg-amber-500/15 text-amber-300" :
                      status === "ACTIVE" ? "bg-emerald-500/15 text-emerald-300" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {status}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-4">
          <Mail className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-xs text-muted-foreground">No results found</p>
        </div>
      )}
    </div>
  );
}

function CampaignContentRenderer({ data }: { data: MarketingAiContentResult }) {
  if (!data) return null;
  return (
    <div className="space-y-2.5">
      {data.summary && (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{data.summary}</p>
      )}
      {data.subjectLines?.length > 0 && (
        <Section title="Subject Line Options">
          <div className="space-y-1.5">
            {data.subjectLines.map((s, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-border/30">
                <div className="flex items-center gap-2">
                  <Mail className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
                  <span className="text-[11px] font-medium text-foreground/80">{s.text}</span>
                </div>
                {s.predictedOpenRate !== undefined && (
                  <span className="text-[10px] text-emerald-400">{Math.round(s.predictedOpenRate * 100)}% open rate</span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.bodyContent && (
        <Section title="Email Body">
          <div className="rounded-lg border border-border/30 p-3 bg-white/[0.02]">
            <p className="text-[11px] text-foreground/80 whitespace-pre-wrap leading-relaxed">{data.bodyContent}</p>
          </div>
        </Section>
      )}
      {data.ctas?.length > 0 && (
        <Section title="Call-to-Action Options">
          <div className="flex flex-wrap gap-2">
            {data.ctas.map((cta, i) => (
              <div key={i} className="px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/20">
                <span className="text-[11px] font-medium text-[hsl(var(--kf-accent1))]">{cta.text}</span>
                <span className="text-[10px] text-muted-foreground/50 ml-2">{cta.style}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function PerformanceAnalyzerRenderer({ data }: { data: MarketingAiPerformanceResult }) {
  if (!data) return null;
  return (
    <div className="space-y-2.5">
      {data.summary && (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{data.summary}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <span className="text-[10px] text-muted-foreground/50 block">Open Rate</span>
          <span className={`text-lg font-bold ${data.openRate >= 0.2 ? "text-emerald-400" : data.openRate >= 0.1 ? "text-amber-400" : "text-red-400"}`}>
            {Math.round(data.openRate * 100)}%
          </span>
        </div>
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <span className="text-[10px] text-muted-foreground/50 block">Click Rate</span>
          <span className={`text-lg font-bold ${data.clickRate >= 0.05 ? "text-emerald-400" : data.clickRate >= 0.02 ? "text-amber-400" : "text-red-400"}`}>
            {Math.round(data.clickRate * 100)}%
          </span>
        </div>
      </div>
      {data.trends?.length > 0 && (
        <Section title="Trends">
          <div className="space-y-1.5">
            {data.trends.map((t, i) => {
              const Icon = t.direction === "up" ? TrendingUp : t.direction === "down" ? TrendingDown : Minus;
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
      {data.recommendations?.length > 0 && (
        <Section title="Recommendations">
          <div className="space-y-1.5">
            {data.recommendations.map((r, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <Lightbulb className={`w-3 h-3 shrink-0 mt-0.5 ${PRIORITY_COLORS[r.priority] || "text-amber-400"}`} />
                <div>
                  <span className="text-[11px] font-medium text-foreground/80">{r.title}</span>
                  <p className="text-[10px] text-muted-foreground/60">{r.description}</p>
                  {r.expectedImpact && (
                    <span className="text-[10px] text-emerald-400">Impact: {r.expectedImpact}</span>
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

function AudienceAdvisorRenderer({ data }: { data: MarketingAiAudienceResult }) {
  if (!data) return null;
  return (
    <div className="space-y-2.5">
      {data.summary && (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{data.summary}</p>
      )}
      {data.segments?.length > 0 && (
        <Section title="Recommended Segments">
          <div className="space-y-1.5">
            {data.segments.map((s, i) => (
              <div key={i} className="p-2 rounded-lg bg-white/[0.02] border border-border/30">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Users className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
                    <span className="text-[11px] font-medium text-foreground/80">{s.name}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/50">{s.size} contacts</span>
                </div>
                <p className="text-[10px] text-muted-foreground/60">{s.description}</p>
                <div className="mt-1">
                  <span className="text-[10px] text-emerald-400">Predicted engagement: {Math.round(s.predictedEngagement * 100)}%</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.recommendations?.length > 0 && (
        <Section title="Recommendations">
          <div className="space-y-1.5">
            {data.recommendations.map((r, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <Target className={`w-3 h-3 shrink-0 mt-0.5 ${PRIORITY_COLORS[r.priority] || "text-amber-400"}`} />
                <div>
                  <span className="text-[11px] font-medium text-foreground/80">{r.title}</span>
                  <p className="text-[10px] text-muted-foreground/60">{r.description}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function SubjectLineOptimizerRenderer({ data }: { data: MarketingAiSubjectLineResult }) {
  if (!data) return null;
  return (
    <div className="space-y-2.5">
      {data.original && (
        <div className="px-3 py-2 rounded-lg bg-white/[0.02] border border-border/30">
          <span className="text-[10px] text-muted-foreground/50 block">Original</span>
          <span className="text-[11px] text-foreground/80">{data.original}</span>
        </div>
      )}
      {data.bestPick && (
        <div className="px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <div className="flex items-center gap-1.5 mb-1">
            <Star className="w-3 h-3 text-emerald-400" />
            <span className="text-[10px] text-emerald-400 font-medium">Best Pick</span>
          </div>
          <span className="text-[11px] font-medium text-foreground/80">{data.bestPick}</span>
        </div>
      )}
      {data.variations?.length > 0 && (
        <Section title="Variations">
          <div className="space-y-1.5">
            {data.variations.map((v, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-border/30">
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] font-medium text-foreground/80">{v.text}</span>
                  <span className="text-[10px] text-muted-foreground/50 ml-2">{v.style}</span>
                </div>
                <span className={`text-[10px] font-medium ml-2 shrink-0 ${v.predictedOpenRate >= 0.25 ? "text-emerald-400" : v.predictedOpenRate >= 0.15 ? "text-amber-400" : "text-red-400"}`}>
                  {Math.round(v.predictedOpenRate * 100)}%
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.tips?.length > 0 && (
        <Section title="Tips">
          <div className="space-y-1">
            {data.tips.map((tip, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <Lightbulb className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                <span className="text-[11px] text-muted-foreground/70">{tip}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function FormOptimizerRenderer({ data }: { data: MarketingAiFormOptimizerResult }) {
  if (!data) return null;
  const convColor = data.conversionRate >= 0.3 ? "text-emerald-400" : data.conversionRate >= 0.15 ? "text-amber-400" : "text-red-400";
  return (
    <div className="space-y-2.5">
      {data.summary && (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{data.summary}</p>
      )}
      <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
        <span className="text-[10px] text-muted-foreground/50 block">Conversion Rate</span>
        <span className={`text-lg font-bold ${convColor}`}>{Math.round(data.conversionRate * 100)}%</span>
      </div>
      {data.fieldAnalysis?.length > 0 && (
        <Section title="Field Analysis">
          <div className="space-y-1.5">
            {data.fieldAnalysis.map((f, i) => (
              <div key={i} className="p-2 rounded-lg bg-white/[0.02] border border-border/30">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
                    <span className="text-[11px] font-medium text-foreground/80">{f.field}</span>
                  </div>
                  <ImpactBadge impact={f.impact} />
                </div>
                {f.issue && (
                  <div className="flex items-start gap-1.5 mt-1">
                    <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                    <span className="text-[10px] text-amber-400">{f.issue}</span>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{f.suggestion}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.recommendations?.length > 0 && (
        <Section title="Recommendations">
          <div className="space-y-1.5">
            {data.recommendations.map((r, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <Zap className={`w-3 h-3 shrink-0 mt-0.5 ${PRIORITY_COLORS[r.priority] || "text-amber-400"}`} />
                <div>
                  <span className="text-[11px] font-medium text-foreground/80">{r.title}</span>
                  <p className="text-[10px] text-muted-foreground/60">{r.description}</p>
                  {r.expectedImpact && (
                    <span className="text-[10px] text-emerald-400">Impact: {r.expectedImpact}</span>
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

export function renderMarketingToolResult(toolId: string, result: unknown): React.ReactNode {
  if (!result) return null;

  switch (toolId) {
    case "marketing-nl-search":
      return <NlSearchRenderer data={result as MarketingAiSearchResult} />;
    case "campaign-content-generator":
      return <CampaignContentRenderer data={result as MarketingAiContentResult} />;
    case "campaign-performance":
      return <PerformanceAnalyzerRenderer data={result as MarketingAiPerformanceResult} />;
    case "audience-advisor":
      return <AudienceAdvisorRenderer data={result as MarketingAiAudienceResult} />;
    case "subject-line-optimizer":
      return <SubjectLineOptimizerRenderer data={result as MarketingAiSubjectLineResult} />;
    case "lead-form-optimizer":
      return <FormOptimizerRenderer data={result as MarketingAiFormOptimizerResult} />;
    default:
      return (
        <pre className="text-xs text-muted-foreground whitespace-pre-wrap max-h-64 overflow-y-auto">
          {JSON.stringify(result, null, 2)}
        </pre>
      );
  }
}
