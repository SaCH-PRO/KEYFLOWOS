"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { FileText, AlertTriangle, CheckCircle2, ChevronRight, Shield, RefreshCw } from "lucide-react";

interface HealthData {
  total: number;
  current: number;
  stale: number;
  impacted: number;
  pendingReview: number;
  expired: number;
  healthScore: number;
}

export default function DocumentHealthSection({ businessId }: { businessId: string | null }) {
  const router = useRouter();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchHealth = useCallback(() => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    setError(false);
    apiGet<HealthData>(`/documents/businesses/${businessId}/health`)
      .then(({ data }) => { if (data) setHealth(data); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [businessId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchHealth is wrapped in useCallback; setState happens inside the async fetcher to mirror server data
  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-32 bg-[hsl(var(--muted))]/30 rounded" />
        <div className="h-16 bg-[hsl(var(--muted))]/20 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Document Health</h3>
        </div>
        <div className="flex items-center justify-between p-4 rounded-lg border border-[hsl(var(--kf-error))]/20 bg-[hsl(var(--kf-error))]/5">
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Unable to load document health.</p>
          <button
            type="button"
            onClick={fetchHealth}
            className="flex items-center gap-1.5 text-xs text-[hsl(var(--kf-accent1))] hover:underline min-h-[44px] px-2"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      </div>
    );
  }

  const hasIssues = health && (health.impacted > 0 || health.stale > 0 || health.pendingReview > 0);
  const score = health?.healthScore ?? 100;
  const scoreColor = score >= 80
    ? "hsl(var(--kf-success))"
    : score >= 50
      ? "hsl(var(--kf-warning))"
      : "hsl(var(--kf-error))";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Document Health</h3>
        </div>
        <button
          type="button"
          onClick={() => router.push("/app/documents")}
          className="flex items-center gap-1 text-xs text-[hsl(var(--kf-accent1))] hover:underline min-h-[44px] px-2"
        >
          View all <ChevronRight className="w-3 h-3" />
        </button>
      </div>

      {!health || health.total === 0 ? (
        <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/5">
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            No documents generated yet. Visit the{" "}
            <button type="button" onClick={() => router.push("/app/documents")} className="text-[hsl(var(--kf-accent1))] hover:underline min-h-[44px]">
              Documents hub
            </button>{" "}
            to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-4 p-3 rounded-lg border border-[hsl(var(--border))]">
            <div className="relative w-12 h-12 flex items-center justify-center flex-shrink-0">
              <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
                <circle cx="24" cy="24" r="20" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" opacity="0.2" />
                <circle
                  cx="24" cy="24" r="20" fill="none"
                  stroke={scoreColor}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 20}
                  strokeDashoffset={2 * Math.PI * 20 * (1 - score / 100)}
                />
              </svg>
              <span className="absolute text-xs font-bold" style={{ color: scoreColor }}>{score}%</span>
            </div>
            <div className="flex-1 grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-lg font-bold text-[hsl(var(--foreground))]">{health.total}</div>
                <div className="text-[10px] text-[hsl(var(--muted-foreground))]">Total</div>
              </div>
              <div>
                <div className="text-lg font-bold text-[hsl(var(--kf-success))]">{health.current}</div>
                <div className="text-[10px] text-[hsl(var(--muted-foreground))]">Current</div>
              </div>
              <div>
                <div className="text-lg font-bold" style={{ color: hasIssues ? "hsl(var(--kf-warning))" : "hsl(var(--muted-foreground))" }}>
                  {health.impacted + health.stale + health.pendingReview}
                </div>
                <div className="text-[10px] text-[hsl(var(--muted-foreground))]">Issues</div>
              </div>
            </div>
          </div>

          {hasIssues && (
            <div className="space-y-1">
              {health.impacted > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[hsl(var(--kf-error))]/8 text-xs">
                  <Shield className="w-3.5 h-3.5 text-[hsl(var(--kf-error))]" />
                  <span className="text-[hsl(var(--kf-error))]">{health.impacted} document(s) impacted by profile changes</span>
                </div>
              )}
              {health.stale > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[hsl(var(--kf-warning))]/8 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 text-[hsl(var(--kf-warning))]" />
                  <span className="text-[hsl(var(--kf-warning))]">{health.stale} document(s) may be outdated</span>
                </div>
              )}
              {health.pendingReview > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[hsl(var(--kf-warning))]/8 text-xs">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--kf-warning))]" />
                  <span className="text-[hsl(var(--kf-warning))]">{health.pendingReview} document(s) pending review</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
