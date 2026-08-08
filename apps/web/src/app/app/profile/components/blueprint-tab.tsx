"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Dna, ExternalLink, Sparkles, TrendingUp, Shield, Target, Users, Wallet, Zap } from "lucide-react";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { BlueprintOnboardingChat, BlueprintOnboardingCTA } from "./blueprint-onboarding-chat";
import type { BlueprintData, BlueprintSectionKey } from "@/lib/blueprint-types";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

const SECTION_META: Array<{
  key: BlueprintSectionKey;
  label: string;
  icon: React.ElementType;
  summary: (bp: BlueprintData) => string;
}> = [
  {
    key: "identity",
    label: "Identity",
    icon: Sparkles,
    summary: (bp) => bp.identity.name || "Business name not set",
  },
  {
    key: "operatingModel",
    label: "Operating Model",
    icon: Zap,
    summary: (bp) => bp.operatingModel.revenueModel || "Revenue model not set",
  },
  {
    key: "goals",
    label: "Goals",
    icon: Target,
    summary: (bp) => bp.goals.northStar || "North star not set",
  },
  {
    key: "constraints",
    label: "Constraints",
    icon: Shield,
    summary: (bp) => bp.constraints.riskTolerance || "Risk tolerance not set",
  },
  {
    key: "brand",
    label: "Brand",
    icon: Dna,
    summary: (bp) => bp.brand.voice || "Brand voice not set",
  },
  {
    key: "customerModel",
    label: "Customer",
    icon: Users,
    summary: (bp) => bp.customerModel.idealCustomer || "Ideal customer not set",
  },
  {
    key: "financials",
    label: "Financials",
    icon: Wallet,
    summary: (bp) =>
      bp.financials.monthlyTarget
        ? `$${bp.financials.monthlyTarget.toLocaleString()} monthly target`
        : "Monthly target not set",
  },
  {
    key: "workflowModel",
    label: "Workflow",
    icon: TrendingUp,
    summary: (bp) => bp.workflowModel.primaryWorkflow || "Primary workflow not set",
  },
];

function SectionScoreCard({
  meta,
  score,
  bp,
}: {
  meta: (typeof SECTION_META)[number];
  score: number;
  bp: BlueprintData;
}) {
  const Icon = meta.icon;
  const complete = score >= 60;
  return (
    <div
      className="rounded-xl p-3 flex items-center gap-3"
      style={{
        background: "hsl(var(--kf-card))",
        border: "1px solid hsl(var(--kf-border) / 0.3)",
      }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{
          background: complete
            ? "hsl(var(--kf-success) / 0.1)"
            : "hsl(var(--kf-muted) / 0.1)",
        }}
      >
        <Icon
          className="w-4 h-4"
          style={{
            color: complete ? "hsl(var(--kf-success))" : "hsl(var(--kf-muted-foreground))",
          }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">{meta.label}</span>
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
            style={{
              background: complete
                ? "hsl(var(--kf-success) / 0.12)"
                : "hsl(var(--kf-warning) / 0.12)",
              color: complete ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))",
            }}
          >
            {score}%
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground truncate">{meta.summary(bp)}</p>
      </div>
    </div>
  );
}

export function BlueprintTab() {
  const [businessId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getStoredBusinessId(),
  );
  const [blueprint, setBlueprint] = useState<BlueprintData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showChat, setShowChat] = useState(false);

  useEffect(() => {
    if (!businessId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async load of Blueprint data
      setLoading(false);
      return;
    }
    apiGet<BlueprintData>(`/blueprint/businesses/${businessId}`)
      .then(({ data }) => {
        if (data) setBlueprint(data);
      })
      .finally(() => setLoading(false));
  }, [businessId]);

  if (loading) {
    return (
      <div className="kf-card p-6 h-96 flex items-center justify-center">
        <div className="animate-pulse text-sm text-muted-foreground">Loading Business Genome...</div>
      </div>
    );
  }

  if (showChat) {
    return (
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="kf-card p-4 sm:p-6"
      >
        <BlueprintOnboardingChat
          businessId={businessId ?? undefined}
          onComplete={() => {
            setShowChat(false);
            if (businessId) {
              apiGet<BlueprintData>(`/blueprint/businesses/${businessId}`).then(({ data }) => {
                if (data) setBlueprint(data);
              });
            }
          }}
        />
      </motion.div>
    );
  }

  const completeness = blueprint?.completeness ?? 0;
  const confidenceScores = blueprint?.confidenceScores ?? {};

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show" className="space-y-4">
      {/* Hero card */}
      <div
        className="rounded-2xl p-5 sm:p-6"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.08), hsl(var(--kf-accent2) / 0.04))",
          border: "1px solid hsl(var(--kf-accent1) / 0.15)",
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Dna className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
              <h2 className="text-lg font-bold">Business Genome</h2>
            </div>
            <p className="text-sm text-muted-foreground max-w-md">
              The structured context KEY uses to think, plan, and act like a digital co-founder for your business.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="text-2xl font-bold">{completeness}%</span>
              <p className="text-xs text-muted-foreground">complete</p>
            </div>
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{
                background: `conic-gradient(hsl(var(--kf-accent1)) ${completeness * 3.6}deg, hsl(var(--kf-border) / 0.3) 0deg)`,
              }}
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: "hsl(var(--kf-background))" }}
              >
                <Sparkles className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => setShowChat(true)}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
            style={{
              background: "hsl(var(--kf-accent1))",
              color: "hsl(var(--kf-accent1-foreground, var(--kf-background)))",
            }}
          >
            <Sparkles className="w-4 h-4" />
            {completeness < 80 ? "Continue with KEY" : "Refine with KEY"}
          </button>
          <a
            href="/app/genome"
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
            style={{
              background: "hsl(var(--kf-card))",
              border: "1px solid hsl(var(--kf-border) / 0.3)",
            }}
          >
            <ExternalLink className="w-4 h-4" />
            Open full editor
          </a>
        </div>
      </div>

      {/* Section scores */}
      {blueprint && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SECTION_META.map((meta) => (
            <SectionScoreCard
              key={meta.key}
              meta={meta}
              score={confidenceScores[meta.key] ?? 0}
              bp={blueprint}
            />
          ))}
        </div>
      )}

      {!blueprint && (
        <div className="kf-card p-6 text-center">
          <p className="text-sm text-muted-foreground">No Business Genome found yet.</p>
          <BlueprintOnboardingCTA className="mt-4" />
        </div>
      )}
    </motion.div>
  );
}
