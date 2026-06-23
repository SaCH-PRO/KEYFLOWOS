"use client";

import { useState } from "react";
import { Loader2, Sparkles, AlertTriangle, TrendingUp, ShieldAlert, Dna, Brain } from "lucide-react";
import {
  TemporalFlowAnalysis,
  analyzeTemporalFlow,
} from "@/lib/api/temporal-flow";
import { getStoredBusinessId } from "@/lib/workspace";

export function TemporalFlowKeyAnalysis() {
  const businessId = getStoredBusinessId() ?? "";
  const [analysis, setAnalysis] = useState<TemporalFlowAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!businessId) return;
    setLoading(true);
    const { data } = await analyzeTemporalFlow(businessId);
    if (data) setAnalysis(data);
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-500" />
          KEY Analysis
        </h3>
        <button
          onClick={run}
          disabled={loading || !businessId}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-50"
        >
          {loading && <Loader2 className="w-3 h-3 animate-spin" />}
          Analyze
        </button>
      </div>

      {!analysis && !loading && (
        <p className="text-sm text-muted-foreground">
          Run KEY Analysis to surface urgent items, opportunities, risks, and Genome evolution candidates from recent activity.
        </p>
      )}

      {analysis && (
        <div className="space-y-4">
          <div className="rounded-xl p-4 border border-border bg-card">
            <p className="text-sm">{analysis.summary}</p>
          </div>

          {analysis.urgentItems.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                Urgent Items
              </h4>
              <ul className="space-y-2">
                {analysis.urgentItems.map((item, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium">{item.title}</span>
                    {item.reason && <span className="text-muted-foreground"> — {item.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.opportunities.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                Opportunities
              </h4>
              <ul className="space-y-2">
                {analysis.opportunities.map((item, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium">{item.title}</span>
                    <ul className="list-disc list-inside text-xs text-muted-foreground mt-0.5">
                      {item.evidence.map((ev, j) => (
                        <li key={j}>{ev}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.risks.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
                Risks
              </h4>
              <ul className="space-y-2">
                {analysis.risks.map((item, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium">{item.title}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 ml-2">{item.severity}</span>
                    <ul className="list-disc list-inside text-xs text-muted-foreground mt-0.5">
                      {item.evidence.map((ev, j) => (
                        <li key={j}>{ev}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.genomeProposalCandidates.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <Dna className="w-3.5 h-3.5 text-violet-500" />
                Genome Evolution Candidates
              </h4>
              <ul className="space-y-2">
                {analysis.genomeProposalCandidates.map((item, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium capitalize">{item.section} DNA</span>
                    <span className="text-muted-foreground"> — {item.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.memoryInsights && analysis.memoryInsights.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <Brain className="w-3.5 h-3.5 text-indigo-500" />
                Memory-Backed Insights
              </h4>
              <ul className="space-y-2">
                {analysis.memoryInsights.map((item, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium">{item.title}</span>
                    <span className="text-muted-foreground"> — {item.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
