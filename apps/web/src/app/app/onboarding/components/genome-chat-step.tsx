"use client";

import { useEffect, useState } from "react";
import { Loader2, Dna } from "lucide-react";
import { BlueprintOnboardingChat } from "@/app/app/profile/components/blueprint-onboarding-chat";
import { getGenome, type GenomeIntegrityResult } from "@/lib/api/business-genome";
import { getStoredBusinessId } from "@/lib/workspace";

interface GenomeChatStepProps {
  onComplete: () => void;
}

export function GenomeChatStep({ onComplete }: GenomeChatStepProps) {
  const businessId = getStoredBusinessId();
  const [genome, setGenome] = useState<GenomeIntegrityResult | null>(null);

  useEffect(() => {
    if (!businessId) return;
    getGenome(businessId).then(({ data }) => {
      if (data) setGenome(data);
    });
  }, [businessId]);

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[70vh] lg:h-[calc(100vh-200px)] max-h-[800px]">
      {/* Chat */}
      <div className="flex-1 min-h-0 rounded-2xl border border-border/40 bg-card/40 overflow-hidden">
        <BlueprintOnboardingChat
          businessId={businessId ?? undefined}
          fullPage
          onComplete={onComplete}
          className="h-full"
        />
      </div>

      {/* Progress side panel */}
      <div className="lg:w-72 shrink-0 rounded-2xl border border-border/40 bg-card/40 p-4 space-y-4 overflow-y-auto">
        <div className="flex items-center gap-2">
          <Dna className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
          <h3 className="text-sm font-semibold">Business Genome</h3>
        </div>

        {!genome ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs">Loading progress…</span>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Answer KEY&apos;s questions to unlock your full dashboard. You need
              all three pillars at 50% or higher.
            </p>

            <Pillar label="Founder" score={genome.genomeDnaScores?.founder ?? 0} />
            <Pillar label="Business" score={genome.genomeDnaScores?.business ?? 0} />
            <Pillar label="Market" score={genome.genomeDnaScores?.market ?? 0} />

            {genome.threePillarMinimumMet && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-center">
                <p className="text-xs font-medium text-emerald-500">
                  Three-Pillar Minimum met!
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Pillar({ label, score }: { label: string; score: number }) {
  const color =
    score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-[hsl(var(--kf-accent1))]" : "bg-amber-500";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{score}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}
