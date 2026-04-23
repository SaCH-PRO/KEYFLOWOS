"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  BarChart3, Calendar, Hash, Type, Clock, TrendingUp, FileText,
  Heart, MessageCircle, Share2, Eye, Users, Activity, RefreshCw,
  Facebook, Instagram, Linkedin, Twitter, Music2, Loader2,
} from "lucide-react";
import type { SocialPost, SocialAnalytics } from "@/lib/client";
import { fetchSocialAnalytics } from "@/lib/client";

type Props = {
  posts: SocialPost[];
};

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const PLATFORM_ICONS: Record<string, any> = {
  FACEBOOK: Facebook,
  INSTAGRAM: Instagram,
  LINKEDIN: Linkedin,
  TWITTER: Twitter,
  TIKTOK: Music2,
};

const PLATFORM_COLORS: Record<string, string> = {
  FACEBOOK: "#1877F2",
  INSTAGRAM: "#E4405F",
  LINKEDIN: "#0A66C2",
  TWITTER: "#1DA1F2",
  TIKTOK: "#00F2EA",
};

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

export function AnalyticsPanel({ posts }: Props) {
  const [analytics, setAnalytics] = useState<SocialAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"engagement" | "posts">("engagement");

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchSocialAnalytics();
      if (result.data) setAnalytics(result.data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const postStats = useMemo(() => {
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
    const rangeMs = sortedDates.length > 1 ? sortedDates[sortedDates.length - 1].getTime() - sortedDates[0].getTime() : 0;
    const rangeWeeks = Math.max(1, rangeMs / (7 * 24 * 60 * 60 * 1000));
    const postsPerWeek = (totalPosts / rangeWeeks).toFixed(1);

    const draftCount = posts.filter((p) => p.status === "DRAFT").length;
    const scheduledCount = posts.filter((p) => p.status === "SCHEDULED").length;
    const postedCount = posts.filter((p) => p.status === "POSTED").length;

    const recentPosts = [...posts]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    return {
      totalPosts, postsPerWeek, bestDay: DAYS_OF_WEEK[bestDay],
      avgLength, hashtagPosts, draftCount, scheduledCount, postedCount, recentPosts,
    };
  }, [posts]);

  if (!postStats && !analytics) {
    return (
      <div className="p-8 text-center">
        <BarChart3 className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-lg font-medium mb-1">No data yet</p>
        <p className="text-muted-foreground">Create posts to see analytics</p>
      </div>
    );
  }

  const tabs = [
    { key: "engagement" as const, label: "Engagement", icon: Heart },
    { key: "posts" as const, label: "Post Stats", icon: BarChart3 },
  ];

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={item} className="flex items-center justify-between">
        <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: "hsl(var(--kf-muted) / 0.5)" }}>
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  active ? "text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
                style={active ? { background: "hsl(var(--kf-accent1))" } : {}}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={loadAnalytics}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors"
          style={{ background: "hsl(var(--kf-muted) / 0.5)" }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </motion.div>

      {activeTab === "engagement" && (
        <EngagementView analytics={analytics} loading={loading} />
      )}

      {activeTab === "posts" && postStats && (
        <PostStatsView stats={postStats} />
      )}
    </motion.div>
  );
}

function EngagementView({ analytics, loading }: { analytics: SocialAnalytics | null; loading: boolean }) {
  if (loading && !analytics) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!analytics || analytics.connectedPlatforms.length === 0) {
    return (
      <motion.div variants={item} className="text-center py-12">
        <Activity className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm font-medium mb-1">No connected platforms</p>
        <p className="text-xs text-muted-foreground">Connect your social accounts in the Channels tab to see engagement analytics</p>
      </motion.div>
    );
  }

  const engagementKpis = [
    { icon: Heart, label: "Likes", value: analytics.totalLikes, color: "#E4405F" },
    { icon: MessageCircle, label: "Comments", value: analytics.totalComments, color: "#1877F2" },
    { icon: Share2, label: "Shares", value: analytics.totalShares, color: "#0A66C2" },
    { icon: Users, label: "Reach", value: analytics.totalReach, color: "#00F2EA" },
    { icon: Eye, label: "Impressions", value: analytics.totalImpressions, color: "#1DA1F2" },
  ];

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={item} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {engagementKpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className="rounded-2xl border backdrop-blur-xl p-4 text-center space-y-2"
              style={{ background: "hsl(var(--kf-card) / 0.7)", borderColor: "hsl(var(--kf-border))" }}
            >
              <Icon className="w-5 h-5 mx-auto" style={{ color: kpi.color }} />
              <p className="text-lg font-bold">{formatNumber(kpi.value)}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{kpi.label}</p>
            </div>
          );
        })}
      </motion.div>

      {analytics.platformBreakdown.length > 0 && (
        <motion.div
          variants={item}
          className="rounded-2xl border backdrop-blur-xl p-5 space-y-4"
          style={{ background: "hsl(var(--kf-card) / 0.7)", borderColor: "hsl(var(--kf-border))" }}
        >
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Platform Breakdown
          </h4>
          <div className="space-y-4">
            {analytics.platformBreakdown.map((p) => {
              const Icon = PLATFORM_ICONS[p.platform] || Activity;
              const color = PLATFORM_COLORS[p.platform] || "#888";
              const total = p.likes + p.comments + p.shares;
              return (
                <div key={p.platform} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4" style={{ color }} />
                      <span className="text-sm font-medium">{p.platform.charAt(0) + p.platform.slice(1).toLowerCase()}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Heart className="w-3 h-3" /> {formatNumber(p.likes)}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageCircle className="w-3 h-3" /> {formatNumber(p.comments)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Share2 className="w-3 h-3" /> {formatNumber(p.shares)}
                      </span>
                      {p.engagementRate !== undefined && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${color}20`, color }}>
                          {p.engagementRate}% ER
                        </span>
                      )}
                    </div>
                  </div>
                  {analytics.totalLikes + analytics.totalComments + analytics.totalShares > 0 && (
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted))" }}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, (total / (analytics.totalLikes + analytics.totalComments + analytics.totalShares)) * 100)}%` }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="h-full rounded-full"
                        style={{ background: color }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {analytics.postEngagements.length > 0 && (
        <motion.div
          variants={item}
          className="rounded-2xl border backdrop-blur-xl p-5 space-y-4"
          style={{ background: "hsl(var(--kf-card) / 0.7)", borderColor: "hsl(var(--kf-border))" }}
        >
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
            Top Post Engagement
          </h4>
          <div className="space-y-3">
            {analytics.postEngagements.slice(0, 8).map((pe, i) => {
              const Icon = PLATFORM_ICONS[pe.platform] || Activity;
              const color = PLATFORM_COLORS[pe.platform] || "#888";
              return (
                <div key={`${pe.postId}-${pe.platform}-${i}`} className="flex items-center gap-3 py-2 border-b last:border-b-0" style={{ borderColor: "hsl(var(--kf-border) / 0.5)" }}>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: `${color}20` }}>
                    <Icon className="w-3.5 h-3.5" style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground truncate">{pe.platformPostId}</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                    <span className="flex items-center gap-0.5"><Heart className="w-3 h-3 text-rose-400" />{pe.likes}</span>
                    <span className="flex items-center gap-0.5"><MessageCircle className="w-3 h-3 text-blue-400" />{pe.comments}</span>
                    <span className="flex items-center gap-0.5"><Share2 className="w-3 h-3 text-teal-400" />{pe.shares}</span>
                    {pe.views ? <span className="flex items-center gap-0.5"><Eye className="w-3 h-3 text-cyan-400" />{formatNumber(pe.views)}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      <motion.div variants={item} className="text-center">
        <p className="text-[10px] text-muted-foreground">
          Last updated: {new Date(analytics.lastUpdated).toLocaleString("en-TT", { dateStyle: "medium", timeStyle: "short" })}
        </p>
      </motion.div>
    </motion.div>
  );
}

function PostStatsView({ stats }: { stats: any }) {
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
            {stats.recentPosts.map((p: any) => {
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
