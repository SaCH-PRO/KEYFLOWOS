"use client";

import { ShieldAlert, ShieldCheck, ArrowRight } from "lucide-react";
import { openKey } from "@/components/key";
import { EmptyState } from "@/components/ui/empty-state";
import type { CommandCenterModuleReadiness } from "@/lib/api/business-command-center";

interface CommandModuleReadinessPanelProps {
  modules: CommandCenterModuleReadiness[];
}

function riskTone(level: CommandCenterModuleReadiness["riskLevel"]) {
  switch (level) {
    case "CRITICAL":
    case "HIGH":
      return "text-destructive";
    case "MEDIUM":
      return "text-[hsl(var(--kf-warning))]";
    default:
      return "text-[hsl(var(--kf-success))]";
  }
}

function readinessTone(score: number, automationAllowed: boolean) {
  if (!automationAllowed || score < 40) return "text-destructive";
  if (score < 70) return "text-[hsl(var(--kf-warning))]";
  return "text-[hsl(var(--kf-success))]";
}

export function CommandModuleReadinessPanel({ modules }: CommandModuleReadinessPanelProps) {
  const sorted = [...modules].sort((a, b) => {
    if (a.automationAllowed !== b.automationAllowed) return a.automationAllowed ? 1 : -1;
    if (a.readinessScore !== b.readinessScore) return a.readinessScore - b.readinessScore;
    const riskRank = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 } as const;
    return riskRank[b.riskLevel] - riskRank[a.riskLevel];
  });

  const top = sorted.slice(0, 5);

  return (
    <div className="rounded-2xl border border-border/30 bg-card/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {top.some((m) => !m.automationAllowed) ? (
            <ShieldAlert className="w-4 h-4 text-destructive" />
          ) : (
            <ShieldCheck className="w-4 h-4 text-[hsl(var(--kf-success))]" />
          )}
          <h3 className="text-sm font-semibold text-foreground">Module Readiness</h3>
        </div>
        <span className="text-[10px] text-muted-foreground">{modules.length} modules</span>
      </div>

      {top.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No module readiness data yet"
          description="Complete your Business Genome so KEY can score module readiness."
          actionLabel="Populate Genome"
          actionIcon={ArrowRight}
          onAction={() => openKey({ mode: "onboarding" })}
          variant="inline"
        />
      ) : (
        <div className="space-y-2">
          {top.map((m) => (
            <div
              key={m.module}
              className="rounded-xl bg-muted/30 p-2.5 space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground capitalize">
                  {m.module.replace(/_/g, " ")}
                </span>
                <span className={`text-xs font-semibold ${readinessTone(m.readinessScore, m.automationAllowed)}`}>
                  {m.readinessScore}%
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className={riskTone(m.riskLevel)}>{m.riskLevel}</span>
                <span>{m.automationAllowed ? "Automation allowed" : "Blocked"}</span>
              </div>
              {m.blockedReasons.length > 0 && (
                <p className="text-[10px] text-muted-foreground line-clamp-1">{m.blockedReasons[0]}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => openKey({ mode: "onboarding" })}
        className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--kf-accent1))] hover:text-[hsl(var(--kf-accent1))]/80 transition-colors"
      >
        Review missing facts <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  );
}
