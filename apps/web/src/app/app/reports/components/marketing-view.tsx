"use client";

import { Megaphone, Mail, MousePointer, Users, TrendingUp } from "lucide-react";
import Link from "next/link";
import { MetricCard, NarrativeSection } from "./shared-components";
import type { GeneratedReport } from "@/lib/client";

interface MarketingViewProps {
  report: GeneratedReport;
}

export function MarketingView({ report }: MarketingViewProps) {
  const d = report.data || {};
  const campaignsSent = d.campaignsSent ?? 0;
  const avgOpenRate = d.avgOpenRate ?? 0;
  const totalClicks = d.totalClicks ?? 0;
  const formSubmissions = d.formSubmissions ?? 0;
  const topCampaigns = d.topCampaigns ?? [];
  const leadSources = d.leadSources ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Campaigns Sent"
          value={String(campaignsSent)}
          icon={Megaphone}
          color="text-violet-400"
        />
        <MetricCard
          label="Avg Open Rate"
          value={`${avgOpenRate}%`}
          icon={Mail}
          color="text-blue-400"
          subtext={avgOpenRate > 20 ? "Above average" : "Below average"}
          trend={avgOpenRate > 20 ? "up" : "down"}
        />
        <MetricCard
          label="Total Clicks"
          value={String(totalClicks)}
          icon={MousePointer}
          color="text-emerald-400"
        />
        <MetricCard
          label="Form Submissions"
          value={String(formSubmissions)}
          icon={Users}
          color="text-amber-400"
          subtext="leads captured"
        />
      </div>

      {report.narrative && (
        <NarrativeSection title="AI Marketing Analysis" narrative={report.narrative} />
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="kf-card p-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Top Campaigns by Engagement
          </h3>
          {topCampaigns.length > 0 ? (
            <div className="space-y-2">
              {topCampaigns.slice(0, 5).map((c: { name: string; openRate: number; clickRate: number; sent: number }, i: number) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-border/20 last:border-0">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium truncate block">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.sent} sent</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-xs">
                    <span>
                      <span className="text-muted-foreground">Open </span>
                      <span className="font-medium">{c.openRate}%</span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">Click </span>
                      <span className="font-medium">{c.clickRate}%</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No campaign data for this period.</p>
          )}
        </div>

        <div className="kf-card p-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Users className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
            Lead Sources
          </h3>
          {leadSources.length > 0 ? (
            <div className="space-y-2">
              {leadSources.slice(0, 5).map((src: { name: string; count: number; conversionRate: number }, i: number) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-border/20 last:border-0">
                  <div>
                    <span className="text-sm font-medium">{src.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{src.count} leads</span>
                  </div>
                  <span className="text-xs font-medium" style={{ color: "hsl(var(--kf-success))" }}>
                    {src.conversionRate}% conversion
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No lead source data for this period.</p>
          )}
        </div>
      </div>

      <div className="kf-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Take Action</h3>
          <Link
            href="/app/marketing"
            className="text-xs font-medium transition-colors hover:opacity-80"
            style={{ color: "hsl(var(--kf-accent1))" }}
          >
            Open Marketing →
          </Link>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Create campaigns, manage audiences, and optimize your marketing strategy.
        </p>
      </div>
    </div>
  );
}
