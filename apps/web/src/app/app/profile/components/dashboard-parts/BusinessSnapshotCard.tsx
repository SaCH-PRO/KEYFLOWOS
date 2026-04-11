"use client";

import { motion } from "framer-motion";
import { Building2, CheckCircle2, AlertCircle } from "lucide-react";
import { DashboardData, fadeUp } from "./types";

export function BusinessSnapshotCard({ data }: { data: DashboardData }) {
  const assessment = data.latestAssessment;
  const scores = assessment?.categoryScores;

  const businessType = assessment?.metrics?.revenueSource || null;
  const status = data.status;
  const stageLabel = status === "ASSESSED"
    ? "Assessed"
    : status === "SUBMITTED"
      ? "Submitted"
      : status === "DRAFT"
        ? "In Progress"
        : "Active";

  return (
    <motion.div variants={fadeUp} className="kf-card p-6 space-y-3 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
        }}
      />
      <div className="relative">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Building2 className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          Business Snapshot
        </div>
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]">
              {stageLabel}
            </span>
            {assessment?.version && (
              <span className="text-[10px] text-muted-foreground">v{assessment.version}</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
            {businessType && (
              <div>
                <span className="text-muted-foreground">Revenue Source:</span>{" "}
                <span className="font-medium">{businessType}</span>
              </div>
            )}
            {scores && (
              <>
                <div>
                  <span className="text-muted-foreground">Clarity:</span>{" "}
                  <span className="font-medium">{scores.clarity ?? "—"}/100</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Profitability:</span>{" "}
                  <span className="font-medium">{scores.profitability ?? "—"}/100</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Growth:</span>{" "}
                  <span className="font-medium">{scores.growth ?? "—"}/100</span>
                </div>
              </>
            )}
          </div>
          {assessment?.strengths && assessment.strengths.length > 0 && (
            <p className="text-[11px] text-emerald-400 mt-1">
              <CheckCircle2 className="w-3 h-3 inline mr-1" />
              Strength: {assessment.strengths[0]}
            </p>
          )}
          {assessment?.weaknesses && assessment.weaknesses.length > 0 && (
            <p className="text-[11px] text-amber-400 mt-0.5">
              <AlertCircle className="w-3 h-3 inline mr-1" />
              Focus area: {assessment.weaknesses[0]}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
