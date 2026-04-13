"use client";

import { useMemo } from "react";
import {
  Sparkles, Brain, ArrowRight, CheckCircle2, AlertCircle,
  Briefcase, TrendingUp, Users, Target, Building2,
  FileText, Zap, BarChart3, Shield, Clock,
} from "lucide-react";
import type { ProfileBusinessData } from "./profile-types";

interface IntelligenceTier {
  tierId: string;
  label: string;
  score: number;
  description: string;
}

interface OverviewTabProps {
  businessData: ProfileBusinessData | null;
  profileCompleteness: number;
  intelligenceTiers: IntelligenceTier[];
  overallIntelligenceScore: number;
  completenessItems: Array<{ label: string; done: boolean }>;
  onNavigateTab: (tab: string) => void;
}

interface NextStep {
  label: string;
  reason: string;
  tab: string;
  icon: React.ElementType;
  priority: "high" | "medium" | "low";
}

const FIELD_ICONS: Record<string, React.ElementType> = {
  Business: Building2,
  Industry: Briefcase,
  Stage: TrendingUp,
  Team: Users,
  Location: Target,
};

export function OverviewTab({
  businessData,
  profileCompleteness,
  intelligenceTiers,
  overallIntelligenceScore,
  completenessItems,
  onNavigateTab,
}: OverviewTabProps) {
  const contextItems = useMemo(() => [
    { label: "Business", value: businessData?.name, icon: Building2 },
    { label: "Industry", value: businessData?.industry, icon: Briefcase },
    { label: "Stage", value: businessData?.businessStage?.replace(/_/g, " "), icon: TrendingUp },
    { label: "Team", value: businessData?.teamSize?.replace(/_/g, " "), icon: Users },
    { label: "Location", value: [businessData?.city, businessData?.country].filter(Boolean).join(", "), icon: Target },
  ].filter((i) => i.value), [businessData]);

  const missingFields = useMemo(() => {
    const checks = [
      { field: "Business Name", missing: !businessData?.name, tab: "business" },
      { field: "Industry", missing: !businessData?.industry, tab: "professional" },
      { field: "Business Stage", missing: !businessData?.businessStage, tab: "professional" },
      { field: "Team Size", missing: !businessData?.teamSize, tab: "business" },
      { field: "Location", missing: !(businessData?.city || businessData?.country), tab: "professional" },
      { field: "Business Description", missing: !businessData?.description, tab: "business" },
      { field: "Tagline", missing: !businessData?.tagline, tab: "business" },
      { field: "Professional Headline", missing: !businessData?.headline, tab: "professional" },
      { field: "Bio", missing: !businessData?.bio, tab: "professional" },
      { field: "Skills", missing: !(businessData?.skills?.length), tab: "professional" },
    ];
    return checks.filter((c) => c.missing);
  }, [businessData]);

  const nextSteps: NextStep[] = useMemo(() => {
    const steps: NextStep[] = [];

    if (!businessData?.name) {
      steps.push({
        label: "Add your business name",
        reason: "Powers invoices, storefront, and all customer-facing pages",
        tab: "business",
        icon: Building2,
        priority: "high",
      });
    }
    if (!businessData?.industry) {
      steps.push({
        label: "Set your industry",
        reason: "Powers templates, recommended documents, and strategy guidance",
        tab: "professional",
        icon: Briefcase,
        priority: "high",
      });
    }
    if (!businessData?.businessStage) {
      steps.push({
        label: "Define your business stage",
        reason: "Powers growth recommendations and intelligence package logic",
        tab: "professional",
        icon: TrendingUp,
        priority: "high",
      });
    }
    if (!businessData?.description) {
      steps.push({
        label: "Write a business description",
        reason: "Improves AI-generated documents and public profile quality",
        tab: "business",
        icon: FileText,
        priority: "medium",
      });
    }
    if (!businessData?.teamSize) {
      steps.push({
        label: "Set your team size",
        reason: "Improves staffing, operations, and automation recommendations",
        tab: "business",
        icon: Users,
        priority: "medium",
      });
    }
    if (!businessData?.headline) {
      steps.push({
        label: "Add a professional headline",
        reason: "Shapes your public profile and marketplace presence",
        tab: "professional",
        icon: Sparkles,
        priority: "medium",
      });
    }
    if (!(businessData?.skills?.length)) {
      steps.push({
        label: "Add your skills & expertise",
        reason: "Enables smarter project templates and service matching",
        tab: "professional",
        icon: Zap,
        priority: "low",
      });
    }
    if (!businessData?.businessHours) {
      steps.push({
        label: "Set operating hours",
        reason: "Controls booking availability and storefront display",
        tab: "business",
        icon: Clock,
        priority: "low",
      });
    }

    return steps.slice(0, 5);
  }, [businessData]);

  const keyUnlocks = useMemo(() => {
    const unlocks = [];

    if (businessData?.industry && businessData?.businessStage) {
      unlocks.push({
        label: "Growth Recommendations",
        description: "Stage-aware guidance across Revenue, Content, and Flows",
        icon: TrendingUp,
        active: true,
      });
    }
    if (businessData?.name && businessData?.description) {
      unlocks.push({
        label: "Document Generation",
        description: "AI-powered business documents based on your identity",
        icon: FileText,
        active: true,
      });
    }
    if (businessData?.teamSize) {
      unlocks.push({
        label: "Automation Intelligence",
        description: "Scale-appropriate automation and workflow suggestions",
        icon: Zap,
        active: true,
      });
    }

    if (!businessData?.industry || !businessData?.businessStage) {
      unlocks.push({
        label: "Growth Recommendations",
        description: "Complete Industry & Stage to unlock",
        icon: TrendingUp,
        active: false,
      });
    }
    if (!businessData?.name || !businessData?.description) {
      unlocks.push({
        label: "Document Generation",
        description: "Complete Business Name & Description to unlock",
        icon: FileText,
        active: false,
      });
    }

    return unlocks.slice(0, 5);
  }, [businessData]);

  const completedSteps = completenessItems.filter((i) => i.done).length;
  const totalSteps = completenessItems.length;
  const foundationPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const foundationColor =
    foundationPct >= 80 ? "var(--kf-success)" : foundationPct >= 50 ? "var(--kf-warning)" : "var(--kf-accent1)";

  const intelligenceColor =
    overallIntelligenceScore >= 80 ? "var(--kf-success)" : overallIntelligenceScore >= 50 ? "var(--kf-warning)" : "var(--kf-accent1)";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div
          className="rounded-xl p-4"
          style={{
            background: "hsl(var(--kf-card))",
            border: "1px solid hsl(var(--kf-border) / 0.3)",
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: `hsl(${foundationColor} / 0.12)` }}
              >
                <BarChart3 className="w-4 h-4" style={{ color: `hsl(${foundationColor})` }} />
              </div>
              <div>
                <p className="text-sm font-semibold">Business Foundation</p>
                <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                  {completedSteps}/{totalSteps} steps complete
                </p>
              </div>
            </div>
            <span className="text-lg font-bold" style={{ color: `hsl(${foundationColor})` }}>
              {foundationPct}%
            </span>
          </div>
          <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted) / 0.2)" }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${foundationPct}%`, background: `hsl(${foundationColor})` }}
            />
          </div>
          {missingFields.length > 0 && (
            <p className="text-[10px] mt-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              {missingFields.length} field{missingFields.length > 1 ? "s" : ""} missing
            </p>
          )}
        </div>

        <div
          className="rounded-xl p-4"
          style={{
            background: "hsl(var(--kf-card))",
            border: "1px solid hsl(var(--kf-border) / 0.3)",
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: `hsl(${intelligenceColor} / 0.12)` }}
              >
                <Brain className="w-4 h-4" style={{ color: `hsl(${intelligenceColor})` }} />
              </div>
              <div>
                <p className="text-sm font-semibold">Intelligence Readiness</p>
                <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                  {intelligenceTiers.filter((t) => t.score >= 100).length}/{intelligenceTiers.length} layers complete
                </p>
              </div>
            </div>
            <span className="text-lg font-bold" style={{ color: `hsl(${intelligenceColor})` }}>
              {overallIntelligenceScore}%
            </span>
          </div>
          <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted) / 0.2)" }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${overallIntelligenceScore}%`, background: `hsl(${intelligenceColor})` }}
            />
          </div>
          <button
            onClick={() => onNavigateTab("intelligence")}
            className="text-[10px] mt-2 flex items-center gap-1 hover:underline"
            style={{ color: "hsl(var(--kf-accent1))" }}
          >
            View full intelligence breakdown
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div
        className="rounded-xl p-4"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), hsl(var(--kf-accent2) / 0.04))",
          border: "1px solid hsl(var(--kf-accent1) / 0.12)",
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="text-xs font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
            What KEYFLOWOS sees
          </span>
        </div>
        {contextItems.length > 0 ? (
          <>
            <div className="flex flex-wrap gap-2" role="list" aria-label="Business context">
              {contextItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    role="listitem"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
                    style={{
                      background: "hsl(var(--kf-card))",
                      border: "1px solid hsl(var(--kf-border) / 0.2)",
                    }}
                  >
                    <Icon className="w-3 h-3" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                    <span style={{ color: "hsl(var(--kf-muted-foreground))" }}>{item.label}:</span>
                    <span className="font-medium">{item.value}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] mt-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              This data powers AI recommendations, documents, templates, and module-level guidance across KeyFlow.
            </p>
          </>
        ) : (
          <div className="text-center py-4">
            <p className="text-xs" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              No business data yet. Start by completing your business profile.
            </p>
            <button
              onClick={() => onNavigateTab("business")}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}
            >
              Set up business
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {intelligenceTiers.length > 0 && (
        <div
          className="rounded-xl p-4"
          style={{
            background: "hsl(var(--kf-card))",
            border: "1px solid hsl(var(--kf-border) / 0.3)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Brain className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
            <span className="text-xs font-semibold">Intelligence Layers</span>
          </div>
          <div className="space-y-2">
            {intelligenceTiers.map((tier) => {
              const isComplete = tier.score >= 100;
              return (
                <div key={tier.tierId} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">{tier.label}</span>
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{
                          background: isComplete ? "hsl(var(--kf-success) / 0.12)" : "hsl(var(--kf-muted) / 0.15)",
                          color: isComplete ? "hsl(var(--kf-success))" : "hsl(var(--kf-muted-foreground))",
                        }}
                      >
                        {tier.score}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted) / 0.15)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${tier.score}%`,
                          background: isComplete ? "hsl(var(--kf-success))" : "hsl(var(--kf-accent2))",
                        }}
                      />
                    </div>
                  </div>
                  {isComplete ? (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 flex-shrink-0" style={{ borderColor: "hsl(var(--kf-muted-foreground) / 0.3)" }} />
                  )}
                </div>
              );
            })}
          </div>
          <button
            onClick={() => onNavigateTab("intelligence")}
            className="mt-3 w-full flex items-center justify-center gap-1 text-xs font-medium py-2 rounded-lg transition-colors"
            style={{ background: "hsl(var(--kf-muted) / 0.1)", color: "hsl(var(--kf-accent2))" }}
          >
            View detailed intelligence
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {nextSteps.length > 0 && (
        <div
          className="rounded-xl p-4"
          style={{
            background: "hsl(var(--kf-card))",
            border: "1px solid hsl(var(--kf-border) / 0.3)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
            <span className="text-xs font-semibold">Recommended Next Steps</span>
          </div>
          <div className="space-y-2">
            {nextSteps.map((step, idx) => {
              const Icon = step.icon;
              return (
                <button
                  key={idx}
                  onClick={() => onNavigateTab(step.tab)}
                  className="w-full flex items-start gap-3 p-2.5 rounded-lg text-left transition-colors hover:bg-[hsl(var(--kf-muted)/0.08)]"
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{
                      background: step.priority === "high"
                        ? "hsl(var(--kf-accent1) / 0.12)"
                        : step.priority === "medium"
                          ? "hsl(var(--kf-accent2) / 0.12)"
                          : "hsl(var(--kf-muted) / 0.15)",
                    }}
                  >
                    <Icon
                      className="w-3.5 h-3.5"
                      style={{
                        color: step.priority === "high"
                          ? "hsl(var(--kf-accent1))"
                          : step.priority === "medium"
                            ? "hsl(var(--kf-accent2))"
                            : "hsl(var(--kf-muted-foreground))",
                      }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{step.label}</p>
                    <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                      {step.reason}
                    </p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 flex-shrink-0 mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {keyUnlocks.length > 0 && (
        <div
          className="rounded-xl p-4"
          style={{
            background: "hsl(var(--kf-card))",
            border: "1px solid hsl(var(--kf-border) / 0.3)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
            <span className="text-xs font-semibold">Key Unlocks</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {keyUnlocks.map((unlock, idx) => {
              const Icon = unlock.icon;
              return (
                <div
                  key={idx}
                  className="flex items-start gap-2.5 p-3 rounded-lg"
                  style={{
                    background: unlock.active ? "hsl(var(--kf-success) / 0.06)" : "hsl(var(--kf-muted) / 0.06)",
                    border: `1px solid ${unlock.active ? "hsl(var(--kf-success) / 0.15)" : "hsl(var(--kf-border) / 0.15)"}`,
                  }}
                >
                  {unlock.active ? (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-success))" }} />
                  ) : (
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{unlock.label}</p>
                    <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                      {unlock.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
