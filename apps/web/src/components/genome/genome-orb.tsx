"use client";

import { Dna, Shield, CheckCircle2, Rocket, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GenomeIntegrityResult, GenomeStage } from "@/lib/api/business-genome";
import { ProgressRing } from "@/components/ui-v2/progress-ring";
import { Badge } from "@/components/ui-v2/badge";

const STAGES: GenomeStage[] = [
  "CONCEPT",
  "VALIDATED_CONCEPT",
  "REGISTERED_ENTITY",
  "REVENUE_ENGINE",
  "OPERATING_BUSINESS",
  "GROWTH_BUSINESS",
  "ENTERPRISE_READY",
];

const STAGE_META: Record<
  GenomeStage,
  {
    label: string;
    short: string;
    color: "orange" | "teal" | "violet" | "gold" | "sky" | "mint" | "muted";
    bgClass: string;
    borderClass: string;
    glow: string;
  }
> = {
  CONCEPT: { label: "Concept", short: "Concept", color: "muted", bgClass: "bg-muted", borderClass: "border-muted", glow: "hsl(var(--kf-muted) / 0.25)" },
  VALIDATED_CONCEPT: { label: "Validated", short: "Validated", color: "sky", bgClass: "bg-sky", borderClass: "border-sky", glow: "hsl(200 90% 60% / 0.25)" },
  REGISTERED_ENTITY: { label: "Registered", short: "Registered", color: "mint", bgClass: "bg-mint", borderClass: "border-mint", glow: "hsl(160 70% 45% / 0.25)" },
  REVENUE_ENGINE: { label: "Revenue", short: "Revenue", color: "gold", bgClass: "bg-gold", borderClass: "border-gold", glow: "hsl(45 90% 55% / 0.25)" },
  OPERATING_BUSINESS: { label: "Operating", short: "Operating", color: "orange", bgClass: "bg-primary", borderClass: "border-primary", glow: "hsl(var(--kf-primary) / 0.25)" },
  GROWTH_BUSINESS: { label: "Growth", short: "Growth", color: "violet", bgClass: "bg-violet", borderClass: "border-violet", glow: "hsl(260 70% 60% / 0.25)" },
  ENTERPRISE_READY: { label: "Enterprise", short: "Enterprise", color: "teal", bgClass: "bg-teal", borderClass: "border-teal", glow: "hsl(170 80% 40% / 0.25)" },
};

export interface GenomeOrbProps extends React.HTMLAttributes<HTMLDivElement> {
  genome: GenomeIntegrityResult | null | undefined;
  compact?: boolean;
  onBuildClick?: () => void;
}

export function GenomeOrb({ genome, compact, onBuildClick, className, ...props }: GenomeOrbProps) {
  if (!genome) {
    return (
      <div
        className={cn(
          "surface flex flex-col items-center justify-center gap-3 p-6 text-center",
          className,
        )}
        {...props}
      >
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Dna className="h-7 w-7 text-muted-foreground" />
          <span className="absolute inset-0 rounded-full animate-ping bg-primary/10" />
        </div>
        <p className="text-body text-muted-foreground">No genome data yet.</p>
        {onBuildClick && (
          <button
            type="button"
            onClick={onBuildClick}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Rocket className="h-3.5 w-3.5" />
            Build Genome
          </button>
        )}
      </div>
    );
  }

  const integrity = Math.round(genome.genomeIntegrity);
  const stage = STAGE_META[genome.genomeStage] ?? {
    label: genome.genomeStage?.replace(/_/g, " ") ?? "Unknown",
    short: genome.genomeStage?.replace(/_/g, " ") ?? "Unknown",
    color: "muted" as const,
    glow: "hsl(var(--kf-muted) / 0.25)",
  };
  const ringColor = integrity >= 80 ? "teal" : integrity >= 50 ? "orange" : "rose";
  const currentStageIndex = STAGES.indexOf(genome.genomeStage);

  const topSections = (genome.dnaSections ?? [])
    .slice()
    .sort((a, b) => b.integrity - a.integrity)
    .slice(0, compact ? 2 : 3);

  return (
    <div
      className={cn(
        "surface relative flex flex-col gap-3 overflow-hidden animate-reveal",
        compact ? "p-3" : "p-5 gap-4",
        className,
      )}
      {...props}
    >
      {/* Ambient stage glow */}
      <div
        className="pointer-events-none absolute inset-0 opacity-60 transition-all duration-700"
        style={{
          background: `radial-gradient(circle at 15% 15%, ${stage.glow}, transparent 35%),
                       radial-gradient(circle at 85% 85%, hsl(var(--kf-primary) / 0.08), transparent 40%)`,
        }}
      />

      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge color={stage.color}>{stage.label}</Badge>
          {genome.threePillarMinimumMet && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-mint">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Three-pillar minimum met</span>
            </span>
          )}
        </div>
        {!compact && <Shield className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
      </div>

      <div className={cn("relative flex items-center", compact ? "gap-3" : "gap-5")}>
        <div className="relative">
          <ProgressRing
            value={integrity}
            size={compact ? 56 : 84}
            thickness={compact ? 6 : 9}
            segments={compact ? 8 : 12}
            color={ringColor}
          >
            <div className="flex flex-col items-center leading-none">
              <span className={cn("font-display font-bold text-foreground", compact ? "text-sm" : "text-xl")}>
                {integrity}%
              </span>
              {!compact && (
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">integrity</span>
              )}
            </div>
          </ProgressRing>
          {!compact && (
            <div
              className="pointer-events-none absolute inset-0 rounded-full animate-pulse"
              style={{ boxShadow: `0 0 24px ${stage.glow} inset` }}
            />
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          {topSections.map((section, index) => (
            <div
              key={section.key}
              className="animate-reveal"
              style={{ animationDelay: `${(index + 1) * 40}ms` }}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="truncate text-foreground">{section.label}</span>
                <span
                  className={cn(
                    "font-mono font-semibold",
                    section.integrity >= 80
                      ? "text-mint"
                      : section.integrity >= 50
                        ? "text-gold-foreground"
                        : "text-rose",
                  )}
                >
                  {Math.round(section.integrity)}%
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-base ease-flow",
                    section.integrity >= 80
                      ? "bg-mint"
                      : section.integrity >= 50
                        ? "bg-gold"
                        : "bg-rose",
                  )}
                  style={{ width: `${Math.min(section.integrity, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stage stepper — horizontally scrollable on small screens */}
      {!compact && (
        <div className="relative -mx-1" aria-label="Business stage progression">
          <div className="overflow-x-auto pb-2 scrollbar-hide">
            <div className="flex items-center min-w-[540px] px-1">
              {STAGES.map((s, i) => {
                const meta = STAGE_META[s];
                const isCurrent = s === genome.genomeStage;
                const isCompleted = i < currentStageIndex;
                const isFuture = i > currentStageIndex;
                return (
                  <div key={s} className="flex flex-1 items-center">
                    <button
                      type="button"
                      disabled
                      title={meta.label}
                      className={cn(
                        "relative flex h-6 w-6 items-center justify-center rounded-full border-2 text-[9px] font-bold transition-colors flex-shrink-0",
                        isCurrent && `${meta.borderClass} ${meta.bgClass} text-white shadow-[0_0_10px_currentColor]`,
                        isCompleted && "border-mint bg-mint text-white",
                        isFuture && "border-muted bg-background text-muted-foreground",
                      )}
                      aria-current={isCurrent ? "step" : undefined}
                      aria-label={`${meta.label}${isCurrent ? " (current)" : ""}`}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <span className="sr-only">{meta.label}</span>
                      )}
                    </button>
                    <span
                      className={cn(
                        "ml-1.5 text-[10px] font-medium whitespace-nowrap",
                        isCurrent ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {meta.short}
                    </span>
                    {i < STAGES.length - 1 && (
                      <div
                        className={cn(
                          "h-0.5 flex-1 mx-2 rounded-full transition-colors",
                          i < currentStageIndex ? "bg-mint" : "bg-muted",
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {!compact && genome.executiveReadinessScore !== undefined && (
        <div className="relative flex items-center justify-between rounded-xl bg-surface-muted px-3 py-2">
          <span className="text-caption text-muted-foreground flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            Executive readiness
          </span>
          <span className="font-mono font-semibold text-foreground">
            {Math.round(genome.executiveReadinessScore)}%
          </span>
        </div>
      )}
    </div>
  );
}
