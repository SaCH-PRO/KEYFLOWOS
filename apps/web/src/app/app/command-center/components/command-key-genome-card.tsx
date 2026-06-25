"use client";

import { useRouter } from "next/navigation";
import { Dna, ArrowRight, AlertTriangle } from "lucide-react";
import type { CommandCenterKeyGenome } from "@/lib/api/business-command-center";

interface CommandKeyGenomeCardProps {
  keyGenome: CommandCenterKeyGenome;
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "neutral" | "warning" | "danger" | "success" }) {
  const color = {
    neutral: "text-muted-foreground",
    warning: "text-[hsl(var(--kf-warning))]",
    danger: "text-destructive",
    success: "text-[hsl(var(--kf-success))]",
  }[tone ?? "neutral"];

  return (
    <div className="rounded-xl p-2 bg-muted/30">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${color}`}>{value}%</div>
    </div>
  );
}

export function CommandKeyGenomeCard({ keyGenome }: CommandKeyGenomeCardProps) {
  const router = useRouter();
  const hasFacts = keyGenome.sections.length > 0;

  const overallTone = keyGenome.overall >= 70 ? "success" : keyGenome.overall >= 40 ? "warning" : "danger";

  return (
    <div className="rounded-2xl border border-border/30 bg-card/40 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center">
          <Dna className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">KEY Genome</h3>
          <p className="text-[10px] text-muted-foreground">
            {hasFacts ? "Evidence-backed readiness" : "Not populated yet"}
          </p>
        </div>
      </div>

      {!hasFacts ? (
        <div className="rounded-xl p-3 bg-muted/30 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground mt-0.5" />
          <p className="text-xs text-muted-foreground">
            Run Blueprint backfill to unlock readiness intelligence.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Overall" value={keyGenome.overall} tone={overallTone} />
            <Metric label="Confidence" value={keyGenome.confidence} tone={keyGenome.confidence >= 70 ? "success" : keyGenome.confidence >= 40 ? "warning" : "danger"} />
            <Metric label="Integrity" value={keyGenome.integrity} />
            <Metric label="Readiness" value={keyGenome.readiness} />
          </div>

          {keyGenome.weakestSections.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] text-muted-foreground">Weakest sections</div>
              <div className="space-y-1">
                {keyGenome.weakestSections.map((s) => (
                  <div
                    key={s.section}
                    className="flex items-center justify-between rounded-lg bg-muted/30 px-2 py-1"
                  >
                    <span className="text-[10px] font-medium text-foreground">
                      {s.section.replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{s.overall}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {keyGenome.crossDomain && (
            <div className="rounded-xl border border-[hsl(var(--kf-accent1))]/20 bg-[hsl(var(--kf-accent1))]/5 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-foreground">Cross-domain view</span>
                <span
                  className={`text-[10px] font-medium ${
                    keyGenome.crossDomain.overallRiskLevel === "LOW"
                      ? "text-[hsl(var(--kf-success))]"
                      : keyGenome.crossDomain.overallRiskLevel === "MEDIUM"
                        ? "text-[hsl(var(--kf-warning))]"
                        : "text-destructive"
                  }`}
                >
                  {keyGenome.crossDomain.overallRiskLevel} risk
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Health" value={keyGenome.crossDomain.healthScore} />
                <Metric label="Ready" value={keyGenome.crossDomain.readinessScore} />
                <Metric label="Conf" value={keyGenome.crossDomain.confidenceScore} />
              </div>
              <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                <span>{keyGenome.crossDomain.topRecommendations.length} ranked recs</span>
                <span>•</span>
                <span>{keyGenome.crossDomain.topOpportunities.length} opportunities</span>
                {keyGenome.crossDomain.unsafeAutomationBlocks.length > 0 && (
                  <>
                    <span>•</span>
                    <span className="text-destructive">
                      {keyGenome.crossDomain.unsafeAutomationBlocks.length} blocked
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <button
        onClick={() => router.push("/app/profile?tab=business-genome")}
        className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--kf-accent1))] hover:text-[hsl(var(--kf-accent1))]/80 transition-colors"
      >
        {hasFacts ? "Improve Genome" : "Populate Genome"} <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  );
}
