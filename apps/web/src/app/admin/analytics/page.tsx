"use client";

import { useEffect, useState } from "react";
// import { motion } from "framer-motion";
import { BarChart3, MessageSquare, Zap, TrendingUp, Star } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid,
} from "recharts";
import {
  fetchAdminFeatureUsage,
  fetchAdminKeyQuality,
  fetchAdminFeedbackInbox,
  fetchAdminRecentEvents,
} from "@/lib/api/admin-analytics";
import type { FeatureUsage, KeyQuality, FeedbackInbox } from "@/lib/api/admin-analytics";

function Section({ title, subtitle, icon: Icon, children }: { title: string; subtitle: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-slate-950/70 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      {children}
    </div>
  );
}

export default function AdminAnalytics() {
  const [featureUsage, setFeatureUsage] = useState<FeatureUsage | null>(null);
  const [keyQuality, setKeyQuality] = useState<KeyQuality | null>(null);
  const [feedback, setFeedback] = useState<FeedbackInbox | null>(null);
  const [events, setEvents] = useState<Array<{ id: string; eventName: string; module: string | null; businessId: string | null; occurredAt: string }> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [fu, kq, fb, ev] = await Promise.all([
          fetchAdminFeatureUsage(7),
          fetchAdminKeyQuality(30),
          fetchAdminFeedbackInbox(20),
          fetchAdminRecentEvents(20),
        ]);
        if (fu.data) setFeatureUsage(fu.data);
        if (kq.data) setKeyQuality(kq.data);
        if (fb.data) setFeedback(fb.data);
        if (ev.data) setEvents(ev.data);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const moduleTotals = featureUsage
    ? featureUsage.usage.reduce((acc, u) => {
        acc[u.module] = (acc[u.module] || 0) + u.eventCount;
        return acc;
      }, {} as Record<string, number>)
    : {};

  const dailyTotals = featureUsage
    ? Object.entries(
        featureUsage.usage.reduce((acc, u) => {
          const day = u.day.slice(0, 10);
          acc[day] = (acc[day] || 0) + u.eventCount;
          return acc;
        }, {} as Record<string, number>),
      )
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([day, count]) => ({ day, count }))
    : [];

  const moduleBarData = Object.entries(moduleTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([module, count]) => ({ module: module.replace(/_/g, " "), count }));

  const PIE_COLORS = ["hsl(var(--kf-accent1))", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#60a5fa", "#f472b6", "#94a3b8"];

  const qualityPieData = keyQuality?.byType.map((t) => ({
    name: t.type.replace(/_/g, " "),
    value: t.count,
  })) ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">Growth metrics for the entire platform.</p>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-64 rounded-2xl border border-border/70 bg-slate-950/70 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Feature Usage */}
          <Section title="Feature Usage (7d)" subtitle="Events per module" icon={BarChart3}>
            {Object.keys(moduleTotals).length === 0 ? (
              <p className="text-xs text-muted-foreground">No usage data yet</p>
            ) : (
              <div className="space-y-4">
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={moduleBarData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                      <XAxis dataKey="module" tick={{ fontSize: 10, fill: "#94a3b8" }} interval={0} angle={-20} textAnchor="end" height={50} />
                      <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} width={40} />
                      <Tooltip
                        contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "8px", fontSize: 12 }}
                        itemStyle={{ color: "#e2e8f0" }}
                      />
                      <Bar dataKey="count" fill="hsl(var(--kf-accent1))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {dailyTotals.length > 1 && (
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={dailyTotals} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => v.slice(5)} />
                        <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} width={40} />
                        <Tooltip
                          contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "8px", fontSize: 12 }}
                          itemStyle={{ color: "#e2e8f0" }}
                        />
                        <Line type="monotone" dataKey="count" stroke="#34d399" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* KEY Quality */}
          <Section title="KEY Quality (30d)" subtitle="AI quality signals and ratings" icon={Zap}>
            {keyQuality ? (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <div className="rounded-xl border border-border/60 bg-slate-900/70 p-3 text-center flex-1">
                    <div className="text-lg font-semibold text-primary">{keyQuality.totalSignals}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Signals</div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-slate-900/70 p-3 text-center flex-1">
                    <div className="text-lg font-semibold text-emerald-400 flex items-center justify-center gap-1">
                      {keyQuality.averageRating.toFixed(1)}
                      <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                    </div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Rating</div>
                  </div>
                </div>
                {qualityPieData.length > 0 && (
                  <div className="h-40 flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={qualityPieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={40}
                          outerRadius={70}
                          paddingAngle={3}
                          dataKey="value"
                          stroke="none"
                        >
                          {qualityPieData.map((_, idx) => (
                            <Cell key={`cell-${idx}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "8px", fontSize: 12 }}
                          itemStyle={{ color: "#e2e8f0" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="space-y-1">
                  {keyQuality.byType.map((t, idx) => (
                    <div key={t.type} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                        <span className="text-muted-foreground capitalize">{t.type.replace(/_/g, " ")}</span>
                      </span>
                      <span className="font-medium">{t.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No KEY quality data yet</p>
            )}
          </Section>

          {/* Feedback Inbox */}
          <Section title="Feedback Inbox" subtitle="Recent user feedback" icon={MessageSquare}>
            {feedback && feedback.items.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {feedback.items.map((f) => (
                  <div key={f.id} className="text-xs rounded-lg border border-border/40 bg-slate-900/50 px-3 py-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{f.feedbackType}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        f.status === 'NEW' ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'
                      }`}>{f.status}</span>
                    </div>
                    {f.message && <p className="text-muted-foreground line-clamp-2">{f.message}</p>}
                    <div className="text-[10px] text-muted-foreground">
                      {f.module && `${f.module} · `}{new Date(f.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No feedback yet</p>
            )}
          </Section>

          {/* Recent Events */}
          <Section title="Recent Events" subtitle="Latest product events" icon={TrendingUp}>
            {events && events.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {events.map((e) => (
                  <div key={e.id} className="flex items-center justify-between text-xs rounded-lg border border-border/40 bg-slate-900/50 px-3 py-2">
                    <div>
                      <span className="font-medium">{e.eventName}</span>
                      {e.module && <span className="text-muted-foreground ml-1">({e.module})</span>}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(e.occurredAt).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No events yet</p>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
