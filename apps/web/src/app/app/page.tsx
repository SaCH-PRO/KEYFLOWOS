"use client";

import { useEffect, useState } from "react";
import { AchievementsStrip } from "@/components/cockpit/achievements-strip";
import { FlowFeedPanel } from "@/components/cockpit/flow-feed-panel";
import { FlowGraphPanel } from "@/components/cockpit/flow-graph-panel";
import { FlowStatsRow } from "@/components/cockpit/flow-stats-row";
import { fetchBookings, fetchContacts } from "@/lib/client";

export default function AppHome() {
  const [stats, setStats] = useState({
    mrr: "TTD --",
    conversionRate: "--",
    avgResponseTime: "--",
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [{ data: contacts }, { data: bookings }] = await Promise.all([
        fetchContacts("biz_1"),
        fetchBookings("biz_1"),
      ]);
      const contactCount = Array.isArray(contacts) ? contacts.length : 0;
      const bookingCount = Array.isArray(bookings) ? bookings.length : 0;
      setStats({
        mrr: `TTD ${Math.max(5000, bookingCount * 2000).toLocaleString()}`,
        conversionRate: `${Math.min(80, 20 + contactCount * 3)}%`,
        avgResponseTime: `${Math.max(2, 6 - contactCount * 0.2).toFixed(1)}m`,
      });
      setLoading(false);
    };
    void load();
  }, []);

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Cockpit</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Your business graph, live. Watch leads flow into bookings and revenue in real-time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center gap-2 rounded-full border border-primary/70 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-ping" />
            Run AI Health Check
          </button>
          <button className="hidden sm:inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/60 hover:text-foreground">
            Export Report
          </button>
        </div>
      </div>

      <FlowStatsRow stats={stats} />
      {!loading && <AchievementsStrip />}

      <div className="grid gap-4 md:gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
        <FlowFeedPanel />
        <FlowGraphPanel />
      </div>
    </div>
  );
}
