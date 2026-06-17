"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Inbox, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPostSimple } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { Button, Card, Badge } from "@keyflow/ui";
import { BriefMetrics } from "./components/brief-metrics";

interface KeyInboxInsight {
  id: string;
  businessId: string;
  periodStart: string;
  periodEnd: string;
  scope: "DAILY" | "WEEKLY" | "CUSTOM";
  channel: string | null;
  summary: string;
  keyFindings: unknown[];
  recommendations: unknown[];
  taskSuggestions: unknown[];
  metrics: Record<string, number>;
  createdAt: string;
}

type Scope = "DAILY" | "WEEKLY";

const SCOPE_LABELS: Record<Scope, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
};

function toStringList(items: unknown[]): string[] {
  return items.filter((item): item is string => typeof item === "string");
}

function formatPeriod(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const startStr = s.toLocaleDateString(undefined, options);
  const endStr = e.toLocaleDateString(undefined, options);
  return `${startStr} – ${endStr}`;
}

export default function KeyInboxBriefPage() {
  const businessId = getStoredBusinessId();
  const [scope, setScope] = useState<Scope>("DAILY");
  const [brief, setBrief] = useState<KeyInboxInsight | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const fetchBrief = async (signal?: AbortSignal) => {
    if (!businessId) return;
    setLoading(true);
    const res = await apiGet<KeyInboxInsight>(
      `/key-inbox/businesses/${encodeURIComponent(businessId)}/brief?scope=${scope}`,
      { signal },
    );
    if (signal?.aborted) return;
    if (res.error) {
      toast.error(res.error);
      setBrief(null);
    } else {
      setBrief(res.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchBrief(controller.signal);
    return () => controller.abort();
  }, [businessId, scope]);

  const handleGenerate = async () => {
    if (!businessId) return;
    setGenerating(true);
    const res = await apiPostSimple<KeyInboxInsight>(
      `/key-inbox/businesses/${encodeURIComponent(businessId)}/brief/generate`,
      { scope },
    );
    if (res.error) {
      toast.error(res.error);
    } else {
      setBrief(res.data);
      toast.success(`${SCOPE_LABELS[scope]} brief refreshed`);
    }
    setGenerating(false);
  };

  const findings = useMemo(() => (brief ? toStringList(brief.keyFindings) : []), [brief]);
  const recommendations = useMemo(() => (brief ? toStringList(brief.recommendations) : []), [brief]);
  const tasks = useMemo(() => (brief ? toStringList(brief.taskSuggestions) : []), [brief]);

  if (!businessId) {
    return (
      <div className="max-w-5xl mx-auto p-4">
        <p className="text-sm text-muted-foreground">No active business — pick a workspace first.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-violet-500/20 to-rose-500/20 border border-border/40 flex items-center justify-center">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">KEYInbox Brief</h1>
            <p className="text-xs text-muted-foreground">
              Daily and weekly intelligence from your unified inbox.
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="inline-flex items-center rounded-lg border border-border/40 bg-muted/30 p-0.5">
          {(["DAILY", "WEEKLY"] as Scope[]).map((s) => (
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

        <Button
          size="sm"
          onClick={handleGenerate}
          disabled={generating || loading}
          className="gap-1.5"
        >
          {generating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          Refresh brief
        </Button>
      </div>

      {/* Loading skeleton */}
      {loading && !brief && (
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
      {!loading && !brief && (
        <Card variant="glass" padding="lg" className="text-center">
          <Sparkles className="w-8 h-8 mx-auto text-muted-foreground/50 mb-3" />
          <h3 className="text-sm font-medium">No brief available yet.</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Generate your first {SCOPE_LABELS[scope].toLowerCase()} inbox brief.
          </p>
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={generating}
            className="mt-4 gap-1.5"
          >
            {generating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            Generate {SCOPE_LABELS[scope]} brief
          </Button>
        </Card>
      )}

      {/* Brief content */}
      {brief && !loading && (
        <div className="space-y-5">
          {/* Summary card */}
          <Card variant="glass" padding="lg">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Badge tone="info">{(SCOPE_LABELS as Record<string, string>)[brief.scope] ?? brief.scope}</Badge>
              <span className="text-xs text-muted-foreground">{formatPeriod(brief.periodStart, brief.periodEnd)}</span>
            </div>
            <p className="text-sm leading-relaxed">{brief.summary}</p>
          </Card>

          {/* Metrics */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Metrics</h3>
            <BriefMetrics metrics={brief.metrics} />
          </div>

          {/* Key findings */}
          {findings.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key findings</h3>
              <Card variant="glass" padding="md">
                <ul className="space-y-2">
                  {findings.map((item, idx) => (
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
          {recommendations.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recommendations</h3>
              <Card variant="glass" padding="md">
                <ul className="space-y-2">
                  {recommendations.map((item, idx) => (
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
          {tasks.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggested tasks</h3>
              <Card variant="glass" padding="md">
                <ul className="space-y-2">
                  {tasks.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--kf-accent1))] shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
