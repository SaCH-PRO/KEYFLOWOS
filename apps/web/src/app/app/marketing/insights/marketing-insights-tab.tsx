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
import type { EmailCampaign, LeadForm, LeadFormSubmission } from "@/lib/client";

interface MarketingInsightsTabProps {
  campaigns: EmailCampaign[];
  forms: LeadForm[];
  submissions: Record<string, LeadFormSubmission[]>;
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

function MarketingInsightsTabInner({ campaigns, forms, submissions }: MarketingInsightsTabProps) {
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
    () => campaigns.reduce((sum, c) => sum + c.sentCount, 0),
    [campaigns]
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
    () => forms.reduce((sum, f) => sum + (f._count?.submissions ?? 0), 0),
    [forms]
  );
  const avgOpenRate = useMemo(
    () => totalSent > 0 ? Math.round((totalOpens / totalSent) * 100) : 0,
    [totalSent, totalOpens]
  );

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
  ];

  return (
    <motion.div
      variants={stagger.container}
      initial="hidden"
      animate="visible"
      className="space-y-5"
    >
      <motion.div variants={stagger.item} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
