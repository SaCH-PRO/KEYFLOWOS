"use client";

import { Dna, ArrowRight } from "lucide-react";
import { openKey } from "@/components/key";
import type { CommandCenterGenome } from "@/lib/api/business-command-center";

interface CommandGenomeCardProps {
  genome: CommandCenterGenome;
}

export function CommandGenomeCard({ genome }: CommandGenomeCardProps) {
  return (
    <div className="rounded-2xl border border-border/30 bg-card/40 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center">
          <Dna className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Business Genome</h3>
          <p className="text-[10px] text-muted-foreground">{genome.stage.replace(/_/g, " ")}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl p-2 bg-muted/30">
          <div className="text-[10px] text-muted-foreground">Integrity</div>
          <div className="text-sm font-semibold">{genome.integrity}%</div>
        </div>
        <div className="rounded-xl p-2 bg-muted/30">
          <div className="text-[10px] text-muted-foreground">Readiness</div>
          <div className="text-sm font-semibold">{genome.readiness}%</div>
        </div>
      </div>
      {genome.pendingProposals.length > 0 && (
        <div className="text-[10px] text-muted-foreground">
          {genome.pendingProposals.length} pending proposal{genome.pendingProposals.length === 1 ? "" : "s"}
        </div>
      )}
      {genome.weakestSections.length > 0 && (
        <div className="text-[10px] text-muted-foreground">
          Weakest: {genome.weakestSections.map((s) => s.title).join(", ")}
        </div>
      )}
      <button
        onClick={() => openKey({ mode: "onboarding" })}
        className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--kf-accent1))] hover:text-[hsl(var(--kf-accent1))]/80 transition-colors"
      >
        Open Genome <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  );
}
