"use client";

import { useEffect, useState, useCallback } from "react";
import { Activity } from "lucide-react";
import { fetchAdminEvents, type AdminEvent } from "@/lib/api/admin-analytics";

export default function AdminEvents() {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdminEvents(undefined, limit, offset);
      if (res.data) {
        setEvents(res.data.items);
        setTotal(res.data.total);
      }
    } catch (e) {
      console.error("Failed to load events", e);
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
          <p className="text-sm text-muted-foreground">Recent platform-wide signals.</p>
        </div>
        <div className="text-sm text-muted-foreground">
          <Activity className="inline w-4 h-4 mr-1" />
          {total} total
        </div>
      </div>

      <div className="rounded-2xl border border-border/70 bg-slate-950/70 p-4 space-y-2">
        {loading && events.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">Loading...</div>
        ) : events.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">No events found.</div>
        ) : (
          events.map((e) => (
            <div key={e.id} className="rounded-xl border border-border/60 bg-slate-900/70 px-3 py-3 text-sm">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{e.type}</span>
                  <span>·</span>
                  <span>{e.action}</span>
                  <span>·</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/30">{e.actorType}</span>
                </div>
                <span>{new Date(e.createdAt).toLocaleTimeString()}</span>
              </div>
              <div className="mt-1 text-foreground text-xs">
                {e.businessName ? (
                  <span className="text-muted-foreground">{e.businessName}</span>
                ) : (
                  <span className="text-muted-foreground">Platform event</span>
                )}
                {e.riskScore !== null && (
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500">
                    Risk {e.riskScore}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {total > limit && (
        <div className="flex items-center justify-between text-sm">
          <button
            onClick={() => setOffset((o) => Math.max(0, o - limit))}
            disabled={offset === 0}
            className="px-3 py-1.5 rounded-lg border border-border/60 bg-card/50 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-muted-foreground text-xs">
            {offset + 1}–{Math.min(offset + limit, total)} of {total}
          </span>
          <button
            onClick={() => setOffset((o) => o + limit)}
            disabled={offset + limit >= total}
            className="px-3 py-1.5 rounded-lg border border-border/60 bg-card/50 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
