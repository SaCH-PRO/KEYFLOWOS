"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, Loader2, X, CheckCircle2, RefreshCw } from "lucide-react";
import {
  applyDataQualityFix,
  dismissDataQualityIssue,
  fetchContactDataQuality,
  type DataQualityIssue,
} from "@/lib/client";
import { toast } from "sonner";

const KIND_LABEL: Record<string, string> = {
  invalid_email: "Email needs fixing",
  invalid_phone: "Phone needs fixing",
  missing_required: "Missing required field",
  stale_data: "Stale contact",
  suspected_duplicate: "Possible duplicate",
};

function scoreColor(score: number | null | undefined) {
  if (score == null) return "text-muted-foreground bg-muted/30";
  if (score >= 85) return "text-emerald-500 bg-emerald-500/10";
  if (score >= 60) return "text-amber-500 bg-amber-500/10";
  return "text-red-500 bg-red-500/10";
}

export function DataQualityBadge({ businessId, contactId, score }: { businessId: string; contactId: string; score?: number | null }) {
  const [open, setOpen] = useState(false);
  const [issues, setIssues] = useState<DataQualityIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await fetchContactDataQuality(businessId, contactId);
      setIssues((data?.items ?? []) as DataQualityIssue[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, businessId, contactId]);

  const handleApply = async (issue: DataQualityIssue) => {
    setWorking(issue.id);
    try {
      const { data, error } = await applyDataQualityFix(businessId, issue.id);
      if (error || !data) throw new Error(error || "Could not apply fix");
      toast.success("Fix applied");
      setIssues((curr) => curr.filter((i) => i.id !== issue.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to apply fix");
    } finally {
      setWorking(null);
    }
  };

  const handleDismiss = async (issue: DataQualityIssue) => {
    setWorking(issue.id);
    try {
      const { data, error } = await dismissDataQualityIssue(businessId, issue.id);
      if (error || !data) throw new Error(error || "Could not dismiss");
      toast.success("Issue dismissed");
      setIssues((curr) => curr.filter((i) => i.id !== issue.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to dismiss");
    } finally {
      setWorking(null);
    }
  };

  const colorCls = scoreColor(score);
  const Icon = (score ?? 100) >= 85 ? ShieldCheck : ShieldAlert;
  const label = score != null ? `${score}/100` : "—";

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-border/40 ${colorCls}`}
        aria-label="Data quality"
        title="Data quality"
        data-testid="data-quality-badge"
      >
        <Icon className="w-3.5 h-3.5" />
        <span className="font-medium">{label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 z-30 rounded-lg border border-border/50 bg-background shadow-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">Data quality</span>
            <button onClick={() => setOpen(false)} aria-label="Close" className="p-1 rounded hover:bg-muted/40">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {loading && (
            <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
            </div>
          )}
          {!loading && issues.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-emerald-500 py-3">
              <CheckCircle2 className="w-4 h-4" /> No open issues. Good shape!
            </div>
          )}
          <ul className="space-y-2 max-h-72 overflow-auto">
            {issues.map((issue) => (
              <li key={issue.id} className="rounded-md border border-border/40 p-2">
                <div className="text-xs font-medium">{KIND_LABEL[issue.kind] ?? issue.kind}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{issue.message}</div>
                {issue.recommendedFix && typeof (issue.recommendedFix as { value?: unknown }).value === "string" && (
                  <div className="text-[11px] mt-1">
                    Suggested: <span className="font-mono">{String((issue.recommendedFix as { value: string }).value)}</span>
                  </div>
                )}
                <div className="flex items-center justify-end gap-1.5 mt-2">
                  <button
                    onClick={() => handleDismiss(issue)}
                    disabled={working === issue.id}
                    className="text-[11px] px-2 py-1 rounded hover:bg-muted/40 text-muted-foreground"
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={() => handleApply(issue)}
                    disabled={working === issue.id}
                    className="text-[11px] px-2 py-1 rounded bg-[hsl(var(--kf-accent2))]/10 text-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/20 inline-flex items-center gap-1"
                  >
                    {working === issue.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    Apply fix
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
