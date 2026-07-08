"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getGenome, type GenomeIntegrityResult } from "@/lib/api/business-genome";
import { getStoredBusinessId } from "@/lib/workspace";
import { Dna, Shield, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const STAGE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  CONCEPT: { label: "Concept", color: "text-slate-400", bg: "bg-slate-500/10" },
  VALIDATED_CONCEPT: { label: "Validated", color: "text-blue-400", bg: "bg-blue-500/10" },
  REGISTERED_ENTITY: { label: "Registered", color: "text-emerald-400", bg: "bg-emerald-500/10" },
  REVENUE_ENGINE: { label: "Revenue", color: "text-amber-400", bg: "bg-amber-500/10" },
  OPERATING_BUSINESS: { label: "Operating", color: "text-orange-400", bg: "bg-orange-500/10" },
  GROWTH_BUSINESS: { label: "Growth", color: "text-violet-400", bg: "bg-violet-500/10" },
  ENTERPRISE_READY: { label: "Enterprise", color: "text-teal-400", bg: "bg-teal-500/10" },
};

function IntegrityBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-medium", value >= 80 ? "text-emerald-400" : value >= 50 ? "text-amber-400" : "text-red-400")}>
          {Math.round(value)}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function KeyGenomePreview() {
  const [genome, setGenome] = useState<GenomeIntegrityResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchGenome = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) {
      setLoading(false);
      setError("No business selected");
      return;
    }
    try {
      setError(null);
      const { data } = await getGenome(businessId);
      if (data) setGenome(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchGenome();
    // Poll every 30 seconds for live updates
    intervalRef.current = setInterval(() => {
      void fetchGenome();
    }, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchGenome]);

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Dna className="h-3.5 w-3.5 animate-pulse" />
          <span>Loading genome...</span>
        </div>
        <div className="h-20 rounded-lg bg-muted animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>Failed to load genome</span>
        </div>
        <button
          onClick={() => { setLoading(true); void fetchGenome(); }}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    );
  }

  if (!genome) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Dna className="h-3.5 w-3.5" />
          <span>Business Genome</span>
        </div>
        <div className="rounded-lg bg-card p-3 text-xs">
          <p className="text-muted-foreground">No genome data yet. Start onboarding to build your business genome.</p>
        </div>
      </div>
    );
  }

  const stage = STAGE_LABELS[genome.genomeStage] ?? {
    label: genome.genomeStage?.replace(/_/g, " ") ?? "Unknown",
    color: "text-muted-foreground",
    bg: "bg-muted",
  };
  const topSections = (genome.dnaSections ?? [])
    .sort((a, b) => b.integrity - a.integrity)
    .slice(0, 4);

  return (
    <div className="space-y-3">
      {/* Stage Badge */}
      <div className="flex items-center gap-2">
        <span className={cn("text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full", stage.bg, stage.color)}>
          {stage.label}
        </span>
        {genome.threePillarMinimumMet && (
          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
        )}
      </div>

      {/* Overall Integrity */}
      <div className="flex items-center gap-3">
        <div className="relative h-12 w-12">
          <svg className="h-12 w-12 -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
            <circle
              cx="18" cy="18" r="15.9" fill="none"
              stroke={genome.genomeIntegrity >= 80 ? "hsl(142, 71%, 45%)" : genome.genomeIntegrity >= 50 ? "hsl(38, 92%, 50%)" : "hsl(0, 84%, 60%)"}
              strokeWidth="3"
              strokeDasharray={`${genome.genomeIntegrity}, 100`}
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
            {Math.round(genome.genomeIntegrity)}%
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium">Genome Integrity</p>
          <p className="text-[10px] text-muted-foreground">
            {genome.genomeIntegrity >= 80 ? "Strong foundation" : genome.genomeIntegrity >= 50 ? "Building momentum" : "Needs attention"}
          </p>
        </div>
      </div>

      {/* Top Sections */}
      <div className="space-y-2">
        {topSections.map((section) => (
          <IntegrityBar
            key={section.key}
            label={section.label}
            value={section.integrity}
            color={section.integrity >= 80 ? "bg-emerald-500" : section.integrity >= 50 ? "bg-amber-500" : "bg-red-500"}
          />
        ))}
      </div>

      {/* Executive Readiness */}
      {genome.executiveReadinessScore !== undefined && (
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-2">
          <Shield className="h-3 w-3 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-muted-foreground">Executive Readiness</p>
            <p className="text-xs font-medium">{Math.round(genome.executiveReadinessScore)}%</p>
          </div>
        </div>
      )}
    </div>
  );
}
