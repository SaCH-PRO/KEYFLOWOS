"use client";

import { useEffect, useState, useCallback } from "react";
import { Clock, Zap, RefreshCw, AlertTriangle, CheckCircle, Info } from "lucide-react";
import { fetchActivityFeed, ActivityItem } from "@/lib/client";

const TONE_STYLES: Record<string, { icon: typeof Zap; color: string }> = {
  success: { icon: CheckCircle, color: "hsl(var(--kf-success))" },
  warning: { icon: AlertTriangle, color: "hsl(var(--kf-warning))" },
  error: { icon: AlertTriangle, color: "hsl(var(--kf-error))" },
  info: { icon: Info, color: "hsl(var(--kf-info))" },
};

interface ExecutionLogProps {
  businessId: string | null;
}

export function ExecutionLog({ businessId }: ExecutionLogProps) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    const { data } = await fetchActivityFeed(businessId, { module: "automation", limit: 50 });
    setItems(data ?? []);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const agentItems = items.length === 0 && businessId
    ? []
    : items;

  useEffect(() => {
    if (items.length === 0 && businessId && !loading) {
      fetchActivityFeed(businessId, { module: "agent", limit: 30 }).then(({ data }) => {
        if (data && data.length > 0) {
          setItems((prev) => {
            const existing = new Set(prev.map((i) => i.id));
            const merged = [...prev, ...data.filter((d) => !existing.has(d.id))];
            merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            return merged;
          });
        }
      });
    }
  }, [items.length, businessId, loading]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Recent automation and workflow execution history.
        </p>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] justify-center"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading execution log...</div>
      ) : agentItems.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card p-8 text-center">
          <div className="w-10 h-10 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
            <Clock className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <p className="text-sm font-medium mb-1">No execution history yet</p>
          <p className="text-xs text-muted-foreground">
            When your automations run, their execution details will appear here.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
          <div className="divide-y divide-border/40">
            {agentItems.map((item) => {
              const toneStyle = TONE_STYLES[item.tone ?? "info"] ?? TONE_STYLES.info;
              const ToneIcon = toneStyle.icon;
              return (
                <div key={item.id} className="px-4 py-3 flex items-start gap-3 hover:bg-muted/20 transition-colors">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: `${toneStyle.color.replace(")", " / 0.15)")}` }}
                  >
                    <ToneIcon className="w-3.5 h-3.5" style={{ color: toneStyle.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{item.title}</div>
                    {item.detail && (
                      <p className="text-[12px] text-muted-foreground mt-0.5">{item.detail}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground/60">
                      <span className="inline-flex items-center gap-1">
                        <Zap className="w-3 h-3" />
                        {item.entityType}
                      </span>
                      <span>{item.action}</span>
                      <span>{new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
