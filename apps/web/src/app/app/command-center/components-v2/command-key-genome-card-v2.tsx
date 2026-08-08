"use client";

import { Dna, ArrowRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { openKey } from "@/components/key";
import { Surface } from "@/components/ui-v2/surface";
import { ProgressRing } from "@/components/ui-v2/progress-ring";
import { StatOrb } from "@/components/ui-v2/stat-orb";
import { Badge } from "@/components/ui-v2/badge";
import type { CommandCenterKeyGenome } from "@/lib/api/business-command-center";

interface CommandKeyGenomeCardV2Props {
  keyGenome: CommandCenterKeyGenome;
}

export function CommandKeyGenomeCardV2({ keyGenome }: CommandKeyGenomeCardV2Props) {
  const hasFacts = keyGenome.sections.length > 0;
  const overallColor = keyGenome.overall >= 70 ? "teal" : keyGenome.overall >= 40 ? "gold" : "rose";

  return (
    <Surface className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet/10">
          <Dna className="h-5 w-5 text-violet" />
        </div>
        <div>
          <h3 className="font-display text-sm font-semibold text-foreground">KEY Genome</h3>
          <p className="text-[10px] text-muted-foreground">
            {hasFacts ? "Evidence-backed readiness" : "Not populated yet"}
          </p>
        </div>
      </div>

      {!hasFacts ? (
        <div className="rounded-xl p-3 bg-surface-muted flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            Run Blueprint backfill to unlock readiness intelligence.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <ProgressRing value={keyGenome.overall} size={80} thickness={8} color={overallColor}>
              <div className="text-center">
                <span
                  className={cn(
                    "font-display text-xl font-bold",
                    overallColor === "teal" && "text-mint",
                    overallColor === "gold" && "text-gold",
                    overallColor === "rose" && "text-rose",
                  )}
                >
                  {keyGenome.overall}
                </span>
                <span className="block text-[10px] text-muted-foreground uppercase tracking-wide">Overall</span>
              </div>
            </ProgressRing>
            <div className="flex-1 grid grid-cols-2 gap-2">
              <StatOrb
                label="Confidence"
                value={`${keyGenome.confidence}%`}
                color={keyGenome.confidence >= 70 ? "teal" : keyGenome.confidence >= 40 ? "gold" : "orange"}
              />
              <StatOrb label="Integrity" value={`${keyGenome.integrity}%`} color="violet" />
              <StatOrb label="Readiness" value={`${keyGenome.readiness}%`} color="teal" />
            </div>
          </div>

          {keyGenome.weakestSections.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Weakest sections</div>
              <div className="space-y-1">
                {keyGenome.weakestSections.map((s) => (
                  <div
                    key={s.section}
                    className="flex items-center justify-between rounded-xl bg-surface-muted px-2 py-1"
                  >
                    <span className="text-[10px] font-medium text-foreground">
                      {s.section.replace(/_/g, " ")}
                    </span>
                    <Badge color={s.overall >= 70 ? "mint" : s.overall >= 40 ? "gold" : "rose"}>
                      {s.overall}%
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {keyGenome.crossDomain && (
            <div className="rounded-xl border border-violet/20 bg-violet/5 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-foreground uppercase tracking-wide">
                  Cross-domain view
                </span>
                <Badge
                  color={
                    keyGenome.crossDomain.overallRiskLevel === "LOW"
                      ? "mint"
                      : keyGenome.crossDomain.overallRiskLevel === "MEDIUM"
                        ? "gold"
                        : "rose"
                  }
                >
                  {keyGenome.crossDomain.overallRiskLevel} risk
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <StatOrb label="Health" value={`${keyGenome.crossDomain.healthScore}%`} color="teal" />
                <StatOrb label="Ready" value={`${keyGenome.crossDomain.readinessScore}%`} color="gold" />
                <StatOrb label="Conf" value={`${keyGenome.crossDomain.confidenceScore}%`} color="violet" />
              </div>
              <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                <Badge color="orange">{keyGenome.crossDomain.topRecommendations.length} ranked recs</Badge>
                <Badge color="gold">{keyGenome.crossDomain.topOpportunities.length} opportunities</Badge>
                {keyGenome.crossDomain.unsafeAutomationBlocks.length > 0 && (
                  <Badge color="rose">
                    {keyGenome.crossDomain.unsafeAutomationBlocks.length} blocked
                  </Badge>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <button
        onClick={() => openKey({ mode: "onboarding" })}
        className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
      >
        {hasFacts ? "Improve Genome" : "Populate Genome"} <ArrowRight className="w-3 h-3" />
      </button>
    </Surface>
  );
}
