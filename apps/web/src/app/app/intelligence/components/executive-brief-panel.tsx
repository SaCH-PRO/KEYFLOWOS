"use client";

import { Brain, Dna, Shield, TrendingUp, Calendar, Download, FileText } from "lucide-react";
import { motion } from "framer-motion";
import { SectionCard } from "@/components/ui/section-card";
import { IntelligencePriorityList } from "./intelligence-priority-list";
import type { BusinessExecutiveBrief } from "@/lib/api/intelligence";
import { getDocumentPackExportUrl } from "@/lib/api/business-genome";
import { getStoredBusinessId } from "@/lib/workspace";

interface ExecutiveBriefPanelProps {
  brief: BusinessExecutiveBrief;
}

function scoreColor(score: number): string {
  if (score >= 80) return "hsl(var(--kf-success))";
  if (score >= 50) return "hsl(var(--kf-accent1))";
  return "hsl(var(--kf-warning))";
}

function scoreBg(score: number): string {
  if (score >= 80) return "hsl(var(--kf-success) / 0.08)";
  if (score >= 50) return "hsl(var(--kf-accent1) / 0.08)";
  return "hsl(var(--kf-warning) / 0.08)";
}

export function ExecutiveBriefPanel({ brief }: ExecutiveBriefPanelProps) {
  const businessId = getStoredBusinessId();
  const generatedAt = new Date(brief.generatedAt).toLocaleString();

  const openExport = (format: "pdf" | "docx") => {
    if (!businessId) return;
    window.open(getDocumentPackExportUrl(businessId, "executive-brief", format), "_blank");
  };

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-5"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-card)) 0%, hsl(var(--kf-muted) / 0.1) 100%)",
          border: "1px solid hsl(var(--kf-border) / 0.2)",
        }}
      >
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
            <h2 className="text-sm font-semibold text-foreground">Executive Brief</h2>
          </div>
          <div className="flex items-center gap-1.5">
            <ExportButton label="PDF" onClick={() => openExport("pdf")} />
            <ExportButton label="DOCX" onClick={() => openExport("docx")} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{brief.summary}</p>
        <div className="flex items-center gap-1.5 mt-3 text-[10px] text-muted-foreground">
          <Calendar className="w-3 h-3" />
          Generated {generatedAt}
        </div>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ScoreCard label="Genome Integrity" score={brief.genomeIntegrity} icon={Dna} />
        <ScoreCard label="Executive Readiness" score={brief.executiveReadinessScore} icon={TrendingUp} />
        <StageCard stage={brief.genomeStage} />
      </div>

      <SectionCard
        title="Top Priorities"
        subtitle={`${brief.topPriorities.length} item${brief.topPriorities.length === 1 ? "" : "s"} need attention`}
        icon={Shield}
        noPadding
        compact
      >
        <div className="p-3">
          <IntelligencePriorityList priorities={brief.topPriorities} />
        </div>
      </SectionCard>
    </div>
  );
}

function ScoreCard({
  label,
  score,
  icon: Icon,
}: {
  label: string;
  score: number;
  icon: React.ElementType;
}) {
  const color = scoreColor(score);
  const bg = scoreBg(score);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-xl p-4 flex items-center gap-3"
      style={{ background: "hsl(var(--kf-card) / 0.6)", border: "1px solid hsl(var(--kf-border) / 0.2)" }}
    >
      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <div>
        <div className="text-lg font-bold tabular-nums" style={{ color }}>
          {score}%
        </div>
        <div className="text-[10px] text-muted-foreground font-medium">{label}</div>
      </div>
    </motion.div>
  );
}

function StageCard({ stage }: { stage: string }) {
  const display = stage.replace(/_/g, " ");
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-xl p-4 flex items-center gap-3"
      style={{ background: "hsl(var(--kf-card) / 0.6)", border: "1px solid hsl(var(--kf-border) / 0.2)" }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: "hsl(var(--kf-accent2) / 0.08)" }}
      >
        <Shield className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
      </div>
      <div>
        <div className="text-sm font-bold text-foreground">{display}</div>
        <div className="text-[10px] text-muted-foreground font-medium">Genome Stage</div>
      </div>
    </motion.div>
  );
}

function ExportButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors hover:bg-[hsl(var(--kf-accent1))]/10 hover:text-[hsl(var(--kf-accent1))]"
      style={{ background: "hsl(var(--kf-muted) / 0.12)" }}
      title={`Export ${label}`}
    >
      <FileText className="w-3 h-3" />
      <span>{label}</span>
      <Download className="w-3 h-3" />
    </button>
  );
}
