"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  TrendingUp,
  Mail,
  MousePointerClick,
  MailOpen,
  Send,
  ClipboardList,
  Users,
  Trophy,
  ArrowRight,
  Filter,
  DollarSign,
  Share2,
  FileText,
  Calendar,
  Facebook,
  Instagram,
  Linkedin,
  Twitter,
  Music2,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { EmailCampaign, LeadForm, LeadFormSubmission, SocialPost } from "@/lib/client";
import type { MarketingStats } from "../hooks/use-marketing";
import { CampaignBriefingsSection, AudienceHealthSection, SendTimeSection } from "../components/campaign-intelligence-cards";

interface MarketingInsightsTabProps {
  campaigns: EmailCampaign[];
  forms: LeadForm[];
  submissions: Record<string, LeadFormSubmission[]>;
  socialPosts?: SocialPost[];
  stats?: MarketingStats;
  businessId?: string | null;
}

const stagger = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } },
  item: {
    hidden: { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35 } },
  },
};

const RECHARTS_TOOLTIP_STYLE = {
  contentStyle: {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border)/0.5)",
    borderRadius: "0.75rem",
    color: "hsl(var(--foreground))",
    fontSize: "11px",
    padding: "6px 10px",
  },
  cursor: { fill: "hsl(var(--border)/0.1)" },
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#94a3b8",
  SCHEDULED: "#f59e0b",
  SENT: "#22c55e",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  SENT: "Sent",
};

const FUNNEL_STAGE_COLORS = {
  leads: "#f97316",
  campaigns: "hsl(var(--kf-accent1))",
  converted: "#10b981",
  revenue: "hsl(var(--kf-accent2))",
};

function LeadToRevenueFunnel({
  totalSubmissions,
  sentCampaignsCount,
  totalSent,
}: {
  totalSubmissions: number;
  sentCampaignsCount: number;
  totalSent: number;
}) {
  const estimatedConverted = Math.round(totalSubmissions * 0.15);
  const stages = [
    { label: "Leads Captured", count: totalSubmissions, icon: ClipboardList, color: FUNNEL_STAGE_COLORS.leads },
    { label: "Campaigns Sent", count: sentCampaignsCount, icon: Send, color: FUNNEL_STAGE_COLORS.campaigns },
    { label: "Contacts Converted", count: estimatedConverted, icon: Users, color: FUNNEL_STAGE_COLORS.converted },
    { label: "Revenue Pipeline", count: null, icon: DollarSign, color: FUNNEL_STAGE_COLORS.revenue },
  ];

  const maxCount = Math.max(totalSubmissions, sentCampaignsCount, estimatedConverted, 1);

  if (totalSubmissions === 0 && sentCampaignsCount === 0) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        Capture leads and send campaigns to see your conversion funnel
      </div>
    );
  }

  return (
    <div className="space-y-2" role="img" aria-label="Lead-to-revenue conversion funnel">
      {stages.map((s, i) => {
        const displayCount = s.count;
        const prevCount = i > 0 ? stages[i - 1].count : null;
        const convRate =
          prevCount != null && displayCount != null && prevCount > 0
            ? `${((displayCount / prevCount) * 100).toFixed(0)}%`
            : null;
        const barWidth =
          displayCount != null ? Math.max((displayCount / maxCount) * 100, 2) : 0;

        return (
          <div key={s.label}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <s.icon className="w-3 h-3 shrink-0" style={{ color: s.color }} />
                <span className="text-[11px] text-muted-foreground/70 font-medium">{s.label}</span>
              </div>
              <span className="text-[11px] font-bold tabular-nums" style={{ color: s.color }}>
                {displayCount != null ? displayCount : "—"}
              </span>
            </div>
            <div className="h-2 rounded-full bg-border/20 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${barWidth}%`,
                  background: `linear-gradient(90deg, ${s.color}, ${s.color}80)`,
                }}
              />
            </div>
            {convRate && i < stages.length && (
              <div className="flex items-center gap-0.5 mt-0.5 ml-3">
                <ArrowRight className="w-2.5 h-2.5 text-muted-foreground/40" />
                <span className="text-[10px] text-muted-foreground/50 font-medium">{convRate} conversion</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const PLATFORM_ICONS: Record<string, React.ElementType> = {
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

function MarketingInsightsTabInner({ campaigns, forms, submissions, socialPosts = [], stats: parentStats, businessId }: MarketingInsightsTabProps) {
  const sentCampaigns = useMemo(
    () => campaigns.filter((c) => c.status === "SENT").sort(
      (a, b) => new Date(a.sentAt ?? a.createdAt).getTime() - new Date(b.sentAt ?? b.createdAt).getTime()
    ),
    [campaigns]
  );

  const performanceOverTime = useMemo(() => {
    return sentCampaigns.map((c) => {
      const d = new Date(c.sentAt ?? c.createdAt);
      return {
        name: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        sends: c.sentCount,
        opens: c.openCount,
        clicks: c.clickCount,
      };
    });
  }, [sentCampaigns]);

  const openVsClickRate = useMemo(() => {
    return sentCampaigns
      .filter((c) => c.sentCount > 0)
      .slice(-10)
      .map((c) => ({
        name: c.name.length > 15 ? c.name.slice(0, 15) + "…" : c.name,
        openRate: c.sentCount > 0 ? Math.round((c.openCount / c.sentCount) * 100) : 0,
        clickRate: c.sentCount > 0 ? Math.round((c.clickCount / c.sentCount) * 100) : 0,
      }));
  }, [sentCampaigns]);

  const formSubmissionVolume = useMemo(() => {
    return forms.map((f) => ({
      name: f.name.length > 18 ? f.name.slice(0, 18) + "…" : f.name,
      submissions: f._count?.submissions ?? (submissions[f.id]?.length ?? 0),
    }));
  }, [forms, submissions]);

  const topCampaigns = useMemo(() => {
    return sentCampaigns
      .filter((c) => c.sentCount > 0)
      .map((c) => ({
        id: c.id,
        name: c.name,
        sentCount: c.sentCount,
        openCount: c.openCount,
        clickCount: c.clickCount,
        openRate: Math.round((c.openCount / c.sentCount) * 100),
        clickRate: Math.round((c.clickCount / c.sentCount) * 100),
        sentAt: c.sentAt ?? c.createdAt,
      }))
      .sort((a, b) => b.openRate - a.openRate)
      .slice(0, 8);
  }, [sentCampaigns]);

  const audienceGrowth = useMemo(() => {
    const allSubs: { date: string; count: number }[] = [];
    const monthMap = new Map<string, number>();

    Object.values(submissions).flat().forEach((sub) => {
      const d = new Date(sub.createdAt);
      const key = d.toLocaleDateString("en-US", { year: "numeric", month: "short" });
      monthMap.set(key, (monthMap.get(key) ?? 0) + 1);
    });

    if (monthMap.size === 0) {
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.toLocaleDateString("en-US", { year: "numeric", month: "short" });
        allSubs.push({ date: key, count: 0 });
      }
    } else {
      const sorted = Array.from(monthMap.entries()).sort(
        (a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime()
      );
      let cumulative = 0;
      sorted.forEach(([date, count]) => {
        cumulative += count;
        allSubs.push({ date, count: cumulative });
      });
    }

    return allSubs;
  }, [submissions]);

  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    campaigns.forEach((c) => {
      counts[c.status] = (counts[c.status] ?? 0) + 1;
    });
    return Object.entries(counts).map(([status, value]) => ({
      name: STATUS_LABELS[status] ?? status,
      value,
      color: STATUS_COLORS[status] ?? "#6b7280",
    }));
  }, [campaigns]);

  const totalSent = useMemo(
    () => parentStats?.sentCampaigns ?? campaigns.reduce((sum, c) => sum + c.sentCount, 0),
    [campaigns, parentStats]
  );
  const totalOpens = useMemo(
    () => campaigns.reduce((sum, c) => sum + c.openCount, 0),
    [campaigns]
  );
  const totalClicks = useMemo(
    () => campaigns.reduce((sum, c) => sum + c.clickCount, 0),
    [campaigns]
  );
  const totalSubmissions = useMemo(
    () => parentStats?.totalLeads ?? forms.reduce((sum, f) => sum + (f._count?.submissions ?? 0), 0),
    [forms, parentStats]
  );
  const avgOpenRate = useMemo(
    () => parentStats?.avgOpenRate ?? (totalSent > 0 ? Math.round((totalOpens / totalSent) * 100) : 0),
    [totalSent, totalOpens, parentStats]
  );

  const socialStats = useMemo(() => {
    const total = socialPosts.length;
    if (total === 0) return null;

    const posted = socialPosts.filter((p) => p.status === "POSTED").length;
    const scheduled = socialPosts.filter((p) => p.status === "SCHEDULED").length;
    const draft = socialPosts.filter((p) => p.status === "DRAFT").length;

    const dates = socialPosts.map((p) => new Date(p.postedAt || p.publishedAt || p.scheduledAt || p.scheduledFor || p.createdAt));
    const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
    const rangeMs = sorted.length > 1 ? sorted[sorted.length - 1].getTime() - sorted[0].getTime() : 0;
    const rangeWeeks = Math.max(1, rangeMs / (7 * 24 * 60 * 60 * 1000));
    const postsPerWeek = (total / rangeWeeks).toFixed(1);

    const platformCounts: Record<string, number> = {};
    socialPosts.forEach((p) => {
      if (p.channelIds && p.channelIds.length > 0) {
        p.channelIds.forEach((ch) => {
          const platform = ch.toUpperCase();
          platformCounts[platform] = (platformCounts[platform] ?? 0) + 1;
        });
      }
      if (p.publishResults && Array.isArray(p.publishResults)) {
        p.publishResults.forEach((r: Record<string, unknown>) => {
          const platform = String(r.platform ?? "").toUpperCase();
          if (platform) {
            platformCounts[platform] = (platformCounts[platform] ?? 0) + 1;
          }
        });
      }
    });

    return { total, posted, scheduled, draft, postsPerWeek, platformCounts };
  }, [socialPosts]);

  const kpiCards = [
    {
      label: "Campaigns Sent",
      value: sentCampaigns.length,
      icon: Send,
      color: "from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent1))]",
      bg: "from-[hsl(var(--kf-accent1)/0.15)] to-[hsl(var(--kf-accent1)/0.05)]",
    },
    {
      label: "Avg Open Rate",
      value: `${avgOpenRate}%`,
      icon: MailOpen,
      color: "from-emerald-500 to-green-600",
      bg: "from-emerald-500/15 to-emerald-600/5",
    },
    {
      label: "Total Clicks",
      value: totalClicks,
      icon: MousePointerClick,
      color: "from-[hsl(var(--kf-accent2))] to-[hsl(var(--kf-accent2))]",
      bg: "from-[hsl(var(--kf-accent2)/0.15)] to-[hsl(var(--kf-accent2)/0.05)]",
    },
    {
      label: "Form Submissions",
      value: totalSubmissions,
      icon: ClipboardList,
      color: "from-amber-500 to-orange-600",
      bg: "from-amber-500/15 to-amber-600/5",
    },
    ...(socialStats
      ? [
          {
            label: "Social Posts",
            value: socialStats.total,
            icon: Share2,
            color: "from-blue-500 to-indigo-600",
            bg: "from-blue-500/15 to-indigo-600/5",
          },
          {
            label: "Posts / Week",
            value: socialStats.postsPerWeek,
            icon: Calendar,
            color: "from-violet-500 to-purple-600",
            bg: "from-violet-500/15 to-purple-600/5",
          },
        ]
      : []),
  ];

  return (
    <motion.div
      variants={stagger.container}
      initial="hidden"
      animate="visible"
      className="space-y-5"
    >
      <motion.div variants={stagger.item} className={`grid grid-cols-2 ${socialStats ? 'lg:grid-cols-6' : 'lg:grid-cols-4'} gap-3`}>
        {kpiCards.map((card) => (
          <div
            key={card.label}
            className={`rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm bg-gradient-to-br ${card.bg} p-4 flex items-start gap-3`}
          >
            <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center shrink-0`}>
              <card.icon className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{card.label}</p>
              <p className="text-xl font-bold truncate">{card.value}</p>
            </div>
          </div>
        ))}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <motion.div
          variants={stagger.item}
          className="lg:col-span-3 kf-card p-4 space-y-3"
        >
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            <h3 className="text-sm font-semibold">Campaign Performance Over Time</h3>
          </div>
          {performanceOverTime.length > 0 ? (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={performanceOverTime}>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip {...RECHARTS_TOOLTIP_STYLE} />
                  <Legend
                    iconType="circle"
                    iconSize={6}
                    wrapperStyle={{ fontSize: "10px", color: "hsl(var(--muted-foreground))" }}
                  />
                  <Line type="monotone" dataKey="sends" stroke="hsl(var(--kf-accent1))" strokeWidth={2} dot={{ r: 3 }} name="Sends" />
                  <Line type="monotone" dataKey="opens" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} name="Opens" />
                  <Line type="monotone" dataKey="clicks" stroke="hsl(var(--kf-accent2))" strokeWidth={2} dot={{ r: 3 }} name="Clicks" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-52 flex items-center justify-center text-xs text-muted-foreground">
              Send campaigns to see performance data
            </div>
          )}
        </motion.div>

        <motion.div
          variants={stagger.item}
          className="lg:col-span-2 kf-card p-4 space-y-3"
        >
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Campaign Status</h3>
          </div>
          {statusBreakdown.length > 0 ? (
            <>
              <div className="h-36 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={55}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {statusBreakdown.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip {...RECHARTS_TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
                {statusBreakdown.map((s) => (
                  <div key={s.name} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-[10px] text-muted-foreground">{s.name} ({s.value})</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-36 flex items-center justify-center text-xs text-muted-foreground">
              No campaign data yet
            </div>
          )}
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div variants={stagger.item} className="kf-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold">Open Rate vs Click Rate</h3>
          </div>
          {openVsClickRate.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={openVsClickRate} barGap={2}>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    angle={-30}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    unit="%"
                  />
                  <Tooltip
                    {...RECHARTS_TOOLTIP_STYLE}
                    formatter={(value: number | undefined) => [`${value ?? 0}%`]}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={6}
                    wrapperStyle={{ fontSize: "10px", color: "hsl(var(--muted-foreground))" }}
                  />
                  <Bar dataKey="openRate" fill="hsl(var(--kf-accent1))" radius={[4, 4, 0, 0]} barSize={14} name="Open Rate" />
                  <Bar dataKey="clickRate" fill="hsl(var(--kf-accent2))" radius={[4, 4, 0, 0]} barSize={14} name="Click Rate" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
              No sent campaigns with engagement data yet
            </div>
          )}
        </motion.div>

        <motion.div variants={stagger.item} className="kf-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold">Form Submissions by Form</h3>
          </div>
          {formSubmissionVolume.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={formSubmissionVolume} barSize={20}>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    angle={-30}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip {...RECHARTS_TOOLTIP_STYLE} />
                  <Bar dataKey="submissions" radius={[4, 4, 0, 0]} name="Submissions">
                    {formSubmissionVolume.map((_, i) => (
                      <Cell
                        key={i}
                        fill={i % 2 === 0 ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-accent2))"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
              No lead forms created yet
            </div>
          )}
        </motion.div>
      </div>

      {socialStats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <motion.div variants={stagger.item} className="kf-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Share2 className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-semibold">Social Post Status</h3>
            </div>
            <div className="space-y-3">
              {[
                { label: "Published", count: socialStats.posted, color: "#22c55e", pct: Math.round((socialStats.posted / socialStats.total) * 100) },
                { label: "Scheduled", count: socialStats.scheduled, color: "#3b82f6", pct: Math.round((socialStats.scheduled / socialStats.total) * 100) },
                { label: "Draft", count: socialStats.draft, color: "#94a3b8", pct: Math.round((socialStats.draft / socialStats.total) * 100) },
              ].map((s) => (
                <div key={s.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{s.label}</span>
                    <span className="font-medium">{s.count} ({s.pct}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-border/20 overflow-hidden">
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

          <motion.div variants={stagger.item} className="kf-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-violet-400" />
              <h3 className="text-sm font-semibold">Platform Breakdown</h3>
            </div>
            {Object.keys(socialStats.platformCounts).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(socialStats.platformCounts)
                  .sort(([, a], [, b]) => b - a)
                  .map(([platform, count]) => {
                    const Icon = PLATFORM_ICONS[platform] || Share2;
                    const color = PLATFORM_COLORS[platform] || "#6b7280";
                    const pct = Math.round((count / socialStats.total) * 100);
                    return (
                      <div key={platform} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <Icon className="w-3.5 h-3.5" style={{ color }} />
                            <span className="text-muted-foreground">
                              {platform.charAt(0) + platform.slice(1).toLowerCase()}
                            </span>
                          </div>
                          <span className="font-medium">{count} posts</span>
                        </div>
                        <div className="h-2 rounded-full bg-border/20 overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.8, ease: "easeOut" }}
                            className="h-full rounded-full"
                            style={{ background: color }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
                Publish posts to see platform distribution
              </div>
            )}
          </motion.div>
        </div>
      )}

      <motion.div variants={stagger.item} className="kf-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <h3 className="text-sm font-semibold">Audience Growth (Lead Form Contacts)</h3>
        </div>
        {audienceGrowth.some((d) => d.count > 0) ? (
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={audienceGrowth}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip {...RECHARTS_TOOLTIP_STYLE} />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="hsl(var(--kf-accent1))"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "hsl(var(--kf-accent1))" }}
                  name="Contacts"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-44 flex items-center justify-center text-xs text-muted-foreground">
            Audience growth data will appear as lead forms collect submissions
          </div>
        )}
      </motion.div>

      <motion.div variants={stagger.item} className="kf-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <h3 className="text-sm font-semibold">Lead-to-Revenue Funnel</h3>
        </div>
        <LeadToRevenueFunnel
          totalSubmissions={totalSubmissions}
          sentCampaignsCount={sentCampaigns.length}
          totalSent={totalSent}
        />
      </motion.div>

      {businessId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AudienceHealthSection businessId={businessId} />
          <SendTimeSection businessId={businessId} />
        </div>
      )}

      {businessId && (
        <CampaignBriefingsSection businessId={businessId} />
      )}

      <motion.div variants={stagger.item} className="kf-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Trophy className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold">Top Performing Campaigns</h3>
        </div>
        {topCampaigns.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left" role="table" aria-label="Top performing campaigns">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold py-2 pr-4">Campaign</th>
                  <th className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold py-2 px-3 text-right">Sent</th>
                  <th className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold py-2 px-3 text-right">Opens</th>
                  <th className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold py-2 px-3 text-right">Open Rate</th>
                  <th className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold py-2 px-3 text-right">Click Rate</th>
                  <th className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold py-2 pl-3 text-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {topCampaigns.map((c, i) => {
                  const maxOpenRate = topCampaigns[0]?.openRate || 1;
                  return (
                    <tr key={c.id} className="border-b border-border/10 hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-bold shrink-0"
                            style={{
                              backgroundColor: i === 0 ? "hsl(var(--kf-accent1)/0.15)" : "hsl(var(--border)/0.3)",
                              color: i === 0 ? "hsl(var(--kf-accent1))" : "hsl(var(--muted-foreground))",
                            }}
                          >
                            {i + 1}
                          </span>
                          <span className="text-xs font-medium truncate max-w-[200px]">{c.name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right text-xs text-muted-foreground">{c.sentCount}</td>
                      <td className="py-2.5 px-3 text-right text-xs text-muted-foreground">{c.openCount}</td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <div className="w-16 h-1.5 rounded-full bg-border/20 overflow-hidden hidden sm:block">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${(c.openRate / maxOpenRate) * 100}%` }}
                              transition={{ duration: 0.5, delay: i * 0.08 }}
                              className="h-full rounded-full"
                              style={{ backgroundColor: "hsl(var(--kf-accent1))" }}
                            />
                          </div>
                          <span className="text-xs font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
                            {c.openRate}%
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="text-xs font-medium" style={{ color: "hsl(var(--kf-accent2))" }}>
                          {c.clickRate}%
                        </span>
                      </td>
                      <td className="py-2.5 pl-3 text-right text-[10px] text-muted-foreground">
                        {new Date(c.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-muted-foreground">
            Send campaigns to see performance rankings
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

const MarketingInsightsTab = React.memo(MarketingInsightsTabInner);
export default MarketingInsightsTab;
