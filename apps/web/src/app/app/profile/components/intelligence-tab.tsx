"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Brain, Sparkles, Target, Users, Zap,
  DollarSign, BarChart3, CheckCircle2,
  AlertCircle, Shield, Calendar, Globe,
  TrendingUp, Lightbulb, ArrowRight, FileText,
} from "lucide-react";
import { ContextDepthCard } from "./context-depth-card";
import { ProgressivePrompts } from "./progressive-prompts";
import BusinessBuilderCard from "./business-builder-card";
import { ProfileSectionErrorBoundary } from "./profile-section-error-boundary";
import type { ProfileBusinessData } from "./profile-types";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

const INSIGHT_CATEGORIES = [
  {
    icon: Target,
    label: "Market Positioning",
    description: "Where your business sits in the competitive landscape",
    requires: ["Industry", "Stage", "Description"],
    color: "--kf-accent1",
    insights: [
      "Industry-specific competitive landscape analysis",
      "Positioning recommendations based on your stage and strengths",
      "Market gap identification from your service offerings",
    ],
  },
  {
    icon: TrendingUp,
    label: "Growth Intelligence",
    description: "Stage-aware growth strategies and opportunities",
    requires: ["Stage", "Team Size", "Industry"],
    color: "--kf-success",
    insights: [
      "Revenue growth trajectory predictions for your stage",
      "Expansion opportunities based on skills and capacity",
      "Next-milestone recommendations for business maturity",
    ],
  },
  {
    icon: Users,
    label: "Client Intelligence",
    description: "Customer patterns and relationship insights",
    requires: ["Industry", "Skills", "Location"],
    color: "--kf-accent2",
    insights: [
      "Ideal customer profile based on your service offering",
      "Client retention strategies for your industry",
      "Pricing confidence from market and stage signals",
    ],
  },
  {
    icon: Zap,
    label: "Automation Intelligence",
    description: "Process optimization and efficiency gains",
    requires: ["Stage", "Team Size"],
    color: "--kf-warning",
    insights: [
      "Workflow automation opportunities for your scale",
      "Process bottleneck identification based on team size",
      "Tool and integration recommendations for efficiency",
    ],
  },
];

const ARCHETYPE_SIGNALS = [
  { label: "Service-based", check: (bd: ProfileBusinessData | null) => bd?.industry && ["consulting", "coaching", "freelance", "professional-services"].some((k) => bd.industry?.toLowerCase().includes(k)) },
  { label: "Product-based", check: (bd: ProfileBusinessData | null) => bd?.industry && ["retail", "ecommerce", "manufacturing", "wholesale"].some((k) => bd.industry?.toLowerCase().includes(k)) },
  { label: "Creative", check: (bd: ProfileBusinessData | null) => bd?.industry && ["design", "photography", "art", "media", "creative"].some((k) => bd.industry?.toLowerCase().includes(k)) },
  { label: "Technology", check: (bd: ProfileBusinessData | null) => bd?.industry && ["tech", "software", "saas", "development", "it"].some((k) => bd.industry?.toLowerCase().includes(k)) },
];

function ConfidencePanel({ businessData }: { businessData?: ProfileBusinessData | null }) {
  const checks = useMemo(() => [
    { label: "Business Name", filled: !!businessData?.name, impact: "High", powers: "Invoices, storefront, customer-facing pages" },
    { label: "Industry", filled: !!businessData?.industry, impact: "High", powers: "Templates, strategy guidance, market intelligence" },
    { label: "Business Stage", filled: !!businessData?.businessStage, impact: "High", powers: "Growth recommendations, intelligence logic" },
    { label: "Description", filled: !!businessData?.description, impact: "Medium", powers: "AI document quality, public profile" },
    { label: "Team Size", filled: !!businessData?.teamSize, impact: "Medium", powers: "Automation fit, operations recommendations" },
    { label: "Location", filled: !!(businessData?.city || businessData?.country), impact: "Medium", powers: "Tax, compliance, local relevance" },
    { label: "Skills", filled: (businessData?.skills?.length ?? 0) > 0, impact: "Low", powers: "Service matching, project templates" },
    { label: "Headline", filled: !!businessData?.headline, impact: "Low", powers: "Public profile, marketplace presence" },
  ], [businessData]);

  const filledCount = checks.filter((c) => c.filled).length;
  const confidenceLevel = filledCount >= 7 ? "High" : filledCount >= 4 ? "Medium" : "Low";
  const confidenceColor = confidenceLevel === "High" ? "--kf-success" : confidenceLevel === "Medium" ? "--kf-warning" : "--kf-error";

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border) / 0.3)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5" style={{ color: `hsl(var(${confidenceColor}))` }} />
          <span className="text-xs font-semibold">Intelligence Confidence</span>
        </div>
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-full"
          style={{ background: `hsl(var(${confidenceColor}) / 0.12)`, color: `hsl(var(${confidenceColor}))` }}
        >
          {confidenceLevel}
        </span>
      </div>
      <p className="text-[10px] mb-3" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
        Intelligence quality depends on the data you provide. Each field strengthens specific AI capabilities across your workspaces.
      </p>
      <div className="space-y-1.5">
        {checks.map((check) => (
          <div key={check.label} className="flex items-center gap-2">
            {check.filled ? (
              <CheckCircle2 className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
            ) : (
              <AlertCircle className="w-3 h-3 flex-shrink-0" style={{ color: check.impact === "High" ? "hsl(var(--kf-error))" : "hsl(var(--kf-warning))" }} />
            )}
            <span className="text-[10px] flex-1" style={{ color: check.filled ? "hsl(var(--kf-muted-foreground))" : "hsl(var(--kf-foreground))" }}>
              {check.label}
            </span>
            <span className="text-[9px] hidden sm:inline" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              {check.powers}
            </span>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{
                background: check.impact === "High" ? "hsl(var(--kf-error) / 0.08)" : check.impact === "Medium" ? "hsl(var(--kf-warning) / 0.08)" : "hsl(var(--kf-muted) / 0.1)",
                color: check.impact === "High" ? "hsl(var(--kf-error))" : check.impact === "Medium" ? "hsl(var(--kf-warning))" : "hsl(var(--kf-muted-foreground))",
              }}
            >
              {check.impact}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-2" style={{ borderTop: "1px solid hsl(var(--kf-border) / 0.15)" }}>
        <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
          <strong>{filledCount}/{checks.length}</strong> data points available.{" "}
          {filledCount < checks.length && (
            <span>Complete {checks.length - filledCount} more field{checks.length - filledCount > 1 ? "s" : ""} to improve intelligence accuracy.</span>
          )}
          {filledCount === checks.length && (
            <span style={{ color: "hsl(var(--kf-success))" }}>All core data points are available. Your intelligence is at maximum confidence.</span>
          )}
        </p>
      </div>
    </div>
  );
}

interface IntelligenceTabProps {
  businessId: string | null;
  businessData?: ProfileBusinessData | null;
}

export function IntelligenceTab({ businessId, businessData }: IntelligenceTabProps) {
  const detectedArchetypes = useMemo(() => {
    return ARCHETYPE_SIGNALS.filter((a) => a.check(businessData || null));
  }, [businessData]);

  const insightAvailability = useMemo(() => {
    const filledFields = new Set<string>();
    if (businessData?.name) filledFields.add("Name");
    if (businessData?.industry) filledFields.add("Industry");
    if (businessData?.businessStage) filledFields.add("Stage");
    if (businessData?.description) filledFields.add("Description");
    if (businessData?.tagline) filledFields.add("Tagline");
    if (businessData?.teamSize) filledFields.add("Team Size");
    if (businessData?.skills?.length) filledFields.add("Skills");
    if (businessData?.city || businessData?.country) filledFields.add("Location");

    return INSIGHT_CATEGORIES.map((cat) => {
      const filled = cat.requires.filter((f) => filledFields.has(f)).length;
      return { ...cat, filled, available: filled === cat.requires.length };
    });
  }, [businessData]);

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
          <Brain className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="text-sm font-semibold">Business Intelligence</span>
          <span
            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full ml-auto"
            style={{ background: "hsl(var(--kf-accent1) / 0.12)", color: "hsl(var(--kf-accent1))" }}
          >
            AI-Powered
          </span>
        </div>
        <p className="text-xs" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
          AI-derived insights generated from your profile data, business context, and industry analysis.
          This is where raw profile data becomes strategic intelligence — the more complete your profile, the deeper and more actionable these insights become.
        </p>
      </motion.div>

      {(detectedArchetypes.length > 0 || businessData?.industry) && (
        <motion.div variants={fadeUp}>
          <div
            className="rounded-xl p-4"
            style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border) / 0.3)" }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
              <span className="text-xs font-semibold">Business Archetype</span>
            </div>
            <p className="text-[10px] mb-2.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              Based on your industry and profile data, KeyFlow detects your business archetype to tailor recommendations, templates, and intelligence outputs.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {detectedArchetypes.length > 0 ? (
                detectedArchetypes.map((a) => (
                  <span
                    key={a.label}
                    className="text-[10px] font-medium px-2.5 py-1 rounded-lg"
                    style={{ background: "hsl(var(--kf-accent2) / 0.1)", color: "hsl(var(--kf-accent2))" }}
                  >
                    {a.label}
                  </span>
                ))
              ) : (
                <span className="text-[10px] px-2.5 py-1 rounded-lg" style={{ background: "hsl(var(--kf-muted) / 0.1)", color: "hsl(var(--kf-muted-foreground))" }}>
                  {businessData?.industry || "Set your industry to detect archetype"}
                </span>
              )}
              {businessData?.businessStage && (
                <span
                  className="text-[10px] font-medium px-2.5 py-1 rounded-lg"
                  style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}
                >
                  {businessData.businessStage.replace(/_/g, " ")}
                </span>
              )}
            </div>
          </div>
        </motion.div>
      )}

      <motion.div variants={fadeUp}>
        <div
          className="rounded-xl p-4"
          style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border) / 0.3)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
            <span className="text-xs font-semibold">AI Insight Categories</span>
          </div>
          <p className="text-[10px] mb-3" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            Each category generates specific insights based on your profile data. Complete the required fields to unlock each category.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {insightAvailability.map((cat) => {
              const Icon = cat.icon;
              return (
                <div
                  key={cat.label}
                  className="rounded-lg p-3"
                  style={{
                    background: cat.available ? `hsl(var(${cat.color}) / 0.04)` : "hsl(var(--kf-muted) / 0.04)",
                    border: `1px solid ${cat.available ? `hsl(var(${cat.color}) / 0.1)` : "hsl(var(--kf-border) / 0.15)"}`,
                    opacity: cat.available ? 1 : 0.7,
                  }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Icon className="w-3.5 h-3.5" style={{ color: cat.available ? `hsl(var(${cat.color}))` : "hsl(var(--kf-muted-foreground))" }} />
                    <span className="text-[11px] font-semibold">{cat.label}</span>
                    {cat.available ? (
                      <CheckCircle2 className="w-3 h-3 ml-auto" style={{ color: `hsl(var(${cat.color}))` }} />
                    ) : (
                      <span className="text-[8px] ml-auto px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-muted) / 0.15)", color: "hsl(var(--kf-muted-foreground))" }}>
                        {cat.filled}/{cat.requires.length}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] mb-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                    {cat.description}
                  </p>
                  <ul className="space-y-0.5">
                    {cat.insights.map((insight, i) => (
                      <li key={i} className="text-[9px] flex items-start gap-1" style={{ color: cat.available ? "hsl(var(--kf-foreground))" : "hsl(var(--kf-muted-foreground))" }}>
                        <span style={{ color: cat.available ? `hsl(var(${cat.color}))` : "hsl(var(--kf-muted-foreground) / 0.5)" }}>•</span>
                        {insight}
                      </li>
                    ))}
                  </ul>
                  {!cat.available && (
                    <p className="text-[9px] mt-1.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                      Needs: {cat.requires.join(", ")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <ConfidencePanel businessData={businessData} />
      </motion.div>

      <motion.div variants={fadeUp}>
        <ProfileSectionErrorBoundary sectionName="Business Intelligence">
          <ContextDepthCard businessId={businessId} />
        </ProfileSectionErrorBoundary>
      </motion.div>

      <motion.div variants={fadeUp}>
        <ProfileSectionErrorBoundary sectionName="Smart Suggestions">
          <ProgressivePrompts businessId={businessId} />
        </ProfileSectionErrorBoundary>
      </motion.div>

      <motion.div variants={fadeUp}>
        <ProfileSectionErrorBoundary sectionName="Business Intelligence Package">
          <BusinessBuilderCard />
        </ProfileSectionErrorBoundary>
      </motion.div>
    </motion.div>
  );
}
