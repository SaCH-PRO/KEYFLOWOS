"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Scale, ShieldCheck, AlertCircle, CheckCircle2 } from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiGet } from "@/lib/api";
import { getReadiness } from "@/lib/api/business-genesis";
import type { BlueprintData, ComplianceItem, GenesisReadinessScore } from "@/lib/blueprint-types";
import { LegalChecklist } from "./components/LegalChecklist";
import { LegalDocumentPack } from "./components/LegalDocumentPack";
import { RiskRegisterSummary } from "./components/RiskRegisterSummary";

interface LegalReadiness {
  legal: number;
  compliance: number;
  overall: number;
}

function ScoreCard({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="kf-card p-4 flex flex-col items-center justify-center gap-2"
      style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
    >
      <span className="text-2xl font-bold" style={{ color }}>
        {score}
      </span>
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
    </motion.div>
  );
}

function getScoreColor(score: number): string {
  if (score >= 70) return "hsl(var(--kf-success))";
  if (score >= 40) return "hsl(var(--kf-warning))";
  return "hsl(var(--kf-error))";
}

export default function LegalHubPage() {
  const [businessId] = useState<string | null>(() => getStoredBusinessId());
  const [readiness, setReadiness] = useState<GenesisReadinessScore | null>(null);
  const [blueprint, setBlueprint] = useState<BlueprintData | null>(null);
  const [complianceItems, setComplianceItems] = useState<ComplianceItem[]>([]);
  const [loading, setLoading] = useState(() => !businessId);

  useEffect(() => {
    const bid = businessId;
    if (!bid) return;

    const load = async () => {
      const [readinessRes, blueprintRes] = await Promise.all([
        getReadiness(bid),
        apiGet<BlueprintData>(`/blueprint/businesses/${bid}`),
      ]);
      if (readinessRes.data) setReadiness(readinessRes.data);
      if (blueprintRes.data) {
        setBlueprint(blueprintRes.data);
        setComplianceItems(blueprintRes.data.complianceProfile?.complianceItems ?? []);
      }
      setLoading(false);
    };

    void load();
  }, [businessId]);

  const disclaimerAccepted = !!blueprint?.legalProfile?.disclaimerAcceptedAt;
  const legalScore = readiness?.legal ?? 0;
  const complianceScore = readiness?.compliance ?? 0;
  const overallScore = readiness?.overall ?? 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <WorkspaceShell
        icon={Scale}
        title="Legal & Compliance Hub"
        subtitle="Track legal readiness, generate documents, and manage risks for your business."
        iconColor="hsl(var(--kf-accent2))"
      >
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="w-8 h-8 rounded-full border-2 border-[hsl(var(--kf-accent2))] border-t-transparent"
            />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <ScoreCard label="Overall readiness" score={overallScore} color={getScoreColor(overallScore)} />
              <ScoreCard label="Legal readiness" score={legalScore} color={getScoreColor(legalScore)} />
              <ScoreCard label="Compliance score" score={complianceScore} color={getScoreColor(complianceScore)} />
            </div>

            <div
              className="kf-card p-4 flex items-start gap-3"
              style={{
                border: disclaimerAccepted
                  ? "1px solid hsl(var(--kf-success) / 0.3)"
                  : "1px solid hsl(var(--kf-warning) / 0.3)",
                background: disclaimerAccepted
                  ? "hsl(var(--kf-success) / 0.05)"
                  : "hsl(var(--kf-warning) / 0.05)",
              }}
            >
              {disclaimerAccepted ? (
                <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-success))" }} />
              ) : (
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-warning))" }} />
              )}
              <div>
                <p className="text-sm font-medium">
                  {disclaimerAccepted
                    ? "Disclaimer accepted"
                    : "Legal disclaimer not accepted"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {disclaimerAccepted
                    ? `Accepted on ${new Date(blueprint?.legalProfile?.disclaimerAcceptedAt || "").toLocaleDateString()}.`
                    : "You must accept the disclaimer before generating legal documents."}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <LegalChecklist items={complianceItems} />
              <div className="space-y-4">
                <LegalDocumentPack blueprint={blueprint} />
                <RiskRegisterSummary />
              </div>
            </div>

            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>
                KEY is not a substitute for professional legal, tax, or financial advice.
              </span>
            </div>
          </div>
        )}
      </WorkspaceShell>
    </div>
  );
}
