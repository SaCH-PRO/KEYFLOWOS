"use client";

import { BarChart3 } from "lucide-react";
import { FlowIntelligence, PredictiveRevenue } from "@/components/contacts";
import { Skeleton } from "@/components/ui/skeleton";
import type { FlowIntelligenceData } from "@/components/contacts/flow-intelligence";
import type { RevenueData } from "@/components/contacts/predictive-revenue";

interface InsightsTabProps {
  flowIntelligence: FlowIntelligenceData | null;
  revenueData: RevenueData | null;
  loading?: boolean;
  onViewCold: () => void;
  onViewReady: () => void;
  onViewExpiringQuotes: () => void;
  onViewOverdueInvoices: () => void;
}

function InsightsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="kf-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-5 w-36" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2 p-3 rounded-xl bg-white/[0.02]">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-7 w-12" />
            </div>
          ))}
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
      </div>
      <div className="kf-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-5 w-40" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function InsightsTab({
  flowIntelligence, revenueData, loading,
  onViewCold, onViewReady, onViewExpiringQuotes, onViewOverdueInvoices,
}: InsightsTabProps) {
  if (loading) return <InsightsSkeleton />;

  if (!flowIntelligence && !revenueData) {
    return (
      <div className="kf-card p-8 text-center">
        <BarChart3 className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
        <p className="text-lg font-medium mb-1">Insights Coming Soon</p>
        <p className="text-muted-foreground text-sm">
          Add more contacts and activities to unlock AI-powered insights about your pipeline.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {flowIntelligence && (
        <FlowIntelligence data={flowIntelligence} onViewCold={onViewCold} onViewReady={onViewReady} />
      )}
      {revenueData && (
        <PredictiveRevenue
          data={revenueData}
          onViewExpiringQuotes={onViewExpiringQuotes}
          onViewOverdueInvoices={onViewOverdueInvoices}
        />
      )}
    </div>
  );
}
