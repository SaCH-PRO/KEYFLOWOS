"use client";

import { BarChart3 } from "lucide-react";
import { FlowIntelligence, PredictiveRevenue } from "@/components/contacts";
import type { FlowIntelligenceData } from "@/components/contacts/flow-intelligence";
import type { RevenueData } from "@/components/contacts/predictive-revenue";

interface InsightsTabProps {
  flowIntelligence: FlowIntelligenceData | null;
  revenueData: RevenueData | null;
  onViewCold: () => void;
  onViewReady: () => void;
}

export function InsightsTab({ flowIntelligence, revenueData, onViewCold, onViewReady }: InsightsTabProps) {
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
        <PredictiveRevenue data={revenueData} onViewExpiringQuotes={() => {}} onViewOverdueInvoices={() => {}} />
      )}
    </div>
  );
}
