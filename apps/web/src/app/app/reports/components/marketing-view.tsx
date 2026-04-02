"use client";

import { Megaphone, Mail, MousePointer, Users, TrendingUp, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { MetricCard, NarrativeSection, CollapsibleSection } from "./shared-components";
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
        <Link href="/app/marketing?tab=calendar">
          <MetricCard
            label="Campaigns Sent"
            value={String(campaignsSent)}
            icon={Megaphone}
            color="text-[hsl(var(--kf-accent1))]"
            explanation="Number of email/SMS campaigns sent in this period."
          />
        </Link>
        <Link href="/app/marketing?tab=performance">
          <MetricCard
            label="Avg Open Rate"
            value={`${avgOpenRate}%`}
            icon={Mail}
            color="text-[hsl(var(--kf-info))]"
            subtext={avgOpenRate > 20 ? "Above average" : "Below average"}
            trend={avgOpenRate > 20 ? "up" : "down"}
            explanation="Percentage of recipients who opened your campaigns."
            formula="(Unique Opens ÷ Delivered) × 100"
            goodValue="20-25% is industry average. Above 30% is excellent."
          />
        </Link>
        <Link href="/app/marketing?tab=performance">
          <MetricCard
            label="Total Clicks"
            value={String(totalClicks)}
            icon={MousePointer}
            color="text-[hsl(var(--kf-success))]"
            explanation="Total link clicks across all campaigns in this period."
            goodValue="Higher clicks indicate compelling content and CTAs."
          />
        </Link>
        <Link href="/app/marketing?tab=audiences">
          <MetricCard
            label="Form Submissions"
            value={String(formSubmissions)}
            icon={Users}
            color="text-[hsl(var(--kf-warning))]"
            subtext="leads captured"
            explanation="Number of lead form submissions from your marketing forms."
            goodValue="Track conversion from form views to submissions."
          />
        </Link>
      </div>

      {(report.aiNarrative || report.narrative) && (
        <CollapsibleSection title="AI Marketing Analysis" icon={CheckCircle2} defaultOpen persistKey="mkt-ai-analysis">
          <NarrativeSection content={report.aiNarrative} narrative={report.narrative} />
        </CollapsibleSection>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <CollapsibleSection title="Top Campaigns by Engagement" icon={TrendingUp} defaultOpen persistKey="mkt-top-campaigns">
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
        </CollapsibleSection>

        <CollapsibleSection title="Lead Sources" icon={Users} defaultOpen persistKey="mkt-lead-sources">
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
        </CollapsibleSection>
      </div>

      <div className="kf-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Take Action</h3>
          <Link
            href="/app/marketing"
            className="text-xs font-medium transition-colors hover:opacity-80 min-h-[44px] inline-flex items-center"
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
