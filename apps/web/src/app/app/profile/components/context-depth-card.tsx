"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Lock,
  Unlock,
  Sparkles,
  TrendingUp,
  DollarSign,
  Lightbulb,
  Settings,
  Target,
} from "lucide-react";
import { apiGet } from "@/lib/api";

interface TierScore {
  tierId: string;
  label: string;
  description: string;
  score: number;
  weight: number;
  unlocksCapabilities: string[];
  subProfileScores: Array<{ name: string; filled: number; total: number; score: number }>;
  basicFieldsComplete: number;
  basicFieldsTotal: number;
}

interface TieredCompletenessResult {
  overallScore: number;
  tiers: TierScore[];
  nextUnlock: { tierId: string; label: string; capabilities: string[]; currentScore: number } | null;
}

const TIER_ICONS: Record<string, React.ElementType> = {
  foundation: Lightbulb,
  market: Target,
  operations: Settings,
  financial: DollarSign,
  strategy: TrendingUp,
};

const TIER_COLORS: Record<string, string> = {
  foundation: "--kf-accent2",
  market: "--kf-accent1",
  operations: "--kf-info",
  financial: "--kf-success",
  strategy: "--kf-warning",
};

const SUB_PROFILE_LABELS: Record<string, string> = {
  identity: "Brand Identity",
  founder: "Founder",
  offer: "Offer & Pricing",
  customer: "Customer",
  revenue: "Revenue",
  finance: "Finance",
  operations: "Operations",
  compliance: "Compliance",
  growth: "Growth",
  goals: "Goals",
  sales: "Sales",
  marketingStrategy: "Marketing Strategy",
  people: "People & HR",
  technology: "Technology",
  partnerships: "Partnerships",
  intellectualProperty: "Intellectual Property",
};

export function ContextDepthCard({ businessId }: { businessId: string | null }) {
  const [data, setData] = useState<TieredCompletenessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedTier, setExpandedTier] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    if (!businessId) { setLoading(false); return; }
    setLoading(true);

    apiGet<TieredCompletenessResult>(`/identity/businesses/${businessId}/tiered-completeness`)
      .then(({ data: result }) => {
        if (result) setData(result);
      })
      .catch((err) => {
        console.error("Failed to load tiered completeness:", err);
      })
      .finally(() => setLoading(false));
  }, [businessId]);

  const toggleTier = useCallback((tierId: string) => {
    setExpandedTier(prev => prev === tierId ? null : tierId);
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl p-4 animate-pulse" style={{ border: "1px solid hsl(var(--kf-border) / 0.2)" }}>
        <div className="h-4 w-40 rounded bg-[hsl(var(--kf-muted)/0.3)] mb-3" />
        <div className="h-2 w-full rounded bg-[hsl(var(--kf-muted)/0.2)]" />
      </div>
    );
  }

  if (!data) return null;

  const scoreColor = data.overallScore >= 80 ? "var(--kf-success)" : data.overallScore >= 50 ? "var(--kf-warning)" : "var(--kf-accent1)";

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid hsl(var(--kf-border) / 0.2)" }}
    >
      <div
        className="p-4"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), hsl(var(--kf-accent2) / 0.04))",
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            <span className="text-sm font-semibold">Business Intelligence</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-lg font-bold" style={{ color: `hsl(${scoreColor})` }}>
              {data.overallScore}%
            </span>
          </div>
        </div>

        <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted) / 0.2)" }}>
          <motion.div
            className="h-full rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${data.overallScore}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            style={{ background: `hsl(${scoreColor})` }}
          />
        </div>

        {data.nextUnlock && (
          <p className="text-xs mt-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            <Sparkles className="w-3 h-3 inline mr-1" style={{ color: "hsl(var(--kf-accent1))" }} />
            Complete your <strong>{data.nextUnlock.label}</strong> layer to unlock:{" "}
            {data.nextUnlock.capabilities[0]}
          </p>
        )}
      </div>

      <div className="divide-y" style={{ borderColor: "hsl(var(--kf-border) / 0.1)" }}>
        {data.tiers.map((tier) => {
          const TierIcon = TIER_ICONS[tier.tierId] || Brain;
          const colorVar = TIER_COLORS[tier.tierId] || "--kf-accent1";
          const isExpanded = expandedTier === tier.tierId;
          const isComplete = tier.score >= 100;
          const isUnlocked = tier.score > 0;

          return (
            <div key={tier.tierId}>
              <button
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-[hsl(var(--kf-muted)/0.08)] transition-colors"
                onClick={() => toggleTier(tier.tierId)}
                aria-expanded={isExpanded}
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{
                    background: isComplete
                      ? `hsl(var(--kf-success) / 0.15)`
                      : `hsl(var(${colorVar}) / 0.12)`,
                  }}
                >
                  {isComplete ? (
                    <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-success))" }} />
                  ) : isUnlocked ? (
                    <TierIcon className="w-3.5 h-3.5" style={{ color: `hsl(var(${colorVar}))` }} />
                  ) : (
                    <Lock className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{tier.label}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full" style={{
                      background: isComplete ? "hsl(var(--kf-success) / 0.12)" : `hsl(var(${colorVar}) / 0.1)`,
                      color: isComplete ? "hsl(var(--kf-success))" : `hsl(var(${colorVar}))`,
                    }}>
                      {tier.score}%
                    </span>
                  </div>
                  <p className="text-xs truncate" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                    {tier.description}
                  </p>
                </div>

                <div className="w-16 h-1.5 rounded-full overflow-hidden flex-shrink-0" style={{ background: "hsl(var(--kf-muted) / 0.2)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${tier.score}%`,
                      background: isComplete ? "hsl(var(--kf-success))" : `hsl(var(${colorVar}))`,
                    }}
                  />
                </div>

                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                ) : (
                  <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                )}
              </button>

              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="px-3 pb-3"
                >
                  <div className="ml-10 space-y-2">
                    {tier.subProfileScores.length > 0 && (
                      <div className="space-y-1.5">
                        {tier.subProfileScores.map((sp) => (
                          <div key={sp.name} className="flex items-center gap-2">
                            {sp.score >= 100 ? (
                              <CheckCircle2 className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
                            ) : sp.score > 0 ? (
                              <Circle className="w-3 h-3 flex-shrink-0" style={{ color: `hsl(var(${colorVar}))` }} />
                            ) : (
                              <Circle className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(var(--kf-muted-foreground) / 0.4)" }} />
                            )}
                            <span className="text-xs flex-1">{SUB_PROFILE_LABELS[sp.name] || sp.name}</span>
                            <span className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                              {sp.filled}/{sp.total}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {tier.unlocksCapabilities.length > 0 && (
                      <div className="mt-2 p-2 rounded-lg" style={{ background: "hsl(var(--kf-muted) / 0.08)" }}>
                        <div className="flex items-center gap-1 mb-1">
                          <Unlock className="w-3 h-3" style={{ color: `hsl(var(${colorVar}))` }} />
                          <span className="text-[10px] font-semibold" style={{ color: `hsl(var(${colorVar}))` }}>
                            {isComplete ? "Unlocked capabilities" : "Unlocks when complete"}
                          </span>
                        </div>
                        <ul className="space-y-0.5">
                          {tier.unlocksCapabilities.map((cap, i) => (
                            <li key={i} className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                              • {cap}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
