"use client";

import { useEffect, useState } from "react";
import { FileText, ScrollText, BarChart3, Shield, TrendingUp, ArrowRight, Loader2 } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { getConstitution, type GenomeIntegrityResult } from "@/lib/api/business-genome";

interface GenomeReportsPanelProps {
  genome: GenomeIntegrityResult;
  onOpenConstitution: () => void;
  onOpenDnaSections: () => void;
}

interface ConstitutionPreview {
  version?: number;
  generatedAt?: string;
  genomeIntegrity?: number;
}

export function GenomeReportsPanel({ genome, onOpenConstitution, onOpenDnaSections }: GenomeReportsPanelProps) {
  const businessId = getStoredBusinessId();
  const [constitution, setConstitution] = useState<ConstitutionPreview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    getConstitution(businessId).then(({ data }) => {
      if (data) {
        setConstitution({
          version: (data.version as number) ?? 1,
          generatedAt: (data.generatedAt as string) ?? undefined,
          genomeIntegrity: (data.genomeIntegrity as number) ?? genome.genomeIntegrity,
        });
      }
      setLoading(false);
    });
  }, [businessId, genome.genomeIntegrity]);

  const generatedAtText = constitution?.generatedAt
    ? new Date(constitution.generatedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Reports &amp; Documents</h3>
        <p className="text-xs text-muted-foreground">
          Previews of documents generated from your Business Genome. Nothing here blocks your progress.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Constitution */}
        <div className="kf-card p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
            >
              <ScrollText className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
            </div>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: "hsl(var(--kf-success) / 0.1)", color: "hsl(var(--kf-success))" }}
            >
              Available
            </span>
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold">Constitution</h4>
            <p className="text-xs text-muted-foreground mt-1">
              A read-only operating document assembled from your Genome Integrity and DNA Sections.
            </p>
            {loading ? (
              <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Checking latest version...
              </div>
            ) : (
              <div className="mt-3 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Version</span>
                  <span className="font-medium">v{constitution?.version ?? 1}</span>
                </div>
                {generatedAtText && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Generated</span>
                    <span className="font-medium">{generatedAtText}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Genome Integrity</span>
                  <span className="font-medium">{constitution?.genomeIntegrity ?? genome.genomeIntegrity}%</span>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={onOpenConstitution}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
            style={{ background: "hsl(var(--kf-accent1))", color: "#fff" }}
          >
            Open Constitution
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Blueprint Summary */}
        <div className="kf-card p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}
            >
              <FileText className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
            </div>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: "hsl(var(--kf-success) / 0.1)", color: "hsl(var(--kf-success))" }}
            >
              Available
            </span>
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold">Business Genome Summary</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Integrity score, stage, and per-section DNA strength.
            </p>
            <div className="mt-3 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Genome Integrity</span>
                <span className="font-medium">{genome.genomeIntegrity}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Stage</span>
                <span className="font-medium">{genome.genomeStage.replace(/_/g, " ")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">DNA Sections</span>
                <span className="font-medium">{genome.dnaSections.length}</span>
              </div>
            </div>
          </div>
          <button
            onClick={onOpenDnaSections}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[hsl(var(--kf-border)/0.3)] hover:bg-muted transition-colors"
          >
            Review DNA Sections
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* SWOT */}
        <div className="kf-card p-4 flex flex-col gap-3 opacity-75">
          <div className="flex items-start justify-between gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "hsl(var(--kf-warning) / 0.1)" }}
            >
              <Shield className="w-5 h-5" style={{ color: "hsl(var(--kf-warning))" }} />
            </div>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: "hsl(var(--kf-muted) / 0.15)", color: "hsl(var(--kf-muted-foreground))" }}
            >
              Coming soon
            </span>
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold">SWOT Analysis</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Strengths, weaknesses, opportunities, and threats derived from your Genome.
            </p>
          </div>
        </div>

        {/* Financial Projections */}
        <div className="kf-card p-4 flex flex-col gap-3 opacity-75">
          <div className="flex items-start justify-between gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "hsl(var(--kf-success) / 0.1)" }}
            >
              <BarChart3 className="w-5 h-5" style={{ color: "hsl(var(--kf-success))" }} />
            </div>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: "hsl(var(--kf-muted) / 0.15)", color: "hsl(var(--kf-muted-foreground))" }}
            >
              Coming soon
            </span>
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold">Financial Projections</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Model runway, revenue targets, and unit economics from Financial DNA.
            </p>
          </div>
        </div>

        {/* Operational Playbook */}
        <div className="kf-card p-4 flex flex-col gap-3 opacity-75">
          <div className="flex items-start justify-between gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "hsl(var(--kf-violet-accent, 260 70% 60%) / 0.1)" }}
            >
              <TrendingUp className="w-5 h-5" style={{ color: "hsl(var(--kf-violet-accent, 260 70% 60%))" }} />
            </div>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: "hsl(var(--kf-muted) / 0.15)", color: "hsl(var(--kf-muted-foreground))" }}
            >
              Coming soon
            </span>
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold">Operational Playbook</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Standard operating procedures built from Operations and Technology DNA.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
