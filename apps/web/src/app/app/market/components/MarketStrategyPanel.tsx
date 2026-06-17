"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Target, Users, Zap, Loader2, FileText, ArrowRight } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { generateMarketStrategy, getMarketStrategy, type MarketStrategyResponse } from "@/lib/api/business-genesis";
import { SwotCard } from "./SwotCard";
import { PestleCard } from "./PestleCard";
import { CompetitorList } from "./CompetitorList";
import { PositioningCard } from "./PositioningCard";
import { LaunchPlanCard } from "./LaunchPlanCard";

function getScoreColor(score: number): string {
  if (score >= 70) return "hsl(var(--kf-success))";
  if (score >= 40) return "hsl(var(--kf-warning))";
  return "hsl(var(--kf-error))";
}

function SummaryCard({ label, value, color, icon: Icon }: { label: string; value: string | number; color: string; icon: React.ElementType }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="kf-card p-4 flex flex-col items-center justify-center gap-2"
      style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
    >
      <Icon className="w-5 h-5" style={{ color }} />
      <span className="text-2xl font-bold" style={{ color }}>
        {value}
      </span>
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
    </motion.div>
  );
}

export function MarketStrategyPanel() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [response, setResponse] = useState<MarketStrategyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setBusinessId(getStoredBusinessId());
  }, []);

  const load = useCallback(async () => {
    const bid = businessId;
    if (!bid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await getMarketStrategy(bid);
    if (error) {
      toast.error(error || "Could not load market strategy.");
    } else if (data) {
      setResponse(data);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleGenerate = async () => {
    if (!businessId) return;
    setGenerating(true);
    const { data, error } = await generateMarketStrategy(businessId);
    setGenerating(false);
    if (error || !data) {
      toast.error(error || "Could not generate market strategy.");
      return;
    }
    setResponse(data);
    toast.success("Market strategy generated.");
  };

  const strategy = response?.strategy;
  const competitors = response?.competitors ?? [];
  const readiness = response?.readiness;
  const launchActionsCount = strategy?.launchPlan.phases.flatMap((p) => p.actions).length ?? 0;

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="kf-card h-28" />
          <div className="kf-card h-28" />
          <div className="kf-card h-28" />
        </div>
        <div className="kf-card h-64" />
      </div>
    );
  }

  if (!strategy) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="kf-card p-8 text-center space-y-6"
        style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
      >
        <div className="space-y-2">
          <h2 className="text-xl font-bold">Build your market strategy</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Generate a complete market intelligence report — SWOT, PESTLE, competitor analysis, positioning, and a 90-day launch plan.
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="kf-btn-glow flex items-center gap-2 px-6 py-3 mx-auto"
        >
          {generating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Generating...</span>
            </>
          ) : (
            <>
              <Zap className="w-4 h-4" />
              <span>Generate market strategy</span>
            </>
          )}
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 flex-1">
          <SummaryCard
            label="Market readiness"
            value={readiness?.market ?? 0}
            color={getScoreColor(readiness?.market ?? 0)}
            icon={Target}
          />
          <SummaryCard
            label="Competitors tracked"
            value={competitors.length}
            color="hsl(var(--kf-accent1))"
            icon={Users}
          />
          <SummaryCard
            label="Launch actions"
            value={launchActionsCount}
            color="hsl(var(--kf-accent2))"
            icon={Zap}
          />
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="kf-btn-glow flex items-center gap-2 px-5 py-2.5"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Regenerating...</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                <span>Regenerate</span>
              </>
            )}
          </button>
          {response?.documentInstanceId && (
            <Link
              href={`/app/documents/${response.documentInstanceId}`}
              className="kf-btn-secondary flex items-center justify-center gap-2 px-5 py-2.5"
            >
              <FileText className="w-4 h-4" />
              <span>View strategy document</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SwotCard swot={strategy.swot} />
        <PestleCard pestle={strategy.pestle} />
      </div>

      <CompetitorList competitors={competitors} />
      <PositioningCard positioning={strategy.positioning} />
      <LaunchPlanCard launchPlan={strategy.launchPlan} />
    </motion.div>
  );
}
