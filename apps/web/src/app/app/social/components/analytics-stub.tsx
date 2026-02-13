"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { BarChart3, Calendar, Hash, Type, Clock, TrendingUp, FileText } from "lucide-react";
import type { SocialPost } from "@/lib/client";

type Props = {
  posts: SocialPost[];
};

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

export function AnalyticsPanel({ posts }: Props) {
  const stats = useMemo(() => {
    if (posts.length === 0) return null;

    const totalPosts = posts.length;
    const avgLength = Math.round(posts.reduce((sum, p) => sum + p.content.length, 0) / totalPosts);
    const hashtagPosts = posts.filter((p) => p.content.includes("#")).length;

    const dayCounts: Record<number, number> = {};
    const dates: Date[] = [];
    posts.forEach((p) => {
      const d = new Date(p.postedAt || p.publishedAt || p.scheduledAt || p.scheduledFor || p.createdAt);
      dates.push(d);
      const day = d.getDay();
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    });

    let bestDay = 0;
    let bestDayCount = 0;
    Object.entries(dayCounts).forEach(([day, count]) => {
      if (count > bestDayCount) {
        bestDay = Number(day);
        bestDayCount = count;
      }
    });

    const sortedDates = dates.sort((a, b) => a.getTime() - b.getTime());
    const rangeMs = sortedDates[sortedDates.length - 1].getTime() - sortedDates[0].getTime();
    const rangeWeeks = Math.max(1, rangeMs / (7 * 24 * 60 * 60 * 1000));
    const postsPerWeek = (totalPosts / rangeWeeks).toFixed(1);

    const draftCount = posts.filter((p) => p.status === "DRAFT").length;
    const scheduledCount = posts.filter((p) => p.status === "SCHEDULED").length;
    const postedCount = posts.filter((p) => p.status === "POSTED").length;

    const recentPosts = [...posts]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    return {
      totalPosts,
      postsPerWeek,
      bestDay: DAYS_OF_WEEK[bestDay],
      avgLength,
      hashtagPosts,
      draftCount,
      scheduledCount,
      postedCount,
      recentPosts,
    };
  }, [posts]);

  if (!stats) {
    return (
      <div className="p-8 text-center">
        <BarChart3 className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-lg font-medium mb-1">No data yet</p>
        <p className="text-muted-foreground">Create posts to see analytics</p>
      </div>
    );
  }

  const statusData = [
    { label: "Draft", count: stats.draftCount, color: "hsl(var(--kf-muted-foreground))", pct: Math.round((stats.draftCount / stats.totalPosts) * 100) },
    { label: "Scheduled", count: stats.scheduledCount, color: "hsl(210 100% 60%)", pct: Math.round((stats.scheduledCount / stats.totalPosts) * 100) },
    { label: "Posted", count: stats.postedCount, color: "hsl(150 60% 45%)", pct: Math.round((stats.postedCount / stats.totalPosts) * 100) },
  ];

  const kpis = [
    { icon: BarChart3, label: "Total Posts", value: stats.totalPosts, color: "hsl(var(--kf-accent1))" },
    { icon: TrendingUp, label: "Posts / Week", value: stats.postsPerWeek, color: "hsl(var(--kf-accent2))" },
    { icon: Calendar, label: "Best Day", value: stats.bestDay, color: "hsl(150 60% 45%)" },
    { icon: Type, label: "Avg Length", value: `${stats.avgLength} chars`, color: "hsl(210 100% 60%)" },
    { icon: Hash, label: "Hashtag Usage", value: `${stats.hashtagPosts} / ${stats.totalPosts}`, color: "hsl(280 80% 60%)" },
  ];

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={item} className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className="rounded-2xl border backdrop-blur-xl p-4 text-center space-y-2"
              style={{ background: "hsl(var(--kf-card) / 0.7)", borderColor: "hsl(var(--kf-border))" }}
            >
              <Icon className="w-5 h-5 mx-auto" style={{ color: kpi.color }} />
              <p className="text-lg font-bold">{kpi.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{kpi.label}</p>
            </div>
          );
        })}
      </motion.div>

      <div className="grid md:grid-cols-2 gap-4">
        <motion.div
          variants={item}
          className="rounded-2xl border backdrop-blur-xl p-5 space-y-4"
          style={{ background: "hsl(var(--kf-card) / 0.7)", borderColor: "hsl(var(--kf-border))" }}
        >
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Status Breakdown
          </h4>
          <div className="space-y-3">
            {statusData.map((s) => (
              <div key={s.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="font-medium">{s.count} ({s.pct}%)</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted))" }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${s.pct}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className="h-full rounded-full"
                    style={{ background: s.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          variants={item}
          className="rounded-2xl border backdrop-blur-xl p-5 space-y-4"
          style={{ background: "hsl(var(--kf-card) / 0.7)", borderColor: "hsl(var(--kf-border))" }}
        >
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
            Recent Activity
          </h4>
          <div className="space-y-3">
            {stats.recentPosts.map((p) => {
              const statusColor = p.status === "POSTED" ? "bg-emerald-400" : p.status === "SCHEDULED" ? "bg-blue-400" : "bg-slate-400";
              return (
                <div key={p.id} className="flex items-start gap-3">
                  <div className="flex flex-col items-center mt-1.5">
                    <span className={`w-2 h-2 rounded-full ${statusColor}`} />
                    <div className="w-px h-full min-h-[20px]" style={{ background: "hsl(var(--kf-border))" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate">{p.content.slice(0, 60)}...</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(p.createdAt).toLocaleDateString("en-TT", { month: "short", day: "numeric" })}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded border" style={{
                        color: p.status === "POSTED" ? "hsl(150 60% 60%)" : p.status === "SCHEDULED" ? "hsl(210 100% 70%)" : "inherit",
                        borderColor: "hsl(var(--kf-border))",
                        background: "hsl(var(--kf-muted) / 0.5)"
                      }}>
                        {p.status.toLowerCase()}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
