"use client";

import { motion } from "framer-motion";
import { Target, ArrowRight, Loader2, Zap, LayoutDashboard, FileText, ShieldAlert } from "lucide-react";
import type { GenesisReadinessScore, GenesisActionPlan, BlueprintData } from "@/lib/blueprint-types";
import { useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { generateRiskRegister } from "@/lib/api/business-genesis";
import { GenesisComplianceCard } from "./GenesisComplianceCard";
import { GenesisProjectionCard } from "./GenesisProjectionCard";
import { GenesisDocumentPackCard } from "./GenesisDocumentPackCard";
import { GenesisMarketStrategyCard } from "./GenesisMarketStrategyCard";

interface GenesisReadinessPanelProps {
  readiness: GenesisReadinessScore;
  blueprint?: BlueprintData | null;
  onGenerateActionPlan: () => void;
  actionPlan?: GenesisActionPlan | null;
  loadingActionPlan?: boolean;
  onGenerateRiskRegister?: () => void;
  loadingRiskRegister?: boolean;
}

const DOMAINS: { key: keyof Omit<GenesisReadinessScore, "blockers">; label: string }[] = [
  { key: "legal", label: "Legal" },
  { key: "finance", label: "Finance" },
  { key: "market", label: "Market" },
  { key: "operations", label: "Operations" },
  { key: "compliance", label: "Compliance" },
];

function getScoreColor(score: number): string {
  if (score >= 70) return "hsl(var(--kf-success))";
  if (score >= 40) return "hsl(var(--kf-warning))";
  return "hsl(var(--kf-error))";
}

function ScoreRing({ score }: { score: number }) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = getScoreColor(score);

  return (
    <div className="relative w-32 h-32 sm:w-36 sm:h-36">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="hsl(var(--kf-muted))"
          strokeWidth="8"
        />
        <motion.circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl sm:text-3xl font-bold" style={{ color }}>
          {score}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Overall</span>
      </div>
    </div>
  );
}

export function GenesisReadinessPanel({
  readiness,
  blueprint,
  onGenerateActionPlan,
  actionPlan,
  loadingActionPlan = false,
  onGenerateRiskRegister,
  loadingRiskRegister: loadingRiskRegisterProp = false,
}: GenesisReadinessPanelProps) {
  const router = useRouter();
  const [generatingRisk, setGeneratingRisk] = useState(false);

  const handleGenerateRiskRegister = useCallback(async () => {
    if (onGenerateRiskRegister) {
      onGenerateRiskRegister();
      return;
    }
    const bid = getStoredBusinessId();
    if (!bid) return;
    setGeneratingRisk(true);
    const { data, error } = await generateRiskRegister(bid);
    setGeneratingRisk(false);
    if (error || !data) {
      toast.error(error || "Could not generate risk register.");
      return;
    }
    toast.success(`Created ${data.length} risk${data.length === 1 ? "" : "s"} from your blueprint.`);
  }, [onGenerateRiskRegister]);

  const loadingRiskRegister = loadingRiskRegisterProp || generatingRisk;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="text-center space-y-2">
        <h2 className="text-xl sm:text-2xl font-bold">Your Business Readiness</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Scores update as you answer questions. Generate an action plan when you&apos;re ready.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <motion.div
          className="kf-card p-5 flex flex-col items-center justify-center gap-4"
          style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
        >
          <ScoreRing score={readiness.overall} />
          <p className="text-sm text-center text-muted-foreground">
            {readiness.overall >= 80
              ? "Strong foundation — ready to operate."
              : readiness.overall >= 60
                ? "Getting close — a few details left."
                : "Still building — keep answering questions."}
          </p>
        </motion.div>

        <motion.div
          className="kf-card p-5 space-y-4"
          style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
        >
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Target className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Domain breakdown
          </h3>
          <div className="space-y-3">
            {DOMAINS.map(({ key, label }) => {
              const score = readiness[key] ?? 0;
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium">{score}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: getScoreColor(score) }}
                      initial={{ width: 0 }}
                      animate={{ width: `${score}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      </div>

      {readiness.blockers.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="kf-card p-4 space-y-3"
          style={{ border: "1px solid hsl(var(--kf-warning) / 0.25)" }}
        >
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4" style={{ color: "hsl(var(--kf-warning))" }} />
            Blockers to address
          </h3>
          <ul className="space-y-2">
            {readiness.blockers.map((blocker, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span
                  className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                  style={{ background: "hsl(var(--kf-warning))" }}
                />
                {blocker}
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {!actionPlan && (
        <div className="flex justify-center">
          <button
            onClick={onGenerateActionPlan}
            disabled={loadingActionPlan}
            className="kf-btn-glow flex items-center gap-2 px-6 py-3"
          >
            {loadingActionPlan ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Building plan...</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                <span>Generate action plan</span>
              </>
            )}
          </button>
        </div>
      )}

      {actionPlan && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <GenesisProjectionCard actionPlan={actionPlan} blueprint={blueprint} />
          <GenesisComplianceCard
            complianceItems={actionPlan.complianceItems}
            title="Compliance checklist"
          />

          {actionPlan.nextActions.length > 0 && (
            <div
              className="kf-card p-4 space-y-3"
              style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
            >
              <h3 className="text-sm font-semibold">Next actions</h3>
              <ol className="space-y-2">
                {actionPlan.nextActions.map((action, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span
                      className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium"
                      style={{
                        background: "hsl(var(--kf-accent1) / 0.1)",
                        color: "hsl(var(--kf-accent1))",
                      }}
                    >
                      {i + 1}
                    </span>
                    {action}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex-1">
              <GenesisDocumentPackCard blueprint={blueprint} />
            </div>
          </div>

          <GenesisMarketStrategyCard />

          <div className="flex justify-center">
            <button
              onClick={handleGenerateRiskRegister}
              disabled={loadingRiskRegister}
              className="kf-btn-secondary flex items-center gap-2 px-5 py-2.5"
            >
              {loadingRiskRegister ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Generating risks...</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="w-4 h-4" />
                  <span>Generate risk register</span>
                </>
              )}
            </button>
          </div>
        </motion.div>
      )}

      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
        <button
          onClick={() => router.push("/app/command-center")}
          className="kf-btn-primary flex items-center gap-2 px-5 py-2.5"
        >
          <LayoutDashboard className="w-4 h-4" />
          Go to Command Center
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => router.push("/app/genome")}
          className="kf-btn-secondary flex items-center gap-2 px-5 py-2.5"
        >
          <FileText className="w-4 h-4" />
          Continue in Blueprint
        </button>
      </div>
    </motion.div>
  );
}
