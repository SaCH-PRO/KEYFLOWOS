"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  BarChart3,
  Send,
  MailOpen,
  MousePointerClick,
  ClipboardList,
  Share2,
  Calendar,
  ArrowUpRight,
} from "lucide-react";
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

function MarketingInsightsTabInner({ campaigns, forms, submissions, socialPosts = [], stats: parentStats, businessId }: MarketingInsightsTabProps) {
  const sentCampaigns = useMemo(
    () => campaigns.filter((c) => c.status === "SENT"),
    [campaigns]
  );

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

  const socialCount = socialPosts.length;

  const socialPostsPerWeek = useMemo(() => {
    if (socialCount === 0) return null;
    const dates = socialPosts.map((p) => new Date(p.postedAt || p.publishedAt || p.scheduledAt || p.scheduledFor || p.createdAt));
    const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
    const rangeMs = sorted.length > 1 ? sorted[sorted.length - 1].getTime() - sorted[0].getTime() : 0;
    const rangeWeeks = Math.max(1, rangeMs / (7 * 24 * 60 * 60 * 1000));
    return (socialCount / rangeWeeks).toFixed(1);
  }, [socialPosts, socialCount]);

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
    ...(socialCount > 0
      ? [
          {
            label: "Social Posts",
            value: socialCount,
            icon: Share2,
            color: "from-blue-500 to-indigo-600",
            bg: "from-blue-500/15 to-indigo-600/5",
          },
          {
            label: "Posts / Week",
            value: socialPostsPerWeek ?? "—",
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
      <Link
        href="/app/reports?tab=marketing"
        className="kf-card p-3 flex items-center justify-between gap-3 transition-all hover:border-[hsl(var(--kf-accent1)_/_0.4)]"
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="text-xs font-medium">View Full Marketing Report</span>
          <span className="text-xs text-muted-foreground">— campaign trends, funnels &amp; AI insights</span>
        </div>
        <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground" />
      </Link>

      <motion.div variants={stagger.item} className={`grid grid-cols-2 ${socialCount > 0 ? 'lg:grid-cols-6' : 'lg:grid-cols-4'} gap-3`}>
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

      {businessId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AudienceHealthSection businessId={businessId} />
          <SendTimeSection businessId={businessId} />
        </div>
      )}

      {businessId && (
        <CampaignBriefingsSection businessId={businessId} />
      )}
    </motion.div>
  );
}

export default React.memo(MarketingInsightsTabInner);
