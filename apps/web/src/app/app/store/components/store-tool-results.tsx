"use client";

import {
  Lightbulb, AlertTriangle,
  ChevronDown, ChevronUp,
  CheckCircle, XCircle,
  Zap, Search, DollarSign,
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

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const color = score >= 80 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-red-400";
  const bgColor = score >= 80 ? "bg-emerald-500/10" : score >= 50 ? "bg-amber-500/10" : "bg-red-500/10";
  return (
    <div className={`p-3 rounded-xl ${bgColor} border border-border/30 text-center`}>
      <span className="text-[10px] text-muted-foreground/50 block">{label}</span>
      <span className={`text-2xl font-bold ${color}`}>{score}</span>
      <span className="text-[10px] text-muted-foreground/50">/100</span>
    </div>
  );
}

function Recommendations({ recommendations }: { recommendations: any[] }) {
  if (!recommendations?.length) return null;
  return (
    <Section title="Recommendations">
      <div className="space-y-1.5">
        {recommendations.map((r: any, i: number) => (
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
  );
}

type StoreOptimizerResult = {
  summary: string;
  score: number;
  totalItems: number;
  testimonialCount: number;
  recommendations: any[];
};

function StoreOptimizerRenderer({ data }: { data: StoreOptimizerResult }) {
  if (!data) return null;
  return (
    <div className="space-y-2.5">
      {data.summary && (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{data.summary}</p>
      )}
      <div className="grid grid-cols-3 gap-2">
        <ScoreGauge score={data.score} label="Health Score" />
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <span className="text-[10px] text-muted-foreground/50 block">Catalog</span>
          <span className="text-lg font-bold text-foreground/80">{data.totalItems}</span>
          <span className="text-[10px] text-muted-foreground/50 block">items</span>
        </div>
        <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
          <span className="text-[10px] text-muted-foreground/50 block">Reviews</span>
          <span className="text-lg font-bold text-foreground/80">{data.testimonialCount}</span>
          <span className="text-[10px] text-muted-foreground/50 block">total</span>
        </div>
      </div>
      <Recommendations recommendations={data.recommendations} />
    </div>
  );
}

type SeoAdvisorResult = {
  summary: string;
  issues: { field: string; issue: string; suggestion: string; impact: string }[];
  tips: string[];
};

function SeoAdvisorRenderer({ data }: { data: SeoAdvisorResult }) {
  if (!data) return null;
  return (
    <div className="space-y-2.5">
      {data.summary && (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{data.summary}</p>
      )}
      {data.issues?.length > 0 && (
        <Section title="SEO Issues">
          <div className="space-y-1.5">
            {data.issues.map((issue, i) => (
              <div key={i} className="p-2 rounded-lg bg-white/[0.02] border border-border/30">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Search className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
                    <span className="text-[11px] font-medium text-foreground/80">{issue.field}</span>
                  </div>
                  <ImpactBadge impact={issue.impact} />
                </div>
                {issue.issue && (
                  <div className="flex items-start gap-1.5 mt-1">
                    <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                    <span className="text-[10px] text-amber-400">{issue.issue}</span>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{issue.suggestion}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.tips?.length > 0 && (
        <Section title="SEO Tips">
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

type PricingAdvisorResult = {
  summary: string;
  avgPrice?: number;
  minPrice?: number;
  maxPrice?: number;
  totalProducts?: number;
  pricedCount?: number;
  recommendations: any[];
};

function PricingAdvisorRenderer({ data }: { data: PricingAdvisorResult }) {
  if (!data) return null;
  return (
    <div className="space-y-2.5">
      {data.summary && (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{data.summary}</p>
      )}
      {data.avgPrice !== undefined && (
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
            <span className="text-[10px] text-muted-foreground/50 block">Avg Price</span>
            <span className="text-lg font-bold text-foreground/80">${data.avgPrice.toFixed(0)}</span>
          </div>
          <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
            <span className="text-[10px] text-muted-foreground/50 block">Min</span>
            <span className="text-lg font-bold text-emerald-400">${data.minPrice?.toFixed(0)}</span>
          </div>
          <div className="p-2 rounded-lg bg-white/[0.02] border border-border/30 text-center">
            <span className="text-[10px] text-muted-foreground/50 block">Max</span>
            <span className="text-lg font-bold text-[hsl(var(--kf-accent1))]">${data.maxPrice?.toFixed(0)}</span>
          </div>
        </div>
      )}
      {data.pricedCount !== undefined && data.totalProducts !== undefined && data.pricedCount < data.totalProducts && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
          <DollarSign className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-[11px] text-amber-400">
            {data.totalProducts - data.pricedCount} of {data.totalProducts} products have no price set
          </span>
        </div>
      )}
      <Recommendations recommendations={data.recommendations} />
    </div>
  );
}

type StorefrontAnalyzerResult = {
  summary: string;
  conversionScore: number;
  checks: { label: string; passed: boolean }[];
  frictionPoints: any[];
  recommendations: any[];
};

function StorefrontAnalyzerRenderer({ data }: { data: StorefrontAnalyzerResult }) {
  if (!data) return null;
  return (
    <div className="space-y-2.5">
      {data.summary && (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{data.summary}</p>
      )}
      <ScoreGauge score={data.conversionScore} label="Conversion Readiness" />
      {data.checks?.length > 0 && (
        <Section title="Conversion Checklist">
          <div className="space-y-1">
            {data.checks.map((check, i) => (
              <div key={i} className="flex items-center gap-2 py-1">
                {check.passed ? (
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                )}
                <span className={`text-[11px] ${check.passed ? "text-foreground/70" : "text-foreground/80 font-medium"}`}>
                  {check.label}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.frictionPoints?.length > 0 && (
        <Section title="Friction Points">
          <div className="space-y-1.5">
            {data.frictionPoints.map((fp: any, i: number) => (
              <div key={i} className="p-2 rounded-lg bg-white/[0.02] border border-border/30">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Zap className="w-3 h-3 text-amber-400" />
                    <span className="text-[11px] font-medium text-foreground/80">{fp.area}</span>
                  </div>
                  <ImpactBadge impact={fp.impact} />
                </div>
                <p className="text-[10px] text-muted-foreground/60">{fp.suggestion}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
      <Recommendations recommendations={data.recommendations} />
    </div>
  );
}

export function renderStoreToolResult(toolId: string, result: unknown): React.ReactNode {
  if (!result) return null;

  switch (toolId) {
    case "store-optimizer":
      return <StoreOptimizerRenderer data={result as StoreOptimizerResult} />;
    case "seo-advisor":
      return <SeoAdvisorRenderer data={result as SeoAdvisorResult} />;
    case "pricing-advisor":
      return <PricingAdvisorRenderer data={result as PricingAdvisorResult} />;
    case "storefront-analyzer":
      return <StorefrontAnalyzerRenderer data={result as StorefrontAnalyzerResult} />;
    default:
      return (
        <pre className="text-xs text-muted-foreground whitespace-pre-wrap max-h-64 overflow-y-auto">
          {JSON.stringify(result, null, 2)}
        </pre>
      );
  }
}
