"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Shield,
  CheckCircle2,
  Circle,
  Unlock,
  Brain,
  Sparkles,
  TrendingUp,
  DollarSign,
  Users,
  Target,
  Settings,
  Lightbulb,
  ArrowRight,
  Zap,
  BarChart3,
  Globe,
  Calendar,
  FileText,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import type { ProfileBusinessData } from "./profile-types";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

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

const TIER_STRATEGIC: Record<string, { recommendation: string; unlockSummary: string }> = {
  foundation: {
    recommendation: "Your foundation layer defines how AI understands your business. Complete this to enable intelligent recommendations across all workspaces.",
    unlockSummary: "Unlocks: AI document generation, smart templates, and basic business intelligence.",
  },
  market: {
    recommendation: "Market context shapes competitive positioning and audience targeting. This layer powers content strategy and client acquisition intelligence.",
    unlockSummary: "Unlocks: Market positioning analysis, competitor awareness, and audience profiling.",
  },
  operations: {
    recommendation: "Operational data enables workflow automation and delivery intelligence. Complete this to get AI-powered process optimization.",
    unlockSummary: "Unlocks: Automation recommendations, delivery templates, and capacity planning.",
  },
  financial: {
    recommendation: "Financial context drives revenue intelligence and pricing strategy. This layer enables profitability analysis and cash flow forecasting.",
    unlockSummary: "Unlocks: Revenue forecasting, pricing benchmarks, and financial copilot features.",
  },
  strategy: {
    recommendation: "Strategic data powers long-term growth planning and expansion intelligence. This is the highest-value layer for mature businesses.",
    unlockSummary: "Unlocks: Growth roadmaps, partnership intelligence, and strategic planning.",
  },
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

const MODULE_IMPACT = [
  { icon: Users, label: "Clients", fields: ["Industry", "Stage", "Skills"], color: "--kf-accent1", description: "Customer insights and relationship guidance" },
  { icon: DollarSign, label: "Revenue", fields: ["Name", "Description", "Team Size"], color: "--kf-success", description: "Financial assumptions and pricing intelligence" },
  { icon: BarChart3, label: "Content", fields: ["Industry", "Description", "Tagline"], color: "--kf-accent2", description: "Audience framing and positioning" },
  { icon: Zap, label: "Automations", fields: ["Stage", "Team Size", "Industry"], color: "--kf-warning", description: "Automation and workflow recommendations" },
  { icon: Target, label: "Projects", fields: ["Skills", "Team Size", "Stage"], color: "--kf-info", description: "Delivery templates and role structure" },
  { icon: FileText, label: "Documents", fields: ["Name", "Industry", "Description"], color: "--kf-accent1", description: "Generation quality and legal readiness" },
  { icon: Calendar, label: "Calendar", fields: ["Hours", "Location", "Stage"], color: "--kf-accent2", description: "Scheduling and availability context" },
];

const READINESS_MILESTONES = [
  { threshold: 20, label: "Starter", description: "Basic identity established. AI can generate simple documents and show generic recommendations.", color: "--kf-error" },
  { threshold: 40, label: "Emerging", description: "Core business context available. AI recommendations become industry-aware and stage-appropriate.", color: "--kf-warning" },
  { threshold: 60, label: "Capable", description: "Strong operational foundation. Full document generation, automation suggestions, and market positioning unlocked.", color: "--kf-accent1" },
  { threshold: 80, label: "Advanced", description: "Deep business intelligence active. Financial copilot, growth roadmaps, and strategic planning available.", color: "--kf-accent2" },
  { threshold: 100, label: "Elite", description: "Maximum intelligence. All AI capabilities at full confidence. Your business data drives precision outputs everywhere.", color: "--kf-success" },
];

interface ReadinessTabProps {
  businessId: string | null;
  businessData: ProfileBusinessData | null;
  profileCompleteness: number;
  onNavigateTab: (tab: string) => void;
}

export function ReadinessTab({ businessId, businessData, profileCompleteness, onNavigateTab }: ReadinessTabProps) {
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
    setExpandedTier((prev) => (prev === tierId ? null : tierId));
  }, []);

  const currentMilestone = useMemo(() => {
    const score = data?.overallScore ?? profileCompleteness;
    return READINESS_MILESTONES.reduce((best, ms) => (score >= ms.threshold ? ms : best), READINESS_MILESTONES[0]);
  }, [data, profileCompleteness]);

  const nextMilestone = useMemo(() => {
    const score = data?.overallScore ?? profileCompleteness;
    return READINESS_MILESTONES.find((ms) => score < ms.threshold) || null;
  }, [data, profileCompleteness]);

  const moduleImpactData = useMemo(() => {
    const filledFields = new Set<string>();
    if (businessData?.name) filledFields.add("Name");
    if (businessData?.industry) filledFields.add("Industry");
    if (businessData?.businessStage) filledFields.add("Stage");
    if (businessData?.description) filledFields.add("Description");
    if (businessData?.tagline) filledFields.add("Tagline");
    if (businessData?.teamSize) filledFields.add("Team Size");
    if (businessData?.skills?.length) filledFields.add("Skills");
    if (businessData?.businessHours) filledFields.add("Hours");
    if (businessData?.city || businessData?.country) filledFields.add("Location");

    return MODULE_IMPACT.map((mod) => {
      const filled = mod.fields.filter((f) => filledFields.has(f)).length;
      return { ...mod, filled, total: mod.fields.length };
    });
  }, [businessData]);

  const overallScore = data?.overallScore ?? profileCompleteness;
  const scoreColor = overallScore >= 80 ? "var(--kf-success)" : overallScore >= 50 ? "var(--kf-warning)" : "var(--kf-accent1)";

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl p-4 animate-pulse" style={{ border: "1px solid hsl(var(--kf-border) / 0.2)" }}>
            <div className="h-4 w-40 rounded" style={{ background: "hsl(var(--kf-muted) / 0.3)" }} />
            <div className="h-2 w-full rounded mt-3" style={{ background: "hsl(var(--kf-muted) / 0.2)" }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <motion.div
      variants={{ show: { transition: { staggerChildren: 0.06 } } }}
      initial="hidden"
      animate="show"
      className="space-y-4"
    >
      <motion.div
        variants={fadeUp}
        className="rounded-xl p-4"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.08), hsl(var(--kf-accent2) / 0.05))",
          border: "1px solid hsl(var(--kf-accent1) / 0.15)",
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="text-sm font-semibold">Business Readiness</span>
          <span
            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full ml-auto"
            style={{ background: `hsl(${scoreColor} / 0.12)`, color: `hsl(${scoreColor})` }}
          >
            {currentMilestone.label}
          </span>
        </div>
        <p className="text-xs mb-3" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
          Your readiness score determines the quality and depth of AI capabilities available across all workspaces.
          Higher readiness means more accurate recommendations, better document generation, and smarter automation.
        </p>

        <div className="flex items-center gap-3 mb-3">
          <div className="relative w-16 h-16 flex items-center justify-center flex-shrink-0">
            <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="26" fill="none" stroke="hsl(var(--kf-muted) / 0.2)" strokeWidth="4" />
              <circle
                cx="32" cy="32" r="26" fill="none"
                stroke={`hsl(${scoreColor})`}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 26}
                strokeDashoffset={2 * Math.PI * 26 - (overallScore / 100) * 2 * Math.PI * 26}
                className="transition-all duration-700"
              />
            </svg>
            <span className="absolute text-base font-bold" style={{ color: `hsl(${scoreColor})` }}>
              {overallScore}%
            </span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">{currentMilestone.description}</p>
            {nextMilestone && (
              <p className="text-[10px] mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                Next: <strong style={{ color: `hsl(var(${nextMilestone.color}))` }}>{nextMilestone.label}</strong> at {nextMilestone.threshold}%
              </p>
            )}
          </div>
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <div
          className="rounded-xl p-4"
          style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border) / 0.3)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
            <span className="text-xs font-semibold">Capability Milestones</span>
          </div>
          <div className="space-y-2">
            {READINESS_MILESTONES.map((ms) => {
              const reached = overallScore >= ms.threshold;
              return (
                <div
                  key={ms.threshold}
                  className="flex items-start gap-3 p-2.5 rounded-lg transition-colors"
                  style={{
                    background: reached ? `hsl(var(${ms.color}) / 0.04)` : "transparent",
                    border: reached ? `1px solid hsl(var(${ms.color}) / 0.1)` : "1px solid transparent",
                  }}
                >
                  <div className="flex flex-col items-center gap-0.5 flex-shrink-0 pt-0.5">
                    {reached ? (
                      <CheckCircle2 className="w-4 h-4" style={{ color: `hsl(var(${ms.color}))` }} />
                    ) : (
                      <Circle className="w-4 h-4" style={{ color: "hsl(var(--kf-muted-foreground) / 0.4)" }} />
                    )}
                    <span className="text-[9px] font-bold" style={{ color: reached ? `hsl(var(${ms.color}))` : "hsl(var(--kf-muted-foreground))" }}>
                      {ms.threshold}%
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold" style={{ color: reached ? `hsl(var(${ms.color}))` : "hsl(var(--kf-foreground))" }}>
                      {ms.label}
                    </span>
                    <p className="text-[10px] mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                      {ms.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>

      {data && data.tiers.length > 0 && (
        <motion.div variants={fadeUp}>
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid hsl(var(--kf-border) / 0.2)" }}
          >
            <div className="p-3 flex items-center gap-2" style={{ background: "hsl(var(--kf-card))" }}>
              <Brain className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
              <span className="text-xs font-semibold">Intelligence Layers</span>
              <span className="text-[10px] ml-auto" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                {data.tiers.filter((t) => t.score >= 100).length}/{data.tiers.length} complete
              </span>
            </div>
            <div className="divide-y" style={{ borderColor: "hsl(var(--kf-border) / 0.1)" }}>
              {data.tiers.map((tier) => {
                const TierIcon = TIER_ICONS[tier.tierId] || Brain;
                const colorVar = TIER_COLORS[tier.tierId] || "--kf-accent1";
                const isExpanded = expandedTier === tier.tierId;
                const isComplete = tier.score >= 100;
                const strategic = TIER_STRATEGIC[tier.tierId];

                return (
                  <div key={tier.tierId}>
                    <button
                      className="w-full flex items-center gap-3 p-3 text-left transition-colors"
                      onClick={() => toggleTier(tier.tierId)}
                      aria-expanded={isExpanded}
                      style={{ background: isExpanded ? "hsl(var(--kf-muted) / 0.04)" : "transparent" }}
                    >
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: isComplete ? "hsl(var(--kf-success) / 0.15)" : `hsl(var(${colorVar}) / 0.12)` }}
                      >
                        {isComplete ? (
                          <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-success))" }} />
                        ) : (
                          <TierIcon className="w-3.5 h-3.5" style={{ color: `hsl(var(${colorVar}))` }} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{tier.label}</span>
                          <span
                            className="text-xs px-1.5 py-0.5 rounded-full"
                            style={{
                              background: isComplete ? "hsl(var(--kf-success) / 0.12)" : `hsl(var(${colorVar}) / 0.1)`,
                              color: isComplete ? "hsl(var(--kf-success))" : `hsl(var(${colorVar}))`,
                            }}
                          >
                            {tier.score}%
                          </span>
                        </div>
                        <p className="text-[10px] truncate" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
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
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3">
                        <div className="ml-10 space-y-2">
                          {strategic && (
                            <div
                              className="p-2.5 rounded-lg"
                              style={{ background: `hsl(var(${colorVar}) / 0.04)`, border: `1px solid hsl(var(${colorVar}) / 0.08)` }}
                            >
                              <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                                {strategic.recommendation}
                              </p>
                              <p className="text-[10px] font-medium mt-1" style={{ color: `hsl(var(${colorVar}))` }}>
                                {strategic.unlockSummary}
                              </p>
                            </div>
                          )}

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
                            <div className="p-2 rounded-lg" style={{ background: "hsl(var(--kf-muted) / 0.08)" }}>
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
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}

      <motion.div variants={fadeUp}>
        <div
          className="rounded-xl p-4"
          style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border) / 0.3)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
            <span className="text-xs font-semibold">Cross-Module AI Quality</span>
          </div>
          <p className="text-[10px] mb-3" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            Your profile data feeds into these modules. Higher coverage means better AI recommendations and outputs in each area.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {moduleImpactData.map((mod) => {
              const Icon = mod.icon;
              const pct = mod.total > 0 ? Math.round((mod.filled / mod.total) * 100) : 0;
              const isComplete = mod.filled === mod.total;
              return (
                <div
                  key={mod.label}
                  className="flex items-start gap-2.5 p-2.5 rounded-lg"
                  style={{
                    background: `hsl(var(${mod.color}) / 0.04)`,
                    border: `1px solid hsl(var(${mod.color}) / 0.08)`,
                  }}
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `hsl(var(${mod.color}) / 0.12)` }}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: `hsl(var(${mod.color}))` }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium">{mod.label}</span>
                      <span className="text-[9px] font-bold" style={{ color: isComplete ? "hsl(var(--kf-success))" : `hsl(var(${mod.color}))` }}>
                        {pct}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full overflow-hidden mb-1" style={{ background: "hsl(var(--kf-muted) / 0.15)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          background: isComplete ? "hsl(var(--kf-success))" : `hsl(var(${mod.color}))`,
                        }}
                      />
                    </div>
                    <p className="text-[9px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                      {mod.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>

      {data?.nextUnlock && (
        <motion.div variants={fadeUp}>
          <div
            className="rounded-xl p-3"
            style={{
              background: "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.06), hsl(var(--kf-accent1) / 0.04))",
              border: "1px solid hsl(var(--kf-accent2) / 0.12)",
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
              <span className="text-xs font-semibold" style={{ color: "hsl(var(--kf-accent2))" }}>Next Unlock</span>
            </div>
            <p className="text-xs" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              Complete your <strong>{data.nextUnlock.label}</strong> layer ({data.nextUnlock.currentScore}% done) to unlock:
            </p>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {data.nextUnlock.capabilities.map((cap, i) => (
                <span
                  key={i}
                  className="text-[10px] px-2 py-0.5 rounded-md"
                  style={{ background: "hsl(var(--kf-accent2) / 0.1)", color: "hsl(var(--kf-accent2))" }}
                >
                  {cap}
                </span>
              ))}
            </div>
            <button
              onClick={() => onNavigateTab("identity")}
              className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium"
              style={{ color: "hsl(var(--kf-accent2))" }}
            >
              Complete your profile
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
