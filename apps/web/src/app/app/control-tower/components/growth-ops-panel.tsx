"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, TrendingUp, Sparkles } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { AiRecommendationCard } from "@/components/ui/ai-recommendation-card";
import { apiGet } from "@/lib/api";
import type { StrategicDashboard, ControlTowerModules } from "@/lib/client";

type GrowthInsight = {
  type: "action" | "insight" | "risk" | "opportunity";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  explanation?: string;
  actionLabel: string;
  actionRoute: string;
};

function buildGrowthInsights(dashboard: StrategicDashboard, modules: ControlTowerModules): GrowthInsight[] {
  const insights: GrowthInsight[] = [];

  if (dashboard.pendingQuotes > 0) {
    insights.push({
      type: "action",
      priority: "high",
      title: `Convert $${dashboard.pendingQuoteValue.toFixed(0)} in Pending Quotes`,
      description: `${dashboard.pendingQuotes} quotes are waiting for a response. Follow up to close them.`,
      explanation: "Pending quotes are the fastest path to revenue growth.",
      actionLabel: "View Quotes",
      actionRoute: "/app/commerce?tab=operations",
    });
  }

  if (dashboard.staleLeads > 0) {
    insights.push({
      type: "insight",
      priority: "medium",
      title: `Re-engage ${dashboard.staleLeads} Dormant Leads`,
      description: "These leads went cold but could be re-activated with a timely check-in.",
      actionLabel: "View Leads",
      actionRoute: "/app/crm/pipeline",
    });
  }

  if (dashboard.utilizationRate < 50 && modules.bookings.upcomingCount < 5) {
    insights.push({
      type: "opportunity",
      priority: "medium",
      title: "Underbooked Capacity",
      description: `Calendar utilization is ${dashboard.utilizationRate.toFixed(0)}%. Consider promotions or outreach campaigns.`,
      explanation: "Low utilization means lost revenue potential from available hours.",
      actionLabel: "View Calendar",
      actionRoute: "/app/bookings",
    });
  }

  if (modules.storefront.activeProductCount > 0 && modules.storefront.averagePrice < 50) {
    insights.push({
      type: "opportunity",
      priority: "low",
      title: "Review Pricing Strategy",
      description: "Your average product price is below $50 TTD. Consider bundling or premium tiers.",
      actionLabel: "View Store",
      actionRoute: "/app/store",
    });
  }

  return insights;
}

export function GrowthOpsPanel({
  businessId,
  dashboard,
  modules,
}: {
  businessId: string;
  dashboard: StrategicDashboard;
  modules: ControlTowerModules;
}) {
  const router = useRouter();
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInsights, setAiInsights] = useState<Array<{ title: string; description: string; priority: string; category: string }> | null>(null);

  const staticInsights = buildGrowthInsights(dashboard, modules);

  const loadAiInsights = async () => {
    setAiLoading(true);
    try {
      const res = await apiGet<{ actions: Array<{ title: string; description: string; priority: string; category: string }> }>(
        `/ai/businesses/${businessId}/ai/strategic/actions`,
      );
      setAiInsights(res.data?.actions ?? []);
    } catch {
      setAiInsights([]);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <SectionCard
      title="Growth Operations"
      subtitle="Upsells, conversions, and capacity opportunities"
      icon={TrendingUp}
      action={!aiInsights ? { label: "AI Scan", onClick: loadAiInsights, icon: Sparkles } : undefined}
    >
      <div className="space-y-2">
        {staticInsights.length === 0 && !aiInsights && (
          <p className="text-xs text-center py-3" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            No growth opportunities detected right now
          </p>
        )}
        {staticInsights.map((ins) => (
          <AiRecommendationCard
            key={ins.title}
            type={ins.type}
            priority={ins.priority}
            title={ins.title}
            description={ins.description}
            explanation={ins.explanation}
            actionLabel={ins.actionLabel}
            onAction={() => router.push(ins.actionRoute)}
          />
        ))}

        {aiLoading && (
          <div className="flex items-center justify-center py-4 gap-2">
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: "hsl(var(--kf-accent1))" }} />
            <span className="text-xs" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Scanning for opportunities...</span>
          </div>
        )}

        {aiInsights && aiInsights.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2 mt-2">
            <div className="flex items-center gap-2 px-1">
              <Sparkles className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
              <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "hsl(var(--kf-muted-foreground) / 0.5)" }}>
                AI Strategic Actions
              </span>
            </div>
            {aiInsights.slice(0, 4).map((a) => (
              <AiRecommendationCard
                key={a.title}
                type={a.category === "risk" ? "risk" : a.category === "opportunity" ? "opportunity" : "action"}
                priority={a.priority as "high" | "medium" | "low"}
                title={a.title}
                description={a.description}
              />
            ))}
          </motion.div>
        )}
      </div>
    </SectionCard>
  );
}
