"use client";

import { useEffect, useState, useCallback } from "react";
import { BarChart3, Loader2, RefreshCw, MessageSquare, Zap, MousePointer, ThumbsUp, ThumbsDown } from "lucide-react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

interface FeedbackItem {
  id: string;
  module: string | null;
  page: string | null;
  feedbackType: string;
  rating: number | null;
  message: string | null;
  status: string;
  createdAt: string;
}

interface AiQualityItem {
  id: string;
  module: string | null;
  signalType: string;
  rating: number | null;
  comment: string | null;
  createdAt: string;
}

interface EventItem {
  id: string;
  eventName: string;
  module: string | null;
  entityType: string | null;
  createdAt: string;
}

export default function InsightsPage() {
  const businessId = getStoredBusinessId();
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [aiQuality, setAiQuality] = useState<AiQualityItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [fRes, aRes, eRes] = await Promise.all([
        apiGet<{ items: FeedbackItem[]; total: number }>(`/analytics/businesses/${businessId}/feedback?limit=20`),
        apiGet<{ items: AiQualityItem[]; total: number }>(`/analytics/businesses/${businessId}/ai-quality?limit=20`),
        apiGet<{ items: EventItem[]; total: number }>(`/analytics/businesses/${businessId}/events?limit=20`),
      ]);
      setFeedback(fRes.data?.items ?? []);
      setAiQuality(aRes.data?.items ?? []);
      setEvents(eRes.data?.items ?? []);
    } catch (err) {
      toast.error("Failed to load insights");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  const avgRating =
    feedback.length > 0
      ? (
          feedback.reduce((sum, f) => sum + (f.rating ?? 0), 0) /
          feedback.filter((f) => f.rating !== null).length
        ).toFixed(1)
      : "—";

  const aiAvgRating =
    aiQuality.length > 0
      ? (
          aiQuality.reduce((sum, a) => sum + (a.rating ?? 0), 0) /
          aiQuality.filter((a) => a.rating !== null).length
        ).toFixed(1)
      : "—";

  return (
    <div className="space-y-6 max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center text-white shadow">
            <BarChart3 className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Product Insights</h2>
            <p className="text-xs text-muted-foreground">
              User feedback, AI quality signals, and product events.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-md border border-border/60 bg-background text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-border/50 bg-card/40 p-4 text-center">
          <div className="text-2xl font-semibold">{feedback.length}</div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-1">Feedback</div>
        </div>
        <div className="rounded-2xl border border-border/50 bg-card/40 p-4 text-center">
          <div className="text-2xl font-semibold">{avgRating}</div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-1">Avg Rating</div>
        </div>
        <div className="rounded-2xl border border-border/50 bg-card/40 p-4 text-center">
          <div className="text-2xl font-semibold">{aiQuality.length}</div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-1">AI Signals</div>
        </div>
        <div className="rounded-2xl border border-border/50 bg-card/40 p-4 text-center">
          <div className="text-2xl font-semibold">{events.length}</div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-1">Events</div>
        </div>
      </div>

      {/* Feedback */}
      <div className="rounded-2xl border border-border/50 bg-card/40 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Recent Feedback</h3>
        </div>
        {feedback.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No feedback yet.</p>
        ) : (
          <div className="space-y-2">
            {feedback.map((f) => (
              <div key={f.id} className="flex items-start gap-3 p-3 rounded-xl border border-border/30 bg-background/50">
                {f.rating && f.rating >= 3 ? (
                  <ThumbsUp className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : f.rating && f.rating < 3 ? (
                  <ThumbsDown className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                ) : (
                  <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium capitalize">{f.feedbackType}</span>
                    {f.module && <span className="text-[10px] text-muted-foreground">{f.module}</span>}
                    {f.rating !== null && (
                      <span className="text-[10px] font-medium">{f.rating}/5</span>
                    )}
                  </div>
                  {f.message && <p className="text-xs text-muted-foreground mt-1">{f.message}</p>}
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {new Date(f.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Quality */}
      <div className="rounded-2xl border border-border/50 bg-card/40 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">AI Quality Signals</h3>
          <span className="ml-auto text-xs text-muted-foreground">Avg: {aiAvgRating}</span>
        </div>
        {aiQuality.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No AI quality signals yet.</p>
        ) : (
          <div className="space-y-2">
            {aiQuality.map((a) => (
              <div key={a.id} className="flex items-start gap-3 p-3 rounded-xl border border-border/30 bg-background/50">
                <Zap className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium capitalize">{a.signalType}</span>
                    {a.module && <span className="text-[10px] text-muted-foreground">{a.module}</span>}
                    {a.rating !== null && (
                      <span className="text-[10px] font-medium">{a.rating}/5</span>
                    )}
                  </div>
                  {a.comment && <p className="text-xs text-muted-foreground mt-1">{a.comment}</p>}
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {new Date(a.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Events */}
      <div className="rounded-2xl border border-border/50 bg-card/40 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <MousePointer className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Recent Events</h3>
        </div>
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No product events yet.</p>
        ) : (
          <div className="space-y-2">
            {events.map((e) => (
              <div key={e.id} className="flex items-center gap-3 p-3 rounded-xl border border-border/30 bg-background/50">
                <MousePointer className="w-4 h-4 text-sky-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium">{e.eventName}</span>
                  {e.module && <span className="text-[10px] text-muted-foreground ml-2">{e.module}</span>}
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
